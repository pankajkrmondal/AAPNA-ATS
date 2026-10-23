# H5: Decide on behalf of absent approvers

## Test plan

**Scope.**

- `POST /api/mrf/:id/decision` and the **Decide on behalf of approvers** panel in the MRF details window.
- Allowed for **HR Admin Recruiter, Admin and Super Admin**, only while an absence window covers today (D1: no override). Not allowed for plain Recruiters.
- A reason is required, plus a confirmation tick.
- The decision goes through the same transaction as a link decision, recorded `identity_source = ats_user`, `decided_via = ats_delegate`, with the absence window and the actor's role in the event.
- Every open link is closed (`decided_by_delegate`).
- Emails: the outcome email to HR, an "… on your behalf" notice to **every** approver, and a confirmation to the decider.

## Test cases

| ID | Case | Expected |
|---|---|---|
| H5-01 | No window | HR Admin Recruiter: panel visible but locked with the reason; API 403 "only allowed while they are marked away" |
| H5-02 | Window open | After H4-05: panel active — window text, Approve / Reject / Hold, reason, confirmation tick |
| H5-03 | Approve on behalf | Reason + tick + Approve → trail shows APPROVED by Admin Supers **on behalf of approvers**; event `approved` (`via: ats_delegate`, absence 22–25 Oct set by Pan mondal, actorRole); `delegate_notice_sent` × 2; `decision_confirmation_sent` to the decider; outcome email "Approved: New MRF Request"; all approval reminder rows closed |
| H5-04 | HR Admin Recruiter can't open the window | PUT absence → 403 |
| H5-05 | Plain Recruiter refused | API 403 `role_too_low` even inside a window |

## Results log

### Run 1: 22 Oct 2026

| ID | Result | Notes |
|---|---|---|
| H5-01 | PASS | `screenshots/H5-01-panel-locked-no-window.png`; API 403 |
| H5-02 | PASS | `screenshots/H5-02-panel-open-in-window.png` |
| H5-03 | PASS | `screenshots/H5-03-approved-on-behalf-trail.png`; events 121–124; logs 850–853 |
| H5-04 | PASS | 403 "Admin access required to change this configuration." |
| H5-05 | NOT RUN (browser) | Staging has no plain Recruiter login left (`admin` was moved to HR Admin Recruiter for these tests). Covered by unit tests (`canDecideAsDelegate` → `role_too_low` for recruiter / hr / vendor). Retest with a Recruiter account when one is available |

**Clean-up after the run.** The absence window was switched **off**. ZZ-TEST MRF 717 was **closed** (reason `budget_withdrawn`, note "ZZ-TEST fixture … closed after the run") so it never appears as an open role. Hold rules are at their defaults (30 / 180 / 09:00).
