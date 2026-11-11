# U04 · Commas in keyword skills and location
**Release 1 · Medium · 6 h · Depends on: none to build. Turning the flag on in production needs N11 (not built yet; see step 7).**

**Goal**
- **Today:** "Comma is not working for skill or location; it picks one option only."
- **Change:**
  - a location matches a word inside each part ("Delhi" finds "New Delhi")
  - a clear All / Any skills choice
  - the parsed terms are shown in the summary
- **Done when:** "Java, Python" and "Noida, Delhi" return the expected candidates.

**Decision:** fix only the **strict path**, then turn `SCREENING_V2` on. The old path is not patched.

## Cause (verified)
**Which path runs.** `backend/src/controllers/screening.controller.js:75-82` runs the strict search only when `SCREENING_V2` is on (`backend/src/config/index.js:333`; default false). Otherwise the old `screeningService.searchKeywordCandidates` runs (`backend/src/services/screening.service.js:1213`). The old path:
- ORs the skills (`:1251-1257`)
- ignores `matchMode`
- ignores location whenever skills are typed (`:1306-1331`)
- matches the whole joined location string (`:1351-1352`)

**The strict path** (`backend/src/utils/screeningFilters.js`):
- Skills: All/Any already works (`:393-397`, JS `:605-610`).
- Location: one stored part must **equal** a typed city (SQL `:415-423`, JS `:567-570`, `locationParts` `:227-233`). This is on purpose, per the header comment at `:20-21`, but it means "Delhi" doesn't find "New Delhi".

**Frontend** (`frontend/src/pages/CandidateScreening.jsx`):
- Skills is a plain Input (`:1488-1496`).
- "Match any one skill" is a checkbox (`:1484-1486`), sent as `matchMode` (`:707`).
- Location is a tags Select with `tokenSeparators={[',']}` (`:1499-1509`), sent joined (`:710`).
- The summary bar shows only `summaryText` (`:1701-1707`).

## Changes
1. **Confirm the cause on staging:** check `SCREENING_V2` in the staging server's env, and reproduce both searches.
2. **Location rule** in `screeningFilters.js`: a stored part matches when it equals the typed city **or** contains it as a whole word.
   - SQL: add an `OR lp.part ~ ('[[:<:]]' || <escaped city> || '[[:>:]]')` beside the `= ANY(...)` check. Regex-escape the city. Use no backslashes in template literals (see the existing notes). The cheap `LIKE ANY` pre-filter stays.
   - JS mirror: `\b` around the escaped city.
   - Several cities are still ORed.
   - Update the header comment at `:20-21`.
3. **Tests:** change the assertions that "Noida" doesn't match "Greater Noida". It now does, by HR's request.
   - `backend/src/tests/unit/screeningFilters.test.js:240-242`
   - `backend/src/tests/integration/keywordFilters.test.js:130-131`
   - Add cases for "Delhi" finding "New Delhi" and "Noida, Delhi" finding both.
4. **All / Any:** replace the checkbox at `CandidateScreening.jsx:1484-1486` with an AntD `Segmented` control, "All skills | Any skill", next to Skills. The payload stays `matchMode: 'all' | 'any'`.
5. **Parsed terms:**
   - `backend/src/services/screeningV2.service.js:544-571` adds `summary.terms = { skills: f.skills, location: f.location, matchMode }`.
   - `CandidateScreening.jsx:1701-1707` shows the terms as Tags: "Skills (all): Java · Python · Location (any): Noida · Delhi".
6. **Location input:** check in the browser whether a half-typed last city is lost when Search is pressed. If it is, commit the pending search text into the value on submit.
7. **Turn the flag on:**
   - **Staging:** set `SCREENING_V2=true` so Chhaya's UAT tests the strict path.
   - **Production:** this is gated on RT signing off the N11 before/after check. **The N11 script was never built.** `backend/scripts/screening-compare.mjs` does not exist; `docs/CHANGELOG.md:245` says N11 is waiting for production data. Its design is in `docs/Phase 3 Enhancements or Feedback/PLAN-Phase3-Now.md` §N11 (6 h).
   - Building N11 is a **separate chat** and is not part of this brief.
   - Until N11 is built and signed off, production keeps the old path. Record that in Handoff and in `docs/system/05-CONFIGURATION.md:63,132`.

## Tests
- `node --test src/tests/unit/screeningFilters.test.js`
- `node src/tests/run-block.mjs src/tests/integration/keywordFilters.test.js`
- `cd frontend && npm run build`, plus a browser check of the Segmented control and the chips
- Write a changelog. It should mention that this reverses the 13 Oct strict-location rule (`docs/changelog/CHANGES-2026-10-13-strict-keyword-filtering.md`).

## Handoff
**Built 10 Nov.** Changelog: `docs/changelog/CHANGES-2026-11-10-U04-keyword-commas.md`.
- **Location: step 2 not done, by decision.** HR decided on 10 Nov to keep the exact part match: "Delhi" means Delhi only, and each of several cities is matched exactly (ORed). A whole-word version was built and then reverted. `screeningFilters.js` matches `ff3aa34` again except its header comment. The tests now pin the exact rule ("Delhi" ≠ "New Delhi", "Noida, Delhi" ≠ "Greater Noida").
- **Summary:** `screeningV2.service.js` keyword summary has `terms: { skills, location, matchMode }`.
- **Frontend** (`CandidateScreening.jsx`, `theme/index.css`): `Segmented` "All skills | Any skill" (form field `matchMode`, replaces `anySkill`), plus term chips at the foot of the summary bar. Step 6: no change needed, because the Select commits a half-typed city on blur (checked in the browser).
- **e2e:** `helpers/screening.js` and `keyword-screening.spec.js` now use `skill-match-mode` (not run: needs `E2E_USER`). New `e2e/u04-keyword-commas.spec.js` and `playwright.u04.config.js` (reuses U01's session setup).
- **Tests:** unit `screeningFilters` 62/62; full unit suite 1091/1091; integration `keywordFilters` 25/25 (fixture E is now exactly "Delhi"); frontend build OK; browser U04 spec 1/1.
- **Stale test fixed:** "results sorted by score" failed because of L01's default `activeFirst`. It now passes `activeFirst: false`.
- **Flag, open:** the local `backend/.env.staging` reads `SCREENING_V2=true`, but I couldn't check the staging server itself. Someone with server access should confirm it. The local `.env.production` **also** reads `true` ("Production gets true in the final release"), though N11 isn't built. Left unchanged; decide before the next production deploy. Recorded in `docs/system/05-CONFIGURATION.md`.
- **Side effect:** a second local backend I started hit `EADDRINUSE`. It sent one `crash_alert` email to the dev team (h\*\*\*/p\*\*\*) and wrote an `rpa_error_log` row. It was stopped. The existing backend was untouched.
