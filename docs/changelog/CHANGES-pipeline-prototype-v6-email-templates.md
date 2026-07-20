# CHANGES — Pipeline Tracker Prototype v6, invite/outcome/decision + editable outcome emails (frontend-only)

**Date:** 2026-07-15
**Scope:** frontend only — `frontend/src/pages/PipelinePrototype.jsx`. No backend, schema, or Email Templates data changed.

---

## Why

Requirement: every round modal should contain three things — invite sent (Zeko/interviews/etc.), outcome (from Zeko/interviews/etc.), and a decision for the next round. The decision step should show the outcome email template up front so RT can edit it before sending if needed (a default template is loaded automatically for the common case — "auto approves").

Applied to **all** stages, including Docs and Offer (confirmed scope), and grounded in the real, already-live Email Templates feature rather than inventing new template names — queried the live `rpa_email_templates` table directly before building.

## What changed

1. **Zeko / Assessment / Interview / Docs rounds** — these already had an invite-sent step (Assign/Schedule Zeko, Send assessment invite, Schedule interview, Send document request) and an outcome-received step (scores, feedback, checklist), added in earlier sessions. What's new: clicking **Approve / Hold / Reject** now opens the decision modal with a real, **editable** outcome email already loaded — Subject + Body fields, not just a "an email will be sent" notice.
2. **Default templates are real, where they exist** — checked the live `rpa_email_templates` table directly:
   - Hold → **"Application On Hold"** (id 18)
   - Reject → **"Rejection — Post Interview"** (id 4)
   These names are shown as a tag on the decision modal so RT knows which saved template it's drawing from. Editing here only changes that one send — editing the template itself still happens in Email Templates.
3. **Gap found and flagged, not papered over** — there is **no template today for "approved / cleared this round, moving to next stage."** Every stage has a reject/hold template (and interview-invite / Zeko-invite / offer templates), but nothing for the everyday "you cleared this round" case. Rather than silently invent one or misuse an unrelated template, the Approved outcome shows an editable draft tagged **"Draft — no template yet"** with a tooltip pointing at the gap — this should be a real template added in Email Templates before Module 1 ships.
4. **Offer stage — "Close candidate record"** — previously fired instantly. Now opens a confirm modal with the same editable-email pattern (also tagged "Draft — no template yet," since no closure template exists either), before actually closing the record.

## Not changed

- Docs' per-document actions (verify/reject an individual upload) stay as quick actions without a template preview — those aren't the "decision for next round," they're mid-round housekeeping. The round-level Approve/Hold/Reject at the bottom (which *is* the decision) is covered.
- No new Email Templates rows were created in the database — the gaps are flagged in the UI, not fixed at the data layer, since that's a real product decision outside frontend scope.
- Reminder cadence, Zeko status vocabulary, AI features (v5), and all earlier RT-confirmed decisions are untouched.

## Verification

`npx vite build --mode production` — succeeds, no errors. In-browser click-through was not completed this session (`/pipeline-prototype` sits behind the app's login guard and no test credentials were available) — recommend a manual pass, especially: Approve/Hold/Reject on a Zeko and an interview round, and the Offer stage's Close candidate record flow.
