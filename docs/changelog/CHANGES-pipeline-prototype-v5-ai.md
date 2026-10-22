# Pipeline Prototype v5 — AI Features

Scope: `frontend/src/pages/PipelinePrototype.jsx`, the frontend-only Phase 3
walkthrough prototype (route `/pipeline-prototype`, mock data, no backend, no
real emails). This pass layers five AI-flavored touches onto the v3 board —
all mocked in component state, none call a real model or endpoint.

---

## 1. Stuck-candidate AI insight (analytics tab)

The **Stuck candidates** table (rendered by `PipelineAnalyticsPreview`, the
tab merged into the existing Analytics page) already showed a "Blocked on"
tag per row. Each row now carries a second line underneath it: a
robot-icon (`RobotOutlined`) one-liner giving a specific, data-shaped reason
the candidate is stuck — e.g. *"Suresh usually replies in 2 days — 6× over
his norm; try a direct nudge instead of the daily reminder."* The three mock
rows (Ravi Shankar / Meena Iyer / Farhan Ali) each get a distinct insight
tied to their actual blocker.

## 2. Natural-language board search

Added an `Input.Search` above the existing filter row: *"Ask the board —
e.g. 'vendor candidates stuck on hold'"*. On search, a mocked keyword parser
(`parseNlQuery`, module scope) matches the typed text against the same
Role / Source / Hold / Stuck filters the dropdowns already drive — no new
filtering logic, no real NLP:
- Role: substring/word match against the candidate role list.
- Source: `vendor` / `hr` / `email` keywords → `fSrc`.
- `hold` → `fHold`.
- `stuck` / `blocked` / `overdue` / `aging` / `long` → `fStuck`.

Below the box, a "Read as: …" line (robot icon) states exactly what matched
(e.g. `Position = "Senior .NET Developer" · On Hold only`), or "No filters
matched — showing all candidates" if nothing hit. Clearing the box resets
all four filters. This keeps the mock honest — it's dropdown filters wearing
a search box, not a claim of real query understanding.

## 3. Evalground import: dropped the column-mapping step

The import modal (still an action on the IQ / Tech Assessment round, per
v2's RT feedback #4) previously showed a 4-step flow — **Upload file → Map
columns → Validate → Import** — implying CSVs need a rigid column layout.

Changed to **Upload file → AI reads rows → Import**, and the file-summary
alert now reads: *"no column mapping step — AI read every row's raw text
regardless of column order/headers and picked out email, GA score and
Technical score (same schema-free row-reading pattern as the HR bulk resume
upload)."*

This mirrors the real pattern already in
`backend/src/services/hrUpload.service.js` (~lines 1083–1100), where each
Excel row is flattened to `key: value` text (`Object.entries(row).map(...)`)
and handed to the AI parser rather than mapped through fixed column
positions — no reason the Evalground importer should look more rigid than
the bulk resume importer it sits next to.

## 4. AI interviewer prep brief on the Schedule Interview invite

The Schedule Interview modal gains a checkbox, **on by default**:
*"Attach AI interviewer prep brief."* Description: a one-page summary sent
to the interviewer alongside the invite — candidate snapshot, scores so far
(JD match, Zeko, Evalground), and 3–4 suggested questions for the round.
Explicitly scoped as advisory: *"nothing here feeds back into the official
outcome."*

Toggling it off is honored in the mock: the round's email timeline only
gets the "AI interviewer prep brief attached — …" entry, and the success
toast only mentions the brief, when the checkbox is checked at save time.

## 5. AI feedback summary next to submitted interviewer feedback

Inside an interview round's panel, once feedback is submitted the existing
green "Approve / Hold / Reject + note" alert is now followed by a second,
blue alert: **"AI feedback summary"** — a one-line consistency check between
the numeric ratings and the written note (e.g. *"no contradictions flagged
between the scores and the written note"*). Ends with the same guardrail
each time: *"Advisory only — RT still decides Approve / Hold / Reject."*
This does not touch the outcome buttons or `saveOutcome()` — it's read-only
context sitting next to the interviewer's own recommendation.

---

## Not changed in this pass

No routing, naming, or file changes — those land in v7. No email-template
editing — that lands in v6. `PipelineAnalyticsPreview`'s export signature,
the stage config, and `INITIAL_CANDIDATES` shape are untouched.
