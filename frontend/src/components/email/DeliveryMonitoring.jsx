import { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Col,
  Row,
  Select,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
  Button,
  Space,
  Alert,
} from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  EyeOutlined,
  MessageOutlined,
  StopOutlined,
  ReloadOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import emailTemplateService from '../../services/emailTemplateService';
import ExportButton from '../common/ExportButton';

dayjs.extend(relativeTime);

const { Text } = Typography;

/** Panel shell shared with the other Analytics tabs, so radius/shadow match. */
const PANEL_STYLE = {
  borderRadius: 14,
  border: '1px solid var(--border-light)',
  boxShadow: 'var(--shadow-sm)',
};

/** Coloured rule + title, mirroring SectionTitle on the Analytics page. */
function PanelTitle({ children, accent }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
      <span style={{
        width: 4, height: 16, borderRadius: 3, background: accent, flexShrink: 0,
      }}
      />
      <Text strong style={{ fontSize: 14 }}>{children}</Text>
    </span>
  );
}

/**
 * Email delivery monitoring view — surfaces the send/tracking data that the
 * backend has been recording (rpa_email_log.status, rpa_email_tracking) but no
 * UI displayed. Rendered as the "Email Delivery" tab on the Analytics page.
 * Stat tiles carry meaning via icon + label (not color alone); detail lives in
 * the two tables.
 */
export default function DeliveryMonitoring() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(30);
  const [errored, setErrored] = useState(false);

  const load = useCallback(async (windowDays) => {
    setLoading(true);
    setErrored(false);
    try {
      const res = await emailTemplateService.getEmailMonitoring(windowDays);
      setData(res.data?.data || res.data || null);
    } catch {
      // A swallowed failure here rendered every tile as 0, which reads as a
      // clean month with no failures and no bounces — the worst possible
      // failure mode for a monitoring tab. Say the request failed instead.
      setData(null);
      setErrored(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(days);
  }, [days, load]);

  const summary = data?.summary || {};
  const poller = data?.poller_status || {};

  // Same semantic palette as the Analytics page: a count that means "something
  // went wrong" is only tinted red when it is actually non-zero, so a clean
  // window reads calm rather than alarming.
  const tiles = [
    {
      key: 'sent', title: 'Sent', value: summary.sent, icon: <CheckCircleOutlined />, tone: '#2f6f9f',
    },
    {
      key: 'failed', title: 'Failed', value: summary.failed, icon: <CloseCircleOutlined />, tone: summary.failed > 0 ? '#c0392b' : undefined,
    },
    {
      key: 'opened',
      title: 'Opened',
      value: summary.opened,
      icon: <EyeOutlined />,
      tone: '#4f2fb8',
      hint: 'Opens are a positive signal, not an exact count — mail clients proxy or block tracking images.',
    },
    {
      key: 'replied', title: 'Replied', value: summary.replied, icon: <MessageOutlined />, tone: summary.replied > 0 ? '#4f2fb8' : undefined,
    },
    {
      key: 'bounced', title: 'Bounced', value: summary.bounced, icon: <StopOutlined />, tone: summary.bounced > 0 ? '#c0392b' : undefined,
    },
  ];

  const byTypeColumns = [
    { title: 'Email type', dataIndex: 'email_type', key: 'email_type' },
    { title: 'Sent', dataIndex: 'sent', key: 'sent', align: 'right' },
    {
      title: 'Failed',
      dataIndex: 'failed',
      key: 'failed',
      align: 'right',
      render: (v) =>
        v > 0 ? (
          <Tag icon={<CloseCircleOutlined />} color="error">
            {v}
          </Tag>
        ) : (
          v
        ),
    },
  ];

  const failureColumns = [
    {
      title: 'When',
      dataIndex: 'sent_at',
      key: 'sent_at',
      width: 150,
      render: (v) => (v ? dayjs(v).format('DD MMM, HH:mm') : '—'),
    },
    { title: 'Type', dataIndex: 'email_type', key: 'email_type', width: 150 },
    { title: 'Recipient', dataIndex: 'recipient_email', key: 'recipient_email', ellipsis: true },
    { title: 'Error', dataIndex: 'error_message', key: 'error_message', ellipsis: true },
  ];

  const pollerSummary = (
    <Space size="small" wrap>
      <Tag color={poller.inbound_sync_enabled ? 'green' : 'default'}>
        Inbound sync: {poller.inbound_sync_enabled ? 'on' : 'off'}
      </Tag>
      <Tag color={poller.intake_enabled ? 'green' : 'default'}>
        Resume intake: {poller.intake_enabled ? 'on' : 'off'}
      </Tag>
      {poller.last_sync_at && (
        <Text type="secondary">last sync {dayjs(poller.last_sync_at).fromNow()}</Text>
      )}
    </Space>
  );

  return (
    <>
      <Row justify="space-between" align="middle" style={{ marginBottom: 12 }} gutter={[8, 8]}>
        <Col>{pollerSummary}</Col>
        <Col>
          <Space>
            <Tooltip title="How far back these email figures look. Every count and both tables below cover only this period — widen it to see older sends and failures.">
              <Select
                size="small"
                value={days}
                onChange={setDays}
                options={[
                  { value: 7, label: 'Last 7 days' },
                  { value: 30, label: 'Last 30 days' },
                  { value: 90, label: 'Last 90 days' },
                ]}
                style={{ cursor: 'help' }}
              />
            </Tooltip>
            <Tooltip title="Re-checks the mail records now. Email figures are not live — use this after a send to see whether it went out or failed.">
              <Button size="small" icon={<ReloadOutlined />} onClick={() => load(days)} loading={loading}>
                Refresh
              </Button>
            </Tooltip>
          </Space>
        </Col>
      </Row>

      {errored && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message="Failed to load email delivery data."
          description="The figures below are not current. Retry, or check that the backend is reachable."
          action={<Button size="small" onClick={() => load(days)}>Retry</Button>}
        />
      )}

      <Row gutter={[12, 12]}>
        {tiles.map((t) => (
          <Col xs={12} sm={8} md={4} key={t.key} flex="auto">
            <Card
              size="small"
              bordered={false}
              style={{
                borderRadius: 12,
                border: '1px solid var(--border-light)',
                boxShadow: 'var(--shadow-sm)',
                background: 'var(--gradient-card, #fff)',
                height: '100%',
              }}
            >
              <Statistic
                title={(
                  <Space size={6}>
                    <span style={{ color: t.tone || 'var(--text-2)' }}>{t.icon}</span>
                    <span style={{ fontSize: 12.5 }}>{t.title}</span>
                    {t.hint && (
                      <Tooltip title={t.hint}>
                        <InfoCircleOutlined style={{ color: 'var(--text-2)' }} />
                      </Tooltip>
                    )}
                  </Space>
                )}
                value={errored ? '—' : (t.value ?? 0)}
                valueStyle={{ color: t.tone || 'var(--text)', fontWeight: 800, fontSize: 26 }}
                loading={loading}
              />
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
        <Col xs={24} md={10}>
          <Card
            size="small"
            title={<PanelTitle accent="linear-gradient(90deg,#2f6f9f,#4f93c4)">By email type</PanelTitle>}
            bordered={false}
            style={PANEL_STYLE}
            extra={(
              <ExportButton
                tooltip="Downloads sent and failed counts for every kind of email in this period — useful for spotting one template failing while the rest are fine."
                request={(cfg) => emailTemplateService.exportEmailMonitoring('by_type', days, cfg)}
                fallbackName="AAPNA-ATS_Email-Delivery-By-Type.csv"
                rowCount={data?.by_type?.length ?? null}
                label="Export"
                size="small"
              />
            )}
          >
            <Table
              size="small"
              rowKey="email_type"
              columns={byTypeColumns}
              dataSource={data?.by_type || []}
              loading={loading}
              pagination={false}
              scroll={{ y: 260 }}
            />
          </Card>
        </Col>
        <Col xs={24} md={14}>
          <Card
            size="small"
            title={<PanelTitle accent="linear-gradient(90deg,#c0392b,#e0654f)">Recent failures</PanelTitle>}
            bordered={false}
            style={PANEL_STYLE}
            extra={(
              <ExportButton
                tooltip="Downloads every failed send in this period with its recipient and the full error message — the file to attach when reporting an email problem."
                request={(cfg) => emailTemplateService.exportEmailMonitoring('failures', days, cfg)}
                fallbackName="AAPNA-ATS_Email-Delivery-Failures.csv"
                rowCount={data?.recent_failures?.length ?? null}
                fullSetNote="This is every failure in the window — the table above shows only the 20 most recent."
                label="Export"
                size="small"
              />
            )}
          >
            <Table
              size="small"
              rowKey="id"
              columns={failureColumns}
              dataSource={data?.recent_failures || []}
              loading={loading}
              pagination={false}
              scroll={{ y: 260 }}
              locale={{ emptyText: 'No failed sends in this window 🎉' }}
              expandable={{
                // Full error text for truncated rows.
                expandedRowRender: (row) => (
                  <Text type="secondary" style={{ whiteSpace: 'pre-wrap' }}>
                    {row.subject ? `Subject: ${row.subject}\n` : ''}
                    {row.error_message || 'No detail recorded.'}
                  </Text>
                ),
              }}
            />
          </Card>
        </Col>
      </Row>
    </>
  );
}
