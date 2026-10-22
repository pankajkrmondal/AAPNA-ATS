# Section D: testing points (N32, N34, N28, N29)

**For:** whoever checks section D on staging after it is deployed. **Changelog:** [CHANGES-2026-10-16-phase3-section-d.md](../changelog/CHANGES-2026-10-16-phase3-section-d.md).
Tick each box. "Expected" is what passes; anything else is a bug to report with a screenshot.

---

## Before you start
- [ ] **Section D is deployed to staging** (backend and frontend). Until then, staging runs the old code and these checks fail.
- [ ] **Approver list restored** (needed for N32 only). Staging's `mrf_approvers` still holds the integration-test values (`n16.ceo@` / `n16.chro@example.invalid`), so staging approval links go nowhere. Restore it with the real staging approvers, and record the change in `DB-CHANGE-LOG.md`.
- [ ] **A staff login** (admin or recruiter) and, for one check, **a vendor login**.
- [ ] Optional, for the automated screen run: set `E2E_USER` / `E2E_PASSWORD`, then run `npx playwright test e2e/section-d.spec.js` from `frontend/`. It covers points 2.1, 3.1, 3.3 and 4.4, only reads data, and skips what staging has no data for. Screenshots go to `frontend/test-results/section-d/`.

---

## 1. N32 · Approver names (needs the approver list restored)
| # | Steps | Expected |
|---|---|---|
| 1.1 | MRF page → open an **old** MRF that was approved through an approval link (from before 16 Oct) → View → Approval trail | Approvers, "Approved by" and the timeline show the **real names** (e.g. Abhijit Roy), never "Staging Approver A/B" |
| 1.2 | Same MRF → Export | "Decided By" shows the real name |
| 1.3 | Submit a new MRF on staging → open the approval email | "This request was also sent to …" names the other approver with their title |
| 1.4 | Open that email's approval link | "Reviewing as **<real name>**" |
| 1.5 | Approve it; open the link from the **other** approver's email | "Already approved by the CEO <real name> on …" |

## 2. N34 · One date format
Set the browser's language to **English (United States)** (or use a US-locale browser profile).

| # | Steps | Expected |
|---|---|---|
| 2.1 | Open Dashboard, Search Candidate, MRF, Pipeline (and a drawer), Candidate Screening, HR Upload, Vendor portal | Dates read `07 Oct 2026`; date and time read `07 Oct 2026, 4:30 PM`. **Never** `10/7/2026`, `7/10/2026`, `Sept` or a lower-case `pm` |
| 2.2 | Notification bell, Live activity feed, Email templates ("Saved …"), Email delivery ("last sync …"), Pipeline "Updated …" | Relative times: `just now`, `5 min ago`, `3 h ago`, `2 d ago`; older than a week → `07 Oct 2026` |
| 2.3 | Dashboard → Upcoming interviews | Date badge and time are IST and match the interview's IST time |
| 2.4 | Public MRF form (`/mrf-submit`) → Date of Request picker | Shows `07 Oct 2026` (was `07/10/2026`) |
| 2.5 | Submit an MRF → the new-MRF email | "Date of Request" reads `07 Oct 2026` |
| 2.6 | Schedule an interview → candidate invite / reminder email | `07 Oct 2026, 4:30 PM IST` (was "07 October 2026, 04:30 pm IST") |
| 2.7 | Export any CSV | Dates are still `YYYY-MM-DD` (unchanged on purpose) |

## 3. N28 · Scores in the pipeline drawer
Use a candidate who has passed HR screening (Zeko), the assessment and Functional screening, and is at Tech 2 or later.

| # | Steps | Expected |
|---|---|---|
| 3.1 | Pipeline → open the candidate → click the **HR (Zeko)** pill | "Awaiting Results" shows HR's own scores (chips) and the Zeko report link. **Not** "Awaiting Zeko to sync" |
| 3.2 | Click the **Functional (Zeko)** pill | Functional's own scores. Compare with 3.1: the HR card must **never** show Functional's numbers (this was the bug) |
| 3.3 | Click **Assessment** | Evalground result, plus a **"View the Evalground report"** link that opens the report |
| 3.4 | Click **Tech 1** (scorecard submitted) | One line per interviewer: email, `4.2 / 5`, verdict tag (approve / reject) |
| 3.5 | Open a candidate whose record has Excel scores (IQ / Tech / Tech round feedback) | A collapsed **"Uploaded scores (from Excel)"** card above the pills, "N values · editable in Search Candidate"; it expands to the list. A candidate with none: no card |

## 4. N29 · Candidate data sync (both ways)
Use a **test** candidate who is in the pipeline (not a real one: these steps rename them).

| # | Steps | Expected |
|---|---|---|
| 4.1 | Search Candidate → Edit → change the **name** → Update Candidate | Pipeline board card, drawer header, Analytics stuck list (if listed) and a drawer email preview all show the **new name** after a refresh |
| 4.2 | Edit → change the **email** | Drawer shows the new email; the drawer's email thread still shows mails from the **old** address |
| 4.3 | Open the candidate's missing-details link (from their email), change the name, submit | The pipeline shows the new name |
| 4.4 | Search Candidate → View the candidate | A **"Pipeline scores"** section: one card per MRF ("Role · MRF-123", "At Tech 2"), rows per scored round (Zeko, Evalground, interview averages) |
| 4.5 | Open Edit and press **Update Candidate** without changing anything | "No changes to save." Nothing changes |
| 4.6 | Open Edit on a candidate; in another tab, record a pipeline outcome for them; back in the first tab change only the phone and save | The Final Status set by the pipeline is **kept** (the form no longer writes old values back) |
| 4.7 | Edit form → Zeko score fields | Hint under each: "Updated automatically by Zeko sync" |
| 4.8 | Log in as a **vendor** → Search Candidate | No Edit button. (API: `PATCH /api/candidates/:id` returns 403 for a vendor) |
| 4.9 | Edit a candidate's **skills** or experience, wait a minute, run a keyword search that matches the new skill | The candidate is found on the new skill (search profile rebuilt). A name-only edit doesn't rebuild it (no embedding call in the logs) |

---

## Already done on staging (16 Oct): nothing to repeat
- Backfill of drifted pipeline names: 2 rows fixed, a re-run finds 0.
- Integration tests: `candidateDataSync` 5/5, `missingDetailsCompleted` 3/3, `sectionC` 6/6, `rescheduleEmails` 2/2, `schedulingAndScorecard` 20/20, `pipelineStageEngine` 17/17.
- `mrfApprovalExpiredLink` now refuses to run until the approver list is restored. Re-run it after the restore. It must pass 4/4 **and** leave the approver list as it found it.

## Report back
For each failed point: the number (e.g. 3.2), the candidate or MRF, what you saw, and a screenshot.
