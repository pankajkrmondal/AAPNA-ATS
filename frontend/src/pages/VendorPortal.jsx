/**
 * VendorPortal.jsx — Vendor Upload + persistent job-tracking dashboard.
 *
 *  • Vendors upload their own resumes; internal staff upload on behalf of a
 *    selected vendor (required picker).
 *  • The lower section is a persistent dashboard: it loads existing upload jobs
 *    from the DB on mount (survives navigation/refresh) and updates live via
 *    Socket.io. Recruiters can Merge/Cancel duplicates and Reprocess failures.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Card,
  Upload,
  Button,
  Typography,
  Table,
  Input,
  Space,
  Tag,
  Tooltip,
  Modal,
  Alert,
  message,
  Statistic,
  Row,
  Col,
  Select,
  Descriptions,
} from 'antd';
import {
  UploadOutlined,
  InboxOutlined,
  FileTextOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
  WarningOutlined,
  ShopOutlined,
  ReloadOutlined,
  MergeCellsOutlined,
  ExclamationCircleOutlined,
  RedoOutlined,
} from '@ant-design/icons';
import useAuth from '../hooks/useAuth';
import vendorService from '../services/vendorService';
import { getSocket } from '../services/socket';

const { Title, Text } = Typography;
const { Dragger } = Upload;

const PAGE_SIZE = 10;

/** Map a stored status (underscored) to a user-friendly label + AntD tag colour/icon. */
const STATUS_META = {
  Uploaded: { label: 'Received', color: 'default' },
  Queued: { label: 'Waiting in Queue', color: 'blue', icon: <SyncOutlined /> },
  Processing: { label: 'Processing', color: 'processing', icon: <SyncOutlined spin /> },
  Duplicate_Pending_Review: { label: 'Pending Recruiter Review', color: 'warning', icon: <WarningOutlined /> },
  Missing_Information: { label: 'Awaiting Candidate Details', color: 'orange', icon: <ExclamationCircleOutlined /> },
  Completed: { label: 'Saved to Database', color: 'success', icon: <CheckCircleOutlined /> },
  Failed: { label: 'Processing Failed', color: 'error', icon: <CloseCircleOutlined /> },
  Cancelled: { label: 'Rejected by Recruiter', color: 'default', icon: <CloseCircleOutlined /> },
};

const STATUS_FILTERS = Object.keys(STATUS_META).map((s) => ({
  value: s,
  label: STATUS_META[s].label,
}));

function formatDate(dateStr) {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

export default function VendorPortal() {
  const { user } = useAuth();
  // Internal staff upload on behalf of a selected vendor; vendors upload for themselves.
  const isStaff = (user?.role || '').toLowerCase() !== 'vendor';

  // ── Staff vendor-picker ──
  const [vendors, setVendors] = useState([]);
  const [selectedVendor, setSelectedVendor] = useState(null);

  // ── Upload state ──
  const [fileList, setFileList] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState(null);

  // ── Jobs dashboard state ──
  const [jobs, setJobs] = useState([]);
  const [jobsTotal, setJobsTotal] = useState(0);
  const [actionCount, setActionCount] = useState(0);
  const [jobsPage, setJobsPage] = useState(1);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState(null);
  const [onlyActionRequired, setOnlyActionRequired] = useState(false);
  // Upload Status table filter — independent of the upload picker; "all vendors" by default.
  const [jobFilterVendor, setJobFilterVendor] = useState(null);

  // ── Review modal ──
  const [reviewJob, setReviewJob] = useState(null);
  const [reviewBusy, setReviewBusy] = useState(false);

  const reloadRef = useRef(null);

  /* ═══════ LOAD VENDOR LIST (staff only) ═══════ */
  useEffect(() => {
    if (!isStaff) return;
    vendorService.getVendors()
      .then((res) => setVendors(res.data?.data || []))
      .catch(() => { /* non-fatal */ });
  }, [isStaff]);

  /* ═══════ JOBS LOADER ═══════ */
  // Staff see all vendors by default (filterable); vendors are scoped to their own by the API.
  const loadJobs = useCallback(async (page = jobsPage) => {
    setJobsLoading(true);
    try {
      const res = await vendorService.getJobs({
        page,
        limit: PAGE_SIZE,
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(onlyActionRequired ? { actionRequired: 'true' } : {}),
        ...(isStaff && jobFilterVendor ? { vendorEmail: jobFilterVendor } : {}),
      });
      const payload = res.data || {};
      setJobs(payload.data || []);
      setJobsTotal(payload.pagination?.total ?? (payload.data || []).length);
      setActionCount(payload.stats?.actionRequired ?? 0);
    } catch (err) {
      console.error('Failed to load upload jobs:', err);
      setJobs([]); setJobsTotal(0);
    } finally {
      setJobsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStaff, jobFilterVendor, statusFilter, onlyActionRequired, jobsPage]);

  // Reload whenever scope/filters change (resets to page 1).
  useEffect(() => {
    setJobsPage(1);
    loadJobs(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStaff, jobFilterVendor, statusFilter, onlyActionRequired]);

  /* ═══════ LIVE SOCKET UPDATES ═══════ */
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;

    // Debounced reload so bursts of events trigger a single refresh.
    const scheduleReload = () => {
      if (reloadRef.current) clearTimeout(reloadRef.current);
      reloadRef.current = setTimeout(() => loadJobs(jobsPage), 600);
    };
    socket.on('upload:job', scheduleReload);
    socket.on('review:new', scheduleReload);

    return () => {
      socket.off('upload:job', scheduleReload);
      socket.off('review:new', scheduleReload);
      if (reloadRef.current) clearTimeout(reloadRef.current);
    };
  }, [loadJobs, jobsPage]);

  /* ═══════ UPLOAD ═══════ */
  const handleUpload = async () => {
    if (fileList.length === 0) {
      setUploadMsg({ type: 'error', text: 'Please select at least one file.' });
      return;
    }
    if (isStaff && !selectedVendor) {
      setUploadMsg({ type: 'error', text: 'Please select a vendor to upload on behalf of.' });
      return;
    }
    const allowedExts = ['zip', 'pdf', 'docx'];
    const badFiles = fileList.filter((f) => !allowedExts.includes(f.name.split('.').pop().toLowerCase()));
    if (badFiles.length > 0) {
      setUploadMsg({ type: 'error', text: `❌ Invalid file type(s): ${badFiles.map((f) => f.name).join(', ')}.` });
      return;
    }

    setUploading(true);
    setUploadMsg(null);

    const formData = new FormData();
    fileList.forEach((file) => formData.append('resumes', file.originFileObj || file));
    if (isStaff && selectedVendor) formData.append('vendorEmail', selectedVendor);

    try {
      await vendorService.uploadResumes(formData);
      setUploadMsg({ type: 'success', text: '✅ Uploaded. Track processing status in the dashboard below.' });
      setFileList([]);
      setStatusFilter(null);
      setOnlyActionRequired(false);
      setTimeout(() => loadJobs(1), 800);
    } catch (err) {
      setUploadMsg({ type: 'error', text: `❌ ${err.response?.data?.message || err.message || 'Upload failed.'}` });
    } finally {
      setUploading(false);
    }
  };

  /* ═══════ REVIEW / REPROCESS ACTIONS ═══════ */
  const doMerge = async () => {
    if (!reviewJob?.cv_tmp_id) return;
    setReviewBusy(true);
    try {
      await vendorService.reviewMerge([reviewJob.cv_tmp_id]);
      message.success('Merged into the main candidate database.');
      setReviewJob(null);
      loadJobs(jobsPage);
    } catch (err) {
      message.error(err.response?.data?.message || err.message || 'Merge failed.');
    } finally {
      setReviewBusy(false);
    }
  };

  const doCancel = async () => {
    if (!reviewJob?.cv_tmp_id) return;
    setReviewBusy(true);
    try {
      await vendorService.reviewCancel([reviewJob.cv_tmp_id]);
      message.success('Duplicate cancelled/rejected.');
      setReviewJob(null);
      loadJobs(jobsPage);
    } catch (err) {
      message.error(err.response?.data?.message || err.message || 'Cancel failed.');
    } finally {
      setReviewBusy(false);
    }
  };

  const doReprocess = (record) => {
    Modal.confirm({
      title: 'Reprocess this resume?',
      icon: <ExclamationCircleOutlined />,
      content: `Re-run parsing for "${record.file_name}".`,
      okText: 'Reprocess',
      async onOk() {
        try {
          await vendorService.reprocessJob(record.id);
          message.success('Reprocessing started.');
          loadJobs(jobsPage);
        } catch (err) {
          message.error(err.response?.data?.message || err.message || 'Reprocess failed.');
        }
      },
    });
  };

  const openCV = (url) => {
    if (!url || url === 'null' || url.trim() === '') {
      Modal.warning({ title: '⚠️ Alert', content: 'Resume file is not available for this job.' });
      return;
    }
    window.open(url, '_blank');
  };

  /* ═══════ COLUMNS ═══════ */
  const columns = [
    {
      title: 'Candidate Name',
      key: 'candidate_name',
      render: (_, r) => <Text strong style={{ fontSize: 13 }}>{r.candidate_name || '—'}</Text>,
    },
    {
      title: 'Uploaded By',
      key: 'uploaded_by',
      render: (_, r) => <span style={{ fontSize: 12 }}>{r.uploaded_by || '—'}</span>,
    },
    {
      title: 'Vendor',
      key: 'vendor_name',
      render: (_, r) => <span style={{ fontSize: 12 }}>{r.vendor_name || r.vendor_email || '—'}</span>,
    },
    {
      title: 'Uploaded At',
      key: 'created_at',
      render: (_, r) => <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{formatDate(r.created_at)}</span>,
    },
    {
      title: 'Status',
      key: 'status',
      render: (_, r) => {
        const meta = STATUS_META[r.status] || { label: r.status, color: 'default' };
        return <Tag icon={meta.icon} color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: 'Duplicate',
      key: 'is_duplicate',
      align: 'center',
      render: (_, r) => (r.is_duplicate ? <Tag color="warning">Yes</Tag> : <Tag color="default">No</Tag>),
    },
    {
      title: 'Action Required',
      key: 'action_required',
      align: 'center',
      render: (_, r) => (r.action_required ? <Tag color="red">Yes</Tag> : <Tag color="green">No</Tag>),
    },
    {
      title: 'Last Updated',
      key: 'updated_at',
      render: (_, r) => <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{formatDate(r.updated_at)}</span>,
    },
    {
      title: 'Action',
      key: 'action',
      align: 'center',
      render: (_, r) => {
        const canReview = isStaff && r.action_required && r.cv_tmp_id;
        return (
          <Space size={6}>
            {canReview && (
              <Button size="small" type="primary" onClick={() => setReviewJob(r)}
                style={{ background: '#7a922e', borderColor: '#7a922e' }}>
                Review
              </Button>
            )}
            {r.status === 'Failed' && (
              <Tooltip title="Reprocess">
                <Button size="small" icon={<RedoOutlined />} onClick={() => doReprocess(r)} />
              </Tooltip>
            )}
            {r.file_url && (
              <Tooltip title="View Resume">
                <Button size="small" icon={<FileTextOutlined />} onClick={() => openCV(r.file_url)} />
              </Tooltip>
            )}
          </Space>
        );
      },
    },
  ];

  // Vendors don't need "Uploaded By", "Vendor", or "Action Required" (those are
  // recruiter-facing); show them only on staff screens.
  const STAFF_ONLY_COLS = ['uploaded_by', 'vendor_name', 'action_required'];
  const visibleColumns = columns.filter((c) => isStaff || !STAFF_ONLY_COLS.includes(c.key));

  return (
    <div className="page-enter" style={{ maxWidth: 1200, margin: '0 auto', padding: '0 0 40px' }}>
      <div
        style={{
          marginBottom: 24,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 16,
          alignItems: 'flex-end',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <Title level={3} style={{ margin: 0, fontWeight: 700 }}>
            {isStaff ? 'Vendor Manual Upload' : 'Upload Candidate'}
          </Title>
          <Text style={{ fontSize: 13, color: 'var(--text-2)', fontFamily: 'monospace' }}>
            Upload vendor-sourced resumes and track processing status in real time
          </Text>
        </div>

        {/* Staff pick the vendor here — same placement as the Vendor Dashboard.
            A muted label with the standard required asterisk signals it's mandatory;
            the disabled Upload button + on-submit message enforce it. */}
        {isStaff && (
          <div style={{ width: 280 }}>
            <Text
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--text-secondary)',
                display: 'block',
                marginBottom: 6,
              }}
            >
              On behalf of vendor <span style={{ color: '#c0392b' }}>*</span>
            </Text>
            <Select
              showSearch
              allowClear
              value={selectedVendor}
              onChange={(val) => setSelectedVendor(val || null)}
              placeholder="Select a vendor"
              suffixIcon={<ShopOutlined />}
              optionFilterProp="label"
              style={{ width: '100%' }}
              options={vendors.map((v) => ({ label: v.name, value: v.email }))}
            />
          </div>
        )}
      </div>

      {/* ═══════ UPLOAD CARD ═══════ */}
      <Card bordered={false} style={{ borderRadius: 12, marginBottom: 24, border: '1px solid rgba(0,0,0,0.07)' }}
        styles={{ body: { padding: 0 } }}>
        <div style={{ height: 3, background: 'linear-gradient(90deg, #7a922e, #92a63c)' }} />
        <div style={{ padding: '24px 28px 28px' }}>
          {/* Staff must pick a vendor (top-right) before uploading. */}
          {isStaff && !selectedVendor && (
            <Alert
              type="info"
              showIcon
              message="Select a vendor at the top right to upload on their behalf."
              style={{ marginBottom: 16, borderRadius: 10 }}
            />
          )}

          <Dragger
            multiple
            fileList={fileList}
            beforeUpload={() => false}
            onChange={({ fileList: newList }) => setFileList(newList)}
            accept=".zip,.pdf,.docx"
            style={{ padding: '20px', background: '#f5f5f0', borderRadius: 10, marginBottom: 16 }}
          >
            <p className="ant-upload-drag-icon"><InboxOutlined style={{ color: '#7a922e', fontSize: 38 }} /></p>
            <p className="ant-upload-text" style={{ fontWeight: 600 }}>Click or drag files to upload</p>
            <p className="ant-upload-hint" style={{ color: '#8a9270', fontFamily: 'monospace', fontSize: 12 }}>
              Supported: .pdf, .docx, .zip
            </p>
          </Dragger>

          <Button
            type="primary" size="large" block icon={<UploadOutlined />}
            loading={uploading} onClick={handleUpload}
            disabled={fileList.length === 0 || (isStaff && !selectedVendor)}
            style={{ height: 44, fontWeight: 600, borderRadius: 10,
              background: (fileList.length === 0 || (isStaff && !selectedVendor)) ? '#8a9270' : '#7a922e',
              borderColor: (fileList.length === 0 || (isStaff && !selectedVendor)) ? '#8a9270' : '#7a922e' }}
          >
            Upload Resumes
          </Button>

          {uploadMsg && (
            <Alert message={uploadMsg.text} type={uploadMsg.type} showIcon closable
              onClose={() => setUploadMsg(null)} style={{ marginTop: 14, borderRadius: 10 }} />
          )}
        </div>
      </Card>

      {/* ═══════ PERSISTENT JOB DASHBOARD ═══════ */}
      <Card bordered={false} style={{ borderRadius: 12, border: '1px solid rgba(0,0,0,0.07)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
          <div>
            <Text strong style={{ fontSize: 16, display: 'block' }}>Upload Status</Text>
            <Text style={{ fontSize: 12, color: 'var(--text-2)', fontFamily: 'monospace' }}>
              {isStaff ? 'Live processing status across all vendors — filter below.' : 'Live processing status for every uploaded resume.'}
            </Text>
          </div>
          <Button icon={<ReloadOutlined />} onClick={() => loadJobs(jobsPage)}>Refresh</Button>
        </div>

        {/* Stat cards */}
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={12} sm={8}>
            <Card size="small" style={{ borderRadius: 10, background: '#f5f5f0' }} styles={{ body: { padding: 14 } }}>
              <Statistic title="Total Uploads" value={jobsTotal} valueStyle={{ fontWeight: 700 }} />
            </Card>
          </Col>
          {isStaff && (
            <Col xs={12} sm={8}>
              <Card size="small" style={{ borderRadius: 10, background: 'rgba(192,57,43,0.08)', border: '1px solid #c0392b' }} styles={{ body: { padding: 14 } }}>
                <Statistic title="Pending Review" value={actionCount} valueStyle={{ fontWeight: 700, color: '#c0392b' }} />
              </Card>
            </Col>
          )}
        </Row>

        {/* Filters */}
        <Space style={{ marginBottom: 16 }} wrap>
          {isStaff && (
            <Select
              showSearch
              allowClear
              placeholder="All Vendors"
              suffixIcon={<ShopOutlined />}
              optionFilterProp="label"
              style={{ minWidth: 220 }}
              value={jobFilterVendor}
              onChange={(v) => setJobFilterVendor(v || null)}
              options={vendors.map((v) => ({ label: v.name, value: v.email }))}
            />
          )}
          <Select
            allowClear placeholder="Filter by status" style={{ minWidth: 220 }}
            value={statusFilter} onChange={(v) => setStatusFilter(v || null)} options={STATUS_FILTERS}
          />
          {isStaff && (
            <Button
              type={onlyActionRequired ? 'primary' : 'default'}
              danger={onlyActionRequired}
              onClick={() => setOnlyActionRequired((v) => !v)}
            >
              {onlyActionRequired ? 'Showing: Action Required' : 'Show Action Required'}
            </Button>
          )}
        </Space>

        <Table
          rowKey="id"
          dataSource={jobs}
          columns={visibleColumns}
          loading={jobsLoading}
          size="small"
          scroll={{ x: 900 }}
          pagination={{
            current: jobsPage,
            pageSize: PAGE_SIZE,
            total: jobsTotal,
            onChange: (p) => { setJobsPage(p); loadJobs(p); },
            showSizeChanger: false,
            showTotal: (t) => `Total ${t} uploads`,
          }}
        />
      </Card>

      {/* ═══════ REVIEW MODAL ═══════ */}
      <Modal
        title="Duplicate Review"
        open={!!reviewJob}
        onCancel={() => setReviewJob(null)}
        footer={[
          <Button key="cancel" danger icon={<CloseCircleOutlined />} loading={reviewBusy} onClick={doCancel}>
            Cancel / Reject
          </Button>,
          <Button key="merge" type="primary" icon={<MergeCellsOutlined />} loading={reviewBusy} onClick={doMerge}
            style={{ background: '#7a922e', borderColor: '#7a922e' }}>
            Merge into Database
          </Button>,
        ]}
      >
        {reviewJob && (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="Candidate">{reviewJob.candidate_name || '—'}</Descriptions.Item>
            <Descriptions.Item label="Email">{reviewJob.candidate_email || '—'}</Descriptions.Item>
            <Descriptions.Item label="Vendor">{reviewJob.vendor_name || reviewJob.vendor_email || '—'}</Descriptions.Item>
            <Descriptions.Item label="File">{reviewJob.file_name}</Descriptions.Item>
            <Descriptions.Item label="Uploaded By">{reviewJob.uploaded_by || '—'}</Descriptions.Item>
          </Descriptions>
        )}
        <Alert
          style={{ marginTop: 16 }} type="info" showIcon
          message="Merge updates the existing candidate with new values (blanks retained). Cancel deletes the staging record and keeps the existing candidate unchanged."
        />
      </Modal>
    </div>
  );
}
