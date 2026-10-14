/**
 * Keyword Filtering — strict filters, whole-word skills, exact lookup and the
 * screen changes (Phase 3 "Do Now", N02–N06).
 *
 * Runs against real (staging) data, so it checks RULES on every returned
 * candidate rather than exact result lists; exact row-level cases live in
 * backend/src/tests/integration/keywordFilters.test.js.
 *
 * Search inputs default to RT's own examples and can be overridden:
 *   E2E_LOOKUP_NAME   (default "Sushree Sandhyarani Gagarai")
 *   E2E_LOOKUP_EMAIL  (lookup-by-email test skipped when unset)
 *   E2E_LOOKUP_PHONE  (lookup-by-phone test skipped when unset)
 *   E2E_SKILLS        (default "Java, Spring")
 *   E2E_LOCATION      (default "Noida")
 */
import { test, expect } from '@playwright/test';
import { openScreening, runKeywordSearch, runLookup, locationParts, num, parseCsv } from './helpers/screening.js';

const LOOKUP_NAME = process.env.E2E_LOOKUP_NAME || 'Sushree Sandhyarani Gagarai';
const LOOKUP_EMAIL = process.env.E2E_LOOKUP_EMAIL || '';
const LOOKUP_PHONE = process.env.E2E_LOOKUP_PHONE || '';
const SKILLS = process.env.E2E_SKILLS || 'Java, Spring';
const LOCATION = process.env.E2E_LOCATION || 'Noida';

const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const digits10 = (s) => String(s ?? '').split(/[,;/]/).map((p) => p.replace(/[^0-9]/g, '')).filter((d) => d.length >= 10).map((d) => d.slice(-10));

/** Whole-phrase, case-insensitive regex, same boundaries as the backend matcher. */
function wholePhrase(phrase) {
  const body = phrase.trim().toLowerCase().split(/[\s_-]+/)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\s_-]+');
  return new RegExp(`(^|[^a-z0-9+#.])${body}($|[^a-z0-9+#.]|[.]($|[^a-z0-9]))`, 'i');
}

test.beforeEach(async ({ page }) => {
  await openScreening(page, 'keyword');
});

test.describe('N02 — exact lookup', () => {
  test('a full name returns only that person, with contact details on the card', async ({ page }) => {
    const data = await runLookup(page, LOOKUP_NAME);
    expect(data.summary.mode).toBe('lookup');
    expect(data.candidates.length).toBeGreaterThan(0);
    if (data.summary.matchKind === 'exact') {
      for (const c of data.candidates) expect(norm(c.Name)).toBe(norm(LOOKUP_NAME));
    }
    // Lookup results carry no score, and the card still shows email · phone.
    await expect(page.getByTestId('cand-contact').first()).toBeVisible();
    await expect(page.getByTestId('cand-contact').first()).toContainText(/@|—/);
  });

  test('an email returns only candidates holding that address', async ({ page }) => {
    test.skip(!LOOKUP_EMAIL, 'set E2E_LOOKUP_EMAIL');
    const data = await runLookup(page, LOOKUP_EMAIL);
    expect(data.summary.mode).toBe('lookup');
    expect(data.candidates.length).toBeGreaterThan(0);
    for (const c of data.candidates) {
      expect(String(c.EmailID).toLowerCase().split(/[,;]/).map((e) => e.trim())).toContain(LOOKUP_EMAIL.toLowerCase());
    }
  });

  test('a phone number matches whatever the stored formatting', async ({ page }) => {
    test.skip(!LOOKUP_PHONE, 'set E2E_LOOKUP_PHONE');
    const data = await runLookup(page, LOOKUP_PHONE);
    expect(data.summary.mode).toBe('lookup');
    expect(data.candidates.length).toBeGreaterThan(0);
    const wanted = digits10(LOOKUP_PHONE)[0];
    for (const c of data.candidates) expect(digits10(c.ContactNumber)).toContain(wanted);
  });
});

test.describe('N03 — every applied filter is a hard filter', () => {
  test(`location "${LOCATION}" is an exact city match — never "Greater ${LOCATION}" or blank`, async ({ page }) => {
    const data = await runKeywordSearch(page, { skills: SKILLS.split(',')[0], location: [LOCATION] });
    expect(data.summary.mode).toBe('keyword');
    for (const c of data.candidates) {
      expect(locationParts(c.CurrentLocation), `cv ${c.id}: "${c.CurrentLocation}"`).toContain(norm(LOCATION));
    }
  });

  test('gender, experience, expected CTC and notice all hold, with no blanks', async ({ page }) => {
    const data = await runKeywordSearch(page, {
      skills: SKILLS.split(',')[0], gender: 'Male', expMin: 2, expMax: 6, ctcMax: 15, notice: '30 days',
    });
    for (const c of data.candidates) {
      const tag = `cv ${c.id}`;
      expect(['male', 'm'], tag).toContain(norm(c.Gender));
      const exp = num(c.TotalExperienceYearsNumeric);
      expect(exp, `${tag} experience`).not.toBeNull();
      expect(exp).toBeGreaterThanOrEqual(2);
      expect(exp).toBeLessThanOrEqual(6);
      const ctc = num(c.ExpectedCTCNumeric);
      expect(ctc, `${tag} expected CTC`).not.toBeNull();
      expect(ctc).toBeLessThanOrEqual(15);
      const notice = num(c.NoticePeriodDays);
      expect(notice, `${tag} notice`).not.toBeNull();
      expect(notice).toBeLessThanOrEqual(30);
    }
  });
});

test.describe('Position applied & Added within', () => {
  test('position applied is a whole-phrase match; added-within keeps only recent uploads', async ({ page }) => {
    const position = process.env.E2E_POSITION || 'Developer';
    const data = await runKeywordSearch(page, { position, addedWithin: 'Last 90 days' });
    const cutoff = Date.now() - 90 * 86400000 - 60_000;
    const re = wholePhrase(position);
    for (const c of data.candidates) {
      expect(String(c.PositionApplied), `cv ${c.id}`).toMatch(re);
      expect(new Date(c.createdAt).getTime(), `cv ${c.id} createdAt`).toBeGreaterThanOrEqual(cutoff);
    }
  });
});

test.describe('N04 — skills: whole words, All / Any', () => {
  test(`"${SKILLS}" with All: every result has every skill`, async ({ page }) => {
    const all = await runKeywordSearch(page, { skills: SKILLS });
    for (const c of all.candidates) {
      const missing = (c.jdSkillSignals?.mandatory || []).filter((s) => s.status === 'missing').map((s) => s.skill);
      expect(missing, `cv ${c.id}`).toEqual([]);
    }

    const any = await runKeywordSearch(page, { skills: SKILLS, matchMode: 'any' });
    expect(any.summary.matchMode).toBe('any');
    expect(any.candidates.length).toBeGreaterThanOrEqual(all.candidates.length);
    for (const c of any.candidates) {
      const found = (c.jdSkillSignals?.mandatory || []).filter((s) => s.status !== 'missing');
      expect(found.length, `cv ${c.id}`).toBeGreaterThan(0);
    }
  });
});

test.describe('N05 — filters decide who appears; the score only orders', () => {
  test('removed-by counts add up and results are sorted by score', async ({ page }) => {
    const data = await runKeywordSearch(page, { skills: SKILLS, location: [LOCATION] });
    const removed = Object.values(data.summary.removedBy || {}).reduce((a, b) => a + b, 0);
    expect(data.summary.total).toBe(removed + data.summary.shown);
    expect(data.summary.summaryText).not.toMatch(/hidden by low score/);
    const scores = data.candidates.map((c) => c.relevanceScore.avgScore);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });
});

test.describe('N06 — screen changes', () => {
  test('labels, notice text, contact line and the keyword score breakdown', async ({ page }) => {
    await expect(page.getByText('Expected CTC (LPA)', { exact: true })).toBeVisible();
    // Classic form: separate Name / Email / Phone fields and a plain "any skill" checkbox.
    for (const label of ['Candidate name', 'Email', 'Phone']) {
      await expect(page.locator('.ant-form-item-label').getByText(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByTestId('any-skill')).not.toBeChecked();
    await expect(page.getByText('Designation', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Annual CTC (LPA)', { exact: true })).toHaveCount(0);

    const data = await runKeywordSearch(page, { skills: SKILLS.split(',')[0] });
    test.skip(data.candidates.length === 0, 'no results to inspect');

    await expect(page.locator('body')).not.toContainText(/Months? days notice/i);
    await expect(page.getByTestId('cand-contact').first()).toBeVisible();

    // The drawer now explains a keyword score.
    await page.locator('.cand-card').first().click();
    const drawer = page.locator('.ant-drawer-content').first();
    await expect(drawer.getByText('Keyword Mode')).toBeVisible();
    await expect(drawer.getByText('Skill Match').first()).toBeVisible();
  });

  test('the keyword CSV export carries the match score', async ({ page }) => {
    const data = await runKeywordSearch(page, { skills: SKILLS.split(',')[0], location: [LOCATION] });
    test.skip(data.candidates.length === 0, 'no results to export');

    const exportResponse = page.waitForResponse((r) => r.url().includes('/screening/keyword-export'));
    await page.getByRole('button', { name: /Export/ }).first().click();
    const res = await exportResponse;
    expect(res.status()).toBe(200);
    const rows = parseCsv(await res.text());
    const header = rows[0];
    const scoreCol = header.indexOf('Match Score');
    const starsCol = header.indexOf('Stars');
    expect(scoreCol).toBeGreaterThan(-1);
    for (const row of rows.slice(1)) {
      expect(row[scoreCol], `row for ${row[header.indexOf('Name')]}`).not.toBe('');
      expect(row[starsCol]).not.toBe('');
    }
  });
});
