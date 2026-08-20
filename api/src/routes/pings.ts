import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { asyncHandler, notFound } from '../errors';
import { expireStalePings } from '../services/post';

export const pingsRouter = Router();

const querySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).optional().default(25),
  verticalId: z.string().uuid().optional(),
  sourceId: z.string().uuid().optional(),
  status: z.enum(['open', 'no_bid', 'posted', 'expired']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

pingsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = querySchema.parse(req.query);
    // Keep the log honest: retire pings whose TTL has lapsed before reading.
    await expireStalePings();

    const where = {
      ...(q.verticalId ? { verticalId: q.verticalId } : {}),
      ...(q.sourceId ? { sourceId: q.sourceId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.from || q.to
        ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } }
        : {}),
    };

    const [total, rows] = await Promise.all([
      prisma.ping.count({ where }),
      prisma.ping.findMany({
        where,
        include: { vertical: true, source: true, leads: { select: { id: true, status: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);

    res.json({
      data: rows,
      page: q.page,
      pageSize: q.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
    });
  })
);

pingsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const ping = await prisma.ping.findUnique({
      where: { id: req.params.id },
      include: { vertical: true, source: true, leads: true },
    });
    if (!ping) throw notFound('Ping not found');
    res.json(ping);
  })
);
