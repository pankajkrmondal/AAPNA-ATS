-- ============================================================================
-- Phase 3 — the Evalground import keeps the WHOLE row, not just three scores
-- Manual DDL — apply then: cd backend && npm run prisma:pull && npm run prisma:generate
-- Idempotent, additive, non-destructive. No existing column or row is touched.
--
-- WHY: Evalground has no API and produces no per-candidate report file. What HR
-- can export is one workbook per TEST with one ROW per candidate — 47 columns,
-- byte-identical across every sample export we hold (2025 and 2026, CSV and
-- XLSX). The import reads that file today and keeps SEVEN of those columns:
-- three section scores, the percentage, the marks, the vendor's verdict and the
-- matched email. Everything else — correct/wrong/unattempted per section, the
-- easy/medium/hard split, the totals, the time taken, the attempt date and the
-- test's own topic columns — is parsed and thrown away.
--
-- The candidate dossier is where that hurts: it could show an interviewer three
-- numbers and a percentage, and the pack had to say so ("the original report is
-- not yet stored in the ATS"). These columns are what section 7 of the pack
-- renders instead. See docs/phase3/ASSESSMENT-REPORT-UPLOAD-PLAN.md §3.
--
-- WHY BOTH raw_row AND TYPED COLUMNS: the typed columns are what the renderers
-- read, so nothing has to guess at a schema while building a file for someone
-- outside the company. raw_row is the archive — a column Evalground adds next
-- year is still recoverable without re-reading the source file out of OneDrive,
-- and it costs a few KB per candidate. The dossier must never render raw_row;
-- utils/dossierRedaction.js asserts that it cannot.
--
-- NULL IS EXPECTED. Every result imported before this ships has NULL here, and
-- that is a supported state, not a broken row: the pack tells the reader the
-- breakdown was captured only from this point on rather than pretending the
-- candidate answered nothing. A re-import of the same unchanged file backfills
-- these columns (assessmentImport.service.js) — the one deliberate exception to
-- "a row already on file is skipped unless the score changed", because a NULL
-- has nothing to protect.
-- ============================================================================

ALTER TABLE rpa_assessment_results
  ADD COLUMN IF NOT EXISTS raw_row JSONB;

COMMENT ON COLUMN rpa_assessment_results.raw_row IS
  'The candidate''s own export row, verbatim, as header -> value. Archive only: '
  'the dossier renders the typed columns below and is asserted never to read this.';

ALTER TABLE rpa_assessment_results
  ADD COLUMN IF NOT EXISTS started_on_text VARCHAR(60);

COMMENT ON COLUMN rpa_assessment_results.started_on_text IS
  'When the candidate started, exactly as Evalground printed it ("27 Jul 2026, '
  '15:59"). This is what the dossier renders — the vendor''s own words.';

ALTER TABLE rpa_assessment_results
  ADD COLUMN IF NOT EXISTS started_on TIMESTAMPTZ;

COMMENT ON COLUMN rpa_assessment_results.started_on IS
  'started_on_text parsed, for sorting and querying. NULL when it could not be '
  'parsed rather than a guessed date. Evalground prints local wall-clock time '
  'with no offset, so this is read in the server''s timezone.';

ALTER TABLE rpa_assessment_results
  ADD COLUMN IF NOT EXISTS duration_text VARCHAR(60);

COMMENT ON COLUMN rpa_assessment_results.duration_text IS
  'Time taken, as printed ("37 minutes 27 seconds"), whitespace collapsed.';

ALTER TABLE rpa_assessment_results
  ADD COLUMN IF NOT EXISTS total_correct INT;

ALTER TABLE rpa_assessment_results
  ADD COLUMN IF NOT EXISTS total_wrong INT;

ALTER TABLE rpa_assessment_results
  ADD COLUMN IF NOT EXISTS total_unattempted INT;

COMMENT ON COLUMN rpa_assessment_results.total_unattempted IS
  'Questions left unanswered. Reported unaltered alongside correct/wrong — the '
  'vendor''s counts are never recomputed, so a reader holding an Evalground '
  'screenshot never finds two different numbers for one attempt.';

ALTER TABLE rpa_assessment_results
  ADD COLUMN IF NOT EXISTS section_detail JSONB;

COMMENT ON COLUMN rpa_assessment_results.section_detail IS
  'Per section: marks, correct, wrong, unattempted, easy/medium/hard correct and '
  'the section result. An array, indexed 1..3 by the "index" field, carrying only '
  'the sections the test actually had. Labels are NOT stored here — they live in '
  'section_label_map, so a pack built a year later still reads "Python".';

ALTER TABLE rpa_assessment_results
  ADD COLUMN IF NOT EXISTS topic_scores JSONB;

COMMENT ON COLUMN rpa_assessment_results.topic_scores IS
  'The test-specific tail columns ("Sql", "Coding", "Playwright" …) as an ordered '
  '[{label, value}] array. JSON rather than columns because these change with '
  'every test HR runs; anything that is not a known Evalground header is one.';

ALTER TABLE rpa_assessment_results
  ADD COLUMN IF NOT EXISTS attempt_status VARCHAR(30);

COMMENT ON COLUMN rpa_assessment_results.attempt_status IS
  'The export''s "Report" column — "Completed" and the like. Internal: it says '
  'whether the attempt finished, not how the candidate did.';

ALTER TABLE rpa_assessment_results
  ADD COLUMN IF NOT EXISTS marked_as VARCHAR(60);

COMMENT ON COLUMN rpa_assessment_results.marked_as IS
  'Evalground''s own recruiter tag on the attempt. INTERNAL — never travels in a '
  'candidate dossier; it is one of our people''s notes, not the candidate''s work.';

ALTER TABLE rpa_assessment_results
  ADD COLUMN IF NOT EXISTS public_report_url VARCHAR(512);

COMMENT ON COLUMN rpa_assessment_results.public_report_url IS
  'The export''s "Public Report" column, stored VERBATIM. Evalground truncates it '
  'at 62 characters, cutting the report id mid-UUID, so in every sample export '
  'held so far it cannot be opened. Kept so the question can be answered from '
  'data; never rendered as a link unless it survives isUsableReportUrl().';
