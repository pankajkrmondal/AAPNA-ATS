# CHANGES — Evalground Import: Format Verification, Mapping Decision & M2 Build Plan

**Date:** 2026-07-15
**Scope:** documentation/planning only — no code, schema, or config changed.

---

## What was done

Two real Evalground sample files landed in `docs/phase3/EvalGround Report & Bulk Upload/` (bulk CSV export from Naveen, single-candidate Outlook result report from Chhaya) — the trigger for **Task A2** (format verification, owed by Harish, due 2026-07-15) and **Task A3** (bulk-CSV section→skill mapping decision, owed by Harish, due 2026-07-16), both tracked in `05-TASK-LIST-ETA.md`.

This session:

1. Inspected both real sample files directly (229-row CSV parsed with PowerShell `Import-Csv`; the `.htm` single-result report read as raw MHTML).
2. Cross-referenced findings against the existing Phase 3 requirements docs (`01`–`04`) via three parallel research passes: existing reusable backend patterns (`hrUpload.service.js`, `zeko.service.js`, `outlookReader.service.js`), the exact wording already committed in docs 01–06, and the Evalground mock UI already sketched in `CandidatePipelinePrototype.jsx`.
3. Proposed a section→skill mapping rule; the user rejected a manual-tagging version as too much RT effort and asked for an AI-suggested/RT-confirmed approach instead, with per-candidate correction — reshaped the design accordingly.
4. Clarified the single-result ingestion mechanism with the user: the sample was sent to an individual's personal inbox, but production traffic is expected to route through the shared mailbox the ATS already polls — redesigned that path as automatic polling (reusing `outlookReader.service.js`) instead of manual upload.
5. Wrote up the full decision + build plan as a new numbered doc, **[phase3/07-EVALGROUND-IMPORT-PLAN.md](../phase3/07-EVALGROUND-IMPORT-PLAN.md)**.
6. Closed Task A2 and A3 in `05-TASK-LIST-ETA.md`, updated `04-QUESTIONS.md` Q1 and the Action Items table, and updated `03-DEVELOPMENT-PLAN.md`'s M2 gate status and build section — all now point at doc 07 instead of repeating "owed by Harish."

## Key findings (Task A2 — format verification)

- Bulk CSV confirms the existing Section 1/2/3 / email-key assumptions.
- **New, not previously scoped:** 6 extra Evalground skill-tag columns (`Sql, Coding, Python, Py Test, Playwright, Pywinauto`) on every row — `Sql`/`Coding` read 0/N/A on all 229 rows of a SQL-titled test, so they're a fixed global catalog, not a reliable per-test signal on their own.
- 6 of 229 rows have a blank candidate email (malformed, unmatchable); 5 rows have `Result=NA` (abandoned/restarted attempt, distinct from a scored Fail); per-section `Result` sub-columns are blank on every row; `Previous Assessments` is `N/A` on all rows (retake semantics untested against real data).
- The single-result file is Word/MHTML, not plain HTML — structurally simple underneath, but its Report/Resume links are double-wrapped in Outlook Safe Links and not reliably resolvable server-side.

## Key decision (Task A3 — section→skill mapping)

Rejected: RT manually tagging every section by hand. Adopted: an AI step reads the test title (which already names the topics in section order — e.g. "General Aptitude, Python, SQL") to suggest a section→skill label and an Aptitude/Technical rollup bucket, cross-checked against the candidate's own skills and Evalground's own skill-tag columns as a corroboration signal (never a gate). RT confirms **once per import batch**, not per row, with a per-candidate correction option afterward. The score rollup itself is generic — section max marks are derived fresh from each file, never hardcoded — so it isn't tied to this one sample's 3-section structure. Full reasoning and the data model in doc 07 §2–§3.

## Files changed

- **New:** `docs/phase3/07-EVALGROUND-IMPORT-PLAN.md` — full format-verification write-up, mapping decision, data model, backend/frontend build plan, and verification plan.
- `docs/phase3/04-QUESTIONS.md` — Q1 update block, Action Items table (items 1 and 3 closed), answer sheet row.
- `docs/phase3/05-TASK-LIST-ETA.md` — A2/A3 marked done; M2 row note updated.
- `docs/phase3/03-DEVELOPMENT-PLAN.md` — M2 gate-status row and the M2 build section both rewritten to point at doc 07.

## Still open

- The mapping rule (doc 07 §2) is validated against **one** sample test template only — needs rechecking against a non-IT test (GA + English, per Q1) and a pure role-specific test once more real Evalground exports are available.
- Whether the shared-mailbox redirect for single-result reports is live yet is unconfirmed — the poller design (doc 07 §4) is gated behind `EVALGROUND_INTAKE_ENABLED`, off by default, so it can ship before that redirect exists.
- M2 build itself has not started — scheduled 2026-07-31 → 2026-08-06 per `05-TASK-LIST-ETA.md`, after M1 ships (M1's Tracker UI is where M2's import UI lives).

## Status

Documentation/planning only. No code was written this session — doc 07 is the build plan for the M2 development window.
