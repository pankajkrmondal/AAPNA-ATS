// Stage 1, steps 5 and 6 of docs/Phase 4/PLAN-MS-Access-Data-Migration-Mapping.md (3.12).
// Loads ONE Access table into rpa_cv: insert when the candidate is new, otherwise
// update the existing record by the rule in 3.9. Every source row is recorded in
// rpa_legacy_import_rows. No email is sent: no mail function is imported or called.
//
//   cd backend
//   node scripts/legacy-migration/3-load.mjs --work <work folder> --table "Build & Release" --env staging --expect-db recruitmentautomationdb            (dry run: reads only)
//   node scripts/legacy-migration/3-load.mjs --work <work folder> --table "Build & Release" --env staging --expect-db recruitmentautomationdb --apply
//
// Options: --no-vectors  skip the search-vector step (it can be run later by re-running without the flag)
//
// Guards: refuses to run unless the connected database is --expect-db; refuses
// production unless --allow-production is given as well. A re-run skips every
// source row already recorded, so an interrupted run can simply be started again.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { SOURCE_KIND, TAG, RUN_ORDER, HISTORY_FIELDS, CV_FIELDS } from './lib/mapping.mjs';
import { getMissingFields } from './lib/missing-fields.mjs';

const argv = process.argv;
const arg = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
const work = arg('--work'); const table = arg('--table'); const envName = arg('--env'); const expectDb = arg('--expect-db');
const apply = argv.includes('--apply'); const noVectors = argv.includes('--no-vectors');
if (!work || !table || !envName || !expectDb) {
  console.error('Usage: node 3-load.mjs --work <folder> --table "<Access table>" --env <staging|production> --expect-db <database> [--apply] [--no-vectors]');
  process.exit(2);
}
if (!RUN_ORDER.includes(table)) { console.error(`Unknown table "${table}".`); process.exit(2); }
if (envName === 'production' && !argv.includes('--allow-production')) { console.error('REFUSED: production needs --allow-production (and sign-off, plan 3.12 step 8).'); process.exit(1); }

// The ATS modules read their settings from .env.<NODE_ENV>. Set it BEFORE importing them.
process.env.NODE_ENV = envName;
process.env.LOG_LEVEL = 'warn'; // keep candidate data off the console
process.env.LOG_DIR = path.join(work, 'logs'); // and out of backend/logs
const { default: prisma } = await import('../../src/config/database.js');
const { sanitizeMatchEmails, sanitizeMatchContacts, findExistingCandidateMatch } = await import('../../src/services/hrUpload.service.js');
const { saveCandidateVector } = await import('../../src/services/vectorStore.service.js');

const empty = (v) => v === null || v === undefined || String(v).trim() === '' || String(v).trim().toLowerCase() === 'null';
const plain = (v) => (v === null || v === undefined ? null : typeof v === 'bigint' ? Number(v) : v instanceof Date ? v.toISOString() : typeof v === 'object' && typeof v.toString === 'function' && !Array.isArray(v) && v.constructor?.name === 'Decimal' ? v.toString() : v);
const readLines = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
let exitCode = 0;
try {
  const [{ db, has_table: hasTable, has_label: hasLabel }] = await prisma.$queryRawUnsafe(`select current_database() db,
    to_regclass('public.rpa_legacy_import_rows') is not null as has_table,
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'rpa_cv' and column_name = 'legacy_source') as has_label`);
  if (db !== expectDb) { console.error(`REFUSED: connected to "${db}" but --expect-db is "${expectDb}". Nothing was run.`); process.exit(1); }
  if (!hasTable) { console.error('REFUSED: table rpa_legacy_import_rows does not exist. Apply prisma/ddl/2026-11-17-legacy-import-rows.sql first.'); process.exit(1); }
  if (!hasLabel) { console.error('REFUSED: column rpa_cv.legacy_source does not exist. Apply prisma/ddl/2026-11-17-legacy-source-label.sql first.'); process.exit(1); }

  const manifest = JSON.parse(fs.readFileSync(path.join(work, 'manifest.json'), 'utf8').replace(/^﻿/, ''));
  const sourceFile = manifest.sourceFile;
  const allRows = readLines(path.join(work, 'transform', 'rows.jsonl'));
  const rowByKey = new Map(allRows.map((r) => [`${r.table}\u0000${r.id}`, r]));
  const candidates = readLines(path.join(work, 'transform', 'candidates.jsonl')).filter((c) => c.loadTable === table)
    .sort((a, b) => (a.createdAt || '9999').localeCompare(b.createdAt || '9999') || a.gid - b.gid); // oldest first (R8)
  const otherRows = allRows.filter((r) => r.table === table && r.status !== 'usable');

  const done = new Set((await prisma.$queryRaw`
    SELECT source_table, source_row_id FROM rpa_legacy_import_rows
    WHERE source_kind = ${SOURCE_KIND} AND source_file = ${sourceFile}`).map((r) => `${r.source_table}\u0000${r.source_row_id}`));

  const batchId = crypto.randomUUID();
  const now = new Date();
  console.log(`${apply ? 'APPLY' : 'DRY RUN (nothing is written)'}  table "${table}"  database ${db}  env ${envName}`);
  console.log(`Batch ${batchId}${apply ? '' : ' (not used in a dry run)'}`);

  const count = { inserted: 0, updated_existing: 0, merged_in_file: 0, skipped_blank: 0, rejected_min_fields: 0, already_done: 0, vectors: 0, vector_skipped_no_email: 0, vector_failed: 0, updated_no_change: 0 };
  const updatedFieldCounts = {};
  const record = (tx, src, outcome, cvId, changed, warnings) => tx.$executeRaw`
    INSERT INTO rpa_legacy_import_rows (batch_id, source_kind, source_file, source_table, source_row_id, raw_row, outcome, changed_fields, cv_id, warnings)
    VALUES (${batchId}::uuid, ${SOURCE_KIND}, ${sourceFile}, ${src.table}, ${src.id}, ${JSON.stringify(src.raw)}::jsonb, ${outcome},
            ${changed ? JSON.stringify(changed) : null}::jsonb, ${cvId}, ${JSON.stringify(warnings || [])}::jsonb)`;

  for (const c of candidates) {
    const baseKey = `${c.base.table}\u0000${c.base.id}`;
    if (done.has(baseKey)) { count.already_done += c.members.length; continue; }
    const f = c.fields;
    const cleanEmails = sanitizeMatchEmails(f.EmailID);
    const cleanContacts = sanitizeMatchContacts(f.ContactNumber);
    const existing = await findExistingCandidateMatch(prisma, cleanContacts, cleanEmails);
    const members = c.members.map((m) => rowByKey.get(`${m.table}\u0000${m.id}`));
    const baseRow = members.find((m) => m.table === c.base.table && m.id === c.base.id);
    const mergedRows = members.filter((m) => m !== baseRow);
    const groupWarnings = [...c.warnings, ...(c.joined ? ['status_joined'] : []), ...(c.differentNames ? ['rows_have_different_names'] : []), ...c.conflicts.map((k) => `conflict:${k}`)];

    if (!existing) {
      // Same shape getMissingFields() sees in HR Upload: the education scores as an object.
      const parsedLike = { ...f, EducationalScoresPercentage: f.EducationalScoresPercentage ? JSON.parse(f.EducationalScoresPercentage) : {} };
      const missing = getMissingFields(parsedLike);
      const data = {
        ...Object.fromEntries(CV_FIELDS.map((k) => [k, f[k] || null])),
        TotalExperienceYearsNumeric: c.numeric.TotalExperienceYearsNumeric,
        ExpectedCTCNumeric: c.numeric.ExpectedCTCNumeric,
        NoticePeriodDays: c.numeric.NoticePeriodDays,
        statusActive: Object.keys(missing).length > 0 ? 'INACTIVE' : 'ACTIVE',
        missingData: JSON.stringify(missing),
        last_action_context: TAG,
        last_action_by: TAG,
        // Label on Search Candidate: "MS Access" (scope SCOPE-Legacy-Source-Label-and-Filter.md).
        legacy_source: SOURCE_KIND,
        legacy_relation: 'imported',
        createdAt: c.createdAt ? new Date(`${c.createdAt}T00:00:00Z`) : now, // decision 4: the original Access date
        modifiedAt: now,
        is_referral: false,
      };
      count.inserted++; count.merged_in_file += mergedRows.length;
      if (!apply) continue;
      const cvId = await prisma.$transaction(async (tx) => {
        const cv = await tx.rpa_cv.create({ data, select: { id: true } });
        await record(tx, baseRow, 'inserted', cv.id, null, groupWarnings);
        for (const m of mergedRows) await record(tx, m, 'merged_in_file', cv.id, null, m.warnings);
        return cv.id;
      }, { timeout: 60000, maxWait: 20000 });
      if (!noVectors) {
        if (!f.EmailID) count.vector_skipped_no_email++;
        else {
          // Decision 7: the existing function, unchanged, with the mapped fields.
          const vectorData = { ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)), unique_key: cleanEmails[0] };
          const metadata = await saveCandidateVector(cvId, vectorData);
          if (metadata) { count.vectors++; await prisma.rpa_cv.update({ where: { id: cvId }, data: { MetaData: JSON.stringify(metadata) } }); } else count.vector_failed++;
        }
      }
      continue;
    }

    // Candidate already in the ATS (3.9): fill empty fields, leave filled ones alone,
    // append legacy history under a label, add extra emails and phones. createdAt is not changed.
    const upd = {};
    for (const k of CV_FIELDS) {
      if (k === 'EmailID' || k === 'ContactNumber' || !f[k]) continue;
      if (empty(existing[k])) upd[k] = f[k];
      else if (HISTORY_FIELDS.includes(k) && !String(existing[k]).includes(f[k])) upd[k] = `${existing[k]}\n\nLegacy (MS Access, ${c.createdAt || 'no date'}): ${f[k]}`;
    }
    const haveEmails = String(existing.EmailID || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
    const extraEmails = cleanEmails.filter((e) => !haveEmails.includes(e));
    if (extraEmails.length) upd.EmailID = [...(empty(existing.EmailID) ? [] : [String(existing.EmailID).trim()]), ...extraEmails].join(', ');
    const havePhones = String(existing.ContactNumber || '').split(',').map((n) => n.replace(/\s+/g, '')).filter(Boolean);
    const extraPhones = cleanContacts.filter((n) => !havePhones.includes(n));
    if (extraPhones.length) upd.ContactNumber = [...(empty(existing.ContactNumber) ? [] : [String(existing.ContactNumber).trim()]), ...extraPhones].join(', ');
    if (upd.TotalExperienceYears && existing.TotalExperienceYearsNumeric === null && c.numeric.TotalExperienceYearsNumeric !== null) upd.TotalExperienceYearsNumeric = c.numeric.TotalExperienceYearsNumeric;
    if (upd.ExpectedCTC_LPA && existing.ExpectedCTCNumeric === null && c.numeric.ExpectedCTCNumeric !== null) upd.ExpectedCTCNumeric = c.numeric.ExpectedCTCNumeric;
    if (upd.NoticePeriod && existing.NoticePeriodDays === null && c.numeric.NoticePeriodDays !== null) upd.NoticePeriodDays = c.numeric.NoticePeriodDays;
    // Fields that are no longer missing come off the candidate's missing-data list.
    try {
      const miss = existing.missingData ? JSON.parse(existing.missingData) : null;
      if (miss && typeof miss === 'object') {
        const before = Object.keys(miss).length;
        for (const k of Object.keys(upd)) delete miss[k];
        if (Object.keys(miss).length !== before) { upd.missingData = JSON.stringify(miss); upd.statusActive = Object.keys(miss).length > 0 ? 'INACTIVE' : 'ACTIVE'; }
      }
    } catch { /* unreadable missingData: leave it as it is */ }
    const changed = Object.fromEntries(Object.keys(upd).map((k) => [k, { before: plain(existing[k]), after: plain(upd[k]) }]));
    for (const k of Object.keys(upd)) updatedFieldCounts[k] = (updatedFieldCounts[k] || 0) + 1;
    count.updated_existing++; count.merged_in_file += mergedRows.length;
    if (Object.keys(upd).length === 0) count.updated_no_change++;
    if (!apply) continue;
    await prisma.$transaction(async (tx) => {
      if (Object.keys(upd).length) {
        changed.modifiedAt = { before: plain(existing.modifiedAt), after: now.toISOString() };
        await tx.rpa_cv.update({ where: { id: existing.id }, data: { ...upd, modifiedAt: now } });
      }
      // Label "Also in MS Access", unless the candidate already has a label (for
      // example one an earlier table of this import created). Not in `changed`:
      // 4-rollback-batch.mjs removes "matched" labels itself. modifiedAt is not touched.
      if (!existing.legacy_source) {
        await tx.rpa_cv.update({ where: { id: existing.id }, data: { legacy_source: SOURCE_KIND, legacy_relation: 'matched' } });
      }
      await record(tx, baseRow, 'updated_existing', existing.id, changed, groupWarnings);
      for (const m of mergedRows) await record(tx, m, 'merged_in_file', existing.id, null, m.warnings);
    }, { timeout: 60000, maxWait: 20000 });
  }

  // Rows of this table that become no candidate: blank (V10) and no email / no phone (V11).
  for (const r of otherRows) {
    if (done.has(`${r.table}\u0000${r.id}`)) { count.already_done++; continue; }
    const outcome = r.status === 'blank' ? 'skipped_blank' : 'rejected_min_fields';
    count[outcome]++;
    if (apply) await record(prisma, r, outcome, null, null, r.warnings);
  }

  // Reconciliation (3.12): every source row handled in this run has exactly one outcome.
  const tableRows = allRows.filter((r) => r.table === table);
  const fromOtherTables = candidates.reduce((a, c) => a + c.members.filter((m) => m.table !== table).length, 0);
  const inEarlierRuns = tableRows.filter((r) => r.status === 'usable' && r.loadTable !== table).length;
  const handled = count.inserted + count.updated_existing + count.merged_in_file + count.skipped_blank + count.rejected_min_fields + count.already_done;
  const expected = tableRows.length - inEarlierRuns + fromOtherTables;
  const summary = {
    mode: apply ? 'apply' : 'dry-run', batchId: apply ? batchId : null, database: db, table, at: now.toISOString(),
    rowsInTable: tableRows.length, rowsOfThisTableLoadedWithAnEarlierTable: inEarlierRuns, rowsOfLaterTablesLoadedNow: fromOtherTables,
    expectedRowsThisRun: expected, handledRowsThisRun: handled, reconciles: handled === expected, ...count, fieldsFilledOnExisting: updatedFieldCounts,
  };
  console.log(JSON.stringify(summary, null, 2));
  fs.mkdirSync(path.join(work, 'report'), { recursive: true });
  fs.writeFileSync(path.join(work, 'report', `load-${RUN_ORDER.indexOf(table) + 1}-${apply ? batchId : 'dry-run'}.json`), JSON.stringify(summary, null, 2));
  if (!summary.reconciles) { console.error('RECONCILIATION FAILED: the row counts do not add up.'); exitCode = 1; }
} catch (e) {
  console.error(`FAILED: ${e.message}`);
  exitCode = 1;
} finally {
  await prisma.$disconnect();
}
process.exit(exitCode); // the ATS modules keep handles open (logger, queues); end the script explicitly
