import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
// `Card` went with the hand-rolled shell this page used to render — the page
// body now sits inside PublicPageShell's own card.
import { Button, Typography, Alert, Spin, Input, Result, Descriptions, Badge, Space, Divider, Row, Col, message } from 'antd';
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

// Statuses that still await a decision — same set the approve endpoint accepts.
const OPEN_STATUSES = ['pending', 'waiting'];

// Wording for a requisition that is no longer open. "declined" matches the
// outcome email ("Declined: New MRF Request").
const decidedLabel = (status) => {
  switch (status) {
    case 'approved': return 'approved';
    case 'rejected': return 'declined';
    case 'completed': return 'completed';
    case 'closed': return 'closed';
    default: return 'processed';
  }
};

// These public calls use plain axios, not the `api` wrapper, so the server's
// message is on err.response.data — err.message is only "Request failed with
// status code …".
const apiErrorMessage = (err, fallback) => err?.response?.data?.message || fallback;

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
  // Set when the requisition was already decided (usually by the other
  // approver). Deliberately NOT an error: the earlier decision succeeded.
  const [decidedStatus, setDecidedStatus] = useState('');
  // With personal links the server also says WHO decided and WHEN (name and
  // time only — never the decider's email, IP or device), and whether the
  // decision was yours.
  const [decision, setDecision] = useState(null);
  // An HR re-issue replaced this link with a newer email.
  const [linkReplaced, setLinkReplaced] = useState(false);
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
    setDecidedStatus('');
    setDecision(null);
    setLinkReplaced(false);
    try {
      const res = await mrfService.getPublicMrfDetails(id, token);
      const data = res?.data || res;
      setMrfDetails(data);
      const status = (data.approval_status || '').trim().toLowerCase();
      if (!OPEN_STATUSES.includes(status)) {
        setDecidedStatus(status || 'processed');
        setDecision(data.decision || null);
      } else if (data.link_state === 'replaced') {
        setLinkReplaced(true);
      }
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to retrieve requisition details. The link may have expired or is invalid.'));
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
      if (err?.response?.status === 409) {
        // Someone decided while this page was open: reload, which lands on
        // the neutral "already decided" view.
        await fetchMrfDetails();
      } else {
        setError(apiErrorMessage(err, 'Failed to process requisition action. Please try again.'));
      }
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
              Thank you for your decision. The requisition for <strong>{mrfDetails?.position_hiring_for}</strong> has been marked as <strong>{successStatus.toUpperCase()}</strong>. Notification emails have been dispatched to the HR team
              {mrfDetails?.approver ? ', the other approvers have been told, and a confirmation has been emailed to you' : ''}.
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

  if (decidedStatus) {
    const label = decidedLabel(decidedStatus);
    const byName = decision?.decidedByName;
    const when = decision?.decidedAtIst;
    // Who and when, when the server knows (personal links). Older decisions
    // (shared link / before the audit trail) keep the generic wording.
    let title = `This requisition has already been ${label}`;
    let body = (
      <>
        The requisition for <strong>{mrfDetails?.position_hiring_for}</strong> has already been <strong>{label}</strong>.
        Only one approval is needed, so if you did not take this decision yourself, another approver already has.
      </>
    );
    if (decision?.isYou) {
      title = `You ${label} this requisition`;
      body = (
        <>
          You {label} <strong>{mrfDetails?.position_hiring_for}</strong>{when ? <> on <strong>{when}</strong></> : null}. Nothing more is needed.
        </>
      );
    } else if (byName && !byName.startsWith('Unknown')) {
      title = `Already ${label} by ${byName}`;
      body = (
        <>
          <strong>{byName}</strong> {label} <strong>{mrfDetails?.position_hiring_for}</strong>{when ? <> on <strong>{when}</strong></> : null}.
          Only one approval is needed, so no action is required from you.
        </>
      );
    }
    return (
      <PublicPageShell
        title={`Requisition already ${label}`}
        subtitle="No further action is needed from you."
      >
        <Result
          status={decidedStatus === 'approved' ? 'success' : 'info'}
          title={<span style={{ fontWeight: 700 }}>{title}</span>}
          subTitle={
            <>
              <Paragraph style={{ color: 'var(--text-secondary)', fontSize: 14 }}>{body}</Paragraph>
              {decision?.comments && (
                <Paragraph style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                  <strong>Comment:</strong> {decision.comments}
                </Paragraph>
              )}
            </>
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

  if (linkReplaced) {
    return (
      <PublicPageShell
        title="This link was replaced"
        subtitle="A newer approval email has been sent to you."
      >
        <Result
          status="info"
          title={<span style={{ fontWeight: 700 }}>Please use the most recent approval email</span>}
          subTitle={
            <Paragraph style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
              The HR team re-sent the approval request for <strong>{mrfDetails?.position_hiring_for}</strong>, so this older link no longer works.
              Open the latest &quot;New MRF Request - Approval Request&quot; email to approve or decline.
            </Paragraph>
          }
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
        {mrfDetails?.approver && (
          <Alert
            type="info"
            showIcon
            style={{ borderRadius: 10, marginBottom: 20 }}
            message={<>Reviewing as <strong>{mrfDetails.approver.name}</strong></>}
            description="This link is personal to you: your decision is recorded under your name. Only one approval is needed; the other approvers are told as soon as you decide."
          />
        )}
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
