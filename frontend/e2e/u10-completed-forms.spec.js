/**
 * U10 browser check: Analytics → "Completed forms" and the 09:00 bell note.
 *
 *   npm run build; npx playwright test -c playwright.u10.config.js
 *
 * Every /api call is mocked (a fake admin session, the completed-forms
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
      { cv_id: 101, name: 'Asha Verma', completed_at: '2026-11-10T09:00:00.000Z' },
      { cv_id: 102, name: 'Ravi Kumar', completed_at: '2026-11-10T04:00:00.000Z' },
    ],
  },
  { mrf_id: 15, title: 'QA Engineer', count: 1, candidates: [{ cv_id: 103, name: 'Meera Iyer', completed_at: '2026-11-10T05:30:00.000Z' }] },
  {
    mrf_id: null, title: 'No JD yet', count: 2, candidates: [
      { cv_id: 104, name: 'Kiran Rao', completed_at: '2026-11-10T07:00:00.000Z' },
      { cv_id: 105, name: 'Unnamed candidate', completed_at: '2026-11-10T06:00:00.000Z' },
    ],
  },
];

/** What the server would answer for these query params. */
function payloadFor(q) {
  if (q.range === 'today') return { range: { from: '2026-11-11', to: '2026-11-11', days: 1, label: '11 Nov 2026' }, total: 0, jd_count: 0, groups: [] };
  if (q.range === '7') return { range: { from: '2026-11-05', to: '2026-11-11', days: 7, label: '05 Nov 2026 – 11 Nov 2026' }, total: 5, jd_count: 2, groups: DAY_GROUPS };
  if (q.from) return { range: { from: q.from, to: q.to, days: 1, label: '10 Nov 2026' }, total: 5, jd_count: 2, groups: DAY_GROUPS };
  return { range: { from: '2026-11-10', to: '2026-11-10', days: 1, label: '10 Nov 2026' }, total: 5, jd_count: 2, groups: DAY_GROUPS };
}

const NOTE = {
  id: 7001, user_id: USER.id, type: 'candidate.forms_digest', pipeline_id: null, read_at: null,
  title: '5 forms completed yesterday across 2 JDs',
  description: '10 Nov 2026 · Java Developer (2), QA Engineer (1) · 2 with no JD yet',
  link_path: '/analytics?tab=completed-forms&from=2026-11-10&to=2026-11-10',
  meta: { day: '2026-11-10', total: 5, jdCount: 2 }, created_at: '2026-11-11T03:30:00.000Z',
};

/** Signs in a fake admin and mocks the API. Returns the completed-forms query params, in order. */
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
    if (p.endsWith('/api/notifications')) return route.fulfill({ json: { status: 'success', data: { items: [NOTE], unread: 1 } } });
    if (p.includes('/api/notifications/')) return route.fulfill({ json: { status: 'success', data: { updated: 1 } } });
    return route.fulfill({ status: 500, json: { status: 'error', message: 'not mocked in the U10 check' } });
  });
  return calls;
}

const activeTab = (page) => page.locator('.ant-tabs-tab-active');
const jdRows = (page) => page.getByTestId('completed-forms-table').locator('tbody tr.ant-table-row');
const presets = (page) => page.getByTestId('completed-forms-presets');

test('the bell link opens the tab for that day, JDs biggest first and "No JD yet" last', async ({ page }) => {
  const calls = await mockApi(page);
  await page.goto('/analytics?tab=completed-forms&from=2026-11-10&to=2026-11-10');

  await expect(activeTab(page)).toHaveText('Completed Forms');
  await expect(page.getByTestId('completed-forms-summary')).toContainText('5 forms across 2 JDs · 2 with no JD yet');
  expect(calls.at(-1)).toEqual({ from: '2026-11-10', to: '2026-11-10' });

  await expect(jdRows(page)).toHaveCount(3);
  await expect(jdRows(page).nth(0)).toContainText('Java Developer');
  await expect(jdRows(page).nth(0)).toContainText('MRF-12');
  await expect(jdRows(page).nth(0)).toContainText('2');
  await expect(jdRows(page).nth(2)).toContainText('No JD yet');

  // Custom dates: no preset is lit, the picker shows the day.
  await expect(presets(page).locator('.ant-segmented-item-selected')).toHaveCount(0);
  // antd puts the test id on the picker's first input.
  await expect(page.getByTestId('completed-forms-picker').first()).toHaveValue('10 Nov 2026');

  if (SHOT) await page.getByTestId('completed-forms-tab').screenshot({ path: `${SHOT}/u10-tab.png` });
});

test('a JD row expands to its candidates, newest first, each opening the profile', async ({ page }) => {
  await mockApi(page);
  await page.goto('/analytics?tab=completed-forms&from=2026-11-10&to=2026-11-10');

  await jdRows(page).nth(0).click();
  const people = page.getByTestId('completed-forms-candidate');
  await expect(people).toHaveCount(2);
  await expect(people.nth(0)).toContainText('Asha Verma');
  await expect(people.nth(1)).toContainText('Ravi Kumar');
  await expect(people.nth(0)).toContainText('Completed 10 Nov 2026');

  if (SHOT) await page.getByTestId('completed-forms-tab').screenshot({ path: `${SHOT}/u10-expanded.png` });

  await people.nth(0).getByRole('button', { name: 'Profile →' }).click();
  await expect(page).toHaveURL(/\/candidates\/101$/);
});

test('presets: Yesterday by default, then Today and Last 7 days; the URL follows', async ({ page }) => {
  const calls = await mockApi(page);
  await page.goto('/analytics?tab=completed-forms');

  await expect(presets(page).locator('.ant-segmented-item-selected')).toHaveText('Yesterday');
  await expect.poll(() => calls.at(-1)).toEqual({ range: 'yesterday' });

  await presets(page).getByText('Today', { exact: true }).click();
  await expect.poll(() => calls.at(-1)).toEqual({ range: 'today' });
  await expect(page).toHaveURL(/tab=completed-forms/);
  await expect(page).toHaveURL(/range=today/);
  expect(page.url()).not.toContain('from=');
  await expect(page.getByText('No forms completed · 11 Nov 2026')).toBeVisible();

  await presets(page).getByText('Last 7 days', { exact: true }).click();
  await expect.poll(() => calls.at(-1)).toEqual({ range: '7' });
  await expect(page.getByTestId('completed-forms-summary')).toContainText('5 forms across 2 JDs');
});

test('clicking the bell note while on another tab switches to Completed forms for that day', async ({ page }) => {
  const calls = await mockApi(page);
  await page.goto('/analytics');
  await expect(activeTab(page)).toHaveText('Open Positions');

  await page.locator('button:has(.anticon-bell)').click();
  await page.getByText('5 forms completed yesterday across 2 JDs').click();

  await expect(activeTab(page)).toHaveText('Completed Forms');
  await expect(page).toHaveURL(/tab=completed-forms&from=2026-11-10&to=2026-11-10/);
  await expect.poll(() => calls.at(-1)).toEqual({ from: '2026-11-10', to: '2026-11-10' });
  await expect(jdRows(page)).toHaveCount(3);
});
