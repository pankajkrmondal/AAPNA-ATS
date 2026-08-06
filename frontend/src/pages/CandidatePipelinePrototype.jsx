/**
 * CandidatePipelinePrototype.jsx — Phase 3 Candidate Pipeline PROTOTYPE (v2).
 *
 * ⚠️ Walkthrough demo for the Recruitment Team only:
 *   - 100% mock data, kept in component state — no API calls, nothing saved.
 *   - No emails are sent; every "email sent" message is simulated.
 *   - Route: /candidate-pipeline-prototype — linked from the sidebar as
 *     "Candidate Pipeline" (the earlier "not in the sidebar menu on purpose"
 *     note is stale; it has had a sidebar entry since RT started reviewing it).
 *   - Delete this file + its route once Phase 3 Module 1 ships the real Tracker.
 *
 * v2 — RT feedback applied:
 *   1. Pipeline starts at "Shortlisted" (resume screening stays in Candidate Screening).
 *   2. Candidate drawer is per-round: click a round in the stepper to see only that
 *      round's details; future rounds are disabled; actions only on the current round.
 *   3. One analytics — shown as the "Pipeline" tab that merges into the existing
 *      Analytics page (no second analytics page).
 *   4. Evalground CSV import lives inside the IQ / Tech Assessment round (column
 *      action + round panel), mapping results by email to candidates in that round.
 *
 * v3 — RT answers of 2026-07-13 applied (see docs/phase3/04-QUESTIONS.md):
 *   - Reminders: candidate & interviewer 30 min before; feedback daily until
 *     submitted — NO escalation (Q7); overdue cards just stay flagged.
 *   - On Hold is manual-only — no review reminder, no auto-close (Q10).
 *   - Offer = record-only: HR shares the letter offline; ATS records it after an
 *     in-app recruiter approval with a daily nudge; no versioning (Q3/Q26).
 *   - Scorecard = Harish's "Interview Evaluation Format V2" (Q18): Skills 1–3 (+2
 *     optional) rated /5 in 0.5 steps + remarks, Communication, Attitude, Final
 *     rating + comments, recording link; HR Round keeps its own card.
 *   - Evalground: one file, matched by email, pass mark 50% both tests; duplicate
 *     attempts use the latest row (Q1/Q4).
 *   - Concurrent journeys: a candidate can run two matching MRFs — cards carry a
 *     "2 MRFs" badge (Q13).
 *   - Scheduling: interviewer-fixed AND candidate self-scheduling from published
 *     slots; interviewer resolves slot conflicts by editing slots (Q6/Q31).
 *   - Vendors: status-only notes, never offer letters or document mails (Q5).
 *
 * v5 — AI features (see docs/changelog/CHANGES-pipeline-prototype-v5-ai.md):
 *   - Stuck-candidate AI insight: a robot-icon one-liner under each "Blocked on"
 *     tag in the analytics tab's Stuck candidates table.
 *   - Natural-language board search: a text box that resolves to the existing
 *     Role/Source/Hold/Stuck filters via mocked keyword parsing, with a
 *     "Read as: …" line explaining what it matched.
 *   - Evalground import: dropped the rigid "Map columns" step — the importer
 *     now reads each row's raw text with AI regardless of column layout,
 *     mirroring the schema-free row-reading pattern in
 *     backend/src/services/hrUpload.service.js (~lines 1083–1100).
 *   - Schedule Interview: an AI interviewer prep brief is attached to the
 *     invite by default (toggleable).
 *   - Interviewer feedback: an AI feedback summary is shown next to the
 *     submitted scorecard — advisory only; RT still decides Approve/Hold/Reject.
 *
 * v6 — invite/outcome/decision + editable outcome emails
 *   (see docs/changelog/CHANGES-pipeline-prototype-v6-email-templates.md):
 *   - Approve/Hold/Reject opens a decision modal with a real, editable
 *     outcome email (Subject + Body) instead of a generic "email will be
 *     sent" notice. Hold drafts from the real "Application On Hold"
 *     template (id 18); Reject from "Rejection — Post Interview" (id 4) —
 *     both shown as a tag on the modal.
 *   - Flagged gap: no template exists yet for "approved / moving to next
 *     stage" — shows an editable draft tagged "Draft — no template yet".
 *   - Offer stage's "Close candidate record" now opens a confirm modal with
 *     the same editable-email pattern (also "Draft — no template yet").
 *
 * v7 — renamed to "Candidate Pipeline"
 *   (see docs/changelog/CHANGES-pipeline-prototype-v7-rename.md):
 *   - File PipelinePrototype.jsx → CandidatePipelinePrototype.jsx; component
 *     PipelinePrototype → CandidatePipelinePrototype; PipelineAnalyticsPreview
 *     → CandidatePipelineAnalyticsPreview.
 *   - Route /pipeline-prototype → /candidate-pipeline-prototype; sidebar
 *     label "Pipeline Tracker" → "Candidate Pipeline"; breadcrumb "Interview
 *     Pipeline Tracker (Preview)" → "Candidate Pipeline (Preview)"; Analytics
 *     tab "Pipeline (Preview)" → "Candidate Pipeline (Preview)".
 *
 * v8 — round lifecycle depth + no more redundant "Shortlisted" stage +
 *   visual refresh to match the rest of the app:
 *   - Removed the "Shortlisted" column — shortlisting already happens on
 *     the Candidate Screening page, so having a column here that implies
 *     it happens again was confusing. Candidates now enter the pipeline
 *     directly at "HR Screening (Zeko)"; the JD-match/date context that
 *     used to live in a "Shortlisted" round is now a persistent read-only
 *     line in the drawer header (`candidate.screening`), not a stage.
 *   - Every round — not just interviews — now models and demonstrates its
 *     full lifecycle: invite pending → invited → in progress (interview
 *     upcoming/happened, Zeko test started, or assessment taken) → ready
 *     for decision (feedback/score/result in, new "Ready for decision"
 *     chip, generalizes the old "Feedback ready"/"Result imported" chips)
 *     → approve/hold/reject. The `zeko` and `assessment` round renderers
 *     used to collapse "not started" and "in progress" into one generic
 *     message (`round.zeko`/`round.importedFrom` truthy/falsy only) — now
 *     branch on `round.status` (`pending`/`invited`/`in_progress`) with a
 *     "Send Zeko invite"/"Send assessment invite" action button for the
 *     pending case, same pattern as the interview round's "Schedule
 *     interview" button. Example candidates cover every state on every
 *     round (HR Screening, Assessment, Functional, Tech 1–3, HR, CEO,
 *     Client), including a genuine "On Hold" on an interview round
 *     (previously only Zeko HR had one).
 *   - Candidate cards redesigned — the old layout crammed 3–4 same-weight
 *     pill tags together. Now: an initials avatar, a left-border accent
 *     coloured by status, source folded into secondary text instead of its
 *     own pill, and the age indicator is quiet text unless it's actually a
 *     problem (>10 days → pulsing red tag) — one dominant tag per card.
 *   - Visual pass reusing the app's existing design system instead of
 *     plain boxes: the shared `KpiCard` (animated count-up, glow, hover
 *     lift) for the analytics tiles, `UploadCelebration`'s quiet check
 *     animation on a successful Approve, a staggered fade-in board, a
 *     colour-coded accent bar per stage type, and a hover-lift on
 *     candidate cards (`.cp-candidate-card`/`.cp-avatar` in theme/index.css).
 *
 * v9 — full-lifecycle coverage on every round (HR Screening → Offer) +
 *   4-category card redesign (see docs/changelog/CHANGES-pipeline-
 *   prototype-v9-full-coverage-and-card-redesign.md):
 *   - Two more real render-bugs fixed (same class as v8's zeko/assessment
 *     fix — a state silently rendering as a different, wrong state):
 *     interview rounds now distinguish "self-scheduling slots published,
 *     not yet picked" from "not scheduled at all" (`round.status ===
 *     'invited'` was previously falling through to the generic message);
 *     Documents now distinguishes "request not sent" from "sent, no
 *     uploads yet" (`round.requested`, new field) instead of showing an
 *     identical all-pending checklist either way; Offer now models
 *     `round.offer.approvalStatus` (`pending`/`approved`) so "not
 *     requested" / "awaiting recruiter sign-off" / "approved, not yet
 *     shared" / "shared, awaiting candidate decision" are each their own
 *     message with the matching action button ("Request internal
 *     approval" / "Record offer shared"), not a single all-or-nothing
 *     `round.offer` object.
 *   - Roster grown 33 → 52 candidates so every round — not just the
 *     interview rounds — demonstrates its full lifecycle: entry → schedule/
 *     invite → outcome (score/feedback/result) → decision. Documents and
 *     Offer, which had exactly one example each before this pass, now have
 *     5 each covering their real sub-states.
 *   - Card redesign: a compact 4-segment progress-stepper bar
 *     (`roundProgressSegments`, `.cp-progress-seg` in theme/index.css)
 *     added beneath the existing status chip — one segment per category
 *     (Entry/Schedule/Outcome/Decision), colour-filled by state, with a
 *     tooltip spelling out all 4 in text. Direction chosen after checking
 *     how established ATS/kanban tools handle this: real ATS pipeline
 *     cards (Lever) favour one minimal dominant status line; the
 *     "show N sub-states compactly" pattern is better precedented by
 *     general kanban tools (Trello's checklist badge, Linear's progress
 *     ring) — so the chip stays as the primary readable label and the
 *     stepper is the secondary at-a-glance signal, rather than another
 *     row of same-weight tags.
 *
 * v10 — candidate drawer redesign (see docs/changelog/CHANGES-pipeline-
 *   prototype-v10-drawer-redesign.md): the board card got the v8/v9
 *   treatment, but the drawer's round-detail panel was still a plain,
 *   cramped, cluttered box. Three fixes:
 *   - **4-category bar**: `roundProgressSegments` extended with a
 *     human-readable `detail` per segment (e.g. "Score 66/61", "On Hold —
 *     Weak communication"), rendered as a 4-tile grid (`.cp-category-bar`)
 *     at the top of every round panel — the same Entry/Schedule/Outcome/
 *     Decision structure as the card, spelled out for the round the drawer
 *     is currently showing (which may be a past round, not the candidate's
 *     current one — the function now takes an explicit `stageKey`).
 *   - **Visual polish**: the round panel is now `.cp-round-panel` (real
 *     shadow, radius, fade-in) with the same stage-type accent bar the
 *     board column uses, instead of a flat default-styled `Card`.
 *   - **Stepper replaced**: the 11-item antd `<Steps>` (small numbered
 *     circles + abbreviated labels) read as cramped — swapped for a
 *     horizontal row of `.cp-stage-pill` buttons (done/current/future
 *     states, current pill uses the brand gradient).
 *   - Building the 4-category bar surfaced a **real pre-existing data
 *     bug**: 14 candidates' HR-round outcome (and one Documents outcome)
 *     was recorded with no underlying schedule/feedback (or checklist)
 *     ever set, so their category bar showed "Decision: done" while
 *     "Schedule"/"Outcome" still read "not started" — fixed at the data
 *     level (added the missing `schedule`/`feedback` — matching every
 *     other interview round's shape — not a logic band-aid). Verified with
 *     a Node harness checking segment-state monotonicity across all 245
 *     round-instances (current + historical) for all 52 candidates.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert, App as AntApp, Badge, Button, Card, Checkbox, Col, DatePicker,
  Drawer, Empty, Input, Modal, Radio, Rate, Row, Select, Space, Statistic,
  Steps, Table, Tag, Timeline, Tooltip, Typography,
} from 'antd';
import {
  CalendarOutlined, CheckCircleOutlined, CheckOutlined, ClockCircleOutlined,
  CloseOutlined, FileTextOutlined, ImportOutlined, MailOutlined,
  PauseCircleOutlined, RobotOutlined, SearchOutlined, TeamOutlined,
  UserOutlined, WarningOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import KpiCard from '../components/common/KpiCard';
import UploadCelebration from '../components/common/UploadCelebration';

const { Text, Title, Paragraph } = Typography;

/* ------------------------------------------------------------------ config */

const STAGES = [
  { key: 'zeko_hr', name: 'HR Screening (Zeko)', short: 'Zeko HR', type: 'zeko' },
  { key: 'assessment', name: 'IQ / Tech Assessment', short: 'Assessment', type: 'assessment' },
  { key: 'zeko_fn', name: 'Functional (Zeko)', short: 'Zeko Fn', type: 'zeko' },
  { key: 'tech1', name: 'Tech Round 1', short: 'Tech 1', type: 'interview' },
  { key: 'tech2', name: 'Tech Round 2', short: 'Tech 2', type: 'interview' },
  { key: 'tech3', name: 'Tech Round 3', short: 'Tech 3', type: 'interview', optional: true },
  { key: 'hr', name: 'HR Round', short: 'HR', type: 'interview' },
  { key: 'ceo', name: 'CEO / Final', short: 'CEO', type: 'interview' },
  { key: 'client', name: 'Client Interview', short: 'Client', type: 'interview', optional: true },
  { key: 'docs', name: 'Documents', short: 'Docs', type: 'docs' },
  { key: 'offer', name: 'Offer', short: 'Offer', type: 'offer' },
];
const stageIdx = (key) => STAGES.findIndex((s) => s.key === key);

/** Column accent colour by stage type — a quick visual read of what kind of
 * round you're looking at, reusing hues already used elsewhere in the app
 * (AdminDashboard's module colours) rather than inventing a new palette. */
const STAGE_ACCENT = {
  zeko: 'linear-gradient(90deg, #2f54eb, #5b7ff0)',
  assessment: 'linear-gradient(90deg, #13c2c2, #36d6d6)',
  interview: 'linear-gradient(90deg, #7a922e, #92a63c)',
  docs: 'linear-gradient(90deg, #eb2f96, #f062b4)',
  offer: 'linear-gradient(90deg, #4a7c59, #6ba57d)',
};

const REASONS = {
  rejected: [
    'Skills mismatch', 'High salary expectation', 'High notice period',
    'Weak communication', 'Frequent job changes', 'Failed assessment threshold',
    'Unresponsive / no-show', 'Client rejected profile', 'Other reasons (free text below)',
  ],
  hold: [
    'Better-fit role expected soon', 'Budget confirmation pending', 'Position on hold',
    'Awaiting comparison with other candidates', 'Candidate asked for time', 'Other reasons (free text below)',
  ],
};

const CHIP = {
  // Round entered, nothing sent yet — needs recruiter/system action.
  pending: { label: 'Invite pending', color: 'default' },
  review: { label: 'In review', color: 'default' },
  invited: { label: 'Invited', color: 'blue' },
  scheduled: { label: 'Scheduled', color: 'blue' },
  // Invite/schedule sent and the candidate side is in motion — interview
  // meeting upcoming or just happened, Zeko test started, Evalground test
  // taken but not yet imported. One label covers all of those.
  await: { label: 'In progress', color: 'gold' },
  // Scores/results are in (interview feedback, Zeko score, Evalground
  // import) but no outcome recorded yet — same "needs your decision" signal
  // regardless of round type, so this one chip covers all of them.
  feedback: { label: 'Ready for decision', color: 'green' },
  hold: { label: 'On Hold', color: 'gold' },
  docs: { label: 'Uploading docs', color: 'blue' },
  offer_sent: { label: 'Offer shared', color: 'blue' },
};

const OUTCOME_TAG = {
  approved: { label: 'Approved', color: 'green' },
  hold: { label: 'On Hold', color: 'gold' },
  in_progress: { label: 'In progress', color: 'processing' },
};

/* ------------------------------------------------------------------- data
 * Each candidate carries per-round detail in `rounds[stageKey]` — the drawer
 * shows exactly one round at a time (RT feedback #2). Only traversed rounds
 * have entries; the current round may be partially filled. `screening` is
 * NOT a round — it's read-only context from Candidate Screening (JD match,
 * date, who shortlisted them), shown persistently in the drawer header
 * rather than as a pipeline stage (v8 — see header comment).
 *
 * Deliberately covers, for every interview round (tech1/tech2/tech3/hr/ceo/
 * client): a "just entered, not scheduled" example, a "scheduled/awaiting
 * feedback" example, and a "feedback submitted, awaiting your decision"
 * example — plus one genuine On Hold example on an interview round.
 */
const INITIAL_CANDIDATES = [
  {
    id: 1, name: 'Arjun Mehta', role: 'Senior .NET Developer', src: 'HR', stage: 'tech1',
    chip: 'scheduled', age: 3, email: 'arjun.mehta@gmail.com',
    screening: { jdMatch: 84, when: '02 Jul', by: 'Priya' },
    rounds: {
      zeko_hr: { outcome: 'approved', when: '05 Jul', by: 'Anita', zeko: { interview: 82, communication: 78 }, emails: ['Zeko invite — opened', 'Outcome email — delivered'] },
      assessment: { outcome: 'approved', when: '08 Jul', by: 'Priya', iq: 78, tech: 74, testDate: '07 Jul', importedFrom: 'Evalground_Results_08Jul2026.csv', emails: ['Assessment invite — opened', 'Outcome email — delivered'] },
      zeko_fn: { outcome: 'approved', when: '09 Jul', by: 'Anita', zeko: { interview: 80, communication: 77 }, emails: ['Outcome email — delivered'] },
      tech1: { status: 'scheduled', schedule: { when: '13 Jul, 11:00', who: 'Suresh Menon', mode: 'Teams' }, emails: ['Outlook invite (Teams) — candidate opened'] },
    },
  },
  {
    id: 2, name: 'Kavya Nair', role: 'Senior .NET Developer', src: 'Vendor', vendor: 'TechBridge Solutions',
    stage: 'tech2', chip: 'await', age: 2, email: 'kavya.nair@outlook.com',
    screening: { jdMatch: 88, when: '28 Jun', by: 'Priya' },
    rounds: {
      zeko_hr: { outcome: 'approved', when: '30 Jun', by: 'Anita', zeko: { interview: 88, communication: 85 }, emails: ['Outcome email → candidate + vendor'] },
      assessment: { outcome: 'approved', when: '01 Jul', by: 'Priya', iq: 84, tech: 86, testDate: '30 Jun', importedFrom: 'Evalground_Results_01Jul2026.csv', emails: ['Outcome email → candidate + vendor'] },
      zeko_fn: { outcome: 'approved', when: '01 Jul', by: 'Anita', zeko: { interview: 86, communication: 84 }, emails: ['Outcome email → candidate + vendor'] },
      tech1: { outcome: 'approved', when: '02 Jul', by: 'Anita', schedule: { when: '01 Jul, 11:00', who: 'Suresh Menon', mode: 'Teams' }, feedback: { by: 'Suresh Menon', rec: 'Approve', avg: 4.3, note: 'Solid fundamentals, clean SQL.' }, emails: ['Outcome email → candidate + vendor'] },
      tech2: { status: 'await', schedule: { when: '07 Jul, 15:00', who: 'Deepa Rao', mode: 'Teams' }, remindersSent: 2, emails: ['Outlook invite (Teams) — both accepted', 'Feedback reminder #1, #2 → Deepa Rao'] },
    },
  },
  {
    id: 3, name: 'Ravi Shankar', role: 'QA Engineer', src: 'HR', stage: 'tech1', chip: 'await', age: 12,
    email: 'ravi.shankar@gmail.com',
    screening: { jdMatch: 74, when: '20 Jun', by: 'Priya' },
    rounds: {
      zeko_hr: { outcome: 'approved', when: '23 Jun', by: 'Anita', zeko: { interview: 74, communication: 70 }, emails: ['Outcome email — delivered'] },
      assessment: { outcome: 'approved', when: '25 Jun', by: 'Priya', iq: 71, tech: 69, testDate: '24 Jun', importedFrom: 'Evalground_Results_24Jun2026.csv', emails: ['Outcome email — delivered'] },
      zeko_fn: { outcome: 'approved', when: '26 Jun', by: 'Anita', zeko: { interview: 72, communication: 71 }, emails: ['Outcome email — delivered'] },
      tech1: { status: 'await', schedule: { when: '27 Jun, 14:00', who: 'Suresh Menon', mode: 'Teams' }, remindersSent: 5, emails: ['Feedback reminders #1–#5 (one per day) → Suresh Menon', 'Card flagged "awaiting feedback 12 days" — no escalation (Q7)'] },
    },
  },
  {
    id: 4, name: 'Meena Iyer', role: 'Business Analyst', src: 'Email', stage: 'assessment', chip: 'review', age: 11,
    email: 'meena.iyer@yahoo.in',
    screening: { jdMatch: 79, when: '24 Jun', by: 'Anita' },
    rounds: {
      zeko_hr: { outcome: 'approved', when: '26 Jun', by: 'Priya', zeko: { interview: 79, communication: 82 }, emails: ['Outcome email — delivered'] },
      assessment: { status: 'review', testDate: '30 Jun', note: 'Test attempted — result awaited in next CSV import', emails: ['Assessment invite (GA + Technical) — opened'] },
    },
  },
  {
    id: 5, name: 'Farhan Ali', role: 'React Developer', src: 'Vendor', vendor: 'Talent Hive', stage: 'zeko_hr',
    chip: 'hold', age: 34, email: 'farhan.ali@gmail.com',
    screening: { jdMatch: 70, when: '01 Jun', by: 'Priya' },
    rounds: {
      zeko_hr: { outcome: 'hold', reason: 'Weak communication', when: '05 Jun', by: 'Anita', zeko: { interview: 66, communication: 61 }, note: 'On Hold 34 days — manual review only (no auto-reminder/auto-close, Q10); aging badge keeps it visible', emails: ['On-hold email → candidate + vendor (status-only)'] },
    },
  },
  {
    id: 6, name: 'Sanya Kapoor', role: 'Power BI Developer', src: 'HR', stage: 'hr', chip: 'scheduled', age: 1,
    email: 'sanya.kapoor@gmail.com',
    screening: { jdMatch: 85, when: '25 Jun', by: 'Priya' },
    rounds: {
      zeko_hr: { outcome: 'approved', when: '26 Jun', by: 'Anita', zeko: { interview: 85, communication: 88 }, emails: ['Outcome email — delivered'] },
      assessment: { outcome: 'approved', when: '27 Jun', by: 'Priya', iq: 81, tech: 83, testDate: '26 Jun', importedFrom: 'Evalground_Results_24Jun2026.csv', emails: ['Outcome email — delivered'] },
      zeko_fn: { outcome: 'approved', when: '27 Jun', by: 'Anita', zeko: { interview: 84, communication: 86 }, emails: ['Outcome email — delivered'] },
      tech1: { outcome: 'approved', when: '29 Jun', by: 'Priya', schedule: { when: '28 Jun, 10:00', who: 'Suresh Menon', mode: 'Teams' }, feedback: { by: 'Suresh Menon', rec: 'Approve', avg: 4.1, note: 'Strong SQL + modelling.' }, emails: ['Outcome email — delivered'] },
      tech2: { outcome: 'approved', when: '04 Jul', by: 'Priya', schedule: { when: '03 Jul, 15:00', who: 'Vikram Joshi', mode: 'Teams' }, feedback: { by: 'Vikram Joshi', rec: 'Approve', avg: 4.5, note: 'Great DAX depth; clear stakeholder communication.' }, emails: ['Outcome email — delivered'] },
      hr: { status: 'scheduled', schedule: { when: '11 Jul, 10:00', who: 'Nisha (RT)', mode: 'Teams' }, emails: ['Outlook invite (Teams) — candidate opened'] },
    },
  },
  {
    id: 7, name: 'Dev Patel', role: 'Senior .NET Developer', src: 'Vendor', vendor: 'TechBridge Solutions',
    stage: 'docs', chip: 'docs', age: 4, email: 'dev.patel@outlook.com',
    screening: { jdMatch: 90, when: '15 Jun', by: 'Priya' },
    rounds: {
      zeko_hr: { outcome: 'approved', when: '17 Jun', by: 'Anita', zeko: { interview: 90, communication: 86 }, emails: ['Outcome email → candidate + vendor'] },
      assessment: { outcome: 'approved', when: '19 Jun', by: 'Priya', iq: 88, tech: 91, testDate: '18 Jun', importedFrom: 'Evalground_Results_24Jun2026.csv', emails: ['Outcome email → candidate + vendor'] },
      zeko_fn: { outcome: 'approved', when: '20 Jun', by: 'Anita', zeko: { interview: 89, communication: 87 }, emails: ['Outcome email → candidate + vendor'] },
      tech1: { outcome: 'approved', when: '23 Jun', by: 'Priya', schedule: { when: '22 Jun, 11:00', who: 'Suresh Menon', mode: 'Teams' }, feedback: { by: 'Suresh Menon', rec: 'Approve', avg: 4.6, note: 'Excellent depth.' }, emails: ['Outcome email → candidate + vendor'] },
      tech2: { outcome: 'approved', when: '26 Jun', by: 'Anita', schedule: { when: '25 Jun, 14:00', who: 'Deepa Rao', mode: 'Teams' }, feedback: { by: 'Deepa Rao', rec: 'Approve', avg: 4.7, note: 'Best candidate this quarter.' }, emails: ['Outcome email → candidate + vendor'] },
      hr: { outcome: 'approved', when: '29 Jun', by: 'Nisha (RT)', schedule: { when: '28 Jun, 10:00', who: 'Nisha (RT)', mode: 'Teams' }, feedback: { by: 'Nisha (RT)', rec: 'Approve', avg: 4.4, note: 'Great communication, aligned on expectations.' }, note: 'CTC within band; 30-day notice; WFH 2 days OK', emails: ['Outcome email → candidate + vendor'] },
      ceo: { outcome: 'approved', when: '01 Jul', by: 'Priya', schedule: { when: '30 Jun, 16:00', who: 'CEO', mode: 'Teams' }, feedback: { by: 'CEO', rec: 'Approve', avg: 4.5, note: 'Go ahead.' }, emails: ['Outcome email → candidate + vendor'] },
      docs: {
        status: 'docs', requested: true,
        checklist: [
          { name: 'Govt ID (Aadhaar/PAN)', status: 'uploaded' },
          { name: 'Education certificates', status: 'verified' },
          { name: 'Experience / relieving letters', status: 'verified' },
          { name: 'Last 3 payslips', status: 'rejected' },
        ],
        emails: ['Document request → candidate only (vendor not copied — PII, Q5)', 'Payslip re-request — June payslip missing'],
      },
    },
  },
  {
    id: 8, name: 'Ishita Bose', role: 'Business Analyst', src: 'HR', stage: 'offer', chip: 'offer_sent', age: 2,
    email: 'ishita.bose@gmail.com',
    screening: { jdMatch: 87, when: '10 Jun', by: 'Priya' },
    rounds: {
      zeko_hr: { outcome: 'approved', when: '12 Jun', by: 'Anita', zeko: { interview: 87, communication: 90 }, emails: ['Outcome email — delivered'] },
      assessment: { outcome: 'approved', when: '14 Jun', by: 'Priya', iq: 83, tech: 80, testDate: '13 Jun', importedFrom: 'Evalground_Results_24Jun2026.csv', emails: ['Outcome email — delivered'] },
      zeko_fn: { outcome: 'approved', when: '16 Jun', by: 'Anita', zeko: { interview: 85, communication: 89 }, emails: ['Outcome email — delivered'] },
      tech1: { outcome: 'approved', when: '20 Jun', by: 'Priya', schedule: { when: '19 Jun, 11:00', who: 'Vikram Joshi', mode: 'Teams' }, feedback: { by: 'Vikram Joshi', rec: 'Approve', avg: 4.2, note: 'Strong requirements elicitation.' }, emails: ['Outcome email — delivered'] },
      tech2: { outcome: 'approved', when: '25 Jun', by: 'Anita', schedule: { when: '24 Jun, 15:00', who: 'Deepa Rao', mode: 'Teams' }, feedback: { by: 'Deepa Rao', rec: 'Approve', avg: 4.4, note: 'Excellent case handling.' }, emails: ['Outcome email — delivered'] },
      hr: { outcome: 'approved', when: '01 Jul', by: 'Nisha (RT)', schedule: { when: '30 Jun, 10:00', who: 'Nisha (RT)', mode: 'Teams' }, feedback: { by: 'Nisha (RT)', rec: 'Approve', avg: 4.2, note: 'Clear on role expectations, good culture fit.' }, emails: ['Outcome email — delivered'] },
      docs: { outcome: 'approved', when: '05 Jul', by: 'Anita', note: 'All documents verified', requested: true, checklist: [{ name: 'Govt ID (Aadhaar/PAN)', status: 'verified' }, { name: 'Education certificates', status: 'verified' }, { name: 'Experience / relieving letters', status: 'verified' }, { name: 'Last 3 payslips', status: 'verified' }], emails: ['Document request — completed'] },
      offer: { status: 'offer_sent', offer: { approvalStatus: 'approved', file: 'Offer_IshitaBose_BA.pdf', shared: '07 Jul 2026', join: '04 Aug 2026', decision: 'Awaiting decision', approval: 'Approved in-app by Priya (recruiter) · 06 Jul' }, emails: ['Approval nudge (daily) → Priya — approved 06 Jul', 'Offer shared offline by HR — recorded in ATS 07 Jul'] },
    },
  },
  {
    id: 9, name: 'Rohit Kulkarni', role: 'QA Engineer', src: 'Email', stage: 'zeko_hr', chip: 'invited', age: 0,
    email: 'rohit.k@gmail.com',
    screening: { jdMatch: 72, when: '19 Jul' },
    rounds: { zeko_hr: { status: 'invited', zekoWindow: { start: '2026-07-22T10:00:00', end: '2026-07-22T12:00:00' }, emails: ['Zeko HR screening invite → candidate · self-schedule window 22 Jul, 10:00–12:00'] } },
  },
  {
    id: 10, name: 'Ananya Singh', role: 'React Developer', src: 'HR', stage: 'zeko_hr', chip: 'invited', age: 0,
    email: 'ananya.s@gmail.com', also: 'UI Developer (MRF-2044)',
    screening: { jdMatch: 81, when: '18 Jul', note: 'Also running a second journey for UI Developer (MRF-2044) — concurrent MRFs allowed (Q13); a rejection there would not stop this journey.' },
    rounds: { zeko_hr: { status: 'invited', zekoWindow: { start: '2026-07-23T14:00:00', end: '2026-07-23T16:00:00' }, emails: ['Zeko HR screening invite → candidate · self-schedule window 23 Jul, 14:00–16:00'] } },
  },
  {
    id: 11, name: 'Vishal Gupta', role: 'Senior .NET Developer', src: 'Vendor', vendor: 'Talent Hive',
    stage: 'zeko_fn', chip: 'invited', age: 5, email: 'vishal.g@outlook.com',
    screening: { jdMatch: 76, when: '27 Jun', by: 'Priya' },
    rounds: {
      zeko_hr: { outcome: 'approved', when: '30 Jun', by: 'Anita', zeko: { interview: 76, communication: 74 }, emails: ['Outcome email → candidate + vendor'] },
      assessment: { outcome: 'approved', when: '03 Jul', by: 'Priya', iq: 80, tech: 78, testDate: '02 Jul', importedFrom: 'Evalground_Results_01Jul2026.csv', emails: ['Outcome email → candidate + vendor'] },
      zeko_fn: { status: 'invited', zekoWindow: { start: '2026-07-05T15:00:00', end: '2026-07-05T17:00:00' }, emails: ['Zeko functional screening invite → candidate + vendor · self-schedule window 05 Jul, 15:00–17:00'] },
    },
  },
  {
    id: 12, name: 'Priyanka Das', role: 'Power BI Developer', src: 'HR', stage: 'ceo', chip: 'scheduled', age: 2,
    email: 'priyanka.das@gmail.com',
    screening: { jdMatch: 84, when: '18 Jun', by: 'Priya' },
    rounds: {
      zeko_hr: { outcome: 'approved', when: '20 Jun', by: 'Anita', zeko: { interview: 84, communication: 82 }, emails: ['Outcome email — delivered'] },
      assessment: { outcome: 'approved', when: '23 Jun', by: 'Priya', iq: 79, tech: 82, testDate: '22 Jun', importedFrom: 'Evalground_Results_24Jun2026.csv', emails: ['Outcome email — delivered'] },
      zeko_fn: { outcome: 'approved', when: '24 Jun', by: 'Anita', zeko: { interview: 83, communication: 81 }, emails: ['Outcome email — delivered'] },
      tech1: { outcome: 'approved', when: '27 Jun', by: 'Priya', schedule: { when: '26 Jun, 10:00', who: 'Vikram Joshi', mode: 'Teams' }, feedback: { by: 'Vikram Joshi', rec: 'Approve', avg: 4.0, note: 'Good.' }, emails: ['Outcome email — delivered'] },
      tech2: { outcome: 'approved', when: '02 Jul', by: 'Anita', schedule: { when: '01 Jul, 15:00', who: 'Deepa Rao', mode: 'Teams' }, feedback: { by: 'Deepa Rao', rec: 'Approve', avg: 4.2, note: 'Ready for final.' }, emails: ['Outcome email — delivered'] },
      hr: { outcome: 'approved', when: '06 Jul', by: 'Nisha (RT)', schedule: { when: '05 Jul, 10:00', who: 'Nisha (RT)', mode: 'Teams' }, feedback: { by: 'Nisha (RT)', rec: 'Approve', avg: 4.1, note: 'Notice period and CTC both within band.' }, emails: ['Outcome email — delivered'] },
      ceo: { status: 'scheduled', schedule: { when: '12 Jul, 16:00', who: 'CEO', mode: 'Teams' }, emails: ['Outlook invite (Teams) — sent today'] },
    },
  },
  {
    id: 13, name: 'Karthik Reddy', role: 'Business Analyst', src: 'HR', stage: 'client', chip: 'scheduled', age: 6,
    email: 'karthik.r@gmail.com',
    screening: { jdMatch: 80, when: '12 Jun', by: 'Priya' },
    rounds: {
      zeko_hr: { outcome: 'approved', when: '15 Jun', by: 'Anita', zeko: { interview: 80, communication: 84 }, emails: ['Outcome email — delivered'] },
      assessment: { outcome: 'approved', when: '18 Jun', by: 'Priya', iq: 77, tech: 75, testDate: '17 Jun', importedFrom: 'Evalground_Results_24Jun2026.csv', emails: ['Outcome email — delivered'] },
      zeko_fn: { outcome: 'approved', when: '20 Jun', by: 'Anita', zeko: { interview: 81, communication: 83 }, emails: ['Outcome email — delivered'] },
      tech1: { outcome: 'approved', when: '24 Jun', by: 'Priya', schedule: { when: '23 Jun, 11:00', who: 'Suresh Menon', mode: 'Teams' }, feedback: { by: 'Suresh Menon', rec: 'Approve', avg: 4.1, note: 'Good BA depth.' }, emails: ['Outcome email — delivered'] },
      tech2: { outcome: 'approved', when: '30 Jun', by: 'Anita', schedule: { when: '29 Jun, 15:00', who: 'Deepa Rao', mode: 'Teams' }, feedback: { by: 'Deepa Rao', rec: 'Approve', avg: 4.0, note: 'Fine.' }, emails: ['Outcome email — delivered'] },
      client: { status: 'scheduled', schedule: { when: '14 Jul, 17:30', who: 'R. Fernandes — Northwind Corp', mode: 'Client call' }, note: 'Client contact added at MRF; custom client-interview template used', emails: ['Client interview email (custom template) — sent'] },
    },
  },
  {
    id: 14, name: 'Neha Sharma', role: 'QA Engineer', src: 'HR', stage: 'assessment', chip: 'feedback', age: 3,
    email: 'neha.sharma@gmail.com',
    screening: { jdMatch: 77, when: '02 Jul', by: 'Anita' },
    rounds: {
      zeko_hr: { outcome: 'approved', when: '05 Jul', by: 'Priya', zeko: { interview: 77, communication: 75 }, emails: ['Outcome email — delivered'] },
      assessment: { status: 'imported', iq: 46, tech: 70, testDate: '07 Jul', importedFrom: 'Evalground_Results_08Jul2026.csv', note: 'IQ 46% — below the 50% pass mark (Q4); auto-suggests Failed, RT decides', emails: ['Assessment invite — opened'] },
    },
  },
  {
    id: 15, name: 'Meera Krishnan', role: 'Senior .NET Developer', src: 'HR', stage: 'tech1', chip: 'review', age: 0,
    email: 'meera.krishnan@gmail.com',
    screening: { jdMatch: 82, when: '10 Jul', by: 'Priya' },
    rounds: {
      zeko_hr: { outcome: 'approved', when: '12 Jul', by: 'Anita', zeko: { interview: 83, communication: 79 }, emails: ['Outcome email — delivered'] },
      assessment: { outcome: 'approved', when: '14 Jul', by: 'Priya', iq: 81, tech: 79, testDate: '13 Jul', importedFrom: 'Evalground_Results_14Jul2026.csv', emails: ['Outcome email — delivered'] },
      zeko_fn: { outcome: 'approved', when: '15 Jul', by: 'Anita', zeko: { interview: 82, communication: 80 }, emails: ['Outcome email — delivered'] },
      tech1: { status: 'review' },
    },
  },
  {
    id: 16, name: 'Aditya Verma', role: 'Senior .NET Developer', src: 'Vendor', vendor: 'TechBridge Solutions',
    stage: 'tech1', chip: 'feedback', age: 1, email: 'aditya.verma@outlook.com',
    screening: { jdMatch: 89, when: '05 Jul', by: 'Anita' },
    rounds: {
      zeko_hr: { outcome: 'approved', when: '07 Jul', by: 'Priya', zeko: { interview: 88, communication: 85 }, emails: ['Outcome email → candidate + vendor'] },
      assessment: { outcome: 'approved', when: '09 Jul', by: 'Anita', iq: 85, tech: 87, testDate: '08 Jul', importedFrom: 'Evalground_Results_08Jul2026.csv', emails: ['Outcome email → candidate + vendor'] },
      zeko_fn: { outcome: 'approved', when: '10 Jul', by: 'Priya', zeko: { interview: 86, communication: 84 }, emails: ['Outcome email → candidate + vendor'] },
      tech1: { schedule: { when: '19 Jul, 10:00', who: 'Suresh Menon', mode: 'Teams' }, feedback: { by: 'Suresh Menon', rec: 'Approve', avg: 4.4, note: 'Very strong on distributed systems design.' }, emails: ['Outlook invite (Teams) — candidate opened', 'Feedback submitted via tokenized link'] },
    },
  },
  {
    id: 17, name: 'Divya Menon', role: 'QA Engineer', src: 'Email', stage: 'tech2', chip: 'review', age: 0,
    email: 'divya.menon@yahoo.in',
    screening: { jdMatch: 75, when: '09 Jul', by: 'Anita' },
    rounds: {
      zeko_hr: { outcome: 'approved', when: '11 Jul', by: 'Priya', zeko: { interview: 76, communication: 73 }, emails: ['Outcome email — delivered'] },
      assessment: { outcome: 'approved', when: '13 Jul', by: 'Anita', iq: 73, tech: 71, testDate: '12 Jul', importedFrom: 'Evalground_Results_14Jul2026.csv', emails: ['Outcome email — delivered'] },
      zeko_fn: { outcome: 'approved', when: '14 Jul', by: 'Priya', zeko: { interview: 75, communication: 74 }, emails: ['Outcome email — delivered'] },
      tech1: { outcome: 'approved', when: '16 Jul', by: 'Anita', schedule: { when: '15 Jul, 11:00', who: 'Suresh Menon', mode: 'Teams' }, feedback: { by: 'Suresh Menon', rec: 'Approve', avg: 3.9, note: 'Solid manual + automation basics.' }, emails: ['Outcome email — delivered'] },
      tech2: { status: 'review' },
    },
  },
  {
    id: 18, name: 'Rahul Bhatt', role: 'Business Analyst', src: 'HR', stage: 'tech2', chip: 'feedback', age: 2,
    email: 'rahul.bhatt@gmail.com',
    screening: { jdMatch: 83, when: '02 Jul', by: 'Priya' },
    rounds: {
      zeko_hr: { outcome: 'approved', when: '04 Jul', by: 'Anita', zeko: { interview: 82, communication: 85 }, emails: ['Outcome email — delivered'] },
      assessment: { outcome: 'approved', when: '06 Jul', by: 'Priya', iq: 80, tech: 77, testDate: '05 Jul', importedFrom: 'Evalground_Results_08Jul2026.csv', emails: ['Outcome email — delivered'] },
      zeko_fn: { outcome: 'approved', when: '07 Jul', by: 'Anita', zeko: { interview: 81, communication: 83 }, emails: ['Outcome email — delivered'] },
      tech1: { outcome: 'approved', when: '10 Jul', by: 'Priya', schedule: { when: '09 Jul, 15:00', who: 'Vikram Joshi', mode: 'Teams' }, feedback: { by: 'Vikram Joshi', rec: 'Approve', avg: 4.1, note: 'Good stakeholder analysis skills.' }, emails: ['Outcome email — delivered'] },
      tech2: { schedule: { when: '17 Jul, 15:00', who: 'Deepa Rao', mode: 'Teams' }, feedback: { by: 'Deepa Rao', rec: 'Approve', avg: 4.3, note: 'Excellent case study walkthrough.' }, emails: ['Outlook invite (Teams) — both accepted', 'Feedback submitted via tokenized link'] },
    },
  },
  {
    id: 19, name: 'Farah Sheikh', role: 'Power BI Developer', src: 'Vendor', vendor: 'Talent Hive',
    stage: 'tech2', chip: 'hold', age: 9, email: 'farah.sheikh@outlook.com',
    screening: { jdMatch: 78, when: '20 Jun', by: 'Anita' },
    rounds: {
      zeko_hr: { outcome: 'approved', when: '22 Jun', by: 'Priya', zeko: { interview: 79, communication: 76 }, emails: ['Outcome email → candidate + vendor'] },
      assessment: { outcome: 'approved', when: '24 Jun', by: 'Anita', iq: 76, tech: 74, testDate: '23 Jun', importedFrom: 'Evalground_Results_24Jun2026.csv', emails: ['Outcome email → candidate + vendor'] },
      zeko_fn: { outcome: 'approved', when: '25 Jun', by: 'Priya', zeko: { interview: 78, communication: 77 }, emails: ['Outcome email → candidate + vendor'] },
      tech1: { outcome: 'approved', when: '28 Jun', by: 'Anita', schedule: { when: '27 Jun, 11:00', who: 'Suresh Menon', mode: 'Teams' }, feedback: { by: 'Suresh Menon', rec: 'Hold', avg: 3.4, note: 'Decent SQL, DAX needs more depth.' }, emails: ['Outcome email → candidate + vendor'] },
      tech2: { outcome: 'hold', reason: 'Awaiting comparison with other candidates', when: '12 Jul', by: 'Priya', schedule: { when: '11 Jul, 15:00', who: 'Deepa Rao', mode: 'Teams' }, feedback: { by: 'Deepa Rao', rec: 'Hold', avg: 3.3, note: 'Good fundamentals but the panel wants to see one more candidate before deciding.' }, note: 'On Hold 9 days — manual review only (no auto-close, Q10)', emails: ['On-hold email → candidate + vendor (status-only)'] },
    },
  },
  {
    id: 20, name: 'Sameer Joshi', role: 'Senior .NET Developer', src: 'HR', stage: 'tech3', chip: 'review', age: 0,
    email: 'sameer.joshi@gmail.com',
    screening: { jdMatch: 91, when: '01 Jul', by: 'Priya' },
    rounds: {
      zeko_hr: { outcome: 'approved', when: '03 Jul', by: 'Anita', zeko: { interview: 90, communication: 86 }, emails: ['Outcome email — delivered'] },
      assessment: { outcome: 'approved', when: '05 Jul', by: 'Priya', iq: 89, tech: 92, testDate: '04 Jul', importedFrom: 'Evalground_Results_08Jul2026.csv', emails: ['Outcome email — delivered'] },
      zeko_fn: { outcome: 'approved', when: '06 Jul', by: 'Anita', zeko: { interview: 91, communication: 87 }, emails: ['Outcome email — delivered'] },
      tech1: { outcome: 'approved', when: '09 Jul', by: 'Priya', schedule: { when: '08 Jul, 11:00', who: 'Suresh Menon', mode: 'Teams' }, feedback: { by: 'Suresh Menon', rec: 'Approve', avg: 4.7, note: 'Exceptional architecture instincts.' }, emails: ['Outcome email — delivered'] },
      tech2: { outcome: 'approved', when: '14 Jul', by: 'Anita', schedule: { when: '13 Jul, 15:00', who: 'Deepa Rao', mode: 'Teams' }, feedback: { by: 'Deepa Rao', rec: 'Approve', avg: 4.6, note: 'Top-tier candidate — flagged for an extra round given the seniority of the role.' }, emails: ['Outcome email — delivered'] },
      tech3: { status: 'review', note: 'Optional third technical round — client asked for an extra architecture-focused round for senior candidates' },
    },
  },
  {
    id: 21, name: 'Pooja Nair', role: 'Power BI Developer', src: 'Email', stage: 'hr', chip: 'review', age: 0,
    email: 'pooja.nair@yahoo.in',
    screening: { jdMatch: 80, when: '06 Jul', by: 'Anita' },
    rounds: {
      zeko_hr: { outcome: 'approved', when: '08 Jul', by: 'Priya', zeko: { interview: 81, communication: 83 }, emails: ['Outcome email — delivered'] },
      assessment: { outcome: 'approved', when: '10 Jul', by: 'Anita', iq: 78, tech: 80, testDate: '09 Jul', importedFrom: 'Evalground_Results_14Jul2026.csv', emails: ['Outcome email — delivered'] },
      zeko_fn: { outcome: 'approved', when: '11 Jul', by: 'Priya', zeko: { interview: 80, communication: 82 }, emails: ['Outcome email — delivered'] },
      tech1: { outcome: 'approved', when: '14 Jul', by: 'Anita', schedule: { when: '13 Jul, 11:00', who: 'Suresh Menon', mode: 'Teams' }, feedback: { by: 'Suresh Menon', rec: 'Approve', avg: 4.0, note: 'Good DAX + data modelling.' }, emails: ['Outcome email — delivered'] },
      tech2: { outcome: 'approved', when: '18 Jul', by: 'Priya', schedule: { when: '17 Jul, 15:00', who: 'Vikram Joshi', mode: 'Teams' }, feedback: { by: 'Vikram Joshi', rec: 'Approve', avg: 4.2, note: 'Ready for HR round.' }, emails: ['Outcome email — delivered'] },
      hr: { status: 'review' },
    },
  },
  {
    id: 22, name: 'Vikas Kumar', role: 'React Developer', src: 'HR', stage: 'hr', chip: 'feedback', age: 1,
    email: 'vikas.kumar@gmail.com',
    screening: { jdMatch: 86, when: '25 Jun', by: 'Priya' },
    rounds: {
      zeko_hr: { outcome: 'approved', when: '27 Jun', by: 'Anita', zeko: { interview: 85, communication: 88 }, emails: ['Outcome email — delivered'] },
      assessment: { outcome: 'approved', when: '29 Jun', by: 'Priya', iq: 82, tech: 85, testDate: '28 Jun', importedFrom: 'Evalground_Results_01Jul2026.csv', emails: ['Outcome email — delivered'] },
      zeko_fn: { outcome: 'approved', when: '30 Jun', by: 'Anita', zeko: { interview: 84, communication: 87 }, emails: ['Outcome email — delivered'] },
      tech1: { outcome: 'approved', when: '03 Jul', by: 'Priya', schedule: { when: '02 Jul, 11:00', who: 'Suresh Menon', mode: 'Teams' }, feedback: { by: 'Suresh Menon', rec: 'Approve', avg: 4.3, note: 'Strong React + TypeScript depth.' }, emails: ['Outcome email — delivered'] },
      tech2: { outcome: 'approved', when: '08 Jul', by: 'Anita', schedule: { when: '07 Jul, 15:00', who: 'Vikram Joshi', mode: 'Teams' }, feedback: { by: 'Vikram Joshi', rec: 'Approve', avg: 4.4, note: 'Clean component architecture thinking.' }, emails: ['Outcome email — delivered'] },
      hr: { schedule: { when: '16 Jul, 10:00', who: 'Nisha (RT)', mode: 'Teams' }, feedback: { by: 'Nisha (RT)', rec: 'Approve', avg: 4.2, note: 'CTC within band; 20-day notice; hybrid OK.' }, emails: ['Outlook invite (Teams) — candidate opened', 'Feedback submitted via tokenized link'] },
    },
  },
  {
    id: 23, name: 'Anjali Rao', role: 'Business Analyst', src: 'Vendor', vendor: 'TechBridge Solutions',
    stage: 'ceo', chip: 'feedback', age: 1, email: 'anjali.rao@outlook.com',
    screening: { jdMatch: 88, when: '15 Jun', by: 'Anita' },
    rounds: {
      zeko_hr: { outcome: 'approved', when: '17 Jun', by: 'Priya', zeko: { interview: 87, communication: 89 }, emails: ['Outcome email → candidate + vendor'] },
      assessment: { outcome: 'approved', when: '19 Jun', by: 'Anita', iq: 84, tech: 81, testDate: '18 Jun', importedFrom: 'Evalground_Results_24Jun2026.csv', emails: ['Outcome email → candidate + vendor'] },
      zeko_fn: { outcome: 'approved', when: '20 Jun', by: 'Priya', zeko: { interview: 86, communication: 88 }, emails: ['Outcome email → candidate + vendor'] },
      tech1: { outcome: 'approved', when: '23 Jun', by: 'Anita', schedule: { when: '22 Jun, 11:00', who: 'Vikram Joshi', mode: 'Teams' }, feedback: { by: 'Vikram Joshi', rec: 'Approve', avg: 4.3, note: 'Excellent BRD authoring.' }, emails: ['Outcome email → candidate + vendor'] },
      tech2: { outcome: 'approved', when: '28 Jun', by: 'Priya', schedule: { when: '27 Jun, 15:00', who: 'Deepa Rao', mode: 'Teams' }, feedback: { by: 'Deepa Rao', rec: 'Approve', avg: 4.5, note: 'Best case study this cycle.' }, emails: ['Outcome email → candidate + vendor'] },
      hr: { outcome: 'approved', when: '03 Jul', by: 'Nisha (RT)', schedule: { when: '02 Jul, 10:00', who: 'Nisha (RT)', mode: 'Teams' }, feedback: { by: 'Nisha (RT)', rec: 'Approve', avg: 4.3, note: 'Confident, clear on relocation and joining timeline.' }, note: 'CTC within band; 15-day notice', emails: ['Outcome email → candidate + vendor'] },
      ceo: { schedule: { when: '20 Jul, 16:00', who: 'CEO', mode: 'Teams' }, feedback: { by: 'CEO', rec: 'Approve', avg: 4.6, note: 'Confident, sharp business judgement. Go ahead.' }, emails: ['Outlook invite (Teams) — sent', 'Feedback submitted via tokenized link'] },
    },
  },
  {
    id: 24, name: 'Rohan Desai', role: 'Business Analyst', src: 'HR', stage: 'client', chip: 'review', age: 0,
    email: 'rohan.desai@gmail.com',
    screening: { jdMatch: 79, when: '28 Jun', by: 'Priya' },
    rounds: {
      zeko_hr: { outcome: 'approved', when: '30 Jun', by: 'Anita', zeko: { interview: 80, communication: 78 }, emails: ['Outcome email — delivered'] },
      assessment: { outcome: 'approved', when: '02 Jul', by: 'Priya', iq: 77, tech: 75, testDate: '01 Jul', importedFrom: 'Evalground_Results_01Jul2026.csv', emails: ['Outcome email — delivered'] },
      zeko_fn: { outcome: 'approved', when: '03 Jul', by: 'Anita', zeko: { interview: 79, communication: 77 }, emails: ['Outcome email — delivered'] },
      tech1: { outcome: 'approved', when: '07 Jul', by: 'Priya', schedule: { when: '06 Jul, 11:00', who: 'Suresh Menon', mode: 'Teams' }, feedback: { by: 'Suresh Menon', rec: 'Approve', avg: 3.9, note: 'Good BA fundamentals.' }, emails: ['Outcome email — delivered'] },
      tech2: { outcome: 'approved', when: '12 Jul', by: 'Anita', schedule: { when: '11 Jul, 15:00', who: 'Deepa Rao', mode: 'Teams' }, feedback: { by: 'Deepa Rao', rec: 'Approve', avg: 4.0, note: 'Solid.' }, emails: ['Outcome email — delivered'] },
      client: { status: 'review', note: 'Client contact added at MRF (R. Fernandes — Northwind Corp) — scheduling pending' },
    },
  },
  {
    id: 25, name: 'Karan Mehta', role: 'React Developer', src: 'HR', stage: 'zeko_hr', chip: 'feedback', age: 1,
    email: 'karan.mehta@gmail.com',
    screening: { jdMatch: 78, when: '16 Jul', by: 'Anita' },
    rounds: {
      zeko_hr: { zeko: { interview: 80, communication: 76 }, emails: ['Zeko HR screening invite → candidate', 'Zeko result synced — awaiting RT decision'] },
    },
  },
  {
    id: 26, name: 'Sneha Pillai', role: 'Business Analyst', src: 'Vendor', vendor: 'TechBridge Solutions',
    stage: 'zeko_fn', chip: 'feedback', age: 1, email: 'sneha.pillai@yahoo.co.in',
    screening: { jdMatch: 82, when: '10 Jul', by: 'Priya' },
    rounds: {
      zeko_hr: { outcome: 'approved', when: '12 Jul', by: 'Anita', zeko: { interview: 83, communication: 80 }, emails: ['Outcome email → candidate + vendor'] },
      assessment: { outcome: 'approved', when: '14 Jul', by: 'Priya', iq: 79, tech: 82, testDate: '13 Jul', importedFrom: 'Evalground_Results_14Jul2026.csv', emails: ['Outcome email → candidate + vendor'] },
      zeko_fn: { zeko: { interview: 79, communication: 81 }, emails: ['Zeko functional screening invite → candidate + vendor', 'Zeko result synced — awaiting RT decision'] },
    },
  },
  {
    id: 27, name: 'Arnav Shah', role: 'Senior .NET Developer', src: 'HR', stage: 'assessment', chip: 'feedback', age: 0,
    email: 'arnav.shah@gmail.com',
    screening: { jdMatch: 81, when: '17 Jul', by: 'Priya' },
    rounds: {
      zeko_hr: { outcome: 'approved', when: '19 Jul', by: 'Anita', zeko: { interview: 82, communication: 79 }, emails: ['Outcome email — delivered'] },
      assessment: { iq: 74, tech: 79, testDate: '20 Jul', importedFrom: 'Evalground_Results_20Jul2026.csv', note: 'IQ 74% / Technical 79% — both above the 50% pass mark (Q4); auto-suggests Passed, RT decides', emails: ['Assessment invite (GA + Technical) — opened'] },
    },
  },
  {
    id: 28, name: 'Tanvi Joshi', role: 'Power BI Developer', src: 'Email', stage: 'zeko_hr', chip: 'pending', age: 0,
    email: 'tanvi.joshi@yahoo.in',
    screening: { jdMatch: 76, when: '20 Jul', by: 'Anita' },
    rounds: { zeko_hr: { status: 'pending' } },
  },
  {
    id: 29, name: 'Devansh Rao', role: 'QA Engineer', src: 'HR', stage: 'zeko_hr', chip: 'await', age: 2,
    email: 'devansh.rao@gmail.com',
    screening: { jdMatch: 73, when: '17 Jul', by: 'Priya' },
    rounds: { zeko_hr: { status: 'in_progress', note: 'Candidate started the Zeko HR screening 2 days ago — link expires in 3 days', emails: ['Zeko HR screening invite → candidate'] } },
  },
  {
    id: 30, name: 'Ishaan Kapoor', role: 'Senior .NET Developer', src: 'HR', stage: 'zeko_fn', chip: 'pending', age: 0,
    email: 'ishaan.kapoor@gmail.com',
    screening: { jdMatch: 85, when: '10 Jul', by: 'Priya' },
    rounds: {
      zeko_hr: { outcome: 'approved', when: '12 Jul', by: 'Anita', zeko: { interview: 86, communication: 83 }, emails: ['Outcome email — delivered'] },
      assessment: { outcome: 'approved', when: '14 Jul', by: 'Priya', iq: 82, tech: 85, testDate: '13 Jul', importedFrom: 'Evalground_Results_14Jul2026.csv', emails: ['Outcome email — delivered'] },
      zeko_fn: { status: 'pending' },
    },
  },
  {
    id: 31, name: 'Naina Chopra', role: 'Business Analyst', src: 'Vendor', vendor: 'Talent Hive', stage: 'zeko_fn',
    chip: 'await', age: 1, email: 'naina.chopra@outlook.com',
    screening: { jdMatch: 80, when: '15 Jul', by: 'Anita' },
    rounds: {
      zeko_hr: { outcome: 'approved', when: '17 Jul', by: 'Priya', zeko: { interview: 81, communication: 79 }, emails: ['Outcome email → candidate + vendor'] },
      assessment: { outcome: 'approved', when: '19 Jul', by: 'Anita', iq: 78, tech: 80, testDate: '18 Jul', importedFrom: 'Evalground_Results_20Jul2026.csv', emails: ['Outcome email → candidate + vendor'] },
      zeko_fn: { status: 'in_progress', note: 'Candidate started the Zeko functional screening this morning', emails: ['Zeko functional screening invite → candidate + vendor'] },
    },
  },
  {
    id: 32, name: 'Yash Malhotra', role: 'React Developer', src: 'HR', stage: 'assessment', chip: 'pending', age: 0,
    email: 'yash.malhotra@gmail.com',
    screening: { jdMatch: 77, when: '19 Jul', by: 'Priya' },
    rounds: {
      zeko_hr: { outcome: 'approved', when: '21 Jul', by: 'Anita', zeko: { interview: 78, communication: 75 }, emails: ['Outcome email — delivered'] },
      assessment: { status: 'pending' },
    },
  },
  {
    id: 33, name: 'Ritika Sood', role: 'QA Engineer', src: 'Email', stage: 'assessment', chip: 'invited', age: 1,
    email: 'ritika.sood@yahoo.in',
    screening: { jdMatch: 75, when: '16 Jul', by: 'Anita' },
    rounds: {
      zeko_hr: { outcome: 'approved', when: '18 Jul', by: 'Priya', zeko: { interview: 76, communication: 74 }, emails: ['Outcome email — delivered'] },
      assessment: { status: 'invited', deadline: '25 Jul 2026', emails: ['Assessment invite (GA + Technical) → candidate · deadline 25 Jul 2026'] },
    },
  },
  // v9 — 19 more candidates so every round (HR Screening through Offer) shows
  // the full lifecycle: entry → schedule/invite → outcome → decision.
  {
    id: 34, name: 'Zoya Ahmed', role: 'QA Engineer', src: 'Email', stage: 'zeko_hr', chip: 'feedback', age: 1,
    email: 'zoya.ahmed@yahoo.in',
    screening: { jdMatch: 71, when: '19 Jul', by: 'Anita' },
    rounds: { zeko_hr: { zeko: { interview: 62, communication: 58 }, emails: ['Zeko HR screening invite → candidate', 'Zeko result synced — awaiting RT decision'] } },
  },
  {
    id: 35, name: 'Kabir Malhotra', role: 'React Developer', src: 'HR', stage: 'assessment', chip: 'hold', age: 8,
    email: 'kabir.malhotra@gmail.com',
    screening: { jdMatch: 73, when: '10 Jul', by: 'Priya' },
    rounds: {
      zeko_hr: { outcome: 'approved', when: '12 Jul', by: 'Anita', zeko: { interview: 74, communication: 70 }, emails: ['Outcome email — delivered'] },
      assessment: { outcome: 'hold', reason: 'Awaiting comparison with other candidates', when: '13 Jul', by: 'Priya', iq: 68, tech: 55, testDate: '12 Jul', importedFrom: 'Evalground_Results_14Jul2026.csv', note: 'Borderline technical score — RT wants to compare against 2 more candidates before deciding', emails: ['Assessment invite (GA + Technical) — opened', 'On-hold email — delivered'] },
    },
  },
  {
    id: 36, name: 'Isha Trivedi', role: 'Senior .NET Developer', src: 'Vendor', vendor: 'Talent Hive', stage: 'zeko_fn',
    chip: 'feedback', age: 1, email: 'isha.trivedi@outlook.com',
    screening: { jdMatch: 74, when: '14 Jul', by: 'Anita' },
    rounds: {
      zeko_hr: { outcome: 'approved', when: '16 Jul', by: 'Priya', zeko: { interview: 72, communication: 69 }, emails: ['Outcome email → candidate + vendor'] },
      assessment: { outcome: 'approved', when: '18 Jul', by: 'Anita', iq: 70, tech: 68, testDate: '17 Jul', importedFrom: 'Evalground_Results_20Jul2026.csv', emails: ['Outcome email → candidate + vendor'] },
      zeko_fn: { zeko: { interview: 60, communication: 57 }, emails: ['Zeko functional screening invite → candidate + vendor', 'Zeko result synced — awaiting RT decision'] },
    },
  },
  {
    id: 37, name: 'Nikhil Bansal', role: 'Senior .NET Developer', src: 'HR', stage: 'tech1', chip: 'invited', age: 0,
    email: 'nikhil.bansal@gmail.com',
    screening: { jdMatch: 83, when: '13 Jul', by: 'Priya' },
    rounds: {
      zeko_hr: { outcome: 'approved', when: '15 Jul', by: 'Anita', zeko: { interview: 84, communication: 80 }, emails: ['Outcome email — delivered'] },
      assessment: { outcome: 'approved', when: '17 Jul', by: 'Priya', iq: 80, tech: 83, testDate: '16 Jul', importedFrom: 'Evalground_Results_20Jul2026.csv', emails: ['Outcome email — delivered'] },
      zeko_fn: { outcome: 'approved', when: '18 Jul', by: 'Anita', zeko: { interview: 82, communication: 81 }, emails: ['Outcome email — delivered'] },
      tech1: { status: 'invited', emails: ['Self-scheduling link (3 published slots) → candidate'] },
    },
  },
  {
    id: 38, name: 'Advait Rao', role: 'Senior .NET Developer', src: 'HR', stage: 'tech3', chip: 'scheduled', age: 1,
    email: 'advait.rao@gmail.com',
    screening: { jdMatch: 87, when: '30 Jun', by: 'Priya' },
    rounds: {
      zeko_hr: { outcome: 'approved', when: '02 Jul', by: 'Anita', zeko: { interview: 86, communication: 83 }, emails: ['Outcome email — delivered'] },
      assessment: { outcome: 'approved', when: '04 Jul', by: 'Priya', iq: 84, tech: 87, testDate: '03 Jul', importedFrom: 'Evalground_Results_08Jul2026.csv', emails: ['Outcome email — delivered'] },
      zeko_fn: { outcome: 'approved', when: '05 Jul', by: 'Anita', zeko: { interview: 85, communication: 84 }, emails: ['Outcome email — delivered'] },
      tech1: { outcome: 'approved', when: '08 Jul', by: 'Priya', schedule: { when: '07 Jul, 11:00', who: 'Suresh Menon', mode: 'Teams' }, feedback: { by: 'Suresh Menon', rec: 'Approve', avg: 4.5, note: 'Excellent systems depth.' }, emails: ['Outcome email — delivered'] },
      tech2: { outcome: 'approved', when: '13 Jul', by: 'Anita', schedule: { when: '12 Jul, 15:00', who: 'Deepa Rao', mode: 'Teams' }, feedback: { by: 'Deepa Rao', rec: 'Approve', avg: 4.6, note: 'Top-tier — extra round warranted.' }, emails: ['Outcome email — delivered'] },
      tech3: { status: 'scheduled', schedule: { when: '21 Jul, 11:00', who: 'Suresh Menon', mode: 'Teams' }, note: 'Optional third technical round — extra architecture-focused round for senior candidates', emails: ['Outlook invite (Teams) — candidate opened'] },
    },
  },
  {
    id: 39, name: 'Simran Kaur', role: 'Senior .NET Developer', src: 'Vendor', vendor: 'TechBridge Solutions', stage: 'tech3',
    chip: 'feedback', age: 1, email: 'simran.kaur@outlook.com',
    screening: { jdMatch: 90, when: '25 Jun', by: 'Anita' },
    rounds: {
      zeko_hr: { outcome: 'approved', when: '27 Jun', by: 'Priya', zeko: { interview: 89, communication: 85 }, emails: ['Outcome email → candidate + vendor'] },
      assessment: { outcome: 'approved', when: '29 Jun', by: 'Anita', iq: 87, tech: 90, testDate: '28 Jun', importedFrom: 'Evalground_Results_01Jul2026.csv', emails: ['Outcome email → candidate + vendor'] },
      zeko_fn: { outcome: 'approved', when: '30 Jun', by: 'Priya', zeko: { interview: 88, communication: 86 }, emails: ['Outcome email → candidate + vendor'] },
      tech1: { outcome: 'approved', when: '03 Jul', by: 'Anita', schedule: { when: '02 Jul, 11:00', who: 'Suresh Menon', mode: 'Teams' }, feedback: { by: 'Suresh Menon', rec: 'Approve', avg: 4.8, note: 'Outstanding.' }, emails: ['Outcome email → candidate + vendor'] },
      tech2: { outcome: 'approved', when: '08 Jul', by: 'Priya', schedule: { when: '07 Jul, 15:00', who: 'Deepa Rao', mode: 'Teams' }, feedback: { by: 'Deepa Rao', rec: 'Approve', avg: 4.7, note: 'Ready for final review.' }, emails: ['Outcome email → candidate + vendor'] },
      tech3: { schedule: { when: '16 Jul, 11:00', who: 'Suresh Menon', mode: 'Teams' }, feedback: { by: 'Suresh Menon', rec: 'Approve', avg: 4.6, note: 'Confirms the earlier rounds — clear approve.' }, note: 'Optional third technical round — extra architecture-focused round for senior candidates', emails: ['Outlook invite (Teams) — candidate opened', 'Feedback submitted via tokenized link'] },
    },
  },
  {
    id: 40, name: 'Omkar Patil', role: 'Power BI Developer', src: 'Email', stage: 'hr', chip: 'invited', age: 0,
    email: 'omkar.patil@yahoo.in',
    screening: { jdMatch: 79, when: '14 Jul', by: 'Anita' },
    rounds: {
      zeko_hr: { outcome: 'approved', when: '16 Jul', by: 'Priya', zeko: { interview: 80, communication: 78 }, emails: ['Outcome email — delivered'] },
      assessment: { outcome: 'approved', when: '18 Jul', by: 'Anita', iq: 77, tech: 79, testDate: '17 Jul', importedFrom: 'Evalground_Results_20Jul2026.csv', emails: ['Outcome email — delivered'] },
      zeko_fn: { outcome: 'approved', when: '19 Jul', by: 'Priya', zeko: { interview: 79, communication: 80 }, emails: ['Outcome email — delivered'] },
      tech1: { outcome: 'approved', when: '20 Jul', by: 'Anita', schedule: { when: '19 Jul, 11:00', who: 'Suresh Menon', mode: 'Teams' }, feedback: { by: 'Suresh Menon', rec: 'Approve', avg: 3.9, note: 'Good DAX skills.' }, emails: ['Outcome email — delivered'] },
      tech2: { outcome: 'approved', when: '21 Jul', by: 'Priya', schedule: { when: '20 Jul, 15:00', who: 'Vikram Joshi', mode: 'Teams' }, feedback: { by: 'Vikram Joshi', rec: 'Approve', avg: 4.0, note: 'Ready for HR round.' }, emails: ['Outcome email — delivered'] },
      hr: { status: 'invited', emails: ['Self-scheduling link (3 published slots) → candidate'] },
    },
  },
  {
    id: 41, name: 'Reema Iyer', role: 'React Developer', src: 'Vendor', vendor: 'Talent Hive', stage: 'hr',
    chip: 'hold', age: 4, email: 'reema.iyer@outlook.com',
    screening: { jdMatch: 82, when: '28 Jun', by: 'Priya' },
    rounds: {
      zeko_hr: { outcome: 'approved', when: '30 Jun', by: 'Anita', zeko: { interview: 83, communication: 81 }, emails: ['Outcome email → candidate + vendor'] },
      assessment: { outcome: 'approved', when: '02 Jul', by: 'Priya', iq: 80, tech: 82, testDate: '01 Jul', importedFrom: 'Evalground_Results_01Jul2026.csv', emails: ['Outcome email → candidate + vendor'] },
      zeko_fn: { outcome: 'approved', when: '03 Jul', by: 'Anita', zeko: { interview: 81, communication: 83 }, emails: ['Outcome email → candidate + vendor'] },
      tech1: { outcome: 'approved', when: '07 Jul', by: 'Priya', schedule: { when: '06 Jul, 11:00', who: 'Suresh Menon', mode: 'Teams' }, feedback: { by: 'Suresh Menon', rec: 'Approve', avg: 4.2, note: 'Strong React depth.' }, emails: ['Outcome email → candidate + vendor'] },
      tech2: { outcome: 'approved', when: '12 Jul', by: 'Anita', schedule: { when: '11 Jul, 15:00', who: 'Vikram Joshi', mode: 'Teams' }, feedback: { by: 'Vikram Joshi', rec: 'Approve', avg: 4.3, note: 'Clean architecture instincts.' }, emails: ['Outcome email → candidate + vendor'] },
      hr: { outcome: 'hold', reason: 'Candidate asked for time', when: '16 Jul', by: 'Priya', schedule: { when: '15 Jul, 10:00', who: 'Nisha (RT)', mode: 'Teams' }, feedback: { by: 'Nisha (RT)', rec: 'Hold', avg: 3.6, note: 'Needs another week to decide on relocation.' }, note: 'On Hold 4 days — manual review only (no auto-close, Q10)', emails: ['On-hold email → candidate + vendor (status-only)'] },
    },
  },
  {
    id: 42, name: 'Aarav Singh', role: 'Business Analyst', src: 'HR', stage: 'ceo', chip: 'review', age: 0,
    email: 'aarav.singh@gmail.com',
    screening: { jdMatch: 81, when: '10 Jul', by: 'Anita' },
    rounds: {
      zeko_hr: { outcome: 'approved', when: '12 Jul', by: 'Priya', zeko: { interview: 82, communication: 84 }, emails: ['Outcome email — delivered'] },
      assessment: { outcome: 'approved', when: '14 Jul', by: 'Anita', iq: 78, tech: 76, testDate: '13 Jul', importedFrom: 'Evalground_Results_14Jul2026.csv', emails: ['Outcome email — delivered'] },
      zeko_fn: { outcome: 'approved', when: '15 Jul', by: 'Priya', zeko: { interview: 80, communication: 82 }, emails: ['Outcome email — delivered'] },
      tech1: { outcome: 'approved', when: '18 Jul', by: 'Anita', schedule: { when: '17 Jul, 11:00', who: 'Vikram Joshi', mode: 'Teams' }, feedback: { by: 'Vikram Joshi', rec: 'Approve', avg: 4.0, note: 'Solid BA fundamentals.' }, emails: ['Outcome email — delivered'] },
      tech2: { outcome: 'approved', when: '19 Jul', by: 'Priya', schedule: { when: '18 Jul, 15:00', who: 'Deepa Rao', mode: 'Teams' }, feedback: { by: 'Deepa Rao', rec: 'Approve', avg: 4.1, note: 'Good case handling.' }, emails: ['Outcome email — delivered'] },
      hr: { outcome: 'approved', when: '20 Jul', by: 'Nisha (RT)', schedule: { when: '19 Jul, 10:00', who: 'Nisha (RT)', mode: 'Teams' }, feedback: { by: 'Nisha (RT)', rec: 'Approve', avg: 4.0, note: 'Good fit, notice period within range.' }, emails: ['Outcome email — delivered'] },
      ceo: { status: 'review' },
    },
  },
  {
    id: 43, name: 'Diya Kapoor', role: 'Power BI Developer', src: 'HR', stage: 'ceo', chip: 'hold', age: 3,
    email: 'diya.kapoor@gmail.com',
    screening: { jdMatch: 86, when: '20 Jun', by: 'Priya' },
    rounds: {
      zeko_hr: { outcome: 'approved', when: '22 Jun', by: 'Anita', zeko: { interview: 87, communication: 85 }, emails: ['Outcome email — delivered'] },
      assessment: { outcome: 'approved', when: '24 Jun', by: 'Priya', iq: 83, tech: 85, testDate: '23 Jun', importedFrom: 'Evalground_Results_24Jun2026.csv', emails: ['Outcome email — delivered'] },
      zeko_fn: { outcome: 'approved', when: '25 Jun', by: 'Anita', zeko: { interview: 86, communication: 87 }, emails: ['Outcome email — delivered'] },
      tech1: { outcome: 'approved', when: '28 Jun', by: 'Priya', schedule: { when: '27 Jun, 10:00', who: 'Vikram Joshi', mode: 'Teams' }, feedback: { by: 'Vikram Joshi', rec: 'Approve', avg: 4.4, note: 'Strong data modelling.' }, emails: ['Outcome email — delivered'] },
      tech2: { outcome: 'approved', when: '03 Jul', by: 'Anita', schedule: { when: '02 Jul, 15:00', who: 'Deepa Rao', mode: 'Teams' }, feedback: { by: 'Deepa Rao', rec: 'Approve', avg: 4.5, note: 'Ready for final.' }, emails: ['Outcome email — delivered'] },
      hr: { outcome: 'approved', when: '07 Jul', by: 'Nisha (RT)', schedule: { when: '06 Jul, 10:00', who: 'Nisha (RT)', mode: 'Teams' }, feedback: { by: 'Nisha (RT)', rec: 'Approve', avg: 4.2, note: 'Strong communication, clear on CTC expectations.' }, emails: ['Outcome email — delivered'] },
      ceo: { outcome: 'hold', reason: 'Position on hold', when: '17 Jul', by: 'Priya', schedule: { when: '16 Jul, 16:00', who: 'CEO', mode: 'Teams' }, feedback: { by: 'CEO', rec: 'Hold', avg: 3.9, note: 'Strong candidate — budget sign-off pending before final go-ahead.' }, note: 'On Hold 3 days — manual review only (no auto-close, Q10)', emails: ['On-hold email — delivered'] },
    },
  },
  {
    id: 44, name: 'Rajesh Nambiar', role: 'Business Analyst', src: 'HR', stage: 'client', chip: 'feedback', age: 1,
    email: 'rajesh.nambiar@gmail.com',
    screening: { jdMatch: 78, when: '01 Jul', by: 'Anita' },
    rounds: {
      zeko_hr: { outcome: 'approved', when: '03 Jul', by: 'Priya', zeko: { interview: 79, communication: 81 }, emails: ['Outcome email — delivered'] },
      assessment: { outcome: 'approved', when: '05 Jul', by: 'Anita', iq: 76, tech: 74, testDate: '04 Jul', importedFrom: 'Evalground_Results_08Jul2026.csv', emails: ['Outcome email — delivered'] },
      zeko_fn: { outcome: 'approved', when: '06 Jul', by: 'Priya', zeko: { interview: 78, communication: 80 }, emails: ['Outcome email — delivered'] },
      tech1: { outcome: 'approved', when: '09 Jul', by: 'Anita', schedule: { when: '08 Jul, 11:00', who: 'Suresh Menon', mode: 'Teams' }, feedback: { by: 'Suresh Menon', rec: 'Approve', avg: 3.9, note: 'Good BA depth.' }, emails: ['Outcome email — delivered'] },
      tech2: { outcome: 'approved', when: '14 Jul', by: 'Priya', schedule: { when: '13 Jul, 15:00', who: 'Deepa Rao', mode: 'Teams' }, feedback: { by: 'Deepa Rao', rec: 'Approve', avg: 4.0, note: 'Fine.' }, emails: ['Outcome email — delivered'] },
      client: { schedule: { when: '18 Jul, 17:30', who: 'R. Fernandes — Northwind Corp', mode: 'Client call' }, feedback: { by: 'R. Fernandes (Client)', rec: 'Approve', avg: 4.3, note: 'Client happy with the candidate — proceed.' }, note: 'Client contact added at MRF; custom client-interview template used', emails: ['Client interview email (custom template) — sent', 'Client feedback received by phone, transcribed by RT'] },
    },
  },
  {
    id: 45, name: 'Manav Chatterjee', role: 'Senior .NET Developer', src: 'HR', stage: 'docs', chip: 'pending', age: 0,
    email: 'manav.chatterjee@gmail.com',
    screening: { jdMatch: 85, when: '25 Jun', by: 'Priya' },
    rounds: {
      zeko_hr: { outcome: 'approved', when: '27 Jun', by: 'Anita', zeko: { interview: 86, communication: 82 }, emails: ['Outcome email — delivered'] },
      assessment: { outcome: 'approved', when: '29 Jun', by: 'Priya', iq: 82, tech: 85, testDate: '28 Jun', importedFrom: 'Evalground_Results_01Jul2026.csv', emails: ['Outcome email — delivered'] },
      zeko_fn: { outcome: 'approved', when: '30 Jun', by: 'Anita', zeko: { interview: 84, communication: 83 }, emails: ['Outcome email — delivered'] },
      tech1: { outcome: 'approved', when: '03 Jul', by: 'Priya', schedule: { when: '02 Jul, 11:00', who: 'Suresh Menon', mode: 'Teams' }, feedback: { by: 'Suresh Menon', rec: 'Approve', avg: 4.3, note: 'Strong systems depth.' }, emails: ['Outcome email — delivered'] },
      tech2: { outcome: 'approved', when: '08 Jul', by: 'Anita', schedule: { when: '07 Jul, 15:00', who: 'Deepa Rao', mode: 'Teams' }, feedback: { by: 'Deepa Rao', rec: 'Approve', avg: 4.4, note: 'Ready for HR.' }, emails: ['Outcome email — delivered'] },
      hr: { outcome: 'approved', when: '13 Jul', by: 'Nisha (RT)', schedule: { when: '12 Jul, 10:00', who: 'Nisha (RT)', mode: 'Teams' }, feedback: { by: 'Nisha (RT)', rec: 'Approve', avg: 4.3, note: 'Good culture fit, notice period confirmed.' }, emails: ['Outcome email — delivered'] },
      ceo: { outcome: 'approved', when: '18 Jul', by: 'Priya', schedule: { when: '17 Jul, 16:00', who: 'CEO', mode: 'Teams' }, feedback: { by: 'CEO', rec: 'Approve', avg: 4.5, note: 'Go ahead.' }, emails: ['Outcome email — delivered'] },
      docs: {},
    },
  },
  {
    id: 46, name: 'Priyansh Oberoi', role: 'QA Engineer', src: 'Email', stage: 'docs', chip: 'docs', age: 1,
    email: 'priyansh.oberoi@yahoo.in',
    screening: { jdMatch: 76, when: '12 Jul', by: 'Anita' },
    rounds: {
      zeko_hr: { outcome: 'approved', when: '14 Jul', by: 'Priya', zeko: { interview: 77, communication: 75 }, emails: ['Outcome email — delivered'] },
      assessment: { outcome: 'approved', when: '16 Jul', by: 'Anita', iq: 74, tech: 72, testDate: '15 Jul', importedFrom: 'Evalground_Results_20Jul2026.csv', emails: ['Outcome email — delivered'] },
      zeko_fn: { outcome: 'approved', when: '17 Jul', by: 'Priya', zeko: { interview: 76, communication: 74 }, emails: ['Outcome email — delivered'] },
      tech1: { outcome: 'approved', when: '18 Jul', by: 'Anita', schedule: { when: '17 Jul, 11:00', who: 'Suresh Menon', mode: 'Teams' }, feedback: { by: 'Suresh Menon', rec: 'Approve', avg: 3.8, note: 'Solid QA fundamentals.' }, emails: ['Outcome email — delivered'] },
      tech2: { outcome: 'approved', when: '19 Jul', by: 'Priya', schedule: { when: '18 Jul, 15:00', who: 'Deepa Rao', mode: 'Teams' }, feedback: { by: 'Deepa Rao', rec: 'Approve', avg: 3.9, note: 'Good automation coverage.' }, emails: ['Outcome email — delivered'] },
      hr: { outcome: 'approved', when: '20 Jul', by: 'Nisha (RT)', schedule: { when: '19 Jul, 15:00', who: 'Nisha (RT)', mode: 'Teams' }, feedback: { by: 'Nisha (RT)', rec: 'Approve', avg: 3.9, note: 'Solid communication, clear expectations.' }, emails: ['Outcome email — delivered'] },
      docs: {
        requested: true,
        checklist: [
          { name: 'Govt ID (Aadhaar/PAN)', status: 'pending' },
          { name: 'Education certificates', status: 'pending' },
          { name: 'Experience / relieving letters', status: 'pending' },
          { name: 'Last 3 payslips', status: 'pending' },
        ],
        emails: ['Document request sent — secure upload link emailed to the candidate (vendor not copied)'],
      },
    },
  },
  {
    id: 47, name: 'Tanya Bhalla', role: 'Business Analyst', src: 'HR', stage: 'docs', chip: 'docs', age: 2,
    email: 'tanya.bhalla@gmail.com',
    screening: { jdMatch: 84, when: '05 Jul', by: 'Priya' },
    rounds: {
      zeko_hr: { outcome: 'approved', when: '07 Jul', by: 'Anita', zeko: { interview: 85, communication: 83 }, emails: ['Outcome email — delivered'] },
      assessment: { outcome: 'approved', when: '09 Jul', by: 'Priya', iq: 81, tech: 79, testDate: '08 Jul', importedFrom: 'Evalground_Results_08Jul2026.csv', emails: ['Outcome email — delivered'] },
      zeko_fn: { outcome: 'approved', when: '10 Jul', by: 'Anita', zeko: { interview: 83, communication: 82 }, emails: ['Outcome email — delivered'] },
      tech1: { outcome: 'approved', when: '13 Jul', by: 'Priya', schedule: { when: '12 Jul, 11:00', who: 'Vikram Joshi', mode: 'Teams' }, feedback: { by: 'Vikram Joshi', rec: 'Approve', avg: 4.1, note: 'Good requirements depth.' }, emails: ['Outcome email — delivered'] },
      tech2: { outcome: 'approved', when: '15 Jul', by: 'Anita', schedule: { when: '14 Jul, 15:00', who: 'Deepa Rao', mode: 'Teams' }, feedback: { by: 'Deepa Rao', rec: 'Approve', avg: 4.2, note: 'Ready for HR.' }, emails: ['Outcome email — delivered'] },
      hr: { outcome: 'approved', when: '17 Jul', by: 'Nisha (RT)', schedule: { when: '16 Jul, 10:00', who: 'Nisha (RT)', mode: 'Teams' }, feedback: { by: 'Nisha (RT)', rec: 'Approve', avg: 4.2, note: 'Good fit, aligned on role scope.' }, emails: ['Outcome email — delivered'] },
      docs: {
        requested: true,
        checklist: [
          { name: 'Govt ID (Aadhaar/PAN)', status: 'uploaded' },
          { name: 'Education certificates', status: 'uploaded' },
          { name: 'Experience / relieving letters', status: 'pending' },
          { name: 'Last 3 payslips', status: 'pending' },
        ],
        emails: ['Document request sent — secure upload link emailed to the candidate (vendor not copied)', 'Candidate uploaded 2 of 4 documents'],
      },
    },
  },
  {
    id: 48, name: 'Kunal Rastogi', role: 'React Developer', src: 'Vendor', vendor: 'TechBridge Solutions', stage: 'docs',
    chip: 'feedback', age: 1, email: 'kunal.rastogi@outlook.com',
    screening: { jdMatch: 88, when: '28 Jun', by: 'Anita' },
    rounds: {
      zeko_hr: { outcome: 'approved', when: '30 Jun', by: 'Priya', zeko: { interview: 89, communication: 86 }, emails: ['Outcome email → candidate + vendor'] },
      assessment: { outcome: 'approved', when: '02 Jul', by: 'Anita', iq: 85, tech: 88, testDate: '01 Jul', importedFrom: 'Evalground_Results_01Jul2026.csv', emails: ['Outcome email → candidate + vendor'] },
      zeko_fn: { outcome: 'approved', when: '03 Jul', by: 'Priya', zeko: { interview: 87, communication: 85 }, emails: ['Outcome email → candidate + vendor'] },
      tech1: { outcome: 'approved', when: '06 Jul', by: 'Anita', schedule: { when: '05 Jul, 11:00', who: 'Suresh Menon', mode: 'Teams' }, feedback: { by: 'Suresh Menon', rec: 'Approve', avg: 4.5, note: 'Excellent React depth.' }, emails: ['Outcome email → candidate + vendor'] },
      tech2: { outcome: 'approved', when: '11 Jul', by: 'Priya', schedule: { when: '10 Jul, 15:00', who: 'Vikram Joshi', mode: 'Teams' }, feedback: { by: 'Vikram Joshi', rec: 'Approve', avg: 4.6, note: 'Best candidate this cycle.' }, emails: ['Outcome email → candidate + vendor'] },
      hr: { outcome: 'approved', when: '13 Jul', by: 'Nisha (RT)', schedule: { when: '12 Jul, 10:00', who: 'Nisha (RT)', mode: 'Teams' }, feedback: { by: 'Nisha (RT)', rec: 'Approve', avg: 4.4, note: 'Excellent communication, strong culture fit.' }, emails: ['Outcome email → candidate + vendor'] },
      docs: {
        requested: true,
        checklist: [
          { name: 'Govt ID (Aadhaar/PAN)', status: 'verified' },
          { name: 'Education certificates', status: 'verified' },
          { name: 'Experience / relieving letters', status: 'verified' },
          { name: 'Last 3 payslips', status: 'verified' },
        ],
        emails: ['Document request → candidate only (vendor not copied — PII, Q5)', 'All 4 documents verified'],
      },
    },
  },
  {
    id: 49, name: 'Ayaan Siddiqui', role: 'Senior .NET Developer', src: 'HR', stage: 'offer', chip: 'pending', age: 0,
    email: 'ayaan.siddiqui@gmail.com',
    screening: { jdMatch: 89, when: '18 Jun', by: 'Priya' },
    rounds: {
      zeko_hr: { outcome: 'approved', when: '20 Jun', by: 'Anita', zeko: { interview: 90, communication: 87 }, emails: ['Outcome email — delivered'] },
      assessment: { outcome: 'approved', when: '22 Jun', by: 'Priya', iq: 86, tech: 89, testDate: '21 Jun', importedFrom: 'Evalground_Results_24Jun2026.csv', emails: ['Outcome email — delivered'] },
      zeko_fn: { outcome: 'approved', when: '23 Jun', by: 'Anita', zeko: { interview: 88, communication: 86 }, emails: ['Outcome email — delivered'] },
      tech1: { outcome: 'approved', when: '26 Jun', by: 'Priya', schedule: { when: '25 Jun, 11:00', who: 'Suresh Menon', mode: 'Teams' }, feedback: { by: 'Suresh Menon', rec: 'Approve', avg: 4.6, note: 'Exceptional.' }, emails: ['Outcome email — delivered'] },
      tech2: { outcome: 'approved', when: '01 Jul', by: 'Anita', schedule: { when: '30 Jun, 15:00', who: 'Deepa Rao', mode: 'Teams' }, feedback: { by: 'Deepa Rao', rec: 'Approve', avg: 4.7, note: 'Best of the quarter.' }, emails: ['Outcome email — delivered'] },
      hr: { outcome: 'approved', when: '06 Jul', by: 'Nisha (RT)', schedule: { when: '05 Jul, 10:00', who: 'Nisha (RT)', mode: 'Teams' }, feedback: { by: 'Nisha (RT)', rec: 'Approve', avg: 4.5, note: 'Exceptional — clear on everything.' }, emails: ['Outcome email — delivered'] },
      docs: { outcome: 'approved', when: '13 Jul', by: 'Anita', note: 'All documents verified', requested: true, checklist: [
        { name: 'Govt ID (Aadhaar/PAN)', status: 'verified' }, { name: 'Education certificates', status: 'verified' },
        { name: 'Experience / relieving letters', status: 'verified' }, { name: 'Last 3 payslips', status: 'verified' },
      ], emails: ['Document request — completed'] },
      offer: {},
    },
  },
  {
    id: 50, name: 'Meher Chawla', role: 'Business Analyst', src: 'Email', stage: 'offer', chip: 'await', age: 2,
    email: 'meher.chawla@yahoo.in',
    screening: { jdMatch: 82, when: '10 Jun', by: 'Anita' },
    rounds: {
      zeko_hr: { outcome: 'approved', when: '12 Jun', by: 'Priya', zeko: { interview: 83, communication: 85 }, emails: ['Outcome email — delivered'] },
      assessment: { outcome: 'approved', when: '14 Jun', by: 'Anita', iq: 79, tech: 77, testDate: '13 Jun', importedFrom: 'Evalground_Results_24Jun2026.csv', emails: ['Outcome email — delivered'] },
      zeko_fn: { outcome: 'approved', when: '16 Jun', by: 'Priya', zeko: { interview: 81, communication: 83 }, emails: ['Outcome email — delivered'] },
      tech1: { outcome: 'approved', when: '19 Jun', by: 'Anita', schedule: { when: '18 Jun, 11:00', who: 'Vikram Joshi', mode: 'Teams' }, feedback: { by: 'Vikram Joshi', rec: 'Approve', avg: 4.1, note: 'Good BA depth.' }, emails: ['Outcome email — delivered'] },
      tech2: { outcome: 'approved', when: '24 Jun', by: 'Priya', schedule: { when: '23 Jun, 15:00', who: 'Deepa Rao', mode: 'Teams' }, feedback: { by: 'Deepa Rao', rec: 'Approve', avg: 4.2, note: 'Excellent case handling.' }, emails: ['Outcome email — delivered'] },
      hr: { outcome: 'approved', when: '29 Jun', by: 'Nisha (RT)', schedule: { when: '28 Jun, 10:00', who: 'Nisha (RT)', mode: 'Teams' }, feedback: { by: 'Nisha (RT)', rec: 'Approve', avg: 4.1, note: 'Good fit, notice period confirmed.' }, emails: ['Outcome email — delivered'] },
      docs: { outcome: 'approved', when: '06 Jul', by: 'Anita', note: 'All documents verified', requested: true, checklist: [
        { name: 'Govt ID (Aadhaar/PAN)', status: 'verified' }, { name: 'Education certificates', status: 'verified' },
        { name: 'Experience / relieving letters', status: 'verified' }, { name: 'Last 3 payslips', status: 'verified' },
      ], emails: ['Document request — completed'] },
      offer: { offer: { approvalStatus: 'pending' }, emails: ['Approval request → Priya (recruiter) — daily nudge armed'] },
    },
  },
  {
    id: 51, name: 'Vivaan Kohli', role: 'React Developer', src: 'Vendor', vendor: 'Talent Hive', stage: 'offer',
    chip: 'await', age: 1, email: 'vivaan.kohli@outlook.com',
    screening: { jdMatch: 85, when: '05 Jun', by: 'Priya' },
    rounds: {
      zeko_hr: { outcome: 'approved', when: '07 Jun', by: 'Anita', zeko: { interview: 86, communication: 84 }, emails: ['Outcome email → candidate + vendor'] },
      assessment: { outcome: 'approved', when: '09 Jun', by: 'Priya', iq: 82, tech: 85, testDate: '08 Jun', importedFrom: 'Evalground_Results_24Jun2026.csv', emails: ['Outcome email → candidate + vendor'] },
      zeko_fn: { outcome: 'approved', when: '11 Jun', by: 'Anita', zeko: { interview: 84, communication: 83 }, emails: ['Outcome email → candidate + vendor'] },
      tech1: { outcome: 'approved', when: '14 Jun', by: 'Priya', schedule: { when: '13 Jun, 11:00', who: 'Suresh Menon', mode: 'Teams' }, feedback: { by: 'Suresh Menon', rec: 'Approve', avg: 4.3, note: 'Strong React depth.' }, emails: ['Outcome email → candidate + vendor'] },
      tech2: { outcome: 'approved', when: '19 Jun', by: 'Anita', schedule: { when: '18 Jun, 15:00', who: 'Vikram Joshi', mode: 'Teams' }, feedback: { by: 'Vikram Joshi', rec: 'Approve', avg: 4.4, note: 'Clean component design.' }, emails: ['Outcome email → candidate + vendor'] },
      hr: { outcome: 'approved', when: '24 Jun', by: 'Nisha (RT)', schedule: { when: '23 Jun, 10:00', who: 'Nisha (RT)', mode: 'Teams' }, feedback: { by: 'Nisha (RT)', rec: 'Approve', avg: 4.3, note: 'Strong communication, clear on relocation.' }, emails: ['Outcome email → candidate + vendor'] },
      docs: { outcome: 'approved', when: '01 Jul', by: 'Anita', note: 'All documents verified', requested: true, checklist: [
        { name: 'Govt ID (Aadhaar/PAN)', status: 'verified' }, { name: 'Education certificates', status: 'verified' },
        { name: 'Experience / relieving letters', status: 'verified' }, { name: 'Last 3 payslips', status: 'verified' },
      ], emails: ['Document request → candidate only (vendor not copied — PII, Q5)'] },
      offer: { offer: { approvalStatus: 'approved', approval: 'Approved in-app by Priya (recruiter) · 18 Jul' }, emails: ['Approval request → Priya (recruiter) — daily nudge armed', 'Approved in-app by Priya (recruiter) · 18 Jul'] },
    },
  },
  {
    id: 52, name: 'Aisha Fernandes', role: 'Power BI Developer', src: 'HR', stage: 'offer', chip: 'offer_sent', age: 3,
    email: 'aisha.fernandes@gmail.com',
    screening: { jdMatch: 83, when: '25 May', by: 'Priya' },
    rounds: {
      zeko_hr: { outcome: 'approved', when: '27 May', by: 'Anita', zeko: { interview: 84, communication: 86 }, emails: ['Outcome email — delivered'] },
      assessment: { outcome: 'approved', when: '29 May', by: 'Priya', iq: 80, tech: 82, testDate: '28 May', importedFrom: 'Evalground_Results_01Jul2026.csv', emails: ['Outcome email — delivered'] },
      zeko_fn: { outcome: 'approved', when: '30 May', by: 'Anita', zeko: { interview: 82, communication: 84 }, emails: ['Outcome email — delivered'] },
      tech1: { outcome: 'approved', when: '02 Jun', by: 'Priya', schedule: { when: '01 Jun, 10:00', who: 'Vikram Joshi', mode: 'Teams' }, feedback: { by: 'Vikram Joshi', rec: 'Approve', avg: 4.2, note: 'Strong DAX + modelling.' }, emails: ['Outcome email — delivered'] },
      tech2: { outcome: 'approved', when: '07 Jun', by: 'Anita', schedule: { when: '06 Jun, 15:00', who: 'Deepa Rao', mode: 'Teams' }, feedback: { by: 'Deepa Rao', rec: 'Approve', avg: 4.3, note: 'Ready for HR.' }, emails: ['Outcome email — delivered'] },
      hr: { outcome: 'approved', when: '12 Jun', by: 'Nisha (RT)', schedule: { when: '11 Jun, 10:00', who: 'Nisha (RT)', mode: 'Teams' }, feedback: { by: 'Nisha (RT)', rec: 'Approve', avg: 4.2, note: 'Good fit, aligned on expectations.' }, emails: ['Outcome email — delivered'] },
      docs: { outcome: 'approved', when: '19 Jun', by: 'Anita', note: 'All documents verified', requested: true, checklist: [
        { name: 'Govt ID (Aadhaar/PAN)', status: 'verified' }, { name: 'Education certificates', status: 'verified' },
        { name: 'Experience / relieving letters', status: 'verified' }, { name: 'Last 3 payslips', status: 'verified' },
      ], emails: ['Document request — completed'] },
      offer: { status: 'offer_sent', offer: { approvalStatus: 'approved', approval: 'Approved in-app by Priya (recruiter) · 10 Jul', file: 'Offer_AishaFernandes_PBI.pdf', shared: '12 Jul 2026', join: '10 Aug 2026', decision: 'Accepted' }, emails: ['Approval request → Priya (recruiter) — daily nudge armed', 'Approved in-app by Priya (recruiter) · 10 Jul', 'Offer shared offline by HR — recorded in ATS 12 Jul', 'Candidate accepted the offer — 15 Jul'] },
    },
  },
];

const FUNNEL = [
  ['HR Screening (Zeko)', 40], ['IQ / Tech Assessment', 34], ['Functional (Zeko)', 29],
  ['Tech Round 1', 21], ['Tech Round 2', 14], ['HR Round', 8],
  ['CEO / Final', 5], ['Offer', 3],
];

/** Analytics-tile config for CandidatePipelineAnalyticsPreview — shared
 * KpiCard styling (animated count-up, glow, hover lift), same as
 * Dashboard.jsx / VendorDashboard.jsx, instead of plain Statistic boxes. */
const PIPELINE_TILES = [
  { key: 'active', label: 'Active in pipeline', value: 52, icon: <TeamOutlined />, color: 'var(--gold, #7a922e)', tint: 'rgba(122, 146, 46, 0.12)', accent: 'linear-gradient(90deg, #7a922e, #92a63c)' },
  { key: 'pending', label: 'Invite pending', value: 5, icon: <MailOutlined />, color: '#6b7280', tint: 'rgba(107, 114, 128, 0.12)', accent: 'linear-gradient(90deg, #6b7280, #9198a3)' },
  { key: 'awaiting', label: 'In progress (interview / Zeko / test)', value: 6, icon: <ClockCircleOutlined />, color: '#d4a017', tint: 'rgba(212, 160, 23, 0.12)', accent: 'linear-gradient(90deg, #d4a017, #e8b93a)' },
  { key: 'ready', label: 'Ready for decision (feedback / score / result in)', value: 13, icon: <CheckCircleOutlined />, color: '#27ae60', tint: 'rgba(39, 174, 96, 0.12)', accent: 'linear-gradient(90deg, #27ae60, #4a7c59)' },
  { key: 'hold', label: 'On hold', value: 5, icon: <PauseCircleOutlined />, color: '#8b938a', tint: 'rgba(139, 147, 138, 0.14)', accent: 'linear-gradient(90deg, #8b938a, #aeb5ab)' },
  { key: 'offers', label: 'Offers awaiting candidate decision', value: 1, icon: <FileTextOutlined />, color: '#185fa5', tint: 'rgba(24, 95, 165, 0.12)', accent: 'linear-gradient(90deg, #185fa5, #2f78c9)' },
];

/**
 * CandidatePipelineAnalyticsPreview — the pipeline analytics tab content (mock data).
 * Rendered inside the EXISTING Analytics page (single analytics page — RT
 * decision 2026-07-10). Exported separately so Analytics.jsx can mount it as
 * a tab; delete together with this prototype when the real Tracker ships.
 */
export function CandidatePipelineAnalyticsPreview() {
  return (
    <>
      <Alert type="warning" showIcon style={{ marginBottom: 14 }}
        message="Preview — mock data from the Pipeline Tracker prototype; becomes live pipeline analytics in Phase 3 Module 1." />
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        {PIPELINE_TILES.map((t, i) => (
          <Col xs={12} sm={12} md={8} lg={PIPELINE_TILES.length >= 4 ? 6 : 8} key={t.key}>
            <KpiCard index={i} icon={t.icon} label={t.label} value={t.value} color={t.color} tint={t.tint} accent={t.accent} />
          </Col>
        ))}
      </Row>
      <Card title="Stage funnel — Senior .NET Developer (MRF-2031)" style={{ marginBottom: 16 }}>
        <Space direction="vertical" size={7} style={{ width: '100%' }}>
          {FUNNEL.map(([name, v], i) => (
            <Row key={name} gutter={10} align="middle" wrap={false}>
              <Col flex="180px" style={{ textAlign: 'right' }}><Text type="secondary" style={{ fontSize: 12.5 }}>{name}</Text></Col>
              <Col flex="auto">
                <Tooltip title={`${v} candidates${i ? ` · ${Math.round((v / FUNNEL[i - 1][1]) * 100)}% of previous round` : ''}`}>
                  <div style={{ height: 20, width: `${Math.max((v / FUNNEL[0][1]) * 100, 2)}%`, background: 'var(--gold, #7a922e)', borderRadius: '0 4px 4px 0', opacity: 0.88 }} />
                </Tooltip>
              </Col>
              <Col flex="110px"><Text strong>{v}</Text>{i > 0 && <Text type="secondary" style={{ fontSize: 12 }}> · {Math.round((v / FUNNEL[i - 1][1]) * 100)}%</Text>}</Col>
            </Row>
          ))}
        </Space>
      </Card>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title="Stuck candidates" extra={<Text type="secondary" style={{ fontSize: 12 }}>needs action</Text>}>
            <Table size="small" pagination={false} rowKey="k"
              columns={[
                { title: 'Candidate', dataIndex: 'n' }, { title: 'Round', dataIndex: 's' },
                { title: 'Days', dataIndex: 'd', width: 60 },
                {
                  title: 'Blocked on', dataIndex: 'b', render: (b, row) => (
                    <Space direction="vertical" size={2}>
                      <Tag color="gold" className="tag-attention" style={{ marginInlineEnd: 0 }}>{b}</Tag>
                      <Text type="secondary" style={{ fontSize: 11.5 }}>
                        <RobotOutlined style={{ marginInlineEnd: 4 }} />{row.ai}
                      </Text>
                    </Space>
                  ),
                },
              ]}
              dataSource={[
                { k: 1, n: 'Ravi Shankar', s: 'Tech Round 1', d: 12, b: 'Awaiting feedback — Suresh M.', ai: 'Suresh usually replies in 2 days — 6× over his norm; try a direct nudge instead of the daily reminder.' },
                { k: 2, n: 'Meena Iyer', s: 'IQ / Tech Assessment', d: 11, b: 'Evalground result not imported', ai: 'No CSV import has landed since the test date — check whether Evalground actually has a result yet.' },
                { k: 3, n: 'Farhan Ali', s: 'On Hold (Zeko HR)', d: 34, b: 'Manual hold review', ai: 'Longest-held candidate on the board (34d, 3× the median hold) — due for a manual review.' },
              ]} />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="Rejection reasons — last 30 days" extra={<Text type="secondary" style={{ fontSize: 12 }}>new in Phase 3</Text>}>
            <Table size="small" pagination={false} rowKey="r"
              columns={[
                { title: 'Reason', dataIndex: 'r' }, { title: 'Count', dataIndex: 'c', width: 70 },
                { title: 'Most common round', dataIndex: 's' },
              ]}
              dataSource={[
                { r: 'Skills mismatch', c: 9, s: 'HR Screening (Zeko)' },
                { r: 'High salary expectation', c: 6, s: 'HR Round' },
                { r: 'Weak communication', c: 4, s: 'HR Screening (Zeko)' },
                { r: 'Failed assessment threshold', c: 3, s: 'IQ / Tech Assessment' },
                { r: 'Unresponsive / no-show', c: 2, s: 'Tech Round 1' },
              ]} />
          </Card>
        </Col>
      </Row>
    </>
  );
}

/* -------------------------------------------------------------- helpers */

const ageColor = (d) => (d <= 5 ? 'green' : d <= 10 ? 'gold' : 'red');
const mailAudience = (c) => (c.src === 'Vendor' ? `candidate + ${c.vendor}` : 'candidate');
const sourceLabel = (c) => (c.src === 'Vendor' ? c.vendor : c.src === 'HR' ? 'HR upload' : 'Email intake');

/** Left-border accent per chip — a colour a recruiter can scan for without
 * reading the tag text (green = act now, gold = in motion, grey = not
 * started, blue = booked). */
const CHIP_ACCENT = {
  pending: '#c9cdc7', review: '#c9cdc7', invited: '#5b7ff0', scheduled: '#5b7ff0',
  await: '#d4a017', feedback: '#27ae60', hold: '#d4a017', docs: '#5b7ff0', offer_sent: '#5b7ff0',
};

const AVATAR_PALETTE = ['#7a922e', '#2f54eb', '#13c2c2', '#eb2f96', '#d4a017', '#4a7c59'];
const initials = (name) => name.split(' ').filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const avatarColor = (name) => AVATAR_PALETTE[[...name].reduce((a, ch) => a + ch.charCodeAt(0), 0) % AVATAR_PALETTE.length];
const fmtWindow = (w) => (w ? `${dayjs(w.start).format('DD MMM, HH:mm')}–${dayjs(w.end).format('HH:mm')}` : '');
const scoreTier = (v) => (v >= 70 ? 'good' : v >= 50 ? 'mid' : 'low');

/** v11 — the pipeline the recruiter actually sees: same shape for every
 * round type (RT's own words), worded for what really happens in that
 * round kind rather than one generic vocabulary forced onto all of them. */
const PIPELINE_LABELS = {
  zeko: ['Invite Sent', 'Awaiting Interview', 'Awaiting Results', 'Approve / Reject'],
  assessment: ['Invite Sent', 'Awaiting Test', 'Awaiting Results', 'Approve / Reject'],
  interview: ['Invite Sent', 'Awaiting Interview', 'Awaiting Results', 'Approve / Reject'],
  docs: ['Request Sent', 'Awaiting Upload', 'Awaiting Verification', 'Approve / Reject'],
  offer: ['Offer Prepared', 'Offer Sent', 'Awaiting Response', 'Accepted / Declined'],
};
const STATE_WORD = { pending: 'Not started yet', active: 'In progress', done: 'Done', hold: 'On Hold', rejected: 'Rejected' };

/**
 * v11 — derives the 4-stage pipeline for a round: Invite Sent / Awaiting
 * Interview (or Test/Upload/Response) / Awaiting Results (or Verification)
 * / Approve-Reject (or Accepted/Declined for Offer) — RT's own naming for
 * "the crucial part of the app." Each stage carries a `detail` sentence
 * that is never trimmed (used verbatim, always visible — no click needed)
 * and, where relevant, `chips` (score numbers) or a `note` (free-text
 * context that would otherwise be dropped). Previously (v9/v10) this was
 * Entry/Schedule/Outcome/Decision — Entry (how the candidate arrived) is
 * no longer its own stage; that context is one click away in the previous
 * round's own Decision stage instead of repeating in every round.
 */
function roundProgressSegments(c, stageKey = c.stage) {
  const stage = STAGES[stageIdx(stageKey)];
  const round = c.rounds[stageKey] || {};
  const labels = PIPELINE_LABELS[stage.type];
  let s1 = { state: 'pending', detail: 'Not sent yet' };
  let s2 = { state: 'pending', detail: 'Not started yet' };
  let s3 = { state: 'pending', detail: 'Not started yet' };
  let s4 = { state: 'pending', detail: 'Not yet' };

  if (stage.type === 'zeko' || stage.type === 'assessment') {
    const isZeko = stage.type === 'zeko';
    const invited = round.status === 'invited' || round.status === 'in_progress' || round.zeko || round.importedFrom || round.testDate;
    if (invited) {
      s1 = { state: 'done', detail: isZeko ? `Zeko ${stage.key === 'zeko_fn' ? 'functional' : 'HR'} screening invite emailed to ${mailAudience(c)}` : `Assessment invite (GA + Technical) emailed to ${mailAudience(c)}` };
    }
    if (isZeko) {
      if (round.zeko) s2 = { state: 'done', detail: 'Completed — score synced automatically from Zeko' };
      else if (round.status === 'in_progress') s2 = { state: 'active', detail: round.note || 'Candidate has started the test — in progress' };
      else if (round.zekoWindow) s2 = { state: 'active', detail: `Self-schedule window · ${fmtWindow(round.zekoWindow)}` };
      else if (invited) s2 = { state: 'active', detail: 'Awaiting candidate to start the test' };
    } else {
      if (round.testDate) s2 = { state: 'done', detail: `Taken ${round.testDate}` };
      else if (round.deadline) s2 = { state: 'active', detail: `Awaiting candidate — deadline ${round.deadline}` };
      else if (invited) s2 = { state: 'active', detail: 'Awaiting candidate to take the test' };
    }
    if (isZeko && round.zeko) {
      s3 = {
        state: 'done',
        detail: `Interview ${round.zeko.interview} · Communication ${round.zeko.communication}`,
        chips: [{ value: round.zeko.interview, label: 'Interview' }, { value: round.zeko.communication, label: 'Comms' }],
      };
    } else if (!isZeko && round.importedFrom) {
      s3 = {
        state: 'done',
        detail: `IQ ${round.iq}% · Technical ${round.tech}%${round.note ? ` — ${round.note}` : ''}`,
        chips: [{ value: round.iq, label: 'IQ' }, { value: round.tech, label: 'Technical' }],
      };
    } else if (!isZeko && round.testDate) {
      s3 = { state: 'active', detail: round.note || 'Test attempted — result awaited in the next Evalground import' };
    } else if (s2.state !== 'pending') {
      s3 = { state: 'active', detail: isZeko ? 'Awaiting Zeko to sync the score' : 'Awaiting the candidate to take the test' };
    }
  } else if (stage.type === 'interview') {
    const selfSchedule = round.status === 'invited' && !round.schedule;
    if (round.schedule) s1 = { state: 'done', detail: `${round.schedule.mode === 'Client call' ? 'Client call' : 'Teams'} invite sent for ${round.schedule.when}` };
    else if (selfSchedule) s1 = { state: 'done', detail: 'Self-scheduling link emailed to candidate' };
    if (round.schedule) s2 = { state: 'done', detail: `${round.schedule.mode === 'Client call' ? 'Client call' : 'Teams'} · ${round.schedule.when} with ${round.schedule.who}` };
    else if (selfSchedule) s2 = { state: 'active', detail: '3 slots published — awaiting candidate to pick one' };
    if (round.feedback) {
      s3 = { state: 'done', detail: `${round.feedback.rec} · ${round.feedback.avg}/5 — "${round.feedback.note}"` };
    } else if (round.status === 'await') {
      s3 = { state: 'active', detail: `Awaiting interviewer feedback${round.remindersSent ? ` — ${round.remindersSent} reminder(s) sent` : ''}` };
    } else if (round.schedule) {
      // Any scheduled-but-not-yet-await status (e.g. mock rows just marked
      // 'scheduled') still means feedback is the thing pending — the
      // scorecard action below keys off `round.schedule`, not this exact
      // status string, so it must stay available here too.
      s3 = { state: 'active', detail: 'Interview scheduled — awaiting interviewer feedback' };
    }
    if (round.note && !round.outcome) {
      if (s1.state === 'pending') s1 = { ...s1, note: round.note };
      else s2 = { ...s2, note: round.note };
    }
  } else if (stage.type === 'docs') {
    if (round.requested) s1 = { state: 'done', detail: `Document request emailed to ${c.src === 'Vendor' ? 'candidate (vendor not copied — PII)' : 'candidate'}` };
    const checklist = round.checklist || [];
    const uploadedCount = checklist.filter((d) => d.status !== 'pending').length;
    const verifiedCount = checklist.filter((d) => d.status === 'verified').length;
    const anyRejected = checklist.some((d) => d.status === 'rejected');
    if (round.requested) {
      s2 = uploadedCount === 0
        ? { state: 'active', detail: 'No uploads yet' }
        : { state: 'done', detail: `${uploadedCount} of ${checklist.length} documents uploaded` };
    }
    if (uploadedCount > 0) {
      s3 = verifiedCount === checklist.length
        ? { state: 'done', detail: 'All documents verified' }
        : { state: 'active', detail: `${verifiedCount} of ${checklist.length} verified${anyRejected ? ' — 1 rejected, re-requested' : ''}` };
    }
  } else if (stage.type === 'offer') {
    const off = round.offer;
    if (off) s1 = { state: off.approvalStatus === 'pending' ? 'active' : 'done', detail: off.approvalStatus === 'pending' ? 'Requested — awaiting recruiter sign-off' : `Approved internally${off.approval ? ` — ${off.approval}` : ''}` };
    if (off && off.approvalStatus !== 'pending') {
      s2 = off.shared ? { state: 'done', detail: `Shared ${off.shared} — proposed joining ${off.join}` } : { state: 'active', detail: 'Approved — not yet shared with candidate' };
    }
    if (off?.shared) {
      s3 = off.decision === 'Awaiting decision' ? { state: 'active', detail: 'Awaiting candidate decision' } : { state: 'done', detail: `Response received: ${off.decision}` };
    }
  }

  if (stage.type === 'offer') {
    const off = round.offer;
    if (off?.decision === 'Accepted') s4 = { state: 'done', detail: 'Accepted — candidate confirmed joining' };
    else if (off?.decision && off.decision !== 'Awaiting decision') s4 = { state: 'rejected', detail: `Declined — ${off.decision}` };
    else if (off?.shared) s4 = { state: 'active', detail: 'Awaiting candidate response' };
  } else if (round.outcome === 'approved') {
    s4 = { state: 'done', detail: `Approved${round.by ? ` by ${round.by}` : ''}${round.when ? ` · ${round.when}` : ''}` };
    if (round.note && stage.type !== 'assessment') s4.note = round.note;
  } else if (round.outcome === 'hold') {
    s4 = { state: 'hold', detail: `${round.reason || 'On Hold'}${round.by ? ` · flagged by ${round.by}` : ''}${round.when ? ` · ${round.when}` : ''}` };
    if (round.note && stage.type !== 'assessment') s4.note = round.note;
  } else if (s3.state === 'done') {
    s4 = { state: 'active', detail: 'Awaiting your decision' };
  }

  return [
    { key: 'invite', label: labels[0], ...s1 },
    { key: 'wait', label: labels[1], ...s2 },
    { key: 'results', label: labels[2], ...s3 },
    { key: 'decision', label: labels[3], ...s4 },
  ];
}

/**
 * Mocked NL → filter resolver for the board search box (v5). Keyword-matches
 * against the same Role/Source/Hold/Stuck filters the dropdowns already set —
 * there is no real model call here, just enough pattern matching to make the
 * "Read as: …" line honest about what it did.
 */
const ROLE_LIST = [...new Set(INITIAL_CANDIDATES.map((c) => c.role))];
const SRC_LABEL = { Vendor: 'Placement vendor', HR: 'HR upload', Email: 'Email intake' };
function parseNlQuery(text) {
  const lower = text.toLowerCase();
  let role;
  for (const r of ROLE_LIST) {
    const words = r.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    if (lower.includes(r.toLowerCase()) || words.some((w) => lower.includes(w))) { role = r; break; }
  }
  let src;
  if (/\bvendor\b/.test(lower)) src = 'Vendor';
  else if (/\bhr\b/.test(lower)) src = 'HR';
  else if (/\bemail\b/.test(lower)) src = 'Email';
  const hold = /\bhold\b/.test(lower);
  const stuck = /\bstuck\b|\bblocked\b|\boverdue\b|\baging\b|\blong\b/.test(lower);
  const read = [
    role && `Position = "${role}"`,
    src && `Source = ${SRC_LABEL[src]}`,
    hold && 'On Hold only',
    stuck && 'Stuck > 10 days',
  ].filter(Boolean);
  return { role, src, hold, stuck, read: read.length ? read.join(' · ') : 'No filters matched — showing all candidates' };
}

/**
 * v6 — editable outcome-email drafts for the decision modal. Hold/Reject map
 * to real templates in seed-email-templates.js; Approve has no template yet
 * (flagged gap — an editable draft is shown instead, tagged accordingly).
 */
function emailDraftFor(outcomeVal, cand, stage) {
  if (!cand) return { subject: '', body: '', tpl: null };
  const position = cand.role;
  if (outcomeVal === 'hold') {
    return {
      subject: 'Application on Hold - AAPNA Infotech',
      body: `Dear ${cand.name},\n\nThank you for your continued interest in the ${position} position at AAPNA Infotech.\n\nYour application is currently on hold while we complete our ${stage.name} review. We will reach out with an update as soon as possible.\n\nWe appreciate your patience.\n\nRegards,\nAAPNA Recruitment Team`,
      tpl: { id: 18, name: 'Application On Hold' },
    };
  }
  if (outcomeVal === 'rejected') {
    return {
      subject: 'Update on Your Application - AAPNA Infotech',
      body: `Dear ${cand.name},\n\nAfter careful consideration of your profile, we regret to inform you that we are unable to move forward with your application for ${position} at this time.\n\nWe truly appreciate the time and effort you invested in our process. We will keep your profile on file and encourage you to apply for future opportunities.\n\nWe wish you all the best in your career journey.\n\nRegards,\nAAPNA Recruitment Team`,
      tpl: { id: 4, name: 'Rejection — Post Interview' },
    };
  }
  const next = STAGES[Math.min(stageIdx(stage.key) + 1, STAGES.length - 1)];
  return {
    subject: `You're moving forward — ${position} at AAPNA Infotech`,
    body: `Dear ${cand.name},\n\nGreat news — you've cleared ${stage.name}. We're moving your application forward to ${next.name}.\n\nWe'll be in touch shortly with next steps.\n\nRegards,\nAAPNA Recruitment Team`,
    tpl: null,
  };
}

function closureEmailDraft(cand, status) {
  if (!cand) return { subject: '', body: '' };
  return {
    subject: `Your candidature update — ${cand.role} at AAPNA Infotech`,
    body: `Dear ${cand.name},\n\nThis is to confirm your candidature status for ${cand.role} has been recorded as: ${status}.\n\nThank you for the time you invested throughout our process.\n\nRegards,\nAAPNA Recruitment Team`,
  };
}

function SourceTag({ c }) {
  if (c.src === 'Vendor') return <Tag color="green">V · {c.vendor}</Tag>;
  return <Tag>{c.src === 'HR' ? 'HR upload' : 'Email intake'}</Tag>;
}
function AlsoActiveTag({ c }) {
  if (!c.also) return null;
  return (
    <Tooltip title={`Also active in a second journey: ${c.also}. Concurrent MRFs are allowed (Q13) — each journey moves independently.`}>
      <Tag color="purple">2 MRFs</Tag>
    </Tooltip>
  );
}
function ChipTag({ chip }) {
  const m = CHIP[chip];
  return m ? <Tag color={m.color}>{m.label}</Tag> : null;
}

const DOC_TAG = {
  verified: { label: 'Verified', color: 'green' },
  uploaded: { label: 'Uploaded — review', color: 'blue' },
  rejected: { label: 'Rejected — re-requested', color: 'red' },
  pending: { label: 'Not requested', color: 'default' },
};

/* ----------------------------------------------------------------- page */

export default function CandidatePipelinePrototype() {
  const { message } = AntApp.useApp();
  const [candidates, setCandidates] = useState(INITIAL_CANDIDATES);
  const [openId, setOpenId] = useState(null);
  const [selectedRound, setSelectedRound] = useState(0);
  const [celebrate, setCelebrate] = useState(false);

  const [fRole, setFRole] = useState();
  const [fSrc, setFSrc] = useState();
  const [fHold, setFHold] = useState(false);
  const [fStuck, setFStuck] = useState(false);
  const [nlQuery, setNlQuery] = useState('');
  const [nlRead, setNlRead] = useState(null);

  const [outcomeOpen, setOutcomeOpen] = useState(false);
  const [outcome, setOutcome] = useState('approved');
  const [reason, setReason] = useState();
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [emailTpl, setEmailTpl] = useState(null);
  const [schedOpen, setSchedOpen] = useState(false);
  const [schedMode, setSchedMode] = useState('fixed');
  const [prepBriefOn, setPrepBriefOn] = useState(true);
  const [zekoSchedOpen, setZekoSchedOpen] = useState(false);
  const [zekoRange, setZekoRange] = useState(null);
  const [assessSchedOpen, setAssessSchedOpen] = useState(false);
  const [assessDeadline, setAssessDeadline] = useState(null);
  const [cardOpen, setCardOpen] = useState(false);
  const [cardRec, setCardRec] = useState('Approve');
  const [importOpen, setImportOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeStatus, setCloseStatus] = useState('Joined');
  const [closeSubject, setCloseSubject] = useState('');
  const [closeBody, setCloseBody] = useState('');

  const current = candidates.find((c) => c.id === openId) || null;
  const currentIdx = current ? stageIdx(current.stage) : 0;

  const openOutcomeModal = (val) => {
    setOutcome(val);
    setReason(undefined);
    if (current) {
      const draft = emailDraftFor(val, current, STAGES[currentIdx]);
      setEmailSubject(draft.subject);
      setEmailBody(draft.body);
      setEmailTpl(draft.tpl);
    }
    setOutcomeOpen(true);
  };

  const filtered = useMemo(
    () => candidates.filter((c) =>
      (!fRole || c.role === fRole) &&
      (!fSrc || c.src === fSrc) &&
      (!fHold || c.chip === 'hold') &&
      (!fStuck || c.age > 10)),
    [candidates, fRole, fSrc, fHold, fStuck],
  );
  const roles = [...new Set(INITIAL_CANDIDATES.map((c) => c.role))];

  const openCandidate = (id) => {
    const c = candidates.find((x) => x.id === id);
    setOpenId(id);
    setSelectedRound(c ? stageIdx(c.stage) : 0);
  };

  const patchCurrent = (patch) => setCandidates((prev) => prev.map((c) => (c.id === openId ? { ...c, ...patch } : c)));

  /* ---- actions (current round only) ---- */

  const saveOutcome = () => {
    if (!current) return;
    const stage = STAGES[currentIdx];
    const mailTo = mailAudience(current);
    const round = current.rounds[stage.key] || {};
    const emailLog = `"${emailSubject}" → ${mailTo}${emailTpl ? ` (template: ${emailTpl.name} #${emailTpl.id}, edited before send)` : ' (draft — no template yet, edited before send)'}`;
    if (outcome === 'approved') {
      const next = STAGES[Math.min(currentIdx + 1, STAGES.length - 1)];
      patchCurrent({
        stage: next.key, chip: 'review', age: 0,
        rounds: {
          ...current.rounds,
          [stage.key]: { ...round, status: undefined, outcome: 'approved', when: 'just now', by: 'You', emails: [...(round.emails || []), `Outcome email ${emailLog}`] },
          [next.key]: current.rounds[next.key] || { status: 'review' },
        },
      });
      setSelectedRound(Math.min(currentIdx + 1, STAGES.length - 1));
      message.success(`${stage.name} approved — email sent to ${mailTo}; candidate moved to ${next.name}`);
      setCelebrate(true);
      setTimeout(() => setCelebrate(false), 900);
    } else if (outcome === 'hold') {
      patchCurrent({
        chip: 'hold',
        rounds: { ...current.rounds, [stage.key]: { ...round, status: undefined, outcome: 'hold', reason, when: 'just now', by: 'You', emails: [...(round.emails || []), `On-hold email ${emailLog}`] } },
      });
      message.warning(`Put on hold — reason captured; email sent to ${mailTo}`);
    } else {
      setCandidates((prev) => prev.filter((c) => c.id !== current.id));
      setOpenId(null);
      message.error(`${current.name} rejected at ${stage.name} — “${reason}”; email sent to ${mailTo}`);
    }
    setOutcomeOpen(false);
    setReason(undefined);
  };

  const saveSchedule = () => {
    if (!current) return;
    const stage = STAGES[currentIdx];
    const round = current.rounds[stage.key] || {};
    const briefEmail = prepBriefOn ? ['AI interviewer prep brief attached — candidate summary + scores so far + suggested questions'] : [];
    if (schedMode === 'slots') {
      patchCurrent({
        chip: 'invited',
        rounds: { ...current.rounds, [stage.key]: { ...round, status: 'invited', emails: [...(round.emails || []), 'Self-scheduling link (3 published slots) → candidate', ...briefEmail] } },
      });
      setSchedOpen(false);
      message.success(`Slots published — the candidate picks one from the emailed link; the Teams invite goes out automatically on pick${prepBriefOn ? '; prep brief will attach once picked' : ''}`);
      return;
    }
    patchCurrent({
      chip: 'scheduled',
      rounds: { ...current.rounds, [stage.key]: { ...round, status: 'scheduled', schedule: { when: '13 Jul, 11:00', who: 'Suresh Menon', mode: 'Teams' }, emails: [...(round.emails || []), 'Outlook invite (Teams) — sent; reminders armed', ...briefEmail] } },
    });
    setSchedOpen(false);
    message.success(`Teams invite created — candidate & interviewer notified; reminders scheduled${prepBriefOn ? '; AI prep brief attached for the interviewer' : ''}`);
  };

  const submitScorecard = () => {
    if (current) {
      const stage = STAGES[currentIdx];
      const round = current.rounds[stage.key] || {};
      patchCurrent({
        chip: 'feedback',
        rounds: { ...current.rounds, [stage.key]: { ...round, status: 'review', feedback: { by: round.schedule?.who || 'Interviewer', rec: cardRec, avg: 3.7, note: 'Submitted via tokenized link — no ATS login.' } } },
      });
    }
    setCardOpen(false);
    message.success('Feedback submitted — RT can now record the round outcome');
  };

  /* §5 — Zeko invite now schedules a real interview window (mirrors
     AnalyticsLegacy's "Schedule Zeko Interview" modal) instead of firing
     a bare invite with no scheduling data. */
  const sendZekoInvite = () => {
    if (!current) return;
    setZekoRange(null);
    setZekoSchedOpen(true);
  };

  const confirmZekoSchedule = () => {
    if (!current || !zekoRange || !zekoRange[0] || !zekoRange[1]) return;
    const stage = STAGES[currentIdx];
    const round = current.rounds[stage.key] || {};
    const zekoLabel = stage.key === 'zeko_fn' ? 'functional' : 'HR';
    const zekoWindow = { start: zekoRange[0].toISOString(), end: zekoRange[1].toISOString() };
    patchCurrent({
      chip: 'invited',
      rounds: { ...current.rounds, [stage.key]: { ...round, status: 'invited', zekoWindow, emails: [...(round.emails || []), `Zeko ${zekoLabel} screening invite → ${mailAudience(current)} · self-schedule window ${fmtWindow(zekoWindow)}`] } },
    });
    setZekoSchedOpen(false);
    message.success('Zeko interview scheduled — invite emailed with the self-schedule window');
  };

  const sendAssessmentInvite = () => {
    if (!current) return;
    setAssessDeadline(null);
    setAssessSchedOpen(true);
  };

  const confirmAssessmentInvite = () => {
    if (!current || !assessDeadline) return;
    const stage = STAGES[currentIdx];
    const round = current.rounds[stage.key] || {};
    const deadline = assessDeadline.format('DD MMM YYYY');
    patchCurrent({
      chip: 'invited',
      rounds: { ...current.rounds, [stage.key]: { ...round, status: 'invited', deadline, emails: [...(round.emails || []), `Assessment invite (GA + Technical) → ${mailAudience(current)} · deadline ${deadline}`] } },
    });
    setAssessSchedOpen(false);
    message.success('Assessment invite sent — candidate notified with the completion deadline');
  };

  const sendDocumentRequest = () => {
    if (!current) return;
    const round = current.rounds.docs || {};
    patchCurrent({
      chip: 'docs',
      rounds: {
        ...current.rounds,
        docs: {
          ...round, requested: true,
          checklist: [
            { name: 'Govt ID (Aadhaar/PAN)', status: 'pending' },
            { name: 'Education certificates', status: 'pending' },
            { name: 'Experience / relieving letters', status: 'pending' },
            { name: 'Last 3 payslips', status: 'pending' },
          ],
          emails: [...(round.emails || []), 'Document request sent — secure upload link emailed to the candidate (vendor not copied)'],
        },
      },
    });
    message.success('Document request sent — secure upload link emailed to the candidate (vendor not copied)');
  };

  const requestOfferApproval = () => {
    if (!current) return;
    const round = current.rounds.offer || {};
    patchCurrent({
      chip: 'await',
      rounds: { ...current.rounds, offer: { ...round, offer: { approvalStatus: 'pending' }, emails: [...(round.emails || []), 'Approval request → Priya (recruiter) — daily nudge armed'] } },
    });
    message.success('Approval requested — daily nudge armed until approved');
  };

  const recordOfferShared = () => {
    if (!current) return;
    const round = current.rounds.offer || {};
    patchCurrent({
      chip: 'offer_sent',
      rounds: {
        ...current.rounds,
        offer: {
          ...round,
          offer: { ...round.offer, shared: dayjs().format('DD MMM YYYY'), join: dayjs().add(28, 'day').format('DD MMM YYYY'), decision: 'Awaiting decision' },
          emails: [...(round.emails || []), 'Offer shared offline by HR — recorded in ATS'],
        },
      },
    });
    message.success('Offer shared recorded — candidate decision tracking begins');
  };

  /* ---- board ---- */

  const renderCard = (c) => {
    const chipMeta = CHIP[c.chip];
    const segs = roundProgressSegments(c);
    const segTooltip = segs.map((s) => `${s.label}: ${s.detail}`).join(' · ');
    return (
      <Card key={c.id} size="small" hoverable onClick={() => openCandidate(c.id)}
        className="cp-candidate-card"
        styles={{ body: { padding: '9px 11px' } }}
        style={{ marginBottom: 8, borderInlineStart: `3px solid ${CHIP_ACCENT[c.chip] || 'var(--border)'}` }}>
        <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
          <div className="cp-avatar" style={{ background: avatarColor(c.name) }}>{initials(c.name)}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
              <Text strong style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</Text>
              <Tooltip title="Days in current round">
                {c.age > 10
                  ? <Tag color="red" className="tag-attention" style={{ marginInlineEnd: 0, fontSize: 10.5, lineHeight: '16px' }}>{c.age}d</Tag>
                  : <Text type="secondary" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{c.age}d</Text>}
              </Tooltip>
            </div>
            <Text type="secondary" style={{ fontSize: 11.5, display: 'block', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {c.role} · {sourceLabel(c)}
            </Text>
            <Space size={4} wrap style={{ marginBottom: 7 }}>
              {chipMeta && <Tag color={chipMeta.color} style={{ fontSize: 11, marginInlineEnd: 0 }}>{chipMeta.label}</Tag>}
              <AlsoActiveTag c={c} />
            </Space>
            <Tooltip title={segTooltip}>
              <div style={{ display: 'flex', gap: 3 }} aria-label={segTooltip}>
                {segs.map((s) => <div key={s.key} className={`cp-progress-seg cp-progress-seg--${s.state}`} />)}
              </div>
            </Tooltip>
          </div>
        </div>
      </Card>
    );
  };

  const handleNlSearch = (text) => {
    setNlQuery(text);
    if (!text.trim()) { setNlRead(null); setFRole(undefined); setFSrc(undefined); setFHold(false); setFStuck(false); return; }
    const parsed = parseNlQuery(text);
    setFRole(parsed.role);
    setFSrc(parsed.src);
    setFHold(parsed.hold);
    setFStuck(parsed.stuck);
    setNlRead(parsed.read);
  };

  const board = (
    <>
      <Input.Search allowClear placeholder='Ask the board — e.g. "vendor candidates stuck on hold" (mocked keyword matching)'
        prefix={<RobotOutlined style={{ color: 'var(--gold, #7a922e)' }} />}
        style={{ maxWidth: 520, marginBottom: 8 }} value={nlQuery}
        onChange={(e) => { setNlQuery(e.target.value); if (!e.target.value.trim()) handleNlSearch(''); }}
        onSearch={handleNlSearch} enterButton={<SearchOutlined />} />
      {nlRead && (
        <div style={{ marginBottom: 10 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            <RobotOutlined style={{ marginInlineEnd: 4 }} />Read as: {nlRead}
          </Text>
        </div>
      )}
      <Space wrap style={{ marginBottom: 14 }}>
        <Select allowClear placeholder="Position" style={{ minWidth: 200 }} value={fRole}
          onChange={setFRole} options={roles.map((r) => ({ value: r, label: r }))} />
        <Select allowClear placeholder="Source" style={{ minWidth: 160 }} value={fSrc}
          onChange={setFSrc}
          options={[{ value: 'HR', label: 'HR upload' }, { value: 'Vendor', label: 'Placement vendor' }, { value: 'Email', label: 'Email intake' }]} />
        <Checkbox checked={fHold} onChange={(e) => setFHold(e.target.checked)}>On Hold only</Checkbox>
        <Checkbox checked={fStuck} onChange={(e) => setFStuck(e.target.checked)}>Stuck &gt; 10 days</Checkbox>
        <Text type="secondary">{filtered.length} of {candidates.length} candidates</Text>
      </Space>
      <div className="stagger-children" style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 16, alignItems: 'flex-start' }}>
        {STAGES.map((st) => {
          const list = filtered.filter((c) => c.stage === st.key);
          return (
            <div key={st.key} style={{ flex: '0 0 250px' }}>
              <Card size="small"
                title={(
                  <Space size={6}>
                    <Text style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.05em' }} strong>{st.name}</Text>
                    {st.optional && <Tag style={{ fontSize: 10 }}>optional</Tag>}
                  </Space>
                )}
                extra={(
                  <Space size={6}>
                    {st.key === 'assessment' && (
                      <Tooltip title="Import Evalground results (CSV) — maps by email to candidates in this round">
                        <Button size="small" icon={<ImportOutlined />} onClick={() => setImportOpen(true)} />
                      </Tooltip>
                    )}
                    <Badge count={list.length} showZero color="var(--gold, #7a922e)" />
                  </Space>
                )}
                styles={{ body: { padding: 10, background: 'transparent' } }}
                style={{ borderTop: 0, overflow: 'hidden' }}
                >
                <div style={{ height: 3, margin: '-1px -1px 10px', background: STAGE_ACCENT[st.type] }} />
                {list.length ? list.map(renderCard) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="" style={{ margin: '4px 0' }} />}
              </Card>
            </div>
          );
        })}
      </div>
    </>
  );

  /* ---- per-round panel (RT feedback #2: one round at a time) ---- */

  const renderRoundPanel = () => {
    if (!current) return null;
    const stage = STAGES[selectedRound];
    const round = current.rounds[stage.key];
    const isCurrent = selectedRound === currentIdx;
    const outcomeInfo = round?.outcome ? OUTCOME_TAG[round.outcome] : (isCurrent ? OUTCOME_TAG.in_progress : null);
    const segs = roundProgressSegments(current, stage.key);

    /* §1 — one badge, not four competing tags; reason + timestamp collapse
       into a single muted line under the title. */
    const head = (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Space size={8}>
            <Text strong style={{ fontSize: 16 }}>{stage.name}</Text>
            {stage.optional && <Tag style={{ fontSize: 10.5 }}>optional</Tag>}
          </Space>
          {outcomeInfo && <Tag color={outcomeInfo.color} style={{ fontSize: 12, marginInlineEnd: 0 }}>{outcomeInfo.label}</Tag>}
        </div>
        {round?.when && (
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 2 }}>
            {round.reason ? `${round.reason} · ` : ''}{round.outcome ? 'Decided' : 'Updated'} {round.when}{round.by ? ` · by ${round.by}` : ''}
          </Text>
        )}
      </div>
    );

    /* §2 — per-stage interactive content (buttons/tables), keyed to the
       stage index it belongs to. Everything display-only lives in `segs`
       itself (label/state/detail/chips/note) and needs no extra JSX. */
    const extras = [null, null, null, null];
    if (round) {
      if (stage.type === 'zeko') {
        if (!round.status && !round.zeko) {
          extras[0] = isCurrent && <Button type="primary" size="small" icon={<MailOutlined />} onClick={sendZekoInvite}>Send Zeko invite</Button>;
        } else if (round.status === 'invited' && isCurrent) {
          extras[1] = <Button size="small" icon={<CalendarOutlined />} onClick={sendZekoInvite}>Change window</Button>;
        }
      } else if (stage.type === 'assessment') {
        if (!round.status && !round.testDate && !round.importedFrom) {
          extras[0] = isCurrent && <Button type="primary" size="small" icon={<MailOutlined />} onClick={sendAssessmentInvite}>Send assessment invite</Button>;
        }
        if (isCurrent) {
          extras[2] = <Button size="small" icon={<ImportOutlined />} onClick={() => setImportOpen(true)}>Import Evalground results (CSV)</Button>;
        }
      } else if (stage.type === 'interview') {
        if (isCurrent && !round.feedback) {
          // Primary action until scheduled (matches every other round type's
          // "first action" button); once scheduled, the primary path moves to
          // opening the scorecard below, so Reschedule steps back to secondary.
          extras[1] = (
            <Button size="small" type={round.schedule ? undefined : 'primary'} icon={<CalendarOutlined />} onClick={() => setSchedOpen(true)}>
              {round.schedule ? 'Reschedule' : 'Schedule interview'}
            </Button>
          );
        }
        if (round.feedback) {
          extras[2] = (
            <Alert type="info" showIcon icon={<RobotOutlined />} style={{ marginTop: 6 }}
              message="AI feedback summary"
              description={`Skill ratings and remarks read as consistent with the recommendation (${round.feedback.rec}); no contradictions flagged between the scores and the written note. Advisory only — RT still decides Approve / Hold / Reject.`} />
          );
        } else if (round.schedule && isCurrent) {
          // Was gated on status === 'await' only — missed every candidate
          // whose mock status is 'scheduled'/undefined, leaving no way to
          // open the scorecard at all once the interview is booked.
          extras[2] = <Button size="small" type="primary" onClick={() => setCardOpen(true)}>Open scorecard — tokenized link (no ATS login)</Button>;
        }
      } else if (stage.type === 'docs') {
        if (!round.requested) {
          extras[0] = isCurrent && <Button type="primary" size="small" icon={<MailOutlined />} onClick={sendDocumentRequest}>Send document request</Button>;
        } else {
          const checklist = round.checklist || [];
          extras[2] = (
            <>
              <Table size="small" pagination={false} rowKey="name" style={{ marginTop: 6, marginBottom: 8 }}
                columns={[
                  { title: 'Document', dataIndex: 'name', render: (v) => <Space><FileTextOutlined /><Text strong style={{ fontSize: 12.5 }}>{v}</Text></Space> },
                  { title: 'Status', dataIndex: 'status', width: 170, render: (v) => <Tag color={DOC_TAG[v].color}>{DOC_TAG[v].label}</Tag> },
                  {
                    title: '', dataIndex: 'status', key: 'a', width: 140,
                    render: (v) => isCurrent && v === 'uploaded' && (
                      <Space size={4}>
                        <Button size="small" onClick={() => message.success('Document verified')}>Verify</Button>
                        <Button size="small" danger onClick={() => message.warning('Rejected — re-request sent with reason')}>Reject…</Button>
                      </Space>
                    ),
                  },
                ]}
                dataSource={checklist} />
              {isCurrent && <Button size="small" onClick={() => message.info('Reminder sent — will repeat until documents arrive')}>Send reminder</Button>}
              <Text type="secondary" style={{ fontSize: 11.5, display: 'block', marginTop: 6 }}>
                Candidate uploads via a secure link — no login. Vendors never see documents or these emails (Q5).
              </Text>
            </>
          );
        }
      } else if (stage.type === 'offer') {
        const off = round.offer;
        if (!off) {
          extras[0] = (
            <>
              <Text type="secondary" style={{ fontSize: 11.5, display: 'block', marginBottom: 6 }}>
                Record-only (Q3): HR shares the letter from its own mailbox — request in-app approval first.
              </Text>
              {isCurrent && <Button type="primary" size="small" icon={<MailOutlined />} onClick={requestOfferApproval}>Request internal approval</Button>}
            </>
          );
        } else if (off.approvalStatus !== 'pending' && !off.shared) {
          extras[1] = isCurrent && <Button type="primary" size="small" icon={<FileTextOutlined />} onClick={recordOfferShared}>Record offer shared</Button>;
        } else if (off.shared && off.decision === 'Awaiting decision' && isCurrent) {
          extras[2] = (
            <Space size={6}>
              <Button size="small" style={{ color: 'var(--green, #4a7c59)', borderColor: 'var(--green, #4a7c59)' }}
                onClick={() => message.success('Offer marked Accepted — closure options unlocked; record auto-closes 90 days after Joined (Q12)')}>Mark Accepted</Button>
              <Button size="small" danger onClick={() => message.warning('Offer marked Rejected — reason captured')}>Mark Rejected</Button>
            </Space>
          );
        }
        if (isCurrent) {
          extras[3] = (
            <Space wrap size={8} style={{ marginTop: 4 }}>
              <Select size="small" value={closeStatus} onChange={setCloseStatus} style={{ minWidth: 200 }}
                options={['Joined', 'Candidate Withdrawn', 'Did Not Join', 'Backed Out', 'Joined and Left', 'Rejected', 'On Hold'].map((v) => ({ value: v, label: v }))} />
              <Button size="small" danger onClick={() => {
                const draft = closureEmailDraft(current, closeStatus);
                setCloseSubject(draft.subject);
                setCloseBody(draft.body);
                setCloseOpen(true);
              }}>Close candidate record</Button>
            </Space>
          );
        }
      }
    }

    /* §2 — the unified, always-expanded vertical pipeline: one connected
       stepper, top to bottom, every stage showing its real content inline
       (no click-to-expand — that mechanism produced the original "trimmed"
       complaint). Chips and notes come straight off `segs` (data-only, see
       roundProgressSegments); `extras` supplies the interactive bits. */
    const pipeline = (
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
              {s.note && <div className="cp-pipeline-step__detail" style={{ marginTop: 2, color: 'var(--text-3)' }}>{s.note}</div>}
              {s.chips && (
                <div className="cp-stat-chip-row">
                  {s.chips.map((chip) => (
                    <div key={chip.label} className={`cp-stat-chip cp-stat-chip--${scoreTier(chip.value)}`}>
                      <span className="cp-stat-chip__value">{chip.value}</span>
                      <span className="cp-stat-chip__label">{chip.label}</span>
                    </div>
                  ))}
                </div>
              )}
              {extras[i] && <div className="cp-pipeline-step__extra">{extras[i]}</div>}
            </div>
          </div>
        ))}
      </div>
    );

    return (
      <Card size="small" title={head} className="cp-round-panel" style={{ marginTop: 4, position: 'relative' }}>
        {isCurrent && <UploadCelebration show={celebrate} />}
        <div style={{ height: 3, margin: '-1px -1px 14px', background: STAGE_ACCENT[stage.type] }} />
        {!round ? <Empty description="No activity in this round yet" image={Empty.PRESENTED_IMAGE_SIMPLE} /> : pipeline}
        {round?.emails?.length > 0 && (
          <>
            <div className="cp-section-label">Emails in this round</div>
            <div className="cp-emails-surface">
              <Timeline items={round.emails.map((e) => ({ dot: <MailOutlined style={{ fontSize: 12 }} />, color: 'blue', children: <Text style={{ fontSize: 12.5 }}>{e}</Text> }))} />
            </div>
          </>
        )}
        {isCurrent && stage.type !== 'offer' && (
          <div style={{ borderTop: '1px solid var(--border-2, #eaebe8)', margin: '12px -12px 12px', paddingTop: 12, paddingInline: 12 }}>
            <Space wrap>
              <Button type="primary" icon={<CheckOutlined />} className="cta-primary btn-sheen"
                onClick={() => openOutcomeModal('approved')}>Approve round</Button>
              <Button icon={<PauseCircleOutlined />} style={{ color: '#d4a017', borderColor: '#d4a017' }}
                onClick={() => openOutcomeModal('hold')}>Hold</Button>
              <Button danger icon={<CloseOutlined />} onClick={() => openOutcomeModal('rejected')}>Reject</Button>
            </Space>
            <Alert type="info" showIcon icon={<MailOutlined />} style={{ marginTop: 10 }}
              message={current.src === 'Vendor'
                ? `Outcome emails go to the candidate AND ${current.vendor} automatically (placement-vendor rule). Sensitive rounds send the vendor a status-only note.`
                : 'Outcome emails go to the candidate automatically, from the recruitment mailbox, with open tracking.'} />
          </div>
        )}
      </Card>
    );
  };

  /* ---- import modal (lives inside the Assessment round — RT feedback #4) ---- */

  const importModal = (
    <Modal open={importOpen} onCancel={() => setImportOpen(false)} footer={null} width={760}
      title="IQ / Tech Assessment — import Evalground results">
      <Paragraph type="secondary" style={{ marginTop: 4 }}>
        Part of the Assessment round: the Evalground CSV (one file — GA + Technical, Q1) is matched <Text strong>by candidate email</Text> to
        candidates currently in this round, filling their IQ (GA) and Technical scores. Duplicate attempts use the <Text strong>latest row</Text>.
        Pass mark <Text strong>50%</Text> for both tests drives the Passed/Failed suggestion (Q4). Nothing is written until you confirm.
      </Paragraph>
      <Steps size="small" current={1} style={{ maxWidth: 620, marginBottom: 16 }}
        items={[{ title: 'Upload file' }, { title: 'AI reads rows' }, { title: 'Import' }]} />
      <Alert type="success" showIcon icon={<RobotOutlined />} style={{ marginBottom: 12 }}
        message="Evalground_Results_08Jul2026.csv"
        description="38 rows · uploaded by Priya (RT) · no column mapping step — AI read every row's raw text regardless of column order/headers and picked out email, GA score and Technical score (same schema-free row-reading pattern as the HR bulk resume upload)." />
      <Row gutter={[10, 10]} style={{ marginBottom: 12 }}>
        <Col span={6}><Card size="small"><Statistic title="Matched" value={34} valueStyle={{ color: 'var(--green, #4a7c59)', fontSize: 20 }} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="Unmatched" value={3} valueStyle={{ color: '#d4a017', fontSize: 20 }} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="Malformed" value={1} valueStyle={{ color: 'var(--red, #c0392b)', fontSize: 20 }} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="Total rows" value={38} valueStyle={{ fontSize: 20 }} /></Card></Col>
      </Row>
      <Table size="small" pagination={false} rowKey="row" style={{ marginBottom: 12 }}
        columns={[
          { title: 'Row', dataIndex: 'row', width: 56 },
          { title: 'Issue', dataIndex: 'issue', width: 110, render: (v) => <Tag color={v === 'Malformed' ? 'red' : 'gold'}>{v}</Tag> },
          { title: 'Detail', dataIndex: 'detail' },
          { title: '', dataIndex: 'a', width: 140, render: (a) => <Button size="small">{a}</Button> },
        ]}
        dataSource={[
          { row: 12, issue: 'Unmatched', detail: 'rohit.k1993@gmail.com — no candidate in this round', a: 'Match manually…' },
          { row: 19, issue: 'Unmatched', detail: 'sneha.p@yahoo.co.in — 2 possible candidates', a: 'Review…' },
          { row: 22, issue: 'Duplicate', detail: 'meena.iyer@yahoo.in — 2 attempts in file; latest (07 Jul) used', a: 'OK' },
          { row: 31, issue: 'Malformed', detail: 'Score is “AB” — not a number (absent?)', a: 'Skip row' },
        ]} />
      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
        <Text type="secondary" style={{ fontSize: 12 }}>Import history: 01 Jul (27 matched) · 24 Jun (31 matched)</Text>
        <Space>
          <Button onClick={() => setImportOpen(false)}>Cancel</Button>
          <Button type="primary" icon={<ImportOutlined />} onClick={() => {
            setImportOpen(false);
            message.success('34 results imported — IQ/Tech scores filled for candidates in the Assessment round');
          }}>Import 34 matched results</Button>
        </Space>
      </Space>
    </Modal>
  );

  /* ---- render ---- */

  return (
    <div className="page-enter">
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }} wrap>
        <div>
          <Title level={3} style={{ margin: 0 }}>Candidate Pipeline (Demo)</Title>
          <Text type="secondary">Walkthrough demo — mock data, nothing is saved, no emails are sent</Text>
        </div>
      </Space>

      {/* NOT closable, and first on the page. This route is no longer in the
          sidebar, so anyone here arrived by a direct link — quite possibly
          expecting the real board. The demo must announce itself and offer the
          way across, every time, not just until someone dismisses it. */}
      <Alert type="error" showIcon style={{ marginBottom: 14 }}
        message="This is the DEMO pipeline — every candidate below is invented"
        description={(
          <span>
            Nothing here is saved and no email is ever sent. It exists for client walkthroughs and as
            the design reference for the real board. For live candidates, go to{' '}
            <Link to="/pipeline">Candidate Pipeline</Link>.
          </span>
        )}
      />

      <Alert type="warning" showIcon closable style={{ marginBottom: 14 }}
        message="Prototype for the RT walkthrough — v3, your answers of 2026-07-13 applied"
        description="Candidates enter here already shortlisted from Candidate Screening — the pipeline starts at HR Screening (Zeko), not a second shortlist step (vendor submissions included, carrying their vendor tag). Click a candidate, then click any completed round in the stepper to see that round's details — future rounds are locked. Pipeline analytics lives as a tab in the Analytics page. Applied answers: 30-min reminders + daily feedback reminder (no escalation), manual-only Hold, record-only offer with in-app approval, Evalground 50% pass mark with latest-attempt rule, concurrent MRF journeys (see the '2 MRFs' badge), both scheduling modes, and your interview evaluation scorecard format." />
      {board}

      {/* ---------- candidate drawer (per-round) ---------- */}
      <Drawer width={680} open={!!current} onClose={() => setOpenId(null)}
        title={current && (
          <Space direction="vertical" size={2}>
            <Space><UserOutlined /><Text strong style={{ fontSize: 16 }}>{current.name}</Text></Space>
            <Text type="secondary" style={{ fontSize: 12.5, fontWeight: 400 }}>
              {current.role} · {current.email} · MRF-2031
            </Text>
          </Space>
        )}>
        {current && (
          <>
            <Space size={4} wrap style={{ marginBottom: 10 }}>
              <SourceTag c={current} />
              <ChipTag chip={current.chip} />
              <AlsoActiveTag c={current} />
              <Tag>{current.age} days in round</Tag>
            </Space>
            {current.screening && (
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8,
                background: 'var(--ink-3)', borderRadius: 10, padding: '9px 14px', marginBottom: 10,
              }}>
                <Text style={{ fontSize: 12.5 }}>
                  <Text type="secondary">Shortlisted from Candidate Screening</Text> · JD match <Text strong>{current.screening.jdMatch}%</Text> · {current.screening.when}{current.screening.by ? ` · by ${current.screening.by}` : ''}
                </Text>
                <Button size="small" type="link" style={{ padding: 0 }}>View resume</Button>
              </div>
            )}
            {current.screening?.note && (
              <Alert type="info" showIcon message={current.screening.note} style={{ marginBottom: 10, fontSize: 12.5 }} />
            )}
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 8, marginBottom: 4 }}>
              {STAGES.map((s, i) => {
                const past = i < currentIdx;
                const isCurrentStage = i === currentIdx;
                const disabled = i > currentIdx;
                const kind = past ? 'done' : isCurrentStage ? 'current' : 'future';
                return (
                  <button key={s.key} type="button" disabled={disabled}
                    onClick={() => setSelectedRound(i)}
                    className={`cp-stage-pill cp-stage-pill--${kind}${selectedRound === i ? ' cp-stage-pill--selected' : ''}`}>
                    {s.short}
                  </button>
                );
              })}
            </div>
            <Text type="secondary" style={{ fontSize: 11.5, display: 'block', marginBottom: 8 }}>
              Click a round to see its details — rounds after <Text strong style={{ fontSize: 11.5 }}>{STAGES[currentIdx].name}</Text> are locked until the candidate gets there.
            </Text>
            {renderRoundPanel()}
          </>
        )}
      </Drawer>

      {/* ---------- decision modal (v6): outcome + real, editable outcome email ---------- */}
      <Modal open={outcomeOpen} onCancel={() => setOutcomeOpen(false)} onOk={saveOutcome} width={620}
        okText="Save & send email" title="Record round outcome"
        okButtonProps={{ disabled: outcome !== 'approved' && !reason }}>
        {current && (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Text type="secondary">{current.name} · {STAGES[currentIdx]?.name}</Text>
            <Radio.Group value={outcome} onChange={(e) => openOutcomeModal(e.target.value)}
              optionType="button" buttonStyle="solid"
              options={[
                { value: 'approved', label: '✓ Approved' },
                { value: 'hold', label: '◔ Hold' },
                { value: 'rejected', label: '✕ Rejected' },
              ]} />
            <div>
              <Text strong style={{ fontSize: 12.5 }}>Reason <Text type="danger">*</Text> (mandatory for Reject / Hold)</Text>
              <Select style={{ width: '100%', marginTop: 4 }} placeholder="Select a reason"
                disabled={outcome === 'approved'} value={reason} onChange={setReason}
                options={(REASONS[outcome] || []).map((r) => ({ value: r, label: r }))} />
            </div>
            <Input.TextArea rows={2} placeholder="Notes — internal, shown on the round; not sent to the candidate" />
            <div style={{ borderTop: '1px solid var(--border-2, #eaebe8)', paddingTop: 10 }}>
              <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 6 }}>
                <Text strong style={{ fontSize: 12.5 }}><MailOutlined style={{ marginInlineEnd: 4 }} />Outcome email → {mailAudience(current)}</Text>
                {emailTpl
                  ? <Tag color="blue">Template — {emailTpl.name} (#{emailTpl.id})</Tag>
                  : <Tag color="orange">Draft — no template yet</Tag>}
              </Space>
              {!emailTpl && (
                <Alert type="warning" showIcon style={{ marginBottom: 8 }}
                  message="No email template exists yet for “approved / moving to next stage” — this is an editable draft, not a saved template." />
              )}
              <Input value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)}
                placeholder="Subject" style={{ marginBottom: 8 }} />
              <Input.TextArea rows={7} value={emailBody} onChange={(e) => setEmailBody(e.target.value)} placeholder="Body" />
              <Text type="secondary" style={{ fontSize: 11.5, display: 'block', marginTop: 4 }}>
                Editable before send — the exact text above goes out; logged with open tracking once sent.
              </Text>
            </div>
          </Space>
        )}
      </Modal>

      {/* ---------- close-candidate-record confirm modal (v6) ---------- */}
      <Modal open={closeOpen} onCancel={() => setCloseOpen(false)} width={620}
        okText="Confirm & send email" okButtonProps={{ danger: true }} title="Close candidate record"
        onOk={() => {
          message.info(`Record closed (${closeStatus}) — closure email sent to ${mailAudience(current)}`);
          setCandidates((prev) => prev.filter((c) => c.id !== current.id));
          setOpenId(null);
          setCloseOpen(false);
        }}>
        {current && (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Text type="secondary">{current.name} · closing as <Text strong>{closeStatus}</Text></Text>
            <Alert type="warning" showIcon message="This removes the candidate from the active board — reversible only by re-adding them (prototype has no undo)." />
            <div style={{ borderTop: '1px solid var(--border-2, #eaebe8)', paddingTop: 10 }}>
              <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 6 }}>
                <Text strong style={{ fontSize: 12.5 }}><MailOutlined style={{ marginInlineEnd: 4 }} />Closure email → {mailAudience(current)}</Text>
                <Tag color="orange">Draft — no template yet</Tag>
              </Space>
              <Input value={closeSubject} onChange={(e) => setCloseSubject(e.target.value)}
                placeholder="Subject" style={{ marginBottom: 8 }} />
              <Input.TextArea rows={6} value={closeBody} onChange={(e) => setCloseBody(e.target.value)} placeholder="Body" />
              <Text type="secondary" style={{ fontSize: 11.5, display: 'block', marginTop: 4 }}>
                Editable before send — same pattern as the round-outcome decision modal.
              </Text>
            </div>
          </Space>
        )}
      </Modal>

      {/* ---------- schedule modal ---------- */}
      <Modal open={schedOpen} onCancel={() => setSchedOpen(false)} onOk={saveSchedule}
        okText={schedMode === 'slots' ? 'Publish slots & email link' : 'Create Teams invite'} title="Schedule interview" width={560}>
        {current && (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Text type="secondary">{current.name} · {STAGES[currentIdx]?.name} · 60-minute Teams interview</Text>
            <Radio.Group value={schedMode} onChange={(e) => setSchedMode(e.target.value)} optionType="button" buttonStyle="solid"
              options={[
                { value: 'fixed', label: 'Fixed time (enter below)' },
                { value: 'slots', label: 'Candidate picks a slot' },
              ]} />
            {schedMode === 'fixed' ? (
              <>
                <div>
                  <Text strong style={{ fontSize: 12.5 }}>Date & time (IST)</Text>
                  <DatePicker showTime={{ format: 'HH:mm', minuteStep: 15 }} format="DD MMM YYYY, HH:mm"
                    defaultValue={dayjs().add(4, 'day').hour(11).minute(0)} style={{ width: '100%', marginTop: 4 }} />
                </div>
                <div>
                  <Text strong style={{ fontSize: 12.5 }}>Interviewer · availability from Outlook</Text>
                  <Radio.Group defaultValue="suresh" style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                    <Radio value="suresh"><Badge status="success" text="Suresh Menon — Tech Lead (free at 11:00)" /></Radio>
                    <Radio value="deepa"><Badge status="error" text="Deepa Rao — Architect (busy 10:30–12:00)" /></Radio>
                    <Radio value="vikram"><Badge status="success" text="Vikram Joshi — Engg Manager (free at 11:00)" /></Radio>
                  </Radio.Group>
                </div>
              </>
            ) : (
              <Alert type="info" showIcon
                message="Publish 2–3 open slots from the interviewer's Outlook free/busy — the candidate picks one from an emailed link (no login)."
                description="First-come holds a slot; the interviewer can update/overwrite published slots at any time to resolve conflicts (Q31). The Teams invite is created automatically on pick." />
            )}
            <Alert type="info" showIcon icon={<CalendarOutlined />}
              message="On save: Outlook invite with Microsoft Teams link goes to candidate + interviewer from the recruitment mailbox."
              description="Automated reminders (Q7) — candidate 30 min before · interviewer 30 min before · feedback form link right after the interview, then one reminder per day until submitted." />
            <Card size="small" style={{ background: 'var(--ink-3)' }}>
              <Checkbox checked={prepBriefOn} onChange={(e) => setPrepBriefOn(e.target.checked)}>
                <Space size={6}><RobotOutlined style={{ color: 'var(--gold, #7a922e)' }} /><Text strong style={{ fontSize: 13 }}>Attach AI interviewer prep brief</Text></Space>
              </Checkbox>
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4, marginInlineStart: 24 }}>
                On by default — a one-page summary sent to the interviewer alongside the invite: candidate snapshot, scores so far
                (JD match, Zeko, Evalground), and 3–4 suggested questions for this round. Interviewer can ignore it; nothing here
                feeds back into the official outcome.
              </Text>
            </Card>
          </Space>
        )}
      </Modal>

      {/* ---------- Zeko interview scheduling modal (v11 — mirrors AnalyticsLegacy's
          "Schedule Zeko Interview": candidate card → Interview Date & Time Range) ---------- */}
      <Modal open={zekoSchedOpen} onCancel={() => setZekoSchedOpen(false)} onOk={confirmZekoSchedule}
        okText="Confirm & Invite" width={520}
        okButtonProps={{ disabled: !zekoRange || !zekoRange[0] || !zekoRange[1] }}
        title={<Space><CalendarOutlined style={{ color: 'var(--gold)' }} />Schedule Zeko Interview</Space>}>
        {current && (
          <Space direction="vertical" size={14} style={{ width: '100%', marginTop: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'var(--ink-3)', borderRadius: 10 }}>
              <div className="cp-avatar" style={{ background: avatarColor(current.name), width: 36, height: 36, fontSize: 13 }}>{initials(current.name)}</div>
              <div style={{ minWidth: 0 }}>
                <Text strong style={{ fontSize: 13.5, display: 'block' }}>{current.name}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>{current.email}</Text>
              </div>
            </div>
            <div>
              <Text strong style={{ fontSize: 12.5 }}>Zeko {STAGES[currentIdx]?.key === 'zeko_fn' ? 'Functional' : 'HR'} Screening test</Text>
              <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>{STAGES[currentIdx]?.name} · {current.role}</Text>
            </div>
            <div>
              <Text strong style={{ fontSize: 12.5 }}>Interview Date & Time Range (IST) <Text type="danger">*</Text></Text>
              <DatePicker.RangePicker showTime={{ format: 'HH:mm' }} format="YYYY-MM-DD HH:mm" style={{ width: '100%', marginTop: 4 }}
                value={zekoRange} onChange={setZekoRange}
                disabledDate={(cur) => cur && cur < dayjs().startOf('day')} />
              <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
                Candidate self-schedules within this window via the Zeko link; times round to 30-minute slots automatically.
              </Text>
            </div>
          </Space>
        )}
      </Modal>

      {/* ---------- Assessment invite modal (v11 — simpler than Zeko's: a single
          completion deadline, no equivalent Evalground scheduling UI to mirror) ---------- */}
      <Modal open={assessSchedOpen} onCancel={() => setAssessSchedOpen(false)} onOk={confirmAssessmentInvite}
        okText="Confirm & Invite" width={460} okButtonProps={{ disabled: !assessDeadline }}
        title={<Space><CalendarOutlined style={{ color: 'var(--gold)' }} />Send Assessment Invite</Space>}>
        {current && (
          <Space direction="vertical" size={14} style={{ width: '100%', marginTop: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'var(--ink-3)', borderRadius: 10 }}>
              <div className="cp-avatar" style={{ background: avatarColor(current.name), width: 36, height: 36, fontSize: 13 }}>{initials(current.name)}</div>
              <div style={{ minWidth: 0 }}>
                <Text strong style={{ fontSize: 13.5, display: 'block' }}>{current.name}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>{current.email}</Text>
              </div>
            </div>
            <Text type="secondary" style={{ fontSize: 12.5 }}>Evalground assessment (GA + Technical) · {current.role}</Text>
            <div>
              <Text strong style={{ fontSize: 12.5 }}>Completion deadline <Text type="danger">*</Text></Text>
              <DatePicker style={{ width: '100%', marginTop: 4 }} format="DD MMM YYYY" value={assessDeadline} onChange={setAssessDeadline}
                disabledDate={(cur) => cur && cur < dayjs().startOf('day')} />
            </div>
          </Space>
        )}
      </Modal>

      {/* ---------- scorecard modal ---------- */}
      <Modal open={cardOpen} onCancel={() => setCardOpen(false)} onOk={submitScorecard}
        okText="Submit feedback" title="Interviewer scorecard — Interview Evaluation Format" width={560}>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert type="warning" showIcon icon={<WarningOutlined />}
            message="What the interviewer sees via the emailed link — no ATS login needed."
            description="Candidate, position, round and interviewer are pre-filled from the schedule. Same card for Technical 1–3 and CEO rounds (Q18); the HR Round has its own card (timings, relocation, notice, CTC, strengths…)." />
          {[
            { k: 'Skill 1 — Selenium with Java', v: 3.5, remark: 'Good' },
            { k: 'Skill 2 — BRD/FRD', v: 3, remark: 'Average' },
            { k: 'Skill 3 — API testing', v: 4, remark: 'Good API testing knowledge' },
          ].map((s) => (
            <Space key={s.k} style={{ width: '100%', justifyContent: 'space-between' }} wrap>
              <Text strong style={{ fontSize: 13 }}>{s.k} <Text type="danger">*</Text></Text>
              <Space><Rate allowHalf defaultValue={s.v} /><Input size="small" defaultValue={s.remark} style={{ width: 150 }} /></Space>
            </Space>
          ))}
          <Text type="secondary" style={{ fontSize: 12 }}>+ Skill 4 / Skill 5 — optional, same rating + remarks</Text>
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Text strong style={{ fontSize: 13 }}>Communication <Text type="danger">*</Text></Text>
            <Rate allowHalf defaultValue={4} />
          </Space>
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Text strong style={{ fontSize: 13 }}>Attitude <Text type="danger">*</Text></Text>
            <Rate allowHalf defaultValue={3.5} />
          </Space>
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Text strong style={{ fontSize: 13 }}>Final rating <Text type="danger">*</Text></Text>
            <Rate allowHalf defaultValue={3.5} />
          </Space>
          <div>
            <Text strong style={{ fontSize: 12.5 }}>Status <Text type="danger">*</Text></Text>
            <Radio.Group value={cardRec} onChange={(e) => setCardRec(e.target.value)}
              optionType="button" buttonStyle="solid" style={{ display: 'block', marginTop: 4 }}
              options={[{ value: 'Approve', label: '✓ Shortlisted' }, { value: 'Hold', label: '◔ On Hold' }, { value: 'Reject', label: '✕ Rejected' }]} />
          </div>
          <Input.TextArea rows={2} defaultValue="Final comments — selected for next round." />
          <Input size="small" placeholder="Interview recording link (optional)" />
          <Text type="secondary" style={{ fontSize: 12 }}>
            RT reviews this and records the official round outcome — the recommendation and the decision are both kept. HR is notified on submission.
          </Text>
        </Space>
      </Modal>

      {importModal}
    </div>
  );
}
