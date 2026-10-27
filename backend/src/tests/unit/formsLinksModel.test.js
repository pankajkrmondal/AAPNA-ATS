import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  STATES, firstUrlIn, linkActions, linkMessage, linkStatus, tileCounts, tileFlags,
} from '../../utils/formsLinksModel.js';

const NOW = new Date('2026-10-23T12:00:00Z').getTime();
const inDays = (d) => new Date(NOW + d * 86400000);

describe('linkStatus (L08)', () => {
  test('scorecard: submitted, expired (even while still "pending"), not delivered, opened, waiting', () => {
    assert.equal(linkStatus('scorecard', { submittedAt: inDays(-1) }, NOW).state, STATES.DONE);
    const lapsed = linkStatus('scorecard', { cardStatus: 'pending', sentAt: inDays(-9), expiresAt: inDays(-2) }, NOW);
    assert.deepEqual([lapsed.state, lapsed.status, lapsed.detail], [STATES.EXPIRED, 'Expired', 'never opened']);
    const failed = linkStatus('scorecard', { cardStatus: 'pending', sentAt: null, expiresAt: inDays(5) }, NOW);
    assert.deepEqual([failed.state, failed.status, failed.notDelivered], [STATES.OPEN, 'Not delivered', true]);
    assert.equal(linkStatus('scorecard', { cardStatus: 'pending', sentAt: inDays(-1), openedAt: inDays(-1), expiresAt: inDays(5) }, NOW).status, 'Opened');
    assert.equal(linkStatus('scorecard', { cardStatus: 'pending', sentAt: inDays(-1), expiresAt: inDays(5) }, NOW).status, 'Waiting');
  });

  test('recording, documents, approval and the rest', () => {
    assert.equal(linkStatus('recording', { revokedAt: inDays(-1), expiresAt: inDays(5) }, NOW).state, STATES.CLOSED);
    assert.equal(linkStatus('recording', { expiresAt: inDays(-1) }, NOW).state, STATES.EXPIRED);
    assert.equal(linkStatus('documents', { tokenStatus: 'active', uploaded: 2, total: 5 }, NOW).detail, '2 of 5 uploaded');
    assert.equal(linkStatus('mrf_approval', { openCount: 2, expiresAt: inDays(3) }, NOW).status, 'Opened ×2');
    assert.equal(linkStatus('mrf_approval', { usedAt: inDays(-1) }, NOW).state, STATES.DONE);
    assert.equal(linkStatus('meeting', { endsAt: inDays(-1) }, NOW).state, STATES.DONE);
    assert.equal(linkStatus('profile', { tokenStatus: 'FAILED' }, NOW).notDelivered, true);
    assert.equal(linkStatus('evalground', { hasResult: false, expiresAt: inDays(-1) }, NOW).state, STATES.EXPIRED);
    assert.equal(linkStatus('mrf_form', { submitted: true }, NOW).state, STATES.DONE);
  });
});

describe('linkActions (L08)', () => {
  test('approval links are never copied, only re-issued (D3)', () => {
    assert.deepEqual(linkActions('mrf_approval', STATES.OPEN), ['reissue']);
    assert.ok(!linkActions('mrf_approval', STATES.OPEN).includes('copy'));
  });

  test('an expired scorecard can be renewed, not copied (D5)', () => {
    assert.deepEqual(linkActions('scorecard', STATES.EXPIRED), ['renew']);
    assert.deepEqual(linkActions('scorecard', STATES.OPEN), ['copy', 'resend']);
    assert.deepEqual(linkActions('scorecard', STATES.DONE), []);
  });

  test('scorecards and recordings are copy-only (opening would count as the recipient)', () => {
    assert.ok(!linkActions('scorecard', STATES.OPEN).includes('open'));
    assert.ok(!linkActions('recording', STATES.OPEN).includes('open'));
    assert.ok(linkActions('recording', STATES.OPEN).includes('revoke'));
  });
});

describe('tiles (L08)', () => {
  test('waiting, expiring within 48 h, expired, not delivered', () => {
    const rows = [
      { state: STATES.OPEN, notDelivered: false, expiresAt: inDays(1) },
      { state: STATES.OPEN, notDelivered: false, expiresAt: inDays(5) },
      { state: STATES.OPEN, notDelivered: true, expiresAt: inDays(5) },
      { state: STATES.EXPIRED },
      { state: STATES.DONE },
    ];
    assert.deepEqual(tileCounts(rows, NOW), { waiting: 2, expiring48h: 1, expiredNoResponse: 1, notDelivered: 1 });
    assert.equal(tileFlags({ state: STATES.DONE, expiresAt: inDays(1) }, NOW).expiring48h, false);
  });
});

describe('messages (D9)', () => {
  const fmt = (d) => new Date(d).toISOString().slice(0, 10);

  test('a scorecard message names the interviewer, candidate, round, role and deadline', () => {
    const m = linkMessage('scorecard', {
      recipientName: 'Rahul Verma', candidateName: 'Priya Nair', roundLabel: 'Technical Round 1',
      role: 'Java Developer', mrfRef: 'MRF-118', expiresAt: '2026-10-30T00:00:00Z',
    }, 'https://ats.example.com/scorecard/abc', fmt);
    assert.equal(m, "Hi Rahul, here is the scorecard for Priya Nair's Technical Round 1 (Java Developer, MRF-118). No login is needed.\nhttps://ats.example.com/scorecard/abc\nPlease submit it by 2026-10-30.\nThank you, AAPNA Recruitment");
  });

  test('a meeting message carries the time, ID and passcode; documents list what is missing', () => {
    const meet = linkMessage('meeting', { candidateName: 'Karan', roundLabel: 'Technical Round 2', startsAt: '2026-10-27T09:30:00Z', meetingId: '123', passcode: 'xyz' }, 'https://teams/x', fmt);
    assert.match(meet, /When: 2026-10-27/);
    assert.match(meet, /Meeting ID: 123 · Passcode: xyz/);
    const docs = linkMessage('documents', { recipientName: 'Sneha', role: 'Data Analyst', missingDocs: ['PAN', 'Payslips'] }, 'https://ats/documents/t', fmt);
    assert.match(docs, /Still needed: PAN, Payslips\./);
  });

  test('firstUrlIn finds the test link inside an invite body', () => {
    assert.equal(firstUrlIn('Hi, take the test at https://evalground.com/t/abc123. Good luck'), 'https://evalground.com/t/abc123');
    assert.equal(firstUrlIn('no link here'), null);
  });
});
