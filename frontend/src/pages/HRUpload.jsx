/**
 * HRUpload.jsx — HR Manual Upload page.
 * Faithfully replicates the n8n workflow HR Upload UI with three sections:
 *   1. Upload Card (file drag-and-drop)
 *   2. Batch Summary Dashboard (polling + metrics)
 *   3. Pending Duplicates Review Queue (table + search + bulk actions)
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
  Spin,
  Alert,
  Descriptions,
  Divider,
  Checkbox,
  message,
  Statistic,
  Row,
  Col,
  Badge,
  Empty,
  notification,
} from 'antd';
import {
  UploadOutlined,
  InboxOutlined,
  SearchOutlined,
  EyeOutlined,
  FileTextOutlined,
  MergeCellsOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
  WarningOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import useAuth from '../hooks/useAuth';
import hrUploadService from '../services/hrUploadService';

const { Title, Text, Paragraph } = Typography;
const { Dragger } = Upload;

const PAGE_SIZE = 5;

export default function HRUpload() {
  const { user } = useAuth();

  // ── Upload State ──
  const [fileList, setFileList] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState(null); // { type: 'success'|'error', text: '' }

  // ── Batch Summary State ──
  const [batchSummary, setBatchSummary] = useState(null);
  const [batchFiles, setBatchFiles] = useState([]);
  const [polling, setPolling] = useState(false);
  const pollRef = useRef(null);
  const pollCountRef = useRef(0);

  // ── Duplicates Queue State ──
  const [duplicates, setDuplicates] = useState([]);
  const [dupTotal, setDupTotal] = useState(0);
  const [dupPage, setDupPage] = useState(1);
  const [dupLoading, setDupLoading] = useState(false);
  const [filterName, setFilterName] = useState('');
  const [filterEmail, setFilterEmail] = useState('');
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);
  const debounceRef = useRef(null);

  // ── View Modal State ──
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [viewCandidate, setViewCandidate] = useState(null);

  // ── Bulk Action State ──
  const [merging, setMerging] = useState(false);
  const [deleting, setDeleting] = useState(false);

  /* ═══════ INITIAL LOAD ═══════ */
  useEffect(() => {
    loadDuplicates(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ═══════ UPLOAD HANDLER ═══════ */
  const handleUpload = async () => {
    if (fileList.length === 0) {
      setUploadMsg({ type: 'error', text: 'Please select at least one file.' });
      return;
    }

    // Validate file types
    const allowedExts = ['zip', 'pdf', 'docx', 'doc', 'xlsx', 'xls'];
    const badFiles = fileList.filter((f) => {
      const ext = f.name.split('.').pop().toLowerCase();
      return !allowedExts.includes(ext);
    });
    if (badFiles.length > 0) {
      setUploadMsg({
        type: 'error',
        text: `❌ Invalid file type(s): ${badFiles.map((f) => f.name).join(', ')}`,
      });
      return;
    }

    setUploading(true);
    setUploadMsg(null);

    const formData = new FormData();
    fileList.forEach((file) => {
      formData.append('resumes', file.originFileObj || file);
    });

    try {
      const res = await hrUploadService.uploadResumes(formData);
      const data = res.data?.data || res.data;

      setUploadMsg({
        type: 'success',
        text: '✅ Resumes uploaded successfully. Parsing started...',
      });
      setFileList([]);

      if (data?.executionId) {
        startPolling(data.executionId);
      } else {
        // Reload duplicates after a delay
        setTimeout(() => loadDuplicates(1), 3500);
      }
    } catch (err) {
      const errMsg = err.response?.data?.message || err.message || 'Upload failed.';
      setUploadMsg({ type: 'error', text: `❌ ${errMsg}` });
    } finally {
      setUploading(false);
    }
  };

  /* ═══════ BATCH SUMMARY POLLING ═══════ */
  const startPolling = useCallback((executionId) => {
    setPolling(true);
    pollCountRef.current = 0;
    setBatchSummary({ execution_id: executionId, status: 'processing' });
    setBatchFiles([]);

    const poll = async () => {
      pollCountRef.current += 1;
      if (pollCountRef.current > 24) {
        // Max 60s polling
        clearInterval(pollRef.current);
        setPolling(false);
        loadDuplicates(1);
        return;
      }

      try {
        const res = await hrUploadService.getSummary(executionId);
        const summary = res.data?.data || res.data;

        if (summary) {
          setBatchSummary(summary);
          setBatchFiles(summary.files || summary.details?.files || []);

          if (summary.status === 'completed' || summary.success_count + summary.failed_count + summary.duplicate_count >= summary.total_count) {
            clearInterval(pollRef.current);
            setPolling(false);
            loadDuplicates(1);
            if (summary.failed_count > 0) {
              const filesList = summary.files || [];
              const failedFiles = filesList.filter(f => f.status === 'failed' || f.status === 'error');
              const failedListText = failedFiles.map(f => `${f.name}: ${f.detail || 'Unknown error'}`).join('\n');
              notification.error({
                message: 'Resume Parsing Failed',
                description: (
                  <div style={{ whiteSpace: 'pre-wrap', maxHeight: '200px', overflowY: 'auto' }}>
                    {failedListText || `${summary.failed_count} resume(s) failed to parse.`}
                  </div>
                ),
                duration: 0,
              });
            }
          }
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    };

    // Poll every 2.5 seconds
    pollRef.current = setInterval(poll, 2500);
    poll(); // Run immediately

    return () => clearInterval(pollRef.current);
  }, []);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  /* ═══════ DUPLICATES LOADER ═══════ */
  const loadDuplicates = async (page = 1) => {
    setDupLoading(true);
    setDupPage(page);
    setSelectedRowKeys([]);

    try {
      const res = await hrUploadService.searchDuplicates({
        filterName: filterName.trim(),
        filterEmail: filterEmail.trim(),
        page,
        perPage: PAGE_SIZE,
      });

      const payload = res.data?.data || res.data;
      const rows = payload?.data || payload?.candidates || [];
      const total = payload?.pagination?.total || payload?.total || rows.length;

      setDuplicates(rows);
      setDupTotal(total);
    } catch (err) {
      console.error('Failed to load duplicates:', err);
      setDuplicates([]);
      setDupTotal(0);
    } finally {
      setDupLoading(false);
    }
  };

  /* ═══════ DEBOUNCED SEARCH ═══════ */
  const handleFilterChange = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      loadDuplicates(1);
    }, 500);
  }, [filterName, filterEmail]);

  useEffect(() => {
    handleFilterChange();
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterName, filterEmail]);

  /* ═══════ VIEW CANDIDATE MODAL ═══════ */
  const openViewModal = (record) => {
    setViewCandidate(record);
    setViewModalOpen(true);
  };

  const closeViewModal = () => {
    setViewModalOpen(false);
    setViewCandidate(null);
  };

  /* ═══════ CV/RESUME DOWNLOAD ═══════ */
  const handleOpenCV = (record) => {
    const url = record.cvFileUrl || record.CvFileUrl || record.cvfileurl || '';
    if (!url || url === 'null' || url === 'undefined' || url.trim() === '') {
      Modal.warning({
        title: '⚠️ Alert',
        content: 'Resume is not available for this candidate right now.',
        okButtonProps: { style: { background: '#7a922e', borderColor: '#7a922e' } },
      });
      return;
    }
    window.open(url, '_blank');
  };

  /* ═══════ BULK MERGE ═══════ */
  const handleBulkMerge = () => {
    if (selectedRowKeys.length === 0) return;

    Modal.confirm({
      title: 'Confirm Merge',
      icon: <ExclamationCircleOutlined />,
      content: `Are you sure you want to merge ${selectedRowKeys.length} duplicate candidate(s) into the main database?`,
      okText: 'Yes, Merge',
      cancelText: 'No, Cancel',
      okButtonProps: { style: { background: '#7a922e', borderColor: '#7a922e' } },
      async onOk() {
        setMerging(true);
        try {
          const res = await hrUploadService.mergeDuplicates(selectedRowKeys);
          message.success(res.data?.message || 'Merged successfully.');
          setSelectedRowKeys([]);
          // Recalculate safe page
          const newTotal = Math.max(0, dupTotal - selectedRowKeys.length);
          const maxPage = Math.max(1, Math.ceil(newTotal / PAGE_SIZE));
          const safePage = Math.min(dupPage, maxPage);
          loadDuplicates(safePage);
        } catch (err) {
          message.error(err.response?.data?.message || 'Merge failed.');
        } finally {
          setMerging(false);
        }
      },
    });
  };

  /* ═══════ BULK DELETE ═══════ */
  const handleBulkDelete = () => {
    if (selectedRowKeys.length === 0) return;

    Modal.confirm({
      title: 'Confirm Delete',
      icon: <ExclamationCircleOutlined style={{ color: '#c0392b' }} />,
      content: `Are you sure you want to delete ${selectedRowKeys.length} duplicate candidate(s)? This action cannot be undone.`,
      okText: 'Yes, Delete',
      cancelText: 'No, Cancel',
      okButtonProps: { danger: true },
      async onOk() {
        setDeleting(true);
        try {
          const res = await hrUploadService.deleteDuplicates(selectedRowKeys);
          message.success(res.data?.message || 'Deleted successfully.');
          setSelectedRowKeys([]);
          const newTotal = Math.max(0, dupTotal - selectedRowKeys.length);
          const maxPage = Math.max(1, Math.ceil(newTotal / PAGE_SIZE));
          const safePage = Math.min(dupPage, maxPage);
          loadDuplicates(safePage);
        } catch (err) {
          message.error(err.response?.data?.message || 'Deletion failed.');
        } finally {
          setDeleting(false);
        }
      },
    });
  };

  /* ═══════ PARSE HELPERS ═══════ */
  const parseJSON = (val) => {
    if (!val) return {};
    if (typeof val === 'object') return val;
    try { return JSON.parse(val); } catch { return {}; }
  };

  const parseCompany = (val) => {
    if (!val) return {};
    if (typeof val === 'object') {
      if (Array.isArray(val) && val.length > 0) return val[0];
      return val;
    }
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed[0];
      return parsed;
    } catch { return {}; }
  };

  const parseEmploymentHistory = (val) => {
    if (!val) return [];
    const obj = parseJSON(val);
    if (obj && Array.isArray(obj.companies)) return obj.companies;
    if (Array.isArray(obj)) return obj;
    return [];
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    try {
      return new Date(dateStr).toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '—';
    }
  };

  const displayVal = (v) => {
    if (v === null || v === undefined || v === '') return '—';
    if (Array.isArray(v)) return v.join(', ');
    return String(v);
  };

  /* ═══════ TABLE COLUMNS ═══════ */
  const dupColumns = [
    {
      title: '#',
      key: 'index',
      width: 50,
      render: (_, __, idx) => (
        <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#8a9270' }}>
          {(dupPage - 1) * PAGE_SIZE + idx + 1}
        </span>
      ),
    },
    {
      title: 'Name',
      key: 'Name',
      render: (_, r) => <Text strong style={{ fontSize: 13 }}>{r.Name || '—'}</Text>,
    },
    {
      title: 'Email',
      key: 'EmailID',
      render: (_, r) => (
        <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.EmailID || '—'}</span>
      ),
    },
    {
      title: 'Contact Number',
      key: 'ContactNumber',
      render: (_, r) => (
        <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.ContactNumber || '—'}</span>
      ),
    },
    {
      title: 'Uploaded By HR',
      key: 'uploadedByHRName',
      render: (_, r) => r.uploadedByHRName || '—',
    },
    {
      title: 'Uploaded At',
      key: 'uploadedAt',
      render: (_, r) => (
        <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{formatDate(r.uploadedAt)}</span>
      ),
    },
    {
      title: 'Action',
      key: 'action',
      width: 120,
      align: 'center',
      render: (_, record) => (
        <Space size={6}>
          <Tooltip title="View Info">
            <Button
              size="small"
              icon={<EyeOutlined />}
              onClick={() => openViewModal(record)}
              style={{
                borderRadius: 6,
                background: '#eef3da',
                color: '#7a922e',
                borderColor: '#b8cc6e',
              }}
            />
          </Tooltip>
          <Tooltip title="View Resume">
            <Button
              size="small"
              onClick={() => handleOpenCV(record)}
              style={{
                borderRadius: 6,
                fontWeight: 600,
                fontFamily: 'monospace',
                fontSize: 11,
                background: 'transparent',
                color: '#7a922e',
                borderColor: '#7a922e',
              }}
            >
              CV
            </Button>
          </Tooltip>
        </Space>
      ),
    },
  ];

  /* ═══════ BATCH SUMMARY FILE TABLE COLUMNS ═══════ */
  const batchFileColumns = [
    {
      title: '#',
      key: 'idx',
      width: 50,
      align: 'center',
      render: (_, __, idx) => idx + 1,
    },
    {
      title: 'Resume File Name',
      dataIndex: 'name',
      key: 'name',
      render: (v) => v || '—',
    },
    {
      title: 'Parsing Status',
      dataIndex: 'status',
      key: 'status',
      render: (status) => {
        if (!status || status === 'pending') {
          return <Tag icon={<SyncOutlined spin />} color="processing">Processing</Tag>;
        }
        if (status === 'success' || status === 'added') {
          return <Tag icon={<CheckCircleOutlined />} color="success">✅ Added</Tag>;
        }
        if (status === 'duplicate') {
          return <Tag icon={<WarningOutlined />} color="warning">🔀 Duplicate</Tag>;
        }
        if (status === 'failed' || status === 'error') {
          return <Tag icon={<CloseCircleOutlined />} color="error">❌ Failed</Tag>;
        }
        return <Tag>{status}</Tag>;
      },
    },
    {
      title: 'Details / Action Taken',
      dataIndex: 'detail',
      key: 'detail',
      render: (v) => v || '—',
    },
  ];

  /* ═══════ ROW SELECTION CONFIG ═══════ */
  const rowSelection = {
    selectedRowKeys,
    onChange: (keys) => setSelectedRowKeys(keys),
    getCheckboxProps: (record) => ({
      disabled: merging || deleting,
    }),
  };

  /* ═══════ RENDER ═══════ */
  return (
    <div className="page-enter" style={{ maxWidth: 1100, margin: '0 auto', padding: '0 0 40px' }}>
      {/* Page Header */}
      <div style={{ marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0, fontWeight: 700 }}>
          HR Resume Upload
        </Title>
        <Text style={{ fontSize: 13, color: 'var(--text-2)', fontFamily: 'monospace' }}>
          Upload resumes to the recruitment system
        </Text>
      </div>

      {/* ═══════ SECTION 1: UPLOAD CARD ═══════ */}
      <Card
        bordered={false}
        style={{
          background: '#ffffff',
          border: '1px solid rgba(0,0,0,0.07)',
          borderRadius: 12,
          marginBottom: 24,
          boxShadow: '0 2px 16px rgba(0,0,0,0.04)',
          overflow: 'hidden',
        }}
        styles={{ body: { padding: 0 } }}
      >
        <div style={{ height: 3, background: 'linear-gradient(90deg, #7a922e, #8fa840)' }} />
        <div style={{ padding: '28px 28px 32px' }}>
          <Text
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--text-secondary)',
              display: 'block',
              marginBottom: 16,
            }}
          >
            Select Resumes (.zip, .pdf, .docx, .xlsx)
          </Text>

          <Dragger
            multiple
            fileList={fileList}
            beforeUpload={() => false} // Prevent auto-upload
            onChange={({ fileList: newList }) => setFileList(newList)}
            accept=".zip,.pdf,.docx,.xlsx"
            showUploadList={{ showPreviewIcon: false, showRemoveIcon: true }}
            style={{
              padding: '24px 20px',
              background: '#f5f5f0',
              border: '2px dashed rgba(0,0,0,0.13)',
              borderRadius: 10,
              marginBottom: 16,
            }}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined style={{ color: '#7a922e', fontSize: 40 }} />
            </p>
            <p className="ant-upload-text" style={{ fontWeight: 600, color: '#1a1e10' }}>
              Click or drag files to upload
            </p>
            <p className="ant-upload-hint" style={{ color: '#8a9270', fontFamily: 'monospace', fontSize: 12 }}>
              Supported formats: .pdf, .docx, .zip, .xlsx
            </p>
          </Dragger>

          <Button
            type="primary"
            size="large"
            block
            icon={<UploadOutlined />}
            loading={uploading}
            onClick={handleUpload}
            disabled={fileList.length === 0}
            style={{
              height: 44,
              fontWeight: 600,
              fontSize: 14,
              borderRadius: 10,
              background: fileList.length === 0 ? '#8a9270' : '#7a922e',
              borderColor: fileList.length === 0 ? '#8a9270' : '#7a922e',
            }}
          >
            Upload Resumes
          </Button>

          {uploadMsg && (
            <Alert
              message={uploadMsg.text}
              type={uploadMsg.type}
              showIcon
              style={{ marginTop: 14, borderRadius: 10 }}
              closable
              onClose={() => setUploadMsg(null)}
            />
          )}
        </div>
      </Card>

      {/* ═══════ SECTION 2: BATCH SUMMARY DASHBOARD ═══════ */}
      {batchSummary && (
        <Card
          bordered={false}
          style={{
            background: '#ffffff',
            border: '1px solid rgba(0,0,0,0.07)',
            borderRadius: 12,
            marginBottom: 24,
            boxShadow: '0 2px 16px rgba(0,0,0,0.04)',
            overflow: 'hidden',
          }}
          styles={{ body: { padding: 0 } }}
        >
          <div
            style={{
              height: 3,
              background: 'linear-gradient(90deg, #7a922e, #4a7c59)',
            }}
          />
          <div style={{ padding: '28px 28px 32px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 12,
              }}
            >
              <Text strong style={{ fontSize: 16 }}>
                📊 Latest Upload Summary Dashboard
              </Text>
              <Tag
                style={{
                  fontFamily: 'monospace',
                  fontSize: 11,
                  borderRadius: 6,
                }}
              >
                Batch: {batchSummary.execution_id?.slice(0, 8) || '—'}
              </Tag>
            </div>
            <Text
              style={{
                display: 'block',
                fontSize: 12,
                color: 'var(--text-secondary)',
                fontFamily: 'monospace',
                marginBottom: 20,
              }}
            >
              Real-time analysis and parsing metrics for the uploaded resumes.
            </Text>

            {/* Metrics Grid */}
            <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
              <Col xs={12} sm={6}>
                <Card
                  size="small"
                  style={{
                    textAlign: 'center',
                    borderRadius: 10,
                    background: '#f5f5f0',
                    border: '1px solid rgba(0,0,0,0.07)',
                  }}
                  styles={{ body: { padding: 16 } }}
                >
                  <Statistic
                    title={<span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Total Uploaded</span>}
                    value={batchSummary.total_count || 0}
                    valueStyle={{ fontWeight: 700, fontSize: 24 }}
                  />
                </Card>
              </Col>
              <Col xs={12} sm={6}>
                <Card
                  size="small"
                  style={{
                    textAlign: 'center',
                    borderRadius: 10,
                    background: 'rgba(74,124,89,0.1)',
                    border: '1px solid #4a7c59',
                  }}
                  styles={{ body: { padding: 16 } }}
                >
                  <Statistic
                    title={<span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#4a7c59' }}>Added Successfully</span>}
                    value={batchSummary.success_count || 0}
                    valueStyle={{ fontWeight: 700, fontSize: 24, color: '#4a7c59' }}
                  />
                </Card>
              </Col>
              <Col xs={12} sm={6}>
                <Card
                  size="small"
                  style={{
                    textAlign: 'center',
                    borderRadius: 10,
                    background: 'rgba(122,146,46,0.1)',
                    border: '1px solid #7a922e',
                  }}
                  styles={{ body: { padding: 16 } }}
                >
                  <Statistic
                    title={<span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#7a922e' }}>Duplicates Found</span>}
                    value={batchSummary.duplicate_count || 0}
                    valueStyle={{ fontWeight: 700, fontSize: 24, color: '#7a922e' }}
                  />
                </Card>
              </Col>
              <Col xs={12} sm={6}>
                <Card
                  size="small"
                  style={{
                    textAlign: 'center',
                    borderRadius: 10,
                    background: 'rgba(192,57,43,0.08)',
                    border: '1px solid #c0392b',
                  }}
                  styles={{ body: { padding: 16 } }}
                >
                  <Statistic
                    title={<span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#c0392b' }}>Failed / Skipped</span>}
                    value={batchSummary.failed_count || 0}
                    valueStyle={{ fontWeight: 700, fontSize: 24, color: '#c0392b' }}
                  />
                </Card>
              </Col>
            </Row>

            {/* Processing spinner */}
            {polling && (
              <div style={{ textAlign: 'center', padding: '24px 0' }}>
                <Spin size="large" />
                <Paragraph
                  style={{
                    marginTop: 16,
                    fontFamily: 'monospace',
                    fontSize: 12,
                    color: 'var(--text-secondary)',
                  }}
                >
                  Processing batch resumes in the background... Please wait.
                </Paragraph>
              </div>
            )}

            {/* File Breakdown Table */}
            {!polling && batchFiles.length > 0 && (
              <>
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: 'var(--text-secondary)',
                    display: 'block',
                    marginBottom: 12,
                  }}
                >
                  File Breakdown & Parsing Status
                </Text>
                <Table
                  dataSource={batchFiles}
                  columns={batchFileColumns}
                  rowKey={(r, idx) => r.name || idx}
                  pagination={false}
                  size="small"
                  bordered
                />
              </>
            )}
          </div>
        </Card>
      )}

      {/* ═══════ SECTION 3: PENDING DUPLICATES REVIEW QUEUE ═══════ */}
      <Card
        bordered={false}
        style={{
          background: '#ffffff',
          border: '1px solid rgba(0,0,0,0.07)',
          borderRadius: 12,
          boxShadow: '0 2px 16px rgba(0,0,0,0.04)',
          overflow: 'hidden',
        }}
        styles={{ body: { padding: 0 } }}
      >
        <div style={{ height: 3, background: 'linear-gradient(90deg, #7a922e, #8fa840)' }} />
        <div style={{ padding: '28px 28px 32px' }}>
          {/* Queue Header */}
          <Title level={4} style={{ margin: 0, fontWeight: 700, marginBottom: 4 }}>
            Pending Duplicates Review Queue
          </Title>
          <Text
            style={{
              display: 'block',
              fontSize: 12,
              color: 'var(--text-secondary)',
              fontFamily: 'monospace',
              marginBottom: 24,
            }}
          >
            Resumes uploaded by HR that already exist in the database. Review and merge their
            details into the main candidate pool.
          </Text>

          {/* Search & Filter */}
          <Text
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--text-secondary)',
              display: 'block',
              marginBottom: 12,
            }}
          >
            Search & Filter
          </Text>
          <Space size={10} style={{ marginBottom: 20, width: '100%' }} wrap>
            <Input
              placeholder="Candidate name..."
              value={filterName}
              onChange={(e) => setFilterName(e.target.value)}
              style={{ minWidth: 200, borderRadius: 10 }}
              allowClear
              autoComplete="off"
            />
            <Input
              placeholder="Email address..."
              value={filterEmail}
              onChange={(e) => setFilterEmail(e.target.value)}
              style={{ minWidth: 200, borderRadius: 10 }}
              allowClear
              autoComplete="off"
            />
            <Button
              icon={<SearchOutlined />}
              onClick={() => loadDuplicates(1)}
              style={{
                borderRadius: 10,
                background: '#7a922e',
                color: '#fff',
                borderColor: '#7a922e',
                fontWeight: 600,
              }}
            >
              Search
            </Button>
          </Space>

          {/* Duplicate Candidate Queue Label */}
          <Text
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--text-secondary)',
              display: 'block',
              marginBottom: 12,
            }}
          >
            Duplicate Candidate Queue
          </Text>

          {/* Table */}
          <Table
            dataSource={duplicates}
            columns={dupColumns}
            rowKey={(record) => Number(record.id)}
            rowSelection={rowSelection}
            loading={dupLoading}
            pagination={{
              current: dupPage,
              pageSize: PAGE_SIZE,
              total: dupTotal,
              onChange: (page) => loadDuplicates(page),
              showSizeChanger: false,
              showTotal: (total, range) =>
                `Showing ${range[0]}–${range[1]} of ${total} candidates`,
              style: { paddingRight: 20 },
            }}
            size="middle"
            locale={{
              emptyText: (
                <Empty
                  description="No pending duplicate candidate resumes found."
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              ),
            }}
          />

          {/* Bulk Actions */}
          {selectedRowKeys.length > 0 && (
            <div
              style={{
                position: 'fixed',
                bottom: 24,
                left: '50%',
                transform: 'translateX(-50%)',
                background: 'rgba(26, 30, 16, 0.95)',
                backdropFilter: 'blur(10px)',
                border: '1px solid #7a922e',
                boxShadow: '0 10px 40px rgba(0,0,0,0.35)',
                borderRadius: 12,
                padding: '12px 24px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 20,
                zIndex: 9500,
                animation: 'slideUp 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.2)',
              }}
            >
              <style>{`
                @keyframes slideUp {
                  from { transform: translateX(-50%) translateY(120px); opacity: 0; }
                  to { transform: translateX(-50%) translateY(0); opacity: 1; }
                }
              `}</style>
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#fff',
                  fontFamily: 'monospace',
                  whiteSpace: 'nowrap',
                }}
              >
                {selectedRowKeys.length} candidate(s) selected
              </Text>
              <Space size={8}>
                <Button
                  icon={<MergeCellsOutlined />}
                  loading={merging}
                  onClick={handleBulkMerge}
                  style={{
                    borderRadius: 8,
                    fontWeight: 600,
                    fontSize: 12,
                    background: '#7a922e',
                    color: '#fff',
                    border: 'none',
                  }}
                >
                  Merge Selected
                </Button>
                <Button
                  icon={<DeleteOutlined />}
                  loading={deleting}
                  onClick={handleBulkDelete}
                  danger
                  style={{
                    borderRadius: 8,
                    fontWeight: 600,
                    fontSize: 12,
                  }}
                >
                  Delete Selected
                </Button>
              </Space>
            </div>
          )}
        </div>
      </Card>

      {/* ═══════ VIEW CANDIDATE MODAL ═══════ */}
      <Modal
        title="View Candidate"
        open={viewModalOpen}
        onCancel={closeViewModal}
        footer={[
          <Button key="close" onClick={closeViewModal}>
            Close
          </Button>,
        ]}
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
              {/* Personal Information */}
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
              </Descriptions>

              {/* Current Company */}
              <div style={{ marginTop: 12, padding: 14, background: '#f5f5f0', borderRadius: 10, border: '1px solid rgba(0,0,0,0.07)' }}>
                <Text style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#8a9270', display: 'block', marginBottom: 10 }}>
                  Current Company
                </Text>
                <Descriptions column={2} size="small" bordered={false} labelStyle={{ fontWeight: 700, fontSize: 10, textTransform: 'uppercase', color: '#8a9270' }} contentStyle={{ fontSize: 13 }}>
                  <Descriptions.Item label="Company Name">{displayVal(cc.Name)}</Descriptions.Item>
                  <Descriptions.Item label="Website">{displayVal(cc.Website)}</Descriptions.Item>
                </Descriptions>
              </div>

              {/* Education */}
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

              {/* Employment History */}
              <Divider orientation="left" orientationMargin={0} style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8a9270' }}>
                Employment History
              </Divider>
              {companies.length === 0 ? (
                <Text style={{ fontSize: 13, color: '#8a9270' }}>No employment history recorded.</Text>
              ) : (
                companies.map((co, i) => (
                  <div
                    key={i}
                    style={{
                      padding: 14,
                      background: '#f5f5f0',
                      borderRadius: 10,
                      border: '1px solid rgba(0,0,0,0.07)',
                      marginBottom: 10,
                    }}
                  >
                    <Descriptions column={3} size="small" bordered={false} labelStyle={{ fontWeight: 700, fontSize: 10, textTransform: 'uppercase', color: '#8a9270' }} contentStyle={{ fontSize: 13 }}>
                      <Descriptions.Item label="Company Name">{displayVal(co.CompanyName)}</Descriptions.Item>
                      <Descriptions.Item label="Start Date">{displayVal(co.StartDate)}</Descriptions.Item>
                      <Descriptions.Item label="End Date">{displayVal(co.EndDate)}</Descriptions.Item>
                    </Descriptions>
                  </div>
                ))
              )}

              {/* Assessment & Interview */}
              <Divider orientation="left" orientationMargin={0} style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8a9270' }}>
                Assessment & Interview
              </Divider>
              <Descriptions column={2} size="small" bordered={false} labelStyle={{ fontWeight: 700, fontSize: 10, textTransform: 'uppercase', color: '#8a9270' }} contentStyle={{ fontSize: 13 }}>
                <Descriptions.Item label="Heat">{displayVal(c.Heat)}</Descriptions.Item>
                <Descriptions.Item label="HR Quick Comments" span={2}>{displayVal(c.HRQuickcomments)}</Descriptions.Item>
                <Descriptions.Item label="IQ Score">{displayVal(c.IQScore)}</Descriptions.Item>
                <Descriptions.Item label="Tech Score">{displayVal(c.TechScore)}</Descriptions.Item>
                <Descriptions.Item label="Zeko Interview Score">{displayVal(c.ZekoInterviewScore)}</Descriptions.Item>
                <Descriptions.Item label="Zeko Coding Score">{displayVal(c.ZekoCodingScore)}</Descriptions.Item>
                <Descriptions.Item label="Zeko Comm. Score">{displayVal(c.ZekoCommunicationScore)}</Descriptions.Item>
                <Descriptions.Item label="Final Status">{displayVal(c.FinalStatus)}</Descriptions.Item>
                <Descriptions.Item label="Tech Round One" span={2}>{displayVal(c.TechRoundOne)}</Descriptions.Item>
                <Descriptions.Item label="Tech Round Two" span={2}>{displayVal(c.TechRoundTwo)}</Descriptions.Item>
                <Descriptions.Item label="Tech Round Three" span={2}>{displayVal(c.TechRoundThree)}</Descriptions.Item>
                <Descriptions.Item label="Managerial/CEO Feedback" span={2}>{displayVal(c.ManagerialOrCEOFeedback)}</Descriptions.Item>
                <Descriptions.Item label="HR Interview" span={2}>{displayVal(c.HRInterview)}</Descriptions.Item>
              </Descriptions>

              {/* Upload Details */}
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
