# Changelog

Reverse-chronological log of changes. One entry per change set, listing files touched and the what/why.
Feature-level detail lives in [docs/screening.md](./screening.md).

---

## 2026-07-03 — Superadmin/Admin permission tightening + credential email routing
**Why:** Any admin could delete users and edit/reset passwords of co-admins. New rules: Delete User is
superadmin-only; an admin may edit details/passwords of **self** and of **recruiters/vendors** only (not
co-admins); a superadmin may reset passwords of admins/recruiters/vendors. Credential/password emails must
reach the affected user's own inbox even in staging (not the test-recipient redirect).

- `backend/src/config/roles.js` — new `outranks(requesterRole, targetRole)` helper (strict `ROLE_RANK`
  comparison; equal ranks do NOT outrank each other).
- `backend/src/controllers/admin.controller.js`:
  - `updateUser` (details + password reset) — target must be **self or a strictly lower role**; a
    superadmin may additionally edit a peer superadmin's **details** (but a superadmin password can only
    be changed by its owner); own role changes rejected; `is_active` ignored on self-edits (lockout
    prevention).
  - `deleteUser` — superadmin-only; self-deletion blocked server-side (was UI-only).
  - `toggleStatus` — self-toggle blocked server-side; target must be a strictly lower role (admins can no
    longer deactivate co-admins).
- `backend/src/config/emailRecipients.js` — `userCredentialUpdate` added to `NEVER_REDIRECT`: credential /
  password-change emails always resolve to the target user's own email in every environment; all other
  flows still redirect to the staging test inbox.
- `frontend/src/pages/AdminDashboard.jsx` — mirrors the rank rule: Edit enabled for self + lower roles,
  Toggle for lower roles only, Delete for superadmins only, with explanatory tooltips; Role and Account
  Status fields disabled when editing your own account. Deactivate confirmation restyled as a warning
  (⚠️ title, amber consequence box, danger-styled "Deactivate" button); activation keeps the positive style.
- `docs/ADMIN_ACCESS_CONTROL.md` — rules, capability matrix, and endpoint table updated.
- `docs/ROLE_RULES.md` (new) — per-role can/cannot reference (Super Admin / Company Admin / Recruiter /
  Vendor) incl. universal rules and a quick-reference matrix.

## 2026-06-30 — Candidate card enterprise refinement (pass 2)
**Why:** Score block read too big; user wanted more enterprise polish but to keep the SKILLS tags multicolor.

- `frontend/src/theme/index.css` — shrank `.cand-score*` (smaller value/stars/verdict, tighter box); added a
  left fit-accent rail (`.cand-card::before` driven by `--cand-accent`) and a `.cand-divider` hairline.
- `frontend/src/pages/CandidateScreening.jsx` — `scoreTierColor(stars)` helper sets `--cand-accent` per card
  (green/gold/amber/neutral by star tier); `renderStars(count, size)` now takes a size (11px in the scorecard);
  added the divider between the identity and skills/match bands. `SkillTags` (SKILLS row) left unchanged.

## 2026-06-30 — Screening UI premium refresh
**Why:** The Candidate Screening page looked cluttered/flat — every card repeated all mandatory + good-to-have
skills (incl. grey "missing" tags) with weak hierarchy. Refine the existing olive/gold brand into a calmer,
premium look. Display-only.

- `frontend/src/theme/index.css` — added scoped screening classes (light + dark): `.cand-card`, `.cand-name`,
  `.cand-company`, `.cand-avatar-ring`, `.cand-score*`, `.match-meter*`, `.skill-chip*`, `.cand-section-label`,
  `.cand-signal-hint`.
- `frontend/src/pages/CandidateScreening.jsx`:
  - `JdSkillMatch` now takes a `variant` prop. `variant="card"` = compact **match meter + present-only chips**
    (no "missing" spam); `variant="full"` (default, drawer) keeps the complete present/missing breakdown.
  - Candidate card restructured: gradient-ring avatar, `.cand-name`, qualification folded into the meta-pill row,
    a single "Skills" row, the compact match meter, and an elegant right-side `.cand-score` scorecard.
  - Summary bar decluttered: primary count + muted detail; star buckets stay as stat chips.
- `docs/screening.md` — noted the card uses the compact meter; drawer keeps the full breakdown.

## 2026-06-30 — App-load roles preload + Refresh button
**Why:** Roles/candidates re-fetched on every page visit and were lost on navigation; no manual reload.

- `backend/src/services/screening.service.js` — `searchRoleCandidates(mrfId, force)` skips the Redis read when
  `force` is true (recompute + overwrite), so Refresh returns genuinely fresh candidates.
- `backend/src/controllers/screening.controller.js` — reads `?force=1` / body flag and passes it through.
- `frontend/src/services/screeningService.js` — `searchRoleCandidates(mrfId, { force })` → `?force=1`.
- `frontend/src/hooks/useScreeningData.js` (new) — React Query hooks `useApprovedRoles()` and
  `useRoleCandidates(roleId, enabled)` (`staleTime: Infinity`; cache persists across navigation).
- `frontend/src/App.jsx` — `AppShell` prefetches roles once at app load (gated on the `candidate_screening`
  module / admin).
- `frontend/src/pages/CandidateScreening.jsx` — roles + candidates sourced from the hooks; sync effect feeds the
  existing render state; `selectedRoleId` + `activeTab` persisted in `localStorage`; Refresh button (force-bypass
  cache) by the role selector and on the keyword tab; removed the cosmetic preloading bar.

## 2026-06-30 — Client-side pagination (both tabs)
**Why:** Result lists rendered all rows at once; hard to scan.

- `frontend/src/pages/CandidateScreening.jsx` — `currentPage`/`pageSize` state, sliced render, AntD `<Pagination>`
  (10/20/50), reset to page 1 on new search / tab switch. Select-All still spans the full result set.

## 2026-06-30 — Keyword-tab searched-skill signals
**Why:** Extend JD Skill Match to the Keyword Filtering tab so searched terms are cross-referenced too.

- `backend/src/services/screening.service.js` — `searchKeywordCandidates` attaches `jdSkillSignals`
  (searched keyword/designation as the matched skills) when a term is present.
- `frontend/src/pages/CandidateScreening.jsx` — `<JdSkillMatch>` gained a `label` prop; keyword mode shows
  "Searched Skills" / "Searched Skill Match".

## 2026-06-30 — JD Skill Match (JD Filtering tab)
**Why:** Cross-reference each JD skill against the candidate's resume signals + declared skills so recruiters see
which mandatory skills are actually evidenced. Display-only (scoring unchanged).

- `backend/src/services/screening.service.js` — `buildJdSkillSignals()` (+ helpers `splitSkillPhrases`,
  `parseDeclaredSkills`, `parseTechnicalTerms`, `skillMatchesTerm`); attaches `jdSkillSignals` per candidate in
  `searchRoleCandidates`.
- `frontend/src/pages/CandidateScreening.jsx` — `JD_SKILL_STATUS` map + `<JdSkillMatch>` component on card + drawer.
- `docs/screening.md` (new, consolidated) — feature documentation.
