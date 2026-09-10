import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
// `Card` went with the hand-rolled shell this page used to render — the page
// body now sits inside PublicPageShell's own card.
import { Typography, Alert, Spin, Input, Result, Descriptions, Badge, Space, Divider, Row, Col, message } from 'antd';
import { Button } from '../ui';
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
        <div className="cmp-loading"><Spin size="large" /></div>
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
          title={<span className="pps-result-title">Requisition Request {isApproved ? 'Approved' : 'Declined'}!</span>}
          subTitle={
            <Paragraph className="pps-hint">
              Thank you for your decision. The requisition for <strong>{mrfDetails?.position_hiring_for}</strong> has been marked as <strong>{successStatus.toUpperCase()}</strong>. Notification emails have been dispatched to the HR team.
            </Paragraph>
          }
          extra={[
            <Button
              key="close"
              emphasis="solid"
              onClick={() => window.close()}
              emphasis="solid"
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
          showIcon className="pps-alert"
        />
        <Paragraph type="secondary" className="pps-note">
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
        <div className="pps-panel">
          <Descriptions
            title={<span className="pps-section-title">Requisition Summary</span>}
            bordered
            column={{ xs: 1, sm: 2, md: 2, lg: 2, xl: 2, xxl: 2 }}
            size="small"
            labelStyle={{ width: '18%', minWidth: '100px', fontWeight: 600 }}
            contentStyle={{ width: '32%', minWidth: '150px', wordBreak: 'break-word' }}
          >
            <Descriptions.Item label="Position Hiring For" span={2}>
              <Text strong className="pps-emphasis">{mrfDetails?.position_hiring_for}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="Hiring Manager">{mrfDetails?.hiring_manager_name} ({mrfDetails?.hiring_manager_designation})</Descriptions.Item>
            <Descriptions.Item label="Submitter Email">{mrfDetails?.submitter_email}</Descriptions.Item>
            <Descriptions.Item label="Number of Positions">
              <Badge count={mrfDetails?.number_of_positions} className="pps-badge" />
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
                <Button emphasis="text" icon={<FileDoneOutlined />} href={mrfDetails.jd_document_link} target="_blank" className="pps-link">
                  View Uploaded Job Description File →
                </Button>
              ) : (
                <Text type="secondary">No JD file uploaded</Text>
              )}
            </Descriptions.Item>
          </Descriptions>
        </div>

        {mrfDetails?.parsed_jd_json && (
          <div className="pps-panel">
            <Descriptions
              title={<span className="pps-section-title">AI-Parsed JD Summary</span>}
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
        <Divider  />
        
        <div className="pps-mt">
          <Title level={5} className="pps-row">
            <MessageOutlined className="pps-accent" /> Add Review Comments (Optional)
          </Title>
          <TextArea
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            placeholder="Add any comments, special terms, priority preferences, or feedback..."
            autoSize={{ minRows: 3, maxRows: 6 }} className="pps-textarea"
          />
        </div>

        <div className="pps-mt-lg">
          {isApproveFlow ? (
            <Row gutter={16}>
              <Col xs={24} sm={16}>
                <Button
                  emphasis="solid"
                  icon={<CheckCircleOutlined />}
                  onClick={() => handleAction('approve')}
                  loading={submitting}
                  block
                  emphasis="solid" size="lg"
                >
                  Confirm Requisition Approval
                </Button>
              </Col>
              <Col xs={24} sm={8}>
                <Button
                  onClick={() => setCurrentAction('reject')}
                  emphasis="soft" tone="danger" size="lg" block
                >
                  Reject Instead
                </Button>
              </Col>
            </Row>
          ) : (
            <Row gutter={16}>
              <Col xs={24} sm={16}>
                <Button
                  icon={<CloseCircleOutlined />}
                  onClick={() => handleAction('reject')}
                  loading={submitting}
                  block
                  emphasis="solid" tone="danger" size="lg"
                >
                  Confirm Requisition Rejection
                </Button>
              </Col>
              <Col xs={24} sm={8}>
                <Button
                  onClick={() => setCurrentAction('approve')}
                  emphasis="soft" tone="success" size="lg" block
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
