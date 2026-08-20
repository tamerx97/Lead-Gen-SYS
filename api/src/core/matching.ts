import { evaluateRules } from './filters';
import { isWithinSchedule } from './schedule';
import type {
  CampaignCandidate,
  MatchContext,
  MatchResult,
  Offer,
  PingAttributes,
  Rejection,
} from './types';

function normalizeGeo(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

/**
 * Decide whether one campaign bids on one ping.
 *
 * Checks run cheapest-first and short-circuit, so the reported reason is the
 * *first* thing that disqualified the campaign. Caps are checked last because
 * they're the only inputs that require a database read.
 */
export function matchCampaign(
  campaign: CampaignCandidate,
  attrs: PingAttributes,
  verticalId: string,
  ctx: MatchContext
): MatchResult {
  if (!campaign.active) return { accepted: false, reason: 'campaign_inactive' };
  if (!campaign.buyerActive) return { accepted: false, reason: 'buyer_inactive' };
  if (campaign.verticalId !== verticalId) {
    return { accepted: false, reason: 'vertical_mismatch' };
  }

  // Geo — an empty list means "no restriction", not "matches nothing".
  if (campaign.states.length > 0) {
    const state = normalizeGeo(attrs.state);
    const allowed = campaign.states.map(normalizeGeo);
    if (!state || !allowed.includes(state)) {
      return { accepted: false, reason: 'geo_state', detail: state || '(missing)' };
    }
  }
  if (campaign.zips.length > 0) {
    const zip = normalizeGeo(attrs.zip);
    const allowed = campaign.zips.map(normalizeGeo);
    if (!zip || !allowed.includes(zip)) {
      return { accepted: false, reason: 'geo_zip', detail: zip || '(missing)' };
    }
  }

  // Attribute filters over the vertical's own fields.
  const ruleResult = evaluateRules(campaign.filters, attrs);
  if (!ruleResult.passed) {
    const { field, op, value } = ruleResult.rule;
    return {
      accepted: false,
      reason: `filter:${field}`,
      detail: `expected ${field} ${op} ${JSON.stringify(value ?? null)}, got ${JSON.stringify(
        attrs[field] ?? null
      )}`,
    };
  }

  if (!isWithinSchedule(campaign.schedule, ctx.now, ctx.timezone)) {
    return { accepted: false, reason: 'schedule' };
  }

  const counts = ctx.counts[campaign.id] ?? { daily: 0, monthly: 0, concurrent: 0 };
  if (campaign.dailyCap > 0 && counts.daily >= campaign.dailyCap) {
    return { accepted: false, reason: 'daily_cap', detail: `${counts.daily}/${campaign.dailyCap}` };
  }
  if (campaign.monthlyCap > 0 && counts.monthly >= campaign.monthlyCap) {
    return {
      accepted: false,
      reason: 'monthly_cap',
      detail: `${counts.monthly}/${campaign.monthlyCap}`,
    };
  }
  if (campaign.concurrencyCap > 0 && counts.concurrent >= campaign.concurrencyCap) {
    return {
      accepted: false,
      reason: 'concurrency_cap',
      detail: `${counts.concurrent}/${campaign.concurrencyCap}`,
    };
  }

  return { accepted: true };
}

export interface MatchAllResult {
  accepted: CampaignCandidate[];
  offers: Offer[];
  rejected: Rejection[];
}

/** Run every candidate campaign through `matchCampaign`. */
export function matchAll(
  campaigns: CampaignCandidate[],
  attrs: PingAttributes,
  verticalId: string,
  ctx: MatchContext
): MatchAllResult {
  const accepted: CampaignCandidate[] = [];
  const rejected: Rejection[] = [];

  for (const campaign of campaigns) {
    const result = matchCampaign(campaign, attrs, verticalId, ctx);
    if (result.accepted) {
      accepted.push(campaign);
    } else {
      rejected.push({
        campaign_id: campaign.id,
        campaign_name: campaign.name,
        buyer_id: campaign.buyerId,
        reason: result.reason,
        detail: result.detail,
      });
    }
  }

  return { accepted, offers: accepted.map(toOffer), rejected };
}

export function toOffer(campaign: CampaignCandidate): Offer {
  return {
    campaign_id: campaign.id,
    campaign_name: campaign.name,
    buyer_id: campaign.buyerId,
    buyer_name: campaign.buyerName,
    bid: campaign.bid,
    routing_priority: campaign.routingPriority,
  };
}
