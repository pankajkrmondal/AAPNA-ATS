/**
 * PendingScorecardLinkActions (L08, D8): the Forms & Links shortcut on the
 * scorecard report's "Still awaiting feedback" card.
 *
 *   - Copy link (and "Copy with message") while the link still works;
 *   - Re-send while it still works, or when it was never delivered;
 *   - Renew & re-send once it has expired (7 more days, same link, D5).
 *
 * Every action goes through /api/forms-links, so the copy is recorded on the
 * candidate's timeline and anything that sends an email asks first. Hidden when
 * VITE_FORMS_LINKS_ENABLED is off.
 */
import { App as AntApp, Button, Dropdown, Space } from 'antd';
import { CopyOutlined, MailOutlined, SendOutlined, SyncOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import formsLinksService from '../../services/formsLinksService';
import { FORMS_LINKS_ENABLED } from '../../utils/featureFlags';
import { copyText } from '../../utils/clipboard';

export default function PendingScorecardLinkActions({ pending, pipelineId }) {
  const { message, modal } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  if (!FORMS_LINKS_ENABLED || !pending?.scorecard_id) return null;
  const id = pending.scorecard_id;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['scorecard-report', pipelineId] });
    queryClient.invalidateQueries({ queryKey: ['pipeline-timeline', pipelineId] });
  };

  const copy = async (withMessage) => {
    setBusy(true);
    try {
      const res = await formsLinksService.copy('scorecard', id);
      const { url, message: text } = res.data?.data || {};
      if (await copyText(withMessage ? text : url)) {
        message.success(withMessage ? 'Message copied. Paste it into WhatsApp or Teams.' : 'Scorecard link copied.');
      } else {
        message.error('Could not copy to the clipboard.');
      }
      refresh();
    } catch (err) {
      message.error(err?.response?.data?.message || 'Could not copy the link.');
    } finally {
      setBusy(false);
    }
  };

  const send = (renew) => modal.confirm({
    title: renew ? 'Renew for 7 days and re-send?' : 'Re-send the scorecard email?',
    content: renew
      ? `The same link starts working again for 7 days, and ${pending.recipient_email} gets the email again.`
      : `${pending.recipient_email} gets the scorecard link by email.`,
    okText: renew ? 'Renew & re-send' : 'Re-send',
    onOk: async () => {
      try {
        if (renew) await formsLinksService.renew('scorecard', id);
        else await formsLinksService.resend('scorecard', id);
        message.success(renew ? 'Renewed and sent again.' : 'Sent again.');
        refresh();
      } catch (err) {
        message.error(err?.response?.data?.message || 'That did not work. Please try again.');
      }
    },
  });

  if (pending.expired) {
    return (
      <Button size="small" type="primary" icon={<SyncOutlined />} style={{ marginTop: 4 }} onClick={() => send(true)}>
        Renew &amp; re-send
      </Button>
    );
  }
  return (
    <Space size={6} wrap style={{ marginTop: 4 }}>
      {pending.delivered && (
        <Dropdown.Button
          size="small"
          loading={busy}
          onClick={() => copy(false)}
          menu={{ items: [{ key: 'msg', label: 'Copy with message', icon: <MailOutlined /> }], onClick: () => copy(true) }}
        >
          <CopyOutlined /> Copy link
        </Dropdown.Button>
      )}
      <Button size="small" icon={<SendOutlined />} onClick={() => send(false)}>
        {pending.delivered ? 'Re-send' : 'Send now'}
      </Button>
    </Space>
  );
}
