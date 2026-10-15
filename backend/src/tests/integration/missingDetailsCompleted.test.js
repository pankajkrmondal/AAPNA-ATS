/**
 * Missing-details completed: dates, reminder close-out and bell alert
 * (Phase 3 "Do Now", N44). Run one file at a time:
 *
 *   node src/tests/run-block.mjs src/tests/integration/missingDetailsCompleted.test.js
 *
 * Drives the real public handler (submitPublicMissingData) with a fake
 * req/res — no HTTP, no Turnstile — and asserts on the database rows it
 * leaves behind. Everything it creates is tagged and torn down by EXPLICIT ID.
 *
 * What it pins down:
 *   - a partial submission records no completion date, rings no bell and
 *     leaves the reminder rows open;
 *   - the completing submission stamps details_completed_at once, closes the
 *     data_collection / missing_jd rows (and ONLY those), and writes exactly
 *     one notification per active staff user and none for a vendor;
 *   - a later submission moves nothing and notifies nobody;
 *   - the bell links to the live pipeline card when there is one;
 *   - Search Candidate's "Details completed in" filter finds the candidate.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import prisma from '../../config/database.js';
import { disconnectRedis } from '../../config/redis.js';
import { submitPublicMissingData } from '../../controllers/candidate.controller.js';
import * as candidateService from '../../services/candidate.service.js';
import { NOTIFICATION_TYPES } from '../../services/notification.service.js';

const TAG = 'N44-DETAILS-COMPLETED-FIXTURE';
const DAY = 24 * 60 * 60 * 1000;

const ids = { cvs: [], users: [], logs: [], pipelines: [] };

/** Calls the Express handler and resolves with the JSON body, or rejects with the AppError. */
function submit(email, body) {
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

async function makeCv(suffix, extra = {}) {
  const cv = await prisma.rpa_cv.create({
    data: {
      Name: `N44 Fixture ${suffix}`,
      EmailID: `n44.fixture.${suffix}@example.invalid`,
      PositionApplied: 'Java Developer',
      MetaData: TAG,
      statusActive: 'INACTIVE',
      missingData: JSON.stringify({ CurrentLocation: 'Null', NoticePeriod: 'Null' }),
      cvMissingToken: Buffer.from(`n44.fixture.${suffix}@example.invalid`).toString('base64'),
      cvMissingTokenStatus: 'SENT',
      details_requested_at: new Date(Date.now() - 12 * DAY),
      createdAt: new Date(),
      ...extra,
    },
  });
  ids.cvs.push(cv.id);
  return cv;
}

async function makeLog(cv, emailType) {
  const row = await prisma.rpa_email_log.create({
    data: {
      email_type: emailType,
      recipient_email: cv.EmailID,
      recipient_name: cv.Name,
      subject: `${TAG} ${emailType}`,
      reference_id: Number(cv.id),
      sent_at: new Date(Date.now() - 12 * DAY),
    },
  });
  ids.logs.push(row.id);
  return row;
}

async function makeUser(role) {
  const u = await prisma.rpa_users.create({
    data: {
      username: `n44-fixture-${role}-${Date.now()}`,
      email: `n44-fixture-${role}-${Date.now()}@example.invalid`,
      password_hash: 'x:y',
      role,
      is_active: true,
      is_approved: true,
      first_name: 'N44',
      last_name: role,
    },
  });
  ids.users.push(u.id);
  return u;
}

const notesFor = (cvId) => prisma.rpa_notifications.findMany({
  where: { type: NOTIFICATION_TYPES.CANDIDATE_DETAILS_COMPLETED, meta: { path: ['cvId'], equals: Number(cvId) } },
});

describe('N44 missing-details completed', () => {
  let recruiter;
  let vendor;
  let staffCount;

  before(async () => {
    recruiter = await makeUser('recruiter');
    vendor = await makeUser('vendor');
    staffCount = await prisma.rpa_users.count({
      where: { role: { in: ['recruiter', 'hr', 'admin', 'superadmin'] }, is_active: true, is_approved: true },
    });
  });

  after(async () => {
    await prisma.rpa_notifications.deleteMany({ where: { user_id: { in: ids.users } } });
    for (const cvId of ids.cvs) {
      await prisma.rpa_notifications.deleteMany({ where: { meta: { path: ['cvId'], equals: Number(cvId) } } });
    }
    await prisma.rpa_candidate_pipeline.deleteMany({ where: { id: { in: ids.pipelines } } });
    await prisma.rpa_email_log.deleteMany({ where: { id: { in: ids.logs } } });
    await prisma.rpa_cv.deleteMany({ where: { id: { in: ids.cvs } } });
    await prisma.rpa_users.deleteMany({ where: { id: { in: ids.users } } });
    await prisma.$disconnect();
    await disconnectRedis().catch(() => {});
  });

  test('partial → complete → resubmit', async () => {
    const cv = await makeCv('a');
    const dataLog = await makeLog(cv, 'data_collection');
    const legacyLog = await makeLog(cv, 'missing_jd');
    const otherLog = await makeLog(cv, 'welcome');

    // 1) Partial: one of two fields.
    const r1 = await submit(cv.EmailID, { CurrentLocation: 'Noida' });
    assert.equal(r1.status, 200);
    let row = await prisma.rpa_cv.findUnique({ where: { id: cv.id } });
    assert.equal(row.details_completed_at, null, 'partial submission must not complete');
    assert.notEqual(row.cvMissingTokenStatus, 'RECEIVED');
    assert.equal((await notesFor(cv.id)).length, 0, 'partial submission must not ring the bell');
    assert.equal((await prisma.rpa_email_log.findUnique({ where: { id: dataLog.id } })).responded_at, null);

    // 2) Completing submission.
    const before = Date.now();
    await submit(cv.EmailID, { NoticePeriod: '30' });
    row = await prisma.rpa_cv.findUnique({ where: { id: cv.id } });
    assert.ok(row.details_completed_at, 'completion date stamped');
    assert.ok(row.details_completed_at.getTime() >= before - 1000);
    assert.equal(row.cvMissingTokenStatus, 'RECEIVED');

    const logs = await prisma.rpa_email_log.findMany({ where: { id: { in: [dataLog.id, legacyLog.id, otherLog.id] } } });
    const byType = Object.fromEntries(logs.map((l) => [l.email_type, l]));
    assert.ok(byType.data_collection.responded_at, 'data_collection row closed');
    assert.ok(byType.missing_jd.responded_at, 'missing_jd row closed');
    assert.equal(byType.welcome.responded_at, null, 'unrelated email rows are left alone');

    const notes = await notesFor(cv.id);
    assert.equal(notes.length, staffCount, 'one notification per active staff user');
    assert.ok(notes.some((n) => n.user_id === recruiter.id), 'the recruiter is told');
    assert.ok(!notes.some((n) => n.user_id === vendor.id), 'vendors are never told');
    const mine = notes.find((n) => n.user_id === recruiter.id);
    assert.equal(mine.title, 'N44 Fixture a completed their missing details');
    assert.match(mine.description, /^Java Developer · requested \d{2} [A-Z][a-z]{2} \d{4} · responded in 12 days$/);
    assert.equal(mine.link_path, `/candidates/${Number(cv.id)}`, 'no journey → candidate page');
    assert.equal(mine.pipeline_id, null);

    // 3) Resubmission after completion: nothing moves, nobody is told again.
    const firstDate = row.details_completed_at.getTime();
    await submit(cv.EmailID, { LinkedInProfile: 'https://example.invalid/n44' });
    row = await prisma.rpa_cv.findUnique({ where: { id: cv.id } });
    assert.equal(row.details_completed_at.getTime(), firstDate, 'completion date never moves');
    assert.equal((await notesFor(cv.id)).length, staffCount, 'no second alert');
  });

  test('a candidate in a live journey links to their pipeline card', async () => {
    const cv = await makeCv('b', { missingData: JSON.stringify({ NoticePeriod: 'Null' }) });
    const journey = await prisma.rpa_candidate_pipeline.create({
      data: { cv_id: cv.id, current_stage_key: 'zeko_hr', source: 'recruiter' },
    });
    ids.pipelines.push(journey.id);

    await submit(cv.EmailID, { NoticePeriod: '15' });
    const mine = (await notesFor(cv.id)).find((n) => n.user_id === recruiter.id);
    assert.equal(mine.link_path, `/pipeline?candidate=${Number(journey.id)}`);
    assert.equal(Number(mine.pipeline_id), Number(journey.id));
  });

  test('"Details completed in" filter and order on the candidate list', async () => {
    const today = await candidateService.search({ completedWithin: 'today' }, 1, 200, 'detailsCompletedAt', 'desc');
    const found = today.data.filter((c) => String(c.email).startsWith('n44.fixture.'));
    assert.deepEqual(found.map((c) => c.email), ['n44.fixture.b@example.invalid', 'n44.fixture.a@example.invalid'],
      'both fixtures completed today, newest completion first');
    assert.ok(found.every((c) => c.detailsCompletedAt && c.detailsRequestedAt), 'both dates are on the list rows');

    // An unknown value is "no filter", never an error.
    const any = await candidateService.search({ completedWithin: 'bogus', name: 'N44 Fixture' }, 1, 50);
    assert.equal(any.total, 2);
  });
});
