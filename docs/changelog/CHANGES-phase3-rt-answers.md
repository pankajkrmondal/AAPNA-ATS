# CHANGES — Phase 3 RT Answers Applied

**Date:** 2026-07-14 (answers received 2026-07-13)
**Scope:** documentation only — no code, schema, or config changed.

---

## What was done

The Recruitment Team returned the annotated **Phase 3 questions PDF** (2026-07-13), answering **Q1, Q3–Q15, Q18, Q19**, together with a second PDF ("Recruitment ATS Integration Requirements — Phase 3") and three additional asks. This session:

1. Recorded every answer in [phase3/04-QUESTIONS.md](../phase3/04-QUESTIONS.md) (per-question answer blocks + filled answer sheet).
2. Added the previously **missing Q17 body text** (Phase 2.1 go-live UAT slot — still unanswered, blocks M0).
3. Propagated the design consequences into [phase3/01-PROCESS-UNDERSTANDING.md](../phase3/01-PROCESS-UNDERSTANDING.md), [phase3/02-BUSINESS-DESIGN.md](../phase3/02-BUSINESS-DESIGN.md), and [phase3/03-DEVELOPMENT-PLAN.md](../phase3/03-DEVELOPMENT-PLAN.md).
4. Ran a **loophole pass over the answers themselves** — new exception cases logged in 04 §D: five decided in-house (Q23, Q26, Q28, Q30, Q31), four still to ask RT (Q24, Q25, Q27, Q29).
5. Placed the integration-PDF asks in the process (04 §B2 + 03 "Integration asks — disposition").

## Key decisions from RT (2026-07-13)

- **Q1 Evalground CSV:** matched by candidate email; one file (GA + Technical); multiple rows per candidate possible; non-IT = GA+English, IT = role-specific by Role/MRF; arrives via Outlook. **Sample file still pending.**
- **Q3 Offer:** **record-only** — HR shares offers offline; ATS records stage/status. Internal approval = yes with a reminder nudge; no validity timer; no version tracking.
- **Q4 Thresholds:** Zeko bands per role (values pending); Evalground pass mark **50%** both tests.
- **Q5 Vendor emails:** status-only, no figures/attachments; no offer-letter or document-collection mails to vendors.
- **Q6 Scheduling:** **both** modes (interviewer-fixed first, then candidate self-scheduling) + free/busy display.
- **Q7 Reminders:** candidate & interviewer **30 min before**; feedback **daily until submitted**; **no escalation**.
- **Q8 Documents:** same checklist for all roles (template pending); retention answer ambiguous — follow-up needed.
- **Q9 Reschedule/no-show:** recruiter-only; no auto-Hold; expired Zeko links = "window missed".
- **Q10 On-Hold:** manual only — no automation.
- **Q11 Cooling-off:** 6 months, varies by stage/reason, from Stage 1 onwards.
- **Q12 Closure:** confirmed — auto-close 90 days after Joined; definitions ratified.
- **Q13 Multi-position:** **two concurrent MRF journeys allowed** (matching MRF/JD).
- **Q14 Client interview:** fully manual; system generates nothing for the client.
- **Q15 Stage 0 criteria:** default accepted — no auto-suggestion.
- **Q18 Scorecard:** same card all rounds; Harish's template pending (generic fallback).
- **Q19 Reasons:** Stage 0 taxonomy everywhere + free-text "Other reasons".

## New RT asks (beyond the questions doc)

1. **Stage 0 multi-status** — Shortlisted / Rejected / **Future Prospect** / Hold (Future Prospect stays visible on the Screening page as a retrievable pool).
2. **Admin-customizable stages AND outcomes/final statuses** — new `rpa_stage_outcomes` config table + admin CRUD in M1.
3. **Customizable email templates per stage × outcome** — new `rpa_stage_email_templates` mapping table; `POST /templates` added to the email-template API (create was missing); `EmailManagement.jsx` gains a "New template" flow. Pre-flight: the CHECK constraint on `rpa_email_templates.category` must be extended by manual DDL.

## Internal decisions (product owner, 2026-07-13 — recorded in 04 §D1)

- **Q23:** rejection in one journey never stops a concurrent active journey; cooling-off blocks new journeys only.
- **Q26:** offer approval = recruiter, in-app, daily nudge, skippable in exceptional cases (soft gate).
- **Q28:** 30-min-only candidate reminder is intentional (the invite is the advance notice).
- **Q30:** Future Prospect = parked-but-retrievable on the Screening page; re-shortlistable; no cooling-off.
- **Q31:** self-scheduling slot conflicts resolved by the interviewer updating published slots; no complex locking.

## Design changes applied per document

- **01:** loophole table L1–L15 resolutions updated with dated answers; Stage 0 outcome-set addendum; feasibility notes refreshed; status header updated.
- **02:** configurable stages **and outcome sets** (rules 1–2 rewritten); per-stage×outcome templates (rule 4); vendor status-only comms (rule 5); new rule 9 (cooling-off); multi-MRF concurrency + Future Prospect in §1.1; per-stage table updated (30-min reminders, no escalation, recruiter-decides no-shows, record-only offer + approval nudge, 50% pass mark, client fully manual); comms matrix updated; bell notifications noted; out-of-scope list extended.
- **03:** gate-status column added to the roadmap; **M1** data model reworked (`rpa_stage_outcomes`, `rpa_stage_email_templates`, per-candidate-per-MRF journeys with partial unique index, cooling-off guard, `future_prospect` write-back value, admin CRUD, template create, bell events) + 4 new verification items; **M2** import rules (group by email, latest attempt default, manual upload); **M3** self-scheduling promoted to second increment, reminder spec finalized, escalation deleted; **M4** build-can-start note, retention job on hold; **M5** rewritten to record-only + approval flow + 90-day auto-close job; **M6** two new audits + MS Access placement; new "Integration asks — disposition" section; key-assets table extended.

## Updated milestone gating (after 2026-07-13)

| Module | Gate status |
|---|---|
| M0 Phase 2.1 completion | **Still blocked** — Q17 (UAT slot) unanswered |
| M1 Stage engine + Tracker | **Unblocked in substance** — needs only formal sign-off of docs 01/02 |
| M2 Evalground CSV import | Format answered — **gated on the physical sample file** |
| M3 Scheduling + scorecards | **Gated on Q16 (IT Graph grant) only** — must now include `Schedule.Read.All`/`Calendars.Read` |
| M4 Document collection | **Build can start** — go-live needs checklist template + retention clarification |
| M5 Offer + closure | **Unblocked** — shrunk to record-only + approval nudge |
| M6 Vendor + hardening | After M5 |

## Integration asks — disposition (second PDF)

| Ask | Disposition |
|---|---|
| Outlook / Zeko / Evalground / Teams / email templates | Covered by M0–M3 (templates become per-stage×outcome + creatable in M1) |
| Bell notifications | Minimal version into **M1** (existing `NotificationBell.jsx` + Socket.io); persistent notification center deferred |
| WhatsApp | Exception plan (like C2C) — `docs/whatsapp-integration-plan.md` once **Q20** answered |
| MS Access | Pending **Q21** — small export job in M6 if simple, exception doc if heavy |
| Career Page | **Deferred, least priority** — link from the AAPNA website; revisit after M0–M6 |

## Still open (follow-ups to RT / IT)

Sample Evalground CSV (M2) · Harish's scorecard template · document checklist template · Q8 retention clarification · **Q16** Graph grant (IT) · **Q17** UAT slot · Zeko per-role band values · Evalground latest-vs-best row rule · **Q24** shared assessments across concurrent journeys · **Q25** offer collision · **Q27** feedback-reminder cap · **Q29** vendor status-line vs nothing at offer/doc stages · Q20/Q21 integration details · formal sign-off of docs 01/02.

## Status

Documentation only. Development starts with **M1** once RT formally signs off docs 01/02; M0 remains first in line pending the Q17 UAT slot.

---

## Update — 2026-07-14 (later the same session)

- **Q17 closed / M0 complete:** Phase 2.1 (Zeko + email engine) **is live now** (product owner confirmation) — no UAT gate needed. Q17 removed as a blocker across all four docs; the "not yet live to the Recruitment Team" notes in 01/02 were flipped to live status. Residual note: inbound email sync is 5-minute polling (webhooks = later enhancement).
- **Scorecard template received (open item 2 closed):** Harish's **"Interview Evaluation Format V2.xlsx"** (the old MS Forms + Power Automate → Excel + HR-notify flow) — the ATS builds its own in-app form to replace it. Structure documented in 03 M3:
  - **Technical 1–3 / CEO shared card:** candidate/date/position/round/interviewer auto-filled from the schedule; recommendation Shortlisted/Rejected/On Hold; Skills 1–3 mandatory + 4–5 optional (name + rating /5 in 0.5 steps + remarks); Communication and Attitude ratings + comments; Final Rating + Final Comments; optional recording link.
  - **HR Round card (own variant, present in the workbook):** family background, timings, relocation, notice period, CTC & ETC, strengths/weaknesses, only-negative, other observations, final feedback, next step for RT, final rating/comments, recording link. *(Nuance vs the Q18 "same for all rounds" answer — the template itself distinguishes the HR Round.)*
  - The old flow's auto-generated consolidated-feedback text and HR notification are reproduced natively (drawer summary + bell/email on submission).
- **Updated gating:** M0 ✅ done · M1 pending 01/02 sign-off · M2 pending sample CSV · M3 pending Q16 (IT) only · M4 build-ready · M5 unblocked.

### Prototype updated to v3 (same day)

RT's answers were applied to both prototype forms — `frontend/src/pages/PipelinePrototype.jsx` (route `/pipeline-prototype`) and `docs/phase3/Phase 3 - prototype.html` (mock data only, as before):

- **Reminders (Q7):** all 24h/1h copy → candidate & interviewer **30 min before**; feedback reminder **daily until submitted**; the escalation alert/tile/emails removed — overdue cards just stay flagged (Ravi Shankar demo case now shows 5 daily reminders, no escalation).
- **Hold (Q10):** "review due / auto-close at 90" copy → **manual review only**; analytics tile and stuck-candidates row reworded (Farhan Ali demo case).
- **Offer (Q3/Q26):** panel rewritten to **record-only** — internal approval block ("Approved in-app by Priya (recruiter)", daily nudge, skippable), "shared offline by HR — recorded here", **"Upload revised letter" button removed** (no versioning); accept toast mentions the 90-day post-Joined auto-close (Q12). Closure select: "On Hold (Future Prospect)" → "On Hold".
- **Scorecard (Q18 + template):** modal rebuilt to Harish's **Interview Evaluation Format** — Skills 1–3 mandatory (+4/5 optional) with 0.5-step ratings + remarks, Communication, Attitude, Final rating + comments, recording link, status **Shortlisted / On Hold / Rejected**; note that the HR Round keeps its own card.
- **Evalground (Q1/Q4):** import copy states one file, email matching, **50% pass mark**, **latest-attempt** rule; validation table gains a Duplicate row; Neha Sharma demo case now shows IQ 46% < 50% (auto-suggest Failed).
- **Concurrent MRFs (Q13):** new **"2 MRFs" badge** on cards + drawer (Ananya Singh demo case runs a second journey for MRF-2044).
- **Scheduling (Q6/Q31):** schedule modal gains a mode toggle — **Fixed time** vs **Candidate picks a slot** (publish slots, first-come holds, interviewer edits slots to resolve conflicts).
- **Vendor suppression (Q5):** document-request emails/toasts say "vendor not copied — PII"; reasons lists now end with **"Other reasons (free text below)"** (Q19).
- Banner/footer/header comments bumped to **v3 — RT answers of 2026-07-13 applied**.

Verified: JSX compiles (esbuild) and the HTML inline script parses cleanly; mock-only behavior unchanged.
