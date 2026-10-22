/**
 * interviewRecording.service.js — reading interview recordings back out, under
 * access control, for the people entitled to review them.
 *
 * WHO MAY SEE A RECORDING (decision, plan §0.4): recruiter-tier and above —
 * recruiter, the legacy `hr` alias, admin, superadmin. Vendors never.
 *
 * That gate is NOT re-implemented here as a role list. The whole /api/pipeline
 * router already runs `requireStaff`, which is RANK-based (`rank >= recruiter`)
 * precisely so a future low-privilege role is denied by default rather than
 * needing to be remembered in every hardcoded list. Duplicating the list here
 * would reintroduce the failure mode that middleware exists to prevent, so
 * canViewRecordings() below uses the same rank comparison.
 *
 * WHO MAY NOT: interviewers. They are not application users at all — their only
 * touchpoint is the tokenised scorecard page, whose response is built from a
 * fixed set of named fields (getScorecardByToken) and has never carried
 * recording data. The exclusion is therefore structural rather than a filter
 * somebody has to remember to apply.
 *
 * NOTHING HERE EVER RETURNS graph_content_url. That URL is only usable with the
 * application's own Graph token; handing it to a browser would either leak the
 * token or produce a dead link. Playback goes through our proxy instead, which
 * checks permission and records who watched.
 */
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import config from '../config/index.js';
import AppError from '../utils/AppError.js';
import { ROLE_RANK, normalizeRole } from '../config/roles.js';

/**
 * True when this role may see interview recordings.
 *
 * Rank-based, mirroring requireStaff — see the module header for why this is not
 * a list of role names.
 *
 * @param {string|null|undefined} role
 * @returns {boolean}
 */
export const canViewRecordings = (role) =>
  (ROLE_RANK[normalizeRole(role)] ?? 0) >= ROLE_RANK.recruiter;

/**
 * The browser-safe view of a recording row.
 *
 * Deliberately a whitelist rather than a blacklist: a new column added to
 * rpa_interview_recording is invisible to the API until someone consciously adds
 * it here. The one column that must never appear — graph_content_url — is
 * therefore excluded by construction and not by a `delete` somebody could drop.
 *
 * @param {object} row - an rpa_interview_recording row
 * @returns {object}
 */
export function serializeRecording(row) {
  const start = row.recorded_start_at ? new Date(row.recorded_start_at) : null;
  const end = row.recorded_end_at ? new Date(row.recorded_end_at) : null;
  return {
    id: Number(row.id),
    schedule_id: Number(row.schedule_id),
    stage_key: row.stage_key,
    kind: row.kind,
    recorded_start_at: row.recorded_start_at,
    recorded_end_at: row.recorded_end_at,
    // Precomputed so every caller renders the same duration from the same rule.
    duration_seconds: start && end ? Math.max(0, Math.round((end - start) / 1000)) : null,
    archive_status: row.archive_status,
    // Whether playback is possible at all, without saying where from.
    playable: Boolean(row.graph_content_url || row.archive_item_id),
    discovered_at: row.discovered_at,
  };
}

/**
 * Every recording linked to a candidate's journey, newest round first.
 *
 * Metadata only, and deliberately NOT audited: listing what exists is not
 * watching someone's interview. The audit row is written when the content is
 * actually streamed (see logRecordingView).
 *
 * @param {number|string} pipelineId
 * @returns {Promise<Array<object>>}
 */
export async function getRecordingsForPipeline(pipelineId) {
  const rows = await prisma.rpa_interview_recording.findMany({
    where: { pipeline_id: BigInt(pipelineId) },
    orderBy: [{ recorded_start_at: 'desc' }, { id: 'desc' }],
  });
  return rows.map(serializeRecording);
}

/**
 * One recording, with the fields the stream proxy needs (including the Graph
 * URL, which stays server-side).
 *
 * Scoped by pipelineId as well as id on purpose: without it, any staff user
 * could stream any recording by guessing an id, and the pipeline in the URL
 * would be decorative. This makes the URL's own pipeline the authority.
 *
 * @param {number|string} pipelineId
 * @param {number|string} recordingId
 * @returns {Promise<object>} the raw row
 * @throws {AppError} 404 when it does not belong to that journey
 */
export async function getRecordingForStream(pipelineId, recordingId) {
  const row = await prisma.rpa_interview_recording.findFirst({
    where: { id: BigInt(recordingId), pipeline_id: BigInt(pipelineId) },
  });
  if (!row) throw new AppError('Recording not found for this candidate.', 404);
  if (!row.graph_content_url && !row.archive_item_id) {
    throw new AppError('This recording has no playable content yet.', 409);
  }
  return row;
}

/**
 * Where to actually fetch the bytes from, in priority order.
 *
 * OUR ARCHIVED COPY WINS whenever it exists. That ordering is the entire point
 * of archiving: the Teams original sits in one employee's personal OneDrive and
 * stops being readable through Graph roughly 60 days after the meeting, so a
 * player that preferred the original would keep working right up until the day
 * it silently didn't. Preferring the copy means the archive is exercised every
 * time, rather than being an untested backup nobody discovers is broken until
 * they need it.
 *
 * @param {object} row - an rpa_interview_recording row
 * @returns {{url: string, source: 'archive'|'teams'}}
 */
export function resolveStreamSource(row) {
  if (row.archive_item_id) {
    const owner = config.microsoft.defaultSender;
    const driveBase = owner
      ? `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(owner)}/drive`
      : 'https://graph.microsoft.com/v1.0/drive';
    return { url: `${driveBase}/items/${row.archive_item_id}/content`, source: 'archive' };
  }
  return { url: row.graph_content_url, source: 'teams' };
}

/**
 * Records that a named person opened a recording.
 *
 * Written onto the journey's own stage timeline, against the round the recording
 * belongs to, so it reads in context: "Tech 1 recording viewed by …" sits next to
 * the Tech 1 booking rather than in a separate log nobody opens.
 *
 * WHY THIS MATTERS MORE HERE THAN ELSEWHERE: access was deliberately left broad
 * (every recruiter can see every recording — plan §0.4) instead of a per-user
 * toggle. That trade was made on the understanding that viewing is recorded. If
 * this ever stops being written, the access model loses its only control.
 *
 * Best-effort: a failed audit write must not deny someone a recording they are
 * entitled to watch, but it is logged loudly because a silent gap in an audit
 * trail is worse than a noisy one.
 *
 * @param {object} row - the rpa_interview_recording row being opened
 * @param {object} user - req.user
 */
export async function logRecordingView(row, user) {
  const who = user?.username || user?.email || `user ${user?.id ?? 'unknown'}`;
  try {
    await prisma.rpa_pipeline_stage_events.create({
      data: {
        pipeline_id: row.pipeline_id,
        stage_key: row.stage_key,
        event_type: 'note',
        notes: `Interview ${row.kind} opened by ${who}`,
        acted_by: user?.id || null,
      },
    });
  } catch (err) {
    logger.error(
      `AUDIT GAP: could not record that ${who} opened recording ${row.id} `
      + `(pipeline ${row.pipeline_id}, ${row.stage_key}) — ${err.message}`
    );
  }
}
