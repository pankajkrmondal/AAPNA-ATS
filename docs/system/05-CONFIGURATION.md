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
| `PUBLIC_BASE_URL` | empty | This backend's public URL, for the email open-tracking pixel and (U08) the tracked Zeko link `/api/z/<token>`; empty = no pixel, and the Zeko email links straight to the job's Zeko page |
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
| `SCREENING_V2` | `false` | Strict keyword / JD filtering (section A). **12 Nov decision:** `true` on staging **and** production; the strict search is final, and the N11 before/after check is dropped. The local `.env.staging` and `.env.production` copies both read `true`. Confirm the live servers at the 16 Nov release (see §4) |

### Zeko
| Variable | Purpose |
|---|---|
| `ZEKO_API_URL`, `ZEKO_API_KEY`, `ZEKO_CLIENT_ID`, `ZEKO_COMPANY_ID` | Credentials (different per environment) |
| `ZEKO_SCHEDULE_API_BASE`, `ZEKO_DASHBOARD_API_BASE`, `ZEKO_LOGIN_API_BASE`, `ZEKO_REPORT_API_BASE` | API bases |
| `ZEKO_INTERVIEW_LINK_BASE`, `ZEKO_REPORT_LINK_BASE`, `ZEKO_SHARED_REPORT_LINK_BASE`, `ZEKO_SHARE_LINK_TIMEOUT_MS` | Links to candidate interview, recruiter report and public report |
| `ZEKO_LOGIN_EMAIL` | Account for the OTP login (defaults to the sender mailbox) |
| `ZEKO_SYNC_ENABLED`, `ZEKO_JOBS_CRON` (hourly), `ZEKO_RESULTS_CRON` (5 min) | Background sync |
| `ZEKO_TEST_PHONE` | Phone sent to Zeko outside production (Zeko sends SMS itself) |
| `ZEKO_REMINDER_ENABLED` | U08 expiry reminder (`jobs/zekoExpiryReminder.js`, hourly at :20 IST). Default `false`. Runs only when `ZEKO_SYNC_ENABLED=true` too, because it asks Zeko whether the candidate has attempted the test. **Not set in the local `.env.staging` or `.env.production` (12 Nov), so off everywhere.** Where to turn it on is the owner's decision (plan index, "Open for you") |

### Pipeline, documents, offers, assessments
| Variable | Default | Purpose |
|---|---|---|
| `FLEXIBLE_STAGES_ENABLED` | `false` | Move a candidate to any stage not yet passed; drag and drop |
| `ASSESSMENT_DEADLINE_CHECK_CRON` | hourly | Overdue Evalground invites |
| `DOCUMENT_REMINDER_CRON` / `_AFTER_DAYS` / `_REPEAT_HOURS` / `_MAX_COUNT` | `0 9 * * *` / 2 / 24 / 3 | Document chasing |
| `OFFER_SWEEP_CRON`, `OFFER_AUTO_CLOSE_AFTER_DAYS` | `0 7 * * *`, 90 | Post-joining auto-close |
| `MRF_APPROVAL_AUDIT_ENABLED`, `MRF_APPROVAL_TOKEN_DAYS` (14), `MRF_APPROVAL_RATE_WINDOW_MS`, `MRF_APPROVAL_RATE_MAX` | `true` | Per-approver links and audit |
| `MRF_HOLD_ENABLED` | `false` | Put an MRF on hold (approver link, or on behalf). Off blocks new holds only; the release sweep still frees held MRFs. Staging `true`, production `false` until R1 |
| `MRF_DELEGATE_DECISION_ENABLED` | `false` | The person chosen in Settings (`mrf_on_behalf_user`) can approve, reject or hold for the approvers, any time an MRF is pending (U06b). Needs `MRF_APPROVAL_AUDIT_ENABLED=true`. Staging `true`, production `true` from 16 Nov (R16) |
| `FORMS_DIGEST_ENABLED` | `false` | U10 / U10b bell note at 09:00 IST (`jobs/completedFormsDigest.js`): "N candidates responded yesterday across M JDs" (open positions plus "No JD yet", the Responded column's definition), linking to Analytics → Open Positions › Responded for that day. In-app only, no email; nothing sent on a day nobody responded. **Not set in the local `.env.staging` or `.env.production` (12 Nov).** Staging `true` from 13 Nov, production `true` from 16 Nov (R16) |
| `FORMS_DIGEST_ROLES` | `superadmin,admin,hr_admin_recruiter,hr` | Who gets that note (HR and Admin). Staff roles only; `vendor` is ignored. Add `recruiter` to include every recruiter |

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
| `zeko_reminder_lead_hours` | DB only (default 24, at most 168): how long before a Zeko window closes the reminder goes | `jobs/zekoExpiryReminder.js` (U08) |
| `interview_occurrence_enabled`, `interview_occurrence_interval_min`, `interview_occurrence_grace_min` | Settings → Interview occurrence | `jobs/interviewOccurrence.js` |
| `interview_recording_enabled`, `interview_recording_interval_min`, `interview_recording_grace_min` | Settings → Recording | `jobs/interviewRecordings.js` |
| `interview_optional_attendees` | Settings → Optional attendees | `interviewOptionalAttendees.service.js` |
| `assessment_deadline_days`, `assessment_auto_advance_enabled` | Settings → Assessment automation | `assessmentSettings.service.js` |
| `email_recipients.<flow>.to` / `.cc` | Settings → Flow recipients (`/settings/flow-keys`); seeded by `prisma/seed-email-recipients.js` | `config/emailRecipients.js` |
| `mrf_approvers` | DB only: JSON array of `{email, name}`; falls back to the `mrfApproval` recipients | `mrfApproval.service.js`, `utils/mrfApprovalRules.js` |
| `mrf_hold_default_days`, `mrf_hold_max_days`, `mrf_hold_release_time` | Settings › MRF Approval & Hold (defaults 30 / 180 / 09:00 IST) | `mrfHoldSettings.service.js` |
| `mrf_on_behalf_user` | Settings › MRF Approval & Hold › Who can decide on behalf, **Admin / Super Admin only**: JSON `{userId, setByUserId, setByName, setAt}`. The one active staff member who may decide on behalf; unset means nobody (U06b) | `services/mrfHoldSettings.service.js` |
| `mrf_approver_absence` | No longer shown or used to decide (U06b). JSON `{active, from, to, note}`; the row is kept as stored | `utils/mrfApprovalRules.js` |
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

### The JD on candidate templates (U02b)
Set per template on the Email Templates page. No env flag. Needs DDL `2026-11-12-email-template-attach-jd.sql`; until it runs, every template follows the default rule and saving the switch is refused (HTTP 503).

| Setting | Values | Effect |
|---|---|---|
| `rpa_email_templates.attach_jd` ("Attach the JD" switch) | `NULL` (default rule, shown with a "Default" tag), `true`, `false` | `NULL`: `shouldAttachJd` decides (on for forward rounds; off for Documents, Offer and closures). `true` / `false` override it for that template, on every path that uses it, including an edited draft. The column is not in the Prisma model: it is read with raw SQL (`loadTemplateAttachJd`) |
| `{{jd_link}}` token (in `placeholders`) | optional | Where the JD card goes when the JD is sent as a link. With no token, the card goes where it did before (after the intro on shortlists, else above the sign-off). It is removed when the JD is attached or not sent. The switch shows only on templates that declare it |

Templates that declare it on staging (12 Nov dry run): Shortlist Notification, Zeko Interview Scheduled Invitation, Interview Scheduled / Rescheduled — Candidate, Stage Outcome — Approved (and any template mapped to an `approved` outcome), and Evalground Assessment Invite (new, created by the DDL).

**JD link sources:** a JD with a OneDrive item id, or a `*.sharepoint.com`, `onedrive.live.com` or `1drv.ms` address, is downloaded and gets an "anyone" view link (counted as one only when Graph replies `scope: anonymous`). Any other `jd_document_link` is a website JD and is sent as that link, with no Graph calls.

## 4. Feature flags: production state to confirm at each release

| Flag | Meaning when on | Note |
|---|---|---|
| `SCREENING_V2` | strict filtering | On in production from 16 Nov (12 Nov decision; N11 dropped). Location is an exact part match ("Delhi" never finds "New Delhi"; HR reconfirmed 10 Nov). Check the live server's value at the release |
| `FLEXIBLE_STAGES_ENABLED` | any-order stage moves | Needs DDL `2026-10-16-flexible-stage-movement.sql` |
| `MS_CALENDAR_ENABLED`, `MS_ATTENDANCE_ENABLED`, `MS_MEETING_RECORD_AUTO`, `MS_RECORDING_FETCH_ENABLED`, `MS_RECORDING_ARCHIVE_ENABLED` | Teams features | Each needs its Graph permission |
| `EMAIL_INTAKE_ENABLED`, `INBOUND_SYNC_ENABLED`, `ZEKO_SYNC_ENABLED` | background sync | Off by default per environment |
| `ZEKO_REMINDER_ENABLED` | Zeko expiry reminder email (U08) | Needs `ZEKO_SYNC_ENABLED`, DDL `2026-11-10-zeko-link-token.sql`, and `PUBLIC_BASE_URL` for the tracked link. Seed the template with `prisma/seed-zeko-reminder-template.js` |
| `FORMS_DIGEST_ENABLED` | 09:00 IST Responded bell note (U10 / U10b) | No DDL. Recipients: `FORMS_DIGEST_ROLES` |
| `USE_RESUME_QUEUE` | queued uploads | Needs Redis and the worker process |
| `MRF_APPROVAL_AUDIT_ENABLED` | per-approver links | On by default; kill switch |
| `MRF_HOLD_ENABLED`, `MRF_DELEGATE_DECISION_ENABLED` | MRF hold; the person chosen in Settings decides on behalf | Needs DDL `2026-10-22-mrf-hold-and-delegate.sql`, and an Admin sets the person in Settings (no role move). Production order: `docs/phase3/MRF/MRF-Hold-and-Delegate-Approval-Plan.md` §16.4 |
