/**
 * Strict screening filters (Phase 3 "Do Now", N01). Run:
 *   node --test src/tests/unit/screeningFilters.test.js
 *
 * RT's rule (29 Sep): every applied filter is a hard filter, a candidate with
 * no value for it is excluded, skills match whole words, and location is an
 * exact match on one part of the stored location. Each rule below is one of
 * the failures RT reported — "java" returning JavaScript-only profiles, "Noida"
 * returning "Greater Noida", "Sushree Sandhyarani Gagarai" returning 42 people.
 *
 * Pure unit test — the JS mirror and the SQL the database is handed. No
 * database, no network.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  splitSkillPhrases,
  termVariants,
  skillRegexSource,
  prefilterKeys,
  wholeWordMatch,
  locationParts,
  parseScreeningFilters,
  detectLookup,
  buildFilterConditions,
  buildFilterSql,
  buildSkillPredicateSql,
  buildPassCountSql,
  removedByFromPassCounts,
  passesStrictFilters,
} from '../../utils/screeningFilters.js';
import { normalisePhone } from '../../utils/phone.js';

/** A fully-populated candidate; tests blank out the field under test. */
const candidate = (over = {}) => ({
  CurrentLocation: 'Noida, Uttar Pradesh',
  Gender: 'Male',
  TotalExperienceYearsNumeric: '4.50',
  ExpectedCTCNumeric: '12.00',
  NoticePeriodDays: 30,
  PositionApplied: 'Senior Java Developer',
  Top5KeySkills: 'Java, Spring Boot, MySQL',
  resume_technical_terms: [{ term: 'hibernate', count: 3 }],
  resume_full_text: 'Worked on microservices using Java and Spring. Deployed on AWS.',
  HighestQualification: 'B.Tech',
  graduationdegree: 'B.Tech',
  graduationspecialization: 'Computer Science',
  createdAt: new Date(Date.now() - 3 * 86400000),
  ...over,
});

describe('wholeWordMatch — skills match whole words only', () => {
  test('"java" does not match "javascript"', () => {
    assert.equal(wholeWordMatch('JavaScript, React', 'java'), false);
    assert.equal(wholeWordMatch('Core Java, JavaScript', 'java'), true);
  });

  test('"net" does not match ".NET"', () => {
    assert.equal(wholeWordMatch('Experience in .NET Core', 'net'), false);
  });

  test('".NET" matches its aliases (dotnet, ASP.NET)', () => {
    assert.equal(wholeWordMatch('Built APIs in ASP.NET', '.net'), true);
    assert.equal(wholeWordMatch('dotnet developer', '.NET'), true);
    assert.equal(wholeWordMatch('C# and .NET.', 'dotnet'), true);
  });

  test('"c" does not match "react", "c#" or "c++"', () => {
    assert.equal(wholeWordMatch('React, Redux', 'c'), false);
    assert.equal(wholeWordMatch('C#, C++', 'c'), false);
    assert.equal(wholeWordMatch('C, C++', 'c'), true);
  });

  test('C# and C++ match themselves and their aliases', () => {
    assert.equal(wholeWordMatch('Skills: C#, SQL', 'c#'), true);
    assert.equal(wholeWordMatch('Skills: csharp', 'C#'), true);
    assert.equal(wholeWordMatch('Skills: cpp', 'c++'), true);
    assert.equal(wholeWordMatch('Skills: C++', 'cpp'), true);
  });

  test('"django" does not match "go"; "go" only matches the word go', () => {
    assert.equal(wholeWordMatch('Python, Django', 'go'), false);
    assert.equal(wholeWordMatch('Go, Kubernetes', 'go'), true);
  });

  test('Node.js / nodejs / node are one skill; "js" alone is JavaScript', () => {
    assert.equal(wholeWordMatch('NodeJS, Express', 'node.js'), true);
    assert.equal(wholeWordMatch('Node.js', 'nodejs'), true);
    assert.equal(wholeWordMatch('Node.js', 'js'), false);
    assert.equal(wholeWordMatch('JavaScript', 'js'), true);
  });

  test('a sentence-ending full stop is still a boundary', () => {
    assert.equal(wholeWordMatch('I mostly write Java.', 'java'), true);
  });

  test('multi-word skills tolerate spaces, hyphens and line breaks', () => {
    assert.equal(wholeWordMatch('spring-boot', 'Spring Boot'), true);
    assert.equal(wholeWordMatch('Machine\nLearning', 'machine learning'), true);
    assert.equal(wholeWordMatch('Learning machines', 'machine learning'), false);
  });

  test('null / empty input never matches', () => {
    assert.equal(wholeWordMatch(null, 'java'), false);
    assert.equal(wholeWordMatch('java', ''), false);
  });

  test('the same regex source is valid for Postgres (no \\m/\\M, no lookbehind)', () => {
    const src = skillRegexSource('.net');
    assert.doesNotMatch(src, /\\[mMyY]|\(\?<|\(\?=/);
  });

  test('termVariants returns the whole alias group', () => {
    assert.ok(termVariants('dotnet').includes('asp.net'));
    assert.deepEqual(termVariants('Python'), ['python']);
  });
});

describe('splitSkillPhrases', () => {
  test('splits on list separators only, keeps multi-word phrases', () => {
    assert.deepEqual(splitSkillPhrases('Java, Spring Boot; Machine Learning\nCI/CD'), [
      'Java', 'Spring Boot', 'Machine Learning', 'CI', 'CD',
    ]);
    assert.deepEqual(splitSkillPhrases(''), []);
  });
});

describe('parseScreeningFilters', () => {
  test('0 is a real value; blank is "not applied"', () => {
    const f = parseScreeningFilters({ expMin: 0, expMax: '', ctcMin: '0', noticePeriod: null });
    assert.equal(f.expMin, 0);
    assert.equal(f.expMax, null);
    assert.equal(f.ctcMin, 0);
    assert.equal(f.noticePeriod, null);
  });

  test('location accepts a comma list or an array', () => {
    assert.deepEqual(parseScreeningFilters({ location: 'Noida, Pune ' }).location, ['noida', 'pune']);
    assert.deepEqual(parseScreeningFilters({ location: ['Noida', 'noida'] }).location, ['noida']);
  });

  test('matchMode defaults to all', () => {
    assert.equal(parseScreeningFilters({}).matchMode, 'all');
    assert.equal(parseScreeningFilters({ matchMode: 'ANY' }).matchMode, 'any');
    assert.equal(parseScreeningFilters({ matchMode: 'nonsense' }).matchMode, 'all');
  });

  test('skills are split, lower-cased and de-duplicated', () => {
    assert.deepEqual(parseScreeningFilters({ keyword: 'Java, java ,Spring' }).skills, ['java', 'spring']);
  });

  test('education accepts a comma string of category keys', () => {
    assert.deepEqual(parseScreeningFilters({ education: 'tech_cs_it_mca_mtech,fin_bcom' }).education, [
      'tech_cs_it_mca_mtech', 'fin_bcom',
    ]);
  });
});

describe('passesStrictFilters — empty value for an applied filter excludes', () => {
  const cases = [
    ['location', { location: 'Noida' }, { CurrentLocation: null }],
    ['gender', { gender: 'male' }, { Gender: '' }],
    ['experience', { expMin: 0 }, { TotalExperienceYearsNumeric: null }],
    ['ctc', { ctcMax: 20 }, { ExpectedCTCNumeric: null }],
    ['notice', { noticePeriod: 30 }, { NoticePeriodDays: null }],
    ['addedWithin', { addedWithinDays: 7 }, { createdAt: null }],
    ['position', { position: 'Java Developer' }, { PositionApplied: null }],
    ['skills', { keyword: 'Java' }, { Top5KeySkills: null, resume_technical_terms: null, resume_full_text: null }],
    ['education', { education: 'tech_cs_it_mca_mtech' }, { HighestQualification: null, graduationdegree: null }],
  ];
  for (const [key, body, blank] of cases) {
    test(`${key}: populated passes, blank is excluded`, () => {
      const f = parseScreeningFilters(body);
      assert.deepEqual(passesStrictFilters(candidate(), f), { pass: true, failedOn: null });
      assert.deepEqual(passesStrictFilters(candidate(blank), f), { pass: false, failedOn: key });
    });
  }

  test('experience range is inclusive at both ends; out of range fails', () => {
    const f = parseScreeningFilters({ expMin: 2, expMax: 4.5 });
    assert.equal(passesStrictFilters(candidate(), f).pass, true);
    assert.equal(passesStrictFilters(candidate({ TotalExperienceYearsNumeric: '5' }), f).pass, false);
    assert.equal(passesStrictFilters(candidate({ TotalExperienceYearsNumeric: '1.9' }), f).pass, false);
  });

  test('min 0 still requires experience to be known (a fresher at 0 passes)', () => {
    const f = parseScreeningFilters({ expMin: 0 });
    assert.equal(passesStrictFilters(candidate({ TotalExperienceYearsNumeric: '0' }), f).pass, true);
  });

  test('notice period is a maximum in days', () => {
    const f = parseScreeningFilters({ noticePeriod: '30' });
    assert.equal(passesStrictFilters(candidate({ NoticePeriodDays: 30 }), f).pass, true);
    assert.equal(passesStrictFilters(candidate({ NoticePeriodDays: 60 }), f).pass, false);
  });

  test('gender accepts stored "M" / "F" spellings', () => {
    const f = parseScreeningFilters({ gender: 'female' });
    assert.equal(passesStrictFilters(candidate({ Gender: 'F' }), f).pass, true);
    assert.equal(passesStrictFilters(candidate({ Gender: 'Male' }), f).pass, false);
  });

  test('position applied is a whole-phrase match; any typed position is enough', () => {
    const f = parseScreeningFilters({ position: 'Java Developer, QA Engineer' });
    assert.equal(passesStrictFilters(candidate({ PositionApplied: 'JavaScript Developer' }), f).pass, false);
    assert.equal(passesStrictFilters(candidate({ PositionApplied: 'Senior QA Engineer' }), f).pass, true);
  });

  test('added within N days: older uploads are excluded', () => {
    const f = parseScreeningFilters({ addedWithinDays: '15' });
    assert.equal(f.addedWithinDays, 15);
    assert.equal(passesStrictFilters(candidate({ createdAt: new Date(Date.now() - 20 * 86400000) }), f).failedOn, 'addedWithin');
    assert.equal(parseScreeningFilters({ addedWithinDays: '' }).addedWithinDays, null);
    assert.equal(parseScreeningFilters({ addedWithinDays: '2.5' }).addedWithinDays, null);
  });

  test('added within 10 days (N38 option): day 9 passes, day 11 is out', () => {
    const f = parseScreeningFilters({ addedWithinDays: 10 });
    assert.equal(f.addedWithinDays, 10);
    assert.equal(passesStrictFilters(candidate({ createdAt: new Date(Date.now() - 9 * 86400000) }), f).pass, true);
    assert.equal(passesStrictFilters(candidate({ createdAt: new Date(Date.now() - 11 * 86400000) }), f).failedOn, 'addedWithin');
    const cond = buildFilterConditions(f).find((c) => c.key === 'addedWithin');
    assert.ok(cond, 'the JD search reuses this SQL condition');
    assert.deepEqual(cond.sql.values, [10]);
  });
});

describe('location — exact match on one part of the stored location', () => {
  const f = parseScreeningFilters({ location: 'Noida' });
  const loc = (v) => passesStrictFilters(candidate({ CurrentLocation: v }), f).pass;

  test('"Noida" matches "Noida, UP" and "noida"', () => {
    assert.equal(loc('Noida, UP'), true);
    assert.equal(loc('noida'), true);
    assert.equal(loc('Delhi / Noida'), true);
    assert.equal(loc('Noida (UP)'), true);
  });

  test('"Noida" never matches "Greater Noida" or a blank location', () => {
    assert.equal(loc('Greater Noida'), false);
    assert.equal(loc('Greater Noida, UP'), false);
    assert.equal(loc(''), false);
    assert.equal(loc(null), false);
  });

  test('several typed cities: any one is enough', () => {
    const f2 = parseScreeningFilters({ location: 'Pune, Noida' });
    assert.equal(passesStrictFilters(candidate({ CurrentLocation: 'Pune' }), f2).pass, true);
  });

  test('locationParts splits on , / ; |', () => {
    assert.deepEqual(locationParts('Noida, UP / India; NCR|Delhi'), ['noida', 'up', 'india', 'ncr', 'delhi']);
  });
});

describe('skills — All vs Any', () => {
  const javaOnly = candidate({ Top5KeySkills: 'Java', resume_technical_terms: [], resume_full_text: 'Java' });
  const jsOnly = candidate({ Top5KeySkills: 'JavaScript, React', resume_technical_terms: [], resume_full_text: 'JavaScript' });
  const both = candidate();

  test('All: "Java, Spring" needs both; a JavaScript-only profile never passes', () => {
    const f = parseScreeningFilters({ keyword: 'Java, Spring' });
    assert.equal(passesStrictFilters(both, f).pass, true);
    assert.equal(passesStrictFilters(javaOnly, f).pass, false);
    assert.equal(passesStrictFilters(jsOnly, f).pass, false);
  });

  test('Any: one of the skills is enough, still whole-word', () => {
    const f = parseScreeningFilters({ keyword: 'Java, Spring', matchMode: 'any' });
    assert.equal(passesStrictFilters(javaOnly, f).pass, true);
    assert.equal(passesStrictFilters(jsOnly, f).pass, false);
  });

  test('a skill evidenced only in technical terms counts', () => {
    const f = parseScreeningFilters({ keyword: 'Hibernate' });
    assert.equal(passesStrictFilters(candidate({ resume_full_text: '' }), f).pass, true);
  });
});

describe('normalisePhone — last 10 digits of each number', () => {
  test('+91, spaces, dashes and a trunk 0 all normalise to the same number', () => {
    for (const raw of ['+91 98765 43210', '098765-43210', '9876543210', '(+91) 98765-43210']) {
      assert.deepEqual(normalisePhone(raw), ['9876543210'], raw);
    }
  });

  test('several numbers in one field are split', () => {
    assert.deepEqual(normalisePhone('9876543210, +91 9123456789 / 9876543210'), ['9876543210', '9123456789']);
  });

  test('fewer than 10 digits is not a number', () => {
    assert.deepEqual(normalisePhone('12345'), []);
    assert.deepEqual(normalisePhone(null), []);
  });
});

describe('detectLookup — exact person lookup', () => {
  const look = (body) => detectLookup(parseScreeningFilters(body));

  test('the single Find box is auto-detected as email, phone or name', () => {
    assert.deepEqual(look({ lookup: ' Someone@Example.com ' }), { type: 'email', value: 'someone@example.com' });
    assert.deepEqual(look({ lookup: '+91 98765-43210' }), { type: 'phone', value: '9876543210' });
    assert.deepEqual(look({ lookup: 'Sushree  Sandhyarani Gagarai' }), { type: 'name', value: 'sushree sandhyarani gagarai' });
    assert.deepEqual(look({ lookup: '12345' }), { type: 'phone', value: null });
  });

  test('explicit fields: email > phone > name', () => {
    assert.deepEqual(look({ email: 'A@X.com', phone: '9876543210', name: 'Asha' }), { type: 'email', value: 'a@x.com' });
    assert.deepEqual(look({ phone: '+91 98765 43210', name: 'Asha' }), { type: 'phone', value: '9876543210' });
    assert.deepEqual(look({ name: '  Sushree   Sandhyarani Gagarai ' }), { type: 'name', value: 'sushree sandhyarani gagarai' });
  });

  test('an email or phone typed into the Skills box is recognised', () => {
    assert.deepEqual(look({ keyword: 'someone@example.com' }), { type: 'email', value: 'someone@example.com' });
    assert.deepEqual(look({ keyword: '+91 98765 43210' }), { type: 'phone', value: '9876543210' });
  });

  test('skills and short numbers are not lookups', () => {
    assert.equal(look({ keyword: 'Java, Spring' }), null);
    assert.equal(look({ keyword: '2024' }), null);
  });

  test('a phone field with too few digits yields a null value (caller rejects it)', () => {
    assert.deepEqual(look({ phone: '12345' }), { type: 'phone', value: null });
  });
});

describe('SQL builders', () => {
  test('no filters → TRUE, no conditions', () => {
    const f = parseScreeningFilters({});
    assert.equal(buildFilterConditions(f).length, 0);
    assert.equal(buildFilterSql(f).sql, 'TRUE');
  });

  test('conditions come in funnel order and every one is NULL-safe', () => {
    const f = parseScreeningFilters({
      location: 'Noida', gender: 'male', expMin: 0, ctcMax: 10, noticePeriod: 30,
      addedWithinDays: 30, position: 'Developer', keyword: 'Java',
    });
    const conds = buildFilterConditions(f);
    assert.deepEqual(conds.map((c) => c.key), ['location', 'gender', 'experience', 'ctc', 'notice', 'addedWithin', 'position', 'skills']);
    for (const c of conds) assert.match(c.sql.sql, /^COALESCE\(\(/);
  });

  test('empty values are excluded in SQL too (IS NOT NULL on numeric filters)', () => {
    const f = parseScreeningFilters({ expMin: 0, ctcMax: 10, noticePeriod: 30 });
    const sql = buildFilterSql(f).sql;
    assert.match(sql, /"TotalExperienceYearsNumeric" IS NOT NULL/);
    assert.match(sql, /"ExpectedCTCNumeric" IS NOT NULL/);
    assert.match(sql, /"NoticePeriodDays" IS NOT NULL/);
    // 0 is bound as a real value, not dropped
    assert.ok(buildFilterSql(f).values.includes(0));
  });

  test('location is bound as a text[] of normalised cities', () => {
    const f = parseScreeningFilters({ location: ' Noida , PUNE' });
    const sql = buildFilterSql(f);
    assert.ok(sql.values.some((v) => Array.isArray(v) && v.join() === 'noida,pune'));
  });

  test('All joins skill predicates with AND, Any with OR; regex is a bound value', () => {
    const all = buildSkillPredicateSql(['java', 'spring'], 'all');
    const any = buildSkillPredicateSql(['java', 'spring'], 'any');
    assert.match(all.sql, /\) AND \(/);
    assert.match(any.sql, /\) OR \(/);
    assert.ok(all.values.includes(skillRegexSource('java')));
    assert.doesNotMatch(all.sql, /java/i, 'the term never appears in SQL text');
    assert.equal(buildSkillPredicateSql([], 'all'), null);
  });

  test('prefilter keys: one cheap substring per alias group where possible', () => {
    assert.deepEqual(prefilterKeys(termVariants('.net')).sort(), ['core', 'net']);
    assert.deepEqual(prefilterKeys(['java']), ['java']);
    assert.deepEqual(prefilterKeys(termVariants('c#')).sort(), ['c#', 'sharp']);
    assert.deepEqual(prefilterKeys(['machine learning']), ['learning']);
  });

  test('every alias spelling contains a prefilter key (the prefilter never drops a match)', () => {
    for (const term of ['.net', 'c#', 'c++', 'node.js', 'javascript', 'react', 'kubernetes', 'postgresql']) {
      const keys = prefilterKeys(termVariants(term));
      for (const v of termVariants(term)) assert.ok(keys.some((k) => v.includes(k)), `${v} / ${keys}`);
    }
  });

  test('location prefilter escapes LIKE wildcards', () => {
    const sql = buildFilterSql(parseScreeningFilters({ location: 'a_b%' }));
    assert.ok(sql.values.some((v) => Array.isArray(v) && v.includes('%a\\_b\\%%')));
  });

  test('expensive conditions run only after the cheap ones (CASE fixes the order)', () => {
    const sql = buildFilterSql(parseScreeningFilters({ location: 'Noida', keyword: 'Java' })).sql;
    assert.match(sql, /^\(CASE WHEN COALESCE[\s\S]*THEN COALESCE[\s\S]*strpos[\s\S]*ELSE false END\)$/);
  });

  test('pass counts are cumulative: each step includes every earlier condition', () => {
    const f = parseScreeningFilters({ location: 'Noida', gender: 'male' });
    const sql = buildPassCountSql(buildFilterConditions(f)).sql;
    assert.match(sql, /COUNT\(\*\)::int AS total/);
    assert.match(sql, /AS "pass_location"/);
    // gender's step is "location AND gender"
    assert.match(sql, /FILTER \(WHERE COALESCE[\s\S]+ AND COALESCE[\s\S]+\)::int AS "pass_gender"/);
  });

  test('removed-by counts add up: total = sum(removed) + passed', () => {
    const keys = ['recentlyRejected', 'location', 'gender', 'skills'];
    const counts = { total: 1000, pass_recentlyRejected: 990, pass_location: 300, pass_gender: 180 };
    const removed = removedByFromPassCounts(keys, counts, 40);
    assert.deepEqual(removed, { recentlyRejected: 10, location: 690, gender: 120, skills: 140 });
    const sum = Object.values(removed).reduce((a, b) => a + b, 0);
    assert.equal(sum + 40, 1000);
  });

  test('a bad alias is refused before it reaches SQL', () => {
    assert.throws(() => buildFilterSql(parseScreeningFilters({ gender: 'male' }), 'c; drop'), /Invalid SQL alias/);
  });
});
