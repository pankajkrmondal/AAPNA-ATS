# Phase 3 feedback: triage notes

**Updated:** 30 Sep 2026 · **Workbook:** `ATS App - Phase wise Task Items.xlsx`

**Implementation plans (updated 9 Oct):** [PLAN-Phase3-Now.md](PLAN-Phase3-Now.md) (the 43 Do Now items, easy items first) · [PLAN-Phase3-in-Phase4.md](PLAN-Phase3-in-Phase4.md) (the 7 Phase 3 items deferred to Phase 4) · [PLAN-Phase4.md](PLAN-Phase4.md) (C2C, MS Access and the 11 other Phase 4 items)

The workbook lists only pending work. This file records everything else: why each item sits where it does, which
feedback it answers, and what happened to items that were moved, merged or completed.

**Sources**
- RT: `Platform Feedback & Required Changes _Recruitment ATS.docx` (29 Sep).
- CEO: the "Phase 3 Enhancements" sheet, Abhijit's rows 83-86 on the "Phase 4" sheet, and the 28 Sep demo (`Demo _AAPNA ATS (1).docx`).
- Internal: the "Phase 4" sheet.

---

## 1. The three sheets

| Sheet | What it holds | Items | Hours |
|---|---|---|---|
| **Phase 3 Enh - Do Now** | Phase 3 feedback to deliver now (N01–N43) | 43 | 374 (plus Upload speed (N41), still to estimate) |
| **Phase 3 Enh - Phase 4** | Phase 3 feedback that can wait for Phase 4 (L01–L07) | 7 | 202 |
| **Phase 4 - Updated** | Phase 4 scope: C2C Vendor (on hold), MS Access, and Other Phase 4 items (P01–P11) | 55 rows | 315 |

Each item's description has three parts:
- **Today**: the current problem.
- **Change**: what to build.
- **Done when**: how to check it is finished.

The **Remarks** column gives the source (RT §, CEO row, or "our" list) and at most one code pointer.

## 2. Priority rules

1. Priority order: bugs → RT's "most important" → CEO → our own items.
2. **If RT marked an item important, it is done now; otherwise it goes to Phase 4.**
   - RT marked two items: §4 JD tagging on upload and §11 JD attachment. Both are in Do Now.
   - §7 (skip stages) was not marked, so it is in Phase 4 (Flexible stages (L03)).
   - The API bug that lets any stage be skipped is fixed now as a bug (Skip guard (N33)).
3. Keyword and JD filtering is high priority for RT (said verbally). Under rule 7 it is still built last in Do Now, because it is the largest and riskiest change. It is released only after RT signs off on the before/after comparison.
4. C2C Vendor stays on hold. Sanghamitra asked to wait until the core has run stable for 1-2 months.
5. The longevity work is no longer parked. On 9 Oct it moved into Do Now as Developer logging & error tracing (N42) and System documentation & development history (N43).
6. Upload speed (N41) is brainstormed after all other Do Now items close.
7. **Easy items first** (from 9 Oct): every plan builds the small, low-risk items first, respecting hard dependencies.

## 3. Decisions

**Strict filtering** (Filter utility through JD - search speed (N01–N10)):
- A candidate with no value for an applied filter is excluded.
- Keyword skills have an All / Any toggle, default All, and match whole words with aliases.
- Email, phone or name input triggers an exact lookup.
- Location stays a typed input. Each typed city must equal one comma-separated part of the stored location, ignoring case.
- JD filtering: the candidate must have **all** mandatory skills first. Then experience (the parsed JD's min-max band, or the MRF's years as a minimum), budget and education are checked.

**JD tagging (JD tagging on upload (N13–N15))** applies to new uploads. The ~99k existing candidates stay untagged. They can be tagged one at a time through Search Candidate → JD (Search Candidate to JD (N21)).

**HRD (Susmita, Subhajit)** get ATS logins with upload access (Housekeeping (N40)). This replaces a separate "no-login upload link" build.

---

## 4. RT coverage check

Every requirement in RT's 29 Sep document and the item that covers it.

| # | RT requirement | Covered by |
|---|---|---|
| 1 | §1 Hold option in MRF approval (Approve / Reject / Hold) | MRF Hold (L04) |
| 2 | §1 Approval alert reads "MRF has already been approved by the CEO/CHRO [Name]" instead of an error | MRF approval alert (N16) |
| 3 | §2 Candidate form: Position Applied For with search and type | Candidate form overhaul (N18) |
| 4 | §3 Date / version against each JD, to find the latest JD for an MRF when names repeat | JD date & version (N19) |
| 5 | §3 Without an MRF, recruiters can modify or add the date shown against the JD | Editable JD label (no MRF) (L07) |
| 6 | §4 Excel / bulk uploads tagged to the selected JD | JD tagging - data model (N13), JD tagging - uploads (N14) |
| 7 | §4 Individual profile uploads tagged to the selected JD | JD tagging - data model (N13), JD tagging - uploads (N14) |
| 8 | §4 Tagged profiles available in JD-based filtering | JD tagging - screening filter (N15) |
| 9 | §5 JD filtering shows only profiles that match the JD criteria | JD - skill gate (N07), JD - other criteria (N08) |
| 10 | §5 Profiles in descending order of match rating | JD - ranking (N09) |
| 11 | §5 "Result is still not up to the mark" | JD - skill gate through Before/after check (N07–N11; RT signs off in Before/after check (N11)) |
| 12 | §5 QA Automation .NET profile rated 6.13/10 "High Match" | JD - skill gate (N07), JD - ranking (N09) |
| 13 | §5 Rating must reflect the mandatory JD criteria | JD - skill gate (N07), JD - ranking (N09); weights tuned in Scoring weights & recency (L01) |
| 14 | §5 Freshers outside the experience criteria must rate lower | JD - other criteria (N08; excluded by the experience band) |
| 15 | §6.1 QA Automation tag consistent between Screening and Pipeline | QA Automation tag (N20) |
| 16 | §6.2 Move candidates from Search Candidate to a JD / position | Search Candidate to JD (N21) |
| 17 | §6.2 Keyword Search shows email ID and contact number | Keyword - screen changes (N06) |
| 18 | §6.2 Option to move the candidate to the required stage | Move / re-tag candidate (L02) |
| 19 | §6.2 "Location has to be perfect match" | Keyword - strict filters (N03) |
| 20 | §7 Skip a stage when required (HR Screening → Evalground, HR Screening → Functional, Assessment → CEO) | Flexible stages (L03) |
| 21 | §7 Only authorized users can skip | Flexible stages (L03); Skip guard (N33) closes the current API gap |
| 22 | §7 A skipped stage can be re-opened or completed later (walk-in: Evalground after Tech 1) | Flexible stages (L03) |
| 23 | §8 Keyword results show Candidate Name, Email ID, Contact Number | Keyword - screen changes (N06) |
| 24 | §8 Exact match beyond contact number (email, name) | Keyword - exact lookup (N02) |
| 25 | §9 Capture the candidate's contact number, as Zeko does | Candidate phone & interview reminders (N22) |
| 26 | §9 Reminder to that number once the interview is scheduled | Candidate phone & interview reminders (N22; Zeko SMS + ATS reminder emails); SMS / WhatsApp reminders (P04) |
| 27 | §10 Scheduling shows interviewer **and** interviewee email | Interviewer & interviewee (N23) |
| 28 | §11 JD attached to the automatic email when a JD-tagged candidate is shortlisted or moves to the next stage | JD attached to emails (N17) |
| 29 | §12 CEO round optional: enabled or skipped per requirement | CEO round optional (N24) |
| 30 | "Matching & score analysis takes too long … it will be huge later" | JD - search speed (N10); Upload speed (N41; to brainstorm) |

## 5. CEO coverage

| Source | Ask | Covered by |
|---|---|---|
| Phase 3 Enh. row 2 | Raw vs qualified counts, with a stored "responded" status | Raw vs qualified (interim) (N37; interim numbers now); Responded status & source marker (P01; stored status) |
| Phase 3 Enh. row 3 | Clear pipeline column labels; legend for "invited" vs "in progress" | Labels & legends (N35) |
| Phase 3 Enh. row 4 | Evalground test send with a visible "test sent" status | Labels & legends (N35). Sending already exists: email or "mark sent" in the drawer |
| Phase 3 Enh. row 5 | Cross-position dashboard, open → close journey, hiring-to-joining ratio | Analytics - Positions tab (N39); date range and Total Applied in Analytics - date range & Total Applied (L06) |
| Phase 3 Enh. row 6 | Longevity: docs, runbooks, monitoring and alerting, error handling | Developer logging & error tracing (N42); System documentation & development history (N43) |
| Phase 4 row 83 | Search limited to responders; late responders rank lower; marker for responded vs old database | Responded status & source marker (P01) |
| Phase 4 row 84 | Recency filter (7 / 10 / 15 days, 1 / 3 months) and dates in the ranking | Recency filter (N38); Scoring weights & recency (L01) |
| Phase 4 row 85 | Drop-out rules for non-responders | Drop-out rules (L05) |
| Phase 4 row 86 | Hiring-manager role with a read-only view of their own positions | Hiring-manager read-only role (P03) |
| Demo | List of all open positions and their status | Analytics - Positions tab (N39); stale MRFs closed in Housekeeping (N40) |
| Demo | Automatic action when resumes are uploaded against an open position | Already exists (missing-details and first-contact emails fire on upload); per-position tagging JD tagging on upload (N13–N15) |
| Demo | How do we know a test was sent? | Labels & legends (N35) |
| Demo (Anuj) | Daily status to hiring managers; position journey | Hiring-manager status email (P02); Analytics - Positions tab (N39) |
| Demo (Chhaya) | HRD hiring outside the ATS | Housekeeping (N40) |

## 6. What happened to each row of the original "Phase 4" sheet

| Row | Item | Now |
|---|---|---|
| 3-42 | C2C Vendor (40 rows) | Phase 4 - Updated, on hold |
| 44-47 | MS Access feasibility / export | Phase 4 - Updated |
| 48 | Prompt Config | Prompt configuration (P05) |
| 49 | Settings page (theme) | **Done**: Settings has Light / Dark / System |
| 50 | All candidate list | **Done**: this is Search Candidate. Date Added column is Date Added column (N27) |
| 51 | Captcha | **Done** on the login pages; public MRF form is Captcha on public MRF form (P08) |
| 52 | Logs visible to developers | Developer logging & error tracing (N42) |
| 53-55 | Admin Config UI: stages, outcomes, reasons | **Done**; polish is Admin Config UI polish (P10) |
| 56 | Zeko 90-day R&D | Zeko 90-day re-interview check (P09) |
| 57 | Website Integration | Merged into Website candidates report (P07). Website applications already reach the ATS through the recruitment mailbox |
| 58 | Analytics per role | Analytics - Positions tab (N39; Moved Forward); Analytics - date range & Total Applied (L06; Total Applied) |
| 59 | AI in Pipeline & Analytics | **Needs definition**; not listed until scoped |
| 60 | Reminder settings | Reminder settings in one place (P06) |
| 61 | Dashboard recent candidates | Dashboard fixes (N36) |
| 62 | Tag candidate to a JD by name, show in analytics | Keyword - exact lookup (N02), Search Candidate to JD (N21), JD tagging on upload (N13–N15) |
| 63 | JD + AAPNA details to the candidate | JD attached to emails (N17) |
| 64 | Name search in keyword filtering | Keyword - exact lookup (N02) |
| 65 | Website Data Update (8 AM Excel) | Website candidates report (P07) |
| 66 | Bug 1: dark mode on public forms | Dark mode on public forms (N31) |
| 67 | Bug 2: name change not in pipeline | Candidate data sync (N29) |
| 68 | Bug 3: pipeline popup crash | Pipeline popup crash (N30) |
| 69 | Bug 4: "Approver A, Approver B" | Approver email wording (N32) |
| 70 | Bug 5: Excel interview scores missing in pipeline | Scores in the pipeline drawer (N28; display); Excel scores to round scorecards (P11; import into scorecards) |
| 71 | Daily / weekly HM status email | Hiring-manager status email (P02) |
| 72 | Common login / upload link for recruiters outside the system | Housekeeping (N40; HRD logins) |
| 83-86 | Abhijit's items | See section 5 |

## 7. Merges (so no task appears twice)

| Merged | Into |
|---|---|
| Candidate data audit + candidate data sync | Candidate data sync (N29) |
| Past-round scores + Excel-uploaded scores in the drawer | Scores in the pipeline drawer (N28) |
| Background scoring + vector index (was in both JD speed and scoring weights) | JD - search speed (N10) |
| Position timeline (was in both Analytics part 2 and the Positions tab) | Analytics - Positions tab (N39) |
| Evalground import matching any journey | Flexible stages (L03) |
| Website Integration + Website Data Update | Website candidates report (P07) |
| Common login / upload link | Housekeeping (N40) |
| Logs visible to developers; the parked longevity alerts and error view | Developer logging & error tracing (N42) |
| Parked longevity runbook; system documentation request (9 Oct) | System documentation & development history (N43) |

## 8. Removed

- **Duplicate resume for "Carol" (demo):** a recruitment-team data-entry mistake, not a system issue.
- **"Automatic outreach on upload":** already exists.
- **"Longevity follow-ups from the CEO meeting":** dropped. The longevity work itself is now Developer logging & error tracing (N42) and System documentation & development history (N43).

## 9. Changes since the 29 Sep version

**Moves and scope changes:**
- **JD tagging** (old L01-L03) moved into Do Now as N13-N15, under the "RT important → now" rule.
- **Skip-stage stopgap** (old N18) moved to Phase 4 as part of L03. Its API guard stays in Do Now as N33.
- Old L04, L11, L12 and L14 moved to the Phase 4 sheet as P01-P04.
- **New item:** N41 upload speed (to brainstorm later).
- HRD logins replace the "vendor logins" wording in housekeeping.
- The workbook no longer carries "Moved" or "Done" rows, total rows or the coverage table. They now live in this file.

**ID map (29 Sep → 30 Sep):**

| 29 Sep | 30 Sep |
|---|---|
| N01-N12 | N01-N12 (unchanged) |
| N13 approval alert | N16 |
| N14 candidate form | N18 |
| N15 JD date & version | N19 |
| N16 QA tag | N20 |
| N17 Search Candidate → JD | N21 |
| N18 skip stopgap | L03 + N33 |
| N19 phone capture | N22 |
| N20 interviewer & interviewee | N23 |
| N21 JD attached | N17 |
| N22 CEO round optional | N24 |
| N23-N25 carry-overs | N25-N27 |
| N26 + N27 scores | N28 |
| N28 + N29 data audit / sync | N29 |
| N30-N32 | N30-N32 |
| N33 date format | N34 |
| N34-N38 | N35-N39 |
| N39 housekeeping | N40 |
| L01-L03 JD tagging | N13-N15 |
| L04 | P01 |
| L05 scoring weights | L01 |
| L06 move / re-tag | L02 |
| L07 flexible stages | L03 |
| L08 MRF Hold | L04 |
| L09 drop-out rules | L05 |
| L10 analytics part 2 | L06 |
| L11 | P02 |
| L12 | P03 |
| L13 JD label | L07 |
| L14 | P04 |
| L15-L17 longevity | L08-L10 |
| P4-N1 Admin Config polish | P10 |
| P4-N2 Excel scores → scorecards | P11 |
| P4-N3 Evalground any journey | L03 |

## 9a. Changes on 9 Oct

- **Two new Do Now items**, at your request:
  - **Developer logging & error tracing (N42), 30 h:** request references, logging of external calls, job and crash alerts, browser error capture, and an admin "Logs & errors" page.
  - **System documentation & development history (N43), 24 h:** `docs/system/` overview, modules, data model, jobs, configuration, runbook, onboarding, and the history since January 2026.
- **The three parked longevity items** (alerts, error view, runbook) were folded into those two. They are removed from "Phase 3 Enh - Phase 4", which now holds L01–L07.
- **Easy items first.** The plans were re-sequenced:
  - Do Now runs over five weeks: quick wins → logging and small items → medium features → larger features → the filtering rework last.
  - Phase 3 in Phase 4 and Phase 4 are also ordered smallest-first. Exceptions: Drop-out rules stays after Flexible stages, and the Hiring-manager role stays after the HM status email.
- **Dependency changes caused by the reorder:**
  - Candidate phone & interview reminders (N22) builds its own phone normaliser.
  - Website candidates report (P07) now adds the `intake_source` field, and Responded status & source marker (P01) reuses it.

## 10. Totals (hours)

| Sheet | Section | Hours |
|---|---|---|
| Do Now | A. Strict keyword & JD filtering | 75 |
| | B. JD tagging on upload | 48 |
| | C. Other RT feedback | 85 |
| | D. Bugs & data correctness | 50 |
| | E. CEO clarity, dashboard & analytics | 62 |
| | F. Developer logging & system documentation | 54 |
| | G. Housekeeping | 0 |
| | H. Upload speed | to estimate |
| | **Total** | **374** (about 5 weeks for 2 developers, easy items first) |
| Phase 3 Enh - Phase 4 | Scoring weights & recency through Editable JD label (no MRF) (L01–L07) | 202 |
| | **Total** | **202** |
| Phase 4 - Updated | C2C Vendor (on hold) | 83 |
| | MS Access | 10 |
| | Other Phase 4 items (P01–P11) | 222 |
| | **Total** | **315** |
