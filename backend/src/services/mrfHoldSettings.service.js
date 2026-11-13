/**
 * mrfHoldSettings.service.js — the rpa_settings-backed knobs behind MRF Hold and
 * decisions on behalf of absent approvers (Settings › MRF Approval & Hold).
 *
 *   mrf_hold_default_days   pre-filled hold length (days)
 *   mrf_hold_max_days       longest a single hold may be (days)
 *   mrf_hold_release_time   'HH:MM' IST, when held MRFs due today come back
 *   mrf_approver_absence    JSON { active, from, to, note, setByUserId, setByName, setAt }
 *                           (no longer used to decide; kept as stored, U06b)
 *   mrf_on_behalf_user      JSON { userId, setByUserId, setByName, setAt }: the one
 *                           person who may decide on behalf of the approvers
 *
 * Missing or broken rows fall back to the defaults: a bad setting must never
 * stop an approver from deciding. Who may change what is decided by the
 * controller (designee and absence: admin tier; hold rules: HR Admin Recruiter
 * and above).
 *
 * Plan: docs/phase3/MRF/MRF-Hold-and-Delegate-Approval-Plan.md §7
 */
import prisma from '../config/database.js';
import { ROLES, roleLabel } from '../config/roles.js';
import {
  HOLD_SETTING_KEYS,
  parseAbsence,
  parseHoldRules,
  parseOnBehalfUser,
} from '../utils/mrfApprovalRules.js';

/** Hold rules: { defaultDays, maxDays, releaseTime }. Never throws on bad data. */
export async function getHoldRules() {
  const rows = await prisma.rpa_settings.findMany({
    where: { key: { in: [HOLD_SETTING_KEYS.defaultDays, HOLD_SETTING_KEYS.maxDays, HOLD_SETTING_KEYS.releaseTime] } },
  });
  return parseHoldRules(Object.fromEntries(rows.map((r) => [r.key, r.value])));
}

/** Save already-validated hold rules (validateHoldRules). */
export async function saveHoldRules({ defaultDays, maxDays, releaseTime }) {
  const pairs = [
    [HOLD_SETTING_KEYS.defaultDays, String(defaultDays)],
    [HOLD_SETTING_KEYS.maxDays, String(maxDays)],
    [HOLD_SETTING_KEYS.releaseTime, String(releaseTime)],
  ];
  await prisma.$transaction(pairs.map(([key, value]) => prisma.rpa_settings.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  })));
  return { defaultDays, maxDays, releaseTime };
}

/** The approver-absence window; `{ active: false }` when unset or broken. */
export async function getAbsence() {
  const row = await prisma.rpa_settings.findUnique({ where: { key: HOLD_SETTING_KEYS.absence } });
  return parseAbsence(row?.value);
}

/**
 * Save an already-validated absence window (validateAbsence), stamped with who
 * set it and when.
 * @param {{ active: boolean, from: string|null, to: string|null, note: string|null }} absence
 * @param {object} user  req.user
 */
export async function saveAbsence(absence, user) {
  const stored = {
    ...absence,
    setByUserId: user?.id ?? null,
    setByName: [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username || null,
    setAt: new Date().toISOString(),
  };
  await prisma.rpa_settings.upsert({
    where: { key: HOLD_SETTING_KEYS.absence },
    update: { value: JSON.stringify(stored) },
    create: { key: HOLD_SETTING_KEYS.absence, value: JSON.stringify(stored) },
  });
  return parseAbsence(stored);
}

/** Staff roles the designee may hold (never a vendor). */
const ON_BEHALF_ROLES = [ROLES.SUPERADMIN, ROLES.ADMIN, ROLES.HR_ADMIN_RECRUITER, 'hr', ROLES.RECRUITER];

const userName = (u) => [u?.first_name, u?.last_name].filter(Boolean).join(' ') || u?.username || u?.email || null;

/**
 * Active staff who can be chosen to decide on behalf of the approvers, for the
 * picker in Settings.
 * @returns {Promise<{ id: number, name: string, email: string|null, role: string, roleLabel: string }[]>}
 */
export async function listOnBehalfUsers() {
  const users = await prisma.rpa_users.findMany({
    where: { role: { in: ON_BEHALF_ROLES }, is_active: true },
    select: { id: true, first_name: true, last_name: true, username: true, email: true, role: true },
  });
  return users
    .map((u) => ({ id: u.id, name: userName(u), email: u.email, role: u.role, roleLabel: roleLabel(u.role) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The person chosen in Settings to decide on behalf of the approvers, with
 * their account as it is today; null when nobody is set. Never throws on bad
 * data.
 * @returns {Promise<null|{ userId: number, name: string, email: string|null, role: string|null, roleLabel: string|null, isActive: boolean, setByName: string|null, setAt: string|null }>}
 */
export async function getOnBehalfUser() {
  const row = await prisma.rpa_settings.findUnique({ where: { key: HOLD_SETTING_KEYS.onBehalfUser } });
  const stored = parseOnBehalfUser(row?.value);
  if (!stored.userId) return null;
  const u = await prisma.rpa_users.findUnique({
    where: { id: stored.userId },
    select: { id: true, first_name: true, last_name: true, username: true, email: true, role: true, is_active: true },
  });
  return {
    userId: stored.userId,
    name: userName(u) || `User #${stored.userId}`,
    email: u?.email || null,
    role: u?.role || null,
    roleLabel: u?.role ? roleLabel(u.role) : null,
    // A deleted account, or one moved to vendor, counts as inactive.
    isActive: Boolean(u && u.is_active !== false && ON_BEHALF_ROLES.includes(u.role)),
    setByName: stored.setByName,
    setAt: stored.setAt,
  };
}

/**
 * Choose (or clear, with null) the person who decides on behalf of the
 * approvers. They must be active staff, not a vendor.
 * @param {number|null} userId
 * @param {object} actor  req.user
 * @returns {Promise<{ ok: true, designee: object|null } | { ok: false, error: string }>}
 */
export async function saveOnBehalfUser(userId, actor) {
  let id = null;
  if (userId !== null && userId !== undefined && userId !== '') {
    id = Number(userId);
    if (!Number.isInteger(id) || id <= 0) return { ok: false, error: 'Choose a person from the list.' };
    const u = await prisma.rpa_users.findUnique({ where: { id }, select: { role: true, is_active: true } });
    if (!u || u.is_active === false || !ON_BEHALF_ROLES.includes(u.role)) {
      return { ok: false, error: 'Choose an active staff member (not a vendor).' };
    }
  }
  const value = JSON.stringify({
    userId: id,
    setByUserId: actor?.id ?? null,
    setByName: userName(actor),
    setAt: new Date().toISOString(),
  });
  await prisma.rpa_settings.upsert({
    where: { key: HOLD_SETTING_KEYS.onBehalfUser },
    update: { value },
    create: { key: HOLD_SETTING_KEYS.onBehalfUser, value },
  });
  return { ok: true, designee: await getOnBehalfUser() };
}

/** Emails of active HR Admin Recruiters (told when an absence window opens). */
export async function hrAdminRecruiterEmails() {
  const users = await prisma.rpa_users.findMany({
    where: { role: ROLES.HR_ADMIN_RECRUITER, is_active: true, email: { not: null } },
    select: { email: true, first_name: true, last_name: true },
  });
  return users.map((u) => ({ email: u.email, name: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email }));
}
