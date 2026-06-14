/**
 * Seeds per-flow email recipients into the `rpa_settings` table.
 *
 * Staging and production use SEPARATE databases, so this script picks the
 * recipient map based on NODE_ENV and writes it to whichever database
 * DATABASE_URL currently points at. Run it ONCE PER ENVIRONMENT:
 *
 *   cross-env NODE_ENV=staging    node prisma/seed-email-recipients.js
 *   cross-env NODE_ENV=production node prisma/seed-email-recipients.js
 *
 * (or use the npm scripts: `npm run seed:recipients:staging` / `:prod`)
 *
 * Keys follow the convention used by src/config/emailRecipients.js:
 *   email_recipients.<flowKey>.to
 *   email_recipients.<flowKey>.cc
 *
 * Values are comma-separated email lists. For "dynamic" flows (where the real
 * recipient is the candidate/vendor/submitter computed at runtime) the static
 * `to` is left empty in production; it only acts as a fallback. The values
 * below mirror the staging and production n8n workflow definitions.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const NODE_ENV = (process.env.NODE_ENV || 'development').trim();

// Resolve the env-specific DATABASE_URL ourselves. dotenv does NOT overwrite
// already-set vars, so the env-specific file (loaded first) wins over .env.
dotenv.config({ path: path.resolve(projectRoot, `.env.${NODE_ENV}`) });
dotenv.config({ path: path.resolve(projectRoot, '.env') });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. Check your .env files.');
  process.exit(1);
}

// IMPORTANT: pass the DSN explicitly. Prisma's client otherwise resolves
// DATABASE_URL from the project's .env file via its own loader, which would
// ignore the env-specific value we just resolved and silently target the
// wrong database.
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient({
  datasources: { db: { url: databaseUrl } },
});

/**
 * Per-environment recipient maps, taken from the n8n workflow definitions.
 *
 * ONLY flows whose STATIC value the code actually consumes are seeded here.
 * Fully dynamic flows (welcome, missingData, vendorDuplicateSame/Diff,
 * mrfRequest, interviewScheduled, interviewCancelled) resolve their recipient
 * from the runtime value (candidate/vendor/HM email) in production and are
 * redirected to the internal test inbox in non-production — their static value
 * is never read, so they are intentionally NOT seeded. The unimplemented
 * Step 2.6 "Status Update & Notify" (statusUpdateCc) is likewise not seeded.
 *
 * Each seeded flow defines `to` and/or `cc` (comma-separated lists).
 */
const RECIPIENTS = {
  staging: {
    resumeErrorAlert:   { to: 'pkmondal@aapnainfotech.com', cc: '' },
    missingEmailAlert:  { to: 'hmopuri@aapnainfotech.com', cc: '' },
    duplicateAlert:     { to: 'pkmondal@aapnainfotech.com', cc: '' },
    mrfApproval:        { to: 'hmopuri@aapnainfotech.com, saukumar@aapnainfotech.com, pkmondal@aapnainfotech.com', cc: '' },
    mrfSubmitHrNotify:  { to: 'hmopuri@aapnainfotech.com, saukumar@aapnainfotech.com', cc: '' },
    mrfOutcome:         { to: 'hmopuri@aapnainfotech.com, saukumar@aapnainfotech.com', cc: '' },
    shortlistCc:        { to: '', cc: 'pkmondal@aapnainfotech.com' },
  },
  production: {
    resumeErrorAlert:   { to: 'pkmondal@aapnainfotech.com', cc: '' },
    missingEmailAlert:  { to: 'nsatywali@aapnainfotech.com, cverma@aapnainfotech.com', cc: '' },
    duplicateAlert:     { to: 'claudepankajmondal@gmail.com', cc: '' },
    mrfApproval:        { to: 'aroy@aapnainfotech.com, sroy@aapnainfotech.com', cc: '' },
    mrfSubmitHrNotify:  { to: 'recruitment@aapnainfotech.in, nsatywali@aapnainfotech.com, cverma@aapnainfotech.com', cc: '' },
    mrfOutcome:         { to: 'recruitment@aapnainfotech.in', cc: 'sroy@aapnainfotech.com, nsatywali@aapnainfotech.com, cverma@aapnainfotech.com' },
    shortlistCc:        { to: '', cc: 'recruitment@aapnainfotech.in' },
  },
};

async function main() {
  // Anything that isn't production is treated as the staging/test profile.
  const profile = NODE_ENV === 'production' ? 'production' : 'staging';
  const map = RECIPIENTS[profile];

  console.log(`Seeding email recipients for "${profile}" profile (NODE_ENV=${NODE_ENV})...`);
  console.log(`Target DB: ${(process.env.DATABASE_URL || '').replace(/:[^:@/]+@/, ':****@')}`);

  let count = 0;
  for (const [flowKey, fields] of Object.entries(map)) {
    for (const field of ['to', 'cc']) {
      const key = `email_recipients.${flowKey}.${field}`;
      const value = fields[field] ?? '';
      await prisma.rpa_settings.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      });
      count++;
    }
  }

  console.log(`Done. Upserted ${count} rpa_settings row(s).`);
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
