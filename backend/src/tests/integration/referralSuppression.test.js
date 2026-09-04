/**
 * The referral flag must never reach an interviewer.
 * Run: node --test src/tests/integration/referralSuppression.test.js
 *
 * Sanghamitra Roy, 2026-08-28 (23:33-26:08): the recruiter and the final
 * decision-maker may know a candidate was referred; "none of the interview
 * process should know that it is a, because then you can't be non-bias".
 *
 * WHY THIS IS AN INTEGRATION TEST AND NOT A UNIT TEST
 * ---------------------------------------------------
 * An interviewer is not a ROLE in this system — they are an email address plus a
 * uuid token. There is no subject to deny, so the rule cannot be expressed as a
 * permission and cannot be asserted against one. It is enforced surface by
 * surface, and the only way to know it holds is to mark a real candidate and ask
 * each surface for its real output.
 *
 * WHOLE PAYLOADS ARE STRINGIFIED, not named fields. The leak this guards against
 * is a re-introduced spread — `...row` in a serializer, or an `include` that
 * grows a branch — and checking named fields would sail straight past both. This
 * is the test that would have caught serializeCard() shipping the entire
 * shortlist + MRF graph to every interviewer, which it did until 2026-09-04.
 *
 * ⚠ SENDS NO EMAIL, deliberately. Scorecard rows are created directly rather than
 * through dispatchScorecards(), because scorecardInvite is in OPERATOR_ADDRESSED
 * (emailRecipients.js) and would put real mail in a real inbox on every run —
 * see the header of schedulingAndScorecard.test.js.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import prisma from '../../config/database.js';
import { disconnectRedis } from '../../config/redis.js';
import { createPipelineJourney } from '../../services/pipeline.service.js';
import { setReferral } from '../../services/referral.service.js';
import { getScorecardByToken } from '../../services/interviewScorecard.service.js';
import { previewScheduleEmails } from '../../services/interviewSchedule.service.js';
import { buildDossierModel } from '../../services/candidateDossier.service.js';
import { assertNoForbiddenFields, redactionSummary } from '../../utils/dossierRedaction.js';
import { FIXTURE_TAG, CANDIDATE_EMAIL } from '../helpers/fixture.js';

const ACTED_BY = 2;
const REFERRER = 'Anuj Kumar';

/**
 * The fixture candidate's name must contain NO referral-shaped word.
 *
 * A candidate's name legitimately appears in every payload this file checks —
 * the scorecard context, the invite subject, the dossier header. Name the
 * fixture "REFERRAL-SUPPRESSION" (as the first draft did) and all five
 * assertions fail on the fixture's own name while reporting a leak that is not
 * there. `assertFixtureNameIsNeutral` below turns that into one obvious failure
 * instead of five misleading ones.
 */
const CANDIDATE_NAME = `SUPPRESSION-FIXTURE ${Date.now()}`;

/**
 * \b-ANCHORED, and the anchoring is load-bearing: an unanchored /referr/i also
 * matches `PreferredShift` — "p-REFERR-ed" — which is a whitelisted dossier
 * profile field present in every pack. The first draft of this check was
 * unanchored and reported the dossier as leaking when it was not. Same reasoning
 * as dossierRedaction.js's /(^|_)referr/i and the leak scan's word list.
 */
const REFERRAL_WORD = /\b(referral|referrals|referred|referrer)\b/i;

let cvId = null;
let shortlistId = null;
let journeyId = null;
let scheduleId = null;
let actor = null;

/**
 * The pack's own promise about what it removed is not a leak — redactionSummary()
 * now says "Whether the candidate was referred by an employee, and by whom", so a
 * naive check hits the very sentence guaranteeing there is no referral in the
 * file. Imported rather than restated so it cannot drift from the wording.
 */
function stripOwnRedactionNotice(text) {
  let out = text;
  for (const line of redactionSummary({ includeContactDetails: false })) out = out.split(line).join(' ');
  return out;
}

/** Assert a whole payload names neither the concept nor the referrer. */
function assertClean(label, payload) {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const text = stripOwnRedactionNotice(raw);

  const word = REFERRAL_WORD.exec(text);
  assert.equal(
    word, null,
    `${label} mentions "${word?.[0]}" — the referral must not reach an interviewer.\n`
    + `…${text.slice(Math.max(0, (word?.index ?? 0) - 120), (word?.index ?? 0) + 120)}…`,
  );
  assert.equal(
    text.includes(REFERRER), false,
    `${label} names the referrer "${REFERRER}" — this is the disclosure that matters most.`,
  );
}

before(async () => {
  actor = await prisma.rpa_users.findFirst({
    where: { is_active: true },
    select: { id: true, username: true, email: true, first_name: true, last_name: true },
  });
  assert.ok(actor, 'no active user to act as');

  const mrf = await prisma.rpa_mrf.findFirst({
    where: { additional_information: { contains: FIXTURE_TAG }, number_of_positions: 1 },
    select: { id: true },
  });
  assert.ok(mrf, 'Fixture MRF missing — run: node src/tests/helpers/fixture.js seed');

  assert.equal(
    REFERRAL_WORD.test(CANDIDATE_NAME), false,
    `The fixture candidate is named "${CANDIDATE_NAME}", which itself contains a `
    + 'referral-shaped word. Its name appears in every payload checked below, so '
    + 'every assertion would fail on the name rather than on a real leak. Rename it.',
  );

  const cv = await prisma.rpa_cv.create({
    data: {
      Name: CANDIDATE_NAME,
      EmailID: CANDIDATE_EMAIL,
      PositionApplied: 'RPA Developer',
      statusActive: 'Active',
      MetaData: FIXTURE_TAG,
      createdAt: new Date(),
      modifiedAt: new Date(),
    },
  });
  cvId = cv.id;

  const shortlist = await prisma.rpa_shortlisted_candidates.create({
    data: {
      cv_id: cv.id,
      mrf_id: mrf.id,
      candidate_name: cv.Name,
      candidate_email: CANDIDATE_EMAIL,
      position_applied: 'RPA Developer',
      shortlisted_by: 'phase3-testpass',
      recruiter_notes: FIXTURE_TAG,
    },
  });
  shortlistId = shortlist.id;

  const journey = await createPipelineJourney({
    cvId: cv.id, mrfId: mrf.id, shortlistId: shortlist.id, source: 'screening_shortlist',
  });
  journeyId = BigInt(journey.id);

  // The whole point: this candidate IS a referral for the duration of the run.
  await setReferral(cv.id, { referredBy: REFERRER, note: 'suppression fixture' }, { user: actor });
});

after(async () => {
  if (journeyId) {
    const cards = await prisma.rpa_interview_scorecard.findMany({
      where: { pipeline_id: journeyId }, select: { id: true },
    });
    if (cards.length) {
      await prisma.rpa_interview_scorecard_skill.deleteMany({ where: { scorecard_id: { in: cards.map((c) => c.id) } } });
    }
    await prisma.rpa_interview_scorecard.deleteMany({ where: { pipeline_id: journeyId } });
    await prisma.rpa_interview_schedule.deleteMany({ where: { pipeline_id: journeyId } });
    await prisma.rpa_pipeline_stage_events.deleteMany({ where: { pipeline_id: journeyId } });
    await prisma.rpa_notifications.deleteMany({ where: { pipeline_id: journeyId } });
    await prisma.rpa_candidate_pipeline.deleteMany({ where: { id: journeyId } });
  }
  if (cvId) {
    await prisma.rpa_referral_audit.deleteMany({ where: { cv_id: cvId } });
    await prisma.rpa_email_messages.deleteMany({ where: { candidate_id: cvId } });
    await prisma.rpa_shortlisted_candidates.deleteMany({ where: { cv_id: cvId } });
    await prisma.rpa_cv.deleteMany({ where: { id: cvId } });
  }
  await prisma.$disconnect();
  try { await disconnectRedis(); } catch { /* already closed */ }
});

describe('the fixture really is a referral', () => {
  test('otherwise every assertion below passes vacuously', async () => {
    const row = await prisma.rpa_cv.findUnique({
      where: { id: cvId }, select: { is_referral: true, referred_by: true },
    });
    assert.equal(row.is_referral, true);
    assert.equal(row.referred_by, REFERRER);
  });
});

describe('the public scorecard link, for every recipient role', () => {
  // 'ceo' is included on purpose. An earlier draft of the plan carved out the
  // final-round card as the one place the flag WOULD show; the decision on
  // 2026-09-04 was that no unauthenticated surface shows it, which makes this
  // invariant absolute and removes the gate that could have been got wrong.
  for (const [stageKey, role, cardType] of [
    ['tech1', 'interviewer', 'technical'],
    ['hr_round', 'hr', 'hr'],
    ['ceo', 'ceo', 'technical'],
  ]) {
    test(`recipient_role="${role}" sees nothing about the referral`, async () => {
      if (!scheduleId) {
        const now = new Date();
        const schedule = await prisma.rpa_interview_schedule.create({
          data: {
            pipeline_id: journeyId, stage_key: 'tech1',
            interviewer_email: 'panel@example.invalid',
            scheduled_start_at: now, scheduled_end_at: new Date(now.getTime() + 3600000),
            occurrence_status: 'held', created_by: ACTED_BY,
          },
        });
        scheduleId = schedule.id;
      }

      const card = await prisma.rpa_interview_scorecard.create({
        data: {
          schedule_id: scheduleId, pipeline_id: journeyId, stage_key: stageKey,
          card_type: cardType, recipient_email: `${role}@example.invalid`,
          recipient_role: role,
          token_expires_at: new Date(Date.now() + 7 * 86400000),
          status: 'pending',
        },
        select: { token: true },
      });

      assertClean(`scorecard payload for recipient_role="${role}"`, await getScorecardByToken(card.token));
    });
  }
});

describe('the interviewer invite', () => {
  test('neither the panel email nor the candidate email mentions it', async () => {
    // The panel body is also what becomes the Teams calendar event body, which
    // is the one artefact that can never be redacted once sent.
    const emails = await previewScheduleEmails(journeyId, {
      stageKey: 'tech1',
      startAt: new Date(Date.now() + 86400000).toISOString(),
      durationMinutes: 60,
      interviewerName: 'Panel Member',
      interviewerEmail: 'panel@example.invalid',
    });

    assertClean('panel (interviewer) invite email', emails.panel);
    assertClean('candidate invite email', emails.candidate);
  });
});

describe('the candidate dossier', () => {
  test('the built model carries no referral, and the guard agrees', async () => {
    // The dossier is the artefact DESIGNED to reach someone with no ATS account,
    // so it is the surface this rule would otherwise have a hole in.
    const model = await buildDossierModel(journeyId, {});
    assertClean('dossier model', model);
    assert.doesNotThrow(() => assertNoForbiddenFields(model));
  });
});
