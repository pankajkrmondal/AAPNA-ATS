// Completion certificate for one legacy source on one database.
// docs/Phase 4/PLAN-Legacy-Migration-Stage2-3-Excel-Naukri-Resumes.md, section 6.
// READ-ONLY: SELECT statements only. Writes files to <work>/report/ and nothing else.
//
//   cd backend
//   node scripts/legacy-proof/certify.mjs --source excel|ms_access --work <work folder> --env staging --expect-db recruitmentautomationdb [--sample 5]
//   node scripts/legacy-proof/certify.mjs --source excel --work <work folder> --env production --expect-db recruitmentautomationdbProd
//        --compare-env staging --compare-db recruitmentautomationdb          (check 8, production only)
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
if (!['excel', 'ms_access'].includes(source) || !work || !envName || !expectDb) {
  console.error('Usage: node certify.mjs --source excel|ms_access --work <folder> --env <staging|production> --expect-db <db> [--compare-env staging --compare-db recruitmentautomationdb] [--sample 5]');
  process.exit(2);
}
if (compareEnv && DB_OF_ENV[compareEnv] !== compareDb) { console.error(`REFUSED: --compare-env ${compareEnv} does not belong with --compare-db "${compareDb}".`); process.exit(1); }
prepareEnv({ envName, expectDb, writes: false, work, logLevel: 'error' });
const { default: prisma } = await import('../../src/config/database.js');

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const shaFile = (f) => sha(fs.readFileSync(f));
const readLines = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

// ── Source adapters: what the source consists of, as the work folder records it ──
async function adapter() {
  const manifest = JSON.parse(fs.readFileSync(path.join(work, 'manifest.json'), 'utf8').replace(/^﻿/, ''));
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
  const prov = await prisma.$queryRaw`SELECT batch_id::text batch_id, source_file, source_table, source_row_id, outcome, cv_id, warnings, raw_row, created_at
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
    if (prev) { const p = JSON.parse(fs.readFileSync(path.join(work, 'report', prev), 'utf8')); fpMatchesStaging = JSON.stringify(p.fingerprints.work) === JSON.stringify(workFp); }
  }
  add(1, 'Right data: the exact source files, fingerprinted, the same for staging and live', srcChanged === 0 && fpMatchesStaging !== false,
    `${A.sourceFiles.length} source file(s) fingerprinted; ${srcChanged} changed since extraction; work files ${Object.entries(workFp).map(([k, v]) => `${k} ${v}`).join(', ')}${compareEnv ? `; same as the ${compareEnv} certificate: ${fpMatchesStaging === null ? 'no staging certificate found' : fpMatchesStaging ? 'yes' : 'NO'}` : ''}`);
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
  const cands = readLines(path.join(work, 'transform', 'candidates.jsonl'));
  const mismatch = {}; let compared = 0; let skippedChanged = 0; let dateMismatch = 0;
  const changedSet = new Set(changedLater);
  for (const c of cands) {
    const p = provByKey.get(A.baseKey(c));
    if (!p || p.outcome !== 'inserted') continue;
    if (changedSet.has(String(p.cv_id))) { skippedChanged++; continue; }
    const cv = cvById.get(String(p.cv_id)); if (!cv) continue;
    compared++;
    for (const f of A.cvFields) if (String(cv[f] ?? '') !== String(c.fields[f] ?? '')) mismatch[f] = (mismatch[f] || 0) + 1;
    if (c.createdAt && cv.createdAt?.toISOString().slice(0, 10) !== c.createdAt) dateMismatch++;
  }
  add(5, 'Values correct', Object.keys(mismatch).length === 0 && dateMismatch === 0,
    `${compared} created candidates compared on ${A.cvFields.length} columns and the created date: ${Object.keys(mismatch).length ? `differences ${JSON.stringify(mismatch)}` : 'no difference'}${dateMismatch ? `, ${dateMismatch} dates differ` : ''}; ${skippedChanged} edited by HR since, not compared; spot-check sample in the evidence file`);

  // 6. Findable
  const insWithEmail = [...insertedIds].filter((id) => String(cvById.get(id)?.EmailID || '').trim());
  let withVec = 0;
  for (let i = 0; i < insWithEmail.length; i += 1000) { const [{ n }] = await prisma.$queryRawUnsafe('select count(distinct candidate_id)::int n from public.rpa_cv_vectors where candidate_id = any($1::bigint[]) and embedding is not null', insWithEmail.slice(i, i + 1000).map(Number)); withVec += n; }
  add(6, 'Findable', withVec === insWithEmail.length, `${withVec} of ${insWithEmail.length} created candidates with an email have a search entry (${insertedIds.size - insWithEmail.length} have no email)`);

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
      let onlyHere = 0; let onlyThere = 0; let allowed = 0; let other_ = 0;
      for (const p of prov) { const o = om.get(pkey(p)); if (!o) onlyHere++; else if (o !== p.outcome) { if (new Set([o, p.outcome]).size === 2 && [o, p.outcome].every((x) => x === 'inserted' || x === 'updated_existing')) allowed++; else other_++; } }
      for (const k of om.keys()) if (!provByKey.has(k)) onlyThere++;
      add(8, 'Live matches staging', onlyHere === 0 && onlyThere === 0 && other_ === 0, `${prov.length} live rows against ${oprov.length} staging rows: only live ${onlyHere}, only staging ${onlyThere}, new-vs-existing differences ${allowed} (allowed: production holds more real candidates), other differences ${other_}`);
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
  for (const r of rows.filter((x) => x.status === 'rejected')) { const k = r.warnings.includes('only_shared_contacts') ? 'only contact shared by several people' : 'no valid email and no valid phone'; reasons[k] = (reasons[k] || 0) + 1; }
  const years = {}; for (const c of cands) { const y = c.createdAt ? c.createdAt.slice(0, 4) : 'no date'; years[y] = (years[y] || 0) + 1; }
  const roles = {}; for (const c of cands) { const r = c.fields.PositionApplied || '(none)'; roles[r] = (roles[r] || 0) + 1; }
  const fill = Object.fromEntries(A.cvFields.map((f) => [f, cands.filter((c) => c.fields[f]).length]).filter(([, n]) => n > 0));
  const W = [];
  W.push(`# What was migrated: ${A.name}, ${envName}`, '', `Status: ${verdict}, proof code ${proofCode}.`, '');
  W.push('## What came in', '', `- ${A.units.length} ${A.kind === 'excel' ? 'sheets' : 'tables'}, ${expectedTotal} rows. ${A.skipped.length ? `${A.skipped.length} sheets not loaded (summary sheets, a staff timesheet, a sheet already in MS Access).` : ''}`);
  W.push(`- Years in the data: ${Object.entries(years).sort().map(([y, n]) => `${y}: ${n}`).join(', ')} (people).`);
  W.push(`- Most common roles: ${Object.entries(roles).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([r, n]) => `${r} (${n})`).join(', ')}.`, '');
  W.push('## What happened', '', '| Result | Rows |', '|---|---|');
  for (const [k, label] of [['inserted', 'New candidate created'], ['updated_existing', 'Matched a candidate already in the ATS (empty fields filled, nothing overwritten)'], ['merged_in_file', 'Another row of the same person'], ['skipped_blank', 'Blank row'], ['rejected_min_fields', 'Not imported']]) W.push(`| ${label} | ${byOutcome[k] || 0} |`);
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
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(prov.filter((p) => p.outcome === 'rejected_min_fields').map((p) => ({ Unit: unitLabelOf.get(`${p.source_file}|${p.source_table}`), Row: p.source_row_id, ...Object.fromEntries(Object.entries(p.raw_row || {}).map(([k, c]) => [k, Array.isArray(c) ? String(c[1]) : String(c)])) }))), 'Not imported');
  // Spot-check: a fixed hash-based sample of created candidates per unit, source value beside ATS value.
  const spot = [];
  const byUnit = new Map();
  for (const c of cands) { const p = provByKey.get(A.baseKey(c)); if (!p || p.outcome !== 'inserted') continue; const k = `${p.source_file}|${p.source_table}`; if (!byUnit.has(k)) byUnit.set(k, []); byUnit.get(k).push({ c, p }); }
  for (const [k, list] of byUnit) {
    const pick = list.map((x) => ({ ...x, h: sha(`${k}|${x.p.source_row_id}`) })).sort((a, b) => a.h.localeCompare(b.h)).slice(0, sampleN);
    for (const { c, p } of pick) {
      const cv = cvById.get(String(p.cv_id));
      for (const f of A.cvFields) if (c.fields[f] || cv?.[f]) spot.push({ Unit: unitLabelOf.get(k), Row: p.source_row_id, 'ATS id': String(p.cv_id), Field: f, 'Mapped from source': c.fields[f] || '', 'In the ATS today': cv?.[f] ?? '', Same: String(cv?.[f] ?? '') === String(c.fields[f] ?? '') ? 'Same' : 'Different', 'Checked (HR)': '' });
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
