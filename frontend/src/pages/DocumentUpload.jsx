/**
 * DocumentUpload.jsx — PUBLIC (no-login) candidate document-upload page, opened
 * from an emailed tokenized link (/documents/:token).
 *
 * Shows the checklist HR asked for, one row per document. Files are CHOSEN
 * first and held locally, then sent together by an explicit "Submit documents"
 * button — previously each file uploaded the instant it was picked, so the
 * candidate never got a confirm step and there was no submit action at all.
 *
 * Wrapped in PublicPageShell so it carries the same AAPNA branding as the email
 * that linked here. Deliberately does NOT advertise "secure link · no login
 * needed": that reassures nobody and reads like a warning.
 */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Button, Typography, Alert, Spin, Space, Result, Tag, Upload, message,
} from 'antd';
import {
  UploadOutlined, CheckCircleOutlined, FileTextOutlined, CloseCircleOutlined,
} from '@ant-design/icons';
import documentService from '../services/documentService';
import PublicPageShell, { BRAND } from '../components/common/PublicPageShell';

const { Text, Paragraph } = Typography;

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
  const [submitting, setSubmitting] = useState(false);
  /** Files chosen but not yet sent, keyed by checklist_item_id. */
  const [staged, setStaged] = useState({});

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

  const stageFile = (item, file) => {
    setStaged((prev) => ({ ...prev, [item.checklist_item_id]: file }));
  };
  const unstageFile = (itemId) => {
    setStaged((prev) => {
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  };

  const stagedIds = Object.keys(staged);

  /**
   * Sends every staged file. Uploads are sequential and independent: one
   * failure must not discard the others, so successes are cleared from the
   * staging area and only the failures stay behind for a retry.
   */
  const submitAll = async () => {
    setSubmitting(true);
    // Track the failing IDs, not just a count — a failure can land anywhere in
    // the list, so "everything after N" would strand the wrong files.
    const failedIds = [];
    for (const id of stagedIds) {
      try {
        await documentService.upload(token, Number(id), staged[id]);
      } catch {
        failedIds.push(id);
      }
    }
    setStaged((prev) => {
      const next = {};
      failedIds.forEach((id) => { next[id] = prev[id]; });
      return next;
    });
    setSubmitting(false);

    const sent = stagedIds.length - failedIds.length;
    if (failedIds.length === 0) {
      message.success(sent === 1 ? 'Document submitted.' : `${sent} documents submitted.`);
    } else {
      message.error(`${failedIds.length} of ${stagedIds.length} could not be sent. Please try those again.`);
    }
    await load();
  };

  if (loading) {
    return (
      <PublicPageShell title="Upload your documents" subtitle="Loading your checklist…">
        <div style={{ textAlign: 'center', padding: '32px 0' }}><Spin size="large" /></div>
      </PublicPageShell>
    );
  }
  if (error && !view) {
    return (
      <PublicPageShell title="Link unavailable" subtitle="We could not open this document request.">
        <Result status="error" title="Link unavailable" subTitle={error} />
      </PublicPageShell>
    );
  }
  if (view?.state === 'closed') {
    return (
      <PublicPageShell title="This request is closed" subtitle="No further documents are needed here.">
        <Result
          status="info"
          title="This upload link is closed"
          subTitle="Please contact the recruitment team if you still need to send documents."
        />
      </PublicPageShell>
    );
  }

  const items = view?.items || [];
  const allDone = items.length > 0 && items.every((i) => i.status === 'verified');
  const outstanding = items.filter((i) => i.status !== 'verified').length;

  // "Sent everything, waiting on us" is a THIRD state, distinct from verified.
  // Without it the candidate submitted their files and was handed back the same
  // checklist with a greyed-out button reading "Choose your files to continue" —
  // the toast had already faded, so nothing on the page said the upload worked.
  // Verification is an HR action that can take days; the acknowledgement cannot
  // wait for it.
  const nothingStaged = stagedIds.length === 0;
  const awaitingReview = !allDone
    && items.length > 0
    && nothingStaged
    && items.every((i) => i.status === 'uploaded' || i.status === 'verified');

  return (
    <PublicPageShell
      title="Upload your documents"
      subtitle={
        allDone
          ? 'Everything we asked for has been received and verified.'
          : awaitingReview
            ? 'Everything has been received. Our team is reviewing it now.'
            : `Share the ${outstanding} document${outstanding === 1 ? '' : 's'} listed below so we can move your application forward.`
      }
    >
      {(view?.candidate_name || view?.position) && (
        <div
          style={{
            background: BRAND.page,
            borderRadius: 10,
            padding: '12px 16px',
            marginBottom: 18,
            display: 'flex',
            flexWrap: 'wrap',
            gap: '4px 28px',
          }}
        >
          {view?.candidate_name && (
            <div>
              <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>CANDIDATE</Text>
              <Text strong>{view.candidate_name}</Text>
            </div>
          )}
          {view?.position && (
            <div>
              <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>POSITION</Text>
              <Text strong>{view.position}</Text>
            </div>
          )}
        </div>
      )}

      {allDone ? (
        <Alert
          type="success"
          showIcon
          icon={<CheckCircleOutlined />}
          message="All documents received and verified. Nothing further is needed — thank you."
        />
      ) : (
        <>
          {/* Acknowledgement stays ABOVE the checklist rather than replacing it —
              a rejected document later flips one row back to actionable, and the
              candidate needs to be able to see and replace it. */}
          {awaitingReview && (
            <Alert
              type="success"
              showIcon
              icon={<CheckCircleOutlined />}
              message="Documents received — thank you."
              description="Everything on your checklist has been submitted. Our recruitment team will review it and get back to you. You can close this page; the link stays valid if we need anything else."
              style={{ marginBottom: 18 }}
            />
          )}

          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {items.map((item) => (
              <DocumentRow
                key={item.checklist_item_id}
                item={item}
                stagedFile={staged[item.checklist_item_id]}
                onChoose={(file) => stageFile(item, file)}
                onClear={() => unstageFile(item.checklist_item_id)}
              />
            ))}
          </Space>

          <Paragraph type="secondary" style={{ fontSize: 12.5, margin: '18px 0 14px 0' }}>
            Accepted formats: PDF, DOC/DOCX, JPG or PNG — up to 10&nbsp;MB each.
          </Paragraph>

          <Button
            type="primary"
            size="large"
            block
            loading={submitting}
            disabled={stagedIds.length === 0}
            onClick={submitAll}
            style={{ background: stagedIds.length ? BRAND.accent : undefined, borderColor: stagedIds.length ? BRAND.accent : undefined, fontWeight: 600 }}
          >
            {stagedIds.length === 0
              ? (awaitingReview ? 'Nothing left to send' : 'Choose your files to continue')
              : `Submit ${stagedIds.length} document${stagedIds.length === 1 ? '' : 's'}`}
          </Button>
        </>
      )}
    </PublicPageShell>
  );
}

/** One checklist row: what's needed, its state, and the file chooser. */
function DocumentRow({ item, stagedFile, onChoose, onClear }) {
  const tag = STATUS_TAG[item.status] || STATUS_TAG.pending;
  const locked = item.status === 'verified';
  // beforeUpload returning false keeps the file client-side; nothing is sent
  // until the candidate presses Submit.
  const beforeUpload = (file) => {
    onChoose(file);
    return false;
  };

  return (
    <div
      style={{
        border: `1px solid ${stagedFile ? BRAND.accent : '#e8eaec'}`,
        borderRadius: 10,
        padding: '14px 16px',
        background: stagedFile ? 'rgba(79,47,184,0.04)' : '#fff',
        transition: 'border-color .2s, background .2s',
      }}
    >
      <Space direction="vertical" size={7} style={{ width: '100%' }}>
        <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
          <Text strong style={{ fontSize: 13.5 }}>{item.label}</Text>
          <Tag color={stagedFile ? 'processing' : tag.color} style={{ marginInlineEnd: 0 }}>
            {stagedFile ? 'Ready to submit' : tag.label}
          </Tag>
        </Space>

        {item.description ? (
          <Text type="secondary" style={{ fontSize: 12.5 }}>{item.description}</Text>
        ) : null}

        {item.status === 'rejected' && item.remarks ? (
          <Alert type="warning" showIcon message={`Please re-upload: ${item.remarks}`} />
        ) : null}

        {item.original_name && !stagedFile ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            <FileTextOutlined style={{ marginInlineEnd: 5 }} />
            {item.original_name}
          </Text>
        ) : null}

        {stagedFile ? (
          <Space size={8} wrap>
            <Text style={{ fontSize: 12.5 }}>
              <FileTextOutlined style={{ marginInlineEnd: 5, color: BRAND.accent }} />
              {stagedFile.name}
            </Text>
            <Button size="small" type="text" danger icon={<CloseCircleOutlined />} onClick={onClear}>
              Remove
            </Button>
          </Space>
        ) : !locked && (
          <Upload beforeUpload={beforeUpload} showUploadList={false} maxCount={1}>
            <Button size="small" icon={<UploadOutlined />}>
              {item.status === 'pending' ? 'Choose file' : 'Replace file'}
            </Button>
          </Upload>
        )}
      </Space>
    </div>
  );
}
