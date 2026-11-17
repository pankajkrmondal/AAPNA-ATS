# Plan: WhatsApp alerts for Candidate Pipeline emails

**Status:** proposal, no code changed · **Date:** 13 Nov 2026 · **Phase:** 4 (expands item P04 "SMS / WhatsApp reminders" in `docs/Phase 3 Enhancements or Feedback/PLAN-Phase4.md`)

## 1. Summary

**Goal.** Whenever the ATS emails a candidate from the Candidate Pipeline, the candidate also gets one short WhatsApp text telling them to check their email.

**Recommendation.**

| Question | Answer |
|---|---|
| Which application? | **Meta WhatsApp Business Platform (Cloud API), used directly**, with no reseller in between. |
| Why is it the cheapest? | No monthly fee and no reseller markup. Meta charges per delivered template message only: about ₹0.115 + GST for a "utility" message in India (verify on Meta's rate card before budgeting, see §3). |
| Why is it secure? | Official API over HTTPS, hosted by Meta. No third party sees candidate phone numbers. Signed webhooks. Token stays in the server `.env` file. |
| How does it plug into the ATS? | A new `messaging` service with an outbox table. Each candidate email call site in the pipeline calls one helper after the email is sent. A cron sweep retries failures. A public webhook receives delivery status and "STOP" replies. |
| Biggest roadblock | Meta onboarding (business verification, a dedicated phone number, template approval). This takes 1–3 weeks of calendar time and none of it is coding. Start it first. |
| Build effort | About 70 hours of development and testing, plus the onboarding wait (§12). |

**What "no failure" means in this plan.** No plan can promise zero bugs. This one is built so that a WhatsApp problem can never break or delay the existing email and pipeline flow, can never message a real candidate from local or staging, and can be switched off in seconds. Every known failure mode is listed with its handling (§9, §10), and go-live is gated on a test checklist (§13).

**Three rules the design follows.**

1. **Email first.** WhatsApp is sent only after the email was actually sent. If the recruiter chose not to email, or the email failed, no WhatsApp goes out.
2. **WhatsApp never carries the email content.** It is a fixed, pre-approved sentence ("we emailed you, please check"). Rejection reasons, salary and recruiter-typed text stay in the email.
3. **Additive only.** Three new tables, one new service folder, a few one-line calls. No existing table or email behaviour changes.

---

## 2. Which application: options compared

| Option | Cost on top of Meta's fee | Billing | Security / data path | Verdict |
|---|---|---|---|---|
| **Meta Cloud API, direct** | None | Card on the Meta business account; Indian businesses are billed in INR | ATS → Meta only | **Recommended** |
| Indian reseller (MSG91, Gupshup, AiSensy, Interakt) | Monthly platform fee and/or per-message markup | INR, prepaid wallet, GST invoice, local support | ATS → reseller → Meta. A third party processes candidate numbers | **Fallback** if Finance needs a prepaid wallet / local GST invoice, or Meta onboarding stalls |
| Twilio | About $0.005 per message markup | USD | ATS → Twilio → Meta | Not recommended: USD billing, extra cost, no benefit at this volume |
| Unofficial libraries (Baileys, whatsapp-web.js, "WhatsApp Web" automation) | Free | — | Breaks WhatsApp terms; number gets banned; no delivery guarantees | **Never use** |
| WhatsApp Business App (phone app) | Free | — | Manual only, no API | Not automatable |

Why direct Cloud API fits this codebase:

- The backend already calls outside services with plain `fetch` through `tracedFetch` (`backend/src/utils/externalCall.js`) and uses no vendor SDKs. The Cloud API is one HTTPS POST, so no new npm dependency is needed.
- The design uses a provider adapter (§6.2), so switching to a reseller later means writing one new file, not redesigning.

---

## 3. Cost

Meta has charged **per delivered template message** since 1 July 2025 (the older per-conversation model is gone). The price depends on the template category and the recipient's country.

| Message type (India) | Approx. rate, excl. 18% GST | Used in this plan? |
|---|---|---|
| Utility template | ≈ ₹0.115 | **Yes, all messages** |
| Marketing template | ≈ ₹0.86 | No. Avoid: about 7× the cost |
| Authentication template | ≈ ₹0.115 (sources disagree) | No |
| Free-form reply inside the 24-hour window after the candidate writes to us | Free | Only the auto-reply (§6.7) |

These rates come from third-party summaries that agree on marketing but not fully on the others. **Confirm on Meta's official rate card** (developers.facebook.com → WhatsApp → Pricing) before giving Finance a number.

**Budget formula:** `candidates in pipeline per month × WhatsApp messages per candidate × ₹0.115 × 1.18`.

Illustration only (the volume is an assumption, replace with real numbers): 300 candidates × 6 messages = 1,800 messages ≈ ₹207 + GST ≈ **₹245 per month**.

**How to keep the bill low**

- Keep every template in the **utility** category. If Meta reclassifies one as marketing, the cost rises about 7×. The webhook reports this and the system alerts developers (§6.6).
- Failed and undelivered messages are not billed.
- Cap messages per candidate per day (§6.5), which also protects the number's quality rating.
- Add a spending limit / payment alert on the WhatsApp Business Account.

---

## 4. Scope

### 4.1 In scope: candidate emails sent from the Candidate Pipeline

Each row is an existing email. The WhatsApp message follows it.

| # | Pipeline email | Where it is sent today | WhatsApp template (§5) |
|---|---|---|---|
| 1 | Stage outcome (approved / hold / rejected) | `pipeline.service.js:1499` → `sendStageOutcomeEmail` | `ats_email_update` |
| 2 | Closure outcome (approved / rejected / on hold) | `pipeline.service.js:2036` → `sendStageOutcomeEmail` | `ats_email_update` |
| 3 | Ad-hoc email from the drawer | `pipeline.service.js:2300` → `sendAdHocCandidateEmail` | `ats_email_update` |
| 4 | Evalground test invite / cancellation | `assessmentInvite.service.js:76, 231` | `ats_action_needed` |
| 5 | Interview scheduled | `interviewSchedule.service.js:1079` | `ats_interview_scheduled` |
| 6 | Interview rescheduled | `interviewSchedule.service.js:1580` | `ats_interview_scheduled` |
| 7 | Interview cancelled | `interviewSchedule.service.js:1284` | `ats_interview_cancelled` |
| 8 | Interview reminder (cron) | `jobs/interviewReminder.js:228` | `ats_interview_reminder` |
| 9 | Document request / reminder / re-request | `documentCollection.service.js:140` (`sendDocumentEmail`) | `ats_action_needed` |

Line numbers are from branch `pankaj-work-staging-v28` on 13 Nov 2026; re-check before editing.

### 4.2 Out of scope for version 1

- Emails to the interview panel, vendors, hiring managers, approvers and internal alerts.
- Screening-stage emails (shortlist, rejection, welcome, missing-data). Easy to add later with the same helper.
- Two-way chat with candidates inside the ATS. Version 1 stores replies and sends one auto-reply.
- SMS fallback. The tables carry a `channel` column so SMS can be added later without a redesign.
- Closure outcomes in `SILENT_FINAL_OUTCOMES` (joined, backed out, withdrawn…). They send no email today, so they send no WhatsApp either. This follows from rule 1 automatically.

---

## 5. Message templates

WhatsApp only lets a business start a conversation with a **template that Meta has approved in advance**. Free text is not allowed. Submit these five as category **Utility**, language **English (en)**.

| Template name | Body | Variables |
|---|---|---|
| `ats_email_update` | Hi {{1}}, AAPNA Infotech has emailed you an update about your application for {{2}}. Please check your inbox and spam folder. | name, position |
| `ats_action_needed` | Hi {{1}}, AAPNA Infotech has emailed you a request that needs your action for your {{2}} application. Please check your inbox and spam folder. | name, position |
| `ats_interview_scheduled` | Hi {{1}}, your {{2}} interview for {{3}} at AAPNA Infotech is scheduled for {{4}} IST. The joining details are in the email we sent you. | name, round, position, date-time |
| `ats_interview_reminder` | Hi {{1}}, a reminder that your {{2}} interview for {{3}} at AAPNA Infotech starts at {{4}} IST. The joining link is in your email. | name, round, position, time |
| `ats_interview_cancelled` | Hi {{1}}, your {{2}} interview for {{3}} at AAPNA Infotech has been cancelled. Please check your email for details. | name, round, position |

Add the footer **"Reply STOP to stop WhatsApp updates"** to every template.

Rules that prevent rejections and runtime errors:

- **No links in version 1.** Links (Teams, upload, test) stay in the email. This avoids link-approval problems and keeps private tokens out of WhatsApp.
- **Neutral wording.** `ats_email_update` never says whether the news is good or bad, so the same template is safe for a rejection.
- **No promotional words** ("opportunity", "congratulations", "apply now"). Promotional wording makes Meta reclassify the template as marketing.
- **Variable values** must not be empty and must not contain a line break, a tab or more than four spaces in a row. The code cleans every value and uses a fallback ("Candidate", "the role") for blanks. Meta rejects the message otherwise (error 132000 / 132012).
- The number of variables sent must match the approved template exactly. The template registry (§6.3) is the single place that defines them, and a unit test checks each one.
- A template cannot be edited freely after approval. To change wording, create a new version (`ats_email_update_v2`) and switch the registry.

---

## 6. Design

### 6.1 Flow

```
Recruiter action / cron in the pipeline
        │
        ▼
Existing email send ── failed or not chosen ──► stop (no WhatsApp)
        │ sent
        ▼
notifyCandidateOnWhatsApp(event, pipeline, values)      never throws
        │  checks: switch on? event on? phone valid? consent? daily cap?
        ▼
INSERT into rpa_message_log (status queued, unique dedupe key)
        │
        ▼
Outbox sweep (cron, every minute, atomic claim) ──► Meta Cloud API
        │                                              │
        ▼                                              ▼
status sent (Meta message id stored)        webhook: delivered / read / failed
        │                                              │
        └────────────► Pipeline drawer shows the WhatsApp status ◄──┘
```

The pipeline request returns as soon as the outbox row is inserted. It never waits on Meta.

### 6.2 New files (nothing existing is rewritten)

| File | Purpose |
|---|---|
| `backend/src/services/messaging/whatsapp.service.js` | `notifyCandidateOnWhatsApp()`: all checks, then inserts the outbox row. Catches every error. |
| `backend/src/services/messaging/whatsappTemplates.js` | Registry: event key → template name, language, ordered variable builder. |
| `backend/src/services/messaging/whatsappRecipient.js` | Phone validation, consent lookup, non-production redirect. |
| `backend/src/services/messaging/providers/metaCloud.provider.js` | The HTTPS call to Meta, via `tracedFetch('whatsapp', …)`. |
| `backend/src/services/messaging/providers/console.provider.js` | Logs instead of sending. Default everywhere. |
| `backend/src/jobs/messageOutbox.js` | Cron sweep through `runJob` (heartbeat and failure alerts come for free). |
| `backend/src/jobs/messageRetentionSweep.js` | Deletes old webhook payloads and blanks old phone numbers. |
| `backend/src/routes/whatsappWebhook.routes.js` + controller | Public webhook: verification handshake, signed events. |
| `backend/prisma/ddl/2026-11-xx-whatsapp-messaging.sql` + `.rollback.sql` + `.README.md` | The three tables and settings rows. |
| `backend/src/tests/unit/whatsapp*.test.js`, `backend/src/tests/integration/whatsappMessaging.test.js` | Tests (§13). |

P04 in the existing Phase 4 plan already named the folder `services/messaging/`, the table `rpa_message_log` and the variable `MESSAGING_PROVIDER`. This plan keeps those names. P04's extra column `candidate_sms_reminded_at` is **not needed**: the unique dedupe key (§6.4) does that job without touching `rpa_interview_schedule`.

### 6.3 Small edits to existing files

| File | Edit |
|---|---|
| The 9 call sites in §4.1 | One call to `notifyCandidateOnWhatsApp(...)` placed after the email succeeded. |
| `backend/src/app.js:76` | Add a `verify` callback to `express.json()` that keeps the raw body for the webhook path only (§6.6). Exempt the webhook path from the global `/api` rate limiter and give it its own limiter. |
| `backend/src/routes/index.js` | Mount `/whatsapp` (public, like `/track`). |
| `backend/src/server.js` | Start/stop the two new jobs. |
| `backend/src/config/index.js` | New `messaging` block (§6.8). |
| `backend/src/controllers/settings.controller.js`, `frontend/src/pages/Settings.jsx` | WhatsApp settings section (§7). |
| `frontend/src/components/pipeline/PipelineDrawer.jsx` | Status display and the per-send checkbox (§7). |
| Candidate-facing forms (missing-details form, document upload page) | Consent checkbox (§8). |
| `backend/prisma/schema.prisma` | Regenerated with `npx prisma db pull` after the DDL, as the repo does today. |

### 6.4 Database (new tables only)

**`rpa_message_log`**: one row per message, outbound or inbound. It is both the outbox and the audit log.

| Column | Notes |
|---|---|
| `id` bigserial PK | |
| `env` varchar(20) | The environment that created the row. The sweep only claims rows of its own environment (§10, risk 3). |
| `channel` varchar(20) | `whatsapp` (later `sms`). |
| `direction` varchar(10) | `outbound` / `inbound`. |
| `event_key` varchar(50) | e.g. `stage_outcome`, `interview_reminder`. |
| `dedupe_key` varchar(200) **UNIQUE** | Blocks duplicates. Examples: `stage_outcome:<stage event id>`, `adhoc:<email message id>`, `interview_scheduled:<schedule id>:<start time>`, `interview_reminder:<schedule id>:<start time>`, `doc:<request id>:<template>:<date>`. |
| `pipeline_id`, `cv_id`, `stage_event_id`, `email_message_id` | Links for the drawer and for audit. Nullable, no cascading delete. |
| `to_phone` varchar(20) | E.164 format. Blanked to the last 4 digits by the retention sweep. |
| `template_name`, `template_lang`, `template_params` jsonb | Exactly what was sent. |
| `status` varchar(20) | `queued` → `sending` → `sent` → `delivered` → `read`, or `failed`, or `skipped`. |
| `skip_reason` varchar(50) | `no_phone`, `invalid_number`, `no_consent`, `opted_out`, `daily_cap`, `disabled`, `non_prod_no_test_number`, `not_on_whatsapp`. |
| `attempts` int, `next_attempt_at` timestamptz | Retry control. `next_attempt_at` also implements quiet hours. |
| `provider`, `provider_message_id` (indexed, unique when not null) | Meta's message id, used to match webhook events. |
| `error_code`, `error_message` | From Meta. |
| `pricing_category`, `billable` | From the status webhook, for cost reports. |
| `created_at`, `sent_at`, `delivered_at`, `read_at`, `failed_at`, `created_by` | |

Indexes: `(env, status, next_attempt_at)`, `(pipeline_id)`, `(to_phone, created_at)`.

**`rpa_message_contacts`**: one row per phone number. Consent and opt-out live here, keyed by phone, so a STOP from a number blocks it for every candidate record that shares it.

| Column | Notes |
|---|---|
| `phone_e164` PK | |
| `consent_status` | `opted_in` / `opted_out` / null (unknown). |
| `consent_source`, `consent_at`, `consent_cv_id` | `candidate_form`, `recruiter_confirmed`, `inbound_message`. |
| `opted_out_at`, `opt_out_source` | |
| `not_on_whatsapp_at` | Set when Meta says the number has no WhatsApp. Skips sends for 30 days. |
| `last_inbound_at`, `last_auto_reply_at` | |

**`rpa_message_webhook_events`**: raw webhook payloads, kept 30 days for debugging. Columns: `id`, `received_at`, `kind`, `provider_message_id`, `payload` jsonb, `processed`.

DDL follows the repo convention: idempotent (`IF NOT EXISTS`), additive, with a rollback file, run through `node scripts/run-ddl.mjs --env … --expect-db …`, then added to the `prisma/ddl/pgadmin` bundle.

### 6.5 Sending rules (in order, inside `notifyCandidateOnWhatsApp`)

1. Master switch `whatsapp.enabled` and the per-event switch must both be on, otherwise return silently.
2. Read the candidate's `rpa_cv.ContactNumber` and validate it **strictly** (§9, risk 1). Invalid → `skipped`.
3. Look up `rpa_message_contacts`. Opted out → `skipped`. Unknown consent while `whatsapp.require_opt_in` is true → `skipped`.
4. Daily cap: at most `whatsapp.per_candidate_daily_cap` (default 3) outbound messages per phone per 24 hours. The interview reminder is exempt.
5. Non-production: replace the number with the test number, or skip if none is set (§10).
6. Insert the row with its dedupe key using `ON CONFLICT DO NOTHING`.
7. Quiet hours (default 21:00–08:00 IST): set `next_attempt_at` to 08:00. Interview messages are exempt.

Skipped sends are stored too, so the drawer can tell the recruiter why nothing was sent.

**Outbox sweep** (cron every minute, `MESSAGING_OUTBOX_CRON`):

- Claim rows atomically with the pattern already used in `jobs/interviewReminder.js:208`: `updateMany` from `queued` to `sending` where status is still `queued`, env matches, and `next_attempt_at` is due. Only one process can win a row.
- Before sending, re-check that the journey is still open and not paused, and that an interview message still matches the current schedule. A stale reminder for a cancelled interview is skipped.
- Call the provider with a 10-second timeout.
- Success → `sent` and store Meta's message id.
- Retryable error → back to `queued` with backoff (1, 5, 15, 60 minutes), 5 attempts at most, then `failed`.
- Permanent error → `failed` immediately (§9 lists which is which).
- Rows stuck in `sending` for more than 10 minutes are checked, not blindly resent: if they have a Meta message id they become `sent`; otherwise they go back to `queued`. This accepts a very small duplicate risk over a silent loss.
- Interview reminders that are more than 15 minutes late are skipped, not sent late.

### 6.6 Webhook (delivery status, replies, account events)

Endpoints, both public and unauthenticated like `/api/track`:

- `GET /api/whatsapp/webhook`: Meta's one-time verification. Compare `hub.verify_token` to `WHATSAPP_WEBHOOK_VERIFY_TOKEN` and echo `hub.challenge`.
- `POST /api/whatsapp/webhook`: events.

Handling:

1. **Verify the signature first.** Compute HMAC-SHA256 of the **raw request body** with `WHATSAPP_APP_SECRET` and compare to the `X-Hub-Signature-256` header using `crypto.timingSafeEqual`. Reject with 401 on mismatch.
2. Store the payload in `rpa_message_webhook_events`, answer **200 immediately**, then process. Meta retries for days if it does not get a quick 200.
3. **Status events** (`sent`, `delivered`, `read`, `failed`): find the row by `provider_message_id`. Events arrive duplicated and out of order, so only ever move a status **forward** (`sent` < `delivered` < `read`). A late `failed` does not overwrite `delivered`.
4. **Inbound messages:** see §6.7.
5. **Account events:** template paused / disabled / rejected, template category changed, phone quality dropped, account restricted → `sendOpsAlert` to developers and an entry in Logs & errors. If a template is paused or disabled, its event switch is turned off automatically.

Subscribe the Meta app to these webhook fields: `messages`, `message_template_status_update`, `message_template_quality_update`, `template_category_update`, `phone_number_quality_update`, `account_update`.

**Known blocker in the current code:** `app.js:76` parses JSON globally, so the raw body is gone by the time a route runs and the signature can never match. The fix is the `verify` callback in §6.3, scoped to the webhook path so nothing else changes.

### 6.7 Candidate replies

- Text matching STOP / UNSUBSCRIBE / "stop" (case-insensitive, trimmed) → mark the number `opted_out`, send one confirmation.
- START → mark `opted_in` with source `inbound_message`.
- Anything else → store it in `rpa_message_log` as `inbound`, raise an in-app notification for the recruitment team through the existing `notify()` service, and send **one** auto-reply per 24 hours: "This number is not monitored. Please reply to our email or write to <recruitment mailbox>." A reply inside the 24-hour window is free and does not need a template.

### 6.8 Configuration

**`.env.<environment>` (secrets, never in the database or in git):**

| Variable | Notes |
|---|---|
| `MESSAGING_PROVIDER` | `console` (default) or `meta_cloud`. |
| `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WABA_ID` | From Meta. |
| `WHATSAPP_ACCESS_TOKEN` | System-user token. |
| `WHATSAPP_APP_SECRET` | For webhook signatures. |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Long random string. |
| `WHATSAPP_GRAPH_VERSION` | Pinned API version, e.g. the current one at build time. |
| `WHATSAPP_TEST_RECIPIENTS` | Non-production redirect number(s). |
| `WHATSAPP_REDIRECT_TO_TEST` | Optional override, same meaning as `EMAIL_REDIRECT_TO_TEST`. |
| `MESSAGING_OUTBOX_CRON` | Default `* * * * *`. |

**`rpa_settings` (editable in Settings):** `whatsapp.enabled`, `whatsapp.events.<event_key>`, `whatsapp.require_opt_in`, `whatsapp.per_candidate_daily_cap`, `whatsapp.quiet_hours`.

Two independent off-switches exist: the env provider and the database setting. Either one alone stops all sending.

---

## 7. Screens

**Pipeline drawer**

- Next to each email entry in the activity timeline: `WhatsApp: delivered` / `read` / `failed (reason)` / `not sent (reason)`.
- In the outcome and ad-hoc email dialogs, under the existing "email the candidate" choice: a checkbox **"Also send a WhatsApp alert"**. It is ticked by default when sending is possible, and disabled with the reason when it is not ("No mobile number", "Candidate opted out", "No consent recorded"). Unticking the email also unticks and disables it.
- A read-only preview of the fixed WhatsApp sentence, so the recruiter knows what goes out.

**Settings → WhatsApp** (same roles that can edit email settings today)

- Master switch and one switch per event.
- "Require consent" switch, daily cap, quiet hours.
- "Send test message" to a number the admin types (limited to the test list outside production).
- Read-only health: last sweep time (from the job heartbeat), counts for today (sent / delivered / failed / skipped), template status.

**Candidate record:** show and edit WhatsApp consent (opted in / opted out / unknown) next to the mobile number, including in the Schedule dialog where the phone is already captured (`updateCandidatePhoneForPipeline`).

---

## 8. Security, privacy and consent

| Area | Control |
|---|---|
| Secrets | Token, app secret and verify token only in `.env.<env>`. Confirm these files are git-ignored before adding them. Use a Meta **system user** token limited to this one WhatsApp account, with only `whatsapp_business_messaging` and `whatsapp_business_management`. Rotate on staff change. |
| Webhook | Signature check on the raw body, constant-time compare, own rate limiter, 200 response with no detail in the body. |
| Personal data in logs | Phone numbers through `maskPhone` / `logMask` (already in the repo). Never log template values or inbound text at info level. |
| Message content | Fixed templates only. No outcome, no reasons, no salary, no links in version 1. |
| Staging and local | Hard redirect to test numbers; skip when none configured (§10). |
| Retention | Webhook payloads deleted after 30 days. `to_phone` in the log blanked to the last 4 digits after 12 months. Both through a daily sweep. |
| Vendors | No vendor ever receives a WhatsApp. The helper only reads the candidate's own number. |
| Access | Settings page and test-send limited to admin roles. The drawer shows status to anyone who can already see the journey. |

**Consent.** Meta requires that the person agreed to receive WhatsApp messages from the business. India's Digital Personal Data Protection Act expects notice and consent for using personal data. The plan:

- Add a checkbox to the candidate-facing forms: "I agree to receive updates about my application on WhatsApp at this number."
- Let recruiters record verbal consent in the Schedule dialog ("Candidate agreed to WhatsApp updates"). The user and time are stored.
- Add one line to the careers page / privacy notice and to the first email a candidate receives.
- Honour STOP at once and permanently until the candidate sends START.
- Default `whatsapp.require_opt_in = true`. Whether to also message candidates whose consent is unknown is a business and legal decision (§14, decision 2). This plan does not give legal advice; have the wording checked by whoever owns compliance.

---

## 9. Roadblocks and challenges

### 9.1 Roadblocks outside the code (start these first)

| # | Roadblock | What to do | Lead time |
|---|---|---|---|
| 1 | **Meta business verification** | Company documents (incorporation / GST certificate), a business website and a domain email. Without it the account is limited to 250 different recipients per 24 hours. After it the limit is about 2,000. | Days to 2 weeks |
| 2 | **Dedicated phone number** | A number that is not registered on any WhatsApp or WhatsApp Business app and can receive an SMS or call for the one-time code. Buy a new SIM or use a landline. Do not reuse a recruiter's personal number. | 1–2 days |
| 3 | **Display name approval** | Must clearly relate to the company, e.g. "AAPNA Infotech Recruitment". | 1–3 days |
| 4 | **Template approval** | Usually minutes to a day. Rejections happen for promotional or vague wording. | 1–3 days including retries |
| 5 | **Payment method** | A card on the WhatsApp Business Account, with GST details. | Finance |
| 6 | **Public HTTPS webhook URL** | Meta must reach `PUBLIC_BASE_URL/api/whatsapp/webhook` with a valid certificate. If Cloudflare sits in front (the login uses Turnstile), add a firewall rule so the webhook path is not challenged or blocked. | Ops |
| 7 | **Who owns the Meta account** | A named business owner with two admins, so the account does not depend on one person's Facebook login. | Decision |
| 8 | **Consent decision** | See §8 and §14. | RT + management |

### 9.2 Technical challenges and how the plan handles each

| # | Challenge | Handling |
|---|---|---|
| 1 | **Wrong recipient.** `ContactNumber` is free text. `normalisePhone` keeps the last 10 digits, which is right for matching but would turn a foreign number into a wrong Indian number. | A separate strict check for sending: accept only 10 digits starting 6–9, or `91`/`0` + such a number. Anything else is skipped as `invalid_number`. Use the first valid number only. |
| 2 | **Number not on WhatsApp.** | Meta returns error 131026. Mark `failed`, remember it on the contact, do not retry for 30 days. Email was already sent, so nothing is lost. |
| 3 | **Duplicates** from double clicks, cron overlap, retries or two processes. | Unique `dedupe_key` plus atomic claim. |
| 4 | **Meta or network down.** | Outbox with backoff retries. The pipeline action never waits and never fails because of WhatsApp. |
| 5 | **Server restart mid-send.** | Rows are in the database, not in memory. Stuck `sending` rows are recovered (§6.5). |
| 6 | **Webhook raw body lost** to the global JSON parser. | `verify` callback on the webhook path (§6.3). |
| 7 | **Webhook events duplicated or out of order.** | Forward-only status changes, matched on Meta's message id. |
| 8 | **Template paused, disabled or recategorised.** | Webhook alert, automatic switch-off for that event, permanent-failure handling for errors 132015 / 132016. |
| 9 | **Recipient limits and quality rating.** Blocks and reports by candidates lower the rating and can restrict the number. | Consent, neutral useful messages only, daily cap, STOP handling, quality webhook alerts. |
| 10 | **Token expiry or revocation** (error 190). | Use a non-expiring system-user token. On 190, stop the sweep from hammering, alert developers, keep rows queued. |
| 11 | **Stale messages**, e.g. a reminder after the interview was cancelled. | Re-check journey and schedule just before sending; drop late reminders. |
| 12 | **Recruiter edits the email but WhatsApp text is fixed.** | By design. The UI shows the fixed sentence so there is no surprise. |
| 13 | **No delivery guarantee.** A candidate may have blocked the number or be offline. | Email remains the primary channel. WhatsApp status is shown but never blocks the pipeline. |
| 14 | **Billing surprises.** | Utility only, cost fields stored per message, category-change alert, account spending limit. |
| 15 | **Local machine and staging share one database** (noted in `jobRunner.js`). A local run could claim staging's rows. | `env` column; each sweep claims only its own environment's rows. Provider defaults to `console`. |

Error classes for the provider:

| Class | Meta error codes | Action |
|---|---|---|
| Retry with backoff | network errors, HTTP 5xx, 130429 (throughput), 131048 (spam rate limit), 131056 (too many to the same person), 131016 (service unavailable), 131000 (generic) | Requeue, up to 5 attempts |
| Permanent, this message | 131026 (cannot deliver / no WhatsApp), 132000 / 132012 (variables wrong), 131021 | `failed`, no retry |
| Permanent, this template | 132001 (template missing), 132015 (paused), 132016 (disabled) | `failed`, switch the event off, alert |
| Account level | 190 (token), 131031 (account locked), 131042 (payment problem), 368 (policy block) | Pause all sending, alert, leave rows queued |

Confirm the exact code list against Meta's error reference during the build; codes change between API versions.

---

## 10. Protection for staging and local

This mirrors the email safety net in `sendGraphEmail` and `nonProdSafeCandidateEmail`.

1. **Provider defaults to `console`.** A real send needs `MESSAGING_PROVIDER=meta_cloud` set on purpose.
2. **Redirect inside the provider** (last line of defence): outside production every number is replaced with `WHATSAPP_TEST_RECIPIENTS`. If that is empty, the send is skipped. It fails closed, never open.
3. **Environment-scoped outbox:** a sweep only claims rows where `env` equals its own `NODE_ENV`.
4. **Separate Meta assets:** staging uses Meta's free **test number**, which can only message up to five numbers that were verified in the Meta dashboard. Even a code mistake cannot reach a real candidate from staging. Production has its own account, number and token.
5. **Automated tests always use the console provider.** This keeps the project rule: no real external notifications from tests.

---

## 11. Build procedure

Work in this order. Each phase ends in a state that is safe to leave deployed with the feature off.

### Phase 0: Onboarding (no code; start on day 1, runs in parallel)

1. Decide owner, number, display name, consent policy, events (§14).
2. Create or confirm the Meta Business portfolio at business.facebook.com. Add two admins. Turn on two-factor login.
3. Start business verification (Security Centre).
4. Create a Meta developer app (type: Business). Add the WhatsApp product. This creates a test account and test number at once, enough for all development.
5. Add up to five team phone numbers as verified test recipients.
6. Create the five templates in the test account and get them approved.
7. Create a system user, assign the app and the WhatsApp account, generate the token. Put it in `.env.staging` on the server only.
8. For production later: add the real number, verify by one-time code, set the two-step PIN, get the display name approved, add the payment method, recreate the templates in the production account, switch the app to Live mode (needs a privacy policy URL).

### Phase 1: Database and configuration

1. Write the DDL, rollback and README. Run on local, then staging, with `scripts/run-ddl.mjs`.
2. `npx prisma db pull` and `npx prisma generate`. Check the diff contains only the three new models.
3. Add the `messaging` config block and settings defaults (everything off).

### Phase 2: Core service with the console provider

1. `whatsappRecipient.js`: strict phone check, consent lookup, non-production redirect. Unit tests first.
2. `whatsappTemplates.js`: registry and value cleaning. Unit tests.
3. `whatsapp.service.js`: rules of §6.5.
4. `console.provider.js`, then the outbox job with claim, retry and stuck-row recovery.
5. Integration test: an outcome with email creates exactly one row; a second call creates none.

### Phase 3: Meta provider and webhook

1. `metaCloud.provider.js` with timeout and error classification.
2. Raw-body `verify` in `app.js`; webhook routes, signature check, event storage, status updates, inbound handling, account alerts.
3. Register the staging webhook URL in the Meta app; check the handshake; subscribe the fields.
4. Send to a verified test recipient from staging; watch `sent → delivered → read` arrive.

### Phase 4: Wire the pipeline call sites

1. Add the helper call at the 9 call sites, one at a time, each behind its own event switch.
2. For each one, confirm: email off → no row; email failed → no row; paused or closed journey → no row.

### Phase 5: Screens and consent

1. Settings section and test-send.
2. Drawer status and checkbox.
3. Consent checkbox on the candidate forms; consent control on the candidate record and the Schedule dialog.

### Phase 6: Hardening

1. Retention sweep.
2. Alerts (template, quality, token, payment) through `sendOpsAlert`.
3. Update `docs/system/04-JOBS-AND-INTEGRATIONS.md`, `05-CONFIGURATION.md`, `06-OPERATIONS-RUNBOOK.md`, the recruiter guide and the changelog.

### Phase 7: Staging sign-off, then production rollout

1. Run the full checklist in §13 on staging.
2. Production deploy with `MESSAGING_PROVIDER=console` and `whatsapp.enabled=false`. Run the DDL. Confirm nothing changed for users.
3. Switch to `meta_cloud` but keep `WHATSAPP_REDIRECT_TO_TEST=true`, so production sends only to internal numbers. Run two or three real pipeline actions.
4. Remove the redirect. Enable **one** event (`interview_reminder` is the most useful and least sensitive). Watch for 2–3 working days: delivery rate, failures, quality rating, replies.
5. Enable the remaining events one by one.

### Rollback

- Instant: `whatsapp.enabled=false` in Settings. Queued rows stay and are not sent.
- Full: `MESSAGING_PROVIDER=console` and restart.
- Code: the helper calls are inert when disabled, so a code rollback is rarely needed. If it is, deploy the previous build first, then run the rollback DDL (data lost: message history and consent records, so export `rpa_message_contacts` first).

---

## 12. Effort estimate

| Work | Hours |
|---|---|
| DDL, Prisma, config | 4 |
| Recipient, template registry, service, console provider | 12 |
| Outbox job, retries, recovery | 8 |
| Meta provider, error handling | 6 |
| Webhook, signature, status, inbound, alerts | 10 |
| Wiring 9 call sites | 6 |
| Settings screen, drawer, consent screens | 12 |
| Unit and integration tests | 8 |
| Staging end-to-end, documentation, rollout support | 6 |
| **Total** | **≈ 72** |

P04 was sized at 24 hours for interview reminders only, with no webhook, consent or drawer work. This plan covers all pipeline emails with delivery tracking, which is where the difference comes from. Calendar time is driven by Meta onboarding, not by the build.

---

## 13. Test plan and go-live checklist

**Unit tests**

- Phone check: `+91 98765 43210`, `098765-43210`, two numbers in one field, 9 digits, a number starting 5, a foreign number, empty.
- Each template: correct variable count, blank and multi-line values cleaned.
- Rules: disabled, event off, opted out, unknown consent with and without the require switch, daily cap, quiet hours.
- Non-production redirect, including the empty test-list case (must skip).
- Signature check: valid, wrong secret, altered body, missing header.
- Status ordering: `read` then `delivered` stays `read`; duplicate events change nothing.
- Error classification table.

**Integration tests** (console provider, existing fixtures)

- Outcome with email → one row. Outcome with "do not email" → none. Failed email → none.
- The same action twice → one row.
- Silent closure outcome → none.
- Reminder sweep twice → one row. Reschedule → a new row for the new time; the old one is skipped.
- Paused journey → skipped at send time.
- Retry path with a stubbed provider: retryable, then success; permanent failure; stuck `sending` recovery.
- Sweep ignores rows of another `env`.

**Staging end-to-end** (Meta test number, verified recipients only)

- Each of the 9 events delivers the right template with the right values.
- `delivered` and `read` appear in the drawer.
- STOP blocks further sends; START restores them.
- A free-text reply produces one auto-reply and a notification.
- A number without WhatsApp shows a clear failure and email is unaffected.
- Meta unreachable (block the host temporarily): pipeline actions still succeed, rows retry.
- Playwright UI checks for the checkbox states and Settings page, run with the console provider and `BASE_URL` printed and confirmed as staging.

**Go-live gate**

- [ ] Business verified, production number registered, display name approved
- [ ] Five production templates approved as Utility
- [ ] Payment method and spending limit set
- [ ] Production webhook verified, fields subscribed, firewall rule in place
- [ ] Secrets only in `.env.production`, file not tracked by git
- [ ] All tests green; staging checklist signed
- [ ] Consent wording live on forms and privacy notice
- [ ] Runbook and recruiter guide updated
- [ ] Internal-numbers-only production run passed

---

## 14. Decisions needed before the build

| # | Decision | Recommendation | Owner |
|---|---|---|---|
| 1 | Provider | Meta Cloud API direct. Reseller only if Finance requires a prepaid wallet or local invoice. | Harish + Finance |
| 2 | Message candidates with unknown consent? | No. Require opt-in; collect it on forms and by recruiter confirmation. | Management + compliance |
| 3 | Send a WhatsApp for rejections? | Yes, with the neutral `ats_email_update` text, but keep a separate switch so RT can turn it off. | RT |
| 4 | Which events at launch | Interview reminder first, then scheduled / cancelled, then the rest. | RT |
| 5 | Phone number and display name | New dedicated SIM; "AAPNA Infotech Recruitment". | RT + IT |
| 6 | Owner of the Meta business account | A company admin plus one backup, not a personal profile of a single developer. | Management |
| 7 | Quiet hours and daily cap | 21:00–08:00 IST; 3 per day. | RT |
| 8 | Who reads candidate replies | The recruitment mailbox team, through in-app notifications. | RT |
| 9 | Mailbox named in the auto-reply | The production recruitment mailbox. | RT |

---

## 15. Sources for platform facts

Pricing and limits were checked on 13 Nov 2026 against third-party summaries; confirm on Meta's own pages before committing budgets.

- Meta: [Pricing on the WhatsApp Business Platform](https://developers.facebook.com/docs/whatsapp/pricing)
- Meta: [Messaging limits](https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits)
- [MyOperator: WhatsApp Business API pricing in India 2026](https://myoperator.com/blog/whatsapp-business-api-pricing-india-2026)
- [AiSensy: per-message pricing update effective 1 January 2026](https://m.aisensy.com/blog/whatsapp-conversation-based-pricing-model-february-2022)
- [AiSensy: WhatsApp message limits in 2026](https://m.aisensy.com/blog/whatsapp-message-limits-guide/)
- [baat.ai: what the WhatsApp Business API costs in India (2026)](https://baat.ai/blog/whatsapp-api-pricing-india)
