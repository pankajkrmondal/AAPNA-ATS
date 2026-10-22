# Outlook Integration Phase 2 — Open Tracking (P2) + Reply from ATS (P3) — Session Log

> Date: 2026-07-08
> Follows: `docs/changelog/CHANGES-outlook-phase1-quickwins.md` (real Graph IDs, responded_at,
> failed-send persistence). This session implements proposal items P2 and P3 from
> `docs/proposals/outlook-integration-improvements.md`.

Scope: make the existing (but dead) "Opened" badge real via a tracking pixel, and
let recruiters reply to candidate conversations from inside the ATS. Both features
are additive; nothing existing changes behavior when the new config is absent.

---

## 1. Email open tracking (P2)

### New env var — `PUBLIC_BASE_URL`
Public origin of the **backend** (used to build the absolute pixel URL). Added to
`config/index.js` (`config.publicBaseUrl`) and all backend `.env*` files:
- dev/development: `http://localhost:5000`
- staging: `https://ats-staging.aapnainfotech.com` ⚠️ confirm this is the public API origin
- production: `https://ats.aapnainfotech.com` ⚠️ confirm likewise
**When empty, pixel injection is skipped entirely** — zero behavior change.

### Pixel injection — `emailNotification.service.js` → `injectTrackingPixel(html, token)`
Appends `<img src="{PUBLIC_BASE_URL}/api/track/open/{token}" …>` before `</body>`.
Tokens are generated app-side (`uuidv4()`) because the pixel must be embedded
*before* the send, then stored on the `rpa_email_tracking` row (`tracking_token`
column already existed with a unique index — no schema change).

Injected at three send sites (**pixel goes into the SENT html only** — the stored
`body_html` stays clean so viewing the conversation modal can't count as an open):
- Shortlist emails — `screening.service.js`
- Status-change emails (rejected/on-hold) — `screening.service.js` `updateCandidateStatus`
  (this path previously created **no** tracking row at all; now it does)
- Reminder follow-ups — `jobs/reminderScheduler.js`

### Public pixel endpoint
- `src/routes/tracking.routes.js` (new) — mounted at `/api/track` in `routes/index.js`,
  intentionally **without** `authenticate` (mail clients have no ATS session).
- `src/controllers/tracking.controller.js` (new) — `GET /api/track/open/:token`:
  validates the token is a UUID (guards the `::uuid` cast), updates
  `opened / open_count+1 / first_opened_at (once) / last_opened_at`, and **always**
  returns a 200 1×1 transparent GIF (`Cache-Control: no-store`) — unknown tokens
  and DB errors included; a pixel must never surface an error.

Known limitation (by design, documented in the proposal): mail-client image proxies
pre-fetch and corporate clients block images — treat `opened` as a positive signal,
not a metric.

## 2. Reply from the ATS (P3)

### Backend
- `emailNotification.service.js` → new `sendGraphReply({ mailbox, graphMessageId, html, toOverride })`:
  Graph `createReply` (with `Prefer: IdType="ImmutableId"`) → `PATCH` the draft
  (reply text above the quoted original; recipients overridden when redirecting) →
  `send`. Unsent drafts are best-effort deleted on failure. Reuses the shared
  network-retry helper. Requires `Mail.ReadWrite` (verified granted).
- `screening.service.js` → new `replyToOutlookMessage(messageId, bodyHtml, user)`:
  resolves the counterpart (sender of inbound / recipient of outbound), routes it
  through the new **`manualReply`** flow key in `config/emailRecipients.js`
  (dynamic → candidate in prod, **test inbox in non-prod** like every other
  candidate-facing flow), injects an open-tracking pixel, sends, then stores the
  outbound `rpa_email_messages` row with the reply's **real** ids +
  `in_reply_to = original.internet_msg_id` + `sent_by_user_id`, plus a tracking row.
  Failures are persisted via `logFailedEmail` (`email_type='manual_reply'`) and
  surfaced to the UI as a readable error.
- Route `POST /api/screening/outlook/reply` (`{ message_id, body_html }`) — inherits
  `authenticate` + `checkModuleAccess('candidate_screening')`.
- Messages sent **before** Phase 1 (no `graph_message_id`) get a clear 400
  explaining they can't be replied to from the ATS.

### Frontend
- `services/screeningService.js` → `replyToOutlookConversation(messageId, bodyHtml)`.
- `pages/Analytics.jsx` — conversation modal now has a per-thread reply box
  (TextArea + Reply button; drafts keyed by `thread.group_key`, one send at a time).
  Replies target the newest message in the thread; plain text is HTML-escaped and
  newlines become `<br/>`. On success the sent message is appended to the thread
  in place; errors show the backend's message.

## 3. Verification performed

- **Pixel (HTTP, live server):** `GET /api/track/open/<token>` → 200 `image/gif`
  (42-byte 1×1 GIF); two hits → `opened=true, open_count=2`, `first_opened_at`
  set once; garbage token and unknown UUID both → 200 GIF, no error; and
  `POST /api/screening/outlook/reply` without a token → **401** (auth intact).
- **Pixel injection unit checks:** injected before `</body>` when
  `PUBLIC_BASE_URL` set; HTML unchanged when token/config missing.
- **Reply E2E (live Graph):** seed email sent to the test inbox, row stored,
  `replyToOutlookMessage` called → reply delivered with the **same
  `conversationId`** as the seed and `in_reply_to` = seed's `internetMessageId`;
  tracking row created. (Script: `src/scratch/verify_open_tracking_and_reply.js`.)
- **Frontend:** `npm run build` passes.
- **Regression:** `src/scratch/verify_graph_id_capture.js` (Phase 1 checks) all OK.

## 4. Deploy checklist

1. Set `PUBLIC_BASE_URL` correctly per environment (confirm staging/prod public
   API origin; wrong/unset value only disables open tracking, breaks nothing).
2. Prod DB still needs the Phase 1 `ALTER TABLE rpa_email_log …` (see the Phase 1
   change log) before either phase's backend deploys.
3. Frontend + backend deploy together (new endpoint + new modal UI).
4. Remaining roadmap: P5 delta-query/webhook sync, P6 hardening (poller
   consolidation, candidate-mapping fallback, `rpa_outlook_accounts` cleanup),
   delivery-monitoring dashboard, automated tests.
