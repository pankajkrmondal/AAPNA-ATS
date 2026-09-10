/**
 * Turns `eslint -f json` into the one number Stage 5 drives down.
 *
 * The design-contract rules run at `warn`, because erroring on ~2,400 pre-existing
 * violations would only ever result in the config being deleted. A warning nobody
 * counts is a warning nobody fixes, so this makes the debt a tracked figure with a
 * per-file breakdown — which is what turns "we should clean this up" into a burndown.
 */
let raw = '';
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  const files = JSON.parse(raw);
  const byRule = {};
  const byFile = [];
  let errors = 0; let warnings = 0;

  for (const f of files) {
    if (!f.messages.length) continue;
    for (const m of f.messages) {
      if (m.severity === 2) errors += 1; else warnings += 1;
      // Group by the first clause of the message — the rule's identity.
      const key = String(m.message).split(':')[0].split('.')[0].slice(0, 46);
      byRule[key] = (byRule[key] || 0) + 1;
    }
    byFile.push([f.filePath.split(/[\/]/).pop(), f.messages.length]);
  }

  console.log(`\nDesign-contract debt: ${warnings} warnings, ${errors} errors\n`);
  for (const [rule, n] of Object.entries(byRule).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(5)}  ${rule}`);
  }
  console.log('\n  Worst files:');
  for (const [f, n] of byFile.sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${String(n).padStart(5)}  ${f}`);
  }
  console.log('');
  // Errors fail; warnings are the burndown and must not break a build.
  process.exit(errors === 0 ? 0 : 1);
});
