import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { asyncHandler, notFound } from '../errors';

export const sourcesRouter = Router();

export function generateApiKey(): string {
  return `lgs_${randomBytes(24).toString('hex')}`;
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  active: z.boolean().optional().default(true),
});

sourcesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const sources = await prisma.source.findMany({
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { pings: true, leads: true } } },
    });
    res.json(sources);
  })
);

sourcesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const source = await prisma.source.create({
      data: { name: body.name, active: body.active, apiKey: generateApiKey() },
    });
    res.status(201).json(source);
  })
);

sourcesRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const body = createSchema.partial().parse(req.body);
    const source = await prisma.source.update({ where: { id: req.params.id }, data: body });
    res.json(source);
  })
);

/** Rotate the API key. The old key stops working immediately. */
sourcesRouter.post(
  '/:id/rotate-key',
  asyncHandler(async (req, res) => {
    const existing = await prisma.source.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Source not found');
    const source = await prisma.source.update({
      where: { id: req.params.id },
      data: { apiKey: generateApiKey() },
    });
    res.json(source);
  })
);

sourcesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await prisma.source.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  })
);
