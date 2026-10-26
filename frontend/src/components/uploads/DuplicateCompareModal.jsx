/**
 * DuplicateCompareModal — the duplicate Review window's "full details" (L09).
 *
 * Replaces the old full-details modal on HR Manual Upload and Vendor Manual
 * Upload, which rendered only the staged upload: a recruiter deciding Merge or
 * Cancel could not see what was already in the ATS, nor what the new resume
 * would change. This shows both, field by field:
 *
 *   Field | Already in ATS | This upload | On merge
 *
 * with "Only show differences" on by default, the candidate's earlier uploads,
 * and the same Merge / Cancel actions as before.
 *
 * `linksHidden` (the Vendor Upload page): no profile link and no resume links,
 * only the data and the actions, so that page hands out no extra links or
 * access (decision 23 Oct). The endpoint is staff-only either way.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert, Button, Collapse, Modal, Space, Spin, Switch, Table, Tag, Tooltip, Typography,
} from 'antd';
import { CloseCircleOutlined, MergeCellsOutlined, UserOutlined } from '@ant-design/icons';
import { fmtDate, fmtDateTime } from '../../utils/dateFormat';

const { Text } = Typography;

const CHANGE_META = {
  updated: { label: 'Changed', color: 'gold' },
  added: { label: 'New', color: 'green' },
  not_in_new: { label: 'Not in new resume', color: 'default' },
  same: { label: 'Same', color: 'default' },
};

const MERGE_META = {
  replaced: { label: 'New value replaces it', color: 'blue' },
  added: { label: 'Added', color: 'green' },
  combined: { label: 'Both kept', color: 'cyan' },
  kept: { label: 'Kept as is', color: 'default' },
};

const cellText = (v) => (v
  ? <span style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{v}</span>
  : <Text type="secondary" style={{ fontSize: 12 }}>—</Text>);

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {object|null} props.job - the upload job row (cv_tmp_id, candidate_name…)
 * @param {(tmpId: number|string) => Promise} props.fetchComparison - the page's service call
 * @param {boolean} [props.linksHidden]
 * @param {boolean} [props.busy] - Merge / Cancel in flight
 * @param {(job: object) => void} props.onMerge
 * @param {(job: object) => void} props.onCancel
 * @param {() => void} props.onClose
 * @param {() => void} [props.onBack] - back to the compact Review window
 * @param {string} [props.from] - router state for the profile page's Back button
 */
export default function DuplicateCompareModal({
  open, job, fetchComparison, linksHidden = false, busy = false, onMerge, onCancel, onClose, onBack, from,
}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [onlyDiffs, setOnlyDiffs] = useState(true);

  const tmpId = job?.cv_tmp_id;
  useEffect(() => {
    if (!open || !tmpId) return undefined;
    let alive = true;
    setLoading(true);
    setError(null);
    setData(null);
    fetchComparison(tmpId)
      .then((res) => { if (alive) setData(res.data?.data || res.data); })
      .catch((err) => { if (alive) setError(err?.response?.data?.message || 'Could not load the comparison.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, tmpId, fetchComparison]);

  const rows = useMemo(() => {
    const fields = data?.fields || [];
    return onlyDiffs ? fields.filter((f) => f.change !== 'same') : fields;
  }, [data, onlyDiffs]);

  const s = data?.summary || {};
  const existing = data?.existing;
  const incoming = data?.incoming;
  const matchedBy = (data?.matched_by || []).join(' and ');

  const columns = [
    {
      title: 'Field',
      key: 'label',
      width: 190,
      render: (_, r) => (
        <div>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{r.label}</div>
          <Tag color={CHANGE_META[r.change]?.color} style={{ marginTop: 4, fontSize: 11 }}>{CHANGE_META[r.change]?.label}</Tag>
        </div>
      ),
    },
    { title: 'Already in ATS', key: 'existing', render: (_, r) => cellText(r.existing) },
    {
      title: 'This upload',
      key: 'incoming',
      render: (_, r) => (r.change === 'not_in_new'
        ? <Text type="secondary" style={{ fontSize: 12 }}>Not in the new resume</Text>
        : cellText(r.incoming)),
    },
    {
      title: 'On merge',
      key: 'on_merge',
      width: 150,
      render: (_, r) => <Tag color={MERGE_META[r.on_merge]?.color}>{MERGE_META[r.on_merge]?.label}</Tag>,
    },
  ];

  const historyColumns = [
    { title: 'Uploaded', key: 'created_at', render: (_, h) => fmtDateTime(h.created_at) },
    { title: 'Source', key: 'source', render: (_, h) => (h.source || '').replace(/_/g, ' ') || '—' },
    { title: 'By', key: 'uploaded_by', render: (_, h) => h.uploaded_by || '—' },
    { title: 'Status', key: 'status', render: (_, h) => h.status || '—' },
    ...(linksHidden ? [] : [{
      title: 'Resume',
      key: 'file_url',
      render: (_, h) => (h.file_url ? <a href={h.file_url} target="_blank" rel="noopener noreferrer">Open</a> : '—'),
    }]),
  ];

  return (
    <Modal
      title="Duplicate review: already in the ATS vs this upload"
      open={open}
      onCancel={onClose}
      width={980}
      styles={{ body: { maxHeight: '72vh', overflowY: 'auto', padding: '16px 24px' } }}
      footer={(
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <Space size={8}>
            {onBack && <Button onClick={onBack}>Back to Review</Button>}
            {!linksHidden && existing?.id && (
              <Link to={`/candidates/${existing.id}`} state={from ? { from } : undefined}>
                <Button icon={<UserOutlined />}>Open existing profile</Button>
              </Link>
            )}
          </Space>
          <Space size={8}>
            <Button danger icon={<CloseCircleOutlined />} loading={busy} onClick={() => onCancel(job)}>
              Cancel / Reject
            </Button>
            <Button className="btn-sheen" type="primary" icon={<MergeCellsOutlined />} loading={busy} onClick={() => onMerge(job)}>
              Merge into Database
            </Button>
          </Space>
        </div>
      )}
    >
      {loading && <div style={{ padding: 32, textAlign: 'center' }}><Spin /></div>}
      {error && <Alert type="error" showIcon message={error} />}

      {data && (
        <>
          <Alert
            type={existing ? 'info' : 'warning'}
            showIcon
            style={{ marginBottom: 12 }}
            message={existing
              ? (
                <span>
                  Matches <strong>{existing.name || 'a candidate'}</strong>{matchedBy ? ` by ${matchedBy}` : ''}.
                  {' '}In the ATS since {fmtDate(existing.created_at)}
                  {existing.modified_at ? `, last updated ${fmtDate(existing.modified_at)}${existing.last_action_by ? ` by ${existing.last_action_by}` : ''}` : ''}.
                </span>
              )
              : 'The candidate this upload matched is no longer in the ATS. Merge will add it as a new candidate.'}
            description={(
              <span>
                This upload: {incoming?.source || 'upload'}
                {incoming?.vendor_name ? ` from ${incoming.vendor_name}` : ''}
                {incoming?.uploaded_by ? `, by ${incoming.uploaded_by}` : ''}
                {incoming?.uploaded_at ? ` on ${fmtDateTime(incoming.uploaded_at)}` : ''}.
              </span>
            )}
          />

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
            <Space size={6} wrap>
              <Tag color="gold">{s.updated || 0} changed</Tag>
              <Tag color="green">{s.added || 0} new</Tag>
              <Tag>{s.not_in_new || 0} not in new resume</Tag>
              <Tag>{s.same || 0} same</Tag>
            </Space>
            <Space size={8}>
              {!linksHidden && existing?.resume_url && (
                <a href={existing.resume_url} target="_blank" rel="noopener noreferrer">Earlier resume</a>
              )}
              {!linksHidden && incoming?.resume_url && (
                <a href={incoming.resume_url} target="_blank" rel="noopener noreferrer">New resume</a>
              )}
              <Tooltip title="Fields that read the same on both sides are hidden while this is on.">
                <span style={{ fontSize: 13 }}>
                  <Switch size="small" checked={onlyDiffs} onChange={setOnlyDiffs} style={{ marginRight: 6 }} />
                  Only show differences
                </span>
              </Tooltip>
            </Space>
          </div>

          <Table
            rowKey="field"
            size="small"
            columns={columns}
            dataSource={rows}
            pagination={false}
            scroll={{ x: 720 }}
            locale={{ emptyText: onlyDiffs ? 'Nothing differs: every field reads the same on both sides.' : 'No fields to compare.' }}
          />

          <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 8 }}>
            Merge keeps every email and phone number, takes the new value where the new resume has one,
            and keeps the existing value where it does not. Cancel leaves the existing candidate unchanged.
          </Text>

          {data.history?.length > 0 && (
            <Collapse
              ghost
              style={{ marginTop: 12 }}
              items={[{
                key: 'history',
                label: `Earlier uploads for this candidate (${data.history.length})`,
                children: (
                  <Table rowKey="id" size="small" columns={historyColumns} dataSource={data.history} pagination={false} />
                ),
              }]}
            />
          )}
        </>
      )}
    </Modal>
  );
}
