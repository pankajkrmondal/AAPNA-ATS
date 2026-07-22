/**
 * Seeds the Phase 3 stage engine: rpa_pipeline_stages, rpa_stage_outcomes,
 * rpa_outcome_reasons.
 *
 * Idempotent (upsert by natural key) — safe to re-run. Run ONCE PER ENVIRONMENT,
 * same convention as seed-email-recipients.js / seed-email-templates.js:
 *
 *   cross-env NODE_ENV=staging    node prisma/seed-pipeline-stages.js
 *   cross-env NODE_ENV=production node prisma/seed-pipeline-stages.js
 *
 * (or: npm run seed:stages:staging / npm run seed:stages:prod)
 *
 * Stage list mirrors docs/phase3/02-BUSINESS-DESIGN.md §1.1 (12 columns,
 * Tech 3 and Client Interview optional) and CandidatePipelinePrototype.jsx's
 * STAGES constant (kept in sync intentionally — the prototype's mock stage
 * list becomes the real seeded config here).
 *
 * Outcome sets follow 03-DEVELOPMENT-PLAN.md §M1: default Approved/Rejected/Hold
 * everywhere, Future Prospect added at Stage 0 (Q30), the 8 closure statuses at
 * the terminal "offer" stage (Q12 definitions).
 *
 * Reason taxonomy: the existing Stage 0 list is reused at every stage (Q19,
 * RT 2026-07-13) plus a free-text "Other reasons" entry per stage.
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
const prisma = new PrismaClient({
  datasources: { db: { url: databaseUrl } },
});

/**
 * The 11 active pipeline columns. `stage_type` drives how the Tracker
 * renders/behaves per stage.
 *
 * `shortlist` is kept upserted (not deleted — historical
 * rpa_pipeline_stage_events / legacy status labels still reference it) but
 * seeded `is_active: false`: shortlisting happens on Candidate Screening,
 * not as a step inside this pipeline, so the real Tracker (like the
 * CandidatePipelinePrototype.jsx v8+ redesign it mirrors) starts at HR
 * Screening (Zeko). Shortlist context (date/by/notes/resume) is shown as a
 * persistent read-only line in the drawer header instead — see
 * pipeline.service.js's getPipelineDetail `screening` field.
 */
const STAGES = [
  { stage_key: 'shortlist', label: 'Shortlisted',            sort_order: 10,  stage_type: 'manual', is_active: false },
  { stage_key: 'zeko_hr',   label: 'HR Screening (Zeko)',     sort_order: 20,  stage_type: 'zeko' },
  { stage_key: 'assessment',label: 'IQ / Tech Assessment',    sort_order: 30,  stage_type: 'manual' },
  { stage_key: 'zeko_fn',   label: 'Functional Screening (Zeko)', sort_order: 40, stage_type: 'zeko' },
  { stage_key: 'tech1',     label: 'Technical Round 1',       sort_order: 50,  stage_type: 'scheduled_interview' },
  { stage_key: 'tech2',     label: 'Technical Round 2',       sort_order: 60,  stage_type: 'scheduled_interview' },
  { stage_key: 'tech3',     label: 'Technical Round 3',       sort_order: 70,  stage_type: 'scheduled_interview', is_optional: true },
  { stage_key: 'hr_round',  label: 'HR Round',                sort_order: 80,  stage_type: 'scheduled_interview' },
  { stage_key: 'ceo',       label: 'CEO / Final Round',       sort_order: 90,  stage_type: 'scheduled_interview' },
  { stage_key: 'client',    label: 'Client Interview',        sort_order: 100, stage_type: 'scheduled_interview', is_optional: true },
  { stage_key: 'documents', label: 'Documents',               sort_order: 110, stage_type: 'document' },
  { stage_key: 'offer',     label: 'Offer',                   sort_order: 120, stage_type: 'offer' },
];

/** Default Approved/Rejected/Hold outcome set, added to every stage below. */
const DEFAULT_OUTCOMES = [
  { outcome_key: 'approved', label: 'Approved', is_advance: true,  is_final: false, sort_order: 10 },
  { outcome_key: 'rejected', label: 'Rejected', is_advance: false, is_final: false, sort_order: 20 },
  { outcome_key: 'hold',     label: 'Hold',     is_advance: false, is_final: false, sort_order: 30 },
];

/** Stage 0 additionally gets Future Prospect (Q30 — parked-but-retrievable, not a rejection). */
const STAGE0_EXTRA_OUTCOMES = [
  { outcome_key: 'future_prospect', label: 'Future Prospect', is_advance: false, is_final: false, sort_order: 15 },
];

/** The 8 closure statuses (Q12) — modeled as terminal outcomes on the "offer" stage,
 * since offer/closure share the same stage in this seed's 12-column layout. */
const CLOSURE_OUTCOMES = [
  { outcome_key: 'closure_approved',   label: 'Approved',            is_advance: false, is_final: true, sort_order: 200 },
  { outcome_key: 'closure_rejected',   label: 'Rejected',            is_advance: false, is_final: true, sort_order: 210 },
  { outcome_key: 'closure_on_hold',    label: 'On Hold',             is_advance: false, is_final: true, sort_order: 220 },
  { outcome_key: 'candidate_withdrawn',label: 'Candidate Withdrawn', is_advance: false, is_final: true, sort_order: 230 },
  { outcome_key: 'joined',             label: 'Joined',              is_advance: false, is_final: true, sort_order: 240 },
  { outcome_key: 'did_not_join',       label: 'Did Not Join',        is_advance: false, is_final: true, sort_order: 250 },
  { outcome_key: 'joined_and_left',    label: 'Joined and Left',     is_advance: false, is_final: true, sort_order: 260 },
  { outcome_key: 'backed_out',         label: 'Backed Out',          is_advance: false, is_final: true, sort_order: 270 },
];

/** Stage 0 taxonomy, reused at every stage per Q19 (RT, 2026-07-13). */
const REASON_TAXONOMY = [
  'High Salary Expectation',
  'High Notice Period',
  'Weak Communication',
  'Skills Mismatch',
  'Frequent Job Changes',
  'Unresponsive / No-show',
  'Client Rejected Profile',
  'Failed Assessment Threshold',
];

async function upsertStage(stage) {
  const isActive = stage.is_active !== false;
  await prisma.rpa_pipeline_stages.upsert({
    where: { stage_key: stage.stage_key },
    update: {
      label: stage.label,
      sort_order: stage.sort_order,
      stage_type: stage.stage_type,
      is_optional: !!stage.is_optional,
      is_active: isActive,
      modified_at: new Date(),
    },
    create: {
      stage_key: stage.stage_key,
      label: stage.label,
      sort_order: stage.sort_order,
      stage_type: stage.stage_type,
      is_optional: !!stage.is_optional,
      is_active: isActive,
    },
  });
}

async function upsertOutcome(stageKey, outcome) {
  await prisma.rpa_stage_outcomes.upsert({
    where: { stage_key_outcome_key: { stage_key: stageKey, outcome_key: outcome.outcome_key } },
    update: {
      label: outcome.label,
      is_advance: outcome.is_advance,
      is_final: outcome.is_final,
      sort_order: outcome.sort_order,
      modified_at: new Date(),
    },
    create: {
      stage_key: stageKey,
      outcome_key: outcome.outcome_key,
      label: outcome.label,
      is_advance: outcome.is_advance,
      is_final: outcome.is_final,
      sort_order: outcome.sort_order,
    },
  });
}

/** Reasons are stage-scoped in the schema; NULL stage_key = applies everywhere.
 * We seed them once with stage_key = NULL so every stage shares the same list,
 * matching Q19's "Stage 0 list is fine across the board" answer. */
async function upsertGlobalReasons() {
  for (const [i, label] of REASON_TAXONOMY.entries()) {
    const existing = await prisma.rpa_outcome_reasons.findFirst({
      where: { stage_key: null, reason_label: label },
    });
    if (existing) {
      await prisma.rpa_outcome_reasons.update({
        where: { id: existing.id },
        data: { sort_order: i * 10, is_active: true },
      });
    } else {
      await prisma.rpa_outcome_reasons.create({
        data: {
          stage_key: null,
          outcome_key: 'rejected',
          reason_label: label,
          is_other: false,
          sort_order: i * 10,
        },
      });
    }
  }

  // Free-text "Other reasons" entry (Q19) — applies to every stage's Reject/Hold.
  const otherExisting = await prisma.rpa_outcome_reasons.findFirst({
    where: { stage_key: null, is_other: true },
  });
  if (!otherExisting) {
    await prisma.rpa_outcome_reasons.create({
      data: {
        stage_key: null,
        outcome_key: 'rejected',
        reason_label: 'Other reasons',
        is_other: true,
        sort_order: 999,
      },
    });
  }
}

async function main() {
  console.log(`Seeding pipeline stages/outcomes/reasons — NODE_ENV=${NODE_ENV}`);

  for (const stage of STAGES) {
    await upsertStage(stage);
    for (const outcome of DEFAULT_OUTCOMES) {
      await upsertOutcome(stage.stage_key, outcome);
    }
    if (stage.stage_key === 'shortlist') {
      for (const outcome of STAGE0_EXTRA_OUTCOMES) {
        await upsertOutcome(stage.stage_key, outcome);
      }
    }
    if (stage.stage_key === 'offer') {
      for (const outcome of CLOSURE_OUTCOMES) {
        await upsertOutcome(stage.stage_key, outcome);
      }
    }
  }

  await upsertGlobalReasons();

  console.log(`Seeded ${STAGES.length} stages, default outcomes, Stage 0 + closure outcomes, and the shared reason taxonomy.`);
}

main()
  .catch((err) => {
    console.error('Pipeline stage seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
