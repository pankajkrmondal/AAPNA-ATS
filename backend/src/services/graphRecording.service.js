/**
 * graphRecording.service.js — reads Microsoft Teams call recordings (and
 * transcripts) for a booked interview round, so the recording made during the
 * call can be attached to the candidate's record.
 *
 * Gated on config.microsoft.recordingFetchEnabled because this needs consent the
 * rest of the Graph integration does not have:
 *   - OnlineMeetingRecording.Read.All  (application) — granted + verified 200 on
 *     2026-09-01, plus the application access policy already on the mailbox.
 *   - OnlineMeetingTranscript.Read.All (application) — granted, but ALSO gated by
 *     a separate tenant switch ("Transcript API access → Microsoft Graph access")
 *     that Microsoft began enforcing on 31 Jul 2026 and ships OFF. Until an admin
 *     turns it on, transcripts return 403 no matter what is consented, so this
 *     module treats that particular 403 as "not available here" rather than as an
 *     error worth shouting about on every sweep.
 *
 * Every export is best-effort and NEVER throws to its caller — the sweep must
 * survive one unreadable meeting and carry on to the next. Failures come back as
 * null (unreadable) versus [] (readable, nothing there), a distinction the caller
 * needs: [] after the grace window means the interview was not recorded, whereas
 * null means we simply could not tell.
 *
 * See docs/phase3/INTERVIEW-RECORDINGS-PLAN.md §3.7.
 */
import config from '../config/index.js';
import logger from '../config/logger.js';
import { getAccessToken } from './onedrive.service.js';
import { resolveUserId } from './graphCalendar.service.js';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

/** Whether recording discovery is switched on for this environment. */
export const isRecordingFetchEnabled = () => Boolean(config.microsoft.recordingFetchEnabled);

/** The organizer mailbox whose meetings own the recordings. */
const organizerMailbox = () => config.microsoft.calendarMailbox;

/**
 * True for the tenant-level transcript block described in the module header.
 * Distinguished from a genuine permission 403 so the log can tell an admin which
 * of the two they are looking at — they are fixed in completely different places.
 */
const isTranscriptTenantBlock = (status, message) =>
  status === 403 && /transcripts?\b.*disabled|disabled.*transcripts?\b/i.test(message || '');

/**
 * Set once Graph reports the tenant-level transcript block, and thereafter used
 * to SKIP the call entirely rather than merely to quieten the log.
 *
 * Without this the sweep asked for transcripts on every due booking on every
 * tick and collected a 403 each time — with 15 pending bookings on a 15-minute
 * cadence that is ~1,400 pointless calls a day against a shared throttling
 * budget, all to re-learn a tenant setting that cannot change while the process
 * is running.
 *
 * Deliberately NOT persisted: an admin turning the tenant switch on should not
 * have to wait for a cache to expire — a backend restart picks transcripts back
 * up, and a restart is already part of applying that kind of change.
 */
let transcriptsTenantBlocked = false;

/**
 * Lists one meeting's artifacts of a given kind.
 *
 * Uses the PER-MEETING endpoint rather than getAllRecordings(delta). We already
 * hold the online_meeting_id on every booking, so this maps an artifact to its
 * schedule row deterministically, with no delta token to keep in sync and no
 * exposure to the documented duplicate-on-token-reset issue. The organizer-wide
 * export API is the right tool at a volume we do not have — a handful of
 * interviews a day means a handful of cheap calls.
 *
 * @param {string} onlineMeetingId - rpa_interview_schedule.online_meeting_id
 * @param {'recordings'|'transcripts'} kind
 * @returns {Promise<Array<object>|null>} Graph artifacts, [] when there are none
 *   (readable but empty), or null when unreadable (disabled / 403 / error).
 */
async function listArtifacts(onlineMeetingId, kind) {
  if (!isRecordingFetchEnabled() || !onlineMeetingId) return null;
  // Known-blocked tenant: do not spend a call to be told so again.
  if (kind === 'transcripts' && transcriptsTenantBlocked) return null;
  try {
    const token = await getAccessToken();
    // onlineMeetings requires the mailbox's object GUID in the path (a UPN 400s).
    const userId = await resolveUserId(organizerMailbox());
    if (!userId) return null;

    const res = await fetch(
      `${GRAPH_BASE}/users/${encodeURIComponent(userId)}/onlineMeetings/${encodeURIComponent(onlineMeetingId)}/${kind}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const detail = body?.error?.message || res.statusText;

      if (kind === 'transcripts' && isTranscriptTenantBlock(res.status, detail)) {
        // Latch it: this is a standing tenant configuration, not an incident, so
        // every later transcript call this process would make is skipped (see
        // the flag's comment) and the log carries exactly one line about it.
        transcriptsTenantBlocked = true;
        logger.warn(
          'Graph recording: transcripts are blocked by a TENANT setting, not by permissions — '
          + 'Teams admin center → Meetings → Meeting settings → Transcript API access → Microsoft Graph access. '
          + 'Recordings are unaffected. Transcript calls are now skipped until the backend restarts.'
        );
        return null;
      }

      // A meeting older than 60 days has expired and its artifacts are no longer
      // readable through this endpoint — expected for a backfill, not a fault.
      logger.warn(`Graph recording: ${kind} list failed (${res.status}) for meeting ${onlineMeetingId} — ${detail}.`);
      return null;
    }

    const data = await res.json();
    return data?.value || [];
  } catch (err) {
    logger.warn(`Graph recording: ${kind} list threw for meeting ${onlineMeetingId} — ${err.message}.`);
    return null;
  }
}

/**
 * Normalizes a Graph callRecording / callTranscript into the shape the sweep
 * persists. Recordings and transcripts differ only in which content URL field
 * they carry, so one mapper serves both.
 *
 * @param {object} artifact - a callRecording or callTranscript
 * @param {'recording'|'transcript'} kind
 * @returns {{graphId: string, kind: string, contentUrl: string|null, startAt: Date|null, endAt: Date|null}|null}
 */
function normalize(artifact, kind) {
  const graphId = artifact?.id;
  if (!graphId) return null;
  return {
    graphId,
    kind,
    contentUrl: artifact.recordingContentUrl || artifact.transcriptContentUrl || null,
    // createdDateTime is the START of the recording, per Microsoft's export docs.
    startAt: artifact.createdDateTime ? new Date(artifact.createdDateTime) : null,
    endAt: artifact.endDateTime ? new Date(artifact.endDateTime) : null,
  };
}

/**
 * Opens a recording's bytes for archiving: the stream plus its exact size.
 *
 * The size is discovered with a one-byte range request rather than taken from a
 * Content-Length header, because Graph's streaming responses do not reliably
 * carry one — and the resumable upload needs the exact total in every chunk's
 * Content-Range, so guessing is not an option.
 *
 * @param {string} contentUrl - rpa_interview_recording.graph_content_url
 * @returns {Promise<{stream: ReadableStream, totalBytes: number, contentType: string}>}
 * @throws {Error} when the size cannot be established or the fetch fails
 */
export async function openRecordingContent(contentUrl) {
  const token = await getAccessToken();

  const probe = await fetch(contentUrl, {
    headers: { Authorization: `Bearer ${token}`, Range: 'bytes=0-0' },
  });
  if (!probe.ok && probe.status !== 206) {
    throw new Error(`Could not read the recording (probe returned ${probe.status}).`);
  }
  // "bytes 0-0/1501627" — the total is what we are after.
  const total = Number((probe.headers.get('content-range') || '').split('/')[1]);
  // Drain the single probe byte so the connection is not left half-open.
  await probe.arrayBuffer().catch(() => {});
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error('Could not determine the recording size; refusing to upload without it.');
  }

  const full = await fetch(contentUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!full.ok || !full.body) {
    throw new Error(`Could not open the recording stream (${full.status}).`);
  }
  return {
    stream: full.body,
    totalBytes: total,
    contentType: full.headers.get('content-type') || 'video/mp4',
  };
}

/**
 * Every artifact belonging to one meeting — recordings first, then transcripts.
 *
 * Transcripts are additive: when the tenant switch is off they are simply absent
 * and the recordings still come back, so a blocked transcript never costs us the
 * recording. That is why the two lists are fetched independently rather than
 * failing together.
 *
 * @param {string} onlineMeetingId
 * @returns {Promise<{artifacts: Array<object>, readable: boolean}>}
 *   readable:false means we could not tell (so the caller must not conclude
 *   "this interview was never recorded"); readable:true with an empty array
 *   means Graph answered and there is genuinely nothing there yet.
 */
export async function listMeetingArtifacts(onlineMeetingId) {
  const recordings = await listArtifacts(onlineMeetingId, 'recordings');
  const transcripts = await listArtifacts(onlineMeetingId, 'transcripts');

  // Readability is decided by the RECORDING call alone. Transcripts are blocked
  // tenant-wide right now, so letting them vote would make every meeting look
  // unreadable and stall discovery on the artifact we can actually get.
  if (recordings === null) return { artifacts: [], readable: false };

  const artifacts = [
    ...recordings.map((r) => normalize(r, 'recording')),
    ...(transcripts || []).map((t) => normalize(t, 'transcript')),
  ].filter(Boolean);

  return { artifacts, readable: true };
}
