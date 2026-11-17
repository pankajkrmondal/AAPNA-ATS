# Staging → Production Deployment Plan

**Date:** 16 Nov 2026 · **Status:** plan only. No code, database or server was changed to write it.
**Production:** https://ats.aapnainfotech.com · **Staging:** https://ats-staging.aapnainfotech.com
**Release source:** branch `project-staging` (tip = merge of PR #114, 6 Nov 2026)
**Goal:** move everything that is on staging to production without breaking production, including environment settings and the access needed to do it.

**Builds on:**
[STAGING-TO-PRODUCTION-DB-AND-ONEDRIVE-PLAN.md](../phase3/STAGING-TO-PRODUCTION-DB-AND-ONEDRIVE-PLAN.md) (9 Sep, database and OneDrive catch-up) ·
[MS-GRAPH-PRODUCTION-SETUP.md](../deployment/MS-GRAPH-PRODUCTION-SETUP.md) (11 Sep, IT actions) ·
[06-OPERATIONS-RUNBOOK.md](../system/06-OPERATIONS-RUNBOOK.md) ·
[05-CONFIGURATION.md](../system/05-CONFIGURATION.md)

---

## 1. Read this first

1. **We do not know for certain what production is running today.** The repo has no release tags, and the development history still says "to confirm: the date Phase 3 went live in production". Gate 0 (§5) settles this with read-only checks. Every later step depends on its answer.
2. **Production holds the real data** (about 9,000 CVs and 17,000 email messages in September). This is a schema-forward release onto live data. Never copy data from staging to production or the other way.
3. **Staging and production databases are on the same host with the same database user.** The only difference is the database name: `recruitmentautomationdb` (staging and local) and `recruitmentautomationdbProd` (production). A wrong connection is the easiest way to damage production. Every database command in this plan uses a guard that checks the database name.
4. **Production sends real email.** The local copy of `.env.production` has `EMAIL_REDIRECT_TO_TEST=false`. New background jobs start on the first boot of the new code, so the release starts with the redirect on and turns it off last (§7, steps 9 and 12).
5. **Nothing here was checked against the live production server or database.** Facts come from the repository and the local env file copies (last edited 3 Nov 2026). The server copies are set by hand and are the ones that count.

---

## 2. What is in this release

### 2.1 Code

| Measure | Value |
|---|---|
| `origin/main` → `project-staging` | 219 commits, 372 files, +46,754 / −14,171 lines |
| Last production snapshot in the repo (`project-production-backup-06-08-2026`) → `project-staging` | 289 commits |
| New frontend dependencies | `@dnd-kit/core`, `@codemirror/view`, `antd` 5.17 → 5.29 |
| Backend runtime | Node 20 or later (`engines`), Express 5, Prisma 6.9, PM2 fork mode, one instance |

Main feature groups since September: strict keyword and JD screening (`SCREENING_V2`), flexible stage movement with drag and drop, stage redo and journey move between roles, JD tagging on upload, candidate MRF tags, duplicate compare, MRF approval audit (personal approver links), MRF Hold and decide-on-behalf, HR Admin Recruiter role, pipeline auto-pause, error log with the "Logs & errors" admin tab, open-position analytics, Forms & Links page, interview panel pack, editable interview and MRF-hold email templates, new visual design.

### 2.2 Database

Two layers. Which ones production still needs is decided at Gate 0.

| Layer | Files | Status in production |
|---|---|---|
| **A. September catch-up** | 23 DDL files (bundled as `backend/prisma/ddl/pgadmin/01-ddl-all.sql`), then `2026-09-09-prod-parity-backfill.sql` (deletes duplicate email rows; needs sign-off), then `pgadmin/03-settings.sql` | **Unknown. Verify with `pgadmin/04-verify.sql` (read-only).** |
| **B. This release** | 12 DDL files listed below, each with a matching `.rollback.sql` | Assume not applied until checked |

Layer B, in the order to apply:

| # | File | Needed by |
|---|---|---|
| 1 | `2026-09-25-mrf-approval-audit.sql` | Personal approver links, audit trail |
| 2 | `2026-10-14-ceo-round-optional.sql` | Optional CEO round |
| 3 | `2026-10-14-cv-details-dates.sql` | CV detail dates |
| 4 | `2026-10-15-mrf-jd-item-id.sql` | JD file link on the MRF |
| 5 | `2026-10-16-flexible-stage-movement.sql` | `FLEXIBLE_STAGES_ENABLED` |
| 6 | `2026-10-20-error-log.sql` | Logs & errors tab, error alerts |
| 7 | `2026-10-21-candidate-mrf-tags.sql` | JD tagging on upload |
| 8 | `2026-10-22-jd-send-version-label.sql` | Editable JD label |
| 9 | `2026-10-22-journey-move.sql` | Move candidate to another role |
| 10 | `2026-10-22-mrf-hold-and-delegate.sql` | MRF Hold, decide on behalf |
| 11 | `2026-10-22-stage-redo.sql` | Stage redo |
| 12 | `2026-10-23-duplicate-match-id.sql` | Duplicate compare |

`01-ddl-all.sql` is a generated bundle from September and does **not** contain these 12 files. Do not use it as "all DDL".

### 2.3 Reference data (seeds and settings)

| Item | Behaviour | Plan |
|---|---|---|
| `prisma/seed-interview-email-templates.js` | Creates missing rows only; HR edits survive. Has `--dry-run` | Run |
| `prisma/seed-mrf-hold-email-templates.js` | Creates missing rows only. Has `--dry-run` | Run |
| `prisma/grant-recruiter-pipeline-access.js` | Idempotent. Has `--dry-run` | Dry-run, review, then run if recruiters need the pipeline module |
| `prisma/seed-email-templates.js` | **Overwrites every matched template**, and matches two of them by category | Do not run blind. Export templates first, review the diff, re-apply HR wording by hand |
| `prisma/seed-email-recipients.js` (changed in this release) | May overwrite live production recipient rows | Read the script first. Default: skip it and insert only the missing keys by hand |
| `prisma/retire-dead-email-templates.js` | Idempotent, reversible | Optional; decide with RT |
| `rpa_settings` keys | Staging has more keys than production | Compare key **names** only (read-only), insert missing ones with `ON CONFLICT DO NOTHING`. Never copy staging values for recipients, mailbox cursors or `mrf_approvers` |

### 2.4 Not part of this release

Phase 4 work (WhatsApp messaging, MS Access data migration) is planning only and is not on `project-staging`. The Playwright E2E harness (`tests/`, `specs/`, root `package.json`) is git-ignored and is never deployed.

---

## 3. Access needed

Collect all of this before the release date. A missing access on the night is a reason to stop, not to improvise.

| # | Access | Who has it / who grants | Needed for |
|---|---|---|---|
| 1 | SSH to the production server, as the OS user that owns the PM2 processes | Server owner (**to name**) | Deploy, PM2, logs |
| 2 | Write access to `/var/www/html/ats-platform-prod/` (backend and frontend) | Server owner | Code and build |
| 3 | `sudo` for `nginx -t` and `systemctl reload nginx`, and read access to the nginx site config | Server owner | Confirm web root, proxy port 5001, reload if needed |
| 4 | GitHub read access from the server (deploy key or token) to `AAPNA-ATS` | Repo owner | `git fetch` of the release tag |
| 5 | PostgreSQL access to `recruitmentautomationdbProd`; firewall allowlist for the IP that runs `pg_dump` | DB owner | Backup, DDL, verification |
| 6 | `pg_dump` / `pg_restore` client **version 18 or later** (the server is 18.x) and about 2 GB free disk for the dump and a test restore | Developer | Backup that can actually be restored |
| 7 | pgAdmin connection to production (fallback when `psql` is not available) | Developer | Preflight and verify scripts |
| 8 | Redis CLI on the production server | Server owner | Health check, shared-Redis check (§4, R3) |
| 9 | The **server copy** of `backend/.env.production` (read and edit) | Developers | Env changes in §6 |
| 10 | Production ATS Super Admin login | HR Admin / developers | Smoke tests, Logs & errors → Health and Jobs |
| 11 | Cloudflare dashboard for `aapnainfotech.com` (cache purge, Turnstile widget settings) | IT (**to name**) | Purge cached frontend, confirm Turnstile hostname |
| 12 | Microsoft 365 / Entra admin for app `HR_RPA_PROD` and Teams PowerShell | AAPNA IT | Client secret expiry, Teams application access policy, OneDrive site grant |
| 13 | Read access to the production recruitment mailbox and to the internal test inbox | IT / developers | Confirm test emails arrive, Zeko OTP login |
| 14 | Zeko, OpenRouter, Gemini and Cohere account dashboards | Account owner (**to name**) | Quota and key validity |
| 15 | A named RT contact available during the window (Chhaya / Naveen) | RT | Business smoke test and go-live sign-off |

Rules for secrets: values are never pasted into chat, documents, tickets or commits. Env files are copied server to server or from a teammate, not from this document.

---

## 4. What can break production, and how this plan prevents it

| # | Risk | Why it is real | Prevention |
|---|---|---|---|
| R1 | Running a script against the wrong database | Same host, same user, names differ by four letters | Use `scripts/run-ddl.mjs --env .env.production --expect-db recruitmentautomationdbProd`. In pgAdmin, read the title bar before every F5. Never run a script "locally" against production from a dev machine with `NODE_ENV` unset |
| R2 | New code deployed before its DDL | Prisma throws on unknown columns; this caused the 22 Sep "Resume Processing Failed" incident | DDL first, then code, then `prisma generate`, then start. Fixed order in §7 |
| R3 | Staging and production share one Redis | Both env files point at `127.0.0.1:6379` with no password, ports 5000 and 5001 suggest one server, and neither the BullMQ queue (`resume-processing`) nor the cache keys (`insight:mrf:<id>:cv:<id>`, role caches, assessment previews) carry an environment name | Gate 0 check. If they share a Redis: give production its own Redis instance on another port (`REDIS_PORT` is an env setting, no code change), or keep the staging backend and worker stopped during and after go-live until that is done |
| R4 | Real candidates emailed by mistake on first boot | 14 cron jobs start at boot, several send mail, and production does not redirect | Start with `EMAIL_REDIRECT_TO_TEST=true`, check the Jobs tab and the test inbox, then turn it off as the last step |
| R5 | Business mail lost while the redirect is on | With the redirect on, real approvals and candidate mail go to the test inbox | Keep the window short and outside office hours (IST). Tell RT not to act in the ATS until the all-clear |
| R6 | Seeds overwrite HR-edited templates or live recipients | `seed-email-templates.js` overwrites; `seed-email-recipients.js` changed | §2.3: export first, run only create-only seeds by default |
| R7 | A stale `backend/.env` on the server fills in missing keys | `config/index.js` loads `.env.<NODE_ENV>` and then `.env` for anything missing. The repo's `.env` carries development-style values | Gate 0: list key names in both files on the server. Remove or empty the plain `.env` in the production directory after confirming nothing relies on it |
| R8 | Frontend built in the wrong mode | `build:staging` bakes the staging API URL into the bundle | Use `npm run build:prod`, then search the built files for `ats-staging` (must be zero hits) before the swap |
| R9 | `npm ci --omit=dev` breaks the deploy | `prisma` (CLI) and `cross-env` are devDependencies; `prisma generate` and every `npm run *:prod` script need them. Older docs show `--omit=dev` | Use plain `npm ci`, as `deploy-staging.sh` does |
| R10 | `prisma db pull` rewrites `schema.prisma` in the deploy folder | Older runbooks list it as a deploy step | Do not run it in the deploy folder. Use the committed schema and `prisma generate`. Run the parity `db pull` in a scratch checkout only |
| R11 | Features go live that RT has not approved | Code defaults: `INTERVIEW_PANEL_PACK_ENABLED` and `MRF_APPROVAL_AUDIT_ENABLED` are **on** when unset. `SCREENING_V2=true` in the local production file, but the docs say it waits for RT's N11 sign-off | §6.2: every flag gets an explicit value and an owner decision |
| R12 | Two backends on one database send duplicates | Reminders were sent twice before for this reason | One `ats-prod-backend` process only. Nobody runs a local backend with `NODE_ENV=production` |
| R13 | No fast way back | No release tags, no `deploy-production.sh`, in-place deploys | Tag the release, record the current production commit, keep the previous build folder and `dist` (§7 step 3, §9) |
| R14 | Graph secret or Teams policy not ready | Calendar, attendance and recordings return 403 without the Teams application access policy; an expired client secret stops all mail | Gate 2 with IT. Flags for anything not ready stay `false` |
| R15 | Running the E2E suite against production | The Playwright suite creates and edits records and is approved for staging only | Production smoke tests are manual and listed in §8. The suite runs on staging only |

---

## 5. Gates before the release window

All gates must pass. Each has an owner and a written result.

### Gate 0 — Establish the production baseline (read-only)

| Check | How | Result decides |
|---|---|---|
| Deployed commit | On the server: `git -C /var/www/html/ats-platform-prod rev-parse HEAD` and `git status` (or folder dates if it is not a git checkout) | Size of the code jump; rollback target |
| Actual paths | `pm2 describe ats-prod-backend` (cwd, script, uptime, restarts), `pm2 list` | Docs disagree: `ats-platform-prod` vs `ats-platform`. Use what PM2 reports |
| Web server | nginx site config: web root for the frontend, `proxy_pass` port (expect 5001), `/socket.io` upgrade headers, `client_max_body_size` (uploads are up to 50 MB) | Where `dist` goes; no nginx change expected |
| Schema level | Run `pgadmin/04-verify.sql` and the Layer B check below against production | Whether Layer A, Layer B or both are needed |
| Env key names | On the server, list key names (not values) of `.env.production` and `.env`; compare with §6 | Env change list |
| Shared Redis | Same host for both sites? `redis-cli info keyspace`, `redis-cli client list` | R3 |
| Node and PM2 | `node -v` (20 or later), `pm2 -v`, `pm2 startup` configured | Runtime fit |
| Disk | Free space for the backup, a second copy of the build, logs and uploads | Go / no-go |
| Health now | `curl https://ats.aapnainfotech.com/api/health`, and Logs & errors → Health / Jobs if that tab exists in the running version | Baseline to compare after the release |

Layer B check (read-only; expect a row for each object once applied):

```sql
SELECT current_database();   -- must be recruitmentautomationdbProd
SELECT table_name FROM information_schema.tables
 WHERE table_schema = 'public'
   AND table_name IN ('rpa_mrf_approval_events','rpa_error_log','rpa_pipeline_stage_state');
```

Then compare column and table counts with staging using the Step 8 query of the September plan.

**Outcome A:** production is pre-Phase 3 → run the September plan's database part first (its decisions D1–D7 need sign-off), then Layer B. Plan a longer window.
**Outcome B:** Layer A is in, Layer B is not → this plan as written.
**Outcome C:** part of Layer B is in → apply only the missing files, in order. Every file is idempotent, and `--dry-run` shows what each would do.

### Gate 1 — Staging is the thing we ship

- `project-staging` is frozen. Staging runs exactly that commit.
- Backend unit tests pass (`npm run test:unit`, 93 test files) and the Playwright suite has a current run against staging with the result recorded in `test-results/final-report.md`.
- RT has finished UAT on staging and signed off the feature list in §2.1 and the flags in §6.2.
- Create an annotated git tag on the frozen commit (for example `prod-2026-11-<dd>`). Production deploys the tag, not a moving branch.

### Gate 2 — External dependencies (IT and vendors)

- `HR_RPA_PROD` client secret: note the expiry date; renew if it expires within 30 days.
- Teams application access policy for the production app and production mailbox exists (see MS-GRAPH-PRODUCTION-SETUP.md). If not, `MS_ATTENDANCE_ENABLED`, `MS_MEETING_RECORD_AUTO`, `MS_RECORDING_FETCH_ENABLED` and `MS_RECORDING_ARCHIVE_ENABLED` stay `false`.
- OneDrive: the production parent folder resolves; `Document Collection/` and `Recordings_ATS/` exist or can be created.
- Turnstile: the production site key and secret are a matching pair and the widget lists `ats.aapnainfotech.com`.
- Zeko, OpenRouter, Gemini, Cohere: keys valid, quota available.

### Gate 3 — Rehearsal

- Take a fresh `pg_dump` of production and restore it into a scratch database (not on the production database name).
- Apply the needed DDL files to the scratch database in order. Record the time each takes.
- Point a local backend at the scratch database with the redirect on and confirm it boots and the main screens load.
- Run each seed with `--dry-run` where available and keep the output.

### Gate 4 — Communication

- Window agreed with RT, outside office hours IST, 90 minutes for Outcome B (longer for Outcome A).
- Users told: no uploads, approvals or interview bookings during the window.
- Two developers present: one runs the steps, one checks each verification.
- Rollback decision owner named. Decision point: 60 minutes into the window.

---

## 6. Environment settings

### 6.1 Rules

- Edit the **server copy** of `backend/.env.production`. Back it up first (`cp .env.production .env.production.bak-<date>`).
- Give every key an explicit value. Do not rely on code defaults or on the plain `.env` fallback.
- These must stay production-specific and are **never** copied from staging: `DATABASE_URL`, `JWT_SECRET`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_DEFAULT_SENDER_EMAIL`, `MS_CALENDAR_MAILBOX`, `MS_ONEDRIVE_PARENT_ID`, `ZEKO_CLIENT_ID`, `ZEKO_LOGIN_EMAIL`, `GEMINI_API_KEY`, `COHERE_API_KEY`, `TURNSTILE_SECRET_KEY`, `FRONTEND_URL`, `PUBLIC_BASE_URL`, `PORT`.
- These exist in staging and must **not** be added to production: `ZEKO_TEST_PHONE` (test phone for non-production), `BASE_URL` (E2E harness only).

### 6.2 Backend keys to confirm on the server

Core values, from the local copy:

| Key | Production value | Note |
|---|---|---|
| `NODE_ENV` | `production` | Set by PM2 (`ats-prod-backend`, `ats-prod-worker`) |
| `PORT` | `5001` | Must match nginx `proxy_pass` |
| `DATABASE_URL` | database `recruitmentautomationdbProd` | Check the name, not just that it connects |
| `FRONTEND_URL`, `PUBLIC_BASE_URL` | `https://ats.aapnainfotech.com` | CORS and email tracking pixel |
| `TRUST_PROXY` | `true` | Behind nginx; otherwise rate limits hit everyone at once |
| `LOG_LEVEL` | `info` | |
| `REDIS_HOST` / `REDIS_PORT` | per R3 | |
| `USE_RESUME_QUEUE` | unset in both env files | Keep the same as production today. Changing it is a separate decision |

Flags. "Local file" is the value in the local copy of `.env.production`; the server may differ.

| Flag | Local file | Go-live value | Decision owner |
|---|---|---|---|
| `EMAIL_REDIRECT_TO_TEST` | `false` | `true` during the window, `false` at step 12 | Developers |
| `EMAIL_INTAKE_ENABLED`, `INBOUND_SYNC_ENABLED` | `true` | Keep | — |
| `ZEKO_SYNC_ENABLED` | `true` | Keep | — |
| `MS_CALENDAR_ENABLED` | `true` | Keep if it is on in production today | — |
| `MS_ATTENDANCE_ENABLED`, `MS_MEETING_RECORD_AUTO`, `MS_RECORDING_FETCH_ENABLED`, `MS_RECORDING_ARCHIVE_ENABLED` | `true` | `true` only if Gate 2 confirms the Teams policy | IT + developers |
| `MS_RECORDING_RETAIN_MONTHS` | `12` | Confirm 12 months is the agreed retention | RT / management |
| `FLEXIBLE_STAGES_ENABLED` | `true` | `true` (needs DDL 5) | RT |
| `SCREENING_V2` | `true` | `true` only with RT's N11 before/after sign-off; otherwise `false` | RT |
| `MRF_APPROVAL_AUDIT_ENABLED` | not set (code default on) | Set explicitly to `true` (needs DDL 1) | RT |
| `MRF_HOLD_ENABLED`, `MRF_DELEGATE_DECISION_ENABLED` | `false` | Start `false`; turn on after RT confirms approvers and wording (needs DDL 10 and the audit flag) | RT |
| `INTERVIEW_PANEL_PACK_ENABLED` | not set (code default on) | Set explicitly. On means panel invites carry the JD, CV and report | RT |

Keys the new code reads that have safe defaults and need no entry unless a value should change: `MAILBOX_SYNC_CRON`, `ASSESSMENT_DEADLINE_CHECK_CRON`, `DOCUMENT_REMINDER_*`, `OFFER_SWEEP_CRON`, `OFFER_AUTO_CLOSE_AFTER_DAYS`, `MRF_APPROVAL_TOKEN_DAYS`, `MRF_APPROVAL_RATE_*`, `DOSSIER_*`, `EXPORT_*`, `RATE_LIMIT_*`, `UPLOAD_JOB_STALE_MINUTES`, `EXPORT_TZ`, `ZEKO_REPORT_*`, `ZEKO_SHARED_REPORT_LINK_BASE`.

Values that are identical in the staging and production files and are worth a conscious confirmation: `OPENROUTER_API_KEY`, `ZEKO_API_KEY`, `ZEKO_COMPANY_ID`, `EMAIL_HR_ALERTS_RECIPIENTS`, `EMAIL_RESUME_ERROR_RECIPIENTS`. Shared keys mean staging tests use production quota and, for Zeko, the same company account.

### 6.3 Frontend (build time, file is in git)

`frontend/.env.production`: `VITE_API_URL=https://ats.aapnainfotech.com`, the production Turnstile site key, and `VITE_FORMS_LINKS_ENABLED=false`. The Forms & Links menu item stays hidden until Chhaya signs off; changing it needs a rebuild, not a restart.

### 6.4 Database settings (`rpa_settings`)

- Keep production values for `email_recipients.*`, `mrf_approvers`, `mailbox_delta_link`, `job_heartbeat.*` and all `*_last_sync` keys.
- Review with RT before go-live: `interview_reminder_enabled`, `interview_occurrence_enabled`, `interview_recording_enabled`, `assessment_auto_advance_enabled` (recommended `false` at go-live), `company_profile_text`, and the new Settings cards (pipeline auto-pause, position target, MRF approval hold).
- Check that no `email_recipients.*` row in production holds a developer or staging address.

### 6.5 Credential hygiene found while preparing this plan

Not blockers for the release, but they should be scheduled:

- Staging, local development and production use the same database user and password. A dedicated production role with its own password would make R1 much harder to trigger.
- `backend/.env.development` contains a commented-out line with a full connection string. Remove it.
- A full copy of `.env.production` sits on developer machines. Keep the production file on the server and in a secret store only.
- Redis has no password in any environment.

---

## 7. Release steps (inside the window)

Commands are for the production server. Replace `<tag>` with the release tag and use the paths found in Gate 0. Stop at any failed check and go to §9.

| # | Step | Command / action | Check before moving on |
|---|---|---|---|
| 1 | Announce start | Message to RT and users | Acknowledged |
| 2 | Stop writers | `pm2 stop ats-prod-backend ats-prod-worker` | `pm2 list` shows both stopped. Site shows an error or maintenance page |
| 3 | Save the current build | Copy the backend folder (with `node_modules`), the frontend `dist`, and `.env.production` to `/var/backups/ats/<date>/`. Record `git rev-parse HEAD` | Copies exist and sizes look right |
| 4 | Back up the database | `pg_dump -Fc` of `recruitmentautomationdbProd`; CSV export of `rpa_email_templates` and `rpa_settings` | Dump file size is plausible; `pg_restore --list` reads it. (Full restore was proven in Gate 3) |
| 5 | Get the code | `git fetch --tags && git checkout <tag>` in the deploy folder | `git rev-parse HEAD` equals the tag commit; `git status` clean apart from env files, `logs/`, `uploads/` |
| 6 | Install | `cd backend && npm ci` (not `--omit=dev`) | Exit code 0 |
| 7 | Apply DDL | For each needed file, in order: `node scripts/run-ddl.mjs --env .env.production --expect-db recruitmentautomationdbProd --file prisma/ddl/<file>.sql --dry-run`, then the same without `--dry-run` | Each prints `DRY RUN OK` then `COMMITTED`. Layer B check query returns the expected objects |
| 8 | Prisma client | `npm run prisma:generate` | Exit code 0. Do not run `prisma db pull` here |
| 9 | Env | Apply §6.2 to `.env.production`, with `EMAIL_REDIRECT_TO_TEST=true` | Key-name diff against §6.2 is empty; no plain `.env` with stray values |
| 10 | Reference data | `NODE_ENV=production node prisma/seed-interview-email-templates.js --dry-run`, then without; same for `seed-mrf-hold-email-templates.js`; missing `rpa_settings` keys via `INSERT … ON CONFLICT (key) DO NOTHING` | Output lists created rows only; template count grew by the expected number; no existing template changed |
| 11 | Frontend | `cd ../frontend && npm ci && npm run build:prod` into a temporary folder, search it for `ats-staging` (zero hits), then swap it with the live `dist` | `index.html` references the new asset hashes |
| 12 | Start | `pm2 start ecosystem.config.cjs --only ats-prod-backend,ats-prod-worker` (or `pm2 restart … --update-env`), `pm2 save` | `pm2 list` online, restart count not climbing. Boot log shows the database connected, Redis connected and every cron registered, with no errors. `curl …/api/health` returns 200 |
| 13 | Smoke tests, redirect on | §8 part 1 | All pass |
| 14 | Go live | Set `EMAIL_REDIRECT_TO_TEST=false`, `pm2 restart ats-prod-backend ats-prod-worker --update-env` | Health 200; §8 part 2 passes |
| 15 | Cache | Purge the Cloudflare cache for the site if it is proxied; hard-refresh a browser | New UI loads, no mixed old and new assets |
| 16 | Announce end | Message to RT and users with the list of what is new | — |

Notes:

- The backend reads its env file at process start, so a restart is enough to pick up changes.
- If Gate 0 gave Outcome A, steps 7 and 10 expand to the September plan's Steps 2 to 5 (23 DDL files, parity backfill, settings, stage and document seeds), then Layer B.
- For later, smaller releases a zero-downtime `pm2 reload` is fine. For this one, stopping the backend is deliberate: it keeps the mailbox poller and reminder jobs from writing while the schema changes.

---

## 8. Smoke tests on production

Manual, by a developer and one RT user. Use a test MRF and a candidate you control, clearly named as a test. Do not delete or edit real records.

**Part 1 — with the email redirect on**

| # | Test | Expected |
|---|---|---|
| 1 | `GET /api/health` | 200 |
| 2 | Log in as Super Admin, Admin, Recruiter and Vendor (Turnstile shown and passing) | Each lands on its own dashboard with the right menu |
| 3 | Admin → Logs & errors → Health | Database, Redis, upload queue and Microsoft login all green |
| 4 | Admin → Logs & errors → Jobs | Jobs appear with environment `production` and a recent successful run; no staging rows running against this database |
| 5 | Dashboard, MRF list, Search Candidate, Candidate Screening, Candidate Pipeline, Recruitment Analytics, Email Templates, Settings | Each loads with existing production data; counts are in line with before the release |
| 6 | Open an existing candidate and an existing MRF created before the release | Details render; old records are intact |
| 7 | Call an admin API as a recruiter; open a protected URL with no session | 403; redirect to login |
| 8 | Upload one synthetic resume through HR Manual Upload | Parsed and listed; file lands in the production OneDrive folder |
| 9 | Submit a test MRF | Approval emails arrive in the **test inbox**, with personal links that open |
| 10 | Move the test candidate one stage in the pipeline | Stage changes; event recorded; email goes to the test inbox |
| 11 | Browser console and network tab on three pages | No calls to `ats-staging`, no 5xx, socket connects |
| 12 | Logs & errors → Errors, and `pm2 logs ats-prod-backend --lines 200` | No new error groups since start |

**Part 2 — after the redirect is off**

| # | Test | Expected |
|---|---|---|
| 13 | Send one email to an address you control from a test candidate | Arrives at that address from the production recruitment mailbox |
| 14 | Book one interview for the test candidate with a developer as the panel (only if the calendar flags are on) | Calendar event and Teams link created; cancel it afterwards |
| 15 | Watch Jobs and Errors for 30 minutes | Mailbox poller, Zeko sync and reminders run clean; no burst of outgoing mail |

Test 13 is the point where production talks to real people again. Do not pass it with open failures above.

---

## 9. Rollback

Decide at the 60-minute mark, or at once if a smoke test in Part 1 fails and has no quick fix.

| Situation | Action |
|---|---|
| Failure before step 7 (no database change) | Restore the saved build if anything was changed, `pm2 start`. Production is as it was |
| A DDL file fails | The runner rolls that whole file back by itself. Fix and retry, or go to the next row |
| Failure after DDL, before go-live | Restore the backend folder, `dist` and `.env.production` from step 3; `pm2 start`. Leave the new tables and columns in place if they are additive (confirm per file in Gate 3); the old code does not read them |
| A DDL change the old code cannot live with | Run the matching `.rollback.sql` through `run-ddl.mjs` in reverse order (12 → 1), after the code is rolled back |
| One feature misbehaves after go-live | Turn off its flag (`SCREENING_V2`, `FLEXIBLE_STAGES_ENABLED`, `MRF_HOLD_ENABLED`, `MRF_DELEGATE_DECISION_ENABLED`, `MRF_APPROVAL_AUDIT_ENABLED`, `INTERVIEW_PANEL_PACK_ENABLED`, the `MS_*` flags) and restart. Prefer this to a code rollback |
| Unwanted email risk | Set `EMAIL_REDIRECT_TO_TEST=true` and restart. This is the fastest safety switch |
| Templates or settings damaged | Restore the affected rows from the step 4 CSV exports |
| Data corruption | Full `pg_restore` from step 4. Last resort: it loses everything entered since the backup, so it is only acceptable before users are let back in |

After any rollback: confirm health, tell RT, and write down what failed before trying again.

---

## 10. After the release

- **First hour:** a developer watches Logs & errors and `pm2 logs`.
- **Next morning (IST):** check the Jobs tab after the daily jobs have run (offer sweep 07:00, document reminder 09:00, MRF hold sweep, pipeline auto-pause), and ask RT for the first real MRF approval and the first real shortlist.
- **Day 2 to 7:** daily look at Errors; then the weekly checks in the operations runbook.
- **Keep** the database dump and the saved build for at least 14 days.
- **Update** `07-DEVELOPMENT-HISTORY-2026.md` with the real go-live date and commit, and close the two "to confirm" notes there.
- **Follow-ups worth scheduling:** a `deploy-production.sh` modelled on `deploy-staging.sh`; release tags for every production deploy; a separate production database role; a namespaced or separate Redis for production; a backend `.env.example` so key drift is visible in review.

---

## 11. Decisions needed before a date is set

| # | Decision | Owner | Recommendation |
|---|---|---|---|
| 1 | Release date and window | RT + developers | A weekday evening IST, not before a holiday |
| 2 | If Gate 0 gives Outcome A: the seven open decisions in the September plan (duplicate email rows, orphan pointers, recipient seed, module permission, reminder switches, retention, closure templates) | RT + developers | As recommended in that plan |
| 3 | `SCREENING_V2` in production | RT | On only with the N11 sign-off |
| 4 | MRF Hold and decide-on-behalf at go-live | RT | Off at go-live, on after one week of clean approvals |
| 5 | Interview panel pack (JD, CV and report in panel invites) | RT | Decide explicitly; it changes what interviewers receive |
| 6 | Forms & Links menu item | Chhaya | Stays hidden until signed off |
| 7 | Recording flags and 12-month retention | IT + management | On only when the Teams policy is confirmed |
| 8 | Run `seed-email-templates.js` or add new templates by hand | RT + developers | By hand or create-only seeds; no bulk overwrite |
| 9 | Separate Redis for production if it is shared with staging | Server owner | Do it before go-live |
| 10 | Names for the "to name" owners in §3 | Management | Needed before Gate 2 |

---

## 12. Go / no-go checklist

- [ ] Gate 0 done; outcome A, B or C recorded with the production commit
- [ ] Release tag created on the frozen `project-staging` commit; staging runs that commit
- [ ] RT sign-off on UAT and on every flag in §6.2
- [ ] IT confirmed Gate 2 items; flags for anything not ready are `false`
- [ ] Rehearsal on a restored copy passed; timings recorded
- [ ] All access in §3 tested by the person who will use it
- [ ] Shared-Redis question answered and handled
- [ ] Window announced; two developers and one RT contact confirmed; rollback owner named
- [ ] Fresh database backup taken in the window and readable
- [ ] Previous build, `dist` and env file saved
