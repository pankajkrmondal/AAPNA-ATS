# UAT fixes (Nov): conventions for every feature chat

Read this file and **one** brief, plus the Handoff section of any brief your brief depends on. Nothing else is needed to start.
Index and status: [../PLAN-Phase3-UAT-Fixes-Nov.md](../PLAN-Phase3-UAT-Fixes-Nov.md).

## Codebase
- **Paths** are relative to `AAPNA-ATS/`.
- **Branch:** `harish-project-staging-v31`. The briefs' line numbers were checked at `ff3aa34`.
- **Backend:** Node, Express, Prisma, PostgreSQL + pgvector, node-cron jobs (`backend/src`).
- **Frontend:** React 18, Vite, Ant Design 5 (`frontend/src`).
- **Local backend:** it uses the **staging** database and runs the scheduled jobs there. Read `docs/system/08-ONBOARDING.md` §2 before starting one.

## Token rules
1. **Reading.** Open only the files and line ranges the brief lists. In large files, `Grep` for the named function first, then read around the hit. These include `PipelineDrawer.jsx` (~4.4k lines), `screening.service.js` (~3.3k), `hrUpload.service.js` and `candidateDossier.export.js`.
2. **No exploring.** Don't use Explore or Plan agents. Don't run repo-wide searches unless the brief turns out to be wrong.
3. **Moved lines.** Earlier chats change some shared files, so a line may have moved. `Grep` for the function name instead of re-reading the file. The shared files are:
   - `hrUpload.service.js` (U01, U05)
   - `interviewPanelPack.service.js` (U01, U02, U03, U07)
   - `PipelineDrawer.jsx` (U01, U03)
4. **Tests.** Run single test files while working. Run the full unit suite once at the end, and only the integration file the brief names.
5. **Output.** Keep the changelog and the Handoff to about 15 lines each. Don't paste code into the docs.
6. **Scope.** If an item turns out much bigger than its brief, stop. Write the reason in Handoff and leave the rest for a follow-up chat.

## Tests
| What | Command (from `backend/` unless noted) |
|---|---|
| One unit suite | `node --test src/tests/unit/<file>.test.js` (some older suites sit directly in `src/tests/`) |
| All unit suites | `npm run test:unit` (`src/tests/unit/` and the older suites directly in `src/tests/`; about 1 min). Run it once at the end. Since 10 Nov it leaves out `src/tests/integration/`; before that it ran those suites too and hung. |
| One integration suite (staging DB) | `node src/tests/run-block.mjs src/tests/integration/<file>.test.js`. Logs go to `backend/test-results/`. |
| Frontend build | `cd frontend && npm run build` |
| Frontend browser | `cd frontend && npm run e2e` (Playwright), or the `AAPNA-ATS/frontend:verify` skill |

Headless Edge must run from PowerShell, because the Bash sandbox blocks it. Edge also needs `--no-sandbox`.

## Change conventions
- **DDL:** `backend/prisma/ddl/2026-11-DD-<name>.sql` plus `2026-11-DD-<name>.rollback.sql`. Then update `backend/prisma/schema.prisma` and run `npx prisma generate`.
- **Changelog:** one per item, `docs/changelog/CHANGES-2026-11-DD-Uxx-<slug>.md`. Frontend changes also get a line in `frontend/UI-CHANGELOG.md`.
- **Flags:** every new env flag goes in `docs/system/05-CONFIGURATION.md`, with its default and its staging / production value.
- **Email safety:** staging sends **real** email. Test sends go to our own addresses only.
- **Git:** don't commit or push unless asked.

## Finishing a chat
1. Fill the brief's **Handoff** section: what changed (files), any new helper names and signatures, the tests run with their pass counts, and anything left over.
2. Set the item's row in `../PLAN-Phase3-UAT-Fixes-Nov.md` to `Built`, `Tested on staging` or `Blocked: <why>`.
