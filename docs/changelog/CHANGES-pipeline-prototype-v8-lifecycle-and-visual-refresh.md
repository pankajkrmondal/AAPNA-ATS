# Pipeline Prototype v8 — Round Lifecycle Depth, "Shortlisted" Removal, Visual Refresh

Scope: `frontend/src/pages/CandidatePipelinePrototype.jsx`, following v5 (AI
features), v6 (decision modal + editable emails), v7 (rename). This pass
responds to feedback that the prototype wasn't quite representing the real
candidate journey and looked visually disconnected from the rest of the app.

---

## 1. Removed the "Shortlisted" column

Shortlisting already happens on the Candidate Screening page — having a
"Shortlisted" column as the pipeline's first stage implied it happened
*again* here, which didn't make sense.

- `STAGES` no longer has a `shortlist` entry. The pipeline now starts at
  **HR Screening (Zeko)**.
- The JD-match / date / "shortlisted by" context that used to live in
  `rounds.shortlist` (rendered as a fake "round" with its own stepper step)
  is now a candidate-level `screening` field, shown as a **persistent,
  read-only line in the drawer header** — "Shortlisted from Candidate
  Screening — JD match 84% · 02 Jul · by Priya" plus a "View resume" link —
  visible regardless of which round is selected, not tied to the stepper.
- The two candidates who were sitting at `shortlist` (Rohit Kulkarni, Ananya
  Singh) now enter directly at `zeko_hr` with an "invite pending" round and
  an `invited` chip.
- Cleanup: the now-dead `stage.type === 'shortlist'` render branch removed;
  `FUNNEL` (analytics preview) and the "Rejection reasons" mock table
  updated to no longer reference a "Shortlisted" round.
- Top banner copy updated: *"Candidates enter here already shortlisted from
  Candidate Screening — the pipeline starts at HR Screening (Zeko), not a
  second shortlist step."*

## 2. Full lifecycle coverage on every round — not just interview rounds

Requested: for each round, example candidates covering all four steps —
(1) schedule interview, (2) interview awaiting, (3) scores, (4)
approve/hold/reject. First pass only applied this to the 6 interview-type
rounds (Tech 1–3, HR, CEO, Client); a follow-up screenshot showed the
Zeko/Assessment columns still thin — HR Screening (Zeko) had two
candidates in the *identical* "Invited" state and nothing showing a Zeko
score, and IQ/Tech Assessment had no passing-score example. The same gap
existed there: **no candidate anywhere had a Zeko score or an imported
Evalground result sitting with no decision recorded yet.**

Fixed by applying the same rigor to every round type, not just interviews.
Audited the roster and found: no candidate anywhere was sitting in "not yet
scheduled/invited" *and separately* no candidate had scores/feedback/results
in but no decision recorded — the exact step-3-to-step-4 moment the
Approve/Hold/Reject buttons exist for. Added 13 new candidates total and
adjusted 3 existing ones to close these gaps across every round type. New
CHIP: `feedback` ("Ready for decision", green) — deliberately generic
rather than "Feedback ready," since it now covers Zeko scores and
Evalground imports too, not just interview scorecards. It replaces the old
`imported` chip (folded in — same "needs your decision" meaning).

A **second** follow-up screenshot pointed out that even after that first
pass, the Zeko/Assessment columns still collapsed too many real states into
one message — e.g. "invite not sent yet" and "invite sent, test in
progress" both rendered as the same generic *"Zeko invite sent — awaiting
interview"* text, because the code only ever checked `round.zeko` truthy/
falsy (2 branches). The requested shape was explicit: **invite should be
sent → invite sent → awaiting meeting/test → results → decision** — five
states, not two. Fixed the render logic itself (not just the mock data) for
both `zeko` and `assessment` stage types to branch on `round.status`
(`pending` → `invited` → `in_progress`/testDate-no-import → scored/imported
→ decided), each with its own message, and added a **"Send Zeko invite" /
"Send assessment invite"** action button for the `pending` state (mirrors
the existing "Schedule interview" button pattern). New CHIP `pending`
("Invite pending", grey) for the genuinely-not-started state; `await` is
now generically labelled "In progress" instead of "Awaiting feedback" since
it covers Zeko-test-in-progress and Evalground-taken-not-imported too.

Coverage by round (`chip` in brackets):
- **HR Screening (Zeko)**: **Tanvi Joshi `[pending]`** invite not sent ·
  Rohit Kulkarni `[invited]` + Ananya Singh `[invited]` invited, not yet
  started · **Devansh Rao `[await]`** test in progress · **Karan Mehta
  `[feedback]`** score received, awaiting decision · Farhan Ali `[hold]`
  decided.
- **IQ / Tech Assessment**: **Yash Malhotra `[pending]`** invite not sent ·
  **Ritika Sood `[invited]`** invited, not yet taken · Meena Iyer `[review]`
  test taken, result not imported yet · Neha Sharma `[feedback]` imported,
  **failing** score · **Arnav Shah `[feedback]`** imported, **passing**
  score — both awaiting an RT decision, showing the pass/fail split at the
  same step.
- **Functional (Zeko)**: **Ishaan Kapoor `[pending]`** invite not sent ·
  Vishal Gupta `[invited]` invited, not yet started · **Naina Chopra
  `[await]`** test in progress · **Sneha Pillai `[feedback]`** score
  received, awaiting decision.
- **Tech Round 1**: Meera Krishnan `[review]` not scheduled · Arjun Mehta
  `[scheduled]` + Ravi Shankar `[await]` interview awaiting · Aditya Verma
  `[feedback]` scores ready.
- **Tech Round 2**: Divya Menon `[review]` not scheduled · Kavya Nair
  `[await]` interview awaiting · Rahul Bhatt `[feedback]` scores ready ·
  **Farah Sheikh `[hold]`** — a genuine On Hold decision recorded on an
  interview round (previously only Zeko HR had a Hold example anywhere).
- **Tech Round 3** (optional): Sameer Joshi `[review]` not scheduled —
  lighter coverage, matching how rarely this optional round is actually used.
- **HR Round**: Pooja Nair `[review]` not scheduled · Sanya Kapoor
  `[scheduled]` interview awaiting · Vikas Kumar `[feedback]` scores ready.
- **CEO / Final**: Priyanka Das `[scheduled]` interview awaiting · Anjali
  Rao `[feedback]` scores ready.
- **Client Interview** (optional): Rohan Desai `[review]` not scheduled ·
  Karthik Reddy `[scheduled]` interview awaiting.

Every new candidate carries a full, plausible round history through all
prior stages (Zeko HR → Assessment → Zeko Functional → …) so their drawer
stepper isn't a dead end — same authoring pattern as the existing roster.
Board total: 14 → **33 candidates**, spread across all 11 columns (Documents
and Offer — one candidate each — are unchanged: those have their own
internal multi-state models already, e.g. a mixed verify/upload/reject
checklist or an approval-then-decision flow, not the schedule/await/score/
decide shape this pass targets).

## 3. Visual refresh — reusing the app's existing design system

Not a new look invented for this page — the same components/utilities
already used on `Dashboard.jsx` / `VendorDashboard.jsx`:
- **Analytics tab tiles**: replaced the plain `Card` + `Statistic` boxes
  with the shared `KpiCard` component (`components/common/KpiCard.jsx`) —
  animated count-up, soft glow, hover lift, sweep-in accent bar. Tile set
  expanded to 6 to surface the new pending/in-progress states: Active in
  pipeline · Invite pending · In progress · Ready for decision · On hold ·
  Offers pending.
- **Board columns**: each stage column now has a thin colour-coded accent
  bar by stage *type* (Zeko = blue, Assessment = cyan, interview = gold,
  Documents = pink, Offer = green) — a quick visual read of what kind of
  round you're looking at, reusing hues already used for module icons in
  `AdminDashboard.jsx` rather than inventing a new palette. Board entrance
  is staggered (`.stagger-children`, already used elsewhere in the app).
- **Candidate cards redesigned** — flagged as "clumsy" (too many
  same-weight pill tags competing for attention: source, chip, "2 MRFs",
  age, all stacked). Replaced with: a small initials avatar (colour keyed
  off the name) for a visual anchor; a **left-border accent coloured by
  status** (`CHIP_ACCENT` — greyed for not-started, gold for in-progress,
  green for ready-to-decide, blue for booked) so the state reads without
  parsing text; source folded into the secondary text line ("React
  Developer · HR upload") instead of its own pill; the age indicator is
  now plain quiet text except when it's actually a problem (>10 days →
  red `.tag-attention` pulsing tag) instead of a coloured pill every time.
  Net effect: one dominant tag per card (status) instead of three-to-four
  competing ones. New `.cp-candidate-card` (hover lift + shadow + fade-in
  on mount) and `.cp-avatar` classes in `theme/index.css`.
- **Approve confirmation**: reused `UploadCelebration` — the same quiet
  single-checkmark-with-ripple animation shown on a successful upload batch
  — briefly on a successful "Approve round," instead of only a toast.
- **Buttons**: "Approve round" gets `.btn-sheen` (the hover sheen sweep
  already used on primary buttons elsewhere).
- Replaced a made-up `var(--surface-2, #f7f8f4)` fallback (used for the AI
  prep-brief card background) with the real design token `var(--ink-3)`.

New CSS lives in a clearly-commented, namespaced block in
`frontend/src/theme/index.css` (`.cp-candidate-card`, `.cp-avatar`), marked
for removal alongside this prototype file.

---

## Files touched

| File | Change |
|---|---|
| `frontend/src/pages/CandidatePipelinePrototype.jsx` | §1–3 above |
| `frontend/src/theme/index.css` | New `.cp-candidate-card` + `.cp-avatar` classes |

## Verification

- `npm run build` (Vite production build) completes cleanly, twice more
  after the zeko/assessment state-model fix and card redesign.
- esbuild syntax/import-resolution check on the file passes at every stage.
- Extracted `INITIAL_CANDIDATES` at runtime (Node) and tabulated by
  stage/chip to confirm: 33 total candidates, IDs sequential 1–33, no
  duplicate IDs, every round (Zeko HR, Assessment, Zeko Functional, and all
  6 interview rounds) has the intended state spread (see §2 table), no
  stray `shortlist` stage-key references remain (`grep -n "shortlist"`
  only matches prose/comments, not code).
