import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Card, Button, Typography, Alert, Spin, Input, Result, Descriptions, Badge, Space, Divider, Row, Col, message } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, MessageOutlined, FileDoneOutlined } from '@ant-design/icons';
import mrfService from '../services/mrfService';
// The shared public-page frame, mirroring the branded email the approver clicks
// through from. This page hand-rolled its own logo header, footer and
// `auth-background` shell, so an approver saw a different design from the mail
// that sent them — on the one surface that is meant to feel continuous.
import PublicPageShell, { BRAND } from '../components/common/PublicPageShell';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

// Dropdown fields with an "Other" option render as "Other - <custom text>".
const fmtOther = (sel, other) =>
  String(sel || '').trim().toLowerCase() === 'other' && other
    ? `Other - ${other}`
    : (sel || 'Not specified');

export default function MrfApprovalAction() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const actionParam = searchParams.get('action') || 'approve';

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [mrfDetails, setMrfDetails] = useState(null);
  const [comments, setComments] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [successStatus, setSuccessStatus] = useState('');
  const [currentAction, setCurrentAction] = useState(actionParam.toLowerCase() === 'reject' ? 'reject' : 'approve');

  useEffect(() => {
    if (!token) {
      setError('Missing Approval Token: The link you clicked does not contain a secure verification token. Please refer to the email sent to you.');
      setLoading(false);
      return;
    }
    fetchMrfDetails();
  }, [id, token]);

  const fetchMrfDetails = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await mrfService.getPublicMrfDetails(id, token);
      const data = res?.data || res;
      setMrfDetails(data);
      const status = (data.approval_status || '').toLowerCase();
      if (status !== 'pending' && status !== 'waiting') {
        setError(`This requisition has already been processed. Current status is: ${data.approval_status.toUpperCase()}.`);
      }
    } catch (err) {
      setError(err?.message || 'Failed to retrieve requisition details. The link may have expired or is invalid.');
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (actionType) => {
    setSubmitting(true);
    setError('');
    try {
      const payload = {
        token,
        action: actionType,
        comments: comments.trim(),
      };
      await mrfService.handleMrfApproval(id, payload);
      setSuccessStatus(actionType === 'approve' ? 'approved' : 'rejected');
      setSuccess(true);
      message.success(`Requisition request successfully ${actionType === 'approve' ? 'approved' : 'rejected'}!`);
    } catch (err) {
      setError(err?.message || 'Failed to process requisition action. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <PublicPageShell title="Review Requisition Request" subtitle="Loading requisition details…">
        <div style={{ textAlign: 'center', padding: '32px 0' }}><Spin size="large" /></div>
      </PublicPageShell>
    );
  }

  if (success) {
    const isApproved = successStatus === 'approved';
    return (
      <PublicPageShell
        title={`Requisition ${isApproved ? 'approved' : 'declined'}`}
        subtitle="Your decision has been recorded and the HR team notified."
      >
        <Result
          status={isApproved ? 'success' : 'error'}
          title={<span style={{ fontWeight: 700 }}>Requisition Request {isApproved ? 'Approved' : 'Declined'}!</span>}
          subTitle={
            <Paragraph style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
              Thank you for your decision. The requisition for <strong>{mrfDetails?.position_hiring_for}</strong> has been marked as <strong>{successStatus.toUpperCase()}</strong>. Notification emails have been dispatched to the HR team.
            </Paragraph>
          }
          extra={[
            <Button
              key="close"
              type="primary"
              onClick={() => window.close()}
              style={{ height: 44, borderRadius: 8, background: BRAND.accent, border: 'none', fontWeight: 600, paddingInline: 32 }}
            >
              Close Window
            </Button>
          ]}
        />
      </PublicPageShell>
    );
  }

  if (error) {
    return (
      <PublicPageShell
        title="Link inactive or invalid"
        subtitle="We could not open this requisition from your link."
      >
        <Alert
          message="Requisition Process Error"
          description={error}
          type="error"
          showIcon
          style={{ borderRadius: 10, marginBottom: 20 }}
        />
        <Paragraph type="secondary" style={{ textAlign: 'center', fontSize: 12 }}>
          If you believe this is an error, please reach out to the recruitment coordinator or HR team.
        </Paragraph>
      </PublicPageShell>
    );
  }

  const isApproveFlow = currentAction === 'approve';

  return (
    <PublicPageShell
      maxWidth={850}
      title="Review Requisition Request"
      subtitle={`Manpower Requisition Form submitted by ${mrfDetails?.hiring_manager_name || 'a hiring manager'}.`}
    >
        {/* Detailed Requisition Info */}
        <div style={{ background: 'rgba(255,255,255,0.4)', borderRadius: 12, padding: 20, marginBottom: 24, border: '1px solid #e8ede0' }}>
          <Descriptions
            title={<span style={{ color: BRAND.accent, fontSize: 16, fontWeight: 700 }}>Requisition Summary</span>}
            bordered
            column={{ xs: 1, sm: 2, md: 2, lg: 2, xl: 2, xxl: 2 }}
            size="small"
            labelStyle={{ width: '18%', minWidth: '100px', fontWeight: 600 }}
            contentStyle={{ width: '32%', minWidth: '150px', wordBreak: 'break-word' }}
          >
            <Descriptions.Item label="Position Hiring For" span={2}>
              <Text strong style={{ fontSize: 15 }}>{mrfDetails?.position_hiring_for}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="Hiring Manager">{mrfDetails?.hiring_manager_name} ({mrfDetails?.hiring_manager_designation})</Descriptions.Item>
            <Descriptions.Item label="Submitter Email">{mrfDetails?.submitter_email}</Descriptions.Item>
            <Descriptions.Item label="Number of Positions">
              <Badge count={mrfDetails?.number_of_positions} style={{ backgroundColor: BRAND.accent }} />
            </Descriptions.Item>
            <Descriptions.Item label="Required Timeline">{mrfDetails?.required_in}</Descriptions.Item>
            <Descriptions.Item label="Reports To">{mrfDetails?.position_reports_to || 'Not Specified'}</Descriptions.Item>
            <Descriptions.Item label="Employment Type">{mrfDetails?.employment_type || 'Not Specified'}</Descriptions.Item>
            <Descriptions.Item label="Experience Required">{mrfDetails?.total_years_of_experience} Years total ({mrfDetails?.relevant_years_of_experience} Years relevant)</Descriptions.Item>
            <Descriptions.Item label="Project Details">{mrfDetails?.project_name} ({mrfDetails?.project_duration})</Descriptions.Item>
            {mrfDetails?.roles_responsibilities && (
              <Descriptions.Item label="Roles & Responsibilities" span={2}>
                {fmtOther(mrfDetails?.roles_responsibilities, mrfDetails?.roles_responsibilities_other)}
              </Descriptions.Item>
            )}
            <Descriptions.Item label="Mandatory Skills" span={2}>
              {fmtOther(mrfDetails?.mandatory_skills, mrfDetails?.mandatory_skills_other)}
            </Descriptions.Item>
            {mrfDetails?.good_to_have_skills && (
              <Descriptions.Item label="Good to Have Skills" span={2}>
                {fmtOther(mrfDetails?.good_to_have_skills, mrfDetails?.good_to_have_skills_other)}
              </Descriptions.Item>
            )}
            <Descriptions.Item label="Job Description (JD)" span={2}>
              {mrfDetails?.jd_document_link ? (
                <Button type="link" icon={<FileDoneOutlined />} href={mrfDetails.jd_document_link} target="_blank" style={{ paddingLeft: 0, fontWeight: 600, color: BRAND.accent }}>
                  View Uploaded Job Description File →
                </Button>
              ) : (
                <Text type="secondary">No JD file uploaded</Text>
              )}
            </Descriptions.Item>
          </Descriptions>
        </div>

        {mrfDetails?.parsed_jd_json && (
          <div style={{ background: 'rgba(255,255,255,0.4)', borderRadius: 12, padding: 20, marginBottom: 24, border: '1px solid #e8ede0' }}>
            <Descriptions
              title={<span style={{ color: BRAND.accent, fontSize: 16, fontWeight: 700 }}>AI-Parsed JD Summary</span>}
              bordered
              column={{ xs: 1, sm: 2, md: 2, lg: 2, xl: 2, xxl: 2 }}
              size="small"
              labelStyle={{ width: '18%', minWidth: '100px', fontWeight: 600 }}
              contentStyle={{ width: '32%', minWidth: '150px', wordBreak: 'break-word' }}
            >
              <Descriptions.Item label="Experience Range">
                {mrfDetails.parsed_jd_json.min_experience_years ?? '—'} - {mrfDetails.parsed_jd_json.max_experience_years ?? '—'} years
              </Descriptions.Item>
              <Descriptions.Item label="Education">{mrfDetails.parsed_jd_json.education || 'Not specified'}</Descriptions.Item>
              <Descriptions.Item label="Mandatory Skills (from JD)" span={2}>{mrfDetails.parsed_jd_json.mandatory_skills || 'Not specified'}</Descriptions.Item>
              {mrfDetails.parsed_jd_json.good_to_have_skills && (
                <Descriptions.Item label="Good to Have Skills (from JD)" span={2}>{mrfDetails.parsed_jd_json.good_to_have_skills}</Descriptions.Item>
              )}
              <Descriptions.Item label="Roles & Responsibilities (from JD)" span={2}>{mrfDetails.parsed_jd_json.roles_and_responsibilities || 'Not specified'}</Descriptions.Item>
            </Descriptions>
          </div>
        )}

        {/* Action Form */}
        <Divider style={{ borderColor: '#e8ede0' }} />
        
        <div style={{ marginTop: 12 }}>
          <Title level={5} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MessageOutlined style={{ color: BRAND.accent }} /> Add Review Comments (Optional)
          </Title>
          <TextArea
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            placeholder="Add any comments, special terms, priority preferences, or feedback..."
            autoSize={{ minRows: 3, maxRows: 6 }}
            style={{ borderRadius: 10, marginTop: 8, padding: 12 }}
          />
        </div>

        <div style={{ marginTop: 32 }}>
          {isApproveFlow ? (
            <Row gutter={16}>
              <Col xs={24} sm={16}>
                <Button
                  type="primary"
                  icon={<CheckCircleOutlined />}
                  onClick={() => handleAction('approve')}
                  loading={submitting}
                  block
                  style={{
                    height: 48,
                    borderRadius: 10,
                    fontWeight: 700,
                    fontSize: 15,
                    background: BRAND.accent,
                    borderColor: BRAND.accent,
                  }}
                >
                  Confirm Requisition Approval
                </Button>
              </Col>
              <Col xs={24} sm={8}>
                <Button
                  onClick={() => setCurrentAction('reject')}
                  className="btn-reject-secondary"
                  style={{ height: 48, borderRadius: 10, fontWeight: 600, width: '100%' }}
                >
                  Reject Instead
                </Button>
              </Col>
            </Row>
          ) : (
            <Row gutter={16}>
              <Col xs={24} sm={16}>
                <Button
                  type="primary"
                  danger
                  icon={<CloseCircleOutlined />}
                  onClick={() => handleAction('reject')}
                  loading={submitting}
                  block
                  style={{
                    height: 48,
                    borderRadius: 10,
                    fontWeight: 700,
                    fontSize: 15,
                  }}
                >
                  Confirm Requisition Rejection
                </Button>
              </Col>
              <Col xs={24} sm={8}>
                <Button
                  onClick={() => setCurrentAction('approve')}
                  className="btn-approve-secondary"
                  style={{ height: 48, borderRadius: 10, fontWeight: 600, width: '100%' }}
                >
                  Approve Instead
                </Button>
              </Col>
            </Row>
          )}
        </div>

      {/* The hand-rolled copyright line is gone — PublicPageShell renders the
          same footer the branded email does, so this page had two. */}
    </PublicPageShell>
  );
}
