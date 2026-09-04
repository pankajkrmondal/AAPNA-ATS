/**
 * referral.test.js — the pure rules behind the referral flag.
 *
 * DB-free on purpose, the same constraint dossierRedaction.test.js documents for
 * itself: these are the rules a reviewer should be able to check without a
 * database, and `npm run test:unit` must be able to run them anywhere.
 *
 * The transactional behaviour (candidate row + audit row, never one without the
 * other) is exercised separately against a real database — it cannot be asserted
 * here and pretending otherwise would be worse than not testing it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeReferrer,
  actorDisplayName,
  REFERRAL_ACTION,
} from '../../services/referral.service.js';
import { isForbiddenKey } from '../../utils/dossierRedaction.js';
import { requireStaff, requireAdmin } from '../../middleware/auth.js';
import { isVendor } from '../../utils/vendorScope.js';
// From utils, NOT from candidate.service.js: importing the service to reach this
// rule drags in Prisma, the socket layer and the Gemini parsing chain, which is
// the exact trap vendorScope.js was extracted to escape.
import { mapReferralFields } from '../../utils/referralView.js';
import { describeShareLink } from '../../utils/recordingShareModel.js';

/** Run a gate middleware and report what it did: null = allowed, else the error. */
async function runGate(gate, user) {
  let err = null;
  let passed = false;
  await gate({ user }, {}, (e) => { if (e) err = e; else passed = true; });
  return { passed, err };
}

describe('normalizeReferrer', () => {
  test('trims and collapses whitespace', () => {
    assert.equal(normalizeReferrer('  Anuj  '), 'Anuj');
    assert.equal(normalizeReferrer('anuj   k'), 'anuj k');
    assert.equal(normalizeReferrer('Anuj\tKumar\n'), 'Anuj Kumar');
  });

  test('does NOT case-fold — these are people\'s names', () => {
    // Lower-casing in storage would look like a bug on every screen showing one.
    // Reports group case-insensitively instead; that is a display decision.
    assert.equal(normalizeReferrer('Anuj Kumar'), 'Anuj Kumar');
    assert.equal(normalizeReferrer('ANUJ'), 'ANUJ');
  });

  test('whitespace-only and nullish become the empty string', () => {
    // The caller treats '' as "no referrer given" and refuses the write: a
    // referral flag with nobody attached cannot be checked or investigated.
    assert.equal(normalizeReferrer('   '), '');
    assert.equal(normalizeReferrer(''), '');
    assert.equal(normalizeReferrer(null), '');
    assert.equal(normalizeReferrer(undefined), '');
  });
});

describe('actorDisplayName', () => {
  test('prefers the full name', () => {
    assert.equal(
      actorDisplayName({ first_name: 'Chhaya', last_name: 'S', username: 'chhaya', email: 'c@x.com' }),
      'Chhaya S',
    );
  });

  test('falls back through username then email', () => {
    assert.equal(actorDisplayName({ username: 'chhaya', email: 'c@x.com' }), 'chhaya');
    assert.equal(actorDisplayName({ email: 'c@x.com' }), 'c@x.com');
  });

  test('never returns empty — acted_by_name is NOT NULL', () => {
    // An audit row that cannot name who acted is not worth writing, so the
    // schema forbids it and this must never hand back something that violates it.
    assert.equal(actorDisplayName({}), 'Unknown user');
    assert.equal(actorDisplayName(null), 'Unknown user');
    assert.equal(actorDisplayName({ first_name: '  ', last_name: '  ' }), 'Unknown user');
  });
});

describe('audit actions match the database CHECK constraint', () => {
  test('exactly three, and they are the constrained values', () => {
    // chk_referral_audit_action allows only these. A fourth added here without
    // the DDL would fail at runtime with a constraint violation, not a type error.
    assert.deepEqual(
      Object.values(REFERRAL_ACTION).sort(),
      ['marked', 'removed', 'updated'],
    );
  });
});

describe('the referral must never reach a candidate dossier', () => {
  // The dossier is emailed to interviewers with no ATS account, which is exactly
  // the audience Sanghamitra ruled out: "none of the interview process should
  // know". dossierRedaction.js is the guard; these assert it covers the new
  // columns, so a future dossier that picked one up fails in CI rather than in a
  // stranger's inbox.
  for (const key of [
    'is_referral',
    'referred_by',
    'referral_note',
    'referral_set_by',
    'referral_set_at',
  ]) {
    test(`${key} is a forbidden dossier key`, () => {
      assert.equal(isForbiddenKey(key), true, `${key} must be refused by the dossier guard`);
    });
  }

  test('the audit table\'s own columns are refused too', () => {
    assert.equal(isForbiddenKey('old_referred_by'), true);
    assert.equal(isForbiddenKey('new_referred_by'), true);
  });

  test('an innocent word containing "refer" is not swept up', () => {
    // A guard that rejects ordinary names is a guard somebody turns off — the
    // same reasoning dossierRedaction.js gives for not banning `contact_number`.
    assert.equal(isForbiddenKey('reference_id'), false);
    // THE one that matters: "p-REFERR-ed" contains the substring. An unanchored
    // /referr/i would strip PreferredShift out of every dossier — it is a
    // whitelisted profile field, so the guard would be deleting real content.
    assert.equal(isForbiddenKey('preferred_shift'), false);
    assert.equal(isForbiddenKey('PreferredShift'), false);
  });
});

describe('vendors never see the flag', () => {
  test('isVendor identifies exactly the vendor role', () => {
    assert.equal(isVendor({ role: 'vendor' }), true);
    assert.equal(isVendor({ role: 'VENDOR' }), true);
    for (const role of ['recruiter', 'hr', 'admin', 'superadmin']) {
      assert.equal(isVendor({ role }), false, `${role} is not a vendor`);
    }
    assert.equal(isVendor(undefined), false);
  });

  test('a row with the referral columns omitted maps to "not a referral"', () => {
    // For a vendor caller the columns are dropped from the QUERY, so the row
    // simply has no such keys. mapCandidate must read that as false, not as
    // undefined leaking through — absence has to fail CLOSED, because the one
    // outcome this feature exists to prevent is showing a referral to someone
    // who should not see it.
    const asVendorSees = mapReferralFields({ id: 1n, Name: 'A' });
    assert.equal(asVendorSees.isReferral, false);
    assert.equal(asVendorSees.referredBy, '');
    assert.equal(asVendorSees.referralNote, '');
    assert.equal(asVendorSees.referralSetAt, null);
  });

  test('a null row is also "not a referral", never a throw', () => {
    assert.equal(mapReferralFields(null).isReferral, false);
    assert.equal(mapReferralFields(undefined).isReferral, false);
  });

  test('a staff row maps the real values through', () => {
    const asStaffSees = mapReferralFields({
      is_referral: true, referred_by: 'Anuj Kumar', referral_note: 'ex-colleague',
    });
    assert.equal(asStaffSees.isReferral, true);
    assert.equal(asStaffSees.referredBy, 'Anuj Kumar');
    assert.equal(asStaffSees.referralNote, 'ex-colleague');
  });
});

describe('the recording share link never carries candidate context', () => {
  test('describeShareLink names its fields and spreads nothing', () => {
    // The public /recording-share/:token page is the only route that serves
    // media to someone with no account. It carries no candidate context today,
    // and this pins that: handed a link row joined with the candidate — which is
    // exactly how a future "show whose interview this is" change would arrive —
    // the serializer must still emit only its four named fields.
    const out = describeShareLink({
      expires_at: new Date(Date.now() + 86400000),
      revoked_at: null,
      view_count: 2,
      // Everything below is what a careless join would drag in.
      candidate_name: 'Some Candidate',
      is_referral: true,
      referred_by: 'Anuj Kumar',
    });

    assert.deepEqual(Object.keys(out).sort(), ['state', 'summary', 'unusual', 'views']);
    assert.equal(/referr/i.test(JSON.stringify(out)), false);
    assert.equal(JSON.stringify(out).includes('Anuj'), false);
  });
});

describe('who may set and who may remove', () => {
  // The decision (2026-09-04): any recruiter may SET a referral; only admin-tier
  // may REMOVE one. Removing erases the referrer's name from the candidate, so
  // it is the action worth constraining. These assert the gates the routes use,
  // because the disabled control in the modal binds a browser, not a token.
  const vendor = { id: 1, role: 'vendor' };
  const recruiter = { id: 2, role: 'recruiter' };
  const legacyHr = { id: 3, role: 'hr' };
  const admin = { id: 4, role: 'admin' };
  const superadmin = { id: 5, role: 'superadmin' };

  test('requireStaff (set/read) admits recruiter, legacy hr, admin, superadmin', async () => {
    for (const u of [recruiter, legacyHr, admin, superadmin]) {
      const { passed } = await runGate(requireStaff, u);
      assert.equal(passed, true, `${u.role} should be able to set a referral`);
    }
  });

  test('requireStaff refuses vendor — the flag is internal', async () => {
    const { passed, err } = await runGate(requireStaff, vendor);
    assert.equal(passed, false);
    assert.equal(err?.statusCode, 403);
  });

  test('requireStaff refuses an unauthenticated request', async () => {
    const { passed, err } = await runGate(requireStaff, undefined);
    assert.equal(passed, false);
    assert.equal(err?.statusCode, 401);
  });

  test('requireAdmin (remove) admits ONLY admin-tier', async () => {
    for (const u of [admin, superadmin]) {
      const { passed } = await runGate(requireAdmin, u);
      assert.equal(passed, true, `${u.role} should be able to remove a referral`);
    }
  });

  test('requireAdmin refuses a recruiter — this is the whole point', async () => {
    for (const u of [recruiter, legacyHr, vendor]) {
      const { passed, err } = await runGate(requireAdmin, u);
      assert.equal(passed, false, `${u.role} must not be able to remove a referral`);
      assert.equal(err?.statusCode, 403);
    }
  });
});
