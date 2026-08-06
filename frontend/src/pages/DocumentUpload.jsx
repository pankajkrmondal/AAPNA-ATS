/**
 * DocumentUpload.jsx — PUBLIC (no-login) candidate document-upload page, opened
 * from an emailed tokenized link (/documents/:token).
 *
 * Shows the checklist HR asked for, one row per document, and lets the candidate
 * upload each one. A document HR rejected comes back with the reason attached so
 * the candidate knows exactly what to re-upload.
 */
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Card, Button, Typography, Alert, Spin, Space, Result, Divider, Tag, Upload, message,
} from 'antd';
import { UploadOutlined, CheckCircleOutlined } from '@ant-design/icons';
import documentService from '../services/documentService';

const { Title, Text, Paragraph } = Typography;

/** How each document state reads to the candidate. */
const STATUS_TAG = {
  pending: { color: 'default', label: 'Not uploaded' },
  uploaded: { color: 'blue', label: 'Uploaded — under review' },
  verified: { color: 'green', label: 'Verified' },
  rejected: { color: 'red', label: 'Needs re-upload' },
};

export default function DocumentUpload() {
  const { token } = useParams();

  const [loading, setLoading] = useState(true);
  const [view, setView] = useState(null);
  const [error, setError] = useState('');
  const [uploadingId, setUploadingId] = useState(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await documentService.getRequest(token);
      // API envelope is { status, message, data: <viewModel> }; unwrap it.
      setView(res?.data?.data ?? res?.data ?? res);
    } catch (err) {
      setError(err?.message || 'This upload link is invalid or could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (token) load(); /* eslint-disable-next-line */ }, [token]);

  const handleUpload = async (item, file) => {
    setUploadingId(item.checklist_item_id);
    try {
      await documentService.upload(token, item.checklist_item_id, file);
      message.success(`${item.label} uploaded.`);
      await load();
    } catch (err) {
      message.error(err?.message || 'Upload failed. Please try again.');
    } finally {
      setUploadingId(null);
    }
  };

  if (loading) {
    return <Centered><Spin size="large" tip="Loading…" /></Centered>;
  }
  if (error && !view) {
    return <Centered><Result status="error" title="Link unavailable" subTitle={error} /></Centered>;
  }
  if (view?.state === 'closed') {
    return (
      <Centered>
        <Result
          status="info"
          title="This upload link is closed"
          subTitle="Please contact the recruitment team if you still need to send documents."
        />
      </Centered>
    );
  }

  const items = view?.items || [];
  const allDone = items.length > 0 && items.every((i) => i.status === 'verified');

  return (
    <Centered wide>
      <Card style={{ width: '100%', maxWidth: 640 }}>
        <Title level={4} style={{ marginBottom: 4 }}>Upload your documents</Title>
        <Text type="secondary">Secure link · no login needed</Text>
        <Divider style={{ margin: '14px 0' }} />

        <Space direction="vertical" size={2} style={{ width: '100%', marginBottom: 14 }}>
          {view?.candidate_name ? <Text><strong>Candidate:</strong> {view.candidate_name}</Text> : null}
          {view?.position ? <Text><strong>Position:</strong> {view.position}</Text> : null}
        </Space>

        {allDone ? (
          <Alert
            type="success"
            showIcon
            icon={<CheckCircleOutlined />}
            message="All documents received and verified. Nothing further is needed — thank you."
            style={{ marginBottom: 14 }}
          />
        ) : (
          <Paragraph type="secondary" style={{ fontSize: 13 }}>
            Please upload each document below. Accepted formats: PDF, DOC/DOCX, JPG or PNG, up to 10&nbsp;MB each.
          </Paragraph>
        )}

        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {items.map((item) => (
            <DocumentRow
              key={item.checklist_item_id}
              item={item}
              uploading={uploadingId === item.checklist_item_id}
              onUpload={(file) => handleUpload(item, file)}
            />
          ))}
        </Space>
      </Card>
    </Centered>
  );
}

/** One checklist row: what's needed, its state, and the upload control. */
function DocumentRow({ item, uploading, onUpload }) {
  const tag = STATUS_TAG[item.status] || STATUS_TAG.pending;
  const locked = item.status === 'verified';
  // Upload's beforeUpload returning false keeps the file client-side so we can
  // post it ourselves through the shared axios instance.
  const beforeUpload = (file) => {
    onUpload(file);
    return false;
  };

  return (
    <Card size="small">
      <Space direction="vertical" size={6} style={{ width: '100%' }}>
        <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
          <Text strong style={{ fontSize: 13.5 }}>{item.label}</Text>
          <Tag color={tag.color}>{tag.label}</Tag>
        </Space>

        {item.description ? (
          <Text type="secondary" style={{ fontSize: 12.5 }}>{item.description}</Text>
        ) : null}

        {item.status === 'rejected' && item.remarks ? (
          <Alert type="warning" showIcon message={`Please re-upload: ${item.remarks}`} />
        ) : null}

        {item.original_name ? (
          <Text type="secondary" style={{ fontSize: 12 }}>Current file: {item.original_name}</Text>
        ) : null}

        {!locked && (
          <Upload beforeUpload={beforeUpload} showUploadList={false} maxCount={1}>
            <Button size="small" icon={<UploadOutlined />} loading={uploading}>
              {item.status === 'pending' ? 'Choose file' : 'Replace file'}
            </Button>
          </Upload>
        )}
      </Space>
    </Card>
  );
}

function Centered({ children, wide }) {
  return (
    <div style={{ minHeight: '100vh', background: '#f4f6f9', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: wide ? 660 : 480 }}>{children}</div>
    </div>
  );
}
