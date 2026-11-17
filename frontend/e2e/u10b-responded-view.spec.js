/**
 * U10b browser check: Analytics → Open Positions › Responded (which replaced
 * U10's Completed Forms tab) and the 09:00 bell note.
 *
 *   npm run build; npx playwright test -c playwright.u10.config.js
 *
 * Every /api call is mocked (a fake admin session, the board, the responded
 * payload, one bell note); anything else answers 500, which the other tabs
 * already handle. Nothing reaches a backend.
 */
import { test, expect } from '@playwright/test';

const SHOT = process.env.U10_SHOT_DIR;

const USER = {
  id: 9001, username: 'u10.admin', email: 'u10.admin@example.invalid', role: 'admin',
  first_name: 'U10', last_name: 'Admin', is_active: true, is_approved: true, company_id: null,
  permissions: ['new_mrf', 'search_candidates', 'hr_manual_upload', 'system_config', 'candidate_screening', 'screening_analytics', 'hr_admin', 'recruitment_pipeline'],
};

const DAY_GROUPS = [
  {
    mrf_id: 12, title: 'Java Developer', count: 2, candidates: [
      { cv_id: 101, name: 'Asha Verma', responded_at: '2026-11-10T09:00:00.000Z', how: 'form' },
      { cv_id: 102, name: 'Ravi Kumar', responded_at: '2026-11-10T04:00:00.000Z', how: 'complete_cv' },
    ],
  },
  { mrf_id: 15, title: 'QA Engineer', count: 1, candidates: [{ cv_id: 103, name: 'Meera Iyer', responded_at: '2026-11-10T05:30:00.000Z', how: 'form' }] },
  {
    mrf_id: null, title: 'No JD yet', count: 2, candidates: [
      { cv_id: 104, name: 'Kiran Rao', responded_at: '2026-11-10T07:00:00.000Z', how: 'form' },
      { cv_id: 105, name: 'Unnamed candidate', responded_at: '2026-11-10T06:00:00.000Z', how: 'complete_cv' },
    ],
  },
];

/** What the server would answer for these query params. */
function payloadFor(q) {
  if (q.mrf) return onePosition(q);
  const status = q.status || 'open';
  if (q.range === 'today') return { range: { from: '2026-11-11', to: '2026-11-11', days: 1, label: '11 Nov 2026' }, status, total: 0, jd_count: 0, groups: [] };
  if (q.range === '7') return { range: { from: '2026-11-05', to: '2026-11-11', days: 7, label: '05 Nov 2026 – 11 Nov 2026' }, status, total: 5, jd_count: 2, groups: DAY_GROUPS };
  if (q.from) return { range: { from: q.from, to: q.to, days: 1, label: '10 Nov 2026' }, status, total: 5, jd_count: 2, groups: DAY_GROUPS };
  return { range: { from: '2026-11-10', to: '2026-11-10', days: 1, label: '10 Nov 2026' }, status, total: 5, jd_count: 2, groups: DAY_GROUPS };
}

/** U10c: ?mrf= narrows the answer to that position, without "No JD yet". */
function onePosition(q) {
  const label = q.range === 'today' ? '11 Nov 2026' : q.range === '7' ? '05 Nov 2026 – 11 Nov 2026' : '10 Nov 2026';
  const groups = q.range === 'today' ? [] : DAY_GROUPS.filter((g) => String(g.mrf_id) === String(q.mrf));
  const total = groups.reduce((n, g) => n + g.count, 0);
  return { range: { label }, status: 'all', mrf_id: Number(q.mrf), total, jd_count: groups.length, groups };
}

/** The role view for MRF-12 (only the fields RoleDetailDrawer reads). */
const ROLE = {
  range: { from: '2026-11-05', to: '2026-11-11', days: 7, label: '05 Nov 2026 – 11 Nov 2026' },
  previous: null,
  period_word: 'last week',
  position: {
    mrf_id: 12, ref: 'MRF-12', role: 'Java Developer', status: 'Open', opened_at: '2026-10-01T00:00:00.000Z',
    days_open: 41, openings: 2, filled: 0, health: { status: 'ok', label: 'On track', reasons: [] },
  },
  summary_text: '2 new applicants, 2 responded and 0 shortlisted.',
  kpis: ['applied', 'responded', 'shortlisted', 'rejected', 'moved_forward', 'interviews', 'offers'].map((key) => ({ key, value: key === 'applied' || key === 'responded' ? 2 : 0, previous: null })),
  attention: { stuck: [], feedback: [], offers: [], responded_not_reviewed: 0, interviews_today: [] },
  series: [],
  source_labels: {},
  funnel: [{ key: 'applied', label: 'Applied', count: 2 }, { key: 'responded', label: 'Responded', count: 2 }],
  activity: { items: [], total: 0 },
  upcoming: [],
  milestones: [],
};

/** A board with no rows but a summary, so the Responded tile renders. */
const BOARD = {
  range: null, previous: null, target_days: 45, stuck_days: 7, stages: [], source_labels: {}, rows: [],
  summary: {
    open_positions: 2, openings: 3, filled: 0, paused: 0, at_risk: 0, watch: 0, applied: 20, applied_previous: null,
    responded: 6, shortlisted: 2, in_pipeline: 4, stuck: 0, awaiting_feedback: 0, shortlist_pct: 10, response_pct: 30,
  },
};

const NOTE = {
  id: 7001, user_id: USER.id, type: 'candidate.forms_digest', pipeline_id: null, read_at: null,
  title: '5 candidates responded yesterday across 2 JDs',
  description: '10 Nov 2026 · Java Developer (2), QA Engineer (1) · 2 with no JD yet',
  link_path: '/analytics?tab=open&view=responded&from=2026-11-10&to=2026-11-10',
  meta: { day: '2026-11-10', total: 5, jdCount: 2 }, created_at: '2026-11-11T03:30:00.000Z',
};

/** Signs in a fake admin and mocks the API. Returns the responded query params, in order. */
async function mockApi(page) {
  const calls = [];
  await page.addInitScript((user) => {
    localStorage.setItem('ats_token', 'u10-mock-token');
    localStorage.setItem('ats_user', JSON.stringify(user));
  }, USER);
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    if (p.endsWith('/api/auth/me')) return route.fulfill({ json: { status: 'success', data: { user: USER } } });
    if (p.endsWith('/api/pipeline/analytics/completed-forms')) {
      const q = Object.fromEntries(url.searchParams);
      calls.push(q);
      return route.fulfill({ json: { status: 'success', data: payloadFor(q) } });
    }
    if (p.endsWith('/api/pipeline/analytics/positions')) return route.fulfill({ json: { status: 'success', data: BOARD } });
    if (/\/api\/pipeline\/analytics\/positions\/12$/.test(p)) return route.fulfill({ json: { status: 'success', data: ROLE } });
    if (p.endsWith('/api/notifications')) return route.fulfill({ json: { status: 'success', data: { items: [NOTE], unread: 1 } } });
    if (p.includes('/api/notifications/')) return route.fulfill({ json: { status: 'success', data: { updated: 1 } } });
    return route.fulfill({ status: 500, json: { status: 'error', message: 'not mocked in the U10b check' } });
  });
  return calls;
}

const activeTab = (page) => page.locator('.ant-tabs-tab-active');
const viewSwitch = (page) => page.getByTestId('positions-view-switch');
const jdRows = (page) => page.getByTestId('responded-table').locator('tbody tr.ant-table-row');
const presets = (page) => page.getByTestId('responded-presets');
const LINK = '/analytics?tab=open&view=responded&from=2026-11-10&to=2026-11-10';

test('the bell link opens Open Positions › Responded for that day, JDs biggest first and "No JD yet" last', async ({ page }) => {
  const calls = await mockApi(page);
  await page.goto(LINK);

  await expect(activeTab(page)).toHaveText('Open Positions');
  await expect(viewSwitch(page).locator('.ant-segmented-item-selected')).toHaveText('Responded');
  await expect(page.getByTestId('responded-summary')).toContainText('5 candidates responded across 2 JDs · 2 with no JD yet');
  expect(calls.at(-1)).toEqual({ from: '2026-11-10', to: '2026-11-10', status: 'open' });

  await expect(jdRows(page)).toHaveCount(3);
  await expect(jdRows(page).nth(0)).toContainText('Java Developer');
  await expect(jdRows(page).nth(0)).toContainText('MRF-12');
  await expect(jdRows(page).nth(0)).toContainText('2');
  await expect(jdRows(page).nth(2)).toContainText('No JD yet');

  // Custom dates: no preset is lit, the picker shows the day.
  await expect(presets(page).locator('.ant-segmented-item-selected')).toHaveCount(0);
  // antd puts the test id on the picker's first input.
  await expect(page.getByTestId('responded-picker').first()).toHaveValue('10 Nov 2026');
  // The board's tiles and table are not shown in this view.
  await expect(page.getByTestId('open-positions-summary')).toHaveCount(0);

  if (SHOT) await page.getByTestId('responded-view').screenshot({ path: `${SHOT}/u10b-view.png` });
});

test('the Completed Forms tab is gone, and an old ?tab=completed-forms link lands on the view, dates kept', async ({ page }) => {
  const calls = await mockApi(page);
  await page.goto('/analytics?tab=completed-forms&from=2026-11-10&to=2026-11-10');

  await expect(activeTab(page)).toHaveText('Open Positions');
  await expect(page).toHaveURL(/tab=open/);
  await expect(page).toHaveURL(/view=responded/);
  await expect(page).toHaveURL(/from=2026-11-10&to=2026-11-10/);
  await expect(page.locator('.ant-tabs-tab', { hasText: 'Completed Forms' })).toHaveCount(0);
  await expect.poll(() => calls.at(-1)).toEqual({ from: '2026-11-10', to: '2026-11-10', status: 'open' });
  await expect(jdRows(page)).toHaveCount(3);
});

test('a JD row expands to its candidates, newest first, each opening the profile', async ({ page }) => {
  await mockApi(page);
  await page.goto(LINK);

  await jdRows(page).nth(0).click();
  const people = page.getByTestId('responded-candidate');
  await expect(people).toHaveCount(2);
  await expect(people.nth(0)).toContainText('Asha Verma');
  await expect(people.nth(1)).toContainText('Ravi Kumar');
  await expect(people.nth(0)).toContainText('Responded 10 Nov 2026');
  await expect(people.nth(0)).toContainText('details form');
  await expect(people.nth(1)).toContainText('complete CV, never asked');

  if (SHOT) await page.getByTestId('responded-view').screenshot({ path: `${SHOT}/u10b-expanded.png` });

  await people.nth(0).getByRole('button', { name: 'Profile →' }).click();
  await expect(page).toHaveURL(/\/candidates\/101$/);
});

test('presets: Yesterday by default, then Today and Last 7 days; the URL follows', async ({ page }) => {
  const calls = await mockApi(page);
  await page.goto('/analytics?tab=open&view=responded');

  await expect(presets(page).locator('.ant-segmented-item-selected')).toHaveText('Yesterday');
  await expect.poll(() => calls.at(-1)).toEqual({ range: 'yesterday', status: 'open' });

  await presets(page).getByText('Today', { exact: true }).click();
  await expect.poll(() => calls.at(-1)).toEqual({ range: 'today', status: 'open' });
  await expect(page).toHaveURL(/view=responded/);
  await expect(page).toHaveURL(/range=today/);
  expect(page.url()).not.toContain('from=');
  await expect(page.getByText('Nobody responded · 11 Nov 2026')).toBeVisible();

  await presets(page).getByText('Last 7 days', { exact: true }).click();
  await expect.poll(() => calls.at(-1)).toEqual({ range: '7', status: 'open' });
  await expect(page.getByTestId('responded-summary')).toContainText('5 candidates responded across 2 JDs');
});

test('the view follows the board switch; Board goes back and clears the view from the URL', async ({ page }) => {
  const calls = await mockApi(page);
  await page.goto(LINK);
  await expect(jdRows(page)).toHaveCount(3);

  await page.getByTestId('positions-status-filter').getByText('Closed', { exact: true }).click();
  await expect.poll(() => calls.at(-1)).toEqual({ from: '2026-11-10', to: '2026-11-10', status: 'closed' });
  await page.getByTestId('positions-status-filter').getByText('All', { exact: true }).click();
  await expect.poll(() => calls.at(-1)).toEqual({ from: '2026-11-10', to: '2026-11-10', status: 'all' });

  await viewSwitch(page).getByText('Board', { exact: true }).click();
  await expect(page.getByTestId('open-positions-summary')).toBeVisible();
  await expect(page.getByTestId('responded-view')).toHaveCount(0);
  expect(page.url()).not.toContain('view=');
  expect(page.url()).not.toContain('from=');
});

test('the Responded tile opens the view for the page\'s dates', async ({ page }) => {
  const calls = await mockApi(page);
  await page.goto('/analytics');
  await expect(page.getByTestId('responded-tile')).toBeVisible();

  await page.getByTestId('responded-tile').click();
  await expect(viewSwitch(page).locator('.ant-segmented-item-selected')).toHaveText('Responded');
  await expect(page).toHaveURL(/view=responded/);
  // The page's default range: the last 7 days, today included.
  await expect.poll(() => calls.at(-1)?.status).toBe('open');
  const q = calls.at(-1);
  expect(q.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(q.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect((new Date(q.to) - new Date(q.from)) / 86_400_000).toBe(6);
});

test('U10c: one position\'s role view has its own Responded section, Yesterday by default, with the same presets', async ({ page }) => {
  const calls = await mockApi(page);
  await page.goto('/analytics?tab=open&mrf=12');

  const section = page.getByTestId('role-responded');
  await expect(section).toBeVisible();
  await expect(section.getByTestId('responded-presets').locator('.ant-segmented-item-selected')).toHaveText('Yesterday');
  await expect.poll(() => calls.at(-1)).toEqual({ range: 'yesterday', mrf: '12' });
  await expect(section.getByTestId('responded-summary')).toContainText('2 candidates responded to this position · 10 Nov 2026');
  const people = section.getByTestId('responded-candidate');
  await expect(people).toHaveCount(2);
  await expect(people.nth(0)).toContainText('Asha Verma');
  // Only this position: no other JD and no "No JD yet".
  await expect(section).not.toContainText('Meera Iyer');
  await expect(section).not.toContainText('Kiran Rao');

  if (SHOT) await section.screenshot({ path: `${SHOT}/u10c-role-responded.png` });

  await section.getByTestId('responded-presets').getByText('Today', { exact: true }).click();
  await expect.poll(() => calls.at(-1)).toEqual({ range: 'today', mrf: '12' });
  await expect(section.getByText('Nobody responded to this position · 11 Nov 2026')).toBeVisible();
  await section.getByTestId('responded-presets').getByText('Last 7 days', { exact: true }).click();
  await expect.poll(() => calls.at(-1)).toEqual({ range: '7', mrf: '12' });

  await people.nth(0).getByRole('button', { name: 'Profile →' }).click();
  await expect(page).toHaveURL(/\/candidates\/101$/);
});

test('U10c: "Role view →" on a JD opens that position, its Responded section on the same dates', async ({ page }) => {
  const calls = await mockApi(page);
  await page.goto(LINK);
  await expect(jdRows(page)).toHaveCount(3);

  await page.getByTestId('responded-open-role-12').click();
  await expect(page).toHaveURL(/mrf=12/);
  const section = page.getByTestId('role-responded');
  await expect(section).toBeVisible();
  await expect.poll(() => calls.at(-1)).toEqual({ from: '2026-11-10', to: '2026-11-10', mrf: '12' });
  await expect(section.getByTestId('responded-candidate')).toHaveCount(2);
  // The JD row did not expand underneath (the link stops the row click).
  await expect(page.getByTestId('responded-table').getByTestId('responded-candidate')).toHaveCount(0);
});

test('clicking the bell note while on the board switches to Responded for that day', async ({ page }) => {
  const calls = await mockApi(page);
  await page.goto('/analytics');
  await expect(activeTab(page)).toHaveText('Open Positions');
  await expect(viewSwitch(page).locator('.ant-segmented-item-selected')).toHaveText('Board');

  await page.locator('button:has(.anticon-bell)').click();
  await page.getByText('5 candidates responded yesterday across 2 JDs').click();

  await expect(activeTab(page)).toHaveText('Open Positions');
  await expect(viewSwitch(page).locator('.ant-segmented-item-selected')).toHaveText('Responded');
  await expect(page).toHaveURL(/tab=open&view=responded&from=2026-11-10&to=2026-11-10/);
  await expect.poll(() => calls.at(-1)).toEqual({ from: '2026-11-10', to: '2026-11-10', status: 'open' });
  await expect(jdRows(page)).toHaveCount(3);
});
