import { describe, expect, it } from 'vitest';
import { matchAll, matchCampaign } from '../core/matching';
import type { CampaignCandidate, MatchContext } from '../core/types';

const VERTICAL = 'vert-1';

function campaign(overrides: Partial<CampaignCandidate> = {}): CampaignCandidate {
  return {
    id: 'c1',
    buyerId: 'b1',
    buyerName: 'Buyer One',
    name: 'Campaign One',
    verticalId: VERTICAL,
    active: true,
    buyerActive: true,
    bid: 25,
    routingPriority: 100,
    states: [],
    zips: [],
    filters: [],
    dailyCap: 0,
    monthlyCap: 0,
    concurrencyCap: 0,
    schedule: {},
    ...overrides,
  };
}

const ctx: MatchContext = {
  now: new Date('2026-08-20T15:00:00Z'),
  timezone: 'UTC',
  counts: {},
};

const attrs = { state: 'CA', zip: '90210', homeowner: true, property_age: 30 };

describe('matchCampaign', () => {
  it('accepts an unconstrained active campaign', () => {
    expect(matchCampaign(campaign(), attrs, VERTICAL, ctx)).toEqual({ accepted: true });
  });

  it('rejects inactive campaigns and inactive buyers', () => {
    expect(matchCampaign(campaign({ active: false }), attrs, VERTICAL, ctx)).toMatchObject({
      accepted: false,
      reason: 'campaign_inactive',
    });
    expect(matchCampaign(campaign({ buyerActive: false }), attrs, VERTICAL, ctx)).toMatchObject({
      reason: 'buyer_inactive',
    });
  });

  it('rejects a campaign belonging to a different vertical', () => {
    expect(matchCampaign(campaign(), attrs, 'other-vertical', ctx)).toMatchObject({
      reason: 'vertical_mismatch',
    });
  });

  it('treats an empty geo list as "no restriction"', () => {
    expect(matchCampaign(campaign({ states: [] }), attrs, VERTICAL, ctx).accepted).toBe(true);
  });

  it('filters on state, case-insensitively', () => {
    expect(matchCampaign(campaign({ states: ['ca', 'tx'] }), attrs, VERTICAL, ctx).accepted).toBe(
      true
    );
    expect(matchCampaign(campaign({ states: ['NY'] }), attrs, VERTICAL, ctx)).toMatchObject({
      reason: 'geo_state',
      detail: 'CA',
    });
    expect(
      matchCampaign(campaign({ states: ['CA'] }), { ...attrs, state: undefined }, VERTICAL, ctx)
    ).toMatchObject({ reason: 'geo_state', detail: '(missing)' });
  });

  it('filters on zip', () => {
    expect(matchCampaign(campaign({ zips: ['90210'] }), attrs, VERTICAL, ctx).accepted).toBe(true);
    expect(matchCampaign(campaign({ zips: ['10001'] }), attrs, VERTICAL, ctx)).toMatchObject({
      reason: 'geo_zip',
    });
  });

  it('reports the failing field as filter:<field>', () => {
    const result = matchCampaign(
      campaign({ filters: [{ field: 'property_age', op: 'lt', value: 10 }] }),
      attrs,
      VERTICAL,
      ctx
    );
    expect(result).toMatchObject({ accepted: false, reason: 'filter:property_age' });
    expect(result.accepted === false && result.detail).toContain('property_age');
  });

  it('rejects outside the campaign schedule', () => {
    // 15:00 UTC on a Thursday; this campaign only runs mornings.
    expect(
      matchCampaign(campaign({ schedule: { start: '06:00', end: '12:00' } }), attrs, VERTICAL, ctx)
    ).toMatchObject({ reason: 'schedule' });
  });

  it('enforces daily, monthly and concurrency caps, and ignores 0', () => {
    const counted: MatchContext = {
      ...ctx,
      counts: { c1: { daily: 5, monthly: 40, concurrent: 3 } },
    };
    expect(matchCampaign(campaign({ dailyCap: 0 }), attrs, VERTICAL, counted).accepted).toBe(true);
    expect(matchCampaign(campaign({ dailyCap: 5 }), attrs, VERTICAL, counted)).toMatchObject({
      reason: 'daily_cap',
      detail: '5/5',
    });
    expect(matchCampaign(campaign({ dailyCap: 6 }), attrs, VERTICAL, counted).accepted).toBe(true);
    expect(matchCampaign(campaign({ monthlyCap: 40 }), attrs, VERTICAL, counted)).toMatchObject({
      reason: 'monthly_cap',
    });
    expect(matchCampaign(campaign({ concurrencyCap: 3 }), attrs, VERTICAL, counted)).toMatchObject({
      reason: 'concurrency_cap',
    });
  });

  it('reports the first disqualifying check, cheapest-first', () => {
    const c = campaign({
      states: ['NY'],
      filters: [{ field: 'property_age', op: 'lt', value: 1 }],
      dailyCap: 1,
    });
    const counted: MatchContext = { ...ctx, counts: { c1: { daily: 9, monthly: 9, concurrent: 9 } } };
    expect(matchCampaign(c, attrs, VERTICAL, counted)).toMatchObject({ reason: 'geo_state' });
  });
});

describe('matchAll', () => {
  it('partitions candidates into offers and explained rejections', () => {
    const campaigns = [
      campaign({ id: 'a', bid: 30 }),
      campaign({ id: 'b', bid: 45, states: ['NY'] }),
      campaign({ id: 'c', bid: 20, filters: [{ field: 'homeowner', op: 'eq', value: false }] }),
      campaign({ id: 'd', bid: 55, active: false }),
    ];
    const { accepted, offers, rejected } = matchAll(campaigns, attrs, VERTICAL, ctx);

    expect(accepted.map((c) => c.id)).toEqual(['a']);
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ campaign_id: 'a', bid: 30, buyer_name: 'Buyer One' });
    expect(rejected.map((r) => r.reason)).toEqual([
      'geo_state',
      'filter:homeowner',
      'campaign_inactive',
    ]);
  });
});
