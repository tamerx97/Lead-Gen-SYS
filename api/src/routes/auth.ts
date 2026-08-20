import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db';
import { asyncHandler, unauthorized } from '../errors';
import { ADMIN_COOKIE, adminAuth, adminCookieOptions, signAdminToken } from '../middleware/auth';
import { loginLimiter } from '../middleware/rateLimit';

export const authRouter = Router();

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'password must be at least 8 characters'),
});

authRouter.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = credentialsSchema.parse(req.body);
    const admin = await prisma.adminUser.findUnique({ where: { email: email.toLowerCase() } });

    // Always run a compare so a missing account and a wrong password take a
    // similar amount of time.
    const hash = admin?.passwordHash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidiu';
    const ok = await bcrypt.compare(password, hash);
    if (!admin || !ok) throw unauthorized('Invalid email or password');

    const token = signAdminToken({ sub: admin.id, email: admin.email });
    res.cookie(ADMIN_COOKIE, token, adminCookieOptions());
    res.json({ id: admin.id, email: admin.email, token });
  })
);

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(ADMIN_COOKIE, { ...adminCookieOptions(), maxAge: undefined });
  res.json({ ok: true });
});

authRouter.get(
  '/me',
  adminAuth,
  asyncHandler(async (req, res) => {
    res.json(req.admin);
  })
);

/** Change your own password. */
authRouter.post(
  '/password',
  adminAuth,
  asyncHandler(async (req, res) => {
    const schema = z.object({
      current_password: z.string().min(1),
      new_password: z.string().min(8),
    });
    const body = schema.parse(req.body);
    const admin = await prisma.adminUser.findUnique({ where: { id: req.admin!.id } });
    if (!admin) throw unauthorized();
    if (!(await bcrypt.compare(body.current_password, admin.passwordHash))) {
      throw unauthorized('Current password is incorrect');
    }
    await prisma.adminUser.update({
      where: { id: admin.id },
      data: { passwordHash: await bcrypt.hash(body.new_password, 10) },
    });
    res.json({ ok: true });
  })
);
