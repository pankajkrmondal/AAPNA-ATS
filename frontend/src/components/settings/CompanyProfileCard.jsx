/**
 * Settings card: "Candidate emails: About AAPNA" (Phase 3 "Do Now", N17).
 *
 * The text an admin writes here goes under the body of every shortlist email
 * sent from the Keyword filtering tab. Plain text; the server escapes it and
 * keeps line breaks. Empty adds nothing. Admin only, like the API.
 */
import { useEffect, useState } from 'react';
import { Card, Typography, Input, Button, Modal, message } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import settingsService from '../../services/settingsService';

const { Title, Text } = Typography;

// Must match COMPANY_PROFILE_MAX_LENGTH in backend/src/services/companyProfile.service.js.
const MAX_LENGTH = 3000;

export default function CompanyProfileCard() {
  const [text, setText] = useState('');
  const [saved, setSaved] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    settingsService.getCompanyProfile()
      .then((res) => {
        const value = res.data?.data?.text || '';
        setText(value);
        setSaved(value);
      })
      .catch(() => message.error('Failed to load the About AAPNA text.'))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await settingsService.saveCompanyProfile({ text });
      setSaved(text);
      message.success('About AAPNA text saved.');
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to save the About AAPNA text.');
    } finally {
      setSaving(false);
    }
  };

  const trimmed = text.trim();

  return (
    <Card bordered={false} className="glass-card" style={{ marginBottom: 24 }} data-testid="company-profile-card">
      <div style={{ marginBottom: 16 }}>
        <Title level={4} style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, margin: '0 0 6px 0' }}>
          Candidate emails: About AAPNA
        </Title>
        <Text type="secondary" style={{ fontSize: 13 }}>
          Added under the body of shortlist emails sent from Keyword filtering. Leave it empty to add nothing.
        </Text>
      </div>

      <label htmlFor="company-profile-text" style={{ display: 'block', fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
        About AAPNA text
      </label>
      <Input.TextArea
        id="company-profile-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={loading}
        rows={7}
        maxLength={MAX_LENGTH}
        showCount
      />
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
        Plain text. Line breaks are kept.
      </Text>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        <Button onClick={() => setPreviewOpen(true)} disabled={loading || !trimmed}>
          Preview in email
        </Button>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          onClick={save}
          loading={saving}
          disabled={loading || text === saved}
        >
          Save
        </Button>
      </div>

      <Modal
        title="How it appears in the email"
        open={previewOpen}
        onCancel={() => setPreviewOpen(false)}
        footer={<Button onClick={() => setPreviewOpen(false)}>Close</Button>}
        width={600}
      >
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 16 }}>
          <Text type="secondary" style={{ fontSize: 12.5 }}>…the shortlist email body…</Text>
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>About AAPNA</div>
            <div style={{ whiteSpace: 'pre-wrap', fontSize: 13.5, lineHeight: 1.6 }}>{trimmed}</div>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
