/**
 * Cleanup of rows created during an ON-PRODUCTION test run.
 *
 * On go-live test day we run production code against the PRODUCTION database
 * (recruitmentautomationdbProd) with EMAIL_FORCE_REDIRECT=true, so no candidate
 * is ever emailed — but every candidate / email / shortlist / MRF row created
 * during testing lands in the real prod database. This script removes those
 * rows so the production DB is clean before the real go-live.
 *
 * IDENTIFICATION: rows are selected purely by a TIME WINDOW (their created_at /
 * createdAt falling within [--since, --until]). This is deliberate — it does not
 * rely on fuzzy email/domain matching and it covers every write path uniformly.
 * You are responsible for passing a window that contains ONLY test activity.
 *
 * SAFETY: dry-run by default. It prints the row counts it WOULD delete and
 * exits without touching data. Pass --confirm to actually delete (inside a
 * single transaction, children before parents to respect FKs).
 *
 * USAGE:
 *   # preview what would be deleted for a test window (dry run):
 *   cross-env NODE_ENV=production node prisma/cleanup-test-data.js \
 *     --since="2026-07-03T00:00:00+05:30"
 *
 *   # bound both ends and actually delete:
 *   cross-env NODE_ENV=production node prisma/cleanup-test-data.js \
 *     --since="2026-07-03T00:00:00+05:30" \
 *     --until="2026-07-03T23:59:59+05:30" \
 *     --confirm
 *
 * (or via npm: `npm run cleanup:test:prod -- --since="..." [--until="..."] [--confirm]`)
 *
 * --since is REQUIRED. --until defaults to "now". Timestamps are parsed by
 * `new Date(...)`; always include a timezone offset to avoid ambiguity.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const NODE_ENV = (process.env.NODE_ENV || 'development').trim();

// Resolve the env-specific DATABASE_URL ourselves. dotenv does NOT overwrite
// already-set vars, so the env-specific file (loaded first) wins over .env.
dotenv.config({ path: path.resolve(projectRoot, `.env.${NODE_ENV}`) });
dotenv.config({ path: path.resolve(projectRoot, '.env') });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. Check your .env files.');
  process.exit(1);
}

// ── parse args ────────────────────────────────────────────────────────────
function argValue(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}
const hasFlag = (name) => process.argv.includes(`--${name}`);

const sinceRaw = argValue('since');
const untilRaw = argValue('until');
const confirm = hasFlag('confirm');

if (!sinceRaw) {
  console.error('ERROR: --since is required, e.g. --since="2026-07-03T00:00:00+05:30"');
  process.exit(1);
}

const since = new Date(sinceRaw);
const until = untilRaw ? new Date(untilRaw) : new Date();

if (Number.isNaN(since.getTime())) {
  console.error(`ERROR: --since is not a valid date: "${sinceRaw}"`);
  process.exit(1);
}
if (Number.isNaN(until.getTime())) {
  console.error(`ERROR: --until is not a valid date: "${untilRaw}"`);
  process.exit(1);
}
if (since >= until) {
  console.error(`ERROR: --since (${since.toISOString()}) must be before --until (${until.toISOString()}).`);
  process.exit(1);
}

// Guardrail: this script only ever makes sense against the production DB during
// an on-production test. Warn loudly if pointed elsewhere, but don't block
// (it's harmless to dry-run against staging).
const dbName = (() => {
  try {
    return decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''));
  } catch {
    return '(unparseable)';
  }
})();

console.log('─'.repeat(74));
console.log('ON-PRODUCTION TEST DATA CLEANUP');
console.log('─'.repeat(74));
console.log(`  NODE_ENV : ${NODE_ENV}`);
console.log(`  Database : ${dbName}`);
console.log(`  Window   : ${since.toISOString()}  →  ${until.toISOString()}`);
console.log(`  Mode     : ${confirm ? 'DELETE (--confirm)' : 'DRY RUN (no --confirm)'}`);
console.log('─'.repeat(74));

// IMPORTANT: pass the DSN explicitly so Prisma targets the env-specific DB we
// resolved above rather than re-reading .env through its own loader.
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient({
  datasources: { db: { url: databaseUrl } },
});

// Windows for the various tables. Most use `created_at`; rpa_cv/rpa_cv_tmp use
// `createdAt` (and rpa_cv.createdAt is nullable + has no default, so parser-set
// rows carry the timestamp explicitly).
const createdAt = { createdAt: { gte: since, lte: until } };
const created_at = { created_at: { gte: since, lte: until } };
const shortlistedAt = { shortlisted_at: { gte: since, lte: until } };

async function main() {
  // Identify parent rows in-window so we can also catch their children whose own
  // created_at might (rarely) fall just outside the window.
  const [cvIds, mrfIds, shortlistIds] = await Promise.all([
    prisma.rpa_cv.findMany({ where: createdAt, select: { id: true } }),
    prisma.rpa_mrf.findMany({ where: created_at, select: { id: true } }),
    prisma.rpa_shortlisted_candidates.findMany({
      where: { OR: [created_at, shortlistedAt] },
      select: { id: true },
    }),
  ]);
  const cvIdList = cvIds.map((r) => r.id);
  const mrfIdList = mrfIds.map((r) => r.id);
  const shortlistIdList = shortlistIds.map((r) => r.id);

  // Email messages either created in-window OR linked to an in-window entity.
  const emailWhere = {
    OR: [
      created_at,
      ...(cvIdList.length ? [{ candidate_id: { in: cvIdList } }] : []),
      ...(mrfIdList.length ? [{ mrf_id: { in: mrfIdList } }] : []),
      ...(shortlistIdList.length ? [{ shortlist_id: { in: shortlistIdList } }] : []),
    ],
  };
  const emailMsgs = await prisma.rpa_email_messages.findMany({
    where: emailWhere,
    select: { id: true },
  });
  const emailMsgIds = emailMsgs.map((r) => r.id);

  // ── count everything we intend to remove ────────────────────────────────
  const plan = {
    rpa_email_tracking: emailMsgIds.length
      ? await prisma.rpa_email_tracking.count({ where: { message_id: { in: emailMsgIds } } })
      : 0,
    rpa_email_notifications: emailMsgIds.length
      ? await prisma.rpa_email_notifications.count({ where: { message_id: { in: emailMsgIds } } })
      : 0,
    rpa_email_messages: emailMsgIds.length,
    rpa_email_log: await prisma.rpa_email_log.count({ where: created_at }),
    rpa_zeko_candidate_pipeline: shortlistIdList.length
      ? await prisma.rpa_zeko_candidate_pipeline.count({ where: { candidate_id: { in: shortlistIdList } } })
      : 0,
    rpa_shortlisted_candidates: shortlistIdList.length,
    rpa_mrf_jd_send: await prisma.rpa_mrf_jd_send.count({ where: created_at }),
    rpa_mrf: mrfIdList.length,
    rpa_cv_vectors: cvIdList.length
      ? await prisma.rpa_cv_vectors.count({ where: { candidate_id: { in: cvIdList } } })
      : 0,
    rpa_cv: cvIdList.length,
    rpa_cv_tmp: await prisma.rpa_cv_tmp.count({ where: createdAt }),
    rpa_upload_jobs: await prisma.rpa_upload_jobs.count({ where: created_at }),
    rpa_processing_log: await prisma.rpa_processing_log.count({ where: createdAt }),
  };

  console.log('Rows in window (candidates for deletion):');
  let total = 0;
  for (const [table, n] of Object.entries(plan)) {
    total += n;
    console.log(`  ${table.padEnd(30)} ${String(n).padStart(6)}`);
  }
  console.log('─'.repeat(74));
  console.log(`  ${'TOTAL'.padEnd(30)} ${String(total).padStart(6)}`);
  console.log('─'.repeat(74));

  if (total === 0) {
    console.log('Nothing to delete in this window. Done.');
    return;
  }

  if (!confirm) {
    console.log('\nDRY RUN — no rows were deleted. Re-run with --confirm to delete.');
    return;
  }

  // ── delete children before parents, in one transaction ──────────────────
  const cvTmpWhere = { createdAt };
  const results = await prisma.$transaction(async (tx) => {
    const del = {};
    if (emailMsgIds.length) {
      del.rpa_email_tracking = (await tx.rpa_email_tracking.deleteMany({ where: { message_id: { in: emailMsgIds } } })).count;
      del.rpa_email_notifications = (await tx.rpa_email_notifications.deleteMany({ where: { message_id: { in: emailMsgIds } } })).count;
      del.rpa_email_messages = (await tx.rpa_email_messages.deleteMany({ where: { id: { in: emailMsgIds } } })).count;
    }
    del.rpa_email_log = (await tx.rpa_email_log.deleteMany({ where: created_at })).count;

    if (shortlistIdList.length) {
      // rpa_zeko_candidate_pipeline cascades on shortlisted delete, but delete
      // explicitly so the count is reported and order is unambiguous.
      del.rpa_zeko_candidate_pipeline = (await tx.rpa_zeko_candidate_pipeline.deleteMany({ where: { candidate_id: { in: shortlistIdList } } })).count;
      del.rpa_shortlisted_candidates = (await tx.rpa_shortlisted_candidates.deleteMany({ where: { id: { in: shortlistIdList } } })).count;
    }

    del.rpa_mrf_jd_send = (await tx.rpa_mrf_jd_send.deleteMany({ where: created_at })).count;
    if (mrfIdList.length) {
      del.rpa_mrf = (await tx.rpa_mrf.deleteMany({ where: { id: { in: mrfIdList } } })).count;
    }

    if (cvIdList.length) {
      del.rpa_cv_vectors = (await tx.rpa_cv_vectors.deleteMany({ where: { candidate_id: { in: cvIdList } } })).count;
      del.rpa_cv = (await tx.rpa_cv.deleteMany({ where: { id: { in: cvIdList } } })).count;
    }
    del.rpa_cv_tmp = (await tx.rpa_cv_tmp.deleteMany(cvTmpWhere)).count;
    del.rpa_upload_jobs = (await tx.rpa_upload_jobs.deleteMany({ where: created_at })).count;
    del.rpa_processing_log = (await tx.rpa_processing_log.deleteMany({ where: createdAt })).count;
    return del;
  });

  console.log('\nDELETED:');
  let deleted = 0;
  for (const [table, n] of Object.entries(results)) {
    deleted += n;
    console.log(`  ${table.padEnd(30)} ${String(n).padStart(6)}`);
  }
  console.log('─'.repeat(74));
  console.log(`  ${'TOTAL DELETED'.padEnd(30)} ${String(deleted).padStart(6)}`);
  console.log('Cleanup complete.');
}

main()
  .catch((err) => {
    console.error('Cleanup failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
