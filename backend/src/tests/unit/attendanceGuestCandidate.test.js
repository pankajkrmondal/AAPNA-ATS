/**
 * A candidate joining Teams as a GUEST must still let the interview be confirmed.
 * Run: node --test src/tests/unit/attendanceGuestCandidate.test.js
 *
 * Candidates here have no Teams account and join anonymously, so Teams records
 * them with a BLANK emailAddress. The original rule required both the candidate
 * AND an interviewer to match by address, which no guest can ever satisfy — so
 * on 2026-08-25 PANKAJ MONDAL's Technical Round 1 was auto-recorded
 * `no_show · both` at 8:15 PM, and the scorecard that collects the round's score
 * was never sent. The rule now leans on the one identity that IS reliable: the
 * interviewer, who is internal and always signed in.
 *
 * Pure unit test — no database, no network, no Graph.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { decideOccurrence, pickAttendanceReport } from '../../services/graphAttendance.helpers.js';

const PANEL = ['shreyan@aapnainfotech.com'];
const ORGANIZER = 'pkmondal@aapnainfotech.com';
const CANDIDATE = 'teststaging@aapnainfotech.com';

/** decideOccurrence with this deployment's defaults. */
const decide = (records, overrides = {}) => decideOccurrence(records, {
  interviewerEmails: PANEL,
  candidateEmail: CANDIDATE,
  organizerEmail: ORGANIZER,
  minSeconds: 60,
  guestMode: true,
  ...overrides,
});

describe('guest-candidate occurrence rule', () => {
  test('interviewer signed in + anonymous guest → held', () => {
    const out = decide([
      { email: 'shreyan@aapnainfotech.com', seconds: 1800 },
      { email: '', seconds: 1750 },
    ]);
    assert.equal(out.occurred, true);
    assert.equal(out.absentParty, null);
    assert.equal(out.interviewerPresent, true);
    assert.equal(out.guestPresent, true);
    // The whole point: it is held even though no candidate address matched.
    assert.equal(out.candidateMatched, false);
  });

  test('candidate who DOES sign in with the invited address still counts', () => {
    const out = decide([
      { email: 'shreyan@aapnainfotech.com', seconds: 900 },
      { email: CANDIDATE, seconds: 900 },
    ]);
    assert.equal(out.occurred, true);
    assert.equal(out.candidateMatched, true);
  });

  test('guest present but under the minimum → candidate no-show', () => {
    const out = decide([
      { email: 'shreyan@aapnainfotech.com', seconds: 900 },
      { email: '', seconds: 20 },
    ]);
    assert.equal(out.occurred, false);
    assert.equal(out.absentParty, 'candidate');
  });

  test('interviewer alone → candidate no-show', () => {
    const out = decide([{ email: 'shreyan@aapnainfotech.com', seconds: 600 }]);
    assert.equal(out.occurred, false);
    assert.equal(out.absentParty, 'candidate');
  });

  test('guest alone → panel no-show', () => {
    const out = decide([{ email: '', seconds: 600 }]);
    assert.equal(out.occurred, false);
    assert.equal(out.absentParty, 'panel');
  });

  test('nobody qualifying → both absent', () => {
    assert.equal(decide([]).absentParty, 'both');
    assert.equal(decide([{ email: '', seconds: 5 }]).absentParty, 'both');
  });

  test('the organizer mailbox alone is not a guest', () => {
    // The calendar mailbox owns every booking; counting it would make every
    // interview look attended.
    const out = decide([
      { email: 'shreyan@aapnainfotech.com', seconds: 900 },
      { email: ORGANIZER, seconds: 900 },
    ]);
    assert.equal(out.guestPresent, false);
    assert.equal(out.absentParty, 'candidate');
  });

  test('two anonymous guests are counted as two records, not collapsed', () => {
    // Both carry the same blank address, so a Set of emails would merge them.
    const out = decide([{ email: '', seconds: 900 }, { email: '', seconds: 900 }]);
    assert.equal(out.attendees.length, 2);
    assert.equal(out.guestPresent, true);
  });

  test('matching ignores case and surrounding whitespace', () => {
    const out = decide([
      { email: '  SHREYAN@AapnaInfotech.com ', seconds: 900 },
      { email: '', seconds: 900 },
    ]);
    assert.equal(out.occurred, true);
  });

  test('strict mode still requires the candidate address to match', () => {
    const guestOnly = [
      { email: 'shreyan@aapnainfotech.com', seconds: 900 },
      { email: '', seconds: 900 },
    ];
    assert.equal(decide(guestOnly, { guestMode: false }).occurred, false);
    assert.equal(decide(guestOnly, { guestMode: false }).absentParty, 'candidate');

    const bothSignedIn = [
      { email: 'shreyan@aapnainfotech.com', seconds: 900 },
      { email: CANDIDATE, seconds: 900 },
    ];
    assert.equal(decide(bothSignedIn, { guestMode: false }).occurred, true);
  });
});

describe('picking the report that belongs to this booking', () => {
  // A reschedule MOVES the Teams meeting, so one meeting id holds a report per
  // session. Taking the newest blindly could rule on the wrong one.
  const WINDOW = { windowStart: '2026-08-25T15:30:00Z', windowEnd: '2026-08-25T16:30:00Z' };
  const thisSession = {
    id: 'report-9pm',
    meetingStartDateTime: '2026-08-25T15:31:00Z',
    meetingEndDateTime: '2026-08-25T16:25:00Z',
  };
  const earlierSession = {
    id: 'report-7pm',
    meetingStartDateTime: '2026-08-25T13:30:00Z',
    meetingEndDateTime: '2026-08-25T13:45:00Z',
  };

  test('picks the overlapping report, not simply the newest', () => {
    const laterUnrelated = {
      id: 'report-tomorrow',
      meetingStartDateTime: '2026-08-26T15:30:00Z',
      meetingEndDateTime: '2026-08-26T16:30:00Z',
    };
    const picked = pickAttendanceReport([laterUnrelated, thisSession, earlierSession], WINDOW);
    assert.equal(picked.id, 'report-9pm');
  });

  test('returns null when only a stale session is published', () => {
    // Undecided, so the sweep retries — never a verdict from the wrong session.
    assert.equal(pickAttendanceReport([earlierSession], WINDOW), null);
  });

  test('tolerates joining early and running over', () => {
    const ranLong = {
      id: 'report-long',
      meetingStartDateTime: '2026-08-25T15:00:00Z',
      meetingEndDateTime: '2026-08-25T18:00:00Z',
    };
    assert.equal(pickAttendanceReport([ranLong], WINDOW).id, 'report-long');
  });

  test('falls back to the newest when no report carries timestamps', () => {
    const undated = [{ id: 'a' }, { id: 'b' }];
    assert.equal(pickAttendanceReport(undated, WINDOW).id, 'a');
  });

  test('empty list yields null', () => {
    assert.equal(pickAttendanceReport([], WINDOW), null);
    assert.equal(pickAttendanceReport(undefined, WINDOW), null);
  });
});
