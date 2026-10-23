/**
 * MRF Hold and decisions on behalf of absent approvers — the pure rules.
 *
 * Run: node --test src/tests/unit/mrfHoldRules.test.js
 *
 * No database. These pin the parts that decide WHEN a held MRF comes back and
 * WHO may decide in the approvers' absence:
 *   - every date is an IST calendar date (a hold "until 27 Nov" means 27 Nov in
 *     India whatever the server's timezone);
 *   - a hold is at least until tomorrow and at most maxDays out;
 *   - only HR Admin Recruiter / Admin / Super Admin decide on behalf, and only
 *     inside an absence window that covers today;
 *   - a held MRF is not "open" (no reminders, no deciding through old links).
 *
 * Plan: docs/phase3/MRF/MRF-Hold-and-Delegate-Approval-Plan.md
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  HELD_STATUS,
  HOLD_DEFAULTS,
  addDays,
  canDecideAsDelegate,
  dateLabel,
  decisionWord,
  delegateRefusalMessage,
  holdDateBounds,
  isAbsenceActive,
  isoDate,
  parseAbsence,
  parseHoldRules,
  publicDecision,
  releaseTimeToCron,
  todayIst,
  validateAbsence,
  validateHoldRules,
  validateHoldUntil,
} from '../../utils/mrfApprovalRules.js';
import { isOpenApprovalStatus, reminderSkipReason, MRF_APPROVAL_REQUEST_EMAIL_TYPE } from '../../jobs/reminderEligibility.js';
import { mrfApprovalLabel } from '../../exports/mrfDetail.export.js';

describe('IST calendar dates', () => {
  test('todayIst rolls over at midnight India time, not UTC', () => {
    // 22 Oct 2026 18:29 UTC = 23:59 IST on the 22nd; 18:31 UTC = 00:01 IST on the 23rd.
    assert.equal(todayIst(new Date('2026-10-22T18:29:00Z')), '2026-10-22');
    assert.equal(todayIst(new Date('2026-10-22T18:31:00Z')), '2026-10-23');
  });

  test('a DATE column value (UTC midnight) reads as the same day', () => {
    assert.equal(isoDate(new Date('2026-11-27T00:00:00Z')), '2026-11-27');
  });

  test('addDays crosses months and years', () => {
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2026-10-22', 30), '2026-11-21');
  });

  test('labels', () => {
    assert.equal(dateLabel('2026-11-27'), '27 Nov 2026');
    assert.equal(dateLabel(null), '');
  });
});

describe('validateHoldUntil — tomorrow to today + maxDays', () => {
  const today = '2026-10-22';
  test('tomorrow and the last allowed day are accepted', () => {
    assert.deepEqual(validateHoldUntil('2026-10-23', { maxDays: 180, today }), { ok: true, date: '2026-10-23' });
    assert.equal(validateHoldUntil(addDays(today, 180), { maxDays: 180, today }).ok, true);
  });

  test('today, the past and one day too far are refused', () => {
    assert.match(validateHoldUntil(today, { maxDays: 180, today }).error, /after today/);
    assert.match(validateHoldUntil('2026-01-01', { maxDays: 180, today }).error, /after today/);
    assert.match(validateHoldUntil(addDays(today, 181), { maxDays: 180, today }).error, /at most 180 days/);
  });

  test('garbage and impossible dates are refused', () => {
    for (const v of [undefined, null, '', 'tomorrow', '27/11/2026', '2026-02-30', '2026-13-01']) {
      assert.equal(validateHoldUntil(v, { maxDays: 180, today }).ok, false, String(v));
    }
  });

  test('a lowered maximum applies to new holds', () => {
    assert.equal(validateHoldUntil(addDays(today, 100), { maxDays: 90, today }).ok, false);
  });
});

describe('hold rules (Settings)', () => {
  test('defaults when nothing is set or the values are broken', () => {
    assert.deepEqual(parseHoldRules({}), { ...HOLD_DEFAULTS });
    assert.deepEqual(parseHoldRules({ mrf_hold_max_days: 'abc', mrf_hold_default_days: '-4', mrf_hold_release_time: '25:00' }), { ...HOLD_DEFAULTS });
  });

  test('the default never exceeds the maximum', () => {
    assert.deepEqual(parseHoldRules({ mrf_hold_max_days: '60', mrf_hold_default_days: '90' }).defaultDays, 60);
  });

  test('validateHoldRules', () => {
    assert.deepEqual(validateHoldRules({ defaultDays: 30, maxDays: 120, releaseTime: '08:30' }),
      { ok: true, rules: { defaultDays: 30, maxDays: 120, releaseTime: '08:30' } });
    assert.equal(validateHoldRules({ defaultDays: 30, maxDays: 0, releaseTime: '09:00' }).ok, false);
    assert.equal(validateHoldRules({ defaultDays: 30, maxDays: 400, releaseTime: '09:00' }).ok, false);
    assert.equal(validateHoldRules({ defaultDays: 200, maxDays: 180, releaseTime: '09:00' }).ok, false);
    assert.equal(validateHoldRules({ defaultDays: 30, maxDays: 180, releaseTime: '9am' }).ok, false);
    assert.equal(validateHoldRules({ defaultDays: 1.5, maxDays: 180, releaseTime: '09:00' }).ok, false);
  });

  test('release time to cron', () => {
    assert.equal(releaseTimeToCron('09:00'), '0 9 * * *');
    assert.equal(releaseTimeToCron('18:45'), '45 18 * * *');
  });

  test('form bounds', () => {
    assert.deepEqual(holdDateBounds({ defaultDays: 30, maxDays: 180 }, '2026-10-22'), {
      minDate: '2026-10-23', maxDate: '2027-04-20', defaultDate: '2026-11-21', defaultDays: 30, maxDays: 180,
    });
  });
});

describe('approver absence window', () => {
  test('active only between from and to, inclusive', () => {
    const a = { active: true, from: '2026-10-27', to: '2026-10-31' };
    assert.equal(isAbsenceActive(a, '2026-10-26'), false);
    assert.equal(isAbsenceActive(a, '2026-10-27'), true);
    assert.equal(isAbsenceActive(a, '2026-10-31'), true);
    assert.equal(isAbsenceActive(a, '2026-11-01'), false);
    assert.equal(isAbsenceActive({ ...a, active: false }, '2026-10-28'), false);
  });

  test('parseAbsence is safe on bad data', () => {
    assert.equal(parseAbsence(null).active, false);
    assert.equal(parseAbsence('{not json').active, false);
    assert.equal(parseAbsence(JSON.stringify({ active: true, from: '2026-10-31', to: '2026-10-27' })).active, false, 'to before from');
    assert.equal(parseAbsence(JSON.stringify({ active: true, from: '2026-10-27', to: '2026-10-31' })).active, true);
  });

  test('validateAbsence', () => {
    assert.equal(validateAbsence({ active: true, from: '2026-10-27' }).ok, false);
    assert.equal(validateAbsence({ active: true, from: '2026-10-31', to: '2026-10-27' }).ok, false);
    assert.equal(validateAbsence({ active: true, from: '2026-10-27', to: '2026-10-27' }).ok, true, 'one day');
    assert.equal(validateAbsence({ active: false }).ok, true);
  });
});

describe('canDecideAsDelegate — who may decide on behalf, and when', () => {
  const absence = { active: true, from: '2026-10-27', to: '2026-10-31' };
  const today = '2026-10-28';

  test('HR Admin Recruiter, Admin and Super Admin inside the window', () => {
    for (const role of ['hr_admin_recruiter', 'admin', 'superadmin']) {
      assert.deepEqual(canDecideAsDelegate({ user: { role, is_active: true }, absence, today }), { ok: true, reason: null }, role);
    }
  });

  test('nobody outside the window — not even a Super Admin (D1)', () => {
    assert.equal(canDecideAsDelegate({ user: { role: 'superadmin' }, absence, today: '2026-11-01' }).reason, 'no_absence_window');
    assert.equal(canDecideAsDelegate({ user: { role: 'admin' }, absence: { active: false }, today }).reason, 'no_absence_window');
  });

  test('a plain Recruiter never, even inside the window', () => {
    for (const role of ['recruiter', 'hr', 'vendor', null]) {
      assert.equal(canDecideAsDelegate({ user: { role }, absence, today }).reason, 'role_too_low', String(role));
    }
    assert.equal(canDecideAsDelegate({ user: null, absence, today }).reason, 'role_too_low');
  });

  test('an inactive account is refused', () => {
    assert.equal(canDecideAsDelegate({ user: { role: 'admin', is_active: false }, absence, today }).reason, 'inactive_user');
  });

  test('every refusal has words', () => {
    for (const r of ['role_too_low', 'inactive_user', 'no_absence_window', 'other']) {
      assert.ok(delegateRefusalMessage(r).length > 10);
    }
  });
});

describe('held is not open, and reads as ON HOLD', () => {
  test('not an open approval status', () => {
    assert.equal(isOpenApprovalStatus(HELD_STATUS), false);
  });

  test('a reminder for a held MRF is closed, not sent', () => {
    const reason = reminderSkipReason({
      email_type: MRF_APPROVAL_REQUEST_EMAIL_TYPE, reference_id: 1, mrf_exists_id: 1, mrf_approval_status: 'held',
    });
    assert.match(reason, /already decided/);
  });

  test('words and labels', () => {
    assert.equal(decisionWord('held'), 'put on hold');
    assert.equal(mrfApprovalLabel('held'), 'ON HOLD');
  });

  test('the public page sees who held it and until when — never their email', () => {
    const d = publicDecision({
      approval_status: 'held', held_by_name: 'Abhijit Roy', held_by_email: 'a@x.com',
      held_at: new Date('2026-10-22T05:00:00Z'), held_until: new Date('2026-11-27T00:00:00Z'),
    }, 'a@x.com');
    assert.equal(d.status, 'held');
    assert.equal(d.decidedByName, 'Abhijit Roy');
    assert.equal(d.heldUntil, '2026-11-27');
    assert.equal(d.heldUntilLabel, '27 Nov 2026');
    assert.equal(d.isYou, true);
    assert.ok(!JSON.stringify(d).includes('a@x.com'));
  });
});
