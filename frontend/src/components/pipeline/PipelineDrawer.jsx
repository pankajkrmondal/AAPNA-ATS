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
  Alert, App as AntApp, Avatar, Button, Card, Collapse, DatePicker, Drawer, Empty, Input, Modal, Select, Space, Spin, Tag, Tooltip, Typography,
} from 'antd';
import {
  BoldOutlined, CalendarOutlined, CheckOutlined, CloseOutlined, ExclamationCircleOutlined,
  FileTextOutlined, ItalicOutlined, LinkOutlined, MailOutlined, PauseCircleOutlined,
  UnderlineOutlined, UserOutlined,
  Alert, App as AntApp, Avatar, Button, Card, DatePicker, Drawer, Empty, Input, Modal, Popconfirm, Select, Space, Spin, Tag, Tooltip, Typography,
} from 'antd';
import {
  BoldOutlined, CalendarOutlined, CheckOutlined, CloseOutlined, FileTextOutlined,
  ItalicOutlined, LinkOutlined, MailOutlined, PauseCircleOutlined, SendOutlined, UnderlineOutlined, UserOutlined,
} from '@ant-design/icons';
import DOMPurify from 'dompurify';
import dayjs from 'dayjs';
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
  body:focus { outline: none; }
  /* Degraded (no-wrapper) mode only — the branded shell supplies its own padding. */
  body:not(:has([data-editable-body])) { padding: 12px 14px; font-family: inherit; font-size: 13.5px; }
  /* Make the editable region visibly the only editable part. */
  [data-editable-body] { outline: 1px dashed rgba(122,146,46,0.55); outline-offset: 6px; border-radius: 2px; min-height: 60px; }
  [data-editable-body]:focus { outline: 2px solid rgba(122,146,46,0.85); }
`;

/**
 * WYSIWYG for the outcome-email body, shown inside the real branded shell.
 *
 * The iframe renders the FULL email the recipient will get — green AAPNA
 * header, logo, card, footer — but only the body slot is contenteditable, so
 * the recruiter reviews the true outgoing format while editing just the copy
 * (docs/phase3/PIPELINE-TRACKER-BRANDED-EMAIL-PLAN.md §4.1).
 *
 * That split matters: the previous version put designMode on the whole
 * document and round-tripped documentElement.outerHTML, so any chrome inside
 * the value could be deleted or broken by a stray edit and shipped that way.
 * Here `onChange` only ever emits the body fragment — exactly what the backend
 * stores and re-wraps at send time.
 *
 * `wrapper` is {headerHtml, footerHtml} from the preview endpoint, produced by
 * the same backend module the send path uses, so preview and delivery cannot
 * drift. Without it the editor degrades to the bare fragment.
 */
function BrandedBodyEditor({ value, onChange, wrapper, subject }) {
  const iframeRef = useRef(null);
  const savedSelRef = useRef(null);
  // srcDoc only needs to reset when a *different* preview loads, not on every
  // keystroke — otherwise the iframe would reload (and lose the caret) as the
  // recruiter types.
  const srcDoc = useMemo(
    () => {
      const body = DOMPurify.sanitize(value || '<p>Empty.</p>', SANITIZE_OPTS);
      if (!wrapper?.headerHtml) return body;
      // Mirrors wrapBrandedEmail()'s table skeleton so the preview matches the
      // delivered mail; only the body slot carries data-editable-body.
      return `<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif">`
        + `<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:20px 8px"><tr><td align="center">`
        + `<table width="620" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,0.08)">`
        + wrapper.headerHtml
        + `<tr><td style="padding:32px 40px 24px 40px;font-size:15px;color:#374151;line-height:1.8">`
        + `<div data-editable-body contenteditable="true">${body}</div>`
        + `</td></tr>`
        + (wrapper.footerHtml || '')
        + `</table></td></tr></table></body>`;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // The header headline IS the subject, so keep the band in step as the
  // recruiter edits the subject field. Patched into the live iframe DOM rather
  // than rebuilt into srcDoc, which would reload the frame and drop the caret.
  // textContent assignment escapes the value, matching the backend's escaping.
  useEffect(() => {
    const doc = iframeRef.current?.contentDocument;
    const h1 = doc?.querySelector('h1');
    if (!h1) return;
    const next = (subject || '').trim();
    if (h1.textContent !== next) h1.textContent = next;
  }, [subject]);

  /** Reads back ONLY the editable slot, never the surrounding chrome. */
  const syncFromEditor = () => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    const slot = doc.querySelector('[data-editable-body]');
    if (slot) {
      onChange(slot.innerHTML);
      return;
    }
    // No wrapper (degraded mode): the whole document is the body.
    if (doc.designMode === 'on') {
      const clone = doc.documentElement.cloneNode(true);
      clone.querySelectorAll('style[data-editor-css]').forEach((el) => el.remove());
      onChange(clone.outerHTML);
    }
  };

  const handleLoad = () => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    const slot = doc.querySelector('[data-editable-body]');
    if (slot) {
      // Chrome stays read-only; only the body slot accepts input.
      slot.setAttribute('contenteditable', 'true');
    } else {
      doc.designMode = 'on';
    }
    const style = doc.createElement('style');
    style.textContent = EDITOR_CONTENT_CSS;
    style.setAttribute('data-editor-css', '1');
    doc.head?.appendChild(style);
    doc.addEventListener('input', syncFromEditor);
    doc.addEventListener('selectionchange', () => {
      const sel = doc.getSelection?.();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        // Only remember selections inside the editable region, so the toolbar
        // can never apply formatting to the header or footer.
        const scope = slot || doc.body;
        if (scope?.contains(range.commonAncestorContainer)) {
          savedSelRef.current = range.cloneRange();
        }
      }
    });
  };

  const exec = (command, val = null) => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    iframeRef.current.contentWindow?.focus();
    // Focus the editable slot so execCommand has a valid target even before
    // the recruiter has clicked into the body.
    doc.querySelector('[data-editable-body]')?.focus?.();
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
        // Taller when the branded shell renders, so the header, body and footer
        // are all visible without scrolling inside the modal.
        style={{ width: '100%', height: wrapper?.headerHtml ? 420 : 220, border: 'none', background: 'var(--ant-color-bg-container, #fff)' }}
      />
    </div>
  );
}

/**
 * Two collapsible editable emails (candidate + panel) for the Schedule/Cancel
 * modals. Same edit-before-send idea as the "Record round outcome" modal, but
 * the two recipients get separate copy. `state` is the {candidateSubject,
 * candidateBody, panelSubject, panelBody, touched} object; `onChange(patch)`
 * merges a patch and marks it touched so a later preview refetch won't clobber
 * the recruiter's edits.
 */
function InterviewEmailEditors({ state, onChange, candidateLabel, panelLabel, candidateWrapper, panelWrapper, ready = true }) {
  const field = (key, value) => onChange({ [key]: value, touched: true });

  // BrandedBodyEditor freezes its srcDoc on first mount (to protect the caret
  // while typing), so it must not mount before the preview text and wrapper
  // have arrived — otherwise it would render an empty, unbranded shell.
  if (!ready) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
        <Spin />
      </div>
    );
  }
  return (
    <Collapse
      size="small"
      items={[
        {
          key: 'candidate',
          label: <span><MailOutlined style={{ marginInlineEnd: 6 }} />{candidateLabel}</span>,
          children: (
            <>
              <Input
                value={state.candidateSubject}
                onChange={(e) => field('candidateSubject', e.target.value)}
                placeholder="Subject"
                style={{ marginBottom: 8 }}
              />
              <BrandedBodyEditor value={state.candidateBody} onChange={(v) => field('candidateBody', v)} wrapper={candidateWrapper} subject={state.candidateSubject} />
            </>
          ),
        },
        {
          key: 'panel',
          label: <span><MailOutlined style={{ marginInlineEnd: 6 }} />{panelLabel}</span>,
          children: (
            <>
              <Input
                value={state.panelSubject}
                onChange={(e) => field('panelSubject', e.target.value)}
                placeholder="Subject"
                style={{ marginBottom: 8 }}
              />
              <BrandedBodyEditor value={state.panelBody} onChange={(v) => field('panelBody', v)} wrapper={panelWrapper} subject={state.panelSubject} />
            </>
          ),
        },
      ]}
    />
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

/** Rounds the recruiter books directly (interviewer comes from the MRF).
 * Mirrors SCHEDULABLE_STAGES in backend/src/services/interviewSchedule.service.js. */
function isSchedulableStageKey(key) {
  return key === 'tech1' || key === 'tech2';
}

/**
 * Validates the interviewer field, which accepts a panel of one or more
 * addresses separated by commas. Mirrors parseInterviewerEmails() in
 * backend/src/services/interviewSchedule.service.js so the form fails fast.
 *
 * @returns {{ emails: string[], invalid: string[] }}
 */
function parseInterviewerEmails(value) {
  const parts = String(value || '').split(/[,;]/).map((p) => p.trim()).filter(Boolean);
  const emails = [];
  const invalid = [];
  const seen = new Set();
  for (const part of parts) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(part)) {
      invalid.push(part);
    } else if (!seen.has(part.toLowerCase())) {
      seen.add(part.toLowerCase());
      emails.push(part);
    }
  }
  return { emails, invalid };
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
  // Stage 2 reads "Schedule Interview" for the same reason zeko's does: this is
  // where the recruiter ACTS, so the label names the action, not a passive wait.
  scheduled_interview: ['Invite Sent', 'Schedule Interview', 'Awaiting Results', 'Approve / Reject'],
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
function buildPipelineSegments({ stage, stageEvents, isCurrent, zekoScores, zekoHrPipeline, screening, interviewSchedule, mrfInterviewHints, scorecardSubmitted }) {
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
    // Functional screening runs the same assign+schedule flow as zeko_hr
    // against the same Zeko job catalog; the backend keeps the two rounds
    // apart via rpa_zeko_candidate_pipeline.stage ('hr' vs 'functional'), so
    // `zekoHrPipeline` here is this round's own row, never the HR one.
    if (zekoHrPipeline) {
      const statusWord = ZEKO_HR_STATUS_WORD[zekoHrPipeline.status] || zekoHrPipeline.status;
      if (zekoHrPipeline.interview_start_at) {
        s2 = {
          state: zekoScores ? 'done' : 'active',
          detail: `Scheduled window · ${fmtDateTime(zekoHrPipeline.interview_start_at)}–${fmtDateTime(zekoHrPipeline.interview_end_at)?.split(', ')[1] || ''}`,
        };
        emails.push(`Zeko functional screening invite → candidate · ${fmtDateTime(zekoHrPipeline.link_sent_at)}`);
      } else if (zekoHrPipeline.link_sent_at) {
        s2 = { state: 'active', detail: 'Awaiting the candidate to self-schedule a slot' };
        emails.push(`Zeko functional screening invite → candidate · ${fmtDateTime(zekoHrPipeline.link_sent_at)}`);
      } else {
        s2 = { state: 'active', detail: `Assigned to a Zeko job — ${statusWord}` };
      }
    } else if (enteredEvent) {
      s2 = { state: 'pending', detail: 'Not yet assigned to a Zeko job' };
    }
    // Same "round is genuinely open" rule as zeko_hr.
    showScheduleButton = isCurrent && !zekoScores && !outcomeEvent;

    if (zekoScores) {
      // Unlike HR screening, the functional round shows all three scores —
      // coding included, since that is what this round actually assesses.
      s3 = { state: 'done', ...zekoScoreSegment(zekoScores) };
    } else if (zekoHrPipeline?.link_sent_at) {
      s3 = { state: 'active', detail: 'Awaiting Zeko to sync the score' };
    } else if (enteredEvent) {
      s3 = { state: 'pending', detail: 'Awaiting Zeko to sync the score, once invited' };
    }
  } else if (isSchedulableStageKey(stage.stage_key)) {
    // Technical Rounds 1 & 2 — real booking via rpa_interview_schedule. WHO
    // interviews comes from the MRF (first/second_technical_round); the
    // recruiter supplies the mailbox when booking.
    if (interviewSchedule) {
      s2 = {
        state: 'done',
        detail: `Scheduled · ${fmtDateTime(interviewSchedule.scheduled_start_at)}${interviewSchedule.interviewer_name ? ` with ${interviewSchedule.interviewer_name}` : ''}`,
      };
      if (interviewSchedule.invite_sent_at) {
        const panelSize = (interviewSchedule.interviewer_email || '').split(',').filter((s) => s.trim()).length;
        const panelLabel = panelSize > 1 ? ` + ${panelSize} interviewers` : panelSize === 1 ? ' + interviewer' : '';
        emails.push(`Interview invite → candidate${panelLabel} · ${fmtDateTime(interviewSchedule.invite_sent_at)}`);
      }
      // The "results" line reflects the real post-interview state:
      //   no-show      → the interview did not happen; reschedule/reject
      //   feedback in  → the interviewer submitted their scorecard
      //   held, no card yet → link sent, waiting on the interviewer
      //   otherwise    → the interview hasn't happened yet
      if (interviewSchedule.occurrence_status === 'no_show') {
        s3 = { state: 'rejected', detail: `No-show${interviewSchedule.no_show_party ? ` (${interviewSchedule.no_show_party})` : ''} — reschedule or reject` };
      } else if (scorecardSubmitted) {
        s3 = { state: 'done', detail: 'Feedback received — interviewer submitted the scorecard' };
      } else if (interviewSchedule.occurrence_status === 'held') {
        s3 = { state: 'active', detail: 'Interview held — scorecard link sent, awaiting the interviewer’s feedback' };
      } else {
        s3 = { state: 'active', detail: 'Awaiting the interview & feedback' };
      }
    } else if (enteredEvent) {
      const owner = mrfInterviewHints?.interviewerName;
      const slot = mrfInterviewHints?.preferredSlot;
      s2 = {
        state: 'active',
        detail: owner
          ? `Not scheduled yet · MRF interviewer: ${owner}${slot ? ` · preferred ${slot}` : ''}`
          : 'Not scheduled yet — no interviewer named on the MRF for this round',
      };
      s3 = { state: 'pending', detail: 'Awaiting the interview, once scheduled' };
    }
    // Scheduling stays available while the round is genuinely open.
    showScheduleButton = isCurrent && !outcomeEvent;
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
    // Remaining stage types have no real scheduling/scorecard/docs/offer data
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
  const { message, modal } = AntApp.useApp();
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
  // Technical round booking (tech1/tech2) — separate from the Zeko modal above.
  const [interviewOpen, setInterviewOpen] = useState(false);
  // 'schedule' (fresh booking) | 'reschedule' (cancel old + rebook). The same
  // modal serves both; mode switches the title, preview endpoint, and submit.
  const [interviewMode, setInterviewMode] = useState('schedule');
  const [interviewAt, setInterviewAt] = useState(null);
  const [interviewDuration, setInterviewDuration] = useState(60);
  const [interviewerEmail, setInterviewerEmail] = useState('');
  // Only surface the "required" error once the field has been visited or a
  // submit attempted — an error on a pristine, never-touched field reads as broken.
  const [interviewerEmailTouched, setInterviewerEmailTouched] = useState(false);
  const [interviewCancelOpen, setInterviewCancelOpen] = useState(false);
  // No-show modal (which side missed + reason) for the occurrence gate.
  const [noShowOpen, setNoShowOpen] = useState(false);
  const [noShowParty, setNoShowParty] = useState('candidate');
  const [noShowReason, setNoShowReason] = useState('');
  // Scorecard report panel (per-round scores + overall avg/sum).
  const [reportOpen, setReportOpen] = useState(false);
  // Editable emails for the schedule/cancel modals (candidate + panel), each
  // prefilled from the server preview. `touched` = recruiter edited it, so we
  // stop overwriting it when the preview refetches (e.g. after a date change).
  const [schedEmail, setSchedEmail] = useState({
    candidateSubject: '', candidateBody: '', panelSubject: '', panelBody: '', touched: false,
  });
  const [cxlEmail, setCxlEmail] = useState({
    candidateSubject: '', candidateBody: '', panelSubject: '', panelBody: '', touched: false,
  });
  // Which preview payload schedEmail/cxlEmail currently reflect. The body
  // editors freeze their srcDoc on mount, so they must wait for the adopting
  // effect below to land — same guard as emailStateForKey in the outcome modal.
  const [schedEmailForKey, setSchedEmailForKey] = useState(null);
  const [cxlEmailForKey, setCxlEmailForKey] = useState(null);
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

  // Drives the "Scorecard report" button: it only appears once at least one
  // interviewer has SUBMITTED a scorecard for this candidate.
  const { data: scorecardReport } = useQuery({
    queryKey: ['scorecard-report', pipelineId],
    queryFn: async () => {
      const res = await pipelineService.getScorecardReport(pipelineId);
      return res.data?.data || res.data;
    },
    enabled: open && !!pipelineId,
  });
  const hasScorecards = (scorecardReport?.overall?.count || 0) > 0;
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
  // Live interview booking for the current round (used by the cancel preview
  // query below and the modals); also re-read at the render site further down.
  const interviewSchedule = data?.interviewSchedule;
  // True once the scheduled window has passed — gates the "did it happen?"
  // controls so occurrence is only asked about after the interview time.
  const interviewEnded = interviewSchedule?.scheduled_end_at
    ? dayjs(interviewSchedule.scheduled_end_at).isBefore(dayjs())
    : false;

  // Schedule/reschedule-email preview: the candidate + panel templates compiled
  // with the date/duration the recruiter is entering. Uses the reschedule
  // endpoint in reschedule mode so the preview shows the old → new time.
  const { data: schedPreview } = useQuery({
    queryKey: ['schedule-preview', interviewMode, pipelineId, pipeline?.current_stage_key, interviewAt?.toISOString(), interviewDuration],
    queryFn: async () => {
      const params = {
        stage_key: pipeline?.current_stage_key,
        start_at: interviewAt ? interviewAt.toISOString() : undefined,
        duration_minutes: interviewDuration,
      };
      const res = interviewMode === 'reschedule'
        ? await pipelineService.getReschedulePreview(pipelineId, params)
        : await pipelineService.getSchedulePreview(pipelineId, params);
      return res.data?.data || res.data;
    },
    enabled: interviewOpen && !!pipeline?.current_stage_key,
  });
  useEffect(() => {
    // Adopt fresh template text only while the recruiter hasn't edited it.
    if (schedPreview && !schedEmail.touched) {
      setSchedEmail((s) => ({
        ...s,
        candidateSubject: schedPreview.candidate?.subject || '',
        candidateBody: schedPreview.candidate?.body || '',
        panelSubject: schedPreview.panel?.subject || '',
        panelBody: schedPreview.panel?.body || '',
      }));
      setSchedEmailForKey(schedPreview);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedPreview]);

  // Cancel-email preview: candidate + panel cancellation templates for the
  // live booking (interviewSchedule.id), loaded when the cancel modal opens.
  const { data: cxlPreview } = useQuery({
    queryKey: ['cancel-preview', interviewSchedule?.id],
    queryFn: async () => {
      const res = await pipelineService.getCancelPreview(interviewSchedule.id);
      return res.data?.data || res.data;
    },
    enabled: interviewCancelOpen && !!interviewSchedule?.id,
  });
  useEffect(() => {
    if (cxlPreview && !cxlEmail.touched) {
      setCxlEmail((s) => ({
        ...s,
        candidateSubject: cxlPreview.candidate?.subject || '',
        candidateBody: cxlPreview.candidate?.body || '',
        panelSubject: cxlPreview.panel?.subject || '',
        panelBody: cxlPreview.panel?.body || '',
      }));
      setCxlEmailForKey(cxlPreview);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cxlPreview]);

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
    mutationFn: async ({ shortlistId, zekoJobId, start, end, stageKey }) => {
      // `stage` tells the backend which Zeko round this is — HR screening and
      // functional screening share the job catalog but get their own row.
      await screeningService.assignZekoJob({ candidate_id: shortlistId, zeko_job_id: zekoJobId, stage: stageKey });
      return screeningService.scheduleZekoInterview({
        shortlist_id: shortlistId,
        zeko_job_id: zekoJobId,
        interview_start_at: start.toISOString(),
        interview_end_at: end.toISOString(),
        stage: stageKey,
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

  // Technical-round booking. The MRF names the interviewer; their mailbox is
  // entered per booking, so the invite can actually be delivered. Serves both
  // fresh scheduling and rescheduling (cancel old + rebook) based on `mode`.
  const interviewMutation = useMutation({
    mutationFn: ({ stageKey, startAt, duration, email, mode }) => {
      const payload = {
        stage_key: stageKey,
        start_at: startAt,
        duration_minutes: duration,
        interviewer_email: email,
        // The editable candidate + panel copy from the modal.
        candidate_subject: schedEmail.candidateSubject,
        candidate_body: schedEmail.candidateBody,
        panel_subject: schedEmail.panelSubject,
        panel_body: schedEmail.panelBody,
      };
      return mode === 'reschedule'
        ? pipelineService.rescheduleInterview(pipelineId, payload)
        : pipelineService.scheduleInterview(pipelineId, payload);
    },
    onSuccess: (_res, vars) => {
      queryClient.invalidateQueries({ queryKey: ['pipeline-detail', pipelineId] });
      onChanged?.();
      message.success(vars.mode === 'reschedule' ? 'Interview rescheduled — both parties emailed.' : 'Interview scheduled — invitation emailed.');
      setInterviewOpen(false);
      setInterviewAt(null);
      setInterviewerEmail('');
      setSchedEmail({ candidateSubject: '', candidateBody: '', panelSubject: '', panelBody: '', touched: false });
      setSchedEmailForKey(null);
    },
    onError: (err) => {
      message.error(err?.response?.data?.message || 'Failed to save the interview.');
    },
  });

  const interviewCancelMutation = useMutation({
    mutationFn: () => pipelineService.cancelInterview(interviewSchedule.id, {
      candidate_subject: cxlEmail.candidateSubject,
      candidate_body: cxlEmail.candidateBody,
      panel_subject: cxlEmail.panelSubject,
      panel_body: cxlEmail.panelBody,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipeline-detail', pipelineId] });
      onChanged?.();
      message.success('Interview cancelled — candidate notified.');
      setInterviewCancelOpen(false);
      setCxlEmail({ candidateSubject: '', candidateBody: '', panelSubject: '', panelBody: '', touched: false });
      setCxlEmailForKey(null);
    },
    onError: (err) => {
      message.error(err?.response?.data?.message || 'Failed to cancel the interview.');
    },
  });

  // Occurrence gate: mark the interview held (releases the scorecard link) or a
  // no-show (records it; no scorecard). Idempotent server-side.
  const occurrenceMutation = useMutation({
    mutationFn: ({ scheduleId, outcome, party, reason }) =>
      pipelineService.recordInterviewOccurrence(scheduleId, { outcome, party, reason }),
    onSuccess: (_res, vars) => {
      queryClient.invalidateQueries({ queryKey: ['pipeline-detail', pipelineId] });
      onChanged?.();
      if (vars.outcome === 'held') {
        message.success('Interview marked as held — scorecard link sent to the interviewer(s).');
      } else {
        message.success('No-show recorded — reschedule or reject this round below.');
      }
      setNoShowOpen(false);
      setNoShowReason('');
    },
    onError: (err) => {
      message.error(err?.message || 'Failed to record the interview outcome.');
    },
  });

  /**
   * "Mark as Held" emails a scorecard link and cannot be undone, so a misclick
   * is expensive — confirm first, spelling out exactly what happens on OK and
   * naming the interviewer(s) who will be emailed.
   */
  const confirmMarkHeld = (stageLabel) => {
    if (!interviewSchedule) return;
    const who = interviewSchedule.interviewer_email || 'the interviewer';
    const candidateName = data?.pipeline?.rpa_shortlisted_candidates?.candidate_name || 'this candidate';
    modal.confirm({
      title: 'Confirm this interview took place?',
      icon: <ExclamationCircleOutlined />,
      width: 480,
      content: (
        <div style={{ fontSize: 13 }}>
          <p style={{ marginTop: 0 }}>
            You are confirming that <strong>{stageLabel || 'this round'}</strong> with{' '}
            <strong>{candidateName}</strong> actually happened.
          </p>
          <p style={{ marginBottom: 4 }}><strong>Clicking “Yes, it was held” will:</strong></p>
          <ul style={{ margin: '0 0 8px 18px', paddingLeft: 0 }}>
            <li>Email a secure scorecard link to <strong>{who}</strong></li>
            <li>Move this round to “Awaiting Results”</li>
          </ul>
          <p style={{ margin: 0, color: 'var(--danger, #cf1322)' }}>
            This cannot be undone. If the interview did not happen, choose “Mark No-show” instead.
          </p>
        </div>
      ),
      okText: 'Yes, it was held',
      cancelText: 'Cancel',
      onOk: () => occurrenceMutation.mutateAsync({ scheduleId: interviewSchedule.id, outcome: 'held' }),
    });
  };

  // Manual re-send / send of the scorecard link (only meaningful once held).
  const sendScorecardMutation = useMutation({
    mutationFn: (scheduleId) => pipelineService.sendScorecard(scheduleId),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['pipeline-detail', pipelineId] });
      const data = res?.data || res;
      if (data?.alreadySent) message.info('Scorecard link was already sent for this interview.');
      else message.success('Scorecard link sent.');
    },
    onError: (err) => {
      message.error(err?.message || 'Failed to send the scorecard link.');
    },
  });

  if (!open) return null;

  const currentStageOutcomes = data?.currentStageOutcomes || [];
  const reasons = data?.reasons || [];
  const zekoScores = data?.zekoScores;
  const zekoHrPipeline = data?.zekoHrPipeline;
  const mrfInterviewHints = data?.mrfInterviewHints;
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
      // Scheduling always acts on the round the candidate is currently in.
      stageKey: pipeline.current_stage_key,
    });
  };

  const openCancelModal = () => {
    setCancelReason('');
    setCancelOpen(true);
  };

  const parsedInterviewers = parseInterviewerEmails(interviewerEmail);
  const interviewerEmailOk = parsedInterviewers.emails.length > 0 && parsedInterviewers.invalid.length === 0;

  const openInterviewModal = () => {
    setInterviewMode('schedule');
    setInterviewAt(null);
    setInterviewDuration(60);
    setInterviewerEmail('');
    setInterviewerEmailTouched(false);
    setSchedEmail({ candidateSubject: '', candidateBody: '', panelSubject: '', panelBody: '', touched: false });
    setSchedEmailForKey(null);
    setInterviewOpen(true);
  };

  // Reschedule = the same form, prefilled from the live booking (interviewer,
  // duration), with the date left blank so the recruiter picks a new one.
  const openRescheduleModal = () => {
    setInterviewMode('reschedule');
    setInterviewAt(null);
    const mins = interviewSchedule
      ? Math.round((new Date(interviewSchedule.scheduled_end_at) - new Date(interviewSchedule.scheduled_start_at)) / 60000)
      : 60;
    setInterviewDuration([30, 45, 60, 90].includes(mins) ? mins : 60);
    setInterviewerEmail(interviewSchedule?.interviewer_email || '');
    setInterviewerEmailTouched(false);
    setSchedEmail({ candidateSubject: '', candidateBody: '', panelSubject: '', panelBody: '', touched: false });
    setSchedEmailForKey(null);
    setInterviewOpen(true);
  };

  const submitInterview = () => {
    if (!interviewAt) {
      message.error(`Please pick the ${interviewMode === 'reschedule' ? 'new ' : ''}interview date & time.`);
      return;
    }
    if (!interviewerEmailOk) {
      setInterviewerEmailTouched(true);
      message.error(
        parsedInterviewers.invalid.length > 0
          ? `Not a valid email address: ${parsedInterviewers.invalid.join(', ')}`
          : "At least one interviewer's email is required so they receive the invite."
      );
      return;
    }
    interviewMutation.mutate({
      stageKey: pipeline.current_stage_key,
      startAt: interviewAt.toDate().toISOString(),
      duration: interviewDuration,
      email: interviewerEmail.trim(),
      mode: interviewMode,
    });
  };

  const openInterviewCancelModal = () => {
    setCxlEmail({ candidateSubject: '', candidateBody: '', panelSubject: '', panelBody: '', touched: false });
    setCxlEmailForKey(null);
    setInterviewCancelOpen(true);
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
      // The backend returns the row for the CURRENT stage's round only, so it
      // must not leak onto the other Zeko stage's card when browsing history.
      zekoHrPipeline: stage.stage_key === pipeline.current_stage_key ? zekoHrPipeline : null,
      screening,
      // Same rule for the interview booking + MRF hints.
      interviewSchedule: stage.stage_key === pipeline.current_stage_key ? interviewSchedule : null,
      mrfInterviewHints: stage.stage_key === pipeline.current_stage_key ? mrfInterviewHints : null,
      // Whether an interviewer has submitted a scorecard for THIS stage — flips
      // the "Awaiting Results" line to "Feedback received".
      scorecardSubmitted: (scorecardReport?.rounds || []).some((r) => r.stage_key === stage.stage_key),
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
                {i === 1 && showScheduleButton && isZekoStageKey(stage.stage_key) && (
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
                {/* The Teams card is only useful while the meeting can still be
                    joined. Once the occurrence is resolved — held or no-show —
                    the link is stale (it would open an empty call), so the card
                    is hidden and the outcome tag below tells the story instead.
                    A reschedule clears occurrence_status and issues a fresh
                    join URL, which brings the card back. */}
                {i === 1 && isSchedulableStageKey(stage.stage_key) && interviewSchedule?.teams_join_url
                  && !interviewSchedule.occurrence_status && (
                  <div className="cp-pipeline-step__extra">
                    <TeamsDetails schedule={interviewSchedule} />
                  </div>
                )}
                {i === 1 && showScheduleButton && isSchedulableStageKey(stage.stage_key) && (
                  <div className="cp-pipeline-step__extra" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {interviewSchedule ? (
                      // Once the interview window has ended and its occurrence is
                      // still unresolved, the recruiter confirms held/no-show —
                      // the gate that releases (or blocks) the scorecard link.
                      interviewEnded && !interviewSchedule.occurrence_status ? (
                        // Each button triggers an irreversible action that sends
                        // real email, so the tooltip spells out what happens
                        // BEFORE the click rather than after.
                        <>
                          <Tooltip title="Confirms the interview took place. Emails the interviewer a secure scorecard link to rate this candidate, and moves the round to “Awaiting Results”. This cannot be undone.">
                            <Button size="small" type="primary" icon={<CheckOutlined />}
                              loading={occurrenceMutation.isPending && occurrenceMutation.variables?.outcome === 'held'}
                              onClick={() => confirmMarkHeld(stage.label)}>
                              Mark as Held
                            </Button>
                          </Tooltip>
                          <Tooltip title="Records that the interview did not happen. Asks which side was absent, then marks the round as a no-show. No scorecard is sent to the interviewer — reschedule or reject the candidate afterwards.">
                            <Button size="small" danger icon={<CloseOutlined />} onClick={() => setNoShowOpen(true)}>
                              Mark No-show
                            </Button>
                          </Tooltip>
                          <Tooltip title="Books a new date & time for this round. Cancels the current Teams meeting, creates a new one, and emails the candidate and interviewer the updated time. No scorecard is sent.">
                            <Button size="small" icon={<CalendarOutlined />} onClick={openRescheduleModal}>
                              Reschedule
                            </Button>
                          </Tooltip>
                        </>
                      ) : interviewSchedule.occurrence_status === 'held' ? (
                        (() => {
                          // Has an interviewer already SUBMITTED a scorecard for this round?
                          const submitted = (scorecardReport?.rounds || []).some((r) => r.stage_key === stage.stage_key);
                          const label = submitted
                            ? 'Held · scorecard received'
                            : interviewSchedule.scorecard_dispatched_at ? 'Held · scorecard sent' : 'Held';
                          const tip = submitted
                            ? 'The interview took place and the interviewer has submitted their scorecard. Open “Scorecard report” to see the score.'
                            : interviewSchedule.scorecard_dispatched_at
                              ? 'The interview took place (confirmed as held). The scorecard link has been emailed to the interviewer — the candidate’s score will appear once they submit it.'
                              : 'The interview took place (confirmed as held). Send the scorecard link so the interviewer can submit their feedback.';
                          return (
                            <>
                              <Tooltip title={tip}>
                                <Tag color="green" style={{ cursor: 'help' }}>{label}</Tag>
                              </Tooltip>
                              {!interviewSchedule.scorecard_dispatched_at && !submitted && (
                                <Button size="small" type="primary"
                                  loading={sendScorecardMutation.isPending}
                                  onClick={() => sendScorecardMutation.mutate(interviewSchedule.id)}>
                                  Send scorecard link
                                </Button>
                              )}
                            </>
                          );
                        })()
                      ) : interviewSchedule.occurrence_status === 'no_show' ? (
                        <>
                          <Tooltip title={`The interview did not take place${interviewSchedule.no_show_party ? ` (${interviewSchedule.no_show_party} did not attend)` : ''}${interviewSchedule.no_show_reason ? ` — ${interviewSchedule.no_show_reason}` : ''}. No scorecard is sent for a no-show; reschedule the round or reject the candidate.`}>
                            <Tag color="red" style={{ cursor: 'help' }}>No-show{interviewSchedule.no_show_party ? ` · ${interviewSchedule.no_show_party}` : ''}</Tag>
                          </Tooltip>
                          <Button size="small" type="primary" icon={<CalendarOutlined />} onClick={openRescheduleModal}>
                            Reschedule
                          </Button>
                        </>
                      ) : (
                        // Still upcoming (or within the window) — normal actions.
                        <>
                          <Button size="small" type="primary" icon={<CalendarOutlined />} onClick={openRescheduleModal}>
                            Reschedule
                          </Button>
                          <Button size="small" danger icon={<CloseOutlined />} onClick={openInterviewCancelModal}>
                            Cancel Interview
                          </Button>
                        </>
                      )
                    ) : (
                      <Button size="small" type="primary" icon={<CalendarOutlined />} onClick={openInterviewModal}>
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
          {hasScorecards && (
            <Button
              size="small"
              type="primary"
              className="cta-primary btn-sheen"
              icon={<FileTextOutlined />}
              style={{ marginBottom: 10 }}
              onClick={() => setReportOpen(true)}
            >
              Scorecard report
            </Button>
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
                <BrandedBodyEditor value={emailBody} onChange={setEmailBody} wrapper={previewData?.wrapper} subject={emailSubject} />
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

    {/* Technical round booking (tech1/tech2). Fixed time only — there is no
        candidate-self-service slot picker for these rounds. */}
    <Modal
      open={interviewOpen}
      onCancel={() => setInterviewOpen(false)}
      title={interviewMode === 'reschedule' ? 'Reschedule interview' : 'Schedule interview'}
      width={560}
      footer={[
        <Button key="cancel" onClick={() => setInterviewOpen(false)}>Cancel</Button>,
        <Button key="confirm" type="primary" icon={<CalendarOutlined />} onClick={submitInterview} loading={interviewMutation.isPending}>
          {interviewMode === 'reschedule' ? 'Reschedule & notify' : 'Create invite'}
        </Button>,
      ]}
    >
      {pipeline && (
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
          <Text type="secondary">
            {pipeline.rpa_shortlisted_candidates?.candidate_name} · {allStages[currentIdx]?.label} · {interviewDuration}-minute interview
          </Text>

          {/* Reschedule: make it explicit that the existing slot is being cancelled. */}
          {interviewMode === 'reschedule' && interviewSchedule && (
            <Alert
              type="warning"
              showIcon
              message={(
                <span>
                  Currently scheduled for <Text strong>{fmtDateTime(interviewSchedule.scheduled_start_at)}</Text>.
                  Picking a new time below cancels this slot and books the new one — both parties are emailed the change.
                </span>
              )}
            />
          )}

          {/* Who interviews is defined on the MRF — shown read-only, since the
              column is free text and cannot be resolved to a mailbox. */}
          <div style={{ background: 'var(--ink-3)', borderRadius: 10, padding: '10px 14px' }}>
            <Text type="secondary" style={{ fontSize: 11, letterSpacing: 0.4 }}>FROM THE MRF</Text>
            <div style={{ marginTop: 4 }}>
              <Text style={{ fontSize: 12.5 }}>
                Interviewer: <Text strong>{mrfInterviewHints?.interviewerName || 'not specified'}</Text>
              </Text>
              <br />
              <Text style={{ fontSize: 12.5 }}>
                Preferred slot: <Text strong>{mrfInterviewHints?.preferredSlot || 'not specified'}</Text>
              </Text>
            </div>
          </div>

          <div>
            <Text strong style={{ fontSize: 12.5 }}>{interviewMode === 'reschedule' ? 'New date' : 'Date'} &amp; time (IST) <Text type="danger">*</Text></Text>
            <DatePicker
              showTime={{ format: 'HH:mm', minuteStep: 15 }}
              format="DD MMM YYYY, HH:mm"
              style={{ width: '100%', marginTop: 4 }}
              value={interviewAt}
              onChange={setInterviewAt}
              disabledDate={(cur) => cur && cur < dayjs().startOf('day')}
            />
          </div>

          <div>
            <Text strong style={{ fontSize: 12.5 }}>Duration</Text>
            <Select
              style={{ width: '100%', marginTop: 4 }}
              value={interviewDuration}
              onChange={setInterviewDuration}
              options={[30, 45, 60, 90].map((m) => ({ value: m, label: `${m} minutes` }))}
            />
          </div>

          <div>
            <Text strong style={{ fontSize: 12.5 }}>Interviewer email(s) <Text type="danger">*</Text></Text>
            <TextArea
              autoSize={{ minRows: 1, maxRows: 3 }}
              placeholder="name@aapnainfotech.com, second@aapnainfotech.com"
              value={interviewerEmail}
              onChange={(e) => setInterviewerEmail(e.target.value)}
              onBlur={() => setInterviewerEmailTouched(true)}
              status={interviewerEmailTouched && !interviewerEmailOk ? 'error' : undefined}
              style={{ marginTop: 4 }}
            />
            {interviewerEmailTouched && !interviewerEmailOk ? (
              <Text type="danger" style={{ fontSize: 11.5, display: 'block', marginTop: 4 }}>
                {parsedInterviewers.invalid.length > 0
                  ? `Not a valid email address: ${parsedInterviewers.invalid.join(', ')}`
                  : "At least one interviewer's email is required so they receive the invite."}
              </Text>
            ) : (
              <Text type="secondary" style={{ fontSize: 11.5, display: 'block', marginTop: 4 }}>
                {parsedInterviewers.emails.length > 1
                  ? `${parsedInterviewers.emails.length} interviewers will be invited.`
                  : 'The MRF stores the interviewer’s name only, so enter their mailbox. Separate multiple interviewers with commas.'}
              </Text>
            )}
          </div>

          {/* Editable emails — prefilled from the seeded templates, tweakable
              before send, exactly like the Approve outcome flow. */}
          <div>
            <Text strong style={{ fontSize: 12.5, display: 'block', marginBottom: 6 }}>
              Emails to send <Text type="secondary" style={{ fontWeight: 400 }}>(edit before sending)</Text>
            </Text>
            <InterviewEmailEditors
              state={schedEmail}
              onChange={(patch) => setSchedEmail((s) => ({ ...s, ...patch }))}
              candidateLabel={interviewMode === 'reschedule' ? 'Reschedule notice → candidate' : 'Invitation → candidate'}
              panelLabel={interviewMode === 'reschedule' ? 'Reschedule notice → interviewer(s)' : 'Invitation → interviewer(s)'}
              candidateWrapper={schedPreview?.candidate?.wrapper}
              panelWrapper={schedPreview?.panel?.wrapper}
              ready={!!schedPreview && (schedEmail.touched || schedEmailForKey === schedPreview)}
              key={`sched-${schedEmailForKey === schedPreview ? 'ready' : 'loading'}`}
            />
          </div>

          <Alert
            type="info"
            showIcon
            icon={<MailOutlined />}
            message={interviewMode === 'reschedule'
              ? 'Both parties are emailed the new time when you reschedule.'
              : 'Both emails are sent from the recruitment mailbox when you create the invite.'}
          />
        </Space>
      )}
    </Modal>

    <Modal
      open={interviewCancelOpen}
      onCancel={() => setInterviewCancelOpen(false)}
      title="Confirm Cancel Interview"
      width={560}
      footer={[
        <Button key="back" onClick={() => setInterviewCancelOpen(false)}>Back</Button>,
        <Button
          key="confirm"
          danger
          type="primary"
          icon={<CloseOutlined />}
          onClick={() => interviewCancelMutation.mutate()}
          loading={interviewCancelMutation.isPending}
        >
          Yes, Cancel Interview
        </Button>,
      ]}
    >
      {pipeline && interviewSchedule && (
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
          <div style={{ background: 'var(--ink-3)', borderRadius: 10, padding: '10px 14px' }}>
            <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>CANDIDATE</Text>
            <Text strong>{pipeline.rpa_shortlisted_candidates?.candidate_name}</Text>
            <Text type="secondary" style={{ fontSize: 12.5, display: 'block' }}>{pipeline.rpa_shortlisted_candidates?.candidate_email}</Text>
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 11 }}>SCHEDULED TIME</Text>
            <Text strong style={{ display: 'block' }}>
              {fmtDateTime(interviewSchedule.scheduled_start_at)} → {fmtDateTime(interviewSchedule.scheduled_end_at)}
            </Text>
            {interviewSchedule.interviewer_name && (
              <Text type="secondary" style={{ fontSize: 12.5 }}>with {interviewSchedule.interviewer_name}</Text>
            )}
          </div>
          <div>
            <Text strong style={{ fontSize: 12.5, display: 'block', marginBottom: 6 }}>
              Cancellation emails <Text type="secondary" style={{ fontWeight: 400 }}>(edit before sending)</Text>
            </Text>
            <InterviewEmailEditors
              state={cxlEmail}
              onChange={(patch) => setCxlEmail((s) => ({ ...s, ...patch }))}
              candidateLabel="Cancellation → candidate"
              panelLabel="Cancellation → interviewer(s)"
              candidateWrapper={cxlPreview?.candidate?.wrapper}
              panelWrapper={cxlPreview?.panel?.wrapper}
              ready={!!cxlPreview && (cxlEmail.touched || cxlEmailForKey === cxlPreview)}
              key={`cxl-${cxlEmailForKey === cxlPreview ? 'ready' : 'loading'}`}
            />
          </div>

          <Alert
            type="error"
            showIcon
            message="Both cancellation emails are sent immediately. The round can then be rebooked."
          />
        </Space>
      )}
    </Modal>

    {/* No-show: which side missed + reason. No scorecard is sent. */}
    <Modal
      open={noShowOpen}
      onCancel={() => setNoShowOpen(false)}
      title="Mark interview as no-show"
      width={480}
      footer={[
        <Button key="back" onClick={() => setNoShowOpen(false)}>Back</Button>,
        <Button key="confirm" danger type="primary"
          loading={occurrenceMutation.isPending && occurrenceMutation.variables?.outcome === 'no_show'}
          onClick={() => occurrenceMutation.mutate({ scheduleId: interviewSchedule?.id, outcome: 'no_show', party: noShowParty, reason: noShowReason.trim() })}>
          Record no-show
        </Button>,
      ]}
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Alert type="warning" showIcon message="No scorecard link is sent for a no-show. You can reschedule or reject the round afterwards." />
        <div>
          <Text strong style={{ fontSize: 12.5, display: 'block', marginBottom: 4 }}>Who did not attend?</Text>
          <Select
            value={noShowParty}
            onChange={setNoShowParty}
            style={{ width: '100%' }}
            options={[
              { value: 'candidate', label: 'Candidate did not join' },
              { value: 'panel', label: 'Interviewer / panel did not join' },
              { value: 'both', label: 'Neither side joined' },
              { value: 'technical', label: 'Technical / network failure' },
            ]}
          />
        </div>
        <TextArea rows={2} placeholder="Reason (optional)" value={noShowReason} onChange={(e) => setNoShowReason(e.target.value)} />
      </Space>
    </Modal>

    {/* Per-candidate scorecard report — submitted round scores + overall avg/sum. */}
    <ScorecardReportModal open={reportOpen} onClose={() => setReportOpen(false)} pipelineId={pipelineId} />
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

/**
 * TeamsDetails — in-app view of the Teams meeting a booking carries: the Join
 * link plus the dial-in Meeting ID / Passcode (the same block the invite email
 * shows). Meeting ID / Passcode appear only when the tenant returned them.
 */
function TeamsDetails({ schedule }) {
  const { message } = AntApp.useApp();
  const copy = (label, value) => {
    if (!value) return;
    navigator.clipboard?.writeText(value).then(
      () => message.success(`${label} copied`),
      () => message.error('Could not copy'),
    );
  };
  return (
    <div style={{ border: '1px solid var(--ink-3)', borderRadius: 8, padding: '8px 12px', marginTop: 4 }}>
      <Text strong style={{ fontSize: 12.5, display: 'block', marginBottom: 4 }}>Microsoft Teams meeting</Text>
      <Space size={8} wrap>
        <Button size="small" type="primary" icon={<LinkOutlined />} href={schedule.teams_join_url} target="_blank" rel="noopener noreferrer">
          Join
        </Button>
        {schedule.teams_meeting_id && (
          <Tooltip title="Click to copy">
            <Tag style={{ cursor: 'pointer' }} onClick={() => copy('Meeting ID', schedule.teams_meeting_id)}>
              ID: {schedule.teams_meeting_id}
            </Tag>
          </Tooltip>
        )}
        {schedule.teams_passcode && (
          <Tooltip title="Click to copy">
            <Tag style={{ cursor: 'pointer' }} onClick={() => copy('Passcode', schedule.teams_passcode)}>
              Passcode: {schedule.teams_passcode}
            </Tag>
          </Tooltip>
        )}
      </Space>
    </div>
  );
}

/**
 * ScorecardReportModal — lazy-loads GET /pipeline/:id/scorecard-report when
 * opened and renders each submitted round's score plus the overall average/sum.
 */
function ScorecardReportModal({ open, onClose, pipelineId }) {
  const { data, isLoading } = useQuery({
    queryKey: ['scorecard-report', pipelineId],
    // API envelope is { status, message, data: <report> }; unwrap to the report.
    queryFn: () => pipelineService.getScorecardReport(pipelineId).then((r) => r?.data?.data ?? r?.data ?? r),
    enabled: open && !!pipelineId,
  });

  return (
    <Modal open={open} onCancel={onClose} title="Candidate scorecard report" width={620} footer={<Button onClick={onClose}>Close</Button>}>
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
      ) : !data || (data.rounds || []).length === 0 ? (
        <Empty description="No submitted scorecards yet." />
      ) : (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div style={{ display: 'flex', gap: 16 }}>
            <Tag color="green" style={{ fontSize: 13, padding: '4px 10px' }}>Average: {data.overall?.average ?? '—'}</Tag>
            <Tag color="blue" style={{ fontSize: 13, padding: '4px 10px' }}>Sum: {data.overall?.sum ?? '—'}</Tag>
            <Tag style={{ fontSize: 13, padding: '4px 10px' }}>Rounds scored: {data.overall?.count ?? 0}</Tag>
          </div>
          {(data.rounds || []).map((r) => (
            <Card size="small" key={r.scorecard_id} title={`${r.stage_label} · ${r.recipient_email}`}
              extra={<Tag color={r.recommendation === 'approve' ? 'green' : r.recommendation === 'reject' ? 'red' : 'orange'}>{r.recommendation || '—'}</Tag>}>
              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                <Text><strong>Avg:</strong> {r.avg_score ?? '—'} · <strong>Comms:</strong> {r.communication ?? '—'} · <strong>Attitude:</strong> {r.attitude ?? '—'} · <strong>Final:</strong> {r.final_rating ?? '—'}</Text>
                {(r.skills || []).map((s, i) => (
                  <Text key={i} type="secondary" style={{ fontSize: 12.5 }}>{s.label}: {s.rating ?? '—'}{s.remark ? ` — ${s.remark}` : ''}</Text>
                ))}
                {r.comments ? <Text type="secondary" style={{ fontSize: 12.5 }}>“{r.comments}”</Text> : null}
              </Space>
            </Card>
          ))}
        </Space>
      )}
    </Modal>
  );
}
