import type { Campaign, Buyer, Vertical } from '@prisma/client';
import { prisma } from '../db';
import { parseFilters } from '../core/filters';
import { matchAll } from '../core/matching';
import { rankCampaigns } from '../core/ranking';
import { parseSchedule } from '../core/schedule';
import type {
  CampaignCandidate,
  Offer,
  PingAttributes,
  Rejection,
  RoutingStrategy,
} from '../core/types';
import { toOffer } from '../core/matching';
import { loadCampaignCounts } from './caps';

type CampaignWithBuyer = Campaign & { buyer: Buyer };

/** Map a persisted campaign onto the pure engine's candidate shape. */
export function toCandidate(campaign: CampaignWithBuyer): CampaignCandidate {
  return {
    id: campaign.id,
    buyerId: campaign.buyerId,
    buyerName: campaign.buyer?.name,
    name: campaign.name,
    verticalId: campaign.verticalId,
    active: campaign.active,
    buyerActive: campaign.buyer?.active ?? false,
    bid: Number(campaign.bid),
    routingPriority: campaign.routingPriority,
    states: campaign.states ?? [],
    zips: campaign.zips ?? [],
    filters: parseFilters(campaign.filters),
    dailyCap: campaign.dailyCap,
    monthlyCap: campaign.monthlyCap,
    concurrencyCap: campaign.concurrencyCap,
    schedule: parseSchedule(campaign.schedule),
  };
}

export interface AuctionInput {
  vertical: Vertical;
  attributes: PingAttributes;
  strategy: RoutingStrategy;
  timezone: string;
  now: Date;
  /** Rotation counter for `round_robin`. */
  cursor?: number;
  /** Restrict the auction to one campaign — used to re-validate a chosen offer at post time. */
  onlyCampaignId?: string;
}

export interface AuctionResult {
  ranked: CampaignCandidate[];
  offers: Offer[];
  rejected: Rejection[];
  winner: CampaignCandidate | null;
}

/**
 * Run one auction: load the vertical's campaigns, ask each whether it bids, and
 * rank the acceptors by the active routing strategy.
 *
 * This is the single code path behind both `/api/ping` and the re-check on
 * `/api/post`, so a lead can never be awarded on terms the ping didn't verify.
 */
export async function runAuction(input: AuctionInput): Promise<AuctionResult> {
  const campaigns = (await prisma.campaign.findMany({
    where: {
      verticalId: input.vertical.id,
      ...(input.onlyCampaignId ? { id: input.onlyCampaignId } : {}),
    },
    include: { buyer: true },
    orderBy: { createdAt: 'asc' },
  })) as CampaignWithBuyer[];

  const candidates = campaigns.map(toCandidate);
  const counts = await loadCampaignCounts(
    candidates.map((c) => c.id),
    input.now,
    input.timezone
  );

  const { accepted, rejected } = matchAll(candidates, input.attributes, input.vertical.id, {
    now: input.now,
    timezone: input.timezone,
    counts,
  });

  const ranked = rankCampaigns(accepted, input.strategy, input.cursor ?? 0);

  return {
    ranked,
    offers: ranked.map(toOffer),
    rejected,
    winner: ranked[0] ?? null,
  };
}
