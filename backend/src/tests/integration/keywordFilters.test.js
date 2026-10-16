/**
 * Keyword search — strict filters, whole-word skills, exact lookup
 * (Phase 3 "Do Now", N02–N05). Run against staging, one file at a time:
 *
 *   node src/tests/run-block.mjs src/tests/integration/keywordFilters.test.js
 *
 * Seeds six tagged candidates, runs searchKeywordCandidatesV2 directly (the
 * SCREENING_V2 flag only routes HTTP traffic; the function is called here
 * whatever the flag says), and tears them down by EXPLICIT ID.
 *
 * Staging holds ~99k real candidates, so every search is scoped with a
 * nonsense sentinel skill the fixtures share, and assertions compare the
 * FIXTURE subset of the results. Each candidate isolates one rule RT reported
 * broken: JavaScript-only for "Java", "Greater Noida" for "Noida", blank
 * values passing range filters.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';

import prisma from '../../config/database.js';
import { disconnectRedis } from '../../config/redis.js';
import { searchKeywordCandidatesV2 } from '../../services/screeningV2.service.js';
import { parseScreeningFilters, passesStrictFilters, skillRegexSource, wholeWordMatch } from '../../utils/screeningFilters.js';

const TAG = 'SCREENING-V2-KEYWORD-FIXTURE';
const SENTINEL = 'Zqxsentinel';

/** Candidates keyed by letter; `null` fields are the "empty value" cases. */
const FIXTURES = {
  A: {
    Name: 'Zqxsentinel Alpha Gagarai', EmailID: 'zqx.sentinel.a@example.invalid',
    ContactNumber: '+91-90000-12345, 080-1234567',
    Top5KeySkills: `Java, Spring Boot, ${SENTINEL}`, resume_full_text: 'Java developer building Spring Boot microservices.',
    PositionApplied: 'Java Developer', CurrentLocation: 'Noida, Uttar Pradesh', Gender: 'Male',
    TotalExperienceYearsNumeric: 4, ExpectedCTCNumeric: 12, NoticePeriodDays: 30,
    HighestQualification: 'B.Tech', graduationdegree: 'B.Tech', graduationspecialization: 'Computer Science',
  },
  B: {
    Name: 'Zqxsentinel Bravo', EmailID: 'zqx.sentinel.b@example.invalid', ContactNumber: '9000012346',
    Top5KeySkills: `JavaScript, React, ${SENTINEL}`, resume_full_text: 'Frontend engineer, JavaScript and React.',
    PositionApplied: 'JavaScript Developer', CurrentLocation: 'Noida', Gender: 'Female',
    TotalExperienceYearsNumeric: 3, ExpectedCTCNumeric: 8, NoticePeriodDays: 15,
    HighestQualification: 'BCA', graduationdegree: 'BCA', graduationspecialization: 'Commerce',
  },
  C: {
    Name: 'Zqxsentinel Charlie', EmailID: 'zqx.sentinel.c@example.invalid', ContactNumber: '9000012347',
    Top5KeySkills: `Java, ${SENTINEL}`, resume_full_text: 'Core Java, JDBC.',
    PositionApplied: 'Backend Engineer', CurrentLocation: 'Greater Noida', Gender: 'Male',
    TotalExperienceYearsNumeric: 6, ExpectedCTCNumeric: 20, NoticePeriodDays: 60,
  },
  D: {
    Name: 'Zqxsentinel Delta', EmailID: 'zqx.sentinel.d@example.invalid', ContactNumber: null,
    Top5KeySkills: `Java, Spring, ${SENTINEL}`, resume_full_text: 'Java and Spring.',
    PositionApplied: null, CurrentLocation: null, Gender: null,
    TotalExperienceYearsNumeric: null, ExpectedCTCNumeric: null, NoticePeriodDays: null,
  },
  E: {
    Name: 'Zqxsentinel Echo', EmailID: 'zqx.sentinel.e@example.invalid', ContactNumber: '9000012349',
    Top5KeySkills: `Python, Django, ${SENTINEL}`, resume_full_text: 'Python, Django REST framework.',
    PositionApplied: 'Python Developer', CurrentLocation: 'Pune', Gender: 'Male',
    TotalExperienceYearsNumeric: 0, ExpectedCTCNumeric: 4, NoticePeriodDays: 0,
    HighestQualification: 'B.Com', graduationdegree: 'B.Com',
  },
  F: {
    Name: 'Zqxsentinel Foxtrot', EmailID: 'zqx.sentinel.f@example.invalid', ContactNumber: '9000012350',
    Top5KeySkills: `.NET, C#, ${SENTINEL}`, resume_full_text: 'ASP.NET Core and C# services.',
    PositionApplied: '.NET Developer', CurrentLocation: 'Noida (UP)', Gender: 'Female',
    TotalExperienceYearsNumeric: 8, ExpectedCTCNumeric: 25, NoticePeriodDays: 90,
    HighestQualification: 'MBA', postgraduationdegree: 'MBA',
  },
};

const idOf = {};
const letterOf = new Map();

/** Fixture letters present in a result set, sorted. */
const fixtureLetters = (result) =>
  result.candidates.map((c) => letterOf.get(String(c.id))).filter(Boolean).sort().join('');

const search = (body) => searchKeywordCandidatesV2(body);
const scoped = (body = {}) => search({ ...body, keyword: [SENTINEL, body.keyword].filter(Boolean).join(', ') });

before(async () => {
  const now = new Date();
  const fortyDaysAgo = new Date(Date.now() - 40 * 86400000);
  for (const [letter, data] of Object.entries(FIXTURES)) {
    const row = await prisma.rpa_cv.create({
      // C was uploaded 40 days ago — the "Added within" case.
      data: { ...data, MetaData: TAG, statusActive: 'Active', createdAt: letter === 'C' ? fortyDaysAgo : now, modifiedAt: now },
      select: { id: true },
    });
    idOf[letter] = row.id;
    letterOf.set(String(row.id), letter);
  }
});

after(async () => {
  const ids = Object.values(idOf);
  if (ids.length) await prisma.rpa_cv.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
  // Best effort: the search path never touches Redis, so a missing server must
  // not turn a clean run red.
  try {
    await disconnectRedis?.();
  } catch {
    // ignore
  }
});

describe('N04 — skills: whole-word, All / Any', () => {
  test('All: "Java, Spring" returns only candidates with both — never JavaScript-only', async () => {
    const r = await scoped({ keyword: 'Java, Spring' });
    assert.equal(fixtureLetters(r), 'AD');
  });

  test('Any: "Java, Spring" returns either, still never JavaScript-only', async () => {
    const r = await search({ keyword: 'Java, Spring', matchMode: 'any' });
    assert.equal(fixtureLetters(r), 'ACD');
  });

  test('".NET" and "C#" match their own profiles only', async () => {
    assert.equal(fixtureLetters(await scoped({ keyword: '.NET' })), 'F');
    assert.equal(fixtureLetters(await scoped({ keyword: 'c#' })), 'F');
    assert.equal(fixtureLetters(await scoped({ keyword: 'Go' })), '');
  });
});

describe('N03 — every filter is a hard filter; empty values are excluded', () => {
  test('location "Noida" excludes "Greater Noida" and blank, keeps "Noida (UP)"', async () => {
    assert.equal(fixtureLetters(await scoped({ location: 'Noida' })), 'ABF');
  });

  test('gender is applied even when skills are entered', async () => {
    assert.equal(fixtureLetters(await scoped({ gender: 'female' })), 'BF');
  });

  test('experience 0–4: the fresher at 0 passes, blank experience is excluded', async () => {
    assert.equal(fixtureLetters(await scoped({ expMin: 0, expMax: 4 })), 'ABE');
  });

  test('expected CTC max 12 excludes blank CTC', async () => {
    assert.equal(fixtureLetters(await scoped({ ctcMax: 12 })), 'ABE');
  });

  test('notice period max 30 days excludes blank notice', async () => {
    assert.equal(fixtureLetters(await scoped({ noticePeriod: '30' })), 'ABE');
  });

  test('education category is a hard filter', async () => {
    assert.equal(fixtureLetters(await scoped({ education: 'tech_cs_it_mca_mtech' })), 'A');
  });

  test('position applied is a whole-phrase match ("Java Developer" ≠ "JavaScript Developer")', async () => {
    assert.equal(fixtureLetters(await scoped({ position: 'Java Developer' })), 'A');
  });

  test('added within 30 days excludes the candidate uploaded 40 days ago', async () => {
    assert.equal(fixtureLetters(await scoped({ addedWithinDays: 30 })), 'ABDEF');
  });

  test('every returned row satisfies every applied filter (whole result set, not just fixtures)', async () => {
    const body = { keyword: `${SENTINEL}, Java`, location: 'Noida', expMin: 0, ctcMax: 30, gender: 'male' };
    const r = await search(body);
    const f = parseScreeningFilters(body);
    for (const c of r.candidates) {
      const row = await prisma.rpa_cv.findUnique({ where: { id: BigInt(c.id) } });
      assert.deepEqual(passesStrictFilters(row, f), { pass: true, failedOn: null }, `cv ${c.id}`);
    }
    assert.equal(fixtureLetters(r), 'A');
  });
});

describe('N05 — the score orders, it never hides', () => {
  test('summary counts add up: total = Σ removedBy + shown', async () => {
    const r = await scoped({ location: 'Noida', gender: 'female' });
    const removed = Object.values(r.summary.removedBy).reduce((a, b) => a + b, 0);
    assert.equal(r.summary.total, removed + r.summary.shown);
    assert.doesNotMatch(r.summary.summaryText, /hidden by low score/);
  });

  test('a passing candidate with a weak score is still shown, results sorted by score', async () => {
    const r = await search({ keyword: 'Java, Spring', matchMode: 'any' });
    const scores = r.candidates.map((c) => c.relevanceScore.avgScore);
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
    assert.ok(r.candidates.every((c) => c.relevanceScore.avgScore != null));
  });

  test('a search with no filters at all is refused', async () => {
    await assert.rejects(() => search({}), /at least one filter/);
  });
});

describe('N02 — exact lookup by email, phone, name', () => {
  test('the single Find box auto-detects email, phone and name', async () => {
    assert.equal(fixtureLetters(await search({ lookup: 'ZQX.Sentinel.C@example.invalid' })), 'C');
    assert.equal(fixtureLetters(await search({ lookup: '+91 90000 12346' })), 'B');
    const byName = await search({ lookup: 'Zqxsentinel Echo' });
    assert.equal(byName.summary.lookupType, 'name');
    assert.equal(fixtureLetters(byName), 'E');
  });

  test('email returns exactly that candidate, skipping skills and scoring', async () => {
    const r = await search({ email: 'ZQX.Sentinel.A@example.invalid' });
    assert.equal(r.summary.mode, 'lookup');
    assert.equal(fixtureLetters(r), 'A');
    assert.equal(r.candidates[0].relevanceScore, null);
  });

  test('an email typed into the Skills box is a lookup too', async () => {
    const r = await search({ keyword: 'zqx.sentinel.b@example.invalid' });
    assert.equal(r.summary.mode, 'lookup');
    assert.equal(fixtureLetters(r), 'B');
  });

  test('phone matches any stored number, whatever its formatting', async () => {
    const r = await search({ phone: '90000 12345' });
    assert.equal(fixtureLetters(r), 'A');
    for (const c of r.candidates) assert.match(String(c.ContactNumber).replace(/[^0-9]/g, ''), /9000012345/);
  });

  test('full name is an exact (case/space-insensitive) match — not 42 look-alikes', async () => {
    const r = await search({ name: '  zqxsentinel   alpha GAGARAI ' });
    assert.equal(r.summary.matchKind, 'exact');
    assert.equal(fixtureLetters(r), 'A');
    assert.equal(r.candidates.length, 1);
  });

  test('a partial name falls back to a prefix match', async () => {
    const r = await search({ name: 'Zqxsentinel Alpha' });
    assert.equal(r.summary.matchKind, 'prefix');
    assert.equal(fixtureLetters(r), 'A');
  });

  test('a phone with fewer than 10 digits is rejected', async () => {
    await assert.rejects(() => search({ phone: '12345' }), /10-digit/);
  });
});

describe('SQL and JS agree on whole-word matching', () => {
  const texts = [
    'JavaScript, React', 'Core Java.', 'Experience in .NET Core', 'ASP.NET MVC', 'C#, C++', 'React',
    'Python, Django', 'Go, Kubernetes', 'node.js', 'NodeJS', 'Machine\nLearning', 'spring-boot', 'C, C++',
  ];
  const terms = ['java', 'net', '.net', 'c', 'c#', 'c++', 'go', 'js', 'node', 'machine learning', 'spring boot', 'react'];

  test('Postgres ~* gives the same answer as wholeWordMatch for every pair', async () => {
    for (const text of texts) {
      for (const term of terms) {
        const [{ m }] = await prisma.$queryRaw(Prisma.sql`SELECT (${text}::text ~* ${skillRegexSource(term)}) AS m`);
        assert.equal(m, wholeWordMatch(text, term), `"${text}" ~ "${term}"`);
      }
    }
  });
});
