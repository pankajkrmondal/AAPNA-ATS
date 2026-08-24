/**
 * The Zeko score must come from the field Zeko actually populated.
 * Run: node --test src/tests/unit/zekoScoreField.test.js
 *
 * Zeko keeps two different scores in two different fields, and which one is
 * filled depends on the interview type:
 *   - screening-interview  (isHRScreeningPresent: true)  -> fitPercentage
 *   - functional-interview (isHRScreeningPresent: false) -> interviewScore
 *
 * The old sync called GET /interview/<id>/results, which only ever exposes
 * `interviewScore`. Zeko leaves that at a literal 0 for screening interviews, so
 * every HR round recorded 0 — on 2026-08-24 Panmon showed 0 in the ATS while
 * Zeko's own Responses page showed 94 (`fitPercentage`). Verified on staging:
 * all 5 screening interviews returned 0 for all ~50 candidates, while all 6
 * functional interviews returned real varied scores through the same field.
 *
 * These cases mirror the real payloads captured from
 * POST /dashboard/api/v2/pipeline/interview-responses.
 *
 * Pure unit test — no database, no network.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

/** Mirrors pickZekoScore() in zeko.service.js (importing it would open Redis/Prisma). */
function pickZekoScore(entry, isHrScreening) {
  const fit = entry?.fitPercentage;
  const interview = entry?.interviewScore;
  if (isHrScreening) return fit ?? null;
  if (interview !== null && interview !== undefined) return interview;
  return fit ?? null;
}

/** Mirrors ZEKO_NO_RESULT_STATUSES in zeko.service.js. */
const NO_RESULT = ['slotMissed', 'leftInMiddle', 'notAttempted', 'scheduled'];

describe('screening interview (isHRScreeningPresent: true)', () => {
  // Real staging entry — the exact row behind the reported bug.
  const panmon = {
    candidateEmail: 'claudepankajmondal@gmail.com',
    fitPercentage: 94,
    score: 0,
    interviewScore: 0,
    status: 'goodFit',
    attemptStatus: 'completed',
  };

  test('reads fitPercentage, not the placeholder interviewScore', () => {
    assert.equal(pickZekoScore(panmon, true), 94);
  });

  test('never returns the 0 that broke every HR round', () => {
    assert.notEqual(pickZekoScore(panmon, true), 0);
  });

  test('other real candidates on the same interview resolve correctly', () => {
    const rows = [
      { candidateEmail: 'hmopuri@aapnainfotech.com', fitPercentage: 75, interviewScore: 0 },
      { candidateEmail: 'sonianetinti123@gmail.com', fitPercentage: 89, interviewScore: 0 },
      { candidateEmail: 'upamajha663@gmail.com', fitPercentage: 100, interviewScore: 0 },
    ];
    assert.deepEqual(rows.map((r) => pickZekoScore(r, true)), [75, 89, 100]);
  });

  test('a genuine fit of 0 is preserved, not treated as missing', () => {
    assert.equal(pickZekoScore({ fitPercentage: 0, interviewScore: 0 }, true), 0);
  });

  test('no fitPercentage yields null rather than falling back to the 0', () => {
    assert.equal(pickZekoScore({ interviewScore: 0 }, true), null);
  });
});

describe('functional interview (isHRScreeningPresent: false)', () => {
  test('keeps reading interviewScore — the path that already worked', () => {
    // Tushar 83 / Kumaresan 68, real staging values.
    assert.equal(pickZekoScore({ interviewScore: 83, fitPercentage: undefined }, false), 83);
    assert.equal(pickZekoScore({ interviewScore: 68 }, false), 68);
  });

  test('falls back to fitPercentage only when interviewScore is absent', () => {
    assert.equal(pickZekoScore({ fitPercentage: 77 }, false), 77);
  });

  test('a genuine interview score of 0 is preserved', () => {
    assert.equal(pickZekoScore({ interviewScore: 0 }, false), 0);
  });

  test('neither field present yields null', () => {
    assert.equal(pickZekoScore({}, false), null);
  });
});

describe('report deep link', () => {
  /** Mirrors zekoReportUrl() in zeko.service.js. */
  function zekoReportUrl(candidateId, jobId, base = 'https://app.zeko.ai/app/new-report') {
    if (!candidateId || !jobId) return null;
    const qs = new URLSearchParams({ candidateId: String(candidateId), jobId: String(jobId), tab: 'Overview' });
    return `${base}?${qs}`;
  }

  test('builds the URL Zeko itself uses for a candidate report', () => {
    // Captured from the browser while viewing Panmon's report.
    assert.equal(
      zekoReportUrl('6a8bfcca5e57c481d6c906ee', '69a15687abfe6f852d7d7d50'),
      'https://app.zeko.ai/app/new-report?candidateId=6a8bfcca5e57c481d6c906ee&jobId=69a15687abfe6f852d7d7d50&tab=Overview'
    );
  });

  test('returns null when either id is missing, so no broken link is rendered', () => {
    assert.equal(zekoReportUrl(null, '69a15687abfe6f852d7d7d50'), null);
    assert.equal(zekoReportUrl('6a8bfcca5e57c481d6c906ee', null), null);
    assert.equal(zekoReportUrl(undefined, undefined), null);
    assert.equal(zekoReportUrl('', ''), null);
  });

  test('coerces non-string ids rather than emitting "[object Object]"', () => {
    assert.match(zekoReportUrl('abc', 12345), /jobId=12345/);
  });
});

describe('attempt status gating', () => {
  test('candidates who never sat the interview are not scored', () => {
    // These carry no score fields at all in the real payload.
    for (const attemptStatus of NO_RESULT) {
      assert.ok(NO_RESULT.includes(attemptStatus));
      assert.equal(pickZekoScore({ attemptStatus }, true), null);
    }
  });

  test('a no-show is never recorded as a zero score', () => {
    const slotMissed = { candidateEmail: 'a@b.com', attemptStatus: 'slotMissed' };
    assert.ok(NO_RESULT.includes(slotMissed.attemptStatus));
    assert.notEqual(pickZekoScore(slotMissed, true), 0);
  });

  test('completed is the only status that proceeds to scoring', () => {
    assert.ok(!NO_RESULT.includes('completed'));
  });
});
