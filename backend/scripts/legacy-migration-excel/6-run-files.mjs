// Runs the Stage 2 load sheet by sheet, in load order: for each sheet a dry run, then --apply,
// then the read-only check (3c-check-batch.mjs). Stops at the first sheet that does not pass;
// running it again skips the sheets already done and repeats the stopped one from its dry run.
// As Stage 1's 6-run-tables.mjs, including its 18 Nov fix of the result parser.
//
//   cd backend
//   One sheet:     node scripts/legacy-migration-excel/6-run-files.mjs --work <work folder> --env staging --expect-db recruitmentautomationdb --only 1
//   All the rest:  node scripts/legacy-migration-excel/6-run-files.mjs --work <work folder> --env staging --expect-db recruitmentautomationdb
//   Dry runs only: add --dry-run-only (reads only; prints the dry-run figures of every sheet not yet done)
//   (production: --env production --expect-db recruitmentautomationdbProd --allow-production)
//
// Progress is kept in <work>/report/<env>-load-all.json. A sheet counts as done only when an entry says ok.
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { argOf, DB_OF_ENV } from './lib/env.mjs';

const argv = process.argv; const arg = argOf(argv);
const work = arg('--work'); const envName = arg('--env'); const expectDb = arg('--expect-db'); const only = arg('--only') ? Number(arg('--only')) : null;
const allowProd = argv.includes('--allow-production'); const dryOnly = argv.includes('--dry-run-only');
if (!work || !envName || !expectDb) { console.error('Usage: node 6-run-files.mjs --work <folder> --env <staging|production> --expect-db <database> [--allow-production] [--only <n>] [--dry-run-only]'); process.exit(2); }
if (DB_OF_ENV[envName] !== expectDb) { console.error(`REFUSED: --env ${envName} with --expect-db "${expectDb}".`); process.exit(1); }
if (envName === 'production' && !allowProd) { console.error('REFUSED: production needs --allow-production (and Pankaj\'s go-ahead).'); process.exit(1); }
const units = JSON.parse(fs.readFileSync(path.join(work, 'transform', 'units.json'), 'utf8')).sort((a, b) => a.order - b.order);
if (only && !units.some((u) => u.order === only)) { console.error(`Unknown sheet ${only}.`); process.exit(2); }

const here = path.dirname(fileURLToPath(import.meta.url));
const backend = path.resolve(here, '..', '..');
const common = ['--work', work, '--env', envName, '--expect-db', expectDb, ...(allowProd ? ['--allow-production'] : [])];
const outFile = path.join(work, 'report', `${envName}-load-all.json`);
fs.mkdirSync(path.dirname(outFile), { recursive: true });
const results = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : [];
const save = () => { if (!dryOnly) fs.writeFileSync(outFile, JSON.stringify(results, null, 2)); };
// The scripts print their result with JSON.stringify(x, null, 2): take the LAST block from a line
// that is exactly "{" to the next line that is exactly "}"; one-line log JSON is ignored.
const jsonOf = (s) => {
  const lines = s.split('\n').map((l) => l.replace(/\r$/, ''));
  const start = lines.lastIndexOf('{'); const end = lines.indexOf('}', start);
  if (start < 0 || end < 0) throw new Error('no result block in the script output');
  return JSON.parse(lines.slice(start, end + 1).join('\n'));
};
const run = (script, extra = []) => {
  const r = spawnSync(process.execPath, [path.join(here, script), ...common, ...extra], { cwd: backend, encoding: 'utf8', maxBuffer: 1 << 28 });
  const clean = (s) => (s || '').split('\n').filter((l) => l && !/Redis/.test(l));
  return { code: r.status, out: clean(r.stdout).join('\n'), err: clean(r.stderr).slice(-5).join(' | ') };
};
const stop = (u, why, extra) => { console.log(`STOPPED at sheet ${u.order}: ${why}`); if (extra) console.log(extra); results.push({ order: u.order, unit: u.unit, at: new Date().toISOString(), stopped: why }); save(); process.exit(1); };
const total = { inserted: 0, updated_existing: 0, merged_in_file: 0, skipped_blank: 0, rejected_min_fields: 0, already_done: 0, truncation_repaired: 0, history_appended: 0 };

console.log(`${envName} / ${expectDb}: ${only ? `only sheet ${only}` : `${units.length} sheets in load order`}${dryOnly ? ', DRY RUNS ONLY' : ''}. Progress file: ${outFile}`);
for (const u of only ? units.filter((x) => x.order === only) : units) {
  const name = `${u.order} "${u.file.split(/[\\/]/).pop()} | ${u.sheet}"`;
  if (results.some((r) => r.order === u.order && r.ok)) { console.log(`${name}: done in an earlier run, skipped`); continue; }
  const t0 = Date.now();
  const d = run('3-load.mjs', ['--file', String(u.order)]);
  if (d.code !== 0) stop(u, `dry run failed (exit ${d.code}). Nothing was written for this sheet; run again.`, d.err || d.out.slice(-400));
  const dry = jsonOf(d.out);
  if (dry.database !== expectDb) stop(u, `wrong database ${dry.database}`);
  if (!dry.reconciles) stop(u, 'dry run does not reconcile', JSON.stringify(dry));
  console.log(`${name} dry run: rows=${dry.handledRowsThisRun} new=${dry.inserted} matchedExisting=${dry.updated_existing} (noChange=${dry.updated_no_change} truncationRepaired=${dry.truncation_repaired} historyAppended=${dry.history_appended}) merged=${dry.merged_in_file} blank=${dry.skipped_blank} noContact=${dry.rejected_min_fields} alreadyDone=${dry.already_done}`);
  for (const k of Object.keys(total)) total[k] += dry[k] || 0;
  if (dryOnly) continue;
  if (dry.handledRowsThisRun > 0 && dry.already_done === dry.handledRowsThisRun) {
    results.push({ order: u.order, unit: u.unit, at: new Date().toISOString(), ok: true, note: 'all rows already loaded earlier; nothing applied', dry: { already_done: dry.already_done } }); save();
    console.log(`${name}: all ${dry.already_done} rows already loaded earlier, nothing to apply. OK`);
    continue;
  }
  if (dry.handledRowsThisRun === 0) {
    results.push({ order: u.order, unit: u.unit, at: new Date().toISOString(), ok: true, note: 'every row of this sheet was loaded with an earlier sheet; nothing to apply' }); save();
    console.log(`${name}: every row was loaded with an earlier sheet, nothing to apply. OK`);
    continue;
  }
  const a = run('3-load.mjs', ['--file', String(u.order), '--apply']);
  if (a.code !== 0) stop(u, `apply failed (exit ${a.code}). Check the batch with 3c-check-batch.mjs before running again.`, a.err || a.out.slice(-400));
  const ap = jsonOf(a.out);
  const res = { order: u.order, unit: u.unit, at: new Date().toISOString(), batchId: ap.batchId, dry: { inserted: dry.inserted, updated_existing: dry.updated_existing, already_done: dry.already_done }, apply: ap };
  const problems = [];
  if (!ap.reconciles) problems.push('apply does not reconcile');
  if (ap.inserted !== dry.inserted || ap.updated_existing !== dry.updated_existing) problems.push('apply counts differ from the dry run');
  if (ap.vector_failed > 0) {
    const rv = run('3b-retry-vectors.mjs', ['--apply']);
    res.vectorRetry = rv.code === 0 ? 'ok' : 'failed';
    if (rv.code !== 0) problems.push(`${ap.vector_failed} search entr(ies) failed and the retry failed too`);
  }
  if (ap.batchId && ap.handledRowsThisRun > (ap.already_done || 0)) {
    const v = run('3c-check-batch.mjs', ['--batch', ap.batchId]);
    let ver; try { ver = jsonOf(v.out); } catch { ver = null; }
    if (!ver) problems.push(`check could not run: ${v.err}`);
    else { res.check = ver; problems.push(...ver.problems); if (ver.provenanceRows !== ap.handledRowsThisRun - (ap.already_done || 0)) problems.push('provenance rows differ from rows handled'); }
  }
  res.seconds = Math.round((Date.now() - t0) / 1000);
  res.ok = problems.length === 0; res.problems = problems;
  results.push(res); save();
  console.log(`${name} ${res.seconds}s rows=${ap.handledRowsThisRun} new=${ap.inserted} matchedExisting=${ap.updated_existing} truncationRepaired=${ap.truncation_repaired} historyAppended=${ap.history_appended} merged=${ap.merged_in_file} blank=${ap.skipped_blank} noContact=${ap.rejected_min_fields} searchEntries=${ap.vectors} noEmail=${ap.vector_skipped_no_email} batch=${ap.batchId} ${res.ok ? 'OK' : 'PROBLEM: ' + problems.join('; ')}`);
  if (!res.ok) { console.log('STOPPED. Later sheets were not loaded.'); process.exit(1); }
}
if (dryOnly) console.log(`DRY-RUN TOTALS: ${JSON.stringify(total)}`);
console.log(only ? `sheet ${only} DONE` : dryOnly ? 'ALL DRY RUNS DONE (nothing was written)' : 'ALL SHEETS DONE');
