/**
 * A Zeko round must never show another candidate's score or report link.
 * Run: node --test src/tests/unit/zekoResultAttribution.test.js
 *
 * rpa_zeko_interview_results.pipeline_id is Zeko's INTERVIEW id, which belongs
 * to the JOB — every candidate booked against that job shares it. The pipeline
 * drawer used to read that table by pipeline_id alone, so it returned whichever
 * candidate synced most recently. On 2026-08-24 that rendered Samarth Tiwari's
 * score (0) and his Zeko report link on Haris M's HR round: a wrong number AND
 * a cross-candidate leak of a stranger's report. The lookup now also matches on
 * the candidate's own address.
 *
 * Pure unit test — no database, no network.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { emailCandidates } from '../../utils/emailMatch.js';

/**
 * The predicate the fixed Prisma filter encodes: same interview, and the row's
 * candidate_email is one of this candidate's addresses (case-insensitively).
 */
function selectResult(results, zekoPipelineRow) {
  const wanted = emailCandidates(zekoPipelineRow.candidate_email);
  if (wanted.length === 0) return null;
  return (
    results
      .filter(
        (r) =>
          r.pipeline_id === zekoPipelineRow.pipeline_id &&
          wanted.includes(String(r.candidate_email || '').trim().toLowerCase())
      )
      .sort((a, b) => b.created_at - a.created_at)[0] || null
  );
}

describe('emailCandidates', () => {
  test('splits multi-address columns and lower-cases them', () => {
    assert.deepEqual(emailCandidates('A@x.com, b@Y.com'), ['a@x.com', 'b@y.com']);
    assert.deepEqual(emailCandidates('a@x.com;b@y.com'), ['a@x.com', 'b@y.com']);
  });

  test('is empty for a missing address rather than matching everything', () => {
    assert.deepEqual(emailCandidates(null), []);
    assert.deepEqual(emailCandidates(''), []);
    assert.deepEqual(emailCandidates('  ,  '), []);
  });

  test('de-duplicates repeated addresses', () => {
    assert.deepEqual(emailCandidates('a@x.com, A@X.COM'), ['a@x.com']);
  });
});

describe('Zeko result attribution', () => {
  // The real staging shape: one interview id, two candidates booked on it, and
  // only the other candidate has ever synced a result.
  const INTERVIEW = '69a6e772eeff4e656e571638';
  const strangersResult = {
    candidate_name: 'Samarth Tiwari',
    candidate_email: 'tiwarineelanshu99@gmail.com',
    scores_overallscore: 0,
    reportlink: 'https://app.zeko.ai/app/shared-report?linkId=stranger',
    pipeline_id: INTERVIEW,
    created_at: new Date('2026-06-13T16:05:02Z'),
  };
  const haris = { candidate_email: 'hmopuri@aapnainfotech.com', pipeline_id: INTERVIEW };

  test("does not return another candidate's result on the same interview", () => {
    assert.equal(selectResult([strangersResult], haris), null);
  });

  test("returns the candidate's own result when it exists", () => {
    const own = {
      candidate_name: 'Haris M',
      candidate_email: 'HMopuri@aapnainfotech.com', // Zeko may report a different case
      scores_overallscore: 74,
      reportlink: 'https://app.zeko.ai/app/shared-report?linkId=haris',
      pipeline_id: INTERVIEW,
      created_at: new Date('2026-08-24T13:00:00Z'),
    };
    const picked = selectResult([strangersResult, own], haris);
    assert.equal(picked?.scores_overallscore, 74);
    assert.match(picked.reportlink, /linkId=haris/);
  });

  test('matches when the stored column holds several joined addresses', () => {
    const own = {
      candidate_email: 'ragaiuserpankajmondal@gmail.com',
      scores_overallscore: 61,
      pipeline_id: INTERVIEW,
      created_at: new Date('2026-08-24T13:00:00Z'),
    };
    const row = {
      candidate_email: 'claudepankajmondal@gmail.com, ragaiuserpankajmondal@gmail.com',
      pipeline_id: INTERVIEW,
    };
    assert.equal(selectResult([strangersResult, own], row)?.scores_overallscore, 61);
  });

  test('returns nothing when we hold no address to match on', () => {
    assert.equal(selectResult([strangersResult], { candidate_email: null, pipeline_id: INTERVIEW }), null);
  });

  test('a result from a different interview is never picked up', () => {
    const otherInterview = { ...strangersResult, candidate_email: haris.candidate_email, pipeline_id: 'someOtherInterview' };
    assert.equal(selectResult([otherInterview], haris), null);
  });
});
