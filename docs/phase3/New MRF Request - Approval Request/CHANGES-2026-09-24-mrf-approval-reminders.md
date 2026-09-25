# MRF approval: stale reminders, "invalid link" page, and a decision race

> **⚠️ Superseded (24 Sep 2026)** by [MRF-Approval-Unified-Fix-Plan.md](MRF-Approval-Unified-Fix-Plan.md).
> This document is kept for reference and is now **Phase A** of that plan. Read the plan's §3 first. Corrections verified against production:
> - The code described here is **not in the repository** (no `reminderEligibility.js`; `reminderScheduler.js` and `handleMrfApproval` are unchanged). See plan step A0.
> - `mrf_approval` rows go to the hiring manager, not the approvers → **not remindable** (R4).
> - Production `reminder_max_count` is **2**, not 3 (R5).
> - "The CEO had not approved MRF #9" cannot be proven from system data (R3).
> - Relative links fixed 25 Sep 2026 (were `../../`, now `../../../`; R12 / C5).

**Date:** 2026-09-24 · **Module:** MRF (requisition approval) + reminder cron
**Trigger:** production report. The CEO opened the approval link for **MRF #9**, which he had
**not** approved, and got *"Link inactive or invalid — This requisition has already been processed.
Current status is: APPROVED."* This happened to him twice.

**No schema change, no migration, no new env vars.** Backend + frontend deploy only.
The one data-side effect is that the reminder cron now **closes** some `rpa_email_log` rows
(it sets `responded_at`). See [Deployment](#deployment).

**Status:** code complete. The new unit tests pass. **Not yet run:** the staging end-to-end checks
and the production confirmation queries. Both are listed below.

---

## TL;DR

| # | Problem | Fix |
|---|---------|-----|
| 1 | The reminder cron re-sent the approval request, Approve/Reject buttons included, **after** the MRF was already decided | The cron only reminds when the underlying record still needs action. The approve endpoint also closes the reminder rows at decision time |
| 2 | The cron reminded **any** `rpa_email_log` row whose `reference_id` happened to equal an `rpa_mrf.id`: outcome, HR-notify, welcome and password mails | Whitelist of remindable email types. Each type is joined to the table its `reference_id` actually points at |
| 3 | HM "please fill the MRF" reminders continued after the HM had submitted | `mrf_hm` rows are joined to `rpa_mrf_jd_send` and stop once `mrfstatus` ≠ pending / `mrf_id` is linked |
| 4 | Approval page showed a red "Link inactive or invalid" for a requisition that was approved successfully | New neutral "already approved / no further action" view. The red view is kept for real token errors |
| 5 | Approve + reject submitted together could both pass the status check (last write wins, two outcome emails) | Conditional `updateMany` on the status just read; the loser gets **409** |
| 6 | Any `action` other than `approve` was saved as a **rejection** | Only `approve` / `reject` are accepted, otherwise **400** |
| 7 | No record of *when* a decision was taken (`rpa_mrf` has no `updated_at`; prod drops HTTP logs) | An info log line is written on every decision |

---

## 1. Background: how MRF approval works

1. The HM submits the MRF form, and `POST /api/mrf/submit` → `submitHiringManagerMrf` inserts `rpa_mrf` (`approval_status = 'pending'`).
2. A JWT is signed: `{ mrfId, email: submitter_email }`, 30-day expiry
   ([mrf.controller.js](../../../backend/src/controllers/mrf.controller.js), step "Generate secure approval token").
3. `sendMrfApprovalEmail` sends **one** email to the `mrfApproval` recipients, with Approve/Reject links
   `${frontendUrl}/mrf/:id/approve?action=approve|reject&token=…`.
   It logs **one** `rpa_email_log` row (`email_type = 'mrf_approval_request'`, `reference_id = rpa_mrf.id`,
   `recipient_email` = the comma-separated list).
   - Prod recipients (`rpa_settings`, see [seed-email-recipients.js](../../../backend/prisma/seed-email-recipients.js)):
     `aroy@aapnainfotech.com, sroy@aapnainfotech.com`.
4. The approver opens `/mrf/:id/approve` ([MrfApprovalAction.jsx](../../../frontend/src/pages/MrfApprovalAction.jsx)).
   The page calls `GET /api/mrf/public-details/:id?token=…` (read-only).
5. The approver clicks Confirm, and `POST /api/mrf/:id/approve` → `handleMrfApproval` sets `approval_status`, updates
   `rpa_mrf_jd_send.mrfstatus`, and sends the outcome email (`mrf_approved` / `mrf_declined`).
   - Prod `mrfOutcome`: to `recruitment@aapnainfotech.in`, cc `sroy@, nsatywali@, cverma@` + HM. **`aroy@` is not included.**
6. The reminder cron ([reminderScheduler.js](../../../backend/src/jobs/reminderScheduler.js), daily 09:00 by
   default, settings `reminder_interval_days` = 2 and `reminder_max_count` = 3) re-sends pending log rows.

Both approvers hold **the same token**, so the first decision is final for both. This matches the old n8n
`sendAndWait` behaviour, and the business has confirmed it is intended.

---

## 2. Root cause analysis

### What it is not
- **Not email delivery or a malformed link.** The page reached the status check, so the JWT verified and
  MRF #9 exists. A bad or expired token gives *"Invalid or expired approval token."* (401).
- **Not a trigger, job or hidden write path.** Exactly one code path writes
  `approval_status = 'approved'`: `handleMrfApproval`. No DB triggers exist on `rpa_mrf`. `approval_status`
  is excluded from `MAIN_MRF_EDITABLE_FIELDS`. No sweep job writes it.
- **Not a link scanner (Safe Links etc.).** Opening the link only issues a GET. A decision requires
  a human click that sends the POST.

### What it is
Someone else holding the same link, most likely the other approver, approved MRF #9 first, and the
system then misled the CEO in three ways:

1. **He was never told.** He is not on the `mrfOutcome` CC.
2. **The reminder cron kept re-sending the Approve button after the decision.** The old query:
   ```sql
   FROM rpa_email_log el
   LEFT JOIN rpa_cv  c ON el.reference_id = c.id AND el.email_type = 'missing_jd'
   LEFT JOIN rpa_mrf m ON el.reference_id = m.id AND el.email_type != 'missing_jd'
   WHERE el.responded_at IS NULL AND el.status = 'sent' AND el.reminder_count < $1 AND <interval>
   ```
   - It had **no `email_type` filter**, and the only per-row gate was "does an `rpa_mrf` row with this id exist".
   - **Nothing ever set `responded_at`** when an MRF was decided. `inboundEmailSync` closes rows on an email
     reply, matched on `recipient_email`, but that can never match the comma-separated approver list.
   - For `mrf_approval_request`, the reminder body is `banner + log.body_html`: the original email with the
     **same token**. So ~2 days after submission the approvers got "Reminder (1/3): New MRF Request –
     Approval Request" with working-looking buttons, whatever the MRF's status. This is the likely second
     occurrence.
3. **The page called it "invalid".** `MrfApprovalAction.jsx` routed a non-pending status into the error
   view: title "Link inactive or invalid", `Alert type="error"`.

### Same bug, other email types (found during the investigation)
- **`mrf_hm`**'s `reference_id` is an **`rpa_mrf_jd_send.id`**, but the query joined it to `rpa_mrf`:
  - HMs were reminded only when the ids happened to collide;
  - reminders did not stop after the HM submitted;
  - the reminder's `rpa_email_messages.mrf_id` pointed at an unrelated MRF, or would violate the FK.
- **`welcome`, `data_collection`, `duplicate_alert`** (`reference_id` = candidate id), **`user_created`,
  `password_reset_request`** (user id), and **`mrf_approved`, `mrf_declined`, `mrf_submit_hr`** (MRF id)
  were all "remindable" whenever their `reference_id` matched an existing `rpa_mrf.id`. They got a
  generic "please take action" banner on top of the original body.
- `reminder_count` was incremented **last**, after the `rpa_email_messages` and `rpa_email_tracking`
  inserts. Any failure there left the count unchanged, and the same reminder was re-sent on every run.

---

## 3. Changes by file

### 3.1 `backend/src/jobs/reminderEligibility.js` (new)
A pure module with no prisma or redis imports, so `node --test` can load it. It is the single source of truth for which rows
the cron may remind, and when to stop.

| Export | Value / behaviour |
|--------|-------------------|
| `CANDIDATE_DATA_EMAIL_TYPE` | `'missing_jd'` (legacy n8n name) |
| `MRF_HM_EMAIL_TYPE` | `'mrf_hm'` (`reference_id` = `rpa_mrf_jd_send.id`) |
| `MRF_APPROVAL_EMAIL_TYPES` | `['mrf_approval_request', 'mrf_approval']` (the second is the legacy n8n name) |
| `REMINDABLE_EMAIL_TYPES` | union of the above; **everything else is never reminded** |
| `isMrfApprovalEmailType(type)` | helper |
| `isOpenApprovalStatus(status)` | `pending` / `waiting`, case- and whitespace-insensitive (same set `handleMrfApproval` accepts) |
| `reminderSkipReason(row)` | `null` = send the reminder; otherwise a reason string, and the caller closes the row |

`reminderSkipReason` rules:

| Email type | Reminder is sent when… | Closed (no reminder) when… |
|------------|------------------------|-----------------------------|
| `missing_jd` | candidate exists **and** has `cvMissingToken` | candidate missing / no token (same as the old inline checks) |
| `mrf_hm` | request exists, `mrf_id` IS NULL, `mrfstatus` ∈ {`''`/NULL, `pending`, `pendingfromleader`} | request missing, **or HM already submitted** |
| `mrf_approval_request`, `mrf_approval` | MRF exists and `approval_status` ∈ {`pending`, `waiting`} | MRF missing, **or already decided** (approved/rejected/completed/closed/…) |
| anything else | never | always (backstop; the SQL already filters these out) |

The `mrf_hm` open set mirrors `mrfStatusLabel()` in
[exports/mrf.export.js](../../../backend/src/exports/mrf.export.js), which also treats blank as pending.

### 3.2 `backend/src/jobs/reminderScheduler.js`
**Query**: whitelisted, and each type is joined to the table it actually references:
```sql
SELECT el.*,
       c."cvMissingToken", c.id AS candidate_exists_id,
       m.id AS mrf_exists_id, m.approval_status AS mrf_approval_status,
       s.id AS mrf_request_exists_id, s.mrfstatus AS mrf_request_status, s.mrf_id AS mrf_request_mrf_id
FROM rpa_email_log el
LEFT JOIN rpa_cv          c ON el.reference_id = c.id AND el.email_type = $3                -- 'missing_jd'
LEFT JOIN rpa_mrf         m ON el.reference_id = m.id AND el.email_type = ANY($4::text[])   -- approval types
LEFT JOIN rpa_mrf_jd_send s ON el.reference_id = s.id AND el.email_type = $5                -- 'mrf_hm'
WHERE el.email_type = ANY($6::text[])                                                       -- REMINDABLE_EMAIL_TYPES
  AND el.responded_at IS NULL AND el.status = 'sent' AND el.reminder_count < $1 AND <interval unchanged>
```
All type names are bound parameters taken from `reminderEligibility.js`, not string literals.

**Loop:**
- The two old inline orphan checks and the inline `cvMissingToken` check are replaced by one call to
  `reminderSkipReason(log)`. A skipped row gets `responded_at = now()`, the same mechanism the old orphan checks
  used, and an **info** log line: `Closing log ID <id> (<type>) without a reminder - <reason>.`
  (The old orphan checks logged at warn.)
- `reminder_count` / `last_reminder_at` are now updated **immediately after `sendGraphEmail` succeeds**,
  before the `rpa_email_messages` / `rpa_email_tracking` inserts.
- `rpa_email_messages.mrf_id` is set **only for approval types**, and is `null` for `mrf_hm` (the column is an FK to
  `rpa_mrf`; a jd_send id is not an MRF id). `candidate_id` logic is unchanged.
- The reminder body templates are unchanged. `mrf_approval_request` still uses the generic branch
  (banner + original body with its buttons). That is correct now, because it only fires while the MRF is
  still pending.

### 3.3 `backend/src/controllers/mrf.controller.js`: `handleMrfApproval`
The public endpoint `POST /api/mrf/:id/approve`.

```js
// NEW: validate action (previously anything except 'approve' was saved as a reject)
const normalizedAction = String(action).trim().toLowerCase();
if (normalizedAction !== 'approve' && normalizedAction !== 'reject') {
  throw new AppError('Action must be either "approve" or "reject".', 400);
}
…
if (currentStatus !== 'pending' && currentStatus !== 'waiting') {
  throw new AppError('This requisition request has already been processed.', 409);   // was 400
}
// NEW: atomic transition — conditional on the exact status value just read
const { count } = await prisma.rpa_mrf.updateMany({
  where: { id: BigInt(id), approval_status: mrf.approval_status },
  data:  { approval_status: isApproved ? 'approved' : 'rejected' },
});
if (count === 0) throw new AppError('This requisition request has already been processed.', 409);
const updatedMrf = await prisma.rpa_mrf.findUnique({ where: { id: BigInt(id) } });

logger.info(`MRF ${id} ${updatedMrf.approval_status} via approval link at ${new Date().toISOString()}`);

// NEW: close the approval-request log rows so no reminder follows the decision (non-fatal)
await prisma.rpa_email_log.updateMany({
  where: { email_type: { in: MRF_APPROVAL_EMAIL_TYPES }, reference_id: Number(id), responded_at: null },
  data:  { responded_at: new Date() },
});   // wrapped in try/catch → logger.warn
```
- The `rpa_mrf_jd_send.mrfstatus` update and the outcome email are unchanged, and still run only for the
  request that won the transition.
- `approverName: decoded.email` is **removed** from the `sendMrfOutcomeEmail` call. `decoded.email` is the
  **hiring manager's** email (that is what the token carries), and the template never used it.
- New import: `MRF_APPROVAL_EMAIL_TYPES` from `../jobs/reminderEligibility.js`.

**API contract changes (`POST /api/mrf/:id/approve`):**

| Case | Before | After |
|------|--------|-------|
| `action` not approve/reject | 200, saved as **rejected** | **400** `Action must be either "approve" or "reject".` |
| MRF already decided | **400** `…already been processed.` | **409** (same message) |
| Lost a concurrent race | 200 (overwrote the first decision) | **409** |
| Success | 200 `{ approval_status }` | unchanged |

The only client is `MrfApprovalAction.jsx` (via `mrfService.handleMrfApproval`), and it is updated for the new codes.

### 3.4 `backend/src/services/emailNotification.service.js`
- `sendMrfOutcomeEmail({ mrfRecord, approved, comments, hmEmail })`: the unused `approverName`
  parameter was removed. **The email content and recipients are unchanged.**

### 3.5 `frontend/src/pages/MrfApprovalAction.jsx`
- New module-level helpers:
  - `OPEN_STATUSES = ['pending', 'waiting']`;
  - `decidedLabel(status)`: approved → "approved", rejected → "declined" (matches the outcome email), completed, closed, anything else → "processed";
  - `apiErrorMessage(err, fallback)`: reads `err.response.data.message`. These public calls use **plain axios**, not the `api` wrapper, so `err.message` was only "Request failed with status code …".
- New state `decidedStatus`. `fetchMrfDetails` sets it instead of `error` when the status is not open.
- New render branch, placed **before** the error branch:
  - `PublicPageShell` titled "Requisition already approved/declined/…", subtitle "No further action is needed from you.";
  - antd `Result` (`success` for approved, `info` otherwise) naming the position, with a Close Window button (same style as the success view).
- The red "Link inactive or invalid" view now appears only for real failures: missing token, 401 invalid/expired, 403 id mismatch, 404, or network errors. It shows the server's message.
- `handleAction`: on a **409**, it calls `fetchMrfDetails()`, which lands on the decided view (someone decided while the page was open). Any other error still sets `error`.

### 3.6 Tests and docs
- **New** [backend/src/tests/reminderEligibility.test.js](../../../backend/src/tests/reminderEligibility.test.js) has 8 tests:
  - approval rows are open only for pending/waiting (case-insensitive), and closed for approved, rejected, completed and closed;
  - legacy `mrf_approval` follows the same rules;
  - deleted MRF or request → closed;
  - HM rows are open for `pending`, `pendingfromleader`, blank and null, and closed for submitted, approved or `mrf_id` linked;
  - `missing_jd` token and existence checks;
  - notifications and alerts (`mrf_approved`, `mrf_declined`, `mrf_submit_hr`, `welcome`, `data_collection`, `password_reset_request`, `user_created`, `duplicate_alert`, `backend_error_alert`) are never remindable, even when a matching MRF row exists.
- [docs/CHANGELOG.md](../../CHANGELOG.md) has a 2026-09-24 entry.

---

## 4. Behaviour before and after

| Scenario | Before | After |
|----------|--------|-------|
| Approver opens the link while pending | Review page | Review page (unchanged) |
| Approver opens the link (original **or any reminder**) after a decision | Red "Link inactive or invalid / Requisition Process Error" | Neutral "Requisition already approved – no further action is needed" |
| Reminder due, MRF still pending | Reminder with buttons | Reminder with buttons (unchanged) |
| Reminder due, MRF already decided | **Reminder with dead buttons** (up to 3) | No reminder; row closed |
| Decision taken | Reminder rows stay open | Reminder rows closed immediately |
| HM reminder due, HM already submitted | Reminded (if the ids collided) | No reminder; row closed |
| HM reminder due, HM not submitted | Reminded **only if** the jd_send id collided with an rpa_mrf id | Reminded (as designed) — see [Deployment](#deployment) |
| Outcome / HR-notify / welcome / password mail, id collides with an MRF | "Reminder: please take action" sent | Never reminded |
| Both approvers confirm at the same moment | Both succeed; last write wins; 2 outcome emails | One succeeds; the other sees the decided view (409) |
| `action=hold` (or any junk) POSTed | Saved as **rejected** | 400 |
| Token older than 30 days | Red "Invalid or expired approval token" | Unchanged |

Each MRF has its own token, so deciding one MRF has no effect on another MRF's links.

---

## 5. Testing

**Done:**
- `node --test src/tests/reminderEligibility.test.js`: **8/8 pass**.
- `node --test src/tests/*.test.js`: 100 pass. **6 files fail at import** (`Cannot find package 'dotenv'` /
  `'@prisma/client'` / `'jsonwebtoken'`) because the checkout used had no `node_modules`. This is unrelated to this
  change; re-run after `npm install`.
- `node --check` on all edited backend files; esbuild JSX parse of `MrfApprovalAction.jsx`.

**Still to run (staging, after `npm install`):**
1. `npm run test:unit` (backend), and `npx vite build` (frontend).
2. Submit an MRF → approve via the link → success page. Check that the `mrf_approval_request` row in `rpa_email_log`
   now has `responded_at` set, and that `combined.log` has `MRF <id> approved via approval link at …`.
3. Open the same link again → "Requisition already approved – no further action is needed". Also try the reject
   link → same view.
4. Race: open the approve and reject pages in two tabs and confirm both → one success; the other lands on the decided view.
   Only one outcome email; the DB shows the first decision.
5. Tamper with the token → red invalid-link view, showing "Invalid or expired approval token."
6. `curl -X POST …/api/mrf/<id>/approve -d '{"token":"…","action":"hold"}'` → 400.
7. Reminder cron: set `reminder_interval_days` = `0` in `rpa_settings`, then call `sendPendingReminders()` from a
   scratch script:
   - decided MRF → no reminder, row closed, info log line;
   - pending MRF → reminder sent, `reminder_count` +1;
   - submitted HM request → no reminder, row closed;
   - pending HM request → reminder sent, `rpa_email_messages.mrf_id` NULL;
   - welcome / outcome / HR-notify rows → untouched (not selected at all).
   
   Restore `reminder_interval_days` afterwards.

---

## Deployment

- **Order:** backend and frontend together; they are independent, but the page change is what makes the new 409 friendly.
- **No DDL, no `prisma db pull` / `generate`, no env/config change.** Restart the backend (PM2/service) as usual.
- **Data side effects on the first cron run after deploy:**
  - Open approval-request rows for **already-decided** MRFs (e.g. MRF #9) and open `mrf_hm` rows for
    **already-submitted** requests are **closed** (`responded_at = now()`), with no email sent. This is intended.
  - Rows of non-remindable types are simply no longer selected; they are not modified.
  - ⚠️ **HM requests that are still pending and never got reminders before** (because the old join needed an
    id collision) **become eligible** and will get "Reminder (n/3)". This is the designed behaviour, but it may
    reach old, abandoned requests. **Preview on prod before deploying:**
    ```sql
    SELECT el.id, el.email_type, el.recipient_email, el.subject, el.sent_at, el.reminder_count
    FROM rpa_email_log el
    LEFT JOIN rpa_mrf m ON el.reference_id = m.id AND el.email_type IN ('mrf_approval_request','mrf_approval')
    LEFT JOIN rpa_mrf_jd_send s ON el.reference_id = s.id AND el.email_type = 'mrf_hm'
    LEFT JOIN rpa_cv c ON el.reference_id = c.id AND el.email_type = 'missing_jd'
    WHERE el.responded_at IS NULL AND el.status = 'sent' AND el.reminder_count < 3   -- use reminder_max_count
      AND ( (el.email_type IN ('mrf_approval_request','mrf_approval') AND lower(trim(m.approval_status)) IN ('pending','waiting'))
         OR (el.email_type = 'mrf_hm' AND s.mrf_id IS NULL AND lower(trim(coalesce(s.mrfstatus,''))) IN ('','pending','pendingfromleader'))
         OR (el.email_type = 'missing_jd' AND c."cvMissingToken" IS NOT NULL) )
    ORDER BY el.sent_at;
    ```
    Any row listed here may be reminded, ignoring the interval filter. To suppress old ones, set their
    `responded_at` by hand before deploying (agree which ones with HR first).
- **Rollback:** revert the five code files and remove the new module and test. No data migration needs
  undoing. Rows the new code closed stay closed, which is the correct state for them anyway.

**Post-deploy checks (prod):**
```sql
-- MRF #9's approval-request row should be closed and receive no further reminders
SELECT id, email_type, responded_at, reminder_count, last_reminder_at
FROM rpa_email_log WHERE reference_id = 9 AND email_type IN ('mrf_approval_request','mrf_approval');
```
- `combined.log` after 09:00: look for `[Reminder Scheduler] Closing log ID … without a reminder` lines, and no
  `Successfully sent reminder` for decided MRFs.

---

## 6. Incident investigation queries (prod, read-only)

`rpa_mrf` and `rpa_mrf_jd_send` have **no `updated_at`**, and no audit table covers them. The **approval time** is
recoverable from the outcome email log, which is written within seconds of the status update:
```sql
SELECT id, approval_status, created_at, submitter_email, position_hiring_for FROM rpa_mrf WHERE id = 9;

SELECT id, email_type, recipient_email, subject, status, sent_at, responded_at, reminder_count, last_reminder_at
FROM rpa_email_log WHERE reference_id = 9 AND email_type LIKE 'mrf_%' ORDER BY sent_at;
-- mrf_approved.sent_at ≈ approval time. The column is 'timestamp without tz' in DB server time; convert to IST.
-- mrf_approval_request.last_reminder_at > mrf_approved.sent_at proves a reminder went out after the decision.

SELECT id, subject, to_emails, sent_at FROM rpa_email_messages WHERE mrf_id = 9 ORDER BY sent_at;

SHOW track_commit_timestamp;   -- if 'on':  SELECT pg_xact_commit_timestamp(xmin) FROM rpa_mrf WHERE id = 9;
```
Cross-check:
- `combined.log`: `MRF outcome email (Approved) sent and logged for MRF ID: 9`;
- the sender mailbox's Sent Items: "Approved: New MRF Request".

**Who** approved is not recorded anywhere in the app (shared token). External sources:
- Defender for Office 365 Safe Links click logs (`UrlClickEvents | where Url has "/mrf/9/approve"`), if licensed;
- a reverse-proxy access log for `POST /api/mrf/9/approve`, if one exists (morgan logs at `http` level, which prod drops);
- asking the other approver.

---

## 7. Known limitations and follow-ups (deliberately not changed)

| Item | Notes |
|------|-------|
| Shared token for both approvers; the app cannot tell who decided | Proposal: one email and token per approver (`approverEmail` in the JWT), plus new `rpa_mrf` columns `approval_decided_by/_at/approval_comments`. Needs DDL and a stakeholder decision |
| CEO (`aroy@`) not on the outcome email | Config only: add him to `email_recipients.mrfOutcome.cc` via the admin Flow Keys screen (and the seed file). Pending a stakeholder decision |
| `inboundEmailSync` can't close approval rows on reply | `recipient_email` is a comma-separated list; solved if emails become per-approver |
| `data_collection` emails are never reminded | The service logs `data_collection`, but the cron's candidate branch handles the legacy `missing_jd` name. The old code only reminded them by accidental id collision. Enabling this properly is a product decision |
| Morgan HTTP logs dropped in prod | Logger level `info` < morgan's `http`. Left as is: enabling it would also log approval tokens from query strings |
| `backend/src/scratch/verify_graph_id_capture.js` | Scratch script still contains the old query; not production code |
| 30-day token expiry | Reminders reuse the original token. With default settings the last reminder is ~day 6, so this is only relevant if nobody acts for a month |
