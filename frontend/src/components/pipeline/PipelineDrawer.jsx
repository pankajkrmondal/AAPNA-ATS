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
  Alert, App as AntApp, Avatar, Button, Card, Collapse, DatePicker, Drawer, Empty, Input, Modal, Popconfirm, Radio, Select, Space, Spin, Tag, Tooltip, Typography,
} from 'antd';
import {
  CalendarOutlined, CheckOutlined, CloseOutlined, ExclamationCircleOutlined,
  FileTextOutlined, LinkOutlined, MailOutlined, PauseCircleOutlined,
  SendOutlined, StepForwardOutlined, UserOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import pipelineService from '../../services/pipeline';
import screeningService from '../../services/screeningService';
import assessmentImportService from '../../services/assessmentImportService';
import settingsService from '../../services/settingsService';
import AssessmentInviteModal from './AssessmentInviteModal';
import { EmailEditorTabs } from '../common/EmailBodyEditor';
import { MODAL_WIDTH } from './modalWidths';
import DateTimeField from './DateTimeField';
import { noPastDates, DATE_FORMAT, JOINING_DATE_PRESETS } from './datePickerConfig';

const { Text, Title } = Typography;
const { TextArea } = Input;

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

  // EmailBodyEditor freezes its srcDoc on first mount (to protect the caret
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
              <EmailEditorTabs
                bodyHtml={state.candidateBody}
                onBodyChange={(v) => field('candidateBody', v)}
                wrapper={candidateWrapper}
                subject={state.candidateSubject}
                height={candidateWrapper?.headerHtml ? 420 : 220}
              />
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
              <EmailEditorTabs
                bodyHtml={state.panelBody}
                onBodyChange={(v) => field('panelBody', v)}
                wrapper={panelWrapper}
                subject={state.panelSubject}
                height={panelWrapper?.headerHtml ? 420 : 220}
              />
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
const SCHEDULABLE_STAGE_KEYS = ['tech1', 'tech2', 'tech3', 'hr_round', 'ceo', 'client'];
function isSchedulableStageKey(key) {
  return SCHEDULABLE_STAGE_KEYS.includes(key);
}

/** Rounds booked WITHOUT the system inviting anyone — the recruiter coordinates
 * them by hand. Mirrors `autoInvite: false` in interviewSchedule.service.js. */
function stageSendsInvites(key) {
  return key !== 'client';
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
  // Stage 1 reads "Stage Entry" (not "Invite Sent") for zeko/scheduled_interview
  // — the real per-round invite for both is tracked in stage 2, so stage 1 here
  // is actually about how the candidate arrived: the previous stage's approval
  // (see previousStageOutcome below), not an invite this stage itself sent.
  // manual's "Invite Sent" stays as-is — assessment (its only real user today)
  // genuinely sends its own invite as this stage's first action.
  zeko: ['Stage Entry', 'Schedule Interview', 'Awaiting Results', 'Approve / Reject'],
  manual: ['Invite Sent', 'Awaiting Test', 'Awaiting Results', 'Approve / Reject'],
  // Stage 2 reads "Schedule Interview" for the same reason zeko's does: this is
  // where the recruiter ACTS, so the label names the action, not a passive wait.
  scheduled_interview: ['Stage Entry', 'Schedule Interview', 'Awaiting Results', 'Approve / Reject'],
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
 * synced scores. The document + offer stages have no sub-state data model yet,
 * so they stay honestly "not available yet" on stages 1–3; stage 4 (decision)
 * is always driven by the real outcome event, for every stage type.
 *
 * Both Zeko stages get the same real invite/schedule treatment — each has
 * its own rpa_zeko_candidate_pipeline row distinguished by `stage` ('hr' vs
 * 'functional'), threaded through from whichever stage the drawer is
 * currently scheduling for (screening.service.js's assignCandidateToZekoJob/
 * scheduleInterview both accept and honor a real `stage` param).
 *
 * Returns `emails`: a real (not mocked) email log line list, built only from
 * fields the backend actually persisted (rpa_zeko_candidate_pipeline.link_sent_at,
 * or the stage's own outcome-email dispatch flag) — never invented text.
 */
function buildPipelineSegments({ stage, stageEvents, isCurrent, previousStageOutcome, zekoScores, zekoHrPipeline, zekoReportLink, screening, interviewSchedule, mrfInterviewHints, scorecardSubmitted, assessmentResult, assessmentInvite, offer, documents }) {
  const labels = PIPELINE_LABELS[stage.stage_type] || PIPELINE_LABELS.manual;
  const enteredEvent = stageEvents.find((ev) => ev.event_type === 'entered' || ev.event_type === 'skip');
  const outcomeEvent = [...stageEvents].reverse().find((ev) => ev.event_type === 'outcome');
  const emails = [];
  let showScheduleButton = false;
  let showInviteButton = false;
  let showDocumentActions = false;

  let s1 = { state: 'pending', detail: 'Not sent yet' };
  let s2 = { state: 'pending', detail: 'Not started yet' };
  let s3 = { state: 'pending', detail: 'Not started yet' };
  let s4 = { state: 'pending', detail: 'Not yet' };

  // Assessment's "Invite Sent" is a real recruiter action (send/mark-manual),
  // not automatic — derived below from assessmentInvite instead of the
  // generic "candidate entered this stage" baseline every other stage uses.
  if (enteredEvent && stage.stage_key !== 'assessment') {
    // Real signal when available: the previous stage's approval is what
    // actually put the candidate here, and its outcome email's send status
    // is already recorded — more honest than a bare "entered this stage"
    // timestamp. Stages with their own dedicated stage-1 tracking (zeko_hr's
    // shortlist notice, offer's approval chain, etc.) overwrite s1 again
    // further down, so this is only ever the final answer where nothing
    // more specific applies.
    s1 = previousStageOutcome
      ? {
          state: 'done',
          detail: `Approved from ${previousStageOutcome.stageLabel} — ${
            previousStageOutcome.emailSent
              ? `outcome email sent ${fmtDateTime(previousStageOutcome.sentAt)}`
              : previousStageOutcome.emailError
                ? 'outcome email failed to send'
                : 'no outcome email recorded'
          }`,
        }
      : { state: 'done', detail: `Candidate entered this stage ${new Date(enteredEvent.created_at).toLocaleDateString()}` };
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
      s3 = { state: 'done', ...zekoScoreSegment(zekoScores, { coding: false }), link: zekoReportLink };
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
      s3 = { state: 'done', ...zekoScoreSegment(zekoScores), link: zekoReportLink };
    } else if (zekoHrPipeline?.link_sent_at) {
      s3 = { state: 'active', detail: 'Awaiting Zeko to sync the score' };
    } else if (enteredEvent) {
      s3 = { state: 'pending', detail: 'Awaiting Zeko to sync the score, once invited' };
    }
  } else if (isSchedulableStageKey(stage.stage_key)) {
    // Technical Rounds 1 & 2 — real booking via rpa_interview_schedule. WHO
    // interviews comes from the MRF (first/second_technical_round); the
    // recruiter supplies the mailbox when booking.
    const autoInvites = stageSendsInvites(stage.stage_key);
    if (interviewSchedule) {
      s2 = {
        state: 'done',
        detail: `${autoInvites ? 'Scheduled' : 'Recorded (coordinated manually)'} · ${fmtDateTime(interviewSchedule.scheduled_start_at)}${interviewSchedule.interviewer_name ? ` with ${interviewSchedule.interviewer_name}` : ''}`,
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
  } else if (stage.stage_key === 'offer') {
    // Record-only offer (Q3): the letter is prepared and shared by HR outside
    // the ATS, so these segments track the internal approval, the share, and
    // the candidate's answer — never a document.
    if (offer?.approval_status === 'approved') {
      s1 = { state: 'done', detail: `Approved internally${offer.approved_at ? ` · ${fmtDateTime(offer.approved_at)}` : ''}` };
    } else if (offer?.approval_requested_at) {
      s1 = { state: 'active', detail: `Requested ${fmtDateTime(offer.approval_requested_at)} — awaiting recruiter sign-off` };
    } else if (enteredEvent) {
      s1 = { state: 'active', detail: 'Internal approval not requested yet' };
    }

    if (offer?.shared_at) {
      s2 = {
        state: 'done',
        detail: `Shared ${fmtDateTime(offer.shared_at)}${offer.joining_date ? ` · proposed joining ${new Date(offer.joining_date).toLocaleDateString()}` : ''}`,
      };
    } else if (offer?.approval_status === 'approved') {
      s2 = { state: 'active', detail: 'Approved — not yet shared with the candidate' };
    } else if (enteredEvent) {
      s2 = { state: 'pending', detail: 'Awaiting internal approval before the offer goes out' };
    }

    if (offer?.candidate_decision === 'accepted' || offer?.candidate_decision === 'rejected') {
      s3 = {
        state: offer.candidate_decision === 'accepted' ? 'done' : 'rejected',
        detail: `Candidate ${offer.candidate_decision}${offer.decision_at ? ` · ${fmtDateTime(offer.decision_at)}` : ''}`,
      };
    } else if (offer?.shared_at) {
      s3 = { state: 'active', detail: 'Awaiting the candidate’s decision' };
    } else if (enteredEvent) {
      s3 = { state: 'pending', detail: 'Awaiting the offer to be shared' };
    }
  } else if (stage.stage_key === 'documents') {
    const req = documents?.request;
    const docs = req?.rpa_candidate_documents || [];
    const uploaded = docs.filter((d) => d.status !== 'pending').length;
    const verified = docs.filter((d) => d.status === 'verified').length;
    const rejected = docs.filter((d) => d.status === 'rejected').length;

    if (req) {
      s1 = { state: 'done', detail: `Request emailed to the candidate · ${fmtDateTime(req.requested_at)} (vendor not copied — PII)` };
      if (req.last_reminded_at) {
        emails.push(`Document reminder → candidate · ${fmtDateTime(req.last_reminded_at)}${req.reminder_count > 1 ? ` (${req.reminder_count} sent)` : ''}`);
      }
      emails.push(`Document request → candidate only · ${fmtDateTime(req.requested_at)}`);
    } else if (enteredEvent) {
      s1 = { state: 'active', detail: 'Document request not sent yet' };
    }

    if (!req) {
      s2 = { state: 'pending', detail: 'Send the document request to start collection' };
      s3 = { state: 'pending', detail: 'Awaiting the candidate’s uploads' };
    } else {
      s2 = uploaded === docs.length && docs.length > 0
        ? { state: 'done', detail: `All ${docs.length} document(s) uploaded` }
        : { state: 'active', detail: uploaded === 0 ? 'No uploads yet' : `${uploaded} of ${docs.length} document(s) uploaded` };

      if (docs.length > 0 && verified === docs.length) {
        s3 = { state: 'done', detail: 'All documents verified' };
      } else if (uploaded > 0) {
        s3 = {
          state: 'active',
          detail: `${verified} of ${docs.length} verified${rejected ? ` — ${rejected} rejected, re-requested` : ''}`,
        };
      } else {
        s3 = { state: 'pending', detail: 'Awaiting uploads to verify' };
      }
    }

    showDocumentActions = isCurrent && !outcomeEvent;
  } else if (enteredEvent) {
    s2 = { state: 'pending', detail: 'Not tracked for this stage type' };
    s3 = { state: 'pending', detail: 'Not tracked for this stage type' };
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
    showDocumentActions,
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
  // Approving into an optional stage (Tech 3, Client Interview): recruiter picks
  // whether to send the candidate there or skip straight past it, right in the
  // same Approve modal — defaults to NOT skipping (the safer, current behavior).
  const [skipOptionalNext, setSkipOptionalNext] = useState(false);
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
  // Greets the panel invite by name. Prefilled from the MRF where that column
  // holds a real name, but editable: tech3 has no MRF interviewer column at all,
  // and the MRF field is free text that is often a team rather than a person.
  const [interviewerName, setInterviewerName] = useState('');
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
  // Offer round (Module 5) — the "record offer shared" and closure modals.
  const [offerShareOpen, setOfferShareOpen] = useState(false);
  const [offerJoiningDate, setOfferJoiningDate] = useState(null);
  const [offerRemarks, setOfferRemarks] = useState('');
  const [closureOpen, setClosureOpen] = useState(false);
  const [closureOutcome, setClosureOutcome] = useState(null);
  const [closureNotes, setClosureNotes] = useState('');

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

  // Phase 3 M4 — the document request + checklist state for this journey.
  const { data: documentsData } = useQuery({
    queryKey: ['pipeline-documents', pipelineId],
    queryFn: async () => {
      const res = await pipelineService.getDocumentStatus(pipelineId);
      return res.data?.data || res.data;
    },
    enabled: open && !!pipelineId,
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
    queryKey: ['schedule-preview', interviewMode, pipelineId, pipeline?.current_stage_key, interviewAt?.toISOString(), interviewDuration, interviewerName, interviewerEmail],
    queryFn: async () => {
      const params = {
        stage_key: pipeline?.current_stage_key,
        start_at: interviewAt ? interviewAt.toISOString() : undefined,
        duration_minutes: interviewDuration,
        // In the key as well as the params: the panel greeting is compiled from
        // these, and this compiled body is what gets posted back and sent. A
        // preview that ignored the name would send "Hi there," however the
        // recruiter filled the field in.
        interviewer_name: interviewerName || undefined,
        interviewer_email: interviewerEmail || undefined,
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
      // api.js normalises response.data.message onto .message, so the server's
      // own sentence renders here — not a generic fallback (N5).
      message.error(err?.message || 'Failed to record outcome.');
      // A 409 means this tab is looking at stale state (defect D3). Telling the
      // recruiter to "reopen the candidate" and then leaving the stale screen up
      // invites the same click again, so refresh it for them — the message
      // explains what happened, the refresh makes the drawer true.
      if (err?.status === 409) {
        queryClient.invalidateQueries({ queryKey: ['pipeline-detail', pipelineId] });
        onChanged?.();
      }
    },
  });

  /**
   * The Documents round's actions (Module 4). Every one of these returns the
   * refreshed document status, so the panel re-renders from the server rather
   * than a locally-guessed state.
   */
  const documentMutation = useMutation({
    mutationFn: ({ action, docId, reason }) => {
      if (action === 'request') return pipelineService.requestDocuments(pipelineId);
      if (action === 'remind') return pipelineService.remindDocuments(pipelineId);
      if (action === 'verify') return pipelineService.verifyDocument(docId);
      return pipelineService.rejectDocument(docId, reason);
    },
    onSuccess: (_res, { successMessage }) => {
      queryClient.invalidateQueries({ queryKey: ['pipeline-documents', pipelineId] });
      queryClient.invalidateQueries({ queryKey: ['pipeline-detail', pipelineId] });
      onChanged?.();
      message.success(successMessage);
    },
    onError: (err) => {
      message.error(err?.message || 'Failed to update documents.');
    },
  });

  /**
   * The Offer round's actions (Module 5). All record-only: the appointment
   * letter itself is prepared and shared by HR outside the ATS, so nothing here
   * generates or stores one.
   */
  const offerMutation = useMutation({
    mutationFn: ({ action, payload }) => {
      if (action === 'request-approval') return pipelineService.requestOfferApproval(pipelineId);
      if (action === 'approve') return pipelineService.approveOffer(pipelineId);
      if (action === 'share') return pipelineService.recordOfferShared(pipelineId, payload);
      return pipelineService.recordOfferDecision(pipelineId, payload);
    },
    onSuccess: (_res, { successMessage }) => {
      queryClient.invalidateQueries({ queryKey: ['pipeline-detail', pipelineId] });
      onChanged?.();
      setOfferShareOpen(false);
      // Clear the form so reopening the modal doesn't show the previous values.
      setOfferJoiningDate(null);
      setOfferRemarks('');
      message.success(successMessage);
    },
    onError: (err) => {
      message.error(err?.message || 'Failed to update the offer.');
    },
  });

  const closureMutation = useMutation({
    mutationFn: () => pipelineService.setFinalOutcome(pipelineId, {
      final_outcome_key: closureOutcome,
      notes: closureNotes || null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipeline-detail', pipelineId] });
      onChanged?.();
      setClosureOpen(false);
      setClosureNotes('');
      setClosureOutcome(null);
      message.success('Candidate record closed.');
    },
    onError: (err) => {
      message.error(err?.message || 'Failed to close the record.');
    },
  });

  // Optional stages (Tech 3, Client Interview) can be advanced past without
  // recording an outcome — mirrors the backend's advanceStage(skip:true)
  // (02-BUSINESS-DESIGN.md §2 rule 2). No outcome email is sent for a skip.
  const skipStageMutation = useMutation({
    mutationFn: () => pipelineService.advanceStage(pipelineId, { skip: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipeline-detail', pipelineId] });
      onChanged?.();
      message.success('Round skipped — advanced to the next stage.');
    },
    onError: (err) => {
      message.error(err?.message || 'Failed to skip this round.');
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
    mutationFn: (reason) => screeningService.cancelZekoInterview({ pipeline_id: zekoHrPipeline.id, cancel_reason: reason || 'Cancelled from Candidate Pipeline' }),
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
    mutationFn: ({ stageKey, startAt, duration, email, name, mode }) => {
      const payload = {
        stage_key: stageKey,
        start_at: startAt,
        duration_minutes: duration,
        interviewer_email: email,
        interviewer_name: name,
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
      setInterviewerName('');
      setSchedEmail({ candidateSubject: '', candidateBody: '', panelSubject: '', panelBody: '', touched: false });
      setSchedEmailForKey(null);
    },
    onError: (err) => {
      message.error(err?.response?.data?.message || err?.message || 'Failed to save the interview.');
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
      message.error(err?.response?.data?.message || err?.message || 'Failed to cancel the interview.');
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
  const zekoReportLink = data?.zekoReportLink;
  const mrfInterviewHints = data?.mrfInterviewHints;
  const cvFileUrl = data?.cvFileUrl;
  const screening = data?.screening;
  const zekoJobs = zekoJobsData || [];
  // Scoped to whichever Zeko round is being scheduled, so a job published
  // for the wrong round (e.g. HR when scheduling Functional) isn't even
  // offered — same job title is often published twice, once per round,
  // distinguished only by interview_type. Falls back to the full list (with
  // a visible warning) if nothing matches, so a data/tagging gap never
  // blocks scheduling outright.
  const isHrRound = pipeline?.current_stage_key === 'zeko_hr';
  const matchingZekoJobs = zekoJobs.filter((j) => (isHrRound ? j.interview_type === 'hr' : j.interview_type !== 'hr'));
  const zekoJobOptions = matchingZekoJobs.length > 0 ? matchingZekoJobs : zekoJobs;
  const zekoJobFallback = matchingZekoJobs.length === 0 && zekoJobs.length > 0;
  const ZEKO_TYPE_TAG = { hr: { label: 'HR', color: 'blue' }, functional: { label: 'Functional', color: 'green' }, coding: { label: 'Coding', color: 'purple' } };
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
    // Both halves are set independently now (Outlook-style opens/closes
    // fields), so one can be filled while the other is still empty — a
    // length check alone would pass and then blow up on .toDate() below.
    if (!scheduleDates?.[0] || !scheduleDates?.[1]) {
      message.error('Please set when the interview window opens and closes.');
      return;
    }
    if (!scheduleDates[1].isAfter(scheduleDates[0])) {
      message.error('The window must close after it opens.');
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
    // The MRF names who takes this round — start from that rather than making the
    // recruiter retype what is already displayed above the field.
    setInterviewerName(mrfInterviewHints?.interviewerName || '');
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
    setInterviewerName(interviewSchedule?.interviewer_name || mrfInterviewHints?.interviewerName || '');
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
      name: interviewerName.trim(),
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

  // Mirrors the backend's vendorForJourney() (vendorNotification.service.js):
  // vendor-sourced journeys only, since a stale vendor_email on a
  // screening_shortlist row must not promise mail that won't be sent.
  //
  // The vendor is NOT cc'd (M6) — they get their own generated status line, so
  // nothing the recruiter types below can reach them. Named `vendorNotified`
  // rather than `vendorCc` so this screen stops describing a cc that no longer
  // exists.
  const vendorNotified = pipeline?.source === 'vendor' ? pipeline?.vendor_email : null;
  // Documents is the one stage that tells a vendor nothing at all (Q5).
  const vendorSuppressedHere = selectedStageKey === 'documents';

  const isRejectOrHold = decisionOutcome === 'rejected' || decisionOutcome === 'hold';
  const selectedReason = reasons.find((r) => r.id === reasonId);

  // Approving the current stage would normally auto-advance to allStages[currentIdx + 1].
  // When that next stage is optional (Tech 3, Client Interview), the modal offers a choice
  // instead of silently walking onto it — send the candidate there, or skip straight to
  // the stage after it (allStages[currentIdx + 2]).
  const nextStageIfApproved = allStages[currentIdx + 1];
  const stageAfterOptionalNext = allStages[currentIdx + 2];
  const showOptionalNextChoice = decisionOutcome === 'approved' && !!nextStageIfApproved?.is_optional;

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
    setSkipOptionalNext(false);
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
      skip_optional_next: showOptionalNextChoice ? skipOptionalNext : undefined,
      // The stage THIS DRAWER is displaying. If someone else moved the candidate
      // while this tab sat open, the server 409s instead of silently advancing
      // them a second time (defect D3). Sent from the rendered pipeline, not
      // re-fetched — a fresh read here would defeat the entire point.
      expected_stage_key: pipeline?.current_stage_key,
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

    // What actually got the candidate INTO this stage: the previous active
    // stage's approval — not a Zeko/interview invite this stage sent itself
    // (that's tracked separately, in stage 2). Looked up from the full,
    // unfiltered event history (stageEvents above is scoped to this stage
    // only). Genuinely null for the pipeline's first stage — there is no
    // prior stage to have approved anything.
    const stageIdx = allStages.findIndex((s) => s.stage_key === stage.stage_key);
    const priorStage = stageIdx > 0 ? allStages[stageIdx - 1] : null;
    const priorOutcomeEvent = priorStage
      ? [...(pipeline.rpa_pipeline_stage_events || [])]
          .reverse()
          .find((ev) => ev.stage_key === priorStage.stage_key && ev.event_type === 'outcome' && ev.outcome === 'approved')
      : null;
    const previousStageOutcome = priorOutcomeEvent
      ? {
          stageLabel: priorStage.label,
          emailSent: !!priorOutcomeEvent.email_sent,
          emailError: priorOutcomeEvent.email_error,
          sentAt: priorOutcomeEvent.created_at,
        }
      : null;

    const { segments: segs, emails, showScheduleButton, showInviteButton, showDocumentActions } = buildPipelineSegments({
      stage,
      stageEvents,
      isCurrent,
      previousStageOutcome,
      zekoScores: isZekoStageKey(stage.stage_key) ? zekoScores : null,
      // The backend returns the row for the CURRENT stage's round only, so it
      // must not leak onto the other Zeko stage's card when browsing history.
      zekoHrPipeline: stage.stage_key === pipeline.current_stage_key ? zekoHrPipeline : null,
      zekoReportLink: stage.stage_key === pipeline.current_stage_key ? zekoReportLink : null,
      screening,
      // Same rule for the interview booking + MRF hints.
      interviewSchedule: stage.stage_key === pipeline.current_stage_key ? interviewSchedule : null,
      mrfInterviewHints: stage.stage_key === pipeline.current_stage_key ? mrfInterviewHints : null,
      // Whether an interviewer has submitted a scorecard for THIS stage — flips
      // the "Awaiting Results" line to "Feedback received".
      scorecardSubmitted: (scorecardReport?.rounds || []).some((r) => r.stage_key === stage.stage_key),
      assessmentResult: stage.stage_key === 'assessment' ? assessmentResultData?.result : null,
      assessmentInvite: stage.stage_key === 'assessment' ? assessmentInviteData : null,
      offer: stage.stage_key === 'offer' ? data?.offer : null,
      documents: stage.stage_key === 'documents' ? documentsData : null,
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
                {s.link && (
                  <a href={s.link} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 6 }}>
                    <LinkOutlined /> View full report on Zeko
                  </a>
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
                {i === 0 && showDocumentActions && !documentsData?.request && (
                  <div className="cp-pipeline-step__extra">
                    <Button
                      size="small"
                      type="primary"
                      icon={<SendOutlined />}
                      loading={documentMutation.isPending}
                      onClick={() => documentMutation.mutate({
                        action: 'request',
                        successMessage: 'Document request sent — a secure upload link was emailed to the candidate.',
                      })}
                    >
                      Send document request
                    </Button>
                  </div>
                )}
                {i === 2 && showDocumentActions && documentsData?.request && (
                  <div className="cp-pipeline-step__extra">
                    <DocumentChecklist
                      documents={documentsData.request.rpa_candidate_documents}
                      pending={documentMutation.isPending}
                      onVerify={(docId) => documentMutation.mutate({ action: 'verify', docId, successMessage: 'Document verified.' })}
                      onReject={(docId, reason) => documentMutation.mutate({
                        action: 'reject',
                        docId,
                        reason,
                        successMessage: 'Rejected — a re-request was emailed to the candidate.',
                      })}
                      onRemind={() => documentMutation.mutate({ action: 'remind', successMessage: 'Reminder sent.' })}
                    />
                  </div>
                )}
                {i === 1 && showScheduleButton && isZekoStageKey(stage.stage_key) && (
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

          {/* The Offer round has its own lifecycle (approval → shared → decision
              → close) instead of the generic Approve/Reject/Hold bar. */}
          {isCurrentStageSelected && !pipeline.final_outcome && selectedStageKey === 'offer' && (
            <OfferActions
              offer={data?.offer}
              pending={offerMutation.isPending}
              onRequestApproval={() => offerMutation.mutate({ action: 'request-approval', successMessage: 'Approval requested — a daily reminder is armed until it is approved.' })}
              onApprove={() => offerMutation.mutate({ action: 'approve', successMessage: 'Offer approved internally.' })}
              onOpenShare={() => setOfferShareOpen(true)}
              onDecision={(decision) => offerMutation.mutate({
                action: 'decision',
                payload: { decision },
                successMessage: `Offer marked ${decision}.`,
              })}
              onClose={() => setClosureOpen(true)}
            />
          )}

          {isCurrentStageSelected && !pipeline.final_outcome && selectedStageKey !== 'offer' && (
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
              {allStages[currentIdx]?.is_optional && (
                <div style={{ marginBottom: 12 }}>
                  <Popconfirm
                    title="Skip this optional round?"
                    description={`Skip ${allStages[currentIdx].label} and move straight to ${allStages[currentIdx + 1]?.label || 'the next stage'}? This is logged and cannot be undone from here.`}
                    onConfirm={() => skipStageMutation.mutate()}
                    okText="Yes, skip it"
                  >
                    <Button size="small" type="link" icon={<StepForwardOutlined />} loading={skipStageMutation.isPending} style={{ paddingLeft: 0 }}>
                      Skip this optional round
                    </Button>
                  </Popconfirm>
                </div>
              )}
              {/* States what actually happens now (M6): two separate emails,
                  the vendor's built from a fixed status vocabulary rather than
                  from anything typed here. The old copy promised a cc, which
                  would have meant the vendor reading the body below. */}
              <Alert
                type="info"
                showIcon
                icon={<MailOutlined />}
                message={!vendorNotified
                  ? 'Outcome emails go to the candidate automatically, from the recruitment mailbox.'
                  : vendorSuppressedHere
                    ? `The candidate is emailed automatically. ${vendorNotified} is told nothing at this stage — document requests never reach a vendor.`
                    : `The candidate is emailed automatically. ${vendorNotified} separately receives a short status line — name, position, stage, outcome — never the message below.`}
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
      width={MODAL_WIDTH.EMAIL}
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
          {showOptionalNextChoice && (
            <div>
              <Text strong style={{ fontSize: 12.5 }}>Next stage — {nextStageIfApproved.label} is optional</Text>
              <Radio.Group
                style={{ display: 'block', marginTop: 6 }}
                value={skipOptionalNext}
                onChange={(e) => setSkipOptionalNext(e.target.value)}
              >
                <Space direction="vertical">
                  <Radio value={false}>Send to {nextStageIfApproved.label}</Radio>
                  <Radio value={true}>Skip straight to {stageAfterOptionalNext?.label || 'the next stage'}</Radio>
                </Space>
              </Radio.Group>
            </div>
          )}
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
              {/* "→ candidate" with no vendor appended, even when one is
                  notified: this header labels the box the recruiter is editing,
                  and that text goes to the candidate alone. */}
              <Text strong style={{ fontSize: 12.5 }}><MailOutlined style={{ marginInlineEnd: 4 }} />Outcome email → candidate</Text>
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
                <EmailEditorTabs
                  bodyHtml={emailBody}
                  onBodyChange={setEmailBody}
                  wrapper={previewData?.wrapper}
                  subject={emailSubject}
                  height={previewData?.wrapper?.headerHtml ? 420 : 220}
                />
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
      width={MODAL_WIDTH.FORM}
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
            <Text strong style={{ fontSize: 12.5 }}>Zeko Job — {isHrRound ? 'HR Screening' : 'Functional Test'} round</Text>
            {zekoJobFallback && (
              <Alert
                type="warning"
                showIcon
                style={{ marginTop: 4, marginBottom: 4, fontSize: 12 }}
                message={`No jobs tagged for the ${isHrRound ? 'HR' : 'Functional'} round — showing all published jobs.`}
              />
            )}
            <Select
              style={{ width: '100%', marginTop: 4 }}
              placeholder="Select a Zeko job"
              value={scheduleJobId}
              onChange={setScheduleJobId}
              showSearch
              optionFilterProp="label"
              options={zekoJobOptions.map((j) => ({
                value: j.zeko_id,
                label: j.hiring_name || j.title,
                role: j.role_name,
                type: j.interview_type,
              }))}
              optionRender={(option) => (
                <div style={{ padding: '2px 0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontWeight: 600, whiteSpace: 'normal', lineHeight: 1.35 }}>{option.data.label}</span>
                    {ZEKO_TYPE_TAG[option.data.type] && (
                      <Tag color={ZEKO_TYPE_TAG[option.data.type].color} style={{ marginInlineEnd: 0, fontSize: 11, lineHeight: '16px' }}>
                        {ZEKO_TYPE_TAG[option.data.type].label}
                      </Tag>
                    )}
                  </div>
                  {option.data.role && (
                    <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Role: {option.data.role}</div>
                  )}
                </div>
              )}
            />
          </div>
          <div>
            <Text strong style={{ fontSize: 12.5 }}>Interview window (IST)</Text>
            <div style={{ marginTop: 2 }}>
              <Text type="secondary" style={{ fontSize: 11.5 }}>Opens</Text>
              <DateTimeField
                value={scheduleDates?.[0] || null}
                onChange={(next) => setScheduleDates([next, scheduleDates?.[1] || null])}
                disabledDate={noPastDates}
                datePlaceholder="Window opens"
              />
            </div>
            <div style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ fontSize: 11.5 }}>Closes</Text>
              <DateTimeField
                value={scheduleDates?.[1] || null}
                onChange={(next) => setScheduleDates([scheduleDates?.[0] || null, next])}
                defaultHour={18}
                // The window can never close before it opens.
                disabledDate={(cur) => noPastDates(cur)
                  || (scheduleDates?.[0] && cur && cur < scheduleDates[0].startOf('day'))}
                datePlaceholder="Window closes"
              />
            </div>
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
      width={MODAL_WIDTH.CONFIRM}
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
      width={MODAL_WIDTH.EMAIL}
      footer={[
        <Button key="cancel" onClick={() => setInterviewOpen(false)}>Cancel</Button>,
        <Button key="confirm" type="primary" icon={<CalendarOutlined />} onClick={submitInterview} loading={interviewMutation.isPending}>
          {!stageSendsInvites(selectedStageKey)
            ? 'Record booking'
            : interviewMode === 'reschedule' ? 'Reschedule & notify' : 'Create invite'}
        </Button>,
      ]}
    >
      {pipeline && (
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
          <Text type="secondary">
            {pipeline.rpa_shortlisted_candidates?.candidate_name} · {allStages[currentIdx]?.label} · {interviewDuration}-minute interview
          </Text>

          {/* The client is external: the system never emails or invites them
              (Q14). Booking here only records the round for tracking. */}
          {!stageSendsInvites(selectedStageKey) && (
            <Alert
              type="info"
              showIcon
              message="This round is coordinated manually — saving records the booking only. No Teams meeting is created and no invite email is sent to the candidate or the client."
            />
          )}

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
            <Text strong style={{ fontSize: 12.5 }}>{interviewMode === 'reschedule' ? 'New start' : 'Start'} time (IST) <Text type="danger">*</Text></Text>
            <DateTimeField
              value={interviewAt}
              onChange={setInterviewAt}
              disabledDate={noPastDates}
              datePlaceholder="Select a date"
            />
          </div>

          <div>
            <Text strong style={{ fontSize: 12.5 }}>Duration</Text>
            <Select
              size="large"
              style={{ width: '100%', marginTop: 4 }}
              value={interviewDuration}
              onChange={setInterviewDuration}
              options={[15, 30, 45, 60, 90, 120].map((m) => ({
                value: m,
                label: m >= 60 ? `${m / 60} hour${m > 60 ? 's' : ''}${m % 60 ? ` ${m % 60} min` : ''}` : `${m} minutes`,
              }))}
            />
            {interviewAt && (
              <Text type="secondary" style={{ fontSize: 11.5, display: 'block', marginTop: 4 }}>
                Ends at {interviewAt.add(interviewDuration, 'minute').format('h:mm A')} · {interviewAt.format('ddd, DD MMM YYYY')}
              </Text>
            )}
          </div>

          {/* Optional, but it is what the panel invite greets them by — left
              blank the email opens "Hi there,". Prefilled from the MRF above. */}
          <div>
            <Text strong style={{ fontSize: 12.5 }}>Interviewer name</Text>
            <Input
              placeholder="Who is taking this round?"
              value={interviewerName}
              onChange={(e) => setInterviewerName(e.target.value)}
              style={{ marginTop: 4 }}
              allowClear
            />
            <Text type="secondary" style={{ fontSize: 11.5, display: 'block', marginTop: 4 }}>
              {parsedInterviewers.emails.length > 1
                ? 'With more than one interviewer the invite opens “Hi all,”.'
                : 'Used to address the interviewer’s invitation email.'}
            </Text>
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
              before send, exactly like the Approve outcome flow. Hidden on
              manually-coordinated rounds, which send nothing. */}
          {stageSendsInvites(selectedStageKey) && (
            <>
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
            </>
          )}
        </Space>
      )}
    </Modal>

    <Modal
      open={interviewCancelOpen}
      onCancel={() => setInterviewCancelOpen(false)}
      title="Confirm Cancel Interview"
      width={MODAL_WIDTH.EMAIL}
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
      width={MODAL_WIDTH.CONFIRM}
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

    {/* Offer round — record what HR shared outside the ATS. */}
    <Modal
      open={offerShareOpen}
      onCancel={() => setOfferShareOpen(false)}
      title="Record offer as shared"
      width={MODAL_WIDTH.CONFIRM}
      okText="Record it"
      confirmLoading={offerMutation.isPending}
      onOk={() => offerMutation.mutate({
        action: 'share',
        payload: {
          joining_date: offerJoiningDate ? offerJoiningDate.format('YYYY-MM-DD') : null,
          remarks: offerRemarks || null,
        },
        successMessage: 'Offer recorded as shared.',
      })}
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          message="HR shares the appointment letter from their own mailbox. This only records that it went out — no letter is stored or sent by the ATS."
        />
        <div>
          <Text strong style={{ fontSize: 12.5 }}>Proposed joining date</Text>
          <DatePicker
            size="large"
            style={{ width: '100%', marginTop: 4 }}
            format={DATE_FORMAT}
            disabledDate={noPastDates}
            presets={JOINING_DATE_PRESETS}
            placeholder="Pick the proposed joining date"
            value={offerJoiningDate}
            onChange={setOfferJoiningDate}
          />
        </div>
        <TextArea rows={2} placeholder="Remarks (optional)" value={offerRemarks} onChange={(e) => setOfferRemarks(e.target.value)} />
      </Space>
    </Modal>

    {/* Closure — the 8 final statuses (Q12). Ends the journey. */}
    <Modal
      open={closureOpen}
      onCancel={() => setClosureOpen(false)}
      title="Close candidate record"
      width={MODAL_WIDTH.CONFIRM}
      okText="Close the record"
      okButtonProps={{ danger: true, disabled: !closureOutcome }}
      confirmLoading={closureMutation.isPending}
      onOk={() => closureMutation.mutate()}
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        {/* Deliberately does NOT promise an email: the 8 closure outcomes have
            no generic fallback template (stageNotification.service.js only
            covers approved/rejected/hold), so one is sent only where an admin
            has mapped a template to that status. */}
        <Alert
          type="warning"
          showIcon
          message="This ends the journey and removes the candidate from the active board. A closure email is sent only if a template is mapped to the status you pick."
        />
        <div>
          <Text strong style={{ fontSize: 12.5 }}>Final status <Text type="danger">*</Text></Text>
          <Select
            style={{ width: '100%', marginTop: 4 }}
            placeholder="Pick the final status"
            value={closureOutcome}
            onChange={setClosureOutcome}
            options={CLOSURE_OPTIONS}
          />
        </div>
        <TextArea rows={2} placeholder="Notes (optional)" value={closureNotes} onChange={(e) => setClosureNotes(e.target.value)} />
      </Space>
    </Modal>
    </>
  );
}

/** How each document state reads in the verification table. */
const DOC_TAG = {
  pending: { color: 'default', label: 'Not uploaded' },
  uploaded: { color: 'blue', label: 'Uploaded — review' },
  verified: { color: 'green', label: 'Verified' },
  rejected: { color: 'red', label: 'Rejected — re-requested' },
};

/**
 * DocumentChecklist — HR's verification view of what the candidate sent.
 *
 * Verify/Reject appear only on an uploaded document: a pending one has nothing
 * to judge, and a verified/rejected one has already been judged. Rejecting takes
 * a mandatory reason because it is emailed to the candidate as the re-request.
 */
function DocumentChecklist({ documents = [], pending, onVerify, onReject, onRemind }) {
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState('');

  const submitReject = () => {
    if (!rejectReason.trim()) return;
    onReject(rejectingId, rejectReason.trim());
    setRejectingId(null);
    setRejectReason('');
  };

  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      {documents.map((doc) => {
        const tag = DOC_TAG[doc.status] || DOC_TAG.pending;
        return (
          <div key={doc.id} style={{ borderBottom: '1px solid var(--ant-color-border)', paddingBottom: 6 }}>
            <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
              <Space size={6} wrap>
                <Text style={{ fontSize: 12.5 }}>{doc.rpa_document_checklist_items?.label || 'Document'}</Text>
                <Tag color={tag.color} style={{ marginInlineEnd: 0 }}>{tag.label}</Tag>
              </Space>
              {doc.status === 'uploaded' && (
                <Space size={4}>
                  {doc.file_url && (
                    <Button size="small" type="link" href={doc.file_url} target="_blank" rel="noreferrer" style={{ paddingInline: 4 }}>
                      Open
                    </Button>
                  )}
                  <Button size="small" loading={pending} onClick={() => onVerify(doc.id)}>Verify</Button>
                  <Button size="small" danger onClick={() => { setRejectingId(doc.id); setRejectReason(''); }}>Reject…</Button>
                </Space>
              )}
            </Space>
            {doc.status === 'rejected' && doc.remarks ? (
              <Text type="secondary" style={{ fontSize: 11.5 }}>Reason sent to candidate: {doc.remarks}</Text>
            ) : null}
          </div>
        );
      })}

      <Button size="small" type="link" icon={<MailOutlined />} loading={pending} onClick={onRemind} style={{ paddingLeft: 0 }}>
        Send a reminder now
      </Button>
      <Text type="secondary" style={{ fontSize: 11.5 }}>
        {/* The daily sweep (jobs/documentReminder.js) has run since Phase 3 M4, but
            this panel never said so — showing only a "Send reminder" button read as
            "chasing is manual". The Offer panel already states its own schedule. */}
        Reminders are automatic: the candidate is chased two days after the request and then daily,
        up to three times, until everything is in. The button above sends one immediately.
      </Text>
      <Text type="secondary" style={{ fontSize: 11.5 }}>
        The candidate uploads via a secure link — no login. Vendors never see documents or these emails.
        Completeness is automatic; authenticity stays with the recruitment team.
      </Text>

      <Modal
        open={rejectingId !== null}
        onCancel={() => setRejectingId(null)}
        title="Reject document"
        width={MODAL_WIDTH.CONFIRM}
        okText="Reject & re-request"
        okButtonProps={{ danger: true, disabled: !rejectReason.trim() }}
        onOk={submitReject}
      >
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Alert type="info" showIcon message="The reason is emailed to the candidate so they know exactly what to re-upload." />
          <TextArea
            rows={3}
            placeholder="e.g. The June payslip is missing — please upload all three months."
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
        </Space>
      </Modal>
    </Space>
  );
}

/** The 8 closure statuses (Q12), in the order RT reads them. */
const CLOSURE_OPTIONS = [
  { value: 'joined', label: 'Joined' },
  { value: 'candidate_withdrawn', label: 'Candidate Withdrawn' },
  { value: 'did_not_join', label: 'Did Not Join' },
  { value: 'backed_out', label: 'Backed Out' },
  { value: 'joined_and_left', label: 'Joined and Left' },
  { value: 'closure_approved', label: 'Approved' },
  { value: 'closure_rejected', label: 'Rejected' },
  { value: 'closure_on_hold', label: 'On Hold' },
];

/**
 * OfferActions — the Offer round's own action bar, which replaces the generic
 * Approve/Reject/Hold buttons every other stage gets.
 *
 * Record-only (Q3): HR prepares and shares the appointment letter entirely
 * outside the ATS, so this tracks the internal approval, the share date, and
 * the candidate's answer — never a letter file.
 *
 * The approval is a SOFT gate (Q26): "Record offer shared" stays available even
 * when approval was never recorded, so an exceptional case is never blocked.
 */
function OfferActions({ offer, pending, onRequestApproval, onApprove, onOpenShare, onDecision, onClose }) {
  const approved = offer?.approval_status === 'approved';
  const awaitingApproval = offer?.approval_status === 'pending' && !!offer?.approval_requested_at;
  const shared = !!offer?.shared_at;
  const decided = shared && offer?.candidate_decision !== 'pending';

  return (
    <div style={{ borderTop: '1px solid var(--ant-color-border)', marginTop: 16, paddingTop: 16 }}>
      <Title level={5} style={{ fontSize: 14 }}>Offer</Title>

      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        {!offer && (
          <Text type="secondary" style={{ fontSize: 12.5 }}>
            Record-only: HR shares the letter from its own mailbox. Request internal approval first.
          </Text>
        )}
        {awaitingApproval && (
          <Text type="warning" style={{ fontSize: 12.5 }}>
            Requested — awaiting recruiter sign-off. A daily reminder goes out until it is approved.
          </Text>
        )}
        {approved && !shared && (
          <Text type="secondary" style={{ fontSize: 12.5 }}>
            Approved internally{offer.approved_at ? ` · ${new Date(offer.approved_at).toLocaleDateString()}` : ''} — not yet shared with the candidate.
          </Text>
        )}
        {shared && (
          <Text type="secondary" style={{ fontSize: 12.5 }}>
            Shared {new Date(offer.shared_at).toLocaleDateString()}
            {offer.joining_date ? ` · proposed joining ${new Date(offer.joining_date).toLocaleDateString()}` : ''}
            {decided ? ` · candidate ${offer.candidate_decision}` : ' · awaiting the candidate’s decision'}
          </Text>
        )}

        <Space wrap>
          {!offer || (!approved && !awaitingApproval) ? (
            <Button type="primary" className="cta-primary btn-sheen" loading={pending} onClick={onRequestApproval}>
              Request internal approval
            </Button>
          ) : null}
          {awaitingApproval && (
            <Button type="primary" className="cta-primary btn-sheen" loading={pending} onClick={onApprove}>
              Mark approved
            </Button>
          )}
          {!shared && (
            <Button loading={pending} onClick={onOpenShare}>Record offer shared</Button>
          )}
          {shared && !decided && (
            <>
              <Button icon={<CheckOutlined />} loading={pending} onClick={() => onDecision('accepted')}>Mark accepted</Button>
              <Button danger icon={<CloseOutlined />} loading={pending} onClick={() => onDecision('rejected')}>Mark rejected</Button>
            </>
          )}
        </Space>

        <div>
          <Button danger size="small" onClick={onClose}>Close candidate record…</Button>
        </div>
      </Space>
    </div>
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

/** The HR round's own card fields, in the order the HR interviewer fills them. */
const HR_SCORECARD_LABELS = [
  ['hr_family_background', 'Family background'],
  ['hr_general_other', 'General / other'],
  ['hr_timings', 'Timings'],
  ['hr_communication_comments', 'Communication comments'],
  ['hr_attitude_comments', 'Attitude comments'],
  ['hr_relocation', 'Relocation'],
  ['hr_notice_period', 'Notice period'],
  ['hr_current_ctc', 'Current CTC'],
  ['hr_expected_ctc', 'Expected CTC'],
  ['hr_strengths', 'Strength'],
  ['hr_weakness', 'Weakness'],
  ['hr_only_negative', 'Only negative'],
  ['hr_other_observation', 'Any other observation / request'],
  ['hr_final_feedback', 'Final feedback'],
  ['hr_next_step', 'Next step for recruitment team'],
];

/** Renders the filled-in fields of an HR-round scorecard; skips empty ones. */
function HrScorecardFields({ hr }) {
  const filled = HR_SCORECARD_LABELS.filter(([key]) => hr[key]);
  if (filled.length === 0) return null;
  return (
    <>
      {filled.map(([key, label]) => (
        <Text key={key} type="secondary" style={{ fontSize: 12.5 }}>
          <strong>{label}:</strong> {hr[key]}
        </Text>
      ))}
    </>
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
    <Modal open={open} onCancel={onClose} title="Candidate scorecard report" width={MODAL_WIDTH.EMAIL} footer={<Button onClick={onClose}>Close</Button>}>
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

          {/* Consolidated feedback — every interviewer's verdict in one place,
              above the per-round cards. Whoever makes the final call (the CEO
              round, or HR writing the offer) previously had to open each card in
              turn and hold the picture in their head. Low-rated skills are
              called out separately because they are the thing the next
              interviewer most wants to probe and the easiest to miss. */}
          {data.consolidated_feedback && (
            <Card
              size="small"
              title="Consolidated feedback"
              style={{ background: 'var(--info-bg)', borderColor: 'var(--info-border)' }}
            >
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Text strong>{data.consolidated_feedback.summary}</Text>
                {(data.consolidated_feedback.lines || []).map((l, i) => (
                  <div key={i}>
                    <Text style={{ fontSize: 12.5 }}>{l.headline}</Text>
                    {l.concerns?.length > 0 && (
                      <div>
                        <Text type="danger" style={{ fontSize: 12 }}>
                          Concerns: {l.concerns.join(', ')}
                        </Text>
                      </div>
                    )}
                    {l.comments && (
                      <div>
                        <Text type="secondary" style={{ fontSize: 12 }}>“{l.comments}”</Text>
                      </div>
                    )}
                  </div>
                ))}
              </Space>
            </Card>
          )}
          {(data.rounds || []).map((r) => (
            <Card size="small" key={r.scorecard_id} title={`${r.stage_label} · ${r.recipient_email}`}
              extra={<Tag color={r.recommendation === 'approve' ? 'green' : r.recommendation === 'reject' ? 'red' : 'orange'}>{r.recommendation || '—'}</Tag>}>
              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                <Text><strong>Avg:</strong> {r.avg_score ?? '—'} · <strong>Comms:</strong> {r.communication ?? '—'} · <strong>Attitude:</strong> {r.attitude ?? '—'} · <strong>Final:</strong> {r.final_rating ?? '—'}</Text>
                {(r.skills || []).map((s, i) => (
                  <Text key={i} type="secondary" style={{ fontSize: 12.5 }}>{s.label}: {s.rating ?? '—'}{s.remark ? ` — ${s.remark}` : ''}</Text>
                ))}
                {r.hr ? <HrScorecardFields hr={r.hr} /> : null}
                {r.comments ? <Text type="secondary" style={{ fontSize: 12.5 }}>“{r.comments}”</Text> : null}
              </Space>
            </Card>
          ))}
        </Space>
      )}
    </Modal>
  );
}
