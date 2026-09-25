/**
 * Unit tests for the MRF approval audit-trail rules (no network, no DB).
 * Run: node --test src/tests/mrfApprovalRules.test.js
 *
 * These guard the parts of the fix that decide WHO a decision is recorded
 * against and what personal data is kept or shown: the approver roster, IP
 * normalisation and masking, the device summary, scanner detection, the IST
 * time shown to approvers, and what the PUBLIC page may learn about a decision.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  APPROVAL_TOKEN_TYP,
  clampText,
  decisionWord,
  formatIst,
  looksLikeScanner,
  maskIp,
  normalizeIp,
  parseApproverRoster,
  publicDecision,
  summarizeUserAgent,
} from '../utils/mrfApprovalRules.js';
import { reminderSkipReason, MRF_APPROVAL_REQUEST_EMAIL_TYPE } from '../jobs/reminderEligibility.js';
import { splitSql } from '../utils/splitSql.js';

test('approval tokens carry their own typ so a login JWT can never act as an approval link', () => {
  assert.equal(APPROVAL_TOKEN_TYP, 'mrf_approval');
});

test('roster: valid setting is used as-is (names kept, duplicates dropped)', () => {
  const r = parseApproverRoster(JSON.stringify([
    { email: 'aroy@aapnainfotech.com', name: 'Abhijit Roy' },
    { email: 'sroy@aapnainfotech.com', name: 'Sanghamitra Roy' },
    { email: 'AROY@aapnainfotech.com', name: 'dup' },
  ]), 'x@y.com');
  assert.equal(r.source, 'setting');
  assert.deepEqual(r.approvers, [
    { email: 'aroy@aapnainfotech.com', name: 'Abhijit Roy' },
    { email: 'sroy@aapnainfotech.com', name: 'Sanghamitra Roy' },
  ]);
});

test('roster: missing/invalid setting falls back to the flow-key emails (submission never fails)', () => {
  const fb = 'aroy@aapnainfotech.com, sroy@aapnainfotech.com';
  assert.equal(parseApproverRoster(null, fb).source, 'fallback');
  assert.equal(parseApproverRoster('', fb).approvers.length, 2);
  const bad = parseApproverRoster('{not json', fb);
  assert.equal(bad.source, 'fallback');
  assert.match(bad.error, /not valid JSON/);
  assert.match(parseApproverRoster('[]', fb).error, /non-empty/);
  assert.match(parseApproverRoster(JSON.stringify([{ email: 'nope' }]), fb).error, /invalid email/);
  // name defaults to the email
  assert.deepEqual(parseApproverRoster(null, 'a@b.co').approvers, [{ email: 'a@b.co', name: 'a@b.co' }]);
});

test('normalizeIp: keeps real v4/v6, strips the v4-mapped prefix, rejects junk (stored as NULL)', () => {
  assert.equal(normalizeIp('49.36.12.200'), '49.36.12.200');
  assert.equal(normalizeIp('::ffff:49.36.12.200'), '49.36.12.200');
  assert.equal(normalizeIp('::1'), '::1');
  assert.equal(normalizeIp('2405:201:abcd:1234::5'), '2405:201:abcd:1234::5');
  assert.equal(normalizeIp('999.1.1.1'), null);
  assert.equal(normalizeIp("1.2.3.4'; DROP TABLE x"), null);
  assert.equal(normalizeIp(''), null);
  assert.equal(normalizeIp(undefined), null);
});

test('maskIp: IPv4 keeps /24, IPv6 keeps /48 (retention masking)', () => {
  assert.equal(maskIp('49.36.12.200'), '49.36.12.0');
  assert.equal(maskIp('::ffff:10.1.2.3'), '10.1.2.0');
  assert.equal(maskIp('2405:201:abcd:1234::5'), '2405:201:abcd::');
  assert.equal(maskIp('::1'), '0:0:0::');
  assert.equal(maskIp('garbage'), null);
});

test('summarizeUserAgent: reduces to "Browser on OS"', () => {
  assert.equal(summarizeUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36'), 'Chrome on Windows');
  assert.equal(summarizeUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1'), 'Safari on iOS');
  assert.equal(summarizeUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36 Edg/120.0'), 'Edge on Windows');
  assert.equal(summarizeUserAgent(null), null);
});

test('looksLikeScanner: known scanners, empty UA, and opens within seconds of sending', () => {
  const now = new Date('2026-09-25T06:00:30Z');
  assert.equal(looksLikeScanner('Mozilla/5.0 (compatible; SafeLinks)', null, now), true);
  assert.equal(looksLikeScanner('', null, now), true);
  assert.equal(looksLikeScanner('Mozilla/5.0 Chrome/153', '2026-09-25T06:00:25Z', now), true);
  assert.equal(looksLikeScanner('Mozilla/5.0 Chrome/153', '2026-09-25T05:00:00Z', now), false);
});

test('formatIst: stable "25 Sep 2026, 11:39 AM IST" (never "Sept", noon/midnight correct)', () => {
  assert.equal(formatIst('2026-09-25T06:09:35Z'), '25 Sep 2026, 11:39 AM IST');
  assert.equal(formatIst('2026-09-23T17:13:25Z'), '23 Sep 2026, 10:43 PM IST'); // MRF #9's approval time
  assert.equal(formatIst('2026-09-25T06:30:00Z'), '25 Sep 2026, 12:00 PM IST');
  assert.equal(formatIst('2026-09-24T18:30:00Z'), '25 Sep 2026, 12:00 AM IST');
  assert.equal(formatIst(null), '');
  assert.equal(formatIst('not a date'), '');
});

test('clampText / decisionWord', () => {
  assert.equal(clampText('  hi  ', 10), 'hi');
  assert.equal(clampText('   ', 10), null);
  assert.equal(clampText('abcdef', 3), 'abc');
  assert.equal(decisionWord('rejected'), 'declined');
  assert.equal(decisionWord('approved'), 'approved');
  assert.equal(decisionWord('completed'), 'approved');
});

test('publicDecision: name and time only — never the decider email or IP; isYou by email', () => {
  const mrf = {
    approval_status: 'approved', decided_by_name: 'Sanghamitra Roy', decided_by_email: 'sroy@aapnainfotech.com',
    decided_at: '2026-09-23T17:13:25Z', decided_ip: '49.36.12.200',
  };
  const d = publicDecision(mrf, 'aroy@aapnainfotech.com');
  assert.equal(d.decidedByName, 'Sanghamitra Roy');
  assert.equal(d.decidedAtIst, '23 Sep 2026, 10:43 PM IST');
  assert.equal(d.isYou, false);
  assert.equal(JSON.stringify(d).includes('sroy@'), false, 'email must not leak');
  assert.equal(JSON.stringify(d).includes('49.36'), false, 'IP must not leak');
  assert.equal(publicDecision(mrf, 'SROY@aapnainfotech.com').isYou, true);
  assert.equal(publicDecision({ approval_status: 'waiting' }, null), null);
});

test('reminders: a personal approval link that is revoked, used or expired is never reminded', () => {
  const now = Date.parse('2026-09-25T06:00:00Z');
  const base = { email_type: MRF_APPROVAL_REQUEST_EMAIL_TYPE, reference_id: 1, mrf_exists_id: 1n, mrf_approval_status: 'pending', approval_token_id: 5n };
  assert.equal(reminderSkipReason({ ...base, approval_token_expires_at: '2026-10-01T00:00:00Z' }, now), null);
  assert.match(reminderSkipReason({ ...base, approval_token_revoked_at: '2026-09-24T00:00:00Z', approval_token_revoked_reason: 'reissued' }, now), /revoked \(reissued\)/);
  assert.match(reminderSkipReason({ ...base, approval_token_used_at: '2026-09-24T00:00:00Z' }, now), /already used/);
  assert.match(reminderSkipReason({ ...base, approval_token_expires_at: '2026-09-24T00:00:00Z' }, now), /expired/);
  // shared-link emails from before the audit trail (no token row) keep the status rule only
  assert.equal(reminderSkipReason({ ...base, approval_token_id: null }, now), null);
});

test('run-ddl splitSql: splits on top-level ; only (functions, strings, comments stay intact)', () => {
  const sql = `
    -- a comment; with a semicolon
    CREATE TABLE t (a int);
    COMMENT ON TABLE t IS 'it''s; fine';
    CREATE FUNCTION f() RETURNS trigger AS $guard$ BEGIN RAISE EXCEPTION 'x;y'; RETURN NEW; END $guard$ LANGUAGE plpgsql;
    /* block; comment */ SELECT 1;
  `;
  const parts = splitSql(sql);
  assert.equal(parts.length, 4);
  assert.match(parts[1], /it''s; fine/);
  assert.match(parts[2], /RETURN NEW; END \$guard\$ LANGUAGE plpgsql$/);
});
