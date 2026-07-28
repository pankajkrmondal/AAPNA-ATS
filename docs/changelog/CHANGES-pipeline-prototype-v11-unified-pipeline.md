# Pipeline Prototype v11 — Unified Vertical Pipeline + Real Zeko Scheduling

Scope: `frontend/src/pages/CandidatePipelinePrototype.jsx`, `frontend/src/theme/index.css`.
Follows v10 (drawer redesign — 4-tile category bar, `.cp-round-panel` polish,
stage-pill navigator). Feedback on the v10 result: the 4-tile bar didn't
give the info shown for each category, "sending invite doesn't contain the
scheduling," and "interview feedback is trimmed." Fixing the tile bar in
place ("wrap the text") was rejected — RT wanted a real top-to-bottom
pipeline, click-to-expand by category. That version was then also
rejected as "very very ugly" — flat score cards, no brand colour, a
cluttered header, no hierarchy. Final, most specific direction: the
pipeline is "the crucial part of the app" and must read as one continuous
pipeline with exactly four stages — **Invite Sent → Awaiting Interview →
Awaiting Results → Approve/Reject** — not a compact list with a separate
score section bolted underneath it.

---

## 1. One unified, always-expanded vertical pipeline

Replaces both the v10 4-tile category bar and the click-to-expand variant
that preceded it. `roundProgressSegments` was rewritten (not just
relabelled) around RT's four stages instead of the old Entry/Schedule/
Outcome/Decision split — "Entry" (how the candidate arrived) is no longer
its own stage; that context is one click away in the *previous* round's
own Decision stage rather than repeated in every round panel.

Stage wording is per round kind, same shape, honest language for what
actually happens in that round:

| Round kind | Stage 1 | Stage 2 | Stage 3 | Stage 4 |
|---|---|---|---|---|
| Zeko | Invite Sent | Awaiting Interview | Awaiting Results | Approve / Reject |
| Assessment | Invite Sent | Awaiting Test | Awaiting Results | Approve / Reject |
| Interview | Invite Sent | Awaiting Interview | Awaiting Results | Approve / Reject |
| Documents | Request Sent | Awaiting Upload | Awaiting Verification | Approve / Reject |
| Offer | Offer Prepared | Offer Sent | Awaiting Response | Accepted / Declined |

Rendered (`.cp-pipeline`, `theme/index.css`) as a connected vertical
stepper — small circular nodes joined by a line that fills in green as
stages complete, reading top to bottom like a shipment tracker or a
Greenhouse/Lever candidate activity timeline (the design pattern real ATS
platforms use for exactly this: one dominant Timeline organism, not a
grid of stat cards competing with it). Node states: solid green check
(done), pulsing brand-gradient ring (active), amber ring (On Hold), red
(Rejected), hollow grey (not started yet — shown for every unreached
stage, so the shape of the whole pipeline is visible from the first
click, not just once each stage lights up).

**No click-to-expand.** That mechanism is exactly what produced the
original "trimmed" complaint — hiding the invite's scheduling info or the
interviewer's full feedback note behind a click. Every stage now shows
its real content inline, unconditionally:
- Stage 1: channel, timestamp, recipient.
- Stage 2: the full scheduling detail — for Zeko/interview rounds this is
  where the self-schedule window or Teams/client-call date-time now
  renders in full (the "doesn't contain the scheduling" half of the
  original complaint).
- Stage 3: compact colour-coded stat chips (`.cp-stat-chip` — icon+number+
  label, colour by score tier: ≥70 green / 50–69 amber / <50 red) for
  Zeko/Assessment scores, plus the full feedback note text for interview
  rounds — not trimmed.
- Stage 4: full decision reasoning, decider, and date.

## 2. Nothing dropped — `round.note` always lands somewhere

`round.note` was previously only shown in a separate `Alert` for specific
round types, or not shown at all in some code paths. It's now always
attached to whichever stage it's actually about: an in-progress Zeko/
interview note lands on the relevant "awaiting" stage; an assessment
pass/fail-threshold note folds into the Stage 3 detail string; hold/
approved notes (CTC, notice period, aging context) land on the Stage 4
decision. A Node harness (below) asserts every non-empty `round.note`
across all 245 round-instances appears verbatim in some segment's text —
this is the mechanical guarantee that nothing gets silently trimmed again.

## 3. Header — one badge, not four competing tags

Stage name stays bold (now 16px); **one** colour-coded status badge
replaces the old stack of outcome tag + reason tag as equal-weight
siblings. Reason and the decided/updated timestamp collapse into a single
muted line under the title instead of fighting the title for space.

## 4. Section framing + actions footer

"Emails in this round" keeps its micro-label pattern (`.cp-section-label`)
and now sits on a muted surface (`.cp-emails-surface`) to visually recede
behind the pipeline above it — the one secondary section left, since
Round Details no longer exists as a separate tier (its content lives
inside Stage 3 of the pipeline). "Approve round" gets a solid
`--gradient-primary` fill (`.cta-primary`, an existing app-wide CTA class)
instead of an outline the same weight as Hold/Reject. The footer is now
exactly the three decision buttons — "Schedule interview"/"Reschedule"
moved to live inside Stage 2 of the pipeline itself, next to the
scheduling detail it affects, rather than in a separate footer row.

## 5. Real Zeko scheduling — invite now captures an actual window

`sendZekoInvite`'s button now opens a new **"Schedule Zeko Interview"**
modal mirroring the real one already built in `AnalyticsLegacy.jsx`
(candidate mini-card → `DatePicker.RangePicker`, "Interview Date & Time
Range (IST)"; no interactive job dropdown, since this frontend-only
prototype has no real `zekoJobs` API to back it). Confirming sets
`round.zekoWindow: { start, end }` alongside `status: 'invited'`, logged
to the round's email timeline — this is exactly the detail that now
renders in full inside Stage 2 ("Invite emailed... self-schedule window
22 Jul, 10:00–12:00"). `sendAssessmentInvite` gets a simpler single-date
"completion deadline" modal (no equivalent Evalground scheduling UI exists
to mirror), setting `round.deadline`.

Mock data: Rohit Kulkarni, Ananya Singh (`zeko_hr`), Vishal Gupta
(`zeko_fn`) now carry a `zekoWindow`; Ritika Sood (`assessment`) carries a
`deadline` — all four previously sat at `status: 'invited'` with no
scheduling data at all, which is what the "doesn't contain the
scheduling" feedback was pointing at directly.

---

## 6. Interactivity audit — interview rounds had a real dead end

RT loved the pipeline shape, then flagged "interviews can't be visible in
the UI" and asked for an audit of what needs to be clickable in each
category (scheduling, feedback, emailing). Traced it to two concrete gaps
in `renderRoundPanel`'s per-stage `extras`, not a rendering crash:

- **Interview rounds had no way to submit feedback once scheduled**, for
  any candidate whose round wasn't in the exact `status === 'await'`
  state. The "Open scorecard" button was gated on that one status string;
  candidates left at `status: 'scheduled'` (or no status at all, just a
  bare `schedule` object — 5 real candidates: Arjun Mehta/Tech 1, Sanya
  Kapoor/HR, Priyanka Das/CEO, Karthik Reddy/Client, Sameer Joshi/Tech 3)
  had a scheduled interview and no button anywhere to open the scorecard —
  a genuine dead end, pre-dating this redesign but only now surfaced by
  reviewing what's clickable per stage. Condition broadened to
  `round.schedule && !round.feedback` — available whenever an interview is
  booked and awaiting feedback, regardless of the exact status string.
- **The interview round's primary action was visually the odd one out.**
  Every other round type's first action (Send Zeko invite, Send assessment
  invite, Send document request, Request internal approval) is a bold
  `type="primary"` button; "Schedule interview" was a plain default
  button tucked inside a pipeline row — easy to read as "nothing to do
  here" next to the others. Now primary until scheduled, stepping back to
  default for "Reschedule" once the primary path moves to opening the
  scorecard (which is now primary too).
- Same gap existed for Zeko: once invited, there was no way to change the
  scheduled window from the UI. Added a "Change window" action (Stage 2)
  that reopens the same scheduling modal — same pattern as interview's
  Reschedule.

`roundProgressSegments`'s Stage 3 detail for the "scheduled, not yet
`await`" case was also reworded from "Awaiting the interview to take
place" to "Interview scheduled — awaiting interviewer feedback," since
that's accurate whether the interview date is upcoming or already past
(the mock data doesn't track this, so the wording can't assume either).

---

## Files touched

| File | Change |
|---|---|
| `frontend/src/pages/CandidatePipelinePrototype.jsx` | `roundProgressSegments` rewritten around the 4-stage pipeline + per-round-kind labels; `renderRoundPanel` rebuilt (header, unified pipeline, extras-per-stage, section framing, actions footer) across all 5 round types; new Zeko-scheduling + Assessment-deadline modals and handlers; 4 candidates' mock data updated; removed now-unused `Descriptions` import |
| `frontend/src/theme/index.css` | Removed `.cp-category-bar`/`.cp-category-item*`; added `.cp-pipeline`/`.cp-pipeline-step`/`.cp-pipeline-node` (+ state variants, connector, pulse animation), `.cp-stat-chip` (+ score-tier colours), `.cp-section-label`, `.cp-emails-surface`; added missing `.cp-progress-seg--hold`/`--rejected` variants so the board card's mini-bar (unchanged, still approved-as-is) keeps rendering hold/rejected decisions correctly under the renamed segment states |

## Verification

- `npx esbuild ... --bundle` syntax/import-resolution check — clean, re-run
  after §6's interactivity fixes too.
- `npm run build` (Vite production build) — completes cleanly both before
  and after §6 (pre-existing single-chunk-size warning only, unrelated to
  this change).
- New Node harness (extracts `STAGES`/`INITIAL_CANDIDATES`/
  `roundProgressSegments`/`PIPELINE_LABELS` into a standalone CommonJS
  module): checked all **245 round-instances** across all 52 candidates —
  every segment has a non-empty `label` and `detail`, segment states are
  monotonic (a later stage never shows progress while an earlier one is
  still "not started yet"), and every non-empty `round.note` is reflected
  verbatim in some segment's text. **0 issues**, re-run clean after §6.
- §6's exact gap was confirmed with a targeted grep across
  `INITIAL_CANDIDATES` for interview-type rounds with `schedule` set and no
  `feedback` — 5 matches (Arjun Mehta, Sanya Kapoor, Priyanka Das, Karthik
  Reddy, Sameer Joshi), none of which had `status: 'await'`, confirming the
  old condition really did leave them with no scorecard entry point.
- **Not done:** logged-in browser click-through — the backend wasn't
  running this session (no dev credentials), same limitation noted in
  every prior pass on this prototype. Worth specifically eyeballing: the
  Zeko/Assessment scheduling modals end-to-end, one candidate of each
  round type's pipeline (confirm the stage wording reads naturally for
  Documents/Offer, not just Zeko/interview), the pulsing "active" node
  animation, and — per §6 — that the scorecard/reschedule/change-window
  buttons actually appear for the 5 previously-dead-end candidates.
