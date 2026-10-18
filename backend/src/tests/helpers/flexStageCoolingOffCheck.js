/**
 * One-off check for the T7 run (docs/phase3/pipeline/PW-Task/T7-Regression-flag-off.md):
 * PIPE-13's cooling-off guard, exercised on the flexible-stage fixture because
 * the 2-opening Phase 3 fixture MRF that pipelineStageEngine.test.js needs was
 * purged on 2026-09-28. Rejects "Flex Interview" and expects a new journey for
 * the same CV to be refused with 409. Staging only.
 *
 *   node src/tests/helpers/flexStageCoolingOffCheck.js
 */
import prisma from '../../config/database.js';
import { disconnectRedis } from '../../config/redis.js';
import { setStageOutcome, createPipelineJourney } from '../../services/pipeline.service.js';
import { FIXTURE_TAG } from './flexStageFixture.js';

try {
  const [{ db }] = await prisma.$queryRawUnsafe('select current_database() db');
  if (db !== 'recruitmentautomationdb') throw new Error('staging only');
  const cv = await prisma.rpa_cv.findFirst({ where: { MetaData: { contains: FIXTURE_TAG }, Name: 'Flex Interview' } });
  const journey = await prisma.rpa_candidate_pipeline.findFirst({ where: { cv_id: cv.id } });
  const other = await prisma.rpa_outcome_reasons.findFirst({ where: { is_other: true, is_active: true } });
  if (journey.current_stage_status !== 'rejected') {
    await setStageOutcome(Number(journey.id), {
      outcomeKey: 'rejected', reasonId: Number(other.id), otherText: 'T7 cooling-off check', sendEmail: false, actedBy: 1,
    });
  }
  try {
    await createPipelineJourney({ cvId: cv.id, mrfId: journey.mrf_id, source: 'screening_shortlist' });
    console.log('FAIL: journey was created');
  } catch (err) {
    console.log(err.statusCode === 409 && /cooling-off/.test(err.message) ? `PASS: ${err.statusCode} ${err.message}` : `FAIL: ${err.statusCode} ${err.message}`);
  }
  const state = await prisma.rpa_pipeline_stage_state.findMany({ where: { pipeline_id: journey.id }, select: { stage_key: true, status: true } });
  console.log('state after reject:', JSON.stringify(state));
} catch (e) {
  console.error(e.message);
} finally {
  await prisma.$disconnect();
  await disconnectRedis().catch(() => {});
  process.exit();
}
