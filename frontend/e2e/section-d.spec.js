/**
 * Phase 3 "Do Now", section D — the screens changed for N34, N28 and N29.
 * READ-ONLY: it only opens pages and reads the API; nothing is created or
 * edited, so it is safe on shared staging. Data-dependent checks pick real
 * rows from the board and SKIP when none qualify.
 *
 *   npx playwright test e2e/section-d.spec.js
 *
 * N34  dates: one format, IST, whatever the browser's locale (run en-US / New York)
 * N28  drawer: a passed Zeko round keeps its own scores; "Uploaded scores" card
 * N29  Search Candidate: read-only "Pipeline scores" section
 *
 * Screenshots land in test-results/section-d/ (E2E_SHOTS_DIR to change).
 */
import { test, expect } from '@playwright/test';

const SHOTS = process.env.E2E_SHOTS_DIR || 'test-results/section-d';
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });

async function api(page, path) {
  const token = await page.evaluate(() => localStorage.getItem('ats_token'));
  const res = await page.request.get(path, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok()) return null;
  const body = await res.json();
  return body.data ?? body;
}

async function boardCards(page) {
  const board = await api(page, '/api/pipeline');
  return (board?.columns || []).flatMap((c) => c.cards || []);
}

// ── N34 ────────────────────────────────────────────────────────────────
test.describe('N34 one date format', () => {
  test.use({ locale: 'en-US', timezoneId: 'America/New_York' });

  for (const route of ['/dashboard', '/candidates', '/mrf', '/pipeline', '/filtering', '/hr-upload']) {
    test(`no locale-dependent dates on ${route}`, async ({ page }) => {
      await page.goto(route);
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(1500);
      const text = await page.locator('body').innerText();
      expect(text, 'numeric dates like 10/16/2026').not.toMatch(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/);
      expect(text, '"Sept"').not.toMatch(/\bSept\b/);
      expect(text, 'lower-case am/pm times').not.toMatch(/\b\d{1,2}:\d{2}\s?(am|pm)\b/);
      await shot(page, `n34-${route.replace(/\W+/g, '') || 'root'}`);
    });
  }
});

// ── N28 ────────────────────────────────────────────────────────────────
test.describe('N28 scores in the pipeline drawer', () => {
  test('a passed Zeko round keeps its OWN scores', async ({ page }) => {
    await page.goto('/pipeline');
    const cards = (await boardCards(page)).filter((c) => !['zeko_hr', 'shortlisted'].includes(c.current_stage_key));
    let found = null;
    for (const card of cards.slice(0, 60)) {
      const detail = await api(page, `/api/pipeline/${card.id}`);
      const hr = detail?.zekoRounds?.zeko_hr?.scores;
      if (hr && hr.ZekoInterviewScore != null) { found = { card, detail }; break; }
    }
    test.skip(!found, 'no journey past HR screening with a synced HR score');

    const { card, detail } = found;
    await page.goto(`/pipeline?candidate=${card.id}`);
    await page.getByRole('button', { name: 'HR (Zeko)', exact: true }).click();
    const panel = page.locator('.cp-round-panel');
    await expect(panel).toContainText(`Interview ${detail.zekoRounds.zeko_hr.scores.ZekoInterviewScore}`);
    const fn = detail.zekoRounds.zeko_fn?.scores;
    if (fn?.ZekoInterviewScore != null && fn.ZekoInterviewScore !== detail.zekoRounds.zeko_hr.scores.ZekoInterviewScore) {
      await expect(panel, 'the HR card never shows Functional\'s score').not.toContainText(`Interview ${fn.ZekoInterviewScore}`);
    }
    await shot(page, 'n28-hr-round-after-passing');
  });

  test('"Uploaded scores (from Excel)" card when the record has scores', async ({ page }) => {
    await page.goto('/pipeline');
    let found = null;
    for (const card of (await boardCards(page)).slice(0, 60)) {
      const detail = await api(page, `/api/pipeline/${card.id}`);
      if (detail?.uploadedScores?.length) { found = { card, detail }; break; }
    }
    test.skip(!found, 'no journey whose candidate record has uploaded scores');

    await page.goto(`/pipeline?candidate=${found.card.id}`);
    const header = page.getByText('Uploaded scores (from Excel)');
    await expect(header).toBeVisible();
    await header.click();
    const first = found.detail.uploadedScores[0];
    await expect(page.getByText(first.label, { exact: true })).toBeVisible();
    await shot(page, 'n28-uploaded-scores');
  });
});

// ── N29 ────────────────────────────────────────────────────────────────
test.describe('N29 pipeline scores in Search Candidate', () => {
  test('the candidate view lists the journey and its scored rounds', async ({ page }) => {
    await page.goto('/candidates');
    let found = null;
    for (const card of (await boardCards(page)).filter((c) => c.cv_id).slice(0, 60)) {
      const journeys = await api(page, `/api/candidates/${card.cv_id}/pipeline-scores`);
      if (journeys?.some((j) => j.rounds.length)) { found = { card, journeys }; break; }
    }
    test.skip(!found, 'no candidate with pipeline scores (or the API is not reachable)');

    const cv = await api(page, `/api/candidates/${found.card.cv_id}`);
    await page.getByPlaceholder(/name/i).first().fill(cv.name);
    await page.getByRole('button', { name: 'Search' }).click();
    await page.getByRole('button', { name: 'View' }).first().click();
    const modal = page.locator('.ant-modal:visible');
    await expect(modal.getByText('Pipeline scores')).toBeVisible();
    const journey = found.journeys.find((j) => j.rounds.length);
    await expect(modal).toContainText(journey.rounds[0].label);
    await modal.getByText('Pipeline scores').scrollIntoViewIfNeeded();
    await shot(page, 'n29-pipeline-scores');
  });
});
