/**
 * Access rules and browser-safety for interview recordings.
 *
 * Run: node --test src/tests/unit/recordingAccess.test.js
 *
 * Pure unit tests — no database, no Graph. They pin the two properties that are
 * cheap to break and expensive to get wrong:
 *
 *   1. Who may see a recording. Access was deliberately left broad (every
 *      recruiter, plan §0.4) rather than per-user, so the ONE boundary that
 *      still matters is that a vendor is never inside it.
 *   2. That the Graph content URL never reaches a browser. It is only usable
 *      with the application's own token, so leaking it into an API response is
 *      both a dead link and an invitation to try.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { canViewRecordings, serializeRecording } from '../../services/interviewRecording.service.js';

describe('canViewRecordings — who may review an interview recording', () => {
  test('recruiter-tier and above may', () => {
    for (const role of ['recruiter', 'hr', 'admin', 'superadmin']) {
      assert.equal(canViewRecordings(role), true, `${role} should be allowed`);
    }
  });

  test('a vendor may not — the boundary the broad-access decision rests on', () => {
    assert.equal(canViewRecordings('vendor'), false);
  });

  test('an unknown or missing role is refused, not defaulted in', () => {
    // Rank-based rather than a deny-list, so a role invented later starts
    // OUTSIDE the gate rather than inside it.
    for (const role of ['interviewer', 'guest', '', null, undefined]) {
      assert.equal(canViewRecordings(role), false, `${String(role)} should be refused`);
    }
  });

  test('role matching is case- and whitespace-insensitive', () => {
    assert.equal(canViewRecordings('  Recruiter '), true);
    assert.equal(canViewRecordings('ADMIN'), true);
    assert.equal(canViewRecordings(' VENDOR '), false);
  });
});

describe('serializeRecording — what a browser is allowed to receive', () => {
  const row = {
    id: 7n,
    schedule_id: 290n,
    pipeline_id: 1396n,
    stage_key: 'tech1',
    kind: 'recording',
    graph_recording_id: 'VjIjIzE…',
    online_meeting_id: 'MSowYTE4…',
    recorded_start_at: new Date('2026-09-01T14:20:00Z'),
    recorded_end_at: new Date('2026-09-01T14:25:30Z'),
    graph_content_url: 'https://graph.microsoft.com/v1.0/users/x/onlineMeetings/y/recordings/z/content',
    teams_web_url: 'https://aapna-my.sharepoint.com/…',
    archive_status: 'pending',
    archive_item_id: null,
    discovered_at: new Date('2026-09-01T14:53:00Z'),
  };

  test('never exposes the Graph content URL', () => {
    const out = serializeRecording(row);
    assert.equal(out.graph_content_url, undefined);
    // Belt and braces: no value anywhere in the payload may contain it, in case
    // a future field copies it under another name.
    assert.ok(
      !JSON.stringify(out).includes('graph.microsoft.com'),
      'serialized recording must not carry any graph.microsoft.com URL'
    );
  });

  test('does not leak Graph/Teams identifiers a caller has no use for', () => {
    const out = serializeRecording(row);
    assert.equal(out.graph_recording_id, undefined);
    assert.equal(out.online_meeting_id, undefined);
  });

  test('reports playability without saying where the bytes come from', () => {
    assert.equal(serializeRecording(row).playable, true);
    assert.equal(
      serializeRecording({ ...row, graph_content_url: null, archive_item_id: null }).playable,
      false
    );
    // An archived copy alone is enough to play, once Phase 5 exists.
    assert.equal(
      serializeRecording({ ...row, graph_content_url: null, archive_item_id: 'drive!item' }).playable,
      true
    );
  });

  test('computes duration once, so every screen shows the same number', () => {
    assert.equal(serializeRecording(row).duration_seconds, 330); // 5m30s
  });

  test('duration is null rather than wrong when an end time is missing', () => {
    // A recording still being written has no endDateTime yet; guessing a
    // duration there would put a confidently wrong number in front of a
    // decision-maker.
    assert.equal(serializeRecording({ ...row, recorded_end_at: null }).duration_seconds, null);
  });

  test('BigInt ids are converted, so the response is JSON-serialisable', () => {
    const out = serializeRecording(row);
    assert.equal(out.id, 7);
    assert.equal(out.schedule_id, 290);
    assert.doesNotThrow(() => JSON.stringify(out));
  });
});
