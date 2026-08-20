import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db';
import { asyncHandler, badRequest, notFound } from '../errors';
import { verticalFieldSchemaArray } from '../core/verticalSchema';

/**
 * Verticals are the mechanism that makes this platform general-purpose.
 * Creating a niche is a row here plus its `fieldSchema` — never a code change.
 */
export const verticalsRouter = Router();

const keyPattern = /^[a-z0-9][a-z0-9_-]*$/;

const createSchema = z.object({
  key: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .transform((s) => s.toLowerCase())
    .refine((s) => keyPattern.test(s), 'key must be lowercase letters, numbers, hyphen or underscore'),
  name: z.string().trim().min(1).max(120),
  active: z.boolean().optional().default(true),
  fieldSchema: verticalFieldSchemaArray.optional().default([]),
});

const updateSchema = createSchema.partial();

verticalsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const includeCounts = req.query.counts !== 'false';
    const verticals = await prisma.vertical.findMany({
      orderBy: { createdAt: 'asc' },
      ...(includeCounts
        ? { include: { _count: { select: { campaigns: true, leads: true, pings: true } } } }
        : {}),
    });
    res.json(verticals);
  })
);

verticalsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const vertical = await prisma.vertical.findFirst({
      where: { OR: [{ id: req.params.id }, { key: req.params.id }] },
      include: { _count: { select: { campaigns: true, leads: true, pings: true } } },
    });
    if (!vertical) throw notFound('Vertical not found');
    res.json(vertical);
  })
);

verticalsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const vertical = await prisma.vertical.create({
      data: {
        key: body.key,
        name: body.name,
        active: body.active,
        fieldSchema: body.fieldSchema as unknown as Prisma.InputJsonValue,
      },
    });
    res.status(201).json(vertical);
  })
);

verticalsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const body = updateSchema.parse(req.body);
    const existing = await prisma.vertical.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Vertical not found');

    const vertical = await prisma.vertical.update({
      where: { id: req.params.id },
      data: {
        ...(body.key !== undefined ? { key: body.key } : {}),
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
        ...(body.fieldSchema !== undefined
          ? { fieldSchema: body.fieldSchema as unknown as Prisma.InputJsonValue }
          : {}),
      },
    });
    res.json(vertical);
  })
);

verticalsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const counts = await prisma.lead.count({ where: { verticalId: req.params.id } });
    if (counts > 0 && req.query.force !== 'true') {
      throw badRequest(
        `This vertical has ${counts} lead(s). Deactivate it instead, or pass ?force=true to delete it and its history.`
      );
    }
    await prisma.vertical.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  })
);
