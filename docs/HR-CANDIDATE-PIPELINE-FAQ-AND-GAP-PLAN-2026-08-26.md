# Candidate Pipeline — HR FAQ & Gap Implementation Plan

**Date:** 2026-08-26 · **Status:** Analysis only — **no code was changed by this document**
**Scope:** Answers seven questions anticipated from the Recruitment Team, verified against the live codebase on branch `pankaj-work-staging-v12`, plus an implementation plan for each gap the analysis exposed.

Companion docs: [phase3/02-BUSINESS-DESIGN.md](phase3/02-BUSINESS-DESIGN.md) · [phase3/04-QUESTIONS.md](phase3/04-QUESTIONS.md) · [Recruitment-Analytics-User-Guide.md](Recruitment-Analytics-User-Guide.md) · [reference/VENDOR_PROCESS.md](reference/VENDOR_PROCESS.md)

Everything in **Part A** is what the system does *today*. Everything in **Part C** is a **proposal, not built** — treat it as a plan awaiting approval, not a description of existing behaviour.

> ✅ **Gap register closed, 2026-08-27.** Every gap below was verified against the live code before
> being acted on, because two were already stale the moment this analysis was written:
> **G1** (pause) and **G3** (reopen), plus the core of **G2** (closure from any stage), had already
> shipped on 2026-08-26 in a same-day session this document never saw — see
> [CHANGES-2026-08-26-candidate-closure-graceful-exit.md](changelog/CHANGES-2026-08-26-candidate-closure-graceful-exit.md)
> and [CHANGES-2026-08-26-closure-followon-mrf-lifecycle.md](changelog/CHANGES-2026-08-26-closure-followon-mrf-lifecycle.md).
> The remainder — **G2**'s filter/checkbox, **G4**, **G6** — was built 2026-08-27, see
> [CHANGES-2026-08-27-pipeline-gap-closeout.md](changelog/CHANGES-2026-08-27-pipeline-gap-closeout.md).
> **G5 is acknowledged and deferred** — logged, not started. Per-gap stamps are inline below;
> Part A's prose and Part C's designs are left as originally written for the reasoning trail, even
> where the system no longer behaves as described.

---

# Part A — The seven questions, answered

## A1. Where is AI used in the Candidate Pipeline, and what does it save?

### Inside the pipeline board itself: essentially none

The "Ask the board" search box carries a robot icon, but it is a **local keyword parser, not an LLM**. It matches words like *vendor*, *hold*, *stuck*, *blocked* and sets the Position / Source / On-Hold / Stuck filters that already exist — see `parseNlQuery` in [`frontend/src/pages/Pipeline.jsx:202-222`](../frontend/src/pages/Pipeline.jsx#L202-L222). The file header states this explicitly ([lines 12-19](../frontend/src/pages/Pipeline.jsx#L12-L19)). The "Read as: …" line under the box exists precisely so the screen stays honest about what it did.

### AI does the heavy lifting upstream, and at two pipeline stages

| # | Where | What AI does | Code |
|---|---|---|---|
| 1 | **Resume intake** (HR Upload, vendor upload, email intake) | Parses PDF/DOCX into ~20 structured fields — name, email, phone, skills, total experience, current company, expected CTC, notice period, education | `parseResumeWithOpenRouter` — [`hrUpload.service.js:239`](../backend/src/services/hrUpload.service.js#L239), via [`geminiHelper.js`](../backend/src/utils/geminiHelper.js) (OpenRouter first, then a Gemini model fallback chain with retry/backoff) |
| 2 | **JD intake** (MRF) | Extracts min/max experience, mandatory vs good-to-have skills, education, and a responsibilities summary from raw JD text | [`geminiParser.service.js:11`](../backend/src/services/geminiParser.service.js#L11), called from [`mrf.controller.js:638`](../backend/src/controllers/mrf.controller.js#L638) |
| 3 | **Candidate matching / search** | Vector embeddings (`gemini-embedding-001`) over enriched candidate JSON, then **Cohere Rerank** (`rerank-v3.5`) scores the *whole* candidate pool against the JD or keyword | [`vectorStore.service.js`](../backend/src/services/vectorStore.service.js) — used by `searchRoleCandidates` ([`screening.service.js:715`](../backend/src/services/screening.service.js#L715)) and `searchKeywordCandidates` ([`:1262`](../backend/src/services/screening.service.js#L1262)) |
| 4 | **Profile insights** | Generates a recruiter-facing profile summary JSON per candidate | [`hrUpload.service.js:963`](../backend/src/services/hrUpload.service.js#L963) |
| 5 | **Pipeline stages 1 and 3** | **Zeko conducts the HR Screening and Functional Screening interviews with AI.** Overall / technical / communication scores plus a report link sync back automatically and flip the card to "Ready for decision" | [`zeko.service.js`](../backend/src/services/zeko.service.js); board-side detection at [`pipeline.service.js:229-259`](../backend/src/services/pipeline.service.js#L229-L259) |

### What that saves versus working without AI

- **No manual data entry per resume.** Without the parser, someone types every candidate's ~20 fields into a form. At bulk-upload volumes this is the single biggest saving.
- **Search works on meaning, not exact keywords.** A JD asking for "React" surfaces candidates whose CV says "ReactJS", "Next.js", "front-end SPA work" — a `LIKE '%react%'` query does not. The rerank step then orders the full pool by genuine relevance rather than by database order.
- **The first two screening rounds happen without a recruiter's calendar.** Zeko runs HR and Functional screening and returns scored results; the recruiter arrives at a decision point, not at a scheduling problem.
- **JD structuring is automatic.** Experience bands and skill lists come out of the JD text, which is what makes matching (3) possible at all.

**What is *not* AI:** every stage decision, the outcome emails, scheduling, documents, offers, analytics and the board itself are deterministic workflow. AI proposes and screens; **people decide**, and every decision is recorded with who, when and why.

---

## A2. What happens if I reject or hold a candidate — where do they go?

### What is enforced at the moment you decide

A **reason is mandatory** for both Reject and Hold — the request is refused with a validation error if none is given ([`pipeline.service.js:662-673`](../backend/src/services/pipeline.service.js#L662-L673)). Reasons come from a shared taxonomy (High Salary Expectation, High Notice Period, Weak Communication, Skills Mismatch, Frequent Job Changes, Unresponsive / No-show, Client Rejected Profile, Failed Assessment Threshold) plus **"Other reasons"**, which requires typed free text — and that typed text is what is displayed everywhere afterwards, never the word "Other" ([`seed-pipeline-stages.js`](../backend/prisma/seed-pipeline-stages.js)).

### What the system does on save

1. Writes a **stage event** — stage, outcome, reason, notes, acting user, timestamp. This is the audit trail shown in the drawer timeline.
2. Sends the **candidate an outcome email**, which the recruiter can edit in the modal before it goes out.
3. Sends the **vendor a short generated status line** (name, position, stage, outcome) if the candidate was vendor-sourced — never the recruiter's edited body ([`pipeline.service.js:814-822`](../backend/src/services/pipeline.service.js#L814-L822)).
4. Raises an **in-app notification** to the rest of the team (the actor is excluded).
5. Writes back to the legacy columns `rpa_cv.FinalStatus` and `rpa_shortlisted_candidates.pipeline_status`.

### Where the candidate goes: nowhere — they stay in the same column

The card stays exactly where it is and changes colour: red **"Rejected"**, amber **"On Hold"** ([`Pipeline.jsx:89-90`](../frontend/src/pages/Pipeline.jsx#L89-L90)). **Only a *closed* journey leaves the board** — the board hides rows with a `final_outcome` unless "Show closed" is ticked ([`pipeline.service.js:171`](../backend/src/services/pipeline.service.js#L171)).

- **Hold is fully reversible.** Record "Approved" on the same stage later and the candidate advances normally. Nothing expires a hold automatically; the Analytics page has an **"on hold > 30 days"** tile so forgotten holds surface ([`pipeline.service.js:1334`](../backend/src/services/pipeline.service.js#L1334)). The board has an **"On Hold only"** filter.
- **Rejection triggers two cooling-off rules** ([`rejectionCooldown.js`](../backend/src/utils/rejectionCooldown.js)), deliberately different lengths:
  - **90 days** — the candidate is hidden from Candidate Screening search results, so recruiters do not keep rediscovering the same person. Soft: findable by name.
  - **6 months** — creating a *new* pipeline journey for them is refused outright (HTTP 409). Hard policy gate, applies however the candidate was found. Vendor uploads are not blocked by it — they are accepted and *flagged* instead, because a vendor cannot know.

### ⚠️ Two gaps HR should know about

- **A rejected candidate is not auto-closed**, and the **"Close candidate record…"** button appears **only at the Offer stage** ([`PipelineDrawer.jsx:2061-2076`](../frontend/src/components/pipeline/PipelineDrawer.jsx#L2061-L2076)). Someone rejected at Technical Round 1 therefore stays on the board indefinitely. There is also no "Rejected only" filter. → **Gap G2**
- **There is no reopen action.** A closed journey refuses further changes with a message that says *"Reopen it before you…"* ([`pipeline.service.js:89-96`](../backend/src/services/pipeline.service.js#L89-L96)) — but no reopen endpoint exists on the route list. Closure is currently permanent. → **Gap G3**

> ✅ **CLOSED.** Closure-from-any-stage shipped 2026-08-26 (the "only at Offer" limitation above is
> gone); reopen (`POST /api/pipeline/:id/reopen`, a "Reopen record" button) also shipped 2026-08-26.
> The "Rejected only" filter and reject-and-close checkbox shipped 2026-08-27. See the changelogs
> linked at the top of this document.

---

## A3. What happens if a position is closed — what happens to its candidates?

### How a position closes

**Automatically, and only one way: when accepted offers reach `number_of_positions`** ([`mrfClosure.service.js:90`](../backend/src/services/mrfClosure.service.js#L90)). A 3-opening requisition stays open until all three are filled. There is no manual "close this position" button.

Closure writes **one dedicated column, `rpa_mrf.filled_at`** — no status column is touched. This is deliberate and hard-won: the earlier implementation overwrote `approval_status` and `mrfstatus`, which was lossy and could rewrite unrelated rows. "Approved" and "Filled" are independent facts (full reasoning in [`2026-08-11-mrf-filled-at.sql`](../backend/prisma/ddl/2026-08-11-mrf-filled-at.sql)).

### Immediate effects

- The role **leaves the JD dropdown** — `getApprovedRoles` filters `filled_at IS NULL` ([`screening.service.js:19-47`](../backend/src/services/screening.service.js#L19-L47)).
- Its Redis role cache is cleared and an `mrf:closed` socket event refreshes open browsers, so nobody keeps working from a stale dropdown.
- An in-app notification fires that **includes how many candidates are still in progress** for that role.

### What happens to candidates already in the pipeline

**Nothing automatic. They are not removed, not rejected, not closed.** Their cards keep running and gain an orange **"Role filled"** warning tag whose tooltip reads: *"All openings on this requisition are filled — this candidate is still in progress. Continue only if you intend to re-open the role or are holding them as a backup."* ([`Pipeline.jsx:177-181`](../frontend/src/pages/Pipeline.jsx#L177-L181)).

The recruiter decides per candidate: keep as backup, close them out, or reject with a reason. This is intentional — a backup candidate for a role that may re-open is legitimate.

### It un-closes itself

If the hire **backs out**, **does not join**, is **joined-and-left**, or the offer is amended away from accepted, the seat frees and the requisition **auto-reopens** — `filled_at` back to NULL, role returns to the JD dropdown, notification sent ([`reopenMrfIfUnfilled`](../backend/src/services/mrfClosure.service.js#L218)). Shortlisting into a filled requisition is still *allowed* (backup candidates), but logged server-side as likely-stale-dropdown ([`pipeline.service.js:1209-1230`](../backend/src/services/pipeline.service.js#L1209-L1230)).

---

## A4. How do I pause / hold a position (e.g. Abhijit wants to pause it for a few months)?

### Today: you cannot — there is no pause state for a requisition

MRF statuses are `pending / approved / rejected / completed` (plus the separate protected *raise status*: `pendingfromleader`, `managersubmitted`, …). `filled_at` is the only "stop hiring" flag and **only offer acceptance writes it**. Nothing in the MRF page offers Pause or On Hold.

### A half-built feature already exists in the database

`rpa_candidate_pipeline.is_paused` exists ([`schema.prisma:685`](../backend/prisma/schema.prisma#L685)), is returned on every board card ([`pipeline.service.js:342`](../backend/src/services/pipeline.service.js#L342)), and is a column in the CSV export ([`pipeline.export.js:108`](../backend/src/exports/pipeline.export.js#L108)) — but **nothing ever sets it**. No API route, no UI control. It is permanently `false`.

### Workarounds available right now

| Option | How | Trade-off |
|---|---|---|
| **Hold each candidate** | Record **Hold** with reason *"Other reasons → position paused until <date>"* | Keeps the full record, filterable via "On Hold only", visible in the on-hold>30d tile. But it is per-candidate, and it emails each candidate a Hold outcome mail |
| **Change the MRF approval status** | An admin moves it out of `approved`/`completed` so it leaves the JD dropdown | Overloads "approval" with "hiring state" — exactly the lossy pattern the `filled_at` refactor was done to eliminate. Not recommended |

→ Proper fix planned as **Gap G1** in Part C.

> ✅ **CLOSED, 2026-08-26.** `is_paused` is now written (`POST /api/pipeline/:id/pause`), and a
> requisition can be paused/manually closed with a reason (`POST /api/mrf/:id/close`/`/reopen`,
> `paused_at`/`closed_at`/`closure_reason` columns). This predates and differs in shape from the
> `paused_at`/`resume_on` design in Part C below — see
> [CHANGES-2026-08-26-closure-followon-mrf-lifecycle.md](changelog/CHANGES-2026-08-26-closure-followon-mrf-lifecycle.md)
> for what actually shipped.

---

## A5. Outlook conversations are missing from the Candidate Pipeline

The observation is correct, and the inconsistency is real. **Three different implementations exist:**

| Page | What you get today | Endpoint |
|---|---|---|
| **Candidate Screening** | Full thread, grouped by `conversation_id`, both directions, **with threaded reply** (Graph `createReply`) | `GET /api/screening/outlook/conversations?email=` and `POST /api/screening/outlook/reply` ([`screening.routes.js:108,114`](../backend/src/routes/screening.routes.js#L108)) |
| **Search Candidates** (`/candidates`) | A flat "Conversations" modal that renders **only `body_preview`** — truncated to **255 characters at ingest** ([`outlookReader.service.js:57`](../backend/src/services/outlookReader.service.js#L57)). No full body, no attachments, no reply | `GET /api/candidates/:id/emails` ([`candidate.controller.js:92`](../backend/src/controllers/candidate.controller.js#L92)); rendering at [`Candidates.jsx:1215`](../frontend/src/pages/Candidates.jsx#L1215) |
| **Candidate Pipeline** | **No Outlook data at all.** The drawer's "emails" list is *synthesised from pipeline events* — shortlist notice, Zeko invite, interview invite, document request, outcome email. Outbound only; **candidate replies never appear** | Built client-side in [`PipelineDrawer.jsx:312-682`](../frontend/src/components/pipeline/PipelineDrawer.jsx#L312-L682) |

**The data is already there.** Inbound mail is stored in `rpa_email_messages` — full `body_html`, `attachments_json`, `direction`, `conversation_id` — and linked to the candidate by the [`inboundEmailSync`](../backend/src/jobs/inboundEmailSync.js) job. The pipeline drawer simply never queries it. → **Gap G4**

> ✅ **CLOSED, 2026-08-27.** The pipeline drawer now has a "Conversation with candidate" panel
> (`GET /api/pipeline/:id/conversations`) reading the real thread, reply included. C4.2 (full bodies
> in Search Candidates, vs. this drawer fix) was not part of this pass and remains open if wanted.

---

## A6. There are a lot of clicks in the Candidate Pipeline — how do we reduce them?

### The actual count today

| Action | Clicks |
|---|---|
| Approve a round | **3** — card → *Approve* → *Save & send email* |
| Reject or Hold a round | **~5** — card → *Reject* → reason dropdown (×2) → *Save & send email* |
| Plus | horizontal scrolling across **11 stage columns** |

### Why it feels heavier than three clicks

- **No multi-select and no bulk actions** — strictly one candidate at a time, even for ten identical rejections.
- **No drag-and-drop** between columns, and **no keyboard shortcuts**.
- Every outcome **opens a modal that loads an email preview** (with a spinner wait) even when nobody intends to edit the text ([`PipelineDrawer.jsx:2215-2230`](../frontend/src/components/pipeline/PipelineDrawer.jsx#L2215-L2230)).
- **Rejected and held cards never leave the board** (A2), so it keeps growing and live work gets harder to find.
- **Closure is only reachable at the Offer stage**, so dead records accumulate.

→ Reduction plan as **Gap G5** in Part C.

> ⏸ **ACKNOWLEDGED, DEFERRED — 2026-08-27.** Not started. Logged for a future session; the
> bulk-approve scope question to the Recruitment Team is still open ahead of Phase 3.

---

## A7. Does every recruiter see the same board, or only their own candidates?

**One shared board — identical for every recruiter.**

`GET /api/pipeline` applies **no per-user filter at all**. The only parameters are `source`, `on_hold_only`, `mrf_id`, `stuck_days`, `position`, `include_closed` ([`pipeline.controller.js:24-35`](../backend/src/controllers/pipeline.controller.js#L24-L35)).

Access is gated by three layers ([`pipeline.routes.js:10-15`](../backend/src/routes/pipeline.routes.js#L10-L15)):
1. `authenticate` — valid session
2. `requireStaff` — recruiter rank or above; **vendors are refused outright**, by role and not merely by a permission checkbox
3. `checkModuleAccess('recruitment_pipeline')` — the per-user module toggle in the Admin Portal

`rpa_candidate_pipeline` has **no owner / assigned-recruiter column** ([`schema.prisma:675-704`](../backend/prisma/schema.prisma#L675-L704)) — only `source` and `vendor_email`. Accountability is per-action instead: every stage event stores `acted_by`, and the drawer timeline shows which user made each decision.

**Vendors never see this board.** They see only their own submissions in the vendor dashboard, protected by the 90-day ownership lock.

**If HR wants a "my candidates" view**, the data already exists — `rpa_shortlisted_candidates.shortlisted_by` records who shortlisted each person and is already surfaced in the drawer header. Only the filter is missing. → **Gap G6**

> ✅ **CLOSED, 2026-08-27.** A "My candidates" board filter now exists, resolved server-side to the
> caller's own username. Shipped as a plain string filter rather than the `shortlisted_by_user_id`
> design in Part C below — a staging data-quality check (only 36% of `shortlisted_by` values matched
> a current username; the rest were stale test data, not a systemic problem) found the schema change
> unnecessary.

---

# Part B — Gap register

| ID | Gap | User impact | Effort (est.) | Priority |
|---|---|---|---|---|
| **G1** | No way to pause a requisition; `is_paused` is dead code | Cannot honour "pause this role for 3 months" without misusing approval status | 2–3 days | **High** |
| **G2** | Rejected candidates never leave the board; closure only at Offer stage | Board fills with dead cards; more scrolling, more clicks | 1–2 days | **High** |
| **G3** | No reopen for a closed journey — the error message promises one | A mis-clicked closure is unrecoverable in-app | 1–2 days | Medium |
| **G4** | Outlook conversations absent from the pipeline drawer; truncated in Search Candidates | Recruiter must leave the board to read what the candidate said | 2–3 days | **High** |
| **G5** | No bulk actions, no inline card decisions, forced email preview | Every decision costs 3–5 clicks and a modal wait | 4–6 days (phased) | Medium |
| **G6** | No per-recruiter view | Cannot answer "what's on my plate?" | 1–2 days | Medium |

Effort figures are engineering estimates for build + test on a familiar codebase; they exclude UAT and deployment windows.

> **Status as of 2026-08-27:** G1 ✅ closed 2026-08-26 · G2 ✅ closed (core 2026-08-26, remainder
> 2026-08-27) · G3 ✅ closed 2026-08-26 · G4 ✅ closed 2026-08-27 · G5 ⏸ acknowledged, deferred ·
> G6 ✅ closed 2026-08-27. Details inline at each gap below and in Part C.

---

# Part C — Implementation plans

> **Conventions that apply to every plan below**
>
> - **The Prisma schema is never hand-edited.** Write a DDL file in [`backend/prisma/ddl/`](../backend/prisma/ddl/) with a matching `.README.md`, apply it to PostgreSQL, then run `npx prisma db pull && npx prisma generate`. Follow the format of [`2026-08-11-mrf-filled-at.sql`](../backend/prisma/ddl/2026-08-11-mrf-filled-at.sql) — idempotent, additive, non-destructive, with the reasoning in the header comment.
> - DDL must be applied **once per environment** (staging, then production), same convention as the seed scripts.
> - Every write path in this module already uses a **claim-then-act guard** plus a **stale-tab `expected_stage_key` check**. Any new mutating endpoint must adopt both — see [`setStageOutcome`](../backend/src/services/pipeline.service.js#L611) for the reference implementation.
> - New outcomes/statuses need a matching entry in [`stageNotification.service.js`](../backend/src/services/stageNotification.service.js) template mapping, or they silently send no email.

---

## G1 — Pause a requisition (and finish `is_paused`)

> ✅ **CLOSED — built 2026-08-26**, before this document's analysis was even finalized. Shipped
> shape differs from the design below (no `resume_on` reminder date; `paused_by`/`paused_reason`
> exist, manual MRF closure uses `closed_at`/`closure_reason`/`closure_note` instead of overloading
> `paused_at`). See
> [CHANGES-2026-08-26-closure-followon-mrf-lifecycle.md](changelog/CHANGES-2026-08-26-closure-followon-mrf-lifecycle.md).
> The design below is kept for its reasoning, not as a description of what shipped.

**Problem.** "Abhijit wants to pause this role for a few months" has no representation in the system. The only levers are misusing `approval_status` (lossy) or holding each candidate individually (per-candidate, and it emails them).

**Design.** Mirror the `filled_at` pattern exactly, because it already solved this class of problem: a **dedicated nullable timestamp column**, independent of any status column, that reads as "not hiring right now" and clears to NULL to resume.

### Database

New DDL: `backend/prisma/ddl/2026-XX-XX-mrf-paused.sql`

```sql
ALTER TABLE rpa_mrf
  ADD COLUMN IF NOT EXISTS paused_at     TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS paused_reason TEXT        NULL,
  ADD COLUMN IF NOT EXISTS paused_by     INTEGER     NULL,
  ADD COLUMN IF NOT EXISTS resume_on     DATE        NULL;

COMMENT ON COLUMN rpa_mrf.paused_at IS
  'When hiring on this requisition was paused (NULL = active). Independent of approval_status and filled_at.';
```

`resume_on` is the "pause until March" date — advisory, drives a reminder, never auto-resumes (auto-resuming a role nobody re-checked is worse than a nudge).

Extend the partial index so the hot "still hiring?" read stays cheap:

```sql
CREATE INDEX IF NOT EXISTS idx_rpa_mrf_hiring
  ON rpa_mrf (id)
  WHERE filled_at IS NULL AND paused_at IS NULL;
```

### Backend

1. **New module** `backend/src/services/mrfPause.service.js`, structured like [`mrfClosure.service.js`](../backend/src/services/mrfClosure.service.js): `pauseMrf(mrfId, { reason, resumeOn, actedBy })` and `resumeMrf(mrfId, { actedBy })`. Both must clear the Redis key `screening:role:${mrfId}` and `broadcast('mrf:paused', …)`, exactly as the closure path does — otherwise the client-side roles dropdown (held with `staleTime: Infinity`) keeps offering a paused role.
2. **Add a helper** `isMrfPaused(mrf)` to [`config/pipelineStages.js`](../backend/src/config/pipelineStages.js) alongside the existing `isMrfFilled`, so consumers ask a function rather than inspecting columns.
3. **Filter the JD dropdown** — add `AND paused_at IS NULL` to `getApprovedRoles` ([`screening.service.js:19-47`](../backend/src/services/screening.service.js#L19-L47)). ⚠️ The approval test there **must stay parenthesised** — the existing comment explains why (`AND` binds tighter than `OR`).
4. **Routes** on the MRF router: `POST /api/mrf/:id/pause`, `POST /api/mrf/:id/resume`, both `requireAdmin` (pausing a requisition is a management decision, not a recruiter one).
5. **Notification** — add `MRF_PAUSED` to `NOTIFICATION_TYPES` and notify on both transitions, including the count of candidates still in flight (reuse the "stranded" count logic from [`closeMrfIfFilled`](../backend/src/services/mrfClosure.service.js#L158-L168)).
6. **Suppress nudges while paused** — check `isMrfPaused` in [`jobs/offerSweep.js`](../backend/src/jobs/offerSweep.js) and the document-reminder path so a paused role stops chasing people.

### Per-candidate pause — finishing `is_paused`

The column, the card field and the CSV column already exist; only the write path and the control are missing.

7. `POST /api/pipeline/:id/pause` and `/resume` in [`pipeline.controller.js`](../backend/src/controllers/pipeline.controller.js) → new `setPaused(pipelineId, { paused, actedBy })` in [`pipeline.service.js`](../backend/src/services/pipeline.service.js). Must call `assertJourneyOpen` and write a `pipeline_stage_events` row (`event_type: 'pause'` / `'resume'`) so the timeline records it. **No candidate email** — a pause is internal.
8. When a **requisition** is paused, offer the admin a checkbox "also pause the N candidates in flight" that bulk-sets `is_paused`. Keep the two concepts separate in the data; link them only through this convenience action.

### Frontend

9. **MRF page** — Pause / Resume action with a reason + "resume on" date modal; a `Paused` tag in the status column; a filter option.
10. **Pipeline board** — a grey **"Position paused"** tag on affected cards (same treatment as the existing "Role filled" tag, [`Pipeline.jsx:177-181`](../frontend/src/pages/Pipeline.jsx#L177-L181)), and a "Hide paused" filter checkbox.
11. **Drawer** — a banner when the journey or its requisition is paused, and a Pause/Resume toggle.

### Tests

- Unit: `isMrfPaused` truth table; `getApprovedRoles` excludes paused, includes resumed.
- Integration: pause → role gone from dropdown → resume → role returns; pause does not alter `approval_status` or `filled_at`; a paused MRF's candidates stay on the board and stay decidable.
- Regression: a **filled** requisition that is then paused must not be resurrected by resume — the two flags are independent and both must be NULL to hire.

---

## G2 — Let rejected candidates leave the board

> ✅ **CLOSED.** C2.1 (closure from any stage) shipped 2026-08-26 as part of the closure
> graceful-exit work — see
> [CHANGES-2026-08-26-candidate-closure-graceful-exit.md](changelog/CHANGES-2026-08-26-candidate-closure-graceful-exit.md).
> C2.2 (reject-and-close checkbox) and C2.3 (rejected-only filter, closed-count label) shipped
> 2026-08-27 as designed below — see
> [CHANGES-2026-08-27-pipeline-gap-closeout.md](changelog/CHANGES-2026-08-27-pipeline-gap-closeout.md).
> The migration-note admin script for historical rejected-but-open journeys was not built.

**Problem.** A rejection sets `current_stage_status='rejected'` but leaves `final_outcome` NULL, so the card never leaves. Closure — the only thing that removes it — is reachable **only from the Offer stage** ([`PipelineDrawer.jsx:2061-2076`](../frontend/src/components/pipeline/PipelineDrawer.jsx#L2061-L2076)). Boards therefore accumulate dead cards, which is also a root cause of the click complaint (A6).

**Design.** Two independent changes; either helps, both together fix it.

### C2.1 — "Close candidate record" available at every stage (recommended first)

Move the `onClose={() => setClosureOpen(true)}` control out of `OfferActions` and into the shared outcome bar, so it renders for any open journey. The closure modal, the 8 closure statuses (`CLOSURE_OPTIONS`, [`PipelineDrawer.jsx:2911`](../frontend/src/components/pipeline/PipelineDrawer.jsx#L2911)) and `setFinalOutcome` all already work from any stage — `finalStatusLabelFor(current_stage_key, outcome)` is stage-aware and `setFinalOutcome` validates the key against `FINAL_OUTCOMES` ([`pipeline.service.js:931-943`](../backend/src/services/pipeline.service.js#L931-L943)). **Backend needs no change**; this is a UI placement fix plus a confirmation copy review.

### C2.2 — Offer to close immediately after a rejection

In the outcome modal, when the outcome is **Reject**, add a checkbox: **"Close this candidate's record as Rejected"** (default **on** for non-Zeko stages, default **off** for Zeko rounds where a re-decision is more common). On submit, call `setStageOutcome` then `setFinalOutcome('closure_rejected')`.

Sequence them as **two calls from the client**, not a new combined service function — `setFinalOutcome` runs `reopenMrfIfUnfilled` and its own notification/email path, and folding it into `setStageOutcome`'s transaction risks a partial state. Keep them independent and let the second fail loudly if it fails.

### C2.3 — Board affordances

- Add a **"Rejected only"** filter alongside "On Hold only" — one line in `listPipeline`'s `where` clause ([`pipeline.service.js:162-172`](../backend/src/services/pipeline.service.js#L162-L172)) plus a checkbox.
- Show the closed-card count in the "Show closed" label: *"Show closed (48)"* — makes the hidden history discoverable.

### Migration note

Existing boards already carry historical rejected-but-open journeys. Offer a **one-off admin script** (`backend/prisma/`-style, run manually per environment) that closes rejections older than N days as `closure_rejected` with a note saying it was a bulk tidy-up. **Do not run it automatically on deploy** — it sends no emails and writes `final_outcome`, so it must be a deliberate, reviewed action.

### Tests

- Closure from a non-offer stage produces the right `status_label` and legacy `FinalStatus` write.
- Reject + auto-close leaves exactly one outcome event and one closure event, in order.
- A closed-as-rejected journey disappears from the default board and reappears under "Show closed".

---

## G3 — Reopen a closed journey

> ✅ **CLOSED — built 2026-08-26**, before this document's analysis was even finalized. Shipped
> largely as designed below (`reopenJourney`, `POST /api/pipeline/:id/reopen`, admin-gated, mandatory
> reason, "Reopen record" button beside the closed tag). See
> [CHANGES-2026-08-26-closure-followon-mrf-lifecycle.md](changelog/CHANGES-2026-08-26-closure-followon-mrf-lifecycle.md).

**Problem.** [`assertJourneyOpen`](../backend/src/services/pipeline.service.js#L89-L96) tells the user *"Reopen it before you …"* but there is no reopen route. The message promises a capability the system does not have. `reopenMrfIfUnfilled` reopens **requisitions**, not candidate journeys.

**Design.** Reopening must be **narrow, audited, and admin-only** — it un-does a terminal decision that may already have emailed the candidate.

### Backend

1. `reopenJourney(pipelineId, { reason, actedBy })` in [`pipeline.service.js`](../backend/src/services/pipeline.service.js):
   - Refuse if `final_outcome` is NULL (nothing to reopen).
   - Refuse — or require an explicit `force` flag from a superadmin — when the closure was `joined`, since downstream systems may already treat that person as an employee.
   - In one transaction: clear `final_outcome` and `closed_at`, set `current_stage_status` back to `'in_progress'`, and write a `reopened` stage event carrying the previous outcome and the mandatory reason.
   - After commit, call `closeMrfIfFilled(mrf_id)` — reopening a `backed_out` journey may re-fill a requisition that had re-opened. This is the mirror of what [`setFinalOutcome` does at line 1039](../backend/src/services/pipeline.service.js#L1039).
   - **Send no candidate email.** Reopening is an internal correction; the candidate already received the closure mail and a silent reversal must not generate a confusing second message.
2. Route `POST /api/pipeline/:id/reopen`, gated `requireAdmin`.
3. Notify the team in-app, since a card is about to reappear on everyone's board.

### Frontend

4. In the drawer, when `pipeline.final_outcome` is set, show a **"Reopen record…"** button next to the existing `Closed — <outcome>` tag ([`PipelineDrawer.jsx:1990`](../frontend/src/components/pipeline/PipelineDrawer.jsx#L1990)), visible to admins only, opening a modal that requires a typed reason.

### Tests

- Reopen restores the card to the default board at its previous stage.
- Reopening a `backed_out` closure re-fills the MRF when that was the last free opening.
- A non-admin gets 403; reopening an already-open journey gets a clear 4xx, not a silent no-op.

---

## G4 — Outlook conversations in the pipeline drawer (and full bodies in Search Candidates)

> ✅ **C4.1 CLOSED — built 2026-08-27**, largely as designed below: new
> `GET /api/pipeline/:id/conversations`, a "Conversation" tab in the drawer distinct from the
> existing synthetic log, reply reused from the existing `/screening/outlook/reply` endpoint. One
> deliberate deviation: bodies render as plain text (stripped, not sanitised HTML) rather than a
> sanitised HTML render, reusing `CandidateScreening.jsx`'s existing `cleanMsgBody()` approach —
> extracted to a shared `frontend/src/utils/emailText.js` in the process. See
> [CHANGES-2026-08-27-pipeline-gap-closeout.md](changelog/CHANGES-2026-08-27-pipeline-gap-closeout.md).
> **C4.2 (full bodies in Search Candidates) was not part of this pass — still open.**

**Problem.** See A5. Three inconsistent implementations; the pipeline — where recruiters spend their day — has the weakest one, showing outbound system mail only.

**The data already exists**, so this is a read-path and UI change with no new ingestion work: `rpa_email_messages` holds `body_html`, `attachments_json`, `direction`, `conversation_id`, and links via `candidate_id` / `shortlist_id` ([`schema.prisma:284-316`](../backend/prisma/schema.prisma#L284-L316)).

### C4.1 — Conversations tab in the pipeline drawer

1. Add `GET /api/pipeline/:id/conversations` to [`pipeline.routes.js`](../backend/src/routes/pipeline.routes.js) — **register it before `/:id`**, the same way `/analytics` and `/export` are, or Express captures it as an id.
2. The controller resolves the journey → candidate email, then delegates to the **existing** `screeningService.getOutlookConversations(email)` ([`screening.service.js:2839`](../backend/src/services/screening.service.js#L2839)). One implementation, two entry points — do not fork the query.
   - Use [`emailCandidates()`](../backend/src/utils/emailMatch.js) for address matching, not raw equality. The codebase learned this the hard way in the Zeko score-attribution defects; candidates have multiple addresses (`candidate_email_all`).
3. Reply support: reuse `POST /api/screening/outlook/reply` from the drawer rather than adding a second reply endpoint.
4. In [`PipelineDrawer.jsx`](../frontend/src/components/pipeline/PipelineDrawer.jsx), add a **Conversations** tab beside the existing timeline/email-log. **Keep the existing synthetic email log** — it answers a different question ("did the system send the outcome mail, and did it deliver?") than the Outlook thread ("what did the candidate actually say?"). Label them clearly: *"System emails"* vs *"Conversation"*.
5. Show an unread/reply-count badge on the tab when the latest message is inbound — that is the signal a recruiter is actually looking for.

### C4.2 — Full bodies in Search Candidates

6. [`Candidates.jsx:1215`](../frontend/src/pages/Candidates.jsx#L1215) renders `body_preview` (255 chars, truncated at ingest). Render **`body_html`** instead, sanitised, with the preview as fallback for older rows. Add attachment names from `attachments_json`.
7. Consider switching that modal to the same grouped-thread component as Screening, so all three pages converge on one implementation.

### Security note

`body_html` is third-party HTML from an external mailbox. It **must** be sanitised before render (the Screening page's existing thread view is the reference for how this is already handled). Do not introduce a second, unsanitised render path.

### Tests

- A candidate with two addresses sees threads from both.
- A journey whose candidate has no mail shows an empty state, not an error.
- Reply from the drawer lands in the same Outlook thread (`conversation_id` preserved) and appears immediately in the list.

---

## G5 — Reduce clicks

> ⏸ **ACKNOWLEDGED, DEFERRED — 2026-08-27.** Not started this pass; explicitly logged for a future
> session rather than silently dropped. Before Phase 3 (bulk actions) begins, the Recruitment Team
> still needs to answer whether bulk **approve** should be offered at all, or only bulk reject/hold.

**Problem.** See A6. Phased so each phase ships independently and is individually measurable.

### Phase 1 — cheapest wins (~1–2 days)

1. **Collapse the email preview by default.** In the outcome modal, render a one-line summary — *"Standard email: `<template name>` will be sent"* — with an **"Edit email"** toggle that expands the editor. Removes the spinner wait and one visual step from every decision. The recruiter-edited subject/body already fall back to a server-side compile when omitted ([`setStageOutcome` params](../backend/src/services/pipeline.service.js#L611)), so **no backend change is needed** — omit the overrides when untouched.
2. **Remember the last-used reason** per stage within a session — one dropdown interaction instead of two on repeated rejections.
3. **Ship G2** — a board without dead cards is measurably less scrolling.

### Phase 2 — inline card actions (~2 days)

4. Add hover actions on the card (✓ / ✕ / ⏸) that open the outcome modal **pre-set to that outcome**, skipping the drawer entirely. Approve then costs **2 clicks** (✓ → confirm) instead of 3.
5. Keep the drawer as the full view — inline actions are a shortcut for the routine case, never a replacement.

### Phase 3 — bulk actions (~2–3 days)

6. Checkbox multi-select within a column, then **one** outcome + **one** reason applied to N candidates.
7. New endpoint `POST /api/pipeline/bulk-outcome` taking `{ pipeline_ids[], outcome_key, reason_id, other_text, notes }`.
   - Process **sequentially, not in a single transaction** — each journey has its own claim guard, its own email, its own vendor notification. One failure must not roll back the others.
   - Return a **per-journey result array** (`{ id, ok, error }`) and have the UI report *"7 of 9 updated — 2 were moved by someone else"*.
   - Send emails **after** all writes, best-effort, exactly as the single-outcome path does.
   - Rate-limit it: 50 candidates × 2 emails is a mail-provider burst.
8. ⚠️ Bulk **approve** should be restricted or given a stronger confirmation — bulk-advancing people through interview stages is far riskier than bulk-rejecting.

### Phase 4 — optional (~1–2 days)

9. Saved filter presets per recruiter ("my roles", "stuck > 10 days"), stored in user settings.
10. Document the "Ask the board" vocabulary in-product (a tooltip listing the words it understands) — today users guess at a parser that only knows a fixed keyword set.

**Explicitly not recommended:** drag-and-drop between columns. Every stage transition requires a mandatory reason and sends candidate email; a gesture that is trivially triggered by accident is the wrong input for an irreversible, outbound-email-sending action.

---

## G6 — "My candidates" view

> ✅ **CLOSED — built 2026-08-27**, with one deliberate deviation: shipped as a plain string filter
> (`shortlisted_by = caller's own username`, resolved server-side) rather than the
> `shortlisted_by_user_id` backfill+DDL design below. The pre-work data-quality check this section
> calls for was done first: only 36% of `shortlisted_by` values on staging matched a current
> username — the rest were stale/test data (`phase3-testpass`, etc.), not an ongoing integrity
> problem, so the schema change was judged unnecessary. See
> [CHANGES-2026-08-27-pipeline-gap-closeout.md](changelog/CHANGES-2026-08-27-pipeline-gap-closeout.md).

**Problem.** Every recruiter sees an identical board (A7). There is no way to answer "what is on my plate?".

**Design.** Do **not** add a hard ownership model — shared visibility is a deliberate, working property of this team's process, and vendor isolation already handles the case that genuinely needs walls. Add a **filter**, not a permission.

### Backend

1. `rpa_shortlisted_candidates.shortlisted_by` is a `VarChar(255)` ([`schema.prisma:229`](../backend/prisma/schema.prisma#L229)), not a foreign key — verify in each environment whether it holds a username or an email before matching on it. If it is inconsistent, resolve it to a user id in a small backfill and add `shortlisted_by_user_id INTEGER` via DDL.
2. Add an `ownedBy` filter to [`listPipeline`](../backend/src/services/pipeline.service.js#L156) that filters on the joined shortlist row, plus `owner` on each card so the UI can display it.
3. Controller: accept `owned_by=me` and resolve it to `req.user` server-side — **never** trust a client-supplied user id for this.
4. Add the owner column to the CSV export ([`pipeline.export.js`](../backend/src/exports/pipeline.export.js)).

### Frontend

5. A **"My candidates"** toggle in the filter bar, and the owner's name on the card's secondary line (next to position · source).
6. Optionally remember the toggle per user, so a recruiter who prefers their own view gets it on load — but keep the full board one click away.

### Analytics

7. `getPipelineAnalytics` can then break down funnel/stuck/hold by owner, which is what makes "Recruiter Insights" genuinely per-recruiter rather than team-wide.

### Tests

- The filter is a **view**, not a permission: clearing it must still show every candidate to any staff user.
- Journeys with no shortlist row (keyword shortlists carry `mrf_id = null`) must not vanish when the filter is off.

---

# Part D — Suggested sequencing

> ✅ **Superseded by events, 2026-08-27.** This sequencing assumed G1/G3/G2-core were still open;
> they were already built 2026-08-26. The order actually followed for the remainder was: G2
> remainder → G4 → G6, all 2026-08-27, with G5 deferred. See the per-gap stamps above and the gap
> register status line in Part B.

| Order | Work | Why first |
|---|---|---|
| 1 | **G2** — closure from any stage + reject-and-close | Smallest change, no DDL, immediately shrinks the board and partly answers the click complaint |
| 2 | **G5 Phase 1** — collapse email preview, remember reason | No backend change; every recruiter feels it on every decision |
| 3 | **G4** — conversations in the drawer | Highest day-to-day value; data already exists, so it is read-path only |
| 4 | **G1** — pause a requisition | Needs DDL and an environment-by-environment rollout; start it once the quick wins are out |
| 5 | **G6** — my candidates | Depends on verifying `shortlisted_by` data quality first |
| 6 | **G3** — reopen a journey | Corrective capability; lower frequency than the above |
| 7 | **G5 Phases 2–4** — inline + bulk actions | Largest surface area; benefits most from G2 having already cleaned the board |

**Before any of it starts, confirm with the Recruitment Team:**

1. **G1** — should pausing a requisition also pause its in-flight candidates by default, or is that always a separate decision?
2. **G2** — should Reject auto-close by default, and does that differ between Zeko rounds and interview rounds?
3. **G3** — who may reopen a closed record, and should reopening a `joined` closure be possible at all?
4. **G5** — is bulk **approve** wanted, or should bulk actions be limited to reject/hold?
5. **G6** — is "my candidates" defined by *who shortlisted them* (available today) or by an explicit assignment step (new workflow, more work)?

---

*Prepared from a read-only analysis of the codebase on 2026-08-26. No application code, schema or configuration was modified. All Part C designs are proposals pending Recruitment Team and engineering approval.*

---

**Gap register closed, 2026-08-27.** G1/G2/G3/G4/G6 built (see stamps above and
[CHANGES-2026-08-27-pipeline-gap-closeout.md](changelog/CHANGES-2026-08-27-pipeline-gap-closeout.md)
for the 2026-08-27 items); G5 acknowledged and deferred to a future session. This document is kept
as-is otherwise — its Part A/Part C prose is a historical record of the analysis, not rewritten to
match what shipped.
