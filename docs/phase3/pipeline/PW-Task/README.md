# Flexible stage movement: test plans and test cases

Feature plan: [../FLEXIBLE-STAGE-MOVEMENT-DRAG-DROP-PLAN.md](../FLEXIBLE-STAGE-MOVEMENT-DRAG-DROP-PLAN.md)

One file per build task (§6 of the plan). Each file holds the test plan, the test cases, and a results log. Results are appended as runs happen; nothing is deleted.

| Task | File | Plan §6 phase | Status (16 Oct 2026, run 2) |
|---|---|---|---|
| T1 | [T1-DDL-and-backfill.md](T1-DDL-and-backfill.md) | 1 | **Applied to staging.** All 16 cases pass |
| T2 | [T2-Backend-move-lock-landing.md](T2-Backend-move-lock-landing.md) | 2 | 24 pass, 1 not run (T2-24, no vendor account) |
| T3 | [T3-Undo-actions.md](T3-Undo-actions.md) | 3 | 16 pass, 1 not run live (T3-15, would call Zeko's external API) |
| T4 | [T4-Move-menu-popup-drawer.md](T4-Move-menu-popup-drawer.md) | 4 | All 16 pass after fixes for issues #2, #3, #4, #6 |
| T5 | [T5-Drag-and-drop.md](T5-Drag-and-drop.md) | 5 | All 13 pass after fixes for issues #1, #5 |
| T6 | [T6-Move-history-dossier-analytics.md](T6-Move-history-dossier-analytics.md) | 6 | All 11 pass |
| T7 | [T7-Regression-flag-off.md](T7-Regression-flag-off.md) | 7 | 6 pass; T7-02 partial (integration suites need a fixture MRF purged on 28 Sep) |

## Issues found in the browser and fixed (run 2)

| # | Found in | Issue | Fix | Re-test |
|---|---|---|---|---|
| 1 | T5-03 | Board columns stretched to 414-508 px when a card had a long nowrap line (vendor email); the arrow scroll step assumes 260 px | `minWidth: 0` on the column (`Pipeline.jsx` `DroppableColumn`) | PASS, all 260 px |
| 2 | T4-08 | The swap button's "Move to…" tooltip stayed over the open menu and swallowed clicks on the top items | Tooltip hidden while the menu is open (`CardMoveControl`) | PASS |
| 3 | T4-09 | A locked card's wrapper carried `aria-disabled="true"`, so the whole card (incl. click-to-open) read as disabled | No dnd-kit attributes on a locked card (`DraggableCard`) | PASS |
| 4 | T4-11 | The drawer's locked "Move to…" never showed the lock reason (disabled button fires no hover) | Wrapped in a span that carries the tooltip (`PipelineDrawer.jsx`) | PASS |
| 5 | T5-07 | Dropping on a greyed (passed) column opened the popup for the NEIGHBOURING column | Pointer-based collision detection (`boardCollision`) | PASS, no popup |
| 6 | T4-11 | After sending an Evalground invite the drawer kept offering "Move to…" (stale lock) | Invite mutation reloads the drawer detail | PASS |

## Test data

Fixture: `node src/tests/helpers/flexStageFixture.js seed | status | teardown` (tag `FLEXSTAGE-TESTPASS-FIXTURE`, MRF 686 "FlexStage Test Role", journeys 2369-2375). Left in place after run 2 for review; remove with `teardown` (deletes only rows found through the tag, by explicit id).

## Test environment

| Item | Value |
|---|---|
| App (local) | Frontend `http://localhost:5173` (Vite), backend `http://localhost:5000` |
| Database | Staging `recruitmentautomationdb` (local dev points at it). Never production |
| Flag | `FLEXIBLE_STAGES_ENABLED=true` in `backend/.env.development` for the flag-on runs; removed/false for T7 |
| Login | Staff user with Candidate Pipeline access (credentials held by the tester, not stored here) |
| Browser tool | Playwright MCP |
| Email | Staging redirects all candidate mail to the test inbox (`EMAIL_REDIRECT_TO_TEST=true`); check `rpa_email_log` |

## Run order

1. Apply the DDL to staging with the guarded runner (T1), dry run first.
2. `npm run prisma:generate` with the dev server and queue worker stopped.
3. Start backend (`npm run dev`) and frontend (`npm run dev`).
4. Run T2 to T6 with the flag on, fixing and re-testing until no issue remains.
5. Run T7 with the flag off.

## Blocker log

| Date | Blocker | Effect |
|---|---|---|
| 16 Oct 2026 | Staging DB host `20.244.34.176:5432` does not answer from this machine (TCP connect times out; other internet works). Likely VPN / IP allow-list | DDL not applied; backend cannot start against the DB; no Playwright run possible yet |
| 16 Oct 2026 | Resolved: VPN connected | Run 2 completed the same day |
