import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { asyncHandler, notFound } from '../errors';

export const leadsRouter = Router();

const querySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).optional().default(25),
  buyerId: z.string().uuid().optional(),
  campaignId: z.string().uuid().optional(),
  verticalId: z.string().uuid().optional(),
  sourceId: z.string().uuid().optional(),
  status: z.enum(['sold', 'delivered', 'delivery_failed', 'rejected_dup']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  q: z.string().trim().max(200).optional(),
});

leadsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = querySchema.parse(req.query);

    const where = {
      ...(q.buyerId ? { buyerId: q.buyerId } : {}),
      ...(q.campaignId ? { campaignId: q.campaignId } : {}),
      ...(q.verticalId ? { verticalId: q.verticalId } : {}),
      ...(q.sourceId ? { sourceId: q.sourceId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.from || q.to
        ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } }
        : {}),
      // Free-text search across the JSON payload (name, phone, email, …).
      ...(q.q
        ? {
            OR: [
              { id: q.q },
              { payload: { string_contains: q.q } },
            ],
          }
        : {}),
    };

    const [total, rows, sum] = await Promise.all([
      prisma.lead.count({ where }),
      prisma.lead.findMany({
        where,
        include: { buyer: true, campaign: true, vertical: true, source: true },
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      prisma.lead.aggregate({ where, _sum: { price: true } }),
    ]);

    res.json({
      data: rows,
      page: q.page,
      pageSize: q.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
      revenue: Number(sum._sum.price ?? 0),
    });
  })
);

leadsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const lead = await prisma.lead.findUnique({
      where: { id: req.params.id },
      include: { buyer: true, campaign: true, vertical: true, source: true, ping: true },
    });
    if (!lead) throw notFound('Lead not found');
    res.json(lead);
  })
);

/** Re-attempt delivery for a lead whose buyer endpoint was down. */
leadsRouter.post(
  '/:id/redeliver',
  asyncHandler(async (req, res) => {
    const { deliverLead } = await import('../services/delivery');
    const lead = await prisma.lead.findUnique({
      where: { id: req.params.id },
      include: { buyer: true, campaign: true, vertical: true, source: true },
    });
    if (!lead) throw notFound('Lead not found');
    if (!lead.buyer) throw notFound('This lead has no buyer to deliver to');

    const payload = (lead.payload ?? {}) as Record<string, unknown>;
    const result = await deliverLead(lead.buyer, {
      lead_id: lead.id,
      ping_id: lead.pingId,
      vertical: lead.vertical.key,
      campaign_id: lead.campaignId,
      campaign_name: lead.campaign?.name,
      buyer_id: lead.buyerId,
      price: Number(lead.price),
      source_id: lead.sourceId,
      source_name: lead.source.name,
      received_at: lead.createdAt.toISOString(),
      redelivery: true,
      ...payload,
    });

    const updated = await prisma.lead.update({
      where: { id: lead.id },
      data: {
        status: result.outcome === 'delivered' ? 'delivered' : result.outcome === 'skipped' ? 'sold' : 'delivery_failed',
        deliveryAttempts: lead.deliveryAttempts + result.attempts,
        deliveryResponse: {
          outcome: result.outcome,
          url: result.url,
          method: result.method,
          status: result.status,
          body: result.body,
          error: result.error,
          durationMs: result.durationMs,
          requestBody: result.requestBody,
        },
      },
    });

    res.json({ lead: updated, delivery: result });
  })
);
