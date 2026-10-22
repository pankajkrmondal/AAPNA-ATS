/**
 * "Tagged" chip on a JD-tab result card (Phase 3 section B, N15): this
 * candidate was uploaded for, or shortlisted to, the JD being searched. The
 * tooltip says how and when (rpa_candidate_mrf_tags.source / tagged_at).
 */
import { Tag, Tooltip } from 'antd';
import { TagOutlined } from '@ant-design/icons';
import { fmtDate } from '../../utils/dateFormat';

/** How each tag source reads on screen. */
export const JD_TAG_SOURCE_LABELS = Object.freeze({
  hr_manual_upload: 'HR upload for this JD',
  vendor_portal: 'Vendor upload for this JD',
  shortlist: 'Shortlisted to this JD',
  search_candidate: 'Added to this JD from Search Candidate',
  change_jd: 'Moved to this JD (Change JD)',
  move: 'Moved to this JD',
  backfill: 'Shortlisted to this JD (before tagging existed)',
});

/**
 * @param {{ tag: { source: string, tagged_at?: string, tagged_by?: string|null } | null }} props
 */
export default function JdTagChip({ tag }) {
  if (!tag) return null;
  const how = JD_TAG_SOURCE_LABELS[tag.source] || 'Tagged to this JD';
  const when = tag.tagged_at ? ` on ${fmtDate(tag.tagged_at)}` : '';
  const who = tag.tagged_by ? ` by ${tag.tagged_by}` : '';
  return (
    <Tooltip title={`${how}${when}${who}`}>
      <Tag icon={<TagOutlined />} color="geekblue" style={{ margin: 0 }} data-testid="jd-tag-chip">
        Tagged
      </Tag>
    </Tooltip>
  );
}
