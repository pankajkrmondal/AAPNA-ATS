# T3: Undo actions and integration paths (plan §6 phase 3)

## Test plan

**Scope.**
- **Withdraw Evalground invite**: `POST /api/pipeline/assessment-import/invite/:pipelineId/withdraw { reason, notify_candidate }`; drawer button + dialog (reason required, "email the candidate" on by default, "disable the link in Evalground" reminder).
- Deadline checker skips withdrawn invites (`assessmentDeadlineChecker.js`).
- Vendor line "assessment cancelled" (`VENDOR_EVENTS.ASSESSMENT_CANCELLED`).
- Late result after withdraw: import does not auto-decide; writes a note.
- **Cancel document request**: `POST /api/pipeline/:id/documents/cancel { reason? }`; drawer button + dialog; link shows closed; re-request reopens it.
- **Zeko cancel** writes a `note` event on the journey.
- Evalground import's auto-approve uses the new landing rule (through `setStageOutcome`).
- Template seed: *Evalground Test Cancelled* (inline fallback until seeded).

**Pass criteria.** Each undo unlocks the card (move allowed afterwards), writes one history note, and sends at most the one intended email.

## Test cases

| ID | Case | Steps | Expected |
|---|---|---|---|
| T3-01 | Withdraw button shown | Candidate on Assessment with an open invite, flag on | Drawer Assessment panel shows "Withdraw invite" |
| T3-02 | Reason required | Open the dialog, leave reason empty | "Withdraw invite" button disabled |
| T3-03 | Withdraw with email | Reason typed, email ticked, confirm | Success toast. Invite row has `withdrawn_at/_by/_reason`. One cancellation email in `rpa_email_log`. Note event "Evalground invite withdrawn. Reason: …" |
| T3-04 | Card unlocks | After T3-03 | Board card has no lock; move allowed |
| T3-05 | No overdue bell | Withdrawn invite past its deadline; run the checker | No overdue notification for it |
| T3-06 | Vendor line | Vendor-sourced journey, withdraw | Vendor status mail "IQ / Tech Assessment — assessment cancelled." |
| T3-07 | Withdraw without email | Untick email | No candidate email; event `email_sent = false` |
| T3-08 | Re-invite after withdraw | Click "Send Evalground Invite" | New invite row; card locked again |
| T3-09 | Withdraw refused with a result | A result already imported | 409 "A result has already arrived…" |
| T3-10 | Late result | Withdraw, then import a CSV row for the candidate (still on Assessment) with automation on | Not auto-decided; note "result arrived after the invite was withdrawn" |
| T3-11 | Cancel document request | Candidate on Documents, request open; Cancel → confirm | Success toast; `token_status = closed`; note "Document request cancelled…"; card unlocks |
| T3-12 | Candidate link closed | Open `/documents/<token>` after T3-11 | Page says the link is closed; upload refused (410) |
| T3-13 | Re-request reopens | "Send document request again" | `token_status = active`, same token, email sent; card locked again |
| T3-14 | Cancel twice | Call cancel on a closed request | 400 "already closed" |
| T3-15 | Zeko cancel note | Cancel a Zeko interview from the drawer | Note event "Zeko interview cancelled. Reason: …" on the journey; card unlocks |
| T3-16 | Interview cancel unlocks | Cancel a booked Tech 1 interview | Card unlocks; move allowed |
| T3-17 | Import landing | Walk-in: Tech 1 approved, moved to Assessment, import auto-approves | Lands on the next not-passed stage after Assessment (not Tech 1) |

## Results log

### Run 1: 16 Oct 2026

| ID | Result | Notes |
|---|---|---|
| All | BLOCKED | Staging DB unreachable. Backend changes syntax-checked (`node --check`) and unit suites pass (765/765) |

### Run 2: 16 Oct 2026 (staging, Playwright, flag on)

| ID | Result | Notes |
|---|---|---|
| T3-01 | PASS | "Withdraw invite" shown beside "Re-invite" once 2372 had an open invite |
| T3-02 | PASS | Confirm disabled while the reason is empty; "email the candidate" ticked by default; the Evalground-dashboard reminder is shown. Screenshot `screenshots/T3-03-withdraw-dialog.png` |
| T3-03 | PASS | Invite 26: `withdrawn_at` set, `withdrawn_by = 1`, reason stored. Note event "Evalground invite withdrawn. Reason: …" with `email_sent = true`. One email "Your assessment for FlexStage Test Role has been cancelled" (staging redirect inbox) |
| T3-04 | PASS | Drawer shows "Move to…" again and "Send Evalground Invite"; board card unlocked |
| T3-05 | PASS | Withdrawn invite backdated past its deadline: old query lists it, shipped query (`withdrawn_at IS NULL`) does not; the job file contains the filter |
| T3-06 | PASS | 2375 (vendor-sourced): vendor mail "IQ / Tech Assessment — assessment cancelled." after the earlier "assessment invitation sent." |
| T3-07 | PASS | Email unticked: no candidate email; event `email_sent = false`, `email_error = "Not sent: the recruiter chose not to email the candidate."` |
| T3-08 | PASS | Re-invite after withdraw → 200, new invite row, card locked again |
| T3-09 | PASS | 2375 with an imported result: withdraw → 409 "A result has already arrived for this test. Record the decision instead." Also: blank reason → 400; no open invite → 400 |
| T3-10 | PASS | Assessment automation is ON. CSV (Marks 62, Passed) imported for 2375 after its invite was withdrawn: NOT auto-approved, stays on Assessment; note "Evalground result arrived after the invite was withdrawn … review it before recording an outcome." Card then locked "Evalground result received and awaiting a decision." |
| T3-11 | PASS | 2373: request → locked; "Cancel document request" → dialog (optional reason, "No email is sent") → `token_status = closed`, note written, card unlocked, segment "Request cancelled — the upload link is closed" |
| T3-12 | PASS | `/documents/<token>`: "This upload link is closed. Please contact the recruitment team…" Screenshot `screenshots/T3-12-candidate-link-closed.png` |
| T3-13 | PASS | "Send document request again": same token, `token_status = active`, card locked again |
| T3-14 | PASS | Cancel on a closed request → 400 "This document request is already closed." |
| T3-15 | NOT RUN LIVE | The Zeko cancel calls Zeko's external API; not sent fixture data. The Zeko lock itself is verified on real cards (T2-06). The note write is a best-effort block after the existing status update |
| T3-16 | PASS | 2371: "Cancel Interview" → toast "Interview cancelled — candidate notified."; drawer "Move to…" and card unlocked |
| T3-17 | PASS | Scenario 5 (walk-in) on 2372: moved to Tech 1, approved (→ Tech 2), moved back to Assessment, fresh invite, CSV import (70, automation ON) matched 2372 through its `moved` arrival and auto-approved; landed on Functional Screening (next not passed), not Tech 1 |
