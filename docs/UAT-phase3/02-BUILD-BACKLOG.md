# UAT Phase 3 — Build Backlog

Derived from [01-UAT-FEEDBACK-ANALYSIS.md](01-UAT-FEEDBACK-ANALYSIS.md). Only
items that need code are listed here; items Harish resolved on the call as
"already works" or "staging artefact" are in
[03-OPEN-DECISIONS-AND-ACTIONS.md](03-OPEN-DECISIONS-AND-ACTIONS.md) instead.

Sizes are engineering days for one developer: **XS** ≤ 2h · **S** ≤ 1d ·
**M** 2-3d · **L** 5d+.

---

## Ordering

**Before the Abhijit demo (Tuesday):** B-10, B-06, B-02, B-04.
Chhaya asked for B-10 by name — *"we can reorder this way before Tuesday"* — and
it is the item Abhijit is most likely to comment on.

**Phase 3 remainder:** B-01, B-03, B-05, B-11, B-13.

**Phase 4 (needs written sign-off first):** B-07, B-08, B-09, B-12.

---

# Phase 3 — before the demo

## B-10 · Reorder the sidebar {#b-10}

**Source:** doc §6 · call 50:19, 51:59 · Harish: "Sure, definitely."
**Size:** XS

Target order, exactly as Chhaya dictated:

```
Dashboard · MRF · Search Candidate · HR Manual Upload · Vendor Upload
· Vendor Dashboard · Candidate Screening · Candidate Pipeline
· Recruitment Analytics · Email Templates · Settings
```

**Touch points**
- `MENU_ITEMS` — [MainLayout.jsx:67-88](../../frontend/src/layouts/MainLayout.jsx#L67-L88)
- Vendor Dashboard is **not** in that array; it is injected for
  `VENDOR_DASHBOARD_ROLES` at
  [MainLayout.jsx:134-136](../../frontend/src/layouts/MainLayout.jsx#L134-L136).
  It must land **after Vendor Upload**, so the splice index changes — do not just
  reorder the array and leave the injection appending at the end.
- Mirror the order on the two dashboard tile grids so the app doesn't contradict
  itself: [Dashboard.jsx:72-76](../../frontend/src/pages/Dashboard.jsx#L72-L76)
  and [AdminDashboard.jsx:66-71](../../frontend/src/pages/AdminDashboard.jsx#L66-L71).

**Acceptance**
- [ ] Sidebar renders in the exact order above for admin, superadmin and recruiter.
- [ ] Vendor Dashboard sits between Vendor Upload and Candidate Screening for roles
      that get it, and is absent for roles that don't.
- [ ] `VENDOR_MENU_ITEMS` (the vendor-role menu) is untouched.
- [ ] Breadcrumbs still resolve — `BREADCRUMB_MAP`
      ([MainLayout.jsx:139-155](../../frontend/src/layouts/MainLayout.jsx#L139-L155))
      is keyed by path, so a pure reorder should not affect it; confirm anyway.

---

## B-06 · Show name, email and contact in keyword search results {#b-06}

**Source:** doc §5 · call 41:33, 42:06, 49:40
**Size:** S
**Why it's first:** it is the selection surface B-08 depends on. Chhaya's reason
was never "I want to read the email" — it was *"so that those candidates can be
moved directly from there."*

**Touch points**
- The data is **already selected** — see the keyword query at
  [screening.service.js:1326](../../backend/src/services/screening.service.js#L1326),
  which pulls `c."Name"`, `c."EmailID"`, `c."ContactNumber"`. Confirm they survive
  into the response mapper around
  [screening.service.js:1590-1600](../../backend/src/services/screening.service.js#L1590-L1600);
  add them there if they're dropped.
- Result-row rendering in the keyword tab of
  [CandidateScreening.jsx](../../frontend/src/pages/CandidateScreening.jsx).

**Acceptance**
- [ ] Each keyword result row shows Candidate Name, Email ID and Contact Number
      without opening the detail drawer.
- [ ] Parity with the Search Candidate row layout — Chhaya's stated benchmark is
      *"just as in search option."*
- [ ] Long emails truncate with the full value on hover; rows stay on one line.
- [ ] Missing email/phone renders as an explicit "—", never blank.

---

## B-02 · Date / reference against each JD in the screening picker {#b-02}

**Source:** doc §1.4 · call 14:15-17:33
**Size:** S

Four MRFs named `.NET Developer` must be distinguishable in JD filtering.
Chhaya explicitly accepted manual intervention as a fallback — automatic is a
"better if", not a requirement.

**Touch points**
- `rpa_mrf.created_at` (schema.prisma:211) and `filled_at` (223) already hold the
  data — no migration for the MRF-linked case.
- JD list endpoint `GET /api/screening/roles` →
  `screeningController.getRoles` ([screening.routes.js](../../backend/src/routes/screening.routes.js)).
- JD selector in [CandidateScreening.jsx](../../frontend/src/pages/CandidateScreening.jsx).

**Acceptance**
- [ ] Each JD option renders as `<position> · MRF #<id> · <created date>`.
- [ ] The most recent JD for a duplicated name is visually marked as latest.
- [ ] For a JD with **no** MRF, a recruiter can set/edit a date or reference label
      that persists and displays the same way (doc §1.4 second clause).
- [ ] Sorting the list newest-first is the default.

---

## B-04 · Make closed requisitions visible rather than absent {#b-04}

**Source:** call 24:18-25:13 — **not** doc §2.1 as written
**Size:** S

> ⚠️ **Read this before implementing.** Doc §2.1 asks to "make the tagging options
> consistent across Screening and Pipeline." **Do not build that.** Harish
> explained (24:53) that a requisition auto-closes when all offers are accepted,
> which removes it from Screening while the Pipeline deliberately stays open so
> recruiters can keep working existing candidates. Chhaya accepted the explanation
> on the call (25:05, "got it, got it"). Making the two lists identical would undo
> a deliberate design.

Build the *affordance* instead, so the confusion doesn't recur.

**Acceptance**
- [ ] The JD filter has a **"Include closed requisitions"** toggle, off by default.
- [ ] With it on, closed JDs appear carrying a `Closed` badge and their
      `closure_reason` / closure date on hover.
- [ ] Selecting a closed JD is read-only — no shortlisting into a closed
      requisition.
- [ ] An empty result for a searched term that matches only closed requisitions
      shows "2 closed requisitions match 'QA' — show them?" rather than "no results."

---

# Phase 3 — remainder

## B-01 · Hold option at the MRF approval gate {#b-01}

**Source:** doc §1.1 · call 07:34, 10:08, 12:57, 13:41
**Size:** S (action + notes) → **M with the reminder**
**Note:** Chhaya labelled this *optional*, but confirmed the reminder is in scope
when Harish asked directly (12:57 → 13:41). Build both or neither — a hold with
no reminder recreates the "we'll forget about it" problem she raised at 10:33.

**Touch points**
- `handleMrfApproval` —
  [mrf.controller.js:891-946](../../backend/src/controllers/mrf.controller.js#L891-L946).
  The binary is at line 924: `const isApproved = action.toLowerCase() === 'approve'`.
  Replace with a three-way action resolve; also update the mirrored write to
  `rpa_mrf_jd_send.mrfstatus` at lines 940-945.
- `rpa_mrf.approval_status` is a plain `String` (schema.prisma:212), so adding
  `'hold'` needs no enum migration — but keep the `approval_status` enum
  (schema.prisma:1203) in step to avoid drift.
- **Reuse the existing pause vocabulary.** `rpa_mrf` already has `paused_at`,
  `paused_reason`, `paused_by` and `resume_on` (schema.prisma:227-230).
  `resume_on` is exactly the hold-until date. Reuse it rather than adding
  `hold_until`; note in the code *why*, since pause and hold act at different
  stages of the requisition's life (Chhaya's 09:48 distinction).
- Approval UI: [MrfApprovalAction.jsx](../../frontend/src/pages/MrfApprovalAction.jsx).
- Reminder job: `backend/src/jobs/` + `backend/src/queues/`.

**Acceptance**
- [ ] The approval mail and page offer **Approve Request · Reject Request · Hold
      Request**, all three with the same notes box.
- [ ] Hold requires a hold-until date; the note is mandatory.
- [ ] A held MRF shows as `On Hold` on the MRF page with the date and note, and
      does **not** appear as an open requisition anywhere downstream.
- [ ] On the hold-until date a reminder mail goes to the original approver reading
      "would you like to reopen this position now?", offering **Approve / Reject /
      Hold further** — i.e. hold is re-enterable, per Chhaya at 13:41.
- [ ] Every transition is written to the MRF audit trail with actor and timestamp.
- [ ] Closure semantics are untouched — `closed_at` still means closed, per the
      comment at [mrf.controller.js:971-978](../../backend/src/controllers/mrf.controller.js#L971-L978).

---

## B-03 · Fix skill matching and mandatory-criteria weighting {#b-03}

**Source:** doc §1.7 + §1.8 · call 21:34, 23:52, 43:29-48:29
**Size:** M
**This is the highest-confidence defect in the pack** — Harish diagnosed it live:
*"I think this matched `net` instead of `dot`."*

### (a) Word-boundary matching

The matchers use bidirectional substring containment:
[screening.service.js:365-372](../../backend/src/services/screening.service.js#L365-L372)
does `skill.includes(kw) || kw.includes(skill)`, and `matchKeywordTerms()` at
[screening.service.js:433](../../backend/src/services/screening.service.js#L433)
matches terms against free resume text the same way.

Observed consequences, both reported by HR:
- `net` matches inside `Jenkins`, `network`, `.NET` → a candidate with no .NET
  experience scores a .NET skill match (Harish, 47:50).
- `QA` matched the phrase *"QA alignment with proper goal"* in a bullet, not a
  skill (Pankaj, 47:06).

**Acceptance**
- [ ] Terms match on word/token boundaries, not raw substrings.
- [ ] Short terms (≤ 4 chars) and punctuated technologies get an alias map —
      `.NET` / `dotnet` / `dot net` / `C#` / `CSharp` — instead of naive containment.
- [ ] Skill-field matches are weighted above free-resume-text matches. Harish's
      44:12 point stands: a resume mention is legitimate evidence, just weaker
      evidence than a declared skill.
- [ ] Regression: the two profiles HR named — **Pankaj Mondal** on the Python JD,
      and **Nihar Naik** — no longer out-rank genuine QA/automation candidates.
      Re-run and report the before/after scores back to Chhaya.

### (b) Mandatory criteria must gate, not average

`screening.service.js` averages a flat `scores[]` array (skill match, education,
experience fit, CTC fit, job stability, notice period) —
see [screening.service.js:1588](../../backend/src/services/screening.service.js#L1588)
(and the parallel block at line 1713).
A fresher who fails the experience band loses one of six components and still
lands near 6/10, which is precisely the **6.13 "High Match"** Chhaya flagged.

**Acceptance**
- [ ] Failing a **mandatory** JD criterion caps the overall score below the
      High Match threshold, or applies a multiplicative penalty — not a 1-in-6
      averaged term.
- [ ] Freshers outside the JD's experience range score materially lower (doc §1.8).
- [ ] The candidate detail breakdown states which mandatory criterion failed and
      what it cost — Harish already points users there (22:50), so it has to
      explain itself.
- [ ] The score band labels (`High Match` etc.) are re-tuned against the new
      distribution; 6.13 must not read as "High".

**Pair with [action A-01](03-OPEN-DECISIONS-AND-ACTIONS.md#a-01)** — Harish
committed at 24:08 and 49:13 to share the scoring-rules document with Chhaya.
Ship the fix and the document together so she can validate the rules against
what she now sees.

---

## B-05 · Phase-3 stage-flexibility workaround {#b-05}

**Source:** doc §3 · call 30:59-36:38, 40:06 · Pankaj's 2-4h rule at 39:57
**Size:** S
**Scope guard:** this is explicitly **not** the Trello-style board — that is
[B-09](#b-09) and is blocked on written sign-off. This item only exercises
capability that already exists.

Two things Harish confirmed already work but HR did not know about:
1. **(33:45)** HR Screening can be approved with no Zeko score present.
   Chhaya independently proposed exactly this as her workaround (40:06): *"I am
   even open for writing the HR screening score on my own."*
2. **(31:26)** optional stages already skip — `skipOptionalNext` in
   [pipeline.service.js:936](../../backend/src/services/pipeline.service.js#L936).

**Acceptance**
- [ ] The HR Screening panel exposes an explicit **"Approve without assessment
      score"** action with a mandatory reason/score note — discoverable, not a
      side effect of leaving a field blank.
- [ ] `is_optional` is reviewed with HR and set to `true` on the stages they
      actually need to bypass (candidates: EvalGround, Zeko Functional, CEO round),
      so the existing skip path covers them. This is a data change on
      `rpa_pipeline_stages` (schema.prisma:763), **not** a code change — confirm
      the downstream email triggers behave for each newly-optional stage before
      flipping it.
- [ ] The skip is visible in the stage timeline as a skip event with actor and
      note — the existing `event_type: 'skip'` path at
      [pipeline.service.js:990](../../backend/src/services/pipeline.service.js#L990)
      already does this; verify it surfaces in the UI.
- [ ] HR is told in writing that (a) and (b) exist — half of their §3 pain is
      discoverability, not capability.

---

## B-11 · Reconcile dashboard talent-insight counts {#b-11}

**Source:** call 54:42-56:29 — **call only, not in the feedback document**
**Size:** M (investigation first)
**Harish on the call (56:18): "We'll look into this once again. Not sure why it
is showing."** This is the one item nobody could explain.

Two separate discrepancies:
1. The Skills tile's tooltip says *"based on 200 most recent candidates"* but the
   displayed counts total ~20 (Python 5, TestNG 4, MS Office 3, Selenium 2).
   Harish's 55:37 "yeah, whatever it is" did not settle it.
2. One tile shows **184** candidates for RPA, another shows **9**. Harish's
   partial explanation (56:29): the 184 counts self-declared "position applied
   for" on the application form — a different population from the other tile.

**Touch points:** `backend/src/services/dashboard.service.js`,
`backend/src/controllers/dashboard.controller.js`,
[Dashboard.jsx](../../frontend/src/pages/Dashboard.jsx).

**Acceptance**
- [ ] Establish whether the sample size is actually 200 or 20 and correct either
      the query or the tooltip — they must agree.
- [ ] Each tile states its population and window in the tile itself
      ("self-reported position, last 90 days" vs "screened candidates, last 90
      days"), so two correct-but-different numbers stop looking like a bug.
- [ ] Write the reconciliation down and send it to Naveen — he found this by
      cross-checking, and will cross-check again.

---

## B-13 · Surface the candidate's "date added" {#b-13}

**Source:** call 57:10-57:31, 1:01:13, 1:04:11 — **call only**
**Size:** S

Naveen could see *shortlisted on 31 August* but not when the candidate entered the
database. Harish (1:04:11) confirmed the semantics with him: **date of addition of
the candidate**, not date of upload of a file, not date of shortlisting.

**Touch points:** `rpa_cv.createdAt` / `modifiedAt` (schema.prisma:111-112) — the
data already exists, this is display-only.

**Acceptance**
- [ ] "Date Added" column in Search Candidate, sortable.
- [ ] Same field in keyword search rows (ships naturally with [B-06](#b-06)).
- [ ] Date Added shown in the candidate detail header, distinct from Shortlisted On.
- [ ] Backfill check: confirm `createdAt` is populated for the ~99,000 candidates
      already loaded (Naveen, 04:57) — if historical rows are null, decide and
      document what to display.

Close Naveen's related question via
[action A-04](03-OPEN-DECISIONS-AND-ACTIONS.md#a-04).

---

# Phase 4 — blocked on written sign-off

## B-07 · Tag uploads against a JD {#b-07}

**Source:** doc §1.5 · call 17:47-19:55 — **the only item Chhaya marked mandatory**
**Size:** L
**Harish (19:27): "it was not communicated before … the focus was on whether we
are matching the duplicate or not, the focus was not on JD mapping."** So this is
new scope, not a missed requirement. Chhaya accepted that (19:55).

Everything else in the pack that touches the JD↔candidate relationship — §1.6
(JD filtering shows matching profiles), §2.2 (move candidate to a JD) — depends on
this link existing. Build it first among the Phase 4 items.

**Touch points**
- [hrUpload.service.js](../../backend/src/services/hrUpload.service.js) — currently
  has no MRF/JD reference anywhere; uploads write to `rpa_cv` with no requisition
  foreign key.
- [HRUpload.jsx](../../frontend/src/pages/HRUpload.jsx) and
  [VendorPortal.jsx](../../frontend/src/pages/VendorPortal.jsx).
- Schema: a JD/MRF association on the upload batch and/or per-CV. Today the only
  MRF link is `rpa_shortlisted_candidates.mrf_id` (schema.prisma:239), which is
  set at shortlist time and is the wrong lifecycle stage for this.
- `rpa_upload_jobs` / `rpa_upload_batch_summary` for the bulk path.

**Acceptance**
- [ ] Excel/bulk upload takes an optional "tag to requisition" selection applied to
      every row in the batch.
- [ ] Individual upload takes the same selection.
- [ ] Tagged candidates are retrievable by JD in Candidate Screening.
- [ ] Untagged uploads remain valid — general talent-pool intake must keep working.
- [ ] Existing duplicate detection is not regressed; it is the behaviour the
      current upload path was actually built around.
- [ ] A candidate can carry more than one JD tag over time (needed by [B-08](#b-08)).

---

## B-08 · Move / re-tag a candidate to another requisition {#b-08}

**Source:** doc §2.2 · call 25:36-30:24, 50:05, 53:05
**Size:** L
**Depends on:** [B-07](#b-07) for the data model, [B-06](#b-06) for the selection UI.

> **Harish (30:24):** bulk tagging of *untagged* candidates **already works** in
> keyword filtering — search a role, get 400 profiles, map them in one go, outreach
> mails fire. **"But once it is tagged, yeah, it is not there."**

So the gap is **re-tagging**, not tagging. Scope accordingly — do not rebuild what
works.

Two modes, both requested:
- **(a) Bulk** — re-target a filtered set onto a newly opened requisition and fire
  the outreach mail (Chhaya, 26:38).
- **(b) Individual** — move one candidate mid-pipeline to a different role
  (Naveen, 28:22; Harish's readback at 29:11).

**Placement:** Keyword filtering and Pipeline are agreed. **Search Candidate is
optional** — Harish said the page is deliberately read-only (53:05) and *Naveen
accepted that* ("that idea works for us"), on condition the capability exists
somewhere reachable. Ship keyword + pipeline; treat Search Candidate as a stretch.

**Acceptance**
- [ ] Multi-select in keyword results → "Move to requisition" → pick an open JD →
      confirm → outreach email fires.
- [ ] Single-candidate move from the pipeline board to another requisition.
- [ ] A candidate already tagged to requisition A can be re-tagged to B; the
      history of A is retained, not overwritten.
- [ ] Stage-carry semantics behave per
      [decision D-02](03-OPEN-DECISIONS-AND-ACTIONS.md#d-02) — **get this in
      writing before building.** Harish's readback (29:11) says the candidate
      continues from the stage they were at; that needs HR confirmation, since it
      determines whether a final-round candidate lands at final round on the new role.
- [ ] Moving is blocked into closed or on-hold requisitions.
- [ ] Every move writes a stage event with actor, source role and target role.

---

## B-09 · Free-form stage movement (Trello-style pipeline) {#b-09}

**Source:** doc §3 · call 30:59-36:38
**Size:** L — architectural
**🚫 BLOCKED. Do not start.** Harish's condition at 36:57: *"if something needs to
be changed, we need this written in — please share it in the written format so
that everyone will be aware of it, because it changes the architecture."*
Track as [action A-02](03-OPEN-DECISIONS-AND-ACTIONS.md#a-02).

**What HR actually asked for**
- Skip *any* stage, not just the ones flagged optional (Chhaya, 31:26).
- **Return to a skipped stage later** — "after skipping, it should not happen that
  we cannot go back and reconduct it" (35:23).
- Start the process at any stage — the walk-in case where Tech 1 runs first and
  EvalGround follows at the weekend (35:23).
- Both users reached for the same metaphor independently: **Trello cards moving
  between columns** (Naveen 36:38, Chhaya 38:31).

**Why it is architectural — the code confirms Harish's objection**
- [pipeline.service.js:919-941](../../backend/src/services/pipeline.service.js#L919-L941):
  `nextStage = stages[currentIdx + 1]`; `skipOptionalNext` reaches
  `stages[currentIdx + 2]` **only** when `nextStage.is_optional`.
- [pipeline.service.js:1090-1114](../../backend/src/services/pipeline.service.js#L1090-L1114):
  `advanceStage()` is also `currentIdx + 1`.
- There is **no backward transition anywhere in the service.**
- Order is a fixed `sort_order` integer on `rpa_pipeline_stages` (schema.prisma:763).

Consequences to design for, not just the transition itself:
- The stage-event audit trail assumes monotonic arrival — see the reasoning at
  [pipeline.service.js:1957-1977](../../backend/src/services/pipeline.service.js#L1957-L1977),
  where a comment records that an earlier `sort_order >=` test was already wrong
  once skips existed. Re-entering a stage breaks it further.
- Outcome emails are keyed to stage arrival; re-entering a stage must not re-fire
  a "you have progressed to…" mail.
- Scorecard occurrence and assessment-invite logic key off stage identity.
- Dedupe guard at
  [pipeline.service.js:863-864](../../backend/src/services/pipeline.service.js#L863-L864)
  documents a past incident where a stage was skipped with nobody deciding to skip
  it and **two outcome emails went to the candidate.** Any redesign must not
  reopen that.

**Acceptance (once unblocked)**
- [ ] Authorised roles can move a candidate to any active stage, forward or back.
- [ ] Re-entering a previously skipped stage is supported and audited.
- [ ] No duplicate candidate emails on re-entry — regression test the 863-864 incident.
- [ ] The timeline renders a non-linear journey truthfully, including skips and returns.
- [ ] Role permissions decide who may move backwards.

---

## B-12 · Custom date range in Recruitment Analytics {#b-12}

**Source:** call 54:11-54:42, 1:00:02 — **call only**
**Size:** S

Naveen wanted 30/60/365-day and all-time views; only 90 days exists. Chhaya
suggested a calendar picker.

> **Build it in Recruitment Analytics, not the Dashboard.** That was Harish's own
> proposal (1:00:02) — the dashboard is a high-level glance, detail belongs in
> Analytics — and **Naveen accepted it** (1:00:35).

**Touch points:** [Analytics.jsx](../../frontend/src/pages/Analytics.jsx),
`backend/src/services/pipelineAnalytics.helpers.js`,
`backend/src/services/dashboard.service.js`.

**Acceptance**
- [ ] Presets 30 / 60 / 90 / 365 days / All, plus a custom from-to picker.
- [ ] Every tile and chart on the page honours the selected range.
- [ ] The active range is stated on screen so exported/screenshotted numbers
      can't be misread.
- [ ] The Dashboard keeps its fixed 90-day glance and says so on the tile.
