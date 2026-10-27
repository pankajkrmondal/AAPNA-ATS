import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHANGE, ON_MERGE, comparable, compareCandidates, displayValue, matchedBy, summariseChanges,
} from '../../utils/duplicateCompare.js';

const existing = {
  Name: 'Priya Nair',
  EmailID: 'Priya.Nair@example.com',
  ContactNumber: '98450 12345',
  CurrentLocation: 'Pune',
  TotalExperienceYears: '4',
  CurrentCompany: JSON.stringify({ Name: 'Infosys', Website: 'infosys.com' }),
  Top5KeySkills: 'Java, Spring, SQL',
  ExpectedCTC_LPA: '12',
  employment_history: JSON.stringify({ companies: [{ CompanyName: 'Infosys', StartDate: '2021', EndDate: '' }] }),
  Gender: 'Female',
};
const incoming = {
  Name: 'Priya  Nair',
  EmailID: 'priya.nair@example.com, priya.n@gmail.com',
  ContactNumber: '+91 98450-12345',
  CurrentLocation: 'Bengaluru',
  TotalExperienceYears: '4.0',
  CurrentCompany: JSON.stringify({ Name: 'TCS' }),
  Top5KeySkills: 'SQL, java, Spring',
  ExpectedCTC_LPA: null,
  LinkedInProfile: 'linkedin.com/in/priya',
  employment_history: JSON.stringify({ companies: [{ CompanyName: 'TCS', StartDate: '2024' }, { CompanyName: 'Infosys', StartDate: '2021', EndDate: '2024' }] }),
};

const byField = (rows) => Object.fromEntries(rows.map((r) => [r.field, r]));

describe('compareCandidates (L09)', () => {
  const rows = byField(compareCandidates(existing, incoming));

  test('formatting differences are not changes', () => {
    assert.equal(rows.Name.change, CHANGE.SAME, 'double space');
    assert.equal(rows.TotalExperienceYears.change, CHANGE.SAME, '4 vs 4.0');
    assert.equal(rows.Top5KeySkills.change, CHANGE.SAME, 'order and case');
    assert.equal(rows.ContactNumber.change, CHANGE.SAME, '+91 and dashes');
  });

  test('real differences are updates, and Merge replaces them', () => {
    assert.equal(rows.CurrentLocation.change, CHANGE.UPDATED);
    assert.equal(rows.CurrentLocation.on_merge, ON_MERGE.REPLACED);
    assert.equal(rows.CurrentCompany.existing, 'Infosys');
    assert.equal(rows.CurrentCompany.incoming, 'TCS');
    assert.equal(rows.employment_history.change, CHANGE.UPDATED);
  });

  test('a value only the new resume has is added', () => {
    assert.equal(rows.LinkedInProfile.change, CHANGE.ADDED);
    assert.equal(rows.LinkedInProfile.on_merge, ON_MERGE.ADDED);
  });

  test('a value missing from the new resume is kept, not wiped', () => {
    assert.equal(rows.ExpectedCTC_LPA.change, CHANGE.NOT_IN_NEW);
    assert.equal(rows.ExpectedCTC_LPA.on_merge, ON_MERGE.KEPT);
    assert.equal(rows.Gender.change, CHANGE.NOT_IN_NEW);
  });

  test('emails and phones are combined on merge, never replaced', () => {
    assert.equal(rows.EmailID.change, CHANGE.UPDATED);
    assert.equal(rows.EmailID.on_merge, ON_MERGE.COMBINED);
    assert.equal(rows.ContactNumber.on_merge, ON_MERGE.KEPT, 'nothing new to add');
  });

  test('fields neither side has are left out', () => {
    assert.equal(rows.HighestQualification, undefined);
  });

  test('with no existing record every field is an addition', () => {
    const only = compareCandidates(null, incoming);
    assert.ok(only.every((r) => r.change === CHANGE.ADDED || r.change === CHANGE.NOT_IN_NEW));
    assert.ok(only.every((r) => r.existing === ''));
  });

  test('the summary counts each kind', () => {
    const s = summariseChanges(compareCandidates(existing, incoming));
    assert.ok(s.same >= 4 && s.updated >= 3 && s.added >= 1 && s.not_in_new >= 2);
  });
});

describe('display and comparison helpers', () => {
  test('employment history reads as one line per job', () => {
    assert.equal(
      displayValue('history', incoming.employment_history),
      'TCS (2024 – present)\nInfosys (2021 – 2024)',
    );
  });

  test('phones compare on the last ten digits', () => {
    assert.equal(comparable('phones', '+91 98450-12345'), comparable('phones', '9845012345'));
  });

  test('matchedBy names the keys that matched', () => {
    assert.deepEqual(matchedBy(existing, incoming), ['email', 'phone']);
    assert.deepEqual(matchedBy(existing, { EmailID: 'other@x.com', ContactNumber: '9845012345' }), ['phone']);
    assert.deepEqual(matchedBy(null, incoming), []);
  });
});
