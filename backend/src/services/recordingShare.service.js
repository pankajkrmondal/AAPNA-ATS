/**
 * recordingShare.service.js — minting, listing, revoking and validating the
 * no-login links that let an external interviewer watch one interview round.
 *
 * This is the only place in the ATS where content is served to someone with no
 * account and no session, so the guarantees the authenticated player makes have
 * to be re-made here rather than assumed:
 *
 *   - the Graph content URL never reaches a browser (resolveStreamSource stays
 *     server-side, exactly as interviewRecording.service.js's header promises);
 *   - expiry and revocation are checked on the server on every request, never
 *     trusted from the URL;
 *   - every open is written onto the candidate's own timeline, attributed to an
 *     external viewer rather than to a username nobody can point at.
 *
 * Plan: docs/phase3/CANDIDATE-COMPLETE-DOWNLOAD-PLAN.md §6.5.
 */
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import config from '../config/index.js';
import AppError from '../utils/AppError.js';
import { serializeRecording } from './interviewRecording.service.js';
import { EXPORT_TIMEZONE } from '../utils/csvExport.js';
import {
  SHARE_STATES, describeShareLink, isShareToken, shareExpiryFrom, shareLinkState, shareUrlFor,
} from '../utils/recordingShareModel.js';

/**
 * How long one sitting lasts, for the purposes of counting an open.
 *
 * A player streaming an hour-long interview issues many range requests; each is
 * an "open" only in the sense that a page-turn is opening a book. Anything after
 * a gap this long is treated as somebody coming back — or somebody else arriving
 * — and is counted and written to the timeline. See logShareStreamView().
 */
const STREAM_SITTING_MS = 30 * 60 * 1000;

/**
 * Mint (or reuse) a live link for each of a journey's recordings.
 *
 * REUSE RATHER THAN RE-MINT. A recruiter who downloads a second pack for the
 * same candidate — a correction, a second interviewer — must not leave a trail
 * of live URLs behind, each of which has to be found and revoked separately. So
 * an existing link that is still live is handed back unchanged, and its expiry
 * is NOT extended: renewing it on every download would make a 14-day link
 * effectively permanent for a candidate whose pack gets sent around.
 *
 * ONLY ON DOWNLOAD, NEVER ON PREVIEW — the same rule the Zeko share link
 * follows. Opening the "what will be shared" dialog must not create public URLs
 * to someone's interview as a side effect of looking.
 *
 * `playable` is reported back, and it is not bookkeeping: it is what lets the
 * caller tell "we could not mint a link" from "there was nothing to mint one
 * for". Without it a candidate whose rounds are recorded but not yet archived
 * produced a pack warning that a file could not be attached — the same
 * absence-is-not-failure confusion applyAttachments() had to learn.
 *
 * @param {number|string} pipelineId
 * @param {{ recordings?: Array<object>, user?: object }} options
 * @returns {Promise<{links: Map<number, object>, minted: number, reused: number,
 *   playable: number, degraded: boolean}>}
 */
export async function mintShareLinks(pipelineId, { recordings = [], user = null } = {}) {
  const links = new Map();
  let minted = 0;
  let reused = 0;
  let degraded = false;

  // A recording with nothing to play is not given a link. A URL that resolves to
  // "this recording has no content yet" is worse than no URL: the interviewer
  // cannot tell our bug from their browser's.
  const playable = recordings.filter((r) => r.graph_content_url || r.archive_item_id);

  for (const recording of playable) {
    try {
      const existing = await prisma.rpa_recording_share_link.findFirst({
        where: {
          recording_id: BigInt(recording.id),
          revoked_at: null,
          expires_at: { gt: new Date() },
        },
        orderBy: { created_at: 'desc' },
      });

      if (existing) {
        links.set(Number(recording.id), existing);
        reused += 1;
        continue;
      }

      const created = await prisma.rpa_recording_share_link.create({
        data: {
          recording_id: BigInt(recording.id),
          pipeline_id: BigInt(pipelineId),
          expires_at: shareExpiryFrom(config.dossier.shareLinkDays),
          created_by: user?.username || user?.email || null,
          created_by_id: user?.id || null,
        },
      });
      links.set(Number(recording.id), created);
      minted += 1;
    } catch (err) {
      // Degrade, never fail: a pack without a recording link is still the thing
      // the recruiter asked for, and the manifest says what happened.
      degraded = true;
      logger.error(
        `Recording share link could not be minted for recording ${recording.id} `
        + `(pipeline ${pipelineId}): ${err.message}`,
      );
    }
  }

  return {
    links, minted, reused, playable: playable.length, degraded,
  };
}

/**
 * Every share link ever minted for a journey, newest first, for the drawer.
 *
 * Expired and revoked links are INCLUDED. The list's job is to answer "what did
 * we send out, and is it still open?", and a list that quietly drops the dead
 * ones cannot answer the first half — nor show a recruiter that the revoke they
 * clicked last week actually took.
 *
 * @param {number|string} pipelineId
 */
export async function listShareLinks(pipelineId) {
  const rows = await prisma.rpa_recording_share_link.findMany({
    where: { pipeline_id: BigInt(pipelineId) },
    orderBy: [{ created_at: 'desc' }],
  });
  if (rows.length === 0) return [];

  const recordings = await prisma.rpa_interview_recording.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.recording_id))] } },
  });
  const byId = new Map(recordings.map((r) => [Number(r.id), r]));
  const stages = await prisma.rpa_pipeline_stages.findMany({
    select: { stage_key: true, label: true },
  });
  const labelByKey = Object.fromEntries(stages.map((s) => [s.stage_key, s.label]));

  const now = new Date();
  return rows.map((row) => {
    const recording = byId.get(Number(row.recording_id));
    // The pack's timezone, not the server's: a recruiter reading "Live until
    // 17 Sep" here and an interviewer reading "16 Sep" in the file they were
    // sent are looking at the same link.
    const described = describeShareLink(row, now, EXPORT_TIMEZONE);
    return {
      id: Number(row.id),
      recording_id: Number(row.recording_id),
      // The round, so a recruiter revoking one knows which interview they are
      // closing off — "link 3" means nothing at the moment it matters.
      stage_label: recording ? (labelByKey[recording.stage_key] || recording.stage_key) : 'Unknown round',
      recorded_start_at: recording?.recorded_start_at || null,
      state: described.state,
      summary: described.summary,
      view_count: described.views,
      unusual: described.unusual,
      expires_at: row.expires_at,
      created_at: row.created_at,
      created_by: row.created_by,
      revoked_at: row.revoked_at,
      revoked_by: row.revoked_by,
      // The URL itself, so the recruiter can re-send a link they still have a
      // right to hand out without downloading a whole new pack.
      url: shareLinkState(row, now) === SHARE_STATES.LIVE
        ? shareUrlFor(row.token, config.publicBaseUrl)
        : null,
    };
  });
}

/**
 * Withdraw one link, immediately.
 *
 * Idempotent: revoking an already-revoked link is not an error, because the
 * recruiter's intent ("this must not play") is already satisfied and an error
 * would suggest it is not.
 *
 * @param {number|string} pipelineId
 * @param {number|string} linkId
 * @param {object} user
 */
export async function revokeShareLink(pipelineId, linkId, user) {
  const link = await prisma.rpa_recording_share_link.findFirst({
    // Scoped by pipeline as well as id, so the journey in the URL is the
    // authority — the same reason getRecordingForStream() scopes its lookup.
    where: { id: BigInt(linkId), pipeline_id: BigInt(pipelineId) },
  });
  if (!link) throw new AppError('Share link not found for this candidate.', 404);
  if (link.revoked_at) return { id: Number(link.id), already_revoked: true };

  const updated = await prisma.rpa_recording_share_link.update({
    where: { id: link.id },
    data: {
      revoked_at: new Date(),
      revoked_by: user?.username || user?.email || null,
      revoked_by_id: user?.id || null,
    },
  });

  // On the timeline, not only in a table: the people who need to know a link was
  // withdrawn are the ones reading the candidate's journey.
  try {
    const recording = await prisma.rpa_interview_recording.findUnique({
      where: { id: link.recording_id },
    });
    await prisma.rpa_pipeline_stage_events.create({
      data: {
        pipeline_id: link.pipeline_id,
        stage_key: recording?.stage_key || 'tech1',
        event_type: 'note',
        notes: `Recording share link revoked by ${user?.username || user?.email || 'a recruiter'} `
          + `— it had been opened ${link.view_count || 0} time(s).`,
        acted_by: user?.id || null,
      },
    });
  } catch (err) {
    logger.error(`AUDIT GAP: share link ${linkId} was revoked but the timeline note failed — ${err.message}`);
  }

  return { id: Number(updated.id), already_revoked: false };
}

/**
 * Resolve a token to the link and its recording, or say why not.
 *
 * Returns the state rather than throwing, because the caller renders a page for
 * a human rather than a JSON error — and because every refusal reads the same
 * to the holder (see shareRefusal): distinguishing them would confirm to
 * whoever found a leaked link that it was once real.
 *
 * @param {string} token
 * @returns {Promise<{state: string, link: object|null, recording: object|null}>}
 */
export async function resolveShareToken(token) {
  // A malformed token must not reach Prisma's uuid parser as an exception —
  // the public route is the one place where a hostile string is expected, and
  // a throw there is a 500 where the friendly "no longer available" page
  // belongs. isShareToken() checks the real UUID shape: a character-class test
  // would let 36 dashes through, which is exactly what Prisma rejects.
  if (!isShareToken(token)) {
    return { state: SHARE_STATES.MISSING, link: null, recording: null };
  }

  const link = await prisma.rpa_recording_share_link.findUnique({ where: { token } });
  const state = shareLinkState(link);
  if (state !== SHARE_STATES.LIVE) return { state, link, recording: null };

  const recording = await prisma.rpa_interview_recording.findUnique({
    where: { id: link.recording_id },
  });
  if (!recording || (!recording.graph_content_url && !recording.archive_item_id)) {
    // The link is valid but there is nothing behind it any more. Treated as
    // expired for the viewer — same sentence, no detail — and logged loudly,
    // because it means an archive went missing while a link was live.
    logger.warn(`Share link ${link.id} is live but recording ${link.recording_id} has no playable content.`);
    return { state: SHARE_STATES.EXPIRED, link, recording: null };
  }
  return { state: SHARE_STATES.LIVE, link, recording };
}

/**
 * Record that somebody outside the company opened a recording.
 *
 * Written for the PAGE open, not for each byte range: a player seeking through
 * a video issues many requests, and a timeline with forty "recording viewed"
 * notes for one sitting is a timeline nobody reads.
 *
 * Attributed to "an external viewer" with the IP and user agent, deliberately
 * not to a name: we do not know who opened it, and inventing an attribution
 * would be worse than admitting that. The IP is what makes "one interviewer" and
 * "a link doing the rounds" distinguishable later.
 *
 * Best-effort, like logRecordingView() — a failed audit must not deny a viewer
 * a recording the recruiter meant them to watch, but it is logged loudly.
 *
 * @param {object} link
 * @param {object} recording
 * @param {{ip?: string, userAgent?: string}} viewer
 * @param {{direct?: boolean}} [options] - direct = the media URL was opened
 *   without the page that offers it (see logShareStreamView)
 */
export async function logShareView(link, recording, viewer = {}, { direct = false } = {}) {
  try {
    await prisma.rpa_recording_share_link.update({
      where: { id: link.id },
      data: { view_count: { increment: 1 }, last_viewed_at: new Date() },
    });
  } catch (err) {
    logger.error(`AUDIT GAP: could not count a view of share link ${link.id} — ${err.message}`);
  }

  try {
    const agent = String(viewer.userAgent || '').slice(0, 120);
    await prisma.rpa_pipeline_stage_events.create({
      data: {
        pipeline_id: recording.pipeline_id,
        stage_key: recording.stage_key,
        event_type: 'note',
        notes: `Interview ${recording.kind} opened by an external viewer via a share link`
          + `${direct ? ' (the media link directly, without the share page)' : ''}`
          + `${viewer.ip ? ` (IP ${viewer.ip})` : ''}${agent ? ` — ${agent}` : ''}.`,
        acted_by: null,
      },
    });
  } catch (err) {
    logger.error(
      `AUDIT GAP: an external viewer opened recording ${recording.id} via share link ${link.id} `
      + `and the timeline note failed — ${err.message}`,
    );
  }
}

/**
 * Whether a stream request begins a NEW sitting, and should therefore be counted.
 *
 * WHY THIS EXISTS. logShareView() counts the PAGE, on the assumption that the
 * page is how a recording gets watched. It is not the only way: "Copy video
 * address" in any browser yields the /stream URL, which plays on its own for the
 * life of the link. Everything the pack and the page promise about that link —
 * "every time it is opened is recorded against this candidate's file" — was
 * simply untrue for anyone who used it, and view_count, which is what flags a
 * link that has been passed around (describeShareLink's `unusual`), never moved.
 *
 * Counting every range request instead would bury the timeline: one interview is
 * dozens of them. So the last view is the clock — inside a sitting the timestamp
 * is refreshed and nothing else happens, which means a continuous watch can never
 * re-count itself however long it runs, and a stream opened cold is a view.
 *
 * Pure decision, so it is testable without a database.
 *
 * @param {Date|string|null|undefined} lastViewedAt
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isNewStreamSitting(lastViewedAt, now = new Date()) {
  if (!lastViewedAt) return true;
  const last = new Date(lastViewedAt).getTime();
  if (Number.isNaN(last)) return true;
  return now.getTime() - last >= STREAM_SITTING_MS;
}

/**
 * Record a stream request: a full view when it opens a sitting, otherwise only
 * the clock, so the sitting cannot expire under a viewer who is still watching.
 *
 * Best-effort throughout, like logShareView() — a failed audit must not stall a
 * recording the recruiter meant someone to watch.
 *
 * @param {object} link
 * @param {object} recording
 * @param {{ip?: string, userAgent?: string}} viewer
 * @returns {Promise<boolean>} whether this request was counted as a view
 */
export async function logShareStreamView(link, recording, viewer = {}) {
  if (!isNewStreamSitting(link.last_viewed_at)) {
    try {
      await prisma.rpa_recording_share_link.update({
        where: { id: link.id },
        data: { last_viewed_at: new Date() },
      });
    } catch (err) {
      logger.warn(`Could not extend the viewing session on share link ${link.id} — ${err.message}`);
    }
    return false;
  }

  await logShareView(link, recording, viewer, { direct: true });
  return true;
}

/**
 * The human name of the round a recording belongs to.
 *
 * The external viewer's page said "tech1 interview" because it printed the stage
 * KEY — a column name, shown to someone outside the company, in the one place
 * this system has no second chance to explain itself. Falls back to the key
 * rather than to nothing: an unlabelled round is still better than a blank
 * heading, and a stage renamed in the seed must not break the page.
 *
 * @param {string} stageKey
 * @returns {Promise<string>}
 */
export async function stageLabelFor(stageKey) {
  if (!stageKey) return 'Interview';
  try {
    const stage = await prisma.rpa_pipeline_stages.findUnique({
      where: { stage_key: stageKey },
      select: { label: true },
    });
    return stage?.label || stageKey;
  } catch (err) {
    logger.warn(`Could not resolve the stage label for "${stageKey}" — ${err.message}`);
    return stageKey;
  }
}

/**
 * What the pack says about a recording, for the dossier renderer.
 *
 * Metadata via serializeRecording() so the "graph_content_url never leaves"
 * whitelist governs this path too, plus the link and when it dies.
 */
export function serializeSharedRecording(recording, link) {
  return {
    ...serializeRecording(recording),
    share_url: link ? shareUrlFor(link.token, config.publicBaseUrl) : null,
    share_expires_at: link?.expires_at || null,
  };
}

export default {
  mintShareLinks,
  listShareLinks,
  revokeShareLink,
  resolveShareToken,
  logShareView,
  logShareStreamView,
  isNewStreamSitting,
  stageLabelFor,
  serializeSharedRecording,
};
