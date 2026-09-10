/**
 * ReferralChip — the one way a referral is shown anywhere in the app.
 *
 * Deliberately a single shared component rather than a Tag repeated on four
 * screens. The rule attached to this flag is unusually strict — recruiters and
 * the final decision-maker may see it, interviewers must not (Sanghamitra,
 * 2026-08-28: "none of the interview process should know") — and a rule spread
 * across four copies is a rule that drifts. If the styling, wording, or what it
 * discloses ever has to change, it changes here.
 *
 * NAMING THE REFERRER IS OPT-IN. Wide, screenshot-able surfaces (the candidate
 * table, the pipeline board) pass no `referredBy`, so the chip answers only "is
 * this a referral?". The drawer and the edit panel — where the recruiter is
 * actually weighing the candidate — pass it and get it in a tooltip.
 *
 * Every surface that renders this is behind requireStaff server-side; the chip
 * is not a permission check and must never be treated as one.
 */
import { Tag, Tooltip } from 'antd';

export default function ReferralChip({ referredBy = null, compact = false }) {
  const chip = (
    <Tag
      color="green"
      style={{
        marginInlineEnd: 0,
        fontSize: compact ? 10 : 11,
        lineHeight: compact ? '16px' : '18px',
        paddingInline: compact ? 5 : 7,
        fontWeight: 600,
      }}
    >
      Referral
    </Tag>
  );

  return referredBy
    ? <Tooltip title={`Referred by ${referredBy}`}>{chip}</Tooltip>
    : chip;
}
