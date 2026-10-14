/**
 * JD screening rules (Phase 3 "Do Now", N07–N09). Run:
 *   node --test src/tests/unit/jdScreeningRules.test.js
 *
 * RT's rule (29 Sep): ALL mandatory skills first, then education, budget and
 * the experience band, with an empty value excluding the candidate; the score
 * only orders the passers. The MRF texts below are written the way MRFs are
 * actually filled in — lead-ins, soft skills, years, asides — because "All" on
 * badly parsed text returns nobody.
 *
 * Pure unit test: no database, no network. The education SQL is checked
 * against a real database in tests/integration/jdGates.test.js.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveMandatoryText,
  parseMandatorySkills,
  experienceBand,
  normaliseBudget,
  mapQualification,
  jdEducationPass,
  educationGateSql,
  coverageOf,
  experienceFit,
  ctcHeadroom,
  noticeScore,
  jdRankScore,
  JD_RANK_WEIGHTS,
} from '../../utils/jdScreeningRules.js';

describe('resolveMandatoryText', () => {
  const jd = { mandatory_skills: 'Java, Spring Boot' };

  test('uses the MRF text when it is filled in', () => {
    assert.deepEqual(resolveMandatoryText({ mandatory_skills: 'Python', parsed_jd_json: jd }), { text: 'Python', source: 'mrf' });
  });

  test('"Same as JD" and blank fall back to the parsed JD', () => {
    for (const v of ['Same as JD', 'SAME AS JD', '  ', null]) {
      assert.deepEqual(resolveMandatoryText({ mandatory_skills: v, parsed_jd_json: jd }), { text: 'Java, Spring Boot', source: 'jd' });
    }
  });

  test('parsed JD may be a JSON string holding an array', () => {
    const r = resolveMandatoryText({ mandatory_skills: '', parsed_jd_json: JSON.stringify({ mandatory_skills: ['Go', 'Kafka'] }) });
    assert.deepEqual(r, { text: 'Go, Kafka', source: 'jd' });
  });

  test('"Other" reads mandatory_skills_other', () => {
    assert.deepEqual(
      resolveMandatoryText({ mandatory_skills: 'Other', mandatory_skills_other: 'Salesforce, Apex' }),
      { text: 'Salesforce, Apex', source: 'mrf_other' },
    );
  });

  test('nothing anywhere → empty, no source', () => {
    assert.deepEqual(resolveMandatoryText({ mandatory_skills: 'Same as JD', parsed_jd_json: null }), { text: '', source: null });
  });
});

describe('parseMandatorySkills', () => {
  test('a typical MRF: lead-ins stripped, soft skills and years ignored', () => {
    const r = parseMandatorySkills('Strong knowledge of Java, Hands-on experience with Spring Boot; Good communication skills\n3+ years of experience');
    assert.deepEqual(r.skills, ['java', 'spring boot']);
    assert.deepEqual(r.ignored.map((i) => i.reason), ['soft skill', 'years of experience (the experience band covers this)']);
  });

  test('"N years of experience in X" keeps X', () => {
    assert.deepEqual(parseMandatorySkills('3+ years of hands-on experience in Python').skills, ['python']);
  });

  test('"and" / "&" split into two required skills; "R&D" stays one', () => {
    assert.deepEqual(parseMandatorySkills('React and Redux, HTML & CSS, R&D').skills, ['react', 'redux', 'html', 'css', 'r&d']);
  });

  test('asides in brackets are dropped', () => {
    assert.deepEqual(parseMandatorySkills('Python (Django/Flask), SQL (any RDBMS)').skills, ['python', 'sql']);
  });

  test('CI/CD and PL/SQL are one skill each; other slashes still split', () => {
    assert.deepEqual(parseMandatorySkills('CI/CD, PL/SQL, HTML/CSS').skills, ['ci/cd', 'pl/sql', 'html', 'css']);
  });

  test('aliases collapse; the first spelling is kept', () => {
    const r = parseMandatorySkills('.NET, dotnet, ASP.NET, C#, csharp, Node.js, NodeJS');
    assert.deepEqual(r.skills, ['.net', 'c#', 'node.js']);
  });

  test('".NET" keeps its leading dot; bullets and numbering are removed', () => {
    assert.deepEqual(parseMandatorySkills('• .NET\n- C++\n1. SQL Server\n2) Azure').skills, ['.net', 'c++', 'sql server', 'azure']);
  });

  test('trailing "experience" / "skills" removed', () => {
    assert.deepEqual(parseMandatorySkills('React experience, SQL skills, Kubernetes knowledge').skills, ['react', 'sql', 'kubernetes']);
  });

  test('either/or and sentences are ignored, visibly', () => {
    const r = parseMandatorySkills('Java or Kotlin, Ability to design scalable distributed systems end to end, Docker');
    assert.deepEqual(r.skills, ['docker']);
    assert.equal(r.ignored.length, 2);
    assert.match(r.ignored[0].reason, /either\/or/);
    assert.match(r.ignored[1].reason, /sentence/);
  });

  test('labels keep the original spelling for display', () => {
    assert.deepEqual(parseMandatorySkills('Strong knowledge of Spring Boot, AWS').labels, ['Spring Boot', 'AWS']);
  });

  test('empty text → nothing', () => {
    assert.deepEqual(parseMandatorySkills(''), { skills: [], labels: [], ignored: [] });
    assert.deepEqual(parseMandatorySkills(null).skills, []);
  });
});

describe('experienceBand', () => {
  test('JD min and max', () => {
    assert.deepEqual(experienceBand({ min_experience_years: 3, max_experience_years: 6 }, 2), { min: 3, max: 6, source: 'jd' });
  });

  test('JD as a JSON string, values as text', () => {
    assert.deepEqual(experienceBand('{"min_experience_years":"2","max_experience_years":"5 years"}', null), { min: 2, max: 5, source: 'jd' });
  });

  test('JD max only → MRF years as the minimum', () => {
    assert.deepEqual(experienceBand({ max_experience_years: 8 }, 4), { min: 4, max: 8, source: 'jd' });
  });

  test('JD min only → open band', () => {
    assert.deepEqual(experienceBand({ min_experience_years: 5 }, 2), { min: 5, max: null, source: 'jd' });
  });

  test('no JD band → [MRF years, ∞)', () => {
    assert.deepEqual(experienceBand(null, 3), { min: 3, max: null, source: 'mrf' });
  });

  test('min > max is ignored in favour of the MRF', () => {
    assert.deepEqual(experienceBand({ min_experience_years: 7, max_experience_years: 3 }, 4), { min: 4, max: null, source: 'mrf' });
  });

  test('0 is a real value (fresher roles)', () => {
    assert.deepEqual(experienceBand({ min_experience_years: 0, max_experience_years: 0 }, null), { min: 0, max: 0, source: 'jd' });
  });

  test('nothing at all → [0, ∞), still requires a known experience', () => {
    assert.deepEqual(experienceBand(null, null), { min: 0, max: null, source: 'none' });
  });
});

describe('normaliseBudget', () => {
  test('LPA stays LPA; rupees become LPA', () => {
    assert.equal(normaliseBudget(15), 15);
    assert.equal(normaliseBudget('12.5'), 12.5);
    assert.equal(normaliseBudget(1500000), 15);
  });

  test('missing / zero / junk → null', () => {
    for (const v of [null, '', 0, -3, 'abc']) assert.equal(normaliseBudget(v), null);
  });
});

describe('mapQualification ("Any" means any stream)', () => {
  test('the four MRF form options', () => {
    assert.equal(mapQualification('BE/BTech, MCA, Any'), 'TECH_GRADUATE');
    assert.equal(mapQualification('PG, Any'), 'POST_GRADUATE');
    assert.equal(mapQualification('Graduate'), 'GRADUATE');
    assert.equal(mapQualification('Other'), null);
  });

  test('blank → no gate', () => {
    assert.equal(mapQualification(null), null);
    assert.equal(mapQualification(''), null);
  });
});

describe('jdEducationPass', () => {
  const c = (g, pg) => ({ graduationdegree: g, postgraduationdegree: pg });

  test('TECH_GRADUATE: BE/BTech or MCA, any branch', () => {
    assert.equal(jdEducationPass(c('B.Tech', null), 'TECH_GRADUATE'), true);
    assert.equal(jdEducationPass(c('B.E.', null), 'TECH_GRADUATE'), true);
    assert.equal(jdEducationPass(c('BCA', 'MCA'), 'TECH_GRADUATE'), true);
    assert.equal(jdEducationPass(c('B.Com', null), 'TECH_GRADUATE'), false);
  });

  test('POST_GRADUATE: any PG degree', () => {
    assert.equal(jdEducationPass(c('B.Com', 'MBA'), 'POST_GRADUATE'), true);
    assert.equal(jdEducationPass(c('B.Sc', 'M.A.'), 'POST_GRADUATE'), true);
    assert.equal(jdEducationPass(c('B.Tech', null), 'POST_GRADUATE'), false);
  });

  test('GRADUATE: any degree at all', () => {
    assert.equal(jdEducationPass(c('B.Tech', null), 'GRADUATE'), true);
    assert.equal(jdEducationPass(c(null, 'MBA'), 'GRADUATE'), true);
  });

  test('empty or placeholder degrees are excluded', () => {
    for (const req of ['TECH_GRADUATE', 'POST_GRADUATE', 'GRADUATE']) {
      assert.equal(jdEducationPass(c(null, null), req), false);
      assert.equal(jdEducationPass(c('NULL', 'N/A'), req), false);
      assert.equal(jdEducationPass(c('', '-'), req), false);
    }
  });

  test('no requirement → everyone passes', () => {
    assert.equal(jdEducationPass(c(null, null), null), true);
  });
});

describe('educationGateSql', () => {
  test('null when there is no requirement', () => {
    assert.equal(educationGateSql(null), null);
  });

  test('keywords are bound parameters, not SQL text', () => {
    const sql = educationGateSql('TECH_GRADUATE');
    assert.doesNotMatch(sql.sql, /BTECH/);
    assert.ok(sql.values.some((v) => Array.isArray(v) && v.includes('%BTECH%')));
    assert.match(sql.sql, /c\.graduationdegree/);
  });

  test('rejects an unsafe alias', () => {
    assert.throws(() => educationGateSql('GRADUATE', 'c; drop'));
  });
});

describe('ranking parts', () => {
  test('coverage: declared 1, resume-only 0.7', () => {
    assert.equal(coverageOf([{ inSkills: true, matched: true }, { inSkills: true, matched: true }]), 1);
    assert.equal(coverageOf([{ inSkills: true, matched: true }, { inSkills: false, matched: true }]), 0.85);
  });

  test('experience fit: middle of a closed band is best, edges 0.5', () => {
    const band = { min: 2, max: 6 };
    assert.equal(experienceFit(4, band), 1);
    assert.equal(experienceFit(2, band), 0.5);
    assert.equal(experienceFit(6, band), 0.5);
    assert.equal(experienceFit(3, band), 0.75);
    assert.equal(experienceFit(3, { min: 3, max: 3 }), 1);
  });

  test('experience fit: open band eases off after min + 2', () => {
    const band = { min: 3, max: null };
    assert.equal(experienceFit(4, band), 1);
    assert.equal(experienceFit(7, band), 0.75);
    assert.equal(experienceFit(20, band), 0.5);
  });

  test('CTC headroom: share of budget left; neutral without a budget', () => {
    assert.equal(ctcHeadroom(12, 15), 0.2);
    assert.equal(ctcHeadroom(15, 15), 0);
    assert.equal(ctcHeadroom(12, null), 0.5);
  });

  test('notice: shorter is better; unknown ranks as 60+', () => {
    assert.equal(noticeScore(0), 1);
    assert.equal(noticeScore(30), 0.8);
    assert.equal(noticeScore(90), 0.2);
    assert.equal(noticeScore(null), 0.2);
  });

  test('weights add up to 1', () => {
    const sum = Object.values(JD_RANK_WEIGHTS).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9);
  });
});

describe('jdRankScore', () => {
  const band = { min: 3, max: 6, source: 'jd' };
  const declared = [{ term: 'java', inSkills: true, matched: true, source: 'declared' }];
  const resumeOnly = [{ term: 'java', inSkills: false, matched: true, source: 'resume' }];
  const cand = { TotalExperienceYearsNumeric: '4.5', ExpectedCTCNumeric: '12', NoticePeriodDays: 30 };

  test('a declared skill ranks above a resume-only one, all else equal', () => {
    const a = jdRankScore({ perTerm: declared, band, budgetMax: 15, candidate: cand });
    const b = jdRankScore({ perTerm: resumeOnly, band, budgetMax: 15, candidate: cand });
    assert.ok(a.finalScore > b.finalScore);
  });

  test('score is 0–10 and the breakdown carries the old JD keys', () => {
    const r = jdRankScore({ perTerm: declared, band, budgetMax: 15, candidate: cand });
    assert.ok(r.finalScore >= 0 && r.finalScore <= 10);
    assert.deepEqual(Object.keys(r.breakdown), ['jdMatching', 'totalExperience', 'ctcAlignment', 'availability']);
    // 10 × (0.6·1 + 0.2·1 + 0.1·0.2 + 0.1·0.8) = 9.0
    assert.equal(r.finalScore, 9);
  });

  test('no budget: the CTC part is neutral and says so', () => {
    const r = jdRankScore({ perTerm: declared, band, budgetMax: null, candidate: cand });
    assert.equal(r.parts.ctcHeadroom, 0.5);
    assert.match(r.breakdown.ctcAlignment.reason, /No budget/);
  });
});
