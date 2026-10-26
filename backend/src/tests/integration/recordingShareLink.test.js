/**
 * L13 — the no-login link for ONE recording, from the drawer (staging DB).
 *
 *   node src/tests/run-block.mjs src/tests/integration/recordingShareLink.test.js
 *
 *   - the first request mints a link; the second hands back the SAME link and
 *     does not extend its expiry
 *   - the message carries the candidate, the round, the role and the JD link
 *   - each request writes a note on the candidate's timeline
 *   - a recording of another journey, and one with nothing to play, are refused
 *
 * No Graph call is made: minting never touches the recording's content. No
 * email is sent. Fixtures are tagged and torn down by explicit id.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import prisma from '../../config/database.js';
import { disconnectRedis } from '../../config/redis.js';
import { shortlistCandidates } from '../../services/screening.service.js';
import { shareLinkForRecording } from '../../services/recordingShare.service.js';

const TAG = 'L13-SHARE-FIXTURE';
const USER = { username: 'l13-share-test', id: null };
const JD = 'https://onedrive.example.invalid/l13-jd.pdf';
const made = { cvs: [], mrfs: [] };

async function journeyFor(name, jd) {
  const c = await prisma.rpa_cv.create({
    data: {
      Name: name, EmailID: `${name.toLowerCase().replace(/\s+/g, '.')}@example.invalid`,
      MetaData: TAG, statusActive: 'ACTIVE', createdAt: new Date(),
    },
  });
  made.cvs.push(c.id);
  const r = await shortlistCandidates([{ id: Number(c.id) }], Number(jd.id), '', USER, { sendEmail: false, source: 'search_candidate' });
  assert.equal(r.shortlisted, 1, `fixture shortlist for ${name}`);
  const shortlist = await prisma.rpa_shortlisted_candidates.findFirst({ where: { cv_id: c.id, mrf_id: jd.id } });
  return prisma.rpa_candidate_pipeline.findFirst({ where: { shortlist_id: shortlist.id } });
}

async function recordingOn(journey, { playable = true } = {}) {
  const start = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const schedule = await prisma.rpa_interview_schedule.create({
    data: {
      pipeline_id: journey.id, stage_key: 'tech1',
      scheduled_start_at: start, scheduled_end_at: new Date(start.getTime() + 60 * 60 * 1000),
    },
  });
  return prisma.rpa_interview_recording.create({
    data: {
      schedule_id: schedule.id, pipeline_id: journey.id, stage_key: 'tech1', kind: 'recording',
      graph_recording_id: `${TAG}-${journey.id}-${Date.now()}-${Math.random()}`,
      online_meeting_id: `${TAG}-meeting`,
      graph_content_url: playable ? 'https://graph.example.invalid/content' : null,
    },
  });
}

describe('L13 — share one recording with someone outside the ATS', () => {
  let jd;
  let journey;
  let recording;

  before(async () => {
    jd = await prisma.rpa_mrf.create({
      data: {
        position_hiring_for: `L13 Java Developer ${Date.now()}`, number_of_positions: 1,
        approval_status: 'approved', additional_information: TAG, jd_document_link: JD,
      },
    });
    made.mrfs.push(jd.id);
    journey = await journeyFor('L13 Sharer', jd);
    recording = await recordingOn(journey);
  });

  after(async () => {
    const pipes = await prisma.rpa_candidate_pipeline.findMany({ where: { cv_id: { in: made.cvs } }, select: { id: true } });
    const pIds = pipes.map((p) => p.id);
    await prisma.rpa_recording_share_link.deleteMany({ where: { pipeline_id: { in: pIds } } });
    await prisma.rpa_interview_recording.deleteMany({ where: { pipeline_id: { in: pIds } } });
    await prisma.rpa_interview_schedule.deleteMany({ where: { pipeline_id: { in: pIds } } });
    await prisma.rpa_pipeline_stage_state.deleteMany({ where: { pipeline_id: { in: pIds } } }).catch(() => {});
    await prisma.rpa_pipeline_stage_events.deleteMany({ where: { pipeline_id: { in: pIds } } });
    await prisma.rpa_notifications.deleteMany({ where: { pipeline_id: { in: pIds } } });
    await prisma.rpa_candidate_pipeline.deleteMany({ where: { id: { in: pIds } } });
    await prisma.rpa_shortlisted_candidates.deleteMany({ where: { cv_id: { in: made.cvs } } });
    await prisma.rpa_candidate_mrf_tags.deleteMany({ where: { cv_id: { in: made.cvs } } });
    await prisma.rpa_cv.deleteMany({ where: { id: { in: made.cvs } } });
    await prisma.rpa_mrf.deleteMany({ where: { id: { in: made.mrfs } } });
    await prisma.$disconnect();
    await disconnectRedis().catch(() => {});
  });

  test('mints once, then hands back the same link without extending it', async () => {
    const first = await shareLinkForRecording(journey.id, recording.id, USER);
    assert.equal(first.created, true);
    assert.match(first.url, /\/api\/recording-share\/[0-9a-f-]{36}$/);
    assert.match(first.summary, /^Live until /);

    const second = await shareLinkForRecording(journey.id, recording.id, USER);
    assert.equal(second.created, false);
    assert.equal(second.id, first.id);
    assert.equal(second.url, first.url);
    assert.equal(new Date(second.expires_at).getTime(), new Date(first.expires_at).getTime());

    const rows = await prisma.rpa_recording_share_link.findMany({ where: { recording_id: recording.id } });
    assert.equal(rows.length, 1, 'one live link, not one per click');
    assert.equal(rows[0].created_by, 'l13-share-test');
  });

  test('the message names the candidate, round and role and carries the JD link', async () => {
    const r = await shareLinkForRecording(journey.id, recording.id, USER);
    assert.match(r.message, /^Interview recording: L13 Sharer · /);
    assert.ok(r.message.includes(`(${jd.position_hiring_for})`));
    assert.ok(r.message.includes(r.url));
    assert.ok(r.message.endsWith(`Job description: ${JD}`));
  });

  test('each request is noted on the timeline', async () => {
    const notes = await prisma.rpa_pipeline_stage_events.findMany({
      where: { pipeline_id: journey.id, event_type: 'note', notes: { contains: 'No-login recording link' } },
      orderBy: { id: 'asc' },
    });
    assert.ok(notes.length >= 3, `expected a note per request, got ${notes.length}`);
    assert.match(notes[0].notes, /^No-login recording link created by l13-share-test for /);
    assert.match(notes[1].notes, /^No-login recording link copied again by l13-share-test/);
  });

  test("refused: another journey's recording, and a recording with nothing to play", async () => {
    const other = await journeyFor('L13 Other', jd);
    await assert.rejects(shareLinkForRecording(other.id, recording.id, USER), (err) => err.statusCode === 404 || err.status === 404);

    const silent = await recordingOn(other, { playable: false });
    await assert.rejects(shareLinkForRecording(other.id, silent.id, USER), (err) => err.statusCode === 409 || err.status === 409);
    assert.equal(await prisma.rpa_recording_share_link.count({ where: { recording_id: silent.id } }), 0);
  });
});
