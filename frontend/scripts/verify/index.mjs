/**
 * `npm run verify:design` — the design system's own test suite.
 *
 * Runs every check and exits non-zero if any assertion fails, so this can gate a
 * commit or a pipeline rather than being something someone remembers to look at.
 *
 * Requires the app to be serving. Point it with VERIFY_BASE if not on :5173:
 *   npm run dev
 *   VERIFY_BASE=http://localhost:5173 npm run verify:design
 */
import { BASE } from './lib.mjs';
import contrast from './contrast.mjs';
import swapMatrix from './swap-matrix.mjs';
import nonRegression from './non-regression.mjs';
import a11y from './a11y.mjs';
import parity from './parity.mjs';
import dupClassName from './dup-classname.mjs';
import statusBorder from './status-border.mjs';
import functional from './functional.mjs';
import typeFloor from './type-floor.mjs';
import composition from './composition.mjs';

const CHECKS = [
  ['non-regression', nonRegression],
  ['swap matrix', swapMatrix],
  ['accessibility', a11y],
  ['contrast', contrast],
  ['parity', parity],
  // Source-level, so it runs without a server — a duplicate className is invisible at
  // the browser surface, which is exactly why it shipped twice.
  ['duplicate className', dupClassName],
  // The Failure B regression test: a `border` shorthand erasing the status edge on
  // /pipeline is invisible in a screenshot and has already shipped once.
  ['status border', statusBorder],
  // Does the app still WORK, not just render. Writes are stubbed at the network
  // layer, so this drives real interactions without touching the shared database.
  ['functional', functional],
  // The 12px floor the type scale promises. It eroded once already, in four shared
  // components, after the rollout was called complete.
  ['type floor', typeFloor],
  // How screens are ASSEMBLED, which parity.mjs deliberately does not assert. Every
  // check in here was written against a defect that shipped: no page header on ten of
  // twelve routes, a page opening on a floating text button, `Button` rolled out to one
  // file, a route reported done that still had a 20px title, and stat tiles with an
  // empty lower half.
  ['composition', composition],
];

const only = process.argv[2];

console.log(`\nDesign system verification — ${BASE}`);

let failures = 0;
for (const [name, run] of CHECKS) {
  if (only && !name.includes(only)) continue;
  try {
    const report = await run();
    report.print();
    failures += report.failed.length;
  } catch (err) {
    console.error(`\n${name}: threw — ${err.message}`);
    failures += 1;
  }
}

console.log(
  failures === 0
    ? '\nAll design-system checks passed.\n'
    : `\n${failures} check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
