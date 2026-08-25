import { Prisma } from '@prisma/client';
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import config from '../config/index.js';
import { fetchMessagesSince } from './outlookReader.service.js';
import { emailCandidates, emailMatchesSql } from '../utils/emailMatch.js';
import { emitToRole } from '../socket/index.js';
import { NOTIFY_ROLES } from './notification.service.js';

/**
 * Zeko background sync service.
 *
 * Migrates all three n8n workflows from the "Zeko" folder:
 *   1. "Zeko — FULLY AUTO Sync (API Key Auth)"  -> ensureZekoToken() (bearer, /api/v1)
 *   2. "Zeko — FULLY AUTO Sync (OTP Login)"     -> refreshZekoCookie() (cookie, /dashboard)
 *      + syncZekoJobs() (paged job catalog)
 *   3. "Step 3 — Zeko Auto Fetch Interview Results (Scheduled)" -> fetchInterviewResults()
 *
 * Two distinct auth domains:
 *   - /api/v1     authenticates with an API-key BEARER token (rpa_zeko_auth_token).
 *   - /dashboard  authenticates with an OTP-login COOKIE (rpa_zeko_auth_cookie). The
 *                 bearer token is rejected here (HTTP 401), so the OTP login is required.
 *
 * All functions are environment-agnostic — they act on whichever database DATABASE_URL
 * points at and use the env-specific ZEKO_CLIENT_ID / ZEKO_COMPANY_ID / ZEKO_LOGIN_EMAIL.
 */

const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));

/** A 'sent' interview older than this with no result is surfaced as a warning. */
const RESULT_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Picks the result belonging to one candidate out of an interview's responses.
 *
 * The responses endpoint returns EVERY candidate booked against that interview
 * (25+ rows is normal), so indexing data[0] would attribute a stranger's scores
 * to this candidate and then write them onto their rpa_cv row. Matching on email
 * is the only way to identify the right entry; when nothing matches we return
 * null so the caller skips rather than guesses.
 *
 * Two payload shapes are accepted: the dashboard responses endpoint puts the
 * address in a flat `candidateEmail`, while the older bearer results endpoint
 * nested it under `candidate.email`.
 *
 * @param {object[]} data - The response entries for one interview.
 * @param {string|null} candidateEmail - Our stored address(es) for the candidate.
 * @returns {object|null} The matching result entry, or null when absent.
 */
function findResultForCandidate(data, candidateEmail) {
  const wanted = new Set(emailCandidates(candidateEmail));
  if (wanted.size === 0) return null;
  return (
    data.find((entry) => {
      const entryEmail = entry?.candidateEmail || entry?.candidate?.email;
      if (!entryEmail) return false;
      return wanted.has(String(entryEmail).trim().toLowerCase());
    }) || null
  );
}

/**
 * Ensures a valid (non-expiring-soon) Zeko bearer token exists in rpa_zeko_auth_token,
 * minting a fresh one via the API-key grant when needed.
 *
 * Mirrors n8n nodes: "DB: Check Token Valid" -> "HTTP: Generate Zeko Token" ->
 * "Code: Extract Token" -> "DB: Save New Token".
 *
 * @returns {Promise<string>} A valid bearer access token.
 */
export async function ensureZekoToken() {
  // 1) Reuse the active token if it stays valid for at least 10 more minutes.
  const existing = await prisma.rpa_zeko_auth_token.findFirst({
    where: {
      is_active: true,
      expires_at: { gt: new Date(Date.now() + 10 * 60 * 1000) },
    },
    orderBy: { created_at: 'desc' },
  });
  if (existing?.access_token) {
    return existing.access_token;
  }

  // 2) Mint a new token via the API-key grant.
  if (!config.zeko.clientId || !config.zeko.apiKey) {
    throw new Error('Zeko token refresh skipped: ZEKO_CLIENT_ID / ZEKO_API_KEY not configured.');
  }

  const url = `${config.zeko.scheduleApiBase}/auth/token`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      clientId: config.zeko.clientId,
      apiKey: config.zeko.apiKey,
      expiresIn: 3600,
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.success || !body?.data?.accessToken) {
    throw new Error(`Zeko token generation failed (${res.status}): ${JSON.stringify(body)}`);
  }

  const accessToken = body.data.accessToken;
  const expiresIn = Number(body.data.expiresIn) || 3600;
  const expiresAt = new Date(Date.now() + expiresIn * 1000);

  // 3) Deactivate + purge old tokens, insert the new active one (single transaction).
  await prisma.$transaction([
    prisma.rpa_zeko_auth_token.updateMany({
      where: { is_active: true },
      data: { is_active: false },
    }),
    prisma.rpa_zeko_auth_token.deleteMany({ where: { is_active: false } }),
    prisma.rpa_zeko_auth_token.create({
      data: {
        access_token: accessToken,
        token_type: 'bearer',
        expires_in: expiresIn,
        expires_at: expiresAt,
        is_active: true,
        created_by: 'api_key_job',
      },
    }),
  ]);

  logger.info(`Zeko token refreshed; expires at ${expiresAt.toISOString()}`);
  return accessToken;
}

/**
 * Transforms a single Zeko dashboard "role" object into an rpa_zeko_jobs row.
 * Ported verbatim from the n8n "Code: Transform Roles" node.
 *
 * @param {object} r - Raw role object from the dashboard API.
 * @returns {object} Prisma-shaped data for rpa_zeko_jobs.
 */
function transformRole(r) {
  const steps = r.steps || [];
  const interviews = r.interviews || [];

  const gc = (name) => {
    const s = steps.find((st) => (st.name || '').toLowerCase().includes(name.toLowerCase()));
    return s ? s.count || s.total || 0 : 0;
  };

  const hn = (r.hiringName || r.title || '').toLowerCase();
  let interviewType = 'other';
  if (r.isHRScreeningInterviewPresent || hn.includes('hr')) interviewType = 'hr';
  else if (r.isCodingInterviewPresent || hn.includes('coding')) interviewType = 'coding';
  else if (hn.includes('functional')) interviewType = 'functional';

  let status = 'draft';
  if (r.isArchived) status = 'archived';
  else if (r.isPublished || r.isWorkflowPublished) status = 'published';

  const interviewIds = interviews.map((i) => ({
    _id: i._id,
    type: i.type,
    slug: i.slug,
    roleName: i.roleName,
  }));

  return {
    zeko_id: String(r._id),
    job_ref_id: r.jobRefId ? String(r.jobRefId) : null,
    title: String(r.title || r.hiringName || 'Untitled'),
    hiring_name: r.hiringName ? String(r.hiringName) : null,
    // r.designation is unreliable Zeko-side data (frequently the literal
    // string "NA", occasionally a stale value copied from an unrelated
    // posting) — the interview's own roleName is the clean, accurate value
    // Zeko's own dashboard displays as "Role".
    role_name: r.interviews?.[0]?.roleName || r.designation || r.title ? String(r.interviews?.[0]?.roleName || r.designation || r.title) : null,
    status,
    interview_type: interviewType,
    is_published: !!r.isPublished,
    is_workflow_pub: !!r.isWorkflowPublished,
    is_archived: !!r.isArchived,
    is_hr_screening: !!r.isHRScreeningInterviewPresent,
    is_coding: !!r.isCodingInterviewPresent,
    slug: r.slug ? String(r.slug) : null,
    email: r.email ? String(r.email) : null,
    company_name: r.name ? String(r.name) : 'Aapna Infotech',
    total_applicants: gc('Total Applicants') || 0,
    resume_count: gc('Resume') || 0,
    screening_count: gc('Screening') || gc('HR Screening') || 0,
    functional_count: gc('Functional') || 0,
    created_at_zeko: r.createdAt ? new Date(r.createdAt) : null,
    updated_at_zeko: r.updatedAt ? new Date(r.updatedAt) : null,
    raw_steps: JSON.stringify(steps),
    interview_ids: interviewIds,
    synced_at: new Date(),
  };
}

/** Normalizes a stored cookie value into a `Cookie` header (`authcookie=...`). */
function toCookieHeader(value) {
  return value.startsWith('authcookie=') ? value : `authcookie=${value}`;
}

/**
 * Verifies a dashboard cookie is actually accepted by Zeko (not just unexpired in
 * our DB). The DB row can say "valid" while Zeko has invalidated the session, which
 * is exactly the silent-401 failure the n8n cookie check could not detect.
 *
 * @param {string} cookieHeader - `authcookie=...`
 * @returns {Promise<boolean>} true if a lightweight dashboard call returns 2xx.
 */
async function isCookieLive(cookieHeader) {
  if (!config.zeko.companyId) return false;
  try {
    const url =
      `${config.zeko.dashboardApiBase}/workflow/${config.zeko.companyId}` +
      `?limit=1&page=1&published=true&notPublished=true&archived=true`;
    const res = await fetch(url, {
      headers: {
        Cookie: cookieHeader,
        Accept: 'application/json',
        Origin: 'https://app.zeko.ai',
        Referer: 'https://app.zeko.ai/app/role',
      },
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Performs the Zeko OTP login and stores a fresh dashboard cookie.
 *
 * Migrates n8n "Zeko — FULLY AUTO Sync (OTP Login)":
 *   "Request Zeko OTP" -> read OTP email -> "Extract OTP" -> "Submit OTP" ->
 *   "Extract & Store Cookie" -> "Save New Cookie".
 *
 * Improvements over the n8n original:
 *   - reuses the existing Microsoft Graph reader (fetchMessagesSince) instead of a
 *     bespoke Outlook node;
 *   - polls for the OTP email with retries instead of a fixed 15s wait.
 *
 * @returns {Promise<string>} A `Cookie` header value for the new cookie.
 */
export async function refreshZekoCookie() {
  const email = config.zeko.loginEmail;
  if (!email) {
    throw new Error('Zeko OTP login skipped: ZEKO_LOGIN_EMAIL / MS_DEFAULT_SENDER_EMAIL not set.');
  }

  // Mark the cutoff BEFORE requesting the OTP so we only read mail that arrives after.
  const sinceIso = new Date(Date.now() - 60 * 1000).toISOString();

  // 1) Request the OTP.
  const checkRes = await fetch(`${config.zeko.loginApiBase}/auth/check`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://app.zeko.ai',
      Referer: 'https://app.zeko.ai/app/login',
    },
    body: JSON.stringify({ email }),
  });
  if (!checkRes.ok) {
    const t = await checkRes.text().catch(() => '');
    throw new Error(`Zeko OTP request failed (${checkRes.status}): ${t}`);
  }

  // 2) Poll the mailbox for the Zeko OTP email (up to ~60s).
  let otp = null;
  for (let attempt = 0; attempt < 6 && !otp; attempt += 1) {
    await SLEEP(10 * 1000);
    let messages = [];
    try {
      messages = await fetchMessagesSince(sinceIso, { max: 25 });
    } catch (e) {
      logger.warn(`Zeko OTP: mailbox poll failed (attempt ${attempt + 1}): ${e.message}`);
      continue;
    }
    // Newest first; prefer Zeko-sender mails.
    const candidates = messages
      .slice()
      .reverse()
      .filter((m) => /zeko/i.test(m.fromEmail) || /zeko|otp|one-time/i.test(m.subject));
    const pool = candidates.length > 0 ? candidates : messages.slice().reverse();
    for (const m of pool) {
      otp = extractOtp(m.bodyHtml || m.bodyPreview || '');
      if (otp) break;
    }
  }
  if (!otp) {
    throw new Error('Zeko OTP not found in mailbox within timeout.');
  }

  // 3) Verify the OTP; capture the set-cookie.
  const verifyRes = await fetch(`${config.zeko.loginApiBase}/auth/verifyOtp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://app.zeko.ai',
      Referer: 'https://app.zeko.ai/app/login',
    },
    body: JSON.stringify({ email, otp }),
  });
  if (!verifyRes.ok) {
    const t = await verifyRes.text().catch(() => '');
    throw new Error(`Zeko OTP verify failed (${verifyRes.status}): ${t}`);
  }

  const setCookie = verifyRes.headers.get('set-cookie') || '';
  const match = setCookie.match(/authcookie=([^;\s]+)/);
  if (!match) {
    throw new Error('Zeko verifyOtp succeeded but no authcookie was returned.');
  }
  const cookieValue = match[1];
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

  // 4) Deactivate old cookies, store the new active one.
  await prisma.$transaction([
    prisma.rpa_zeko_auth_cookie.updateMany({
      where: { is_active: true },
      data: { is_active: false },
    }),
    prisma.rpa_zeko_auth_cookie.deleteMany({ where: { is_active: false } }),
    prisma.rpa_zeko_auth_cookie.create({
      data: {
        cookie_value: cookieValue,
        expires_at: expiresAt,
        is_active: true,
        created_by: 'auto_otp_job',
      },
    }),
  ]);

  logger.info(`Zeko dashboard cookie refreshed via OTP login; expires ${expiresAt.toISOString()}.`);
  return toCookieHeader(cookieValue);
}

/** Extracts a 6-digit Zeko OTP from an email body (HTML or text). Ported from n8n. */
function extractOtp(rawBody) {
  const plainText = String(rawBody || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();

  const match =
    plainText.match(/One-Time Password[^0-9]{0,20}([0-9]{6})/i) ||
    plainText.match(/\bOTP\b[^0-9]{0,10}([0-9]{6})/i) ||
    plainText.match(/is\s*:\s*([0-9]{6})/i) ||
    plainText.match(/\b([0-9]{6})\b/);
  return match ? match[1] : null;
}

/**
 * Resolves a *live* dashboard cookie header, refreshing via OTP login when needed.
 *
 * Strategy: use the stored active cookie only if a real dashboard ping accepts it;
 * otherwise run the OTP login to mint a fresh one.
 *
 * @returns {Promise<string>} A `Cookie` header value (`authcookie=...`).
 */
async function getDashboardCookieHeader() {
  const cookie = await prisma.rpa_zeko_auth_cookie.findFirst({
    where: { is_active: true, expires_at: { gt: new Date() } },
    orderBy: { created_at: 'desc' },
  });

  if (cookie?.cookie_value) {
    const header = toCookieHeader(cookie.cookie_value);
    if (await isCookieLive(header)) {
      return header;
    }
    logger.warn('Stored Zeko cookie was rejected by the dashboard API; re-running OTP login.');
  }

  return refreshZekoCookie();
}

/**
 * Syncs the Zeko job/role catalog into rpa_zeko_jobs and logs the run.
 *
 * Mirrors n8n nodes: "Prep Cookie/Auth Header" -> paged "Fetch Zeko Jobs Page" /
 * "Accumulate Roles" -> "Transform Roles" -> "Upsert Zeko Jobs" -> "Log Sync Run".
 *
 * Auth: uses the OTP cookie (dashboard API rejects the API-key bearer).
 *
 * @returns {Promise<{ totalFetched: number }>}
 */
export async function syncZekoJobs() {
  if (!config.zeko.companyId) {
    throw new Error('Zeko job sync skipped: ZEKO_COMPANY_ID not configured.');
  }

  const cookieHeader = await getDashboardCookieHeader();

  const allRoles = [];
  let page = 1;
  let hasMore = true;
  const MAX_PAGES = 100; // hard stop to avoid runaway pagination

  while (hasMore && page <= MAX_PAGES) {
    const qs = new URLSearchParams({
      limit: '20',
      page: String(page),
      published: 'true',
      notPublished: 'true',
      archived: 'true',
    });
    const url = `${config.zeko.dashboardApiBase}/workflow/${config.zeko.companyId}?${qs}`;
    const res = await fetch(url, {
      headers: {
        Cookie: cookieHeader,
        Accept: 'application/json',
        Origin: 'https://app.zeko.ai',
        Referer: 'https://app.zeko.ai/app/role',
      },
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Zeko jobs fetch failed (page ${page}, ${res.status}): ${JSON.stringify(body)}`);
    }

    const roles = body?.data?.roles || [];
    allRoles.push(...roles);
    hasMore = !!body?.data?.hasNextPage;
    page += 1;
  }

  // Upsert each role by zeko_id.
  let upserted = 0;
  for (const r of allRoles) {
    const data = transformRole(r);
    // Every mutable field is refreshed, not a subset. `is_workflow_pub`,
    // `is_hr_screening`, `is_coding`, `slug`, `email` and `job_ref_id` used to
    // be set on create only, so they froze at whatever the job looked like when
    // first seen: a job first synced as a draft and later WORKFLOW-published
    // kept `is_workflow_pub: false` forever, leaving 8 rows on staging reading
    // `status: 'published'` with both publish booleans false (RT, 2026-08-25).
    // `status` itself was always updated, which is why it — not the booleans —
    // is what getZekoJobs() filters on; this keeps the booleans from
    // contradicting it and misleading the next reader.
    //
    // `created_at_zeko` and `company_name` stay create-only on purpose: the
    // first is immutable, the second carries a local default that a sync should
    // not stamp back over.
    await prisma.rpa_zeko_jobs.upsert({
      where: { zeko_id: data.zeko_id },
      update: {
        job_ref_id: data.job_ref_id,
        title: data.title,
        hiring_name: data.hiring_name,
        role_name: data.role_name,
        status: data.status,
        interview_type: data.interview_type,
        is_published: data.is_published,
        is_workflow_pub: data.is_workflow_pub,
        is_archived: data.is_archived,
        is_hr_screening: data.is_hr_screening,
        is_coding: data.is_coding,
        slug: data.slug,
        email: data.email,
        total_applicants: data.total_applicants,
        resume_count: data.resume_count,
        screening_count: data.screening_count,
        functional_count: data.functional_count,
        updated_at_zeko: data.updated_at_zeko,
        raw_steps: data.raw_steps,
        interview_ids: data.interview_ids,
        synced_at: data.synced_at,
      },
      create: data,
    });
    upserted += 1;
  }

  await prisma.rpa_zeko_sync_log.create({
    data: { total_fetched: upserted, synced_at: new Date(), status: 'success' },
  });

  logger.info(`Zeko job catalog synced: ${upserted} role(s) upserted.`);
  return { totalFetched: upserted };
}

/**
 * Fetches every candidate response for one Zeko interview, with their scores.
 *
 * POST /dashboard/api/v2/pipeline/interview-responses (cookie auth) — this is the
 * call Zeko's own "Responses" page makes, and it is the ONLY source of the HR
 * screening score. The bearer API's GET /interview/<id>/results exposes just
 * `interviewScore`, which Zeko leaves at literal 0 for screening interviews, so
 * every HR round synced through it recorded a meaningless 0 (RT, 2026-08-24:
 * Panmon showed 0 in the ATS while Zeko showed 94).
 *
 * Which field carries the score depends on the interview type, and the response
 * flags it via `isHRScreeningPresent`:
 *   - screening-interview (`true`)  -> `fitPercentage`   (Panmon 94, Harish 75)
 *   - functional-interview (`false`) -> `interviewScore`  (Tushar 83, Kumaresan 68)
 * Verified against staging: on a functional interview `fitPercentage` is absent
 * entirely, and on a screening interview `interviewScore` is 0 for every single
 * candidate. Reading one and falling back to the other therefore fixes HR rounds
 * without disturbing the functional rounds that already worked.
 *
 * The body's field names are snake_case; the endpoint 422s and names the missing
 * ones if they are wrong.
 *
 * @param {string} cookieHeader - `authcookie=...`
 * @param {string} jobId - Zeko role/job id (rpa_zeko_candidate_pipeline.zeko_job_id).
 * @param {string} interviewId - Zeko interview id (…pipeline.pipeline_id).
 * @returns {Promise<{ responses: object[], isHrScreening: boolean }>}
 */
async function fetchInterviewResponses(cookieHeader, jobId, interviewId) {
  const url = `${config.zeko.dashboardApiBase}/pipeline/interview-responses`;
  const collected = [];
  let isHrScreening = false;
  let page = 1;
  const LIMIT = 100;
  const MAX_PAGES = 50; // hard stop, same guard as the job-catalog sync

  while (page <= MAX_PAGES) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Cookie: cookieHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain, */*',
        Origin: 'https://app.zeko.ai',
        Referer: 'https://app.zeko.ai/',
      },
      body: JSON.stringify({
        company_id: config.zeko.companyId,
        job_id: String(jobId),
        interview_id: String(interviewId),
        page,
        limit: LIMIT,
      }),
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        `Zeko interview-responses failed (interview ${interviewId}, page ${page}, ${res.status}): ${JSON.stringify(body).slice(0, 300)}`
      );
    }

    // The payload has been seen both at the top level and nested under `data`.
    const envelope = body?.data && !Array.isArray(body.data) ? body.data : body;
    const batch = envelope?.responses || (Array.isArray(body?.data) ? body.data : []) || [];
    if (envelope?.isHRScreeningPresent) isHrScreening = true;

    collected.push(...batch);
    if (batch.length < LIMIT) break;
    page += 1;
  }

  return { responses: collected, isHrScreening };
}

/**
 * Picks the score Zeko actually populated for this interview type.
 *
 * `fitPercentage` is the screening score and is absent on functional interviews;
 * `interviewScore` is the functional score and is a hard 0 on screening ones.
 * Preferring fit and falling back keeps one column correct for both round types.
 *
 * @param {object} entry - One `responses[]` element.
 * @param {boolean} isHrScreening - The response's `isHRScreeningPresent` flag.
 * @returns {number|null} The score, or null when Zeko has none.
 */
export function pickZekoScore(entry, isHrScreening) {
  const fit = entry?.fitPercentage;
  const interview = entry?.interviewScore;
  if (isHrScreening) return fit ?? null;
  // Functional: interviewScore is authoritative, but honour fit if it is the
  // only number present (mixed-type roles exist in the catalog).
  if (interview !== null && interview !== undefined) return interview;
  return fit ?? null;
}

/**
 * Candidates whose interview never actually produced a result.
 *
 * `attemptStatus` is Zeko's own word for what happened. Only `completed` yields a
 * score; the rest must stay unscored rather than be recorded as 0, which is what
 * made a no-show look like a candidate who interviewed and failed.
 */
export const ZEKO_NO_RESULT_STATUSES = Object.freeze(['slotMissed', 'leftInMiddle', 'notAttempted', 'scheduled']);

/**
 * Builds the deep link to a candidate's report on Zeko.
 *
 * This is the URL Zeko's own Responses table links to — the live report page for
 * one candidate on one role, opening on the Overview tab (score, fit, red flags,
 * recommendation), with the Recruiter Screening / Resume / Transcript tabs one
 * click away. Both ids come straight from the sync: `candidateId` off the
 * response entry, and the role id we already store as `zeko_job_id`.
 *
 * Returns null when either id is missing, so callers can fall back rather than
 * render a broken link.
 *
 * @param {string|null|undefined} candidateId - Zeko's candidate id.
 * @param {string|number|null|undefined} jobId - Zeko role/job id.
 * @returns {string|null}
 */
export function zekoReportUrl(candidateId, jobId) {
  if (!candidateId || !jobId) return null;
  const qs = new URLSearchParams({
    candidateId: String(candidateId),
    jobId: String(jobId),
    tab: 'Overview',
  });
  return `${config.zeko.reportLinkBase}?${qs}`;
}

/**
 * Fetches results for interviews whose window has ended and writes scores back.
 *
 * Replaces the n8n "Step 3 — Zeko Auto Fetch Interview Results" workflow:
 *   - find rpa_zeko_candidate_pipeline rows status='sent' AND interview_end_at < NOW()
 *   - POST /dashboard/api/v2/pipeline/interview-responses (cookie) per interview
 *   - on a `completed` entry for our candidate: insert rpa_zeko_interview_results,
 *     mark the pipeline 'completed', update rpa_cv Zeko score columns.
 *
 * Rows the OLD endpoint already finalised are not revisited by default: they are
 * `status='completed'`, so the normal sweep skips them and their bogus 0 would
 * survive this fix forever. `includeCompleted` re-reads those too, which is what
 * repairs them — see repairZeroZekoScores().
 *
 * @param {object} [options]
 * @param {boolean} [options.includeCompleted=false] - Also re-sync rows already
 *   marked completed (used for the one-off repair of old bad 0s).
 * @returns {Promise<{ processed: number, skipped: number }>}
 */
export async function fetchInterviewResults({ includeCompleted = false } = {}) {
  const statusFilter = includeCompleted
    ? Prisma.sql`p.status IN ('sent', 'completed')`
    : Prisma.sql`p.status = 'sent'`;

  const pendingRows = await prisma.$queryRaw`
    SELECT
      p.id               AS pipeline_row_id,
      p.candidate_id,
      p.zeko_job_id,
      p.pipeline_id,
      p.stage,
      p.status,
      p.interview_end_at,
      COALESCE(p.candidate_email, sc.candidate_email) AS candidate_email,
      sc.candidate_name  AS sc_candidate_name,
      cp.cv_id,
      cp.journey_id
    FROM rpa_zeko_candidate_pipeline p
    JOIN rpa_shortlisted_candidates sc ON sc.id = p.candidate_id
    -- Journey link gives us the exact rpa_cv row to write scores back to, and
    -- the journey id the pipeline drawer is keyed on so a synced score can be
    -- pushed to any browser holding that drawer open.
    -- LEFT so a Zeko row without a journey still syncs (it falls back to email).
    LEFT JOIN LATERAL (
      SELECT id AS journey_id, cv_id FROM rpa_candidate_pipeline
      WHERE shortlist_id = p.candidate_id AND cv_id IS NOT NULL
      ORDER BY created_at DESC LIMIT 1
    ) cp ON TRUE
    WHERE ${statusFilter}
      AND p.interview_end_at < NOW()
    ORDER BY p.interview_end_at ASC;
  `;

  if (pendingRows.length === 0) {
    // debug, not info: this is the common case on a 5-minute cadence and would
    // otherwise write ~288 "nothing to do" lines a day, burying the real events.
    // Nothing has happened worth recording — no network call is even made.
    logger.debug('Zeko results fetch: no expired sent interviews to process.');
    return { processed: 0, skipped: 0 };
  }

  const cookieHeader = await getDashboardCookieHeader();
  let processed = 0;
  let skipped = 0;

  // One interview serves every candidate booked against it, and the endpoint is
  // paged — so fetch each interview once and reuse it for all its rows.
  const responsesByInterview = new Map();

  for (const row of pendingRows) {
    try {
      let fetched = responsesByInterview.get(row.pipeline_id);
      if (!fetched) {
        fetched = await fetchInterviewResponses(cookieHeader, row.zeko_job_id, row.pipeline_id);
        responsesByInterview.set(row.pipeline_id, fetched);
      }
      const { responses: data, isHrScreening } = fetched;

      if (data.length === 0) {
        skipped += 1;
        // An interview whose window closed long ago should have results by now;
        // anything older than the staleness window is a real problem (a wrong
        // id, a cancelled booking) rather than "not finished yet", so it is
        // logged loudly. This path stalled silently for weeks precisely because
        // every miss was reported at info level.
        const overdueBy = Date.now() - new Date(row.interview_end_at).getTime();
        const detail = `pipeline_row ${row.pipeline_row_id} (${row.candidate_email}) — interview id ${row.pipeline_id}`;
        if (overdueBy > RESULT_STALE_AFTER_MS) {
          logger.warn(
            `Zeko results fetch: STILL no data ${Math.floor(overdueBy / 3_600_000)}h after the interview ended — ${detail}.`
          );
        } else {
          logger.info(`Zeko results fetch: no data yet for ${detail}.`);
        }
        continue;
      }

      // Never data[0]: the response carries every candidate on this interview.
      const result = findResultForCandidate(data, row.candidate_email);
      if (!result) {
        skipped += 1;
        // A row can be permanently unmatchable — the candidate was re-booked in
        // the ATS but never added on Zeko's side, so no run will ever match them
        // (RT, 2026-08-24: Haris M). On a 5-minute cadence, warning every time
        // would emit hundreds of identical lines a day, so the loud warning is
        // reserved for the first day. After that it stays visible at info level:
        // still discoverable, no longer drowning the real events.
        const overdueBy = Date.now() - new Date(row.interview_end_at).getTime();
        const message =
          `Zeko results fetch: ${data.length} result(s) returned for interview ${row.pipeline_id} but none match ` +
          `${row.candidate_email} (pipeline_row ${row.pipeline_row_id}) — skipping rather than recording another candidate's scores.`;
        if (overdueBy > RESULT_STALE_AFTER_MS) {
          logger.info(`${message} Unmatched for ${Math.floor(overdueBy / 3_600_000)}h — likely never added to this interview on Zeko.`);
        } else {
          logger.warn(message);
        }
        continue;
      }

      // A candidate who never sat the interview has no score. Recording 0 for
      // them is what made a no-show read as "interviewed and scored zero", so
      // they are left for the next run (they may still attend a rescheduled
      // slot) rather than written as a result.
      if (ZEKO_NO_RESULT_STATUSES.includes(result.attemptStatus)) {
        skipped += 1;
        logger.info(
          `Zeko results fetch: ${row.candidate_email} has attemptStatus "${result.attemptStatus}" for interview ${row.pipeline_id} — no score to record (pipeline_row ${row.pipeline_row_id}).`
        );
        continue;
      }

      const overall = pickZekoScore(result, isHrScreening);
      if (overall === null) {
        skipped += 1;
        logger.warn(
          `Zeko results fetch: ${row.candidate_email} is "${result.attemptStatus}" on interview ${row.pipeline_id} but carries neither fitPercentage nor interviewScore — nothing recorded (pipeline_row ${row.pipeline_row_id}).`
        );
        continue;
      }

      // Screening interviews report a single fit score; Zeko exposes no
      // technical/communication split for them, so those stay null rather than
      // being filled with the 0s the old endpoint returned.
      const technical = isHrScreening ? null : (result.technicalScore ?? null);
      const communication = isHrScreening ? null : (result.communicationScore ?? null);
      const candidateName = result.candidateName || row.sc_candidate_name || null;
      const candidateEmail = result.candidateEmail || row.candidate_email || null;
      // 1) Record the result. Update this candidate's existing row for the
      //    interview when there is one, rather than only ever inserting: a
      //    re-sync must be able to correct a score the old endpoint recorded
      //    wrongly, and blind inserts would also stack duplicates. The table has
      //    no unique constraint, so the match is done explicitly.
      const existing = await prisma.rpa_zeko_interview_results.findFirst({
        where: {
          pipeline_id: String(row.pipeline_id),
          candidate_email: { equals: candidateEmail, mode: 'insensitive' },
        },
        orderBy: { created_at: 'desc' },
      });

      // The responses endpoint carries no reportLink (the old results endpoint
      // did), but it does carry `candidateId`, which is what Zeko's own report
      // URL is keyed on. Building it beats the old shared-report link: that was
      // a static snapshot, whereas this opens the candidate's live report page —
      // the same URL a recruiter lands on from Zeko's Responses table.
      // Falls back to whatever we already stored, so switching endpoints never
      // blanks a link that is still good.
      const reportLink =
        zekoReportUrl(result.candidateId, row.zeko_job_id) || existing?.reportlink || null;

      const resultData = {
        candidate_name: candidateName,
        candidate_email: candidateEmail,
        scores_overallscore: overall,
        scores_technicalscore: technical,
        scores_communicationscore: communication,
        reportlink: reportLink,
        zeko_job_id: String(row.zeko_job_id),
        pipeline_id: String(row.pipeline_id),
      };

      try {
        if (existing) {
          if (existing.scores_overallscore !== overall) {
            logger.info(
              `Zeko results: correcting ${candidateEmail} on interview ${row.pipeline_id} — ${existing.scores_overallscore} → ${overall}.`
            );
          }
          await prisma.rpa_zeko_interview_results.update({
            where: { id: existing.id },
            data: resultData,
          });
        } else {
          await prisma.rpa_zeko_interview_results.create({
            data: { ...resultData, created_at: new Date() },
          });
        }
      } catch (e) {
        // Tolerate races (n8n used ON CONFLICT DO NOTHING).
        logger.warn(`Zeko result write skipped for pipeline_row ${row.pipeline_row_id}: ${e.message}`);
      }

      // 2) Mark pipeline row completed (only if still 'sent').
      await prisma.rpa_zeko_candidate_pipeline.updateMany({
        where: { id: row.pipeline_row_id, status: 'sent' },
        data: { status: 'completed', completed_at: new Date() },
      });

      // 3) Write scores back to rpa_cv.
      //
      // Prefer the journey's own cv_id: it identifies exactly one row, whereas
      // matching on email can hit several (a candidate on two MRFs).
      // The email match is kept only as a fallback for rows with no journey,
      // and is bounded to the address Zeko actually reported — matched by
      // address-set overlap, since the stored column may hold several joined
      // addresses and Zeko reports only one of them.
      if (row.cv_id) {
        await prisma.$executeRaw`
          UPDATE rpa_cv
          SET "ZekoInterviewScore"     = ${overall},
              "ZekoCodingScore"        = ${technical},
              "ZekoCommunicationScore" = ${communication}
          WHERE id = ${row.cv_id};
        `;
      } else if (candidateEmail) {
        await prisma.$executeRaw`
          UPDATE rpa_cv
          SET "ZekoInterviewScore"     = ${overall},
              "ZekoCodingScore"        = ${technical},
              "ZekoCommunicationScore" = ${communication}
          WHERE ${emailMatchesSql(Prisma.sql`"EmailID"`, candidateEmail)};
        `;
      }

      processed += 1;
      logger.info(
        `Zeko results: recorded scores for ${candidateEmail} (overall ${overall}) — pipeline_row ${row.pipeline_row_id}.`
      );

      // 4) Push the update to any browser already showing this candidate.
      //
      // Without this, a drawer left open keeps rendering whatever it fetched
      // when it was opened: react-query only refetches on mount, on a mutation's
      // invalidate, or on window focus (disabled globally) — and a cron writing
      // to the database triggers none of those. The recruiter sat looking at
      // "Awaiting Results" while the score was already stored, and only a manual
      // reload revealed it (RT, 2026-08-25).
      //
      // Emitted to the staffing roles rather than one user because a journey has
      // no single owner — whoever has it open should see it. Best-effort: the
      // row is already committed, so a failed push only delays the update until
      // the next refetch, exactly as before.
      const updatePayload = {
        pipelineId: row.journey_id === null || row.journey_id === undefined ? null : Number(row.journey_id),
        stageKey: row.stage === 'functional' ? 'zeko_fn' : 'zeko_hr',
        reason: 'zeko.score_synced',
        score: overall,
      };
      // emitToRole targets ONE room, so each staffing role is emitted to in
      // turn — the same pattern notification.service.js follows for its fan-out.
      for (const role of NOTIFY_ROLES) {
        try {
          emitToRole(role, 'pipeline:updated', updatePayload);
        } catch (e) {
          logger.debug(`Zeko results: socket push to ${role} skipped for pipeline_row ${row.pipeline_row_id}: ${e.message}`);
        }
      }
    } catch (err) {
      skipped += 1;
      logger.error(
        `Zeko results fetch failed for pipeline_row ${row.pipeline_row_id}: ${err.message}`
      );
    }
  }

  logger.info(`Zeko results fetch done: ${processed} processed, ${skipped} skipped.`);
  return { processed, skipped };
}

/**
 * One-off repair for scores the OLD endpoint recorded wrongly.
 *
 * Rounds synced before the switch to /pipeline/interview-responses were marked
 * `status='completed'` with whatever GET /interview/<id>/results returned —
 * a hard 0 for every screening interview. The normal sweep only looks at
 * `status='sent'`, so those rows would keep their wrong score forever.
 *
 * This re-reads completed rows through the new endpoint and rewrites both
 * rpa_zeko_interview_results and rpa_cv with the real number. Safe to run more
 * than once: it is the same code path as the cron, just over a wider row set,
 * and a candidate whose score is already correct is simply rewritten unchanged.
 *
 * @returns {Promise<{ processed: number, skipped: number }>}
 */
export async function repairZeroZekoScores() {
  logger.info('Zeko score repair: re-syncing completed rounds through the responses endpoint.');
  return fetchInterviewResults({ includeCompleted: true });
}

export default {
  ensureZekoToken,
  refreshZekoCookie,
  syncZekoJobs,
  fetchInterviewResults,
  repairZeroZekoScores,
};
