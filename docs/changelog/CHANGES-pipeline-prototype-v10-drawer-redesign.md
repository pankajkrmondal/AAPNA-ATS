# Pipeline Prototype v10 — Candidate Drawer Redesign

Scope: `frontend/src/pages/CandidatePipelinePrototype.jsx`, following v9
(full-lifecycle roster coverage + board-card redesign). Feedback on a
screenshot: the board card is good now, but the drawer's round-detail panel
— everything you see after clicking a candidate — is not: too plain, too
cluttered, missing the 4-category structure the card now has, and the
round-navigator stepper at the top looks cramped.

---

## 1. 4-category bar in the drawer

`roundProgressSegments` (added in v9 for the board card's compact 4-segment
bar) is extended with a **human-readable `detail` string per segment** —
not just a state colour, an actual caption: `"Score 66/61"`,
`"On Hold — Weak communication"`, `"Teams · 13 Jul, 11:00"`,
`"Approved from Tech Round 2 · 12 Jul"`.

Rendered as a 4-tile grid (`.cp-category-bar`, `theme/index.css`) at the top
of every round panel, one tile per category — Entry / Schedule (or Invite/
Request/Approval, labelled per round type) / Outcome (Score/Result/
Feedback/Uploads/Shared) / Decision — each with a small state-coloured dot
and the detail text. This is the same structural information the board
card's mini-bar shows, spelled out in full for whichever round the drawer
is currently displaying.

**Important correctness fix while wiring this up:** the drawer can show a
*past* round (click any earlier step in the navigator), not just the
candidate's current one. `roundProgressSegments(c)` originally always
derived from `c.stage` (the candidate's current stage) — reused as-is, the
category bar would show the *current* round's state while the user was
looking at a *different, earlier* round's detail. Fixed by adding an
explicit `stageKey` parameter (`roundProgressSegments(c, stageKey = c.stage)`)
— the board card keeps calling it with no second argument (always wants the
current round), the drawer passes the selected round's key explicitly.

The board card's tooltip was also upgraded to use the new `detail` text
instead of a generic "Done / In progress / Not started" label — more
informative for the same hover, no extra UI.

## 2. Visual polish

The round panel was a default-styled antd `Card` — flat, no shadow, no
accent, identical regardless of which kind of round you were looking at.
Now:
- `.cp-round-panel` class — real elevation (`shadow-md`), rounded corners,
  fade-in on mount, matching the board card's level of polish.
- The same stage-type accent bar (`STAGE_ACCENT` — blue for Zeko, cyan for
  Assessment, gold for interviews, pink for Documents, green for Offer)
  used on the board column now also appears at the top of the round panel,
  visually tying the drawer back to the column it came from.

## 3. Stepper replaced — the numbered circles were cramped

The 11-stage antd `<Steps>` (`size="small"`, tiny numbered circles, 11px
abbreviated labels squeezed into a `minWidth: 980` horizontally-scrolling
strip) is replaced with a row of `.cp-stage-pill` buttons — rounded,
labelled with the stage's short name, no separate circle+caption layout to
cram. States: done (soft green fill), current (solid brand gradient +
glow), future (greyed, disabled), plus a subtle lift/border on whichever
pill is currently selected. Same click-to-navigate / future-rounds-locked
behaviour as before — only the visual language changed.

## 4. Decluttered the loudest redundant alert

Zeko-type rounds' `round.note` (e.g. Farhan Ali's *"On Hold 34 days —
manual review only... aging badge keeps it visible"*) rendered as a bold
`type="warning"` (yellow) alert directly below the score cards — restating
information the header tags ("On Hold" + reason) and, now, the new category
bar's Decision tile already show. Downgraded to `type="info"` (calmer blue)
since it's non-actionable process context, not a fresh warning. Left the
assessment-type note alert (`type="warning"`, e.g. *"IQ 46% — below the 50%
pass mark"*) unchanged — that one carries a real decision-relevant signal
not shown anywhere else, so it stays loud.

## 5. Real pre-existing data bug found and fixed

Wiring the category bar into historical (non-current) rounds surfaced a bug
that predates this session: **14 candidates' HR-round outcome, and one
candidate's Documents outcome, were recorded (`outcome: 'approved'`) with
no underlying `schedule`/`feedback` (or `requested`/`checklist`) data ever
set** — unlike every Tech/CEO/Client round, which always paired an approved
outcome with the schedule + feedback that produced it. The category bar
would have shown "Decision: done" while "Schedule" and "Outcome" both read
"not started" — a visibly broken-looking result.

Fixed at the data level (not a logic band-aid): added plausible
`schedule`/`feedback` objects — matching the shape every other interview
round already uses — to all 14 HR-round entries (Dev Patel, Ishita Bose,
Priyanka Das, Anjali Rao, Aarav Singh, Diya Kapoor, Manav Chatterjee,
Priyansh Oberoi, Tanya Bhalla, Kunal Rastogi, Ayaan Siddiqui, Meher Chawla,
Vivaan Kohli, Aisha Fernandes), and `requested`/`checklist` to Ishita Bose's
Documents entry.

---

## Files touched

| File | Change |
|---|---|
| `frontend/src/pages/CandidatePipelinePrototype.jsx` | §1 `roundProgressSegments` detail captions + `stageKey` param; §1 drawer category bar; §2 `.cp-round-panel` + accent bar; §3 stepper → pill navigator; §4 note-alert severity; §5 15 candidate data fixes |
| `frontend/src/theme/index.css` | New `.cp-round-panel`, `.cp-stage-pill` (+ states), `.cp-category-bar`/`.cp-category-item` (+ states) in the existing namespaced Candidate Pipeline block |

## Verification

- esbuild syntax/import-resolution check after each edit; all clean.
- `npm run build` (Vite production build) completes cleanly.
- Extended the Node verification harness from v9 to check **all 245
  round-instances** (current round + every historical round) across all 52
  candidates, not just each candidate's current round — confirmed segment
  monotonicity (schedule never behind outcome, outcome never behind
  decision) and that every segment has a non-null `detail`. This is what
  caught the §5 bug; re-ran after the fix — 0 issues across all 245.
- **Not done:** logged-in browser click-through (no dev credentials this
  session, same limitation as every prior pass) — worth opening a few
  candidates' historical rounds specifically (not just their current one)
  to eyeball the category bar and pill navigator, since those code paths
  are the newest and least visually verified.
