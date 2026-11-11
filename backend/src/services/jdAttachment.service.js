/**
 * The MRF's JD file as an email attachment (Phase 3 "Do Now", N17).
 *
 * Every email that moves a candidate forward carries the JD of the MRF they
 * are tagged to (U02: shortlists, Zeko, Evalground, interview rounds, the
 * "Approved" outcome email; not documents, offer or closures — see
 * shouldAttachJd). The file lives in OneDrive: new MRFs store its item id
 * (rpa_mrf.jd_item_id), older ones only its web link (jd_document_link), which
 * is resolved once and the id written back.
 *
 * Rules:
 *   - size is measured as it travels: Graph sends attachments inline as
 *     base64 (~33% larger than the file), and one email's attachments may
 *     total at most EMAIL_ATTACH_MAX_BASE64 (3.5 MB of base64, under Graph's
 *     4 MB request limit). A JD over that, or one that cannot be read, travels
 *     as a "View the job description" link instead;
 *   - a missing JD never blocks an email: every function here returns a
 *     result, never throws;
 *   - one download per MRF per 10 minutes (a batch of 30 shortlists reads the
 *     file once).
 *
 * jd_item_id is read and written with raw SQL, so this works before the
 * Prisma client is regenerated and degrades to the link if the column has not
 * been added yet (DDL 2026-10-15-mrf-jd-item-id.sql).
 */
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import { downloadDriveItem } from './onedrive.service.js';
import { jdLinkHtml, appendToBody } from '../utils/candidateEmailBlocks.js';
import { STAGE_KEYS, FINAL_OUTCOMES } from '../config/pipelineStages.js';

/** One email's attachment budget, in base64 characters (U02). */
export const EMAIL_ATTACH_MAX_BASE64 = Math.floor(3.5 * 1024 * 1024);

/**
 * Base64 length of a file of `bytes` bytes: what it weighs inside the Graph
 * request. Pure.
 * @param {number} bytes
 * @returns {number}
 */
export const base64Size = (bytes) => Math.ceil(Math.max(0, Number(bytes) || 0) / 3) * 4;

/**
 * Does an email whose attachments total `base64Total` characters stay within
 * the budget? Pure.
 * @param {number} base64Total
 */
export const fitsEmailAttachments = (base64Total) => Number(base64Total) <= EMAIL_ATTACH_MAX_BASE64;

/** The largest file whose base64 fits the budget on its own (~2.6 MB). */
export const JD_ATTACH_MAX_BYTES = Math.floor(EMAIL_ATTACH_MAX_BASE64 / 4) * 3;

/**
 * Stages whose emails do NOT carry the JD (U02): by then the role is settled.
 * Closures (final outcomes) and an empty stage key are also excluded.
 */
const NO_JD_STAGES = new Set([STAGE_KEYS.DOCUMENTS, STAGE_KEYS.OFFER, ...Object.values(FINAL_OUTCOMES)]);

/**
 * Should an email for this stage carry the JD? Pure.
 * @param {string|null|undefined} stageKey - the stage the email moves the candidate to, or invites them to
 * @returns {boolean}
 */
export function shouldAttachJd(stageKey) {
  const key = String(stageKey || '').trim();
  return Boolean(key) && !NO_JD_STAGES.has(key);
}
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map(); // mrfId -> { at, value }

const CONTENT_TYPES = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
};

function contentTypeFor(name, fallback) {
  const ext = String(name || '').toLowerCase().match(/\.[a-z0-9]+$/)?.[0];
  return CONTENT_TYPES[ext] || fallback || 'application/octet-stream';
}

const missingColumn = (err) => /jd_item_id/.test(String(err?.message)) && /does not exist|column/i.test(String(err?.message));

/**
 * Stores the JD's OneDrive item id on the MRF. Never throws.
 * @param {bigint|number|string} mrfId
 * @param {string} itemId
 */
export async function saveMrfJdItemId(mrfId, itemId) {
  if (!mrfId || !itemId) return;
  try {
    await prisma.$executeRaw`UPDATE rpa_mrf SET jd_item_id = ${String(itemId)} WHERE id = ${BigInt(mrfId)}`;
  } catch (err) {
    logger.warn(`[JD attachment] could not store jd_item_id for MRF ${mrfId}${missingColumn(err) ? ' (column not added yet — run DDL 2026-10-15-mrf-jd-item-id.sql)' : ''}: ${err.message}`);
  }
}

async function loadMrfJdFields(mrfId) {
  try {
    const rows = await prisma.$queryRaw`
      SELECT id, position_hiring_for, jd_attachment, jd_document_link, jd_item_id
      FROM rpa_mrf WHERE id = ${BigInt(mrfId)}`;
    return rows[0] || null;
  } catch (err) {
    if (!missingColumn(err)) throw err;
    const rows = await prisma.$queryRaw`
      SELECT id, position_hiring_for, jd_attachment, jd_document_link, NULL::text AS jd_item_id
      FROM rpa_mrf WHERE id = ${BigInt(mrfId)}`;
    return rows[0] || null;
  }
}

/**
 * The JD for an MRF, ready to attach — or the reason it can't be.
 *
 * @param {bigint|number|string} mrfId
 * @returns {Promise<{
 *   attachment: {name: string, contentType: string, contentBytes: string}|null,
 *   name: string|null, sizeBytes: number|null, link: string|null,
 *   reason: 'no_jd'|'too_large'|'unreadable'|null
 * }>}
 */
export async function getMrfJdAttachment(mrfId) {
  const none = { attachment: null, name: null, sizeBytes: null, link: null, reason: 'no_jd' };
  if (!mrfId || Number(mrfId) <= 0) return none;

  const key = String(mrfId);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  let value;
  try {
    const mrf = await loadMrfJdFields(mrfId);
    const link = mrf?.jd_document_link || null;
    const name = mrf?.jd_attachment || null;
    if (!mrf || (!mrf.jd_item_id && !link)) {
      value = { ...none, name, link };
    } else {
      try {
        const file = await downloadDriveItem({
          itemId: mrf.jd_item_id || null,
          webUrl: mrf.jd_item_id ? null : link,
          maxBytes: JD_ATTACH_MAX_BYTES,
        });
        const fileName = name || file.name || 'Job_Description.pdf';
        value = {
          attachment: {
            name: fileName,
            contentType: contentTypeFor(fileName, file.contentType),
            contentBytes: file.buffer.toString('base64'),
          },
          name: fileName,
          sizeBytes: file.buffer.length,
          link,
          reason: null,
        };
        // Lazy backfill: an older MRF resolved from its link keeps the id.
        if (file.resolvedFromUrl && file.itemId) await saveMrfJdItemId(mrfId, file.itemId);
      } catch (err) {
        const tooLarge = /attachment limit/.test(String(err?.message));
        logger.warn(`[JD attachment] MRF ${mrfId}: ${tooLarge ? 'too large to attach' : 'could not read the JD'} — the email will carry the link instead. ${err.message}`);
        value = { attachment: null, name, sizeBytes: null, link, reason: tooLarge ? 'too_large' : 'unreadable' };
      }
    }
  } catch (err) {
    logger.warn(`[JD attachment] MRF ${mrfId}: lookup failed: ${err.message}`);
    value = { ...none };
  }

  cache.set(key, { at: Date.now(), value });
  return value;
}

/**
 * Is a JD on record for this MRF? Metadata only, nothing is downloaded (U01:
 * the Schedule window's pre-send check). Never throws.
 * @param {bigint|number|string} mrfId
 * @returns {Promise<'ok'|'missing'>}
 */
export async function getMrfJdPresence(mrfId) {
  if (!mrfId || Number(mrfId) <= 0) return 'missing';
  const hit = cache.get(String(mrfId));
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return hit.value.attachment || hit.value.link ? 'ok' : 'missing';
  }
  try {
    const mrf = await loadMrfJdFields(mrfId);
    return mrf && (mrf.jd_item_id || mrf.jd_document_link) ? 'ok' : 'missing';
  } catch (err) {
    logger.warn(`[JD attachment] MRF ${mrfId}: presence check failed: ${err.message}`);
    return 'missing';
  }
}

/** No JD on this email: the same shape as jdForCandidateEmail. */
export const NO_JD_FOR_EMAIL = Object.freeze({
  attachments: Object.freeze([]), linkHtml: '', appendLink: (html) => html, status: 'none', logEntries: Object.freeze([]), jd: null,
});

/**
 * The JD as it goes on one candidate email (U02). Never throws.
 *
 * @param {bigint|number|string|null} mrfId
 * @param {{ otherBase64?: number }} [options] - `otherBase64`: base64 length of
 *   any attachments already on this email; the JD becomes a link if it does
 *   not fit beside them.
 * @returns {Promise<{
 *   attachments: Array<{name: string, contentType: string, contentBytes: string}>,
 *   linkHtml: string,
 *   appendLink: (html: string) => string,
 *   status: 'attached'|'link'|'none',
 *   logEntries: Array<{name: string, size: number|null, kind: 'jd'}>,
 *   jd: object
 * }>} `appendLink` adds the link block (when the JD travels as a link) to a
 *   body; it returns the body unchanged otherwise. `logEntries` is for
 *   rpa_email_messages.attachments_json.
 */
export async function jdForCandidateEmail(mrfId, { otherBase64 = 0 } = {}) {
  return jdEmailParts(await getMrfJdAttachment(mrfId), { otherBase64 });
}

/**
 * The pure half of jdForCandidateEmail: attach the JD when it fits beside the
 * email's other attachments, else the link, else nothing.
 * @param {object|null} jd - a getMrfJdAttachment result
 * @param {{ otherBase64?: number }} [options]
 */
export function jdEmailParts(jd, { otherBase64 = 0 } = {}) {
  if (!jd) return NO_JD_FOR_EMAIL;
  if (jd.attachment && fitsEmailAttachments(otherBase64 + jd.attachment.contentBytes.length)) {
    return {
      attachments: [jd.attachment],
      linkHtml: '',
      appendLink: (html) => html,
      status: 'attached',
      logEntries: [{ name: jd.attachment.name, size: jd.sizeBytes ?? null, kind: 'jd' }],
      jd,
    };
  }
  const linkHtml = jdLinkHtml(jd.link);
  return {
    attachments: [],
    linkHtml,
    appendLink: (html) => (linkHtml ? appendToBody(html, linkHtml) : html),
    status: linkHtml ? 'link' : 'none',
    logEntries: [],
    jd,
  };
}

/** Test hook: forget cached JDs. */
export function clearJdAttachmentCache() {
  cache.clear();
}

export default {
  getMrfJdAttachment, getMrfJdPresence, jdForCandidateEmail, jdEmailParts, shouldAttachJd, saveMrfJdItemId, clearJdAttachmentCache,
  base64Size, fitsEmailAttachments, JD_ATTACH_MAX_BYTES, EMAIL_ATTACH_MAX_BASE64,
};
