/**
 * mrfHoldSettings.service.js — the rpa_settings-backed knobs behind MRF Hold and
 * decisions on behalf of absent approvers (Settings › MRF Approval & Hold).
 *
 *   mrf_hold_default_days   pre-filled hold length (days)
 *   mrf_hold_max_days       longest a single hold may be (days)
 *   mrf_hold_release_time   'HH:MM' IST, when held MRFs due today come back
 *   mrf_approver_absence    JSON { active, from, to, note, setByUserId, setByName, setAt }
 *
 * Missing or broken rows fall back to the defaults: a bad setting must never
 * stop an approver from deciding. Who may change what is decided by the
 * controller (absence: admin tier; hold rules: HR Admin Recruiter and above).
 *
 * Plan: docs/phase3/MRF/MRF-Hold-and-Delegate-Approval-Plan.md §7
 */
import prisma from '../config/database.js';
import { ROLES, roleLabel } from '../config/roles.js';
import {
  HOLD_SETTING_KEYS,
  parseAbsence,
  parseHoldRules,
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

/**
 * Active accounts that may decide on behalf of the approvers (role HR Admin
 * Recruiter or above), for the read-only list in Settings.
 * @returns {Promise<{ id: number, name: string, email: string|null, role: string, roleLabel: string }[]>}
 */
export async function listOnBehalfUsers() {
  const users = await prisma.rpa_users.findMany({
    where: {
      role: { in: [ROLES.HR_ADMIN_RECRUITER, ROLES.ADMIN, ROLES.SUPERADMIN] },
      is_active: true,
    },
    select: { id: true, first_name: true, last_name: true, username: true, email: true, role: true },
    orderBy: [{ role: 'asc' }, { first_name: 'asc' }],
  });
  const rank = { hr_admin_recruiter: 0, admin: 1, superadmin: 2 };
  return users
    .map((u) => ({
      id: u.id,
      name: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username,
      email: u.email,
      role: u.role,
      roleLabel: roleLabel(u.role),
    }))
    .sort((a, b) => (rank[a.role] ?? 9) - (rank[b.role] ?? 9) || a.name.localeCompare(b.name));
}

/** Emails of active HR Admin Recruiters (told when an absence window opens). */
export async function hrAdminRecruiterEmails() {
  const users = await prisma.rpa_users.findMany({
    where: { role: ROLES.HR_ADMIN_RECRUITER, is_active: true, email: { not: null } },
    select: { email: true, first_name: true, last_name: true },
  });
  return users.map((u) => ({ email: u.email, name: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email }));
}
