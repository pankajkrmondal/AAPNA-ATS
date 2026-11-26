#!/usr/bin/env node
// Runs the Stage 3 load folder by folder, in load order (oldest year first): for each folder a dry run, then
// --apply, a vector retry if needed, then the read-only check (4c-check-batch.mjs). Stops at the first folder that
// does not pass; running it again skips the folders already done and repeats the stopped one from its dry run.
// As Stage 2's 6-run-files.mjs. AI insights run afterwards: 4b-insights.mjs.
//
//   cd backend
//   Staging sample:   node scripts/legacy-migration-resumes/7-run-folders.mjs --work <work> --sample --env staging --expect-db recruitmentautomationdb
//   One folder:       node scripts/legacy-migration-resumes/7-run-folders.mjs --work <work> --env production --expect-db recruitmentautomationdbProd --allow-production --only 3
//   The rest:         node scripts/legacy-migration-resumes/7-run-folders.mjs --work <work> --env production --expect-db recruitmentautomationdbProd --allow-production --max-people 2500
//   Dry runs only:    add --dry-run-only (reads only; every folder not yet done)
//
// --max-people N   per-run cap (plan 5.5, "a per-day cap on production"): a folder is not started when it would take
//                  this run past N people (new + matched); the run stops cleanly and the next run continues.
// Progress is kept in <work>/report/<env>-resume-load-all.json. A folder counts as done only when an entry says ok.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { argOf, DB_OF_ENV } from '../legacy-migration-excel/lib/env.mjs';

const argv = process.argv; const arg = argOf(argv);
const work = arg('--work'); const envName = arg('--env'); const expectDb = arg('--expect-db');
const SAMPLE = argv.includes('--sample'); const only = arg('--only') ? Number(arg('--only')) : null;
const maxPeople = arg('--max-people') ? Number(arg('--max-people')) : Infinity;
const allowProd = argv.includes('--allow-production'); const dryOnly = argv.includes('--dry-run-only');
if (!work || !envName || !expectDb) { console.error('Usage: node 7-run-folders.mjs --work <folder> --env <staging|production> --expect-db <database> [--sample | --only <n>] [--max-people N] [--allow-production] [--dry-run-only]'); process.exit(2); }
if (DB_OF_ENV[envName] !== expectDb) { console.error(`REFUSED: --env ${envName} with --expect-db "${expectDb}".`); process.exit(1); }
if (envName === 'production' && !allowProd) { console.error('REFUSED: production needs --allow-production (and Pankaj\'s go-ahead).'); process.exit(1); }
if (envName === 'production' && SAMPLE) { console.error('REFUSED: production loads every file (S18), not the sample.'); process.exit(1); }

const here = path.dirname(fileURLToPath(import.meta.url));
const backend = path.resolve(here, '..', '..');
const unitsDoc = JSON.parse(fs.readFileSync(path.join(work, SAMPLE ? 'transform-sample' : 'transform', 'units.json'), 'utf8'));
const steps = SAMPLE ? [{ key: 'sample', label: 'staging sample (S18)', args: ['--sample'] }]
  : unitsDoc.units.filter((u) => !only || u.n === only).map((u) => ({ key: `folder${u.n}`, n: u.n, label: `folder ${u.n} "${u.unit || '(root)'}"`, args: ['--folder', String(u.n)] }));
if (only && steps.length === 0) { console.error(`Unknown folder ${only}.`); process.exit(2); }

const common = ['--work', work, '--env', envName, '--expect-db', expectDb, ...(allowProd ? ['--allow-production'] : [])];
const outFile = path.join(work, 'report', `${envName}-resume-load-all.json`);
fs.mkdirSync(path.dirname(outFile), { recursive: true });
const results = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : [];
const save = () => { if (!dryOnly) fs.writeFileSync(outFile, JSON.stringify(results, null, 2)); };
// The scripts print their result with JSON.stringify(x, null, 2): take the LAST block from a line that is exactly "{"
// to the next line that is exactly "}".
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
const stop = (s, why, extra) => { console.log(`STOPPED at ${s.label}: ${why}`); if (extra) console.log(extra); results.push({ key: s.key, at: new Date().toISOString(), stopped: why }); save(); process.exit(1); };
const total = {}; let peopleThisRun = 0;

console.log(`${envName} / ${expectDb}: ${SAMPLE ? 'staging sample' : only ? `only folder ${only}` : `${steps.length} folders in load order`}${dryOnly ? ', DRY RUNS ONLY' : ''}${Number.isFinite(maxPeople) ? `, at most ${maxPeople} people this run` : ''}. Progress: ${outFile}`);
for (const s of steps) {
  if (results.some((r) => r.key === s.key && r.ok)) { console.log(`${s.label}: done in an earlier run, skipped`); continue; }
  const t0 = Date.now();
  const d = run('4-load.mjs', s.args);
  let dry; try { dry = jsonOf(d.out); } catch { dry = null; }
  if (!dry) stop(s, `dry run failed (exit ${d.code}). Nothing was written; run again.`, d.err || d.out.slice(-400));
  if (dry.database !== expectDb) stop(s, `wrong database ${dry.database}`);
  if (!dry.reconciles) stop(s, 'dry run does not reconcile', JSON.stringify(dry));
  console.log(`${s.label} dry run: files=${dry.handledRowsThisRun} people=${dry.candidates} new=${dry.new} matched=${dry.matched} nameConflicts=${dry.identity_conflicts} cvAttachedToExisting=${dry.cv_attached_existing} outcomes=${JSON.stringify(dry.rowsByOutcome)}`);
  for (const [k, v] of Object.entries(dry.rowsByOutcome)) total[k] = (total[k] || 0) + v;
  if (dryOnly) continue;
  const people = dry.new + dry.matched;
  if (peopleThisRun > 0 && peopleThisRun + people > maxPeople) { console.log(`Per-run cap: ${peopleThisRun} people loaded; ${s.label} (${people}) would pass ${maxPeople}. Stopping here; run again to continue.`); break; }
  if (dry.handledRowsThisRun === 0 || (dry.rowsByOutcome.already_done || 0) === dry.handledRowsThisRun) {
    results.push({ key: s.key, at: new Date().toISOString(), ok: true, note: 'nothing to load (all files done earlier or loaded with an earlier folder)' }); save();
    console.log(`${s.label}: nothing to load. OK`);
    continue;
  }
  const a = run('4-load.mjs', [...s.args, '--apply']);
  let ap; try { ap = jsonOf(a.out); } catch { ap = null; }
  if (!ap) stop(s, `apply failed (exit ${a.code}). Check with 4c-check-batch.mjs before running again.`, a.err || a.out.slice(-400));
  const res = { key: s.key, at: new Date().toISOString(), batchId: ap.batchId, dry: { new: dry.new, matched: dry.matched, identity_conflicts: dry.identity_conflicts }, apply: ap };
  const problems = [];
  if (!ap.reconciles) problems.push('apply does not reconcile');
  if (ap.failed) problems.push(`${ap.failed} people failed (upload or write); run again to retry them`);
  if (ap.new + ap.matched + ap.failed !== dry.new + dry.matched || ap.identity_conflicts !== dry.identity_conflicts) problems.push('apply counts differ from the dry run');
  if (ap.vector_failed > 0) {
    const rv = run('4d-retry-vectors.mjs', ['--apply']);
    res.vectorRetry = rv.code === 0 ? 'ok' : 'failed';
    if (rv.code !== 0) problems.push(`${ap.vector_failed} search entr(ies) failed and the retry failed too`);
  }
  if (ap.batchId && ap.handledRowsThisRun > (ap.rowsByOutcome.already_done || 0)) {
    const v = run('4c-check-batch.mjs', ['--batch', ap.batchId]);
    let ver; try { ver = jsonOf(v.out); } catch { ver = null; }
    if (!ver) problems.push(`check could not run: ${v.err}`);
    else { res.check = ver; problems.push(...ver.problems); if (ver.provenanceRows !== ap.handledRowsThisRun - (ap.rowsByOutcome.already_done || 0)) problems.push('provenance rows differ from files handled'); }
  }
  peopleThisRun += ap.new + ap.matched;
  res.seconds = Math.round((Date.now() - t0) / 1000);
  res.ok = problems.length === 0; res.problems = problems;
  results.push(res); save();
  console.log(`${s.label} ${res.seconds}s new=${ap.new} matched=${ap.matched} nameConflicts=${ap.identity_conflicts} uploads=${ap.uploads} searchEntries=${ap.vectors} batch=${ap.batchId} ${res.ok ? 'OK' : `PROBLEM: ${problems.join('; ')}`}`);
  if (!res.ok) { console.log('STOPPED. Later folders were not loaded.'); process.exit(1); }
}
if (dryOnly) console.log(`DRY-RUN TOTALS (files by outcome): ${JSON.stringify(total)}`);
console.log(dryOnly ? 'DRY RUNS DONE (nothing was written)' : `RUN DONE: ${peopleThisRun} people this run. Next: 4b-insights.mjs --apply`);
