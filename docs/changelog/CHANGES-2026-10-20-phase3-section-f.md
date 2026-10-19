# Phase 3 "Do Now", section F: developer logging & error tracing, system documentation and user guides

**Date:** 20 Oct 2026 · **Plan:** [PLAN-Phase3-Now.md](../Phase%203%20Enhancements%20or%20Feedback/PLAN-Phase3-Now.md) §F.
**Items:** N42, N43.

**Status:**
- **Built and tested locally:**
  - backend unit tests pass, including 19 new ones;
  - the frontend builds;
  - the local backend serves every request with a ref;
  - the user-guide screenshots were captured from staging data with every name, email and phone replaced.
- **On staging (20 Oct):**
  - the error-log table is applied (by Harish; checked read-only: columns, 3 indexes, both CHECKs);
  - the integration test passes 6/6;
  - a forced job failure sent exactly one alert for two failures, and stores and heartbeats correctly;
  - the four Super Admin endpoints were checked directly (Health all green).
- **Waiting:** the Logs & errors screens with a Super Admin login (none is available for testing), the Admin / Super Admin screenshots, and the review of the docs.
- **Not done:** nothing is deployed to staging and nothing is committed. Production goes once, at the end, with the other sections.

**Decisions (19 Oct):**
- Job-failure and crash alerts go to the existing developer list (`backendErrorAlert`) from every environment.
- HR sees the ref on server errors only.
- Errors are kept 30 days.
- Documentation: the developer set (Pankaj reviews), plus detailed guides for business users (HR, Admins, Super Admins).

---

## What changed, by item

### N42 · Developer logging & error tracing
**What users see**
- **HR / RT / vendors:** a server error now reads "Something went wrong. Please try again later. **(ref: K7Q2MX)**". Validation messages ("Email is required") are unchanged.
- **Super Admins:** a new **Logs & errors** tab in the admin portal:
  - **Errors** (grouped, with count, users, environment and latest ref; expand for each occurrence);
  - **Find a ref** (the stored error plus every log line of that request, outside calls included);
  - **Jobs** (last run / success / failure of every scheduled job);
  - **Health** (database, Redis, upload queue, Microsoft login).
- **Developers:**
  - an alert email when a scheduled job fails (at most hourly per job and error) or the backend crashes;
  - the existing 5xx alert now carries the ref.

**How**
- **Request ref:** `middleware/requestContext.js` (AsyncLocalStorage), mounted first in `app.js`.
  - It accepts a sane incoming `x-request-id` and returns `x-request-id` (exposed through CORS).
  - `authenticate` adds the user.
  - Error bodies carry `ref`.
  - The morgan line ends `ref=XXXXXX`.
  - The frontend `api.js` appends " (ref: X)" to the message for status 500 and above, so every screen shows it with no per-screen change.
- **Logger** (`config/logger.js`):
  - every line gets `requestId` / `userId`;
  - emails and Indian mobiles / `+` numbers are masked in messages and meta (`utils/logMask.js`);
  - `combined.log` always keeps at least `http` level (request and outside-call lines), so "Find a ref" works in production; `LOG_LEVEL` now sets the console level, including in production (default `info`, unchanged).
- **Outside calls:** `utils/externalCall.js`.
  - `tracedFetch(service, url, opts)` replaces `fetch` in the Graph (mail, OneDrive, calendar, attendance, recordings, inbox), Zeko, Cohere, OpenRouter, Turnstile and n8n call sites.
  - `logExternal` wraps the Gemini SDK calls (generate and embed).
  - Each logs the method, host, templated path (ids replaced, query dropped), status and duration; never bodies or headers.
- **Error store:**
  - DDL `2026-10-20-error-log.sql` (+ rollback): table `rpa_error_log`, one row per occurrence, with a fingerprint for grouping.
  - `services/errorLog.service.js#recordError` never throws.
  - Written by the error handler (5xx), the job runner, the crash handlers, the resume worker's `failed` event and `POST /api/errors`.
- **Jobs:** `utils/jobRunner.js#runJob(name, fn)`. All 12 cron callbacks started by `server.js` use it.
  - It gives each run a ref (`job-<name>-XXXXXX`), stores the failure, alerts and writes a heartbeat (`rpa_settings` key `job_heartbeat.<env>.<job>`).
  - Run-level catches that used to swallow errors now rethrow to it (`sendPendingReminders`, `runMailboxPoll`, `runOfferSweep`, `runMrfAuditRetentionSweep`).
  - Per-item catches are unchanged.
- **Crashes:** `uncaughtException` / `unhandledRejection` now log the stack (the rejection handler lost it), store the error and send an alert, all capped at 3 s, then exit.
- **Alerts:**
  - the throttle moved to `utils/alertThrottle.js`: per signature, pruned (the old map was never cleared);
  - 5 minutes for 5xx and crashes, **1 hour for job failures**;
  - `sendOpsAlert` in `emailNotification.service.js` (email types `job_failure_alert`, `crash_alert`).
- **Browser errors:** `frontend/src/services/errorReporter.js`.
  - It captures `window.onerror`, unhandled rejections, ErrorBoundary crashes, and API failures the server never logged (a 5xx with no ref, i.e. a proxy error, or a timeout).
  - Query strings are stripped, repeats within a minute are dropped, at most 20 reports go per page load, and it uses `fetch` rather than axios, so it can't trigger the 401 redirect.
  - `POST /api/errors` requires a login, allows 30 reports per 5 minutes per user, keeps whitelisted fields only and always answers 204.
- **Admin endpoints** (superadmin only): `GET /api/admin/errors`, `/api/admin/logs?ref=` (bounded scan: 6 files, 500 lines, 5 s), `/api/admin/jobs`, `/api/admin/health/deep` (503 if a check fails). The plain `/api/health` is unchanged.
- **Retention:** `jobs/errorLogRetentionSweep.js`, daily at 02:45 IST, deletes rows older than 30 days in batches.

**Different from the plan**
- **Job alerts are throttled hourly, not every 5 minutes.** The mailbox poller and the Zeko results job run every 5 minutes, so a 5-minute throttle would send an email on every tick of an outage.
- **The Logs page is a tab** in the existing admin portal (`/admin/dashboard` → Logs & errors), not a separate `/admin/logs` route. The portal is one tabbed page.
- **The deep health check** is `GET /api/admin/health/deep` (behind the admin login) rather than `/api/health?deep=1`.
- **More outside calls are traced:** besides the planned Graph mail, OneDrive, Zeko, AI and Cohere, also Graph calendar / attendance / recordings / inbox, Turnstile and the n8n webhook.

### N43 · System documentation & development history, plus user guides
**What users see**
- **Developers:** [`docs/system/`](../system/README.md), eight pages:
  - overview, module guide, data model and DDL process, jobs and integrations, configuration (all 100+ env vars and `rpa_settings` keys);
  - the **operations runbook** (Logs & errors, deploy / rollback, known failures, weekly checks);
  - the **development history January–October 2026**;
  - onboarding.

  Plus a root `README.md`.
- **Business users:** [`docs/user-guides/`](../user-guides/README.md):
  - a **Recruiter & HR guide** (every screen, task by task, with screenshots), an **Admin guide**, a **Super Admin guide**, a **Vendor guide**, and a page for **people who only receive emails** (hiring managers, approvers, interviewers);
  - a glossary of stages and card labels.

**How**
- Facts were checked against the code (routes, config, schema, jobs) and the running app.
- History before June comes from the workbook's hidden sheets (read only); from June it comes from git and the changelogs.
- **Screenshots:** `frontend/e2e/user-guide-screenshots.spec.js` (view-only) with `e2e/helpers/maskData.js`.
  - Every API response is rewritten in the browser before the page draws it: names, emails and phone numbers become sample values, consistently within a run.
  - It runs as the E2E recruiter on staging data; the images are JPEG in `docs/user-guides/images/`.
- **Outdated reference docs** got a "Superseded" note: `BACKEND.md`, `FRONTEND.md`, `MODULES.md`, `screening.md`, `Email-Templates-Summary.md`.
- **Corrected along the way:**
  - `ROLE_RULES.md` said recruiters and vendors can't change their own password; they can, since 10 Jul;
  - `Screening-Rules-for-RT.md` listed the old "Added within" choices.
- **Release step 8** in the plan now includes updating the user guides and screenshots.

**Found while documenting (not fixed here)**
- The `npm run zeko:*` scripts point at `scratch/run_zeko_sync.js`, which is not in the repo. The runbook gives a working one-line alternative.

---

## Tests
**Unit (backend), run one file at a time:**
- `src/tests/unit/developerLogging.test.js`: **20/20**. Covers:
  - the ref survives await, timers and overlapping requests; the middleware;
  - masking (emails, mobiles; ids, epochs and dates untouched; nested meta; errors);
  - path templating, `routeShape`; fingerprint grouping;
  - the throttle (per signature, hourly for jobs, pruning);
  - `runJob` (success heartbeat, a failure stored once and alerted once, `alert:false`, the signature ignores ids);
  - `tracedFetch` / `logExternal` (failures logged with the ref; no secrets, bodies or query strings).
- All 42 existing unit files pass (no regressions from the job and service edits).

**Lint and build:**
- `no-undef` lint on every changed backend and frontend file: no errors.
- `node --check` on every changed backend file.
- Frontend `vite build` passes.

**Local backend, live:**
- `GET /api/health` returns `x-request-id`;
- the request line in `combined.log` ends `ref=…` and carries `requestId`.

**Screens (Playwright, view-only, staging data):**
- `user-guide-screenshots.spec.js`: **12/12**;
- leak scan of every captured page's text: no real names, emails or phone numbers;
- the error illustration confirms the front end shows "(ref: K7Q2MX)" on a 500.

**Docs:**
- link check: 16 files, every relative link, image and anchor resolves;
- no real email address or phone number in the new docs.

**On staging, after the DDL (20 Oct):**
- **Integration** `src/tests/integration/errorTrail.test.js` (`NODE_ENV=staging`, via `run-block.mjs`): **6/6**. It sends no email and cleans up by its own refs. It covers:
  - `x-request-id` plus `ref` in the body (validation text unchanged);
  - an error stored by ref, masked (email, phone, stack), with route and user, and only whitelisted meta;
  - grouping (3 occurrences, 1 group);
  - retention keeps fresh rows;
  - "Find a ref" finds a log line by its ref;
  - junk refs are refused.
- **Forced job failure** (scratch script, job `n42ManualCheck`):
  - two failures sent **one** alert ("Job failed: n42ManualCheck [development]", 2 recipients);
  - a second run with alerts off stored 2 rows under `job:n42ManualCheck`, and the heartbeat shows the last failure and its ref;
  - the test rows were deleted afterwards (the email-log row stays).
- **Super Admin endpoints**, called directly (no Super Admin login exists for testing):
  - Health 200 (database, Redis, queue, Microsoft login all OK);
  - Jobs lists the heartbeats;
  - Errors 200;
  - a junk ref gets 400 "Enter a reference such as K7Q2MX.";
  - an unknown ref scans 6 log files and finds nothing.

**Fixed during staging testing:**
- **Stored routes were mangled.** `templatePath` treated the error handler's `GET /api/…` and the labels `job:…` / `process:…` as one path segment and stored `:id`. Grouping by route was therefore wrong for backend and job errors. New `routeShape()` in `errorLog.service.js` keeps labels, keeps the method and templates only the path. Unit test added (now **20/20**).
- **A Redis connection that is still opening** made the health check report Redis down. It now waits up to 3 s for the connection.

**Still to do:**
- **Super Admin screens:** the Logs & errors tabs in the browser, and the Admin and Super Admin screenshots for those guides. These need a Super Admin login.
- **Dry runs:**
  - Pankaj: onboarding, one simulated incident, five "where is X" questions;
  - an RT recruiter: three tasks from the recruiter guide.

## Release steps (collected for the single production release)
1. DDL `backend/prisma/ddl/2026-10-20-error-log.sql` on production (staging done 20 Oct), then `npm run prisma:generate`.
2. Confirm the production `rpa_settings` `email_recipients.backendErrorAlert.*` (or the code default) is the developer list.
3. Deploy backend and frontend (nothing else to configure; no new env variable).
4. After deploy: open Logs & errors → Health (all green) and Jobs (rows appear as each job runs).
5. Export the user guides to PDF and share them with RT and the admins.
