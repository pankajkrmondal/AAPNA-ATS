/**
 * Unit tests for vendor data isolation (Phase 3 M6).
 * Run: npm run test:unit
 *
 * No network, no DB — these exercise the pure guard functions and read the
 * route files as text.
 *
 * The M6 audit found the Candidate Pipeline, Candidate Screening and HR Upload
 * routes guarded by checkModuleAccess() alone. A module toggle answers "was this
 * switched on for this user?", not "should this role ever have it" — so one
 * mis-clicked checkbox on a vendor account in the Admin Portal exposed the whole
 * board: every candidate, every MRF, plus the outcome/closure/offer/document
 * write endpoints. The frontend confines vendors to /vendor-dashboard and
 * /vendor, but that binds a browser, not a token.
 *
 * Same shape as the CSV-export hole closed in b671236.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { requireStaff } from '../middleware/auth.js';
// From utils, not candidate.service.js: the service pulls in prisma and the
// socket layer, whose open handles keep the test runner alive after the
// assertions finish. Same function either way — the service re-exports this one.
import { enforceVendorScope } from '../utils/vendorScope.js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Runs a middleware and reports what it passed to next(). */
function runGuard(middleware, user) {
  let result;
  middleware({ user }, {}, (err) => { result = err; });
  return result;
}

// ── requireStaff: the role floor ──────────────────────────────────────

describe('requireStaff', () => {
  test('refuses a vendor', () => {
    const err = runGuard(requireStaff, { role: 'vendor' });
    assert.ok(err, 'a vendor must be refused');
    assert.equal(err.statusCode, 403);
  });

  test('admits every internal-staff role, including the legacy hr alias', () => {
    for (const role of ['recruiter', 'hr', 'admin', 'superadmin']) {
      assert.equal(runGuard(requireStaff, { role }), undefined, `${role} must be admitted`);
    }
  });

  test('is case-insensitive, matching how roles are compared elsewhere', () => {
    assert.ok(runGuard(requireStaff, { role: 'Vendor' }), 'casing must not defeat the guard');
    assert.equal(runGuard(requireStaff, { role: 'ADMIN' }), undefined);
  });

  test('refuses an unauthenticated request', () => {
    const err = runGuard(requireStaff, undefined);
    assert.ok(err);
    assert.equal(err.statusCode, 401);
  });

  test('refuses an unrecognised role rather than defaulting it open', () => {
    // Rank-based, so a future low-privilege role is denied until it is
    // deliberately given a rank — the opposite of a hardcoded deny-list, which
    // fails open for anything nobody remembered to add.
    const err = runGuard(requireStaff, { role: 'some_future_role' });
    assert.ok(err);
    assert.equal(err.statusCode, 403);
  });
});

// ── The routes that must carry the floor ──────────────────────────────

describe('staff-only route files', () => {
  const GUARDED_ROUTES = ['pipeline.routes.js', 'screening.routes.js', 'hrUpload.routes.js'];

  for (const file of GUARDED_ROUTES) {
    test(`${file} applies requireStaff at the router level`, () => {
      const src = fs.readFileSync(path.join(SRC, 'routes', file), 'utf8');
      assert.ok(src.includes('requireStaff'), `${file} must import and apply requireStaff`);
      assert.ok(
        /router\.use\(\s*requireStaff\s*\)/.test(src),
        `${file} must apply requireStaff to the whole router, not one route`,
      );
    });
  }

  test('the vendor routes do NOT carry the floor — vendors legitimately use them', () => {
    // Guards against an over-eager sweep: /api/vendor/* is the surface vendors
    // are supposed to reach, and locking it to staff would take the portal away
    // from the people it exists for.
    const src = fs.readFileSync(path.join(SRC, 'routes', 'vendor.routes.js'), 'utf8');
    assert.ok(!src.includes('requireStaff'), 'vendor.routes.js must stay reachable by vendors');
    assert.ok(src.includes("restrictTo('vendor'"), 'vendor.routes.js must still admit the vendor role');
  });
});

// ── enforceVendorScope: a vendor cannot widen their own query ─────────

describe('enforceVendorScope', () => {
  const VENDOR = { role: 'vendor', email: 'talent@partner.example' };

  test("overwrites whatever vendorEmail the client asked for", () => {
    // Without this a vendor token could name another vendor — or omit the
    // parameter entirely — and read the whole candidate table.
    const scoped = enforceVendorScope({ vendorEmail: 'rival@other.example' }, VENDOR);
    assert.equal(scoped.vendorEmail, 'talent@partner.example');
  });

  test('fills in the scope when the client omits it', () => {
    const scoped = enforceVendorScope({}, VENDOR);
    assert.equal(scoped.vendorEmail, 'talent@partner.example');
  });

  test('forces vendorOnly off, so the all-vendors overview cannot be requested', () => {
    const scoped = enforceVendorScope({ vendorOnly: true }, VENDOR);
    assert.equal(scoped.vendorOnly, false);
  });

  test('leaves staff queries untouched — they legitimately query across vendors', () => {
    for (const role of ['recruiter', 'admin', 'superadmin', 'hr']) {
      const scoped = enforceVendorScope({ vendorEmail: 'someone@partner.example', vendorOnly: true }, { role, email: 'staff@aapnainfotech.com' });
      assert.equal(scoped.vendorEmail, 'someone@partner.example');
      assert.equal(scoped.vendorOnly, true);
    }
  });

  test('does not mutate the caller\'s filters object', () => {
    const original = { vendorEmail: 'rival@other.example', vendorOnly: true };
    enforceVendorScope(original, VENDOR);
    assert.equal(original.vendorEmail, 'rival@other.example');
    assert.equal(original.vendorOnly, true);
  });
});

// ── M4: documents never reach a vendor, by construction ───────────────

describe('document collection stays vendor-free', () => {
  test('documentCollection.service.js references no vendor address anywhere', () => {
    // Q5's strictest rule, and the one most easily broken by a well-meaning
    // "notify the vendor too" edit. The service currently states this in a
    // comment; this makes it checkable.
    const src = fs.readFileSync(path.join(SRC, 'services', 'documentCollection.service.js'), 'utf8');
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')  // block comments
      .replace(/\/\/.*$/gm, '');          // line comments
    for (const banned of ['vendor_email', 'vendorEmail', 'notifyVendor']) {
      assert.ok(!code.includes(banned), `documentCollection.service.js must not reference ${banned}`);
    }
  });
});
