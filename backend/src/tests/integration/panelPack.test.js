/**
 * L14 — the interview panel's pack (staging DB). Builds the pack directly, so
 * NO email is sent.
 *
 *   node src/tests/run-block.mjs src/tests/integration/panelPack.test.js
 *
 *   - a first round with nothing on file: no report, only what is attached
 *   - after a submitted Technical Round 1 scorecard: the report so far is
 *     attached (HTML, no candidate contact details) and the block names the round
 *   - an MRF with no JD and a candidate with no CV: nothing is invented, the
 *     summary says so
 *
 * Fixtures are tagged and torn down by explicit id.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import prisma from '../../config/database.js';
import { disconnectRedis } from '../../config/redis.js';
import { shortlistCandidates } from '../../services/screening.service.js';
import { buildPanelPack } from '../../services/interviewPanelPack.service.js';

const TAG = 'L14-PACK-FIXTURE';
const USER = { username: 'l14-pack-test', id: null };
const made = { cvs: [], mrfs: [] };

describe('L14 — the interview panel pack', () => {
  let jd;
  let journey;
  let candidateEmail;

  before(async () => {
    jd = await prisma.rpa_mrf.create({
      data: { position_hiring_for: `L14 QA Engineer ${Date.now()}`, number_of_positions: 1, approval_status: 'approved', additional_information: TAG },
    });
    made.mrfs.push(jd.id);
    candidateEmail = `l14.pack.${Date.now()}@example.invalid`;
    const c = await prisma.rpa_cv.create({
      data: { Name: 'L14 Pack Candidate', EmailID: candidateEmail, ContactNumber: '9876500033', MetaData: TAG, statusActive: 'ACTIVE', createdAt: new Date() },
    });
    made.cvs.push(c.id);
    const r = await shortlistCandidates([{ id: Number(c.id) }], Number(jd.id), '', USER, { sendEmail: false, source: 'search_candidate' });
    assert.equal(r.shortlisted, 1);
    const shortlist = await prisma.rpa_shortlisted_candidates.findFirst({ where: { cv_id: c.id, mrf_id: jd.id } });
    journey = await prisma.rpa_candidate_pipeline.findFirst({ where: { shortlist_id: shortlist.id } });
  });

  after(async () => {
    const pipes = await prisma.rpa_candidate_pipeline.findMany({ where: { cv_id: { in: made.cvs } }, select: { id: true } });
    const pIds = pipes.map((p) => p.id);
    await prisma.rpa_interview_scorecard_skill.deleteMany({ where: { rpa_interview_scorecard: { pipeline_id: { in: pIds } } } }).catch(() => {});
    await prisma.rpa_interview_scorecard.deleteMany({ where: { pipeline_id: { in: pIds } } });
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

  test('a first round with nothing on file gets no report, and nothing is invented', async () => {
    const pack = await buildPanelPack(journey.id, { user: USER });
    assert.equal(pack.summary.report, false);
    assert.equal(pack.summary.jd, 'none', 'this MRF has no JD');
    assert.equal(pack.summary.cv, 'none', 'this candidate has no CV on file');
    assert.equal(pack.attachments.length, 0);
    assert.ok(!/Earlier rounds/.test(pack.blockHtml));
  });

  test('after a submitted Technical Round 1 scorecard the report so far travels', async () => {
    const start = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const schedule = await prisma.rpa_interview_schedule.create({
      data: { pipeline_id: journey.id, stage_key: 'tech1', scheduled_start_at: start, scheduled_end_at: new Date(start.getTime() + 3600e3), interviewer_email: 'panel@example.invalid' },
    });
    await prisma.rpa_interview_scorecard.create({
      data: {
        schedule_id: schedule.id, pipeline_id: journey.id, stage_key: 'tech1', recipient_email: 'panel@example.invalid',
        token_expires_at: new Date(Date.now() + 7 * 86400e3), status: 'submitted', submitted_at: new Date(),
        recommendation: 'approve', avg_score: 4.5, comments: 'Strong on test design.',
      },
    });

    const pack = await buildPanelPack(journey.id, { user: USER });
    assert.equal(pack.summary.report, true);
    const report = pack.attachments.find((a) => a.name.endsWith('report so far.html'));
    assert.ok(report, 'the report is attached');
    const html = Buffer.from(report.contentBytes, 'base64').toString('utf8');
    assert.match(html, /Strong on test design\./);
    assert.ok(!html.includes(candidateEmail), 'the candidate’s email is not in the panel’s copy');
    assert.ok(!html.includes('9876500033'), 'nor their phone');
    assert.match(pack.blockHtml, /Earlier rounds/);
    assert.match(pack.blockHtml, /Technical Round 1/);
    assert.match(pack.blockHtml, /recommends moving forward · average 4\.5\/5/);
  });

  test('the feedback-received email renders from its template, escaped and branded (not sent)', async () => {
    const { renderInterviewTemplate } = await import('../../services/interviewEmailRender.js');
    const { INTERVIEW_EMAIL_TEMPLATE_NAMES } = await import('../../services/interviewEmailTemplates.js');
    const r = await renderInterviewTemplate(INTERVIEW_EMAIL_TEMPLATE_NAMES.feedbackReceived, {
      candidate_name: 'L14 Pack Candidate', stage_label: 'Technical Round 1', interviewer: 'Rahul <R>',
      position: 'QA Engineer', recommendation: 'Move forward', avg_score: '4.5 / 5', submitted_at: '23 Oct 2026, 5:10 pm',
      comments: 'Strong & quick', candidate_link: 'https://ats.example.com/pipeline?candidate=1',
    });
    assert.equal(r.subject, 'Feedback received: L14 Pack Candidate · Technical Round 1');
    assert.match(r.html, /<!DOCTYPE html>/);
    assert.ok(r.html.includes('Rahul &lt;R&gt;') && r.html.includes('Strong &amp; quick'));
    assert.ok(r.html.includes('href="https://ats.example.com/pipeline?candidate=1"'));
  });
});
