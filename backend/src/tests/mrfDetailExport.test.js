/**
 * Unit tests for the single-requisition export's row builder.
 * Run: npm run test:unit
 *
 * buildDetailRows is pure (the spec's `fetch` is what touches Prisma), so the
 * shape of the file can be pinned down without a database.
 *
 * What these lock in are the two ways this export can quietly disagree with the
 * modal it is taken from:
 *
 *   1. The gated "Other" fields. The modal hides them unless their select reads
 *      "Other", and rows carry stale text from before the select was changed —
 *      exporting it unconditionally puts data in the file that nobody can see
 *      on screen.
 *   2. The status labels. The LIST table and the MODAL render the same
 *      `mrfstatus` differently ("MANAGER SUBMITTED" vs "COMPLETED"); this file
 *      comes from the modal and has to match it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDetailRows,
  mrfRaiseLabel,
  mrfApprovalLabel,
} from '../exports/mrfDetail.export.js';

const jdSend = {
  id: 124n,
  first_name: 'Priya',
  last_name: 'Sharma',
  email: 'priya@example.com',
  cc_email: 'hr@example.com',
  role: 'React Developer',
  jd_doc_link: 'https://example.com/jd.pdf',
  mrfstatus: 'managersubmitted',
  created_at: new Date('2026-08-01T09:15:00Z'),
  budget_min: 1200000,
  budget_max: 1800000,
  mrf_id: 77,
  email_body_content: '<p>large html blob</p>',
};

const mainMrf = {
  id: 77n,
  approval_status: 'completed',
  filled_at: null,
  hiring_manager_name: 'Priya Sharma',
  date_of_request: new Date('2026-08-02T00:00:00Z'),
  number_of_positions: 3,
  roles_responsibilities: 'Other',
  roles_responsibilities_other: 'Owns the design system',
  mandatory_skills: 'React, Node',
  mandatory_skills_other: 'stale text from an earlier answer',
  emailbody: '<p>another blob</p>',
  submitter_email: 'priya@example.com',
};

/** The Value cell for a given Field label, or undefined when not emitted. */
const valueOf = (rows, field) => rows.find((r) => r.field === field)?.value;

// ── Gated "Other" fields ──────────────────────────────────────────────

test('an "Other" detail field is emitted when its select reads Other', () => {
  const rows = buildDetailRows(jdSend, mainMrf);
  assert.equal(valueOf(rows, 'Roles & Responsibilities (Other)'), 'Owns the design system');
});

test('an "Other" detail field is omitted — not blanked — when its select does not', () => {
  const rows = buildDetailRows(jdSend, mainMrf);
  // mandatory_skills is "React, Node", so the stale _other text stays out of
  // the file entirely, exactly as the modal never renders it.
  assert.equal(rows.some((r) => r.field === 'Mandatory Skills (Other)'), false);
  assert.equal(rows.some((r) => String(r.value).includes('stale text')), false);
});

// ── Labels match the modal, not the list table ────────────────────────

test('raise status uses the modal wording, not the list table wording', () => {
  assert.equal(mrfRaiseLabel('managersubmitted'), 'COMPLETED');
  assert.equal(mrfRaiseLabel('manager submitted'), 'COMPLETED');
  assert.equal(mrfRaiseLabel('pendingfromleader'), 'PENDING');
  assert.equal(mrfRaiseLabel(''), 'PENDING');
  assert.equal(mrfRaiseLabel(null), 'PENDING');
  assert.equal(mrfRaiseLabel('closed'), 'CLOSED');
});

test('approval status collapses approved/completed and flags legacy closures', () => {
  assert.equal(mrfApprovalLabel('approved'), 'APPROVED');
  assert.equal(mrfApprovalLabel('completed'), 'APPROVED');
  assert.equal(mrfApprovalLabel('rejected'), 'REJECTED');
  assert.equal(mrfApprovalLabel('waiting'), 'WAITING');
  assert.equal(mrfApprovalLabel(null), 'PENDING');
  assert.equal(mrfApprovalLabel('closed'), 'CLOSED (legacy)');
});

// ── Sections ──────────────────────────────────────────────────────────

test('an unsubmitted requisition carries no Submitted MRF sections', () => {
  const rows = buildDetailRows({ ...jdSend, mrfstatus: 'pending', mrf_id: null }, null);
  assert.equal(rows.some((r) => r.section.startsWith('Submitted MRF')), false);
  assert.equal(rows.some((r) => r.section === 'AI-Parsed JD Summary'), false);
  // The workflow summary and the request itself are still there.
  assert.equal(valueOf(rows, 'MRF Raise Status'), 'PENDING');
  assert.equal(valueOf(rows, 'First Name'), 'Priya');
});

test('fill state is independent of approval status', () => {
  const approved = buildDetailRows(jdSend, mainMrf);
  assert.equal(valueOf(approved, 'MRF Approval Status'), 'APPROVED');
  assert.equal(valueOf(approved, 'Openings Filled'), 'NO');

  const filled = buildDetailRows(jdSend, { ...mainMrf, filled_at: new Date('2026-08-09T10:00:00Z') });
  // Still APPROVED — filling openings must not overwrite the approval value.
  assert.equal(valueOf(filled, 'MRF Approval Status'), 'APPROVED');
  assert.equal(valueOf(filled, 'Openings Filled'), 'YES');
  assert.match(valueOf(filled, 'Filled On'), /^2026-08-09/);
});

// ── Values ────────────────────────────────────────────────────────────

test('dates are formatted, not left as Date objects for the shared Value column', () => {
  const rows = buildDetailRows(jdSend, mainMrf);
  assert.equal(valueOf(rows, 'Form Submission Date'), '2026-08-01');
  assert.equal(valueOf(rows, 'Date of Submission'), '2026-08-02');
});

test('budgets stay raw numbers so the cells still add up in Excel', () => {
  const rows = buildDetailRows(jdSend, mainMrf);
  assert.equal(valueOf(rows, 'Min Budget (INR)'), 1200000);
  assert.equal(valueOf(rows, 'Max Budget (INR)'), 1800000);
});

test('the HTML email bodies never reach the file', () => {
  const rows = buildDetailRows(jdSend, mainMrf);
  assert.equal(rows.some((r) => String(r.value).includes('blob')), false);
});

test('the AI summary is emitted only when the parser produced one', () => {
  const without = buildDetailRows(jdSend, mainMrf);
  assert.equal(without.some((r) => r.section === 'AI-Parsed JD Summary'), false);

  const withJson = buildDetailRows(jdSend, {
    ...mainMrf,
    parsed_jd_json: { min_experience_years: 3, max_experience_years: 7, education: 'B.Tech' },
  });
  assert.equal(valueOf(withJson, 'Experience Range (AI)'), '3 - 7 years');
  assert.equal(valueOf(withJson, 'Education (AI)'), 'B.Tech');
});

test('parsed_jd_json survives being stored as a JSON string, and malformed JSON is ignored', () => {
  const asString = buildDetailRows(jdSend, {
    ...mainMrf,
    parsed_jd_json: '{"min_experience_years":2,"max_experience_years":4}',
  });
  assert.equal(valueOf(asString, 'Experience Range (AI)'), '2 - 4 years');

  const malformed = buildDetailRows(jdSend, { ...mainMrf, parsed_jd_json: '{not json' });
  assert.equal(malformed.some((r) => r.section === 'AI-Parsed JD Summary'), false);
});

test('every row carries all three columns', () => {
  for (const row of buildDetailRows(jdSend, mainMrf)) {
    assert.equal(typeof row.section, 'string');
    assert.equal(typeof row.field, 'string');
    assert.ok('value' in row);
  }
});
