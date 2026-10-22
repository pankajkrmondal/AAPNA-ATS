/**
 * pipelineLabels.js — every word the pipeline board uses to say where a
 * candidate is, with a one-line meaning (Phase 3 "Do Now", N35).
 *
 * The CEO could not read the board: "Invited" meant the Zeko link was sent and
 * "In progress" meant nothing had been sent yet, and the demo explained them
 * the other way round. Card chips, their hover text and the board's "What do
 * these mean?" legend all read from here, so a wording change from RT is a
 * one-line edit in this file.
 *
 * Plain JS (imports carry their extension) so node can load it in a quick check.
 */
import { fmtDate } from '../utils/dateFormat.js';

/** Stage keys whose card has a "Zeko link sent" state (backend ZEKO_STAGE_KEYS). */
const ZEKO_STAGES = ['zeko_hr', 'zeko_fn'];
/** Stage keys booked through the Schedule Interview action (backend SCHEDULABLE_STAGES). */
const SCHEDULABLE_STAGES = ['tech1', 'tech2', 'tech3', 'hr_round', 'ceo'];

/**
 * Card statuses in the order the legend lists them.
 * `accent` is the card's left border (theme/index.css tokens).
 */
export const CARD_STATUSES = Object.freeze({
  notInvited: {
    label: 'Not yet invited',
    color: 'default',
    accent: 'var(--status-active)',
    meaning: 'Zeko screening: the interview link has not been sent to the candidate yet.',
  },
  zekoLinkSent: {
    label: 'Zeko link sent',
    color: 'blue',
    accent: 'var(--status-active)',
    meaning: 'Zeko screening: the interview link has gone to the candidate. Waiting for them to take it.',
  },
  testNotSent: {
    label: 'Test not sent',
    color: 'default',
    accent: 'var(--status-hold)',
    meaning: 'Assessment: no Evalground test has been sent yet (or the last one was withdrawn).',
  },
  testSent: {
    label: 'Test sent',
    color: 'blue',
    accent: 'var(--status-active)',
    meaning: 'Assessment: the Evalground test was sent; the chip shows the due date. Clears when the result is imported.',
  },
  testOverdue: {
    label: 'Test overdue',
    color: 'red',
    accent: 'var(--status-rejected)',
    meaning: 'Assessment: the due date has passed and no result has been imported.',
  },
  notScheduled: {
    label: 'Not yet scheduled',
    color: 'default',
    accent: 'var(--status-active)',
    meaning: 'Interview round: no interview has been booked yet.',
  },
  scheduled: {
    label: 'Scheduled',
    color: 'blue',
    accent: 'var(--status-active)',
    meaning: 'Interview round: an interview is booked.',
  },
  awaitingAction: {
    label: 'Awaiting action',
    color: 'default',
    accent: 'var(--status-active)',
    meaning: 'Nothing recorded for this stage yet (e.g. documents to collect, offer to prepare).',
  },
  awaitingDecision: {
    label: 'Awaiting decision',
    color: 'green',
    accent: 'var(--status-approved)',
    meaning: 'Zeko scores are in. A recruiter needs to approve, reject or hold.',
  },
  approved: {
    label: 'Approved',
    color: 'green',
    accent: 'var(--status-approved)',
    meaning: 'Passed this stage; ready to move to the next one.',
  },
  onHold: {
    label: 'On Hold',
    color: 'gold',
    accent: 'var(--status-hold)',
    meaning: 'A recruiter put the candidate on hold at this stage.',
  },
  rejected: {
    label: 'Rejected',
    color: 'red',
    accent: 'var(--status-rejected)',
    meaning: 'Rejected at this stage.',
  },
  closed: {
    label: 'Closed',
    color: 'default',
    accent: 'var(--status-closed)',
    meaning: 'The journey is finished (joined, withdrew, closed…). The chip shows how it ended. Shown only with "Show closed".',
  },
});

/** What happens at each stage — the column header tooltip and the legend. */
export const STAGE_DESCRIPTIONS = Object.freeze({
  shortlist: 'Candidate shortlisted for the role.',
  zeko_hr: 'AI HR screening interview on Zeko. Send the link, then decide on the scores.',
  assessment: 'Online IQ / technical test on Evalground. Send the test, then import the results.',
  zeko_fn: 'AI functional (skills) interview on Zeko.',
  tech1: 'First technical interview with the panel, booked on Teams.',
  tech2: 'Second technical interview, booked on Teams.',
  tech3: 'Optional third technical interview.',
  hr_round: 'HR discussion: expectations, notice period, fit.',
  ceo: 'Optional final round with the CEO / management.',
  client: 'Optional client interview, arranged outside the app.',
  documents: 'Collect and verify the candidate’s documents.',
  offer: 'Prepare, approve and share the offer; record the candidate’s decision.',
});

const titleCase = (s) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const withKey = (key, extra = {}) => ({ key, ...CARD_STATUSES[key], ...extra });

/**
 * The chip on a board card. Derived only from fields listPipeline returns.
 * @returns {{ key: string, label: string, color: string, accent: string, meaning: string }}
 */
export function cardStatus(card) {
  if (card.final_outcome) return withKey('closed', { label: titleCase(card.final_outcome) });
  if (card.current_stage_status === 'rejected') return withKey('rejected');
  if (card.current_stage_status === 'hold') return withKey('onHold');
  if (card.current_stage_status === 'approved') return withKey('approved');
  if (card.ready_for_decision) return withKey('awaitingDecision');
  if (card.scheduled) return withKey('scheduled');
  if (card.invited) return withKey('zekoLinkSent');
  if (card.assessment_pending) {
    if (card.assessment_overdue) {
      return withKey('testOverdue', card.assessment_due_at
        ? { meaning: `${CARD_STATUSES.testOverdue.meaning} It was due ${fmtDate(card.assessment_due_at)}.` }
        : {});
    }
    if (card.assessment_invite_sent_at) {
      return withKey('testSent', card.assessment_due_at
        ? { label: `Test sent · due ${fmtDate(card.assessment_due_at)}` }
        : {});
    }
    return withKey('testNotSent');
  }
  if (ZEKO_STAGES.includes(card.current_stage_key)) return withKey('notInvited');
  if (SCHEDULABLE_STAGES.includes(card.current_stage_key)) return withKey('notScheduled');
  return withKey('awaitingAction');
}

/** Plain-words names for the 4-segment progress bar under each card. */
export const PROGRESS_STEP_LABELS = Object.freeze({
  invite: 'In stage',
  wait: 'Invited / booked',
  results: 'Results in',
  decision: 'Decision',
});
const PROGRESS_STATE_WORDS = { done: 'done', active: 'now', pending: 'not yet', rejected: 'rejected', hold: 'on hold' };

/** "In stage: done · Invited / booked: now · Results in: not yet · Decision: not yet" */
export function progressTooltip(segments) {
  return segments
    .map((s) => `${PROGRESS_STEP_LABELS[s.key] || s.key}: ${PROGRESS_STATE_WORDS[s.state] || s.state}`)
    .join(' · ');
}
