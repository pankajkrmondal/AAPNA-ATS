/**
 * Settings › section registry.
 *
 * One list that both the side rail (SettingsNav) and the page (Settings.jsx)
 * read, so a category cannot appear in the menu without a pane behind it or the
 * other way round. `keywords` are the words people actually type into the
 * rail's search box — product names, mailbox terms, the things on the cards —
 * not the label again.
 *
 * `adminOnly` sections match the admin/superadmin gate the page already applied
 * to those cards; the API enforces the same rule.
 */
import {
  ApartmentOutlined,
  BgColorsOutlined,
  CalendarOutlined,
  ExperimentOutlined,
  FileProtectOutlined,
  MailOutlined,
  SlidersOutlined,
} from '@ant-design/icons';

export const SETTINGS_GROUPS = [
  { key: 'general', label: 'General' },
  { key: 'automation', label: 'Automation' },
  { key: 'recruitment', label: 'Recruitment' },
  { key: 'admin', label: 'Admin' },
];

export const SETTINGS_SECTIONS = [
  {
    key: 'appearance',
    group: 'general',
    label: 'Appearance',
    hint: 'Light, dark, or follow your operating system.',
    icon: BgColorsOutlined,
    keywords: ['theme', 'dark', 'light', 'system', 'mode', 'colour', 'color'],
    adminOnly: false,
  },
  {
    key: 'interviews',
    group: 'automation',
    label: 'Interviews',
    hint: 'Meeting attendees, reminders, completion checks and recordings.',
    icon: CalendarOutlined,
    keywords: [
      'teams', 'outlook', 'calendar', 'meeting', 'recording', 'video', 'scorecard',
      'attendee', 'recruiter', 'reminder', 'completion', 'held', 'no-show', 'attendance',
    ],
    adminOnly: false,
  },
  {
    key: 'email-reminders',
    group: 'automation',
    label: 'Email Reminders',
    hint: 'Follow-up emails when an MRF, approval or missing JD gets no reply.',
    icon: MailOutlined,
    keywords: ['reminder', 'follow up', 'no response', 'cron', 'daily', 'trigger', 'coverage', 'missing jd', 'approval'],
    adminOnly: false,
  },
  {
    key: 'mrf',
    group: 'recruitment',
    label: 'MRF Approval & Hold',
    hint: 'Approvers, deciding on their behalf, and hold rules.',
    icon: FileProtectOutlined,
    keywords: ['mrf', 'hold', 'approver', 'approval', 'on behalf', 'release', 'delegate', 'held'],
    adminOnly: false,
  },
  {
    key: 'assessments',
    group: 'recruitment',
    label: 'Assessments',
    hint: 'Evalground deadline and auto-advance on score.',
    icon: ExperimentOutlined,
    keywords: ['evalground', 'assessment', 'test', 'score', 'marks', 'auto-advance', 'auto-reject', 'deadline', 'csv'],
    adminOnly: false,
  },
  {
    key: 'pipeline-rules',
    group: 'admin',
    label: 'Pipeline Rules',
    hint: 'Candidate activity window, open position target and auto-pause.',
    icon: SlidersOutlined,
    keywords: ['active', 'activity', 'screening', 'position', 'target', 'pause', 'idle', 'auto-pause'],
    adminOnly: true,
  },
  {
    key: 'pipeline-config',
    group: 'admin',
    label: 'Pipeline Configuration',
    hint: 'Stages, outcomes, reasons, stage templates and email routing.',
    icon: ApartmentOutlined,
    keywords: ['stage', 'outcome', 'reason', 'reject', 'template', 'routing', 'flow key', 'email routing', 'cc'],
    adminOnly: true,
  },
];

export const SETTINGS_SECTION_KEYS = new Set(SETTINGS_SECTIONS.map((s) => s.key));

/** True when the section's label, hint or keywords contain the query. */
export function sectionMatches(section, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [section.label, section.hint, ...section.keywords].some((t) => t.toLowerCase().includes(q));
}
