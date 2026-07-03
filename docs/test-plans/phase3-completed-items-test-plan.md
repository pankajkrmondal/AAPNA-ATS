# Phase 3 — Functional Test Plan for Completed Items (Staging)

**Scope:** The 19 tracker items marked **Completed / Staging / Phase 3** across three feature groups:

| Group | Items |
|---|---|
| Outlook Integration | OAuth + token refresh, candidate mapping, inbound sync, threaded conversation view, threaded reply, open tracking, response detection, bounce handling, activity monitoring |
| Candidate Communication Tracking | Email history per candidate, automated-email tracking, candidate replies inside module |
| Zeko Assessment Integration | Auth + credential store, job sync, interview scheduling + email, cancellation + email, hourly result fetch, store results + pipeline "completed", score write-back to `rpa_cv` |

**Date:** 2026-07-03
**Environment:** Staging

> ⚠️ **Two tracker items marked "Completed" are not actually implemented in code** — *Email open tracking* and *Threaded reply support*. They are included below as documented gaps with verification steps proving the gap, and should be reclassified in the tracker. See [§6 Known Gaps](#6-known-gaps--recommendations).

---

## 1. Environment Setup & Prerequisites

### 1.1 Running the app

| Component | Command | Notes |
|---|---|---|
| Backend | `npm run dev:staging` (in `backend/`) | Express on port 5000; loads `backend/.env.staging` then `.env` |
| Frontend | `npm run dev` (in `frontend/`) | Vite on port 5173 |

### 1.2 Required configuration

**Outlook / Microsoft Graph** (`src/config/index.js` → `config.microsoft`):

| Env var | Purpose |
|---|---|
| `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT_ID` | App-only (client-credentials) Graph auth |
| `MS_DEFAULT_SENDER_EMAIL` | Shared mailbox used for **all** send and read operations |
| `INBOUND_SYNC_ENABLED=true` | Enables inbound conversation poller (already true in `.env.staging`) |
| `EMAIL_INTAKE_ENABLED=true` | Enables resume-attachment intake poller (already true in `.env.staging`) |
| `INBOUND_SYNC_CRON` / `EMAIL_INTAKE_CRON` | Default `*/5 * * * *` — for faster test cycles set to `* * * * *` temporarily |

**Zeko** (`src/config/index.js` → `config.zeko`):

| Env var | Purpose |
|---|---|
| `ZEKO_API_KEY`, `ZEKO_CLIENT_ID`, `ZEKO_COMPANY_ID` | Credentials (ZEKO_CLIENT_ID may also live in `rpa_settings` key `ZEKO_CLIENT_ID`, which takes precedence for scheduling) |
| `ZEKO_LOGIN_EMAIL` | OTP-login mailbox (defaults to `MS_DEFAULT_SENDER_EMAIL`) |
| `ZEKO_SYNC_ENABLED=true` | Required only for the **cron jobs** (job sync + result fetch). UI assign/schedule/cancel work without it, as long as an active row exists in `rpa_zeko_auth_token` |
| `ZEKO_JOBS_CRON` / `ZEKO_RESULTS_CRON` | Default `0 * * * *` / `30 * * * *` — tighten for testing |

### 1.3 ⚠️ Staging email redirection — read before testing

On non-production, **all outgoing candidate email is redirected to internal test inboxes** (`src/config/emailRecipients.js`, controlled by `EMAIL_REDIRECT_TO_TEST` / `EMAIL_STAGING_RECIPIENTS`). During testing:

- Check the **internal test inbox** for outbound emails, not the candidate's address.
- To test the true end-to-end flow with a controlled external mailbox, set `EMAIL_REDIRECT_TO_TEST=false` **only with a test candidate whose email you own**.

### 1.4 Test data

1. **Test candidate:** a row in `rpa_cv` whose `EmailID` is a mailbox the tester controls (e.g. a personal Gmail/Outlook), plus a linked row in `rpa_shortlisted_candidates` (`cv_id` → that CV). Candidate mapping and score write-back both match on `rpa_cv.EmailID ILIKE <email>`.
2. **DB access:** ability to run read-only SQL against the staging PostgreSQL (verification queries below).
3. **Zeko:** at least one published Zeko job synced into `rpa_zeko_jobs` with a non-null `primary_interview_id`.

> The test mailbox must **not** be on an internal domain — inbound sync skips senders from `@aapnainfotech.com` / `@aapna.com` as outbound loopbacks.

---

## 2. Test Cases — Outlook Integration

Implementation references: `src/services/onedrive.service.js` (token), `src/services/outlookReader.service.js` (Graph read), `src/jobs/inboundEmailSync.js` (poller), `src/services/screening.service.js` (conversation view + outbound recording).

### OUT-01 — OAuth token acquired lazily on first Graph call
- **Preconditions:** Backend freshly restarted; valid `MS_*` env vars.
- **Steps:** Trigger any Graph-backed action (e.g. open Outlook conversations modal in Analytics, or wait for one poller tick).
- **Expected:** Action succeeds; backend log shows a token request to `login.microsoftonline.com` only on the **first** call.
- **Verify:** Subsequent Graph calls within ~55 min produce **no** new token request (in-memory cache, expiry minus 5-min buffer).
- **Note:** Token is cached **in memory only** — there is no DB/file storage; `rpa_outlook_accounts` does *not* hold tokens. A restart forces re-mint (that is the expected design, not a bug).

### OUT-02 — Token refresh after expiry
- **Steps:** Keep the backend running past token expiry (~1 h), then trigger another Graph call.
- **Expected:** A new token is minted transparently; the Graph call succeeds with no user-visible error.

### OUT-03 — Graceful failure on bad credentials (negative)
- **Steps:** On a disposable staging instance, set an invalid `MS_CLIENT_SECRET`, restart, trigger a Graph action.
- **Expected:** Clear error logged; API returns a handled error (no crash); pollers log failure and continue on next tick.

### OUT-04 — Candidate mapping: inbound email → rpa_cv
- **Preconditions:** Test candidate (per §1.4); inbound sync enabled.
- **Steps:** From the test candidate's mailbox, send an email to `MS_DEFAULT_SENDER_EMAIL`. Wait one sync tick.
- **Expected:** Message stored with the candidate linked.
- **Verify:**
  ```sql
  SELECT id, direction, candidate_id, shortlist_id, subject, graph_message_id
  FROM rpa_email_messages
  WHERE candidate_email ILIKE '<test-email>'
  ORDER BY created_at DESC LIMIT 5;
  ```
  `candidate_id` = the test candidate's `rpa_cv.id`; `shortlist_id` = most recent shortlist row for that CV.

### OUT-05 — Candidate mapping: unmatched sender stored with NULL candidate
- **Steps:** Send an email to the shared mailbox from an address that exists in no `rpa_cv.EmailID`.
- **Expected:** Row created in `rpa_email_messages` with `candidate_id IS NULL` (message kept, not dropped).

### OUT-06 — Candidate mapping: internal senders skipped
- **Steps:** Send an email to the shared mailbox from an `@aapnainfotech.com` address.
- **Expected:** No inbound row created (admin domains are treated as outbound loopbacks).

### OUT-07 — Inbound sync polling & watermark
- **Steps:** Note current watermark, send a test email, wait one tick, re-check.
- **Verify:**
  ```sql
  SELECT key, value FROM rpa_settings
  WHERE key IN ('inbound_sync_last_sync', 'email_intake_last_sync');
  ```
- **Expected:** Watermark advances each successful run; only messages newer than the watermark are fetched (first-ever run looks back 24 h).

### OUT-08 — Inbound sync dedup (idempotency)
- **Steps:** After OUT-04, reset the watermark backwards: `UPDATE rpa_settings SET value = '<earlier ISO>' WHERE key='inbound_sync_last_sync';` and wait one tick.
- **Expected:** No duplicate rows — unique `graph_message_id` constraint causes re-fetched messages to be skipped.
- **Verify:** `SELECT graph_message_id, COUNT(*) FROM rpa_email_messages GROUP BY 1 HAVING COUNT(*) > 1;` → 0 rows.

### OUT-09 — Threaded conversation view (API)
- **Steps:** `GET /api/screening/outlook/conversations?email=<test-email>` (route: `screening.routes.js:77`).
- **Expected:** JSON threads containing both outbound (with `tracking {delivered, opened, ...}`) and inbound messages for that candidate, ordered chronologically.
- **Note:** Grouping is by **candidate email + position**, not by Graph `conversationId` — verify inbound replies and system emails appear in the same thread view.

### OUT-10 — Threaded conversation view (UI)
- **Steps:** In the frontend Analytics page, open the "Outlook Email Conversations" modal for the test candidate.
- **Expected:** Chat-bubble layout with inbound (left) / outbound (right) messages; outbound messages show a "Delivered" badge.

### OUT-11 — Threaded reply support — **GAP (expected not-implemented)**
- **Steps:** Search the API surface for a reply/compose endpoint (`grep -r "reply" backend/src/routes`); inspect the conversation modal for a reply input.
- **Expected result (current state):** No reply endpoint exists; `rpa_email_messages.in_reply_to` is never populated. **Record as GAP** — see §6.

### OUT-12 — Email open tracking — **GAP (expected fail)**
- **Steps:** Trigger a shortlist email; open it in the receiving inbox with images enabled. Then check:
  ```sql
  SELECT delivered, opened, open_count, first_opened_at
  FROM rpa_email_tracking ORDER BY id DESC LIMIT 5;
  ```
- **Expected result (current state):** `opened` stays `false` forever — there is **no tracking-pixel route and no code that sets `opened`**; outbound HTML contains no pixel. UI "Opened" badge can never appear. **Record as GAP** — see §6.

### OUT-13 — Response detection (flag replied)
- **Preconditions:** An outbound row in `rpa_email_messages` whose `conversation_id` a real reply will share (see limitation below).
- **Steps:** From the candidate mailbox, **reply** to a received ATS email. Wait one sync tick.
- **Verify:**
  ```sql
  SELECT t.replied, t.replied_at, m.conversation_id
  FROM rpa_email_tracking t JOIN rpa_email_messages m ON m.id = t.email_message_id
  WHERE m.candidate_email ILIKE '<test-email>' AND m.direction = 'outbound';
  ```
- **Expected:** `replied=true`, `replied_at` set — **but only when the inbound Graph `conversationId` matches a stored outbound row**.
- **⚠️ Known limitation:** outbound emails are stored with *synthetic* conversation IDs (`shortlist-conv-{id}`, `status-…`, `reminder-conv-{id}`), so in most cases the reply will **not** flip the flag. Execute the test, record actual behaviour, and cross-reference §6.

### OUT-14 — Bounce / undeliverable handling
- **Steps:** Trigger an ATS email to a nonexistent address at a real domain (e.g. `no-such-user-xyz123@gmail.com`) with `EMAIL_REDIRECT_TO_TEST=false` for that one send. Wait for the NDR to arrive in the shared mailbox + one sync tick.
- **Expected:** NDR detected by subject match (`undeliverable` / `delivery status notification` / `delivery failure`); matching outbound tracking row gets `bounced=true, bounce_reason=<NDR subject>`.
- **Verify:** `SELECT bounced, bounce_reason FROM rpa_email_tracking ORDER BY id DESC LIMIT 5;`
- **⚠️ Same conversation-ID limitation as OUT-13** — NDR correlation requires a matching `conversation_id`.

### OUT-15 — Activity monitoring (last-contact timestamps)
- **Steps:** After a sync tick and a shortlist send, check:
  ```sql
  SELECT email, last_sync_at FROM rpa_outlook_accounts;
  SELECT email_sent, email_sent_at, email_subject FROM rpa_shortlisted_candidates WHERE cv_id = <test cv id>;
  SELECT email_type, sent_at, responded_at, reminder_count FROM rpa_email_log ORDER BY sent_at DESC LIMIT 10;
  ```
- **Expected:** `last_sync_at` advances every successful sync; `email_sent_at`/`email_subject` set at shortlist send; `rpa_email_log.sent_at` recorded for every system email.

---

## 3. Test Cases — Candidate Communication Tracking

### CCT-01 — Complete email history per candidate (API)
- **Steps:** `GET /api/candidates/<cv_id>/emails` (route: `candidate.routes.js:74`).
- **Expected:** All `rpa_email_messages` rows for that candidate — **both** `inbound` and `outbound` — ordered `sent_at DESC`.

### CCT-02 — Automated emails are tracked
- **Steps:** Trigger each automated flow available on staging: shortlist email, status-change email, reminder (reminder scheduler).
- **Verify:** For each send, a row appears in:
  1. `rpa_email_log` (`email_type`, `recipient_email`, `subject`, `sent_at`) — audit log for *every* system email, and
  2. `rpa_email_messages` (direction `outbound`) + `rpa_email_tracking` (`delivered=true, delivered_at`) — for shortlist / status-change / reminder emails.

### CCT-03 — Candidate replies visible inside the module
- **Steps:** After OUT-13's reply, open the candidate's email history (CCT-01 endpoint) and the conversation modal (OUT-10).
- **Expected:** The inbound reply appears in both, attributed to the candidate (matched `candidate_id`), within one sync interval of arrival.

### CCT-04 — History correctness across multiple candidates (isolation)
- **Steps:** With ≥2 candidates having email traffic, fetch each candidate's history.
- **Expected:** No cross-contamination — each history contains only messages where `candidate_id` matches.

### CCT-05 — Unmatched inbound mail does not pollute candidate histories
- **Steps:** After OUT-05 (unmatched sender), fetch histories.
- **Expected:** The `candidate_id IS NULL` message appears in **no** candidate's history.

---

## 4. Test Cases — Zeko Assessment Integration

Implementation references: `src/services/zeko.service.js`, `src/jobs/zekoScheduler.js`, `src/services/screening.service.js` (~lines 1802–2229), routes `screening.routes.js:53/59/65`.

**Pipeline status lifecycle for assertions:** `pending` (assigned) → `sent` (scheduled) → `completed` (results fetched) *or* `cancelled`.

### ZEK-01 — Bearer token mint & storage
- **Steps:** With no active token (`UPDATE rpa_zeko_auth_token SET is_active=false;` on staging), trigger any bearer-authenticated flow (schedule, or wait for results cron).
- **Verify:**
  ```sql
  SELECT is_active, expires_at, token_type FROM rpa_zeko_auth_token ORDER BY id DESC LIMIT 3;
  ```
- **Expected:** New active row (`token_type='bearer'`, `expires_at` ≈ now + 1 h); old rows deactivated/purged.

### ZEK-02 — Bearer token reuse
- **Steps:** Trigger two bearer-authenticated actions within a few minutes.
- **Expected:** No second token row — existing token reused while valid for >10 min.

### ZEK-03 — OTP cookie flow (dashboard auth)
- **Preconditions:** No live cookie (`UPDATE rpa_zeko_auth_cookie SET is_active=false;`); Graph read working (OTP arrives at `ZEKO_LOGIN_EMAIL` mailbox).
- **Steps:** Trigger job sync (ZEK-04).
- **Expected:** Backend requests OTP → reads the 6-digit OTP from the mailbox via Graph (within ~60 s) → verifies → stores cookie.
- **Verify:** `SELECT is_active, expires_at FROM rpa_zeko_auth_cookie ORDER BY id DESC LIMIT 3;` → new active row, `expires_at` ≈ +30 days.

### ZEK-04 — Job/role sync (page-wise upsert)
- **Preconditions:** `ZEKO_SYNC_ENABLED=true` + credentials set (scheduler no-ops otherwise).
- **Steps:** Wait for `ZEKO_JOBS_CRON` tick (default hourly, on the hour) or tighten the cron.
- **Verify:**
  ```sql
  SELECT COUNT(*), MAX(updated_at) FROM rpa_zeko_jobs;
  SELECT status, total_fetched, created_at FROM rpa_zeko_sync_log ORDER BY created_at DESC LIMIT 3;
  ```
- **Expected:** Jobs upserted by `zeko_id` (re-runs update, never duplicate); sync log row `status='success'` with a plausible `total_fetched`; `primary_interview_id` populated for jobs with interviews.

### ZEK-05 — Assign candidate to Zeko job
- **Steps:** `POST /api/screening/analytics/assign` from the Analytics UI (or direct API) for the test candidate + a synced job.
- **Verify:** `SELECT status, candidate_id, zeko_job_id FROM rpa_zeko_candidate_pipeline ORDER BY id DESC LIMIT 3;`
- **Expected:** Pipeline row with `status='pending'`; re-assigning the same (candidate, job, stage) upserts rather than duplicating.

### ZEK-06 — Interview scheduling + invitation email
- **Preconditions:** ZEK-05 done; active bearer token; email template `Zeko Interview Scheduled Invitation` active in `rpa_email_templates`.
- **Steps:** `POST /api/screening/analytics/schedule` with `{shortlist_id, zeko_job_id, interview_start_at, interview_end_at}` — pick a start time **not** on a 30-min boundary (e.g. 10:12).
- **Expected:**
  1. Zeko schedule API called; pipeline row → `status='sent'`, `interview_start_at` **rounded up to the next 30-min boundary** (10:30) with duration preserved, `link_sent_at` set.
  2. Invitation email received in the **staging test inbox** containing link `https://interview.zeko.ai/interview/<job-slug>`.
- **Verify:** `SELECT status, interview_start_at, interview_end_at, link_sent_at FROM rpa_zeko_candidate_pipeline WHERE id=<pipeline_id>;` plus `rpa_email_log` row.

### ZEK-07 — Interview cancellation + alert email
- **Steps:** `POST /api/screening/analytics/cancel` with `{pipeline_id, cancel_reason}` on a `sent` pipeline.
- **Expected:** Pipeline → `status='cancelled'`, `cancelled_at` + `cancel_reason` stored; `Zeko Interview Cancelled Alert` email in the test inbox.
- **Negative/design check:** cancellation is **best-effort** — if the Zeko API rejects, DB update and email still proceed with only a warning logged. If testable (e.g. stale pipeline id on Zeko side), confirm this behaviour and record it.

### ZEK-08 — Hourly result fetch: selection criteria
- **Steps:** Ensure a pipeline row with `status='sent'` and `interview_end_at < NOW()` exists (complete a real Zeko assessment with the test candidate, or on a staging DB set `interview_end_at` into the past for a finished interview). Wait for `ZEKO_RESULTS_CRON` tick.
- **Expected:** Only rows meeting `status='sent' AND interview_end_at < NOW()` are queried; a pipeline whose results are empty on Zeko is **skipped and retried next hour** (stays `sent`).

### ZEK-09 — Store results + pipeline "completed"
- **Steps:** After Zeko has results for the test candidate, wait for the results cron.
- **Verify:**
  ```sql
  SELECT candidate_email, scores_overallscore, scores_technicalscore, scores_communicationscore, reportlink
  FROM rpa_zeko_interview_results ORDER BY created_at DESC LIMIT 3;
  SELECT status, completed_at FROM rpa_zeko_candidate_pipeline WHERE id=<pipeline_id>;
  ```
- **Expected:** Result row inserted with all three scores + report link; pipeline `status='completed'` with `completed_at` set. Re-runs must not flip a `cancelled` row to `completed` (update is guarded on `status='sent'`).

### ZEK-10 — Score write-back to rpa_cv
- **Verify (after ZEK-09):**
  ```sql
  SELECT "EmailID", "ZekoInterviewScore", "ZekoCodingScore", "ZekoCommunicationScore"
  FROM rpa_cv WHERE "EmailID" ILIKE '<test-email>';
  ```
- **Expected:** `ZekoInterviewScore`=overall, `ZekoCodingScore`=technical, `ZekoCommunicationScore`=communication.

### ZEK-11 — Score write-back email mismatch (negative)
- **Steps:** Create a pipeline whose shortlist email differs from every `rpa_cv.EmailID` (e.g. alias address), let results flow.
- **Expected (current design):** Result row + pipeline `completed` still happen, but **no `rpa_cv` row is updated — silently**. Record as a known-limitation observation (candidate scores never surface on the CV).

### ZEK-12 — Scheduler gating
- **Steps:** Restart backend with `ZEKO_SYNC_ENABLED=false` (or a missing credential).
- **Expected:** Log line "Zeko sync scheduler disabled…"; no cron activity; UI assign/schedule/cancel **still work** provided an active `rpa_zeko_auth_token` row exists.

---

## 5. Traceability Matrix

| # | Tracker item | Test case(s) | Status |
|---|---|---|---|
| 1 | OAuth connection + token storage/refresh | OUT-01, OUT-02, OUT-03 | Testable |
| 2 | Candidate mapping (inbound email → rpa_cv) | OUT-04, OUT-05, OUT-06 | Testable |
| 3 | Real-time inbound sync (webhook/poll) | OUT-07, OUT-08 | Testable (polling only — no webhook) |
| 4 | Threaded conversation view (by conversationId) | OUT-09, OUT-10 | Testable (grouped by email+position, **not** conversationId) |
| 5 | Threaded reply support | OUT-11 | **GAP — not implemented** |
| 6 | Email open tracking | OUT-12 | **GAP — not implemented** |
| 7 | Response detection (flag replied) | OUT-13 | Partially testable (conversation-ID limitation) |
| 8 | Bounce / undeliverable handling | OUT-14 | Partially testable (conversation-ID limitation) |
| 9 | Activity monitoring (last-contact timestamps) | OUT-15 | Testable |
| 10 | Show complete email history per candidate | CCT-01, CCT-04, CCT-05 | Testable |
| 11 | Track automated emails sent to candidates | CCT-02 | Testable |
| 12 | Track candidate email replies inside module | CCT-03 | Testable |
| 13 | Zeko auth (API key + OTP cookie) + credential store | ZEK-01, ZEK-02, ZEK-03 | Testable |
| 14 | Job/role sync (page-wise upsert) | ZEK-04 | Testable |
| 15 | Interview scheduling + auto email link | ZEK-05, ZEK-06 | Testable |
| 16 | Interview cancellation + email | ZEK-07 | Testable |
| 17 | Hourly result-fetch workflow | ZEK-08, ZEK-12 | Testable |
| 18 | Store results + set pipeline "completed" | ZEK-09 | Testable |
| 19 | Write scores to rpa_cv (overall/tech/comms) | ZEK-10, ZEK-11 | Testable |

---

## 6. Known Gaps & Recommendations

1. **Email open tracking is not implemented** (tracker: Completed). Schema (`rpa_email_tracking.opened/open_count/tracking_token`) and the UI badge exist, but there is no tracking-pixel endpoint and outbound HTML contains no pixel. → Reclassify the tracker item; implementation proposal in `docs/proposals/outlook-integration-improvements.md` (P2).
2. **Threaded reply support is not implemented** (tracker: Completed). No reply/compose endpoint; `in_reply_to` never written. → Reclassify; proposal P3.
3. **Synthetic conversation IDs weaken reply & bounce detection.** Outbound messages store fabricated `conversation_id` values, so `replied`/`bounced` flags rarely correlate with real Graph threads. Tests OUT-13/OUT-14 will most likely demonstrate this. → Proposal P1 (foundation fix).
4. **Reminder suppression not wired to replies.** `rpa_email_log.responded_at` is never set by inbound sync, so replied candidates can still receive reminders. → Proposal P4.
5. **Operational notes:** Graph token is in-memory only (restart = re-mint, by design); "real-time" sync is 5-min polling, not webhooks; Zeko cron jobs require `ZEKO_SYNC_ENABLED=true` + all three credentials; Zeko job sync depends on a live OTP cookie, whose renewal depends on the Graph mailbox receiving the OTP email.
