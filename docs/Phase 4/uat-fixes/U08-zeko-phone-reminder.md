# U08 · Zeko: optional phone page and expiry reminder
**Release 2 · Medium · ~11 h · Depends on: the U05 Handoff (`prependUnique`)**

**Goal**
- **Today:** the Zeko step has no phone field, and there is no reminder before a Zeko test expires.
- **Change:**
  - When the candidate clicks the Zeko link in our email and we have no phone for them, an **optional** page asks for one. **Skip** goes straight to Zeko.
  - A reminder goes out before the Zeko window closes.
- **Done when:**
  - with no phone, the link opens the page and Skip reaches Zeko
  - with a phone, the link goes straight to Zeko
  - the reminder fires once, and only if the candidate hasn't attempted the test

**Out of scope:** WhatsApp (P04).

## Current state (verified)
**Our link isn't per candidate.**
- Our email links to `${config.zeko.interviewLinkBase}/${job.slug}` (`backend/src/services/screening.service.js:2957`; default base at `backend/src/config/index.js:349`). That is the **job's** link, the same for every candidate.
- There are no tracked redirects in the app. The only tracking is the open pixel (`backend/src/controllers/tracking.controller.js:18-47`).
- Zeko also sends its own invite, via the schedule API at `screening.service.js:2858-2893`. Leave that unchanged.

**What the Zeko table holds.** `rpa_zeko_candidate_pipeline` (`backend/prisma/schema.prisma:679-700`):
- `link_sent_at`
- `interview_end_at`, which is the expiry
- `completed_at`, `cancelled_at`, `status` (`pending|sent|completed|cancelled`)
- **no** `reminded_at`, and no token

**Completion is only known after expiry.** Results are fetched only after the window closes (`backend/src/services/zeko.service.js:1021-1052`). A reminder therefore needs a live check: `fetchInterviewResponses` plus `attemptStatus` against `ZEKO_NO_RESULT_STATUSES` (`:806, :1125`).

**Code to copy from**
- **Public no-login pages:** `ForceLight` + `PublicPageShell` (`frontend/src/App.jsx:343-354`).
- **A rate-limited public backend route:** `backend/src/routes/recordingShare.routes.js:24`.
- **Reminder jobs:**
  - `backend/src/jobs/interviewReminder.js` (`*_reminded_at`, `rpa_settings`, `:12-76`)
  - `backend/src/jobs/assessmentDeadlineChecker.js` (fires once, `:54-136`)
  - `runJob` (`backend/src/utils/jobRunner.js:51-106`); jobs are registered in `backend/src/server.js:8-98`
- **Phone helpers** (`backend/src/utils/phone.js`): `firstValidPhone`, `toIndianE164`, `maskPhone`.

## Changes
1. **DDL:** `backend/prisma/ddl/2026-11-DD-zeko-link-token.sql`, plus a `.rollback.sql`. Add to `rpa_zeko_candidate_pipeline`:
   - `link_token uuid UNIQUE DEFAULT gen_random_uuid()`
   - `reminded_at timestamptz`
   - `phone_captured_at timestamptz`

   Update `schema.prisma` and run `npx prisma generate`.
2. **Link:** our Zeko email uses `${PUBLIC_BASE_URL}/api/z/<link_token>`. The public, rate-limited router `backend/src/routes/zekoLink.routes.js` handles:
   - `GET /api/z/:token`:
     - valid phone (`firstValidPhone`): 302 to the Zeko job URL
     - no phone: 302 to the frontend `/zeko-start/:token`
     - expired or cancelled: a friendly message
   - `GET /api/z/:token/info`: candidate first name and role, for the page. No personal data beyond that.
   - `POST /api/z/:token/phone`: validate the number, save it with `prependUnique` (from U05), set `phone_captured_at`, return the Zeko URL.
3. **Page:** `frontend/src/pages/ZekoStart.jsx` at the public route `/zeko-start/:token`, wrapped in `ForceLight` + `PublicPageShell`.
   - Copy: "Add a phone number so our team can reach you (optional)".
   - **[Continue to Zeko]** saves the number, then redirects. **[Skip]** redirects without saving.
4. **Reminder job:** `backend/src/jobs/zekoExpiryReminder.js`, hourly, `{ timezone: 'Asia/Kolkata' }`, wrapped in `runJob`.
   - It picks `status='sent' AND reminded_at IS NULL AND interview_end_at BETWEEN now() AND now() + lead`. The lead time is `rpa_settings` `zeko_reminder_lead_hours`, default 24.
   - It skips a row when the window was shorter than the lead time.
   - Before sending, it runs the live Zeko attempt check. If not attempted, it sends the "Zeko Interview Reminder" email with the same `/api/z/` link, then sets `reminded_at`.
   - The template is seeded **create-only**, like `backend/prisma/seed-interview-email-templates.js`.
   - The job runs only when `ZEKO_REMINDER_ENABLED=true` and `ZEKO_SYNC_ENABLED` is on. Document both in `docs/system/05-CONFIGURATION.md`.

## Tests
- **Unit:** the redirect decision (phone, no phone, expired) and reminder eligibility (too short, attempted, already reminded).
- **Integration (staging):** `GET /api/z/:token`, then `POST /phone`. Do a dry run of the job against our own test candidate.
- `cd frontend && npm run build`, plus a browser check of `/zeko-start`, including at phone width.

## Handoff
**Status:** built and tested. Write-up: [CHANGES-2026-11-11-U08](../../changelog/CHANGES-2026-11-11-U08-zeko-phone-reminder.md). DDL `2026-11-10-zeko-link-token.sql` is applied on staging, `prisma generate` has been run, and the template is seeded on staging (#58).

**Files:**
- New backend: `utils/zekoLinkModel.js` (pure rules), `services/zekoLink.service.js`, `controllers/zekoLink.controller.js`, `routes/zekoLink.routes.js` (mounted at `/api/z`), `middleware/zekoLinkRateLimit.js`, `jobs/zekoExpiryReminder.js`, `services/zekoReminderTemplate.js` and `prisma/seed-zeko-reminder-template.js`.
- Changed backend: `screening.service.js` (`scheduleInterview`), `formsLinks.service.js` (zeko finder), `zeko.service.js`, `config/index.js` (`zeko.reminder.enabled`), `config/emailRecipients.js` (`zekoReminder`) and `server.js`.
- Frontend: `pages/ZekoStart.jsx`, `services/zekoLinkService.js`, `App.jsx`, `services/api.js`, `playwright.u08.config.js` and `e2e/u08-zeko-start.spec.js`.

**Helpers:**
- `zekoCandidateLink({ token, slug, publicBaseUrl, interviewLinkBase })` returns the tracked URL, or else the job's Zeko URL.
- `usablePhone(contactNumber)` and `parseCandidatePhone(input)` return 10 digits or null; the placeholder counts as none.
- `createZekoAttemptChecker()` (zeko.service) returns `({ jobId, interviewId, candidateEmail }) → { found, attemptStatus }`.
- `sendZekoExpiryReminders({ dryRun, rowIds, now, deps })` is the job's single pass.

**Tests:** unit 28/28 + 3/3 (new), full unit run 1152/1152; staging integration `zekoLink.test.js` 13/13; frontend build passes; Playwright 6/6 at 1280 px and 375 px.

**Where this differs from the brief:** the attempt checker's caching sits in the model (`createAttemptChecker`), so it can be unit-tested; a unit test that imports `zeko.service.js` never exits. When Zeko says the candidate has already attempted, the claim is released and the next hourly run checks again, so `reminded_at` is only set when an email went out.

**Left over (R2 UAT):**
- Staging has no open Zeko booking, so the live dry run was not done. Book our test candidate on staging, then run `sendZekoExpiryReminders({ dryRun: true, rowIds: [<id>] })`.
- Set `ZEKO_REMINDER_ENABLED=true` in the staging server's env; it is off everywhere until then. `PUBLIC_BASE_URL` is set in all three local env files, so the tracked link goes live once the code is deployed.
- A real Zeko invite was not sent, so the `/api/z/` link in a real email has not been clicked through end to end.
