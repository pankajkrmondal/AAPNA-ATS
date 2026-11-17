# U06b · One designated person decides on behalf of the MRF approvers
**12 Nov feedback · goes live 16 Nov (R16) · ~5 h · Depends on: the U06 Handoff**

**Goal**
- **Today:** anyone with the HR Admin Recruiter role or above can decide on behalf, but only while an Admin has marked the approvers "away". Opening that window emails every HR Admin Recruiter.
- **Change (HR, 12 Nov):**
  - "MRF emails the approvers every time. If they aren't available, one person approves from the app."
  - "That person is set in Settings, either an admin or HR. No additional roles."
- **Done when:**
  - An Admin picks one person in Settings › MRF Approval & Hold.
  - That person, and only that person, can approve, reject or hold a pending MRF on behalf, at any time.
  - Nobody else can.

**Decisions:**
- Any time an MRF is pending or waiting; no away window.
- No role move for Chhaya in production.
- No DDL.

## Current state (verified 12 Nov)
**The role gate:**
- `canDecideOnBehalf(role)` is rank ≥ `hr_admin_recruiter` (`backend/src/config/roles.js:153-155`).
- The rule is `canDecideAsDelegate` (`backend/src/utils/mrfApprovalRules.js:488-493`). It returns `role_too_low`, `inactive_user` or `no_absence_window`; the messages are at `:496-507`.

**`decideOnBehalf`** (`backend/src/services/mrfApproval.service.js:657-666`):
- Flags at `:658-663`, `getAbsence()` at `:664`, the gate at `:665-666`.
- The audit meta stores `actorRole` and `absence` (`:687-689`). It reads `absence.from` / `absence.to` with **no null guard**.

**The trail** (`getApprovalTrail`, `:1220-1265`):
- `on_behalf.visible` = feature on AND `canDecideOnBehalf(role)` AND MRF open.
- `can_decide` = the rule passes.

**Holds** use the same role helper:
- `hold.can_manage` (`:1249`), and `assertMayManageHolds` (`:721-725`, used at `:732` and `:853`).
- Settings controller `can.*` at `backend/src/controllers/mrfHoldSettings.controller.js:71-73` and `:85-87`.

**Settings › MRF Approval & Hold** (`frontend/src/components/settings/MrfApprovalHoldSettings.jsx`, mounted at `pages/Settings.jsx:1099-1101`, API in `services/mrfService.js:208-225`):

| Section | Lines | Behaviour today |
|---|---|---|
| Approvers | `:196-206` | Read-only |
| Who can decide on behalf | `:208-223` | Read-only role tags |
| Approver absence | `:226-259` | Admin edits |
| Hold rules | `:261-301` | |
| Held MRFs | `:303-313` | |

- The settings keys are in `HOLD_SETTING_KEYS` (`mrfApprovalRules.js:306-311`), with storage in `backend/src/services/mrfHoldSettings.service.js` (`saveAbsence :59-72`).
- `listOnBehalfUsers` (`:79-98`) returns `{id, name, email, role, roleLabel}` for HR Admin Recruiter, Admin and Super Admin.
- The routes are `backend/src/routes/settings.routes.js:54-56`; the absence PUT has `requireAdmin`.

**Emails:**
- Opening the away window emails the approvers and every HR Admin Recruiter (controller `:117-124`, `hrAdminRecruiterEmails` at service `:101-107`, template "MRF Approvers Away Notice" in `mrfHoldEmailTemplates.js:70-76`).
- After an on-behalf decision (`mrfApproval.service.js:1025-1069`): the outcome email goes to HR, "MRF Decided On Your Behalf" goes to each approver, and a confirmation goes to the person who decided. The notice already copes with a null window (`:1052-1054`).

**Frontend panel** (`frontend/src/components/mrf/DecideOnBehalfPanel.jsx`):
- `isAdminTier` at `:22`; `lockedReason` handles `no_absence_window` at `:29-36`; `locked = !can_decide` at `:60`.
- It is shown from `ApprovalTrail.jsx:226`.

## Changes
1. **Setting:** a new `rpa_settings` key `mrf_on_behalf_user`, JSON `{userId, setByUserId, setByName, setAt}`.
   - Add it to `HOLD_SETTING_KEYS`.
   - Add `getOnBehalfUser()` / `saveOnBehalfUser(userId, actor)` next to `saveAbsence`.
   - On save, check that the user is active staff (not a vendor).
2. **Rule:** `canDecideAsDelegate(user, designee)` passes when `designee` is set, `user.id === designee.userId`, and the account is active.
   - Remove the role and absence checks from this rule.
   - New reasons: `no_designee` ("No one is set to decide on behalf. An Admin can choose the person in Settings › MRF Approval & Hold.") and `not_designated` ("Only <name> can decide on behalf of the approvers.").
3. **Service:**
   - `decideOnBehalf` loads the designee and calls the rule.
   - Null-guard `absence` in the audit meta. Store `designee: {userId, name}` instead.
4. **Trail:**
   - `visible` = feature on AND MRF open AND (the user is the designee, or the user is Admin or above).
   - `can_decide` = the rule passes.
   - Admins who aren't the designee see the panel locked, with the `not_designated` message.
5. **Holds:** `hold.can_manage` and `assertMayManageHolds` allow rank ≥ HR Admin Recruiter **or** the designee. This keeps today's behaviour and adds the designee.
6. **Settings backend:**
   - Widen `listOnBehalfUsers` to active `superadmin`, `admin`, `hr_admin_recruiter`, `hr` and `recruiter`.
   - The GET returns `on_behalf_user` and `can.edit_on_behalf_user` (Admin and above).
   - New `PUT /settings/mrf-approval/on-behalf-user` `{user_id}`, with `requireAdmin`, in `settings.routes.js` and the controller.
7. **Settings UI:**
   - Replace the read-only tags at `:208-223` with one `Select showSearch optionFilterProp="label"` plus Save. Copy the pattern in `frontend/src/pages/AdminDashboard.jsx:1232-1237`.
   - It is disabled unless `can.edit_on_behalf_user`. Its help text: "This person can approve, reject or hold an MRF for the approvers."
   - Hide the "Approver absence" section (`:226-259`). The stored key stays. The away email no longer has a trigger, because the PUT is no longer reachable from the UI.
   - Update the page copy at `:5-9, 181, 257`.
8. **Panel:** `lockedReason` handles `no_designee` and `not_designated`. Drop the `no_absence_window` wording.
9. **Docs:**
   - `docs/system/05-CONFIGURATION.md`: the new key. In the `MRF_DELEGATE_DECISION_ENABLED` row, replace "while an Admin marks them away" with "the person chosen in Settings".
   - `docs/phase3/MRF/MRF-Hold-and-Delegate-Approval-Plan.md` §16.4 (`:608-617`): drop step 6 (Chhaya's role move) and add "an Admin sets the designee in Settings".
   - Changelog `docs/changelog/CHANGES-2026-11-12-U06b-on-behalf-designee.md`, plus a line in `frontend/UI-CHANGELOG.md`.

## Tests
- **Unit:** rewrite `backend/src/tests/unit/mrfHoldRules.test.js:146-177` to cover:
  - the designee passes
  - another Admin fails with `not_designated`
  - no designee fails with `no_designee`
  - an inactive designee fails
  - the result is the same with or without an away window
- **Unit:** `roles.test.js` is unchanged; `canDecideOnBehalf` stays for holds. Run it anyway.
- **Other checks:**
  - the full unit suite once
  - `cd frontend && npm run build`
- **Staging:** set the designee to a test user. Make a ZZ-TEST MRF with `hold-fixture.mjs create` (never MRF 137) and decide on it as that user. Then close the fixture.
  - The decision emails the approvers. Staging email goes only to Harish, Pankaj and n8nPankaj, so check the roster first.

## Handoff
**Status (12 Nov):** built and tested on staging. No DDL. Changelog `docs/changelog/CHANGES-2026-11-12-U06b-on-behalf-designee.md`.
- **New helpers** (`utils/mrfApprovalRules.js`):
  - `parseOnBehalfUser(raw)`, `isDesignee(user, designee)`, `mayManageHolds(user, designee)`.
  - `canDecideAsDelegate({ user, designee })` returns the reasons `no_designee`, `designee_inactive`, `not_designated` or `inactive_user`. `designee_inactive` is extra to the brief, so an inactive person isn't reported as "only X can decide".
  - `delegateRefusalMessage(reason, { designeeName })`.
- **Settings service:** `getOnBehalfUser()` returns `{userId, name, email, role, roleLabel, isActive, setByName, setAt}` or null. `saveOnBehalfUser(userId|null, actor)` returns `{ok, designee}` or `{ok:false, error}`, and null clears the person. `listOnBehalfUsers` now lists all active staff, sorted by name.
- **API:**
  - `PUT /settings/mrf-approval/on-behalf-user` `{user_id}` (requireAdmin plus a controller check).
  - The GET adds `on_behalf_user` and `can.edit_on_behalf_user`. `can.manage_held` now includes the designee.
  - The trail's `on_behalf` swaps `absence` for `designee {name, role_label, active}`. `visible` = the designee or Admin+. Audit meta stores `designee {userId, name}`.
- **UI:** a picker with Save in Settings (allowClear = nobody). The absence section is removed, and the absence PUT/route is kept. The panel's lock reasons are reworded and the away banner is removed.
- **Docs:** `05-CONFIGURATION.md` (new key; flag row now says production on 16 Nov) and plan §16.4 steps 6 and 8.
- **Tests:**
  - `mrfHoldRules.test.js` 29/29 and `roles.test.js` 13/13.
  - The full unit suite passes 1206/1206 and the frontend build passes.
  - No browser check was done; F6 re-captures these screens.
- **Staging** (scratch script, not in the repo), fixture MRF 960, now rejected and closed:
  - No designee: locked, `no_designee`. A bad user id is refused.
  - Chhaya's PUT returns 403. The superadmin's PUT set user 2 `admin`.
  - The designee can decide. Superadmin Harish sees the panel locked ("Only Admin Supers…") and gets a 403 on decide. Chhaya doesn't see the panel.
  - The designee's reject sent: the outcome to n8nPankaj and Harish, the notice to both N16 `.invalid` approvers, and the confirmation to n8nPankaj.
  - The designee was then cleared: the `mrf_on_behalf_user` row exists with `userId: null`.
- **For R16:** nobody is set on staging or production. Before Chhaya's UAT on 13 Nov, an Admin must pick the person in Settings, or the panel stays locked for everyone. MRF 828 was not touched (F6 uses it).
