# CHANGES — Pipeline prototype renamed to "Candidate Pipeline" (v7, frontend-only)

**Date:** 2026-07-15
**Scope:** frontend only — file rename + text/label updates. No behavior changed.

---

## Why

"Interview Pipeline Tracker" / "Pipeline Tracker" undersold the module — interviews are only 3 of its 5 stage types (Zeko, Assessment, Interviews, Docs, Offer). Checked what real ATS platforms call the equivalent feature before picking a replacement:

| Platform | Name |
|---|---|
| Ashby | "Candidate Pipeline" (exact docs page title) |
| Greenhouse | "Visual Candidate Pipeline" |
| Zoho Recruit | "Hiring Pipeline" |
| Recruitee | "Pipelines" |
| SmartRecruiters / Lever / Workday | generic "candidate pipeline" / "pipeline" |

None use "Tracker." Went with **Candidate Pipeline** — matches Ashby exactly and is what the user had already been calling it informally.

## What changed

- **File renamed:** `frontend/src/pages/PipelinePrototype.jsx` → `CandidatePipelinePrototype.jsx`.
- **Component names:** `PipelinePrototype` → `CandidatePipelinePrototype`; `PipelineAnalyticsPreview` → `CandidatePipelineAnalyticsPreview`.
- **Route:** `/pipeline-prototype` → `/candidate-pipeline-prototype` (`App.jsx`).
- **Sidebar menu item** (`MainLayout.jsx`): label "Pipeline Tracker" → "Candidate Pipeline"; key updated to match the new route.
- **Breadcrumb map** (`MainLayout.jsx`): "Interview Pipeline Tracker (Preview)" → "Candidate Pipeline (Preview)".
- **Analytics tab** (`Analytics.jsx`): "Pipeline (Preview)" → "Candidate Pipeline (Preview)"; import updated to the renamed component.
- **In-page title:** "Interview Pipeline Tracker" → "Candidate Pipeline".
- **Stale comment fixed in passing:** the file's own header comment claimed the route was "not in the sidebar menu on purpose" — it actually already was (added in an earlier session without updating this comment). Corrected while editing this block anyway.

## Not changed

- Historical changelogs (`CHANGES-pipeline-prototype-v4/v5/v6*.md`) and `docs/phase3/03-DEVELOPMENT-PLAN.md` still say "Pipeline Tracker" / "Tracker UI" — left as-is; they're dated records of past decisions, not living UI, and rewriting them would misrepresent what was actually said/built at the time.
- No functional/behavioral change — this is a naming pass only.

## Verification

`npx vite build --mode production` — succeeds, no errors. In-browser click-through still not done this session (no test credentials available) — recommend confirming the sidebar label, breadcrumb, and route all resolve correctly before the next RT walkthrough.
