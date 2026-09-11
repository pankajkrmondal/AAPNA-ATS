# Phase 3 — What We Are Doing Now

**For:** Chhaya Verma, Naveen Satywali (HR / Talent Acquisition)
**From:** ATS Engineering — Pankaj Kumar Mondal, Harish Mopuri
**Date:** 11 September 2026
**Companion document:** [PHASE-4-DEFERRED-SCOPE.md](PHASE-4-DEFERRED-SCOPE.md) — what moves to Phase 4, and why

---

## 1. Thank you, and how we split your feedback

We have gone through both the written feedback sheet and the full recording of the
10 September review call. Sixteen distinct points were raised. This document covers
what we are acting on **now**. The companion document covers what we are moving to
**Phase 4**, with the reason for each.

Nothing has been dropped. Every point is in one of the two documents.

### The rule we used to split them

The CEO demo is on **Tuesday, 15 September**, on the staging environment. Staging
is currently stable and is the environment the entire walkthrough depends on.
So we sorted every item by **risk to that stability**, not by how much work it is:

> **Phase 3 (now)** — changes that only affect what is *displayed*. They do not
> change how the system calculates, decides, or stores anything. If a display
> change were to go wrong, the damage is visible immediately and reversible in
> minutes.
>
> **Phase 4 (next)** — changes that alter the database structure, the interview
> pipeline's internal rules, the candidate scoring calculation, or the automated
> emails. Each of these touches multiple modules at once and has to be
> re-tested end to end before anyone can trust it.

We want to be direct about the reasoning: a display change that breaks is an
inconvenience. A pipeline or scoring change that breaks during a CEO demo takes
the whole session down, and we would not be able to diagnose it live. With four
working days to Tuesday, that is not a trade we should make.

---

## 2. The demo freeze

| | |
|---|---|
| **Demo date** | Tuesday, 15 September 2026 |
| **Environment** | Staging — as agreed by Chhaya on the call ("things will be in your own hold when you are showcasing in staging") |
| **Code freeze on staging** | End of day **Monday, 14 September** |
| **Changes going in before the demo** | **One** — the sidebar reorder you asked for (item 3.2 below) |
| **Everything else** | Lands after the demo, before go-live |

Between the freeze and the demo we will only run through the demo script and fix
anything that is already broken. We will not be adding features into that window.

**Chhaya's own guidance on the call supports this**, and we are following it:

> *"In case you want to make the things live, keep few things for Phase 4, keep
> some of the work around for few of the things, and make it live. We are pretty
> much open and to cooperate with you guys."*

---

## 3. Phase 3 — the work

### 3.1 · Five points need no development at all

These were answered during the call. We are recording the answers here so they are
written down and do not need to be raised again.

| Your point | Answer |
|---|---|
| **§1.2** — "Position Applied For" needs search + type, not just a dropdown | The dropdown is intentional because only 5-6 requisitions are open at a time. **Chhaya's own assumption on the call was correct** — when a requisition is closed, it stops appearing on the candidate form automatically. And the form already has an **"Other"** option with a free-text box for anyone applying against no open position. Between those two, the list stays short and nobody is blocked. We suggest revisiting only if open requisitions ever go past about 15 at once. |
| **§1.3** — does closing a requisition archive its JD? | Yes. Closure is already tracked separately from approval, and a closed requisition drops out of the candidate-facing form. What was genuinely missing is *visibility for the recruiter* — that is item 3.5 below. |
| **§2.1** — QA Automation tag appears in Pipeline but not in Candidate Screening | This is not an inconsistency. Both QA Automation candidates reached offer stage and accepted, so the **requisition closed automatically** and left Candidate Screening. The Pipeline deliberately stays open so you can keep working candidates on a closed requisition — as Harish explained, *"if you think that candidate is having potential, you can still take them into the offer stage."* We are **not** making the two lists identical, because that would remove a behaviour you rely on. We are adding a visibility toggle instead — item 3.5. |
| **§4** — the interview host cannot see interviews scheduled by them | This is a staging-only effect. In staging every calendar invite is created from one shared mailbox, so the host never appears as the organiser. In production the invite is created as the **real organiser** and lands on their own calendar. No code change needed — but we are not asking you to take that on trust. We will prove it right after the production deploy (item 3.7). |
| **§3, part** — approving HR Screening without an assessment score | This **already works today**. Chhaya proposed it herself as a workaround — *"I am even open for writing the HR screening score on my own"* — and it is already supported. We will make the option clearly labelled so it is obvious (item 3.6). |

One more thing worth saying plainly, because it affects what you saw while
spot-checking: **some candidate profiles in staging are deliberate test data** that
we screened manually during development. Harish mentioned this on the call. If a
profile looks oddly placed, it may be one of those rather than a scoring result.

---

### 3.2 · Sidebar reorder — **the only change going in before the demo**

**Your request (§6):** reorder the left-hand menu to

```
Dashboard · MRF · Search Candidate · HR Manual Upload · Vendor Upload
· Vendor Dashboard · Candidate Screening · Candidate Pipeline
· Recruitment Analytics · Email Templates · Settings
```

You asked for this specifically before Tuesday, because Abhijit reviews from a
UI/UX angle and is likely to comment on it. We agree, and it is the one change
safe enough to put in ahead of the demo.

**Why it is safe:** the menu order is a single list in one file. Nothing reads that
list to make a decision — page addresses, permissions and breadcrumbs are all keyed
to the page itself, not its position in the menu. The Vendor Dashboard entry also
positions itself automatically relative to Vendor Upload, so it will follow the new
order without any extra handling.

**Actual change vs. today:** MRF moves up two places. Everything else already sits
in the order you asked for.

**Plan:** in by Monday, deployed to staging and clicked through on every role
(admin, superadmin, recruiter, vendor) before the freeze.

---

### 3.3 · Show name, email and contact number in keyword search results

**Your request (§5)**, and Chhaya's reason for it, which we have understood:

> *"The idea was to move the candidate from here also … we wanted in keyword
> filtering these 3 things should also be here so that those candidates can be
> moved directly from there."*

So this is not cosmetic — it is the screen from which you will later select
candidates in bulk. We are building it now so it is ready and settled before the
bulk-move feature arrives in Phase 4.

**Why it is safe:** the name, email and contact number are **already being fetched**
by the search. They are simply not being drawn on the result row. We are adding
three columns to a list; no search logic, no scoring, no data changes.

**What you will get:** every keyword result row shows Candidate Name, Email ID and
Contact Number without opening the candidate — matching the Search Candidate
layout you named as the benchmark. Missing values will show a dash rather than a
blank space, so you can tell "no phone number on file" from "not loaded".

**When:** after the demo, before go-live.

---

### 3.4 · Date and reference against each JD

**Your request (§1.4):** four requisitions can all be called ".NET Developer", and
there is no way to tell which one is linked to which MRF, or which is most recent.

Chhaya set a deliberately low bar on the call — *"some date or something… some
reference ID… we are even fine with some manual intervention"* — and that is what
makes this safe to do now.

**Why it is safe:** each MRF already carries its creation date. We are showing
information that already exists, in a dropdown. No new fields, no calculation.

**What you will get:** every JD in the Candidate Screening picker will read

```
.NET Developer · MRF #128 · 03 Sep 2026
```

with the newest first and the latest one for a duplicated name clearly marked.

**One part moves to Phase 4:** your second request — being able to *type in or edit*
a date against a JD that has **no MRF** — needs a new field stored in the database.
That is in the Phase 4 document. The display half solves the duplicate-name problem
you actually described, which is the urgent part.

**When:** after the demo, before go-live.

---

### 3.5 · Make closed requisitions visible instead of invisible

This is our answer to the QA Automation confusion in §2.1. Rather than making
Screening and Pipeline identical — which would break a behaviour you use — we are
making the closure *visible*, so the next recruiter does not spend time hunting for
a requisition that closed correctly.

**What you will get:**
- A **"Include closed requisitions"** switch on the JD filter, off by default
- Closed requisitions shown with a **Closed** badge, with the closure reason and
  date on hover
- Selecting a closed requisition is view-only — you will not be able to shortlist
  into it by accident
- If you search a term that only matches closed requisitions, instead of an empty
  screen you will see: *"2 closed requisitions match 'QA' — show them?"*

**Why it is safe:** it is an optional filter that is off unless you switch it on.
With it off, the screen behaves exactly as it does today.

**When:** after the demo, before go-live.

---

### 3.6 · Label the "approve without assessment score" option clearly

Harish confirmed on the call that HR Screening can **already** be approved with no
assessment score present — which is exactly the workaround Chhaya proposed. The gap
is that it is not obvious; it works, but it is not labelled as a deliberate choice.

**What you will get:** a clearly named action on the HR Screening panel —
*"Approve without assessment score"* — with a mandatory note so the reason is
recorded against the candidate.

**Why it is safe:** the underlying capability is unchanged. We are naming an
existing path, not creating a new one.

**Important:** this covers only *one* of the stage-flexibility requests in §3. The
larger request — skipping any stage and going back to a skipped stage — is a
Phase 4 item and is explained fully in the companion document.

**When:** after the demo, before go-live.

---

### 3.7 · Prove the interview host visibility in production

No code — a verification step, so §4 is closed with evidence rather than an
assertion.

Immediately after the production deploy we will have **a host other than Pankaj**
schedule a real interview, and confirm the event appears on that host's own
calendar with the candidate, date, time and stage, without affecting the
interviewer or candidate invites. We will send you the result either way.

If it does **not** behave as expected in production, §4 becomes a real build item
and we will start from Chhaya's suggested fallback (*"let us know if any CC or
something can work here"*).

---

### 3.8 · Show when a candidate was added to the database

**Raised by Naveen on the call** (not in the written sheet): the system shows
*shortlisted on 31 August*, but not when the candidate first entered the database.
Harish confirmed the intended meaning with you — **date of addition of the
candidate**, not date of file upload, not date of shortlisting.

**Why it is safe:** this date is already stored against every candidate. It is
purely not being displayed.

**What you will get:** a sortable **Date Added** column in Search Candidate and in
keyword results, and the same date in the candidate detail header, shown separately
from Shortlisted On.

**One check we will run:** confirming this date is present on the ~99,000 candidates
already loaded. If older records do not have it, we will tell you what will be
shown for them rather than leaving a silent blank.

**When:** after the demo, before go-live.

---

### 3.9 · Investigate the dashboard numbers Naveen found

**Raised by Naveen on the call.** Two things did not reconcile:

1. The Skills tile says it is *"based on 200 most recent candidates"*, but the
   counts shown add up to roughly 20.
2. One tile showed **184** candidates for RPA while another showed **9**.

Harish was straightforward on the call that he could not explain the second one —
*"We'll look into this once again. Not sure why it is showing."* His working theory
is that the 184 counts candidates who selected "RPA Developer" themselves on the
application form, which is a different population from the other tile.

**What we will do in Phase 3:**
- Work out whether the sample is genuinely 200 or 20, and correct whichever of the
  number and the tooltip is wrong — they must agree
- **Label each tile with the population and time window it is showing**, so two
  numbers that are both correct but count different things stop looking like a bug
- Write the explanation down and send it to Naveen, since he found this by
  cross-checking and will cross-check again

**Why it is safe:** the investigation costs nothing, and the fix we expect to need
is a corrected label. **If it turns out the underlying calculation is wrong**, the
fix moves to Phase 4 and we will tell you — we are not going to change how numbers
are computed in the run-up to a demo.

---

## 4. What we need from you during Phase 3

These are small, and two of them decide how quickly Phase 4 can start.

| # | What | Who | Why it matters |
|---|---|---|---|
| 1 | **We send you the scoring-rules document** for JD filtering and keyword filtering. Please read it, mark it up, and send it back with what you want changed. | Harish → Chhaya & Naveen | This is the real answer to *"why is my Python candidate not in JD filtering"*. Harish committed to it on the call. It also decides exactly what we build in Phase 4 for the match-quality fix. |
| 2 | **The stage-flexibility requirement in writing.** Harish asked for this on the call: *"we need this written in… because it changes the architecture."* | Chhaya & Naveen | Phase 4 work on this **cannot start** without it. The companion document lists the exact five questions it needs to answer. |
| 3 | **Decide what happens to a candidate's stage when they move to a different requisition.** | Chhaya & Naveen | Three sensible answers exist and they produce different systems. The companion document lays out the options. |
| 4 | **Confirm the Hold option scope** — hold with notes only, or hold with an automatic reminder back to the approver. On the call Chhaya confirmed the reminder is wanted; we want that written down before building. | Chhaya | Decides the size of the Phase 4 Hold work. |
| 5 | **Forward the 9 September mail to Anuj with Harish in copy**, and add Anuj to Tuesday's demo call. | Chhaya | Anuj has asked Harish twice for a Phase 1/2 usage report. The mail Chhaya already sent contains what he needs. |
| 6 | **Confirm the demo happens on staging** with Rakhi ma'am / Sangamitra. | Chhaya & Naveen | Agreed on the call; just needs the confirmation Harish asked for. |
| 7 | **One pre-filled interview feedback form** for the demo. | HR, or Pankaj | Testing the full pipeline live takes half a day. Chhaya's plan — keep one filled form open and approve through the stages — is what we will follow. The Tech 1 / 2 / 3 form is the same form, so one copy covers every round. |

---

## 5. Phase 3 at a glance

| Item | Type | Risk | When |
|---|---|---|---|
| 3.1 Five points answered, no work needed | Explanation | None | Done — this document |
| 3.2 Sidebar reorder | Display | Very low | **Before demo** — in by Mon 14 Sep |
| 3.3 Name / email / contact in keyword results | Display | Very low | After demo |
| 3.4 Date + MRF reference against each JD | Display | Very low | After demo |
| 3.5 Closed requisitions visible (opt-in toggle) | Display | Low | After demo |
| 3.6 Label "approve without assessment score" | Labelling | Low | After demo |
| 3.7 Verify interview host visibility in production | Verification | None | At production deploy |
| 3.8 Candidate "Date Added" | Display | Very low | After demo |
| 3.9 Dashboard numbers — investigate + label | Investigation | None to low | After demo |

**Nine items. None of them changes how the system calculates, decides, or stores
anything.** That is deliberate, and it is what makes them safe to ship in the same
window as a CEO demo.

---

## 6. Sequence

1. **Fri 11 – Mon 14 Sep** — sidebar reorder only; deployed and clicked through on
   every role
2. **Mon 14 Sep, end of day** — staging frozen
3. **Tue 15 Sep** — CEO demo on staging (Abhijit, and Anuj if he joins)
4. **After approval** — remaining Phase 3 items (3.3 – 3.6, 3.8, 3.9)
5. **Production deploy** — the day after approval, or Monday, as Chhaya proposed
6. **Immediately after deploy** — run the host-visibility verification (3.7) and
   send you the result
7. **Phase 4 opens** — once the written requirement in item 4.2 arrives

---

## 7. Technical annex — for the engineering team

Not needed for the HR review. Line references are against `project-staging`.

| Item | Touch points | Blast radius |
|---|---|---|
| 3.2 Sidebar | `MENU_ITEMS` — [MainLayout.jsx:67-88](../../frontend/src/layouts/MainLayout.jsx#L67-L88). **Correction to the earlier backlog note:** the Vendor Dashboard splice index does *not* need changing — [MainLayout.jsx:253-254](../../frontend/src/layouts/MainLayout.jsx#L253-L254) locates it with `findIndex((m) => m.key === '/vendor')` and splices at `idx + 1`, so it self-positions after any reorder. `BREADCRUMB_MAP` (lines 139-155) is keyed by path segment and is order-independent. Mirror the order in [Dashboard.jsx:72-76](../../frontend/src/pages/Dashboard.jsx#L72-L76) and [AdminDashboard.jsx:66-71](../../frontend/src/pages/AdminDashboard.jsx#L66-L71). | One file for the nav itself. No test suite asserts menu order. |
| 3.3 Keyword columns | Fields already selected at [screening.service.js:1326](../../backend/src/services/screening.service.js#L1326) (`c."Name"`, `c."EmailID"`, `c."ContactNumber"`); confirm they survive the response mapper near line 1600, then render in the keyword tab of [CandidateScreening.jsx](../../frontend/src/pages/CandidateScreening.jsx). | Presentation only. No change to the query, the ranking, or `POST /api/screening/keyword-search` semantics. |
| 3.4 JD date | `rpa_mrf.created_at` (schema.prisma:211) already present. `GET /api/screening/roles` → `getRoles`. | Additive field on an existing response. The editable-label half needs a new column — deferred, see Phase 4 §4.8. |
| 3.5 Closed-requisition toggle | New optional query flag on `getRoles`; `closed_at` / `closure_reason` already on `rpa_mrf` (schema.prisma:223-226). | Default-off flag. Do **not** touch `mrfClosure.service.js` semantics — `mrfClosure.test.js` covers them. |
| 3.6 Approve-without-score label | UI only. Capability already exists per Harish (33:45). Do **not** change `is_optional` on `rpa_pipeline_stages` — that is Phase 4 §4.6 and moves `pipelineStageEngine.test.js`. | UI labelling + a required note field. |
| 3.8 Date Added | `rpa_cv.createdAt` (schema.prisma:111). Verify backfill across the ~99k existing rows before shipping. | Display only. |
| 3.9 Dashboard | `dashboard.service.js`, `dashboard.controller.js`, [Dashboard.jsx](../../frontend/src/pages/Dashboard.jsx). | Investigate first. **Label-only fix stays in Phase 3; any change to the aggregation query moves to Phase 4** and must be re-run against `pipelineAnalytics.test.js` and `analyticsParams.test.js`. |

**Freeze discipline:** everything above except 3.2 lands on a branch off
`pankaj-work-staging-v18` and is **not** merged to staging until after Tuesday.
