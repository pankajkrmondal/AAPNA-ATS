# Phase 3 — Process Understanding

**Document 1 of 4** · Status: **⚠️ CORRECTION (2026-07-14 meeting): sign-off NOT received.** Earlier today this line incorrectly recorded a formal go-ahead based on a paraphrase ("given by HR"). Per the 2026-07-14 call notes ([MEETING-NOTES-2026-07-14.md](MEETING-NOTES-2026-07-14.md), Gap #2), Chhaya's actual words were *"let's complete the flow… keep us posted once the structure is ready"* — that is not a sign-off. **Status reverts to: Draft — RT answers received 2026-07-13 (via annotated 04-QUESTIONS PDF) and refined further on the 2026-07-14 call; formal written sign-off is still owed and is now an explicit action item** (see [04-QUESTIONS.md](04-QUESTIONS.md) §E).
Companion docs: [02-BUSINESS-DESIGN.md](02-BUSINESS-DESIGN.md) · [03-DEVELOPMENT-PLAN.md](03-DEVELOPMENT-PLAN.md) · [04-QUESTIONS.md](04-QUESTIONS.md)

This document restates our understanding of the client's **Full-Time Recruitment Process Flow** (Phase 3 flow doc) so RT can confirm we have read the process correctly before any design or development is approved. It also records our automation feasibility assessment and the loopholes in the manual process that must be resolved (in-app or by policy) when converting it into an application.

---

## 1. The Manual Process As We Understand It

### 1.1 Stage ladder

| # | Stage | Conducted via | Outcomes |
|---|-------|---------------|----------|
| Stage 0 | Resume Screening | HR review vs predefined criteria | Resume Approved (Shortlisted) / Rejected / **Future Prospect** / Hold |
| — | Welcome & Info Collection | Welcome email → candidate fills application/info form → "Recruitment Process & Interview Stages" email | (no outcome — communication step) |
| Stage 1 | HR Screening | **Zeko AI** | Zeko HR Screening Approved / Rejected / Hold |
| Stage 2 | Assessment / Test | **Evalground** (GA and/or Technical) | Test Passed / Failed / Hold |
| Stage 3 | Functional Screening | **Zeko AI** | Functional Screening Approved / Rejected / Hold |
| Stage 4 | Technical Round 1 | **Microsoft Teams**, Outlook invite | Tech 1 Approved / Rejected / Hold |
| Stage 5 | Technical Round 2 | Microsoft Teams, Outlook invite | Tech 2 Approved / Rejected / Hold |
| Stage 6 | Technical Round 3 **(optional)** | Microsoft Teams, Outlook invite | Tech 3 Approved / Rejected / Hold |
| Stage 7 | HR Round | Teams/Outlook if required; covers compensation, notice, relocation/WFH, cultural fit | HR Round Approved / Rejected / Hold |
| Stage 8 | CEO / Final Round | Microsoft Teams, Outlook invite | CEO Round Approved / Rejected / Hold |
| — | Client Interview **(if applicable)** | Scheduled **manually** by HR, custom email template; may sit after a technical round OR after the final round | Approved / Rejected / On Hold |
| — | Document Collection | Request email → candidate uploads → HR verifies completeness & authenticity | (verified / discrepancy handled before offer) |
| — | Offer Management | HR shares Appointment/Offer Letter **manually** | Accept Offer / Reject Offer |
| — | Final Outcome / Closure | HR sets final status | Approved · Rejected · On Hold · Candidate Withdrawn · Joined · Did Not Join · Joined and Left · Backed Out |

> **Addendum (RT ask, 2026-07-13):** resume screening carries an extended outcome set — **Shortlisted / Rejected / Future Prospect / Hold** — and RT wants **stages, outcomes, and final statuses to be admin-customizable** so new stages or statuses can be added later without development. Both are reflected in [02-BUSINESS-DESIGN.md](02-BUSINESS-DESIGN.md) §1.1/§2 and [03-DEVELOPMENT-PLAN.md](03-DEVELOPMENT-PLAN.md) M1 (`rpa_stage_outcomes`). Future Prospect candidates remain visible on the Screening page as a retrievable pool.

### 1.2 Rules that apply at every stage
- Only candidates with the stage's **Approved** outcome advance to the next stage.
- An **automated email is triggered on every outcome** (approved / rejected / hold).
- Interview stages (4–8) additionally require:
  - Outlook invitation auto-sent with date, time and Teams meeting link;
  - automated reminders — to the **candidate** before the interview, to the **interviewer** before the interview, and to the **interviewer for feedback submission** after the interview;
  - interviewer submits a **feedback form**; HR reviews it and sets the stage outcome.

### 1.3 Placement Vendor variant
- Candidates enter via the **Vendor portal** or are added by a recruiter manually **with a source name**.
- **Every status-change email must go to BOTH the candidate and the placement vendor.**
- Everything else is identical to the full-time flow. (C2C flow is a separate document, out of scope here.)

---

## 2. What Is Already Built (out of scope for Phase 3 development)

Confirmed against the current AAPNA-ATS codebase:

| Capability | Status |
|---|---|
| Bulk resume/Excel upload with AI parsing, dedup, OneDrive archive (HR upload + Vendor portal + email intake) | ✅ Built, mature |
| Welcome email on candidate upload | ✅ Built |
| Candidate information form (missing-fields form, token-gated public link, reminders) | ✅ Built |
| Zeko AI integration — HR screening & functional screening: assign, schedule, cancel, invite email, results sync with scores written to candidate | ✅ **Live (Phase 2.1 went live — confirmed 2026-07-14)** |
| Email engine — MS Graph shared mailbox, DB-managed templates, send/reply, open tracking, bounce detection, email log with reminder engine | ✅ **Live (Phase 2.1 went live — confirmed 2026-07-14)** |
| Vendor portal — vendor role, isolation by vendor email, 90-day ownership lock, duplicate review queue | ✅ Built |
| Screening analytics, shortlisting, MRF workflow | ✅ Built |

**✅ Note on the two Phase 2.1 items (updated 2026-07-14):** Phase 2.1 **is live** — the completion pass (M0) is done and Q17 is closed (no UAT gate needed). Residual technical note: "real-time" email sync uses 5-minute polling (webhooks remain a possible later enhancement).

**Not built today** (this is the Phase 3 delivery surface):
unified stage pipeline (Stage 0 → Closure) with outcomes/audit · Teams/Outlook calendar invites for human interview rounds · interview & feedback reminders · interviewer feedback forms · Evalground results ingestion · document collection · offer management · closure statuses · vendor dual-notification.

---

## 3. Automation Feasibility Assessment

Legend: 🟢 fully automatable · 🟡 semi-automated (human decision, automated actions around it) · 🔴 stays manual

| Process area | Rating | Automatable | What limits it |
|---|---|---|---|
| Registration & intake | 🟢 | ~90% | Already built. Screening criteria not written down (process gap, not tech). |
| Welcome + info form | 🟢 | ~90% | Already built. Non-completion handled in-app (see §3.1 decision below). |
| Stage 0 outcome + email | 🟡 | high | HR decision; system can auto-suggest from existing AI screening scores. |
| Zeko stages (1 & 3) | 🟡 | ~85% | Core integration **live (Phase 2.1, confirmed 2026-07-14)**; score thresholds **per role** (Q4, RT 2026-07-13 — band values pending). |
| Stage 2 Assessment (Evalground) | 🟡 | ~40% now | **Evalground API is a paid add-on — decided not to use it.** Results arrive via **two mechanisms (confirmed 2026-07-14): bulk CSV + single-candidate result on Outlook**, matched by email, pass mark 50%; **sample files received 2026-07-14, format verification still owed by Harish** → ATS imports it; HR sets outcome. |
| Interview rounds (4–8) | 🟡 | ~75% | Scheduling, invites, reminders, feedback capture all automatable. Blocked on one IT permission grant (Q16); reschedule/no-show policies answered 2026-07-13 (recruiter-decides; no escalation). |
| Client Interview | 🔴 | ~30% | Inherently external and manual per the doc; ATS tracks the stage, sends the custom email, records the transcribed outcome. |
| Document collection | 🟡 | ~70% | Request/upload/checklist automatable; **authenticity verification stays human**; checklist = same for all roles (Q8 — template pending). |
| Offer | 🔴/🟡 | ~50% | Manual per the client's own doc; ATS role decided (Q3, RT 2026-07-13): **record-only + in-app approval nudge**. |
| Closure + vendor dual-notify | 🟢 | ~95% | Trivial once the stage engine exists. |

**Overall: the majority of the documented manual process can be automated now**, keeping humans in the loop only for judgment calls (stage decisions, interview feedback, document authenticity, offer terms).

### 3.1 Design decision — info-form non-completion (finalized with RT)

If a candidate does not complete the information form, the system reminds them a set number of times, then stops. On exhausting the reminder cadence the candidate is **auto-set to `Candidate Withdrawn` (reason: No Response)** so they exit the active pipeline rather than sitting idle (avoids re-creating the L1 "Hold black hole"). Design decision — no RT question required.

---

## 4. Loopholes in the Manual Process

These are gaps that work (or hide) in a manual process but **break an application** — each is resolved either by an in-app design decision or by a question in [04-QUESTIONS.md](04-QUESTIONS.md).

| # | Loophole | Consequence if ignored | Resolution |
|---|---|---|---|
| L1 | **"Hold" is a black hole** — every stage has Hold but no review cadence, expiry, or exit | Candidates rot invisibly; pipeline counts inflate forever | **Q10 answered (RT, 2026-07-13): manual only** — no automated review reminder or auto-close. The in-app "On Hold review" view + aging badge ship regardless and are the only guard (accepted residual risk). |
| L2 | **No SLA on any stage** — no target duration anywhere | Candidates silently stuck; no accountability | In-app: days-in-stage aging + "stuck candidates" view (design decision, shipped by default) |
| L3 | **Feedback never submitted** — nothing happens if an interviewer doesn't fill the feedback form | Candidate blocked indefinitely; the single biggest failure mode of the whole flow | **Q7 answered (RT, 2026-07-13):** daily feedback reminder until submitted, **no named-person escalation**; "awaiting feedback" flag stays. (Reminder cap proposed → Q27.) |
| L4 | **No reschedule / no-show handling** — the doc never mentions either | Real interviews get moved constantly; data forced into wrong statuses | **Q9 answered (RT, 2026-07-13):** rescheduled/no-show statuses in-app; **recruiter-only triggers, no auto-Hold — the recruiter decides**; expired Zeko links = "window missed". |
| L5 | **Rejection reasons exist only at Stage 0** | Analytics can never say *why* candidates fail later stages | In-app (confirmed requirement): **mandatory reason taxonomy on every Reject/Hold at every stage** — Stage 0 taxonomy reused everywhere + free-text "Other reasons" (Q19, RT 2026-07-13). |
| L6 | **Vendor gets "every mail" — including offer/CTC and document requests?** | Compensation and PII exposed to a third party | **Q5 answered (RT, 2026-07-13): status-only, information only, no figures/attachments; offer letter and document mails never go to the vendor.** (Bare status line vs nothing at those stages → Q29.) |
| L7 | **Interviewer availability never checked** — HR picks a time blind | Double-bookings, constant rescheduling | **Q6 answered (RT, 2026-07-13): both modes** (interviewer-fixed first, then candidate self-scheduling) **+ free/busy display** — pending the Q16 IT grant. |
| L8 | **Closure statuses overlap** — Backed Out vs Did Not Join vs Candidate Withdrawn undefined; "Joined and Left" implies post-joining tracking | Junk reporting; unclear when the ATS stops tracking | **Q12 answered (RT, 2026-07-13): definitions ratified; record closes 90 days after Joined** unless marked Joined-and-Left first. |
| L9 | **No re-application policy** — rejected candidate reapplies later | Duplicate journeys or wrongly blocked candidates | **Q11 answered (RT, 2026-07-13): 6-month cooling-off from Stage 1 (Zeko HR) onwards**, varying by rejection stage/reason. Blocks new journeys only (Q23). |
| L10 | **Multi-position candidacy undefined** — one candidate, two open MRFs | One journey overwrites the other | **Q13 answered (RT, 2026-07-13): two concurrent MRF journeys allowed** (matching MRF/JD) — design updated to one journey **per candidate-per-MRF** with a concurrency badge. (Follow-ups: shared assessments → Q24, offer collision → Q25.) |
| L11 | **Offer approval/expiry/negotiation absent** — who signs off CTC? how long is an offer valid? | Uncontrolled offers; no audit | **Q3 answered (RT, 2026-07-13): record-only + in-app recruiter approval with daily nudge** (soft gate — Q26); no validity timer; no version tracking (manual). |
| L12 | **Evalground results = manual entry risk** — typo, no audit vs the real report | Wrong pass/fail decisions | In-app: CSV import with validation & import log. **Q1 format answered (RT, 2026-07-13); sample files received 2026-07-14 — Harish still owes format verification before the M2 build starts.** |
| L13 | **Email delivery assumed** — manual process never sees bounces/spam | Candidate never receives outcome/invite; nobody knows | In-app: existing bounce/open tracking surfaced on the candidate record (design decision) |
| L14 | **"HR" is undefined** | — | Clarified by RT: recruitment team (head + members), **all with the same access**. No permission matrix needed. |
| L15 | **Screening criteria "predefined" but not written** | Inconsistent Stage 0 decisions between recruiters | **Q15 answered (RT, 2026-07-13): default accepted** — no auto-suggestion; HR decides from AI scores. Criteria per role can be supplied later. |

---

## 5. Confirmation Requested

RT is requested to confirm:
1. Section 1 correctly describes the intended process (including the vendor variant). *(pending explicit confirmation)*
2. Section 2's "already built / out of scope" list is agreed. *(pending explicit confirmation)*
3. The loophole resolutions marked "in-app / design decision" in Section 4 are acceptable defaults. *(pending explicit confirmation)*
4. The remaining items are answered via [04-QUESTIONS.md](04-QUESTIONS.md). *(✅ substantially complete — RT answers of 2026-07-13 plus a 2026-07-14 call recorded there; still open: Q16 (IT), Q24, Q29, and several new items surfaced 2026-07-14 (see its §C) — most urgently the unassigned Zeko API validation risk. Q17 closed 2026-07-14 — Phase 2.1 is live; Evalground sample files also received 2026-07-14.)*

**Development starts only after this sign-off; per-module gates are tracked in [03-DEVELOPMENT-PLAN.md](03-DEVELOPMENT-PLAN.md) §0.**
