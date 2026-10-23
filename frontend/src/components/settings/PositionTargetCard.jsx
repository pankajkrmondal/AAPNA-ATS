/**
 * Settings card: "Open position target" (L06, D9, design approved 22 Oct 2026).
 *
 * How many days an open position may stay open before its health dot on
 * Analytics → Open Positions and the Dashboard turns "At risk". Default 45.
 * Admin only, like the API.
 */
import { useEffect, useState } from 'react';
import { Card, Typography, InputNumber, Button, message } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import settingsService from '../../services/settingsService';

const { Title, Text } = Typography;

export default function PositionTargetCard() {
  const [days, setDays] = useState(null);
  const [saved, setSaved] = useState(null);
  const [limits, setLimits] = useState({ min: 1, max: 365, defaultDays: 45 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    settingsService.getPositionTarget()
      .then((res) => {
        const d = res.data?.data || {};
        setDays(d.targetDays);
        setSaved(d.targetDays);
        setLimits({ min: d.min ?? 1, max: d.max ?? 365, defaultDays: d.defaultTargetDays ?? 45 });
      })
      .catch(() => message.error('Failed to load the open position target.'))
      .finally(() => setLoading(false));
  }, []);

  const save = async (value) => {
    setSaving(true);
    try {
      await settingsService.savePositionTarget({ targetDays: value });
      setDays(value);
      setSaved(value);
      message.success(`Open position target set to ${value} day${value === 1 ? '' : 's'}.`);
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to save the open position target.');
    } finally {
      setSaving(false);
    }
  };

  const valid = Number.isInteger(days) && days >= limits.min && days <= limits.max;

  return (
    <Card bordered={false} className="glass-card" style={{ marginBottom: 24 }} data-testid="position-target-card">
      <div style={{ marginBottom: 16 }}>
        <Title level={4} style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, margin: '0 0 6px 0' }}>
          Open position target
        </Title>
        <Text type="secondary" style={{ fontSize: 13 }}>
          An open position turns &quot;At risk&quot; on Analytics → Open Positions and the Dashboard once it has been open
          longer than this. The other health rules (no applicants in 7 days, stuck candidates, overdue feedback) do not change.
        </Text>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <label htmlFor="position-target-days" style={{ fontWeight: 600, fontSize: 14 }}>Target</label>
        <InputNumber
          id="position-target-days"
          value={days}
          onChange={(v) => setDays(v)}
          min={limits.min}
          max={limits.max}
          precision={0}
          disabled={loading}
          style={{ width: 100 }}
          data-testid="position-target-days"
        />
        <Text type="secondary">days</Text>
        <Text type="secondary" style={{ fontSize: 12 }}>
          ({limits.min} to {limits.max} · default {limits.defaultDays})
        </Text>
      </div>
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 10 }}>
        Applies the next time Analytics or the Dashboard loads. Each change is logged.
      </Text>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        <Button
          onClick={() => save(limits.defaultDays)}
          disabled={loading || saving || saved === limits.defaultDays}
        >
          Reset to {limits.defaultDays}
        </Button>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          loading={saving}
          disabled={loading || !valid || days === saved}
          onClick={() => save(days)}
          data-testid="position-target-save"
        >
          Save
        </Button>
      </div>
    </Card>
  );
}
