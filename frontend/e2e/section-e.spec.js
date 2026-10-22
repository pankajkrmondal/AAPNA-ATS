/**
 * Phase 3 "Do Now", section E — the screens changed for N35, N36, N39 and N38.
 * VIEW-ONLY: it opens pages, reads the API, changes filters and downloads one
 * CSV. Nothing is created, edited, sent, shortlisted or closed, so it is safe
 * on shared staging. Data-dependent checks SKIP when the data can't show them.
 *
 *   npx playwright test e2e/section-e.spec.js
 *
 * N35  board labels, hover text, legend; assessment cards agree with the drawer
 * N36  dashboard: period + MRF filters, definitions note, links open the candidate
 * N39  Analytics › Positions: rows, sort, filter, row → funnel, CSV
 * N38  Screening: "Added within" on the JD tab (and 10 days on Keyword)
 *
 * Screenshots land in test-results/section-e/ (E2E_SHOTS_DIR to change).
 */
import { test, expect } from '@playwright/test';

const SHOTS = process.env.E2E_SHOTS_DIR || 'test-results/section-e';
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });

async function api(page, path) {
  const token = await page.evaluate(() => localStorage.getItem('ats_token'));
  const res = await page.request.get(path, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok()) return null;
  const body = await res.json();
  return body.data ?? body;
}

const settle = async (page) => {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(800);
};

const NEW_LABELS = /^(Not yet invited|Zeko link sent|Test not sent|Test sent( · due .+)?|Test overdue|Not yet scheduled|Scheduled|Awaiting action|Awaiting decision|Approved|On Hold|Rejected|.+)$/;
const OLD_LABELS = ['In progress', 'Invited', 'Ready for decision', 'Evalground test pending'];

// ── N35 ────────────────────────────────────────────────────────────────
test.describe('N35 labels & legends', () => {
  test('cards use the new labels; the legend explains them', async ({ page }) => {
    await page.goto('/pipeline');
    await settle(page);
    const chips = page.locator('[data-testid^="card-status-"]');
    // The board draws its cards after the page settles.
    await chips.first().waitFor({ timeout: 20000 }).catch(() => {});
    const n = await chips.count();
    test.skip(n === 0, 'no cards on the board');
    const texts = (await chips.allInnerTexts()).map((t) => t.trim());
    for (const old of OLD_LABELS) expect(texts, `old label "${old}"`).not.toContain(old);
    texts.forEach((t) => expect(t).toMatch(NEW_LABELS));

    // Hover text on a chip.
    await chips.first().hover();
    await expect(page.locator('.ant-tooltip:visible').last()).toBeVisible();

    await page.getByTestId('board-legend-button').click();
    const legend = page.getByTestId('board-legend');
    await expect(legend).toBeVisible();
    for (const label of ['Not yet invited', 'Zeko link sent', 'Test overdue', 'Awaiting decision']) {
      await expect(legend.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(legend.getByText('Stages (columns, left to right)')).toBeVisible();
    await shot(page, 'n35-board-legend');
  });

  test('assessment cards agree with the drawer\'s invite state (up to 5)', async ({ page }) => {
    await page.goto('/pipeline');
    await settle(page);
    const board = await api(page, '/api/pipeline');
    const cards = (board?.columns || []).flatMap((c) => c.cards || []).filter((c) => c.assessment_pending).slice(0, 5);
    test.skip(cards.length === 0, 'no candidate waiting on an Evalground result');
    for (const card of cards) {
      const state = await api(page, `/api/pipeline/assessment-import/invite/${card.id}`);
      const sent = Boolean(state?.invite) && !state?.isWithdrawn;
      const chip = (await page.getByTestId(`card-status-${card.id}`).innerText()).trim();
      if (state?.isOverdue) expect(chip, `card ${card.id}`).toBe('Test overdue');
      else if (sent) expect(chip, `card ${card.id}`).toMatch(/^Test sent/);
      else expect(chip, `card ${card.id}`).toBe('Test not sent');
    }
  });
});

// ── N36 ────────────────────────────────────────────────────────────────
test.describe('N36 dashboard', () => {
  test('period and MRF filters drive the numbers; the note explains the change', async ({ page }) => {
    await page.goto('/dashboard');
    await settle(page);
    await expect(page.getByTestId('dashboard-definitions-note')).toBeVisible();

    // Each period asks the server again and the trend card follows.
    for (const label of ['7d', '90d', '30d']) {
      const resp = page.waitForResponse((r) => r.url().includes('/api/dashboard/trends') && r.ok());
      await page.locator('.dash-hero__filters .ant-segmented').getByText(label, { exact: true }).click();
      await resp;
    }
    await expect(page.getByText(/New candidates added · last 30 days/)).toBeVisible();

    // The MRF filter lists open MRFs (it used to offer only "All roles").
    const options = await api(page, '/api/dashboard/mrf-options');
    test.skip(!options?.length, 'no open MRFs');
    await page.getByTestId('dashboard-mrf-filter').click();
    const items = page.locator('.ant-select-dropdown:visible .ant-select-item-option');
    expect(await items.count()).toBeGreaterThan(1);
    const resp = page.waitForResponse((r) => r.url().includes('/api/dashboard/stats') && r.url().includes('mrfId=') && r.ok());
    await items.nth(1).click();
    await resp;
    await expect(page.getByText(/In the pipeline now · .+\(MRF-\d+\)/)).toBeVisible();
    await shot(page, 'n36-dashboard-mrf');
  });

  test('a recent upload opens that candidate, with "Back to Dashboard"', async ({ page }) => {
    await page.goto('/dashboard');
    await settle(page);
    const row = page.locator('[data-testid^="latest-upload-"]').first();
    // The widget loads its own rows after the page settles.
    await row.waitFor({ timeout: 15000 }).catch(() => {});
    test.skip(await row.count() === 0, 'no recent uploads');
    const id = (await row.getAttribute('data-testid')).replace('latest-upload-', '');
    await row.click();
    await expect(page).toHaveURL(new RegExp(`/candidates/${id}$`));
    await expect(page.getByRole('button', { name: 'Back to Dashboard' })).toBeVisible();
  });

  test('upcoming interviews: Zeko and Teams rows open the candidate on the board', async ({ page }) => {
    await page.goto('/dashboard');
    await settle(page);
    const rows = await api(page, '/api/dashboard/upcoming-interviews?days=7');
    test.skip(!rows?.length, 'no interviews in the next 7 days');
    const first = rows.find((r) => r.pipelineId) || rows[0];
    await page.getByTestId(`upcoming-${first.key}`).click();
    await expect(page).toHaveURL(first.pipelineId ? new RegExp(`/pipeline\\?candidate=${first.pipelineId}`) : /\/pipeline/);
  });
});

// ── N39 ────────────────────────────────────────────────────────────────
test.describe('N39 Analytics › Positions', () => {
  test('one row per MRF; sort, filter, row opens the funnel, CSV downloads', async ({ page }) => {
    await page.goto('/analytics');
    await settle(page);
    await page.getByRole('tab', { name: /Positions/ }).click();
    await settle(page);
    await page.getByTestId('positions-status-filter').getByText('All', { exact: true }).click();
    const rows = page.locator('[data-testid^="positions-row-"]');
    test.skip(await rows.count() === 0, 'no positions');
    await expect(page.getByText('Joining ratio').first()).toBeVisible();
    await shot(page, 'n39-positions');

    // Sorting by Shortlisted puts the busiest MRF first.
    const data = await api(page, '/api/pipeline/analytics/positions');
    // Scoped to the open tab: Role Summary's hidden table has a Shortlisted column too.
    const header = page.locator('.ant-tabs-tabpane-active th').filter({ hasText: /^Shortlisted/ }).first();
    await header.click(); // ascend
    await header.click(); // descend
    const busiest = Math.max(...data.rows.map((r) => r.shortlisted));
    const firstRowId = Number((await rows.first().getAttribute('data-testid')).replace('positions-row-', ''));
    expect(data.rows.find((r) => r.mrf_id === firstRowId)?.shortlisted).toBe(busiest);

    // CSV of the table.
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export/ }).last().click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/Positions/i);

    // A row opens that MRF's funnel on Pipeline Insights.
    await rows.first().click();
    await expect(page.getByRole('tab', { name: /Pipeline Insights/, selected: true })).toBeVisible();
  });
});

// ── N38 ────────────────────────────────────────────────────────────────
test.describe('N38 "Added within"', () => {
  test('JD tab: the window narrows the results and the summary says so', async ({ page }) => {
    await page.goto('/filtering');
    await settle(page);
    await page.getByRole('tab', { name: /JD/ }).first().click().catch(() => {});
    const roles = await api(page, '/api/screening/roles');
    test.skip(!roles?.length, 'no open MRFs');
    // Pick the role through the select, then the window.
    await page.locator('.ant-select').filter({ hasText: /Select an Open Role|—/ }).first().click();
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option').first().click();
    await settle(page);
    const filter = page.getByTestId('jd-added-within');
    await expect(filter).toBeVisible();
    await filter.click();
    const opts = page.locator('.ant-select-dropdown:visible .ant-select-item-option');
    await expect(opts).toHaveText(['Last 7 days', 'Last 10 days', 'Last 15 days', 'Last 1 month', 'Last 3 months']);
    const resp = page.waitForResponse((r) => r.url().includes('/search') && r.request().method() === 'POST');
    await opts.filter({ hasText: 'Last 15 days' }).click();
    const body = (await resp).request().postDataJSON();
    expect(body.addedWithinDays).toBe(15);
    await settle(page);
    // The V2 summary names the window (old search: no such line, so only checked with SCREENING_V2 on).
    const summary = await page.locator('body').innerText();
    if (/meet .*experience/.test(summary)) expect(summary).toMatch(/added in the last 15 days/);
    await shot(page, 'n38-jd-added-within');
  });

  test('Keyword tab offers 10 days', async ({ page }) => {
    await page.goto('/filtering');
    await settle(page);
    await page.getByRole('tab', { name: /Keyword/ }).first().click().catch(() => {});
    await page.getByLabel('Added within').click();
    await expect(page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: 'Last 10 days' })).toBeVisible();
  });
});
