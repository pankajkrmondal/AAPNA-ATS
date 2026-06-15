import { useState, useEffect, useRef } from 'react';
import {
  Card,
  Row,
  Col,
  List,
  Input,
  Button,
  Tabs,
  Badge,
  Alert,
  message,
  Spin,
  Typography,
  Space,
  Tag,
  Tooltip,
} from 'antd';
import {
  MailOutlined,
  EditOutlined,
  EyeOutlined,
  SaveOutlined,
  TagOutlined,
  InfoCircleOutlined,
  SearchOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import emailTemplateService from '../services/emailTemplateService';

const { Title, Text, Paragraph } = Typography;
const { TabPane } = Tabs;

// Dummy replacements for live compiled preview
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
};

export default function EmailManagement() {
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
  const [activeTab, setActiveTab] = useState('1');

  const quillRef = useRef(null);

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

    // Filter by category
    if (selectedCategory !== 'all') {
      result = result.filter(t => t.category === selectedCategory);
    }

    // Filter by search query
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

  const handleSelectTemplate = (template) => {
    setSelectedTemplate(template);
    setSubject(template.subject);
    setBodyHtml(template.body_html);
    setValidationError('');
    setActiveTab('1');
  };

  // Helper to insert placeholders at cursor position
  const handleInsertPlaceholder = (rawPlaceholderName) => {
    const editor = quillRef.current?.getEditor();
    if (!editor) return;

    const range = editor.getSelection(true);
    const index = range ? range.index : 0;

    // Clean any brackets from placeholder name
    const cleanPlaceholder = rawPlaceholderName.replace(/[{}]/g, '');

    // Determine insertion format: match existing brackets of the template if possible, default to double curly
    const hasSingleBrackets = selectedTemplate.placeholders.some(
      p => p.startsWith('{') && !p.startsWith('{{')
    );
    const placeholderText = hasSingleBrackets
      ? `{${cleanPlaceholder}}`
      : `{{${cleanPlaceholder}}}`;

    editor.insertText(index, placeholderText);
    editor.setSelection(index + placeholderText.length);
  };

  // Pre-save placeholder validation
  const validateTemplate = (sub, body) => {
    if (!selectedTemplate) return true;

    const contentToValidate = (sub + ' ' + body).toLowerCase();
    const missing = [];

    for (const p of selectedTemplate.placeholders) {
      const cleanP = p.replace(/[{}]/g, '').toLowerCase();
      
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

      if (!hasDouble && !hasSingle && !hasAlias) {
        missing.push(p);
      }
    }

    if (missing.length > 0) {
      setValidationError(
        `Validation Failed: The following required placeholders are missing from your subject or body: ${missing.join(
          ', '
        )}`
      );
      return false;
    }

    setValidationError('');
    return true;
  };

  const handleSave = async () => {
    if (!validateTemplate(subject, bodyHtml)) {
      message.error('Cannot save: Missing mandatory placeholders.');
      return;
    }

    setIsSaving(true);
    try {
      const res = await emailTemplateService.updateEmailTemplate(selectedTemplate.id, {
        subject,
        body_html: bodyHtml,
      });

      if (res.data.status === 'success') {
        message.success('Template saved successfully!');
        // Update local template record
        setTemplates(prev =>
          prev.map(t =>
            t.id === selectedTemplate.id
              ? { ...t, subject, body_html: bodyHtml, modified_at: new Date() }
              : t
          )
        );
        setSelectedTemplate(prev => ({
          ...prev,
          subject,
          body_html: bodyHtml,
          modified_at: new Date(),
        }));
      } else {
        message.error(res.data.message || 'Failed to save template.');
      }
    } catch (err) {
      console.error(err);
      message.error(
        err.response?.data?.message || 'Error occurred while saving the email template.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  // Compile dummy preview html
  const getPreviewContent = () => {
    let compiledSubject = subject;
    let compiledBody = bodyHtml;

    for (const [key, val] of Object.entries(dummyReplacements)) {
      compiledSubject = compiledSubject.split(`{{${key}}}`).join(val);
      compiledBody = compiledBody.split(`{{${key}}}`).join(val);
      compiledSubject = compiledSubject.split(`{${key}}`).join(val);
      compiledBody = compiledBody.split(`{${key}}`).join(val);
    }

    return { subject: compiledSubject, body: compiledBody };
  };

  const preview = getPreviewContent();

  const categories = [
    { key: 'all', label: 'All Templates' },
    { key: 'general', label: 'General / Alerts' },
    { key: 'shortlist', label: 'Shortlist' },
    { key: 'interview', label: 'Interviews' },
    { key: 'offer', label: 'Offer Letter' },
    { key: 'rejection', label: 'Rejection' },
    { key: 'follow_up', label: 'Follow Up' },
  ];

  return (
    <div className="page-enter" style={{ minHeight: 'calc(100vh - 120px)' }}>
      {/* Page Header */}
      <div style={{ marginBottom: 24 }}>
        <Title level={2} style={{ fontWeight: 800, margin: 0 }}>
          <MailOutlined style={{ marginRight: 12, color: 'var(--gold)' }} />
          Email Template Management
        </Title>
        <Paragraph style={{ color: 'var(--text-2)', marginTop: 4, fontSize: 14 }}>
          Edit email subjects, bodies, and manage placeholders for system-generated candidates, vendors, alerts, and scheduling notifications.
        </Paragraph>
      </div>

      <Row gutter={[24, 24]}>
        {/* Left Side: Templates List */}
        <Col xs={24} md={8}>
          <Card
            className="glass"
            style={{
              borderRadius: 'var(--border-radius-lg)',
              border: '1px solid var(--border-light)',
              boxShadow: 'var(--shadow-sm)',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
            }}
            bodyStyle={{ padding: '16px 0', height: '100%' }}
          >
            {/* Category selection */}
            <div style={{ padding: '0 16px 12px 16px', borderBottom: '1px solid var(--border-light)' }}>
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
                    style={{
                      border: '1px solid var(--border-light)',
                      borderRadius: 6,
                      padding: '2px 8px',
                      fontSize: 11,
                    }}
                  >
                    {cat.label}
                  </Tag.CheckableTag>
                ))}
              </div>
            </div>

            {/* List */}
            {isLoading ? (
              <div style={{ padding: 40, textAlign: 'center' }}>
                <Spin size="medium" />
                <Text style={{ display: 'block', marginTop: 12, color: 'var(--text-2)' }}>
                  Loading templates...
                </Text>
              </div>
            ) : filteredTemplates.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-2)' }}>
                No templates found.
              </div>
            ) : (
              <List
                dataSource={filteredTemplates}
                style={{ overflowY: 'auto', maxHeight: '580px', padding: '8px 0' }}
                renderItem={item => {
                  const isSelected = selectedTemplate?.id === item.id;
                  return (
                    <List.Item
                      onClick={() => handleSelectTemplate(item)}
                      style={{
                        padding: '14px 20px',
                        cursor: 'pointer',
                        background: isSelected ? 'var(--gold-subtle)' : 'transparent',
                        borderLeft: isSelected ? '4px solid var(--gold)' : '4px solid transparent',
                        borderBottom: '1px solid var(--border-light)',
                        transition: 'all 0.2s',
                      }}
                      className="template-list-item"
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
                            <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                              <Tag color="cyan" style={{ fontSize: 9, borderRadius: 4, margin: 0, padding: '0 4px' }}>
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
              className="glass"
              style={{
                borderRadius: 'var(--border-radius-lg)',
                border: '1px solid var(--border-light)',
                boxShadow: 'var(--shadow-md)',
              }}
              title={
                <Space direction="vertical" size={2}>
                  <Text strong style={{ fontSize: 16 }}>{selectedTemplate.name}</Text>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    Category: <Tag color="cyan" style={{ fontSize: 9, borderRadius: 4 }}>{selectedTemplate.category}</Tag>
                    {selectedTemplate.modified_at && ` | Last updated: ${new Date(selectedTemplate.modified_at).toLocaleDateString('en-IN')}`}
                  </Text>
                </Space>
              }
              extra={
                <Button
                  type="primary"
                  icon={<SaveOutlined />}
                  onClick={handleSave}
                  loading={isSaving}
                  style={{
                    background: 'var(--gradient-primary)',
                    borderColor: 'var(--gold)',
                    borderRadius: 8,
                    fontWeight: 600,
                  }}
                >
                  Save Changes
                </Button>
              }
            >
              {/* Validation alert if error exists */}
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

              <Tabs activeKey={activeTab} onChange={setActiveTab} type="card" style={{ marginBottom: 0 }}>
                {/* Editor Tab */}
                <TabPane
                  tab={
                    <span>
                      <EditOutlined />
                      Editor
                    </span>
                  }
                  key="1"
                >
                  <div style={{ marginTop: 16 }}>
                    {/* Subject Input */}
                    <div style={{ marginBottom: 16 }}>
                      <Text strong style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>
                        Subject Line
                      </Text>
                      <Input
                        value={subject}
                        onChange={e => {
                          setSubject(e.target.value);
                          setValidationError('');
                        }}
                        placeholder="Enter email subject line..."
                        maxLength={255}
                        style={{
                          borderRadius: 8,
                          fontSize: 14,
                          padding: '8px 12px',
                          border: '1px solid var(--border)',
                        }}
                      />
                    </div>

                    {/* Placeholders helper tray */}
                    <div
                      style={{
                        marginBottom: 16,
                        padding: 12,
                        background: 'var(--gold-subtle)',
                        borderRadius: 8,
                        border: '1px dashed var(--border)',
                      }}
                    >
                      <Space style={{ marginBottom: 6 }} align="center">
                        <TagOutlined style={{ color: 'var(--gold)' }} />
                        <Text strong style={{ fontSize: 12 }}>
                          Available Placeholders
                        </Text>
                        <Tooltip title="Click to insert at current cursor position in body">
                          <InfoCircleOutlined style={{ fontSize: 12, color: 'var(--text-2)', cursor: 'pointer' }} />
                        </Tooltip>
                      </Space>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                        {selectedTemplate.placeholders.map(p => {
                          const cleanP = p.replace(/[{}]/g, '');
                          return (
                            <Tag
                              key={p}
                              color="blue"
                              onClick={() => handleInsertPlaceholder(cleanP)}
                              style={{
                                cursor: 'pointer',
                                padding: '3px 8px',
                                borderRadius: 6,
                                fontSize: 11,
                                fontWeight: 500,
                                transition: 'all 0.2s',
                              }}
                              className="placeholder-tag"
                            >
                              +{cleanP}
                            </Tag>
                          );
                        })}
                      </div>
                    </div>

                    {/* Body HTML Monospace Code Editor */}
                    <div>
                      <Text strong style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>
                        Email HTML Body
                      </Text>
                      <div className="email-quill-editor" style={{ background: '#ffffff' }}>
                        <ReactQuill
                          ref={quillRef}
                          value={bodyHtml}
                          onChange={(content) => {
                            setBodyHtml(content);
                            setValidationError('');
                          }}
                          placeholder="Write email body contents here..."
                          theme="snow"
                          modules={{
                            toolbar: [
                              [{ 'header': [1, 2, 3, false] }],
                              ['bold', 'italic', 'underline', 'strike'],
                              [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                              ['link'],
                              ['clean']
                            ],
                          }}
                          style={{
                            borderRadius: 8,
                            minHeight: '200px'
                          }}
                        />
                      </div>
                      <style>{`
                        .email-quill-editor .quill {
                          display: flex;
                          flex-direction: column;
                        }
                        .email-quill-editor .ql-container {
                          min-height: 250px;
                          border-bottom-left-radius: 8px;
                          border-bottom-right-radius: 8px;
                          font-size: 14px;
                        }
                        .email-quill-editor .ql-toolbar {
                          border-top-left-radius: 8px;
                          border-top-right-radius: 8px;
                        }
                      `}</style>
                    </div>
                  </div>
                </TabPane>

                {/* Compiled Preview Tab */}
                <TabPane
                  tab={
                    <span>
                      <EyeOutlined />
                      Live Preview
                    </span>
                  }
                  key="2"
                >
                  <div style={{ marginTop: 16 }}>
                    {/* Simulated Mail Client Shell */}
                    <div
                      style={{
                        border: '1px solid var(--border)',
                        borderRadius: 12,
                        background: '#ffffff',
                        boxShadow: 'var(--shadow-sm)',
                        overflow: 'hidden',
                        color: '#333333',
                      }}
                    >
                      {/* Client Header */}
                      <div
                        style={{
                          background: '#f8fafc',
                          borderBottom: '1px solid #e2e8f0',
                          padding: '14px 20px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6,
                        }}
                      >
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#ef4444' }} />
                          <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#f59e0b' }} />
                          <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#10b981' }} />
                          <Text style={{ fontSize: 11, color: '#64748b', marginLeft: 10, fontWeight: 500 }}>
                            New Message — Preview Mode
                          </Text>
                        </div>
                        <div style={{ display: 'flex', fontSize: 13, gap: 10 }}>
                          <Text type="secondary" style={{ width: 60 }}>Subject:</Text>
                          <Text strong style={{ color: '#0f172a' }}>{preview.subject}</Text>
                        </div>
                        <div style={{ display: 'flex', fontSize: 13, gap: 10 }}>
                          <Text type="secondary" style={{ width: 60 }}>To:</Text>
                          <Text style={{ color: '#334155' }}>candidate@example.com</Text>
                        </div>
                      </div>

                      {/* Rendered HTML body inside a container */}
                      <div
                        style={{
                          padding: '24px',
                          background: '#f1f5f9',
                          maxHeight: '480px',
                          overflowY: 'auto',
                          display: 'flex',
                          justifyContent: 'center',
                        }}
                      >
                        <div
                          style={{
                            width: '100%',
                            maxWidth: '600px',
                            background: '#ffffff',
                            borderRadius: 10,
                            boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)',
                            overflow: 'hidden',
                          }}
                          dangerouslySetInnerHTML={{ __html: preview.body }}
                        />
                      </div>
                    </div>
                  </div>
                </TabPane>
              </Tabs>
            </Card>
          ) : (
            <Card
              className="glass"
              style={{
                borderRadius: 'var(--border-radius-lg)',
                border: '1px solid var(--border-light)',
                boxShadow: 'var(--shadow-sm)',
                height: '400px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
              }}
            >
              <Space direction="vertical" size={14}>
                <MailOutlined style={{ fontSize: 48, color: 'var(--border)' }} />
                <Title level={4} style={{ margin: 0, color: 'var(--text-2)' }}>
                  No Template Selected
                </Title>
                <Text type="secondary" style={{ maxWidth: 300, display: 'inline-block' }}>
                  Please select an email template from the sidebar on the left to start editing and previewing.
                </Text>
              </Space>
            </Card>
          )}
        </Col>
      </Row>
    </div>
  );
}
