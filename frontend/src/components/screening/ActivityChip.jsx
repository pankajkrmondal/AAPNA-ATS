/**
 * Candidate activity chip on a screening result card (L01, design approved
 * 22 Oct 2026): "Active · responded in 2 days (15 Oct 2026)",
 * "Pending response · details requested 18 Oct 2026", "New applicant ·
 * profile complete", "Inactive · no response since 02 Jun 2026".
 *
 * The server decides the status (backend/src/utils/candidateActivity.js) from
 * when the candidate's details were requested and submitted.
 */
import { Tag, Tooltip } from 'antd';

/** Tag colour and the summary-chip dot colour per status. */
export const ACTIVITY_STYLES = Object.freeze({
  active: { color: 'green', dot: 'var(--kpi-c)', label: 'Active' },
  pending: { color: 'orange', dot: 'var(--warning)', label: 'Pending response' },
  new: { color: 'blue', dot: 'var(--kpi-a)', label: 'New applicant' },
  inactive: { color: 'default', dot: 'var(--text-3)', label: 'Inactive' },
});

/** Summary-bar hint per status; the window is the admin's "Active window". */
export function activityHint(status, windowDays) {
  const days = `${windowDays || 15} day${windowDays === 1 ? '' : 's'}`;
  switch (status) {
    case 'active': return `Submitted their candidate details in the last ${days}.`;
    case 'pending': return `Details requested in the last ${days}, not submitted yet.`;
    case 'new': return `Added in the last ${days} and not asked for details (nothing was missing, or not asked yet).`;
    default: return `No recent response: never contacted, or no reply within the last ${days}.`;
  }
}

/**
 * @param {{ activity: { status: string, label: string, detail?: string } | null | undefined }} props
 */
export default function ActivityChip({ activity }) {
  if (!activity?.status) return null;
  const style = ACTIVITY_STYLES[activity.status] || ACTIVITY_STYLES.inactive;
  const text = activity.detail ? `${activity.label} · ${activity.detail}` : activity.label;
  return (
    <Tooltip title="From when this candidate's details were requested and submitted.">
      <Tag color={style.color} style={{ margin: 0 }} data-testid="activity-chip" data-status={activity.status}>
        {text}
      </Tag>
    </Tooltip>
  );
}
