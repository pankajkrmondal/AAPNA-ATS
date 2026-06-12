import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card,
  Tabs,
  Typography,
  Select,
  Input,
  Button,
  Row,
  Col,
  Space,
  Tag,
  Badge,
  DatePicker,
  Form,
  Spin,
  Tooltip,
  Divider,
  message,
  Avatar,
  Empty,
  Modal,
  Table
} from 'antd';
import {
  TeamOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  BarChartOutlined,
  SendOutlined,
  MailOutlined,
  ThunderboltOutlined,
  ArrowRightOutlined,
  CalendarOutlined,
  SearchOutlined,
  ExclamationCircleOutlined,
  MessageOutlined,
  SaveOutlined,
  UserOutlined,
  SolutionOutlined,
  CompassOutlined,
  WarningOutlined,
  CloseOutlined,
  EyeOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import useAuth from '../hooks/useAuth';
import screeningService from '../services/screeningService';
import StatusBadge from '../components/common/StatusBadge';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

// Helper: Clean email message bodies
const cleanMsgBody = (s) => {
  if (!s) return '(No content)';
  let text = s.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
              .replace(/<[^>]*>/g, ' ')
              .replace(/&amp;/gi, '&')
              .replace(/&lt;/gi, '<')
              .replace(/&gt;/gi, '>')
              .replace(/&quot;/gi, '"')
              .replace(/&#039;/gi, "'")
              .replace(/&#x27;/gi, "'")
              .replace(/&rsquo;/gi, "'")
              .replace(/&lsquo;/gi, "'")
              .replace(/&ldquo;/gi, '"')
              .replace(/&rdquo;/gi, '"')
              .replace(/&nbsp;/gi, ' ');
  text = text.replace(/EXTERNAL EMAIL:[\s\S]*?password\./gi, '').trim();
  text = text.split(/\bOn\s+(Mon|Tue|Wed|Thu|Fri|Sat|Sun|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\d{1,2}[\/\-])/i)[0];
  text = text.split(/\r?\nFrom:\s/i)[0];
  text = text.split(/\r?\n-{3,}/)[0];
  text = text.replace(/\s+/g, ' ').trim();
  return text || '(No content)';
};

export default function Analytics() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const convBodyRef = useRef(null);

  // --- Core State ---
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState({ pipeline: [], candidates: [], tiles: {} });
  const [activeTab, setActiveTab] = useState('analytics');
  const [viewingCandidate, setViewingCandidate] = useState(null);

  // --- Filtering State ---
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // --- Local Candidate Status Edits ---
  const [changedStatuses, setChangedStatuses] = useState({});
  const [savingStatusId, setSavingStatusId] = useState(null);

  // --- Scheduling State ---
  const [zekoJobs, setZekoJobs] = useState([]);
  const [loadingZekoJobs, setLoadingZekoJobs] = useState(false);
  const [schedulingCandidate, setSchedulingCandidate] = useState(null);
  const [selectedZekoJobId, setSelectedZekoJobId] = useState(null);
  const [interviewDates, setInterviewDates] = useState(null);
  const [schedulingLoading, setSchedulingLoading] = useState(false);

  // --- Zeko Job Assignment Dropdown State per Candidate ---
  const [selectedJobsMap, setSelectedJobsMap] = useState({});
  const [assigningCandidateId, setAssigningCandidateId] = useState(null);

  // --- Outlook Conversations State ---
  const [outlookEmail, setOutlookEmail] = useState(null);
  const [outlookCandidateName, setOutlookCandidateName] = useState('');
  const [outlookModalVisible, setOutlookModalVisible] = useState(false);
  const [outlookThreads, setOutlookThreads] = useState([]);
  const [outlookLoading, setOutlookLoading] = useState(false);

  // --- Cancellation State ---
  const [cancellingPipeline, setCancellingPipeline] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancellingLoading, setCancellingLoading] = useState(false);

  // Load Main Data and Zeko Jobs
  useEffect(() => {
    fetchMainData();
    fetchZekoJobs();
  }, []);

  const fetchMainData = async () => {
    setLoading(true);
    try {
      const res = await screeningService.getZekoPipeline();
      setData(res.data?.data || res.data || { pipeline: [], candidates: [], tiles: {} });
    } catch (err) {
      message.error('Failed to load recruitment screening pipeline analytics.');
    } finally {
      setLoading(false);
    }
  };

  const fetchZekoJobs = async () => {
    setLoadingZekoJobs(true);
    try {
      const res = await screeningService.getZekoJobs();
      setZekoJobs(res.data?.data || res.data || []);
    } catch (err) {
      console.warn('Failed to load Zeko jobs list');
    } finally {
      setLoadingZekoJobs(false);
    }
  };

  // Scroll Outlook chat body to bottom when new messages loaded
  useEffect(() => {
    if (outlookModalVisible && convBodyRef.current) {
      setTimeout(() => {
        if (convBodyRef.current) {
          convBodyRef.current.scrollTop = convBodyRef.current.scrollHeight;
        }
      }, 100);
    }
  }, [outlookThreads, outlookModalVisible]);

  // Group candidates by Role for the Analytics Tab
  const roleStats = useMemo(() => {
    if (!data.candidates) return [];
    const groups = {};
    data.candidates.forEach((c) => {
      const roleName = c.mrf?.position_hiring_for || c.position_applied || 'Unknown Role';
      const mrfId = c.mrf_id || (c.mrf ? Number(c.mrf.id) : null);
      const status = (c.pipeline_status || 'shortlisted').toLowerCase();

      if (!groups[roleName]) {
        groups[roleName] = {
          key: roleName,
          role: roleName,
          mrf_id: mrfId,
          shortlisted: 0,
          rejected: 0,
          on_hold: 0,
          total: 0
        };
      }

      groups[roleName].total += 1;
      if (status === 'shortlisted') {
        groups[roleName].shortlisted += 1;
      } else if (status === 'rejected') {
        groups[roleName].rejected += 1;
      } else if (status === 'on_hold' || status === 'on hold') {
        groups[roleName].on_hold += 1;
      }
    });
    return Object.values(groups);
  }, [data.candidates]);

  // Unique roles for filtering
  const uniqueRoles = useMemo(() => {
    if (!data.candidates) return [];
    const rolesSet = new Set();
    data.candidates.forEach((c) => {
      const roleName = c.mrf?.position_hiring_for || c.position_applied || 'Unknown Role';
      rolesSet.add(roleName);
    });
    return Array.from(rolesSet);
  }, [data.candidates]);

  // Filtered Candidates list for the Candidates Tab
  const filteredCandidates = useMemo(() => {
    if (!data.candidates) return [];
    return data.candidates.filter((c) => {
      const nameMatch = c.candidate_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          c.candidate_email?.toLowerCase().includes(searchQuery.toLowerCase());
      const roleName = c.mrf?.position_hiring_for || c.position_applied || 'Unknown Role';
      const roleMatch = roleFilter === 'ALL' || roleName === roleFilter;

      const currentStatus = changedStatuses[c.id] || c.pipeline_status || 'shortlisted';
      const statusMatch = statusFilter === 'ALL' || currentStatus.toLowerCase() === statusFilter.toLowerCase();

      return nameMatch && roleMatch && statusMatch;
    });
  }, [data.candidates, searchQuery, roleFilter, statusFilter, changedStatuses]);

  // Filtered Zeko Cancel pipeline rows
  const cancelPipelineRows = useMemo(() => {
    if (!data.pipeline) return [];
    return data.pipeline.filter(row => ['sent', 'in_progress'].includes((row.status || '').toLowerCase()));
  }, [data.pipeline]);

  // --- Handlers ---
  const handleStatusChange = (candidateId, value) => {
    setChangedStatuses(prev => ({
      ...prev,
      [candidateId]: value
    }));
  };

  const handleSaveStatus = async (candidateId) => {
    const status = changedStatuses[candidateId];
    if (!status) return;

    setSavingStatusId(candidateId);
    try {
      await screeningService.updateCandidateStatus({
        candidate_id: candidateId,
        status: status
      });
      message.success('Candidate status updated successfully');
      
      // Update local data state without full reload
      setData(prev => ({
        ...prev,
        candidates: prev.candidates.map(c => 
          c.id === candidateId ? { ...c, pipeline_status: status } : c
        )
      }));

      // Clear changed status tracking for this candidate
      setChangedStatuses(prev => {
        const copy = { ...prev };
        delete copy[candidateId];
        return copy;
      });

      // Recalculate tiles locally or refetch
      fetchMainData();
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to update candidate status');
    } finally {
      setSavingStatusId(null);
    }
  };

  const handleAssignJob = async (candidateId) => {
    const zekoJobId = selectedJobsMap[candidateId];
    if (!zekoJobId) {
      message.warning('Please select a Zeko Job to assign');
      return;
    }

    setAssigningCandidateId(candidateId);
    try {
      await screeningService.assignZekoJob({
        candidate_id: candidateId,
        zeko_job_id: zekoJobId
      });
      message.success('Candidate assigned to Zeko job successfully');
      fetchMainData();
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to assign candidate to Zeko Job');
    } finally {
      setAssigningCandidateId(null);
    }
  };

  const handleOpenOutlook = async (email, name) => {
    setOutlookEmail(email);
    setOutlookCandidateName(name);
    setOutlookModalVisible(true);
    setOutlookLoading(true);
    setOutlookThreads([]);

    try {
      const res = await screeningService.getOutlookConversations(email);
      setOutlookThreads(res.data?.data?.threads || res.data?.threads || []);
    } catch (err) {
      message.error('Failed to load email conversation threads');
    } finally {
      setOutlookLoading(false);
    }
  };

  const handleOpenScheduleModal = (candidate) => {
    setSchedulingCandidate(candidate);
    // Pre-select job if already assigned
    const assignedJobId = candidate.rpa_zeko_candidate_pipeline?.[0]?.zeko_job_id;
    setSelectedZekoJobId(assignedJobId || null);
    setInterviewDates(null);
  };

  const handleScheduleInterview = async () => {
    if (!selectedZekoJobId) {
      message.warning('Please select a Zeko Job');
      return;
    }
    if (!interviewDates || interviewDates.length < 2) {
      message.warning('Please pick interview date & time range');
      return;
    }

    setSchedulingLoading(true);
    try {
      await screeningService.scheduleZekoInterview({
        shortlist_id: schedulingCandidate.id,
        zeko_job_id: selectedZekoJobId,
        interview_start_at: interviewDates[0].toISOString(),
        interview_end_at: interviewDates[1].toISOString()
      });
      message.success(`Interview scheduled successfully for ${schedulingCandidate.candidate_name}`);
      setSchedulingCandidate(null);
      fetchMainData();
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to schedule Zeko interview');
    } finally {
      setSchedulingLoading(false);
    }
  };

  const handleOpenCancelModal = (pipelineRow) => {
    setCancellingPipeline(pipelineRow);
    setCancelReason('');
  };

  const handleCancelInterview = async () => {
    setCancellingLoading(true);
    try {
      await screeningService.cancelZekoInterview({
        pipeline_id: cancellingPipeline.id,
        cancel_reason: cancelReason.trim() || 'No reason provided'
      });
      message.success(`Interview cancelled successfully`);
      setCancellingPipeline(null);
      fetchMainData();
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to cancel interview');
    } finally {
      setCancellingLoading(false);
    }
  };

  const handleViewRoleCandidates = (roleName) => {
    setRoleFilter(roleName);
    setStatusFilter('ALL');
    setActiveTab('all');
  };

  // --- Rendering Columns ---
  const analyticsColumns = [
    {
      title: 'Role',
      dataIndex: 'role',
      key: 'role',
      render: (text) => <Text strong style={{ color: 'var(--text)' }}>{text}</Text>
    },
    {
      title: 'MRF ID',
      dataIndex: 'mrf_id',
      key: 'mrf_id',
      render: (text) => <Tag color="default">MRF #{text || 'N/A'}</Tag>
    },
    {
      title: 'Shortlisted',
      dataIndex: 'shortlisted',
      key: 'shortlisted',
      align: 'center',
      render: (count) => <Badge count={count} showZero color="var(--gold)" />
    },
    {
      title: 'Rejected',
      dataIndex: 'rejected',
      key: 'rejected',
      align: 'center',
      render: (count) => <Badge count={count} showZero color="var(--red)" />
    },
    {
      title: 'On Hold',
      dataIndex: 'on_hold',
      key: 'on_hold',
      align: 'center',
      render: (count) => <Badge count={count} showZero color="#95a5a6" />
    },
    {
      title: 'Total Candidates',
      dataIndex: 'total',
      key: 'total',
      align: 'center',
      render: (count) => <Text strong style={{ fontSize: 14 }}>{count}</Text>
    },
    {
      title: 'Action',
      key: 'action',
      align: 'center',
      render: (_, record) => (
        <Button
          type="text"
          icon={<ArrowRightOutlined />}
          onClick={() => handleViewRoleCandidates(record.role)}
          style={{ color: 'var(--gold)', fontWeight: 600 }}
        >
          View Candidates
        </Button>
      )
    }
  ];

  const allCandidatesColumns = [
    {
      title: 'Candidate',
      key: 'candidate',
      render: (_, record) => (
        <div>
          <Text strong style={{ display: 'block', color: 'var(--text)' }}>
            {record.candidate_name}
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {record.candidate_email}
          </Text>
        </div>
      )
    },
    {
      title: 'Role Applied For',
      key: 'role',
      render: (_, record) => {
        const roleName = record.mrf?.position_hiring_for || record.position_applied || 'Unknown Role';
        return (
          <div>
            <Text style={{ display: 'block' }}>{roleName}</Text>
            {record.mrf_id && <Text type="secondary" style={{ fontSize: 11 }}>MRF #{record.mrf_id}</Text>}
          </div>
        );
      }
    },
    {
      title: 'Shortlisted Date',
      dataIndex: 'shortlisted_at',
      key: 'shortlisted_at',
      render: (text) => text ? dayjs(text).format('DD MMM YYYY, hh:mm A') : '-'
    },
    {
      title: 'Screening Status',
      key: 'status',
      render: (_, record) => {
        const currentVal = changedStatuses[record.id] || record.pipeline_status || 'shortlisted';
        const isChanged = changedStatuses[record.id] !== undefined && changedStatuses[record.id] !== record.pipeline_status;
        return (
          <Space>
            <Select
              value={currentVal}
              onChange={(val) => handleStatusChange(record.id, val)}
              style={{ width: 130 }}
              dropdownMatchSelectWidth={false}
            >
              <Select.Option value="shortlisted">Shortlisted</Select.Option>
              <Select.Option value="rejected">Rejected</Select.Option>
              <Select.Option value="on_hold">On Hold</Select.Option>
            </Select>
            {isChanged && (
              <Button
                type="primary"
                shape="circle"
                size="small"
                icon={<SaveOutlined />}
                loading={savingStatusId === record.id}
                onClick={() => handleSaveStatus(record.id)}
                style={{ background: 'var(--gold)', borderColor: 'var(--gold)' }}
                title="Save Status"
              />
            )}
          </Space>
        );
      }
    },
    {
      title: 'Zeko Stage',
      dataIndex: 'zeko_stage',
      key: 'zeko_stage',
      render: (text) => text && text !== '-' ? <Tag color="blue">{text.toUpperCase()}</Tag> : <Text type="secondary">-</Text>
    },
    {
      title: 'Zeko Status',
      dataIndex: 'zeko_status',
      key: 'zeko_status',
      render: (status) => {
        if (!status || status === '-') return <Text type="secondary">-</Text>;
        let color = 'default';
        if (status === 'passed') color = 'success';
        if (status === 'failed') color = 'error';
        if (status === 'sent') color = 'processing';
        if (status === 'pending') color = 'warning';
        return <Tag color={color}>{status.toUpperCase()}</Tag>;
      }
    },
    {
      title: 'Actions',
      key: 'actions',
      align: 'center',
      render: (_, record) => (
        <Space size={8}>
          <Tooltip title="Outlook Email Conversations">
            <Button
              type="text"
              shape="circle"
              icon={<MessageOutlined style={{ color: 'var(--gold)' }} />}
              onClick={() => handleOpenOutlook(record.candidate_email, record.candidate_name)}
            />
          </Tooltip>

          <Tooltip title="Schedule Zeko Interview">
            <Button
              type="text"
              shape="circle"
              icon={<CalendarOutlined style={{ color: '#185fa5' }} />}
              onClick={() => handleOpenScheduleModal(record)}
            />
          </Tooltip>

          <Tooltip title="View Candidate Info">
            <Button
              type="text"
              shape="circle"
              icon={<EyeOutlined style={{ color: '#27ae60' }} />}
              onClick={() => setViewingCandidate(record)}
            />
          </Tooltip>

          <Tooltip title="View Profile">
            <Button
              type="text"
              shape="circle"
              icon={<ArrowRightOutlined />}
              onClick={() => navigate(`/candidates/${record.cv_id || record.id}`)}
            />
          </Tooltip>
        </Space>
      )
    }
  ];

  const zekoScheduleColumns = [
    {
      title: 'Candidate',
      key: 'candidate',
      render: (_, record) => (
        <div>
          <Text strong style={{ display: 'block', color: 'var(--text)' }}>
            {record.candidate_name}
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {record.candidate_email}
          </Text>
        </div>
      )
    },
    {
      title: 'Applied Role',
      key: 'role',
      render: (_, record) => record.mrf?.position_hiring_for || record.position_applied || 'Unknown'
    },
    {
      title: 'Zeko Pipeline Status',
      key: 'zeko_status',
      render: (_, record) => {
        const pipelineRow = record.rpa_zeko_candidate_pipeline?.[0];
        if (!pipelineRow) {
          return <Tag color="default">NOT ASSIGNED</Tag>;
        }
        let color = 'default';
        const st = (pipelineRow.status || '').toLowerCase();
        if (st === 'pending') color = 'warning';
        if (st === 'sent') color = 'processing';
        if (st === 'completed' || st === 'passed') color = 'success';
        if (st === 'failed') color = 'error';
        return <Tag color={color}>{st.toUpperCase()}</Tag>;
      }
    },
    {
      title: 'Assigned Job & Actions',
      key: 'actions',
      render: (_, record) => {
        const pipelineRow = record.rpa_zeko_candidate_pipeline?.[0];
        const selectedJobId = selectedJobsMap[record.id];

        let actionContent;
        if (!pipelineRow) {
          actionContent = (
            <Space>
              <Select
                placeholder="Select Zeko Job"
                style={{ width: 200 }}
                value={selectedJobId}
                onChange={(val) => setSelectedJobsMap(prev => ({ ...prev, [record.id]: val }))}
                loading={loadingZekoJobs}
                dropdownMatchSelectWidth={false}
              >
                {zekoJobs.map((job) => (
                  <Select.Option key={job.zeko_id} value={job.zeko_id}>
                    {job.title}
                  </Select.Option>
                ))}
              </Select>
              <Button
                type="primary"
                onClick={() => handleAssignJob(record.id)}
                loading={assigningCandidateId === record.id}
                style={{
                  background: 'linear-gradient(135deg, var(--gold) 0%, var(--gold-light) 100%)',
                  borderColor: 'var(--gold)',
                  boxShadow: '0 4px 10px rgba(0, 95, 86, 0.2)',
                  borderRadius: '6px',
                  fontWeight: '600'
                }}
              >
                Assign & Send
              </Button>
            </Space>
          );
        } else if (pipelineRow.status === 'pending') {
          actionContent = (
            <Button
              type="primary"
              icon={<CalendarOutlined />}
              onClick={() => handleOpenScheduleModal(record)}
              style={{
                background: 'linear-gradient(135deg, #185fa5 0%, #1e40af 100%)',
                borderColor: '#185fa5',
                boxShadow: '0 4px 10px rgba(24, 95, 165, 0.2)',
                borderRadius: '6px',
                fontWeight: '600'
              }}
            >
              Schedule Interview
            </Button>
          );
        } else {
          actionContent = (
            <Space direction="vertical" size={4} style={{ display: 'flex', alignItems: 'flex-start' }}>
              <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                Job ID: <strong>{pipelineRow.zeko_job_id}</strong>
              </Text>
              <Button
                type="primary"
                icon={<CalendarOutlined />}
                onClick={() => handleOpenScheduleModal(record)}
                style={{
                  background: 'linear-gradient(135deg, #4a7c59 0%, #5a9c6e 100%)',
                  borderColor: '#4a7c59',
                  boxShadow: '0 4px 12px rgba(74, 124, 89, 0.25)',
                  borderRadius: '6px',
                  fontWeight: '600',
                  fontSize: '12px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                Scheduled: {dayjs(pipelineRow.interview_start_at).format('DD MMM, hh:mm A')}
              </Button>
            </Space>
          );
        }

        return (
          <Space size={8} align="center">
            {actionContent}
            <Tooltip title="View Candidate Info">
              <Button
                type="default"
                shape="circle"
                icon={<EyeOutlined style={{ color: '#27ae60' }} />}
                onClick={() => setViewingCandidate(record)}
                style={{
                  borderColor: '#b8cc6e',
                  backgroundColor: '#f9fbe7',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 2px 6px rgba(0, 95, 86, 0.15)',
                  width: '32px',
                  height: '32px'
                }}
              />
            </Tooltip>
          </Space>
        );
      }
    }
  ];

  const zekoCancelColumns = [
    {
      title: 'Candidate',
      key: 'candidate',
      render: (_, record) => (
        <div>
          <Text strong style={{ display: 'block', color: 'var(--text)' }}>
            {record.candidate_name || 'Candidate'}
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {record.candidate_email}
          </Text>
        </div>
      )
    },
    {
      title: 'Zeko Job Title',
      dataIndex: 'job_title',
      key: 'job_title',
      render: (text) => text || 'Position'
    },
    {
      title: 'Interview Stage',
      dataIndex: 'stage',
      key: 'stage',
      render: (text) => <Tag color="blue">{(text || '').toUpperCase()}</Tag>
    },
    {
      title: 'Start Time',
      dataIndex: 'interview_start_at',
      key: 'interview_start_at',
      render: (text) => text ? dayjs(text).format('DD MMM YYYY, hh:mm A') : '-'
    },
    {
      title: 'End Time',
      dataIndex: 'interview_end_at',
      key: 'interview_end_at',
      render: (text) => text ? dayjs(text).format('DD MMM YYYY, hh:mm A') : '-'
    },
    {
      title: 'Zeko Status',
      dataIndex: 'status',
      key: 'status',
      render: (status) => <Tag color="processing">{(status || '').toUpperCase()}</Tag>
    },
    {
      title: 'Action',
      key: 'cancel',
      align: 'center',
      render: (_, record) => (
        <Space size={8}>
          <Button
            type="primary"
            danger
            icon={<CloseCircleOutlined />}
            onClick={() => handleOpenCancelModal(record)}
          >
            Cancel Interview
          </Button>
          <Tooltip title="View Candidate Info">
            <Button
              type="default"
              shape="circle"
              icon={<EyeOutlined style={{ color: '#27ae60' }} />}
              onClick={() => {
                const candidateObj = data.candidates.find(c => Number(c.id) === Number(record.candidate_id));
                setViewingCandidate(candidateObj || record);
              }}
              style={{
                borderColor: '#b8cc6e',
                backgroundColor: '#f9fbe7',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 2px 6px rgba(0, 95, 86, 0.15)',
                width: '32px',
                height: '32px'
              }}
            />
          </Tooltip>
        </Space>
      )
    }
  ];

  // Tile items
  const tilesData = [
    { title: 'Shortlisted', value: data.tiles?.shortlisted || 0, icon: <TeamOutlined />, color: 'var(--gold)', bg: 'rgba(0, 95, 86, 0.08)' },
    { title: 'Rejected', value: data.tiles?.rejected || 0, icon: <CloseCircleOutlined />, color: 'var(--red)', bg: 'rgba(192, 57, 43, 0.08)' },
    { title: 'On Hold', value: data.tiles?.on_hold || 0, icon: <ClockCircleOutlined />, color: '#95a5a6', bg: 'rgba(149, 165, 166, 0.08)' },
    { title: 'Total', value: data.tiles?.total || 0, icon: <BarChartOutlined />, color: 'var(--text)', bg: 'var(--gold-subtle)' },
    { title: 'Zeko Sent', value: data.tiles?.zeko_sent || 0, icon: <SendOutlined />, color: '#185fa5', bg: 'rgba(24, 95, 165, 0.08)' },
    { title: 'Zeko Passed', value: data.tiles?.zeko_passed || 0, icon: <CheckCircleOutlined />, color: '#27ae60', bg: 'rgba(39, 174, 96, 0.08)' },
  ];

  return (
    <div className="page-enter" style={{ maxWidth: 1400, margin: '0 auto' }}>
      {/* Page Header */}
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Title level={3} style={{ fontWeight: 800, margin: 0 }}>
            Recruitment Screening Analytics
          </Title>
          <Text type="secondary">
            Monitor shortlist conversions, update pipeline statuses, and manage Zeko interview schedules.
          </Text>
        </div>
        <Button
          type="primary"
          onClick={fetchMainData}
          loading={loading}
          style={{ background: 'var(--gold)', borderColor: 'var(--gold)', height: 40, borderRadius: 8 }}
        >
          Refresh Data
        </Button>
      </div>

      {/* Stats Tiles */}
      <Row gutter={[16, 16]} style={{ marginBottom: 28 }}>
        {tilesData.map((tile, idx) => (
          <Col xs={12} sm={12} md={8} lg={4} key={idx}>
            <Card
              bordered={false}
              className="glass"
              style={{
                borderRadius: 12,
                background: tile.bg,
                border: '1px solid var(--border-light)',
                padding: '12px 16px',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                boxShadow: 'var(--shadow-sm)'
              }}
              bodyStyle={{ padding: 0, width: '100%' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <Text type="secondary" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {tile.title}
                  </Text>
                  <Title level={3} style={{ margin: '4px 0 0', fontWeight: 800, color: tile.color }}>
                    {tile.value}
                  </Title>
                </div>
                <div style={{ fontSize: 24, color: tile.color, opacity: 0.85 }}>
                  {tile.icon}
                </div>
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      {/* Main Tabs Container */}
      <Card className="glass" style={{ borderRadius: 16, border: '1px solid var(--border-light)', boxShadow: 'var(--shadow-md)' }}>
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          size="large"
          tabBarStyle={{ marginBottom: 20 }}
          items={[
            {
              key: 'analytics',
              label: (
                <span>
                  <BarChartOutlined />
                  Analytics Summary
                </span>
              ),
              children: (
                <Table
                  dataSource={roleStats}
                  columns={analyticsColumns}
                  loading={loading}
                  pagination={{ pageSize: 10 }}
                  locale={{ emptyText: <Empty description="No shortlisted roles found" /> }}
                />
              )
            },
            {
              key: 'all',
              label: (
                <span>
                  <TeamOutlined />
                  All Candidates
                </span>
              ),
              children: (
                <div>
                  {/* Filters Bar */}
                  <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
                    <Col xs={24} md={10}>
                      <Input
                        prefix={<SearchOutlined style={{ color: 'var(--text-2)', opacity: 0.5 }} />}
                        placeholder="Search candidate name or email..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        allowClear
                      />
                    </Col>
                    <Col xs={12} md={7}>
                      <Select
                        style={{ width: '100%' }}
                        value={roleFilter}
                        onChange={setRoleFilter}
                        placeholder="Filter by Role"
                      >
                        <Select.Option value="ALL">All Roles</Select.Option>
                        {uniqueRoles.map((role) => (
                          <Select.Option key={role} value={role}>{role}</Select.Option>
                        ))}
                      </Select>
                    </Col>
                    <Col xs={12} md={7}>
                      <Select
                        style={{ width: '100%' }}
                        value={statusFilter}
                        onChange={setStatusFilter}
                        placeholder="Filter by Status"
                      >
                        <Select.Option value="ALL">All Statuses</Select.Option>
                        <Select.Option value="shortlisted">Shortlisted</Select.Option>
                        <Select.Option value="rejected">Rejected</Select.Option>
                        <Select.Option value="on_hold">On Hold</Select.Option>
                      </Select>
                    </Col>
                  </Row>

                  <Table
                    dataSource={filteredCandidates}
                    columns={allCandidatesColumns}
                    rowKey="id"
                    loading={loading}
                    pagination={{ pageSize: 15 }}
                    locale={{ emptyText: <Empty description="No candidates matched the selected filters" /> }}
                  />
                </div>
              )
            },
            {
              key: 'schedule',
              label: (
                <span>
                  <CalendarOutlined />
                  Zeko Interview Schedule
                </span>
              ),
              children: (
                <Table
                  dataSource={data.candidates}
                  columns={zekoScheduleColumns}
                  rowKey="id"
                  loading={loading}
                  pagination={{ pageSize: 10 }}
                  locale={{ emptyText: <Empty description="No candidates available for scheduling" /> }}
                />
              )
            },
            {
              key: 'cancel',
              label: (
                <span>
                  <CloseCircleOutlined />
                  Zeko Cancel Interview
                </span>
              ),
              children: (
                <Table
                  dataSource={cancelPipelineRows}
                  columns={zekoCancelColumns}
                  rowKey="id"
                  loading={loading}
                  pagination={{ pageSize: 10 }}
                  locale={{ emptyText: <Empty description="No active scheduled interviews found" /> }}
                />
              )
            }
          ]}
        />
      </Card>

      {/* --- Outlook Conversations Modal --- */}
      <Modal
        visible={outlookModalVisible}
        onCancel={() => setOutlookModalVisible(false)}
        footer={null}
        width={760}
        bodyStyle={{ padding: 0 }}
        destroyOnClose
        centered
      >
        <div className="conv-modal-head">
          <div style={{ flex: 1 }}>
            <div className="conv-modal-title">
              Outlook Email Threads — {outlookCandidateName}
            </div>
            <div className="conv-modal-sub">
              {outlookEmail}
            </div>
          </div>
          <button className="conv-close" onClick={() => setOutlookModalVisible(false)}>
            &times;
          </button>
        </div>

        <div className="conv-body" ref={convBodyRef}>
          {outlookLoading && (
            <div className="conv-loading">
              <Spin size="default" style={{ marginBottom: 10 }} />
              <div>Fetching email threads from Outlook...</div>
            </div>
          )}

          {!outlookLoading && outlookThreads.length === 0 && (
            <div className="conv-empty">
              <MailOutlined style={{ fontSize: 32, opacity: 0.3, marginBottom: 8 }} />
              <div>No Outlook correspondence history found for this email address.</div>
            </div>
          )}

          {!outlookLoading && outlookThreads.map((thread) => (
            <div key={thread.group_key} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ alignSelf: 'center', margin: '8px 0' }}>
                <Tag color="cyan" style={{ borderRadius: 12, padding: '2px 12px', fontWeight: 600 }}>
                  Thread: {thread.position || 'Correspondence'}
                </Tag>
              </div>

              {thread.messages.map((msg, index) => {
                const isOutbound = msg.direction === 'outbound';
                const formattedTime = msg.sent_at ? dayjs(msg.sent_at).format('DD MMM YYYY, hh:mm A') : '';
                return (
                  <div key={msg.id || index} className={`conv-msg ${isOutbound ? 'out' : 'in'}`}>
                    {msg.subject && (
                      <div className="conv-msg-subject">
                        Subject: {msg.subject}
                      </div>
                    )}
                    <div className="conv-msg-body">
                      {cleanMsgBody(msg.body_html || msg.body_preview)}
                    </div>
                    <div className="conv-msg-meta">
                      <span>{formattedTime}</span>
                      {isOutbound && msg.tracking && (
                        <span className={`conv-badge ${msg.tracking.opened ? 'conv-b-opened' : 'conv-b-delivered'}`}>
                          {msg.tracking.opened ? `Opened (${msg.tracking.open_count})` : 'Delivered'}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </Modal>

      {/* --- Zeko Interview Scheduling Modal --- */}
      <Modal
        title={
          <span style={{ fontWeight: 700, fontSize: 16 }}>
            <CalendarOutlined style={{ marginRight: 8, color: '#185fa5' }} />
            Schedule Zeko Interview
          </span>
        }
        visible={!!schedulingCandidate}
        onCancel={() => setSchedulingCandidate(null)}
        onOk={handleScheduleInterview}
        confirmLoading={schedulingLoading}
        okText="Confirm & Invite"
        cancelText="Cancel"
        destroyOnClose
        centered
      >
        {schedulingCandidate && (
          <Form layout="vertical" style={{ marginTop: 12 }}>
            <Form.Item label="Candidate Details">
              <Input
                value={`${schedulingCandidate.candidate_name} (${schedulingCandidate.candidate_email})`}
                disabled
              />
            </Form.Item>

            <Form.Item label="Select Zeko Job" required>
              <Select
                placeholder="Choose associated Zeko job description"
                value={selectedZekoJobId}
                onChange={setSelectedZekoJobId}
                loading={loadingZekoJobs}
              >
                {zekoJobs.map((job) => (
                  <Select.Option key={job.zeko_id} value={job.zeko_id}>
                    {job.title}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>

            <Form.Item label="Interview Date & Time Range (IST)" required>
              <DatePicker.RangePicker
                showTime={{ format: 'HH:mm' }}
                format="YYYY-MM-DD HH:mm"
                style={{ width: '100%' }}
                value={interviewDates}
                onChange={setInterviewDates}
                disabledDate={(current) => current && current < dayjs().startOf('day')}
              />
              <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
                * Zeko requires times rounded to 30-minute intervals. System will adjust times automatically.
              </Text>
            </Form.Item>
          </Form>
        )}
      </Modal>

      {/* --- Zeko Cancel Confirmation Modal --- */}
      <Modal
        visible={!!cancellingPipeline}
        onCancel={() => setCancellingPipeline(null)}
        footer={null}
        title={null}
        destroyOnClose
        centered
        width={540}
        bodyStyle={{ padding: '24px 28px' }}
      >
        {cancellingPipeline && (
          <div>
            {/* Custom Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', paddingBottom: '16px', borderBottom: '1px solid var(--border-light)', marginBottom: '20px' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '6px', backgroundColor: 'var(--red)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CloseOutlined style={{ color: '#fff', fontSize: '15px', fontWeight: 'bold' }} />
              </div>
              <span style={{ fontSize: '18px', fontWeight: '700', color: 'var(--text)' }}>
                Confirm Cancel Interview
              </span>
            </div>

            {/* Candidate Details Vertical Stack */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', marginBottom: '24px' }}>
              {/* Candidate Info */}
              <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '8px', backgroundColor: 'rgba(47, 84, 235, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: '14px', flexShrink: 0 }}>
                  <UserOutlined style={{ color: '#2f54eb', fontSize: '16px' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '1.4' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-2)', fontWeight: '600', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '2px' }}>
                    Candidate
                  </span>
                  <span style={{ fontSize: '14px', color: 'var(--text)', fontWeight: '700' }}>
                    {cancellingPipeline.candidate_name || 'Candidate'}
                  </span>
                  <span style={{ fontSize: '12px', color: 'var(--text-2)' }}>
                    {cancellingPipeline.candidate_email}
                  </span>
                </div>
              </div>

              {/* Role / MRF Info */}
              <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '8px', backgroundColor: 'rgba(250, 140, 22, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: '14px', flexShrink: 0 }}>
                  <SolutionOutlined style={{ color: '#fa8c16', fontSize: '16px' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '1.4' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-2)', fontWeight: '600', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '2px' }}>
                    Role / MRF
                  </span>
                  <span style={{ fontSize: '14px', color: 'var(--text)', fontWeight: '700' }}>
                    {cancellingPipeline.job_title || 'Position'}
                  </span>
                </div>
              </div>

              {/* Stage Info */}
              <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '8px', backgroundColor: 'rgba(235, 47, 150, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: '14px', flexShrink: 0 }}>
                  <CompassOutlined style={{ color: '#eb2f96', fontSize: '16px' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '1.4' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-2)', fontWeight: '600', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '2px' }}>
                    Stage
                  </span>
                  <span style={{ fontSize: '14px', color: 'var(--text)', fontWeight: '700' }}>
                    {cancellingPipeline.stage ? (cancellingPipeline.stage.toLowerCase() === 'hr' ? 'HR Interview' : cancellingPipeline.stage.charAt(0).toUpperCase() + cancellingPipeline.stage.slice(1) + ' Interview') : 'Interview'}
                  </span>
                </div>
              </div>

              {/* Scheduled Time Info */}
              <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '8px', backgroundColor: 'rgba(82, 196, 26, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: '14px', flexShrink: 0 }}>
                  <CalendarOutlined style={{ color: '#52c41a', fontSize: '16px' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '1.4' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-2)', fontWeight: '600', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '2px' }}>
                    Scheduled Time
                  </span>
                  <span style={{ fontSize: '13px', color: 'var(--text)', fontWeight: '700' }}>
                    {dayjs(cancellingPipeline.interview_start_at).format('DD MMMM YYYY, hh:mm a') + ' IST'} → {dayjs(cancellingPipeline.interview_end_at).format('DD MMMM YYYY, hh:mm a') + ' IST'}
                  </span>
                </div>
              </div>
            </div>

            {/* Cancel Reason Input */}
            <div style={{ marginBottom: '20px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-2)', fontWeight: '600', letterSpacing: '0.05em', textTransform: 'uppercase', display: 'block', marginBottom: '6px' }}>
                Cancel Reason (Optional)
              </span>
              <TextArea
                rows={3}
                placeholder="e.g. Candidate unavailable, rescheduling required..."
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                style={{ borderRadius: '8px', border: '1px solid var(--border)' }}
              />
            </div>

            {/* Alert Message Box */}
            <div style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
              backgroundColor: 'rgba(192, 57, 43, 0.04)',
              border: '1px solid rgba(192, 57, 43, 0.15)',
              borderRadius: '8px',
              padding: '12px 16px',
              marginBottom: '24px'
            }}>
              <WarningOutlined style={{ color: 'var(--red)', fontSize: '15px', marginTop: '2px' }} />
              <span style={{ fontSize: '12px', color: 'var(--red)', fontWeight: '500', lineHeight: '1.5' }}>
                A cancellation email will be sent to the candidate immediately. This action cannot be undone.
              </span>
            </div>

            {/* Footer Action Buttons */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <Button
                onClick={() => setCancellingPipeline(null)}
                style={{
                  borderRadius: '8px',
                  backgroundColor: '#f5f5f5',
                  border: '1px solid var(--border)',
                  color: 'var(--text-2)',
                  fontWeight: '600',
                  height: '40px',
                  padding: '0 20px'
                }}
              >
                — Back
              </Button>
              <Button
                type="primary"
                danger
                icon={<CloseOutlined />}
                loading={cancellingLoading}
                onClick={handleCancelInterview}
                style={{
                  borderRadius: '8px',
                  backgroundColor: 'var(--red)',
                  borderColor: 'var(--red)',
                  fontWeight: '600',
                  height: '40px',
                  padding: '0 20px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                Yes, Cancel Interview
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* --- View Candidate Modal --- */}
      <Modal
        visible={!!viewingCandidate}
        onCancel={() => setViewingCandidate(null)}
        footer={null}
        title={null}
        destroyOnClose
        centered
        width={800}
        bodyStyle={{ padding: '24px 28px' }}
      >
        {viewingCandidate && (() => {
          const cv = viewingCandidate.cv || {};
          return (
            <div>
              {/* Modal Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-light)', paddingBottom: '12px', marginBottom: '20px' }}>
                <span style={{ fontSize: '18px', fontWeight: '700', color: 'var(--text)' }}>
                  View Candidate
                </span>
                <button 
                  onClick={() => setViewingCandidate(null)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    fontSize: '20px',
                    color: 'var(--text-2)',
                    cursor: 'pointer',
                    lineHeight: '1'
                  }}
                >
                  &times;
                </button>
              </div>

              {/* Title Section */}
              <div style={{ textAlign: 'center', marginBottom: '16px' }}>
                <span style={{ fontSize: '11px', color: 'var(--gold)', fontWeight: '700', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>
                  Personal Information
                </span>
                <div style={{ width: '40px', height: '2px', background: 'var(--gold)', margin: '0 auto 16px' }} />
              </div>

              {/* 2-Column Centered Key-Value Grid */}
              <div style={{ maxHeight: '480px', overflowY: 'auto', paddingRight: '4px' }}>
                <Row gutter={[16, 20]} justify="center" align="middle" style={{ textAlign: 'center' }}>
                  {/* Candidate Name */}
                  <Col span={12}>
                    <span style={{ fontSize: '10px', color: 'var(--text-2)', fontWeight: '600', letterSpacing: '0.05em', textTransform: 'uppercase', display: 'block', marginBottom: '2px' }}>
                      Candidate Name
                    </span>
                    <span style={{ fontSize: '13px', color: 'var(--text)', fontWeight: '700' }}>
                      {viewingCandidate.candidate_name || cv.Name || 'N/A'}
                    </span>
                  </Col>

                  {/* Candidate Email */}
                  <Col span={12}>
                    <span style={{ fontSize: '10px', color: 'var(--text-2)', fontWeight: '600', letterSpacing: '0.05em', textTransform: 'uppercase', display: 'block', marginBottom: '2px' }}>
                      Candidate Email
                    </span>
                    <span style={{ fontSize: '13px', color: 'var(--text)', fontWeight: '700' }}>
                      {viewingCandidate.candidate_email || cv.EmailID || 'N/A'}
                    </span>
                  </Col>

                  {/* Contact Number */}
                  <Col span={12}>
                    <span style={{ fontSize: '10px', color: 'var(--text-2)', fontWeight: '600', letterSpacing: '0.05em', textTransform: 'uppercase', display: 'block', marginBottom: '2px' }}>
                      Candidate Contact Number
                    </span>
                    <span style={{ fontSize: '13px', color: 'var(--text)', fontWeight: '700' }}>
                      {cv.ContactNumber || 'N/A'}
                    </span>
                  </Col>

                  {/* Highest Qualification */}
                  <Col span={12}>
                    <span style={{ fontSize: '10px', color: 'var(--text-2)', fontWeight: '600', letterSpacing: '0.05em', textTransform: 'uppercase', display: 'block', marginBottom: '2px' }}>
                      Highest Qualification
                    </span>
                    <span style={{ fontSize: '13px', color: 'var(--text)', fontWeight: '700' }}>
                      {cv.HighestQualification || 'N/A'}
                    </span>
                  </Col>

                  {/* Total Experience */}
                  <Col span={12}>
                    <span style={{ fontSize: '10px', color: 'var(--text-2)', fontWeight: '600', letterSpacing: '0.05em', textTransform: 'uppercase', display: 'block', marginBottom: '2px' }}>
                      Total Experience (Years)
                    </span>
                    <span style={{ fontSize: '13px', color: 'var(--text)', fontWeight: '700' }}>
                      {cv.TotalExperienceYears || 'N/A'}
                    </span>
                  </Col>

                  {/* Last Company Experience */}
                  <Col span={12}>
                    <span style={{ fontSize: '10px', color: 'var(--text-2)', fontWeight: '600', letterSpacing: '0.05em', textTransform: 'uppercase', display: 'block', marginBottom: '2px' }}>
                      Last Company Experience (Years)
                    </span>
                    <span style={{ fontSize: '13px', color: 'var(--text)', fontWeight: '700' }}>
                      {cv.LastCompanyExperienceYears || 'N/A'}
                    </span>
                  </Col>

                  {/* Current Location */}
                  <Col span={12}>
                    <span style={{ fontSize: '10px', color: 'var(--text-2)', fontWeight: '600', letterSpacing: '0.05em', textTransform: 'uppercase', display: 'block', marginBottom: '2px' }}>
                      Current Location
                    </span>
                    <span style={{ fontSize: '13px', color: 'var(--text)', fontWeight: '700' }}>
                      {cv.CurrentLocation || 'N/A'}
                    </span>
                  </Col>

                  {/* CTC (LPA) */}
                  <Col span={12}>
                    <span style={{ fontSize: '10px', color: 'var(--text-2)', fontWeight: '600', letterSpacing: '0.05em', textTransform: 'uppercase', display: 'block', marginBottom: '2px' }}>
                      CTC (LPA)
                    </span>
                    <span style={{ fontSize: '13px', color: 'var(--text)', fontWeight: '700' }}>
                      {cv.CTC_LPA || 'N/A'}
                    </span>
                  </Col>

                  {/* Expected CTC (LPA) */}
                  <Col span={12}>
                    <span style={{ fontSize: '10px', color: 'var(--text-2)', fontWeight: '600', letterSpacing: '0.05em', textTransform: 'uppercase', display: 'block', marginBottom: '2px' }}>
                      Expected CTC (LPA)
                    </span>
                    <span style={{ fontSize: '13px', color: 'var(--text)', fontWeight: '700' }}>
                      {cv.ExpectedCTC_LPA || 'N/A'}
                    </span>
                  </Col>

                  {/* Notice Period */}
                  <Col span={12}>
                    <span style={{ fontSize: '10px', color: 'var(--text-2)', fontWeight: '600', letterSpacing: '0.05em', textTransform: 'uppercase', display: 'block', marginBottom: '2px' }}>
                      Notice Period (Days)
                    </span>
                    <span style={{ fontSize: '13px', color: 'var(--text)', fontWeight: '700' }}>
                      {cv.NoticePeriod != null ? (
                        String(cv.NoticePeriod).toLowerCase().includes('day') 
                          ? cv.NoticePeriod 
                          : `${cv.NoticePeriod} days`
                      ) : 'N/A'}
                    </span>
                  </Col>

                  {/* Position Applied */}
                  <Col span={12}>
                    <span style={{ fontSize: '10px', color: 'var(--text-2)', fontWeight: '600', letterSpacing: '0.05em', textTransform: 'uppercase', display: 'block', marginBottom: '2px' }}>
                      Position Applied
                    </span>
                    <span style={{ fontSize: '13px', color: 'var(--text)', fontWeight: '700' }}>
                      {cv.PositionApplied || viewingCandidate.position_applied || 'N/A'}
                    </span>
                  </Col>

                  {/* Job Source */}
                  <Col span={12}>
                    <span style={{ fontSize: '10px', color: 'var(--text-2)', fontWeight: '600', letterSpacing: '0.05em', textTransform: 'uppercase', display: 'block', marginBottom: '2px' }}>
                      Job Source
                    </span>
                    <span style={{ fontSize: '13px', color: 'var(--text)', fontWeight: '700' }}>
                      {cv.JobSource || 'N/A'}
                    </span>
                  </Col>

                  {/* Recruiter Info */}
                  <Col span={12}>
                    <span style={{ fontSize: '10px', color: 'var(--text-2)', fontWeight: '600', letterSpacing: '0.05em', textTransform: 'uppercase', display: 'block', marginBottom: '2px' }}>
                      Recruiter Info (AAPNA)
                    </span>
                    <span style={{ fontSize: '13px', color: 'var(--text)', fontWeight: '700' }}>
                      {cv.RecruiterInfoAAPNA || 'N/A'}
                    </span>
                  </Col>

                  {/* English Communication */}
                  <Col span={12}>
                    <span style={{ fontSize: '10px', color: 'var(--text-2)', fontWeight: '600', letterSpacing: '0.05em', textTransform: 'uppercase', display: 'block', marginBottom: '2px' }}>
                      English Communication Rating
                    </span>
                    <span style={{ fontSize: '13px', color: 'var(--text)', fontWeight: '700' }}>
                      {cv.EnglishCommunicationRating || 'N/A'}
                    </span>
                  </Col>

                  {/* Divider line before skills */}
                  <Col span={24}>
                    <Divider style={{ margin: '8px 0' }} />
                  </Col>

                  {/* Top 5 Key Skills */}
                  <Col span={24}>
                    <span style={{ fontSize: '10px', color: 'var(--text-2)', fontWeight: '600', letterSpacing: '0.05em', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>
                      Top 5 Key Skills
                    </span>
                    <span style={{ fontSize: '13px', color: 'var(--text)', fontWeight: '700', display: 'block' }}>
                      {(() => {
                        const skills = cv.Top5KeySkills;
                        if (!skills) return 'N/A';
                        if (Array.isArray(skills)) return skills.join(', ');
                        if (typeof skills === 'string') {
                          let str = skills.trim();
                          if (str.startsWith('{') && str.endsWith('}')) {
                            str = str.slice(1, -1);
                            return str.split(',')
                              .map(s => s.trim().replace(/^"|"$/g, '').trim())
                              .filter(Boolean)
                              .join(', ');
                          }
                          return str;
                        }
                        return String(skills);
                      })()}
                    </span>
                  </Col>

                  {/* Divider line before gender/shift */}
                  <Col span={24}>
                    <Divider style={{ margin: '8px 0' }} />
                  </Col>

                  {/* Gender */}
                  <Col span={12}>
                    <span style={{ fontSize: '10px', color: 'var(--text-2)', fontWeight: '600', letterSpacing: '0.05em', textTransform: 'uppercase', display: 'block', marginBottom: '2px' }}>
                      Gender
                    </span>
                    <span style={{ fontSize: '13px', color: 'var(--text)', fontWeight: '700' }}>
                      {cv.Gender || 'N/A'}
                    </span>
                  </Col>

                  {/* Preferred Shift */}
                  <Col span={12}>
                    <span style={{ fontSize: '10px', color: 'var(--text-2)', fontWeight: '600', letterSpacing: '0.05em', textTransform: 'uppercase', display: 'block', marginBottom: '2px' }}>
                      Preferred Shift
                    </span>
                    <span style={{ fontSize: '13px', color: 'var(--text)', fontWeight: '700' }}>
                      {cv.PreferredShift || 'N/A'}
                    </span>
                  </Col>
                </Row>
              </div>

              {/* Modal Footer */}
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: '24px', borderTop: '1px solid var(--border-light)', paddingTop: '16px' }}>
                <Button 
                  onClick={() => setViewingCandidate(null)}
                  style={{
                    borderRadius: '6px',
                    backgroundColor: '#f5f5f5',
                    border: '1px solid var(--border)',
                    color: 'var(--text-2)',
                    fontWeight: '600',
                    height: '36px',
                    padding: '0 24px'
                  }}
                >
                  Close
                </Button>
              </div>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}
