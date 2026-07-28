import prisma from './database.js';
import logger from './logger.js';
import config from './index.js';

/**
 * Per-flow email recipient routing — single source of truth.
 *
 * Each email-sending flow has a stable key. For every key we track:
 *   - `to`      : static recipient list for THIS environment (comma-separated)
 *   - `cc`      : static cc list for THIS environment (comma-separated)
 *   - `dynamic` : when true, the real recipient is computed at runtime (e.g. the
 *                 candidate / vendor / submitter address) and the static `to`
 *                 above is only a fallback.
 *
 * Resolution rules (mirrors the staging vs production n8n workflows):
 *   - Non-production  -> ALL mail goes to config.email.testRecipients (cc cleared).
 *   - Production:
 *       - dynamic flow  -> to = runtime value (fallback to static `to`), cc = static cc.
 *       - static flow   -> to/cc = static values (+ optional appended dynamic value).
 *
 * Values are loaded from the `rpa_settings` table at boot via loadEmailRecipients().
 * Because staging and production use SEPARATE databases, pointing DATABASE_URL at
 * the right database automatically selects the right recipient set. The DEFAULTS
 * below mirror the n8n flows so the app still works before the table is seeded.
 *
 * rpa_settings key convention:  email_recipients.<flowKey>.to / .cc
 */

/**
 * Code fallbacks, taken verbatim from the staging n8n workflow definitions.
 * These are used when a matching rpa_settings row is absent. In a correctly
 * seeded environment the DB rows override these.
 *
 * NOTE: only the STATIC flows (missingEmailAlert, duplicateAlert, mrfApproval,
 * mrfOutcome, shortlistCc) are seeded into rpa_settings. The `dynamic: true`
 * flows below resolve their recipient from the runtime value in production and
 * are redirected to the test inbox in non-production, so their static `to`/`cc`
 * here are never read — but the keys MUST remain so resolveRecipients() applies
 * the dynamic/redirect rule rather than treating them as unknown.
 */
const DEFAULTS = {
  // Admin-initiated password/credential update. Prod -> target user.
  userCredentialUpdate: { to: '', cc: '', dynamic: true },
  // Forgot-password reset link. Always -> the account owner (never redirected).
  passwordReset: { to: '', cc: '', dynamic: true },
  // Candidate-facing welcome email (1.1.1 / 1.1.4 welcome). Prod -> candidate.
  welcome: { to: '', cc: '', dynamic: true },
  // Missing JD/data collection email to the candidate. Prod -> candidate.
  missingData: { to: '', cc: '', dynamic: true },
  // Internal alert: resume processing failure ("Error Alert — Resume Processing").
  resumeErrorAlert: { to: 'pkmondal@aapnainfotech.com, hmopuri@aapnainfotech.com', cc: '', dynamic: false },
  // Internal alert: any 5xx backend error reaching the global error handler.
  backendErrorAlert: { to: 'hmopuri@aapnainfotech.com, pkmondal@aapnainfotech.com', cc: '', dynamic: false },
  // Internal alert: candidate-ranking (Cohere Rerank) API failure during screening search.
  rerankApiAlert: { to: 'pkmondal@aapnainfotech.com, hmopuri@aapnainfotech.com', cc: '', dynamic: false },
  // Internal alert: candidate email id was null/missing ("Email ID Null Alert").
  missingEmailAlert: { to: 'hmopuri@aapnainfotech.com', cc: '', dynamic: false },
  // Internal duplicate-resume alert to HR/admin.
  duplicateAlert: { to: 'pkmondal@aapnainfotech.com', cc: '', dynamic: false },
  // Duplicate alert sent to the same vendor. Prod -> vendor.
  vendorDuplicateSame: { to: '', cc: '', dynamic: true },
  // Duplicate alert sent to a different vendor. Prod -> vendor.
  vendorDuplicateDiff: { to: '', cc: '', dynamic: true },
  // MRF request to the Hiring Manager. Both `to` (HM email) and the cc are
  // entered by HR on the MRF form and passed in at call time, so there is no
  // static config value and this flow is intentionally NOT seeded into
  // rpa_settings. The key must stay here so resolveRecipients() applies the
  // dynamic-in-prod / redirect-in-nonprod rule.
  mrfRequest: { to: '', cc: '', dynamic: true },
  // MRF approval request to the approvers ("Send message and wait for response").
  mrfApproval: { to: 'hmopuri@aapnainfotech.com, saukumar@aapnainfotech.com, pkmondal@aapnainfotech.com', cc: '', dynamic: false },
  // HR-team notification sent AT submission time (n8n "Send a message To HR").
  mrfSubmitHrNotify: { to: 'hmopuri@aapnainfotech.com, saukumar@aapnainfotech.com', cc: '', dynamic: false },
  // MRF approved/declined outcome notification to HR. Prod CCs leaders + HM
  // (HM email is appended dynamically by the caller).
  mrfOutcome: { to: 'hmopuri@aapnainfotech.com, saukumar@aapnainfotech.com', cc: '', dynamic: false },
  // Shortlist initiation (2.4). to = candidate (dynamic), cc = internal.
  shortlistCc: { to: '', cc: 'pkmondal@aapnainfotech.com', dynamic: true },
  // Interview scheduled notification to candidate. Prod -> candidate.
  interviewScheduled: { to: '', cc: '', dynamic: true },
  // Interview cancelled notification to candidate. Prod -> candidate.
  interviewCancelled: { to: '', cc: '', dynamic: true },
  // Screening status -> Rejected notification to candidate. Prod -> candidate.
  rejection: { to: '', cc: '', dynamic: true },
  // Screening status -> On Hold notification to candidate. Prod -> candidate.
  onHold: { to: '', cc: '', dynamic: true },
  // Recruiter's manual reply from the ATS conversation view. Prod -> the
  // original counterpart (candidate); non-prod -> test inbox like every other
  // candidate-facing flow.
  manualReply: { to: '', cc: '', dynamic: true },
  // Phase 3 stage engine (Module 1): every stage×outcome notification and the
  // ad-hoc per-candidate override, dispatched by stageNotification.service.js.
  // Prod -> candidate; vendor cc (status-only, Q5) is attached by the caller,
  // not resolved here.
  stageOutcome: { to: '', cc: '', dynamic: true },
};

/** Active recipient map; starts from DEFAULTS and is overlaid with DB values. */
const recipients = {};
for (const [key, val] of Object.entries(DEFAULTS)) {
  recipients[key] = { ...val };
}

/**
 * Flows that must ALWAYS reach their real recipients, even in non-production
 * or when EMAIL_REDIRECT_TO_TEST is on. They bypass the test-inbox redirect
 * and resolve exactly as in production (static `to`/`cc`, or the runtime
 * recipient for dynamic flows):
 *   - resumeErrorAlert: internal failure alert that ops must always see.
 *   - rerankApiAlert: internal failure alert for Cohere Rerank API errors.
 *   - backendErrorAlert: internal failure alert for 5xx backend errors —
 *     must always reach real developer inboxes, including on staging, since
 *     that's precisely where this class of bug is caught.
 *   - userCredentialUpdate: account credentials / password changes must go to
 *     the affected user's own inbox in every environment.
 *   - passwordReset: forgot-password links are only useful in the account
 *     owner's own inbox.
 */
const NEVER_REDIRECT = new Set(['resumeErrorAlert', 'rerankApiAlert', 'backendErrorAlert', 'userCredentialUpdate', 'passwordReset']);

let loaded = false;

/**
 * Loads per-flow recipient overrides from the `rpa_settings` table.
 * Reads every row whose key starts with "email_recipients." and overlays the
 * `.to` / `.cc` values onto the in-memory map. Missing keys keep their DEFAULTS,
 * so the app remains functional before the table is seeded.
 *
 * Safe to call multiple times; also exported as reloadEmailRecipients().
 * @returns {Promise<void>}
 */
export async function loadEmailRecipients() {
  try {
    const rows = await prisma.rpa_settings.findMany({
      where: { key: { startsWith: 'email_recipients.' } },
    });

    for (const row of rows) {
      // key format: email_recipients.<flowKey>.<field>
      const parts = row.key.split('.');
      if (parts.length !== 3) continue;
      const [, flowKey, field] = parts;
      if (!recipients[flowKey]) recipients[flowKey] = { to: '', cc: '', dynamic: false };
      if (field === 'to' || field === 'cc') {
        recipients[flowKey][field] = (row.value || '').trim();
      } else if (field === 'dynamic') {
        recipients[flowKey].dynamic = String(row.value).toLowerCase() === 'true';
      }
    }

    loaded = true;
    logger.info(`Email recipients loaded from rpa_settings (${rows.length} row(s) applied over defaults).`);
  } catch (err) {
    // Non-fatal: fall back to the in-code DEFAULTS so email still works.
    logger.warn(`Could not load email recipients from rpa_settings, using code defaults: ${err.message}`);
  }
}

/** Alias for runtime refresh after an admin edits recipients. */
export const reloadEmailRecipients = loadEmailRecipients;

/**
 * Resolves the recipient and cc lists for a given flow, applying the
 * environment redirect rule.
 *
 * @param {string} flowKey - One of the keys in DEFAULTS.
 * @param {string} [dynamicValue] - Runtime recipient for dynamic flows
 *   (candidate/vendor/submitter email). Ignored in non-production.
 * @returns {{ to: string, cc: string }} Comma-separated recipient strings.
 */
export function resolveRecipients(flowKey, dynamicValue = '') {
  const entry = recipients[flowKey];
  if (!entry) {
    logger.warn(`resolveRecipients: unknown flow key "${flowKey}"; sending to test recipients.`);
    return { to: config.email.testRecipients, cc: '' };
  }

  if (!loaded) {
    logger.warn(`resolveRecipients("${flowKey}") called before rpa_settings were loaded; using defaults.`);
  }

  // Single per-environment override for the resume error alert. When
  // EMAIL_RESUME_ERROR_RECIPIENTS is set (in .env.<env>), it is used verbatim in
  // every environment and is not affected by the redirect flag — making the
  // .env file the single place to manage who gets this alert. Falls through to
  // the DB/default value below when the var is unset.
  if (flowKey === 'resumeErrorAlert' && config.email.resumeErrorRecipients) {
    return { to: config.email.resumeErrorRecipients, cc: '' };
  }

  // Non-production: redirect everything to the internal test inbox, no cc.
  // Exception: NEVER_REDIRECT flows (internal failure alerts) always go to
  // their configured recipients regardless of environment / redirect flag.
  if (config.email.redirectInNonProd && !NEVER_REDIRECT.has(flowKey)) {
    return { to: config.email.testRecipients, cc: '' };
  }

  // Production.
  const trimmedDynamic = (dynamicValue || '').trim();
  const to = entry.dynamic
    ? (trimmedDynamic || entry.to)
    : entry.to;

  return { to: to || '', cc: entry.cc || '' };
}

export default { resolveRecipients, loadEmailRecipients, reloadEmailRecipients };
