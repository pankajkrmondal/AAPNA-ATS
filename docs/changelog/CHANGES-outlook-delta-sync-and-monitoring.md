# Outlook Integration Phase 3 — Delta Sync, Hardening, Delivery Monitoring, Tests — Session Log

> Date: 2026-07-09
> Follows: `CHANGES-outlook-phase1-quickwins.md` (threading/failure fixes) and
> `CHANGES-outlook-open-tracking-and-reply.md` (P2/P3). This session closes the
> remaining proposal roadmap except P5-B webhooks (deferred by design) and the
> P6.2 `rpa_outlook_accounts` redesign (still vestigial; only `last_sync_at` is
> written).

---

## 1. Delta-query inbox sync (P5-A) — `services/outlookReader.service.js`

- New `fetchMessagesDelta(deltaLink)` — Graph `/mailFolders/inbox/messages/delta`.
  Initial sync uses a 24h `receivedDateTime ge` filter; later cycles follow the
  stored `@odata.deltaLink`. Pages `nextLink`, skips `@removed`, returns
  normalized messages + the next deltaLink. HTTP 410 (expired token) throws
  `err.code='DELTA_EXPIRED'` so the poller resets cleanly.
- **429/503 throttling handling** (new `graphGet` helper): honors `Retry-After`
  (cap 60s), 3 attempts — now used by the delta fetch, `fetchMessagesSince`,
  and `downloadAttachments`.

Benefits vs the old timestamp `$filter`: no watermark-boundary miss/duplicate
edge cases, cheaper responses, and the interval can be safely tightened.

## 2. Consolidated poller (P6.1) — new `jobs/mailboxPoller.js`

One delta fetch per tick, fanned out to both consumers (each still gated by its
own flag: `EMAIL_INTAKE_ENABLED`, `INBOUND_SYNC_ENABLED`) — halves Graph traffic
and removes the two-watermark drift. New env `MAILBOX_SYNC_CRON` (default
`*/5 * * * *`; delta makes `*/1` viable).

- The per-message logic was extracted (no behavior change) into
  `processIntakeMessages()` (`jobs/emailResumeIntake.js`) and
  `processInboundMessages()` (`jobs/inboundEmailSync.js`); the old
  `runEmailResumeIntake()` / `runInboundEmailSync()` timestamp paths remain for
  manual/scratch use and now delegate to the processors.
- `server.js` starts/stops `mailboxPoller` instead of the two old jobs.
- Delta link is stored in `rpa_settings` key `mailbox_delta_link` **after** the
  processors finish — a failed tick reprocesses, which is safe (unique
  `graph_message_id` / hashed `execution_id` dedup).

## 3. Candidate-mapping fallback (P6.3) — `processInboundMessages`

If the sender address matches no `rpa_cv` row (candidate replying from a
different address), the message now adopts the candidate/shortlist of the latest
**outbound** message in the same Graph conversation (possible since Phase 1 put
real conversation ids on outbound rows). Previously such replies were silently
orphaned with `candidate_id NULL`.

## 4. Delivery monitoring

- **Backend**: `GET /api/email/monitoring?days=N` (authenticated;
  `emailTemplate.routes.js` / `emailTemplate.controller.js`) — summary counts
  (sent/failed from `rpa_email_log.status`; tracked/opened/replied/bounced from
  `rpa_email_tracking`), per-`email_type` breakdown, latest 20 failures with
  readable `error_message`, and poller status (flags, cron, delta-link present,
  `last_sync_at`).
- **Frontend**: new `components/email/DeliveryMonitoring.jsx`, rendered as the
  **"Email Delivery" tab on the Analytics page** (`/analytics`) — originally
  mounted on the Email Templates page, moved 2026-07-14 at RT's request since
  that page is template editing only — five stat tiles
  (Sent / Failed / Opened / Replied / Bounced; icon + label, color only as
  reinforcement), per-type table, recent-failures table (expandable rows show
  the full error), 7/30/90-day window selector, refresh. New
  `emailTemplateService.getEmailMonitoring(days)`.

## 5. First automated tests

`src/tests/emailHelpers.test.js` (node's built-in runner; new script
`npm run test:unit` — the ESM project can't run Jest without extra config, so
the existing jest script is untouched). 14 tests over the pure helpers:
`describeEmailError`, `compileTemplate` (placeholder styles + aliases),
`injectTrackingPixel`, `normalizeMessage` (bounce detection), `isAdminSender`.

## 6. Verification performed

- `npm run test:unit` → **14/14 pass**.
- Live delta poller (`src/scratch/verify_delta_poller.js`, inbound-sync only so
  no resumes hit the parse pipeline): first tick did a 24h initial sync
  (16 changes, 6 external messages recorded), stored the delta link; second
  tick consumed the link with **zero duplicates**.
- Monitoring endpoint: mock-request shape check returned real data
  (30d: 458 sent / 1 failed / 235 tracked, 15 types); over HTTP it returns
  **401 unauthenticated**; the public pixel stayed 200.
- Server boots clean with the consolidated poller (disabled-by-default message).
- Frontend `npm run build` passes.
- Regressions: Phase 1 (`verify_graph_id_capture.js`) and Phase 2
  (`verify_open_tracking_and_reply.js`) scripts all green.

## 7. Deploy checklist

1. Prod DB still needs the Phase 1 `ALTER TABLE rpa_email_log …` (see Phase 1 log).
2. Optional env: `MAILBOX_SYNC_CRON` (defaults to every 5 min; delta makes
   `*/1 * * * *` reasonable when near-real-time sync is wanted).
3. The old per-job crons (`EMAIL_INTAKE_CRON`, `INBOUND_SYNC_CRON`) no longer
   drive scheduling (the enable flags still do); they remain read only by the
   legacy manual paths.
4. First poller tick per environment does a 24h initial sync — expect a burst
   of (idempotent) inserts in `rpa_email_messages`.
5. Remaining/deferred: P5-B change-notification webhooks (only if sub-minute
   latency is ever required), P6.2 `rpa_outlook_accounts` registry redesign.
