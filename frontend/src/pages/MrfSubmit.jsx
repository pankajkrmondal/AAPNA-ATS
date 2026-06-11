import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, Form, Input, Button, Typography, Alert, Spin, Select, InputNumber, DatePicker, Result, Space, Upload, Row, Col, Divider, Modal, message } from 'antd';
import { UploadOutlined, FileTextOutlined, SendOutlined, RedoOutlined } from '@ant-design/icons';
import mrfService from '../services/mrfService';
import dayjs from 'dayjs';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

export default function MrfSubmit() {
  const [searchParams] = useSearchParams();
  const roleParam = searchParams.get('role') || '';
  const emailParam = searchParams.get('emailid') || '';
  const parentIdParam = searchParams.get('id') || '';

  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [prefilling, setPrefilling] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  
  // Watch fields to dynamically show conditional sections
  const replacementRole = Form.useWatch('replacement_or_new_role', form);
  const resourceAllocation = Form.useWatch('existing_resource_allocation', form);

  useEffect(() => {
    // Set initial values from query parameters
    form.setFieldsValue({
      position_hiring_for: roleParam,
      submitter_email: emailParam,
      date_of_request: dayjs(),
    });
  }, [roleParam, emailParam]);

  const handlePrefill = async () => {
    const email = form.getFieldValue('submitter_email');
    if (!email) {
      message.warning('Please enter your Submitter Email to look up previous requisitions.');
      return;
    }

    setPrefilling(true);
    try {
      const res = await mrfService.getPrefillOptions(email);
      const data = res?.data || res;
      if (!data) {
        message.info('No previous requisitions found for this email address.');
        return;
      }

      // Populate form with retrieved fields, keeping current query parameters if any
      form.setFieldsValue({
        hiring_manager_name: data.hiring_manager_name,
        hiring_manager_designation: data.hiring_manager_designation,
        required_in: data.required_in,
        position_hiring_for: roleParam || data.position_hiring_for,
        number_of_positions: data.number_of_positions,
        position_reports_to: data.position_reports_to,
        requirement_for_team: data.requirement_for_team,
        requirement_for_team_other: data.requirement_for_team_other,
        desired_qualification: data.desired_qualification,
        pg_information: data.pg_information,
        graduate_other_information: data.graduate_other_information,
        other_qualification_more_info: data.other_qualification_more_info,
        replacement_or_new_role: data.replacement_or_new_role,
        replacement_comments: data.replacement_comments,
        total_years_of_experience: data.total_years_of_experience,
        relevant_years_of_experience: data.relevant_years_of_experience,
        project_name: data.project_name,
        project_duration: data.project_duration,
        employment_type: data.employment_type,
        existing_resource_allocation: data.existing_resource_allocation ? 'true' : 'false',
        existing_resource_information: data.existing_resource_information,
        roles_responsibilities: data.roles_responsibilities,
        roles_responsibilities_other: data.roles_responsibilities_other,
        mandatory_skills: data.mandatory_skills,
        good_to_have_skills: data.good_to_have_skills,
        first_technical_round: data.first_technical_round,
        second_technical_round: data.second_technical_round,
        ceo_management_round: data.ceo_management_round,
        ceo_panel_details: data.ceo_panel_details,
        hr_round: data.hr_round,
        client_round: data.client_round,
        client_round_coordinator: data.client_round_coordinator,
        job_timing: data.job_timing,
        first_round_interview_slot: data.first_round_interview_slot,
        second_round_interview_slot: data.second_round_interview_slot,
        weekly_meeting_slot: data.weekly_meeting_slot,
        client_details: data.client_details,
        additional_information: data.additional_information,
        competencies_required: data.competencies_required,
        question_paper_new_owner: data.question_paper_new_owner,
      });
      message.success('Form prefilled with details from your last requisition!');
    } catch (err) {
      logger.error('Failed to prefill form:', err);
      message.error('Error prefilling options. Please enter details manually.');
    } finally {
      setPrefilling(false);
    }
  };

  const onFinish = async (values) => {
    setSubmitting(true);
    setError('');
    try {
      const formData = new FormData();
      
      // Append files
      if (values.attach_jd?.[0]?.originFileObj) {
        formData.append('attach_jd', values.attach_jd[0].originFileObj);
      }
      if (values.attach_online_test_paper?.[0]?.originFileObj) {
        formData.append('attach_online_test_paper', values.attach_online_test_paper[0].originFileObj);
      }

      // Append all other fields
      Object.keys(values).forEach((key) => {
        if (key !== 'attach_jd' && key !== 'attach_online_test_paper') {
          if (values[key] !== undefined && values[key] !== null) {
            if (key === 'date_of_request') {
              formData.append(key, values[key].toISOString());
            } else {
              formData.append(key, values[key]);
            }
          }
        }
      });

      // Pass parent_id if present from URL query string
      if (parentIdParam) {
        formData.append('parent_id', parentIdParam);
      }

      await mrfService.submitHiringManagerMrf(formData);
      setSuccess(true);
    } catch (err) {
      setError(err?.message || 'Failed to submit form. Please check your inputs and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="auth-background" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
        <Card className="glass animate-fade-in" style={{ width: '100%', maxWidth: 650, borderRadius: 20, padding: 24, boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.08)' }}>
          <Result
            status="success"
            title={<span style={{ fontWeight: 700 }}>Manpower Requisition Submitted!</span>}
            subTitle={
              <Paragraph style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
                Thank you. The manpower requisition request has been successfully saved and routed to Management (Abhijit Roy & Sanghamitra Roy) for review.
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

  return (
    <div className="auth-background" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 16px' }}>
      <Card
        className="glass animate-fade-in"
        style={{
          width: '100%',
          maxWidth: 960,
          borderRadius: 20,
          padding: '24px 32px',
          boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.08)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
          <div>
            <img
              src="https://www.aapnainfotech.com/wp-content/uploads/2021/09/aapna-gptw-black.png"
              alt="AAPNA Logo"
              style={{ height: 38, objectFit: 'contain', marginBottom: 12 }}
            />
            <Title level={3} style={{ margin: 0, fontWeight: 700, letterSpacing: '-0.02em' }}>
              Manpower Requisition Form (MRF)
            </Title>
            <Text type="secondary" style={{ fontSize: 13, display: 'block', marginTop: 4 }}>
              Fill out the form below to request additional resources. You can pre-fill details using past requisition records.
            </Text>
          </div>
          <Button
            type="dashed"
            icon={<RedoOutlined spin={prefilling} />}
            onClick={handlePrefill}
            style={{ borderRadius: 8, height: 40, marginTop: 12 }}
          >
            Prefill from Last Requisition
          </Button>
        </div>

        {error && <Alert message="Submission Error" description={error} type="error" showIcon closable style={{ marginBottom: 20, borderRadius: 8 }} />}

        <Form
          form={form}
          name="mrf-submission"
          layout="vertical"
          onFinish={onFinish}
          size="large"
          requiredMark={true}
        >
          {/* Section 1: Request Details */}
          <Divider orientation="left" style={{ borderColor: '#e8ede0' }}><span style={{ color: '#7a922e', fontWeight: 700 }}>1. Request Details</span></Divider>
          <Row gutter={24}>
            <Col xs={24} sm={12}>
              <Form.Item
                name="submitter_email"
                label={<span style={{ fontWeight: 600 }}>Submitter Email</span>}
                rules={[{ required: true, type: 'email', message: 'Please enter a valid submitter email.' }]}
              >
                <Input placeholder="e.g. manager@aapnainfotech.com" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="hiring_manager_name"
                label={<span style={{ fontWeight: 600 }}>Hiring Manager Name</span>}
                rules={[{ required: true, message: 'Hiring Manager name is required.' }]}
              >
                <Input placeholder="Enter your full name" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="hiring_manager_designation"
                label={<span style={{ fontWeight: 600 }}>Hiring Manager Designation</span>}
                rules={[{ required: true, message: 'Hiring Manager designation is required.' }]}
              >
                <Input placeholder="e.g. Delivery Head, Tech Lead" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="date_of_request"
                label={<span style={{ fontWeight: 600 }}>Date of Request</span>}
                rules={[{ required: true, message: 'Request date is required.' }]}
              >
                <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
              </Form.Item>
            </Col>
          </Row>

          {/* Section 2: Role Requirements */}
          <Divider orientation="left" style={{ borderColor: '#e8ede0' }}><span style={{ color: '#7a922e', fontWeight: 700 }}>2. Role Requirements</span></Divider>
          <Row gutter={24}>
            <Col xs={24} sm={12}>
              <Form.Item
                name="position_hiring_for"
                label={<span style={{ fontWeight: 600 }}>Position Hiring For</span>}
                rules={[{ required: true, message: 'Role position name is required.' }]}
              >
                <Input placeholder="e.g. Nodejs Developer" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="number_of_positions"
                label={<span style={{ fontWeight: 600 }}>Number of Positions</span>}
                rules={[{ required: true, message: 'Please specify the number of positions.' }]}
              >
                <InputNumber min={1} max={50} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="required_in"
                label={<span style={{ fontWeight: 600 }}>Required In (Timeline)</span>}
                rules={[{ required: true, message: 'Please specify the timeline.' }]}
              >
                <Select placeholder="Select required timeline">
                  <Select.Option value="Immediate">Immediate (0-15 days)</Select.Option>
                  <Select.Option value="30 Days">30 Days</Select.Option>
                  <Select.Option value="45 Days">45 Days</Select.Option>
                  <Select.Option value="60 Days">60 Days</Select.Option>
                  <Select.Option value="90 Days">90 Days</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="position_reports_to"
                label={<span style={{ fontWeight: 600 }}>Position Reports To</span>}
                rules={[{ required: true, message: 'Please specify reporting manager designation.' }]}
              >
                <Input placeholder="e.g. Project Manager, Delivery Head" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="requirement_for_team"
                label={<span style={{ fontWeight: 600 }}>Requirement for Team</span>}
                rules={[{ required: true, message: 'Please select team requirement reason.' }]}
              >
                <Select placeholder="Select team reason">
                  <Select.Option value="Growth / Expansion">Growth / Expansion</Select.Option>
                  <Select.Option value="Replacement">Replacement</Select.Option>
                  <Select.Option value="New Project">New Project Win</Select.Option>
                  <Select.Option value="Other">Other</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="requirement_for_team_other"
                label={<span style={{ fontWeight: 600 }}>Requirement Team Detail (If Other)</span>}
              >
                <Input placeholder="Enter details about team structure/project win" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="replacement_or_new_role"
                label={<span style={{ fontWeight: 600 }}>Replacement or New Role?</span>}
                rules={[{ required: true, message: 'Please select role type.' }]}
              >
                <Select placeholder="Select role category">
                  <Select.Option value="New Role">New Role</Select.Option>
                  <Select.Option value="Replacement">Replacement</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="employment_type"
                label={<span style={{ fontWeight: 600 }}>Employment Type</span>}
                rules={[{ required: true, message: 'Please select employment type.' }]}
              >
                <Select placeholder="Select type">
                  <Select.Option value="Permanent">Permanent (FTE)</Select.Option>
                  <Select.Option value="Contractual">Contractual</Select.Option>
                  <Select.Option value="Internship">Internship</Select.Option>
                  <Select.Option value="Other">Other</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            {replacementRole === 'Replacement' && (
              <Col xs={24}>
                <Form.Item
                  name="replacement_comments"
                  label={<span style={{ fontWeight: 600 }}>Replacement Comments</span>}
                  rules={[{ required: true, message: 'Please clarify who is being replaced.' }]}
                >
                  <TextArea placeholder="Provide name of exiting resource and exit date" autoSize={{ minRows: 2, maxRows: 4 }} />
                </Form.Item>
              </Col>
            )}
          </Row>

          {/* Section 3: Qualifications & Experience */}
          <Divider orientation="left" style={{ borderColor: '#e8ede0' }}><span style={{ color: '#7a922e', fontWeight: 700 }}>3. Qualifications & Experience</span></Divider>
          <Row gutter={24}>
            <Col xs={24} sm={12}>
              <Form.Item
                name="total_years_of_experience"
                label={<span style={{ fontWeight: 600 }}>Total Experience Required (Years)</span>}
                rules={[{ required: true, message: 'Please specify total years.' }]}
              >
                <InputNumber min={0} max={30} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="relevant_years_of_experience"
                label={<span style={{ fontWeight: 600 }}>Relevant Experience Required (Years)</span>}
                rules={[{ required: true, message: 'Please specify relevant years.' }]}
              >
                <InputNumber min={0} max={30} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="desired_qualification"
                label={<span style={{ fontWeight: 600 }}>Desired Qualification</span>}
                rules={[{ required: true, message: 'Qualification level is required.' }]}
              >
                <Select placeholder="Select desired degree">
                  <Select.Option value="B.Tech/BE">B.Tech / B.E.</Select.Option>
                  <Select.Option value="MCA">M.C.A.</Select.Option>
                  <Select.Option value="BCA">B.C.A.</Select.Option>
                  <Select.Option value="Graduate (Any)">Graduate (Any)</Select.Option>
                  <Select.Option value="Post-Graduate (Any)">Post-Graduate (Any)</Select.Option>
                  <Select.Option value="Other">Other</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="other_qualification_more_info"
                label={<span style={{ fontWeight: 600 }}>Other Qualification Info (If applicable)</span>}
              >
                <Input placeholder="e.g. BSc in CS, Diploma" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="pg_information"
                label={<span style={{ fontWeight: 600 }}>Post Graduation Information</span>}
              >
                <Input placeholder="Preferred post-grad details if any" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="graduate_other_information"
                label={<span style={{ fontWeight: 600 }}>Graduation Other Information</span>}
              >
                <Input placeholder="Additional graduation specialization info" />
              </Form.Item>
            </Col>
          </Row>

          {/* Section 4: Skills, JD File & Responsibilities */}
          <Divider orientation="left" style={{ borderColor: '#e8ede0' }}><span style={{ color: '#7a922e', fontWeight: 700 }}>4. Skills, JD File & Responsibilities</span></Divider>
          <Row gutter={24}>
            <Col xs={24}>
              <Form.Item
                name="attach_jd"
                label={<span style={{ fontWeight: 600, color: '#374151' }}>Upload Job Description (JD) File</span>}
                valuePropName="fileList"
                getValueFromEvent={(e) => {
                  if (Array.isArray(e)) return e;
                  return e && e.fileList;
                }}
                rules={[{ required: true, message: 'Please upload the Job Description file.' }]}
              >
                <Upload maxCount={1} beforeUpload={() => false} accept=".pdf,.docx">
                  <Button icon={<UploadOutlined />} style={{ height: 44, borderRadius: 8 }}>
                    Select JD File (.pdf, .docx)
                  </Button>
                </Upload>
              </Form.Item>
            </Col>
            <Col xs={24}>
              <Form.Item
                name="mandatory_skills"
                label={<span style={{ fontWeight: 600 }}>Mandatory Skills</span>}
                rules={[{ required: true, message: 'Please specify key mandatory skills.' }]}
              >
                <TextArea placeholder="Comma separated list of required tech skills (e.g. Javascript, Node.js, Express, Postgres)" autoSize={{ minRows: 2, maxRows: 4 }} />
              </Form.Item>
            </Col>
            <Col xs={24}>
              <Form.Item
                name="good_to_have_skills"
                label={<span style={{ fontWeight: 600 }}>Good To Have Skills</span>}
              >
                <TextArea placeholder="Optional or preferred skills (e.g. AWS, Docker, Kubernetes)" autoSize={{ minRows: 2, maxRows: 4 }} />
              </Form.Item>
            </Col>
            <Col xs={24}>
              <Form.Item
                name="roles_responsibilities"
                label={<span style={{ fontWeight: 600 }}>Roles & Responsibilities</span>}
                rules={[{ required: true, message: 'Roles & Responsibilities details are required.' }]}
              >
                <TextArea placeholder="Summarize main duties and responsibilities of the hire" autoSize={{ minRows: 3, maxRows: 6 }} />
              </Form.Item>
            </Col>
            <Col xs={24}>
              <Form.Item
                name="roles_responsibilities_other"
                label={<span style={{ fontWeight: 600 }}>Roles & Responsibilities (Additional Comments)</span>}
              >
                <TextArea placeholder="Any other specific project role requirements" autoSize={{ minRows: 2, maxRows: 4 }} />
              </Form.Item>
            </Col>
          </Row>

          {/* Section 5: Interview Process & Test Paper */}
          <Divider orientation="left" style={{ borderColor: '#e8ede0' }}><span style={{ color: '#7a922e', fontWeight: 700 }}>5. Interview Process & Online Test</span></Divider>
          <Row gutter={24}>
            <Col xs={24}>
              <Form.Item
                name="attach_online_test_paper"
                label={<span style={{ fontWeight: 600 }}>Upload Online Test Paper (If applicable)</span>}
                valuePropName="fileList"
                getValueFromEvent={(e) => {
                  if (Array.isArray(e)) return e;
                  return e && e.fileList;
                }}
              >
                <Upload maxCount={1} beforeUpload={() => false} accept=".pdf,.docx">
                  <Button icon={<UploadOutlined />} style={{ height: 44, borderRadius: 8 }}>
                    Select Test Paper File (.pdf, .docx)
                  </Button>
                </Upload>
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="question_paper_new_owner"
                label={<span style={{ fontWeight: 600 }}>Test Paper Owner / Coordinator</span>}
              >
                <Input placeholder="Enter coordinator email or name" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="first_technical_round"
                label={<span style={{ fontWeight: 600 }}>1st Technical Round Panel</span>}
                rules={[{ required: true, message: 'Please specify the 1st round panel.' }]}
              >
                <Input placeholder="e.g. Senior Backend Devs, Panel A" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="second_technical_round"
                label={<span style={{ fontWeight: 600 }}>2nd Technical Round Panel</span>}
              >
                <Input placeholder="e.g. Project Tech Lead, Panel B" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="ceo_management_round"
                label={<span style={{ fontWeight: 600 }}>CEO / Management Round</span>}
              >
                <Select placeholder="Select option" defaultValue="Yes">
                  <Select.Option value="Yes">Yes</Select.Option>
                  <Select.Option value="No">No</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="ceo_panel_details"
                label={<span style={{ fontWeight: 600 }}>CEO Panel Details</span>}
              >
                <Input placeholder="e.g. Abhijit Roy" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="hr_round"
                label={<span style={{ fontWeight: 600 }}>HR Interview Panel</span>}
                rules={[{ required: true, message: 'Please specify HR panel.' }]}
              >
                <Input placeholder="e.g. HR Head, Recruiter" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="client_round"
                label={<span style={{ fontWeight: 600 }}>Client Round Required?</span>}
              >
                <Select placeholder="Select option" defaultValue="No">
                  <Select.Option value="Yes">Yes</Select.Option>
                  <Select.Option value="No">No</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="client_round_coordinator"
                label={<span style={{ fontWeight: 600 }}>Client Round Coordinator</span>}
              >
                <Input placeholder="Enter coordinator details" />
              </Form.Item>
            </Col>
          </Row>

          {/* Section 6: Project, Schedule & Allocation */}
          <Divider orientation="left" style={{ borderColor: '#e8ede0' }}><span style={{ color: '#7a922e', fontWeight: 700 }}>6. Project, Schedule & Allocation</span></Divider>
          <Row gutter={24}>
            <Col xs={24} sm={12}>
              <Form.Item
                name="project_name"
                label={<span style={{ fontWeight: 600 }}>Project Name</span>}
                rules={[{ required: true, message: 'Please enter project name.' }]}
              >
                <Input placeholder="Enter project name or benchmark" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="project_duration"
                label={<span style={{ fontWeight: 600 }}>Project Duration</span>}
                rules={[{ required: true, message: 'Please specify duration.' }]}
              >
                <Input placeholder="e.g. 6 Months, 1 Year, Ongoing" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="existing_resource_allocation"
                label={<span style={{ fontWeight: 600 }}>Existing Resource Allocation Possible?</span>}
                rules={[{ required: true, message: 'Please select resource allocation possibility.' }]}
              >
                <Select placeholder="Select option">
                  <Select.Option value="true">Yes</Select.Option>
                  <Select.Option value="false">No</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="job_timing"
                label={<span style={{ fontWeight: 600 }}>Job Timing / Shift</span>}
                rules={[{ required: true, message: 'Please enter job shift timings.' }]}
              >
                <Select placeholder="Select timing shift">
                  <Select.Option value="2:00 PM – 11:00 PM">2:00 PM – 11:00 PM (Standard AAPNA Shift)</Select.Option>
                  <Select.Option value="3:00 PM – 12:00 AM">3:00 PM – 12:00 AM</Select.Option>
                  <Select.Option value="9:00 AM – 6:00 PM">9:00 AM – 6:00 PM (Regular Shift)</Select.Option>
                  <Select.Option value="Flexible">Flexible Timings</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            {resourceAllocation === 'true' && (
              <Col xs={24}>
                <Form.Item
                  name="existing_resource_information"
                  label={<span style={{ fontWeight: 600 }}>Existing Resource Information</span>}
                  rules={[{ required: true, message: 'Please provide info on allocated resource.' }]}
                >
                  <TextArea placeholder="Clarify names or details of bench resources to be evaluated first" autoSize={{ minRows: 2, maxRows: 4 }} />
                </Form.Item>
              </Col>
            )}
            <Col xs={24} sm={12}>
              <Form.Item
                name="first_round_interview_slot"
                label={<span style={{ fontWeight: 600 }}>Daily Interview Slot (Round 1)</span>}
                rules={[{ required: true, message: 'Please specify daily Round 1 interview slot.' }]}
              >
                <Input placeholder="e.g. 4:00 PM – 6:00 PM IST" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="second_round_interview_slot"
                label={<span style={{ fontWeight: 600 }}>Daily Interview Slot (Round 2)</span>}
              >
                <Input placeholder="e.g. 5:00 PM – 7:00 PM IST" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="weekly_meeting_slot"
                label={<span style={{ fontWeight: 600 }}>Weekly Meeting Slot (For syncs)</span>}
                rules={[{ required: true, message: 'Please specify weekly meeting slot.' }]}
              >
                <Input placeholder="e.g. Mondays 4:30 PM IST" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="client_details"
                label={<span style={{ fontWeight: 600 }}>Client Name & Details</span>}
                rules={[{ required: true, message: 'Client details are required.' }]}
              >
                <Input placeholder="Enter client identity or group" />
              </Form.Item>
            </Col>
            <Col xs={24}>
              <Form.Item
                name="competencies_required"
                label={<span style={{ fontWeight: 600 }}>Competencies Required</span>}
              >
                <TextArea placeholder="Enter behavioral or functional competencies (e.g. Leadership, Self-starter)" autoSize={{ minRows: 2, maxRows: 4 }} />
              </Form.Item>
            </Col>
            <Col xs={24}>
              <Form.Item
                name="additional_information"
                label={<span style={{ fontWeight: 600 }}>Additional Information</span>}
              >
                <TextArea placeholder="Any other specific constraints, budget details, or requests" autoSize={{ minRows: 2, maxRows: 4 }} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item style={{ marginTop: 32, marginBottom: 0 }}>
            <Button
              type="primary"
              htmlType="submit"
              loading={submitting}
              icon={<SendOutlined />}
              block
              style={{
                height: 52,
                borderRadius: 12,
                fontWeight: 700,
                fontSize: 16,
                background: '#7a922e',
                borderColor: '#7a922e',
              }}
            >
              Submit Requisition Form (MRF)
            </Button>
          </Form.Item>
        </Form>

        {/* Footer */}
        <div style={{ textAlign: 'center', marginTop: 40 }}>
          <Text type="secondary" style={{ fontSize: 11, opacity: 0.6 }}>
            © {new Date().getFullYear()} AAPNA Infotech · Secure Manpower Planning Portal
          </Text>
        </div>
      </Card>
    </div>
  );
}
