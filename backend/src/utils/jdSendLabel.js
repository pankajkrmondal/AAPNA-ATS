/**
 * JD label rules for JDs sent without an MRF (L07). Pure — no Prisma — so
 * node:test can load it.
 *
 * A JD sent before the hiring manager submits the MRF is an rpa_mrf_jd_send row
 * with mrf_id NULL: a role and a link, nothing to tell two "Data Analyst" JDs
 * apart. Recruiters give it a label and a JD date; the newest JD date per role
 * is "Latest". Once an MRF is linked, the MRF's reference and date (N19) name
 * it, so the label is read-only from then on.
 */
import { IST } from './dateFormat.js';
import { normaliseLabel } from './dashboardMetrics.js';

export const MAX_VERSION_LABEL_LENGTH = 60;

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A DATE column comes back from Prisma as UTC midnight: its day is the UTC date. */
function dateColumnDay(value) {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** A timestamp's India-time calendar day, YYYY-MM-DD. */
function istDay(value) {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-CA', { timeZone: IST });
}

/**
 * The day a JD row counts as dated: its JD date when set, else the day it was
 * created (India time).
 * @param {{ version_date?: Date|string|null, created_at?: Date|string|null }} row
 * @returns {string|null} YYYY-MM-DD
 */
export function jdSendDay(row) {
  if (row?.version_date) return dateColumnDay(row.version_date);
  if (row?.created_at) return istDay(row.created_at);
  return null;
}

/** Only rows with no linked MRF carry an editable label or take part in "Latest". */
export const isLabelEditable = (row) => !row?.mrf_id;

/**
 * Validate a PATCH body. Both fields are optional; an empty string or null
 * clears the field. Returns the Prisma data to write, or `{ error }`.
 *
 * @param {{ version_label?: string|null, version_date?: string|null }} body
 * @returns {{ data: { version_label?: string|null, version_date?: Date|null } } | { error: string }}
 */
export function parseVersionLabelInput(body = {}) {
  const data = {};
  const hasLabel = Object.prototype.hasOwnProperty.call(body, 'version_label');
  const hasDate = Object.prototype.hasOwnProperty.call(body, 'version_date');
  if (!hasLabel && !hasDate) return { error: 'Send version_label, version_date or both.' };

  if (hasLabel) {
    const raw = body.version_label;
    if (raw !== null && raw !== undefined && typeof raw !== 'string') return { error: 'The JD label must be text.' };
    const label = (raw ?? '').trim().replace(/\s+/g, ' ');
    if (label.length > MAX_VERSION_LABEL_LENGTH) {
      return { error: `The JD label can be at most ${MAX_VERSION_LABEL_LENGTH} characters.` };
    }
    data.version_label = label || null;
  }

  if (hasDate) {
    const raw = body.version_date;
    if (raw === null || raw === undefined || raw === '') {
      data.version_date = null;
    } else {
      const day = String(raw).trim().slice(0, 10);
      const d = new Date(`${day}T00:00:00Z`);
      if (!DAY_PATTERN.test(day) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== day) {
        return { error: 'The JD date must be a valid date (YYYY-MM-DD).' };
      }
      data.version_date = d;
    }
  }
  return { data };
}

/**
 * Ids of the rows marked "Latest": for each role (case and spacing ignored),
 * among rows with no MRF, the newest jdSendDay(). A tie goes to the newer row
 * (higher id). A role with a single JD still gets "Latest", so a lone row reads
 * the same as the newest of several.
 *
 * @param {Array<{ id: bigint|number|string, role?: string, mrf_id?: unknown, version_date?: unknown, created_at?: unknown }>} rows
 * @returns {Set<string>} ids as strings
 */
export function latestJdSendIds(rows = []) {
  const best = new Map();
  for (const row of rows) {
    if (!isLabelEditable(row)) continue;
    const role = normaliseLabel(row.role);
    if (!role) continue;
    const day = jdSendDay(row) || '';
    const id = BigInt(row.id);
    const current = best.get(role);
    if (!current || day > current.day || (day === current.day && id > current.id)) {
      best.set(role, { id, day });
    }
  }
  return new Set([...best.values()].map((b) => b.id.toString()));
}

/**
 * How the row is named on the MRF page and in its CSV:
 * "Data Analyst · v2 - Oct revision · 18 Oct 2026", or "Data Analyst · 12 Sep 2026"
 * with no label. Rows with an MRF are named by it elsewhere; this still returns
 * the role and date for them.
 * @param {{ role?: string, version_label?: string|null, version_date?: unknown, created_at?: unknown }} row
 * @param {(day: string) => string} formatDay  YYYY-MM-DD -> display date
 */
export function jdSendLabel(row, formatDay) {
  const parts = [row?.role || ''];
  if (row?.version_label) parts.push(row.version_label);
  const day = jdSendDay(row);
  if (day) parts.push(formatDay ? formatDay(day) : day);
  return parts.filter(Boolean).join(' · ');
}

export default {
  MAX_VERSION_LABEL_LENGTH, jdSendDay, isLabelEditable, parseVersionLabelInput, latestJdSendIds, jdSendLabel,
};
