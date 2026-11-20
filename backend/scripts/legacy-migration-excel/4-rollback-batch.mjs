// Undo ONE Stage 2 import batch (one sheet run). As Stage 1's 4-rollback-batch.mjs, for the Excel source:
//   - deletes the rpa_cv rows (and their search entries) the batch recorded as inserted
//   - restores the before-values the batch recorded for rows it updated (this includes the
//     truncation repairs and appended history: both are recorded in changed_fields)
//   - removes the "Also in Excel" label the batch set, when no other batch touched the candidate
//   - then deletes the batch's rows from rpa_legacy_import_rows
// Nothing else is touched.
//
//   cd backend
//   node scripts/legacy-migration-excel/4-rollback-batch.mjs --batch <batch id> --env staging --expect-db recruitmentautomationdb            (dry run)
//   node scripts/legacy-migration-excel/4-rollback-batch.mjs --batch <batch id> --env staging --expect-db recruitmentautomationdb --apply
//
// Safety: a candidate changed in the ATS after the import (last_action_context is no longer the
// import tag), or that other ATS records point to, is NOT deleted; an updated field whose value
// changed again is NOT restored. Those are listed; the batch's provenance rows are then kept.
// Roll a wave back in REVERSE batch order: a later batch may have updated what an earlier one inserted.
import { argOf, prepareEnv, assertDatabase } from './lib/env.mjs';
import { TAG, SOURCE_KIND } from './lib/layouts.mjs';

const argv = process.argv; const arg = argOf(argv);
const batch = arg('--batch'); const envName = arg('--env'); const expectDb = arg('--expect-db'); const apply = argv.includes('--apply');
if (!batch || !envName || !expectDb) { console.error('Usage: node 4-rollback-batch.mjs --batch <id> --env <staging|production> --expect-db <database> [--apply] [--allow-production] [--work <folder>]'); process.exit(2); }
prepareEnv({ envName, expectDb, writes: true, allowProduction: argv.includes('--allow-production'), work: arg('--work') });
const { default: prisma } = await import('../../src/config/database.js');

const same = (a, b) => String(a ?? '') === String(b ?? '');
const plain = (v) => (v === null || v === undefined ? null : typeof v === 'bigint' ? Number(v) : v instanceof Date ? v.toISOString() : typeof v === 'object' && v.constructor?.name === 'Decimal' ? v.toString() : v);
let exitCode = 0;
try {
  const db = await assertDatabase(prisma, expectDb);
  const rows = await prisma.$queryRaw`SELECT id, outcome, cv_id, changed_fields, source_table, source_row_id FROM rpa_legacy_import_rows WHERE batch_id = ${batch}::uuid AND source_kind = ${SOURCE_KIND} ORDER BY id`;
  if (rows.length === 0) { console.error(`No Excel rows for batch ${batch}.`); process.exit(1); }
  console.log(`${apply ? 'APPLY' : 'DRY RUN (nothing is written)'}  rollback of batch ${batch} on ${db}: ${rows.length} provenance row(s)`);
  const count = { deleted: 0, kept_changed_since: 0, kept_referenced: 0, already_gone: 0, restored_rows: 0, restored_fields: 0, fields_left_changed_since: 0, labels_removed: 0 };
  const left = [];

  for (const r of rows.filter((x) => x.outcome === 'inserted')) {
    const cv = await prisma.rpa_cv.findUnique({ where: { id: r.cv_id }, select: { id: true, last_action_context: true, _count: { select: { emails: true, shortlisted: true, mrf_tags: true, rpa_referral_audit: true } } } });
    if (!cv) { count.already_gone++; continue; }
    if (cv.last_action_context !== TAG) { count.kept_changed_since++; left.push(`cv ${cv.id}: changed in the ATS after the import (${r.source_table} row ${r.source_row_id})`); continue; }
    if (Object.values(cv._count).some((n) => n > 0)) { count.kept_referenced++; left.push(`cv ${cv.id}: other ATS records point to it (${r.source_table} row ${r.source_row_id})`); continue; }
    count.deleted++;
    if (apply) {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`DELETE FROM public.rpa_cv_vectors WHERE candidate_id = ${Number(cv.id)}`;
        await tx.rpa_cv.delete({ where: { id: cv.id } });
      });
    }
  }

  for (const r of rows.filter((x) => x.outcome === 'updated_existing' && x.changed_fields && Object.keys(x.changed_fields).length)) {
    const cv = await prisma.rpa_cv.findUnique({ where: { id: r.cv_id } });
    if (!cv) { count.already_gone++; continue; }
    const data = {};
    for (const [k, v] of Object.entries(r.changed_fields)) {
      if (k === 'modifiedAt') continue;
      if (same(plain(cv[k]), v.after)) data[k] = v.before; else { count.fields_left_changed_since++; left.push(`cv ${cv.id}: field ${k} changed again after the import, not restored`); }
    }
    if (Object.keys(data).length) {
      const m = r.changed_fields.modifiedAt;
      if (m && same(plain(cv.modifiedAt), m.after)) data.modifiedAt = m.before ? new Date(m.before) : null;
      count.restored_rows++; count.restored_fields += Object.keys(data).filter((k) => k !== 'modifiedAt').length;
      if (apply) await prisma.rpa_cv.update({ where: { id: cv.id }, data });
    }
  }

  // "Also in Excel" labels this import set on matched candidates (not in changed_fields).
  const matchedIds = [...new Set(rows.filter((x) => x.outcome === 'updated_existing' && x.cv_id !== null).map((x) => x.cv_id))];
  for (const cvId of matchedIds) {
    const cv = await prisma.rpa_cv.findUnique({ where: { id: cvId }, select: { id: true, legacy_source: true, legacy_relation: true } });
    if (!cv || cv.legacy_source !== SOURCE_KIND || cv.legacy_relation !== 'matched') continue;
    const [{ n }] = await prisma.$queryRaw`SELECT count(*)::int AS n FROM rpa_legacy_import_rows
      WHERE cv_id = ${cvId} AND batch_id <> ${batch}::uuid AND source_kind = ${SOURCE_KIND} AND outcome IN ('inserted', 'updated_existing')`;
    if (n > 0) continue; // another Excel batch also touched this candidate
    count.labels_removed++;
    if (apply) await prisma.rpa_cv.update({ where: { id: cv.id }, data: { legacy_source: null, legacy_relation: null } });
  }

  console.log(JSON.stringify(count, null, 2));
  if (left.length) { console.log(`Left as they are (${left.length}):`); for (const l of left.slice(0, 50)) console.log(`  ${l}`); }
  if (apply) {
    if (left.length === 0) {
      const n = await prisma.$executeRaw`DELETE FROM rpa_legacy_import_rows WHERE batch_id = ${batch}::uuid AND source_kind = ${SOURCE_KIND}`;
      console.log(`Deleted ${n} provenance row(s). The batch is fully undone and can be loaded again.`);
    } else {
      console.log('Provenance rows were KEPT because some records were left as they are.');
      exitCode = 1;
    }
  }
} catch (e) {
  console.error(`FAILED: ${e.message}`);
  exitCode = 1;
} finally {
  await prisma.$disconnect();
}
process.exit(exitCode);
