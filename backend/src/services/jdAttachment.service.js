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
 *     as a "View Job Description" link card instead;
 *   - a missing JD never blocks an email: every function here returns a
 *     result, never throws;
 *   - one download per MRF per 10 minutes (a batch of 30 shortlists reads the
 *     file once).
 *
 * jd_item_id is read and written with raw SQL, so this works before the
 * Prisma client is regenerated and degrades to the link if the column has not
 * been added yet (DDL 2026-10-15-mrf-jd-item-id.sql).
 *
 * U02b: each candidate template can switch the JD on or off
 * (rpa_email_templates.attach_jd; null keeps shouldAttachJd), and its
 * {{jd_link}} token places the link card (placeJdLink). attach_jd is read with
 * raw SQL for the same reason as jd_item_id (DDL
 * 2026-11-12-email-template-attach-jd.sql). A JD stored as a website address
 * (not OneDrive or SharePoint) goes as that link, with no Graph calls.
 */
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import { downloadDriveItem, createAnonymousViewLink } from './onedrive.service.js';
import { jdLinkHtml, placeJdLink } from '../utils/candidateEmailBlocks.js';
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

/**
 * Should this email carry the JD? The template's "Attach the JD" switch when
 * HR set it (U02b), else the default rule (shouldAttachJd). Pure.
 * @param {{attach_jd?: boolean|null}|null|undefined} template
 * @param {string|null|undefined} stageKey
 * @returns {boolean}
 */
export function jdWanted(template, stageKey) {
  const flag = template?.attach_jd;
  return typeof flag === 'boolean' ? flag : shouldAttachJd(stageKey);
}

const missingAttachJdColumn = (err) => /attach_jd/.test(String(err?.message)) && /does not exist|column/i.test(String(err?.message));

let attachJdColumn = { at: 0, present: false };

/**
 * Has DDL 2026-11-12 added rpa_email_templates.attach_jd? Checked in the
 * catalogue (so a missing column logs no Prisma error on every send); once
 * present it is remembered, while missing it is re-checked every 10 minutes.
 * Never throws.
 * @returns {Promise<boolean>}
 */
export async function hasAttachJdColumn() {
  if (attachJdColumn.present) return true;
  if (attachJdColumn.at && Date.now() - attachJdColumn.at < CACHE_TTL_MS) return false;
  try {
    const rows = await prisma.$queryRaw`
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'rpa_email_templates' AND column_name = 'attach_jd'`;
    attachJdColumn = { at: Date.now(), present: rows.length > 0 };
  } catch (err) {
    logger.warn(`[JD attachment] could not check for the attach_jd column, the default rule applies: ${err.message}`);
    attachJdColumn = { at: Date.now(), present: false };
  }
  return attachJdColumn.present;
}

/**
 * A template's "Attach the JD" switch: true, false, or null (default rule).
 * Null when there is no template or the column is not there yet. Never throws.
 * @param {number|string|null|undefined} templateId
 * @returns {Promise<boolean|null>}
 */
export async function loadTemplateAttachJd(templateId) {
  const id = Number(templateId);
  if (!Number.isInteger(id) || id <= 0) return null;
  if (!(await hasAttachJdColumn())) return null;
  try {
    const rows = await prisma.$queryRaw`SELECT attach_jd FROM rpa_email_templates WHERE id = ${id}`;
    const flag = rows[0]?.attach_jd;
    return typeof flag === 'boolean' ? flag : null;
  } catch (err) {
    if (!missingAttachJdColumn(err)) logger.warn(`[JD attachment] template ${id}: could not read attach_jd, the default rule applies. ${err.message}`);
    return null;
  }
}

/**
 * jdWanted for a template row (its switch read from the database) or a
 * template id. Never throws.
 * @param {{id?: number}|number|null|undefined} template
 * @param {string|null|undefined} stageKey
 * @returns {Promise<boolean>}
 */
export async function jdWantedForTemplate(template, stageKey) {
  const id = typeof template === 'object' && template !== null ? template.id : template;
  return jdWanted({ attach_jd: await loadTemplateAttachJd(id) }, stageKey);
}

const MICROSOFT_FILE_HOSTS = ['sharepoint.com', 'onedrive.live.com', '1drv.ms'];

/**
 * Is this a OneDrive / SharePoint file address (one Graph can resolve)? Pure.
 * @param {string|null|undefined} url
 */
export function isMicrosoftFileUrl(url) {
  let host;
  try {
    host = new URL(String(url || '').trim()).hostname.toLowerCase();
  } catch {
    return false;
  }
  return MICROSOFT_FILE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/**
 * Where an MRF's JD lives (U02b). Pure.
 *   'item'      the OneDrive item id (new MRFs)
 *   'onedrive'  a OneDrive / SharePoint link only (older MRFs)
 *   'website'   a web address that is not a Microsoft file: sent as it is
 *   'none'      nothing on record
 * @param {{jd_item_id?: string|null, jd_document_link?: string|null}|null} mrf
 */
export function jdSourceOf(mrf) {
  if (mrf?.jd_item_id) return 'item';
  const link = String(mrf?.jd_document_link || '').trim();
  if (!link) return 'none';
  return isMicrosoftFileUrl(link) ? 'onedrive' : 'website';
}

/**
 * The candidate link from a createLink reply: an "anyone" link only when Graph
 * says its scope is anonymous; null otherwise (the caller keeps the internal
 * link). Pure.
 * @param {{href?: string, scope?: string|null}|null} made
 * @returns {{href: string, kind: 'anyone'}|null}
 */
export function anyoneLinkFrom(made) {
  return made?.href && made.scope === 'anonymous' ? { href: made.href, kind: 'anyone' } : null;
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
 *   reason: 'no_jd'|'too_large'|'unreadable'|'website'|null
 * }>} 'website': the JD is a web page, not a file, so it always goes as its link
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
    const source = jdSourceOf(mrf);
    if (source === 'none') {
      value = { ...none, name, link };
    } else if (source === 'website') {
      // U02b: nothing to download; the address is sent as it is.
      value = { attachment: null, name, sizeBytes: null, link: link.trim(), reason: 'website' };
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

const linkCache = new Map(); // mrfId -> { at, value }

/**
 * The JD link a candidate can open: a view-only "anyone" OneDrive link. When
 * Graph refuses (the tenant blocks Anyone links, the file is gone, a timeout),
 * or replies with a link of another scope (U02b: the tenant can downgrade the
 * request to an organisation link), it is the stored internal link, as before.
 * A website JD is its own address, with no Graph call (U02b). Created only
 * when a JD goes as a link, never for an attached one; one Graph call per MRF
 * per 10 minutes. Never throws.
 *
 * @param {bigint|number|string} mrfId
 * @param {object|null} [jd] - a getMrfJdAttachment result already in hand (its `link` is the fallback)
 * @returns {Promise<{href: string, kind: 'anyone'|'internal'|'website'}|null>} null when there is no JD link at all
 */
export async function getMrfJdCandidateLink(mrfId, jd = null) {
  if (!mrfId || Number(mrfId) <= 0) return null;
  const key = String(mrfId);
  const hit = linkCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  let value = null;
  try {
    const mrf = await loadMrfJdFields(mrfId);
    const internal = jd?.link || mrf?.jd_document_link || null;
    const source = jdSourceOf(mrf);
    if (source === 'website') {
      value = { href: String(mrf.jd_document_link).trim(), kind: 'website' };
    } else if (source !== 'none') {
      try {
        const made = await createAnonymousViewLink({
          itemId: mrf.jd_item_id || null,
          webUrl: mrf.jd_item_id ? null : mrf.jd_document_link,
        });
        if (made.resolvedFromUrl && made.itemId) await saveMrfJdItemId(mrfId, made.itemId);
        value = anyoneLinkFrom(made);
        if (!value) {
          logger.warn(`[JD attachment] MRF ${mrfId}: OneDrive returned a ${made.scope || 'unknown'} link, not an anyone link; the email keeps the internal link`);
        }
      } catch (err) {
        logger.warn(`[JD attachment] MRF ${mrfId}: anyone link refused${err?.status ? ` (HTTP ${err.status})` : ''}, the email keeps the internal link. ${err.message}${err?.detail ? ` ${err.detail}` : ''}`);
      }
    }
    if (!value && internal) value = { href: internal, kind: 'internal' };
  } catch (err) {
    logger.warn(`[JD attachment] MRF ${mrfId}: link lookup failed: ${err.message}`);
    value = jd?.link ? { href: jd.link, kind: 'internal' } : null;
  }

  linkCache.set(key, { at: Date.now(), value });
  return value;
}

/** Takes any {{jd_link}} slot out of a body that carries no JD card (U02b). */
const dropJdSlot = (html) => placeJdLink(html, '');

/** No JD on this email: the same shape as jdForCandidateEmail. */
export const NO_JD_FOR_EMAIL = Object.freeze({
  attachments: Object.freeze([]), linkHtml: '', appendLink: dropJdSlot, status: 'none', linkKind: null, logEntries: Object.freeze([]), jd: null,
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
 * }>} `appendLink` puts the link card (when the JD travels as a link) at the
 *   body's {{jd_link}}, else at the end (placeJdLink); otherwise it only
 *   removes any {{jd_link}}. `logEntries` is for
 *   rpa_email_messages.attachments_json.
 */
export async function jdForCandidateEmail(mrfId, { otherBase64 = 0 } = {}) {
  const jd = await getMrfJdAttachment(mrfId);
  // The anyone link is made only when the JD goes as a link.
  const candidateLink = jd && !jdFitsAsAttachment(jd, otherBase64) && (jd.link || jd.reason !== 'no_jd')
    ? await getMrfJdCandidateLink(mrfId, jd)
    : null;
  return jdEmailParts(jd, { otherBase64, candidateLink });
}

/** Does this JD go attached, beside `otherBase64` characters of other attachments? Pure. */
const jdFitsAsAttachment = (jd, otherBase64 = 0) => Boolean(jd?.attachment)
  && fitsEmailAttachments(otherBase64 + jd.attachment.contentBytes.length);

/**
 * The pure half of jdForCandidateEmail: attach the JD when it fits beside the
 * email's other attachments, else the link card, else nothing.
 * @param {object|null} jd - a getMrfJdAttachment result
 * @param {{ otherBase64?: number, candidateLink?: {href: string, kind: string}|null }} [options]
 *   `candidateLink`: the getMrfJdCandidateLink result; its href is used over jd.link
 */
export function jdEmailParts(jd, { otherBase64 = 0, candidateLink = null } = {}) {
  if (!jd) return NO_JD_FOR_EMAIL;
  if (jdFitsAsAttachment(jd, otherBase64)) {
    return {
      attachments: [jd.attachment],
      linkHtml: '',
      appendLink: dropJdSlot,
      status: 'attached',
      logEntries: [{ name: jd.attachment.name, size: jd.sizeBytes ?? null, kind: 'jd' }],
      jd,
    };
  }
  const linkHtml = jdLinkHtml(candidateLink?.href ?? jd.link);
  return {
    attachments: [],
    linkHtml,
    appendLink: (html) => placeJdLink(html, linkHtml),
    status: linkHtml ? 'link' : 'none',
    linkKind: linkHtml ? (candidateLink?.kind || 'internal') : null,
    logEntries: [],
    jd,
  };
}

/** Test hook: forget cached JDs, their candidate links and the attach_jd column check. */
export function clearJdAttachmentCache() {
  cache.clear();
  linkCache.clear();
  attachJdColumn = { at: 0, present: false };
}

export default {
  getMrfJdAttachment, getMrfJdPresence, getMrfJdCandidateLink, jdForCandidateEmail, jdEmailParts, shouldAttachJd, saveMrfJdItemId, clearJdAttachmentCache,
  base64Size, fitsEmailAttachments, JD_ATTACH_MAX_BYTES, EMAIL_ATTACH_MAX_BASE64,
  jdWanted, loadTemplateAttachJd, jdWantedForTemplate, hasAttachJdColumn, isMicrosoftFileUrl, jdSourceOf, anyoneLinkFrom,
};
