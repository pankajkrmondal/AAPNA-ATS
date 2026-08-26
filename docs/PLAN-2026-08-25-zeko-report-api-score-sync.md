# PLAN — Zeko score sync: switch to the per-candidate report API

**Date:** 2026-08-25
**Scope:** `backend/src/services/zeko.service.js` (the `ZEKO_RESULTS_CRON` fetch path)
**Status:** ✅ **Implemented 2026-08-25.** See §9 for what shipped and how it was verified.
**Related:** [RCA-2026-08-25-zeko-functional-round-shows-hr-score.md](./RCA-2026-08-25-zeko-functional-round-shows-hr-score.md)
(that RCA fixed the *read* side — round scoping; this plan fixes the *write* side — where the
number comes from)

---

## 1. Context

Two Zeko score defects were fixed earlier on 2026-08-25:

1. **Cross-candidate leak** — one interview id is shared by every candidate on a job; the lookup
   now matches on the candidate's own email.
2. **HR round always `0`** — switched from `GET /interview/<id>/results` to
   `POST /dashboard/api/v2/pipeline/interview-responses`, reading `fitPercentage`.

**The Functional (Zeko) round is still wrong.** `interview-responses` returns
`interviewScore: 0` for functional interviews too — the same defect as HR, in a different field.

Verified on staging, job `69df92eff96fd5bee20f8fdc`, four *completed* candidates:

| Candidate | `interview-responses` | report API |
|---|---|---|
| aiuserpankajmondal@gmail.com | `interviewScore: 0` | **codingScore 1** |
| vtanguturi@aapnainfotech.com | `interviewScore: 0` | **codingScore 61** |
| rahulsangwan.er@gmail.com | `interviewScore: 0` | **codingScore 56** |
| skurup@aapnainfotech.com | `interviewScore: 0` | **codingScore 65** |

`interview-responses` is a **list/summary** endpoint whose score fields are unreliable per round
type. The per-candidate **report API is the only source carrying the real score for every round
type** — it is the API Zeko's own report page calls.

It also solves two structural problems:

- **Tab coverage.** Jobs differ: some expose `Partially Completed / Completed / Meets Criteria`,
  others only `Partially Completed / Completed`. On job `69df92eff96fd5bee20f8fdc` the
  **Completed tab reads 0 while Meets Criteria reads 4** — so any logic keyed to "completed"
  silently misses genuinely scored candidates. The report API is keyed on the candidate, not a
  tab, so tab layout stops mattering.
- **Round-type coverage.** Three round types each carry the score in a different field.

---

## 2. The API

```
GET https://api.zeko.ai/mygurukul/ait/interview-report?candidateId=<id>&jobId=<id>
Cookie: authcookie=…
```

**Auth already works** — the same OTP cookie as the job-catalog sync, via the existing
`getDashboardCookieHeader()`. Verified HTTP 200 on all three round types. No new credentials, no
config change.

- `jobId` = our stored `rpa_zeko_candidate_pipeline.zeko_job_id`
- `candidateId` = from the enumeration call (§4.3)

### 2.1 Score fields — verified on staging

| Round type | JSON path | Observed |
|---|---|---|
| HR screening | `data.data.hr_screening_evaluation.fit_percentage` | 95 |
| Coding / functional | `data.data.coding_evaluation.codingScore` | 1, 61, 56, 65 |
| Panel / competency | `data.data.totalScore` | 79 |

Exactly one is meaningful per round type; the others are absent, `0`, or a duplicate:

| Round | `fit_percentage` | `codingScore` | `totalScore` |
|---|---|---|---|
| HR screening | **95** | absent | `0` ← junk |
| Coding | absent | **61** | `61` ← duplicate of coding |
| Panel | absent | absent | **79** |

### 2.2 ⚠️ Two traps

1. **`data.newEvaluation.overallScore` is a different number.** For Shabahat Azki it is **49**
   while the UI gauge shows **79** (`data.data.totalScore`). Zeko's own UI ignores
   `newEvaluation`. Reading it would put 49 in the ATS against 79 in Zeko — a silent mismatch of
   exactly the kind this work exists to eliminate. **Pin `data.data.totalScore` explicitly.**
2. **`aitScore` mirrors `totalScore`** (79/79) on panel rounds but is `0` on HR and coding rounds.
   Not a safe general source.

### 2.3 Where the 79 comes from

`data.data.totalScore` is the rounded average of `data.data.parameter_evaluation[].percentage` —
the five "Interview Competencies" chips on the report page:

```
80, 80, 78, 78, 78  →  78.8  →  79
```

---

## 3. Score mapping — decided

Zeko's own UI labels these: `fit_percentage` = "Recruiter Screening",
`codingScore` = "Coding Score", `totalScore` = **"Interview Score"**. All three are *this round's
headline score*. None is a communication score — `softSkillsEvaluation` and
`language_proficiency` were both checked and are qualitative text only. **Zeko exposes no numeric
communication score anywhere in the report.**

```
headline = fit_percentage ?? codingScore ?? totalScore
```

| Target | Value |
|---|---|
| `ZekoInterviewScore` / `scores_overallscore` | `headline` |
| `ZekoCodingScore` / `scores_technicalscore` | `codingScore` (when present) |
| `ZekoCommunicationScore` / `scores_communicationscore` | `null` — no source exists |

Resulting rows:

| Round | Interview | Coding | Comms |
|---|---|---|---|
| HR screening | 95 | — | — |
| Coding | 61 | 61 | — |
| Panel | 79 | — | — |

> **Rejected:** mapping `totalScore → ZekoCommunicationScore` literally. It would write `0` on
> every HR round (re-introducing the meaningless-zero chip just removed) and a duplicate of the
> coding score on every coding round. It is only a standalone number on panel rounds.

---

## 4. Implementation

All in `backend/src/services/zeko.service.js`. **No schema change. No new cron.** The existing
5-minute `ZEKO_RESULTS_CRON` already calls `fetchInterviewResults()`.

### 4.1 `fetchCandidateReport(cookieHeader, candidateId, jobId)` — new

`GET`s the report URL and returns `body.data.data`, or `null` on **HTTP 410 Gone** — Zeko's clean
"no report exists" signal, returned for every `slotMissed` candidate tested. Non-410 errors throw,
so the caller's existing per-row try/catch logs them.

### 4.2 `pickZekoScore()` — rewrite

Replace the `fitPercentage` / `interviewScore` logic with the report-payload version:

```js
const fit    = report?.hr_screening_evaluation?.fit_percentage;
const coding = report?.coding_evaluation?.codingScore;
const total  = report?.totalScore;

// `??` not `||` so a genuine 0 survives. `total` is taken only via `|| null`
// because totalScore 0 means "not applicable" on HR and coding rounds.
const interview = fit ?? coding ?? (total || null);
return { interview, coding: coding ?? null, communication: null };
```

Keep the exported name so `zekoScoreField.test.js` stays meaningful; update its cases to the
report payload shape. Drop the `isHrScreening` argument — the report payload is self-describing,
so `isHRScreeningPresent` is no longer needed for score selection.

### 4.3 `fetchInterviewResults()` — two-step flow

Keep `fetchInterviewResponses()` **as the enumeration step only**. It is the sole source of
`candidateId`, and **its pagination (100/page) must be preserved** — Haris sits beyond page 1 of a
430-candidate interview. Then, per matched row:

1. `findResultForCandidate(data, row.candidate_email)` — unchanged, still email-matched
2. skip on `ZEKO_NO_RESULT_STATUSES` — cheap pre-filter, avoids a wasted call
3. `fetchCandidateReport(cookie, entry.candidateId, row.zeko_job_id)` → `null` ⇒ skip
4. `pickZekoScore(report)` → write both tables (§4.4)

### 4.4 Both write targets still matter

Since the RCA fix, the **drawer no longer reads `rpa_cv`** — `getPipelineDetail` selects only
`cvFileUrl` ([pipeline.service.js:419-427](backend/src/services/pipeline.service.js#L419-L427)).
The two tables now serve different surfaces, and the sync must keep writing **both**:

| Table | Feeds |
|---|---|
| `rpa_zeko_interview_results` | Pipeline drawer chips, board `ready_for_decision`, report link |
| `rpa_cv` (`Zeko*Score`) | Search Candidate, View Candidate, CSV export, analytics |

### 4.5 Must not regress

- Email-based candidate matching (`emailCandidates` / `emailMatchesSql`) — the cross-candidate
  leak fix
- Update-in-place on `rpa_zeko_interview_results` — no duplicate rows
- `zekoReportUrl()` deep link
- The `pipeline:updated` socket emit that live-refreshes an open drawer
- `repairZeroZekoScores()` — the tool for backfilling already-`completed` rounds
- Round scoping from the RCA — `rpa_cv` must **not** be reintroduced as a drawer fallback

### 4.6 Minor display follow-up

On coding rounds the drawer will render `61 INTERVIEW` and `61 CODING` — two identical chips.
Consider suppressing the Coding chip when it equals the Interview chip, in `zekoScoreSegment()`
([PipelineDrawer.jsx](frontend/src/components/pipeline/PipelineDrawer.jsx)). Cosmetic only;
confirm before doing it.

---

## 5. Cost

Measured on staging: **14 API calls, 23.5s** for 10 pending rows — one enumeration call per
*interview* (cached per run) plus one report call per *matched candidate*. Comfortably inside the
5-minute interval, and the overlap guard in `zekoScheduler.js` already skips a tick if a run
overruns.

*Optional later optimisation:* persist `candidateId` on `rpa_zeko_candidate_pipeline` to skip the
enumeration call on repeat runs. Not needed now.

---

## 6. Verification

1. `node --test src/tests/unit/zekoScoreField.test.js` — rewrite cases against the report payload;
   assert HR→`fit_percentage`, coding→`codingScore`, panel→`totalScore`, that a genuine `0`
   survives, and that **`newEvaluation.overallScore` is never read**.
2. Full pure-unit suite (currently **205 passing**) must stay green — including
   `zekoRoundScoreScoping.test.js` from the RCA.
3. Dry-run `fetchInterviewResults()` against staging. Expected, from the simulation already run:

   ```
   * row71 PANKAJ MONDAL   coding=1   => Interview=1  Coding=1     ← the reported bug
   * row68 PANKAJ MONDAL   fit=95     => Interview=95 Coding=null
   * row67 Panmon          fit=94     => Interview=94 Coding=null
     row35/34/28/27 SAHIL  HTTP 410 (slotMissed) => skipped, nothing written
   ```
4. `repairZeroZekoScores()` to backfill completed rounds; confirm PANKAJ MONDAL's functional
   round goes `0 → 1` in both `rpa_zeko_interview_results` and `rpa_cv`.
5. Browser — open the Functional (Zeko) round: real score, report link, no `0 INTERVIEW` chip.
6. Confirm a `slotMissed` candidate still reads "Awaiting Zeko to sync the score", never `0`.

---

## 7. Known, not caused by this change

**Haris M, Abhishek Singh and Dhanalakshmi return NO MATCH** against their booked interviews —
they were re-booked in the ATS but never added to that interview on Zeko's side. Correctly skipped
rather than mis-scored. Resolving it is a Zeko-side data task, not a code fix.

---

## 8. Summary

| | |
|---|---|
| **Problem** | `interview-responses` returns `interviewScore: 0` for functional rounds, just as it did for HR. Its score fields are unreliable per round type. |
| **Cause** | It is a list/summary endpoint. Only the per-candidate report API carries the real score for every round type. |
| **Fix** | Enumerate with `interview-responses` (for `candidateId`), then read the score from `GET /mygurukul/ait/interview-report`. |
| **Mapping** | `fit_percentage ?? codingScore ?? totalScore` → `ZekoInterviewScore`; `codingScore` → `ZekoCodingScore`; communication stays `null`. |
| **Blast radius** | Backend only, one file. No schema change, no new cron, no frontend change required. |
| **Cost** | 14 calls / 23.5s per run at current volume, inside the 5-minute cadence. |

---

## 9. What shipped

Implemented 2026-08-25. **Backend only — no schema change, no scheduler change, no frontend change.**

### 9.1 Files changed

| File | Change |
|---|---|
| `backend/src/services/zeko.service.js` | New `fetchCandidateReport()`; `pickZekoScore()` rewritten against the report payload and now returns `{interview, coding, communication}`; `fetchInterviewResults()` made two-step. |
| `backend/src/config/index.js` | New `reportApiBase` (`ZEKO_REPORT_API_BASE`, default `https://api.zeko.ai/mygurukul/ait`). |
| `backend/src/tests/unit/zekoScoreField.test.js` | Rewritten — 18 cases against the real report payloads. |

### 9.2 Verified against live staging

`repairZeroZekoScores()` — **3 processed, 7 skipped**:

| Row | Before | After |
|---|---|---|
| `rpa_zeko_interview_results` #16 — PANKAJ MONDAL **functional** | overall `0`, coding `null` | **overall `1`, coding `1`** ← the reported bug |
| `rpa_zeko_interview_results` #15 — PANKAJ MONDAL HR | overall `95` | `95` unchanged ✅ |
| `rpa_zeko_interview_results` #14 — Panmon HR | overall `94` | `94` unchanged ✅ |
| `rpa_cv` 287 | interview `0`, coding `null` | **interview `1`, coding `1`** |

Log evidence: `correcting aiuserpankajmondal@gmail.com on interview 69df92eff96fd5bee20f8fdb — 0 → 1`.

Other behaviour confirmed intact:

- Four `slotMissed` rows skipped with no write — never recorded as `0`
- Three permanently-unmatchable rows (Haris, Abhishek, Dhanalakshmi) skipped at `info` level with
  the "likely never added to this interview on Zeko" note
- `communication` written as `null` on every row
- The `pipeline:updated` socket emit fired (Redis `socket-bridge-pub` connected)
- **216/216 unit tests pass**, including the RCA's `zekoRoundScoreScoping.test.js`

### 9.3 Open follow-ups

1. **Duplicate chip (§4.6, not done).** The functional round now renders `Interview 1 · Coding 1`
   — two identical chips, because the coding score is also the round's headline score. Cosmetic;
   awaiting confirmation before suppressing the Coding chip when it equals Interview.
2. **`rpa_cv` still holds one score per CANDIDATE, not per round.** `rpa_cv` 287 now reads `1`
   (functional, synced last) rather than `95` (HR). Pre-existing and documented in the RCA — the
   drawer and board are unaffected because they read the round-scoped table — but Search
   Candidate, View Candidate and the CSV export show whichever round synced most recently. Fixing
   that properly needs per-round columns or a round-scoped read on those surfaces.
