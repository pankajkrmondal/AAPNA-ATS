# Pipeline Prototype v7 — Rename to "Candidate Pipeline"

Scope: pure rename pass across the frontend-only Phase 3 walkthrough
prototype (mock data, no backend) after v5 (AI features) and v6
(invite/outcome/decision + editable outcome emails). No behavior changed —
every rename below is file/symbol/route/label only.

## Renames

| What | Before | After |
|---|---|---|
| File | `frontend/src/pages/PipelinePrototype.jsx` | `frontend/src/pages/CandidatePipelinePrototype.jsx` (via `git mv`, history preserved) |
| Default component | `PipelinePrototype` | `CandidatePipelinePrototype` |
| Analytics-tab component | `PipelineAnalyticsPreview` | `CandidatePipelineAnalyticsPreview` |
| Route (`App.jsx`) | `/pipeline-prototype` | `/candidate-pipeline-prototype` |
| Sidebar key + label (`MainLayout.jsx`, `SIDEBAR_ITEMS`) | `/pipeline-prototype` · "Pipeline Tracker" | `/candidate-pipeline-prototype` · "Candidate Pipeline" |
| Breadcrumb (`MainLayout.jsx`, `BREADCRUMB_MAP`) | `pipeline-prototype` → "Interview Pipeline Tracker (Preview)" | `candidate-pipeline-prototype` → "Candidate Pipeline (Preview)" |
| Analytics tab (`Analytics.jsx`) | Tab label "Pipeline (Preview)"; `import { PipelineAnalyticsPreview } from './PipelinePrototype'` | Tab label "Candidate Pipeline (Preview)"; `import { CandidatePipelineAnalyticsPreview } from './CandidatePipelinePrototype'` |
| In-page title | `<Title>Interview Pipeline Tracker</Title>` | `<Title>Candidate Pipeline</Title>` |

## Files touched

- `frontend/src/pages/CandidatePipelinePrototype.jsx` (renamed; header doc-comment,
  default export name, `CandidatePipelineAnalyticsPreview` export name, in-page
  `<Title>` all updated)
- `frontend/src/App.jsx` — import + route path
- `frontend/src/layouts/MainLayout.jsx` — sidebar item key/label, breadcrumb map entry
- `frontend/src/pages/Analytics.jsx` — import path, tab label

Verified no stray references remain:
`grep -rn "PipelinePrototype\|PipelineAnalyticsPreview\|pipeline-prototype" frontend/src`
returns only the new `CandidatePipeline*` / `candidate-pipeline-prototype` names.

## Stale comment corrected

The file's header comment previously read *"Route: /pipeline-prototype (not
in the sidebar menu on purpose)"* — no longer true; the page has had a
sidebar entry since RT started reviewing it. Corrected to describe the
actual route + sidebar label instead of the outdated "deliberately hidden"
claim.

## Not changed

Everything from v5 (AI insight, NL search, schema-free Evalground import, AI
prep brief, AI feedback summary) and v6 (decision modal with editable
Subject/Body email, template tags, close-candidate confirm modal) carries
over unchanged — this pass only touches names, paths, and labels.
