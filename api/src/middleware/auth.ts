import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Source } from '@prisma/client';
import { prisma } from '../db';
import { env } from '../env';
import { asyncHandler, unauthorized } from '../errors';

export const ADMIN_COOKIE = 'leadgen_session';

declare module 'express-serve-static-core' {
  interface Request {
    source?: Source;
    admin?: { id: string; email: string };
  }
}

export interface AdminTokenPayload {
  sub: string;
  email: string;
}

export function signAdminToken(payload: AdminTokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

export function adminCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env.COOKIE_SECURE,
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

/** Constant-time compare so API-key checks don't leak length/prefix by timing. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Authenticate a lead source by `X-Api-Key`. Guards the public ping/post API.
 */
export const sourceAuth = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const apiKey = req.header('x-api-key');
  if (!apiKey) throw unauthorized('Missing X-Api-Key header');

  const source = await prisma.source.findUnique({ where: { apiKey } });
  if (!source || !safeEqual(source.apiKey, apiKey)) throw unauthorized('Invalid API key');
  if (!source.active) throw unauthorized('This source is deactivated');

  req.source = source;
  next();
});

/**
 * Authenticate a dashboard operator from the httpOnly session cookie, falling
 * back to `Authorization: Bearer` so the API is usable from scripts too.
 */
export const adminAuth = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const bearer = req.header('authorization');
  const token =
    (req.cookies?.[ADMIN_COOKIE] as string | undefined) ??
    (bearer?.toLowerCase().startsWith('bearer ') ? bearer.slice(7).trim() : undefined);

  if (!token) throw unauthorized('Not signed in');

  let payload: AdminTokenPayload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET) as AdminTokenPayload;
  } catch {
    throw unauthorized('Session expired or invalid');
  }

  const admin = await prisma.adminUser.findUnique({ where: { id: payload.sub } });
  if (!admin) throw unauthorized('Account no longer exists');

  req.admin = { id: admin.id, email: admin.email };
  next();
});
