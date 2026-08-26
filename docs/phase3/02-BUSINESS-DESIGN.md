# Phase 3 — Business-Level Design

**Document 2 of 4** · Status: **⚠️ CORRECTION (2026-07-14 meeting): sign-off NOT received** — see [01-PROCESS-UNDERSTANDING.md](01-PROCESS-UNDERSTANDING.md) header and [MEETING-NOTES-2026-07-14.md](MEETING-NOTES-2026-07-14.md) Gap #2 for the full correction. **Status reverts to: Draft.** RT answers applied 2026-07-13 and substantially refined on the 2026-07-14 call (see inline updates below); formal written sign-off is still owed (tracked in [04-QUESTIONS.md](04-QUESTIONS.md) §E).
Companion docs: [01-PROCESS-UNDERSTANDING.md](01-PROCESS-UNDERSTANDING.md) · [03-DEVELOPMENT-PLAN.md](03-DEVELOPMENT-PLAN.md) · [04-QUESTIONS.md](04-QUESTIONS.md)

This document describes **what the application will look like and how it will behave** — business level, no code detail. Technical implementation is in [03-DEVELOPMENT-PLAN.md](03-DEVELOPMENT-PLAN.md).

---

## 1. Centerpiece: the Interview Pipeline Tracker

A new screen where the recruitment team tracks every candidate's interview journey end-to-end, modeled on how leading enterprise ATS products (Greenhouse, Lever, Zoho Recruit, Workable) and the Zeko dashboard present candidate round status.

### 1.1 Pipeline board (kanban view)
- **The pipeline starts at Shortlisted** (RT decision, 2026-07-10): resume screening stays in the existing Candidate Screening module; a candidate enters the Tracker the moment they are shortlisted. **Shortlisting from the screening page is the only entry point — no separate manual add.** Vendor-sourced candidates take the same path and enter carrying their **vendor tag** (which drives dual-notification).
- **Stage 0 status set (RT ask, 2026-07-13):** the screening page offers **Shortlisted / Rejected / Future Prospect / Hold** as resume-screening outcomes. Only Shortlisted enters the Tracker. **Future Prospect candidates remain visible on the Screening page** as a parked-but-retrievable pool and can be re-shortlisted into a new MRF at any time; the re-application cooling-off does not apply to them (they were not rejected).
- **One column per round**: Shortlisted → HR Screening (Zeko) → IQ / Tech Assessment → Functional Screening (Zeko) → Tech 1 → Tech 2 → Tech 3 (optional) → HR Round → CEO/Final → Client Interview (optional) → Documents → Offer. Columns are rendered from the **admin-configurable stage list** (see §2 rule 1) — stages and their outcomes can be added, renamed, or reordered later without code changes (RT ask, 2026-07-13).
- **Concurrent journeys (Q13, RT 2026-07-13):** a candidate may run **two open MRFs at once** when they match the MRF/JD. The board shows **one card per candidate-per-MRF journey**; a card whose candidate is active in another journey carries a visible **concurrency badge**. (This replaces the earlier one-journey-per-candidate default. Rejection in one journey never stops the other — Q23.) **Which position proceeds if both reach a conflict is a fully manual RT decision (RT, 2026-07-14) — no automated freeze/priority logic.** The system's only job is to offer a manual action to pause/stop the *other* journey once RT decides — this closes the earlier open question about offer collision (Q25). **Whether the two journeys share a single Zeko/Evalground test result or each requires its own remains open** (Q24 — not addressed on the 2026-07-14 call).
- Each **candidate card** shows: name, position/MRF, **days-in-stage aging badge** (green → amber → red), source tag (HR / Vendor name / Email intake), current round-status chip, last outcome.
- Column headers show live counts. Filters: position/MRF, stage, status, source/vendor, aging, on-hold only.
- Advancing a candidate always captures **outcome + mandatory reason + notes** (no silent drag-through).
- **Non-negotiable — whole-DB skill-based search (RT, 2026-07-14):** a candidate must be findable by skill across the **entire database** (e.g. "all Java resources"), regardless of which MRF they are currently tagged to, with their **full stage history visible**. This is the stated point of centralizing on one ATS. Likely extends the existing candidate search / vector-embedding search rather than requiring new infrastructure — needs verification that stage history surfaces there too.

### 1.2 Candidate drawer (per-round view — RT decision, 2026-07-10)
Opens from any card. The drawer shows **one round at a time**, not everything at once:
- **Round stepper** — the full journey; clicking a completed or current round shows *that round's* details. **Future rounds are locked** (not selectable) until the candidate reaches them.
- **Per-round panel** — everything that happened in the selected round: schedule (when/interviewer/Teams), scores relevant to that round (Zeko / IQ / Technical), interviewer scorecard, outcome + reason + who decided, and the emails sent in that round.
- **Action bar on the current round only** — Approve / Reject / Hold (reason mandatory), Schedule interview, Request documents, Record offer, Close candidate. Completed rounds are read-only.

### 1.3 Round-status chips (Zeko-style)
Every interview round displays a live status:
`Not Started → Invited → Scheduled → Completed → Awaiting Feedback → Outcome (Approved/Rejected/Hold)`
This mirrors how Zeko tracks its interviews (pending → sent → completed) and extends the same language to human rounds.

### 1.4 Analytics additions (merged into the existing Analytics page — RT decision, 2026-07-10)
Pipeline analytics ships as a **new tab inside the existing Analytics page** — there will not be a second analytics page.
- **Stage funnel** — conversion rate per round, per position/MRF and per source/vendor.
- **Aging / stuck candidates** — anyone over the stage SLA, plus an **On-Hold aging view**. Hold handling is **manual only** (Q10, RT 2026-07-13) — no automated review reminder or auto-close — so this view is the working guard against candidates rotting on Hold.
- **Rejection-reason breakdown** — possible for the first time because reasons become mandatory at every stage.
- **Evalground CSV import** lives here (or on the Tracker) — see §3 Stage 2.

---

## 2. The Stage Engine (business rules)

1. **Configurable stage list — and configurable outcome sets** (strengthened per RT ask, 2026-07-13): stages are data, not hard-coded — order, active/inactive, optional flags — and **admins can add stages and add/edit the outcomes and final statuses of any stage later without code changes**. Tech Round 3 is optional; Client Interview is optional and can **float** (after a technical round or after the final round, per role).
2. **Outcomes are configurable per stage.** The default set is Approved / Rejected / Hold; Stage 0 additionally has **Future Prospect**; Closure has its own eight final statuses. Each outcome carries flags — *advances* / *final* / *terminal* — and **only an "advances" outcome moves the candidate forward**. Optional stages can be skipped (action is logged with who/when).
3. **Mandatory reason on every Reject/Hold** — the existing Stage 0 taxonomy (High Salary, High Notice, Weak Communication, Skills Mismatch, Frequent Job Changes, …) is reused at **every** stage plus a free-text **"Other reasons"** option (Q19, RT 2026-07-13). Admin-editable lists.
4. **Automated outcome email on every outcome** — templates are mapped **per stage × outcome** and are **admin-customizable through the existing Email Templates screen, including creating new templates** (RT ask, 2026-07-13; today that screen only edits existing ones); generic fallback templates apply where no specific mapping exists.
5. **Vendor dual-notification** — if the candidate is vendor-sourced, **every status-change email updates both candidate and placement vendor** as a **status-only notification: information only, no figures, no attachments** (Q5, RT 2026-07-13). The vendor never receives the offer letter or document-collection content; whether those stages send a bare status line or nothing at all is pending Q29.
6. **Full audit trail** — every stage entry, outcome, reason, email result, and skip is recorded permanently with the acting user.
7. **Closure** — final statuses: Approved, Rejected, On Hold, Candidate Withdrawn, Joined, Did Not Join, Joined and Left, Backed Out; each triggers its communication. **Definitions confirmed by RT (Q12, 2026-07-13); the record auto-closes 90 days after Joined** unless marked Joined-and-Left first.
8. **Backward compatibility promise** — existing screens (Vendor Dashboard, Analytics, Candidates) and existing status fields keep working unchanged; the new engine writes compatible values behind the scenes.
9. **Re-application cooling-off (Q11, RT 2026-07-13)** — a candidate rejected at **Stage 1 (Zeko HR Screening) or later** cannot start a new journey for **6 months**; the window can vary by rejection stage/reason (admin-configurable). Stage 0 rejections and Future Prospects are exempt. The cooling-off blocks **new** journey creation only — an active concurrent journey is never stopped by a rejection elsewhere (Q23).
10. **Custom/free-text statuses, and stage-prefixed naming, are deliberate (RT, 2026-07-14):** custom statuses beyond the default set are needed mainly at the **Shortlisted** stage and the **final/Offer** stage (7–8 statuses there). When "Other" is picked, the recruiter types the real value and the **UI must display that typed value everywhere — never the literal word "Other"** (e.g. shows "Candidate Withdrawn", not "Other"). And the existing FinalStatus write-back design (stage-prefixed labels like "Zeko HR Screening Pending") is **not a legacy compatibility shim to be simplified away** — RT explicitly wants exports/backups to show exactly which stage a profile died at, so every stage keeps its own prefixed vocabulary rather than collapsing to generic Approve/Reject.

---

## 3. Per-Stage Behavior

| Stage | Behavior in the app |
|---|---|
| **Stage 0 Resume Screening** | Candidates land here automatically from all intake paths (HR upload, vendor portal, email intake). AI screening scores shown; HR sets outcome from the extended set **Shortlisted / Rejected / Future Prospect / Hold** (RT ask, 2026-07-13) — no auto-suggestion; HR decides from the AI scores (Q15). **Future Prospect stays visible on the Screening page** and can be re-shortlisted later. Shortlisting keeps triggering the existing welcome-email + info-form flow, plus the new **"Recruitment Process & Interview Stages"** email. |
| **Stages 1 & 3 (Zeko)** | Existing Zeko scheduling/invite/results flow, now visible as round-status chips in the Tracker. Score fields: **Interview score always; Coding score for coding roles** (Zeko removed its communication score — the old `ZekoCommunicationScore` field is renamed to a coding score, RT 2026-07-14). Chhaya wants the **full Zeko test report + recording accessible in-app**, not just the score, because cheat probability matters more than the raw number — **contingent on what the Zeko API actually exposes (unvalidated, see the 🚨 top risk in [03-DEVELOPMENT-PLAN.md](03-DEVELOPMENT-PLAN.md) §M3)**. **Auto-advance rule proposed on the call (RT, 2026-07-14):** score ≥50% **and** cheat probability **Low** → system auto-advances; cheat probability **Moderate** → recruiter approval required; cheat probability **High** → auto-reject regardless of score. ⚠️ **This directly contradicts the earlier written answer to Q4 ("per-role score bands")** — the two are different systems and RT has not confirmed in writing which is authoritative; do not build either until that's resolved. Expired interview links are recorded as **"window missed"** and the recruiter decides the consequence (Q9). Zeko tests are created **per MRF/position** (not per candidate) and reused across the year; HR Screening and Functional Test are **separate Zeko tests with separate links**, managed manually in Zeko. *Note: the Zeko integration is **live** — the Phase 2.1 completion pass (M0) is done (confirmed 2026-07-14; Q17 closed).* |
| **Stage 2 IQ / Tech Assessment (Evalground)** | No Evalground API — **import only, via two supported mechanisms (RT, 2026-07-14): (a) bulk CSV upload, (b) single-candidate result report received on Outlook.** Test assignment per Q1: **non-IT = GA + English; IT = role-specific tests** chosen from Role/MRF. **Unique key = candidate email; names may repeat.** CSV columns are generic (no test name/role) — imported as-is under **Section 1/2/3 labels, which RT renames/edits afterward**; for single-candidate upload the system can prompt to map section→skill at upload time; for bulk upload **the mapping approach is not yet decided (owed by Harish)**. **Re-import behavior (RT-confirmed, 2026-07-14):** a row already in the DB is skipped; if the candidate retook the test and the score changed, **only the score is overwritten**, the rest of the record is untouched — this settles the earlier "latest vs best" open item as **latest, now confirmed by RT rather than assumed**. Candidates who never take the test show **"Evalground test pending" indefinitely and are never deleted**. **The import lives inside the Assessment round** (RT decision, 2026-07-10) — an action on the Assessment column/round panel, never a disconnected screen. HR sets Passed/Failed/Hold — **pass mark 50% for both tests** drives the auto-suggestion (Q4). |
| **Stages 4–8 (interview rounds)** | Recruiter schedules from the drawer → **Outlook calendar invite with Teams meeting link auto-sent** from the recruitment shared mailbox to candidate + interviewer(s). **Both scheduling modes ship (Q6)**: interviewer-fixed time first, then candidate self-scheduling from published slots as the second increment; interviewer **free/busy** is shown while picking (pending the Q16 grant). Self-scheduling slot conflicts are resolved by the **interviewer updating their published slots** — first-come holds a slot, no complex locking (Q31). **Automated reminders (Q7)**: candidate **30 min before** (intentional — the invite itself is the advance notice, Q28), interviewer **30 min before**, and a **daily feedback reminder until submitted** — no named-person escalation; the card is flagged "awaiting feedback" (a reminder cap is proposed — Q27). Interviewer receives a **no-login scorecard link**: structured ratings + recommendation (Approve/Reject/Hold) + comments — **Harish's "Interview Evaluation Format V2" (received 2026-07-14)**: one shared card for Technical 1–3/CEO (Skills 1–3 mandatory + 2 optional, each rated /5 in 0.5 steps with remarks; Communication & Attitude ratings + comments; Final Rating + Comments; recording link) and a **distinct HR Round card** (compensation/notice/relocation/strengths etc. — see 03 M3). HR reviews the scorecard and sets the official outcome (both are kept — recommendation vs decision). Reschedule/cancel supported with statuses — **recruiter-only triggers**; no-show is tracked but **never auto-moves the round to Hold — the recruiter decides** (Q9). |
| **Client Interview (optional)** | Manually scheduled per the doc. The app: holds the stage wherever it's placed, stores client contact details (recruiter enters them later if missing — Q14), records the transcribed client feedback + outcome, triggers candidate (+ vendor) communication. **The system never generates anything for the client** (Q14) — all client communication is manual. |
| **Document Collection** | Fires **after final interview rounds clear, before the offer is rolled out** — HR triggers the request → candidate gets a secure upload link (no login) → multi-file upload → HR verifies each document (verify / reject-with-reason → automatic re-request loop) → completeness is automatic, authenticity stays human. **Request email template received (Chhaya, 2026-07-14)** — congratulates the candidate, asks for the **last 3 months' payslips "ASAP"** to roll out the offer, plus a note that **permanent address and one government ID (showing DOB + father's name)** are needed to share the offer. **⚠️ This is narrower than the earlier proposed default checklist** (which also included education certificates and experience/relieving letters) — confirm with RT whether the real checklist is this short or those are collected elsewhere. Documents stored in company OneDrive; **never visible to vendors** (Q5). **Retention (RT-confirmed, 2026-07-14): documents are never deleted** — records get pulled up to 3 years later for appraisals. If storage requires it, older documents **archive to SharePoint** (still retrievable) — **no archival threshold has been set yet** (open item, owed by Harish to propose). If storage capacity turns out to be tight, RT's stated fallback is to **keep documents out of the portal entirely and store resumes only** — see the storage-capacity risk in [03-DEVELOPMENT-PLAN.md](03-DEVELOPMENT-PLAN.md) §M4. Reminders until submitted. |
| **Offer** | **Record-only (Q3, RT 2026-07-13), reinforced 2026-07-14:** appointment/offer letters stay **entirely manual and outside the ATS** — HR prepares and shares them from their own mailbox/process. The ATS only needs the **stage/status to change**; it does not need to store the letter file at all (a further simplification of the original record-only scope, which had proposed tracking a letter file). It still records offer-shared date, candidate decision, and joining date. **Internal approval before an offer: the recruiter approves in-app**, with a **daily reminder nudge** until approved; recording "offer shared" without the approval step is allowed for exceptional cases (soft gate — Q26). No validity timer; no offer version tracking (handled manually). Vendor receives at most a status-only notification, never the letter (Q5/Q29 — Q29 remains unanswered; not discussed on the 2026-07-14 call). |
| **Closure** | One-click final status with automatic communication; definitions **confirmed** (Q12) — record auto-closes 90 days after Joined unless marked Joined-and-Left first. |

---

## 4. Roles & Access

- **Recruitment team** (head + members): identical full access to the Tracker and all pipeline actions — per RT clarification, no permission tiers.
- **Placement vendors**: see **only their own candidates** (existing isolation), gaining a real stage-progress column on their dashboard; they receive the dual-notification emails. No access to documents, scorecard contents, or internal notes.
- **Interviewers**: no ATS login needed — they interact via the Outlook invite and the tokenized scorecard link.
- **Candidates**: no login — they interact via emails, the info form, the document-upload link, and (if chosen) the self-scheduling / offer-decision links.

## 5. Communications Summary (all automated)

| Trigger | To candidate | To vendor (vendor-sourced) | To interviewer |
|---|---|---|---|
| Stage outcome (every stage) | ✅ outcome email | ✅ status-only, no figures (Q5) | — |
| Interview scheduled/rescheduled/cancelled | ✅ Outlook invite (Teams link) | ✅ notification | ✅ Outlook invite |
| Pre-interview reminder (**30 min before** — Q7) | ✅ | — | ✅ |
| Feedback reminder (post-interview — real cadence confirmed 2026-07-14, closes Q27: **~1h after the interview, then every 2 days through day 6, one final reminder 3–4 days later, stop at ~day 10**; no named-person escalation) | — | — | ✅ |
| Document request / re-request / reminder | ✅ | — suppressed (Q5; bare status line vs nothing → Q29, still open — not discussed 2026-07-14) | — |
| Offer shared / decision / closure | ✅ | status-only notification, no letter/figures (Q5; shape → Q29, still open) | — |
| **Ad-hoc per-candidate email (new, RT 2026-07-14)** | ✅ — one-off overrides, e.g. "interviewer cancelled, rescheduling" | — | — |

All sends use the existing engine: logged, open-tracked, bounce-detected, and safely redirected to a test inbox on staging. Stage outcomes, awaiting-feedback flags, and assessment-import completions additionally raise **in-app bell notifications** (minimal version, Module 1 — existing header bell).

**Ad-hoc per-candidate email (new requirement, RT 2026-07-14):** beyond the automated stage-outcome emails, RT needs to send a one-off custom email to a single candidate (e.g. "manager cancelled, rescheduling") without a full template edit. At send time the recruiter is prompted to **use the default template as-is, or edit it before sending** — accepted design, **not yet built**; the natural home is an override path on the M1 email dispatcher (`stageNotification.service.js`).

---

## 6. Out of Scope (this phase)
- Evalground API integration — the API is a paid add-on; **decided not to use it** (CSV import instead; Q2 closed).
- Background-check / document-authenticity automation.
- C2C vendor flow (separate document/plan).
- Post-joining HRMS features beyond recording Joined / Joined-and-Left statuses.
- Permission tiers within the recruitment team.
- **WhatsApp integration** — heavy external setup (WABA/BSP account, opt-in consent); handled as an exception plan like C2C once Q20 is answered. See 03-DEVELOPMENT-PLAN.md → "Integration asks — disposition".
- **Career Page integration** — deferred, least priority (a link from the AAPNA website; revisit after M0–M6).
- **Persistent notification center** (DB-backed unread state) — only the minimal in-app bell ships in Module 1.
- **Send-from-ATS and secure accept/decline-link offer variants** — RT chose record-only (Q3); both variants parked.
- *(MS Access data extract is **not** out of scope — pending Q21 it lands as a small export job in Module 6, or an exception doc if heavy.)*
