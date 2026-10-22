/**
 * JD search — strict gates and ranking (Phase 3 "Do Now", N07–N10). Run one
 * file at a time:
 *
 *   node src/tests/run-block.mjs src/tests/integration/jdGates.test.js
 *
 * Seeds three MRFs and tagged candidates, calls searchRoleCandidatesV2 directly
 * with force=true (the SCREENING_V2 flag only routes HTTP traffic), and tears
 * everything down by EXPLICIT ID.
 *
 * The mandatory skills include a nonsense sentinel the fixtures share, so on a
 * database with ~99k real candidates only fixtures can pass the skill gate;
 * assertions compare the FIXTURE subset of the results. Each candidate isolates
 * one rule RT reported broken: a profile without a mandatory skill rated
 * "strong", freshers passing an experience maximum, over-budget candidates
 * passing because the budget was looked up by role name.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import prisma from '../../config/database.js';
import { disconnectRedis } from '../../config/redis.js';
import { searchRoleCandidatesV2 } from '../../services/screeningV2.service.js';
import { educationGateSql, jdEducationPass } from '../../utils/jdScreeningRules.js';

const TAG = 'SCREENING-V2-JD-FIXTURE';
const SENTINEL = 'Zqxjdsentinel';

/** Everyone is a B.Tech in band with a budget-friendly CTC unless the case says otherwise. */
const base = {
  graduationdegree: 'B.Tech', TotalExperienceYearsNumeric: 4.5, ExpectedCTCNumeric: 12, NoticePeriodDays: 15,
  CurrentLocation: 'Noida', Gender: 'Male',
};

/** Letter → [what it isolates, row]. */
const FIXTURES = {
  P: ['passes; both skills declared', { Top5KeySkills: `${SENTINEL}, Kafka, Java`, resume_full_text: `${SENTINEL} and Kafka pipelines.` }],
  Q: ['passes; Kafka only in the resume text', { Top5KeySkills: `${SENTINEL}, Java`, resume_full_text: `Built Kafka consumers with ${SENTINEL}.` }],
  M: ['missing a mandatory skill (Kafka)', { Top5KeySkills: `${SENTINEL}, Java`, resume_full_text: `${SENTINEL} with RabbitMQ.` }],
  K: ['"Kafkaesque" is not Kafka', { Top5KeySkills: `${SENTINEL}`, resume_full_text: `A Kafkaesque ${SENTINEL} migration.` }],
  F: ['fresher outside the 3–6 band', { Top5KeySkills: `${SENTINEL}, Kafka`, TotalExperienceYearsNumeric: 0 }],
  S: ['senior outside the 3–6 band', { Top5KeySkills: `${SENTINEL}, Kafka`, TotalExperienceYearsNumeric: 9 }],
  O: ['over the 15 LPA budget', { Top5KeySkills: `${SENTINEL}, Kafka`, ExpectedCTCNumeric: 20 }],
  E: ['experience not recorded', { Top5KeySkills: `${SENTINEL}, Kafka`, TotalExperienceYearsNumeric: null }],
  C: ['expected CTC not recorded', { Top5KeySkills: `${SENTINEL}, Kafka`, ExpectedCTCNumeric: null }],
  D: ['B.Com, not BE/BTech/MCA', { Top5KeySkills: `${SENTINEL}, Kafka`, graduationdegree: 'B.Com' }],
  N: ['no degree recorded', { Top5KeySkills: `${SENTINEL}, Kafka`, graduationdegree: null }],
};

const cvId = {};
const letterOf = new Map();
const mrfId = {};
let jdSendId = null;

const letters = (result) =>
  result.candidates.map((c) => letterOf.get(String(c.id))).filter(Boolean).join('');
const sorted = (s) => [...s].sort().join('');

before(async () => {
  const now = new Date();
  for (const [letter, [, data]] of Object.entries(FIXTURES)) {
    const row = await prisma.rpa_cv.create({
      data: {
        ...base,
        ...data,
        Name: `Zqxjd ${letter}`,
        EmailID: `zqx.jd.${letter.toLowerCase()}@example.invalid`,
        MetaData: TAG,
        statusActive: 'Active',
        createdAt: now,
        modifiedAt: now,
      },
      select: { id: true },
    });
    cvId[letter] = row.id;
    letterOf.set(String(row.id), letter);
  }

  const mrf = (over) => prisma.rpa_mrf.create({
    data: {
      submitter_email: 'zqx.jd.manager@example.invalid',
      approval_status: 'approved',
      number_of_positions: 1,
      total_years_of_experience: 3,
      ...over,
    },
    select: { id: true },
  });

  // Main MRF: lead-ins and a soft skill in the text, band 3–6 from the JD,
  // budget on the linked request.
  mrfId.main = (await mrf({
    position_hiring_for: 'Zqxjd Kafka Engineer',
    mandatory_skills: `Strong knowledge of ${SENTINEL}, Kafka, Good communication skills`,
    parsed_jd_json: { min_experience_years: 3, max_experience_years: 6 },
    desired_qualification: 'BE/BTech, MCA, Any',
  })).id;
  jdSendId = (await prisma.rpa_mrf_jd_send.create({
    data: {
      first_name: 'Zqx', last_name: 'Jd', email: 'zqx.jd.manager@example.invalid',
      role: 'Zqxjd Kafka Engineer', jd_doc_link: 'https://example.invalid/jd',
      budget_min: 8, budget_max: 15, mrf_id: Number(mrfId.main),
    },
    select: { id: true },
  })).id;

  // No budget anywhere, "Other" qualification: CTC and education not gated.
  mrfId.noBudget = (await mrf({
    position_hiring_for: 'Zqxjd No Budget Role',
    mandatory_skills: `${SENTINEL}, Kafka`,
    parsed_jd_json: { min_experience_years: 3, max_experience_years: 6 },
    desired_qualification: 'Other',
  })).id;

  // Nothing checkable in the mandatory skills.
  mrfId.noSkills = (await mrf({
    position_hiring_for: 'Zqxjd No Skills Role',
    mandatory_skills: 'Same as JD',
    parsed_jd_json: { mandatory_skills: 'Good communication skills, 3+ years of experience' },
  })).id;
});

after(async () => {
  const ids = Object.values(cvId);
  if (ids.length) await prisma.rpa_cv.deleteMany({ where: { id: { in: ids } } });
  if (jdSendId) await prisma.rpa_mrf_jd_send.deleteMany({ where: { id: jdSendId } });
  const mrfs = Object.values(mrfId);
  if (mrfs.length) await prisma.rpa_mrf.deleteMany({ where: { id: { in: mrfs } } });
  await prisma.$disconnect();
  try {
    await disconnectRedis?.();
  } catch {
    // Best effort: a missing Redis must not turn a clean run red.
  }
});

describe('N07 — ALL mandatory skills first', () => {
  test('only candidates with every mandatory skill pass; "Kafkaesque" is not Kafka', async () => {
    const r = await searchRoleCandidatesV2(Number(mrfId.main), true);
    assert.equal(sorted(letters(r)), 'PQ');
    for (const c of r.candidates.filter((x) => letterOf.has(String(x.id)))) {
      assert.ok(c.jdSkillSignals.mandatory.every((s) => s.status !== 'missing'), `cv ${c.id} shows a missing mandatory skill`);
    }
  });

  test('the parsed list drops the lead-in and the soft skill', async () => {
    const r = await searchRoleCandidatesV2(Number(mrfId.main), true);
    assert.deepEqual(r.summary.mandatorySkills.map((s) => s.term), [SENTINEL.toLowerCase(), 'kafka']);
    assert.deepEqual(r.summary.ignoredSkills.map((s) => s.reason), ['soft skill']);
  });

  test('"missing only this skill": M and K meet everything else but lack Kafka', async () => {
    const r = await searchRoleCandidatesV2(Number(mrfId.main), true);
    // Only fixtures carry the sentinel, so nobody else can be missing ONLY Kafka.
    assert.equal(r.summary.mandatorySkills[1].missingOnlyThis, 2);
    assert.equal(r.summary.passedSkillGate, 2);
    assert.match(r.summary.summaryDetail, /of those, 2 have all 2 mandatory skills/);
  });

  test('an MRF with no checkable mandatory skill is blocked with a message', async () => {
    const r = await searchRoleCandidatesV2(Number(mrfId.noSkills), true);
    assert.equal(r.candidates.length, 0);
    assert.equal(r.summary.noMandatorySkills, true);
    assert.match(r.summary.summaryText, /no mandatory skills/);
  });
});

describe('N08 — education, budget, experience band; empty values excluded', () => {
  test('fresher, senior, over-budget, blank experience / CTC, wrong or missing degree are all excluded', async () => {
    const r = await searchRoleCandidatesV2(Number(mrfId.main), true);
    const got = new Set(letters(r));
    for (const l of 'FSOECDN') assert.ok(!got.has(l), `${l} (${FIXTURES[l][0]}) should be excluded`);
  });

  test('budget comes from the request linked by mrf_id', async () => {
    const r = await searchRoleCandidatesV2(Number(mrfId.main), true);
    assert.equal(r.summary.budgetApplied, true);
    assert.equal(r.summary.budgetSource, 'mrf_id');
    assert.equal(r.role.budget_max, 15);
  });

  test('no budget and "Other" qualification: CTC and education are not gated, and the summary says so', async () => {
    const r = await searchRoleCandidatesV2(Number(mrfId.noBudget), true);
    assert.equal(sorted(letters(r)), 'CDNOPQ');
    assert.equal(r.summary.budgetApplied, false);
    assert.equal(r.summary.educationApplied, false);
    assert.match(r.summary.summaryDetail, /meet experience · .*no budget on this MRF, CTC not checked · no education requirement/);
  });

  test('removed-by counts add up to the total', async () => {
    const r = await searchRoleCandidatesV2(Number(mrfId.main), true);
    const removed = Object.values(r.summary.removedBy).reduce((a, b) => a + b, 0);
    assert.equal(removed + r.summary.shown, r.summary.total);
  });

  test('the education SQL and its JS mirror agree on every fixture', async () => {
    const ids = Object.values(cvId);
    for (const req of ['TECH_GRADUATE', 'POST_GRADUATE', 'GRADUATE']) {
      const rows = await prisma.$queryRaw`
        SELECT c.id, c.graduationdegree, c.postgraduationdegree, ${educationGateSql(req, 'c')} AS pass
        FROM public.rpa_cv c WHERE c.id = ANY(${ids}::bigint[])`;
      for (const row of rows) {
        assert.equal(row.pass, jdEducationPass(row, req), `${req} disagrees for ${row.graduationdegree}/${row.postgraduationdegree}`);
      }
    }
  });
});

describe('N09 — ranking orders passers, never removes them', () => {
  test('a declared skill ranks above a resume-only mention', async () => {
    const r = await searchRoleCandidatesV2(Number(mrfId.main), true);
    assert.equal(letters(r), 'PQ');
    const [p, q] = r.candidates.filter((c) => letterOf.has(String(c.id)));
    assert.ok(p.starRating.finalScore > q.starRating.finalScore);
    assert.equal(p.starRating.mode, 'JD Strict');
    assert.deepEqual(Object.keys(p.starRating.breakdown), ['jdMatching', 'totalExperience', 'ctcAlignment', 'availability']);
  });

  test('no AI configured or reachable: results intact, aiUnavailable set, timings logged', async () => {
    const r = await searchRoleCandidatesV2(Number(mrfId.main), true);
    assert.equal(typeof r.summary.aiUnavailable, 'boolean');
    for (const k of ['t_embed', 't_sql', 't_ai', 't_total']) assert.equal(typeof r.summary.timings[k], 'number');
  });
});

describe('MRF lookup', () => {
  test('an unknown MRF is a 404', async () => {
    await assert.rejects(searchRoleCandidatesV2(999999999, true), (err) => err.statusCode === 404);
  });
});

describe('N38 — "Added within" on JD search', () => {
  test('a 15-day window keeps the recent passer and drops the one added 20 days ago', async () => {
    const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
    await prisma.rpa_cv.update({ where: { id: cvId.Q }, data: { createdAt: twentyDaysAgo } });
    try {
      const all = await searchRoleCandidatesV2(Number(mrfId.main), true);
      assert.equal(sorted(letters(all)), 'PQ', 'no window: both passers');

      const recent = await searchRoleCandidatesV2(Number(mrfId.main), true, { addedWithinDays: 15 });
      assert.equal(sorted(letters(recent)), 'P');
      assert.equal(recent.summary.addedWithinDays, 15);
      assert.match(recent.summary.summaryText, /added in the last 15 days/);

      const wide = await searchRoleCandidatesV2(Number(mrfId.main), true, { addedWithinDays: 30 });
      assert.equal(sorted(letters(wide)), 'PQ', '30 days reaches back past Q');
    } finally {
      await prisma.rpa_cv.update({ where: { id: cvId.Q }, data: { createdAt: new Date() } });
    }
  });
});

describe('N15 — "Tagged to this JD only"', () => {
  test('only candidates tagged to the JD are searched, and each card carries its tag', async () => {
    // P is tagged (an HR upload for this JD); Q passes every gate but is not.
    await prisma.rpa_candidate_mrf_tags.create({
      data: { cv_id: cvId.P, mrf_id: mrfId.main, source: 'hr_manual_upload', tagged_by: 'jd-gates-test' },
    });
    try {
      const all = await searchRoleCandidatesV2(Number(mrfId.main), true);
      assert.equal(sorted(letters(all)), 'PQ', 'the switch off changes nothing');
      const byLetter = Object.fromEntries(all.candidates.filter((c) => letterOf.has(String(c.id))).map((c) => [letterOf.get(String(c.id)), c]));
      assert.equal(byLetter.P.jd_tag?.source, 'hr_manual_upload');
      assert.equal(byLetter.Q.jd_tag, null);

      const tagged = await searchRoleCandidatesV2(Number(mrfId.main), true, { taggedOnly: true });
      assert.equal(letters(tagged), 'P');
      assert.equal(tagged.summary.taggedOnly, true);
      assert.match(tagged.summary.summaryText, /1 tagged to this JD/);
    } finally {
      await prisma.rpa_candidate_mrf_tags.deleteMany({ where: { cv_id: cvId.P, mrf_id: mrfId.main } });
    }
  });
});
