/**
 * interviewOptionalAttendees.service.js — the recruiters added as OPTIONAL
 * attendees to every booked interview's Outlook/Teams meeting.
 *
 * WHY: bookings are organized by the shared recruitment mailbox, so the meeting
 * only lives in that mailbox's calendar. The recruiters actually running the
 * hiring (Chhaya, Naveen, Sweta…) never saw the round in their own Outlook or
 * Teams. Listing them here puts them on the event as optional attendees, which
 * Outlook delivers as an ordinary meeting invitation they can accept or ignore.
 *
 * Stored as one comma-separated row in rpa_settings — no DDL. An empty list is
 * a valid, deliberate value: nobody extra is invited.
 *
 * Kept out of interviewSchedule.service.js on purpose: graphAttendance.service
 * reads this list too (a recruiter who joins must never count as the candidate),
 * and routing that read through the scheduling service would deepen the import
 * cycle between the two.
 */
import prisma from '../config/database.js';

export const SETTING_KEY = 'interview_optional_attendees';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Splits a comma/semicolon/whitespace-separated list (or an array of them) into
 * de-duplicated addresses, keeping the first spelling of each.
 *
 * @param {string|string[]} raw
 * @returns {{ emails: string[], invalid: string[] }}
 */
export function parseOptionalAttendees(raw) {
  const parts = (Array.isArray(raw) ? raw : [raw])
    .flatMap((v) => String(v ?? '').split(/[,;\s]+/))
    .map((p) => p.trim())
    .filter(Boolean);

  const emails = [];
  const invalid = [];
  const seen = new Set();
  for (const part of parts) {
    if (!EMAIL_RE.test(part)) {
      invalid.push(part);
      continue;
    }
    const key = part.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      emails.push(part);
    }
  }
  return { emails, invalid };
}

/**
 * The saved optional-attendee list. Never throws: a settings read failing must
 * not cost a recruiter their booking, so it degrades to "nobody extra".
 *
 * @returns {Promise<string[]>}
 */
export async function getOptionalAttendeeEmails() {
  try {
    const row = await prisma.rpa_settings.findUnique({ where: { key: SETTING_KEY } });
    return parseOptionalAttendees(row?.value || '').emails;
  } catch {
    return [];
  }
}

/**
 * Replaces the saved list. Callers validate first (see parseOptionalAttendees).
 *
 * @param {string[]} emails
 * @returns {Promise<string[]>} the list as saved
 */
export async function saveOptionalAttendeeEmails(emails) {
  const value = emails.join(', ');
  await prisma.rpa_settings.upsert({
    where: { key: SETTING_KEY },
    update: { value },
    create: { key: SETTING_KEY, value },
  });
  return emails;
}
