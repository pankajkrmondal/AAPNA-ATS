/**
 * JdLabelEditor — pencil button + popover to set the label and JD date of a JD
 * sent without an MRF (L07). The newest JD date per role is marked "Latest" by
 * the server; this only edits the two fields and hands the saved values back.
 *
 * Rendered inside a clickable table row, so every click stops propagation:
 * opening the editor must not also open the record's details modal.
 */
import { useState } from 'react';
import { Popover, Input, DatePicker, Button, Space, Typography, Tooltip, message } from 'antd';
import { EditOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import mrfService from '../../services/mrfService';

const { Text } = Typography;

export const MAX_JD_LABEL_LENGTH = 60;

const stop = (e) => e.stopPropagation();

/**
 * @param {{ record: object, onSaved: (fields: object) => void, buttonLabel?: string }} props
 *   record  — an rpa_mrf_jd_send row from GET /api/mrf (id, role, version_label, version_date)
 *   onSaved — receives { version_label, version_date, jd_day, is_latest, label_editable }
 *   buttonLabel — text button instead of the icon (the details modal)
 */
export default function JdLabelEditor({ record, onSaved, buttonLabel }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [date, setDate] = useState(null);
  const [saving, setSaving] = useState(false);

  const handleOpenChange = (next) => {
    if (next) {
      setLabel(record.version_label || '');
      setDate(record.version_date ? dayjs(record.version_date) : null);
    }
    setOpen(next);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await mrfService.updateVersionLabel(record.id, {
        version_label: label.trim() || null,
        version_date: date ? date.format('YYYY-MM-DD') : null,
      });
      const saved = res.data?.data || res.data || {};
      onSaved?.({
        version_label: saved.version_label ?? null,
        version_date: saved.version_date ?? null,
        jd_day: saved.jd_day ?? null,
        is_latest: Boolean(saved.is_latest),
        label_editable: saved.label_editable !== false,
      });
      message.success('JD label saved.');
      setOpen(false);
    } catch (err) {
      message.error(err?.message || 'Could not save the JD label.');
    } finally {
      setSaving(false);
    }
  };

  const content = (
    <div onClick={stop} style={{ width: 300, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <Text strong style={{ fontSize: 12 }}>Label (optional)</Text>
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={MAX_JD_LABEL_LENGTH}
          showCount
          placeholder="e.g. v2 – Oct revision"
          style={{ marginTop: 4, borderRadius: 6 }}
          aria-label="JD label"
        />
      </div>
      <div>
        <Text strong style={{ fontSize: 12 }}>JD date</Text>
        <DatePicker
          value={date}
          onChange={setDate}
          format="DD MMM YYYY"
          allowClear
          style={{ width: '100%', marginTop: 4, borderRadius: 6 }}
          aria-label="JD date"
        />
      </div>
      <Text type="secondary" style={{ fontSize: 12, lineHeight: 1.5 }}>
        The newest JD date for each role gets &quot;Latest&quot;. With no date set, the created date is used.
      </Text>
      <Space style={{ justifyContent: 'flex-end', width: '100%' }}>
        <Button size="small" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
        <Button size="small" type="primary" onClick={save} loading={saving}>Save</Button>
      </Space>
    </div>
  );

  return (
    <Popover
      trigger="click"
      open={open}
      onOpenChange={handleOpenChange}
      title={<span onClick={stop}>JD label · {record.role}</span>}
      content={content}
      placement="bottomLeft"
    >
      {buttonLabel ? (
        <Button size="small" onClick={stop}>{buttonLabel}</Button>
      ) : (
        <Tooltip title="Edit JD label and date">
          <Button
            size="small"
            type="text"
            icon={<EditOutlined />}
            onClick={stop}
            aria-label="Edit JD label and date"
          />
        </Tooltip>
      )}
    </Popover>
  );
}
