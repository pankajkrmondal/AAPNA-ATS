/**
 * DecisionEmailModal — shared Shortlist/Reject confirmation used from Candidate
 * Screening. Mirrors the "decision + editable outcome email" pattern already
 * proven in CandidatePipelinePrototype.jsx's v6 outcome modal, wired here to the
 * real templates/send pipeline: mandatory reason for Reject, mandatory "Tag to
 * Open JD" for Keyword-tab Shortlist (so the notification names a real role
 * instead of the generic fallback copy), and an opt-out "send email" checkbox
 * with an editable Subject/Body seeded from the live rpa_email_templates row.
 */
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Modal, Space, Typography, Select, Input, Checkbox, Tag } from 'antd';
import { MailOutlined } from '@ant-design/icons';
import emailTemplateService from '../../services/emailTemplateService';
import { EmailEditorTabs } from '../common/EmailBodyEditor';

const { Text } = Typography;

const REJECT_REASONS = [
  'Skills mismatch', 'High salary expectation', 'High notice period',
  'Weak communication', 'Frequent job changes', 'Failed assessment threshold',
  'Unresponsive / no-show', 'Client rejected profile', 'Other',
];

const CATEGORY_BY_DECISION = { shortlist: 'shortlist', reject: 'rejection' };

/**
 * Exact mirror of the {role_paragraph} wording shortlistCandidates() composes
 * server-side (backend/src/services/screening.service.js) — used to bake real,
 * static text into the editable body once a role is known, instead of leaving
 * {role_paragraph} as a raw token the recruiter has to mentally resolve.
 */
function buildRoleParagraph(roleName) {
  return roleName
    ? `<p>Thank you for your interest in opportunities with AAPNA Infotech. After reviewing your profile, we are pleased to inform you that you have been shortlisted for the position of <strong>${roleName}</strong> at AAPNA Infotech. Please note that this role is a <strong>Work from Home (WFH)</strong> opportunity.</p>`
    : `<p>Thank you for your interest in opportunities with AAPNA Infotech. After reviewing your profile in our talent database, we are pleased to inform you that your profile has been shortlisted for a suitable position at AAPNA Infotech. Please note that this opportunity is a <strong>Work from Home (WFH)</strong> role.</p>`;
}

/** Lightweight client-side mirror of the backend's compileTemplate(), for preview only. */
function compilePreview(subject, body, replacements) {
  let s = subject || '';
  let b = body || '';
  for (const [key, val] of Object.entries(replacements)) {
    const str = val ?? '';
    s = s.split(`{{${key}}}`).join(str).split(`{${key}}`).join(str);
    b = b.split(`{{${key}}}`).join(str).split(`{${key}}`).join(str);
  }
  return { subject: s, body: b };
}

/**
 * @param {{
 *   open: boolean,
 *   decision: 'shortlist' | 'reject',
 *   activeTab: 'jd' | 'keyword',
 *   candidates: Array<{ id: number, Name?: string, EmailID?: string }>,
 *   roles: Array<{ id: number, role: string, number_of_positions: number }>,
 *   defaultMrfId?: number,
 *   defaultRoleName?: string,
 *   confirmLoading?: boolean,
 *   onCancel: () => void,
 *   onConfirm: (result: { mrfId: number, roleName: string|null, reason?: string, sendEmail: boolean, emailOverride: {subject:string, body:string}|null }) => void,
 * }} props
 */
export default function DecisionEmailModal({
  open,
  decision,
  activeTab,
  candidates,
  roles,
  defaultMrfId,
  defaultRoleName,
  confirmLoading = false,
  onCancel,
  onConfirm,
}) {
  const isReject = decision === 'reject';
  // Keyword-tab candidates aren't tied to a role by default (unlike JD-tab, where
  // defaultMrfId/defaultRoleName are already known) — require tagging one for both
  // decisions so the notification email names the actual role either way.
  const requireRoleTag = activeTab === 'keyword';

  const [selectedRoleId, setSelectedRoleId] = useState(undefined);
  const [reason, setReason] = useState(undefined);
  const [customReason, setCustomReason] = useState('');
  const [sendEmail, setSendEmail] = useState(true);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [template, setTemplate] = useState(null);
  const [loadingTemplate, setLoadingTemplate] = useState(false);
  // Bumped every time {role_paragraph} is (re-)baked into `body` as static text,
  // so the editor (uncontrolled after mount) remounts and shows the fresh text.
  const [roleParagraphRev, setRoleParagraphRev] = useState(0);

  useEffect(() => {
    if (!open) return undefined;

    setSelectedRoleId(activeTab === 'jd' ? defaultMrfId : undefined);
    setReason(undefined);
    setCustomReason('');
    setSendEmail(true);
    setTemplate(null);
    setSubject('');
    setBody('');
    setRoleParagraphRev(0);

    let cancelled = false;
    setLoadingTemplate(true);
    emailTemplateService.getEmailTemplates()
      .then((res) => {
        if (cancelled) return;
        const list = res.data?.data || res.data || [];
        const category = CATEGORY_BY_DECISION[decision];
        const tpl = (Array.isArray(list) ? list : []).find((t) => t.category === category && t.is_active);
        if (tpl) {
          setTemplate(tpl);
          setSubject(tpl.subject);
          setBody(tpl.body_html);
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingTemplate(false); });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, decision, activeTab, defaultMrfId]);

  const roleName = useMemo(() => {
    if (activeTab === 'jd') return defaultRoleName || null;
    const r = (roles || []).find((role) => role.id === selectedRoleId);
    return r?.role || null;
  }, [activeTab, defaultRoleName, roles, selectedRoleId]);

  // Bake {role_paragraph} into `body` as real, static text — always derived from
  // the pristine template.body_html (not the live `body`, which may already have
  // the token substituted out), so this stays correct across role changes: shows
  // the generic fallback the moment the template loads, then the real role-named
  // paragraph as soon as one is tagged (immediately on JD tab, on selection on
  // Keyword tab), and re-resolves again if the tagged role is changed afterward.
  useLayoutEffect(() => {
    if (!template) return;
    const resolved = buildRoleParagraph(roleName);
    const resolvedBody = template.body_html
      .split('{{role_paragraph}}').join(resolved)
      .split('{role_paragraph}').join(resolved);
    setBody(resolvedBody);
    setRoleParagraphRev((r) => r + 1);
  }, [template, roleName]);

  const firstCandidateName = candidates?.[0]?.Name || 'Candidate';
  const preview = useMemo(() => {
    const roleParagraph = roleName
      ? `<p>...shortlisted for the position of <strong>${roleName}</strong> at AAPNA Infotech...</p>`
      : `<p>...shortlisted for a suitable position at AAPNA Infotech...</p>`;
    return compilePreview(subject, body, {
      candidate_name: firstCandidateName,
      position: roleName || 'the role',
      job_title: roleName || 'the role',
      role_paragraph: roleParagraph,
    });
  }, [subject, body, firstCandidateName, roleName]);

  const roleBlocked = requireRoleTag && !selectedRoleId;
  const reasonBlocked = isReject && (!reason || (reason === 'Other' && !customReason.trim()));
  const confirmDisabled = roleBlocked || reasonBlocked;
  // Keyword tab: nothing to preview until a role is tagged (the email's own
  // paragraph names that role) — JD tab always has one already, so it's never blocked.
  const roleReady = !requireRoleTag || Boolean(selectedRoleId);

  const handleOk = () => {
    const finalReason = reason === 'Other' ? customReason.trim() : reason;
    onConfirm({
      mrfId: activeTab === 'jd' ? (defaultMrfId || 0) : (selectedRoleId || 0),
      roleName: roleName || (isReject ? 'the role' : 'Manual Screening'),
      reason: isReject ? finalReason : undefined,
      sendEmail,
      emailOverride: sendEmail ? { subject, body } : null,
    });
  };

  const candidateCount = candidates?.length || 0;

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      onOk={handleOk}
      width={640}
      destroyOnClose
      confirmLoading={confirmLoading}
      okText={isReject ? 'Reject & continue' : 'Shortlist & continue'}
      okButtonProps={{ danger: isReject, disabled: confirmDisabled }}
      title={isReject ? 'Reject candidates' : 'Shortlist candidates'}
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Text type="secondary">
          {candidateCount} candidate{candidateCount === 1 ? '' : 's'} selected
        </Text>

        {activeTab === 'jd' && (
          <Text type="secondary" style={{ fontSize: 12.5 }}>
            Role: <Text strong>{defaultRoleName || 'Unknown role'}</Text>
          </Text>
        )}

        {requireRoleTag && (
          <div>
            <Text strong style={{ fontSize: 12.5 }}>Tag to Open JD <Text type="danger">*</Text></Text>
            <Text type="secondary" style={{ display: 'block', fontSize: 11.5, marginBottom: 4 }}>
              Required — so the notification names the actual role instead of generic fallback wording.
            </Text>
            <Select
              style={{ width: '100%' }}
              placeholder="Select an open role"
              value={selectedRoleId}
              onChange={setSelectedRoleId}
              showSearch
              optionFilterProp="label"
              options={(roles || []).map((r) => ({
                value: r.id,
                label: `${r.role} (${r.number_of_positions} opening${r.number_of_positions === 1 ? '' : 's'})`,
              }))}
            />
          </div>
        )}

        {isReject && (
          <div>
            <Text strong style={{ fontSize: 12.5 }}>Reason <Text type="danger">*</Text></Text>
            <Select
              style={{ width: '100%', marginTop: 4 }}
              placeholder="Select a rejection reason"
              value={reason}
              onChange={setReason}
              options={REJECT_REASONS.map((r) => ({ value: r, label: r }))}
            />
            {reason === 'Other' && (
              <Input
                style={{ marginTop: 8 }}
                placeholder="Specify the reason…"
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
              />
            )}
          </div>
        )}

        {!roleReady ? (
          <Text type="secondary" style={{ fontSize: 12.5, borderTop: '1px solid var(--border-light, #eaebe8)', paddingTop: 10, display: 'block' }}>
            Tag a role above to preview the notification email.
          </Text>
        ) : (
          <>
            <Checkbox checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)}>
              Send email notification to candidate(s)
            </Checkbox>

            {sendEmail && (
              <div style={{ borderTop: '1px solid var(--border-light, #eaebe8)', paddingTop: 10 }}>
                <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 6 }}>
                  <Text strong style={{ fontSize: 12.5 }}>
                    <MailOutlined style={{ marginInlineEnd: 4 }} /> Email
                  </Text>
                  {template
                    ? <Tag color="blue">Template — {template.name} (#{template.id})</Tag>
                    : loadingTemplate ? <Tag>Loading template…</Tag> : <Tag color="orange">No active template found</Tag>}
                </Space>

                <Input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Subject"
                  style={{ marginBottom: 8 }}
                />
                <EmailEditorTabs
                  key={`${template?.id ?? 'loading'}-${roleParagraphRev}`}
                  bodyHtml={body}
                  onBodyChange={setBody}
                  subject={subject}
                  previewSubject={preview.subject}
                  previewBodyHtml={preview.body}
                  placeholders={(template?.placeholders || []).filter((p) => p.replace(/[{}]/g, '') !== 'role_paragraph')}
                  compact
                  height={220}
                />
                <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
                  Editable before send — the exact text above goes out. Tokens like <code>{'{candidate_name}'}</code> (chips above the body) personalize per candidate when multiple are selected.
                  {candidateCount > 1 && ` Preview shown for ${firstCandidateName} (+${candidateCount - 1} more, personalized individually when sent).`}
                </Text>
              </div>
            )}
          </>
        )}
      </Space>
    </Modal>
  );
}
