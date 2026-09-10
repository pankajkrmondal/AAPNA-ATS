/**
 * Settings Page — Appearance (theme) preference plus the legacy Reminder
 * Settings (automated email reminder behaviour and an Email Coverage guide).
 */
import { useState, useEffect, useRef } from 'react';
// Button now comes from src/ui — see the import below. `Segmented` is still AntD's
// here; src/ui has its own (a real radiogroup with arrow-key support), and swapping it
// is a separate adoption item logged in the parity changelog.
import { Form, InputNumber, Table, Card, Typography, message, TimePicker, Segmented, Switch, Tag, Spin } from 'antd';
import { SaveOutlined, SunOutlined, MoonOutlined, DesktopOutlined, CalendarOutlined, VideoCameraOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import settingsService from '../services/settingsService';
import useTheme from '../hooks/useTheme';
import useAuth from '../hooks/useAuth';
import PipelineConfigPanel from '../components/pipeline/PipelineConfigPanel';
import { DesignScope, PageShell, PageHeader, Surface, Button } from '../ui';
// After '../ui' so page rules win on equal specificity.
import '../styles/pages/settings.css';

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

  // Recording capture sweep — same save-on-change contract again. fetch_enabled
  // is read-only (MS_RECORDING_FETCH_ENABLED) and gates the whole card.
  const [recordingCfg, setRecordingCfg] = useState({
    enabled: false,
    interval_minutes: 15,
    grace_minutes: 10,
    fetch_enabled: false,
  });
  const [recordingLoading, setRecordingLoading] = useState(true);
  const [recordingSaving, setRecordingSaving] = useState(false);

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

  // Load the recording capture config
  useEffect(() => {
    const fetchRecordingCfg = async () => {
      try {
        const res = await settingsService.getInterviewRecordingConfig();
        const data = res.data?.data;
        if (data) setRecordingCfg(data);
      } catch {
        message.error('Failed to load interview recording settings.');
      } finally {
        setRecordingLoading(false);
      }
    };
    fetchRecordingCfg();
  }, []);

  /**
   * Persists a recording-capture change straight away, like the two cards above.
   */
  const saveRecordingCfg = async (patch) => {
    const previous = recordingCfg;
    const next = { ...recordingCfg, ...patch };
    setRecordingCfg(next);
    setRecordingSaving(true);
    try {
      const res = await settingsService.saveInterviewRecordingConfig({
        enabled: next.enabled,
        interval_minutes: next.interval_minutes,
        grace_minutes: next.grace_minutes,
      });
      const saved = res.data?.data;
      if (saved) {
        setRecordingCfg((cur) => ({
          ...cur,
          enabled: saved.enabled,
          interval_minutes: saved.interval_minutes,
          grace_minutes: saved.grace_minutes,
          fetch_enabled: saved.fetch_enabled,
        }));
      }
      message.success(res.data?.message || 'Interview recording capture updated.');
    } catch (err) {
      message.error(err?.response?.data?.message || err?.message || 'Failed to update recording capture.');
      setRecordingCfg(previous); // roll back the optimistic change
    } finally {
      setRecordingSaving(false);
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
      render: (text) => <Text strong className="set-cell">{text}</Text>,
    },
    {
      title: 'RESPONSE DETECTED BY',
      dataIndex: 'responseDetected',
      key: 'responseDetected',
      render: (text) => <Text className="set-mono">{text}</Text>,
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
    <DesignScope>
      <PageShell width="narrow" className="stagger-children">
      {/* Page header — 2026-08-31, and written from nothing. This route had NO page
          title at all: its first heading was the "Appearance" card's own `Title
          level={4}` at 17px, so the screen opened on a card label and the only place
          the word "Settings" appeared was the topbar chrome. */}
      <PageHeader
        eyebrow="Configuration"
        title="Settings"
        subtitle="How the app looks to you, and the automated emails it sends on your behalf."
      />

      {/* Appearance. Every card on this page is a settings panel — tier 2, the
          page's content rather than dense data — so they all take `.glass-card`
          and drop their inline radius/shadow, which the class owns. */}
      <Surface tier={2} padding="relaxed" className="set-mb-5">
        <div className="set-mb-4">
          <Title level={4} className="set-card-title">
            Appearance
          </Title>
          <Text type="secondary" className="set-lede">
            Choose how AAPNA ATS looks to you. &ldquo;System&rdquo; follows your operating system setting.
          </Text>
        </div>
        <div ref={appearanceRef} className="set-inline-block">
          <Segmented
            size="large"
            value={mode}
            onChange={handleAppearanceChange}
            options={APPEARANCE_OPTIONS}
          />
        </div>
      </Surface>

      {/* Interview reminder scheduler — on/off + how often the job checks */}
      <Surface tier={2} padding="relaxed" className="set-mb-5">
        <div className="set-split">
          <div className="set-split__main">
            <div className="set-title-row">
              <CalendarOutlined className="set-title-icon" />
              <Title level={4} className="set-card-title set-card-title--flush">
                Interview Reminders
              </Title>
              <Tag color={interviewCfg.enabled ? 'green' : 'default'} className="set-title-tag">
                {interviewCfg.enabled ? 'ON' : 'OFF'}
              </Tag>
            </div>
            <Text type="secondary" className="set-lede">
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
              className="set-mt-1"
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
          <div className="set-inline">
            <span className="set-strong">
              Email them
            </span>
            <InputNumber
              min={5}
              max={1440}
              step={5}
              value={interviewCfg.lead_minutes}
              onChange={(val) => val && saveInterviewCfg({ lead_minutes: val })}
              addonAfter="minutes"
              className="set-control--fixed"
            />
            <span className="set-strong">
              before the interview starts
            </span>
          </div>

          <div className="set-block">
            <span className="set-strong">
              How often the system checks for interviews coming up
            </span>
            <Text type="secondary" className="set-hint">
              A background check that usually finds nothing — it only decides how precisely the timing above is hit.
              Shorter is more accurate.
            </Text>
          </div>
          <div className="set-scroll">
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
          <div className="set-callout set-callout--stack-lg">
            <strong>What this means:</strong> for an interview at 3:00 PM, the candidate and interviewer
            are emailed at about <strong>{exampleTime}</strong>
            {` (within ${interviewCfg.interval_minutes} minute${interviewCfg.interval_minutes === 1 ? '' : 's'} of that).`}
            {' '}Everyone gets one reminder per interview.
          </div>

          {leadTooShort && (
            <div className="set-callout set-callout--warn set-callout--stack">
              <strong>Reminders may be missed.</strong> The check runs every {interviewCfg.interval_minutes} minutes
              but reminders are set to go out only {interviewCfg.lead_minutes} minutes ahead, so the system can skip
              past that window entirely. Raise the lead time to at least {interviewCfg.interval_minutes} minutes,
              or check more often.
            </div>
          )}
        </div>
      </Surface>

      {/* Interview completion sweep — decides whether a finished interview actually
          happened, which is what releases the interviewer's scorecard email. */}
      <Surface tier={2} padding="relaxed" className="set-mb-5">
        <div className="set-split">
          <div className="set-split__main">
            <div className="set-title-row">
              <CalendarOutlined className="set-title-icon" />
              <Title level={4} className="set-card-title set-card-title--flush">
                Interview Completion Check
              </Title>
              <Tag color={occurrenceCfg.enabled ? 'green' : 'default'} className="set-title-tag">
                {occurrenceCfg.enabled ? 'ON' : 'OFF'}
              </Tag>
            </div>
            <Text type="secondary" className="set-lede">
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
              className="set-mt-1"
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
          <div className="set-inline">
            <span className="set-strong">
              Wait
            </span>
            <InputNumber
              min={0}
              max={1440}
              step={5}
              value={occurrenceCfg.grace_minutes}
              onChange={(val) => val !== null && saveOccurrenceCfg({ grace_minutes: val })}
              addonAfter="minutes"
              className="set-control--fixed"
            />
            <span className="set-strong">
              after the interview ends before checking
            </span>
          </div>

          <div className="set-block">
            <span className="set-strong">
              How often the system checks for finished interviews
            </span>
            <Text type="secondary" className="set-hint">
              Only decides how quickly a finished interview is picked up. Shorter means the scorecard
              request reaches the interviewer sooner.
            </Text>
          </div>
          <div className="set-scroll">
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
          <div className="set-callout set-callout--stack-lg">
            <strong>What this means:</strong> for an interview ending at 8:00 PM, the system first looks
            at about <strong>{occurrenceExampleTime}</strong>
            {` and settles it within ${occurrenceCfg.interval_minutes} minute${occurrenceCfg.interval_minutes === 1 ? '' : 's'} of that.`}
            {' '}The interviewer’s scorecard email goes out as soon as the interview is confirmed held.
          </div>

          {/* Which of the sweep's two modes will actually run. Teams attendance is an
              env-level switch, so the card states it rather than pretending to own it. */}
          {occurrenceCfg.attendance_enabled ? (
            <div className="set-callout set-callout--stack">
              <strong>Confirmed automatically.</strong> The verdict is read from the Teams attendance report.
              {occurrenceCfg.attendance_guest_candidate
                ? ' The interviewer must join signed in with the address on the booking; the candidate can join as a guest, with no Teams account and no sign-in. The round counts as held once the interviewer and at least one other person have attended.'
                : ' Both the interviewer and the candidate must join signed in with the addresses on the booking — a guest join will not be recognised.'}
              {' '}If nobody joined on one side it is recorded as a no-show instead, no scorecard is sent,
              and the team is alerted to reschedule or reject.
            </div>
          ) : (
            <div className="set-callout set-callout--warn set-callout--stack">
              <strong>Teams attendance reading is turned off for this environment.</strong> The check
              cannot confirm an interview on its own, so instead it emails the recruitment mailbox
              asking someone to confirm it — up to three times, a day apart. The scorecard still only
              goes out once an interview is marked held in the Candidate Pipeline.
            </div>
          )}
        </div>
      </Surface>

      {/* Recording capture — the next link in the same chain: book → remind →
          confirm held → capture the recording. */}
      <Card
        bordered={false}
        className="glass-card"
        style={{ marginBottom: 24 }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 320px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 6px 0' }}>
              <VideoCameraOutlined style={{ color: 'var(--gold)', fontSize: 18 }} />
              <Title level={4} style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, margin: 0 }}>
                Interview Recording Capture
              </Title>
              <Tag color={recordingCfg.enabled && recordingCfg.fetch_enabled ? 'green' : 'default'} style={{ marginInlineStart: 4 }}>
                {recordingCfg.enabled && recordingCfg.fetch_enabled ? 'ON' : 'OFF'}
              </Tag>
            </div>
            <Text type="secondary" style={{ fontSize: 13 }}>
              After a recorded interview ends, finds the Microsoft Teams recording and attaches it to
              the candidate’s round, so the final decision-makers can watch the earlier interviews.
              Without this the recording still exists in Teams, but nothing in the ATS points to it.
            </Text>
          </div>
          <Spin spinning={recordingLoading || recordingSaving}>
            <Switch
              checked={recordingCfg.enabled}
              onChange={(checked) => saveRecordingCfg({ enabled: checked })}
              disabled={recordingLoading || !recordingCfg.fetch_enabled}
              checkedChildren="ON"
              unCheckedChildren="OFF"
              style={{ marginTop: 4 }}
            />
          </Spin>
        </div>

        {/* The environment gate. Stated before anything else, because with it off
            the toggle above cannot do anything and would otherwise look broken. */}
        {!recordingCfg.fetch_enabled && !recordingLoading && (
          <div
            style={{
              marginTop: 16,
              background: 'var(--warn-bg)',
              border: '1px solid var(--warn-border)',
              borderRadius: 8,
              padding: '12px 16px',
              color: 'var(--warn-text)',
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            <strong>Recording capture is not available in this environment.</strong> It needs the
            Microsoft permission that lets the ATS read meeting recordings, which is switched on by
            a developer rather than here. Interviews still record themselves — only the automatic
            link-back is unavailable, so a recording would have to be found in Teams by hand.
          </div>
        )}

        <div
          style={{
            marginTop: 20,
            opacity: recordingCfg.enabled && recordingCfg.fetch_enabled ? 1 : 0.45,
            pointerEvents: recordingCfg.enabled && recordingCfg.fetch_enabled ? 'auto' : 'none',
            transition: 'opacity 0.2s',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>
              Wait
            </span>
            <InputNumber
              min={0}
              max={1440}
              step={5}
              value={recordingCfg.grace_minutes}
              onChange={(val) => val !== null && saveRecordingCfg({ grace_minutes: val })}
              addonAfter="minutes"
              style={{ width: 160 }}
            />
            <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>
              after the interview ends before looking
            </span>
          </div>

          <div style={{ marginTop: 22, marginBottom: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>
              How often the system looks for new recordings
            </span>
            <Text type="secondary" style={{ fontSize: 12.5, display: 'block', marginTop: 2 }}>
              Microsoft Teams decides when a recording becomes available — usually a few minutes
              after the call, sometimes longer. Checking more often than every 5 minutes mostly asks
              a question Teams cannot answer yet, so 10–15 minutes is the sensible range.
            </Text>
          </div>
          <div style={{ overflowX: 'auto', maxWidth: '100%', paddingBottom: 2 }}>
            <Segmented
              value={recordingCfg.interval_minutes}
              onChange={(val) => saveRecordingCfg({ interval_minutes: val })}
              options={INTERVIEW_CHECK_INTERVALS.map((m) => ({
                label: m === 60 ? '1 hour' : `${m} min`,
                value: m,
              }))}
            />
          </div>

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
            <strong>What this means:</strong> an interview ending at 8:00 PM is first looked at
            around {' '}
            <strong>
              {dayjs().hour(20).minute(0).second(0).add(recordingCfg.grace_minutes || 0, 'minute').format('h:mm A')}
            </strong>
            {`, and is re-checked every ${recordingCfg.interval_minutes} minute${recordingCfg.interval_minutes === 1 ? '' : 's'} until the recording appears.`}
            {' '}A round that turns out never to have been recorded is simply left alone.
          </div>

          {/* The cost of leaving this off is delayed and silent, so it is spelled
              out rather than left for someone to discover months later. */}
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
            <strong>If you switch this off:</strong> interviews carry on recording and nothing is
            lost in Teams — but the ATS stops linking those recordings to candidates, so nobody can
            open them from a candidate’s record. Switching it back on picks up anything from the
            last 45 days; older rounds can no longer be matched automatically, because Microsoft
            stops serving a meeting’s recording about 60 days after it took place.
          </div>
        </div>
      </Card>

      {/* The `borderTop: 4px solid var(--gold)` rail goes, as it did on
          /candidates, /mrf and the upload screens — a flat bar under a gradient
          rim is the pre-glass vocabulary showing through. */}
      <Surface tier={2} padding="relaxed">
        <div className="set-mb-5">
          <Title level={3} className="set-card-title">
            Reminder Settings
          </Title>
          <Text type="secondary" className="set-lede">
            Configure automated email reminder behaviour across all recruitment workflows. Changes take effect immediately for all future reminders.
          </Text>
        </div>

        {/* How it works info banner */}
        <div className="set-callout set-callout--banner set-callout--gap">
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
          <div className="set-form-row set-form-row--gap">
            <Form.Item
              label={<span className="set-label">Remind After X Days of No Response</span>}
              name="reminder_interval_days"
              rules={[{ required: true, message: 'Required' }]}
              className="set-item--wide"
            >
              <InputNumber
                min={0}
                max={90}
                className="set-control"
              />
            </Form.Item>

            <Form.Item
              label={<span className="set-label">Maximum Number of Reminders to Send</span>}
              name="reminder_max_count"
              rules={[{ required: true, message: 'Required' }]}
              className="set-item--wide"
            >
              <InputNumber
                min={0}
                max={20}
                className="set-control"
              />
            </Form.Item>

            <Form.Item
              label={<span className="set-label">Daily Trigger Time</span>}
              name="reminder_time"
              rules={[{ required: true, message: 'Required' }]}
              className="set-item--narrow"
            >
              <TimePicker
                format="HH:mm"
                className="set-control"
              />
            </Form.Item>

            <Button
              emphasis="solid"
              htmlType="submit"
              icon={<SaveOutlined />}
              loading={saving}
              /* `.set-btn` retired — it set height (--control-h-relaxed), radius,
                 weight and inline padding, which is exactly `size="lg"`. */
              size="lg"
            >
              Save Settings
            </Button>
          </div>
        </Form>

        {/* Email Coverage static info block */}
        <div className="set-mt-7">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              marginBottom: 16,
            }}
          >
            <span className="set-rule-label">
              Email Coverage
            </span>
            <div className="set-rule" />
          </div>

          <Table
            columns={emailCoverageColumns}
            dataSource={emailCoverageData}
            pagination={false}
            bordered
            size="middle"
            rowClassName={() => 'coverage-table-row'}
            className="set-table"
          />
        </div>
      </Surface>

      {/* Assessment Automation — Evalground invite deadline + auto-advance/reject toggle */}
      <Surface tier={2} padding="relaxed" className="set-mt-5">
        <div className="set-mb-5">
          <Title level={3} className="set-card-title">
            Assessment Automation
          </Title>
          <Text type="secondary" className="set-lede">
            Controls for the Evalground assessment round on the Candidate Pipeline.
          </Text>
        </div>

        <div className="set-callout set-callout--banner set-callout--gap">
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
          <div className="set-form-row">
            <Form.Item
              label={<span className="set-label">Invite Deadline (Days)</span>}
              name="assessment_deadline_days"
              rules={[{ required: true, message: 'Required' }]}
              className="set-item--mid"
            >
              <InputNumber
                min={1}
                max={30}
                className="set-control"
              />
            </Form.Item>

            <Form.Item
              label={<span className="set-label">Auto-Advance / Auto-Reject on Score</span>}
              name="assessment_auto_advance_enabled"
              valuePropName="checked"
              className="set-item"
            >
              <Switch disabled={!isAdmin} />
            </Form.Item>

            <Button
              emphasis="solid"
              htmlType="submit"
              icon={<SaveOutlined />}
              loading={assessmentSaving}
              /* `.set-btn` retired — it set height (--control-h-relaxed), radius,
                 weight and inline padding, which is exactly `size="lg"`. */
              size="lg"
            >
              Save Settings
            </Button>
          </div>
          {!isAdmin && (
            <Text type="secondary" className="set-hint set-hint--gap">
              Only an admin can change the auto-advance/auto-reject toggle.
            </Text>
          )}
        </Form>
      </Surface>

      {/* Pipeline stages / outcomes / reasons — admin only, matching the
          requireAdmin gate the API enforces. Hidden rather than disabled for
          non-admins: there is nothing here a recruiter can act on. */}
      {isAdmin && <PipelineConfigPanel />}
      </PageShell>
    </DesignScope>
  );
}
