# Proposal — Improving the Outlook Integration

**Date:** 2026-07-03
**Status:** Mostly implemented 2026-07-08 — P1 (real Graph conversation ids via draft→send, with legacy sendMail fallback), P4 (`responded_at` auto-set on reply), failed-send persistence (`rpa_email_log.status`/`error_message`), **P2 (open-tracking pixel — `GET /api/track/open/:token`, requires `PUBLIC_BASE_URL`)** and **P3 (reply from ATS — `POST /api/screening/outlook/reply` + reply box in the Analytics conversation modal)** are live. See `docs/changelog/CHANGES-outlook-phase1-quickwins.md` and `docs/changelog/CHANGES-outlook-open-tracking-and-reply.md`. **P5-A (delta-query sync via the consolidated `jobs/mailboxPoller.js`), P6.1 (poller consolidation), P6.3 (conversation-based candidate-mapping fallback), Graph 429 handling, a delivery-monitoring panel (`GET /api/email/monitoring` + Email Management UI), and first unit tests landed 2026-07-09 (see `docs/changelog/CHANGES-outlook-delta-sync-and-monitoring.md`). Still open: P5-B webhooks (only if sub-minute latency is needed) and P6.2 `rpa_outlook_accounts` redesign.** Note: prod DB still needs `ALTER TABLE rpa_email_log ADD COLUMN status TEXT NOT NULL DEFAULT 'sent', ADD COLUMN error_message TEXT;` at deploy (applied to dev/staging DB already).
**Companion doc:** `docs/test-plans/phase3-completed-items-test-plan.md`

## Current state (summary)

The Outlook integration is functional but has structural gaps discovered during test planning:

| Area | Current implementation | Reference |
|---|---|---|
| Auth | App-only client-credentials token, cached in memory | `src/services/onedrive.service.js` |
| Sending | Graph `sendMail` from one shared mailbox; outbound rows stored with **synthetic** conversation IDs (`shortlist-conv-{id}` etc.) | `src/services/emailNotification.service.js`, `src/services/screening.service.js` |
| Inbound | 5-min `node-cron` polling of the shared inbox with a `rpa_settings` watermark; dedup by unique `graph_message_id` | `src/jobs/inboundEmailSync.js`, `src/jobs/emailResumeIntake.js` |
| Conversation view | Threads stitched by candidate email + position (not conversationId) | `src/services/screening.service.js` (`getOutlookConversations`) |
| Open tracking | Schema + UI badge exist; **no pixel endpoint, `opened` never set** | `rpa_email_tracking` |
| Reply from ATS | **Not implemented** — no compose/reply endpoint; `in_reply_to` never written | — |
| Reply/bounce detection | Correlates by `conversation_id` — rarely matches due to synthetic outbound IDs | `inboundEmailSync.js` |
| Reminder suppression | `rpa_email_log.responded_at` drives suppression but is never auto-set | `src/jobs/reminderScheduler.js` |

## Prioritized improvements

### P1 — Fix outbound threading with real Graph conversation IDs 🔴 Foundation — **Effort: M**

**Problem.** Graph `sendMail` is fire-and-forget, so outbound rows get fabricated `conversation_id` values. Candidate replies carry the *real* Graph `conversationId`, so reply detection (`replied=true`) and bounce correlation (`bounced=true`) almost never fire, and the conversation view can't group by true thread.

**Design.**
1. In the send path, replace one-shot `sendMail` with: **create draft** (`POST /users/{mailbox}/messages`) → **send** (`POST /users/{mailbox}/messages/{id}/send`) → **fetch the sent item** to capture the real `id`, `conversationId`, and `internetMessageId`.
2. Store those in `rpa_email_messages` (`graph_message_id`, `conversation_id`) and start populating the existing-but-unused `in_reply_to` column.
3. Existing reply/bounce detection in `inboundEmailSync.js` then works **unchanged** — the conversation IDs simply start matching.

**Touchpoints:** `emailNotification.service.js` (`sendGraphEmail`), `screening.service.js` (shortlist / status-change sends), `reminderScheduler.js`.
**Dependencies:** none. **Unlocks:** P3, and makes OUT-13/OUT-14 test cases pass.

### P4 — Auto-set `responded_at` on candidate reply 🟢 Quick win — **Effort: S**

**Problem.** Candidates who reply can still receive automated reminders because `rpa_email_log.responded_at` is never set by inbound sync.

**Design.** In `inboundEmailSync.js`, when an inbound message resolves to a candidate (`lookupCandidate` hit), update the candidate's open `rpa_email_log` rows: `SET responded_at = NOW() WHERE responded_at IS NULL AND recipient_email ILIKE <sender>`. One small SQL addition; independent of P1.

### P2 — Implement email open tracking 🟡 — **Effort: S/M**

**Problem.** Tracker marks this Completed, but no code ever sets `opened` — the UI "Opened" badge can never appear.

**Design.**
1. New **public, unauthenticated** route: `GET /api/track/open/:tracking_token` → returns a 1×1 transparent GIF, and updates `rpa_email_tracking`: `opened=true`, `open_count = open_count + 1`, `first_opened_at` (once), `last_opened_at`. The unique `tracking_token` (uuid, default `gen_random_uuid()`) **already exists** on every tracking row — no migration needed.
2. At send time, inject `<img src="{PUBLIC_BASE_URL}/api/track/open/{token}" width="1" height="1" style="display:none">` into the outbound HTML (single helper in `emailNotification.service.js`).
3. New env var `PUBLIC_BASE_URL` (staging must be reachable from the public internet for the pixel to load).

**Known limitations to document:** Outlook/Gmail image proxies pre-fetch and cache images, so counts are approximate and some "opens" fire without a human open; corporate clients often block images entirely. Treat `opened` as a positive signal, not a metric.

### P3 — Threaded reply from the ATS 🟡 — **Effort: M**

**Problem.** Recruiters can view conversations but cannot reply from inside the ATS.

**Design.**
1. New endpoint `POST /api/screening/outlook/reply` (in `screening.routes.js`): body `{message_id, body_html}` where `message_id` is a `rpa_email_messages` row. Backend calls Graph `POST /users/{mailbox}/messages/{graphId}/createReply` → PATCH the draft body → send. The reply **inherits the real conversationId** automatically.
2. Store the outbound row (direction `outbound`, real `conversation_id`, `in_reply_to` = original `internetMessageId`) plus a `rpa_email_tracking` row.
3. Frontend: add a reply input to the existing conversation modal in `Analytics.jsx` (chat bubbles already exist), via a new `screeningService.js` method.
4. Respect the staging redirect rules (`resolveRecipients`) so test replies don't reach real candidates.

**Dependencies:** P1 (for outbound-initiated threads to be replyable and cleanly grouped). Replying to *inbound* messages works without P1.

### P5 — Toward real-time inbound sync 🟢/🟡

**Option A (recommended first, Effort: S/M):** keep polling but switch to Graph **delta queries** (`GET /users/{mailbox}/mailFolders/inbox/messages/delta`), storing the `deltaLink` in `rpa_settings` instead of the timestamp watermark. Benefits: no missed/duplicate edge cases at the watermark boundary, cheaper responses, safe to tighten the interval to ~1 min.

**Option B (true real-time, Effort: L):** Graph **change-notification webhooks** — `POST /subscriptions` on the inbox with a public HTTPS notification URL, validation-token handshake, `clientState` secret verification, and a renewal cron (message subscriptions expire in ≤ ~3 days). Keep polling as a fallback for missed notifications. Choose only if sub-minute latency is actually required and staging/production expose a public HTTPS endpoint.

### P6 — Smaller hardening items 🟢 — **Effort: S each**

1. **Consolidate the two pollers.** `inboundEmailSync` and `emailResumeIntake` each independently page the same inbox every 5 min. Fetch once per tick and fan out to both handlers — halves Graph traffic and keeps the two watermarks consistent.
2. **`rpa_outlook_accounts` cleanup.** Only `last_sync_at` is ever written. Either make it the real account registry (which mailboxes to poll, per-mailbox watermark — a prerequisite for multi-mailbox support) or drop it from scope to avoid confusion.
3. **Candidate-mapping fallback.** Matching is sender-email-ILIKE only; candidates replying from a different address land as `candidate_id NULL` and vanish from histories. Add a secondary heuristic (recipient + subject token, or a short-lived reply token in the subject) and/or an "unmatched inbox" review screen instead of silently orphaning messages.

## Suggested sequencing

```
P1 (threading foundation) → P4 (responded_at quick win) → P2 (open tracking) → P3 (reply from ATS) → P5-A (delta queries) → P6 (hardening) → P5-B (webhooks, only if needed)
```

Rationale: P1 makes two already-shipped tracker items (response detection, bounce handling) actually reliable and unlocks P3; P4 is a one-query fix with immediate candidate-experience impact; P2 and P3 close the two tracker items currently marked Completed but not implemented.
