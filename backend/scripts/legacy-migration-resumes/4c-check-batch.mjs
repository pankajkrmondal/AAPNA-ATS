#!/usr/bin/env node
// Stage 3 (resumes): read-only check of ONE load batch (4-load.mjs --apply). SELECT statements only.
// Prints counts and column names, never candidate values. As Stage 2's 3c-check-batch.mjs, for resumes.
//
//   cd backend
//   node scripts/legacy-migration-resumes/4c-check-batch.mjs --work <work> --batch <id> --env <staging|production> --expect-db <database>
//
// Checks: provenance rows of the batch by outcome; every inserted candidate exists, carries the import tag and the
// 'resume' / 'imported' label, a CV (cvFileUrl + cv_file_item_id), resume text, MetaData and a search entry, and equals
// the transform output column by column; every matched candidate carries a legacy label, and the CV this batch
// attached is still the one on the record; no e-mail activity for the batch's candidates since the batch.
// Exit code 0 = the check ran (read "problems"), 1 = it could not run.
import fs from 'node:fs';
import path from 'node:path';
import { argOf, prepareEnv, assertDatabase } from '../legacy-migration-excel/lib/env.mjs';
import { SOURCE_KIND, TAG, JSON_FIELDS, NUMERIC_FIELDS, canonical, readLines, asText } from './lib/constants.mjs';

const argv = process.argv; const arg = argOf(argv);
const work = arg('--work'); const batch = arg('--batch'); const envName = arg('--env'); const expectDb = arg('--expect-db');
if (!work || !batch || !envName || !expectDb) { console.error('Usage: node 4c-check-batch.mjs --work <folder> --batch <id> --env <staging|production> --expect-db <database>'); process.exit(2); }
prepareEnv({ envName, expectDb, writes: false, allowProduction: false, work, logLevel: 'error' });
const { default: prisma } = await import('../../src/config/database.js');

const out = {}; const problems = [];
let exitCode = 0;
try {
  out.database = await assertDatabase(prisma, expectDb); out.batch = batch;
  const prov = await prisma.$queryRaw`SELECT outcome, cv_id, source_table, source_row_id, changed_fields, created_at FROM rpa_legacy_import_rows WHERE batch_id = ${batch}::uuid AND source_kind = ${SOURCE_KIND}`;
  if (prov.length === 0) { console.error(`No resume provenance rows for batch ${batch}.`); process.exit(1); }
  out.provenanceRows = prov.length;
  out.byOutcome = prov.reduce((a, r) => ((a[r.outcome] = (a[r.outcome] || 0) + 1), a), {});
  const since = prov.reduce((m, r) => (r.created_at < m ? r.created_at : m), prov[0].created_at);

  const insRows = prov.filter((r) => r.outcome === 'inserted');
  const updRows = prov.filter((r) => r.outcome === 'updated_existing');
  const insIds = [...new Set(insRows.map((r) => r.cv_id))];
  const updIds = [...new Set(updRows.map((r) => r.cv_id))];
  const cvs = await prisma.rpa_cv.findMany({ where: { id: { in: [...new Set([...insIds, ...updIds])] } } });
  const cvById = new Map(cvs.map((c) => [String(c.id), c]));
  const ins = insIds.map((id) => cvById.get(String(id))).filter(Boolean);
  const upd = updIds.map((id) => cvById.get(String(id))).filter(Boolean);
  out.inserted = {
    candidates: insIds.length, found: ins.length,
    withImportTag: ins.filter((c) => c.last_action_context === TAG).length,
    withLabel: ins.filter((c) => c.legacy_source === SOURCE_KIND && c.legacy_relation === 'imported').length,
    withCv: ins.filter((c) => c.cvFileUrl && c.cv_file_item_id).length,
    withResumeText: ins.filter((c) => String(c.resume_full_text || '').trim()).length,
    withMetaData: ins.filter((c) => c.MetaData).length,
    withInsights: ins.filter((c) => c.ai_profile_insights).length,
  };
  const ids = insIds.map(Number);
  const [{ n: vec }] = ids.length ? await prisma.$queryRawUnsafe('select count(distinct candidate_id)::int n from public.rpa_cv_vectors where candidate_id = any($1::bigint[]) and embedding is not null', ids) : [{ n: 0 }];
  out.inserted.withSearchEntry = vec;
  const need = (k, label) => { if (out.inserted[k] !== ins.length) problems.push(`${ins.length - out.inserted[k]} inserted candidate(s) without ${label}`); };
  if (ins.length !== insIds.length) problems.push(`${insIds.length - ins.length} inserted candidate(s) not found`);
  need('withImportTag', 'the import tag'); need('withLabel', "the 'resume' label"); need('withCv', 'a CV link and item id'); need('withResumeText', 'resume text');
  if (vec < ins.length) problems.push(`${ins.length - vec} inserted candidate(s) have no search entry (retry: 4-load.mjs does not redo them; use a vector retry)`);
  if (out.inserted.withInsights < ins.length) out.note = `${ins.length - out.inserted.withInsights} inserted candidate(s) have no AI insights yet (4b-insights.mjs)`;

  const cvAttached = updRows.filter((r) => r.changed_fields?.cv_file_item_id);
  out.matchedExisting = {
    candidates: updIds.length, found: upd.length,
    withAnyLegacyLabel: upd.filter((c) => c.legacy_source).length,
    labelledResumeByThisImport: upd.filter((c) => c.legacy_source === SOURCE_KIND && c.legacy_relation === 'matched').length,
    cvAttachedByThisBatch: cvAttached.length,
    cvStillTheAttachedOne: cvAttached.filter((r) => cvById.get(String(r.cv_id))?.cv_file_item_id === r.changed_fields.cv_file_item_id.after).length,
  };
  if (upd.length !== updIds.length) problems.push(`${updIds.length - upd.length} matched candidate(s) not found`);
  if (out.matchedExisting.withAnyLegacyLabel !== upd.length) problems.push(`${upd.length - out.matchedExisting.withAnyLegacyLabel} matched candidate(s) without a legacy label`);
  if (out.matchedExisting.cvStillTheAttachedOne !== cvAttached.length) out.matchedExisting.note = 'some attached CVs were replaced later in the ATS (allowed: HR may upload a newer CV)';

  // Inserted candidates against the transform output, column by column.
  const cands = [];
  for (const d of ['transform-sample', 'transform']) { const p = path.join(work, d, 'candidates.jsonl'); if (fs.existsSync(p)) cands.push(...readLines(fs, p)); }
  const byPrimary = new Map(cands.map((c) => [`${c.primary.sourceTable}\u0000${c.primary.sourceRowId}`, c]));
  const mismatch = {}; let compared = 0;
  for (const r of insRows) {
    const c = byPrimary.get(`${r.source_table}\u0000${r.source_row_id}`);
    const cv = cvById.get(String(r.cv_id));
    if (!c || !cv) continue;
    compared++;
    for (const [k, v] of Object.entries(c.fields)) {
      if (k === 'resume_term_updated_at') { if (!!v !== !!cv[k]) mismatch[k] = (mismatch[k] || 0) + 1; continue; }
      let same;
      if (JSON_FIELDS.includes(k)) same = canonical(cv[k] ?? null) === canonical(asText(k, v) ?? null);
      else if (NUMERIC_FIELDS.includes(k)) same = (cv[k] === null ? null : Number(cv[k])) === (v === null || v === undefined ? null : Number(v));
      else same = String(cv[k] ?? '') === String(asText(k, v) ?? '');
      if (!same) mismatch[k] = (mismatch[k] || 0) + 1;
    }
  }
  out.compared = { candidates: compared, mismatchesByColumn: mismatch };
  if (compared !== insRows.length) problems.push(`${insRows.length - compared} inserted candidate(s) not matched to a transform candidate`);
  if (Object.keys(mismatch).length) problems.push(`column differences: ${Object.entries(mismatch).map(([f, n]) => `${f} ${n}`).join(', ')}`);

  // No e-mail activity for the batch's candidates since the batch started (plan 6.2 check 7).
  const all = [...ins, ...upd];
  const emails = [...new Set(all.flatMap((c) => String(c.EmailID || '').toLowerCase().split(/[,;\s]+/)).filter(Boolean))];
  const countQ = async (label, sql, a) => { try { const [{ n }] = await prisma.$queryRawUnsafe(sql, ...a); out[label] = n; if (n > 0) problems.push(`${n} row(s) in ${label}`); } catch (e) { out[label] = `not checked: ${e.message.split('\n').pop().slice(0, 120)}`; } };
  // rpa_email_messages: inserted candidates only (a matched candidate may have mail from before the import).
  await countQ('emailMessagesForInserted', 'select count(*)::int n from rpa_email_messages where candidate_id::text = any($1::text[])', [insIds.map(String)]);
  await countQ('emailLogToBatchCandidatesSinceBatch', 'select count(*)::int n from rpa_email_log where lower(recipient_email) = any($1::text[]) and sent_at >= $2', [emails, since]);
  await countQ('emailNotificationsToBatchCandidatesSinceBatch', 'select count(*)::int n from rpa_email_notifications where lower(candidate_email) = any($1::text[]) and created_at >= $2', [emails, since]);

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
