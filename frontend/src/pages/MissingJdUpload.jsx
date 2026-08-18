import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, Form, Input, Button, Typography, Alert, Spin, Select, InputNumber, Rate, Result, Space, Upload } from 'antd';
import { SolutionOutlined, CheckCircleOutlined, ContactsOutlined, UploadOutlined } from '@ant-design/icons';
import candidateService from '../services/candidateService';
// The shared public-page frame — the same one DocumentUpload and
// InterviewScorecard use, mirroring the branded email a candidate clicks
// through from. This page previously hand-rolled its own logo header, footer
// and `auth-background` shell, which made it a third visual language on a
// surface that is supposed to feel continuous with the email.
import PublicPageShell, { BRAND } from '../components/common/PublicPageShell';

const { Title, Text, Paragraph } = Typography;

export default function MissingJdUpload() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [candidateInfo, setCandidateInfo] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [roles, setRoles] = useState([]);
  const [showCustomPosition, setShowCustomPosition] = useState(false);

  useEffect(() => {
    if (!token) {
      setError('Invalid Link: Access token is missing from the URL. Please verify the link in your email.');
      setLoading(false);
      return;
    }
    fetchMissingFields();
    fetchRoles();
  }, [token]);

  const fetchMissingFields = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await candidateService.getPublicMissingData(token);
      const data = res.data?.data || res.data;
      setCandidateInfo(data);
    } catch (err) {
      setError(err?.message || 'Failed to retrieve candidate information. The link may have expired or is invalid.');
    } finally {
      setLoading(false);
    }
  };

  const fetchRoles = async () => {
    try {
      // Public endpoint — this form is shown to logged-out candidates.
      const res = await candidateService.getPublicRoles();
      setRoles(res.data?.data || res.data || []);
    } catch (err) {
      console.warn('Failed to load open roles list:', err);
    }
  };

  const onFinish = async (values) => {
    setSubmitting(true);
    setError('');
    try {
      const finalValues = { ...values };
      if (finalValues.PositionApplied === 'Other' && finalValues.customPositionApplied) {
        finalValues.PositionApplied = finalValues.customPositionApplied;
      }
      delete finalValues.customPositionApplied;

      const file = finalValues.uploadResume?.[0]?.originFileObj || finalValues.uploadResume?.[0];
      
      let payload;
      if (file) {
        payload = new FormData();
        payload.append('uploadResume', file);
        Object.keys(finalValues).forEach(key => {
          if (key !== 'uploadResume') {
            if (key === 'CurrentCompany' && finalValues[key]) {
              payload.append(key, JSON.stringify({ Name: finalValues[key], Website: '' }));
            } else {
              payload.append(key, finalValues[key]);
            }
          }
        });
      } else {
        payload = { ...finalValues };
        if (payload.CurrentCompany) {
          payload.CurrentCompany = { Name: payload.CurrentCompany, Website: '' };
        }
      }

      await candidateService.submitPublicMissingData(token, payload);
      setSuccess(true);
    } catch (err) {
      setError(err?.message || 'Failed to update your details. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const renderFieldInput = (key) => {
    if (key === 'uploadResume') {
      return (
        <Upload
          maxCount={1}
          beforeUpload={() => false}
          accept=".pdf,.docx"
          listType="text"
        >
          <Button icon={<UploadOutlined />} style={{ width: '100%', borderRadius: 8, height: 40 }}>
            Select Resume File (.pdf, .docx)
          </Button>
        </Upload>
      );
    }

    // Dropdown mappings
    if (key === 'NoticePeriod') {
      return (
        <Select placeholder="Select your Notice Period">
          <Select.Option value="Immediate">Immediate (0 days)</Select.Option>
          <Select.Option value="15 Days">15 Days</Select.Option>
          <Select.Option value="30 Days">30 Days</Select.Option>
          <Select.Option value="45 Days">45 Days</Select.Option>
          <Select.Option value="60 Days">60 Days</Select.Option>
          <Select.Option value="90 Days">90 Days</Select.Option>
        </Select>
      );
    }

    if (key === 'Gender') {
      return (
        <Select placeholder="Select Gender">
          <Select.Option value="Male">Male</Select.Option>
          <Select.Option value="Female">Female</Select.Option>
          <Select.Option value="Other">Other</Select.Option>
        </Select>
      );
    }

    if (key === 'WillingToTakeOnlineTest') {
      return (
        <Select placeholder="Select Yes / No">
          <Select.Option value="Yes">Yes</Select.Option>
          <Select.Option value="No">No</Select.Option>
        </Select>
      );
    }

    if (key === 'HasLaptopForInitialDays') {
      return (
        <Select placeholder="Select Yes / No">
          <Select.Option value="Yes">Yes</Select.Option>
          <Select.Option value="No">No</Select.Option>
        </Select>
      );
    }

    if (key === 'PreferredShift') {
      return (
        <Select placeholder="Select Preferred Shift">
          <Select.Option value="2pm - 11pm/3pm - 12am">2:00 PM – 11:00 PM / 3:00 PM – 12:00 AM (Standard Shift)</Select.Option>
          <Select.Option value="4pm - 1am">4:00 PM – 1:00 AM (Late Shift)</Select.Option>
          <Select.Option value="Flexible">Flexible / Rotational</Select.Option>
          <Select.Option value="Others">Others</Select.Option>
        </Select>
      );
    }

    if (key === 'RecruiterInfoAAPNA') {
      return (
        <Select placeholder="Select AAPNA Recruiter Name">
          <Select.Option value="Naveen Satywali">Naveen Satywali</Select.Option>
          <Select.Option value="Chhaya Verma">Chhaya Verma</Select.Option>
          <Select.Option value="Prakash Pant">Prakash Pant</Select.Option>
          <Select.Option value="None">None</Select.Option>
        </Select>
      );
    }

    if (key === 'EnglishCommunicationRating') {
      return <Rate count={5} style={{ color: '#4a7c59' }} />;
    }

    // Number Inputs
    if (key === 'CTC_LPA' || key === 'ExpectedCTC_LPA') {
      const label = key === 'CTC_LPA' ? 'Current CTC (LPA)' : 'Expected CTC (LPA)';
      return (
        <InputNumber
          min={0}
          max={100}
          precision={2}
          step={0.5}
          placeholder={`Enter ${label} in Lakhs`}
          style={{ width: '100%' }}
        />
      );
    }

    if (key.includes('in percentage') || key.includes('%')) {
      return (
        <InputNumber
          min={0}
          max={100}
          precision={2}
          step={1}
          placeholder="Enter percentage score (e.g. 78.5)"
          style={{ width: '100%' }}
        />
      );
    }

    // Default Text Inputs
    let placeholder = `Enter your ${key.replace(/([A-Z])/g, ' $1').trim()}`;
    if (key === 'ContactNumber') placeholder = 'Enter your 10-digit mobile number';
    if (key === 'HighestQualification') placeholder = 'e.g. B.Tech in Computer Science, MCA';
    if (key === 'CurrentLocation') placeholder = 'Enter your current city';

    return <Input placeholder={placeholder} style={{ borderRadius: 8 }} />;
  };

  const formatFieldLabel = (key) => {
    // User-friendly text mapping
    const mappings = {
      'NoticePeriod': 'Notice Period',
      'ContactNumber': 'Mobile / Contact Number',
      'HighestQualification': 'Highest Qualification',
      'CurrentLocation': 'Current Location',
      'CTC_LPA': 'Current CTC (LPA)',
      'ExpectedCTC_LPA': 'Expected CTC (LPA)',
      'JobSource': 'Job Source (Where you found this job)',
      'RecruiterInfoAAPNA': 'AAPNA Recruiter Name',
      'PositionApplied': 'Position Applied For',
      'Top5KeySkills': 'Top 5 Key Skills',
      'Gender': 'Gender',
      'EnglishCommunicationRating': 'English Communication Rating',
      'graduationdegree': 'Graduation Degree',
      'graduationspecialization': 'Graduation Specialization',
      'postgraduationdegree': 'Post Graduation Degree',
      'postgraduationspecialization': 'Post Graduation Specialization',
      '10th (in percentage)': 'Class 10th Score (%)',
      '12th (in percentage)': 'Class 12th Score (%)',
      'Graduation (in percentage)': 'Graduation Score (%)',
      'PostGraduation (in percentage)': 'Post Graduation Score (%)'
    };

    return mappings[key] || key.replace(/([A-Z])/g, ' $1').trim();
  };

  // 1. Loading State
  if (loading) {
    return (
      <PublicPageShell title="Complete your profile" subtitle="Loading your profile session…">
        <div style={{ textAlign: 'center', padding: '32px 0' }}><Spin size="large" /></div>
      </PublicPageShell>
    );
  }

  // 2. Success State
  if (success) {
    return (
      <PublicPageShell
        title="Profile updated"
        subtitle="Thank you — we have everything we need."
      >
        <Result
          status="success"
          title={<span style={{ fontWeight: 700 }}>Profile Updated Successfully!</span>}
          subTitle={
            <Paragraph style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
              Thank you, <strong>{candidateInfo?.Name || 'Candidate'}</strong>. Your missing profile details have been received and logged. Your application is now marked active.
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

  // 3. Error State
  if (error) {
    return (
      <PublicPageShell
        title="Link inactive or invalid"
        subtitle="We could not open your profile from this link."
      >
        <Alert
          message="Error Accessing Page"
          description={error}
          type="error"
          showIcon
          style={{ borderRadius: 10, marginBottom: 20 }}
        />
        <Paragraph type="secondary" style={{ textAlign: 'center', fontSize: 12 }}>
          If you need assistance, please contact the AAPNA HR Team at support@aapnainfotech.com.
        </Paragraph>
      </PublicPageShell>
    );
  }

  // 4. Form State (when candidateInfo & missingFields exist)
  const missingKeys = Object.keys(candidateInfo?.missingFields || {});

  // Early return if the profile is already complete
  if (missingKeys.length === 0) {
    return (
      <PublicPageShell
        title="Nothing left to fill in"
        subtitle="Your profile is already complete."
      >
        <Result
          status="info"
          title={<span style={{ fontWeight: 700 }}>Profile Already Complete</span>}
          subTitle={
            <Paragraph style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
              Hi <strong>{candidateInfo?.Name || 'Candidate'}</strong>, your profile information is fully complete. No further action is required from you.
            </Paragraph>
          }
          extra={[
            <Button
              key="close"
              type="primary"
              onClick={() => window.close()}
              style={{ height: 44, borderRadius: 8, background: BRAND.accent, border: 'none', fontWeight: 600, paddingInline: 32 }}
            >
              Close
            </Button>
          ]}
        />
      </PublicPageShell>
    );
  }

  return (
    <PublicPageShell
      maxWidth={620}
      title="Complete Your Profile"
      subtitle={`Hi ${candidateInfo?.Name || 'there'} — please fill in the missing details below so we can process your application.`}
    >
        <Form
          name="missing-jd"
          layout="vertical"
          onFinish={onFinish}
          size="large"
          requiredMark={true}
        >
          {missingKeys.map((key) => {
            const isUpload = key === 'uploadResume';
            
            if (key === 'PositionApplied') {
              return (
                <div key={key} style={{ marginBottom: 18 }}>
                  <Form.Item
                    name="PositionApplied"
                    label={
                      <span style={{ fontWeight: 600, color: '#374151', fontSize: 13 }}>
                        {formatFieldLabel(key)}
                      </span>
                    }
                    rules={[{ required: true, message: `Please select your ${formatFieldLabel(key)}` }]}
                    style={{ marginBottom: showCustomPosition ? 10 : 0 }}
                  >
                    <Select
                      placeholder="Select Position Applied For"
                      style={{ width: '100%' }}
                      onChange={(val) => {
                        setShowCustomPosition(val === 'Other');
                      }}
                    >
                      {roles.map((r) => (
                        <Select.Option key={r.id} value={r.role}>
                          {r.role}
                        </Select.Option>
                      ))}
                      <Select.Option value="Other">Other (Please Specify)</Select.Option>
                    </Select>
                  </Form.Item>
                  {showCustomPosition && (
                    <Form.Item
                      name="customPositionApplied"
                      rules={[{ required: true, message: 'Please specify the position.' }]}
                      style={{ marginBottom: 0 }}
                    >
                      <Input placeholder="Specify custom position" style={{ borderRadius: 8 }} />
                    </Form.Item>
                  )}
                </div>
              );
            }

            return (
              <Form.Item
                key={key}
                name={key}
                label={
                  <span style={{ fontWeight: 600, color: '#374151', fontSize: 13 }}>
                    {formatFieldLabel(key)}
                    {key === 'EnglishCommunicationRating' && (
                      <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--text-secondary)', marginLeft: 8 }}>
                        (1: Poor, 5: Fluent)
                      </span>
                    )}
                  </span>
                }
                rules={[{ required: true, message: isUpload ? 'Please upload your resume file.' : `Please enter your ${formatFieldLabel(key)}` }]}
                valuePropName={isUpload ? 'fileList' : undefined}
                getValueFromEvent={isUpload ? (e) => {
                  if (Array.isArray(e)) return e;
                  return e && e.fileList;
                } : undefined}
                style={{ marginBottom: 18 }}
              >
                {renderFieldInput(key)}
              </Form.Item>
            );
          })}

          <Form.Item style={{ marginTop: 28, marginBottom: 0 }}>
            <Button
              type="primary"
              htmlType="submit"
              loading={submitting}
              block
              style={{
                height: 48,
                borderRadius: 10,
                fontWeight: 600,
                fontSize: 15,
                background: BRAND.accent,
                borderColor: BRAND.accent
              }}
            >
              Submit Profile Details
            </Button>
          </Form.Item>
        </Form>
      {/* The hand-rolled copyright line is gone: PublicPageShell renders the
          same footer the branded email does, so this page had two. */}
    </PublicPageShell>
  );
}
