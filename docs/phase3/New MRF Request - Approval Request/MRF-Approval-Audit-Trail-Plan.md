# MRF Approval — Proof of Decision & "Already Actioned" Notification

> **⚠️ Superseded (24 Sep 2026)** by [MRF-Approval-Unified-Fix-Plan.md](MRF-Approval-Unified-Fix-Plan.md).
> This document is kept for reference and is now **Phase B** of that plan. Read the plan's §3 first. Changes made there:
> - The reminder cron re-sending live Approve buttons after a decision (MRFs 6–8) is a second root cause. It is fixed in Phase A.
> - Replies must not close approval reminders (B9); the reminder cron gets an advisory lock (A5).
> - Notifications go through a BullMQ queue with retry and idempotent job ids.
> - Morgan HTTP logging stays **off**; it would log approval tokens (R7).

**Plan only — no code has been changed.**
Prepared: 24 Sep 2026 · Updated: 24 Sep 2026 (business decisions added) · Branch at time of writing: `pankaj-work-staging-v20`

---

## 0. Decisions taken (24 Sep 2026)

| # | Question | Decision | Effect on this plan |
|---|---|---|---|
| D1 | One approval, or must both Abhijit and Sanghamitra approve? | **Only one approval is needed.** | First valid decision (approve or decline) is final; every other approver is informed and their link closes. |
| D2 | How long to keep IP and device data? | **Left to engineering — must be secure and must not affect site stability.** | 12-month raw retention, then masked; decision record kept permanently. See §5. |
| D3 | Microsoft 365 sign-in on the approval page? | **Not now.** | Out of scope. Identity = personal per-approver link (§3). The design does not block adding it later. |

---

## 1. Why this is needed

On 24 Sep 2026 Abhijit Roy opened the approval link for **MRF #9 (Product Sales SaaS _Delhi NCR)** and got
*"Link inactive or invalid — This requisition has already been processed. Current status is: APPROVED."*
This is the second time the leadership team has reported it.

Production DB investigation (read-only) showed:

| Fact | Evidence |
|---|---|
| Approval request sent 23 Sep **17:02 IST** as **one** email to `aroy@` + `sroy@` with **one shared link** | `rpa_email_log` #15118 |
| MRF #9 was approved via that link on 23 Sep **22:43 IST** | `rpa_email_log` #15148 + consecutive `xmin` on `rpa_mrf` 9 → `rpa_mrf_jd_send` 18 → log 15148 |
| Abhijit's click next morning found it already approved and the page presented that as an **error** | [MrfApprovalAction.jsx:54-57](../../../frontend/src/pages/MrfApprovalAction.jsx#L54-L57), [123-141](../../../frontend/src/pages/MrfApprovalAction.jsx#L123-L141) |
| **Nobody can say who approved** | see gaps below |

### Gaps that made the approver unknowable

1. **Shared link.** Both approvers receive the same URL/token; first click wins silently.
2. **Wrong identity in the token.** The JWT carries `{ mrfId, email: <submitter> }` — the HR submitter, not the approver ([mrf.controller.js:816-820](../../../backend/src/controllers/mrf.controller.js#L816-L820)).
3. **Nothing stored.** `rpa_mrf` has no `approved_by` / `approved_at` / IP / comment columns. Comments only survive inside the outcome email HTML.
4. **No request log in production.** Morgan logs at `http` level, the prod logger keeps `info`+ ([logger.js:95](../../../backend/src/config/logger.js#L95)) → no IP / user-agent for the POST anywhere.
5. **The other approver is never told.** The outcome email goes to `recruitment@` with CC `sroy, nsatywali, cverma` — **Abhijit is not on it**, and there is no "already done by X" message to anyone.
6. **The page calls a completed decision an error** ("Link inactive or invalid", "Requisition Process Error") and cannot say who/when.

---

## 2. Goals

| # | Goal |
|---|---|
| G1 | For every approve / decline, record **name, email (whose mailbox the link was delivered to), date-time, IP address, browser/device, comment**. |
| G2 | When an MRF approval goes to **more than one** approver, the moment one of them decides, **every other approver is emailed**: *"Already APPROVED by Sanghamitra Roy on 23 Sep 2026, 10:43 PM IST — no action needed."* |
| G3 | A late click shows a friendly **"Already actioned by X at Y"** page, not an error — and that late attempt is **also recorded** (proof Abhijit tried at 11:54). |
| G4 | HR/Admin can see and export the full **approval trail** per MRF and across all MRFs. |
| G5 | The trail is **tamper-evident** (append-only) so it can be used as proof. |
| G6 | Two approvers clicking at the same second can never both "win" — exactly **one** decision per MRF (D1). |
| G7 | Audit tracking can **never break or slow down** the approval page or the rest of the site (D2). |

**Non-goals (this phase):** Microsoft 365 sign-in (D3), multi-approver / all-must-approve rules (D1), multi-level approval chains, the Hold option (tracked separately as B-01 in [02-BUILD-BACKLOG.md](../../UAT-phase3/02-BUILD-BACKLOG.md) — this design is built to accommodate it).

---

## 3. How "who clicked" is proven

A link click cannot, by itself, reveal which Outlook mailbox it came from, so identity is **built into the link**:

- Each approver gets **their own email with their own personal token**, tied in the DB to their email address and name.
- Whoever uses Abhijit's link is recorded as *Abhijit Roy (aroy@aapnainfotech.com)*, together with the IP address and device used.
- **Known limit:** if an approver forwards their own email, the person it was forwarded to acts under that approver's link. This is still detectable (different IP / device on the trail) and the approver remains accountable for their link. The confirmation email (§4.6b) tells the approver immediately that a decision was made with their link, so misuse surfaces within minutes.

**Future option (not in scope, D3):** require Microsoft 365 sign-in on the approval page and match the signed-in account to the link's approver. Nothing in this design needs to be undone to add it later (`identity_source` column is already there to record it).

---

## 4. Design

### 4.1 Per-approver emails and tokens

At MRF submission (`submitMrf`, [mrf.controller.js:815-834](../../../backend/src/controllers/mrf.controller.js#L815-L834)):

1. Resolve the approver list (see 4.8 for names), e.g. `[{email:'aroy@…', name:'Abhijit Roy'}, {email:'sroy@…', name:'Sanghamitra Roy'}]`.
2. For **each** approver:
   - Insert a row in `rpa_mrf_approval_tokens` (random `token_jti` UUID, `approver_email`, `approver_name`, `expires_at`).
   - Sign a JWT: `{ typ: 'mrf_approval', mrfId, jti }` (the `typ` claim stops any other JWT signed with the same secret — e.g. a login token — from being accepted here).
   - Send a **separate** email: greeting *"Dear Abhijit Roy,"*, their personal Approve / Decline buttons, and a transparency line (D1):
     > *This request was also sent to **Sanghamitra Roy**. **Only one approval is needed** — the first decision recorded will apply, and everyone will be notified.*
   - Log each email in `rpa_email_log` (one row per approver, `recipient_email` = that approver) and write an event `request_sent`.

The **approver identity comes from the DB row found by `jti`**, never from anything the browser sends.

If only one approver is configured, the same flow runs with one email and no "also sent to" line.

### 4.2 Data model (new DDL: `backend/prisma/ddl/2026-09-xx-mrf-approval-audit.sql` + README, same convention as existing DDL files)

**a) `rpa_mrf_approval_tokens`** — one row per approver per MRF

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `mrf_id` | BIGINT NOT NULL → `rpa_mrf.id` | |
| `approver_email` | VARCHAR(255) NOT NULL | mailbox the link was delivered to |
| `approver_name` | VARCHAR(255) | |
| `token_jti` | UUID UNIQUE NOT NULL | embedded in the JWT |
| `email_log_id` | INT | the `rpa_email_log` row of this approver's email |
| `issued_at` / `expires_at` | TIMESTAMPTZ | |
| `first_opened_at`, `last_opened_at`, `open_count` | TIMESTAMPTZ / INT | link-open tracking (4.5) |
| `used_at` | TIMESTAMPTZ | set when this token made the decision |
| `revoked_at`, `revoked_reason` | TIMESTAMPTZ / VARCHAR(50) | `decided_by_other`, `expired`, `reissued`, `mrf_closed` |

Indexes: `(mrf_id)`, `(approver_email)`.

**b) `rpa_mrf_approval_events`** — append-only audit trail (the "proof")

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `mrf_id` | BIGINT NOT NULL | |
| `token_id` | BIGINT NULL → tokens | NULL for system events / invalid tokens |
| `event_type` | VARCHAR(40) NOT NULL, CHECK | see list below |
| `actor_email`, `actor_name` | VARCHAR(255) | from the token row |
| `identity_source` | VARCHAR(20) | `personal_link`, `legacy_shared_link`, `system` (room left for a future `microsoft_sso`) |
| `ip_address` | INET | real client IP (4.4); masked after retention (§5) |
| `user_agent` | VARCHAR(512) | browser / device, truncated to 512 chars; reduced after retention (§5) |
| `client_data_masked_at` | TIMESTAMPTZ | set by the retention sweep |
| `prior_status`, `new_status` | VARCHAR(20) | |
| `comments` | VARCHAR(2000) | approver's comment, stored verbatim (length-capped) |
| `likely_scanner` | BOOLEAN DEFAULT false | 4.5 |
| `meta` | JSONB | e.g. `{ decidedByEventId, notifiedEmails }` |
| `created_at` | TIMESTAMPTZ DEFAULT now() | |

Indexes: `(mrf_id, created_at)`, `(event_type, created_at)`, `(actor_email)`.

`event_type` values:
`request_sent` · `link_opened` · `approved` · `rejected` · `attempt_after_decision` · `token_invalid` · `token_expired` · `token_revoked_used` · `other_approvers_notified` · `decision_confirmation_sent` · `backfilled`

**Tamper-evidence:** a trigger `BEFORE UPDATE OR DELETE ON rpa_mrf_approval_events` raises an exception, so the app (and anyone using the app DB user) cannot edit or remove history. The **only** exception is the retention sweep (§5): it runs with `SET LOCAL app.audit_retention = 'on'` inside its own transaction, and even then the trigger only allows `ip_address`, `user_agent` and `client_data_masked_at` to change on rows older than the retention period, and only allows deleting `link_opened` rows older than the retention period. Every other column stays immutable.

**c) Summary columns on `rpa_mrf`** (fast to read in lists/exports; the events table stays the source of truth)

`decided_by_email`, `decided_by_name`, `decided_at TIMESTAMPTZ`, `decided_ip INET`, `decision_comments VARCHAR(2000)`, `decision_event_id BIGINT`.

`approval_status` keeps its current values (`pending` / `approved` / `rejected`, plus legacy `completed` / `waiting`) — no change to existing consumers (`screening.service.js`, `dashboard.service.js`, exports).

**Expected volume:** production has 9 MRFs in ~6 months. Even at 20 MRFs/month × 2 approvers × ~10 events ≈ 400 rows/month — the tables stay tiny, so no partitioning or archiving is needed.

### 4.3 Decision flow — `POST /api/mrf/:id/approve` (rewrite of `handleMrfApproval`, [mrf.controller.js:891-966](../../../backend/src/controllers/mrf.controller.js#L891-L966))

Move the logic into a new `backend/src/services/mrfApproval.service.js`; controller stays thin.

```
1. Verify JWT (signature, expiry, typ === 'mrf_approval', mrfId === :id)
     fail → event token_invalid / token_expired (with IP, UA) → 401
2. Load token row by jti
     revoked → event token_revoked_used → 409 with current decision
3. ONE short DB transaction (statement_timeout 5s):
     UPDATE rpa_mrf
        SET approval_status = $new, decided_by_email, decided_by_name,
            decided_at = now(), decided_ip, decision_comments
      WHERE id = $id AND lower(approval_status) IN ('pending','waiting')
      RETURNING id                                   ← atomic "first wins" (D1, G6)
     rows = 0 → someone already decided:
        INSERT event attempt_after_decision (actor, IP, UA, comment)
        COMMIT → return 409 { status, decidedByName, decidedAt }
     rows = 1:
        INSERT event approved|rejected (actor, IP, UA, comments, prior/new status)
        UPDATE rpa_mrf SET decision_event_id
        UPDATE rpa_mrf_jd_send.mrfstatus (as today)
        UPDATE this token used_at = now()
        UPDATE all other tokens of this MRF revoked_at = now(), reason 'decided_by_other'
     COMMIT
4. After commit (async, failures logged, never roll back the decision):
     a) outcome email to HR (existing sendMrfOutcomeEmail, improved — 4.6)
     b) "already actioned" email to every OTHER approver (4.6)  → event other_approvers_notified
     c) confirmation to the deciding approver                   → event decision_confirmation_sent
5. logger.info(...) structured line (4.9)
```

Today's code does a read-then-write (`findUnique` then `update`), so two near-simultaneous clicks can both pass the status check. The conditional `UPDATE … WHERE status IN (pending, waiting)` closes that.

The decision event is written **inside** the same transaction as the status change: a decision is never saved without its proof. If that transaction fails, the approver sees *"Could not record your decision, please try again"* and nothing changes — no half-saved state.

### 4.4 Capturing the data points requested

| Requested | Source | Stored in |
|---|---|---|
| **Name** | token row `approver_name` (from approver roster, 4.8) | events.`actor_name`, `rpa_mrf.decided_by_name` |
| **Email / mailbox** | token row `approver_email` — the mailbox the personal link was delivered to | events.`actor_email`, `rpa_mrf.decided_by_email` |
| **Time** | DB `now()` (TIMESTAMPTZ, UTC); displayed in IST | events.`created_at`, `rpa_mrf.decided_at` |
| **IP address** | `req.ip` — correct only when `TRUST_PROXY=true` ([app.js:19-21](../../../backend/src/app.js#L19-L21)). **Verify it is `true` in `.env.production`** and that nginx forwards `X-Forwarded-For`. Extract the duplicated `clientIp` helper ([scorecard.controller.js:27](../../../backend/src/controllers/scorecard.controller.js#L27), [candidate.controller.js:103](../../../backend/src/controllers/candidate.controller.js#L103)) into `backend/src/utils/clientIp.js`; an unparseable value is stored as NULL rather than failing the request. | events.`ip_address`, `rpa_mrf.decided_ip` |
| **Device / browser** | `User-Agent` header, truncated to 512 chars | events.`user_agent` |
| **Comment** | request body `comments` (currently only emailed), trimmed, max 2000 chars | events.`comments`, `rpa_mrf.decision_comments` |

### 4.5 Link-open tracking (who looked, even without deciding)

`GET /api/mrf/public-details/:id` ([mrf.controller.js:849-884](../../../backend/src/controllers/mrf.controller.js#L849-L884)) additionally:

- updates the token's `first_opened_at` / `last_opened_at` / `open_count`,
- writes a `link_opened` event with IP + UA (throttled: max one event per token per 5 minutes),
- flags `likely_scanner = true` when the UA/IP looks like a mail security scanner (Microsoft Defender Safe Links, Mimecast, etc.) or the open happens within seconds of sending. Scanner opens are shown greyed-out in the trail and never counted as a human view.

This tracking is **best-effort and non-blocking** (G7): it runs in a `try/catch` after the details are loaded; if the write fails it is logged and the page still opens normally.

Opening the page never changes status — only the **Confirm** button (a POST) can decide. That is already true today and must stay true.

### 4.6 Notifications

**a) To every other approver — "Already actioned" (G2)**

- Subject: `MRF #9 – Product Sales SaaS _Delhi NCR – already APPROVED by Sanghamitra Roy`
- Body: decision, **by whom, date-time in IST**, their comment (if any), *"Only one approval is needed, so no action is required from you. Your approval link for this request is now closed."*, and a *"View requisition"* link (read-only page).
- Preferably sent as a **reply in the same Outlook thread** as their original request (Graph `createReply` on the stored message id) so it lands right under the email they would click from; fall back to a new email if the message id is not available.
- Logged in `rpa_email_log` as `mrf_already_actioned` + event `other_approvers_notified`.

**b) Confirmation to the approver who decided** — *"You approved MRF #9 at 22:43 IST on 23 Sep 2026."* (event `decision_confirmation_sent`). Abhijit got nothing on 23 Sep; this closes that gap and also alerts an approver immediately if someone else used their forwarded link.

**c) Outcome email to HR** (`sendMrfOutcomeEmail`, [emailNotification.service.js:1226](../../../backend/src/services/emailNotification.service.js#L1226))

- Replace the anonymous "Management has approved" with **"Approved by Sanghamitra Roy on 23 Sep 2026, 10:43 PM IST"**.
- Fix `approverName: decoded.email` (currently the submitter's email) — pass the real approver.
- CC **all** approvers, not only `sroy` (update `rpa_settings` key `email_recipients.mrfOutcome.cc`, or add approvers dynamically from the token table).

All three are sent after the decision is committed; a mail failure is logged (`rpa_email_log` status `failed`) and never shown to the approver as a failed approval.

### 4.7 Approval page UX ([MrfApprovalAction.jsx](../../../frontend/src/pages/MrfApprovalAction.jsx))

`public-details` returns `decision: { status, decidedByName, decidedAt, isYou }` when the MRF is no longer pending. The page then shows three **distinct** states instead of one error:

| State | Title | Style |
|---|---|---|
| Already decided by someone else | *"Already approved by Sanghamitra Roy"* · *23 Sep 2026, 10:43 PM IST* · comment · *"Only one approval is needed — no action required."* | Info (blue/green), not error |
| Already decided by you | *"You approved this on 23 Sep 2026, 10:43 PM IST"* | Success |
| Token invalid / expired / wrong MRF | *"Link inactive or invalid"* (current wording) | Error |

Race case: if the Confirm POST returns 409, show the "Already approved by …" state rather than a generic failure.

### 4.8 Approver roster (names)

`rpa_settings.email_recipients.mrfApproval.to` holds emails only. Add a setting `mrf_approvers` = JSON `[{"email":"aroy@aapnainfotech.com","name":"Abhijit Roy"}, {"email":"sroy@aapnainfotech.com","name":"Sanghamitra Roy"}]`, editable from the existing Settings UI. Fallback: look up `displayName` via Microsoft Graph `/users/{email}`; last resort: the email address. This also removes the hard-coded greeting `Dear Abhijit Roy & Sanghamitra Roy,` ([emailNotification.service.js:1099](../../../backend/src/services/emailNotification.service.js#L1099)) and the hard-coded names in [reminderScheduler.js:181](../../../backend/src/jobs/reminderScheduler.js#L181).

### 4.9 Server-side logging

- Add an explicit `logger.info` on every decision / blocked attempt (JSON: `mrfId, event, actorEmail, ip, ua`). Info level survives the prod log filter, so the decision is visible in `combined.log` even without the DB. Never log the token itself.
- Separately decide whether to raise Morgan to `info` in production ([app.js:61](../../../backend/src/app.js#L61) / [logger.js:95](../../../backend/src/config/logger.js#L95)) — useful for all incidents, but increases log volume; not required for this feature. The existing 10 MB × 5 file rotation caps disk use either way.

### 4.10 Tracking screens (G4)

1. **MRF detail modal (`MRF.jsx`) → new "Approval trail" section:** a timeline:
   `17:02 Request sent to Abhijit Roy, Sanghamitra Roy` → `18:10 Opened by Sanghamitra Roy (Chrome/Windows, 49.x.x.x)` → `22:43 APPROVED by Sanghamitra Roy — IP …, comment …` → `22:43 Abhijit Roy notified` → `24 Sep 11:54 Abhijit Roy opened link after decision (blocked)`.
   IP and device are shown only to admin / super_admin; other roles see name, action, time and comment.
2. **Admin report "MRF Approval Audit"** (admin / super_admin only): filter by date, MRF, approver, event type; Excel export through the existing `backend/src/exports` framework (paginated, respects the existing export rate limit). Also add *Decided By / Decided At* to the existing MRF detail export ([mrfDetail.export.js:212](../../../backend/src/exports/mrfDetail.export.js#L212)).
3. New endpoint `GET /api/mrf/:id/approval-events` (authenticated, role-checked).

### 4.11 Reminders

[reminderScheduler.js](../../../backend/src/jobs/reminderScheduler.js#L174) (the `mrf_approval` branch, lines 174+) must:
- skip any MRF whose `approval_status` is no longer pending (and mark the log row responded),
- send per-approver reminders carrying that approver's own link.

Note: the `mrf_approval` log rows (subject *"MRF Approval Required_…"*) are **not written by this codebase** — likely the legacy n8n workflow still attached to the prod DB (a third client, `98.70.15.174`, was connected during the investigation). Identify and retire/align that writer before go-live so it cannot send old-style shared links.

### 4.12 Existing data and old links

- **Old shared links** (JWT without `jti`): still accepted for *viewing*; any decision made with one is recorded with `identity_source = 'legacy_shared_link'`, actor "Unknown (shared link)", plus IP/UA. No MRF is pending in production today, so in practice these links will only ever show the "Already decided" page. Old tokens expire 30 days after issue.
- **Backfill** for MRFs 5–9: set `decided_at` from the `mrf_approved` email-log `sent_at` (e.g. MRF 9 → `2026-09-23 17:13:25 UTC`), `decided_by_name = 'Unknown (before audit trail)'`, comments parsed from the outcome email HTML (MRF 8 has one), event type `backfilled`. The report must clearly label these as reconstructed.

---

## 5. Security, data retention & site stability (D2)

### 5.1 Retention policy

| Data | Kept | After retention |
|---|---|---|
| Decision record — who (name, email), what (approve/decline), when, comment | **Permanently** (business record; tiny volume) | — |
| Raw IP address + full user-agent on decision / attempt events | **12 months** | IP **masked** (IPv4 → `/24`, e.g. `49.36.12.0`; IPv6 → `/48`), user-agent reduced to *"Chrome on Windows"*; `client_data_masked_at` set. Proof of *who* and *when* stays intact. |
| `link_opened` events | **12 months** | Deleted (they are supporting detail, not the decision) |
| `rpa_mrf.decided_ip` | 12 months | Masked the same way |
| Token rows | Permanently (no personal data beyond approver email) | — |

Why 12 months: long enough to cover any dispute, audit or annual review of a hiring decision; short enough to limit personal data held. Change it with one setting (`mrf_audit_client_data_retention_days`, default `365`) — no code change.

**Retention sweep job** (same pattern as the existing sweep jobs in `backend/src/jobs/`):
- Runs once a day at **02:30 IST** (off-peak).
- Works in batches of 500 rows with a 5-second statement timeout; stops after 20 batches per run and continues the next night.
- Skips if the previous run is still going (lock), so it can never pile up.
- Logs how many rows it masked/deleted. At the expected volume it touches only a handful of rows a day.

### 5.2 Access & token security

- IP address and device are personal data → visible only to **admin / super_admin** (trail UI, report, API).
- Tokens: signed with `typ: 'mrf_approval'`, one per approver, **single decision** — used or revoked the moment any approver decides.
- Link expiry: **14 days** for new links (today 30). The reminder email offers *"Link expired? Reply to this email or contact HR and we will resend it."*; HR can re-issue a fresh link from the MRF screen (old token revoked with reason `reissued`).
- Never log full tokens. They are still present inside email-log HTML — keep `rpa_email_log.body_html` admin-only.
- Validate and cap every value coming from the browser (`action` must be `approve` / `reject`; comment ≤ 2000 chars; UA ≤ 512 chars) before it reaches the DB.

### 5.3 Protecting the site (G7)

| Risk | Protection |
|---|---|
| Abuse / scripted hits on the public approval endpoints filling the audit table | Rate limit both public routes (existing pattern in [shareRateLimit.js](../../../backend/src/middleware/shareRateLimit.js)): e.g. 30 requests / minute per IP + token; invalid-token events throttled to one per IP per minute. |
| Audit write failure blocks the page | `link_opened` and other non-decision events are best-effort (`try/catch`, logged, page continues). Only the decision event is transactional (by design — a decision must have its proof). |
| Email/Graph slowness delays the approver | All notifications run **after** commit, asynchronously; response returns immediately. |
| Long-running DB work | Decision transaction touches ~5 rows with a 5 s statement timeout; retention sweep is batched and off-peak. |
| Table growth | ~400 rows/month worst case, indexed on the columns the screens filter by; 12-month clean-up of `link_opened`. |
| Bad deploy | Feature flag `MRF_APPROVAL_AUDIT_ENABLED` (default `true` after go-live). Setting it to `false` falls back to today's single-email flow without a redeploy of the DB; new tables are additive, so rollback never loses data. |

---

## 6. Files that will change (implementation phase)

| Area | File | Change |
|---|---|---|
| DB | `backend/prisma/ddl/2026-09-xx-mrf-approval-audit.sql` + `.README.md` | new tables, columns, indexes, append-only trigger (with retention exception), backfill |
| DB | [schema.prisma](../../../backend/prisma/schema.prisma) | models for new tables/columns |
| Service | `backend/src/services/mrfApproval.service.js` (new) | token issue, decide (transaction), notify, trail query |
| Controller | [mrf.controller.js](../../../backend/src/controllers/mrf.controller.js) | `submitMrf` 815-834, `getPublicMrfDetails` 849-884, `handleMrfApproval` 891-966, new `getApprovalEvents`, re-issue link |
| Routes | [mrf.routes.js](../../../backend/src/routes/mrf.routes.js) | rate limit on public routes; `GET /:id/approval-events`; `POST /:id/approval-links/reissue` |
| Email | [emailNotification.service.js](../../../backend/src/services/emailNotification.service.js) | per-approver `sendMrfApprovalEmail` (1068), `sendMrfOutcomeEmail` (1226) with real approver, new `sendMrfAlreadyActionedEmail`, `sendMrfDecisionConfirmationEmail` |
| Config | [emailRecipients.js](../../../backend/src/config/emailRecipients.js), `rpa_settings` | `mrf_approvers` roster, outcome CC, retention days, feature flag |
| Util | `backend/src/utils/clientIp.js` (new) | shared IP helper |
| Jobs | [reminderScheduler.js](../../../backend/src/jobs/reminderScheduler.js) | status check, per-approver reminders |
| Jobs | `backend/src/jobs/mrfAuditRetentionSweep.js` (new) | daily masking / clean-up (§5.1) |
| Logging | [logger.js](../../../backend/src/config/logger.js) / [app.js](../../../backend/src/app.js) | decision log line (Morgan level optional) |
| Export | [mrfDetail.export.js](../../../backend/src/exports/mrfDetail.export.js) + new audit export | decided-by columns, audit report |
| Frontend | [MrfApprovalAction.jsx](../../../frontend/src/pages/MrfApprovalAction.jsx) | three states, 409 handling |
| Frontend | [mrfService.js](../../../frontend/src/services/mrfService.js) | approval-events + re-issue calls |
| Frontend | MRF detail modal (`MRF.jsx`) + new admin audit page | approval trail timeline, report, re-issue button |
| Tests | `backend/src/tests/` | see §7 |

---

## 7. Test plan

**Unit**
- Token: issue per approver; `typ`/`mrfId`/`jti` validation; revoked and expired tokens rejected with the right event.
- Page state mapping: decided-by-other / decided-by-you / invalid.
- IP helper with and without `X-Forwarded-For`; garbage value → NULL.
- IP masking (IPv4 `/24`, IPv6 `/48`) and UA reduction.
- Input caps (comment 2000, UA 512, action whitelist).

**Integration (DB)**
- Two approvers → two emails, two token rows, two `request_sent` events, different links, each email says "Only one approval is needed".
- Approver A approves → `rpa_mrf` summary columns filled, `approved` event with IP/UA/comment, B's token revoked, B receives "already approved by A", A receives confirmation, HR outcome names A and CCs both.
- B clicks afterwards → 409, `attempt_after_decision` event with B's identity + IP; page shows "Already approved by A".
- **Race:** fire A's and B's POST concurrently → exactly one `approved`/`rejected` event, one `attempt_after_decision`.
- UPDATE / DELETE on `rpa_mrf_approval_events` fails (trigger); the retention sweep can mask IP/UA on old rows but cannot change any other column or delete a decision event.
- `link_opened` write failure (simulated) → page still returns details.
- Email send failure (simulated) → decision still committed, failure logged.
- Rate limit → 429 after threshold, no audit flood.
- Legacy JWT (no `jti`) → view works, decision recorded as `legacy_shared_link`.
- Reminder job skips decided MRFs.

**Manual on staging** (emails redirect to the test inbox): submit an MRF with two approver addresses, approve from one, confirm the other gets the notice and that the trail/export show name, email, time (IST), IP, device.

---

## 8. Rollout

1. Implement + tests on the feature branch; deploy to **staging**; walk through §7 manual steps with Chhaya.
2. Identify/retire the external writer of `mrf_approval` email-log rows (legacy n8n) — §4.11.
3. Confirm `TRUST_PROXY=true` in production and nginx `X-Forwarded-For`.
4. Production: run the DDL (tables → columns → indexes → trigger → backfill) in a maintenance window; take a DB backup first.
5. Deploy backend + frontend; stop the dev server **and** the queue worker before `prisma generate` (Windows file lock).
6. Seed `mrf_approvers`, retention days and the feature flag; fix `email_recipients.mrfOutcome.cc` in `rpa_settings`.
7. Brief Abhijit & Sanghamitra: each now gets their own email; **only one approval is needed**; the first decision applies and the other is notified automatically.
8. Watch the first real MRF end to end (trail, all three emails, IP captured correctly).

Rough effort: **≈ 4 developer days** (DB + trigger 0.5, backend 1.5, emails 0.5, frontend + trail/report 1, retention sweep + rate limit 0.25, tests 0.5–0.75).

---

## 9. Remaining open question

1. After the first decision, should the other approver be able to **add a comment or raise an objection** (sent to HR and the first approver), or only see the notice?
   **Default if not answered:** notice only — they can reply to the "already actioned" email, which reaches HR.

---

## 10. Acceptance checklist

- [ ] Each approver receives a separate email with a personal link, naming the other approver(s) and stating that only one approval is needed.
- [ ] Every approve/decline stores name, email, IST-displayable timestamp, IP, device, comment.
- [ ] Only one decision can ever be recorded per MRF, including when two approvers click at the same moment.
- [ ] Other approvers are emailed "already APPROVED/DECLINED by X at Y" within a minute of the decision.
- [ ] The deciding approver gets a confirmation; the HR outcome email names the approver and CCs all approvers.
- [ ] A late click shows "Already approved by X at Y" (not an error) and is itself recorded.
- [ ] Audit events cannot be edited or deleted; after 12 months IP/device are masked and the decision record remains.
- [ ] Audit tracking failures never block the approval page; email failures never undo a decision.
- [ ] Public approval endpoints are rate-limited.
- [ ] MRF modal shows the approval trail (IP/device admin-only); admins can export the audit report.
- [ ] Reminders stop once decided.
- [ ] MRFs 5–9 backfilled and labelled "before audit trail".
