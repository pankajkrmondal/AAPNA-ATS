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

    /**
     * Treat the candidate as a Teams GUEST rather than a matched mailbox.
     *
     * Candidates generally have no Teams account and join anonymously, which
     * makes Teams record them with a blank emailAddress — nothing to match. So
     * "held" is decided from the interviewer (internal, always signed in) plus
     * the presence of at least one other participant. See decideOccurrence().
     *
     * ON by default because that is how interviews are actually run. Set to
     * false for all-internal rounds where both sides sign in and the stricter
     * both-addresses-must-match rule is worth having.
     */
    attendanceGuestCandidate: env('MS_ATTENDANCE_GUEST_CANDIDATE', 'true') === 'true',

    /**
     * Automatic Teams recording for booked interview rounds
     * (docs/phase3/INTERVIEW-RECORDINGS-PLAN.md).
     *
     * OFF by default. Unlike the two flags above this needs NO new tenant work —
     * `OnlineMeetings.ReadWrite.All` is already granted and the Global meeting
     * policy already allows recording with no consent prompt (verified
     * 2026-09-01) — but it changes what happens in a real interview with a real
     * candidate, so it stays opt-in per environment.
     *
     * When true, booking or rescheduling a recorded round PATCHes the Teams
     * meeting with recordAutomatically:true, so the interview records itself
     * with nobody pressing Record.
     */
    meetingRecordAuto: env('MS_MEETING_RECORD_AUTO', 'false') === 'true',

    /**
     * Who may present — and therefore who may STOP the recording.
     *
     * Teams has no "lock the recording on" setting: whoever can start a
     * recording can stop it, and only presenters can. So this is the only lever
     * that keeps a recording running, and 'organization' is the decision taken
     * on 2026-09-01 (plan §0.1): the candidate joins as an attendee and cannot
     * stop the recording, while interviewers stay presenters and keep screen
     * sharing. Interviewers CAN still stop it — that is a policy matter the
     * missing-recording sweep is meant to catch.
     *
     * Kept configurable for a fast rollback to Teams' default ('everyone') if
     * demoting candidates causes trouble in a live round.
     */
    meetingPresenters: env('MS_MEETING_PRESENTERS', 'organization'),

    /** Allow transcription, so the recording carries a searchable transcript. */
    meetingTranscribe: env('MS_MEETING_TRANSCRIBE', 'true') === 'true',

    /**
     * Rounds that get recorded (plan §0.2). The Client Interview is absent by
     * design — it is arranged offline and the ATS creates no meeting for it.
     */
    recordedStages: env('MS_RECORDED_STAGES', 'tech1,tech2,tech3,hr_round,ceo')
      .split(',').map((s) => s.trim()).filter(Boolean),

    /**
     * Post-interview recording DISCOVERY — finds the Teams recording after a
     * round ends and links it to the booking (jobs/interviewRecordings.js).
     *
     * Independent of meetingRecordAuto: turning recording ON and reading the
     * result back need different consent (OnlineMeetingRecording.Read.All), and
     * a tenant could reasonably want the first without the second. Also
     * independent of the rpa_settings cron switch — this flag says "the
     * permission exists here", the setting says "sweep on this schedule".
     */
    recordingFetchEnabled: env('MS_RECORDING_FETCH_ENABLED', 'false') === 'true',

    /**
     * Copy each discovered recording into our own OneDrive folder.
     *
     * Separate from discovery because it is the expensive half: ~400 MB per
     * recorded hour, transferred and then stored a second time. Discovery alone
     * already gives a working link, so this can be switched off independently if
     * quota becomes a problem.
     *
     * WHY IT IS WORTH THE SPACE: Teams recordings live in the ORGANIZER's
     * personal OneDrive. Standard offboarding deletes a personal OneDrive, so
     * without a copy of our own, every interview recording the company holds
     * would leave with one employee's account.
     */
    recordingArchiveEnabled: env('MS_RECORDING_ARCHIVE_ENABLED', 'false') === 'true',

    /** Top-level OneDrive folder (drive root) that holds the archive. */
    recordingArchiveFolder: env('MS_RECORDING_ARCHIVE_FOLDER', 'Recordings_ATS'),

    /**
     * Months after a journey CLOSES before its archived recording is deleted
     * (plan §0.5 — video goes, transcript stays). 0 disables the purge.
     *
     * This is not housekeeping: the candidate invite email promises deletion
     * within this window, and with Teams auto-expiry off on this tenant nothing
     * else in the system ever reclaims a byte.
     */
    recordingRetainMonths: parseInt(env('MS_RECORDING_RETAIN_MONTHS', '12'), 10),
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
    /**
     * Base for the PUBLIC, no-login view of the same report — the link Zeko's
     * own Share button mints. Takes ?linkId=. This is what a candidate dossier
     * carries, because reportLinkBase above is behind Zeko's login and an
     * external interviewer opening it gets a sign-in wall rather than a report.
     * See utils/zekoShareLink.js.
     */
    sharedReportLinkBase: env('ZEKO_SHARED_REPORT_LINK_BASE', 'https://app.zeko.ai/app/shared-report'),
    /**
     * Timeout for the share-link mint. Short on purpose: it runs inside a
     * recruiter's dossier download, and a slow Zeko must degrade that download to
     * "ask the recruiter" rather than hold it open.
     */
    shareLinkTimeoutMs: parseInt(env('ZEKO_SHARE_LINK_TIMEOUT_MS', '10000'), 10),
    /** Client id for the API-key token grant (differs per environment). */
    clientId: env('ZEKO_CLIENT_ID', ''),
    /** Company/workflow id used by the dashboard job-catalog API. */
    companyId: env('ZEKO_COMPANY_ID', ''),
    /** Base for the dashboard job-catalog API (paged role list). */
    dashboardApiBase: env('ZEKO_DASHBOARD_API_BASE', 'https://interview-api.zeko.ai/dashboard/api/v2'),
    /** Base for the Zeko account login / OTP API (cookie auth for the dashboard). */
    loginApiBase: env('ZEKO_LOGIN_API_BASE', 'https://api.zeko.ai/mygurukul'),
    /**
     * Base for the per-candidate interview REPORT API (cookie auth) — the API
     * behind Zeko's report page, and the only source that carries a real score
     * for every round type. Takes ?candidateId=&jobId=.
     */
    reportApiBase: env('ZEKO_REPORT_API_BASE', 'https://api.zeko.ai/mygurukul/ait'),
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
   * Candidate dossier — the "complete download" a recruiter emails to an
   * external interviewer (see src/services/candidateDossier.service.js).
   */
  dossier: {
    /**
     * How many days the pack asks its recipient to keep it before deleting.
     * HR agreed to the request but did not name a period (2026-09-02); 30 days
     * was confirmed by the project owner. Changing it here changes the READ-ME,
     * the download modal and the HTML footer together — the recipient and the
     * recruiter must never be shown two different periods.
     */
    deletionDays: parseInt(env('DOSSIER_DELETION_DAYS', '30'), 10),
    /**
     * Whether to walk every finished dossier model and throw on a forbidden
     * field (plan §8.3). Default ON, including in production: the cost is one
     * walk of a small object, against a leak that cannot be undone once the file
     * is sent. There is a switch only so an incident can be worked around
     * without a deploy — turning it off is not a supported configuration.
     */
    assertRedaction: env('DOSSIER_ASSERT_REDACTION', 'true') !== 'false',

    /**
     * Largest single attachment. Over this the file is skipped and the pack's
     * manifest says so — a resume is normally well under 1 MB, so anything near
     * this ceiling is a scan or a mis-upload rather than a document an
     * interviewer needs.
     */
    maxAttachmentBytes: parseInt(env('DOSSIER_MAX_ATTACHMENT_BYTES', String(25 * 1024 * 1024)), 10),
    /**
     * Largest whole pack. Above this, attachments are dropped in priority order
     * rather than the download failing — an incomplete pack that arrives beats a
     * complete one that does not.
     *
     * Deliberately ABOVE the ~25 MB Outlook attachment ceiling: the recruiter is
     * warned past warnPackBytes so they can share it via a link instead, which
     * is a better answer than us silently truncating to fit an email.
     */
    maxPackBytes: parseInt(env('DOSSIER_MAX_PACK_BYTES', String(40 * 1024 * 1024)), 10),
    /** Past this the UI warns that the pack may not send as an email attachment. */
    warnPackBytes: parseInt(env('DOSSIER_WARN_PACK_BYTES', String(20 * 1024 * 1024)), 10),
    /** Per-attachment Graph timeout — one dead file must not hang the request. */
    attachmentTimeoutMs: parseInt(env('DOSSIER_ATTACHMENT_TIMEOUT_MS', '10000'), 10),
    /** Total time allowed for ALL attachment fetches, after which the rest are skipped. */
    attachmentBudgetMs: parseInt(env('DOSSIER_ATTACHMENT_BUDGET_MS', '30000'), 10),
    /**
     * Total time allowed for minting the Zeko report share links.
     *
     * Needed as well as the per-call ZEKO_SHARE_LINK_TIMEOUT_MS because the
     * expensive step is not the mint. If the stored dashboard cookie has been
     * invalidated, the Zeko client re-runs the OTP login — request an OTP, poll
     * the mailbox for it, verify — which measured 38 SECONDS on staging
     * (2026-09-03). That is fine in a cron and unacceptable inside a recruiter's
     * download, so the whole step is bounded: past this the pack says "ask the
     * recruiter" while the login finishes in the background and the next
     * download gets its link.
     */
    zekoLinkBudgetMs: parseInt(env('DOSSIER_ZEKO_LINK_BUDGET_MS', '20000'), 10),

    /**
     * How long a recording share link stays alive (plan §6.5, HR decision #7).
     *
     * 14 days is HR's number, not a technical one: long enough that an
     * interviewer who is handed the pack on a Friday can still watch the round
     * the following week, short enough that a forwarded mailbox is not a
     * permanent window onto a candidate's interview.
     *
     * Read at MINT time only. Shortening it here does not shorten a link
     * somebody already holds — that is what revocation is for.
     */
    shareLinkDays: parseInt(env('DOSSIER_SHARE_LINK_DAYS', '14'), 10),

    /**
     * Rate limit on the PUBLIC share-link routes, keyed on token + IP.
     *
     * A separate limiter from exportLimiter because that one is per-user and
     * there is no user here — the token is the only identity. Generous enough
     * for one interviewer watching one interview (a video player opens the page
     * once and then issues range requests to the stream route), tight enough
     * that a link being passed around a group shows up as refusals.
     */
    shareRateWindowMs: parseInt(env('DOSSIER_SHARE_RATE_WINDOW_MS', String(15 * 60 * 1000)), 10),
    shareRateMax: parseInt(env('DOSSIER_SHARE_RATE_MAX', '120'), 10),
    /**
     * The same window, for the STREAM route, which has its own budget.
     *
     * Opening the page is one request; playing an hour of video and scrubbing
     * through it is many, and a browser's range requests are not something the
     * viewer can moderate. Sharing the page's 120 meant a normal viewing session
     * could 429 the recording mid-sentence, with nothing on screen to say why.
     */
    shareStreamRateMax: parseInt(env('DOSSIER_SHARE_STREAM_RATE_MAX', '900'), 10),
  },

  /**
   * Set TRUST_PROXY=true when running behind a reverse proxy (nginx/IIS/Azure)
   * so Express derives the real client IP from X-Forwarded-For; otherwise the
   * rate limiter keys every request on the proxy's own IP.
   */
  trustProxy: env('TRUST_PROXY', 'false') === 'true',
};

export default config;
