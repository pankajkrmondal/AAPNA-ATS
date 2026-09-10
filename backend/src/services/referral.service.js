/**
 * referral.service.js — the referral flag and its audit trail.
 *
 * A referral GRANTS HIRING PREFERENCE. Sanghamitra, 2026-08-28: "we always give
 * preference to the referral person." That single sentence is why this lives in
 * its own service rather than as five more fields in unmapCandidate():
 *
 *   - it must be written with an audit row, ALWAYS, in the same transaction;
 *   - setting it and removing it carry DIFFERENT permissions (any recruiter may
 *     set, only admin-tier may remove), which a 40-field mapper cannot express;
 *   - a removal must carry a typed reason, and that rule has to live somewhere a
 *     reviewer can see.
 *
 * The generic PATCH /api/candidates/:id cannot touch these columns, and that is
 * deliberate rather than incidental: unmapCandidate() is an allowlist, and the
 * referral fields are simply not in it. A client that posts `is_referral` to the
 * general update endpoint is ignored, so there is exactly one way in — here.
 *
 * WHO MAY SEE THE RESULT is not this file's concern but is the point of the
 * whole feature: logged-in superadmin/admin/recruiter only, never an interviewer,
 * never a public token surface, never a dossier. See
 * docs/REFERRAL-CANDIDATE-PLAN.md section 5.
 */
import prisma from '../config/database.js';
import AppError from '../utils/AppError.js';
import logger from '../config/logger.js';

/** Audit actions, matching the CHECK constraint in the DDL. */
export const REFERRAL_ACTION = Object.freeze({
  MARKED: 'marked',
  UPDATED: 'updated',
  REMOVED: 'removed',
});

/**
 * Trim and collapse internal whitespace — but do NOT case-fold.
 *
 * "Anuj" / "anuj  k" / " Anuj Kumar " become "Anuj" / "anuj k" / "Anuj Kumar".
 * Case is preserved because these are people's names and lower-casing them in
 * storage would look like a bug on every screen that shows one. Reports group
 * case-insensitively instead (plan section 5.2), which is the right place for
 * that decision: it is a display concern, not a storage one.
 *
 * @param {*} value
 * @returns {string} '' when there was nothing but whitespace
 */
export function normalizeReferrer(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/** Free text that is optional: '' and whitespace-only both become null. */
const nullIfBlank = (value) => {
  const s = String(value ?? '').trim();
  return s === '' ? null : s;
};

/**
 * The acting user's display name for the audit row.
 *
 * acted_by_name is NOT NULL in the schema on purpose — an audit row that cannot
 * say who acted is not worth writing — so this never returns empty. The FK is
 * stored too, but the NAME is what survives the account being deleted, which is
 * exactly when the log matters.
 *
 * @param {{first_name?: string, last_name?: string, username?: string, email?: string}} user
 * @returns {string}
 */
export function actorDisplayName(user) {
  const full = [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim();
  return full || user?.username || user?.email || 'Unknown user';
}

/** The candidate fields this service reads and returns. Narrow on purpose. */
const REFERRAL_SELECT = Object.freeze({
  id: true,
  Name: true,
  EmailID: true,
  is_referral: true,
  referred_by: true,
  referral_note: true,
  referral_set_by: true,
  referral_set_at: true,
});

/** Shape returned to the client. BigInt id is narrowed for JSON. */
function serializeReferral(cv) {
  return {
    cv_id: Number(cv.id),
    candidate_name: cv.Name ?? null,
    is_referral: cv.is_referral,
    referred_by: cv.referred_by ?? null,
    referral_note: cv.referral_note ?? null,
    referral_set_by: cv.referral_set_by ?? null,
    referral_set_at: cv.referral_set_at ?? null,
  };
}

/**
 * One audit row, flattened for the history strip and the report.
 *
 * `acted_ip` is STORED but deliberately NOT returned. It is corroboration for an
 * investigation, not something to render next to a colleague's name in a history
 * strip every recruiter can open — and once a field is in a response it ends up
 * on a screen. Read it straight from the table when an investigation needs it.
 *
 * Named fields rather than a spread, for the same reason serializeCard() is:
 * a column added to this table later must be shown consciously.
 */
function serializeAudit(row) {
  return {
    id: Number(row.id),
    cv_id: row.cv_id === null ? null : Number(row.cv_id),
    candidate_name: row.candidate_name,
    candidate_email: row.candidate_email,
    action: row.action,
    old_is_referral: row.old_is_referral,
    new_is_referral: row.new_is_referral,
    old_referred_by: row.old_referred_by,
    new_referred_by: row.new_referred_by,
    note: row.note,
    reason: row.reason,
    acted_by: row.acted_by,
    acted_by_name: row.acted_by_name,
    acted_by_email: row.acted_by_email,
    acted_at: row.acted_at,
  };
}

/** Loads the candidate or 404s, with only the columns this service touches. */
async function loadCandidate(cvId) {
  let id;
  try {
    id = BigInt(cvId);
  } catch {
    throw new AppError('Candidate not found.', 404);
  }
  const cv = await prisma.rpa_cv.findUnique({ where: { id }, select: REFERRAL_SELECT });
  if (!cv) throw new AppError('Candidate not found.', 404);
  return cv;
}

/**
 * Mark a candidate as a referral, or change who referred them.
 *
 * Idempotent by design: re-saving identical values writes NO audit row. The log
 * records changes, and a row saying "Chhaya changed nothing" is noise that makes
 * a real removal harder to find.
 *
 * @param {number|string} cvId
 * @param {{referredBy: string, note?: string|null}} input
 * @param {{user: object, ip?: string|null}} ctx
 * @returns {Promise<{referral: object, audit: object|null, changed: boolean}>}
 */
export async function setReferral(cvId, { referredBy, note } = {}, { user, ip = null } = {}) {
  if (!user?.id) throw new AppError('Authentication required.', 401);

  const newReferrer = normalizeReferrer(referredBy);
  if (!newReferrer) {
    // The referrer's name IS the requirement — "a referral from Anuj". A flag
    // with nobody attached cannot be checked, credited or investigated later.
    throw new AppError("Please enter who referred this candidate.", 400);
  }
  if (newReferrer.length > 255) {
    throw new AppError('The referrer name is too long (maximum 255 characters).', 400);
  }

  const cv = await loadCandidate(cvId);
  const newNote = nullIfBlank(note);

  const unchanged = cv.is_referral
    && cv.referred_by === newReferrer
    && (cv.referral_note ?? null) === newNote;

  if (unchanged) {
    return { referral: serializeReferral(cv), audit: null, changed: false };
  }

  const action = cv.is_referral ? REFERRAL_ACTION.UPDATED : REFERRAL_ACTION.MARKED;
  const actedByName = actorDisplayName(user);
  const now = new Date();

  // The candidate row and its audit row are written together or not at all.
  // A flag with no audit row is exactly the state this feature exists to make
  // impossible, so it must not be reachable through a partial failure.
  const [updated, audit] = await prisma.$transaction([
    prisma.rpa_cv.update({
      where: { id: cv.id },
      data: {
        is_referral: true,
        referred_by: newReferrer,
        referral_note: newNote,
        referral_set_by: actedByName,
        referral_set_at: now,
        modifiedAt: now,
      },
      select: REFERRAL_SELECT,
    }),
    prisma.rpa_referral_audit.create({
      data: {
        cv_id: cv.id,
        // Snapshots, not joins: the row must stay readable after the candidate
        // is deleted, and must record the name AS IT WAS at the time.
        candidate_name: cv.Name ?? null,
        candidate_email: cv.EmailID ?? null,
        action,
        old_is_referral: cv.is_referral,
        new_is_referral: true,
        old_referred_by: cv.referred_by ?? null,
        new_referred_by: newReferrer,
        note: newNote,
        acted_by: user.id,
        acted_by_name: actedByName,
        acted_by_email: user.email ?? null,
        acted_ip: ip,
      },
    }),
  ]);

  logger.info(
    `Referral ${action}: candidate ${cvId} referred by "${newReferrer}" (by ${actedByName}).`,
  );

  return { referral: serializeReferral(updated), audit: serializeAudit(audit), changed: true };
}

/**
 * Remove a referral. Admin-tier only (enforced by requireAdmin on the route) and
 * a typed reason is mandatory.
 *
 * The reason is what makes the audit row an INCIDENT record rather than a bare
 * timestamp — this is the case R8 exists for: "which recruiter removed the
 * referral name from this candidate, and why?". The database CHECK enforces it
 * too; the error raised here is the one a person actually reads.
 *
 * @param {number|string} cvId
 * @param {{reason: string}} input
 * @param {{user: object, ip?: string|null}} ctx
 * @returns {Promise<{referral: object, audit: object}>}
 */
export async function removeReferral(cvId, { reason } = {}, { user, ip = null } = {}) {
  if (!user?.id) throw new AppError('Authentication required.', 401);

  const cleanReason = String(reason ?? '').trim();
  if (!cleanReason) {
    throw new AppError(
      'Please give a reason for removing this referral. It is recorded against your name.',
      400,
    );
  }

  const cv = await loadCandidate(cvId);

  if (!cv.is_referral) {
    // Deliberately an error, not a silent success. Writing a 'removed' row for a
    // candidate that was never a referral would put a phantom incident into the
    // log the report exists to surface.
    throw new AppError('This candidate is not marked as a referral.', 409);
  }

  const actedByName = actorDisplayName(user);
  const now = new Date();

  const [updated, audit] = await prisma.$transaction([
    prisma.rpa_cv.update({
      where: { id: cv.id },
      data: {
        is_referral: false,
        referred_by: null,
        referral_note: null,
        referral_set_by: actedByName,
        referral_set_at: now,
        modifiedAt: now,
      },
      select: REFERRAL_SELECT,
    }),
    prisma.rpa_referral_audit.create({
      data: {
        cv_id: cv.id,
        candidate_name: cv.Name ?? null,
        candidate_email: cv.EmailID ?? null,
        action: REFERRAL_ACTION.REMOVED,
        old_is_referral: true,
        new_is_referral: false,
        // The name being erased from the candidate is preserved here. Without
        // this the question "who was the referrer?" becomes unanswerable the
        // moment somebody removes it — which is the question most worth asking.
        old_referred_by: cv.referred_by ?? null,
        new_referred_by: null,
        note: cv.referral_note ?? null,
        reason: cleanReason,
        acted_by: user.id,
        acted_by_name: actedByName,
        acted_by_email: user.email ?? null,
        acted_ip: ip,
      },
    }),
  ]);

  logger.warn(
    `Referral REMOVED: candidate ${cvId} (was referred by "${cv.referred_by}") `
    + `by ${actedByName} — reason: ${cleanReason}`,
  );

  return { referral: serializeReferral(updated), audit: serializeAudit(audit) };
}

/**
 * The referral history for one candidate, newest first — the strip shown on the
 * Edit Candidate modal so a recruiter sees the history in context rather than
 * having to open a separate report.
 *
 * @param {number|string} cvId
 * @param {{limit?: number}} [options]
 * @returns {Promise<object[]>}
 */
export async function getReferralHistory(cvId, { limit = 20 } = {}) {
  const cv = await loadCandidate(cvId);
  const rows = await prisma.rpa_referral_audit.findMany({
    where: { cv_id: cv.id },
    orderBy: { acted_at: 'desc' },
    take: Math.min(100, Math.max(1, limit)),
  });
  return rows.map(serializeAudit);
}

/**
 * Current referral state for one candidate.
 * @param {number|string} cvId
 * @returns {Promise<object>}
 */
export async function getReferral(cvId) {
  return serializeReferral(await loadCandidate(cvId));
}

/**
 * Referrer names already in use, for the "Referred by" autocomplete.
 *
 * `referred_by` is free text by decision, which means "Anuj", "anuj k" and
 * "Anuj Kumar" would otherwise become three rows in any report grouped by
 * referrer, with no reliable way to merge them afterwards. This is the cheap
 * half of the fix (plan section 5.2): the second person to type "Anuj" is
 * offered the spelling the first one used. It is self-seeding, needs no HR data,
 * and costs one indexed query.
 *
 * It is NOT a substitute for a picker. It only nudges.
 *
 * @param {{limit?: number}} [options]
 * @returns {Promise<string[]>}
 */
export async function getKnownReferrers({ limit = 200 } = {}) {
  const rows = await prisma.rpa_cv.findMany({
    where: { is_referral: true, NOT: { referred_by: null } },
    select: { referred_by: true },
    distinct: ['referred_by'],
    orderBy: { referred_by: 'asc' },
    take: Math.min(500, Math.max(1, limit)),
  });
  return rows.map((r) => r.referred_by).filter(Boolean);
}

/**
 * Turn report filters into a Prisma `where` for rpa_referral_audit.
 *
 * Shared by the paginated list and the CSV so the file can never contain rows
 * the screen did not — the same rule pipeline.export.js states for the board.
 *
 * NOT company-scoped, deliberately: `rpa_cv` carries no `company_id`, so the
 * candidate database is shared across tenants. Scoping this log by the acting
 * admin's company would filter on the ACTOR rather than the subject and quietly
 * hide rows about candidates they can see on every other screen. If candidates
 * ever become tenant-scoped, this is one of the places that has to change.
 *
 * @param {object} filters
 * @returns {object} Prisma where
 */
export function buildAuditWhere(filters = {}) {
  const where = {};

  if (filters.action) where.action = filters.action;
  if (filters.actedBy) where.acted_by = Number(filters.actedBy);
  if (filters.cvId) where.cv_id = BigInt(filters.cvId);

  if (filters.candidate) {
    where.candidate_name = { contains: String(filters.candidate).trim(), mode: 'insensitive' };
  }
  if (filters.referrer) {
    // Either side of a change, so searching "Anuj" finds both the marking that
    // named him and the removal that erased him.
    where.OR = [
      { new_referred_by: { contains: String(filters.referrer).trim(), mode: 'insensitive' } },
      { old_referred_by: { contains: String(filters.referrer).trim(), mode: 'insensitive' } },
    ];
  }

  if (filters.from || filters.to) {
    where.acted_at = {};
    if (filters.from) where.acted_at.gte = new Date(filters.from);
    // `to` is a date the user picked, meaning "up to the end of that day".
    // Without this a same-day from/to returns nothing, which reads as "no
    // activity" rather than "you asked for a zero-length window".
    if (filters.to) {
      const end = new Date(filters.to);
      end.setHours(23, 59, 59, 999);
      where.acted_at.lte = end;
    }
  }

  return where;
}

/**
 * The Referral Log — every mark, change and removal, newest first.
 *
 * Admin-tier only (the route enforces it): this table is a list of exactly what
 * R6 says most people should not see, gathered in one place.
 *
 * @param {object} filters - see buildAuditWhere
 * @param {number} [page]
 * @param {number} [limit]
 * @returns {Promise<{data: object[], total: number, removals: number}>}
 */
export async function queryReferralAudit(filters = {}, page = 1, limit = 25) {
  const where = buildAuditWhere(filters);
  const take = Math.min(200, Math.max(1, Number(limit) || 25));
  const skip = (Math.max(1, Number(page) || 1) - 1) * take;

  const [rows, total, removals] = await Promise.all([
    prisma.rpa_referral_audit.findMany({ where, orderBy: { acted_at: 'desc' }, skip, take }),
    prisma.rpa_referral_audit.count({ where }),
    // Surfaced beside the total because removals are the reason this report
    // exists — a count of 0 is the answer to "has anyone been quietly undoing
    // referrals?" without paging through the list to find out.
    prisma.rpa_referral_audit.count({ where: { ...where, action: REFERRAL_ACTION.REMOVED } }),
  ]);

  return { data: rows.map(serializeAudit), total, removals };
}

export default {
  REFERRAL_ACTION,
  normalizeReferrer,
  actorDisplayName,
  setReferral,
  removeReferral,
  getReferralHistory,
  getReferral,
  getKnownReferrers,
  buildAuditWhere,
  queryReferralAudit,
};
