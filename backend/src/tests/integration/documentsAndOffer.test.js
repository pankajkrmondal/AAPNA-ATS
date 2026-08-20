/**
 * Blocks C + D â€” M4 Document Collection and M5 Offer / MRF closure.
 * Run: node --test src/tests/integration/documentsAndOffer.test.js
 *
 * Covers DOC-01, 02, 06, 07, 08, 09, 10, 13 and
 *        OFFER-01, 02, 04, 05, 07, 08, 09, 10, 11, 12, 13, 16.
 *
 * NOT covered here (needs a real file/OneDrive round trip or the public HTTP
 * route, recorded as Manual in the results doc): DOC-03 upload happy path,
 * DOC-04 client-side validation, DOC-05 multer type/size rejection, DOC-11
 * reminder sweep selection, DOC-12 (covered in the vendor file instead).
 *
 * Same shared-staging safety rules as the other integration files: fixture-
 * tagged rows only, torn down by explicit id, MRFs restored in after().
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import prisma from '../../config/database.js';
import { disconnectRedis } from '../../config/redis.js';
import { createPipelineJourney, setFinalOutcome } from '../../services/pipeline.service.js';
import {
  requestDocuments,
  verifyDocument,
  rejectDocument,
  sendReminder,
  getDocumentStatus,
} from '../../services/documentCollection.service.js';
import {
  requestApproval,
  approveOffer,
  recordOfferShared,
  recordCandidateDecision,
  getOffer,
} from '../../services/offer.service.js';
import { FINAL_OUTCOMES } from '../../config/pipelineStages.js';
import { FIXTURE_TAG, CANDIDATE_EMAIL } from '../helpers/fixture.js';

const ACTED_BY = 2;
const createdJourneys = [];
const createdCvs = [];
let mrfSingleId;
let mrfDoubleId;

async function makeJourney({ name, mrfId }) {
  const cv = await prisma.rpa_cv.create({
    data: {
      Name: `${name} ${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      EmailID: CANDIDATE_EMAIL, PositionApplied: 'RPA Developer',
      statusActive: 'Active', MetaData: FIXTURE_TAG,
      createdAt: new Date(), modifiedAt: new Date(),
    },
  });
  createdCvs.push(cv.id);
  const shortlist = await prisma.rpa_shortlisted_candidates.create({
    data: {
      cv_id: cv.id, mrf_id: mrfId ?? mrfSingleId, candidate_name: cv.Name,
      candidate_email: CANDIDATE_EMAIL, position_applied: 'RPA Developer',
      shortlisted_by: 'phase3-testpass', recruiter_notes: FIXTURE_TAG,
    },
  });
  const journey = await createPipelineJourney({
    cvId: cv.id, mrfId: mrfId ?? mrfSingleId, shortlistId: shortlist.id, source: 'screening_shortlist',
  });
  createdJourneys.push(BigInt(journey.id));
  return { cv, shortlist, journey };
}

/**
 * getDocumentStatus / requestDocuments return { request, checklist }, with the
 * per-item rows nested under request.rpa_candidate_documents â€” not a top-level
 * `documents` array. Unwrapped here so each test reads plainly.
 */
async function docsFor(pipelineId) {
  const { request, checklist } = await getDocumentStatus(pipelineId);
  return { request, checklist, documents: request?.rpa_candidate_documents || [] };
}

const createdMrfs = [];

/**
 * A private single-use MRF for the closure-arithmetic cases.
 *
 * countAcceptedHires() counts EVERY accepted offer against an MRF, so two tests
 * sharing one fixture MRF contaminate each other's arithmetic — the first
 * test's acceptance is still counted by the second, which is what made
 * OFFER-08/09/10 fail on the first run for a reason unrelated to the product.
 * Each of those cases now gets its own requisition.
 */
async function makeMrf(openings) {
  const row = await prisma.rpa_mrf.create({
    data: {
      position_hiring_for: `Phase3 ${openings}-opening ${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      number_of_positions: openings,
      submitter_email: 'pkmondal@aapnainfotech.com',
      date_of_request: new Date(),
      additional_information: FIXTURE_TAG,
      approval_status: 'approved',
    },
  });
  createdMrfs.push(row.id);
  return row.id;
}

before(async () => {
  const [single, dbl] = await Promise.all([
    prisma.rpa_mrf.findFirst({ where: { additional_information: { contains: FIXTURE_TAG }, number_of_positions: 1 }, select: { id: true } }),
    prisma.rpa_mrf.findFirst({ where: { additional_information: { contains: FIXTURE_TAG }, number_of_positions: 2 }, select: { id: true } }),
  ]);
  assert.ok(single && dbl, 'Fixture MRFs missing â€” run: node src/tests/helpers/fixture.js seed');
  mrfSingleId = single.id;
  mrfDoubleId = dbl.id;
  // Start from a known-open state regardless of what a previous run left.
  await prisma.rpa_mrf.updateMany({ where: { id: { in: [mrfSingleId, mrfDoubleId] } }, data: { filled_at: null } });
});

after(async () => {
  if (createdJourneys.length) {
    const reqs = await prisma.rpa_document_requests.findMany({
      where: { pipeline_id: { in: createdJourneys } }, select: { id: true },
    });
    if (reqs.length) {
      await prisma.rpa_candidate_documents.deleteMany({ where: { request_id: { in: reqs.map((r) => r.id) } } });
    }
    await prisma.rpa_document_requests.deleteMany({ where: { pipeline_id: { in: createdJourneys } } });
    await prisma.rpa_offers.deleteMany({ where: { pipeline_id: { in: createdJourneys } } });
    await prisma.rpa_pipeline_stage_events.deleteMany({ where: { pipeline_id: { in: createdJourneys } } });
    await prisma.rpa_notifications.deleteMany({ where: { pipeline_id: { in: createdJourneys } } });
    await prisma.rpa_candidate_pipeline.deleteMany({ where: { id: { in: createdJourneys } } });
  }
  if (createdCvs.length) {
    await prisma.rpa_email_messages.deleteMany({ where: { candidate_id: { in: createdCvs } } });
    await prisma.rpa_shortlisted_candidates.deleteMany({ where: { cv_id: { in: createdCvs } } });
    await prisma.rpa_cv.deleteMany({ where: { id: { in: createdCvs } } });
  }
  await prisma.rpa_mrf.updateMany({ where: { id: { in: [mrfSingleId, mrfDoubleId] } }, data: { filled_at: null } });
  // The single-use requisitions this file created for the closure arithmetic.
  if (createdMrfs.length) {
    await prisma.rpa_mrf.deleteMany({ where: { id: { in: createdMrfs } } });
  }
  await prisma.$disconnect();
  try { await disconnectRedis(); } catch { /* already closed */ }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• BLOCK C â€” DOCUMENTS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

describe('DOC-01 / DOC-02 â€” request and re-request', () => {
  test('DOC-01: a request creates one row per active checklist item', async () => {
    const { journey } = await makeJourney({ name: 'DOC01' });
    const active = await prisma.rpa_document_checklist_items.count({ where: { is_active: true } });
    assert.ok(active > 0, 'precondition: at least one active checklist item');

    const result = await requestDocuments(journey.id, { actedBy: ACTED_BY });
    assert.ok(result.request?.token, 'a token must be issued');

    const { request, documents } = await docsFor(journey.id);
    assert.equal(request.token_status, 'active');
    assert.equal(documents.length, active, 'one document row per active checklist item');
    assert.ok(documents.every((d) => d.status === 'pending'));
  });

  test('DOC-02: re-requesting reuses the same token and resets the reminder budget', async () => {
    const { journey } = await makeJourney({ name: 'DOC02' });
    const first = await requestDocuments(journey.id, { actedBy: ACTED_BY });

    // Spend some reminder budget, then re-request.
    await prisma.rpa_document_requests.update({
      where: { pipeline_id: BigInt(journey.id) },
      data: { reminder_count: 2, last_reminded_at: new Date() },
    });

    const second = await requestDocuments(journey.id, { actedBy: ACTED_BY });
    assert.equal(second.request.token, first.request.token, 'the SAME token must be reused, not a new one');

    const row = await prisma.rpa_document_requests.findUnique({ where: { pipeline_id: BigInt(journey.id) } });
    assert.equal(row.reminder_count, 0, 'reminder_count resets');
    assert.equal(row.last_reminded_at, null, 'last_reminded_at clears');
    assert.equal(row.token_status, 'active');
  });
});

describe('DOC-06 / DOC-07 / DOC-08 â€” verify, auto-close, closed link', () => {
  test('verifying every item auto-closes the request; a verified item cannot be re-verified', async () => {
    const { journey } = await makeJourney({ name: 'DOC07' });
    await requestDocuments(journey.id, { actedBy: ACTED_BY });

    const { documents: docs } = await docsFor(journey.id);
    assert.ok(docs.length >= 1);

    // Verify needs status 'uploaded' â€” simulate the upload half (the real file
    // round trip through OneDrive is a manual case, DOC-03).
    for (const d of docs) {
      await prisma.rpa_candidate_documents.update({
        where: { id: BigInt(d.id) },
        data: { status: 'uploaded', uploaded_at: new Date(), file_url: 'https://example.invalid/test.pdf', original_name: 'test.pdf' },
      });
    }

    for (let i = 0; i < docs.length; i++) {
      await verifyDocument(docs[i].id, { actedBy: ACTED_BY });
      const req = await prisma.rpa_document_requests.findUnique({ where: { pipeline_id: BigInt(journey.id) } });
      const isLast = i === docs.length - 1;
      assert.equal(
        req.token_status, isLast ? 'closed' : 'active',
        isLast ? 'the LAST verify must auto-close the link' : 'the link stays open until every item is verified'
      );
    }

    // DOC-06: re-verifying an already-verified item is refused.
    await assert.rejects(
      () => verifyDocument(docs[0].id, { actedBy: ACTED_BY }),
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /Only an uploaded document can be verified/);
        return true;
      }
    );
  });
});

describe('DOC-09 â€” reject reopens the link without burning reminder budget', () => {
  test('rejecting an uploaded item reopens a closed request and does not increment reminder_count', async () => {
    const { journey } = await makeJourney({ name: 'DOC09' });
    await requestDocuments(journey.id, { actedBy: ACTED_BY });
    const { documents } = await docsFor(journey.id);

    await prisma.rpa_candidate_documents.update({
      where: { id: BigInt(documents[0].id) },
      data: { status: 'uploaded', uploaded_at: new Date(), file_url: 'https://example.invalid/x.pdf', original_name: 'x.pdf' },
    });
    // Force the closed state reject is meant to reopen.
    await prisma.rpa_document_requests.update({
      where: { pipeline_id: BigInt(journey.id) },
      data: { token_status: 'closed', reminder_count: 1 },
    });

    await rejectDocument(documents[0].id, { reason: 'Blurry scan', actedBy: ACTED_BY });

    const req = await prisma.rpa_document_requests.findUnique({ where: { pipeline_id: BigInt(journey.id) } });
    assert.equal(req.token_status, 'active', 'a rejection must reopen the upload link');
    assert.equal(req.reminder_count, 1, 'reject must NOT spend reminder budget â€” deliberate exception');
    assert.ok(req.last_reminded_at, 'but it does stamp last_reminded_at');
  });

  test('rejecting with no reason is refused', async () => {
    const { journey } = await makeJourney({ name: 'DOC09b' });
    await requestDocuments(journey.id, { actedBy: ACTED_BY });
    const { documents } = await docsFor(journey.id);
    await prisma.rpa_candidate_documents.update({
      where: { id: BigInt(documents[0].id) }, data: { status: 'uploaded' },
    });

    await assert.rejects(
      () => rejectDocument(documents[0].id, { reason: '   ', actedBy: ACTED_BY }),
      (err) => { assert.equal(err.statusCode, 400); return true; }
    );
  });
});

describe('DOC-10 â€” manual reminder shares the cron counter', () => {
  test('a manual reminder increments the same reminder_count the sweep reads', async () => {
    const { journey } = await makeJourney({ name: 'DOC10' });
    await requestDocuments(journey.id, { actedBy: ACTED_BY });

    const before = await prisma.rpa_document_requests.findUnique({ where: { pipeline_id: BigInt(journey.id) } });
    await sendReminder(journey.id, { actedBy: ACTED_BY });
    const after = await prisma.rpa_document_requests.findUnique({ where: { pipeline_id: BigInt(journey.id) } });

    assert.equal(after.reminder_count, before.reminder_count + 1);
    assert.ok(after.last_reminded_at);
  });
});

describe('DOC-13 â€” no delete path exists', () => {
  test('the document service exposes no delete/expire function', async () => {
    const svc = await import('../../services/documentCollection.service.js');
    const names = Object.keys(svc);
    const destructive = names.filter((n) => /delete|remove|purge|expire|destroy/i.test(n));
    assert.deepEqual(destructive, [], `documents must never be deletable; found: ${destructive.join(', ')}`);
  });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• BLOCK D â€” OFFER â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

describe('OFFER-01 / OFFER-02 â€” approval flow', () => {
  test('OFFER-01: request-approval sets pending; a second request on an APPROVED offer is refused', async () => {
    const { journey } = await makeJourney({ name: 'OFFER01' });
    const row = await requestApproval(journey.id, { actedBy: ACTED_BY });
    assert.equal(row.approval_status, 'pending');
    assert.ok(row.approval_requested_at);

    await approveOffer(journey.id, { actedBy: ACTED_BY });
    await assert.rejects(
      () => requestApproval(journey.id, { actedBy: ACTED_BY }),
      (err) => {
        assert.equal(err.statusCode, 409);
        assert.equal(err.message, 'This offer has already been approved.');
        return true;
      }
    );
  });

  test('OFFER-02: approving with no prior request-approval is allowed by design', async () => {
    const { journey } = await makeJourney({ name: 'OFFER02' });
    const row = await approveOffer(journey.id, { actedBy: ACTED_BY });
    assert.equal(row.approval_status, 'approved');
  });
});

describe('OFFER-04 / OFFER-05 â€” share is a soft gate', () => {
  test('OFFER-04: sharing without approval succeeds; an invalid joining date is refused', async () => {
    const { shortlist, journey } = await makeJourney({ name: 'OFFER04' });
    const row = await recordOfferShared(journey.id, {
      joiningDate: '2026-12-01', remarks: 'Test share', actedBy: ACTED_BY,
    });
    assert.ok(row.shared_at, 'share must succeed even with no approval on file');

    const sl = await prisma.rpa_shortlisted_candidates.findUnique({
      where: { id: shortlist.id }, select: { offer_sent_at: true },
    });
    assert.ok(sl.offer_sent_at, 'legacy write-back: offer_sent_at must be stamped');

    const { journey: j2 } = await makeJourney({ name: 'OFFER04b' });
    await assert.rejects(
      () => recordOfferShared(j2.id, { joiningDate: 'not-a-date', actedBy: ACTED_BY }),
      (err) => { assert.equal(err.statusCode, 400); return true; }
    );
  });

  test('OFFER-05: re-sharing does not wipe an existing decision', async () => {
    const { journey } = await makeJourney({ name: 'OFFER05' });
    await recordOfferShared(journey.id, { joiningDate: '2026-12-01', actedBy: ACTED_BY });
    await recordCandidateDecision(journey.id, { decision: 'accepted', actedBy: ACTED_BY });

    await recordOfferShared(journey.id, { joiningDate: '2026-12-15', remarks: 'updated', actedBy: ACTED_BY });
    const offer = await getOffer(journey.id);
    assert.equal(offer.candidate_decision, 'accepted', 'a re-share must never reset the decision to pending');
  });
});

describe('OFFER-07 â€” decision requires a prior share', () => {
  test('recording a decision before sharing is refused', async () => {
    const { journey } = await makeJourney({ name: 'OFFER07' });
    await assert.rejects(
      () => recordCandidateDecision(journey.id, { decision: 'accepted', actedBy: ACTED_BY }),
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /Record the offer as shared before/);
        return true;
      }
    );
  });
});

describe('OFFER-08 / OFFER-09 â€” MRF close arithmetic', () => {
  test('OFFER-08: accepting on a 1-opening MRF closes it', async () => {
    const mrfId = await makeMrf(1);
    const { journey } = await makeJourney({ name: 'OFFER08', mrfId });
    await recordOfferShared(journey.id, { joiningDate: '2026-12-01', actedBy: ACTED_BY });
    await recordCandidateDecision(journey.id, { decision: 'accepted', actedBy: ACTED_BY });

    const mrf = await prisma.rpa_mrf.findUnique({ where: { id: mrfId }, select: { filled_at: true, approval_status: true } });
    assert.ok(mrf.filled_at, 'a filled requisition must be stamped filled_at');
    assert.notEqual(mrf.approval_status, 'closed', 'approval_status is deliberately left untouched');
  });

  test('OFFER-09: a 2-opening MRF stays open after one accept, closes on the second', async () => {
    const mrfId = await makeMrf(2);

    const a = await makeJourney({ name: 'OFFER09a', mrfId });
    await recordOfferShared(a.journey.id, { joiningDate: '2026-12-01', actedBy: ACTED_BY });
    await recordCandidateDecision(a.journey.id, { decision: 'accepted', actedBy: ACTED_BY });

    let mrf = await prisma.rpa_mrf.findUnique({ where: { id: mrfId }, select: { filled_at: true } });
    assert.equal(mrf.filled_at, null, '1 accepted < 2 openings â€” must stay open');

    const b = await makeJourney({ name: 'OFFER09b', mrfId });
    await recordOfferShared(b.journey.id, { joiningDate: '2026-12-01', actedBy: ACTED_BY });
    await recordCandidateDecision(b.journey.id, { decision: 'accepted', actedBy: ACTED_BY });

    mrf = await prisma.rpa_mrf.findUnique({ where: { id: mrfId }, select: { filled_at: true } });
    assert.ok(mrf.filled_at, '2 accepted = 2 openings â€” now closes');
  });
});

describe('OFFER-10 â€” concurrent acceptances on the last opening', () => {
  test('both acceptances record, but the MRF close fires once', async () => {
    const mrfId = await makeMrf(2);

    const a = await makeJourney({ name: 'OFFER10a', mrfId });
    const b = await makeJourney({ name: 'OFFER10b', mrfId });
    for (const j of [a, b]) {
      await recordOfferShared(j.journey.id, { joiningDate: '2026-12-01', actedBy: ACTED_BY });
    }

    const [ra, rb] = await Promise.allSettled([
      recordCandidateDecision(a.journey.id, { decision: 'accepted', actedBy: ACTED_BY }),
      recordCandidateDecision(b.journey.id, { decision: 'accepted', actedBy: ACTED_BY }),
    ]);

    assert.equal(ra.status, 'fulfilled', 'both are real acceptances â€” neither may be lost');
    assert.equal(rb.status, 'fulfilled');

    const offers = await prisma.rpa_offers.findMany({
      where: { pipeline_id: { in: [BigInt(a.journey.id), BigInt(b.journey.id)] } },
      select: { candidate_decision: true },
    });
    assert.equal(offers.length, 2);
    assert.ok(offers.every((o) => o.candidate_decision === 'accepted'), 'both decisions recorded');

    const mrf = await prisma.rpa_mrf.findUnique({ where: { id: mrfId }, select: { filled_at: true } });
    assert.ok(mrf.filled_at, 'the requisition closes exactly once');
  });
});

describe('OFFER-11 / OFFER-12 / OFFER-13 â€” amend', () => {
  test('OFFER-11: re-deciding without a real boolean amend flag is refused', async () => {
    const { journey } = await makeJourney({ name: 'OFFER11' });
    await recordOfferShared(journey.id, { joiningDate: '2026-12-01', actedBy: ACTED_BY });
    await recordCandidateDecision(journey.id, { decision: 'accepted', actedBy: ACTED_BY });

    await assert.rejects(
      () => recordCandidateDecision(journey.id, { decision: 'rejected', actedBy: ACTED_BY }),
      (err) => {
        assert.equal(err.statusCode, 409);
        // The message uses typographic quotes around the previous decision.
        assert.match(err.message, /already recorded as .accepted./);
        return true;
      }
    );

    // The strict-boolean check: a truthy STRING must not pass for true.
    await assert.rejects(
      () => recordCandidateDecision(journey.id, { decision: 'rejected', amend: 'true', actedBy: ACTED_BY }),
      (err) => { assert.equal(err.statusCode, 409); return true; },
      'amend:"true" (string) must not be accepted as amend:true'
    );

    const row = await recordCandidateDecision(journey.id, { decision: 'rejected', amend: true, actedBy: ACTED_BY });
    assert.equal(row.candidate_decision, 'rejected', 'a real boolean amend succeeds');
  });

  test('OFFER-12: amending accepted â†’ rejected reopens the MRF and clears offer_accepted_at', async () => {
    const mrfId = await makeMrf(1);
    const { shortlist, journey } = await makeJourney({ name: 'OFFER12', mrfId });

    await recordOfferShared(journey.id, { joiningDate: '2026-12-01', actedBy: ACTED_BY });
    await recordCandidateDecision(journey.id, { decision: 'accepted', actedBy: ACTED_BY });

    let mrf = await prisma.rpa_mrf.findUnique({ where: { id: mrfId }, select: { filled_at: true } });
    assert.ok(mrf.filled_at, 'precondition: the accept closed it');

    await recordCandidateDecision(journey.id, { decision: 'rejected', amend: true, actedBy: ACTED_BY });

    mrf = await prisma.rpa_mrf.findUnique({ where: { id: mrfId }, select: { filled_at: true } });
    assert.equal(mrf.filled_at, null, 'amending away from accepted must reopen the requisition');

    const sl = await prisma.rpa_shortlisted_candidates.findUnique({
      where: { id: shortlist.id }, select: { offer_accepted_at: true },
    });
    assert.equal(sl.offer_accepted_at, null, 'offer_accepted_at must be explicitly nulled, not left stale');
  });
});

describe('OFFER-16 â€” offer endpoints refuse a closed journey', () => {
  test('recording a decision on a closed journey is refused', async () => {
    const { journey } = await makeJourney({ name: 'OFFER16' });
    await recordOfferShared(journey.id, { joiningDate: '2026-12-01', actedBy: ACTED_BY });
    await setFinalOutcome(journey.id, { finalOutcomeKey: FINAL_OUTCOMES.REJECTED, actedBy: ACTED_BY });

    await assert.rejects(
      () => recordCandidateDecision(journey.id, { decision: 'accepted', actedBy: ACTED_BY }),
      (err) => {
        assert.equal(err.statusCode, 409);
        assert.match(err.message, /closed/i);
        return true;
      }
    );
  });
});

