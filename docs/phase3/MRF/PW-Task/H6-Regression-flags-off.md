# H6: Regression with both flags off, and the full suite

## Test plan

**Scope.** With `MRF_HOLD_ENABLED=false` and `MRF_DELEGATE_DECISION_ENABLED=false`:

- approvers get Approve / Reject only (no Hold button, no `hold_config`);
- the hold action and the on-behalf endpoint are refused in words;
- the ATS hides the on-behalf panel and the Hold option;
- MRFs already held are **not stranded**: the held list, Change date, Release now and the daily sweep keep working.

## Test cases

| ID | Case | Expected |
|---|---|---|
| H6-01 | Hold through a link | 400 "Action must be "approve" or "reject"." |
| H6-02 | Decide on behalf | 400 "Deciding on behalf of the approvers is not switched on." |
| H6-03 | Settings card | `features: { hold: false, on_behalf: false }` (the card shows a "switched off" warning) |
| H6-04 | MRF details | `on_behalf.visible = false`, `hold.enabled = false` |
| H6-05 | Held list still served | `GET /api/mrf/held` 200 |
| H6-06 | Unit suite + build | All pass |

## Results log

### Run 1: 22 Oct 2026 (flags set to false in `.env.development`, backend restarted, then set back to true)

| ID | Result | Notes |
|---|---|---|
| H6-01 | PASS | |
| H6-02 | PASS | |
| H6-03 | PASS | |
| H6-04 | PASS | |
| H6-05 | PASS | |
| H6-06 | PASS | 882/882; `vite build` OK |

Not re-checked with the flags off: the approval email's button set. The code path is one line (`config.mrfHold.enabled ? holdLink : null`), and sending another approval email just to look at it was judged not worth the extra mail.
