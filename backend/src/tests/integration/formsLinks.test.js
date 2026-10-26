/**
 * L08 — Forms & Links: the list, Copy and the access rules (staging DB).
 *
 *   node src/tests/run-block.mjs src/tests/integration/formsLinks.test.js
 *
 *   - the list carries each fixture link with its status and actions, and no
 *     URL or token anywhere
 *   - Copy returns the URL and a message, and notes the copy on the timeline;
 *     an expired scorecard is refused (renew it instead)
 *   - MRF approval links are never copied (D3)
 *   - without the recruitment_pipeline module, only MRF and standing rows show
 *   - ?mrfRequest= finds the hiring manager's form link before an MRF exists;
 *     its copy is logged in the processing log
 *   - "My candidates" keeps the journeys this user shortlisted (D7)
 *
 * No email is sent: Re-send and Renew are not called here (scorecardInvite is
 * operator-addressed, so it would reach a real inbox). Fixtures are tagged and
 * torn down by explicit id.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import prisma from '../../config/database.js';
import { disconnectRedis } from '../../config/redis.js';
import { shortlistCandidates } from '../../services/screening.service.js';
import { copyLink, listLinks } from '../../services/formsLinks.service.js';

const TAG = 'L08-FORMS-FIXTURE';
const ADMIN = { id: 0, username: 'l08-forms-test', role: 'admin', email: null };
// A recruiter with no module rows at all: id 0 has none.
const NO_PIPELINE = { id: 0, username: 'l08-no-pipeline', role: 'recruiter', email: null };
const DAY = 86400000;
const made = { cvs: [], mrfs: [], requests: [] };

describe('L08 — Forms & Links', () => {
  let jd;
  let journey;
  let open;
  let expired;
  let request;

  before(async () => {
    jd = await prisma.rpa_mrf.create({
      data: { position_hiring_for: `L08 QA Engineer ${Date.now()}`, number_of_positions: 1, approval_status: 'approved', additional_information: TAG },
    });
    made.mrfs.push(jd.id);
    const cv = await prisma.rpa_cv.create({
      data: { Name: 'L08 Linkholder', EmailID: 'l08.linkholder@example.invalid', MetaData: TAG, statusActive: 'ACTIVE', createdAt: new Date() },
    });
    made.cvs.push(cv.id);
    const r = await shortlistCandidates([{ id: Number(cv.id) }], Number(jd.id), '', { ...ADMIN, id: null }, { sendEmail: false, source: 'search_candidate' });
    assert.equal(r.shortlisted, 1, 'fixture shortlist');
    const shortlist = await prisma.rpa_shortlisted_candidates.findFirst({ where: { cv_id: cv.id, mrf_id: jd.id } });
    journey = await prisma.rpa_candidate_pipeline.findFirst({ where: { shortlist_id: shortlist.id } });

    const start = new Date(Date.now() - 10 * DAY);
    const schedule = await prisma.rpa_interview_schedule.create({
      data: { pipeline_id: journey.id, stage_key: 'tech1', scheduled_start_at: start, scheduled_end_at: new Date(start.getTime() + 3600000) },
    });
    open = await prisma.rpa_interview_scorecard.create({
      data: {
        schedule_id: schedule.id, pipeline_id: journey.id, stage_key: 'tech1',
        recipient_email: 'l08.panel.open@example.invalid', recipient_name: 'L08 Open Panel',
        sent_at: new Date(Date.now() - DAY), token_expires_at: new Date(Date.now() + 5 * DAY),
      },
    });
    expired = await prisma.rpa_interview_scorecard.create({
      data: {
        schedule_id: schedule.id, pipeline_id: journey.id, stage_key: 'tech1',
        recipient_email: 'l08.panel.lapsed@example.invalid', recipient_name: 'L08 Lapsed Panel',
        sent_at: new Date(Date.now() - 9 * DAY), token_expires_at: new Date(Date.now() - 2 * DAY),
      },
    });
    request = await prisma.rpa_mrf_jd_send.create({
      data: {
        first_name: 'L08', last_name: 'Manager', email: 'l08.manager@example.invalid',
        role: `L08 Role ${Date.now()}`, jd_doc_link: 'https://onedrive.example.invalid/l08.pdf', mrfstatus: 'pending',
      },
    });
    made.requests.push(request.id);
  });

  after(async () => {
    const pIds = journey ? [journey.id] : [];
    await prisma.rpa_interview_scorecard.deleteMany({ where: { pipeline_id: { in: pIds } } });
    await prisma.rpa_interview_schedule.deleteMany({ where: { pipeline_id: { in: pIds } } });
    await prisma.rpa_pipeline_stage_state.deleteMany({ where: { pipeline_id: { in: pIds } } }).catch(() => {});
    await prisma.rpa_pipeline_stage_events.deleteMany({ where: { pipeline_id: { in: pIds } } });
    await prisma.rpa_notifications.deleteMany({ where: { pipeline_id: { in: pIds } } });
    await prisma.rpa_candidate_pipeline.deleteMany({ where: { id: { in: pIds } } });
    await prisma.rpa_shortlisted_candidates.deleteMany({ where: { cv_id: { in: made.cvs } } });
    await prisma.rpa_candidate_mrf_tags.deleteMany({ where: { cv_id: { in: made.cvs } } });
    await prisma.rpa_cv.deleteMany({ where: { id: { in: made.cvs } } });
    for (const id of made.requests) {
      await prisma.rpa_processing_log.deleteMany({ where: { source: 'FORMS_LINKS_COPY', logMessage: { contains: `(mrf_form ${id})` } } });
    }
    await prisma.rpa_mrf_jd_send.deleteMany({ where: { id: { in: made.requests } } });
    await prisma.rpa_mrf.deleteMany({ where: { id: { in: made.mrfs } } });
    await prisma.$disconnect();
    await disconnectRedis().catch(() => {});
  });

  test('the list shows both scorecards with status and actions, and never a URL or token', async () => {
    const r = await listLinks(ADMIN, { candidate: journey.id, states: 'all', pageSize: 50 });
    const byId = Object.fromEntries(r.rows.filter((x) => x.type === 'scorecard').map((x) => [String(x.id), x]));
    const live = byId[String(open.id)];
    const lapsed = byId[String(expired.id)];
    assert.ok(live && lapsed, 'both fixture scorecards are listed');
    assert.deepEqual([live.state, live.status, live.actions], ['open', 'Waiting', ['copy', 'resend']]);
    assert.deepEqual([lapsed.state, lapsed.status, lapsed.actions], ['expired', 'Expired', ['renew']]);
    assert.equal(live.candidate.name, 'L08 Linkholder');
    assert.equal(live.mrfRef, `MRF-${Number(jd.id)}`);

    const json = JSON.stringify(r.rows);
    assert.ok(!json.includes(open.token) && !json.includes(expired.token), 'no token in the list');
    assert.ok(!/\/scorecard\//.test(json), 'no scorecard URL in the list');
    assert.ok(r.seePipeline);
    assert.equal(r.tabCounts.interviewers >= 2, true);
  });

  test('Copy returns the URL and a message, and notes the copy on the timeline', async () => {
    const before = await prisma.rpa_pipeline_stage_events.count({ where: { pipeline_id: journey.id, event_type: 'note' } });
    const c = await copyLink('scorecard', open.id, ADMIN);
    assert.ok(c.url.endsWith(`/scorecard/${open.token}`));
    assert.ok(c.message.includes(c.url));
    assert.match(c.message, /^Hi L08, here is the scorecard for L08 Linkholder's /);

    const opened = await copyLink('scorecard', open.id, ADMIN, { purpose: 'open' });
    assert.equal(opened.url, c.url);

    const notes = await prisma.rpa_pipeline_stage_events.findMany({
      where: { pipeline_id: journey.id, event_type: 'note' }, orderBy: { id: 'asc' },
    });
    assert.equal(notes.length, before + 2);
    assert.match(notes[notes.length - 2].notes, /link copied by l08-forms-test \(Forms & Links\)\.$/);
    assert.match(notes[notes.length - 1].notes, /link opened by l08-forms-test \(Forms & Links\)\.$/);
  });

  test('an expired scorecard is not copied, and approval links never are', async () => {
    const notesBefore = await prisma.rpa_pipeline_stage_events.count({ where: { pipeline_id: journey.id, event_type: 'note' } });
    await assert.rejects(copyLink('scorecard', expired.id, ADMIN), (err) => err.statusCode === 409 && /Renew it instead/.test(err.message));
    await assert.rejects(copyLink('mrf_approval', 1, ADMIN), (err) => err.statusCode === 403);
    assert.equal(await prisma.rpa_pipeline_stage_events.count({ where: { pipeline_id: journey.id, event_type: 'note' } }), notesBefore);
  });

  test('without the pipeline module: MRF rows only, and pipeline links are refused', async () => {
    const r = await listLinks(NO_PIPELINE, { states: 'all', pageSize: 100000 });
    assert.equal(r.seePipeline, false);
    assert.ok(r.rows.every((x) => x.type === 'mrf_form' || x.type === 'mrf_approval'), 'only MRF rows');
    await assert.rejects(copyLink('scorecard', open.id, NO_PIPELINE), (err) => err.statusCode === 403);
  });

  test('with the pipeline module, a recruiter sees the pipeline links', async (t) => {
    // Read-only: borrows the id of any account that has the module switched on.
    const perm = await prisma.rpa_module_permissions.findFirst({ where: { module_key: 'recruitment_pipeline', is_enabled: true } });
    if (!perm) { t.skip('no account on staging has the recruitment_pipeline module'); return; }
    const recruiter = { id: perm.user_id, username: 'l08-with-pipeline', role: 'recruiter', email: null };
    const r = await listLinks(recruiter, { candidate: journey.id, states: 'all' });
    assert.equal(r.seePipeline, true);
    assert.ok(r.rows.some((x) => String(x.id) === String(open.id)), 'the scorecard is listed');
  });

  test('?mrfRequest= finds the hiring manager form before an MRF exists; its copy is logged', async () => {
    const r = await listLinks(ADMIN, { mrfRequest: request.id, states: 'all' });
    assert.equal(r.total, 1);
    const [form] = r.rows;
    assert.deepEqual([form.type, form.state, form.mrfRef, form.recipientEmail], ['mrf_form', 'open', 'not raised yet', 'l08.manager@example.invalid']);

    const c = await copyLink('mrf_form', request.id, NO_PIPELINE);
    assert.match(c.url, /\/mrf-submit\?role=L08%20Role%20\d+&emailid=l08\.manager%40example\.invalid$/);
    const logged = await prisma.rpa_processing_log.count({ where: { source: 'FORMS_LINKS_COPY', logMessage: { contains: `(mrf_form ${request.id}) copied by l08-no-pipeline` } } });
    assert.equal(logged, 1);
  });

  test('"My candidates" keeps the journeys this user shortlisted (D7)', async () => {
    const mine = await listLinks(ADMIN, { candidate: journey.id, states: 'all', mine: 'true' });
    assert.ok(mine.rows.some((x) => String(x.id) === String(open.id)), 'shortlisted by this user');
    const theirs = await listLinks({ ...ADMIN, username: 'someone-else' }, { candidate: journey.id, states: 'all', mine: 'true' });
    assert.equal(theirs.rows.filter((x) => x.type === 'scorecard').length, 0);
  });
});
