# CHANGES — Pipeline Tracker Prototype v5, AI features (frontend-only)

**Date:** 2026-07-15
**Scope:** frontend only — `frontend/src/pages/PipelinePrototype.jsx`. UI-mocked; no backend AI calls were added.

---

## Why

Following up on the v4 walkthrough fixes, the question was whether AI could help across the pipeline. The brainstorm was narrowed down to five confirmed features, all framed as **assist/suggest — RT still decides**, consistent with RT's repeated preference for manual control (Hold, offer approval, no auto-escalation).

## What changed

1. **Stuck-candidate AI insight** — the "Stuck candidates" table in the pipeline analytics tab (`PipelineAnalyticsPreview`) now shows a robot-icon one-liner under each "Blocked on" tag: why it's stuck and a suggested action.
2. **Natural-language board search** — a free-text box above the board ("React developers on hold") resolves into the existing Role/Source/Hold/Stuck filters via a simple keyword parser (mocked; a real version would call an LLM), with a "Read as: …" explanation shown underneath.
3. **Evalground import — schema-free reading** — dropped the rigid "Map columns" step. This mirrors a pattern already in the codebase: `hrUpload.service.js` (lines ~1083–1100) reads bulk `.xlsx` candidate sheets by flattening each row to text and handing it to the same LLM call used for resume parsing (`parseResumeWithOpenRouter`), rather than matching fixed column headers. Applied the same idea here — "AI reads rows" step, and unmatched/malformed rows get a plain-language explanation instead of raw error text.
4. **AI interviewer prep brief** — the Schedule Interview modal can attach a brief (rolls up Zeko/Evalground scores + prior round notes into one paragraph) to the Outlook/Teams invite. On by default, previewable, toggleable via checkbox.
5. **AI feedback summary** — once interviewer feedback is submitted, an AI-drafted summary + suggested action appears next to it. RT still clicks Approve/Hold/Reject; the AI never decides.

## Not changed

- No new backend service or "agent" architecture. A real build of any of the above would reuse the existing OpenRouter/Gemini call already used for resume parsing — the plumbing already exists in this codebase.
- Rejection-reason trend summary, Zeko-transcript AI summary, document plausibility checks, and an AI "why approve" offer summary were considered and explicitly deprioritized (not required for now).
- Email wording AI-tailoring was considered and dropped — the app already has manual email-template editing (Email Templates, `EmailManagement.jsx`) for RT to control wording directly.

## Verification

`npx vite build --mode production` — succeeds, no errors. In-browser click-through was not completed this session (`/pipeline-prototype` sits behind the app's login guard and no test credentials were available) — recommend a manual pass before relying on this for the next RT walkthrough.
