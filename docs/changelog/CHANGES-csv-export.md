# CSV Export across the app — "Export Functionality wherever required (Phase 2)"

Punch-list item from the 2026-08-07 session (see item 17 in
`CHANGES-2026-08-07-candidate-pipeline-fixes.md`).

**Scope agreed before starting:** every real list screen · CSV only (no xlsx,
no PDF) · generated server-side · always the full filtered result set, never
just the page on screen.

---

## The problem

There was effectively no export in the product.

- **Backend: zero export endpoints.** No `Content-Disposition`, `res.download`
  or `text/csv` anywhere in `backend/src`. `xlsx@0.18.5` was a dependency but
  used read-only, for *importing* (`hrUpload.service.js`,
  `assessmentImport.service.js`).
- **Frontend: exactly one export**, `MRF.jsx` `handleExportCSV()` — client-side
  and hand-rolled, with five real defects:
  1. silently capped at `limit: 1000`;
  2. **no UTF-8 BOM**, so Excel mangled every non-ASCII name;
  3. `URL.revokeObjectURL` never called — a leaked blob per click;
  4. `String(null)` wrote the literal text `null` into cells;
  5. no CSV-injection guard, on data that comes from LLM-parsed candidate
     resumes.

Every other list surface — Pipeline, Screening, Candidates, the upload queues,
Analytics, Email Delivery, Admin — had no way to get data out at all.

Business context: `docs/phase3/MEETING-NOTES-2026-07-14.md:127` records that
the sponsor lost a previous ATS *and its backup*, and
`docs/phase3/03-DEVELOPMENT-PLAN.md:182` had already elevated "a scheduled
CSV/Excel export of core tables" from a nice-to-have to a tracked deliverable.

---

## 1. Shared CSV writer — `backend/src/utils/csvExport.js` (new)

Dependency-free and pure, so it unit-tests without a DB or an Express app.
`buildCsv(rows, columns)` · `csvFilename(base)` · `sendCsv(res, csv, filename)`.

No new npm package. `xlsx` can write CSV but emits no BOM and has no injection
guard, so it would have needed wrapping anyway; a correct RFC 4180 writer is
~60 lines.

Handles every type this codebase actually produces:

| Concern | Behaviour |
|---|---|
| Excel encoding | UTF-8 BOM prefix (written as `﻿`, not a literal — an invisible character in source is one careless save from vanishing) |
| Row terminator | `\r\n` (RFC 4180 §2.1) |
| Quoting | **every** field quoted, `"` → `""` — no comma, quote, CR or LF can break a row |
| `null` / `undefined` | empty cell, never the text `null` |
| `BigInt` | `.toString()` — the global JSON replacer in `app.js` only covers `res.json()` |
| Prisma `Decimal` | its own `toString()` (would otherwise be `[object Object]`) |
| Dates | `YYYY-MM-DD HH:mm` in a **fixed** `Asia/Kolkata`, not server-local, so staging and production format the same instant identically |
| Booleans | `Yes` / `No`, matching the UI |
| Arrays / JSON | `; `-joined / `JSON.stringify` |

**Two bugs the tests caught during development**, both now locked in:

- `new Date(null)` is **the epoch, not Invalid Date** — a null timestamp column
  was exporting as `1970-01-01`. `toDate()` now guards the empties explicitly.
- The first injection guard used the full OWASP lead-character set
  (`= + - @ TAB CR`). Correct in the abstract, wrong in practice: the guard
  prepends an apostrophe, **and Excel displays that apostrophe when it opens a
  CSV**. Every Indian phone number was rendering as `'+91 8340625432`, on every
  row of every export. Now `= @ TAB CR` are always guarded, while a leading
  `+`/`-` is guarded only when the value is not purely numeric-looking — a
  string of digits and separators cannot reference a cell or call a function.
  `+91 8340625432` exports clean; `+91 call me =SUM(A1)` still gets guarded.

`sendCsv` **buffers** rather than streams, deliberately: `catchAsync` hands a
mid-request throw to `errorHandler`, which calls `res.status().json()`. Had we
streamed, a failure mid-export would deliver a **truncated CSV that opens
perfectly well** — silent data loss.

**Known limitation, documented not hacked:** a bare 10-digit phone is shown by
Excel as a number on double-click, so a leading zero would be lost. Forcing
text needs `="…"`, which is a formula — exactly what the guard exists to stop.
The file is correct; Excel's Data → From Text/CSV importer preserves it.

`backend/src/tests/csvExport.test.js` — 26 tests covering all of the above.

## 2. Orchestrator — `backend/src/exports/runExport.js` (new)

One code path for every export, so the row cap, the audit row and the logging
cannot drift per-endpoint.

- **Row cap** `config.exports.maxRows` (default 25,000, `EXPORT_MAX_ROWS`).
  `fetch` is asked for `max + 1`; if the extra row comes back the request is
  **refused with 413** — *"…would contain more than 25,000 rows. Narrow the
  filters and try again."* — and no file is sent. Never silently truncate;
  that was precisely the old MRF bug.
- **Audit**: one `rpa_processing_log` row per export (`source: 'CSV_EXPORT'`,
  `Success` | `Blocked`, actor email, role, path, row count, and the filters
  with `token`/`password` stripped). Bulk PII egress is what gets asked about
  after the fact. Best-effort `.catch(() => {})` — an audit failure must never
  turn a working export into a 500. This is the first real use of that table's
  `actor_email` / `actor_context` columns.
- One `logger.info` per export with rows / bytes / ms.

## 3. Infrastructure

- **`app.js` CORS `exposedHeaders`** — the block had none. Dev worked (Vite
  proxies same-origin) but **staging/production would have named every download
  `export.csv`**, a bug that only appears after deploy. Now exposes
  `Content-Disposition`, `X-Export-Row-Count`, `X-Export-Degraded`.
- **`backend/src/middleware/exportRateLimit.js`** (new) — 20 exports / 5 min,
  keyed on **`req.user.id`, not IP** (the office shares one address, so an
  IP-keyed limiter would let one person lock out the team). The global
  2000/15min limiter is untouched.
- **`config.exports`** — `maxRows`, `rateWindowMs`, `rateMax`, all env-overridable.

## 4. Frontend — one mechanism, not twelve copies

- **`frontend/src/utils/downloadFile.js`** (new) — `responseType: 'blob'`, a
  300s timeout (the 120s default is too tight for the keyword export, which
  re-runs embeddings + rerank), `Content-Disposition` parsing preferring
  `filename*`, and `URL.revokeObjectURL` **on the next macrotask** (a
  synchronous revoke aborts the download in Safari; not revoking at all was the
  old behaviour).
  It also unwraps blob errors: `api.js`'s interceptor normalises every error to
  `{status, message, data}` where `data` is a `Blob` when `responseType` is
  `blob`, so `.message` is undefined and users would have seen *"Request failed
  with status code 500"*. It now reads the blob back as text.
  **Deliberately not** `window.open('…?token=' + jwt)`: `authenticate` does
  accept a query token, but morgan logs the URL — that writes live JWTs into
  the access log.
- **`frontend/src/components/common/ExportButton.jsx`** (new) — loading state,
  disabled at zero rows, row-count success toast, error toast, and a
  `Modal.confirm` above 2,000 rows. Styling copies the old MRF button.

## 5. Endpoints and screens

| Screen | Endpoint |
|---|---|
| MRF | `GET /api/mrf/export` |
| Search Candidate · Dashboard · Vendor Dashboard | `GET /api/candidates/export` |
| Candidate Pipeline | `GET /api/pipeline/export` |
| Analytics — 4 pipeline tables | `GET /api/pipeline/analytics/export?table=…` |
| Analytics — Role Summary | `GET /api/screening/analytics/pipeline/export` |
| Candidate Screening — JD tab | `POST /api/screening/roles/:id/export` |
| Candidate Screening — Keyword tab | `POST /api/screening/keyword-export` |
| HR Manual Upload | `GET /api/hr-upload/jobs/export` |
| Vendor Manual Upload | `GET /api/vendor/jobs/export` |
| Email Delivery — 2 tables | `GET /api/email/monitoring/export?table=…&days=…` |
| Admin Users | `GET /api/admin/users/export` |
| Admin Companies | `GET /api/admin/companies/export` |

Each `/export` is **registered before `/:id`** in its router — otherwise
`BigInt('export')` runs and 500s. Same guard the codebase already applied to
`/analytics`. Each inherits its router's existing auth/module guards and adds
`exportLimiter`.

**Query code is shared, never duplicated:** `buildMrfWhere` /
`attachApprovalStatus` are now used by both the MRF list and its export;
`buildWhereClause` was exported from `candidate.service.js` and the sort
mapping extracted into `resolveSortField()` so `search()` and the export order
rows identically.

**Columns mirror each screen, with two deliberate divergences** (documented in
each export module): status columns carry the **displayed label** rather than
the raw DB value (`managersubmitted` → `MANAGER SUBMITTED`; stage keys → stage
labels read from the admin-editable `rpa_pipeline_stages`), and money columns
carry **raw numbers** rather than the `₹` formatted string, so they still SUM.

**Pipeline columns are designed**, since the board renders cards: candidate,
role, stage, stage status, latest outcome + reason + notes, decided by/on,
final outcome, source, days in stage, concurrency. It runs its own query
because `listPipeline` takes the last event of *any* type (usually "entered
next stage"), not the outcome. It honours the board's own filters exactly,
including hiding closed journeys unless `include_closed`.

**The "Other" reason rule is enforced** (`03-DEVELOPMENT-PLAN.md` §M1,
2026-07-14 meeting notes): when a reason is free-text "Other", the CSV carries
the **typed text** — the literal word "Other" never appears.

**Screening exports re-run the search server-side and never accept a
client-supplied candidate list** — that would be an exfiltration path into
arbitrary `rpa_cv` rows, bypassing every screening filter. The JD tab runs with
`force=false` so it hits the Redis cache the on-screen search just wrote.

**`SELECT *` is never used.** Each export has a narrow column allowlist, so
`resume_full_text`, `MetaData`, `ai_profile_insights`, `password_hash` and the
pgvector columns cannot reach a file even by accident. This matters: 
`candidateService.search()` selects all ~80 `rpa_cv` columns, which is fine for
a 20-row page and hundreds of MB unpaginated — hence a separate
`findAllForExport()`.

---

## Risks fixed as part of this work

**R1 — vendor isolation hole (pre-existing, now closed on both doors).**
`GET /api/candidates` is guarded by `authenticate` only, and `searchCandidates`
read `vendorEmail` straight off the query string with no role check. **A
vendor-role token could omit it — or name another vendor — and page through the
entire candidate table.** An unpaginated export on top of that would have made
it a one-click full-database dump.
New `enforceVendorScope(filters, user)` in `candidate.service.js` overwrites
`vendorEmail` from the session for vendor callers, and is called by **both the
list endpoint and the export**, so the two cannot drift. Verified over HTTP: a
vendor gets 1 row with no param, still 1 row when spoofing another vendor's
address, where a superadmin gets 195.

**R2 — route shadowing.** `/export` registered before `/:id` everywhere;
asserted programmatically across all 9 routers.

**R3 — `buildWhereClause` clobbering (pre-existing, fixed).** Each filter group
assigned onto a bare object, so `search` **overwrote** the name/email/phone
`OR` entirely and `position` fought `filterPosition` over `PositionApplied`.
Combining a search term with a name filter silently dropped the name and
returned *more* rows than asked for. Now every group is AND-composed, so each
filter can only narrow. Verified: `search=a` → 195 rows; `search=a` +
`name=zzz-no-such-name` → 0 (previously still 195).
⚠️ **This changes the existing Search Candidate screen's behaviour** — in the
strictly-correct direction (a filter you typed now actually applies).

**R4 — analytics top-N.** Stuck candidates, rejection reasons and vendor
performance are `.slice(0, 10)` on screen; recent failures is `take: 20`. A
10-row CSV is useless for the analysis someone exports in order to do, so a
`topN` option was threaded through `getPipelineAnalytics()` and the exports
pass `topN: null` for the **complete** ranked list. The screen keeps its top 10,
and the success toast says so explicitly rather than leaving the difference to
be discovered.

**R5 — keyword export re-runs the AI.** It re-embeds and re-ranks via Cohere,
can take ~a minute, and can degrade to an unranked list. The export sends the
identical filter body, sets `X-Export-Degraded: true` when it degrades, and
`ExportButton` raises a **warning** toast instead of a success one.

**R6 — `rpa_upload_jobs` may be missing from the generated Prisma client.**
Both list controllers guard on it; the exports degrade identically — a
headers-only CSV with a 200, never a 500.

**R7 — phone numbers in Excel.** Documented, not hacked (see §1).

**R8 — CORS `exposedHeaders`.** Fixed (see §3).

**R9 — two export routes were `authenticate`-only (found in a follow-up audit).**
`/api/mrf/export` and `/api/email/monitoring/export` inherited routers with no
role or module gate, so **any** logged-in principal could reach them — including
a `vendor`, who is an external company. The MRF export carries
`budget_min`/`budget_max` for every requisition (commercially sensitive), and
the email-failures export carries candidate `recipient_email` and subject lines
(other people's PII). Vendors have no UI route to either screen, but
`VENDOR_ALLOWED_PATHS` is client-side confinement — their token calls the API
directly. Both routes now carry
`restrictTo('admin', 'superadmin', 'recruiter', 'hr')`. Verified by driving
`restrictTo` per role: vendor → **403**, every internal role → 200.
The underlying *list* endpoints (`GET /api/mrf`, `GET /api/email/monitoring`)
have the same pre-existing exposure and should get the same guard — not changed
here because the database was unreachable at the time and the change could not
be exercised end-to-end.

**R10 — `@codemirror/view` was an undeclared dependency (frontend).**
`EmailBodyEditor/EmailHtmlSourceEditor.jsx` imports it, but `package.json` never
declared it; it resolved only because npm hoisted it out of
`@codemirror/lang-html`'s subtree. That builds on a warm `node_modules` and
**fails on a clean `npm ci`**, or under a different npm version or pnpm/yarn,
with `Could not resolve "@codemirror/view"`. Declared explicitly at the version
already resolved (`^6.43.4`) and `package-lock.json` synced. An audit of every
bare import across both packages (228 source files) found no others.

---

## Verified

- `npm run test:unit` — **95 passing** (26 new).
- `npm run lint` — **177 problems, identical to the pre-change baseline**; zero
  net new. (The baseline is a config gap: eslint has no Node globals, so
  `process`/`Buffer`/`console` report `no-undef` repo-wide.)
- `npm run build` (frontend) — clean.
- Server boots with no route-shadowing errors; `/export` precedes `/:id` in
  every router (asserted programmatically).
- **All 12 endpoints exercised over real HTTP** against the dev database, with
  minted sessions for superadmin / admin / recruiter / vendor. Every one
  returned 200, a `efbbbf` BOM, a correct `Content-Disposition` filename, and a
  real `X-Export-Row-Count` (MRF 124 · candidates 195 · pipeline 20 · HR jobs
  71 · vendor jobs 31 · role summary 16 · admin users 9 · companies 1 · …).
- RBAC: no token → 401; admin → companies → 403; vendor → admin users → 403.
- Row cap: with `EXPORT_MAX_ROWS=5`, a 124-row export returned **413 with no
  body** and logged a `Blocked` audit row; a 1-row export still succeeded.
- Unknown `?table=` → 400 naming the valid options.
- Audit: 16 `CSV_EXPORT` rows written with correct actor, path and row counts.
- CSV content: no unquoted fields, no `"null"` cells from actual nulls, arrays
  semicolon-joined, phone numbers clean, and 196 physical lines for 195 rows
  (i.e. no row broken by an embedded newline).

## Observations, not fixed

- One candidate row (`id 205`) has the **literal string** `"null"` stored in
  `LinkedInProfile` — real data written by the resume parser, not a
  serialization bug. The export reports it faithfully; masking it would be the
  exporter lying about the database. Worth a data-quality pass separately.
- `rpa_mrf.filled_at` — referenced by `mrfClosure.service.js`,
  `dashboard.service.js`, `pipeline.service.js` and `screening.service.js`, but
  **present in neither the database nor `prisma/schema.prisma` nor the
  generated client**. Any Prisma-typed read of it throws
  ``Unknown field `filled_at` ``. The MRF export and `getMrfRequest` therefore
  do **not** select it and let `isMrfFilled()` fall back to its legacy
  `approval_status === 'closed'` test, which is correct for every row that
  exists today. Once the DDL lands and `prisma db pull && prisma generate` has
  run, add `filled_at: true` back to those two selects — `isMrfFilled()`
  already prefers it. **This is a pre-existing, undeployed migration, not
  something this change introduced.**

---

**Files — backend (new):** `src/utils/csvExport.js`,
`src/tests/csvExport.test.js`, `src/middleware/exportRateLimit.js`,
`src/exports/runExport.js`, `src/exports/mrf.export.js`,
`src/exports/candidates.export.js`, `src/exports/pipeline.export.js`,
`src/exports/pipelineAnalytics.export.js`, `src/exports/screening.export.js`,
`src/exports/uploadJobs.export.js`, `src/exports/emailMonitoring.export.js`,
`src/exports/admin.export.js`.

**Files — backend (changed):** `src/app.js`, `src/config/index.js`,
`src/services/candidate.service.js`, `src/services/pipeline.service.js`,
`src/controllers/` (`mrf`, `candidate`, `pipeline`, `screening`, `hrUpload`,
`vendor`, `emailTemplate`, `admin`, `company`), `src/routes/` (the same nine).

**Files — frontend (new):** `src/utils/downloadFile.js`,
`src/components/common/ExportButton.jsx`.

**Files — frontend (changed):** `src/pages/` (`MRF`, `Candidates`, `Dashboard`,
`Pipeline`, `CandidateScreening`, `HRUpload`, `VendorPortal`,
`VendorDashboard`, `Analytics`, `AdminDashboard`),
`src/components/email/DeliveryMonitoring.jsx`, and the matching service modules
under `src/services/`.
