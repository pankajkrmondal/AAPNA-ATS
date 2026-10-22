/**
 * Recording share links — the rules standing between an unauthenticated URL and
 * a video of a real person.
 *
 * Run: node --test src/tests/unit/recordingShare.test.js
 *
 * No database and no server: the decision "may this link play?" is pure by
 * design (recordingShareModel.js), so every state it can be in — expired,
 * revoked, both, neither, missing, malformed — is exercised here rather than
 * discovered in production by somebody who should not have been watching.
 *
 * Plan: docs/phase3/CANDIDATE-COMPLETE-DOWNLOAD-PLAN.md §6.5, §10.2a.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  SHARE_STATES, describeShareLink, isShareLinkLive, isShareToken, shareDate, shareExpiryFrom,
  shareLinkState, shareRefusal, shareUrlFor,
} from '../../utils/recordingShareModel.js';
import { applyRecordingShareLinks, describeIncludedCategories } from '../../utils/dossierModel.js';
// Safe to import in a unit test: the service reaches Prisma but never connects
// at import time — the same chain recordingAccess.test.js already relies on.
import { isNewStreamSitting, serializeSharedRecording } from '../../services/recordingShare.service.js';
// Likewise safe: express-rate-limit registers no timer until a request arrives.
import { shareRateKey } from '../../middleware/shareRateLimit.js';

const NOW = new Date('2026-09-03T12:00:00Z');
const link = (over = {}) => ({
  token: '2c6f9fd3-0424-47ab-9f21-0c1d2e3f4a5b',
  expires_at: new Date('2026-09-17T12:00:00Z'),
  revoked_at: null,
  view_count: 0,
  ...over,
});

describe('shareLinkState — the server decides, and the server has the clock', () => {
  test('a link inside its window plays', () => {
    assert.equal(shareLinkState(link(), NOW), SHARE_STATES.LIVE);
    assert.equal(isShareLinkLive(link(), NOW), true);
  });

  test('a link past its expiry does not', () => {
    const after = new Date('2026-09-18T12:00:00Z');
    assert.equal(shareLinkState(link(), after), SHARE_STATES.EXPIRED);
  });

  test('expiry is exclusive at the boundary — the last second is not a grace period', () => {
    assert.equal(shareLinkState(link(), new Date('2026-09-17T12:00:00Z')), SHARE_STATES.EXPIRED);
    assert.equal(shareLinkState(link(), new Date('2026-09-17T11:59:59Z')), SHARE_STATES.LIVE);
  });

  test('a revoked link is refused immediately, not at next expiry', () => {
    // The control decision #7 rests on: revocation has to bite now, while the
    // link is still inside its window, or it is not a kill switch.
    const revoked = link({ revoked_at: new Date('2026-09-04T09:00:00Z') });
    assert.equal(shareLinkState(revoked, NOW), SHARE_STATES.REVOKED);
  });

  test('revoked wins over expired, so "did my revoke work?" stays answerable', () => {
    const both = link({
      revoked_at: new Date('2026-09-04T09:00:00Z'),
      expires_at: new Date('2026-09-05T09:00:00Z'),
    });
    assert.equal(shareLinkState(both, new Date('2026-10-01T00:00:00Z')), SHARE_STATES.REVOKED);
  });

  test('a missing link is missing, not live', () => {
    assert.equal(shareLinkState(null, NOW), SHARE_STATES.MISSING);
    assert.equal(shareLinkState(undefined, NOW), SHARE_STATES.MISSING);
  });

  test('a row with no usable expiry fails SHUT', () => {
    // NOT NULL makes this unreachable; if it ever happens, "immortal link" is
    // the one reading that must not be possible.
    assert.equal(shareLinkState(link({ expires_at: null }), NOW), SHARE_STATES.EXPIRED);
    assert.equal(shareLinkState(link({ expires_at: 'not a date' }), NOW), SHARE_STATES.EXPIRED);
  });

  test('a viewer changing their own clock changes nothing', () => {
    // The caller passes the server's now; there is no path by which a request
    // header or a client value reaches this function.
    const expired = link({ expires_at: new Date('2026-08-01T00:00:00Z') });
    assert.equal(shareLinkState(expired, NOW), SHARE_STATES.EXPIRED);
  });
});

describe('isShareToken — the public route is where hostile strings arrive', () => {
  test('a real token passes', () => {
    assert.equal(isShareToken('2c6f9fd3-0424-47ab-9f21-0c1d2e3f4a5b'), true);
    assert.equal(isShareToken('2C6F9FD3-0424-47AB-9F21-0C1D2E3F4A5B'), true, 'case-insensitive');
  });

  test('36 dashes does NOT pass', () => {
    // The first version of this guard checked characters and length only, so
    // this reached Prisma's uuid parser and threw — a 500 on the one route
    // where a friendly "no longer available" page is the whole point.
    assert.equal(isShareToken('------------------------------------'), false);
  });

  test('neither does 36 hex characters without the dashes', () => {
    assert.equal(isShareToken('abcdefabcdefabcdefabcdefabcdefabcdef'), false);
  });

  test('nor SQL, script tags, path traversal or nothing at all', () => {
    for (const hostile of ["' OR 1=1--", '<script>alert(1)</script>', '../../etc/passwd', '', null, undefined]) {
      assert.equal(isShareToken(hostile), false, `${hostile} must not reach the database`);
    }
  });
});

describe('shareRefusal — the holder is told the same thing either way', () => {
  test('expired and revoked read identically to whoever has the link', () => {
    // Telling a stranger "this was revoked 20 minutes ago" confirms the link was
    // real and that somebody is watching. The distinction is kept on the
    // timeline and in the drawer, where it is useful.
    const a = shareRefusal(SHARE_STATES.EXPIRED);
    const b = shareRefusal(SHARE_STATES.REVOKED);
    assert.equal(a.message, b.message);
    assert.equal(a.title, b.title);
    assert.equal(a.status, 410);
    assert.equal(b.status, 410);
  });

  test('a token that never existed is a 404, not a 410', () => {
    assert.equal(shareRefusal(SHARE_STATES.MISSING).status, 404);
  });

  test('the message says what to do next', () => {
    assert.match(shareRefusal(SHARE_STATES.EXPIRED).message, /ask the recruiter/i);
  });

  test('refusing a live link is a caller bug, and says so', () => {
    assert.throws(() => shareRefusal(SHARE_STATES.LIVE), /bug in the caller/);
  });
});

describe('shareUrlFor — a URL that works from a Downloads folder', () => {
  test('absolute, and pointed at the backend that will serve it', () => {
    assert.equal(
      shareUrlFor('abc-123', 'https://ats-staging.aapnainfotech.com'),
      'https://ats-staging.aapnainfotech.com/api/recording-share/abc-123',
    );
  });

  test('a trailing slash on the base does not produce a double slash', () => {
    assert.equal(
      shareUrlFor('abc-123', 'https://ats.example.com/'),
      'https://ats.example.com/api/recording-share/abc-123',
    );
  });

  test('no base URL yields NO link rather than a relative one', () => {
    // A relative URL in a file opened from someone's Downloads folder resolves
    // against `file://` and cannot work. Better to carry no link and say so.
    assert.equal(shareUrlFor('abc-123', ''), null);
    assert.equal(shareUrlFor('abc-123', undefined), null);
    assert.equal(shareUrlFor(null, 'https://ats.example.com'), null);
  });

  test('the token is URL-encoded', () => {
    assert.ok(!shareUrlFor('a b/c', 'https://x.example.com').includes(' '));
  });
});

describe('shareExpiryFrom — 14 days, and never a link that is born dead', () => {
  test('adds the configured number of days', () => {
    const out = shareExpiryFrom(14, NOW);
    assert.equal(out.toISOString(), '2026-09-17T12:00:00.000Z');
  });

  test('a misconfigured zero or negative falls back to the documented default', () => {
    // Otherwise a typo in an env file mints links that never work, and it reads
    // to a recruiter as "the feature is broken".
    assert.equal(shareExpiryFrom(0, NOW).toISOString(), '2026-09-17T12:00:00.000Z');
    assert.equal(shareExpiryFrom(-5, NOW).toISOString(), '2026-09-17T12:00:00.000Z');
    assert.equal(shareExpiryFrom('nonsense', NOW).toISOString(), '2026-09-17T12:00:00.000Z');
  });
});

describe('shareDate — one date, however many surfaces print it', () => {
  test('the timezone is honoured, so the page and the pack cannot disagree', () => {
    // 18:45 UTC on the 16th is already the 17th in Asia/Kolkata. A server in UTC
    // formatting its own local zone had the share page saying one day and the
    // file it was sent in saying the next.
    const instant = new Date('2026-09-16T18:45:00Z');
    assert.match(shareDate(instant, 'Asia/Kolkata'), /^17 Sept? 2026$/);
    assert.match(shareDate(instant, 'UTC'), /^16 Sept? 2026$/);
  });

  test('a value that is not a date is empty, never "Invalid Date" or the epoch', () => {
    assert.equal(shareDate('nonsense', 'UTC'), '');
    // `new Date(null)` is the epoch, not Invalid Date — the same trap
    // csvExport.js's toDate() guards. A missing expiry printed "1 Jan 1970" to
    // an external viewer before this check existed.
    assert.equal(shareDate(null, 'UTC'), '');
    assert.equal(shareDate(undefined, 'UTC'), '');
    assert.equal(shareDate('', 'UTC'), '');
  });
});

describe('shareRateKey — an unauthenticated route may not be told what to remember', () => {
  const req = (token, ip = '203.0.113.7') => ({ params: { token }, ip });

  test('a real token is keyed with the viewer, so one link is one bucket per IP', () => {
    const token = '2c6f9fd3-0424-47ab-9f21-0c1d2e3f4a5b';
    assert.equal(shareRateKey(req(token)), `share:${token}:203.0.113.7`);
    // A second viewer of the same link gets their own allowance — one
    // interviewer must not lock out another.
    assert.notEqual(shareRateKey(req(token)), shareRateKey(req(token, '198.51.100.2')));
  });

  test('anything that is not a token shares ONE bucket per IP', () => {
    // The token comes off the URL, so it is attacker-chosen and unbounded.
    // Keying on it verbatim let a caller allocate a fresh entry in the limiter's
    // in-memory store per request, held for the whole window, just by walking
    // made-up URLs — and reset their own allowance on every guess while
    // brute-forcing for a real one.
    const a = shareRateKey(req('x'.repeat(4096)));
    const b = shareRateKey(req('../../etc/passwd'));
    const c = shareRateKey(req(undefined));
    assert.equal(a, 'share:invalid:203.0.113.7');
    assert.equal(a, b);
    assert.equal(b, c);
    assert.ok(a.length < 64, 'a hostile token must not become a giant store key');
  });
});

describe('isNewStreamSitting — the /stream URL is watchable on its own', () => {
  const NOW_MS = new Date('2026-09-03T12:00:00Z');

  test('a stream opened cold is a view', () => {
    // "Copy video address" yields this URL, and it plays for the life of the
    // link. It used to move neither view_count nor the timeline, so the promise
    // printed above the player — every open is recorded — was false for exactly
    // the person who had bypassed the page.
    assert.equal(isNewStreamSitting(null, NOW_MS), true);
    assert.equal(isNewStreamSitting(undefined, NOW_MS), true);
    assert.equal(isNewStreamSitting('not a date', NOW_MS), true);
  });

  test('range requests inside one sitting are not counted again', () => {
    // One interview is dozens of range requests; counting each would bury the
    // candidate's timeline in the noise the audit exists to make readable.
    assert.equal(isNewStreamSitting(new Date('2026-09-03T11:59:00Z'), NOW_MS), false);
    assert.equal(isNewStreamSitting(new Date('2026-09-03T11:31:00Z'), NOW_MS), false);
  });

  test('coming back later is a new view', () => {
    assert.equal(isNewStreamSitting(new Date('2026-09-03T11:30:00Z'), NOW_MS), true);
    assert.equal(isNewStreamSitting(new Date('2026-09-01T09:00:00Z'), NOW_MS), true);
  });
});

describe('describeShareLink — what the recruiter sees in the drawer', () => {
  test('a live link says when it dies on its own', () => {
    const d = describeShareLink(link(), NOW);
    assert.equal(d.state, SHARE_STATES.LIVE);
    assert.match(d.summary, /Live until/);
  });

  test('a revoked link says so, not "expired"', () => {
    const d = describeShareLink(link({ revoked_at: NOW }), NOW);
    assert.match(d.summary, /Revoked/);
  });

  test('a link opened many times is flagged as unusual', () => {
    // One interviewer watching one interview does not open a link ten times.
    assert.equal(describeShareLink(link({ view_count: 3 }), NOW).unusual, false);
    assert.equal(describeShareLink(link({ view_count: 12 }), NOW).unusual, true);
  });

  test('a revoked link is not flagged — it is already closed', () => {
    const d = describeShareLink(link({ view_count: 40, revoked_at: NOW }), NOW);
    assert.equal(d.unusual, false);
  });
});

describe('serializeSharedRecording — the URLs that must never reach a browser', () => {
  // §10.2a item 7. The guarantee interviewRecording.service.js's header makes —
  // graph_content_url stays server-side — was written for an authenticated
  // player. This route has an UNAUTHENTICATED caller, so it has to be asserted
  // rather than assumed.
  const row = () => ({
    id: 7,
    schedule_id: 3,
    pipeline_id: 4821,
    stage_key: 'tech1',
    kind: 'recording',
    recorded_start_at: new Date('2026-08-28T10:00:00Z'),
    recorded_end_at: new Date('2026-08-28T10:55:00Z'),
    archive_status: 'archived',
    graph_content_url: 'https://graph.microsoft.com/v1.0/users/x/onlineMeetings/y/recordings/z/content',
    archive_item_id: 'drive!AbC123',
    teams_web_url: 'https://aapna.sharepoint.com/personal/x/Documents/recording.mp4',
    discovered_at: new Date('2026-08-28T11:00:00Z'),
  });

  test('no Graph URL, no archive item id, no SharePoint URL — ever', () => {
    const out = serializeSharedRecording(row(), link());
    const flat = JSON.stringify(out);
    assert.ok(!flat.includes('graph.microsoft.com'), 'the Graph content URL must not travel');
    assert.ok(!flat.includes('drive!AbC123'), 'the archive item id must not travel');
    assert.ok(!flat.includes('sharepoint.com'), 'the SharePoint URL must not travel');
  });

  test('it still says the recording is playable, without saying from where', () => {
    assert.equal(serializeSharedRecording(row(), link()).playable, true);
  });

  test('the expiry travels with the link, so the pack can state it', () => {
    const out = serializeSharedRecording(row(), link());
    assert.ok(out.share_expires_at);
  });

  test('no link means no share_url claimed', () => {
    const out = serializeSharedRecording(row(), null);
    assert.equal(out.share_url, null);
    assert.equal(out.share_expires_at, null);
  });
});

describe('applyRecordingShareLinks — what the pack says about the footage', () => {
  const model = (recordings, manifestNote = '2 recording(s) exist for this candidate.') => ({
    recordings,
    manifest: [{ item: 'Interview recordings', included: false, note: manifestNote }],
    // The fields describeIncludedCategories() reads.
    contact_details_included: true,
    scorecards: [],
    assessments: [],
    zeko: [],
    stages: [],
    interviews: [],
  });
  const twoRounds = () => ([
    { stage_label: 'Technical 1', duration_seconds: 3300 },
    { stage_label: 'Technical 2', duration_seconds: 2700 },
  ]);

  test('links attach to the right round, by position', () => {
    const m = model(twoRounds());
    applyRecordingShareLinks(m, {
      links: [{ index: 1, url: 'https://x.example.com/api/recording-share/t2', expires_at: NOW }],
      requested: true,
    }, { includeRecordingLinks: true });
    assert.equal(m.recordings[0].share_url, undefined);
    assert.equal(m.recordings[1].share_url, 'https://x.example.com/api/recording-share/t2');
  });

  test('the manifest says the recordings can be watched, and on what terms', () => {
    const m = model(twoRounds());
    applyRecordingShareLinks(m, {
      links: [
        { index: 0, url: 'https://x.example.com/a', expires_at: NOW },
        { index: 1, url: 'https://x.example.com/b', expires_at: NOW },
      ],
      requested: true,
    }, { includeRecordingLinks: true });
    const entry = m.manifest[0];
    assert.equal(entry.included, true);
    assert.match(entry.note, /no login/i);
    assert.match(entry.note, /withdrawn/i);
  });

  test('a round without a link is named rather than left to be assumed absent', () => {
    const m = model(twoRounds());
    applyRecordingShareLinks(m, {
      links: [{ index: 0, url: 'https://x.example.com/a', expires_at: NOW }],
      requested: true,
    }, { includeRecordingLinks: true });
    assert.match(m.manifest[0].note, /1 other recording\(s\) are not shared here/);
  });

  test("the recruiter's choice not to share is not reported as a failure", () => {
    const m = model(twoRounds());
    applyRecordingShareLinks(m, { links: [], requested: false }, { includeRecordingLinks: false });
    assert.match(m.manifest[0].note, /recruiter's choice/);
    assert.notEqual(m.manifest[0].degraded, true);
  });

  test('a failed mint IS reported as a failure', () => {
    const m = model(twoRounds());
    applyRecordingShareLinks(m, {
      links: [], requested: true, playable: 2, degraded: true,
    }, { includeRecordingLinks: true });
    assert.match(m.manifest[0].note, /no viewing link could be created/i);
    assert.equal(m.manifest[0].degraded, true);
  });

  test('rounds with nothing to play are an ABSENCE, not a failed download', () => {
    // The regression this pins: a candidate whose rounds were recorded but not
    // yet archived has no playable file, so no link can exist. That was reported
    // as "no viewing link could be created — please ask the recruiter" AND set
    // X-Export-Degraded, so the modal warned the recruiter that a file could not
    // be attached when nothing had gone wrong and nothing was missing from the
    // pack. collectRecordingShareLinks() had deliberately refused to raise
    // `degraded` for this case; the applier raised it anyway, one call later.
    const m = model(twoRounds());
    applyRecordingShareLinks(m, {
      links: [], requested: true, playable: 0, degraded: false,
    }, { includeRecordingLinks: true });
    assert.match(m.manifest[0].note, /none of them has a playable file/i);
    assert.notEqual(m.manifest[0].degraded, true, 'an unarchived round is not a broken download');
  });

  test('a real mint failure alongside unplayable rounds still degrades', () => {
    // playable > 0 and nothing linked is the genuine failure, and it must not be
    // softened by the fix above.
    const m = model(twoRounds());
    applyRecordingShareLinks(m, {
      links: [], requested: true, playable: 1, degraded: true,
    }, { includeRecordingLinks: true });
    assert.equal(m.manifest[0].degraded, true);
  });

  test('a caller that reports no count keeps the pessimistic reading', () => {
    // Absence of information is not evidence of absence: an older call site that
    // does not say how many rounds were playable must not be quietly downgraded
    // to "nothing to link".
    const m = model(twoRounds());
    applyRecordingShareLinks(m, { links: [], requested: true, degraded: true }, { includeRecordingLinks: true });
    assert.equal(m.manifest[0].degraded, true);
  });

  test('a candidate with no recordings gets no claim either way', () => {
    const m = model([], 'No interview recordings exist for this candidate.');
    applyRecordingShareLinks(m, { links: [], requested: true }, { includeRecordingLinks: true });
    assert.match(m.manifest[0].note, /No interview recordings exist/);
    assert.equal(m.manifest[0].included, false);
  });

  test('the audit distinguishes "we listed it" from "they can watch it"', () => {
    const m = model(twoRounds());
    m.recordings = twoRounds();
    applyRecordingShareLinks(m, {
      links: [{ index: 0, url: 'https://x.example.com/a', expires_at: NOW }],
      requested: true,
    }, { includeRecordingLinks: true });
    const listed = describeIncludedCategories(m);
    assert.ok(listed.includes('recordings_listed(2)'));
    assert.ok(listed.includes('recording_no_login_link(1)'));
  });

  test('no links, no claim in the audit', () => {
    const m = model(twoRounds());
    applyRecordingShareLinks(m, { links: [], requested: false }, { includeRecordingLinks: false });
    assert.ok(!describeIncludedCategories(m).some((c) => c.startsWith('recording_no_login_link')));
  });
});
