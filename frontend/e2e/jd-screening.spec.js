/**
 * JD Filtering — strict gates, ranking and the role card (Phase 3 "Do Now",
 * N07–N10).
 *
 *   E2E_MRF_IDS=12,34,56 npm run e2e -- jd-screening
 *
 * Runs against real data, so it checks RULES on every returned candidate rather
 * than exact result lists; exact row-level cases live in
 * backend/src/tests/integration/jdGates.test.js. The backend must run with
 * SCREENING_V2=true.
 *
 * For each MRF in E2E_MRF_IDS (approved, open):
 *   - the role card shows what the gates enforce (mandatory skills, experience
 *     range, budget) and the summary line matches the response;
 *   - no result is missing a mandatory skill, sits outside the experience
 *     range, or expects more than the budget;
 *   - results are ordered by score, highest first;
 *   - the CSV export carries the same candidates.
 */
import { test, expect } from '@playwright/test';
import { runJdSearch, num, parseCsv } from './helpers/screening.js';

const MRF_IDS = (process.env.E2E_MRF_IDS || '')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isInteger(n) && n > 0);

/** Same wording as CandidateScreening.jsx's formatExperienceBand. */
const bandText = (band) => (band.max != null ? `${band.min} – ${band.max} yrs` : `${band.min} yrs or more`);

test.describe('JD Filtering — strict rules', () => {
  test.skip(MRF_IDS.length === 0, 'set E2E_MRF_IDS to a comma-separated list of open MRF ids');

  for (const mrfId of MRF_IDS) {
    test(`MRF ${mrfId}: role card, gates and ordering`, async ({ page }) => {
      const data = await runJdSearch(page, mrfId);
      expect(data.summary.mode, 'backend is not running with SCREENING_V2=true').toBe('jd-strict');
      const { role, candidates, summary } = data;
      const card = page.locator('.screening-role-card');

      if (summary.noMandatorySkills) {
        await expect(page.getByText('This MRF has no mandatory skills, so no candidates are shown.')).toBeVisible();
        await expect(card.getByText('None found')).toBeVisible();
        expect(candidates).toHaveLength(0);
        return;
      }

      // Role card: what the gates enforce.
      await expect(card.getByText('Candidates must have all of these')).toBeVisible();
      for (const skill of role.mandatorySkillsParsed) {
        await expect(card.getByText(skill, { exact: true }).first()).toBeVisible();
      }
      await expect(card.getByText(bandText(role.experienceBand), { exact: true })).toBeVisible();
      if (role.budget_max) {
        await expect(card.getByText(`Up to ₹${role.budget_max} LPA`)).toBeVisible();
      } else {
        await expect(card.getByText('Expected CTC is not checked')).toBeVisible();
      }

      // Summary line.
      await expect(page.getByText(`${summary.shown} matched`, { exact: true })).toBeVisible();
      await expect(page.getByText(summary.summaryDetail)).toBeVisible();
      const removed = Object.values(summary.removedBy).reduce((a, b) => a + b, 0);
      expect(removed + summary.shown, 'removed-by counts add up to the total').toBe(summary.total);

      // Every result passes every gate.
      const band = role.experienceBand;
      for (const c of candidates) {
        const who = `${c.Name} (cv ${c.id})`;
        const missing = c.jdSkillSignals.mandatory.filter((s) => s.status === 'missing').map((s) => s.skill);
        expect(missing, `${who} is missing mandatory skills`).toEqual([]);

        const exp = num(c.TotalExperienceYearsNumeric);
        expect(exp, `${who} has no experience recorded`).not.toBeNull();
        expect(exp, `${who} is below the experience range`).toBeGreaterThanOrEqual(band.min);
        if (band.max != null) expect(exp, `${who} is above the experience range`).toBeLessThanOrEqual(band.max);

        if (role.budget_max) {
          const ctc = num(c.ExpectedCTCNumeric);
          expect(ctc, `${who} has no expected CTC recorded`).not.toBeNull();
          expect(ctc, `${who} expects more than the budget`).toBeLessThanOrEqual(role.budget_max);
        }
        expect(c.starRating.mode).toBe('JD Strict');
      }

      // Highest score first.
      const scores = candidates.map((c) => c.starRating.finalScore);
      expect(scores).toEqual([...scores].sort((a, b) => b - a));

      test.info().annotations.push({
        type: 'timing',
        description: `MRF ${mrfId}: ${summary.shown} shown in ${data.elapsedMs} ms (server ${JSON.stringify(summary.timings || {})})`,
      });
    });

    test(`MRF ${mrfId}: the CSV export carries the same candidates`, async ({ page }) => {
      const data = await runJdSearch(page, mrfId);
      test.skip(data.candidates.length === 0, 'no results to export');

      const exportResponse = page.waitForResponse((r) => r.url().includes(`/screening/roles/${mrfId}/export`));
      await page.getByRole('button', { name: /Export/ }).first().click();
      const res = await exportResponse;
      expect(res.status()).toBe(200);
      const rows = parseCsv(await res.text());
      const header = rows[0];
      const idCol = header.indexOf('Candidate ID');
      const scoreCol = header.indexOf('Match Score');
      expect(scoreCol).toBeGreaterThan(-1);
      const exported = rows.slice(1).map((r) => Number(r[idCol]));
      expect(exported).toEqual(data.candidates.slice(0, exported.length).map((c) => c.id));
      for (const row of rows.slice(1)) expect(row[scoreCol]).not.toBe('');
    });
  }
});
