// Proof pack for management (plan 3.13). READ-ONLY: SELECT statements only, nothing is
// written to the database. Writes one Excel workbook into <work>/report/.
//
//   cd backend
//   node scripts/legacy-migration/5-proof-pack.mjs --work <work folder> --env staging --expect-db recruitmentautomationdb [--sample 5]
//
// The workbook holds candidate personal data. It is written outside the repository and
// is handed to HR. While tables are still being loaded the pack is marked INCOMPLETE.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import XLSX from 'xlsx';
import {
  SOURCE_KIND, TAG, RUN_ORDER, CV_FIELDS, classifyHeader, HYPER_TABLE, HYPER_POSITIONS, EXTRA_COLUMNS, NAME_ROW_REPAIR,
} from './lib/mapping.mjs';

const argv = process.argv;
const arg = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
const work = arg('--work'); const envName = arg('--env'); const expectDb = arg('--expect-db');
const samplePerTable = Math.max(1, parseInt(arg('--sample') || '5', 10));
if (!work || !envName || !expectDb) { console.error('Usage: node 5-proof-pack.mjs --work <folder> --env <staging|production> --expect-db <database> [--sample 5]'); process.exit(2); }
process.env.NODE_ENV = envName;
process.env.LOG_LEVEL = 'error';
process.env.LOG_DIR = path.join(work, 'logs');
const { default: prisma } = await import('../../src/config/database.js');

const OUTCOME = {
  inserted: 'New candidate created',
  merged_in_file: 'Merged into another row of the same person',
  updated_existing: 'Matched a candidate already in the ATS',
  skipped_blank: 'Blank row, skipped',
  rejected_min_fields: 'Not imported: no valid email and no phone',
};
const cellText = (c) => (c === null || c === undefined ? '' : String(Array.isArray(c) ? c[1] : c).trim());
const norm = (v) => String(v ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 19).replace('T', ' ') + ' UTC' : '');
// Which ATS column an Access column feeds (same logic as 2-transform.mjs).
const targetOf = (table, col) => {
  let cls = (EXTRA_COLUMNS[table] || {})[col] || null;
  let header = col;
  if (!cls && table === HYPER_TABLE) { header = HYPER_POSITIONS[col] || col; cls = HYPER_POSITIONS[col] ? classifyHeader(header) : null; }
  if (!cls && table !== HYPER_TABLE) cls = classifyHeader(col);
  if (!cls) return { header, field: null, label: '(not mapped: kept in the import record only)' };
  switch (cls.kind) {
    case 'knownUnmapped': return { header, field: null, label: '(not imported, by decision)' };
    case 'hrComment': return { header, field: 'HRQuickcomments', label: 'HRQuickcomments' };
    case 'managerial': case 'ceo': return { header, field: 'ManagerialOrCEOFeedback', label: 'ManagerialOrCEOFeedback' };
    case 'uiuxCompany': return { header, field: 'CurrentCompany', label: 'CurrentCompany' };
    case 'uiuxMarks': return { header, field: 'EducationalScoresPercentage', label: 'EducationalScoresPercentage, a10th, a12th, graduation, postGraduation' };
    default: return cls.field === '_date' ? { header, field: 'createdAt', label: 'createdAt (created date)' } : { header, field: cls.field, label: cls.field };
  }
};

let exitCode = 0;
try {
  const [{ db }] = await prisma.$queryRawUnsafe('select current_database() db');
  if (db !== expectDb) { console.error(`REFUSED: connected to "${db}" but --expect-db is "${expectDb}". Nothing was run.`); process.exit(1); }
  const manifest = JSON.parse(fs.readFileSync(path.join(work, 'manifest.json'), 'utf8').replace(/^﻿/, ''));
  const sourceFile = manifest.sourceFile;
  const generatedAt = new Date();

  const prov = await prisma.$queryRaw`
    SELECT source_table, source_row_id, outcome, cv_id, batch_id::text AS batch_id, warnings, created_at
    FROM rpa_legacy_import_rows WHERE source_kind = ${SOURCE_KIND} AND source_file = ${sourceFile} ORDER BY id`;
  const byTable = new Map();
  for (const r of prov) { if (!byTable.has(r.source_table)) byTable.set(r.source_table, []); byTable.get(r.source_table).push(r); }

  // ── Per table ──
  const perTable = []; const tot = { access: 0, recorded: 0, inserted: 0, merged_in_file: 0, updated_existing: 0, skipped_blank: 0, rejected_min_fields: 0 };
  let tablesComplete = 0;
  for (const name of RUN_ORDER) {
    const m = manifest.tables.find((t) => t.table === name);
    const rows = byTable.get(name) || [];
    const n = (o) => rows.filter((r) => r.outcome === o).length;
    const line = {
      'Load order': RUN_ORDER.indexOf(name) + 1, 'Access table': name, 'Rows in Access': m.accessCount, 'Rows recorded in the ATS database': rows.length,
      'New candidates created': n('inserted'), 'Merged into another row of the same person': n('merged_in_file'), 'Matched a candidate already in the ATS': n('updated_existing'),
      'Blank rows skipped': n('skipped_blank'), 'Not imported (no email, no phone)': n('rejected_min_fields'),
      Difference: m.accessCount - rows.length, Status: rows.length === m.accessCount ? 'Complete' : rows.length === 0 ? 'Not loaded yet' : 'Partly loaded',
    };
    perTable.push(line);
    if (line.Status === 'Complete') tablesComplete++;
    tot.access += m.accessCount; tot.recorded += rows.length;
    for (const o of Object.keys(OUTCOME)) tot[o] += n(o);
  }
  const complete = tablesComplete === RUN_ORDER.length && tot.access === tot.recorded;
  perTable.push({ 'Load order': '', 'Access table': 'TOTAL', 'Rows in Access': tot.access, 'Rows recorded in the ATS database': tot.recorded, 'New candidates created': tot.inserted, 'Merged into another row of the same person': tot.merged_in_file, 'Matched a candidate already in the ATS': tot.updated_existing, 'Blank rows skipped': tot.skipped_blank, 'Not imported (no email, no phone)': tot.rejected_min_fields, Difference: tot.access - tot.recorded, Status: complete ? 'Complete' : 'INCOMPLETE' });

  // ── Candidates behind the rows ──
  const insertedIds = [...new Set(prov.filter((r) => r.outcome === 'inserted').map((r) => r.cv_id))];
  const matchedIds = [...new Set(prov.filter((r) => r.outcome === 'updated_existing').map((r) => r.cv_id))];
  const cvs = new Map();
  for (let i = 0; i < insertedIds.length; i += 1000) {
    const part = await prisma.rpa_cv.findMany({ where: { id: { in: insertedIds.slice(i, i + 1000) } }, select: { id: true, last_action_context: true, createdAt: true, ...Object.fromEntries(CV_FIELDS.map((k) => [k, true])) } });
    for (const c of part) cvs.set(String(c.id), c);
  }
  const [{ n: vectors }] = insertedIds.length
    ? await prisma.$queryRawUnsafe('select count(distinct candidate_id)::int n from public.rpa_cv_vectors where candidate_id = any($1::bigint[])', insertedIds.map(Number))
    : [{ n: 0 }];
  const stillThere = insertedIds.filter((id) => cvs.has(String(id))).length;
  const stillTagged = [...cvs.values()].filter((c) => c.last_action_context === TAG).length;
  const batches = new Set(prov.map((r) => r.batch_id));
  const times = prov.map((r) => r.created_at).sort((a, b) => a - b);

  const summary = [
    ['Proof pack: legacy candidate data imported into the ATS'],
    [complete ? 'Status: COMPLETE. Every row of the source file is accounted for.' : `Status: INCOMPLETE. ${tablesComplete} of ${RUN_ORDER.length} tables are fully loaded. Do not use this copy as proof.`],
    [],
    ['Source', 'MS Access'],
    ['Source file', path.basename(sourceFile)],
    ['Read from Access on', manifest.extractedAt],
    ['ATS database', `${db} (${envName})`],
    ['First row loaded', iso(times[0])],
    ['Last row loaded', iso(times[times.length - 1])],
    ['Load runs (batches)', batches.size],
    ['This pack generated on', iso(generatedAt)],
    [],
    ['What happened to the rows of the Access file', 'Rows'],
    ['Rows in the Access file (28 tables)', tot.access],
    ['1. Became a new candidate in the ATS', tot.inserted],
    ['2. Merged into another row of the same person (same email or phone inside the Access file)', tot.merged_in_file],
    ['3. Matched a candidate who was already in the ATS (empty fields filled, nothing overwritten)', tot.updated_existing],
    ['4. Blank rows, skipped', tot.skipped_blank],
    ['5. Not imported: no valid email and no phone (listed on the sheet "Not imported")', tot.rejected_min_fields],
    ['Total of 1 to 5', tot.recorded],
    ['Rows not accounted for (must be 0)', tot.access - tot.recorded],
    [],
    ['Candidates', 'Count'],
    ['New candidates created by the import', insertedIds.length],
    ['  of these, still in the ATS today', stillThere],
    ['  of these, with a search entry (candidates with no email get none)', vectors],
    ['  of these, still carrying the import tag (the tag changes when a candidate is updated later)', stillTagged],
    ['Existing ATS candidates matched by an Access row', matchedIds.length],
    [],
    ['How to read this pack'],
    ['Per table: the same counts for each Access table. "Rows in Access" must equal "Rows recorded".'],
    ['Row list: every Access row, what happened to it and the ATS candidate id it belongs to.'],
    ['Not imported: the rows without contact details, with their Access values, for HR.'],
    ['Spot-check: sample candidates per table, Access value beside ATS value, with a column to tick.'],
    ['Decisions: the mapping decisions that changed data, with row counts.'],
    ['The untouched Access row of every record is kept in the database table rpa_legacy_import_rows.'],
  ];

  // ── Row list ──
  const rowList = prov.map((r) => ({
    'Access table': r.source_table, 'Access row': r.source_row_id, 'What happened': OUTCOME[r.outcome] || r.outcome,
    'ATS candidate id': r.cv_id === null ? '' : Number(r.cv_id), 'Loaded on': iso(r.created_at), 'Load run (batch)': r.batch_id,
    'Value rules that fired': (r.warnings || []).join(', '),
  }));

  // ── Not imported (raw rows are fetched only for these) ──
  const rejected = await prisma.$queryRaw`
    SELECT source_table, source_row_id, raw_row FROM rpa_legacy_import_rows
    WHERE source_kind = ${SOURCE_KIND} AND source_file = ${sourceFile} AND outcome = 'rejected_min_fields' ORDER BY id`;
  const notImported = rejected.map((r) => {
    const o = { 'Access table': r.source_table, 'Access row': r.source_row_id, Reason: 'No valid email and no valid 10-digit phone number in the row' };
    for (const [col, cell] of Object.entries(r.raw_row || {})) { const v = cellText(cell); if (v) o[targetOf(r.source_table, col).header] = v; }
    return o;
  });

  // ── Spot-check: a fixed sample of new candidates per table ──
  // The sample is chosen by a hash of table and row id, so the same rows come out every time.
  const candPath = path.join(work, 'transform', 'candidates.jsonl');
  const mapped = new Map(); // base key -> fields as mapped by the transform
  if (fs.existsSync(candPath)) for (const l of fs.readFileSync(candPath, 'utf8').split('\n').filter(Boolean)) { const c = JSON.parse(l); mapped.set(`${c.base.table}\u0000${c.base.id}`, c); }
  const hash = (r) => crypto.createHash('sha1').update(`${r.source_table}|${r.source_row_id}`).digest('hex');
  const picks = [];
  for (const name of RUN_ORDER) picks.push(...(byTable.get(name) || []).filter((r) => r.outcome === 'inserted' && cvs.has(String(r.cv_id))).sort((a, b) => hash(a).localeCompare(hash(b))).slice(0, samplePerTable));
  const spot = [];
  for (const p of picks) {
    const [{ raw_row: raw }] = await prisma.$queryRaw`SELECT raw_row FROM rpa_legacy_import_rows WHERE source_kind = ${SOURCE_KIND} AND source_file = ${sourceFile} AND source_table = ${p.source_table} AND source_row_id = ${p.source_row_id}`;
    const cv = cvs.get(String(p.cv_id));
    const m = mapped.get(`${p.source_table}\u0000${p.source_row_id}`);
    const repaired = (p.warnings || []).some((w) => w.startsWith('name_'));
    for (const [col, cell] of Object.entries(raw || {})) {
      const access = cellText(cell); if (!access) continue;
      const t = targetOf(p.source_table, col);
      let ats = ''; let result = 'Not imported';
      if (t.field) {
        ats = t.field === 'createdAt' ? (cv.createdAt ? cv.createdAt.toISOString().slice(0, 10) : '') : String(cv[t.field] ?? '');
        const a = norm(Array.isArray(cell) && cell[0] === 'd' ? access.slice(0, 10) : access); const b = norm(ats);
        if (a === b) result = 'Same';
        else if (b && b.includes(a)) result = 'Same (ATS value holds this and more: joined columns or several rows of the same person)';
        else if (t.field === 'Name' && repaired) result = 'Different: name corrected, see sheet "Decisions"';
        else if (m && t.field !== 'createdAt' && norm(m.fields[t.field]) === b) result = 'As mapped: a value rule cleaned it, or the value came from an earlier row of the same person';
        else if (t.field === 'createdAt' && m && (m.createdAt || '') === ats) result = 'As mapped: date read day-first';
        else result = 'Different: check';
      }
      spot.push({ 'Access table': p.source_table, 'Access row': p.source_row_id, 'ATS candidate id': Number(p.cv_id), 'Access column': t.header, 'Value in Access': access, 'ATS column': t.label, 'Value in the ATS today': ats, Result: result, 'Checked by HR (tick)': '', 'HR remark': '' });
    }
  }

  // ── Decisions ──
  const warnCount = (w) => prov.filter((r) => (r.warnings || []).includes(w)).length;
  const conflictRows = prov.filter((r) => (r.warnings || []).some((w) => w.startsWith('conflict:'))).length;
  const rep = NAME_ROW_REPAIR['DotNet 22 April'];
  const decisions = [
    { Decision: 'Rows of the same person inside the Access file are merged into one candidate', 'Decided by': 'Pankaj, 16 Nov 2026', Detail: 'Rows that share an email or a phone number are one person. The earliest row is the base; a filled field is never overwritten by a later row.', 'Rows affected': tot.merged_in_file },
    { Decision: 'Rows with no valid email and no phone are not imported', 'Decided by': 'Pankaj, 16 Nov 2026', Detail: 'Listed on the sheet "Not imported" for HR.', 'Rows affected': tot.rejected_min_fields },
    { Decision: 'Candidate already in the ATS: fill empty fields only', 'Decided by': 'Pankaj, 16 Nov 2026', Detail: 'Filled fields are left alone. Access HR comments and round notes are added under a "Legacy (MS Access)" label. Extra emails and phones are added.', 'Rows affected': tot.updated_existing },
    { Decision: 'DotNet 22 April: names one row out of place were repaired', 'Decided by': 'Pankaj, 17 Nov 2026', Detail: `In Access rows ${rep.fromRowAbove.map(([a, b]) => `r${a}-r${b}`).join(', ')} the Name cell held the name of the person on the next row. The name is taken from the row above. Rows ${rep.blank.map((n) => `r${n}`).join(', ')} are loaded without a name; rows ${rep.review.map((n) => `r${n}`).join(', ')} keep the Access name and are listed for HR.`, 'Rows affected': warnCount('name_from_row_above') + warnCount('name_unknown_row_before_repair') + warnCount('name_review_edge_of_repair') },
    { Decision: 'Dot Net  March 2024: rows with cells shifted to the right are not imported', 'Decided by': 'Pankaj, 17 Nov 2026', Detail: 'In these rows the phone number sits in the email column and the score in the status column. They are on the sheet "Not imported".', 'Rows affected': (byTable.get('Dot Net  March 2024') || []).filter((r) => r.outcome === 'rejected_min_fields').length },
    { Decision: 'Different values for the same person in two tables: the base row keeps its value', 'Decided by': 'Pankaj, 17 Nov 2026', Detail: 'The other value is not written to the candidate. It stays in the import record of its own row.', 'Rows affected': conflictRows },
    { Decision: 'Created date of the candidate is the original Access date', 'Decided by': 'Pankaj, 16 Nov 2026', Detail: 'A candidate with no date in Access gets the import date.', 'Rows affected': '' },
  ];

  // ── Write the workbook ──
  const wb = XLSX.utils.book_new();
  const sheet = (rows, name, widths) => { const ws = Array.isArray(rows[0]) ? XLSX.utils.aoa_to_sheet(rows) : XLSX.utils.json_to_sheet(rows.length ? rows : [{ Note: 'No rows' }]); if (widths) ws['!cols'] = widths.map((w) => ({ wch: w })); XLSX.utils.book_append_sheet(wb, ws, name); };
  sheet(summary, 'Summary', [95, 60]);
  sheet(perTable, 'Per table', [10, 32, 14, 18, 16, 20, 20, 12, 18, 10, 14]);
  sheet(rowList, 'Row list', [32, 12, 44, 16, 24, 38, 50]);
  sheet(notImported, 'Not imported', [28, 12, 50]);
  sheet(spot, 'Spot-check', [28, 12, 16, 30, 45, 30, 45, 50, 18, 30]);
  sheet(decisions, 'Decisions', [70, 22, 110, 14]);
  const stamp = generatedAt.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  const outDir = path.join(work, 'report');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `proof-pack-ms-access-${envName}-${stamp}${complete ? '' : '-INCOMPLETE'}.xlsx`);
  XLSX.writeFile(wb, outFile);

  const results = {}; for (const s of spot) results[s.Result.split(':')[0]] = (results[s.Result.split(':')[0]] || 0) + 1;
  console.log(JSON.stringify({
    database: db, complete, tablesComplete: `${tablesComplete} of ${RUN_ORDER.length}`, rowsInAccess: tot.access, rowsRecorded: tot.recorded, notAccountedFor: tot.access - tot.recorded,
    newCandidates: insertedIds.length, stillInAts: stillThere, withSearchEntry: vectors, matchedExisting: matchedIds.length,
    sheets: { perTable: perTable.length - 1, rowList: rowList.length, notImported: notImported.length, spotCheckCandidates: picks.length, spotCheckLines: spot.length },
    spotCheckResults: results, file: outFile,
  }, null, 2));
} catch (e) {
  console.error(`FAILED: ${e.message}`);
  exitCode = 1;
} finally {
  await prisma.$disconnect();
}
process.exit(exitCode);
