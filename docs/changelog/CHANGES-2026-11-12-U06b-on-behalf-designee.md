# U06b · One designated person decides on behalf of the MRF approvers (12 Nov 2026)

Brief: [U06b](../Phase%204/uat-fixes/U06b-on-behalf-designee.md). Goes live with R16 (16 Nov).

**What changed**
- An Admin chooses one person in **Settings › MRF Approval & Hold › Who can decide on behalf**. Only that person can approve, reject or hold a pending MRF on behalf of the approvers, at any time. There is no away window and no role rule. The person can be any active staff member, not a vendor.
- Admins who are not that person still see the panel on an MRF, locked, with "Only <name> can decide on behalf of the approvers." Nobody else sees it.
- The person can also change the date of, or release, a held MRF. HR Admin Recruiter and above still can.
- The "Approver absence" section is gone from Settings, so the "approvers away" email has no trigger. Its stored setting and API route stay.
- New setting key `mrf_on_behalf_user` (JSON `{userId, setByUserId, setByName, setAt}`). No DDL.
- New route `PUT /api/settings/mrf-approval/on-behalf-user` `{user_id}` (Admin / Super Admin). The GET adds `on_behalf_user` and `can.edit_on_behalf_user`.
- The audit meta of an on-behalf decision stores `designee {userId, name}` instead of the away window.

**Files:** `utils/mrfApprovalRules.js`, `services/mrfHoldSettings.service.js`, `services/mrfApproval.service.js`, `controllers/mrfHoldSettings.controller.js`, `routes/settings.routes.js`, `frontend/src/components/settings/MrfApprovalHoldSettings.jsx`, `frontend/src/components/mrf/DecideOnBehalfPanel.jsx`, `frontend/src/services/mrfService.js`.

**Production:** set the person in Settings after deploy (plan §16.4 step 6), then turn on `MRF_HOLD_ENABLED` and `MRF_DELEGATE_DECISION_ENABLED`. Until someone is set, nobody can decide on behalf.
