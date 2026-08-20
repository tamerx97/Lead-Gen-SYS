import { describe, expect, it } from 'vitest';
import { rankCampaigns, rankOffers } from '../core/ranking';
import type { CampaignCandidate } from '../core/types';

function c(id: string, bid: number, routingPriority: number): CampaignCandidate {
  return {
    id,
    buyerId: `buyer-${id}`,
    name: `Campaign ${id}`,
    verticalId: 'v',
    active: true,
    buyerActive: true,
    bid,
    routingPriority,
    states: [],
    zips: [],
    filters: [],
    dailyCap: 0,
    monthlyCap: 0,
    concurrencyCap: 0,
    schedule: {},
  };
}

// Deliberately ordered so bid and priority disagree about the winner.
const pool = [c('a', 30, 50), c('b', 45, 90), c('c', 22, 10)];

describe('rankCampaigns', () => {
  it('bid: highest bid first', () => {
    expect(rankCampaigns(pool, 'bid').map((x) => x.id)).toEqual(['b', 'a', 'c']);
  });

  it('priority: lowest routingPriority first', () => {
    expect(rankCampaigns(pool, 'priority').map((x) => x.id)).toEqual(['c', 'a', 'b']);
  });

  it('switching strategy changes the winner for the same pool', () => {
    expect(rankCampaigns(pool, 'bid')[0].id).toBe('b');
    expect(rankCampaigns(pool, 'priority')[0].id).toBe('c');
  });

  it('bid ties break on priority then id, deterministically', () => {
    const tied = [c('z', 40, 20), c('y', 40, 10), c('x', 40, 10)];
    expect(rankCampaigns(tied, 'bid').map((v) => v.id)).toEqual(['x', 'y', 'z']);
  });

  it('round_robin rotates evenly as the cursor advances', () => {
    const winners = [0, 1, 2, 3, 4, 5].map((cursor) => rankCampaigns(pool, 'round_robin', cursor)[0].id);
    expect(winners).toEqual(['a', 'b', 'c', 'a', 'b', 'c']);
  });

  it('round_robin always returns every campaign exactly once', () => {
    const ranked = rankCampaigns(pool, 'round_robin', 7);
    expect(new Set(ranked.map((r) => r.id))).toEqual(new Set(['a', 'b', 'c']));
    expect(ranked).toHaveLength(3);
  });

  it('handles empty and single-campaign pools', () => {
    expect(rankCampaigns([], 'bid')).toEqual([]);
    expect(rankCampaigns([pool[0]], 'round_robin', 5).map((x) => x.id)).toEqual(['a']);
  });

  it('does not mutate its input', () => {
    const before = pool.map((x) => x.id);
    rankCampaigns(pool, 'bid');
    rankCampaigns(pool, 'priority');
    expect(pool.map((x) => x.id)).toEqual(before);
  });
});

describe('rankOffers', () => {
  it('maps ranked campaigns to the wire shape', () => {
    const offers = rankOffers(pool, 'bid');
    expect(offers[0]).toEqual({
      campaign_id: 'b',
      campaign_name: 'Campaign b',
      buyer_id: 'buyer-b',
      buyer_name: undefined,
      bid: 45,
      routing_priority: 90,
    });
  });
});
