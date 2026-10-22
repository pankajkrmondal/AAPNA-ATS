# 08 · Onboarding: set up, run, test

**For:** a developer joining the project. **Checked:** 20 Oct 2026 on Windows 11 with Node 24.

## 1. Get the code and the secrets
1. `git clone https://github.com/pankajkrmondal/AAPNA-ATS.git`, then branch off `project-staging`:
   ```
   git checkout project-staging && git pull origin project-staging
   git checkout -b <you>-project-staging-v<N>
   ```
   Work is merged back by pull request into `project-staging`.
2. Ask a developer for the env files. They are not in git and must never go into chat or commits:
   - `backend/.env.development` (local), `backend/.env.staging`, `backend/.env.production` (servers only);
   - `frontend/.env.development` (see `frontend/.env.*.example`).
   Names and meanings: [05-CONFIGURATION.md](05-CONFIGURATION.md).
3. Requirements: Node ≥ 20 (`backend/package.json` engines), and Redis. The repo ships a Windows build in `redis/`: run `redis\redis-server.exe`. Database access is to the staging server; there is no local database.

## 2. Run it locally (four terminals)
```
# 1  Redis
redis\redis-server.exe

# 2  backend API (NODE_ENV=development → .env.development → the STAGING database)
cd backend && npm install && npx prisma generate && npm run dev

# 3  frontend (Vite on http://localhost:5173, proxies /api and /socket.io to :5000)
cd frontend && npm install && npm run dev

# 4  only if USE_RESUME_QUEUE=true: the resume worker
cd backend && npm run queue:worker
```
Sign in at `http://localhost:5173/login` (staff) or `/admin/login` (admin portal), with your own staging account.

**Before you start the backend, read this:**
- Your local backend **runs every scheduled job against the staging database**, beside the staging server's own jobs. Run only one local backend. Stop it when you are done with it for the day.
- Mail is redirected to the test inboxes (`EMAIL_REDIRECT_TO_TEST` / non-production), **except** internal alerts, account mail and interview panel invites you type yourself. Never type a real person's address into a panel field on local or staging.
- On Windows, `prisma generate` fails with `EPERM … query_engine-windows.dll.node` while a backend is running. Stop the backend first, or ignore it if only the schema's JS client changed.

## 3. Tests
| What | Command | Notes |
|---|---|---|
| Backend unit tests | `cd backend && timeout 60 node --test src/tests/unit/<file>.test.js` | **One file at a time.** `npm run test:unit` hangs: its glob also picks up the integration files, which hold Redis open. Top-level files in `src/tests/*.test.js` run the same way |
| Backend integration tests | `cd backend && NODE_ENV=staging node src/tests/run-block.mjs src/tests/integration/<file>.test.js` | Real staging database. Each file creates tagged fixtures and deletes them. Full log in `backend/test-results/`. Check what a file emails before running it |
| Frontend end-to-end | `cd frontend && npx playwright test e2e/<spec>.spec.js` | Uses the running dev server and backend; installed Edge; credentials from `E2E_USER` / `E2E_PASSWORD` (or `VERIFY_EMAIL` / `VERIFY_PASSWORD` in `frontend/.env.development`) |
| Frontend build | `cd frontend && npx vite build` | A green build does **not** catch undefined names in JSX |
| Lint for undefined names | `npx --prefix frontend eslint --config <scratch flat config with no-undef> <files>` | There is no committed ESLint config. Core `no-undef` skips JSX element names, so check new `<Component>` imports by eye |
| Dashboard numbers | `cd backend && NODE_ENV=staging node scripts/check-dashboard-vs-analytics.mjs [--range 7|30|90] [--mrf <id>]` | Every line should print OK |

## 4. Conventions
- **Docs:** plans in `docs/Phase 3 Enhancements or Feedback/` (current) and `docs/phase3/`; one changelog per change set in `docs/changelog/CHANGES-YYYY-MM-DD-<slug>.md` (what users see → how → tests → release steps); RCAs as `docs/RCA-YYYY-MM-DD-<slug>.md`. Every release updates `docs/system/` and `docs/user-guides/` (see [06-OPERATIONS-RUNBOOK.md](06-OPERATIONS-RUNBOOK.md) §2).
- **Schema:** DDL files with rollbacks, never Prisma migrations ([03-DATA-MODEL.md](03-DATA-MODEL.md) §3).
- **Flags:** risky behaviour ships behind an env flag that defaults off (`SCREENING_V2`, `FLEXIBLE_STAGES_ENABLED`, `MS_*_ENABLED`).
- **Errors:** throw `AppError(message, status)` for anything a user should read; let everything else reach `errorHandler` (5xx alert, ref, error log). Wrap async route handlers in `catchAsync`. Run scheduled work through `runJob`. Call outside services through `tracedFetch` / `logExternal`.
- **Logging:** `logger` from `config/logger.js`. Personal data is masked automatically, but still don't log request bodies or whole records.
- **Email:** always `sendGraphEmail` with a flow key resolved through `resolveRecipients`; never bypass the redirect except for the existing `NEVER_REDIRECT` / `OPERATOR_ADDRESSED` flows.
- **Dates:** India time for anything a user reads ("today", "added in the last 7 days").
- **Tracker:** `docs/Phase 3 Enhancements or Feedback/ATS App - Phase wise Task Items.xlsx` holds images and comments. Never save it with openpyxl; edit its XML or update it in Excel.

## 5. Where to look first
- The flow and architecture: [01-SYSTEM-OVERVIEW.md](01-SYSTEM-OVERVIEW.md)
- "Where is X?": [02-MODULES.md](02-MODULES.md)
- "Why is it like this?": [07-DEVELOPMENT-HISTORY-2026.md](07-DEVELOPMENT-HISTORY-2026.md) → the linked plan or RCA
- Something broke: [06-OPERATIONS-RUNBOOK.md](06-OPERATIONS-RUNBOOK.md)
