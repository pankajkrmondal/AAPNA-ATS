# L11 · Screening: see who was left out, and why (23 Oct 2026)

**Sheet:** Phase 3 Enh - Later, row 16 ("Candidate Screening - Hidden by system data"). **Plan:** PLAN-Phase3-in-Phase4.md › Other bugs › L11. This supersedes PLAN-Phase4.md P12.

## Why
"For example: 8 recently rejected for this role · 3 meet education, budget and experience · of those, 0 have all 7 mandatory skills. If I wish to see the data, there is no such option."

The strict search (`SCREENING_V2`, on everywhere) only counted the candidates each rule removed. A recruiter could not see who was removed, so when a result was 0 or surprisingly small there was no way to tell whether a rule, or the MRF's own wording, was too strict.

## What changed
- **"See the N not shown"** link in the Candidate Screening summary bar, on both tabs. N is the candidates in scope minus the ones shown. It opens `NotShownDrawer`:
  - **Rule tabs** with counts: All, Recently rejected, Education, Over budget / CTC, Experience, Missing skills, and on the keyword tab also Location, Notice period and the rest.
  - **One row per candidate:** name (opens the profile in a new tab), experience, expected CTC, location, notice, education, when added.
  - **Reasons in plain words, one chip per rule failed**, for example "Rejected for this role 12 days ago by anita (cool-off)", "Experience 1 yr, needs 3–6 yrs", "Expected CTC 20 LPA, budget 15", "Education: B.Com, needs BE/BTech or MCA", "Missing mandatory skills: C#, Azure", "Location: Delhi, needs pune".
  - **Nearest misses first:** fewest rules failed, then fewest skills missing, then newest. Capped at the nearest 200, and it says so.
  - **Export** of the same list as a CSV with a "Why not shown" column.
  - **Read-only**, the P12 default: no Shortlist or Reject from this list.
- **Endpoints (same guards as the search: staff and the screening module):**
  - `POST /api/screening/roles/:id/not-shown` and `/not-shown/export`;
  - `POST /api/screening/keyword-not-shown` and `/keyword-not-shown/export`;
  - same body as the search, plus `reason`.
- **How it is computed** (`notShownForRole` / `notShownForKeyword` / `notShownCore` in `screeningV2.service.js`). Only when the link is clicked, so the search and its Redis cache are untouched.
  - **A:** one scan with one true/false per cheap gate (the same cost as the funnel counts), counted per rule, with the nearest 200 listed.
  - **B:** the search's own pool (passed every cheap gate) checked for the mandatory skills, plus on the keyword tab the JS-only education filter.
  - **C:** the cheap-gate misses are also checked for the skills ("also missing Kafka") before ordering. Card details and the rejection (who and when) are loaded for the ones shown.
  - **Shared gates:** the JD tab's cheap gates now come from one helper, `roleCheapConds()`, used by both the search and "not shown", so the list is built from exactly the rules that applied. "Tagged to this JD only" narrows the scope and is not a reason.
- **Wording:** `utils/screeningExclusionReasons.js` (pure) turns the rule keys plus the search's thresholds into the reason text, so the wording cannot disagree with the rule.
- **Correction to the P12 design:** "reuse `passesStrictFilters` for the reasons" would not work, because it stops at the first failure. Each rule is evaluated as its own SQL column instead.
- **Summary line:** its wording is unchanged (`jdGates` pins it). The per-rule counts are on the drawer's tabs.

## Tests
- `src/tests/unit/screeningExclusionReasons.test.js` (5): every rule's wording, and the nearest-miss order.
- `src/tests/integration/screeningNotShown.test.js` (4/4 on staging, own fixtures):
  - the JD search still matches only the passing fixture after the refactor;
  - each single-rule miss is listed with its rule in words, and the two-rule miss comes last;
  - the per-reason counts and the reason filter;
  - keyword: location and missing skill named.
- **Regressions on staging:** `jdGates` 14/14, `keywordFilters` 23/23, `legacyAddedWithin` 3/3, `candidateActivityOrder` 3/3, the same counts as before.
- Full unit run: 1009/1009. The frontend builds.
- **Real staging MRF:** reasons such as "Expected CTC 42.1 LPA, budget 5"; keyword search answered in about 1 s.
- **Still to do:** a browser check.

## Files
- `backend/src/services/screeningV2.service.js`
- `backend/src/utils/screeningExclusionReasons.js` (new)
- `backend/src/controllers/screening.controller.js`
- `backend/src/routes/screening.routes.js`
- `backend/src/exports/screening.export.js`
- `frontend/src/components/screening/NotShownDrawer.jsx` (new)
- `frontend/src/pages/CandidateScreening.jsx`
- `frontend/src/services/screeningService.js`
- tests as above
