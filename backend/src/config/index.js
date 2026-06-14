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

  /** Server port */
  port: parseInt(env('PORT', '5000'), 10),

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
    /** True when mail must be redirected to the internal test inbox. */
    redirectInNonProd: env('NODE_ENV', 'development') !== 'production',
    /** Fixed inbox that receives all mail in non-production environments. */
    testRecipients: env('EMAIL_STAGING_RECIPIENTS', 'saukumar@aapnainfotech.com, hmopuri@aapnainfotech.com, pkmondal@aapnainfotech.com'),

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
      /** Interview-results fetch cron (hourly, offset by default). */
      resultsCron: env('ZEKO_RESULTS_CRON', '30 * * * *'),
    },
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

  /** Rate limiting */
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // requests per window per IP
  },
};

export default config;
