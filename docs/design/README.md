# Design docs

Frontend design-system and visual-rollout documentation.

| File | What it is |
|---|---|
| [`AURORA-GLASS-ROLLOUT-PLAN.md`](./AURORA-GLASS-ROLLOUT-PLAN.md) | **Canonical source.** The app-wide plan for rolling the dashboard's Aurora Glass design system across the remaining routes. Part I is the design system reference; Part II is nine executable phases. Edit this file if the plan changes. |
| [`aurora-glass-rollout.html`](./aurora-glass-rollout.html) | The same plan as a formatted, self-contained page. No build step and no network access required — open it directly in a browser. Regenerate it from the Markdown if the plan changes; do not edit the two out of step. |

## Related, elsewhere in the repo

- `frontend/UI-CHANGELOG.md` — the running log of every UI/theme change, newest first. **Every UI change gets an
  entry.** The rollout plan supersedes the "Phases 1–6" list recorded in its 2026-08-13 Phase 0 entry.
- `frontend/src/theme/aurora-glass.css` — the design layer itself. Scoped to `.ats-v2`; one import to remove if
  the whole thing is ever rejected.
- `frontend/src/theme/index.css` — base tokens for both themes, and the source of truth for every design token.
- `frontend/src/theme/brands.js`, `frontend/src/context/BrandContext.jsx` — per-organization theming.
- `frontend/.claude/skills/verify/SKILL.md` — the verification workflow each phase's Definition of Done refers to.

## Before starting a phase

Read Part I of the plan first, in particular **the inline-style law** and **the shared-class couplings** table.
Those two sections are what determine the real effort of each phase, and both describe failure modes that
produce no error message — a nested panel that stays an opaque slab on a glass card, and a `border` shorthand
that silently erases a status colour carrying real data.
