/**
 * MRF Page — Replicates the legacy New MRF Request page.
 * Contains:
 *   1) New MRF Request Form (Hiring Manager details, CC emails, budget, JD link, and email body template)
 *   2) Submitted Records Listing (Search records, Status filter tabs, Export CSV, and paginated table)
 */
import { useState, useEffect } from 'react';
/* Button comes from src/ui — a raw AntD button renders flat inside <DesignScope>,
   which zeroes AntD's own shadow on the assumption `.ui-btn` repaints the glow. */
import { Form, Input, Card, Table, Tag, Row, Col, Space, Typography, message, InputNumber, Modal, Select, Tooltip } from 'antd';
import { SendOutlined, ClearOutlined } from '@ant-design/icons';
import mrfService from '../services/mrfService';
import ExportButton from '../components/common/ExportButton';
import { FIELDS as MRF_SUBMIT_FIELDS } from './MrfSubmit';
import { DesignScope, PageShell, PageHeader, Surface, Button, Segmented, FieldValue } from '../ui';
// Imported after '../ui' on purpose: page rules must land after the component layer
// in the cascade so they win on equal specificity.
import '../styles/pages/mrf.css';

const { Title, Text } = Typography;
const { TextArea } = Input;

// Same email pattern the n8n MRF form uses for main and CC email validation.
const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

// CC Email is optional, but when provided it must be a comma-separated list of
// valid emails with no trailing comma/semicolon — mirrors the n8n form rules.
const validateCcEmail = (_, value) => {
  const ccEmail = (value || '').trim();
  if (!ccEmail) return Promise.resolve();

  if (/[;,]\s*$/.test(ccEmail)) {
    return Promise.reject(new Error('CC Email should not end with comma or semicolon'));
  }

  const ccEmails = ccEmail.split(',').map((e) => e.trim()).filter((e) => e !== '');
  if (ccEmails.length === 0) {
    return Promise.reject(new Error('Please enter a valid CC email address'));
  }

  const invalidEmails = ccEmails.filter((e) => !EMAIL_PATTERN.test(e));
  if (invalidEmails.length > 0) {
    return Promise.reject(new Error(`Invalid CC Email(s): ${invalidEmails.join(', ')}`));
  }

  return Promise.resolve();
};

// Hint text shown as a placeholder only (never submitted as real content) — see Fixes/mrf-default-email-body.md
const DEFAULT_EMAIL_BODY = `As discussed, we would like to initiate the hiring process for this position.

We request you to kindly fill out the Manpower Requisition Form (MRF) using the link below. This will help us clearly capture the role requirements and move forward with job creation and publishing.`;

// Field type/options lookup, sourced from the canonical Hiring Manager form (MrfSubmit.jsx)
// so the recruiter edit modal below renders the same widget (dropdown, number, etc.) the
// Hiring Manager originally saw for each field.
const MAIN_MRF_FIELD_TYPES = Object.fromEntries(
  MRF_SUBMIT_FIELDS
    .filter((f) => !f.section && !f.transient && f.type !== 'file')
    .map((f) => [f.name, f])
);

// Editable fields of the submitted main MRF (rpa_mrf), grouped for the modal UI.
// Mirrors the backend whitelist in mrf.controller.js (MAIN_MRF_EDITABLE_FIELDS).
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

// Columns holding a URL rather than prose. Not derivable from MAIN_MRF_FIELD_TYPES:
// these have no entry in MrfSubmit's FIELDS at all, which is why they fall through to
// a plain Input when edited.
const URL_FIELDS = new Set(['jd_document_link']);

// The link view of a URL column. Form.Item hands the value down as `value`; the anchor
// needs it as `href` as well, and the full URL stays reachable on hover rather than
// being spelled out across seven lines.
const MainMrfLinkValue = ({ value }) => (
  <FieldValue href={value} title={value || undefined}>
    {value ? <>Open document &nbsp;&thinsp;↗</> : null}
  </FieldValue>
);

// Renders the correct widget for a Main MRF field based on its canonical type from
// MrfSubmit.jsx — Select for dropdowns (legacy values not in the option list are kept
// visible via an extra option rather than rendering blank), InputNumber for numeric
// fields, TextArea for long-form text, plain Input otherwise.
const renderMainMrfField = (name, currentValue, isEditing) => {
  const meta = MAIN_MRF_FIELD_TYPES[name];

  // VIEW MODE IS NOT THE DISABLED STATE. Form.Item clones `value` onto whatever sits
  // here, so FieldValue reads the same store the editable control writes — nothing is
  // re-seeded on the way in or out of edit, and the row keeps --ctl-h so the dialog
  // does not jump.
  if (!isEditing) {
    // A URL is a link when you are reading, and a string when you are editing it.
    // Left as raw text this one wrapped to SEVEN lines of SharePoint query string —
    // an input hid that behind a single-line scroll. `MrfApprovalAction` already
    // renders the same column as a link, so this is the established treatment.
    if (URL_FIELDS.has(name)) return <MainMrfLinkValue />;
    return <FieldValue multiline={meta?.type === 'textarea'} />;
  }

  if (meta?.type === 'select') {
    const options = meta.options || [];
    const hasLegacyValue = currentValue && !options.includes(currentValue);
    return (
      <Select className="mrf-full" placeholder="Select your answer">
        {hasLegacyValue && <Select.Option value={currentValue}>{currentValue}</Select.Option>}
        {options.map((opt) => (
          <Select.Option key={opt} value={opt}>{opt}</Select.Option>
        ))}
      </Select>
    );
  }

  if (meta?.type === 'number') {
    return <InputNumber min={0} max={60} className="mrf-full" />;
  }

  if (meta?.type === 'textarea') {
    return <TextArea rows={3} />;
  }

  return <Input />;
};

// Raise-status codes as the workflow writes them, mapped to what a reader should
// see. View mode shows the label; edit mode still shows the (disabled) Select, whose
// options carry the same strings.
const MRF_STATUS_LABELS = {
  pending: 'Pending',
  pendingfromleader: 'Pending from Leader',
  managersubmitted: 'Manager Submitted',
  closed: 'Closed — all openings filled',
};

// Live rows carry raise-status codes the Select's own option list never had — #181
// reads `approved`. The Select rendered those raw and so does this, sentence-cased so
// a legacy code does not sit next to "Manager Submitted" looking like a bug. Never
// invents a label: an unknown code is shown, not swallowed.
const mrfStatusLabel = (code) => {
  if (!code) return code;
  return MRF_STATUS_LABELS[code] ?? (code.charAt(0).toUpperCase() + code.slice(1));
};

// "Other" detail fields → the select that gates them. The detail textarea is only
// shown (and only saved) when its select is "Other"; otherwise it's hidden/cleared.
const OTHER_DEPENDENTS = {
  roles_responsibilities_other: 'roles_responsibilities',
  mandatory_skills_other: 'mandatory_skills',
  good_to_have_skills_other: 'good_to_have_skills',
};

export default function MRF() {
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const [mainForm] = Form.useForm();
  // Watch the main form so the "Other" detail fields show/hide reactively.
  const mainValues = Form.useWatch([], mainForm) || {};
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [records, setRecords] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  
  // Table filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusTab, setStatusTab] = useState('All'); // 'All', 'pending', 'manager submitted'

  // Details and edit modal state
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState(null);
  // Manual requisition closure (Q34).
  const [closeMrfOpen, setCloseMrfOpen] = useState(false);
  const [closeMrfReason, setCloseMrfReason] = useState(null);
  const [closeMrfNote, setCloseMrfNote] = useState('');
  const [closureReasons, setClosureReasons] = useState([]);
  const [mrfClosurePending, setMrfClosurePending] = useState(false);
  // Requisition pause — distinct from closure: still open/hiring, just
  // temporarily out of new candidate sourcing.
  const [pauseMrfOpen, setPauseMrfOpen] = useState(false);
  const [pauseMrfReason, setPauseMrfReason] = useState('');
  const [mrfPausePending, setMrfPausePending] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [updating, setUpdating] = useState(false);

  // Submitted main MRF (rpa_mrf) state — loaded when the record has a linked mrf_id
  const [mainMrf, setMainMrf] = useState(null);
  const [mainMrfLoading, setMainMrfLoading] = useState(false);

  const formatSubmittedDate = (val) => {
    if (!val) return '';
    const date = new Date(val);
    const day = date.getDate();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[date.getMonth()];
    const year = date.getFullYear();
    
    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'pm' : 'am';
    hours = hours % 12;
    hours = hours ? hours : 12;
    
    return `${day} ${month} ${year}, ${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
  };

  const getWorkflowSummaryTags = (record) => {
    if (!record) return { raise: { label: 'PENDING', color: 'gold' }, approval: { label: 'PENDING', color: 'gold' } };
    
    const mrfStatusStr = (record.mrfstatus || '').trim().toLowerCase();
    let raiseLabel = 'PENDING';
    let raiseColor = 'gold';
    if (mrfStatusStr === 'closed') {
      // Set automatically once every opening on the requisition is filled.
      raiseLabel = 'CLOSED';
      raiseColor = 'default';
    } else if (mrfStatusStr === 'managersubmitted' || mrfStatusStr === 'manager submitted') {
      raiseLabel = 'COMPLETED';
      raiseColor = 'success';
    } else if (mrfStatusStr === 'pending' || mrfStatusStr === 'pendingfromleader') {
      raiseLabel = 'PENDING';
      raiseColor = 'gold';
    } else {
      raiseLabel = mrfStatusStr.toUpperCase();
      if (raiseLabel.includes('COMPLETED') || raiseLabel.includes('APPROV')) {
        raiseColor = 'success';
      } else if (raiseLabel.includes('REJECT')) {
        raiseColor = 'error';
      } else {
        raiseColor = 'gold';
      }
    }

    const approvalStatusStr = (record.approval_status || '').trim().toLowerCase();
    let approvalLabel = 'PENDING';
    let approvalColor = 'gold';
    if (approvalStatusStr === 'closed') {
      // LEGACY only — rows closed before fill state moved to its own column.
      // Their real approval status was destroyed at closure time and cannot be
      // recovered; see prisma/ddl/2026-08-11-mrf-filled-at.README.md.
      approvalLabel = 'CLOSED (legacy)';
      approvalColor = 'default';
    } else if (approvalStatusStr === 'approved' || approvalStatusStr === 'completed') {
      approvalLabel = 'APPROVED';
      approvalColor = 'success';
    } else if (approvalStatusStr === 'rejected') {
      approvalLabel = 'REJECTED';
      approvalColor = 'error';
    } else if (approvalStatusStr === 'waiting') {
      approvalLabel = 'WAITING';
      approvalColor = 'gold';
    } else {
      approvalLabel = approvalStatusStr ? approvalStatusStr.toUpperCase() : 'PENDING';
      approvalColor = approvalLabel.includes('COMPLETE') || approvalLabel.includes('APPROV') ? 'success' : 'gold';
    }

    return {
      raise: { label: raiseLabel, color: raiseColor },
      approval: { label: approvalLabel, color: approvalColor }
    };
  };

  // Seeds the "New MRF Request" form from a record snapshot — used both on open and on Cancel.
  const seedEditForm = (record) => {
    editForm.resetFields();
    editForm.setFieldsValue({
      first_name: record.first_name,
      last_name: record.last_name,
      email: record.email,
      budget_min: record.budget_min,
      budget_max: record.budget_max,
      jd_doc_link: record.jd_doc_link,
      role: record.role,
      mrfstatus: record.mrfstatus || 'pending',
    });
  };

  const handleOpenDetailsModal = (record) => {
    setSelectedRecord(record);
    setIsEditing(false);
    setMainMrf(null);
    mainForm.resetFields();
    seedEditForm(record);
    setDetailsOpen(true);

    // If the Hiring Manager has submitted, load the full main MRF for view/edit.
    if (record.mrf_id) {
      loadMainMrf(record.mrf_id);
    }
  };

  // Fetch the submitted main MRF (rpa_mrf) and populate the main edit form.
  const loadMainMrf = async (mrfId) => {
    setMainMrfLoading(true);
    try {
      const res = await mrfService.getMain(mrfId);
      const data = res.data?.data || res.data;
      setMainMrf(data);
      mainForm.resetFields();
      mainForm.setFieldsValue(data || {});
    } catch (err) {
      message.error(err?.message || 'Failed to load submitted MRF details.');
    } finally {
      setMainMrfLoading(false);
    }
  };

  // ── Manual requisition closure (Q34) ────────────────────────────────
  //
  // Writes rpa_mrf.closed_at, never approval_status or mrfstatus. The "MRF
  // Raise Status" Select stays disabled for exactly that reason: overwriting
  // that column to express closure is the lossy bug removed on 2026-08-11.

  // Vocabulary comes from the server so the UI cannot drift from
  // MRF_CLOSURE_REASONS. Fetched lazily, the first time the modal is opened.
  useEffect(() => {
    if (!closeMrfOpen || closureReasons.length > 0) return;
    mrfService.getClosureReasons()
      .then((res) => setClosureReasons(res.data?.data || res.data || []))
      .catch(() => message.error('Could not load the closure reasons.'));
  }, [closeMrfOpen, closureReasons.length]);

  const refreshAfterClosure = async () => {
    // Re-read the row so the CLOSED tag and the button state both follow the
    // server rather than being guessed locally.
    if (selectedRecord?.id) {
      try {
        const res = await mrfService.getById(selectedRecord.id);
        setSelectedRecord(res.data?.data || res.data);
      } catch { /* the list refresh below still corrects the view */ }
    }
    loadRecords(page, searchQuery, statusTab);
  };

  const handleCloseMrf = async () => {
    if (!closeMrfReason) return;
    setMrfClosurePending(true);
    try {
      await mrfService.close(selectedRecord.mrf_id, {
        reason: closeMrfReason,
        note: closeMrfNote.trim() || null,
      });
      message.success('Requisition closed — it has left JD filtering.');
      setCloseMrfOpen(false);
      setCloseMrfReason(null);
      setCloseMrfNote('');
      await refreshAfterClosure();
    } catch (err) {
      message.error(err?.response?.data?.message || err?.message || 'Could not close the requisition.');
    } finally {
      setMrfClosurePending(false);
    }
  };

  const handleReopenMrf = async () => {
    setMrfClosurePending(true);
    try {
      await mrfService.reopen(selectedRecord.mrf_id);
      message.success('Requisition re-opened — it is back in JD filtering.');
      await refreshAfterClosure();
    } catch (err) {
      message.error(err?.response?.data?.message || err?.message || 'Could not re-open the requisition.');
    } finally {
      setMrfClosurePending(false);
    }
  };

  // ── Requisition pause ───────────────────────────────────────────────
  //
  // Writes rpa_mrf.paused_at, never closed_at/filled_at/approval_status/
  // mrfstatus. Distinct from Close: a paused requisition is still open, just
  // temporarily out of new candidate sourcing.

  const handlePauseMrf = async () => {
    if (!pauseMrfReason.trim()) return;
    setMrfPausePending(true);
    try {
      await mrfService.pause(selectedRecord.mrf_id, { reason: pauseMrfReason.trim() });
      message.success('Requisition paused — it has left JD filtering.');
      setPauseMrfOpen(false);
      setPauseMrfReason('');
      await refreshAfterClosure();
    } catch (err) {
      message.error(err?.response?.data?.message || err?.message || 'Could not pause the requisition.');
    } finally {
      setMrfPausePending(false);
    }
  };

  const handleResumeMrf = async () => {
    setMrfPausePending(true);
    try {
      await mrfService.resume(selectedRecord.mrf_id);
      message.success('Requisition resumed — it is back in JD filtering.');
      await refreshAfterClosure();
    } catch (err) {
      message.error(err?.response?.data?.message || err?.message || 'Could not resume the requisition.');
    } finally {
      setMrfPausePending(false);
    }
  };

  // Saves whichever section(s) actually have unsaved changes — "New MRF Request"
  // (rpa_mrf_jd_send) and/or "Submitted MRF Details" (rpa_mrf) — via their separate
  // endpoints, in parallel. A failure in one section never blocks or discards the other.
  const handleSaveAll = async () => {
    if (!selectedRecord) return;

    const editTouched = editForm.isFieldsTouched();
    const mainTouched = !!mainMrf && mainForm.isFieldsTouched();

    if (!editTouched && !mainTouched) {
      setIsEditing(false);
      return;
    }

    setUpdating(true);
    const tasks = [];

    if (editTouched) {
      tasks.push(
        editForm
          .validateFields()
          .then((values) =>
            // NOTE: mrfstatus (raise status) is intentionally NOT sent — it is
            // workflow-managed and display-only here. Recruiter edits must never
            // change the MRF status, no matter how many times the record is edited.
            mrfService.update(selectedRecord.id, {
              first_name: values.first_name,
              last_name: values.last_name,
              email: values.email,
              budget_min: values.budget_min,
              budget_max: values.budget_max,
              jd_doc_link: values.jd_doc_link,
              role: values.role,
            })
          )
          .then(() => ({ key: 'New MRF Request', ok: true }))
          .catch((err) => ({ key: 'New MRF Request', ok: false, err }))
      );
    }

    if (mainTouched) {
      tasks.push(
        mainForm
          .validateFields()
          .then((values) => {
            // Clear any "Other" detail text whose select is no longer "Other".
            const cleaned = { ...values };
            Object.entries(OTHER_DEPENDENTS).forEach(([otherKey, trigger]) => {
              if (String(cleaned[trigger] || '').toLowerCase() !== 'other') cleaned[otherKey] = null;
            });
            return mrfService.updateMain(mainMrf.id, cleaned);
          })
          .then(() => ({ key: 'Submitted MRF Details', ok: true }))
          .catch((err) => ({ key: 'Submitted MRF Details', ok: false, err }))
      );
    }

    const results = await Promise.all(tasks);
    setUpdating(false);

    const failed = results.filter((r) => !r.ok);
    const succeeded = results.filter((r) => r.ok);

    if (failed.length === 0) {
      message.success('MRF details updated successfully.');
      setIsEditing(false);
    } else {
      failed.forEach((r) => {
        message.error(
          r.err?.errorFields
            ? `${r.key}: please fix the highlighted fields.`
            : `${r.key}: ${r.err?.message || 'Failed to save changes.'}`
        );
      });
    }

    if (succeeded.some((r) => r.key === 'New MRF Request')) {
      loadRecords(page, searchQuery, statusTab);
    }
    if (succeeded.some((r) => r.key === 'Submitted MRF Details') && mainMrf) {
      await loadMainMrf(mainMrf.id);
    }
  };

  // Discards unsaved edits in both sections and exits edit mode.
  const handleCancelEdit = () => {
    if (selectedRecord) seedEditForm(selectedRecord);
    if (mainMrf) mainForm.setFieldsValue(mainMrf);
    setIsEditing(false);
  };

  // Load MRF records
  const loadRecords = async (pageNum = page, currentSearch = searchQuery, currentStatus = statusTab) => {
    setLoading(true);
    try {
      const res = await mrfService.list({
        search: currentSearch,
        status: currentStatus === 'All' ? '' : currentStatus,
        page: pageNum,
        limit: pageSize,
      });
      if (res.data) {
        const list = Array.isArray(res.data.data) ? res.data.data : [];
        const paginationObj = res.data.pagination || {};
        setRecords(list);
        setTotal(paginationObj.total || list.length);
      }
    } catch (err) {
      message.error('Failed to load MRF records.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRecords(page, searchQuery, statusTab);
  }, [page]);

  // Handle submit new MRF
  const handleSubmit = async (values) => {
    // Budget validation — mirrors the n8n MRF form rules
    // (Budget Min >= 10,000 and Budget Max > Budget Min).
    const min = Number(values.budget_min);
    const max = Number(values.budget_max);
    if (Number.isNaN(min) || Number.isNaN(max)) {
      message.error('Budget values must be valid numbers.');
      return;
    }
    if (min < 10000) {
      message.error('Budget Min should be at least 10,000.');
      return;
    }
    if (max <= min) {
      message.error('Budget Max must be greater than Budget Min.');
      return;
    }

    setSubmitting(true);
    try {
      await mrfService.create({
        first_name: values.first_name,
        last_name: values.last_name,
        email: values.email,
        cc_email: values.cc_email,
        role: values.role,
        jd_doc_link: values.jd_doc_link,
        budget_min: values.budget_min,
        budget_max: values.budget_max,
        email_body_content: values.email_body_content,
      });

      message.success('MRF Request submitted successfully!');
      form.resetFields();
      setPage(1);
      loadRecords(1, searchQuery, statusTab);
    } catch (err) {
      message.error(err?.message || 'Failed to submit MRF request.');
    } finally {
      setSubmitting(false);
    }
  };

  // Handle clear form
  const handleClear = () => {
    form.resetFields();
  };

  // Handle search record input changes
  const handleSearchChange = (e) => {
    const val = e.target.value;
    setSearchQuery(val);
    setPage(1);
    loadRecords(1, val, statusTab);
  };

  // Handle status tab filters changes. Takes the VALUE — Segmented is a real
  // radiogroup of buttons, not an AntD control, so there is no event to unwrap.
  const handleStatusFilterChange = (val) => {
    setStatusTab(val);
    setPage(1);
    loadRecords(1, searchQuery, val);
  };

  const formatCurrency = (val) => {
    if (val === undefined || val === null) return '—';
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(Number(val));
  };

  const columns = [
    {
      title: 'FIRST NAME',
      dataIndex: 'first_name',
      key: 'first_name',
      render: (text) => <Text className="mrf-cell">{text}</Text>,
    },
    {
      title: 'LAST NAME',
      dataIndex: 'last_name',
      key: 'last_name',
      render: (text) => <Text className="mrf-cell">{text}</Text>,
    },
    {
      title: 'EMAIL',
      dataIndex: 'email',
      key: 'email',
      render: (text) => <Text className="mrf-mono">{text}</Text>,
    },
    {
      title: 'ROLE',
      dataIndex: 'role',
      key: 'role',
      render: (text) => <Text strong className="mrf-cell--strong">{text}</Text>,
    },
    {
      title: 'MIN BUDGET',
      dataIndex: 'budget_min',
      key: 'budget_min',
      render: (val) => <Text className="mrf-mono">{formatCurrency(val)}</Text>,
    },
    {
      title: 'MAX BUDGET',
      dataIndex: 'budget_max',
      key: 'budget_max',
      render: (val) => <Text className="mrf-mono">{formatCurrency(val)}</Text>,
    },
    {
      title: 'MRF STATUS',
      dataIndex: 'mrfstatus',
      key: 'mrfstatus',
      render: (status, record) => {
        const statusStr = (status || '').trim().toLowerCase();
        let displayStatus = 'PENDING';
        let color = 'gold';

        if (statusStr === 'managersubmitted' || statusStr === 'manager submitted') {
          displayStatus = 'MANAGER SUBMITTED';
          color = 'success';
        } else if (statusStr === 'pending' || statusStr === 'pendingfromleader') {
          displayStatus = 'PENDING';
          color = 'gold';
        } else {
          displayStatus = (status || '').toUpperCase();
          if (displayStatus.includes('MANAGER') || displayStatus.includes('APPROV')) {
            color = 'success';
          } else if (displayStatus.includes('REJECT')) {
            color = 'error';
          } else {
            color = 'gold';
          }
        }

        return (
          <Space size={4} wrap>
            <Tag color={color} className="mrf-tag mrf-tag--caps">
              {displayStatus}
            </Tag>
            {record?.mrf_filled && (
              <Tooltip title="Every opening on this requisition has been filled, so it no longer appears in JD filtering.">
                <Tag color="success" className="mrf-tag">
                  FILLED
                </Tag>
              </Tooltip>
            )}
            {record?.mrf_closed_at && (
              <Tooltip title={`Closed by a recruiter${record?.mrf_closure_reason ? ` — ${String(record.mrf_closure_reason).replace(/_/g, ' ')}` : ''}. It is out of JD filtering until it is re-opened.`}>
                <Tag color="red" className="mrf-tag">
                  CLOSED
                </Tag>
              </Tooltip>
            )}
            {record?.mrf_paused_at && (
              <Tooltip title={`Paused by a recruiter${record?.mrf_paused_reason ? `: ${record.mrf_paused_reason}` : ''}. It is out of JD filtering until it is resumed.`}>
                <Tag color="orange" className="mrf-tag">
                  PAUSED
                </Tag>
              </Tooltip>
            )}
          </Space>
        );
      },
    },
    {
      title: 'CREATED DATE',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (val) => {
        if (!val) return '—';
        const date = new Date(val);
        const options = { day: 'numeric', month: 'short', year: 'numeric' };
        return <Text className="mrf-cell">{date.toLocaleDateString('en-GB', options)}</Text>;
      },
    },
  ];

  return (
    <DesignScope>
      <PageShell width="standard" className="stagger-children">
      {/* MRF Create Request Form Card — tier 2, this page's feature surface.
          Radius and shadow now come from `.glass-card`; the green `borderTop`
          rail goes for the same reason it went on /candidates — a flat bar under
          a gradient rim is the pre-glass vocabulary showing through. */}
      {/* Page header, lifted out of the form card — 2026-08-31. Same change as
          /candidates: `Title level={3}` is 20px against the lab's 32px, and a title
          nested inside a tier-2 Surface reads as that card's label.

          The old markup put "Hiring Manager Details" BELOW the title in `.mrf-eyebrow`
          — an eyebrow's styling (uppercase, brand ink) in a subtitle's position. It is
          not a subtitle: it labels the first section of the form. So it stays with the
          form as a section heading and the page gets a real subtitle saying what the
          screen is for. */}
      <PageHeader
        eyebrow="Requisitions"
        title="New MRF Request"
        subtitle="Raise a Manpower Requisition Form to open a role for hiring. It goes to the approver before recruiting starts."
      />

      <Surface tier={2} padding="relaxed" bloom className="mrf-mb-6">
        <div className="mrf-mb-5">
          <Text type="secondary" className="mrf-eyebrow">
            Hiring Manager Details
          </Text>
        </div>

        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          className="mrf-form"
        >
          <Row gutter={16}>
            <Col xs={24} sm={8}>
              <Form.Item
                label={<span className="mrf-label">First Name</span>}
                name="first_name"
                rules={[{ required: true, message: 'Required' }]}
              >
                <Input placeholder="e.g. Abhijit" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item
                label={<span className="mrf-label">Last Name</span>}
                name="last_name"
                rules={[{ required: true, message: 'Required' }]}
              >
                <Input placeholder="e.g. Roy" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item
                label={<span className="mrf-label">Email</span>}
                name="email"
                rules={[{ required: true, message: 'Required' }, { pattern: EMAIL_PATTERN, message: 'Please enter a valid Email' }]}
              >
                <Input placeholder="e.g. aroy@aapnainfotech.com" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col xs={24} sm={8}>
              <Form.Item
                label={<span className="mrf-label">CC Email (Keep Comma Separated)</span>}
                name="cc_email"
                rules={[{ validator: validateCcEmail }]}
              >
                <Input placeholder="e.g. example1@aapnainfotech.com, example2@aapnainfotech.com" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item
                label={<span className="mrf-label">Role</span>}
                name="role"
                rules={[{ required: true, message: 'Required' }]}
              >
                <Input placeholder="e.g. Senior Software Engineer" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item
                label={<span className="mrf-label">JD Link</span>}
                name="jd_doc_link"
                rules={[{ required: true, message: 'Required' }]}
              >
                <Input placeholder="e.g. https://link-to-jd.com" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item
                label={<span className="mrf-label">Budget Min (Annual CTC)</span>}
                name="budget_min"
                rules={[{ required: true, message: 'Required' }]}
              >
                <InputNumber
                  placeholder="Min 1,00,000 (e.g. 5,00,000)"
                  formatter={value => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  parser={value => value.replace(/\$\s?|(,*)/g, '')}
                  className="mrf-radio-cell"
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                label={<span className="mrf-label">Budget Max (Annual CTC)</span>}
                name="budget_max"
                rules={[{ required: true, message: 'Required' }]}
              >
                <InputNumber
                  placeholder="e.g. 10,00,000"
                  formatter={value => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  parser={value => value.replace(/\$\s?|(,*)/g, '')}
                  className="mrf-radio-cell"
                />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            label={<span className="mrf-label">Email Body</span>}
            name="email_body_content"
          >
            <Input.TextArea rows={5} placeholder={DEFAULT_EMAIL_BODY} />
          </Form.Item>

          <Space size={12}>
            <Button
              emphasis="solid"
              size="lg"
              htmlType="submit"
              icon={<SendOutlined />}
              loading={submitting}
            >
              Submit Request
            </Button>
            <Button
              emphasis="soft"
              tone="neutral"
              size="lg"
              onClick={handleClear}
              icon={<ClearOutlined />}
            >
              Clear
            </Button>
          </Space>
        </Form>
      </Surface>

      {/* Submitted MRF Records Listing Table Card — tier 3, reusing exactly what
          Phase 3 verified on /candidates. */}
      <Surface tier={3} padding="none">
        {/* Table Toolbar */}
        <div className="mrf-toolbar">
          <div className="mrf-toolbar__group">
            <span className="mrf-group-label">
              Records
            </span>
            <Input
              placeholder="Search records..."
              value={searchQuery}
              onChange={handleSearchChange}
              className="mrf-search"
            />
            {/* The design system's Segmented, not AntD's Radio.Group. The group it
                replaces was six tab stops instead of one, 15px/400 instead of the
                13px/600 every other tab bar in the app uses, and painted its selected
                cell with a raw solid brand fill on a 15px-0-0-15px joined slab. The
                values are unchanged, so loadRecords and the CSV export query are
                untouched by the swap. */}
            <Segmented
              aria-label="Filter records by status"
              value={statusTab}
              onChange={handleStatusFilterChange}
              options={[
                { value: 'All', label: 'All' },
                { value: 'pending', label: 'Pending' },
                { value: 'manager submitted', label: 'Manager Submitted' },
                { value: 'filled', label: 'Filled' },
                { value: 'paused', label: 'Paused' },
                { value: 'closed', label: 'Closed' },
              ]}
            />
          </div>
          <ExportButton
            request={(cfg) => mrfService.exportCsv(
              { search: searchQuery, status: statusTab === 'All' ? '' : statusTab },
              cfg,
            )}
            fallbackName="AAPNA-ATS_MRF-Requests.csv"
            rowCount={total}
          />
        </div>

        {/* Records Table */}
        <Table
          dataSource={records}
          columns={columns}
          rowKey="id"
          loading={loading}
          onRow={(record) => ({
            onClick: () => handleOpenDetailsModal(record),
            style: { cursor: 'pointer' },
          })}
          pagination={{
            current: page,
            pageSize: pageSize,
            total: total,
            onChange: setPage,
            showSizeChanger: false,
            style: { paddingRight: 20 },
          }}
        />
      </Surface>

      {/* 2) VIEW/EDIT MRF DETAILS MODAL (High Fidelity) */}
      <Modal
        title={
          selectedRecord && (
            <div className="mrf-modal-head">
              <div className="mrf-modal-title">
                {selectedRecord.first_name} {selectedRecord.last_name} — {selectedRecord.role}
              </div>
              <div className="mrf-hint">
                Submitted {formatSubmittedDate(selectedRecord.created_at)} &bull; ID #{selectedRecord.id}
              </div>
            </div>
          )
        }
        open={detailsOpen}
        onCancel={() => { setDetailsOpen(false); setIsEditing(false); setMainMrf(null); }}
        width={800}
        footer={[
          isEditing ? (
            <Space key="footer-edit">
              <Button emphasis="soft" tone="neutral" onClick={handleCancelEdit}>
                Cancel
              </Button>
              <Button emphasis="solid" onClick={handleSaveAll} loading={updating}>
                Save Changes
              </Button>
            </Space>
          ) : (
            <Space key="footer-view">
              {/* Exports this one requisition — both the request and the MRF the
                  Hiring Manager submitted. View mode only: the file is built from
                  the database, so offering it mid-edit would hand back values that
                  silently disagree with the unsaved ones on screen. */}
              <ExportButton
                request={(cfg) => mrfService.exportDetailCsv(selectedRecord?.id, cfg)}
                fallbackName={`AAPNA-ATS_MRF-${selectedRecord?.id}.csv`}
              />
              <Button emphasis="soft" onClick={() => setIsEditing(true)}>
                Edit
              </Button>
              <Button emphasis="soft" tone="neutral" onClick={() => setDetailsOpen(false)}>
                Close
              </Button>
            </Space>
          )
        ]}
        classNames={{ body: 'mrf-modal-body' }}
      >
        {selectedRecord && (
          <div>
            {/* Section 1: Workflow Summary */}
            <div className="mrf-note-box">
              <div className="mrf-group-label mrf-group-label--gap">
                Workflow Summary
              </div>
              <Row gutter={16}>
                <Col span={12}>
                  <Space>
                    <span className="mrf-label">MRF Raise Status:</span>
                    <Tag color={getWorkflowSummaryTags(selectedRecord).raise.color} className="mrf-tag">
                      {getWorkflowSummaryTags(selectedRecord).raise.label}
                    </Tag>
                  </Space>
                </Col>
                <Col span={12} className="mrf-right">
                  <Space>
                    <span className="mrf-label">MRF Approval Status:</span>
                    <Tag color={getWorkflowSummaryTags(selectedRecord).approval.color} className="mrf-tag">
                      {getWorkflowSummaryTags(selectedRecord).approval.label}
                    </Tag>
                    {/* Independent of approval status — a requisition can be
                        approved/completed AND have all its openings filled.
                        Shown alongside rather than replacing it, because the
                        two used to share one column and that destroyed the
                        approval value. */}
                    {selectedRecord?.mrf_filled && (
                      <Tooltip title="Every opening on this requisition has been filled, so it no longer appears in JD filtering. It re-opens automatically if a hire falls through.">
                        <Tag color="success" className="mrf-tag">
                          FILLED
                        </Tag>
                      </Tooltip>
                    )}
                    {/* Closed by the business (Q34) — a DIFFERENT fact from
                        FILLED: budget pulled, role withdrawn, hired externally.
                        Before closed_at existed such a requisition had no
                        representation at all and sat in the JD dropdown for
                        good. */}
                    {selectedRecord?.mrf_closed_at && (
                      <Tooltip title={`Closed by a recruiter${selectedRecord?.mrf_closure_reason ? ` — ${String(selectedRecord.mrf_closure_reason).replace(/_/g, ' ')}` : ''}${selectedRecord?.mrf_closure_note ? `: ${selectedRecord.mrf_closure_note}` : ''}. It is out of JD filtering until it is re-opened.`}>
                        <Tag color="red" className="mrf-tag">
                          CLOSED
                        </Tag>
                      </Tooltip>
                    )}
                    {/* Paused — a THIRD independent fact from Filled/Closed. The
                        requisition is still open/hiring, just temporarily out of
                        new candidate sourcing. */}
                    {selectedRecord?.mrf_paused_at && (
                      <Tooltip title={`Paused by a recruiter${selectedRecord?.mrf_paused_reason ? `: ${selectedRecord.mrf_paused_reason}` : ''}. It is out of JD filtering until it is resumed.`}>
                        <Tag color="orange" className="mrf-tag">
                          PAUSED
                        </Tag>
                      </Tooltip>
                    )}
                  </Space>
                </Col>
              </Row>

              {/* Manual close / re-open (Q34).
                  Deliberately NOT wired to the "MRF Raise Status" Select above,
                  which stays disabled: mrfstatus is the protected raise-status
                  workflow column, and expressing closure by overwriting it is
                  the lossy bug removed on 2026-08-11. This writes closed_at. */}
              {selectedRecord?.mrf_id && (
                <div className="mrf-modal-foot">
                  {selectedRecord?.mrf_closed_at ? (
                    <Button
                      size="sm"
                      emphasis="soft"
                      loading={mrfClosurePending}
                      onClick={handleReopenMrf}
                    >
                      Re-open requisition
                    </Button>
                  ) : selectedRecord?.mrf_filled ? (
                    <span className="mrf-caption--muted">
                      All openings are filled — this requisition closed itself.
                    </span>
                  ) : selectedRecord?.mrf_paused_at ? (
                    <Button
                      size="sm"
                      emphasis="soft"
                      loading={mrfPausePending}
                      onClick={handleResumeMrf}
                    >
                      Resume requisition
                    </Button>
                  ) : (
                    <Space>
                      <Button
                        size="sm"
                        emphasis="soft"
                        tone="neutral"
                        loading={mrfPausePending}
                        onClick={() => setPauseMrfOpen(true)}
                      >
                        Pause…
                      </Button>
                      {/* `tone="danger"`, not AntD's `danger` prop — closing a
                          requisition is the destructive action in this group and the
                          tone feeds --ui-tone/--ui-glow, so it survives a preset or
                          tenant swap. `soft` rather than `solid`: it sits beside two
                          neutral controls, and a glowing red button in a detail
                          footer overstates a reversible action. */}
                      <Button
                        size="sm"
                        emphasis="soft"
                        tone="danger"
                        loading={mrfClosurePending}
                        onClick={() => setCloseMrfOpen(true)}
                      >
                        Close requisition…
                      </Button>
                    </Space>
                  )}
                </div>
              )}
            </div>

            {/* Section 2: New MRF Request Info */}
            <div className="mrf-group-label mrf-group-label--brand mrf-group-label--gap-lg">
              New MRF Request Info
            </div>

            <Form
              form={editForm}
              layout="vertical"
              /* Kept even though view mode renders no controls: a field missed by the
                 view/edit swap degrades to the old disabled behaviour rather than
                 silently becoming editable. */
              disabled={!isEditing}
              /* A required marker is an instruction, and in view mode there is nothing
                 to act on — the rules themselves stay, so saving still validates. */
              requiredMark={isEditing}
            >
              <Row gutter={16}>
                <Col span={6}>
                  <Form.Item
                    label={<span className="mrf-label">First Name</span>}
                    name="first_name"
                    rules={[{ required: true, message: 'Required' }]}
                  >
                    {isEditing ? <Input /> : <FieldValue />}
                  </Form.Item>
                </Col>
                <Col span={6}>
                  <Form.Item
                    label={<span className="mrf-label">Last Name</span>}
                    name="last_name"
                    rules={[{ required: true, message: 'Required' }]}
                  >
                    {isEditing ? <Input /> : <FieldValue />}
                  </Form.Item>
                </Col>
                <Col span={6}>
                  <Form.Item
                    label={<span className="mrf-label">Manager Email</span>}
                    name="email"
                    rules={[{ required: true, message: 'Required' }, { type: 'email', message: 'Invalid email' }]}
                  >
                    {isEditing ? <Input className="mrf-mono" /> : <FieldValue className="mrf-mono" />}
                  </Form.Item>
                </Col>
                <Col span={6}>
                  <Form.Item
                    label={<span className="mrf-label">Budget Min</span>}
                    name="budget_min"
                    rules={[{ required: true, message: 'Required' }]}
                  >
                    {isEditing ? (
                      <InputNumber
                        formatter={value => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                        parser={value => value.replace(/\$\s?|(,*)/g, '')}
                        className="mrf-full"
                      />
                    ) : (
                      // The records table already renders budgets through formatCurrency;
                      // view mode reads from the same helper so the modal cannot disagree
                      // with the row that opened it.
                      <FieldValue format={formatCurrency} />
                    )}
                  </Form.Item>
                </Col>
              </Row>

              <Row gutter={16}>
                <Col span={6}>
                  <Form.Item
                    label={<span className="mrf-label">Budget Max</span>}
                    name="budget_max"
                    rules={[{ required: true, message: 'Required' }]}
                  >
                    {isEditing ? (
                      <InputNumber
                        formatter={value => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                        parser={value => value.replace(/\$\s?|(,*)/g, '')}
                        className="mrf-full"
                      />
                    ) : (
                      // The records table already renders budgets through formatCurrency;
                      // view mode reads from the same helper so the modal cannot disagree
                      // with the row that opened it.
                      <FieldValue format={formatCurrency} />
                    )}
                  </Form.Item>
                </Col>
                <Col span={6}>
                  <Form.Item
                    label={<span className="mrf-label">JD Resource</span>}
                    name="jd_doc_link"
                    rules={[{ required: true, message: 'Required' }]}
                  >
                    {isEditing ? (
                      <Input placeholder="JD document link" />
                    ) : (
                      <FieldValue href={selectedRecord.jd_doc_link}>
                        View Document &nbsp;&thinsp;↗
                      </FieldValue>
                    )}
                  </Form.Item>
                </Col>
              </Row>

              <Row gutter={16}>
                <Col span={24}>
                  <Form.Item
                    label={<span className="mrf-label">Position Title</span>}
                    name="role"
                    rules={[{ required: true, message: 'Required' }]}
                  >
                    {isEditing ? <Input /> : <FieldValue />}
                  </Form.Item>
                </Col>
              </Row>

              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item
                    label={<span className="mrf-label">MRF Raise Status</span>}
                    name="mrfstatus"
                  >
                    {isEditing ? (
                      <Select className="mrf-full" disabled>
                        <Select.Option value="pending">Pending</Select.Option>
                        <Select.Option value="pendingfromleader">Pending from Leader</Select.Option>
                        <Select.Option value="managersubmitted">Manager Submitted</Select.Option>
                        <Select.Option value="closed">Closed — all openings filled</Select.Option>
                      </Select>
                    ) : (
                      <FieldValue format={mrfStatusLabel} />
                    )}
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item
                    label={<span className="mrf-label">Form Submission Date</span>}
                  >
                    {/* Display-only in BOTH modes — a submission date is a fact, not a
                        field. It was a `readOnly disabled` Input, which said "you may
                        not type here" when the truth is "there is nothing to type". */}
                    <FieldValue>
                      {selectedRecord.created_at ? new Date(selectedRecord.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null}
                    </FieldValue>
                  </Form.Item>
                </Col>
              </Row>
            </Form>

            {/* Section 3: Submitted MRF Details (rpa_mrf) — only when HM has submitted */}
            {selectedRecord.mrf_id && (
              <div className="mrf-section-rule">
                <div className="mrf-mb-4">
                  <span className="mrf-group-label mrf-group-label--brand">
                    Submitted MRF Details
                  </span>
                </div>

                {mainMrfLoading ? (
                  <Text type="secondary" className="mrf-caption">Loading submitted MRF details…</Text>
                ) : mainMrf ? (
                  <Form form={mainForm} layout="vertical" disabled={!isEditing} requiredMark={isEditing}>
                    {MAIN_MRF_FIELD_GROUPS.map((group) => (
                      <div key={group.title} className="mrf-mb-2">
                        <div className="mrf-group-label mrf-group-label--stack">
                          {group.title}
                        </div>
                        <Row gutter={16}>
                          {group.fields.map(([name, label]) => {
                            // "Other" detail fields only render when their select is "Other".
                            const trigger = OTHER_DEPENDENTS[name];
                            if (trigger && String(mainValues[trigger] || '').toLowerCase() !== 'other') {
                              return null;
                            }
                            return (
                            <Col span={12} key={name}>
                              {name === 'date_of_request' ? (
                                // Read-only display only — never bound to mainForm, so it can
                                // never be touched/submitted (submission dates stay non-editable).
                                <Form.Item label={<span className="mrf-label">{label}</span>}>
                                  <FieldValue>
                                    {mainMrf.date_of_request ? new Date(mainMrf.date_of_request).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null}
                                  </FieldValue>
                                </Form.Item>
                              ) : (
                                <Form.Item
                                  label={<span className="mrf-label">{label}</span>}
                                  name={name}
                                >
                                  {renderMainMrfField(name, mainMrf?.[name], isEditing)}
                                </Form.Item>
                              )}
                            </Col>
                            );
                          })}
                        </Row>
                      </div>
                    ))}

                    {mainMrf.parsed_jd_json && (
                      <div className="mrf-section-rule--dashed">
                        <div className="mrf-group-label mrf-group-label--stack">
                          AI-Parsed JD Summary
                        </div>
                        <Row gutter={16}>
                          <Col span={12}>
                            <Form.Item label={<span className="mrf-label">Experience Range (AI)</span>}>
                              <FieldValue
                                value={`${mainMrf.parsed_jd_json.min_experience_years ?? '—'} - ${mainMrf.parsed_jd_json.max_experience_years ?? '—'} years`}
                              />
                            </Form.Item>
                          </Col>
                          <Col span={12}>
                            <Form.Item label={<span className="mrf-label">Education (AI)</span>}>
                              <FieldValue value={mainMrf.parsed_jd_json.education} />
                            </Form.Item>
                          </Col>
                          <Col span={12}>
                            <Form.Item label={<span className="mrf-label">Mandatory Skills (AI)</span>}>
                              <FieldValue multiline value={mainMrf.parsed_jd_json.mandatory_skills} />
                            </Form.Item>
                          </Col>
                          <Col span={12}>
                            <Form.Item label={<span className="mrf-label">Good to Have Skills (AI)</span>}>
                              <FieldValue multiline value={mainMrf.parsed_jd_json.good_to_have_skills} />
                            </Form.Item>
                          </Col>
                          <Col span={24}>
                            <Form.Item label={<span className="mrf-label">Roles & Responsibilities (AI)</span>}>
                              <FieldValue multiline value={mainMrf.parsed_jd_json.roles_and_responsibilities} />
                            </Form.Item>
                          </Col>
                        </Row>
                      </div>
                    )}
                  </Form>
                ) : (
                  <Text type="secondary" className="mrf-caption">No submitted MRF details available.</Text>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Close a requisition by hand (Q34). A reason is mandatory — the audit's
          complaint was that closure recorded WHEN but never WHY, and 'other'
          without a note would reproduce that one level down. */}
      <Modal
        open={closeMrfOpen}
        onCancel={() => setCloseMrfOpen(false)}
        title="Close requisition"
        okText="Close it"
        okButtonProps={{
          danger: true,
          disabled: !closeMrfReason || (closeMrfReason === 'other' && !closeMrfNote.trim()),
        }}
        confirmLoading={mrfClosurePending}
        onOk={handleCloseMrf}
      >
        <Space direction="vertical" size={12} className="mrf-full">
          <div className="mrf-sub--muted">
            This takes the role out of JD filtering and the screening dropdowns straight away.
            Candidates already in progress against it are <strong>not</strong> touched — close or
            pause their journeys individually if that is what you intend.
          </div>
          <div>
            <Text strong className="mrf-sub">Reason <Text type="danger">*</Text></Text>
            <Select
              className="mrf-full mrf-mt-1"
              placeholder="Why is this requisition closing?"
              value={closeMrfReason}
              onChange={setCloseMrfReason}
              options={closureReasons}
            />
          </div>
          <div>
            <Text strong className="mrf-sub">
              Note {closeMrfReason === 'other' ? <Text type="danger">*</Text> : <Text type="secondary">(optional)</Text>}
            </Text>
            <Input.TextArea
              rows={2}
              className="mrf-mt-1"
              placeholder={closeMrfReason === 'other' ? 'Required — say what happened' : 'Any detail worth keeping'}
              value={closeMrfNote}
              onChange={(e) => setCloseMrfNote(e.target.value)}
            />
          </div>
        </Space>
      </Modal>

      {/* Pause a requisition. Distinct from Close: the role stays open/hiring,
          just temporarily out of JD filtering, and resumes with one click. */}
      <Modal
        open={pauseMrfOpen}
        onCancel={() => setPauseMrfOpen(false)}
        title="Pause requisition"
        okText="Pause it"
        okButtonProps={{ disabled: !pauseMrfReason.trim() }}
        confirmLoading={mrfPausePending}
        onOk={handlePauseMrf}
      >
        <Space direction="vertical" size={12} className="mrf-full">
          <div className="mrf-sub--muted">
            This takes the role out of JD filtering and the screening dropdowns until you resume
            it. Candidates already in progress against it are <strong>not</strong> touched — pause
            their journeys individually if that is what you intend.
          </div>
          <div>
            <Text strong className="mrf-sub">Reason <Text type="danger">*</Text></Text>
            <Input.TextArea
              rows={2}
              className="mrf-mt-1"
              placeholder="Why is this requisition pausing?"
              value={pauseMrfReason}
              onChange={(e) => setPauseMrfReason(e.target.value)}
            />
          </div>
        </Space>
      </Modal>
      </PageShell>
    </DesignScope>
  );
}
