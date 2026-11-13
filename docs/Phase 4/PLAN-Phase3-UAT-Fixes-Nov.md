# Plan: Phase 3 UAT fixes (Nov)

**Date:** 10 Nov 2026 · **Owner:** Harish · **Source:** the "Phase 3 UAT Fixes - Nov" sheet of `ATS App - Phase wise Task Items.xlsx` (U01–U11)

**HR feedback behind it**
- `Recruitment_Process_Phases (1).xlsx`, sheet "Phase 3"
- `Email Body Table for CHRO,CEO round and Tech Rounds (with CTCs).docx`, used for U03

**12 Nov update:** all of U01–U11 now goes to production together on **Mon 16 Nov** (staging Fri 13 Nov). This replaces the R1 and R2 dates below. The new chats (U02b, U06b, U10b, U03b, R16) are listed in [Walkthrough feedback (12 Nov)](#walkthrough-feedback-12-nov).

**How the work runs:** **one feature per chat**.
- Each chat reads [uat-fixes/00-CONVENTIONS.md](uat-fixes/00-CONVENTIONS.md), its own brief, and the Handoff of any brief it depends on.
- The briefs hold the verified root causes and file:line references, so no chat needs to explore the code again.

## Decisions already taken
- Both fix releases are in scope. The "NOT" row on the sheet separates release 1 from release 2.
- **U03:** the panel-pack slimming asked for in the Process Phases sheet (row 15) is included. A checkbox in the Schedule window lets HR/Admin show the vendor source to the panel. Referral candidates stay hidden.
- **U04:** fix the strict search (`SCREENING_V2`) and turn it on. This needs RT's sign-off on the N11 before/after check.
- **U10:** an Analytics view plus a 09:00 bell note to HR and Admin. No email.

## Items and chat order
| # | Item | Brief | Release | Hours | Depends on | Status |
|---|---|---|---|---|---|---|
| 1 | U09 Laptop question wording | [U09](uat-fixes/U09-laptop-question.md) | R1 | 1 | none | Built (unit, build); wording check on the staging form in R1 UAT |
| 2 | U06 MRF approve for Chhaya | [U06](uat-fixes/U06-mrf-approve-chhaya.md) | R1 | 2 | none | Built (panel wording, config doc); staging demo and the HR decision on roster / production flags still open, see Handoff |
| 3 | U04 Commas in skills and location | [U04](uat-fixes/U04-keyword-commas.md) | R1 | 6 | none to build; the production flag needs N11 | Built. 12 Nov: the strict search goes to production too; confirm the server flag in R16 |
| 3b | N11 before/after check (**not on the sheet**; needed only to turn `SCREENING_V2` on in production) | design in `PLAN-Phase3-Now.md` §N11 | R1 or R2 | 6 | U04 | **Dropped (12 Nov):** the stricter search is the final outcome on staging and production, so no comparison is needed |
| 4 | U05 Second email and phone search | [U05](uat-fixes/U05-secondary-contacts.md) | R1 | 7 | none | Built and tested (unit, staging integration); Edit form browser check and production backfill dry run in R1 |
| 5 | U01 No spreadsheet as resume; warning | [U01](uat-fixes/U01-resume-attachment.md) | R1 | ~10 | none | Built and tested (unit, integration, Playwright); staging repair applied (70 rows); production repair in R1 |
| 6 | U02 JD on every forward-moving email | [U02](uat-fixes/U02-jd-every-email.md) | R1 | 12 | U01 | Built and tested (unit, staging integration with Graph intercepted); Outlook rendering check in R1 UAT |
| 7 | Release 1 (staging 20 Nov, live 27 Nov) | [R1](uat-fixes/R1-release-1.md) | R1 | (part of U11) | 1–6 | **Replaced by R16 (12 Nov)** |
| 8 | U03 Candidate table in panel invite, slimmer pack | [U03](uat-fixes/U03-panel-table-and-pack.md) | R2 | ~16 | U01, U02 | Built and tested (unit, staging integration, nothing sent); Outlook / OWA check in R2 UAT |
| 9 | U07 Move to another JD: JD and earlier rounds | [U07](uat-fixes/U07-move-jd-earlier-rounds.md) | R2 | 8 | U03 | Built and tested (unit, staging integration, nothing sent); a real move with email in R2 UAT |
| 10 | U08 Zeko optional phone page and expiry reminder | [U08](uat-fixes/U08-zeko-phone-reminder.md) | R2 | ~11 | U05 | Built and tested (unit, staging integration, browser with mocked API, nothing sent); live Zeko dry run and `ZEKO_REMINDER_ENABLED` on staging in R2 UAT |
| 11 | U10 Completed forms view and morning bell | [U10](uat-fixes/U10-completed-forms.md) | R2 | ~5 | none | Built and tested (unit, staging integration with the job as a dry run, browser with mocked API, nothing sent); `FORMS_DIGEST_ENABLED` on staging and the first 09:00 bell in R2 UAT |
| 12 | U11 L08–L16 production steps and release 2 (staging 4 Dec, live 11 Dec) | [U11](uat-fixes/U11-release-2-and-l08-l16.md) | R2 | 10 | 8–11 | **Replaced by R16 (12 Nov)**: its L08–L16 steps and release steps moved there |

**Estimates:** release 1 is about 38 h (the sheet says 36) and release 2 about 50 h (the sheet says 44).
- U01 is +2 h for the staff resume upload and the repair script.
- U03 is +4 h for the pack slimming and the Source checkbox.
- U08 is +1 h for the per-candidate link.
- U10 is +1 h for the Analytics view.

## Kickoff prompt for each chat
> Feature chat **Uxx**. Read only `docs/Phase 4/uat-fixes/00-CONVENTIONS.md` and `docs/Phase 4/uat-fixes/Uxx-*.md`, plus the Handoff of any brief listed under "Depends on". Implement the brief. Its file:line references are verified, so open those ranges directly. Don't explore broadly and don't use subagents. Run the brief's tests. Finish by filling the brief's Handoff section and this item's Status above. Don't commit.

## Open items for HR / RT (none of them blocks the build)
_All three were answered on 12 Nov: see "Walkthrough feedback (12 Nov)" below._
- **U04 / N11:** `SCREENING_V2` can't be turned on in production until the N11 before/after check exists and RT signs it off. The script was never built (`docs/CHANGELOG.md:245`). Build it now (6 h, its own chat), or production keeps the old search for now.
- **U06:** should Chhaya be a standing approver (on the roster), or only decide on behalf? And when do the production flags go on?
- **U08:** the reminder lead time. The default is 24 h before the Zeko window closes.

## Walkthrough feedback (12 Nov)
**Source:** 19 comments on the walkthrough page "November UAT Fixes" (https://claude.ai/artifact/RLqexLyL5hbc3y1xHT8Y7Q).
- The threads aren't sent to Claude, so they are resolved on the page by hand.
- Chats U02b, U06b, U10b, U03b and R16 use the same conventions and kickoff prompt as above.

### Decisions and answers
| Item | Comment | Decision / answer | Chat |
|---|---|---|---|
| All | "Production ready by Monday 16 Nov" | **One release:** staging Fri 13 Nov, Chhaya's UAT Fri 13 to Sat 14, production Mon 16 Nov. All of U01–U11 goes together. | R16 |
| U02 | Reschedules too? | **Yes.** A Zeko re-booking uses the same send (`screening.service.js:2998-3008`). An Evalground re-invite is a new send (`assessmentInvite.service.js:78-88`). The Tech/HR/CEO reschedule attaches it too (`interviewSchedule.service.js:1659-1675`). The Zeko 24 h reminder carries no JD, on purpose. | none |
| U02 | Templates updated? Choose from the Templates page | No template change was needed, because code adds the JD. **New:** each candidate template gets an "Attach the JD" switch, plus a `{{jd_link}}` chip that places the JD card. | U02b |
| U02 | "Anyone" links; "it asked me for a Microsoft account" | The link clicked was the walkthrough's made-up sample URL (`uat-walkthrough/render-emails.mjs:14`). The real "anyone" link was never tried on the tenant, because tests fake the call. **Decided:** a OneDrive JD gets an "anyone" link for now, and a website JD address is sent as it is. If candidates can't open a JD, we revisit. | U02b, checked in R16 |
| U02 | No JD on Offer / Documents | Confirmed. | none |
| U03 | Skipped rounds / "we should not miss the gaps" | Rows come only from scorecards, notes and recordings. Three gaps are closed:<br>(1) a note from a skipped round<br>(2) a note left from an older journey<br>(3) a recording from a cancelled booking | U03b |
| U03 | Rows fine; refresh templates; "if HR updated, don't change it" | A targeted refresh of the two panel templates, changing a row only if HR never edited it. The full seed is never run. | U03b, run in R16 |
| U04 | Stricter search is final, staging and prod | N11 is dropped. `SCREENING_V2=true` on both. The checklist wording is corrected (exact cities). | R16 |
| U06 | One person from Settings, admin or HR; no new roles; prod Monday | The designee is chosen in Settings and decides **any time** an MRF is pending. There is no away window and no role move for Chhaya. The flags go on in production on 16 Nov. | U06b, R16 |
| U08 | 24 h lead time | Confirmed. | none |
| U10 | Revise into Open Positions › Responded | The Analytics tab is removed. A Responded view inside Open Positions lists candidates by JD, using the same count as the Responded column. The bell opens it. | U10b |

**Decided on the page, 13 Nov:** the U01 warning wording stays as built, and the profile-summary box stays unticked by default. Still open: whether plain recruiters get the U10 bell. The U06 designee: the owner picks the person in Settings before UAT (13 Nov).

### Switches: decided 12 Nov
"Turn it on" for `ZEKO_REMINDER_ENABLED` (U08 reminder) and `FORMS_DIGEST_ENABLED` (U10 09:00 bell). The owner chose **(a): on in staging on 13 Nov and in production on 16 Nov.**
- Both default to **off**. Neither key is in the local `backend/.env.staging` or `backend/.env.production`, so R16 sets both on each server.
- Staging sends real email. Before the reminder goes on there, R16 lists the open Zeko bookings that would be reminded and asks the owner if any isn't a test candidate.
- `FORMS_DIGEST_ENABLED` follows U10b: if U10b slips, it stays off (R16 slip rule).
- Still open: whether plain recruiters get the bell note (`FORMS_DIGEST_ROLES`). Until HR answers, it stays as built: superadmin, admin, hr_admin_recruiter and hr.

### Chats
| # | Chat | Brief | Hours | Depends on | Status |
|---|---|---|---|---|---|
| F1 | U06b One designated person decides on behalf | [U06b](uat-fixes/U06b-on-behalf-designee.md) | ~5 | U06 Handoff | Tested on staging (12 Nov; fixture MRF 960 closed). Nobody is set as designee yet: an Admin picks the person in Settings before UAT |
| F2 | U10b Responded view inside Open Positions | [U10b](uat-fixes/U10b-responded-in-open-positions.md) | ~4 | U10 Handoff | Built (12 Nov; unit 31/31, build). **Tested 13 Nov:** Playwright spec 7/7, full unit suite 1223/1223, `completedForms` integration on staging 9/9 |
| F3 | U02b JD switch and placement on the Templates page; JD link sources | [U02b](uat-fixes/U02b-template-jd-switch-and-links.md) | ~7 | U02 Handoff | Built (12 Nov). **13 Nov:** DDL `2026-11-12-email-template-attach-jd.sql` run on staging (column in; `{{jd_link}}` on 6 templates; Evalground #60 created); `jdEveryEmail` integration 12/12 with the switch-off test run, `attach_jd` restored to NULL. Browser check of the switch still open |
| F4 | U03b Skipped rounds (no gaps); panel template refresh | [U03b](uat-fixes/U03b-skipped-rounds-and-panel-templates.md) | ~3 | U03, U07 Handoffs; run after F3 | Built (12 Nov; unit 26/26 + 4/4). **Tested 13 Nov:** full unit suite 1223/1223; `panelPack` integration on staging 12/12; `--apply` on staging replaced #23 and #27 (re-run: "already the new default"); Tech 2 schedule and reschedule previews for pipeline 2903 have no "Candidate email:" line, no raw token, no CTC. Production run is in R16 |
| F4b | U02c About AAPNA in the Shortlist template, on every shortlist (owner, 13 Nov; reworked 13 Nov) | [U02c](uat-fixes/U02c-about-aapna-jd-tab.md) | ~1–2 | U02, U02b Handoffs; before the R16 staging deploy | Built |
| F4c | U04b Keyword search: real ×N mention counts, most mentions first (owner, 13 Nov) | [U04b](uat-fixes/U04b-keyword-ranking-mentions.md) | ~3–4 | U04 Handoff; before the R16 staging deploy | Not started |
| F4d | U10c Responded per open position: the role view gets the same Responded filter (owner, 13 Nov) | [U10c](uat-fixes/U10c-responded-per-position.md) | ~2 | U10b Handoff; before the R16 staging deploy | Built and tested 13 Nov (unit 34/34, build, Playwright 9/9 mocked). Full unit suite and `completedForms` integration left to the user |
| F5 | R16 One release: staging 13 Nov, production 16 Nov | [R16](uat-fixes/R16-release-16-nov.md) | ~8 | F1–F4, all U Handoffs | Not started |
| F6 | Walkthrough page, pass B (re-capture U02b, U06b, U10b screens) | `uat-walkthrough/` scripts | ~2 | F1–F3 | Not started |

**Order:**
- F1 and F2 can run in parallel.
- F3, then F4, because both change the email-building code.
- About 19 h of feature work, Thu evening to Fri. That is tight; R16 lists what ships if a chat isn't done.

## After 16 Nov: approved follow-ups (13 Nov)
The owner approved these leftover gaps from the Handoffs on 13 Nov. They start **after R16 is live**, not before. Each one needs a brief first: one planning chat writes them, then one chat per item, as above.

| # | Item | From | Size |
|---|---|---|---|
| A1 | The attached panel report (the dossier attachment) leaves out skipped rounds the way the candidate table does | U03b Handoff | S–M |
| A2 | No share link is created for a recording from a cancelled booking | U03b Handoff | S |
| A3 | The leadership report's "Interview history" also lists the earlier role's bookings | U07 Handoff (3) | S |
| A4 | Staff resume upload parses the file, so `resume_full_text` no longer keeps the Excel row text | U01 Handoff (3) | S–M |
| A5 | The upload-job orphan re-link for Excel jobs: decide whether to drop it or fix it | U01 Handoff (2) | S |
| A6 | `docs/phase3/MRF/PW-Task/hold-fixture.mjs`: remove the hard-coded `E:/…` import path | test fixture | trivial |

**Order:** A1 with A2 (both are panel-pack code), then A3, A4, A5 and A6. The walkthrough page shows A1 under U03 and A3 under U07 as "After 16 Nov".

## Out of scope
- Updating an MRF's JD from the MRF pages (next phase).
- WhatsApp (P04).
- Changes to the dossier download.
