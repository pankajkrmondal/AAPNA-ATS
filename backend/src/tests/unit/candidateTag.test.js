/**
 * JD tagging rules (Phase 3 section B, N13) and the "can this JD take
 * candidates" check shared by shortlist, upload and Change JD (N21 hardening).
 * Pure — no database.
 * Run: node --test src/tests/unit/candidateTag.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TAG_SOURCES, UPLOAD_TAG_SOURCES, isTagSource, tagSourceForShortlist, tagSourceForUpload,
  parseMrfId, actorColumns, mrfCandidateBlock,
} from '../../utils/candidateTag.js';

test('every source matches the DDL CHECK list', () => {
  assert.deepEqual(
    Object.values(TAG_SOURCES).sort(),
    ['backfill', 'change_jd', 'hr_manual_upload', 'move', 'search_candidate', 'shortlist', 'vendor_portal'],
  );
  assert.equal(isTagSource('shortlist'), true);
  assert.equal(isTagSource('email_intake'), false);
  assert.deepEqual([...UPLOAD_TAG_SOURCES], ['hr_manual_upload', 'vendor_portal']);
});

test('Add to JD is told apart from a Screening shortlist', () => {
  assert.equal(tagSourceForShortlist('search_candidate'), 'search_candidate');
  assert.equal(tagSourceForShortlist('jd'), 'shortlist');
  assert.equal(tagSourceForShortlist('keyword'), 'shortlist');
  assert.equal(tagSourceForShortlist(null), 'shortlist');
});

test('only HR and vendor uploads tag; Outlook intake never does', () => {
  assert.equal(tagSourceForUpload('hr_manual_upload'), 'hr_manual_upload');
  assert.equal(tagSourceForUpload('vendor_portal'), 'vendor_portal');
  assert.equal(tagSourceForUpload('email_intake'), null);
  assert.equal(tagSourceForUpload(undefined), null);
});

test('an MRF id from a form field: blank, 0 and junk mean "no JD"', () => {
  assert.equal(parseMrfId('42'), 42n);
  assert.equal(parseMrfId(42), 42n);
  assert.equal(parseMrfId(' 7 '), 7n);
  for (const v of [null, undefined, '', '0', 0, '-3', 'abc', '4.5', 'null']) {
    assert.equal(parseMrfId(v), null, `"${v}" should be no JD`);
  }
});

test('who tagged: a logged-in user, a name, or nobody', () => {
  assert.deepEqual(actorColumns({ id: 5, username: 'harish' }), { tagged_by: 'harish', tagged_by_id: 5 });
  assert.deepEqual(actorColumns({ email: 'v@x.com' }), { tagged_by: 'v@x.com', tagged_by_id: null });
  assert.deepEqual(actorColumns('vendor@x.com'), { tagged_by: 'vendor@x.com', tagged_by_id: null });
  assert.deepEqual(actorColumns(null), { tagged_by: null, tagged_by_id: null });
  assert.equal(actorColumns('x'.repeat(300)).tagged_by.length, 255);
});

const open = { id: 9n, position_hiring_for: 'QA Engineer', approval_status: 'approved', approved_by_abhijit: null, filled_at: null, closed_at: null };

test('an approved, open MRF takes candidates', () => {
  assert.equal(mrfCandidateBlock(open, 9), null);
  assert.equal(mrfCandidateBlock({ ...open, approval_status: 'completed', approved_by_abhijit: 'approved' }, 9), null);
  assert.equal(mrfCandidateBlock({ ...open, approval_status: 'completed', approved_by_abhijit: 'true' }, 9), null);
});

test('a missing, unapproved or closed MRF is refused with a reason', () => {
  assert.equal(mrfCandidateBlock(null, 9).status, 404);
  for (const status of ['waiting', 'pending', 'rejected']) {
    const block = mrfCandidateBlock({ ...open, approval_status: status }, 9);
    assert.equal(block.status, 409);
    assert.match(block.message, /not approved/);
  }
  assert.match(mrfCandidateBlock({ ...open, approval_status: 'completed', approved_by_abhijit: null }, 9).message, /not approved/);
  assert.match(mrfCandidateBlock({ ...open, closed_at: new Date() }, 9).message, /"QA Engineer" \(MRF-9\) is closed/);
  assert.match(mrfCandidateBlock({ ...open, filled_at: new Date() }, 9).message, /is closed/);
});

test('a legacy row closed by the old path reads as closed, not unapproved', () => {
  assert.match(mrfCandidateBlock({ ...open, approval_status: 'closed' }, 9).message, /is closed/);
});
