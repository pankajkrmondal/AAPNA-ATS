// Stage 2, load ONE sheet. docs/Phase 4/PLAN-Legacy-Migration-Stage2-3-Excel-Naukri-Resumes.md, sections 3 and 4.
// Insert when the candidate is new; otherwise enrich the existing record by the Stage 1 rule
// (PLAN-MS-Access-Data-Migration-Mapping.md 3.9). Every source row is recorded in
// rpa_legacy_import_rows. No email is sent: no mail function is imported or called.
//
//   cd backend
//   node scripts/legacy-migration-excel/3-load.mjs --work <work folder> --file <n> --env staging --expect-db recruitmentautomationdb            (dry run: reads only)
//   node scripts/legacy-migration-excel/3-load.mjs --work <work folder> --file <n> --env staging --expect-db recruitmentautomationdb --apply
//   <n> = the load-order number of the sheet (dry-run report, "Per sheet, in load order"; transform/units.json "order").
//
// Options: --no-vectors  skip the search-entry step (3b-retry-vectors.mjs creates them later)
// Guards: --env and --expect-db must belong together and match the connected database; production
// (dry run included) needs --allow-production. A re-run skips every source row already recorded.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { argOf, prepareEnv, assertDatabase } from './lib/env.mjs';
import { SOURCE_KIND, TAG, HISTORY_FIELDS, CV_FIELDS } from './lib/layouts.mjs';
import { getMissingFields } from '../legacy-migration/lib/missing-fields.mjs';

const argv = process.argv; const arg = argOf(argv);
const work = arg('--work'); const fileNo = Number(arg('--file')); const envName = arg('--env'); const expectDb = arg('--expect-db');
const apply = argv.includes('--apply'); const noVectors = argv.includes('--no-vectors');
if (!work || !fileNo || !envName || !expectDb) {
  console.error('Usage: node 3-load.mjs --work <folder> --file <n> --env <staging|production> --expect-db <database> [--apply] [--no-vectors] [--allow-production]');
  process.exit(2);
}
prepareEnv({ envName, expectDb, writes: true, allowProduction: argv.includes('--allow-production'), work });
const { default: prisma } = await import('../../src/config/database.js');
const { sanitizeMatchEmails, sanitizeMatchContacts, findExistingCandidateMatch } = await import('../../src/services/hrUpload.service.js');
const { saveCandidateVector } = await import('../../src/services/vectorStore.service.js');

const empty = (v) => v === null || v === undefined || String(v).trim() === '' || String(v).trim().toLowerCase() === 'null';
const plain = (v) => (v === null || v === undefined ? null : typeof v === 'bigint' ? Number(v) : v instanceof Date ? v.toISOString() : typeof v === 'object' && v.constructor?.name === 'Decimal' ? v.toString() : v);
const flat = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const readLines = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
let exitCode = 0;
try {
  const db = await assertDatabase(prisma, expectDb);
  const [{ has_table: hasTable, has_label: hasLabel }] = await prisma.$queryRawUnsafe(`select
    to_regclass('public.rpa_legacy_import_rows') is not null as has_table,
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'rpa_cv' and column_name = 'legacy_source') as has_label`);
  if (!hasTable) { console.error('REFUSED: table rpa_legacy_import_rows does not exist. Apply prisma/ddl/2026-11-17-legacy-import-rows.sql first.'); process.exit(1); }
  if (!hasLabel) { console.error('REFUSED: column rpa_cv.legacy_source does not exist. Apply prisma/ddl/2026-11-17-legacy-source-label.sql first.'); process.exit(1); }

  const units = JSON.parse(fs.readFileSync(path.join(work, 'transform', 'units.json'), 'utf8'));
  const unitByN = new Map(units.map((u) => [u.n, u]));
  const unit = units.find((u) => u.order === fileNo);
  if (!unit) { console.error(`Unknown --file ${fileNo}: there are ${units.length} sheets (1..${units.length}).`); process.exit(2); }
  const keyOf = (u, id) => `${unitByN.get(u).file}\u0000${unitByN.get(u).sheet}\u0000${id}`;
  const allRows = readLines(path.join(work, 'transform', 'rows.jsonl'));
  const rowByKey = new Map(allRows.map((r) => [keyOf(r.unit, r.id), r]));
  const candidates = readLines(path.join(work, 'transform', 'candidates.jsonl')).filter((c) => c.loadUnit === unit.n)
    .sort((a, b) => (a.createdAt || '9999').localeCompare(b.createdAt || '9999') || a.gid - b.gid); // oldest first (R8)
  const otherRows = allRows.filter((r) => r.unit === unit.n && r.status !== 'usable');

  const done = new Set((await prisma.$queryRaw`
    SELECT source_file, source_table, source_row_id FROM rpa_legacy_import_rows WHERE source_kind = ${SOURCE_KIND}`)
    .map((r) => `${r.source_file}\u0000${r.source_table}\u0000${r.source_row_id}`));

  const batchId = crypto.randomUUID();
  const now = new Date();
  const fileName = unit.file.split(/[\\/]/).pop();
  console.log(`${apply ? 'APPLY' : 'DRY RUN (nothing is written)'}  sheet ${unit.order} "${fileName} | ${unit.sheet}"  database ${db}  env ${envName}`);
  console.log(`Batch ${batchId}${apply ? '' : ' (not used in a dry run)'}`);

  const count = { inserted: 0, updated_existing: 0, merged_in_file: 0, skipped_blank: 0, rejected_min_fields: 0, already_done: 0, vectors: 0, vector_skipped_no_email: 0, vector_failed: 0, updated_no_change: 0, history_appended: 0, truncation_repaired: 0 };
  const updatedFieldCounts = {};
  const record = (tx, src, outcome, cvId, changed, warnings) => {
    const u = unitByN.get(src.unit);
    return tx.$executeRaw`
      INSERT INTO rpa_legacy_import_rows (batch_id, source_kind, source_file, source_table, source_row_id, raw_row, outcome, changed_fields, cv_id, warnings)
      VALUES (${batchId}::uuid, ${SOURCE_KIND}, ${u.file}, ${u.sheet}, ${src.id}, ${JSON.stringify(src.raw)}::jsonb, ${outcome},
              ${changed ? JSON.stringify(changed) : null}::jsonb, ${cvId}, ${JSON.stringify(warnings || [])}::jsonb)`;
  };

  for (const c of candidates) {
    if (done.has(keyOf(c.base.unit, c.base.id))) { count.already_done += c.members.length; continue; }
    const f = c.fields;
    const cleanEmails = sanitizeMatchEmails(f.EmailID);
    const cleanContacts = sanitizeMatchContacts(f.ContactNumber);
    const existing = await findExistingCandidateMatch(prisma, cleanContacts, cleanEmails);
    const members = c.members.map((m) => rowByKey.get(keyOf(m.unit, m.id)));
    const baseRow = members.find((m) => m.unit === c.base.unit && m.id === c.base.id);
    const mergedRows = members.filter((m) => m !== baseRow);
    const groupWarnings = [...c.warnings, ...(c.joined ? ['status_joined'] : []), ...(c.differentNames ? ['rows_have_different_names'] : []), ...c.conflicts.map((k) => `conflict:${k}`)];

    if (!existing) {
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
        legacy_source: SOURCE_KIND, // label "Excel" on Search Candidate (decision S16: display name unchanged for now)
        legacy_relation: 'imported',
        createdAt: c.createdAt ? new Date(`${c.createdAt}T00:00:00Z`) : now, // the date in the file
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
          const vectorData = { ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)), unique_key: cleanEmails[0] };
          const metadata = await saveCandidateVector(cvId, vectorData);
          if (metadata) { count.vectors++; await prisma.rpa_cv.update({ where: { id: cvId }, data: { MetaData: JSON.stringify(metadata) } }); } else count.vector_failed++;
        }
      }
      continue;
    }

    // Candidate already in the ATS: fill empty fields, leave filled ones alone, append legacy
    // history under a label, add extra emails and phones. createdAt is not changed.
    const upd = {};
    for (const k of CV_FIELDS) {
      if (k === 'EmailID' || k === 'ContactNumber' || !f[k]) continue;
      if (empty(existing[k])) { upd[k] = f[k]; continue; }
      if (!HISTORY_FIELDS.includes(k)) continue;
      const have = String(existing[k]); const inc = String(f[k]);
      if (flat(have).includes(flat(inc))) continue; // the same note is already there
      // Truncation repair (plan 3.1): the ATS holds the first ~255 characters of this note
      // (cut when the sheets were loaded into Access); the full text replaces it.
      if (have.length >= 250 && have.length <= 255 && inc.length > have.length && flat(inc).startsWith(flat(have))) { upd[k] = inc; count.truncation_repaired++; continue; }
      upd[k] = `${have}\n\nLegacy (Excel: ${fileName}, ${c.createdAt || 'no date'}): ${inc}`; count.history_appended++;
    }
    const haveEmails = String(existing.EmailID || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
    const extraEmails = cleanEmails.filter((e) => !haveEmails.includes(e));
    if (extraEmails.length) upd.EmailID = [...(empty(existing.EmailID) ? [] : [String(existing.EmailID).trim()]), ...extraEmails].join(', ');
    const havePhones = String(existing.ContactNumber || '').split(',').map((n) => n.replace(/\D/g, '').slice(-10)).filter(Boolean);
    const extraPhones = cleanContacts.filter((n) => !havePhones.includes(n));
    if (extraPhones.length) upd.ContactNumber = [...(empty(existing.ContactNumber) ? [] : [String(existing.ContactNumber).trim()]), ...extraPhones].join(', ');
    if (upd.TotalExperienceYears && existing.TotalExperienceYearsNumeric === null && c.numeric.TotalExperienceYearsNumeric !== null) upd.TotalExperienceYearsNumeric = c.numeric.TotalExperienceYearsNumeric;
    if (upd.ExpectedCTC_LPA && existing.ExpectedCTCNumeric === null && c.numeric.ExpectedCTCNumeric !== null) upd.ExpectedCTCNumeric = c.numeric.ExpectedCTCNumeric;
    if (upd.NoticePeriod && existing.NoticePeriodDays === null && c.numeric.NoticePeriodDays !== null) upd.NoticePeriodDays = c.numeric.NoticePeriodDays;
    try { // fields that are no longer missing come off the candidate's missing-data list
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
      // Label "Also in Excel", only when the candidate has no legacy label yet: the first legacy
      // import to touch a candidate keeps its label (plan section 3). Removed by 4-rollback-batch.mjs.
      if (!existing.legacy_source) await tx.rpa_cv.update({ where: { id: existing.id }, data: { legacy_source: SOURCE_KIND, legacy_relation: 'matched' } });
      await record(tx, baseRow, 'updated_existing', existing.id, changed, groupWarnings);
      for (const m of mergedRows) await record(tx, m, 'merged_in_file', existing.id, null, m.warnings);
    }, { timeout: 60000, maxWait: 20000 });
  }

  // Rows of this sheet that become no candidate: blank (V10) and no contact (V11).
  for (const r of otherRows) {
    if (done.has(keyOf(r.unit, r.id))) { count.already_done++; continue; }
    const outcome = r.status === 'blank' ? 'skipped_blank' : 'rejected_min_fields';
    count[outcome]++;
    if (apply) await record(prisma, r, outcome, null, null, r.warnings);
  }

  // Reconciliation: every source row handled in this run has exactly one outcome.
  const unitRows = allRows.filter((r) => r.unit === unit.n);
  const fromOtherSheets = candidates.reduce((a, c) => a + c.members.filter((m) => m.unit !== unit.n).length, 0);
  const inEarlierRuns = unitRows.filter((r) => r.status === 'usable' && r.loadUnit !== unit.n).length;
  const handled = count.inserted + count.updated_existing + count.merged_in_file + count.skipped_blank + count.rejected_min_fields + count.already_done;
  const expected = unitRows.length - inEarlierRuns + fromOtherSheets;
  const summary = {
    mode: apply ? 'apply' : 'dry-run', batchId: apply ? batchId : null, database: db, file: fileNo, unit: `${fileName} | ${unit.sheet}`, at: now.toISOString(),
    rowsInSheet: unitRows.length, rowsOfThisSheetLoadedWithAnEarlierSheet: inEarlierRuns, rowsOfLaterSheetsLoadedNow: fromOtherSheets,
    expectedRowsThisRun: expected, handledRowsThisRun: handled, reconciles: handled === expected, ...count, fieldsFilledOnExisting: updatedFieldCounts,
  };
  console.log(JSON.stringify(summary, null, 2));
  fs.mkdirSync(path.join(work, 'report'), { recursive: true });
  fs.writeFileSync(path.join(work, 'report', `load-${envName}-${fileNo}-${apply ? batchId : 'dry-run'}.json`), JSON.stringify(summary, null, 2));
  if (!summary.reconciles) { console.error('RECONCILIATION FAILED: the row counts do not add up.'); exitCode = 1; }
} catch (e) {
  console.error(`FAILED: ${e.message}`);
  exitCode = 1;
} finally {
  await prisma.$disconnect();
}
process.exit(exitCode); // the ATS modules keep handles open (logger, queues); end the script explicitly
