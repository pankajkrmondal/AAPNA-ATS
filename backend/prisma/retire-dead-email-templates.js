/**
 * Retires the email templates that exist in rpa_email_templates but that no
 * code path can ever send, and normalises the ones that were left behind by
 * seed-email-templates.js.
 *
 * WHY THESE EIGHT
 * ---------------
 * They are not in the seed script, so every content fix applied there missed
 * them, and a name-by-name trace of every template lookup in backend/src
 * (getTemplate() helpers, TEMPLATE_NAMES maps, GENERIC_FALLBACK_BY_OUTCOME, and
 * the three category-based lookups in screening.service.js) reaches none of
 * them:
 *
 *   Interview Invitation / Offer Letter / Follow-Up Reminder
 *     — legacy rows predating the seed script. No lookup by name, and no
 *       category lookup for 'offer' or 'follow_up' exists anywhere.
 *
 *   Closure — Joined / Joined and Left / Backed Out / Did Not Join /
 *   Candidate Withdrawn
 *     — structurally unreachable. Their outcomes are in SILENT_FINAL_OUTCOMES
 *       (stageNotification.service.js), which short-circuits in BOTH
 *       resolveTemplate() and sendStageOutcomeEmail() before any template is
 *       resolved. Even mapping one of these rows in the Pipeline Config UI
 *       cannot make it send.
 *
 * NOTHING IS DELETED. Rows are deactivated (is_active = false) so the Email
 * Templates screen shows them under its existing "Inactive" badge, and the
 * change is reversible with a single UPDATE. Idempotent — safe to re-run.
 *
 *   node prisma/retire-dead-email-templates.js
 */
import prisma from '../src/config/database.js';

/** Unreachable because SILENT_FINAL_OUTCOMES short-circuits before resolution. */
const SILENCED_CLOSURES = [
  'Closure — Joined',
  'Closure — Joined and Left',
  'Closure — Backed Out',
  'Closure — Did Not Join',
  'Closure — Candidate Withdrawn',
];

/** Legacy rows that predate the seed script and have no lookup at all. */
const LEGACY_UNREFERENCED = [
  'Interview Invitation',
  'Offer Letter',
  'Follow-Up Reminder',
];

const DEAD = [...SILENCED_CLOSURES, ...LEGACY_UNREFERENCED];

/**
 * Removes a trailing sign-off block so the row inherits the one
 * emailLayout.service.js renders centrally. Only touches the tail, and only
 * when a sign-off is actually the last thing in the body.
 */
function stripTrailingSignature(html) {
  if (typeof html !== 'string') return html;
  const stripped = html.replace(
    /(?:<p\b[^>]*>)?\s*(?:best|warm|kind)\s+regards\s*,?\s*(?:<br\s*\/?>|<\/p>\s*<p\b[^>]*>)?[\s\S]{0,160}?<\/p>\s*$/i,
    '',
  );
  return stripped.trimEnd();
}

async function main() {
  let deactivated = 0;
  let recategorised = 0;
  let designatured = 0;

  for (const name of DEAD) {
    const row = await prisma.rpa_email_templates.findFirst({ where: { name } });
    if (!row) {
      console.log(`  – "${name}" not present, skipping.`);
      continue;
    }

    const data = {};
    if (row.is_active) {
      data.is_active = false;
      deactivated += 1;
    }
    // The five closures were filed under 'general'/'onboarding', so they showed
    // up beside unrelated alerts instead of next to Closure — Approved.
    if (SILENCED_CLOSURES.includes(name) && row.category !== 'stage_outcome') {
      data.category = 'stage_outcome';
      recategorised += 1;
    }
    const cleaned = stripTrailingSignature(row.body_html);
    if (cleaned !== row.body_html) {
      data.body_html = cleaned;
      designatured += 1;
    }

    if (Object.keys(data).length === 0) {
      console.log(`  = "${name}" already retired, nothing to do.`);
      continue;
    }
    data.modified_at = new Date();
    await prisma.rpa_email_templates.update({ where: { id: row.id }, data });
    console.log(`  ✔ #${row.id} "${name}" → ${Object.keys(data).filter((k) => k !== 'modified_at').join(', ')}`);
  }

  console.log(`\nDeactivated ${deactivated}, re-filed ${recategorised}, sign-off removed from ${designatured}.`);
  console.log('No rows were deleted.');
}

main()
  .catch((e) => {
    console.error('Retire failed:', e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
