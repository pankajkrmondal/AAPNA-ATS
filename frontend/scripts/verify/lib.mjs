/**
 * Shared harness for the design-system checks.
 *
 * WHY THESE ARE COMMITTED
 * Every claim made about this design system — contrast, the swap contract, that the
 * 24 unconverted routes have not shifted — was produced by throwaway scripts in a
 * temp directory. Nobody else could run them and nothing re-ran them, which means
 * the claims had a shelf life of one session. These files are the difference between
 * "we measured it once" and "it is measured".
 *
 * PLAYWRIGHT IS NOT A PROJECT DEPENDENCY, ON PURPOSE.
 * frontend/.claude/skills/verify/SKILL.md records the convention: install it in a
 * scratch dir and drive the Edge that is already on the machine, rather than adding a
 * heavyweight dep (and a browser download) to every `npm install`. These scripts
 * follow that and fail with the exact command if it is missing.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const BASE = process.env.VERIFY_BASE || 'http://localhost:5173';

/**
 * The dev login, read from env or `.env.development` (commented or not).
 *
 * Lives here because two checks need it — parity and the status-border guard — and a
 * second hand-rolled copy is the same duplication this rollout exists to remove.
 * Returns null when it cannot find both, so a check can SKIP with a clear message
 * rather than showing a red suite to someone without credentials.
 */
export function credentials() {
  if (process.env.VERIFY_EMAIL && process.env.VERIFY_PASSWORD) {
    return { email: process.env.VERIFY_EMAIL, password: process.env.VERIFY_PASSWORD };
  }
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const text = fs.readFileSync(path.resolve(here, '../../.env.development'), 'utf8');
    const pick = (key) => {
      const m = text.match(new RegExp(`^#?\s*${key}\s*=\s*(.+)$`, 'm'));
      return m ? m[1].trim() : null;
    };
    const email = pick('VERIFY_EMAIL');
    const password = pick('VERIFY_PASSWORD');
    return email && password ? { email, password } : null;
  } catch {
    return null;
  }
}

export async function getChromium() {
  try {
    return (await import('playwright')).chromium;
  } catch {
    console.error(
      '\n  playwright is not installed.\n'
      + '  It is deliberately not a project dependency — see scripts/verify/lib.mjs.\n\n'
      + '    npm install --no-save playwright\n\n'
      + '  It drives the Edge already on this machine, so no browser download is needed.\n',
    );
    process.exit(2);
  }
}

/** localStorage keys the app reads before first paint (see index.html). */
export const CONFIG_KEYS = {
  theme: 'ats_theme',
  preset: 'ats_preset',
  font: 'ats_font_pack',
  brand: 'ats_brand',
  density: 'ats_density',
};

/**
 * Opens a page with the design axes pinned. Seeds storage via addInitScript so the
 * anti-FOUC script in index.html sees the values before first paint — setting them
 * after load would measure a frame the user never sees.
 */
export async function openWith(chromium, { path = '/design-lab', width = 1440, height = 1000, reducedMotion, ...axes } = {}) {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({
    viewport: { width, height },
    ...(reducedMotion ? { reducedMotion } : {}),
  });
  const seed = {};
  for (const [k, storageKey] of Object.entries(CONFIG_KEYS)) {
    if (axes[k] !== undefined) seed[storageKey] = axes[k];
  }
  await context.addInitScript((kv) => {
    for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v);
  }, seed);
  const page = await context.newPage();
  // `domcontentloaded`, not `networkidle`: routes behind auth poll an API that may
  // have no backend, and networkidle never settles there.
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  // Long enough for the 900ms sparkline draw-in and the staggered reveal to settle.
  await page.waitForTimeout(2200);
  return { browser, page };
}

/** Collects results so the runner can exit non-zero on any failure. */
export class Report {
  constructor(name) { this.name = name; this.rows = []; }
  add(label, pass, detail = '') { this.rows.push({ label, pass, detail }); }
  get failed() { return this.rows.filter((r) => !r.pass); }
  print() {
    console.log(`\n${this.name}`);
    for (const r of this.rows) {
      console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.label}${r.detail ? `  ${r.detail}` : ''}`);
    }
  }
}
