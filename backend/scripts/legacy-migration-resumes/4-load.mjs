#!/usr/bin/env node
// Stage 3 (resumes), step 4: load ONE folder (or the staging sample). docs/Phase 4/PLAN-Legacy-Migration-Stage2-3-Excel-Naukri-Resumes.md 5.5, 3, 3.1.
//
//   cd backend
//   node scripts/legacy-migration-resumes/4-load.mjs --work <work> --sample   --env staging --expect-db recruitmentautomationdb [--apply]
//   node scripts/legacy-migration-resumes/4-load.mjs --work <work> --folder 3 --env production --expect-db recruitmentautomationdbProd --allow-production [--apply]
//   --sample reads <work>/transform-sample/ (the 10 files, S18); --folder <n> reads <work>/transform/ (n = unit number, load order).
//   Options: --no-vectors (3b-style retry later), --concurrency 3 (1-4)
//
// Per person (transform candidate), in order:
//   match       findExistingCandidateMatch() on the person's validated e-mails and phones (the ATS's own function)
//   identity    matched, but no name token in common: NOT merged, review_identity_conflict for all its resumes (plan 3.1)
//   new         upload the CV to OneDrive "Legacy resumes/<year>" (this environment's drive), insert HR Upload's
//               field set + CV + resume text, tag, legacy_source 'resume' / 'imported'; then the search entry
//   existing    fill EMPTY fields only; add new e-mails and phones; attach the CV only when the candidate has none
//               (a CV HR uploaded is never replaced) and the resume text only when it has none; missingData loses
//               what is now filled (and uploadResume when a CV is attached); label only when it has none
//   provenance  one rpa_legacy_import_rows row per archive file, in the same transaction as the candidate write
// Files that become no candidate get their outcome row (duplicate, type, unreadable, no e-mail, name conflict).
// AI insights are a separate pass: 4b-insights.mjs.
//
// NEVER CALLED: runBatchParsing, dispatchBatchParsing, the resume queue, any mail function. No e-mail is sent.
// Guards: --env/--expect-db must match the connected database; production (dry run included) needs --allow-production.
// A re-run skips every file already recorded, so an interrupted run is resumed by running it again.
// An upload whose database write then fails is deleted from OneDrive again.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { argOf, prepareEnv, assertDatabase } from '../legacy-migration-excel/lib/env.mjs';
import { SOURCE_KIND, TAG, NEW_OUTCOMES, FILL_FIELDS, MISSING_KEY_OF, empty, plain, readLines } from './lib/constants.mjs';
import { sameIdentity } from './lib/identity.mjs';

const argv = process.argv; const arg = argOf(argv);
const work = arg('--work'); const envName = arg('--env'); const expectDb = arg('--expect-db');
const SAMPLE = argv.includes('--sample'); const folderNo = arg('--folder') ? Number(arg('--folder')) : null;
const apply = argv.includes('--apply'); const noVectors = argv.includes('--no-vectors');
const CONCURRENCY = Math.max(1, Math.min(4, Number(arg('--concurrency') || 3)));
if (!work || !envName || !expectDb || (SAMPLE === !!folderNo)) {
  console.error('Usage: node 4-load.mjs --work <folder> (--sample | --folder <n>) --env <staging|production> --expect-db <database> [--apply] [--allow-production] [--no-vectors] [--concurrency 3]');
  process.exit(2);
}
prepareEnv({ envName, expectDb, writes: true, allowProduction: argv.includes('--allow-production'), work, logLevel: 'error' });
const { default: prisma } = await import('../../src/config/database.js');
const { default: config } = await import('../../src/config/index.js');
const { findExistingCandidateMatch } = await import('../../src/services/hrUpload.service.js');
const { saveCandidateVector } = await import('../../src/services/vectorStore.service.js');
const { uploadFileToOneDriveDetailed, deleteDriveItem } = await import('../../src/services/onedrive.service.js');
const { resumeStatus, RESUME_STATUS } = await import('../../src/utils/resumeCheck.js');

const T = path.join(work, SAMPLE ? 'transform-sample' : 'transform');
let exitCode = 0;
try {
  const db = await assertDatabase(prisma, expectDb);
  const [{ has_table: hasTable, has_label: hasLabel, outcome_def: outcomeDef }] = await prisma.$queryRawUnsafe(`select
    to_regclass('public.rpa_legacy_import_rows') is not null as has_table,
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'rpa_cv' and column_name = 'legacy_source') as has_label,
    (select pg_get_constraintdef(oid) from pg_constraint where conname = 'chk_legacy_import_outcome' limit 1) as outcome_def`);
  if (!hasTable || !hasLabel) { console.error('REFUSED: rpa_legacy_import_rows or rpa_cv.legacy_source is missing (Stage 1 DDL).'); process.exit(1); }
  const missingOutcomes = NEW_OUTCOMES.filter((o) => !String(outcomeDef || '').includes(`'${o}'`));
  if (missingOutcomes.length && apply) { console.error(`REFUSED: the outcome constraint lacks ${missingOutcomes.join(', ')}. Apply prisma/ddl/2026-11-20-legacy-import-outcomes.sql first (plan 5.7).`); process.exit(1); }
  if (apply && !config.microsoft?.oneDriveParentId) { console.error('REFUSED: no OneDrive parent folder configured for this environment (MS_ONEDRIVE_PARENT_ID).'); process.exit(1); }

  const unitsDoc = JSON.parse(fs.readFileSync(path.join(T, 'units.json'), 'utf8'));
  if (unitsDoc.scope !== (SAMPLE ? 'sample' : 'all')) { console.error(`REFUSED: ${T} holds the "${unitsDoc.scope}" transform.`); process.exit(1); }
  const SOURCE_FILE = unitsDoc.sourceFile;
  const unit = folderNo ? unitsDoc.units.find((u) => u.n === folderNo) : null;
  if (folderNo && !unit) { console.error(`Unknown --folder ${folderNo}: units are 1..${unitsDoc.units.length}.`); process.exit(2); }
  const keyOf = (t, id) => `${t}\u0000${id}`;
  const allRows = readLines(fs, path.join(T, 'rows.jsonl'));
  const rowByKey = new Map(allRows.map((r) => [keyOf(r.sourceTable, r.sourceRowId), r]));
  const candidates = readLines(fs, path.join(T, 'candidates.jsonl')).filter((c) => SAMPLE || c.loadUnit === folderNo).sort((a, b) => a.gid - b.gid);
  const otherRows = allRows.filter((r) => r.status !== 'usable' && (SAMPLE || r.loadUnit === folderNo));

  const done = new Set((await prisma.$queryRaw`
    SELECT source_table, source_row_id FROM rpa_legacy_import_rows WHERE source_kind = ${SOURCE_KIND} AND source_file = ${SOURCE_FILE}`)
    .map((r) => keyOf(r.source_table, r.source_row_id)));

  const batchId = crypto.randomUUID();
  const now = new Date();
  const label = SAMPLE ? 'staging sample (S18)' : `folder ${unit.n} "${unit.unit || '(root)'}"`;
  console.log(`${apply ? 'APPLY' : 'DRY RUN (nothing is written, nothing is uploaded)'}  ${label}  database ${db}  env ${envName}`);
  console.log(`Batch ${batchId}${apply ? '' : ' (not used in a dry run)'}`);

  const rowsBy = {}; // provenance rows per outcome
  const bump = (k, n = 1) => { rowsBy[k] = (rowsBy[k] || 0) + n; };
  const count = { candidates: candidates.length, new: 0, matched: 0, identity_conflicts: 0, failed: 0, failed_rows: 0, cv_attached_existing: 0, cv_kept_existing: 0, text_attached_existing: 0, label_set_existing: 0, updated_no_change: 0, vectors: 0, vector_failed: 0, uploads: 0, uploads_deleted_after_failure: 0 };
  const filled = {};
  const failures = [];
  const record = (tx, member, outcome, cvId, changed, warnings) => {
    const r = rowByKey.get(keyOf(member.sourceTable, member.sourceRowId));
    return tx.$executeRaw`
      INSERT INTO rpa_legacy_import_rows (batch_id, source_kind, source_file, source_table, source_row_id, raw_row, outcome, changed_fields, cv_id, warnings)
      VALUES (${batchId}::uuid, ${SOURCE_KIND}, ${SOURCE_FILE}, ${member.sourceTable}, ${member.sourceRowId}, ${JSON.stringify(r.raw)}::jsonb, ${outcome},
              ${changed ? JSON.stringify(changed) : null}::jsonb, ${cvId}, ${JSON.stringify([...new Set([...(r.warnings || []), ...(warnings || [])])])}::jsonb)`;
  };
  const upload = async (c) => {
    const item = await uploadFileToOneDriveDetailed(c.primary.uploadPath, c.primary.uploadName, { folderPath: ['Legacy resumes', c.primary.year] });
    if (!item?.id || !item?.webUrl) throw new Error('OneDrive upload returned no item');
    count.uploads++;
    return item;
  };
  const undoUpload = async (item) => { if (!item) return; try { await deleteDriveItem(item.id); count.uploads_deleted_after_failure++; } catch { failures.push(`OneDrive item ${item.id}: could not be deleted after a failed write; delete it by hand`); } };

  // One write at a time per existing candidate (two people can match the same ATS record).
  const locks = new Map();
  const withLock = async (id, fn) => {
    const k = String(id); const prev = locks.get(k) || Promise.resolve();
    let release; const mine = new Promise((r) => { release = r; });
    const chain = prev.then(() => mine);
    locks.set(k, chain);
    await prev;
    try { return await fn(); } finally { release(); if (locks.get(k) === chain) locks.delete(k); }
  };

  async function one(c) {
    const primary = c.members[0];
    if (done.has(keyOf(primary.sourceTable, primary.sourceRowId))) { bump('already_done', c.members.length); return; }
    const f = c.fields;
    const merged = c.members.slice(1);
    const match = await findExistingCandidateMatch(prisma, c.matchContacts, c.matchEmails);

    if (match && !sameIdentity(f.Name, match.Name)) {
      count.identity_conflicts++; bump('review_identity_conflict', c.members.length);
      if (!apply) return;
      await prisma.$transaction(async (tx) => { for (const m of c.members) await record(tx, m, 'review_identity_conflict', null, null, [`identity_conflict_with_cv:${match.id}`]); }, { timeout: 60000, maxWait: 20000 });
      return;
    }

    if (!match) {
      count.new++; bump('inserted'); bump('merged_in_file', merged.length);
      if (!apply) return;
      let item = null;
      try {
        item = await upload(c);
        const data = {
          ...f,
          resume_term_updated_at: f.resume_term_updated_at ? now : null,
          cvFileUrl: item.webUrl, cv_file_item_id: item.id,
          VendorEmail: null, vendorName: null,
          last_action_by: TAG, last_action_context: TAG,
          legacy_source: SOURCE_KIND, legacy_relation: 'imported',
          createdAt: now, modifiedAt: now,
        };
        const cvId = await prisma.$transaction(async (tx) => {
          const cv = await tx.rpa_cv.create({ data, select: { id: true } });
          await record(tx, primary, 'inserted', cv.id, null, c.warnings);
          for (const m of merged) await record(tx, m, 'merged_in_file', cv.id, null, null);
          return cv.id;
        }, { timeout: 60000, maxWait: 20000 });
        item = null; // written: no longer to be undone
        if (!noVectors) {
          const metadata = await saveCandidateVector(cvId, c.vectorData);
          if (metadata) { count.vectors++; await prisma.rpa_cv.update({ where: { id: cvId }, data: { MetaData: JSON.stringify(metadata) } }); } else count.vector_failed++;
        }
      } catch (e) {
        await undoUpload(item);
        count.new--; bump('inserted', -1); bump('merged_in_file', -merged.length);
        count.failed++; count.failed_rows += c.members.length; failures.push(`gid ${c.gid}: ${String(e.message || e).slice(0, 160)}`);
      }
      return;
    }

    // Existing candidate.
    await withLock(match.id, async () => {
      const existing = await prisma.rpa_cv.findUnique({ where: { id: match.id } });
      const upd = {};
      for (const k of FILL_FIELDS) {
        const v = f[k];
        if (v === null || v === undefined || String(v).trim() === '') continue;
        const have = existing[k];
        if (empty(have) || (k === 'EducationalScoresPercentage' && ['{}', '[]'].includes(String(have).trim()))) upd[k] = v;
      }
      const haveCompanies = existing.employment_history?.companies?.length || 0;
      if (!haveCompanies && f.employment_history?.companies?.length) upd.employment_history = f.employment_history;
      const haveEmails = String(existing.EmailID || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
      const extraEmails = c.matchEmails.filter((e) => !haveEmails.includes(e));
      if (extraEmails.length) upd.EmailID = [...(empty(existing.EmailID) ? [] : [String(existing.EmailID).trim()]), ...extraEmails].join(', ');
      const havePhones = String(existing.ContactNumber || '').split(',').map((n) => n.replace(/\D/g, '').slice(-10)).filter(Boolean);
      const extraPhones = c.matchContacts.filter((n) => !havePhones.includes(n));
      if (extraPhones.length) upd.ContactNumber = [...(empty(existing.ContactNumber) ? [] : [String(existing.ContactNumber).trim()]), ...extraPhones].join(', ');
      if (upd.TotalExperienceYears && existing.TotalExperienceYearsNumeric === null && f.TotalExperienceYearsNumeric !== null) upd.TotalExperienceYearsNumeric = f.TotalExperienceYearsNumeric;
      if (upd.ExpectedCTC_LPA && existing.ExpectedCTCNumeric === null && f.ExpectedCTCNumeric !== null) upd.ExpectedCTCNumeric = f.ExpectedCTCNumeric;
      if (upd.NoticePeriod && existing.NoticePeriodDays === null && f.NoticePeriodDays !== null) upd.NoticePeriodDays = f.NoticePeriodDays;
      if (empty(existing.resume_full_text) && f.resume_full_text) {
        upd.resume_full_text = f.resume_full_text; upd.resume_text_quality = f.resume_text_quality;
        if (f.resume_technical_terms?.length) { upd.resume_technical_terms = f.resume_technical_terms; upd.resume_term_updated_at = now; }
        count.text_attached_existing++;
      }
      const attachCv = resumeStatus(existing) === RESUME_STATUS.MISSING;
      if (attachCv) count.cv_attached_existing++; else count.cv_kept_existing++;
      let miss = null;
      try { miss = existing.missingData ? JSON.parse(existing.missingData) : null; } catch { miss = null; }
      const missingDataChange = () => {
        if (!miss || typeof miss !== 'object') return;
        const before = Object.keys(miss).length;
        for (const k of Object.keys(upd)) delete miss[MISSING_KEY_OF[k] || k];
        if (attachCv) delete miss.uploadResume;
        if (Object.keys(miss).length !== before) { upd.missingData = JSON.stringify(miss); upd.statusActive = Object.keys(miss).length > 0 ? 'INACTIVE' : 'ACTIVE'; }
      };
      const setLabel = !existing.legacy_source;
      if (setLabel) count.label_set_existing++;
      count.matched++; bump('updated_existing'); bump('merged_in_file', merged.length);
      if (!apply) {
        if (attachCv) { upd.cvFileUrl = 'x'; upd.cv_file_item_id = 'x'; }
        missingDataChange();
        for (const k of Object.keys(upd)) filled[k] = (filled[k] || 0) + 1;
        if (Object.keys(upd).length === 0) count.updated_no_change++;
        return;
      }
      let item = null;
      try {
        if (attachCv) { item = await upload(c); upd.cvFileUrl = item.webUrl; upd.cv_file_item_id = item.id; }
        missingDataChange();
        for (const k of Object.keys(upd)) filled[k] = (filled[k] || 0) + 1;
        if (Object.keys(upd).length === 0) count.updated_no_change++;
        const changed = Object.fromEntries(Object.keys(upd).map((k) => [k, { before: plain(existing[k]), after: plain(upd[k]) }]));
        await prisma.$transaction(async (tx) => {
          if (Object.keys(upd).length) {
            changed.modifiedAt = { before: plain(existing.modifiedAt), after: now.toISOString() };
            await tx.rpa_cv.update({ where: { id: existing.id }, data: { ...upd, modifiedAt: now } });
          }
          // Label "Also in archive", only when the candidate has none: the first legacy import keeps its label.
          if (setLabel) await tx.rpa_cv.update({ where: { id: existing.id }, data: { legacy_source: SOURCE_KIND, legacy_relation: 'matched' } });
          await record(tx, primary, 'updated_existing', existing.id, changed, c.warnings);
          for (const m of merged) await record(tx, m, 'merged_in_file', existing.id, null, null);
        }, { timeout: 60000, maxWait: 20000 });
        item = null;
      } catch (e) {
        await undoUpload(item);
        count.matched--; bump('updated_existing', -1); bump('merged_in_file', -merged.length);
        count.failed++; count.failed_rows += c.members.length; failures.push(`gid ${c.gid}: ${String(e.message || e).slice(0, 160)}`);
      }
    });
  }

  let next = 0; let handled = 0;
  const t0 = Date.now();
  async function worker() {
    while (next < candidates.length) {
      const c = candidates[next++];
      await one(c);
      handled++;
      if (handled % 25 === 0 || handled === candidates.length) console.log(`  ${handled}/${candidates.length} people (new ${count.new}, matched ${count.matched}, name conflicts ${count.identity_conflicts}, failed ${count.failed}) ${Math.round((Date.now() - t0) / 1000)}s`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // Files of this scope that become no candidate.
  for (const r of otherRows) {
    if (done.has(keyOf(r.sourceTable, r.sourceRowId))) { bump('already_done'); continue; }
    bump(r.outcome);
    if (apply) await record(prisma, r, r.outcome, null, null, null);
  }

  // Reconciliation: every archive file handled in this run has exactly one outcome (or failed, to be re-run).
  let expected;
  if (SAMPLE) expected = allRows.length;
  else {
    const unitRows = allRows.filter((r) => r.unitN === folderNo);
    const inEarlierRuns = unitRows.filter((r) => r.status === 'usable' && r.role && r.loadUnit !== folderNo).length;
    const fromOtherFolders = candidates.reduce((a, c) => a + c.members.filter((m) => rowByKey.get(keyOf(m.sourceTable, m.sourceRowId)).unitN !== folderNo).length, 0);
    expected = unitRows.length - inEarlierRuns + fromOtherFolders;
  }
  const handledRows = Object.values(rowsBy).reduce((a, n) => a + n, 0);
  const summary = {
    mode: apply ? 'apply' : 'dry-run', batchId: apply ? batchId : null, database: db, env: envName, scope: SAMPLE ? 'sample' : `folder ${folderNo}`, unit: SAMPLE ? 'staging sample' : unit.unit, at: now.toISOString(),
    expectedRowsThisRun: expected, handledRowsThisRun: handledRows, failedRows: count.failed_rows, reconciles: handledRows + count.failed_rows === expected,
    rowsByOutcome: rowsBy, ...count, fieldsFilledOnExisting: filled,
    outcomeConstraintReady: missingOutcomes.length === 0, seconds: Math.round((Date.now() - t0) / 1000),
  };
  console.log(JSON.stringify(summary, null, 2));
  fs.mkdirSync(path.join(work, 'report'), { recursive: true });
  const rp = path.join(work, 'report', `load-${envName}-${SAMPLE ? 'sample' : `folder${folderNo}`}-${apply ? batchId : 'dry-run'}.json`);
  fs.writeFileSync(rp, JSON.stringify({ summary, failures }, null, 2));
  if (failures.length) console.error(`${failures.length} failure(s); details (no candidate data) in ${rp}. Run again to retry them.`);
  if (!summary.reconciles) { console.error('RECONCILIATION FAILED: the file counts do not add up.'); exitCode = 1; }
  if (count.failed) exitCode = 1;
  if (!apply && missingOutcomes.length) console.log(`NOTE: --apply will refuse until the outcome DDL is applied (missing: ${missingOutcomes.join(', ')}).`);
} catch (e) {
  console.error(`FAILED: ${e.message}`);
  exitCode = 1;
} finally {
  await prisma.$disconnect();
}
process.exit(exitCode); // the ATS modules keep handles open (logger, queues); end the script explicitly
