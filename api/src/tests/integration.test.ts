/**
 * End-to-end integration test for the full Ping & Post loop.
 *
 * Runs against the real Postgres named by DATABASE_URL, driving the real Express
 * app over a real socket. The only thing mocked is the *buyer* — a throwaway
 * HTTP server stands in for their CRM, which is exactly what a buyer is to this
 * platform: a URL.
 *
 * The fixtures below are created by the test itself with nonsense field names,
 * to prove the engine has no knowledge of any particular industry.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { createApp } from '../app';
import { SETTING_KEYS } from '../settings';

const prisma = new PrismaClient();

// ---------------------------------------------------------------- mock buyer
interface Received {
  headers: Record<string, string | string[] | undefined>;
  contentType: string;
  raw: string;
}

let buyerServer: Server;
let buyerUrl = '';
let rejectingUrl = '';
const receivedByBuyer = new Map<string, Received[]>();

function startMockBuyer(): Promise<void> {
  return new Promise((resolve) => {
    buyerServer = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const slug = (req.url ?? '/').split('/').pop() ?? 'unknown';
        const list = receivedByBuyer.get(slug) ?? [];
        list.push({
          headers: req.headers,
          contentType: req.headers['content-type'] ?? '',
          raw,
        });
        receivedByBuyer.set(slug, list);

        if ((req.url ?? '').includes('/reject/')) {
          res.writeHead(422, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'buyer rejects everything' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, buyer_reference: 'CRM-12345' }));
      });
    });
    buyerServer.listen(0, '127.0.0.1', () => {
      const { port } = buyerServer.address() as AddressInfo;
      buyerUrl = `http://127.0.0.1:${port}/accept/primary`;
      rejectingUrl = `http://127.0.0.1:${port}/reject/broken`;
      resolve();
    });
  });
}

// ----------------------------------------------------------------- test API
let apiServer: Server;
let apiBase = '';

function startApi(): Promise<void> {
  return new Promise((resolve) => {
    const app = createApp({ mockBuyer: false });
    apiServer = app.listen(0, '127.0.0.1', () => {
      const { port } = apiServer.address() as AddressInfo;
      apiBase = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
}

async function call(
  path: string,
  init: { method?: string; body?: unknown; apiKey?: string } = {}
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${apiBase}${path}`, {
    method: init.method ?? 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(init.apiKey ? { 'X-Api-Key': init.apiKey } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

// --------------------------------------------------------------- fixtures
//
// A deliberately invented niche. If any of this passed because the code knew
// about "insurance" or "roofing", these names would not work.
const VERTICAL_KEY = `widget_leasing_test_${Date.now()}`;
const API_KEY = `lgs_test_${Date.now()}`;

let verticalId = '';
let sourceId = '';
let topBidderCampaignId = '';
let preferredCampaignId = '';
let brokenCampaignId = '';

async function resetSettings(patch: Record<string, string> = {}): Promise<void> {
  const values: Record<string, string> = {
    [SETTING_KEYS.routingStrategy]: 'bid',
    [SETTING_KEYS.dedupWindowDays]: '30',
    [SETTING_KEYS.pingTtlSeconds]: '300',
    [SETTING_KEYS.timezone]: 'UTC',
    ...patch,
  };
  for (const [key, value] of Object.entries(values)) {
    await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
}

beforeAll(async () => {
  await startMockBuyer();
  await startApi();

  const vertical = await prisma.vertical.create({
    data: {
      key: VERTICAL_KEY,
      name: 'Widget Leasing (test)',
      fieldSchema: [
        { name: 'fleet_size', label: 'Fleet Size', type: 'number', required: true },
        {
          name: 'lease_term',
          label: 'Lease Term',
          type: 'enum',
          required: true,
          options: ['short', 'long'],
        },
        { name: 'certified', label: 'Certified Operator', type: 'boolean', required: false },
      ] as unknown as Prisma.InputJsonValue,
    },
  });
  verticalId = vertical.id;

  const source = await prisma.source.create({
    data: { name: 'Integration Test Source', apiKey: API_KEY },
  });
  sourceId = source.id;

  const topBidder = await prisma.buyer.create({
    data: { name: 'Test Top Bidder', deliveryUrl: buyerUrl, deliveryMethod: 'json' },
  });
  const preferred = await prisma.buyer.create({
    data: {
      name: 'Test Preferred Buyer',
      deliveryUrl: buyerUrl,
      deliveryMethod: 'form',
      fieldMapping: { LeadRef: 'lead_id', Zip: 'zip', Size: 'fleet_size' },
    },
  });
  const broken = await prisma.buyer.create({
    data: { name: 'Test Broken Buyer', deliveryUrl: rejectingUrl, deliveryMethod: 'json' },
  });

  // Bid order and priority order deliberately disagree.
  topBidderCampaignId = (
    await prisma.campaign.create({
      data: {
        buyerId: topBidder.id,
        verticalId,
        name: 'Top Bid, Low Preference',
        bid: new Prisma.Decimal('90.00'),
        routingPriority: 200,
        states: ['CA', 'NV'],
        filters: [{ field: 'fleet_size', op: 'gte', value: 5 }] as unknown as Prisma.InputJsonValue,
      },
    })
  ).id;

  preferredCampaignId = (
    await prisma.campaign.create({
      data: {
        buyerId: preferred.id,
        verticalId,
        name: 'Preferred, Lower Bid',
        bid: new Prisma.Decimal('40.00'),
        routingPriority: 1,
        states: [],
        filters: [
          { field: 'lease_term', op: 'in', value: ['short', 'long'] },
          { field: 'fleet_size', op: 'gte', value: 2 },
        ] as unknown as Prisma.InputJsonValue,
      },
    })
  ).id;

  brokenCampaignId = (
    await prisma.campaign.create({
      data: {
        buyerId: broken.id,
        verticalId,
        name: 'Certified Only (broken endpoint)',
        bid: new Prisma.Decimal('75.00'),
        routingPriority: 50,
        states: ['CA'],
        filters: [
          { field: 'certified', op: 'eq', value: true },
        ] as unknown as Prisma.InputJsonValue,
      },
    })
  ).id;
});

afterAll(async () => {
  // Tear the fixtures down; cascades take the campaigns/pings/leads with them.
  await prisma.lead.deleteMany({ where: { verticalId } });
  await prisma.ping.deleteMany({ where: { verticalId } });
  await prisma.campaign.deleteMany({ where: { verticalId } });
  await prisma.buyer.deleteMany({ where: { name: { startsWith: 'Test ' } } });
  await prisma.source.deleteMany({ where: { id: sourceId } });
  await prisma.vertical.deleteMany({ where: { id: verticalId } });
  await prisma.setting.deleteMany({ where: { key: `rr_cursor:${verticalId}` } });
  await prisma.$disconnect();
  apiServer.close();
  buyerServer.close();
});

beforeEach(async () => {
  await resetSettings();
  receivedByBuyer.clear();
  // Each test starts with a clean lead history so dedup is deterministic.
  await prisma.lead.deleteMany({ where: { verticalId } });
});

const qualifyingPing = {
  vertical: VERTICAL_KEY,
  state: 'CA',
  zip: '90210',
  fleet_size: 12,
  lease_term: 'long',
  certified: true,
};

describe('auth on the public API', () => {
  it('rejects a ping with no API key', async () => {
    const res = await call('/api/ping', { body: qualifyingPing });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/X-Api-Key/i);
  });

  it('rejects a ping with a bad API key', async () => {
    const res = await call('/api/ping', { body: qualifyingPing, apiKey: 'lgs_not_a_real_key' });
    expect(res.status).toBe(401);
  });
});

describe('ping', () => {
  it('runs a bid war and ranks the offers by bid', async () => {
    const res = await call('/api/ping', { body: qualifyingPing, apiKey: API_KEY });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('open');
    expect(res.body.ping_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.matched).toBe(3);
    expect(res.body.offers.map((o: any) => o.bid)).toEqual([90, 75, 40]);
    expect(res.body.winner.campaign_id).toBe(topBidderCampaignId);
    expect(new Date(res.body.expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('never sells: no lead row exists after a ping', async () => {
    const res = await call('/api/ping', { body: qualifyingPing, apiKey: API_KEY });
    const leads = await prisma.lead.count({ where: { pingId: res.body.ping_id } });
    expect(leads).toBe(0);
    const ping = await prisma.ping.findUnique({ where: { id: res.body.ping_id } });
    expect(ping?.status).toBe('open');
  });

  it('strips PII a source mistakenly puts on a ping', async () => {
    const res = await call('/api/ping', {
      body: { ...qualifyingPing, first_name: 'Jane', phone: '5550101234', email: 'j@example.com' },
      apiKey: API_KEY,
    });
    const ping = await prisma.ping.findUnique({ where: { id: res.body.ping_id } });
    const payload = ping!.payload as Record<string, unknown>;
    expect(payload.first_name).toBeUndefined();
    expect(payload.phone).toBeUndefined();
    expect(payload.email).toBeUndefined();
    expect(payload.fleet_size).toBe(12);
  });

  it('returns no_bid with explained rejections when nothing matches', async () => {
    const res = await call('/api/ping', {
      body: { vertical: VERTICAL_KEY, state: 'WY', zip: '82001', fleet_size: 1, lease_term: 'short', certified: false },
      apiKey: API_KEY,
    });

    expect(res.body.status).toBe('no_bid');
    expect(res.body.winner).toBeNull();
    expect(res.body.offers).toEqual([]);
    const reasons = res.body.rejected.map((r: any) => r.reason).sort();
    expect(reasons).toEqual(['filter:fleet_size', 'geo_state', 'geo_state']);
  });

  it('validates attributes against the vertical field schema', async () => {
    const missing = await call('/api/ping', {
      body: { vertical: VERTICAL_KEY, state: 'CA', fleet_size: 4 },
      apiKey: API_KEY,
    });
    expect(missing.status).toBe(400);
    expect(missing.body.details.map((d: any) => d.field)).toContain('lease_term');

    const badEnum = await call('/api/ping', {
      body: { vertical: VERTICAL_KEY, state: 'CA', fleet_size: 4, lease_term: 'forever' },
      apiKey: API_KEY,
    });
    expect(badEnum.status).toBe(400);
  });

  it('404s an unknown vertical', async () => {
    const res = await call('/api/ping', {
      body: { vertical: 'no_such_vertical', state: 'CA' },
      apiKey: API_KEY,
    });
    expect(res.status).toBe(404);
  });
});

describe('post → award → deliver', () => {
  const fullLead = {
    first_name: 'Jane',
    last_name: 'Doe',
    phone: '(555) 010-1234',
    email: 'jane.doe@example.com',
    address: '1 Main St',
    state: 'CA',
    zip: '90210',
    fleet_size: 12,
    lease_term: 'long',
    certified: true,
  };

  it('sells to the winning bidder and delivers the full lead including PII', async () => {
    const ping = await call('/api/ping', { body: qualifyingPing, apiKey: API_KEY });
    const post = await call('/api/post', {
      body: { ping_id: ping.body.ping_id, ...fullLead },
      apiKey: API_KEY,
    });

    expect(post.status).toBe(200);
    expect(post.body.accepted).toBe(true);
    expect(post.body.status).toBe('delivered');
    expect(post.body.price).toBe(90);
    expect(post.body.sold_to.campaign_id).toBe(topBidderCampaignId);
    expect(post.body.delivery.outcome).toBe('delivered');

    // The buyer's endpoint actually received the PII.
    const delivered = receivedByBuyer.get('primary') ?? [];
    expect(delivered).toHaveLength(1);
    expect(delivered[0].contentType).toContain('application/json');
    const payload = JSON.parse(delivered[0].raw);
    expect(payload).toMatchObject({
      first_name: 'Jane',
      last_name: 'Doe',
      phone: '(555) 010-1234',
      email: 'jane.doe@example.com',
      address: '1 Main St',
      state: 'CA',
      zip: '90210',
      price: 90,
      vertical: VERTICAL_KEY,
    });

    const lead = await prisma.lead.findUnique({ where: { id: post.body.lead_id } });
    expect(lead?.status).toBe('delivered');
    expect(Number(lead?.price)).toBe(90);
    expect(lead?.campaignId).toBe(topBidderCampaignId);
    expect(lead?.phoneHash).toMatch(/^[0-9a-f]{64}$/);

    const ping2 = await prisma.ping.findUnique({ where: { id: ping.body.ping_id } });
    expect(ping2?.status).toBe('posted');
  });

  it('honours an explicit campaign_id chosen from the offers', async () => {
    const ping = await call('/api/ping', { body: qualifyingPing, apiKey: API_KEY });
    const post = await call('/api/post', {
      body: { ping_id: ping.body.ping_id, campaign_id: preferredCampaignId, ...fullLead },
      apiKey: API_KEY,
    });

    expect(post.body.sold_to.campaign_id).toBe(preferredCampaignId);
    expect(post.body.price).toBe(40);

    // That buyer takes form-encoded bodies through a field mapping.
    const delivered = receivedByBuyer.get('primary') ?? [];
    expect(delivered[0].contentType).toContain('application/x-www-form-urlencoded');
    const params = new URLSearchParams(delivered[0].raw);
    expect(params.get('LeadRef')).toBe(post.body.lead_id);
    expect(params.get('Zip')).toBe('90210');
    expect(params.get('Size')).toBe('12');
    // The mapping is an allow-list: unmapped PII must not leak to this buyer.
    expect(params.get('first_name')).toBeNull();
  });

  it('rejects a campaign_id that was not among the offers', async () => {
    const ping = await call('/api/ping', { body: qualifyingPing, apiKey: API_KEY });
    const other = await prisma.campaign.findFirst({ where: { verticalId: { not: verticalId } } });
    const post = await call('/api/post', {
      body: {
        ping_id: ping.body.ping_id,
        campaign_id: other?.id ?? '00000000-0000-0000-0000-000000000000',
        ...fullLead,
      },
      apiKey: API_KEY,
    });
    expect(post.status).toBe(400);
  });

  it('records delivery_failure when the buyer endpoint rejects', async () => {
    const ping = await call('/api/ping', { body: qualifyingPing, apiKey: API_KEY });
    const post = await call('/api/post', {
      body: { ping_id: ping.body.ping_id, campaign_id: brokenCampaignId, ...fullLead },
      apiKey: API_KEY,
    });

    expect(post.body.accepted).toBe(true);
    expect(post.body.status).toBe('delivery_failed');
    expect(post.body.delivery.status).toBe(422);
    // 422 is permanent — it must not be retried.
    expect(post.body.delivery.attempts).toBe(1);

    const lead = await prisma.lead.findUnique({ where: { id: post.body.lead_id } });
    expect(lead?.status).toBe('delivery_failed');
    // The sale still stands; the operator can redeliver.
    expect(Number(lead?.price)).toBe(75);
  });

  it('requires a ping_id, and refuses an unknown one', async () => {
    expect((await call('/api/post', { body: fullLead, apiKey: API_KEY })).status).toBe(400);
    expect(
      (
        await call('/api/post', {
          body: { ping_id: '00000000-0000-0000-0000-000000000000', ...fullLead },
          apiKey: API_KEY,
        })
      ).status
    ).toBe(404);
  });

  it('refuses to post the same ping twice', async () => {
    const ping = await call('/api/ping', { body: qualifyingPing, apiKey: API_KEY });
    await call('/api/post', { body: { ping_id: ping.body.ping_id, ...fullLead }, apiKey: API_KEY });
    const second = await call('/api/post', {
      body: { ping_id: ping.body.ping_id, ...fullLead, phone: '5550109999', email: 'other@example.com' },
      apiKey: API_KEY,
    });
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/already been posted/i);
  });

  it('refuses to post against a no_bid ping', async () => {
    const ping = await call('/api/ping', {
      body: { vertical: VERTICAL_KEY, state: 'WY', zip: '82001', fleet_size: 1, lease_term: 'short' },
      apiKey: API_KEY,
    });
    expect(ping.body.status).toBe('no_bid');
    const post = await call('/api/post', {
      body: { ping_id: ping.body.ping_id, ...fullLead },
      apiKey: API_KEY,
    });
    expect(post.status).toBe(400);
    expect(post.body.error).toMatch(/no bids/i);
  });

  it('refuses to post against an expired ping', async () => {
    const ping = await call('/api/ping', { body: qualifyingPing, apiKey: API_KEY });
    await prisma.ping.update({
      where: { id: ping.body.ping_id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const post = await call('/api/post', {
      body: { ping_id: ping.body.ping_id, ...fullLead },
      apiKey: API_KEY,
    });
    expect(post.status).toBe(409);
    expect(post.body.error).toMatch(/expired/i);

    const stored = await prisma.ping.findUnique({ where: { id: ping.body.ping_id } });
    expect(stored?.status).toBe('expired');
  });

  it('refuses to post a ping belonging to a different source', async () => {
    const other = await prisma.source.create({
      data: { name: 'Test Other Source', apiKey: `${API_KEY}_other` },
    });
    const ping = await call('/api/ping', { body: qualifyingPing, apiKey: API_KEY });
    const post = await call('/api/post', {
      body: { ping_id: ping.body.ping_id, ...fullLead },
      apiKey: other.apiKey,
    });
    expect(post.status).toBe(400);
    await prisma.source.delete({ where: { id: other.id } });
  });
});

describe('deduplication', () => {
  const lead = {
    first_name: 'Sam',
    last_name: 'Rivera',
    phone: '555-010-7777',
    email: 'sam.rivera@example.com',
    state: 'CA',
    zip: '90210',
    fleet_size: 12,
    lease_term: 'long',
    certified: true,
  };

  async function sell(overrides: Record<string, unknown> = {}) {
    const ping = await call('/api/ping', { body: qualifyingPing, apiKey: API_KEY });
    return call('/api/post', {
      body: { ping_id: ping.body.ping_id, ...lead, ...overrides },
      apiKey: API_KEY,
    });
  }

  it('rejects a second post with the same phone in the same vertical', async () => {
    expect((await sell()).body.accepted).toBe(true);

    // Same number, different formatting and a different email.
    const dup = await sell({ phone: '+1 (555) 010-7777', email: 'different@example.com' });
    expect(dup.body.accepted).toBe(false);
    expect(dup.body.status).toBe('rejected_dup');
    expect(dup.body.reason).toBe('duplicate_phone');
    expect(dup.body.price).toBe(0);
    expect(dup.body.sold_to).toBeNull();
  });

  it('rejects a second post with the same email', async () => {
    await sell();
    const dup = await sell({ phone: '555-010-8888', email: 'SAM.RIVERA@EXAMPLE.COM' });
    expect(dup.body.status).toBe('rejected_dup');
    expect(dup.body.reason).toBe('duplicate_email');
  });

  it('accepts a genuinely different lead', async () => {
    await sell();
    const fresh = await sell({ phone: '555-010-2222', email: 'someone.else@example.com' });
    expect(fresh.body.accepted).toBe(true);
    expect(fresh.body.status).toBe('delivered');
  });

  it('does not dedup when the window is set to 0', async () => {
    await sell();
    await resetSettings({ [SETTING_KEYS.dedupWindowDays]: '0' });
    const dup = await sell();
    expect(dup.body.accepted).toBe(true);
  });

  it('does not dedup across verticals', async () => {
    await sell();
    const otherVertical = await prisma.vertical.create({
      data: {
        key: `${VERTICAL_KEY}_other`,
        name: 'Other test vertical',
        fieldSchema: [] as unknown as Prisma.InputJsonValue,
      },
    });
    const buyer = await prisma.buyer.create({
      data: { name: 'Test Cross Vertical Buyer', deliveryUrl: buyerUrl },
    });
    await prisma.campaign.create({
      data: {
        buyerId: buyer.id,
        verticalId: otherVertical.id,
        name: 'Cross vertical catch-all',
        bid: new Prisma.Decimal('10.00'),
      },
    });

    const ping = await call('/api/ping', {
      body: { vertical: otherVertical.key, state: 'CA', zip: '90210' },
      apiKey: API_KEY,
    });
    const post = await call('/api/post', {
      body: { ping_id: ping.body.ping_id, ...lead },
      apiKey: API_KEY,
    });
    expect(post.body.accepted).toBe(true);

    await prisma.lead.deleteMany({ where: { verticalId: otherVertical.id } });
    await prisma.ping.deleteMany({ where: { verticalId: otherVertical.id } });
    await prisma.campaign.deleteMany({ where: { verticalId: otherVertical.id } });
    await prisma.vertical.delete({ where: { id: otherVertical.id } });
    await prisma.buyer.delete({ where: { id: buyer.id } });
  });
});

describe('routing strategy', () => {
  it('changing the strategy changes who wins the same ping', async () => {
    const byBid = await call('/api/ping', { body: qualifyingPing, apiKey: API_KEY });
    expect(byBid.body.routing_strategy).toBe('bid');
    expect(byBid.body.winner.campaign_id).toBe(topBidderCampaignId);
    expect(byBid.body.winner.bid).toBe(90);

    await resetSettings({ [SETTING_KEYS.routingStrategy]: 'priority' });

    const byPriority = await call('/api/ping', { body: qualifyingPing, apiKey: API_KEY });
    expect(byPriority.body.routing_strategy).toBe('priority');
    expect(byPriority.body.winner.campaign_id).toBe(preferredCampaignId);
    expect(byPriority.body.winner.routing_priority).toBe(1);

    // Same three campaigns bid either way — only the order changed.
    expect(byPriority.body.matched).toBe(3);
  });

  it('round_robin rotates the winner across consecutive pings', async () => {
    await resetSettings({ [SETTING_KEYS.routingStrategy]: 'round_robin' });

    const winners: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const res = await call('/api/ping', { body: qualifyingPing, apiKey: API_KEY });
      winners.push(res.body.winner.campaign_id);
    }

    // Every accepting campaign takes a turn, and the cycle repeats.
    expect(new Set(winners).size).toBe(3);
    expect(winners.slice(0, 3)).toEqual(winners.slice(3, 6));
  });

  it('caps are enforced at ping time', async () => {
    await prisma.campaign.update({
      where: { id: topBidderCampaignId },
      data: { dailyCap: 1 },
    });

    const first = await call('/api/ping', { body: qualifyingPing, apiKey: API_KEY });
    expect(first.body.winner.campaign_id).toBe(topBidderCampaignId);
    await call('/api/post', {
      body: {
        ping_id: first.body.ping_id,
        phone: '555-010-3333',
        email: 'cap.test@example.com',
        state: 'CA',
        zip: '90210',
        fleet_size: 12,
        lease_term: 'long',
        certified: true,
      },
      apiKey: API_KEY,
    });

    const second = await call('/api/ping', { body: qualifyingPing, apiKey: API_KEY });
    expect(second.body.winner.campaign_id).not.toBe(topBidderCampaignId);
    expect(
      second.body.rejected.find((r: any) => r.campaign_id === topBidderCampaignId)
    ).toMatchObject({ reason: 'daily_cap', detail: '1/1' });

    await prisma.campaign.update({ where: { id: topBidderCampaignId }, data: { dailyCap: 0 } });
  });
});

describe('health', () => {
  it('reports the database is reachable', async () => {
    const res = await fetch(`${apiBase}/health`);
    expect(res.status).toBe(200);
    expect((await res.json()).db).toBe('up');
  });
});
