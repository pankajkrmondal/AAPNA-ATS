# Static HTML Prototype — Structural Sync (Shortlisted Stage Removal)

Scope: `docs/phase3/Phase 3 - prototype.html`, the standalone hand-written
RT-walkthrough mockup (own embedded JS/CSS — does not share code with
`frontend/src/pages/CandidatePipelinePrototype.jsx`). Previously only
naming-synced (title/logo/footer/tab labels) as part of the Analytics
rebrand. The React prototype has since gone through v5–v10 (AI features,
decision modal, full round-lifecycle coverage, card and drawer redesign);
bringing the HTML file to full parity with all of that would mean
hand-porting most of a ~1700-line React file into vanilla JS — out of
scope. **Decision (confirmed with the user): structural sync only** — the
stage list and underlying data match the current pipeline shape; the AI
features, decision-modal, and v8–v10 visual redesign are not ported here.

---

## What changed

**Removed the "Shortlisted" stage** — same reasoning as the React v8
change: shortlisting already happens on Candidate Screening, so a stage
here implying it happens again was confusing.

- `STAGES` array: dropped `{k:"shortlist", n:"Shortlisted", ...}`. The
  pipeline now starts at **HR Screening (Zeko)**.
- **12 candidates** whose `rounds.shortlist` held JD-match/date context
  migrated to a candidate-level `screening: {jdMatch, when, by}` field
  (mirroring the React `candidate.screening` field) — done programmatically
  via a regex pass matched against the file's compact single-line-per-round
  format (all 12 followed the identical `outcome:"approved",when,by,
  jdMatch,emails` shape).
- **2 candidates** (Rohit Kulkarni, Ananya Singh) who were sitting *at* the
  `shortlist` stage now enter directly at `zeko_hr` with an `invited`
  round, chip `invited` — matching the equivalent React v8 migration.
- New `#d-screening` element in the drawer markup, populated in
  `openDrawer()` — a persistent read-only line ("Shortlisted from Candidate
  Screening · JD match 84% · 02 Jul · by Priya · View resume") shown under
  the tag row regardless of which round is selected, replacing the old
  `st.t==="shortlist"` round-detail branch (removed — dead code once no
  stage has that type).
- `FUNNEL` (Pipeline Insights tab) and the "Rejection reasons" table's
  "Shortlisted (review)" row reference updated to match (funnel drops the
  Shortlisted bar and shifts the rest up one slot, same as the React
  `FUNNEL` update; "Skills mismatch" reassigned to "HR Screening (Zeko)").
- Top banner copy updated: *"Candidates enter here already shortlisted
  from Candidate Screening — the pipeline starts at HR Screening (Zeko),
  not a second shortlist step."*
- JS header comment gets a dated addendum recording this structural sync
  and explicitly noting what was **not** ported (AI features, decision
  modal, card/drawer visual redesign), so a future reader doesn't assume
  this file tracks the React prototype 1:1.

## Verification

- Extracted the embedded `<script>` block and ran `node --check` — valid
  syntax, both before and after the header-comment addition.
- Extracted just the `STAGES`/`CANDS`/`FUNNEL` data declarations into a
  Node harness (no DOM calls) and verified: 11 stages with no `shortlist`
  key; all 14 candidates' `stage` and `rounds` keys reference only real
  stage keys; no candidate still has `rounds.shortlist`.
- Manually confirmed the only remaining "Shortlisted"/"shortlist" text in
  the file is either correct on its own terms — the scorecard modal's
  "✓ Shortlisted" recommendation-button label (an interviewer's
  recommendation wording, unrelated to the removed pipeline stage, matches
  the React scorecard modal) and the new `#d-screening` line's intentional
  "Shortlisted from Candidate Screening" phrasing — or a historical v2/v3
  comment describing what those versions were, not a present-tense claim.
