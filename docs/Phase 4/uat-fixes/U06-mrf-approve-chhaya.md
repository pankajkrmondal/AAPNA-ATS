# U06 · MRF approve option for Chhaya
**Release 1 · Medium · 2 h (mostly configuration and a demo) · Depends on: none**

**Goal**
- **Today:** Chhaya can't see an Approve option on staging.
- **Change:** check her role and the approver roster, demo both ways of approving, and decide the production "Decide on behalf" flag.
- **Done when:** Chhaya approves, or decides on behalf, for a test MRF on staging.

## How it works today (verified)
**Approve from the email link**
- Only people in the `mrf_approvers` roster get personal links. The roster is an `rpa_settings` row with no settings screen (`backend/src/services/mrfApproval.service.js:89-98`; links issued at `:121-156`).
- The page is `frontend/src/pages/MrfApprovalAction.jsx`, which needs `?token=`.

**Decide on behalf in the ATS.** All of these must be true:
1. **Flags:** `MRF_DELEGATE_DECISION_ENABLED=true` and `MRF_APPROVAL_AUDIT_ENABLED=true` (`backend/src/config/index.js:619, 653`; checked at `mrfApproval.service.js:658-663, 1221`). Hold also needs `MRF_HOLD_ENABLED`.
2. **Role:** `hr_admin_recruiter`, `admin` or `superadmin` (`backend/src/config/roles.js:153-155`). Plain `recruiter` or `hr` is refused.
3. **Active account:** `is_active` (`backend/src/utils/mrfApprovalRules.js:490`).
4. **Absence window:** the approver's window must cover today, IST, both ends included (`mrfApprovalRules.js:477-493`; stored via `backend/src/services/mrfHoldSettings.service.js:48-51`).
   - **Only an Admin or Super Admin can open one** (`backend/src/controllers/mrfHoldSettings.controller.js:106-109`).
5. **MRF status:** `pending` or `waiting`.
6. **Screen conditions:**
   - the `new_mrf` module toggle is on for her (`frontend/src/App.jsx:379`)
   - the Hiring Manager has submitted (`frontend/src/pages/MRF.jsx:1047`)
   - the panel shows when `on_behalf.visible` and is clickable only when `can_decide` (`frontend/src/components/mrf/ApprovalTrail.jsx:226`, `frontend/src/components/mrf/DecideOnBehalfPanel.jsx:42, 68-77`)

**State per environment:** `docs/phase3/MRF/MRF-Hold-and-Delegate-Approval-Plan.md:553-617`.
- Staging has the flags on and Chhaya (`chhaya.verma598`) as HR Admin Recruiter, but **no absence window is open**.
- Production has the flags off, and her role move and the DDL are still pending.

## Steps
1. On staging, confirm her role, the `new_mrf` module and the three flags. The backend env lives on the server, not in the repo.
2. Demo **decide on behalf**: as Admin, mark an approver as away in the MRF Hold settings. Chhaya then opens a pending test MRF, goes to Approval trail and chooses Decide on behalf.
3. Demo the **approver link**: only if Sanghamitra wants Chhaya as a standing approver, add her to the `mrf_approvers` roster.
4. **Small code change:** the locked-panel reason in `DecideOnBehalfPanel.jsx:68-77` says who can unlock it: "Ask an Admin to mark <approver> as away".
5. Add `MRF_HOLD_ENABLED`, `MRF_DELEGATE_DECISION_ENABLED` and `MRF_APPROVAL_AUDIT_ENABLED` to `docs/system/05-CONFIGURATION.md`; they are missing there today.
6. Write down the production decision (DDL, role move, flags) for the R1 release chat.

## Tests
- `cd frontend && npm run build`
- `node --test src/tests/mrfApprovalRules.test.js`
- A manual demo on staging.

## Handoff
**Status (10 Nov):** code and docs built. The staging demo and the HR decision are still open.
- **Cause, from the staging DB (read only):** Chhaya (id 15) is an active `hr_admin_recruiter` with `new_mrf` on, and both flags are on in the local `.env.staging` copy. `mrf_approver_absence` is **off** (last open 22–25 Oct), so the panel is locked. The `mrf_approvers` roster holds only the N16 test entries, so she gets no link. Open test MRFs include 861, 828 and 761 (pending).
- **Changed:**
  - `frontend/src/components/mrf/DecideOnBehalfPanel.jsx`: new local `lockedReason(onBehalf, role)`. For `no_absence_window` it says whom to ask, or tells an Admin to do it. It uses `useAuth`.
  - `docs/system/05-CONFIGURATION.md`: the two hold flags, the hold and absence settings keys, and a production-flags row.
  - Changelog `docs/changelog/CHANGES-2026-11-10-U06-mrf-approve-chhaya.md` and a line in `UI-CHANGELOG.md`.
  - Backend and API messages are unchanged.
- **Brief correction:** there is one absence window for **both** approvers, not one per approver. So the panel says "the approvers", not a name.
- **Tests:** `mrfApprovalRules.test.js` 15/15, the frontend build passes, and the full unit suite passes 1111/1111. No browser check was done.
- **Still to do by hand (staging):**
  1. As `pankaj`, open the window in Settings › MRF Approval & Hold, covering today. This **emails** the approvers and every HR Admin Recruiter (Chhaya, plus `admin` → n8npankajmondal@gmail.com).
  2. Chhaya opens a pending ZZ-TEST MRF (make one with `hold-fixture.mjs create`; never MRF 137) › Approval trail › Decide on behalf.
  3. Switch the window **off** afterwards and close the fixture.
- **Production decision for R1 (recommended, needs Sanghamitra's OK):**
  - Decide on behalf only; don't add Chhaya to `mrf_approvers`.
  - Follow plan §16.4: DDL `2026-10-22-mrf-hold-and-delegate.sql` (dry run first), `prisma generate`, deploy with the flags off, seed the templates, move Chhaya to HR Admin Recruiter, then turn on `MRF_HOLD_ENABLED` and then `MRF_DELEGATE_DECISION_ENABLED`.
  - The local `.env.production` copy has both set to `false`.
