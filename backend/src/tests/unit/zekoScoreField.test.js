/**
 * The Zeko score must come from the field Zeko actually populated, in the report.
 * Run: node --test src/tests/unit/zekoScoreField.test.js
 *
 * History. The sync first read GET /interview/<id>/results, which exposes only
 * `interviewScore` — a literal 0 for screening interviews, so every HR round
 * recorded 0 while Zeko showed 94/95. It then moved to the responses LIST
 * endpoint and read `fitPercentage`, which fixed HR — but that endpoint reports
 * `interviewScore: 0` for functional rounds too, so those stayed broken (four
 * completed candidates read 0 there while their reports held 1, 61, 56, 65).
 *
 * The per-candidate report API is the only source correct for every round type,
 * and each type carries its score in a different field:
 *
 *   round type    fit_percentage   codingScore   totalScore
 *   HR screening       95            absent          0      <- junk
 *   coding           absent            61            61     <- duplicate
 *   panel            absent          absent          79
 *
 * All three mean "this round's headline score" — Zeko's own UI labels them
 * Recruiter Screening / Coding Score / Interview Score. None is a communication
 * score, so ZekoCommunicationScore has no source and must stay null.
 *
 * Pure unit test — no database, no network.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

/** Mirrors pickZekoScore() in zeko.service.js (importing it would open Redis/Prisma). */
function pickZekoScore(report) {
  const fit = report?.hr_screening_evaluation?.fit_percentage;
  const coding = report?.coding_evaluation?.codingScore;
  const total = report?.totalScore;
  const interview = fit ?? coding ?? (total || null);
  return {
    interview: interview === undefined ? null : interview,
    coding: coding === undefined ? null : coding,
    communication: null,
  };
}

/** Mirrors ZEKO_NO_RESULT_STATUSES in zeko.service.js. */
const NO_RESULT = ['slotMissed', 'leftInMiddle', 'notAttempted', 'scheduled'];

// Real staging payloads, trimmed to the fields that matter.
const HR_REPORT = {
  name: 'Pankaj Mondal AI',
  hr_screening_evaluation: { fit: 'Strong Fit', fit_percentage: 95 },
  totalScore: 0, // not applicable on an HR round
  aitScore: 0,
  completionStatus: 'completed',
};
const CODING_REPORT = {
  name: 'Pankaj Mondal AI',
  coding_evaluation: { codingScore: 1, codingMaxScore: 100 },
  totalScore: 1, // duplicate of codingScore
  aitScore: 0,
  completionStatus: 'completed',
};
const PANEL_REPORT = {
  name: 'Shabahat Azki',
  totalScore: 79,
  aitScore: 79,
  completionStatus: 'completed',
};

describe('HR screening report', () => {
  test('reads fit_percentage as the headline score', () => {
    assert.equal(pickZekoScore(HR_REPORT).interview, 95);
  });

  test("does not record totalScore's not-applicable 0 anywhere", () => {
    const s = pickZekoScore(HR_REPORT);
    assert.notEqual(s.interview, 0);
    assert.equal(s.coding, null);
    assert.equal(s.communication, null);
  });

  test('other real candidates on the same interview resolve correctly', () => {
    const scores = [75, 89, 100, 94].map((fit) =>
      pickZekoScore({ hr_screening_evaluation: { fit_percentage: fit } }).interview
    );
    assert.deepEqual(scores, [75, 89, 100, 94]);
  });
});

describe('coding / functional report', () => {
  test('reads codingScore — the value the responses list reported as 0', () => {
    assert.equal(pickZekoScore(CODING_REPORT).interview, 1);
  });

  test('fills both interview and coding from the one real number', () => {
    const s = pickZekoScore(CODING_REPORT);
    assert.equal(s.interview, 1);
    assert.equal(s.coding, 1);
    assert.equal(s.communication, null);
  });

  test('the four staging candidates all resolve to their real scores', () => {
    const scores = [1, 61, 56, 65].map((c) =>
      pickZekoScore({ coding_evaluation: { codingScore: c }, totalScore: c }).interview
    );
    assert.deepEqual(scores, [1, 61, 56, 65]);
  });
});

describe('panel / competency report', () => {
  test('reads totalScore when it is the only score present', () => {
    assert.equal(pickZekoScore(PANEL_REPORT).interview, 79);
  });

  test('leaves coding null — a panel round has no coding score', () => {
    assert.equal(pickZekoScore(PANEL_REPORT).coding, null);
  });
});

describe('the newEvaluation trap', () => {
  test('never reads newEvaluation.overallScore, which disagrees with the UI', () => {
    // Real payload: the UI gauge shows 79 (totalScore) while newEvaluation
    // .overallScore is 49. Reading it would show 49 in the ATS against 79 in Zeko.
    const withTrap = { ...PANEL_REPORT, newEvaluation: { overallScore: 49 } };
    assert.equal(pickZekoScore(withTrap).interview, 79);
    assert.notEqual(pickZekoScore(withTrap).interview, 49);
  });

  test('never reads aitScore, which is 0 on HR and coding rounds', () => {
    // aitScore mirrors totalScore on panel rounds but is 0 elsewhere.
    assert.equal(pickZekoScore({ ...HR_REPORT, aitScore: 0 }).interview, 95);
    assert.equal(pickZekoScore({ ...CODING_REPORT, aitScore: 0 }).interview, 1);
  });
});

describe('edge cases', () => {
  test('a genuine 0 in fit_percentage survives', () => {
    assert.equal(pickZekoScore({ hr_screening_evaluation: { fit_percentage: 0 } }).interview, 0);
  });

  test('a genuine 0 in codingScore survives', () => {
    assert.equal(pickZekoScore({ coding_evaluation: { codingScore: 0 } }).interview, 0);
  });

  test('a lone totalScore of 0 is treated as "not applicable", not a score', () => {
    // This is the HR/coding shape stripped of its real field — nothing to record.
    assert.equal(pickZekoScore({ totalScore: 0 }).interview, null);
  });

  test('an empty or missing report yields nulls, never a number', () => {
    for (const r of [{}, null, undefined]) {
      const s = pickZekoScore(r);
      assert.equal(s.interview, null);
      assert.equal(s.coding, null);
      assert.equal(s.communication, null);
    }
  });

  test('communication is always null — Zeko exposes no such score', () => {
    for (const r of [HR_REPORT, CODING_REPORT, PANEL_REPORT]) {
      assert.equal(pickZekoScore(r).communication, null);
    }
  });
});

describe('attempt status gating', () => {
  test('no-show statuses are the ones that must never be scored', () => {
    for (const s of ['slotMissed', 'leftInMiddle', 'notAttempted', 'scheduled']) {
      assert.ok(NO_RESULT.includes(s));
    }
  });

  test('completed is not gated out', () => {
    assert.ok(!NO_RESULT.includes('completed'));
  });

  test('a missing report (HTTP 410) is modelled as null, not as a zero score', () => {
    // fetchCandidateReport returns null on 410 — every slotMissed candidate.
    assert.equal(pickZekoScore(null).interview, null);
  });
});
