# Pipeline Prototype v9 — Full-Lifecycle Coverage on Every Round + Card Redesign

Scope: `frontend/src/pages/CandidatePipelinePrototype.jsx`, following v8
(round lifecycle depth for interview/Zeko/Assessment rounds + first card
redesign). Two things carried over from v8 were still incomplete per
follow-up feedback: coverage stopped short of Documents and Offer, and the
card didn't surface the 4 categories the recruiter walks through on every
round (entry, schedule/invite, outcome, decision).

---

## 1. Two more render-logic bugs fixed (same class as v8's zeko/assessment fix)

v8 fixed the `zeko`/`assessment` round renderers, which used to collapse
"not started" and "in progress" into one generic message. This pass found
and fixed the same class of bug in two more places:

- **Interview rounds — self-scheduling.** The app already supports
  candidate self-scheduling (`schedMode: 'slots'` in the schedule modal,
  which sets `round.status = 'invited'` with no `round.schedule` yet — the
  candidate hasn't picked a slot). The round-panel renderer only checked
  `round.schedule` truthy, so this state always fell through to "Not
  scheduled yet," which is wrong — slots *were* published, just not picked.
  Fixed: check `round.status === 'invited'` first → "Self-scheduling slots
  published — awaiting candidate to pick a slot."
- **Documents — "request not sent" vs "sent, no uploads yet."** Both
  rendered identically (checklist defaults to all-`pending` either way).
  Added `round.requested` (boolean). No `requested` → "Document request not
  sent yet" + a **"Send document request"** button (new `sendDocumentRequest`
  handler); `requested` → the checklist, with a **"Send reminder"** button
  and a success alert once every document is `verified`.
- **Offer — approval was all-or-nothing.** `round.offer` either didn't
  exist or had everything (approval, file, shared date, decision) at once —
  no way to represent "requested but not yet approved" or "approved but not
  yet shared." Added `round.offer.approvalStatus: 'pending' | 'approved'`
  and made `shared`/`decision`/`file` optional within it. Four distinct
  states now render: no offer → **"Request internal approval"** button (new
  `requestOfferApproval` handler); `approvalStatus: 'pending'` → "Approval
  requested — awaiting recruiter sign-off" (daily-nudge framing, no action —
  matches the existing Q3/Q26 approval-owner model); `approvalStatus:
  'approved'` + no `shared` → **"Record offer shared"** button (new
  `recordOfferShared` handler); `shared` present → the existing
  Mark Accepted/Rejected flow, unchanged.

## 2. Every round now covers its full lifecycle — not just interviews

Grew the roster from 33 to **52 candidates** (19 new, 2 existing adjusted —
Dev Patel's docs round got `requested: true`, Ishita Bose's offer got
`approvalStatus: 'approved'` — so both still render correctly under the new
branching in §1). Every round from HR Screening through Offer now shows the
entry → schedule/invite → outcome → decision arc:

| Round | Candidates (chip) |
|---|---|
| HR Screening (Zeko) | Farhan Ali `hold` · Rohit Kulkarni `invited` · Ananya Singh `invited` · Karan Mehta `feedback` · Tanvi Joshi `pending` · Devansh Rao `await` (in progress) · **Zoya Ahmed `feedback`** (borderline score) |
| IQ / Tech Assessment | Meena Iyer `review` · Neha Sharma `feedback` (fail) · Arnav Shah `feedback` (pass) · Yash Malhotra `pending` · Ritika Sood `invited` · **Kabir Malhotra `hold`** |
| Functional (Zeko) | Vishal Gupta `invited` · Sneha Pillai `feedback` · Ishaan Kapoor `pending` · Naina Chopra `await` · **Isha Trivedi `feedback`** (borderline) |
| Tech Round 1 | Arjun Mehta `scheduled` · Ravi Shankar `await` · Meera Krishnan `review` · Aditya Verma `feedback` · **Nikhil Bansal `invited`** (self-schedule slots published) |
| Tech Round 2 | Kavya Nair `await` · Divya Menon `review` · Rahul Bhatt `feedback` · Farah Sheikh `hold` *(unchanged from v8)* |
| Tech Round 3 (optional) | Sameer Joshi `review` · **Advait Rao `scheduled`** · **Simran Kaur `feedback`** |
| HR Round | Sanya Kapoor `scheduled` · Pooja Nair `review` · Vikas Kumar `feedback` · **Omkar Patil `invited`** (self-schedule) · **Reema Iyer `hold`** |
| CEO / Final | Priyanka Das `scheduled` · Anjali Rao `feedback` · **Aarav Singh `review`** · **Diya Kapoor `hold`** |
| Client Interview (optional) | Karthik Reddy `scheduled` · Rohan Desai `review` · **Rajesh Nambiar `feedback`** (client-submitted feedback) |
| **Documents** | Dev Patel `docs` (mixed verified/rejected) · **Manav Chatterjee `pending`** (request not sent) · **Priyansh Oberoi `docs`** (sent, no uploads) · **Tanya Bhalla `docs`** (partial uploads) · **Kunal Rastogi `feedback`** (all verified, ready to advance) |
| **Offer** | Ishita Bose `offer_sent` (shared, awaiting decision) · **Ayaan Siddiqui `pending`** (not requested) · **Meher Chawla `await`** (approval pending) · **Vivaan Kohli `await`** (approved, not shared) · **Aisha Fernandes `offer_sent`** (accepted) |

Bold = new this pass. Every new candidate carries a full, plausible round
history through prior stages (same authoring pattern as before). Analytics
tiles (`PIPELINE_TILES`) and `FUNNEL` numbers updated to match — recomputed
from the actual chip distribution across the new 52-candidate roster
(`pending`: 5, `await`: 6, `feedback`: 13, `hold`: 5), not just scaled
guesses.

## 3. Card redesign: 4-segment progress stepper

Feedback: cards didn't show the 4 categories a recruiter tracks per round —
how the candidate arrived, schedule/invite status, outcome, decision.
Checked how established ATS/kanban tools handle this before designing:
Lever's pipeline cards favour one minimal dominant status line (avatar +
name + source + one-line summary); the "surface N sub-states compactly"
pattern is better precedented by general kanban tools — Trello's checklist
badge (`3/5`), Linear's cycle-progress ring — than by ATS-specific card
design. Decision: keep the existing status chip (already fixed for
"clumsy" tags in v8) as the primary label, add a **compact 4-segment
progress bar** beneath it as the secondary at-a-glance signal, rather than
another row of same-weight tags.

- New `roundProgressSegments(candidate)` — derives all 4 segment states
  (`pending`/`active`/`done`) from the candidate's existing round data, no
  new per-candidate fields needed beyond what §1/§2 already added:
  1. **Entry** — always `done` (they arrived via approval from the
     previous round, or via Candidate Screening for HR Screening).
  2. **Schedule/Invite** — grey → gold (sent/scheduled, pending) → green
     (action taken, regardless of downstream state).
  3. **Outcome** — grey → gold (in progress/awaiting) → green (score/
     feedback/result in).
  4. **Decision** — grey → green (approved) or gold (hold); for Offer
     specifically, driven by the candidate's own accept/reject decision
     rather than an RT outcome, since Offer has no Approve/Hold/Reject
     buttons.
- Rendered as a thin 4-segment bar (`.cp-progress-seg`, `theme/index.css`)
  under the chip row on every card, with a `Tooltip` spelling out all 4
  states in text (e.g. "Entry: Done · Schedule: In progress · Outcome: Not
  started · Decision: Not started").
- Verified programmatically: extracted `roundProgressSegments` + the full
  52-candidate roster into a Node harness and checked segment monotonicity
  (outcome never shows progress ahead of schedule, decision never shows
  progress ahead of outcome) across every candidate — 0 inconsistencies.
  Caught and fixed one real bug this way: candidates whose round only sets
  `round.zeko`/`round.importedFrom` without an explicit `status` field
  (the pattern several v8 candidates already used) were showing "Schedule"
  as still pending despite having a score in — fixed by also checking for
  the downstream field's presence, not just `status`.

---

## Files touched

| File | Change |
|---|---|
| `frontend/src/pages/CandidatePipelinePrototype.jsx` | §1 render-logic fixes + 3 new handlers; §2 19 new candidates + 2 adjusted; §3 `roundProgressSegments` + card redesign; tile/funnel counts |
| `frontend/src/theme/index.css` | New `.cp-progress-seg` classes in the existing namespaced Candidate Pipeline block |

## Verification

- esbuild syntax/import-resolution check after each major edit; all clean.
- `npm run build` (Vite production build) completes cleanly.
- Extracted `INITIAL_CANDIDATES` at runtime (Node) and tabulated by
  `stage`/`chip`: 52 total, IDs sequential 1–52, no duplicates, matches the
  planned per-round distribution exactly (see §2 table).
- Extracted `roundProgressSegments` + the full roster into a second Node
  harness and checked segment-state monotonicity across all 52 candidates —
  0 inconsistencies (see §3).
- **Not done:** logged-in click-through in a browser (no dev credentials
  available in this session, same limitation as prior passes) — worth a
  manual pass on the Documents and Offer columns specifically, since those
  had zero prior coverage and are the newest render branches.
