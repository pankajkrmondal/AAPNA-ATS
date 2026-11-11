# Plan: Phase 3 UAT fixes (Nov)

**Date:** 10 Nov 2026 · **Owner:** Harish · **Source:** the "Phase 3 UAT Fixes - Nov" sheet of `ATS App - Phase wise Task Items.xlsx` (U01–U11)

**HR feedback behind it**
- `Recruitment_Process_Phases (1).xlsx`, sheet "Phase 3"
- `Email Body Table for CHRO,CEO round and Tech Rounds (with CTCs).docx`, used for U03

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
| 3 | U04 Commas in skills and location | [U04](uat-fixes/U04-keyword-commas.md) | R1 | 6 | none to build; the production flag needs N11 | Built (staging flag and prod `.env` to confirm; see Handoff) |
| 3b | N11 before/after check (**not on the sheet**; needed only to turn `SCREENING_V2` on in production) | design in `PLAN-Phase3-Now.md` §N11 | R1 or R2 | 6 | U04 | **Decision needed** |
| 4 | U05 Second email and phone search | [U05](uat-fixes/U05-secondary-contacts.md) | R1 | 7 | none | Built and tested (unit, staging integration); Edit form browser check and production backfill dry run in R1 |
| 5 | U01 No spreadsheet as resume; warning | [U01](uat-fixes/U01-resume-attachment.md) | R1 | ~10 | none | Built and tested (unit, integration, Playwright); staging repair applied (70 rows); production repair in R1 |
| 6 | U02 JD on every forward-moving email | [U02](uat-fixes/U02-jd-every-email.md) | R1 | 12 | U01 | Built and tested (unit, staging integration with Graph intercepted); Outlook rendering check in R1 UAT |
| 7 | Release 1 (staging 20 Nov, live 27 Nov) | [R1](uat-fixes/R1-release-1.md) | R1 | (part of U11) | 1–6 | Not started |
| 8 | U03 Candidate table in panel invite, slimmer pack | [U03](uat-fixes/U03-panel-table-and-pack.md) | R2 | ~16 | U01, U02 | Built and tested (unit, staging integration, nothing sent); Outlook / OWA check in R2 UAT |
| 9 | U07 Move to another JD: JD and earlier rounds | [U07](uat-fixes/U07-move-jd-earlier-rounds.md) | R2 | 8 | U03 | Built and tested (unit, staging integration, nothing sent); a real move with email in R2 UAT |
| 10 | U08 Zeko optional phone page and expiry reminder | [U08](uat-fixes/U08-zeko-phone-reminder.md) | R2 | ~11 | U05 | Built and tested (unit, staging integration, browser with mocked API, nothing sent); live Zeko dry run and `ZEKO_REMINDER_ENABLED` on staging in R2 UAT |
| 11 | U10 Completed forms view and morning bell | [U10](uat-fixes/U10-completed-forms.md) | R2 | ~5 | none | Built and tested (unit, staging integration with the job as a dry run, browser with mocked API, nothing sent); `FORMS_DIGEST_ENABLED` on staging and the first 09:00 bell in R2 UAT |
| 12 | U11 L08–L16 production steps and release 2 (staging 4 Dec, live 11 Dec) | [U11](uat-fixes/U11-release-2-and-l08-l16.md) | R2 | 10 | 8–11 | Blocked (11 Nov): U10 not built, R1 not released (staging 20 Nov, live 27 Nov), and all U-item changes are still uncommitted on top of `ff3aa34` |

**Estimates:** release 1 is about 38 h (the sheet says 36) and release 2 about 50 h (the sheet says 44).
- U01 is +2 h for the staff resume upload and the repair script.
- U03 is +4 h for the pack slimming and the Source checkbox.
- U08 is +1 h for the per-candidate link.
- U10 is +1 h for the Analytics view.

## Kickoff prompt for each chat
> Feature chat **Uxx**. Read only `docs/Phase 4/uat-fixes/00-CONVENTIONS.md` and `docs/Phase 4/uat-fixes/Uxx-*.md`, plus the Handoff of any brief listed under "Depends on". Implement the brief. Its file:line references are verified, so open those ranges directly. Don't explore broadly and don't use subagents. Run the brief's tests. Finish by filling the brief's Handoff section and this item's Status above. Don't commit.

## Open items for HR / RT (none of them blocks the build)
- **U04 / N11:** `SCREENING_V2` can't be turned on in production until the N11 before/after check exists and RT signs it off. The script was never built (`docs/CHANGELOG.md:245`). Build it now (6 h, its own chat), or production keeps the old search for now.
- **U06:** should Chhaya be a standing approver (on the roster), or only decide on behalf? And when do the production flags go on?
- **U08:** the reminder lead time. The default is 24 h before the Zeko window closes.

## Out of scope
- Updating an MRF's JD from the MRF pages (next phase).
- WhatsApp (P04).
- Changes to the dossier download.
