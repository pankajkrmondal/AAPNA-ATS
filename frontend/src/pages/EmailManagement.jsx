import { useState, useEffect, useRef, useMemo } from 'react';
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
  Modal,
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
  CopyOutlined,
  BoldOutlined,
  ItalicOutlined,
  UnderlineOutlined,
  UnorderedListOutlined,
  OrderedListOutlined,
  LinkOutlined,
  PictureOutlined,
  ClearOutlined,
  CodeOutlined,
} from '@ant-design/icons';
import DOMPurify from 'dompurify';
import CodeMirror from '@uiw/react-codemirror';
import { html as cmHtml } from '@codemirror/lang-html';
import { EditorView } from '@codemirror/view';
import { html_beautify } from 'js-beautify';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import PageHeader from '../components/common/PageHeader';
import emailTemplateService from '../services/emailTemplateService';

dayjs.extend(relativeTime);

// Strip base64/data-URI images anywhere we sanitize — they're blocked by Outlook/Gmail
// on send and bloat stored HTML. Hosted https images (added via Insert image) are kept.
DOMPurify.addHook('uponSanitizeElement', (node, data) => {
  if (data.tagName === 'img' && node.getAttribute) {
    const src = (node.getAttribute('src') || '').trim().toLowerCase();
    if (src.startsWith('data:') && node.parentNode) {
      node.parentNode.removeChild(node);
    }
  }
});

const SANITIZE_OPTS = { WHOLE_DOCUMENT: true, ADD_TAGS: ['style'], ADD_ATTR: ['target'] };
const sanitizeDoc = (html) => DOMPurify.sanitize(html || '', SANITIZE_OPTS);

// Minimal styling injected INTO the editor iframe so editing is comfortable without
// overriding the email's own styles.
const EDITOR_CONTENT_CSS = `
  html, body { margin: 0; }
  body { padding: 16px; -webkit-font-smoothing: antialiased; }
  body:focus { outline: none; }
  img { max-width: 100%; }
`;

// Pretty-print serialized email HTML so the code tab is readable — the WYSIWYG
// serializer emits it as one long line.
const formatHtml = (html) => {
  try {
    return html_beautify(html || '', {
      indent_size: 2,
      wrap_line_length: 0,
      preserve_newlines: true,
      max_preserve_newlines: 1,
    });
  } catch {
    return html || '';
  }
};

const CM_EXTENSIONS = [cmHtml(), EditorView.lineWrapping];

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
  const [isDirty, setIsDirty] = useState(false);
  const [editorRev, setEditorRev] = useState(0); // bump to remount the WYSIWYG iframe from bodyHtml
  // CodeMirror doc seed — replaced only on external changes (tab entry, template switch,
  // save). Feeding every keystroke back through `value` would reset the doc mid-typing
  // whenever a render carries a slightly stale bodyHtml, silently dropping characters.
  const [htmlView, setHtmlView] = useState({ rev: 0, text: '' });

  // Insert-image-by-URL modal
  const [imgModalOpen, setImgModalOpen] = useState(false);
  const [imgUrl, setImgUrl] = useState('');
  const [imgAlt, setImgAlt] = useState('');

  const bodyEditorRef = useRef(null);   // WYSIWYG editing iframe
  const savedSelRef = useRef(null);     // last caret range inside the iframe
  const htmlDirtyRef = useRef(false);   // bodyHtml changed via the HTML tab since the iframe last loaded

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
    setActiveTab('1');
    setIsDirty(false);
    savedSelRef.current = null;
    htmlDirtyRef.current = false;
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

  // srcDoc for the editor iframe — keyed on (template id, editorRev) so in-place edits and
  // re-saves don't reload the iframe and reset the caret. editorRev is bumped only when raw
  // HTML edits need to be pushed back into the visual editor.
  const editorSrcDoc = useMemo(
    () => sanitizeDoc(bodyHtml || '<p style="font-family:sans-serif;color:#8a8f8c">Empty template.</p>'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedTemplate?.id, editorRev]
  );

  // ----- iframe editor plumbing -----

  // Serialize the editor document without the editor-comfort CSS we inject on load,
  // so it never leaks into the HTML tab or saved templates.
  const serializeEditorDoc = (doc) => {
    const clone = doc.documentElement.cloneNode(true);
    clone.querySelectorAll('style[data-editor-css]').forEach(el => el.remove());
    return clone.outerHTML;
  };

  const syncFromEditor = () => {
    const doc = bodyEditorRef.current?.contentDocument;
    // designMode is only 'on' once handleEditorLoad has wired the document — don't
    // serialize the transient about:blank document before that.
    if (doc && doc.designMode === 'on') setBodyHtml(serializeEditorDoc(doc));
  };

  const focusAndRestore = () => {
    const iframe = bodyEditorRef.current;
    const doc = iframe?.contentDocument;
    if (!doc) return null;
    iframe.contentWindow?.focus();
    const sel = doc.getSelection?.();
    if (sel && savedSelRef.current) {
      try {
        sel.removeAllRanges();
        sel.addRange(savedSelRef.current);
      } catch { /* range may be stale — ignore */ }
    }
    return doc;
  };

  const exec = (command, value = null) => {
    const doc = focusAndRestore();
    if (!doc) return;
    try { doc.execCommand(command, false, value); } catch { /* noop */ }
    syncFromEditor();
    setIsDirty(true);
  };

  const handleEditorLoad = () => {
    const doc = bodyEditorRef.current?.contentDocument;
    if (!doc) return;
    doc.designMode = 'on';

    // Drop editor-CSS copies that leaked into templates saved before serialization stripped them.
    doc.querySelectorAll('style').forEach(s => {
      if (s.textContent.trim() === EDITOR_CONTENT_CSS.trim()) s.remove();
    });
    const style = doc.createElement('style');
    style.textContent = EDITOR_CONTENT_CSS;
    style.setAttribute('data-editor-css', '1');
    doc.head?.appendChild(style);

    doc.addEventListener('input', () => {
      syncFromEditor();
      setIsDirty(true);
    });
    doc.addEventListener('selectionchange', () => {
      const sel = doc.getSelection?.();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        if (doc.body?.contains(range.commonAncestorContainer)) {
          savedSelRef.current = range.cloneRange();
        }
      }
    });
    // Block image paste/drop (no image hosting; base64 is unreliable in real mail clients).
    doc.addEventListener('paste', (e) => {
      const items = e.clipboardData?.items || [];
      const hasImage = Array.from(items).some(it => it.type?.startsWith('image/'));
      if (hasImage) {
        e.preventDefault();
        message.info('Pasted images aren’t supported. Use "Insert image" to add a hosted URL.');
        return;
      }
      // Tables/rich text paste natively; strip any data-URI images that ride along in HTML.
      setTimeout(() => {
        doc.querySelectorAll('img[src^="data:"]').forEach(el => el.remove());
        syncFromEditor();
      }, 0);
    }, true);
    doc.addEventListener('drop', (e) => {
      const files = e.dataTransfer?.files || [];
      if (Array.from(files).some(f => f.type?.startsWith('image/'))) {
        e.preventDefault();
        message.info('Dropped images aren’t supported. Use "Insert image" to add a hosted URL.');
      }
    }, true);
  };

  // Helper to insert placeholders at cursor position inside the editor iframe.
  const handleInsertPlaceholder = (rawPlaceholderName) => {
    const cleanPlaceholder = rawPlaceholderName.replace(/[{}]/g, '');
    const hasSingleBrackets = selectedTemplate.placeholders.some(
      p => p.startsWith('{') && !p.startsWith('{{')
    );
    const placeholderText = hasSingleBrackets
      ? `{${cleanPlaceholder}}`
      : `{{${cleanPlaceholder}}}`;

    const doc = focusAndRestore();
    if (!doc) return;
    try { doc.execCommand('insertText', false, placeholderText); } catch { /* noop */ }
    syncFromEditor();
    setIsDirty(true);
  };

  const handleInsertLink = () => {
    const url = window.prompt('Link URL (https://…)');
    if (url && url.trim()) exec('createLink', url.trim());
  };

  const confirmInsertImage = () => {
    const url = imgUrl.trim();
    if (!url) { setImgModalOpen(false); return; }
    const safeUrl = url.replace(/"/g, '&quot;');
    const safeAlt = imgAlt.trim().replace(/"/g, '&quot;');
    exec('insertHTML', `<img src="${safeUrl}" alt="${safeAlt}" style="max-width:100%" />`);
    setImgModalOpen(false);
    setImgUrl('');
    setImgAlt('');
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
    // The live iframe DOM is authoritative only while the visual editor is active;
    // on the HTML/Preview tabs, bodyHtml is current and the iframe may be stale.
    const doc = activeTab === '1' ? bodyEditorRef.current?.contentDocument : null;
    const rawBody = doc && doc.designMode === 'on' ? serializeEditorDoc(doc) : bodyHtml;
    const cleanBody = sanitizeDoc(rawBody);

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
        // Code tab shows exactly what was persisted (sanitized form).
        if (activeTab === '2') {
          setHtmlView(v => ({ rev: v.rev + 1, text: formatHtml(cleanBody) }));
        }
        setTemplates(prev =>
          prev.map(t =>
            t.id === selectedTemplate.id
              ? { ...t, subject, body_html: cleanBody, modified_at: new Date() }
              : t
          )
        );
        // Keep the same id so the editor iframe does not reload.
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
        err.response?.data?.message || 'Error occurred while saving the email template.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleTabChange = (key) => {
    // Leaving the visual editor: capture the live DOM into bodyHtml.
    let html = bodyHtml;
    if (activeTab === '1') {
      const doc = bodyEditorRef.current?.contentDocument;
      if (doc && doc.designMode === 'on') html = serializeEditorDoc(doc);
    }
    // Entering the code tab: pretty-print so the source is readable (whitespace-only
    // change — doesn't mark the template dirty or force an editor reload).
    if (key === '2') {
      html = formatHtml(html);
      setHtmlView(v => ({ rev: v.rev + 1, text: html }));
    }
    if (html !== bodyHtml) setBodyHtml(html);
    // Entering the visual editor after raw-HTML edits: remount the iframe from bodyHtml.
    if (key === '1' && htmlDirtyRef.current) {
      htmlDirtyRef.current = false;
      savedSelRef.current = null; // saved ranges belong to the destroyed document
      setEditorRev(r => r + 1);
    }
    setActiveTab(key);
  };

  const handleHtmlChange = (value) => {
    setBodyHtml(value);
    setIsDirty(true);
    setValidationError('');
    htmlDirtyRef.current = true;
  };

  const handleCopyHtml = async () => {
    try {
      await navigator.clipboard.writeText(bodyHtml || '');
      message.success('Email HTML copied to clipboard.');
    } catch {
      message.error('Could not copy to clipboard.');
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
  const previewSrcDoc = sanitizeDoc(
    preview.body || '<p style="font-family:sans-serif;color:#8a8f8c;padding:24px">This template has no body content.</p>'
  );

  const categories = [
    { key: 'all', label: 'All Templates' },
    { key: 'general', label: 'General / Alerts' },
    { key: 'shortlist', label: 'Shortlist' },
    { key: 'interview', label: 'Interviews' },
    { key: 'offer', label: 'Offer Letter' },
    { key: 'rejection', label: 'Rejection' },
    { key: 'follow_up', label: 'Follow Up' },
  ];

  // Keyboard activation helper for custom clickable elements.
  const onActivate = (handler) => (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handler();
    }
  };

  const noBlur = (e) => e.preventDefault(); // keep caret in the iframe when clicking toolbar

  const toolbarBtn = (icon, title, onClick) => (
    <Tooltip title={title}>
      <Button
        type="text"
        size="small"
        icon={icon}
        onMouseDown={noBlur}
        onClick={onClick}
        className="email-editor-toolbar__btn"
      />
    </Tooltip>
  );

  const editorTab = selectedTemplate && (
    <div className="email-tabpane email-editor-pane" style={{ paddingTop: 16 }}>
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
            setIsDirty(true);
          }}
          placeholder="Enter email subject line..."
          maxLength={255}
          showCount
          style={{ borderRadius: 8, fontSize: 14, padding: '8px 12px', border: '1px solid var(--border)' }}
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
          <Text strong style={{ fontSize: 12 }}>Available Placeholders</Text>
          <Tooltip title="Click to insert at the cursor position in the email body">
            <InfoCircleOutlined style={{ fontSize: 12, color: 'var(--text-2)', cursor: 'pointer' }} />
          </Tooltip>
        </Space>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
          {selectedTemplate.placeholders.map(p => {
            const cleanP = p.replace(/[{}]/g, '');
            return (
              <Tag
                key={p}
                role="button"
                tabIndex={0}
                aria-label={`Insert placeholder ${cleanP}`}
                onMouseDown={noBlur}
                onClick={() => handleInsertPlaceholder(cleanP)}
                onKeyDown={onActivate(() => handleInsertPlaceholder(cleanP))}
                style={{ ...brandTagStyle, cursor: 'pointer', padding: '3px 8px', fontSize: 11, fontWeight: 500 }}
                className="placeholder-tag"
              >
                +{cleanP}
              </Tag>
            );
          })}
        </div>
      </div>

      {/* WYSIWYG email body editor */}
      <div className="email-body-section">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
          <Text strong style={{ fontSize: 13 }}>Email Body</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>
            Edit visually like Outlook, or switch to the HTML Code tab for the raw source.
          </Text>
        </div>
        <div className="email-editor-shell">
          <div className="email-editor-toolbar">
            {toolbarBtn(<BoldOutlined />, 'Bold', () => exec('bold'))}
            {toolbarBtn(<ItalicOutlined />, 'Italic', () => exec('italic'))}
            {toolbarBtn(<UnderlineOutlined />, 'Underline', () => exec('underline'))}
            <span className="email-editor-toolbar__sep" />
            {toolbarBtn(<UnorderedListOutlined />, 'Bulleted list', () => exec('insertUnorderedList'))}
            {toolbarBtn(<OrderedListOutlined />, 'Numbered list', () => exec('insertOrderedList'))}
            <span className="email-editor-toolbar__sep" />
            {toolbarBtn(<LinkOutlined />, 'Insert link', handleInsertLink)}
            {toolbarBtn(<PictureOutlined />, 'Insert image by URL', () => setImgModalOpen(true))}
            <span className="email-editor-toolbar__sep" />
            {toolbarBtn(<ClearOutlined />, 'Clear formatting', () => exec('removeFormat'))}
          </div>
          <iframe
            key={`${selectedTemplate.id}:${editorRev}`}
            ref={bodyEditorRef}
            title="Email body editor"
            className="email-editor-iframe"
            srcDoc={editorSrcDoc}
            onLoad={handleEditorLoad}
          />
        </div>
      </div>
    </div>
  );

  const htmlTab = selectedTemplate && (
    <div className="email-tabpane email-html-pane" style={{ paddingTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
        <Text strong style={{ fontSize: 13 }}>Raw HTML Source</Text>
        <Space size={8}>
          <Text type="secondary" style={{ fontSize: 11 }}>
            Full HTML document. Sanitized on save and when switching to the visual editor.
          </Text>
          <Button size="small" icon={<CopyOutlined />} onClick={handleCopyHtml}>
            Copy HTML
          </Button>
        </Space>
      </div>
      <div className="email-html-editor">
        <CodeMirror
          key={`${selectedTemplate.id}:${htmlView.rev}`}
          value={htmlView.text}
          onChange={handleHtmlChange}
          extensions={CM_EXTENSIONS}
          height="100%"
          basicSetup={{ foldGutter: true, highlightActiveLine: true, autocompletion: true }}
          aria-label="Raw email HTML source"
        />
      </div>
    </div>
  );

  const previewTab = selectedTemplate && (
    <div className="email-tabpane email-preview-pane" style={{ paddingTop: 16 }}>
      <div
        className="email-preview-shell"
        style={{
          border: '1px solid var(--border)',
          borderRadius: 12,
          background: '#ffffff',
          boxShadow: 'var(--shadow-sm)',
          overflow: 'hidden',
        }}
      >
        {/* Mail-client shell header */}
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

        {/* Faithful, isolated render of the compiled email */}
        <iframe
          title="Email preview"
          sandbox=""
          className="email-preview-iframe"
          srcDoc={previewSrcDoc}
        />
      </div>
    </div>
  );

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
            className="glass no-lift email-pane-card email-list-card"
            style={{
              borderRadius: 'var(--border-radius-lg)',
              border: '1px solid var(--border-light)',
              boxShadow: 'var(--shadow-sm)',
            }}
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
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-2)' }}>
                No templates found.
              </div>
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
              className="glass no-lift email-pane-card email-editor-card"
              style={{
                borderRadius: 'var(--border-radius-lg)',
                border: '1px solid var(--border-light)',
                boxShadow: 'var(--shadow-md)',
              }}
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

              <Tabs
                activeKey={activeTab}
                onChange={handleTabChange}
                type="card"
                className="email-editor-tabs"
                style={{ marginBottom: 0 }}
                items={[
                  { key: '1', label: (<span><EditOutlined /> Editor</span>), children: editorTab },
                  { key: '2', label: (<span><CodeOutlined /> HTML Code</span>), children: htmlTab },
                  { key: '3', label: (<span><EyeOutlined /> Live Preview</span>), children: previewTab },
                ]}
              />
            </Card>
          ) : (
            <Card
              className="glass no-lift email-pane-card email-placeholder-card"
              style={{
                borderRadius: 'var(--border-radius-lg)',
                border: '1px solid var(--border-light)',
                boxShadow: 'var(--shadow-sm)',
                minHeight: '400px',
              }}
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

      {/* Insert image by URL */}
      <Modal
        title="Insert image by URL"
        open={imgModalOpen}
        onOk={confirmInsertImage}
        onCancel={() => setImgModalOpen(false)}
        okText="Insert"
        centered
        destroyOnClose
      >
        <Input
          placeholder="https://…"
          value={imgUrl}
          onChange={e => setImgUrl(e.target.value)}
          onPressEnter={confirmInsertImage}
          style={{ marginBottom: 8 }}
          autoFocus
        />
        <Input
          placeholder="Alt text (optional)"
          value={imgAlt}
          onChange={e => setImgAlt(e.target.value)}
          style={{ marginBottom: 8 }}
        />
        <Text type="secondary" style={{ fontSize: 12 }}>
          Use a hosted <b>https</b> image URL. Local/pasted images aren’t supported because they
          don’t render reliably in delivered email.
        </Text>
      </Modal>
    </div>
  );
}
