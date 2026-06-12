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
  message,
  Statistic,
  Row,
  Col,
} from 'antd';
import {
  UploadOutlined,
  InboxOutlined,
  SearchOutlined,
  FileTextOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
  WarningOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import useAuth from '../hooks/useAuth';
import vendorService from '../services/vendorService';

const { Title, Text, Paragraph } = Typography;
const { Dragger } = Upload;

const PAGE_SIZE = 5;

export default function VendorPortal() {
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

  // ── Candidates List State ──
  const [candidates, setCandidates] = useState([]);
  const [candTotal, setCandTotal] = useState(0);
  const [candPage, setCandPage] = useState(1);
  const [candLoading, setCandLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const debounceRef = useRef(null);

  /* ═══════ INITIAL LOAD ═══════ */
  useEffect(() => {
    loadCandidates(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ═══════ UPLOAD HANDLER ═══════ */
  const handleUpload = async () => {
    if (fileList.length === 0) {
      setUploadMsg({ type: 'error', text: 'Please select at least one file.' });
      return;
    }

    // Validate file types (XLSX, XLS and DOC are explicitly blocked)
    const allowedExts = ['zip', 'pdf', 'docx'];
    const badFiles = fileList.filter((f) => {
      const ext = f.name.split('.').pop().toLowerCase();
      return !allowedExts.includes(ext);
    });

    if (badFiles.length > 0) {
      setUploadMsg({
        type: 'error',
        text: `❌ Invalid file type(s): ${badFiles.map((f) => f.name).join(', ')}. Excel files (.xlsx, .xls) are not accepted.`,
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
      const res = await vendorService.uploadResumes(formData);
      const data = res.data?.data || res.data;

      setUploadMsg({
        type: 'success',
        text: '✅ Resumes uploaded successfully. Parsing started...',
      });
      setFileList([]);

      if (data?.executionId) {
        startPolling(data.executionId);
      } else {
        setTimeout(() => loadCandidates(1), 3500);
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
        clearInterval(pollRef.current);
        setPolling(false);
        loadCandidates(1);
        return;
      }

      try {
        const res = await vendorService.getSummary(executionId);
        const summary = res.data?.data || res.data;

        if (summary) {
          setBatchSummary(summary);
          setBatchFiles(summary.files || summary.details?.files || []);

          if (summary.status === 'completed' || summary.success_count + summary.failed_count + summary.duplicate_count >= summary.total_count) {
            clearInterval(pollRef.current);
            setPolling(false);
            loadCandidates(1);
          }
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    };

    pollRef.current = setInterval(poll, 2500);
    poll();

    return () => clearInterval(pollRef.current);
  }, []);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  /* ═══════ CANDIDATES LOADER ═══════ */
  const loadCandidates = async (page = 1) => {
    setCandLoading(true);
    setCandPage(page);

    try {
      const res = await vendorService.getCandidates({
        search: searchText.trim(),
        page,
        limit: PAGE_SIZE,
      });

      const payload = res.data?.data || res.data;
      const rows = payload?.data || payload?.candidates || [];
      const total = payload?.pagination?.total || payload?.total || rows.length;

      setCandidates(rows);
      setCandTotal(total);
    } catch (err) {
      console.error('Failed to load vendor candidates:', err);
      setCandidates([]);
      setCandTotal(0);
    } finally {
      setCandLoading(false);
    }
  };

  /* ═══════ DEBOUNCED SEARCH ═══════ */
  const handleSearchChange = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      loadCandidates(1);
    }, 500);
  }, [searchText]);

  useEffect(() => {
    handleSearchChange();
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText]);

  /* ═══════ CV DOWNLOAD ═══════ */
  const handleOpenCV = (record) => {
    const url = record.cvFileUrl || record.CvFileUrl || record.cvfileurl || '';
    if (!url || url === 'null' || url === 'undefined' || url.trim() === '') {
      Modal.warning({
        title: '⚠️ Alert',
        content: 'Resume is not available for this candidate right now.',
        okButtonProps: { style: { background: '#005f56', borderColor: '#005f56' } },
      });
      return;
    }
    window.open(url, '_blank');
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

  /* ═══════ CANDIDATE TABLE COLUMNS ═══════ */
  const candColumns = [
    {
      title: '#',
      key: 'index',
      width: 50,
      render: (_, __, idx) => (
        <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#8a9270' }}>
          {(candPage - 1) * PAGE_SIZE + idx + 1}
        </span>
      ),
    },
    {
      title: 'Name',
      key: 'name',
      render: (_, r) => <Text strong style={{ fontSize: 13 }}>{r.name || '—'}</Text>,
    },
    {
      title: 'Email',
      key: 'email',
      render: (_, r) => (
        <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.email || '—'}</span>
      ),
    },
    {
      title: 'Contact Number',
      key: 'phone',
      render: (_, r) => (
        <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.phone || '—'}</span>
      ),
    },
    {
      title: 'Uploaded At',
      key: 'createdAt',
      render: (_, r) => (
        <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{formatDate(r.createdAt)}</span>
      ),
    },
    {
      title: 'Action',
      key: 'action',
      width: 100,
      align: 'center',
      render: (_, record) => (
        <Tooltip title="View Resume">
          <Button
            size="small"
            onClick={() => handleOpenCV(record)}
            icon={<FileTextOutlined />}
            style={{
              borderRadius: 6,
              fontWeight: 600,
              fontFamily: 'monospace',
              fontSize: 11,
              background: 'transparent',
              color: '#005f56',
              borderColor: '#005f56',
            }}
          >
            CV
          </Button>
        </Tooltip>
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

  return (
    <div className="page-enter" style={{ maxWidth: 1100, margin: '0 auto', padding: '0 0 40px' }}>
      {/* Page Header */}
      <div style={{ marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0, fontWeight: 700 }}>
          Vendor Manual Upload
        </Title>
        <Text style={{ fontSize: 13, color: 'var(--text-2)', fontFamily: 'monospace' }}>
          Upload and manage vendor-sourced candidate resumes
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
        <div style={{ height: 3, background: 'linear-gradient(90deg, #005f56, #007a6f)' }} />
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
            Select Resumes (.zip, .pdf, .docx, .doc)
          </Text>

          <Dragger
            multiple
            fileList={fileList}
            beforeUpload={() => false}
            onChange={({ fileList: newList }) => setFileList(newList)}
            accept=".zip,.pdf,.docx"
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
              <InboxOutlined style={{ color: '#005f56', fontSize: 40 }} />
            </p>
            <p className="ant-upload-text" style={{ fontWeight: 600, color: '#2b2b2b' }}>
              Click or drag files to upload
            </p>
            <p className="ant-upload-hint" style={{ color: '#8a9270', fontFamily: 'monospace', fontSize: 12 }}>
              Supported formats: .pdf, .docx, .zip (Excel files are not accepted)
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
              background: fileList.length === 0 ? '#8a9270' : '#005f56',
              borderColor: fileList.length === 0 ? '#8a9270' : '#005f56',
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
              background: 'linear-gradient(90deg, #005f56, #4a7c59)',
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
                    background: 'rgba(0,95,86,0.1)',
                    border: '1px solid #005f56',
                  }}
                  styles={{ body: { padding: 16 } }}
                >
                  <Statistic
                    title={<span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#005f56' }}>Duplicates Found</span>}
                    value={batchSummary.duplicate_count || 0}
                    valueStyle={{ fontWeight: 700, fontSize: 24, color: '#005f56' }}
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

      {/* ═══════ SECTION 3: CANDIDATES LIST ═══════ */}
      <Card
        bordered={false}
        style={{
          background: '#ffffff',
          border: '1px solid rgba(0,0,0,0.07)',
          borderRadius: 12,
          boxShadow: '0 2px 16px rgba(0,0,0,0.04)',
          overflow: 'hidden',
        }}
      >
        <div style={{ marginBottom: 20 }}>
          <Text strong style={{ fontSize: 16, display: 'block' }}>
            Candidates List
          </Text>
          <Text style={{ fontSize: 12, color: 'var(--text-2)', fontFamily: 'monospace' }}>
            Resumes uploaded by the vendor.
          </Text>
        </div>

        {/* Search & Filter */}
        <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
          <Col xs={24} sm={16} md={12}>
            <Input
              prefix={<SearchOutlined style={{ color: 'var(--text-2)', opacity: 0.4 }} />}
              placeholder="Search by candidate name or email..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              allowClear
              style={{ borderRadius: 10, height: 42 }}
            />
          </Col>
          <Col>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => loadCandidates(1)}
              style={{ borderRadius: 10, height: 42, color: '#005f56', borderColor: '#005f56' }}
            >
              Refresh
            </Button>
          </Col>
        </Row>

        {/* Candidates Table */}
        <Table
          dataSource={candidates}
          columns={candColumns}
          rowKey="id"
          loading={candLoading}
          pagination={{
            current: candPage,
            pageSize: PAGE_SIZE,
            total: candTotal,
            onChange: (p) => loadCandidates(p),
            showSizeChanger: false,
            showTotal: (total) => `Total ${total} candidates`,
            style: { padding: '12px 16px' },
          }}
          style={{
            borderRadius: 12,
            overflow: 'hidden',
            border: '1px solid var(--border-light)',
          }}
          size="middle"
        />
      </Card>
    </div>
  );
}
