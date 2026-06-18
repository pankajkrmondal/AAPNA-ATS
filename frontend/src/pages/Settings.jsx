/**
 * Settings Page — Replicates the legacy Reminder Settings page.
 * Contains automated email reminder behaviour and an Email Coverage guide table.
 */
import { useState, useEffect } from 'react';
import { Form, InputNumber, Button, Table, Card, Typography, message, Alert, TimePicker } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import settingsService from '../services/settingsService';

const { Title, Text } = Typography;

export default function Settings() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

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

  const emailCoverageColumns = [
    {
      title: 'WORKFLOW',
      dataIndex: 'workflow',
      key: 'workflow',
      width: '40%',
      render: (text) => <Text strong style={{ fontSize: 13, color: '#374151' }}>{text}</Text>,
    },
    {
      title: 'RESPONSE DETECTED BY',
      dataIndex: 'responseDetected',
      key: 'responseDetected',
      render: (text) => <Text style={{ fontSize: 13, color: '#374151', fontFamily: 'monospace' }}>{text}</Text>,
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
    <div style={{ padding: '24px', maxWidth: 1000, margin: '0 auto' }} className="animate-fade-in">
      <Card
        bordered={false}
        style={{
          borderRadius: 12,
          boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
          borderTop: '4px solid #7a922e',
        }}
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
            background: '#eff6ff',
            border: '1px solid #bfdbfe',
            borderRadius: 8,
            padding: '16px 20px',
            color: '#1e3a8a',
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
              label={<span style={{ fontWeight: 600, fontSize: 12, textTransform: 'uppercase', color: '#374151', letterSpacing: '0.4px' }}>Remind After X Days of No Response *</span>}
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
              label={<span style={{ fontWeight: 600, fontSize: 12, textTransform: 'uppercase', color: '#374151', letterSpacing: '0.4px' }}>Maximum Number of Reminders to Send *</span>}
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
              label={<span style={{ fontWeight: 600, fontSize: 12, textTransform: 'uppercase', color: '#374151', letterSpacing: '0.4px' }}>Daily Trigger Time *</span>}
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
                background: '#7a922e',
                borderColor: '#7a922e',
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
            <span style={{ fontWeight: 700, fontSize: 11, letterSpacing: '0.1em', color: '#6b7561', textTransform: 'uppercase' }}>
              Email Coverage
            </span>
            <div style={{ flex: 1, height: 1, background: '#dde2d0' }} />
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
              border: '1px solid #dde2d0',
            }}
          />
        </div>
      </Card>
    </div>
  );
}
