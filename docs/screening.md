# Screening Page — Resume Signals & Skill Matching

**Last updated:** 2026-06-30

This document covers the skill-signal features on the Screening page and their pagination.
All three pieces below are **display-only** — none change the deterministic scoring
(JD tab `starRating` P1–P8, keyword tab `relevanceScore`).

---

## 1. JD Skill Match (JD Filtering tab) — Implemented

### Problem
The page showed a generic **"Resume Signals"** strip per candidate — up to 15 technical terms the LLM
extracted from the resume, each with an occurrence count (`resume_technical_terms` → `{term, count}`).
These signals were **not connected to the Job Description**, so a recruiter couldn't see whether the JD's
required skills actually appear in a candidate's resume, and how strongly.

Driving scenarios:
1. *"JD mandatory skill = Marketing; how many times did the candidate mention marketing?"* — strength of a JD skill.
2. *"Python is in their declared skills but not in the resume"* and the inverse (mentioned in the resume but
   **not** listed in the declared skills section) — the **"listed vs. evidenced" gap**.

### What it does
Cross-references each JD skill (mandatory + good-to-have) against two existing DB columns —
no re-parsing, no schema change:
- `resume_technical_terms` — the resume signals (term + count)
- `Top5KeySkills` — the candidate's declared skills section

Each skill is classified into a **status**:

| Status | Meaning | UI |
|---|---|---|
| `evidenced` | In resume signals **and** declared skills | Green tag, `×count` |
| `signals_only` | In resume signals but **NOT** in declared skills (recruiter's key case) | Blue tag, `×count` + explicit note |
| `listed_only` | Declared but not surfaced as a resume signal | Amber tag, "listed" |
| `missing` | In neither | Grey tag, "missing" |

Card and drawer show an explicit line for the key case:
> ⓘ **Found in resume but not in declared skills:** Python (×4), …

### Backend — [screening.service.js](../backend/src/services/screening.service.js)
Helpers added after `scoreJDMatch`:
- `splitSkillPhrases(skillsStr)` — splits on `,`/`;`/newline/`/` while keeping multi-word phrases ("Machine Learning") intact.
- `parseDeclaredSkills(top5)` — parses `Top5KeySkills` as JS array, Postgres `{..}` literal, or comma string.
- `parseTechnicalTerms(raw)` — normalizes `resume_technical_terms` to `[{term, count}]`.
- `skillMatchesTerm(a, b)` — bidirectional `includes` fuzzy match (parity with the P6 grounding block).
- **`buildJdSkillSignals(candidate, mandatorySkills, goodToHaveSkills)`** → `{ mandatory: [...], goodToHave: [...] }`,
  each entry `{ skill, count, inSignals, inSkillsSection, status }`.

Attached per candidate in `searchRoleCandidates`:
`jdSkillSignals: buildJdSkillSignals(c, mandatorySkills, goodToHaveSkills)`.
`mandatorySkills`/`goodToHaveSkills` already resolve "Same as JD" from `parsed_jd_json` upstream.

> **Cache note:** results are Redis-cached under `screening:role:${mrfId}`; the field is computed before
> caching, so already-cached roles won't show it until the key expires/refreshes.

### Frontend — [CandidateScreening.jsx](../frontend/src/pages/CandidateScreening.jsx)
- `JD_SKILL_STATUS` map — color/background/border + `explain(skill)` tooltip per status.
- **`<JdSkillMatch signals variant label />`** has two presentations:
  - `variant="card"` (card) — compact **match meter + present-only chips** (calm, premium); no "missing" spam.
  - `variant="full"` (drawer, default) — the complete present **and** missing breakdown with tooltips + the
    explicit "found in resume but not in declared skills" note.
- The generic "Resume Signals" strip remains as a fallback when `jdSkillSignals` is absent (filter-only search).
- Styling uses the scoped `.cand-*` / `.skill-chip` / `.match-meter` classes in
  [theme/index.css](../frontend/src/theme/index.css) (see the 2026-06-30 UI refresh in
  [CHANGELOG.md](./CHANGELOG.md)).

### Known trade-off (accepted)
Matching reuses the pre-extracted `resume_technical_terms` (max ~15, biased toward technical tools) rather
than re-scanning `resume_full_text`. A JD skill the extractor didn't capture (e.g. "Marketing" on a
non-technical JD) won't have a count — it falls back to the declared-skills check or shows "missing". If too
limiting, the follow-up is to count JD skills directly against `resume_full_text` (the word-boundary counter
already exists in [hrUpload.service.js](../backend/src/services/hrUpload.service.js#L1181)).

---

## 2. Searched-skill signals (Keyword Filtering tab) — Implemented

### What it does
Applies the same cross-referencing to the **Keyword Filtering** tab: the searched term(s) are matched against
the candidate's declared skills + resume signals and shown with the same status tags. Display-only.

### Backend — [searchKeywordCandidates](../backend/src/services/screening.service.js#L1040)
In the final `scoredCandidates.map` return, when a searched term is present, attach:
```js
const searchedSkillsStr = [fKeyword, fDesignation].filter(Boolean).join(', ');
jdSkillSignals: buildJdSkillSignals(c, searchedSkillsStr, '')  // omitted entirely for filter-only searches
```
Reuses the same `buildJdSkillSignals` helper from feature 1.

### Frontend — [CandidateScreening.jsx](../frontend/src/pages/CandidateScreening.jsx)
- `<JdSkillMatch>` gained a `label` prop (default `"Mandatory JD Skills"`).
- In keyword mode (`activeTab === 'keyword'`), the card/drawer pass `label="Searched Skills"` and the drawer
  section title reads "Searched Skill Match".
- Pure filter-only searches (no keyword) → no `jdSkillSignals`, so the generic Resume Signals strip still shows.

---

## 3. Pagination (both tabs) — Implemented

### Approach: client-side
Both endpoints return a **bounded** set (JD: post-filter top set; keyword: vector `LIMIT 50`, pure-filter
`take: 200`), so client-side paging is lowest-risk — no endpoint changes, no Redis cache-key impact.

### Frontend — [CandidateScreening.jsx](../frontend/src/pages/CandidateScreening.jsx)
- State: `currentPage` (default 1), `pageSize` (default 10).
- `setCurrentPage(1)` added at every list-reset point (JD search, keyword search, clear, tab switch).
- The card list maps `candidates.slice((currentPage-1)*pageSize, currentPage*pageSize)`.
- AntD `<Pagination>` below the list (shown when `candidates.length > pageSize`): `showSizeChanger`,
  `pageSizeOptions ['10','20','50']`, size change resets to page 1.
- **Select-All / shortlisting** still operate on the full result set (count label shows `Select All (N)`).

### Defer (not done)
Server-side pagination (`page`/`pageSize` through routes → controller → service returning
`{candidates,total,page,pageSize}` + cache-key change). Only needed if result caps must grow beyond current limits.

---

## 4. App-load preloading + Refresh — Implemented

### What it does
- The **JD roles** dropdown is preloaded **when the app loads** (after login) so it's warm before the user
  opens `/filtering`.
- Per-role **candidate results are cached for the session** (React Query), so navigating away and back keeps
  the selected role and its candidates without a reload.
- A **Refresh** button next to the role selector force-reloads the roles list and the current role's
  candidates (bypassing the backend Redis cache). The Keyword tab's Refresh re-runs the active search.

### Frontend
- New hooks [useScreeningData.js](../frontend/src/hooks/useScreeningData.js): `useApprovedRoles()`
  (`['screening','roles']`) and `useRoleCandidates(roleId, enabled)` (`['screening','roleCandidates', roleId]`),
  both `staleTime: Infinity` (no auto-refetch; reloads are explicit).
- App-load prefetch in `AppShell` ([App.jsx](../frontend/src/App.jsx)): `queryClient.prefetchQuery` for roles
  once authenticated, **gated** on the same access rule as the route (admins bypass; others need the
  `candidate_screening` module) to avoid wasted calls.
- [CandidateScreening.jsx](../frontend/src/pages/CandidateScreening.jsx): roles + candidates sourced from the
  hooks; a sync effect feeds the existing render state (candidates/summary/roleDetails + pagination); `selectedRoleId`
  and `activeTab` persisted in `localStorage`; the cosmetic "pre-loading" progress bar was removed.
- Refresh writes a cache-bypassed (`force`) result via `queryClient.setQueryData`; the shortlist auto-refresh
  uses the same force-reload helper.

### Backend
- [searchRoleCandidates](../backend/src/services/screening.service.js) takes a `force` flag that **skips the
  Redis read** (still recomputes + overwrites cache). Threaded via the controller (`?force=1`) and the
  frontend service `searchRoleCandidates(mrfId, { force })`. Default false → existing cached fast-path unchanged.

---

## Verification
1. **JD tab:** pick a role with known `mandatory_skills`; each card shows the JD Skill Match strip; a candidate
   with a JD skill in `resume_technical_terms` but not in `Top5KeySkills` shows the blue `signals_only` note;
   star ratings/ordering unchanged.
2. **Keyword tab:** search "Python" → each card shows a "Searched Skills" strip with status + count; pure filter
   search still shows the generic Resume Signals strip.
3. **Pagination:** a search returning > pageSize candidates shows the pager on each tab; navigation works; size
   change and new search/tab switch reset to page 1; Select-All + shortlist still cover the full set.
4. **Backend sanity:** `node --check screening.service.js` passes; `relevanceScore`/ordering unchanged.
