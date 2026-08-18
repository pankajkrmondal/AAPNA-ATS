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
  Space,
  Tag,
  Tooltip,
  Modal,
  Alert,
  message,
  Row,
  Col,
  Select,
  Descriptions,
  Divider,
  Progress,
} from 'antd';
import {
  UploadOutlined,
  InboxOutlined,
  EyeOutlined,
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
  CloudUploadOutlined,
} from '@ant-design/icons';
import useAuth from '../hooks/useAuth';
import vendorService from '../services/vendorService';
import { getSocket } from '../services/socket';
import KpiCard from '../components/common/KpiCard';
import UploadCelebration from '../components/common/UploadCelebration';
import ExportButton from '../components/common/ExportButton';

const { Title, Text } = Typography;
const { Dragger } = Upload;

const PAGE_SIZE = 10;

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
  const [jobsTotal, setJobsTotal] = useState(0); // filtered total — drives table pagination
  const [totalAll, setTotalAll] = useState(0);   // scoped grand total — drives the "Total Uploads" KPI
  const [actionCount, setActionCount] = useState(0);
  const [processingCount, setProcessingCount] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);
  const [jobsPage, setJobsPage] = useState(1);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState(null);
  const [onlyActionRequired, setOnlyActionRequired] = useState(false);
  // Upload Status table filter — independent of the upload picker; "all vendors" by default.
  const [jobFilterVendor, setJobFilterVendor] = useState(null);

  // ── Review modal ──
  const [reviewJob, setReviewJob] = useState(null);
  const [reviewBusy, setReviewBusy] = useState(false);

  // ── Full-details modal (opened from the Review modal) ──
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [viewCandidate, setViewCandidate] = useState(null);
  // Holds the job while its full details are shown, so Merge/Cancel stay available there.
  const [detailReviewJob, setDetailReviewJob] = useState(null);

  const reloadRef = useRef(null);

  // ── Premium UX state (count-up KPIs, live flash, upload progress, celebration) ──
  const [flashIds, setFlashIds] = useState(() => new Set());
  const [uploadPct, setUploadPct] = useState(0);
  const [celebrate, setCelebrate] = useState(false);
  const prevJobsRef = useRef(null);
  const flashTimerRef = useRef(null);

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
      const list = payload.data || [];

      // Live flash: highlight rows whose status changed since the last load.
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
      setTotalAll(payload.stats?.total ?? payload.pagination?.total ?? 0);
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
    setUploadPct(0);

    const formData = new FormData();
    fileList.forEach((file) => formData.append('resumes', file.originFileObj || file));
    if (isStaff && selectedVendor) formData.append('vendorEmail', selectedVendor);

    try {
      await vendorService.uploadResumes(formData, (e) => {
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

  /* ═══════ REVIEW / REPROCESS ACTIONS ═══════ */
  // Resolve a staged duplicate (merge or cancel) from either the compact Review modal or
  // the full-details modal; closes both and refreshes on success.
  const resolveDuplicate = async (action, job) => {
    if (!job?.cv_tmp_id) return;
    setReviewBusy(true);
    try {
      if (action === 'merge') {
        await vendorService.reviewMerge([job.cv_tmp_id]);
        message.success('Merged into the main candidate database.');
      } else {
        await vendorService.reviewCancel([job.cv_tmp_id]);
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

  // From a job row, pull the full staging record so the full-details modal can open.
  const openFullDetailsFromJob = async (job) => {
    if (!job?.cv_tmp_id) {
      message.info('Full details are only available for duplicates pending review.');
      return;
    }
    try {
      const res = await vendorService.searchDuplicates({
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
        return (
          <Space size={4}>
            <Tooltip title={meta.hint}>
              <Tag icon={meta.icon} color={meta.color} className={r.action_required ? 'tag-attention' : undefined} style={{ cursor: 'default' }}>{meta.label}</Tag>
            </Tooltip>
            {/* Advisory: the row is fine, but the recruiter should know
                something before deciding — currently the cooling-off notice.
                Deliberately not styled as an error; nothing went wrong. */}
            {r.advisory && (
              <Tooltip title={r.advisory}>
                <Tag color="gold" style={{ cursor: 'help', marginInlineEnd: 0 }}>Note</Tag>
              </Tooltip>
            )}
          </Space>
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
              <Button size="small" type="primary" onClick={() => setReviewJob(r)}>
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
                <Button
                  size="small"
                  icon={<FileTextOutlined />}
                  onClick={() => openCV(r.file_url)}
                  style={{ borderRadius: 6, background: '#4f2fb8', borderColor: '#4f2fb8', color: '#fff' }}
                />
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
    <div className="page-enter upload-page" style={{ maxWidth: 1200, margin: '0 auto', padding: '0 0 40px' }}>
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
      <Card className="animate-fade-in-up" bordered={false} style={{ borderRadius: 12, marginBottom: 24, boxShadow: '0 4px 24px rgba(0,0,0,0.06)', borderTop: '4px solid #4f2fb8' }}
        styles={{ body: { padding: 0 } }}>
        <div style={{ padding: '20px 28px 24px', position: 'relative' }}>
          <UploadCelebration show={celebrate} />
          {/* Staff: prompt to pick a vendor, or confirm who they're uploading for. */}
          {isStaff && (
            <div style={{ marginBottom: 14 }}>
              {selectedVendor ? (
                <Tag
                  icon={<ShopOutlined />}
                  style={{
                    borderRadius: 16,
                    padding: '4px 12px',
                    fontSize: 13,
                    background: 'rgba(79,47,184,0.1)',
                    border: '1px solid #4f2fb8',
                    color: '#3d2196',
                  }}
                >
                  Uploading for: <strong>{vendors.find((v) => v.email === selectedVendor)?.name || selectedVendor}</strong>
                </Tag>
              ) : (
                <Tag
                  icon={<ShopOutlined />}
                  style={{ borderRadius: 16, padding: '4px 12px', fontSize: 13, background: 'rgba(192,57,43,0.06)', border: '1px solid #e0b4ad', color: '#c0392b' }}
                >
                  Select a vendor (top right) to upload on their behalf
                </Tag>
              )}
            </div>
          )}

          {/* Compact dropzone — single row, doesn't dominate the page. */}
          <Dragger
            multiple
            fileList={fileList}
            beforeUpload={() => false}
            onChange={({ fileList: newList }) => setFileList(newList)}
            accept=".zip,.pdf,.docx"
            style={{ marginBottom: 14 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, padding: '14px 8px' }}>
              <InboxOutlined className="upload-inbox-icon" style={{ color: '#4f2fb8', fontSize: 30 }} />
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>Click or drag files to upload</div>
                <div style={{ color: 'var(--text-3)', fontFamily: 'monospace', fontSize: 12 }}>Supported: .pdf, .docx, .zip</div>
              </div>
            </div>
          </Dragger>

          <Button
            className="btn-sheen"
            type="primary" size="large" block icon={<UploadOutlined />}
            loading={uploading} onClick={handleUpload}
            disabled={fileList.length === 0 || (isStaff && !selectedVendor)}
            style={{ height: 44, fontWeight: 600, borderRadius: 10,
              background: (fileList.length === 0 || (isStaff && !selectedVendor)) ? 'var(--text-3)' : '#4f2fb8',
              borderColor: (fileList.length === 0 || (isStaff && !selectedVendor)) ? 'var(--text-3)' : '#4f2fb8' }}
          >
            Upload Resumes
          </Button>

          {uploading && uploadPct > 0 && (
            <Progress percent={uploadPct} size="small" status="active"
              strokeColor={{ from: '#4f2fb8', to: '#6c62d2' }} style={{ marginTop: 12 }} />
          )}

          {uploadMsg && (
            <Alert message={uploadMsg.text} type={uploadMsg.type} showIcon closable
              onClose={() => setUploadMsg(null)} style={{ marginTop: 14, borderRadius: 10 }} />
          )}
        </div>
      </Card>

      {/* ═══════ PERSISTENT JOB DASHBOARD ═══════ */}
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
              {isStaff ? 'Live processing status across all vendors — filter below.' : 'Live processing status for every uploaded resume.'}
            </Text>
          </div>
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => loadJobs(jobsPage)}>Refresh</Button>
            <ExportButton
              request={(cfg) => vendorService.exportJobs({
                ...(statusFilter ? { status: statusFilter } : {}),
                ...(onlyActionRequired ? { actionRequired: 'true' } : {}),
                ...(isStaff && jobFilterVendor ? { vendorEmail: jobFilterVendor } : {}),
              }, cfg)}
              fallbackName="AAPNA-ATS_Vendor-Upload-Jobs.csv"
              rowCount={jobsTotal}
            />
          </Space>
        </div>

        {/* Premium count-up KPI cards */}
        <Row gutter={[16, 16]} style={{ marginBottom: 18 }}>
          <Col xs={12} md={6}>
            <KpiCard index={0} icon={<CloudUploadOutlined />} label="Total Uploads" value={totalAll}
              color="#4f2fb8" tint="rgba(79,47,184,0.12)" accent="linear-gradient(90deg,#4f2fb8,#6c62d2)" />
          </Col>
          <Col xs={12} md={6}>
            <KpiCard index={1} icon={<SyncOutlined />} label="Processing" value={processingCount}
              color="#2f6f9f" tint="rgba(47,111,159,0.12)" accent="linear-gradient(90deg,#2f6f9f,#4f93c4)" />
          </Col>
          <Col xs={12} md={6}>
            <KpiCard index={2} icon={<CheckCircleOutlined />} label="Saved to Database" value={completedCount}
              color="#4f2fb8" tint="rgba(79,47,184,0.12)" accent="linear-gradient(90deg,#4f2fb8,#8b7bea)" />
          </Col>
          <Col xs={12} md={6}>
            <KpiCard index={3} icon={<WarningOutlined />} label="Pending Review" value={actionCount}
              color="#c0392b" tint="rgba(192,57,43,0.12)" accent="linear-gradient(90deg,#c0392b,#e0654f)" />
          </Col>
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

      {/* ═══════ REVIEW MODAL ═══════ */}
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
              <Button className="btn-sheen" type="primary" icon={<MergeCellsOutlined />} loading={reviewBusy} onClick={() => resolveDuplicate('merge', reviewJob)}>
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
              <Button className="btn-sheen" type="primary" icon={<MergeCellsOutlined />} loading={reviewBusy} onClick={() => resolveDuplicate('merge', detailReviewJob)}>
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
              <Divider orientation="left" orientationMargin={0} style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
                Personal Information
              </Divider>
              <Descriptions column={2} size="small" bordered={false} labelStyle={{ fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-3)' }} contentStyle={{ fontSize: 13 }}>
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
              </Descriptions>

              <div style={{ marginTop: 12, padding: 14, background: 'var(--ink-3)', borderRadius: 10, border: '1px solid rgba(0,0,0,0.07)' }}>
                <Text style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-3)', display: 'block', marginBottom: 10 }}>
                  Current Company
                </Text>
                <Descriptions column={2} size="small" bordered={false} labelStyle={{ fontWeight: 700, fontSize: 10, textTransform: 'uppercase', color: 'var(--text-3)' }} contentStyle={{ fontSize: 13 }}>
                  <Descriptions.Item label="Company Name">{displayVal(cc.Name)}</Descriptions.Item>
                  <Descriptions.Item label="Website">{displayVal(cc.Website)}</Descriptions.Item>
                </Descriptions>
              </div>

              <Divider orientation="left" orientationMargin={0} style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
                Education
              </Divider>
              <Descriptions column={2} size="small" bordered={false} labelStyle={{ fontWeight: 700, fontSize: 10, textTransform: 'uppercase', color: 'var(--text-3)' }} contentStyle={{ fontSize: 13 }}>
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

              <Divider orientation="left" orientationMargin={0} style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
                Employment History
              </Divider>
              {companies.length === 0 ? (
                <Text style={{ fontSize: 13, color: 'var(--text-3)' }}>No employment history recorded.</Text>
              ) : (
                companies.map((co, i) => (
                  <div key={i} style={{ padding: 14, background: 'var(--ink-3)', borderRadius: 10, border: '1px solid rgba(0,0,0,0.07)', marginBottom: 10 }}>
                    <Descriptions column={3} size="small" bordered={false} labelStyle={{ fontWeight: 700, fontSize: 10, textTransform: 'uppercase', color: 'var(--text-3)' }} contentStyle={{ fontSize: 13 }}>
                      <Descriptions.Item label="Company Name">{displayVal(co.CompanyName)}</Descriptions.Item>
                      <Descriptions.Item label="Start Date">{displayVal(co.StartDate)}</Descriptions.Item>
                      <Descriptions.Item label="End Date">{displayVal(co.EndDate)}</Descriptions.Item>
                    </Descriptions>
                  </div>
                ))
              )}

              <Divider orientation="left" orientationMargin={0} style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
                Upload Details
              </Divider>
              <Descriptions column={2} size="small" bordered={false} labelStyle={{ fontWeight: 700, fontSize: 10, textTransform: 'uppercase', color: 'var(--text-3)' }} contentStyle={{ fontSize: 13 }}>
                <Descriptions.Item label="Uploaded By">{displayVal(c.uploadedByHRName)}</Descriptions.Item>
                <Descriptions.Item label="Uploaded At">{formatDate(c.uploadedAt)}</Descriptions.Item>
                <Descriptions.Item label="Upload Source">{displayVal(c.uploadSource)}</Descriptions.Item>
                <Descriptions.Item label="Vendor">{displayVal(c.vendorName || c.VendorEmail)}</Descriptions.Item>
              </Descriptions>
            </>
          );
        })()}
      </Modal>
    </div>
  );
}
