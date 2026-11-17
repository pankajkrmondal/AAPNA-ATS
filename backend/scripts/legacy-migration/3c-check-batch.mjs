// Read-only check of ONE import batch (one table run of 3-load.mjs). SELECT statements only.
// Prints counts and column names, never candidate values.
//
//   cd backend
//   node scripts/legacy-migration/3c-check-batch.mjs --work <work folder> --batch <batch id> --env <staging|production> --expect-db <database>
//
// Checks: provenance rows of the batch; every inserted candidate exists, carries the import
// tag and the legacy label, has MetaData and a search entry (if it has an email), and equals
// the transform output on every mapped column and the created date; matched candidates carry
// the label; no email activity for the inserted candidates.
// Exit code 0 = the check ran (read "problems" in the output), 1 = it could not run.
import fs from 'fs';
import path from 'path';
import { CV_FIELDS, TAG, SOURCE_KIND } from './lib/mapping.mjs';

const argv = process.argv;
const arg = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
const work = arg('--work'); const batch = arg('--batch'); const envName = arg('--env'); const expectDb = arg('--expect-db');
if (!work || !batch || !envName || !expectDb) { console.error('Usage: node 3c-check-batch.mjs --work <folder> --batch <id> --env <staging|production> --expect-db <database>'); process.exit(2); }
process.env.NODE_ENV = envName;
process.env.LOG_LEVEL = 'error';
process.env.LOG_DIR = path.join(work, 'logs');
const { default: prisma } = await import('../../src/config/database.js');

const out = {}; const problems = [];
let exitCode = 0;
try {
  const [{ db }] = await prisma.$queryRawUnsafe('select current_database() db');
  if (db !== expectDb) { console.error(`REFUSED: connected to "${db}" but --expect-db is "${expectDb}". Nothing was run.`); process.exit(1); }
  out.database = db; out.batch = batch;
  const prov = await prisma.$queryRaw`SELECT outcome, cv_id, source_table, source_row_id FROM rpa_legacy_import_rows WHERE batch_id = ${batch}::uuid`;
  if (prov.length === 0) { console.error(`No provenance rows for batch ${batch}.`); process.exit(1); }
  out.provenanceRows = prov.length;
  out.byOutcome = prov.reduce((a, r) => ((a[r.outcome] = (a[r.outcome] || 0) + 1), a), {});

  const insIds = [...new Set(prov.filter((r) => r.outcome === 'inserted').map((r) => r.cv_id))];
  const updIds = [...new Set(prov.filter((r) => r.outcome === 'updated_existing').map((r) => r.cv_id))];
  const cvIds = [...new Set([...insIds, ...updIds])];
  const cvs = await prisma.rpa_cv.findMany({ where: { id: { in: cvIds } } });
  const cvById = new Map(cvs.map((c) => [String(c.id), c]));
  const ins = insIds.map((id) => cvById.get(String(id))).filter(Boolean);
  const upd = updIds.map((id) => cvById.get(String(id))).filter(Boolean);
  const hasLabel = cvs.length === 0 || 'legacy_source' in cvs[0];

  out.inserted = {
    candidates: insIds.length,
    found: ins.length,
    withImportTag: ins.filter((c) => c.last_action_context === TAG).length,
    withLabel: hasLabel ? ins.filter((c) => c.legacy_source === SOURCE_KIND).length : 'no label column',
    withMetaData: ins.filter((c) => c.MetaData).length,
    withEmail: ins.filter((c) => String(c.EmailID || '').trim()).length,
  };
  out.matchedExisting = { candidates: updIds.length, found: upd.length, withLabel: hasLabel ? upd.filter((c) => c.legacy_source === SOURCE_KIND).length : 'no label column' };
  const ids = insIds.map(Number);
  const [{ n: vec }] = ids.length ? await prisma.$queryRawUnsafe('select count(distinct candidate_id)::int n from public.rpa_cv_vectors where candidate_id = any($1::bigint[]) and embedding is not null', ids) : [{ n: 0 }];
  out.inserted.withSearchEntry = vec;

  if (ins.length !== insIds.length) problems.push(`${insIds.length - ins.length} inserted candidate(s) not found`);
  if (upd.length !== updIds.length) problems.push(`${updIds.length - upd.length} matched candidate(s) not found`);
  if (vec < out.inserted.withEmail) problems.push(`${out.inserted.withEmail - vec} candidate(s) with an email have no search entry (run 3b-retry-vectors.mjs)`);
  if (hasLabel && out.inserted.withLabel !== ins.length) problems.push(`${ins.length - out.inserted.withLabel} inserted candidate(s) without the legacy label`);
  if (hasLabel && out.matchedExisting.withLabel !== upd.length) problems.push(`${upd.length - out.matchedExisting.withLabel} matched candidate(s) without the legacy label`);

  // Inserted candidates against the transform output, column by column.
  const byKey = new Map(prov.map((r) => [`${r.source_table}|${r.source_row_id}`, r]));
  const cands = fs.readFileSync(path.join(work, 'transform', 'candidates.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const mismatch = {}; let compared = 0; let dateMismatch = 0; let membersElsewhere = 0;
  for (const c of cands) {
    const p = byKey.get(`${c.base.table}|${c.base.id}`);
    if (!p || p.outcome !== 'inserted') continue;
    const cv = cvById.get(String(p.cv_id)); if (!cv) continue;
    compared++;
    for (const k of CV_FIELDS) if (String(cv[k] ?? '') !== String(c.fields[k] ?? '')) mismatch[k] = (mismatch[k] || 0) + 1;
    if (c.createdAt && cv.createdAt?.toISOString().slice(0, 10) !== c.createdAt) dateMismatch++;
    for (const m of c.members) { const mp = byKey.get(`${m.table}|${m.id}`); if (mp && String(mp.cv_id) !== String(cv.id)) membersElsewhere++; }
  }
  out.compared = { candidates: compared, columns: CV_FIELDS.length, mismatchesByColumn: mismatch, createdAtMismatch: dateMismatch, mergedRowsPointingElsewhere: membersElsewhere };
  if (compared !== ins.length) problems.push(`${ins.length - compared} inserted candidate(s) not matched to a transform base row`);
  if (Object.keys(mismatch).length) problems.push(`column differences: ${Object.entries(mismatch).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  if (dateMismatch) problems.push(`${dateMismatch} created date(s) differ`);
  if (membersElsewhere) problems.push(`${membersElsewhere} merged row(s) point at another candidate`);

  // No email activity for the inserted candidates.
  const emails = [...new Set(ins.flatMap((c) => String(c.EmailID || '').toLowerCase().split(/[,;\s]+/)).filter(Boolean))];
  const count = async (label, sql, a) => { try { const [{ n }] = await prisma.$queryRawUnsafe(sql, a); out[label] = n; if (n > 0) problems.push(`${n} row(s) in ${label}`); } catch (e) { out[label] = `not checked: ${e.message.split('\n').pop().slice(0, 120)}`; } };
  await count('emailMessagesForInserted', 'select count(*)::int n from rpa_email_messages where candidate_id::text = any($1::text[])', insIds.map(String));
  await count('emailLogToInserted', 'select count(*)::int n from rpa_email_log where lower(recipient_email) = any($1::text[])', emails);
  await count('emailNotificationsToInserted', 'select count(*)::int n from rpa_email_notifications where lower(candidate_email) = any($1::text[])', emails);

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
