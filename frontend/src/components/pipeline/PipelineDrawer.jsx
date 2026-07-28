/**
 * PipelineDrawer.jsx — per-stage drawer for the real Pipeline Tracker
 * (Phase 3 Module 1). Wired to the actual /api/pipeline endpoints, but
 * reuses the same visual language CandidatePipelinePrototype.jsx settled on
 * after several rounds of RT feedback (v8–v11 changelogs under
 * docs/changelog/): stage-pill navigator instead of numbered Steps, and a
 * unified always-expanded vertical 4-stage pipeline per round (Invite Sent →
 * Awaiting Interview/Test/Upload/Response → Awaiting Results/Verification →
 * Approve-Reject/Accepted-Declined) instead of a flat Descriptions table.
 * Reuses the existing `.cp-pipeline`/`.cp-stage-pill`/`.cp-stat-chip` CSS
 * already defined in theme/index.css for the prototype — no new styles.
 *
 * Shortlisting happens on Candidate Screening, not as a stage in this
 * pipeline (v8+ direction) — the real board/drawer no longer has a
 * "Shortlisted" stage; journeys enter directly at HR Screening (Zeko).
 * Shortlist context (date/by/notes/resume) is shown as a persistent
 * read-only header line instead, sourced from the real `screening` field
 * getPipelineDetail returns — no invented JD-match score (no such field
 * exists in the schema; that part of the prototype is mock-only).
 *
 * Unlike the prototype, only stages Module 1 actually has real data for
 * (Zeko score sync, and the outcome/event log itself) render live content in
 * stages 1–3 of the pipeline; other round types honestly show "not
 * available yet" for scheduling/scorecard/docs/offer sub-states, since
 * Modules 2/3 aren't built. Stage 4 (the decision) is always real — it's
 * driven by the actual outcome event, for every stage type.
 *
 * The action bar (Approve/Reject/Hold) always requires a reason on
 * Reject/Hold (L5/Q19); "Other reasons" requires typed free text that is
 * what gets displayed/stored everywhere — never the literal word "Other"
 * (RT, 2026-07-14). Actions only apply to the CURRENT stage.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, App as AntApp, Avatar, Button, Card, DatePicker, Drawer, Empty, Input, Modal, Popconfirm, Select, Space, Spin, Tag, Tooltip, Typography,
} from 'antd';
import {
  BoldOutlined, CalendarOutlined, CheckOutlined, CloseOutlined, FileTextOutlined,
  ItalicOutlined, LinkOutlined, MailOutlined, PauseCircleOutlined, SendOutlined, UnderlineOutlined, UserOutlined,
} from '@ant-design/icons';
import DOMPurify from 'dompurify';
import pipelineService from '../../services/pipeline';
import screeningService from '../../services/screeningService';
import assessmentImportService from '../../services/assessmentImportService';
import settingsService from '../../services/settingsService';
import AssessmentInviteModal from './AssessmentInviteModal';

const { Text, Title } = Typography;
const { TextArea } = Input;
const { RangePicker } = DatePicker;

const SANITIZE_OPTS = { WHOLE_DOCUMENT: true, ADD_ATTR: ['target'] };
const EDITOR_CONTENT_CSS = `
  html, body { margin: 0; }
  body { padding: 12px 14px; font-family: inherit; font-size: 13.5px; -webkit-font-smoothing: antialiased; }
  body:focus { outline: none; }
`;

/**
 * Lightweight WYSIWYG for the outcome-email body — the same designMode
 * iframe + DOMPurify sanitization pattern EmailManagement.jsx uses for full
 * template authoring, scaled down to just what a "review before send" step
 * needs: a small Bold/Italic/Underline/Link toolbar, no CodeMirror source
 * tab or placeholder-insertion tooling (the template is already compiled by
 * the time this renders — there are no placeholders left to insert).
 */
function SimpleHtmlEditor({ value, onChange }) {
  const iframeRef = useRef(null);
  const savedSelRef = useRef(null);
  // srcDoc only needs to reset when a *different* preview loads, not on every
  // keystroke — otherwise the iframe would reload (and lose the caret) as the
  // recruiter types. valueKey below tracks that.
  const srcDoc = useMemo(
    () => DOMPurify.sanitize(value || '<p>Empty.</p>', SANITIZE_OPTS),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const syncFromEditor = () => {
    const doc = iframeRef.current?.contentDocument;
    if (doc && doc.designMode === 'on') {
      const clone = doc.documentElement.cloneNode(true);
      clone.querySelectorAll('style[data-editor-css]').forEach((el) => el.remove());
      onChange(clone.outerHTML);
    }
  };

  const handleLoad = () => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    doc.designMode = 'on';
    const style = doc.createElement('style');
    style.textContent = EDITOR_CONTENT_CSS;
    style.setAttribute('data-editor-css', '1');
    doc.head?.appendChild(style);
    doc.addEventListener('input', syncFromEditor);
    doc.addEventListener('selectionchange', () => {
      const sel = doc.getSelection?.();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        if (doc.body?.contains(range.commonAncestorContainer)) {
          savedSelRef.current = range.cloneRange();
        }
      }
    });
  };

  const exec = (command, val = null) => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    iframeRef.current.contentWindow?.focus();
    const sel = doc.getSelection?.();
    if (sel && savedSelRef.current) {
      try { sel.removeAllRanges(); sel.addRange(savedSelRef.current); } catch { /* stale range */ }
    }
    try { doc.execCommand(command, false, val); } catch { /* noop */ }
    syncFromEditor();
  };

  const toolbarBtn = (icon, title, onClick) => (
    <Tooltip title={title}>
      <Button size="small" type="text" icon={icon} onMouseDown={(e) => e.preventDefault()} onClick={onClick} />
    </Tooltip>
  );

  return (
    <div style={{ border: '1px solid var(--ant-color-border)', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ display: 'flex', gap: 2, padding: '4px 6px', borderBottom: '1px solid var(--ant-color-border)', background: 'var(--ink-3)' }}>
        {toolbarBtn(<BoldOutlined />, 'Bold', () => exec('bold'))}
        {toolbarBtn(<ItalicOutlined />, 'Italic', () => exec('italic'))}
        {toolbarBtn(<UnderlineOutlined />, 'Underline', () => exec('underline'))}
        {toolbarBtn(<LinkOutlined />, 'Insert link', () => {
          const url = window.prompt('Link URL (https://…)');
          if (url && url.trim()) exec('createLink', url.trim());
        })}
      </div>
      <iframe
        ref={iframeRef}
        title="Outcome email body"
        srcDoc={srcDoc}
        onLoad={handleLoad}
        style={{ width: '100%', height: 220, border: 'none', background: 'var(--ant-color-bg-container, #fff)' }}
      />
    </div>
  );
}

/** Outlined colors matching CandidatePipelinePrototype.jsx's round-panel action bar. */
const OUTCOME_BUTTONS = [
  { key: 'approved', label: 'Approve', icon: <CheckOutlined />, primary: true },
  { key: 'hold', label: 'Hold', icon: <PauseCircleOutlined />, style: { color: '#d4a017', borderColor: '#d4a017' } },
  { key: 'rejected', label: 'Reject', icon: <CloseOutlined />, danger: true },
];

const OUTCOME_TAG = {
  approved: { label: 'Approved', color: 'green' },
  rejected: { label: 'Rejected', color: 'red' },
  hold: { label: 'On Hold', color: 'gold' },
  future_prospect: { label: 'Future Prospect', color: 'blue' },
};

const STATE_WORD = { pending: 'Not started yet', active: 'In progress', done: 'Done', hold: 'On Hold', rejected: 'Rejected' };

function isZekoStageKey(key) {
  return key === 'zeko_hr' || key === 'zeko_fn';
}

/** Zeko score → chip colour band (RT, 2026-07-22): 80–100 green, 50–79 amber,
 * below 50 red. Maps onto the existing `.cp-stat-chip--good/mid/low` styles. */
function scoreBand(value) {
  if (value >= 80) return 'good';
  if (value >= 50) return 'mid';
  return 'low';
}

/**
 * Builds the "Awaiting Results" detail line + score chips from a synced Zeko
 * score row. `coding: false` drops the coding score entirely — both from the
 * chips and from the text line above them, so the round never reads
 * "Coding —" next to chips that don't include it.
 *
 * Scores Zeko didn't return are omitted rather than rendered as an em-dash
 * chip; when none came back at all the detail line says so instead of
 * degenerating into a row of dashes.
 */
function zekoScoreSegment(zekoScores, { coding = true } = {}) {
  const chips = [
    { value: zekoScores.ZekoInterviewScore, label: 'Interview' },
    ...(coding ? [{ value: zekoScores.ZekoCodingScore, label: 'Coding' }] : []),
    { value: zekoScores.ZekoCommunicationScore, label: 'Comms' },
  ].filter((c) => c.value != null);

  return {
    detail: chips.length > 0
      ? chips.map((c) => `${c.label === 'Comms' ? 'Communication' : c.label} ${c.value}`).join(' · ')
      : 'Score synced from Zeko — no numeric scores returned',
    chips,
  };
}

/**
 * Builds the "Awaiting Results" detail line + score chips from an Evalground
 * import result (Phase 3 M2). Section scores are raw marks (not percentages —
 * verified against the real sample export), so they're shown as plain
 * numbers rather than run through Zeko's 0–100 scoreBand() coloring, which
 * doesn't apply here.
 */
function assessmentScoreSegment(result) {
  const map = result.section_label_map || {};
  const sections = [
    { key: 'section_1', value: result.section_1_score },
    { key: 'section_2', value: result.section_2_score },
    { key: 'section_3', value: result.section_3_score },
  ].filter((s) => s.value !== null && s.value !== undefined);

  const chips = sections.map((s) => ({ value: s.value, label: map[s.key]?.skill_label || s.key.replace('section_', 'Section ') }));

  return {
    detail: (result.overall_result
      ? `Evalground result: ${result.overall_result}${result.overall_percentage != null ? ` (${result.overall_percentage}%)` : ''}`
      : chips.length > 0 ? chips.map((c) => `${c.label} ${c.value}`).join(' · ') : 'Result imported — no numeric scores returned'
    ) + (result.overall_marks_scored != null ? ` · Marks Scored: ${result.overall_marks_scored}` : ''),
  };
}

/** Same 4-stage wording per stage kind as the prototype's PIPELINE_LABELS.
 * zeko_hr's stage 2 reads "Schedule Interview" (not "Awaiting Interview") —
 * per RT feedback, this stage is where HR actually schedules the Zeko
 * interview, not a passive wait; the label should say what to DO here. */
const PIPELINE_LABELS = {
  zeko: ['Invite Sent', 'Schedule Interview', 'Awaiting Results', 'Approve / Reject'],
  manual: ['Invite Sent', 'Awaiting Test', 'Awaiting Results', 'Approve / Reject'],
  scheduled_interview: ['Invite Sent', 'Awaiting Interview', 'Awaiting Results', 'Approve / Reject'],
  document: ['Request Sent', 'Awaiting Upload', 'Awaiting Verification', 'Approve / Reject'],
  offer: ['Offer Prepared', 'Offer Sent', 'Awaiting Response', 'Accepted / Declined'],
};

/** Shortens an admin-configured stage label for the pill navigator. */
function shortStageLabel(label) {
  if (!label) return label;
  return label
    .replace('Screening (Zeko)', '(Zeko)')
    .replace('IQ / Tech Assessment', 'Assessment')
    .replace('Technical Round', 'Tech')
    .replace('Client Interview', 'Client')
    .replace('CEO / Final Round', 'CEO');
}

const ZEKO_HR_STATUS_WORD = { pending: 'assigned, not yet invited', sent: 'invited', completed: 'interview completed', cancelled: 'cancelled' };

function fmtDateTime(d) {
  return d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : null;
}

/**
 * Derives the real 4-stage pipeline for one stage, from whatever real data
 * exists — stage events, (for zeko_hr) the real Zeko job-assignment/schedule
 * row from Candidate Screening's existing flow, and (for both Zeko stages)
 * synced scores. No scheduling/scorecard/docs/offer sub-state modeling yet
 * for other stage types (Modules 2/3), so those stay honestly "not available
 * yet" on stages 1–3; stage 4 (decision) is always driven by the real
 * outcome event, for every stage type.
 *
 * zeko_fn intentionally does NOT get the same real invite/schedule treatment
 * as zeko_hr — rpa_zeko_candidate_pipeline.stage is hard-coded 'hr' every­
 * where it's written in screening.service.js, so there is no real backing
 * row for "functional screening" today; fabricating one would misrepresent
 * data that doesn't exist.
 *
 * Returns `emails`: a real (not mocked) email log line list, built only from
 * fields the backend actually persisted (rpa_zeko_candidate_pipeline.link_sent_at,
 * or the stage's own outcome-email dispatch flag) — never invented text.
 */
function buildPipelineSegments({ stage, stageEvents, isCurrent, zekoScores, zekoHrPipeline, screening, assessmentResult, assessmentInvite }) {
  const labels = PIPELINE_LABELS[stage.stage_type] || PIPELINE_LABELS.manual;
  const enteredEvent = stageEvents.find((ev) => ev.event_type === 'entered' || ev.event_type === 'skip');
  const outcomeEvent = [...stageEvents].reverse().find((ev) => ev.event_type === 'outcome');
  const emails = [];
  let showScheduleButton = false;
  let showInviteButton = false;

  let s1 = { state: 'pending', detail: 'Not sent yet' };
  let s2 = { state: 'pending', detail: 'Not started yet' };
  let s3 = { state: 'pending', detail: 'Not started yet' };
  let s4 = { state: 'pending', detail: 'Not yet' };

  // Assessment's "Invite Sent" is a real recruiter action (send/mark-manual),
  // not automatic — derived below from assessmentInvite instead of the
  // generic "candidate entered this stage" baseline every other stage uses.
  if (enteredEvent && stage.stage_key !== 'assessment') {
    s1 = { state: 'done', detail: `Candidate entered this stage ${new Date(enteredEvent.created_at).toLocaleDateString()}` };
  }

  if (stage.stage_key === 'zeko_hr') {
    // Stage 1 ("Invite Sent") = the shortlist-notice email — sent
    // automatically and immediately when the candidate was shortlisted on
    // Candidate Screening (rpa_shortlisted_candidates.email_sent/_at). This
    // is a real, already-sent email telling the candidate a Zeko interview
    // link is coming separately — NOT the Zeko invite itself.
    if (screening?.noticeEmailSent) {
      s1 = { state: 'done', detail: `Shortlist notice emailed ${screening.noticeEmailSentAt ? fmtDateTime(screening.noticeEmailSentAt) : ''}` };
      emails.push(`Shortlist notice ("Your Application Has Been Shortlisted") → candidate${screening.noticeEmailSentAt ? ` · ${fmtDateTime(screening.noticeEmailSentAt)}` : ''}`);
    } else if (enteredEvent) {
      s1 = { state: 'active', detail: 'Shortlist notice not yet confirmed sent' };
    }

    // Stage 2 ("Schedule Interview") = the real Zeko job-assignment/schedule
    // row from Candidate Screening's existing flow — surfaced + actionable
    // here via the "Schedule Interview"/"Change window" button.
    if (zekoHrPipeline) {
      const statusWord = ZEKO_HR_STATUS_WORD[zekoHrPipeline.status] || zekoHrPipeline.status;
      if (zekoHrPipeline.interview_start_at) {
        s2 = {
          state: zekoScores ? 'done' : 'active',
          detail: `Scheduled window · ${fmtDateTime(zekoHrPipeline.interview_start_at)}–${fmtDateTime(zekoHrPipeline.interview_end_at)?.split(', ')[1] || ''}`,
        };
        emails.push(`Zeko HR screening invite → candidate · ${fmtDateTime(zekoHrPipeline.link_sent_at)}`);
      } else if (zekoHrPipeline.link_sent_at) {
        s2 = { state: 'active', detail: 'Awaiting the candidate to self-schedule a slot' };
        emails.push(`Zeko HR screening invite → candidate · ${fmtDateTime(zekoHrPipeline.link_sent_at)}`);
      } else {
        s2 = { state: 'active', detail: `Assigned to a Zeko job — ${statusWord}` };
      }
    } else if (enteredEvent) {
      s2 = { state: 'pending', detail: 'Not yet assigned to a Zeko job' };
    }
    // Scheduling only makes sense while the round is genuinely open. Both
    // buttons hide once the interview is over (Zeko synced a score) and once
    // the round has been decided — approve/reject/hold all close it, and
    // scheduling or cancelling an interview for a rejected candidate is
    // meaningless (RT, 2026-07-22). Hidden rather than disabled: a decided
    // round has no pending action, so a greyed-out button is just noise.
    showScheduleButton = isCurrent && !zekoScores && !outcomeEvent;

    if (zekoScores) {
      // HR screening is a conversation, not a coding exercise — Zeko's coding
      // score isn't meaningful for this round, so it's suppressed here even
      // when the sync returns one (RT, 2026-07-22). zeko_fn below still shows
      // all three.
      s3 = { state: 'done', ...zekoScoreSegment(zekoScores, { coding: false }) };
    } else if (zekoHrPipeline?.link_sent_at) {
      s3 = { state: 'active', detail: 'Awaiting Zeko to sync the score' };
    }
  } else if (stage.stage_key === 'zeko_fn') {
    // No real backing table for functional-screening invites/scheduling yet
    // (see function header) — stay honest rather than reusing zeko_hr's row.
    if (zekoScores) {
      s2 = { state: 'done', detail: 'Interview completed' };
      s3 = { state: 'done', ...zekoScoreSegment(zekoScores) };
    } else if (enteredEvent) {
      s2 = { state: 'pending', detail: 'Not available yet — functional-screening invite/scheduling has no real data source today' };
      s3 = { state: 'pending', detail: 'Awaiting Zeko to sync the score, once invited' };
    }
  } else if (stage.stage_key === 'assessment') {
    // Phase 3 M2 — bulk-CSV Evalground import (results already land here even
    // though the round is still "manual"; there is no scheduling sub-state
    // for this stage type, results just arrive via import). "Invite Sent" is
    // a real recruiter action (send email / mark sent manually), with a
    // deadline that starts the moment an invite is recorded.
    const invite = assessmentInvite?.invite;
    if (assessmentResult) {
      // Result landed — invite history shown matter-of-factly, no action needed.
      if (invite) {
        s1 = { state: 'done', detail: `Invite ${invite.method === 'email' ? 'emailed' : 'marked sent manually'} · ${fmtDateTime(invite.sent_at)}` };
      }
      s2 = { state: 'done', detail: 'Result received (bulk CSV import)' };
      s3 = { state: 'done', ...assessmentScoreSegment(assessmentResult) };
    } else if (invite) {
      const overdue = assessmentInvite?.isOverdue;
      const daysLeft = Math.ceil((new Date(invite.deadline_at) - Date.now()) / (1000 * 60 * 60 * 24));
      s1 = overdue
        ? { state: 'active', detail: `Deadline passed ${Math.abs(daysLeft)} day(s) ago (was due ${fmtDateTime(invite.deadline_at)})` }
        : { state: 'done', detail: `Invite ${invite.method === 'email' ? 'emailed' : 'marked sent manually'} · ${fmtDateTime(invite.sent_at)} · deadline in ${daysLeft} day(s)` };
      s2 = { state: 'active', detail: 'Evalground test pending' };
      s3 = { state: 'pending', detail: 'Awaiting an Evalground result import' };
      showInviteButton = isCurrent; // re-invite always available once one exists and no result yet
    } else if (enteredEvent) {
      s1 = { state: 'active', detail: 'Not sent yet' };
      s2 = { state: 'pending', detail: 'Send the Evalground invite to start the test window' };
      s3 = { state: 'pending', detail: 'Awaiting an Evalground result import' };
      showInviteButton = isCurrent;
    }
  } else if (enteredEvent) {
    // Non-Zeko stage types have no real scheduling/scorecard/docs/offer data
    // model yet — honestly say so rather than fabricating a state.
    s2 = { state: 'pending', detail: 'Not available yet — needs Module 2/3 (scheduling/scorecards)' };
    s3 = { state: 'pending', detail: 'Not available yet — needs Module 2/3 (scheduling/scorecards)' };
  }

  if (outcomeEvent) {
    const tag = OUTCOME_TAG[outcomeEvent.outcome];
    if (outcomeEvent.outcome === 'approved') {
      s4 = { state: 'done', detail: `Approved${outcomeEvent.rpa_users?.username ? ` by ${outcomeEvent.rpa_users.username}` : ''} · ${new Date(outcomeEvent.created_at).toLocaleDateString()}` };
    } else if (outcomeEvent.outcome === 'rejected') {
      s4 = { state: 'rejected', detail: `${outcomeEvent.reason_text || tag?.label || 'Rejected'} · ${new Date(outcomeEvent.created_at).toLocaleDateString()}` };
    } else if (outcomeEvent.outcome === 'hold') {
      s4 = { state: 'hold', detail: `${outcomeEvent.reason_text || 'On Hold'} · ${new Date(outcomeEvent.created_at).toLocaleDateString()}` };
    } else {
      s4 = { state: 'done', detail: `${tag?.label || outcomeEvent.outcome} · ${new Date(outcomeEvent.created_at).toLocaleDateString()}` };
    }
    emails.push(`Outcome email → candidate · ${new Date(outcomeEvent.created_at).toLocaleDateString()} · ${outcomeEvent.email_sent ? 'delivered' : (outcomeEvent.email_error ? 'failed' : 'not sent')}`);
  } else if (isCurrent && s3.state === 'done') {
    s4 = { state: 'active', detail: 'Awaiting your decision' };
  } else if (isCurrent) {
    s4 = { state: 'pending', detail: 'Awaiting your decision once results are in' };
  }

  return {
    segments: [
      { key: 'invite', label: labels[0], ...s1 },
      { key: 'wait', label: labels[1], ...s2 },
      { key: 'results', label: labels[2], ...s3 },
      { key: 'decision', label: labels[3], ...s4 },
    ],
    emails,
    showScheduleButton,
    showInviteButton,
  };
}

export default function PipelineDrawer({ pipelineId, onClose, onChanged }) {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [selectedStageKey, setSelectedStageKey] = useState(null);
  const [decisionOutcome, setDecisionOutcome] = useState(null);
  const [outcomeModalOpen, setOutcomeModalOpen] = useState(false);
  const [reasonId, setReasonId] = useState(null);
  const [otherText, setOtherText] = useState('');
  const [notes, setNotes] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleJobId, setScheduleJobId] = useState(null);
  const [scheduleDates, setScheduleDates] = useState(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [inviteModalOpen, setInviteModalOpen] = useState(false);

  const open = !!pipelineId;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['pipeline-detail', pipelineId],
    queryFn: async () => {
      const res = await pipelineService.getPipelineDetail(pipelineId);
      return res.data?.data || res.data;
    },
    enabled: open,
  });

  const { data: stagesData } = useQuery({
    queryKey: ['pipeline-stages'],
    queryFn: async () => {
      const res = await pipelineService.listStages();
      return res.data?.data || res.data;
    },
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  // Phase 3 M2 — latest Evalground result (+ suggested outcome) for this
  // journey, if it's on the Assessment stage. Fetched once per open journey
  // (not re-fetched on every stage-pill click) — cheap enough at this scale.
  const { data: assessmentResultData } = useQuery({
    queryKey: ['assessment-result', pipelineId],
    queryFn: async () => {
      const res = await assessmentImportService.getCandidateResult(pipelineId);
      return res.data?.data || res.data;
    },
    enabled: open,
  });

  // Phase 3 M2 extension — latest Evalground invite (+ overdue state) for
  // this journey, if it's on the Assessment stage.
  const { data: assessmentInviteData } = useQuery({
    queryKey: ['assessment-invite', pipelineId],
    queryFn: async () => {
      const res = await assessmentImportService.getInviteState(pipelineId);
      return res.data?.data || res.data;
    },
    enabled: open,
  });

  // Deadline-days default, for the invite compose modal's template text.
  const { data: automationSettingsData } = useQuery({
    queryKey: ['assessment-automation-settings'],
    queryFn: async () => {
      const res = await settingsService.getAssessmentAutomation();
      return res.data?.data || res.data;
    },
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  const { data: zekoJobsData } = useQuery({
    queryKey: ['zeko-jobs'],
    queryFn: async () => {
      const res = await screeningService.getZekoJobs();
      return res.data?.data || res.data;
    },
    enabled: scheduleOpen,
    staleTime: 5 * 60 * 1000,
  });

  // Compiles the real outcome-email template (server-side, same logic that
  // will actually send) for whichever outcome the recruiter just clicked —
  // feeds the editable "Record round outcome" modal, matching the
  // prototype's decision-modal pattern instead of sending blind.
  const { data: previewData, isFetching: previewLoading } = useQuery({
    queryKey: ['pipeline-outcome-preview', pipelineId, decisionOutcome],
    queryFn: async () => {
      const res = await pipelineService.getOutcomePreview(pipelineId, decisionOutcome);
      return res.data?.data || res.data;
    },
    enabled: outcomeModalOpen && !!decisionOutcome,
  });

  // Tracks which preview payload emailSubject/emailBody currently reflect —
  // lets the modal wait for state to actually catch up before mounting the
  // iframe editor (a useEffect-driven state set lands one render AFTER
  // previewData/previewLoading flip, so gating on those alone would mount
  // the editor with a stale empty value for one frame).
  const [emailStateForKey, setEmailStateForKey] = useState(null);
  useEffect(() => {
    if (previewData) {
      setEmailSubject(previewData.subject || '');
      setEmailBody(previewData.body || '');
      setEmailStateForKey(previewData);
    }
  }, [previewData]);

  const pipeline = data?.pipeline;

  useEffect(() => {
    setDecisionOutcome(null);
    setOutcomeModalOpen(false);
    setReasonId(null);
    setOtherText('');
    setNotes('');
    setEmailSubject('');
    setEmailBody('');
    setSelectedStageKey(pipeline?.current_stage_key || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineId, pipeline?.current_stage_key]);

  const outcomeMutation = useMutation({
    mutationFn: (payload) => pipelineService.setStageOutcome(pipelineId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipeline-detail', pipelineId] });
      onChanged?.();
      setDecisionOutcome(null);
      setOutcomeModalOpen(false);
    },
    onError: (err) => {
      message.error(err?.message || 'Failed to record outcome.');
    },
  });

  // Real assign+schedule — the same POST /screening/analytics/assign and
  // /schedule endpoints Candidate Screening's drawer calls (screeningService.js),
  // just invoked from the Tracker instead of duplicating a second recruiter
  // workflow. Assign is a no-op (upsert) if already assigned to this job.
  const scheduleMutation = useMutation({
    mutationFn: async ({ shortlistId, zekoJobId, start, end }) => {
      await screeningService.assignZekoJob({ candidate_id: shortlistId, zeko_job_id: zekoJobId });
      return screeningService.scheduleZekoInterview({
        shortlist_id: shortlistId,
        zeko_job_id: zekoJobId,
        interview_start_at: start.toISOString(),
        interview_end_at: end.toISOString(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipeline-detail', pipelineId] });
      onChanged?.();
      message.success('Zeko interview scheduled — invitation email sent.');
      setScheduleOpen(false);
      setScheduleJobId(null);
      setScheduleDates(null);
    },
    onError: (err) => {
      message.error(err?.message || 'Failed to schedule the Zeko interview.');
    },
  });

  // Real cancel — same POST /screening/analytics/cancel endpoint as the
  // "Zeko Cancel Interview" flow on Recruitment Screening Analytics (Legacy).
  // Only one active schedule at a time: cancelling clears the row (status
  // 'cancelled', excluded by getPipelineDetail's zekoHrPipeline query), so
  // "Schedule Interview" reappears rather than "Change window" — reschedule
  // is cancel-then-recreate, not an in-place edit.
  const cancelMutation = useMutation({
    mutationFn: (reason) => screeningService.cancelZekoInterview({ pipeline_id: zekoHrPipeline.id, cancel_reason: reason || 'Cancelled from Pipeline Tracker' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipeline-detail', pipelineId] });
      onChanged?.();
      message.success('Zeko interview cancelled — candidate notified by email.');
      setCancelOpen(false);
      setCancelReason('');
    },
    onError: (err) => {
      message.error(err?.message || 'Failed to cancel the Zeko interview.');
    },
  });

  // Send (email) or record (manual) an Evalground invite — starts the
  // deadline clock on the backend (assessmentInvite.service.js).
  const inviteMutation = useMutation({
    mutationFn: (payload) => assessmentImportService.sendInvite({ pipeline_id: pipelineId, ...payload }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assessment-invite', pipelineId] });
      onChanged?.();
      message.success('Invite recorded.');
      setInviteModalOpen(false);
    },
    onError: (err) => {
      message.error(err?.message || 'Failed to record the invite.');
    },
  });

  if (!open) return null;

  const currentStageOutcomes = data?.currentStageOutcomes || [];
  const reasons = data?.reasons || [];
  const zekoScores = data?.zekoScores;
  const zekoHrPipeline = data?.zekoHrPipeline;
  const cvFileUrl = data?.cvFileUrl;
  const screening = data?.screening;
  const zekoJobs = zekoJobsData || [];
  const allStages = (stagesData || []).filter((s) => s.is_active).sort((a, b) => a.sort_order - b.sort_order);
  const currentIdx = allStages.findIndex((s) => s.stage_key === pipeline?.current_stage_key);
  const selectedIdx = allStages.findIndex((s) => s.stage_key === selectedStageKey);
  const isCurrentStageSelected = selectedStageKey === pipeline?.current_stage_key;
  const isReadyForDecision = !!zekoScores
    && isZekoStageKey(pipeline?.current_stage_key)
    && pipeline?.current_stage_status === 'in_progress';

  const openScheduleModal = () => {
    setScheduleJobId(zekoHrPipeline?.zeko_job_id || null);
    setScheduleDates(null);
    setScheduleOpen(true);
  };

  const submitSchedule = () => {
    if (!scheduleJobId) {
      message.error('Please select a Zeko job.');
      return;
    }
    if (!scheduleDates || scheduleDates.length !== 2) {
      message.error('Please pick an interview date & time range.');
      return;
    }
    scheduleMutation.mutate({
      shortlistId: pipeline.shortlist_id,
      zekoJobId: scheduleJobId,
      start: scheduleDates[0].toDate(),
      end: scheduleDates[1].toDate(),
    });
  };

  const openCancelModal = () => {
    setCancelReason('');
    setCancelOpen(true);
  };

  const submitCancel = () => {
    cancelMutation.mutate(cancelReason.trim());
  };

  // Mirrors the backend's vendorCcFor() (pipeline.service.js): the status-only
  // vendor cc is vendor-sourced only — a stale vendor_email on a
  // screening_shortlist journey must not promise a cc that won't be sent.
  const vendorCc = pipeline?.source === 'vendor' ? pipeline?.vendor_email : null;

  const isRejectOrHold = decisionOutcome === 'rejected' || decisionOutcome === 'hold';
  const selectedReason = reasons.find((r) => r.id === reasonId);

  // Opens the "Record round outcome" modal — mirrors the prototype's
  // decision modal: pick Approve/Hold/Reject, (for Reject/Hold) a mandatory
  // reason, and an editable preview of the real outcome email before send.
  const openOutcomeModal = (outcomeKey) => {
    const outcomeExists = currentStageOutcomes.some((o) => o.outcome_key === outcomeKey);
    if (!outcomeExists) {
      message.warning(`"${outcomeKey}" is not configured for this stage.`);
      return;
    }
    setDecisionOutcome(outcomeKey);
    setReasonId(null);
    setOtherText('');
    setNotes('');
    setEmailSubject('');
    setEmailBody('');
    setOutcomeModalOpen(true);
  };

  const submitOutcome = () => {
    if ((decisionOutcome === 'rejected' || decisionOutcome === 'hold') && !reasonId) {
      message.error('A reason is required for Reject/Hold.');
      return;
    }
    if (selectedReason?.is_other && !otherText.trim()) {
      message.error('Please type the reason — "Other" alone cannot be saved.');
      return;
    }
    outcomeMutation.mutate({
      outcome_key: decisionOutcome,
      reason_id: reasonId || undefined,
      other_text: selectedReason?.is_other ? otherText.trim() : undefined,
      notes: notes.trim() || undefined,
      email_subject: emailSubject,
      email_body: emailBody,
    });
  };

  const stageEvents = (pipeline?.rpa_pipeline_stage_events || []).filter((ev) => ev.stage_key === selectedStageKey);

  const renderStagePanel = () => {
    if (!pipeline) return null;
    const stage = allStages[selectedIdx];
    if (!stage) return null;

    if (stageEvents.length === 0) {
      return <Empty description="No activity in this stage yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
    }

    const isCurrent = stage.stage_key === pipeline.current_stage_key;
    const { segments: segs, emails, showScheduleButton, showInviteButton } = buildPipelineSegments({
      stage,
      stageEvents,
      isCurrent,
      zekoScores: isZekoStageKey(stage.stage_key) ? zekoScores : null,
      zekoHrPipeline: stage.stage_key === 'zeko_hr' ? zekoHrPipeline : null,
      screening,
      assessmentResult: stage.stage_key === 'assessment' ? assessmentResultData?.result : null,
      assessmentInvite: stage.stage_key === 'assessment' ? assessmentInviteData : null,
    });
    const lastStageEvent = stageEvents[stageEvents.length - 1];

    const head = (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Space size={8}>
          <Text strong style={{ fontSize: 16 }}>{stage.label}</Text>
          {stage.is_optional && <Tag style={{ fontSize: 10.5 }}>optional</Tag>}
        </Space>
        {lastStageEvent && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            Updated {new Date(lastStageEvent.created_at).toLocaleString()}
          </Text>
        )}
      </div>
    );

    return (
      <Card size="small" title={head} className="cp-round-panel" style={{ marginTop: 4 }}>
        <div className="cp-pipeline">
          {segs.map((s, i) => (
            <div key={s.key} className={`cp-pipeline-step cp-pipeline-step--${s.state}`}>
              <div className="cp-pipeline-step__rail">
                <span className={`cp-pipeline-node cp-pipeline-node--${s.state}`}>
                  {s.state === 'done' && <CheckOutlined />}
                  {s.state === 'hold' && <PauseCircleOutlined />}
                  {s.state === 'rejected' && <CloseOutlined />}
                </span>
                {i < segs.length - 1 && <span className={`cp-pipeline-step__connector${s.state === 'done' ? ' cp-pipeline-step__connector--done' : ''}`} />}
              </div>
              <div className="cp-pipeline-step__body">
                <div className="cp-pipeline-step__head">
                  <Text className="cp-pipeline-step__label">{s.label}</Text>
                  <Text className={`cp-pipeline-step__state cp-pipeline-step__state--${s.state}`}>{STATE_WORD[s.state]}</Text>
                </div>
                <div className="cp-pipeline-step__detail">{s.detail}</div>
                {s.chips?.length > 0 && (
                  <div className="cp-stat-chip-row">
                    {s.chips.map((chip) => (
                      <div key={chip.label} className={`cp-stat-chip cp-stat-chip--${scoreBand(chip.value)}`}>
                        <span className="cp-stat-chip__value">{chip.value}</span>
                        <span className="cp-stat-chip__label">{chip.label}</span>
                      </div>
                    ))}
                  </div>
                )}
                {i === 0 && showInviteButton && stage.stage_key === 'assessment' && (
                  <div className="cp-pipeline-step__extra">
                    {assessmentInviteData?.isOverdue && (
                      <Alert
                        type="warning"
                        showIcon
                        style={{ marginBottom: 8, fontSize: 12 }}
                        message="Deadline passed with no result yet — re-invite or upload the CSV."
                      />
                    )}
                    <Space size={8} wrap>
                      <Button size="small" type="primary" icon={<SendOutlined />} onClick={() => setInviteModalOpen(true)}>
                        {assessmentInviteData?.invite ? 'Re-invite' : 'Send Evalground Invite'}
                      </Button>
                      <Popconfirm
                        title="Mark as sent manually?"
                        description="Use this only if you already emailed the Evalground link outside the app."
                        onConfirm={() => inviteMutation.mutate({ method: 'manual' })}
                        okText="Yes, mark as sent"
                      >
                        <Button size="small" type="link" loading={inviteMutation.isPending}>Mark as sent manually</Button>
                      </Popconfirm>
                    </Space>
                  </div>
                )}
                {i === 1 && showScheduleButton && stage.stage_key === 'zeko_hr' && (
                  <div className="cp-pipeline-step__extra">
                    {zekoHrPipeline?.interview_start_at ? (
                      <Button size="small" danger icon={<CloseOutlined />} onClick={openCancelModal}>
                        Cancel Interview
                      </Button>
                    ) : (
                      <Button size="small" type="primary" icon={<CalendarOutlined />} onClick={openScheduleModal}>
                        Schedule Interview
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        {emails.length > 0 && (
          <>
            <div className="cp-section-label">Emails in this round</div>
            <div className="cp-emails-surface">
              {emails.map((e) => (
                <div key={e} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', padding: '4px 0' }}>
                  <MailOutlined style={{ fontSize: 12, marginTop: 3, color: 'var(--text-3)' }} />
                  <Text style={{ fontSize: 12.5 }}>{e}</Text>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>
    );
  };

  return (
    <>
    <Drawer
      title={pipeline && (
        <Space direction="vertical" size={2}>
          <Space><UserOutlined /><Text strong style={{ fontSize: 16 }}>{pipeline.rpa_shortlisted_candidates?.candidate_name || 'Candidate journey'}</Text></Space>
          <Text type="secondary" style={{ fontSize: 12.5, fontWeight: 400 }}>
            {pipeline.rpa_shortlisted_candidates?.mrf?.position_hiring_for || pipeline.rpa_shortlisted_candidates?.position_applied || 'No position on file'}
            {' · '}
            {pipeline.rpa_shortlisted_candidates?.candidate_email || '—'}
          </Text>
        </Space>
      )}
      open={open}
      onClose={onClose}
      width={680}
      destroyOnClose
    >
      {isLoading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <Spin size="large" />
        </div>
      )}

      {isError && (
        <Alert
          type="error"
          showIcon
          message="Failed to load journey detail"
          description={error?.response?.data?.message || error?.message}
        />
      )}

      {pipeline && (
        <>
          <Space size={4} wrap style={{ marginBottom: 10 }}>
            {pipeline.source === 'vendor'
              ? <Tag color="green">Vendor — {pipeline.vendor_email || '—'}</Tag>
              : <Tag>{pipeline.source}</Tag>}
            {/* Mirrors the board card's cardStatus() (Pipeline.jsx): once Zeko
                has synced a score for an in-progress Zeko stage, the journey is
                no longer just "in progress" — it's waiting on the recruiter. */}
            {isReadyForDecision
              ? <Tag color="green">Ready for decision</Tag>
              : <Tag color={pipeline.current_stage_status === 'hold' ? 'gold' : 'blue'}>{pipeline.current_stage_status}</Tag>}
            {pipeline.final_outcome && <Tag color="purple">Closed — {pipeline.final_outcome}</Tag>}
          </Space>

          {/* Shortlisting happens on Candidate Screening, not as a pipeline
              stage (v8+ direction) — shown as a persistent, read-only line
              instead of a "Shortlisted" stage-1 column. */}
          {screening && (
            <div
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8,
                background: 'var(--ink-3)', borderRadius: 10, padding: '9px 14px', marginBottom: 10,
              }}
            >
              <Text style={{ fontSize: 12.5 }}>
                <Text type="secondary">Shortlisted from Candidate Screening</Text>
                {screening.shortlistedAt && <> · {new Date(screening.shortlistedAt).toLocaleDateString()}</>}
                {screening.shortlistedBy && <> · by {screening.shortlistedBy}</>}
              </Text>
              {cvFileUrl
                ? <Button size="small" type="link" icon={<FileTextOutlined />} style={{ padding: 0 }} href={cvFileUrl} target="_blank" rel="noopener noreferrer">View resume</Button>
                : <Text type="secondary" style={{ fontSize: 12 }}>No resume on file</Text>}
            </div>
          )}
          {screening?.notes && (
            <Alert type="info" showIcon message={screening.notes} style={{ marginBottom: 10, fontSize: 12.5 }} />
          )}

          {allStages.length > 0 && (
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 8, marginBottom: 4 }}>
              {allStages.map((s, i) => {
                const past = i < currentIdx;
                const isCurrentStage = i === currentIdx;
                const disabled = i > currentIdx;
                const kind = past ? 'done' : isCurrentStage ? 'current' : 'future';
                return (
                  <button
                    key={s.stage_key}
                    type="button"
                    disabled={disabled}
                    title={s.label}
                    onClick={() => setSelectedStageKey(s.stage_key)}
                    className={`cp-stage-pill cp-stage-pill--${kind}${selectedIdx === i ? ' cp-stage-pill--selected' : ''}`}
                  >
                    {shortStageLabel(s.label)}
                  </button>
                );
              })}
            </div>
          )}
          {allStages[currentIdx] && (
            <Text type="secondary" style={{ fontSize: 11.5, display: 'block', marginBottom: 8 }}>
              Click a stage to see its details — stages after <Text strong style={{ fontSize: 11.5 }}>{allStages[currentIdx].label}</Text> are locked until the candidate gets there.
            </Text>
          )}

          {renderStagePanel()}

          {isCurrentStageSelected && !pipeline.final_outcome && (
            <div style={{ borderTop: '1px solid var(--ant-color-border)', marginTop: 16, paddingTop: 16 }}>
              <Title level={5} style={{ fontSize: 14 }}>Record outcome — current stage</Title>
              {selectedStageKey === 'assessment' && assessmentResultData?.result?.overall_result && (
                <Tag
                  color={assessmentResultData.suggestedOutcome === 'approved' ? 'green' : assessmentResultData.suggestedOutcome === 'rejected' ? 'red' : 'default'}
                  style={{ marginBottom: 10 }}
                >
                  Evalground suggests: {assessmentResultData.result.overall_result}
                </Tag>
              )}
              <Space wrap style={{ marginBottom: 12 }}>
                {OUTCOME_BUTTONS.map((btn) => (
                  <Button
                    key={btn.key}
                    icon={btn.icon}
                    danger={btn.danger}
                    className={btn.primary ? 'cta-primary btn-sheen' : undefined}
                    style={btn.primary ? undefined : btn.style}
                    type={btn.primary ? 'primary' : 'default'}
                    onClick={() => openOutcomeModal(btn.key)}
                  >
                    {btn.label}
                  </Button>
                ))}
              </Space>
              <Alert
                type="info"
                showIcon
                icon={<MailOutlined />}
                message={vendorCc
                  ? `Outcome emails go to the candidate AND ${vendorCc} (status-only note for sensitive stages).`
                  : 'Outcome emails go to the candidate automatically, from the recruitment mailbox.'}
              />
            </div>
          )}
        </>
      )}
    </Drawer>

    <Modal
      open={outcomeModalOpen}
      onCancel={() => setOutcomeModalOpen(false)}
      title="Record round outcome"
      width={620}
      footer={[
        <Button key="cancel" onClick={() => setOutcomeModalOpen(false)}>Cancel</Button>,
        <Button key="confirm" type="primary" onClick={submitOutcome} loading={outcomeMutation.isPending}>
          Save &amp; send email
        </Button>,
      ]}
    >
      {pipeline && decisionOutcome && (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Text type="secondary">
            {pipeline.rpa_shortlisted_candidates?.candidate_name} · {allStages[selectedIdx]?.label}
          </Text>
          {isRejectOrHold && (
            <div>
              <Text strong style={{ fontSize: 12.5 }}>Reason <Text type="danger">*</Text> (mandatory for Reject / Hold)</Text>
              <Select
                style={{ width: '100%', marginTop: 4 }}
                placeholder="Select a reason"
                value={reasonId}
                onChange={setReasonId}
                options={reasons.map((r) => ({ value: r.id, label: r.reason_label }))}
              />
              {selectedReason?.is_other && (
                <TextArea
                  rows={2}
                  placeholder="Type the actual reason — this text is what gets shown everywhere, never the word 'Other'"
                  value={otherText}
                  onChange={(e) => setOtherText(e.target.value)}
                  style={{ marginTop: 8 }}
                />
              )}
            </div>
          )}
          <Input.TextArea
            rows={2}
            placeholder="Notes — internal, shown on the round; not sent to the candidate"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div style={{ borderTop: '1px solid var(--border-2, #eaebe8)', paddingTop: 10 }}>
            <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 6 }}>
              <Text strong style={{ fontSize: 12.5 }}><MailOutlined style={{ marginInlineEnd: 4 }} />Outcome email → candidate{vendorCc ? ` + ${vendorCc}` : ''}</Text>
              {previewData?.templateName
                ? <Tag color="blue">Template — {previewData.templateName}{previewData.templateId ? ` (#${previewData.templateId})` : ''}</Tag>
                : <Tag color="orange">Draft — no template yet</Tag>}
            </Space>
            {!previewData?.templateName && !previewLoading && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 8 }}
                message="No email template resolved for this stage/outcome — this is an editable draft, not a saved template."
              />
            )}
            {previewLoading || !previewData || emailStateForKey !== previewData ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
                <Spin />
              </div>
            ) : (
              <>
                <Input value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} placeholder="Subject" style={{ marginBottom: 8 }} />
                <SimpleHtmlEditor value={emailBody} onChange={setEmailBody} />
              </>
            )}
            <Text type="secondary" style={{ fontSize: 11.5, display: 'block', marginTop: 4 }}>
              Editable before send — the exact text above goes out once sent.
            </Text>
          </div>
        </Space>
      )}
    </Modal>

    <Modal
      open={scheduleOpen}
      onCancel={() => setScheduleOpen(false)}
      title="Schedule Zeko Interview"
      width={560}
      footer={[
        <Button key="cancel" onClick={() => setScheduleOpen(false)}>Cancel</Button>,
        <Button key="confirm" type="primary" onClick={submitSchedule} loading={scheduleMutation.isPending}>
          Confirm &amp; Invite
        </Button>,
      ]}
    >
      {pipeline && (
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--ink-3)', borderRadius: 10, padding: '10px 14px' }}>
            <Avatar>{(pipeline.rpa_shortlisted_candidates?.candidate_name || '?').charAt(0).toUpperCase()}</Avatar>
            <div>
              <Text strong style={{ display: 'block' }}>{pipeline.rpa_shortlisted_candidates?.candidate_name}</Text>
              <Text type="secondary" style={{ fontSize: 12.5 }}>{pipeline.rpa_shortlisted_candidates?.candidate_email}</Text>
            </div>
          </div>
          <div>
            <Text strong style={{ fontSize: 12.5 }}>Zeko Job</Text>
            <Select
              style={{ width: '100%', marginTop: 4 }}
              placeholder="Select a Zeko job"
              value={scheduleJobId}
              onChange={setScheduleJobId}
              showSearch
              optionFilterProp="label"
              options={zekoJobs.map((j) => ({ value: j.zeko_id, label: j.title }))}
            />
          </div>
          <div>
            <Text strong style={{ fontSize: 12.5 }}>Interview Date &amp; Time Range (IST)</Text>
            <RangePicker
              showTime={{ format: 'HH:mm', minuteStep: 30 }}
              format="DD MMM YYYY, HH:mm"
              style={{ width: '100%', marginTop: 4 }}
              value={scheduleDates}
              onChange={setScheduleDates}
            />
            <Text type="secondary" style={{ fontSize: 11.5, display: 'block', marginTop: 4 }}>
              Candidate self-schedules within this window via the Zeko link; times round to 30-minute slots automatically.
            </Text>
          </div>
        </Space>
      )}
    </Modal>

    <Modal
      open={cancelOpen}
      onCancel={() => setCancelOpen(false)}
      title="Confirm Cancel Interview"
      width={560}
      footer={[
        <Button key="back" onClick={() => setCancelOpen(false)}>Back</Button>,
        <Button key="confirm" danger type="primary" icon={<CloseOutlined />} onClick={submitCancel} loading={cancelMutation.isPending}>
          Yes, Cancel Interview
        </Button>,
      ]}
    >
      {pipeline && zekoHrPipeline && (
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
          <div style={{ background: 'var(--ink-3)', borderRadius: 10, padding: '10px 14px' }}>
            <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>CANDIDATE</Text>
            <Text strong>{pipeline.rpa_shortlisted_candidates?.candidate_name}</Text>
            <Text type="secondary" style={{ fontSize: 12.5, display: 'block' }}>{pipeline.rpa_shortlisted_candidates?.candidate_email}</Text>
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 11 }}>SCHEDULED TIME</Text>
            <Text strong style={{ display: 'block' }}>
              {fmtDateTime(zekoHrPipeline.interview_start_at)} → {fmtDateTime(zekoHrPipeline.interview_end_at)}
            </Text>
          </div>
          <div>
            <Text strong style={{ fontSize: 12.5 }}>Cancel reason (optional)</Text>
            <TextArea
              rows={3}
              placeholder="e.g. Candidate unavailable, rescheduling required…"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              style={{ marginTop: 4 }}
            />
          </div>
          <Alert
            type="error"
            showIcon
            message="A cancellation email will be sent to the candidate immediately. This action cannot be undone."
          />
        </Space>
      )}
    </Modal>

    <AssessmentInviteModal
      open={inviteModalOpen}
      onClose={() => setInviteModalOpen(false)}
      candidateName={pipeline?.rpa_shortlisted_candidates?.candidate_name}
      position={pipeline?.rpa_shortlisted_candidates?.mrf?.position_hiring_for || pipeline?.rpa_shortlisted_candidates?.position_applied}
      deadlineDays={automationSettingsData?.assessment_deadline_days}
      sending={inviteMutation.isPending}
      onSend={(payload) => inviteMutation.mutate(payload)}
    />
    </>
  );
}
