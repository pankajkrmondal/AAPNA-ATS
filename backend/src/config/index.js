import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

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
    oneDriveParentId: env('MS_ONEDRIVE_PARENT_ID', '01MS5H25CFWZA7J3PCPFBZPOSTOJVRGYIM'),
    defaultSender: env('MS_DEFAULT_SENDER_EMAIL', 'pkmondal@aapnainfotech.com'),
    stagingRecipients: env('EMAIL_STAGING_RECIPIENTS', 'saukumar@aapnainfotech.com, hmopuri@aapnainfotech.com, pkmondal@aapnainfotech.com'),
    hrAlertsRecipients: env('EMAIL_HR_ALERTS_RECIPIENTS', 'hmopuri@aapnainfotech.com, pkmondal@aapnainfotech.com'),
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
  },

  /** Zeko AI video interview platform */
  zeko: {
    apiUrl: env('ZEKO_API_URL', ''),
    apiKey: env('ZEKO_API_KEY', ''),
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
