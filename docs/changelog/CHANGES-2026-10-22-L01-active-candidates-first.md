# L01 · Active candidates first (screening order)

**Date:** 22 Oct 2026 · **Plan:** `PLAN-Phase3-in-Phase4.md` L01, revised with Harish on 22 Oct (design approved: Option A, A1 on, A2 on, 15-day window).
**Replaces:** the earlier L01 idea of re-tuning the ranking weights. The N09 weights are unchanged.

**Status:**
- **Tested on 22 Oct against the staging database:**
  - unit tests: all of `src/tests/unit/` pass;
  - new `integration/candidateActivityOrder.test.js` passes 3/3: Active (1-day responder before 7-day), then Pending / New, then Inactive; the counts; the unticked order;
  - existing screening tests pass with the new default: `jdGates` 14/14, `keywordFilters` 23/23, `legacyAddedWithin` 3/3;
  - the frontend builds.
- **Not checked in the browser yet:** no test login is configured.
- Nothing is deployed or committed. **No DDL.**

---

## What users see

- **Both screening tabs** have an "Active candidates first" checkbox, ticked by default. Unticked, results are in the old score-only order.
- **Every result card** shows an activity chip:
  - "Active · responded in 2 days (15 Oct 2026)"
  - "Pending response · details requested 18 Oct 2026"
  - "New applicant · profile complete"
  - "Inactive · no response since 02 Jun 2026"
- **The summary bar** counts each group, with a hover explanation.
- **The CSV export** gains these columns: Activity Status, Activity Detail, Details Requested On, Details Submitted On.
- **Settings → Candidate activity** (admins only): the active window, default 15 days, allowed 1–365.

## The rule (`backend/src/utils/candidateActivity.js`)

| Order | Status | Rule |
|---|---|---|
| 1 | Active | Details submitted within the window. Submissions before 14 Oct have no date (`cvMissingTokenStatus = 'RECEIVED'`); they count as Active if the request was within the window. |
| 2 | Pending response | Requested within the window, not submitted. |
| 2 | New applicant | Never requested, added within the window (A1). |
| 3 | Inactive | Everything else. |

- Inside a status, results keep the existing score order.
- Among Active candidates with equal scores, the quicker responder (request → submission) goes first (A2).
- The status never removes anyone from the results.

## Code

**Backend**
- New files:
  - `utils/candidateActivity.js`: the pure rule.
  - `services/candidateActivitySettings.service.js`: the `candidate_active_window_days` setting, and `activityForSearch()`.
- `services/screeningV2.service.js` and `services/screening.service.js` (both search paths, whatever `SCREENING_V2` is):
  - the details columns are selected;
  - every card gets `activity`;
  - the sort is status, then score, then response speed when "Active first" is on;
  - the summary gains `activeFirst`, `activeWindowDays`, `activityCounts` and `activityText`.
- In V2 the order is applied before the AI top-10 pick. The old path picks its AI top 10 earlier; that is noted in the code.
- `utils/screeningCacheKeys.js`: JD results ordered "Active first" are cached under an `:a` suffix. Score-only keys are unchanged, so nothing cached before this release is served in the new order. `allRoleCacheKeys` covers both.
- `controllers/screening.controller.js` and `exports/screening.export.js` pass `activeFirst` through.
- `GET` / `POST /api/settings/candidate-activity`. POST needs `requireAdmin`, clears cached JD results and logs the change.

**Frontend**
- `components/screening/ActivityChip.jsx` (new)
- `pages/CandidateScreening.jsx`: the checkbox on both tabs, the card chip and the summary counts
- `services/screeningService.js`, `hooks/useScreeningData.js`: `activeFirst` in the request and the query key
- `components/settings/CandidateActivityCard.jsx` (new), `pages/Settings.jsx`, `services/settingsService.js`

**Docs:** `docs/Screening-Rules-for-RT.md`, new section "Active candidates first".

## Release steps
1. No DDL. The setting is created on the first save; until then 15 days is used.
2. After deploy, the old cache keys are never read in "Active first" mode, so no cache flush is needed.

## Still to test
- In the browser: the chips, the counts and the checkbox on both tabs; the CSV columns; the Settings card (save, reset, hidden for non-admins).
