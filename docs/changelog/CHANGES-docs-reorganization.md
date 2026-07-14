# Docs Reorganization — Session Log

Date: 2026-07-14

Scope: restructuring `docs/` into role-based subfolders (no content deleted or
rewritten) so the 34 markdown files are easier to navigate as the doc set has
grown past 30 files.

---

## 1. What changed

New folders under `docs/`:

| Folder | Contents |
|---|---|
| `docs/reference/` | Living architecture/how-it-works docs: `ADMIN_ACCESS_CONTROL.md`, `ADMIN_PORTAL.md`, `BACKEND.md`, `DEPENDENCIES.md`, `Email-Templates-Summary.md`, `FRONTEND.md`, `HR_MANUAL_UPLOAD.md`, `MODULES.md`, `RESUME_UPLOAD_ENHANCEMENTS.md`, `ROLE_RULES.md`, `VENDOR_PROCESS.md`, `c2c_vendor_plan.md`, `screening.md` |
| `docs/changelog/` | Dated session worklogs: all `CHANGES-*.md` files plus `UI_FIXES.md` |
| `docs/deployment/` | `V16-CHANGES-AND-DEPLOYMENT.md` |

Left unchanged: `docs/CHANGELOG.md` (stays at root as the master index),
`docs/phase3/`, `docs/proposals/`, `docs/test-plans/` (already well-organized),
and `frontend/UI-CHANGELOG.md` (intentionally colocated with frontend code).

Files were moved with `git mv` where already tracked, so history/blame is
preserved; a handful of same-session untracked files (the `CHANGES-outlook-*`
and `CHANGES-phase3-*` docs) were plain-moved since they had no history yet.

## 2. Why this grouping and not others

Considered moving files to an `Unwanted/` folder first, but every candidate
for removal turned out to still be load-bearing on inspection:
- `docs/UI_FIXES.md` vs `frontend/UI-CHANGELOG.md` — kept both; they're
  treated as serving distinct purposes.
- `docs/proposals/outlook-integration-improvements.md` — kept in place even
  though marked "mostly implemented"; still a useful record of the original proposal.
- `docs/c2c_vendor_plan.md` — kept; the placement-vendor workflow it documents
  is still important, not a stale draft.

So this pass is pure information architecture — grouping by role
(reference / changelog / deployment) rather than pruning.

## 3. Link fixes required by the move

Moving files one directory deeper broke their relative links. Fixed:

- **Markdown cross-links** (`[text](./foo.md)` style) between moved files and
  from `docs/CHANGELOG.md` / `docs/deployment/V16-CHANGES-AND-DEPLOYMENT.md`
  pointing at them — updated `../` depth to match the new location.
- **Source-code links** inside `docs/reference/*.md` (e.g.
  `[screening.service.js](../backend/...)`) — all `](../backend/` and
  `](../frontend/` links became `](../../backend/` / `](../../frontend/`
  since `docs/reference/` sits one level deeper than `docs/` did.
- **`docs/changelog/CHANGES-phase3-planning.md` / `CHANGES-phase3-rt-answers.md`**
  — links to `phase3/*.md` (a sibling of the old `docs/CHANGES-*.md` location)
  became `../phase3/*.md`.
- **Plain-text path mentions** (backtick-quoted paths in historical log prose,
  not clickable links) — e.g. `` `docs/BACKEND.md` `` in `docs/CHANGELOG.md`'s
  older entries, and the `docs/Email-Templates-Summary.md` comment in
  `backend/prisma/seed-email-templates.js` — updated to the new paths for
  consistency, via a repo-wide filename→new-path sed pass.

## 4. Verification performed

- Scripted check (Node, walking every `docs/*.md` + `frontend/UI-CHANGELOG.md`
  file, resolving every `[text](path.md)` link relative to its containing
  file): **0 broken links** across 74 markdown links checked.
- Separately checked all `.js`/`.jsx`/`.css`/`.prisma` relative links in the
  same files; the only failures found (`docs/reference/BACKEND.md`, 20 links)
  are pre-existing absolute `file:///E:/ATS-Migration/...` paths from a
  different machine, unrelated to this move — left untouched.
- `git status` confirmed every tracked file shows as a rename (`R`/`RM`), not
  a delete+add, so blame/history is preserved.

## 5. Not done

- Did not touch `file:///E:/ATS-Migration/...` absolute links in
  `docs/reference/BACKEND.md` — pre-existing issue, out of scope for this pass.
- No files deleted or content edited beyond link paths.
