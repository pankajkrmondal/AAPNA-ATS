# MRF Approval: Unified Fix Plan ("New MRF Request - Approval Request")

**Plan only. No code or data has been changed.**
Prepared: 24 Sep 2026 · Updated: 25 Sep 2026 (Phase 0 executed; staging-first release policy D4) · Branch at time of writing: `pankaj-work-staging-v20`

> **Progress and next steps:** see [00-START-HERE-MRF-Approval-Fix.md](00-START-HERE-MRF-Approval-Fix.md), the checklist to follow. This file holds the technical detail.
>
> **Release policy:** all DB changes and fixes are applied and tested on **staging** first. Production gets **one release** after every phase has passed staging testing (§0.1, §9).

This plan merges and supersedes the two earlier documents in this folder:

| Source | What it contributed |
|---|---|
| [CHANGES-2026-09-24-mrf-approval-reminders.md](CHANGES-2026-09-24-mrf-approval-reminders.md) ("CHANGES") | Reminder-cron root cause, reminder whitelist, decided-state page, atomic decision, action validation. **No DB change.** |
| [MRF-Approval-Audit-Trail-Plan.md](MRF-Approval-Audit-Trail-Plan.md) ("AUDIT") | Per-approver links, proof of who / when / IP / device, "already actioned" notice to the other approver, approval trail, retention. **Needs DB change.** |

Every factual claim below was re-checked against the **production database** (read-only queries, 24 Sep 2026) and against the code on this branch. Where the two documents disagreed with production or with each other, §3 records the resolution.

---

## 0. Decisions already taken (24 Sep 2026)

| # | Decision |
|---|---|
| D1 | **Only one approval is needed.** The first valid decision (approve or decline) is final. All other approvers are informed. |
| D2 | IP and device data are retained as engineering decides, provided security is maintained and site stability is unaffected. This plan uses **12 months raw, then masked**; the decision record is kept permanently (§6.10). |
| D3 | **No Microsoft 365 sign-in for now.** Identity comes from a personal per-approver link. |
| D4 | **Staging first (25 Sep 2026).** Every DB change (DDL, backfill, settings/seed rows, data fixes) and every code fix is applied and tested on **staging** first. All phases (A, B, C) are completed on staging, then the full §8 test plan runs on staging. Only after staging sign-off is everything deployed to **production** in **one release**. See §0.1. |

### 0.1 Environment and release policy (D4)

| | Staging | Production |
|---|---|---|
| Database | `recruitmentautomationdb` | `recruitmentautomationdbProd` |
| DB server | `20.244.34.176` (**same server as production**) | `20.244.34.176` |
| App URL | `https://ats-staging.aapnainfotech.com` | `https://ats.aapnainfotech.com` |
| Outgoing email | **All redirected to the test inbox** (`EMAIL_REDIRECT_TO_TEST=true`) | Real recipients |

**Rules:**
1. **Order is always staging → test → sign-off → production.** No DDL, backfill, settings row or code change reaches production before it has run on staging. **The only exception is Phase 0 (§4):** production-only containment of live data, already executed 25 Sep.
2. **Same scripts, same order, in both environments.** Every DB change is a versioned file in `backend/prisma/ddl/` (+ README), run unchanged on staging and later on production. No hand-typed SQL in production.
3. **Scripts must be safe to re-run and must refuse the wrong database.** Use `CREATE … IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE`, guarded inserts. Each script starts with a check that aborts unless `current_database()` is the intended one; both databases share a server, so a wrong connection string is an easy mistake. Backfills select rows **by condition, never by hard-coded ids** (staging MRF ids differ from production's 5–9).
4. **Keep a DB change log** in this folder (`DB-CHANGE-LOG.md`): script name, environment, who, when (IST), result, row counts. Production runs are copied from the staging entries.
5. **Schema parity check before and after.** Before starting, compare the staging and production schemas for the tables this plan touches (`rpa_mrf`, `rpa_mrf_jd_send`, `rpa_email_log`, `rpa_settings`, `rpa_email_messages`). Fix any drift on staging first so the tests are valid for production. Repeat the check after the production release.
6. **Testing email on staging:** because every email goes to the test inbox, check "who was it meant for" in `rpa_email_log.recipient_email` / the audit events, not by inbox. For the per-approver test (§8), set the staging `mrf_approvers` roster to two addresses you control, so both personal links can be opened.
7. **Production waits for all phases.** Until the single production release, the reminder bug (Defect 2) is still live in production. **Interim guard (§4.1)** covers this gap.

---

## 1. What went wrong: consolidated, verified root cause

There are **two independent defects**, and both produce the same screen: *"Link inactive or invalid — This requisition has already been processed. Current status is: APPROVED."*

### Defect 1: one shared link, no identity, nobody told (the MRF #9 case, 24 Sep)

| Evidence (prod) | Meaning |
|---|---|
| `rpa_email_log` #15118: **one** email to `aroy@, sroy@` at 23 Sep **17:02 IST** | Both approvers hold the **same token** |
| `rpa_email_log` #15148 `mrf_approved` at 23 Sep **22:43 IST**; `xmin` of `rpa_mrf` 9 → `rpa_mrf_jd_send` 18 → log 15148 are consecutive (1009879/80/83) | MRF #9 was approved via the link at 22:43 IST, and nothing wrote to it afterwards |
| JWT payload `{"mrfId":"9","email":"cverma@…"}` | The token carries the **submitter's** email, not the approver's |
| `rpa_mrf` has no approved-by / approved-at / IP / comment columns; prod logger drops Morgan `http` lines; `track_commit_timestamp = off` | **Who** approved cannot be recovered from the system |
| `mrfOutcome` = to `recruitment@`, cc `sroy, nsatywali, cverma` | **Abhijit never receives the "Approved" email** |
| [MrfApprovalAction.jsx:54-57](../../../frontend/src/pages/MrfApprovalAction.jsx#L54-L57), [123-141](../../../frontend/src/pages/MrfApprovalAction.jsx#L123-L141) | A successful earlier decision is rendered as a red error |

Abhijit's click on 24 Sep 11:54 IST came from the **original** email: MRF #9 had not yet been reminded (`reminder_count = 0`).

### Defect 2: the reminder cron re-sends live Approve buttons **after** the decision (the earlier occurrence)

Production evidence (`rpa_email_log` + `rpa_email_messages`; times IST; the cron runs at 09:00 **server time = UTC**, i.e. 14:30 IST):

| MRF | Decided | "Reminder (n/2): New MRF Request - Approval Request" sent to **aroy@, sroy@** afterwards |
|---|---|---|
| #6 | 13 Jul 22:55 | 16 Jul 14:30 and 19 Jul 14:30 |
| #7 | 17 Aug 14:48 (47 s after the request) | 21 Aug 14:30 and 24 Aug 14:30 |
| #8 | 10 Sep 16:58 | 13 Sep 14:30 and 16 Sep 14:30 |
| **#9** | 23 Sep 22:43 | **Will be sent on 26 Sep 14:30 and 29 Sep 14:30 unless Phase 0 or Phase A is in place** |

Each reminder body is the original email, with the **same, still-valid token** and working-looking buttons. Clicking any of them after the decision gives the error above. This is almost certainly the **first** time the CEO reported the issue.

The same cron also sent reminders nobody should get (prod, all 2×):
- **`mrf_approved`** outcome emails, to `recruitment@` (MRFs 6, 7, 8);
- **`mrf_submit_hr`** HR notifications (MRFs 6, 7, 8);
- **`mrf_approval`** copies to the **hiring manager** (hshah@, stiwari@, rsomani@);
- **`duplicate_alert`** alerts (whenever a `reference_id` happened to equal an MRF id).

Cause: the cron query ([reminderScheduler.js:80-96](../../../backend/src/jobs/reminderScheduler.js#L80-L96)) has **no `email_type` filter**, gates non-`missing_jd` rows only on "an `rpa_mrf` with this id exists", and **nothing sets `responded_at` when an MRF is decided**.

### Secondary defects (both documents agree; verified in code)

- **Race:** [handleMrfApproval](../../../backend/src/controllers/mrf.controller.js#L891-L966) reads the status, then writes it. Two near-simultaneous confirms both succeed: last write wins, and two outcome emails go out.
- **Any `action` other than `approve` is saved as a rejection** ([mrf.controller.js:924](../../../backend/src/controllers/mrf.controller.js#L924)).
- **`mrf_hm` rows are joined to the wrong table.** Their `reference_id` is an `rpa_mrf_jd_send.id` (verified: log #15116 → jd_send 18), but the cron joins it to `rpa_mrf`.
- **`reminder_count` is incremented last**, so any failure after the send re-sends the same reminder on every run.

---

## 2. Target behaviour (what "fixed" means)

1. An approver is **never** sent an Approve/Decline button for an MRF that is already decided.
2. Each approver has **their own** link. Every decision records **name, email, time, IP, device, comment**, and so does every late attempt.
3. The moment one approver decides, the **other approvers are emailed** "already APPROVED/DECLINED by X at Y, no action needed", and their links close.
4. The approver who decided gets a **confirmation**. The HR outcome email **names the approver** and copies **all** approvers.
5. Opening a link after the decision shows a **neutral "Already approved by X at Y"** page. The red page is only for genuinely broken or expired links.
6. Exactly **one** decision per MRF, even under simultaneous clicks.
7. Outcome, HR-notification and alert emails are **never** "reminded".
8. The trail is tamper-evident and viewable/exportable by admins. IP/device are retained 12 months, then masked.
9. None of this tracking can break or slow down the approval page or the site.

---

## 3. Reconciliation: where the documents disagreed or were incomplete

| # | Topic | CHANGES said | AUDIT said | Verified fact / resolution |
|---|---|---|---|---|
| R1 | Status of the CHANGES code | "Code complete, unit tests pass" | — | **Not present in this repository.** On 24 Sep: no `reminderEligibility.js`; `reminderScheduler.js` and `handleMrfApproval` are unchanged; the working tree is clean; no branch, stash or worktree contains it. It was written in another checkout ("the checkout used had no `node_modules`"). → **Step A0** must locate and port it, or re-implement it from its spec. |
| R2 | Why it happened "twice" | Post-decision reminders are "the likely second occurrence" | Shared link only | **Both are real** (§1). Reminders explain MRFs 6–8. The shared link plus silence explains MRF 9. Phase A fixes Defect 2 and the page; Phase B fixes Defect 1. |
| R3 | "The CEO had **not** approved MRF #9" | Stated as fact | Unknown | **Not provable from any system data.** Treat it as unknown until the other approver confirms or the reverse-proxy / Safe Links logs are checked. |
| R4 | `mrf_approval` email type | Remindable while the MRF is pending (legacy approval type) | Should be retired | In prod these rows go to the **hiring manager / submitter** (hshah@, stiwari@, rsomani@, cverma@), not the approvers, and are written by something **outside this codebase** (likely the legacy n8n workflow). The reminder template for this type addresses *"Dear Abhijit Roy & Sanghamitra Roy"*, the wrong audience. → **Not remindable.** Close these rows at decision time like the others. |
| R5 | `reminder_max_count` | "default 3" | — | **Prod = 2** (`reminder_interval_days` = 2, schedule `0 9 * * *`). |
| R6 | CHANGES' warning: pending HM requests may suddenly get reminders | Preview on prod before deploy | — | Checked on prod: every open `mrf_hm` row already has `reminder_count` = 2 = max, or will be closed as submitted/missing. **No HM will be newly reminded today.** Re-run the preview query at deploy time anyway (§9). |
| R7 | Morgan HTTP logs | Keep off: they would log tokens from the query string | "Optionally raise to info" | **Keep off.** If ever enabled, `token` must be redacted first. The decision log line (A6) is the substitute. |
| R8 | `approverName` in the outcome email | Remove (it was the submitter's email) | Replace with the real approver | Phase A removes it. Phase B re-adds the **real** approver name. |
| R9 | Reply-based closing (`inboundEmailSync`) | "Can't close approval rows (comma list)" | — | With per-approver rows (Phase B) it **would** match, and then a reply to *any* email would close that approver's open approval rows and stop their reminders while the MRF is still pending. → **Exclude approval-request types from reply-based closing** (B9). Status and token decide instead. |
| R10 | Cron running more than once | — | — | The cron starts inside every backend process ([server.js:40](../../../backend/src/server.js#L40)). If prod ever runs more than one instance, every reminder is sent twice. → **Advisory lock** (A5). |
| R11 | Cron time | "daily 09:00" | — | 09:00 **UTC** = 14:30 IST. Optional change in Phase C. |
| R12 | Links inside CHANGES | `../../backend/...` | — | Broken (the file is three levels deep). Cosmetic; fix when the doc is next edited. |

---

## 4. Phase 0: immediate containment (before **26 Sep 14:30 IST**)

Required because production receives the fix only after the full staging cycle (D4). This is the one production change made ahead of staging: it touches only live MRF #9 data that exists solely in production. Each step needs owner approval: step 1 writes to production, and step 2 changes production settings.

1. **Stop the pending MRF #9 reminders.** Mark its open rows as responded (the same mechanism the cron itself uses):
   ```sql
   BEGIN;
   -- preview: expect 3 rows, responded_at NULL
   SELECT id, email_type, recipient_email, responded_at, reminder_count
     FROM rpa_email_log WHERE id IN (15117, 15118, 15119);
   UPDATE rpa_email_log SET responded_at = now()
    WHERE id IN (15117, 15118, 15119) AND responded_at IS NULL;   -- expect UPDATE 3
   COMMIT;
   -- (undo is documented, commented out, in DB-CHANGE-LOG.md: do not paste it into a SQL tool)
   ```
   (15117 = HR notify, 15118 = approval request to aroy/sroy, 15119 = HM copy. 15148, the outcome email, is already closed. MRFs 6–8 have used up their reminders.)
2. **Put Abhijit on the outcome email.** Add `aroy@aapnainfotech.com` to `email_recipients.mrfOutcome.cc` through the admin Flow Keys screen. This is a config change, not a deploy.
3. **Tell Abhijit and Sanghamitra:** "Only one approval is needed. If a link says *already processed*, the other approver has already decided." Ask Sanghamitra whether she approved MRF #9 on 23 Sep at 22:43 IST.
4. **Optional, to identify the MRF #9 approver:** reverse-proxy access log for `POST /api/mrf/9/approve` around **2026-09-23 17:13 UTC**; Defender Safe Links `UrlClickEvents` for `/mrf/9/approve`.

### Phase 0 execution log

| Step | Status | Detail |
|---|---|---|
| 1 | ✅ **Re-applied 25 Sep 11:03 IST** ([DB-CHANGE-LOG.md](DB-CHANGE-LOG.md) #4), after the 09:51 run was reverted by a manual statement (#3). Original run: | Guarded script, run as a dry run first. `UPDATE 3` committed on `recruitmentautomationdbProd`; rows 15117/15118/15119 now have `responded_at = 2026-09-25 04:21:20 UTC` (before: NULL, `reminder_count` 0). Verified read-only by replaying the live cron query for the 26 Sep and 29 Sep 09:00 UTC runs: **0 reminders would be sent** for MRF #9. |
| 2 | ✅ **Done 25 Sep 2026** (Pankaj) | `aroy@` added to production `mrfOutcome.cc` via **Settings → Flow Keys** (the save reloads the in-memory recipient cache, [settings.controller.js:535](../../../backend/src/controllers/settings.controller.js#L535)). Verified read-only. Logged in [DB-CHANGE-LOG.md](DB-CHANGE-LOG.md) #2. |
| 3 | ✅ **Done 25 Sep 2026** (Pankaj) | Abhijit and Sanghamitra briefed; Sanghamitra asked about 23 Sep 22:43 IST. |
| 4 | ⏳ Optional | Needs prod server / M365 admin access. |

Phase 0 is the **only** production change made before the staging cycle (D4). Step 2 is **not** mirrored on staging: staging's `mrfOutcome` / `mrfApproval` rows deliberately hold internal test addresses (`hmopuri@, saukumar@, pkmondal@`), and staging redirects all mail to the test inbox. Environment parity here means the same keys exist, not the same addresses.

### 4.1 Interim production guard (until the single production release)

Because production gets the fix only after all phases pass on staging (D4), any MRF **approved or declined in production before that release** would again receive reminder emails with live Approve buttons 2–3 days later. To prevent that:

- **When:** once a day **before 14:30 IST** (the cron runs at 09:00 UTC), and always right after any MRF decision in production.
- **Check (read-only):**
  ```sql
  SELECT el.id, el.email_type, el.reference_id AS mrf_id, el.recipient_email, el.sent_at, m.approval_status
    FROM rpa_email_log el
    JOIN rpa_mrf m ON m.id = el.reference_id
   WHERE el.email_type IN ('mrf_approval_request','mrf_approval','mrf_submit_hr','mrf_approved','mrf_declined')
     AND el.responded_at IS NULL AND el.status = 'sent'
     AND el.reminder_count < (SELECT value::int FROM rpa_settings WHERE key = 'reminder_max_count')  -- rows at the max can no longer be reminded
     AND lower(trim(m.approval_status)) NOT IN ('pending','waiting')
   ORDER BY el.id;
  ```
- **If rows are returned:** close exactly those ids, in a transaction, and check that the row count matches:
  ```sql
  BEGIN;
  UPDATE rpa_email_log SET responded_at = now() WHERE id IN (<ids from the check>) AND responded_at IS NULL;
  COMMIT;
  ```
  Record each run in `DB-CHANGE-LOG.md` as *production, interim guard*.
- Approval-request rows of MRFs that are **still pending** are not touched; their reminders are wanted.
- **Stop running the guard** once the production release is live and verified (§9.3).

---

## 5. Phase A: stop the damage (no DB change, ~1–1.5 days)

Source: CHANGES, with corrections R4, R5, R7, R10. Phase A is built first and deployed to **staging** first; Phase B builds on it without rework. Under D4, Phase A reaches production **together with B and C** in the single release (§9).

| # | Change | File(s) | Acceptance |
|---|---|---|---|
| **A0** | Locate the CHANGES implementation (other checkout) and bring it onto the feature branch. If it can't be found, re-implement from CHANGES §3. Diff it against this table before merging. | — | Code is in the branch and reviewed |
| **A1** | New pure module `reminderEligibility.js`. `REMINDABLE_EMAIL_TYPES = ['missing_jd', 'mrf_hm', 'mrf_approval_request']`. **`mrf_approval` is removed (R4).** `reminderSkipReason(row)` rules: approval request → remind only while `approval_status ∈ {pending, waiting}` (trim, case-insensitive); `mrf_hm` → joined to `rpa_mrf_jd_send`, remind only while `mrf_id IS NULL` and `mrfstatus ∈ {'', NULL, pending, pendingfromleader}`; `missing_jd` → as today. Any other type: never. | `backend/src/jobs/reminderEligibility.js` (new) | Unit tests pass (§8) |
| **A2** | Cron query: whitelist by `email_type`; join each type to the table its `reference_id` really points at (`rpa_cv` / `rpa_mrf` / `rpa_mrf_jd_send`); all type names are bound parameters. Rows that are skipped get `responded_at = now()` and an info log line. | [reminderScheduler.js](../../../backend/src/jobs/reminderScheduler.js) | Decided MRF → no reminder, row closed |
| **A3** | Increment `reminder_count` / `last_reminder_at` **immediately after** a successful send, before the message/tracking inserts. | same | A failure after the send never causes a re-send |
| **A4** | `rpa_email_messages.mrf_id` is set only for approval types (`mrf_hm` → `NULL`; it is a jd_send id). | same | No wrong or FK-violating `mrf_id` |
| **A5** | Implemented as a **per-row atomic claim** instead of `pg_try_advisory_lock`: before sending, `updateMany … where { id, reminder_count: <read value>, responded_at: null }` increments the count and sets `last_reminder_at`. A run that finds nothing to claim skips the row; if the send fails, the claim is released so the next run retries. Also an in-process "already running" guard. Why: Prisma pools connections, so a session advisory lock could be released on a different connection and never freed. | same | Two processes → each reminder sent at most once |
| **A6** | `handleMrfApproval`: (a) `action` must be `approve` or `reject`, otherwise **400**; (b) atomic `updateMany … where { id, approval_status: <value just read> }`, and `count = 0` → **409**; already decided → **409** (was 400); (c) after a win, close all `mrf_approval_request` **and `mrf_approval`** log rows for this MRF (`responded_at = now()`, inside try/catch, non-fatal; A1 is the backstop); (d) `logger.info("MRF <id> <status> via approval link at <ISO>", { mrfId, decision, ip, userAgent })`, never logging the token. IP and browser are included so evidence starts before Phase B; (e) remove the misleading `approverName`. | [mrf.controller.js](../../../backend/src/controllers/mrf.controller.js#L891-L966), [emailNotification.service.js](../../../backend/src/services/emailNotification.service.js#L1226) | Race → one winner; junk action → 400 |
| **A7** | Approval page: when the MRF is already decided, show the neutral view *"Requisition already approved / declined — no further action is needed from you"*. Red view only for missing, invalid or expired token, id mismatch, 404, or network error, and it shows the server's message (`err.response.data.message`; these calls use plain axios). On a 409 from Confirm → re-fetch → neutral view. | [MrfApprovalAction.jsx](../../../frontend/src/pages/MrfApprovalAction.jsx) | Old links and reminder links show the neutral view |
| **A8** | Seed file: add `aroy@` to `mrfOutcome.cc` (matches Phase 0 step 2, so a re-seed can't undo it). | [seed-email-recipients.js](../../../backend/prisma/seed-email-recipients.js) | Abhijit receives the outcome email |
| **A9** | Tests: CHANGES' 8 tests, plus `mrf_approval` never remindable, plus lock behaviour (§8). | `backend/src/tests/reminderEligibility.test.js` | Green |

**API contract after Phase A** (`POST /api/mrf/:id/approve`): success 200 (unchanged) · already decided **409** · lost race **409** · bad action **400** · bad/expired token 401 · id mismatch 403. The only client is `MrfApprovalAction.jsx`, updated in A7.

**What Phase A does not yet give:** the approver's identity, IP or device; the notice to the other approver. That is Phase B.

---

## 6. Phase B: proof of decision and "already actioned" notice (DB change, ~4 days)

Source: AUDIT, with corrections R8, R9 and the stability items below. It builds on A6/A7; nothing from Phase A is thrown away.

> **As built (25 Sep 2026): differences from the text below**
> - **Notifications (6.6):** sent in-process after commit with 3 attempts (3 s / 6 s back-off). Each notice is sent at most once per recipient, checked against the audit trail. **No new BullMQ queue:** in this repo the queue worker only does resume parsing and is optional (`USE_RESUME_QUEUE`), so a new queue would add a deployment dependency for about three emails per decision.
> - **"Already actioned" email** is a new email with the MRF in the subject, not a reply in the original thread.
> - **Admin report (6.11 item 2)** is an admin-only **"Approval audit" CSV button on the MRF page** (last 90 days, with IP and device) plus the per-MRF Approval Trail. There is no separate report page.
> - Extra event type **`links_reissued`**, written when HR re-sends links (who re-sent, how many old links closed).
> - Rate limit: **60 requests per 15 min per IP** on the two public routes (`MRF_APPROVAL_RATE_MAX` / `_WINDOW_MS`).
> - **Release order:** the new `rpa_mrf` columns are in the Prisma model, so **the DDL must be applied before the new code is deployed** (see §9.3 / 00-START-HERE P3).

### 6.1 Approver roster
New `rpa_settings` key `mrf_approvers`: JSON `[{"email":"aroy@aapnainfotech.com","name":"Abhijit Roy"},{"email":"sroy@aapnainfotech.com","name":"Sanghamitra Roy"}]`, editable in Settings. Fallback: Graph `displayName`, then the email address. This replaces the hard-coded names at [emailNotification.service.js:1099](../../../backend/src/services/emailNotification.service.js#L1099) and [reminderScheduler.js:181](../../../backend/src/jobs/reminderScheduler.js#L181). Validation: at least one approver, valid emails, no duplicates. An invalid roster falls back to `email_recipients.mrfApproval.to` and logs an error, so MRF submission never fails.

### 6.2 Database (`backend/prisma/ddl/2026-09-xx-mrf-approval-audit.sql` + README; additive only; **run on staging first**, §0.1)

**`rpa_mrf_approval_tokens`**: one row per approver per MRF.
`id` BIGSERIAL PK · `mrf_id` BIGINT FK · `approver_email` VARCHAR(255) NOT NULL · `approver_name` · `token_jti` UUID UNIQUE · `email_log_id` INT · `issued_at`, `expires_at` TIMESTAMPTZ · `first_opened_at`, `last_opened_at`, `open_count` · `used_at` · `revoked_at`, `revoked_reason` (`decided_by_other` | `expired` | `reissued` | `mrf_closed`). Indexes: `(mrf_id)`, `(approver_email)`.

**`rpa_mrf_approval_events`**: append-only proof.
`id` BIGSERIAL PK · `mrf_id` · `token_id` NULL FK · `event_type` VARCHAR(40) CHECK · `actor_email`, `actor_name` · `identity_source` (`personal_link` | `legacy_shared_link` | `system`) · `ip_address` INET · `user_agent` VARCHAR(512) · `client_data_masked_at` · `prior_status`, `new_status` · `comments` VARCHAR(2000) · `likely_scanner` BOOLEAN · `meta` JSONB · `created_at` TIMESTAMPTZ DEFAULT now(). Indexes: `(mrf_id, created_at)`, `(event_type, created_at)`, `(actor_email)`.
Event types: `request_sent` · `link_opened` · `approved` · `rejected` · `attempt_after_decision` · `token_invalid` · `token_expired` · `token_revoked_used` · `other_approvers_notified` · `decision_confirmation_sent` · `backfilled`.

**Tamper-evidence trigger:** `BEFORE UPDATE OR DELETE` raises an exception. The single exception is the retention sweep (§6.10), which runs with `SET LOCAL app.audit_retention = 'on'` and may only (a) change `ip_address` / `user_agent` / `client_data_masked_at` on rows older than retention, and (b) delete `link_opened` rows older than retention.

**Summary columns on `rpa_mrf`:** `decided_by_email`, `decided_by_name`, `decided_at` TIMESTAMPTZ, `decided_ip` INET, `decision_comments` VARCHAR(2000), `decision_event_id` BIGINT. `approval_status` values are unchanged, so existing readers (`screening.service.js`, `dashboard.service.js`, exports) are unaffected.

Expected volume: under 500 event rows a month. No partitioning needed.

### 6.3 Per-approver emails (at submission, [mrf.controller.js:815-834](../../../backend/src/controllers/mrf.controller.js#L815-L834))
For each approver: insert a token row → sign JWT `{ typ: 'mrf_approval', mrfId, jti }` (14-day expiry) → send a **separate** email greeting them by name, with their own buttons and the line:
> *This request was also sent to **Sanghamitra Roy**. **Only one approval is needed.** The first decision recorded applies, and everyone will be notified.*

→ one `rpa_email_log` row per approver (`email_type = 'mrf_approval_request'`, `recipient_email` = that approver) → event `request_sent`.
Identity is always resolved **from the token row by `jti`**, never from browser input.

### 6.4 Decision service (`backend/src/services/mrfApproval.service.js`, new; controller stays thin)
```
1. Verify JWT: signature, expiry, typ, mrfId === :id
     → token_invalid / token_expired event (IP, UA; throttled) → 401
   Legacy token (no jti) → identity_source = legacy_shared_link, actor "Unknown (shared link)"
2. Load token by jti; revoked → token_revoked_used event → 409 with the current decision
3. Validate: action ∈ {approve, reject} (400); comment ≤ 2000; UA ≤ 512; IP parse failure → NULL
4. ONE transaction (statement_timeout 5s):
     UPDATE rpa_mrf SET approval_status, decided_by_*, decided_at = now(), decided_ip, decision_comments
      WHERE id = $id AND lower(trim(approval_status)) IN ('pending','waiting')      ← first wins
     0 rows → INSERT attempt_after_decision (actor, IP, UA, comment) → COMMIT → 409 {status, decidedByName, decidedAt}
     1 row  → INSERT approved|rejected event → SET decision_event_id
              → UPDATE rpa_mrf_jd_send.mrfstatus
              → this token used_at; all other tokens revoked ('decided_by_other')
              → close this MRF's approval-request log rows (responded_at)   [moved here from A6(c)]
     COMMIT
5. After commit: enqueue notifications (6.6). Never roll back the decision because of email.
6. logger.info structured line (no token).
```
If the transaction fails, nothing changes and the approver sees *"Could not record your decision, please try again."* No half-saved state is possible.

### 6.5 Captured data

| Requested | Source | Stored |
|---|---|---|
| Name | token row (roster) | event `actor_name`, `rpa_mrf.decided_by_name` |
| Email / mailbox | token row: the mailbox the personal link was delivered to | event `actor_email`, `rpa_mrf.decided_by_email` |
| Time | DB `now()` (UTC), displayed in IST | event `created_at`, `rpa_mrf.decided_at` |
| IP | `req.ip` with `TRUST_PROXY=true` ([app.js:19-21](../../../backend/src/app.js#L19-L21)); shared helper `backend/src/utils/clientIp.js`, replacing the copies in [scorecard.controller.js:27](../../../backend/src/controllers/scorecard.controller.js#L27) and [candidate.controller.js:103](../../../backend/src/controllers/candidate.controller.js#L103) | event `ip_address`, `rpa_mrf.decided_ip` |
| Device | `User-Agent`, truncated to 512 | event `user_agent` |
| Comment | request body, trimmed, 2000 max | event `comments`, `rpa_mrf.decision_comments` |

Known limit (D3): a **forwarded** email lets the recipient act under the original approver's link. It is detectable (different IP/device), and the approver is alerted immediately by the confirmation email (6.6b).

### 6.6 Notifications, sent through the existing BullMQ/Redis infrastructure with retry
A new queue `mrf-approval-notify` (same pattern as [resumeQueue.js](../../../backend/src/queues/resumeQueue.js)): 3 attempts with exponential backoff; job id `mrf:<id>:<kind>:<email>` makes each email **idempotent** (it can never be sent twice). If Redis is unavailable, fall back to a direct async send and log it.

- **a) Other approvers, "already actioned":** subject `MRF #9 – Product Sales SaaS _Delhi NCR – already APPROVED by Sanghamitra Roy`. Body: who, when (IST), comment, *"Only one approval is needed, so no action is required from you. Your approval link for this request is now closed."*, plus a read-only view link. Sent as a reply in the original thread when the Graph message id is known, otherwise as a new email. Log type `mrf_already_actioned`, event `other_approvers_notified`.
- **b) Deciding approver, confirmation:** *"You approved MRF #9 on 23 Sep 2026, 10:43 PM IST."* Event `decision_confirmation_sent`.
- **c) HR outcome** ([sendMrfOutcomeEmail](../../../backend/src/services/emailNotification.service.js#L1226)): *"Approved by Sanghamitra Roy on 23 Sep 2026, 10:43 PM IST"* instead of the anonymous "Management". CC **all** approvers.
- Failures are logged as `rpa_email_log` status `failed` and are never shown to the approver as a failed decision.

### 6.7 Approval page ([MrfApprovalAction.jsx](../../../frontend/src/pages/MrfApprovalAction.jsx), extends A7)
`public-details` returns `decision: { status, decidedByName, decidedAt, isYou }`:

| State | Shows |
|---|---|
| Decided by someone else | *"Already approved by Sanghamitra Roy · 23 Sep 2026, 10:43 PM IST"* + comment + *"Only one approval is needed — no action required."* (info style) |
| Decided by you | *"You approved this on 23 Sep 2026, 10:43 PM IST"* (success style) |
| Invalid / expired / wrong MRF | *"Link inactive or invalid"* + server message (error style) |

### 6.8 Link-open tracking (best effort, never blocking)
`GET public-details` updates the token's open counters and writes a `link_opened` event (IP, UA; at most one per token per 5 minutes). Opens that look like mail scanners (Safe Links/Mimecast UA/IP, or within seconds of sending) get `likely_scanner = true` and are greyed out in the trail. The write runs in try/catch after the data is loaded; if it fails, the page still opens. Only the Confirm POST can ever change status.

### 6.9 Reminders and replies in Phase B
- The reminder cron (A1/A2) additionally skips approval-request rows whose **token is revoked, used or expired**, and closes them.
- Because each approver now has their own log row, a reminder re-sends **that approver's** email (their own token) only while the MRF is pending.
- **B9 (R9):** in [inboundEmailSync.js:150-165](../../../backend/src/jobs/inboundEmailSync.js#L150-L165), exclude `email_type IN ('mrf_approval_request', 'mrf_approval')` from reply-based `responded_at` closing. A reply is not a decision. Status and token state govern reminders.

### 6.10 Retention, security and stability (D2)

| Data | Kept | After that |
|---|---|---|
| Who / what / when / comment | **Permanently** | — |
| Raw IP + full user-agent (events, `rpa_mrf.decided_ip`) | **12 months** | IP masked (IPv4 `/24`, IPv6 `/48`); UA reduced to e.g. "Chrome on Windows"; `client_data_masked_at` set |
| `link_opened` events | 12 months | Deleted |

- **Retention sweep** `backend/src/jobs/mrfAuditRetentionSweep.js`: daily at 02:30 IST, batches of 500, 5 s statement timeout, at most 20 batches per run, advisory lock. The period is a setting, `mrf_audit_client_data_retention_days` = 365.
- **Access:** IP and device are visible to admin / super_admin only (UI, API, export). Other roles see name, action, time and comment.
- **Tokens:** `typ`-scoped, one per approver, single decision, 14-day expiry, revoked on decision. HR can **re-issue** a link from the MRF screen (old token revoked `reissued`). Tokens are never logged. `rpa_email_log.body_html` (contains tokens) stays admin-only.
- **Rate limits** on both public routes (pattern: [shareRateLimit.js](../../../backend/src/middleware/shareRateLimit.js)): e.g. 30/min per IP + token; `token_invalid` events throttled to 1/min per IP.
- **Feature flag** `MRF_APPROVAL_AUDIT_ENABLED`: turning it off reverts to the Phase A flow without a DB rollback. The new tables are additive, so no data is lost.

### 6.11 Approval trail and reporting
1. **MRF detail modal (`MRF.jsx`) → "Approval trail"** timeline, e.g. `17:02 Request sent to Abhijit Roy, Sanghamitra Roy → 18:10 Opened by Sanghamitra Roy (Chrome/Windows) → 22:43 APPROVED by Sanghamitra Roy (IP…) → 22:43 Abhijit Roy notified → 24 Sep 11:54 Abhijit Roy opened after decision (no change)`.
2. **Admin report "MRF Approval Audit"** with filters (date, MRF, approver, event) and Excel export through `backend/src/exports`. *Decided By / Decided At* added to [mrfDetail.export.js](../../../backend/src/exports/mrfDetail.export.js#L212).
3. New endpoints: `GET /api/mrf/:id/approval-events` (auth + role) and `POST /api/mrf/:id/approval-links/reissue` (HR/admin).

### 6.12 Existing data
- **Legacy shared links** (no `jti`) stay viewable. A decision made with one is recorded as `legacy_shared_link`. Prod has **0 pending MRFs** today, so in practice legacy links only ever show the decided view.
- **Backfill** every already-decided MRF that has an outcome email (in production today: MRFs 5–9): `decided_at` = `mrf_approved`/`mrf_declined` `sent_at` (MRF 9 → `2026-09-23 17:13:25 UTC`), `decided_by_name` = "Unknown (before audit trail)", comment parsed from the outcome email HTML (MRF 8 has one), event `backfilled`. Labelled as reconstructed everywhere. The script selects rows **by condition** (`decided_at IS NULL` and an outcome log row exists), never by id, so it gives the right result on staging's different data and is safe to re-run.

---

## 7. Phase C: housekeeping (independent, small)

| # | Item |
|---|---|
| C1 | Identify and retire (or align) the **external writer** of `mrf_approval` log rows, subject *"MRF Approval Required_…"* (not in this repo; likely legacy n8n). **Confirmed live 25 Sep:** client `98.70.15.174` is polling production with `SELECT * FROM "public"."rpa_mrf" WHERE "approval_status" = 'pending' LIMIT 1`, which is an n8n-style trigger still watching for pending MRFs. Find that workflow and disable it, or align it with the new flow, before the production release. |
| C2 | Optional: run the reminder cron in IST (`timezone: 'Asia/Kolkata'` in node-cron), so 09:00 means 09:00 IST (today it is 14:30 IST). Business to confirm the preferred time. |
| C3 | Product decision: should `data_collection` emails be reminded? The cron only knows the legacy `missing_jd` name. |
| C4 | Update the old query in `backend/src/scratch/verify_graph_id_capture.js` (not production code). |
| C5 | Fix the relative links in the CHANGES doc (R12). Mark both source docs "superseded by MRF-Approval-Unified-Fix-Plan.md". |
| C6 | `docs/CHANGELOG.md` entries for Phase A and Phase B. |

---

## 8. Test plan

**Unit** (`node --test`, pure modules)
- `reminderSkipReason`: approval request open only for pending/waiting (any case or spaces); closed for approved, rejected, completed, closed, or a missing MRF. `mrf_hm` open for blank, NULL, pending, pendingfromleader with `mrf_id` NULL; closed otherwise. `missing_jd` needs a candidate and a token. **`mrf_approval`, `mrf_approved`, `mrf_declined`, `mrf_submit_hr`, `mrf_already_actioned`, `welcome`, `data_collection`, `duplicate_alert`, `user_created`, `password_reset_request`, `backend_error_alert` are never remindable.**
- Action validation; token `typ` / `jti` / `mrfId` checks; IP helper (with/without `X-Forwarded-For`, garbage → NULL); IP masking; UA reduction; input caps.
- Page state mapping: decided-by-other / decided-by-you / invalid.

**Integration (DB)**
- Two approvers → two emails, two token rows, two `request_sent` events, distinct links, "Only one approval is needed" text.
- A approves → summary columns set; `approved` event has IP, UA and comment; B's token revoked; approval log rows closed; B gets "already approved by A"; A gets a confirmation; HR outcome names A and CCs both.
- B clicks afterwards → 409, `attempt_after_decision` with B's identity and IP; page shows "Already approved by A".
- **Race:** concurrent A-approve and B-reject → exactly one decision event, one attempt event, one outcome email.
- Reminder cron: decided MRF → closed, nothing sent; pending → sent, count +1; outcome, HR-notify and alert rows never selected; revoked token → closed; two concurrent runs → one run (lock).
- Reply from an approver on another thread → their pending approval rows **stay open** (B9).
- Event UPDATE/DELETE → rejected by the trigger; the sweep can only mask old client data or delete old `link_opened` rows.
- `link_opened` write failure → page still loads. Email/Graph failure → decision stays; retry happens; no duplicate email (idempotent job id).
- Rate limit → 429.
- Legacy token → view works; decision recorded as `legacy_shared_link`.
- Feature flag off → Phase A behaviour.

**Manual on staging** (emails redirect to the test inbox):
1. Submit an MRF with two approvers.
2. Open A's link and B's link.
3. Approve as A, and check B's notice, A's confirmation, the HR email, the trail and the export.
4. Open B's link and check the neutral page and the recorded attempt.
5. Set `reminder_interval_days` = 0, run the cron and check nothing is sent for the decided MRF; restore the setting afterwards.

---

## 9. Deployment and rollback (staging first, then one production release: D4)

### 9.1 Staging: build and apply everything
1. **Schema parity check** (read-only) of staging vs production for the tables this plan touches (§0.1 rule 5). Fix any drift on staging, recording it in `DB-CHANGE-LOG.md`.
2. **Staging DB backup** (`pg_dump` of `recruitmentautomationdb`).
3. **Phase A** → deploy the feature branch to staging (no DDL). Re-run the CHANGES preview query against **staging** to see which rows the new cron would close or remind.
4. **Phase B DB:** run the DDL on **staging** in order (tables → columns → indexes → trigger → backfill), each script with its `current_database()` guard. Log every run.
5. `prisma db pull` / `prisma generate` against staging (stop the dev server **and** the queue worker first: Windows file lock). Deploy Phase B code to staging.
6. **Staging settings:** `mrf_approvers` (two test mailboxes you control), `mrf_audit_client_data_retention_days`, `MRF_APPROVAL_AUDIT_ENABLED=true`. Keep staging's internal test addresses in `mrfOutcome` / `mrfApproval`; do not copy production's real addresses. Where possible use the Flow Keys / Settings screens so the in-memory cache reloads.
7. **Phase C** items that touch code (C2 if approved, C4, C6).

### 9.2 Staging: test and sign-off
1. Run the whole §8 test plan on staging: unit, integration, and the manual walkthrough with Chhaya.
2. Run the reminder cron on staging with `reminder_interval_days = 0` (restore afterwards) and check the §8 reminder cases.
3. Re-run every DDL script a second time on staging: it must be a no-op (proves re-run safety).
4. Test rollback on staging: flag off → Phase A behaviour; flag on again.
5. Collect sign-off (owner + Chhaya) against §14. **No production step starts without it.**

### 9.3 Production: single release (only after 9.2 sign-off)
1. **Pre-checks:** C1 done (external `mrf_approval` writer identified or known not to send approver links); `TRUST_PROXY=true` in `.env.production` and nginx forwards `X-Forwarded-For`; production schema parity check (the same query as 9.1.1); CHANGES preview query run on **production**, with any unexpected rows agreed with HR.
2. **Production DB backup** (`pg_dump` of `recruitmentautomationdbProd`). Quiet window, outside the 14:30 IST cron time.
3. Run **exactly the same DDL scripts, in the same order**, as on staging. Guards must report `recruitmentautomationdbProd`. Log row counts and compare them with expectations (backfill: MRFs 5–9 plus any decided since).
4. Stop the backend **and** the queue worker → `prisma generate` → deploy backend and frontend → start both.
5. Production settings: `mrf_approvers` (aroy@, sroy@ with names), retention days, feature flag on. Confirm `mrfOutcome.cc` still includes aroy@ (Phase 0 step 2).
6. Brief both approvers: separate emails; only one approval needed; the other is notified automatically.
7. **Post-checks:**
   - the next 14:30 IST cron run logs `Closing log ID … without a reminder` for decided MRFs and sends no approval reminder for them;
   - schema parity check again;
   - first real MRF end to end: two emails, one decision, three notifications, trail, IP present.
8. **Stop the interim guard (§4.1)** once the post-checks pass.

### 9.4 Rollback
- **Staging:** restore the staging backup, or roll back code; there is no risk to production.
- **Production, code or behaviour issue:** feature flag off (the Phase A flow returns; the new tables stay, nothing is lost). If Phase A itself misbehaves, redeploy the previous release. Rows the new cron closed stay closed, which is correct for them.
- **Production, DB script failure:** each script runs in a transaction, so a failure rolls it back. Stop, restore nothing, fix on staging, re-test, re-run. Restore the backup only if data was damaged.

---

## 10. Failure-mode checklist (the "foolproof" test)

| What can go wrong | Handled by |
|---|---|
| Approver clicks the original link after the other decided | A7/6.7 neutral page + `attempt_after_decision` event |
| Approver clicks a **reminder** after the decision | Cannot happen: A1/A2 status gate + A6/6.4 closes rows + 6.9 token gate |
| Both confirm in the same second | Conditional UPDATE, one winner; loser gets 409 → neutral page |
| Junk or tampered `action` | 400 |
| Tampered or expired token | 401, red page, `token_invalid` / `token_expired` event (throttled) |
| Forwarded email used by someone else | Recorded under the link owner with a different IP/device; owner alerted by confirmation email |
| Graph/email outage at decision time | Decision committed first; queue retries; idempotent job ids; failure logged |
| Redis down | Direct async send fallback, logged |
| Audit write for "link opened" fails | Page still loads (best effort) |
| Audit write for the decision fails | Whole decision rolls back; approver retries. A decision never exists without its proof |
| Two backend instances run the cron | Advisory lock |
| Reply to an unrelated email closes approval reminders | B9 exclusion |
| Approver roster misconfigured | Validation + fallback to `mrfApproval.to`; submission never fails |
| Approver leaves / roster changes mid-flight | HR re-issues links; old tokens revoked `reissued` |
| MRF closed while still pending | Tokens revoked `mrf_closed`; reminders stop (status gate) |
| Someone edits or deletes history | Trigger blocks it |
| IP data kept forever | 12-month masking sweep |
| Abuse of public endpoints | Rate limits + input caps |
| Bad release | Found on staging first (D4). In production: feature flag off, or previous release |
| DB script run against the wrong database (staging and prod share a server) | `current_database()` guard aborts the script; scripts logged per environment |
| Production still exposed while staging work is in progress | Interim guard §4.1 |
| Staging tests pass but production data differs | Schema parity checks; condition-based (not id-based) backfill; production preview queries before release |

---

## 11. Traceability (problem → fix → test)

| Problem | Fix | Verified by |
|---|---|---|
| Live Approve buttons re-sent after decision (MRFs 6–8; MRF 9 due 26 Sep) | Phase 0.1, A1, A2, A6(c), 6.4, 6.9 | Cron integration tests; post-deploy SQL |
| Outcome, HR-notify, HM-copy and alert emails re-sent as reminders | A1 whitelist (incl. R4) | Unit list of never-remindable types |
| `mrf_hm` joined to the wrong table | A1/A2 per-type joins, A4 | Unit + cron test |
| Reminder re-sent after a partial failure | A3 | Unit/integration |
| Duplicate cron runs | A5 | Lock test |
| Decided MRF shown as "invalid link" | A7, 6.7 | Page state tests; staging |
| Approve + reject race | A6(b), 6.4 | Race test |
| Junk action saved as reject | A6(a) | 400 test |
| Unknown approver (who / when / IP / device) | 6.2–6.5 | Integration; trail/export |
| Other approver not told | 6.6a | Integration; staging inbox |
| Deciding approver not told; Abhijit not on outcome | Phase 0.2, A8, 6.6b/c | Staging inbox |
| Reply closes approval reminders | B9 | Integration |
| No request trail in logs | A6(d) decision log line (Morgan stays off, R7) | `combined.log` check |
| Personal data kept indefinitely | 6.10 sweep | Sweep test |

---

## 12. Effort and order

| Step | Effort | Environment | When |
|---|---|---|---|
| 0: Containment | ~30 min | **Production** (only exception) | ✅ **Complete 25 Sep** (step 1 re-applied 11:03 IST; steps 2–3 done; step 4 optional) |
| 4.1: Interim guard | ~5 min/day | Production | Daily until the release is verified |
| A: Stop the damage | ~1–1.5 dev days (A0 included) | Staging | First |
| B: Proof and notify | ~4 dev days | Staging | After A works on staging |
| C: Housekeeping | ~0.5 day | Staging | Alongside A/B |
| Staging test + sign-off (§9.2) | ~1–1.5 days | Staging | After A, B, C |
| Production release (§9.3) | ~0.5 day incl. checks | Production | Only after sign-off |

Total before production: roughly **7–8 working days**. The interim guard covers production during that time.

---

## 13. Remaining open question

1. After the first decision, may the other approver **add a comment or objection** (sent to HR and the first approver), or only see the notice?
   **Default if unanswered:** notice only; replying to the "already actioned" email reaches HR.

---

## 14. Final acceptance checklist

**Process (D4)**
- [ ] Every DB script ran on staging first, was re-run there as a no-op, and is logged in `DB-CHANGE-LOG.md`.
- [ ] All phases (A, B, C) completed and the full §8 test plan passed **on staging**; sign-off recorded.
- [ ] Production ran exactly the same scripts in the same order; schema parity confirmed before and after.
- [ ] Interim guard (§4.1) ran daily until the production release was verified, then stopped.

**Behaviour**
- [ ] No approval reminder is ever sent for a decided MRF (checked on prod after the first cron run).
- [ ] Outcome, HR-notify, HM-copy and alert emails are never reminded.
- [ ] Each approver receives their own email and link, which states that only one approval is needed and names the other approver(s).
- [ ] Every decision stores name, email, time (shown in IST), IP, device and comment; every late attempt is also stored.
- [ ] Exactly one decision per MRF under concurrent clicks.
- [ ] Other approvers get "already APPROVED/DECLINED by X at Y" within a minute; their links close.
- [ ] The deciding approver gets a confirmation; the HR outcome names the approver and CCs all approvers (incl. Abhijit).
- [ ] A late click shows the neutral "Already approved by X at Y" page; the red page appears only for broken or expired links.
- [ ] Audit history cannot be edited or deleted; IP/device are masked after 12 months.
- [ ] Tracking or email failures never block the page or undo a decision.
- [ ] Public endpoints are rate-limited; the cron cannot run twice at once.
- [ ] MRF modal shows the approval trail (IP/device admin-only); the admin audit report exports.
- [ ] MRFs 5–9 backfilled and labelled "before audit trail".
- [ ] Both source documents are marked superseded by this plan.
