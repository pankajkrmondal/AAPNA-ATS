/**
 * Rendering the candidate dossier — model in, pack out.
 *
 * Run: node --test src/tests/unit/candidateDossier.test.js
 *
 * No database: the renderers take a plain model, which is the whole reason the
 * model and the view are separate modules. What these tests pin is the set of
 * properties that make the pack safe and readable in someone else's hands, months
 * from now, on a machine we will never see:
 *
 *   - it opens with no login and NO INTERNET (tracker row 5),
 *   - an empty section says so instead of disappearing,
 *   - candidate-supplied free text cannot inject markup,
 *   - and nothing forbidden survived into the rendered bytes.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import AdmZip from 'adm-zip';

import {
  buildPack,
  dossierFilename,
  esc,
  packDossierZip,
  renderDossierHtml,
  renderDossierWorkbook,
  renderReadMe,
} from '../../exports/candidateDossier.export.js';
// From the pure helper module rather than candidateDossier.service.js: that
// service reuses getCandidateScorecardReport(), whose email/notification chain
// holds the event loop open and hangs `node --test`. Same functions, reachable.
import {
  applyAttachments, applyZekoExtras, describeIncludedCategories, describeJourneyStatus,
  extensionFor,
} from '../../utils/dossierModel.js';
import {
  buildZekoReportSection, flattenSoftSkills, isCommercialParameter, mentionsCompensation,
  splitBullets,
} from '../../utils/zekoReportModel.js';
// The Zeko URL handling lives in its own module for the same reason: zeko.service.js
// imports the Outlook reader (for the OTP login), whose chain holds the event loop
// open and hangs `node --test`.
import { parseZekoReportUrl, parseZekoResponseId, zekoSharedReportUrl } from '../../utils/zekoShareLink.js';
import { assertNoForbiddenFields, pickCvProfile, redactionSummary } from '../../utils/dossierRedaction.js';

/** A fully-populated model, shaped exactly as buildDossierModel() returns one. */
function fullModel(overrides = {}) {
  return {
    generated: {
      at: new Date('2026-09-02T09:02:00Z'),
      by: 'chhaya.k',
      by_email: 'chhaya.k@aapnainfotech.com',
      pipeline_id: 4821,
      phase_note: 'Phase 1',
    },
    candidate: {
      name: 'Pankaj Mondal',
      position: 'Senior Java Developer',
      mrf_ref: 'MRF-318',
    },
    status: {
      stage_key: 'tech2',
      stage_label: 'Technical 2',
      state: 'in_progress',
      closed: false,
      headline: 'This candidate is currently at Technical 2.',
    },
    profile: pickCvProfile({
      Name: 'Pankaj Mondal',
      PositionApplied: 'Senior Java Developer',
      EmailID: 'pankaj@example.com',
      ContactNumber: '+91 98765 43210',
      TotalExperienceYears: '8',
      CurrentCompany: 'Example Systems',
      Top5KeySkills: 'Java, Spring Boot, Kafka',
    }),
    contact_details_included: true,
    position: [
      { field: 'position_hiring_for', label: 'Role', value: 'Senior Java Developer' },
      { field: 'mandatory_skills', label: 'Mandatory skills', value: 'Java, Spring Boot' },
    ],
    stages: [{
      stage_label: 'Technical 1',
      event_type: 'outcome',
      outcome: 'approved',
      reason: null,
      notes: 'Strong on concurrency',
      decided_by: 'harish',
      decided_at: new Date('2026-08-28T11:00:00Z'),
    }],
    consolidated_feedback: '2 of 2 interviewers recommend hire. Average score 4.3.',
    scorecard_overall: { rounds_scored: 2, average: 4.3, outstanding: 1 },
    scorecards: [{
      stage_label: 'Technical 1',
      card_type: 'technical',
      interviewer: 'harish@aapnainfotech.com',
      interviewer_role: 'panel',
      recommendation: 'hire',
      avg_score: 4.5,
      communication: 4,
      attitude: 5,
      final_rating: 4,
      comments: 'Handled the system-design question well.',
      submitted_at: new Date('2026-08-28T12:30:00Z'),
      skills: [{ label: 'Java', rating: 5, remark: 'Excellent' }],
    }, {
      stage_label: 'HR Round',
      card_type: 'hr',
      interviewer: 'hr@aapnainfotech.com',
      interviewer_role: 'hr',
      recommendation: 'hire',
      avg_score: 4.1,
      communication: 4,
      attitude: 4,
      final_rating: 4,
      comments: null,
      submitted_at: new Date('2026-08-30T10:00:00Z'),
      skills: [],
      hr_round: {
        strengths: 'Clear communicator',
        weakness: null,
        communication_comments: 'Fluent',
        attitude_comments: null,
        relocation: 'Yes',
        notice_period: '60 days',
        other_observation: null,
        final_feedback: 'Recommend proceeding',
      },
    }],
    scorecards_pending: [{
      stage_label: 'Technical 2', interviewer: 'atul@example.com', sent_at: new Date(), expired: false,
    }],
    zeko: [{
      round: 'HR screening',
      status: 'completed',
      taken_at: new Date('2026-08-20T09:00:00Z'),
      overall_score: 82,
      technical_score: 78,
      communication_score: 88,
      report_available: true,
    }],
    assessments: [{
      test_name: 'Java Backend Assessment',
      taken_note: null,
      sections: [{ label: 'Core Java', score: 34 }, { label: 'SQL', score: 28 }],
      overall_percentage: 74.5,
      overall_marks: 62,
      result: 'Pass',
      imported_at: new Date('2026-08-22T06:00:00Z'),
    }],
    interviews: [{
      stage_label: 'Technical 1',
      interviewer: 'Harish',
      scheduled_start_at: new Date('2026-08-28T10:00:00Z'),
      scheduled_end_at: new Date('2026-08-28T11:00:00Z'),
      status: 'completed',
      occurrence: 'held',
      no_show_party: null,
      cancelled_at: null,
    }, {
      stage_label: 'Technical 2',
      interviewer: 'Atul',
      scheduled_start_at: new Date('2026-09-04T10:00:00Z'),
      scheduled_end_at: new Date('2026-09-04T11:00:00Z'),
      status: 'scheduled',
      occurrence: null,
      no_show_party: null,
      cancelled_at: null,
    }],
    recordings: [{
      stage_label: 'Technical 1',
      recorded_start_at: new Date('2026-08-28T10:02:00Z'),
      duration_seconds: 3300,
      available: true,
    }],
    redaction: redactionSummary(),
    manifest: [
      { item: 'Candidate report (HTML)', included: true, note: 'Opens in any browser.' },
      { item: 'Resume', included: false, note: 'Not attached in this version — ask the recruiter.' },
      {
        item: 'AI screening report (Zeko)',
        included: false,
        note: 'Scores are included in this report. The full screening report is held on the '
          + 'screening platform — ask the recruiter if you need it.',
      },
    ],
    ...overrides,
  };
}

/** The same model with every collection empty — a brand-new journey. */
function emptyModel() {
  return fullModel({
    profile: pickCvProfile(null),
    position: [],
    stages: [],
    consolidated_feedback: null,
    scorecard_overall: null,
    scorecards: [],
    scorecards_pending: [],
    zeko: [],
    assessments: [],
    interviews: [],
    recordings: [],
  });
}

describe('renderDossierHtml — opens with no login and no internet (tracker row 5)', () => {
  const html = renderDossierHtml(fullModel());

  test('makes no external request of any kind', () => {
    // The acceptance criterion in one assertion. Any http(s) reference — a CDN
    // script, a webfont, the company logo PNG the email layout uses — would make
    // the pack render differently, or not at all, on a machine with no network.
    assert.ok(!/src\s*=\s*["']https?:/i.test(html), 'no remote src');
    assert.ok(!/<link\b/i.test(html), 'no external stylesheet');
    assert.ok(!/<script\b/i.test(html), 'no script of any kind');
    assert.ok(!/@import/i.test(html), 'no CSS @import');
    assert.ok(!/url\(\s*["']?https?:/i.test(html), 'no remote CSS url()');
  });

  test('carries its own stylesheet inline, so it is styled offline', () => {
    assert.ok(html.includes('<style>'));
    assert.ok(html.includes('@media print'), 'Ctrl+P is the documented route to a PDF');
  });

  test('is a complete, standalone document', () => {
    assert.ok(html.trimStart().startsWith('<!DOCTYPE html>'));
    assert.ok(html.includes('</html>'));
  });

  test('renders all ten sections', () => {
    for (const title of [
      'Candidate profile', 'The position', 'Progress so far',
      'Consolidated interviewer feedback', 'Interviewer scorecards', 'AI screening',
      'Assessment results', 'Interview history', 'Interview recordings', 'What is in this pack',
    ]) {
      assert.ok(html.includes(esc(title)), `missing section: ${title}`);
    }
  });

  test('shows the candidate, the role and who prepared it', () => {
    assert.ok(html.includes('Pankaj Mondal'));
    assert.ok(html.includes('Senior Java Developer'));
    assert.ok(html.includes('chhaya.k'));
    assert.ok(html.includes('MRF-318'));
  });

  test('carries the confidentiality notice and the deletion request', () => {
    assert.ok(html.includes('CONFIDENTIAL'));
    assert.ok(/delete it\s*\n?\s*within 30 days/i.test(html.replace(/\s+/g, ' ')));
  });

  test('states what was removed, so redaction is visible rather than silent', () => {
    assert.ok(/removed from this pack/i.test(html));
    assert.ok(/compensation/i.test(html));
  });

  test('names the rounds still awaiting a scorecard', () => {
    // "No feedback yet" and "feedback withheld" are different things.
    assert.ok(/still awaited/i.test(html));
    assert.ok(html.includes('atul@example.com'));
  });

  test('does not print an unconfirmed interview as "did not happen"', () => {
    // occurrence === null is a genuine third state: nobody has said either way.
    assert.ok(html.includes('Not confirmed'));
    assert.ok(html.includes('Yes'));
  });
});

describe('renderDossierHtml — empty sections say so rather than vanishing', () => {
  const html = renderDossierHtml(emptyModel());

  test('every section is still present', () => {
    for (const title of [
      'Progress so far', 'Interviewer scorecards', 'AI screening',
      'Assessment results', 'Interview history', 'Interview recordings',
    ]) {
      assert.ok(html.includes(esc(title)), `section vanished when empty: ${title}`);
    }
  });

  test('an empty section explains what "none" means here', () => {
    // A reader must be able to tell "there were no scorecards" from "the dossier
    // forgot to include them" — plan §3.1.
    assert.ok(/No scorecards have been submitted/i.test(html));
    assert.ok(/No interview recordings exist/i.test(html));
    assert.ok(/nothing to consolidate/i.test(html));
  });

  test('a profile with no values renders the labels anyway', () => {
    assert.ok(html.includes('Notice period'), 'a missing value must still be labelled');
    assert.ok(html.includes('—'), 'missing values render as an em dash, not blank');
  });
});

describe('renderDossierHtml — free text cannot inject markup', () => {
  test('escapes script tags in interviewer comments', () => {
    const model = fullModel();
    model.scorecards[0].comments = '<script>alert("xss")</script> and "quotes" & ampersands';
    const html = renderDossierHtml(model);
    assert.ok(!html.includes('<script>alert'), 'raw script tag reached the document');
    assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(html.includes('&amp;'));
  });

  test('escapes resume-parsed profile values', () => {
    // Resume text is parsed from a file the candidate supplied. It is the least
    // trusted input in the system and it lands in this document.
    const model = fullModel();
    model.profile = [{ field: 'CurrentCompany', label: 'Current company', value: '<img src=x onerror=alert(1)>' }];
    const html = renderDossierHtml(model);
    assert.ok(!html.includes('<img src=x'));
    assert.ok(html.includes('&lt;img'));
  });

  test('escapes a candidate name containing markup', () => {
    const model = fullModel();
    model.candidate.name = 'Bobby </h1><b>Tables';
    const html = renderDossierHtml(model);
    assert.ok(!html.includes('</h1><b>Tables'));
    assert.ok(html.includes('&lt;/h1&gt;'));
  });

  test('esc() is safe inside single-quoted attributes too', () => {
    assert.equal(esc(`it's "quoted"`), 'it&#39;s &quot;quoted&quot;');
  });
});

describe('the offer stage keeps its row but loses its prose', () => {
  // Found by the leak scan against real staging data on 2026-09-02: dropping
  // the rpa_offers RECORD does not stop the stage timeline narrating the same
  // terms in free text. 26 of 66 offer notes in staging carried a proposed
  // joining date. Pinned here so the exclusion cannot be quietly undone.
  const withOfferNote = () => fullModel({
    stages: [{
      stage_label: 'Offer',
      event_type: 'note',
      outcome: null,
      reason: null,
      // What buildDossierModel() must have already stripped. If a future change
      // stops stripping it, the assertions below fail.
      notes: null,
      decided_by: 'saukumar',
      decided_at: new Date('2026-08-27T15:58:00Z'),
    }, {
      stage_label: 'Offer',
      event_type: 'outcome',
      outcome: 'joined',
      reason: null,
      notes: null,
      decided_by: 'saukumar',
      decided_at: new Date('2026-08-27T15:59:00Z'),
    }],
  });

  test('the offer round is still visible as a stage and an outcome', () => {
    // Decision #13 requires the pack to state the journey's status plainly, so
    // the row must survive even though its text does not.
    const html = renderDossierHtml(withOfferNote());
    assert.ok(html.includes('Offer'));
    assert.ok(html.includes('joined'));
    assert.ok(html.includes('saukumar'));
  });

  test('no joining date or offer prose reaches the rendered pack', () => {
    const html = renderDossierHtml(withOfferNote());
    assert.ok(!/proposed joining/i.test(html));
    assert.ok(!html.includes('2026-12-01'));
  });

  test('non-commercial stages keep their notes', () => {
    // The exclusion must be precise. Interviewer-facing context on a technical
    // round is exactly what the dossier exists to carry.
    const html = renderDossierHtml(fullModel());
    assert.ok(html.includes('Strong on concurrency'));
  });
});

describe('renderDossierHtml — a closed journey is never mistaken for a live one', () => {
  test('a rejected candidate produces a pack that says so plainly', () => {
    // Decision #13: HR allowed a dossier for ANY journey state, which makes this
    // line the thing standing between a reader and interviewing someone who was
    // rejected three weeks ago.
    const status = describeJourneyStatus(
      { current_stage_key: 'tech2', closed_at: new Date(), final_outcome: 'rejected', is_paused: false },
      'Technical 2',
    );
    const html = renderDossierHtml(fullModel({ status }));
    assert.ok(html.includes('CLOSED'));
    assert.ok(/not a request to interview/i.test(html));
  });

  test('a paused journey is flagged without being called closed', () => {
    const status = describeJourneyStatus(
      { current_stage_key: 'tech2', closed_at: null, final_outcome: null, is_paused: true },
      'Technical 2',
    );
    assert.equal(status.state, 'paused');
    assert.equal(status.closed, false);
    assert.ok(/ON HOLD/i.test(renderDossierHtml(fullModel({ status }))));
  });

  test('an in-progress journey says where the candidate is', () => {
    const status = describeJourneyStatus(
      { current_stage_key: 'tech2', closed_at: null, final_outcome: null, is_paused: false },
      'Technical 2',
    );
    assert.equal(status.state, 'in_progress');
    assert.ok(status.headline.includes('Technical 2'));
  });
});

describe('renderDossierWorkbook — the four sheets in plan §3.2', () => {
  const book = XLSX.read(renderDossierWorkbook(fullModel()), { type: 'buffer' });

  test('has exactly the four named sheets', () => {
    assert.deepEqual(book.SheetNames, ['Summary', 'Scorecards', 'Stage History', 'Assessments']);
  });

  test('Summary is transposed — Section | Field | Value', () => {
    const rows = XLSX.utils.sheet_to_json(book.Sheets.Summary, { header: 1 });
    assert.deepEqual(rows[0], ['Section', 'Field', 'Value']);
    const flat = JSON.stringify(rows);
    assert.ok(flat.includes('Pankaj Mondal'));
    assert.ok(flat.includes('Consolidated interviewer feedback'));
  });

  test('Scorecards has one row per round x skill', () => {
    const rows = XLSX.utils.sheet_to_json(book.Sheets.Scorecards, { header: 1 });
    assert.deepEqual(rows[0][0], 'Round');
    // Technical 1 has one skill; the HR round has none but must still appear —
    // a round with no skill breakdown is not a round that did not happen.
    const flat = JSON.stringify(rows);
    assert.ok(flat.includes('Java'));
    assert.ok(flat.includes('HR Round'));
  });

  test('Assessments carries both the screening and the written test', () => {
    const flat = JSON.stringify(XLSX.utils.sheet_to_json(book.Sheets.Assessments, { header: 1 }));
    assert.ok(flat.includes('HR screening'));
    assert.ok(flat.includes('Java Backend Assessment'));
    assert.ok(flat.includes('Core Java'));
  });

  test('an empty model still produces four sheets with their headers', () => {
    const empty = XLSX.read(renderDossierWorkbook(emptyModel()), { type: 'buffer' });
    assert.deepEqual(empty.SheetNames, ['Summary', 'Scorecards', 'Stage History', 'Assessments']);
    const rows = XLSX.utils.sheet_to_json(empty.Sheets['Stage History'], { header: 1 });
    assert.deepEqual(rows[0], ['Stage', 'Event', 'Outcome', 'Reason / note', 'Decided by', 'When']);
  });
});

describe('READ-ME.txt — the only control that survives the file leaving', () => {
  const readme = renderReadMe(fullModel());

  test('asks the recipient to delete the pack after 30 days', () => {
    assert.ok(/within 30 days/i.test(readme));
  });

  test('says what was removed and what is not included', () => {
    assert.ok(/WHAT HAS BEEN REMOVED/i.test(readme));
    assert.ok(/compensation/i.test(readme));
    assert.ok(/Resume:/i.test(readme), 'the manifest gaps must be named, not silently omitted');
  });

  test('tells the reader the download was recorded against a name', () => {
    assert.ok(/recorded in the ATS/i.test(readme));
    assert.ok(readme.includes('chhaya.k'));
  });

  test('points the reader at the recruiter for anything missing', () => {
    assert.ok(/reply to the recruiter/i.test(readme));
  });
});

describe('packDossierZip — what actually lands in the recipient\'s inbox', () => {
  const entries = new AdmZip(packDossierZip(fullModel())).getEntries().map((e) => e.entryName);

  test('contains exactly the three Phase 1 files', () => {
    assert.deepEqual(entries.sort(), ['Candidate-Dossier.html', 'Candidate-Summary.xlsx', 'READ-ME.txt']);
  });

  test('no forbidden string survives into the packed bytes', () => {
    // The in-process half of the automated leak scan (plan §10.3). The full scan
    // over a real candidate's CTC and vendor values runs against staging; this
    // catches a renderer that starts emitting a forbidden label.
    const zip = new AdmZip(packDossierZip(fullModel()));
    const html = zip.getEntry('Candidate-Dossier.html').getData().toString('utf8');
    for (const forbidden of ['CTC_LPA', 'vendorName', 'VendorEmail', 'budget_min', 'hr_current_ctc']) {
      assert.ok(!html.includes(forbidden), `${forbidden} appeared in the packed HTML`);
    }
  });

  test('the model it renders passes the redaction guard', () => {
    assert.doesNotThrow(() => assertNoForbiddenFields(fullModel()));
  });
});

describe('attachments — the files that actually travel in the pack', () => {
  const resume = { name: 'attachments/01_Resume_Pankaj-Mondal.pdf', buffer: Buffer.from('%PDF-1.7 fake') };
  const doc = { name: 'attachments/02_PAN-Card_Pankaj-Mondal.pdf', buffer: Buffer.from('%PDF-1.7 also fake') };

  test('attached files land under attachments/ in the ZIP', () => {
    const entries = new AdmZip(packDossierZip(fullModel(), [resume, doc]))
      .getEntries().map((e) => e.entryName).sort();
    assert.deepEqual(entries, [
      'Candidate-Dossier.html',
      'Candidate-Summary.xlsx',
      'READ-ME.txt',
      'attachments/01_Resume_Pankaj-Mondal.pdf',
      'attachments/02_PAN-Card_Pankaj-Mondal.pdf',
    ]);
  });

  test('the attached bytes are the bytes we were given', () => {
    // Cheap, but it is the whole promise of the feature: the interviewer opens
    // the resume rather than a login page.
    const zip = new AdmZip(packDossierZip(fullModel(), [resume]));
    assert.equal(
      zip.getEntry('attachments/01_Resume_Pankaj-Mondal.pdf').getData().toString('utf8'),
      '%PDF-1.7 fake',
    );
  });

  test('a pack with no attachments is still the three core files', () => {
    const entries = new AdmZip(packDossierZip(fullModel(), [])).getEntries().map((e) => e.entryName);
    assert.equal(entries.length, 3);
  });

  test('buildPack only puts attachments in the ZIP, never the single-file formats', () => {
    // An HTML or XLSX download is one file; a resume has nowhere to go in it.
    const html = buildPack(fullModel(), 'html', [resume]).buffer.toString('utf8');
    assert.ok(!html.includes('%PDF'));
    assert.ok(buildPack(fullModel(), 'xlsx', [resume]).buffer.length > 0);
  });
});

describe('extensionFor — the attachment has to open when double-clicked', () => {
  // Both failures below reached a real downloaded pack during testing, which is
  // why this is pinned rather than left to a one-line regex.

  test("Graph's own filename wins when we have it", () => {
    assert.equal(extensionFor({ name: 'Asha_Resume.pdf', url: 'x', contentType: 'text/plain' }), '.pdf');
  });

  test('Content-Type is used once the item id is stored and there is no filename', () => {
    // Reading by item id skips the metadata call, so `name` is null. Without
    // this branch every download after the backfill lost its extension.
    assert.equal(
      extensionFor({
        name: null,
        url: 'https://aapna-my.sharepoint.com/personal/x/Doc.aspx?sourcedoc=%7Babc%7D',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
      '.docx',
    );
  });

  test('a SharePoint viewer page extension is never used', () => {
    // ".aspx" on a Word document is worse than nothing: it tells the operating
    // system to open a web page.
    assert.equal(extensionFor({ url: 'https://x/Doc.aspx?sourcedoc=1' }), '');
    assert.equal(extensionFor({ name: 'Doc.aspx' }), '');
    for (const ext of ['html', 'htm', 'php', 'asp']) {
      assert.equal(extensionFor({ url: `https://x/thing.${ext}` }), '', `.${ext} must be rejected`);
    }
  });

  test('query strings and fragments do not hide a real extension', () => {
    assert.equal(extensionFor({ url: 'https://x/Resume.docx?web=1' }), '.docx');
    assert.equal(extensionFor({ url: 'https://x/Resume.pdf#page=2' }), '.pdf');
  });

  test('a charset on the content type does not defeat the lookup', () => {
    assert.equal(extensionFor({ contentType: 'application/pdf; charset=binary' }), '.pdf');
  });

  test('an unknown type yields no extension rather than a guess', () => {
    // A wrong extension fails to open; a missing one merely prompts.
    assert.equal(extensionFor({ contentType: 'application/octet-stream' }), '');
    assert.equal(extensionFor({}), '');
    assert.equal(extensionFor(), '');
  });
});

describe('applyAttachments — the manifest tells the truth about this download', () => {
  const attached = (over = {}) => ({
    files: [], notes: {}, failed: [], degraded: false, documentCount: 0, totalBytes: 0, ...over,
  });
  const resumeFile = { name: 'attachments/01_Resume_Pankaj-Mondal.pdf', buffer: Buffer.from('x') };
  const manifestFor = (model) => Object.fromEntries(model.manifest.map((m) => [m.item, m]));

  test('a fetched resume is recorded as included, by filename', () => {
    const model = applyAttachments(fullModel(), attached({ files: [resumeFile] }), { includeResume: true });
    const entry = manifestFor(model).Resume;
    assert.equal(entry.included, true);
    assert.match(entry.note, /attachments\/01_Resume_/);
    assert.equal(model.attachments.resume_attached, true);
  });

  test('a failed fetch degrades honestly instead of going silent', () => {
    // The pack is still worth sending; the reader must know what is missing and
    // that they can ask for it.
    const model = applyAttachments(
      fullModel(),
      attached({
        notes: { resume: 'Could not be attached (HTTP 403) — please ask the recruiter for it.' },
        failed: ['resume'],
        degraded: true,
      }),
      { includeResume: true },
    );
    const entry = manifestFor(model).Resume;
    assert.equal(entry.included, false);
    assert.equal(entry.degraded, true);
    assert.match(entry.note, /ask the recruiter/i);
  });

  test('a candidate with NO resume on file is not reported as a failed download', () => {
    // Absence is not failure. The collector records a note either way, so
    // treating the note as evidence of a problem made the UI warn "a file could
    // not be attached" for candidates who never had a resume — seen in staging,
    // 2026-09-03. The manifest still explains itself; nothing is flagged.
    const model = applyAttachments(
      fullModel(),
      attached({ notes: { resume: 'No resume is on file for this candidate in the ATS.' } }),
      { includeResume: true },
    );
    const entry = manifestFor(model).Resume;
    assert.equal(entry.included, false);
    assert.notEqual(entry.degraded, true);
    assert.match(entry.note, /no resume is on file/i);
  });

  test('a candidate with no documents to collect is not a failed download either', () => {
    const model = applyAttachments(
      fullModel(),
      attached({ notes: { documents: 'No documents have been collected from this candidate.' } }),
      { includeDocuments: true },
    );
    const entry = manifestFor(model)['Candidate personal documents'];
    assert.equal(entry.included, false);
    assert.notEqual(entry.degraded, true);

    // …but a document that genuinely failed to fetch still is one.
    const broken = applyAttachments(
      fullModel(),
      attached({ notes: { document_7: 'The stored file could not be found.' }, failed: ['document_7'], degraded: true }),
      { includeDocuments: true },
    );
    assert.equal(manifestFor(broken)['Candidate personal documents'].degraded, true);
  });

  test('a resume the recruiter chose not to send says so, not "unavailable"', () => {
    const model = applyAttachments(fullModel(), attached(), { includeResume: false });
    assert.match(manifestFor(model).Resume.note, /recruiter's choice/i);
    assert.notEqual(manifestFor(model).Resume.degraded, true);
  });

  test('a single-file pack explains that a fuller version exists', () => {
    const model = applyAttachments(fullModel(), attached(), {
      includeResume: true, supportsAttachments: false,
    });
    assert.match(manifestFor(model).Resume.note, /single-file version/i);
    assert.match(manifestFor(model).Resume.note, /full ZIP/i);
  });

  test('personal documents appear in the manifest ONLY when asked for', () => {
    // Listing "0 personal documents" on every pack would advertise a category
    // most recipients have no business thinking about.
    const off = applyAttachments(fullModel(), attached(), { includeDocuments: false });
    assert.ok(!manifestFor(off)['Candidate personal documents']);

    const on = applyAttachments(fullModel(), attached({ documentCount: 3 }), { includeDocuments: true });
    const entry = manifestFor(on)['Candidate personal documents'];
    assert.ok(entry);
    assert.equal(entry.included, true);
    assert.match(entry.note, /3 document\(s\) attached at the recruiter's explicit request/i);
  });

  test('the audit names the resume and counts the personal documents (decision #11)', () => {
    // "Someone ticked a box" is unanswerable months later; "3 personal documents,
    // by chhaya.k, on 14 Sep" is not.
    const model = applyAttachments(
      fullModel(),
      attached({ files: [resumeFile], documentCount: 3 }),
      { includeResume: true, includeDocuments: true },
    );
    const listed = describeIncludedCategories(model);
    assert.ok(listed.includes('resume_file'));
    assert.ok(listed.includes('personal_documents(3)'));
  });

  test('no attachment categories are claimed when nothing was attached', () => {
    const listed = describeIncludedCategories(applyAttachments(fullModel(), attached(), {}));
    assert.ok(!listed.some((c) => c.startsWith('resume_file')));
    assert.ok(!listed.some((c) => c.startsWith('personal_documents')));
  });
});

describe('buildPack and dossierFilename', () => {
  test('zip is the default and the fallback for an unknown format', () => {
    assert.equal(buildPack(fullModel()).contentType, 'application/zip');
    assert.equal(buildPack(fullModel(), 'nonsense').contentType, 'application/zip');
  });

  test('html and xlsx are produced on request', () => {
    assert.ok(buildPack(fullModel(), 'html').contentType.startsWith('text/html'));
    assert.ok(buildPack(fullModel(), 'html').buffer.toString('utf8').startsWith('<!DOCTYPE html>'));
    assert.ok(buildPack(fullModel(), 'xlsx').contentType.includes('spreadsheetml'));
  });

  test('the filename names the candidate and the role, not an id', () => {
    // It lands in an inbox next to other attachments; "dossier.zip" is
    // unfindable a week later.
    const name = dossierFilename(fullModel(), 'zip');
    assert.ok(name.includes('Pankaj-Mondal'));
    assert.ok(name.includes('Senior-Java-Developer'));
    assert.ok(name.endsWith('.zip'));
  });

  test('the filename is safe on a filesystem we do not control', () => {
    const model = fullModel();
    model.candidate.name = 'Ana/Maria "Bo" ..\\Ünal';
    const name = dossierFilename(model, 'zip');
    assert.ok(!/[\\/:"*?<>|]/.test(name), `unsafe filename: ${name}`);
    assert.ok(!name.includes('..'));
  });

  test('a candidate with no recorded position still gets a filename', () => {
    const model = fullModel();
    model.candidate.position = null;
    assert.ok(dossierFilename(model, 'zip').includes('Pankaj-Mondal'));
  });
});

describe('describeIncludedCategories — the audit records contents, not just the event', () => {
  test('names each category with a count where one exists', () => {
    // "Someone ticked a box" is unanswerable months later; "2 scorecards and 1
    // recording listed, by chhaya.k" is not (plan §8.4).
    const listed = describeIncludedCategories(fullModel());
    assert.ok(listed.includes('profile'));
    assert.ok(listed.includes('contact_details'));
    assert.ok(listed.includes('scorecards(2)'));
    assert.ok(listed.includes('recordings_listed(1)'));
  });

  test('records when contact details were withheld', () => {
    const model = fullModel({ contact_details_included: false });
    assert.ok(!describeIncludedCategories(model).includes('contact_details'));
  });

  test('an empty journey records only the profile', () => {
    assert.deepEqual(describeIncludedCategories(emptyModel()), ['profile', 'contact_details']);
  });
});

describe('Zeko report URLs — turning a login-walled link into one an outsider can open', () => {
  const stored = 'https://app.zeko.ai/app/new-report?candidateId=6a8bfcca5e57c481d6c906ee'
    + '&jobId=69a15687abfe6f852d7d7d50&tab=Overview';

  test('both ids are read off a stored report link', () => {
    assert.deepEqual(parseZekoReportUrl(stored), {
      candidateId: '6a8bfcca5e57c481d6c906ee',
      jobId: '69a15687abfe6f852d7d7d50',
    });
  });

  test('a link missing either id yields null rather than half a request', () => {
    // A one-id "share link" would be a request Zeko refuses, or worse, one it
    // answers for a different candidate.
    assert.equal(parseZekoReportUrl('https://app.zeko.ai/app/new-report?jobId=69a1'), null);
    assert.equal(parseZekoReportUrl('https://app.zeko.ai/app/new-report?candidateId=6a8b'), null);
  });

  test('anything that is not a report URL degrades to null', () => {
    // Rows predating zekoReportUrl() hold a snapshot link or nothing at all; the
    // dossier must say "ask the recruiter", not throw mid-download.
    for (const bad of [null, undefined, '', 'not a url', 'https://app.zeko.ai/app/shared-report?linkId=6a8c']) {
      assert.equal(parseZekoReportUrl(bad), null, `expected null for ${JSON.stringify(bad)}`);
    }
  });

  test('the shared URL is built from the link id Zeko returns', () => {
    assert.equal(
      zekoSharedReportUrl('6a8c3ad13618d4d5f8ed1607'),
      'https://app.zeko.ai/app/shared-report?linkId=6a8c3ad13618d4d5f8ed1607',
    );
    assert.equal(zekoSharedReportUrl(null), null);
    assert.equal(zekoSharedReportUrl('  '), null);
  });

  test('the response id is recovered from the report\'s recording URL', () => {
    // Zeko's own Share call sends responseId, and the report payload carries it
    // NOWHERE else — it is buried in the player URL. Kept as the fallback for
    // the day candidateId + jobId stops being enough.
    assert.equal(
      parseZekoResponseId({ screenRecording: 'https://app.zeko.ai/app/play-sr?responseId=6a8bfd1c002fc047ac5292dd' }),
      '6a8bfd1c002fc047ac5292dd',
    );
    assert.equal(parseZekoResponseId({ screenRecording: null }), null);
    assert.equal(parseZekoResponseId(null), null);
  });
});

describe('applyZekoExtras — the pack tells the truth about the screening report', () => {
  const manifestFor = (model) => Object.fromEntries(model.manifest.map((m) => [m.item, m]));
  const url = 'https://app.zeko.ai/app/shared-report?linkId=6a8c3ad13618d4d5f8ed1607';
  const minted = { links: [{ index: 0, round: 'HR screening', url }], notes: {}, degraded: false };
  const detail = {
    reports: [{ index: 0, round: 'HR screening', detail: { verdict: 'Strong Fit', parameters: [], withheld_count: 2 } }],
    links: [],
    notes: {},
    degraded: false,
  };

  test('a rendered assessment lands on the round it belongs to', () => {
    // On the round, not in a list of its own: a candidate can sit two screening
    // rounds on one job, and the reader has to know which one they are reading.
    const model = applyZekoExtras(fullModel(), detail, { includeScreeningDetail: true });
    assert.equal(model.zeko[0].report_detail.verdict, 'Strong Fit');
    assert.equal(model.zeko_report_details.count, 1);
    const entry = manifestFor(model)['AI screening report (Zeko)'];
    assert.equal(entry.included, true);
    assert.match(entry.note, /section 6/i);
    assert.match(entry.note, /compensation has been removed/i);
  });

  test('a minted link lands on the round too, and is described separately', () => {
    const model = applyZekoExtras(fullModel(), minted, {
      includeScreeningDetail: false, includeScreeningReport: true,
    });
    assert.equal(model.zeko[0].report_link, url);
    assert.equal(model.zeko_report_links.count, 1);
    assert.match(manifestFor(model)['AI screening report (Zeko)'].note, /no login/i);
  });

  test('asked for both and given one, the pack says which half is missing', () => {
    const model = applyZekoExtras(fullModel(), detail, {
      includeScreeningDetail: true, includeScreeningReport: true,
    });
    const entry = manifestFor(model)['AI screening report (Zeko)'];
    assert.equal(entry.included, true);
    assert.equal(entry.degraded, true);
    assert.match(entry.note, /link .* could not be created/i);
  });

  test('a recruiter who unticked both is not told the report was unavailable', () => {
    const model = applyZekoExtras(fullModel(), { reports: [], links: [] }, {
      includeScreeningDetail: false, includeScreeningReport: false,
    });
    const entry = manifestFor(model)['AI screening report (Zeko)'];
    assert.equal(entry.included, false);
    assert.match(entry.note, /recruiter's choice/i);
    assert.notEqual(entry.degraded, true);
  });

  test('a failed fetch degrades honestly rather than going silent', () => {
    const model = applyZekoExtras(fullModel(), {
      reports: [],
      links: [],
      notes: { zeko_0: 'The AI screening report could not be retrieved — please ask the recruiter for it.' },
      degraded: true,
    }, { includeScreeningDetail: true });
    const entry = manifestFor(model)['AI screening report (Zeko)'];
    assert.equal(entry.included, false);
    assert.equal(entry.degraded, true);
    assert.match(entry.note, /ask the recruiter/i);
  });

  test('a candidate with no screening report keeps the "none exists" line', () => {
    const model = applyZekoExtras(emptyModel(), { reports: [], links: [] }, {});
    const entry = manifestFor(model)['AI screening report (Zeko)'];
    assert.equal(entry.included, false);
    assert.notEqual(entry.degraded, true);
    assert.equal(model.zeko_report_links.count, 0);
  });

  test('the audit tells a rendered assessment apart from a NO-LOGIN link', () => {
    // Two materially different disclosures: one is redacted text inside a file
    // we control, the other a URL to Zeko's page carrying CTC, the hiring band,
    // the transcript and the video, which we cannot revoke. A review must be
    // able to find the second without wading through the first (plan §8.4).
    const both = applyZekoExtras(fullModel(), { ...detail, links: minted.links }, {
      includeScreeningDetail: true, includeScreeningReport: true,
    });
    const listed = describeIncludedCategories(both);
    assert.ok(listed.includes('screening_report_detail(1)'));
    assert.ok(listed.includes('screening_report_no_login_link(1)'));

    const detailOnly = describeIncludedCategories(
      applyZekoExtras(fullModel(), detail, { includeScreeningDetail: true }),
    );
    assert.ok(detailOnly.includes('screening_report_detail(1)'));
    assert.ok(!detailOnly.some((c) => c.includes('no_login_link')));
  });
});

describe('buildZekoReportSection — the vendor report, under our redaction', () => {
  /** A payload shaped exactly as Zeko's interview-report returns one. */
  const report = (over = {}) => ({
    role: 'Junior Python QA Automation Engineer - HR Screening',
    strength: '- Four years of QA automation experience.\n- Practical experience using Python.',
    weakness: '- Limited exposure to diverse work environments.',
    recommendation: '- Suitable for junior-level QA automation roles.',
    improvement: '',
    hr_screening_evaluation: {
      fit: 'Strong Fit',
      fit_percentage: 94,
      red_flags: { count: 0, details: [] },
      remarks: '- The Candidate meets nearly all requirements.\n- Educational credentials are strong.',
      parameter_fits: [
        {
          parameter: 'SQL and Manual Testing',
          fit: true,
          is_must: true,
          answer: 'The Candidate described using SQL queries.',
          reasoning: 'Direct evidence of experience in SQL.',
        },
        {
          parameter: 'Current CTC',
          fit: true,
          is_must: true,
          answer: 'The Candidate reported current CTC as 5 LPA.',
          reasoning: '5 LPA is within the 0-7 LPA preference range.',
        },
        {
          parameter: 'Expected CTC',
          fit: true,
          is_must: true,
          answer: 'The Candidate expects 7 LPA.',
          reasoning: 'Expected CTC of 7 LPA is within the 0-8.5 LPA preference range.',
        },
      ],
      // The transcript. Never rendered — see the module header.
      interview_questions: [{ questionNumber: 7, question: 'Share your current CTC?', transcript: 'My CTC is 5 LPA.', link: 'https://s3/audio.mp3' }],
    },
    softSkillsEvaluation: {
      cognitiveSkillsAnalysis: {
        evaluation: {
          candidate_evaluation: {
            // Never observed — and Zeko stamps "weak" on it anyway.
            logical_reasoning: {
              opportunity: 'no opportunity',
              status: 'skipped',
              skip_reason: 'Insufficient opportunity to demonstrate skill',
              dimensions: {},
              overall_rating: 'weak',
              overall_summary: 'Not sufficiently demonstrated due to minimal opportunity in the interview.',
            },
          },
        },
      },
      interpersonalSkillsAnalysis: {
        evaluation: {
          candidate_evaluation: {
            articulation: {
              status: 'evaluated',
              dimensions: {
                fluency: { rating: 'moderate', reasoning: 'Occasional halts.', evidence: '"My current CD is 5 LPA and I am expecting 7 LPA."' },
              },
              overall_rating: 'moderate',
              overall_summary: 'Responses were readable but lacked vividness.',
            },
            engagement: {
              status: 'evaluated',
              dimensions: { warmth: { rating: 'moderate', reasoning: 'x', evidence: 'y' } },
              overall_rating: 'moderate',
              overall_summary: 'Candidate communicated salary and notice period information fluently.',
            },
          },
        },
      },
    },
    ...over,
  });

  test('compensation parameters never reach the section', () => {
    // The two strings that made this section necessary: the candidate's own CTC,
    // and — worse — our hiring band, which §8.2 forbids as budget data.
    const section = buildZekoReportSection(report());
    const json = JSON.stringify(section);
    assert.ok(!/CTC/i.test(json), 'CTC survived into the section');
    assert.ok(!/LPA/i.test(json), 'an LPA figure survived into the section');
    assert.ok(!/preference range/i.test(json), 'the hiring band survived into the section');
    assert.deepEqual(section.parameters.map((p) => p.name), ['SQL and Manual Testing']);
  });

  test('a RENAMED compensation parameter is still dropped', () => {
    // The names are free text in Zeko's console. A list of exact names would
    // leak the day someone renamed one, so the value is checked as well.
    const renamed = report();
    renamed.hr_screening_evaluation.parameter_fits[1].parameter = 'Financial expectation';
    const section = buildZekoReportSection(renamed);
    assert.ok(!JSON.stringify(section).includes('5 LPA'));
    assert.ok(!section.parameters.some((p) => p.name === 'Financial expectation'));
  });

  test('the vendor\'s own counts are reported unaltered', () => {
    // 3 assessed, 3 met, 2 withheld here. Recomputing the ratio over what
    // survived would restate Zeko's assessment, and an interviewer holding a
    // Zeko screenshot would find two different numbers for one interview.
    const section = buildZekoReportSection(report());
    assert.equal(section.parameters_total, 3);
    assert.equal(section.parameters_met, 3);
    assert.equal(section.parameters.length, 1);
    assert.ok(section.withheld_count >= 2);
  });

  test('the transcript and its audio links are never carried', () => {
    const json = JSON.stringify(buildZekoReportSection(report()));
    assert.ok(!json.includes('interview_questions'));
    assert.ok(!json.includes('audio.mp3'));
    assert.ok(!/Share your current CTC/.test(json));
  });

  test('soft-skill quotations are dropped, ratings are kept', () => {
    // `evidence` is a verbatim quotation of the candidate — a transcript in
    // miniature, and the field where the salary line actually turned up.
    const section = buildZekoReportSection(report());
    const json = JSON.stringify(section);
    // The FIELD, not the word — "Direct evidence of SQL experience" is a
    // perfectly good remark and must survive.
    assert.ok(!/"evidence"\s*:/.test(json), 'the evidence field was carried through');
    assert.ok(!json.includes('current CD'));
    const areas = section.soft_skills.map((s) => s.area);
    assert.ok(areas.some((a) => /Articulation/i.test(a)), 'the articulation rating was lost');
    // …and the one whose SUMMARY mentions salary goes entirely.
    assert.ok(!areas.some((a) => /Engagement/i.test(a)));
  });

  test('a skill Zeko never observed is not reported as "weak"', () => {
    // Zeko marks an unobserved skill `status: "skipped"` and then stamps
    // `overall_rating: "weak"` on it anyway. Passing that on would tell an
    // interviewer a real candidate reasons weakly, when the truth is the AI
    // never asked them anything requiring it.
    const skipped = buildZekoReportSection(report())
      .soft_skills.find((s) => /Logical reasoning/i.test(s.area));
    assert.ok(skipped, 'the skipped skill was dropped instead of being reported honestly');
    assert.equal(skipped.assessed, false);
    assert.equal(skipped.rating, null);
    assert.match(skipped.comment, /opportunity/i);

    const html = renderDossierHtml(applyZekoExtras(
      fullModel(),
      { reports: [{ index: 0, round: 'HR screening', detail: buildZekoReportSection(report()) }], links: [] },
      { includeScreeningDetail: true },
    ));
    assert.ok(html.includes('Not assessed in this interview'));
    assert.ok(!/Logical reasoning<\/td><td>weak/i.test(html));
  });

  test('narrative bullets are split, and money-bearing ones removed', () => {
    assert.deepEqual(splitBullets('- One\n- Two').kept, ['One', 'Two']);
    const guarded = splitBullets('- Strong on SQL\n- Expects 7 LPA');
    assert.deepEqual(guarded.kept, ['Strong on SQL']);
    assert.equal(guarded.dropped, 1);
    assert.deepEqual(splitBullets(null), { kept: [], dropped: 0 });
  });

  test('the guards recognise money however it is written', () => {
    for (const text of ['current CTC', '5 LPA', '7 lakhs per annum', 'salary expectations', 'in-hand pay', 'stipend']) {
      assert.ok(mentionsCompensation(text), `missed: ${text}`);
    }
    for (const text of ['four years of experience', 'notice period of 15 days', null, '']) {
      assert.ok(!mentionsCompensation(text), `false positive: ${text}`);
    }
    assert.ok(isCommercialParameter({ parameter: 'Expected CTC' }));
    assert.ok(isCommercialParameter({ parameter: 'Package', answer: 'n/a' }));
    assert.ok(!isCommercialParameter({ parameter: 'Notice Period', answer: '15 days' }));
  });

  test('a payload with no screening evaluation yields null, not an empty shell', () => {
    // A coding or panel round genuinely has nothing of this shape. Null lets the
    // manifest say "none exists" instead of rendering an empty card.
    assert.equal(buildZekoReportSection({ role: 'Coding round' }), null);
    assert.equal(buildZekoReportSection(null), null);
    assert.deepEqual(flattenSoftSkills(null), { skills: [], dropped: 0 });
  });
});

describe('the rendered screening assessment, as the reader meets it', () => {
  const detail = {
    round_name: 'Junior Python QA - HR Screening',
    verdict: 'Strong Fit',
    fit_percentage: 94,
    parameters_total: 14,
    parameters_met: 13,
    red_flag_count: 0,
    red_flags: [],
    summary: ['The Candidate meets nearly all requirements.'],
    parameters: [{
      name: 'SQL and Manual Testing',
      met: true,
      required: true,
      answer: 'The Candidate described using SQL queries.',
      remark: 'Direct evidence of SQL experience.',
    }],
    strengths: ['Four years of QA automation experience.'],
    concerns: ['Limited exposure to diverse environments.'],
    recommendation: ['Suitable for junior-level QA automation roles.'],
    improvements: [],
    soft_skills: [{ area: 'Interpersonal — Articulation', rating: 'moderate', comment: 'Responses lacked vividness.' }],
    withheld_count: 2,
  };
  const rendered = () => applyZekoExtras(
    fullModel(),
    { reports: [{ index: 0, round: 'HR screening', detail }], links: [], notes: {}, degraded: false },
    { includeScreeningDetail: true },
  );

  test('the assessment is in the HTML, and still fetches nothing', () => {
    const html = renderDossierHtml(rendered());
    assert.ok(html.includes('Strong Fit'));
    assert.ok(html.includes('13 of 14'));
    assert.ok(html.includes('SQL and Manual Testing'));
    assert.ok(html.includes('Four years of QA automation experience.'));
    assert.ok(!/src\s*=\s*["']https?:/i.test(html), 'no remote src');
    assert.ok(!/<script\b/i.test(html), 'no script of any kind');
  });

  test('it says what was withheld rather than removing it silently', () => {
    // A reader comparing this against a Zeko screenshot must be able to tell
    // that something was removed deliberately.
    assert.match(renderDossierHtml(rendered()), /2 item\(s\).*removed.*compensation/is);
  });

  test('the vendor report\'s free text cannot inject markup', () => {
    const model = applyZekoExtras(fullModel(), {
      reports: [{
        index: 0,
        round: 'HR screening',
        detail: { ...detail, summary: ['<script>alert(1)</script>'], parameters: [{ name: '<img src=x onerror=alert(1)>', met: true, required: false, answer: null, remark: null }] },
      }],
      links: [],
    }, { includeScreeningDetail: true });
    const html = renderDossierHtml(model);
    assert.ok(!/<script>alert/.test(html));
    assert.ok(!/<img src=x/.test(html));
  });

  test('the spreadsheet carries the assessment too', () => {
    const sheet = XLSX.read(renderDossierWorkbook(rendered()), { type: 'buffer' }).Sheets.Assessments;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    assert.ok(rows.some((r) => r[2] === 'Verdict' && r[3] === 'Strong Fit'));
    assert.ok(rows.some((r) => String(r[2]).startsWith('Requirement — SQL and Manual Testing')));
  });

  test('the READ-ME points the reader at the section and says what was removed', () => {
    assert.match(renderReadMe(rendered()), /section 6.*compensation details removed/is);
    assert.ok(!/compensation details removed/i.test(renderReadMe(fullModel())));
  });
});

describe('the screening report link, as the reader meets it', () => {
  const url = 'https://app.zeko.ai/app/shared-report?linkId=6a8c3ad13618d4d5f8ed1607';
  const linked = () => applyZekoExtras(
    fullModel(),
    { reports: [], links: [{ index: 0, round: 'HR screening', url }], notes: {}, degraded: false },
    { includeScreeningDetail: false, includeScreeningReport: true },
  );

  test('the HTML carries it as a clickable link, and still fetches nothing', () => {
    // A hyperlink is not an external resource: the pack still renders complete
    // on a machine with no network (tracker row 5), the link simply waits to be
    // clicked. That distinction is the whole reason this is allowed at all.
    const html = renderDossierHtml(linked());
    assert.ok(html.includes(`<a href="${url}"`), 'the share link is not in the HTML');
    assert.ok(!/src\s*=\s*["']https?:/i.test(html), 'no remote src');
    assert.ok(!/<script\b/i.test(html), 'no script of any kind');
    assert.ok(!/<link\b/i.test(html), 'no external stylesheet');
  });

  test('the HTML warns that the link needs no login', () => {
    assert.match(renderDossierHtml(linked()), /without a login|with no login/i);
  });

  test('a pack with no link says nothing about one', () => {
    const html = renderDossierHtml(fullModel());
    assert.ok(!html.includes('shared-report'));
  });

  test('the spreadsheet carries it too, so "Spreadsheet only" is not a silent loss', () => {
    const sheet = XLSX.read(renderDossierWorkbook(linked()), { type: 'buffer' }).Sheets.Assessments;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    const link = rows.find((r) => String(r[2] || '').startsWith('Full report link'));
    assert.ok(link, 'no link row in the Assessments sheet');
    assert.equal(link[3], url);
  });

  test('the READ-ME tells the recipient the link is as sensitive as the pack', () => {
    const readme = renderReadMe(linked());
    assert.match(readme, /WITHOUT a login/i);
    assert.match(readme, /confidential/i);
    // And says nothing about a link when there is none to warn about.
    assert.ok(!/WITHOUT a login/i.test(renderReadMe(fullModel())));
  });

  test('a link cannot inject markup into the pack', () => {
    const model = applyZekoExtras(fullModel(), {
      reports: [],
      links: [{ index: 0, round: 'HR screening', url: 'https://app.zeko.ai/x?linkId="><script>alert(1)</script>' }],
      notes: {},
      degraded: false,
    }, { includeScreeningReport: true });
    const html = renderDossierHtml(model);
    assert.ok(!/<script>alert/.test(html), 'the link escaped its attribute');
  });
});
