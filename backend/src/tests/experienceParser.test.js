/**
 * Unit tests for resume date reading and total-experience arithmetic.
 * Run: npm run test:unit
 *
 * These lock in the defect QA filed on 2026-08-11 as "Total Experience is not
 * updating when we checked in the Search Candidate page": any resume with an
 * employment-history row took the date-computed total, even when none of its
 * dates could be read, so the candidate was stored as "0 years" and — because
 * "0" is a non-empty string — was never flagged as missing data either.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseResumeDate,
  monthsBetween,
  summariseEmploymentHistory,
  resolveExperienceYears,
  isStorableExperience,
} from '../utils/experienceParser.js';

const ym = (date) => (date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}` : null);

// ── Date formats ──────────────────────────────────────────────────────

test('parseResumeDate reads the formats that already worked', () => {
  assert.equal(ym(parseResumeDate('06/2022')), '2022-06');
  assert.equal(ym(parseResumeDate('6-2022')), '2022-06');
  assert.equal(ym(parseResumeDate('2022/06')), '2022-06');
  assert.equal(ym(parseResumeDate('2022-06')), '2022-06');
  assert.equal(ym(parseResumeDate('June 2022')), '2022-06');
});

test('parseResumeDate reads the formats that used to fall through and score 0', () => {
  // Each of these previously reached `new Date(value)`, which rejects them.
  assert.equal(ym(parseResumeDate('Jun-2022')), '2022-06');
  assert.equal(ym(parseResumeDate('June-2022')), '2022-06');
  assert.equal(ym(parseResumeDate("May'21")), '2021-05');
  assert.equal(ym(parseResumeDate("May '21")), '2021-05');
  assert.equal(ym(parseResumeDate('05.2022')), '2022-05');
  assert.equal(ym(parseResumeDate('2022.05')), '2022-05');
  assert.equal(ym(parseResumeDate('05 2022')), '2022-05');
  assert.equal(ym(parseResumeDate('Jun 22')), '2022-06');
  assert.equal(ym(parseResumeDate('2022')), '2022-01');
});

test('parseResumeDate treats the "still here" words as today', () => {
  for (const word of ['Present', 'current', 'Till Date', 'now', 'Ongoing']) {
    const parsed = parseResumeDate(word);
    assert.ok(parsed instanceof Date, `${word} should parse`);
    assert.equal(ym(parsed), ym(new Date()));
  }
});

test('parseResumeDate returns null for the unusable', () => {
  assert.equal(parseResumeDate(null), null);
  assert.equal(parseResumeDate(''), null);
  assert.equal(parseResumeDate(undefined), null);
  assert.equal(parseResumeDate('n/a'), null);
  assert.equal(parseResumeDate('sometime in the past'), null);
});

// ── Span arithmetic ───────────────────────────────────────────────────

test('monthsBetween counts whole months and refuses an unusable pair', () => {
  assert.equal(monthsBetween(new Date(2022, 0, 1), new Date(2023, 0, 1)), 12);
  assert.equal(monthsBetween(new Date(2022, 0, 1), new Date(2022, 5, 1)), 5);
  assert.equal(monthsBetween(null, new Date()), 0);
  assert.equal(monthsBetween(new Date(), null), 0);
});

test('monthsBetween never returns a negative span', () => {
  // "2024 to 2021" is a parse artefact; subtracting it from the running total
  // would make a longer history report LESS experience.
  assert.equal(monthsBetween(new Date(2024, 0, 1), new Date(2021, 0, 1)), 0);
});

// ── History summary ───────────────────────────────────────────────────

test('summariseEmploymentHistory totals every readable span', () => {
  const { companies, totalMonths, lastCompanyMonths } = summariseEmploymentHistory([
    { CompanyName: 'Acme', StartDate: '01/2022', EndDate: '01/2024' },
    { CompanyName: 'Globex', StartDate: '01/2020', EndDate: '01/2022' },
  ]);
  assert.equal(totalMonths, 48);
  assert.equal(lastCompanyMonths, 24, 'most-recent-first: the FIRST row is the last company');
  assert.equal(companies.length, 2);
  assert.equal(companies[0].YearsWorked, 2);
});

test('summariseEmploymentHistory reports per-job years, not a list-length artefact', () => {
  const { companies } = summariseEmploymentHistory([
    { CompanyName: 'Acme', StartDate: '01/2022', EndDate: '07/2022' },
    { CompanyName: 'Nowhere', StartDate: 'n/a', EndDate: 'n/a' },
  ]);
  assert.equal(companies[0].YearsWorked, 0.5);
  // Unreadable dates give null, not a misleading 0.
  assert.equal(companies[1].YearsWorked, null);
});

test('summariseEmploymentHistory is null/shape safe', () => {
  for (const input of [null, undefined, 'not an array', {}]) {
    const result = summariseEmploymentHistory(input);
    assert.deepEqual(result, { companies: [], totalMonths: 0, lastCompanyMonths: 0 });
  }
  const withJunk = summariseEmploymentHistory([null, { CompanyName: 'X' }]);
  assert.equal(withJunk.companies.length, 2);
  assert.equal(withJunk.totalMonths, 0);
});

// ── The resolution rule (the actual bug) ──────────────────────────────

test('computed months win when the dates were readable', () => {
  assert.equal(resolveExperienceYears(48, '3'), '4');
  assert.equal(resolveExperienceYears(18, null), '1.5');
});

test('THE BUG: unreadable dates fall back to what the resume stated', () => {
  // The regression this whole change exists for. History rows are present, but
  // none of their dates parsed, so totalMonths is 0 — the old code wrote "0" and
  // the Search Candidate page showed 0 years for an 8-year candidate.
  const { totalMonths } = summariseEmploymentHistory([
    { CompanyName: 'Acme', StartDate: 'Sometime', EndDate: 'Later' },
    { CompanyName: 'Globex', StartDate: '', EndDate: '' },
  ]);
  assert.equal(totalMonths, 0);
  assert.equal(resolveExperienceYears(totalMonths, '8.5'), '8.5');
});

test('nothing computed and nothing stated yields null, not "0" or "2"', () => {
  // null is what getMissingFields() flags for follow-up. "0" reads as a genuine
  // fresher and is never chased; "2" was the old hardcoded default.
  assert.equal(resolveExperienceYears(0, null), null);
  assert.equal(resolveExperienceYears(0, undefined), null);
  assert.equal(resolveExperienceYears(0, ''), null);
});

test('a genuine fresher is preserved, not overwritten', () => {
  assert.equal(resolveExperienceYears(0, 'Fresher'), 'Fresher');
  assert.equal(resolveExperienceYears(0, '0'), '0');
  assert.equal(resolveExperienceYears(0, 0), '0');
});

// ── Storable range ────────────────────────────────────────────────────

test('isStorableExperience keeps ordinary readings', () => {
  assert.equal(isStorableExperience(0), true);
  assert.equal(isStorableExperience(0.5), true);
  assert.equal(isStorableExperience(8.5), true);
  assert.equal(isStorableExperience(999.99), true);
});

test('isStorableExperience rejects what Decimal(5,2) cannot hold', () => {
  // parseExperienceNumeric takes the first number in the string, so "since 2019"
  // yields 2019 — which Postgres rejects, and Prisma turns into a thrown create
  // that loses the whole candidate.
  assert.equal(isStorableExperience(2019), false);
  assert.equal(isStorableExperience(1000), false);
  assert.equal(isStorableExperience(-1), false);
  assert.equal(isStorableExperience(null), false);
  assert.equal(isStorableExperience(undefined), false);
  assert.equal(isStorableExperience(NaN), false);
  assert.equal(isStorableExperience(Infinity), false);
});
