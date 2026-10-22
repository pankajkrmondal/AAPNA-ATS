// Run ONE pass of the MRF/candidate reminder cron now (for testing on staging /
// local). Uses the same env as the server, so non-production mail is redirected
// to EMAIL_STAGING_RECIPIENTS exactly as the scheduled job would be.
//
//   cd backend && node scripts/run-reminders-once.mjs
//
// Refuses to run against production unless --allow-production is passed.
import config from '../src/config/index.js';
import prisma from '../src/config/database.js';
import { loadEmailRecipients } from '../src/config/emailRecipients.js';
import { sendPendingReminders } from '../src/jobs/reminderScheduler.js';

const [{ db }] = await prisma.$queryRawUnsafe('select current_database() db');
if (config.isProduction && !process.argv.includes('--allow-production')) {
  console.error(`Refusing to run against production (${db}) without --allow-production.`);
  process.exit(1);
}
console.log(`Running one reminder pass against ${db} (redirect to test inbox: ${config.email.redirectInNonProd})`);
await loadEmailRecipients();
await sendPendingReminders();
await prisma.$disconnect();
process.exit(0);
