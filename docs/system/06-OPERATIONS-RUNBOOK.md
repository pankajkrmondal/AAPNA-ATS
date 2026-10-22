# 06 · Operations runbook

**For:** the developer on call. **Last reviewed:** 20 Oct 2026.

Start here when HR reports a problem, an alert email arrives, or something looks wrong.

---

## 1. Logs & errors (start here)

**Where:** sign in to the admin portal as a **Super Admin** → `/admin/dashboard` → **Logs & errors** tab. No server login is needed.

| Tab | Use it for |
|---|---|
| **Errors** | What has gone wrong recently. One row per kind of error, with count, users affected, environment and the latest ref. Expand a row for every occurrence with its stack. Sources: **Server** (5xx and crashes), **Job** (a scheduled job failed), **Browser** (a screen crashed, or a call failed before reaching the server). Kept 30 days. |
| **Find a ref** | HR quotes a ref ("Something went wrong… (ref: K7Q2MX)"), or an alert email gives one. Paste it to see the stored error (user, route, stack) and every log line of that request in time order, including outside calls (`[external] graph POST …/sendMail HTTP 503 in 812 ms`). Job refs look like `job-mailboxPoller-K7Q2MX`. |
| **Jobs** | Every scheduled job's last run, last success, last failure and error. **Failing** = the last run failed. Rows for other environments (a local backend on the staging database shows as `development`) are dimmed. |
| **Health** | Runs live checks of the database, Redis, the upload queue and the Microsoft login, each with a 5-second limit. |

**What gets logged:**
- every request (`GET /api/… 200 … ref=K7Q2MX`), at `http` level, always in `combined.log`;
- every call to Graph, Zeko, OpenRouter, Gemini, Cohere, Turnstile and n8n: service, method, host + templated path, status, duration. Never bodies, headers or query strings;
- emails and phone numbers are masked in every line (`a***@domain.com`, `******3210`);
- the user is on every line of a signed-in request (`userId`).

**Alert emails** (to the `backendErrorAlert` recipients, never redirected):
- **Backend Error Alert**: a 5xx reached the error handler. At most one per error and route every 5 minutes. It includes the ref.
- **Job failed: (job name)**: at most hourly per job and error. Check the Jobs tab to see whether later runs recovered.
- **Backend crashed**: an uncaught exception or unhandled rejection. The process exits; PM2 restarts it.

**If the page itself is unavailable:**
- server logs: `backend/logs/combined.log`, `error.log` (JSON lines; `grep K7Q2MX combined*.log`);
- PM2: `pm2 logs ats-prod-backend`, files `backend/logs/pm2-<env>-backend-*.log`;
- plain health check: `curl https://<host>/api/health` (no auth, uptime only).

## 2. Deploy, restart, roll back

**Releases go dev → staging → (all sections together) → production.** Each release:
1. Back up production: `pg_dump` (`docs/deployment/PHASE3-PRODUCTION-DEPLOYMENT.md`, Step 0).
2. DDL files for the release, staging then production, through `scripts/run-ddl.mjs` (see [03-DATA-MODEL.md](03-DATA-MODEL.md) §3).
3. `npm run prisma:generate`.
4. Deploy the code. Staging: upload, then `cd /var/www/html/ats-platform-staging/backend && ./deploy-staging.sh` (npm ci, prisma generate, Redis ping, `pm2 reload` with zero downtime, `pm2 save`). Production: the same steps by hand in `/var/www/html/ats-platform-prod/backend` with the `ats-prod-*` apps. The frontend is a `vite build` with that environment's `VITE_API_URL`.
5. Run the integration tests for the touched areas (one file at a time, `NODE_ENV=staging`).
6. RT tests on staging (UAT).
7. Production deploy.
8. Update [02-MODULES.md](02-MODULES.md), the affected user guide in `docs/user-guides/`, and [07-DEVELOPMENT-HISTORY-2026.md](07-DEVELOPMENT-HISTORY-2026.md).

**Restart:** `pm2 reload ats-<env>-backend` (zero downtime) or `pm2 restart`. **Status:** `pm2 list`.

**Roll back:**
- code: redeploy the previous build or commit, then `pm2 reload`;
- schema: run the matching `.rollback.sql` through `run-ddl.mjs`, after rolling the code back if the new code needs the object;
- behaviour: prefer the flag (`SCREENING_V2=false`, `FLEXIBLE_STAGES_ENABLED=false`, `MRF_APPROVAL_AUDIT_ENABLED=false`…), then `pm2 reload --update-env`.

## 3. Known failures and fixes

| Symptom | Likely cause | What to do |
|---|---|---|
| Emails stop; errors mention `401`/`invalid_client` from `login.microsoftonline.com` | The Graph client secret expired or was rotated | IT issues a new secret → update `MS_CLIENT_SECRET` in the env file → `pm2 reload --update-env`. Health tab: "microsoft graph login" goes green. Setup: `docs/deployment/MS-GRAPH-PRODUCTION-SETUP.md` |
| Graph `403` on calendar, attendance or recordings | Permission not granted in this tenant | Feature falls back (no event / manual confirm). Grant the permission (`docs/phase3/MS-GRAPH-SETUP-FOR-IT.md`) or leave the flag off |
| "Too many requests" for users | Our API limiter: proxy IP not trusted, or limits too low | `TRUST_PROXY=true` behind nginx; see `docs/RATE_LIMIT_429_FIX.md` |
| AI parsing slow or failing; `[external] openrouter … 429` / `gemini … 429` | Provider rate limit or quota | `generateContentWithFallback` already retries and falls back. If sustained: check the provider dashboard and quota; uploads can be reprocessed from HR Upload → Jobs |
| Zeko scores not arriving; Jobs shows `zekoResults` or `zekoJobs` failing | Dashboard cookie expired and the OTP login failed (often because the mailbox poll is down), or Zeko API change | Check `mailboxPoller` is OK first. Run one pass by hand from `backend/`: `NODE_ENV=staging node -e "import('./src/services/zeko.service.js').then(m => m.fetchInterviewResults()).finally(() => process.exit(0))"` (`syncZekoJobs` for the catalog and token). The `npm run zeko:*` scripts point at a `scratch/run_zeko_sync.js` that is not in the repo. Background: `docs/PLAN-2026-08-25-zeko-report-api-score-sync.md`, `docs/RCA-2026-08-25-*` |
| A Zeko round shows another round's score / wrong candidate | Fixed in Aug; if it recurs, same family | `docs/RCA-2026-08-25-zeko-functional-round-shows-hr-score.md` |
| "Resume Processing Failed" for one file, every retry | A code / schema mismatch on the duplicate path (`rpa_cv` vs `rpa_cv_tmp` columns), or a corrupt file | Find the ref or the error in Logs & errors → stack. Precedent: `docs/phase3/RESUME-PROCESSING-FAILED-CV-TMP-ITEM-ID-RCA.md` (one DDL + one-line fix) |
| Uploads stuck "processing" | Process restarted mid-batch (in-process parsing) or the worker is down (queue mode) | HR Upload → Jobs → Reprocess. With `USE_RESUME_QUEUE=true`: Health → resume queue; `pm2 list` for the worker |
| A status change "worked" but the old screens don't show it | A CHECK constraint rejected the mirror write inside a best-effort `try/catch` | [03-DATA-MODEL.md](03-DATA-MODEL.md) §4; widen the CHECK with a DDL file |
| A 500 after a deploy mentioning an unknown field (`PrismaClientValidationError`) | Code deployed before its DDL, or `prisma generate` not run | Run the DDL / generate, `pm2 reload` |
| Emailed CVs or replies not appearing | `mailboxPoller` failing, or intake/sync flags off for this environment | Jobs tab; env `EMAIL_INTAKE_ENABLED` / `INBOUND_SYNC_ENABLED`. To force a re-read of the last 24 h, delete `rpa_settings.mailbox_delta_link` |
| Reminders sent twice | Two API processes on one database (e.g. a second local backend, or PM2 cluster mode) | Run one API process per database; `instances: 1`, `exec_mode: fork` in `ecosystem.config.cjs` |
| Staging mail reached a business person | A flow in `NEVER_REDIRECT` / `OPERATOR_ADDRESSED`, or a stored `email_recipients.*` override | [05-CONFIGURATION.md](05-CONFIGURATION.md) §3 |

## 4. Weekly checks (15 minutes)

1. **Logs & errors → Errors**, last 7 days, production: anything new or growing? Open the top three.
2. **Jobs**: every production job ran in its expected window and none is failing.
3. **Health**: all green.
4. Disk on the servers: `backend/logs`, `backend/uploads`, and OneDrive quota if recording archive is on.
5. Graph client secret expiry date: renew at least 2 weeks before.
6. `rpa_settings` `email_recipients.*` in production still match what RT expects.

## 5. Owners and contacts

| Area | Owner |
|---|---|
| Application code, deploys, this runbook | Harish Mopuri, Pankaj Kumar Mondal (developers) |
| Recruitment process, UAT, wording | RT (Chhaya, Naveen) |
| Microsoft 365 tenant, Graph permissions, mailbox | AAPNA IT (to name) |
| Zeko, Evalground, OpenRouter / Gemini / Cohere accounts | to name (account owner and billing contact) |
| Servers (staging and production host) | to name |

Fill the "to name" rows when the owners are confirmed.
