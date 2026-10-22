# 07 · Development history, January–October 2026

**For:** anyone asking "what was built, when, and why". **Compiled:** 20 Oct 2026.

**Sources:**
- before June: the hidden sheets of `docs/Phase 3 Enhancements or Feedback/ATS App - Phase wise Task Items.xlsx` (Phase 2 Task Items, Phase 2 Feedback Iterations 1–4, N8n to Full Stack Transition, the old Phase 3 plans). The n8n workflows themselves are not in git;
- from 10 June: this repository (252 commits to 19 Oct), `docs/CHANGELOG.md`, `docs/changelog/`, `docs/phase3/`.

Dates are 2026. Where a date could not be confirmed it is marked **(to confirm)**.

**People:**
- **Developers:** Harish Mopuri and Pankaj Kumar Mondal, plus Saurabh in Phases 1–2.
- **Recruitment team (RT):** Chhaya, Naveen.
- **Feedback** also came from HR leadership (Sanghamitra Roy) and the CEO (Abhijit).

---

## At a glance

| Period | Phase | Platform | Headline |
|---|---|---|---|
| Jan–Feb | Phase 1 | n8n | MRF form, resume intake (Outlook, upload, Excel), parsing to the database, OneDrive |
| Feb–Mar | Phase 2 | n8n | RAG / vector matching, scoring and star ranking, JD management, reminders, authentication |
| Apr–early Jun | Phase 2 feedback, iterations 1–4 | n8n | Scoring rules (job stability, education), filters, duplicates, vendor controls, speed |
| 10 Jun–Jul | Full-stack rebuild | Express + React | Everything rebuilt as this app; multi-company admin; vendor portal; production cut-over in July |
| 14 Jul | Phase 2.1 live | full stack | Zeko integration and the email engine live in production |
| Jul–Aug | Phase 3 (M1–M6) | full stack | Stage pipeline, Evalground, interviews and scorecards, documents, offers, vendor notifications, analytics |
| Sep | Phase 3 completion & UAT | full stack | Recordings, dossier, referrals, MRF approval audit, production migration plan, UAT, CEO demo (28 Sep) |
| Oct | Phase 3 feedback ("Do Now") | full stack | Strict filtering, RT feedback, bug fixes, dashboard / analytics, logging and documentation |

---

## January–February: Phase 1 on n8n (start date to confirm)
The workbook records Phase 1 only through its March enhancements, so the start of the work is approximate. The first version automated the front of the funnel as n8n workflows, numbered by flow ("1.1", "1.1.1"…), names still used in conversation.
- **MRF request form (flow 1.1):** the hiring manager's requisition with an email body. Budget fields and design changes followed in March.
- **Resume intake:** emailed CVs from Outlook (flow 1.1.1), HR manual upload (1.1.2) and Excel import (1.1.3), parsed by AI into the candidate table (`rpa_cv`, then and now). Attachments saved to OneDrive.
- **Website data scraping** of email bodies and attachments into the database.
- **Search & edit candidate** page.

**Phase 1 enhancements (20–27 Mar):**
- MRF budget fields, with a minimum of 1 LPA and thousand separators;
- the email body shown in the form;
- Zeko fields in the Excel upload;
- source / vendor email on Search Candidate;
- emails archived to OneDrive.

## February–March: Phase 2 on n8n (screening)
- **RAG matching:** vector search of candidates against a JD (26 Feb, staging).
- **Scoring criteria and star-based ranking** (5–16 Mar), **budget scoring** (24 Mar), **JD fetch & management** (25 Mar), a single candidate status update ("Resume Shortlisted").
- **Reminder mechanism** for all phases (17 Mar). **Authentication** added to the n8n apps (staging 19 Mar, production 24 Mar).
- Shortlist email to the selected candidate (the questionnaire was dropped as not required).
- **End-of-March testing:** Phase 1 flows tested in production; 7 Phase 2 bugs fixed (27–30 Mar); staging and production databases cleaned.

## April–early June: Phase 2 feedback, iterations 1–4
- **Iteration 1 (early April, about 70 h):** RT's first written feedback (REQ-01 to REQ-09).
  - Strict skill filtering; status change with role-specific comments.
  - Resume-request email for imported candidates.
  - **Job stability** scoring (company changes and tenure), **education percentage** scoring.
  - Education and gender filters, AI spelling normalisation of skills and locations, search speed.
  - Fixes: the greeting / complete-profile email order, the profile form not closing, vectors saved in the wrong format, reminders reaching real candidates from staging.
- **Iteration 2 (April):** testing issues across Search Candidate, MRF and screening.
  - Validation and non-editable name / email, the JD filter showing BCA when BTech was required.
  - Vendor login and vendor access control.
  - MRF edit, approval status and MRF ID on the dashboard.
- **Iteration 3 (May):** planning. Items needing a rebuild were moved to Phase 3: the Outlook inbox in the dashboard, communication history, custom emails, Teams interview scheduling, feedback forms, Zeko assessment integration, a stage-based tracking model.
- **Iteration 4 (27 May–12 Jun, 178 h):**
  - **Product:**
    - default CC on MRF mail;
    - Enter-to-search everywhere;
    - a resume link on every candidate;
    - select-all;
    - **duplicate detection with source attribution** (a change to the parsing backbone);
    - an upload summary on the dashboard;
    - vendor name search and vendor activation.
  - **Screening:**
    - the 5–10 result cap removed (kept at 50 for now), with an AI summary per candidate;
    - experience and CTC range fixes;
    - better skill matching, with the ideal-match criteria shown on the score;
    - non-IT qualifications.
  - **Speed:** screening load time cut to about 11 s by moving to OpenAI GPT-4.1 nano via OpenRouter.
  - **Missing-fields form:** company website, and recruiter / position dropdowns.
  - **Carried to Phase 3 / 4:** vendor registration and profiles, JD sharing to vendors, vendor status dashboard.

## June: the move from n8n to full stack
- **10 Jun:** first commit of this repository: Express + Prisma + PostgreSQL / pgvector backend, React + Vite + antd frontend, BullMQ / Redis, Socket.io.
- **17 Jun:** AAPNA rebrand (olive-green theme), new dashboard and login, collapsible sidebar.
- **18–19 Jun:** screening UI, resume signals and AI insights; **multi-company setup and the super-admin role**.
- **22–26 Jun:** vendor login, vendor upload with recruiter review and merge / cancel, vendor dashboard; HR upload fixes for the new columns. The transition checklist (MRF recruiter / manager / edit, dashboard, admin CRUD for all four roles, HR and vendor upload with duplicate handling, vendor dashboard) was signed off 23–26 Jun.
- **29–30 Jun:** missing-details trigger fixed; shortlist / status emails sent from the authorised mailbox with retries and branded templates; JD skill match, keyword-tab skill signals, client-side pagination.

## July: production, Phase 2.1, and Phase 3 design
- **3 Jul:** production configuration ("production set") and the universal admin rules (no changing your own role, no self-deactivation…); superadmin/admin tightening and credential email routing. **(To confirm: the full-stack production cut-over date; the July go-live below is confirmed.)**
- **10–13 Jul:**
  - login by email or username, self-service password change, forgot password;
  - Light / Dark / System theme;
  - the **429 fix**: `trust proxy` and realistic limits (`docs/RATE_LIMIT_429_FIX.md`).
- **14 Jul: Phase 2.1 went live in production.** It brought the Zeko AI interview integration (assign, schedule, cancel, results sync) and the email engine (shared mailbox, templates, send / reply, open tracking, bounce detection, reminders). The same day, the Phase 3 process documents were reviewed with RT (`docs/phase3/01`–`04`, RT answers of 13 Jul, meeting notes 14 Jul).
- **16 Jul:** Cloudflare Turnstile on login.
- **20–23 Jul:**
  - Analytics prototype; the **pipeline stage engine** schema (`2026-07-21-pipeline-stage-engine.sql`) and the HR pipeline tracker;
  - editable email preview before sending; a mandatory rejection reason; "Tag to open JD" on keyword search.
- **27 Jul:** friendly error messages, plus **developer alert emails for 5xx errors** (`CHANGES-friendly-error-messages-and-dev-alerts.md`).
- **28 Jul:** interview scheduling, scorecards and the Microsoft Graph calendar integration.

## August: Phase 3 modules M1–M6
- **6 Aug:** M1–M5 delivered on staging (`docs/phase3/PHASE3-MODULE-STATUS.md`):
  - **M1 stage engine:** 12 configurable stages, outcome reasons, audit, outcome emails, admin configuration;
  - **M2 Evalground import;**
  - **M3a interviews:** Teams / Outlook booking, reminders, the "did it happen?" check, scorecards for Tech 1 / 2 / 3, HR, CEO and Client rounds;
  - **M4 documents;**
  - **M5 offer and closure.**

  The production deployment runbook was written the same day.
- **11–13 Aug:** QA test pass; MRF export; Recruitment Analytics; **M6 placement vendor**. The audit found that vendor notifications had never fired, so they were rebuilt as status-only emails (`CHANGES-phase3-m6-vendor.md`).
- **17–18 Aug:** Search Candidate filter simplification; the **"Aurora Glass" design rollout** across every page (9 phases).
- **20–21 Aug:** manual test pass, defects D4–D10, file-content verification on every upload route, admins creating email templates.
- **24–25 Aug:** Zeko fixes, with three RCAs (`docs/RCA-2026-08-25-*`):
  - scores read from the per-candidate report API;
  - the results fetch every 5 minutes;
  - only published jobs offered;
  - no cross-round scores.

  Also: Evalground matching on any of a candidate's emails; Client Round and Offer trimmed to "mark only".
- **26–27 Aug:** candidate closure (graceful exit) and the MRF lifecycle closing both ways; four Recruitment Analytics metrics corrected; the pipeline gap closeout (rejected filter, real conversations, "my candidates"); a rich-text reply box. The CHECK-constraint incident: `CHANGES-2026-08-26-candidate-closure-graceful-exit.md`.

## September: completion, production migration, UAT
- **2–4 Sep:** Teams **interview recordings** (auto-record, discovery, archive, watch / copy); the **candidate dossier** (complete download for external interviewers); recording share links; **referral candidates** (hidden from interviewers).
- **9–10 Sep:** **staging → production migration plan**, re-verified against both databases (`docs/phase3/STAGING-TO-PRODUCTION-DB-AND-ONEDRIVE-PLAN.md`), plus the parity backfill DDL and pgAdmin scripts. **(To confirm: the date Phase 3 went live in production.)**
- **11 Sep:** UAT starts (the "Phase 3 UAT" sheet); Graph production setup document; plans for Phase 3 and Phase 4.
- **22 Sep:** RCA for "Resume Processing Failed" on production HR upload (`rpa_cv_tmp` missing a column).
- **23–25 Sep:** recruiters added to interview meetings; super-admin-only items; **MRF approval with personal links and a provable audit trail** (`2026-09-25-mrf-approval-audit.sql`).
- **28 Sep:** demo to the CEO. **29 Sep:** RT's written feedback.

## October: Phase 3 feedback ("Do Now", sections A–F)
- **7 Oct:** the Do Now plan (`docs/Phase 3 Enhancements or Feedback/PLAN-Phase3-Now.md`), built from RT's feedback, the CEO sheet and our own Phase 4 list. **9 Oct:** the parked "longevity" items become N42 (logging) and N43 (documentation).
- **12 Oct:** more than one MRF approval.
- **13–14 Oct:**
  - **Section A**, strict keyword and JD filtering (N01–N12), behind `SCREENING_V2`;
  - **Release 1** quick wins: the missing-details completed alert, MRF lists, stage rules, public forms, the CEO round made optional.
- **15 Oct: Section C**, other RT feedback: the JD attached to emails, candidate forms, Add to JD, phone and interview reminders, the outcome-email opt-out.
- **16–19 Oct: Section D**, bugs and data correctness: candidate data sync, the pipeline popup crash, date formats. Also **flexible stage movement** (drag and drop, behind `FLEXIBLE_STAGES_ENABLED`).
- **19 Oct: Section E**, CEO clarity: board labels and legend, dashboard fixes (server-side counts, MRF filter), the recency filter, the Analytics Positions tab. N37 is on hold for the "qualified" definition.
- **20 Oct: Section F**:
  - **N42**, developer logging and error tracing (refs, masking, outside-call logging, the error store, job alerts and heartbeats, browser errors, the Logs & errors page);
  - **N43**, this documentation set and the business user guides.
- Section B (JD tagging on upload) is still to build. Production receives sections A–F together in one final release.

---

## Keeping this current
Every release adds one dated line here under its month: what shipped, why (which feedback or incident), and a link to its changelog. Incidents get a line too, with their RCA.
