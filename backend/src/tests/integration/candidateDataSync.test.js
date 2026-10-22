/**
 * Candidate data sync, both directions (N29). Run one file at a time:
 *
 *   node src/tests/run-block.mjs src/tests/integration/candidateDataSync.test.js
 *
 * Drives the real service and handler against the database and asserts on the
 * rows they leave behind. Everything it creates is tagged and torn down by
 * EXPLICIT ID.
 *
 * What it pins down:
 *   - a Search Candidate edit of name and email reaches the pipeline's copy
 *     (the board and drawer read it), and the old address is kept for inbox
 *     matching;
 *   - the public missing-details form's name change reaches it too, and a
 *     link sent before an email edit still opens the form;
 *   - Search Candidate can read the journey's pipeline scores;
 *   - a vendor is refused the edit.
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';

import prisma from '../../config/database.js';
import { disconnectRedis } from '../../config/redis.js';
import * as candidateService from '../../services/candidate.service.js';
import { getPipelineDetail, getCandidatePipelineScores } from '../../services/pipeline.service.js';
import { submitPublicMissingData, getPublicMissingData } from '../../controllers/candidate.controller.js';
import { requireStaff } from '../../middleware/auth.js';

const TAG = 'N29-CANDIDATE-SYNC-FIXTURE';
const ids = { cvs: [], shortlists: [], pipelines: [] };

async function makeCandidateInPipeline(suffix) {
  const email = `n29.fixture.${suffix}@example.invalid`;
  const cv = await prisma.rpa_cv.create({
    data: {
      Name: `N29 Fixture ${suffix}`,
      EmailID: email,
      PositionApplied: 'Java Developer',
      MetaData: TAG,
      statusActive: 'INACTIVE',
      missingData: JSON.stringify({ NoticePeriod: 'Null' }),
      cvMissingToken: Buffer.from(email).toString('base64'),
      cvMissingTokenStatus: 'SENT',
      createdAt: new Date(),
    },
  });
  ids.cvs.push(cv.id);
  const shortlist = await prisma.rpa_shortlisted_candidates.create({
    data: { cv_id: cv.id, candidate_name: cv.Name, candidate_email: email, position_applied: 'Java Developer', recruiter_notes: TAG },
  });
  ids.shortlists.push(shortlist.id);
  const journey = await prisma.rpa_candidate_pipeline.create({
    data: { cv_id: cv.id, shortlist_id: shortlist.id, current_stage_key: 'tech2', source: 'recruiter' },
  });
  ids.pipelines.push(journey.id);
  return { cv, shortlist, journey };
}

/** Calls the public missing-details handler; resolves with the JSON body. */
function submitMissing(email, body) {
  const token = Buffer.from(email).toString('base64');
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
    };
    submitPublicMissingData({ query: { token }, body, headers: {} }, res, reject);
  });
}

describe('N29 candidate data sync', () => {
  after(async () => {
    await prisma.rpa_candidate_pipeline.deleteMany({ where: { id: { in: ids.pipelines } } });
    await prisma.rpa_shortlisted_candidates.deleteMany({ where: { id: { in: ids.shortlists } } });
    await prisma.rpa_cv.deleteMany({ where: { id: { in: ids.cvs } } });
    await prisma.$disconnect();
    await disconnectRedis().catch(() => {});
  });

  test('a Search Candidate edit reaches the pipeline copy; the old address is kept', async () => {
    const { cv, shortlist, journey } = await makeCandidateInPipeline('a');

    await candidateService.update(cv.id, { name: 'N29 Fixture Renamed', email: 'n29.fixture.a2@example.invalid' }, { username: 'n29-test' });

    const row = await prisma.rpa_shortlisted_candidates.findUnique({ where: { id: shortlist.id } });
    assert.equal(row.candidate_name, 'N29 Fixture Renamed');
    assert.equal(row.candidate_email, 'n29.fixture.a2@example.invalid');
    assert.equal(row.candidate_email_all, 'n29.fixture.a@example.invalid', 'old address kept for the inbox view');

    const detail = await getPipelineDetail(journey.id);
    assert.equal(detail.pipeline.rpa_shortlisted_candidates.candidate_name, 'N29 Fixture Renamed', 'the drawer reads the new name');
  });

  test('an edit that changes neither name nor email leaves the copy alone', async () => {
    const { cv, shortlist } = await makeCandidateInPipeline('b');
    const before = await prisma.rpa_shortlisted_candidates.findUnique({ where: { id: shortlist.id } });
    await candidateService.update(cv.id, { location: 'Noida' }, { username: 'n29-test' });
    const after = await prisma.rpa_shortlisted_candidates.findUnique({ where: { id: shortlist.id } });
    assert.equal(after.modified_at?.getTime(), before.modified_at?.getTime());
  });

  test('the public missing-details form: a new name reaches the pipeline copy', async () => {
    const { cv, shortlist } = await makeCandidateInPipeline('c');
    const r = await submitMissing(cv.EmailID, { Name: 'N29 Fixture Self-Corrected', NoticePeriod: '30' });
    assert.equal(r.status, 200);
    const row = await prisma.rpa_shortlisted_candidates.findUnique({ where: { id: shortlist.id } });
    assert.equal(row.candidate_name, 'N29 Fixture Self-Corrected');
  });

  test('a missing-details link sent before an email edit still opens the form', async () => {
    const { cv } = await makeCandidateInPipeline('e');
    const oldToken = Buffer.from(cv.EmailID).toString('base64');
    await candidateService.update(cv.id, { email: 'n29.fixture.e2@example.invalid' }, { username: 'n29-test' });

    const r = await new Promise((resolve, reject) => {
      const res = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
      };
      getPublicMissingData({ query: { token: oldToken } }, res, reject);
    });
    assert.equal(r.status, 200, 'found by the token stored when the link was sent');
  });

  test('Search Candidate can read the journey and its (empty) pipeline scores', async () => {
    const { cv, journey } = await makeCandidateInPipeline('d');
    const journeys = await getCandidatePipelineScores(cv.id);
    assert.equal(journeys.length, 1);
    assert.equal(Number(journeys[0].pipeline_id), Number(journey.id));
    assert.deepEqual(journeys[0].rounds, [], 'no scores on file yet');
  });

  test('a vendor is refused the edit; a recruiter is let through', () => {
    let err;
    requireStaff({ user: { role: 'vendor' } }, {}, (e) => { err = e; });
    assert.equal(err?.statusCode, 403);
    let passed;
    requireStaff({ user: { role: 'recruiter' } }, {}, (e) => { passed = e === undefined; });
    assert.equal(passed, true);
  });
});
