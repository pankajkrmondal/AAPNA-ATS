/**
 * U08: the tracked Zeko link a candidate clicks in our email (/api/z/<token>)
 * and the optional phone page behind it (/zeko-start/<token>).
 *
 * The token (rpa_zeko_candidate_pipeline.link_token, a uuid) is the only
 * credential. What it reveals is kept to the candidate's first name, the role
 * and the job's own Zeko link: the page needs nothing more.
 *
 * Phone source: rpa_cv.ContactNumber via the shortlist's cv_id, the same number
 * scheduleInterview() sends to Zeko. A booking with no cv_id goes straight to
 * Zeko, since there is nowhere to store a number.
 */
import prisma from '../config/database.js';
import config from '../config/index.js';
import logger from '../config/logger.js';
import AppError from '../utils/AppError.js';
import { maskPhone } from '../utils/phone.js';
import {
  isZekoLinkToken,
  usablePhone,
  parseCandidatePhone,
  mergeCandidatePhone,
  zekoLinkState,
  decideZekoRedirect,
  zekoJobUrl,
  firstName,
} from '../utils/zekoLinkModel.js';

/**
 * One booking by its token, with what the redirect and the page need.
 * @param {string} token - already checked with isZekoLinkToken()
 */
async function loadByToken(token) {
  const [row] = await prisma.$queryRaw`
    SELECT z.id, z.status, z.cancelled_at, z.completed_at, z.interview_end_at, z.link_token::text AS link_token,
           sc.candidate_name, sc.cv_id,
           COALESCE(j.title, m.position_hiring_for, sc.position_applied) AS role,
           j.slug,
           cv."ContactNumber" AS contact_number
    FROM public.rpa_zeko_candidate_pipeline z
    JOIN public.rpa_shortlisted_candidates sc ON sc.id = z.candidate_id
    LEFT JOIN public.rpa_zeko_jobs j ON j.zeko_id = z.zeko_job_id
    LEFT JOIN public.rpa_mrf m ON m.id = sc.mrf_id
    LEFT JOIN public.rpa_cv cv ON cv.id = sc.cv_id
    WHERE z.link_token = ${token}::uuid
    LIMIT 1`;
  return row || null;
}

/** The facts every handler below works from. */
function describe(row, now = new Date()) {
  const state = zekoLinkState(row, now);
  const zekoUrl = zekoJobUrl(row?.slug, config.zeko.interviewLinkBase);
  return {
    state: state === 'open' && !zekoUrl ? 'unavailable' : state,
    zekoUrl,
    hasCv: row?.cv_id != null,
    phone: usablePhone(row?.contact_number),
  };
}

/** The frontend page for a token (or for "invalid", which /info answers 404). */
export function zekoStartPageUrl(token) {
  const safe = isZekoLinkToken(token) ? token : 'invalid';
  return `${config.cors.frontendUrl}/zeko-start/${safe}`;
}

/**
 * GET /api/z/:token — where to send the browser.
 * @param {string} token
 * @returns {Promise<string>} an absolute URL
 */
export async function resolveZekoLinkRedirect(token) {
  if (!isZekoLinkToken(token)) return zekoStartPageUrl(token);
  const row = await loadByToken(token);
  if (!row) return zekoStartPageUrl(token);
  const facts = describe(row);
  if (decideZekoRedirect(facts) === 'zeko') return facts.zekoUrl;
  logger.info(`Zeko link ${row.id}: ${facts.state}${facts.state === 'open' ? ', no phone on file' : ''}; sent to /zeko-start.`);
  return zekoStartPageUrl(token);
}

/**
 * GET /api/z/:token/info — what the /zeko-start page shows.
 * @param {string} token
 * @returns {Promise<{state: string, firstName: string, role: string|null, zekoUrl: string|null}>}
 *   zekoUrl only while the window is open
 */
export async function getZekoLinkInfo(token) {
  const row = isZekoLinkToken(token) ? await loadByToken(token) : null;
  if (!row) throw new AppError('This interview link is not valid. Please use the link in your latest email from us.', 404);
  const facts = describe(row);
  return {
    state: facts.state,
    firstName: firstName(row.candidate_name),
    role: row.role || null,
    zekoUrl: facts.state === 'open' ? facts.zekoUrl : null,
  };
}

/**
 * POST /api/z/:token/phone — saves the number (first in the list, U05's
 * prependUnique) and returns the Zeko link to continue to.
 *
 * @param {string} token
 * @param {unknown} rawPhone
 * @returns {Promise<{zekoUrl: string, saved: boolean}>}
 */
export async function saveZekoLinkPhone(token, rawPhone) {
  const row = isZekoLinkToken(token) ? await loadByToken(token) : null;
  if (!row) throw new AppError('This interview link is not valid. Please use the link in your latest email from us.', 404);
  const facts = describe(row);
  if (facts.state !== 'open') {
    throw new AppError('This interview is no longer open, so there is nothing to continue to.', 409);
  }
  const phone = parseCandidatePhone(rawPhone);
  if (!phone) {
    throw new AppError('Enter a 10-digit Indian mobile number, for example 98765 43210 or +91 98765 43210.', 400);
  }
  if (!facts.hasCv) return { zekoUrl: facts.zekoUrl, saved: false };

  const now = new Date();
  await prisma.$transaction([
    prisma.rpa_cv.update({
      where: { id: BigInt(row.cv_id) },
      data: { ContactNumber: mergeCandidatePhone(row.contact_number, phone), modifiedAt: now },
    }),
    prisma.rpa_zeko_candidate_pipeline.update({ where: { id: row.id }, data: { phone_captured_at: now } }),
  ]);
  logger.info(`Zeko link ${row.id}: candidate added phone ${maskPhone(phone)} on /zeko-start (cv ${row.cv_id}).`);
  return { zekoUrl: facts.zekoUrl, saved: true };
}

export default { resolveZekoLinkRedirect, getZekoLinkInfo, saveZekoLinkPhone, zekoStartPageUrl };
