# RCA — Functional Screening (Zeko) shows the HR round's score for an interview that was never scheduled

**Date:** 2026-08-25
**Reported on:** `ats-staging.aapnainfotech.com/pipeline` → Functional Screening (Zeko) → PANKAJ MONDAL
**Journey:** `pipeline_id 768` · `cv_id 287` · `shortlist_id 998` · now at `zeko_fn`, `in_progress`
**Status:** ✅ **Fixed** — Option A approved and applied 2026-08-25. See §11 for what shipped and how it was verified.

---

## 1. Symptom

After the Evalground result imported and the Assessment round was approved, PANKAJ MONDAL moved to
**Functional Screening (Zeko)**. That round now shows:

- **Schedule Interview** — *Not started yet* · "Not yet assigned to a Zeko job"
- **Awaiting Results** — ✅ **Done** · **95 INTERVIEW**

No functional Zeko interview has been scheduled. The 95 is the **HR Screening (Zeko)** round's score.

The drawer is contradicting itself on screen: one line says no interview was ever booked, the line
directly below it says results are in. Those two lines read from **different sources** — and only one
of them is scoped to the round you are looking at.

---

## 2. TL;DR root cause

`rpa_cv."ZekoInterviewScore"` / `"ZekoCodingScore"` / `"ZekoCommunicationScore"` are **one set of
columns per CANDIDATE, not per ROUND**. Both Zeko rounds write to those same three columns.

Two separate code paths read them without scoping to a round:

1. **The drawer** falls back to them when the round-scoped lookup finds nothing.
2. **The board card** derives "Ready for decision" from them *directly* — with no round scoping at all.

So the HR round's 95 is displayed by the Functional round, which has no interview, no booking, and
no result of its own.

The codebase is already aware of this hazard — the fallback is explicitly labelled as one:

[pipeline.service.js:375-381](backend/src/services/pipeline.service.js#L375-L381)

```js
// Real Zeko scores + resume link (no mock) — one lookup when there's a cv_id.
// This is a fallback only: rpa_cv holds ONE set of Zeko score columns per
// CANDIDATE, not per round, so a candidate who has completed both Zeko
// rounds would show whichever round synced last here. The round-scoped
// rpa_zeko_interview_results lookup below overrides this with the correct
// per-round numbers whenever one exists.
let zekoScores = null;
```

The comment's final clause is the bug: **"whenever one exists"**. When one *doesn't* exist — which is
exactly the situation for a round that hasn't been scheduled yet — nothing overrides the fallback, and
the other round's number is displayed as if it belonged here.

---

## 3. Evidence — what is actually in the database

Read-only queries against staging:

**The journey**
```
id 768 · cv_id 287 · shortlist_id 998 · current_stage_key "zeko_fn" · in_progress
```

**Zeko bookings for this candidate** (`rpa_zeko_candidate_pipeline`) — exactly one, and it is the HR round:

| id | stage | status | external interview id | link_sent_at |
|---|---|---|---|---|
| 68 | **hr** | completed | `69c13f5958e23da6db09f270` | 25 Aug 03:46 |

**There is no `functional` row.** Correct — nothing was scheduled.

**Synced results** (`rpa_zeko_interview_results`) — the 95 belongs to the HR interview:

| id | pipeline_id (Zeko's interview id) | candidate_email | overall | technical | communication |
|---|---|---|---|---|---|
| 15 | `69c13f5958e23da6db09f270` ← **HR** | aiuserpankajmondal@gmail.com | **95** | null | null |

**The candidate-level columns** (`rpa_cv` id 287):

```
ZekoInterviewScore = "95"   ZekoCodingScore = null   ZekoCommunicationScore = null
```

**Stage history for journey 768** confirms the candidate never sat a functional interview:

```
zeko_hr    entered     24 Aug 13:01
zeko_hr    outcome     "Zeko HR Screening Approved"   25 Aug 05:41
assessment entered     25 Aug 05:41
assessment note        (Evalground result imported)   25 Aug 05:48
assessment outcome     "Evalground Test Passed"        25 Aug 06:49
zeko_fn    entered                                     25 Aug 06:49
```

**A corroborating tell.** Only one chip renders — "95 INTERVIEW", no Coding, no Comms. That is because
HR screening deliberately stores `null` for technical/communication ([zeko.service.js:743-744](backend/src/services/zeko.service.js#L743-L744)):
HR screening is a conversation, not a coding exercise. A genuine *functional* score would normally
carry all three. A lone Interview chip on a functional round is itself a signal the number came from HR.

---

## 4. The two defective paths

### 4.1 The drawer — fallback survives because the override is gated

[pipeline.service.js:383-392](backend/src/services/pipeline.service.js#L383-L392) sets `zekoScores` from `rpa_cv`
unconditionally. The round-scoped correction that is supposed to replace it lives at
[lines 441-468](backend/src/services/pipeline.service.js#L441-L468) — but the whole block is wrapped in:

```js
if (zekoHrPipeline) {   // ← this round's own booking row
```

For `zeko_fn` the booking lookup ([line 418](backend/src/services/pipeline.service.js#L418)) correctly filters
`stage: 'functional'`, finds nothing, and returns `null`. The override never runs. `zekoScores` keeps
the HR value, and the frontend renders it because it gates purely on presence:

[PipelineDrawer.jsx:413-416](frontend/src/components/pipeline/PipelineDrawer.jsx#L413-L416)
```js
if (zekoScores) {
  s3 = { state: 'done', ...zekoScoreSegment(zekoScores), link: zekoReportLink };
}
```

while the line above it, `s2`, is driven by `zekoHrPipeline` and so correctly reads "Not yet assigned
to a Zeko job" ([line 408](frontend/src/components/pipeline/PipelineDrawer.jsx#L408)). Hence the
contradiction on screen.

**There are two ways to reach the leak, not one** — the override also fails to fire when a booking
*does* exist but its result row doesn't yet, because of the second guard at
[line 461](backend/src/services/pipeline.service.js#L461) (`if (zekoResult && …)`). So a functional
interview that has been booked and sent but not yet synced will *also* show the HR score. This matters
for choosing a fix (§7), and it is reachable today — staging currently holds one `functional` booking
in `sent` status.

### 4.2 The board card — no round scoping at all

The "Ready for decision" chip on the Functional column card comes from
[pipeline.service.js:193-206](backend/src/services/pipeline.service.js#L193-L206) and
[line 275](backend/src/services/pipeline.service.js#L275):

```js
const scored = await prisma.rpa_cv.findMany({
  where: { id: { in: zekoCvIds },
           OR: [{ ZekoInterviewScore: { not: null } }, …] },
});
…
const readyForDecision = onZekoStage && j.current_stage_status === 'in_progress'
  && zekoScoredCvIds.has(String(j.cv_id));
```

This never consults `rpa_zeko_candidate_pipeline` or `rpa_zeko_interview_results` at all — a candidate
with *any* Zeko score reads as "ready for decision" on *whichever* Zeko round they are standing on.

**Worth noting for the review:** the very next block in the same function
([lines 208-228](backend/src/services/pipeline.service.js#L208-L228)) gets this exactly right for the
`invited` flag, and says so in its comment:

> *Matched per ROUND ('hr' vs 'functional'): a candidate invited for HR screening must not read as
> already invited once they reach functional.*

Same file, same function, adjacent blocks — the discipline was applied to `invited` and not to the
score. This looks like an oversight, not a deliberate trade-off.

---

## 5. Why this is more than a wrong number

**The Schedule Interview button is hidden, so the round cannot be progressed.**

[PipelineDrawer.jsx:411](frontend/src/components/pipeline/PipelineDrawer.jsx#L411)
```js
showScheduleButton = isCurrent && !zekoScores && !outcomeEvent;
```

The rule is sound — don't offer scheduling once the interview is over. But `zekoScores` is truthy from
the *other* round, so the button is suppressed on a round whose interview has not even been booked.
This is why you could not schedule the functional interview: the UI concluded the round was already
finished. **This is a functional blocker, not a cosmetic one**, and it is the part that most needs fixing.

**A recruiter can approve a round the candidate never sat.** The Approve / Reject bar is live and the
round presents as decided-ready with a passing 95. Approving advances the candidate to Tech 1 on the
strength of a score from a different round.

The codebase already treats this exact hazard as serious elsewhere — the Evalground auto-advance path
carries a dedicated stage gate for it ([assessmentImport.service.js:558-582](backend/src/services/assessmentImport.service.js#L558-L582)):

> *setStageOutcome() resolves the outcome against the journey's CURRENT stage, not the stage the CSV
> is about. Without this check, re-importing an older Evalground export … would approve them out of
> TECH 1 and advance them to Tech 2 — a round they never sat.*

Same failure shape, different entry point.

**What does not leak:** the "View full report on Zeko" link. `zekoReportLink` is derived only inside the
`if (zekoHrPipeline)` block, so with no functional booking it stays `null`. The 2026-08-24 cross-candidate
report-link fix is not regressed here — only the score number crosses rounds.

---

## 6. Scope — who else is affected right now

Every in-progress Zeko journey on staging, checked against its own round's bookings:

| journey | stage | rpa_cv score | bookings this round | verdict |
|---|---|---|---|---|
| **768** | zeko_fn | **95** | **0** | ❌ **the reported bug** |
| 703 | zeko_hr | 94 | 1 | ✅ correct — score belongs to this round |
| 3 | zeko_fn | null | 1 | ✅ |
| 586, 702 | zeko_hr | null | 1 | ✅ |
| 4, 7, 11, 37, 587, 589, 590 | zeko_hr / zeko_fn | null | 0 | ✅ (no score to leak) |

**One journey is currently affected.** The exposure grows as more candidates reach the functional
round, since every candidate who passes HR screening arrives at `zeko_fn` carrying an HR score in
`rpa_cv`.

**Legacy exposure of removing the fallback: zero.** Every non-cancelled Zeko booking that has an
`rpa_cv` score also has a matching `rpa_zeko_interview_results` row — the query for
"bookings with an rpa_cv score but no results row" returned **0 rows**. So nothing is currently
depending on the fallback to display a legitimate score.

---

## 7. Fix options — your call

### Option A — Drop the `rpa_cv` fallback for Zeko rounds (recommended)

`zekoScores` comes **only** from the round-scoped `rpa_zeko_interview_results` lookup. The board's
`ready_for_decision` is derived the same way — through the round's own booking — mirroring the
`invited` block that already does this correctly.

- ✅ Correct by construction: `rpa_cv` carries **no round provenance**, so a value in it can never be
  safely attributed to a particular round. Any rule that tries is guessing.
- ✅ Fixes both reachable paths from §4.1, including the booked-but-not-yet-synced case.
- ✅ Unblocks the Schedule Interview button and stops the phantom "ready for decision".
- ✅ **Costs nothing on current data** — measured, 0 rows depend on the fallback (§6).
- ⚠️ If a future sync ever writes `rpa_cv` without writing `rpa_zeko_interview_results`, that score
  stops appearing anywhere. That is arguably correct — a score with no identifiable round is not
  displayable — but it is the one behaviour change worth naming.

### Option B — Keep the fallback, gate it on this round having a booking

Move the `rpa_cv` fallback inside `if (zekoHrPipeline)`.

- ✅ Smaller diff, preserves the fallback for legacy rows.
- ❌ **Insufficient.** Once the functional interview is booked but not yet synced, `zekoHrPipeline`
  exists and the fallback fires again — showing HR's score on the functional round a second time.
  This state exists on staging today (one `functional` booking in `sent`). I do not recommend it, but
  it is written up here so the trade-off is on the record rather than silently discarded.

### Option C — Option A, plus a narrow legacy allowance

Option A, but permit the `rpa_cv` fallback in the single unambiguous case: the candidate has exactly
**one** non-cancelled Zeko booking in total, so there is only one round the value could have come from.

- ✅ Safe by construction — ambiguity is impossible by definition of the condition.
- ⚠️ More logic to carry for a case that currently affects **0 rows**. Worth taking only if you expect
  older production data to differ from staging.

**My recommendation: Option A.** The measured legacy cost is zero, it is the only option that closes
both paths, and it removes a source of truth that cannot be made correct rather than adding rules
around it.

Should the round-scoped lookup find nothing, the drawer already has honest copy waiting for exactly
this state — [PipelineDrawer.jsx:419-420](frontend/src/components/pipeline/PipelineDrawer.jsx#L419-L420):
*"Awaiting Zeko to sync the score, once invited."*

---

## 8. What the Functional round should show after the fix

| Line | Now | After |
|---|---|---|
| Schedule Interview | Not started yet · "Not yet assigned to a Zeko job" | unchanged — plus the **Schedule Interview button returns** |
| Awaiting Results | ✅ Done · **95 INTERVIEW** | ⚪ Not started yet · "Awaiting Zeko to sync the score, once invited" |
| Board card chip | "Ready for decision" | "In progress" |

Then scheduling a functional Zeko interview creates its own `rpa_zeko_candidate_pipeline` row with
`stage: 'functional'`, and its score syncs into `rpa_zeko_interview_results` under that round's own
external interview id — displayed only on this round, which is the behaviour you described expecting.

---

## 9. Data repair

None needed. Nothing is mis-stored — every row in the database is correct and correctly attributed.
This is purely a **read/display** attribution defect. The `rpa_cv` value of 95 is legitimate as a
candidate-level "latest Zeko score"; it is only wrong to render it as *this round's* result.

---

## 10. Summary

| | |
|---|---|
| **Root cause** | `rpa_cv`'s three Zeko score columns are per-candidate, not per-round. The drawer falls back to them when a round has no synced result of its own, and the board card reads them with no round scoping whatsoever. |
| **Why the drawer contradicts itself** | "Schedule Interview" is round-scoped (correct); "Awaiting Results" falls back to the candidate-level value (wrong). |
| **Worst consequence** | The Schedule Interview button is hidden — the functional round cannot be progressed at all — and Approve is live on a score from another round. |
| **Blast radius** | 1 journey today (768); grows with every candidate that passes HR screening. |
| **Recommended fix** | Option A — trust only round-scoped `rpa_zeko_interview_results`, in both the drawer and the board. Measured legacy cost: zero rows. |
| **Data repair** | None. Display-only defect. |

---

## 11. What shipped — Option A

Approved and applied 2026-08-25. Backend only; **no frontend change was required**.

### 11.1 Files changed

| File | Change |
|---|---|
| [pipeline.service.js](backend/src/services/pipeline.service.js) · `getPipelineDetail` | The `rpa_cv` read now selects **only** `cvFileUrl`. The round-scoped `rpa_zeko_interview_results` lookup is the sole source of `zekoScores`. |
| [pipeline.service.js](backend/src/services/pipeline.service.js) · `listPipeline` | `ready_for_decision` is now keyed `${shortlist_id}:${round}` and resolved via the round's own booking → external interview id → the candidate's own row in that interview's roster. |
| [zekoRoundScoreScoping.test.js](backend/src/tests/unit/zekoRoundScoreScoping.test.js) | **New** — 8 unit tests pinning the round-scoping rule. |

### 11.2 Decisions worth reviewing

- **The two board flags now share one query.** `invited` and `ready_for_decision` previously ran
  separate reads of `rpa_zeko_candidate_pipeline`; they now derive from a single fetch (the
  `link_sent_at` filter moved from SQL into the `invited` set-build). One read means they can never
  disagree about which round a card is on — which is precisely the class of bug being fixed.
- **Email matching, not just the interview id.** One Zeko interview id is shared by every candidate
  booked against that job, so the board matches the candidate's own address into the roster — the same
  two-step the drawer already used after the 2026-08-24 cross-candidate report-link fix. Using the id
  alone would have traded this bug for that one.
- **No frontend change.** `PipelineDrawer.jsx` gates on `zekoScores` presence and already had the right
  copy for the empty state ([lines 419-420](frontend/src/components/pipeline/PipelineDrawer.jsx#L419-L420)):
  *"Awaiting Zeko to sync the score, once invited."* It was simply never reachable before.
- **§7's Option B is now pinned by a test** ("a booked-but-unsynced functional round still shows no
  score"), so the insufficient fix cannot be reintroduced by a later refactor.

### 11.3 Verification

By calling the **real service functions** against the staging database (reads only):

| Check | Before | After |
|---|---|---|
| Drawer · journey 768 (`zeko_fn`, no functional booking) — `zekoScores` | `{ZekoInterviewScore: 95}` | **`null`** ✅ |
| Drawer · journey 768 — `cvFileUrl` | present | **present** (unaffected) ✅ |
| Drawer · journey 703 (`zeko_hr`, own booking + result) — `zekoScores` | `{…: 94}` | **`{…: 94}`** unchanged ✅ |
| Board · journey 768 — `ready_for_decision` | `true` | **`false`** ✅ |
| Board · journey 703 — `ready_for_decision` | `true` | **`true`** unchanged ✅ |
| Board · all 13 Zeko cards audited | — | **768 is the only value that changed** ✅ |
| Backend unit suite | — | **72/72 pass** (8 new) ✅ |
| `vite build` | — | clean ✅ |

### 11.4 What you should now see

The Functional Screening round for PANKAJ MONDAL reads **"Awaiting Results · Not started yet ·
Awaiting Zeko to sync the score, once invited"**, the board card reads **"In progress"** instead of
"Ready for decision", and — the point of the exercise — **the Schedule Interview button is back**, so
the functional Zeko interview can be booked. Its score will then sync under that round's own external
interview id and appear only on that round.
