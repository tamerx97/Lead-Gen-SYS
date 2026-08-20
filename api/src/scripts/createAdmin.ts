/**
 * Create (or reset the password of) a dashboard admin.
 *
 * The seed script needs `tsx`, which production images prune, so this is the
 * supported way to bootstrap the first login on a fresh deployment:
 *
 *   node api/dist/src/scripts/createAdmin.js you@example.com 'a-strong-password'
 *
 * With no arguments it reads ADMIN_EMAIL / ADMIN_PASSWORD from the environment,
 * which keeps the password out of your shell history and the process list.
 */
import bcrypt from 'bcryptjs';
import { prisma } from '../db';

async function main(): Promise<void> {
  const email = (process.argv[2] ?? process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  const password = process.argv[3] ?? process.env.ADMIN_PASSWORD ?? '';

  if (!email || !email.includes('@')) {
    throw new Error(
      'Usage: node api/dist/src/scripts/createAdmin.js <email> <password>\n' +
        '   or: ADMIN_EMAIL=… ADMIN_PASSWORD=… node api/dist/src/scripts/createAdmin.js'
    );
  }
  if (password.length < 12) {
    throw new Error('Choose a password of at least 12 characters for an internet-facing instance.');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await prisma.adminUser.findUnique({ where: { email } });

  await prisma.adminUser.upsert({
    where: { email },
    create: { email, passwordHash },
    update: { passwordHash },
  });

  console.log(existing ? `Password reset for ${email}` : `Admin created: ${email}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
