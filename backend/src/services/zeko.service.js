import { Prisma } from '@prisma/client';
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import config from '../config/index.js';
import { fetchMessagesSince } from './outlookReader.service.js';
import { emailCandidates, emailMatchesSql } from '../utils/emailMatch.js';
import { parseZekoReportUrl, parseZekoResponseId, zekoSharedReportUrl } from '../utils/zekoShareLink.js';
import { buildZekoReportSection } from '../utils/zekoReportModel.js';
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
 * The stored dashboard cookie, unvalidated — or null when there is none.
 *
 * The unvalidated half of getDashboardCookieHeader(), for callers that would
 * rather ask the endpoint they actually want than pay for a ping. Two reasons a
 * caller might: the ping's verdict is not always right for other Zeko APIs (it
 * checks the dashboard workflow endpoint, which can refuse a cookie the report
 * API accepts), and its "no" costs an OTP login — fine in a cron, far too slow
 * inside a user's request. See generateZekoShareLink().
 *
 * @returns {Promise<string|null>} `authcookie=...`, or null
 */
async function storedDashboardCookieHeader() {
  const cookie = await prisma.rpa_zeko_auth_cookie.findFirst({
    where: { is_active: true, expires_at: { gt: new Date() } },
    orderBy: { created_at: 'desc' },
  });
  return cookie?.cookie_value ? toCookieHeader(cookie.cookie_value) : null;
}

/** Zeko saying "not you", as opposed to "not that". Only the first is worth a login. */
const isAuthFailure = (err) => err?.status === 401 || err?.status === 403;

/**
 * Run a cookie-authenticated Zeko call, cheapest credential first.
 *
 * The stored cookie is tried before anything is validated, and the OTP login
 * runs only when Zeko itself answers 401/403. Doing it the other way round —
 * validating first, as getDashboardCookieHeader() does — is correct for a cron
 * and wrong for a user-facing request twice over: the liveness ping checks the
 * dashboard workflow endpoint, which on staging refuses cookies the report API
 * accepts, and its "no" costs a full OTP login (request a code, poll the
 * mailbox, verify) measured at 38 seconds inside a recruiter's click.
 *
 * @param {(cookieHeader: string) => Promise<*>} run
 * @param {string} [label] - for the log line when a re-login is needed
 */
async function withDashboardCookie(run, label = 'Zeko call') {
  const stored = await storedDashboardCookieHeader();
  if (stored) {
    try {
      return await run(stored);
    } catch (err) {
      if (!isAuthFailure(err)) throw err;
      logger.warn(`${label}: the stored dashboard cookie was refused; logging in again.`);
    }
  }
  return run(await getDashboardCookieHeader());
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
 * Lists every candidate booked against one Zeko interview.
 *
 * POST /dashboard/api/v2/pipeline/interview-responses (cookie auth) — the call
 * Zeko's own "Responses" page makes. This is the ENUMERATION step only: it is
 * the sole source of each candidate's `candidateId`, which the report API is
 * keyed on.
 *
 * Its SCORE fields are deliberately not used. It is a list/summary endpoint and
 * its numbers are unreliable per round type: `interviewScore` is a literal 0 for
 * screening interviews AND for functional ones (RT, 2026-08-25 — four completed
 * candidates reported 0 here while the report API had 1, 61, 56 and 65).
 * fetchCandidateReport() below is the only trustworthy source of a score.
 *
 * Pagination must be preserved: one interview can hold 400+ candidates, and ours
 * is not always on page 1 (Haris sat beyond it on a 430-candidate interview).
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
 * Fetches one candidate's full interview report — the only reliable score source.
 *
 * GET /mygurukul/ait/interview-report?candidateId=&jobId= (cookie auth) — the API
 * behind Zeko's own report page. Unlike the responses list, it carries the real
 * score for EVERY round type, and it is keyed on the candidate rather than on a
 * results tab. That last point matters: jobs expose different tabs
 * ("Meets Criteria" exists on some and not others), and on job
 * 69df92eff96fd5bee20f8fdc the Completed tab reads 0 while Meets Criteria reads
 * 4 — so any logic keyed to a tab silently skips genuinely scored candidates.
 *
 * Returns null on HTTP 410 Gone, which is Zeko's own "no report exists" signal —
 * returned for every slotMissed candidate observed. A missing report is a normal
 * state, not a failure, so it must not throw.
 *
 * @param {string} cookieHeader - `authcookie=...`
 * @param {string} candidateId - Zeko candidate id (from the responses list).
 * @param {string} jobId - Zeko role/job id (rpa_zeko_candidate_pipeline.zeko_job_id).
 * @returns {Promise<object|null>} The report's `data.data` object, or null when absent.
 */
async function fetchCandidateReport(cookieHeader, candidateId, jobId, { timeoutMs } = {}) {
  const qs = new URLSearchParams({ candidateId: String(candidateId), jobId: String(jobId) });
  const url = `${config.zeko.reportApiBase}/interview-report?${qs}`;
  const res = await fetch(url, {
    headers: {
      Cookie: cookieHeader,
      Accept: 'application/json',
      Origin: 'https://app.zeko.ai',
      Referer: 'https://app.zeko.ai/',
    },
    // Unbounded for the cron, which has all the time it needs; bounded when a
    // user is waiting on it (the dossier download).
    ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
  });

  if (res.status === 410) return null; // no report for this candidate — not an error
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(
      `Zeko interview-report failed (candidate ${candidateId}, job ${jobId}, ${res.status}): ${JSON.stringify(body).slice(0, 300)}`
    );
    // Carried so callers can tell "not you" from "not that" — only the first is
    // worth an OTP login. See withDashboardCookie().
    err.status = res.status;
    throw err;
  }
  return body?.data?.data || null;
}

/**
 * Picks the scores out of a candidate's interview report.
 *
 * Each round type carries its score in a different field, and only one of them is
 * ever meaningful — the other two are absent, 0, or a duplicate:
 *
 *   round type   fit_percentage   codingScore   totalScore
 *   HR screening      95            absent         0        <- junk
 *   coding          absent            61           61       <- duplicate of coding
 *   panel           absent          absent         79
 *
 * So all three are the same thing — "this round's headline score" — and Zeko's
 * own UI labels them that way (Recruiter Screening / Coding Score / Interview
 * Score). None is a communication score: softSkillsEvaluation and
 * language_proficiency were checked and hold only qualitative text, so
 * ZekoCommunicationScore has no source and stays null rather than being filled
 * with totalScore's 0s and duplicates.
 *
 * DO NOT read `newEvaluation.overallScore`: it is a different number (49 where
 * the UI gauge shows 79) that Zeko's own report page ignores. Reading it would
 * put one score in the ATS and another in Zeko for the same candidate.
 *
 * @param {object|null} report - The report's `data.data` object.
 * @returns {{interview: number|null, coding: number|null, communication: null}}
 */
export function pickZekoScore(report) {
  const fit = report?.hr_screening_evaluation?.fit_percentage;
  const coding = report?.coding_evaluation?.codingScore;
  const total = report?.totalScore;

  // `??` so a genuine 0 survives (a real interview CAN score 0 — Vaibhav Garse
  // scored 38 technical against a 0 overall). `total` is taken through `|| null`
  // instead, because on HR and coding rounds its 0 means "not applicable" rather
  // than "scored zero" — it is only a real score when it is the sole field present.
  const interview = fit ?? coding ?? (total || null);

  return {
    interview: interview === undefined ? null : interview,
    coding: coding === undefined ? null : coding,
    communication: null,
  };
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
 * Mints (or re-reads) the PUBLIC share link for one candidate's Zeko report.
 *
 * WHY THIS EXISTS. The link we store per round is Zeko's recruiter report page,
 * which requires a Zeko login. A candidate dossier is emailed to an interviewer
 * who has no ATS account and certainly no Zeko account, so that URL is useless to
 * them — Phase 1 therefore carried only the FACT that a report existed. Zeko's
 * report page has a Share button that mints a no-login view of the same report,
 * and this is that button, called server-side with the dashboard cookie the ATS
 * already holds.
 *
 * THREE THINGS VERIFIED AGAINST STAGING (2026-09-03), because all three shape
 * the code:
 *
 *   1. The call is IDEMPOTENT. Three calls for the same candidate returned the
 *      same link id — and the same id the recruiter's own browser had minted by
 *      hand. So there is nothing to cache and nothing to clean up: re-minting on
 *      every download does not litter Zeko with links.
 *   2. `responseId` is OPTIONAL. Zeko's UI sends it, but candidateId + jobId
 *      alone return the same link. It is kept as a FALLBACK rather than the
 *      normal path: recovering it costs an extra report round trip, and it is
 *      only worth paying when the cheap call has already failed.
 *   3. The STORED cookie must be tried before the liveness ping. This path does
 *      NOT call getDashboardCookieHeader() first, which is the obvious thing to
 *      do and the wrong one: that helper validates the cookie against the
 *      dashboard workflow endpoint, and a cookie that endpoint rejects can still
 *      be perfectly good for the report API (observed on staging, where the ping
 *      fails and both report calls return 200). Believing the ping sent every
 *      single download through a fresh OTP login — 38 seconds, inside a
 *      recruiter's click. So the stored cookie is used optimistically and the
 *      login is run only when Zeko itself answers 401/403.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: expire or revoke. The link lives on Zeko's
 * side and we have no API to withdraw it — unlike the recording share links of
 * plan §6.5, which are ours and are revocable. That difference is stated to the
 * recruiter at the download dialog rather than hidden here, because it is the
 * kind of thing that must be decided by the person sending the file.
 *
 * @param {object} args
 * @param {string} [args.candidateId] - Zeko candidate id
 * @param {string} [args.jobId] - Zeko role/job id
 * @param {string} [args.reportUrl] - a stored rpa_zeko_interview_results.reportlink,
 *   from which both ids are parsed when they are not passed explicitly
 * @param {number} [args.timeoutMs] - defaults to config.zeko.shareLinkTimeoutMs
 * @returns {Promise<{ linkId: string, url: string, candidateId: string, jobId: string }>}
 * @throws {Error} when the ids cannot be resolved or Zeko refuses the request
 */
export async function generateZekoShareLink({
  candidateId, jobId, reportUrl, timeoutMs,
} = {}) {
  const fromUrl = parseZekoReportUrl(reportUrl);
  const cid = candidateId || fromUrl?.candidateId;
  const jid = jobId || fromUrl?.jobId;
  if (!cid || !jid) {
    throw new Error('Zeko share link: no candidateId/jobId — the stored report link is not a Zeko report URL.');
  }

  const budget = Number(timeoutMs) > 0 ? Number(timeoutMs) : config.zeko.shareLinkTimeoutMs;

  /** One call to Zeko's Share endpoint. Returns the link id, or null. */
  const mint = async (cookieHeader, params) => {
    const qs = new URLSearchParams(params);
    const res = await fetch(`${config.zeko.reportApiBase}/report/generate-link?${qs}`, {
      headers: {
        Cookie: cookieHeader,
        Accept: 'application/json',
        Origin: 'https://app.zeko.ai',
        Referer: 'https://app.zeko.ai/',
      },
      signal: AbortSignal.timeout(budget),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(
        `Zeko generate-link failed (candidate ${cid}, job ${jid}, ${res.status}): ${JSON.stringify(body).slice(0, 300)}`,
      );
      err.status = res.status;
      throw err;
    }
    return body?.data?.link || null;
  };

  /** Both forms of the call, with one cookie. */
  const attempt = async (cookieHeader) => {
    try {
      const id = await mint(cookieHeader, { candidateId: cid, jobId: jid });
      if (id) return id;
    } catch (err) {
      if (isAuthFailure(err)) throw err;
      // Not an auth problem, so a new cookie would not help. Fall through to the
      // responseId form, which is exactly what Zeko's own UI sends.
      logger.warn(`Zeko share link: two-id attempt failed for candidate ${cid} — ${err.message}`);
    }

    // The response id is not a field on the report — it is buried in the
    // recording player URL (see parseZekoResponseId).
    const report = await fetchCandidateReport(cookieHeader, cid, jid, { timeoutMs: budget });
    const responseId = parseZekoResponseId(report);
    if (!responseId) {
      throw new Error(
        `Zeko share link: no shareable report for candidate ${cid} on job ${jid} `
        + '(the report is missing or carries no response id).',
      );
    }
    return mint(cookieHeader, { responseId, candidateId: cid, jobId: jid });
  };

  const linkId = await withDashboardCookie(attempt, `Zeko share link (candidate ${cid})`);

  const url = zekoSharedReportUrl(linkId);
  if (!url) {
    throw new Error(`Zeko share link: generate-link returned no link for candidate ${cid} on job ${jid}.`);
  }
  return {
    linkId, url, candidateId: cid, jobId: jid,
  };
}

/**
 * One candidate's screening report, redacted for a dossier.
 *
 * The alternative to the share link, and the better answer for most readers:
 * the same assessment rendered INSIDE the pack, under our own redaction, rather
 * than as a link to a page Zeko composes and we cannot revoke. What gets kept
 * and what gets dropped is buildZekoReportSection()'s business — this function's
 * only job is getting the payload, cheaply and without hanging on Zeko.
 *
 * Returns null rather than throwing when there is simply no report (Zeko answers
 * 410 for a candidate who never sat the interview) or when the payload carries
 * no screening evaluation: an absent report is a normal state, and the dossier
 * says so in its manifest.
 *
 * @param {object} args
 * @param {string} [args.candidateId]
 * @param {string} [args.jobId]
 * @param {string} [args.reportUrl] - a stored reportlink, parsed for both ids
 * @param {number} [args.timeoutMs]
 * @returns {Promise<object|null>} the redacted section, or null
 * @throws {Error} only on a real failure — a refused login, a 5xx, a timeout
 */
export async function getZekoReport({
  candidateId, jobId, reportUrl, timeoutMs,
} = {}) {
  const fromUrl = parseZekoReportUrl(reportUrl);
  const cid = candidateId || fromUrl?.candidateId;
  const jid = jobId || fromUrl?.jobId;
  if (!cid || !jid) {
    throw new Error('Zeko report: no candidateId/jobId — the stored report link is not a Zeko report URL.');
  }

  const budget = Number(timeoutMs) > 0 ? Number(timeoutMs) : config.zeko.shareLinkTimeoutMs;
  const report = await withDashboardCookie(
    (cookieHeader) => fetchCandidateReport(cookieHeader, cid, jid, { timeoutMs: budget }),
    `Zeko report (candidate ${cid})`,
  );

  return buildZekoReportSection(report);
}

/**
 * Fetches results for interviews whose window has ended and writes scores back.
 *
 * Replaces the n8n "Step 3 — Zeko Auto Fetch Interview Results" workflow:
 *   - find rpa_zeko_candidate_pipeline rows status='sent' AND interview_end_at < NOW()
 *   - POST /dashboard/api/v2/pipeline/interview-responses (cookie) per interview,
 *     to ENUMERATE the roster and find our candidate's `candidateId`
 *   - GET /mygurukul/ait/interview-report for that candidate, which is where the
 *     real score lives for every round type
 *   - on a scored report: write rpa_zeko_interview_results, mark the pipeline
 *     'completed', and update rpa_cv's Zeko score columns.
 *
 * Both tables are written because they now feed different surfaces: the pipeline
 * drawer and board read rpa_zeko_interview_results (round-scoped), while Search
 * Candidate, View Candidate, the CSV export and analytics read rpa_cv. Since the
 * 2026-08-25 round-scoping fix the drawer no longer falls back to rpa_cv, so
 * dropping either write would blank one of those surfaces.
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
      const { responses: data } = fetched;

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

      // The list endpoint's own score fields are not trusted (see
      // fetchInterviewResponses) — the real numbers come from this candidate's
      // report, which is the only source correct for every round type.
      if (!result.candidateId) {
        skipped += 1;
        logger.warn(
          `Zeko results fetch: ${row.candidate_email} matched on interview ${row.pipeline_id} but carries no candidateId — cannot fetch their report (pipeline_row ${row.pipeline_row_id}).`
        );
        continue;
      }

      const report = await fetchCandidateReport(cookieHeader, result.candidateId, row.zeko_job_id);
      if (!report) {
        skipped += 1;
        logger.info(
          `Zeko results fetch: no report yet for ${row.candidate_email} on job ${row.zeko_job_id} (attemptStatus "${result.attemptStatus}", pipeline_row ${row.pipeline_row_id}).`
        );
        continue;
      }

      const { interview: overall, coding: technical, communication } = pickZekoScore(report);
      if (overall === null) {
        skipped += 1;
        logger.warn(
          `Zeko results fetch: ${row.candidate_email} has a report on job ${row.zeko_job_id} but it carries none of fit_percentage / codingScore / totalScore — nothing recorded (pipeline_row ${row.pipeline_row_id}).`
        );
        continue;
      }
      const candidateName = report.name || result.candidateName || row.sc_candidate_name || null;
      const candidateEmail = report.email || result.candidateEmail || row.candidate_email || null;

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
  generateZekoShareLink,
  getZekoReport,
};
