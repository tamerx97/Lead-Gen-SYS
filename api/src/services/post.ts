import type { Source } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { badRequest, conflict, notFound } from '../errors';
import { dedupWindowStart, hashEmail, hashPhone, isDuplicate } from '../core/dedup';
import { parseFieldSchema, validateAgainstFieldSchema } from '../core/verticalSchema';
import { getSettings } from '../settings';
import { runAuction } from './auction';
import { deliverLead, type DeliveryResult } from './delivery';
import type { Offer } from '../core/types';

export interface PostRequest {
  ping_id: string;
  campaign_id?: string;
  [key: string]: unknown;
}

export interface PostResponse {
  accepted: boolean;
  lead_id: string;
  status: 'sold' | 'delivered' | 'delivery_failed' | 'rejected_dup';
  sold_to: {
    buyer_id: string;
    buyer_name: string;
    campaign_id: string;
    campaign_name: string;
  } | null;
  price: number;
  vertical: string;
  delivery: {
    outcome: string;
    attempts: number;
    status?: number;
    error?: string;
    response?: unknown;
  };
  reason?: string;
}

/**
 * POST — phase two of the auction.
 *
 * The source now sends the full lead including PII plus the `ping_id` from
 * phase one. We re-validate the ping, re-run the auction for the chosen campaign
 * (caps and schedules can have changed since the ping), dedup, record the sale,
 * and deliver.
 */
export async function handlePost(source: Source, body: PostRequest): Promise<PostResponse> {
  const pingId = String(body.ping_id ?? '').trim();
  if (!pingId) throw badRequest('`ping_id` is required — a post must reference a prior ping');

  const ping = await prisma.ping.findUnique({
    where: { id: pingId },
    include: { vertical: true },
  });
  if (!ping) throw notFound(`Unknown ping_id: ${pingId}`);
  if (ping.sourceId !== source.id) {
    throw badRequest('That ping belongs to a different source');
  }

  const now = new Date();
  if (ping.status === 'posted') throw conflict('That ping has already been posted');
  if (ping.status === 'no_bid') {
    throw badRequest('That ping received no bids — there is nothing to post against');
  }
  if (ping.expiresAt.getTime() <= now.getTime()) {
    if (ping.status !== 'expired') {
      await prisma.ping.update({ where: { id: ping.id }, data: { status: 'expired' } });
    }
    throw conflict(`Ping expired at ${ping.expiresAt.toISOString()}`);
  }

  const settings = await getSettings();
  const vertical = ping.vertical;
  const fields = parseFieldSchema(vertical.fieldSchema);

  // The post carries the full lead. Validate its qualifying attributes against
  // the vertical schema again, then merge with what the ping already qualified.
  const { ping_id: _p, campaign_id: chosenCampaignId, ...leadInput } = body;
  const validation = validateAgainstFieldSchema(fields, leadInput as Record<string, unknown>);
  if (!validation.ok) {
    throw badRequest('Lead attributes do not satisfy the vertical schema', validation.issues);
  }

  const pingPayload = (ping.payload ?? {}) as Record<string, unknown>;
  const fullPayload: Record<string, unknown> = {
    ...pingPayload,
    ...validation.values,
    state: String(leadInput.state ?? pingPayload.state ?? '').trim().toUpperCase() || undefined,
    zip: String(leadInput.zip ?? pingPayload.zip ?? '').trim() || undefined,
  };

  // Attributes the auction re-checks against: the ping's qualifying set wins so a
  // source cannot ping with one profile and post a different, cheaper one.
  const auctionAttributes = { ...fullPayload, ...pingPayload };

  const offers = (ping.matched ?? []) as unknown as Offer[];
  const requested = chosenCampaignId ? String(chosenCampaignId).trim() : undefined;
  if (requested && !offers.some((o) => o.campaign_id === requested)) {
    throw badRequest(`campaign_id ${requested} was not among the offers returned for this ping`);
  }

  // Re-run the auction so caps/schedules are enforced at award time, not just
  // at ping time.
  const auction = await runAuction({
    vertical,
    attributes: auctionAttributes,
    strategy: settings.routingStrategy,
    timezone: settings.timezone,
    now,
    cursor: 0,
    onlyCampaignId: requested,
  });

  let winner = requested
    ? auction.ranked.find((c) => c.id === requested) ?? null
    : // Without an explicit choice, prefer the ping's ranked order, filtered to
      // campaigns that still qualify right now.
      offers
        .map((o) => auction.ranked.find((c) => c.id === o.campaign_id))
        .find((c): c is NonNullable<typeof c> => !!c) ?? auction.ranked[0] ?? null;

  if (!winner) {
    const reason = auction.rejected[0]?.reason ?? 'no_qualifying_campaign';
    throw conflict(
      `No campaign still qualifies for this lead at post time (${reason}). Re-ping to get fresh offers.`
    );
  }

  const phoneHash = hashPhone(
    leadInput.phone ?? leadInput.phone_number ?? (leadInput as Record<string, unknown>).mobile
  );
  const emailHash = hashEmail(leadInput.email ?? leadInput.email_address);

  // ---- Duplicate check -------------------------------------------------
  const windowStart = dedupWindowStart(now, settings.dedupWindowDays);
  if (windowStart && (phoneHash || emailHash)) {
    const priors = await prisma.lead.findMany({
      where: {
        verticalId: vertical.id,
        createdAt: { gte: windowStart },
        status: { in: ['sold', 'delivered', 'delivery_failed'] },
        OR: [
          ...(phoneHash ? [{ phoneHash }] : []),
          ...(emailHash ? [{ emailHash }] : []),
        ],
      },
      select: { id: true, phoneHash: true, emailHash: true },
      take: 200,
    });

    const dup = isDuplicate(
      { phoneHash, emailHash },
      new Set(priors.map((p) => p.phoneHash).filter((h): h is string => !!h)),
      new Set(priors.map((p) => p.emailHash).filter((h): h is string => !!h))
    );

    if (dup.duplicate) {
      const lead = await prisma.lead.create({
        data: {
          pingId: ping.id,
          sourceId: source.id,
          campaignId: null,
          buyerId: null,
          verticalId: vertical.id,
          price: new Prisma.Decimal(0),
          payload: fullPayload as Prisma.InputJsonValue,
          phoneHash,
          emailHash,
          status: 'rejected_dup',
          deliveryResponse: {
            skipped: true,
            reason: `duplicate ${dup.on} within ${settings.dedupWindowDays} days`,
          } as Prisma.InputJsonValue,
        },
      });
      await prisma.ping.update({ where: { id: ping.id }, data: { status: 'posted' } });

      return {
        accepted: false,
        lead_id: lead.id,
        status: 'rejected_dup',
        sold_to: null,
        price: 0,
        vertical: vertical.key,
        delivery: { outcome: 'skipped', attempts: 0 },
        reason: `duplicate_${dup.on}`,
      };
    }
  }

  // ---- Award -----------------------------------------------------------
  const buyer = await prisma.buyer.findUnique({ where: { id: winner.buyerId } });
  if (!buyer) throw conflict('The winning campaign has no buyer record');

  const price = winner.bid;

  const lead = await prisma.lead.create({
    data: {
      pingId: ping.id,
      sourceId: source.id,
      campaignId: winner.id,
      buyerId: winner.buyerId,
      verticalId: vertical.id,
      price: new Prisma.Decimal(price),
      payload: fullPayload as Prisma.InputJsonValue,
      phoneHash,
      emailHash,
      status: 'sold',
    },
  });

  await prisma.ping.update({
    where: { id: ping.id },
    data: { status: 'posted', bestCampaignId: winner.id, bestBid: new Prisma.Decimal(price) },
  });

  // ---- Deliver ---------------------------------------------------------
  const document: Record<string, unknown> = {
    lead_id: lead.id,
    ping_id: ping.id,
    vertical: vertical.key,
    campaign_id: winner.id,
    campaign_name: winner.name,
    buyer_id: winner.buyerId,
    price,
    source_id: source.id,
    source_name: source.name,
    received_at: lead.createdAt.toISOString(),
    ...fullPayload,
  };

  const delivery: DeliveryResult = await deliverLead(buyer, document);

  const status =
    delivery.outcome === 'delivered'
      ? 'delivered'
      : delivery.outcome === 'skipped'
        ? 'sold'
        : 'delivery_failed';

  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      status,
      deliveryAttempts: delivery.attempts,
      deliveryResponse: {
        outcome: delivery.outcome,
        url: delivery.url,
        method: delivery.method,
        status: delivery.status,
        body: delivery.body,
        error: delivery.error,
        durationMs: delivery.durationMs,
        requestBody: delivery.requestBody,
      } as Prisma.InputJsonValue,
    },
  });

  return {
    accepted: true,
    lead_id: lead.id,
    status,
    sold_to: {
      buyer_id: winner.buyerId,
      buyer_name: buyer.name,
      campaign_id: winner.id,
      campaign_name: winner.name,
    },
    price,
    vertical: vertical.key,
    delivery: {
      outcome: delivery.outcome,
      attempts: delivery.attempts,
      status: delivery.status,
      error: delivery.error,
      response: delivery.body,
    },
  };
}

/** Housekeeping: flip stale open pings to `expired`. */
export async function expireStalePings(now = new Date()): Promise<number> {
  const result = await prisma.ping.updateMany({
    where: { status: 'open', expiresAt: { lt: now } },
    data: { status: 'expired' },
  });
  return result.count;
}
