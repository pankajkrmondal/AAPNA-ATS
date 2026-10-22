# Phase 2.1 — Screening Reject, Tag-to-JD, Unbounded Matching, Dashboard Clarity

All five phase 2.1 change requests are implemented. Summary:

1. **Reject + editable email preview** — New `DecisionEmailModal` (reused by both actions) opens instead of firing immediately; shows the real `rpa_email_templates` row, editable subject/body, and a mandatory reason picker for Reject. Backend: `POST /api/screening/reject` (new `rejectCandidates()`, mirrors the shortlist flow) plus `shortlistCandidates()` now accepts `sendEmail`/`emailOverride`.

2. **Tag to Open JD** — Mandatory role picker in the modal when shortlisting from the Keyword tab (reuses the existing approved-roles dropdown data), replacing the old hardcoded `mrf_id: 0` / "Manual Screening" so the email names the real role.

3. **Show all matching candidates** — Removed the `LIMIT 50` caps; Cohere reranking now covers the full pool (batched if needed). On a Cohere failure, it alerts your dev/ops inbox by email and gracefully falls back to a bounded ~250-candidate list with a UI warning, instead of erroring or silently truncating.

4. **Send-email checkbox** — Built into the same modal for both Shortlist and Reject.

5. **Dashboard clarity** — Added scope captions to Hiring Trends / Talent Insights (they're based on the 200 most-recent candidates, not the full DB — a real gap found while reviewing), a discoverability icon on the KPI tooltips that already existed, and clearer per-row explanations on the Action Center. Per direction, the Phase-3 preview pages were left untouched.

**Extra, from a mid-turn note**: rejected candidates are now excluded from that role's future JD search results (backend `NOT EXISTS` filter) and disappear from the current list immediately after rejecting.

**Verification**: all modified backend files pass syntax + full module-import checks (new exports confirmed present); frontend builds cleanly via `npm run build`. Live-hit a subset of the changed endpoints (`GET /api/screening/roles`, `GET /api/email/templates`, `POST /api/screening/roles/:id/search`) against the running dev backend using a self-issued debug session — all returned 200 with correct payloads (including the new `degraded`/`degradedReason` summary fields and the rejected-candidate exclusion filter). Bulk shortlist/reject and the Cohere-failure fallback path were not exercised live.
