import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Card, Button, Typography, Alert, Spin, Input, Result, Descriptions, Badge, Space, Divider, Row, Col, message } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, MessageOutlined, FileDoneOutlined } from '@ant-design/icons';
import mrfService from '../services/mrfService';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

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
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--ink)' }}>
        <Spin size="large" />
        <Text style={{ marginTop: 16, color: 'var(--text-secondary)' }}>Loading requisition details...</Text>
      </div>
    );
  }

  if (success) {
    const isApproved = successStatus === 'approved';
    return (
      <div className="auth-background" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
        <Card className="glass animate-fade-in" style={{ width: '100%', maxWidth: 580, borderRadius: 20, padding: 24, boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.08)' }}>
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
                style={{ height: 44, borderRadius: 8, background: '#7a922e', border: 'none', fontWeight: 600, paddingInline: 32 }}
              >
                Close Window
              </Button>
            ]}
          />
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="auth-background" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
        <Card className="glass animate-fade-in" style={{ width: '100%', maxWidth: 540, borderRadius: 20, padding: '32px 28px' }}>
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <img
              src="https://www.aapnainfotech.com/wp-content/uploads/2021/09/aapna-gptw-black.png"
              alt="AAPNA Logo"
              style={{ height: 36, objectFit: 'contain', margin: '0 auto 16px' }}
            />
            <Title level={4} style={{ color: '#c0392b', margin: 0, fontWeight: 700 }}>
              Link Inactive or Invalid
            </Title>
          </div>
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
        </Card>
      </div>
    );
  }

  const isApproveFlow = currentAction === 'approve';

  return (
    <div className="auth-background" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 16px' }}>
      <Card
        className="glass animate-fade-in"
        style={{
          width: '100%',
          maxWidth: 850,
          borderRadius: 20,
          padding: '24px 32px',
          boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.08)',
        }}
      >
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <img
            src="https://www.aapnainfotech.com/wp-content/uploads/2021/09/aapna-gptw-black.png"
            alt="AAPNA Logo"
            style={{ height: 40, objectFit: 'contain', margin: '0 auto 16px' }}
          />
          <Title level={3} style={{ margin: 0, fontWeight: 700, letterSpacing: '-0.02em' }}>
            Review Requisition Request
          </Title>
          <Text type="secondary" style={{ fontSize: 13, display: 'block', marginTop: 4 }}>
            Review details of the Manpower Requisition Form (MRF) submitted by <strong>{mrfDetails?.hiring_manager_name}</strong>.
          </Text>
        </div>

        {/* Detailed Requisition Info */}
        <div style={{ background: 'rgba(255,255,255,0.4)', borderRadius: 12, padding: 20, marginBottom: 24, border: '1px solid #e8ede0' }}>
          <Descriptions title={<span style={{ color: '#7a922e', fontSize: 16, fontWeight: 700 }}>Requisition Summary</span>} bordered column={{ xs: 1, sm: 2 }} size="small">
            <Descriptions.Item label="Position Hiring For" span={2}>
              <Text strong style={{ fontSize: 15 }}>{mrfDetails?.position_hiring_for}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="Hiring Manager">{mrfDetails?.hiring_manager_name} ({mrfDetails?.hiring_manager_designation})</Descriptions.Item>
            <Descriptions.Item label="Submitter Email">{mrfDetails?.submitter_email}</Descriptions.Item>
            <Descriptions.Item label="Number of Positions">
              <Badge count={mrfDetails?.number_of_positions} style={{ backgroundColor: '#7a922e' }} />
            </Descriptions.Item>
            <Descriptions.Item label="Required Timeline">{mrfDetails?.required_in}</Descriptions.Item>
            <Descriptions.Item label="Reports To">{mrfDetails?.position_reports_to || 'Not Specified'}</Descriptions.Item>
            <Descriptions.Item label="Employment Type">{mrfDetails?.employment_type || 'Not Specified'}</Descriptions.Item>
            <Descriptions.Item label="Experience Required">{mrfDetails?.total_years_of_experience} Years total ({mrfDetails?.relevant_years_of_experience} Years relevant)</Descriptions.Item>
            <Descriptions.Item label="Project Details">{mrfDetails?.project_name} ({mrfDetails?.project_duration})</Descriptions.Item>
            <Descriptions.Item label="Mandatory Skills" span={2}>{mrfDetails?.mandatory_skills}</Descriptions.Item>
            {mrfDetails?.good_to_have_skills && (
              <Descriptions.Item label="Good to Have Skills" span={2}>{mrfDetails?.good_to_have_skills}</Descriptions.Item>
            )}
            <Descriptions.Item label="Job Description (JD)" span={2}>
              {mrfDetails?.jd_document_link ? (
                <Button type="link" icon={<FileDoneOutlined />} href={mrfDetails.jd_document_link} target="_blank" style={{ paddingLeft: 0, fontWeight: 600, color: '#7a922e' }}>
                  View Uploaded Job Description File →
                </Button>
              ) : (
                <Text type="secondary">No JD file uploaded</Text>
              )}
            </Descriptions.Item>
          </Descriptions>
        </div>

        {/* Action Form */}
        <Divider style={{ borderColor: '#e8ede0' }} />
        
        <div style={{ marginTop: 12 }}>
          <Title level={5} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MessageOutlined style={{ color: '#7a922e' }} /> Add Review Comments (Optional)
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
                    background: '#7a922e',
                    borderColor: '#7a922e',
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

        {/* Footer */}
        <div style={{ textAlign: 'center', marginTop: 40 }}>
          <Text type="secondary" style={{ fontSize: 11, opacity: 0.6 }}>
            © {new Date().getFullYear()} AAPNA Infotech · Secure Approvals Portal
          </Text>
        </div>
      </Card>
    </div>
  );
}
