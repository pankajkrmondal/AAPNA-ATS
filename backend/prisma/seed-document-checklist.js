/**
 * Seeds the document-collection checklist (rpa_document_checklist_items).
 *
 * Idempotent (upsert by item_key) — safe to re-run. Run ONCE PER ENVIRONMENT,
 * same convention as seed-pipeline-stages.js:
 *
 *   cross-env NODE_ENV=staging    node prisma/seed-document-checklist.js
 *   cross-env NODE_ENV=production node prisma/seed-document-checklist.js
 *
 * (or: npm run seed:documents:staging / npm run seed:documents:prod)
 *
 * The list below is Chhaya's actual request template (2026-07-14): last 3
 * months' payslips, permanent address, and one government ID showing DOB +
 * father's name. It is deliberately NARROWER than the older 4-item draft in
 * docs/phase3/04-QUESTIONS.md Q8 (which also had education certificates and
 * experience/relieving letters) — that draft predates the real template.
 *
 * Because the checklist is data, changing it later is an admin edit, not a
 * redeploy: add a row, or flip is_active off.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const NODE_ENV = (process.env.NODE_ENV || 'development').trim();

dotenv.config({ path: path.resolve(projectRoot, `.env.${NODE_ENV}`) });
dotenv.config({ path: path.resolve(projectRoot, '.env') });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. Check your .env files.');
  process.exit(1);
}

const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

const CHECKLIST = [
  {
    item_key: 'payslips_last_3_months',
    label: "Last 3 months' payslips",
    description: 'Salary slips for the three most recent months.',
    sort_order: 10,
  },
  {
    item_key: 'permanent_address',
    label: 'Permanent address proof',
    description: 'A document showing your permanent address.',
    sort_order: 20,
  },
  {
    item_key: 'government_id',
    label: 'Government ID (showing date of birth and father’s name)',
    description: 'One government-issued photo ID that shows both your date of birth and your father’s name.',
    sort_order: 30,
  },
];

async function main() {
  console.log(`Seeding document checklist — NODE_ENV=${NODE_ENV}`);

  for (const item of CHECKLIST) {
    await prisma.rpa_document_checklist_items.upsert({
      where: { item_key: item.item_key },
      create: item,
      // Label/description/order stay in sync on re-run; is_active is NOT
      // overwritten, so an admin who deactivated an item keeps that choice.
      update: {
        label: item.label,
        description: item.description,
        sort_order: item.sort_order,
        modified_at: new Date(),
      },
    });
  }

  console.log(`Seeded ${CHECKLIST.length} checklist item(s).`);
}

main()
  .catch((err) => {
    console.error('Document checklist seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
