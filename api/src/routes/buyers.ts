import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db';
import { asyncHandler, notFound } from '../errors';
import { deliverLead } from '../services/delivery';

export const buyersRouter = Router();

const jsonRecord = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  active: z.boolean().optional().default(true),
  deliveryUrl: z.string().url().or(z.literal('')).nullable().optional(),
  deliveryMethod: z.enum(['json', 'form', 'xml']).optional().default('json'),
  deliveryHeaders: jsonRecord.optional().default({}),
  fieldMapping: z.record(z.string(), z.string()).optional().default({}),
});

buyersRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const buyers = await prisma.buyer.findMany({
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { campaigns: true, leads: true } } },
    });
    res.json(buyers);
  })
);

buyersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const buyer = await prisma.buyer.findUnique({
      where: { id: req.params.id },
      include: { campaigns: { include: { vertical: true } } },
    });
    if (!buyer) throw notFound('Buyer not found');
    res.json(buyer);
  })
);

buyersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const buyer = await prisma.buyer.create({
      data: {
        name: body.name,
        active: body.active,
        deliveryUrl: body.deliveryUrl || null,
        deliveryMethod: body.deliveryMethod,
        deliveryHeaders: body.deliveryHeaders as Prisma.InputJsonValue,
        fieldMapping: body.fieldMapping as Prisma.InputJsonValue,
      },
    });
    res.status(201).json(buyer);
  })
);

buyersRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const body = createSchema.partial().parse(req.body);
    const buyer = await prisma.buyer.update({
      where: { id: req.params.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
        ...(body.deliveryUrl !== undefined ? { deliveryUrl: body.deliveryUrl || null } : {}),
        ...(body.deliveryMethod !== undefined ? { deliveryMethod: body.deliveryMethod } : {}),
        ...(body.deliveryHeaders !== undefined
          ? { deliveryHeaders: body.deliveryHeaders as Prisma.InputJsonValue }
          : {}),
        ...(body.fieldMapping !== undefined
          ? { fieldMapping: body.fieldMapping as Prisma.InputJsonValue }
          : {}),
      },
    });
    res.json(buyer);
  })
);

buyersRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await prisma.buyer.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  })
);

/**
 * Send a synthetic lead to the buyer's configured endpoint so an operator can
 * confirm the webhook works before pointing live campaigns at it.
 */
buyersRouter.post(
  '/:id/test-delivery',
  asyncHandler(async (req, res) => {
    const buyer = await prisma.buyer.findUnique({ where: { id: req.params.id } });
    if (!buyer) throw notFound('Buyer not found');

    const result = await deliverLead(
      buyer,
      {
        lead_id: '00000000-0000-0000-0000-000000000000',
        test: true,
        vertical: 'test',
        campaign_id: '00000000-0000-0000-0000-000000000000',
        campaign_name: 'Test delivery',
        buyer_id: buyer.id,
        price: 0,
        received_at: new Date().toISOString(),
        first_name: 'Test',
        last_name: 'Lead',
        email: 'test.lead@example.com',
        phone: '5550000000',
        state: 'CA',
        zip: '90210',
      },
      { maxAttempts: 1 }
    );

    res.json(result);
  })
);
