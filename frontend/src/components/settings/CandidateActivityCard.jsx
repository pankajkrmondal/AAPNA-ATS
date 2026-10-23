/**
 * Settings card: "Candidate activity" (L01, design approved 22 Oct 2026).
 *
 * The active window decides how recent a details submission must be for a
 * candidate to count as Active in screening ("Active candidates first"), and
 * how recent a details request must be for Pending response. Default 15 days.
 * Admin only, like the API. Saving clears cached JD screening results.
 */
import { useEffect, useState } from 'react';
import { Card, Typography, InputNumber, Button, message } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import settingsService from '../../services/settingsService';

const { Title, Text } = Typography;

export default function CandidateActivityCard() {
  const [days, setDays] = useState(null);
  const [saved, setSaved] = useState(null);
  const [limits, setLimits] = useState({ min: 1, max: 365, defaultDays: 15 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    settingsService.getCandidateActivity()
      .then((res) => {
        const d = res.data?.data || {};
        setDays(d.activeWindowDays);
        setSaved(d.activeWindowDays);
        setLimits({ min: d.min ?? 1, max: d.max ?? 365, defaultDays: d.defaultActiveWindowDays ?? 15 });
      })
      .catch(() => message.error('Failed to load the candidate activity setting.'))
      .finally(() => setLoading(false));
  }, []);

  const save = async (value) => {
    setSaving(true);
    try {
      await settingsService.saveCandidateActivity({ activeWindowDays: value });
      setDays(value);
      setSaved(value);
      message.success(`Active window set to ${value} day${value === 1 ? '' : 's'}.`);
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to save the active window.');
    } finally {
      setSaving(false);
    }
  };

  const valid = Number.isInteger(days) && days >= limits.min && days <= limits.max;

  return (
    <Card bordered={false} className="glass-card" style={{ marginBottom: 24 }} data-testid="candidate-activity-card">
      <div style={{ marginBottom: 16 }}>
        <Title level={4} style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, margin: '0 0 6px 0' }}>
          Candidate activity
        </Title>
        <Text type="secondary" style={{ fontSize: 13 }}>
          With "Active candidates first" on, screening lists Active candidates first, then Pending response and
          New applicants, then Inactive. The active window sets how recent a response must be to count as Active.
        </Text>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <label htmlFor="active-window-days" style={{ fontWeight: 600, fontSize: 14 }}>Active window</label>
        <InputNumber
          id="active-window-days"
          value={days}
          onChange={(v) => setDays(v)}
          min={limits.min}
          max={limits.max}
          precision={0}
          disabled={loading}
          style={{ width: 100 }}
          data-testid="active-window-days"
        />
        <Text type="secondary">days</Text>
        <Text type="secondary" style={{ fontSize: 12 }}>
          ({limits.min} to {limits.max} · default {limits.defaultDays})
        </Text>
      </div>
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 10 }}>
        Saving clears cached JD results, so the next search uses the new value. Each change is logged.
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
          data-testid="active-window-save"
        >
          Save
        </Button>
      </div>
    </Card>
  );
}
