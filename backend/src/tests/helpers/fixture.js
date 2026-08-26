/**
 * Phase 3 test-pass fixture — seeds the test data the two Phase 3 test plans
 * assume in their §1.3 / §1.3 "Test data" sections, and tears it down again.
 *
 *   node src/tests/helpers/fixture.js seed
 *   node src/tests/helpers/fixture.js status
 *   node src/tests/helpers/fixture.js teardown
 *
 * WHY THIS IS NOT A PRISMA SEED SCRIPT
 * ------------------------------------
 * This runs against SHARED STAGING (recruitmentautomationdb — also the dev
 * database; see docs/test-plans/phase3-test-readiness-assessment.md §2.1).
 * Everything here is therefore:
 *   - tagged with FIXTURE_TAG in a free-text column, so our rows are
 *     identifiable without relying on a created_at time window (which would
 *     also match a colleague's concurrent work — the exact reason
 *     prisma/cleanup-test-data.js must NOT be used on this database), and
 *   - torn down by EXPLICIT ID, never by timestamp.
 *
 * VENDOR ATTRIBUTION IS DERIVED, NOT SET
 * --------------------------------------
 * Both plans are emphatic that hand-setting rpa_candidate_pipeline.source =
 * 'vendor' in SQL invalidates VEND-01, the highest-priority case in the suite.
 * It would. But the write path is not the vendor upload route either:
 * createPipelineJourney() calls vendorAttributionFor(), which reads
 * VendorEmail + lockForNinetyDays off rpa_cv and asks activeVendorFor()
 * (utils/vendorLock.js) who owns the candidate right now. `source` is DERIVED
 * from a live 90-day lock at journey-creation time.
 *
 * So the honest fixture is: put a real VendorEmail and an in-window
 * lockForNinetyDays on the CV, then let createPipelineJourney() decide. That
 * exercises vendorAttributionFor -> activeVendorFor -> source:'vendor' exactly
 * as production does. We assert afterwards that source really came out as
 * 'vendor'; if it does not, the fixture fails loudly rather than letting
 * VEND-01 pass against hand-written state.
 */
import prisma from '../../config/database.js';
import { disconnectRedis } from '../../config/redis.js';
import { createPipelineJourney } from '../../services/pipeline.service.js';
import { VENDOR_LOCK_DAYS } from '../../utils/vendorLock.js';

/** Stamped into rpa_cv.MetaData so our rows are findable without a time window. */
export const FIXTURE_TAG = 'PHASE3-TESTPASS-FIXTURE';

/** Candidate mailbox supplied for the pass (Gmail — not skipped as an internal loopback). */
export const CANDIDATE_EMAIL = 'claudepankajmondal@gmail.com';

/** Vendor mailbox for the vendor-sourced journey. Matches the seeded vendor user. */
export const VENDOR_EMAIL = 'genaiuserpankajmondal@gmail.com';
export const VENDOR_NAME = 'Phase3 Test Vendor';

const iso = (d) => d.toISOString().slice(0, 10);

/** A lock expiry n days from today, in the 'YYYY-MM-DD' shape the column stores. */
function lockExpiryInDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return iso(d);
}

/**
 * The three candidates the plans call for: one fresh, one mid-flow, one
 * vendor-sourced. All share one mailbox — the pass reads the test inbox, and a
 * distinct name per row is enough to tell their mail apart.
 */
const CANDIDATES = [
  { key: 'fresh', name: 'Phase3 Fresh Candidate', position: 'RPA Developer' },
  { key: 'midflow', name: 'Phase3 Midflow Candidate', position: 'RPA Developer' },
  { key: 'vendor', name: 'Phase3 Vendor Candidate', position: 'RPA Developer' },
];

const MRFS = [
  { key: 'single', position: 'Phase3 Test Role (1 opening)', openings: 1 },
  { key: 'double', position: 'Phase3 Test Role (2 openings)', openings: 2 },
];

/** Every rpa_cv row this fixture owns, newest first. */
async function fixtureCvs() {
  return prisma.rpa_cv.findMany({
    where: { MetaData: { contains: FIXTURE_TAG } },
    select: { id: true, Name: true, EmailID: true, VendorEmail: true, lockForNinetyDays: true },
    orderBy: { id: 'asc' },
  });
}

/** Every rpa_mrf row this fixture owns. */
async function fixtureMrfs() {
  return prisma.rpa_mrf.findMany({
    where: { additional_information: { contains: FIXTURE_TAG } },
    select: { id: true, position_hiring_for: true, number_of_positions: true, filled_at: true },
    orderBy: { id: 'asc' },
  });
}

// ── seed ──────────────────────────────────────────────────────────────

export async function seed() {
  const now = new Date();
  const created = { cvs: [], mrfs: [], shortlists: [], journeys: [] };

  // 1) MRFs first — journeys reference them.
  for (const spec of MRFS) {
    const existing = await prisma.rpa_mrf.findFirst({
      where: { additional_information: { contains: FIXTURE_TAG }, position_hiring_for: spec.position },
    });
    if (existing) {
      created.mrfs.push({ ...spec, id: existing.id, reused: true });
      continue;
    }
    const row = await prisma.rpa_mrf.create({
      data: {
        position_hiring_for: spec.position,
        number_of_positions: spec.openings,
        submitter_email: 'pkmondal@aapnainfotech.com',
        date_of_request: now,
        employment_type: 'Full Time',
        additional_information: FIXTURE_TAG,
        approval_status: 'approved',
      },
    });
    created.mrfs.push({ ...spec, id: row.id, reused: false });
  }

  // 2) Candidates. The vendor one carries a LIVE 90-day lock so that
  //    createPipelineJourney() derives source:'vendor' by itself.
  for (const spec of CANDIDATES) {
    const existing = await prisma.rpa_cv.findFirst({
      where: { MetaData: { contains: FIXTURE_TAG }, Name: spec.name },
    });
    if (existing) {
      created.cvs.push({ ...spec, id: existing.id, reused: true });
      continue;
    }
    const isVendor = spec.key === 'vendor';
    const row = await prisma.rpa_cv.create({
      data: {
        Name: spec.name,
        EmailID: CANDIDATE_EMAIL,
        ContactNumber: '9000000001',
        PositionApplied: spec.position,
        CurrentLocation: 'Hyderabad',
        TotalExperienceYears: '5',
        Top5KeySkills: 'UiPath, Automation Anywhere, SQL',
        JobSource: isVendor ? 'Vendor' : 'Direct',
        statusActive: 'Active',
        MetaData: FIXTURE_TAG,
        createdAt: now,
        modifiedAt: now,
        ...(isVendor
          ? {
              VendorEmail: VENDOR_EMAIL,
              vendorName: VENDOR_NAME,
              // Mid-window, so it is unambiguously active and there is room to
              // backdate it later for VEND-05 without touching anyone else.
              lockForNinetyDays: lockExpiryInDays(Math.floor(VENDOR_LOCK_DAYS / 2)),
            }
          : {}),
      },
    });
    created.cvs.push({ ...spec, id: row.id, reused: false });
  }

  // 3) A shortlist row + journey per candidate, against the single-opening MRF.
  const singleMrf = created.mrfs.find((m) => m.key === 'single');
  for (const cv of created.cvs) {
    const spec = CANDIDATES.find((c) => c.key === cv.key);

    let shortlist = await prisma.rpa_shortlisted_candidates.findFirst({
      where: { cv_id: cv.id, mrf_id: singleMrf.id },
    });
    if (!shortlist) {
      shortlist = await prisma.rpa_shortlisted_candidates.create({
        data: {
          cv_id: cv.id,
          mrf_id: singleMrf.id,
          candidate_name: spec.name,
          candidate_email: CANDIDATE_EMAIL,
          position_applied: spec.position,
          shortlisted_by: 'phase3-testpass',
          recruiter_notes: FIXTURE_TAG,
          pipeline_status: 'shortlisted',
        },
      });
    }
    created.shortlists.push({ key: cv.key, id: shortlist.id });

    // The real service call — cooling-off guard, vendor attribution, and the
    // 'entered' stage event all happen here exactly as in production.
    const journey = await createPipelineJourney({
      cvId: cv.id,
      mrfId: singleMrf.id,
      shortlistId: shortlist.id,
      source: cv.key === 'vendor' ? 'vendor_upload' : 'screening_shortlist',
    });
    created.journeys.push({ key: cv.key, id: journey.id, source: journey.source, vendor_email: journey.vendor_email });
  }

  // 4) Assert the vendor journey really derived source:'vendor'. If this is
  //    wrong, VEND-01 would "pass" against a fiction — fail loudly instead.
  const vendorJourney = created.journeys.find((j) => j.key === 'vendor');
  if (!vendorJourney || vendorJourney.source !== 'vendor') {
    throw new Error(
      `FIXTURE INVALID: vendor journey derived source='${vendorJourney?.source}', expected 'vendor'. ` +
        'VEND-01 cannot be trusted until this is fixed — check activeVendorFor() and the seeded lock date.'
    );
  }
  if (vendorJourney.vendor_email !== VENDOR_EMAIL) {
    throw new Error(
      `FIXTURE INVALID: vendor journey pinned vendor_email='${vendorJourney.vendor_email}', expected '${VENDOR_EMAIL}'.`
    );
  }

  return created;
}

// ── status ────────────────────────────────────────────────────────────

export async function status() {
  const cvs = await fixtureCvs();
  const mrfs = await fixtureMrfs();
  const journeys = cvs.length
    ? await prisma.rpa_candidate_pipeline.findMany({
        where: { cv_id: { in: cvs.map((c) => c.id) } },
        select: {
          id: true, cv_id: true, mrf_id: true, current_stage_key: true,
          current_stage_status: true, final_outcome: true, source: true, vendor_email: true,
        },
        orderBy: { id: 'asc' },
      })
    : [];
  return { cvs, mrfs, journeys };
}

// ── teardown ──────────────────────────────────────────────────────────

/**
 * Deletes ONLY rows this fixture created, found by FIXTURE_TAG and then by
 * explicit id. Children before parents. Never uses a time window.
 */
export async function teardown() {
  const cvs = await fixtureCvs();
  const mrfs = await fixtureMrfs();
  const cvIds = cvs.map((c) => c.id);
  const mrfIds = mrfs.map((m) => m.id);
  const deleted = {};

  if (cvIds.length) {
    const journeys = await prisma.rpa_candidate_pipeline.findMany({
      where: { cv_id: { in: cvIds } }, select: { id: true },
    });
    const jIds = journeys.map((j) => j.id);

    if (jIds.length) {
      // Grandchildren of the document request first.
      const reqs = await prisma.rpa_document_requests.findMany({
        where: { pipeline_id: { in: jIds } }, select: { id: true },
      });
      if (reqs.length) {
        deleted.candidate_documents = (await prisma.rpa_candidate_documents.deleteMany({
          where: { request_id: { in: reqs.map((r) => r.id) } },
        })).count;
      }
      deleted.document_requests = (await prisma.rpa_document_requests.deleteMany({ where: { pipeline_id: { in: jIds } } })).count;

      const cards = await prisma.rpa_interview_scorecard.findMany({
        where: { pipeline_id: { in: jIds } }, select: { id: true },
      });
      if (cards.length) {
        deleted.scorecard_skills = (await prisma.rpa_interview_scorecard_skill.deleteMany({
          where: { scorecard_id: { in: cards.map((c) => c.id) } },
        })).count;
      }
      deleted.scorecards = (await prisma.rpa_interview_scorecard.deleteMany({ where: { pipeline_id: { in: jIds } } })).count;
      deleted.interviews = (await prisma.rpa_interview_schedule.deleteMany({ where: { pipeline_id: { in: jIds } } })).count;
      deleted.offers = (await prisma.rpa_offers.deleteMany({ where: { pipeline_id: { in: jIds } } })).count;
      deleted.stage_events = (await prisma.rpa_pipeline_stage_events.deleteMany({ where: { pipeline_id: { in: jIds } } })).count;
      deleted.notifications = (await prisma.rpa_notifications.deleteMany({ where: { pipeline_id: { in: jIds } } })).count;
      deleted.assessment_invites = (await prisma.rpa_assessment_invites.deleteMany({ where: { pipeline_id: { in: jIds } } })).count;
      deleted.assessment_results = (await prisma.rpa_assessment_results.deleteMany({ where: { pipeline_id: { in: jIds } } })).count;
      deleted.journeys = (await prisma.rpa_candidate_pipeline.deleteMany({ where: { id: { in: jIds } } })).count;
    }

    const shortlists = await prisma.rpa_shortlisted_candidates.findMany({
      where: { cv_id: { in: cvIds } }, select: { id: true },
    });
    if (shortlists.length) {
      const sIds = shortlists.map((s) => s.id);
      deleted.email_messages = (await prisma.rpa_email_messages.deleteMany({ where: { shortlist_id: { in: sIds } } })).count;
      deleted.zeko_pipeline = (await prisma.rpa_zeko_candidate_pipeline.deleteMany({ where: { shortlist_id: { in: sIds } } })).count;
      deleted.shortlists = (await prisma.rpa_shortlisted_candidates.deleteMany({ where: { id: { in: sIds } } })).count;
    }

    deleted.cvs = (await prisma.rpa_cv.deleteMany({ where: { id: { in: cvIds } } })).count;
  }

  if (mrfIds.length) {
    deleted.mrfs = (await prisma.rpa_mrf.deleteMany({ where: { id: { in: mrfIds } } })).count;
  }

  return deleted;
}

// ── CLI ───────────────────────────────────────────────────────────────

const j = (x) => JSON.stringify(x, (_k, v) => (typeof v === 'bigint' ? String(v) : v), 2);

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('src/tests/helpers/fixture.js')) {
  const cmd = process.argv[2] || 'status';
  try {
    if (cmd === 'seed') {
      console.log(j(await seed()));
      console.log('\nSeeded. Vendor journey verified as source=vendor.');
    } else if (cmd === 'teardown') {
      console.log(j(await teardown()));
      console.log('\nTorn down (explicit ids only — no time-window deletes).');
    } else {
      console.log(j(await status()));
    }
  } catch (err) {
    console.error(`\n${cmd} FAILED: ${err.message}`);
    process.exitCode = 1;
  } finally {
    // pipeline.service.js pulls in the shared Redis connection, which keeps the
    // event loop alive long after the work is done. Close both or the CLI hangs.
    await prisma.$disconnect();
    try {
      await disconnectRedis();
    } catch {
      // Already closed, or never opened — nothing to do.
    }
  }
}
