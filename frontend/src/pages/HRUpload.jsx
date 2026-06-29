/**
 * HRUpload.jsx — HR Manual Upload page (vendor-style).
 *
 *  • Compact upload card (drag-and-drop).
 *  • A single persistent "Upload Status" dashboard: loads existing upload jobs from the DB
 *    on mount (survives navigation/refresh) and updates live via Socket.io. It is the one
 *    place for everything — track processing status, and review duplicates inline
 *    (Review → full details → Merge / Reject) and reprocess failures.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Card,
  Upload,
  Button,
  Typography,
  Table,
  Space,
  Tag,
  Tooltip,
  Modal,
  Alert,
  Descriptions,
  Divider,
  message,
  Row,
  Col,
  Select,
  Progress,
} from 'antd';
import {
  UploadOutlined,
  InboxOutlined,
  EyeOutlined,
  FileTextOutlined,
  MergeCellsOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
  WarningOutlined,
  ExclamationCircleOutlined,
  ReloadOutlined,
  RedoOutlined,
  CloudUploadOutlined,
} from '@ant-design/icons';
import hrUploadService from '../services/hrUploadService';
import { getSocket } from '../services/socket';
import KpiCard from '../components/common/KpiCard';
import UploadCelebration from '../components/common/UploadCelebration';

const { Title, Text } = Typography;
const { Dragger } = Upload;

const PAGE_SIZE = 10; // upload-status jobs table

/** Map a stored status (underscored) to a user-friendly label + AntD tag colour/icon. */
const STATUS_META = {
  Uploaded: { label: 'Received', color: 'default', hint: 'Received and queued — parsing hasn’t started yet.' },
  Queued: { label: 'Waiting in Queue', color: 'blue', icon: <SyncOutlined />, hint: 'Waiting for the background worker to pick it up.' },
  Processing: { label: 'Processing', color: 'processing', icon: <SyncOutlined spin />, hint: 'Extracting text and parsing the resume with AI.' },
  Duplicate_Pending_Review: { label: 'Pending Recruiter Review', color: 'warning', icon: <WarningOutlined />, hint: 'Candidate already exists — a recruiter must merge or reject it.' },
  Missing_Information: { label: 'Awaiting Candidate Details', color: 'orange', icon: <ExclamationCircleOutlined />, hint: 'Saved, but waiting on mandatory candidate details.' },
  Completed: { label: 'Saved to Database', color: 'success', icon: <CheckCircleOutlined />, hint: 'Saved to the candidate database.' },
  Failed: { label: 'Processing Failed', color: 'error', icon: <CloseCircleOutlined />, hint: 'Processing failed — you can reprocess it.' },
  Rejected_By_System: { label: 'Rejected by System', color: 'volcano', icon: <CloseCircleOutlined />, hint: 'No valid email or phone on the resume — rejected; re-upload with at least one.' },
  Cancelled: { label: 'Rejected by Recruiter', color: 'default', icon: <CloseCircleOutlined />, hint: 'A recruiter rejected this duplicate.' },
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

export default function HRUpload() {
  // ── Upload state ──
  const [fileList, setFileList] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState(null);

  // ── Jobs dashboard state ──
  const [jobs, setJobs] = useState([]);
  const [jobsTotal, setJobsTotal] = useState(0);
  const [actionCount, setActionCount] = useState(0);
  const [processingCount, setProcessingCount] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);
  const [jobsPage, setJobsPage] = useState(1);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState(null);
  const [onlyActionRequired, setOnlyActionRequired] = useState(false);
  const reloadRef = useRef(null);

  // ── Premium UX state (count-up KPIs, live flash, upload progress, celebration) ──
  const [flashIds, setFlashIds] = useState(() => new Set());
  const [uploadPct, setUploadPct] = useState(0);
  const [celebrate, setCelebrate] = useState(false);
  const prevJobsRef = useRef(null);
  const flashTimerRef = useRef(null);

  // ── Compact review modal ──
  const [reviewJob, setReviewJob] = useState(null);
  const [reviewBusy, setReviewBusy] = useState(false);

  // ── Full-details modal (opened from the Review modal) ──
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [viewCandidate, setViewCandidate] = useState(null);
  // Holds the job while its full details are shown, so Merge/Cancel stay available there.
  const [detailReviewJob, setDetailReviewJob] = useState(null);

  /* ═══════ JOBS LOADER ═══════ */
  const loadJobs = useCallback(async (page = jobsPage) => {
    setJobsLoading(true);
    try {
      const res = await hrUploadService.getJobs({
        page,
        limit: PAGE_SIZE,
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(onlyActionRequired ? { actionRequired: 'true' } : {}),
      });
      const payload = res.data || {};
      const list = payload.data || [];

      // Live flash: highlight rows whose status changed since the last load (not new
      // rows / page swaps — only genuine transitions, so the table doesn't flash wholesale).
      const prev = prevJobsRef.current;
      if (prev) {
        const changed = new Set();
        list.forEach((j) => {
          const before = prev.get(String(j.id));
          if (before !== undefined && before !== j.updated_at) changed.add(String(j.id));
        });
        if (changed.size) {
          setFlashIds(changed);
          if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
          flashTimerRef.current = setTimeout(() => setFlashIds(new Set()), 1700);
        }
      }
      prevJobsRef.current = new Map(list.map((j) => [String(j.id), j.updated_at]));

      setJobs(list);
      setJobsTotal(payload.pagination?.total ?? list.length);
      setActionCount(payload.stats?.actionRequired ?? 0);
      setProcessingCount(payload.stats?.processing ?? 0);
      setCompletedCount(payload.stats?.completed ?? 0);
    } catch (err) {
      console.error('Failed to load upload jobs:', err);
      setJobs([]); setJobsTotal(0);
    } finally {
      setJobsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, onlyActionRequired, jobsPage]);

  // Reload whenever filters change (reset to page 1).
  useEffect(() => {
    setJobsPage(1);
    loadJobs(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, onlyActionRequired]);

  /* ═══════ LIVE SOCKET UPDATES ═══════ */
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadJobs, jobsPage]);

  /* ═══════ UPLOAD HANDLER ═══════ */
  const handleUpload = async () => {
    if (fileList.length === 0) {
      setUploadMsg({ type: 'error', text: 'Please select at least one file.' });
      return;
    }
    const allowedExts = ['zip', 'pdf', 'docx', 'doc', 'xlsx', 'xls'];
    const badFiles = fileList.filter((f) => !allowedExts.includes(f.name.split('.').pop().toLowerCase()));
    if (badFiles.length > 0) {
      setUploadMsg({ type: 'error', text: `❌ Invalid file type(s): ${badFiles.map((f) => f.name).join(', ')}` });
      return;
    }

    setUploading(true);
    setUploadMsg(null);
    setUploadPct(0);

    const formData = new FormData();
    fileList.forEach((file) => formData.append('resumes', file.originFileObj || file));

    try {
      await hrUploadService.uploadResumes(formData, (e) => {
        if (e.total) setUploadPct(Math.round((e.loaded / e.total) * 100));
      });
      setUploadMsg({ type: 'success', text: '✅ Uploaded. Track processing status in the dashboard below.' });
      setFileList([]);
      setStatusFilter(null);
      setOnlyActionRequired(false);
      setCelebrate(true);
      setTimeout(() => setCelebrate(false), 1300);
      setTimeout(() => loadJobs(1), 800);
    } catch (err) {
      setUploadMsg({ type: 'error', text: `❌ ${err.response?.data?.message || err.message || 'Upload failed.'}` });
    } finally {
      setUploading(false);
      setUploadPct(0);
    }
  };

  /* ═══════ REVIEW / REPROCESS ═══════ */
  // Resolve a staged duplicate (merge or cancel) from either the compact Review modal or
  // the full-details modal; closes both and refreshes on success.
  const resolveDuplicate = async (action, job) => {
    if (!job?.cv_tmp_id) return;
    setReviewBusy(true);
    try {
      if (action === 'merge') {
        await hrUploadService.mergeDuplicates([job.cv_tmp_id]);
        message.success('Merged into the main candidate database.');
      } else {
        await hrUploadService.deleteDuplicates([job.cv_tmp_id]);
        message.success('Duplicate cancelled/rejected.');
      }
      setReviewJob(null);
      setDetailReviewJob(null);
      setViewModalOpen(false);
      setViewCandidate(null);
      loadJobs(jobsPage);
    } catch (err) {
      const verb = action === 'merge' ? 'Merge' : 'Cancel';
      message.error(err.response?.data?.message || err.message || `${verb} failed.`);
    } finally {
      setReviewBusy(false);
    }
  };

  const doReprocess = (record) => {
    Modal.confirm({
      title: 'Reprocess this resume?',
      icon: <ExclamationCircleOutlined />,
      content: `Re-run parsing for "${record.file_name}". Needs the original file still on the server.`,
      okText: 'Reprocess',
      async onOk() {
        try {
          await hrUploadService.reprocessJob(record.id);
          message.success('Reprocessing started.');
          loadJobs(jobsPage);
        } catch (err) {
          message.error(err.response?.data?.message || err.message || 'Reprocess failed.');
        }
      },
    });
  };

  const openCV = (url) => {
    if (!url || url === 'null' || String(url).trim() === '') {
      Modal.warning({ title: '⚠️ Alert', content: 'Resume file is not available for this job.' });
      return;
    }
    window.open(url, '_blank');
  };

  // From a job row, pull the full staging record so the full-details modal can open.
  const openFullDetailsFromJob = async (job) => {
    if (!job?.cv_tmp_id) {
      message.info('Full details are only available for duplicates pending review.');
      return;
    }
    try {
      const res = await hrUploadService.searchDuplicates({
        filterEmail: job.candidate_email || '',
        page: 1,
        perPage: 50,
      });
      const payload = res.data?.data || res.data;
      const rows = payload?.data || payload?.candidates || [];
      const match = rows.find((r) => Number(r.id) === Number(job.cv_tmp_id)) || rows[0];
      if (match) {
        // Swap the compact Review modal for the full-details one (never both at once),
        // keeping the job so Merge/Cancel stay available from the full view.
        setReviewJob(null);
        setDetailReviewJob(job);
        setViewCandidate(match);
        setViewModalOpen(true);
      } else {
        message.info('Full details not found — the record may already have been resolved.');
      }
    } catch {
      message.error('Could not load full details.');
    }
  };

  const closeViewModal = () => { setViewModalOpen(false); setViewCandidate(null); setDetailReviewJob(null); };

  /* ═══════ PARSE HELPERS (full-details modal) ═══════ */
  const parseJSON = (val) => {
    if (!val) return {};
    if (typeof val === 'object') return val;
    try { return JSON.parse(val); } catch { return {}; }
  };
  const parseCompany = (val) => {
    if (!val) return {};
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (trimmed === '' || trimmed.toLowerCase() === 'null' || trimmed.toLowerCase() === 'undefined') return {};
      try {
        const parsed = JSON.parse(trimmed);
        if (!parsed) return {};
        if (Array.isArray(parsed)) {
          return parsed.length > 0 ? (typeof parsed[0] === 'object' ? parsed[0] : { Name: String(parsed[0]) }) : {};
        }
        if (typeof parsed === 'object') return parsed;
        return { Name: String(parsed) };
      } catch {
        return { Name: val };
      }
    }
    if (typeof val === 'object') {
      if (Array.isArray(val)) return val.length > 0 ? (typeof val[0] === 'object' ? val[0] : { Name: String(val[0]) }) : {};
      return val;
    }
    return {};
  };
  const parseEmploymentHistory = (val) => {
    if (!val) return [];
    const obj = parseJSON(val);
    if (obj && Array.isArray(obj.companies)) return obj.companies;
    if (Array.isArray(obj)) return obj;
    return [];
  };
  const displayVal = (v) => {
    if (v === null || v === undefined || v === '') return '—';
    if (Array.isArray(v)) return v.join(', ');
    return String(v);
  };

  /* ═══════ JOBS TABLE COLUMNS ═══════ */
  const jobColumns = [
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
      title: 'Uploaded At',
      key: 'created_at',
      render: (_, r) => <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{formatDate(r.created_at)}</span>,
    },
    {
      title: 'Status',
      key: 'status',
      render: (_, r) => {
        const meta = STATUS_META[r.status] || { label: r.status, color: 'default' };
        return (
          <Tooltip title={meta.hint}>
            <Tag icon={meta.icon} color={meta.color} className={r.action_required ? 'tag-attention' : undefined} style={{ cursor: 'default' }}>{meta.label}</Tag>
          </Tooltip>
        );
      },
    },
    {
      title: 'Duplicate',
      key: 'is_duplicate',
      align: 'center',
      render: (_, r) => (r.is_duplicate ? <Tag color="warning">Yes</Tag> : <Tag color="default">No</Tag>),
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
        const canReview = r.action_required && r.cv_tmp_id;
        return (
          <Space size={6}>
            {canReview && (
              <Button size="small" type="primary" onClick={() => setReviewJob(r)}
                style={{ background: '#7a922e', borderColor: '#7a922e' }}>
                Review
              </Button>
            )}
            {r.status === 'Failed' && (
              <Tooltip title="Reprocess (needs the original file on the server)">
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

  /* ═══════ RENDER ═══════ */
  return (
    <div className="page-enter upload-page" style={{ maxWidth: 1200, margin: '0 auto', padding: '0 0 40px' }}>
      {/* Page Header */}
      <div style={{ marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0, fontWeight: 700 }}>HR Manual Upload</Title>
        <Text style={{ fontSize: 13, color: 'var(--text-2)', fontFamily: 'monospace' }}>
          Upload resumes and track processing status in real time
        </Text>
      </div>

      {/* ═══════ UPLOAD CARD ═══════ */}
      <Card className="animate-fade-in-up" bordered={false} style={{ borderRadius: 12, marginBottom: 24, boxShadow: '0 4px 24px rgba(0,0,0,0.06)', borderTop: '4px solid #7a922e' }}
        styles={{ body: { padding: 0 } }}>
        <div style={{ padding: '20px 28px 24px', position: 'relative' }}>
          <UploadCelebration show={celebrate} />
          {/* Compact dropzone — single row, doesn't dominate the page. */}
          <Dragger
            multiple
            fileList={fileList}
            beforeUpload={() => false}
            onChange={({ fileList: newList }) => setFileList(newList)}
            accept=".zip,.pdf,.docx,.xlsx"
            style={{ marginBottom: 14 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, padding: '14px 8px' }}>
              <InboxOutlined className="upload-inbox-icon" style={{ color: '#7a922e', fontSize: 30 }} />
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#2b2b2b' }}>Click or drag files to upload</div>
                <div style={{ color: '#8a9270', fontFamily: 'monospace', fontSize: 12 }}>Supported: .pdf, .docx, .zip, .xlsx</div>
              </div>
            </div>
          </Dragger>

          <Button
            className="btn-sheen"
            type="primary" size="large" block icon={<UploadOutlined />}
            loading={uploading} onClick={handleUpload} disabled={fileList.length === 0}
            style={{ height: 44, fontWeight: 600, borderRadius: 10,
              background: fileList.length === 0 ? '#8a9270' : '#7a922e',
              borderColor: fileList.length === 0 ? '#8a9270' : '#7a922e' }}
          >
            Upload Resumes
          </Button>

          {uploading && uploadPct > 0 && (
            <Progress percent={uploadPct} size="small" status="active"
              strokeColor={{ from: '#7a922e', to: '#92a63c' }} style={{ marginTop: 12 }} />
          )}

          {uploadMsg && (
            <Alert message={uploadMsg.text} type={uploadMsg.type} showIcon closable
              onClose={() => setUploadMsg(null)} style={{ marginTop: 14, borderRadius: 10 }} />
          )}
        </div>
      </Card>

      {/* ═══════ PERSISTENT JOB DASHBOARD (single source for status + duplicate review) ═══════ */}
      <Card className="animate-fade-in-up stagger-2" bordered={false} style={{ borderRadius: 12, boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
          <div>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
              <Text strong style={{ fontSize: 16 }}>Upload Status</Text>
              <Tooltip title="This list updates automatically as resumes are processed.">
                <span className="live-badge">
                  <span className="live-badge__dot" /> Real-time
                </span>
              </Tooltip>
            </span>
            <Text style={{ fontSize: 12, color: 'var(--text-2)', fontFamily: 'monospace', display: 'block' }}>
              Live processing status for every uploaded resume — review duplicates inline.
            </Text>
          </div>
          <Button icon={<ReloadOutlined />} onClick={() => loadJobs(jobsPage)}>Refresh</Button>
        </div>

        {/* Premium count-up KPI cards */}
        <Row gutter={[16, 16]} style={{ marginBottom: 18 }}>
          <Col xs={12} md={6}>
            <KpiCard index={0} icon={<CloudUploadOutlined />} label="Total Uploads" value={jobsTotal}
              color="#7a922e" tint="rgba(122,146,46,0.12)" accent="linear-gradient(90deg,#7a922e,#92a63c)" />
          </Col>
          <Col xs={12} md={6}>
            <KpiCard index={1} icon={<SyncOutlined />} label="Processing" value={processingCount}
              color="#2f6f9f" tint="rgba(47,111,159,0.12)" accent="linear-gradient(90deg,#2f6f9f,#4f93c4)" />
          </Col>
          <Col xs={12} md={6}>
            <KpiCard index={2} icon={<CheckCircleOutlined />} label="Saved to Database" value={completedCount}
              color="#4a7c59" tint="rgba(74,124,89,0.12)" accent="linear-gradient(90deg,#4a7c59,#6aa67c)" />
          </Col>
          <Col xs={12} md={6}>
            <KpiCard index={3} icon={<WarningOutlined />} label="Pending Review" value={actionCount}
              color="#c0392b" tint="rgba(192,57,43,0.12)" accent="linear-gradient(90deg,#c0392b,#e0654f)" />
          </Col>
        </Row>

        {/* Filters — use "Show Action Required" to focus on duplicates pending review. */}
        <Space style={{ marginBottom: 16 }} wrap>
          <Select
            allowClear placeholder="Filter by status" style={{ minWidth: 220 }}
            value={statusFilter} onChange={(v) => setStatusFilter(v || null)} options={STATUS_FILTERS}
          />
          <Button
            type={onlyActionRequired ? 'primary' : 'default'}
            danger={onlyActionRequired}
            onClick={() => setOnlyActionRequired((v) => !v)}
          >
            {onlyActionRequired ? 'Showing: Action Required' : 'Show Action Required'}
          </Button>
        </Space>

        <Table
          rowKey="id"
          dataSource={jobs}
          columns={jobColumns}
          loading={jobsLoading}
          size="small"
          scroll={{ x: 900 }}
          rowClassName={(r) => {
            const cls = [];
            if (['Processing', 'Queued', 'Uploaded'].includes(r.status)) cls.push('is-processing');
            if (flashIds.has(String(r.id))) cls.push('row-flash');
            return cls.join(' ');
          }}
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

      {/* ═══════ COMPACT REVIEW MODAL ═══════ */}
      <Modal
        title="Duplicate Review"
        open={!!reviewJob}
        onCancel={() => setReviewJob(null)}
        width={620}
        footer={(
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <Button icon={<EyeOutlined />} onClick={() => openFullDetailsFromJob(reviewJob)}>
              View full details
            </Button>
            <Space size={8}>
              <Button danger icon={<CloseCircleOutlined />} loading={reviewBusy} onClick={() => resolveDuplicate('cancel', reviewJob)}>
                Cancel / Reject
              </Button>
              <Button className="btn-sheen" type="primary" icon={<MergeCellsOutlined />} loading={reviewBusy} onClick={() => resolveDuplicate('merge', reviewJob)}
                style={{ background: '#7a922e', borderColor: '#7a922e' }}>
                Merge into Database
              </Button>
            </Space>
          </div>
        )}
      >
        {reviewJob && (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="Candidate">{reviewJob.candidate_name || '—'}</Descriptions.Item>
            <Descriptions.Item label="Email">{reviewJob.candidate_email || '—'}</Descriptions.Item>
            <Descriptions.Item label="File">{reviewJob.file_name}</Descriptions.Item>
            <Descriptions.Item label="Uploaded By">{reviewJob.uploaded_by || '—'}</Descriptions.Item>
          </Descriptions>
        )}
        <Alert
          style={{ marginTop: 16 }} type="info" showIcon
          message="Merge updates the existing candidate with new values (blanks retained). Cancel deletes the staging record and keeps the existing candidate unchanged."
        />
      </Modal>

      {/* ═══════ FULL-DETAILS MODAL ═══════ */}
      <Modal
        title="Duplicate Review — Full Details"
        open={viewModalOpen}
        onCancel={closeViewModal}
        footer={(
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <Button onClick={() => { closeViewModal(); if (detailReviewJob) setReviewJob(detailReviewJob); }}>
              Back to Review
            </Button>
            <Space size={8}>
              <Button danger icon={<CloseCircleOutlined />} loading={reviewBusy} onClick={() => resolveDuplicate('cancel', detailReviewJob)}>
                Cancel / Reject
              </Button>
              <Button className="btn-sheen" type="primary" icon={<MergeCellsOutlined />} loading={reviewBusy} onClick={() => resolveDuplicate('merge', detailReviewJob)}
                style={{ background: '#7a922e', borderColor: '#7a922e' }}>
                Merge into Database
              </Button>
            </Space>
          </div>
        )}
        width={880}
        styles={{ body: { maxHeight: '72vh', overflowY: 'auto', padding: '24px 28px' } }}
      >
        {viewCandidate && (() => {
          const c = viewCandidate;
          const cc = parseCompany(c.CurrentCompany);
          const edu = parseJSON(c.EducationalScoresPercentage);
          const companies = parseEmploymentHistory(c.employment_history);

          return (
            <>
              <Divider orientation="left" orientationMargin={0} style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8a9270' }}>
                Personal Information
              </Divider>
              <Descriptions column={2} size="small" bordered={false} labelStyle={{ fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#8a9270' }} contentStyle={{ fontSize: 13 }}>
                <Descriptions.Item label="Candidate Name">{displayVal(c.Name)}</Descriptions.Item>
                <Descriptions.Item label="Candidate Email">{displayVal(c.EmailID)}</Descriptions.Item>
                <Descriptions.Item label="Contact Number">{displayVal(c.ContactNumber)}</Descriptions.Item>
                <Descriptions.Item label="Highest Qualification">{displayVal(c.HighestQualification)}</Descriptions.Item>
                <Descriptions.Item label="Total Experience (Yrs)">{displayVal(c.TotalExperienceYears)}</Descriptions.Item>
                <Descriptions.Item label="Last Company Exp (Yrs)">{displayVal(c.LastCompanyExperienceYears)}</Descriptions.Item>
                <Descriptions.Item label="Current Location">{displayVal(c.CurrentLocation)}</Descriptions.Item>
                <Descriptions.Item label="CTC (LPA)">{displayVal(c.CTC_LPA)}</Descriptions.Item>
                <Descriptions.Item label="Expected CTC (LPA)">{displayVal(c.ExpectedCTC_LPA)}</Descriptions.Item>
                <Descriptions.Item label="Notice Period">{displayVal(c.NoticePeriod)}</Descriptions.Item>
                <Descriptions.Item label="Position Applied">{displayVal(c.PositionApplied)}</Descriptions.Item>
                <Descriptions.Item label="Job Source">{displayVal(c.JobSource)}</Descriptions.Item>
                <Descriptions.Item label="Recruiter Info">{displayVal(c.RecruiterInfoAAPNA)}</Descriptions.Item>
                <Descriptions.Item label="English Comm. Rating">{displayVal(c.EnglishCommunicationRating)}</Descriptions.Item>
                <Descriptions.Item label="Top 5 Key Skills" span={2}>{displayVal(c.Top5KeySkills)}</Descriptions.Item>
                <Descriptions.Item label="Gender">{displayVal(c.Gender)}</Descriptions.Item>
                <Descriptions.Item label="Preferred Shift">{displayVal(c.PreferredShift)}</Descriptions.Item>
                <Descriptions.Item label="Reason for Job Change" span={2}>{displayVal(c.ReasonForJobChange)}</Descriptions.Item>
                <Descriptions.Item label="Willing to Take Online Test?">{displayVal(c.WillingToTakeOnlineTest)}</Descriptions.Item>
                <Descriptions.Item label="Has Laptop for Initial Days?">{displayVal(c.HasLaptopForInitialDays)}</Descriptions.Item>
                <Descriptions.Item label="Last Activity By">{displayVal(c.last_action_by)}</Descriptions.Item>
                <Descriptions.Item label="Last Activity Context">{displayVal(c.last_action_context)}</Descriptions.Item>
              </Descriptions>

              <div style={{ marginTop: 12, padding: 14, background: '#f5f5f0', borderRadius: 10, border: '1px solid rgba(0,0,0,0.07)' }}>
                <Text style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#8a9270', display: 'block', marginBottom: 10 }}>
                  Current Company
                </Text>
                <Descriptions column={2} size="small" bordered={false} labelStyle={{ fontWeight: 700, fontSize: 10, textTransform: 'uppercase', color: '#8a9270' }} contentStyle={{ fontSize: 13 }}>
                  <Descriptions.Item label="Company Name">{displayVal(cc.Name)}</Descriptions.Item>
                  <Descriptions.Item label="Website">{displayVal(cc.Website)}</Descriptions.Item>
                </Descriptions>
              </div>

              <Divider orientation="left" orientationMargin={0} style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8a9270' }}>
                Education
              </Divider>
              <Descriptions column={2} size="small" bordered={false} labelStyle={{ fontWeight: 700, fontSize: 10, textTransform: 'uppercase', color: '#8a9270' }} contentStyle={{ fontSize: 13 }}>
                <Descriptions.Item label="10th %">{displayVal(edu['10th'] || c.a10th)}</Descriptions.Item>
                <Descriptions.Item label="12th %">{displayVal(edu['12th'] || c.a12th)}</Descriptions.Item>
                <Descriptions.Item label="Graduation %">{displayVal(edu.Graduation || c.graduation)}</Descriptions.Item>
                <Descriptions.Item label="Post Graduation %">{displayVal(edu.PostGraduation || c.postGraduation)}</Descriptions.Item>
                <Descriptions.Item label="Graduation Degree">{displayVal(c.graduationdegree)}</Descriptions.Item>
                <Descriptions.Item label="Graduation Specialization">{displayVal(c.graduationspecialization)}</Descriptions.Item>
                <Descriptions.Item label="PG Degree">{displayVal(c.postgraduationdegree)}</Descriptions.Item>
                <Descriptions.Item label="PG Specialization">{displayVal(c.postgraduationspecialization)}</Descriptions.Item>
                <Descriptions.Item label="LinkedIn Profile" span={2}>{displayVal(c.LinkedInProfile)}</Descriptions.Item>
              </Descriptions>

              <Divider orientation="left" orientationMargin={0} style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8a9270' }}>
                Employment History
              </Divider>
              {companies.length === 0 ? (
                <Text style={{ fontSize: 13, color: '#8a9270' }}>No employment history recorded.</Text>
              ) : (
                companies.map((co, i) => (
                  <div key={i} style={{ padding: 14, background: '#f5f5f0', borderRadius: 10, border: '1px solid rgba(0,0,0,0.07)', marginBottom: 10 }}>
                    <Descriptions column={3} size="small" bordered={false} labelStyle={{ fontWeight: 700, fontSize: 10, textTransform: 'uppercase', color: '#8a9270' }} contentStyle={{ fontSize: 13 }}>
                      <Descriptions.Item label="Company Name">{displayVal(co.CompanyName)}</Descriptions.Item>
                      <Descriptions.Item label="Start Date">{displayVal(co.StartDate)}</Descriptions.Item>
                      <Descriptions.Item label="End Date">{displayVal(co.EndDate)}</Descriptions.Item>
                    </Descriptions>
                  </div>
                ))
              )}

              <Divider orientation="left" orientationMargin={0} style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8a9270' }}>
                Upload Details
              </Divider>
              <Descriptions column={2} size="small" bordered={false} labelStyle={{ fontWeight: 700, fontSize: 10, textTransform: 'uppercase', color: '#8a9270' }} contentStyle={{ fontSize: 13 }}>
                <Descriptions.Item label="Uploaded By HR">{displayVal(c.uploadedByHRName)}</Descriptions.Item>
                <Descriptions.Item label="Uploaded At">{formatDate(c.uploadedAt)}</Descriptions.Item>
                <Descriptions.Item label="Upload Source">{displayVal(c.uploadSource)}</Descriptions.Item>
              </Descriptions>
            </>
          );
        })()}
      </Modal>
    </div>
  );
}
