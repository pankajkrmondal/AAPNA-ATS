/**
 * Flexible stage movement test fixture — seeds the candidates the T2-T6 test
 * plans in docs/phase3/pipeline/PW-Task/ use, and tears them down again.
 *
 *   node src/tests/helpers/flexStageFixture.js seed
 *   node src/tests/helpers/flexStageFixture.js status
 *   node src/tests/helpers/flexStageFixture.js teardown
 *
 * Same rules as fixture.js (shared staging): every row is tagged with
 * FIXTURE_TAG in a free-text column and torn down by EXPLICIT ID found through
 * that tag, never by a time window. Journeys are created by the real
 * createPipelineJourney(); placing one on a later stage writes the journey row,
 * its state rows and an 'entered' event, the same shape the engine writes.
 */
import prisma from '../../config/database.js';
import { disconnectRedis } from '../../config/redis.js';
import { createPipelineJourney } from '../../services/pipeline.service.js';
import { writeStageStates } from '../../services/stageState.service.js';
import { VENDOR_LOCK_DAYS } from '../../utils/vendorLock.js';
import { CANDIDATE_EMAIL, VENDOR_EMAIL, VENDOR_NAME } from './fixture.js';

export const FIXTURE_TAG = 'FLEXSTAGE-TESTPASS-FIXTURE';
const MRF_POSITION = 'FlexStage Test Role';

/**
 * place: the stage the journey is put on; passed: stages marked completed;
 * booking: a live interview row on the placed stage (locks the card).
 */
const CANDIDATES = [
  { key: 'a', name: 'Flex Fresh A', place: null },
  { key: 'b', name: 'Flex Fresh B', place: null },
  { key: 'interview', name: 'Flex Interview', place: 'tech1', passed: ['zeko_hr', 'assessment', 'zeko_fn'], booking: true },
  { key: 'assessment', name: 'Flex Assessment', place: 'assessment', passed: ['zeko_hr'] },
  { key: 'documents', name: 'Flex Documents', place: 'documents', passed: ['zeko_hr', 'assessment', 'zeko_fn', 'tech1', 'tech2', 'hr_round'] },
  { key: 'passed', name: 'Flex Passed Fn', place: 'tech2', passed: ['zeko_hr', 'zeko_fn', 'tech1'], skipped: ['assessment'] },
  { key: 'vendor', name: 'Flex Vendor', place: 'assessment', passed: ['zeko_hr'], vendor: true },
];

const iso = (d) => d.toISOString().slice(0, 10);

async function fixtureCvs() {
  return prisma.rpa_cv.findMany({ where: { MetaData: { contains: FIXTURE_TAG } }, select: { id: true, Name: true }, orderBy: { id: 'asc' } });
}

export async function seed() {
  const [{ db }] = await prisma.$queryRawUnsafe('select current_database() db');
  if (db !== 'recruitmentautomationdb') throw new Error(`Refusing to seed "${db}" — staging only.`);
  const now = new Date();
  let mrf = await prisma.rpa_mrf.findFirst({ where: { additional_information: { contains: FIXTURE_TAG } } });
  if (!mrf) {
    mrf = await prisma.rpa_mrf.create({
      data: {
        position_hiring_for: MRF_POSITION,
        number_of_positions: 2,
        submitter_email: 'pkmondal@aapnainfotech.com',
        date_of_request: now,
        employment_type: 'Full Time',
        additional_information: FIXTURE_TAG,
        approval_status: 'approved',
      },
    });
  }

  const out = [];
  for (const spec of CANDIDATES) {
    let cv = await prisma.rpa_cv.findFirst({ where: { MetaData: { contains: FIXTURE_TAG }, Name: spec.name } });
    if (!cv) {
      const lock = new Date(); lock.setDate(lock.getDate() + Math.floor(VENDOR_LOCK_DAYS / 2));
      cv = await prisma.rpa_cv.create({
        data: {
          Name: spec.name,
          EmailID: CANDIDATE_EMAIL,
          ContactNumber: '9000000002',
          PositionApplied: MRF_POSITION,
          CurrentLocation: 'Hyderabad',
          TotalExperienceYears: '4',
          Top5KeySkills: 'Node.js, React, SQL',
          JobSource: spec.vendor ? 'Vendor' : 'Direct',
          statusActive: 'Active',
          MetaData: FIXTURE_TAG,
          createdAt: now,
          modifiedAt: now,
          ...(spec.vendor ? { VendorEmail: VENDOR_EMAIL, vendorName: VENDOR_NAME, lockForNinetyDays: iso(lock) } : {}),
        },
      });
    }
    let shortlist = await prisma.rpa_shortlisted_candidates.findFirst({ where: { cv_id: cv.id, mrf_id: mrf.id } });
    if (!shortlist) {
      shortlist = await prisma.rpa_shortlisted_candidates.create({
        data: {
          cv_id: cv.id,
          mrf_id: mrf.id,
          candidate_name: spec.name,
          candidate_email: CANDIDATE_EMAIL,
          position_applied: MRF_POSITION,
          shortlisted_by: 'flexstage-testpass',
          recruiter_notes: FIXTURE_TAG,
          pipeline_status: 'shortlisted',
        },
      });
    }
    const journey = await createPipelineJourney({ cvId: cv.id, mrfId: mrf.id, shortlistId: shortlist.id, source: 'screening_shortlist' });
    const id = BigInt(journey.id);

    if (spec.place && journey.current_stage_key === 'zeko_hr') {
      await prisma.$transaction(async (tx) => {
        await tx.rpa_candidate_pipeline.update({ where: { id }, data: { current_stage_key: spec.place, current_stage_status: 'in_progress', modified_at: new Date() } });
        for (const key of spec.passed || []) {
          await tx.rpa_pipeline_stage_events.create({ data: { pipeline_id: id, stage_key: key, event_type: 'outcome', outcome: 'approved', status_label: `${key} Approved`, notes: 'Fixture history' } });
        }
        await tx.rpa_pipeline_stage_events.create({ data: { pipeline_id: id, stage_key: spec.place, event_type: 'entered', notes: 'Fixture placement' } });
        await writeStageStates(tx, id, [
          ...(spec.passed || []).map((k) => ({ stageKey: k, status: 'completed' })),
          ...(spec.skipped || []).map((k) => ({ stageKey: k, status: 'skipped' })),
          { stageKey: spec.place, status: 'active' },
        ]);
        if (spec.booking) {
          const start = new Date(Date.now() + 3 * 24 * 3600 * 1000);
          await tx.rpa_interview_schedule.create({
            data: {
              pipeline_id: id, stage_key: spec.place, interviewer_name: 'Fixture Panel', interviewer_email: 'pkmondal@aapnainfotech.com',
              scheduled_start_at: start, scheduled_end_at: new Date(start.getTime() + 3600 * 1000), status: 'scheduled', notes: FIXTURE_TAG,
            },
          });
        }
      });
    }
    out.push({ key: spec.key, name: spec.name, pipelineId: Number(id), source: journey.source });
  }
  return { mrfId: Number(mrf.id), journeys: out };
}

export async function status() {
  const cvs = await fixtureCvs();
  return prisma.rpa_candidate_pipeline.findMany({
    where: { cv_id: { in: cvs.map((c) => c.id) } },
    select: { id: true, current_stage_key: true, current_stage_status: true, final_outcome: true, source: true, rpa_shortlisted_candidates: { select: { candidate_name: true } } },
    orderBy: { id: 'asc' },
  });
}

/** Deletes only this fixture's rows: found by tag, removed by explicit id, children first. */
export async function teardown() {
  const [{ db }] = await prisma.$queryRawUnsafe('select current_database() db');
  if (db !== 'recruitmentautomationdb') throw new Error(`Refusing to tear down "${db}".`);
  const cvIds = (await fixtureCvs()).map((c) => c.id);
  const mrfIds = (await prisma.rpa_mrf.findMany({ where: { additional_information: { contains: FIXTURE_TAG } }, select: { id: true } })).map((m) => m.id);
  const deleted = {};
  if (cvIds.length) {
    const jIds = (await prisma.rpa_candidate_pipeline.findMany({ where: { cv_id: { in: cvIds } }, select: { id: true } })).map((j) => j.id);
    if (jIds.length) {
      const reqIds = (await prisma.rpa_document_requests.findMany({ where: { pipeline_id: { in: jIds } }, select: { id: true } })).map((r) => r.id);
      if (reqIds.length) deleted.candidate_documents = (await prisma.rpa_candidate_documents.deleteMany({ where: { request_id: { in: reqIds } } })).count;
      deleted.document_requests = (await prisma.rpa_document_requests.deleteMany({ where: { pipeline_id: { in: jIds } } })).count;
      const cardIds = (await prisma.rpa_interview_scorecard.findMany({ where: { pipeline_id: { in: jIds } }, select: { id: true } })).map((c) => c.id);
      if (cardIds.length) deleted.scorecard_skills = (await prisma.rpa_interview_scorecard_skill.deleteMany({ where: { scorecard_id: { in: cardIds } } })).count;
      deleted.scorecards = (await prisma.rpa_interview_scorecard.deleteMany({ where: { pipeline_id: { in: jIds } } })).count;
      deleted.interviews = (await prisma.rpa_interview_schedule.deleteMany({ where: { pipeline_id: { in: jIds } } })).count;
      deleted.offers = (await prisma.rpa_offers.deleteMany({ where: { pipeline_id: { in: jIds } } })).count;
      deleted.notifications = (await prisma.rpa_notifications.deleteMany({ where: { pipeline_id: { in: jIds } } })).count;
      deleted.assessment_invites = (await prisma.rpa_assessment_invites.deleteMany({ where: { pipeline_id: { in: jIds } } })).count;
      deleted.assessment_results = (await prisma.rpa_assessment_results.deleteMany({ where: { pipeline_id: { in: jIds } } })).count;
      deleted.stage_events = (await prisma.rpa_pipeline_stage_events.deleteMany({ where: { pipeline_id: { in: jIds } } })).count;
      deleted.journeys = (await prisma.rpa_candidate_pipeline.deleteMany({ where: { id: { in: jIds } } })).count; // cascades stage state
    }
    const sIds = (await prisma.rpa_shortlisted_candidates.findMany({ where: { cv_id: { in: cvIds } }, select: { id: true } })).map((s) => s.id);
    if (sIds.length) {
      deleted.email_messages = (await prisma.rpa_email_messages.deleteMany({ where: { shortlist_id: { in: sIds } } })).count;
      deleted.zeko_pipeline = (await prisma.rpa_zeko_candidate_pipeline.deleteMany({ where: { candidate_id: { in: sIds } } })).count;
      deleted.shortlists = (await prisma.rpa_shortlisted_candidates.deleteMany({ where: { id: { in: sIds } } })).count;
    }
    deleted.cvs = (await prisma.rpa_cv.deleteMany({ where: { id: { in: cvIds } } })).count;
  }
  if (mrfIds.length) deleted.mrfs = (await prisma.rpa_mrf.deleteMany({ where: { id: { in: mrfIds } } })).count;
  return deleted;
}

const j = (x) => JSON.stringify(x, (_k, v) => (typeof v === 'bigint' ? String(v) : v), 2);
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('src/tests/helpers/flexStageFixture.js')) {
  const cmd = process.argv[2] || 'status';
  try {
    if (cmd === 'seed') console.log(j(await seed()));
    else if (cmd === 'teardown') console.log(j(await teardown()));
    else console.log(j(await status()));
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    await disconnectRedis().catch(() => {});
    process.exit();
  }
}
