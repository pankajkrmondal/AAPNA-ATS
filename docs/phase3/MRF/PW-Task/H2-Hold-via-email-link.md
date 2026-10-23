# H2: Hold through the approver's email link

## Test plan

**Scope.**

- The public approval page (`/mrf/:id/approve?action=…&token=…`) offers **Approve / Reject / Hold**.
- Hold asks for a hold-until date (min tomorrow, max today + `mrf_hold_max_days`, default today + `mrf_hold_default_days`) and a mandatory note.
- Holding sets `approval_status = 'held'`, closes every open link (reason `held`) and every reminder row, and mirrors `mrfstatus = 'held'`.
- Holding emails a hold notice (HR + hiring manager + the other approvers) and a confirmation to the holder.
- Every other link then shows "on hold" and cannot decide.
- The approval email carries a third **Hold Requisition** button.

**Fixture.** ZZ-TEST MRF **717** ("ZZ-TEST MRF Hold 2026-10-22 11:02", request #191), created on staging by a scratch helper (`hold-fixture.mjs`: create / links / state / email / due). Staging approvers: "N16 Chief" and "N16 People". Mail is redirected to the test inbox.

## Test cases

| ID | Case | Steps | Expected |
|---|---|---|---|
| H2-01 | Hold form | Open approver A's link with `action=hold` | Hold selected; date defaults to +30 days; quick choices 2 weeks / 30 / 60 / 90; limits text; note marked required |
| H2-02 | Can't hold without a note | Leave the note empty | "Put Requisition on Hold" disabled (and looks disabled) |
| H2-03 | Hold | Choose 2 weeks (05 Nov 2026), enter a note, submit | Success view "On hold until 05 Nov 2026"; DB: `held`, `held_until`, `held_by`, note, `hold_count = 1`; request row `held`; both tokens revoked `held` (holder's also used); approval reminder rows closed; events `held`, `hold_notice_sent`, `decision_confirmation_sent` |
| H2-04 | Other approver's link | Open approver B's link; POST approve with it | Page "On hold — put on hold by N16 Chief … until 05 Nov 2026 … This link can no longer be used"; API 409 with that message; `attempt_after_decision` recorded |
| H2-05 | Server validation | POST hold with today / +181 days / no note / 30 Feb | 400 each, in words |
| H2-06 | Emails | Inspect `rpa_email_log` | Hold notice to HR (+HM, +other approver in prod) "on hold until …"; confirmation "You put on hold MRF #717 …"; approval emails have Approve / Reject / **Hold** buttons |

## Results log

### Run 1: 22 Oct 2026 (local code, staging DB, both flags on)

| ID | Result | Notes |
|---|---|---|
| H2-01 | PASS | `screenshots/H2-01-approver-page-hold.png` |
| H2-02 | FAIL → fixed → PASS | The button's colour style overrode antd's disabled look, so it looked clickable. Colour now applies only when usable. Retest: `disabled`, grey background |
| H2-03 | PASS | `screenshots/H2-03-hold-success.png`; DB checked with the helper (events 105–107) |
| H2-04 | PASS | `screenshots/H2-04-other-approver-sees-hold.png`; 409 "This MRF was put on hold by N16 Chief until 05 Nov 2026. A new approval email will be sent to every approver on that date." |
| H2-05 | PASS | "The hold-until date must be after today." / "An MRF can be held for at most 180 days (until 20 Apr 2027)." / "Please add a note saying why the MRF is being put on hold." / "Please choose the date the hold should end (YYYY-MM-DD)." |
| H2-06 | PASS | Log 840 hold notice; 841 confirmation; 843/844 have all three buttons and a working `action=hold` link |
