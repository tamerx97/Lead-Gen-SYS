import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { asyncHandler } from '../errors';
import { getSettings } from '../settings';
import { formatLocalDayKey, localDayKeys, startOfLocalDay } from '../services/time';

export const statsRouter = Router();

const SOLD_STATUSES = ['sold', 'delivered', 'delivery_failed'] as const;

const rangeSchema = z.object({
  verticalId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  days: z.coerce.number().int().min(1).max(365).optional().default(30),
});

function resolveRange(q: z.infer<typeof rangeSchema>): { from: Date; to: Date } {
  const to = q.to ?? new Date();
  const from = q.from ?? new Date(to.getTime() - (q.days - 1) * 24 * 60 * 60 * 1000);
  return { from, to };
}

/**
 * Headline KPIs: revenue (today and for the range), leads sold, ping volume, and
 * the fill rate — the share of pings that drew at least one bid.
 */
statsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = rangeSchema.parse(req.query);
    const { from, to } = resolveRange(q);
    const settings = await getSettings();
    const todayStart = startOfLocalDay(new Date(), settings.timezone);

    const verticalWhere = q.verticalId ? { verticalId: q.verticalId } : {};
    const soldWhere = { ...verticalWhere, status: { in: [...SOLD_STATUSES] } };

    const [
      revenueAll,
      revenueToday,
      revenueRange,
      leadsAll,
      leadsToday,
      leadsRange,
      pingsRange,
      pingsNoBid,
      pingsToday,
      dupsRange,
      deliveredRange,
      failedRange,
    ] = await Promise.all([
      prisma.lead.aggregate({ where: soldWhere, _sum: { price: true } }),
      prisma.lead.aggregate({
        where: { ...soldWhere, createdAt: { gte: todayStart } },
        _sum: { price: true },
      }),
      prisma.lead.aggregate({
        where: { ...soldWhere, createdAt: { gte: from, lte: to } },
        _sum: { price: true },
      }),
      prisma.lead.count({ where: soldWhere }),
      prisma.lead.count({ where: { ...soldWhere, createdAt: { gte: todayStart } } }),
      prisma.lead.count({ where: { ...soldWhere, createdAt: { gte: from, lte: to } } }),
      prisma.ping.count({ where: { ...verticalWhere, createdAt: { gte: from, lte: to } } }),
      prisma.ping.count({
        where: { ...verticalWhere, status: 'no_bid', createdAt: { gte: from, lte: to } },
      }),
      prisma.ping.count({ where: { ...verticalWhere, createdAt: { gte: todayStart } } }),
      prisma.lead.count({
        where: { ...verticalWhere, status: 'rejected_dup', createdAt: { gte: from, lte: to } },
      }),
      prisma.lead.count({
        where: { ...verticalWhere, status: 'delivered', createdAt: { gte: from, lte: to } },
      }),
      prisma.lead.count({
        where: { ...verticalWhere, status: 'delivery_failed', createdAt: { gte: from, lte: to } },
      }),
    ]);

    const matchedPings = pingsRange - pingsNoBid;

    res.json({
      range: { from: from.toISOString(), to: to.toISOString() },
      revenue: {
        total: Number(revenueAll._sum.price ?? 0),
        today: Number(revenueToday._sum.price ?? 0),
        range: Number(revenueRange._sum.price ?? 0),
      },
      leads: {
        total: leadsAll,
        today: leadsToday,
        range: leadsRange,
        delivered: deliveredRange,
        deliveryFailed: failedRange,
        duplicates: dupsRange,
      },
      pings: {
        range: pingsRange,
        today: pingsToday,
        noBid: pingsNoBid,
        matched: matchedPings,
      },
      rates: {
        // Share of pings that drew at least one bid.
        fillRate: pingsRange > 0 ? matchedPings / pingsRange : 0,
        noBidRate: pingsRange > 0 ? pingsNoBid / pingsRange : 0,
        // Share of matched pings that actually converted into a sale.
        conversionRate: matchedPings > 0 ? leadsRange / matchedPings : 0,
        deliveryRate: leadsRange > 0 ? deliveredRange / leadsRange : 0,
      },
      averagePrice: leadsRange > 0 ? Number(revenueRange._sum.price ?? 0) / leadsRange : 0,
    });
  })
);

/** Daily revenue / volume / fill-rate series for the Overview charts. */
statsRouter.get(
  '/timeseries',
  asyncHandler(async (req, res) => {
    const q = rangeSchema.parse(req.query);
    const { from, to } = resolveRange(q);
    const settings = await getSettings();
    const tz = settings.timezone;

    const verticalWhere = q.verticalId ? { verticalId: q.verticalId } : {};

    const [leads, pings] = await Promise.all([
      prisma.lead.findMany({
        where: {
          ...verticalWhere,
          status: { in: [...SOLD_STATUSES] },
          createdAt: { gte: startOfLocalDay(from, tz), lte: to },
        },
        select: { createdAt: true, price: true },
      }),
      prisma.ping.findMany({
        where: { ...verticalWhere, createdAt: { gte: startOfLocalDay(from, tz), lte: to } },
        select: { createdAt: true, status: true },
      }),
    ]);

    const buckets = new Map<string, { date: string; revenue: number; leads: number; pings: number; matched: number }>();
    for (const key of localDayKeys(from, to, tz)) {
      buckets.set(key, { date: key, revenue: 0, leads: 0, pings: 0, matched: 0 });
    }

    for (const lead of leads) {
      const key = formatLocalDayKey(lead.createdAt, tz);
      const bucket = buckets.get(key);
      if (!bucket) continue;
      bucket.revenue += Number(lead.price);
      bucket.leads += 1;
    }
    for (const ping of pings) {
      const key = formatLocalDayKey(ping.createdAt, tz);
      const bucket = buckets.get(key);
      if (!bucket) continue;
      bucket.pings += 1;
      if (ping.status !== 'no_bid') bucket.matched += 1;
    }

    res.json(
      [...buckets.values()].map((b) => ({
        ...b,
        revenue: Math.round(b.revenue * 100) / 100,
        fillRate: b.pings > 0 ? b.matched / b.pings : 0,
      }))
    );
  })
);

type Rollup = {
  id: string;
  name: string;
  leads: number;
  revenue: number;
  averagePrice: number;
  extra?: Record<string, unknown>;
};

/**
 * Rollups by buyer / campaign / source / vertical for the reporting tables.
 * `GET /api/stats/rollup?by=buyer&days=30`
 */
statsRouter.get(
  '/rollup',
  asyncHandler(async (req, res) => {
    const schema = rangeSchema.extend({
      by: z.enum(['buyer', 'campaign', 'source', 'vertical']).optional().default('buyer'),
      limit: z.coerce.number().int().min(1).max(100).optional().default(20),
    });
    const q = schema.parse(req.query);
    const { from, to } = resolveRange(q);

    const where = {
      ...(q.verticalId ? { verticalId: q.verticalId } : {}),
      status: { in: [...SOLD_STATUSES] },
      createdAt: { gte: from, lte: to },
    };

    const byField = {
      buyer: 'buyerId',
      campaign: 'campaignId',
      source: 'sourceId',
      vertical: 'verticalId',
    }[q.by] as 'buyerId' | 'campaignId' | 'sourceId' | 'verticalId';

    const grouped = await prisma.lead.groupBy({
      by: [byField],
      where,
      _sum: { price: true },
      _count: { _all: true },
    });

    const ids = grouped.map((g) => g[byField]).filter((id): id is string => !!id);

    const names = new Map<string, string>();
    if (q.by === 'buyer') {
      for (const b of await prisma.buyer.findMany({ where: { id: { in: ids } } })) names.set(b.id, b.name);
    } else if (q.by === 'campaign') {
      for (const c of await prisma.campaign.findMany({
        where: { id: { in: ids } },
        include: { buyer: true },
      })) {
        names.set(c.id, `${c.name} — ${c.buyer.name}`);
      }
    } else if (q.by === 'source') {
      for (const s of await prisma.source.findMany({ where: { id: { in: ids } } })) names.set(s.id, s.name);
    } else {
      for (const v of await prisma.vertical.findMany({ where: { id: { in: ids } } })) names.set(v.id, v.name);
    }

    // Sources also get their ping volume and fill rate.
    const sourcePingStats = new Map<string, { pings: number; matched: number }>();
    if (q.by === 'source') {
      const pings = await prisma.ping.groupBy({
        by: ['sourceId', 'status'],
        where: {
          ...(q.verticalId ? { verticalId: q.verticalId } : {}),
          createdAt: { gte: from, lte: to },
        },
        _count: { _all: true },
      });
      for (const row of pings) {
        const entry = sourcePingStats.get(row.sourceId) ?? { pings: 0, matched: 0 };
        entry.pings += row._count._all;
        if (row.status !== 'no_bid') entry.matched += row._count._all;
        sourcePingStats.set(row.sourceId, entry);
      }
    }

    const rows: Rollup[] = grouped
      .filter((g) => !!g[byField])
      .map((g) => {
        const id = g[byField] as string;
        const revenue = Number(g._sum.price ?? 0);
        const leads = g._count._all;
        const stats = sourcePingStats.get(id);
        return {
          id,
          name: names.get(id) ?? '(deleted)',
          leads,
          revenue: Math.round(revenue * 100) / 100,
          averagePrice: leads > 0 ? Math.round((revenue / leads) * 100) / 100 : 0,
          ...(stats
            ? {
                extra: {
                  pings: stats.pings,
                  fillRate: stats.pings > 0 ? stats.matched / stats.pings : 0,
                },
              }
            : {}),
        };
      })
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, q.limit);

    // A source with pings but no sales still belongs in the report.
    if (q.by === 'source') {
      for (const [id, stats] of sourcePingStats) {
        if (rows.some((r) => r.id === id)) continue;
        const source = await prisma.source.findUnique({ where: { id } });
        rows.push({
          id,
          name: source?.name ?? '(deleted)',
          leads: 0,
          revenue: 0,
          averagePrice: 0,
          extra: { pings: stats.pings, fillRate: stats.pings > 0 ? stats.matched / stats.pings : 0 },
        });
      }
    }

    res.json({ by: q.by, range: { from: from.toISOString(), to: to.toISOString() }, rows });
  })
);
