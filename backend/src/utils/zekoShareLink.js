/**
 * zekoShareLink.js — the pure parts of turning a stored Zeko report link into a
 * link an outsider can actually open.
 *
 * THE PROBLEM THIS SOLVES. What we store per screening round
 * (rpa_zeko_interview_results.reportlink) is Zeko's RECRUITER report page:
 *
 *   https://app.zeko.ai/app/new-report?candidateId=<c>&jobId=<j>&tab=Overview
 *
 * That URL is behind Zeko's own login. Putting it in a candidate dossier — a
 * file whose entire acceptance criterion is "opens with no login" — would hand
 * an external interviewer a sign-in wall, which is why Phase 1 deliberately
 * carried only the FACT that a report existed (plan §6 decision #8).
 *
 * Zeko's report page has a Share button that mints a public, no-login view of
 * the same report:
 *
 *   GET  {reportApiBase}/report/generate-link?candidateId=&jobId=[&responseId=]
 *   →    { "data": { "link": "6a8c3ad13618d4d5f8ed1607" } }
 *   →    https://app.zeko.ai/app/shared-report?linkId=6a8c3ad13618d4d5f8ed1607
 *
 * Splitting the URL handling out from zeko.service.js is the same constraint
 * dossierModel.js documents: that service imports the Outlook reader (for the
 * OTP login), whose chain holds the event loop open, so nothing importing it can
 * be reached from `node --test`. These two functions are where the parsing
 * mistakes would live, so they are where the tests need to reach.
 *
 * Plan: docs/phase3/CANDIDATE-COMPLETE-DOWNLOAD-PLAN.md §9 Phase 3.
 */
import config from '../config/index.js';

/**
 * Pull the two Zeko ids out of a stored report link.
 *
 * Parsed rather than stored as columns because zekoReportUrl() builds this URL
 * from exactly these two ids on every sync (zeko.service.js), so the link IS the
 * record of them — adding two columns holding what the third column already
 * spells out would give the pair somewhere to disagree.
 *
 * Tolerant of anything that is not a Zeko report URL: rows written before that
 * function existed hold a shared-report link or a bare id, and a dossier must
 * degrade to "ask the recruiter" rather than throw on one.
 *
 * @param {string|null|undefined} url
 * @returns {{ candidateId: string, jobId: string }|null}
 */
export function parseZekoReportUrl(url) {
  if (!url || typeof url !== 'string') return null;
  let parsed;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  const candidateId = parsed.searchParams.get('candidateId');
  const jobId = parsed.searchParams.get('jobId');
  if (!candidateId || !jobId) return null;
  return { candidateId, jobId };
}

/**
 * The public, no-login report URL for a minted link id.
 *
 * @param {string|null|undefined} linkId - the `data.link` value from generate-link
 * @returns {string|null}
 */
export function zekoSharedReportUrl(linkId) {
  const id = String(linkId || '').trim();
  if (!id) return null;
  return `${config.zeko.sharedReportLinkBase}?linkId=${encodeURIComponent(id)}`;
}

/**
 * The response id, recovered from a report payload's screen-recording URL.
 *
 * Zeko's own Share call sends `responseId` alongside the candidate and job ids.
 * It is NOT a field on the report payload — the only place it appears is inside
 * the recording player URL the report carries:
 *
 *   screenRecording: "https://app.zeko.ai/app/play-sr?responseId=<r>"
 *
 * Verified against staging on 2026-09-03: generate-link returns the SAME link id
 * with or without `responseId`, so this is the fallback for the day that stops
 * being true, not the normal path — see generateZekoShareLink().
 *
 * @param {object|null} report - the report's `data.data` object
 * @returns {string|null}
 */
export function parseZekoResponseId(report) {
  const raw = report?.screenRecording;
  if (!raw || typeof raw !== 'string') return null;
  return /[?&]responseId=([A-Za-z0-9_-]+)/.exec(raw)?.[1] || null;
}

export default { parseZekoReportUrl, zekoSharedReportUrl, parseZekoResponseId };
