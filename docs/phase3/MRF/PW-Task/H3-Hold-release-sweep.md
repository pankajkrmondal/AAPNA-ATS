# H3: Hold release: the "done when" criterion

> **Done when:** a held MRF re-prompts its approvers on the hold-until date.

## Test plan

**Scope.**

- `jobs/mrfHoldSweep.js` runs daily at the Settings release time (IST). It releases every held MRF whose `held_until` ≤ today (IST) that is not closed or filled.
- A release sets `pending` and `hold_released_at`, sets the request row back to `managersubmitted`, and records event `hold_released`.
- It then sends **new personal links to every approver on the roster**: the same email as the first time, plus a "Back from hold" banner.
- The `held → pending` claim makes it exactly-once. A missed day is caught up.
- "Hold further" works (no limit), and old links report "replaced".

**Approach.** The hold-until date can't be reached in a test run, so the helper's `due` command (test only) moves `held_until` to yesterday and calls the real `runMrfHoldSweep()` twice.

## Test cases

| ID | Case | Expected |
|---|---|---|
| H3-01 | Hold further | Approver B holds the released MRF again (until 30 Nov) → `hold_count = 2`, new hold notice + confirmation |
| H3-02 | Sweep on the date | `due: 1, released: 1, emails: 2`; status `pending`; event `hold_released` (trigger `date`, actor "System (hold-until date reached)"); 2 × `request_sent` reason `hold_released`; new tokens for **both** approvers |
| H3-03 | Exactly once | Second sweep straight after: `due: 0, released: 0, emails: 0` |
| H3-04 | Same email, banner | Body: subject "New MRF Request - Approval Request"; banner "Back from hold. Put on hold by … until …  Note: … Please approve, reject or hold further."; Approve / Reject / Hold buttons |
| H3-05 | Old link after release | A pre-hold link → page "Please use the most recent approval email"; POST → 409 "replaced by a newer one"; `token_revoked_used` |
| H3-06 | Reminders apply again | New `mrf_approval_request` log rows are open (`responded_at` null); the earlier ones are closed |
| H3-07 | Not open while held | `isOpenApprovalStatus('held') = false`; a reminder row for a held MRF is closed with "already decided"; JD dropdown / candidate tagging require `approved`, so a held MRF is never offered |

## Results log

### Run 1: 22 Oct 2026

| ID | Result | Notes |
|---|---|---|
| H3-01 | PASS | Events 115–117, `holdCount: 2`, logs 845/846 |
| H3-02 | PASS | Event 118 + 119/120; tokens 29/30. **Done-when met.** |
| H3-03 | PASS | `second sweep (must release nothing): {"due":0,"released":0,"emails":0}` |
| H3-04 | PASS | Checked log 843 (after the manual release, H4): subject unchanged, banner present, three buttons |
| H3-05 | PASS | Event 114; 409 "This approval link was replaced by a newer one. Please use the most recent approval email." |
| H3-06 | PASS | 847/848 open until the decision in H5, then closed |
| H3-07 | PASS (unit + code) | `mrfHoldRules.test.js` "held is not open"; `getApprovedRoles` / `candidateTag` require approved. Not checked in the JD dropdown UI during the hold |
