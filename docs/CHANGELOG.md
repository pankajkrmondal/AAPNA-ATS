# Changelog

Reverse-chronological log of changes. One entry per change set, listing files touched and the what/why.
Feature-level detail lives in [docs/reference/screening.md](./reference/screening.md).

---

## 2026-08-24 — Zeko HR scores always synced as 0 (wrong API endpoint)
**Why:** Panmon attended his Zeko HR screening and scored **94**, but the ATS showed **0** —
in the pipeline drawer, on the card, and in View Candidate. The cron was faithfully storing
what it was told; it was asking the wrong endpoint.

Zeko keeps two different scores in two different fields, and which one is populated depends on
the interview type. The response flags it via `isHRScreeningPresent`:

| Interview type | `isHRScreeningPresent` | Score field | old endpoint |
|---|---|---|---|
| `screening-interview` (our HR round) | `true` | **`fitPercentage`** (94) | ✗ returns `interviewScore: 0` |
| `functional-interview` | `false` | **`interviewScore`** (83) | ✓ works |

`GET /api/v1/interview/<id>/results` only ever exposes `interviewScore`, which Zeko leaves at a
literal 0 for screening interviews — so **the HR round could never produce a real score**.
Confirmed on staging: all 5 screening interviews returned 0 for all ~50 candidates, while all 6
functional interviews returned real varied scores through the same call. That split is why some
candidates had believable numbers and every HR round showed 0.

- `backend/src/services/zeko.service.js` — `fetchInterviewResults()` now calls
  **`POST /dashboard/api/v2/pipeline/interview-responses`** (cookie auth, the same
  `getDashboardCookieHeader()` the job-catalog sync already uses; `dashboardApiBase` already
  pointed at the right host, so no config change). Body is snake_case
  `{ company_id, job_id, interview_id, page, limit }` — the endpoint 422s and names the fields
  if they are wrong. Paged at 100/request with the same MAX_PAGES guard as the job sync, and
  each interview is fetched **once** and reused across all its candidate rows.
- `pickZekoScore()` — reads `fitPercentage` for screening rounds, `interviewScore` for
  functional, each falling back to the other. Both land in `rpa_cv.ZekoInterviewScore` as
  requested. This fixes HR rounds **without disturbing the functional rounds that already
  worked** (Tushar's 83 is untouched).
- `ZEKO_NO_RESULT_STATUSES` — `slotMissed` / `leftInMiddle` / `notAttempted` / `scheduled` are
  now skipped instead of being written as 0. Recording 0 for a no-show is what made
  "never attended" read as "interviewed and scored zero".
- Screening rounds store `null` for coding/communication rather than the 0s the old endpoint
  returned — Zeko exposes no such split for them.
- `findResultForCandidate()` — accepts the new flat `candidateEmail` alongside the old nested
  `candidate.email`. The `rpa_cv` email fallback used the nested shape too and would silently
  never have fired.
- **Result rows are now updated in place**, not blindly inserted: a re-sync must be able to
  correct a wrong score, and blind inserts would stack duplicates (the table has no unique
  constraint, so the match is explicit on `pipeline_id` + `candidate_email`).
- `repairZeroZekoScores()` — **new**, one-off repair. Rounds synced before this fix are
  `status='completed'`, which the normal sweep skips, so their bogus 0 would survive forever.
  This re-reads completed rows through the new endpoint. Same code path as the cron, just a
  wider row set; safe to re-run.
- `backend/src/tests/unit/zekoScoreField.test.js` — **new**, 12 cases over the real captured
  payloads: screening reads `fitPercentage` and never the placeholder 0, functional keeps
  reading `interviewScore`, a *genuine* 0 is preserved in both directions, and no-show statuses
  never yield a score.
- **No scheduler change** — the hourly `ZEKO_RESULTS_CRON` already calls
  `fetchInterviewResults()`; it was changed from the inside.
- **Verified against live staging:** ran `repairZeroZekoScores()` — logged
  `correcting claudepankajmondal@gmail.com … 0 → 94`, and `rpa_cv.ZekoInterviewScore` went
  `0 → 94` with the result row corrected in place, not duplicated. `slotMissed` rows correctly
  recorded nothing. 202/202 unit tests pass.
- **Known, not a bug:** Haris M is skipped ("none match"). He has two bookings — his 75 lives on
  the *Junior Python QA* interview, which we **cancelled**; his active row points at the
  *Associate Accountant* interview where Zeko genuinely does not list him. He was re-booked but
  never added on Zeko's side, so skipping is correct.

### Follow-up — "View full report on Zeko" deep link
The endpoint switch above dropped `reportLink`: the old results endpoint returned one, the
responses endpoint does not, so the first repair run **overwrote Panmon's stored link with
null** and the drawer's link disappeared. Fixed in the same pass.

- `backend/src/services/zeko.service.js` — new `zekoReportUrl(candidateId, jobId)` builds
  `…/app/new-report?candidateId=&jobId=&tab=Overview` from `candidateId` (on the response entry)
  and the `zeko_job_id` we already store. This is the URL **Zeko's own Responses table opens**,
  and it is better than what it replaces: the old `shared-report?linkId=` was a static snapshot,
  whereas this is the candidate's live report page with the Recruiter Screening / Resume /
  Transcript tabs one click away. Returns null if either id is missing, so a broken link is
  never rendered, and falls back to any link already stored so a re-sync cannot blank a good one.
- `backend/src/config/index.js` — `reportLinkBase` (`ZEKO_REPORT_LINK_BASE`, default
  `https://app.zeko.ai/app/new-report`), matching how every other Zeko base URL is configured.
- **No frontend change.** `PipelineDrawer.jsx` already renders `zekoReportLink` as
  "View full report on Zeko" whenever the round has one; it had simply been fed null. The
  current-stage gate on that link is correct as-is — the backend only loads the current round's
  link, so passing it to a historical card would show the wrong round's report.
- **Verified on staging:** re-ran the repair — Panmon's row now stores
  `…new-report?candidateId=6a8bfcca5e57c481d6c906ee&jobId=69a15687abfe6f852d7d7d50&tab=Overview`,
  byte-identical to the URL in the browser. 205/205 unit tests pass, including 3 new cases
  covering the builder and its null guards.

---

## 2026-08-24 — Notification bell restored to the header
**Why:** the notification centre was fully built — DB table, service, 16 producer call sites,
REST routes, socket push, and a finished `NotificationBell` component — but **nothing rendered
it**, so the header had an empty gap where the bell belonged. The backend had been writing
notifications the whole time: staging holds **1,021 rows in `rpa_notifications`, every one
unread**, newest 2026-08-24 09:14. Nobody had ever read one, because there was no bell to open.

History: the bell was live at `2b8077a` ("First Upload"). `57ea00e` ("bugs fix", 17 Jun 2026
10:35) deliberately hid it — import and JSX both commented out, marked `Hidden as requested` —
alongside the dark-mode toggle, for the same reason. `861710f` (the rebrand, 17 Jun 2026 19:40)
then rewrote the header for the collapsible sidebar: it **restored the ThemeToggle but not the
bell**, deleting the commented-out JSX and leaving only a dead commented import. Nine hours
between hiding it and losing it.

- `frontend/src/layouts/MainLayout.jsx` — import uncommented; `<NotificationBell />` added to
  the header's right-hand `Space`, before `<ThemeToggle />`. **Two lines, one file** — this was
  the only break in the chain.
- **Nothing else changed.** Verified present and working end to end beforehand:
  `rpa_notifications` (+ `idx_notifications_user_created`), `notification.service.js`
  (`notify`/`list`/`unreadCount`/`markRead`/`markAllRead`), `notification.controller.js`,
  `notification.routes.js` mounted at `/api/notifications`, `emitToUser()` + the `user:${id}`
  socket room, `notificationService.js`, `getSocket()`, and the `--gold` / `--gold-subtle` /
  `--border-light` tokens in both light and dark. The response shape
  (`success(res, {items, unread})` → `res.data.data`) already matched the component's `select`.
- **Known on first load, not a bug:** the four staffed accounts carry 197–282 unread each, so
  the badge opens at AntD's `99+` over a backlog reaching early August. Left as-is by decision —
  the popover's built-in "Mark all read" clears it in one click, and no data was written.
- `git log -S 'NotificationBell'` does **not** find `57ea00e`: commenting a line out leaves the
  occurrence count unchanged. Searching the `Hidden as requested` marker is what surfaced it.
- **Verified:** `npx vite build` clean — 4103 modules, only the pre-existing >500 kB chunk warning.

---

## 2026-08-24 — Zeko round showed another candidate's score and report link
**Why:** Haris M's HR Screening (Zeko) round read "0 Interview" and its "View full report on
Zeko" link opened **Samarth Tiwari's** report (a different person's name, email and scores).
Both symptoms were one bug, and it is a cross-candidate data leak, not just a wrong number.

`rpa_zeko_interview_results.pipeline_id` holds Zeko's **interview** id, which belongs to the
*job* — every candidate booked against that job shares it, and the table therefore holds one row
per candidate under the same `pipeline_id`. The drawer's lookup filtered on `pipeline_id` alone
and took `orderBy: created_at desc`, so it returned whichever candidate had synced most recently.
On staging this mis-attributed **5 of 11** non-cancelled Zeko pipeline rows.

- `backend/src/services/pipeline.service.js` — the `rpa_zeko_interview_results` lookup in
  `getPipelineDetail()` now also matches `candidate_email` against the candidate's own
  address(es), case-insensitively. When we hold no address for them the round reports no result
  rather than guessing. This feeds both `zekoScores` (the chips) and `zekoReportLink` (the
  report link), so one filter fixes both symptoms.
- `backend/src/utils/emailMatch.js` — **new.** `emailCandidates()` splits a stored address column
  into comparable addresses; `rpa_shortlisted_candidates.candidate_email` and `rpa_cv."EmailID"`
  sometimes hold several joined with commas ("a@x.com, b@y.com") while Zeko reports the single
  address the interview was booked against, so plain equality misses the match.
- `backend/src/services/zeko.service.js` — its private copy of that splitter (used by
  `findResultForCandidate()`, which already scoped the *write* side correctly) now imports the
  shared helper, so both sides of the sync identify a candidate the same way.
- `backend/src/tests/unit/zekoResultAttribution.test.js` — **new**, 8 cases pinning the
  regression: a stranger's row on the same interview is never returned, the candidate's own row
  still is (including when Zeko reports a different letter case), multi-address columns match,
  and a null address matches nothing rather than everything.
- **No frontend change.** `PipelineDrawer.jsx` renders whatever the API attributes to the round;
  it was fed the wrong row.
- **No data cleanup needed.** The five legacy result rows (all synced 2026-06-13, before
  `findResultForCandidate()` replaced the n8n-era `data[0]`) are each internally consistent —
  right name, right email, right report link — they were only ever reachable by the wrong
  candidate. With the email filter they resolve to their own candidate only.
- **Verified:** replayed the old and new queries against staging across every non-cancelled Zeko
  pipeline row — 5 leaks before, 0 after, and no row that legitimately had its own result lost
  it. Haris M's round now reads "Awaiting Zeko to sync the score" (his window closed 24 Aug
  6pm IST and nothing has synced), with no report link and no "Ready for decision" badge.
  117/117 pure unit tests pass.

---

## 2026-08-17 — Search Candidate: three filters, fixed ordering, lighter list query
**Why:** the page's filter and Advanced filter "don't make any sense" — keep Name, Email and
Phone, nothing more; order by id descending; no sorting in the UI, only search. Full detail in
[docs/changelog/CHANGES-2026-08-17-search-candidate-filter-simplification.md](./changelog/CHANGES-2026-08-17-search-candidate-filter-simplification.md).

- `frontend/src/pages/Candidates.jsx` — **three overlapping ways to narrow the same table
  collapsed into one.** The page carried a debounced free-text quick-search box, a collapsible
  Advanced filters panel (email, name, phone, position, location) with an active-filter counter,
  *and* per-column sort arrows. Now: one card with Candidate Name, Email ID, Phone / Contact
  Number, plus Search and Reset. The quick-search box, the Advanced toggle, the counter strip and
  the position/location fields are gone.
- `frontend/src/pages/Candidates.jsx` — **sorting removed from the UI entirely.** `sorter: true`
  dropped from Name, Email and Position; the `sort` state deleted; `loadCandidates()` always asks
  for `sort: 'id', order: 'desc'` (newest first, first-ever-added last) and `handleTableChange`
  handles pagination only. Sorting is removed from this page only — the API still accepts
  `sort`/`order` for the CSV export and other callers.
- `backend/src/services/candidate.service.js` — `resolveSortField()` gained an `id` branch. It
  knew only name / email / position / modifiedAt and **silently fell back to `createdAt`**, so
  without this the page would have asked for `id` and quietly got date order. `id` is also the
  primary key: an index walk instead of sorting every matching row, where `createdAt` is
  nullable and unindexed and sorted NULL-dated legacy rows to the top of page 1 under DESC.
- `backend/src/services/candidate.service.js` — **`search()` no longer ships the two heaviest
  columns.** The list was already paginated server-side (25/request, max 100 — it never pulled
  4k), so the cost was per-row weight: `findMany` ran with no `select`, returning all ~80 `rpa_cv`
  columns including `resume_full_text` (the whole resume as plain text) and `ai_profile_insights`.
  Now omitted. Nothing on that path reads either — `mapCandidate()` references neither and
  `screening.service.js` pulls both via its own raw SQL. Export untouched (already uses the
  narrow `EXPORT_SELECT` allowlist).
- **Known behaviour, not introduced here:** `buildWhereClause()` ORs name/email/phone *with each
  other* (legacy "search by any identifier"), so filling two fields returns rows matching either,
  not both. Left as-is — the same clause serves other callers and the export.
- **Verified:** `npx vite build` clean (only the pre-existing >500kB chunk warning); 182/182
  backend unit tests pass. Re-confirmed after the 2026-08-17 merge.

## 2026-08-13 — Placement vendor process: pre-push audit (4 issues logged, not yet fixed)
**Why:** checked the staged M6 vendor changes against
[docs/reference/VENDOR_PROCESS.md](./reference/VENDOR_PROCESS.md) before pushing. The 160-test
unit suite passes clean, but it only covers the pure guard functions in isolation — the call
sites wiring them together were not exercised. Full detail, failure scenarios and fix plan in
[docs/changelog/CHANGES-2026-08-13-vendor-audit.md](./changelog/CHANGES-2026-08-13-vendor-audit.md).

- **Closure notification silently dropped** when a journey closes while parked on the Documents
  stage — `notifyVendor()` applies the Documents `'never'` stage policy to the `CLOSURE` event
  too, contradicting §18's "closure notifies the vendor even for outcomes silent to the
  candidate." (`vendorNotification.service.js`, `pipeline.service.js`)
- **JOINED closure can freeze a stale/unrelated vendor's lock permanently** — the freeze check
  only tests `VendorEmail: { not: null }`, not whether that lock is actually live or owned by the
  vendor who sourced the hired candidate. (`pipeline.service.js`)
- **Every vendor notification reads "Hello partner,"** — `pipelineRow.vendor_name` is always
  `undefined` (no such column on `rpa_candidate_pipeline`; only `vendor_email` is stamped).
  Cosmetic, no functional impact. (`vendorNotification.service.js`)
- **`getVendorDashboard` re-implements vendor scoping** instead of calling
  `enforceVendorScope()` like the candidate list and CSV export do — same "two implementations
  drift apart" shape as the `b671236` export hole, on an untrimmed role comparison.
  (`vendor.controller.js`)
- **Status:** logged only, no code changed in this pass. Fix order: closure-suppression bug →
  stale-lock freeze → dashboard scoping drift → vendor_name cosmetic fix.

## 2026-08-11 — QA test-pass fixes (HR Upload → Zeko HR → pipeline)
**Why:** the team's 118-case pass returned four defects. Two were real bugs; two were features
that already shipped but looked absent. Full detail in
[docs/changelog/CHANGES-2026-08-11-qa-testpass.md](./changelog/CHANGES-2026-08-11-qa-testpass.md)
and items #19–#22 of
[CHANGES-2026-08-07-candidate-pipeline-fixes.md](./changelog/CHANGES-2026-08-07-candidate-pipeline-fixes.md).

- `backend/src/utils/experienceParser.js` (new) + `backend/src/services/hrUpload.service.js` —
  **Total Experience was fabricated on every upload.** A resume with any employment history took
  a date-computed total, and the date reader could not handle `Jun-2022` / `May'21` / `05.2022`,
  so those candidates were stored as `"0"` years; with no history at all a hardcoded `"2"` was
  written. `"0"` also passed the missing-data check, so it was never chased. The computed value
  now wins only when it computed something. The other fabricated defaults in the same block
  (`9876543210`, `B.Tech`, `Delhi`, `Software Developer`) are now null, five parsed-but-unstored
  columns are written, and an out-of-range reading no longer throws away the whole candidate.
  Two copies of the date logic collapsed into one tested module.
- `backend/scripts/report-experience-anomalies.js` (new) — read-only diagnostic for how many
  existing rows carry a fabricated value. **No backfill has been run.**
- `backend/src/services/interviewSchedule.service.js`, `backend/prisma/seed-email-templates.js`,
  `frontend/src/components/pipeline/PipelineDrawer.jsx` — **interviewer name now reaches the
  invite email.** The name was already stored; the token map and the panel templates lacked it.
  Threaded through the *preview* as well as the send, because the modal posts its compiled body
  back and the server prefers it. ⚠️ Needs `seed-email-templates.js` re-run on deploy, which
  overwrites HR's edits to those three templates.
- `frontend/src/pages/DocumentUpload.jsx` — the submit button already existed; what was missing
  was any acknowledgement until HR *verified* (days later). Added a submitted state.
- `backend/src/services/documentCollection.service.js` — automatic document reminders already
  existed; the panel never said so. Fixed the copy, plus two real counter bugs: a failed send
  burned the candidate's reminder budget, and a re-request after three reminders was never
  auto-chased again.
- Verified: unit suite 122 passing (15 new), frontend build clean. Not yet exercised against a
  running stack — see the re-test steps in the test-pass note.

## 2026-08-11 — Export one requisition from the MRF details modal
**Why:** MRF could only export the filtered **list**. Everything worth forwarding — the
New MRF Request fields and the ~45-field MRF the Hiring Manager submitted — lives in the
details modal, and there was no way to get it out short of a screenshot. Full detail in
[docs/changelog/CHANGES-csv-export.md](./changelog/CHANGES-csv-export.md) §6 and
[CHANGES-2026-08-07-candidate-pipeline-fixes.md](./changelog/CHANGES-2026-08-07-candidate-pipeline-fixes.md) #18.

- `backend/src/exports/mrfDetail.export.js` (new) — export spec for a single requisition,
  transposed to `Section, Field, Value` (one row per field) because a 65-column single-row
  file is unreadable. Joins `rpa_mrf_jd_send` + `rpa_mrf`, groups and labels fields exactly
  as the modal does, honours the modal's conditional "Other" fields, and mirrors the modal's
  status tags — which differ from the list table's ("COMPLETED" vs "MANAGER SUBMITTED").
- `backend/src/controllers/mrf.controller.js`, `backend/src/routes/mrf.routes.js` —
  `GET /api/mrf/:id/export`, same `MRF_EXPORT_ROLES` + `exportLimiter` as the list export.
  Suppresses `X-Export-Row-Count`, since a "row" here is a field, not a record.
- `frontend/src/pages/MRF.jsx`, `frontend/src/services/mrfService.js` — `ExportButton` in the
  modal footer, view mode only (the file is read from the DB, so it would disagree with
  unsaved edits).
- `backend/src/tests/mrfDetailExport.test.js` (new) — 12 DB-free tests over the pure row
  builder. Verified: unit suite 107 passing, frontend production build clean.

## 2026-07-14 — Docs reorganization (`docs/reference/`, `docs/changelog/`, `docs/deployment/`)
**Why:** the doc set had grown past 30 files flat under `docs/`, making it hard to tell living
reference docs apart from dated session worklogs. Full detail in
[docs/changelog/CHANGES-docs-reorganization.md](./changelog/CHANGES-docs-reorganization.md).

- Moved 13 architecture/how-it-works docs into `docs/reference/` (`BACKEND.md`, `FRONTEND.md`,
  `VENDOR_PROCESS.md`, `screening.md`, etc.), 10 dated worklogs into `docs/changelog/` (all
  `CHANGES-*.md` + `UI_FIXES.md`), and `V16-CHANGES-AND-DEPLOYMENT.md` into `docs/deployment/`.
  `docs/CHANGELOG.md`, `docs/phase3/`, `docs/proposals/`, `docs/test-plans/`, and
  `frontend/UI-CHANGELOG.md` were left in place. No files deleted or content rewritten — pure
  regrouping, done with `git mv` to preserve history.
- Fixed every relative link broken by the move: markdown cross-links, `../backend` / `../frontend`
  source-code links inside the relocated reference docs, and plain-text `docs/Foo.md` path mentions
  in changelog prose and one backend comment (`seed-email-templates.js`). Verified with a scripted
  link-resolution pass — 0 broken links across 74 checked.

## 2026-07-13 — Friendly 429 messages with wait time
**Why:** Rate-limit responses said only "please try again later" — users had no idea how long to wait.

- `backend/src/utils/rateLimitHandler.js` (new) — `friendlyRateLimitHandler(whatHappened)` factory:
  computes the remaining wait from the limiter's per-client `resetTime` and responds
  `429 { status, message: "<what happened> Please try again in about X minutes." }`.
- `backend/src/app.js` — global + auth limiters use the handler ("You've made too many requests…" /
  "Too many failed sign-in attempts. For your security, sign-in is temporarily paused.").
- `backend/src/routes/auth.routes.js` — forgot-password limiter likewise ("Too many password reset
  requests."). No frontend change needed — pages already display the API's `message` field.

## 2026-07-13 — Forgot password (emailed time-limited reset link)
**Why:** A user who forgot their password had no self-service recovery — the only path was an admin
reset. Completes the account-management work from 2026-07-10.

- **Design:** stateless single-use reset tokens — a 30-minute JWT `{ userId, type: 'password-reset',
  fp }` signed with the existing `JWT_SECRET`, where `fp` fingerprints the CURRENT `password_hash`
  (sha256, first 16 hex). Resetting rotates the salt+hash, so the fingerprint stops matching and the
  token can't be replayed. No token table — deliberate, since the repo has no migration tooling.
  Reset tokens can't act as bearer tokens (`authenticate` also requires an `rpa_sessions` row).
- `backend/src/services/auth.service.js` — `generatePasswordResetToken`, `requestPasswordReset`
  (anti-enumeration: silent unless user exists + active + has email; fire-and-forget email; logs the
  reset URL in non-prod for dev testing), `resetPasswordWithToken` (expired/invalid/already-used all
  return distinct 400s — never 401, which the frontend interceptor hard-redirects on; deletes ALL
  sessions on success).
- `backend/src/services/emailNotification.service.js` — `sendPasswordResetEmail` (branded template,
  button + raw link, 30-min/single-use copy; logs `email_type: 'password_reset_request'`).
- `backend/src/config/emailRecipients.js` — new `passwordReset` flow, added to `NEVER_REDIRECT`
  (reset links always go to the account owner, even in staging).
- `backend/src/routes/auth.routes.js` + `auth.controller.js` — `POST /api/auth/forgot-password`
  (always generic 200; dedicated 5-per-15-min limiter counting ALL requests, since the global auth
  limiter only counts failures) and `POST /api/auth/reset-password` (newPassword min 8 max 128).
- `frontend/src/pages/ForgotPassword.jsx`, `ResetPassword.jsx` (new) — AuthLayout pages: generic
  success state; missing-token / expired / used-link states with "Request a new link"; confirm
  validator; success state pointing to Sign In.
- `frontend/src/layouts/AuthLayout.jsx` — pathname→heading map for the two new pages.
- `frontend/src/App.jsx` — routes under the `PublicRoute > AuthLayout` group. `Login.jsx` +
  `AdminLogin.jsx` — "Forgot password?" link under the submit button.
  `frontend/src/services/authService.js` — `forgotPassword()`, `resetPassword()`.
- No schema changes, no new env vars/dependencies. Verified end-to-end (17 API + 11 browser checks:
  anti-enumeration byte-identical responses, single-use replay rejection, all-session invalidation,
  429 rate limit, full UI journey incl. used-link state).

## 2026-07-10 — Login by email, admin username control, self-service password change
**Why:** Login accepted username only; the admin UI auto-generated usernames (`first.last123`) with no
way to set or change them; and non-admin roles (recruiter/vendor) had no way to change their own
password — the only password path was the admin portal. Overview + deploy notes in
[docs/deployment/V16-CHANGES-AND-DEPLOYMENT.md](./deployment/V16-CHANGES-AND-DEPLOYMENT.md).

- `backend/src/services/auth.service.js` — new `findUserByLogin()` (case-insensitive `username` OR
  `email`); `login()` uses it. New shared `hashPassword()` (same `salt:sha512` format). JWTs now carry
  a unique `jti` claim — fixes a race where two same-second logins produced identical tokens and
  violated the `rpa_sessions.token` unique constraint.
- `backend/src/controllers/auth.controller.js` + `routes/auth.routes.js` — new
  `POST /api/auth/change-password` (authenticated, **all roles**; current password verified; new
  password min 8/max 128). Deletes the user's other sessions; the current session survives. No
  credential email for self-chosen passwords (admin resets still email).
- `backend/src/controllers/admin.controller.js` — `createUser`: `username` now optional, defaults to
  the email; `updateUser`: case-insensitive email/username duplicate pre-check (excluding the edited
  user) returning the friendly `409 EMAIL_EXISTS` (was a raw Prisma P2002); both hash blocks replaced
  with the shared `hashPassword()`.
- `frontend/src/pages/AdminDashboard.jsx` — optional Username field in the Add/Edit User modal
  ("Defaults to the email address"); random username auto-gen removed (Auto-Generate = password only);
  username included in create/update payloads; 409 flags both email + username fields.
- `frontend/src/components/common/ChangePasswordModal.jsx` (new) — current/new/confirm form, inline
  error on wrong current password. Wired into the avatar dropdown (`MainLayout.jsx`) and the admin
  top-bar user chip.
- `frontend/src/pages/Login.jsx`, `AdminLogin.jsx` — labels now "Username or Email" (request field
  unchanged). `frontend/src/services/authService.js` — `changePassword()`.
- No schema changes, no new env vars or dependencies. Verified end-to-end (20 API + 8 browser tests).

## 2026-07-10 — Light/Dark/System theme + dark-mode contrast sweep (frontend)
**Why:** The app "randomly rendered black" — the old `ThemeContext` fell back to the OS
`prefers-color-scheme` when no stored theme existed and then persisted it, pinning OS-dark users to
dark with no rendered toggle to escape. After shipping a proper theme system, dark mode surfaced
contrast bugs (light-on-light / dark-on-dark text) across screens.

- `frontend/index.html` — anti-FOUC inline script: applies `data-theme`, `color-scheme`, and the
  `theme-color` meta before first paint. Default **Light**; OS honored only in System mode.
- `frontend/src/context/ThemeContext.jsx` — rewritten: three modes (`light`/`dark`/`system`) in
  `localStorage['ats_theme']`; OS listener only while in System mode; theme flips run through the
  transition helper.
- `frontend/src/utils/themeTransition.js` (new) — circular-reveal switch animation (View
  Transitions API) with cross-fade fallback and `prefers-reduced-motion` bypass.
- `frontend/src/components/common/ThemeToggle.jsx` (new) — animated sun↔moon toggle; wired into the
  main header + admin top bar (`MainLayout.jsx`); Appearance card added to `Settings.jsx`.
- `frontend/src/theme/themeConfig.js` — `darkTheme` now uses `algorithm: theme.darkAlgorithm`
  (fixes AntD-derived light status backgrounds: unreadable Alerts, Tag presets, disabled fills);
  dark component tokens refined (Modal/Drawer/Tooltip/links).
- `frontend/src/theme/index.css` — defined previously-missing vars (`--colorBgContainer` family,
  `--color-primary*`, `--text-secondary`, `--olive`, …); new semantic tokens (`--warn-*`,
  `--success-text`, `--info-strong`, `--overlay-scrim`); `:root, [data-theme='light']` selector
  enables scoped light re-theming; dark overrides for dropzone hover, CodeMirror shell, admin bar.
- `frontend/src/App.jsx` — `ForceLight` wrapper pins the public token-link routes (`/mrf-submit`,
  `/mrf/:id/approve`, `/missing-jd-upload`) always-light (external users have no toggle).
- Page sweep (~200 hardcoded hexes → theme vars, light mode visually unchanged):
  `Candidates.jsx`, `MRF.jsx`, `HRUpload.jsx`, `CandidateDetail.jsx`, `AdminDashboard.jsx`
  (Module Access switches/tiles/pills), `VendorPortal.jsx`, `VendorDashboard.jsx`,
  `CandidateScreening.jsx` (loading overlays), `EmailManagement.jsx` (CodeMirror dark theme),
  `Analytics.jsx`, `Dashboard.jsx`.
- Full detail: [frontend/UI-CHANGELOG.md](../frontend/UI-CHANGELOG.md) (2026-07-10 entries).

## 2026-07-10 — Fix frequent 429 "Too many requests from this IP" errors
**Why:** The global limiter allowed only 100 requests/15 min per IP over ALL of `/api` — a single SPA
user (let alone a whole office behind one NAT IP, or everyone behind the un-trusted reverse proxy)
exhausted it in minutes during normal use. Replaced with a two-tier scheme: generous global abuse
protection + strict brute-force limiting on login only. Full detail in
[docs/changelog/CHANGES-rate-limit-429-fix.md](./changelog/CHANGES-rate-limit-429-fix.md).

- `backend/src/app.js` — global limiter raised to 2000 req/15 min per IP (`/api/health` exempt); new
  auth limiter on `/api/auth` (20 per 15 min, **failed attempts only** via `skipSuccessfulRequests`);
  `app.set('trust proxy', 1)` when `TRUST_PROXY=true` so limits key on the real client IP.
- `backend/src/config/index.js` — limits env-configurable: `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`,
  `RATE_LIMIT_AUTH_MAX`, `RATE_LIMIT_AUTH_WINDOW_MS`, `TRUST_PROXY` (defaults are the fix; no env
  change required).
- `backend/.env.staging`, `backend/.env.production` — `TRUST_PROXY=true` (both sit behind a reverse
  proxy); tuning vars documented. `.env.development` — commented docs only.
- `docs/reference/BACKEND.md` — rate-limiter section rewritten for the two-tier scheme.
- Requires a restart of staging/production to take effect.

## 2026-07-03 — Superadmin/Admin permission tightening + credential email routing
**Why:** Any admin could delete users and edit/reset passwords of co-admins. New rules: Delete User is
superadmin-only; an admin may edit details/passwords of **self** and of **recruiters/vendors** only (not
co-admins); a superadmin may reset passwords of admins/recruiters/vendors. Credential/password emails must
reach the affected user's own inbox even in staging (not the test-recipient redirect).

- `backend/src/config/roles.js` — new `outranks(requesterRole, targetRole)` helper (strict `ROLE_RANK`
  comparison; equal ranks do NOT outrank each other).
- `backend/src/controllers/admin.controller.js`:
  - `updateUser` (details + password reset) — target must be **self or a strictly lower role**; a
    superadmin may additionally edit a peer superadmin's **details** (but a superadmin password can only
    be changed by its owner); own role changes rejected; `is_active` ignored on self-edits (lockout
    prevention).
  - `deleteUser` — superadmin-only; self-deletion blocked server-side (was UI-only).
  - `toggleStatus` — self-toggle blocked server-side; target must be a strictly lower role (admins can no
    longer deactivate co-admins).
- `backend/src/config/emailRecipients.js` — `userCredentialUpdate` added to `NEVER_REDIRECT`: credential /
  password-change emails always resolve to the target user's own email in every environment; all other
  flows still redirect to the staging test inbox.
- `frontend/src/pages/AdminDashboard.jsx` — mirrors the rank rule: Edit enabled for self + lower roles,
  Toggle for lower roles only, Delete for superadmins only, with explanatory tooltips; Role and Account
  Status fields disabled when editing your own account. Deactivate confirmation restyled as a warning
  (⚠️ title, amber consequence box, danger-styled "Deactivate" button); activation keeps the positive style.
- `docs/reference/ADMIN_ACCESS_CONTROL.md` — rules, capability matrix, and endpoint table updated.
- `docs/reference/ROLE_RULES.md` (new) — per-role can/cannot reference (Super Admin / Company Admin / Recruiter /
  Vendor) incl. universal rules and a quick-reference matrix.

## 2026-06-30 — Candidate card enterprise refinement (pass 2)
**Why:** Score block read too big; user wanted more enterprise polish but to keep the SKILLS tags multicolor.

- `frontend/src/theme/index.css` — shrank `.cand-score*` (smaller value/stars/verdict, tighter box); added a
  left fit-accent rail (`.cand-card::before` driven by `--cand-accent`) and a `.cand-divider` hairline.
- `frontend/src/pages/CandidateScreening.jsx` — `scoreTierColor(stars)` helper sets `--cand-accent` per card
  (green/gold/amber/neutral by star tier); `renderStars(count, size)` now takes a size (11px in the scorecard);
  added the divider between the identity and skills/match bands. `SkillTags` (SKILLS row) left unchanged.

## 2026-06-30 — Screening UI premium refresh
**Why:** The Candidate Screening page looked cluttered/flat — every card repeated all mandatory + good-to-have
skills (incl. grey "missing" tags) with weak hierarchy. Refine the existing olive/gold brand into a calmer,
premium look. Display-only.

- `frontend/src/theme/index.css` — added scoped screening classes (light + dark): `.cand-card`, `.cand-name`,
  `.cand-company`, `.cand-avatar-ring`, `.cand-score*`, `.match-meter*`, `.skill-chip*`, `.cand-section-label`,
  `.cand-signal-hint`.
- `frontend/src/pages/CandidateScreening.jsx`:
  - `JdSkillMatch` now takes a `variant` prop. `variant="card"` = compact **match meter + present-only chips**
    (no "missing" spam); `variant="full"` (default, drawer) keeps the complete present/missing breakdown.
  - Candidate card restructured: gradient-ring avatar, `.cand-name`, qualification folded into the meta-pill row,
    a single "Skills" row, the compact match meter, and an elegant right-side `.cand-score` scorecard.
  - Summary bar decluttered: primary count + muted detail; star buckets stay as stat chips.
- `docs/reference/screening.md` — noted the card uses the compact meter; drawer keeps the full breakdown.

## 2026-06-30 — App-load roles preload + Refresh button
**Why:** Roles/candidates re-fetched on every page visit and were lost on navigation; no manual reload.

- `backend/src/services/screening.service.js` — `searchRoleCandidates(mrfId, force)` skips the Redis read when
  `force` is true (recompute + overwrite), so Refresh returns genuinely fresh candidates.
- `backend/src/controllers/screening.controller.js` — reads `?force=1` / body flag and passes it through.
- `frontend/src/services/screeningService.js` — `searchRoleCandidates(mrfId, { force })` → `?force=1`.
- `frontend/src/hooks/useScreeningData.js` (new) — React Query hooks `useApprovedRoles()` and
  `useRoleCandidates(roleId, enabled)` (`staleTime: Infinity`; cache persists across navigation).
- `frontend/src/App.jsx` — `AppShell` prefetches roles once at app load (gated on the `candidate_screening`
  module / admin).
- `frontend/src/pages/CandidateScreening.jsx` — roles + candidates sourced from the hooks; sync effect feeds the
  existing render state; `selectedRoleId` + `activeTab` persisted in `localStorage`; Refresh button (force-bypass
  cache) by the role selector and on the keyword tab; removed the cosmetic preloading bar.

## 2026-06-30 — Client-side pagination (both tabs)
**Why:** Result lists rendered all rows at once; hard to scan.

- `frontend/src/pages/CandidateScreening.jsx` — `currentPage`/`pageSize` state, sliced render, AntD `<Pagination>`
  (10/20/50), reset to page 1 on new search / tab switch. Select-All still spans the full result set.

## 2026-06-30 — Keyword-tab searched-skill signals
**Why:** Extend JD Skill Match to the Keyword Filtering tab so searched terms are cross-referenced too.

- `backend/src/services/screening.service.js` — `searchKeywordCandidates` attaches `jdSkillSignals`
  (searched keyword/designation as the matched skills) when a term is present.
- `frontend/src/pages/CandidateScreening.jsx` — `<JdSkillMatch>` gained a `label` prop; keyword mode shows
  "Searched Skills" / "Searched Skill Match".

## 2026-06-30 — JD Skill Match (JD Filtering tab)
**Why:** Cross-reference each JD skill against the candidate's resume signals + declared skills so recruiters see
which mandatory skills are actually evidenced. Display-only (scoring unchanged).

- `backend/src/services/screening.service.js` — `buildJdSkillSignals()` (+ helpers `splitSkillPhrases`,
  `parseDeclaredSkills`, `parseTechnicalTerms`, `skillMatchesTerm`); attaches `jdSkillSignals` per candidate in
  `searchRoleCandidates`.
- `frontend/src/pages/CandidateScreening.jsx` — `JD_SKILL_STATUS` map + `<JdSkillMatch>` component on card + drawer.
- `docs/reference/screening.md` (new, consolidated) — feature documentation.
