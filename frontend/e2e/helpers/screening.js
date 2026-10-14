/**
 * Shared driving + checking helpers for the Candidate Screening specs.
 *
 * Every search is run through the real form, and the API response it triggers
 * is captured, so a spec can check a rule on EVERY returned candidate — not
 * only on the ten cards visible on the first page.
 */
import { expect } from '@playwright/test';

/** Opens Candidate Screening on the given tab ('keyword' | 'jd'). */
export async function openScreening(page, tab) {
  await page.goto('/filtering');
  const label = tab === 'jd' ? 'JD Filtering' : 'Keyword Filtering';
  await page.getByRole('tab', { name: label }).click();
  if (tab === 'keyword') {
    await expect(page.getByRole('button', { name: 'Search Candidates' })).toBeVisible();
  }
}

/** The antd Form.Item whose label is `label` (exact text). */
export function formItem(page, label) {
  return page.locator('.ant-form-item').filter({
    has: page.locator('.ant-form-item-label').getByText(label, { exact: true }),
  });
}

/** Picks an option in the antd Select inside the labelled form item. */
export async function chooseOption(page, label, optionText) {
  await formItem(page, label).locator('.ant-select').click();
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: optionText }).first().click();
}

/** Captures the next keyword-search API response after `submit()`; returns its data. */
async function submitAndCapture(page, submit) {
  const responsePromise = page.waitForResponse(
    (r) => r.url().includes('/screening/keyword-search') && r.request().method() === 'POST',
  );
  await submit();
  const response = await responsePromise;
  expect(response.status(), await response.text()).toBe(200);
  const body = await response.json();
  return body.data;
}

/**
 * Looks one person up through the Candidate name, Email or Phone field —
 * picked from what `text` looks like.
 * @returns {Promise<{candidates, summary}>}
 */
export async function runLookup(page, text) {
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  const field = text.includes('@') ? 'Email' : /^[+0-9\s()-]+$/.test(text) ? 'Phone' : 'Candidate name';
  await formItem(page, field).locator('input').fill(text);
  return submitAndCapture(page, () => page.getByRole('button', { name: 'Search Candidates' }).click());
}

/**
 * Fills the filters, submits, and returns `{ candidates, summary }` from the
 * API response.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{skills?, matchMode?, position?, addedWithin?, location?: string[],
 *          gender?, expMin?, expMax?, ctcMin?, ctcMax?, notice?}} f
 */
export async function runKeywordSearch(page, f = {}) {
  await page.getByRole('button', { name: 'Clear', exact: true }).click();

  if (f.skills) await page.locator('#keyword-skills').fill(f.skills);
  if (f.matchMode === 'any') await page.getByTestId('any-skill').check();
  if (f.position) await formItem(page, 'Position applied for').locator('input').fill(f.position);
  for (const city of f.location || []) {
    const input = formItem(page, 'Location').locator('input');
    await input.fill(city);
    await input.press('Enter');
  }
  if (f.gender) await chooseOption(page, 'Gender', f.gender);
  if (f.expMin != null) await formItem(page, 'Experience (years)').getByPlaceholder('Min').fill(String(f.expMin));
  if (f.expMax != null) await formItem(page, 'Experience (years)').getByPlaceholder('Max').fill(String(f.expMax));
  if (f.ctcMin != null) await formItem(page, 'Expected CTC (LPA)').getByPlaceholder('Min').fill(String(f.ctcMin));
  if (f.ctcMax != null) await formItem(page, 'Expected CTC (LPA)').getByPlaceholder('Max').fill(String(f.ctcMax));
  if (f.notice) await chooseOption(page, 'Notice period', f.notice);
  if (f.addedWithin) await chooseOption(page, 'Added within', f.addedWithin);

  return submitAndCapture(page, () => page.getByRole('button', { name: 'Search Candidates' }).click());
}

/**
 * Opens the JD tab with `mrfId` already selected and returns
 * `{ role, candidates, summary, elapsedMs }` from the role search.
 *
 * The page restores the selected role from localStorage on load, which is a
 * steadier way in than driving the searchable role dropdown by its label text.
 */
export async function runJdSearch(page, mrfId) {
  await page.goto('/');
  await page.evaluate((id) => {
    localStorage.setItem('screening_active_tab', 'jd');
    localStorage.setItem('screening_selected_role', String(id));
  }, mrfId);
  const responsePromise = page.waitForResponse(
    (r) => r.url().includes(`/screening/roles/${mrfId}/search`) && r.request().method() === 'POST',
    { timeout: 240_000 },
  );
  const started = Date.now();
  await page.goto('/filtering');
  const response = await responsePromise;
  const elapsedMs = Date.now() - started;
  expect(response.status(), await response.text()).toBe(200);
  const body = await response.json();
  return { ...body.data, elapsedMs };
}

// ── Rules, mirrored from backend/src/utils/screeningFilters.js ─────────

/** Stored location → comparable parts ("Noida (UP)" → "noida"). */
export function locationParts(value) {
  if (value == null) return [];
  return String(value)
    .split(/[,/;|]/)
    .map((p) => p.toLowerCase().replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** Decimal columns arrive as strings; empty stays null. */
export function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Minimal RFC 4180 CSV parser (quoted fields, doubled quotes, CRLF). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c !== ''));
}
