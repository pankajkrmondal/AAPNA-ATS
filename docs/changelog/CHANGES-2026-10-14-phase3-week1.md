# Phase 3 "Do Now", week 1 (Release 1): quick wins and the hot item

**Date:** 14 Oct 2026 · **Plan:** [PLAN-Phase3-Now.md](../Phase%203%20Enhancements%20or%20Feedback/PLAN-Phase3-Now.md) §4.C / D / E, week 1 of §2.
**Items:** N44 (hot), N32, N26, N16, N33, N25, N27, N31, N20, N19, N23, N30, N24; N40 is an admin action.
**Status:** built and tested locally against a throwaway database; not yet on staging. Nothing is committed.
**Screens:** every UI change was agreed on a design mockup first ("Phase 3 Week-1 UI mockups").

---

## What changed, by item

### N44 · Missing-details completed: bell alert and dates (hot)
- **DDL** `backend/prisma/ddl/2026-10-14-cv-details-dates.sql` (+ rollback): `rpa_cv.details_requested_at` and `details_completed_at` (timestamptz), a partial index on the completed date, and a backfill of the requested date from the earliest `data_collection` / `missing_jd` row in `rpa_email_log`. Completed dates start on release day (no reliable history).
- **Request date:** `sendMissingDataEmail` stamps `details_requested_at` when the email is sent, first time only (`COALESCE`).
- **Completion** (`submitPublicMissingData`), first full completion only:
  - sets `details_completed_at`;
  - closes the candidate's open `data_collection` / `missing_jd` rows in `rpa_email_log` (`responded_at`), so reminders stop;
  - rings the bell for every active staff user (new type `candidate.details_completed`; vendors never), e.g. "Asha Verma completed their missing details · Java Developer · requested 02 Oct 2026 · responded in 12 days". The link opens their live pipeline card, else the candidate page.
  - Partial submissions and later re-submissions change nothing and notify nobody.
- **Reminder backstop:** `reminderSkipReason` closes a candidate row whose status is `RECEIVED`.
- **Bug fixed on the way:** a resume uploaded through the missing-details form never saved its full text or technical terms (`resumeData` was used before its `const` declaration; the ReferenceError was logged as "OpenRouter parsing failed"). Those candidates were invisible to resume-text search.
- **Search Candidate:** Date added, Details requested and Details completed columns, and a "Details completed in" filter (Today in IST / Last 7 / Last 30 days) that lists newest completions first. The CSV export carries the filter and both dates. API: `GET /api/candidates?completedWithin=today|7|30&sort=detailsCompletedAt`.
- **Not changed (decision 3):** the reminder job still only reminds the legacy `missing_jd` type, so ATS-sent requests (`data_collection`) are never reminded. Turning that on would remind the whole backlog at once; RT to confirm first.

### N32 · Approver email wording
- "This request was also sent to **Sanghamitra Roy (CHRO)**. The first decision is final." (`approverNoteHtml` in `utils/mrfApprovalRules.js`).
- The staging roster now carries the production names and titles on the test mailboxes (`prisma/seed-email-recipients.js`).

### N16 · MRF approval: "already approved by the CEO <Name>"
- The approver roster (`rpa_settings.mrf_approvers`) takes an optional `title`.
- An **expired** personal link on an MRF that is already decided now shows the decision instead of "Link inactive": "MRF has already been approved by the CEO Abhijit Roy", with date, comment and a note that the link has expired. Only a link signed by us for that MRF gets this; forged or foreign tokens keep the old errors and reveal nothing. An expired link still cannot decide (409 naming who decided).
- The decided page now says "MRF" and shows the reference, e.g. ".NET Developer (MRF-41)".

### N33 · Skip guard
- The server refuses to skip a mandatory stage (400 "This stage is mandatory and cannot be skipped."), both on `POST /pipeline/:id/advance` and when approving with a skip. Moving a candidate on without an outcome counts as a skip, whatever the `skip` flag says.
- A skip asked for on a non-optional next stage used to be silently ignored; it is now refused.

### N24 · CEO round optional
- **DDL (data)** `backend/prisma/ddl/2026-10-14-ceo-round-optional.sql` (+ rollback): `rpa_pipeline_stages.is_optional = true` for `ceo`. Seed updated.
- Approving can now jump a run of optional stages: HR Round → Documents past CEO Round and Client Interview (`skip_to_stage_key`). The approve dialog lists every reachable stage and pre-selects from the MRF ("CEO round No", "Client round No").
- **Audit trail:** one `skip` event at the landing stage, noting every stage bypassed (`Skipped optional stages ceo (…), client (…)`). Not one per bypassed stage: a `skip` row means "arrived here", and analytics counts it as an arrival.

### N25 · Approve without score
- When the round's score is not on file (Zeko result, assessment result, or a submitted scorecard for interview rounds), the approve dialog says "Approve without score" and needs a note of at least 10 characters. The server enforces the same rule (`utils/stageScore.js`), so scripts and jobs are held to it too. The assessment auto-approve already writes a long note.

### N27 · Date Added
- Search Candidate "Date added" column, and an "Added on <date>" line on screening cards (both tabs). "–" when the row has no date.

### Review fixes, 15 Oct
- **Search Candidate layout (design re-approved):** the page uses the full content width (the 1200 px cap left ~120 px unused per side); the four search fields and Search / Reset share one row; every header is one line; cells use 8 px side padding and small header type; the actions are icon buttons. At ~1800 px with the nav open every column fits with no sideways scroll; on narrower screens the table scrolls rather than squeezing.
- **"Added within" on the old keyword search:** the keyword form offers it whatever `SCREENING_V2` says, but the old search (flag off, the default) dropped it, so "Last 30 days" listed candidates added in June. It now applies the strict search's rule on both of its paths: created within N days, undated candidates excluded. Test: `integration/legacyAddedWithin.test.js` (no-keyword path; the keyword path needs pgvector, check it on staging).
- **JD screening, bare "NET" on an MRF (section A rules):** an MRF listing "NET, DOT NET, C#" parsed into three required skills, and bare "NET" matched no profile, so the MRF matched nobody ("0 have all 3 mandatory skills"). On the MRF side only, "NET" now means .NET and collapses with "DOT NET"; candidate text is unchanged (so "net salary" never counts as .NET). `MRF_SKILL_FIXES` in `utils/jdScreeningRules.js`; unit test added; `docs/Screening-Rules-for-RT.md` updated. After release, press Refresh on an affected MRF in JD Filtering: its result is cached for up to an hour.
- **Release order matters:** the backend build reads the two new `rpa_cv` columns, so DDL #6 must run before the build starts. Against a database without them, Search Candidate (and every candidate read) fails with "column rpa_cv.details_requested_at does not exist". Same for the CEO round: until DDL #3 runs, the approve dialog correctly offers no skip.

### N31 · Dark mode on public forms
- The five public token-link pages pin the whole document light while open (`pushForceLight` in `ThemeContext`), so dropdowns, date pickers, modals and toasts rendered on `<body>` are light too. The pre-paint script in `index.html` forces light on those paths. The pages use `App.useApp()` messages under their own light antd `App`. The user's own theme is untouched elsewhere.

### N19 · JD date and version
- `GET /api/screening/roles` lists every approved MRF (no more `DISTINCT ON`), with `ref`, `created_at` and `isLatest`. Labels everywhere: ".NET Developer · MRF-41 · 09 Oct 2026 · 2 openings" plus a Latest tag.
- The public missing-details form still lists each role name once (candidate-facing).
- Pipeline's Position filter has one entry per MRF (`positionOptions`, `position_mrf_id`), keyword shortlists listed separately.
- `mrf:updated` is broadcast when an MRF is edited or decided; open role dropdowns refresh.
- The Dashboard role filter keeps one entry per name until N36.

### N20 · QA Automation tag
- `GET /api/screening/roles?includeClosed=1` adds filled/closed MRFs after the open ones, flagged `closed` with date and reason. JD Filtering has an "Include closed MRFs" checkbox; a closed MRF can be searched, read-only (Shortlist and Reject off).

### N23 · Interviewer and interviewee
- The CEO round's interviewer comes from `ceo_panel_details` (it read the Yes/No `ceo_management_round`, so "Yes" was pre-filled as a name). "yes" / "no" / "na" are never names.
- The Schedule dialog has **Interviewee** (name, email, phone; read-only, with the staging redirect noted) and **Interviewer** (pre-filled from the last booking for the round, else the MRF, else blank) sections. Served as `interviewParties` on the pipeline detail.

### N30 · Pipeline popup crash
- **Not reproduced locally.** 53 open/close cycles in Playwright (after load, mid-load, with the outcome dialog and email editor open, deep links) produced no page error and no blank page. Recording deep links and the scorecard modal could not be exercised (no recordings locally).
- Defensive fixes shipped: the drawer stays mounted through its close animation instead of unmounting everything at once; error boundaries around the routes ("Something went wrong · Reload · Go to Dashboard") and around the drawer content ("This candidate could not be shown · Try again · Close"); the email editor ignores a deferred sync after unmount.
- If it recurs in production, the error screen and the console now show the cause; reporting arrives with N42.

### N26 · Interview host visibility
- Check list for one real production interview: [CHANGES-2026-10-14-interview-host-visibility-check.md](CHANGES-2026-10-14-interview-host-visibility-check.md).

---

## Tests
- **Backend unit:** 734 pass (new: `unit/missingDetails`, `unit/stageSkip`, `unit/interviewHints`; extended: `reminderEligibility`, `mrfApprovalRules`).
- **Backend integration** (local DB, `run-block.mjs`): new `missingDetailsCompleted` (3), `mrfApprovalExpiredLink` (4); `pipelineStageEngine` +5 cases (whole file passes); `pipelineClosure` + MRF-02. `schedulingAndScorecard`, `crossModuleE2E`, `jdGates`, `keywordFilters`, `referralSuppression` pass.
  - 19 existing approve calls in 5 integration files now pass a note (N25).
  - **Known, not caused by this change:** `pipelineClosure` PIPE-14 and part of `vendorNotification` hard-code a vendor lock date of `2026-10-03`, which has passed; four `vendorNotification` cases need Microsoft Graph credentials (blank locally by design). Run both on staging.
- **Playwright** (`frontend/e2e`): new `week1-ui.spec.js` (6), `pipeline-drawer.spec.js` (4), `public-forms-theme.spec.js` (7); section A `keyword-screening` (10) and `jd-screening` (3 of 4; one skipped, no results to export) still pass.
- **Build:** `vite build` passes.

## Release 1 steps
1. **Back up** production (`docs/deployment/PHASE3-PRODUCTION-DEPLOYMENT.md` Step 0).
2. **DDL, staging first**, each with `--dry-run` then for real:
   ```
   cd backend
   node scripts/run-ddl.mjs --env .env.staging --expect-db recruitmentautomationdb --file prisma/ddl/2026-10-14-cv-details-dates.sql --dry-run
   node scripts/run-ddl.mjs --env .env.staging --expect-db recruitmentautomationdb --file prisma/ddl/2026-10-14-cv-details-dates.sql
   node scripts/run-ddl.mjs --env .env.staging --expect-db recruitmentautomationdb --file prisma/ddl/2026-10-14-ceo-round-optional.sql --dry-run
   node scripts/run-ddl.mjs --env .env.staging --expect-db recruitmentautomationdb --file prisma/ddl/2026-10-14-ceo-round-optional.sql
   ```
   Production: the same with `--env .env.production --expect-db recruitmentautomationdbProd`. Release the CEO-optional DDL with this backend build, not before.
3. **Prisma:** `schema.prisma` was edited by hand for the two `rpa_cv` columns. Stop the server and worker, run `npm run prisma:pull && npm run prisma:generate`, and confirm `git diff prisma/schema.prisma` shows no change beyond those two lines.
4. **Approver titles (N16), roster only.** Do NOT re-run `seed-email-recipients.js` on production: it overwrites every `email_recipients.*` key. Check the current roster, then add the titles to the same entries:
   ```sql
   SELECT value FROM rpa_settings WHERE key = 'mrf_approvers';
   UPDATE rpa_settings
   SET value = '[{"email":"aroy@aapnainfotech.com","name":"Abhijit Roy","title":"CEO"},{"email":"sroy@aapnainfotech.com","name":"Sanghamitra Roy","title":"CHRO"}]'
   WHERE key = 'mrf_approvers';
   ```
   On staging: the same, with the `hmopuri@` / `saukumar@` emails.
5. **Count candidates with no Date Added** (for this record):
   `SELECT count(*) FILTER (WHERE "createdAt" IS NULL) AS no_date, count(*) AS total FROM rpa_cv;`
   Result: production ______ of ______.
6. **Deploy**, then run on staging the integration files for the touched areas (above) and RT UAT.
7. **Tell RT:**
   - candidates who complete the missing-details form now ring the bell and stop getting reminders;
   - the CEO round is optional; HR Round can go straight to Documents;
   - approving a round with no score needs a short note;
   - MRF dropdowns now show every MRF with its reference and date.
8. **N26:** run the production check list on the next real interview.
9. **N40 (admin):** close the stale MRFs (e.g. Business Development Services, T Snap Project One) from MRF → Close with a reason; close Samriddhi's wrong-JD journey with "Closed – tagged in error"; create the HRD logins (Susmita, Subhajit) as recruiters.

## Rollback
- `2026-10-14-ceo-round-optional.rollback.sql` (deploy the previous build first or at the same time).
- `2026-10-14-cv-details-dates.rollback.sql` (after the previous build is live; completion dates recorded since release are lost).
- Roster: put back the value from step 4's `SELECT`.
