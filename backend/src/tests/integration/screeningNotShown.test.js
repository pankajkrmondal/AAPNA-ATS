/**
 * L11 — "See the N not shown": who the JD and keyword searches left out, and
 * why (staging DB, read-only apart from the fixtures).
 *
 *   node src/tests/run-block.mjs src/tests/integration/screeningNotShown.test.js
 *
 *   - a fixture failing exactly one rule is listed with that rule, in words
 *   - one failing two rules is listed after the single misses
 *   - the per-reason counts and the reason filter
 *   - the search itself is unchanged by the shared-gates refactor (the passing
 *     fixture is still the only match)
 *   - the keyword tab names the location and the missing skill
 *
 * The JD cases use "Tagged to this JD only", so only the fixtures are in scope.
 * Fixtures are tagged and torn down by explicit id.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import prisma from '../../config/database.js';
import { disconnectRedis } from '../../config/redis.js';
import { notShownForKeyword, notShownForRole, searchRoleCandidatesV2 } from '../../services/screeningV2.service.js';
import { tagCandidates } from '../../services/candidateTag.service.js';

const TAG = 'L11-NOT-SHOWN-FIXTURE';
const SENTINEL = 'Zqxnotshown';
const base = {
  graduationdegree: 'B.Tech', TotalExperienceYearsNumeric: 4.5, ExpectedCTCNumeric: 12, NoticePeriodDays: 15,
  CurrentLocation: 'Noida', Gender: 'Female', Top5KeySkills: `${SENTINEL}, Kafka`,
};
const FIXTURES = {
  P: { },
  F: { TotalExperienceYearsNumeric: 1 },
  O: { ExpectedCTCNumeric: 20 },
  M: { Top5KeySkills: `${SENTINEL}`, resume_full_text: `${SENTINEL} with RabbitMQ.` },
  D: { graduationdegree: 'B.Com' },
  X: { TotalExperienceYearsNumeric: 9, ExpectedCTCNumeric: 22 },
};
const cvId = {};
const letterOf = new Map();
let mrfId;
let jdSendId;

const lettersOf = (r) => r.candidates.map((c) => letterOf.get(String(c.id))).filter(Boolean);

before(async () => {
  for (const [letter, data] of Object.entries(FIXTURES)) {
    const row = await prisma.rpa_cv.create({
      data: {
        ...base, ...data, Name: `Zqxns ${letter}`, EmailID: `zqx.ns.${letter.toLowerCase()}@example.invalid`,
        MetaData: TAG, statusActive: 'Active', createdAt: new Date(), modifiedAt: new Date(),
      },
      select: { id: true },
    });
    cvId[letter] = row.id;
    letterOf.set(String(row.id), letter);
  }
  mrfId = (await prisma.rpa_mrf.create({
    data: {
      submitter_email: 'zqx.ns.manager@example.invalid', approval_status: 'approved', number_of_positions: 1,
      total_years_of_experience: 3, position_hiring_for: 'Zqxns Kafka Engineer',
      mandatory_skills: `${SENTINEL}, Kafka`, parsed_jd_json: { min_experience_years: 3, max_experience_years: 6 },
      desired_qualification: 'BE/BTech, MCA', additional_information: TAG,
    },
    select: { id: true },
  })).id;
  jdSendId = (await prisma.rpa_mrf_jd_send.create({
    data: {
      first_name: 'Zqx', last_name: 'Ns', email: 'zqx.ns.manager@example.invalid', role: 'Zqxns Kafka Engineer',
      jd_doc_link: 'https://example.invalid/jd', budget_min: 8, budget_max: 15, mrf_id: Number(mrfId),
    },
    select: { id: true },
  })).id;
  await tagCandidates({ cvIds: Object.values(cvId), mrfId, source: 'hr_manual_upload', actor: { username: 'l11-test' } });
});

after(async () => {
  const ids = Object.values(cvId);
  await prisma.rpa_candidate_mrf_tags.deleteMany({ where: { cv_id: { in: ids } } });
  await prisma.rpa_cv.deleteMany({ where: { id: { in: ids } } });
  if (jdSendId) await prisma.rpa_mrf_jd_send.deleteMany({ where: { id: jdSendId } });
  if (mrfId) await prisma.rpa_mrf.deleteMany({ where: { id: mrfId } });
  await prisma.$disconnect();
  await disconnectRedis().catch(() => {});
});

describe('L11 — who the JD search left out, and why', () => {
  test('the search itself is unchanged: P is still the only match', async () => {
    const r = await searchRoleCandidatesV2(Number(mrfId), true, { taggedOnly: true });
    assert.deepEqual(r.candidates.map((c) => letterOf.get(String(c.id))).filter(Boolean), ['P']);
  });

  test('every miss is listed once, with its rule in words; single misses before double', async () => {
    const r = await notShownForRole(Number(mrfId), { taggedOnly: true });
    const letters = lettersOf(r);
    assert.deepEqual([...letters].sort(), ['D', 'F', 'M', 'O', 'X']);
    assert.equal(letters[letters.length - 1], 'X', 'the double miss comes last');
    const by = Object.fromEntries(r.candidates.map((c) => [letterOf.get(String(c.id)), c]));
    assert.deepEqual(by.F.reasonKeys, ['experience']);
    assert.match(by.F.reasons[0], /^Experience 1 yr, needs 3–6 yrs$/);
    assert.deepEqual(by.O.reasonKeys, ['ctc']);
    assert.match(by.O.reasons[0], /^Expected CTC 20 LPA, budget 15$/);
    assert.deepEqual(by.D.reasonKeys, ['education']);
    assert.match(by.D.reasons[0], /^Education: B\.Com, needs /);
    assert.deepEqual(by.M.reasonKeys, ['skills']);
    assert.match(by.M.reasons[0], /^Missing mandatory skill: Kafka$/i);
    assert.deepEqual(by.X.reasonKeys, ['ctc', 'experience']);
  });

  test('per-reason counts, and the reason filter lists one rule only', async () => {
    const r = await notShownForRole(Number(mrfId), { taggedOnly: true });
    assert.equal(r.total, 5);
    assert.equal(r.byReason.experience, 2);
    assert.equal(r.byReason.ctc, 2);
    assert.equal(r.byReason.education, 1);
    assert.equal(r.byReason.skills, 1);
    const ctcOnly = await notShownForRole(Number(mrfId), { taggedOnly: true, reason: 'ctc' });
    assert.deepEqual(lettersOf(ctcOnly).sort(), ['O', 'X']);
    assert.equal(ctcOnly.capped, false);
  });
});

describe('L11 — who the keyword search left out, and why', () => {
  test('names the location and the missing skill', async () => {
    const r = await notShownForKeyword({ keyword: `${SENTINEL}, Kafka`, matchMode: 'all', location: 'noida', expMin: 3 });
    const by = Object.fromEntries(r.candidates.map((c) => [letterOf.get(String(c.id)), c]).filter(([k]) => k));
    assert.ok(by.M, 'the fixture missing Kafka is listed');
    assert.ok(by.M.reasons.some((x) => /^Missing skill: Kafka$/i.test(x)), by.M.reasons.join(' | '));
    assert.ok(by.F, 'the 1-year fixture is listed');
    assert.ok(by.F.reasons.some((x) => /^Experience 1 yr, needs at least 3 yrs$/.test(x)), by.F.reasons.join(' | '));
    assert.ok(!by.P, 'the passing fixture is not listed');
  });
});
