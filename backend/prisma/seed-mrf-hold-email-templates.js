/**
 * Adds the four MRF Hold & Delegate email templates to rpa_email_templates
 * (Email Templates › General / Alerts):
 *   - MRF On Hold Notice
 *   - MRF Hold Date Changed
 *   - MRF Decided On Your Behalf
 *   - MRF Approvers Away Notice
 *
 * CREATE-ONLY: a template that already exists is left untouched, so HR's edits
 * survive a re-run (unlike seed-email-templates.js, which overwrites every row).
 * Until a row exists the service sends the same built-in default, so running
 * this is what makes the wording editable, not what makes the emails work.
 *
 *   cd backend
 *   node prisma/seed-mrf-hold-email-templates.js            # uses NODE_ENV's env file
 *   node prisma/seed-mrf-hold-email-templates.js --dry-run  # show what would be created
 *
 * config/index.js is imported first so the env files load before anything else
 * reads them (see the env-precedence note in the plan §16.6).
 */
import config from '../src/config/index.js';
import prisma from '../src/config/database.js';
import { MRF_HOLD_TEMPLATE_DEFAULTS } from '../src/services/mrfHoldEmailTemplates.js';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const dbName = (() => {
    try { return new URL(config.database?.url || process.env.DATABASE_URL).pathname.slice(1); } catch { return '(unknown)'; }
  })();
  console.log(`Database: ${dbName}${dryRun ? '  [dry run]' : ''}`);

  for (const [name, t] of Object.entries(MRF_HOLD_TEMPLATE_DEFAULTS)) {
    const existing = await prisma.rpa_email_templates.findFirst({ where: { name } });
    if (existing) {
      console.log(`Kept    #${existing.id} "${name}" (already exists, not overwritten).`);
      continue;
    }
    if (dryRun) {
      console.log(`Would create "${name}".`);
      continue;
    }
    const created = await prisma.rpa_email_templates.create({
      data: {
        name,
        category: 'general',
        subject: t.subject,
        body_html: t.body_html,
        placeholders: [...t.placeholders],
        is_active: true,
      },
    });
    console.log(`Created #${created.id} "${name}".`);
  }
}

main()
  .catch((e) => {
    console.error('Seed failed:', e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
