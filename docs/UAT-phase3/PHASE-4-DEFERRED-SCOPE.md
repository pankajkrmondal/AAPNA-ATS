# Phase 4 — What We Are Moving to the Next Phase

**For:** Chhaya Verma, Naveen Satywali (HR / Talent Acquisition)
**From:** ATS Engineering — Pankaj Kumar Mondal, Harish Mopuri
**Date:** 11 September 2026
**Companion document:** [PHASE-3-CURRENT-SCOPE.md](PHASE-3-CURRENT-SCOPE.md) — what we are building right now

---

## 1. What this document is

Eight items from your UAT feedback are being moved to Phase 4. This document says
which ones, **why each one cannot be done safely in the current phase**, and what
we need from you before each can start.

To be clear about what "deferred" means here: **nothing is refused and nothing is
dropped.** These are the items that change how the system stores data, decides
outcomes, calculates scores, or sends automated email. Each one touches several
modules at once, and each one needs a full re-test before anyone can rely on it.

They are also, mostly, the items with the **highest value** — including the one
Chhaya marked mandatory. They are in Phase 4 because they deserve proper
implementation time, not because they are low priority.

---

## 2. Why these are separated out

Three things make an item a Phase 4 item:

**It changes the database structure.** New fields and new relationships between
records cannot be added and removed casually — existing data has to be migrated,
and every screen that reads that data has to be checked.

**It changes a decision the system makes automatically.** Scoring, stage
progression and automated emails are things the system does *without a human in
the loop*. If one of those goes wrong, the first sign is often a candidate
receiving a wrong email — by which time it cannot be taken back. We have had this
happen once already during development: a stage was skipped that nobody chose to
skip, and **two outcome emails went to the same candidate.** The guard that
prevents it is written into the code with a note explaining why. We are careful
here for a concrete reason.

**It moves a large number of existing tests.** The system has an automated test
suite covering the pipeline engine, MRF closure, shortlisting, scheduling,
scorecards and vendor isolation. Changes in this group each move several of those
suites at once, and re-establishing them is most of the work.

The CEO demo on **Tuesday 15 September** runs on staging, and staging is stable
today. None of the items below can be made safe in four working days, and putting
any of them in would risk the demo you have been preparing for.

Chhaya's guidance on the call is exactly the approach we are taking:

> *"In case if you want to make the things live, keep few things for Phase 4, keep
> some of the work around for few of the things, and make it live."*

---

## 3. Phase 4 at a glance

| # | Item | Your reference | Why deferred | Blocked on you? |
|---|---|---|---|---|
| 4.1 | **Tag uploads against a JD** | §1.5 — *mandatory* | New database relationship; changes the upload path | No — can start immediately |
| 4.2 | **Move / re-tag a candidate to another requisition** | §2.2 | Depends on 4.1; sends candidate email | **Yes** — decision needed |
| 4.3 | **Fix match quality and fresher ratings** | §1.7, §1.8 | Changes every screening result in the system | **Yes** — rules review needed |
| 4.4 | **Free-form stage movement (Trello-style)** | §3 | Rewrites the pipeline engine | **Yes** — written requirement needed |
| 4.5 | **Hold option at MRF approval + reminder** | §1.1 — *optional* | New approval status + scheduled reminder job | **Yes** — scope confirmation |
| 4.6 | **Make more interview stages skippable** | §3, part | Changes pipeline behaviour and emails | **Yes** — stage list needed |
| 4.7 | **Custom date range in Recruitment Analytics** | Naveen, on the call | Changes every analytics calculation | No |
| 4.8 | **Editable date/reference on JDs with no MRF** | §1.4, second half | Needs a new stored field | No |

---

## 4. The items in detail

### 4.1 · Tag uploads against a JD — **the most important item in Phase 4**

**What you asked for (§1.5):** profiles uploaded through Excel/bulk upload and
through individual upload should be automatically tagged against the selected JD,
and should be filterable by JD.

This is the only item Chhaya marked **mandatory**, and described as *"the major
major flaw that we have felt in the process."* We agree with that assessment.

**Where it came from.** Harish was open about this on the call: when the upload
feature was built, the requirement was duplicate detection — *"the focus was on
whether we are matching the duplicate or not, the focus was not on the JD
mapping."* Chhaya accepted that framing generously. So this is genuinely new scope
rather than something that was built wrong, and we are treating it as the anchor
item of Phase 4.

**Why it cannot be done now.** Today there is **no stored link at all** between an
uploaded candidate and a requisition. The only place a candidate meets an MRF is at
shortlisting, which happens much later in the process. Creating that link means a
new relationship in the database, a change to both upload paths, and a migration
decision about the roughly 99,000 candidates already loaded — do they stay untagged,
or do we attempt to tag them retrospectively? That is a question worth answering
carefully rather than quickly.

**Why it should go first in Phase 4.** Two other things you asked for depend on this
link existing:
- §1.6 — *"JD filtering should display profiles that match the selected JD"*
- §2.2 — moving candidates onto a JD (item 4.2 below)

Neither can be fully solved while the JD-to-candidate link is missing from the data.

**What you will get:**
- Bulk Excel upload takes a "tag to requisition" selection applied to the whole batch
- Individual upload takes the same selection
- Tagged candidates are retrievable by JD in Candidate Screening
- Uploading **without** a JD keeps working — general talent-pool intake is not
  being taken away
- A candidate can carry more than one JD tag over time, which item 4.2 needs
- Existing duplicate detection is preserved exactly as it is

**Blocked on you?** No. We can start as soon as Phase 3 ships.

---

### 4.2 · Move a candidate to a different JD or position

**What you asked for (§2.2):** the ability to move candidates from Search Candidate,
Keyword Search and the Pipeline onto a specific JD or position.

**What already works, so you know the starting point.** Harish clarified on the call
that bulk tagging of *untagged* candidates **already works today**: search a role in
keyword filtering, get 400 profiles back, and map them all in one action — the
outreach emails go out. Chhaya's scenario of *"400 profiles are already in the
database, we want all those 400 to come to the mainstream of this JD"* is therefore
largely supported already.

The genuine gap, in Harish's words: **"But once it is tagged, it is not there."**
A candidate already attached to one requisition cannot be moved to another. That is
what Phase 4 builds.

**On Search Candidate specifically.** Harish explained that this page is deliberately
read-only — *"the idea is to restrict this page to just see the candidate details"* —
and Naveen accepted that on the call: *"that's okay, that idea works for us."* His
condition was that the capability must exist *somewhere* reachable, which we agree
with. So we will build it into **Keyword filtering and the Pipeline**, which covers
both scenarios you described, and treat Search Candidate as optional.

**Why it cannot be done now.** It depends on the data link from 4.1, and it **sends
email to candidates**. A bulk move that misfires does not just show wrong data on a
screen — it contacts several hundred people about a role. That needs a full test
cycle, not a rushed one.

**What we need from you first — this changes what we build:**

When a candidate who is already at, say, final round for QA Automation is moved to a
new contract role, where do they land?

| Option | What happens | Trade-off |
|---|---|---|
| **A — Keep their stage** | A final-round candidate arrives at final round on the new role | Fastest for the recruiter, but the new role's earlier rounds were never actually conducted for them |
| **B — Restart at shortlisted** | Candidate re-enters at the beginning for the new role | Clean and fully auditable, but discards the interview history you wanted to reuse |
| **C — Recruiter chooses the landing stage** | The person doing the move decides each time | Most flexible, but needs the permission rules from item 4.4 |

On the call Harish read the scenario back and his description implied **Option A**,
and it was not contradicted — but it was not explicitly confirmed either. Because
the three options produce visibly different systems, we would like your answer in
writing before we build.

We also assume the **bulk** case always starts fresh at outreach, since those
candidates were never in a pipeline for the new role. Please confirm.

---

### 4.3 · Fix match quality and fresher ratings

**What you reported (§1.7, §1.8):** a QA Automation .NET profile scoring
**6.13/10 (High Match)** against a role it does not fit, ranking above candidates who
genuinely match; and fresher profiles rating too high despite falling outside the
experience criteria.

**We have found the cause, and you were right to flag it.** Harish diagnosed it live
on the call while looking at the candidate detail — *"I think this matched `net`
instead of `dot`."* That is exactly what is happening. The matching compares text
fragments rather than whole words, so the letters `net` match inside unrelated words,
and a candidate with no .NET experience earns .NET credit. Pankaj found the same
thing with the QA tag: it was picked up from the phrase *"QA alignment with proper
goal"* in a bullet point, not from any QA skill.

The fresher problem has a related cause. The overall rating is a flat average of six
factors — skills, education, experience, CTC, job stability, notice period. A fresher
who fails the experience requirement loses **one factor out of six** and still lands
around 6 out of 10. That is precisely the "6.13 High Match" you saw. Failing a
*mandatory* criterion needs to cap the score, not be averaged away.

So both of your points are confirmed as real defects, with an identified cause.

**Why it cannot be done now.** Changing how matching works **changes every score in
the system at once** — every JD filter result, every keyword result, every ranking
you have been reviewing during UAT. It would also change what Abhijit sees on
Tuesday, mid-demo, with no time to check the new results first. This is the clearest
example of a change that is small in code and very large in effect.

**What we need from you first.** Harish committed on the call to sending you the
**scoring-rules document** for JD filtering and keyword filtering, so you can read
the rules and tell us what to change. Pankaj asked for the same. That document is a
Phase 3 action — it is in item 4 of the companion document. Please mark it up and
send it back; your annotations will define this build.

This also answers §1.6. Harish's explanation was that candidates missing from JD
filtering are not skipped by the AI — *"it means the candidate is not matching the
profile"* — because the rules are strict. That is a fair explanation, but it is not
something you can verify until you can read the rules. Hence the document.

**What you will get:**
- Whole-word matching, with proper handling of `.NET` / `dotnet` / `C#` and similar
- Skills you have declared weighted above passing mentions in resume text —
  Harish's point stands that a resume mention is real evidence, just weaker evidence
- Failing a mandatory JD criterion caps the score below High Match
- Freshers outside the experience band rated materially lower
- The candidate detail stating **which** mandatory criterion failed and what it cost
- Score band labels re-tuned, so 6.13 can never read as "High Match" again
- **A before-and-after report on the exact profiles you named** — Pankaj Mondal on
  the Python JD, and Nihar Naik — so you can confirm the ranking corrects

---

### 4.4 · Free-form stage movement — the Trello-style pipeline

**What you asked for (§3):** the ability to skip any stage, in any order, and to
return to a stage that was skipped. Both of you independently described it as
**Trello cards moving between columns.**

Chhaya's requirement became clearer over the call, and this is the fullest version
of it:
- Skip *any* stage, not only the ones currently marked optional
- **Return to a skipped stage later** — *"after skipping it should not happen that we
  cannot go back and reconduct it"*
- Start the process at any stage — the walk-in case, where Tech 1 runs first and
  EvalGround follows at the weekend

**Why it cannot be done now, and this one is not a scheduling preference.** The
pipeline today only moves forward, one stage at a time. There is no ability anywhere
in the system to move a candidate backwards. Building that means rebuilding four
things together: how a candidate moves between stages, the history trail that records
where they have been, the automated emails that fire when a candidate arrives at a
stage, and the assessment and scorecard logic that assumes each stage happens once.

The email part is where the real risk sits. Re-entering a stage must not re-send a
"you have progressed to the next round" email to a candidate who has already had one.
As mentioned above, we have already had a duplicate-email incident during
development, from a much smaller version of this problem.

**Harish asked for this in writing on the call, and we are holding to that:**

> *"If something needs to be changed, we need this written in. Please share it in the
> written format so that everyone will be aware of it, because it changes the
> architecture."*

**This item cannot start until that written requirement arrives.** It needs to answer
five questions:

1. Which stages may be skipped, and by which roles?
2. Can a skipped stage be re-entered, and who authorises that?
3. Can a pipeline *start* at a stage other than the first — the walk-in case?
4. What is the candidate told at each non-standard transition? (This is the one that
   prevents wrong emails.)
5. Does "like Trello" mean free movement between all columns, or a defined set of
   allowed moves?

**In the meantime — the workarounds you proposed yourself.** Chhaya offered two on
the call, and both work today:

- **Enter the HR Screening score manually.** *"I am even open for writing the HR
  screening score on my own — 3 out of 5 — I approved at this stage."* This already
  works; we are labelling it clearly in Phase 3 (companion document, item 3.6).
- **If the CEO round happens first, record it as Tech 1** with a note attributing it
  to Abhijit.

And your own position on the call was that the full version is *"good to have"*
rather than blocking, which is what makes this split possible.

---

### 4.5 · Hold option at MRF approval, with reminder

**What you asked for (§1.1):** add **Hold Request** alongside Approve Request and
Reject Request on the MRF approval sent to Abhijit and Sangamitra, with the same
notes box — so a hiring manager's request can be deferred rather than rejected.

Your reasoning is sound and we are not disputing any of it: rejecting a hiring
manager's request to mean "not right now" is the wrong signal, and a note on a
rejected request will not survive once there are hundreds of them.

We also noted the distinction you drew when Harish mentioned the existing pause and
close features — those act on an **already-approved** position, while Hold has to act
at the **approval gate**, before the requisition opens. That is correctly understood
on our side.

**Why it is in Phase 4 rather than now.** Two reasons:

1. It adds a **new status value** to the approval workflow. Other parts of the system
   filter requisitions by approval status, so a third value has to be traced through
   each of them. A requisition that is on hold must not appear as open anywhere — not
   in Screening, not on the candidate form, not in reporting.
2. The **reminder** needs a scheduled background job. When Harish asked directly
   whether a reminder was needed, Chhaya confirmed it is: after the hold period a
   trigger goes back to Abhijit asking whether to reopen, offering Approve / Reject /
   Hold further. That is automated email on a timer, which is the category we are
   most careful with.

We also note Chhaya marked this **optional**, which supports placing it here.

**Our recommendation:** build the hold and the reminder **together**. A hold with no
reminder recreates exactly the "we will forget about it" problem you described. Good
news on effort — the requisition record already has a "resume on" date field used by
the existing pause feature, which is the right place to hang the reminder.

**What we need from you:** written confirmation that the reminder is in scope, so we
size it once rather than twice.

**What you will get:**
- Approve Request · Reject Request · **Hold Request**, all three with notes
- Hold requires a hold-until date and a mandatory note
- Held requisitions show as **On Hold** with the date and note, and appear as open
  nowhere
- On the hold-until date, a reminder to the original approver: *"would you like to
  reopen this position now?"* — with Approve / Reject / **Hold further** available
  again, so it can be held repeatedly as you described
- Every transition recorded with who did it and when

---

### 4.6 · Make more interview stages skippable

**Background.** Skipping exists today, but only for the stages marked optional —
Tech 3 and Client Round. Harish confirmed that Zeko HR, EvalGround and Zeko Functional
are currently mandatory *"because it was finalised before the development work."*

This item is the smaller, interim version of 4.4: rather than rebuilding the pipeline,
mark the specific stages you need to bypass as optional, so the existing skip
mechanism covers them.

**Why it is not in Phase 3.** It looks like a small setting change, and technically it
is — but flipping a stage to optional changes **which automated emails fire and when**,
and changes what the assessment and scorecard logic expects. Each stage we flip has to
be tested through a full pipeline run before we trust it. That is not something to do
in a demo week.

**What we need from you:** the list. Which of these do you actually need to bypass —
EvalGround? Zeko Functional? CEO round? We will check each one's email and scorecard
behaviour before flipping it, and confirm back to you.

**This is a stopgap**, and we want to be honest about that. It gives you skipping
without the ability to go *back* to a skipped stage. The full version is 4.4.

---

### 4.7 · Custom date range in Recruitment Analytics

**Raised by Naveen on the call:** only a 90-day view exists; he wanted 30 / 60 / 365
days and an all-time view. Chhaya suggested a calendar picker for custom dates.

**Where it will be built.** On the **Recruitment Analytics** page, not the Dashboard.
That was Harish's proposal on the call — the dashboard is a high-level glance, and
detail belongs in Analytics — and Naveen accepted it: *"Okay, got it, got it. That's
why it was not showing those things."*

**Why it is in Phase 4.** Every tile and chart on that page has to honour the selected
range, which means changing each underlying calculation. It is additive work with no
architectural risk, but it is broad, and it moves the analytics tests.

**What you will get:** presets for 30 / 60 / 90 / 365 days and All, plus a custom
from-to picker; every tile and chart honouring it; and the active range stated on
screen, so a number that gets screenshotted or exported cannot be misread. The
Dashboard keeps its 90-day glance and will say so on the tile.

---

### 4.8 · Editable date or reference on JDs with no MRF

**The second half of §1.4:** *"If there is no MRF, the recruitment team should have
the option to modify/add the date displayed against the JD to identify the most recent
version."*

The first half — showing the MRF date and reference against each JD — is being done
now, in Phase 3 (companion document, item 3.4). That solves the duplicate-name problem
you described.

This half needs somewhere to **store** a recruiter-entered label, which means a new
database field, so it goes to Phase 4. Small, but it crosses the line we drew.

---

## 5. What we need from you, to start Phase 4

Four of the eight items are waiting on a decision from you. Sending these unblocks
most of Phase 4.

| # | What we need | For item | Priority |
|---|---|---|---|
| 1 | **The stage-flexibility requirement in writing**, answering the five questions in 4.4 | 4.4 | **Blocking** — no work can start without it |
| 2 | **The marked-up scoring-rules document** (we send it to you first) | 4.3, and §1.6 | High — defines what we build |
| 3 | **The stage-carry decision** — Option A, B or C in 4.2 | 4.2 | High |
| 4 | **Confirm the Hold reminder is in scope** | 4.5 | Medium |
| 5 | **The list of stages to make skippable** | 4.6 | Medium |

Items 4.1, 4.7 and 4.8 need nothing from you and can start as soon as Phase 3 ships.

---

## 6. Suggested order for Phase 4

1. **4.1 Tag uploads against a JD** — first, because 4.2 and §1.6 depend on it, and
   because it is the item you marked mandatory
2. **4.3 Match quality and fresher ratings** — as soon as your marked-up rules
   document comes back
3. **4.2 Move / re-tag a candidate** — needs 4.1 finished and the stage-carry decision
4. **4.5 Hold option + reminder**
5. **4.6 More skippable stages** — the interim step toward 4.4
6. **4.8 Editable JD reference** — small, can slot in anywhere
7. **4.7 Custom date range in Analytics**
8. **4.4 Free-form stage movement** — last, and only once the written requirement is
   in. It is the largest item and the others should be settled before the pipeline is
   reworked underneath them.

---

## 7. Technical annex — for the engineering team

Not needed for the HR review. Line references are against `project-staging`.

| Item | What it touches | Test suites affected |
|---|---|---|
| **4.1** Upload → JD tagging | [hrUpload.service.js](../../backend/src/services/hrUpload.service.js) has no MRF reference today; [HRUpload.jsx](../../frontend/src/pages/HRUpload.jsx), [VendorPortal.jsx](../../frontend/src/pages/VendorPortal.jsx); `rpa_upload_jobs` / `rpa_upload_batch_summary`. **New schema relationship** — the only MRF link today is `rpa_shortlisted_candidates.mrf_id` (schema.prisma:239), set at shortlist time. Migration decision needed for ~99k existing rows. | `vendorIsolation`, `vendorNotification`, `csvExport` |
| **4.2** Move / re-tag | `POST /api/screening/shortlist` is the existing tag path; no re-assign path exists. `rpa_candidate_pipeline.mrf_id` (schema.prisma:695) is set at creation. Sends candidate email. | `shortlistStatus`, `crossModuleE2E`, `referralSuppression`, `vendorIsolation` |
| **4.3** Scoring | Substring containment at [screening.service.js:365-372](../../backend/src/services/screening.service.js#L365-L372) (`skill.includes(kw) \|\| kw.includes(skill)`) and `matchKeywordTerms()` at [line 433](../../backend/src/services/screening.service.js#L433). Flat six-component mean at [line 1588](../../backend/src/services/screening.service.js#L1588) and the parallel block at 1713. **Changes every score in the system** — needs a before/after comparison run on a staging snapshot before merge. | Screening behaviour is largely UAT-verified rather than unit-tested; build the comparison harness as part of this item |
| **4.4** Free-form stages | [pipeline.service.js:919-941](../../backend/src/services/pipeline.service.js#L919-L941) — `nextStage = stages[currentIdx + 1]`, `skipOptionalNext` reaches `+2` only when `nextStage.is_optional`. `advanceStage()` at [line 1090](../../backend/src/services/pipeline.service.js#L1090) is also `+1`. **No backward transition exists anywhere.** Arrival-detection reasoning at [lines 1957-1977](../../backend/src/services/pipeline.service.js#L1957-L1977) already records one prior correction. **Duplicate-email guard at [lines 863-864](../../backend/src/services/pipeline.service.js#L863-L864) documents the incident — must not be reopened.** | `pipelineStageEngine`, `pipelineClosure`, `schedulingAndScorecard`, `crossModuleE2E`, `rescheduleEmails`, `documentsAndOffer` |
| **4.5** MRF Hold | [mrf.controller.js:891-946](../../backend/src/controllers/mrf.controller.js#L891-L946) — the binary is line 924, `const isApproved = action.toLowerCase() === 'approve'`; mirrored write to `rpa_mrf_jd_send.mrfstatus` at 940-945. `approval_status` is a plain `String` (schema.prisma:212) so no enum migration is forced, but keep the enum at schema.prisma:1203 in step. **Reuse `resume_on` / `paused_*` (schema.prisma:227-230)** rather than adding `hold_until`; comment why, since pause and hold act at different points in the requisition's life. Do not disturb the closure separation documented at [mrf.controller.js:971-978](../../backend/src/controllers/mrf.controller.js#L971-L978). New scheduled job under `backend/src/jobs/` + `backend/src/queues/`. | `mrfClosure`, `mrfDetailExport`, `emailHelpers` |
| **4.6** More optional stages | Data change on `rpa_pipeline_stages.is_optional` (schema.prisma:763) — no code change, but verify each newly-optional stage's `rpa_stage_email_templates` trigger and scorecard occurrence behaviour through a full pipeline run **before** flipping. | `pipelineStageEngine`, `schedulingAndScorecard` |
| **4.7** Analytics date range | [Analytics.jsx](../../frontend/src/pages/Analytics.jsx), `pipelineAnalytics.helpers.js`, `dashboard.service.js`. | `pipelineAnalytics`, `analyticsParams` |
| **4.8** Editable JD reference | New nullable column for a recruiter-entered label on the JD/MRF record; render alongside the Phase 3 display work from item 3.4. | None expected |
