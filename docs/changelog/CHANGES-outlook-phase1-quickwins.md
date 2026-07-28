# Outlook Integration Phase 1 — Quick Wins — Session Log

> Date: 2026-07-08
> Trigger: Assessment of the Outlook integration found the tracking/feedback loop
> largely broken: reply/bounce detection never fired (synthetic conversation IDs),
> candidates who replied kept receiving reminders, and failed sends were invisible
> outside the Winston logs.

Scope: P1 + P4 of `docs/proposals/outlook-integration-improvements.md`, plus
failed-send persistence. Constraint honored: no impact to existing functionality —
all changes are additive with fallbacks.

---

## 1. Real Graph IDs on outbound sends (P1)

`backend/src/services/emailNotification.service.js` — `sendGraphEmail()` now sends
via **create draft → send** (header `Prefer: IdType="ImmutableId"`) instead of the
fire-and-forget `POST /sendMail`, and returns
`{ graphMessageId, conversationId, internetMessageId }`.

- **Safety fallback:** if draft creation is rejected (e.g. `Mail.ReadWrite` revoked),
  it transparently falls back to the legacy one-shot `sendMail` — sending can never
  regress; only ID capture degrades (nulls returned).
- Existing behaviors preserved: 3× network retry (`fetchWithNetRetry`), invalid-sender
  fallback to the default shared mailbox, `describeEmailError()` mapping. No caller
  used the old boolean return value.

Callers now store the real IDs (synthetic `*-conv-*` values kept only as fallback):

| Send path | File | Stored |
|---|---|---|
| Shortlist email | `screening.service.js` (shortlist loop) | `graph_message_id`, real `conversation_id`, `internet_msg_id` |
| Status-change email (rejected / on-hold) | `screening.service.js` `updateCandidateStatus` | same |
| Reminder follow-ups | `jobs/reminderScheduler.js` | same — **also replaced its duplicated inline Graph call with `sendGraphEmail`** (it previously had no retry/fallback) |

Effect: `inboundEmailSync.js` reply/bounce correlation (by `conversation_id`) now
matches **without any change to that job**, and outbound messages finally pass the
`graph_message_id IS NOT NULL` filter in `getOutlookConversations`, so they appear
in the conversation view.

## 2. Auto-set `responded_at` on reply (P4)

`backend/src/jobs/inboundEmailSync.js` — on any genuine (non-bounce) inbound message,
`rpa_email_log.updateMany` sets `responded_at` for the sender's open rows
(case-insensitive `recipient_email` match). Candidates/HMs who reply no longer
receive automated reminders.

## 3. Failed sends persisted

- **DB (dev/staging applied; PROD PENDING):**
  `ALTER TABLE rpa_email_log ADD COLUMN status TEXT NOT NULL DEFAULT 'sent', ADD COLUMN error_message TEXT;`
  ⚠️ **Run this on `recruitmentautomationdbProd` before deploying this code** — the
  reminder query references `status`.
- `emailNotification.service.js` — new `logFailedEmail()` helper (never throws);
  every sender's catch block records a `status='failed'` row with a readable
  `error_message` (via `describeEmailError`). Shortlist failures in
  `screening.service.js` are persisted too (previously only an in-memory array).
- `reminderScheduler.js` query adds `AND el.status = 'sent'` so failed sends are
  never "reminded".

## 4. Verification performed

`backend/src/scratch/verify_graph_id_capture.js` (kept for re-runs):
1. Live send through the new draft→send path — **real IDs captured** (tenant grants
   `Mail.ReadWrite`); network retry recovered a connect timeout mid-test.
2. Synthetic failure produced a queryable `status='failed'` row (cleaned up after).
3. Reminder query with the status guard runs correctly.

Full reply-correlation E2E (human reply → inbound sync → `replied=true` +
`responded_at`) requires `INBOUND_SYNC_ENABLED=true` and a real reply; not automated.

## 5. Deploy checklist

1. Run the `ALTER TABLE rpa_email_log …` on prod (see §3).
2. Confirm `INBOUND_SYNC_ENABLED=true` wherever reply/bounce detection is expected.
3. No new env vars; no frontend changes in this phase.
