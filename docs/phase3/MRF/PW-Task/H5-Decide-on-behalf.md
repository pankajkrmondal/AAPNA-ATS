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

### Run 2: 23 Oct 2026 (after the staging deploy of PR #105)

Accounts: `biswajit.sur` (Recruiter) and `admin` (HR Admin Recruiter). The staging login page's Cloudflare check needs a human click, so both were signed in on **localhost** (same commit, same staging DB, Turnstile test keys). The email-link decisions below ran on **https://ats-staging.aapnainfotech.com** itself.

Fixtures: ZZ-TEST MRF **828** (held → date changed → released → closed), **829** (approved → closed), **830** (rejected).

| ID | Result | Notes |
|---|---|---|
| Staging: hold via link | PASS | 828 held by N16 Chief until 22 Nov; event 148 `held`, 149 `hold_notice_sent` (log 884), 150 confirmation. Staging MRF list › On Hold tab shows 828 and 827 with "ON HOLD until 22 Nov 2026" |
| Staging: approve via link | PASS | 829 approved by N16 Chief, `decided_via=email_link`; 153 confirmation, 154 other approver told (log 888) |
| Staging: reject via link | PASS | 830 rejected by N16 People; 157 other approver told (log 890), 158 confirmation |
| Staging: old link while held | PASS | N16 People's 828 link → "This MRF is on hold … This link can no longer be used", with the note |
| H5-05 | **PASS** | Recruiter: `POST /:id/decision` 403 "Only an HR Admin Recruiter, Admin or Super Admin can decide on behalf…"; change date / release 403; hold rules 403; absence 403; Settings `can` all false. 828 details show the hold banner only: no Change date, no Release now, no on-behalf panel |
| H5-01 (repeat) | PASS | HR Admin Recruiter, no absence window: decision 403 "only allowed while they are marked away"; `can` = edit_hold_rules + manage_held, not edit_absence |
| H4 (repeat) | PASS | HR Admin Recruiter on 828: Change date + Release now shown. Date = today → 400; 01 Dec → 200, email log 898 "…hold date changed to 01 Dec 2026" (editable template #53); Release now → event 161 `hold_released` (manual), 162/163 `request_sent` reason `hold_released`; log 899 has the "Back from hold" banner and Approve / Reject / Hold buttons |

**Seen on staging (not a code bug):** the staging server's hold notice (log 884) went to HR staff mailboxes (cverma@, nsatywali@, sganguly@ …), while the same notice sent from local dev reached only the test inbox. Check the staging server's mail-redirect setting / `mrfOutcome` flow-key recipients if test mail should not reach real people.

**Clean-up:** 828 and 829 closed (`budget_withdrawn`). Absence window still off; hold rules unchanged.
