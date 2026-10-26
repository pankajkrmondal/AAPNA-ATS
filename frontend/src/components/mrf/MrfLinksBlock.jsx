/**
 * MrfLinksBlock (L08, D8): "Links for this MRF" in the MRF details modal.
 *
 * Shows the hiring manager's request-form link with Copy, and opens Forms &
 * Links filtered to this MRF. The approvers' status lines and "Re-send approval
 * links" are not repeated here: the Approval trail directly above already has
 * them, and approval links are never copied (D3).
 *
 * Hidden when VITE_FORMS_LINKS_ENABLED is off, and for users the Forms & Links
 * endpoint refuses (it is staff only).
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { App as AntApp, Button, Dropdown, Space, Tag, Typography } from 'antd';
import { CopyOutlined, LinkOutlined, MailOutlined } from '@ant-design/icons';
import formsLinksService from '../../services/formsLinksService';
import { FORMS_LINKS_ENABLED } from '../../utils/featureFlags';
import { copyText } from '../../utils/clipboard';

const { Text } = Typography;

export default function MrfLinksBlock({ requestId, mrfId }) {
  const { message } = AntApp.useApp();
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!FORMS_LINKS_ENABLED || !requestId) return undefined;
    let alive = true;
    formsLinksService.list({ mrfRequest: requestId, mrf: mrfId || undefined, states: 'all', pageSize: 50 })
      .then((res) => { if (alive) setRows((res.data?.data || res.data)?.rows || []); })
      .catch(() => { if (alive) setRows(null); });
    return () => { alive = false; };
  }, [requestId, mrfId]);

  if (!FORMS_LINKS_ENABLED || rows == null) return null;
  const form = rows.find((r) => r.type === 'mrf_form');
  const approvals = rows.filter((r) => r.type === 'mrf_approval');
  const openApprovals = approvals.filter((r) => r.state === 'open').length;

  const copy = async (withMessage) => {
    setBusy(true);
    try {
      const res = await formsLinksService.copy('mrf_form', form.id);
      const { url, message: text } = res.data?.data || {};
      if (await copyText(withMessage ? text : url)) message.success(withMessage ? 'Message copied.' : 'Form link copied.');
      else message.error('Could not copy to the clipboard.');
    } catch (err) {
      message.error(err?.response?.data?.message || 'Could not copy the link.');
    } finally {
      setBusy(false);
    }
  };

  const allLinks = mrfId ? `/forms-links?mrf=${mrfId}` : `/forms-links?q=${encodeURIComponent(form?.recipientEmail || '')}`;

  return (
    <div className="glass-card" style={{ padding: '12px 14px', borderRadius: 12, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Text strong><LinkOutlined /> Links for this MRF</Text>
        <Link to={allLinks} style={{ fontSize: 12 }}>Open in Forms &amp; Links →</Link>
      </div>
      {form ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <div>
            <div style={{ fontSize: 13 }}>MRF request form · {form.recipientName || form.recipientEmail}</div>
            <Text type="secondary" style={{ fontSize: 12 }}>{form.recipientEmail}</Text>{' '}
            <Tag color={form.state === 'done' ? 'green' : form.state === 'open' ? 'gold' : 'default'} style={{ marginLeft: 4 }}>{form.status}</Tag>
          </div>
          {(form.actions || []).includes('copy') && (
            <Space>
              <Dropdown.Button
                size="small"
                loading={busy}
                onClick={() => copy(false)}
                menu={{ items: [{ key: 'msg', label: 'Copy with message', icon: <MailOutlined /> }], onClick: () => copy(true) }}
              >
                <CopyOutlined /> Copy form link
              </Dropdown.Button>
            </Space>
          )}
        </div>
      ) : (
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>No request-form link was sent for this MRF.</Text>
      )}
      {approvals.length > 0 && (
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>
          Approval links: {approvals.length} sent{openApprovals ? `, ${openApprovals} still open` : ''}. Their status and &ldquo;Re-send approval links&rdquo; are in the approval trail above.
        </Text>
      )}
    </div>
  );
}
