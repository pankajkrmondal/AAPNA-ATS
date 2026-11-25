// Completion certificate for one legacy source on one database.
// docs/Phase 4/PLAN-Legacy-Migration-Stage2-3-Excel-Naukri-Resumes.md, section 6.
// READ-ONLY: SELECT statements only. Writes files to <work>/report/ and nothing else.
//
//   cd backend
//   node scripts/legacy-proof/certify.mjs --source excel|ms_access --work <work folder> --env staging --expect-db recruitmentautomationdb [--sample 5]
//   node scripts/legacy-proof/certify.mjs --source excel --work <work folder> --env production --expect-db recruitmentautomationdbProd
//        --compare-env staging --compare-db recruitmentautomationdb          (check 8, production only)
//   Resumes (Stage 3) also need --scope: staging holds only the 10-file sample (S18), production every file (S24):
//   node scripts/legacy-proof/certify.mjs --source resume --scope sample --work <work> --env staging --expect-db recruitmentautomationdb
//   node scripts/legacy-proof/certify.mjs --source resume --scope all --work <work> --env production --expect-db recruitmentautomationdbProd
//        --compare-env staging --compare-db recruitmentautomationdb
//   For resumes, check 1 compares only manifest.json with the staging certificate (staging loaded transform-sample/,
//   production transform/), check 6 also proves the CV files (item ids set, a sample resolved through Graph), and
//   check 8 compares the sample files only (S22): the other production files have no staging row by design.
//
// Writes  certificate-<source>-<env>-<stamp>.md and .json   verdict, 8 checks, proof code (no personal data)
//         what-was-migrated-<source>-<env>-<stamp>.md        summary (no personal data)
//         evidence-<source>-<env>-<stamp>.xlsx               every source row and its result, not-imported list,
//                                                            spot-check sheet (PERSONAL DATA: HR-only folder, never the repo)
// Prints the verdict and the check results only.
//
// Proof code: first 12 hex characters of SHA-256 over the sorted provenance set
// (source_file, source_table, source_row_id, outcome, cv_id). source_file is included because Excel
// sheet names repeat across files ("MySheet"). Provenance rows are never updated, so a re-run gives the same code.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import XLSX from 'xlsx';
import { argOf, prepareEnv, assertDatabase, BACKEND, DB_OF_ENV } from '../legacy-migration-excel/lib/env.mjs';

const argv = process.argv; const arg = argOf(argv);
const source = arg('--source'); const work = arg('--work'); const envName = arg('--env'); const expectDb = arg('--expect-db');
const compareEnv = arg('--compare-env'); const compareDb = arg('--compare-db'); const sampleN = Number(arg('--sample') || 5);
const scope = arg('--scope');
if (!['excel', 'ms_access', 'resume'].includes(source) || !work || !envName || !expectDb || (source === 'resume' && !['sample', 'all'].includes(scope))) {
  console.error('Usage: node certify.mjs --source excel|ms_access|resume --work <folder> --env <staging|production> --expect-db <db> [--scope sample|all (resume only)] [--compare-env staging --compare-db recruitmentautomationdb] [--sample 5]');
  process.exit(2);
}
if (source === 'resume' && envName === 'production' && scope !== 'all') { console.error('REFUSED: production holds every resume file (S24): --scope all.'); process.exit(1); }
if (compareEnv && DB_OF_ENV[compareEnv] !== compareDb) { console.error(`REFUSED: --compare-env ${compareEnv} does not belong with --compare-db "${compareDb}".`); process.exit(1); }
prepareEnv({ envName, expectDb, writes: false, work, logLevel: 'error' });
const { default: prisma } = await import('../../src/config/database.js');

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const shaFile = (f) => sha(fs.readFileSync(f));
const readLines = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

// ── Source adapters: what the source consists of, as the work folder records it ──
async function adapter() {
  const manifest = JSON.parse(fs.readFileSync(path.join(work, 'manifest.json'), 'utf8').replace(/^﻿/, ''));
  if (source === 'resume') {
    const R = await import('../legacy-migration-resumes/lib/constants.mjs');
    const tdir = scope === 'sample' ? 'transform-sample' : 'transform';
    const sampleIds = new Set(manifest.sample.files.map((s) => `${s.unitN}|${s.sourceRowId}`));
    const files = scope === 'sample' ? manifest.files.filter((f) => sampleIds.has(`${f.unitN}|${f.sourceRowId}`)) : manifest.files;
    const perUnit = files.reduce((m, f) => m.set(f.unitN, (m.get(f.unitN) || 0) + 1), new Map());
    const root = manifest.sourceRoot;
    const candFile = path.join(work, tdir, 'candidates.jsonl');
    const firstCand = fs.readFileSync(candFile, 'utf8').split('\n').find(Boolean);
    // Values as the loader stores them: JSON columns key-order-independent (jsonb reorders keys), numeric columns
    // as numbers, resume_term_updated_at only present-or-not (the loader writes the load time). As 4c-check-batch.mjs.
    const same = (f, cvVal, srcVal) => {
      if (f === 'resume_term_updated_at') return !!cvVal === !!srcVal;
      if (R.JSON_FIELDS.includes(f)) return R.canonical(cvVal ?? null) === R.canonical(srcVal ?? null);
      if (R.NUMERIC_FIELDS.includes(f)) return (cvVal === null || cvVal === undefined ? null : Number(cvVal)) === (srcVal === null || srcVal === undefined ? null : Number(srcVal));
      return String(cvVal ?? '') === String(srcVal ?? '');
    };
    return {
      kind: 'resume', tag: R.TAG, cvFields: firstCand ? Object.keys(JSON.parse(firstCand).fields) : [],
      name: scope === 'sample' ? `Resume archive (${files.length}-file sample)` : 'Resume archive',
      sourceLabel: root, unitWord: 'folders', rowWord: 'files',
      units: manifest.units.filter((u) => perUnit.has(u.n)).map((u) => ({ label: u.unit || '(root)', file: root, table: R.sourceTable(u.unit), layout: `folder ${u.year}`, expected: perUnit.get(u.n), countA: u.sourceCount, countB: u.secondCount, countsMatch: u.countsMatch })),
      countTools: ['file walk of 1-inventory.mjs', manifest.secondCountTool],
      workFiles: ['manifest.json', `${tdir}/units.json`, `${tdir}/candidates.jsonl`, `${tdir}/rows.jsonl`],
      compareFpKeys: ['manifest.json'],
      sourceFiles: files.map((f) => ({ path: path.join(root, f.rel), name: f.rel, recorded: f.sha256 })),
      candidatesFile: candFile,
      baseKey: (c) => `${root}|${c.primary.sourceTable}|${c.primary.sourceRowId}`,
      yearOf: (c) => c.primary.year,
      rows: () => readLines(path.join(work, tdir, 'rows.jsonl')).map((r) => ({ ...r, key: `${root}|${r.sourceTable}|${r.sourceRowId}` })),
      skipped: [], same,
      notImportedOutcomes: [...R.NEW_OUTCOMES],
      // Check 8 (S22): only the sample files have a staging row. A sample file may land differently on production
      // because production holds more candidates (inserted / updated_existing / name conflict) or because the full
      // transform groups it with other resumes (merged_in_file); its only e-mail may be shared by more than 3 names
      // in the full set (rejected_no_email with only_shared_contacts). Anything else is a real difference.
      check8: {
        liveOnlyAllowed: true,
        explained: (staging, live, liveWarnings) => {
          const person = new Set(['inserted', 'updated_existing', 'merged_in_file', 'review_identity_conflict']);
          if (person.has(staging) && person.has(live)) return true;
          return live === 'rejected_no_email' && (liveWarnings || []).includes('only_shared_contacts');
        },
      },
    };
  }
  if (source === 'excel') {
    const L = await import('../legacy-migration-excel/lib/layouts.mjs');
    const units = JSON.parse(fs.readFileSync(path.join(work, 'transform', 'units.json'), 'utf8'));
    const mu = new Map(manifest.units.map((u) => [u.n, u]));
    const unitByN = new Map(units.map((u) => [u.n, u]));
    return {
      kind: 'excel', tag: L.TAG, cvFields: L.CV_FIELDS, name: 'Excel and Naukri files',
      sourceLabel: manifest.sourceRoot,
      units: units.map((u) => ({ label: `${u.file.split(/[\\/]/).pop()} › ${u.sheet}`, file: u.file, table: u.sheet, layout: u.layout, expected: u.sourceCount, countA: mu.get(u.n).sheetNonBlankRows, countB: mu.get(u.n).secondCount, countsMatch: mu.get(u.n).countsMatch })),
      countTools: [manifest.tool, manifest.secondCountTool],
      workFiles: ['manifest.json', 'transform/units.json', 'transform/candidates.jsonl', 'transform/rows.jsonl'],
      sourceFiles: manifest.files.map((f) => ({ path: path.join(manifest.sourceRoot, f.file), name: f.file, recorded: f.sha256 })),
      baseKey: (c) => { const u = unitByN.get(c.base.unit); return `${u.file}|${u.sheet}|${c.base.id}`; },
      memberKeys: (c) => c.members.map((m) => { const u = unitByN.get(m.unit); return `${u.file}|${u.sheet}|${m.id}`; }),
      unitOfCandidate: (c) => unitByN.get(c.loadUnit),
      rows: () => readLines(path.join(work, 'transform', 'rows.jsonl')).map((r) => ({ ...r, key: `${unitByN.get(r.unit).file}|${unitByN.get(r.unit).sheet}|${r.id}` })),
      skipped: manifest.skipped,
    };
  }
  const M = await import('../legacy-migration/lib/mapping.mjs');
  return {
    kind: 'ms_access', tag: M.TAG, cvFields: M.CV_FIELDS, name: 'MS Access file',
    sourceLabel: manifest.sourceFile,
    units: manifest.tables.map((t) => ({ label: t.table, file: manifest.sourceFile, table: t.table, layout: 'Access table', expected: t.extracted, countA: t.accessCount, countB: t.extracted, countsMatch: t.countsMatch })),
    countTools: ['Access COUNT(*) through ACE OLEDB', 'rows written by 1-extract-access.ps1'],
    workFiles: ['manifest.json', 'transform/candidates.jsonl', 'transform/rows.jsonl'],
    sourceFiles: [{ path: manifest.sourceFile, name: path.basename(manifest.sourceFile), recorded: null }],
    baseKey: (c) => `${manifest.sourceFile}|${c.base.table}|${c.base.id}`,
    memberKeys: (c) => c.members.map((m) => `${manifest.sourceFile}|${m.table}|${m.id}`),
    unitOfCandidate: (c) => ({ table: c.loadTable }),
    rows: () => readLines(path.join(work, 'transform', 'rows.jsonl')).map((r) => ({ ...r, key: `${manifest.sourceFile}|${r.table}|${r.id}` })),
    skipped: [],
  };
}

const checks = []; const add = (n, title, pass, detail, applies = true) => checks.push({ n, title, result: !applies ? 'not applicable' : pass ? 'PASS' : 'FAIL', detail });
let exitCode = 0;
try {
  const db = await assertDatabase(prisma, expectDb);
  const A = await adapter();
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13).replace('T', '-');
  const prov = await prisma.$queryRaw`SELECT batch_id::text batch_id, source_file, source_table, source_row_id, outcome, cv_id, warnings, raw_row, changed_fields, created_at
    FROM rpa_legacy_import_rows WHERE source_kind = ${A.kind} ORDER BY id`;
  const pkey = (p) => `${p.source_file}|${p.source_table}|${p.source_row_id}`;
  const provByKey = new Map(prov.map((p) => [pkey(p), p]));

  // 1. Right data
  const workFp = Object.fromEntries(A.workFiles.map((f) => [f, shaFile(path.join(work, f)).slice(0, 16).toUpperCase()]));
  const srcFp = A.sourceFiles.map((s) => { const now = fs.existsSync(s.path) ? shaFile(s.path) : null; return { name: s.name, sha256: now ? now.slice(0, 16).toUpperCase() : 'not reachable', unchanged: s.recorded ? now === s.recorded : null }; });
  const srcChanged = srcFp.filter((s) => s.unchanged === false).length;
  let fpMatchesStaging = null;
  if (compareEnv) {
    const prev = fs.readdirSync(path.join(work, 'report')).filter((f) => f.startsWith(`certificate-${A.kind}-${compareEnv}-`) && f.endsWith('.json')).sort().pop();
    if (prev) {
      const p = JSON.parse(fs.readFileSync(path.join(work, 'report', prev), 'utf8'));
      const keys = A.compareFpKeys || Object.keys(workFp);
      fpMatchesStaging = JSON.stringify(keys.map((k) => p.fingerprints.work[k] ?? null)) === JSON.stringify(keys.map((k) => workFp[k]));
    }
  }
  add(1, 'Right data: the exact source files, fingerprinted, the same for staging and live', srcChanged === 0 && fpMatchesStaging !== false,
    `${A.sourceFiles.length} source file(s) fingerprinted; ${srcChanged} changed since extraction; work files ${Object.entries(workFp).map(([k, v]) => `${k} ${v}`).join(', ')}${compareEnv ? `; ${A.compareFpKeys ? `${A.compareFpKeys.join(', ')} ` : ''}same as the ${compareEnv} certificate: ${fpMatchesStaging === null ? 'no staging certificate found' : fpMatchesStaging ? 'yes' : 'NO'}` : ''}`);
  if (compareEnv && fpMatchesStaging === null) checks.at(-1).result = 'FAIL';

  // 2. Everything read
  const countBad = A.units.filter((u) => !u.countsMatch);
  add(2, 'Everything read: counted by two separate tools that agree', countBad.length === 0, `${A.units.length - countBad.length} of ${A.units.length} units: ${A.countTools.join(' = ')}`);

  // 3. Everything accounted for
  const perUnit = new Map();
  for (const p of prov) { const k = `${p.source_file}|${p.source_table}`; perUnit.set(k, (perUnit.get(k) || 0) + 1); }
  const unitRows = A.units.map((u) => ({ ...u, recorded: perUnit.get(`${u.file}|${u.table}`) || 0 }));
  const short = unitRows.filter((u) => u.recorded !== u.expected);
  const known = new Set(A.units.map((u) => `${u.file}|${u.table}`));
  const stray = prov.filter((p) => !known.has(`${p.source_file}|${p.source_table}`)).length;
  const [{ n: dupes }] = await prisma.$queryRaw`SELECT count(*)::int n FROM (SELECT 1 FROM rpa_legacy_import_rows WHERE source_kind = ${A.kind} GROUP BY source_file, source_table, source_row_id HAVING count(*) > 1) d`;
  const expectedTotal = A.units.reduce((a, u) => a + u.expected, 0);
  add(3, 'Everything accounted for: nothing missing, nothing counted twice', short.length === 0 && stray === 0 && dupes === 0,
    `${prov.length} rows recorded of ${expectedTotal} read; units not matching: ${short.length}; rows outside the known units: ${stray}; rows recorded twice: ${dupes}`);

  // 4. Everything landed
  const cvIds = [...new Set(prov.filter((p) => p.cv_id !== null).map((p) => p.cv_id))];
  const cvs = [];
  for (let i = 0; i < cvIds.length; i += 1000) cvs.push(...await prisma.rpa_cv.findMany({ where: { id: { in: cvIds.slice(i, i + 1000) } } }));
  const cvById = new Map(cvs.map((c) => [String(c.id), c]));
  const missing = cvIds.filter((id) => !cvById.has(String(id))).length;
  const firstLoad = prov.reduce((m, p) => (p.created_at < m ? p.created_at : m), prov[0]?.created_at || new Date());
  const lastLoad = prov.reduce((m, p) => (p.created_at > m ? p.created_at : m), prov[0]?.created_at || new Date());
  const insertedIds = new Set(prov.filter((p) => p.outcome === 'inserted').map((p) => String(p.cv_id)));
  const changedLater = [...insertedIds].filter((id) => { const c = cvById.get(id); return c && c.last_action_context !== A.tag; });
  add(4, 'Everything landed', missing === 0, `${cvIds.length} ATS candidates referenced; found ${cvIds.length - missing}; missing ${missing}; created by the import and changed by HR since: ${changedLater.length}`);

  // 5. Values correct
  const cands = readLines(A.candidatesFile || path.join(work, 'transform', 'candidates.jsonl'));
  const sameVal = A.same || ((f, a, b) => String(a ?? '') === String(b ?? ''));
  const mismatch = {}; let compared = 0; let skippedChanged = 0; let dateMismatch = 0; let enrichedLater = 0;
  const changedSet = new Set(changedLater);
  // A candidate this source created may later be matched by ANOTHER legacy import, which fills its empty fields
  // (e.g. a resume filling an Excel candidate's education). Those fields are recorded in that import's
  // changed_fields; they are not compared here. Every other field still is.
  const laterFields = new Map();
  const insIdsNum = [...insertedIds].filter((id) => id !== 'null').map(Number);
  for (let i = 0; i < insIdsNum.length; i += 1000) {
    const later = await prisma.$queryRawUnsafe(`select cv_id, changed_fields from rpa_legacy_import_rows
      where source_kind <> $1 and outcome = 'updated_existing' and changed_fields is not null and cv_id = any($2::bigint[])`, A.kind, insIdsNum.slice(i, i + 1000));
    for (const r of later) { const k = String(r.cv_id); if (!laterFields.has(k)) laterFields.set(k, new Set()); for (const f of Object.keys(r.changed_fields || {})) laterFields.get(k).add(f); }
  }
  for (const c of cands) {
    const p = provByKey.get(A.baseKey(c));
    if (!p || p.outcome !== 'inserted') continue;
    if (changedSet.has(String(p.cv_id))) { skippedChanged++; continue; }
    const cv = cvById.get(String(p.cv_id)); if (!cv) continue;
    compared++;
    const filledLater = laterFields.get(String(p.cv_id));
    if (filledLater) enrichedLater++;
    for (const f of A.cvFields) if (!filledLater?.has(f) && !sameVal(f, cv[f], c.fields[f])) mismatch[f] = (mismatch[f] || 0) + 1;
    if (c.createdAt && cv.createdAt?.toISOString().slice(0, 10) !== c.createdAt) dateMismatch++;
  }
  add(5, 'Values correct', Object.keys(mismatch).length === 0 && dateMismatch === 0,
    `${compared} created candidates compared on ${A.cvFields.length} columns and the created date: ${Object.keys(mismatch).length ? `differences ${JSON.stringify(mismatch)}` : 'no difference'}${dateMismatch ? `, ${dateMismatch} dates differ` : ''}; ${skippedChanged} edited by HR since, not compared; ${enrichedLater} enriched by a later legacy import (only the fields it filled are not compared); spot-check sample in the evidence file`);

  // 6. Findable
  const insWithEmail = [...insertedIds].filter((id) => String(cvById.get(id)?.EmailID || '').trim());
  let withVec = 0;
  for (let i = 0; i < insWithEmail.length; i += 1000) { const [{ n }] = await prisma.$queryRawUnsafe('select count(distinct candidate_id)::int n from public.rpa_cv_vectors where candidate_id = any($1::bigint[]) and embedding is not null', insWithEmail.slice(i, i + 1000).map(Number)); withVec += n; }
  add(6, 'Findable', withVec === insWithEmail.length, `${withVec} of ${insWithEmail.length} created candidates with an email have a search entry (${insertedIds.size - insWithEmail.length} have no email)`);
  if (A.kind === 'resume') {
    // Resumes (6.2 check 6): the CV file. Every created candidate has cvFileUrl + cv_file_item_id; every CV the import
    // attached to an existing candidate is still there or was replaced later by HR (allowed); a fixed sample of item ids
    // resolves through Graph (GET only).
    const created = [...insertedIds].map((id) => cvById.get(id)).filter(Boolean);
    const createdWithCv = created.filter((c) => c.cvFileUrl && c.cv_file_item_id).length;
    const attached = prov.filter((p) => p.outcome === 'updated_existing' && p.changed_fields?.cv_file_item_id);
    const attachedStill = attached.filter((p) => cvById.get(String(p.cv_id))?.cv_file_item_id === p.changed_fields.cv_file_item_id.after).length;
    const itemIds = [...created.map((c) => c.cv_file_item_id), ...attached.map((p) => p.changed_fields.cv_file_item_id.after)].filter(Boolean);
    const pick = [...new Set(itemIds)].map((id) => ({ id, h: sha(`graph|${id}`) })).sort((a, b) => a.h.localeCompare(b.h)).slice(0, Math.max(sampleN, 5));
    let resolved = 0; let graphNote = '';
    try {
      const { default: config } = await import('../../src/config/index.js');
      const { getAccessToken } = await import('../../src/services/onedrive.service.js');
      const token = await getAccessToken();
      const sender = config.microsoft.defaultSender;
      const base = sender ? `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/drive` : 'https://graph.microsoft.com/v1.0/drive';
      for (const { id } of pick) {
        const r = await fetch(`${base}/items/${id}?$select=id,file`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
        if (r.ok && (await r.json()).file) resolved++;
      }
    } catch (e) { graphNote = ` (Graph not reachable: ${String(e.message).slice(0, 60)})`; }
    checks.at(-1).detail += `; CV files: ${createdWithCv} of ${created.length} created candidates have a CV link and item id, ${attachedStill} of ${attached.length} CVs attached to existing candidates still in place (${attached.length - attachedStill} replaced by HR since, allowed), ${resolved} of ${pick.length} sampled files open through Graph${graphNote}`;
    if (createdWithCv !== created.length || resolved !== pick.length) checks.at(-1).result = 'FAIL';
  }

  // 7. Nothing sent
  const allCv = [...cvById.values()];
  const emails = [...new Set(allCv.flatMap((c) => String(c.EmailID || '').toLowerCase().split(/[,;\s]+/)).filter(Boolean))];
  const q = async (sql, a) => { try { const [{ n }] = await prisma.$queryRawUnsafe(sql, ...a); return n; } catch (e) { return `not checked (${e.message.split('\n').pop().slice(0, 80)})`; } };
  const m1 = await q('select count(*)::int n from rpa_email_messages where candidate_id::text = any($1::text[]) and created_at >= $2', [[...insertedIds], firstLoad]);
  const m2 = await q('select count(*)::int n from rpa_email_log where lower(recipient_email) = any($1::text[]) and sent_at >= $2', [emails, firstLoad]);
  const m3 = await q('select count(*)::int n from rpa_email_notifications where lower(candidate_email) = any($1::text[]) and created_at >= $2', [emails, firstLoad]);
  add(7, 'Nothing sent', [m1, m2, m3].every((n) => n === 0), `since the first batch (${firstLoad.toISOString().slice(0, 16)}Z): messages ${m1}, email log ${m2}, notifications ${m3}`);

  // 8. Live matches staging
  if (envName === 'production' && compareEnv) {
    const url = dotenv.parse(fs.readFileSync(path.join(BACKEND, `.env.${compareEnv}`))).DATABASE_URL;
    const { PrismaClient } = await import('@prisma/client');
    const other = new PrismaClient({ datasources: { db: { url } } });
    try {
      const [{ db: odb }] = await other.$queryRawUnsafe('select current_database() db');
      if (odb !== compareDb) throw new Error(`compare database is "${odb}", expected "${compareDb}"`);
      const oprov = await other.$queryRaw`SELECT source_file, source_table, source_row_id, outcome FROM rpa_legacy_import_rows WHERE source_kind = ${A.kind}`;
      const om = new Map(oprov.map((p) => [pkey(p), p.outcome]));
      let onlyHere = 0; let onlyThere = 0; let allowed = 0; let other_ = 0; let same_ = 0;
      const explained = A.check8?.explained || ((o, l) => [o, l].every((x) => x === 'inserted' || x === 'updated_existing'));
      for (const p of prov) { const o = om.get(pkey(p)); if (!o) onlyHere++; else if (o === p.outcome) same_++; else if (explained(o, p.outcome, p.warnings)) allowed++; else other_++; }
      for (const k of om.keys()) if (!provByKey.has(k)) onlyThere++;
      if (A.check8?.liveOnlyAllowed) {
        add(8, 'Live matches staging', onlyThere === 0 && other_ === 0, `staging holds the ${oprov.length}-file sample (S18, S22); all ${oprov.length} found live: ${onlyThere === 0 ? 'yes' : `NO, ${onlyThere} missing`}; same result ${same_}, explained differences ${allowed} (production holds more candidates, or the full set groups the file with other resumes), other differences ${other_}; ${onlyHere} live rows have no staging row by design (production only, S24)`);
      } else add(8, 'Live matches staging', onlyHere === 0 && onlyThere === 0 && other_ === 0, `${prov.length} live rows against ${oprov.length} staging rows: only live ${onlyHere}, only staging ${onlyThere}, new-vs-existing differences ${allowed} (allowed: production holds more real candidates), other differences ${other_}`);
    } finally { await other.$disconnect(); }
  } else add(8, 'Live matches staging', true, 'staging certificate', false);

  // Proof code
  const proofLines = prov.map((p) => `${p.source_file}|${p.source_table}|${p.source_row_id}|${p.outcome}|${p.cv_id ?? ''}`).sort();
  const h = sha(proofLines.join('\n')).slice(0, 12).toUpperCase();
  const proofCode = `${h.slice(0, 4)}-${h.slice(4, 8)}-${h.slice(8, 12)}`;
  const verdict = checks.every((c) => c.result !== 'FAIL') ? 'COMPLETE' : 'NOT COMPLETE';
  const byOutcome = prov.reduce((a, p) => ((a[p.outcome] = (a[p.outcome] || 0) + 1), a), {});
  const batches = new Set(prov.map((p) => p.batch_id)).size;

  // ── Outputs ──
  const rep = path.join(work, 'report'); fs.mkdirSync(rep, { recursive: true });
  const base = `${A.kind}-${envName}-${stamp}`;
  const cert = { source: A.kind, sourceName: A.name, environment: envName, database: db, generatedAt: new Date().toISOString(), verdict, proofCode, batches, loadedFrom: firstLoad, loadedTo: lastLoad, rowsRead: expectedTotal, rowsRecorded: prov.length, byOutcome, checks, fingerprints: { work: workFp, source: srcFp } };
  fs.writeFileSync(path.join(rep, `certificate-${base}.json`), JSON.stringify(cert, null, 2));
  const C = [];
  C.push(`# Completion certificate: ${A.name}, ${envName}`, '');
  C.push(`**Verdict: ${verdict}**  ·  Proof code **${proofCode}**`, '');
  C.push(`- Database: ${envName}. Loaded ${firstLoad.toISOString().slice(0, 10)}${lastLoad.toISOString().slice(0, 10) !== firstLoad.toISOString().slice(0, 10) ? ` to ${lastLoad.toISOString().slice(0, 10)}` : ''} in ${batches} batch(es). Certificate generated ${cert.generatedAt.slice(0, 16).replace('T', ' ')} UTC.`);
  C.push(`- Records read: ${expectedTotal}. Recorded with a result: ${prov.length}.`, '');
  C.push('| # | Check | Result | Detail |', '|---|---|---|---|');
  for (const c of checks) C.push(`| ${c.n} | ${c.title} | ${c.result} | ${c.detail} |`);
  C.push('', 'The proof code is computed from every recorded source row and its result. Anyone with database access can recompute it; the same import always gives the same code.');
  fs.writeFileSync(path.join(rep, `certificate-${base}.md`), C.join('\n') + '\n');

  // What was migrated (no personal data)
  const rows = A.rows();
  const reasons = {};
  if (A.kind === 'resume') {
    const WHY = { skipped_duplicate_file: 'byte-identical copy of another archive file', skipped_unsupported_type: 'file type not imported (RTF, PPTX, lock or empty file)', rejected_unreadable: 'no readable text', rejected_no_email: 'no valid email in the resume', review_identity_conflict: 'same email or phone as another candidate with a different name (for HR review)' };
    for (const p of prov.filter((x) => WHY[x.outcome])) {
      const w = p.warnings || [];
      const k = WHY[p.outcome] + (w.includes('parse_failed') ? ' (the AI parser failed three times)' : '') + (w.includes('only_shared_contacts') ? ' (its only email is shared by more than 3 names)' : '');
      reasons[k] = (reasons[k] || 0) + 1;
    }
  } else for (const r of rows.filter((x) => x.status === 'rejected')) { const k = r.warnings.includes('only_shared_contacts') ? 'only contact shared by several people' : 'no valid email and no valid phone'; reasons[k] = (reasons[k] || 0) + 1; }
  const years = {}; for (const c of cands) { const y = A.yearOf ? A.yearOf(c) : c.createdAt ? c.createdAt.slice(0, 4) : 'no date'; years[y] = (years[y] || 0) + 1; }
  const roles = {}; for (const c of cands) { const r = c.fields.PositionApplied || '(none)'; roles[r] = (roles[r] || 0) + 1; }
  const fill = Object.fromEntries(A.cvFields.map((f) => [f, cands.filter((c) => c.fields[f]).length]).filter(([, n]) => n > 0));
  const W = [];
  W.push(`# What was migrated: ${A.name}, ${envName}`, '', `Status: ${verdict}, proof code ${proofCode}.`, '');
  W.push('## What came in', '', `- ${A.units.length} ${A.unitWord || (A.kind === 'excel' ? 'sheets' : 'tables')}, ${expectedTotal} ${A.rowWord || 'rows'}. ${A.skipped.length ? `${A.skipped.length} sheets not loaded (summary sheets, a staff timesheet, a sheet already in MS Access).` : ''}`);
  W.push(`- Years in the data: ${Object.entries(years).sort().map(([y, n]) => `${y}: ${n}`).join(', ')} (people${A.yearOf ? ', by the year of the folder holding their newest resume' : ''}).`);
  W.push(`- Most common roles: ${Object.entries(roles).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([r, n]) => `${r} (${n})`).join(', ')}.`, '');
  W.push('## What happened', '', `| Result | ${A.kind === 'resume' ? 'Files' : 'Rows'} |`, '|---|---|');
  const happened = A.kind === 'resume'
    ? [['inserted', 'New candidate created, with the resume as CV'], ['updated_existing', 'Matched a candidate already in the ATS (empty fields filled; CV attached only where there was none)'], ['merged_in_file', 'Older resume of the same person (emails and phones added)'], ['skipped_duplicate_file', 'Byte-identical copy'], ['skipped_unsupported_type', 'File type not imported'], ['rejected_unreadable', 'No readable text'], ['rejected_no_email', 'No valid email'], ['review_identity_conflict', 'Not merged: different name (for HR review)']]
    : [['inserted', 'New candidate created'], ['updated_existing', 'Matched a candidate already in the ATS (empty fields filled, nothing overwritten)'], ['merged_in_file', 'Another row of the same person'], ['skipped_blank', 'Blank row'], ['rejected_min_fields', 'Not imported']];
  for (const [k, label] of happened) W.push(`| ${label} | ${byOutcome[k] || 0} |`);
  W.push('', '## Information carried over (people with a value)', '', '| Field | People |', '|---|---|');
  for (const [f, n] of Object.entries(fill)) W.push(`| ${f} | ${n} |`);
  W.push('', '## Not imported, and why', '');
  if (Object.keys(reasons).length === 0) W.push('Every row with data was imported.'); else for (const [k, n] of Object.entries(reasons)) W.push(`- ${k}: ${n}`);
  W.push('', 'Candidate lists: in the ATS, Search Candidate, filter by the legacy source, then export. Row-level evidence: the HR-only evidence file.');
  fs.writeFileSync(path.join(rep, `what-was-migrated-${base}.md`), W.join('\n') + '\n');

  // Evidence file (personal data)
  const unitLabelOf = new Map(A.units.map((u) => [`${u.file}|${u.table}`, u.label]));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
    { Item: 'Source', Value: A.sourceLabel }, { Item: 'Database', Value: `${envName} (${db})` }, { Item: 'Verdict', Value: verdict }, { Item: 'Proof code', Value: proofCode },
    ...checks.map((c) => ({ Item: `Check ${c.n}: ${c.title}`, Value: `${c.result}. ${c.detail}` })),
  ]), 'Certificate');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(unitRows.map((u) => ({ Unit: u.label, 'Rows read': u.expected, 'Rows recorded': u.recorded, 'Count tool 1': u.countA, 'Count tool 2': u.countB }))), 'Per unit');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(prov.map((p) => ({ Unit: unitLabelOf.get(`${p.source_file}|${p.source_table}`) || p.source_table, Row: p.source_row_id, Result: p.outcome, 'ATS candidate id': p.cv_id === null ? '' : String(p.cv_id), Rules: (p.warnings || []).join(', ') }))), 'Row list');
  const notImported = new Set(A.notImportedOutcomes || ['rejected_min_fields']);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(prov.filter((p) => notImported.has(p.outcome)).map((p) => ({ Unit: unitLabelOf.get(`${p.source_file}|${p.source_table}`), Row: p.source_row_id, ...Object.fromEntries(Object.entries(p.raw_row || {}).map(([k, c]) => [k, Array.isArray(c) ? String(c[1]) : String(c)])) }))), 'Not imported');
  // Spot-check: a fixed hash-based sample of created candidates per unit, source value beside ATS value.
  const spot = [];
  const byUnit = new Map();
  for (const c of cands) { const p = provByKey.get(A.baseKey(c)); if (!p || p.outcome !== 'inserted') continue; const k = `${p.source_file}|${p.source_table}`; if (!byUnit.has(k)) byUnit.set(k, []); byUnit.get(k).push({ c, p }); }
  for (const [k, list] of byUnit) {
    const pick = list.map((x) => ({ ...x, h: sha(`${k}|${x.p.source_row_id}`) })).sort((a, b) => a.h.localeCompare(b.h)).slice(0, sampleN);
    for (const { c, p } of pick) {
      const cv = cvById.get(String(p.cv_id));
      const show = (v) => { const x = v && typeof v === 'object' && !(v instanceof Date) && v.constructor?.name !== 'Decimal' ? JSON.stringify(v) : String(v ?? ''); return x.length > 500 ? `${x.slice(0, 500)}…` : x; };
      for (const f of A.cvFields) if (c.fields[f] || cv?.[f]) spot.push({ Unit: unitLabelOf.get(k), Row: p.source_row_id, 'ATS id': String(p.cv_id), Field: f, 'Mapped from source': show(c.fields[f]), 'In the ATS today': show(cv?.[f]), Same: sameVal(f, cv?.[f], c.fields[f]) ? 'Same' : 'Different', 'Checked (HR)': '' });
    }
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(spot), 'Spot-check');
  XLSX.writeFile(wb, path.join(rep, `evidence-${base}.xlsx`));

  console.log(`${A.name} on ${envName} (${db}): ${verdict}, proof code ${proofCode}`);
  for (const c of checks) console.log(`  ${c.n}. ${c.result.padEnd(14)} ${c.title}\n     ${c.detail}`);
  console.log(`Written to ${rep}: certificate-${base}.md/.json, what-was-migrated-${base}.md, evidence-${base}.xlsx (personal data: HR-only folder)`);
  if (verdict !== 'COMPLETE') exitCode = 1;
} catch (e) {
  console.error(`FAILED: ${e.message}`);
  exitCode = 2;
} finally {
  await prisma.$disconnect();
}
process.exit(exitCode);
