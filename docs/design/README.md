# Design docs

Frontend design-system and visual-rollout documentation.

| File | What it is |
|---|---|
| [`AURORA-GLASS-ROLLOUT-PLAN.md`](./AURORA-GLASS-ROLLOUT-PLAN.md) | **Canonical source for the design system** (Part I) — the inline-style law, the tier model, the shared-class couplings. Part II's nine phases are **all shipped** as of 2026-08-21, so that half is now a record of how it was done, not work to pick up. Edit Part I if the design system changes. |
| [`aurora-glass-rollout.html`](./aurora-glass-rollout.html) | The same plan as a formatted, self-contained page. No build step and no network access required — open it directly in a browser. Regenerate it from the Markdown if the plan changes; do not edit the two out of step. |
| [`SCREEN-SWEEP-PROMPT.md`](./SCREEN-SWEEP-PROMPT.md) | **The current working method.** The reusable prompt for the screen-by-screen sweep, plus the remaining screens and the standing items it has parked. Started 2026-08-31; findings and the two verification traps are in [`CHANGES-2026-08-31-screen-design-sweep.md`](../changelog/CHANGES-2026-08-31-screen-design-sweep.md). Note it supersedes the "read this first" framing of the parity plan below, **two of whose claims are disproved** — see the corrections in that write-up. |
| [`DESIGN-LAB-PARITY-PLAN.md`](./DESIGN-LAB-PARITY-PLAN.md) | **Open work.** Design System V3 is fully rolled out and every token matches `/design-lab` exactly — but the app still reads about 60% like the lab, because the gap is **composition, not tokens**: 9 of 12 routes have no page header, and no route wraps its content in an outer page pane. Measured, with the pilot route and the non-goals named. Read this before "fixing the design" anywhere. |

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
