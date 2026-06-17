import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, Form, Input, Button, Typography, Alert, Select, InputNumber, DatePicker, Result, Upload, Spin, message } from 'antd';
import { UploadOutlined, SendOutlined } from '@ant-design/icons';
import mrfService from '../services/mrfService';
import dayjs from 'dayjs';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

// Brand colours pulled from the n8n form.
const BRAND = '#92a63c';
const HELP = 'rgb(12, 136, 42)';
const REQUIRED = '#bc2f32';

/**
 * Single ordered list of every form question, mirroring the n8n MRF form
 * ("Respond to Webhook1"). Each entry drives label, description, input type,
 * options, required state, and conditional visibility. Conditional questions
 * carry a `when(values)` predicate and are only rendered (and only validated /
 * submitted) when visible. Section titles are emitted via `section`.
 *
 * Field `name`s are kept aligned to the existing rpa_mrf DB columns / backend
 * keys so the submit + prefill pipeline is untouched; only labels, descriptions,
 * options and behaviour are matched to n8n.
 */
export const FIELDS = [
  // 1
  { name: 'hiring_manager_name', label: 'Name of the Hiring Manager', desc: 'Please provide the name of the intender', type: 'text', required: true },
  // 2 — n8n "hiring_manager_email" maps to our submitter_email column
  { name: 'submitter_email', label: 'Email of the Hiring Manager', desc: 'Please provide the email of the intender', type: 'email', required: true },
  // 3
  { name: 'hiring_manager_designation', label: 'Designation of the Hiring Manager', desc: 'Please provide the designation of the intender', type: 'text', required: true },
  // 4
  { name: 'date_of_request', label: 'Date of Request', desc: 'Please provide the date', type: 'date', required: true },
  // 5
  { name: 'required_in', label: 'Required in', desc: 'Please provide the priority', type: 'select', required: true,
    options: ['1-2 months', 'One month (standard closure time)', '15 days high priority'] },

  { section: 'Qualification & Role Type' },

  // 6
  { name: 'position_hiring_for', label: 'Position hiring for', desc: 'Please provide the position', type: 'text', required: true },
  // 7
  { name: 'number_of_positions', label: 'Number of Positions', desc: 'Please provide the number of positions', type: 'select', required: true,
    options: ['1', '2', '3', '4', '5', '6+'] },
  // 8
  { name: 'position_reports_to', label: 'Position reports to', desc: 'Please provide the name/mail to whom the new position reports to', type: 'text', required: true },
  // 9
  { name: 'requirement_for_team', label: 'Requirement for the team', desc: 'Please select an option', type: 'select', required: true,
    options: ['DotNET', 'QA', 'Web', 'Mobile', 'PMO', 'RPA', 'Decisions', 'Other'] },
  { name: 'requirement_for_team_other', label: 'Please give us more info about Other Requirement', desc: 'Please provide the requirement for the team if Other is selected', type: 'text', required: true,
    when: (v) => v.requirement_for_team === 'Other' },
  // 10
  { name: 'desired_qualification', label: 'Desired Qualification', desc: 'If Selected PG, Any / Graduate / Other, Please provide more info in the next question', type: 'select', required: true,
    options: ['BE/BTech, MCA, Any', 'PG, Any', 'Graduate', 'Other'] },
  { name: 'pg_information', label: 'Please give us more info about the PG', desc: 'Mention specialization/university/criteria', type: 'text', required: true,
    when: (v) => v.desired_qualification === 'PG, Any' },
  { name: 'graduate_other_information', label: 'Please give us more info about the Graduate', desc: 'Mention degree type and any preference', type: 'text', required: true,
    when: (v) => v.desired_qualification === 'Graduate' },
  { name: 'other_qualification_more_info', label: 'Please give us more info about Other Qualification', desc: 'Provide qualification details', type: 'text', required: true,
    when: (v) => v.desired_qualification === 'Other' },
  // 11
  { name: 'replacement_or_new_role', label: 'Replacement or New Role', desc: 'Please select an option', type: 'select', required: true,
    options: ['Replacement', 'New Role'] },
  { name: 'replacement_comments', label: 'Please provide comments for Replacement selected above', desc: 'Example: employee name, reason, last working date', type: 'textarea', required: true,
    when: (v) => v.replacement_or_new_role === 'Replacement' },

  { section: 'Experience & Project' },

  // 12 (DB column is Int — integer input)
  { name: 'total_years_of_experience', label: 'Total Years of Experience', desc: 'Please provide total years of experience (e.g., 10)', type: 'number', required: true },
  // 13
  { name: 'relevant_years_of_experience', label: 'Relevant Years of Experience', desc: 'Please provide relevant years of experience (e.g., 9)', type: 'number', required: true },
  // 14
  { name: 'project_name', label: 'Hiring is for (Project Name)', desc: 'Please provide the project name', type: 'text', required: true },
  // 15
  { name: 'project_duration', label: 'Duration of the project', desc: 'Please provide duration of the project', type: 'text', required: true },
  // 16
  { name: 'employment_type', label: 'Full time/Fixed term Contract/Extendable Contract', desc: 'Please select the type of job for the position', type: 'select', required: true,
    options: ['Full Time', 'Fixed Term Contract', 'Extendable Contract'] },
  // 17 — DB column existing_resource_allocation (boolean); send Yes/No
  { name: 'existing_resource_allocation', label: 'Can someone from existing resources be allocated?', desc: 'If Selected Yes, please provide more information in the next question', type: 'select', required: true,
    options: ['Yes', 'No'] },
  { name: 'existing_resource_information', label: 'Please provide information about Existing Resources', desc: 'Mention employee name(s), availability, and allocation plan', type: 'textarea', required: true,
    when: (v) => v.existing_resource_allocation === 'Yes' },

  { section: 'Job Description & Skills' },

  // 18
  { name: 'roles_responsibilities', label: 'Roles & Responsibilities', desc: 'If JD is not available, please provide details in the Other option', type: 'select', required: true,
    options: ['Same as JD', 'Other'] },
  { name: 'roles_responsibilities_other', label: 'Roles & Responsibilities (Other)', desc: 'Provide the roles & responsibilities details', type: 'textarea', required: true,
    when: (v) => v.roles_responsibilities === 'Other' },
  // 19
  { name: 'mandatory_skills', label: 'Mandatory Skills', desc: 'If JD is not available, please provide details in the Other option', type: 'select', required: true,
    options: ['Same as JD', 'Other'] },
  { name: 'mandatory_skills_other', label: 'Mandatory Skills (Other)', desc: 'Provide mandatory skills details', type: 'textarea', required: true,
    when: (v) => v.mandatory_skills === 'Other' },
  // 20
  { name: 'good_to_have_skills', label: 'Good to have Skills', desc: 'If JD is not available, please provide details in the Other option', type: 'select', required: true,
    options: ['Same as JD', 'Other'] },
  { name: 'good_to_have_skills_other', label: 'Good to have Skills (Other)', desc: 'Provide good-to-have skills details', type: 'textarea', required: true,
    when: (v) => v.good_to_have_skills === 'Other' },

  { section: 'Interview Rounds' },

  // 21
  { name: 'first_technical_round', label: '1st Technical Round', desc: 'Please provide details of the interview panel for the 1st Technical Round', type: 'text', required: true },
  // 22
  { name: 'second_technical_round', label: '2nd Technical Round', desc: 'Please provide details of the interview panel for the 2nd Technical Round', type: 'text', required: true },
  // 23
  { name: 'ceo_management_round', label: 'CEO/Management Round', desc: 'Please select an option', type: 'select', required: true,
    options: ['Yes', 'No'] },
  { name: 'ceo_panel_details', label: 'CEO/Management Round Panel Details', desc: 'Provide panel member(s) name(s)', type: 'text', required: true,
    when: (v) => v.ceo_management_round === 'Yes' },
  // 24
  { name: 'hr_round', label: 'HR Round', desc: 'Please provide details of the HR Round', type: 'text', required: true },
  // 25
  { name: 'client_round', label: 'Client Round', desc: 'Please select an option', type: 'select', required: true,
    options: ['Yes', 'No'] },
  { name: 'client_round_coordinator', label: 'Who will coordinate Client Round', desc: 'Please provide more information about the client round', type: 'text', required: true,
    when: (v) => v.client_round === 'Yes' },

  { section: 'Timing & Coordination' },

  // 26
  { name: 'job_timing', label: 'Job Timing for this role', desc: 'Please provide job timing for this role', type: 'text', required: true },
  // 27 — DB column first_round_interview_slot
  { name: 'first_round_interview_slot', label: 'Daily Interview Slot (Monday - Friday) from the panel for 1st round interview', desc: 'Please provide a time slot for the 1st Technical Round', type: 'text', required: false },
  // 28 — DB column second_round_interview_slot
  { name: 'second_round_interview_slot', label: 'Daily Interview Slot (Monday - Friday) from the panel for 2nd round interview', desc: 'Please provide a time slot for the 2nd Technical Round', type: 'text', required: false },
  // 29 — DB column weekly_meeting_slot
  { name: 'weekly_meeting_slot', label: 'Weekly meeting slot with HM', desc: 'Please provide a time slot for the meeting with HM', type: 'text', required: true },

  { section: 'Client & Additional Information' },

  // 30
  { name: 'client_details', label: 'Client Details (Name E-mail id, Phone number)', desc: 'Please provide the details of the client', type: 'textarea', required: false },
  // 31 — DB column additional_information
  { name: 'additional_information', label: 'Additional Information, HRD need to know', desc: 'Please provide any additional information for HRD if required', type: 'textarea', required: false },
  // 32
  { name: 'competencies_required', label: 'Competencies required/ Must for this hire', desc: 'Please provide any other information if required', type: 'textarea', required: false },

  { section: 'Attachments & Approvals' },

  // 33 — choice only drives the conditional; NOT persisted (question_paper column holds the file URL)
  { name: 'question_paper_choice', label: 'Question Paper', desc: 'Please select an option', type: 'select', required: true, transient: true,
    options: ['Use the existing one', 'Creating new'] },
  { name: 'question_paper_new_owner', label: 'If creating new, who will prepare the Question Paper?', desc: 'Provide owner name/email', type: 'text', required: true,
    when: (v) => v.question_paper_choice === 'Creating new' },
  // 34
  { name: 'approved_by_abhijit', label: 'Approved by Abhijit', desc: 'Please select an option', type: 'select', required: true,
    options: ['Yes', 'No'] },
  // 35
  { name: 'attach_jd', label: 'Please attach the JD for the given position', desc: 'Upload the JD document', type: 'file', required: true,
    hint: 'File number limit: 1 | Single file size limit: 10MB', accept: '.pdf,.docx' },
  // 36
  { name: 'attach_online_test_paper', label: 'Please attach the Online Test Paper for the given position', desc: 'Upload the Online Test Paper', type: 'file', required: true,
    hint: 'File number limit: 1 | Single file size limit: 10MB', accept: '.pdf,.docx' },
];

// Trigger select -> "Other" textbox, for prefill smart-matching (mirrors n8n otherPairs).
const OTHER_PAIRS = {
  roles_responsibilities: 'roles_responsibilities_other',
  mandatory_skills: 'mandatory_skills_other',
  good_to_have_skills: 'good_to_have_skills_other',
  requirement_for_team: 'requirement_for_team_other',
};

export default function MrfSubmit() {
  const [searchParams] = useSearchParams();
  const roleParam = searchParams.get('role') || '';
  const emailParam = searchParams.get('emailid') || '';
  const parentIdParam = searchParams.get('id') || '';

  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  // Prefill state
  const [prefillLoading, setPrefillLoading] = useState(false);
  const [prefillOptions, setPrefillOptions] = useState([]);

  // Watch every value so conditional visibility + numbering re-compute on change.
  const values = Form.useWatch([], form) || {};

  useEffect(() => {
    form.setFieldsValue({
      position_hiring_for: roleParam,
      submitter_email: emailParam,
      date_of_request: dayjs(),
    });
  }, [roleParam, emailParam]);

  // Auto-load prefill options (email + role) on mount, like the n8n form.
  useEffect(() => {
    const load = async () => {
      if (!roleParam || !emailParam) return;
      setPrefillLoading(true);
      try {
        const res = await mrfService.getPrefillOptions(emailParam, roleParam);
        const list = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
        setPrefillOptions(list);
      } catch {
        // Silent — manual entry still works.
      } finally {
        setPrefillLoading(false);
      }
    };
    load();
  }, [roleParam, emailParam]);

  // Compute the running visible-question number for each non-section field.
  const numbering = useMemo(() => {
    const map = {};
    let n = 0;
    for (const f of FIELDS) {
      if (f.section) continue;
      const visible = !f.when || f.when(values);
      if (visible) {
        n += 1;
        map[f.name] = n;
      }
    }
    return map;
  }, [values]);

  const applyPrefill = (data) => {
    if (!data) return;

    const boolToYesNo = (val) => (val === true ? 'Yes' : val === false ? 'No' : val);

    // Phase 1: set trigger selects first so conditional blocks open.
    const triggerSet = {
      requirement_for_team: data.requirement_for_team,
      desired_qualification: data.desired_qualification,
      replacement_or_new_role: data.replacement_or_new_role,
      existing_resource_allocation: boolToYesNo(data.existing_resource_allocation),
      roles_responsibilities: data.roles_responsibilities,
      mandatory_skills: data.mandatory_skills,
      good_to_have_skills: data.good_to_have_skills,
      ceo_management_round: data.ceo_management_round,
      client_round: data.client_round,
      // question_paper_choice is transient (not a DB column) — derive it from whether
      // the prior submission already has a question paper on file.
      question_paper_choice: data.question_paper ? 'Use the existing one' : 'Creating new',
    };

    // Smart-match Same-as-JD/Other selects: unknown value => "Other" + fill paired textbox.
    const otherText = {};
    Object.keys(OTHER_PAIRS).forEach((trigger) => {
      const raw = triggerSet[trigger];
      const known = FIELDS.find((f) => f.name === trigger)?.options || [];
      if (raw && !known.includes(raw)) {
        otherText[OTHER_PAIRS[trigger]] = raw;
        triggerSet[trigger] = 'Other';
      }
    });
    form.setFieldsValue(triggerSet);

    // Phase 2: fill the rest.
    form.setFieldsValue({
      hiring_manager_name: data.hiring_manager_name,
      hiring_manager_designation: data.hiring_manager_designation,
      required_in: data.required_in,
      position_hiring_for: roleParam || data.position_hiring_for,
      number_of_positions: data.number_of_positions != null ? String(data.number_of_positions) : undefined,
      position_reports_to: data.position_reports_to,
      requirement_for_team_other: data.requirement_for_team_other,
      pg_information: data.pg_information,
      graduate_other_information: data.graduate_other_information,
      other_qualification_more_info: data.other_qualification_more_info,
      replacement_comments: data.replacement_comments,
      total_years_of_experience: data.total_years_of_experience,
      relevant_years_of_experience: data.relevant_years_of_experience,
      project_name: data.project_name,
      project_duration: data.project_duration,
      employment_type: data.employment_type,
      existing_resource_information: data.existing_resource_information,
      first_technical_round: data.first_technical_round,
      second_technical_round: data.second_technical_round,
      ceo_panel_details: data.ceo_panel_details,
      hr_round: data.hr_round,
      client_round_coordinator: data.client_round_coordinator,
      job_timing: data.job_timing,
      first_round_interview_slot: data.first_round_interview_slot,
      second_round_interview_slot: data.second_round_interview_slot,
      weekly_meeting_slot: data.weekly_meeting_slot,
      client_details: data.client_details,
      additional_information: data.additional_information,
      competencies_required: data.competencies_required,
      question_paper_new_owner: data.question_paper_new_owner,
      // approved_by_abhijit is intentionally NOT prefilled — it's a per-submission
      // approval flag, not a property of the role/project that should carry over.
      ...otherText,
    });
    message.success('Form prefilled from the selected requisition.');
  };

  const onPrefillSelect = (index) => {
    if (index === undefined || index === null || index === '') return;
    applyPrefill(prefillOptions[index]);
  };

  const onFinish = async (allValues) => {
    setSubmitting(true);
    setError('');
    try {
      const formData = new FormData();

      // Files
      if (allValues.attach_jd?.[0]?.originFileObj) {
        formData.append('attach_jd', allValues.attach_jd[0].originFileObj);
      }
      if (allValues.attach_online_test_paper?.[0]?.originFileObj) {
        formData.append('attach_online_test_paper', allValues.attach_online_test_paper[0].originFileObj);
      }

      // Only submit fields that are currently visible (hidden conditional fields
      // are excluded — matching the n8n disable-and-exclude behaviour). Also skip
      // files (handled above) and transient-only fields (question_paper_choice).
      const visibleNames = new Set(
        FIELDS.filter((f) => !f.section && !f.transient && (!f.when || f.when(allValues))).map((f) => f.name)
      );

      Object.keys(allValues).forEach((key) => {
        if (key === 'attach_jd' || key === 'attach_online_test_paper') return;
        if (!visibleNames.has(key)) return;
        const val = allValues[key];
        if (val === undefined || val === null) return;
        if (key === 'date_of_request') {
          formData.append(key, val.toISOString());
        } else {
          formData.append(key, val);
        }
      });

      if (parentIdParam) formData.append('parent_id', parentIdParam);

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
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px', background: '#f3f5ea' }}>
        <Card style={{ width: '100%', maxWidth: 650, borderRadius: 14, padding: 24, boxShadow: '0 10px 30px rgba(0,0,0,0.08)' }}>
          <Result
            status="success"
            title={<span style={{ fontWeight: 700 }}>MRF Submitted Successfully!</span>}
            subTitle={
              <Paragraph style={{ fontSize: 14 }}>
                Your MRF has been submitted successfully and routed to Management (Abhijit Roy &amp; Sanghamitra Roy) for review. You may close this browser window now.
              </Paragraph>
            }
            extra={[
              <Button key="close" type="primary" onClick={() => window.close()}
                style={{ height: 44, borderRadius: 8, background: BRAND, border: 'none', fontWeight: 600, paddingInline: 32 }}>
                Close
              </Button>,
            ]}
          />
        </Card>
      </div>
    );
  }

  const renderInput = (f) => {
    switch (f.type) {
      case 'email':
        return <Input type="email" placeholder="Enter your answer" />;
      case 'date':
        return <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />;
      case 'number':
        return <InputNumber min={0} max={60} step={1} style={{ width: '100%' }} placeholder="Enter your answer" />;
      case 'select':
        return (
          <Select placeholder="Select your answer">
            {f.options.map((opt) => (
              <Select.Option key={opt} value={opt}>{opt}</Select.Option>
            ))}
          </Select>
        );
      case 'textarea':
        return <TextArea autoSize={{ minRows: 2, maxRows: 5 }} placeholder="Enter your answer" />;
      case 'file':
        return (
          <Upload maxCount={1} beforeUpload={() => false} accept={f.accept}>
            <Button icon={<UploadOutlined />} style={{ height: 42, borderRadius: 8 }}>
              Choose File ({f.accept})
            </Button>
          </Upload>
        );
      default:
        return <Input placeholder="Enter your answer" />;
    }
  };

  const renderField = (f) => {
    const isVisible = !f.when || f.when(values);
    if (!isVisible) return null;

    const num = numbering[f.name];
    const labelNode = (
      <div>
        <div style={{ fontWeight: 600, color: '#222' }}>
          {num ? <span style={{ color: BRAND, marginRight: 6 }}>{num}.</span> : null}
          {f.label}
          {f.required ? <span style={{ color: REQUIRED, marginLeft: 4 }}>*</span> : null}
        </div>
        {f.desc ? <div style={{ fontSize: 12, color: HELP, marginTop: 2, fontStyle: 'italic' }}>{f.desc}</div> : null}
      </div>
    );

    const rules = [];
    if (f.required) {
      if (f.type === 'email') {
        rules.push({ required: true, type: 'email', message: 'Please enter a valid email address.' });
      } else {
        rules.push({ required: true, message: 'This field is required.' });
      }
    } else if (f.type === 'email') {
      rules.push({ type: 'email', message: 'Please enter a valid email address.' });
    }

    const fileProps = f.type === 'file'
      ? {
          valuePropName: 'fileList',
          getValueFromEvent: (e) => (Array.isArray(e) ? e : e && e.fileList),
        }
      : {};

    return (
      <div key={f.name} style={{ marginBottom: 4 }}>
        <Form.Item name={f.name} label={labelNode} rules={rules} {...fileProps}>
          {renderInput(f)}
        </Form.Item>
        {f.hint ? <div style={{ fontSize: 11, color: '#999', marginTop: -12, marginBottom: 12 }}>{f.hint}</div> : null}
      </div>
    );
  };

  return (
    <div style={{ minHeight: '100vh', padding: '40px 14px', background: '#f3f5ea' }}>
      <div style={{ maxWidth: 920, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ background: BRAND, borderRadius: '14px 14px 0 0', padding: '16px 24px', display: 'flex', alignItems: 'center', gap: 16, boxShadow: '0 10px 30px rgba(0,0,0,0.1)' }}>
          <img
            src="https://www.aapnainfotech.com/wp-content/uploads/2021/09/aapna-gptw-black.png"
            alt="AAPNA Logo"
            style={{ height: 40, objectFit: 'contain', background: '#fff', borderRadius: 8, padding: 4 }}
          />
          <Title level={3} style={{ margin: 0, color: '#fff', fontWeight: 800, letterSpacing: '0.5px' }}>
            MANPOWER REQUISITION FORM (MRF)
          </Title>
        </div>

        <Card style={{ borderRadius: '0 0 14px 14px', padding: '8px 28px 28px', boxShadow: '0 10px 30px rgba(0,0,0,0.08)' }}>
          {/* Prefill dropdown — only shown when prior submissions exist */}
          {prefillLoading ? (
            <div style={{ padding: '16px 0' }}><Spin size="small" /> <Text type="secondary">Loading previous requisitions…</Text></div>
          ) : prefillOptions.length > 0 ? (
            <div style={{ margin: '16px 0' }}>
              <Select
                style={{ width: '100%', maxWidth: 420 }}
                placeholder="Select an option"
                onChange={onPrefillSelect}
                allowClear
              >
                {prefillOptions.map((item, idx) => (
                  <Select.Option key={idx} value={idx}>
                    {`${item.position_hiring_for || 'Role'} – ${item.project_name || 'MRF'}`}
                  </Select.Option>
                ))}
              </Select>
              <div style={{ fontSize: 12, color: '#000', marginTop: 4 }}>Select a request to auto-fill the form</div>
            </div>
          ) : null}

          {error && <Alert message="Submission Error" description={error} type="error" showIcon closable style={{ marginBottom: 20, borderRadius: 8 }} />}

          <Form
            form={form}
            name="mrf-submission"
            layout="vertical"
            onFinish={onFinish}
            size="large"
            requiredMark={false}
          >
            {FIELDS.map((f, idx) =>
              f.section ? (
                <div key={`sec-${idx}`} style={{ margin: '24px 0 12px', paddingBottom: 6, borderBottom: `2px solid ${BRAND}`, color: BRAND, fontWeight: 700, fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  {f.section}
                </div>
              ) : (
                renderField(f)
              )
            )}

            <Form.Item style={{ marginTop: 32, marginBottom: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                <Button
                  htmlType="button"
                  onClick={() => {
                    form.resetFields();
                    form.setFieldsValue({
                      position_hiring_for: roleParam,
                      submitter_email: emailParam,
                      date_of_request: dayjs(),
                    });
                  }}
                  style={{ height: 44, borderRadius: 10, paddingInline: 28 }}
                >
                  Reset
                </Button>
                <Button
                  type="primary"
                  htmlType="submit"
                  loading={submitting}
                  icon={<SendOutlined />}
                  style={{ height: 44, borderRadius: 10, fontWeight: 700, paddingInline: 32, background: BRAND, borderColor: BRAND }}
                >
                  Submit
                </Button>
              </div>
            </Form.Item>
          </Form>

          <div style={{ textAlign: 'center', marginTop: 32 }}>
            <Text type="secondary" style={{ fontSize: 11, opacity: 0.6 }}>
              © {new Date().getFullYear()} AAPNA Infotech · Secure Manpower Planning Portal
            </Text>
          </div>
        </Card>
      </div>
    </div>
  );
}
