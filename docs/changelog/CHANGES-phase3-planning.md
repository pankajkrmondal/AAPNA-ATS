# CHANGES — Phase 3 Planning Session (2026-07-09)

## What was done
Analyzed the client's **Phase 3 Full-Time Recruitment Process Flow** document (manual process, Stages 0–8 + Client Interview + Documents + Offer + Closure, plus the placement-vendor variant) against the current AAPNA-ATS codebase, and produced the four planning documents under [docs/phase3/](../phase3/):

1. **[01-PROCESS-UNDERSTANDING.md](../phase3/01-PROCESS-UNDERSTANDING.md)** — the manual process restated for sign-off; what's already built (intake, welcome email, missing-fields form, vendor portal; **Zeko + email engine still in development post Phase 2.1 — not yet live to the Recruitment Team**, completed & taken live in module M0 with RT UAT via Q17); automation feasibility per step (~70–75% automatable overall); 15 process loopholes each mapped to an in-app fix or a question.
2. **[02-BUSINESS-DESIGN.md](../phase3/02-BUSINESS-DESIGN.md)** — the **Interview Pipeline Tracker** (enterprise ATS-style kanban board, candidate drawer with stage stepper/timeline/scorecards, Zeko-style round-status chips, funnel/aging analytics); stage-engine business rules (configurable stages, mandatory reason on every Reject/Hold, outcome emails, vendor dual-notification, full audit, backward compatibility); per-stage behavior; roles; communications matrix.
3. **[03-DEVELOPMENT-PLAN.md](../phase3/03-DEVELOPMENT-PLAN.md)** — six modules delivered **one at a time**: M1 stage engine + Tracker + outcome emails (vendor cc built into a single dispatcher) → M2 Evalground CSV import → M3 Teams/Outlook scheduling + reminders + scorecards → M4 documents → M5 offer + closure → M6 vendor completion/hardening. Includes data model, write-back strategy for legacy status fields, reuse map, and per-module verification checklists.
4. **[04-QUESTIONS.md](../phase3/04-QUESTIONS.md)** — 17 questions. For the Recruitment Team (RT): Q1–15 + Q17 (sample Evalground CSV 🚧, offer scope 🚧, scheduling mode 🚧, document checklist 🚧, reminder/escalation, no-show/hold/re-application/closure policies, Phase 2.1 go-live UAT 🚧). For IT: Q16 (Graph `Calendars.ReadWrite` grant 🚧). Q2 already closed: Evalground API is a paid add-on — decided not to use it.

## Key decisions recorded
- Evalground API not used — it is a paid add-on (decision by Harish, 2026-07-09); Stage 2 handled via CSV import from the Recruitment Team (format pending sample file).
- "RT" throughout these docs means the **Recruitment Team**.
- Teams invites created from the existing shared mailbox (pending one Graph permission grant).
- Registration/manual-add, welcome email, and candidate info form are **out of scope** — already built.
- Rejection/Hold reason taxonomy required at **every** stage (today it exists only at Stage 0).
- Recruitment team has flat access (no permission tiers); vendors see only their own candidates.
- Vendor-sourced candidates: both candidate and vendor updated on every status change (content depth for offer/PII stages = Q5).

## Walkthrough prototype (added 2026-07-09)
For the RT walkthrough, a **clickable prototype** of the Interview Pipeline Tracker was added in two forms (mock data only — no API calls, no emails, nothing saved):
- **In-app**: [frontend/src/pages/PipelinePrototype.jsx](../../frontend/src/pages/PipelinePrototype.jsx), route `/pipeline-prototype` (login required; not in the sidebar; vendors are auto-redirected by the existing confinement). **Delete the page + its route in App.jsx once the real Tracker ships in Module 1.**
- **Standalone**: [docs/phase3/prototype.html](../phase3/prototype.html) — open directly in any browser, no server needed.
Both demo: stage kanban board, candidate drawer (stepper/timeline/documents/offer), outcome modal with mandatory reasons, Teams scheduling with interviewer free/busy, tokenized interviewer scorecard, Evalground CSV import wizard, and analytics (funnel, stuck candidates, rejection reasons).

## Prototype v2 (2026-07-10) — RT feedback applied
After the first walkthrough, RT gave four directions, all applied to the prototype (in-app page, `docs/phase3/prototype.html`, and docs 02/03):
1. **Pipeline starts at Shortlisted** — resume screening stays in Candidate Screening; candidates enter the Tracker when shortlisted.
2. **Per-round candidate drawer** — one round's details at a time via the stepper; future rounds locked; actions only on the current round.
3. **One analytics page** — pipeline analytics becomes a new tab inside the existing Analytics page.
4. **Evalground import lives inside the IQ / Tech Assessment round** (column action + round panel), mapping results by email to candidates in that round — not a standalone screen.

## Prototype v2.1 (2026-07-10) — follow-up RT answers applied
- **Score mapping confirmed:** IQ = Evalground General Aptitude, Technical = Evalground Technical → `rpa_cv.IQScore`/`TechScore`.
- **Single entry point:** shortlisting from the screening page is the only way into the Tracker — no manual add. Vendor candidates enter the same way, **carrying their vendor tag**.
- **Left nav:** "Pipeline Tracker" added to the sidebar (MainLayout `MENU_ITEMS`, breadcrumb map) → `/pipeline-prototype`. Marked for removal with the prototype.
- **Truly one analytics page:** the prototype's own Analytics view was removed; its content is exported as `PipelineAnalyticsPreview` from `PipelinePrototype.jsx` and mounted as a **"Pipeline (Preview)" tab inside the existing Analytics page** (`Analytics.jsx`).

## Status / next step
**No code, schema, or config was changed — documentation only.**
Development starts with Module 1 only after RT approves docs 01/02 and answers doc 04 (blockers: Q1, Q3, Q6, Q8, Q16, Q17). A **Phase 2.1 completion pass (M0)** — completing the Zeko + email-engine development (still in development, not yet live to the Recruitment Team: sync crons and pollers to enable, prod `rpa_email_log` ALTER pending) and taking it live with an RT UAT walkthrough (Q17) — runs before or parallel to M1.

**Update 2026-07-14:** RT's answers (2026-07-13) received and applied to all four docs (see the entries below in this same file — an earlier version of this note linked to a separate `CHANGES-phase3-rt-answers.md` file that was never actually created; that link has been fixed). **Phase 2.1 is live (M0 done, Q17 closed); scorecard template received.** Remaining gates: formal 01/02 sign-off (M1), physical sample CSV (M2), Q16 IT grant (M3).

**Update 2026-07-14 (later same day) — formal sign-off recorded [⚠️ RETRACTED — see the 2026-07-14 meeting entry below]:**
- **Docs 01 (Process Understanding) and 02 (Business Design) are formally signed off**, per Harish: *"Please give a formal go-ahead on the two Phase 3 documents already shared — Process Understanding and Business Design (Tracker screens/behavior). Tracker development starts on this sign-off; everything else can follow in parallel. — given by HR."* **Module 1 (Stage Engine + Pipeline Tracker) development starts now** — see the new §E in [04-QUESTIONS.md](../phase3/04-QUESTIONS.md) and the updated gate status in [03-DEVELOPMENT-PLAN.md](../phase3/03-DEVELOPMENT-PLAN.md).
- **Q16 (Microsoft Graph calendar grant) confirmed tracked separately with IT, not RT** — still pending, to be raised with IT next; remains the sole gate on Module 3 and does not block M1.
- **Q21 (MS Access) and Q22 (Career Page) sharpened with Harish's context**, still awaiting RT's direct reply:
  - Q21: RT's team has stored candidate data in MS Access since day 1 — working hypothesis is a **one-time migration** of that historic data into the ATS, not a live integration. Re-asked via `docs/phase3/RT-FOLLOWUP-QUESTIONS.md` §C2.
  - Q22: the AAPNA website already has a candidate submission form; today's flow (submit → email with attachment → RT) is **already covered** by the existing email-intake/resume-parsing pipeline. RT expects something more but it's unclear what — re-asked via §C3.

---

## 2026-07-14 meeting (Chhaya Verma + Naveen Satywali) — correction + major refinements

Full notes: [MEETING-NOTES-2026-07-14.md](../phase3/MEETING-NOTES-2026-07-14.md). Applied to docs 01, 02, 03, 04.

### ⚠️ Correction — the sign-off above was wrong
The "formal sign-off received" entry immediately above this one was a mistake — a paraphrase ("given by HR") overstated what was actually said. Per the meeting's own gap analysis: Chhaya's closest words were *"let's complete the flow… keep us posted once the structure is ready"* — **not a go-ahead.** **Docs 01 and 02 revert to Draft status; Module 1 is gated on a real written sign-off**, which is now an explicit action item for Harish. All of M1's policy inputs remain answered — only the sign-off itself is missing.

### Substantive changes from the call
- **Zeko:** communication score removed, renamed to coding score. Proposed auto-advance rule (score ≥50% + cheat probability Low → auto-advance; Moderate → recruiter approval; High → auto-reject) **directly contradicts the earlier written "per-role score bands" answer (Q4)** — flagged everywhere, needs written confirmation. Full test report + recording requested in-app, but **the entire mechanism is contingent on unvalidated Zeko API capabilities — flagged as the single biggest schedule risk, currently unassigned to anyone.**
- **Evalground:** no API, import only, via **two mechanisms** (bulk CSV + single-result via Outlook). Unique key = email. Generic CSV columns imported as Section 1/2/3, RT renames later. Retake behavior confirmed: only the score is overwritten (closes the earlier "latest vs best" question). Untested candidates stay "pending" indefinitely, never deleted. Bulk-upload section→skill mapping approach still owed by Harish.
- **Interviewer feedback reminders:** real cadence confirmed (~1h after interview, then every 2 days to day 6, final reminder, stop ~day 10) — closes the earlier proposed "cap at 5."
- **Documents/retention:** never delete; archive to SharePoint after a threshold (not yet set). Offer/appointment letters confirmed to stay fully outside the ATS — no letter-file storage needed at all.
- **Multiple positions:** no automated conflict logic — RT decides manually which position proceeds; system needs only a manual pause/stop action (closes the earlier "offer collision" open question). New non-negotiable requirement: whole-database skill-based search across all MRFs with stage history visible.
- **Custom statuses:** needed mainly at Shortlisted and Offer/Final stages; "Other" must display the typed text, never the literal word "Other"; stage-prefixed status naming (e.g. "Zeko HR Screening Pending") is deliberate, not to be simplified.
- **Career Page:** candidate-intake side is already live, confirmed and accepted — closed. A separate JD-push-to-website ask surfaced and was parked for later.
- **WhatsApp:** confirmed wanted; ownership of producing the requirements document shifted to RT (Naveen + Chhaya + Sahil/sales).
- **MS Access:** elevated from "if simple" to a real priority — it's legacy/backup data requiring both a one-time import and an ongoing export/backup, driven by a prior ATS's lost backup (political stakes, not a nice-to-have). Schema-mismatch feasibility owed by Harish; Access table format owed by Chhaya.
- **New requirement:** ad-hoc per-candidate email at send time (default template or edit-before-send) — not yet built.
- **New open risk:** server/storage capacity is unconfirmed; if tight, RT's fallback is documents-out-of-the-portal (resumes only), which could descope Module 4's document-upload UI.
- **Still fully open, not touched by this meeting:** Q24 (shared assessments across concurrent journeys) and Q29 (vendor visibility at Offer/Document stages) — explicitly flagged so they aren't mistaken for resolved.

### Document collection email template received (2026-07-14, follow-up)
Chhaya's exact document-request email text was forwarded and added to docs 02/03/04 and the meeting notes (see Q8 in [04-QUESTIONS.md](../phase3/04-QUESTIONS.md) for the full text). It closes the "template pending" open item, but **it's narrower than the previously assumed default checklist** — only last-3-months payslips, permanent address, and one government ID (DOB + father's name); no education certificates or experience/relieving letters. Flagged for RT confirmation before finalizing Module 4 seed data; the checklist should be built as admin-editable data either way.
