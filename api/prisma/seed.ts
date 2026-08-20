/**
 * Seed data.
 *
 * IMPORTANT: everything below is *illustrative*. The two verticals exist only to
 * prove that the platform is configuration-driven — a home-services niche and an
 * insurance niche share zero code, differing only in their `fieldSchema` rows.
 * Delete them and define your own from the dashboard; nothing in the engine
 * knows either one exists.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { Prisma, PrismaClient } from '@prisma/client';
import { SETTING_KEYS, DEFAULT_SETTINGS } from '../src/settings';

const prisma = new PrismaClient();

const API_BASE = process.env.API_BASE_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;

/**
 * Fixed keys so `requests.http` works immediately after seeding.
 * ROTATE THEM from Sources → Rotate key before this touches a real network.
 */
const SEED_API_KEYS = {
  acme: 'lgs_seed_acme_5f3a9c21d84b47e0aa16',
  partner: 'lgs_seed_partner_2b7e4d10c96f38a5bb42',
};

async function main(): Promise<void> {
  // ---------------------------------------------------------------- settings
  const settings: [string, string][] = [
    [SETTING_KEYS.routingStrategy, DEFAULT_SETTINGS.routingStrategy],
    [SETTING_KEYS.dedupWindowDays, String(DEFAULT_SETTINGS.dedupWindowDays)],
    [SETTING_KEYS.pingTtlSeconds, String(DEFAULT_SETTINGS.pingTtlSeconds)],
    [SETTING_KEYS.timezone, DEFAULT_SETTINGS.timezone],
    [SETTING_KEYS.defaultPhoneRegion, DEFAULT_SETTINGS.defaultPhoneRegion],
  ];
  for (const [key, value] of settings) {
    await prisma.setting.upsert({ where: { key }, create: { key, value }, update: {} });
  }

  // ------------------------------------------------------------- admin user
  const email = (process.env.SEED_ADMIN_EMAIL ?? 'admin@leadgen.local').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'admin12345';
  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.adminUser.upsert({
    where: { email },
    create: { email, passwordHash },
    update: { passwordHash },
  });

  // -------------------------------------------------------------- verticals
  // EXAMPLE ONE: a home-services niche.
  const homeImprovement = await prisma.vertical.upsert({
    where: { key: 'home_improvement' },
    update: {},
    create: {
      key: 'home_improvement',
      name: 'Home Improvement',
      active: true,
      fieldSchema: [
        { name: 'homeowner', label: 'Homeowner', type: 'boolean', required: true },
        { name: 'property_age', label: 'Property Age (years)', type: 'number', required: false },
        {
          name: 'timeline',
          label: 'Timeline',
          type: 'enum',
          required: true,
          options: ['immediately', '1_3_months', '3_6_months', 'researching'],
        },
        {
          name: 'project_type',
          label: 'Project Type',
          type: 'enum',
          required: false,
          options: ['roofing', 'windows', 'solar', 'hvac', 'bath'],
        },
      ] as unknown as Prisma.InputJsonValue,
    },
  });

  // EXAMPLE TWO: an insurance niche. Deliberately unlike the first — different
  // field names, different types — to show the engine treats both identically.
  const insurance = await prisma.vertical.upsert({
    where: { key: 'insurance' },
    update: {},
    create: {
      key: 'insurance',
      name: 'Insurance',
      active: true,
      fieldSchema: [
        {
          name: 'coverage_type',
          label: 'Coverage Type',
          type: 'enum',
          required: true,
          options: ['auto', 'home', 'life', 'health'],
        },
        { name: 'current_insurer', label: 'Current Insurer', type: 'text', required: false },
        {
          name: 'monthly_premium',
          label: 'Monthly Premium ($)',
          type: 'number',
          required: false,
        },
      ] as unknown as Prisma.InputJsonValue,
    },
  });

  // ---------------------------------------------------------------- sources
  const acme = await prisma.source.upsert({
    where: { apiKey: SEED_API_KEYS.acme },
    update: { name: 'Acme Lead Network', active: true },
    create: { name: 'Acme Lead Network', apiKey: SEED_API_KEYS.acme, active: true },
  });
  const partner = await prisma.source.upsert({
    where: { apiKey: SEED_API_KEYS.partner },
    update: { name: 'Partner Web Forms', active: true },
    create: { name: 'Partner Web Forms', apiKey: SEED_API_KEYS.partner, active: true },
  });

  // ----------------------------------------------------------------- buyers
  // Every buyer here points at the bundled local mock endpoint so the full
  // ping → post → deliver loop works with no external service. Swap the URL for
  // a real one and nothing else changes: delivery is just a webhook.
  async function upsertBuyer(
    name: string,
    data: Omit<Prisma.BuyerCreateInput, 'name'>
  ) {
    const existing = await prisma.buyer.findFirst({ where: { name } });
    if (existing) return prisma.buyer.update({ where: { id: existing.id }, data });
    return prisma.buyer.create({ data: { name, ...data } });
  }

  const apex = await upsertBuyer('Apex Home Solutions', {
    active: true,
    deliveryUrl: `${API_BASE}/mock/buyer/apex`,
    deliveryMethod: 'json',
    deliveryHeaders: { 'X-Partner-Token': 'demo-token-apex' },
    fieldMapping: {},
  });

  const summit = await upsertBuyer('Summit Roofing Group', {
    active: true,
    // Same platform, different wire format — form-encoded instead of JSON.
    deliveryUrl: `${API_BASE}/mock/buyer/summit`,
    deliveryMethod: 'form',
    deliveryHeaders: {},
    fieldMapping: {},
  });

  const northstar = await upsertBuyer('Northstar Exteriors', {
    active: true,
    deliveryUrl: `${API_BASE}/mock/buyer/northstar`,
    deliveryMethod: 'xml',
    deliveryHeaders: {},
    fieldMapping: {},
  });

  const guardian = await upsertBuyer('Guardian Insurance Partners', {
    active: true,
    deliveryUrl: `${API_BASE}/mock/buyer/guardian`,
    deliveryMethod: 'json',
    deliveryHeaders: { Authorization: 'Bearer demo-token-guardian' },
    // A field mapping doubles as an allow-list: only these keys are sent, under
    // the names this buyer's CRM expects.
    fieldMapping: {
      LeadID: 'lead_id',
      FirstName: 'first_name',
      LastName: 'last_name',
      Phone: 'phone',
      Email: 'email',
      State: 'state',
      PostalCode: 'zip',
      Product: 'coverage_type',
      CurrentCarrier: 'current_insurer',
      Premium: 'monthly_premium',
      Cost: 'price',
    },
  });

  const beacon = await upsertBuyer('Beacon Coverage Co', {
    active: true,
    deliveryUrl: `${API_BASE}/mock/buyer/beacon`,
    deliveryMethod: 'json',
    deliveryHeaders: {},
    fieldMapping: {},
  });

  // No deliveryUrl: leads are marked `sold` and wait for manual pickup via the
  // Leads page or GET /api/leads.
  const legacy = await upsertBuyer('Legacy Buyer (manual pickup)', {
    active: true,
    deliveryUrl: null,
    deliveryMethod: 'json',
    deliveryHeaders: {},
    fieldMapping: {},
  });

  // -------------------------------------------------------------- campaigns
  async function upsertCampaign(name: string, data: Omit<Prisma.CampaignUncheckedCreateInput, 'name'>) {
    const existing = await prisma.campaign.findFirst({ where: { name } });
    if (existing) return prisma.campaign.update({ where: { id: existing.id }, data });
    return prisma.campaign.create({ data: { name, ...data } });
  }

  // --- Home Improvement: bids and priorities deliberately disagree, so
  // --- switching the routing strategy visibly changes the winner.
  await upsertCampaign('Nationwide Homeowners', {
    buyerId: apex.id,
    verticalId: homeImprovement.id,
    active: true,
    bid: new Prisma.Decimal('42.50'),
    routingPriority: 10, // preferred buyer under the `priority` strategy
    states: [],
    zips: [],
    filters: [{ field: 'homeowner', op: 'eq', value: true }] as unknown as Prisma.InputJsonValue,
    dailyCap: 0,
    monthlyCap: 0,
    concurrencyCap: 0,
    schedule: {} as Prisma.InputJsonValue,
  });

  await upsertCampaign('Premium Immediate Projects', {
    buyerId: northstar.id,
    verticalId: homeImprovement.id,
    active: true,
    bid: new Prisma.Decimal('68.00'), // top bid under the `bid` strategy
    routingPriority: 20,
    states: ['CA', 'TX', 'FL', 'NY', 'AZ'],
    zips: [],
    filters: [
      { field: 'homeowner', op: 'eq', value: true },
      { field: 'timeline', op: 'in', value: ['immediately', '1_3_months'] },
    ] as unknown as Prisma.InputJsonValue,
    dailyCap: 25,
    monthlyCap: 400,
    concurrencyCap: 0,
    schedule: {} as Prisma.InputJsonValue,
  });

  await upsertCampaign('West Coast Roofing', {
    buyerId: summit.id,
    verticalId: homeImprovement.id,
    active: true,
    bid: new Prisma.Decimal('55.00'),
    routingPriority: 90,
    states: ['CA', 'OR', 'WA', 'NV'],
    zips: [],
    filters: [
      { field: 'homeowner', op: 'eq', value: true },
      { field: 'property_age', op: 'gte', value: 10 },
    ] as unknown as Prisma.InputJsonValue,
    dailyCap: 0,
    monthlyCap: 0,
    concurrencyCap: 0,
    schedule: {} as Prisma.InputJsonValue,
  });

  // Demonstrates dayparting: only bids on weekday evenings.
  await upsertCampaign('Evening Bath Remodels', {
    buyerId: apex.id,
    verticalId: homeImprovement.id,
    active: true,
    bid: new Prisma.Decimal('61.00'),
    routingPriority: 40,
    states: [],
    zips: [],
    filters: [{ field: 'project_type', op: 'eq', value: 'bath' }] as unknown as Prisma.InputJsonValue,
    dailyCap: 0,
    monthlyCap: 0,
    concurrencyCap: 0,
    schedule: { days: [1, 2, 3, 4, 5], start: '18:00', end: '23:00' } as Prisma.InputJsonValue,
  });

  // Demonstrates the manual-pickup path (buyer has no delivery endpoint).
  await upsertCampaign('Overflow Manual Pickup', {
    buyerId: legacy.id,
    verticalId: homeImprovement.id,
    active: true,
    bid: new Prisma.Decimal('18.00'),
    routingPriority: 500,
    states: [],
    zips: [],
    filters: [{ field: 'homeowner', op: 'eq', value: true }] as unknown as Prisma.InputJsonValue,
    dailyCap: 0,
    monthlyCap: 0,
    concurrencyCap: 0,
    schedule: {} as Prisma.InputJsonValue,
  });

  // --- Insurance: same engine, entirely different field vocabulary.
  await upsertCampaign('Auto Coverage Switchers', {
    buyerId: guardian.id,
    verticalId: insurance.id,
    active: true,
    bid: new Prisma.Decimal('33.00'),
    routingPriority: 30,
    states: [],
    zips: [],
    filters: [
      { field: 'coverage_type', op: 'eq', value: 'auto' },
      { field: 'monthly_premium', op: 'gte', value: 80 },
    ] as unknown as Prisma.InputJsonValue,
    dailyCap: 0,
    monthlyCap: 0,
    concurrencyCap: 0,
    schedule: {} as Prisma.InputJsonValue,
  });

  await upsertCampaign('Multi-line National', {
    buyerId: beacon.id,
    verticalId: insurance.id,
    active: true,
    bid: new Prisma.Decimal('27.50'),
    routingPriority: 5, // wins on `priority` while losing on `bid`
    states: [],
    zips: [],
    filters: [
      { field: 'coverage_type', op: 'in', value: ['auto', 'home'] },
    ] as unknown as Prisma.InputJsonValue,
    dailyCap: 0,
    monthlyCap: 0,
    concurrencyCap: 0,
    schedule: {} as Prisma.InputJsonValue,
  });

  await upsertCampaign('High-Value Home Coverage', {
    buyerId: guardian.id,
    verticalId: insurance.id,
    active: true,
    bid: new Prisma.Decimal('45.00'),
    routingPriority: 70,
    states: ['CA', 'TX', 'FL'],
    zips: [],
    filters: [
      { field: 'coverage_type', op: 'eq', value: 'home' },
    ] as unknown as Prisma.InputJsonValue,
    dailyCap: 0,
    monthlyCap: 0,
    concurrencyCap: 0,
    schedule: {} as Prisma.InputJsonValue,
  });

  // Demonstrates a daily cap.
  await upsertCampaign('Health Plans (capped)', {
    buyerId: beacon.id,
    verticalId: insurance.id,
    active: true,
    bid: new Prisma.Decimal('52.00'),
    routingPriority: 60,
    states: [],
    zips: [],
    filters: [
      { field: 'coverage_type', op: 'eq', value: 'health' },
    ] as unknown as Prisma.InputJsonValue,
    dailyCap: 5,
    monthlyCap: 100,
    concurrencyCap: 0,
    schedule: {} as Prisma.InputJsonValue,
  });

  // ------------------------------------------------------------------ output
  const [verticalCount, buyerCount, campaignCount] = await Promise.all([
    prisma.vertical.count(),
    prisma.buyer.count(),
    prisma.campaign.count(),
  ]);

  const line = '─'.repeat(74);
  console.log(`\n${line}`);
  console.log('  Lead Distribution CRM — seed complete');
  console.log(line);
  console.log('\n  ADMIN DASHBOARD LOGIN   (http://localhost:5173)');
  console.log(`    email     ${email}`);
  console.log(`    password  ${password}`);
  console.log('\n  SOURCE API KEYS         (send as the X-Api-Key header)');
  console.log(`    ${acme.name.padEnd(22)} ${acme.apiKey}`);
  console.log(`    ${partner.name.padEnd(22)} ${partner.apiKey}`);
  console.log('\n  SEEDED');
  console.log(`    ${verticalCount} verticals · ${buyerCount} buyers · ${campaignCount} campaigns · 2 sources`);
  console.log('    Verticals: home_improvement, insurance');
  console.log(`    Buyer webhooks point at ${API_BASE}/mock/buyer/* (bundled mock buyer).`);
  console.log('\n  NOTE');
  console.log('    The two verticals are EXAMPLES ONLY. Nothing in the engine knows about');
  console.log('    home improvement or insurance — they are plain rows with a fieldSchema.');
  console.log('    Delete them and define your own niches under Verticals in the dashboard.');
  console.log('\n  SECURITY');
  console.log('    These API keys and this password are fixed seed values, committed to the');
  console.log('    repo. Rotate the keys (Sources → Rotate key) and change the password');
  console.log('    before this instance is reachable from anywhere but localhost.');
  console.log(`\n${line}\n`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
