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
 */
import { useMemo, useState } from 'react';
import {
  Alert, App as AntApp, Badge, Button, Card, Checkbox, Col, DatePicker, Descriptions,
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

const { Text, Title, Paragraph } = Typography;

/* ------------------------------------------------------------------ config */

const STAGES = [
  { key: 'shortlist', name: 'Shortlisted', short: 'Shortlisted', type: 'shortlist' },
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
  review: { label: 'In review', color: 'default' },
  invited: { label: 'Invited', color: 'blue' },
  scheduled: { label: 'Scheduled', color: 'blue' },
  await: { label: 'Awaiting feedback', color: 'gold' },
  hold: { label: 'On Hold', color: 'gold' },
  docs: { label: 'Uploading docs', color: 'blue' },
  offer_sent: { label: 'Offer shared', color: 'blue' },
  imported: { label: 'Result imported', color: 'default' },
};

const OUTCOME_TAG = {
  approved: { label: 'Approved', color: 'green' },
  hold: { label: 'On Hold', color: 'gold' },
  in_progress: { label: 'In progress', color: 'processing' },
};

/* ------------------------------------------------------------------- data
 * Each candidate carries per-round detail in `rounds[stageKey]` — the drawer
 * shows exactly one round at a time (RT feedback #2). Only traversed rounds
 * have entries; the current round may be partially filled.
 */
const INITIAL_CANDIDATES = [
  {
    id: 1, name: 'Arjun Mehta', role: 'Senior .NET Developer', src: 'HR', stage: 'tech1',
    chip: 'scheduled', age: 3, email: 'arjun.mehta@gmail.com',
    rounds: {
      shortlist: { outcome: 'approved', when: '02 Jul', by: 'Priya', jdMatch: 84, emails: ['Welcome + process email — opened'] },
      zeko_hr: { outcome: 'approved', when: '05 Jul', by: 'Anita', zeko: { interview: 82, communication: 78 }, emails: ['Zeko invite — opened', 'Outcome email — delivered'] },
      assessment: { outcome: 'approved', when: '08 Jul', by: 'Priya', iq: 78, tech: 74, testDate: '07 Jul', importedFrom: 'Evalground_Results_08Jul2026.csv', emails: ['Assessment invite — opened', 'Outcome email — delivered'] },
      zeko_fn: { outcome: 'approved', when: '09 Jul', by: 'Anita', zeko: { interview: 80, communication: 77 }, emails: ['Outcome email — delivered'] },
      tech1: { status: 'scheduled', schedule: { when: '13 Jul, 11:00', who: 'Suresh Menon', mode: 'Teams' }, emails: ['Outlook invite (Teams) — candidate opened'] },
    },
  },
  {
    id: 2, name: 'Kavya Nair', role: 'Senior .NET Developer', src: 'Vendor', vendor: 'TechBridge Solutions',
    stage: 'tech2', chip: 'await', age: 2, email: 'kavya.nair@outlook.com',
    rounds: {
      shortlist: { outcome: 'approved', when: '28 Jun', by: 'Priya', jdMatch: 88, emails: ['Welcome + process email → candidate + vendor'] },
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
    rounds: {
      shortlist: { outcome: 'approved', when: '20 Jun', by: 'Priya', jdMatch: 74, emails: ['Welcome + process email — opened'] },
      zeko_hr: { outcome: 'approved', when: '23 Jun', by: 'Anita', zeko: { interview: 74, communication: 70 }, emails: ['Outcome email — delivered'] },
      assessment: { outcome: 'approved', when: '25 Jun', by: 'Priya', iq: 71, tech: 69, testDate: '24 Jun', importedFrom: 'Evalground_Results_24Jun2026.csv', emails: ['Outcome email — delivered'] },
      zeko_fn: { outcome: 'approved', when: '26 Jun', by: 'Anita', zeko: { interview: 72, communication: 71 }, emails: ['Outcome email — delivered'] },
      tech1: { status: 'await', schedule: { when: '27 Jun, 14:00', who: 'Suresh Menon', mode: 'Teams' }, remindersSent: 5, emails: ['Feedback reminders #1–#5 (one per day) → Suresh Menon', 'Card flagged "awaiting feedback 12 days" — no escalation (Q7)'] },
    },
  },
  {
    id: 4, name: 'Meena Iyer', role: 'Business Analyst', src: 'Email', stage: 'assessment', chip: 'review', age: 11,
    email: 'meena.iyer@yahoo.in',
    rounds: {
      shortlist: { outcome: 'approved', when: '24 Jun', by: 'Anita', jdMatch: 79, emails: ['Welcome + process email — opened'] },
      zeko_hr: { outcome: 'approved', when: '26 Jun', by: 'Priya', zeko: { interview: 79, communication: 82 }, emails: ['Outcome email — delivered'] },
      assessment: { status: 'review', testDate: '30 Jun', note: 'Test attempted — result awaited in next CSV import', emails: ['Assessment invite (GA + Technical) — opened'] },
    },
  },
  {
    id: 5, name: 'Farhan Ali', role: 'React Developer', src: 'Vendor', vendor: 'Talent Hive', stage: 'zeko_hr',
    chip: 'hold', age: 34, email: 'farhan.ali@gmail.com',
    rounds: {
      shortlist: { outcome: 'approved', when: '01 Jun', by: 'Priya', jdMatch: 70, emails: ['Welcome + process email → candidate + vendor'] },
      zeko_hr: { outcome: 'hold', reason: 'Weak communication', when: '05 Jun', by: 'Anita', zeko: { interview: 66, communication: 61 }, note: 'On Hold 34 days — manual review only (no auto-reminder/auto-close, Q10); aging badge keeps it visible', emails: ['On-hold email → candidate + vendor (status-only)'] },
    },
  },
  {
    id: 6, name: 'Sanya Kapoor', role: 'Power BI Developer', src: 'HR', stage: 'hr', chip: 'scheduled', age: 1,
    email: 'sanya.kapoor@gmail.com',
    rounds: {
      shortlist: { outcome: 'approved', when: '25 Jun', by: 'Priya', jdMatch: 85, emails: ['Welcome + process email — opened'] },
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
    rounds: {
      shortlist: { outcome: 'approved', when: '15 Jun', by: 'Priya', jdMatch: 90, emails: ['Welcome + process email → candidate + vendor'] },
      zeko_hr: { outcome: 'approved', when: '17 Jun', by: 'Anita', zeko: { interview: 90, communication: 86 }, emails: ['Outcome email → candidate + vendor'] },
      assessment: { outcome: 'approved', when: '19 Jun', by: 'Priya', iq: 88, tech: 91, testDate: '18 Jun', importedFrom: 'Evalground_Results_24Jun2026.csv', emails: ['Outcome email → candidate + vendor'] },
      zeko_fn: { outcome: 'approved', when: '20 Jun', by: 'Anita', zeko: { interview: 89, communication: 87 }, emails: ['Outcome email → candidate + vendor'] },
      tech1: { outcome: 'approved', when: '23 Jun', by: 'Priya', schedule: { when: '22 Jun, 11:00', who: 'Suresh Menon', mode: 'Teams' }, feedback: { by: 'Suresh Menon', rec: 'Approve', avg: 4.6, note: 'Excellent depth.' }, emails: ['Outcome email → candidate + vendor'] },
      tech2: { outcome: 'approved', when: '26 Jun', by: 'Anita', schedule: { when: '25 Jun, 14:00', who: 'Deepa Rao', mode: 'Teams' }, feedback: { by: 'Deepa Rao', rec: 'Approve', avg: 4.7, note: 'Best candidate this quarter.' }, emails: ['Outcome email → candidate + vendor'] },
      hr: { outcome: 'approved', when: '29 Jun', by: 'Nisha (RT)', note: 'CTC within band; 30-day notice; WFH 2 days OK', emails: ['Outcome email → candidate + vendor'] },
      ceo: { outcome: 'approved', when: '01 Jul', by: 'Priya', schedule: { when: '30 Jun, 16:00', who: 'CEO', mode: 'Teams' }, feedback: { by: 'CEO', rec: 'Approve', avg: 4.5, note: 'Go ahead.' }, emails: ['Outcome email → candidate + vendor'] },
      docs: {
        status: 'docs',
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
    rounds: {
      shortlist: { outcome: 'approved', when: '10 Jun', by: 'Priya', jdMatch: 87, emails: ['Welcome + process email — opened'] },
      zeko_hr: { outcome: 'approved', when: '12 Jun', by: 'Anita', zeko: { interview: 87, communication: 90 }, emails: ['Outcome email — delivered'] },
      assessment: { outcome: 'approved', when: '14 Jun', by: 'Priya', iq: 83, tech: 80, testDate: '13 Jun', importedFrom: 'Evalground_Results_24Jun2026.csv', emails: ['Outcome email — delivered'] },
      zeko_fn: { outcome: 'approved', when: '16 Jun', by: 'Anita', zeko: { interview: 85, communication: 89 }, emails: ['Outcome email — delivered'] },
      tech1: { outcome: 'approved', when: '20 Jun', by: 'Priya', schedule: { when: '19 Jun, 11:00', who: 'Vikram Joshi', mode: 'Teams' }, feedback: { by: 'Vikram Joshi', rec: 'Approve', avg: 4.2, note: 'Strong requirements elicitation.' }, emails: ['Outcome email — delivered'] },
      tech2: { outcome: 'approved', when: '25 Jun', by: 'Anita', schedule: { when: '24 Jun, 15:00', who: 'Deepa Rao', mode: 'Teams' }, feedback: { by: 'Deepa Rao', rec: 'Approve', avg: 4.4, note: 'Excellent case handling.' }, emails: ['Outcome email — delivered'] },
      hr: { outcome: 'approved', when: '01 Jul', by: 'Nisha (RT)', emails: ['Outcome email — delivered'] },
      docs: { outcome: 'approved', when: '05 Jul', by: 'Anita', note: 'All documents verified', emails: ['Document request — completed'] },
      offer: { status: 'offer_sent', offer: { file: 'Offer_IshitaBose_BA.pdf', shared: '07 Jul 2026', join: '04 Aug 2026', decision: 'Awaiting decision', approval: 'Approved in-app by Priya (recruiter) · 06 Jul' }, emails: ['Approval nudge (daily) → Priya — approved 06 Jul', 'Offer shared offline by HR — recorded in ATS 07 Jul'] },
    },
  },
  {
    id: 9, name: 'Rohit Kulkarni', role: 'QA Engineer', src: 'Email', stage: 'shortlist', chip: 'review', age: 1,
    email: 'rohit.k@gmail.com',
    rounds: { shortlist: { status: 'review', jdMatch: 72, when: 'yesterday', note: 'Shortlisted from Candidate Screening (email intake) — awaiting move to Zeko HR', emails: ['Welcome + process email — sent'] } },
  },
  {
    id: 10, name: 'Ananya Singh', role: 'React Developer', src: 'HR', stage: 'shortlist', chip: 'review', age: 2,
    email: 'ananya.s@gmail.com', also: 'UI Developer (MRF-2044)',
    rounds: { shortlist: { status: 'review', jdMatch: 81, when: '2 days ago', note: 'Shortlisted from Candidate Screening (JD match 81%) — awaiting move to Zeko HR. Also running a second journey for UI Developer (MRF-2044) — concurrent MRFs allowed (Q13); a rejection there would not stop this journey.', emails: ['Welcome + process email — opened'] } },
  },
  {
    id: 11, name: 'Vishal Gupta', role: 'Senior .NET Developer', src: 'Vendor', vendor: 'Talent Hive',
    stage: 'zeko_fn', chip: 'invited', age: 5, email: 'vishal.g@outlook.com',
    rounds: {
      shortlist: { outcome: 'approved', when: '27 Jun', by: 'Priya', jdMatch: 76, emails: ['Welcome + process email → candidate + vendor'] },
      zeko_hr: { outcome: 'approved', when: '30 Jun', by: 'Anita', zeko: { interview: 76, communication: 74 }, emails: ['Outcome email → candidate + vendor'] },
      assessment: { outcome: 'approved', when: '03 Jul', by: 'Priya', iq: 80, tech: 78, testDate: '02 Jul', importedFrom: 'Evalground_Results_01Jul2026.csv', emails: ['Outcome email → candidate + vendor'] },
      zeko_fn: { status: 'invited', emails: ['Zeko functional screening invite → candidate + vendor'] },
    },
  },
  {
    id: 12, name: 'Priyanka Das', role: 'Power BI Developer', src: 'HR', stage: 'ceo', chip: 'scheduled', age: 2,
    email: 'priyanka.das@gmail.com',
    rounds: {
      shortlist: { outcome: 'approved', when: '18 Jun', by: 'Priya', jdMatch: 84, emails: ['Welcome + process email — opened'] },
      zeko_hr: { outcome: 'approved', when: '20 Jun', by: 'Anita', zeko: { interview: 84, communication: 82 }, emails: ['Outcome email — delivered'] },
      assessment: { outcome: 'approved', when: '23 Jun', by: 'Priya', iq: 79, tech: 82, testDate: '22 Jun', importedFrom: 'Evalground_Results_24Jun2026.csv', emails: ['Outcome email — delivered'] },
      zeko_fn: { outcome: 'approved', when: '24 Jun', by: 'Anita', zeko: { interview: 83, communication: 81 }, emails: ['Outcome email — delivered'] },
      tech1: { outcome: 'approved', when: '27 Jun', by: 'Priya', schedule: { when: '26 Jun, 10:00', who: 'Vikram Joshi', mode: 'Teams' }, feedback: { by: 'Vikram Joshi', rec: 'Approve', avg: 4.0, note: 'Good.' }, emails: ['Outcome email — delivered'] },
      tech2: { outcome: 'approved', when: '02 Jul', by: 'Anita', schedule: { when: '01 Jul, 15:00', who: 'Deepa Rao', mode: 'Teams' }, feedback: { by: 'Deepa Rao', rec: 'Approve', avg: 4.2, note: 'Ready for final.' }, emails: ['Outcome email — delivered'] },
      hr: { outcome: 'approved', when: '06 Jul', by: 'Nisha (RT)', emails: ['Outcome email — delivered'] },
      ceo: { status: 'scheduled', schedule: { when: '12 Jul, 16:00', who: 'CEO', mode: 'Teams' }, emails: ['Outlook invite (Teams) — sent today'] },
    },
  },
  {
    id: 13, name: 'Karthik Reddy', role: 'Business Analyst', src: 'HR', stage: 'client', chip: 'scheduled', age: 6,
    email: 'karthik.r@gmail.com',
    rounds: {
      shortlist: { outcome: 'approved', when: '12 Jun', by: 'Priya', jdMatch: 80, emails: ['Welcome + process email — opened'] },
      zeko_hr: { outcome: 'approved', when: '15 Jun', by: 'Anita', zeko: { interview: 80, communication: 84 }, emails: ['Outcome email — delivered'] },
      assessment: { outcome: 'approved', when: '18 Jun', by: 'Priya', iq: 77, tech: 75, testDate: '17 Jun', importedFrom: 'Evalground_Results_24Jun2026.csv', emails: ['Outcome email — delivered'] },
      zeko_fn: { outcome: 'approved', when: '20 Jun', by: 'Anita', zeko: { interview: 81, communication: 83 }, emails: ['Outcome email — delivered'] },
      tech1: { outcome: 'approved', when: '24 Jun', by: 'Priya', schedule: { when: '23 Jun, 11:00', who: 'Suresh Menon', mode: 'Teams' }, feedback: { by: 'Suresh Menon', rec: 'Approve', avg: 4.1, note: 'Good BA depth.' }, emails: ['Outcome email — delivered'] },
      tech2: { outcome: 'approved', when: '30 Jun', by: 'Anita', schedule: { when: '29 Jun, 15:00', who: 'Deepa Rao', mode: 'Teams' }, feedback: { by: 'Deepa Rao', rec: 'Approve', avg: 4.0, note: 'Fine.' }, emails: ['Outcome email — delivered'] },
      client: { status: 'scheduled', schedule: { when: '14 Jul, 17:30', who: 'R. Fernandes — Northwind Corp', mode: 'Client call' }, note: 'Client contact added at MRF; custom client-interview template used', emails: ['Client interview email (custom template) — sent'] },
    },
  },
  {
    id: 14, name: 'Neha Sharma', role: 'QA Engineer', src: 'HR', stage: 'assessment', chip: 'imported', age: 3,
    email: 'neha.sharma@gmail.com',
    rounds: {
      shortlist: { outcome: 'approved', when: '02 Jul', by: 'Anita', jdMatch: 77, emails: ['Welcome + process email — opened'] },
      zeko_hr: { outcome: 'approved', when: '05 Jul', by: 'Priya', zeko: { interview: 77, communication: 75 }, emails: ['Outcome email — delivered'] },
      assessment: { status: 'imported', iq: 46, tech: 70, testDate: '07 Jul', importedFrom: 'Evalground_Results_08Jul2026.csv', note: 'IQ 46% — below the 50% pass mark (Q4); auto-suggests Failed, RT decides', emails: ['Assessment invite — opened'] },
    },
  },
];

const FUNNEL = [
  ['Shortlisted', 26], ['HR Screening (Zeko)', 22], ['IQ / Tech Assessment', 19],
  ['Functional (Zeko)', 14], ['Tech Round 1', 9], ['Tech Round 2', 5],
  ['HR Round', 3], ['CEO / Final', 2], ['Offer', 1],
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
        <Col xs={12} lg={6}><Card><Statistic title="Active in pipeline" value={14} /></Card></Col>
        <Col xs={12} lg={6}><Card><Statistic title="Awaiting feedback" value={2} suffix={<Text type="warning" style={{ fontSize: 13 }}> 1 overdue 12d</Text>} /></Card></Col>
        <Col xs={12} lg={6}><Card><Statistic title="On hold > 30 days" value={1} suffix={<Text type="secondary" style={{ fontSize: 13 }}> manual review</Text>} /></Card></Col>
        <Col xs={12} lg={6}><Card><Statistic title="Offers pending" value={1} /></Card></Col>
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
                      <Tag color="gold" style={{ marginInlineEnd: 0 }}>{b}</Tag>
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
                { r: 'Skills mismatch', c: 9, s: 'Shortlisted (review)' },
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
        chip: 'review',
        rounds: { ...current.rounds, [stage.key]: { ...round, status: 'review', feedback: { by: round.schedule?.who || 'Interviewer', rec: cardRec, avg: 3.7, note: 'Submitted via tokenized link — no ATS login.' } } },
      });
    }
    setCardOpen(false);
    message.success('Feedback submitted — RT can now record the round outcome');
  };

  /* ---- board ---- */

  const renderCard = (c) => (
    <Card key={c.id} size="small" hoverable onClick={() => openCandidate(c.id)}
      styles={{ body: { padding: '10px 12px' } }} style={{ marginBottom: 8 }}>
      <Space direction="vertical" size={4} style={{ width: '100%' }}>
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <Text strong>{c.name}</Text>
          <Tooltip title="Days in current round">
            <Tag color={ageColor(c.age)} style={{ marginInlineEnd: 0 }}>{c.age}d</Tag>
          </Tooltip>
        </Space>
        <Text type="secondary" style={{ fontSize: 12 }}>{c.role}</Text>
        <Space size={4} wrap><SourceTag c={c} /><ChipTag chip={c.chip} /><AlsoActiveTag c={c} /></Space>
      </Space>
    </Card>
  );

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
      <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 16, alignItems: 'flex-start' }}>
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
                styles={{ body: { padding: 10, background: 'transparent' } }}>
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

    const head = (
      <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
        <Space size={8}>
          <Text strong style={{ fontSize: 15 }}>{stage.name}</Text>
          {stage.optional && <Tag>optional</Tag>}
          {outcomeInfo && <Tag color={outcomeInfo.color}>{outcomeInfo.label}</Tag>}
          {round?.reason && <Tag color="gold">{round.reason}</Tag>}
        </Space>
        {round?.when && <Text type="secondary" style={{ fontSize: 12 }}>{round.outcome ? 'Decided' : 'Updated'} {round.when}{round.by ? ` · by ${round.by}` : ''}</Text>}
      </Space>
    );

    let body = null;
    if (!round) {
      body = <Empty description="No activity in this round yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
    } else if (stage.type === 'shortlist') {
      body = (
        <Descriptions size="small" column={2} bordered items={[
          { key: '1', label: 'JD match', children: `${round.jdMatch}%` },
          { key: '2', label: 'Source', children: current.src === 'Vendor' ? `Vendor — ${current.vendor}` : (current.src === 'HR' ? 'HR upload' : 'Email intake') },
          { key: '3', label: 'Shortlisted', children: `${round.when}${round.by ? ` · by ${round.by}` : ''}` },
          { key: '4', label: 'Resume', children: <Button size="small" type="link" style={{ padding: 0 }}>View resume</Button> },
          ...(round.note ? [{ key: '5', label: 'Note', children: round.note, span: 2 }] : []),
        ]} />
      );
    } else if (stage.type === 'zeko') {
      body = round.zeko ? (
        <Row gutter={[8, 8]}>
          <Col span={12}><Card size="small"><Statistic title="Zeko interview score" value={round.zeko.interview} /></Card></Col>
          <Col span={12}><Card size="small"><Statistic title="Zeko communication" value={round.zeko.communication} /></Card></Col>
          {round.note && <Col span={24}><Alert type="warning" showIcon message={round.note} /></Col>}
        </Row>
      ) : (
        <Alert type="info" showIcon icon={<ClockCircleOutlined />} message="Zeko invite sent — awaiting interview"
          description="Scores appear here automatically once Zeko results sync." />
      );
    } else if (stage.type === 'assessment') {
      body = (
        <>
          <Row gutter={[8, 8]} style={{ marginBottom: 10 }}>
            <Col span={8}><Card size="small"><Statistic title="IQ (GA) score" value={round.iq ?? '—'} suffix={round.iq != null ? '%' : ''} /></Card></Col>
            <Col span={8}><Card size="small"><Statistic title="Technical score" value={round.tech ?? '—'} suffix={round.tech != null ? '%' : ''} /></Card></Col>
            <Col span={8}><Card size="small"><Statistic title="Test date" value={round.testDate || '—'} /></Card></Col>
          </Row>
          {round.importedFrom
            ? <Alert type="success" showIcon message={`Imported from ${round.importedFrom}`} style={{ marginBottom: 10 }} />
            : <Alert type="warning" showIcon message={round.note || 'Result awaited — import the Evalground CSV to fill scores'} style={{ marginBottom: 10 }} />}
          {round.note && round.importedFrom && <Alert type="warning" showIcon message={round.note} style={{ marginBottom: 10 }} />}
          {isCurrent && (
            <Button icon={<ImportOutlined />} onClick={() => setImportOpen(true)}>Import Evalground results (CSV)</Button>
          )}
        </>
      );
    } else if (stage.type === 'interview') {
      body = (
        <>
          {round.schedule ? (
            <Descriptions size="small" column={2} bordered style={{ marginBottom: 10 }} items={[
              { key: '1', label: 'When', children: round.schedule.when },
              { key: '2', label: round.schedule.mode === 'Client call' ? 'Client contact' : 'Interviewer', children: round.schedule.who },
              { key: '3', label: 'Mode', children: round.schedule.mode === 'Client call' ? 'Client call (manual)' : 'Microsoft Teams (Outlook invite auto-sent)' },
              { key: '4', label: 'Reminders', children: round.remindersSent ? `${round.remindersSent} daily feedback reminder(s) sent — repeats until submitted (no escalation, Q7)` : 'Candidate 30 min before · interviewer 30 min before · feedback daily until submitted' },
            ]} />
          ) : (
            <Alert type="info" showIcon message="Not scheduled yet" description="Use “Schedule interview” below — fixed time or candidate self-scheduling; the Outlook invite with Teams link is sent automatically." style={{ marginBottom: 10 }} />
          )}
          {round.feedback ? (
            <>
              <Alert type="success" showIcon icon={<CheckCircleOutlined />}
                message={<Space wrap><Text strong>{round.feedback.by}</Text><Tag color="green">{round.feedback.rec}</Tag>{round.feedback.avg && <Tag>{round.feedback.avg}/5</Tag>}</Space>}
                description={`${round.feedback.note} — RT records the official round outcome below.`} style={{ marginBottom: 8 }} />
              <Alert type="info" showIcon icon={<RobotOutlined />} style={{ marginBottom: 10 }}
                message="AI feedback summary"
                description={`Skill ratings and remarks read as consistent with the recommendation (${round.feedback.rec}); no contradictions flagged between the scores and the written note. Advisory only — RT still decides Approve / Hold / Reject.`} />
            </>
          ) : round.status === 'await' ? (
            <Alert type="warning" showIcon icon={<ClockCircleOutlined />} message="Awaiting interviewer feedback"
              description={<span>The interviewer got a tokenized scorecard link — no ATS login. <Button size="small" onClick={() => setCardOpen(true)}>Open scorecard</Button></span>} style={{ marginBottom: 10 }} />
          ) : null}
          {round.note && <Alert type="info" showIcon message={round.note} style={{ marginBottom: 10 }} />}
        </>
      );
    } else if (stage.type === 'docs') {
      const checklist = round.checklist || [
        { name: 'Govt ID (Aadhaar/PAN)', status: 'pending' },
        { name: 'Education certificates', status: 'pending' },
        { name: 'Experience / relieving letters', status: 'pending' },
        { name: 'Last 3 payslips', status: 'pending' },
      ];
      body = (
        <>
          <Table size="small" pagination={false} rowKey="name" style={{ marginBottom: 10 }}
            columns={[
              { title: 'Document', dataIndex: 'name', render: (v) => <Space><FileTextOutlined /><Text strong>{v}</Text></Space> },
              { title: 'Status', dataIndex: 'status', width: 190, render: (v) => <Tag color={DOC_TAG[v].color}>{DOC_TAG[v].label}</Tag> },
              {
                title: '', dataIndex: 'status', key: 'a', width: 150,
                render: (v) => isCurrent && v === 'uploaded' && (
                  <Space size={4}>
                    <Button size="small" onClick={() => message.success('Document verified')}>Verify</Button>
                    <Button size="small" danger onClick={() => message.warning('Rejected — re-request sent with reason')}>Reject…</Button>
                  </Space>
                ),
              },
            ]}
            dataSource={checklist} />
          {isCurrent && (
            <Space wrap style={{ marginBottom: 10 }}>
              <Button type="primary" onClick={() => message.success('Document request sent — secure upload link emailed to the candidate (vendor not copied)')}>Send document request</Button>
              <Button onClick={() => message.info('Reminder sent — will repeat until documents arrive')}>Send reminder</Button>
            </Space>
          )}
          <Alert type="info" showIcon message="Candidate uploads via a secure link — no login. Vendors never see documents or these emails (Q5). Completeness is automatic; authenticity stays with RT." />
        </>
      );
    } else if (stage.type === 'offer') {
      body = (
        <>
          {round.offer ? (
            <>
              {round.offer.approval && (
                <Alert type="success" showIcon icon={<CheckCircleOutlined />} style={{ marginBottom: 10 }}
                  message={`Internal approval: ${round.offer.approval}`}
                  description="Approval is recorded in-app by the recruiter, with a daily nudge until done — skippable in exceptional cases (Q3/Q26)." />
              )}
              <Alert type="info" showIcon icon={<FileTextOutlined />} style={{ marginBottom: 10 }}
                message={<Space wrap><Text strong>{round.offer.file}</Text><Tag color="blue">{round.offer.decision}</Tag></Space>}
                description={`Shared offline by HR ${round.offer.shared} — recorded here · proposed joining ${round.offer.join}`} />
              {isCurrent && (
                <Space wrap style={{ marginBottom: 16 }}>
                  <Button style={{ color: 'var(--green, #4a7c59)', borderColor: 'var(--green, #4a7c59)' }}
                    onClick={() => message.success('Offer marked Accepted — closure options unlocked; record auto-closes 90 days after Joined (Q12)')}>Mark Accepted</Button>
                  <Button danger onClick={() => message.warning('Offer marked Rejected — reason captured')}>Mark Rejected</Button>
                </Space>
              )}
            </>
          ) : (
            <Alert type="info" showIcon style={{ marginBottom: 16 }} message="No offer recorded yet"
              description="Record-only (Q3): HR shares the letter from its own mailbox. Here you request in-app approval (recruiter; daily nudge), then record the shared date, letter file and the candidate's decision. No validity timer, no version tracking — revisions are handled manually." />
          )}
          {isCurrent && (
            <>
              <Title level={5} style={{ fontSize: 13 }}>Close candidate</Title>
              <Space wrap>
                <Select value={closeStatus} onChange={setCloseStatus} style={{ minWidth: 240 }}
                  options={['Joined', 'Candidate Withdrawn', 'Did Not Join', 'Backed Out', 'Joined and Left', 'Rejected', 'On Hold'].map((v) => ({ value: v, label: v }))} />
                <Button danger onClick={() => {
                  const draft = closureEmailDraft(current, closeStatus);
                  setCloseSubject(draft.subject);
                  setCloseBody(draft.body);
                  setCloseOpen(true);
                }}>Close candidate record</Button>
              </Space>
            </>
          )}
        </>
      );
    }

    return (
      <Card size="small" title={head} style={{ marginTop: 4 }}>
        {body}
        {round?.emails?.length > 0 && (
          <>
            <Title level={5} style={{ fontSize: 12.5, marginTop: 14 }}>Emails in this round</Title>
            <Timeline items={round.emails.map((e) => ({ dot: <MailOutlined style={{ fontSize: 12 }} />, color: 'blue', children: <Text style={{ fontSize: 12.5 }}>{e}</Text> }))} />
          </>
        )}
        {isCurrent && stage.type !== 'offer' && (
          <>
            <div style={{ borderTop: '1px solid var(--border-2, #eaebe8)', margin: '12px -12px 12px', paddingTop: 12, paddingInline: 12 }}>
              <Space wrap>
                <Button icon={<CheckOutlined />} style={{ color: 'var(--green, #4a7c59)', borderColor: 'var(--green, #4a7c59)' }}
                  onClick={() => openOutcomeModal('approved')}>Approve round</Button>
                <Button icon={<PauseCircleOutlined />} style={{ color: '#d4a017', borderColor: '#d4a017' }}
                  onClick={() => openOutcomeModal('hold')}>Hold</Button>
                <Button danger icon={<CloseOutlined />} onClick={() => openOutcomeModal('rejected')}>Reject</Button>
                {stage.type === 'interview' && !round?.feedback && (
                  <Button icon={<CalendarOutlined />} onClick={() => setSchedOpen(true)}>{round?.schedule ? 'Reschedule' : 'Schedule interview'}</Button>
                )}
              </Space>
              <Alert type="info" showIcon icon={<MailOutlined />} style={{ marginTop: 10 }}
                message={current.src === 'Vendor'
                  ? `Outcome emails go to the candidate AND ${current.vendor} automatically (placement-vendor rule). Sensitive rounds send the vendor a status-only note.`
                  : 'Outcome emails go to the candidate automatically, from the recruitment mailbox, with open tracking.'} />
            </div>
          </>
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
          <Title level={3} style={{ margin: 0 }}>Candidate Pipeline</Title>
          <Text type="secondary">Phase 3 walkthrough prototype — mock data, nothing is saved, no emails are sent</Text>
        </div>
      </Space>
      <Alert type="warning" showIcon closable style={{ marginBottom: 14 }}
        message="Prototype for the RT walkthrough — v3, your answers of 2026-07-13 applied"
        description="Candidates enter here when shortlisted from Candidate Screening (vendor submissions included, carrying their vendor tag). Click a candidate, then click any completed round in the stepper to see that round's details — future rounds are locked. Pipeline analytics lives as a tab in the Analytics page. Applied answers: 30-min reminders + daily feedback reminder (no escalation), manual-only Hold, record-only offer with in-app approval, Evalground 50% pass mark with latest-attempt rule, concurrent MRF journeys (see the '2 MRFs' badge), both scheduling modes, and your interview evaluation scorecard format." />
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
            <Space size={4} wrap style={{ marginBottom: 14 }}>
              <SourceTag c={current} />
              <ChipTag chip={current.chip} />
              <AlsoActiveTag c={current} />
              <Tag>{current.age} days in round</Tag>
            </Space>
            <div style={{ overflowX: 'auto', paddingBottom: 6, marginBottom: 4 }}>
              <Steps size="small" current={selectedRound} onChange={(i) => setSelectedRound(i)}
                status={current.chip === 'hold' && selectedRound === currentIdx ? 'error' : 'process'}
                style={{ minWidth: 980 }}
                items={STAGES.map((s, i) => ({
                  title: <span style={{ fontSize: 11 }}>{s.short}</span>,
                  disabled: i > currentIdx,
                  status: i < currentIdx ? 'finish' : i === currentIdx ? undefined : 'wait',
                }))} />
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
            <Card size="small" style={{ background: 'var(--surface-2, #f7f8f4)' }}>
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
