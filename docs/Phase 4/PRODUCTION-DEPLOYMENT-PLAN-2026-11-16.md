# ATS — Staging to Production Deployment Plan

**Prepared:** 16 Nov 2026 · **For:** the developer / ops person who runs the deploy
**From:** `https://ats-staging.aapnainfotech.com` (branch `project-staging`)
**To:** `https://ats.aapnainfotech.com` (database `recruitmentautomationdbProd`)
**Builds on:** [R16 release note](uat-fixes/R16-release-16-nov.md) · [Phase 3 production runbook](../deployment/PHASE3-PRODUCTION-DEPLOYMENT.md) · [MS Graph production setup](../deployment/MS-GRAPH-PRODUCTION-SETUP.md)

This plan was written from the repository only. Nothing was read from or changed on the
production server or production database. Every item marked **VERIFY** is something the
repository cannot answer and must be checked on the server before the window starts.

---

## 0. Confirmed on 16 Nov (from the owner's pgAdmin and server checks)

These facts replace the matching **VERIFY** points below. Where this section and a later one disagree, this section is right.

| Fact | Source | What it changes |
|---|---|---|
| Production runs from `/var/www/html/ats-platform-production/backend` | `pm2 describe` | Neither path in the repo is right. Use this one everywhere |
| `ats-prod-backend` was started as `npm run start:prod`, not from `ecosystem.config.cjs`. Up since 12 Oct, 0 restarts. Node 24.16.0 | `pm2 describe` | Restart with `pm2 restart ats-prod-backend --update-env`. Node version is fine |
| Production code is deployed by file upload (SFTP), not git | FileZilla listing | No `git pull` on the server. See §6.3 |
| **Production code is older than `main`.** Its newest DDL file is `2026-09-25-mrf-approval-audit.sql`, so the code dates from between 25 Sep and 15 Oct | Owner's code backup of 16 Nov | The release is bigger than "main → staging". Six more DDL files are probably missing (§5.2b). Features built 25 Sep – 22 Oct (flexible stages, error log, JD tagging on upload) go live for the first time too |
| All 7 November DDL columns are **missing** on production; the 4 prerequisite tables exist | pgAdmin, production | All 7 files in §6.4 must run |
| All 7 are **present** on staging | pgAdmin, staging | The "Attach the JD" DDL did run on staging. Open item 10 is closed |
| The server's `.env.production` has no `SCREENING_V2`, `FLEXIBLE_STAGES_ENABLED`, `MRF_HOLD_ENABLED`, `MRF_DELEGATE_DECISION_ENABLED`, `ZEKO_REMINDER_ENABLED` or `FORMS_DIGEST_ENABLED` | Owner's code backup | All six default to off. `SCREENING_V2=true` and `FLEXIBLE_STAGES_ENABLED=true` must be **added**, or production behaves differently from what was tested on staging |
| **The production server has a plain `backend/.env` set to `NODE_ENV=development` and the staging database** | Owner's code backup | A script run without the right environment on the production server writes to **staging**, silently. See §4.1 |
| Backend dependencies are identical between production and staging | `package.json` comparison | `npm ci` on the backend should change nothing; still run it |
| The server's `frontend/.env.production` has no `VITE_FORMS_LINKS_ENABLED` | Owner's code backup | Add `VITE_FORMS_LINKS_ENABLED=true` before the build |
| A code backup exists at `E:\Recruitment Process Automation\ATS-BackUp\ATS-Production-BACK-UP-16-11-2026` | Owner | It holds the real `.env` files, so keep it private. It has no `uploads/`, `logs/`, `node_modules/` or `dist/`; the database backup is still to do |

| **All 5 October DDL checks are `false` on production** (§5.2b) | pgAdmin, production | All 13 DDL files in §6.4 must run. None can be skipped |
| The production worker is `ats-prod-worker` | `pm2 list` | Use this name in §6.1 and §6.7 |
| **Staging and production run on the same server** (`ats-staging-backend`, `ats-staging-worker`), together with two unrelated apps (`pea-prod-backend`, `pea-staging-backend`) | `pm2 list` | Always name the process: never `pm2 restart all`, `pm2 stop all` or `pm2 delete`. Check the folder with `pwd` before every command. Both environments use the same Redis |
| The features built 25 Sep – 22 Oct are approved for production | Owner, 16 Nov | Open item 4 is closed |
| The production database backup is done | Owner, 16 Nov | Still test that it restores (go/no-go 4), and still export the templates and settings (§6.2) |

| **Staging and production share one resume queue.** Both env files point at Redis `127.0.0.1:6379`, the code sets no Redis database number and no prefix, and the queue name is fixed as `resume-processing` (`backend/src/queues/resumeQueue.js`, `backend/src/config/redis.js`) | Code, plus `pm2 list` showing one server | A resume uploaded on production can be picked up by `ats-staging-worker` and processed against the staging database, and the reverse. This is from reading the code; it has not been observed on the server. **For the window:** `pm2 stop ats-staging-worker` before §6.7 and keep it stopped through the smoke test, so only the production worker takes production uploads. The lasting fix (a per-environment queue prefix or Redis database number) is a code change for after this release |

| The frontend is served by nginx | Owner, 16 Nov | **VERIFY** the site root in the nginx config before the swap in §6.6 |
| The release branch is `project-staging`, not `main` | Owner, 16 Nov | Skip the merge to `main` in §5.1. Tag `d712d82` on `project-staging` instead |
| **The new code (`d712d82`) was uploaded over the live production folder by FTP on 16 Nov**, before the DDL | Owner; FileZilla | See §0.1 |
| Database and `uploads/` backups are done and kept locally | Owner, 16 Nov | — |

### 0.1 State of production after the upload (16 Nov)

Production is in a half-deployed state: **new code on disk, old code in memory, old database schema.**

- The running processes (`ats-prod-backend`, `ats-prod-worker`, up since 12 Oct) still hold the old code, so the site works as before.
- **Do not restart them, and do not reboot the server, until all 13 DDL files are applied and `npx prisma generate` has run.** A restart now starts the new code against the old schema and breaks ordinary pages.
- If either process crashes and PM2 restarts it, the same thing happens. So the DDL should be applied soon.
- The upload folder held `backend/.env.production`, `.env.staging` and `.env.development` (dated 3 Nov), so the server's `.env.production` was very likely overwritten. The uploaded copy points at the production database, port 5001, `EMAIL_REDIRECT_TO_TEST=false`, and already has `SCREENING_V2=true`, `FLEXIBLE_STAGES_ENABLED=true`, `MRF_HOLD_ENABLED=false`, `MRF_DELEGATE_DECISION_ENABLED=false`. Its `DATABASE_URL` and `EMAIL_STAGING_RECIPIENTS` differ from what the server had. **VERIFY** on the server that both are what you want; the old file is in the 16 Nov code backup. `ZEKO_REMINDER_ENABLED` and `FORMS_DIGEST_ENABLED` are still to add.
- The upload held no plain `backend/.env`, so the server's development `.env` (staging database) is still there. The rename in §4.1 still applies.
- The uploaded `frontend/.env.production` says `VITE_FORMS_LINKS_ENABLED=false`. Change it to `true` on the server before building.
- The frontend is not built yet: nginx still serves the old `dist/`. `npm ci` and the build in §6.6 are still to do.
- The upload merged into the old folders, so files this release deleted are still on the server. They are not loaded by the new code.

### 0.2 DDL dry-run results on production (16 Nov, all rolled back, nothing changed)

Run from the developer machine with `run-ddl.mjs --dry-run`, guarded by `--expect-db recruitmentautomationdbProd`.

| # | File | Result | Rows the real run will touch |
|---|---|---|---|
| 1 | `2026-10-14-ceo-round-optional` | OK | 1 stage row updated |
| 2 | `2026-10-14-cv-details-dates` | OK | 9,172 `rpa_cv` rows get `details_requested_at` |
| 3 | `2026-10-15-mrf-jd-item-id` | OK | none |
| 4 | `2026-10-16-flexible-stage-movement` | OK | 193 stage-state rows inserted, then 155 and 31 updated |
| 5 | `2026-10-20-error-log` | OK | none |
| 6 | `2026-10-21-candidate-mrf-tags` | OK | 82 tag rows inserted |
| 7 | `2026-10-22-jd-send-version-label` | OK | none |
| 8 | `2026-10-22-journey-move` | OK | none (the CHECK was re-added without a violation) |
| 9 | `2026-10-22-mrf-hold-and-delegate` | OK | none |
| 10 | `2026-10-22-stage-redo` | **Failed in dry run only** | Statements 1–4 passed, including the unique index. Statement 5 needs `rpa_pipeline_stage_state`, which file 4 creates and the dry run rolled back |
| 11 | `2026-10-23-duplicate-match-id` | OK | none |
| 12 | `2026-11-10-zeko-link-token` | OK | none |
| 13 | `2026-11-12-email-template-attach-jd` | OK | 1 template inserted, 5 updated (same as staging) |

File 10 is expected to pass in the real run, because file 4 will already be applied. That is not proven until it runs. If it does fail, only that file rolls back; files 1–9 stay applied.

### 0.3 DDL applied to production — 16 Nov 2026, 17:41–17:42 IST

All 13 files were applied for real, in the §6.4 order, with the owner's go-ahead. Each printed `COMMITTED.` File 10 (`stage-redo`) passed, as expected once file 4 was in place.

- Run from the developer machine: `node scripts/run-ddl.mjs --env .env.production --expect-db recruitmentautomationdbProd --file <file>`, using the DDL files of commit `d712d82`.
- Rows changed: 1 stage row; 9,173 `rpa_cv` rows given `details_requested_at`; 193 stage-state rows inserted (155 and 31 then updated); 82 MRF tag rows inserted; 1 email template inserted and 5 updated.
- Read-only check afterwards: all 13 objects present. `rpa_pipeline_stage_state` 193 rows, `rpa_candidate_mrf_tags` 82 rows, `rpa_email_templates` 45 rows, no Zeko row without a `link_token`.
- The app was running throughout on the old code. It was not restarted.

**§6.4 is done. Do not run the DDL again** (it is idempotent, so a repeat would do no harm, but there is no reason to). Next is §6.3 from `npx prisma generate` onward, then §6.5–§6.9.

Still open: the nginx site root for the frontend.

---

## 1. Summary

- **What ships:** everything on `origin/project-staging` (`d712d82`, 13 Nov) that production does not have. Production is older than `main` (see §0): its code dates from between 25 Sep and 15 Oct. So this is about seven weeks of work, up to 13 DDL files (7 confirmed, 6 to check in §5.2b), 3 new seed files and 4 data scripts.
- **How:** a short maintenance window (app stopped, about 30–45 minutes). Back up, apply the DDL, deploy the code with new flags off, verify, then switch flags on one at a time.
- **Why a window and not a zero-downtime reload:** the new Prisma client expects the new columns. If new code starts before the DDL, ordinary queries on `rpa_mrf`, `rpa_email_templates` and others fail. See §2, item 1.
- **Biggest risks:** production sends real email (`EMAIL_REDIRECT_TO_TEST=false`), the full template seed wipes HR's edits, and staging and production share one database host and login.

### Go / no-go before starting

| # | Condition | Owner |
|---|---|---|
| 1 | Chhaya has signed off UAT on staging for U01–U11 (R16 §3) — **confirmed by the owner, 16 Nov** | Owner |
| 2 | The commit running on staging is known and equals the commit being released | Dev |
| 3 | `npm run test:unit` passes and `npm run build:prod` succeeds on that commit | Dev |
| 4 | A production database backup has been taken **and test-restored** | Dev / DBA |
| 5 | All access in §3 is confirmed working | Dev |
| 6 | HR / recruiters have been told the window time | Owner |

---

## 2. Findings that change the existing R16 plan

1. **DDL must run before the new code starts, not after.** R16 §4 lists "Deploy" (step 2) before "DDLs" (step 3). The new `schema.prisma` includes the new columns, so the new code needs them on its first query. Use the order in §6: stop app → DDL → code → start.
2. **R16 lists 4 DDL files for production; the branch has 7 new ones.** The three R16 does not mention are `2026-10-22-jd-send-version-label.sql`, `2026-10-22-journey-move.sql` and `2026-10-22-stage-redo.sql`. They may already be on production, but the repository cannot show that. Run the check in §5.2 and apply whichever are missing. All seven are idempotent.
3. **`ZEKO_REMINDER_ENABLED` and `FORMS_DIGEST_ENABLED` are not in the local `backend/.env.production`.** Both default to off in code. R16 wants both on in production, so they must be added by hand (§4.2).
4. **`MRF_HOLD_ENABLED` and `MRF_DELEGATE_DECISION_ENABLED` are `false` in the local production env file** and `true` on staging. Switch on only after the MRF hold DDL and seed are done.
5. **There is no `deploy-production.sh`.** `deploy-staging.sh` covers the backend only: it does not build the frontend, although R16 §2.1 says it does. The frontend build is a separate step (§6.6).
6. **Production deploy path is inconsistent in the repo.** `ecosystem.config.cjs` says `/var/www/html/ats-platform-prod/backend`; the Phase 3 runbook says `/var/www/html/ats-platform/backend`. **VERIFY** with `pm2 describe ats-prod-backend` (look at `exec cwd`).
7. **`2026-11-12-email-template-attach-jd.sql` is not schema-only.** It also inserts a template row and updates existing `rpa_email_templates` rows. Export the templates first (§6.2) and read the dry-run output.
8. **Local branch is 3 commits behind staging.** `pankaj-work-staging-v28` is at `ff3aa34`; `origin/project-staging` is at `d712d82`. Release from `origin/project-staging`, not from the local checkout.
9. **Credentials are written in comments inside the local env files** (database password, old API keys, test account passwords in the root `.env`). They are git-ignored, so they are not in the repository, but they should be removed from the files and the database password rotated after this release. Do not copy those comment lines to the server.

---

## 3. Access needed

Confirm each one works **before** the window. Do not put any of these values in chat, tickets or this document.

| Access | Needed for | Check |
|---|---|---|
| SSH to the production server, as the user that owns PM2 | Everything | `pm2 list` shows `ats-prod-backend` and `ats-prod-worker` |
| Write access to the production deploy directory | Code and env files | `ls -la` in the path from finding 6 |
| GitHub `pankajkrmondal/AAPNA-ATS` — merge to `main`, create tags | Release branch and rollback point | Can open a PR to `main` |
| PostgreSQL on the database host, database `recruitmentautomationdbProd` | DDL, seeds, backup | `select current_database()` returns the production name |
| `pg_dump` / `pg_restore` matching the server's PostgreSQL major version | Backup and restore | `pg_dump --version` |
| Disk space for the dump and the previous release copy | Backup | `df -h` |
| Web server config (nginx or IIS) and reload rights | Frontend `dist/`, proxy to port 5001 | **VERIFY** which web server and its site root |
| Redis on the production server (`127.0.0.1:6379`) | Resume worker queue | `redis-cli ping` → `PONG` |
| Azure app registration used by production (tenant admin) | Mail, calendar, Teams, recordings, OneDrive | Permissions in §4.4 are granted |
| Production mailbox and its OneDrive | Sender, JD links, recordings archive | Can sign in; `Recordings_ATS` folder exists at the drive root |
| Cloudflare dashboard (Turnstile + DNS) | Login widget | Production site key lists `ats.aapnainfotech.com` |
| Zeko production account | Sync, schedule, reminder | Production client id is the one in the env file |
| Gemini, OpenRouter, Cohere production keys | Resume parsing, search ranking | Keys are valid and have quota |
| An ATS Super Admin login on production | Smoke tests, designee setting | Can log in |
| A mailbox you control | Smoke-test recipient | — |

**VERIFY: are staging and production on the same server?** They use different ports (5000 and 5001) and both use Redis at `127.0.0.1:6379`. If it is one server, check the BullMQ queue names or prefix differ per environment, and take care that every command is run in the production directory.

---

## 4. Environment settings

### 4.1 Rules

- The server's `backend/.env.production` is the source of truth. **Edit it in place; do not overwrite it with the local copy or with `.env.staging`.**
- Copy it before editing: `cp .env.production .env.production.bak-20261116`.
- The app loads `.env.production` first, then plain `.env` for anything missing. **Confirmed: the production server has a plain `backend/.env` with `NODE_ENV=development` and the staging database.** Two ways this bites:
  - a seed or script run without `NODE_ENV=production` uses the staging database;
  - the repo's own note in that file says `@prisma/client` loads plain `.env` as soon as it is imported, so a script that imports the database before the config can pick up the staging `DATABASE_URL` **even with `NODE_ENV=production`**.
- **So, for the window:** rename it out of the way (`mv .env .env.dev-unused`) before running any seed or script, after checking `.env.production` holds every key that `.env` does. And before every `--apply`, confirm which database the script is on. `run-ddl.mjs` is safe either way: it reads the file named in `--env` and refuses unless the database equals `--expect-db`.
- Only two keys are required at boot: `DATABASE_URL` and `JWT_SECRET`. A missing flag does not stop the app; it silently leaves the feature off.
- Env changes need `pm2 reload ... --update-env`. Frontend `VITE_` values are baked in at build time, so they need a rebuild.

### 4.2 Backend `.env.production` — keys to check or change

| Key | Local prod value | Action for this release |
|---|---|---|
| `NODE_ENV` | `production` | Keep |
| `PORT` | `5001` | Keep. Must match the web server proxy |
| `DATABASE_URL` | database `recruitmentautomationdbProd`, `connection_limit=8` | Keep. Confirm the database name |
| `FRONTEND_URL` / `PUBLIC_BASE_URL` | `https://ats.aapnainfotech.com` | Keep |
| `TRUST_PROXY` | `true` | Keep |
| `LOG_LEVEL` | `info` | Keep |
| `EMAIL_REDIRECT_TO_TEST` | `false` | **Real candidates get mail.** Decide in §6.8 whether to set `true` for the smoke test |
| `EMAIL_STAGING_RECIPIENTS` | set | Used only while redirect is on. Confirm it is an inbox you control |
| `SCREENING_V2` | `true` locally, **missing on the server** | **Add `true`** (R16: strict search is final) |
| `FLEXIBLE_STAGES_ENABLED` | `true` locally, **missing on the server** | **Add `true`**, only after `2026-10-16-flexible-stage-movement.sql` is applied |
| `MRF_HOLD_ENABLED` | `false` locally, **missing on the server** | Add as `false`; set `true` after §6.4 and §6.5 |
| `MRF_DELEGATE_DECISION_ENABLED` | `false` locally, **missing on the server** | Add as `false`; set `true` after `MRF_HOLD_ENABLED` is confirmed working |
| `ZEKO_REMINDER_ENABLED` | **missing** | Add as `false`; set `true` in §6.9 |
| `FORMS_DIGEST_ENABLED` | **missing** | Add as `false`; set `true` in §6.9 (stays off if U10b slipped) |
| `ZEKO_TEST_PHONE` | not set | Leave unset. It is ignored in production |
| `TURNSTILE_SECRET_KEY` | set | Keep. Must pair with the frontend site key |
| `MS_*`, `ZEKO_*`, `GEMINI_*`, `OPENROUTER_*`, `COHERE_*` | set | Keep the production values. **Never copy from staging**: `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_ONEDRIVE_PARENT_ID`, `MS_DEFAULT_SENDER_EMAIL`, `MS_CALENDAR_MAILBOX`, `ZEKO_CLIENT_ID`, `ZEKO_LOGIN_EMAIL`, `GEMINI_API_KEY`, `COHERE_API_KEY` and `JWT_SECRET` all differ by design |
| `MS_MEETING_RECORD_AUTO`, `MS_RECORDING_*` | on | Keep. Interviews are recorded and archived, about 400 MB per recorded hour |
| `EMAIL_INTAKE_ENABLED`, `INBOUND_SYNC_ENABLED`, `ZEKO_SYNC_ENABLED` | `true` | Keep |

New optional keys in this release, all with safe defaults (add only to tune): `UPLOAD_JOB_STALE_MINUTES` (15), `FORMS_DIGEST_ROLES`, `DOSSIER_*`, `EXPORT_*`, `MRF_APPROVAL_*`, `DOCUMENT_REMINDER_*`, `OFFER_*`.

Compare key names (not values) between server and repo before the window:

```bash
cd <prod backend dir>
grep -oE '^[A-Z0-9_]+' .env.production | sort > /tmp/prod-keys.txt
# compare with the key list in this table; add anything missing
```

### 4.3 Frontend `frontend/.env.production` (tracked in git, public values only)

| Key | Value | Action |
|---|---|---|
| `VITE_API_URL` | `https://ats.aapnainfotech.com` | Keep |
| `VITE_TURNSTILE_SITE_KEY` | production site key | Keep |
| `VITE_FORMS_LINKS_ENABLED` | `false` | Set `true` **before the build in §6.6**. Chhaya Verma approved the "Forms & Links" menu slot (owner, 16 Nov). The file is tracked in git with `false`, so either change it in the release commit or edit it on the server before building |

### 4.4 External services to confirm for production

- **Microsoft Graph (production app registration):** mail send and read, `Calendars.ReadWrite`, `OnlineMeetings.ReadWrite`, `OnlineMeetingRecording.Read.All`, and file access to the production OneDrive. Production uses a different mailbox and app registration from staging, so a permission granted on staging proves nothing here.
- **"Anyone" sharing links:** the JD-as-link email needs anonymous links allowed for the production mailbox's OneDrive. This is the R16 §4.7 check and is done in the smoke test.
- **Cloudflare Turnstile:** the production widget must list `ats.aapnainfotech.com`.
- **Zeko:** production client id, and the login mailbox receives the OTP.

---

## 5. Pre-deployment steps (before the window)

### 5.1 Fix the release commit

```bash
git fetch origin
git log -1 origin/project-staging          # expect d712d82 or later
git log --oneline origin/main..origin/project-staging | wc -l
```

1. **VERIFY** the commit running on the staging server equals `origin/project-staging`.
2. Create the usual backup branch of production code: `project-production-backup-16-11-2026` from the commit production runs today. **VERIFY** that commit on the server (`git log -1` in the deploy directory, or the date of the deployed files if it is not a git checkout).
3. Open a PR `project-staging` → `main`. `main` has one commit staging does not have (`eb6353d`), so expect a merge and review any conflict by hand.
4. After the merge, tag it: `prod-2026-11-16`.
5. On that commit run `cd backend && npm ci && npm run test:unit`, then `cd ../frontend && npm ci && npm run build:prod`.

### 5.2 Find which DDL production still needs (read-only)

```sql
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='rpa_mrf_jd_send'             AND column_name='version_label')          AS jd_send_version_label,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='rpa_candidate_pipeline'      AND column_name='moved_from_pipeline_id') AS journey_move,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='rpa_mrf'                     AND column_name='held_at')                AS mrf_hold_and_delegate,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='rpa_interview_schedule'      AND column_name='superseded_at')          AS stage_redo,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='rpa_cv_tmp'                  AND column_name='matched_cv_id')          AS duplicate_match_id,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='rpa_zeko_candidate_pipeline' AND column_name='link_token')             AS zeko_link_token,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='rpa_email_templates'         AND column_name='attach_jd')              AS email_template_attach_jd;
```

`false` means that file must be applied. Also confirm the older DDL is in place, because the new files alter tables the older ones create:

```sql
SELECT to_regclass('public.rpa_mrf_approval_events')     AS mrf_approval_audit,   -- 2026-09-25
       to_regclass('public.rpa_mrf_jd_send')             AS mrf_jd_send,
       to_regclass('public.rpa_zeko_candidate_pipeline') AS zeko_pipeline,
       to_regclass('public.rpa_interview_schedule')      AS interview_schedule;
```

**Result, 16 Nov:** production returned `false` for all seven and all four tables exist. Staging returned `true` for all seven.

### 5.2b Check the six October DDL files (read-only) — still to run

Production's code stops at the 25 Sep DDL, so these six were probably never applied. Run on production:

```sql
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='rpa_cv'  AND column_name='details_requested_at') AS cv_details_dates,         -- 2026-10-14
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='rpa_mrf' AND column_name='jd_item_id')           AS mrf_jd_item_id,           -- 2026-10-15
  to_regclass('public.rpa_pipeline_stage_state') IS NOT NULL                                                          AS flexible_stage_movement,  -- 2026-10-16
  to_regclass('public.rpa_error_log')            IS NOT NULL                                                          AS error_log,                -- 2026-10-20
  to_regclass('public.rpa_candidate_mrf_tags')   IS NOT NULL                                                          AS candidate_mrf_tags;       -- 2026-10-21
```

The sixth, `2026-10-14-ceo-round-optional.sql`, only updates rows in `rpa_pipeline_stages`, so it has no column to look for. Treat it as not applied and let its dry run show what it would change.

Three of these six are not schema-only: `cv-details-dates` updates `rpa_cv` rows, and `flexible-stage-movement` and `candidate-mrf-tags` insert backfill rows from existing data. Production has far more rows than staging, so read each dry run's row counts before the real run.

### 5.3 Checks for the two DDL files that can fail on real data

```sql
-- journey-move re-adds a CHECK. Any value outside its list makes it fail.
SELECT pipeline_status, count(*) FROM rpa_shortlisted_candidates GROUP BY 1 ORDER BY 1;

-- zeko-link-token and stage-redo take a table lock; know the row counts.
SELECT (SELECT count(*) FROM rpa_zeko_candidate_pipeline) AS zeko_rows,
       (SELECT count(*) FROM rpa_interview_schedule)      AS schedule_rows;
```

`stage-redo` drops and recreates the unique index `uq_interview_schedule_live`. If production holds two live bookings for the same round, the create fails. The dry run in §6.4 shows this without changing anything.

---

## 6. Deployment steps (inside the window)

Run in order. Do not go past a failed check.

### 6.1 Announce and stop the app

```bash
pm2 stop ats-prod-backend ats-prod-worker
pm2 list
```

Stopping also stops the mailbox poller and Zeko sync, so nothing writes during the DDL.

### 6.2 Back up

```bash
pg_dump "<PROD_DATABASE_URL>" -Fc -f /backup/ats-prod-pre-20261116.dump
pg_restore --list /backup/ats-prod-pre-20261116.dump | head      # dump is readable
psql "<PROD_DATABASE_URL>" -c "\copy (SELECT * FROM rpa_email_templates) TO '/backup/templates-20261116.csv' CSV HEADER"
psql "<PROD_DATABASE_URL>" -c "\copy (SELECT * FROM rpa_settings) TO '/backup/settings-20261116.csv' CSV HEADER"

cd <prod root>
cp -a backend  /backup/backend-20261116      # includes .env.production and node_modules
cp -a frontend/dist /backup/dist-20261116
```

Keep the dump off the web root. It holds candidate data.

### 6.3 Put the new code in place (do not start it yet)

Production is deployed by file upload. Export a clean copy of the release commit locally (`git archive prod-2026-11-16 backend frontend`, so no local `.env`, `node_modules` or stray files go up) and upload that.

- **Do not upload any `.env*` file to `backend/`.** The server's own `.env.production` stays.
- **Do not delete or replace `backend/uploads/` or `backend/logs/`.** They are not in the code backup.
- Uploading over the old folder leaves behind files this release deleted. To avoid that, upload `backend/src`, `backend/prisma` and `backend/scripts` as fresh folders (rename the old ones to `src-old` and so on, then upload) rather than merging into them.

Then:

```bash
cd /var/www/html/ats-platform-production/backend
node -v                      # must be 20 or newer
ls .env.production           # still there, still the production file
npm ci                       # keep dev dependencies: cross-env and the prisma CLI live there
npx prisma generate
```

Do not run `prisma db pull` on the server. The committed `schema.prisma` is already correct.

### 6.4 Apply the DDL

Use the guarded runner. It refuses to run if the connected database is not the one named, runs each file in one transaction, and `--dry-run` rolls back on purpose.

Apply all 13, in this order. All are confirmed missing on production (16 Nov).

1. `2026-10-14-ceo-round-optional.sql`
2. `2026-10-14-cv-details-dates.sql`
3. `2026-10-15-mrf-jd-item-id.sql`
4. `2026-10-16-flexible-stage-movement.sql`
5. `2026-10-20-error-log.sql`
6. `2026-10-21-candidate-mrf-tags.sql`
7. `2026-10-22-jd-send-version-label.sql`
8. `2026-10-22-journey-move.sql`
9. `2026-10-22-mrf-hold-and-delegate.sql`
10. `2026-10-22-stage-redo.sql`
11. `2026-10-23-duplicate-match-id.sql`
12. `2026-11-10-zeko-link-token.sql`
13. `2026-11-12-email-template-attach-jd.sql`

Do all 13 dry runs first, in order, before any real run. A dry run rolls back, so a later file that depends on an earlier one may fail its dry run until the earlier one is really applied; if that happens, apply up to that point and continue.

For each file, dry run first, read the output, then run for real:

```bash
node scripts/run-ddl.mjs --env .env.production --expect-db recruitmentautomationdbProd \
     --file prisma/ddl/<file>.sql --dry-run
node scripts/run-ddl.mjs --env .env.production --expect-db recruitmentautomationdbProd \
     --file prisma/ddl/<file>.sql
```

Expected last line: `DRY RUN OK ...` then `COMMITTED.` Afterwards re-run the §5.2 query: every column must be `true`.

Each file has a matching `.rollback.sql` in the same folder.

### 6.5 Seeds and data scripts

**Never run `prisma/seed-email-templates.js`.** It overwrites every template it covers and wipes HR's edits.

Create-only seeds (safe to re-run), each with `--dry-run` first:

```bash
NODE_ENV=production node prisma/seed-mrf-hold-email-templates.js --dry-run
NODE_ENV=production node prisma/seed-zeko-reminder-template.js --dry-run
NODE_ENV=production node prisma/seed-interview-email-templates.js --dry-run
# then the same three without --dry-run
npm run seed:recipients:prod        # adds the scorecardSubmitted recipient
```

`seed-email-recipients.js` writes recipient lists into `rpa_settings`. **VERIFY** before running whether it overwrites existing rows; if it does, compare against the `settings-20261116.csv` export afterwards and restore any list HR had changed.

Data scripts. Each defaults to a dry run; read the output, then add `--apply`. Run with `NODE_ENV=production` and confirm the script is pointed at the production database before applying:

| Script | What `--apply` does | Note |
|---|---|---|
| `scripts/repair-excel-resume-links.mjs` | Clears resume links that point at an Excel workbook | Logged to `rpa_processing_log` |
| `scripts/backfill-extra-contacts.mjs` | Appends second emails and phones found in resumes | Pipeline mail goes to every stored address; read the "review" list |
| `scripts/refresh-panel-invite-templates.mjs` | Refreshes two panel templates only where HR never edited them | Skip if U03b slipped |
| `scripts/move-about-aapna-into-shortlist-template.mjs` | Copies the About AAPNA text into the Shortlist template | Run **after** the new code is live (§6.7), or Keyword shortlists show it twice. Skip if U02c slipped |

### 6.6 Build the frontend

Build to a separate folder and swap, so a failed build never leaves the site without files:

```bash
cd <prod frontend dir>
grep VITE_FORMS_LINKS_ENABLED .env.production     # must say true (approved 16 Nov)
npm ci
npm run build:prod -- --outDir dist-new
mv dist dist-old && mv dist-new dist
```

**VERIFY** the web server's site root is this `dist/` folder.

### 6.7 Start and verify

```bash
cd /var/www/html/ats-platform-production/backend
pm2 restart ats-prod-backend --update-env      # it was started as `npm run start:prod`
pm2 restart ats-prod-worker --update-env
pm2 save
pm2 logs ats-prod-backend --lines 80 --nostream
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5001/api/health
curl -s -o /dev/null -w "%{http_code}\n" https://ats.aapnainfotech.com/api/health
```

Expect `200` from both, no `Missing required environment variable`, no Prisma "column does not exist" error, and the cron registrations in the boot log. Watch `pm2 list` for two minutes: the restart count must not climb.

Now run `move-about-aapna-into-shortlist-template.mjs` (dry run, then `--apply`).

### 6.8 Smoke test

Production has `EMAIL_REDIRECT_TO_TEST=false`. **Recommended:** set it to `true` for the smoke test (reload with `--update-env`), then set it back to `false` at the end and reload. While it is `true`, candidate email, calendar invites, the Zeko invite address and the vendor cc all go to the test inbox.

Use test candidates and a ZZ-TEST MRF only.

| # | Check | Expected |
|---|---|---|
| 1 | Open the site in a private window; hard refresh | New build loads, Turnstile widget shows |
| 2 | Log in as Super Admin, HR and a vendor | Each lands on the right dashboard |
| 3 | Dashboard, MRF list, Candidate Pipeline, Search Candidate | Load with production data, no error toast |
| 4 | Keyword search "Java, Python" with All and Any | Results; no ×0 on a matched skill |
| 5 | Search by a second email and by a "+91 …" number | Candidate found |
| 6 | Email Templates page | HR's edited wording is intact; the new templates exist; "Attach the JD" switch shows |
| 7 | Upload one synthetic resume | Worker processes it; candidate appears |
| 8 | Shortlist a test candidate to your own address | One email, JD attached or linked, About AAPNA once |
| 9 | Open that JD link signed out, in a private window | Opens without a Microsoft sign-in (R16 §4.7). If it fails, tell the owner |
| 10 | Book a Tech round for the test candidate | Calendar event and Teams link created |
| 11 | Logs & errors page, and `logs/pm2-prod-backend-error.log` | No new errors |

Then set `EMAIL_REDIRECT_TO_TEST=false`, reload with `--update-env`, and confirm in the boot log.

### 6.9 Switch the new features on, one at a time

Edit `.env.production`, `pm2 reload ats-prod-backend ats-prod-worker --update-env`, check, then the next.

1. `MRF_HOLD_ENABLED=true` → put a ZZ-TEST MRF on hold and release it.
2. `MRF_DELEGATE_DECISION_ENABLED=true` → an Admin sets **Chhaya Verma** as the designee in Settings › MRF Approval & Hold (named by the owner, 16 Nov; no role move for her). She decides on a ZZ-TEST MRF.
3. `ZEKO_REMINDER_ENABLED=true` → **first** list production Zeko bookings that are not attempted and close within 48 hours. Each of those real candidates gets a reminder once the flag is on. Get the owner's OK on that list.
4. `FORMS_DIGEST_ENABLED=true` → in-app bell note only, no email. First note arrives at 09:00 the next day.
5. "Forms & Links" menu → already on from the build in §6.6. Check the menu item shows for HR and opens `/forms-links`.

### 6.10 Close out

- Remove the repeated sentence from the "MRF Approval Request" template on the Email Templates page (R16 §4.8).
- Fill in the Handoff section of [R16](uat-fixes/R16-release-16-nov.md): what went live, the "anyone" link result, any slip.
- Record each DDL, seed and script run with its time.
- Update the "Phase 3 UAT Fixes - Nov" sheet (back it up first).
- Delete `dist-old` and the `.env.production.bak-*` copy after a few clean days. Keep the database dump per the retention rule.

---

## 7. Rollback

Decide within the window. The trigger is any of: health check not `200`, login failing, a crash loop in PM2, or a smoke test from 1–7 failing with no quick fix.

| Level | When | Steps |
|---|---|---|
| 1. Flags | A new feature misbehaves, the rest is fine | Set that flag back to `false`, reload with `--update-env` |
| 2. Code | The new build is broken | `pm2 stop` both apps → restore `/backup/backend-20261116` and `/backup/dist-20261116` → `pm2 start` both. The new columns can stay: they are additive and the old code ignores them |
| 3. Schema | A DDL change itself causes harm | With the app stopped, run the matching `.rollback.sql` through `run-ddl.mjs` (dry run first), newest file first |
| 4. Templates | Template wording was damaged | Restore the affected rows from `templates-20261116.csv` |
| 5. Full restore | Last resort only | `pg_restore` the dump. This loses every candidate, MRF and email recorded since the backup |

Two things a rollback does not undo: emails already sent to candidates, and rows changed by the `--apply` scripts (those are logged, and are restored by hand or by level 5).

---

## 8. After the deploy

- **First hour:** `pm2 logs`, restart counts, the Logs & errors page, and the mailbox poller and Zeko sync runs in the log.
- **Next morning:** the 09:00 forms digest bell note; the first Zeko reminder; one real interview booking end to end (join details, recording, scorecard).
- **Within a week:**
  - Remove the credentials written in comments in the local env files, and rotate the database password (staging and production share the same login).
  - Add a `deploy-production.sh` modelled on `deploy-staging.sh`, including the frontend build.
  - Correct the production path in either `ecosystem.config.cjs` or the Phase 3 runbook so they agree.
  - Give production its own database login, so a staging command can never write to production.

---

## 9. Open items to confirm (all VERIFY points in one place)

| # | Question | Who can answer |
|---|---|---|
| 1 | Is `backend/uploads/` on production backed up? It is not in the code backup | Server |
| 2 | Which commit is running on staging, and is it the UAT-approved one? | Server / owner |
| 5 | Are staging and production on the same server and the same Redis? | Server |
| 6 | Which web server serves `dist/` and proxies `/api` to port 5001? | Server |
| 7 | Does a plain `backend/.env` exist on production, and what does it hold? | Server |
| 8 | Which of the 7 DDL files are already applied? (§5.2) | Production DB, read-only |
| 9 | Does the server's `.env.production` match the table in §4.2? | Server |
| 10 | Was `2026-11-12-email-template-attach-jd.sql` really applied on staging? The U02b Handoff (12 Nov) says the real run was blocked and only the dry run passed (1 template inserted, 5 updated). Run the §5.2 query on the **staging** database too; if `email_template_attach_jd` is `false` there, the JD switch was never tested in UAT | Staging DB, read-only |

**Checked 16 Nov — nothing slipped.** The Handoffs of U02b, U02c, U03b, U04b, U06b, U10b and U10c all say "built", and their code is on `origin/project-staging`. So every script in §6.5 and every flag in §6.9 applies; none is skipped. What the Handoffs leave open is testing, not code: the full `npm run test:unit` run, the integration suites, and a browser check of the "Attach the JD" switch were left for the owner to run.

**Answered by the owner on 16 Nov:** UAT is signed off by Chhaya · the MRF designee is Chhaya Verma · the "Forms & Links" menu slot is approved.
