# U08 · Zeko: optional phone page and expiry reminder (11 Nov 2026)

**Sheet:** Phase 3 UAT Fixes - Nov, U08. **Brief:** [U08](../Phase%204/uat-fixes/U08-zeko-phone-reminder.md).
**HR asked:** collect a phone from candidates who have none before their Zeko test, and remind them before the test window closes.

## What changed
- **Per-booking link.** DDL `2026-11-10-zeko-link-token.sql` adds `link_token` (uuid), `reminded_at` and `phone_captured_at` to `rpa_zeko_candidate_pipeline`. The Zeko invite email now links to `PUBLIC_BASE_URL/api/z/<token>`. If `PUBLIC_BASE_URL` is empty it links to the job's Zeko page, as before. Forms & Links copies the same link.
- **Public routes (`routes/zekoLink.routes.js`, rate-limited):**
  - `GET /api/z/:token` sends the candidate straight to Zeko when the window is open and we hold a phone, or have no CV to store one on.
  - Every other case goes to the `/zeko-start/:token` page: no phone, expired, cancelled, completed or a bad token.
  - `GET /info` returns only the state, first name, role, and the Zeko link while the window is open.
  - `POST /phone` checks the number is a 10-digit Indian mobile and saves it first in `ContactNumber` (U05 `prependUnique`). It drops the upload placeholder 9876543210 and sets `phone_captured_at`.
- **Page `/zeko-start/:token`:** "Add a phone number so our team can reach you (optional)", with **Continue to Zeko** and **Skip**. When the link is closed, the page explains why.
- **Reminder job `jobs/zekoExpiryReminder.js`:** hourly at :20 IST, behind `ZEKO_REMINDER_ENABLED` and `ZEKO_SYNC_ENABLED`.
  - It picks bookings closing within `zeko_reminder_lead_hours` (default 24). It skips windows no longer than the lead time, and journeys that are closed or paused.
  - It asks Zeko live and reminds only a candidate Zeko lists as `scheduled` or `notAttempted`.
  - It claims `reminded_at` before sending and releases the claim if nothing was sent. A reschedule clears `reminded_at`.
- **Template:** "Zeko Interview Reminder" (`services/zekoReminderTemplate.js`), seeded create-only by `prisma/seed-zeko-reminder-template.js`. It is seeded on staging as #58. New flow key `zekoReminder`.

## Tests
- **Unit:** `zekoLinkModel.test.js` 28/28 and `zekoAttemptChecker.test.js` 3/3 (both new). Full unit run: 1152/1152.
- **Integration (staging DB):** `zekoLink.test.js` 13/13. It covers the redirects, `/info`, phone save, cancelled and bad tokens, and the reminder's dry run, claim, release and fires-once behaviour. Send and the Zeko check were stubbed, so nothing was emailed.
- **Frontend:** `npm run build` passes. `playwright.u08.config.js` 6/6 (mocked API) at 1280 px and 375 px.
