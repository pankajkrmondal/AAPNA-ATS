/**
 * Outlook mailbox reader (MS Graph) — shared by the two mailbox pollers that
 * replace the n8n "Microsoft Outlook Trigger2" (email resume intake) and
 * "WF2 Incoming Email Sync" (inbound conversation sync) workflows.
 *
 * Reads the per-environment mailbox identified by config.microsoft.defaultSender
 * (staging = "Saurabh", production = "AAPNA Recruitment") via the existing
 * client-credentials token, so no per-env code change is needed.
 */
import config from '../config/index.js';
import logger from '../config/logger.js';
import { getAccessToken } from './onedrive.service.js';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

/** Address-domains treated as internal (outbound loopbacks); mirrors n8n WF2. */
const ADMIN_DOMAINS = ['aapnainfotech.com', 'aapna.com'];

/**
 * Normalize a Graph recipient ({ emailAddress: { address, name } }) to an address.
 */
function recipientAddress(r) {
  return (r && r.emailAddress && r.emailAddress.address ? r.emailAddress.address : '').toLowerCase();
}

/**
 * Normalize a Graph message object into the flat shape used by the jobs.
 * @param {Object} msg - Raw Graph message
 * @returns {Object}
 */
export function normalizeMessage(msg) {
  const fromEmail = recipientAddress(msg.from) || recipientAddress(msg.sender) || '';
  const fromName =
    (msg.from && msg.from.emailAddress && msg.from.emailAddress.name) ||
    (msg.sender && msg.sender.emailAddress && msg.sender.emailAddress.name) ||
    '';

  const toEmails = (msg.toRecipients || []).map(recipientAddress).filter(Boolean);
  const ccEmails = (msg.ccRecipients || []).map(recipientAddress).filter(Boolean);

  const subject = msg.subject || '';
  const subjLower = subject.toLowerCase();
  const isBounce =
    subjLower.includes('undeliverable') ||
    subjLower.includes('delivery status notification') ||
    subjLower.includes('delivery failure');

  return {
    graphMessageId: msg.id || '',
    conversationId: msg.conversationId || '',
    internetMsgId: msg.internetMessageId || '',
    fromEmail,
    fromName,
    toEmails,
    ccEmails,
    subject,
    bodyPreview: (msg.bodyPreview || '').substring(0, 255),
    bodyHtml: (msg.body && msg.body.content) || '',
    hasAttachments: !!msg.hasAttachments,
    receivedAt: msg.receivedDateTime || new Date().toISOString(),
    isBounce,
  };
}

/** True when an address belongs to an internal/admin domain. */
export function isAdminSender(fromEmail) {
  return ADMIN_DOMAINS.some((d) => (fromEmail || '').endsWith('@' + d));
}

/**
 * Fetch inbox messages received after `sinceIso`, oldest-first, with paging.
 *
 * @param {string} sinceIso - ISO timestamp; only messages with receivedDateTime > this are returned
 * @param {Object} [opts]
 * @param {boolean} [opts.withAttachmentsOnly=false] - restrict to messages that have attachments
 * @param {number} [opts.max=100] - safety cap on number of messages per poll
 * @returns {Promise<Object[]>} normalized messages (oldest first)
 */
export async function fetchMessagesSince(sinceIso, { withAttachmentsOnly = false, max = 100 } = {}) {
  const mailbox = config.microsoft.defaultSender;
  if (!mailbox) {
    throw new Error('config.microsoft.defaultSender is not set; cannot poll a mailbox.');
  }

  const token = await getAccessToken();
  const select = 'id,conversationId,internetMessageId,from,sender,toRecipients,ccRecipients,subject,bodyPreview,body,hasAttachments,receivedDateTime';
  let filter = `receivedDateTime gt ${sinceIso}`;
  if (withAttachmentsOnly) {
    filter += ' and hasAttachments eq true';
  }

  let url =
    `${GRAPH_BASE}/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/messages` +
    `?$filter=${encodeURIComponent(filter)}` +
    `&$select=${encodeURIComponent(select)}` +
    `&$orderby=${encodeURIComponent('receivedDateTime asc')}` +
    `&$top=50`;

  const collected = [];
  while (url && collected.length < max) {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        // Required for $filter+$orderby together on messages.
        Prefer: 'outlook.body-content-type="html"',
      },
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Graph messages fetch failed (${res.status}): ${errText}`);
    }
    const data = await res.json();
    for (const msg of data.value || []) {
      collected.push(normalizeMessage(msg));
    }
    url = data['@odata.nextLink'] || null;
  }

  return collected.slice(0, max);
}

/**
 * Download file attachments for a message.
 * @param {string} messageId - Graph message id
 * @returns {Promise<Array<{ name: string, contentBytes: string, contentType: string }>>}
 */
export async function downloadAttachments(messageId) {
  const mailbox = config.microsoft.defaultSender;
  const token = await getAccessToken();
  const url = `${GRAPH_BASE}/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(messageId)}/attachments`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Graph attachments fetch failed (${res.status}): ${errText}`);
  }
  const data = await res.json();

  return (data.value || [])
    .filter((a) => a['@odata.type'] === '#microsoft.graph.fileAttachment' && a.contentBytes)
    .map((a) => ({
      name: a.name || 'attachment',
      contentBytes: a.contentBytes,
      contentType: a.contentType || 'application/octet-stream',
    }));
}

export default { fetchMessagesSince, downloadAttachments, normalizeMessage, isAdminSender };
