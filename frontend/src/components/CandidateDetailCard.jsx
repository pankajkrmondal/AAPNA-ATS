/**
 * CandidateDetailCard — the high-fidelity, sectioned candidate profile view shared by
 * the Candidates (search & edit) page and the Analytics page "View Candidate" modal.
 *
 * Expects a NORMALIZED candidate object (see the field names referenced below). The
 * Analytics page maps its raw rpa_cv row into this shape before rendering.
 */
import { Row, Col, Typography, Tag, Avatar, Space } from 'antd';
import { UserOutlined, EnvironmentOutlined } from '@ant-design/icons';

const { Text, Paragraph } = Typography;

const labelStyle = {
  fontSize: 10,
  fontWeight: 700,
  display: 'block',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  color: 'var(--text-2)',
  marginBottom: 2,
};

function SectionHeader({ title }) {
  return (
    <div className="cdc-section">
      <span className="cdc-section-title">{title}</span>
      <div className="cdc-section-rule" />
    </div>
  );
}

function Field({ label, children, span = 12 }) {
  return (
    <Col span={span}>
      <Text style={labelStyle}>{label}</Text>
      <Text style={{ fontSize: 13.5, color: 'var(--text)' }}>{children ?? '—'}</Text>
    </Col>
  );
}

export default function CandidateDetailCard({ candidate }) {
  if (!candidate) return null;
  const c = candidate;

  const skills = (() => {
    const s = c.top5KeySkills;
    if (!s) return [];
    if (Array.isArray(s)) return s.map((x) => String(x).trim()).filter(Boolean);
    let str = String(s).trim();
    if (str.startsWith('{') && str.endsWith('}')) str = str.slice(1, -1);
    return str.split(',').map((x) => x.trim().replace(/^"|"$/g, '').trim()).filter(Boolean);
  })();

  const companies = c.employment_history?.companies || [];

  return (
    <div className="cdc-root">
      {/* Identity header */}
      <div className="cdc-head">
        <Avatar size={52} icon={<UserOutlined />} className="cdc-avatar" />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="cdc-name">{c.name || 'Candidate'}</div>
          <div className="cdc-email">{c.email || '—'}</div>
          {(c.location || c.position) && (
            <div className="cdc-meta">
              {c.position && <Tag className="cdc-tag-role">{c.position}</Tag>}
              {c.location && (
                <span className="cdc-loc">
                  <EnvironmentOutlined /> {c.location}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Personal Information */}
      <SectionHeader title="Personal Information" />
      <Row gutter={[16, 16]}>
        <Field label="Candidate Contact Number">{c.phone}</Field>
        <Field label="Highest Qualification">{c.education}</Field>
        <Field label="Total Experience (Years)">{c.experience}</Field>
        <Field label="Last Company Experience (Years)">{c.lastCompanyExperience}</Field>
        <Field label="Current Location">{c.location}</Field>
        <Field label="Notice Period (Days)">{c.noticePeriod}</Field>
        <Field label="CTC (LPA)">{c.currentCTC}</Field>
        <Field label="Expected CTC (LPA)">{c.expectedCTC}</Field>
        <Field label="Position Applied">{c.position}</Field>
        <Field label="Job Source">{c.jobSource}</Field>
        <Field label="Recruiter Info (AAPNA)">{c.recruiterInfo}</Field>
        <Field label="English Communication Rating">{c.englishCommunicationRating}</Field>
        <Field label="Gender">{c.gender}</Field>
        <Field label="Preferred Shift">{c.preferredShift}</Field>

        <Col span={24}>
          <Text style={labelStyle}>Top 5 Key Skills</Text>
          {skills.length > 0 ? (
            <Space size={[8, 8]} wrap style={{ marginTop: 2 }}>
              {skills.map((skill, i) => (
                <Tag key={i} className="cdc-skill">{skill}</Tag>
              ))}
            </Space>
          ) : (
            <Text style={{ fontSize: 13.5, color: 'var(--text)' }}>—</Text>
          )}
        </Col>

        {c.reasonForJobChange != null && (
          <Field label="Reason For Job Change" span={24}>{c.reasonForJobChange}</Field>
        )}
        <Field label="Willing To Take Online Test?">{c.willingToTakeOnlineTest}</Field>
        <Field label="Has Laptop For Initial Days?">{c.hasLaptopForInitialDays}</Field>

        <Col span={24}>
          <div className="cdc-subcard">
            <Text style={{ ...labelStyle, marginBottom: 6 }}>Current Company</Text>
            <Row gutter={16}>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: 9, display: 'block' }}>Company Name</Text>
                <Text strong>{c.currentCompany?.Name || '—'}</Text>
              </Col>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: 9, display: 'block' }}>Website</Text>
                <Text>{c.currentCompany?.Website || '—'}</Text>
              </Col>
            </Row>
          </div>
        </Col>
      </Row>

      {/* Education */}
      <SectionHeader title="Education" />
      <Row gutter={[16, 16]}>
        <Field label="10th %" span={6}>{c.a10th}</Field>
        <Field label="12th %" span={6}>{c.a12th}</Field>
        <Field label="Graduation %" span={6}>{c.graduation}</Field>
        <Field label="Post-Graduation %" span={6}>{c.postGraduation}</Field>
        <Field label="Graduation Degree">{c.graduationdegree}</Field>
        <Field label="Graduation Specialization">{c.graduationspecialization}</Field>
        <Field label="Post-Graduation Degree">{c.postgraduationdegree}</Field>
        <Field label="Post-Graduation Specialization">{c.postgraduationspecialization}</Field>
        <Col span={24}>
          <Text style={labelStyle}>LinkedIn Profile Link</Text>
          {c.LinkedInProfile ? (
            <a href={c.LinkedInProfile} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>
              {c.LinkedInProfile}
            </a>
          ) : <Text style={{ fontSize: 13.5 }}>—</Text>}
        </Col>
      </Row>

      {/* Employment History */}
      <SectionHeader title="Employment History" />
      {companies.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {companies.map((co, i) => (
            <div key={i} className="cdc-emp">
              <div>
                <Text type="secondary" style={{ fontSize: 9, fontWeight: 600, display: 'block', textTransform: 'uppercase' }}>Company Name</Text>
                <Text strong>{co.CompanyName || '—'}</Text>
              </div>
              <div>
                <Text type="secondary" style={{ fontSize: 9, fontWeight: 600, display: 'block', textTransform: 'uppercase' }}>Start Date</Text>
                <Text>{co.StartDate || '—'}</Text>
              </div>
              <div>
                <Text type="secondary" style={{ fontSize: 9, fontWeight: 600, display: 'block', textTransform: 'uppercase' }}>End Date</Text>
                <Text>{co.EndDate || '—'}</Text>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Text type="secondary" style={{ fontSize: 13 }}>No employment history recorded.</Text>
      )}

      {/* Assessment & Interview */}
      <SectionHeader title="Assessment & Interview" />
      <Row gutter={[16, 16]}>
        <Field label="Heat">{c.Heat}</Field>
        <Field label="Final Status">{c.FinalStatus}</Field>
        <Field label="HR Quick Comments" span={24}>{c.HRQuickcomments}</Field>
        <Field label="IQ Score" span={8}>{c.IQScore}</Field>
        <Field label="Tech Score" span={8}>{c.TechScore}</Field>
        <Field label="Zeko Interview Score" span={8}>{c.ZekoInterviewScore}</Field>
        <Field label="Zeko Coding Score" span={8}>{c.ZekoCodingScore}</Field>
        <Field label="Zeko Communication Score" span={16}>{c.ZekoCommunicationScore}</Field>
        <Col span={24}>
          <Text style={labelStyle}>Tech Round One Feedback</Text>
          <Paragraph style={{ fontSize: 13, margin: 0, whiteSpace: 'pre-line' }}>{c.TechRoundOne || '—'}</Paragraph>
        </Col>
        <Col span={24}>
          <Text style={labelStyle}>Tech Round Two Feedback</Text>
          <Paragraph style={{ fontSize: 13, margin: 0, whiteSpace: 'pre-line' }}>{c.TechRoundTwo || '—'}</Paragraph>
        </Col>
        <Col span={24}>
          <Text style={labelStyle}>Tech Round Three Feedback</Text>
          <Paragraph style={{ fontSize: 13, margin: 0, whiteSpace: 'pre-line' }}>{c.TechRoundThree || '—'}</Paragraph>
        </Col>
        <Col span={24}>
          <Text style={labelStyle}>Managerial / CEO Feedback</Text>
          <Paragraph style={{ fontSize: 13, margin: 0, whiteSpace: 'pre-line' }}>{c.ManagerialOrCEOFeedback || '—'}</Paragraph>
        </Col>
        <Col span={24}>
          <Text style={labelStyle}>HR Interview</Text>
          <Paragraph style={{ fontSize: 13, margin: 0, whiteSpace: 'pre-line' }}>{c.HRInterview || '—'}</Paragraph>
        </Col>
      </Row>
    </div>
  );
}