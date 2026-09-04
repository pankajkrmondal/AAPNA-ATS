/**
 * recordingShare.controller.js — the PUBLIC face of a recording share link.
 *
 * Two routes, and the split matters:
 *
 *   GET /api/recording-share/:token          a page a human opens
 *   GET /api/recording-share/:token/stream   the bytes that page plays
 *
 * A single route that served video directly would "work" — and would download a
 * 400 MB file into an interviewer's Downloads folder when they clicked a link in
 * an email, with no context, no expiry notice and no way to say why a dead link
 * is dead. The page is what makes those possible.
 *
 * NOTHING HERE IS AUTHENTICATED. The token is the only credential, so every
 * check that would normally live in middleware lives in the handler instead, and
 * every response is written on the assumption that the person reading it may be
 * someone the link was never meant for.
 *
 * Plan: docs/phase3/CANDIDATE-COMPLETE-DOWNLOAD-PLAN.md §6.5, §10.2a.
 */
import catchAsync from '../utils/catchAsync.js';
import logger from '../config/logger.js';
import config from '../config/index.js';
import { getAccessToken } from '../services/onedrive.service.js';
import { resolveStreamSource } from '../services/interviewRecording.service.js';
import {
  logShareStreamView, logShareView, resolveShareToken, stageLabelFor,
} from '../services/recordingShare.service.js';
import { SHARE_STATES, shareDate, shareRefusal } from '../utils/recordingShareModel.js';
import { esc } from '../exports/candidateDossier.export.js';
import { EXPORT_TIMEZONE } from '../utils/csvExport.js';

/** No caching, no sniffing, no framing — on every response this file sends. */
export function publicHeaders(res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // A share page embedded in someone else's site would put a candidate's
  // interview inside a frame we do not control.
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

/**
 * A self-contained page — no CDN, no webfont, no script.
 *
 * Exported so the rate limiter on these routes can answer in the same shape.
 * Everything else this file sends a human is an HTML page; a bare JSON body
 * for the one response they are most likely to be confused by (429, which
 * arrives mid-video with no explanation) was the odd one out.
 */
export function sharePage(title, body) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<title>${esc(title)}</title>
<style>
:root{--ink:#1b2430;--muted:#5b6875;--line:#dfe4ea;--band:#0f4c3a;--warn:#8a5300}
*{box-sizing:border-box}
body{margin:0;background:#f4f6f8;color:var(--ink);
  font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
.wrap{max-width:900px;margin:0 auto;background:#fff;min-height:100vh}
header{background:var(--band);color:#fff;padding:22px 28px}
.mark{font-size:11px;letter-spacing:.18em;text-transform:uppercase;opacity:.85}
h1{margin:8px 0 0;font-size:21px;line-height:1.25}
.note{background:#fdf3d7;border-bottom:1px solid #e8d9a8;color:var(--warn);
  padding:11px 28px;font-size:12.5px;font-weight:600}
main{padding:24px 28px 40px}
video{width:100%;background:#000;border-radius:6px}
dl{display:grid;grid-template-columns:auto 1fr;gap:6px 16px;margin:20px 0 0;font-size:13.5px}
dt{color:var(--muted)}
dd{margin:0}
.gone{padding:40px 0;text-align:center}
.gone p{color:var(--muted);max-width:38em;margin:10px auto}
footer{border-top:1px solid var(--line);margin:28px 28px 0;padding:16px 0 32px;
  color:var(--muted);font-size:12px}
</style></head><body><div class="wrap">${body}</div></body></html>`;
}

/**
 * GET /api/recording-share/:token
 *
 * The page. Also where a view is counted — see logShareView() for why the byte
 * range requests that follow are deliberately NOT counted as further views.
 */
export const getSharedRecordingPage = catchAsync(async (req, res) => {
  const { state, link, recording } = await resolveShareToken(req.params.token);
  publicHeaders(res);

  if (state !== SHARE_STATES.LIVE) {
    const refusal = shareRefusal(state);
    // Logged with the state the holder is NOT told, so the distinction survives
    // where it is useful — in our logs, not in their browser.
    logger.info(`Recording share link refused (${state}) from ${req.ip}.`);
    return res.status(refusal.status).type('html').send(sharePage(refusal.title, `
      <header><div class="mark">AAPNA Infotech</div><h1>${esc(refusal.title)}</h1></header>
      <main><div class="gone"><p>${esc(refusal.message)}</p></div></main>`));
  }

  await logShareView(link, recording, { ip: req.ip, userAgent: req.get('user-agent') });

  // The round's NAME, not its column value. This page printed "tech1 interview"
  // to someone outside the company — the one reader who has no way to work out
  // what that means, and nobody to ask.
  const round = await stageLabelFor(recording.stage_key);
  // Both dates are stated in the pack's timezone rather than the server's. A
  // page saying a link dies on the 16th while the file that carried it says the
  // 17th is not a rounding difference to whoever is trying to watch a round
  // before it closes.
  const when = recording.recorded_start_at
    ? new Date(recording.recorded_start_at).toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: EXPORT_TIMEZONE,
    })
    : null;
  const until = shareDate(link.expires_at, EXPORT_TIMEZONE);

  // The candidate is NOT named on this page, deliberately. Whoever the recruiter
  // sent the pack to already knows whose interview this is; a link that is
  // forwarded on its own should not introduce a stranger to a candidate by name.
  return res.type('html').send(sharePage('Interview recording', `
    <header><div class="mark">AAPNA Infotech · Interview recording</div>
      <h1>${esc(round)}</h1></header>
    <div class="note">CONFIDENTIAL — shared with a named interviewer. Please do not forward this link.</div>
    <main>
      <video controls preload="metadata" controlsList="nodownload"
             src="${esc(`${config.publicBaseUrl}/api/recording-share/${encodeURIComponent(req.params.token)}/stream`)}">
        Your browser cannot play this recording.
      </video>
      <dl>
        ${when ? `<dt>Recorded</dt><dd>${esc(when)}</dd>` : ''}
        <dt>Link expires</dt><dd>${esc(until)}</dd>
      </dl>
      <footer>
        This link opens without a login and stops working on ${esc(until)}. It can be withdrawn earlier by
        the recruiter who sent it. Every time it is opened is recorded against this candidate's file.
      </footer>
    </main>`));
});

/**
 * GET /api/recording-share/:token/stream
 *
 * Proxied, never redirected — the Graph content URL only works with the
 * application's own token, and handing a browser a redirect would either leak
 * that token or 401. That guarantee is made in interviewRecording.service.js's
 * header for the authenticated player; this route is why it has to hold for an
 * unauthenticated caller too.
 *
 * The token is re-resolved on every request rather than trusted from the page
 * that offered it: a link revoked while an interviewer is mid-video stops
 * serving the next range, which is what "revoked immediately" has to mean.
 *
 * AUDITED HERE TOO, not only on the page. This URL is one right-click ("Copy
 * video address") away from the page, plays on its own, and used to be invisible
 * to view_count and to the timeline — so the sentence printed above the player
 * and in the pack, "every time it is opened is recorded against this candidate's
 * file", was false for exactly the person who had gone out of their way to
 * bypass the page. logShareStreamView() counts a sitting rather than a range
 * request; see it for why the two must not be the same thing.
 */
export const streamSharedRecording = catchAsync(async (req, res) => {
  const { state, link, recording } = await resolveShareToken(req.params.token);
  publicHeaders(res);

  if (state !== SHARE_STATES.LIVE) {
    const refusal = shareRefusal(state);
    return res.status(refusal.status).json({ status: 'error', message: refusal.message });
  }

  await logShareStreamView(link, recording, { ip: req.ip, userAgent: req.get('user-agent') });

  const { url, source } = resolveStreamSource(recording);
  const token = await getAccessToken();
  const upstream = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      ...(req.headers.range ? { Range: req.headers.range } : {}),
    },
  });

  if (!upstream.ok && upstream.status !== 206) {
    logger.error(
      `Shared recording stream: ${source} source returned ${upstream.status} for recording ${recording.id}.`,
    );
    // Never a Graph error dump to an outsider (§10.2a item 8). An aged-out
    // Teams original and a broken archive read the same from here: gone.
    return res.status(upstream.status === 404 ? 410 : 502).json({
      status: 'error',
      message: 'This recording is no longer available. Please ask the recruiter who sent you the link.',
    });
  }

  res.status(upstream.status === 206 ? 206 : 200);
  for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const value = upstream.headers.get(header);
    if (value) res.setHeader(header, value);
  }

  if (!upstream.body) return res.end();
  const { Readable } = await import('node:stream');
  return Readable.fromWeb(upstream.body)
    .on('error', (err) => {
      logger.warn(`Shared recording stream aborted for recording ${recording.id} — ${err.message}`);
      res.destroy();
    })
    .pipe(res);
});

export default {
  getSharedRecordingPage, streamSharedRecording, sharePage, publicHeaders,
};
