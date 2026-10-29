# Zeko bearer token without n8n: plan

**Date:** 29 Oct 2026 · **Branch:** `pankaj-work-staging-v25` · **Test plan and results:** [TEST-PLAN.md](TEST-PLAN.md)

**Goal:** stop the n8n workflow **"Zeko — FULLY AUTO Sync (API Key Auth)"** on staging and production, and keep Zeko scheduling and cancelling working.

## 1. Problem

The n8n workflow keeps `rpa_zeko_auth_token` fresh. It checks for a token that stays valid for at least 10 more minutes. If none exists, it calls `POST /api/v1/auth/token` (client id + API key) and saves the new token.

The ATS only reads that table. It never refreshes it:

| Where | What it does |
|---|---|
| `scheduleInterview()` (`screening.service.js`) | Reads the active token; throws **"No active authentication token found for Zeko APIs."** (500) if none |
| `cancelInterview()` (`screening.service.js`) | Same |

Zeko tokens live 1 hour (`expires_in = 3600`). With n8n stopped, scheduling and cancelling a Zeko interview break within an hour.

The ATS already has a port of the workflow, `ensureZekoToken()` in `zeko.service.js`, but nothing calls it. Until commit `74e1dc7` (24 Aug 2026) the results fetch called it, and that kept the token fresh as a side effect. That commit moved the results fetch to the cookie API and removed the only call.

Staging on 29 Oct 2026, 11:55 UTC: one token row, `created_by = api_key_workflow` (written by n8n), 1 hour lifetime.

## 2. The other Zeko jobs already run in the ATS

| n8n job | In the ATS | Auth | Needs n8n? |
|---|---|---|---|
| Job catalog sync (top branch of the staging workflow, already deactivated) | `zekoJobs` cron → `syncZekoJobs()` | OTP cookie | No |
| OTP login (dashboard cookie) | `refreshZekoCookie()`, run automatically when the cookie is refused | Mailbox OTP | No |
| Fetch interview results | `zekoResults` cron → `fetchInterviewResults()` | OTP cookie | No |
| **Bearer token refresh** (bottom branch) | `ensureZekoToken()` exists but is never called | API key | **Yes: this plan fixes it** |

After this change, no Zeko function depends on n8n.

## 3. Code changes

No DDL, no schema change, no frontend change, no new environment variable.

### 3.1 `backend/src/services/zeko.service.js`
- **`resolveZekoClientId()`** (new, exported): the `rpa_settings` row `ZEKO_CLIENT_ID` first, then the `ZEKO_CLIENT_ID` env value. This is the rule `scheduleInterview()` already uses. The token is now minted for the same client the booking names.
- **`ensureZekoToken({ forceRefresh })`**:
  - Reuses a token that stays valid for at least 10 more minutes; otherwise mints a new one.
  - Concurrent callers in one process share one mint, so a burst of schedule clicks after expiry makes a single token request.
  - `forceRefresh` skips the reuse step.
- **`withZekoToken(run, label)`** (new, exported): calls Zeko with the token. This is the same shape as the existing `withDashboardCookie()`.
  - If Zeko refuses a **stored** token, it mints a new one and retries once. Zeko refuses a bad, expired or revoked token with **HTTP 500**, not 401 (probed 29 Oct 2026, see TEST-PLAN issue #1), so it retries on 401, 403 or 500.
  - A token minted for the same call is never retried. A 500 on it is a real Zeko fault.
  - If a token cannot be minted, it raises a clear 503: "Could not sign in to the Zeko interview platform…".

### 3.2 `backend/src/services/screening.service.js`
- `scheduleInterview()` and `cancelInterview()`:
  - Drop the direct `rpa_zeko_auth_token` read and call Zeko through `withZekoToken()`.
  - The schedule path's client id comes from `resolveZekoClientId()`.
- The network-error message (502) and the rest of each function are unchanged.

### 3.3 `backend/src/jobs/zekoScheduler.js`
- The hourly Zeko cron first runs a new **`zekoToken`** job (`ensureZekoToken()`), then the catalog sync.
- `zekoToken` gets its own heartbeat (Super Admin → Logs & errors → Jobs) and the usual developer alert on failure. That way, a revoked API key shows up in the alerts before a recruiter runs into it.
- It runs separately from `zekoJobs`, so a token failure never blocks the catalog sync (which uses the cookie).

### 3.4 Docs
- `docs/system/04-JOBS-AND-INTEGRATIONS.md`: job table and Zeko auth.
- `docs/CHANGELOG.md`.
- The code comments that claimed the cron already refreshed the token.

## 4. Environment requirements

| Env | `ZEKO_CLIENT_ID` | `ZEKO_API_KEY` | `ZEKO_SYNC_ENABLED` | Ready? |
|---|---|---|---|---|
| Staging (`.env.staging`) | set | set | `true` | Yes. `rpa_settings.ZEKO_CLIENT_ID` equals the env value (checked 29 Oct) |
| Production (`.env.production`) | set | set | `true` | Yes, in the repo copy. Confirm on the server and see §6 |
| Local dev (`.env`, `.env.development`) | **missing** | **empty** | not set | **No.** Local runs against the staging DB and has relied on staging n8n's token. Add the staging `ZEKO_CLIENT_ID` and `ZEKO_API_KEY` to both files, or local scheduling fails once n8n stops |

Staging and production share the API key and use different client ids.

## 5. Rollout (staging first)

1. Build and test on the staging branch: unit regression, live token checks, Playwright. See [TEST-PLAN.md](TEST-PLAN.md).
2. Deploy to the staging server and restart the backend.
3. Deactivate the whole staging n8n workflow.
4. Watch staging for at least 2 hours, so the last n8n token has expired:
   - **Jobs** shows a `zekoToken` heartbeat succeeding every hour.
   - New `rpa_zeko_auth_token` rows have `created_by = 'api_key_job'`.
   - Schedule and cancel one test interview. Both work.
5. Production, in the next release:
   - Run the §6 checks.
   - Deploy.
   - Deactivate the production n8n workflow.
   - Watch the same way.
6. **Rollback:** turn the n8n workflow back on. It writes the same table, and the new code reuses any valid token it finds, so no code rollback is needed.

## 6. Production checks before release

These are manual: this session was not allowed to read the production database.

1. `SELECT value FROM rpa_settings WHERE key = 'ZEKO_CLIENT_ID';` on `recruitmentautomationdbProd`:
   - No row: fine.
   - Row equal to the server's `ZEKO_CLIENT_ID`: fine.
   - Row different: find out which client id is right before release. The production n8n node "HTTP: Generate Zeko Token" shows the client id n8n uses today.
2. The production server's env (not only the repo copy) has `ZEKO_CLIENT_ID`, `ZEKO_API_KEY` and `ZEKO_SYNC_ENABLED=true`.

## 7. Risks

| Risk | Handling |
|---|---|
| Zeko revokes a stored token early, for example when another mint replaces it while n8n still runs during the switch-over | One retry with a freshly minted token when Zeko answers 401/403/500 to a stored token (tested in the browser, C3) |
| A real Zeko 500 on a stored, valid token | Costs one extra mint and one retry. The recruiter sees the retry's answer |
| Several recruiters schedule at the moment the token expires | One shared mint per process. Production runs one API process (`ecosystem.config.cjs`: `instances: 1`) |
| API key revoked or rotated at Zeko | The `zekoToken` job fails within the hour and alerts developers. Recruiters get a clear 503, not a 500 |
| Mint latency on a recruiter's click | About 1 s, only when the stored token has under 10 minutes left; the hourly job normally refreshes it first |
