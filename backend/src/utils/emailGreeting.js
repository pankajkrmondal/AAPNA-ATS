/**
 * Shared "who does this email address?" rule for any notification that may go
 * to more than one mailbox at once.
 *
 * A single name is wrong as soon as there is more than one recipient — "Hi all,"
 * is what interview scheduling already falls back to. Extracted from
 * interviewSchedule.service.js so every multi-recipient send path (scorecard
 * invites, future ones) uses the exact same rule instead of re-deriving it.
 *
 * @param {string} name   a captured recipient name (may be blank)
 * @param {string} emails the comma-joined recipient mailbox list
 * @returns {string} the name, 'all' when addressing more than one mailbox, or
 *   'there' when no name was captured — never blank.
 */
export function interviewerGreeting(name, emails) {
  if (String(emails || '').includes(',')) return 'all';
  return String(name || '').trim() || 'there';
}
