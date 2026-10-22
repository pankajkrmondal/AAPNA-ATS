# 05 · Configuration

**For:** developers and whoever deploys. **Checked against** `backend/src/config/index.js` on 20 Oct 2026.

Configuration comes from three places:
1. **Environment variables**: backend `.env.<NODE_ENV>` (then `.env` for anything missing), read once at start in `backend/src/config/index.js` through `env(key, default, required)`; frontend `VITE_*` at build time.
2. **`rpa_settings`**, the key/value table, changed from the Settings screens without a deploy.
3. **Code defaults** for email routing (`backend/src/config/emailRecipients.js`), overlaid by `rpa_settings` at boot.

This page lists names and purposes only. **Values and secrets are never written in docs or commits.** The real files are `backend/.env.development`, `.env.staging`, `.env.production` (on each server). There is no `.env.example` for the backend: copy an existing file from a teammate, never from chat.

---

## 1. Backend environment variables

Defaults shown are the code defaults. **R** = required (the server refuses to start without it).

### Core
| Variable | Default | Purpose |
|---|---|---|
| `NODE_ENV` | `development` | `development` / `staging` / `production`. Picks the env file; production turns off the mail redirect; only `development` returns verbose errors |
| `PORT` | `5000` | API port |
| `DATABASE_URL` **R** | — | PostgreSQL connection (staging DB for local and staging) |
| `JWT_SECRET` **R**, `JWT_EXPIRES_IN` (`24h`), `JWT_REFRESH_EXPIRES_IN` (`7d`) | — | Login tokens (sessions must also exist in `rpa_sessions`) |
| `FRONTEND_URL` | `http://localhost:5173` | CORS origin |
| `PUBLIC_BASE_URL` | empty | This backend's public URL, for the email open-tracking pixel; empty = no pixel |
| `TRUST_PROXY` | `false` | `true` behind nginx, so rate limits key on the real client IP |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` | `localhost` / `6379` / — | Cache, queue, socket bridge |
| `USE_RESUME_QUEUE` | off | `true` = uploads go to the BullMQ queue and the separate worker process |
| `UPLOAD_MAX_SIZE` (`50mb`), `UPLOAD_DIR` (`./uploads`) | | Request body / upload limits |
| `LOG_LEVEL` | `debug` (prod console `info`) | Console level. `combined.log` always keeps at least `http` (request and outside-call lines) for "Find a ref" |
| `LOG_DIR` | `backend/logs` | Log files |
| `UPLOAD_JOB_STALE_MINUTES`, `EXPORT_TZ` | | Upload-job staleness; time zone for CSV exports |

### Microsoft Graph
| Variable | Default | Purpose |
|---|---|---|
| `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT_ID` | — | App registration (client credentials) |
| `MS_REDIRECT_URI` | — | Read into config but not used (left from the OAuth design) |
| `MS_DEFAULT_SENDER_EMAIL` | a developer mailbox | Sending and polled mailbox (staging vs the production recruitment mailbox) |
| `MS_ONEDRIVE_PARENT_ID` | — | OneDrive folder for files; **different per environment** |
| `MS_CALENDAR_ENABLED`, `MS_CALENDAR_MAILBOX` | `false`, sender | Outlook events + Teams links for interviews |
| `MS_ATTENDANCE_ENABLED`, `MS_ATTENDANCE_MIN_SECONDS` (60), `MS_ATTENDANCE_GUEST_CANDIDATE` (`true`) | `false` | Teams attendance to decide "did it happen?" |
| `MS_MEETING_RECORD_AUTO`, `MS_MEETING_PRESENTERS` (`organization`), `MS_MEETING_TRANSCRIBE` (`true`), `MS_RECORDED_STAGES` | `false` | Automatic recording of interview rounds |
| `MS_RECORDING_FETCH_ENABLED`, `MS_RECORDING_ARCHIVE_ENABLED`, `MS_RECORDING_ARCHIVE_FOLDER`, `MS_RECORDING_RETAIN_MONTHS` (12) | `false` | Find, archive and expire recordings |

### Email
| Variable | Default | Purpose |
|---|---|---|
| `EMAIL_REDIRECT_TO_TEST` | unset | `true`/`false` overrides the redirect; unset = redirect unless production |
| `EMAIL_STAGING_RECIPIENTS` | the two developer inboxes | Where redirected mail goes |
| `EMAIL_RESUME_ERROR_RECIPIENTS` | empty | Overrides the "Resume Processing Failed" alert recipients |
| `EMAIL_INTAKE_ENABLED`, `EMAIL_INTAKE_CRON` | `false` | Resume intake from the mailbox |
| `INBOUND_SYNC_ENABLED`, `INBOUND_SYNC_CRON` | `false` | Inbound conversation sync |
| `MAILBOX_SYNC_CRON` | `*/5 * * * *` | The consolidated mailbox poller |

### AI and search
| Variable | Default | Purpose |
|---|---|---|
| `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`, `OPENROUTER_MODEL` (`openai/gpt-4.1-nano`) | | Primary AI for parsing and summaries |
| `GEMINI_API_KEY`, `GEMINI_MODEL` (`gemini-2.5-flash`) | | Fallback AI; embeddings |
| `COHERE_API_KEY`, `COHERE_BASE_URL`, `COHERE_MODEL` (`rerank-v3.5`) | | Reranking |
| `SCREENING_V2` | `false` | Strict keyword / JD filtering (section A). Stays off in production until RT signs off the before/after check (N11) |

### Zeko
| Variable | Purpose |
|---|---|
| `ZEKO_API_URL`, `ZEKO_API_KEY`, `ZEKO_CLIENT_ID`, `ZEKO_COMPANY_ID` | Credentials (different per environment) |
| `ZEKO_SCHEDULE_API_BASE`, `ZEKO_DASHBOARD_API_BASE`, `ZEKO_LOGIN_API_BASE`, `ZEKO_REPORT_API_BASE` | API bases |
| `ZEKO_INTERVIEW_LINK_BASE`, `ZEKO_REPORT_LINK_BASE`, `ZEKO_SHARED_REPORT_LINK_BASE`, `ZEKO_SHARE_LINK_TIMEOUT_MS` | Links to candidate interview, recruiter report and public report |
| `ZEKO_LOGIN_EMAIL` | Account for the OTP login (defaults to the sender mailbox) |
| `ZEKO_SYNC_ENABLED`, `ZEKO_JOBS_CRON` (hourly), `ZEKO_RESULTS_CRON` (5 min) | Background sync |
| `ZEKO_TEST_PHONE` | Phone sent to Zeko outside production (Zeko sends SMS itself) |

### Pipeline, documents, offers, assessments
| Variable | Default | Purpose |
|---|---|---|
| `FLEXIBLE_STAGES_ENABLED` | `false` | Move a candidate to any stage not yet passed; drag and drop |
| `ASSESSMENT_DEADLINE_CHECK_CRON` | hourly | Overdue Evalground invites |
| `DOCUMENT_REMINDER_CRON` / `_AFTER_DAYS` / `_REPEAT_HOURS` / `_MAX_COUNT` | `0 9 * * *` / 2 / 24 / 3 | Document chasing |
| `OFFER_SWEEP_CRON`, `OFFER_AUTO_CLOSE_AFTER_DAYS` | `0 7 * * *`, 90 | Post-joining auto-close |
| `MRF_APPROVAL_AUDIT_ENABLED`, `MRF_APPROVAL_TOKEN_DAYS` (14), `MRF_APPROVAL_RATE_WINDOW_MS`, `MRF_APPROVAL_RATE_MAX` | `true` | Per-approver links and audit |

### Dossier, exports, limits
| Variable | Default | Purpose |
|---|---|---|
| `DOSSIER_DELETION_DAYS` (30), `DOSSIER_ASSERT_REDACTION` (`true`), `DOSSIER_MAX_ATTACHMENT_BYTES`, `DOSSIER_MAX_PACK_BYTES`, `DOSSIER_WARN_PACK_BYTES`, `DOSSIER_ATTACHMENT_TIMEOUT_MS`, `DOSSIER_ATTACHMENT_BUDGET_MS`, `DOSSIER_ZEKO_LINK_BUDGET_MS` | | Candidate dossier |
| `DOSSIER_SHARE_LINK_DAYS` (14), `DOSSIER_SHARE_RATE_WINDOW_MS`, `DOSSIER_SHARE_RATE_MAX`, `DOSSIER_SHARE_STREAM_RATE_MAX` | | Recording share links |
| `EXPORT_MAX_ROWS` (25000), `EXPORT_RATE_WINDOW_MS`, `EXPORT_RATE_MAX` (20 per user) | | CSV exports |
| `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX` (2000), `RATE_LIMIT_AUTH_WINDOW_MS`, `RATE_LIMIT_AUTH_MAX` (20) | | API limits; normally left commented out |
| `TURNSTILE_SECRET_KEY` | empty = off | Login captcha |
| `N8N_WEBHOOK_URL_PREFIX` | empty | Legacy n8n merge webhook |

### Frontend (`frontend/.env.<mode>`, build time)
| Variable | Purpose |
|---|---|
| `VITE_API_URL` | Backend origin for staging/production builds. Unset in development, where Vite proxies `/api` to `localhost:5000` |
| `VITE_TURNSTILE_SITE_KEY` | Public captcha key |

## 2. `rpa_settings` keys

Changed from the Settings screens (or by the system itself). Read with `prisma.rpa_settings.findUnique({ where: { key } })`; written with `upsert`.

| Key | Set from | Used by |
|---|---|---|
| `reminder_cron_schedule`, `reminder_interval_days`, `reminder_max_count` | Settings → Reminders | `jobs/reminderScheduler.js` |
| `interview_reminder_enabled`, `interview_reminder_interval_min`, `interview_reminder_lead_min` | Settings → Interview reminder | `jobs/interviewReminder.js` |
| `interview_occurrence_enabled`, `interview_occurrence_interval_min`, `interview_occurrence_grace_min` | Settings → Interview occurrence | `jobs/interviewOccurrence.js` |
| `interview_recording_enabled`, `interview_recording_interval_min`, `interview_recording_grace_min` | Settings → Recording | `jobs/interviewRecordings.js` |
| `interview_optional_attendees` | Settings → Optional attendees | `interviewOptionalAttendees.service.js` |
| `assessment_deadline_days`, `assessment_auto_advance_enabled` | Settings → Assessment automation | `assessmentSettings.service.js` |
| `email_recipients.<flow>.to` / `.cc` | Settings → Flow recipients (`/settings/flow-keys`); seeded by `prisma/seed-email-recipients.js` | `config/emailRecipients.js` |
| `mrf_approvers` | DB only: JSON array of `{email, name}`; falls back to the `mrfApproval` recipients | `mrfApproval.service.js`, `utils/mrfApprovalRules.js` |
| `mrf_audit_client_data_retention_days` | DB only (default 365, minimum 30) | `jobs/mrfAuditRetentionSweep.js` |
| `company_profile_text` | Settings → Company profile | JD attachment section in emails (N17) |
| `mailbox_delta_link` | system | `jobs/mailboxPoller.js` (delete it to force a 24 h re-sync) |
| `email_intake_last_sync`, `inbound_sync_last_sync` | system | legacy pollers |
| `job_heartbeat.<env>.<job>` | system (N42) | Logs & errors → Jobs |

## 3. Email routing and the redirect

- Each email flow has a key (`welcome`, `missingData`, `mrfApproval`, `backendErrorAlert`, …) with default recipients in `config/emailRecipients.js`, overlaid by `email_recipients.*` settings. Code calls `resolveRecipients(flowKey)`.
- **Outside production every email is redirected** to `EMAIL_STAGING_RECIPIENTS`, enforced inside `sendGraphEmail`, so a new flow is safe by default. Two groups bypass it:
  - `NEVER_REDIRECT`: `resumeErrorAlert`, `rerankApiAlert`, `backendErrorAlert` (also used by job-failure and crash alerts), `userCredentialUpdate`, `passwordReset`.
  - `OPERATOR_ADDRESSED`: interview panel invites and cancellations, scorecard invites and the occurrence nudge. A recruiter typed those addresses, so staging tests reach them.
- Before testing on staging with real-looking data, check the stored `email_recipients.*` rows. On 19 Oct three still listed a business inbox; they are redirected, but should be cleaned before production.

## 4. Feature flags: production state to confirm at each release

| Flag | Meaning when on | Note |
|---|---|---|
| `SCREENING_V2` | strict filtering | Production only after RT signs off N11 |
| `FLEXIBLE_STAGES_ENABLED` | any-order stage moves | Needs DDL `2026-10-16-flexible-stage-movement.sql` |
| `MS_CALENDAR_ENABLED`, `MS_ATTENDANCE_ENABLED`, `MS_MEETING_RECORD_AUTO`, `MS_RECORDING_FETCH_ENABLED`, `MS_RECORDING_ARCHIVE_ENABLED` | Teams features | Each needs its Graph permission |
| `EMAIL_INTAKE_ENABLED`, `INBOUND_SYNC_ENABLED`, `ZEKO_SYNC_ENABLED` | background sync | Off by default per environment |
| `USE_RESUME_QUEUE` | queued uploads | Needs Redis and the worker process |
| `MRF_APPROVAL_AUDIT_ENABLED` | per-approver links | On by default; kill switch |
