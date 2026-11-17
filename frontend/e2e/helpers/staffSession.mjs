/**
 * Dev-only: a short-lived ATS session for an existing STAFF account, so a
 * Playwright run can sign in without anyone typing a password (and without
 * Turnstile). Uses the backend's own generateJWT() and the same rpa_sessions
 * row a real login writes; `delete` removes it again.
 *
 *   node frontend/e2e/helpers/staffSession.mjs create <email>   -> prints {token, user, sessionId}
 *   node frontend/e2e/helpers/staffSession.mjs delete <sessionId>
 *
 * Refuses outright on a production config. Never commit a token it prints.
 */
import prisma from '../../../backend/src/config/database.js';
import config from '../../../backend/src/config/index.js';
import { generateJWT } from '../../../backend/src/services/auth.service.js';
import { ROLE_RANK, normalizeRole } from '../../../backend/src/config/roles.js';
const [, , action, arg] = process.argv;

async function main() {
  if (config.isProduction) throw new Error('staffSession.mjs refuses to run against a production config.');

  if (action === 'create') {
    if (!arg) throw new Error('Usage: create <email>');
    const user = await prisma.rpa_users.findFirst({ where: { email: { equals: arg, mode: 'insensitive' } }, include: { company: true } });
    if (!user || !user.is_active) throw new Error(`No active user with email ${arg}.`);
    // Same gate as requireStaff (middleware/auth.js).
    if ((ROLE_RANK[normalizeRole(user.role)] ?? 0) < ROLE_RANK.recruiter) throw new Error(`User ${arg} is "${user.role}", not a staff role.`);

    const token = generateJWT(user);
    const session = await prisma.rpa_sessions.create({
      data: {
        user_id: user.id, token, role: user.role, company_id: user.company_id ?? null,
        // An hour is plenty for one run; teardown deletes it sooner.
        expires_at: new Date(Date.now() + 60 * 60 * 1000), created_at: new Date(),
      },
    });
    const permissions = await prisma.rpa_module_permissions.findMany({
      where: { user_id: user.id, is_enabled: true }, select: { module_key: true },
    });
    const { password_hash, company, ...rest } = user;
    const safeUser = { ...rest, company_name: company?.name ?? null, permissions: permissions.map((p) => p.module_key) };
    process.stdout.write(`${JSON.stringify({ token, sessionId: String(session.id), user: safeUser }, (k, v) => (typeof v === 'bigint' ? String(v) : v))}\n`);
    return;
  }

  if (action === 'delete') {
    if (!arg) throw new Error('Usage: delete <sessionId>');
    const { count } = await prisma.rpa_sessions.deleteMany({ where: { id: Number(arg) } });
    process.stdout.write(`${JSON.stringify({ deleted: count })}\n`);
    return;
  }

  throw new Error('Usage: create <email> | delete <sessionId>');
}

main()
  .catch((err) => { process.stderr.write(`${err.message}\n`); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
