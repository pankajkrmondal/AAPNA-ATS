/**
 * The recording notice attached to interview invitations.
 *
 * Run: node --test src/tests/unit/recordingNotice.test.js
 *
 * These are compliance tests as much as unit tests. Recording a person requires
 * telling them, and the candidate notice is the only place we do. It states a
 * purpose, an audience and a retention period, and the retention period it
 * quotes is a promise the purge job has to keep — so the wording and the
 * MS_RECORDING_RETAIN_MONTHS default are pinned together here. If someone
 * changes one, this test should make them notice the other.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildRecordingNotice } from '../../services/interviewSchedule.service.js';

describe('candidate recording notice', () => {
  const html = buildRecordingNotice('candidate');

  test('says plainly that the interview will be recorded', () => {
    assert.match(html, /will be recorded/i);
  });

  test('states the purpose the recording may be used for', () => {
    assert.match(html, /hiring team|review your interview|reach a decision/i);
  });

  test('states the retention period, and it matches the purge default', () => {
    // The invite promises deletion "within 12 months of your application
    // closing"; purgeExpiredRecordings() enforces MS_RECORDING_RETAIN_MONTHS,
    // whose default is 12. These two numbers must not drift apart.
    assert.match(html, /12 months/i);
  });

  test('offers a way to object before the interview happens', () => {
    assert.match(html, /reply to this email|concerns/i);
  });

  test('does not leak panel-only operational wording to the candidate', () => {
    assert.doesNotMatch(html, /do not stop it|make them a presenter/i);
  });
});

describe('panel recording notice', () => {
  const html = buildRecordingNotice('panel');

  test('tells the interviewer recording is automatic', () => {
    assert.match(html, /records automatically|do not need to press Record/i);
  });

  test('asks them not to stop it — the rule Teams cannot enforce', () => {
    // allowedPresenters keeps the CANDIDATE from stopping the recording, but an
    // interviewer is a presenter and technically can. This sentence is the only
    // control over that, short of demoting the panel and losing screen sharing.
    assert.match(html, /do not stop it/i);
  });

  test('explains how to let the candidate share their screen', () => {
    // The candidate is an attendee precisely so they cannot stop the recording;
    // the side effect is that they cannot share either. Without this line the
    // first coding round stalls while someone works out why.
    assert.match(html, /presenter/i);
    assert.match(html, /share their screen|share/i);
  });
});

describe('notice mechanics', () => {
  test('carries a marker so it is never appended twice', () => {
    // The body goes compile → recruiter edit → send, and the notice is applied
    // at send time. Without a marker a reschedule of an edited body would stack
    // a second copy.
    for (const audience of ['candidate', 'panel']) {
      assert.match(buildRecordingNotice(audience), /<!--ats-recording-notice-->/);
    }
  });

  test('is self-contained HTML that survives being appended to any body', () => {
    const html = buildRecordingNotice('candidate');
    assert.match(html, /^<!--ats-recording-notice--><table/);
    assert.match(html, /<\/table>$/);
  });
});
