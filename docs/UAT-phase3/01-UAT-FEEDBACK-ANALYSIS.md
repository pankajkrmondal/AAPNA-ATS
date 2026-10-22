# UAT Phase 3 — Feedback Analysis

**Sources:** `Platform Feedback & Required Changes.docx` (Chhaya Verma) and the
10 Sep 2026 UAT call transcript in `MS Access _ Export.docx`.
**Analysed against:** working tree on `project-staging`.

Chhaya and Naveen are the HR/TA users who will own this ATS day to day, so their
feedback is user-acceptance feedback, not a wish list. Harish Mopuri answered
most of it live on the call; **his answers are reproduced verbatim-in-substance
under each point and they change the verdict on five of them.**

---

## Verdict legend

| Marker | Meaning |
|---|---|
| ✅ **No build** | Harish showed the behaviour already exists, is deliberate, or is a staging-only artefact. Needs an explanation back to HR, not code. |
| 🔧 **Build — small** | Contained change, fits before the Abhijit demo. |
| 🏗️ **Build — large** | Schema/architecture change. Needs written sign-off first. |
| 🔍 **Investigate** | Harish could not explain the behaviour on the call. |
| 📝 **Process** | Not a product change — a decision, a document, or a demo step. |

---

# 1. MRF & JD Management

## 1.1 — Hold option in MRF submission 🔧 Build — small *(Chhaya calls it optional)*

**Asked (doc §1.1, call 07:34):** the approval mail to Abhijit / Sangamitra
currently offers only **Approve Request** and **Reject Request**. Add a third —
**Hold Request** — with the same notes box.

Chhaya's reasoning (call 10:08): the request comes from a hiring manager, so the
approver often does not want to *reject* it — he wants to defer it ("open this
after 30th October", "hold it for 3 months"). Today the only way to express that
is a rejection with a note, and the team then has to remember to revisit it —
which will not survive once there are hundreds of rejected requests.

> **Harish clarified (09:30):** we already have pause-position and pause-candidate
> after a position is open, and closing a requisition also exists.
> **Chhaya's answer (09:48):** that is a different stage. Pause/close act on an
> *already-approved* position; Hold has to act at the **approval gate**, before
> the requisition ever opens.

> **Harish clarified (12:57):** "So I just want to confirm — we just need to
> provide on hold and then notes, right? There is no reminder after this month?"
> **Chhaya's answer (13:41): the reminder IS in scope.** After the hold period a
> trigger/reminder goes back to Abhijit asking "would you like to reopen this
> position now?", and at that point he gets **Approve / Reject / Hold further**
> again.

**Current state in code:** `POST /api/mrf/:id/approve`
([mrf.routes.js:72](../../backend/src/routes/mrf.routes.js#L72)) is binary —
[mrf.controller.js:924](../../backend/src/controllers/mrf.controller.js#L924)
does `const isApproved = action.toLowerCase() === 'approve'` and writes
`approval_status: isApproved ? 'approved' : 'rejected'`. The
`approval_status` enum in `schema.prisma:1203` has exactly `pending | approved |
rejected`. Note `rpa_mrf.approval_status` is a plain `String` column
(schema.prisma:212), not the enum type, so adding a value does not force an
enum migration — but the enum should be kept in step.

Useful precedent already in the schema: `rpa_mrf` already carries
`paused_at`, `paused_reason`, `paused_by` and **`resume_on`**
(schema.prisma:227-230). `resume_on` is exactly the "revisit on this date" field
the hold reminder needs — the pattern exists, it just isn't wired to the
approval gate.

**Verdict:** build. Scope = third action + notes + hold-until date + a scheduled
reminder back to the approver. See [backlog B-01](02-BUILD-BACKLOG.md#b-01).

---

## 1.2 — "Position Applied For" — search *and* type ✅ No build *(deprioritise)*

**Asked (doc §1.2, call 11:17):** in the candidate form, the Position Applied For
field is a dropdown only. Add search + free-type.

> **Harish clarified (12:38):** the dropdown is deliberate — "the reason why we
> provided a drop down there is because we only have a limited requisitions open,
> like not more than 5 or 6, so it is easy for the candidate to scroll and just
> select that option." And: **"once it is archived or once it is closed, it won't
> be shown to the candidate whenever they are trying to apply for it."**

That second sentence answers Chhaya's own open question. She had said (11:17)
"we can close the requisition, which means that option will not be visible in the
Position Applied For — **is what my assumption is, correct me if I am wrong**."
**Her assumption is correct.** Harish confirmed it.

Chhaya also noted the form already has an **"Other"** option with free text for
candidates applying against no open position, which covers the type-anything case.

**Chhaya's own closing position (14:15):** "if you think the search and type
option will not take much of the effort, let's keep it there. If it is difficult,
then we can make sure our recruiter closes that particular requisition."

**Verdict:** no build for Phase 3. The list stays short because closed
requisitions drop out automatically, and "Other" handles the rest. Revisit only
if the open-requisition count grows past ~15. Reply to Chhaya confirming her
assumption was right.

---

## 1.3 — Closing a requisition should archive its JD ✅ No build *(confirm back)*

**Asked (doc §1.3):** check whether closing a requisition also archives the JD —
many JDs exist and the team should see only current/active ones.

> **Harish clarified (09:38-09:48 and 12:57):** closing a requisition already
> exists, and a closed/archived JD is no longer shown to candidates.

**Current state in code:** closure is modelled properly and deliberately kept
separate from approval —
[mrf.controller.js:971-978](../../backend/src/controllers/mrf.controller.js#L971-L978)
records the design decision: *"These deliberately do NOT touch approval_status or
rpa_mrf_jd_send.mrfstatus … Closure lives in `closed_at`."* Fields `closed_at`,
`closure_reason`, `closure_note` exist on `rpa_mrf` (schema.prisma:223-226), with
a closure-reason vocabulary served by `GET /api/mrf/closure-reasons` and
`mrfClosure.service.js`.

**Verdict:** behaviour is already what Chhaya asked for. What is genuinely
missing is **visibility** — see 2.1 below, which is the same issue seen from the
recruiter's side.

---

## 1.4 — Date / version against each JD 🔧 Build — small

**Asked (doc §1.4, call 14:15-17:33):** multiple MRFs will carry the same
position name (".NET Developer" four times over, for different projects). On the
**Candidate Screening → JD filtering** page there is no way to tell which JD
belongs to which MRF, or which is the latest.

> **Harish asked (16:21):** "at what place exactly are you referring to — is it in
> the screening page?"
> **Chhaya confirmed (16:27):** yes, the screening page, JD filtering. The MRF
> name typed by the hiring manager flows straight through, and "our HM is not
> smart enough" to keep names distinct — he will type `.NET Developer` when four
> already exist.

Chhaya's acceptance bar is low and explicit (17:11): *"some date or something…
some option where we can even modify the name, or put some underscore-date, or
some reference ID. **We are even fine with some manual intervention**, writing
something — but it's better if it comes automatically."*

Doc §1.4 adds: where there is **no MRF**, the recruiter should be able to
modify/add the date shown against the JD.

**Current state:** `rpa_mrf` has `created_at` (schema.prisma:211) and `filled_at`
(223) — the data to show a date already exists; it is simply not rendered in the
JD picker.

**Verdict:** build. Display `MRF #<id> · <created date>` alongside the JD name in
the screening JD selector, plus an editable label for MRF-less JDs.
See [backlog B-02](02-BUILD-BACKLOG.md#b-02).

---

## 1.5 — Bulk / individual uploads must be tagged to a JD 🏗️ Build — large **(MANDATORY)**

**Asked (doc §1.5, call 17:47):** this is the one item Chhaya marked mandatory and
called *"the major major flaw that we have felt in the process."*

> "Uploading of these Excel bulk files is being done individually. It is not
> against any JD which is posted. Ideally in any ATS, there has to be a JD and
> against that JD those profiles are filled … that option is not there, and even
> if we feel that the AI itself will take it up, that is not working to that
> extent."

Profiles uploaded via Excel/bulk upload **and** individual upload should be
auto-tagged to the selected JD and be filterable by JD.

> **Harish clarified (19:27):** "the reason why it is not there is because it was
> not communicated before. While uploading there was no such request that we need
> to have that JD mapped to those particular profiles … **the focus was on whether
> we are matching the duplicate or not, the focus was not on the JD mapping.**"

Chhaya accepted that framing without argument (19:55): *"I completely understand
— as you are creating this software for the first time, we are also working with
you for the first time… this is the missing element, which maybe has been missed
from our part also."*

So this is **a new requirement, not a defect**. It is still the highest-value item
in the pack, because without it the JD→candidate link that the rest of the
feedback depends on (1.6, 2.2, 5) does not exist in the data.

**Current state in code:** `hrUpload.service.js` has no MRF/JD reference at all —
a scan for `mrf|jd_|role` returns a single unrelated `role: user.role` line.
Uploads land in `rpa_cv` with no requisition foreign key. The only place a
candidate gets attached to an MRF today is at shortlist time, via
`rpa_shortlisted_candidates.mrf_id` (schema.prisma:239).

**Verdict:** build, and treat as the anchor item of Phase 4 (or late Phase 3 if
the demo date allows). See [backlog B-07](02-BUILD-BACKLOG.md#b-07).

---

## 1.6 — JD filtering should show profiles matching the JD 🔗 *(covered by 1.5 + 1.7)*

**Asked (doc §1.6, call 17:47):** JD filtering should display the profiles that
match the selected JD. Chhaya's evidence: *"a profile with a Python person is
available in Search Candidate, but in the JD filtering it is not appearing."*

> **Harish clarified (20:19):** "the score is a crucial part in the JD filtering.
> We have a lot of rules … we have kept strict rules — if the CTC is high, if the
> experience is high … So if the candidate is not showing here, **it does not mean
> the AI skipped it. It means the candidate is not matching the profile.**"

That is a legitimate explanation, but it is unverifiable by HR until they can see
the rules — which is why Harish offered (24:08) to **share the scoring-rules
document** for JD filtering and keyword filtering so Chhaya can read them and
propose modifications. Pankaj repeated the request (49:05).

**Verdict:** the missing piece is not primarily code, it is the shared scoring
document plus the JD-tagging link from 1.5. Once profiles are tagged to a JD, the
"why isn't my candidate here" question has a deterministic answer. Track the
document as [action A-01](03-OPEN-DECISIONS-AND-ACTIONS.md#a-01).

---

## 1.7 — Wrong/low-relevance profiles scoring high 🔍 Investigate + 🔧 Build — small

**Asked (doc §1.7, call 21:34 and 43:29):** a QA-Automation-.NET profile shows
**6.13/10 (High Match)** while a candidate who genuinely matches the JD scores
lower. Naveen walked the screen live: the JD's skills list contains nothing about
QA; a candidate with Selenium/Python/API-testing/Jenkins ranks *below* one whose
key skills show no .NET at all.

> **Harish clarified (44:12 and 47:50):** the score comes from resume text, not
> just the skills field — "the candidate may mention .NET or C# **in the resume,
> not in the skills**." Opening the candidate detail shows the per-parameter
> breakdown: *"this JD skill match — the .NET is there … I think this matched
> `net` instead of `dot`"* — and separately, `Azure` appears 4 times and `AWS` 14
> times in that resume, which lifted the good-to-have score.

**That answer contains a real, actionable defect.** Harish's own words —
*"I think this matched `net` instead of `dot`"* — describe a substring match:
the token `net` is matching inside unrelated words, so a resume with no .NET
experience earns .NET credit. Pankaj found the same class of problem in the QA
tag (47:06): the word "QA" was picked up from the phrase *"QA alignment with
proper goal"* in a bullet, not from any QA skill.

**Current state in code:** the keyword matcher is
`matchKeywordTerms()` at
[screening.service.js:433](../../backend/src/services/screening.service.js#L433)
and the role-skill matcher at
[screening.service.js:365-372](../../backend/src/services/screening.service.js#L365-L372),
which scores with `skill.includes(kw) || kw.includes(skill)` — bidirectional
substring containment with no word-boundary guard. `net` ⊂ `Jenkins`,
`.NET` ⊃ `net`, `QA` ⊂ any word containing those letters. This is the mechanism
behind both of the examples HR raised.

**Verdict:** two threads.
1. 🔧 **Fix token matching** — require word boundaries / normalised token equality
   for short terms. [backlog B-03](02-BUILD-BACKLOG.md#b-03).
2. 🔍 **Re-check the specific profiles** HR named (Pankaj Mondal on the Python JD;
   Nihar Naik) once the fix is in, and confirm the ranking inverts back.

Note also Harish's caveat (45:21): *"there are some profiles, Naveen and Chhaya,
that we intentionally screened for testing purposes"* — some of what HR saw in
staging is seeded test data. Worth stating plainly so it isn't re-reported.

---

## 1.8 — Fresher profiles rated too high 🔧 Build — small

**Asked (doc §1.8, call 23:52):** *"Rating of freshers is also very high, which is
not matching with the criteria."* Freshers outside the JD's experience band should
score materially lower; the rating must reflect the **mandatory** JD criteria.

**Current state:** experience is one averaged component among many —
`screening.service.js` builds a `scores[]` array (skill match, education,
experience fit, CTC fit, job stability, notice period) and takes a flat mean.
A fresher failing the experience gate loses one component out of six, so a
0/10 on experience still leaves a ~6/10 overall — which is exactly the "6.13 High
Match" symptom HR reported.

**Verdict:** build. Make mandatory-criteria failure a **gate or a weighted
penalty** rather than one averaged term. This is the same root cause as 1.7's
ranking complaint and should ship with it. [backlog B-03](02-BUILD-BACKLOG.md#b-03).

---

# 2. Candidate Screening & Pipeline

## 2.1 — QA Automation tag missing in Screening but present in Pipeline ✅ No build *(add an affordance)*

**Asked (doc §2.1, call 24:18):** searching JD filtering for "QA" returned nothing
— everything was Python — yet QA Automation existed in the Candidate Pipeline.

> **Harish clarified (24:53):** "there were 2 open positions for QA Automation
> when we were testing it. Pankaj was one guy and Harish was another, both at
> offer stage. **Once both accepted the offer, the position closes
> automatically**" — so it drops out of Screening. "But in the pipeline it will be
> visible because the candidates are still there … we kept the candidate pipeline
> open so you can still continue with the interviews for any candidates. If you
> think that candidate is having potential, you can still take them into the offer
> stage."
>
> **Chhaya accepted it on the spot (25:05):** "Okay, so because of closing it is
> not appearing in JD. Got it, got it."

**Verdict:** **not a defect and not an inconsistency** — it is the documented
behaviour of auto-closure on offer acceptance. Doc §2.1's request to "make the
tagging options consistent across both sections" should **not** be implemented as
written; doing so would undo a deliberate design.

What *is* worth adding is a small affordance so the next recruiter doesn't hit the
same confusion: a **"Show closed requisitions"** toggle (or a `Closed` badge) in
the JD filter, so a vanished JD is visibly closed rather than apparently missing.
[backlog B-04](02-BUILD-BACKLOG.md#b-04).

---

## 2.2 — Move a candidate to a JD / position 🏗️ Build — large

**Asked (doc §2.2, call 25:36-30:24, 50:05):** candidates cannot be moved from
**Search Candidate** or **Keyword Search** to a specific JD/position.

Two distinct scenarios were described, and they are not the same feature:

**(a) Bulk re-targeting.** Chhaya (26:38): a Python Engineer requisition closed;
Kapil opens QA Automation; 200-400 already-in-database Python candidates would fit.
HR wants to move that whole set onto the new JD and fire the outreach mail at them
in one action.

**(b) Individual move mid-pipeline.** Naveen (28:22): a candidate at final round
for QA Automation, and a contract role opens today — move that one candidate
across, "either by searching that candidate, or going to that role and moving the
candidate to that role." Harish restated it back (29:11) and got confirmation:
the candidate carries forward from whatever stage they're at, and is notified.

> **Harish clarified (30:24):** *"In keyword filtering, I think it is there"* —
> if you search a role and 400 profiles come back, **you can already map them all
> in one go** to that open JD and it sends the outreach emails. **"But once it is
> tagged, yeah, it is not there."** The gap is **re-tagging** a candidate who is
> already mapped to a requisition. *"We will note it down right now."*

> **Harish clarified (53:05), on Search Candidate:** "No, you don't have [it] —
> the idea is to restrict this page to just see the candidate details."
> **Naveen conceded (53:07): "that's okay, that idea works for us"** — but then
> insisted the capability must live *somewhere* reachable, "so or maybe on the
> keywords." His worked example (53:52): Shweta receives a profile by mail and
> needs to push it onto a role without hunting through JD filtering.

Chhaya's stated want (28:51) is all three surfaces — Search Candidate, Keyword
filtering, Pipeline. Naveen's concession makes Search Candidate negotiable.

**Current state:** `POST /api/screening/shortlist`
([screening.routes.js](../../backend/src/routes/screening.routes.js)) is the
existing tag-to-MRF path, writing `rpa_shortlisted_candidates.mrf_id`. There is no
re-assign path, and `rpa_candidate_pipeline.mrf_id` (schema.prisma:695) is set at
creation.

**Verdict:** build, prioritising **re-tag / move-to-requisition** since fresh bulk
tagging already works. Decide the transfer semantics — does the candidate keep the
stage they reached, or restart? (Harish's 29:11 readback says keep; get it in
writing.) [backlog B-08](02-BUILD-BACKLOG.md#b-08) and
[decision D-02](03-OPEN-DECISIONS-AND-ACTIONS.md#d-02).

---

# 3. Flexible interview / assessment stages 🏗️ Build — large **(written sign-off required)**

**Asked (doc §3, call 30:59-36:38):** allow authorised users to skip any stage —
HR Screening → EvalGround, HR Screening → Functional, Assessment → CEO Round.

Chhaya's position hardened over the conversation:
- (31:26) *"No — at every stage we want a skip-this-stage option at every stage."*
- (35:23) skipping must be **reversible**: EvalGround skipped, Functional run
  first, then come back and run EvalGround. *"After skipping, it should not happen
  that we cannot go back and reconduct it."*
- (36:38 / 38:31) Naveen and Chhaya both landed on the mental model: **Trello** —
  *"jaise Trello mein cards move hote hain"* — cards moving freely between columns.
- Walk-in example (35:23): Tech-1 happens first, EvalGround over the weekend. So
  the process can legitimately *start* at Tech 1.

> **Harish clarified (31:26):** skipping exists today but is **restricted to the
> rounds marked optional** — "Tech round 3 is optional, and client round is
> optional."
> **Harish clarified (33:10), on the three assessment stages:** skipping is **not**
> available for Zeko HR / EvalGround / Zeko Functional — "it is mandatory for
> everyone to attend this, because it was finalised before the development work."
> **Harish clarified (33:45), on HR screening without a Zeko score:** *"Yes, it is
> possible"* — HR can already approve HR Screening with no score present.
> **Harish clarified (32:29, 36:38):** "it will change the architecture again …
> we kept it constant, the rounds are fixed here itself."
> **Harish's condition (36:57) — the important one:** *"if something needs to be
> changed, we need this written in. Please share it in the written format so that
> everyone will be aware of it, because it changes the architecture."*

**Current state in code — Harish's description is accurate.** Advancement is
strictly forward-by-one:
[pipeline.service.js:919-941](../../backend/src/services/pipeline.service.js#L919-L941)
resolves `nextStage = stages[currentIdx + 1]`, and `skipOptionalNext` only jumps
to `stages[currentIdx + 2]` **and only when `nextStage.is_optional` is true**.
`advanceStage()` at
[pipeline.service.js:1090](../../backend/src/services/pipeline.service.js#L1090)
is likewise `currentIdx + 1`. Stage order is a fixed `sort_order` on
`rpa_pipeline_stages` (schema.prisma:763), with an `is_optional` flag. There is
**no backward transition and no arbitrary jump** anywhere in the service. Making
the board Trello-like means reworking stage transition, the stage-event audit
trail, the outcome-email triggers keyed to stage arrival, and the scorecard
occurrence logic.

**Chhaya offered two workarounds herself** (34:07, 40:06) precisely so the
architectural change need not block go-live:
1. She will **enter the HR screening score manually** ("I am even open for writing
   the HR screening score on my own — 3 out of 5 — I approved at this stage").
   This already works per Harish's 33:45 answer.
2. If the CEO round happens first, **record it as Tech 1** with a note attributing
   it to Abhijit.

And her explicit fallback position (40:06): *"considering it as a whole and soul
software, if skip-any-stage and toggle-back is possible, that is **good to have**."*
Pankaj set the rule (39:57): anything achievable in 2-4 hours **without structural
change** goes in now; the rest is Phase 4.

**Verdict:** split it.
- **Phase 3 now** 🔧 — widen the existing optional-skip to cover the stages HR
  actually needs to bypass, and surface "approve with manually entered score" in
  the UI so workaround #1 is discoverable. [backlog B-05](02-BUILD-BACKLOG.md#b-05).
- **Phase 4** 🏗️ — free-form stage movement with backward transitions.
  **Do not start until HR sends the written requirement Harish asked for.**
  [backlog B-09](02-BUILD-BACKLOG.md#b-09) and
  [action A-02](03-OPEN-DECISIONS-AND-ACTIONS.md#a-02).

---

# 4. Interview host visibility ✅ No build *(staging artefact — verify in production)*

**Asked (doc §4, call 40:46):** the interview **host** should see all interviews
scheduled with them — candidate, date, time, stage. Naveen scheduled an interview
and could not see it; only the interviewer/interviewee got the accept/reject
invite. Chhaya asked whether a CC could fix it.

> **Harish clarified (41:21):** *"It is there — because it is in staging, it is
> going from Pankaj's account. But once it is live, it will be going into the
> organizer."*
> **Chhaya accepted (41:26):** "Okay, got it. So then the host can see this, okay?"
> **Harish: "Yes."**

In staging every Graph calendar event is created from the single shared mailbox,
so the organiser is always Pankaj's account rather than the actual host — the host
therefore has no event on their own calendar. In production the event is created
as the real organiser and lands on their calendar natively.

**Verdict:** **no code change.** But this must be *proven*, not asserted — it is
the one item whose resolution depends entirely on an environment difference.
Add it as a production smoke test. [action A-03](03-OPEN-DECISIONS-AND-ACTIONS.md#a-03).

---

# 5. Keyword search must show name, email, contact 🔧 Build — small

**Asked (doc §5, call 41:33):** keyword filtering should display Candidate Name,
Email ID and Contact Number, the way Search Candidate does.

> **Harish's first answer (41:54):** "It is there inside the candidate details —
> once we open the candidate on the second page you can see all of the details."
> **Chhaya pushed back (42:06) and the reason matters (49:40):** the point is not
> *viewing* one candidate, it is **acting on many**. "The idea was to move the
> candidate from here also … we wanted in keyword filtering these 3 things should
> also be here **so that those candidates can be moved directly from there**."
> **Naveen (42:39):** "if you want to move any candidate based on the email ID —
> we didn't even know where the candidate was."

So §5 is not a cosmetic request. It is the **selection surface for §2.2's bulk
move**: you cannot confidently multi-select candidates to re-target if the rows
don't identify who they are.

**Current state:** the data is already fetched — the keyword query at
[screening.service.js:1326](../../backend/src/services/screening.service.js#L1326)
selects `c."Name"`, `c."EmailID"`, `c."ContactNumber"`. This is purely a
result-row rendering change in Candidate Screening's keyword tab.

**Verdict:** build, and ship it **with or before** B-08 since it is that feature's
UI prerequisite. [backlog B-06](02-BUILD-BACKLOG.md#b-06).

---

# 6. Sidebar / module reordering 🔧 Build — small

**Asked (doc §6, call 50:19-51:59):** reorder the left navigation to:

```
Dashboard → MRF → Search Candidate → HR Manual Upload → Vendor Upload
→ Vendor Dashboard → Candidate Screening → Candidate Pipeline
→ Recruitment Analytics → Email Templates → Settings
```

Chhaya's framing (50:19): *"this is something Abhijit will also ask"* — he reviews
from a UI/UX angle, so she wants it fixed **before Tuesday's demo**, and staging is
fine. She also conceded (50:45) that Search Candidate is arguably a lens rather
than a module, "but that is a UI need from using it as in-house software — fine
with us."

> **Harish clarified (51:09):** Search Candidate has grown beyond a lookup —
> "you can see all of the database candidates at one go, and if you want to do
> filtering you can do that … so it should be there in the left side."
> **Harish agreed (51:53): "Sure, definitely."**

**Current state:** `MENU_ITEMS` at
[MainLayout.jsx:67-88](../../frontend/src/layouts/MainLayout.jsx#L67-L88).
Current order is Dashboard → Search Candidate → **HR Manual Upload → MRF** →
Vendor Upload → Candidate Screening → Candidate Pipeline → Analytics → Email →
Settings. Vendor Dashboard is injected separately for
`VENDOR_DASHBOARD_ROLES` at line 135-136, so it must be spliced into the right
slot rather than appended.

Net delta: **MRF moves up two places** (to position 2), and **Vendor Dashboard is
positioned after Vendor Upload** instead of being appended.

**Verdict:** build — a reorder of one array plus the Vendor Dashboard splice
point. Lowest-effort, highest-visibility item in the pack.
[backlog B-10](02-BUILD-BACKLOG.md#b-10).

---

# 7. Raised only on the call — not in the feedback document

These came from Naveen's live screen-share and are **not** in
`Platform Feedback & Required Changes.docx`. They still need answers.

## 7.1 — Dashboard talent-insight counts don't reconcile 🔍 Investigate

**Naveen (54:42-56:05):** on the 90-day dashboard view, Skills showed
`Python 5`, `TestNG 4`, `MS Office 3`, `Selenium 2`. The info tooltip reads
*"based on 200 most recent candidates"* — but the numbers total ~20.
Separately, one tile showed **184 candidates for RPA** while another showed **9**.

> **Harish (55:11):** pointed to the info icon explaining the basis.
> **Harish (55:37, 56:03):** on the 200-vs-20 mismatch — "yeah, whatever it is" /
> "might be, yes." **Not actually resolved.**
> **Harish (56:18), on 184 vs 9:** *"We'll look into this once again. Not sure why
> it is showing."*
> **Harish (56:29), attempting an explanation:** the 184 is applications where the
> candidate themselves chose RPA Developer in "position applied for" — a different
> population from the other tile.

Two different populations shown adjacently with no labelling is a reporting defect
even if each number is individually correct.

**Verdict:** investigate both. Either reconcile the numbers or label each tile with
its population and window. [backlog B-11](02-BUILD-BACKLOG.md#b-11).

## 7.2 — No custom date range on the dashboard 🔧 Build — small *(or defer)*

**Naveen (54:11):** only a 90-day view exists — he wants 30/60/365 days or all
candidates. **Chhaya (54:35):** "maybe a calendar where we can pick custom dates."

> **Harish (54:36):** "No, not yet."
> **Harish (1:00:02) — the scoping answer:** *"this is just a high-level point
> that we have added in the dashboard. If that is required in detail, we can add
> it in the **Recruitment Analytics** page where you can see all of these things
> in one place. This screen is just to see, on a high level, what is happening."*
> **Naveen accepted (1:00:35):** "Okay, got it, got it. That's why it was not
> showing those things — I was a bit confused."

Note Harish's admission at 1:00:32 that the dashboard was designed in-house
without an HR requirement: *"Yes, we made it ourselves."* Pankaj made the same
point forcefully at 57:37-58:58 — the team cannot build to an unstated requirement,
so UI expectations must arrive as a written document.

**Verdict:** add the date-range selector to **Recruitment Analytics**, not the
dashboard, per Harish's own proposal and Naveen's acceptance.
[backlog B-12](02-BUILD-BACKLOG.md#b-12).

## 7.3 — Candidate "date added" is not visible anywhere 🔧 Build — small

**Naveen (57:10-57:31):** asked when a candidate was added. The screen showed
*shortlisted on 31 August*; the **date the candidate entered the database** is not
displayed. He is confident the original Excel specification carried a date column
(1:01:13, 1:02:14) and asked the team to re-check whether it was dropped.

> **Harish (57:31):** "right now we can't see it here — we can see it in the upload
> itself."
> **Harish (1:01:37, 1:02:14):** "I couldn't recall it. **I will check it once.**"
> **Harish (1:04:11) confirmed the semantics:** "so this date will be added as date
> of upload?" **Naveen: "the date of addition of the candidate."**
> **Pankaj (1:02:35):** agreed to check whether it was missed from the original spec.

**Current state:** the data exists. `rpa_cv` carries `createdAt` and `modifiedAt`
(schema.prisma:111-112). This is a display-only gap.

**Verdict:** build — surface `rpa_cv.createdAt` as **Date Added** in Search
Candidate, keyword results and the candidate detail header, and allow sorting by
it. [backlog B-13](02-BUILD-BACKLOG.md#b-13). Also close Naveen's question by
re-reading the original intake Excel — [action A-04](03-OPEN-DECISIONS-AND-ACTIONS.md#a-04).

---

# Roll-up

| # | Item | Verdict | Size | Phase |
|---|---|---|---|---|
| 1.1 | Hold option in MRF approval (+ reminder) | 🔧 Build | S-M | 3 |
| 1.2 | Position Applied For — search & type | ✅ No build | — | — |
| 1.3 | Close requisition archives JD | ✅ No build | — | — |
| 1.4 | Date/version against each JD | 🔧 Build | S | 3 |
| 1.5 | **Upload → JD tagging** | 🏗️ Build | **L** | 3/4 |
| 1.6 | JD filtering shows matching profiles | 📝 + 🔗 1.5 | — | 3 |
| 1.7 | Wrong profiles scoring high (`net`/`QA` substring) | 🔍 + 🔧 Build | M | 3 |
| 1.8 | Fresher rating too high | 🔧 Build | M | 3 |
| 2.1 | QA tag in Pipeline not Screening | ✅ No build (+ affordance) | S | 3 |
| 2.2 | Move/re-tag candidate to a JD | 🏗️ Build | L | 4 |
| 3 | Skip any stage / move freely | 🔧 now + 🏗️ later | S + L | 3 + 4 |
| 4 | Interview host visibility | ✅ No build (verify in prod) | — | 3 |
| 5 | Keyword search shows name/email/phone | 🔧 Build | S | 3 |
| 6 | Sidebar reorder | 🔧 Build | XS | 3 — **before demo** |
| 7.1 | Dashboard counts don't reconcile | 🔍 Investigate | M | 3 |
| 7.2 | Custom date range | 🔧 Build (Analytics) | S | 4 |
| 7.3 | Candidate "date added" | 🔧 Build | S | 3 |

**Five items need no development** (1.2, 1.3, 2.1, 4, and the already-working half
of 2.2 and 3) — they need a written reply to Chhaya and Naveen confirming what
Harish explained on the call, so the same points are not re-raised in the next UAT
round.
