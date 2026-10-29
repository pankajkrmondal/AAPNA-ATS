# 04 · Scheduled jobs & integrations

**For:** developers and whoever is on call. **Checked against the code:** 20 Oct 2026.

## 1. Scheduled jobs

All jobs run **inside the API process** (`backend/src/server.js` starts them), with `node-cron`. Each run goes through `runJob(name, fn)` (`utils/jobRunner.js`), which gives it a ref (`job-<name>-XXXXXX`), times it, stores a failure in `rpa_error_log`, alerts the developers (at most hourly per job and error), and writes a heartbeat to `rpa_settings` (`job_heartbeat.<env>.<name>`). Super Admin → Logs & errors → **Jobs** shows the heartbeats.

| Job name (heartbeat) | Schedule (default) | Set by | What it does | If it fails |
|---|---|---|---|---|
| `sessionCleanup` | every 2 h | code | Deletes expired `rpa_sessions` rows | Expired sessions linger; harmless short term |
| `reminderScheduler` | `0 9 * * *` | `rpa_settings.reminder_cron_schedule` (Settings → Reminders) | Missing-details and shortlist follow-up reminders from `rpa_email_log` | Candidates are not chased that day |
| `interviewReminder` | every N min | Settings → Interview reminder (`interview_reminder_enabled`) | Reminder mails to candidate and panel before a booked round | Reminders missed |
| `interviewOccurrence` | every N min | Settings → Interview occurrence | After a round: Teams attendance check, or a "did it happen?" nudge; releases the scorecard link | Scorecards wait |
| `interviewRecordings` | every N min | `MS_RECORDING_FETCH_ENABLED` + Settings → Recording | Finds the Teams recording, archives it to OneDrive, flags missing recordings | Recordings not linked |
| `recordingRetention` | `30 3 * * *` | `MS_RECORDING_RETAIN_MONTHS` (0 = off) | Deletes archived video N months after the journey closes | Video kept longer than promised to candidates |
| `mailboxPoller` | `*/5 * * * *` | `MAILBOX_SYNC_CRON`; consumers gated by `EMAIL_INTAKE_ENABLED`, `INBOUND_SYNC_ENABLED` | One Graph delta fetch of the shared mailbox → resume intake (attachments) + inbound conversation sync | Emailed CVs and replies are not picked up; the delta link catches up on the next good run |
| `zekoToken` | `0 * * * *` (same tick, before `zekoJobs`) | `ZEKO_JOBS_CRON`, `ZEKO_SYNC_ENABLED` | Mints a new Zeko bearer token (`rpa_zeko_auth_token`) when the stored one has under 10 min left | Nothing visible at first: schedule/cancel mint their own token. A failure means the API key or client id is wrong, and scheduling will fail too |
| `zekoJobs` | `0 * * * *` | `ZEKO_JOBS_CRON`, `ZEKO_SYNC_ENABLED` | Syncs the Zeko job catalog (OTP cookie) | Scheduling dropdown goes stale |
| `zekoResults` | `*/5 * * * *` | `ZEKO_RESULTS_CRON`, `ZEKO_SYNC_ENABLED` | Fetches scores and report links for finished Zeko interviews | Scores don't arrive |
| `assessmentDeadline` | `0 * * * *` | `ASSESSMENT_DEADLINE_CHECK_CRON` | Marks overdue Evalground invites, notifies recruiters | "Test overdue" not shown |
| `offerSweep` | `0 7 * * *` | `OFFER_SWEEP_CRON`, `OFFER_AUTO_CLOSE_AFTER_DAYS` (90) | Auto-closes Joined journeys after 90 days (the approval nudge is disabled since 25 Aug) | Records stay open |
| `documentReminder` | `0 9 * * *` | `DOCUMENT_REMINDER_*` | Chases candidates with outstanding documents (after 2 days, every 24 h, max 3) | Candidates not chased |
| `mrfAuditRetention` | `30 2 * * *` IST | `mrf_audit_client_data_retention_days` (365) | Masks approvers' IP/device after the retention period | Personal data kept longer |
| `errorLogRetention` | `45 2 * * *` IST | code (30 days) | Deletes `rpa_error_log` rows older than 30 days | Table grows |
| `resumeWorker` (queue) | on demand | `USE_RESUME_QUEUE=true` | Parses uploaded files from the BullMQ queue in a separate process | Uploads stay queued; each failed attempt is in Logs & errors |

Not scheduled: `jobs/emailResumeIntake.js` and `jobs/inboundEmailSync.js` keep their logic, but `mailboxPoller` replaced their timers.

**One API process per database.** A local backend runs these same jobs against the staging database (see 01 §3). Heartbeats are keyed by environment, so the Jobs panel shows `development` and `staging` rows separately.

**Manual runs:** `node scripts/run-reminders-once.mjs`; Zeko: `NODE_ENV=staging node -e "import('./src/services/zeko.service.js').then(m => m.fetchInterviewResults()).finally(() => process.exit(0))"` (or `syncZekoJobs`). The `npm run zeko:*` scripts in `package.json` point at `scratch/run_zeko_sync.js`, which is not in the repo. Several jobs export their pass function (`runDocumentReminders`, `runOfferSweep`, `runMrfAuditRetentionSweep`, `runErrorLogRetentionSweep`) for tests and one-off runs.

## 2. Integrations

### Microsoft Graph (one app registration)
- **Token:** client credentials, cached in memory (`onedrive.service.js#getAccessToken`). The deep health check calls it.
- **Mail:** sent from `MS_DEFAULT_SENDER_EMAIL` (production: the AAPNA Recruitment shared mailbox). The draft → send path keeps Graph ids for threading, with a fallback to plain `sendMail` if `Mail.ReadWrite` is missing; network errors retry 3 times. Non-production redirect: `config/emailRecipients.js`.
- **Inbox:** delta query on the same mailbox (`outlookReader.service.js`), cursor stored in `rpa_settings`.
- **Calendar / Teams:** `MS_CALENDAR_ENABLED` (needs `Calendars.ReadWrite`, `OnlineMeetings.ReadWrite`). Attendance: `MS_ATTENDANCE_ENABLED` (needs `OnlineMeetingArtifact.Read.All` plus an application access policy; script `docs/phase3/enable-teams-attendance.ps1`). Recordings: `MS_RECORDING_FETCH_ENABLED` (`OnlineMeetingRecording.Read.All`).
- **OneDrive:** resumes, JDs, documents and archived recordings, under `MS_ONEDRIVE_PARENT_ID` (different per environment).
- **Limits & failures:** throttling returns 429/503; a missing permission returns 403 and the feature falls back (no calendar event, a manual "did it happen?"). Setup for IT: `docs/deployment/MS-GRAPH-PRODUCTION-SETUP.md`, `docs/phase3/MS-GRAPH-SETUP-FOR-IT.md`.

### Zeko
- **Auth:** an API-key token grant (`ZEKO_CLIENT_ID`, `ZEKO_API_KEY`; `rpa_zeko_auth_token`) for scheduling, plus a dashboard **cookie** minted by OTP login (`rpa_zeko_auth_cookie`). The OTP email arrives in the shared mailbox and is read back through Graph, which can take 30–40 s.
  - The bearer token lasts 1 hour. Schedule and cancel get it through `withZekoToken()` (`zeko.service.js`), which mints a new one when the stored token has under 10 minutes left. If Zeko refuses a stored token, it mints a new one and retries once. Zeko answers a bad or revoked token with **HTTP 500**, not 401; 401 means only that the header is missing. The `zekoToken` job keeps one ready.
  - Since 29 Oct 2026 the n8n workflow "Zeko — FULLY AUTO Sync (API Key Auth)" is no longer needed. See `docs/phase3/zeko-token-without-n8n/PLAN.md`.
  - Local dev needs `ZEKO_CLIENT_ID` and `ZEKO_API_KEY` (staging values) to schedule.
- **Scores:** read from the per-candidate report API (`ZEKO_REPORT_API_BASE`), not the old results endpoint. See `docs/PLAN-2026-08-25-zeko-report-api-score-sync.md`.
- **Outside production:** `ZEKO_TEST_PHONE` replaces the candidate's phone, since Zeko texts that number itself.
- **Failures:** an expired cookie re-runs the OTP login; if the mailbox poll is down, the login fails too. If no bearer token can be minted, schedule/cancel answer 503 "Could not sign in to the Zeko interview platform…" and change nothing. Only published jobs are offered for scheduling.

### Evalground
- No API (a paid add-on that was not bought). HR uploads the CSV export; rows are matched by any of the candidate's emails (`utils/evalgroundRow.js`); the pass mark is configurable (Settings → Assessment automation).

### AI: OpenRouter, Gemini, Cohere
- **Parsing and summaries:** `generateContentWithFallback` (`utils/geminiHelper.js`) tries OpenRouter (`OPENROUTER_MODEL`, default `openai/gpt-4.1-nano`, 120 s timeout) and then Gemini models, each 3 times with backoff on 429/503/quota.
- **Embeddings:** Gemini `gemini-embedding-001` into `rpa_cv_vectors` (3 attempts).
- **Rerank:** Cohere `rerank-v3.5`, in batches. A failure mails `rerankApiAlert` (internal).
- **429s:** see `docs/RATE_LIMIT_429_FIX.md` for our own API limiter (a different 429).

### Cloudflare Turnstile
- Login bot check. An empty `TURNSTILE_SECRET_KEY` disables it (local). The frontend needs `VITE_TURNSTILE_SITE_KEY`.

### n8n (legacy)
- `N8N_WEBHOOK_URL_PREFIX`, when set, triggers the old merge webhook after an HR upload (best effort). Empty everywhere it is not needed.
