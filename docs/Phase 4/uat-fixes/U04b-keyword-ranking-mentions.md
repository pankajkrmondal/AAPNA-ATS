# U04b · Keyword search: real mention counts, and most mentions first
**Release 16 Nov (R16) · Medium · ~3–4 h · Depends on: U04 Handoff. Build before the R16 staging deploy.**

**Goal**
- **Reported** (owner, 13 Nov, walkthrough comment under U04): with SCREENING_V2 on, some candidates at the top show "java ×0, python ×0", while candidates with "java ×6, python ×8" sit lower.
- **Cause (verified in code):**
  1. **×N counts only the extracted keyword list.** It comes from the `resume_technical_terms` JSON only (`backend/src/services/screeningV2.service.js:250`, `:254-255`). A skill matched in `resume_full_text` or `Top5KeySkills` but missing from that JSON shows ×0, even though the candidate did match.
  2. **The order puts mentions last.** It is set at `screeningV2.service.js:470-476`:
     - activity first, when "Active candidates first" is on (the default)
     - then `avgScore`, where a skill in the skills section weighs 1.0, a keyword 0.85 and resume text 0.7 (`:231`, `:262`)
     - then response speed
     - then `evidence` (`declaredCount * 1e6 + totalFreq`, `:264`), so the mention count only breaks ties
- **Decided** (owner, 13 Nov):
  - ×N shows the **real number of mentions in the resume**, so a matched skill never shows ×0.
  - **Keyword tab order:** within the Active / not-active groups (the switch stays), sort by
    1. the number of searched skills matched, more first
    2. total mentions across the searched skills, more first
    3. then today's tiebreaks (score, response speed, distance, newest)
- **Done when:**
  - With "java, python" (All or Any), no matched candidate shows ×0 for a skill found in the resume text.
  - Within each activity group, a candidate with more matched skills, then more mentions, comes first.

## Changes
1. **Mention count in SQL**, so the resume never leaves the database (the file's own rule, `:233-238`, `:392-398`):
   - `backend/src/utils/screeningFilters.js:379-386` `skillColumnPredicates(term, alias)`: also return `resumeCount`, the whole-word mention count in `resume_full_text` with the same regex source (`phrasesRegexSource`, `:136`).
   - Use `(SELECT count(*)::int FROM regexp_matches(<col>, <src>, 'gi'))`. It works on any Postgres version; don't rely on `regexp_count`.
   - Wrap it in `CASE WHEN <resume predicate> THEN … ELSE 0 END`, so only matching rows pay for it. `columnMatchSql` (`:339-342`) shows the cheap-test-first pattern.
   - `screeningV2.service.js:276-288` `evidenceFlagSql`: add a fourth column per term, `<prefix><i>_n`. It must start with `ev_` so `toPublic` strips it.
   - These columns are computed in the `m` CTE, which runs only on rows that passed the filters (`:422-431`).
2. **`skillEvidence`** (`screeningV2.service.js:239-266`):
   - `count` = the `_n` value. When it is 0 or missing (no resume text) but the technical-terms JSON has a count, use that instead.
   - `totalFreq` is the sum of the counts.
   - Return `totalMentions` and keep `matchedCount`.
   - It is shared with the JD tab (`:913-914`), so the JD chips get real counts too. The JD tab's **order** (`:925`) does not change. Only its `evidence` tiebreak now sums real mentions, which reorders ties only. Note this in Handoff.
3. **Keyword order:**
   - Move the comparator at `:470-476` into an exported pure function, for example `compareKeywordResults(a, b, activeFirst)`.
   - The new order is activity (if on) → `matchedCount` desc → `totalMentions` desc → `avgScore` desc → response speed (if on) → distance → `createdAt` desc.
   - A filter-only search (no skills, `ev` null) keeps today's order.
   - Stars and the Strong / Moderate / Weak chips still come from the score (`keywordScore`, `:315-355`), so a 3★ card can now sit above a 4★ card. Leave the chip counts as they are, and list this in Handoff for the owner.
4. **Card wording** (`frontend/src/pages/CandidateScreening.jsx:203-215`): the tooltips already say "Mentioned in resume (×N)". Check they still read right, and change no logic.
5. **The CSV export** follows the same search path with SCREENING_V2 on (`backend/src/config/index.js:327-333`). Check its order matches the screen.
6. **Docs:** `docs/changelog/CHANGES-2026-11-13-U04b-keyword-ranking.md`, and a line in `frontend/UI-CHANGELOG.md` if any UI text changes.

No DDL, no flags.

## Tests (lean mode)
- **Unit, run here:**
  - `screeningFilters.test.js`: `resumeCount` is present and uses the same regex source as `resume`.
  - The new comparator: matched count beats mentions, mentions beat score, activity first when on.
  - Run those files only.
- `cd frontend && npm run build` if the frontend changed.
- **For the user** (in Handoff):
  - integration `node src/tests/run-block.mjs src/tests/integration/keywordFilters.test.js`
  - the full `npm run test:unit`
  - `e2e/u04-keyword-commas.spec.js`
  - a staging check: "java, python" with All and with Any; note the top 5 and their ×N

## Not in this chat
- **The walkthrough page** (U04) is updated by the main chat after this is built. Its comment thread stays open until then.
- **R16** gets the UAT check and a slip rule. Both are already added to `R16-release-16-nov.md`.

## Handoff
**Built 13 Nov.** Changelog: `docs/changelog/CHANGES-2026-11-13-U04b-keyword-ranking.md`.

- **The count** (`utils/screeningFilters.js`):
  - `skillColumnPredicates()` now also returns `resumeCount`, built by `columnCountSql` (a strpos prefilter, then `regexp_matches(…, 'gi')`).
  - It uses `skillCountRegexSource`, the filter regex with a **lookahead right edge**. The filter form consumes the separator, so "Java/Java EE" would count 1. This one counts 2. The match/no-match result is the same as the filter's.
  - Checked in Postgres on literal values.
- **The service** (`screeningV2.service.js`):
  - `evidenceFlagSql` adds `_n`.
  - `skillEvidence`:
    - `count` = the resume mentions, else the technical-terms JSON count.
    - It never shows ×0 when a skill is found in the keywords or the text.
    - It adds `totalMentions`.
    - `evidence` = declared × 1e6 + mentions.
- **Keyword order:** a new pure `utils/keywordRanking.js` `compareKeywordResults`. The old `rating.evidence` tiebreak is dropped from the keyword order, since mentions now come second.
- **JD tab (owner decided 13 Nov: counts only):** the order is unchanged. The chips get the real ×N, and only score ties can reorder, through `evidence`.
- **Beyond the brief:**
  - The card meter (`CandidateScreening.jsx` `JdSkillMatch`) now counts a declared-only (`listed_only`) skill too, which shows a "listed" chip. Before, a JD candidate with all the mandatory skills could show "2/3".
  - The R16 UAT line now says to press Refresh on the JD tab (1 h cache).
- **For the owner:**
  - The stars and the Strong / Moderate / Weak chips still come from the score, so a 3★ card can sit above a 4★ one.
  - Within the same matched count and mentions, the keyword tab no longer prefers declared skills over resume-only ones; the score still does.
- **CSV export:** it uses the same search functions, so its order matches the screen. It has no ×N column.
- **Tests run here:**
  - unit `screeningFilters` 66/66 and `keywordRanking` 6/6 (new)
  - the service module loads
  - frontend build OK
- **For the user:**
  - `node src/tests/run-block.mjs src/tests/integration/keywordFilters.test.js`
  - `npm run test:unit`
  - `e2e/u04-keyword-commas.spec.js`
  - Staging:
    - "java, python" with All and with Any: write down the top 5 and their ×N, and confirm there's no ×0.
    - One JD after Refresh: no ×0, and the meter is full.
    - Compare `t_sql` in the `[screening:v2] keyword` log line with a search before the deploy. There's one more resume-text scan per skill, on matching rows only.
- **Not done here:** the walkthrough page U04 update and resolving thread b2e52f3b (main chat).
