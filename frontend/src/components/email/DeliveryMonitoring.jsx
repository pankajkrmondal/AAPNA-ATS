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

  const load = useCallback(async (windowDays) => {
    setLoading(true);
    try {
      const res = await emailTemplateService.getEmailMonitoring(windowDays);
      setData(res.data?.data || res.data || null);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(days);
  }, [days, load]);

  const summary = data?.summary || {};
  const poller = data?.poller_status || {};

  const tiles = [
    { key: 'sent', title: 'Sent', value: summary.sent, icon: <CheckCircleOutlined /> },
    { key: 'failed', title: 'Failed', value: summary.failed, icon: <CloseCircleOutlined />, valueStyle: summary.failed > 0 ? { color: '#cf1322' } : undefined },
    { key: 'opened', title: 'Opened', value: summary.opened, icon: <EyeOutlined />, hint: 'Opens are a positive signal, not an exact count — mail clients proxy or block tracking images.' },
    { key: 'replied', title: 'Replied', value: summary.replied, icon: <MessageOutlined /> },
    { key: 'bounced', title: 'Bounced', value: summary.bounced, icon: <StopOutlined />, valueStyle: summary.bounced > 0 ? { color: '#cf1322' } : undefined },
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
            <Select
              size="small"
              value={days}
              onChange={setDays}
              options={[
                { value: 7, label: 'Last 7 days' },
                { value: 30, label: 'Last 30 days' },
                { value: 90, label: 'Last 90 days' },
              ]}
            />
            <Button size="small" icon={<ReloadOutlined />} onClick={() => load(days)} loading={loading}>
              Refresh
            </Button>
          </Space>
        </Col>
      </Row>

      <Row gutter={[12, 12]}>
        {tiles.map((t) => (
          <Col xs={12} sm={8} md={4} key={t.key} flex="auto">
            <Card size="small" bordered>
              <Statistic
                title={
                  <Space size={4}>
                    {t.icon}
                    {t.title}
                    {t.hint && (
                      <Tooltip title={t.hint}>
                        <InfoCircleOutlined style={{ color: '#999' }} />
                      </Tooltip>
                    )}
                  </Space>
                }
                value={t.value ?? 0}
                valueStyle={t.valueStyle}
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
            title="By email type"
            bordered
            extra={(
              <ExportButton
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
            title="Recent failures"
            bordered
            extra={(
              <ExportButton
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
