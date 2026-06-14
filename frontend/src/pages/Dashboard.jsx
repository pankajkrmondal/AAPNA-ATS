/**
 * Dashboard Page — Overview with 7 module blocks and recent candidates table.
 * Replicates the legacy n8n UI style with an aurora background animation and locks.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Row, Col, Card, Table, Button, Typography, Tag, Modal, message, Space } from 'antd';
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
  TeamOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  ArrowRightOutlined,
  CheckOutlined,
} from '@ant-design/icons';
import useAuth from '../hooks/useAuth';
import candidateService from '../services/candidateService';
import dashboardService from '../services/dashboardService';
import StatCard from '../components/common/StatCard';

const { Title, Text } = Typography;

// --- Bento Grid Custom Mockups ---

function MRFRequestMockup() {
  return (
    <div className="mockup-container mrf-mockup">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, fontWeight: 700, borderBottom: '1px solid var(--border-light)', paddingBottom: 6 }}>
        <span>Requisition Form</span>
        <span style={{ fontSize: 9, color: 'var(--accent-color)' }}>Draft</span>
      </div>
      <div className="mrf-stepper">
        <div className="step active"><span>✓</span> Details</div>
        <div className="step active"><span>✓</span> Budget</div>
        <div className="step current"><span>3</span> Approvals</div>
      </div>
      <div className="mrf-form-lines">
        <div className="form-line-short" />
        <div className="form-line-long" />
        <div className="form-line-medium" />
      </div>
    </div>
  );
}

function SearchCandidatesMockup() {
  return (
    <div className="mockup-container search-mockup">
      <div className="search-bar">
        <span className="search-icon">🔍</span>
        <span className="search-text">Python Developer</span>
      </div>
      <div className="candidate-card-mini">
        <div className="avatar" />
        <div className="candidate-info" style={{ flex: 1 }}>
          <div className="name-line" />
          <div className="match-pills">
            <span className="pill green">Python</span>
            <span className="pill green">Django</span>
            <span className="pill gray">AWS</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function HRUploadMockup() {
  return (
    <div className="mockup-container upload-mockup">
      <div className="dropzone-area">
        <span className="cloud-icon">☁️</span>
        <span className="drop-text">Drag & Drop Resume</span>
      </div>
      <div className="upload-progress-card">
        <span className="file-icon" style={{ fontSize: 14 }}>📄</span>
        <div className="progress-details">
          <div className="progress-label">resume_rahul.docx</div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: '75%' }} />
          </div>
        </div>
        <span className="progress-percent">75%</span>
      </div>
    </div>
  );
}

function SystemConfigMockup() {
  return (
    <div className="mockup-container config-mockup">
      <div className="config-row">
        <span className="config-label">AI Auto-Screening</span>
        <div className="toggle-switch active"><div className="toggle-knob" /></div>
      </div>
      <div className="config-row">
        <span className="config-label">Email Notifications</span>
        <div className="toggle-switch active"><div className="toggle-knob" /></div>
      </div>
      <div className="slider-row">
        <div className="slider-label">Min Match Score: <span>75%</span></div>
        <div className="slider-track">
          <div className="slider-fill" style={{ width: '75%' }} />
          <div className="slider-knob" style={{ left: '75%' }} />
        </div>
      </div>
    </div>
  );
}

function VendorUploadMockup() {
  return (
    <div className="mockup-container vendor-mockup">
      <div className="vendor-header">
        <span className="vendor-badge">TopTech Staffing</span>
        <span className="submission-count">12 Profiles</span>
      </div>
      <div className="submission-list">
        <div className="list-item">
          <span className="candidate-name" style={{ fontWeight: 600 }}>Vikas Babu</span>
          <span className="status-tag green">Shortlisted</span>
        </div>
        <div className="list-item">
          <span className="candidate-name" style={{ fontWeight: 600 }}>Sahil Sarma</span>
          <span className="status-tag blue">Emailed</span>
        </div>
      </div>
    </div>
  );
}

function CandidateScreeningMockup() {
  return (
    <div className="mockup-container screening-mockup">
      <div className="scorecard-header">
        <span className="candidate-name" style={{ fontWeight: 700, fontSize: 13 }}>Sneha Gupta</span>
        <span className="ai-badge">AI MATCH</span>
      </div>
      <div className="scorecard-body">
        <div className="circular-progress-container">
          <svg width="60" height="60" viewBox="0 0 64 64" className="progress-svg">
            <circle cx="32" cy="32" r="26" className="progress-bg" />
            <circle cx="32" cy="32" r="26" className="progress-bar" strokeDasharray="163.3" strokeDashoffset="19.6" />
          </svg>
          <div className="progress-value">8.8</div>
        </div>
        <div className="score-details">
          <div className="score-row">
            <span className="metric-label">Technical</span>
            <div className="metric-track"><div className="metric-fill" style={{ width: '90%' }} /></div>
            <span className="metric-val">9.0</span>
          </div>
          <div className="score-row">
            <span className="metric-label">Communication</span>
            <div className="metric-track"><div className="metric-fill" style={{ width: '85%' }} /></div>
            <span className="metric-val">8.5</span>
          </div>
          <div className="score-row">
            <span className="metric-label">Aptitude</span>
            <div className="metric-track"><div className="metric-fill" style={{ width: '90%' }} /></div>
            <span className="metric-val">9.0</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function AnalyticsMockup() {
  return (
    <div className="mockup-container analytics-mockup">
      <div className="analytics-header">
        <div className="tile">
          <span className="tile-label">Selection Rate</span>
          <span className="tile-val">74%</span>
        </div>
        <div className="tile">
          <span className="tile-label">Interviews Done</span>
          <span className="tile-val">82</span>
        </div>
      </div>
      <div className="chart-canvas">
        <svg viewBox="0 0 200 80" className="chart-svg">
          <defs>
            <linearGradient id="chart-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent-color)" stopOpacity="0.3" />
              <stop offset="100%" stopColor="var(--accent-color)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d="M 0 60 Q 30 50 60 35 T 120 45 T 180 15 L 180 80 L 0 80 Z" fill="url(#chart-grad)" />
          <path d="M 0 60 Q 30 50 60 35 T 120 45 T 180 15" fill="none" stroke="var(--accent-color)" strokeWidth="3" />
          <circle cx="60" cy="35" r="4" fill="var(--accent-color)" />
          <circle cx="180" cy="15" r="4" fill="var(--accent-color)" />
        </svg>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 10;

  const [funnelStats, setFunnelStats] = useState({
    sourced: 0,
    aiScreened: 0,
    shortlisted: 0,
    hired: 0,
  });
  const [statsLoading, setStatsLoading] = useState(true);

  // Load dashboard funnel stats
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await dashboardService.getStats();
        const statsData = res.data?.data || res.data;
        if (statsData?.funnel) {
          setFunnelStats(statsData.funnel);
        }
      } catch (err) {
        console.error('Failed to load dashboard stats', err);
      } finally {
        setStatsLoading(false);
      }
    };
    fetchStats();
  }, []);

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

  const bentoModules = [
    {
      title: 'Candidate Screening',
      description: 'Identify the best candidates using advanced filtering, skill-based matching, and custom score criteria.',
      url: '/filtering',
      moduleKey: 'candidate_screening',
      accentColor: '#d97706',
      accentBg: 'rgba(217, 119, 6, 0.08)',
      accentBorder: 'rgba(217, 119, 6, 0.3)',
      accentGrid: 'rgba(217, 119, 6, 0.35)',
      accentGlow: 'rgba(217, 119, 6, 0.12)',
      icon: <FilterOutlined />,
      span: 12,
      isLarge: true,
      mockup: <CandidateScreeningMockup />,
    },
    {
      title: 'Recruitment Screening Analytics',
      description: 'Track recruitment performance with detailed insights on shortlisted, rejected, on-hold, and total candidates.',
      url: '/analytics',
      moduleKey: 'screening_analytics',
      accentColor: '#e11d48',
      accentBg: 'rgba(225, 29, 72, 0.08)',
      accentBorder: 'rgba(225, 29, 72, 0.3)',
      accentGrid: 'rgba(225, 29, 72, 0.35)',
      accentGlow: 'rgba(225, 29, 72, 0.12)',
      icon: <BarChartOutlined />,
      span: 12,
      isLarge: true,
      mockup: <AnalyticsMockup />,
    },
    {
      title: 'New MRF Request',
      description: 'Create and submit a new Manpower Requisition Form to initiate hiring for a specific role.',
      url: '/mrf',
      moduleKey: 'new_mrf',
      accentColor: '#0f766e',
      accentBg: 'rgba(15, 118, 110, 0.08)',
      accentBorder: 'rgba(15, 118, 110, 0.3)',
      accentGrid: 'rgba(15, 118, 110, 0.35)',
      accentGlow: 'rgba(15, 118, 110, 0.12)',
      icon: <PlusOutlined />,
      span: 8,
      isLarge: false,
      mockup: <MRFRequestMockup />,
    },
    {
      title: 'Search & Edit Candidates',
      description: 'Search existing candidates, update profiles, and manage candidate information efficiently.',
      url: '/candidates',
      moduleKey: 'search_candidates',
      accentColor: '#005f56',
      accentBg: 'rgba(0, 95, 86, 0.08)',
      accentBorder: 'rgba(0, 95, 86, 0.3)',
      accentGrid: 'rgba(0, 95, 86, 0.35)',
      accentGlow: 'rgba(0, 95, 86, 0.12)',
      icon: <SearchOutlined />,
      span: 8,
      isLarge: false,
      mockup: <SearchCandidatesMockup />,
    },
    {
      title: 'HR Manual Upload',
      description: 'Upload candidate resumes manually to store and manage them for future hiring needs.',
      url: '/hr-upload',
      moduleKey: 'hr_manual_upload',
      accentColor: '#0369a1',
      accentBg: 'rgba(3, 105, 161, 0.08)',
      accentBorder: 'rgba(3, 105, 161, 0.3)',
      accentGrid: 'rgba(3, 105, 161, 0.35)',
      accentGlow: 'rgba(3, 105, 161, 0.12)',
      icon: <UploadOutlined />,
      span: 8,
      isLarge: false,
      mockup: <HRUploadMockup />,
    },
    {
      title: 'Vendor Manual Upload',
      description: 'Upload and manage vendor-sourced resumes and documents for third-party hiring.',
      url: '/vendor',
      moduleKey: 'vendor_upload',
      accentColor: '#4f46e5',
      accentBg: 'rgba(79, 70, 229, 0.08)',
      accentBorder: 'rgba(79, 70, 229, 0.3)',
      accentGrid: 'rgba(79, 70, 229, 0.35)',
      accentGlow: 'rgba(79, 70, 229, 0.12)',
      icon: <CloudUploadOutlined />,
      span: 12,
      isLarge: false,
      mockup: <VendorUploadMockup />,
    },
    {
      title: 'System Configuration',
      description: 'Manage configuration settings for system processes and automation rules.',
      url: '/settings',
      moduleKey: 'system_config',
      accentColor: '#c2410c',
      accentBg: 'rgba(194, 65, 12, 0.08)',
      accentBorder: 'rgba(194, 65, 12, 0.3)',
      accentGrid: 'rgba(194, 65, 12, 0.35)',
      accentGlow: 'rgba(194, 65, 12, 0.12)',
      icon: <SettingOutlined />,
      span: 12,
      isLarge: false,
      mockup: <SystemConfigMockup />,
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
        const expVal = record.TotalExperienceYears || record.experience;
        const qualVal = record.HighestQualification || record.education;
        
        let subtext = '';
        if (expVal) subtext += `${expVal} yrs`;
        if (expVal && qualVal) subtext += ' • ';
        if (qualVal) subtext += qualVal;
        
        return (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <Text strong style={{ fontSize: 13.5, color: 'var(--text)' }}>{nameVal}</Text>
            {subtext && <Text type="secondary" style={{ fontSize: 11.5, marginTop: 2 }}>{subtext}</Text>}
          </div>
        );
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
      title: 'Actions',
      key: 'actions',
      align: 'right',
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
    <div style={{ minHeight: '100vh', padding: '16px 8px 60px' }}>
      {/* Dynamic backdrop and module card overrides */}
      <style>{`
        /* Bento Grid Layout */
        .bento-grid {
          display: grid;
          grid-template-columns: repeat(24, 1fr);
          gap: 20px;
        }
        
        .bento-card {
          border-radius: 18px;
          cursor: pointer;
          position: relative;
          overflow: hidden;
          transition: transform 0.28s cubic-bezier(0.16, 1, 0.3, 1), 
                      box-shadow 0.28s cubic-bezier(0.16, 1, 0.3, 1), 
                      border-color 0.28s cubic-bezier(0.16, 1, 0.3, 1);
          display: flex;
          flex-direction: column;
          background: var(--colorBgContainer) !important;
          border: 1px solid var(--border-light) !important;
          box-shadow: var(--shadow-sm);
          height: 100%;
        }
        .bento-card:hover {
          transform: translateY(-6px);
          box-shadow: 0 12px 30px -4px var(--accent-glow);
          border-color: var(--accent-color) !important;
        }
        .bento-card:hover .arrow-icon {
          transform: translateX(4px);
        }
        
        /* Split card layout */
        .bento-card-visual {
          height: 155px;
          background: linear-gradient(135deg, var(--accent-bg) 0%, var(--accent-border) 100%);
          border-bottom: 1px solid var(--border-light);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
          position: relative;
          overflow: hidden;
        }
        .bento-card-visual::before {
          content: '';
          position: absolute;
          inset: 0;
          background-image: radial-gradient(var(--accent-grid) 1px, transparent 1px);
          background-size: 14px 14px;
          opacity: 0.28;
          pointer-events: none;
        }
        .bento-card-large .bento-card-visual {
          height: 175px;
        }
        
        .bento-card-details {
          padding: 18px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          flex: 1;
        }
        
        .bento-card-icon-tag {
          width: 32px;
          height: 32px;
          background: var(--accent-bg);
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--accent-color);
          font-size: 15px;
          margin-bottom: 2px;
        }
        
        .bento-card.disabled {
          background: var(--ink) !important;
          border: 1px dashed var(--border) !important;
          cursor: not-allowed !important;
          opacity: 0.65;
          box-shadow: none !important;
          transform: none !important;
        }
        .bento-card.disabled .bento-card-visual {
          filter: grayscale(1) opacity(0.4);
        }
        
        /* Mockup Base styles */
        .mockup-container {
          width: 100%;
          max-width: 250px;
          border-radius: 12px;
          background: var(--colorBgContainer);
          border: 1px solid var(--accent-border) !important;
          box-shadow: 0 8px 20px rgba(0, 0, 0, 0.06), 0 2px 6px rgba(0, 0, 0, 0.04) !important;
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          transition: all 0.3s ease;
          overflow: hidden;
        }
        .bento-card-large .mockup-container {
          max-width: 310px;
        }
        
        /* MRF Request Mockup */
        .mrf-stepper {
          display: flex;
          justify-content: space-between;
          font-size: 9px;
          border-bottom: 1px solid var(--border-light);
          padding-bottom: 6px;
        }
        .mrf-stepper .step {
          display: flex;
          align-items: center;
          gap: 3px;
          color: var(--text-2);
        }
        .mrf-stepper .step.active {
          color: var(--accent-color);
          font-weight: 700;
        }
        .mrf-stepper .step.current {
          color: var(--text);
          font-weight: 600;
        }
        .mrf-form-lines {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .mrf-form-lines div {
          height: 6px;
          background: var(--border-light);
          border-radius: 3px;
        }
        .form-line-short { width: 40%; }
        .form-line-long { width: 85%; }
        .form-line-medium { width: 60%; }
        
        /* Search Candidates Mockup */
        .search-bar {
          display: flex;
          align-items: center;
          gap: 6px;
          border: 1px solid var(--border-light);
          border-radius: 6px;
          padding: 4px 8px;
          background: var(--colorBgContainer);
          font-size: 10px;
        }
        .search-text {
          font-weight: 600;
          color: var(--text);
        }
        .candidate-card-mini {
          display: flex;
          gap: 8px;
          align-items: center;
          padding: 6px;
          border-radius: 8px;
          background: var(--accent-bg);
          border: 1px dashed var(--accent-border);
        }
        .candidate-card-mini .avatar {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: var(--accent-color);
          opacity: 0.8;
        }
        .candidate-card-mini .name-line {
          height: 6px;
          width: 60px;
          background: var(--text);
          opacity: 0.3;
          border-radius: 3px;
          margin-bottom: 4px;
        }
        .match-pills {
          display: flex;
          gap: 3px;
        }
        .match-pills .pill {
          font-size: 7.5px;
          padding: 1px 3px;
          border-radius: 2px;
          font-weight: 600;
        }
        .match-pills .pill.green {
          background: rgba(16, 185, 129, 0.15);
          color: #10b981;
        }
        .match-pills .pill.gray {
          background: var(--border-light);
          color: var(--text-2);
        }
        
        /* HR Upload Mockup */
        .dropzone-area {
          border: 1.5px dashed var(--accent-color);
          background: var(--accent-bg);
          border-radius: 8px;
          padding: 10px;
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
        }
        .dropzone-area .cloud-icon {
          font-size: 14px;
          color: var(--accent-color);
        }
        .drop-text {
          font-size: 8.5px;
          color: var(--accent-color);
          font-weight: 600;
        }
        .upload-progress-card {
          display: flex;
          align-items: center;
          gap: 6px;
          background: var(--colorBgContainer);
          border: 1px solid var(--border-light);
          border-radius: 8px;
          padding: 5px 8px;
        }
        .progress-details {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .progress-label {
          font-size: 8.5px;
          font-weight: 600;
          color: var(--text);
        }
        .progress-track {
          height: 3px;
          background: var(--border-light);
          border-radius: 1.5px;
          overflow: hidden;
        }
        .progress-fill {
          height: 100%;
          background: var(--accent-color);
          transition: width 0.3s ease;
        }
        .progress-percent {
          font-size: 8.5px;
          font-weight: 700;
          color: var(--text-2);
        }
        
        /* System Config Mockup */
        .config-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 10px;
        }
        .toggle-switch {
          width: 24px;
          height: 14px;
          background: var(--border-light);
          border-radius: 99px;
          padding: 1.5px;
          transition: background 0.2s;
          cursor: pointer;
        }
        .toggle-switch.active {
          background: var(--accent-color);
        }
        .toggle-knob {
          width: 11px;
          height: 11px;
          background: #fff;
          border-radius: 50%;
          transition: transform 0.2s;
        }
        .toggle-switch.active .toggle-knob {
          transform: translateX(10px);
        }
        .slider-row {
          display: flex;
          flex-direction: column;
          gap: 4px;
          font-size: 9px;
        }
        .slider-label {
          display: flex;
          justify-content: space-between;
          font-weight: 600;
        }
        .slider-track {
          height: 3px;
          background: var(--border-light);
          position: relative;
          border-radius: 1.5px;
        }
        .slider-fill {
          height: 100%;
          background: var(--accent-color);
          border-radius: 1.5px;
        }
        .slider-knob {
          width: 8px;
          height: 8px;
          background: var(--accent-color);
          border-radius: 50%;
          position: absolute;
          top: -2.5px;
          transform: translateX(-50%);
          box-shadow: 0 0 3px var(--accent-color);
        }
        
        /* Vendor Upload Mockup */
        .vendor-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .vendor-badge {
          font-size: 8.5px;
          font-weight: 700;
          background: var(--accent-bg);
          color: var(--accent-color);
          padding: 1.5px 5px;
          border-radius: 4px;
        }
        .submission-count {
          font-size: 8.5px;
          color: var(--text-2);
        }
        .submission-list {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .list-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 5px;
          border-radius: 6px;
          background: var(--border-light);
          font-size: 9.5px;
        }
        .status-tag {
          font-size: 7.5px;
          padding: 1px 3px;
          border-radius: 2px;
          font-weight: 700;
        }
        .status-tag.green { background: rgba(16, 185, 129, 0.15); color: #10b981; }
        .status-tag.blue { background: rgba(2, 132, 199, 0.15); color: #0284c7; }
        
        /* Candidate Screening Mockup */
        .scorecard-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .ai-badge {
          font-size: 8.5px;
          font-weight: 800;
          background: var(--accent-bg);
          color: var(--accent-color);
          padding: 1.5px 7px;
          border-radius: 99px;
          letter-spacing: 0.05em;
        }
        .scorecard-body {
          display: flex;
          gap: 12px;
          align-items: center;
        }
        .circular-progress-container {
          position: relative;
          width: 56px;
          height: 56px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .progress-svg {
          transform: rotate(-90deg);
        }
        .progress-bg {
          fill: none;
          stroke: var(--border-light);
          stroke-width: 4;
        }
        .progress-bar {
          fill: none;
          stroke: var(--accent-color);
          stroke-width: 4;
          stroke-linecap: round;
          transition: stroke-dashoffset 0.6s ease;
        }
        .progress-value {
          position: absolute;
          font-size: 13px;
          font-weight: 850;
          color: var(--text);
        }
        .score-details {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .score-row {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 8.5px;
        }
        .metric-label {
          width: 65px;
          color: var(--text-2);
        }
        .metric-track {
          flex: 1;
          height: 3px;
          background: var(--border-light);
          border-radius: 1.5px;
          overflow: hidden;
        }
        .metric-fill {
          height: 100%;
          background: var(--accent-color);
        }
        .metric-val {
          font-weight: 700;
          color: var(--text);
        }
        
        /* Analytics Mockup */
        .analytics-header {
          display: flex;
          gap: 10px;
        }
        .tile {
          flex: 1;
          background: var(--border-light);
          padding: 5px 8px;
          border-radius: 8px;
          display: flex;
          flex-direction: column;
          gap: 1.5px;
        }
        .tile-label {
          font-size: 7.5px;
          color: var(--text-2);
        }
        .tile-val {
          font-size: 12px;
          font-weight: 800;
          color: var(--accent-color);
        }
        .chart-canvas {
          height: 60px;
          border-top: 1px dashed var(--border-light);
          padding-top: 4px;
        }
        .chart-svg {
          width: 100%;
          height: 100%;
        }
        
        /* Hover Micro-animations */
        .bento-card:hover .progress-fill {
          width: 100% !important;
        }
        .bento-card:hover .progress-percent {
          color: var(--accent-color);
        }
        .bento-card:hover .toggle-switch {
          background: var(--accent-color);
        }
        .bento-card:hover .toggle-switch .toggle-knob {
          transform: translateX(10px);
        }
        .bento-card:hover .slider-fill {
          width: 90% !important;
        }
        .bento-card:hover .slider-knob {
          left: 90% !important;
        }
        .bento-card:hover .progress-bar {
          stroke-dashoffset: 8.2 !important; /* Rings to 95% */
        }
        .bento-card:hover .progress-value {
          color: var(--accent-color);
          scale: 1.05;
        }
        .bento-card:hover .metric-fill {
          width: 95% !important;
        }
        .bento-card:hover .mockup-container {
          border-color: var(--accent-border);
          box-shadow: 0 4px 12px var(--accent-glow);
        }
        
        /* Candidates Table cell padding & background overrides */
        .ant-table {
          border: 1px solid rgba(0, 95, 86, 0.08) !important;
          border-radius: 8px;
          overflow: hidden;
        }
        .ant-table-thead > tr > th {
          padding: 16px 16px !important;
          background: rgba(0, 95, 86, 0.06) !important;
          color: var(--text) !important;
          font-weight: 700 !important;
          border-bottom: 1px solid rgba(0, 95, 86, 0.08) !important;
        }
        .ant-table-tbody > tr > td {
          padding: 16px 16px !important;
          background: rgba(0, 95, 86, 0.01) !important;
          border-bottom: 1px solid rgba(0, 95, 86, 0.04) !important;
          transition: background 0.2s ease;
        }
        .ant-table-tbody > tr.ant-table-row-level-0:nth-child(even) > td {
          background: rgba(0, 95, 86, 0.035) !important;
        }
        .ant-table-tbody > tr:hover > td {
          background: rgba(0, 95, 86, 0.08) !important;
        }
        
        /* Funnel Card custom styling matching New MRF Request */
        .funnel-card {
          background: linear-gradient(135deg, rgba(15, 118, 110, 0.05) 0%, rgba(15, 118, 110, 0.16) 100%) !important;
          border: 1px solid rgba(15, 118, 110, 0.35) !important;
          box-shadow: 0 8px 30px rgba(15, 118, 110, 0.08) !important;
          position: relative;
          overflow: hidden;
        }
        .funnel-card::before {
          content: '';
          position: absolute;
          inset: 0;
          background-image: radial-gradient(rgba(15, 118, 110, 0.3) 1px, transparent 1px);
          background-size: 14px 14px;
          opacity: 0.22;
          pointer-events: none;
          border-radius: 16px;
        }
        .funnel-card > .ant-card-body {
          position: relative;
          z-index: 2;
        }
        
        @media (max-width: 992px) {
          .bento-grid {
            display: flex;
            flex-direction: column;
            gap: 16px;
          }
          .bento-card {
            grid-column: span 24 !important;
          }
        }
      `}</style>

      <div style={{ zIndex: 1, maxWidth: 1200, margin: '0 auto' }}>
        {/* Premium split Hero section (inspired by Workable/Ashby landing pages) */}
        <div
          style={{
            background: 'linear-gradient(135deg, var(--colorBgContainer) 0%, var(--gold-subtle) 100%)',
            border: '1px solid var(--border-light)',
            borderRadius: 20,
            padding: '40px 48px',
            marginBottom: 36,
            boxShadow: 'var(--shadow-sm)',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {/* Subtle background circles for depth */}
          <div
            style={{
              position: 'absolute',
              top: '-30%',
              right: '-10%',
              width: 400,
              height: 400,
              borderRadius: '50%',
              background: 'radial-gradient(circle, var(--colorBgContainer) 0%, transparent 70%)',
              opacity: 0.8,
              zIndex: 0,
              pointerEvents: 'none',
            }}
          />

          <Row gutter={[40, 32]} align="middle" style={{ position: 'relative', zIndex: 1 }}>
            {/* Left side: Value proposition */}
            <Col xs={24} md={13}>
              <span
                style={{
                  display: 'inline-block',
                  background: 'var(--gold-bg)',
                  color: 'var(--gold)',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                  padding: '4px 12px',
                  borderRadius: 999,
                  marginBottom: 16,
                }}
              >
                AAPNA Recruitment Operations
              </span>
              <h1
                style={{
                  fontSize: 'clamp(28px, 4vw, 38px)',
                  fontWeight: 800,
                  lineHeight: 1.2,
                  letterSpacing: '-0.02em',
                  margin: '0 0 16px 0',
                  color: 'var(--text)',
                }}
              >
                The modern ATS built for{' '}
                <span style={{ color: 'var(--gold)' }}>speed</span> and{' '}
                <span style={{ color: 'var(--gold-light)' }}>automation</span>
              </h1>
              <p
                style={{
                  fontSize: 15,
                  color: 'var(--text-2)',
                  lineHeight: 1.6,
                  margin: '0 0 24px 0',
                }}
              >
                Welcome back, <strong>{user?.username || 'Recruiter'}</strong>! Drive hiring decisions faster with semantic screening, automated requisition channels, and structured candidate pipelines.
              </p>

              {/* Bullet checklist */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {[
                  'AI-powered semantic candidate screening & profiling',
                  'Automated MRF request submissions & approvals',
                  'Multi-channel resume parsing (Manual + Vendor uploads)',
                  'Complete pipeline metrics & analytics dashboard',
                ].map((text, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: '50%',
                        background: 'var(--gold-bg)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <CheckOutlined style={{ color: 'var(--gold)', fontSize: 10, fontWeight: 'bold' }} />
                    </div>
                    <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text-2)' }}>{text}</span>
                  </div>
                ))}
              </div>
            </Col>

            {/* Right side: Modern interactive mockup widget */}
            <Col xs={24} md={11}>
              <Card
                className="funnel-card"
                bordered={false}
                style={{
                  borderRadius: 16,
                  padding: '20px 24px 24px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                  <div>
                    <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: 'var(--text)' }}>
                      Active Pipeline Funnel
                    </h3>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      Live applicant conversion stages
                    </Text>
                  </div>
                  <Tag color="cyan" style={{ borderRadius: 6, fontWeight: 600, border: 'none' }}>
                    Active Roles
                  </Tag>
                </div>

                {/* Vertical Funnel Illustration */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {(() => {
                    const maxCount = funnelStats.sourced || 1;
                    const stages = [
                      {
                        label: 'Sourced Candidates',
                        count: funnelStats.sourced,
                        width: funnelStats.sourced > 0 ? '100%' : '0%',
                        color: 'linear-gradient(90deg, #0284c7 0%, #0ea5e9 100%)',
                        percentage: funnelStats.sourced > 0 ? 100 : 0,
                      },
                      {
                        label: 'AI Match Profile',
                        count: funnelStats.aiScreened,
                        width: `${Math.round((funnelStats.aiScreened / maxCount) * 100)}%`,
                        color: 'linear-gradient(90deg, #005f56 0%, #007a6f 100%)',
                        percentage: Math.round((funnelStats.aiScreened / maxCount) * 100),
                      },
                      {
                        label: 'Shortlisted approved',
                        count: funnelStats.shortlisted,
                        width: `${Math.round((funnelStats.shortlisted / maxCount) * 100)}%`,
                        color: 'linear-gradient(90deg, #0d9488 0%, #0f766e 100%)',
                        percentage: Math.round((funnelStats.shortlisted / maxCount) * 100),
                      },
                      {
                        label: 'Hired offers',
                        count: funnelStats.hired,
                        width: `${Math.round((funnelStats.hired / maxCount) * 100)}%`,
                        color: 'linear-gradient(90deg, #ea580c 0%, #f97316 100%)',
                        percentage: Math.round((funnelStats.hired / maxCount) * 100),
                      },
                    ];

                    return stages.map((stage, idx) => (
                      <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, fontWeight: 600, color: 'var(--text-2)' }}>
                          <span>{stage.label}</span>
                          <span style={{ fontFamily: 'monospace' }}>{stage.count} candidates</span>
                        </div>
                        <div
                          style={{
                            height: 28,
                            width: '100%',
                            background: 'var(--colorBgContainer)',
                            border: '1px solid rgba(15, 118, 110, 0.15)',
                            borderRadius: 6,
                            overflow: 'hidden',
                            position: 'relative',
                          }}
                        >
                          <div
                            style={{
                              height: '100%',
                              width: stage.width,
                              background: stage.color,
                              borderRadius: 6,
                              transition: 'width 0.8s ease-in-out',
                              display: 'flex',
                              alignItems: 'center',
                              paddingLeft: 12,
                            }}
                          >
                            {stage.count > 0 && (
                              <span style={{ fontSize: 10, fontWeight: 700, color: '#fff', letterSpacing: '0.05em' }}>
                                {stage.percentage}%
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              </Card>
            </Col>
          </Row>
        </div>

        {/* Recruitment Automation Modules section */}
        <Card
          bordered={false}
          style={{
            background: 'var(--colorBgContainer)',
            border: '1px solid var(--border-light)',
            borderRadius: 12,
            padding: 24,
            marginBottom: 28,
            boxShadow: 'var(--shadow-sm)',
          }}
          styles={{ body: { padding: 0 } }}
        >
          <Text style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-2)', display: 'block', marginBottom: 20 }}>
            Recruitment Automation Modules
          </Text>

          <div className="bento-grid">
            {bentoModules.map((mod) => {
              const enabled = isModuleEnabled(mod.moduleKey);
              return (
                <div
                  key={mod.moduleKey}
                  onClick={() => handleModuleClick(mod)}
                  className={`bento-card ${mod.isLarge ? 'bento-card-large' : ''} ${enabled ? '' : 'disabled'}`}
                  style={{
                    gridColumn: `span ${mod.span}`,
                    '--accent-color': mod.accentColor,
                    '--accent-bg': mod.accentBg,
                    '--accent-border': mod.accentBorder,
                    '--accent-grid': mod.accentGrid,
                    '--accent-glow': mod.accentGlow,
                    cursor: enabled ? 'pointer' : 'not-allowed',
                  }}
                >
                  {/* Mockup Canvas */}
                  <div className="bento-card-visual">
                    {mod.mockup}
                  </div>

                  {/* Card Details */}
                  <div className="bento-card-details">
                    <div className="bento-card-icon-tag">
                      {enabled ? mod.icon : <LockOutlined style={{ fontSize: 14 }} />}
                    </div>
                    <h3 style={{ fontSize: 15, fontWeight: 700, margin: '4px 0 0 0', color: 'var(--text)' }}>
                      {mod.title}
                    </h3>
                    <p style={{ fontSize: 12, lineHeight: 1.5, margin: '4px 0 0 0', color: 'var(--text-2)', opacity: 0.85 }}>
                      {mod.description}
                    </p>
                    <div style={{ marginTop: 'auto', fontSize: 11, fontWeight: 600, paddingTop: 12 }}>
                      {enabled ? (
                        <span style={{ color: mod.accentColor, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          Open Module <ArrowRightOutlined style={{ fontSize: 10, transition: 'transform 0.2s' }} className="arrow-icon" />
                        </span>
                      ) : (
                        <span style={{ color: 'var(--red)', background: 'rgba(192,57,43,0.08)', padding: '2px 8px', borderRadius: 999, fontSize: 10 }}>
                          🔒 Access Restricted
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Recent Candidates section */}
        <Card
          bordered={false}
          style={{
            background: 'var(--colorBgContainer)',
            border: '1px solid var(--border-light)',
            borderRadius: 12,
            padding: 24,
            boxShadow: 'var(--shadow-sm)',
          }}
          styles={{ body: { padding: 0 } }}
        >
          <Text style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-2)', display: 'block', marginBottom: 16 }}>
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
