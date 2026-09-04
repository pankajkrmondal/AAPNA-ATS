# Candidate Complete Download ("Candidate Dossier") — Implementation Plan

**Status:** **Phases 0, 1, 2 and the Zeko half of Phase 3 complete (2026-09-03).** The screening report now
travels two ways: the **assessment rendered into the pack** under our redaction, on by default (§6.7), and an
**opt-in no-login link** to Zeko's own page for the reader who needs the recording or transcript (§6.6). HR sign-off done (§2); the
OneDrive read test passed, so no IT action is outstanding (§6.3). Built on `pankaj-work-staging-v16` and
verified end to end against staging data — the pack carries the candidate's actual resume, and now a no-login
link to their full Zeko screening report (§6.6). **The Evalground half of Phase 3 was built 2026-09-03** and
did not need the assessment-report upload item at all: Evalground exports no per-candidate file, only a
multi-candidate spreadsheet, so the import now keeps the candidate's whole row and section 7 of the pack
renders their written test — see `ASSESSMENT-REPORT-UPLOAD-PLAN.md`. **Phase 4 (recording share links) was
built 2026-09-03** — table, public token route, player page, rate limiter, per-view audit and the drawer's
revoke list (§6.5); 320 unit tests pass. **Remaining: Phase 5** (the §10 test pass), plus applying the two new
DDLs and turning on `MS_RECORDING_ARCHIVE_ENABLED` before any of it ships to production.

**One item for HR before this ships to production**, and it concerns only the optional link, not the
assessment: the Zeko share link opens Zeko's full report UI —
recording and verbatim transcript included — **outside this pack's redaction**, and it cannot be expired or
revoked by us. It therefore ships **off by default**, as a conscious tick with the exposure named, exactly
like personal documents (§6.6, §11 item 3). HR asked for the Zeko report in the pack (decision #8), so they
should confirm that an opt-in is what they meant.

**Two things to do before production:** re-run the OneDrive read test against `HR_RPA_PROD`, and apply
`prisma/ddl/2026-09-02-onedrive-item-ids.sql` there.
**Date:** 2026-09-02
**Owner:** Pankaj
**Priority:** P0 (Phase 3, "Start Immediately" list)
**Source of requirement:** `Rakhi_madam_review_Phase-3/` — meeting *ATS App – Quick Update*, 28 Aug 2026, 38:27–41:48; written up in
`Sanghamitra_Roy_ATS_Enhancement_Change_Requirements.docx` §7 + §20 (P0) and
`Sanghamitra_Roy_ATS_Start_Work_Priority_Plan.docx` §2 ("Candidate-level complete download", "External interviewer workflow").
**Related:** `docs/phase3/INTERVIEW-RECORDINGS-PLAN.md`, `docs/phase3/INTERVIEWER-SCORECARD-PLAN.md`,
`docs/phase3/07-EVALGROUND-IMPORT-PLAN.md`, `docs/phase3/MS-GRAPH-SETUP-FOR-IT.md`

---

## 1. What is actually being asked

Verbatim from the transcript (Sanghamitra Roy, 39:17 and 39:38):

> "Chhaya, who's a recruiter, should be able to **download all that Pankaj has cleared so far** and should be able
> to **share with Atul on mail**. I don't want that through ATS because that will be a lot of challenge and those
> are one-off cases. But **as a recruiter she should have that provision**."
>
> "…downloads **everything** of Pankaj and then shares with Atul over mail."

And at 41:35 / 41:48, closing the design space:

> "It is **not even needed to be added here** because those are one-off cases as long as she is able to just
> download the details… As long as she is able to download and share it over mail."

### 1.1 The five tracker rows this plan covers

| # | Row on the review sheet | Status |
|---|---|---|
| 1 | Agree dossier contents and format with HR: resume / Zeko report / Evalground report / all round scorecards / recording links | ✅ **Agreed 2026-09-02** — contents in §3, decisions in §2 |
| 2 | Backend: per-candidate aggregation endpoint under `/api/pipeline/:id/dossier` | §5 |
| 3 | Generate the downloadable pack (PDF/Excel summary plus attachments) | §6 |
| 4 | Frontend: Download button in `PipelineDrawer` restricted to recruiter and final decision-makers | §7 |
| 5 | Verify the pack opens outside the ATS with no login and leaks no vendor or CTC data | §8 (redaction) + §10 (tests) |

### 1.2 What this is NOT

- **Not** an external-interviewer portal. The recruiter emails a file. No account, no invite, no token page
  for the interviewer to log into. (Sanghamitra rejected the in-ATS route twice — 41:35, 41:48.)
- **Not** the list-level pipeline export. Those already exist (`pipeline.routes.js:29`,
  `screening.routes.js:35`, `candidate.routes.js:69`) and export one row per candidate. Harish confirmed
  the gap on the call at 38:46: *"As of now, we can export the data of whatever happening in the pipeline,
  but not from the candidate level."*
- **Not** a replacement for the Scorecard Report modal. That stays; the dossier is its offline, shareable form.

---

## 2. Decisions (confirmed by HR 2026-09-02 — see `CANDIDATE-DOWNLOAD-HR-QUESTIONS.md`)

| # | Decision | Rationale / consequence |
|---|---|---|
| 1 ✅ | **Deliver a ZIP pack**, not a single PDF | A single PDF cannot carry the resume, the Zeko report and the Evalground report as *openable files*. The ZIP holds one self-contained HTML dossier (prints to PDF with Ctrl+P), one XLSX summary, and an `attachments/` folder. See §2.1 for the rejected alternatives. |
| 2 ✅ | **The HTML dossier is the primary artefact**, self-contained (inline CSS, inline logo as data-URI, **zero external requests**) | Opens in any browser on any machine with **no login and no internet** — that is the acceptance criterion on tracker row 5. Also survives being forwarded on. |
| 3 ✅ | **XLSX summary alongside it**, built with `xlsx` (already a backend dependency) | The recruitment team works in Excel (the Evalground bulk sheet, the Interview Evaluation Format). Costs almost nothing to emit both, and removes the "PDF or Excel?" argument from the critical path. |
| 4 | **Redaction is a whitelist, not a blacklist** | A new column added to `rpa_cv` must be invisible to the pack until someone consciously adds it. Same construction as `serializeRecording()` in `interviewRecording.service.js:55`, and for the same reason. |
| 5 | **Access = recruiter-tier and above** (`recruiter`, legacy `hr`, `admin`, `superadmin`); vendors refused | Identical to recording access (INTERVIEW-RECORDINGS-PLAN §0.4). "Final decision-makers" (Sanghamitra, Abhijit) are admin-tier accounts, so they are already covered — no new role is needed. Enforced by rank, not a role list. |
| 6 | **Every download is audited twice** — a `rpa_processing_log` row *and* a note on the journey's stage timeline | This is bulk PII leaving the building, by design, to a person with no ATS account. The audit is the only control that survives the file. Mirrors `logRecordingView()` (`interviewRecording.service.js:160`). |
| 7 ✅ | **Recordings ship as an expiring, no-login share link — never as bytes** | An MP4 round is hundreds of MB; three rounds would make the pack unmailable. **HR chose the share-link end state (14-day expiry)**, so §6.5 is in scope rather than optional. Phase 1 still ships the honest interim ("recordings exist — ask the recruiter"). |
| 8 | **Zeko / Evalground reports are best-effort in Phase 1** | Zeko gives us a `reportlink` URL, not a file (`rpa_zeko_interview_results.reportlink`). Evalground has **no per-candidate report storage at all today** — that is a separate P0 item (§4.2), confirmed by HR as the next item after this one. The pack degrades honestly rather than failing. **Zeko resolved 2026-09-03 (§6.6):** its report PDF is unreachable to us, so the pack carries a no-login share link to the report instead — which also means it cannot be expired or revoked, see §11 item 3. |
| 9 ✅ | **CTC, vendor identity and offer/commercial terms are stripped** | Tracker row 5 says so explicitly, and HR confirmed. The full list is §8.2. |
| 10 ✅ | **Candidate contact details included by default**, removable per download | HR: yes. Implemented as a ticked-by-default checkbox in the download modal (§7.3). |
| 11 ✅ | **Collected personal documents are opt-in, not forbidden** — off by default, recruiter ticks consciously, **and the tick is recorded** | HR chose this over our recommendation to exclude them outright. The recording half is not optional: the audit row and timeline note must name **which attachment categories** were included, or "someone ticked the box" is unanswerable after the fact. See §8.4. |
| 12 ✅ | **The pack asks the recipient to delete it after 30 days** | HR: yes to the request; the period was not specified, so 30 days is assumed — change it in one place (`READ-ME.txt` template) if HR says otherwise. |
| 13 ✅ | **A dossier may be generated for any journey state**, including rejected and closed | HR: "ALL". No gating on `final_outcome` / `closed_at`. The pack states the journey's current status plainly so a reader is never misled about a candidate who is no longer in process. |

### 2.1 Format alternatives considered and rejected

| Option | Why not |
|---|---|
| **Single PDF** | Needs a new dependency (`pdfkit` / `puppeteer`); `puppeteer` pulls a ~170 MB Chromium into the deploy. And a PDF still cannot carry the resume as a re-openable `.docx`/`.pdf` attachment — you would flatten it and lose it. Kept as a *derived* output: the HTML prints to PDF. |
| **XLSX only** | The narrative parts — consolidated interviewer feedback, per-round comments, HR round free text — read terribly in a spreadsheet. And an external interviewer opening a spreadsheet to read prose is a poor first impression of the company. |
| **Emailing the pack from the ATS directly** | Explicitly declined on the call ("I don't want that through ATS"). The recruiter forwards it from their own mailbox so the reply thread lands with them. |
| **Tokenised public dossier web page** | Same rejection. Also fails "opens with no login" in spirit — it needs the internet and our server to be up, months later. |

---

## 3. Pack contents (proposed — tracker row 1)

```
AAPNA-ATS_Dossier_Pankaj-Mondal_Senior-Java-Developer_2026-09-02-14-32.zip
│
├── READ-ME.txt                     Confidentiality notice, who generated it, when,
│                                   what was deliberately excluded, retention ask.
├── Candidate-Dossier.html          ← primary. Self-contained. Ctrl+P → PDF.
├── Candidate-Summary.xlsx          ← same data, 4 sheets (§3.2)
└── attachments/
    ├── 01_Resume_Pankaj-Mondal.pdf
    ├── 02_Evalground-Assessment-Report.pdf (blocked on §4.2 — omitted until then)
    └── 03_Interview-Recordings.txt         (Phase 1: "ask the recruiter"; Phase 4: 14-day no-login links)
```

The Zeko report is **not** a file in `attachments/`, as this plan originally assumed. Its PDF does exist —
`interview-report` returns a `reportLink` pointing at Zeko's S3 bucket — but that object **403s to anyone but
Zeko's own session** (tested with no cookie, 2026-09-03), so it cannot travel inside the pack as a file.
Instead the **assessment is rendered into section 6 of the HTML** with compensation stripped (§6.7), and an
opt-in no-login link to Zeko's own page sits beside it for the reader who needs the recording or the
transcript (§6.6).

### 3.1 `Candidate-Dossier.html` — section order

Ordered the way an interviewer reads: *who is this → what have others concluded → the evidence.*

| § | Section | Source |
|---|---|---|
| 1 | Header: candidate name, position, MRF ref, dossier generated-on / generated-by, **CONFIDENTIAL** banner | `rpa_shortlisted_candidates`, `rpa_mrf` |
| 2 | Candidate profile — experience, qualification, current company, location, notice period, LinkedIn, top 5 skills | `rpa_cv` (whitelisted, §8.1) |
| 3 | Position brief — role, mandatory skills, good-to-have, responsibilities, experience band | `rpa_mrf` (**no budget**) |
| 4 | Progress so far — stage-by-stage table: stage, outcome, decided on, decided by, reason, notes | `rpa_pipeline_stage_events` + `rpa_pipeline_stages` |
| 5 | **Consolidated interviewer feedback** — the summary passage that already exists | `buildConsolidatedFeedback()`, `interviewScorecard.service.js:695` |
| 6 | Per-round scorecards — skills table with ratings + remarks, recommendation, avg score, comments | `rpa_interview_scorecard` + `_skill` |
| 7 | Screening / assessment scores — Zeko (per round) and Evalground section scores | `rpa_zeko_interview_results`, `rpa_assessment_results` |
| 8 | Interview history — round, date, interviewer, held/no-show | `rpa_interview_schedule` |
| 9 | Recordings available — round, date, duration, how to request | `rpa_interview_recording` via `serializeRecording()` |
| 10 | Attachment index — what is in `attachments/` and what could not be fetched, **and why** | build-time manifest |

A section with no data renders as *"No records"* rather than vanishing. An interviewer must be able to tell
"there were no scorecards" from "the dossier forgot to include them" — the same failure the
Scorecard Report modal already guards against (`PipelineDrawer.jsx:3991-3999`).

### 3.2 `Candidate-Summary.xlsx` — sheets

1. **Summary** — `Section | Field | Value`, transposed, exactly the shape `mrfDetail.export.js` established for
   single-record exports and for the reason given in its header comment (a 60-column single-row sheet is unreadable).
2. **Scorecards** — one row per round × skill: `Round | Interviewer | Skill | Rating | Remark`.
3. **Stage History** — one row per pipeline event.
4. **Assessments** — Zeko + Evalground rows.

---

## 4. Where we are today (verified in code, 2026-09-02)

### 4.1 What already exists and can be reused

| Piece | State | Location |
|---|---|---|
| Per-journey aggregation (candidate + MRF + events + schedules + offer + Zeko) | ✅ | `pipeline.service.js:416` `getPipelineDetail()` |
| Per-round scorecards + overall avg/sum + consolidated feedback | ✅ | `interviewScorecard.service.js:601` `getCandidateScorecardReport()` |
| Recording metadata, already permission-safe (never exposes `graph_content_url`) | ✅ | `interviewRecording.service.js:55,84` |
| Evalground section scores per candidate | ✅ | `rpa_assessment_results` (schema:874) |
| Zeko report **link** per round | ✅ | `rpa_zeko_interview_results.reportlink` (schema:590) |
| Resume file URL | ✅ but SharePoint-authenticated | `rpa_cv.cvFileUrl`, written by `onedrive.service.js:337` |
| Collected candidate documents | ✅ | `rpa_candidate_documents.file_url` (schema:1040) |
| Export plumbing: row cap, audit row, `Content-Disposition`, rate limiter | ✅ | `exports/runExport.js`, `middleware/exportRateLimit.js` |
| Browser-side authenticated download (blob, filename, object-URL cleanup) | ✅ **works for ZIP unchanged** | `frontend/src/utils/downloadFile.js` |
| `xlsx` (workbook writing) and `adm-zip` (ZIP building) | ✅ already dependencies | `backend/package.json` |

### 4.2 Gaps that must be closed by this work

| Gap | Impact | Where handled |
|---|---|---|
| **No candidate-level export of any kind** — every existing export is list-shaped | The feature itself | §5, §6 |
| **`cvFileUrl` is a SharePoint web URL requiring a Microsoft login** | An external interviewer clicking it gets a login wall. The resume must be fetched server-side and put **inside** the pack. Probably already permitted via the existing `Sites.Selected` grant — needs a read test, not a new permission. | §6.3 — new `downloadDriveItem()` |
| **OneDrive item ids are discarded at upload** — only `webUrl` is stored | Forces read-back through the awkward `/shares/` URL-resolution route, and a renamed or moved file breaks the link | §6.3 — persist `item.id` + backfill |
| ~~**No per-candidate Evalground report file exists anywhere**~~ **Resolved 2026-09-03 — there is no such file to store.** Evalground exports one workbook per TEST with one ROW per candidate, and its `Public Report` link is truncated mid-id by the vendor's own exporter | The source file can never travel in a pack: it lists every other candidate who sat that test. So the import keeps the candidate's own row in full and §7 of the pack renders it — the §6.7 move, applied again | **`ASSESSMENT-REPORT-UPLOAD-PLAN.md` — BUILT.** The "Assessment report upload" item as originally framed is closed, not deferred; a per-candidate file slot survives only as an optional fast-follow if HR turns out to want a hand-saved PDF |
| **No PDF/HTML generator, no ZIP writer wired up** | — | §6.1 (both deps already present) |
| **No redaction layer anywhere in the codebase** | Every current export assumes an internal audience | §8 |
| **`PipelineDrawer` never reads the current user's role** | The button cannot be gated client-side today | §7.2 |
| **`getCandidateScorecardReport()` returns `hr_current_ctc` / `hr_expected_ctc`** (`interviewScorecard.service.js:422-434`) | Straight CTC leak into the pack if reused naively | §8.2 |

---

## 5. Backend — aggregation endpoint (tracker row 2)

### 5.1 New files

```
backend/src/services/candidateDossier.service.js    aggregation + redaction (the model)
backend/src/exports/candidateDossier.export.js      HTML + XLSX + ZIP rendering (the view)
backend/src/utils/dossierRedaction.js               the whitelist + the guard (pure, unit-testable)
backend/src/utils/zekoShareLink.js                  Zeko report-URL parsing + share URL (pure, §6.6)
backend/src/utils/zekoReportModel.js                the screening assessment, redacted (pure, §6.7)
backend/src/tests/dossierRedaction.test.js          node --test
backend/src/tests/candidateDossier.test.js          node --test

frontend/src/components/pipeline/DossierDownloadModal.jsx   the "what will be shared" dialog (§7.3)
```

**Schema changes follow the established convention** — hand-written DDL in `prisma/ddl/`, then
`npm run prisma:pull` + `prisma:generate` to regenerate `schema.prisma`. This project does **not** use
`prisma migrate` (see the 15 existing files in `prisma/ddl/`, e.g. `2026-09-01-interview-recordings.sql`).
A `.README.md` accompanies the substantial ones.

```
prisma/ddl/2026-09-XX-onedrive-item-ids.sql          Phase 2 — item id columns + backfill notes (§6.3)
prisma/ddl/2026-09-XX-recording-share-links.sql      Phase 4 — rpa_recording_share_link (§6.5)
prisma/ddl/2026-09-XX-recording-share-links.README.md
```

Split model/view deliberately: the redaction rules must be unit-testable **without** a database or an Express
app, the same constraint `csvExport.js` documents in its header (`npm run test:unit`).

### 5.2 Routes

Added to `backend/src/routes/pipeline.routes.js`, **nested under `/:id/`** so registration order cannot capture
them (the note already on `/:id/conversations`, `pipeline.routes.js:77-81`):

```js
/** GET /api/pipeline/:id/dossier — JSON preview of exactly what the pack will
 *  contain, post-redaction. Feeds the "what will be shared" modal so the
 *  recruiter sees the redaction before the file leaves the building. */
router.get('/:id/dossier', pipelineController.getCandidateDossier);

/** GET /api/pipeline/:id/dossier/download?format=zip|html|xlsx
 *  The pack itself. Rate-limited with the CSV exports — it is heavier than any
 *  of them (Graph round-trips for every attachment). */
router.get('/:id/dossier/download', exportLimiter, pipelineController.downloadCandidateDossier);
```

Both inherit the router-wide `authenticate` → `requireStaff` → `checkModuleAccess('recruitment_pipeline')`
chain already at `pipeline.routes.js:10-15`. That is the whole of decision #5 — **no new middleware**, and a
vendor is refused by rank before the module toggle is even consulted (see the M6 note in `middleware/auth.js:174-193`).

### 5.3 Query plan

One `getPipelineDetail()`-shaped read plus five scoped reads, all by `pipeline_id` (every one of them has an
index — `idx_interview_schedule_pipeline`, `idx_interview_recording_pipeline`, `idx_assessment_results_pipeline`):

```
rpa_candidate_pipeline  → + rpa_shortlisted_candidates + mrf + stage_events(+reasons,+users)
rpa_cv                  → whitelisted profile columns only (never SELECT *)
rpa_interview_schedule  → all rounds
rpa_interview_scorecard → + _skill, submitted + outstanding
rpa_assessment_results  → + rpa_assessment_imports (test name, section labels)
rpa_zeko_*              → per-round results, matched by candidate email (see the
                          RCA note at pipeline.service.js:499-513 — pipeline_id alone
                          returns another candidate's report link)
rpa_interview_recording → metadata via serializeRecording()
```

`rpa_offers` is **read and then dropped** — it is loaded by `getPipelineDetail()` today, and the dossier builder
must not simply forward that object. Offer terms are commercial (§8.2).

Reuse, don't re-derive: `getCandidateScorecardReport()` and `buildConsolidatedFeedback()` are called as-is and
their output passed through the redactor, rather than re-querying scorecards here. One scoring rule, one place.

---

## 6. Generating the pack (tracker row 3)

### 6.1 Assembly

```
buildDossierModel(pipelineId, { include })      → redacted plain object  (service)
  ↓
renderDossierHtml(model)                        → string, self-contained (export)
renderDossierWorkbook(model)                    → Buffer via xlsx        (export)
collectAttachments(model, { include })          → [{ name, buffer, note }]
  ↓
packDossierZip(...)                             → Buffer via adm-zip
  ↓
sendPack(res, buffer, filename)                 → Content-Disposition, no-store, nosniff
```

`sendPack()` is a sibling of `sendCsv()` (`csvExport.js:226`) and buffers rather than streams, for the reason
that function documents: a mid-request throw after bytes are on the wire produces a **truncated ZIP that still
opens** — silent data loss in a file whose whole purpose is completeness.

**Row cap does not apply.** One candidate is one candidate. The relevant limit is total pack size — §6.4.

### 6.2 The HTML: self-contained by construction

- All CSS inline in one `<style>`; no CDN, no webfont, no `<img src="http…">`.
- Logo embedded as a `data:` URI.
- Nothing that needs JavaScript. It must render in a mail client's preview pane and in a browser with no network.
- `@media print` rules so Ctrl+P gives a clean PDF with page breaks between sections.
- Every value HTML-escaped at render. Candidate-supplied free text (resume-parsed fields, scorecard remarks)
  reaches this file, so the escape is a real XSS boundary, not decoration — the same threat model that made
  `csvExport.js` grow an injection guard (`csvExport.js:31-56`).

### 6.3 Attachments — fetching bytes out of SharePoint

New in `backend/src/services/onedrive.service.js`, next to the existing upload helpers:

```js
/**
 * Fetch a drive item's BYTES, app-only, so the file can travel INSIDE the pack.
 * rpa_cv.cvFileUrl is a browser URL behind a Microsoft login — handing it to an
 * external interviewer produces a login wall, not a resume.
 *
 * Preferred:  GET /users/{owner}/drive/items/{itemId}/content   (by stored id)
 * Fallback:   GET /shares/{base64url(webUrl)}/driveItem/content (legacy rows)
 */
export async function downloadDriveItem({ itemId, webUrl }) { … }
```

**Permission position (settled 2026-09-02).** `Files.Read.All` was requested and **declined by IT** — it
grants tenant-wide read of every SharePoint site and every employee's OneDrive and cannot be scoped. Correct
call; withdrawn, not being re-raised. IT's alternative is `Sites.Selected` scoped per folder, and per their
reply it is *"already configured and working for your and `recruitment` OneDrive on both HR_RPA and
HR_RPA_PROD"*.

**This almost certainly needs no new grant.** The two app registrations (`HR_RPA` staging /
`HR_RPA_PROD` production) carry **identical permission grants**, differing only in the mailbox each drives —
`pkmondal@aapnainfotech.com` and `recruitment@aapnainfotech.in` respectively. The ATS already *writes* to
these folders on both, and neither app holds `Files.ReadWrite.All` or `Sites.ReadWrite.All`, so those uploads
are running on the `Sites.Selected` grant with at least a **write** role — which includes read. The one thing
not visible from the portal is the exact site-level role, so **first action is a read test, not a request**;
see `CANDIDATE-DOWNLOAD-IT-PERMISSION-REQUEST.md` §1.

*(Correcting an earlier note in this plan: `Sites.Selected` does reach a personal OneDrive — a OneDrive for
Business account is backed by a SharePoint personal site. The claim that it covered team sites only was
wrong, and it was the reason the broader permission was requested at all.)*

**Read by item id, not by URL.** `uploadFileToOneDrive()` already receives the full `item` from Graph and
throws away `item.id`, keeping only `webUrl`. Persist the id at upload time in new nullable columns beside
`rpa_cv.cvFileUrl` and `rpa_candidate_documents.file_url`; legacy rows resolve once through `/shares/` and
backfill. Better independent of permissions — an item id survives a rename or move, a webUrl does not.

**Storage location is still worth revisiting later.** Both resumes and the recording archive live in a
personal OneDrive, which MS-GRAPH-SETUP-FOR-IT.md §3a flags as deleted at offboarding. Moving to a dedicated
SharePoint library remains the right long-term answer — but it is now a *durability* argument, not a
permissions one, and it is out of scope here.
- **Degrade, never fail.** A fetch that 403s/404s/times out does not fail the download. The attachment is
  skipped, the manifest records *"Resume could not be attached — <reason>. Ask the recruiter."*, and the
  response carries `X-Dossier-Degraded: true` so the UI can warn (same pattern as `X-Export-Degraded`,
  `runExport.js:121`).
- **Absence is not failure** (fixed 2026-09-03). `collectAttachments()` writes a note for both — "no resume is
  on file for this candidate" and "the file could not be read" — and `applyAttachments()` was treating the
  presence of a note as evidence of a problem. Result: every download for a candidate with no resume warned
  *"a file could not be attached"*, which is both untrue and the exact confusion §3.1 exists to prevent. The
  collector now returns `failed[]` naming the keys that actually failed, and only those set the degraded flag.
  Same fix applied to personal documents, where "this candidate has submitted none" was likewise being
  reported as a failure.
- Per-attachment timeout (10s) and an overall attachment budget (30s) so one dead file cannot hang the request.

### 6.4 Size limits

| Limit | Value | Behaviour on breach |
|---|---|---|
| Single attachment | 25 MB | Skipped, noted in the manifest |
| Whole pack | 40 MB | Largest attachments dropped in priority order (recordings → documents → assessment reports → resume never dropped), each drop noted |

Both as `config.dossier.*` env-backed values, alongside `config.exports.*` (`config/index.js:468-480`).
40 MB is above the ~25 MB Outlook attachment ceiling on purpose — the recruiter is told when a pack exceeds
20 MB so they can share it via OneDrive link instead.

**The warning — BUILT 2026-09-03.** `packSizeNotice()` (`utils/dossierModel.js`, pure and unit-tested) decides;
the download sets `X-Dossier-Oversize: <MB>` when it fires; `downloadFile()` reads it and the modal warns with
the size, the consequence and the way out. The threshold stays server-side and travels in the header rather
than being duplicated in the frontend, where it would drift the first time somebody changed the env var. The
header is on the CORS expose-list — without that it would silently never fire on staging or production, which
are cross-origin, exactly the failure that list's own comment was written about.

To test it without a 20 MB candidate: set `DOSSIER_WARN_PACK_BYTES=10000` in `.env`, restart, download any
pack. Put it back afterwards.

### 6.5 Recording share links (decision #7 — HR confirmed, 14-day expiry) — BUILT 2026-09-03

**What shipped**, against the design below: `rpa_recording_share_link`
(`prisma/ddl/2026-09-03-recording-share-links.sql`); `utils/recordingShareModel.js` holding the pure
expiry/revocation decision; `services/recordingShare.service.js` (mint-or-reuse, list, revoke, resolve, audit);
a public, unauthenticated `routes/recordingShare.routes.js` mounted at `/api/recording-share` beside the
scorecard and document token routes; `middleware/shareRateLimit.js` keyed on token + IP; the pack's section 9
rendered as a play button per round with the expiry stated; `recording_no_login_link(n)` in the audit; and a
**Shared recording links** list in the drawer with a Revoke button, a Copy button and an "opened unusually
often" flag.

Two things came out differently from the sketch below, both deliberate:

- **The token serves a PAGE, not bytes.** `GET /api/recording-share/:token` returns a small self-contained
  player page and `…/stream` serves the video. A single route streaming an MP4 would drop a 400 MB download
  into an interviewer's Downloads folder with no context, no expiry notice and no way to explain a dead link.
- **A view is counted on the page open, not per byte range.** A player seeking through an hour of interview
  issues dozens of requests; counting each would leave a timeline nobody reads and a `view_count` that means
  nothing. The stream route still re-checks the token on every range, so a revoke bites mid-video.

The original design follows.

The pack carries, per recording, a URL that plays the interview **with no login** and stops working after
14 days. This is the single highest-risk surface in the feature: an unauthenticated URL to a video of a real
person. It gets designed like one.

**New table** `rpa_recording_share_link`:

| Column | Note |
|---|---|
| `token` | `gen_random_uuid()`, same construction as `rpa_interview_scorecard.token` (schema:967) — 122 bits of randomness, not guessable |
| `recording_id`, `pipeline_id` | **One link, one recording.** Never a link to "the candidate's recordings" — a leak must expose one round, not the set |
| `expires_at` | Default now + 14 days, from `config.dossier.shareLinkDays` |
| `created_by`, `created_at` | Who minted it, in which dossier download |
| `revoked_at`, `revoked_by` | Kill switch (see below) |
| `view_count`, `last_viewed_at` | Cheap abuse signal — a link opened 40 times is not one interviewer |

**New public route**, mounted like the scorecard and document token routes (`routes/index.js:34-37`), i.e.
outside the `authenticate` chain by design:

```js
// routes/recordingShare.routes.js — PUBLIC, token is the only credential
router.get('/:token', shareLimiter, streamSharedRecording);
```

Controls on that route:

- **Expiry and revocation checked server-side on every request**, never trusted from the URL.
- **Reuses `resolveStreamSource()`** (`interviewRecording.service.js:130`) so bytes still come from our
  archive first and the Graph URL never reaches the browser — the guarantee that file's header makes must
  survive being called from an unauthenticated path.
- **Range requests proxied** so the viewer can seek; `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`.
- **Its own rate limiter**, keyed on token + IP. The export limiter is per-user and there is no user here.
- **Every view logged** — timestamp, IP, user-agent — onto the journey's stage timeline via the existing
  `logRecordingView()` shape, attributed to "external viewer via share link" rather than a username.
- **Revoke from the drawer**: a "Shared links" list per candidate showing what is live, when it expires, how
  many times it has been opened, and a Revoke button. Without this, decision #7 has no undo.

**Production dependency — flag currently off.** `resolveStreamSource()` prefers our archived copy and falls
back to `graph_content_url`, the Teams original, which Graph stops serving roughly **60 days** after the
meeting. Archiving is implemented and runs (`jobs/interviewRecordings.js:318` `archiveRecordings()`), but it
is gated on `MS_RECORDING_ARCHIVE_ENABLED`, which is **`true` in development and staging and `false` in
production** (`.env.production:162`). Left off, a 14-day link minted on day 50 of a recording's life dies
mid-window and the interviewer sees a dead video.

> **Action:** turn `MS_RECORDING_ARCHIVE_ENABLED=true` on in production before this ships there, and confirm
> OneDrive headroom (~800 MB per recorded interview-hour across both copies — MS-GRAPH-SETUP-FOR-IT.md §3a).
> Staging needs no change. Verify the flag from the running server, not a script — see the note in
> `config/index.js` on import order.

### 6.6 The Zeko screening report (Phase 3 — BUILT 2026-09-03)

**The problem.** What we store per round (`rpa_zeko_interview_results.reportlink`) is Zeko's *recruiter*
report page — `https://app.zeko.ai/app/new-report?candidateId=…&jobId=…` — which is behind Zeko's login. Put
that in a pack and an external interviewer gets a sign-in wall, which is why Phase 1 carried only the fact
that a report existed (decision #8).

**What was tried and rejected.** The report payload carries `reportLink`, a direct S3 URL to the report PDF.
Fetching it with no session returns **403** (tested 2026-09-03), so the PDF cannot be pulled into
`attachments/` the way the resume is. Attaching it is not available to us at any permission we hold.

**What ships.** Zeko's own report page has a Share button that mints a public, no-login view of the same
report. The ATS now calls it server-side with the dashboard cookie it already holds:

```
GET {reportApiBase}/report/generate-link?candidateId=<c>&jobId=<j>[&responseId=<r>]
→ { "data": { "link": "6a8c3ad13618d4d5f8ed1607" } }
→ https://app.zeko.ai/app/shared-report?linkId=6a8c3ad13618d4d5f8ed1607
```

`generateZekoShareLink()` in `zeko.service.js`, with the URL parsing in `utils/zekoShareLink.js` so it is
unit-testable without the service's Outlook/OTP import chain. Four properties, all verified against staging
rather than assumed:

| Property | What was found |
|---|---|
| **Idempotent** | Repeated calls return the same link id — and the same id a recruiter's browser had minted by hand. Nothing to cache, nothing to clean up, no link sprawl on Zeko. |
| **`responseId` is optional** | `candidateId` + `jobId` alone return the same link, and both are parsed out of the URL we already store. The `responseId` form (recovered from the report's `screenRecording` URL, the only place it appears) is kept as a fallback. |
| **The stored cookie must be tried first** | `getDashboardCookieHeader()` validates against the dashboard *workflow* endpoint, which on staging refuses a cookie the report API happily accepts. Trusting that ping sent every download through a fresh OTP login — **38 seconds**, measured, inside a recruiter's click. The share path now uses the stored cookie optimistically and logs in only on a real 401/403: **1.6s**. |
| **Bounded** | `DOSSIER_ZEKO_LINK_BUDGET_MS` (20s) caps the whole step, because an OTP login is not abortable from inside. Past it the pack says "ask the recruiter" while the login completes in the background, so the *next* download works. |

Ids come from the round's stored report URL, read by `collectZekoExtras()` — which, like
`collectAttachments()`, reads its own locators rather than taking them off the model, so no login-walled URL
is ever on the object that gets rendered. Minting happens **only on download, never on the preview**: opening
the "what will be shared" dialog must not create public links to a candidate's report as a side effect of
looking.

**The disclosure this creates, stated plainly — and why the link is OFF by default.** The link opens the full
Zeko report to anyone holding it, with no login. Two properties make that more than a convenience:

1. **It is outside this pack's redaction.** The shared page renders Zeko's whole report UI — Overview, Meta
   Skill, Recruiter Screening, Proctoring, **Recording** and **Transcript** — and `&tab=` deep-links straight
   into any of them. None of §8 applies to any of it: the page is Zeko's, composed by them.

   **Confirmed in a private browser window with no session, 2026-09-03** (the shared view had to be checked
   in a browser: every guess at its data endpoint from the server returns 401). What a holder of the link
   sees:

   | Tab | What it shows | Pack's own rule |
   |---|---|---|
   | Recruiter Screening | `Current CTC — "The Candidate reported current CTC as 5 LPA"`, `Expected CTC — "The Candidate expects 7 LPA"` | §8.2 forbids CTC — decision #9, tracker row 5 |
   | Recruiter Screening (remarks) | `"5 LPA is within the 0–7 LPA preference range"`, `"Expected CTC of 7 LPA is within the 0–8.5 LPA preference range"` — **the MRF's own salary band** | §8.2 forbids `budget_min`/`budget_max`. This one is *our* commercial data, not the candidate's |
   | Transcript | The full interview, question by question, **with audio playback** | not in the pack at all |
   | Recording | The interview video, playable | decision #7 wanted recordings behind expiring, revocable links |
   | Header / Resume | Email and phone **masked**, Resume tab **padlocked** — Zeko does strip these on a shared link | decision #10's contact toggle survives |

   So the link honours the contact-detail decision and breaks the compensation one, in both directions —
   the candidate's salary *and* the range we hire that role at.

   **The §10.3 leak scan cannot catch any of it**: the scan greps the pack, and the pack is clean; the
   exposure is on the page the link opens.
2. **We cannot expire or revoke it.** Unlike the recording share links of §6.5, which are ours, this one lives
   on Zeko's side and their API offers no withdrawal.

So it ships as an **opt-in, off by default** — the same construction as personal documents (decision #11),
which is this codebase's established shape for "HR allowed it, and the deterrent has to live in the
interaction". Ticking it expands a warning naming exactly what the linked page can show and that the ATS
cannot withdraw it; the checkbox is hidden entirely for a candidate with no Zeko report; and the audit records
`screening_report_no_login_link(n)` — deliberately not the same word as `screening_scores(n)`, so a later
review can tell which packs actually put a candidate's report, transcript and CTC in front of an outsider.
See §11 item 3 and §12.

### 6.7 The screening assessment, rendered INTO the pack (Phase 3 — BUILT 2026-09-03)

The answer to §6.6's problem, and now the default. We already fetch Zeko's report **as JSON** on every score
sync, so the pack does not need to send the reader anywhere: the same assessment is rendered into section 6 of
`Candidate-Dossier.html`, under our own redaction, in a file that works offline and cannot be withdrawn from
under the reader months later.

`getZekoReport()` (`zeko.service.js`) fetches it; `buildZekoReportSection()` (`utils/zekoReportModel.js`,
pure and unit-tested) decides what may appear.

**What travels:** the fit verdict and percentage, the requirement-by-requirement table (what the candidate
said, and Zeko's assessment of it), red flags, the summary, strengths, concerns, recommendation, and the
communication/thinking ratings.

**What is dropped, and how:**

| Dropped | Mechanism |
|---|---|
| `Current CTC`, `Expected CTC`, and the `"0–7 LPA preference range"` remarks | **Two guards.** By parameter NAME (`/ctc\|salary\|compensation\|package\|remuneration\|stipend\|pay/`) and again by VALUE — any text matching CTC/LPA/lakhs/salary/in-hand. The names are free text in Zeko's console, so a recruiter renaming "Expected CTC" to "Package expectation" tomorrow must not open a hole; the same list-plus-pattern construction as `dossierRedaction.js` |
| The verbatim transcript (`interview_questions`) and its per-question S3 audio links | Never read. It is where the compensation exchange lives word for word |
| `evidence` on every soft-skill dimension | Never read — a direct quotation of the candidate is a transcript in miniature, and it is where `"My current CD is 5 LPA and I am expecting 7 LPA"` actually turned up |
| `proctoringData` / `cheatingProbability` | Never read. An AI-generated suspicion about a real person should reach an outsider by an explicit HR decision, not as a side effect |
| Contact fields, vendor URLs, `userId`, IP location | Never read; governed elsewhere in the pack |

**Two honesty rules the section enforces, both learned from the real payload:**

1. **The vendor's counts are reported unaltered.** Zeko assessed 14 requirements and the candidate met 13; two
   were withheld here, and the section still says *13 of 14 met* while separately noting *3 items removed*.
   Recomputing the ratio over what survived would restate Zeko's own assessment, and an interviewer holding a
   Zeko screenshot would find two different numbers for one interview.
2. **A skipped skill is not a weak skill.** Zeko marks a skill it had no chance to observe as
   `status: "skipped"` — and then stamps `overall_rating: "weak"` on it anyway. Six of nine skills on the
   staging report were skipped. The pack prints *"Not assessed in this interview"* with Zeko's own reason,
   never the rating; passing "weak" through would tell an interviewer that a real candidate reasons poorly
   when the truth is the AI never asked them anything requiring it. Same principle as refusing to print an
   unconfirmed interview as "did not happen" (§3.1).

**Verified end to end against the real staging journey, 2026-09-03:** fetch 2.1s; verdict "Strong Fit", fit
94%, "13 of 14", 12 requirements rendered, 2 CTC parameters and 1 salary-quoting soft-skill summary withheld,
6 skills shown as not assessed; and an automated grep for `CTC`, `LPA`, `preference range`, `salary` and
`lakhs per annum` over the **packed ZIP bytes** came back clean apart from the pack's own redaction notice.

**Defaults.** This is ON (`screening_detail=1`); the §6.6 share link stays OFF. The safe half is the one that
happens by itself, and the half that leaves our control needs a conscious tick — the pattern decision #11
already established for personal documents.

---

## 7. Frontend (tracker row 4)

### 7.1 Service

```js
// frontend/src/services/pipeline.js
getDossierPreview(id)              → GET  /pipeline/:id/dossier
downloadDossier(id, params, cfg)   → GET  /pipeline/:id/dossier/download
```

`downloadFile()` (`utils/downloadFile.js:76`) is used unchanged — it is content-type agnostic and already
handles blob-error unwrapping, RFC 5987 filenames and object-URL cleanup. Only `fallbackName` changes
(`'AAPNA-ATS_Candidate-Dossier.zip'`).

### 7.2 The button

Placed in `PipelineDrawer.jsx` immediately beside the existing **Scorecard report** button
(`PipelineDrawer.jsx:2234-2245`) — same header block, same visual weight. That is where someone already goes
to read the candidate's evidence.

Gating: `PipelineDrawer` does not read the user today, so add `const { user } = useAuth()` and show the button
only for rank ≥ recruiter, mirroring `ROLE_RANK` from `backend/src/config/roles.js`. **UI gating is
convenience only** — the server is the authority (`requireStaff` on the router). Stated here because the
tracker row says "restricted to recruiter and final decision-makers", and it must be clear that the restriction
is not a hidden button.

### 7.3 `DossierDownloadModal.jsx` (new, `components/pipeline/`)

Not a bare download button. One click, one file, sent to someone outside the company — the recruiter should see
what they are sending first.

- **Include** checkboxes: resume ✓ · candidate contact details ✓ (decision #10) · assessment reports ✓ ·
  recording share links ✓ · **collected personal documents ✗ off by default** (decision #11).
- The documents checkbox is not a bare tick. Ticking it expands an inline warning naming what it will attach
  (ID proof, payslips, education certificates) and stating that the choice is recorded against the recruiter's
  name. HR chose opt-in over exclusion; the deterrent has to live somewhere, and this is where.
- **Format**: ZIP (default) · HTML only · Excel only.
- A short, plain-language panel: *"Compensation details, vendor/source information and offer terms are removed
  from this pack. It opens in any browser without a login."* — so redaction is visible, not a silent surprise.
- When recording links are included: *"Anyone with this file can watch the recordings for 14 days, without
  logging in. You can revoke the links at any time."* — plus a link to the Shared links list (§6.5).
- On confirm: `downloadFile(...)`, success toast, warning toast when `X-Dossier-Degraded` is set.

---

## 8. Redaction (tracker row 5)

### 8.1 Whitelist — the only candidate fields that may appear

`rpa_cv`: `Name`, `PositionApplied`, `HighestQualification`, `graduationdegree`,
`graduationspecialization`, `postgraduationdegree`, `postgraduationspecialization`,
`TotalExperienceYears`, `LastCompanyExperienceYears`, `CurrentCompany`, `CurrentLocation`,
`Top5KeySkills`, `NoticePeriod`, `LinkedInProfile`, `PreferredShift`,
`EnglishCommunicationRating`, `employment_history`.

Contact details (`EmailID`, `ContactNumber`) are **included by default but individually toggleable** in the
modal — an interviewer usually needs to reach the candidate, but a recruiter who is scheduling it themselves
may not want to hand the details over. ✅ HR confirmed 2026-09-02: **included by default** (decision #10).

Anything not on this list does not reach the pack, including columns added to `rpa_cv` after this is written.

### 8.2 Explicitly forbidden — asserted by test, not only by omission

| Source | Fields | Why |
|---|---|---|
| `rpa_cv` | `CTC_LPA`, `ExpectedCTC_LPA`, `ExpectedCTCNumeric` | **CTC** — tracker row 5 |
| `rpa_cv` | `vendorName`, `VendorEmail`, `JobSource`, `RecruiterInfoAAPNA`, `lockForNinetyDays` | **Vendor / sourcing** — tracker row 5 |
| `rpa_cv` | `cvMissingToken`, `cvMissingTokenStatus`, `MetaData`, `missingData` | Live credential + internal plumbing |
| `rpa_candidate_pipeline` | `source`, `vendor_email` | Vendor identity |
| `rpa_mrf_jd_send` | `budget_min`, `budget_max` | Commercial |
| `rpa_interview_scorecard` (HR card) | `hr_current_ctc`, `hr_expected_ctc` | CTC, arriving via `HR_TEXT_FIELDS` (`interviewScorecard.service.js:430-431`) |
| `rpa_offers` | whole record | Offer terms, joining date, remarks |
| `rpa_pipeline_stage_events` | `notes` + `reason_text` **on the `offer` stage only** | **Found by the leak scan against staging, 2026-09-02.** Dropping the `rpa_offers` record does not stop the timeline narrating the same terms in free text: the ATS writes *"Offer recorded as shared — proposed joining 2026-12-01"*, and **26 of 66** offer-stage notes in staging carried a joining date. No other stage had a single flagged note, so the exclusion is keyed on the stage (`COMMERCIAL_STAGE_KEYS`) rather than by scanning text for money-shaped words — a word scan would fail a download because someone wrote "discussed package expectations" on a technical round, and would still miss a date phrased differently. The offer **row and outcome are kept**, so decision #13's "state the status plainly" still holds. |
| `rpa_interview_recording` | `graph_content_url`, `archive_item_id`, `teams_web_url` | Authenticated URLs; already excluded by `serializeRecording()` — keep it that way |
| all | `token`, `*_token`, session ids | Credentials |
| **outside the whitelist's reach** | the page a **Zeko share link** opens (§6.6) — confirmed to show the candidate's current and expected CTC, the MRF's own salary band, the transcript with audio and the interview recording, with no redaction of ours applied to any of it. Hence off by default, ticked consciously, and audited under its own category. The whitelist governs what the pack *contains*; it cannot govern what a link *points at*. |
| forward-looking | **referral flag** (P1 item, not built yet) | Sanghamitra, 23:33–26:08: the referral status must not reach interviewers. Add to this table when the field lands, so the dossier is not the hole in that rule. |

### 8.3 The guard

`dossierRedaction.js` exports a `assertNoForbiddenFields(model)` that walks the finished model and throws if any
forbidden key **name** or a CTC-shaped value is present. It runs in dev/test always, and in production behind
`config.dossier.assertRedaction` (default on — the cost is one walk of a small object).

Belt and braces on purpose: the whitelist is the mechanism, the assertion is what makes a future regression fail
loudly in CI instead of quietly in a stranger's inbox.

### 8.4 Recording what left, not just that something left (decision #11)

HR allowed personal documents as an opt-in rather than excluding them. That choice is only defensible if the
system can answer *"which candidate's payslip went to whom, and who decided that?"* months later. So the audit
rows carry the **contents**, not merely the event:

```
rpa_processing_log.logMessage:
  dossier: pipeline 4821; included=[profile, contact_details, scorecards,
  assessments, resume, personal_documents(3), recording_links(2)];
  redacted=[ctc, vendor, offer]; format=zip; bytes=8342110
```

and the timeline note reads *"Candidate dossier downloaded by chhaya.k — including 3 personal documents and
2 recording share links"* rather than "dossier downloaded". A recruiter opening the journey sees it, which is
its own mild deterrent.

The share links minted by that download are joined to it by `rpa_recording_share_link.created_by` +
`created_at`, so a leaked recording can be traced back to the pack it came from.

---

## 9. Phasing

| Phase | Scope | Estimate | Depends on |
|---|---|---|---|
| **0** | ~~HR sign-off~~ **done**; ~~`Files.Read.All`~~ **declined by IT, withdrawn**; ~~read test against the existing `Sites.Selected` grant~~ — **✅ DONE 2026-09-02, PASSED.** File bytes read back app-only with no new grant. No IT action outstanding for staging. | ~~~1 hour~~ **done** | none |
| **1** | Aggregation endpoint, redaction + whitelist + guard, HTML + XLSX, ZIP with **no binary attachments**, content-level audit (§8.4), drawer button + modal | ~~4–5 days~~ **✅ BUILT 2026-09-02** — 189 unit tests pass; packs generated and leak-scanned against three real staging journeys (open, closed, and one with a recording) | none |
| **2** | Persist OneDrive item ids + backfill; resume and documents fetched into `attachments/` | ~~2–3 days~~ **✅ BUILT 2026-09-02** — 206 unit tests pass; a real resume verified inside a pack downloaded through the browser (`.docx`, byte-identical, opens). Backfill measured: **7.7s** first read via `/shares/`, **0.8s** thereafter by stored id. | re-run the read test against production before shipping there |
| **3** | Zeko report — **assessment rendered into the pack** (§6.7, on by default) **plus an opt-in no-login share link** (§6.6): ~~**✅ BUILT 2026-09-03**~~ — 238 unit tests pass; verified against a real staging journey, with the packed ZIP bytes grep-clean of CTC and the minted link opening with no session at all. **Evalground: ✅ BUILT 2026-09-03** — the import keeps the candidate's whole export row and §7 renders the written test in full (`ASSESSMENT-REPORT-UPLOAD-PLAN.md`); the vendor's spreadsheet itself is never attached, because it covers every candidate who sat the test | ~~1–2 days~~ **done** | none — the Evalground dependency dissolved once the export's real shape was read |
| **4** | Recording share links: new table, public token route, rate limiter, view audit, revoke UI (§6.5) | ~~3–4 days~~ **✅ BUILT 2026-09-03** — 320 unit tests pass, including the full expiry/revocation state machine and an assertion that no Graph or SharePoint URL can reach an unauthenticated caller. **Not yet exercised end to end**: needs the DDL applied and `prisma generate` | archive flag on in the target environment — still `false` in production |
| **5** | Test pass §10 + staging verification with a real hiring case | **In progress** — §10.1 (320 unit tests), §10.2a (28/28 against the live server) and the §10.3 leak scan **done 2026-09-03**; §10.2's 11 staging checks and the §10.3 disconnected-machine acceptance test still need a browser session. Checklist with expected results: `docs/test-plans/phase3-dossier-phase5-test-pass.md` | Phases 1–4 |

**Phase 1 alone satisfies the transcript.** Everything Sanghamitra asked to be shareable — what the candidate
"has cleared so far", the scorecards, the scores, the stage history — is database content, not files. Phases 2–4
are the polish that stops the interviewer having to ask for the resume separately.

Total to a shippable, complete feature: **~11–17 working days**, against the 3–6 weeks on the review sheet.
Both external dependencies that could have driven the upper number have now largely cleared: HR sign-off
landed same-day, and the file-access question resolved to grants that already exist (§6.3). What remains
outside our control is the **Evalground report upload** (Phase 3) and, for production only, the recording
archive flag (§6.5).

---

## 10. Testing

### 10.1 Unit (`npm run test:unit`, no DB)

- `dossierRedaction.test.js` — for each forbidden field in §8.2, a model containing it makes the guard throw.
  A model containing only whitelisted fields passes. **This is the regression test for tracker row 5.**
- `candidateDossier.test.js` — model → HTML renders every section; empty collections render "No records", never
  disappear; free text containing `<script>` and `"` is escaped; XLSX has the four sheets in §3.2.
- `candidateDossier.test.js` (Zeko assessment, §6.7) — the CTC parameters never reach the section, **nor does
  a renamed one whose text still carries a figure**; the transcript and its audio links are never carried; the
  `evidence` quotations are dropped while the ratings survive; Zeko's own counts are reported unaltered; a
  skill Zeko skipped is rendered "Not assessed", never "weak"; vendor free text cannot inject markup; and a
  payload with no screening evaluation yields null rather than an empty card.
- `candidateDossier.test.js` (Zeko link, §6.6) — both ids are read off a stored report URL and a half-parsed URL
  yields `null` rather than a request that could answer for another candidate; the minted link lands on the
  round it belongs to; the four manifest outcomes (linked / not requested / mint failed / no report exists)
  read differently; the audit records `screening_report_no_login_link(n)`; the link is escaped inside its
  `href`; and the HTML carrying a link still makes no external *request*, so the no-internet acceptance test
  in §10.3 still holds — a hyperlink waits to be clicked, it does not fetch.

### 10.2 Integration (staging)

1. Candidate at Tech 2 with two submitted scorecards, one Zeko score, one Evalground result, a resume, one recording.
2. `GET /pipeline/:id/dossier` → preview JSON contains no forbidden key.
3. `GET /pipeline/:id/dossier/download` → ZIP opens; HTML renders all ten sections.
4. Same call as a **vendor** account with `recruitment_pipeline` deliberately toggled ON → **403** (rank floor holds).
5. `rpa_processing_log` has the export row; the journey timeline has the download note.
6. Rate limiter: 21 downloads in 5 minutes → the 21st is refused with the friendly message.
7. Break `cvFileUrl` (point it at a deleted item) → pack still downloads, manifest explains, `X-Dossier-Degraded: true`.
8. **Personal documents opt-in (decision #11)**: download with the box unticked → no `attachments/` documents and
   the audit says so; download with it ticked → documents present **and** `rpa_processing_log` names the count
   and the recruiter, and the timeline note says the same (§8.4).
9. **Closed journey (decision #13)**: a rejected candidate produces a pack, and the pack states the journey is closed.
10. **Zeko assessment (§6.7)**: download for a candidate with a screening round → section 6 of the HTML sets
    out the verdict, the requirement table, strengths, concerns and the communication ratings; grep the
    unzipped tree for `CTC`, `LPA`, `preference range` and `salary` → **no hit outside the pack's own
    redaction notice** (verified 2026-09-03). Untick the box → section 6 carries the scores only, and the
    manifest says it was the recruiter's choice.
11. **Zeko share link (§6.6)**: download for a candidate with a screening round → the HTML's section 6 carries
    a `shared-report` link; open it in a private window with **no Zeko session** → the report renders.
    Untick the box → no link anywhere in the pack, and the manifest says it was the recruiter's choice, not a
    failure. Invalidate the stored Zeko cookie → the download still completes within the budget and the
    manifest says "ask the recruiter" (**verified 2026-09-03**: degraded cleanly at 20s rather than hanging
    for the 38s an OTP login takes).

### 10.2a Share links (§6.5) — RUN 2026-09-03, 28/28 PASS

Executed against the running server with no ATS session: a live link streamed a real recording as
`206 bytes 0-2047/1501627` (`video/mp4`), expired and revoked links were refused with byte-identical bodies, a
link revoked mid-use stopped on the next range request, the open was counted and written to the timeline with
the viewer's IP and no internal attribution, and the limiter tripped. Three throwaway links were created and
deleted; the audit note was deliberately left. Full results and evidence:
`docs/test-plans/phase3-dossier-phase5-test-pass.md` §2.

Item 2 below is satisfied **structurally** — the URL carries only the token, so there is no recording id to
swap. Item 8 is **not tested**: it needs a genuinely aged recording, and faking one means mutating a real row.

The checklist as designed:

1. A minted link plays in a browser with **no session at all** — private window, no ATS cookie, no token.
2. The link is for **one** recording: swapping the recording id in the URL does not reach another round.
3. Past `expires_at` → refused. Clock is server-side; changing the client clock does nothing.
4. Revoked from the drawer → refused **immediately**, not at next expiry.
5. Each play writes a timeline entry with IP and user-agent, attributed to the external viewer.
6. Rate limiter trips on repeated hits against one token from many IPs.
7. `graph_content_url` never appears in any response body or redirect — assert it, since the whole guarantee in
   `interviewRecording.service.js` now has an unauthenticated caller.
8. With `MS_RECORDING_ARCHIVE_ENABLED=false` and a Teams-original older than 60 days → the link fails
   *cleanly* with a "recording no longer available, contact the recruiter" page, not a Graph error dump.

### 10.3 The acceptance test on tracker row 5 — "opens outside the ATS with no login"

Run on a machine with **no ATS session and the network disconnected**:

1. Unzip. Double-click `Candidate-Dossier.html`. It must render fully — no broken images, no blank sections.
2. Ctrl+P → the PDF is legible and paginated.
3. Open `Candidate-Summary.xlsx` in Excel. All four sheets present.
4. **Automated leak scan — BUILT 2026-09-03**: `backend/scripts/dossier-leak-scan.mjs`, run as
   `npm run dossier:leakscan -- <pack.zip> --ctc 18,26 --vendor "Acme Staffing" --other "Other Candidate"`.
   Exit code 1 on any finding, so it can gate a release. Verified against a deliberately leaky pack (CTC,
   vendor and another candidate's name inside a scorecard comment): 6 findings, exit 1; and against a clean
   pack: exit 0.

   Two properties that make it usable rather than shelf-ware:
   - **The pack's own redaction notice is not a leak.** The footer and READ-ME literally say "Current and
     expected compensation (CTC)" was removed, so a naive grep fires on the sentence promising there is none.
     Those lines are stripped first, and they are *imported from* `dossierRedaction.js` rather than restated,
     so the scan follows the wording instead of going stale.
   - **Attachments are listed, not scanned.** `attachments/` holds the candidate's own resume and documents,
     included by design. A resume that says "Current CTC: 18 LPA" is the candidate's sentence about
     themselves; failing on it would get the scan switched off within a week. What is scanned is what *we*
     composed — the report, the workbook, the manifest, the READ-ME.

   The workbook is parsed and its sheets stringified rather than grepped as bytes: an `.xlsx` is itself a zip,
   so a byte grep finds nothing and the "Spreadsheet only" format would go unchecked.
5. Repeat for a **vendor-sourced** candidate — that is the case where a leak is most likely and most damaging.

---

## 11. Open questions — CLOSED 2026-09-02 (tracker row 1)

All eight answered; see `CANDIDATE-DOWNLOAD-HR-QUESTIONS.md` for the record and §2 for the resulting
decisions. Summary: ZIP pack · contact details in by default · CTC/vendor/offer stripped · personal documents
opt-in with the tick recorded · recordings as 14-day no-login links · delete-after-30-days request in the
pack · dossier allowed for any journey state · Evalground upload sequenced next.

**Three items HR still owns, none blocking development:**

1. **Deletion period** — HR agreed to the request but did not name a period. 30 days assumed; one-line change.
2. **Candidate recording notice** — candidates are told their interview is recorded and reviewed internally.
   A 14-day external share link goes beyond that wording. Raised with HR (see the HR note); the fix is a
   wording change on the candidate-facing notice, not code. **Worth settling before the share links go live in
   production**, since it is the kind of thing that is awkward to correct retrospectively.
3. **The Zeko report link is outside the pack's redaction, and cannot be revoked** (new, 2026-09-03 — §6.6).
   HR asked for the Zeko report in the pack (decision #8), for CTC to be stripped (decision #9, tracker row 5)
   and for recordings to sit behind expiring, revocable links (decision #7). Confirmed in a no-session browser
   (§6.6): the shared page shows the candidate's current and expected CTC, the salary band the role is being
   hired against, the transcript with audio and the video recording — with no login and no way for us to
   withdraw it. Those decisions cannot all hold at once. **Resolved by splitting the two:** the assessment
   itself is rendered into the pack under our redaction and is on by default (§6.7) — which is what "include
   the Zeko report" most plausibly meant — while the link to Zeko's own page is a named opt-in with the
   exposure at the tick and in the audit. What HR needs to confirm is whether that opt-in link should exist at
   all or be removed; removing it is deleting one checkbox, and the assessment still travels either way. Worth
   putting to them alongside item 2, since it is the same question about the same candidates.

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| **The pack leaks something after the fact** — it is a file, outside our control forever | Whitelist + asserted guard (§8.3) + automated leak scan (§10.3) + double audit (decision #6). No control exists after the file leaves; all of it must be before. |
| File read access is refused outright (`Files.Read.All` already declined; `Sites.Selected` read test could still fail) | Phase 1 ships without binary attachments and is still useful: the HTML names the resume and says to ask the recruiter. The fetch helper degrades on 403 by design, so access arriving later is a **config event, not a code change**. |
| Evalground upload slips | Attachment slot exists and stays empty with an honest manifest line. No rework when it lands. |
| **A Zeko share link leaks — and it routes around the redaction** (§6.6) | The one no-login surface here that is **not** ours to revoke, and the only route by which CTC, contact details and the interview transcript can leave inside a pack that says they were removed. Reduced by: **off by default**, an expanded warning naming the exposure at the tick, the tick hidden where no Zeko report exists, an unguessable link id, a confidentiality line in the READ-ME, and an audit category (`screening_report_no_login_link`) distinct from "scores were included". **Not eliminated** — a no-login link is bearer-authenticated, and the page behind it is Zeko's to compose, not ours. The remaining mitigation is to drop the checkbox entirely: §11 item 3, HR's call. |
| Pack too large to email | Size budget (§6.4) with a warning above 20 MB, and priority-ordered dropping rather than a failed download. |
| Someone downloads dossiers in bulk | `exportLimiter` (20 / 5 min / user) + per-download audit rows make a sweep visible in `rpa_processing_log`. |
| **A recording share link leaks** — forwarded mail, mail archive, compromised inbox — and is watched by someone it was never meant for | The accepted cost of decision #7. Reduced by: unguessable token, one link per recording, 14-day expiry, server-side revocation from the drawer, per-view logging with IP, and a dedicated rate limiter. **Not eliminated** — a no-login link is by definition bearer-authenticated. Revocation is the control that matters; it must be visible in the UI, not an API call only. |
| **Personal documents attached to a pack that then leaks** | Off by default, an expanded warning at the tick, and the choice recorded against a named recruiter (§8.4). We advised excluding them entirely; HR chose opt-in, so the residual risk is accepted and logged rather than designed away. |
| Archive flag off in production → share links die mid-window | §6.5 action item: flip `MS_RECORDING_ARCHIVE_ENABLED` before Phase 4 ships to production, and confirm OneDrive headroom. |
| The dossier becomes the de-facto external interviewer portal | It is a file, by design. If the ask returns, it belongs in a separate plan with its own access model — do not grow a token page onto this one. |
