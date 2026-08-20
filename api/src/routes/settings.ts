import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, badRequest } from '../errors';
import { ROUTING_STRATEGIES } from '../core/ranking';
import { getSettings, updateSettings } from '../settings';

export const settingsRouter = Router();

const patchSchema = z.object({
  routingStrategy: z.enum(ROUTING_STRATEGIES as [string, ...string[]]).optional(),
  dedupWindowDays: z.coerce.number().int().min(0).max(3650).optional(),
  pingTtlSeconds: z.coerce.number().int().min(10).max(86400).optional(),
  timezone: z.string().min(1).max(64).optional(),
});

settingsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ ...(await getSettings()), routingStrategies: ROUTING_STRATEGIES });
  })
);

settingsRouter.patch(
  '/',
  asyncHandler(async (req, res) => {
    const body = patchSchema.parse(req.body);
    if (body.timezone) {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: body.timezone });
      } catch {
        throw badRequest(`Unknown IANA timezone: ${body.timezone}`);
      }
    }
    const updated = await updateSettings(body as never);
    res.json({ ...updated, routingStrategies: ROUTING_STRATEGIES });
  })
);
