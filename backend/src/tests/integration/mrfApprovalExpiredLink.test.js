/**
 * MRF approval link on an already-decided MRF (Phase 3 "Do Now", N16).
 *
 *   node src/tests/run-block.mjs src/tests/integration/mrfApprovalExpiredLink.test.js
 *
 * An approver opening an EXPIRED personal link on an MRF someone already
 * decided used to see "Link inactive or invalid". They now see who decided,
 * with the decider's title from the roster. Only a link we signed for that
 * MRF gets this; a forged or foreign token keeps today's error and reveals
 * nothing. Fixture rows are torn down by explicit id.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

import prisma from '../../config/database.js';
import config from '../../config/index.js';
import { disconnectRedis } from '../../config/redis.js';
import { getPublicDetails, decide } from '../../services/mrfApproval.service.js';
import { APPROVAL_TOKEN_TYP } from '../../utils/mrfApprovalRules.js';

const TAG = 'N16-EXPIRED-LINK-FIXTURE';
const CLIENT = { ip: '127.0.0.1', userAgent: 'node-test' };
const ROSTER = [
  { email: 'n16.ceo@example.invalid', name: 'N16 Chief', title: 'CEO' },
  { email: 'n16.chro@example.invalid', name: 'N16 People', title: 'CHRO' },
];

let decidedMrf;
let pendingMrf;
let tokenRow;
let savedRoster;

/** A JWT that expired an hour ago, signed exactly as the service signs links. */
function expiredToken(mrfId, jti, secret = config.jwt.secret) {
  const past = Math.floor(Date.now() / 1000) - 3600;
  return jwt.sign({ typ: APPROVAL_TOKEN_TYP, mrfId: String(mrfId), jti, iat: past - 60, exp: past }, secret);
}

describe('N16 expired link on a decided MRF', () => {
  before(async () => {
    savedRoster = await prisma.rpa_settings.findUnique({ where: { key: 'mrf_approvers' } });
    await prisma.rpa_settings.upsert({
      where: { key: 'mrf_approvers' },
      update: { value: JSON.stringify(ROSTER) },
      create: { key: 'mrf_approvers', value: JSON.stringify(ROSTER) },
    });
    decidedMrf = await prisma.rpa_mrf.create({
      data: {
        position_hiring_for: `${TAG} decided`,
        approval_status: 'approved',
        decided_by_email: 'n16.ceo@example.invalid',
        decided_by_name: 'N16 Chief',
        decided_at: new Date('2026-10-09T05:13:00Z'),
      },
    });
    pendingMrf = await prisma.rpa_mrf.create({ data: { position_hiring_for: `${TAG} pending`, approval_status: 'pending' } });
    tokenRow = await prisma.rpa_mrf_approval_tokens.create({
      data: {
        mrf_id: decidedMrf.id,
        approver_email: 'n16.chro@example.invalid',
        approver_name: 'N16 People',
        expires_at: new Date(Date.now() - 3600 * 1000),
      },
    });
  });

  after(async () => {
    const mrfIds = [decidedMrf?.id, pendingMrf?.id].filter(Boolean);
    await prisma.rpa_mrf_approval_events.deleteMany({ where: { mrf_id: { in: mrfIds } } }).catch(() => {});
    await prisma.rpa_mrf_approval_tokens.deleteMany({ where: { mrf_id: { in: mrfIds } } });
    await prisma.rpa_mrf.deleteMany({ where: { id: { in: mrfIds } } });
    if (savedRoster) {
      await prisma.rpa_settings.update({ where: { key: 'mrf_approvers' }, data: { value: savedRoster.value } });
    } else {
      await prisma.rpa_settings.delete({ where: { key: 'mrf_approvers' } }).catch(() => {});
    }
    await prisma.$disconnect();
    await disconnectRedis().catch(() => {});
  });

  test('expired personal link → the decision, with the decider\'s title', async () => {
    const details = await getPublicDetails(String(decidedMrf.id), expiredToken(decidedMrf.id, tokenRow.token_jti), CLIENT);
    assert.equal(details.link_state, 'expired');
    assert.equal(details.decision.word, 'approved');
    assert.equal(details.decision.decidedByName, 'N16 Chief');
    assert.equal(details.decision.decidedByTitle, 'CEO');
    assert.equal(details.decision.isYou, false);
    assert.equal(details.decided_by_email, undefined, 'the decider email never leaves the server');
  });

  test('an expired link still cannot decide; it is told who decided', async () => {
    await assert.rejects(
      decide(String(decidedMrf.id), { token: expiredToken(decidedMrf.id, tokenRow.token_jti), action: 'approve' }, CLIENT),
      (err) => err.statusCode === 409 && /^This MRF has already been approved by the CEO N16 Chief on /.test(err.message),
    );
    const mrf = await prisma.rpa_mrf.findUnique({ where: { id: decidedMrf.id } });
    assert.equal(mrf.decided_by_name, 'N16 Chief', 'nothing changed');
  });

  test('expired link on a still-open MRF keeps the "expired" error', async () => {
    await assert.rejects(
      getPublicDetails(String(pendingMrf.id), expiredToken(pendingMrf.id, tokenRow.token_jti), CLIENT),
      (err) => err.statusCode === 401 && /expired/.test(err.message),
    );
  });

  test('forged or foreign tokens reveal nothing', async () => {
    // Signed with another secret.
    await assert.rejects(
      getPublicDetails(String(decidedMrf.id), expiredToken(decidedMrf.id, tokenRow.token_jti, 'not-the-secret'), CLIENT),
      (err) => err.statusCode === 401,
    );
    // Ours, but issued for a different MRF.
    await assert.rejects(
      getPublicDetails(String(decidedMrf.id), expiredToken(pendingMrf.id, tokenRow.token_jti), CLIENT),
      (err) => err.statusCode === 401,
    );
  });
});
