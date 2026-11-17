/**
 * Adds the U08 "Zeko Interview Reminder" template to rpa_email_templates
 * (Email Templates › Interview).
 *
 * CREATE-ONLY, like seed-interview-email-templates.js: a template that already
 * exists is left untouched, so HR's edits survive a re-run. Until a row exists
 * the reminder job sends the same built-in default, so running this is what
 * makes the wording editable, not what makes the email work.
 *
 *   cd backend
 *   node prisma/seed-zeko-reminder-template.js            # uses NODE_ENV's env file
 *   node prisma/seed-zeko-reminder-template.js --dry-run  # show what would be created
 */
import config from '../src/config/index.js';
import prisma from '../src/config/database.js';
import { ZEKO_REMINDER_TEMPLATE_DEFAULT as T } from '../src/services/zekoReminderTemplate.js';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const dbName = (() => {
    try { return new URL(config.database?.url || process.env.DATABASE_URL).pathname.slice(1); } catch { return '(unknown)'; }
  })();
  console.log(`Database: ${dbName}${dryRun ? '  [dry run]' : ''}`);

  const existing = await prisma.rpa_email_templates.findFirst({ where: { name: T.name } });
  if (existing) {
    console.log(`Kept    #${existing.id} "${T.name}" (already exists, not overwritten).`);
    return;
  }
  if (dryRun) {
    console.log(`Would create "${T.name}".`);
    return;
  }
  const created = await prisma.rpa_email_templates.create({
    data: {
      name: T.name,
      category: T.category,
      subject: T.subject,
      body_html: T.body_html,
      placeholders: [...T.placeholders],
      is_active: true,
    },
  });
  console.log(`Created #${created.id} "${T.name}".`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
