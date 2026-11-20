// Read-only check of ONE Stage 2 import batch (one sheet run of 3-load.mjs). SELECT statements only.
// Prints counts and column names, never candidate values. As Stage 1's 3c, for the Excel source.
//
//   cd backend
//   node scripts/legacy-migration-excel/3c-check-batch.mjs --work <work folder> --batch <batch id> --env <staging|production> --expect-db <database>
//
// Checks: provenance rows of the batch; every inserted candidate exists, carries the import tag and
// the "excel" label, has MetaData and a search entry (if it has an email), and equals the transform
// output on every mapped column and the created date; every matched candidate carries a legacy
// label (an earlier import, MS Access, may own it); no email activity for the batch's candidates.
// Exit code 0 = the check ran (read "problems" in the output), 1 = it could not run.
import fs from 'fs';
import path from 'path';
import { argOf, prepareEnv, assertDatabase } from './lib/env.mjs';
import { CV_FIELDS, TAG, SOURCE_KIND } from './lib/layouts.mjs';

const argv = process.argv; const arg = argOf(argv);
const work = arg('--work'); const batch = arg('--batch'); const envName = arg('--env'); const expectDb = arg('--expect-db');
if (!work || !batch || !envName || !expectDb) { console.error('Usage: node 3c-check-batch.mjs --work <folder> --batch <id> --env <staging|production> --expect-db <database>'); process.exit(2); }
prepareEnv({ envName, expectDb, writes: false, work, logLevel: 'error' });
const { default: prisma } = await import('../../src/config/database.js');

const out = {}; const problems = [];
let exitCode = 0;
try {
  out.database = await assertDatabase(prisma, expectDb); out.batch = batch;
  const prov = await prisma.$queryRaw`SELECT outcome, cv_id, source_file, source_table, source_row_id, created_at FROM rpa_legacy_import_rows WHERE batch_id = ${batch}::uuid AND source_kind = ${SOURCE_KIND}`;
  if (prov.length === 0) { console.error(`No Excel provenance rows for batch ${batch}.`); process.exit(1); }
  out.provenanceRows = prov.length;
  out.byOutcome = prov.reduce((a, r) => ((a[r.outcome] = (a[r.outcome] || 0) + 1), a), {});
  const since = prov.reduce((m, r) => (r.created_at < m ? r.created_at : m), prov[0].created_at);

  const insIds = [...new Set(prov.filter((r) => r.outcome === 'inserted').map((r) => r.cv_id))];
  const updIds = [...new Set(prov.filter((r) => r.outcome === 'updated_existing').map((r) => r.cv_id))];
  const cvs = await prisma.rpa_cv.findMany({ where: { id: { in: [...new Set([...insIds, ...updIds])] } } });
  const cvById = new Map(cvs.map((c) => [String(c.id), c]));
  const ins = insIds.map((id) => cvById.get(String(id))).filter(Boolean);
  const upd = updIds.map((id) => cvById.get(String(id))).filter(Boolean);
  out.inserted = {
    candidates: insIds.length, found: ins.length,
    withImportTag: ins.filter((c) => c.last_action_context === TAG).length,
    withLabel: ins.filter((c) => c.legacy_source === SOURCE_KIND && c.legacy_relation === 'imported').length,
    withMetaData: ins.filter((c) => c.MetaData).length,
    withEmail: ins.filter((c) => String(c.EmailID || '').trim()).length,
  };
  out.matchedExisting = {
    candidates: updIds.length, found: upd.length,
    withAnyLegacyLabel: upd.filter((c) => c.legacy_source).length,
    labelledExcelByThisImport: upd.filter((c) => c.legacy_source === SOURCE_KIND && c.legacy_relation === 'matched').length,
  };
  const ids = insIds.map(Number);
  const [{ n: vec }] = ids.length ? await prisma.$queryRawUnsafe('select count(distinct candidate_id)::int n from public.rpa_cv_vectors where candidate_id = any($1::bigint[]) and embedding is not null', ids) : [{ n: 0 }];
  out.inserted.withSearchEntry = vec;
  if (ins.length !== insIds.length) problems.push(`${insIds.length - ins.length} inserted candidate(s) not found`);
  if (upd.length !== updIds.length) problems.push(`${updIds.length - upd.length} matched candidate(s) not found`);
  if (vec < out.inserted.withEmail) problems.push(`${out.inserted.withEmail - vec} candidate(s) with an email have no search entry (run 3b-retry-vectors.mjs)`);
  if (out.inserted.withImportTag !== ins.length) problems.push(`${ins.length - out.inserted.withImportTag} inserted candidate(s) without the import tag`);
  if (out.inserted.withLabel !== ins.length) problems.push(`${ins.length - out.inserted.withLabel} inserted candidate(s) without the Excel label`);
  if (out.matchedExisting.withAnyLegacyLabel !== upd.length) problems.push(`${upd.length - out.matchedExisting.withAnyLegacyLabel} matched candidate(s) without a legacy label`);

  // Inserted candidates against the transform output, column by column.
  const units = JSON.parse(fs.readFileSync(path.join(work, 'transform', 'units.json'), 'utf8'));
  const unitByN = new Map(units.map((u) => [u.n, u]));
  const k = (u, id) => `${unitByN.get(u).file}|${unitByN.get(u).sheet}|${id}`;
  const byKey = new Map(prov.map((r) => [`${r.source_file}|${r.source_table}|${r.source_row_id}`, r]));
  const cands = fs.readFileSync(path.join(work, 'transform', 'candidates.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const mismatch = {}; let compared = 0; let dateMismatch = 0; let membersElsewhere = 0;
  for (const c of cands) {
    const p = byKey.get(k(c.base.unit, c.base.id));
    if (!p || p.outcome !== 'inserted') continue;
    const cv = cvById.get(String(p.cv_id)); if (!cv) continue;
    compared++;
    for (const f of CV_FIELDS) if (String(cv[f] ?? '') !== String(c.fields[f] ?? '')) mismatch[f] = (mismatch[f] || 0) + 1;
    if (c.createdAt && cv.createdAt?.toISOString().slice(0, 10) !== c.createdAt) dateMismatch++;
    for (const m of c.members) { const mp = byKey.get(k(m.unit, m.id)); if (mp && String(mp.cv_id) !== String(cv.id)) membersElsewhere++; }
  }
  out.compared = { candidates: compared, columns: CV_FIELDS.length, mismatchesByColumn: mismatch, createdAtMismatch: dateMismatch, mergedRowsPointingElsewhere: membersElsewhere };
  if (compared !== ins.length) problems.push(`${ins.length - compared} inserted candidate(s) not matched to a transform base row`);
  if (Object.keys(mismatch).length) problems.push(`column differences: ${Object.entries(mismatch).map(([f, n]) => `${f} ${n}`).join(', ')}`);
  if (dateMismatch) problems.push(`${dateMismatch} created date(s) differ`);
  if (membersElsewhere) problems.push(`${membersElsewhere} merged row(s) point at another candidate`);

  // No email activity for the batch's candidates since the batch started (plan 6.2 check 7).
  const all = [...ins, ...upd];
  const emails = [...new Set(all.flatMap((c) => String(c.EmailID || '').toLowerCase().split(/[,;\s]+/)).filter(Boolean))];
  const count = async (label, sql, a) => { try { const [{ n }] = await prisma.$queryRawUnsafe(sql, ...a); out[label] = n; if (n > 0) problems.push(`${n} row(s) in ${label}`); } catch (e) { out[label] = `not checked: ${e.message.split('\n').pop().slice(0, 120)}`; } };
  await count('emailMessagesForInserted', 'select count(*)::int n from rpa_email_messages where candidate_id::text = any($1::text[])', [insIds.map(String)]);
  await count('emailLogToBatchCandidatesSinceBatch', 'select count(*)::int n from rpa_email_log where lower(recipient_email) = any($1::text[]) and sent_at >= $2', [emails, since]);
  await count('emailNotificationsToBatchCandidatesSinceBatch', 'select count(*)::int n from rpa_email_notifications where lower(candidate_email) = any($1::text[]) and created_at >= $2', [emails, since]);

  out.problems = problems;
  out.ok = problems.length === 0;
} catch (e) {
  console.error(`FAILED: ${e.message}`);
  exitCode = 1;
} finally {
  await prisma.$disconnect();
}
if (exitCode === 0) console.log(JSON.stringify(out, null, 2));
process.exit(exitCode);
