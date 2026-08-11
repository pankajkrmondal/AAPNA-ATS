/**
 * Grants the Candidate Pipeline module to every recruiter that lacks it.
 *
 *   node prisma/grant-recruiter-pipeline-access.js          # apply
 *   node prisma/grant-recruiter-pipeline-access.js --dry-run # report only
 *
 * WHY
 * ---
 * `DEFAULT_MODULES_BY_ROLE.recruiter` (admin.controller.js) was never updated
 * when the Candidate Pipeline module shipped in Phase 3 M1, so every recruiter
 * created after that arrived without access — the route redirects them to
 * /dashboard and the API answers 403. The default is fixed now; this repairs
 * the accounts created while it was wrong.
 *
 * Idempotent: an existing enabled row is left alone, an existing DISABLED row
 * is re-enabled (that is the state the Admin Portal's toggle writes), and a
 * missing row is created. Safe to re-run.
 *
 * Scope is deliberately recruiter-tier only:
 *   - admin / superadmin already bypass checkModuleAccess entirely, so giving
 *     them rows would be noise.
 *   - vendors are excluded on purpose — they are confined to their own
 *     surfaces (VENDOR_ALLOWED_PATHS, and they are kept off pipeline
 *     notifications for the same reason).
 */
import prisma from '../src/config/database.js';

const MODULE_KEY = 'recruitment_pipeline';
/** Recruiter-tier roles. `hr` is the legacy alias (config/roles.js ROLE_RANK). */
const RECRUITER_ROLES = ['recruiter', 'hr'];

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const recruiters = await prisma.rpa_users.findMany({
    where: { role: { in: RECRUITER_ROLES }, is_active: true, is_approved: true },
    select: { id: true, username: true, email: true, role: true },
    orderBy: { id: 'asc' },
  });

  if (recruiters.length === 0) {
    console.log('No active recruiters found — nothing to do.');
    return;
  }

  const existing = await prisma.rpa_module_permissions.findMany({
    where: { module_key: MODULE_KEY, user_id: { in: recruiters.map((u) => u.id) } },
    select: { user_id: true, is_enabled: true },
  });
  const stateByUser = new Map(existing.map((p) => [p.user_id, p.is_enabled]));

  const toCreate = recruiters.filter((u) => !stateByUser.has(u.id));
  const toEnable = recruiters.filter((u) => stateByUser.get(u.id) === false);
  const alreadyOk = recruiters.length - toCreate.length - toEnable.length;

  console.log(`Active recruiters: ${recruiters.length}`);
  console.log(`  already enabled : ${alreadyOk}`);
  console.log(`  missing a row   : ${toCreate.length}`);
  console.log(`  row is disabled : ${toEnable.length}`);
  [...toCreate, ...toEnable].forEach((u) => console.log(`    -> #${u.id} ${u.username} <${u.email}>`));

  if (dryRun) {
    console.log('\n--dry-run: no changes written.');
    return;
  }
  if (toCreate.length === 0 && toEnable.length === 0) {
    console.log('\nEvery active recruiter already has Candidate Pipeline access.');
    return;
  }

  if (toCreate.length > 0) {
    await prisma.rpa_module_permissions.createMany({
      data: toCreate.map((u) => ({
        user_id: u.id,
        module_key: MODULE_KEY,
        is_enabled: true,
        updated_at: new Date(),
      })),
      skipDuplicates: true,
    });
  }
  if (toEnable.length > 0) {
    await prisma.rpa_module_permissions.updateMany({
      where: { module_key: MODULE_KEY, user_id: { in: toEnable.map((u) => u.id) } },
      data: { is_enabled: true, updated_at: new Date() },
    });
  }

  console.log(`\nGranted Candidate Pipeline to ${toCreate.length + toEnable.length} recruiter(s).`);
  // GET /api/auth/me re-queries rpa_module_permissions on every call rather
  // than trusting anything baked into the token, so a page refresh is enough —
  // no sign-out required.
  console.log('They need only refresh the page; /api/auth/me re-reads permissions on each call.');
}

main()
  .catch((e) => {
    console.error('Grant failed:', e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(process.exitCode || 0);
  });
