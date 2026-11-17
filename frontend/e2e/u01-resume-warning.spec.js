/**
 * U01 — the Schedule window warns when there is no resume, and nothing is sent
 * without HR saying so.
 *
 *   $env:E2E_SESSION_EMAIL = '<your staff email>'; npx playwright test -c playwright.u01.config.js
 *
 * Runs against the real local stack and the staging DB, on a real candidate
 * whose stored "resume" is an Excel workbook (an Excel-upload row from before
 * the fix). Override with E2E_U01_PIPELINE_ID / E2E_U01_CANDIDATE_NAME.
 *
 * NOTHING IS WRITTEN. Every non-GET API call is intercepted before the page
 * loads: booking, re-booking, send-pack and resume upload are answered by the
 * test (and their payloads checked); anything else is aborted. So no booking,
 * no Teams event, no email and no OneDrive upload can happen, even if the
 * confirm under test were missing.
 */
import { test, expect } from '@playwright/test';
import dayjs from 'dayjs';

const PIPELINE_ID = process.env.E2E_U01_PIPELINE_ID || '2904';
const CANDIDATE = process.env.E2E_U01_CANDIDATE_NAME || 'Abhay Ranjan Singh';
const PANEL = 'u01-panel@example.invalid';

/** Intercepts every API write; returns what reached each stubbed endpoint. */
async function guardWrites(page) {
  const seen = { bookings: [], packs: [], uploads: [], aborted: [] };
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'GET' || url.pathname.startsWith('/api/auth/')) return route.continue();

    if (/^\/api\/pipeline\/\d+\/interview(\/reschedule)?$/.test(url.pathname)) {
      seen.bookings.push({ path: url.pathname, body: req.postDataJSON() });
      return route.fulfill({ status: 418, contentType: 'application/json', body: JSON.stringify({ message: 'Blocked by the U01 e2e test: nothing was booked.' }) });
    }
    if (/^\/api\/pipeline\/interview\/\d+\/send-pack$/.test(url.pathname)) {
      seen.packs.push({ path: url.pathname, body: req.postDataJSON() });
      return route.fulfill({ status: 418, contentType: 'application/json', body: JSON.stringify({ message: 'Blocked by the U01 e2e test.' }) });
    }
    if (/^\/api\/candidates\/\d+\/resume$/.test(url.pathname)) {
      seen.uploads.push({ path: url.pathname, contentType: req.headers()['content-type'] || '', body: req.postData() || '' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { resumeStatus: 'ok', cvFileUrl: null }, message: 'Resume uploaded' }) });
    }
    seen.aborted.push(`${req.method()} ${url.pathname}`);
    return route.abort();
  });
  return seen;
}

test('U01: no resume → warning, alternatives and a confirm before booking', async ({ page }, testInfo) => {
  const seen = await guardWrites(page);
  const shot = (name) => page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: false });

  await page.goto(`/pipeline?candidate=${PIPELINE_ID}`);
  const drawer = page.locator('.ant-drawer-open .ant-drawer-content-wrapper:visible');
  await expect(drawer).toContainText(CANDIDATE, { timeout: 60_000 });

  // The drawer never offers the workbook as "View resume".
  await expect(drawer.getByRole('link', { name: 'View resume' })).toHaveCount(0);
  const noResume = drawer.getByText('No resume on file', { exact: true });
  if (await noResume.count()) {
    await expect(noResume.first()).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Upload resume' }).first()).toBeVisible();
  } else {
    testInfo.annotations.push({ type: 'note', description: 'No "Shortlisted from Candidate Screening" line on this journey, so the header resume link was not checked.' });
  }

  // Open the Schedule window and read the pre-send check it gets.
  const previewResponse = page.waitForResponse((r) => r.url().includes(`/api/pipeline/${PIPELINE_ID}/interview-preview`) && r.status() === 200);
  await drawer.getByRole('button', { name: 'Schedule Interview' }).click();
  const preview = await (await previewResponse).json();
  const pack = preview?.data?.pack ?? preview?.pack;
  expect(pack, 'the preview carries the pack check').toBeTruthy();
  // 'not_a_resume' while the workbook link is stored; 'missing' once the
  // repair script has cleared it (staging, 10 Nov). Either must warn.
  expect(['missing', 'not_a_resume']).toContain(pack.resume);
  expect(typeof pack.report).toBe('boolean');
  expect(['ok', 'missing']).toContain(pack.jd);

  const modal = page.getByRole('dialog', { name: 'Schedule interview' });
  await expect(modal).toBeVisible();
  const warning = modal.locator('.ant-alert-warning');
  await expect(warning).toContainText(pack.resume === 'not_a_resume'
    ? `The file on record for ${CANDIDATE} is not a resume, so it will not be sent.`
    : `No resume on file for ${CANDIDATE}.`);
  await expect(warning).toContainText(/The panel will get .* only\.|Nothing else is on file to attach\./);
  await expect(warning.getByRole('button', { name: 'Upload resume' })).toBeVisible();
  const profileBox = warning.getByRole('checkbox', { name: 'Attach the candidate profile summary instead' });
  await expect(profileBox).not.toBeChecked();
  await warning.scrollIntoViewIfNeeded();
  await shot('u01-1-warning');

  // Fill just enough to submit: a panel address we own, a date, a time.
  await modal.getByPlaceholder('name@aapnainfotech.com, second@aapnainfotech.com').fill(PANEL);
  const date = modal.getByPlaceholder('Select a date');
  await date.click();
  await date.fill(dayjs().add(7, 'day').format('ddd, DD MMM YYYY'));
  await date.press('Enter');
  // The time select sits beside the date picker; picking a date fills a
  // default hour, so it may already have a value.
  const time = date.locator('xpath=ancestor::div[contains(@class,"ant-picker")]/following-sibling::div[contains(@class,"ant-select")]');
  await time.click();
  await page.keyboard.type('1000');
  await page.keyboard.press('Enter');
  await expect(modal).toContainText(/Ends at/);

  // 1) Create invite → asks first; "Go back" sends nothing.
  await modal.getByRole('button', { name: 'Create invite' }).click();
  const confirm = page.locator('.ant-modal-confirm');
  await expect(confirm).toContainText('Send without a resume?');
  await expect(confirm).toContainText(`No resume is on file for ${CANDIDATE}. The panel will not get a CV with this invite.`);
  await shot('u01-2-confirm');
  await confirm.getByRole('button', { name: 'Go back' }).click();
  await expect(confirm).toHaveCount(0);
  expect(seen.bookings, '"Go back" books nothing').toHaveLength(0);

  // 2) Tick the profile summary, confirm → the booking carries it.
  await profileBox.check();
  await modal.getByRole('button', { name: 'Create invite' }).click();
  await expect(confirm).toContainText('The candidate profile summary goes to the panel in its place.');
  await confirm.getByRole('button', { name: 'Send without a resume' }).click();
  await expect.poll(() => seen.bookings.length).toBe(1);
  expect(seen.bookings[0].path).toBe(`/api/pipeline/${PIPELINE_ID}/interview`);
  expect(seen.bookings[0].body).toMatchObject({ send_pack: true, attach_profile: true, interviewer_email: PANEL, stage_key: expect.any(String) });
  await expect(page.locator('.ant-message')).toContainText('Blocked by the U01 e2e test');

  // 3) Upload resume from the warning: posts the file to the staff endpoint.
  await warning.locator('input[type="file"]').setInputFiles({
    name: 'u01-test-resume.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% U01 e2e\n'),
  });
  await expect.poll(() => seen.uploads.length).toBe(1);
  expect(seen.uploads[0].path).toMatch(/^\/api\/candidates\/\d+\/resume$/);
  expect(seen.uploads[0].contentType).toMatch(/multipart\/form-data/);
  expect(seen.uploads[0].body).toContain('name="resume"; filename="u01-test-resume.pdf"');
  await expect(page.locator('.ant-message')).toContainText('Resume uploaded.');

  // 4) With the pack unticked there is nothing to warn about, and no confirm.
  await modal.getByRole('checkbox', { name: 'Send the JD, CV and report so far to the panel' }).uncheck();
  await expect(modal.locator('.ant-alert-warning')).toHaveCount(0);
  await modal.getByRole('button', { name: 'Create invite' }).click();
  await expect.poll(() => seen.bookings.length).toBe(2);
  await expect(confirm).toHaveCount(0);
  expect(seen.bookings[1].body).toMatchObject({ send_pack: false, attach_profile: false });
  await shot('u01-3-after');

  await modal.getByRole('button', { name: 'Cancel' }).click();
  testInfo.annotations.push({ type: 'aborted-writes', description: seen.aborted.join(', ') || 'none' });
});
