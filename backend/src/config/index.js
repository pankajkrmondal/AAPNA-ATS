import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve the target environment before loading any env file so we can pick the
// matching .env.<NODE_ENV> file (single switch for staging vs production).
const NODE_ENV = (process.env.NODE_ENV || 'development').trim();
const projectRoot = path.resolve(__dirname, '../..');

// Load the environment-specific file first, then fall back to a plain .env.
// dotenv does NOT overwrite variables that are already set, so the env-specific
// file (loaded first) always wins; the plain .env only fills in anything missing.
dotenv.config({ path: path.resolve(projectRoot, `.env.${NODE_ENV}`) });
dotenv.config({ path: path.resolve(projectRoot, '.env') });

/**
 * Retrieves an environment variable, throwing if required and missing.
 * @param {string} key - Environment variable name
 * @param {string} [defaultValue] - Fallback value
 * @param {boolean} [required=false] - Whether the variable is mandatory
 * @returns {string}
 */
function env(key, defaultValue = undefined, required = false) {
  let value = process.env[key] ?? defaultValue;
  if (typeof value === 'string') {
    value = value.trim();
  }
  if (required && (value === undefined || value === '')) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

/**
 * Centralized application configuration.
 * All env vars are read once at startup and validated here.
 * @type {Object}
 */
const config = {
  /** Current environment: development | production | test */
  env: env('NODE_ENV', 'development'),

  /** Whether we're running in production */
  isProduction: env('NODE_ENV', 'development') === 'production',

  /**
   * Whether we're running with an explicit `NODE_ENV=development`. Used to gate
   * verbose HTTP error responses (see errorHandler.js): unlike `isProduction`
   * (an exact allowlist match), this makes the SAFE response the default for
   * every environment — staging, production, anything else — and only opts
   * into verbose output when development is explicitly set.
   */
  isDevelopment: env('NODE_ENV', 'development') === 'development',

  /** Server port */
  port: parseInt(env('PORT', '5000'), 10),

  /**
   * Public base URL of THIS backend (no trailing slash), used to build absolute
   * URLs that external clients must reach — currently the email open-tracking
   * pixel (`/api/track/open/:token`). Must be internet-reachable in staging/prod
   * for pixels to load. When empty, pixel injection is skipped entirely.
   */
  publicBaseUrl: env('PUBLIC_BASE_URL', '').replace(/\/+$/, ''),

  /** Database */
  database: {
    url: env('DATABASE_URL', '', true),
  },

  /** Redis connection for BullMQ and caching */
  redis: {
    host: env('REDIS_HOST', 'localhost'),
    port: parseInt(env('REDIS_PORT', '6379'), 10),
    password: env('REDIS_PASSWORD', '') || undefined,
  },

  /** JWT authentication */
  jwt: {
    secret: env('JWT_SECRET', '', true),
    expiresIn: env('JWT_EXPIRES_IN', '24h'),
    refreshExpiresIn: env('JWT_REFRESH_EXPIRES_IN', '7d'),
  },

  /** Microsoft Graph API (Outlook integration) */
  microsoft: {
    clientId: env('MS_CLIENT_ID', ''),
    clientSecret: env('MS_CLIENT_SECRET', ''),
    tenantId: env('MS_TENANT_ID', ''),
    redirectUri: env('MS_REDIRECT_URI', ''),
    // No default: OneDrive parent folder differs per environment and must be set explicitly.
    oneDriveParentId: env('MS_ONEDRIVE_PARENT_ID', ''),
    // Sending mailbox (staging "Saurabh" vs production "AAPNA Recruitment").
    defaultSender: env('MS_DEFAULT_SENDER_EMAIL', 'pkmondal@aapnainfotech.com'),

    /**
     * Outlook calendar + Teams meeting creation for scheduled interview rounds.
     * OFF by default: it needs Calendars.ReadWrite (and OnlineMeetings.ReadWrite
     * for a Teams link) granted to the app registration by a tenant admin —
     * the mail-only consent the rest of this integration uses is not enough.
     *
     * When false, scheduling still works end-to-end: the booking is saved and
     * both parties are emailed the date/time — just without a calendar event
     * or join link. Flip to true once consent is granted; no code change needed.
     */
    calendarEnabled: env('MS_CALENDAR_ENABLED', 'false') === 'true',

    /** Mailbox that owns the interview calendar events (defaults to the sender). */
    calendarMailbox: env('MS_CALENDAR_MAILBOX', '') || env('MS_DEFAULT_SENDER_EMAIL', 'pkmondal@aapnainfotech.com'),

    /**
     * Teams attendance-report auto-detection for scheduled interviews — used to
     * decide "did the interview actually happen?" before releasing the
     * interviewer scorecard link (docs/phase3/INTERVIEWER-SCORECARD-PLAN.md).
     *
     * OFF by default and INDEPENDENT of calendarEnabled: reading attendance
     * needs consent the event-creation grant does not include —
     * OnlineMeetingArtifact.Read.All (application) PLUS an application access
     * policy (Set-CsApplicationAccessPolicy) authorizing the app to read
     * meetings on behalf of the calendar mailbox. When false (or when a report
     * isn't available), the occurrence sweep falls back to asking a human to
     * confirm — no scorecard is ever sent for an unconfirmed interview.
     */
    attendanceEnabled: env('MS_ATTENDANCE_ENABLED', 'false') === 'true',

    /**
     * Minimum seconds a participant must have been present to count as having
     * actually attended, so an accidental 10-second join isn't read as "held".
     */
    attendanceMinSeconds: parseInt(env('MS_ATTENDANCE_MIN_SECONDS', '60'), 10),
  },

  /**
   * Email recipient routing.
   *
   * `email.recipients` is the per-flow source-of-truth: in production each flow
   * sends to its real (often dynamic) recipients; in any non-production
   * environment ALL mail is redirected to `testRecipients` (a fixed internal
   * inbox). The actual values are loaded from the `rpa_settings` DB table at
   * boot (see config/emailRecipients.js), with code fallbacks that mirror the
   * n8n workflow definitions. Use resolveRecipients() from that module rather
   * than reading these fields directly.
   */
  email: {
    /**
     * True when mail must be redirected to the internal test inbox instead of
     * going to real candidates/vendors.
     *
     * By default this is derived from NODE_ENV (any non-production env redirects).
     * It can be OVERRIDDEN independently with EMAIL_REDIRECT_TO_TEST so you can run
     * the real production build/DB but keep staging-like email safety during a
     * production smoke test:
     *   EMAIL_REDIRECT_TO_TEST=true  -> force redirect to testRecipients even in prod
     *   EMAIL_REDIRECT_TO_TEST=false -> force real recipients even in non-prod
     *   (unset)                      -> fall back to NODE_ENV !== 'production'
     */
    redirectInNonProd: (() => {
      const override = env('EMAIL_REDIRECT_TO_TEST', '').toLowerCase();
      if (override === 'true') return true;
      if (override === 'false') return false;
      return env('NODE_ENV', 'development') !== 'production';
    })(),
    /** Fixed inbox that receives all mail in non-production environments. */
    testRecipients: env('EMAIL_STAGING_RECIPIENTS', 'saukumar@aapnainfotech.com, hmopuri@aapnainfotech.com, pkmondal@aapnainfotech.com'),

    /**
     * Recipients for the "Resume Processing Failed" internal alert
     * (resume_error_alert). Single per-environment switch: whatever is set here
     * is used verbatim in staging AND production, and is NOT affected by the
     * EMAIL_REDIRECT_TO_TEST redirect. When set, it overrides the DB/default
     * recipient for this one flow, so no seeder re-run is needed to change it.
     */
    resumeErrorRecipients: env('EMAIL_RESUME_ERROR_RECIPIENTS', ''),

    /**
     * Email-based resume intake poller (n8n "Microsoft Outlook Trigger2").
     * Polls the defaultSender mailbox for messages with attachments and feeds
     * them into the resume-parse pipeline. Default OFF.
     */
    intake: {
      enabled: env('EMAIL_INTAKE_ENABLED', 'false') === 'true',
      cron: env('EMAIL_INTAKE_CRON', '*/5 * * * *'),
    },

    /**
     * Inbound conversation sync poller (n8n "Outlook WF2 - Incoming Email Sync").
     * Polls the defaultSender mailbox for inbound mail, matches it to candidates,
     * and writes rpa_email_messages + rpa_email_tracking. Default OFF.
     */
    inboundSync: {
      enabled: env('INBOUND_SYNC_ENABLED', 'false') === 'true',
      cron: env('INBOUND_SYNC_CRON', '*/5 * * * *'),
    },

    /**
     * Consolidated mailbox poller (jobs/mailboxPoller.js): one Graph DELTA
     * fetch per tick fanned out to intake + inbound sync (their enable flags
     * above still gate each consumer). Delta queries are cheap and exact, so
     * this can safely be tightened to e.g. every minute.
     */
    mailboxSync: {
      cron: env('MAILBOX_SYNC_CRON', '*/5 * * * *'),
    },
  },

  /** Google Gemini AI */
  gemini: {
    apiKey: env('GEMINI_API_KEY', ''),
    model: env('GEMINI_MODEL', 'gemini-2.5-flash'),
  },

  /** OpenRouter AI */
  openrouter: {
    apiKey: env('OPENROUTER_API_KEY', ''),
    baseUrl: env('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1'),
    model: env('OPENROUTER_MODEL', 'openai/gpt-4.1-nano'),
  },

  /** Cohere Reranking */
  cohere: {
    apiKey: env('COHERE_API_KEY', ''),
    baseUrl: env('COHERE_BASE_URL', 'https://api.cohere.com/v2/rerank'),
    model: env('COHERE_MODEL', 'rerank-v3.5'),
  },

  /** Zeko AI video interview platform */
  zeko: {
    apiUrl: env('ZEKO_API_URL', ''),
    apiKey: env('ZEKO_API_KEY', ''),
    /** Base for Zeko interview management API calls (schedule/cancel/results/token). */
    scheduleApiBase: env('ZEKO_SCHEDULE_API_BASE', 'https://interview-api.zeko.ai/api/v1'),
    /** Base for candidate-facing interview links. */
    interviewLinkBase: env('ZEKO_INTERVIEW_LINK_BASE', 'https://interview.zeko.ai/interview'),
    /**
     * Base for the recruiter-facing candidate report page on Zeko's dashboard.
     * Takes ?candidateId=&jobId=&tab= — the same link Zeko's own Responses table
     * opens, used for the drawer's "View full report on Zeko".
     */
    reportLinkBase: env('ZEKO_REPORT_LINK_BASE', 'https://app.zeko.ai/app/new-report'),
    /** Client id for the API-key token grant (differs per environment). */
    clientId: env('ZEKO_CLIENT_ID', ''),
    /** Company/workflow id used by the dashboard job-catalog API. */
    companyId: env('ZEKO_COMPANY_ID', ''),
    /** Base for the dashboard job-catalog API (paged role list). */
    dashboardApiBase: env('ZEKO_DASHBOARD_API_BASE', 'https://interview-api.zeko.ai/dashboard/api/v2'),
    /** Base for the Zeko account login / OTP API (cookie auth for the dashboard). */
    loginApiBase: env('ZEKO_LOGIN_API_BASE', 'https://api.zeko.ai/mygurukul'),
    /**
     * Zeko account email used for the OTP login that mints the dashboard cookie.
     * Defaults to the env's sending mailbox (the OTP email lands there), since that
     * is the mailbox the Graph reader already polls.
     */
    loginEmail: env('ZEKO_LOGIN_EMAIL', '') || env('MS_DEFAULT_SENDER_EMAIL', ''),

    /**
     * Background Zeko sync (replaces the n8n "FULLY AUTO Sync (API Key Auth)" and
     * "Step 3 — Auto Fetch Interview Results" workflows). Default OFF; enable per
     * environment once ZEKO_CLIENT_ID / ZEKO_API_KEY / ZEKO_COMPANY_ID are set.
     */
    sync: {
      enabled: env('ZEKO_SYNC_ENABLED', 'false') === 'true',
      /** Token refresh + job catalog sync cron (hourly by default). */
      jobsCron: env('ZEKO_JOBS_CRON', '0 * * * *'),
      /**
       * Interview-results fetch cron. Every 5 minutes, so a finished interview's
       * score reaches the ATS in minutes rather than up to an hour — recruiters
       * decide on a round as soon as Zeko has scored it.
       *
       * Safe at this cadence because the run is bounded by real work: the query
       * only returns rows whose interview has ENDED and is still 'sent', it
       * early-returns before touching the network when there are none, and each
       * interview is fetched once per run no matter how many candidates share
       * it. Overrunning is handled too — the scheduler skips a tick while the
       * previous one is still going (see zekoScheduler.js), so a slow run can
       * never stack up concurrent syncs.
       */
      resultsCron: env('ZEKO_RESULTS_CRON', '*/5 * * * *'),
    },
  },

  /** Evalground Assessment invite/deadline tracking (Phase 3 M2 extension) */
  assessment: {
    /** Overdue-invite polling cadence — pure DB polling, no external API, always runs. */
    deadlineCheckCron: env('ASSESSMENT_DEADLINE_CHECK_CRON', '0 * * * *'),
  },

  /** Document collection (Phase 3 M4) — pure DB polling, no external API. */
  document: {
    /**
     * Automatic chasing for the Documents round (RT: "reminders until
     * submitted"). Until now the only reminder was a manual button, so a
     * candidate who simply went quiet was never followed up unless a recruiter
     * noticed.
     */
    reminder: {
      /** Daily tick; the per-request thresholds below decide who actually gets mail. */
      cron: env('DOCUMENT_REMINDER_CRON', '0 9 * * *'),
      /** Days to wait after the original request before the first reminder. */
      afterDays: parseInt(env('DOCUMENT_REMINDER_AFTER_DAYS', '2'), 10),
      /** Minimum gap between reminders, so a cadence change can't spam. */
      repeatHours: parseInt(env('DOCUMENT_REMINDER_REPEAT_HOURS', '24'), 10),
      /** Total reminders per request before the sweep gives up and leaves it to a human. */
      maxCount: parseInt(env('DOCUMENT_REMINDER_MAX_COUNT', '3'), 10),
    },
  },

  /** Offer lifecycle sweeps (Phase 3 M5) — pure DB polling, no external API. */
  offer: {
    /**
     * One daily tick drives both offer sweeps: the approval nudge (chase an
     * unapproved offer) and the post-joining auto-close. Daily is the right
     * granularity for both — the nudge is explicitly a daily reminder (Q26) and
     * the auto-close threshold is measured in months (Q12).
     */
    sweepCron: env('OFFER_SWEEP_CRON', '0 7 * * *'),
    /** Days after the joining date before a Joined record auto-closes (Q12). */
    autoCloseAfterDays: parseInt(env('OFFER_AUTO_CLOSE_AFTER_DAYS', '90'), 10),
  },

  /** File upload settings */
  upload: {
    maxSize: env('UPLOAD_MAX_SIZE', '50mb'),
    dir: env('UPLOAD_DIR', './uploads'),
  },

  /** CORS */
  cors: {
    frontendUrl: env('FRONTEND_URL', 'http://localhost:5173'),
  },

  /** Logging */
  logging: {
    level: env('LOG_LEVEL', 'debug'),
    dir: env('LOG_DIR', './logs'),
  },

  /** n8n Webhook base prefix */
  n8nWebhookUrlPrefix: env('N8N_WEBHOOK_URL_PREFIX', ''),

  /**
   * Cloudflare Turnstile bot protection for the login endpoint.
   * Empty secret = verification disabled (environments without keys keep
   * working unchanged). The matching PUBLIC site key is a frontend var
   * (VITE_TURNSTILE_SITE_KEY); this secret must stay server-side only.
   * Keys: https://dash.cloudflare.com -> Turnstile.
   */
  turnstile: {
    secretKey: env('TURNSTILE_SECRET_KEY', ''),
  },

  /** Rate limiting */
  rateLimit: {
    /** Global API limiter window (default 15 minutes). */
    windowMs: parseInt(env('RATE_LIMIT_WINDOW_MS', String(15 * 60 * 1000)), 10),
    /** Global API requests per window per IP (~2.2 req/s at defaults). */
    max: parseInt(env('RATE_LIMIT_MAX', '2000'), 10),
    /** Auth (brute-force) limiter window (default 15 minutes). */
    authWindowMs: parseInt(env('RATE_LIMIT_AUTH_WINDOW_MS', String(15 * 60 * 1000)), 10),
    /** Failed auth attempts allowed per window per IP. */
    authMax: parseInt(env('RATE_LIMIT_AUTH_MAX', '20'), 10),
  },

  /** CSV export endpoints (see src/exports/, src/utils/csvExport.js). */
  exports: {
    /**
     * Hard row ceiling per export. Over this the request is refused with a 413
     * telling the user to narrow their filters — never silently truncated.
     * 25k covers the whole production candidate table (~8.8k rows) with room.
     */
    maxRows: parseInt(env('EXPORT_MAX_ROWS', '25000'), 10),
    /** Export limiter window (default 5 minutes). */
    rateWindowMs: parseInt(env('EXPORT_RATE_WINDOW_MS', String(5 * 60 * 1000)), 10),
    /** Exports allowed per window per USER (not per IP — the office shares one). */
    rateMax: parseInt(env('EXPORT_RATE_MAX', '20'), 10),
  },

  /**
   * Set TRUST_PROXY=true when running behind a reverse proxy (nginx/IIS/Azure)
   * so Express derives the real client IP from X-Forwarded-For; otherwise the
   * rate limiter keys every request on the proxy's own IP.
   */
  trustProxy: env('TRUST_PROXY', 'false') === 'true',
};

export default config;
