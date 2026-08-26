/**
 * Block E — M6 Vendor notifications, end to end against staging.
 * Run: node --test src/tests/integration/vendorNotification.integration.test.js
 *
 * Covers VEND-01, 02, 03, 04, 05, 06, 07, 08, 09 and DOC-12.
 *
 * WHY THESE EXIST ALONGSIDE vendorNotification.test.js
 * ----------------------------------------------------
 * That file unit-tests the pure decision functions (22 assertions, no DB).
 * These exercise the WIRED path: a real journey, a real send, a real
 * rpa_email_messages row. The M6 changelog's headline finding was that the
 * dual-send had "never fired once" despite the logic being correct — precisely
 * the gap a unit test cannot see. VEND-01 is the single highest-priority case
 * in the whole plan for that reason.
 *
 * Vendor mail is NOT redirected away in staging the way candidate mail is:
 * resolveRecipients('vendorStatus', …) is a dynamic flow, so in non-prod it
 * still lands in the test inbox. We assert on the rpa_email_messages row, which
 * records the intended recipient and the exact body — the only way to prove
 * "no candidate free text reached the vendor".
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import prisma from '../../config/database.js';
import { disconnectRedis } from '../../config/redis.js';
import { createPipelineJourney, setStageOutcome, sendAdHocEmail } from '../../services/pipeline.service.js';
import {
  notifyVendor,
  vendorForJourney,
  vendorPolicyForStage,
  VENDOR_EVENTS,
  VENDOR_STAGE_POLICY,
} from '../../services/vendorNotification.service.js';
import { activeVendorFor, isVendorLockActive, VENDOR_LOCK_FROZEN } from '../../utils/vendorLock.js';
import { STAGE_KEYS } from '../../config/pipelineStages.js';
import { FIXTURE_TAG, CANDIDATE_EMAIL, VENDOR_EMAIL } from '../helpers/fixture.js';

const ACTED_BY = 2;
const createdJourneys = [];
const createdCvs = [];
const createdMessages = [];
let mrfSingleId;

const todayPlus = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

async function makeCv({ name, vendorEmail = null, lock = null }) {
  const cv = await prisma.rpa_cv.create({
    data: {
      Name: `${name} ${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      EmailID: CANDIDATE_EMAIL,
      PositionApplied: 'RPA Developer',
      statusActive: 'Active',
      MetaData: FIXTURE_TAG,
      createdAt: new Date(),
      modifiedAt: new Date(),
      ...(vendorEmail ? { VendorEmail: vendorEmail, vendorName: 'Phase3 Test Vendor' } : {}),
      ...(lock ? { lockForNinetyDays: lock } : {}),
    },
  });
  createdCvs.push(cv.id);
  return cv;
}

async function makeJourneyFor(cv, source = 'screening_shortlist') {
  const shortlist = await prisma.rpa_shortlisted_candidates.create({
    data: {
      cv_id: cv.id, mrf_id: mrfSingleId, candidate_name: cv.Name,
      candidate_email: CANDIDATE_EMAIL, position_applied: 'RPA Developer',
      shortlisted_by: 'phase3-testpass', recruiter_notes: FIXTURE_TAG,
    },
  });
  const journey = await createPipelineJourney({ cvId: cv.id, mrfId: mrfSingleId, shortlistId: shortlist.id, source });
  createdJourneys.push(BigInt(journey.id));
  return journey;
}

/**
 * Outbound messages for one candidate, newest first.
 *
 * Keyed on `candidate_id`, which both senders stamp from `pipelineRow.cv_id`
 * (stageNotification.service.js:262, vendorNotification.service.js:264) —
 * verified populated by direct probe before relying on it here.
 *
 * NOT keyed on `to_emails`: that column holds the POST-redirect recipients, so
 * on staging every send — candidate and vendor alike — reads as
 * EMAIL_STAGING_RECIPIENTS and the vendor's real address never appears. A
 * filter on it finds nothing, which looks exactly like "the dual-send never
 * fired" and would have reported a false defect on the suite's most important
 * case. Nor on `conversation_id`: the `vendor-…` literal is only a fallback for
 * when Graph returns no id of its own.
 */
async function messagesForCandidate(cvId) {
  const rows = await prisma.rpa_email_messages.findMany({
    where: { candidate_id: BigInt(cvId), direction: 'outbound' },
    orderBy: { id: 'desc' },
    select: { id: true, subject: true, body_html: true, to_emails: true, conversation_id: true },
  });
  rows.forEach((r) => createdMessages.push(r.id));
  return rows;
}

/**
 * The vendor's copy is the one built from the vendor template — it carries the
 * "status update only" footer that the candidate-facing templates never have.
 */
const isVendorCopy = (m) => /This is a status update only/i.test(m.body_html || '')
  || /^Candidate update —/.test(m.subject || '');

before(async () => {
  const mrf = await prisma.rpa_mrf.findFirst({
    where: { additional_information: { contains: FIXTURE_TAG }, number_of_positions: 1 }, select: { id: true },
  });
  assert.ok(mrf, 'Fixture MRF missing — run: node src/tests/helpers/fixture.js seed');
  mrfSingleId = mrf.id;
});

after(async () => {
  if (createdMessages.length) {
    await prisma.rpa_email_messages.deleteMany({ where: { id: { in: createdMessages } } });
  }
  if (createdCvs.length) {
    await prisma.rpa_email_messages.deleteMany({ where: { candidate_id: { in: createdCvs } } });
  }
  if (createdJourneys.length) {
    await prisma.rpa_pipeline_stage_events.deleteMany({ where: { pipeline_id: { in: createdJourneys } } });
    await prisma.rpa_notifications.deleteMany({ where: { pipeline_id: { in: createdJourneys } } });
    await prisma.rpa_candidate_pipeline.deleteMany({ where: { id: { in: createdJourneys } } });
  }
  if (createdCvs.length) {
    await prisma.rpa_shortlisted_candidates.deleteMany({ where: { cv_id: { in: createdCvs } } });
    await prisma.rpa_cv.deleteMany({ where: { id: { in: createdCvs } } });
  }
  await prisma.$disconnect();
  try { await disconnectRedis(); } catch { /* already closed */ }
});

// ── VEND-01 — the headline regression ─────────────────────────────────

describe('VEND-01 — dual-send fires end to end', () => {
  test('a vendor-sourced journey produces a SEPARATE vendor email on stage outcome', async () => {
    const cv = await makeCv({ name: 'VEND01', vendorEmail: VENDOR_EMAIL, lock: todayPlus(45) });
    const journey = await makeJourneyFor(cv, 'vendor_upload');

    // The fixture contract: source must be DERIVED, never hand-set.
    assert.equal(journey.source, 'vendor', 'journey must derive source=vendor from the live lock');
    assert.equal(journey.vendor_email, VENDOR_EMAIL);

    await setStageOutcome(journey.id, { outcomeKey: 'approved', actedBy: ACTED_BY });

    const msgs = await messagesForCandidate(cv.id);
    const vendorMsgs = msgs.filter(isVendorCopy);
    const candidateMsgs = msgs.filter((m) => !isVendorCopy(m));

    assert.ok(vendorMsgs.length >= 1, `expected a vendor message, found ${vendorMsgs.length} of ${msgs.length} total`);
    assert.ok(candidateMsgs.length >= 1, `expected a candidate message, found ${candidateMsgs.length} of ${msgs.length} total`);
    assert.ok(msgs.length >= 2, `candidate + vendor must be SEPARATE rows, found ${msgs.length}`);

    // Separate rows, not one message cc'd to both — the distinction M6 exists for.
    assert.notEqual(vendorMsgs[0].id, candidateMsgs[0].id, 'the vendor copy must be its own message, never a cc');
  });
});

// ── VEND-02 / DOC-12 — the disclosure matrix ──────────────────────────

describe('VEND-02 / DOC-12 — per-stage disclosure', () => {
  test('the Documents stage never notifies a vendor', async () => {
    assert.equal(VENDOR_STAGE_POLICY[STAGE_KEYS.DOCUMENTS], 'never');
    const cv = await makeCv({ name: 'VEND02-docs', vendorEmail: VENDOR_EMAIL, lock: todayPlus(45) });
    const journey = await makeJourneyFor(cv, 'vendor_upload');

    const row = await prisma.rpa_candidate_pipeline.findUnique({ where: { id: BigInt(journey.id) } });
    const result = await notifyVendor({
      pipelineRow: row, candidate: { name: cv.Name },
      eventType: VENDOR_EVENTS.STAGE_OUTCOME, stageKey: STAGE_KEYS.DOCUMENTS,
    });

    assert.equal(result.sent, false, 'no vendor mail may leave the Documents stage');
    assert.match(result.skipped, /never notifies vendors/);
  });

  test('the Offer stage discloses a bare milestone with no figures', async () => {
    assert.equal(VENDOR_STAGE_POLICY[STAGE_KEYS.OFFER], 'bare');
    const cv = await makeCv({ name: 'VEND02-offer', vendorEmail: VENDOR_EMAIL, lock: todayPlus(45) });
    const journey = await makeJourneyFor(cv, 'vendor_upload');

    const row = await prisma.rpa_candidate_pipeline.findUnique({ where: { id: BigInt(journey.id) } });
    const result = await notifyVendor({
      pipelineRow: row, candidate: { name: cv.Name },
      eventType: VENDOR_EVENTS.OFFER_SHARED, stageKey: STAGE_KEYS.OFFER,
    });
    assert.equal(result.sent, true, 'the offer stage does notify, just without detail');

    const msg = await prisma.rpa_email_messages.findUnique({ where: { id: result.messageId } });
    createdMessages.push(msg.id);
    assert.match(msg.body_html, /An offer has been extended/, 'must be the bare milestone line');

    // Check the VISIBLE TEXT, not the raw HTML: "LPA" is a substring of the
    // attributes cellPAdding/cellsPAcing, which made a naive regex over the
    // markup report a leak that was not there.
    const visibleText = msg.body_html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    for (const forbidden of [/\bCTC\b/i, /\bsalary\b/i, /\bjoining date\b/i, /\blakh\b/i, /\bLPA\b/i, /\d+[.,]\d+\s*(LPA|lakh)/i]) {
      assert.doesNotMatch(visibleText, forbidden, `no figures may reach a vendor (matched ${forbidden})`);
    }
  });

  test('an ordinary stage discloses the normal status line', async () => {
    assert.equal(vendorPolicyForStage(STAGE_KEYS.TECH1), 'standard');
  });
});

// ── VEND-03 — ad-hoc email must not leak free text ────────────────────

describe('VEND-03 — ad-hoc email never forwards free text to the vendor', () => {
  test('the vendor copy contains none of the recruiter-typed body', async () => {
    const cv = await makeCv({ name: 'VEND03', vendorEmail: VENDOR_EMAIL, lock: todayPlus(45) });
    const journey = await makeJourneyFor(cv, 'vendor_upload');

    const SECRET = 'CONFIDENTIAL-SALARY-DISCUSSION-DO-NOT-LEAK-42';
    await sendAdHocEmail(journey.id, {
      subject: 'A private note for the candidate',
      body: `<p>Dear candidate, ${SECRET}</p>`,
    });

    const msgs = await messagesForCandidate(cv.id);
    const vendorMsgs = msgs.filter(isVendorCopy);

    assert.ok(vendorMsgs.length >= 1, 'the vendor must have been notified at all, or this proves nothing');
    for (const vm of vendorMsgs) {
      assert.doesNotMatch(vm.body_html, new RegExp(SECRET), 'recruiter free text must NEVER reach a vendor');
      assert.doesNotMatch(vm.subject, new RegExp(SECRET));
    }
  });
});

// ── VEND-04 — source, not just an address on file ─────────────────────

describe('VEND-04 — vendorForJourney requires source=vendor', () => {
  test('a VendorEmail with NO live lock produces a non-vendor journey and no vendor mail', async () => {
    // Lock already expired: activeVendorFor() must return null at creation time.
    const cv = await makeCv({ name: 'VEND04', vendorEmail: VENDOR_EMAIL, lock: todayPlus(-5) });
    const journey = await makeJourneyFor(cv, 'screening_shortlist');

    assert.notEqual(journey.source, 'vendor', 'a lapsed lock must not attribute the journey to a vendor');
    assert.equal(vendorForJourney(journey), null, 'an address on file alone must not trigger a send');

    const row = await prisma.rpa_candidate_pipeline.findUnique({ where: { id: BigInt(journey.id) } });
    const result = await notifyVendor({
      pipelineRow: row, candidate: { name: cv.Name }, eventType: VENDOR_EVENTS.STAGE_OUTCOME,
    });
    assert.equal(result.sent, false);
    assert.match(result.skipped, /not a vendor-sourced journey/);
  });
});

// ── VEND-05 / VEND-06 — snapshot semantics ────────────────────────────

describe('VEND-05 / VEND-06 — attribution is snapshotted at creation', () => {
  test('VEND-05: a lock lapsing AFTER creation does not cut the vendor off', async () => {
    const cv = await makeCv({ name: 'VEND05', vendorEmail: VENDOR_EMAIL, lock: todayPlus(45) });
    const journey = await makeJourneyFor(cv, 'vendor_upload');
    assert.equal(journey.source, 'vendor');

    // Expire the lock AFTER the journey exists.
    await prisma.rpa_cv.update({ where: { id: cv.id }, data: { lockForNinetyDays: todayPlus(-1) } });

    const row = await prisma.rpa_candidate_pipeline.findUnique({ where: { id: BigInt(journey.id) } });
    assert.equal(vendorForJourney(row), VENDOR_EMAIL, 'the snapshot on the journey is never re-evaluated');

    const result = await notifyVendor({
      pipelineRow: row, candidate: { name: cv.Name },
      eventType: VENDOR_EVENTS.STAGE_OUTCOME, stageKey: STAGE_KEYS.TECH1,
    });
    assert.equal(result.sent, true, 'the vendor still hears about a journey they introduced');
    if (result.messageId) createdMessages.push(result.messageId);
  });

  test('VEND-06: a lock lapsed BEFORE a new journey does not leak onto it', async () => {
    const cv = await makeCv({ name: 'VEND06', vendorEmail: VENDOR_EMAIL, lock: todayPlus(-30) });
    const journey = await makeJourneyFor(cv, 'screening_shortlist');
    assert.notEqual(journey.source, 'vendor', 'a stale attribution must not attach to a later journey');
  });
});

// ── VEND-07 / VEND-08 / VEND-09 — the lock window ─────────────────────

describe('VEND-07 / 08 / 09 — lock boundary, malformed dates, frozen sentinel', () => {
  test('VEND-07: the expiry day itself is still active, the day after is not', async () => {
    assert.equal(isVendorLockActive(todayPlus(0)), true, 'the boundary is inclusive — today counts');
    assert.equal(isVendorLockActive(todayPlus(-1)), false, 'yesterday is expired');
    assert.equal(isVendorLockActive(todayPlus(1)), true);
  });

  test('VEND-08: a malformed lock date fails CLOSED', async () => {
    // Lexicographically "2026-13-45" sorts above every real date — the exact
    // reason the old comparison read it as "never expires".
    assert.equal(isVendorLockActive('2026-13-45'), false, 'an impossible date must not read as an active lock');
    assert.equal(isVendorLockActive('not-a-date'), false);
    assert.equal(isVendorLockActive(''), false);
    assert.equal(isVendorLockActive(null), false);

    const cv = await makeCv({ name: 'VEND08', vendorEmail: VENDOR_EMAIL, lock: '2026-13-45' });
    const journey = await makeJourneyFor(cv, 'vendor_upload');
    assert.notEqual(journey.source, 'vendor', 'no vendor attribution may come from a malformed lock');
  });

  test('VEND-09: the frozen sentinel reads as permanently active', async () => {
    assert.equal(isVendorLockActive(VENDOR_LOCK_FROZEN), true);
    assert.equal(VENDOR_LOCK_FROZEN, '9999-12-31');

    const owner = activeVendorFor({ VendorEmail: VENDOR_EMAIL, vendorName: 'X', lockForNinetyDays: VENDOR_LOCK_FROZEN });
    assert.ok(owner, 'a frozen lock still names an owner');
    assert.equal(owner.vendorEmail, VENDOR_EMAIL);
  });
});
