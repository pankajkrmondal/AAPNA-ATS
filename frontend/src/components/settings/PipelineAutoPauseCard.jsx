/**
 * Settings card: "Candidate Pipeline auto-pause" (RT ask, 23 Oct 2026).
 *
 * A journey with no activity in its stage for this many days is paused by an
 * hourly sweep: it leaves the default board and is listed under "Paused
 * journey". Default 10 days. Admin only, like the API.
 */
import { useEffect, useState } from 'react';
import { Card, Typography, InputNumber, Button, Switch, message } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import settingsService from '../../services/settingsService';

const { Title, Text } = Typography;

export default function PipelineAutoPauseCard() {
  const [enabled, setEnabled] = useState(true);
  const [days, setDays] = useState(null);
  const [saved, setSaved] = useState(null); // { enabled, days }
  const [limits, setLimits] = useState({ min: 1, max: 365, defaultDays: 10 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    settingsService.getPipelineAutoPause()
      .then((res) => {
        const d = res.data?.data || {};
        setEnabled(d.enabled !== false);
        setDays(d.days);
        setSaved({ enabled: d.enabled !== false, days: d.days });
        setLimits({ min: d.min ?? 1, max: d.max ?? 365, defaultDays: d.defaultDays ?? 10 });
      })
      .catch(() => message.error('Failed to load the pipeline auto-pause setting.'))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await settingsService.savePipelineAutoPause({ enabled, days });
      setSaved({ enabled, days });
      message.success(enabled
        ? `Auto-pause set to ${days} day${days === 1 ? '' : 's'}.`
        : 'Auto-pause turned off.');
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to save the auto-pause setting.');
    } finally {
      setSaving(false);
    }
  };

  const valid = Number.isInteger(days) && days >= limits.min && days <= limits.max;
  const dirty = saved && (saved.enabled !== enabled || saved.days !== days);

  return (
    <Card bordered={false} className="glass-card" style={{ marginBottom: 24 }} data-testid="pipeline-auto-pause-card">
      <div style={{ marginBottom: 16 }}>
        <Title level={4} style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, margin: '0 0 6px 0' }}>
          Candidate Pipeline auto-pause
        </Title>
        <Text type="secondary" style={{ fontSize: 13 }}>
          A candidate with no activity in their current stage for this many days is paused automatically. Paused
          candidates leave the board and are listed under &quot;Paused journey&quot;; reminders and chase-ups stop
          until a recruiter resumes the journey from the candidate&apos;s drawer.
        </Text>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Switch
          checked={enabled}
          onChange={setEnabled}
          disabled={loading}
          data-testid="auto-pause-enabled"
        />
        <Text>{enabled ? 'On' : 'Off'}</Text>
        <label htmlFor="auto-pause-days" style={{ fontWeight: 600, fontSize: 14, marginInlineStart: 12 }}>Pause after</label>
        <InputNumber
          id="auto-pause-days"
          value={days}
          onChange={(v) => setDays(v)}
          min={limits.min}
          max={limits.max}
          precision={0}
          disabled={loading || !enabled}
          style={{ width: 100 }}
          data-testid="auto-pause-days"
        />
        <Text type="secondary">days with no activity</Text>
        <Text type="secondary" style={{ fontSize: 12 }}>
          ({limits.min} to {limits.max} · default {limits.defaultDays})
        </Text>
      </div>
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 10 }}>
        Checked every hour. Resuming a journey gives it a fresh {days || limits.defaultDays} days. Each change is logged.
      </Text>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        <Button
          onClick={() => { setEnabled(true); setDays(limits.defaultDays); }}
          disabled={loading || saving || (enabled && days === limits.defaultDays)}
        >
          Reset to {limits.defaultDays}
        </Button>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          loading={saving}
          disabled={loading || !valid || !dirty}
          onClick={save}
          data-testid="auto-pause-save"
        >
          Save
        </Button>
      </div>
    </Card>
  );
}
