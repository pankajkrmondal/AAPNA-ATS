/**
 * The candidate's own "Complete your profile" form, opened from the
 * missing-details email without a login.
 *
 * Phase 3 "Do Now", N18: a short version of the recruiter Edit form on
 * Candidates. It shows only the fields missing for this candidate, in the Edit
 * form's order, with the same labels, lists and rules
 * (constants/candidateFields.js). The server checks the rules again.
 */
import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Form, Input, Button, Typography, Alert, Spin, Select, Result, Upload, AutoComplete } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import candidateService from '../services/candidateService';
// The shared public-page frame — the same one DocumentUpload and
// InterviewScorecard use, mirroring the branded email a candidate clicks
// through from.
import PublicPageShell, { BRAND } from '../components/common/PublicPageShell';
import {
  QUALIFICATION_OPTIONS, QUALIFICATION_OTHER, NOTICE_PERIOD_OPTIONS, SHIFT_OPTIONS, ENGLISH_RATING_OPTIONS,
  RECRUITER_NONE, phoneRule, experienceRule, notMoreThanTotalRule, ctcRule, percentRule,
} from '../constants/candidateFields';

const { Paragraph } = Typography;

/** "Other (please specify)" in the Position list. */
const POSITION_OTHER = 'Other (please specify)';

/**
 * Every field the form can ask for, in the recruiter Edit form's order, with
 * that form's label (sentence case here). Keys are the missing-data keys the
 * server uses. Unknown keys go after these, the resume always last.
 */
const FIELDS = [
  { key: 'ContactNumber', label: 'Candidate contact number', hint: 'Enter a 10-digit mobile number (e.g. 98765 43210 or +91 98765 43210).' },
  { key: 'HighestQualification', label: 'Highest qualification' },
  { key: 'TotalExperienceYears', label: 'Total experience (years)' },
  { key: 'LastCompanyExperienceYears', label: 'Last company experience (years)', hint: 'Cannot be more than total experience.' },
  { key: 'CurrentLocation', label: 'Current location' },
  { key: 'CTC_LPA', label: 'CTC (LPA)', hint: 'In lakhs per year, 0 to 200.' },
  { key: 'ExpectedCTC_LPA', label: 'Expected CTC (LPA)', hint: 'In lakhs per year, 0 to 200.' },
  { key: 'NoticePeriod', label: 'Notice period' },
  { key: 'PositionApplied', label: 'Position applied', hint: `Type to search open roles, or choose "${POSITION_OTHER}".` },
  { key: 'JobSource', label: 'Job source' },
  { key: 'RecruiterInfoAAPNA', label: 'Recruiter info (AAPNA)', hint: 'From the active recruiter accounts in the ATS.' },
  { key: 'EnglishCommunicationRating', label: 'English communication rating', hint: '1 = basic, 5 = fluent.' },
  { key: 'Top5KeySkills', label: 'Top 5 key skills' },
  { key: 'Gender', label: 'Gender' },
  { key: 'PreferredShift', label: 'Preferred shift' },
  { key: 'ReasonForJobChange', label: 'Reason for job change' },
  { key: 'WillingToTakeOnlineTest', label: 'Willing to take online test?' },
  { key: 'HasLaptopForInitialDays', label: 'Has laptop for initial days?' },
  { key: 'CurrentCompany', label: 'Current company' },
  { key: '10th (in percentage)', label: '10th percentage', hint: '0 to 100.' },
  { key: '12th (in percentage)', label: '12th percentage', hint: '0 to 100.' },
  { key: 'Graduation (in percentage)', label: 'Graduation percentage', hint: '0 to 100.' },
  { key: 'PostGraduation (in percentage)', label: 'Post graduation percentage', hint: '0 to 100.' },
  { key: 'graduationdegree', label: 'Graduation degree' },
  { key: 'graduationspecialization', label: 'Graduation specialization' },
  { key: 'postgraduationdegree', label: 'Post graduation degree' },
  { key: 'postgraduationspecialization', label: 'Post graduation specialization' },
  { key: 'LinkedInProfile', label: 'LinkedIn profile link' },
  { key: 'uploadResume', label: 'Upload resume' },
];
const FIELD_BY_KEY = Object.fromEntries(FIELDS.map((f, i) => [f.key, { ...f, order: i }]));

/** Field rules beyond "required", by key. */
const RULES = {
  ContactNumber: [phoneRule],
  TotalExperienceYears: [experienceRule('Total experience')],
  LastCompanyExperienceYears: [experienceRule('Last company experience'), notMoreThanTotalRule('TotalExperienceYears')],
  CTC_LPA: [ctcRule('CTC (LPA)')],
  ExpectedCTC_LPA: [ctcRule('Expected CTC (LPA)')],
  '10th (in percentage)': [percentRule('10th percentage')],
  '12th (in percentage)': [percentRule('12th percentage')],
  'Graduation (in percentage)': [percentRule('Graduation percentage')],
  'PostGraduation (in percentage)': [percentRule('Post graduation percentage')],
};

const NUMBER_KEYS = new Set(['TotalExperienceYears', 'LastCompanyExperienceYears', 'CTC_LPA', 'ExpectedCTC_LPA',
  '10th (in percentage)', '12th (in percentage)', 'Graduation (in percentage)', 'PostGraduation (in percentage)']);

/** "PostGraduationScore" -> "Post graduation score", for a key the list above does not know. */
const labelFromKey = (key) => {
  const words = key.replace(/([a-z])([A-Z])/g, '$1 $2').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const yesNo = [{ value: 'Yes', label: 'Yes' }, { value: 'No', label: 'No' }];

export default function MissingJdUpload() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [form] = Form.useForm();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [candidateInfo, setCandidateInfo] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [roles, setRoles] = useState([]);
  const [cities, setCities] = useState([]);
  const [recruiters, setRecruiters] = useState([]);

  const position = Form.useWatch('PositionApplied', form);
  const qualification = Form.useWatch('HighestQualification', form);

  useEffect(() => {
    if (!token) {
      setError('Invalid Link: Access token is missing from the URL. Please verify the link in your email.');
      setLoading(false);
      return;
    }
    fetchMissingFields();
    // Public endpoints — this form is shown to logged-out candidates. A list
    // that fails to load leaves its field as plain typing, never blocks the form.
    candidateService.getPublicRoles().then((res) => setRoles(res.data?.data || res.data || [])).catch(() => {});
    candidateService.getPublicLocations().then((res) => setCities(res.data?.data || [])).catch(() => {});
    candidateService.getPublicRecruiters().then((res) => setRecruiters(res.data?.data || [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const cityOptions = useMemo(() => cities.map((c) => ({ value: c })), [cities]);
  const roleOptions = useMemo(
    () => [...roles.map((r) => ({ value: r.role, label: r.role })), { value: POSITION_OTHER, label: POSITION_OTHER }],
    [roles],
  );

  const onFinish = async (values) => {
    setSubmitting(true);
    setError('');
    try {
      const finalValues = { ...values };
      if (finalValues.PositionApplied === POSITION_OTHER) {
        finalValues.PositionApplied = (finalValues.customPositionApplied || '').trim();
      }
      if (finalValues.HighestQualification === QUALIFICATION_OTHER) {
        finalValues.HighestQualification = (finalValues.customQualification || '').trim();
      }
      delete finalValues.customPositionApplied;
      delete finalValues.customQualification;
      for (const k of NUMBER_KEYS) {
        if (typeof finalValues[k] === 'string') finalValues[k] = finalValues[k].trim();
      }

      const file = finalValues.uploadResume?.[0]?.originFileObj || finalValues.uploadResume?.[0];

      let payload;
      if (file) {
        payload = new FormData();
        payload.append('uploadResume', file);
        Object.keys(finalValues).forEach((key) => {
          if (key === 'uploadResume' || finalValues[key] === undefined) return;
          if (key === 'CurrentCompany' && finalValues[key]) {
            payload.append(key, JSON.stringify({ Name: finalValues[key], Website: '' }));
          } else {
            payload.append(key, finalValues[key]);
          }
        });
      } else {
        payload = { ...finalValues };
        delete payload.uploadResume;
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
        <Upload maxCount={1} beforeUpload={() => false} accept=".pdf,.docx" listType="text">
          <Button icon={<UploadOutlined />} style={{ width: '100%', borderRadius: 8, height: 40 }}>
            Select resume (PDF or Word .docx)
          </Button>
        </Upload>
      );
    }
    if (key === 'HighestQualification') {
      return <Select placeholder="Select" showSearch options={QUALIFICATION_OPTIONS.map((q) => ({ value: q, label: q }))} />;
    }
    if (key === 'NoticePeriod') {
      return <Select placeholder="Select" options={NOTICE_PERIOD_OPTIONS.map((n) => ({ value: n, label: n }))} />;
    }
    if (key === 'PositionApplied') {
      return <Select placeholder="Type to search" showSearch optionFilterProp="label" options={roleOptions} />;
    }
    if (key === 'RecruiterInfoAAPNA') {
      return (
        <Select
          placeholder="Select"
          showSearch
          options={[...recruiters, RECRUITER_NONE].map((r) => ({ value: r, label: r }))}
        />
      );
    }
    if (key === 'EnglishCommunicationRating') {
      return <Select placeholder="Select" options={ENGLISH_RATING_OPTIONS.map((n) => ({ value: n, label: String(n) }))} />;
    }
    if (key === 'PreferredShift') {
      return <Select placeholder="Select" options={SHIFT_OPTIONS.map((s) => ({ value: s, label: s }))} />;
    }
    if (key === 'Gender') {
      return <Select placeholder="Select" options={[{ value: 'Male', label: 'Male' }, { value: 'Female', label: 'Female' }, { value: 'Other', label: 'Other' }]} />;
    }
    if (key === 'WillingToTakeOnlineTest' || key === 'HasLaptopForInitialDays') {
      return <Select placeholder="Select" options={yesNo} />;
    }
    if (key === 'CurrentLocation') {
      return (
        <AutoComplete
          options={cityOptions}
          filterOption={(input, option) => String(option?.value ?? '').toLowerCase().includes(String(input || '').toLowerCase())}
          placeholder="Your current city"
        />
      );
    }
    if (key === 'Top5KeySkills' || key === 'ReasonForJobChange') {
      return <Input.TextArea rows={2} style={{ borderRadius: 8 }} />;
    }
    if (NUMBER_KEYS.has(key)) {
      return <Input inputMode="decimal" style={{ borderRadius: 8 }} />;
    }
    return <Input style={{ borderRadius: 8 }} />;
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

  // 3. Error State. A submit refused by the server's field rules keeps the
  // form open (below) instead, so the candidate can correct the value.
  if (error && !candidateInfo) {
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
  const missingKeys = Object.keys(candidateInfo?.missingFields || {})
    .map((key, i) => ({ key, order: FIELD_BY_KEY[key]?.order ?? FIELDS.length - 1 + (i + 1) / 1000 }))
    .sort((a, b) => a.order - b.order)
    .map((x) => x.key);
  // The resume is always the last thing asked for.
  if (missingKeys.includes('uploadResume')) {
    missingKeys.splice(missingKeys.indexOf('uploadResume'), 1);
    missingKeys.push('uploadResume');
  }

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

  const labelOf = (key) => FIELD_BY_KEY[key]?.label || labelFromKey(key);
  const fieldLabel = (key) => <span style={{ fontWeight: 600, color: '#374151', fontSize: 13 }}>{labelOf(key)}</span>;
  const fieldHint = (key) => (FIELD_BY_KEY[key]?.hint ? <span style={{ fontSize: 12 }}>{FIELD_BY_KEY[key].hint}</span> : undefined);

  return (
    <PublicPageShell
      maxWidth={640}
      title="Complete your profile"
      subtitle={`Hi ${candidateInfo?.Name || 'there'}, a few details are missing from your application. It takes about 2 minutes.`}
    >
      {error && (
        <Alert type="error" showIcon message={error} style={{ borderRadius: 10, marginBottom: 20 }} />
      )}
      <Form
        form={form}
        name="missing-jd"
        layout="vertical"
        onFinish={onFinish}
        size="large"
        requiredMark
      >
        {missingKeys.map((key) => {
          const isUpload = key === 'uploadResume';
          const required = {
            required: true,
            whitespace: !isUpload,
            message: isUpload ? 'Please upload your resume file.' : `${labelOf(key)} is required.`,
          };
          return (
            <div key={key}>
              <Form.Item
                name={key}
                label={fieldLabel(key)}
                extra={fieldHint(key)}
                rules={[required, ...(RULES[key] || [])]}
                dependencies={key === 'LastCompanyExperienceYears' ? ['TotalExperienceYears'] : undefined}
                valuePropName={isUpload ? 'fileList' : undefined}
                getValueFromEvent={isUpload ? (e) => (Array.isArray(e) ? e : e && e.fileList) : undefined}
                style={{ marginBottom: 18 }}
              >
                {renderFieldInput(key)}
              </Form.Item>
              {key === 'PositionApplied' && position === POSITION_OTHER && (
                <Form.Item
                  name="customPositionApplied"
                  label={fieldLabel('Position')}
                  rules={[{ required: true, whitespace: true, message: 'Please specify the position.' }]}
                  style={{ marginBottom: 18 }}
                >
                  <Input placeholder="The position you applied for" style={{ borderRadius: 8 }} />
                </Form.Item>
              )}
              {key === 'HighestQualification' && qualification === QUALIFICATION_OTHER && (
                <Form.Item
                  name="customQualification"
                  label={fieldLabel('Qualification')}
                  rules={[{ required: true, whitespace: true, message: 'Please specify your qualification.' }]}
                  style={{ marginBottom: 18 }}
                >
                  <Input placeholder="Your highest qualification" style={{ borderRadius: 8 }} />
                </Form.Item>
              )}
            </div>
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
            Submit details
          </Button>
        </Form.Item>
      </Form>
      {/* The hand-rolled copyright line is gone: PublicPageShell renders the
          same footer the branded email does, so this page had two. */}
    </PublicPageShell>
  );
}
