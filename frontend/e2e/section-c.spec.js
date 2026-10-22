/**
 * Phase 3 "Do Now", section C — the screens changed.
 *
 *   E2E_BASE_URL=http://localhost:5174 npx playwright test e2e/section-c.spec.js
 *
 * N17  Settings: "Candidate emails: About AAPNA" card (admin)
 * N18  public "Complete your profile" form: Edit-form order, lists and rules
 * N18  recruiter Edit form: one field per row, same lists and rules
 * N21  Search Candidate: tick, "Add to JD", result naming who was not added
 * N22  Schedule dialog: editable Interviewee phone, refused when invalid
 * N45  outcome dialog: "Send email notification to candidate" unticked
 *
 * The data-dependent checks look for their own rows and SKIP when absent, so
 * the file is safe on any database. Locally they are created by
 * scratchpad/scripts/seed-sectionC.mjs ("C …" candidates, recruiter accounts);
 * re-seed before a re-run, because Add to JD and the outcome change the data.
 *
 * Screenshots land in test-results/section-c/ for review.
 */
import { test, expect } from '@playwright/test';

const SHOTS = process.env.E2E_SHOTS_DIR || 'test-results/section-c';
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
const API = process.env.E2E_API_URL || 'http://localhost:5055';
// base64 of c.form@example.invalid — the seeded public-form candidate.
const FORM_TOKEN = process.env.E2E_C_FORM_TOKEN || 'Yy5mb3JtQGV4YW1wbGUuaW52YWxpZA==';

async function authGet(page, path) {
  const token = await page.evaluate(() => localStorage.getItem('ats_token'));
  const res = await page.request.get(`${API}/api${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return res.ok() ? res.json() : null;
}

async function findJourney(page, name) {
  const body = await authGet(page, '/pipeline');
  return (body?.data?.columns || []).flatMap((c) => c.cards || []).find((c) => c.candidate_name === name) || null;
}

/** Every visible form item's left edge: one field per row means they all line up. */
async function formItemLefts(scope) {
  return scope.locator('.ant-form-item:visible').evaluateAll((els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().left)))]);
}

test.describe('N17 About AAPNA', () => {
  test('admin edits, saves and previews the text', async ({ page }) => {
    await page.goto('/settings');
    const card = page.getByTestId('company-profile-card');
    await expect(card).toBeVisible();
    const text = `AAPNA Infotech, Noida.\nE2E ${Date.now()}`;
    await card.locator('textarea').fill(text);
    const saved = page.waitForResponse((r) => r.url().endsWith('/api/settings/company-profile') && r.request().method() === 'POST');
    await card.getByRole('button', { name: 'Save' }).click();
    expect((await saved).status()).toBe(200);

    await page.reload();
    await expect(page.getByTestId('company-profile-card').locator('textarea')).toHaveValue(text);
    await page.getByTestId('company-profile-card').getByRole('button', { name: 'Preview in email' }).click();
    const preview = page.locator('.ant-modal:visible').filter({ hasText: 'How it appears in the email' });
    await expect(preview.getByText('About AAPNA', { exact: true })).toBeVisible();
    await expect(preview.getByText(/E2E \d+/)).toBeVisible();
    await shot(page, 'settings-about-aapna');
  });
});

test.describe('N18 public form', () => {
  test('Edit-form order, shared lists and rules', async ({ page }) => {
    await page.goto(`/missing-jd-upload?token=${encodeURIComponent(FORM_TOKEN)}`);
    const form = page.locator('form#missing-jd');
    test.skip(!(await form.waitFor({ timeout: 30_000 }).then(() => true, () => false)), 'needs the seeded C Form Candidate');

    const labels = await form.locator('.ant-form-item-label label').allInnerTexts();
    const order = ['Candidate contact number', 'Highest qualification', 'Total experience (years)', 'Last company experience (years)',
      'Current location', 'Expected CTC (LPA)', 'Notice period', 'Position applied', 'Recruiter info (AAPNA)',
      'English communication rating', 'Preferred shift', 'Graduation percentage', 'Upload resume'];
    expect(labels.map((l) => l.trim())).toEqual(order);
    expect((await formItemLefts(form)).length).toBe(1);

    // Recruiter list: active accounts plus None; a deactivated account is absent.
    await form.locator('.ant-form-item').filter({ hasText: 'Recruiter info (AAPNA)' }).locator('.ant-select').click();
    await expect(page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: 'None' })).toBeVisible();
    const recruiterOpts = await page.locator('.ant-select-dropdown:visible .ant-select-item-option').allInnerTexts();
    expect(recruiterOpts).toEqual(expect.arrayContaining(['Chhaya Verma', 'Sweta Ganguly', 'None']));
    expect(recruiterOpts).not.toContain('Prakash Pant');
    await page.keyboard.press('Escape');

    // Qualification "Other" asks what it is.
    await form.locator('.ant-form-item').filter({ hasText: 'Highest qualification' }).locator('.ant-select').click();
    // The list is virtual: filter so the last option is rendered.
    await page.keyboard.type('Other');
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: 'Other (please specify)' }).click();
    await expect(form.getByText('Qualification', { exact: true })).toBeVisible();

    // City suggestions from the ATS.
    await form.locator('.ant-form-item').filter({ hasText: 'Current location' }).locator('input').fill('Noi');
    await expect(page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: 'Noida' }).first()).toBeVisible();
    await page.keyboard.press('Escape');

    // Rules.
    await form.locator('.ant-form-item').filter({ hasText: 'Candidate contact number' }).locator('input').fill('12345');
    await form.locator('.ant-form-item').filter({ hasText: 'Total experience (years)' }).locator('input').fill('3');
    await form.locator('.ant-form-item').filter({ hasText: 'Last company experience (years)' }).locator('input').fill('4');
    await form.locator('.ant-form-item').filter({ hasText: 'Expected CTC (LPA)' }).locator('input').fill('500');
    await form.locator('.ant-form-item').filter({ hasText: 'Graduation percentage' }).locator('input').fill('101');
    await page.getByRole('button', { name: 'Submit details' }).click();
    await expect(form.getByText(/Enter a 10-digit mobile number \(for example/)).toBeVisible();
    await expect(form.getByText('Last company experience cannot be more than total experience (3 years).')).toBeVisible();
    await expect(form.getByText('Expected CTC (LPA) must be between 0 and 200.')).toBeVisible();
    await expect(form.getByText('Graduation percentage must be between 0 and 100.')).toBeVisible();
    await shot(page, 'public-form-rules');
  });
});

test.describe('N21 / N18 Search Candidate', () => {
  test('Add to JD names who was not added, and why', async ({ page }) => {
    await page.goto('/candidates');
    await page.locator('.ant-form-item').filter({ hasText: 'Candidate Name' }).locator('input').fill('C Add');
    await page.getByRole('button', { name: 'Search' }).click();
    const rows = page.locator('.ant-table-tbody tr.ant-table-row');
    await expect(rows.first()).toBeVisible();
    const names = await rows.locator('td').nth(2).allInnerTexts().catch(() => []);
    test.skip((await rows.count()) < 3, `needs the 3 seeded "C Add" candidates (found ${names.length})`);

    for (let i = 0; i < 3; i += 1) await rows.nth(i).locator('.ant-checkbox-input').check();
    const bar = page.getByTestId('selection-bar');
    await expect(bar).toContainText('3 selected');
    await bar.getByRole('button', { name: 'Add to JD' }).click();

    const dialog = page.locator('.ant-modal:visible').filter({ hasText: 'Add 3 candidates to a JD' });
    await expect(dialog).toBeVisible();
    await dialog.locator('.ant-select').first().click();
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option').first().click();
    await expect(dialog.getByTestId('no-phone-note')).toHaveText(/1 of these candidates has no valid phone number\. Their email asks them to confirm their mobile number\./);
    await expect(dialog.getByTestId('email-count')).toHaveText('This will email 3 candidates.');
    await shot(page, 'add-to-jd-dialog');

    // No email locally (nothing can leave the machine anyway): untick, then add.
    await dialog.getByRole('checkbox', { name: /Send email notification/ }).uncheck();
    await expect(dialog.getByTestId('email-count')).toHaveCount(0);
    const req = page.waitForResponse((r) => r.url().endsWith('/api/screening/shortlist'));
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    const res = await req;
    expect(res.status(), await res.text()).toBe(200);
    expect(JSON.parse(res.request().postData()).source).toBe('search_candidate');

    const result = page.getByTestId('shortlist-result');
    await expect(result).toContainText('2 added');
    await expect(result).toContainText('1 not added');
    await expect(result).toContainText(/C Add Cooled: Rejected on \d{2} \w{3} \d{4} \(.+\)\. Can be added again after \d{2} \w{3} \d{4}\./);
    await shot(page, 'add-to-jd-result');
    await page.locator('.ant-modal:visible .ant-modal-footer').getByRole('button', { name: 'Close' }).click();
    await expect(page.getByTestId('selection-bar')).toHaveCount(0);
  });

  test('Edit form: one field per row, shared lists and rules', async ({ page }) => {
    await page.goto('/candidates');
    await page.locator('.ant-form-item').filter({ hasText: 'Candidate Name' }).locator('input').fill('C Add Fresh');
    await page.getByRole('button', { name: 'Search' }).click();
    const row = page.locator('.ant-table-tbody tr.ant-table-row').filter({ hasText: 'C Add Fresh' });
    test.skip(!(await row.waitFor({ timeout: 20_000 }).then(() => true, () => false)), 'needs the seeded C Add Fresh');
    await row.getByRole('button', { name: 'Edit' }).click();

    const modal = page.locator('.ant-modal:visible').filter({ hasText: 'Edit Candidate' });
    await expect(modal).toBeVisible();
    // Top-level fields line up (Employment History rows are inside a box, so look at the first few).
    const lefts = await modal.locator('form > .ant-form-item:visible').evaluateAll((els) => [...new Set(els.slice(0, 12).map((e) => Math.round(e.getBoundingClientRect().left)))]);
    expect(lefts.length).toBe(1);

    await modal.locator('.ant-form-item').filter({ hasText: 'RECRUITER INFO (AAPNA)' }).locator('.ant-select').click();
    await expect(page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: 'None' })).toBeVisible();
    const recruiterOpts = await page.locator('.ant-select-dropdown:visible .ant-select-item-option').allInnerTexts();
    expect(recruiterOpts).toEqual(expect.arrayContaining(['Chhaya Verma', 'Sweta Ganguly', 'None']));
    await page.keyboard.press('Escape');

    await modal.locator('.ant-form-item').filter({ hasText: 'NOTICE PERIOD' }).locator('.ant-select').click();
    await expect(page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: 'More than 90 days' })).toBeVisible();
    await page.keyboard.press('Escape');

    await modal.locator('.ant-form-item').filter({ hasText: 'CANDIDATE CONTACT NUMBER' }).locator('input').fill('12345');
    await modal.locator('.ant-form-item').filter({ hasText: 'GRADUATION PERCENTAGE' }).first().locator('input').fill('120');
    await modal.getByRole('button', { name: 'Update Candidate' }).click();
    await expect(modal.getByText(/Enter a 10-digit mobile number/)).toBeVisible();
    await expect(modal.getByText('Graduation percentage must be between 0 and 100.')).toBeVisible();
    await shot(page, 'edit-form-rules');
  });
});

test.describe('N22 / N45 pipeline drawer', () => {
  test('outcome saved without the candidate email', async ({ page }) => {
    await page.goto('/pipeline');
    const journey = await findJourney(page, 'C Outcome NoEmail');
    test.skip(!journey || journey.current_stage_key !== 'tech1', 'needs the seeded C Outcome NoEmail journey');
    await page.goto(`/pipeline?candidate=${journey.id}`);
    const drawer = page.locator('.ant-drawer-content-wrapper:visible');
    await expect(drawer).toBeVisible({ timeout: 60_000 });
    await drawer.getByRole('button', { name: 'Approve' }).first().click();

    const dialog = page.locator('.ant-modal:visible').filter({ hasText: 'Record round outcome' });
    // antd puts data-testid on the checkbox input itself.
    const box = dialog.getByTestId('outcome-send-email');
    await expect(box).toBeChecked();
    await expect(dialog.getByRole('button', { name: 'Save & send email' })).toBeVisible();
    await box.uncheck();
    await expect(dialog.getByText(/No email will go to the candidate/)).toBeVisible();
    await expect(dialog.getByText(/Outcome email → candidate/)).toHaveCount(0);
    await shot(page, 'outcome-no-email');

    await dialog.locator('textarea').first().fill('Approved in the section C check without a score.');
    const outcome = page.waitForResponse((r) => /\/api\/pipeline\/\d+\/outcome$/.test(r.url()));
    await dialog.getByRole('button', { name: 'Save outcome' }).click();
    const res = await outcome;
    expect(res.status(), await res.text()).toBe(200);
    expect(JSON.parse(res.request().postData()).send_email).toBe(false);
  });

  test('Schedule dialog: phone is editable and an invalid one is refused', async ({ page }) => {
    await page.goto('/pipeline');
    const journey = await findJourney(page, 'C Schedule Phone');
    test.skip(!journey || journey.current_stage_key !== 'tech1', 'needs the seeded C Schedule Phone journey');
    await page.goto(`/pipeline?candidate=${journey.id}`);
    const drawer = page.locator('.ant-drawer-content-wrapper:visible');
    await expect(drawer).toBeVisible({ timeout: 60_000 });
    await drawer.getByRole('button', { name: 'Schedule Interview' }).click();

    const dialog = page.locator('.ant-modal:visible').filter({ hasText: 'Schedule interview' });
    const phone = dialog.getByTestId('interviewee-phone');
    await expect(phone).toBeEditable();
    await expect(phone).toHaveValue('');
    await phone.fill('98765');
    await expect(dialog.getByText(/saved to the candidate's record when you create the invite/)).toBeVisible();
    await shot(page, 'schedule-phone');
    // Refused in the dialog before anything is sent (date and interviewer are
    // checked first, so this asserts the field state rather than the submit).
    await expect(phone).toHaveAttribute('class', /ant-input-status-error/);
  });
});
