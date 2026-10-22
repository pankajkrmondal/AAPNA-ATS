# Phase 3 "Do Now", section B: JD tagging on upload, plus Add to JD hardening

**Date:** 21 Oct 2026 · **Plan:** [PLAN-Phase3-Now.md](../Phase%203%20Enhancements%20or%20Feedback/PLAN-Phase3-Now.md) §4.B, revised on 21 Oct (session plan "close B, G, H").
**Items:** N13, N14, N15, plus hardening of Search Candidate's "Add to JD" (N21) and the dashboard follow-up from N36. This completes section B in code.
**Status:**
- **Tested on 21 Oct against the staging database** (results under "Tests"):
  - unit tests pass;
  - the new section B integration file passes 9/9;
  - the JD, section C and vendor integration files still pass;
  - the frontend builds.
- **The DDL is applied on staging** (21 Oct, with the guarded runner): 67 tags backfilled. The extra unique index was skipped because staging has one duplicate shortlist pair (see "Known").
- **Not done yet:**
  - screen checks in the browser;
  - deploying the build to the staging server;
  - committing.
  - Production goes once, at the end, with the other sections.
- **One email went out during testing:** the merge test triggers the usual post-merge welcome email, sent through Graph to the non-prod test inbox, never to a real candidate.

**Decisions (21 Oct):**
- Existing shortlists are **backfilled** as tags. Uploads from before this release were never recorded, so they stay untagged.
- Vendors get the JD picker too, listing **all open JDs** until per-vendor JD sharing (C2C) exists.
- "Tagged to this JD only" is **off by default**.

---

## What changed, by item

### N13 · Data model
**What users see:** nothing on its own. It records which JD each candidate was uploaded for or shortlisted to.

**How**
- **DDL** `backend/prisma/ddl/2026-10-21-candidate-mrf-tags.sql`, with a rollback file. It is idempotent and additive, and makes five changes:
  - new table `rpa_candidate_mrf_tags`: one row per candidate per MRF; `source`, `tagged_by`/`tagged_by_id`, `tagged_at` and `upload_execution_id`; unique `(cv_id, mrf_id)`; FKs cascade with the candidate and the MRF;
  - `rpa_cv_tmp.mrf_id`, so a duplicate waiting for a merge remembers its upload's JD;
  - `rpa_upload_jobs.mrf_id`, for the job list and reprocess;
  - a backfill of a tag for every existing shortlist link (screening rejects with no journey are left out);
  - a partial unique index `uq_shortlist_cv_mrf` on `rpa_shortlisted_candidates (cv_id, mrf_id)`, created only when no duplicates exist. Otherwise the DDL raises a WARNING listing them.
- **Schema:** `schema.prisma` was hand-edited to match: the new model, its back-relations, and the two columns.
- **Rules** in `backend/src/utils/candidateTag.js` (pure, unit-tested):
  - the tag sources;
  - `parseMrfId`;
  - `actorColumns`;
  - `mrfCandidateBlock`, the single "can this JD take candidates" test. It is the JD picker's own rule: approved, or completed with CEO approval, and not closed or filled. Paused MRFs are still listed in the picker, so they are not refused.
- **Writers and readers** in `backend/src/services/candidateTag.service.js`:
  - `tagCandidates` / `tagCandidatesSafe` (idempotent; a `db` option lets a caller tag inside its own transaction);
  - `retagCandidate`, ready for Change JD (G);
  - `tagsForMrf`, `tagsForCandidate`;
  - `resolveUploadMrf`.

### N14 · JD picker on uploads
**What users see**
- **HR Upload and the Vendor portal** have an optional **"Uploading for JD"** picker above the dropzone. It lists open JDs labelled as in Screening (role · MRF-41 · date · Latest).
  - Every new candidate in that upload is tagged to the JD straight away.
  - A duplicate is tagged when a recruiter merges it; Cancel leaves no tag.
  - Leaving the picker empty uploads exactly as before.
  - The picker clears after each upload, so a JD is never carried over by accident.
- **Job lists** on both pages have a **JD** column. The upload-jobs CSV has one too.
- **Refused JDs:** a JD that is closed, filled or not approved is refused before anything is saved, with the reason. The received files are removed.

**How**
- The JD travels as its **own argument**, `{ mrfId }`, through:
  - `dispatchBatchParsing` → BullMQ payload (as a string) → `resumeWorker` → `runBatchParsing`;
  - `startBackgroundParsing` → `runBatchParsing`.

  It is **never** put in `attribution`, whose presence changes the vendor fallback and the rejected-resume alert label.
- **In `runBatchParsing`:**
  - a new `rpa_cv` row is tagged right after it is created;
  - a duplicate's `rpa_cv_tmp` row gets `mrf_id`;
  - Outlook intake never tags (no picker).
- **In `mergeDuplicates`:** the resolved candidate is tagged **after** the merge commits, not inside it. A failed statement aborts a Postgres transaction, and a tag must never undo a merge.
- **Jobs and reprocess:** `rpa_upload_jobs.mrf_id` is set at upload. Both reprocess endpoints re-run with it.
- **Serialisation:** `serializeJob` stringifies `mrf_id` (there is no BigInt in JSON) and adds `jd_label` when the list loads the MRF.
- **New endpoint** `GET /api/vendor/mrfs` (`vendor_upload` module) returns only id, ref, role, date and the Latest flag. Vendors cannot reach the staff JD list. HR Upload uses the existing `GET /api/dashboard/mrf-options`.
- **Frontend:** the shared picker is `frontend/src/components/common/UploadJdPicker.jsx`.

### N15 · "Tagged to this JD only"
**What users see**
- **JD Filtering tab:** a **"Tagged to this JD only"** checkbox next to "Include closed MRFs" (off by default). When ticked:
  - the search covers only the candidates uploaded for, or shortlisted to, that JD;
  - the summary says how many are tagged.
- **Tag chip:** cards on the JD tab show a **Tagged** chip when the candidate is tagged to that JD. Its hover says how and when (for example "Vendor upload for this JD on 21 Oct 2026 by …").
- **Export:** the CSV export follows the checkbox.

**How**
- **Both searches** take a `taggedOnly` option end to end: controller, both searches and the export.
  - **Old search (V1):** an `EXISTS` condition on the tag table.
  - **V2:** the tag condition is the first funnel gate (`removedBy.tagged`, labelled "not tagged to this JD").
- **Caching:** cache keys gain a `:t` suffix for tagged-only results. `allRoleCacheKeys` now names all 24 variants, so an MRF edit or closure clears them all.
- **Chip data:** `attachTagInfo` (screening.service.js) adds `jd_tag` to every JD-tab card before caching.

### N21 · Add to JD hardening (Search Candidate and both Screening tabs)
`shortlistCandidates` is shared by Search Candidate's "Add to JD" and the Screening shortlist.

| # | Was | Now |
|---|---|---|
| R1 | One bad row (a deleted candidate, a DB hiccup) aborted the batch midway, after earlier candidates were already shortlisted and emailed. The screen said only "Failed to add…". | Each candidate is handled on its own. Failures come back in `failed_candidates` (name and reason), and the result dialog lists them under **"N failed"**. The cache is always cleared. |
| R2 | If the pipeline journey could not be created, the candidate still counted as added and got the email, but never appeared on the board. A retry then skipped them as "already shortlisted". | The journey must exist **before** any email. If it can't be created, the shortlist row is put back, the candidate is listed as failed, and nothing is sent. |
| R3 | Check-then-insert: two recruiters adding the same person at once wrote two rows. | Each (candidate, JD) is written under a Postgres transaction lock (`pg_advisory_xact_lock`), plus the new unique index where the data allows it. |
| R4 | Name and email came from the browser. | They are read from the candidate record, so a stale screen can't email an old address. |
| R5 | The role text came from the browser. | It is the MRF's own title. |
| R6 | Only closed or filled MRFs were refused. | An unapproved MRF is refused too (`mrfCandidateBlock`). |
| R7 | `FinalStatus` was always set to "Stage 0 - Resume Shortlisted". | It is left alone when the candidate is further along on another open journey. |
| R8 | No cap. A Search Candidate selection kept across pages could time out partway through. | Add to JD takes at most **50** per request: the button is disabled above that, with a hint, and the server refuses with 400. The Screening tabs keep "Select all N matches" and now get a 10-minute request timeout instead of a cap. |
| R9 | — | Shortlisted candidates, and those skipped as already shortlisted or in the pipeline, are tagged to the JD. Cool-off skips and failures are not. |

### Also: Dashboard MRF filter uses tags (N36 follow-up)
With an MRF picked, "candidates added" and the Hiring Trends line count a candidate when they are **tagged to that MRF**. Candidates from before tagging existed still count when their "Position Applied" matches the role, so older periods don't drop to zero. The ⓘ text says so, and `matchedBy` is now `jd_tag_or_position_applied`.

---

## Tests
**Unit (`node:test`), all passing:**

| File | Result |
|---|---|
| `unit/candidateTag.test.js` | 8 new (sources vs DDL list, shortlist/upload source mapping, `parseMrfId`, actor columns, the JD-open rule incl. legacy closed rows) |
| `unit/screeningCacheKeys.test.js` | 5, 1 new; the variant count updated 12 → 24 |
| `unit/jdScreeningRules.test.js` | 46 |
| `unit/screeningFilters.test.js` | 61 |
| `unit/dashboardMetrics.test.js` | 8 |

**Integration (staging DB, `node src/tests/run-block.mjs <file>`):**

| File | Result |
|---|---|
| `integration/sectionB.test.js` (new) | 9/9 |
| `integration/jdGates.test.js` | 14/14, 1 new (N15: tagged-only returns only the tagged passer; cards carry `jd_tag`) |
| `integration/sectionC.test.js` | 6/6 (shortlist regression) |
| `vendorIsolation.test.js` | 15/15 |
| `vendorNotification.test.js` | 22/22 |

`sectionB.test.js` covers:
- tag idempotency and source;
- Add to JD tagging;
- record-sourced name, email and role (R4/R5);
- an unknown id failing alone (R1);
- concurrent double add writing one row and one journey (R3);
- unapproved MRF refused (R6);
- FinalStatus not regressed (R7);
- the 50 cap on Add to JD only (R8);
- a merged vendor duplicate tagging the resolved candidate (N14).

**Not covered by an automated test:** R2 (a journey that cannot be created). Nothing in the current code makes `createPipelineJourney` fail after the cool-off check without a mock, and the suite does not mock Prisma.

**Lint:** `no-undef` is clean on every touched file. The only errors reported are the existing `react-hooks` disable comments, because the scratch config doesn't load that plugin. `vite build` passes.

## Known
- **Staging duplicate shortlist pair:** candidate 34 on MRF 112 (rows 20 "shortlisted" and 21 "rejected"). The index `uq_shortlist_cv_mrf` was therefore not created on staging. The code's lock prevents new duplicates either way. Production may have its own pairs, and the DDL lists them as a WARNING. Decision 21 Oct: leave them.
- **Prisma engine lock:** on Windows, `npx prisma generate` can fail with EPERM on the query-engine DLL while a backend or worker is running. Stop them first.

## Staging steps (dev → staging)
1. **DDL:** done on 21 Oct (`2026-10-21-candidate-mrf-tags.sql`, 67 tags backfilled).
2. **Deploy**, then on the server run `npm run prisma:generate` and restart the backend (and the queue worker if it is used).
3. **Screen checks:**
   - an HR upload (zip and Excel) for a JD, including one duplicate that is then merged;
   - a vendor upload for a JD;
   - the JD column on both job lists;
   - "Tagged to this JD only" and the chip, on both searches;
   - Add to JD with an unknown or deleted candidate and with more than 50 ticks;
   - the dashboard with an MRF picked.
4. **Tell RT:**
   - pick the JD when uploading;
   - the new checkbox on JD Filtering;
   - the result dialog now lists failures.

## Final production release (add to the single list)
1. Run `2026-10-21-candidate-mrf-tags.sql` with the guarded runner (`--dry-run` first). Read the WARNING, if any, for duplicate shortlist pairs.
2. Deploy, `prisma:generate`, restart the backend and worker.
3. RT briefing as above.

## Rollback
- **Code:** deploy the previous build.
- **Data:** then run `2026-10-21-candidate-mrf-tags.rollback.sql`. It drops the tag table, the two `mrf_id` columns and the unique index. Upload tags are lost; backfilled ones can be rebuilt by re-running the forward file. Shortlists and journeys are untouched.
