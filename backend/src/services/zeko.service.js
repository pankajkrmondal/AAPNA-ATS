import prisma from '../config/database.js';
import logger from '../config/logger.js';
import config from '../config/index.js';
import { fetchMessagesSince } from './outlookReader.service.js';

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
    role_name: r.designation || r.title ? String(r.designation || r.title) : null,
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
    await prisma.rpa_zeko_jobs.upsert({
      where: { zeko_id: data.zeko_id },
      update: {
        title: data.title,
        status: data.status,
        interview_type: data.interview_type,
        is_published: data.is_published,
        is_archived: data.is_archived,
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
 * Fetches results for interviews whose window has ended and writes scores back.
 *
 * Mirrors the n8n "Step 3 — Zeko Auto Fetch Interview Results" workflow:
 *   - find rpa_zeko_candidate_pipeline rows status='sent' AND interview_end_at < NOW()
 *   - GET /interview/<pipeline_id>/results (Bearer)
 *   - on non-empty data[]: insert rpa_zeko_interview_results, mark pipeline 'completed',
 *     update rpa_cv Zeko score columns by EmailID.
 *
 * @returns {Promise<{ processed: number, skipped: number }>}
 */
export async function fetchInterviewResults() {
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
      sc.candidate_name  AS sc_candidate_name
    FROM rpa_zeko_candidate_pipeline p
    JOIN rpa_shortlisted_candidates sc ON sc.id = p.candidate_id
    WHERE p.status = 'sent'
      AND p.interview_end_at < NOW()
    ORDER BY p.interview_end_at ASC;
  `;

  if (pendingRows.length === 0) {
    logger.info('Zeko results fetch: no expired sent interviews to process.');
    return { processed: 0, skipped: 0 };
  }

  const token = await ensureZekoToken();
  let processed = 0;
  let skipped = 0;

  for (const row of pendingRows) {
    try {
      const url = `${config.zeko.scheduleApiBase}/interview/${row.pipeline_id}/results`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      const body = await res.json().catch(() => ({}));

      const data = Array.isArray(body?.data) ? body.data : [];
      if (!res.ok || data.length === 0) {
        skipped += 1;
        logger.info(
          `Zeko results fetch: no data yet for pipeline_row ${row.pipeline_row_id} (${row.candidate_email}).`
        );
        continue;
      }

      const result = data[0];
      const scores = result.scores || {};
      const overall = scores.overallScore ?? null;
      const technical = scores.technicalScore ?? null;
      const communication = scores.communicationScore ?? null;
      const candidateName = result.candidate?.name || row.sc_candidate_name || null;
      const candidateEmail = result.candidate?.email || row.candidate_email || null;
      const reportLink = result.reportLink || null;

      // 1) Insert interview result (skip duplicates).
      await prisma.rpa_zeko_interview_results.create({
        data: {
          candidate_name: candidateName,
          candidate_email: candidateEmail,
          scores_overallscore: overall,
          scores_technicalscore: technical,
          scores_communicationscore: communication,
          reportlink: reportLink,
          zeko_job_id: String(row.zeko_job_id),
          pipeline_id: String(row.pipeline_id),
          created_at: new Date(),
        },
      }).catch((e) => {
        // Tolerate races / dup inserts (n8n used ON CONFLICT DO NOTHING).
        logger.warn(`Zeko result insert skipped for pipeline_row ${row.pipeline_row_id}: ${e.message}`);
      });

      // 2) Mark pipeline row completed (only if still 'sent').
      await prisma.rpa_zeko_candidate_pipeline.updateMany({
        where: { id: row.pipeline_row_id, status: 'sent' },
        data: { status: 'completed', completed_at: new Date() },
      });

      // 3) Write scores back to rpa_cv by candidate email (case-insensitive).
      if (candidateEmail) {
        await prisma.$executeRaw`
          UPDATE rpa_cv
          SET "ZekoInterviewScore"     = ${overall},
              "ZekoCodingScore"        = ${technical},
              "ZekoCommunicationScore" = ${communication}
          WHERE "EmailID" ILIKE ${candidateEmail};
        `;
      }

      processed += 1;
      logger.info(
        `Zeko results: recorded scores for ${candidateEmail} (overall ${overall}) — pipeline_row ${row.pipeline_row_id}.`
      );
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

export default { ensureZekoToken, refreshZekoCookie, syncZekoJobs, fetchInterviewResults };
