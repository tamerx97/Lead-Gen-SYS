import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, unauthorized } from '../errors';
import { sourceAuth } from '../middleware/auth';
import { publicApiLimiter } from '../middleware/rateLimit';
import { handlePing } from '../services/ping';
import { handlePost } from '../services/post';

/**
 * The public lead API. Two calls per lead:
 *   POST /api/ping  — non-PII attributes in, ranked offers + ping_id out.
 *   POST /api/post  — full lead + ping_id in, award + delivery result out.
 */
export const publicRouter = Router();

// Attribute keys are open-ended by design: they come from the vertical's own
// field schema, which the operator defines at runtime.
const pingSchema = z
  .object({
    vertical: z.string().min(1, '`vertical` is required'),
    state: z.string().max(64).optional().nullable(),
    zip: z.string().max(32).optional().nullable(),
  })
  .passthrough();

const postSchema = z
  .object({
    ping_id: z.string().uuid('`ping_id` must be the uuid returned by /api/ping'),
    campaign_id: z.string().uuid().optional(),
  })
  .passthrough();

publicRouter.post(
  '/ping',
  publicApiLimiter,
  sourceAuth,
  asyncHandler(async (req, res) => {
    if (!req.source) throw unauthorized();
    const body = pingSchema.parse(req.body);
    const result = await handlePing(req.source, body);
    res.status(200).json(result);
  })
);

publicRouter.post(
  '/post',
  publicApiLimiter,
  sourceAuth,
  asyncHandler(async (req, res) => {
    if (!req.source) throw unauthorized();
    const body = postSchema.parse(req.body);
    const result = await handlePost(req.source, body);
    res.status(result.accepted ? 200 : 200).json(result);
  })
);
