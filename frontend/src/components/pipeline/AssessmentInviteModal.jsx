/**
 * AssessmentInviteModal.jsx — compose-and-send an Evalground test invite for
 * one candidate's Assessment-stage journey. There is no Evalground API, so
 * this can't auto-generate a test link — the recruiter creates the test in
 * Evalground's own dashboard, then pastes the link into the pre-filled
 * template below before sending. Deliberately a plain Input/TextArea rather
 * than PipelineDrawer.jsx's richer SimpleHtmlEditor iframe editor — this is
 * a much simpler one-off compose, not worth exporting that editor out of an
 * already-large file.
 */
import { useEffect, useState } from 'react';
import { Modal, Input, Button, Space, Typography, Alert } from 'antd';
import { MailOutlined } from '@ant-design/icons';
import { MODAL_WIDTH } from './modalWidths';

const { TextArea } = Input;

function defaultTemplate({ candidateName, position, deadlineDays }) {
  return {
    subject: 'Your AAPNA IQ / Tech Assessment — Evalground Test Invite',
    body: `Hi ${candidateName || 'there'},\n\nAs the next step for ${position || 'the role'}, please complete the Evalground assessment using the link below:\n\n[PASTE EVALGROUND TEST LINK HERE]\n\nPlease complete this within ${deadlineDays || 2} day(s) of receiving this email.\n\nBest regards,\nAAPNA Talent Acquisition Team`,
  };
}

export default function AssessmentInviteModal({ open, onClose, candidateName, position, deadlineDays, sending, onSend }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  useEffect(() => {
    if (open) {
      const t = defaultTemplate({ candidateName, position, deadlineDays });
      setSubject(t.subject);
      setBody(t.body);
    }
  }, [open, candidateName, position, deadlineDays]);

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
      </Space>
    </Modal>
  );
}
