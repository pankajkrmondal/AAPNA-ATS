/**
 * Keeping the pipeline's copy of a candidate's name/email in step with the
 * candidate record (N29). Pure — no database.
 * Run: node --test src/tests/unit/candidateSync.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { shortlistIdentityPatch, touchesEmbeddedFields } from '../../utils/candidateSync.js';

const ROW = { candidate_name: 'Ravi Kumar', candidate_email: 'ravi@old.com', candidate_email_all: null };

describe('shortlistIdentityPatch', () => {
  test('a renamed candidate: the copy takes the new name, nothing else', () => {
    assert.deepEqual(shortlistIdentityPatch(ROW, { Name: 'Ravi K. Sharma', EmailID: 'ravi@old.com' }), {
      candidate_name: 'Ravi K. Sharma',
    });
  });

  test('a new email: the copy takes it and keeps the old one for inbox matching', () => {
    assert.deepEqual(shortlistIdentityPatch(ROW, { Name: 'Ravi Kumar', EmailID: 'ravi@new.com' }, ['ravi@old.com']), {
      candidate_email: 'ravi@new.com',
      candidate_email_all: 'ravi@old.com',
    });
  });

  test('an appended address (upload merge) keeps both in the primary, none duplicated in _all', () => {
    const patch = shortlistIdentityPatch(ROW, { Name: 'Ravi Kumar', EmailID: 'ravi@old.com, ravi@work.com' });
    assert.equal(patch.candidate_email, 'ravi@old.com, ravi@work.com');
    assert.equal('candidate_email_all' in patch, false, 'old address is still in the primary');
  });

  test('already in step: no write', () => {
    assert.deepEqual(shortlistIdentityPatch(ROW, { Name: 'Ravi Kumar', EmailID: 'ravi@old.com' }), {});
  });

  test('a blank record never blanks the copy (its columns are NOT NULL)', () => {
    assert.deepEqual(shortlistIdentityPatch(ROW, { Name: '  ', EmailID: null }), {});
  });

  test('extra addresses are only ever added to, never rewritten', () => {
    const listed = { ...ROW, candidate_email_all: 'Ravi@Personal.com; ravi@old.com' };
    const patch = shortlistIdentityPatch(listed, { Name: 'Ravi Kumar', EmailID: 'ravi@new.com' }, ['RAVI@old.com']);
    assert.equal('candidate_email_all' in patch, false, 'the old address is already listed (any case)');

    const another = { ...ROW, candidate_email_all: 'Ravi@Personal.com' };
    assert.equal(
      shortlistIdentityPatch(another, { Name: 'Ravi Kumar', EmailID: 'ravi@new.com' }).candidate_email_all,
      'Ravi@Personal.com, ravi@old.com',
      'existing text kept as written, the replaced address appended',
    );
  });

  test('an in-step row whose extra list repeats the primary is left alone', () => {
    const row = { ...ROW, candidate_email_all: 'ravi@old.com' };
    assert.deepEqual(shortlistIdentityPatch(row, { Name: 'Ravi Kumar', EmailID: 'ravi@old.com' }), {});
  });
});

describe('touchesEmbeddedFields: re-embed only when search would change', () => {
  const before = { Name: 'A', ContactNumber: '9', Top5KeySkills: 'Java', TotalExperienceYears: '3' };

  test('a name or phone fix does not', () => {
    assert.equal(touchesEmbeddedFields(before, { Name: 'B', ContactNumber: '8' }), false);
  });

  test('a skills or experience change does', () => {
    assert.equal(touchesEmbeddedFields(before, { Top5KeySkills: 'Java, Go' }), true);
    assert.equal(touchesEmbeddedFields(before, { TotalExperienceYears: '4' }), true);
  });

  test('resending the same value does not', () => {
    assert.equal(touchesEmbeddedFields(before, { Top5KeySkills: 'Java' }), false);
  });
});
