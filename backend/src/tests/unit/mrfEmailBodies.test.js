import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  approvalNote,
  buildMrfApprovalRequestBody,
  buildMrfDecisionNoticeBody,
  buildMrfDetailsTable,
  buildMrfOutcomeBody,
  buildMrfRequestBody,
  buildMrfSubmissionHrBody,
  brandLegacyMrfTable,
  emailButton,
  mrfDetailsTableFor,
  tightenIntro,
} from '../../services/mrfEmailBodies.js';
import { wrapBrandedEmail, isFullHtmlDocument } from '../../services/emailLayout.service.js';

const LEGACY_TABLE = '<table style="border: 1px solid black; border-collapse: collapse; width: 100%; font-family: Calibri, sans-serif; font-size: 14px;"><thead><tr style="background-color: #f2f2f2;"><th style="border: 1px solid black; padding: 8px;">Field Name</th></tr></thead><tbody><tr><td style="border: 1px solid black; padding: 8px;">Position hiring for:</td><td style="border: 1px solid black; padding: 8px;">QA</td></tr></tbody></table>';
const decision = { word: 'approved', byName: 'Deepak Rao', atIst: '23 Oct 2026, 11:05 am' };

const bodies = () => [
  ['request', buildMrfRequestBody({ firstName: 'Meera', introHtml: '<p>Intro</p>', jdLink: 'https://x/jd', mrfFormUrl: 'https://ats/mrf-submit?role=QA' })],
  ['approval', buildMrfApprovalRequestBody({ greeting: 'Dear Deepak,', introText: 'Please review.', approveLink: 'https://a', rejectLink: 'https://r', holdLink: 'https://h', tableBody: LEGACY_TABLE })],
  ['decision', buildMrfDecisionNoticeBody({ greeting: 'Dear Deepak,', lead: 'Recorded.', decision, closing: 'Thanks.' })],
  ['hr copy', buildMrfSubmissionHrBody({ tableBody: LEGACY_TABLE })],
  ['outcome', buildMrfOutcomeBody({ approved: true, comments: 'Go ahead', decidedBy: { name: 'Deepak Rao', atIst: '23 Oct' }, tableBody: LEGACY_TABLE })],
];

describe('MRF email bodies (L15)', () => {
  test('every body is a fragment the branded shell wraps exactly once', () => {
    for (const [name, body] of bodies()) {
      assert.equal(isFullHtmlDocument(body), false, name);
      const html = wrapBrandedEmail(body, { title: 'T' });
      assert.equal((html.match(/<html/gi) || []).length, 1, name);
      assert.ok(!/AAPNA Requisition Portal|© 2025|Calibri/i.test(html), `${name}: no legacy chrome left`);
      assert.ok(!/display:\s*flex/i.test(html), `${name}: no flex layout`);
    }
  });

  test('one sign-off each: the shell signs everything except the CEO-signed outcome', () => {
    for (const [name, body] of bodies()) {
      const html = wrapBrandedEmail(body, { title: 'T' });
      const signoffs = (html.match(/best regards|warm regards|\bregards,/gi) || []).length;
      assert.equal(signoffs, 1, `${name}: exactly one sign-off`);
      assert.equal(/CEO, AAPNA/.test(html), name === 'outcome', name);
    }
  });

  test('the HM request carries the MRF form, and the JD step only when there is a JD', () => {
    const withJd = buildMrfRequestBody({ firstName: 'Meera', introHtml: 'x', jdLink: 'https://x/jd', mrfFormUrl: 'https://ats/mrf-submit?role=QA&emailid=m%40x' });
    assert.ok(withJd.includes('href="https://x/jd"'));
    assert.ok(withJd.includes('href="https://ats/mrf-submit?role=QA&amp;emailid=m%40x"'));
    assert.match(withJd, /Step 1 · Review the JD/);
    const noJd = buildMrfRequestBody({ firstName: 'Meera', introHtml: 'x', jdLink: '', mrfFormUrl: 'https://ats/f' });
    assert.ok(!/Review the JD/.test(noJd));
    assert.match(noJd, /Open MRF/);
  });

  test('the approval request keeps its buttons, Hold only when offered', () => {
    const body = bodies()[1][1];
    for (const [label, href] of [['Approve', 'https://a'], ['Reject', 'https://r'], ['Hold', 'https://h']]) {
      assert.ok(body.includes(`href="${href}"`) && body.includes(`>${label}</a>`), label);
    }
    const noHold = buildMrfApprovalRequestBody({ greeting: 'x', introText: 'y', approveLink: 'https://a', rejectLink: 'https://r', tableBody: '' });
    assert.ok(!/>Hold<\/a>/.test(noHold));
    assert.ok(!/Requisition details/.test(noHold), 'no empty details heading');
  });

  test('compact, table-based buttons: above the details and again below them', () => {
    const body = bodies()[1][1];
    assert.ok(!/line-height:\s*3/.test(body), 'no tall line-height row');
    assert.equal((body.match(/href="https:\/\/a"/g) || []).length, 2, 'approve button twice with a table');
    assert.ok(body.indexOf('href="https://a"') < body.indexOf('Requisition details'), 'first row above the table');
    assert.match(body, /height="40"/);
    const short = buildMrfApprovalRequestBody({ greeting: 'x', introText: 'y', approveLink: 'https://a', rejectLink: 'https://r', tableBody: '' });
    assert.equal((short.match(/href="https:\/\/a"/g) || []).length, 1, 'once without a table');
  });

  test('the intro keeps its wording, without the blank-line paragraphs', () => {
    const intro = tightenIntro('<p>One.</p><p><br></p><p>Two.</p><p>&nbsp;</p>');
    assert.equal(intro, '<p style="margin:0 0 10px 0">One.</p><p style="margin:0 0 10px 0">Two.</p>');
    assert.equal(tightenIntro('First.<br><br>Second.'), '<p style="margin:0 0 10px 0">First.</p><p style="margin:0 0 10px 0">Second.</p>');
  });

  test('the personal-link note is a slim line, not a boxed callout', () => {
    const n = approvalNote('Also sent to <strong>N16 People</strong>.');
    assert.match(n, /^<p style="[^"]*font-size:12px/);
    assert.ok(n.includes('<strong>N16 People</strong>'));
  });

  test('the outcome keeps the markup the audit backfill parses, with the comment escaped', () => {
    const body = buildMrfOutcomeBody({ approved: false, comments: 'Not now <b>sorry</b>', tableBody: '' });
    const m = body.match(/Comment from Management:<\/strong>(.*?)<\/p>/);
    assert.ok(m, 'backfill pattern still matches');
    assert.equal(m[1].trim(), 'Not now &lt;b&gt;sorry&lt;/b&gt;');
    assert.match(body, /decided not to proceed/);
  });

  test('a legacy stored table is restyled, content untouched, idempotently', () => {
    const once = brandLegacyMrfTable(LEGACY_TABLE);
    assert.ok(!/solid black|Calibri|#f2f2f2/i.test(once));
    assert.equal(brandLegacyMrfTable(once), once);
    assert.ok(once.includes('Position hiring for:') && once.includes('>QA<'));
  });
});

describe('buildMrfDetailsTable (L15)', () => {
  const form = {
    submitter_email: 'hm@example.com', hiring_manager_name: '<img src=x onerror=alert(1)>', position_hiring_for: 'QA & Test',
    number_of_positions: 2, existing_resource_allocation: false, mandatory_skills: 'Other', mandatory_skills_other: 'Selenium <b>',
  };

  test('escapes every submitted value (the form is public)', () => {
    const t = buildMrfDetailsTable(form, null, null, null);
    assert.ok(!t.includes('<img src=x'));
    assert.ok(t.includes('&lt;img src=x onerror=alert(1)&gt;'));
    assert.ok(t.includes('QA &amp; Test'));
    assert.ok(t.includes('Other - Selenium &lt;b&gt;'));
  });

  test('links when uploaded, "Not Uploaded" otherwise, and the AI summary rows', () => {
    const t = buildMrfDetailsTable(form, 'https://od/jd?a=1&b=2', null, { min_experience_years: 3, max_experience_years: 6 });
    assert.ok(t.includes('href="https://od/jd?a=1&amp;b=2"'));
    assert.match(t, /Question Paper Link:<\/td><td[^>]*>Not Uploaded/);
    assert.match(t, /AI Experience Range:<\/td><td[^>]*>3 - 6 years/);
    assert.match(t, /Existing Resource Allocation Possible:<\/td><td[^>]*>No/);
  });

  test('uses the brand styling, not the legacy black borders', () => {
    const t = buildMrfDetailsTable(form, null, null, null);
    assert.ok(!/solid black|Calibri/i.test(t));
    assert.equal(brandLegacyMrfTable(t), t);
  });

  test('every field is kept; an empty value shows a light dash', () => {
    const t = buildMrfDetailsTable(form, null, null, null);
    assert.equal((t.match(/:<\/td><td/g) || []).length, 48, '43 form rows + 5 AI rows');
    assert.match(t, /Project Name:<\/td><td[^>]*><span style="color:#c4c9bb">—<\/span>/);
    assert.match(t, /font-size:13px/);
  });
});

describe('mrfDetailsTableFor (redesign)', () => {
  const fmt = () => '06 Nov 2026';
  const record = {
    emailbody: '<table>stored</table>', hiring_manager_name: 'Anita', position_hiring_for: 'QA', mandatory_skills: 'Selenium',
    parsed_jd_json: null, jd_document_link: 'https://od/jd', question_paper: null, date_of_request: new Date('2026-11-06'),
  };

  test('rebuilds the table from the record, with the date formatted as at submission', () => {
    const t = mrfDetailsTableFor(record, fmt);
    assert.match(t, /Date of Request:<\/td><td[^>]*>06 Nov 2026/);
    assert.ok(t.includes('href="https://od/jd"'));
    assert.ok(!t.includes('stored'));
  });

  test('falls back to the stored table when the record lacks the form fields', () => {
    assert.equal(mrfDetailsTableFor({ id: 1, emailbody: '<table>stored</table>' }, fmt), '<table>stored</table>');
    assert.equal(mrfDetailsTableFor(null, fmt), '');
  });
});

test('emailButton escapes its href and label', () => {
  const b = emailButton('https://x/?a="b"', 'Go <now>');
  assert.ok(b.includes('href="https://x/?a=&quot;b&quot;"'));
  assert.ok(b.includes('Go &lt;now&gt;'));
});
