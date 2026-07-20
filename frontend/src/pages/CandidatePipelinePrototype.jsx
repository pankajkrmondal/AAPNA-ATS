/**
 * CandidatePipelinePrototype.jsx — Phase 3 Candidate Pipeline PROTOTYPE (v7).
 *
 * ⚠️ Walkthrough demo for the Recruitment Team only:
 *   - 100% mock data, kept in component state — no API calls, nothing saved.
 *   - No emails are sent; every "email sent" message is simulated.
 *   - Route: /candidate-pipeline-prototype, shown in the sidebar as "Candidate
 *     Pipeline" (labelled "(Preview)" in the breadcrumb) — despite an earlier
 *     version of this comment, it is NOT hidden from the sidebar menu.
 *   - Delete this file + its route once Phase 3 Module 1 ships the real
 *     Candidate Pipeline.
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
 * v4 — frontend-only fixes from RT's live walkthrough:
 *   1. Board no longer shows "Shortlisted" as a working column — that decision
 *      already happens in Candidate Screening. It now starts at HR Screening
 *      (Zeko). Shortlist context (JD match, who/when) still shows read-only
 *      at the top of the candidate drawer.
 *   2. Both Zeko rounds (HR Screening + Functional) now speak the same status
 *      vocabulary and score fields as the real, already-live Zeko integration
 *      in Analytics.jsx / CandidateScreening.jsx (screeningService.assignZekoJob /
 *      scheduleZekoInterview / cancelZekoInterview): NOT ASSIGNED / PENDING /
 *      SENT / COMPLETED status, and Zeko Interview / Coding / Communication
 *      scores. Each round now has explicit "Assign Zeko Job" → "Schedule
 *      interview" (send) → result-received → Approve/Hold/Reject actions;
 *      Approve is disabled until a result is received.
 *   3. Evalground: added the single-result-via-Outlook import path alongside
 *      the existing bulk CSV import (RT-confirmed two import mechanisms), and
 *      an explicit "Send/Resend assessment invite" action on the round.
 *   4. The interviewer scorecard modal is relabelled as a preview of the
 *      externally-hosted, tokenized-link feedback form (same public-route
 *      pattern as /mrf/:id/approve) — feedback is not captured inside the
 *      ATS admin drawer.
 *
 * v5 — AI features (UI-mocked; a real build would reuse the same
 *      OpenRouter/Gemini call already used for resume parsing in
 *      hrUpload.service.js — no new backend "agent" architecture needed):
 *   1. Stuck-candidate rows in the pipeline analytics tab get an AI one-liner
 *      (why it's stuck + a suggested action) next to the "Blocked on" tag.
 *   2. Natural-language search box above the board — free text like "React
 *      developers on hold" resolves into the existing Role/Source/Hold/Stuck
 *      filters (mock keyword parser here; a real version would call an LLM).
 *   3. Evalground import drops the rigid "Map columns" step — rows are read
 *      schema-free, the same concept HR Upload already uses for bulk .xlsx
 *      candidate sheets (hrUpload.service.js: flatten each row to text, let
 *      the model extract the fields) — and unmatched/malformed rows get a
 *      plain-language AI explanation instead of raw error text.
 *   4. Schedule Interview can attach an AI interviewer prep brief (rolls up
 *      Zeko/Evalground scores + prior round notes into one paragraph) to the
 *      Outlook/Teams invite — on by default, previewable, toggleable.
 *   5. Once interviewer feedback is in, an AI summary + suggested action
 *      appears next to it — RT still clicks Approve/Hold/Reject, the AI
 *      never decides.
 *
 * v6 — every round now follows invite sent → outcome received → decision,
 *      and the decision step shows an editable outcome email:
 *   1. Zeko, Assessment, Tech/HR/CEO/Client interview, and Docs rounds all
 *      already had an invite-sent step (Assign/Schedule Zeko, Send assessment
 *      invite, Schedule interview, Send document request) and an
 *      outcome-received step (scores, feedback, checklist) — unchanged here.
 *   2. What's new: clicking Approve/Hold/Reject on any of those rounds now
 *      opens the decision modal with a real, editable outcome email already
 *      loaded — Subject + Body, pre-filled from the matching template in
 *      Email Templates (checked the live rpa_email_templates table: "Application
 *      On Hold" for Hold, "Rejection — Post Interview" for Reject). RT can
 *      edit before sending; edits apply to that email only, not the saved
 *      template (manage that in Email Templates itself).
 *   3. Gap found and flagged rather than papered over: there is no real
 *      "cleared this round, moving forward" template in Email Templates today
 *      — only Reject/Hold/Offer/interview-invite exist. Approved rounds show
 *      an editable draft tagged "Draft — no template yet" instead of a fake
 *      default, so it's visible this needs adding for the real Module 1 build.
 *   4. The Offer stage's "Close candidate record" action (previously instant)
 *      now opens the same kind of confirm-with-editable-email modal — also
 *      flagged as a template gap, since no closure template exists either.
 *
 * v7 — renamed the module. Checked what real ATS platforms call this
 *      (Ashby: "Candidate Pipeline"; Greenhouse: "Visual Candidate Pipeline";
 *      Zoho Recruit: "Hiring Pipeline"; none use "Tracker") and matched the
 *      convention: "Pipeline Tracker" → "Candidate Pipeline" everywhere —
 *      this file, the sidebar menu item, the breadcrumb, and the route
 *      (/pipeline-prototype → /candidate-pipeline-prototype). No behavior
 *      changed.
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
  PauseCircleOutlined, RobotOutlined, TeamOutlined, UserOutlined, WarningOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';

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

/**
 * Default outcome-email drafts shown (editable) when RT records a round decision.
 * `sourceName` names the real template it maps to in Email Templates
 * (rpa_email_templates, checked live: "Rejection — Post Interview" id 4,
 * "Application On Hold" id 18) — RT already manages the canonical wording there.
 * `approved` has no real counterpart yet: every stage has a reject/hold
 * template, none for "cleared this round" — flagged rather than invented.
 */
function resolveEmailTemplate(candidate, stage, outcome) {
  const position = candidate?.role || '';
  const firstName = (candidate?.name || '').split(' ')[0];
  if (outcome === 'hold') {
    return {
      sourceName: 'Application On Hold', gap: false,
      subject: `Your application status — ${position}`,
      body: `Hi ${firstName},\n\nYour application for ${position} is currently on hold. We'll update you as soon as there's progress.\n\nRegards,\nRecruitment Team`,
    };
  }
  if (outcome === 'rejected') {
    return {
      sourceName: 'Rejection — Post Interview', gap: false,
      subject: `Update on your application — ${position}`,
      body: `Hi ${firstName},\n\nThank you for your time through ${stage.name} for ${position}. We won't be proceeding at this stage.\n\nRegards,\nRecruitment Team`,
    };
  }
  return {
    sourceName: null, gap: true,
    subject: `Update on your application — ${position}`,
    body: `Hi ${firstName},\n\nGood news — you've cleared ${stage.name} for ${position}. We'll be in touch shortly about the next step.\n\nRegards,\nRecruitment Team`,
  };
}

/** Closure email draft for the Offer stage's "Close candidate record" action — also has no real template yet. */
function resolveClosureTemplate(candidate, closureStatus) {
  const position = candidate?.role || '';
  const firstName = (candidate?.name || '').split(' ')[0];
  return {
    sourceName: null, gap: true,
    subject: `Your recruitment process — ${position}`,
    body: `Hi ${firstName},\n\nThis is to confirm your status as "${closureStatus}" for ${position}. Thank you for your time throughout the process.\n\nRegards,\nRecruitment Team`,
  };
}

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
      zeko_hr: { outcome: 'approved', when: '05 Jul', by: 'Anita', zekoJob: 'Senior .NET Developer — Zeko HR', zekoStatus: 'completed', zeko: { interview: 82, coding: 79, communication: 78 }, emails: ['Zeko invite — opened', 'Outcome email — delivered'] },
      assessment: { outcome: 'approved', when: '08 Jul', by: 'Priya', iq: 78, tech: 74, testDate: '07 Jul', importedFrom: 'Evalground_Results_08Jul2026.csv', emails: ['Assessment invite — opened', 'Outcome email — delivered'] },
      zeko_fn: { outcome: 'approved', when: '09 Jul', by: 'Anita', zekoJob: 'Senior .NET Developer — Zeko Functional', zekoStatus: 'completed', zeko: { interview: 80, coding: 78, communication: 77 }, emails: ['Outcome email — delivered'] },
      tech1: { status: 'scheduled', schedule: { when: '13 Jul, 11:00', who: 'Suresh Menon', mode: 'Teams' }, emails: ['Outlook invite (Teams) — candidate opened'] },
    },
  },
  {
    id: 2, name: 'Kavya Nair', role: 'Senior .NET Developer', src: 'Vendor', vendor: 'TechBridge Solutions',
    stage: 'tech2', chip: 'await', age: 2, email: 'kavya.nair@outlook.com',
    rounds: {
      shortlist: { outcome: 'approved', when: '28 Jun', by: 'Priya', jdMatch: 88, emails: ['Welcome + process email → candidate + vendor'] },
      zeko_hr: { outcome: 'approved', when: '30 Jun', by: 'Anita', zekoJob: 'Senior .NET Developer — Zeko HR', zekoStatus: 'completed', zeko: { interview: 88, coding: 86, communication: 85 }, emails: ['Outcome email → candidate + vendor'] },
      assessment: { outcome: 'approved', when: '01 Jul', by: 'Priya', iq: 84, tech: 86, testDate: '30 Jun', importedFrom: 'Evalground_Results_01Jul2026.csv', emails: ['Outcome email → candidate + vendor'] },
      zeko_fn: { outcome: 'approved', when: '01 Jul', by: 'Anita', zekoJob: 'Senior .NET Developer — Zeko Functional', zekoStatus: 'completed', zeko: { interview: 86, coding: 85, communication: 84 }, emails: ['Outcome email → candidate + vendor'] },
      tech1: { outcome: 'approved', when: '02 Jul', by: 'Anita', schedule: { when: '01 Jul, 11:00', who: 'Suresh Menon', mode: 'Teams' }, feedback: { by: 'Suresh Menon', rec: 'Approve', avg: 4.3, note: 'Solid fundamentals, clean SQL.' }, emails: ['Outcome email → candidate + vendor'] },
      tech2: { status: 'await', schedule: { when: '07 Jul, 15:00', who: 'Deepa Rao', mode: 'Teams' }, remindersSent: 2, emails: ['Outlook invite (Teams) — both accepted', 'Feedback reminder #1, #2 → Deepa Rao'] },
    },
  },
  {
    id: 3, name: 'Ravi Shankar', role: 'QA Engineer', src: 'HR', stage: 'tech1', chip: 'await', age: 12,
    email: 'ravi.shankar@gmail.com',
    rounds: {
      shortlist: { outcome: 'approved', when: '20 Jun', by: 'Priya', jdMatch: 74, emails: ['Welcome + process email — opened'] },
      zeko_hr: { outcome: 'approved', when: '23 Jun', by: 'Anita', zekoJob: 'QA Engineer — Zeko HR', zekoStatus: 'completed', zeko: { interview: 74, coding: 72, communication: 70 }, emails: ['Outcome email — delivered'] },
      assessment: { outcome: 'approved', when: '25 Jun', by: 'Priya', iq: 71, tech: 69, testDate: '24 Jun', importedFrom: 'Evalground_Results_24Jun2026.csv', emails: ['Outcome email — delivered'] },
      zeko_fn: { outcome: 'approved', when: '26 Jun', by: 'Anita', zekoJob: 'QA Engineer — Zeko Functional', zekoStatus: 'completed', zeko: { interview: 72, coding: 71, communication: 71 }, emails: ['Outcome email — delivered'] },
      tech1: { status: 'await', schedule: { when: '27 Jun, 14:00', who: 'Suresh Menon', mode: 'Teams' }, remindersSent: 5, emails: ['Feedback reminders #1–#5 (one per day) → Suresh Menon', 'Card flagged "awaiting feedback 12 days" — no escalation (Q7)'] },
    },
  },
  {
    id: 4, name: 'Meena Iyer', role: 'Business Analyst', src: 'Email', stage: 'assessment', chip: 'review', age: 11,
    email: 'meena.iyer@yahoo.in',
    rounds: {
      shortlist: { outcome: 'approved', when: '24 Jun', by: 'Anita', jdMatch: 79, emails: ['Welcome + process email — opened'] },
      zeko_hr: { outcome: 'approved', when: '26 Jun', by: 'Priya', zekoJob: 'Business Analyst — Zeko HR', zekoStatus: 'completed', zeko: { interview: 79, coding: 80, communication: 82 }, emails: ['Outcome email — delivered'] },
      assessment: { status: 'review', testDate: '30 Jun', inviteSent: true, note: 'Test attempted — result awaited in next CSV import', emails: ['Assessment invite (GA + Technical) — opened'] },
    },
  },
  {
    id: 5, name: 'Farhan Ali', role: 'React Developer', src: 'Vendor', vendor: 'Talent Hive', stage: 'zeko_hr',
    chip: 'hold', age: 34, email: 'farhan.ali@gmail.com',
    rounds: {
      shortlist: { outcome: 'approved', when: '01 Jun', by: 'Priya', jdMatch: 70, emails: ['Welcome + process email → candidate + vendor'] },
      zeko_hr: { outcome: 'hold', reason: 'Weak communication', when: '05 Jun', by: 'Anita', zekoJob: 'React Developer — Zeko HR', zekoStatus: 'completed', zeko: { interview: 66, coding: 63, communication: 61 }, note: 'On Hold 34 days — manual review only (no auto-reminder/auto-close, Q10); aging badge keeps it visible', emails: ['On-hold email → candidate + vendor (status-only)'] },
    },
  },
  {
    id: 6, name: 'Sanya Kapoor', role: 'Power BI Developer', src: 'HR', stage: 'hr', chip: 'scheduled', age: 1,
    email: 'sanya.kapoor@gmail.com',
    rounds: {
      shortlist: { outcome: 'approved', when: '25 Jun', by: 'Priya', jdMatch: 85, emails: ['Welcome + process email — opened'] },
      zeko_hr: { outcome: 'approved', when: '26 Jun', by: 'Anita', zekoJob: 'Power BI Developer — Zeko HR', zekoStatus: 'completed', zeko: { interview: 85, coding: 86, communication: 88 }, emails: ['Outcome email — delivered'] },
      assessment: { outcome: 'approved', when: '27 Jun', by: 'Priya', iq: 81, tech: 83, testDate: '26 Jun', importedFrom: 'Evalground_Results_24Jun2026.csv', emails: ['Outcome email — delivered'] },
      zeko_fn: { outcome: 'approved', when: '27 Jun', by: 'Anita', zekoJob: 'Power BI Developer — Zeko Functional', zekoStatus: 'completed', zeko: { interview: 84, coding: 85, communication: 86 }, emails: ['Outcome email — delivered'] },
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
      zeko_hr: { outcome: 'approved', when: '17 Jun', by: 'Anita', zekoJob: 'Senior .NET Developer — Zeko HR', zekoStatus: 'completed', zeko: { interview: 90, coding: 88, communication: 86 }, emails: ['Outcome email → candidate + vendor'] },
      assessment: { outcome: 'approved', when: '19 Jun', by: 'Priya', iq: 88, tech: 91, testDate: '18 Jun', importedFrom: 'Evalground_Results_24Jun2026.csv', emails: ['Outcome email → candidate + vendor'] },
      zeko_fn: { outcome: 'approved', when: '20 Jun', by: 'Anita', zekoJob: 'Senior .NET Developer — Zeko Functional', zekoStatus: 'completed', zeko: { interview: 89, coding: 88, communication: 87 }, emails: ['Outcome email → candidate + vendor'] },
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
      zeko_hr: { outcome: 'approved', when: '12 Jun', by: 'Anita', zekoJob: 'Business Analyst — Zeko HR', zekoStatus: 'completed', zeko: { interview: 87, coding: 88, communication: 90 }, emails: ['Outcome email — delivered'] },
      assessment: { outcome: 'approved', when: '14 Jun', by: 'Priya', iq: 83, tech: 80, testDate: '13 Jun', importedFrom: 'Evalground_Results_24Jun2026.csv', emails: ['Outcome email — delivered'] },
      zeko_fn: { outcome: 'approved', when: '16 Jun', by: 'Anita', zekoJob: 'Business Analyst — Zeko Functional', zekoStatus: 'completed', zeko: { interview: 85, coding: 87, communication: 89 }, emails: ['Outcome email — delivered'] },
      tech1: { outcome: 'approved', when: '20 Jun', by: 'Priya', schedule: { when: '19 Jun, 11:00', who: 'Vikram Joshi', mode: 'Teams' }, feedback: { by: 'Vikram Joshi', rec: 'Approve', avg: 4.2, note: 'Strong requirements elicitation.' }, emails: ['Outcome email — delivered'] },
      tech2: { outcome: 'approved', when: '25 Jun', by: 'Anita', schedule: { when: '24 Jun, 15:00', who: 'Deepa Rao', mode: 'Teams' }, feedback: { by: 'Deepa Rao', rec: 'Approve', avg: 4.4, note: 'Excellent case handling.' }, emails: ['Outcome email — delivered'] },
      hr: { outcome: 'approved', when: '01 Jul', by: 'Nisha (RT)', emails: ['Outcome email — delivered'] },
      docs: { outcome: 'approved', when: '05 Jul', by: 'Anita', note: 'All documents verified', emails: ['Document request — completed'] },
      offer: { status: 'offer_sent', offer: { file: 'Offer_IshitaBose_BA.pdf', shared: '07 Jul 2026', join: '04 Aug 2026', decision: 'Awaiting decision', approval: 'Approved in-app by Priya (recruiter) · 06 Jul' }, emails: ['Approval nudge (daily) → Priya — approved 06 Jul', 'Offer shared offline by HR — recorded in ATS 07 Jul'] },
    },
  },
  {
    id: 9, name: 'Rohit Kulkarni', role: 'QA Engineer', src: 'Email', stage: 'zeko_hr', chip: 'review', age: 1,
    email: 'rohit.k@gmail.com',
    rounds: {
      shortlist: { status: 'review', jdMatch: 72, when: 'yesterday', note: 'Shortlisted from Candidate Screening (email intake)', emails: ['Welcome + process email — sent'] },
      zeko_hr: { status: 'review' },
    },
  },
  {
    id: 10, name: 'Ananya Singh', role: 'React Developer', src: 'HR', stage: 'zeko_hr', chip: 'review', age: 2,
    email: 'ananya.s@gmail.com', also: 'UI Developer (MRF-2044)',
    rounds: {
      shortlist: { status: 'review', jdMatch: 81, when: '2 days ago', note: 'Shortlisted from Candidate Screening (JD match 81%). Also running a second journey for UI Developer (MRF-2044) — concurrent MRFs allowed (Q13); a rejection there would not stop this journey.', emails: ['Welcome + process email — opened'] },
      zeko_hr: { status: 'review' },
    },
  },
  {
    id: 11, name: 'Vishal Gupta', role: 'Senior .NET Developer', src: 'Vendor', vendor: 'Talent Hive',
    stage: 'zeko_fn', chip: 'invited', age: 5, email: 'vishal.g@outlook.com',
    rounds: {
      shortlist: { outcome: 'approved', when: '27 Jun', by: 'Priya', jdMatch: 76, emails: ['Welcome + process email → candidate + vendor'] },
      zeko_hr: { outcome: 'approved', when: '30 Jun', by: 'Anita', zekoJob: 'Senior .NET Developer — Zeko HR', zekoStatus: 'completed', zeko: { interview: 76, coding: 75, communication: 74 }, emails: ['Outcome email → candidate + vendor'] },
      assessment: { outcome: 'approved', when: '03 Jul', by: 'Priya', iq: 80, tech: 78, testDate: '02 Jul', importedFrom: 'Evalground_Results_01Jul2026.csv', emails: ['Outcome email → candidate + vendor'] },
      zeko_fn: { zekoJob: 'Senior .NET Developer — Zeko Functional', zekoStatus: 'sent', emails: ['Zeko functional screening invitation — sent to candidate + vendor'] },
    },
  },
  {
    id: 12, name: 'Priyanka Das', role: 'Power BI Developer', src: 'HR', stage: 'ceo', chip: 'scheduled', age: 2,
    email: 'priyanka.das@gmail.com',
    rounds: {
      shortlist: { outcome: 'approved', when: '18 Jun', by: 'Priya', jdMatch: 84, emails: ['Welcome + process email — opened'] },
      zeko_hr: { outcome: 'approved', when: '20 Jun', by: 'Anita', zekoJob: 'Power BI Developer — Zeko HR', zekoStatus: 'completed', zeko: { interview: 84, coding: 83, communication: 82 }, emails: ['Outcome email — delivered'] },
      assessment: { outcome: 'approved', when: '23 Jun', by: 'Priya', iq: 79, tech: 82, testDate: '22 Jun', importedFrom: 'Evalground_Results_24Jun2026.csv', emails: ['Outcome email — delivered'] },
      zeko_fn: { outcome: 'approved', when: '24 Jun', by: 'Anita', zekoJob: 'Power BI Developer — Zeko Functional', zekoStatus: 'completed', zeko: { interview: 83, coding: 82, communication: 81 }, emails: ['Outcome email — delivered'] },
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
      zeko_hr: { outcome: 'approved', when: '15 Jun', by: 'Anita', zekoJob: 'Business Analyst — Zeko HR', zekoStatus: 'completed', zeko: { interview: 80, coding: 82, communication: 84 }, emails: ['Outcome email — delivered'] },
      assessment: { outcome: 'approved', when: '18 Jun', by: 'Priya', iq: 77, tech: 75, testDate: '17 Jun', importedFrom: 'Evalground_Results_24Jun2026.csv', emails: ['Outcome email — delivered'] },
      zeko_fn: { outcome: 'approved', when: '20 Jun', by: 'Anita', zekoJob: 'Business Analyst — Zeko Functional', zekoStatus: 'completed', zeko: { interview: 81, coding: 82, communication: 83 }, emails: ['Outcome email — delivered'] },
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
      zeko_hr: { outcome: 'approved', when: '05 Jul', by: 'Priya', zekoJob: 'QA Engineer — Zeko HR', zekoStatus: 'completed', zeko: { interview: 77, coding: 76, communication: 75 }, emails: ['Outcome email — delivered'] },
      assessment: { status: 'imported', iq: 46, tech: 70, testDate: '07 Jul', importedFrom: 'Evalground_Results_08Jul2026.csv', inviteSent: true, note: 'IQ 46% — below the 50% pass mark (Q4); auto-suggests Failed, RT decides', emails: ['Assessment invite — opened'] },
    },
  },
];

const FUNNEL = [
  ['HR Screening (Zeko)', 22], ['IQ / Tech Assessment', 19],
  ['Functional (Zeko)', 14], ['Tech Round 1', 9], ['Tech Round 2', 5],
  ['HR Round', 3], ['CEO / Final', 2], ['Offer', 1],
];

/**
 * CandidatePipelineAnalyticsPreview — the Candidate Pipeline analytics tab
 * content (mock data). Rendered inside the EXISTING Analytics page (single
 * analytics page — RT decision 2026-07-10). Exported separately so
 * Analytics.jsx can mount it as a tab; delete together with this prototype
 * when the real Candidate Pipeline ships.
 */
export function CandidatePipelineAnalyticsPreview() {
  return (
    <>
      <Alert type="warning" showIcon style={{ marginBottom: 14 }}
        message="Preview — mock data from the Candidate Pipeline prototype; becomes live analytics in Phase 3 Module 1." />
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
                  title: 'Blocked on', dataIndex: 'b', render: (b, record) => (
                    <Space direction="vertical" size={3}>
                      <Tag color="gold">{b}</Tag>
                      <Tooltip title="AI-generated suggestion — verify before acting">
                        <Space size={4} align="start">
                          <RobotOutlined style={{ fontSize: 11, color: '#7c5cff', marginTop: 2 }} />
                          <Text type="secondary" style={{ fontSize: 11.5 }}>{record.ai}</Text>
                        </Space>
                      </Tooltip>
                    </Space>
                  ),
                },
              ]}
              dataSource={[
                { k: 1, n: 'Ravi Shankar', s: 'Tech Round 1', d: 12, b: 'Awaiting feedback — Suresh M.', ai: "12 days, well past the 2-day reminder cadence. Suggest pinging Suresh directly or reassigning the interview." },
                { k: 2, n: 'Meena Iyer', s: 'IQ / Tech Assessment', d: 11, b: 'Evalground result not imported', ai: 'Test was attempted 11 days ago with no result file imported yet. Suggest checking with Evalground/RT for the overdue CSV.' },
                { k: 3, n: 'Farhan Ali', s: 'On Hold (Zeko HR)', d: 34, b: 'Manual hold review', ai: 'On Hold 34 days — no auto-review by design (Q10), but this is well past a typical review window. Suggest revisiting manually.' },
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
 * AI interviewer prep brief — rolls up whatever the candidate already has
 * (Zeko scores, Evalground scores, prior interviewer notes) into one short
 * paragraph attached to the interview invite. Purely a summary of existing
 * data, not a new judgement — the interviewer still forms their own view.
 */
function buildPrepBrief(candidate) {
  if (!candidate) return '';
  const bits = [`${candidate.name} — ${candidate.role}${candidate.src === 'Vendor' ? ` (via ${candidate.vendor})` : ''}.`];
  const zHr = candidate.rounds.zeko_hr;
  if (zHr?.zeko) bits.push(`Zeko HR Screening — interview ${zHr.zeko.interview}, coding ${zHr.zeko.coding}, communication ${zHr.zeko.communication}.`);
  const zFn = candidate.rounds.zeko_fn;
  if (zFn?.zeko) bits.push(`Zeko Functional — interview ${zFn.zeko.interview}, coding ${zFn.zeko.coding}, communication ${zFn.zeko.communication}.`);
  const asmt = candidate.rounds.assessment;
  if (asmt?.iq != null || asmt?.tech != null) bits.push(`Evalground — IQ ${asmt.iq ?? '—'}%, Technical ${asmt.tech ?? '—'}%.`);
  const priorNotes = STAGES
    .map((s) => candidate.rounds[s.key])
    .filter((r) => r?.feedback)
    .map((r) => `"${r.feedback.note}" (${r.feedback.rec}, ${r.feedback.avg}/5)`);
  if (priorNotes.length) bits.push(`Prior interviewer notes: ${priorNotes.join(' · ')}`);
  if (bits.length === 1) bits.push('Early in the pipeline — no prior scores or notes yet.');
  return bits.join(' ');
}

/** AI-drafted summary of the interviewer's submitted scorecard — a suggestion, RT still decides via Approve/Hold/Reject. */
function aiFeedbackSummary(feedback) {
  if (!feedback) return '';
  const tone = feedback.avg >= 4.2 ? 'Strong performance' : feedback.avg >= 3.5 ? 'Solid, generally positive signal'
    : feedback.avg >= 2.5 ? 'Mixed signal, worth a closer look' : 'Weak performance';
  return `${tone} — "${feedback.note}" (${feedback.avg}/5 avg from ${feedback.by}). Suggested action: ${feedback.rec}.`;
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
  const [nlExplain, setNlExplain] = useState('');

  const [outcomeOpen, setOutcomeOpen] = useState(false);
  const [outcome, setOutcome] = useState('approved');
  const [reason, setReason] = useState();
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [emailMeta, setEmailMeta] = useState({ sourceName: null, gap: false });
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [closureStatus, setClosureStatus] = useState('Joined');
  const [closeEmailSubject, setCloseEmailSubject] = useState('');
  const [closeEmailBody, setCloseEmailBody] = useState('');
  const [schedOpen, setSchedOpen] = useState(false);
  const [schedMode, setSchedMode] = useState('fixed');
  const [attachBrief, setAttachBrief] = useState(true);
  const [cardOpen, setCardOpen] = useState(false);
  const [cardRec, setCardRec] = useState('Approve');
  const [importOpen, setImportOpen] = useState(false);
  const [importMode, setImportMode] = useState('bulk');
  const [zekoAssignOpen, setZekoAssignOpen] = useState(false);
  const [zekoJobChoice, setZekoJobChoice] = useState();
  const [zekoCancelOpen, setZekoCancelOpen] = useState(false);
  const [zekoCancelReason, setZekoCancelReason] = useState();

  const current = candidates.find((c) => c.id === openId) || null;
  const currentIdx = current ? stageIdx(current.stage) : 0;

  const filtered = useMemo(
    () => candidates.filter((c) =>
      (!fRole || c.role === fRole) &&
      (!fSrc || c.src === fSrc) &&
      (!fHold || c.chip === 'hold') &&
      (!fStuck || c.age > 10)),
    [candidates, fRole, fSrc, fHold, fStuck],
  );
  const roles = [...new Set(INITIAL_CANDIDATES.map((c) => c.role))];

  /* ---- AI: natural-language board search (reads free text into the filters above) ---- */
  const applyNlQuery = (text) => {
    const q = text.trim();
    if (!q) return;
    const lower = q.toLowerCase();
    const explain = [];

    const roleMatch = roles.find((r) => lower.includes(r.toLowerCase())
      || r.toLowerCase().split(' ').some((word) => word.length > 3 && lower.includes(word)));
    setFRole(roleMatch);
    if (roleMatch) explain.push(`role = "${roleMatch}"`);

    let srcMatch;
    if (lower.includes('vendor')) srcMatch = 'Vendor';
    else if (lower.includes('hr upload') || lower.includes('hr-sourced') || /\bhr\b/.test(lower)) srcMatch = 'HR';
    else if (lower.includes('email intake') || lower.includes('inbound email')) srcMatch = 'Email';
    setFSrc(srcMatch);
    if (srcMatch) explain.push(`source = "${srcMatch}"`);

    const holdMatch = lower.includes('hold');
    setFHold(holdMatch);
    if (holdMatch) explain.push('On Hold only');

    const stuckMatch = /\bstuck\b|\boverdue\b|\bover\s*\d+\s*days?\b|\b\d+\+?\s*days?\b/.test(lower);
    setFStuck(stuckMatch);
    if (stuckMatch) explain.push('stuck > 10 days');

    setNlExplain(explain.length ? `Read as: ${explain.join(' · ')}` : "Didn't recognize anything specific — showing all candidates.");
  };

  const openCandidate = (id) => {
    const c = candidates.find((x) => x.id === id);
    setOpenId(id);
    setSelectedRound(c ? stageIdx(c.stage) : 0);
  };

  const patchCurrent = (patch) => setCandidates((prev) => prev.map((c) => (c.id === openId ? { ...c, ...patch } : c)));

  /* ---- actions (current round only) ---- */

  /** Opens the round-decision modal with the right default outcome email already loaded (editable) — the "for auto approves, default template is shared" behavior. */
  const openOutcome = (value) => {
    if (!current) return;
    const stage = STAGES[currentIdx];
    const tmpl = resolveEmailTemplate(current, stage, value);
    setOutcome(value);
    setReason(undefined);
    setEmailSubject(tmpl.subject);
    setEmailBody(tmpl.body);
    setEmailMeta({ sourceName: tmpl.sourceName, gap: tmpl.gap });
    setOutcomeOpen(true);
  };

  const saveOutcome = () => {
    if (!current) return;
    const stage = STAGES[currentIdx];
    const mailTo = mailAudience(current);
    const round = current.rounds[stage.key] || {};
    if (outcome === 'approved') {
      const next = STAGES[Math.min(currentIdx + 1, STAGES.length - 1)];
      patchCurrent({
        stage: next.key, chip: 'review', age: 0,
        rounds: {
          ...current.rounds,
          [stage.key]: { ...round, status: undefined, outcome: 'approved', when: 'just now', by: 'You', emails: [...(round.emails || []), `Outcome email → ${mailTo} — "${emailSubject}"`] },
          [next.key]: current.rounds[next.key] || { status: 'review' },
        },
      });
      setSelectedRound(Math.min(currentIdx + 1, STAGES.length - 1));
      message.success(`${stage.name} approved — email sent to ${mailTo}; candidate moved to ${next.name}`);
    } else if (outcome === 'hold') {
      patchCurrent({
        chip: 'hold',
        rounds: { ...current.rounds, [stage.key]: { ...round, status: undefined, outcome: 'hold', reason, when: 'just now', by: 'You', emails: [...(round.emails || []), `On-hold email → ${mailTo} — "${emailSubject}"`] } },
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
    const briefNote = attachBrief ? ['AI interviewer prep brief — attached to the invite'] : [];
    if (schedMode === 'slots') {
      patchCurrent({
        chip: 'invited',
        rounds: { ...current.rounds, [stage.key]: { ...round, status: 'invited', emails: [...(round.emails || []), 'Self-scheduling link (3 published slots) → candidate', ...briefNote] } },
      });
      setSchedOpen(false);
      message.success('Slots published — the candidate picks one from the emailed link; the Teams invite goes out automatically on pick');
      return;
    }
    patchCurrent({
      chip: 'scheduled',
      rounds: { ...current.rounds, [stage.key]: { ...round, status: 'scheduled', schedule: { when: '13 Jul, 11:00', who: 'Suresh Menon', mode: 'Teams' }, emails: [...(round.emails || []), 'Outlook invite (Teams) — sent; reminders armed', ...briefNote] } },
    });
    setSchedOpen(false);
    message.success(attachBrief ? 'Teams invite created with the AI prep brief attached — candidate & interviewer notified; reminders scheduled' : 'Teams invite created — candidate & interviewer notified; reminders scheduled');
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

  /* ---- Zeko actions (mirrors screeningService.assignZekoJob / scheduleZekoInterview / cancelZekoInterview) ---- */

  const assignZekoJob = () => {
    if (!current || !zekoJobChoice) return;
    const stage = STAGES[currentIdx];
    const round = current.rounds[stage.key] || {};
    patchCurrent({
      rounds: { ...current.rounds, [stage.key]: { ...round, zekoJob: zekoJobChoice, zekoStatus: 'pending' } },
    });
    setZekoAssignOpen(false);
    setZekoJobChoice(undefined);
    message.success('Candidate assigned to Zeko job');
  };

  const sendZekoInvite = () => {
    if (!current) return;
    const stage = STAGES[currentIdx];
    const round = current.rounds[stage.key] || {};
    patchCurrent({
      chip: 'invited',
      rounds: { ...current.rounds, [stage.key]: { ...round, zekoStatus: 'sent', emails: [...(round.emails || []), 'Zeko interview invitation — sent'] } },
    });
    message.success('Zeko interview scheduled — invitation email sent to the candidate');
  };

  const cancelZekoInterview = () => {
    if (!current || !zekoCancelReason) {
      message.warning('Please provide a cancellation reason');
      return;
    }
    const stage = STAGES[currentIdx];
    const round = current.rounds[stage.key] || {};
    patchCurrent({
      chip: 'review',
      rounds: { ...current.rounds, [stage.key]: { ...round, zekoStatus: 'pending', emails: [...(round.emails || []), `Zeko interview cancelled — ${zekoCancelReason}`] } },
    });
    setZekoCancelOpen(false);
    setZekoCancelReason(undefined);
    message.info('Zeko interview cancelled — candidate notified');
  };

  const sendAssessmentInvite = () => {
    if (!current) return;
    const stage = STAGES[currentIdx];
    const round = current.rounds[stage.key] || {};
    patchCurrent({
      chip: 'invited',
      rounds: { ...current.rounds, [stage.key]: { ...round, inviteSent: true, emails: [...(round.emails || []), round.inviteSent ? 'Assessment invite (GA + Technical) — resent' : 'Assessment invite (GA + Technical) — sent'] } },
    });
    message.success('Assessment invite sent — candidate can now take the Evalground test');
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

  const board = (
    <>
      <Space direction="vertical" size={4} style={{ width: '100%', marginBottom: 10 }}>
        <Input.Search
          allowClear
          placeholder="Ask in plain English — e.g. 'React developers on hold' or 'candidates stuck over 10 days'"
          prefix={<RobotOutlined style={{ color: '#7c5cff' }} />}
          style={{ maxWidth: 480 }}
          value={nlQuery}
          onChange={(e) => setNlQuery(e.target.value)}
          onSearch={applyNlQuery}
        />
        {nlExplain && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            <RobotOutlined style={{ marginInlineEnd: 4, color: '#7c5cff' }} />{nlExplain}
          </Text>
        )}
      </Space>
      <Space wrap style={{ marginBottom: 14 }}>
        <Select allowClear placeholder="Position" style={{ minWidth: 200 }} value={fRole}
          onChange={(v) => { setFRole(v); setNlExplain(''); }} options={roles.map((r) => ({ value: r, label: r }))} />
        <Select allowClear placeholder="Source" style={{ minWidth: 160 }} value={fSrc}
          onChange={(v) => { setFSrc(v); setNlExplain(''); }}
          options={[{ value: 'HR', label: 'HR upload' }, { value: 'Vendor', label: 'Placement vendor' }, { value: 'Email', label: 'Email intake' }]} />
        <Checkbox checked={fHold} onChange={(e) => { setFHold(e.target.checked); setNlExplain(''); }}>On Hold only</Checkbox>
        <Checkbox checked={fStuck} onChange={(e) => { setFStuck(e.target.checked); setNlExplain(''); }}>Stuck &gt; 10 days</Checkbox>
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
    } else if (stage.type === 'zeko') {
      const zs = round.zekoStatus;
      const ZEKO_STATUS_TAG = {
        pending: { label: 'PENDING', color: 'warning' },
        sent: { label: 'SENT', color: 'processing' },
        completed: { label: 'COMPLETED', color: 'success' },
      };
      body = (
        <>
          <Space style={{ marginBottom: 10 }} wrap>
            <Tag color={zs ? ZEKO_STATUS_TAG[zs].color : 'default'}>{zs ? ZEKO_STATUS_TAG[zs].label : 'NOT ASSIGNED'}</Tag>
            {round.zekoJob && <Text type="secondary" style={{ fontSize: 12.5 }}>Job: {round.zekoJob}</Text>}
          </Space>
          {round.zeko ? (
            <Row gutter={[8, 8]} style={{ marginBottom: 10 }}>
              <Col span={8}><Card size="small"><Statistic title="Zeko interview score" value={round.zeko.interview} /></Card></Col>
              <Col span={8}><Card size="small"><Statistic title="Zeko coding score" value={round.zeko.coding} /></Card></Col>
              <Col span={8}><Card size="small"><Statistic title="Zeko communication" value={round.zeko.communication} /></Card></Col>
            </Row>
          ) : zs === 'sent' ? (
            <Alert type="info" showIcon icon={<ClockCircleOutlined />} style={{ marginBottom: 10 }}
              message="Invitation sent — awaiting the candidate"
              description="This is the 'received from candidate?' signal: scores appear here automatically once Zeko results sync back, same as the live Zeko pipeline in Analytics." />
          ) : (
            <Alert type="warning" showIcon style={{ marginBottom: 10 }}
              message="Not assigned to a Zeko job yet"
              description="Assign a Zeko job, then schedule the interview — the candidate gets the invitation by email, exactly like Assign/Schedule in the Analytics → Zeko Interview Schedule flow." />
          )}
          {round.note && <Alert type="warning" showIcon message={round.note} style={{ marginBottom: 10 }} />}
          {isCurrent && (
            <Space wrap>
              {!round.zekoJob && <Button icon={<TeamOutlined />} onClick={() => setZekoAssignOpen(true)}>Assign Zeko Job</Button>}
              {round.zekoJob && zs !== 'sent' && !round.zeko && (
                <Button icon={<MailOutlined />} onClick={sendZekoInvite}>Schedule interview (sends invite)</Button>
              )}
              {zs === 'sent' && (
                <Button danger icon={<CloseOutlined />} onClick={() => setZekoCancelOpen(true)}>Cancel interview</Button>
              )}
            </Space>
          )}
        </>
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
            <Space wrap>
              <Button icon={<MailOutlined />} onClick={sendAssessmentInvite}>{round.inviteSent ? 'Resend assessment invite' : 'Send assessment invite'}</Button>
              <Button icon={<ImportOutlined />} onClick={() => setImportOpen(true)}>Import Evalground results</Button>
            </Space>
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
                description={`${round.feedback.note} — RT records the official round outcome below.`} style={{ marginBottom: 10 }} />
              <Alert type="info" showIcon={false}
                style={{ background: 'rgba(124,92,255,0.06)', borderColor: 'rgba(124,92,255,0.35)', marginBottom: 10 }}
                message={<Space size={6}><Tag color="purple" style={{ marginInlineEnd: 0 }}>AI</Tag><Text strong style={{ fontSize: 12.5 }}>AI summary</Text></Space>}
                description={<Text style={{ fontSize: 12.5 }}>{aiFeedbackSummary(round.feedback)}</Text>} />
            </>
          ) : round.status === 'await' ? (
            <Alert type="warning" showIcon icon={<ClockCircleOutlined />} message="Awaiting interviewer feedback"
              description={<span>The interviewer got a tokenized scorecard link — no ATS login. <Button size="small" onClick={() => setCardOpen(true)}>Preview interviewer's link</Button></span>} style={{ marginBottom: 10 }} />
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
                <Select value={closureStatus} onChange={setClosureStatus} style={{ minWidth: 240 }}
                  options={['Joined', 'Candidate Withdrawn', 'Did Not Join', 'Backed Out', 'Joined and Left', 'Rejected', 'On Hold'].map((v) => ({ value: v, label: v }))} />
                <Button danger onClick={() => {
                  const tmpl = resolveClosureTemplate(current, closureStatus);
                  setCloseEmailSubject(tmpl.subject);
                  setCloseEmailBody(tmpl.body);
                  setCloseConfirmOpen(true);
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
                <Tooltip title={stage.type === 'zeko' && !round?.zeko ? 'Waiting for the Zeko result to sync back before this round can be approved' : ''}>
                  <Button icon={<CheckOutlined />} disabled={stage.type === 'zeko' && !round?.zeko}
                    style={{ color: 'var(--green, #4a7c59)', borderColor: 'var(--green, #4a7c59)' }}
                    onClick={() => openOutcome('approved')}>Approve round</Button>
                </Tooltip>
                <Button icon={<PauseCircleOutlined />} style={{ color: '#d4a017', borderColor: '#d4a017' }}
                  onClick={() => openOutcome('hold')}>Hold</Button>
                <Button danger icon={<CloseOutlined />} onClick={() => openOutcome('rejected')}>Reject</Button>
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
      <Radio.Group value={importMode} onChange={(e) => setImportMode(e.target.value)} optionType="button" buttonStyle="solid"
        style={{ marginBottom: 14 }}
        options={[{ value: 'bulk', label: 'Bulk CSV' }, { value: 'single', label: 'Single result (via Outlook)' }]} />
      {importMode === 'bulk' ? (
        <>
          <Paragraph type="secondary" style={{ marginTop: 4 }}>
            Part of the Assessment round: the Evalground CSV (one file — GA + Technical, Q1) is matched <Text strong>by candidate email</Text> to
            candidates currently in this round, filling their IQ (GA) and Technical scores. Duplicate attempts use the <Text strong>latest row</Text>.
            Pass mark <Text strong>50%</Text> for both tests drives the Passed/Failed suggestion (Q4). Nothing is written until you confirm.
          </Paragraph>
          <Alert type="info" showIcon icon={<RobotOutlined />} style={{ marginBottom: 14 }}
            message={<Space size={6}><Tag color="purple" style={{ marginInlineEnd: 0 }}>AI</Tag><Text strong>No fixed column template needed</Text></Space>}
            description="Each row is read as-is by AI, the same way bulk resume spreadsheets are read in HR Upload — column headers don't need to match a template. It finds the candidate's email and both scores regardless of how the columns are named or ordered." />
          <Steps size="small" current={2} style={{ maxWidth: 620, marginBottom: 16 }}
            items={[{ title: 'Upload file' }, { title: 'AI reads rows' }, { title: 'Validate' }, { title: 'Import' }]} />
          <Alert type="info" showIcon icon={<FileTextOutlined />} style={{ marginBottom: 12 }}
            message="Evalground_Results_08Jul2026.csv"
            description="38 rows · uploaded by Priya (RT) · read directly by AI, no column mapping step" />
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
              { title: <Space size={4}><RobotOutlined style={{ fontSize: 11 }} /><span>AI's explanation</span></Space>, dataIndex: 'detail' },
              { title: '', dataIndex: 'a', width: 140, render: (a) => <Button size="small">{a}</Button> },
            ]}
            dataSource={[
              { row: 12, issue: 'Unmatched', detail: "rohit.k1993@gmail.com doesn't match anyone currently in this round — closest is rohit.k@gmail.com, but AI won't guess on emails.", a: 'Match manually…' },
              { row: 19, issue: 'Unmatched', detail: 'sneha.p@yahoo.co.in matches 2 candidates in this round — needs a human pick.', a: 'Review…' },
              { row: 22, issue: 'Duplicate', detail: 'meena.iyer@yahoo.in appears twice in this file; used the latest attempt (07 Jul), per the latest-attempt rule.', a: 'OK' },
              { row: 31, issue: 'Malformed', detail: 'Score reads "AB", not a number — looks like the candidate may have been absent rather than a data error.', a: 'Skip row' },
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
        </>
      ) : (
        <>
          <Paragraph type="secondary" style={{ marginTop: 4 }}>
            For a single result forwarded to the recruitment mailbox from Outlook (rather than a bulk CSV export). Same rules as bulk:
            matched <Text strong>by candidate email</Text>, pass mark <Text strong>50%</Text>, a retake overwrites only the score (latest wins).
          </Paragraph>
          <Space direction="vertical" style={{ width: '100%' }} size={10}>
            <Alert type="info" showIcon icon={<MailOutlined />}
              message="Matched from Outlook — neha.sharma@gmail.com" description="Evalground result email received 07 Jul 2026, 4:12 PM" />
            <Row gutter={10}>
              <Col span={12}><Text strong style={{ fontSize: 12.5 }}>IQ (GA) score</Text><Input placeholder="e.g. 78" style={{ marginTop: 4 }} /></Col>
              <Col span={12}><Text strong style={{ fontSize: 12.5 }}>Technical score</Text><Input placeholder="e.g. 74" style={{ marginTop: 4 }} /></Col>
            </Row>
          </Space>
          <Space style={{ width: '100%', justifyContent: 'flex-end', marginTop: 16 }}>
            <Button onClick={() => setImportOpen(false)}>Cancel</Button>
            <Button type="primary" icon={<ImportOutlined />} onClick={() => {
              setImportOpen(false);
              message.success('Result imported for the matched candidate');
            }}>Import result</Button>
          </Space>
        </>
      )}
    </Modal>
  );

  /* ---- Zeko job assignment & cancel-interview modals ---- */

  const zekoAssignModal = (
    <Modal open={zekoAssignOpen} onCancel={() => setZekoAssignOpen(false)} onOk={assignZekoJob}
      okText="Assign job" okButtonProps={{ disabled: !zekoJobChoice }} title="Assign Zeko job">
      {current && (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Text type="secondary">{current.name} · {STAGES[currentIdx]?.name}</Text>
          <Select style={{ width: '100%' }} placeholder="Select a Zeko job" value={zekoJobChoice} onChange={setZekoJobChoice}
            options={[
              { value: `${current.role} — ${STAGES[currentIdx]?.short}`, label: `${current.role} — ${STAGES[currentIdx]?.short}` },
              { value: `Generic Aptitude — ${STAGES[currentIdx]?.short}`, label: `Generic Aptitude — ${STAGES[currentIdx]?.short}` },
            ]} />
          <Text type="secondary" style={{ fontSize: 12 }}>Same Zeko jobs list used in Analytics → Zeko Interview Schedule.</Text>
        </Space>
      )}
    </Modal>
  );

  const zekoCancelModal = (
    <Modal open={zekoCancelOpen} onCancel={() => setZekoCancelOpen(false)} onOk={cancelZekoInterview}
      okText="Cancel interview" okButtonProps={{ danger: true, disabled: !zekoCancelReason }} title="Cancel Zeko interview">
      {current && (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Text type="secondary">{current.name} · {STAGES[currentIdx]?.name}</Text>
          <Input.TextArea rows={3} placeholder="Reason for cancellation (required — candidate is notified)"
            value={zekoCancelReason} onChange={(e) => setZekoCancelReason(e.target.value)} />
        </Space>
      )}
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
        message="Prototype for the RT walkthrough — v7"
        description="Candidates enter here already shortlisted in Candidate Screening (vendor submissions included, carrying their vendor tag) — this board starts at HR Screening (Zeko); shortlist context stays visible read-only in the drawer. Click a candidate, then click any completed round in the stepper to see that round's details — future rounds are locked. Pipeline analytics lives as a tab in the Analytics page. Both Zeko rounds now use the same status/score fields as the live Zeko integration in Analytics/Candidate Screening. Every round follows invite sent → outcome received → decision — deciding now shows the real, editable outcome email (from Email Templates where one exists; flagged as a draft where it doesn't yet). AI-assisted features (purple AI tag/robot icon) — natural-language board search, AI notes on stuck candidates, schema-free Evalground import, an AI interviewer prep brief, and an AI feedback summary — are suggestions only, RT still makes every decision. Applied answers: 30-min reminders + daily feedback reminder (no escalation), manual-only Hold, record-only offer with in-app approval, Evalground 50% pass mark with latest-attempt rule, concurrent MRF journeys (see the '2 MRFs' badge), both scheduling modes, and your interview evaluation scorecard format." />
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
            {current.rounds.shortlist && (
              <Card size="small" style={{ marginBottom: 14, background: 'var(--surface-2, #f7f7f5)' }}>
                <Space direction="vertical" size={2} style={{ width: '100%' }}>
                  <Space size={6}>
                    <Text strong style={{ fontSize: 12.5 }}>Shortlisted</Text>
                    {current.rounds.shortlist.jdMatch != null && <Tag>{current.rounds.shortlist.jdMatch}% JD match</Tag>}
                  </Space>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {current.rounds.shortlist.when}{current.rounds.shortlist.by ? ` · by ${current.rounds.shortlist.by}` : ''} — decided in Candidate Screening, not in this pipeline.
                  </Text>
                </Space>
              </Card>
            )}
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

      {/* ---------- outcome modal ---------- */}
      <Modal open={outcomeOpen} onCancel={() => setOutcomeOpen(false)} onOk={saveOutcome}
        okText="Save & send email" title="Record round outcome"
        okButtonProps={{ disabled: outcome !== 'approved' && !reason }}>
        {current && (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Text type="secondary">{current.name} · {STAGES[currentIdx]?.name}</Text>
            <Radio.Group value={outcome} onChange={(e) => {
              const v = e.target.value;
              const stage = STAGES[currentIdx];
              const tmpl = resolveEmailTemplate(current, stage, v);
              setOutcome(v);
              setReason(undefined);
              setEmailSubject(tmpl.subject);
              setEmailBody(tmpl.body);
              setEmailMeta({ sourceName: tmpl.sourceName, gap: tmpl.gap });
            }}
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
            <div>
              <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
                <Text strong style={{ fontSize: 12.5 }}>Outcome email to {mailAudience(current)}</Text>
                {emailMeta.gap
                  ? <Tooltip title="No dedicated template exists yet in Email Templates for this outcome — showing an editable draft; add one there for Module 1."><Tag color="gold">Draft — no template yet</Tag></Tooltip>
                  : <Tooltip title="Loaded from Email Templates — editing here only changes this send, not the saved template."><Tag color="blue">Default: {emailMeta.sourceName}</Tag></Tooltip>}
              </Space>
              <Input value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} style={{ marginTop: 6 }} />
              <Input.TextArea rows={4} value={emailBody} onChange={(e) => setEmailBody(e.target.value)} style={{ marginTop: 6 }} />
              <Text type="secondary" style={{ fontSize: 11.5, display: 'block', marginTop: 4 }}>
                Sent on save, with open tracking. Edits apply to this email only.
              </Text>
            </div>
          </Space>
        )}
      </Modal>

      {/* ---------- close candidate (offer stage) modal ---------- */}
      <Modal open={closeConfirmOpen} onCancel={() => setCloseConfirmOpen(false)}
        okText="Send & close record" title={`Close candidate — ${closureStatus}`}
        onOk={() => {
          setCloseConfirmOpen(false);
          message.info(`Record closed — closure email sent to ${mailAudience(current)}`);
          setCandidates((prev) => prev.filter((c) => c.id !== current.id));
          setOpenId(null);
        }}>
        {current && (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Text type="secondary">{current.name} · {current.role}</Text>
            <div>
              <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
                <Text strong style={{ fontSize: 12.5 }}>Closure email to {mailAudience(current)}</Text>
                <Tooltip title="No dedicated closure template exists yet in Email Templates — showing an editable draft; add one there for Module 1.">
                  <Tag color="gold">Draft — no template yet</Tag>
                </Tooltip>
              </Space>
              <Input value={closeEmailSubject} onChange={(e) => setCloseEmailSubject(e.target.value)} style={{ marginTop: 6 }} />
              <Input.TextArea rows={4} value={closeEmailBody} onChange={(e) => setCloseEmailBody(e.target.value)} style={{ marginTop: 6 }} />
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
            <Checkbox checked={attachBrief} onChange={(e) => setAttachBrief(e.target.checked)}>
              <Space size={4}><RobotOutlined style={{ color: '#7c5cff' }} /><Text strong style={{ fontSize: 12.5 }}>Attach AI interviewer prep brief to the invite</Text></Space>
            </Checkbox>
            {attachBrief && (
              <Alert type="info" showIcon={false} style={{ background: 'rgba(124,92,255,0.06)', borderColor: 'rgba(124,92,255,0.35)' }}
                message={<Space size={6}><Tag color="purple" style={{ marginInlineEnd: 0 }}>AI</Tag><Text strong style={{ fontSize: 12.5 }}>Prep brief preview</Text></Space>}
                description={<Text style={{ fontSize: 12.5 }}>{buildPrepBrief(current)}</Text>} />
            )}
          </Space>
        )}
      </Modal>

      {/* ---------- scorecard modal ---------- */}
      <Modal open={cardOpen} onCancel={() => setCardOpen(false)} onOk={submitScorecard}
        okText="Simulate submission (demo only)" title="Interviewer scorecard — preview of the interviewer's emailed link" width={560}>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert type="warning" showIcon icon={<WarningOutlined />}
            message="This is a preview only — it does not live inside the ATS."
            description="The real form is a public, tokenized link the interviewer gets by email — no ATS login, same pattern as the MRF approval page (/mrf/:id/approve). Candidate, position, round and interviewer are pre-filled from the schedule. Same card for Technical 1–3 and CEO rounds (Q18); the HR Round has its own card (timings, relocation, notice, CTC, strengths…). RT does not fill this in from here." />
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
      {zekoAssignModal}
      {zekoCancelModal}
    </div>
  );
}
