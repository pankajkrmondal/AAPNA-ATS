# U06 · MRF approve option for Chhaya (10 Nov 2026)

**Sheet:** Phase 3 UAT Fixes - Nov, U06. **Brief:** [U06](../Phase%204/uat-fixes/U06-mrf-approve-chhaya.md).
**HR report:** Chhaya can't see an Approve option on staging.

## Why (checked on the staging DB, 10 Nov)
- Chhaya (`chhaya.verma598`, id 15) is an active **HR Admin Recruiter** with `new_mrf` on, and the local copies of the staging env files have both MRF hold flags on. So the "Decide on behalf" panel shows for her.
- The panel stays **locked**, because `mrf_approver_absence` is off. It was last open 22 to 25 Oct, set by Pan mondal. She isn't on the `mrf_approvers` roster either (it holds only the two `@example.invalid` test approvers), so she gets no approval link email.
- Nothing is broken. The locked message just didn't say who can unlock it.

## What changed
- **`frontend/src/components/mrf/DecideOnBehalfPanel.jsx`:** when the reason is `no_absence_window`, the locked panel now says the approvers aren't marked away today. An HR Admin Recruiter is told to ask an Admin or Super Admin to mark them away in Settings › MRF Approval & Hold. An Admin is told to do it there. Other reasons keep the server's message, and the API's 403 message is unchanged.
- **`docs/system/05-CONFIGURATION.md`:** adds `MRF_HOLD_ENABLED` and `MRF_DELEGATE_DECISION_ENABLED` (defaults, staging and production values), the MRF hold and absence `rpa_settings` keys, and a row in the production-flags table. `MRF_APPROVAL_AUDIT_ENABLED` was already listed.

## Tests
- **Unit:** `mrfApprovalRules.test.js` 15/15. Full unit run: 1111/1111.
- **Frontend:** `npm run build` passes.
- **Staging demo:** still to do by hand (Admin opens the absence window, then Chhaya decides on behalf).
