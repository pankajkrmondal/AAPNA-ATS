# Strict keyword filtering (Phase 3 "Do Now" N01–N06) — behind `SCREENING_V2`

**Date:** 13 Oct 2026 · **Status:** Stage 1 of section A (keyword path). JD path (N07–N10) and the
before/after check (N11) follow. **Not live anywhere until `SCREENING_V2=true` is set**; production
stays off until RT signs off on the N11 comparison.

Plan: [PLAN-Phase3-Now.md §4.A](../Phase%203%20Enhancements%20or%20Feedback/PLAN-Phase3-Now.md).

## Why

RT (29 Sep, §6.2 / §8): keyword search returned candidates who did not match.

- Skills matched as substrings, so "java" also matched "javascript" and "django" matched "go".
- Several skills were OR'd together.
- Location and gender were ignored whenever skills were typed.
- Experience and CTC kept candidates with no value.
- A low average score could hide a candidate who passed every filter.
- Typing a name in the Skills box returned 42 look-alikes for "Sushree Sandhyarani Gagarai".

## What changed

### Backend

- **`backend/src/utils/screeningFilters.js` (new, N01).** Pure rule module (no Prisma client, no Redis):
  - filter parser (`0` is a real value)
  - whole-word skill matcher with a small alias table (.NET / dotnet / ASP.NET, C#, C++, Node.js, JS, React, Angular, Vue, Postgres, k8s)
  - exact location-part matcher ("Noida" ≠ "Greater Noida")
  - NULL-safe SQL condition builders
  - removed-by funnel counts
  - a JS mirror, `passesStrictFilters`

  Regexes go to Postgres as bound parameters. A test asserts that Postgres `~*` and the JS matcher give the same answer.
- **`backend/src/utils/phone.js` (new).** `normalisePhone` keeps the last 10 digits of each number. N22 will reuse it.
- **`backend/src/utils/educationCategories.js` (new).** `EDUCATION_GROUPS`, `getCandidateEducationCategories` and `matchesQualification`, moved verbatim out of `screening.service.js` so the filter module can use them without importing the service.
- **`backend/src/services/screeningV2.service.js` (new).** `searchKeywordCandidatesV2`:
  - **N02 exact lookup.** Name, email or phone (fields, or an email/phone typed in Skills) finds that person directly. It skips skills search, AI and ranking, and applies no other filters.
  - **N03.** Location, gender, experience, expected CTC, notice (days), position applied, added-within and education are all hard filters. An empty value is excluded. The rejection cooldown is kept.
  - **N04.** Search starts from `rpa_cv`, so candidates with no vector row are reachable. Skills are whole-word, with an All / Any choice (default All). Rows with an empty search index are no longer admitted automatically.
  - **N05.**
    - Nothing that passes is hidden; the score (skill coverage weighted by where the skill was found, plus job stability) only orders.
    - No Cohere rerank and no 250 cut.
    - A Gemini failure returns results with `summary.aiUnavailable`.
    - `summary.removedBy` counts what each filter removed, and the counts add up to the total.
  - A search with no filter at all now returns 400 instead of the whole database.
- **`backend/src/services/screening.service.js`.** No behaviour change. A few helpers are now exported for V2, and `splitSkillPhrases` and the education helpers are imported from the new utils.
- **`backend/src/config/index.js`.** `config.screening.v2` (`SCREENING_V2`, default `false`).
- **`backend/src/controllers/screening.controller.js`, `backend/src/exports/screening.export.js`.** Keyword search and export dispatch on the flag. The CSV export now reads keyword ratings (`relevanceScore`), which also fixes blank rating columns on the old path. Adds a "Score — Skill Match (Keyword)" column.

### Frontend (`CandidateScreening.jsx`, N06): see `frontend/UI-CHANGELOG.md`

## Performance (local, 100k synthetic resumes of ~5.5 KB)

Two things made the first version slow. The planner ran the skills regex on every row before the
location filter, and ILIKE scanned each resume once per alias spelling. The fixes:

- `strpos(lower(text), key)` as a prefilter (about 5× faster than LIKE and 25× faster than ILIKE).
- Expensive conditions placed inside a `CASE` behind the cheap ones.
- Per-skill evidence computed in SQL, so the resume body is never fetched.

| Search | First version | Now |
|---|---|---|
| ".NET" + Noida | 14.4 s | 0.9 s |
| "Kubernetes" (no match) | 5.1 s | 2.5 s |
| "Java, Spring" (16.6k results) | 4.0 s | 3.1 s |
| Name / phone lookup | — | 0.2–0.3 s |

Staging timings still need measuring.

## Tests

- `backend/src/tests/unit/screeningFilters.test.js`: 57 unit tests.
- `backend/src/tests/integration/keywordFilters.test.js`: 21 checks on six tagged fixtures, torn down by id. One check confirms that Postgres and JS agree on every matcher pair. Passed locally; still to run on staging.
- `frontend/e2e/keyword-screening.spec.js`: new Playwright suite, `npm run e2e`. 9/9 passed locally against a seeded database.

## Rollout

1. Staging: set `SCREENING_V2=true`, then run the integration test and the Playwright suite against staging data.
2. Production: keep `SCREENING_V2=false` until RT signs off the before/after check (N11).
3. Rollback: set `SCREENING_V2=false`. The old functions are untouched.

## Revision after review (13 Oct)

- **Lookup works with the flag off.** The name/email/phone search did nothing on environments without `SCREENING_V2`, because the old search ignores those fields. The controller and the CSV export now send any lookup request to V2 whatever the flag says, via `isLookupRequest`. The flag still gates the strict filtering that N11 compares.
- **Lookup fields.** The approved screen has separate Candidate name / Email / Phone fields (`name`, `email`, `phone`); if more than one is filled, email wins, then phone. The API also accepts a single `lookup` value, detected as an email, then a phone number, then a name.
- **Skills match:** a "Match any one skill" checkbox sends `matchMode: 'any'`; unticked sends `'all'`.
- **Designation replaced.**
  - **Position applied for** (`position`): a whole-phrase match on `PositionApplied` only, any typed position.
  - **Added within** (`addedWithinDays`): `createdAt >= now() - N days`, so an empty `createdAt` is excluded. This is the recency filter planned as N38.
- **Tests (final screen):** 439/439 backend unit tests (60 for the filter module) and 23/23 integration tests. The Playwright suite passes 10/10 with the flag on; the 3 lookup tests also pass with it off.

## Known limits

- Location parts are split on `,` `/` `;` `|`, and a trailing parenthetical is ignored ("Noida (UP)" → "noida").
