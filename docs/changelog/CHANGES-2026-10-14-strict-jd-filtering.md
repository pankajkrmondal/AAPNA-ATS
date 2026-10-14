# Strict JD filtering (Phase 3 "Do Now" N07–N10) — behind `SCREENING_V2`

**Date:** 14 Oct 2026 · **Status:** Stage 2 of section A (JD path). The before/after check (N11) and
the RT rules document (N12) follow. **Not live anywhere until `SCREENING_V2=true` is set**; production
stays off until RT signs off on the N11 comparison.

Plan: [PLAN-Phase3-Now.md §4.A](../Phase%203%20Enhancements%20or%20Feedback/PLAN-Phase3-Now.md).
Stage 1 (keyword path): [CHANGES-2026-10-13-strict-keyword-filtering.md](./CHANGES-2026-10-13-strict-keyword-filtering.md).

## Why

RT (29 Sep, §5) on JD filtering:

- A profile with no mandatory skill could still rate "strong": skills were one of eight averaged scores, and "and" in the MRF text counted as a skill.
- Freshers passed with 8/10: experience was only a maximum, and an empty value passed.
- The budget was looked up by role name, so it could belong to another requisition.
- "Any" qualification mapped to BE/BTech, and "ANY" scored 0.
- An AI score written for one role was reused for another.
- Matching took too long: every search ranked ~99k candidates with full resume text and sent them all through Cohere.

## The rule (decided 29 Sep and 14 Oct)

A candidate is shown only if they pass **every** gate. An empty value for a gate the MRF applies excludes the candidate.

| Gate | Rule |
|---|---|
| **Mandatory skills** | ALL of them, whole words with aliases, found in declared skills, extracted technical terms or resume text. |
| **Education** | From the MRF's "Desired Qualification"; "Any" means any stream. `BE/BTech, MCA, Any`: BE/BTech or MCA. `PG, Any`: any PG degree. `Graduate`: any degree. `Other` / blank: not checked. |
| **Budget** | Expected CTC ≤ the budget on the MRF request (`rpa_mrf_jd_send`), found by `mrf_id`, else by the old role-name + submitter match. No budget: not checked, and the screen says so. |
| **Experience** | Within `parsed_jd_json` min–max; otherwise the MRF's total years as a minimum with no ceiling. No tolerance. |

Who passes does not depend on the order of the gates. RT reads them skills first. The database checks
education, budget and experience first (plain columns) and searches resume text only for the candidates
left. That gives the same result about 3× faster on 100k resumes (see Performance).

The mandatory-skills text is cleaned before it is enforced:
- lead-ins are stripped ("Strong knowledge of Java" → Java);
- "and" / "&" split two required skills;
- asides in brackets are dropped;
- `CI/CD`, `PL/SQL`, `TCP/IP`, `UI/UX` stay whole.

Some phrases are not enforced: soft skills, years of experience, "X or Y" alternatives and sentences longer than four words. They are returned as `ignoredSkills`, not shown on screen.

An MRF with no checkable mandatory skill shows **no candidates** and asks RT to edit the MRF. The
alternative, everyone in the experience band, is not a match.

**Ranking (passers only; never hides anyone):**
`score = 10 × (0.6·coverage + 0.2·experience fit + 0.1·CTC headroom + 0.1·notice)`
- **Coverage:** a declared skill counts 1; a skill found only in resume keywords or text counts 0.7.
- **Experience fit:** 1 at the middle of the band, 0.5 at the edges. An open band eases off after min + 2 years.
- **CTC headroom:** the share of the budget left; neutral when there is no budget.
- **Notice:** the existing availability steps.
- **Tie-breaks:** declared-skill evidence, then semantic distance, then newest.

The weights live in `JD_RANK_WEIGHTS` and are to be finalised with RT in N11.

**AI:** insights for the top 10 only, cached per MRF in Redis (`insight:mrf:<id>:cv:<id>`, 7 days). They are never written to the shared `ai_profile_insights` column. AI has no say in who is shown or the score. A failure shows "AI insights unavailable".

## What changed

### Backend

- **`backend/src/utils/jdScreeningRules.js` (new).** Pure rule module:
  - `resolveMandatoryText`, `parseMandatorySkills`
  - `experienceBand`, `normaliseBudget`
  - `mapQualification`, `jdEducationPass` and its SQL twin `educationGateSql`
  - `jdRankScore`, `JD_RANK_WEIGHTS`
- **`backend/src/services/screeningV2.service.js`.** New `searchRoleCandidatesV2(mrfId, force)`:
  - **Query 1:** the cheap gates' funnel counts.
  - **Query 2:** the candidates passing those gates, with one true/false per mandatory skill. This is the only query that reads resume text.
  - **Query 3:** cards for the matches only, by primary key, with per-skill evidence and semantic distance.
  - No `v.text`, no Cohere, one count query. `t_embed / t_sql / t_ai / t_total` are logged and returned.
  - Cache key `screening:role:v2:<mrfId>` (1 h).
  - `summary`: `removedBy` (adds up to the total), `passedOtherGates`, `passedSkillGate`, `summaryDetail` and `mandatorySkills[].missingOnlyThis`. The last is the number of otherwise-qualified candidates missing only that skill; it is kept for N11 / N12 and not shown on screen.
  - **Small refactor shared with the keyword path:** `provenanceJoins(mrfId?)` (JD stamps are scoped to the MRF, as before) and `evidenceFlagSql`.
- **`backend/src/controllers/screening.controller.js`, `backend/src/exports/screening.export.js`.** JD search and the JD CSV dispatch on `SCREENING_V2`. The old `searchRoleCandidates` is untouched.
- **Cache clears.**
  - `services/mrfClosure.service.js`: the v2 key is deleted next to each of the 4 existing deletes.
  - `controllers/mrf.controller.js`:
    - PATCH `/main/:id` (skills, experience…) clears both role keys and this MRF's insights.
    - PATCH `/:id` (the request's budget) clears the linked MRF's role keys.
  - Shortlist and reject already clear `screening:role:*`.

### Frontend (`CandidateScreening.jsx`): see `frontend/UI-CHANGELOG.md`

The role card shows what the gates enforce, and the summary line explains the count. Candidate cards are unchanged.

## Performance (local, 100k synthetic resumes of ~2.7 KB, Windows; timings vary ±50%)

Median of 3 runs, three mandatory skills:

| Approach | Java, Spring Boot, SQL | Spring Boot, Kafka, Python |
|---|---|---|
| Skills first over the whole DB | 0.83 s | 1.04 s |
| **Cheap gates first, then skills (built)** | 0.36 s | 0.34 s |
| … plus the "missing only one skill" counts (built) | 0.88 s | 1.01 s |
| Whole-DB per-skill counts (dropped) | about +5 s | |

A full JD search with 100k rows in the database took 1.0–1.5 s end to end. Real resumes are longer and
staging hardware differs, so measure `t_sql` on staging (N11). A trigram index (`pg_trgm`) is the next
step only if `t_sql` stays above 2 s. No vector index is needed: distance is computed only for the matches.

## Tests

- **Unit:** `backend/src/tests/unit/jdScreeningRules.test.js`, 45 tests (484/484 across all unit tests). Covers MRF-text parsing, the band, budget, qualification mapping, the education gate and the ranking.
- **Integration:** `backend/src/tests/integration/jdGates.test.js`, 12 tests (local DB). It checks that these are excluded:
  - a candidate missing one mandatory skill ("Kafkaesque" is not Kafka);
  - candidates outside the band (a fresher, a 9-year senior);
  - over-budget candidates;
  - blank experience or CTC;
  - a wrong or missing degree.

  It also checks:
  - no budget and "Other" qualification mean those gates are not checked;
  - an MRF without skills is blocked;
  - `removedBy` adds up;
  - the education SQL and JS agree;
  - a declared skill ranks above a resume-only one;
  - an unknown MRF returns 404.
- **E2E:** `frontend/e2e/jd-screening.spec.js` (`E2E_MRF_IDS=…`). For each MRF it checks:
  - the role card;
  - the summary line;
  - every result passes every gate;
  - the score order;
  - that the CSV matches.

  Local run: 4 passed, 2 skipped (no results to export). `keyword-screening.spec.js` still 8 passed, 2 skipped. `parseCsv` moved to `e2e/helpers/screening.js`.
