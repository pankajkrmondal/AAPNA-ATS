# 2026-11-13 · U04b Keyword search: real mention counts, and most mentions first

**Reported** (owner, 13 Nov, walkthrough comment under U04): with `SCREENING_V2` on, some candidates at the top of the keyword results showed "java ×0, python ×0", while candidates with "java ×6, python ×8" sat lower. Brief: [U04b](../Phase%204/uat-fixes/U04b-keyword-ranking-mentions.md). It is the strict search only.

**Cause**
- **The count source:** the ×N came only from the `resume_technical_terms` JSON. A skill found in the declared skills (`Top5KeySkills`) or the resume text, but missing from that JSON, showed ×0 even though the candidate matched.
- **The order:** it put the evidence-weighted score first, where a declared skill counts 1.0 and a resume keyword 0.85. Mentions only broke ties.

## Mention count (both tabs)
- **Where it comes from:** ×N is now the number of whole-word mentions in the resume text. The database counts them with the same whole-word rule (aliases included) that filtered the row, so the resume never leaves the database.
  - It is a new `<prefix><i>_n` column next to the three evidence flags.
  - It is computed only for rows that passed the filters.
- **When the resume text has no mention** (none stored), the technical-terms JSON count stands in.
- **The rule:** a skill found in the resume or its keywords never shows ×0.
- **The edges of the count:** the count leaves the separator after a mention for the next one, so "Java/Java EE" counts 2, not 1. A text has at least one counted mention exactly when the filter matches it.
- **Code:** `utils/screeningFilters.js` (`skillCountRegexSource`, `columnCountSql`, `skillColumnPredicates().resumeCount`) and `services/screeningV2.service.js` (`evidenceFlagSql`, `skillEvidence`).

## Keyword tab order
Within the Active / not-active groups (the "Active candidates first" switch stays):
1. the number of searched skills matched, more first
2. total mentions across the searched skills, more first
3. the score, then response speed (Active only), semantic distance, newest

It lives in `utils/keywordRanking.js` `compareKeywordResults`. A filter-only search (no skills) keeps its old order.

**Stars:** the stars and the Strong / Moderate / Weak chips still come from the score. So a 3★ card can now sit above a 4★ card. The chip counts are unchanged.

## JD tab
- **Its order is unchanged** (decided 13 Nov): it stays RT's `jdRankScore`. Every JD candidate has all the mandatory skills, so "matched skills first" would change nothing there.
- **Counts:** its mandatory and good-to-have chips now show the real ×N.
- **Ties:** its last score tiebreak (`evidence`) now sums real mentions, so candidates with equal scores may swap places.
- **Cache:** JD results are cached for up to 1 hour. Press Refresh to see the new counts at once after the deploy.

## Card meter
- The card's "n/m" meter now counts every matched skill, including a skill found only in the declared skills. Before, a JD candidate who passed every mandatory skill could show "2/3".
- That chip reads "listed" instead of ×N.
- The drawer is unchanged.

**CSV export:** it runs the same search functions, so its order matches the screen. It lists skill names only, with no counts.

## Tests
- Unit:
  - `screeningFilters.test.js` 66/66, with four new count tests
  - `keywordRanking.test.js` 6/6 (new)
- Count SQL run in Postgres on literal values: "Java/Java EE" 2, "JavaScript only" 0, ".NET Core, ASP.NET" 2, NULL 0.
- Frontend build OK.

No DDL, no flags.
