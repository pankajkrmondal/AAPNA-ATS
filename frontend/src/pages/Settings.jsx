/**
 * Settings Page — Appearance (theme) preference plus the legacy Reminder
 * Settings (automated email reminder behaviour and an Email Coverage guide).
 */
import { useState, useEffect, useRef } from 'react';
import { Form, InputNumber, Button, Table, Card, Typography, message, TimePicker, Segmented, Switch, Tag, Spin } from 'antd';
import { SaveOutlined, SunOutlined, MoonOutlined, DesktopOutlined, CalendarOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import settingsService from '../services/settingsService';
import useTheme from '../hooks/useTheme';
import useAuth from '../hooks/useAuth';
import PipelineConfigPanel from '../components/pipeline/PipelineConfigPanel';

const { Title, Text } = Typography;

const APPEARANCE_OPTIONS = [
  { label: 'Light', value: 'light', icon: <SunOutlined /> },
  { label: 'Dark', value: 'dark', icon: <MoonOutlined /> },
  { label: 'System', value: 'system', icon: <DesktopOutlined /> },
];

// Poll intervals (minutes) offered for the two interview background checks — the
// pre-interview reminder and the post-interview completion sweep. Must match
// ALLOWED_INTERVALS in backend/src/jobs/interviewReminder.js and
// backend/src/jobs/interviewOccurrence.js, which deliberately share one list.
const INTERVIEW_CHECK_INTERVALS = [1, 2, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60];

export default function Settings() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const { mode, setMode } = useTheme();
  const appearanceRef = useRef(null);
  const { user } = useAuth();
  const isAdmin = user?.role && ['admin', 'superadmin'].includes(user.role.toLowerCase());

  const [assessmentForm] = Form.useForm();
  const [assessmentLoading, setAssessmentLoading] = useState(false);
  const [assessmentSaving, setAssessmentSaving] = useState(false);

  // Interview reminder scheduler — saved on change, applied without a restart.
  const [interviewCfg, setInterviewCfg] = useState({ enabled: false, interval_minutes: 30, lead_minutes: 30 });
  const [interviewLoading, setInterviewLoading] = useState(true);
  const [interviewSaving, setInterviewSaving] = useState(false);

  // Interview completion sweep — same save-on-change contract as the reminder
  // scheduler above. attendance_enabled is read-only (it mirrors an env var).
  const [occurrenceCfg, setOccurrenceCfg] = useState({
    enabled: false,
    interval_minutes: 30,
    grace_minutes: 15,
    attendance_enabled: false,
    attendance_guest_candidate: true,
  });
  const [occurrenceLoading, setOccurrenceLoading] = useState(true);
  const [occurrenceSaving, setOccurrenceSaving] = useState(false);

  // Load existing settings on mount
  useEffect(() => {
    const fetchSettings = async () => {
      setLoading(true);
      try {
        const res = await settingsService.getReminderSettings();
        if (res.data && res.data.data) {
          const { reminder_interval_days, reminder_max_count, reminder_cron_schedule } = res.data.data;

          let hour = 9;
          let minute = 0;
          if (reminder_cron_schedule) {
            const parts = reminder_cron_schedule.split(' ');
            if (parts.length >= 2) {
              minute = parseInt(parts[0], 10) || 0;
              hour = parseInt(parts[1], 10) || 0;
            }
          }

          form.setFieldsValue({
            reminder_interval_days,
            reminder_max_count,
            reminder_time: dayjs().hour(hour).minute(minute).second(0),
          });
        }
      } catch (err) {
        message.error('Failed to load settings from database.');
      } finally {
        setLoading(false);
      }
    };
    fetchSettings();
  }, [form]);

  // Load the interview reminder scheduler config
  useEffect(() => {
    const fetchInterviewCfg = async () => {
      try {
        const res = await settingsService.getInterviewReminderConfig();
        const data = res.data?.data;
        if (data) setInterviewCfg(data);
      } catch {
        message.error('Failed to load interview reminder settings.');
      } finally {
        setInterviewLoading(false);
      }
    };
    fetchInterviewCfg();
  }, []);

  /**
   * Persists a scheduler change straight away — a toggle that needed a separate
   * Save press reads as broken, and the backend restarts the cron on write.
   */
  const saveInterviewCfg = async (patch) => {
    const next = { ...interviewCfg, ...patch };
    setInterviewCfg(next);
    setInterviewSaving(true);
    try {
      const res = await settingsService.saveInterviewReminderConfig({
        enabled: next.enabled,
        interval_minutes: next.interval_minutes,
        lead_minutes: next.lead_minutes,
      });
      // The server may raise the lead time to keep it >= the check interval;
      // adopt what it actually saved so the inputs never show a stale value.
      const saved = res.data?.data;
      if (saved) {
        setInterviewCfg({
          enabled: saved.enabled,
          interval_minutes: saved.interval_minutes,
          lead_minutes: saved.lead_minutes,
        });
      }
      if (saved?.lead_adjusted) {
        message.warning(res.data?.message || 'Reminder lead time was raised to match the check interval.');
      } else {
        message.success(res.data?.message || 'Interview reminders updated.');
      }
    } catch (err) {
      message.error(err?.response?.data?.message || err?.message || 'Failed to update interview reminders.');
      setInterviewCfg(interviewCfg); // roll back the optimistic change
    } finally {
      setInterviewSaving(false);
    }
  };

  // Load the interview completion sweep config
  useEffect(() => {
    const fetchOccurrenceCfg = async () => {
      try {
        const res = await settingsService.getInterviewOccurrenceConfig();
        const data = res.data?.data;
        if (data) setOccurrenceCfg(data);
      } catch {
        message.error('Failed to load interview completion check settings.');
      } finally {
        setOccurrenceLoading(false);
      }
    };
    fetchOccurrenceCfg();
  }, []);

  /**
   * Persists a completion-sweep change straight away, like the reminder card —
   * the backend re-registers the cron on write, so there is nothing to Save.
   */
  const saveOccurrenceCfg = async (patch) => {
    const previous = occurrenceCfg;
    const next = { ...occurrenceCfg, ...patch };
    setOccurrenceCfg(next);
    setOccurrenceSaving(true);
    try {
      const res = await settingsService.saveInterviewOccurrenceConfig({
        enabled: next.enabled,
        interval_minutes: next.interval_minutes,
        grace_minutes: next.grace_minutes,
      });
      // Adopt what the server actually saved, so the inputs can never drift from
      // the values the sweep is really running on.
      const saved = res.data?.data;
      if (saved) {
        setOccurrenceCfg((cur) => ({
          ...cur,
          enabled: saved.enabled,
          interval_minutes: saved.interval_minutes,
          grace_minutes: saved.grace_minutes,
        }));
      }
      message.success(res.data?.message || 'Interview completion check updated.');
    } catch (err) {
      message.error(err?.response?.data?.message || err?.message || 'Failed to update the interview completion check.');
      setOccurrenceCfg(previous); // roll back the optimistic change
    } finally {
      setOccurrenceSaving(false);
    }
  };

  // Load Assessment automation settings on mount
  useEffect(() => {
    const fetchAssessmentSettings = async () => {
      setAssessmentLoading(true);
      try {
        const res = await settingsService.getAssessmentAutomation();
        if (res.data && res.data.data) {
          const { assessment_deadline_days, assessment_auto_advance_enabled } = res.data.data;
          assessmentForm.setFieldsValue({ assessment_deadline_days, assessment_auto_advance_enabled });
        }
      } catch (err) {
        message.error('Failed to load assessment automation settings.');
      } finally {
        setAssessmentLoading(false);
      }
    };
    fetchAssessmentSettings();
  }, [assessmentForm]);

  const onFinishAssessment = async (values) => {
    setAssessmentSaving(true);
    try {
      await settingsService.saveAssessmentAutomation({
        assessment_deadline_days: values.assessment_deadline_days,
        assessment_auto_advance_enabled: !!values.assessment_auto_advance_enabled,
      });
      message.success('Assessment automation settings updated successfully!');
    } catch (err) {
      message.error(err?.response?.data?.message || err?.message || 'Failed to update assessment automation settings.');
    } finally {
      setAssessmentSaving(false);
    }
  };

  // Handle save
  const onFinish = async (values) => {
    setSaving(true);
    try {
      const timeVal = values.reminder_time;
      const hour = timeVal ? timeVal.hour() : 9;
      const minute = timeVal ? timeVal.minute() : 0;
      const cronSchedule = `${minute} ${hour} * * *`;

      await settingsService.saveReminderSettings({
        reminder_interval_days: values.reminder_interval_days,
        reminder_max_count: values.reminder_max_count,
        reminder_cron_schedule: cronSchedule,
      });
      message.success('Settings updated successfully!');
    } catch (err) {
      message.error(err?.message || 'Failed to update settings.');
    } finally {
      setSaving(false);
    }
  };

  /** Theme mode change — reveal animation originates from the segmented control. */
  const handleAppearanceChange = (nextMode) => {
    const rect = appearanceRef.current?.getBoundingClientRect();
    setMode(
      nextMode,
      rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : undefined,
    );
  };

  // A lead time shorter than the check interval means the job can step over the
  // reminder window without ever landing inside it.
  const leadTooShort = interviewCfg.enabled && interviewCfg.lead_minutes < interviewCfg.interval_minutes;

  /** "3:00 PM minus the lead time" — makes the abstract number concrete. */
  const exampleTime = dayjs()
    .hour(15)
    .minute(0)
    .subtract(interviewCfg.lead_minutes || 0, 'minute')
    .format('h:mm A');

  /** "8:00 PM plus the grace period" — the earliest the sweep looks at a finished interview. */
  const occurrenceExampleTime = dayjs()
    .hour(20)
    .minute(0)
    .add(occurrenceCfg.grace_minutes || 0, 'minute')
    .format('h:mm A');

  const emailCoverageColumns = [
    {
      title: 'WORKFLOW',
      dataIndex: 'workflow',
      key: 'workflow',
      width: '40%',
      render: (text) => <Text strong style={{ fontSize: 13, color: 'var(--text)' }}>{text}</Text>,
    },
    {
      title: 'RESPONSE DETECTED BY',
      dataIndex: 'responseDetected',
      key: 'responseDetected',
      render: (text) => <Text style={{ fontSize: 13, color: 'var(--text)', fontFamily: 'monospace' }}>{text}</Text>,
    },
  ];

  const emailCoverageData = [
    {
      key: '1',
      workflow: 'HR to Hiring Manager',
      responseDetected: 'HM submits the MRF form',
    },
    {
      key: '2',
      workflow: 'Approval to Management',
      responseDetected: 'Management clicks Approve or Decline',
    },
    {
      key: '3',
      workflow: 'Missing JD to Candidate',
      responseDetected: 'Candidate submits the missing details form',
    },
  ];

  return (
    <div style={{ padding: '24px', maxWidth: 1000, margin: '0 auto' }} className="stagger-children">
      {/* Appearance. Every card on this page is a settings panel — tier 2, the
          page's content rather than dense data — so they all take `.glass-card`
          and drop their inline radius/shadow, which the class owns. */}
      <Card
        bordered={false}
        className="glass-card"
        style={{ marginBottom: 24 }}
      >
        <div style={{ marginBottom: 16 }}>
          <Title level={4} style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, margin: '0 0 6px 0' }}>
            Appearance
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            Choose how AAPNA ATS looks to you. &ldquo;System&rdquo; follows your operating system setting.
          </Text>
        </div>
        <div ref={appearanceRef} style={{ display: 'inline-block' }}>
          <Segmented
            size="large"
            value={mode}
            onChange={handleAppearanceChange}
            options={APPEARANCE_OPTIONS}
          />
        </div>
      </Card>

      {/* Interview reminder scheduler — on/off + how often the job checks */}
      <Card
        bordered={false}
        className="glass-card"
        style={{ marginBottom: 24 }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 320px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 6px 0' }}>
              <CalendarOutlined style={{ color: 'var(--gold)', fontSize: 18 }} />
              <Title level={4} style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, margin: 0 }}>
                Interview Reminders
              </Title>
              <Tag color={interviewCfg.enabled ? 'green' : 'default'} style={{ marginInlineStart: 4 }}>
                {interviewCfg.enabled ? 'ON' : 'OFF'}
              </Tag>
            </div>
            <Text type="secondary" style={{ fontSize: 13 }}>
              Automatically emails the candidate and the interviewer a reminder before their scheduled
              Technical Round, so nobody misses it. Each person is emailed once per interview.
            </Text>
          </div>
          <Spin spinning={interviewLoading || interviewSaving}>
            <Switch
              checked={interviewCfg.enabled}
              onChange={(checked) => saveInterviewCfg({ enabled: checked })}
              disabled={interviewLoading}
              checkedChildren="ON"
              unCheckedChildren="OFF"
              style={{ marginTop: 4 }}
            />
          </Spin>
        </div>

        <div
          style={{
            marginTop: 20,
            opacity: interviewCfg.enabled ? 1 : 0.45,
            pointerEvents: interviewCfg.enabled ? 'auto' : 'none',
            transition: 'opacity 0.2s',
          }}
        >
          {/* The setting people actually care about comes first: when the email lands. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>
              Email them
            </span>
            <InputNumber
              min={5}
              max={1440}
              step={5}
              value={interviewCfg.lead_minutes}
              onChange={(val) => val && saveInterviewCfg({ lead_minutes: val })}
              addonAfter="minutes"
              style={{ width: 160 }}
            />
            <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>
              before the interview starts
            </span>
          </div>

          <div style={{ marginTop: 22, marginBottom: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>
              How often the system checks for interviews coming up
            </span>
            <Text type="secondary" style={{ fontSize: 12.5, display: 'block', marginTop: 2 }}>
              A background check that usually finds nothing — it only decides how precisely the timing above is hit.
              Shorter is more accurate.
            </Text>
          </div>
          <div style={{ overflowX: 'auto', maxWidth: '100%', paddingBottom: 2 }}>
            <Segmented
              value={interviewCfg.interval_minutes}
              onChange={(val) => saveInterviewCfg({ interval_minutes: val })}
              options={INTERVIEW_CHECK_INTERVALS.map((m) => ({
                label: m === 60 ? '1 hour' : `${m} min`,
                value: m,
              }))}
            />
          </div>

          {/* Worked example — the clearest way to show what the two numbers do together. */}
          <div
            style={{
              marginTop: 18,
              background: 'var(--info-bg)',
              border: '1px solid var(--info-border)',
              borderRadius: 8,
              padding: '12px 16px',
              color: 'var(--info-text)',
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            <strong>What this means:</strong> for an interview at 3:00 PM, the candidate and interviewer
            are emailed at about <strong>{exampleTime}</strong>
            {` (within ${interviewCfg.interval_minutes} minute${interviewCfg.interval_minutes === 1 ? '' : 's'} of that).`}
            {' '}Everyone gets one reminder per interview.
          </div>

          {leadTooShort && (
            <div
              style={{
                marginTop: 12,
                background: 'var(--warn-bg)',
                border: '1px solid var(--warn-border)',
                borderRadius: 8,
                padding: '12px 16px',
                color: 'var(--warn-text)',
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              <strong>Reminders may be missed.</strong> The check runs every {interviewCfg.interval_minutes} minutes
              but reminders are set to go out only {interviewCfg.lead_minutes} minutes ahead, so the system can skip
              past that window entirely. Raise the lead time to at least {interviewCfg.interval_minutes} minutes,
              or check more often.
            </div>
          )}
        </div>
      </Card>

      {/* Interview completion sweep — decides whether a finished interview actually
          happened, which is what releases the interviewer's scorecard email. */}
      <Card
        bordered={false}
        className="glass-card"
        style={{ marginBottom: 24 }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 320px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 6px 0' }}>
              <CalendarOutlined style={{ color: 'var(--gold)', fontSize: 18 }} />
              <Title level={4} style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, margin: 0 }}>
                Interview Completion Check
              </Title>
              <Tag color={occurrenceCfg.enabled ? 'green' : 'default'} style={{ marginInlineStart: 4 }}>
                {occurrenceCfg.enabled ? 'ON' : 'OFF'}
              </Tag>
            </div>
            <Text type="secondary" style={{ fontSize: 13 }}>
              After an interview ends, checks whether it actually took place and emails the interviewer
              their scorecard. Without this, someone has to mark every interview as held by hand in the
              Candidate Pipeline before any score can be collected.
            </Text>
          </div>
          <Spin spinning={occurrenceLoading || occurrenceSaving}>
            <Switch
              checked={occurrenceCfg.enabled}
              onChange={(checked) => saveOccurrenceCfg({ enabled: checked })}
              disabled={occurrenceLoading}
              checkedChildren="ON"
              unCheckedChildren="OFF"
              style={{ marginTop: 4 }}
            />
          </Spin>
        </div>

        <div
          style={{
            marginTop: 20,
            opacity: occurrenceCfg.enabled ? 1 : 0.45,
            pointerEvents: occurrenceCfg.enabled ? 'auto' : 'none',
            transition: 'opacity 0.2s',
          }}
        >
          {/* Grace first: it is the number that decides how soon the scorecard goes out. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>
              Wait
            </span>
            <InputNumber
              min={0}
              max={1440}
              step={5}
              value={occurrenceCfg.grace_minutes}
              onChange={(val) => val !== null && saveOccurrenceCfg({ grace_minutes: val })}
              addonAfter="minutes"
              style={{ width: 160 }}
            />
            <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>
              after the interview ends before checking
            </span>
          </div>

          <div style={{ marginTop: 22, marginBottom: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>
              How often the system checks for finished interviews
            </span>
            <Text type="secondary" style={{ fontSize: 12.5, display: 'block', marginTop: 2 }}>
              Only decides how quickly a finished interview is picked up. Shorter means the scorecard
              request reaches the interviewer sooner.
            </Text>
          </div>
          <div style={{ overflowX: 'auto', maxWidth: '100%', paddingBottom: 2 }}>
            <Segmented
              value={occurrenceCfg.interval_minutes}
              onChange={(val) => saveOccurrenceCfg({ interval_minutes: val })}
              options={INTERVIEW_CHECK_INTERVALS.map((m) => ({
                label: m === 60 ? '1 hour' : `${m} min`,
                value: m,
              }))}
            />
          </div>

          {/* Worked example — the same device the reminder card uses above. */}
          <div
            style={{
              marginTop: 18,
              background: 'var(--info-bg)',
              border: '1px solid var(--info-border)',
              borderRadius: 8,
              padding: '12px 16px',
              color: 'var(--info-text)',
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            <strong>What this means:</strong> for an interview ending at 8:00 PM, the system first looks
            at about <strong>{occurrenceExampleTime}</strong>
            {` and settles it within ${occurrenceCfg.interval_minutes} minute${occurrenceCfg.interval_minutes === 1 ? '' : 's'} of that.`}
            {' '}The interviewer’s scorecard email goes out as soon as the interview is confirmed held.
          </div>

          {/* Which of the sweep's two modes will actually run. Teams attendance is an
              env-level switch, so the card states it rather than pretending to own it. */}
          {occurrenceCfg.attendance_enabled ? (
            <div
              style={{
                marginTop: 12,
                background: 'var(--info-bg)',
                border: '1px solid var(--info-border)',
                borderRadius: 8,
                padding: '12px 16px',
                color: 'var(--info-text)',
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              <strong>Confirmed automatically.</strong> The verdict is read from the Teams attendance report.
              {occurrenceCfg.attendance_guest_candidate
                ? ' The interviewer must join signed in with the address on the booking; the candidate can join as a guest, with no Teams account and no sign-in. The round counts as held once the interviewer and at least one other person have attended.'
                : ' Both the interviewer and the candidate must join signed in with the addresses on the booking — a guest join will not be recognised.'}
              {' '}If nobody joined on one side it is recorded as a no-show instead, no scorecard is sent,
              and the team is alerted to reschedule or reject.
            </div>
          ) : (
            <div
              style={{
                marginTop: 12,
                background: 'var(--warn-bg)',
                border: '1px solid var(--warn-border)',
                borderRadius: 8,
                padding: '12px 16px',
                color: 'var(--warn-text)',
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              <strong>Teams attendance reading is turned off for this environment.</strong> The check
              cannot confirm an interview on its own, so instead it emails the recruitment mailbox
              asking someone to confirm it — up to three times, a day apart. The scorecard still only
              goes out once an interview is marked held in the Candidate Pipeline.
            </div>
          )}
        </div>
      </Card>

      {/* The `borderTop: 4px solid var(--gold)` rail goes, as it did on
          /candidates, /mrf and the upload screens — a flat bar under a gradient
          rim is the pre-glass vocabulary showing through. */}
      <Card
        bordered={false}
        className="glass-card"
      >
        <div style={{ marginBottom: 24 }}>
          <Title level={3} style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, margin: '0 0 6px 0' }}>
            Reminder Settings
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            Configure automated email reminder behaviour across all recruitment workflows. Changes take effect immediately for all future reminders.
          </Text>
        </div>

        {/* How it works info banner */}
        <div
          style={{
            background: 'var(--info-bg)',
            border: '1px solid var(--info-border)',
            borderRadius: 8,
            padding: '16px 20px',
            color: 'var(--info-text)',
            fontSize: 13.5,
            lineHeight: 1.6,
            marginBottom: 28,
          }}
        >
          <strong>How it works:</strong> When a recipient hasn't responded to an email (MRF form, Approval, or Missing JD), the system automatically sends reminder emails based on these settings. These two values control <strong>all three email flows</strong> – no per-workflow configuration needed.
        </div>

        {/* Settings Form */}
        <Form
          form={form}
          layout="vertical"
          onFinish={onFinish}
          initialValues={{ reminder_interval_days: 1, reminder_max_count: 4 }}
          disabled={loading}
        >
          <div style={{ display: 'flex', gap: 20, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 28 }}>
            <Form.Item
              label={<span style={{ fontWeight: 600, fontSize: 12, textTransform: 'uppercase', color: 'var(--text-2)', letterSpacing: '0.4px' }}>Remind After X Days of No Response *</span>}
              name="reminder_interval_days"
              rules={[{ required: true, message: 'Required' }]}
              style={{ margin: 0, flex: '1 1 250px' }}
            >
              <InputNumber
                min={0}
                max={90}
                style={{ width: '100%', height: 42, borderRadius: 8, display: 'flex', alignItems: 'center' }}
              />
            </Form.Item>

            <Form.Item
              label={<span style={{ fontWeight: 600, fontSize: 12, textTransform: 'uppercase', color: 'var(--text-2)', letterSpacing: '0.4px' }}>Maximum Number of Reminders to Send *</span>}
              name="reminder_max_count"
              rules={[{ required: true, message: 'Required' }]}
              style={{ margin: 0, flex: '1 1 250px' }}
            >
              <InputNumber
                min={0}
                max={20}
                style={{ width: '100%', height: 42, borderRadius: 8, display: 'flex', alignItems: 'center' }}
              />
            </Form.Item>

            <Form.Item
              label={<span style={{ fontWeight: 600, fontSize: 12, textTransform: 'uppercase', color: 'var(--text-2)', letterSpacing: '0.4px' }}>Daily Trigger Time *</span>}
              name="reminder_time"
              rules={[{ required: true, message: 'Required' }]}
              style={{ margin: 0, flex: '1 1 200px' }}
            >
              <TimePicker
                format="HH:mm"
                style={{ width: '100%', height: 42, borderRadius: 8, display: 'flex', alignItems: 'center' }}
              />
            </Form.Item>

            <Button
              type="primary"
              htmlType="submit"
              icon={<SaveOutlined />}
              loading={saving}
              style={{
                height: 42,
                borderRadius: 8,
                fontWeight: 600,
                padding: '0 24px',
              }}
            >
              Save Settings
            </Button>
          </div>
        </Form>

        {/* Email Coverage static info block */}
        <div style={{ marginTop: 36 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              marginBottom: 16,
            }}
          >
            <span style={{ fontWeight: 700, fontSize: 11, letterSpacing: '0.1em', color: 'var(--text-3)', textTransform: 'uppercase' }}>
              Email Coverage
            </span>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          </div>

          <Table
            columns={emailCoverageColumns}
            dataSource={emailCoverageData}
            pagination={false}
            bordered
            size="middle"
            rowClassName={() => 'coverage-table-row'}
            style={{
              borderRadius: 8,
              overflow: 'hidden',
              border: '1px solid var(--border)',
            }}
          />
        </div>
      </Card>

      {/* Assessment Automation — Evalground invite deadline + auto-advance/reject toggle */}
      <Card
        bordered={false}
        className="glass-card"
        style={{ marginTop: 24 }}
      >
        <div style={{ marginBottom: 24 }}>
          <Title level={3} style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, margin: '0 0 6px 0' }}>
            Assessment Automation
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            Controls for the Evalground assessment round on the Candidate Pipeline.
          </Text>
        </div>

        <div
          style={{
            background: 'var(--info-bg)',
            border: '1px solid var(--info-border)',
            borderRadius: 8,
            padding: '16px 20px',
            color: 'var(--info-text)',
            fontSize: 13.5,
            lineHeight: 1.6,
            marginBottom: 28,
          }}
        >
          <strong>How it works:</strong> The deadline days control how long a candidate has to complete
          the Evalground test after an invite is sent before recruiters get a reminder. When
          auto-advance/reject is ON, a CSV import with a Marks Scored above 50 automatically approves
          the candidate to the next round, and 50 or below automatically rejects them — both with a real
          outcome email, no recruiter click required. When OFF (default), nothing is automatic; recruiters
          always decide manually.
        </div>

        <Form
          form={assessmentForm}
          layout="vertical"
          onFinish={onFinishAssessment}
          initialValues={{ assessment_deadline_days: 2, assessment_auto_advance_enabled: false }}
          disabled={assessmentLoading}
        >
          <div style={{ display: 'flex', gap: 20, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <Form.Item
              label={<span style={{ fontWeight: 600, fontSize: 12, textTransform: 'uppercase', color: 'var(--text-2)', letterSpacing: '0.4px' }}>Invite Deadline (Days) *</span>}
              name="assessment_deadline_days"
              rules={[{ required: true, message: 'Required' }]}
              style={{ margin: 0, flex: '1 1 220px' }}
            >
              <InputNumber
                min={1}
                max={30}
                style={{ width: '100%', height: 42, borderRadius: 8, display: 'flex', alignItems: 'center' }}
              />
            </Form.Item>

            <Form.Item
              label={<span style={{ fontWeight: 600, fontSize: 12, textTransform: 'uppercase', color: 'var(--text-2)', letterSpacing: '0.4px' }}>Auto-Advance / Auto-Reject on Score</span>}
              name="assessment_auto_advance_enabled"
              valuePropName="checked"
              style={{ margin: 0 }}
            >
              <Switch disabled={!isAdmin} />
            </Form.Item>

            <Button
              type="primary"
              htmlType="submit"
              icon={<SaveOutlined />}
              loading={assessmentSaving}
              style={{ height: 42, borderRadius: 8, fontWeight: 600, padding: '0 24px' }}
            >
              Save Settings
            </Button>
          </div>
          {!isAdmin && (
            <Text type="secondary" style={{ fontSize: 11.5, display: 'block', marginTop: 8 }}>
              Only an admin can change the auto-advance/auto-reject toggle.
            </Text>
          )}
        </Form>
      </Card>

      {/* Pipeline stages / outcomes / reasons — admin only, matching the
          requireAdmin gate the API enforces. Hidden rather than disabled for
          non-admins: there is nothing here a recruiter can act on. */}
      {isAdmin && <PipelineConfigPanel />}
    </div>
  );
}
