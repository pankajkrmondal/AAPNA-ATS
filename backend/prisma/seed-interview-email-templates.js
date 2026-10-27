/**
 * Adds the two L14 interview email templates to rpa_email_templates
 * (Email Templates › General / Alerts):
 *   - Interview Feedback Received          (to the recruitment mailbox on submit)
 *   - Candidate Pack for Interview Panel   (the drawer's "Send to panel" action)
 *
 * CREATE-ONLY, like seed-mrf-hold-email-templates.js: a template that already
 * exists is left untouched, so HR's edits survive a re-run. Until a row exists
 * the service sends the same built-in default, so running this is what makes
 * the wording editable, not what makes the emails work.
 *
 *   cd backend
 *   node prisma/seed-interview-email-templates.js            # uses NODE_ENV's env file
 *   node prisma/seed-interview-email-templates.js --dry-run  # show what would be created
 */
import config from '../src/config/index.js';
import prisma from '../src/config/database.js';
import { INTERVIEW_EMAIL_TEMPLATE_DEFAULTS } from '../src/services/interviewEmailTemplates.js';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const dbName = (() => {
    try { return new URL(config.database?.url || process.env.DATABASE_URL).pathname.slice(1); } catch { return '(unknown)'; }
  })();
  console.log(`Database: ${dbName}${dryRun ? '  [dry run]' : ''}`);

  for (const [name, t] of Object.entries(INTERVIEW_EMAIL_TEMPLATE_DEFAULTS)) {
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
