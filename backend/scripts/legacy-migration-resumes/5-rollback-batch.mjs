#!/usr/bin/env node
// Undo ONE Stage 3 (resume) load batch. As Stage 2's 4-rollback-batch.mjs, plus the OneDrive files (plan 5.2, 5.5):
//   - deletes the rpa_cv rows (and their search entries) the batch inserted, then their uploaded CV files
//   - restores the before-values the batch recorded for matched candidates; when that removes a CV the batch
//     attached, the uploaded file is deleted too
//   - removes the "Also in archive" label the batch set, when no other resume batch touched the candidate
//   - then deletes the batch's rows from rpa_legacy_import_rows (the files can be loaded again)
// Nothing else is touched.
//
//   cd backend
//   node scripts/legacy-migration-resumes/5-rollback-batch.mjs --work <work> --batch <id> --env staging --expect-db recruitmentautomationdb            (dry run)
//   node scripts/legacy-migration-resumes/5-rollback-batch.mjs --work <work> --batch <id> --env staging --expect-db recruitmentautomationdb --apply
//   production: --env production --expect-db recruitmentautomationdbProd --allow-production
//
// Safety: a candidate changed in the ATS after the import (last_action_context is no longer the import tag), or
// that other ATS records point to, is NOT deleted; a field whose value changed again is NOT restored (and a CV
// replaced since is not deleted). Those are listed, and the batch's provenance rows are then kept.
// A OneDrive file that cannot be deleted is listed by item id in <work>/report/ (no candidate data) for manual removal.
// Roll several batches back in REVERSE order.
import fs from 'node:fs';
import path from 'node:path';
import { argOf, prepareEnv, assertDatabase } from '../legacy-migration-excel/lib/env.mjs';
import { SOURCE_KIND, TAG, JSON_FIELDS, canonical, plain } from './lib/constants.mjs';

const argv = process.argv; const arg = argOf(argv);
const work = arg('--work'); const batch = arg('--batch'); const envName = arg('--env'); const expectDb = arg('--expect-db'); const apply = argv.includes('--apply');
if (!work || !batch || !envName || !expectDb) { console.error('Usage: node 5-rollback-batch.mjs --work <folder> --batch <id> --env <staging|production> --expect-db <database> [--apply] [--allow-production]'); process.exit(2); }
prepareEnv({ envName, expectDb, writes: true, allowProduction: argv.includes('--allow-production'), work, logLevel: 'error' });
const { default: prisma } = await import('../../src/config/database.js');
const { deleteDriveItem } = await import('../../src/services/onedrive.service.js');
const { Prisma } = await import('@prisma/client');

const same = (k, cur, after) => (JSON_FIELDS.includes(k) ? canonical(plain(cur) ?? null) === canonical(after ?? null) : String(plain(cur) ?? '') === String(after ?? ''));
let exitCode = 0;
try {
  const db = await assertDatabase(prisma, expectDb);
  const rows = await prisma.$queryRaw`SELECT id, outcome, cv_id, changed_fields, source_table, source_row_id FROM rpa_legacy_import_rows WHERE batch_id = ${batch}::uuid AND source_kind = ${SOURCE_KIND} ORDER BY id`;
  if (rows.length === 0) { console.error(`No resume rows for batch ${batch}.`); process.exit(1); }
  console.log(`${apply ? 'APPLY' : 'DRY RUN (nothing is written or deleted)'}  rollback of resume batch ${batch} on ${db}: ${rows.length} provenance row(s)`);
  const count = { deleted: 0, kept_changed_since: 0, kept_referenced: 0, already_gone: 0, restored_rows: 0, restored_fields: 0, fields_left_changed_since: 0, labels_removed: 0, drive_files_deleted: 0, drive_delete_failed: 0 };
  const left = []; const driveLeft = [];
  const dropFile = async (itemId) => {
    if (!itemId) return;
    if (!apply) { count.drive_files_deleted++; return; }
    try { await deleteDriveItem(itemId); count.drive_files_deleted++; } catch (e) { count.drive_delete_failed++; driveLeft.push({ itemId, error: String(e.message || e).slice(0, 120) }); }
  };

  for (const r of rows.filter((x) => x.outcome === 'inserted')) {
    const cv = await prisma.rpa_cv.findUnique({ where: { id: r.cv_id }, select: { id: true, last_action_context: true, cv_file_item_id: true, _count: { select: { emails: true, shortlisted: true, mrf_tags: true, rpa_referral_audit: true } } } });
    if (!cv) { count.already_gone++; continue; }
    if (cv.last_action_context !== TAG) { count.kept_changed_since++; left.push(`cv ${cv.id}: changed in the ATS after the import`); continue; }
    if (Object.values(cv._count).some((n) => n > 0)) { count.kept_referenced++; left.push(`cv ${cv.id}: other ATS records point to it`); continue; }
    count.deleted++;
    if (apply) {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`DELETE FROM public.rpa_cv_vectors WHERE candidate_id = ${Number(cv.id)}`;
        await tx.rpa_cv.delete({ where: { id: cv.id } });
      });
    }
    await dropFile(cv.cv_file_item_id);
  }

  for (const r of rows.filter((x) => x.outcome === 'updated_existing' && x.changed_fields && Object.keys(x.changed_fields).length)) {
    const cv = await prisma.rpa_cv.findUnique({ where: { id: r.cv_id } });
    if (!cv) { count.already_gone++; continue; }
    const data = {};
    for (const [k, v] of Object.entries(r.changed_fields)) {
      if (k === 'modifiedAt') continue;
      if (same(k, cv[k], v.after)) {
        data[k] = k === 'resume_term_updated_at' && v.before ? new Date(v.before) : v.before;
        if (JSON_FIELDS.includes(k) && v.before === null) data[k] = Prisma.DbNull; // a JSON column takes DbNull, not null
      }
      else { count.fields_left_changed_since++; left.push(`cv ${cv.id}: field ${k} changed again after the import, not restored`); }
    }
    // The CV link is one pair: restore both or neither.
    if (('cvFileUrl' in data) !== ('cv_file_item_id' in data)) { delete data.cvFileUrl; delete data.cv_file_item_id; left.push(`cv ${cv.id}: CV link changed since the import, not restored`); }
    if (Object.keys(data).length) {
      const m = r.changed_fields.modifiedAt;
      if (m && same('modifiedAt', cv.modifiedAt, m.after)) data.modifiedAt = m.before ? new Date(m.before) : null;
      count.restored_rows++; count.restored_fields += Object.keys(data).filter((k) => k !== 'modifiedAt').length;
      if (apply) await prisma.rpa_cv.update({ where: { id: cv.id }, data });
      if ('cv_file_item_id' in data) await dropFile(r.changed_fields.cv_file_item_id.after);
    }
  }

  // "Also in archive" labels this import set on matched candidates (not in changed_fields).
  const matchedIds = [...new Set(rows.filter((x) => x.outcome === 'updated_existing' && x.cv_id !== null).map((x) => x.cv_id))];
  for (const cvId of matchedIds) {
    const cv = await prisma.rpa_cv.findUnique({ where: { id: cvId }, select: { id: true, legacy_source: true, legacy_relation: true } });
    if (!cv || cv.legacy_source !== SOURCE_KIND || cv.legacy_relation !== 'matched') continue;
    const [{ n }] = await prisma.$queryRaw`SELECT count(*)::int AS n FROM rpa_legacy_import_rows
      WHERE cv_id = ${cvId} AND batch_id <> ${batch}::uuid AND source_kind = ${SOURCE_KIND} AND outcome IN ('inserted', 'updated_existing')`;
    if (n > 0) continue;
    count.labels_removed++;
    if (apply) await prisma.rpa_cv.update({ where: { id: cv.id }, data: { legacy_source: null, legacy_relation: null } });
  }

  console.log(JSON.stringify(count, null, 2));
  if (left.length) { console.log(`Left as they are (${left.length}):`); for (const l of left.slice(0, 50)) console.log(`  ${l}`); }
  if (driveLeft.length) {
    const p = path.join(work, 'report', `rollback-${envName}-${batch}-onedrive-not-deleted.json`);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(driveLeft, null, 2));
    console.log(`${driveLeft.length} OneDrive file(s) could not be deleted; item ids in ${p}`);
  }
  if (apply) {
    if (left.length === 0) {
      const n = await prisma.$executeRaw`DELETE FROM rpa_legacy_import_rows WHERE batch_id = ${batch}::uuid AND source_kind = ${SOURCE_KIND}`;
      console.log(`Deleted ${n} provenance row(s). The batch is undone and its files can be loaded again.`);
    } else {
      console.log('Provenance rows were KEPT because some records were left as they are.');
      exitCode = 1;
    }
    if (driveLeft.length) exitCode = 1;
  }
} catch (e) {
  console.error(`FAILED: ${e.message}`);
  exitCode = 1;
} finally {
  await prisma.$disconnect();
}
process.exit(exitCode);
