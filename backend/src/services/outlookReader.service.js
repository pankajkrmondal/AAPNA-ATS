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
 * Graph GET with throttling awareness: on 429/503 waits the server-provided
 * Retry-After (capped at 60s, default 5s) and retries up to 3 attempts.
 * Other non-ok statuses are returned to the caller to handle (some, like the
 * delta 410, carry meaning).
 * @param {string} url
 * @param {string} token
 * @param {string} label - for log lines
 * @returns {Promise<Response>}
 */
async function graphGet(url, token, label) {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Prefer: 'outlook.body-content-type="html"',
      },
    });
    if ((res.status === 429 || res.status === 503) && attempt < MAX_ATTEMPTS) {
      const retryAfter = Math.min(parseInt(res.headers.get('retry-after'), 10) || 5, 60);
      logger.warn(`[Outlook Reader] Graph throttled ${label} (${res.status}); waiting ${retryAfter}s (attempt ${attempt}/${MAX_ATTEMPTS}).`);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      continue;
    }
    return res;
  }
}

/**
 * Fetch inbox changes via a Graph delta query.
 *
 * Compared to the timestamp `$filter` in fetchMessagesSince, delta has no
 * watermark-boundary miss/duplicate edge cases and returns only changes, so
 * the poll interval can be tightened cheaply. Note delta also re-emits old
 * messages whose properties changed (e.g. read flag) — downstream consumers
 * are idempotent, so those are absorbed.
 *
 * @param {string|null} deltaLink - `@odata.deltaLink` from the previous cycle,
 *   or null/undefined for an initial sync (24h lookback).
 * @param {Object} [opts]
 * @param {number} [opts.max=200] - safety cap on messages per poll
 * @returns {Promise<{ messages: Object[], deltaLink: string|null }>}
 * @throws {Error & { code?: 'DELTA_EXPIRED' }} on HTTP 410 (expired delta token)
 */
export async function fetchMessagesDelta(deltaLink, { max = 200 } = {}) {
  const mailbox = config.microsoft.defaultSender;
  if (!mailbox) {
    throw new Error('config.microsoft.defaultSender is not set; cannot poll a mailbox.');
  }
  const token = await getAccessToken();

  const select = 'id,conversationId,internetMessageId,from,sender,toRecipients,ccRecipients,subject,bodyPreview,body,hasAttachments,receivedDateTime';
  let url = deltaLink;
  if (!url) {
    const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    url =
      `${GRAPH_BASE}/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/messages/delta` +
      `?$select=${encodeURIComponent(select)}` +
      `&$filter=${encodeURIComponent(`receivedDateTime ge ${sinceIso}`)}`;
  }

  const collected = [];
  let nextDeltaLink = null;
  while (url) {
    const res = await graphGet(url, token, 'messages delta');
    if (res.status === 410) {
      const err = new Error('Graph delta token expired (410 Gone); a fresh initial sync is required.');
      err.code = 'DELTA_EXPIRED';
      throw err;
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Graph delta fetch failed (${res.status}): ${errText}`);
    }
    const data = await res.json();
    for (const msg of data.value || []) {
      if (msg['@removed']) continue; // deletions are irrelevant to intake/sync
      if (collected.length < max) collected.push(normalizeMessage(msg));
    }
    nextDeltaLink = data['@odata.deltaLink'] || nextDeltaLink;
    url = data['@odata.nextLink'] || null;
  }

  // Oldest-first, matching fetchMessagesSince, so watermark-style consumers work.
  collected.sort((a, b) => (a.receivedAt < b.receivedAt ? -1 : 1));
  return { messages: collected, deltaLink: nextDeltaLink };
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
    const res = await graphGet(url, token, 'messages list');
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

  const res = await graphGet(url, token, 'attachments');
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

export default { fetchMessagesSince, fetchMessagesDelta, downloadAttachments, normalizeMessage, isAdminSender };
