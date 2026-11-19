// Runs the load table by table, in RUN_ORDER: for each table a dry run, then --apply, then
// the read-only check (3c-check-batch.mjs). Stops at the first table that does not pass;
// running it again skips the tables already done and repeats the stopped one from its dry run.
//
//   cd backend
//   Pilot only:      node scripts/legacy-migration/6-run-tables.mjs --work <work folder> --env production --expect-db recruitmentautomationdbProd --allow-production --only "Build & Release"
//   All the rest:    node scripts/legacy-migration/6-run-tables.mjs --work <work folder> --env production --expect-db recruitmentautomationdbProd --allow-production
//   (staging: --env staging --expect-db recruitmentautomationdb, no --allow-production)
//
// Progress is kept in <work>/report/<env>-load-all.json (one entry per table run). A table
// counts as done only when an entry for it says ok. Prints counts only.
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { RUN_ORDER } from './lib/mapping.mjs';

const argv = process.argv;
const arg = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
const work = arg('--work'); const envName = arg('--env'); const expectDb = arg('--expect-db'); const only = arg('--only');
const allowProd = argv.includes('--allow-production');
if (!work || !envName || !expectDb) { console.error('Usage: node 6-run-tables.mjs --work <folder> --env <staging|production> --expect-db <database> [--allow-production] [--only "<table>"]'); process.exit(2); }
if (envName === 'production' && !allowProd) { console.error('REFUSED: production needs --allow-production (and Pankaj\'s go-ahead, plan 3.14).'); process.exit(1); }
if (envName === 'production' && expectDb !== 'recruitmentautomationdbProd') { console.error(`REFUSED: --env production with --expect-db "${expectDb}".`); process.exit(1); }
if (envName === 'staging' && expectDb !== 'recruitmentautomationdb') { console.error(`REFUSED: --env staging with --expect-db "${expectDb}".`); process.exit(1); }
if (only && !RUN_ORDER.includes(only)) { console.error(`Unknown table "${only}".`); process.exit(2); }

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const common = ['--work', work, '--env', envName, '--expect-db', expectDb, ...(allowProd ? ['--allow-production'] : [])];
const outFile = path.join(work, 'report', `${envName}-load-all.json`);
fs.mkdirSync(path.dirname(outFile), { recursive: true });
const results = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : [];
const save = () => fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
// The scripts print their result with JSON.stringify(x, null, 2): a line that is exactly "{" up to
// the next line that is exactly "}". Under NODE_ENV=production the ATS logger also writes one-line
// JSON to stdout (for example a vector timeout), so take the LAST such block and ignore log lines.
// (Changed 18 Nov 2026 during the production run, Pankaj's decision; plan section 9.)
const jsonOf = (s) => {
  const lines = s.split('\n').map((l) => l.replace(/\r$/, ''));
  const start = lines.lastIndexOf('{');
  const end = lines.indexOf('}', start);
  if (start < 0 || end < 0) throw new Error('no result block in the script output');
  return JSON.parse(lines.slice(start, end + 1).join('\n'));
};
const run = (script, extra = []) => {
  const r = spawnSync(process.execPath, [path.join('scripts', 'legacy-migration', script), ...common, ...extra], { cwd: backend, encoding: 'utf8', maxBuffer: 1 << 28 });
  const clean = (s) => (s || '').split('\n').filter((l) => l && !/Redis/.test(l));
  return { code: r.status, out: clean(r.stdout).join('\n'), err: clean(r.stderr).slice(-5).join(' | ') };
};
const stop = (table, why, extra) => { console.log(`STOPPED at "${table}": ${why}`); if (extra) console.log(extra); results.push({ table, at: new Date().toISOString(), stopped: why }); save(); process.exit(1); };

console.log(`${envName} / ${expectDb}: ${only ? `only "${only}"` : `${RUN_ORDER.length} tables in RUN_ORDER`}. Progress file: ${outFile}`);
for (const table of only ? [only] : RUN_ORDER) {
  if (results.some((r) => r.table === table && r.ok)) { console.log(`"${table}": done in an earlier run, skipped`); continue; }
  const t0 = Date.now();
  const d = run('3-load.mjs', ['--table', table]);
  if (d.code !== 0) stop(table, `dry run failed (exit ${d.code}). Nothing was written for this table; run again.`, d.err || d.out.slice(-400));
  const dry = jsonOf(d.out);
  if (dry.database !== expectDb) stop(table, `wrong database ${dry.database}`);
  if (!dry.reconciles) stop(table, 'dry run does not reconcile', JSON.stringify(dry));
  console.log(`"${table}" dry run: rows=${dry.handledRowsThisRun} new=${dry.inserted} matchedExisting=${dry.updated_existing} alreadyDone=${dry.already_done}`);
  if (dry.handledRowsThisRun > 0 && dry.already_done === dry.handledRowsThisRun) {
    // Loaded earlier (for example the pilot, run on its own): nothing to apply.
    results.push({ table, at: new Date().toISOString(), ok: true, note: 'all rows already loaded earlier; nothing applied', dry: { already_done: dry.already_done } }); save();
    console.log(`"${table}": all ${dry.already_done} rows already loaded earlier, nothing to apply. OK`);
    continue;
  }
  const a = run('3-load.mjs', ['--table', table, '--apply']);
  if (a.code !== 0) stop(table, `apply failed (exit ${a.code}). Check the batch with 3c-check-batch.mjs before running again.`, a.err || a.out.slice(-400));
  const ap = jsonOf(a.out);
  const res = { table, at: new Date().toISOString(), batchId: ap.batchId, dry: { inserted: dry.inserted, updated_existing: dry.updated_existing, already_done: dry.already_done }, apply: ap };
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
  console.log(`"${table}" ${res.seconds}s rows=${ap.handledRowsThisRun} new=${ap.inserted} matchedExisting=${ap.updated_existing} merged=${ap.merged_in_file} blank=${ap.skipped_blank} noContact=${ap.rejected_min_fields} searchEntries=${ap.vectors} noEmail=${ap.vector_skipped_no_email} batch=${ap.batchId} ${res.ok ? 'OK' : 'PROBLEM: ' + problems.join('; ')}`);
  if (!res.ok) { console.log('STOPPED. Later tables were not loaded.'); process.exit(1); }
}
console.log(only ? `"${only}" DONE` : 'ALL TABLES DONE');
