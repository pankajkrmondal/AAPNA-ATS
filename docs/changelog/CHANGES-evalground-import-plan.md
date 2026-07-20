# Evalground Import Plan — Session Log

Scope: closes the two open Evalground-import items from `docs/phase3/04-QUESTIONS.md`
(Action Items #1 and #3) with a new planning doc and updates to three existing
Phase 3 planning docs. No code changed — this is the M2 design/planning pass
that precedes the actual build (`backend/src/services/assessmentImport.service.js`
etc. are not written yet).

## New: `docs/phase3/07-EVALGROUND-IMPORT-PLAN.md`

Full write-up covering:
1. **Format verification** of the two sample files shared 2026-07-14 (bulk
   CSV from Naveen, single-result Outlook report from Chhaya) against the
   Section 1/2/3 design RT agreed to on the call.
2. **Mapping decision** — section→skill mapping is **AI-suggested from the
   test title text**, confirmed by RT **once per import batch** (per
   distinct test-name cluster found in that batch), never per row. Closes
   the "bulk mapping approach not yet decided" item and removes the need
   for a separate per-row prompt on the single-candidate path.
3. **Ingestion redesign** — the single-result "Outlook mechanism" turns out
   to be Evalground's own transactional email landing in the shared
   mailbox the ATS already polls (`backend/src/services/outlookReader.service.js`).
   Redesigned from a planned manual upload/entry screen to **automatic
   ingestion**: a new fan-out processor (`assessmentResultIntake.js`) added
   to the existing `mailboxPoller.js` Graph delta poll tick, alongside the
   two processors already there (resume intake, inbound sync).
4. **Schema-free row reading** for both mechanisms, mirroring the "AI reads
   rows" pattern already in `hrUpload.service.js` (~lines 1083–1100) and
   already previewed in the Pipeline Prototype's v5 pass.
5. **New tables**: `rpa_assessment_imports` (import/message metadata,
   `mechanism` + `source_message_id` for mailbox idempotency) and
   `rpa_assessment_results` (per-candidate-per-test-cycle result rows,
   including the confirmed section-label mapping applied to each row) —
   replacing the vaguer single-table placeholder in the original M2 sketch.
6. **M2 build plan** — backend services/endpoints, the frontend importer
   flow (mapping-cluster review → confirm → validation → commit), and a
   verification checklist.

## Updated: `docs/phase3/04-QUESTIONS.md`

- **Q1** — added a 2026-07-20 update block recording the verification
  findings and the two decisions, linking to doc 07.
- **Action Items table (§C)** — items **#1** (sample-file verification) and
  **#3** (bulk mapping approach) marked closed, both pointing at doc 07.
- **Answer sheet** — Q1 row extended with the 2026-07-20 closure line.
- Companion-docs line updated to include doc 07.

## Updated: `docs/phase3/05-TASK-LIST-ETA.md`

- **Track A, A2 and A3** marked done (2026-07-20, ahead of their original
  2026-07-15/16 target dates), both linking to doc 07.
- **Track B, M2 row** — scope description updated ("automatic shared-mailbox
  polling, not manual upload"); notes column now points at doc 07 and the
  `mailboxPoller.js` integration instead of "needs A2/A3 closed first."
- Companion-docs line updated to include doc 07.

## Updated: `docs/phase3/03-DEVELOPMENT-PLAN.md`

- **§0 module roadmap table, M2 row** — gate status changed from "sample
  files received, verification owed" to "fully unblocked," linking to doc 07.
- **§M2 section body** — rewritten as a condensed pointer to doc 07 rather
  than duplicating the mechanics; kept a short summary inline (mechanisms,
  mapping rule, retake rule, pass mark, UI placement) plus an updated build
  list (new tables, `assessmentImport.service.js`, `assessmentResultIntake.js`
  job wired into `mailboxPoller.js`).
- **"Key existing assets" table** — added two rows: the shared-mailbox Graph
  delta poll/fan-out (`outlookReader.service.js` + `jobs/mailboxPoller.js`)
  and the schema-free row-reading pattern (`hrUpload.service.js`), both now
  reused by M2.
- Companion-docs line updated to include doc 07.
