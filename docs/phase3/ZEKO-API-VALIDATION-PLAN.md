# Zeko API Capability R&D

**Question:** Does the Zeko API actually expose cheat probability, full test report, and
interview recording (score is already known present)? The whole M3b design
(auto-advance + cheat-probability gate + report/recording in Tracker) assumes yes, and
that assumption has never been checked.

**Constraint:** no one can hand over the Zeko login for interactive exploration.

## The alternate approach

We don't need interactive login access. Phase 2.1's live integration
([`backend/src/services/zeko.service.js`](../../backend/src/services/zeko.service.js))
already authenticates with Zeko programmatically and the credentials are already checked
into `backend/.env` / `.env.staging` / `.env.production`:

- `ensureZekoToken()` — bearer API-key grant (`ZEKO_CLIENT_ID` + `ZEKO_API_KEY`), no OTP.
- `refreshZekoCookie()` — OTP-login cookie for the `/dashboard` domain, OTP auto-read from
  the mailbox via the existing Graph reader. Also no human needed.

The existing `fetchInterviewResults()` job (same file, ~L439–542) already calls
`GET {scheduleApiBase}/interview/{pipeline_id}/results` for every completed interview and
gets a real response back — it just extracts `overallScore`, `technicalScore`,
`communicationScore`, and `reportLink`, and **discards the rest of the payload**. The
fastest, most authoritative way to answer the question is to look at what Zeko is already
sending us today and throwing away, by reusing this exact same already-authorized call.

Confirmed OK to make read-only calls to Zeko's live API this way. Target staging
(`backend/.env` → `recruitmentautomationdb`) first; production
(`.env.production` → `recruitmentautomationdbProd`) only if staging turns out to have no
completed interviews yet (Phase 2.1 only went live 2026-07-14).

## The solution: `backend/scripts/zeko-rnd-probe.js` (new, one-off script)

- Queries `rpa_zeko_candidate_pipeline` for rows with `status = 'completed'` — real
  `pipeline_id` / `zeko_job_id` pairs that already got a genuine Zeko result once.
- For a small sample (~5–10 rows), reuses `ensureZekoToken()` and calls
  `GET {scheduleApiBase}/interview/{pipeline_id}/results` — the exact call
  `fetchInterviewResults()` already makes — but writes the **entire raw response body**
  to disk instead of extracting 3 fields.
- Also probes 2–3 plausible sibling paths on the same bearer-auth domain (e.g.
  `/interview/{id}`, `/interview/{id}/report`, `/interview/{id}/proctoring`), recording
  whatever comes back — 200 + body, or the exact error status.
- If the report/recording data isn't in those responses, extends the probe to the
  OTP-cookie `/dashboard` domain via `refreshZekoCookie()` and tries likely dashboard-side
  interview-detail endpoints.
- Output: one JSON file per pipeline_id/endpoint, written to a local scratch directory —
  **not committed** (responses will contain real candidate PII).
- Side effects: none beyond `ensureZekoToken()`'s normal token-cache upsert into
  `rpa_zeko_auth_token`. No writes to Zeko, no other DB mutations.

## Verification

- Run `node backend/scripts/zeko-rnd-probe.js` from `backend/` against staging; confirm it
  connects, finds completed pipeline rows, and writes raw JSON without throwing.
- Manually review the saved JSON for: cheat-probability/proctoring signal, full report
  content, recording URL.

## Status

**Not yet executed.** Plan only — script has not been written or run yet.
