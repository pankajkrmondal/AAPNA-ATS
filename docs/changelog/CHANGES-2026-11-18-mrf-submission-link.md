# MRF · Hiring manager's submission now always links to its request (18 Nov 2026)

**Prod report:** a request was sent to `cverma@` (HM name Hardik). Chhaya filled in the MRF, and Abhijit's approval link (forwarded to her) was used to approve it. The MRF module still showed the row as PENDING, with no Submitted MRF Details, Approval Trail or Approve / Reject panel.

## Why
- The form link sent to the hiring manager carried only `?role=&emailid=`, never the request id. The server therefore guessed the request row by an exact HM email + role + `mrfstatus = 'pending'` match.
- Both fields are editable on the form. When either changed, the MRF was still created and still sent to the approvers, but it was never linked to the row, and nothing was logged.
- An unlinked row stays PENDING for good, and the HM keeps getting "please fill the MRF" reminders.

## What changed
- **The link carries `&id=<request id>`,** both in the request email (`emailNotification.service.js`) and in the Forms & Links copy (`formsLinks.service.js`). The form already sent it on as `parent_id`.
- **Linking moved to `utils/mrfParentLink.js`:**
  - `parent_id` is accepted only if it is digits. A bad value used to throw after the MRF was created, skipping the approval emails.
  - A request that already has an MRF is never taken over, and the write is conditional on `mrf_id IS NULL`.
  - The fallback for old links (email + role) now accepts every "HM not submitted yet" status, not only `pending`, using `isOpenHmRequest` from `jobs/reminderEligibility.js`.
- **A submission that can't be linked is logged as a warning.** A linking failure no longer stops the approval emails.
- **New `scripts/relink-orphan-mrfs.mjs`** repairs MRFs that are already unlinked. It is report-only by default. `--apply` links the certain matches, and `--apply --link=MRF:REQUEST` links a pair a person has confirmed.

## Not changed
- An approval link belongs to its approver: whoever opens it decides in that approver's name. A forwarded link is recorded as the approver's own decision.
- Approve / Reject in the ATS is shown only to the person chosen in Settings › MRF Approval & Hold, and needs `MRF_DELEGATE_DECISION_ENABLED=true`. Hold stays off on prod while `MRF_HOLD_ENABLED=false`.

## Tests
- **Unit:** `tests/unit/mrfParentLink.test.js`, 7/7.
- **Integration:** `tests/integration/formsLinks.test.js` now expects `&id=` in the copied link. Run it on staging.

## Production
After deploy, run `NODE_ENV=production node scripts/relink-orphan-mrfs.mjs`, read the report, then link with `--apply` (or with `--link=` for the ones that need a person to choose).
