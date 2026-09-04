/**
 * Redaction rules for the candidate dossier — the regression test for tracker
 * row 5: "verify the pack leaks no vendor or CTC data".
 *
 * Run: node --test src/tests/unit/dossierRedaction.test.js
 *
 * Pure unit tests, no database. The dossier is emailed outside the company and
 * cannot be recalled, so every one of these assertions is about a value that
 * would be unrecoverable if it escaped once.
 *
 * The shape of the suite mirrors the two mechanisms in dossierRedaction.js: the
 * whitelist decides what gets IN, the assertion proves nothing else did.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  CV_PROFILE_FIELDS,
  CV_CONTACT_FIELDS,
  assertNoForbiddenFields,
  isForbiddenKey,
  pickCvProfile,
  redactionSummary,
} from '../../utils/dossierRedaction.js';

/** A realistic rpa_cv row: everything a parsed resume actually carries. */
const cvRow = {
  id: 9134n,
  Name: 'Pankaj Mondal',
  PositionApplied: 'Senior Java Developer',
  EmailID: 'pankaj@example.com',
  ContactNumber: '+91 98765 43210',
  TotalExperienceYears: '8',
  CurrentCompany: 'Example Systems',
  CurrentLocation: 'Kolkata',
  NoticePeriod: '60 days',
  Top5KeySkills: 'Java, Spring Boot, Kafka, PostgreSQL, AWS',
  LinkedInProfile: 'https://linkedin.com/in/example',
  HighestQualification: 'B.Tech',
  graduationdegree: 'B.Tech',
  graduationspecialization: 'Computer Science',
  postgraduationdegree: null,
  postgraduationspecialization: null,
  LastCompanyExperienceYears: '3',
  EnglishCommunicationRating: 'Good',
  PreferredShift: 'General',
  employment_history: [{ company: 'Example Systems', years: '3' }],
  // Everything below must never reach a dossier.
  CTC_LPA: '18',
  ExpectedCTC_LPA: '26',
  ExpectedCTCNumeric: 26.0,
  vendorName: 'Acme Staffing',
  VendorEmail: 'ops@acmestaffing.example',
  JobSource: 'vendor_portal',
  RecruiterInfoAAPNA: 'chhaya.k',
  lockForNinetyDays: 'true',
  cvMissingToken: 'a7f3c1e0-…',
  cvMissingTokenStatus: 'pending',
  MetaData: '{"raw":"…"}',
  missingData: 'ContactNumber',
  Gender: 'Male',
  ReasonForJobChange: 'Career growth',
  resume_full_text: 'PANKAJ MONDAL …',
};

describe('pickCvProfile — the whitelist is how a field gets in', () => {
  test('returns only whitelisted fields, never the rest of the row', () => {
    const picked = pickCvProfile(cvRow);
    const allowed = new Set([
      ...CV_PROFILE_FIELDS.map(([f]) => f),
      ...CV_CONTACT_FIELDS.map(([f]) => f),
    ]);
    for (const entry of picked) {
      assert.ok(allowed.has(entry.field), `${entry.field} is not on the whitelist`);
    }
  });

  test('a column nobody has whitelisted cannot appear, even when present on the row', () => {
    // The point of a whitelist: `Gender` and `resume_full_text` are real columns
    // sitting right next to the ones we do want, and neither belongs in a pack
    // sent to an external interviewer.
    const fields = pickCvProfile(cvRow).map((e) => e.field);
    assert.ok(!fields.includes('Gender'));
    assert.ok(!fields.includes('resume_full_text'));
    assert.ok(!fields.includes('ReasonForJobChange'));
  });

  test('contact details are included by default (decision #10)', () => {
    const fields = pickCvProfile(cvRow).map((e) => e.field);
    assert.ok(fields.includes('EmailID'));
    assert.ok(fields.includes('ContactNumber'));
  });

  test('contact details can be withheld for one download', () => {
    const picked = pickCvProfile(cvRow, { includeContactDetails: false });
    const fields = picked.map((e) => e.field);
    assert.ok(!fields.includes('EmailID'));
    assert.ok(!fields.includes('ContactNumber'));
    // And the values are genuinely gone, not merely unlabelled.
    assert.ok(!JSON.stringify(picked).includes('pankaj@example.com'));
    assert.ok(!JSON.stringify(picked).includes('98765'));
  });

  test('empty values are kept as null rather than dropped', () => {
    // "No post-graduation recorded" and "the dossier forgot the field" must be
    // distinguishable to whoever reads the pack — plan §3.1.
    const picked = pickCvProfile(cvRow);
    const pg = picked.find((e) => e.field === 'postgraduationdegree');
    assert.ok(pg, 'a null field must still be rendered');
    assert.equal(pg.value, null);
  });

  test('a journey with no CV row yields the same fields, all empty', () => {
    const picked = pickCvProfile(null);
    assert.equal(picked.length, CV_PROFILE_FIELDS.length + CV_CONTACT_FIELDS.length);
    assert.ok(picked.every((e) => e.value === null));
  });

  test('every whitelisted field carries a human label', () => {
    for (const entry of pickCvProfile(cvRow)) {
      assert.ok(entry.label && entry.label.trim().length > 0, `${entry.field} has no label`);
    }
  });

  test('the whitelist never admits a forbidden name', () => {
    // Guards the guard: if someone adds a field to CV_PROFILE_FIELDS that the
    // assertion would later reject, this fails at the source rather than at
    // download time in front of a recruiter.
    for (const [field] of [...CV_PROFILE_FIELDS, ...CV_CONTACT_FIELDS]) {
      assert.equal(isForbiddenKey(field), false, `${field} is both whitelisted and forbidden`);
    }
  });
});

describe('assertNoForbiddenFields — nothing forbidden survives to the pack', () => {
  // One case per row of plan §8.2. A model carrying the field must throw.
  const forbidden = {
    'rpa_cv current CTC': { profile: { CTC_LPA: '18' } },
    'rpa_cv expected CTC': { profile: { ExpectedCTC_LPA: '26' } },
    'rpa_cv numeric expected CTC': { profile: { ExpectedCTCNumeric: 26 } },
    'rpa_cv vendor name': { profile: { vendorName: 'Acme Staffing' } },
    'rpa_cv vendor email': { profile: { VendorEmail: 'ops@acme.example' } },
    'rpa_cv job source': { profile: { JobSource: 'vendor_portal' } },
    'rpa_cv internal recruiter note': { profile: { RecruiterInfoAAPNA: 'chhaya.k' } },
    'rpa_cv vendor lock': { profile: { lockForNinetyDays: 'true' } },
    'rpa_cv missing-data token': { profile: { cvMissingToken: 'a7f3…' } },
    'rpa_cv metadata blob': { profile: { MetaData: '{}' } },
    'pipeline vendor email': { journey: { vendor_email: 'ops@acme.example' } },
    'MRF budget floor': { position: { budget_min: 1800000 } },
    'MRF budget ceiling': { position: { budget_max: 2600000 } },
    'HR scorecard current CTC': { scorecards: [{ hr: { hr_current_ctc: '18 LPA' } }] },
    'HR scorecard expected CTC': { scorecards: [{ hr: { hr_expected_ctc: '26 LPA' } }] },
    'recording Graph content URL': { recordings: [{ graph_content_url: 'https://graph…' }] },
    'recording archive item id': { recordings: [{ archive_item_id: 'drive!item' }] },
    'recording Teams web URL': { recordings: [{ teams_web_url: 'https://…sharepoint.com/…' }] },
    'scorecard token': { scorecards: [{ token: 'c0ffee…' }] },
    'schedule Teams join URL': { interviews: [{ teams_join_url: 'https://teams…' }] },
    // The Evalground import keeps the candidate's whole export row so the pack
    // can render their test properly. These are the parts of that row that must
    // not travel with the rest of it.
    'Evalground raw row': { assessments: [{ raw_row: { 'Contact Number': 8480000000 } }] },
    'Evalground recruiter tag': { assessments: [{ marked_as: 'Shortlisted' }] },
    'Evalground public report link': {
      assessments: [{ public_report_url: 'https://evalground.com/code4/#/candidatereport/2c6f9fd3' }],
    },
    'Evalground resume link': { assessments: [{ candidate_resume: 'https://docs.google.com/' }] },
    'Evalground candidate email': { assessments: [{ candidate_email: 'a@example.com' }] },
    'Evalground other assessments': { assessments: [{ previous_assessments: 'N/A' }] },
  };

  for (const [what, model] of Object.entries(forbidden)) {
    test(`throws on ${what}`, () => {
      assert.throws(
        () => assertNoForbiddenFields(model),
        /Dossier redaction violation/,
        `${what} must not be allowed into a dossier`,
      );
    });
  }

  test('the error names the path, so CI output points at the fix', () => {
    assert.throws(
      () => assertNoForbiddenFields({ scorecards: [{ hr: { hr_current_ctc: '18' } }] }),
      /model\.scorecards\[0\]\.hr\.hr_current_ctc/,
    );
  });

  test('the whole offer record is refused, not filtered field by field', () => {
    // getPipelineDetail() loads it; forwarding that object is the easy mistake.
    assert.throws(
      () => assertNoForbiddenFields({ journey: { offer: { joining_date: '2026-10-01' } } }),
      /whole "offer" record/,
    );
  });

  test('a null offer key is fine — absence is not a leak', () => {
    assert.doesNotThrow(() => assertNoForbiddenFields({ journey: { offer: null } }));
  });

  test('a clean, fully-populated model passes', () => {
    const model = {
      candidate: { name: 'Pankaj Mondal', position: 'Senior Java Developer' },
      profile: pickCvProfile(cvRow),
      position: { role: 'Senior Java Developer', mandatory_skills: 'Java, Spring' },
      stages: [{ stage_label: 'Tech 1', outcome: 'approved', decided_by: 'harish' }],
      scorecards: [{
        stage_label: 'Tech 1',
        recommendation: 'hire',
        avg_score: 4.2,
        skills: [{ label: 'Java', rating: 5, remark: 'Strong' }],
      }],
      recordings: [{ id: 7, stage_key: 'tech1', duration_seconds: 330, playable: true }],
      // The written test's breakdown, as fetchAssessments() renders it: the
      // candidate's own performance, and none of the row's contact columns.
      assessments: [{
        test_name: 'General Aptitude, Python, SQL MCQ Test',
        detail: {
          started_on: '27 Jul 2026, 15:59',
          duration: '37 minutes 27 seconds',
          totals: { correct: 55, wrong: 2, unattempted: 0 },
          sections: [{ label: 'Python', marks: 23, correct: 23, wrong: 1, unattempted: 0 }],
          topics: [{ label: 'Playwright', value: 6 }],
        },
      }],
    };
    assert.doesNotThrow(() => assertNoForbiddenFields(model));
  });
});

describe('isForbiddenKey — renames are caught too, not just today\'s columns', () => {
  test('catches CTC under any naming convention', () => {
    for (const key of ['ctc', 'current_ctc', 'CTC_LPA', 'expected_ctc_numeric', 'ctc_band']) {
      assert.equal(isForbiddenKey(key), true, `${key} should be forbidden`);
    }
  });

  test('catches vendor, budget, salary and token shapes', () => {
    for (const key of ['vendor_company', 'budget_range', 'salary_offered', 'share_token', 'access_tokens']) {
      assert.equal(isForbiddenKey(key), true, `${key} should be forbidden`);
    }
  });

  test('does not fire on innocent keys that merely contain the letters', () => {
    // A guard that rejects `contact_number` because it contains "ctc" would be
    // turned off within a week, and a disabled guard protects nothing.
    for (const key of ['contact_number', 'tokenizer_note', 'budgeting_skill', 'avendorish']) {
      assert.equal(isForbiddenKey(key), false, `${key} should be allowed`);
    }
  });
});

describe('redactionSummary — the modal, the pack and the audit say the same thing', () => {
  test('always names CTC, vendor, budget and offer terms', () => {
    const text = redactionSummary().join(' | ').toLowerCase();
    for (const claim of ['ctc', 'vendor', 'budget', 'offer']) {
      assert.ok(text.includes(claim), `the summary must mention ${claim}`);
    }
  });

  test('mentions withheld contact details only when they were withheld', () => {
    assert.ok(!redactionSummary().join(' ').toLowerCase().includes('phone number'));
    assert.ok(
      redactionSummary({ includeContactDetails: false }).join(' ').toLowerCase().includes('phone number'),
    );
  });
});
