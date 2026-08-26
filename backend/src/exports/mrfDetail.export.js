/**
 * Single-requisition CSV export — the file behind the Export button in the MRF
 * details modal (MRF.jsx).
 *
 * Deliberately NOT shaped like mrf.export.js. That one exports a LIST: one row
 * per requisition, columns across. This exports ONE requisition carrying ~65
 * fields, and a 65-column single-row file is unreadable — you scroll sideways
 * forever to find one value. So the layout is transposed:
 *
 *     Section, Field, Value
 *
 * one row per field, grouped by the same sections the modal renders. The
 * trade-off accepted here is that the file does not stack with other exports
 * (you cannot concatenate two of them into a table) — a per-record detail
 * sheet is read, printed and forwarded, not pivoted.
 *
 * Because every value shares one `Value` column, per-column `type: 'date'` is
 * unavailable: date fields are formatted as the rows are built, via the same
 * formatDate/formatDateTime helpers the column-based specs get for free.
 *
 * The field/label tables below mirror MAIN_MRF_FIELD_GROUPS and OTHER_DEPENDENTS
 * in frontend/src/pages/MRF.jsx, so the CSV reads with the same labels, the same
 * grouping and the same order as the modal it was taken from. Duplicated rather
 * than imported because the two packages share no module — the same arrangement
 * MAIN_MRF_EDITABLE_FIELDS in mrf.controller.js already lives with.
 */
import prisma from '../config/database.js';
import AppError from '../utils/AppError.js';
import { isMrfFilled } from '../config/pipelineStages.js';
import { formatDate, formatDateTime } from '../utils/csvExport.js';

/**
 * Workflow tag labels, mirroring getWorkflowSummaryTags() in MRF.jsx.
 *
 * NOT the same mapping as mrfStatusLabel() in mrf.export.js, and that is not an
 * oversight: the LIST table renders `managersubmitted` as "MANAGER SUBMITTED"
 * while the MODAL renders it as "COMPLETED". This file is taken from the modal,
 * so it has to read like the modal — a user comparing the two would otherwise
 * think the export had picked up a different record.
 */
export function mrfRaiseLabel(status) {
  const s = (status || '').trim().toLowerCase();
  if (s === 'closed') return 'CLOSED';
  if (s === 'managersubmitted' || s === 'manager submitted') return 'COMPLETED';
  if (s === 'pending' || s === 'pendingfromleader' || s === '') return 'PENDING';
  return s.toUpperCase();
}

/**
 * Human label for rpa_mrf.closure_reason (Q34).
 *
 * Falls through to a de-underscored upper-case form rather than '—' for an
 * unrecognised value, so a reason added to MRF_CLOSURE_REASONS later still
 * exports legibly instead of silently reading as "no reason recorded".
 */
export function mrfClosureReasonLabel(reason) {
  const r = (reason || '').trim().toLowerCase();
  if (!r) return '—';
  if (r === 'all_openings_filled') return 'ALL OPENINGS FILLED';
  if (r === 'budget_withdrawn') return 'BUDGET WITHDRAWN';
  if (r === 'role_withdrawn') return 'ROLE WITHDRAWN';
  if (r === 'hired_externally') return 'HIRED EXTERNALLY';
  if (r === 'on_hold_indefinitely') return 'ON HOLD INDEFINITELY';
  if (r === 'other') return 'OTHER';
  return r.replace(/_/g, ' ').toUpperCase();
}

/** Approval tag label, mirroring getWorkflowSummaryTags() in MRF.jsx. */
export function mrfApprovalLabel(status) {
  const s = (status || '').trim().toLowerCase();
  // Rows closed before fill state moved to its own column — their real approval
  // status was destroyed at closure time (see prisma/ddl/2026-08-11-mrf-filled-at.README.md).
  if (s === 'closed') return 'CLOSED (legacy)';
  if (s === 'approved' || s === 'completed') return 'APPROVED';
  if (s === 'rejected') return 'REJECTED';
  if (s === 'waiting') return 'WAITING';
  return s ? s.toUpperCase() : 'PENDING';
}

/** Section 3 of the modal, group by group. Mirrors MAIN_MRF_FIELD_GROUPS. */
const MAIN_MRF_FIELD_GROUPS = [
  {
    title: 'Position',
    fields: [
      ['hiring_manager_name', 'Hiring Manager Name'],
      ['hiring_manager_designation', 'HM Designation'],
      ['date_of_request', 'Date of Submission'],
      ['position_hiring_for', 'Position Hiring For'],
      ['number_of_positions', 'Number of Positions'],
      ['required_in', 'Required In'],
      ['position_reports_to', 'Position Reports To'],
      ['employment_type', 'Employment Type'],
    ],
  },
  {
    title: 'Requirement & Experience',
    fields: [
      ['requirement_for_team', 'Requirement for Team'],
      ['requirement_for_team_other', 'Requirement for Team (Other)'],
      ['desired_qualification', 'Desired Qualification'],
      ['pg_information', 'PG Information'],
      ['graduate_other_information', 'Graduate / Other Info'],
      ['other_qualification_more_info', 'Other Qualification Info'],
      ['replacement_or_new_role', 'Replacement or New Role'],
      ['replacement_comments', 'Replacement Comments'],
      ['total_years_of_experience', 'Total Years of Experience'],
      ['relevant_years_of_experience', 'Relevant Years of Experience'],
      ['project_name', 'Project Name'],
      ['project_duration', 'Project Duration'],
      ['existing_resource_information', 'Existing Resource Info'],
    ],
  },
  {
    title: 'Skills & Responsibilities',
    fields: [
      ['roles_responsibilities', 'Roles & Responsibilities'],
      ['roles_responsibilities_other', 'Roles & Responsibilities (Other)'],
      ['mandatory_skills', 'Mandatory Skills'],
      ['mandatory_skills_other', 'Mandatory Skills (Other)'],
      ['good_to_have_skills', 'Good to Have Skills'],
      ['good_to_have_skills_other', 'Good to Have Skills (Other)'],
      ['competencies_required', 'Competencies Required'],
    ],
  },
  {
    title: 'Interview Process',
    fields: [
      ['first_technical_round', '1st Technical Round'],
      ['second_technical_round', '2nd Technical Round'],
      ['ceo_management_round', 'CEO / Management Round'],
      ['ceo_panel_details', 'CEO Panel Details'],
      ['hr_round', 'HR Round'],
      ['client_round', 'Client Round'],
      ['client_round_coordinator', 'Client Round Coordinator'],
      ['job_timing', 'Job Timing'],
      ['first_round_interview_slot', 'Interview Slot (Round 1)'],
      ['second_round_interview_slot', 'Interview Slot (Round 2)'],
      ['weekly_meeting_slot', 'Weekly Meeting Slot'],
    ],
  },
  {
    title: 'Additional',
    fields: [
      ['client_details', 'Client Details'],
      ['additional_information', 'Additional Information'],
      ['question_paper_new_owner', 'Question Paper New Owner'],
      ['jd_document_link', 'JD Document Link'],
    ],
  },
];

/**
 * "Other" detail fields → the select that gates them. The modal only renders
 * these when their select reads "Other", so the export only emits them then —
 * otherwise the file would carry stale text the user cannot see on screen.
 */
const OTHER_DEPENDENTS = {
  roles_responsibilities_other: 'roles_responsibilities',
  mandatory_skills_other: 'mandatory_skills',
  good_to_have_skills_other: 'good_to_have_skills',
};

/** Date-only fields of rpa_mrf (rendered as "12 August 2026" in the modal). */
const MAIN_MRF_DATE_FIELDS = new Set(['date_of_request']);

/**
 * parsed_jd_json is a Json column, but rows written before it was typed can
 * hold the JSON as a string. Accept both, never throw on malformed content.
 */
function parseJdJson(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** "3 - 7 years", or '' when the parser found neither bound. */
function experienceRange(jd) {
  const min = jd.min_experience_years;
  const max = jd.max_experience_years;
  if (min == null && max == null) return '';
  return `${min ?? ''} - ${max ?? ''} years`;
}

export const columns = [
  { header: 'Section', key: 'section' },
  { header: 'Field', key: 'field' },
  { header: 'Value', key: 'value' },
];

/**
 * Flatten one requisition into Section/Field/Value rows, in the order the modal
 * lays them out: workflow summary, the request, then the submitted MRF.
 *
 * Pure — no Prisma, no request — so the row shape can be reasoned about (and
 * tested) without a database.
 *
 * @param {object} jdSend  rpa_mrf_jd_send row
 * @param {object|null} mainMrf  linked rpa_mrf row, when the HM has submitted
 * @returns {Array<{section: string, field: string, value: *}>}
 */
export function buildDetailRows(jdSend, mainMrf) {
  const rows = [];
  const push = (section, field, value) => rows.push({ section, field, value });

  // ── Workflow summary (the tags at the top of the modal) ─────────────
  push('Workflow', 'MRF Raise Status', mrfRaiseLabel(jdSend.mrfstatus));
  push('Workflow', 'MRF Approval Status', mrfApprovalLabel(mainMrf?.approval_status));
  // Independent of approval status — a requisition can be approved AND filled.
  push('Workflow', 'Openings Filled', isMrfFilled(mainMrf) ? 'YES' : 'NO');
  push('Workflow', 'Filled On', formatDateTime(mainMrf?.filled_at));
  // Manual business closure (Q34) is reported separately and NOT folded into
  // "Openings Filled" above: a requisition cancelled without hiring anyone was
  // never filled, and this row is the one place that distinction is visible.
  push('Workflow', 'Closed By Business', mainMrf?.closed_at ? 'YES' : 'NO');
  push('Workflow', 'Closed On', formatDateTime(mainMrf?.closed_at));
  push('Workflow', 'Closure Reason', mrfClosureReasonLabel(mainMrf?.closure_reason));
  push('Workflow', 'Closure Note', mainMrf?.closure_note || '—');

  // ── Section 2: New MRF Request Info (rpa_mrf_jd_send) ───────────────
  const REQUEST = 'New MRF Request';
  // Ids and CC Email are not on screen, but a file that has left the app needs
  // to be traceable back to the record it came from.
  push(REQUEST, 'MRF Request ID', jdSend.id);
  push(REQUEST, 'First Name', jdSend.first_name);
  push(REQUEST, 'Last Name', jdSend.last_name);
  push(REQUEST, 'Manager Email', jdSend.email);
  push(REQUEST, 'CC Email', jdSend.cc_email);
  push(REQUEST, 'Position Title', jdSend.role);
  // Raw numbers, not "₹1,20,000" — so the values still add up in Excel.
  push(REQUEST, 'Min Budget (INR)', jdSend.budget_min);
  push(REQUEST, 'Max Budget (INR)', jdSend.budget_max);
  push(REQUEST, 'JD Resource', jdSend.jd_doc_link);
  push(REQUEST, 'Form Submission Date', formatDate(jdSend.created_at));
  push(REQUEST, 'Linked MRF ID', jdSend.mrf_id);

  // ── Section 3: Submitted MRF Details (rpa_mrf) ──────────────────────
  // Omitted entirely when the Hiring Manager has not submitted yet, exactly as
  // the modal hides the whole section rather than showing empty fields.
  if (!mainMrf) return rows;

  for (const group of MAIN_MRF_FIELD_GROUPS) {
    const section = `Submitted MRF — ${group.title}`;
    for (const [name, label] of group.fields) {
      const trigger = OTHER_DEPENDENTS[name];
      if (trigger && String(mainMrf[trigger] || '').toLowerCase() !== 'other') continue;

      const raw = mainMrf[name];
      push(section, label, MAIN_MRF_DATE_FIELDS.has(name) ? formatDate(raw) : raw);
    }
  }

  const jd = parseJdJson(mainMrf.parsed_jd_json);
  if (jd) {
    const AI = 'AI-Parsed JD Summary';
    push(AI, 'Experience Range (AI)', experienceRange(jd));
    push(AI, 'Education (AI)', jd.education);
    push(AI, 'Mandatory Skills (AI)', jd.mandatory_skills);
    push(AI, 'Good to Have Skills (AI)', jd.good_to_have_skills);
    push(AI, 'Roles & Responsibilities (AI)', jd.roles_and_responsibilities);
  }

  return rows;
}

/** The record id comes from the path, not the query string. */
export function parseFilters(req) {
  return { id: req.params.id };
}

/** @type {import('./runExport.js').ExportSpec['fetch']} */
export async function fetch({ filters }) {
  const { id } = filters;

  // Guard before BigInt() — a non-numeric path segment would throw a raw
  // SyntaxError and surface as a 500 instead of "not found".
  if (!/^\d+$/.test(String(id || ''))) {
    throw new AppError('MRF Request not found.', 404);
  }

  const jdSend = await prisma.rpa_mrf_jd_send.findUnique({ where: { id: BigInt(id) } });
  if (!jdSend) {
    throw new AppError('MRF Request not found.', 404);
  }

  // A dangling mrf_id (linked row deleted) exports as an unsubmitted
  // requisition rather than failing the whole download.
  const mainMrf = jdSend.mrf_id
    ? await prisma.rpa_mrf.findUnique({ where: { id: BigInt(jdSend.mrf_id) } })
    : null;

  return buildDetailRows(jdSend, mainMrf);
}

export default { columns, fetch, parseFilters, buildDetailRows, mrfRaiseLabel, mrfApprovalLabel };
