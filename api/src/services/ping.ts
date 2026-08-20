import type { Source } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { badRequest, notFound } from '../errors';
import { parseFieldSchema, stripPii, validateAgainstFieldSchema } from '../core/verticalSchema';
import { getSettings, nextRoundRobinCursor } from '../settings';
import { runAuction } from './auction';
import type { Offer, Rejection } from '../core/types';

export interface PingRequest {
  vertical: string;
  state?: string | null;
  zip?: string | null;
  [key: string]: unknown;
}

export interface PingResponse {
  ping_id: string;
  status: 'open' | 'no_bid';
  expires_at: string;
  winner: Offer | null;
  offers: Offer[];
  matched: number;
  rejected: Rejection[];
  vertical: string;
  routing_strategy: string;
}

/**
 * PING — phase one of the auction.
 *
 * The source sends only non-PII qualifying attributes. We validate them against
 * the vertical's own field schema, run the auction, persist the result, and hand
 * back a short-lived token plus the ranked offers. **No lead is sold here.**
 */
export async function handlePing(source: Source, body: PingRequest): Promise<PingResponse> {
  const verticalKey = String(body.vertical ?? '').trim();
  if (!verticalKey) throw badRequest('`vertical` is required');

  const vertical = await prisma.vertical.findFirst({
    where: { OR: [{ key: verticalKey }, { id: verticalKey }] },
  });
  if (!vertical) throw notFound(`Unknown vertical: ${verticalKey}`);
  if (!vertical.active) throw badRequest(`Vertical "${vertical.key}" is not active`);

  const settings = await getSettings();
  const fields = parseFieldSchema(vertical.fieldSchema);

  // A ping must never carry PII — drop it before anything else touches the body.
  const { vertical: _v, state, zip, ...rest } = body;
  const safeRest = stripPii(rest as Record<string, unknown>);

  const validation = validateAgainstFieldSchema(fields, safeRest);
  if (!validation.ok) {
    throw badRequest('Ping attributes do not satisfy the vertical schema', validation.issues);
  }

  const attributes = {
    ...validation.values,
    state: state ? String(state).trim().toUpperCase() : undefined,
    zip: zip ? String(zip).trim() : undefined,
  };

  const now = new Date();
  const cursor =
    settings.routingStrategy === 'round_robin' ? await nextRoundRobinCursor(vertical.id) : 0;

  const auction = await runAuction({
    vertical,
    attributes,
    strategy: settings.routingStrategy,
    timezone: settings.timezone,
    now,
    cursor,
  });

  const expiresAt = new Date(now.getTime() + settings.pingTtlSeconds * 1000);
  const winner = auction.offers[0] ?? null;

  const ping = await prisma.ping.create({
    data: {
      sourceId: source.id,
      verticalId: vertical.id,
      payload: attributes as Prisma.InputJsonValue,
      matched: auction.offers as unknown as Prisma.InputJsonValue,
      rejected: auction.rejected as unknown as Prisma.InputJsonValue,
      bestCampaignId: winner?.campaign_id ?? null,
      bestBid: winner ? new Prisma.Decimal(winner.bid) : null,
      status: winner ? 'open' : 'no_bid',
      expiresAt,
    },
  });

  return {
    ping_id: ping.id,
    status: winner ? 'open' : 'no_bid',
    expires_at: expiresAt.toISOString(),
    winner,
    offers: auction.offers,
    matched: auction.offers.length,
    rejected: auction.rejected,
    vertical: vertical.key,
    routing_strategy: settings.routingStrategy,
  };
}
