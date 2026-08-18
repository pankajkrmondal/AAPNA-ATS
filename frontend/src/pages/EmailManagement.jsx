import { useState, useEffect, useMemo } from 'react';
import {
  Card,
  Row,
  Col,
  List,
  Input,
  Button,
  Badge,
  Alert,
  message,
  Modal,
  Spin,
  Typography,
  Space,
  Tag,
} from 'antd';
import {
  MailOutlined,
  SaveOutlined,
  SearchOutlined,
  CopyOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import PageHeader from '../components/common/PageHeader';
import EmptyState from '../components/common/EmptyState';
import emailTemplateService from '../services/emailTemplateService';
import useTheme from '../hooks/useTheme';
import { EmailEditorTabs, FULL_TOOLBAR, sanitizeDoc } from '../components/common/EmailBodyEditor';

dayjs.extend(relativeTime);

const { Title, Text } = Typography;

// On-brand gold/sage tag treatment (replaces generic antd color tags).
const brandTagStyle = {
  background: 'var(--gold-subtle)',
  color: 'var(--gold)',
  border: '1px solid rgba(122, 146, 46, 0.25)',
  borderRadius: 6,
  fontWeight: 600,
  margin: 0,
};

// Structural placeholders the sending service injects as HTML fragments (not
// recruiter content) — excluded from required-placeholder validation so they
// can be freely removed from a body. Mirrors OPTIONAL_PLACEHOLDERS in
// backend/src/controllers/emailTemplate.controller.js.
const OPTIONAL_PLACEHOLDERS = new Set(['teams_line', 'reason_line']);

// Dummy replacements for the Live Preview tab — a template's real values
// (candidate name, interview time, etc.) don't exist until send time, so
// preview substitutes sample text for every token it recognizes.
const dummyReplacements = {
  candidate_name: 'John Doe',
  job_title: 'Senior Node.js Engineer',
  position: 'Senior Node.js Engineer',
  interview_start: '15 June 2026, 02:00 PM IST',
  interview_end: '15 June 2026, 03:00 PM IST',
  interview_link: 'https://interview.zeko.ai/interview/senior-node-dev',
  cancel_reason: 'Hiring manager rescheduled due to client conflict',
  interview_stage: 'HR SCREENING',
  vendor_name: 'Alpha Partners Agency',
  candidate_email: 'johndoe@example.com',
  candidate_phone: '+91 98765 43210',
  upload_link: 'https://ats.aapnainfotech.com/missing-jd-upload?token=xyz',
  recruiter_name: 'Sarah Jenkins',
  ctc: '18 LPA',
  joining_date: '01 July 2026',
  // Technical-round interview templates (#22–27).
  stage_label: 'Technical Round 1',
  interview_when: '28 July 2026 at 11:00 AM IST',
  previous_when: '25 July 2026 at 03:00 PM IST',
  duration: '60',
  teams_line: '<p style="margin:16px 0;"><a href="https://teams.microsoft.com/l/meetup-join/sample" style="background:#7a922e;color:#fff;padding:11px 22px;text-decoration:none;border-radius:8px;font-weight:700;display:inline-block;">Join the Microsoft Teams meeting</a></p>',
  reason_line: '<p><strong>Reason:</strong> Interviewer unavailable</p>',
};

/** Substitutes every recognized {token}/{{token}} with its dummy sample value. */
function compileDummyPreview(subject, body) {
  let compiledSubject = subject;
  let compiledBody = body;
  for (const [key, val] of Object.entries(dummyReplacements)) {
    compiledSubject = compiledSubject.split(`{{${key}}}`).join(val).split(`{${key}}`).join(val);
    compiledBody = compiledBody.split(`{{${key}}}`).join(val).split(`{${key}}`).join(val);
  }
  return { subject: compiledSubject, body: compiledBody };
}

export default function EmailManagement() {
  const { isDark } = useTheme();
  const [templates, setTemplates] = useState([]);
  const [filteredTemplates, setFilteredTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');

  // Form states
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [validationError, setValidationError] = useState('');
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    setIsLoading(true);
    try {
      const res = await emailTemplateService.getEmailTemplates();
      if (res.data.status === 'success') {
        setTemplates(res.data.data);
        setFilteredTemplates(res.data.data);
      } else {
        message.error('Failed to load templates.');
      }
    } catch (err) {
      console.error(err);
      message.error('Error fetching email templates.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let result = templates;
    if (selectedCategory !== 'all') {
      result = result.filter(t => t.category === selectedCategory);
    }
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        t =>
          t.name.toLowerCase().includes(query) ||
          t.subject.toLowerCase().includes(query)
      );
    }
    setFilteredTemplates(result);
  }, [searchQuery, selectedCategory, templates]);

  const applySelection = (template) => {
    setSelectedTemplate(template);
    setSubject(template.subject);
    setBodyHtml(template.body_html);
    setValidationError('');
    setIsDirty(false);
  };

  const handleSelectTemplate = (template) => {
    // Guard against silently discarding unsaved edits when switching templates.
    if (selectedTemplate && template.id !== selectedTemplate.id && isDirty) {
      Modal.confirm({
        title: 'Discard unsaved changes?',
        content: `You have unsaved edits to "${selectedTemplate.name}". Switching templates will discard them.`,
        okText: 'Discard changes',
        okButtonProps: { danger: true },
        cancelText: 'Keep editing',
        centered: true,
        onOk: () => applySelection(template),
      });
      return;
    }
    applySelection(template);
  };

  // Resolves each placeholder to its final, insert-ready bracketed form once
  // per template selection (e.g. `{token}` vs `{{token}}`, matching whichever
  // style this template's own placeholders array already uses).
  const resolvedPlaceholders = useMemo(() => {
    if (!selectedTemplate) return [];
    const hasSingleBrackets = selectedTemplate.placeholders.some(
      p => p.startsWith('{') && !p.startsWith('{{')
    );
    return selectedTemplate.placeholders.map((p) => {
      const clean = p.replace(/[{}]/g, '');
      return hasSingleBrackets ? `{${clean}}` : `{{${clean}}}`;
    });
  }, [selectedTemplate]);

  // Pre-save placeholder validation
  const validateTemplate = (sub, body) => {
    if (!selectedTemplate) return true;
    const contentToValidate = (sub + ' ' + body).toLowerCase();
    const missing = [];

    for (const p of selectedTemplate.placeholders) {
      const cleanP = p.replace(/[{}]/g, '').toLowerCase();
      // Inject-only structural fragments are optional (see OPTIONAL_PLACEHOLDERS).
      if (OPTIONAL_PLACEHOLDERS.has(cleanP)) continue;
      const hasDouble = contentToValidate.includes(`{{${cleanP}}}`);
      const hasSingle = contentToValidate.includes(`{${cleanP}}`);
      let hasAlias = false;
      if (cleanP === 'job_title' || cleanP === 'position') {
        hasAlias =
          contentToValidate.includes('{{job_title}}') ||
          contentToValidate.includes('{job_title}') ||
          contentToValidate.includes('{{position}}') ||
          contentToValidate.includes('{position}');
      }
      if (!hasDouble && !hasSingle && !hasAlias) missing.push(p);
    }

    if (missing.length > 0) {
      setValidationError(
        `Validation Failed: The following required placeholders are missing from your subject or body: ${missing.join(', ')}`
      );
      return false;
    }
    setValidationError('');
    return true;
  };

  const handleSave = async () => {
    const cleanBody = sanitizeDoc(bodyHtml);

    if (!validateTemplate(subject, cleanBody)) {
      message.error('Cannot save: Missing mandatory placeholders.');
      return;
    }

    setIsSaving(true);
    try {
      const res = await emailTemplateService.updateEmailTemplate(selectedTemplate.id, {
        subject,
        body_html: cleanBody,
      });

      if (res.data.status === 'success') {
        message.success('Template saved successfully!');
        setBodyHtml(cleanBody);
        setTemplates(prev =>
          prev.map(t =>
            t.id === selectedTemplate.id
              ? { ...t, subject, body_html: cleanBody, modified_at: new Date() }
              : t
          )
        );
        // Keep the same id so the editor does not reload.
        setSelectedTemplate(prev => ({
          ...prev,
          subject,
          body_html: cleanBody,
          modified_at: new Date(),
        }));
        setIsDirty(false);
      } else {
        message.error(res.data.message || 'Failed to save template.');
      }
    } catch (err) {
      console.error(err);
      message.error(
        err.response?.data?.message || err?.message || 'Error occurred while saving the email template.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleBodyChange = (html) => {
    setBodyHtml(html);
    setIsDirty(true);
  };

  const dummyPreview = useMemo(() => compileDummyPreview(subject, bodyHtml), [subject, bodyHtml]);

  const handleCopyHtml = async () => {
    try {
      await navigator.clipboard.writeText(bodyHtml || '');
      message.success('Email HTML copied to clipboard.');
    } catch {
      message.error('Could not copy to clipboard.');
    }
  };

  const categories = [
    { key: 'all', label: 'All Templates' },
    { key: 'general', label: 'General / Alerts' },
    { key: 'shortlist', label: 'Shortlist' },
    { key: 'interview', label: 'Interviews' },
    { key: 'stage_outcome', label: 'Stage Outcome' },
    { key: 'offer', label: 'Offer Letter' },
    { key: 'rejection', label: 'Rejection' },
    { key: 'onboarding', label: 'Onboarding' },
  ];

  // Keyboard activation helper for custom clickable elements.
  const onActivate = (handler) => (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handler();
    }
  };

  return (
    <div className="stagger-children email-page">
      <PageHeader
        title={
          <>
            <MailOutlined style={{ marginRight: 12, color: 'var(--gold)' }} />
            Email Template Management
          </>
        }
        subtitle="Edit email subjects, bodies, and manage placeholders for system-generated candidate, vendor, alert, and scheduling notifications."
      />

      <Row gutter={24} align="top" className="email-page-row">
        {/* Left Side: Templates List */}
        <Col xs={24} md={8}>
          <Card
            // `glass-3`, not the bare `glass` this carried. Same landmine as
            // /analytics: `.glass` is styled by index.css and never touched by
            // aurora-glass.css, so the route gate alone would have left all
            // three panes flat. The `no-lift` already here signalled tier-3
            // intent; this makes it true. Radius/border/shadow come from the class.
            className="glass-3 no-lift email-pane-card email-list-card"
            styles={{
              body: {
                padding: '16px 0',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              },
            }}
          >
            {/* Search + category selection */}
            <div style={{ padding: '0 16px 12px 16px', borderBottom: '1px solid var(--border-light)', flexShrink: 0 }}>
              <div style={{ marginBottom: 12 }}>
                <Input
                  prefix={<SearchOutlined style={{ color: 'var(--text-2)', opacity: 0.5 }} />}
                  placeholder="Filter templates..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  allowClear
                  style={{ borderRadius: 8 }}
                />
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {categories.map(cat => (
                  <Tag.CheckableTag
                    key={cat.key}
                    checked={selectedCategory === cat.key}
                    onChange={checked => checked && setSelectedCategory(cat.key)}
                    style={{ border: '1px solid var(--border-light)', borderRadius: 6, padding: '2px 8px', fontSize: 11 }}
                  >
                    {cat.label}
                  </Tag.CheckableTag>
                ))}
              </div>
            </div>

            {/* List */}
            {isLoading ? (
              <div style={{ padding: 40, textAlign: 'center' }}>
                <Spin size="large" />
                <Text style={{ display: 'block', marginTop: 12, color: 'var(--text-2)' }}>
                  Loading templates...
                </Text>
              </div>
            ) : filteredTemplates.length === 0 ? (
              // Was a bare "No templates found." — which does not say whether the
              // search excluded everything or there is genuinely nothing here.
              // Two shapes, and the recoverable one offers the way back.
              searchQuery || selectedCategory !== 'all' ? (
                <EmptyState
                  size="sm"
                  icon={<SearchOutlined />}
                  title="No templates match"
                  body="Nothing matches the current search and category. Clear them to see every template."
                  actionLabel="Clear filters"
                  onAction={() => { setSearchQuery(''); setSelectedCategory('all'); }}
                />
              ) : (
                <EmptyState
                  size="sm"
                  icon={<MailOutlined />}
                  title="No email templates yet"
                  body="Templates control the wording of every automated email the system sends."
                />
              )
            ) : (
              <List
                dataSource={filteredTemplates}
                className="email-template-list"
                renderItem={item => {
                  const isSelected = selectedTemplate?.id === item.id;
                  return (
                    <List.Item
                      onClick={() => handleSelectTemplate(item)}
                      onKeyDown={onActivate(() => handleSelectTemplate(item))}
                      role="button"
                      tabIndex={0}
                      aria-pressed={isSelected}
                      style={{
                        padding: '14px 20px',
                        cursor: 'pointer',
                        background: isSelected ? 'var(--gold-subtle)' : 'transparent',
                        borderLeft: isSelected ? '4px solid var(--gold)' : '4px solid transparent',
                        borderBottom: '1px solid var(--border-light)',
                      }}
                      className={`template-list-item${isSelected ? ' is-selected' : ''}`}
                    >
                      <List.Item.Meta
                        title={
                          <Text strong style={{ color: isSelected ? 'var(--gold)' : 'var(--text)', fontSize: 13 }}>
                            {item.name}
                          </Text>
                        }
                        description={
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                            <Text type="secondary" style={{ fontSize: 11, fontStyle: 'italic' }} className="text-truncate">
                              {item.subject}
                            </Text>
                            <div style={{ display: 'flex', gap: 6, marginTop: 2, alignItems: 'center' }}>
                              <Tag style={{ ...brandTagStyle, fontSize: 9, borderRadius: 4, padding: '0 6px' }}>
                                {item.category.toUpperCase()}
                              </Tag>
                              {item.is_active ? (
                                <Badge status="success" style={{ fontSize: 10, alignSelf: 'center' }} text="Active" />
                              ) : (
                                <Badge status="default" style={{ fontSize: 10, alignSelf: 'center' }} text="Inactive" />
                              )}
                            </div>
                          </div>
                        }
                      />
                    </List.Item>
                  );
                }}
              />
            )}
          </Card>
        </Col>

        {/* Right Side: Editor Panel */}
        <Col xs={24} md={16}>
          {selectedTemplate ? (
            <Card
              className="glass-3 no-lift email-pane-card email-editor-card"
              styles={{
                body: {
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 0,
                  overflow: 'hidden',
                },
              }}
              title={
                <Space direction="vertical" size={2}>
                  <Text strong style={{ fontSize: 16 }}>{selectedTemplate.name}</Text>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    Category:{' '}
                    <Tag style={{ ...brandTagStyle, fontSize: 9, borderRadius: 4 }}>
                      {selectedTemplate.category}
                    </Tag>
                    {selectedTemplate.modified_at &&
                      ` | Last updated ${dayjs(selectedTemplate.modified_at).fromNow()}`}
                    {isDirty && (
                      <Text style={{ fontSize: 11, color: 'var(--warning, #d4a017)', marginLeft: 6 }}>
                        • Unsaved changes
                      </Text>
                    )}
                  </Text>
                </Space>
              }
              extra={
                <Button
                  type="primary"
                  icon={<SaveOutlined />}
                  onClick={handleSave}
                  loading={isSaving}
                  disabled={!isDirty}
                  style={{
                    background: isDirty ? 'var(--gradient-primary)' : undefined,
                    borderColor: isDirty ? 'var(--gold)' : undefined,
                    borderRadius: 8,
                    fontWeight: 600,
                  }}
                >
                  Save Changes
                </Button>
              }
            >
              {validationError && (
                <Alert
                  message={validationError}
                  type="error"
                  showIcon
                  closable
                  onClose={() => setValidationError('')}
                  style={{ marginBottom: 16, borderRadius: 8 }}
                />
              )}

              <div style={{ marginBottom: 16 }}>
                <Text strong style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>
                  Subject Line
                </Text>
                <Input
                  value={subject}
                  onChange={e => {
                    setSubject(e.target.value);
                    setValidationError('');
                    setIsDirty(true);
                  }}
                  placeholder="Enter email subject line..."
                  maxLength={255}
                  showCount
                  style={{ borderRadius: 8, fontSize: 14, padding: '8px 12px', border: '1px solid var(--border)' }}
                />
              </div>

              <EmailEditorTabs
                key={selectedTemplate.id}
                bodyHtml={bodyHtml}
                onBodyChange={handleBodyChange}
                subject={subject}
                previewSubject={dummyPreview.subject}
                previewBodyHtml={dummyPreview.body}
                placeholders={resolvedPlaceholders}
                toolbar={FULL_TOOLBAR}
                isDark={isDark}
                fillHeight
                htmlExtra={
                  <Button size="small" icon={<CopyOutlined />} onClick={handleCopyHtml}>
                    Copy HTML
                  </Button>
                }
              />
            </Card>
          ) : (
            <Card
              className="glass-3 no-lift email-pane-card email-placeholder-card"
              style={{ minHeight: '400px' }}
              styles={{
                body: {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  textAlign: 'center',
                },
              }}
            >
              <Space direction="vertical" size={14}>
                <MailOutlined style={{ fontSize: 48, color: 'var(--border)' }} />
                <Title level={4} style={{ margin: 0, color: 'var(--text-2)' }}>
                  No Template Selected
                </Title>
                <Text type="secondary" style={{ maxWidth: 320, display: 'inline-block' }}>
                  Select an email template from the list on the left to edit its subject,
                  body, and placeholders — then preview it exactly as recipients will see it.
                </Text>
              </Space>
            </Card>
          )}
        </Col>
      </Row>
    </div>
  );
}
