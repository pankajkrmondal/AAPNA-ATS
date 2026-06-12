/**
 * Dashboard Page — Overview with 7 module blocks and recent candidates table.
 * Replicates the legacy n8n UI style with an aurora background animation and locks.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Row, Col, Card, Table, Button, Typography, Tag, Modal, message } from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  UploadOutlined,
  SettingOutlined,
  CloudUploadOutlined,
  FilterOutlined,
  BarChartOutlined,
  FileTextOutlined,
  LockOutlined,
} from '@ant-design/icons';
import useAuth from '../hooks/useAuth';
import candidateService from '../services/candidateService';

const { Title, Text } = Typography;

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 10;

  // Load recent candidates
  useEffect(() => {
    const fetchCandidates = async () => {
      setLoading(true);
      try {
        const res = await candidateService.search({}, page, pageSize);
        // Extract candidate array from paginated response
        const candidateList = Array.isArray(res.data?.data)
          ? res.data.data
          : (res.data?.data?.data || res.data?.data?.candidates || res.data || []);
        
        const paginationObj = res.data?.pagination || res.data?.data?.pagination || {};
        const totalCount = paginationObj.total || res.data?.total || candidateList.length;

        setCandidates(candidateList);
        setTotal(totalCount);
      } catch (err) {
        console.error('Failed to load recent candidates', err);
      } finally {
        setLoading(false);
      }
    };
    fetchCandidates();
  }, [page]);

  // Module permission check
  const isModuleEnabled = (moduleKey) => {
    if ((user?.role || '').toLowerCase() === 'admin') return true;
    return (user?.permissions || []).includes(moduleKey);
  };

  const coreModules = [
    {
      title: 'New MRF Request',
      description: 'Create and submit a new Manpower Requisition Form to initiate hiring for a specific role.',
      url: '/mrf',
      styleClass: 'card-primary',
      bgGradient: 'linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)',
      moduleKey: 'new_mrf',
      icon: <PlusOutlined style={{ fontSize: 18, color: '#fff' }} />,
    },
    {
      title: 'Search & Edit Candidates',
      description: 'Search existing candidates, update their profiles, and manage candidate information efficiently.',
      url: '/candidates',
      styleClass: 'card-gold',
      bgGradient: 'linear-gradient(135deg, #005f56 0%, #5a7a1e 100%)',
      moduleKey: 'search_candidates',
      icon: <SearchOutlined style={{ fontSize: 18, color: '#fff' }} />,
    },
    {
      title: 'HR Manual Upload',
      description: 'Upload candidate resumes to store and manage them for future hiring needs.',
      url: '/hr-upload',
      styleClass: 'card-teal',
      bgGradient: 'linear-gradient(135deg, #0d9488 0%, #0891b2 100%)',
      moduleKey: 'hr_manual_upload',
      icon: <UploadOutlined style={{ fontSize: 18, color: '#fff' }} />,
    },
    {
      title: 'System Configuration',
      description: 'Manage configuration options and settings for system processes and automation rules.',
      url: '/settings',
      styleClass: 'card-amber',
      bgGradient: 'linear-gradient(135deg, #d97706 0%, #b45309 100%)',
      moduleKey: 'system_config',
      icon: <SettingOutlined style={{ fontSize: 18, color: '#fff' }} />,
    },
  ];

  const screeningModules = [
    {
      title: 'Vendor Manual Upload',
      description: 'Upload and manage vendor-sourced candidate resumes and documents for streamlined third-party hiring.',
      url: '/vendor',
      styleClass: 'card-violet',
      bgGradient: 'linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)',
      moduleKey: 'vendor_upload',
      icon: <CloudUploadOutlined style={{ fontSize: 18, color: '#fff' }} />,
    },
    {
      title: 'Candidate Screening',
      description: 'Identify the best candidates for open job positions using advanced filtering, skill-based matching, and configurable screening criteria.',
      url: '/filtering',
      styleClass: 'card-amber-2',
      bgGradient: 'linear-gradient(135deg, #d97706 0%, #b45309 100%)',
      moduleKey: 'candidate_screening',
      icon: <FilterOutlined style={{ fontSize: 18, color: '#fff' }} />,
    },
    {
      title: 'Recruitment Screening Analytics',
      description: 'Track recruitment performance with detailed insights on shortlisted, rejected, on-hold, and total candidates across open job positions.',
      url: '/analytics',
      styleClass: 'card-rose',
      bgGradient: 'linear-gradient(135deg, #e11d48 0%, #9f1239 100%)',
      moduleKey: 'screening_analytics',
      icon: <BarChartOutlined style={{ fontSize: 18, color: '#fff' }} />,
    },
  ];

  const handleModuleClick = (mod) => {
    if (isModuleEnabled(mod.moduleKey)) {
      navigate(mod.url);
    }
  };

  const handleDownloadResume = (cvFileUrl) => {
    if (!cvFileUrl || cvFileUrl === 'null' || cvFileUrl === 'undefined' || String(cvFileUrl).trim() === '') {
      Modal.warning({
        title: '⚠️ Alert',
        content: 'Resume is not available for this candidate right now.',
        okButtonProps: { style: { background: '#005f56', borderColor: '#005f56' } },
      });
      return;
    }
    const link = document.createElement('a');
    link.href = cvFileUrl;
    link.download = '';
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const tableColumns = [
    {
      title: 'Name',
      key: 'name',
      render: (_, record) => {
        const nameVal = record.Name || record.name || '—';
        return <Text strong style={{ fontSize: 13 }}>{nameVal}</Text>;
      },
    },
    {
      title: 'Email',
      key: 'email',
      render: (_, record) => {
        const emailVal = record.EmailID || record.email || '—';
        return <span style={{ fontFamily: 'monospace', fontSize: 13, color: '#1f2937' }}>{emailVal}</span>;
      },
    },
    {
      title: 'Role',
      key: 'role',
      render: (_, record) => {
        const roleVal = record.PositionApplied || record.position || '—';
        return <span style={{ color: '#1f2937', fontWeight: 500 }}>{roleVal}</span>;
      },
    },
    {
      title: 'Applied On',
      key: 'applied_on',
      render: (_, record) => {
        const dateVal = record.createdAt || record.created_at;
        return (
          <span style={{ fontFamily: 'monospace', fontSize: 13, color: '#374151' }}>
            {dateVal ? dateVal.split('T')[0] : '—'}
          </span>
        );
      },
    },
    {
      title: 'Resume',
      key: 'resume',
      render: (_, record) => {
        const fileUrl = record.cvFileUrl || record.cv_file_url || '';
        const isResumeOk = fileUrl && fileUrl !== 'null' && fileUrl !== 'undefined' && String(fileUrl).trim() !== '';
        return (
          <Button
            size="small"
            icon={<FileTextOutlined />}
            onClick={() => handleDownloadResume(fileUrl)}
            style={{
              borderRadius: 6,
              background: isResumeOk ? '#eef3da' : '#f5f5f0',
              color: isResumeOk ? '#005f56' : '#a0aa84',
              borderColor: isResumeOk ? '#b8cc6e' : '#dde1df',
            }}
            title="Download Resume"
          />
        );
      },
    },
  ];

  return (
    <div style={{ position: 'relative', overflow: 'hidden', minHeight: '100vh', padding: '32px 24px 60px' }}>
      {/* Dynamic Aurora animated backdrop style */}
      <style>{`
        .aurora { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
        .aurora-beam { position: absolute; height: 35vh; width: 0; top: 0; transform: rotate(10deg); transform-origin: top right; opacity: 0.15; }
        .aurora-beam:nth-child(1) { box-shadow: -130px 0 80px 40px var(--ink), -50px 0 50px 25px #60a5fa, 0 0 50px 25px #5eead4, 50px 0 50px 25px #e879f9, 130px 0 80px 40px var(--ink); animation: aslide 44s linear infinite; animation-delay: -2s; }
        .aurora-beam:nth-child(2) { box-shadow: -130px 0 80px 40px var(--ink), -50px 0 50px 25px #5eead4, 0 0 50px 25px #e879f9, 50px 0 50px 25px #60a5fa, 130px 0 80px 40px var(--ink); animation: aslide 43s linear infinite; animation-delay: -5s; }
        .aurora-beam:nth-child(3) { box-shadow: -130px 0 80px 40px var(--ink), -50px 0 50px 25px #e879f9, 0 0 50px 25px #60a5fa, 50px 0 50px 25px #5eead4, 130px 0 80px 40px var(--ink); animation: aslide 42s linear infinite; animation-delay: -8s; }
        .aurora-beam:nth-child(4) { box-shadow: -130px 0 80px 40px var(--ink), -50px 0 50px 25px #60a5fa, 0 0 50px 25px #e879f9, 50px 0 50px 25px #5eead4, 130px 0 80px 40px var(--ink); animation: aslide 40s linear infinite; animation-delay: -11s; }
        .aurora-beam:nth-child(5) { box-shadow: -130px 0 80px 40px var(--ink), -50px 0 50px 25px #5eead4, 0 0 50px 25px #60a5fa, 50px 0 50px 25px #e879f9, 130px 0 80px 40px var(--ink); animation: aslide 38s linear infinite; animation-delay: -14s; }
        @keyframes aslide { from { right: -25vw; } to { right: 125vw; } }

        .module-block-card {
          border-radius: 12px;
          padding: 22px;
          cursor: pointer;
          position: relative;
          overflow: hidden;
          transition: transform 0.18s ease, box-shadow 0.18s ease;
          display: flex;
          flex-direction: column;
          gap: 10px;
          color: #fff;
          height: 100%;
          border: none;
        }
        .module-block-card:hover {
          transform: translateY(-5px);
          box-shadow: 0 16px 32px rgba(0,0,0,0.18);
        }
        .module-block-card::after {
          content: '';
          position: absolute;
          right: -40px;
          bottom: -40px;
          width: 130px;
          height: 130px;
          background: rgba(255,255,255,0.10);
          border-radius: 50%;
          pointer-events: none;
        }
        .module-block-card.disabled {
          background: #ededea !important;
          color: #8a9270 !important;
          cursor: not-allowed !important;
          opacity: 0.6;
          border: 1.5px dashed rgba(0, 0, 0, 0.13) !important;
          box-shadow: none !important;
          transform: none !important;
        }
        .module-block-card.disabled::after { display: none; }
      `}</style>

      {/* Aurora beams background */}
      <div className="aurora">
        <div className="aurora-beam" />
        <div className="aurora-beam" />
        <div className="aurora-beam" />
        <div className="aurora-beam" />
        <div className="aurora-beam" />
      </div>

      <div style={{ position: 'relative', zIndex: 1, maxWidth: 1200, margin: '0 auto' }}>
        {/* Hero title */}
        <div style={{ marginBottom: 36, textAlign: 'center' }}>
          <h1 style={{ fontSize: 'clamp(26px, 4vw, 42px)', fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>
            Recruitment Process <span style={{ color: '#005f56' }}>Dashboard</span>
          </h1>
          <Text style={{ marginTop: 10, display: 'block', fontSize: 13, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
            Manage candidates, and track hiring in one place.
          </Text>
        </div>

        {/* Recruitment Automation Modules section */}
        <Card
          bordered={false}
          style={{
            background: '#ffffff',
            border: '1px solid rgba(0, 0, 0, 0.07)',
            borderRadius: 12,
            padding: 24,
            marginBottom: 28,
            boxShadow: '0 2px 16px rgba(0,0,0,0.04)',
          }}
          styles={{ body: { padding: 0 } }}
        >
          <div style={{ height: 3, background: 'linear-gradient(90deg, #005f56, #007a6f)', margin: '-24px -24px 24px' }} />
          <Text style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-secondary)', display: 'block', marginBottom: 16 }}>
            Recruitment Automation Modules
          </Text>

          {/* Core modules row */}
          <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
            {coreModules.map((mod) => {
              const enabled = isModuleEnabled(mod.moduleKey);
              return (
                <Col xs={24} sm={12} lg={6} key={mod.moduleKey}>
                  <div
                    onClick={() => handleModuleClick(mod)}
                    className={`module-block-card ${enabled ? '' : 'disabled'}`}
                    style={{ background: mod.bgGradient }}
                  >
                    <div
                      style={{
                        width: 38,
                        height: 38,
                        background: enabled ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.06)',
                        borderRadius: 9,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {enabled ? mod.icon : <LockOutlined style={{ fontSize: 16, color: '#8a9270' }} />}
                    </div>
                    <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: enabled ? '#fff' : '#5f6664' }}>{mod.title}</h3>
                    <p style={{ fontSize: 12.5, lineHeight: 1.5, margin: 0, opacity: enabled ? 0.88 : 0.7 }}>
                      {mod.description}
                    </p>
                    <div style={{ marginTop: 'auto', fontSize: 11, fontWeight: 600, opacity: 0.8 }}>
                      {enabled ? (
                        <span>Open module →</span>
                      ) : (
                        <span style={{ color: '#c0392b', background: 'rgba(192,57,43,0.12)', padding: '2px 8px', borderRadius: 999, fontSize: 10 }}>
                          🔒 Access Restricted
                        </span>
                      )}
                    </div>
                  </div>
                </Col>
              );
            })}
          </Row>

          {/* Screening modules row */}
          <Row gutter={[16, 16]}>
            {screeningModules.map((mod) => {
              const enabled = isModuleEnabled(mod.moduleKey);
              return (
                <Col xs={24} sm={12} lg={8} key={mod.moduleKey}>
                  <div
                    onClick={() => handleModuleClick(mod)}
                    className={`module-block-card ${enabled ? '' : 'disabled'}`}
                    style={{ background: mod.bgGradient }}
                  >
                    <div
                      style={{
                        width: 38,
                        height: 38,
                        background: enabled ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.06)',
                        borderRadius: 9,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {enabled ? mod.icon : <LockOutlined style={{ fontSize: 16, color: '#8a9270' }} />}
                    </div>
                    <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: enabled ? '#fff' : '#5f6664' }}>{mod.title}</h3>
                    <p style={{ fontSize: 12.5, lineHeight: 1.5, margin: 0, opacity: enabled ? 0.88 : 0.7 }}>
                      {mod.description}
                    </p>
                    <div style={{ marginTop: 'auto', fontSize: 11, fontWeight: 600, opacity: 0.8 }}>
                      {enabled ? (
                        <span>Open module →</span>
                      ) : (
                        <span style={{ color: '#c0392b', background: 'rgba(192,57,43,0.12)', padding: '2px 8px', borderRadius: 999, fontSize: 10 }}>
                          🔒 Access Restricted
                        </span>
                      )}
                    </div>
                  </div>
                </Col>
              );
            })}
          </Row>
        </Card>

        {/* Recent Candidates section */}
        <Card
          bordered={false}
          style={{
            background: '#ffffff',
            border: '1px solid rgba(0, 0, 0, 0.07)',
            borderRadius: 12,
            padding: 24,
            boxShadow: '0 2px 16px rgba(0,0,0,0.04)',
          }}
          styles={{ body: { padding: 0 } }}
        >
          <div style={{ height: 3, background: 'linear-gradient(90deg, #005f56, #007a6f)', margin: '-24px -24px 24px' }} />
          <Text style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-secondary)', display: 'block', marginBottom: 16 }}>
            Recent Candidates
          </Text>

          <Table
            dataSource={candidates}
            columns={tableColumns}
            rowKey={(record) => record.id || record.EmailID || Math.random().toString()}
            loading={loading}
            pagination={{
              current: page,
              pageSize: pageSize,
              total: total,
              onChange: setPage,
              showSizeChanger: false,
              style: { paddingRight: 20 },
            }}
            size="middle"
          />
        </Card>
      </div>
    </div>
  );
}
