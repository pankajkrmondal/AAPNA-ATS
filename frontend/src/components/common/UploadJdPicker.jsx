/**
 * "Uploading for JD" — the optional JD picker on HR Upload and the Vendor
 * portal (Phase 3 section B, N14). Every candidate in the upload is tagged to
 * the chosen JD: new candidates at once, duplicates when a recruiter merges
 * them. Leaving it empty uploads exactly as before.
 *
 * Options come from the caller, because HR staff and vendors read different
 * endpoints (/dashboard/mrf-options vs /vendor/mrfs); both return open JDs in
 * the JD picker's shape, labelled with mrfOptionLabel (N19).
 */
import { useEffect, useState } from 'react';
import { Select, Space, Tag, Typography } from 'antd';
import { mrfOptionLabel } from '../../utils/mrfLabel';

const { Text } = Typography;

/**
 * @param {{
 *   value: number|null,
 *   onChange: (mrfId: number|null) => void,
 *   loadOptions: () => Promise<any>,   resolves to an axios response (or array) of open JDs
 *   disabled?: boolean,
 * }} props
 */
export default function UploadJdPicker({ value, onChange, loadOptions, disabled = false }) {
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    loadOptions()
      .then((res) => {
        if (!alive) return;
        const list = res?.data?.data ?? res?.data ?? res ?? [];
        setRoles((Array.isArray(list) ? list : []).filter((r) => !r.closed));
        setLoadError(false);
      })
      .catch(() => { if (alive) setLoadError(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [loadOptions]);

  return (
    <div data-testid="upload-jd-picker" style={{ marginBottom: 14 }}>
      <Text strong style={{ fontSize: 12.5 }}>Uploading for JD <Text type="secondary" style={{ fontWeight: 400 }}>(optional)</Text></Text>
      <Text type="secondary" style={{ display: 'block', fontSize: 11.5, marginBottom: 4 }}>
        {loadError
          ? 'Could not load the open JDs. You can still upload without one.'
          : 'Every candidate in this upload is tagged to this JD; duplicates are tagged when merged.'}
      </Text>
      <Select
        style={{ width: '100%', maxWidth: 520 }}
        placeholder="No JD — upload without tagging"
        value={value ?? undefined}
        onChange={(v) => onChange(v ?? null)}
        allowClear
        showSearch
        loading={loading}
        disabled={disabled}
        optionFilterProp="label"
        options={roles.map((r) => ({ value: r.id, label: mrfOptionLabel(r), isLatest: r.isLatest }))}
        optionRender={(opt) => (
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <span>{opt.data.label}</span>
            {opt.data.isLatest && <Tag color="green" style={{ margin: 0 }}>Latest</Tag>}
          </Space>
        )}
      />
    </div>
  );
}

/** The job list's JD cell: the JD's title when known, its id otherwise, else a dash. */
export function jobJdText(job) {
  if (job?.jd_label) return job.jd_label;
  if (job?.mrf_id) return `MRF-${job.mrf_id}`;
  return '—';
}
