# Implementation plan: Phase 3 enhancements, Do Now

**Date:** 7 Oct 2026 · **Updated:** 12 Oct 2026 (added Missing-details completed: bell alert & dates (N44), hot priority)
**Scope:** the "Phase 3 Enh - Do Now" sheet of `ATS App - Phase wise Task Items.xlsx`
**Companion files:**
- [Phase-3-Feedback-Triage-Notes.md](Phase-3-Feedback-Triage-Notes.md): coverage of RT and CEO feedback, and where each item came from
- [PLAN-Phase3-in-Phase4.md](PLAN-Phase3-in-Phase4.md)
- [PLAN-Phase4.md](PLAN-Phase4.md)

All paths are relative to the `AAPNA-ATS/` repo root. Line numbers were checked on branch `harish-project-staging-v25` (head `3365d5b`).

---

## 1. Context and scope

This list holds the Phase 3 feedback that is being delivered now. It comes from three sources:
- RT's written feedback (29 Sep)
- the CEO sheet and the 28 Sep demo
- our own Phase 4 sheet

**Rules that shaped the list:**
- Priority order: bugs → RT's "most important" → CEO → our own items.
- Anything RT marked important is done now. Today that means §4 (JD tagging) and §11 (JD attachment).
- Keyword and JD filtering is high priority, because RT raised it verbally.
- Upload speed (Upload speed (N41)) is **not** designed here. It is brainstormed after all other items close.

**Decisions already taken (strict filtering):**
- A candidate with no value for an applied filter is **excluded**.
- Keyword skills have an **All / Any toggle**, default All. Matching is whole-word, with aliases.
- Email, phone or name input triggers an **exact lookup**.
- **Location** is typed. Each typed city must equal one comma-separated part of the stored location, case-insensitive.
- **JD filtering:** the candidate must have **all** mandatory skills first. Then the other criteria are checked: experience band (parsed JD min-max, otherwise the MRF's years as a minimum), budget by `mrf_id`, and education.
- **JD tagging** applies to new uploads only. Existing candidates are tagged through Search Candidate to JD (N21).

| Section | Items | Hours |
|---|---|---|
| A. Strict keyword & JD filtering | Strict keyword & JD filtering (N01–N12) | 75 |
| B. JD tagging on upload | JD tagging on upload (N13–N15) | 48 |
| C. Other RT feedback | Other RT feedback items (N16–N27), Missing-details completed (N44) | 99 |
| D. Bugs & data correctness | Bugs & data correctness items (N28–N34) | 50 |
| E. CEO clarity, dashboard & analytics | CEO clarity, dashboard & analytics items (N35–N39) | 62 |
| F. Developer logging & system documentation | Developer logging & error tracing (N42), System documentation & development history (N43) | 54 |
| G. Housekeeping (no code) | Housekeeping (N40) | 0 |
| H. To brainstorm later | Upload speed (N41) | — |
| **Total** | | **388** (≈ 5 weeks for 2 developers, easy items first) |

---

## 2. Build order (easy items first)

Development starts with the small, low-risk fixes so RT sees visible improvements early. The strict filtering rework is the largest and riskiest piece, so it goes last and is released only after RT signs off on the before/after comparison. Hard dependencies are respected throughout.

| Week | Development work (hours) | Release at end of week |
|---|---|---|
| **1 · Quick wins + hot item (≈63 h)** | **Missing-details completed (N44, 14; hot, start first)** · Approver email wording (N32, 1) · Interview host visibility (N26, 2) · MRF approval alert (N16, 3) · Skip guard (N33, 3) · Approve-without-score label (N25, 3) · Date Added column (N27, 3) · Dark mode on public forms (N31, 4) · QA Automation tag (N20, 4) · JD date & version (N19, 6) · Interviewer & interviewee (N23, 6) · Pipeline popup crash (N30, 6) · CEO round optional (N24, 8; after Skip guard) · Housekeeping (N40, 0) | Release 1 |
| **2 · Small / medium, self-contained (≈78 h)** | Developer logging & error tracing (N42, 30) · Labels & legends (N35, 12) · Scores in the pipeline drawer (N28, 12) · Date format (N34, 8) · Candidate data sync (N29, 16) | Release 2. Logging lands before the bigger work, so that work is easier to debug |
| **3 · Medium features (≈74 h)** | Candidate phone & interview reminders (N22, 10) · JD tagging - data model (N13, 16) · JD tagging - uploads (N14, 24) · Search Candidate to JD (N21, 8) · JD attached to emails (N17, 16) | Release 3 |
| **4 · Larger features (≈78 h)** | Candidate form overhaul (N18, 16) · Dashboard fixes (N36, 20) · Raw vs qualified, interim (N37, 6) · Analytics - Positions tab (N39, 20) · System documentation & development history (N43), first 16 h | Release 4 |
| **5 · Filtering rework, last (≈96 h)** | Filter utility (N01) → keyword items (N02–N06) → JD skill gate (N07) → JD other criteria (N08) → JD ranking (N09) → JD search speed (N10) (67 h together) · Before/after check (N11, 6) · Rules document for RT (N12, 3) · Recency filter (N38, 4) · JD tagging - screening filter (N15, 8) · System documentation & development history (N43), last 8 h | Release 5, after RT signs off on the Before/after check (N11). The documentation is published |
| After everything | Upload speed (N41): brainstorm only | — |

**Dependencies**
- Filter utility (N01) blocks the other filtering items (N02–N10), so all of them sit in week 5.
- Before/after check (N11) gates the production release of the filtering rework.
- Skip guard (N33) comes before CEO round optional (N24); both are in week 1.
- JD tagging - data model (N13) blocks JD tagging - uploads (N14) and Search Candidate to JD (N21), all in week 3. It also blocks JD tagging - screening filter (N15), which also needs the JD gates and so sits in week 5.
- Candidate phone & interview reminders (N22) builds its own phone normaliser, which Filter utility (N01) reuses later. It doesn't wait for the filtering rework.
- Raw vs qualified (interim) (N37) uses the existing `getStats` query and doesn't wait for Dashboard fixes (N36).
- Developer logging & error tracing (N42) is needed for the runbook section of System documentation & development history (N43).
- Shared with later plans:
  - JD attached to emails (N17): its attachment support is reused by Website candidates report (P07).
  - Candidate phone & interview reminders (N22): supplies the phone number for SMS / WhatsApp reminders (P04).
  - JD tagging - data model (N13): its tag table is reused by Move / re-tag candidate (L02), Analytics - date range & Total Applied (L06) and C2C.
- Missing-details completed (N44) has no hard dependency; the bell it uses already exists. Its dates are reused by the Phase 4 warm-candidate report.

---

## 3. Shared conventions

These apply to every item below.

- **DB changes**
  - Write `backend/prisma/ddl/YYYY-MM-DD-slug.sql` plus `…rollback.sql`.
  - The script must be idempotent (`IF NOT EXISTS`), ASCII-only with no BOM, and carry `COMMENT ON` for every new object.
  - Apply staging first: `node scripts/run-ddl.mjs --env .env.staging --expect-db recruitmentautomationdb --file prisma/ddl/<f>.sql --dry-run`, then run it again without `--dry-run`.
  - Production uses `--expect-db recruitmentautomationdbProd`.
  - Then stop the server and worker and run `npm run prisma:pull && npm run prisma:generate`. This avoids EPERM on Windows.
- **Tests**
  - Unit tests: `node:test` in `backend/src/tests/unit/`.
  - Integration tests: one file at a time against staging, with `node src/tests/run-block.mjs src/tests/integration/<f>.test.js`. Seed and tear down with `src/tests/helpers/fixture.js`.
  - The frontend has no test runner. Check UI changes with the `AAPNA-ATS/frontend:verify` skill (build, launch, drive in the browser).
- **Settings:** string keys in `rpa_settings`. Read them with a `SETTING_KEYS` + `DEFAULTS` block (`backend/src/jobs/interviewReminder.js:43-72`). Save them through `backend/src/controllers/settings.controller.js:157-214`, which restarts the job. The settings routes only require login, so add `requireAdmin` to any new admin-only key.
- **Cron:** register the job in `backend/src/server.js` (start ~40-78, stop in the shutdown block). Use `timezone: 'Asia/Kolkata'` and a module-level `running` guard (`backend/src/jobs/mrfAuditRetentionSweep.js:123`).
- **Email safety:** outside production, `sendGraphEmail` redirects to the test inbox unless `allowRealRecipients` is set. Keep it that way on staging.
- **Changelogs:** for every item, add a `docs/CHANGELOG.md` entry. Larger sets also get `docs/changelog/CHANGES-YYYY-MM-DD-slug.md`. Any UI change also goes in `frontend/UI-CHANGELOG.md`.
- **Frontend**
  - API wrappers live in `frontend/src/services/*.js`.
  - Use React Query only where the page already uses it (Pipeline, CandidateScreening, PipelineDrawer).
  - New routes go in `frontend/src/App.jsx`, plus `MENU_ITEMS`, `V2_ROUTES` and `BREADCRUMB_MAP` in `frontend/src/layouts/MainLayout.jsx`.

---

## 4. Items

Each item gives:
- **Goal** — taken from the workbook
- **Current behaviour** — what the code does today
- **Design**
- **Files**
- **Reuse** — existing code to build on
- **Tests**
- **Risks & rollout**
- **Depends on / blocks**
- **Open decisions** — with a recommended default

Shorthand used in the items:
- **SVC** = `backend/src/services/screening.service.js`
- **UI** = `frontend/src/pages/CandidateScreening.jsx`

### A. Strict keyword & JD filtering

#### N01 · Filter utility
**High · 8 h · Week 5 · Foundation for Keyword - exact lookup through JD - search speed (N02–N10)**

**Goal**
- **Today:** keyword search and JD search build their filters separately, and neither has tests.
- **Change:** one shared module with unit tests.
- **Done when:** both searches use the module and its tests pass.

**Current behaviour**
- Keyword search parses filters at SVC:1277-1287. It builds its SQL in two places: SVC:1301-1398 (Skills box filled) and SVC:1399-1492 (Skills box empty).
- JD search builds its pre-filter at SVC:857-917.
- Matching helpers are module-private:
  - `skillMatchesTerm` (SVC:422-425): substring match in both directions
  - `matchKeywordTerms` (SVC:433-472)
  - `scoreJDMatch` (SVC:359-380)
- No unit test covers any of these.

**Design.** A new file, `backend/src/utils/screeningFilters.js`, containing pure functions only (no prisma or redis imports, so it can be tested without a database):
- `parseScreeningFilters(body)`
  - trims values
  - uses `!= null`, so `0` counts as a real value
  - accepts `location` as a comma list or an array
  - adds `name`, `email`, `phone`, `matchMode: 'all'|'any'` (default `'all'`) and `addedWithinDays`
- `buildFilterSql(filters, alias = 'c')`
  - returns a `Prisma.sql` fragment plus a parameter list
  - location: `EXISTS (SELECT 1 FROM unnest(string_to_array(lower(c."CurrentLocation"), ',')) p WHERE trim(p) = ANY($cities))`
  - other filters use the numeric columns `TotalExperienceYearsNumeric`, `ExpectedCTCNumeric` and `NoticePeriodDays`, with `IS NOT NULL` (empty means excluded)
  - gender: case-insensitive equality
  - education: category predicates
  - designation: whole-word regex on `PositionApplied` and the current role
- `passesStrictFilters(candidate, filters)`: a JavaScript mirror of the SQL, used as a defensive second check.
- `wholeWordMatch(text, term)` with an `ALIASES` map (`.net`/`dotnet`/`asp.net`, `c#`/`csharp`, `c++`/`cpp`, `node.js`/`nodejs`/`node`, `javascript`/`js`).
  - Uses the regex `(^|[^a-z0-9+#.])term($|[^a-z0-9+#.])` on lower-cased text.
  - Postgres `\m`/`\M` word boundaries cannot be used, because they fail on `.NET` and `C++`.
- `normalisePhone(str)`: reused from `backend/src/utils/phone.js`, which Candidate phone & interview reminders (N22) creates in week 3. It splits on `[,;/]` and keeps the last 10 digits of each part.
- `splitSkillPhrases` is moved here from SVC:388 and keeps its behaviour.

**Files**
- New: `backend/src/utils/screeningFilters.js`
- New: `backend/src/tests/unit/screeningFilters.test.js`

**Reuse**
- `emailMatchesSql` (`backend/src/utils/emailMatch.js`), for multi-address email fields.
- The test pattern in `backend/src/tests/unit/emailMatchSql.test.js`.

**Tests.** One case for each of the following:
- 0 treated as a real value
- empty value → excluded
- "net" does not match ".NET"; "java" does not match "javascript"; "c" does not match "react"
- All vs Any
- city match on comma-parts ("Noida" matches "Noida, UP" but not "Greater Noida")
- phone formats: +91, spaces, multiple numbers
- multi-address email

**Risks & rollout.** None on its own; it is pure functions.

**Depends on / blocks:** blocks Keyword - exact lookup through JD - search speed (N02–N10).

**Open decisions:** none.

#### N02 · Keyword – exact lookup
**High · 4 h · Week 5 · RT §8, our #64**

**Goal**
- **Today:** searching by email or name returns unrelated candidates ("Sushree Sandhyarani Gagarai" returns 42 results). Only phone search is exact.
- **Change:** a direct, exact-match lookup.
- **Done when:** an email, phone or full-name search returns only the matching candidates.

**Current behaviour**
- All input goes into the Skills box (UI:1173-1183).
- Retrieval at SVC:1308-1317 admits these rows:
  - any row with `resume_tsvector IS NULL`
  - any row where a term is an ILIKE substring of `Name`
- `EmailID` and `ContactNumber` are never checked.
- `skillMatchesTerm` matches substrings in both directions, so "Gagarai" contains "ai" and counts as a hit.

**Design**
- Add an early branch in `searchKeywordCandidates` (SVC:1276), before any embedding, rerank or Gemini call.
- If `filters.email` is set, or `keyword` looks like an email:
  - query `rpa_cv` directly with `emailMatchesSql`
  - use `prisma.$queryRaw` (not `$queryRawUnsafe`), because the helper returns a `Prisma.sql` fragment
- If `filters.phone` is set, or `keyword` is all digits/spaces/+ with 10 or more digits:
  - match with `EXISTS (... right(regexp_replace(p,'[^0-9]','','g'),10) = $d10)`
- If `filters.name` is set:
  - compare `lower(regexp_replace(trim("Name"),'\s+',' ','g'))` for equality first
  - if nothing matches, fall back to a prefix match
- Return `mode: 'lookup'` rows (Name, EmailID, ContactNumber, the usual card fields) with no score. **Other filters are not applied** in lookup mode, because the recruiter is looking for one person.

**Files:** SVC, plus the helpers from Filter utility (N01).

**Reuse:** `emailMatchesSql`, and `normalisePhone` from Filter utility (N01).

**Tests**
- Unit tests for the detection rules.
- Manual on staging: the RT examples. Search "Sushree Sandhyarani Gagarai" and expect 1 result, plus one email search and one phone search.

**Risks & rollout.** Use `[^0-9]` rather than `\D`: the backslash would be eaten inside a template literal (`emailMatch.js:57-58` notes the same problem).

**Depends on:** Filter utility (N01).

**Open decisions:** none.

#### N03 · Keyword – strict filters
**High · 8 h · Week 5 · RT §6.2 "Location has to be perfect match"**

**Goal**
- **Today:** location and gender are ignored when skills are entered. Experience and CTC keep candidates with empty values. Designation, education and notice period only adjust the score.
- **Change:** every filter becomes a hard filter, and empty values are excluded.
- **Done when:** every result satisfies every filter.

**Current behaviour.** Filters behave differently in the two code paths:

| Filter | Skills box filled (SVC:1301-1398) | Skills box empty (SVC:1399-1492) |
|---|---|---|
| Location | ignored | substring match (SVC:1402-1404) |
| Gender | ignored | equality (SVC:1405-1407) |
| Experience | empty values kept; `0` disables the filter (SVC:1359-1368, 1385-1388) | empty values dropped |
| CTC (expected) | empty values kept | empty values kept |
| Notice period | score only | filter on `NoticePeriodDays` |
| Education | score only (SVC:1535-1549) | score only |
| Designation | score only (SVC:1522-1532) | score only |

**Design**
- Both paths call `buildFilterSql(filters)` from Filter utility (N01) and splice it into their WHERE clauses.
- Remove the per-path filter code at SVC:1358-1382 and SVC:1401-1449.
- Keep the rejection-cooldown exclusion (SVC:1321 / 1447-1449).
- Education categories become predicates over `HighestQualification`. Reuse the category mapping in `matchesQualification` (SVC:80-125), but fix the `'ANY'` case at :84, which currently returns false for nearly everyone.

**Files:** SVC, `backend/src/utils/screeningFilters.js`.

**Reuse:** `matchesQualification` (the category list), and `rejectionCooldown` from `backend/src/utils/rejectionCooldown.js`.

**Tests**
- Unit tests for `buildFilterSql`.
- Integration test (new, `src/tests/integration/keywordFilters.test.js`):
  - seed 6 candidates with a fixture tag
  - assert each filter excludes the right rows, including an empty-location row being excluded
  - tear down

**Risks & rollout.** Because empty values are excluded, result counts may drop sharply. Before/after check (N11) reports how many rows are empty per field before release.

**Depends on:** Filter utility (N01).

**Open decisions:** none. The empty-value rule was decided on 29 Sep.

#### N04 · Keyword – skills matching
**High · 6 h · Week 5 · RT §8**

**Goal**
- **Today:** skills match as substrings. Several skills are combined with OR. Candidates with an empty search index are admitted, and candidates without a vector row can't be reached.
- **Change:** whole-word matching, with an All / Any toggle.
- **Done when:** "Java, Spring" with All returns only candidates who have both.

**Current behaviour**
- Retrieval uses `FROM rpa_cv_vectors v JOIN rpa_cv c` (SVC:1340-1341). Candidates whose vector was never saved are invisible; for example, saving is skipped when there is no email (`backend/src/services/vectorStore.service.js:84-86`).
- One matching term out of N scores 5 (SVC:479-488), which is enough to show the candidate.

**Design**
- Query `rpa_cv` as the base table and `LEFT JOIN rpa_cv_vectors` only to get the distance used for ordering.
- For each term, build a whole-word regex predicate (with aliases) over `"Top5KeySkills"`, the technical terms and the resume text.
- `matchMode = all` combines the per-term predicates with AND; `any` combines them with OR.
- Remove the `resume_tsvector IS NULL` admission (SVC:1315) and the `resume_technical_terms::text ILIKE` predicate.
- `matchKeywordTerms` switches to `wholeWordMatch`.

**Files:** SVC.

**Reuse:** `splitSkillPhrases` and `wholeWordMatch` from Filter utility (N01).

**Tests**
- Unit: the matcher.
- Integration: "Java, Spring" All vs Any on fixture candidates.

**Risks & rollout.** Regex predicates over ~99k rows: measure on staging. If they are slow, pre-filter with `resume_tsvector @@ plainto_tsquery(...)`, which has a GIN index, before applying the regex.

**Depends on:** Filter utility (N01).

**Open decisions:** none.

#### N05 · Keyword – score & summary
**High · 4 h · Week 5**

**Goal**
- **Today:** passing candidates can be hidden by their score. An AI failure fails the whole search. A rerank failure cuts results to 250.
- **Change:** the score only orders results. Show a per-filter summary.
- **Done when:** no passing candidate is hidden, and the counts add up.

**Current behaviour**
- Candidates are hidden when `avgScore < 5` (SVC:1766-1774).
- A Gemini failure is thrown (SVC:1675-1678).
- On rerank failure the list is sliced to 250 (`vectorStore.service.js:260-265`).
- The summary's `low` bucket is always 0 (SVC:1784-1801).

**Design**
- Delete the hide rule. Remove education, designation, experience, CTC and notice from the averaged score, since they are now hard filters. The score becomes skill coverage plus job stability.
- Wrap the Gemini call so a failure returns results without insights and sets `summary.aiUnavailable = true`.
- In keyword mode, skip Cohere rerank; the final sort ignores it anyway.
- Add `summary.removedBy = { location, gender, experience, ctc, notice, education, designation, skills }`. Compute it with one `COUNT(*) FILTER (WHERE …)` query.
- Make the chip buckets match the star thresholds.

**Files:** SVC, `backend/src/services/vectorStore.service.js` (only if the cut still applies on the JD path).

**Reuse:** none.

**Tests:** integration check that the `removedBy` counts add up to the total minus the results.

**Risks & rollout.** The summary text format changes, and the UI header parses it (UI:1413-1415). Update both together.

**Depends on:** Filter utility (N01), Keyword - strict filters (N03), Keyword - skills matching (N04).

**Open decisions:** none.

#### N06 · Keyword – screen changes
**High · 8 h · Week 5 · RT §6.2, §8**

**Goal**
- **Today:** result cards show no email or phone. Labels are unclear. The keyword score is not explained. The CSV export rating is blank.
- **Change:** the screen and export changes listed below.
- **Done when:** RT can act on a candidate from the card alone.

**Current behaviour**
- The form is at UI:1164-1386 and the card at UI:1568-1680.
- Email and phone appear only in the drawer (UI:2305, 2309).
- Notice is rendered as `${NoticePeriod} days notice` (UI:1738).
- The drawer renders only the JD score (UI:2147).
- The export reads `c.starRating || c.rating` (`backend/src/exports/screening.export.js:24`).

**Design**
- **Form:**
  - Name, Email and Phone inputs, which trigger Keyword - exact lookup (N02).
  - An All / Any segmented toggle next to Skills.
  - Location as a typed `Select mode="tags"` (comma-separated, no option list).
  - Relabel to "Expected CTC (LPA)".
  - An "Added in" select, wired to Recency filter (N38).
- **Card:** an "Email · Phone" line with "–" when missing, and the referral chip. Add `is_referral` to the keyword SQL select.
- **Drawer:** render `relevanceScore.breakdown`.
- **Notice text:** use `NoticePeriodDays` when present, otherwise the raw text.
- **Export:** `c.starRating || c.relevanceScore || c.rating`.

**Files:** UI, `backend/src/exports/screening.export.js`, SVC (select list).

**Reuse:** `ReferralChip` (`frontend/src/components/candidates/ReferralChip.jsx`).

**Tests:** verify skill run on Candidate Screening (keyword tab); check the CSV export columns.

**Risks & rollout.** UI only. Record it in `frontend/UI-CHANGELOG.md`.

**Depends on:** Keyword - exact lookup through Keyword - score & summary (N02–N05).

**Open decisions:** none.

#### N07 · JD – skill gate
**High · 8 h · Week 5 · RT §5**

**Goal**
- **Today:** skills are 1 of 8 averaged scores, so a profile with no skill match can still rate "strong".
- **Change:** a candidate must have ALL mandatory skills before anything else is checked. Show the mandatory list and the pass count.
- **Done when:** no result is missing a mandatory skill.

**Current behaviour**
- In `searchRoleCandidates` (SVC:723), mandatory skills come from the MRF, falling back to `parsed_jd_json` (SVC:739-801).
- `scoreJDMatch` (SVC:359-380) splits the text on whitespace, so words like "and" become skills. Its denominator is the candidate's own skill count, and empty skills score 4.
- The only skill check is `p6 < 3` at the very end (SVC:1118-1120).

**Design**
- Build `mandatory = splitSkillPhrases(mrf.mandatory_skills)`, normalised and aliased, with stop-phrases removed.
- Add a SQL gate before vector ordering: AND over the per-skill whole-word predicates (from Keyword - skills matching (N04)) across declared skills, technical terms and resume text.
- Return `summary.mandatorySkills` and `summary.passedSkillGate`.

**Files:** SVC.

**Reuse:** the Filter utility (N01) helpers and the Keyword - skills matching (N04) predicate builder. `buildJdSkillSignals` (SVC:502-534) stays for the drawer's per-skill view.

**Tests**
- Unit: phrase splitting on real MRF texts. Pull 3 from staging and save them as fixtures.
- Integration: a candidate missing one mandatory skill is excluded.

**Risks & rollout**
- "All" on badly written mandatory-skill text could return nothing. Show the parsed mandatory list on screen so RT can fix the MRF text.
- Bump the cache key (see JD - search speed (N10)).

**Depends on:** Filter utility (N01), Keyword - skills matching (N04).

**Open decisions:** none. "ALL mandatory skills" was decided on 29 Sep.

#### N08 · JD – other criteria
**High · 6 h · Week 5 · RT §5 fresher rating**

**Goal**
- **Today:** experience is only a maximum (freshers pass with 8/10). The budget is looked up by role name. Education "ANY" scores 0.
- **Change:** an experience band, a budget looked up by MRF id, and fixed education rules; empty values are excluded.
- **Done when:** freshers outside the band and over-budget candidates are gone.

**Current behaviour**
- SQL pre-filter: `TotalExperienceYearsNumeric <= MRF years` with empty values kept (SVC:896-900), and budget with empty values kept (SVC:901-905).
- `scoreTotalExperience` (SVC:299-307) gives 8 for a negative gap.
- The budget LEFT JOIN uses role name + email (SVC:787-792).
- `'%any%'` maps to TECH_GRADUATE (SVC:766-769).
- `parsed_jd_json.min/max_experience_years` is never read.

**Design**
- **Band:** use `[min,max]` from `parsed_jd_json` when present. Otherwise use `[MRF years, ∞)`. Require `TotalExperienceYearsNumeric BETWEEN min AND max`.
- **Budget:** `ExpectedCTCNumeric <= budgetMax`, looked up through `rpa_mrf_jd_send.mrf_id = mrf.id`, falling back to the MRF's own budget field. If no budget exists at all, skip the filter and say so in the summary.
- **Education:** `'ANY'` passes everyone with a value. Map `'%any%'` to `'ANY'`.
- These checks apply only to skill-passers. Empty values are excluded.

**Files:** SVC.

**Reuse:** `matchesQualification` (with the fix).

**Tests:** integration: a fresher outside the band and an over-budget candidate are both excluded.

**Risks & rollout.** Experience parsing quality: `TotalExperienceYearsNumeric` is computed at upload. Spot-check 20 rows in Before/after check (N11).

**Depends on:** JD - skill gate (N07).

**Open decisions**
- Should experience have a tolerance (for example ±1 year)?
- Recommended default: none, to keep it strict. RT can review during Before/after check (N11).

#### N09 · JD – ranking
**High · 6 h · Week 5 · RT §5 "descending order"**

**Goal**
- **Today:** a cached AI score from another role can inflate the ranking.
- **Change:** rank passers only, on mandatory coverage; store AI insights per MRF; sort highest first.
- **Done when:** for the named JDs, genuine matches rank at the top.

**Current behaviour**
- Cached `ai_profile_insights` are reused across roles (SVC:998-1003, 1038) and written back per candidate (SVC:1019-1024).
- The final score is the mean of p1-p8 (SVC:1077).

**Design**
- `score = 0.6·coverage + 0.2·experience fit (position in band) + 0.1·CTC headroom + 0.1·notice`. Coverage counts declared skills fully and resume-only mentions at 0.7. Put the weights in one constant, `JD_RANK_WEIGHTS`; Scoring weights & recency (L01) re-tunes them.
- Insights are cached in Redis as `insight:mrf:<mrfId>:cv:<cvId>` (TTL 7 days) instead of the shared `ai_profile_insights` column. The column stays for the general profile.
- Sort descending, tie-broken by vector distance.

**Files:** SVC.

**Reuse:** `generateProfileInsights` (SVC:630).

**Tests:** unit tests for the score function; before/after comparison in Before/after check (N11).

**Risks & rollout.** Every score changes, which is why Before/after check (N11) gates the release.

**Depends on:** JD - skill gate (N07), JD - other criteria (N08).

**Open decisions:** the weights. The recommended defaults are above; finalise them with RT during Before/after check (N11).

#### N10 · JD – search speed
**High · 8 h · Week 5 · RT "matching takes too long"**

**Goal**
- **Today:** every search scans and reranks ~99k candidates with full resume text.
- **Change:** the faster query below.
- **Done when:** search time is measured before and after, and is clearly faster.

**Current behaviour**
- The vector query has no LIMIT and returns `v.text` (SVC:857-917).
- Cohere reranks the whole pool, but its score is never used (`vectorStore.service.js:158-171, 220-266`).
- `rpa_cv.count()` is called twice (SVC:925, 1128).
- There is no vector index on `rpa_cv_vectors` (`backend/prisma/schema.prisma:712-722`).
- Cache key is `screening:role:<mrfId>` with a 1-hour TTL (SVC:725-736). It is not cleared when the MRF is edited.

**Design**
- The JD - skill gate (N07)/N08 gates run in SQL, followed by `ORDER BY distance LIMIT 500`.
- Select only the card columns, not `v.text`.
- Drop Cohere for the JD path, or rerank only the top 100 if quality needs it.
- One count query.
- Cache key `screening:role:v2:<mrfId>`. Clear it in the MRF update handler (`backend/src/controllers/mrf.controller.js`, PATCH main) and on MRF close.
- Log `t_sql`, `t_ai` and `t_total` for each search.
- Add an IVFFlat/HNSW index only if, after the gates, `t_sql` is still above 2 s.

**Files:** SVC, `backend/src/services/vectorStore.service.js`, `backend/src/controllers/mrf.controller.js`.

**Reuse:** existing Redis helpers in SVC.

**Tests:** timing log on staging for 3 JDs, before and after.

**Risks & rollout.** A vector index needs DDL and the pgvector version check. Keep that as a separate DDL step if it is needed.

**Depends on:** JD - skill gate (N07), JD - other criteria (N08).

**Open decisions:** none.

#### N11 · Before/after check
**High · 6 h · Week 5 · Release gate for Filter utility through JD - search speed (N01–N10)**

**Goal**
- **Today:** scoring changes have never been compared on real data.
- **Change:** run the comparison and count empty fields.
- **Done when:** RT reviews the comparison and signs off.

**Current behaviour:** none.

**Design**
- New script `backend/scripts/screening-compare.mjs`:
  - against a staging snapshot, runs the old and new search for each named JD (QA Automation, the Python JD for Pankaj Mondal, Nihar Naik's role) and 3 keyword queries
  - writes a CSV per query: rank_before, rank_after, score_before, score_after, excluded_reason
- Empty-field report: `COUNT(*) FILTER (WHERE col IS NULL)` for location, gender, experience, expected CTC and notice.
- Keep the old functions behind `SCREENING_V2=false` until sign-off.

**Files:** new `backend/scripts/screening-compare.mjs`; flag in `backend/src/config/index.js`.

**Reuse:** none.

**Tests:** the script itself is the test.

**Risks & rollout.** Ship with `SCREENING_V2=true` only after RT signs off.

**Depends on:** Filter utility through JD - search speed (N01–N10).

**Open decisions:** none.

#### N12 · Rules document for RT
**High · 3 h · Week 5 · promised 10 Sep**

**Goal**
- **Today:** RT can't see why a candidate is or isn't shown.
- **Change:** a plain-language rules document.
- **Done when:** it has been shared with RT.

**Current behaviour.** No rules document exists. `docs/reference/screening.md` is out of date: it still describes the old `LIMIT 50` / `take: 200` caps.

**Design:** `docs/Screening-Rules-for-RT.md`. Cover:
- each filter and what "empty" means
- the All/Any toggle
- the JD gates in order
- the ranking weights
- three worked examples, taken from Before/after check (N11)

**Files:** new doc.

**Reuse:** `docs/Recruitment-Analytics-User-Guide.md` as the style model.

**Tests:** RT read-through.

**Risks & rollout:** none.

**Depends on:** JD - ranking (N09).

**Open decisions:** none.

### B. JD tagging on upload (RT §4, most important)

#### N13 · JD tagging – data model
**High · 16 h · Week 3 · RT §4**

**Goal**
- **Today:** nothing records which JD a candidate was uploaded for.
- **Change:** a tag table that applies to new uploads.
- **Done when:** the table is live on staging and the upload code can write to it.

**Current behaviour.** The only candidate↔MRF links are `rpa_shortlisted_candidates.mrf_id` (`backend/prisma/schema.prisma:304`) and `rpa_candidate_pipeline.mrf_id` (:760). Both are set at shortlist time.

**Design**
- DDL `backend/prisma/ddl/2026-10-xx-candidate-mrf-tags.sql`. Table `rpa_candidate_mrf_tags` with these columns:

| Column | Type / note |
|---|---|
| `id` | bigserial PK |
| `cv_id` | bigint NOT NULL, FK `rpa_cv(id)` ON DELETE CASCADE |
| `mrf_id` | int NOT NULL, FK `rpa_mrf(id)` |
| `source` | varchar(30): `hr_manual_upload` / `vendor_portal` / `email_intake` / `search_candidate` / `shortlist` |
| `upload_execution_id` | text, null |
| `tagged_by` | text |
| `tagged_at` | timestamptz default now() |

- Constraints and indexes: UNIQUE `(cv_id, mrf_id)`, and indexes on `mrf_id` and `cv_id`.
- Rollback drops the table.
- Service `backend/src/services/candidateTag.service.js` with:
  - `tagCandidates({ cvIds, mrfId, source, actor, executionId })`, using `createMany skipDuplicates`
  - `listTaggedCvIds(mrfId)`
  - `tagsFor(cvId)`
- Also write a tag when someone shortlists against an MRF (`shortlistCandidates`, SVC:1871), so shortlisting and tagging stay consistent.

**Files:** DDL + rollback; `backend/prisma/schema.prisma` (via pull); new service; SVC (shortlist hook).

**Reuse:** `createMany` pattern from `createJobsForBatch` (`backend/src/services/uploadJob.service.js:109`).

**Tests:** unit tests for the service with a prisma mock; integration test tagging twice is idempotent.

**Risks & rollout.** The ~99k existing candidates stay untagged, as decided. There is no backfill.

**Depends on:** nothing. **Blocks:** JD tagging - uploads (N14), JD tagging - screening filter (N15), Search Candidate to JD (N21), Move / re-tag candidate (L02), Analytics - date range & Total Applied (L06), C2C.

**Open decisions:** none.

#### N14 · JD tagging – uploads
**High · 24 h · Week 3 · RT §4**

**Goal**
- **Today:** HR bulk, HR single and vendor uploads accept files only.
- **Change:** an optional JD picker. The tag is saved in every save path.
- **Done when:** a bulk upload tagged to a JD shows every candidate tagged, including merged duplicates.

**Current behaviour**
- `frontend/src/pages/HRUpload.jsx:211-231` sends only files.
- The controller `backend/src/controllers/hrUpload.controller.js:43-187` writes the batch summary and jobs, then dispatches `runBatchParsing` (`backend/src/services/hrUpload.service.js:1042`). The queue path is `dispatchBatchParsing` (:1771) → `backend/src/workers/resumeWorker.js`.
- Save paths:
  - duplicate to `rpa_cv_tmp` (:1288)
  - update existing (:1512)
  - create new (:1526)
  - merge (`mergeDuplicates` :545)
- Vendor upload: `backend/src/controllers/vendor.controller.js uploadResumes` (:204).

**Design**
- **Frontend:** a `Select` (searchable) of open MRFs on `HRUpload.jsx` and `frontend/src/pages/VendorPortal.jsx`. Reuse `getApprovedRoles` via the screening service; for vendors, filter to the MRFs shared with them, or all open ones until C2C share-JD exists. Send `mrfId` with the form data.
- **Backend:**
  - The controller validates that the MRF is open.
  - Put `mrfId` into the `attribution` object that already travels to `runBatchParsing` and the queue job payload.
  - After each create or update, call `tagCandidates`.
  - For `rpa_cv_tmp` rows, store the `mrfId` in the tmp row's metadata (JSON) and apply it in `mergeDuplicates` when the duplicate is resolved.
  - Email intake has no picker and stays untagged.
- Show the JD name in the upload job list.

**Files:**
- Backend: `backend/src/controllers/hrUpload.controller.js`, `backend/src/services/hrUpload.service.js`, `backend/src/controllers/vendor.controller.js`, `backend/src/workers/resumeWorker.js`
- Frontend: `HRUpload.jsx`, `VendorPortal.jsx`, their services

**Reuse:** `attribution` plumbing, `tagCandidates` (JD tagging - data model (N13)).

**Tests:**
- Integration: run `runBatchParsing` with a fixture Excel of 3 rows (1 new, 1 existing, 1 duplicate) and assert 3 tags after merge.
- Run `vendorIsolation` and `vendorNotification` unchanged.

**Risks & rollout.** Do not change the dedup behaviour; the tagging is purely additive.

**Depends on:** JD tagging - data model (N13).

**Open decisions:** whether a tag on a vendor upload should also notify the vendor. Recommended: no.

#### N15 · JD tagging – screening filter
**High · 8 h · Week 5 · RT §4, our #62**

**Goal**
- **Today:** JD filtering always searches the whole database.
- **Change:** a "Tagged to this JD" option and a tag chip on cards.
- **Done when:** RT sees exactly the candidates uploaded against a JD, ranked.

**Current behaviour.** `searchRoleCandidates` (SVC:723) searches the whole vector pool; there is no candidate↔JD link before shortlisting.

**Design**
- Option `taggedOnly` on `searchRoleCandidates`. It adds `AND EXISTS (SELECT 1 FROM rpa_candidate_mrf_tags t WHERE t.cv_id=c.id AND t.mrf_id=$mrf)` before the gates.
- Cards show a "Tagged" chip (source + date).
- A toggle in the JD tab header (UI:1031-1052).
- The cache key includes `taggedOnly`.

**Files:** SVC, UI, `backend/src/controllers/screening.controller.js`.

**Reuse:** JD tagging - data model (N13) service.

**Tests:** integration (tagged-only returns a subset); verify skill.

**Risks & rollout:** none.

**Depends on:** JD tagging - data model (N13), JD tagging - uploads (N14), JD - skill gate through JD - ranking (N07–N09).

**Open decisions:** whether "Tagged only" should be the default. Recommended: off, until tags exist for most open JDs.

### C. Other RT feedback

#### N16 · MRF approval alert
**Medium · 3 h · Week 1 · RT §1**

**Goal**
- **Today:** the message has no title, and an expired link may say "Link inactive".
- **Change:** "MRF has already been approved by the CEO/CHRO [Name]".
- **Done when:** that exact wording shows in production.

**Current behaviour**
- Link/token checks (`backend/src/services/mrfApproval.service.js:161-209`) run before the status is read (`getPublicDetails` :260, `decide` :291).
- The decided view is in `frontend/src/pages/MrfApprovalAction.jsx:165-225` (title at :186).
- The approver roster in `rpa_settings.mrf_approvers` holds only name and email (`backend/src/utils/mrfApprovalRules.js:32-66`).

**Design**
- Add an optional `title` to each roster entry. Parse it in `mrfApprovalRules.js` and update the seed `backend/prisma/seed-email-recipients.js` (CEO, CHRO).
- In `getPublicDetails`/`decide`, load the MRF first. If it is already decided, return the decided payload (`decidedByName`, `decidedByTitle`, `decidedAt`) even when the token is expired.
- UI text: `MRF has already been ${label} by the ${title} ${name}`, falling back to no title.

**Files:** `mrfApproval.service.js`, `mrfApprovalRules.js`, seed, `MrfApprovalAction.jsx`.

**Reuse:** `publicDecision`, `formatIst` (`mrfApprovalRules.js`).

**Tests:** extend `backend/src/tests/mrfApprovalRules.test.js` (title parsing, expired + decided case).

**Risks & rollout.** Updating the production roster needs a settings update. List it in the release steps.

**Depends on:** none.

**Open decisions:** none.

#### N17 · JD attached to emails
**High · 16 h · Week 3 · RT §11 (most important), our #63**

**Goal**
- **Today:** shortlist and next-stage emails carry no JD.
- **Change:** attach the MRF's JD, add an AAPNA company section, and include a link if the attachment can't be sent.
- **Done when:** a shortlisted candidate receives the correct JD.

**Current behaviour**
- `sendGraphEmail({sender,to,cc,subject,html,allowRealRecipients})` (`backend/src/services/emailNotification.service.js:40`) has no attachments parameter. It sends via draft + `/send`, falling back to `legacySendMail` (:120). Both build the same `message` object (:107-115).
- The MRF JD file is uploaded with `uploadFileToOneDrive` (`backend/src/controllers/mrf.controller.js:657`), which returns only the web URL. `jd_document_link` and `jd_attachment` (the filename) are saved at :806. No item id is kept.
- Shortlist email: `shortlistCandidates` (SVC:1871), send at ~:2036.
- Stage emails: `sendStageOutcomeEmail` (`backend/src/services/stageNotification.service.js:188`), send at ~:250.

**Design**
- **Sender**
  - Add `attachments = []` (`{ name, contentType, contentBytes(base64) }`) to `sendGraphEmail`.
  - Set `message.attachments` with `@odata.type: '#microsoft.graph.fileAttachment'` for both paths.
  - If the total is over 3 MB, drop the attachments and append a "View the job description" link block instead.
- **JD storage**
  - DDL adds `rpa_mrf.jd_item_id` (text).
  - Switch the MRF upload to `uploadFileToOneDriveDetailed` (`backend/src/services/onedrive.service.js:346`) and store `id`.
  - New helper `getMrfJdAttachment(mrf)` in a new `backend/src/services/jdAttachment.service.js`:
    - uses `downloadDriveItem({ itemId })` (:471), or `{ webUrl: jd_document_link }` for older rows
    - caps at 3 MB
    - caches in memory per MRF for 10 minutes
- **Call sites**
  - shortlist email (when `mrfId` is set)
  - `sendStageOutcomeEmail` for "approved → next stage" outcomes when the journey has `mrf_id`
- **Company section:** a new placeholder `{{company_block}}` in the email templates, filled from a new settings key `company_profile_html`, edited in Settings (admin only).
- Log `has_attachments` / `attachments_json` in `rpa_email_messages` (`backend/prisma/schema.prisma:377-378`).

**Files:**
- Backend: `emailNotification.service.js`, `mrf.controller.js`, new `jdAttachment.service.js`, `SVC`, `stageNotification.service.js`, `settings.controller.js`
- DDL: one new column
- Frontend: `frontend/src/pages/Settings.jsx`

**Reuse:** `downloadDriveItem`, `uploadFileToOneDriveDetailed`, `wrapBrandedEmail` (stageNotification).

**Tests**
- Unit: building the attachments, and the >3 MB fallback.
- Integration: `rescheduleEmails`-style send to the staging test inbox with a fixture MRF.
- Manual: check the attachment opens.

**Risks & rollout**
- A missing or unshared JD file must never block the email: log it, then send with the link.
- Old MRFs whose JD is a SharePoint link the app cannot read will fall back to the link.

**Depends on:** none. **Blocks:** Website candidates report (P07), which reuses attachment support.

**Open decisions**
- Should the company section text be written by RT or HR? Recommended: RT drafts it and the admin pastes it into Settings.

#### N18 · Candidate form overhaul
**Medium · 16 h · Week 4 · RT §2**

**Goal**
- **Today:** Position Applied For is a plain dropdown. Most fields are free text without validation. The recruiter list is hard-coded. Options differ from the recruiter edit form.
- **Change:** searchable lists, validation, and one shared field definition.
- **Done when:** both forms match, and invalid input is blocked.

**Current behaviour**
- `frontend/src/pages/MissingJdUpload.jsx` renders only the missing fields (`renderFieldInput` :104-223).
- Hard-coded lists:
  - notice (:121-130)
  - gender (:134-140)
  - shift (:162-169)
  - recruiter names (:173-180, including "Prakash Pant")
- Everything else is a plain `Input`. The Position dropdown is at :362-398 and there is no validation beyond "required".
- The recruiter edit form is in `frontend/src/pages/Candidates.jsx` (~836-842, free text).
- Submit goes to `/api/candidates/public/missing-data` (`backend/src/controllers/candidate.controller.js` ~490-575).

**Design**
- New `frontend/src/constants/candidateFields.js`. For each field key it holds `{ label, control: 'select'|'autocomplete'|'number'|'text'|'rate'|'upload', options | optionsSource, rules }`. Both forms render from it.
- **Position Applied For:** `AutoComplete` over the open MRF roles (`getApprovedRoles`), accepting free text.
- **Notice:** a select with stored value plus numeric days (`NoticePeriodDays`). The backend writes both.
- **Location:** `AutoComplete` from a distinct-city endpoint (`GET /api/candidates/public/locations`, top 500 by count).
- **Qualification:** `AutoComplete` from a curated list.
- **Recruiter:** options from a new public endpoint `GET /api/candidates/public/recruiters`, returning active recruiter users' display names only.
- **Validation**
  - phone: 10 digits, after normalising
  - email: format check
  - CTC: 0-200
  - percentages: 0-100
- Required markers come from the config.
- The backend validates the same rules: a new `validateCandidateFields()` in `backend/src/utils/`.

**Files:** `MissingJdUpload.jsx`, `Candidates.jsx`, new constants file, `candidate.controller.js`, `backend/src/routes/candidate.routes.js`, new util + unit test.

**Reuse:** `getApprovedRoles` (SVC:21), antd `AutoComplete` (as at UI:1031-1043).

**Tests:** unit tests for `validateCandidateFields`; verify skill on the public form (dark and light).

**Risks & rollout.** The public endpoints must expose names only. Rate-limit them with the existing public limiter.

**Depends on:** Dark mode on public forms (N31; theme) is independent but touches the same page. Do it first.

**Open decisions:** the curated qualification list. Recommended: start from the categories used by `matchesQualification`.

#### N19 · JD date & version
**High · 6 h · Week 1 · RT §3**

**Goal**
- **Today:** MRFs with the same name collapse to one, and no date is shown.
- **Change:** list every open MRF with its date, reference and a "Latest" marker.
- **Done when:** four ".NET Developer" MRFs appear as four distinguishable entries.

**Current behaviour**
- `getApprovedRoles` (SVC:21-55) uses `SELECT DISTINCT ON (position_hiring_for)` (:23, :46) and already returns `created_at`.
- Dropdowns:
  - UI:1040-1043
  - `frontend/src/components/screening/DecisionEmailModal.jsx:211-220`
  - `MissingJdUpload.jsx:382-386`
  - `frontend/src/pages/Pipeline.jsx:622-628`
- The roles cache is refreshed only on the `mrf:closed` socket event (`frontend/src/hooks/useScreeningData.js:45-50`).

**Design**
- Remove `DISTINCT ON` and order by `position_hiring_for, created_at DESC`.
- Return `{ id, role, created_at, ref: 'MRF-'+id, isLatest }`, where `isLatest` marks the first row per name.
- Every dropdown shows the label `"<role> · MRF-<id> · <DD MMM YYYY>"` with a "Latest" tag. The label uses the Date format (N34) date helper.
- Invalidate the roles query on `mrf:updated` too, and emit that event in the MRF PATCH handler.

**Files:** SVC, UI, `DecisionEmailModal.jsx`, `MissingJdUpload.jsx`, `Pipeline.jsx`, `useScreeningData.js`, `mrf.controller.js`.

**Reuse:** the analytics label pattern `"<role> (MRF-<id>)"` (`backend/src/services/pipeline.service.js:1932-1937`).

**Tests:** extend the `getApprovedRoles` integration check (`backend/src/tests/integration/pipelineClosure.test.js:649`) for duplicate names.

**Risks & rollout.** Callers that relied on unique role names (the public form value is the role text) are fine: the value stays the role text, and the id is extra.

**Depends on:** none.

**Open decisions:** none.

#### N20 · QA Automation tag
**Medium · 4 h · Week 1 · RT §6.1**

**Goal**
- **Today:** Screening lists open MRFs only, while Pipeline also lists closed ones.
- **Change:** a "Show closed MRFs" toggle and a Closed badge.
- **Done when:** the QA Automation role can be found in both places.

**Current behaviour.** The `getApprovedRoles` filter excludes filled and closed MRFs. Pipeline builds its positions from journeys (`backend/src/services/pipeline.service.js:381-383, 428`).

**Design**
- Add an `includeClosed` query flag on `GET /api/screening/roles`. It returns `closed_at` and `closure_reason`.
- A toggle next to the JD picker (UI). Closed entries are greyed out with a "Closed" tag.
- Searching a closed MRF is allowed and read-only: shortlist actions are disabled.

**Files:** SVC, `backend/src/controllers/screening.controller.js`, UI.

**Reuse:** `isMrfClosed` (`backend/src/services/mrfClosure.service.js`).

**Tests:** integration (the flag returns the closed MRF).

**Risks & rollout.** Do not change the closure semantics; `mrfClosure.test.js` covers them.

**Depends on:** JD date & version (N19), which touches the same function.

**Open decisions:** none.

#### N21 · Search Candidate → JD
**High · 8 h · Week 3 · RT §6.2**

**Goal**
- **Today:** Search Candidate is read-only.
- **Change:** select candidates and add them to a JD through the shortlist dialog.
- **Done when:** a candidate found by name can be tagged in a couple of clicks.

**Current behaviour**
- `frontend/src/pages/Candidates.jsx` has no actions.
- The shortlist flow exists in Screening: UI:613-689 → `DecisionEmailModal` → `POST /api/screening/shortlist` → `shortlistCandidates` (SVC:1871) → `createPipelineJourney` (`backend/src/services/pipeline.service.js:1733`, first stage).
- The cool-off guard is at :1750-1756.

**Design**
- Add row selection plus an "Add to JD" button on `Candidates.jsx`.
- Open `DecisionEmailModal` in shortlist mode with the selected candidates. It needs the same candidate shape: map `rpa_cv` rows to `{ id, Name, EmailID }`.
- On success, call `tagCandidates(source='search_candidate')` (JD tagging - data model (N13)), which `shortlistCandidates` does through its hook.
- Show cool-off skips in the result toast.

**Files:** `Candidates.jsx`, `DecisionEmailModal.jsx` (accepts an external candidate list), `frontend/src/services/screeningService.js`.

**Reuse:** `DecisionEmailModal`, `shortlistCandidates`.

**Tests:** verify skill (find by name → add to JD → appears in Pipeline at the first stage); run `shortlistStatus.test.js`.

**Risks & rollout.** This sends the shortlist email to real candidates in production, so the modal shows the recipient count before confirming.

**Depends on:** JD tagging - data model (N13). Finding candidates by exact name gets easier once Keyword - exact lookup (N02) ships in week 5, but it isn't required.

**Open decisions:** none. Choosing a landing stage is Move / re-tag candidate (L02).

#### N22 · Candidate phone & interview reminders
**High · 10 h · Week 3 · RT §9**

**Goal**
- **Today:** Zeko receives a blank phone. Many candidates have no phone on file. ATS reminder emails are switched off.
- **Change:** capture the phone, send it to Zeko, and switch on the reminders.
- **Done when:** a Zeko booking carries the phone and the candidate gets a reminder.

**Current behaviour**
- Zeko payload `phone: ''` (SVC:2636), in `scheduleInterview` (SVC:2552).
- `rpa_cv.ContactNumber` is free text and may hold several numbers.
- `backend/src/jobs/interviewReminder.js`: `interview_reminder_enabled` defaults to off (:53). It emails candidate and panel, but only for Teams rounds in `rpa_interview_schedule`. **Zeko rounds are never reminded by the ATS.**

**Design**
- **Zeko:** load `rpa_cv.ContactNumber` via the shortlist's `cv_id`, take the first valid 10-digit number from a small `normalisePhone` helper built in this item (`backend/src/utils/phone.js`; Filter utility (N01) reuses it later), and send it as `+91XXXXXXXXXX`. Zeko's own SMS reminders then reach the candidate.
- **Recruiter capture:** a phone input in `DecisionEmailModal` (shortlist) and in the schedule dialog (Interviewer & interviewee (N23)). It is pre-filled from the CV and saved through `candidate.service.update` (`backend/src/services/candidate.service.js:517`).
- **Candidate capture:**
  - At shortlist, if no valid phone exists, add `ContactNumber` to the candidate's `missingData` and include the existing missing-details form link (token flow in `candidate.controller.js`) in the shortlist email: "please confirm your mobile number".
  - Re-use the existing token, or issue one if it is missing.
- **Reminders:** turn on `interview_reminder_enabled` in Settings (production config step). Document the scope: Teams rounds only.

**Files:** SVC, `DecisionEmailModal.jsx`, `frontend/src/components/pipeline/PipelineDrawer.jsx` (schedule dialog), `candidate.controller.js` (token re-issue helper), shortlist email template.

**Reuse:** the missing-data token flow, `candidate.service.update`. The new `normalisePhone` helper is later reused by Filter utility (N01).

**Tests**
- Unit: phone selection.
- Integration: a shortlist with no phone includes the form link (staging inbox).
- Manual: a Zeko staging booking shows the phone.

**Risks & rollout.** Phone numbers are personal data: never log them in full. Mask them in logs (`******3210`).

**Depends on:** none.

**Open decisions:** the country code if a number has 10 digits with no code. Recommended: +91.

#### N23 · Interviewer & interviewee
**High · 6 h · Week 1 · RT §10**

**Goal**
- **Today:** the dialog shows only an interviewer email box, and pre-fills "Yes" as the interviewer name.
- **Change:** Interviewer and Interviewee sections, pre-filled when known.
- **Done when:** both parties' emails show, and "Yes" never appears.

**Current behaviour**
- `backend/src/services/interviewSchedule.service.js:71` maps the CEO round to the Yes/No field `ceo_management_round`.
- The `cleanHint` placeholder list (:223) lacks "yes", and `looksLikeHumanName` (:249) accepts "Yes".
- Hints are built by `mrfRoundHints` (:376) and passed via `getPipelineDetail` (`backend/src/services/pipeline.service.js:613`, ~744-748).
- Dialog `PipelineDrawer.jsx` ~2878-3050: the name is pre-filled at ~1736, and the candidate email is never shown.
- The candidate address actually used is `liveCandidateEmail`.

**Design**
- Map the CEO round's `ownerField` to `ceo_panel_details`. Add `yes`/`no`/`na` to the placeholder list.
- `previewScheduleEmails` returns `{ interviewee: { name, email, phone }, interviewers: [{ name, email }] }`. These are the real recipients after redirect rules, shown with a "staging redirect" note outside production.
- The dialog gets two sections:
  - **Interviewer**: name + email(s), pre-filled from the MRF details, or the last booking for this stage (`getSchedulesByStage`)
  - **Interviewee**: name, email and phone, read-only at first. The phone becomes editable when Candidate phone & interview reminders (N22) ships in week 3
  - Each is blank when unknown.

**Files:** `interviewSchedule.service.js`, `pipeline.service.js`, `PipelineDrawer.jsx`.

**Reuse:** `liveCandidateEmail`, `calendarCandidateEmail`, `parseInterviewerEmails`, `getSchedulesByStage`.

**Tests:** unit test for `cleanHint` ("Yes" rejected); run `schedulingAndScorecard` integration; verify skill on the dialog.

**Risks & rollout:** none.

**Depends on:** none. Candidate phone & interview reminders (N22) later makes the phone editable.

**Open decisions:** none.

#### N24 · CEO round optional
**High · 8 h · Week 1 · RT §12**

**Goal**
- **Today:** the CEO round is mandatory.
- **Change:** make it optional, default it from the MRF flag, and allow skipping CEO and Client together.
- **Done when:** a candidate on an MRF marked "No" goes from the HR round to documents.

**Current behaviour**
- Seed: ceo has no `is_optional` (`backend/prisma/seed-pipeline-stages.js:71`); client has `is_optional: true` (:72).
- `skipOptionalNext` jumps at most `+2` (`backend/src/services/pipeline.service.js:919-941`).
- The MRF has `ceo_management_round` (Yes/No), which the pipeline does not read.

**Design**
- Set `is_optional = true` for `ceo`. Do this as a data update in a DDL file: an idempotent `UPDATE rpa_pipeline_stages SET is_optional = true WHERE stage_key='ceo'`.
- Generalise `skipOptionalNext` to skip **consecutive optional stages** up to the first mandatory one, recording a `skip` event for each. Only one arrival email goes out, for the landing stage.
- In the approve dialog (PipelineDrawer ~1810-1860), if the MRF's `ceo_management_round === 'No'`, pre-select "skip CEO" and show why.
- First check that the CEO outcome template, the reminder (`interviewReminder` stage list) and the scorecard type `ceo` handle "skipped".

**Files:** DDL (data), `pipeline.service.js`, `PipelineDrawer.jsx`, `getPipelineDetail` (expose the MRF flag).

**Reuse:** existing `skip` event type, the duplicate-email guard (pipeline.service.js ~863).

**Tests:** extend `pipelineStageEngine.test.js`: from the HR round with both optional stages skipped → documents, with exactly one email.

**Risks & rollout.** This touches the stage engine; run all pipeline integration files.

**Depends on:** Skip guard (N33; server-side optional check).

**Open decisions:** none.

#### N25 · Approve-without-score label
**Medium · 3 h · Week 1 · carry-over**

**Goal**
- **Today:** the option to approve a stage without a score is unclear.
- **Change:** a clear label plus a required note.
- **Done when:** RT can use it without guidance.

**Current behaviour.** The approve path accepts missing assessment/Zeko scores. The UI shows no explicit label (`PipelineDrawer.jsx` approve dialog).

**Design**
- When the current stage has no score, the approve dialog shows "Approve without score". A note is required (min 10 characters) and saved with the outcome event.

**Files:** `PipelineDrawer.jsx`, `setStageOutcome` (`pipeline.service.js:839`) validates that the note is present when no score exists.

**Reuse:** existing `notes` on outcome events.

**Tests:** extend `pipelineStageEngine.test.js` (rejects an empty note).

**Risks & rollout:** none.

**Depends on:** none.

**Open decisions:** none.

#### N26 · Interview host visibility
**Medium · 2 h · Week 1 · carry-over**

**Goal**
- **Today:** not proven in production.
- **Change:** verify it.
- **Done when:** confirmed with one real interview.

**Current behaviour.** Bookings add the interviewer and recruiters as attendees (commit `09028f2`, "Recruiters on Interview Meetings"). This has only been tested on staging.

**Design.** Check list (production):
1. Schedule a real interview with a host who is not the organiser.
2. Confirm the host sees it in Teams and Outlook with the candidate, date, time and stage.
3. Confirm recruiters are added as attendees (commit `09028f2`).

Record the result in `docs/changelog`.

**Files:** none.

**Reuse:** `docs/phase3/MS-GRAPH-SETUP-FOR-IT.md` for permissions.

**Tests:** the check list itself.

**Risks & rollout:** none.

**Depends on:** none.

**Open decisions:** none.

#### N27 · Date Added column
**Medium · 3 h · Week 1 · carry-over**

**Goal**
- **Today:** RT can't see when a candidate was added.
- **Change:** a "Date Added" column.
- **Done when:** it is visible on both screens.

**Current behaviour.** `rpa_cv.createdAt` exists (`backend/prisma/schema.prisma:111`) and may be null for legacy rows.

**Design**
- A column on `Candidates.jsx` (sortable), and a "Added <date>" line on screening cards. Use the Date format (N34) helper and show "–" when null.
- Add `createdAt` to both screening select lists.
- Before shipping, count the null `createdAt` rows and record the number in the changelog.

**Files:** `Candidates.jsx`, UI, SVC.

**Reuse:** Date format (N34) helper.

**Tests:** verify skill.

**Risks & rollout:** none.

**Depends on:** none. It ships with `dayjs` in week 1 and switches to the Date format (N34) helper in week 2.

**Open decisions:** none.

#### N44 · Missing-details completed: bell alert & dates
**High (hot) · 14 h · Week 1 · Feedback 12 Oct; same priority as the JD / criteria match correction**

**Goal**
- **Today:** when a candidate completes the missing-details form, nobody is told, and no dates are kept. Recruiters can't pick out recent responders (warm candidates) to chase them.
- **Change:** a bell notification when a candidate fully completes the form, plus the request and completion dates on the candidate, with a "Completed in" filter on Search Candidate.
- **Done when:** a candidate completes the form → the bell shows it within seconds → Search Candidate shows both dates and lists the candidate under "Completed in: Today".

**Decisions (12 Oct)**
- The bell fires only when the form is **fully complete**. Partial submissions don't notify.
- **Reports are Phase 4.** The Excel export and the daily email of completed candidates are out of scope here. They will reuse these dates.
- The JD / criteria match correction (N01–N12) stays in Week 5.

**Current behaviour**
- **The bell already exists.** It was built in Phase 3, not Phase 4 (`docs/changelog/CHANGES-phase3-notifications.md`):
  - it is persistent (`rpa_notifications`, `backend/prisma/schema.prisma:1224-1239`)
  - `notify()` lives in `backend/src/services/notification.service.js:100`; it never throws and excludes vendors
  - it renders in `frontend/src/components/common/NotificationBell.jsx`
  - it has 14 event types (`NOTIFICATION_TYPES`, :32-50). None of them covers the missing-details form, so this item only adds one new event type.
- **Request:** `sendMissingDataEmail` (`backend/src/services/emailNotification.service.js:455`) sets `cvMissingTokenStatus` to `PENDING` → `SENT` / `FAILED` and logs the email as `data_collection` (:518-528). No request date is stored on `rpa_cv`.
- **Submission:** `submitPublicMissingData` (`backend/src/controllers/candidate.controller.js:274`) saves the fields. When nothing is missing any more it sets `statusActive='ACTIVE'` and `cvMissingTokenStatus='RECEIVED'` (:514-521), then advances the upload job (:536-548). It stores no completion date, because `modifiedAt` (:523) is overwritten by every later edit. It notifies nobody.
- **Bug found while checking this:** completing the form never closes the reminder rows in `rpa_email_log`.
  - Nothing sets `responded_at` for candidate rows, and `reminderSkipReason` (`backend/src/jobs/reminderEligibility.js:84-88`) doesn't check `RECEIVED`.
  - So a candidate who has already completed the form can keep getting "we are still awaiting your missing profile details" reminders (`backend/src/jobs/reminderScheduler.js:166-189`).

**Design**
- **DDL** `backend/prisma/ddl/2026-10-xx-cv-details-dates.sql` (+ rollback) adds two columns to `rpa_cv`:

| Column | Type | Set when |
|---|---|---|
| `details_requested_at` | timestamptz, null | `sendMissingDataEmail` persists the token (first request only; a re-send keeps the original date) |
| `details_completed_at` | timestamptz, null | the submission that leaves nothing missing (first time only) |

  - Add a partial index on `details_completed_at WHERE details_completed_at IS NOT NULL`.
  - **Backfill `details_requested_at` only**, from the earliest `rpa_email_log.sent_at` with `email_type IN ('data_collection','missing_jd')` per `reference_id`.
  - Don't backfill the completed date. No reliable source exists, so completed dates start on release day. That suits the use case, which is chasing recent responders.
- **Request date:** in `sendMissingDataEmail`, set `details_requested_at` when it is null, in the same update that persists the token (:482-485).
- **Completion hook**, in `submitPublicMissingData` when `stillMissingCount === 0` and `details_completed_at` is null:
  - set `details_completed_at = now()` in the same `rpa_cv.update` (:526)
  - **close the reminders** (the bug fix): `rpa_email_log.updateMany({ where: { reference_id: cv.id, email_type: { in: ['data_collection','missing_jd'] }, responded_at: null }, data: { responded_at: now } })`
  - call `notify()`:
    - type: new `NOTIFICATION_TYPES.CANDIDATE_DETAILS_COMPLETED = 'candidate.details_completed'`
    - title: `"<Name> completed their missing details"`
    - description: `<PositionApplied> · requested <date> · responded in <n> days`
    - `link_path`: `/candidates/<cvId>` (the existing `CandidateDetail` route). If the candidate has an open pipeline journey, set `pipeline_id` and link to `pipelineLink(pipelineId)` instead.
    - `meta`: `{ cvId, requestedAt, completedAt }`
    - recipients: the default staff roles
  - repeat submissions after completion neither move the date nor notify again
- **Reminder backstop:** select `c."cvMissingTokenStatus"` in the reminder query (`reminderScheduler.js:100-113`). In `reminderSkipReason`, skip a candidate row whose status is `RECEIVED`.
- **Dates on screen**, on Search Candidate (`frontend/src/pages/Candidates.jsx`):
  - "Details requested" and "Details completed" columns, sortable, using the Date format (N34) helper ("–" when null)
  - a quick filter "Completed in: Today / Last 7 days / Last 30 days", sorted newest first when it is on
  - the filter goes into the existing candidate list endpoint, so no new route is needed
- **Bell:** add an icon for the new type in `NotificationBell.jsx`. Nothing else changes.

**Files**
- DDL + rollback; `backend/prisma/schema.prisma` (via pull)
- `backend/src/controllers/candidate.controller.js`, `backend/src/services/emailNotification.service.js`, `backend/src/services/notification.service.js`
- `backend/src/jobs/reminderEligibility.js`, `backend/src/jobs/reminderScheduler.js`
- the candidate list service/controller behind `Candidates.jsx`
- Frontend: `Candidates.jsx`, `NotificationBell.jsx`, `frontend/src/services/candidateService.js`

**Reuse:** `notify()` and `pipelineLink`, the `CandidateDetail` route, the Date format (N34) helper.

**Tests**
- Unit: `reminderSkipReason` skips a `RECEIVED` candidate row (extend `backend/src/tests/reminderEligibility.test.js`).
- Integration (staging, fixture candidate):
  - a complete submission sets `details_completed_at`, writes one notification per active staff user and none for vendors, and closes the open reminder rows
  - a partial submission writes no notification and no completed date
  - a re-submission doesn't move the date or notify again
- Manual (verify skill): complete the public `/missing-jd-upload` form on staging. The bell updates live, the click opens the candidate, and Search Candidate lists them under "Today" with both dates.

**Risks & rollout**
- Closing the reminder rows changes live reminder behaviour: completed candidates stop getting reminders. That is the intent; note it in the Release 1 steps.
- Phone and email stay on staff-only screens.

**Depends on:** none. It doesn't depend on the Phase 4 plans: the bell is already built. **Blocks:** the Phase 4 warm-candidate report, which reuses these dates.

**Open decisions**
- The ATS logs its own requests as `data_collection`, but the reminder cron only reminds the legacy `missing_jd` type (`reminderEligibility.js:19, 43-47`). So requests sent by the ATS are never reminded.
- Recommended: confirm with RT. If it is not intended, add `data_collection` to the remindable types as a separate 1 h fix.

### D. Bugs & data correctness

#### N28 · Scores in the pipeline drawer
**High · 12 h · Week 2 · our item, our bug #5**

**Goal**
- **Today:** Zeko scores vanish after the round. Scorecard scores appear only in a pop-up. Excel scores are never shown.
- **Change:** every round keeps its scores visible, and there is an "Uploaded scores" panel.
- **Done when:** a candidate at Tech 2 still shows all earlier scores.

**Current behaviour**
- `getPipelineDetail` loads Zeko round/result only when the current stage is a Zeko stage (`backend/src/services/pipeline.service.js:709`).
- The drawer passes Zeko data only to the current stage (`PipelineDrawer.jsx:1935-1939`).
- Scorecard scores are only in `ScorecardReportModal` (:4191).
- Excel scores sit on `rpa_cv` legacy columns (`IQScore`, `TechRoundOne`…, schema:122-132) and the pipeline never reads them.

**Design**
- **Backend:** return `zekoRounds: { zeko_hr: {round, scores, reportLink}, zeko_fn: {...} }` by calling `findZekoRoundResult` for both stages. Keep `zekoScores` for the current stage, for compatibility. Add `uploadedScores` from the `rpa_cv` legacy columns, omitting nulls.
- **Frontend**
  - `buildPipelineSegments` reads `zekoRounds[stage.stage_key]`.
  - Interview rounds show the average score and verdict from `scorecardReport.rounds` (already fetched at :983) inside the round panel.
  - A collapsible "Uploaded scores (from Excel)" card at the top.

**Files:** `pipeline.service.js`, `PipelineDrawer.jsx`.

**Reuse:** `findZekoRoundResult`, `zekoScoreSegment` (`PipelineDrawer.jsx:220`), scorecard report query.

**Tests:** unit `zekoRoundScoreScoping.test.js` still passes. Add a case: the HR result stays on `zeko_hr` once the candidate is on `zeko_fn`. Verify skill.

**Risks & rollout.** Keep per-round scoping strict. The 25-Aug incident showed one round displaying another round's score (`backend/src/services/pipeline.service.js:643-652`).

**Depends on:** none.

**Open decisions:** none.

#### N29 · Candidate data sync
**High · 16 h · Week 2 · our bug #2**

**Goal**
- **Today:** a name or score edited in Search Candidate doesn't show in Pipeline, Analytics or emails.
- **Change:** audit every copy, then sync them.
- **Done when:** edits show everywhere after a refresh.

**Current behaviour.** Known copies of candidate data:
- `rpa_shortlisted_candidates.candidate_name` / `candidate_email` (schema:305-306, written at SVC:1934-1935, 1953-1954), read by:
  - the board (`pipeline.service.js:379-380`)
  - the drawer (8 places, e.g. `PipelineDrawer.jsx:1563, 2894`)
  - analytics (SVC:2351)
  - emails (`pipeline.service.js:797, 1031, 1067, 1422`)
- `rpa_zeko_interview_results.candidate_name`, `rpa_upload_jobs.candidate_name`, `rpa_email_notifications.candidate_name`
- Caches: Redis `screening:role:*` (1 h); React Query `staleTime: Infinity` on the screening roles query
- `rpa_cv.ai_profile_insights` and `rpa_cv_vectors.text`, which are not regenerated on edit

**Design**
1. **Audit (4 h).** Write `docs/reference/candidate-data-copies.md`: field → copies → readers → decision.
2. **Fix (12 h)**
   - In `candidate.service.update`, inside the same transaction, update `rpa_shortlisted_candidates` name/email where `cv_id = id`.
   - The board and drawer select `cv.Name` / `cv.EmailID` first and fall back to the copy.
   - Historical tables (email notifications, Zeko results) are logs: leave them.
   - After an edit, delete `screening:role:v2:*` keys for MRFs that list this candidate. Simpler: bump a global screening cache version key.
   - If skills, experience or CTC change, re-embed the vector and regenerate insights via `runPostProcessing`-style async work (`backend/src/services/hrUpload.service.js:1796`).
   - **Scores:** one source of truth per score. Interview scores come from scorecards and Zeko results. Legacy `rpa_cv` scores become read-only, shown in the Scores in the pipeline drawer (N28) "Uploaded scores" panel. The Search Candidate edit form shows them as read-only.

**Files:** new doc; `candidate.service.js`, `pipeline.service.js`, `PipelineDrawer.jsx`, `Candidates.jsx`, SVC (cache version).

**Reuse:** `saveCandidateVector`, `preGenerateCandidateInsights`.

**Tests:** integration: rename a fixture candidate and assert the shortlist row and board read show the new name.

**Risks & rollout.** Re-embedding costs one embedding call per edit; it is async and only runs when a scoring field changes.

**Depends on:** none.

**Open decisions:** whether to keep legacy score editing in Search Candidate. Recommended: read-only (as above).

#### N30 · Pipeline popup crash
**High · 6 h · Week 1 · our bug #3**

**Goal**
- **Today:** closing the popup can blank the page.
- **Change:** fix the crash and add an error screen.
- **Done when:** repeated open and close never blanks the page.

**Current behaviour**
- `closeDrawer` (`frontend/src/pages/Pipeline.jsx:427-435`) clears the id and URL params.
- The drawer returns `null` when not open (`PipelineDrawer.jsx:1652`), which unmounts nested modals, the iframe email editor and the video player at once.
- There is no React ErrorBoundary.

**Design**
1. Reproduce with the console open (verify skill + console read) across the tabs:
   - recording deep link
   - scorecard modal
   - email editor
2. Fix the cause. Likely candidates:
   - a state update after unmount in the email editor
   - the `recording` param handling
3. Keep the Drawer mounted (`open` prop, `destroyOnClose`) instead of returning null, so antd can animate and clean up.
4. Add `frontend/src/components/common/ErrorBoundary.jsx` around routes in `App.jsx`, plus a local one around the drawer content. It shows "Something went wrong — Reload" and logs to the console. Developer logging & error tracing (N42) adds reporting.

**Files:** `PipelineDrawer.jsx`, `Pipeline.jsx`, new `ErrorBoundary.jsx`, `App.jsx`.

**Reuse:** `ErrorState` (`frontend/src/components/common/ErrorState.jsx`).

**Tests:** verify skill: open and close 20 times across the tabs with no console errors.

**Risks & rollout:** none.

**Depends on:** none.

**Open decisions:** none.

#### N31 · Dark mode on public forms
**Medium · 4 h · Week 1 · our bug #1**

**Goal**
- **Today:** a dark saved theme leaks into public form pop-ups.
- **Change:** force light for the whole page.
- **Done when:** all public forms render fully light in a dark browser.

**Current behaviour**
- `ForceLight` (`frontend/src/App.jsx:265-273`) wraps only the subtree. Portals render on `<body>`, which inherits the dark `data-theme` on `<html>` (`frontend/src/context/ThemeContext.jsx:40-47`).
- Overlay classes use `var(--glass-4-bg)` (`frontend/src/theme/aurora-glass.css:950-957`).
- `MrfSubmit.jsx:3` and `MrfApprovalAction.jsx:5` use static `message`.

**Design**
- `ForceLight` sets `document.documentElement.dataset.theme='light'` on mount and restores the previous value on unmount.
- Skip the app-wide overlay classes on public routes.
- Switch to `App.useApp().message`.

**Files:** `App.jsx`, `ThemeContext.jsx`, `MrfSubmit.jsx`, `MrfApprovalAction.jsx`.

**Reuse:** existing theme tokens.

**Tests:** verify skill with saved theme = dark, on all 5 public routes, opening every dropdown and date picker.

**Risks & rollout:** none.

**Depends on:** none.

**Open decisions:** none.

#### N32 · Approver email wording
**Low · 1 h · Week 1 · our bug #4**

**Goal**
- **Today:** "Approver A / Approver B".
- **Change:** real names and clearer note text.
- **Done when:** emails show the right names.

**Current behaviour.** Seed names are "Staging Approver A/B" (`backend/prisma/seed-email-recipients.js:96-105`). The note text is at `backend/src/services/emailNotification.service.js:1203-1208`.

**Design.** Update the staging seed to real names (with test-inbox emails), and rewrite the note: "This request was also sent to <name>. The first decision is final."

**Files:** seed, `emailNotification.service.js`.

**Reuse:** none.

**Tests:** `emailHelpers.test.js`.

**Risks & rollout:** none.

**Depends on:** none.

**Open decisions:** none.

#### N33 · Skip guard
**High · 3 h · Week 1 · found in code review**

**Goal**
- **Today:** the API lets any staff user skip any stage.
- **Change:** the server allows skipping optional stages only.
- **Done when:** skipping a mandatory stage is refused.

**Current behaviour.** `advanceStage({skip})` (`backend/src/services/pipeline.service.js:1090`) does not check `is_optional`. Only the UI does (`PipelineDrawer.jsx:2575`).

**Design.** In `advanceStage`, if `skip` is set and the current stage is not optional, throw `400 'This stage is mandatory and cannot be skipped'`. Apply the same check to `skipOptionalNext` in `setStageOutcome`.

**Files:** `pipeline.service.js`.

**Reuse:** `stages` lookup in the same function.

**Tests:** `pipelineStageEngine.test.js`: a mandatory skip is rejected.

**Risks & rollout:** none.

**Depends on:** none. **Blocks:** CEO round optional (N24).

**Open decisions:** none.

#### N34 · Date format
**Medium · 8 h · Week 2 · our item**

**Goal**
- **Today:** about 13 date formats, some depending on browser locale.
- **Change:** one IST helper.
- **Done when:** every date follows the same format.

**Current behaviour.** About 13 distinct `dayjs` formats plus 17 files using `toLocaleDateString` / `toLocaleString`. There is no shared helper.

**Design**
- New `frontend/src/utils/dateFormat.js` (dayjs + utc + timezone plugins, `Asia/Kolkata`):
  - `fmtDate` → `07 Oct 2026`
  - `fmtDateTime` → `07 Oct 2026, 4:30 PM`
  - `fmtTime`
  - `fmtRelative`
- Replace every `toLocale*` call and ad-hoc format. Find them by searching for `toLocale` and `format('`.
- Keep `YYYY-MM-DD` for machine keys.

**Files:** new util; about 25 frontend files (Dashboard, Pipeline, PipelineDrawer, Candidates, MRF, Analytics, VendorDashboard, …).

**Reuse:** the existing `fmtDateTime` in `PipelineDrawer.jsx` moves to the util.

**Tests:** verify skill on the main pages.

**Risks & rollout.** Do it as a mechanical change with no logic edits; check the timezone plugin registration in `frontend/src/main.jsx`.

**Depends on:** none. **Blocks:** JD date & version (N19) and Date Added column (N27) labels.

**Open decisions:** none.

### E. CEO clarity, dashboard & analytics

#### N35 · Labels & legends
**High · 12 h · Week 2 · CEO (Phase 3 Enh. rows 3-4)**

**Goal**
- **Today:** the pipeline columns and statuses are unclear. "Invited" and "In progress" were explained the wrong way round in the demo. There is no "test sent" signal on the board.
- **Change:** clear names, a legend, a test-sent chip, and a sweep of other labels.
- **Done when:** someone new can read the board without explanation.

**Current behaviour**
- `cardStatus` (`frontend/src/pages/Pipeline.jsx:88-103`):
  - "Invited" means the Zeko link was sent (`pipeline.service.js:247-250, 366-368`)
  - the default is "In progress"
  - "Evalground test pending" ignores invites (:101)
- Invite state exists: `getInviteState` (`backend/src/services/assessmentInvite.service.js:135`).
- Screening chips use different cut-offs from the stars (UI:1445-1449 vs SVC:1785-1787).

**Design**
- **Card labels**
  - "Not yet invited" (was "In progress")
  - "Zeko link sent" (was "Invited")
  - "Scheduled"
  - "Awaiting decision" (was "Ready for decision")
  - "Test sent · due <date>" / "Test overdue" / "Test not sent" for assessment, via `listPipeline` including the latest invite per journey
- **Legend:** a "What do these mean?" popover on the board header, driven by `frontend/src/constants/metricDefinitions.js` (new `pipelineStatus` entries) and rendered with `MetricInfo`.
- **Column headers:** stage label plus a one-line description from `rpa_pipeline_stages`. Add a `description` column via DDL, or keep descriptions in constants. Recommended: constants.
- **Sweep:** Screening chips, HR/Vendor upload job statuses ("waiting", "saved to database"), MRF badges, Vendor Dashboard. Make each label say what it means, and add a tooltip.

**Files:** `Pipeline.jsx`, `pipeline.service.js` (`listPipeline` adds invite state), `metricDefinitions.js`, UI, `HRUpload.jsx`, `VendorPortal.jsx`, `MRF.jsx`, `VendorDashboard.jsx`.

**Reuse:** `MetricInfo`, `getInviteState`.

**Tests:** verify skill; a walk-through with RT.

**Risks & rollout.** Brief RT after release. Their mental model of the labels changes.

**Depends on:** none.

**Open decisions:** the final wording. Recommended as above; RT to confirm.

#### N36 · Dashboard fixes
**High · 20 h · Week 4 · our #61, 10 Sep dashboard-numbers item**

**Goal**
- **Today:** trends come from only the newest 200 candidates. Counts use old statuses. Upcoming interviews show Zeko only. Rows lose context. The role filter uses free text.
- **Change:** server totals and aligned definitions.
- **Done when:** the numbers match Analytics and Search Candidate.

**Current behaviour**
- `AGG_BATCH = 200` (`frontend/src/hooks/useDashboardData.js:17`), with trends computed client-side (`frontend/src/pages/Dashboard.jsx:132-212`).
- `getStats` (`backend/src/services/dashboard.service.js:16-136`):
  - shortlisted = `pipeline_status in (shortlisted, selected)`
  - hired mixes `offer_accepted_at`, `joined_at` and statuses
- `UpcomingInterviews` uses Zeko windows only and navigates to `/analytics` (`frontend/src/components/dashboard/UpcomingInterviews.jsx:30, 68`).
- `LatestUploads` goes to `/candidates` with no id (:61, :97).
- The role filter compares `PositionApplied` with the MRF role (`Dashboard.jsx:142-146`).

**Design**
- New `GET /api/dashboard/trends?range=30&mrfId=` returns daily added counts, top roles (by tag, else by `PositionApplied`) and top skills, computed in SQL (`date_trunc('day', "createdAt")`).
- **Definitions** (in `metricDefinitions.js`, shown via tooltips):
  - **Shortlisted** = open journeys (`rpa_candidate_pipeline` with no `final_outcome`).
  - **Hired** = journeys with `final_outcome IN HIRED_OUTCOMES` (`backend/src/config/pipelineStages.js:173`).
  - **Shortlist rate** = shortlisted in range ÷ added in range.
- **Upcoming interviews:** union Zeko windows with `rpa_interview_schedule` (Teams) for the next 7 days. Each row opens `/pipeline?candidate=<pipelineId>`.
- **Recent uploads:** link to `/candidates/<id>`; sort by `id DESC`.
- **Role filter:** by MRF id, using the JD date & version (N19) list.

**Files:** `dashboard.service.js`, `backend/src/controllers/dashboard.controller.js`, `backend/src/routes/dashboard.routes.js`, `useDashboardData.js`, `Dashboard.jsx`, `UpcomingInterviews.jsx`, `LatestUploads.jsx`, `metricDefinitions.js`.

**Reuse:** `HIRED_OUTCOMES`, `bucketFor` (`backend/src/services/pipelineAnalytics.helpers.js:154`).

**Tests:** unit tests for definitions in `pipelineAnalytics.test.js` style; a cross-check script comparing dashboard vs Analytics numbers for the same range.

**Risks & rollout.** The numbers will change visibly. Add a "Definitions updated" note on the dashboard for 2 weeks.

**Depends on:** JD date & version (N19).

**Open decisions:** none.

#### N37 · Raw vs qualified (interim)
**Medium · 6 h · Week 4 · CEO (Phase 3 Enh. row 2)**

**Goal**
- **Today:** there is no raw vs qualified view.
- **Change:** two numbers from existing data, after the definition is agreed with Chhaya.
- **Done when:** both show on the dashboard with tooltips.

**Current behaviour.** Available signals:
- `rpa_cv.cvMissingTokenStatus = 'RECEIVED'` when the details form is completed (`candidate.controller.js:519-520`)
- inbound replies in `rpa_email_messages` (`direction='inbound'`)
- `last_action_context`

**Design.** Add to `getStats`, for the selected range:
- **raw** = candidates added (`createdAt` in range)
- **qualified** = raw candidates who completed the details form **or** sent an inbound reply

Show two KPI cards with the definition in `metricDefinitions.js`. If an MRF is selected, raw = tagged to that MRF (JD tagging - data model (N13)), and the definition says so.

**Files:** `dashboard.service.js`, `Dashboard.jsx`, `metricDefinitions.js`.

**Reuse:** Dashboard fixes (N36) trends endpoint.

**Tests:** unit test for the definition; spot-check 10 candidates.

**Risks & rollout.** This is interim. Responded status & source marker (P01) replaces the signals with a stored status.

**Depends on:** none; uses the existing `getStats` query. The per-MRF view needs JD tagging - data model (N13).

**Open decisions:** the definition. Recommended as above; confirm with Chhaya before building.

#### N38 · Recency filter
**Medium · 4 h · Week 5 · CEO (Phase 4 sheet row 84)**

**Goal**
- **Today:** screening can't be limited to recent candidates.
- **Change:** an "Added in" filter.
- **Done when:** it works in keyword and JD screening.

**Current behaviour.** No date filter exists. `rpa_cv.createdAt` may be null for legacy rows.

**Design**
- `addedWithinDays` ∈ {7, 10, 15, 30, 90} in `parseScreeningFilters` (Filter utility (N01)) → `c."createdAt" >= now() - interval`.
- Null dates are excluded when the filter is set, matching the empty-value rule.
- A select on both tabs (UI).

**Files:** `screeningFilters.js`, SVC, UI.

**Reuse:** Filter utility (N01).

**Tests:** unit tests for the SQL builder.

**Risks & rollout:** none.

**Depends on:** Filter utility (N01).

**Open decisions:** none.

#### N39 · Analytics – Positions tab
**Medium · 20 h · Week 4 · CEO (Phase 3 Enh. row 5), Anuj**

**Goal**
- **Today:** Analytics shows one MRF at a time.
- **Change:** a cross-position tab with the journey, the joining ratio and Moved Forward.
- **Done when:** every position's status is visible on one screen.

**Current behaviour**
- `getPipelineAnalytics` (`backend/src/services/pipeline.service.js:1838-2125`) loads all journeys and events in one query (:1852-1857), but builds the funnel for one MRF (:1903-1980).
- `rpa_offers` (`backend/prisma/schema.prisma:1203-1222`) is not included.
- MRF fields available: `created_at`, `decided_at`, `filled_at`, `closed_at`, `closure_reason`, `number_of_positions`.

**Design**
- New `getPositionsOverview()`:
  - group `allJourneys` by `mrf_id` in one pass
  - for each MRF:
    - opened (`decided_at` ?? `created_at`)
    - days open
    - positions
    - shortlisted (journeys)
    - per-stage arrival counts (the `isStageArrival` loop)
    - offers made (`rpa_offers` rows)
    - accepted (`candidate_decision='accepted'`)
    - joined (`final_outcome='joined'`)
    - closed + reason
  - **hiring-to-joining ratio** = joined ÷ accepted
  - **Moved Forward** = journeys that reached stage 2 or later
- Endpoint `GET /api/pipeline/analytics/positions` (behind module `recruitment_pipeline`), with a CSV export via the `runExport` framework.
- New "Positions" tab in `frontend/src/pages/Analytics.jsx`:
  - one table, sortable
  - status filter (open/closed)
  - click a row → the existing single-MRF funnel

**Files:** `pipeline.service.js` (or a new `positionsAnalytics.service.js`), `backend/src/controllers/pipeline.controller.js`, `backend/src/routes/pipeline.routes.js`, new export module, `Analytics.jsx`.

**Reuse:** `isStageArrival` (`pipelineStages.js:128`), `bucketFor`, `timeToHireFor`, `runExport`.

**Tests:** unit tests in `pipelineAnalytics.test.js` (grouping, ratio with zero accepted).

**Risks & rollout.** Memory: all events are loaded already, so this adds no new query load.

**Depends on:** none. **Related:** Analytics - date range & Total Applied (L06) adds the date range and Total Applied.

**Open decisions:** none.

### F. Developer logging & system documentation

#### N42 · Developer logging & error tracing
**High · 30 h · Week 2 · Our #52 ("logs should be visible to developers"); CEO (Phase 3 Enh. row 6, longevity)**

This replaces the parked items Longevity - alerts and Longevity - error view from the Phase 3 in Phase 4 list.

**Goal**
- **Today:**
  - Developers hear about problems from HR.
  - Logs are files on the server.
  - Nothing ties an HR report to a log line.
  - Scheduled-job failures and crashes are only logged.
  - Browser errors are not captured.
- **Change:**
  - A reference ID on every request and error message.
  - Structured log context.
  - Alerts on job failures and crashes.
  - Browser error capture.
  - An admin "Logs & errors" page, searchable by reference, user and time.
  - A deep health check.
- **Done when:** HR quotes the error reference shown on screen, and a developer finds the full trail (request, user, stack, external calls) in under 2 minutes without server access.

**Current behaviour**
- Winston logger (`backend/src/config/logger.js`) writes to the console, `logs/error.log` and `logs/combined.log` (JSON, 10 MB × 5 files).
- Morgan HTTP lines go into Winston (`backend/src/app.js:60-64`).
- **No request ID exists anywhere.** There is no `x-request-id` and no AsyncLocalStorage context.
- `backend/src/middleware/errorHandler.js` emails developers on any 5xx through `sendBackendErrorAlert`, throttled to once per 5 minutes per error signature.
- Cron job errors are only logged (e.g. `backend/src/jobs/mailboxPoller.js:94`, `backend/src/jobs/assessmentDeadlineChecker.js:33`).
- Uncaught exceptions and rejections are logged, then the process exits with no alert (`backend/src/server.js:145-153`).
- `/api/health` reports uptime only (`backend/src/app.js:100`).
- `getQueueHealth()` (`backend/src/queues/resumeQueue.js:63`) is never called.
- There is no browser error capture. Pipeline popup crash (N30) adds an ErrorBoundary that only logs to the console.

**Design**
1. **Request reference.** New `backend/src/middleware/requestContext.js`.
   - Generates a short `requestId`, or accepts an incoming `x-request-id`.
   - Stores `{ requestId, userId, role, route }` in AsyncLocalStorage.
   - Returns the ID in the `x-request-id` response header.
   - A Winston format adds `requestId` and `userId` to every line automatically, and the morgan line includes it.
   - Error responses carry `ref`. The frontend API interceptor (`frontend/src/services/api.js`) shows "Something went wrong (ref: AB12CD)" in error toasts.
2. **External-call logging.** `logExternal(service, operation, fn)` records duration, status, error and `requestId` (never bodies or personal data). It wraps:
   - Graph: `sendGraphEmail` in `backend/src/services/emailNotification.service.js`, and `backend/src/services/onedrive.service.js`
   - Zeko: `backend/src/services/zeko.service.js`
   - AI: `generateContentWithFallback` in `backend/src/utils/geminiHelper.js`
   - Cohere: `backend/src/services/vectorStore.service.js`
3. **Error store.** DDL table `rpa_error_log`:
   - `source` (`backend` / `frontend` / `job`), `level`, `message`, `stack`
   - `request_id`, `route`, `user_id`
   - `meta` (JSON, whitelisted keys only)
   - `fingerprint` (deduplication key), `count`, `first_seen`, `last_seen`
   
   `errorHandler` and the job runner write to it. A 30-day retention sweep follows the `backend/src/jobs/mrfAuditRetentionSweep.js` pattern.
4. **Jobs.** New `backend/src/utils/jobRunner.js`: `runJob(name, fn)` wraps every cron callback registered in `server.js`. It:
   - times the run and catches errors
   - writes `rpa_error_log`
   - alerts through `sendBackendErrorAlert` (same throttle)
   - records a heartbeat (`rpa_settings` key `job_heartbeat_<name>`)
5. **Crash alert.** The `uncaughtException` / `unhandledRejection` handlers send an alert, with a 3-second timeout, before exiting.
6. **Browser errors.** The ErrorBoundary, `window.onerror`, `unhandledrejection` and API 5xx responses all post to `POST /api/errors` (logged-in users, rate-limited), including the `requestId` when known. Query strings are stripped.
7. **Admin page "System → Logs & errors"** (`AdminRoute`):
   - errors grouped by fingerprint (count, last seen), filtered by source, date and user
   - **search by reference:** shows that request's error rows plus its lines from `combined.log` and the rotated files. `GET /api/admin/logs?ref=` does a bounded server-side scan.
   - a job panel showing the last run and last failure per job
   - deep health: `GET /api/health?deep=1` (admin) checks the database, Redis, the queue and the Graph token, and returns 503 on failure. The plain `/api/health` stays cheap.
8. **Log hygiene.** A helper masks phone numbers and emails in log text (`******3210`, `a***@domain`). The level is set by `LOG_LEVEL`.

**Files**
- New: `requestContext.js`, `jobRunner.js`, `backend/src/services/errorLog.service.js`, an admin logs controller and routes, `frontend/src/pages/admin/LogsAndErrors.jsx`.
- Changed: `logger.js`, `app.js`, `server.js`, `errorHandler.js`, every file in `backend/src/jobs/` (wrapping only), the integration services listed above, `frontend/src/services/api.js`, `ErrorBoundary.jsx`, `App.jsx`, `MainLayout.jsx`.
- DDL for `rpa_error_log`.

**Reuse:** `sendBackendErrorAlert` and its throttle; the existing Winston logger; the developer alert list (`backend/src/config/emailRecipients.js`); the `ErrorState` component.

**Tests**
- Unit:
  - the reference survives async calls (AsyncLocalStorage)
  - fingerprinting
  - masking
  - `runJob` alerts once per signature
- Integration: a forced 500 returns `ref`, and the same `ref` is in `rpa_error_log`.
- Manual on staging:
  - force a cron failure: an alert arrives and the page shows it
  - throw in a test component: it is listed within a minute
  - search a ref: the log trail is shown

**Risks & rollout**
- Personal data in logs: mask it, and whitelist `meta` keys.
- Log volume: external-call success lines log at `debug`, failures at `warn`/`error`.
- The log-file scan is capped by size and time.

**Depends on:** Pipeline popup crash (N30), for the ErrorBoundary.
**Blocks:** MS Access export scheduling (M3), which uses `runJob`, and the runbook section of System documentation & development history (N43).

**Open decisions**
- Alert recipients. Recommended: the existing developer list.
- Show the error reference to HR in toasts. Recommended: yes.
- Retention. Recommended: 30 days.

#### N43 · System documentation & development history (since Jan 2026)
**High · 24 h · Week 4-5 · Your request; CEO (Phase 3 Enh. row 6: docs, runbooks)**

This replaces the parked item Longevity - runbook from the Phase 3 in Phase 4 list.

**Goal**
- **Today:**
  - Knowledge is spread across 50+ feature plans, RCAs and changelog files.
  - Nothing describes how the system works as a whole today.
  - There is no record of what has been built since January.
  - There is no operations runbook.
- **Change:** one documentation set covering:
  - system overview
  - module guide
  - data model
  - jobs and integrations
  - configuration
  - operations runbook
  - onboarding
  - development history from January to October 2026
- **Done when:** a developer new to the project can do all of the following from `docs/system/` alone:
  - set up the project
  - find any module
  - handle a common incident
  - see what was built, when and why

**Current behaviour (sources to draw from)**
- **Git history.** The full-stack repo starts on 10 Jun 2026: 238 commits up to 25 Sep (Jun 48, Jul 55, Aug 106, Sep 29).
- **Changelogs:** `docs/CHANGELOG.md` (35 entries), `docs/changelog/` (53 write-ups), `frontend/UI-CHANGELOG.md`.
- **Module docs** in `docs/reference/`:
  - `BACKEND.md`, `FRONTEND.md`, `MODULES.md`
  - `ROLE_RULES.md`, `ADMIN_ACCESS_CONTROL.md`
  - `VENDOR_PROCESS.md`, `HR_MANUAL_UPLOAD.md`, `Email-Templates-Summary.md`
  
  Some are out of date: `screening.md` still describes the old result caps.
- **Process and design:** `docs/phase3/` (`01-PROCESS-UNDERSTANDING.md`, `02-BUSINESS-DESIGN.md`, plans) and `docs/UAT-phase3/`.
- **Deployment:** `docs/deployment/` (3 docs).
- **Before June (n8n era, Phases 1-2).** None of this is in git. It is recorded in the hidden sheets of `ATS App - Phase wise Task Items.xlsx`:
  - "Phase 2 Task Items"
  - "Phase 2 Feedback- Iteration 1-4"
  - "N8n to Full Stack Transistion"
  - "Phase 3 (OLD)"
  - "Phase 3 OLd V1"
  - "Phase 3 Old V2- 14 Jul"
  
  The older code folders `D:\Projects\ATS\V19`-`V21` are a further source.

**Design.** A new folder, `docs/system/`, with these files:

| File | Content | h |
|---|---|---|
| `README.md` | Index; who each doc is for; the update rule (below) | — |
| `01-SYSTEM-OVERVIEW.md` | End-to-end flow (MRF → approval → intake → screening → pipeline → offer → joining); architecture diagram (Express API, resume worker, Postgres + pgvector, Redis/BullMQ, React app); environments (staging / production databases); external services (MS Graph mail / calendar / OneDrive, Zeko, Evalground import, OpenRouter/Gemini, Cohere, Turnstile) | 3 |
| `02-MODULES.md` | One section per module: MRF & approval; HR upload & email intake; vendor portal; screening (keyword / JD); pipeline & stages; interviews, scorecards & recordings; assessment; offers & documents; dashboard & analytics; admin, settings & roles. Each section covers purpose, screens, key files, endpoints, tables, emails and jobs. Outdated reference docs get a "superseded by" note | 6 |
| `03-DATA-MODEL.md` | Key tables and relationships (`rpa_cv`, `rpa_mrf`, `rpa_shortlisted_candidates`, `rpa_candidate_pipeline`, stage events, scorecards, offers, settings…); the DDL process; known pitfalls such as the `pipeline_status` CHECK constraint | 3 |
| `04-JOBS-AND-INTEGRATIONS.md` | Every cron / queue job with its schedule, purpose, settings and failure behaviour; each integration's auth, limits and failure handling | 2 |
| `05-CONFIGURATION.md` | Environment variables grouped by area (names only, no secrets); `rpa_settings` keys; feature flags; email routing | 2 |
| `06-OPERATIONS-RUNBOOK.md` | Logs & errors (the page from Developer logging & error tracing (N42)); restart / deploy / rollback (links to the deployment docs); known failures and fixes: Graph token, AI 429s (`docs/RATE_LIMIT_429_FIX.md`), Zeko sync gaps, stuck uploads (`docs/phase3/RESUME-PROCESSING-FAILED-CV-TMP-ITEM-ID-RCA.md`), the CHECK-constraint pitfall; weekly checks; account owners and contacts | 3 |
| `07-DEVELOPMENT-HISTORY-2026.md` | Timeline from January to October 2026, by phase and month: Phases 1-2 on n8n (from the workbook sheets) → the move to full stack (June) → Phase 2 iterations → Phase 3 (Jul-Sep: pipeline engine, scorecards, recordings, dossier, referral, MRF approval rework…) → Phase 3 feedback (Sep-Oct). For each: what shipped, when, why (linking its plan / RCA), and notable incidents. Built from merged PRs in `git log`, the changelogs and the workbook sheets | 4 |
| `08-ONBOARDING.md` | Local setup; running unit and integration tests; the staging test-inbox redirect; conventions (links to §3 of this plan) | 1 |

**Update rule.** Every release updates the affected module page and adds a line to the history. This is added to the release steps in §6.

**Files:** new docs only (`docs/system/*`), plus "superseded by" notes on outdated reference docs.

**Reuse:** all the sources listed above; `git log --since=2026-06-01 --merges`; the workbook's hidden sheets.

**Tests**
- Dry run: a second developer (e.g. Pankaj) follows the onboarding guide and the runbook for one simulated incident.
- The same developer answers five "where is X / why does Y happen" questions using only the docs.
- Fix any gaps the dry run finds.

**Risks & rollout:** docs drift. The update rule makes keeping them current part of each release.

**Depends on:** Developer logging & error tracing (N42). Write the runbook's logs section last.
**Blocks:** none.

**Open decisions**
- Audience. Recommended: developers only. HR-facing user guides come later, in the style of `docs/Recruitment-Analytics-User-Guide.md`.
- Reviewer. Recommended: Pankaj.

### G. Housekeeping

#### N40 · Housekeeping
**Medium · 0 h · Week 1 · demo 28 Sep; admin action**

**Goal**
- **Today:** stale or test MRFs show as open. Samriddhi is tagged to the wrong JD. HRD hiring happens outside the ATS.
- **Change:** close the stale MRFs, close the wrong journey, and create HRD logins.
- **Done when:** the open-positions list is accurate and HRD candidates are entered in the ATS.

**Current behaviour**
- Manual MRF close with a reason exists (`closeMrfManually`, the 26 Aug closure work).
- Journey closure with a final outcome exists in the drawer.
- Admins create users in Admin → Users (`backend/src/controllers/admin.controller.js:213-311`).
- A new recruiter gets every module except `hr_admin` (:38-56).

**Design / steps**
1. **Close stale MRFs.** In the MRF page, use "Close" with a reason (e.g. Business Development Services, T Snap Project One). This uses the existing `closeMrfManually`.
2. **Samriddhi.** On the wrong JD's journey, use the drawer's final outcome "Closed – tagged in error". The 26 Aug closure feature records it.
3. **HRD logins (Susmita, Subhajit).** Create them in Admin → Users.

**Files:** none.

**Reuse:** existing admin features.

**Tests:** none.

**Risks & rollout.** "Upload only" access is **not possible without code today**:
- module checks guard only the hrUpload, screening, pipeline and vendor routes (`backend/src/middleware/auth.js:123`)
- the sidebar is not filtered by permissions (`frontend/src/layouts/MainLayout.jsx:258-267`)

**Depends on:** none.

**Open decisions:** HRD access.
- **Option A (recommended now):** a normal recruiter account, with no code. They see all recruiter screens.
- **Option B (about 6 h):** add `checkModuleAccess` to the remaining routes, filter `MENU_ITEMS` by `user.permissions`, then give HRD the `hr_upload` module only. If chosen, track it as a new Do Now item.
- Owner: Harish.

### H. To brainstorm later

#### N41 · Upload speed
**Medium · hours TBD · after all other items · RT "Matching & score analysis takes too long to upload"**

Status: brainstorm later. No solution is designed here, as agreed.

**Problem statement.** RT reports that uploads take too long. In the current code:
- `runBatchParsing` (`backend/src/services/hrUpload.service.js:1042`) loops over files and, inside each file, over items, calling the AI parser `parseResumeWithOpenRouter` (:239, call at ~1160) **one at a time**. An Excel of N rows is N sequential AI calls.
- Each file is also uploaded to OneDrive before parsing (~1140).
- After saving, `runPostProcessing` (:1796) runs asynchronously: embedding (`saveCandidateVector`) plus a second AI call (`preGenerateCandidateInsights`, :948).
- The BullMQ queue (`dispatchBatchParsing` :1771, worker concurrency 5 at `backend/src/workers/resumeWorker.js:52`) is used only when `USE_RESUME_QUEUE=true`, which is not set by default.

**Measurements to collect before the brainstorm:**
- time per resume
- time per Excel row
- AI latency (p50/p95)
- OneDrive upload time
- post-processing time
- queue on vs off on staging
- whether RT's complaint means upload or JD matching (JD - search speed (N10) may already resolve the latter)

**Brainstorm agenda**
1. Which step dominates.
2. Parallelism limits (AI provider rate limits, `docs/RATE_LIMIT_429_FIX.md`).
3. Skipping AI for structured Excel columns.
4. Enabling the queue in production.
5. Progress and ETA display.
6. Cost.

---

## 5. Cross-cutting tables

### DDL (in order)

| # | File (proposed) | Item | Change |
|---|---|---|---|
| 1 | `2026-10-xx-candidate-mrf-tags.sql` (+ rollback) | JD tagging - data model (N13) | New table `rpa_candidate_mrf_tags` |
| 2 | `2026-10-xx-mrf-jd-item-id.sql` (+ rollback) | JD attached to emails (N17) | `rpa_mrf.jd_item_id text` |
| 3 | `2026-10-xx-ceo-round-optional.sql` (+ rollback) | CEO round optional (N24) | `UPDATE rpa_pipeline_stages SET is_optional=true WHERE stage_key='ceo'` |
| 5 | `2026-10-xx-error-log.sql` (+ rollback) | Developer logging & error tracing (N42) | New table `rpa_error_log` |
| 4 | (only if JD - search speed (N10) measures a need) `2026-10-xx-cv-vectors-index.sql` | JD - search speed (N10) | pgvector index on `rpa_cv_vectors` |
| 6 | `2026-10-xx-cv-details-dates.sql` (+ rollback) | Missing-details completed (N44) | `rpa_cv.details_requested_at`, `details_completed_at` + partial index; backfill of the requested date |

### Settings keys

| Key | Item | Default |
|---|---|---|
| `company_profile_html` | JD attached to emails (N17) | empty (no section until set) |
| `interview_reminder_enabled` | Candidate phone & interview reminders (N22) | set to `true` in production |
| `mrf_approvers` (title added) | MRF approval alert (N16) | update the roster with titles |
| `job_heartbeat_<name>` (written by the system); env `LOG_LEVEL` | Developer logging & error tracing (N42) | `info` |

### Endpoints

| Method / path | Item |
|---|---|
| `POST /api/screening/keyword-search` (new fields: name, email, phone, matchMode, addedWithinDays) | Keyword - exact lookup through Keyword - screen changes (N02–N06), Recency filter (N38) |
| `GET /api/screening/roles?includeClosed=` (returns id, ref, created_at, isLatest) | JD date & version (N19), QA Automation tag (N20) |
| `GET /api/screening/role/:mrfId?taggedOnly=` | JD tagging - screening filter (N15) |
| `GET /api/candidates/public/locations`, `GET /api/candidates/public/recruiters` | Candidate form overhaul (N18) |
| `GET /api/dashboard/trends` | Dashboard fixes (N36) |
| `GET /api/pipeline/analytics/positions` (+ `/export`) | Analytics - Positions tab (N39) |
| `POST /api/errors`; `GET /api/admin/errors`; `GET /api/admin/logs?ref=`; `GET /api/health?deep=1` | Developer logging & error tracing (N42) |

### Emails affected

| Email | Change | Item |
|---|---|---|
| Shortlist | JD attachment; company block; phone-request link when missing | JD attached to emails (N17), Candidate phone & interview reminders (N22) |
| Stage outcome (approved → next) | JD attachment | JD attached to emails (N17) |
| MRF approval (per approver) | Wording | Approver email wording (N32) |
| Interview reminder | Enabled in production | Candidate phone & interview reminders (N22) |
| Job failure / crash alerts (developers) | New | Developer logging & error tracing (N42) |
| Candidate missing-details reminder | Stops once the candidate completes the form | Missing-details completed (N44) |

### New cron jobs

| Job | Item |
|---|---|
| Error-log retention sweep (daily, keeps 30 days) | Developer logging & error tracing (N42) |

---

## 6. Release plan

| Release | Contents | Steps |
|---|---|---|
| 1 (end of week 1) | Hot item: Missing-details completed (N44). Quick wins: Approver email wording (N32), Interview host visibility (N26, check only), MRF approval alert (N16), Skip guard (N33), Approve-without-score label (N25), Date Added column (N27), Dark mode on public forms (N31), QA Automation tag (N20), JD date & version (N19), Interviewer & interviewee (N23), Pipeline popup crash (N30), CEO round optional (N24); Housekeeping (N40) done by the admin | DDL #3 (CEO round optional), #6 (details dates, N44); approver roster titles (N16); tell RT that completed candidates no longer get missing-details reminders (N44) |
| 2 (end of week 2) | Developer logging & error tracing (N42), Labels & legends (N35), Scores in the pipeline drawer (N28), Date format (N34), Candidate data sync (N29) | DDL #5 (`rpa_error_log`); set the developer alert list; RT briefing on the new labels |
| 3 (end of week 3) | Candidate phone & interview reminders (N22), JD tagging - data model (N13), JD tagging - uploads (N14), Search Candidate to JD (N21), JD attached to emails (N17) | DDL #1 (tag table), #2 (JD item id); `interview_reminder_enabled=true`; set `company_profile_html` |
| 4 (end of week 4) | Candidate form overhaul (N18), Dashboard fixes (N36), Raw vs qualified, interim (N37), Analytics - Positions tab (N39) | "Definitions updated" note on the dashboard |
| 5 (after RT sign-off) | Filtering rework (N01–N12), Recency filter (N38), JD tagging - screening filter (N15); System documentation & development history (N43) published | `SCREENING_V2=true`; bump the screening cache version |

**Each release follows the same steps:**
1. `pg_dump` (`docs/deployment/PHASE3-PRODUCTION-DEPLOYMENT.md` Step 0).
2. DDL on staging, then production.
3. `prisma pull` / `generate`.
4. Deploy (`backend/deploy-staging.sh` for staging).
5. Run the integration files for the touched areas.
6. RT UAT on staging.
7. Production deploy.
8. Update the affected module page and the development history in `docs/system/` (System documentation & development history (N43)).

**Rollback:** the `.rollback.sql` file for each DDL; the `SCREENING_V2=false` flag for the screening change.

## 7. Open decisions register

| # | Decision | Item | Owner | Recommended default |
|---|---|---|---|---|
| 1 | Experience tolerance (±1 yr?) | JD - other criteria (N08) | RT | None (strict) |
| 2 | Ranking weights | JD - ranking (N09) | RT (in Before/after check (N11)) | 0.6 / 0.2 / 0.1 / 0.1 |
| 3 | Notify vendor on tagged upload | JD tagging - uploads (N14) | Harish | No |
| 4 | "Tagged only" default | JD tagging - screening filter (N15) | RT | Off |
| 5 | Company section text | JD attached to emails (N17) | RT | RT drafts, admin pastes |
| 6 | Qualification list | Candidate form overhaul (N18) | RT | From `matchesQualification` categories |
| 7 | Default country code | Candidate phone & interview reminders (N22) | Harish | +91 |
| 8 | Legacy score editing | Candidate data sync (N29) | Harish | Read-only |
| 9 | Final label wording | Labels & legends (N35) | RT | As listed in Labels & legends (N35) |
| 10 | Raw / qualified definition | Raw vs qualified (interim) (N37) | Chhaya | As in Raw vs qualified (interim) (N37) |
| 11 | HRD access (A: recruiter, B: upload-only, +6 h) | Housekeeping (N40) | Harish | A now |
| 12 | Developer alert recipients; error reference shown to HR; log retention | Developer logging & error tracing (N42) | Harish | Existing developer list; yes; 30 days |
| 13 | Documentation audience and reviewer | System documentation & development history (N43) | Harish | Developers only; Pankaj reviews |
| 14 | ATS-sent missing-details requests (`data_collection`) are never reminded | Missing-details completed (N44) | RT / Harish | Confirm; if unintended, add `data_collection` to the remindable types (1 h) |

## 8. ID index (ID → task name)

| ID | Task |
|---|---|
| N01 | Filter utility |
| N02 | Keyword - exact lookup |
| N03 | Keyword - strict filters |
| N04 | Keyword - skills matching |
| N05 | Keyword - score & summary |
| N06 | Keyword - screen changes |
| N07 | JD - skill gate |
| N08 | JD - other criteria |
| N09 | JD - ranking |
| N10 | JD - search speed |
| N11 | Before/after check |
| N12 | Rules document for RT |
| N13 | JD tagging - data model |
| N14 | JD tagging - uploads |
| N15 | JD tagging - screening filter |
| N16 | MRF approval alert |
| N17 | JD attached to emails |
| N18 | Candidate form overhaul |
| N19 | JD date & version |
| N20 | QA Automation tag |
| N21 | Search Candidate to JD |
| N22 | Candidate phone & interview reminders |
| N23 | Interviewer & interviewee |
| N24 | CEO round optional |
| N25 | Approve-without-score label |
| N26 | Interview host visibility |
| N27 | Date Added column |
| N28 | Scores in the pipeline drawer |
| N29 | Candidate data sync |
| N30 | Pipeline popup crash |
| N31 | Dark mode on public forms |
| N32 | Approver email wording |
| N33 | Skip guard |
| N34 | Date format |
| N35 | Labels & legends |
| N36 | Dashboard fixes |
| N37 | Raw vs qualified (interim) |
| N38 | Recency filter |
| N39 | Analytics - Positions tab |
| N40 | Housekeeping |
| N41 | Upload speed |
| N42 | Developer logging & error tracing |
| N43 | System documentation & development history |
| N44 | Missing-details completed: bell alert & dates |
