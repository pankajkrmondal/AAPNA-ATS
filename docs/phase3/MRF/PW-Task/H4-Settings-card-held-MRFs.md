# H4: MRF list, details window, Settings card

## Test plan

**Scope.**

- **MRF list:** "On Hold" tab, ON HOLD badge (blue) with "until …" and a tooltip.
- **Details window:** hold banner (until, days left, who, note), **Change date** and **Release now** for HR Admin Recruiter and above.
- **Settings › MRF Approval & Hold:** approvers, who can decide on behalf (by role), the approver-absence window (Admin+ only), hold rules (HR Admin Recruiter+ edit), and the Held MRFs table.
- **Dashboard:** the Active MRFs footnote names on-hold MRFs separately.

**Accounts.** `admin` (HR Admin Recruiter test account) and `pankaj` (Super Admin).

## Test cases

| ID | Case | Expected |
|---|---|---|
| H4-01 | On Hold tab | Only the held fixture; badge "ON HOLD until 05 Nov 2026" |
| H4-02 | Details banner | ON HOLD · until · days left · held by · note; Change date + Release now; approver list "Put it on hold" / "Closed — put on hold" |
| H4-03 | Change date | 60 days + note → banner "until 21 Dec 2026"; event `hold_date_changed` (from/to, actorRole `hr_admin_recruiter`); "hold extended/changed" email |
| H4-04 | Release now | Confirm → "Waiting for a decision"; status `pending`; request row `managersubmitted`; new links to both approvers (`reason: hold_released`, `by` = the user) |
| H4-05 | Settings, Super Admin | Card loads; set absence 22–25 Oct + note → "On-behalf decisions open until 25 Oct 2026", "Last set by Pan mondal" |
| H4-06 | Settings rights by role | HR Admin Recruiter: saving hold rules → 200; opening the absence window → 403 "Admin access required…" |
| H4-07 | Absence back off | Super Admin switches it off → "Approvers marked available", `in_effect: false` |
| H4-08 | Dashboard | `onHoldMRFs` returned; 0 after the run |

## Results log

### Run 1: 22 Oct 2026

| ID | Result | Notes |
|---|---|---|
| H4-01 | PASS | `screenshots/H4-01-mrf-list-on-hold-tab.png` |
| H4-02 | PASS | `screenshots/H4-02-details-hold-banner.png`. Cosmetic fix: a double full stop after the note ("…test).”.") removed |
| H4-03 | PASS | Event 110; log 842 |
| H4-04 | PASS | `screenshots/H4-04-after-release.png`; events 111–113; tokens 27/28 |
| H4-05 | PASS | `screenshots/H4-05-settings-card-absence-on.png` |
| H4-06 | PASS | API from the HR Admin Recruiter session |
| H4-07 | PASS | Left **off** after the run |
| H4-08 | PASS | `{ onHold: 0, pending: 2 }` after clean-up |

**Not covered in this run:** the Held MRFs table's own Change date / Release now buttons (the same API as H4-03/H4-04, exercised from the details window instead), and a plain Recruiter's read-only view of the card (no plain Recruiter account left on staging; see H5-05).
