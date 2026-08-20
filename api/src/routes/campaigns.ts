import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db';
import { asyncHandler, badRequest, notFound } from '../errors';
import { FILTER_OPS } from '../core/filters';
import { parseFieldSchema } from '../core/verticalSchema';

export const campaignsRouter = Router();

const filterRuleSchema = z.object({
  field: z.string().trim().min(1),
  op: z.enum(FILTER_OPS as [string, ...string[]]),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]).optional(),
});

const scheduleSchema = z
  .object({
    days: z.array(z.number().int().min(1).max(7)).optional(),
    start: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/).optional(),
    end: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/).optional(),
  })
  .strict();

const createSchema = z.object({
  buyerId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  verticalId: z.string().uuid(),
  active: z.boolean().optional().default(true),
  bid: z.coerce.number().min(0).max(100000),
  routingPriority: z.coerce.number().int().min(0).max(10000).optional().default(100),
  states: z.array(z.string().trim().min(1).max(8)).optional().default([]),
  zips: z.array(z.string().trim().min(1).max(16)).optional().default([]),
  filters: z.array(filterRuleSchema).optional().default([]),
  dailyCap: z.coerce.number().int().min(0).optional().default(0),
  monthlyCap: z.coerce.number().int().min(0).optional().default(0),
  concurrencyCap: z.coerce.number().int().min(0).optional().default(0),
  schedule: scheduleSchema.optional().default({}),
});

const updateSchema = createSchema.partial();

/** Refuse filters that reference a field the vertical doesn't define. */
async function assertFiltersMatchVertical(
  verticalId: string,
  filters: { field: string }[] | undefined
): Promise<void> {
  if (!filters || filters.length === 0) return;
  const vertical = await prisma.vertical.findUnique({ where: { id: verticalId } });
  if (!vertical) throw notFound('Vertical not found');
  const known = new Set([
    ...parseFieldSchema(vertical.fieldSchema).map((f) => f.name),
    'state',
    'zip',
  ]);
  const unknown = filters.map((f) => f.field).filter((f) => !known.has(f));
  if (unknown.length > 0) {
    throw badRequest(
      `Filter field(s) not defined on vertical "${vertical.key}": ${unknown.join(', ')}. Add them to the vertical's field schema first.`
    );
  }
}

campaignsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { verticalId, buyerId, active } = req.query as Record<string, string | undefined>;
    const campaigns = await prisma.campaign.findMany({
      where: {
        ...(verticalId ? { verticalId } : {}),
        ...(buyerId ? { buyerId } : {}),
        ...(active !== undefined ? { active: active === 'true' } : {}),
      },
      include: { buyer: true, vertical: true, _count: { select: { leads: true } } },
      orderBy: [{ createdAt: 'asc' }],
    });
    res.json(campaigns);
  })
);

campaignsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const campaign = await prisma.campaign.findUnique({
      where: { id: req.params.id },
      include: { buyer: true, vertical: true },
    });
    if (!campaign) throw notFound('Campaign not found');
    res.json(campaign);
  })
);

campaignsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    await assertFiltersMatchVertical(body.verticalId, body.filters);

    const campaign = await prisma.campaign.create({
      data: {
        buyerId: body.buyerId,
        name: body.name,
        verticalId: body.verticalId,
        active: body.active,
        bid: new Prisma.Decimal(body.bid),
        routingPriority: body.routingPriority,
        states: body.states.map((s) => s.toUpperCase()),
        zips: body.zips,
        filters: body.filters as unknown as Prisma.InputJsonValue,
        dailyCap: body.dailyCap,
        monthlyCap: body.monthlyCap,
        concurrencyCap: body.concurrencyCap,
        schedule: body.schedule as unknown as Prisma.InputJsonValue,
      },
      include: { buyer: true, vertical: true },
    });
    res.status(201).json(campaign);
  })
);

campaignsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const body = updateSchema.parse(req.body);
    const existing = await prisma.campaign.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Campaign not found');

    if (body.filters) {
      await assertFiltersMatchVertical(body.verticalId ?? existing.verticalId, body.filters);
    }

    const campaign = await prisma.campaign.update({
      where: { id: req.params.id },
      data: {
        ...(body.buyerId !== undefined ? { buyerId: body.buyerId } : {}),
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.verticalId !== undefined ? { verticalId: body.verticalId } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
        ...(body.bid !== undefined ? { bid: new Prisma.Decimal(body.bid) } : {}),
        ...(body.routingPriority !== undefined ? { routingPriority: body.routingPriority } : {}),
        ...(body.states !== undefined ? { states: body.states.map((s) => s.toUpperCase()) } : {}),
        ...(body.zips !== undefined ? { zips: body.zips } : {}),
        ...(body.filters !== undefined
          ? { filters: body.filters as unknown as Prisma.InputJsonValue }
          : {}),
        ...(body.dailyCap !== undefined ? { dailyCap: body.dailyCap } : {}),
        ...(body.monthlyCap !== undefined ? { monthlyCap: body.monthlyCap } : {}),
        ...(body.concurrencyCap !== undefined ? { concurrencyCap: body.concurrencyCap } : {}),
        ...(body.schedule !== undefined
          ? { schedule: body.schedule as unknown as Prisma.InputJsonValue }
          : {}),
      },
      include: { buyer: true, vertical: true },
    });
    res.json(campaign);
  })
);

campaignsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await prisma.campaign.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  })
);
