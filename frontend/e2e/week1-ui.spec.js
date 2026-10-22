/**
 * Phase 3 "Do Now", week 1 — the screens changed in Release 1.
 *
 *   E2E_BASE_URL=http://localhost:5174 npx playwright test e2e/week1-ui.spec.js
 *
 * N44 / N27  Search Candidate: date columns and "Details completed in"
 * N19 / N20  JD picker: one entry per MRF, Latest tag, "Include closed MRFs"
 * N27        screening card "Added on" line
 * N19        Pipeline Position filter: one entry per MRF
 * N24 / N25  approve dialog: landing stage choice, approve without score
 * N23        schedule dialog: Interviewee and Interviewer sections
 *
 * The data-dependent checks look for their own rows and SKIP when absent, so
 * the file is safe on any database. Locally they are created by
 * scratchpad/scripts/seed-week1.mjs ("W1 …" candidates, ".NET Developer" MRFs,
 * a closed "QA Automation Engineer" MRF).
 *
 * Screenshots land in test-results/week1/ for review.
 */
import { test, expect } from '@playwright/test';
import { openScreening, runLookup } from './helpers/screening.js';

// Playwright empties test-results/ on every run; point E2E_SHOTS_DIR elsewhere to keep them.
const SHOTS = process.env.E2E_SHOTS_DIR || 'test-results/week1';
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });

/** Reads one page of the board and returns the journey matching `name`, if any. */
async function findJourney(page, name) {
  const res = await page.request.get(`${process.env.E2E_API_URL || 'http://localhost:5055'}/api/pipeline`, {
    headers: { Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('ats_token'))}` },
  });
  if (!res.ok()) return null;
  const body = await res.json();
  return (body.data?.columns || []).flatMap((c) => c.cards || []).find((c) => c.candidate_name === name) || null;
}

test.describe('N44 / N27 Search Candidate', () => {
  test('date columns, and "Details completed in" filters and orders by completion', async ({ page }) => {
    await page.goto('/candidates');
    for (const col of ['DATE ADDED', 'DETAILS REQUESTED', 'DETAILS COMPLETED']) {
      await expect(page.getByRole('columnheader', { name: col })).toBeVisible();
    }
    const form = page.locator('.ant-form-item').filter({ hasText: 'Details completed in' });
    await form.locator('.ant-select').click();
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: 'Last 7 days' }).click();

    const responsePromise = page.waitForResponse((r) => /\/api\/candidates\?/.test(r.url()) && r.url().includes('completedWithin=7'));
    await page.getByRole('button', { name: 'Search' }).click();
    const response = await responsePromise;
    expect(response.url()).toContain('sort=detailsCompletedAt');
    const rows = (await response.json()).data || [];
    // Newest completion first, and every row really has a completion date.
    const dates = rows.map((r) => new Date(r.detailsCompletedAt).getTime());
    expect(dates.every(Number.isFinite)).toBeTruthy();
    expect([...dates].sort((a, b) => b - a)).toEqual(dates);

    await expect(page.getByText(/completed their details in the last 7 days\. Newest first\./)).toBeVisible();
    await shot(page, 'search-candidate-completed-in');
  });
});

test.describe('N19 / N20 JD picker', () => {
  test('one entry per MRF with ref, date and Latest; closed MRFs only when ticked', async ({ page }) => {
    await openScreening(page, 'jd');
    const picker = page.locator('.ant-select').first();
    await picker.click();
    const options = page.locator('.ant-select-dropdown:visible .ant-select-item-option');
    await expect(options.first()).toBeVisible();
    const labels = await options.allInnerTexts();
    for (const l of labels) expect(l).toMatch(/· MRF-\d+ · \d{2} [A-Z][a-z]{2} \d{4}/);
    const net = labels.filter((l) => l.startsWith('.NET Developer'));
    test.skip(net.length < 2, 'needs two ".NET Developer" MRFs (seed-week1.mjs)');
    expect(net.filter((l) => l.includes('Latest'))).toHaveLength(1);
    await shot(page, 'jd-picker-open');
    await page.keyboard.press('Escape');

    await page.getByRole('checkbox', { name: 'Include closed MRFs' }).check();
    await picker.click();
    // The list is virtualised: closed MRFs sit at the bottom, so search for it.
    await picker.locator('input').fill('QA Automation');
    const closed = page.locator('.ant-select-dropdown:visible .ant-select-item-option')
      .filter({ hasText: 'QA Automation Engineer' })
      .filter({ hasText: 'Closed' });
    test.skip(!(await closed.count()), 'needs a closed "QA Automation Engineer" MRF');
    await expect(closed.first()).not.toContainText('Latest');
    await closed.first().click();
    await expect(page.getByText(/This MRF was closed on .* Results are read-only: Shortlist and Reject are turned off\./)).toBeVisible();
    await shot(page, 'jd-picker-closed-selected');
  });
});

test.describe('N27 screening card', () => {
  test('cards show "Added on"', async ({ page }) => {
    await openScreening(page, 'keyword');
    const result = await runLookup(page, 'W1 Hari HR-Round');
    test.skip(!(result?.candidates || []).length, 'needs the seeded W1 candidate');
    await expect(page.getByText(/Added on \d{2} [A-Z][a-z]{2} \d{4}/).first()).toBeVisible();
    await shot(page, 'screening-card-added-on');
  });
});

test.describe('N19 Pipeline Position filter', () => {
  test('lists one entry per MRF', async ({ page }) => {
    await page.goto('/pipeline');
    await expect(page.locator('.cp-candidate-card').first()).toBeVisible({ timeout: 60_000 });
    const position = page.locator('.ant-select').filter({ hasText: 'Position' }).first();
    await position.click();
    const options = page.locator('.ant-select-dropdown:visible .ant-select-item-option');
    await expect(options.first()).toBeVisible();
    const labels = await options.allInnerTexts();
    expect(labels.some((l) => /· MRF-\d+/.test(l))).toBeTruthy();
    await shot(page, 'pipeline-position-filter');
  });
});

test.describe('N24 / N25 approve dialog', () => {
  test('HR Round lands on Documents past CEO and Client, and needs a note without a score', async ({ page }) => {
    await page.goto('/pipeline');
    const journey = await findJourney(page, 'W1 Hari HR-Round');
    test.skip(!journey || journey.current_stage_key !== 'hr_round', 'needs the seeded HR Round journey');
    await page.goto(`/pipeline?candidate=${journey.id}`);
    const drawer = page.locator('.ant-drawer-content-wrapper:visible');
    await expect(drawer).toBeVisible({ timeout: 60_000 });
    await drawer.getByRole('button', { name: 'Approve' }).first().click();

    const dialog = page.locator('.ant-modal:visible').filter({ hasText: 'Record round outcome' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('After approval, move the candidate to')).toBeVisible();
    await expect(dialog.getByRole('radio', { name: /^Documents \(skip .+ and .+\)$/ })).toBeChecked();
    await expect(dialog.getByText(/Pre-selected because the MRF says: CEO round "No", Client round "No"/)).toBeVisible();
    await expect(dialog.getByText('Approve without score')).toBeVisible();
    await shot(page, 'approve-dialog');

    // Without a note: refused in the dialog.
    await dialog.getByRole('button', { name: /Save & send email/ }).click();
    await expect(page.getByText(/needs a note of at least 10 characters/)).toBeVisible();

    // With a note: lands on Documents.
    await dialog.locator('textarea').first().fill('Panel gave a verbal go-ahead; scorecard to follow.');
    const outcome = page.waitForResponse((r) => /\/api\/pipeline\/\d+\/outcome$/.test(r.url()));
    await dialog.getByRole('button', { name: /Save & send email/ }).click();
    const res = await outcome;
    expect(res.status(), await res.text()).toBe(200);
    expect(JSON.parse(res.request().postData()).skip_to_stage_key).toBe('documents');
    expect((await res.json()).data.pipeline.current_stage_key).toBe('documents');
  });
});

test.describe('N23 schedule dialog', () => {
  test('Interviewee and Interviewer sections, CEO round pre-filled from panel details (never "Yes")', async ({ page }) => {
    await page.goto('/pipeline');
    const journey = await findJourney(page, 'W1 Chitra CEO-Round');
    test.skip(!journey || journey.current_stage_key !== 'ceo', 'needs the seeded CEO round journey');
    await page.goto(`/pipeline?candidate=${journey.id}`);
    const drawer = page.locator('.ant-drawer-content-wrapper:visible');
    await expect(drawer).toBeVisible({ timeout: 60_000 });
    await drawer.getByRole('button', { name: 'Schedule Interview' }).click();

    const dialog = page.locator('.ant-modal:visible').filter({ hasText: 'Schedule interview' });
    await expect(dialog).toBeVisible();
    const interviewee = dialog.locator('fieldset').filter({ hasText: 'Interviewee' });
    await expect(interviewee.locator('input').nth(0)).toHaveValue('W1 Chitra CEO-Round');
    await expect(interviewee.locator('input').nth(1)).toHaveValue('w1.chitra@example.invalid');
    await expect(interviewee.locator('input').nth(2)).toHaveValue('+91 90000 22222');
    const interviewer = dialog.locator('fieldset').filter({ hasText: 'Interviewer' }).last();
    await expect(interviewer.locator('input').first()).toHaveValue('Abhijit Roy');
    await expect(dialog.getByText('Pre-filled from the MRF panel details.')).toBeVisible();
    await shot(page, 'schedule-dialog');
  });
});
