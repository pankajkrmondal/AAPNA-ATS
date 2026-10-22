# UAT Phase 3 — Open Decisions, Actions & Demo Logistics

Everything from the 10 Sep 2026 UAT call that is **not** a code change: answers
owed back to HR, decisions that block development, documents that were promised,
and the demo/sign-off plan.

---

# A. Actions committed on the call

## A-01 · Share the scoring-rules document with Chhaya {#a-01}
**Owner:** Harish · **Promised at:** 24:08, reiterated by Pankaj at 49:05-49:37
**Blocks:** [B-03](02-BUILD-BACKLOG.md#b-03) validation, and doc §1.6's resolution

> **Harish (24:08):** "We can share the rules that we have kept for JD filtering
> and keyword filtering, so you can read those rules — and if you think some
> modification is required, we can modify that."
> **Pankaj (49:23):** Chhaya should edit the document, add her analysis, and send
> back how she wants it to go forward.

This is the actual answer to §1.6 ("why isn't my Python candidate in JD
filtering"). Harish's explanation — strict scoring rules, not a skipped
candidate — is unverifiable by HR until they can read the rules.

- [ ] Send the JD-filtering and keyword-filtering scoring rules to Chhaya and Naveen
- [ ] Ask for edits/annotations back rather than approval
- [ ] Fold the agreed changes into [B-03](02-BUILD-BACKLOG.md#b-03)

---

## A-02 · Get the stage-flexibility requirement in writing {#a-02}
**Owner:** Chhaya / Naveen · **Requested by Harish at:** 36:57
**Blocks:** [B-09](02-BUILD-BACKLOG.md#b-09) — do not start development without it

> **Harish (36:57):** "If something needs to be changed, we need this written in.
> Please share it in the written format so that everyone will be aware of it,
> **because it changes the architecture.**"

Doc §3 as written ("can the system provide an option to skip stages when
required?") is not sufficient — the call revealed the real requirement is much
larger: skip *any* stage, **return to skipped stages**, and start the process at
an arbitrary stage. The written requirement must cover:

- [ ] Which stages may be skipped, by which roles
- [ ] Whether a skipped stage can be re-entered, and who authorises it
- [ ] Whether a pipeline may *start* at a non-first stage (the walk-in case, 35:23)
- [ ] What the candidate is told on each non-linear transition — this is where the
      duplicate-email incident recorded at
      [pipeline.service.js:863-864](../../backend/src/services/pipeline.service.js#L863-L864)
      came from
- [ ] Whether the Trello metaphor (36:38, 38:31) means free drag between all columns
      or a constrained set of legal transitions

**Same rule applies to the dashboard.** Pankaj made the point directly (57:37,
58:29, 58:58): UI expectations that never arrived as a requirement cannot be
delivered against. Naveen accepted it (59:19) while noting he was cross-checking
against what was already on screen, not inventing new scope.

---

## A-03 · Verify interview host visibility in production {#a-03}
**Owner:** Harish / Pankaj · **Claimed at:** 41:21
**Resolves:** doc §4 — **without code**

> **Harish (41:21):** "It is there — because it is in staging it is going from
> Pankaj's account, but once it is live it will be going into the organizer."

This is the only item whose resolution depends entirely on an environment
difference, so it must be **proven, not asserted**.

- [ ] After production deploy, have a host other than Pankaj schedule an interview
- [ ] Confirm the event appears on **that host's** own calendar with candidate,
      date, time and stage
- [ ] Confirm the interviewer and candidate invites are unaffected
- [ ] Report the result to Chhaya and Naveen in writing and close §4

If it does **not** behave this way in production, §4 becomes a real build item and
Chhaya's suggested fallback (41:05, "let us know if any CC or something can work
here") is the starting point.

---

## A-04 · Re-check the original intake Excel for a date column {#a-04}
**Owner:** Harish + Pankaj · **Promised at:** 1:01:37, 1:02:14, 1:02:35
**Relates to:** [B-13](02-BUILD-BACKLOG.md#b-13)

Naveen believes the originally shared Excel specification carried a **date**
column that did not make it into the build: *"the date column was there — did you
see that? … that should be the first column, introduction sheet."*

> **Harish (1:01:37):** "I couldn't recall it. I will check it once."
> **Pankaj (1:02:35):** agreed to check whether something was missed on their side.

- [ ] Re-read the original intake Excel and confirm whether a date column was specified
- [ ] Report back either way — if it *was* specified, say so plainly; Naveen raised
      it carefully and explicitly allowed that he may have failed to share it
- [ ] Either way, [B-13](02-BUILD-BACKLOG.md#b-13) delivers the field

---

## A-05 · Written reply closing the five no-build items {#a-05}
**Owner:** Pankaj / Harish · **Suggested**

Five points in the feedback pack need an explanation, not code. Without a written
reply they will be re-raised at the next UAT round.

| Point | What to tell HR |
|---|---|
| §1.2 Position Applied For | The dropdown is deliberate (≤ 5-6 open requisitions); **Chhaya's own assumption was correct** — closing a requisition removes it from the candidate form; "Other" covers anything unlisted |
| §1.3 Close requisition archives JD | Already the behaviour; closure is tracked in `closed_at` separately from approval, by design |
| §2.1 QA tag in Pipeline not Screening | Not an inconsistency — the requisition auto-closed when both offers were accepted; the Pipeline deliberately stays open so recruiters can keep working existing candidates. A "show closed requisitions" toggle is being added so it reads correctly next time |
| §4 Interview host visibility | Staging-only artefact; verified in production per [A-03](#a-03) |
| §3 partial | HR Screening can **already** be approved without an assessment score (Harish, 33:45) — which is exactly the workaround Chhaya proposed at 40:06 |

Also worth stating: **some staging profiles are seeded test data.** Harish
mentioned it in passing (45:21) — *"there are some profiles that we intentionally
screened for testing purposes"* — and it explains part of what HR saw while
spot-checking match quality.

---

# B. Decisions blocking development

## D-01 · Is the MRF hold reminder in scope for Phase 3? {#d-01}
**Blocks:** [B-01](02-BUILD-BACKLOG.md#b-01) sizing (S without it, M with it)

Harish asked the question directly (12:57): *"we just need to provide on hold and
then notes, right? There is no reminder after this month?"* — and Chhaya's answer
(13:41) put the reminder **in** scope: a trigger goes back to Abhijit after the
hold period offering reopen / reject / hold further.

Recommendation: **build both.** A hold with no reminder recreates the exact
"we will forget about it" failure Chhaya described at 10:33, and `rpa_mrf` already
has `resume_on` (schema.prisma:230) to hang the reminder on.

- [ ] Confirm with Chhaya, then size B-01 accordingly

---

## D-02 · What happens to a candidate's stage when they move requisition? {#d-02}
**Blocks:** [B-08](02-BUILD-BACKLOG.md#b-08)

Harish read the scenario back at 29:11 — candidate at offer stage for QA
Automation, a new position opens, move them across — and his readback implies the
candidate **continues from where they were** ("it will go forward from there,
right, at whatever the position might be"). Chhaya did not contradict it, but she
did not confirm it either; she redirected to the bulk case (29:45).

That leaves a materially different outcome unresolved, and it changes the build:

- **Option A — carry the stage.** A final-round candidate lands at final round on
  the new role. Fast, but the new role's earlier rounds were never run.
- **Option B — restart at shortlisted.** Safe and auditable, but wastes the
  assessment history HR wanted to reuse.
- **Option C — recruiter picks the landing stage per move.** Most flexible;
  requires the permission model from [B-09](02-BUILD-BACKLOG.md#b-09).

- [ ] Get HR's answer in writing before B-08 starts
- [ ] Separately confirm the **bulk** case (26:38) always starts fresh at outreach,
      since those candidates were never in a pipeline for the new role

---

## D-03 · Which stages become `is_optional`? {#d-03}
**Blocks:** [B-05](02-BUILD-BACKLOG.md#b-05)

Today only Tech 3 and Client Round are optional (Harish, 31:26); Zeko HR,
EvalGround and Zeko Functional are mandatory "because it was finalised before the
development work" (33:10). B-05 proposes flipping the flag on the stages HR
actually needs to bypass — a data change on `rpa_pipeline_stages`, not code.

- [ ] Confirm the list with Chhaya: EvalGround? Zeko Functional? CEO round?
- [ ] For each newly-optional stage, verify the outcome-email trigger and
      scorecard logic behave when it is skipped **before** flipping the flag
- [ ] Note that this is a stopgap — the real answer is [B-09](02-BUILD-BACKLOG.md#b-09),
      gated on [A-02](#a-02)

---

# C. Demo and sign-off

## C-01 · Demo on staging, not production
**Agreed by:** Chhaya (01:28, 05:37), Pankaj (03:52), Naveen (04:15)
**Open:** needs Rakhi ma'am's / Sangamitra's confirmation — Harish asked for it at
03:02, Pankaj asked Chhaya and Naveen to confirm at 1:03:16

Reasoning, from Chhaya (05:37): feedback and changes belong in a testing
environment. *"Once you put it in production and he says he wants it differently,
going back to change it is worse than showing it in staging."* And (01:28):
staging keeps everything under the team's own control for the walkthrough.

Also agreed:
- Keep production open alongside — Abhijit may want to click into things himself
  (Chhaya, 01:28). Either create him a staging credential or let him use production.
- Full end-to-end story from staging, not phased fragments (Chhaya, 01:28).
- Close with a one-liner stating what is live today vs what lands this week
  (Chhaya, 01:28, 05:37).
- Naveen (04:57): if useful, show that **99,000+ candidates** are already loaded.

- [ ] Confirm with Rakhi ma'am / Sangamitra before the demo
- [ ] Decide: staging credential for Abhijit, or production for his hands-on clicks

---

## C-02 · Pre-fill the pipeline so the demo fits the meeting
**Raised by:** Harish (1:04:22, 1:05:03, 1:05:14) · **Solved by:** Chhaya (1:04:49-1:06:43)

> **Harish:** "the pipeline stage will take a lot of time if we want to show a role
> play … **it took us half a day to test the entire pipeline from our end.**"

Chhaya's plan, which resolves it:
- Approve straight through so the candidate reaches the final stage quickly (1:04:49)
- Keep **one pre-filled interview feedback form** open in the background. The Tech 1
  / Tech 2 / Tech 3 form is the same form — only the stage name changes — so one
  filled copy covers every round (1:06:05)
- At each stage: open the filled form, toggle, approve, move on. Do not fill live (1:05:37)
- The purpose is to complete the pipeline end to end, not to demo data entry (1:06:43)
- HR will supply a filled form if needed (1:08:36); Pankaj has taken enough real
  interviews to fill a representative sample (1:08:44)
- If Abhijit interrupts with a question, take it then (1:04:49)

- [ ] Prepare one filled scorecard per stage type before the demo
- [ ] Dry-run the click path once end to end

---

## C-03 · Written sign-off on Phase 1 and Phase 2
**Raised by:** Harish (1:06:56) — *"we need some written approval on phase 1 and 2,
because Anuj reached out to me regarding this."*

> **Chhaya (1:07:09):** already mailed Anuj **yesterday** (9 Sep, late evening),
> without Harish in CC. The mail covered: phase 1 and 2 live; MRF hiring-manager
> flow and MRF approval; 3 MRFs shown, of which Ragini's and one other are live;
> resume uploads (approved / awaiting screening); ~200 new candidates uploaded;
> 2 active MRFs; and that stage 3 — the full interview process — has been tested
> in staging.
> **Harish (1:07:30):** Anuj messaged again today wanting a simple usage report.

- [ ] Ask Chhaya to forward the 9 Sep mail to Anuj with Harish in CC — it already
      contains what Anuj is asking for
- [ ] **Add Anuj to the Abhijit demo call** — Chhaya's suggestion (1:07:41), since
      his follow-up was about when the Phase 3 demo happens

---

## C-04 · Go-live sequencing
**Agreed:** Chhaya (1:09:06, 1:09:25)

> "I will communicate to ma'am that you guys will show it in the staging
> environment, and once we receive a confirmation, **the next day itself it will be
> live** … if you feel that on Monday we can make it live, we are pretty much open."

Her explicit permission to descope (1:09:25): *"a few of them are optional — in
case you want to make things live, keep a few things for Phase 4, keep some
workarounds for a few of the things, and make it live."*

Sequence:
1. Demo on staging (Tuesday, with Abhijit and Anuj)
2. Approval from Abhijit and Sangamitra
3. Ship the Phase 3 items from
   [02-BUILD-BACKLOG.md](02-BUILD-BACKLOG.md) — B-10, B-06, B-02, B-04 before the
   demo; B-01, B-03, B-05, B-11, B-13 after
4. Production deploy — next day after approval, or Monday
5. Run [A-03](#a-03) as a production smoke test immediately after deploy
6. Phase 4 opens once [A-02](#a-02) arrives in writing

---

# D. Attendance

| Person | Role on the call |
|---|---|
| Chhaya Verma | HR — primary UAT feedback author; owns `Platform Feedback & Required Changes.docx` |
| Naveen Satywali | HR — live screen-share findings (scoring anomalies, dashboard counts, date added) |
| Harish Mopuri | Engineering — answered and scoped every point; **his clarifications are the reason five items need no build** |
| Pankaj Kumar Mondal | Engineering/PM — demo environment decision, requirements-in-writing process |

Transcript: 10 Sep 2026, 12:05 PM, 1h 10m 40s. Started and stopped by Harish Mopuri.
