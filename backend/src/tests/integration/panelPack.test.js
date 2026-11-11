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
 *   - U01: an Excel-upload row (the workbook stored as its "resume") never
 *     sends the workbook; a resume that cannot be fetched says "failed"; the
 *     profile summary can go in place of a missing CV; the Schedule window's
 *     pre-send check reads the same rule without downloading anything
 *   - U03: the candidate table in the invite body. A Tech 2 invite shows Zeko,
 *     Evalground and Tech 1 without CTC; a CEO invite shows CTC; Source only
 *     when ticked and never for a referral; the panel's cut of the report
 *     (feedback only on tech rounds, none before any feedback; the leadership
 *     cut for the CEO, still without CTC)
 *
 * Fixtures are tagged and torn down by explicit id.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import prisma from '../../config/database.js';
import { disconnectRedis } from '../../config/redis.js';
import { shortlistCandidates } from '../../services/screening.service.js';
import { buildPanelPack, loadPanelCandidateTable, panelPackPreflight } from '../../services/interviewPanelPack.service.js';

const TAG = 'L14-PACK-FIXTURE';
const USER = { username: 'l14-pack-test', id: null };
const made = { cvs: [], mrfs: [], zekoRounds: [], zekoResults: [], assessmentImports: [] };
const ZEKO_PIPELINE = `U03-ZEKO-${Date.now()}`;
const reportHtml = (pack) => {
  const a = pack.attachments.find((x) => x.name.endsWith('report so far.html'));
  return a ? Buffer.from(a.contentBytes, 'base64').toString('utf8') : null;
};
// U01: what an Excel-upload row looked like before the fix.
const WORKBOOK_URL = 'https://aapna-my.sharepoint.com/personal/hr/_layouts/15/Doc.aspx?sourcedoc=%7Bu01%7D&file=U01%20Candidates.xlsx&action=default';
const RESUME_OWED = JSON.stringify({ uploadResume: 'Null' });

describe('L14 — the interview panel pack', () => {
  let jd;
  let journey;
  let candidateEmail;
  let cvId;
  let shortlistId;
  const setResume = (data) => prisma.rpa_cv.update({ where: { id: cvId }, data });

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
    cvId = c.id;
    const r = await shortlistCandidates([{ id: Number(c.id) }], Number(jd.id), '', USER, { sendEmail: false, source: 'search_candidate' });
    assert.equal(r.shortlisted, 1);
    const shortlist = await prisma.rpa_shortlisted_candidates.findFirst({ where: { cv_id: c.id, mrf_id: jd.id } });
    shortlistId = shortlist.id;
    journey = await prisma.rpa_candidate_pipeline.findFirst({ where: { shortlist_id: shortlist.id } });
  });

  after(async () => {
    const pipes = await prisma.rpa_candidate_pipeline.findMany({ where: { cv_id: { in: made.cvs } }, select: { id: true } });
    const pIds = pipes.map((p) => p.id);
    await prisma.rpa_interview_scorecard_skill.deleteMany({ where: { rpa_interview_scorecard: { pipeline_id: { in: pIds } } } }).catch(() => {});
    await prisma.rpa_interview_scorecard.deleteMany({ where: { pipeline_id: { in: pIds } } });
    await prisma.rpa_zeko_interview_results.deleteMany({ where: { id: { in: made.zekoResults } } }).catch(() => {});
    await prisma.rpa_zeko_candidate_pipeline.deleteMany({ where: { id: { in: made.zekoRounds } } }).catch(() => {});
    await prisma.rpa_assessment_results.deleteMany({ where: { import_id: { in: made.assessmentImports } } }).catch(() => {});
    await prisma.rpa_assessment_imports.deleteMany({ where: { id: { in: made.assessmentImports } } }).catch(() => {});
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
    assert.equal(pack.summary.cv, 'missing', 'this candidate has no CV on file');
    assert.equal(pack.summary.profile, false, 'the profile goes only when asked for');
    assert.equal(pack.attachments.length, 0);
    assert.ok(!/Earlier rounds/.test(pack.blockHtml));
    assert.match(pack.blockHtml, /No CV is on file for this candidate yet\./);
  });

  test('U01: the pre-send check reads the records only', async () => {
    assert.deepEqual(await panelPackPreflight(journey.id), { resume: 'missing', jd: 'missing', report: false });
  });

  test('U01: "attach the candidate profile summary instead" sends it on a first round', async () => {
    const pack = await buildPanelPack(journey.id, { user: USER, attachProfile: true });
    assert.equal(pack.summary.cv, 'missing');
    assert.equal(pack.summary.profile, true);
    const profile = pack.attachments.find((a) => a.name.endsWith('candidate profile.html'));
    assert.ok(profile, 'the profile summary is attached');
    assert.equal(profile.contentType, 'text/html');
    const html = Buffer.from(profile.contentBytes, 'base64').toString('utf8');
    assert.ok(!html.includes(candidateEmail), 'no candidate email in the panel’s copy');
    assert.ok(!html.includes('9876500033'), 'nor their phone');
    assert.match(pack.blockHtml, /the candidate profile summary \(in place of the CV\)/);
  });

  test('U01: an Excel-upload row never sends the workbook as the resume', async () => {
    await setResume({ cvFileUrl: WORKBOOK_URL, cv_file_item_id: 'U01-FAKE-WORKBOOK-ITEM', missingData: RESUME_OWED });
    try {
      const pack = await buildPanelPack(journey.id, { user: USER });
      assert.equal(pack.summary.cv, 'not_a_resume');
      assert.ok(!pack.attachments.some((a) => /\.xlsx?$/i.test(a.name) || /spreadsheet/.test(a.contentType)), 'no spreadsheet reaches the panel');
      assert.ok(!pack.attachments.some((a) => /01_Resume_/.test(a.name)), 'nothing travels as the resume');
      assert.match(pack.blockHtml, /The CV on record is not in a format we can share/);
      assert.equal((await panelPackPreflight(journey.id)).resume, 'not_a_resume');

      // Even with the flag lost (a merge), the workbook's name still gives it away.
      await setResume({ missingData: '{}' });
      assert.equal((await buildPanelPack(journey.id, { user: USER })).summary.cv, 'not_a_resume');
    } finally {
      await setResume({ cvFileUrl: null, cv_file_item_id: null, missingData: null });
    }
  });

  test('U01: a resume that cannot be fetched says so ("failed"), it is not silent', async () => {
    // A local-disk fallback URL with no OneDrive item: nothing Graph can serve,
    // so this fails without any network call.
    await setResume({ cvFileUrl: '/uploads/u01-never-reached-onedrive.pdf', cv_file_item_id: null, missingData: '{}' });
    try {
      assert.equal((await panelPackPreflight(journey.id)).resume, 'ok', 'on the record it looks like a resume');
      const pack = await buildPanelPack(journey.id, { user: USER });
      assert.equal(pack.summary.cv, 'failed');
      assert.match(pack.blockHtml, /The CV could not be attached this time\. Reply to this email/);
    } finally {
      await setResume({ cvFileUrl: null, cv_file_item_id: null, missingData: null });
    }
  });

  test('U03: a Tech 1 panel with only AI screening and a test on file gets the table, but no report', async () => {
    await prisma.rpa_cv.update({
      where: { id: cvId },
      data: {
        NoticePeriod: '30 days', HighestQualification: 'B.Tech', TotalExperienceYears: '5',
        CTC_LPA: '12', ExpectedCTC_LPA: '15', JobSource: 'Vendor - Acme Staffing U03',
      },
    });
    const round = await prisma.rpa_zeko_candidate_pipeline.create({
      data: { candidate_id: shortlistId, zeko_job_id: 'U03-JOB', pipeline_id: ZEKO_PIPELINE, stage: 'functional', status: 'completed', completed_at: new Date() },
    });
    made.zekoRounds.push(round.id);
    const result = await prisma.rpa_zeko_interview_results.create({
      data: { zeko_job_id: 'U03-JOB', pipeline_id: ZEKO_PIPELINE, candidate_email: candidateEmail, scores_overallscore: 81, created_at: new Date() },
    });
    made.zekoResults.push(result.id);
    const imp = await prisma.rpa_assessment_imports.create({ data: { file_name: TAG } });
    made.assessmentImports.push(imp.id);
    await prisma.rpa_assessment_results.create({
      data: {
        import_id: imp.id, test_name: 'U03 QA MCQ', section_label_map: {}, email_matched: candidateEmail,
        pipeline_id: journey.id, cv_id: cvId, overall_percentage: 72, overall_result: 'Pass',
      },
    });

    const pack = await buildPanelPack(journey.id, { user: USER, stageKey: 'tech1' });
    assert.equal(pack.summary.report, false, 'no interviewer feedback yet, so no report on a tech round');
    const { html } = await loadPanelCandidateTable(journey.id, { stageKey: 'tech1', model: pack.tableModel });
    assert.match(html, /Zeko functional test score<\/td><td[^>]*>81</);
    assert.match(html, /U03 QA MCQ: 72% · Pass/);
    assert.ok(!/ feedback<\/td>/.test(html), 'no rounds done yet');
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
    assert.equal((await panelPackPreflight(journey.id)).report, true, 'the pre-send check sees the earlier round');
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

  test('U03: a Tech 2 invite shows Zeko, Evalground and Tech 1 in the table, without CTC', async () => {
    await prisma.rpa_interview_schedule.updateMany({ where: { pipeline_id: journey.id, stage_key: 'tech1' }, data: { interviewer_name: 'Rahul Verma' } });
    const pack = await buildPanelPack(journey.id, { user: USER, stageKey: 'tech2' });
    const { html } = await loadPanelCandidateTable(journey.id, { stageKey: 'tech2', model: pack.tableModel });
    assert.match(html, /Candidate details/);
    assert.match(html, /Zeko functional test score<\/td><td[^>]*>81</);
    assert.match(html, /U03 QA MCQ: 72% · Pass/);
    assert.match(html, /Technical Round 1 feedback<\/td><td[^>]*>Rahul Verma · Move forward · avg 4\.5\/5 · Strong on test design\./);
    assert.match(html, /Technical Round 1 recording<\/td><td[^>]*><span[^>]*>No recording/);
    assert.ok(html.includes(candidateEmail), 'the email row is in the invite body');
    assert.match(html, /30 days/);
    assert.ok(!/CTC/.test(html) && !html.includes('12 LPA'), 'no CTC on a technical round');
    assert.ok(!html.includes('Acme Staffing'), 'no source unless ticked');

    // The report is the technical cut: the named feedback only.
    const report = reportHtml(pack);
    assert.ok(report, 'Tech 1 feedback exists, so the report travels');
    assert.match(report, /Consolidated interviewer feedback/);
    assert.match(report, /Technical Round 1 — Rahul Verma/);
    assert.ok(!report.includes('Candidate profile') && !report.includes('What is in this pack'));
    assert.ok(!report.includes(candidateEmail));
  });

  test('U03: a CEO invite shows CTC (the HR scorecard’s first); the report still does not', async () => {
    const start = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const hr = await prisma.rpa_interview_schedule.create({
      data: { pipeline_id: journey.id, stage_key: 'hr_round', scheduled_start_at: start, scheduled_end_at: new Date(start.getTime() + 1800e3), interviewer_email: 'hr@example.invalid' },
    });
    await prisma.rpa_interview_scorecard.create({
      data: {
        schedule_id: hr.id, pipeline_id: journey.id, stage_key: 'hr_round', card_type: 'hr', recipient_email: 'hr@example.invalid',
        token_expires_at: new Date(Date.now() + 7 * 86400e3), status: 'submitted', submitted_at: new Date(),
        recommendation: 'approve', avg_score: 4, comments: 'Good culture fit.',
        hr_current_ctc: '13.5 LPA', hr_expected_ctc: '16 LPA',
      },
    });

    const pack = await buildPanelPack(journey.id, { user: USER, stageKey: 'ceo' });
    const { html } = await loadPanelCandidateTable(journey.id, { stageKey: 'ceo', model: pack.tableModel });
    assert.match(html, /Current CTC<\/td><td[^>]*>13\.5 LPA</);
    assert.match(html, /Expected CTC<\/td><td[^>]*>16 LPA</);
    assert.match(html, /HR[^<]* feedback<\/td><td[^>]*>hr@example\.invalid · Move forward · avg 4\/5 · Good culture fit\./);
    assert.ok(html.indexOf('Technical Round 1 feedback') < html.indexOf('hr@example.invalid'), 'rounds in pipeline order');

    const report = reportHtml(pack);
    assert.ok(report, 'the leadership cut travels');
    assert.ok(report.indexOf('Candidate profile') < report.indexOf('The position'), 'the position comes last');
    assert.ok(!report.includes('What is in this pack'));
    assert.ok(!report.includes('13.5 LPA') && !report.includes('16 LPA'), 'CTC never enters the report');
    assert.ok(!report.includes('Acme Staffing'), 'nor the source');
  });

  test('U03: the source shows only when ticked, and never for a referral', async () => {
    const ticked = await loadPanelCandidateTable(journey.id, { stageKey: 'tech2', showSource: true });
    assert.equal(ticked.showSource, true);
    assert.match(ticked.html, /Source<\/td><td[^>]*>Vendor - Acme Staffing U03</);
    await prisma.rpa_cv.update({ where: { id: cvId }, data: { is_referral: true } });
    try {
      const referral = await loadPanelCandidateTable(journey.id, { stageKey: 'ceo', showSource: true });
      assert.equal(referral.referral, true);
      assert.equal(referral.showSource, false);
      assert.ok(!referral.html.includes('Acme Staffing') && !/>Source</.test(referral.html));
    } finally {
      await prisma.rpa_cv.update({ where: { id: cvId }, data: { is_referral: false } });
    }
  });

  test('U03: the Schedule window preview carries the table, with links pending', async () => {
    const { previewScheduleEmails } = await import('../../services/interviewSchedule.service.js');
    const preview = await previewScheduleEmails(journey.id, { stageKey: 'tech2', startAt: new Date(Date.now() + 86400e3).toISOString() });
    assert.match(preview.candidate_table_html, /Candidate details/);
    assert.ok(!/CTC/.test(preview.candidate_table_html));
    assert.ok(!(preview.panel?.body || '').includes('Rahul Verma · Move forward'), 'the editable body never holds the table');
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
