/**
 * Test-block runner.
 *
 *   node src/tests/run-block.mjs <test-file> [...more]
 *
 * WHY THIS EXISTS
 * ---------------
 * Two problems make `node --test <file>` awkward for this suite:
 *
 *  1. The service layer opens a shared Redis connection at import time, which
 *     keeps the event loop alive after the run finishes. The process hangs, and
 *     a hung process is easy to misread as a failed test run.
 *  2. Piping through PowerShell's Select-Object buffers everything until exit —
 *     so a hung process shows NO output at all.
 *
 * This runs the file as a child process, streams a filtered live view to the
 * console, writes the FULL untouched log to test-results/<name>.log, prints the
 * node:test summary, and exits with the child's real code.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, createWriteStream } from 'node:fs';
import path from 'node:path';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: node src/tests/run-block.mjs <test-file> [...]');
  process.exit(2);
}

const outDir = path.resolve('test-results');
mkdirSync(outDir, { recursive: true });

/** Server chatter that would drown the test lines. The full log keeps it all. */
const NOISE = /Prisma query|Redis (shared )?connect|MS Graph Email|resolveRecipients\(|Stage-outcome email sent|auto-advanced|debug:|Email successfully sent/;

let failed = 0;

for (const file of files) {
  const name = path.basename(file).replace(/\.test\.js$/, '');
  const logPath = path.join(outDir, `${name}.log`);
  const log = createWriteStream(logPath);

  console.log(`\n${'='.repeat(70)}\nRUNNING ${file}\n  full log -> ${logPath}\n${'='.repeat(70)}`);

  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, ['--test', '--test-reporter=spec', file], {
      env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'staging' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let buf = '';
    const handle = (chunk) => {
      const text = chunk.toString();
      log.write(text);
      buf += text;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!NOISE.test(line)) console.log(line);
      }
    };
    child.stdout.on('data', handle);
    child.stderr.on('data', handle);

    // The run is over when node:test prints its summary; Redis may still hold
    // the loop open, so give it a moment and then stop waiting.
    let settled = false;
    const finish = (c) => { if (!settled) { settled = true; resolve(c); } };
    child.on('exit', (c) => finish(c ?? 0));

    const watchdog = setInterval(() => {
      if (/# (fail|pass) \d+/.test(buf) || /^# duration_ms/m.test(buf)) {
        clearInterval(watchdog);
        setTimeout(() => { child.kill(); finish(0); }, 1500);
      }
    }, 500);

    // Hard ceiling so a genuinely stuck run cannot block the pass forever.
    setTimeout(() => { clearInterval(watchdog); child.kill(); finish(124); }, 15 * 60 * 1000);
  });

  log.end();
  if (code !== 0) failed++;
}

process.exit(failed > 0 ? 1 : 0);
