/**
 * AssessmentInviteModal.jsx — compose-and-send an Evalground test invite for
 * one candidate's Assessment-stage journey. There is no Evalground API, so
 * this can't auto-generate a test link — the recruiter creates the test in
 * Evalground's own dashboard, then pastes the link into the pre-filled
 * template below before sending. Deliberately a plain Input/TextArea rather
 * than PipelineDrawer.jsx's richer SimpleHtmlEditor iframe editor — this is
 * a much simpler one-off compose, not worth exporting that editor out of an
 * already-large file.
 *
 * U02: the role's JD goes with the invite (attached, or as a link when the
 * file is too large); `hasJd` says whether the MRF has one on record.
 *
 * U02b: the text starts from the stored "Evalground Assessment Invite"
 * template (`template`, from the invite-state call) when it exists, else the
 * built-in copy below. Its "Attach the JD" switch is honoured, and a
 * {{jd_link}} line left in the text is where the JD card goes.
 */
import { useEffect, useState } from 'react';
import { Modal, Input, Button, Space, Typography, Alert } from 'antd';
import { MailOutlined, PaperClipOutlined } from '@ant-design/icons';
import { MODAL_WIDTH } from './modalWidths';

const { TextArea } = Input;

function defaultTemplate({ candidateName, position, deadlineDays }) {
  return {
    subject: 'Your AAPNA IQ / Tech Assessment — Evalground Test Invite',
    body: `Hi ${candidateName || 'there'},\n\nAs the next step for ${position || 'the role'}, please complete the Evalground assessment using the link below:\n\n[PASTE EVALGROUND TEST LINK HERE]\n\nPlease complete this within ${deadlineDays || 2} day(s) of receiving this email.\n\nBest regards,\nAAPNA Talent Acquisition Team`,
  };
}

/** The template's HTML as the plain text this box edits: paragraphs split by a blank line. */
function htmlToPlainText(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  doc.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  doc.querySelectorAll('p, div, li, h1, h2, h3, h4, tr').forEach((el) => el.append('\n\n'));
  return (doc.body.textContent || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Fills the template's tokens; {{jd_link}} stays, it marks where the JD card goes. */
function fillTokens(text, values) {
  return Object.entries(values).reduce(
    (out, [key, val]) => out.split(`{{${key}}}`).join(val).split(`{${key}}`).join(val),
    String(text || ''),
  );
}

function storedTemplate(template, { candidateName, position, deadlineDays }) {
  const values = {
    candidate_name: candidateName || 'there',
    position: position || 'the role',
    job_title: position || 'the role',
    deadline_days: String(deadlineDays || 2),
  };
  return { subject: fillTokens(template.subject, values), body: fillTokens(htmlToPlainText(template.body_html), values) };
}

export default function AssessmentInviteModal({
  open, onClose, candidateName, position, deadlineDays, hasJd = false, template = null, sending, onSend,
}) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  // Keyed on the template's text, not the object, so a background refetch
  // never wipes what the recruiter has typed.
  const tplSubject = template?.subject || '';
  const tplBody = template?.body_html || '';
  const jdOff = template?.attach_jd === false;

  useEffect(() => {
    if (open) {
      const args = { candidateName, position, deadlineDays };
      const t = tplBody ? storedTemplate({ subject: tplSubject, body_html: tplBody }, args) : defaultTemplate(args);
      setSubject(t.subject);
      setBody(t.body);
    }
  }, [open, candidateName, position, deadlineDays, tplSubject, tplBody]);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title="Send Evalground Invite"
      width={MODAL_WIDTH.FORM}
      footer={[
        <Button key="cancel" onClick={onClose}>Cancel</Button>,
        <Button key="send" type="primary" icon={<MailOutlined />} loading={sending} disabled={!subject.trim() || !body.trim()} onClick={() => onSend({ method: 'email', subject, body })}>
          Send Invite
        </Button>,
      ]}
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Alert type="info" showIcon message="There is no Evalground API — create the test in Evalground yourself, then paste the link into the body below before sending." />
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" />
        <TextArea rows={10} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Body" />
        {jdOff ? (
          <Typography.Text type="secondary" style={{ fontSize: 12.5 }} data-testid="invite-jd-off">
            The JD is switched off for this email on the Email Templates page: it goes without one.
          </Typography.Text>
        ) : hasJd ? (
          <Typography.Text style={{ fontSize: 12.5 }} data-testid="invite-jd-attached">
            <PaperClipOutlined style={{ marginInlineEnd: 4 }} />
            The JD is attached (as a link if the file is too large{/\{\{?\s*jd_link\s*\}?\}/.test(body) ? ', placed where {{jd_link}} is' : ''}).
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12.5 }} data-testid="invite-jd-missing">
            This MRF has no JD file: the email goes without one.
          </Typography.Text>
        )}
      </Space>
    </Modal>
  );
}
