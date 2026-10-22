/**
 * Unit tests for the vendor half of the Q5 dual-notification (Phase 3 M6).
 * Run: npm run test:unit
 *
 * No network, no DB. These cover the rules that decide whether an outside
 * company hears about a candidate at all, and what they are allowed to be told
 * — the two questions the M6 audit found were answered only by comments.
 *
 * The audit's headline finding was that the dual-send had never fired once:
 * vendorCcFor() gated on `pipeline.source === 'vendor'`, and nothing in the
 * codebase ever wrote that value. Tests here pin both halves of the fix so it
 * cannot silently revert to dead code again.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  VENDOR_LOCK_DAYS,
  VENDOR_LOCK_FROZEN,
  vendorLockExpiry,
  isVendorLockActive,
  isVendorLockFrozen,
  activeVendorFor,
} from '../utils/vendorLock.js';
import {
  VENDOR_STAGE_POLICY,
  vendorPolicyForStage,
  vendorForJourney,
} from '../services/vendorNotification.service.js';
import { STAGE_KEYS } from '../config/pipelineStages.js';

/** A fixed "now" so nothing here depends on the day the suite runs. */
const NOW = new Date('2026-08-12T09:00:00.000Z');
const daysFromNow = (n) => {
  const d = new Date(NOW.getTime());
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// ── The 90-day lock: who owns a candidate right now ───────────────────

describe('vendor lock window', () => {
  test('a lock expiring in the future is active', () => {
    assert.equal(isVendorLockActive(daysFromNow(30), NOW), true);
  });

  test('a lock that expired yesterday is not active', () => {
    assert.equal(isVendorLockActive(daysFromNow(-1), NOW), false);
  });

  test('the window is INCLUSIVE of its final day', () => {
    // VENDOR_PROCESS.md §8 says "true while today <= expiry". The stamp is a
    // calendar date with no time component, so an exclusive comparison would
    // silently cut the last day off every lock.
    assert.equal(isVendorLockActive(daysFromNow(0), NOW), true);
  });

  test('a fresh stamp lands exactly VENDOR_LOCK_DAYS out and is active', () => {
    const expiry = vendorLockExpiry(NOW);
    assert.equal(expiry, daysFromNow(VENDOR_LOCK_DAYS));
    assert.equal(isVendorLockActive(expiry, NOW), true);
  });

  test('a missing or malformed lock is never active', () => {
    // Fails CLOSED. A candidate with no usable lock is unowned, so nobody is
    // emailed about them — the safe direction when the data is unreadable.
    for (const bad of [null, undefined, '', 'not-a-date', '12/08/2026', '2026-13-45x']) {
      assert.equal(isVendorLockActive(bad, NOW), false, `expected ${JSON.stringify(bad)} to be inactive`);
    }
  });

  test('a Date object is accepted as well as the stored string', () => {
    // Defensive: a `prisma db pull` that retypes the TEXT column must not
    // silently disable every lock in the system.
    const future = new Date(NOW.getTime());
    future.setUTCDate(future.getUTCDate() + 10);
    assert.equal(isVendorLockActive(future, NOW), true);
  });
});

// ── The frozen lock: a placed candidate stays attributed ──────────────

describe('frozen lock (candidate joined)', () => {
  test('a frozen lock never expires', () => {
    assert.equal(isVendorLockActive(VENDOR_LOCK_FROZEN, NOW), true);
    assert.equal(isVendorLockActive(VENDOR_LOCK_FROZEN, new Date('2099-01-01T00:00:00.000Z')), true);
  });

  test('frozen is recognisable as such, not just as a long lock', () => {
    assert.equal(isVendorLockFrozen(VENDOR_LOCK_FROZEN), true);
    assert.equal(isVendorLockFrozen(daysFromNow(30)), false);
    assert.equal(isVendorLockFrozen(null), false);
  });
});

// ── activeVendorFor: attribution + live lock, both required ───────────

describe('activeVendorFor', () => {
  test('returns the vendor when attributed and the lock is live', () => {
    const owner = activeVendorFor(
      { VendorEmail: 'talent@partner.example', vendorName: 'Partner Co', lockForNinetyDays: daysFromNow(45) },
      NOW,
    );
    assert.equal(owner.vendorEmail, 'talent@partner.example');
    assert.equal(owner.vendorName, 'Partner Co');
  });

  test('returns null once the lock has lapsed, even though attribution remains', () => {
    // This is the 2026-07-22 leak in miniature: a candidate uploaded by a vendor
    // years ago, found later by keyword search. The column still names them; the
    // claim is long gone.
    const owner = activeVendorFor(
      { VendorEmail: 'talent@partner.example', vendorName: 'Partner Co', lockForNinetyDays: daysFromNow(-400) },
      NOW,
    );
    assert.equal(owner, null);
  });

  test('returns null with a live lock but no vendor email', () => {
    assert.equal(activeVendorFor({ VendorEmail: '', lockForNinetyDays: daysFromNow(45) }, NOW), null);
    assert.equal(activeVendorFor({ lockForNinetyDays: daysFromNow(45) }, NOW), null);
  });

  test('tolerates a null candidate row', () => {
    assert.equal(activeVendorFor(null, NOW), null);
    assert.equal(activeVendorFor(undefined, NOW), null);
  });
});

// ── vendorForJourney: the gate that used to be dead ───────────────────

describe('vendorForJourney', () => {
  test("a journey with source 'vendor' yields its vendor", () => {
    assert.equal(
      vendorForJourney({ source: 'vendor', vendor_email: 'talent@partner.example' }),
      'talent@partner.example',
    );
  });

  test('a non-vendor journey yields nothing even carrying a vendor_email', () => {
    // The stale-column case RT reported. `source` is the authority because
    // createPipelineJourney only sets it after checking a live lock.
    assert.equal(
      vendorForJourney({ source: 'screening_shortlist', vendor_email: 'talent@partner.example' }),
      null,
    );
  });

  test("source 'vendor' with no address yields nothing", () => {
    assert.equal(vendorForJourney({ source: 'vendor', vendor_email: null }), null);
    assert.equal(vendorForJourney({ source: 'vendor', vendor_email: '   ' }), null);
  });
});

// ── The disclosure matrix (Q5 / Q29) ──────────────────────────────────

describe('per-stage disclosure policy', () => {
  test('the Documents stage never notifies a vendor', () => {
    // Q5, and the reason documentCollection.service.js touches no vendor path:
    // the whole stage is the candidate's personal paperwork.
    assert.equal(vendorPolicyForStage(STAGE_KEYS.DOCUMENTS), 'never');
  });

  test('the Offer stage discloses a milestone only', () => {
    // Q29, answered 2026-08-12: the vendor learns an offer happened, never
    // what was in it.
    assert.equal(vendorPolicyForStage(STAGE_KEYS.OFFER), 'bare');
  });

  test('every other stage discloses normally', () => {
    const ordinary = [
      STAGE_KEYS.ZEKO_HR, STAGE_KEYS.ASSESSMENT, STAGE_KEYS.ZEKO_FUNCTIONAL,
      STAGE_KEYS.TECH1, STAGE_KEYS.TECH2, STAGE_KEYS.TECH3,
      STAGE_KEYS.HR_ROUND, STAGE_KEYS.CEO, STAGE_KEYS.CLIENT,
    ];
    for (const stage of ordinary) {
      assert.equal(vendorPolicyForStage(stage), 'standard', `expected ${stage} to disclose normally`);
    }
  });

  test('an unknown or newly-added stage discloses normally', () => {
    // Deliberate: a stage an admin adds through PipelineConfigPanel is an
    // ordinary interview round, and silence would be the surprising default.
    // Anything genuinely sensitive has to be added to VENDOR_STAGE_POLICY, which
    // is the explicit act this test documents.
    assert.equal(vendorPolicyForStage('some_new_admin_stage'), 'standard');
    assert.equal(vendorPolicyForStage(undefined), 'standard');
  });

  test('the sensitive-stage list is exactly Documents and Offer', () => {
    // Pinned as a literal so widening it — or, more dangerously, narrowing it —
    // fails here and forces a second pair of eyes, the same technique
    // emailRecipients.test.js uses for the redirect-bypass set.
    assert.deepEqual(
      Object.keys(VENDOR_STAGE_POLICY).sort(),
      ['documents', 'offer'],
    );
  });
});

// ── Structural guarantee: no candidate body can reach a vendor ────────

describe('vendor sends are generated, never forwarded', () => {
  test('notifyVendor accepts no caller-supplied copy', async () => {
    // The whole point of M6's redesign. The old cc put the candidate's own
    // email — including anything a recruiter typed into the outcome modal or
    // the ad-hoc box — in front of the vendor. Every word a vendor receives is
    // now generated inside this module from a template plus a fixed status
    // vocabulary, so adding a text parameter here would quietly reopen the leak.
    //
    // Checks the PARAMETER list only: the function naturally holds a compiled
    // `bodyHtml` local, which is generated copy, not forwarded copy.
    const { notifyVendor } = await import('../services/vendorNotification.service.js');
    const params = notifyVendor.toString().slice(0, notifyVendor.toString().indexOf('}) {') + 1);

    for (const banned of ['subject', 'body', 'html', 'message', 'text', 'notes', 'remarks']) {
      assert.ok(
        !params.includes(banned),
        `notifyVendor must not accept a "${banned}" parameter — vendor copy is generated, never passed in`,
      );
    }
    // ...and it does take the structured inputs it builds that copy from.
    for (const expected of ['pipelineRow', 'eventType', 'stageKey', 'outcomeKey']) {
      assert.ok(params.includes(expected), `notifyVendor should accept "${expected}"`);
    }
  });

  test('the candidate dispatcher no longer accepts a vendor address', async () => {
    // sendStageOutcomeEmail and sendAdHocCandidateEmail used to cc a vendor.
    // Nothing in that file should mention one now — the vendor path left.
    const { sendStageOutcomeEmail, sendAdHocCandidateEmail } = await import('../services/stageNotification.service.js');
    for (const fn of [sendStageOutcomeEmail, sendAdHocCandidateEmail]) {
      assert.ok(!fn.toString().includes('vendorEmail'), `${fn.name} must not take a vendor address`);
    }
  });
});
