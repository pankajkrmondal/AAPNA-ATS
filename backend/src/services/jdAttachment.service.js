/**
 * The MRF's JD file as an email attachment (Phase 3 "Do Now", N17).
 *
 * Keyword-tab shortlist emails carry the JD of the MRF the candidates were
 * tagged to. The file lives in OneDrive: new MRFs store its item id
 * (rpa_mrf.jd_item_id), older ones only its web link (jd_document_link), which
 * is resolved once and the id written back.
 *
 * Rules:
 *   - at most JD_ATTACH_MAX_BYTES (3 MB, Graph's inline attachment limit);
 *     above that, or when the file cannot be read, the email carries a
 *     "View the job description" link instead;
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

export const JD_ATTACH_MAX_BYTES = 3 * 1024 * 1024;
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

/** Test hook: forget cached JDs. */
export function clearJdAttachmentCache() {
  cache.clear();
}

export default { getMrfJdAttachment, saveMrfJdItemId, clearJdAttachmentCache, JD_ATTACH_MAX_BYTES };
