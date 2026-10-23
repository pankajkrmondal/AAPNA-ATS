/**
 * The role model, and the HR Admin Recruiter role in particular.
 *
 * Run: node --test src/tests/unit/roles.test.js
 *
 * hr_admin_recruiter is a Recruiter plus a few MRF extras. Two things are cheap
 * to break and expensive to get wrong:
 *   1. It must pass every check a recruiter passes. Many checks are role LISTS,
 *      so a list written by hand without it locks those users out silently.
 *      The source scan below fails on any such list outside config/roles.js.
 *   2. It must NOT be admin-tier (no Admin Portal, no IP/device data).
 *
 * Inventory: docs/phase3/MRF/HR-Admin-Recruiter-Role-Impact.md
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ROLES, ROLE_RANK, RECRUITER_TIER_ROLES, RECRUITER_ROOM_ROLES, ADMIN_ASSIGNABLE_ROLES,
  isAdminTier, outranks, atLeast, canDecideOnBehalf, roleLabel,
} from '../../config/roles.js';
import { canViewRecordings } from '../../services/interviewRecording.service.js';

// notification.service.js is read as text, not imported: importing it opens the
// socket bridge's Redis connection, which keeps `node --test` from exiting.
const here0 = path.dirname(fileURLToPath(import.meta.url));
const notificationSource = fs.readFileSync(path.resolve(here0, '../../services/notification.service.js'), 'utf8');

describe('hr_admin_recruiter rank', () => {
  test('sits between admin and recruiter', () => {
    assert.ok(ROLE_RANK.admin > ROLE_RANK.hr_admin_recruiter);
    assert.ok(ROLE_RANK.hr_admin_recruiter > ROLE_RANK.recruiter);
    assert.equal(outranks('admin', 'hr_admin_recruiter'), true, 'an admin can manage the account');
    assert.equal(outranks('hr_admin_recruiter', 'recruiter'), true);
    assert.equal(outranks('hr_admin_recruiter', 'admin'), false);
  });

  test('is not admin-tier', () => {
    assert.equal(isAdminTier('hr_admin_recruiter'), false);
    assert.equal(isAdminTier('HR_Admin_Recruiter'), false);
  });

  test('an admin may assign it; a superadmin role still may not be', () => {
    assert.ok(ADMIN_ASSIGNABLE_ROLES.includes('hr_admin_recruiter'));
    assert.ok(!ADMIN_ASSIGNABLE_ROLES.includes('superadmin'));
  });

  test('label', () => {
    assert.equal(roleLabel('hr_admin_recruiter'), 'HR Admin Recruiter');
    assert.equal(roleLabel('something_else'), 'something_else');
  });
});

describe('inherits every recruiter right', () => {
  test('RECRUITER_TIER_ROLES covers every staff role and no vendor', () => {
    for (const r of ['superadmin', 'admin', 'hr_admin_recruiter', 'recruiter', 'hr']) {
      assert.ok(RECRUITER_TIER_ROLES.includes(r), `${r} missing`);
    }
    assert.ok(!RECRUITER_TIER_ROLES.includes('vendor'));
  });

  test('rank-based checks pass it', () => {
    assert.equal(atLeast('hr_admin_recruiter', 'recruiter'), true);
    assert.equal(canViewRecordings('hr_admin_recruiter'), true);
  });

  test('notifications reach it (NOTIFY_ROLES is the shared staff list)', () => {
    assert.match(notificationSource, /export const NOTIFY_ROLES = RECRUITER_TIER_ROLES;/);
  });

  test('recruiter socket broadcasts reach it, each room once', () => {
    assert.deepEqual([...RECRUITER_ROOM_ROLES].sort(), ['hr_admin_recruiter', 'recruiter']);
    assert.equal(new Set(RECRUITER_ROOM_ROLES).size, RECRUITER_ROOM_ROLES.length);
  });
});

describe('canDecideOnBehalf — MRF decisions while approvers are away', () => {
  test('HR Admin Recruiter, Admin and Super Admin may', () => {
    for (const r of ['hr_admin_recruiter', 'admin', 'superadmin', 'Admin']) {
      assert.equal(canDecideOnBehalf(r), true, r);
    }
  });

  test('Recruiter, legacy hr, vendor and unknown may not', () => {
    for (const r of ['recruiter', 'hr', 'vendor', '', null, undefined, 'nonsense']) {
      assert.equal(canDecideOnBehalf(r), false, String(r));
    }
  });

  test('atLeast with an unknown minimum is never true', () => {
    assert.equal(atLeast('superadmin', 'no_such_role'), false);
  });
});

describe('source guard — no hand-written staff role list without hr_admin_recruiter', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const srcRoot = path.resolve(here, '../..');
  const repoRoot = path.resolve(srcRoot, '../..');
  const frontendSrc = path.join(repoRoot, 'frontend', 'src');

  const ALLOWED = new Set([
    path.join(srcRoot, 'config', 'roles.js'),
    path.join(frontendSrc, 'constants', 'roles.js'),
  ]);

  function* walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', 'tests', 'scratch', 'dist'].includes(entry.name)) continue;
        yield* walk(full);
      } else if (/\.(js|jsx|mjs)$/.test(entry.name)) {
        yield full;
      }
    }
  }

  // An array literal (or restrictTo(...) call) naming 'recruiter' as a quoted
  // string alongside another role. Single mentions ('recruiter' as a socket
  // room name or a calendar attendee role) are not role lists.
  const LIST_RE = /[[(][^\])\n]*['"]recruiter['"][^\])\n]*[\])]/g;
  const OTHER_ROLE_RE = /['"](admin|superadmin|hr|vendor)['"]/;

  test('every staff role list names hr_admin_recruiter (or uses the shared constant)', () => {
    const offenders = [];
    for (const file of [...walk(srcRoot), ...walk(frontendSrc)]) {
      if (ALLOWED.has(file)) continue;
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(LIST_RE)) {
        const list = m[0];
        if (!OTHER_ROLE_RE.test(list)) continue;
        // Candidate SOURCE keys (open positions board: hr_upload / vendor /
        // recruiter / other) say where an applicant came from, not who may act.
        if (/['"]hr_upload['"]/.test(list)) continue;
        if (/hr_admin_recruiter|HR_ADMIN_RECRUITER/.test(list)) continue;
        const line = text.slice(0, m.index).split('\n').length;
        offenders.push(`${path.relative(repoRoot, file)}:${line}  ${list.trim()}`);
      }
    }
    assert.deepEqual(offenders, [], `Role lists missing hr_admin_recruiter — use RECRUITER_TIER_ROLES:\n${offenders.join('\n')}`);
  });

  test('the shared constant really exports the new role', () => {
    assert.equal(ROLES.HR_ADMIN_RECRUITER, 'hr_admin_recruiter');
  });
});
