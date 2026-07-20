# Phase 3 — Evalground Import: Format Verification & M2 Build Plan

**Document 7** · Prepared 2026-07-15 (Harish) · Companion docs: [01-PROCESS-UNDERSTANDING.md](01-PROCESS-UNDERSTANDING.md) · [02-BUSINESS-DESIGN.md](02-BUSINESS-DESIGN.md) · [03-DEVELOPMENT-PLAN.md](03-DEVELOPMENT-PLAN.md) · [04-QUESTIONS.md](04-QUESTIONS.md) · [05-TASK-LIST-ETA.md](05-TASK-LIST-ETA.md)

This document closes **Task A2** ("verify received Evalground sample CSVs against the Section 1/2/3 design") and **Task A3** ("decide bulk-CSV section→skill mapping approach") from [05-TASK-LIST-ETA.md](05-TASK-LIST-ETA.md), using the two real sample files received 2026-07-14 and placed in `docs/phase3/EvalGround Report & Bulk Upload/`:

- `General Aptitude, Python, SQL MCQ Test at AAPNA - 2025TestReport - For Claude.csv` (229-row bulk export, from Naveen)
- `Report  Pradeep Gupta (pg@gmail.com) scored 26.544.0 in General Aptitude Test... .htm` (single-candidate Outlook report, from Chhaya)

It then lays out the M2 build (backend + frontend) on top of the resulting decisions, for developer review before work starts (scheduled 2026-07-31 → 2026-08-06 per [05-TASK-LIST-ETA.md](05-TASK-LIST-ETA.md)).

---

## 1. Format verification (closes Task A2)

**Confirmed — matches the docs' existing assumptions** ([03-DEVELOPMENT-PLAN.md](03-DEVELOPMENT-PLAN.md) §M2, [04-QUESTIONS.md](04-QUESTIONS.md) Q1):
- Unique key = candidate email; CSV columns are generic (`Section 1/2/3`, no test name/role baked into the header); one row per candidate per test; GA + Technical content arrive in one file.
- Bulk CSV's `Report` link is a direct, usable `evalground.com` URL — no wrapping.

**New findings, not previously scoped — must shape the build:**

1. **6 extra columns** (`Sql, Coding, Python, Py Test, Playwright, Pywinauto`) appear in the bulk CSV, never mentioned in docs 01–04. `Sql`/`Coding` are `0`/`N/A` for **all 229 rows** of a test whose title literally says "SQL" — these read as Evalground's fixed global skill-tag catalog (present on every export regardless of test content), not a reliable per-test signal on their own. Still real per-candidate data worth keeping — see §2.
2. **6 of 229 rows have a blank `Candidate Email`** (Candidates 224–229, all `Result=Failed`) — real malformed rows the import must route to a "malformed" bucket, not attempt to match.
3. **5 rows have `Result=NA`** (Candidates 199, 207, 217, 220, 223), correlated with `Duration=NA` — an abandoned/restarted attempt, not a scored Fail. Needs its own bucket; must not be auto-suggested Failed by the 50% pass-mark rule.
4. **Per-section `Result` sub-columns (`S1 Result`/`S2 Result`/`S3 Result`) are blank on every single row** — confirmed unpopulated by Evalground. Don't build anything that depends on reading them.
5. **`Previous Assessments` is `N/A` on all 229 rows** — the RT-confirmed retake rule (skip a row already in the DB; if score changed, overwrite only the score) is **untested against real data** in this sample. Verification must use a synthetic retake (re-import with a hand-edited duplicate row) — see §6.
6. **The single-result file is Word/MHTML, not plain HTML** (`mso-*` CSS, `xmlns:o="urn:schemas-microsoft-com:office:office"`, a sibling `_files/` folder with `themedata.thmx`/`filelist.xml`) — but is structurally simple underneath: clean `<table>` elements, a label/colon/value header block (Test Title, Candidate, Email, Contact), then a matrix table whose **column headers are the actual test names** ("General Aptitude test", "Dot Net test", "Overall") rather than "Section 1/2/3" — a different labeling convention from the bulk CSV, by design (curated report vs. raw export).
7. **Report/Resume links in the single-result file are double-wrapped** in Outlook Safe Links (`safelinks.protection.outlook.com/?url=...` → `sgsub.notify.evalground.com/ls/click?...`) — not reliably resolvable server-side (session-bound, may expire). Store as raw reference strings; never block import on them.

---

## 2. Section→skill mapping decision (closes Task A3)

**Rejected approach:** RT manually tagging every section by hand at import time — too much manual work for an enterprise tool, and RT already has enough review burden in the validation-preview step.

**Adopted: AI-suggested, RT-confirmed once per batch, correctable per candidate afterward.**

Evalground's own naming already carries the skill/topic labels — they aren't in the CSV column headers, but they are in the **test title**:
- Bulk CSV filename: *"General Aptitude, Python, SQL MCQ Test at AAPNA..."* — 3 comma-separated topics, in order, for 3 sections.
- Single-result "Test Title": *"General Aptitude Test - 01-2014 & Dot Net - 12-2019 - Technical Test"* — and its own results table already uses "General Aptitude test" / "Dot Net test" as literal column headers.

This is a positional signal grounded in real data, not a guess made from nothing. The mapping flow:

1. **`suggestSectionMapping(testTitle, sectionCount)`** — one LLM call per unique test title (not per row), via the existing `generateContentWithFallback` infra already used for resume parsing. Parses the test title into an ordered list of topic names, maps them positionally to Section 1..N, and classifies each as `aptitude` or `technical` (keyword rule: aptitude/reasoning/english/verbal → aptitude; everything else → technical).
2. **Corroboration signal, not a gate:** cross-check each suggested section label against (a) the row's own extra skill-tag columns (`Python`/`Py Test`/`Playwright`/`Pywinauto` — a nonzero value under a candidate's "Python" tag corroborates a "Python" section guess) and (b) the candidate's own `rpa_cv.Top5KeySkills`. Surfaced as a small "matches candidate profile" indicator in the UI — informational only, never blocks a decision.
3. **RT reviews once per import batch** (the mapping is identical for every row in one CSV — no need to review per candidate): a single confirm screen shows the AI-suggested labels + Aptitude/Technical bucket, editable inline, before commit.
4. **Rollup formula is generic — no hardcoded question counts.** Per row, per section: `max = Correct + Wrong + Unattempted` (verified constant per section across all 229 rows in the sample — S1=24, S2=25, S3=8 — but always *derived fresh from the file*, never hand-entered per test). `IQScore` = percentage of the aptitude-tagged section(s). `TechScore` = marks-weighted average across technical-tagged sections. Falls back to generic `Section 1/2/3` labels + a default (Section 1 = aptitude, rest = technical) only if title-parsing yields a topic count that doesn't match the section count — and this default is not a hard assumption baked into the rollup logic, so a test with **zero** aptitude sections (a pure role-specific IT test, per Q1's "IT candidates get role-specific tests") is handled correctly too.
5. **Per-candidate override, post-commit:** each candidate's Assessment round panel shows its own section breakdown; RT can correct one candidate's section→skill classification without re-running the whole batch. This edits that one result row and re-triggers just that candidate's score write-back.
6. **The 6 extra skill-tag columns are stored as raw per-candidate metadata** for the future whole-DB skill-search requirement (already a non-negotiable per [02-BUSINESS-DESIGN.md](02-BUSINESS-DESIGN.md) §1.1) — never fed into the IQScore/TechScore rollup, since `Sql`/`Coding` reading 0/N/A on a SQL-titled test shows they aren't a reliable content signal on their own.

**Caveat to carry forward:** this rule is derived from **one** sample test template (a 3-section combined IT test). Validate the title-parsing approach against a non-IT test ("GA + English" per Q1) and a pure role-specific test (no aptitude section at all) as soon as more real exports are available — the logic already tolerates a zero-aptitude-section test structurally, but hasn't been checked against one yet.

---

## 3. Data model

New tables (Prisma, `backend/prisma/schema.prisma`):

```prisma
model rpa_assessment_imports {
  id                  Int       @id @default(autoincrement())
  mechanism           String    // 'bulk_csv' | 'single_outlook'
  test_title          String?   // parsed from filename / report "Test Title"
  file_name           String
  file_url            String?
  uploaded_by         String
  uploaded_at         DateTime? @default(now()) @db.Timestamptz(6)
  status              String    @default("pending_review") // pending_review | committed | cancelled
  total_rows          Int       @default(0)
  matched_count       Int       @default(0)
  updated_count       Int       @default(0)   // retake, score changed
  skipped_count       Int       @default(0)   // retake, score unchanged
  unmatched_count     Int       @default(0)
  malformed_count     Int       @default(0)
  not_completed_count Int       @default(0)   // Result=NA rows
  section_mapping     Json?     // AI-suggested + RT-confirmed [{label, roleTag, source:"ai"|"rt_edit"}]
  details             Json?
  committed_at        DateTime? @db.Timestamptz(6)
}

model rpa_assessment_results {
  id                 Int       @id @default(autoincrement())
  import_id          Int
  cv_id              BigInt?
  candidate_name     String?
  candidate_email    String?
  match_status       String    // matched | updated | skipped | unmatched | malformed | not_completed
  overall_percentage Decimal?  @db.Decimal(5,2)
  overall_result     String?   // Evalground's own Passed/Failed/NA, verbatim
  section_scores     Json      // [{label, roleTag, marks, max, correct, wrong, unattempted, percentage, source}]
  extra_skill_tags   Json?     // raw Sql/Coding/Python/PyTest/Playwright/Pywinauto values
  iq_score_written   String?
  tech_score_written String?
  report_link        String?
  resume_link        String?
  duration_raw       String?
  error_detail       String?
  created_at         DateTime? @default(now()) @db.Timestamptz(6)
}
```

`rpa_cv`/`rpa_cv_tmp` need **no new columns** — `IQScore`/`TechScore` (`String?`, schema.prisma lines 111-112/385-386) already exist and are already read/written by `candidate.service.js`, `hrUpload.service.js`, and `screening.service.js`. Write convention: plain rounded-integer string (e.g. `"78"`, no `%`), matching how `CandidatePipelinePrototype.jsx` treats `iq`/`tech` and how the 50% pass-mark gets compared.

`rpa_assessment_results.section_scores` is what makes the per-candidate override in §2.5 possible without re-uploading the source file.

---

## 4. Backend plan

New `backend/src/services/assessmentImport.service.js`, structured like `hrUpload.service.js`'s schema-free row reading and `zeko.service.js`'s email-match write-back:

- `parseBulkCsv(filePath)` — `XLSX.readFile` + `XLSX.utils.sheet_to_json` (same call already used at `hrUpload.service.js:1085-1088`; `xlsx` reads `.csv` too — no new dependency).
- `detectSections(rows)` — finds `Section N Marks`/`SN Correct`/`SN Wrong`/`SN Unattempted` column groups, returns section count.
- `suggestSectionMapping(testTitle, sectionCount)` — the §2 AI-suggestion step, one LLM call per import.
- `computeRowScores(row, sectionMapping)` — pure function implementing the §2.4 rollup formula; unit-testable directly against the real sample CSV rows.
- `validateBulkRows(rows, sectionMapping, roundCandidateEmails)` — classifies each row (`malformed` / `not_completed` / `unmatched` / `matched-new` / `matched-retake-changed` / `matched-retake-unchanged`); no writes, feeds the preview screen.
- `previewBulkImport(filePath, uploadedBy)` — orchestrates the above, creates `rpa_assessment_imports` (`status='pending_review'`) + per-row `rpa_assessment_results`, returns counts + row-issue list + the suggested section mapping for RT to confirm/edit.
- `commitBulkImport(importId, confirmedMapping)` — re-applies the (possibly RT-edited) mapping, writes `IQScore`/`TechScore` to `rpa_cv` via `UPDATE ... WHERE "EmailID" ILIKE ...` (same pattern as `zeko.service.js`'s `fetchInterviewResults()` write-back), inside a single transaction (no partial writes), flips import `status='committed'`.
- `extractSingleResultFromHtml(htmlContent)` — strip tags to text (simple regex, no new HTML-parsing dependency), LLM-extract `{candidateName, candidateEmail, sections:[{label, percentage, marksScored, questionsAttempted}], reportLinkRaw, resumeLinkRaw}` via the same LLM infra. Cross-check the extracted email against a deterministic regex anchor (the "Email :" table row / forwarded `Subject:`/`From:` header) — if they disagree, force the row to "unmatched, needs manual pick," never trust the LLM blind on the match key.
- `previewSingleResult` / `commitSingleResult` — same shape as the bulk path, for exactly one row; editable fields before commit (mirrors `CandidatePipelinePrototype.jsx:1121-1137`).
- `patchResultRow(resultId, edits)` — the §2.5 per-candidate override: edits one `rpa_assessment_results.section_scores` entry, recomputes and rewrites just that candidate's `rpa_cv.IQScore`/`TechScore`.

**Why LLM extraction over a new cheerio/jsdom dependency for the single-result HTML:** no HTML-parsing library exists in the repo today; the single-result path is low-volume and always reviewed by a human before commit (editable inputs in the UI), so an LLM misread degrades to "RT fixes a pre-filled number," not a silent bad write — consistent with the bulk path's own "AI reads rows, no fixed template" framing already shown in `CandidatePipelinePrototype.jsx`.

### Ingestion: automatic mailbox polling, not manual upload

The sample single-result report was sent to an individual RT member's personal inbox, but Evalground reports are expected to be redirected to the shared mailbox the ATS already polls (`config.microsoft.defaultSender`, read by `outlookReader.service.js`, used today by both the Zeko OTP reader and `emailResumeIntake.js`). Build a third poller, `backend/src/jobs/evalgroundResultIntake.js`, alongside the existing two:

- Reuses `fetchMessagesSince()`/`fetchMessagesDelta()` + `normalizeMessage()` from `outlookReader.service.js` — same infra, no new Graph permissions or mailbox config needed.
- Filters messages by sender (`fromEmail` matching Evalground's sending address, e.g. `support@evalground.com`, confirmed from the sample's own `From:` header) or subject pattern (`^Report \| .* scored .* in `, confirmed from the sample's own subject line), rather than `emailResumeIntake.js`'s `hasAttachments` filter — the single-result report is inline HTML body, not an attachment.
- Idempotent the same way as `emailResumeIntake.js`: deterministic `executionId = "evalground-" + sha1(graphMessageId).slice(0,16)`, checked against a log before reprocessing.
- On a new match: runs `extractSingleResultFromHtml(msg.bodyHtml)` → `previewSingleResult(...)`, creating an `rpa_assessment_imports` row with `status='pending_review'` automatically. **Does not auto-commit** — RT still reviews and confirms the extracted score in the UI before it's written to `rpa_cv`, same human-in-the-loop principle as the bulk path.
- Gated behind an env flag (`EVALGROUND_INTAKE_ENABLED`), off by default, matching `EMAIL_INTAKE_ENABLED`'s pattern — lets this ship and be tested in staging before the shared-mailbox redirect is live in production.
- Keep the manual-upload endpoint (`POST /api/assessment-import/single/preview` with a file body) as a fallback entry point for the same extraction/preview functions — the logic is mechanism-agnostic (just needs raw HTML), and it covers the gap before the mailbox redirect exists.

### Routes/controller

New `backend/src/routes/assessmentImport.routes.js` + `.controller.js`, following `hrUpload.routes.js`'s multer/auth pattern:
- `POST /api/assessment-import/bulk/preview`, `POST /api/assessment-import/bulk/:importId/commit`
- `POST /api/assessment-import/single/preview`, `POST /api/assessment-import/single/:importId/commit`
- `PATCH /api/assessment-import/:importId/rows/:rowId` (manual match / per-candidate override)
- `GET /api/assessment-import/history`

Mount alongside the other route registrations; reuse the M1 pipeline module's access gate (this lives inside the Assessment round panel, not a standalone module).

---

## 5. Frontend plan

No production Tracker/Pipeline page exists yet — only `frontend/src/pages/CandidatePipelinePrototype.jsx` (mocked, no API calls, route `/candidate-pipeline-prototype`). M2's real UI home is the Assessment round panel inside M1's `Pipeline.jsx`/`PipelineDrawer.jsx`, which don't exist until M1 ships (M1 finishes 2026-07-30, M2 starts 2026-07-31 per [05-TASK-LIST-ETA.md](05-TASK-LIST-ETA.md) — sequencing already matches this dependency).

- Backend/API layer (§4) can be built and tested standalone (curl/Postman + the real sample files) without waiting on M1.
- New `frontend/src/components/pipeline/AssessmentImportModal.jsx` — port the existing modal UX from `CandidatePipelinePrototype.jsx:1065-1140` (Bulk CSV / Single-result radio toggle, Steps wizard, validation stat tiles, row-issue table), insert a **section-mapping confirm step** (AI-suggested labels + Aptitude/Technical bucket, inline-editable, "matches candidate profile" indicator per §2.2) between "AI reads rows" and "Validate," and wire it to the real `/api/assessment-import/*` endpoints instead of the hardcoded mock counts.
- Since single-result ingestion is now automatic (§4), add a lightweight **"pending Evalground results" queue/badge** (e.g. on the Assessment column header or a notifications strip) surfacing `rpa_assessment_imports` rows with `mechanism='single_outlook', status='pending_review'` that the poller created — clicking one opens the same preview/confirm/commit flow as a manual single-result upload, just pre-filled from the auto-detected email instead of a file picker.
- New `frontend/src/services/assessmentImport.js` API client.
- Per-candidate section override surfaced in the candidate's round-panel drawer (§2.5), not just the batch modal.
- Cross-check UX against the older static wireframe `docs/phase3/Phase 3 - prototype.html#m-import` — same validation-tile/row-action semantics; `CandidatePipelinePrototype.jsx` is the primary spec (more recent, React-native).

---

## 6. Verification plan

Using the real files already in `docs/phase3/EvalGround Report & Bulk Upload/`:

**Bulk CSV (229 rows):**
1. Seed staging `rpa_cv` with candidates matching a subset of the CSV's emails, some in the Assessment round, some not.
2. Run `previewBulkImport` → assert `total_rows=229`, `malformed_count=6` (blank-email rows), `not_completed_count=5` (Result=NA rows), and the AI-suggested section mapping resolves to `["General Aptitude"→aptitude, "Python"→technical, "SQL"→technical]` from the filename.
3. Spot-check computed rollups against hand-calculated values (e.g. Candidate 1: S1 23/24=95.8%→IQScore; (S2 24 + S3 8)/(25+8)=32/33=97.0%→TechScore).
4. Commit → verify `rpa_cv.IQScore`/`TechScore` actually landed via direct DB read; `rpa_assessment_results` has one row per CSV row.
5. Re-import the same file → idempotent (previously-committed rows show `skipped`, no duplicates).
6. Synthetic retake (hand-edit one already-imported candidate's section marks, re-import) → only `IQScore`/`TechScore` change on `rpa_cv`, nothing else touched.
7. Edit one candidate's section mapping via the per-candidate override → confirm only that candidate's `rpa_cv` row changes, batch import record untouched.

**Single-result (Pradeep Gupta `.htm`):**
1. Upload the raw file through the single-result path.
2. Assert extracted email `pg@gmail.com` passes the regex cross-check despite the Word/mso markup.
3. Assert both subtests ("General Aptitude test" 66.67%, "Dot Net test" 52.5%) extract correctly and map to IQScore/TechScore.
4. Assert wrapped safelinks hrefs are stored as-is, never block commit.
5. Commit → same downstream `rpa_assessment_results` shape as a one-row bulk import.

---

## Critical files

- `backend/prisma/schema.prisma` — add `rpa_assessment_imports`, `rpa_assessment_results` (reference `rpa_cv` ~L70-148, `rpa_zeko_interview_results` ~L561-572 as structural precedent)
- `backend/src/services/assessmentImport.service.js` — new, core logic
- `backend/src/services/hrUpload.service.js` (L235 `parseResumeWithOpenRouter`, L1085-1111 CSV/XLSX reading, L1638-1671 dispatch pattern) — reuse
- `backend/src/services/zeko.service.js` (~L439-542) — reuse write-back-by-email pattern
- `backend/src/services/outlookReader.service.js`, `backend/src/jobs/emailResumeIntake.js` — template for the new `evalgroundResultIntake.js` poller (shared mailbox, idempotent via hashed `graphMessageId`, gated behind an env flag)
- `backend/src/routes/hrUpload.routes.js` — template for new routes
- `frontend/src/pages/CandidatePipelinePrototype.jsx` (L1065-1140) — UX spec to wire up
- `docs/phase3/EvalGround Report & Bulk Upload/` — both real sample files, used as test fixtures
