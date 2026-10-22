# Candidate Pipeline — issue-tracking fixes (2026-08-07 session)

Running log of fixes made during this session's issue punch list. One entry
per fix, added as each is completed.

---

## 1. "Candidate Pipeline" naming inconsistency

**Issue:** The real `/pipeline` page's sidebar/breadcrumb say "Candidate
Pipeline" (per the v7 prototype rename), but the in-page `<Title>` still said
"Interview Pipeline Tracker" — the old pre-rebrand name, never updated when
the real page was built.

**Fix:** Renamed the leftover "Pipeline Tracker" / "Interview Pipeline
Tracker" text to "Candidate Pipeline" everywhere it was still user-facing:
`Pipeline.jsx` heading + error message, `Analytics.jsx` caption,
`Settings.jsx` caption, `AdminDashboard.jsx` module label,
`CandidatePipelinePrototype.jsx` preview banner, `PipelineDrawer.jsx`
cancel-reason default, and the recruiter-facing email copy in
`seed-email-templates.js` / `interviewOccurrence.js` / `offerSweep.js`.
Reseeded the two live DB email templates so the wording took effect
immediately (confirmed via `Updated #33`/`Updated #45` in the seed output).
Left internal doc-comments alone (not user-facing).

**Files:** `frontend/src/pages/Pipeline.jsx`, `Analytics.jsx`, `Settings.jsx`,
`AdminDashboard.jsx`, `CandidatePipelinePrototype.jsx`,
`frontend/src/components/pipeline/PipelineDrawer.jsx`,
`backend/prisma/seed-email-templates.js`,
`backend/src/jobs/interviewOccurrence.js`, `offerSweep.js`.

---

## 2. No feedback after shortlisting/rejecting a candidate

**Issue:** After a recruiter shortlists or rejects candidates on Candidate
Screening, the only feedback was a generic toast — no link, no indication
of where the candidate went next.

**Fix (Phase 1 of a larger roadmap — see plan file for Phases 2-4):**
`shortlistCandidates()` now returns `pipeline_entries: [{cv_id,
pipeline_id}]` (previously discarded). The Screening page's success
notification is now actionable: single shortlist → "View in Pipeline"
deep-links straight to that candidate's card
(`/pipeline?candidate=<id>`); bulk shortlist → links to the board filtered
by role; reject → clearer copy, no dead-end button (nothing to link to yet).

**Files:** `backend/src/services/screening.service.js`,
`frontend/src/pages/CandidateScreening.jsx`,
`frontend/src/services/screeningService.js`.

---

## 3. Zeko Job selector — unusable "Role: NA" + no title/role shown

**Issue:** The "Schedule Zeko Interview" modal's job dropdown showed only a
(sometimes truncated) title, no role. A first pass added a "Role:" line, but
it read "NA" for ~100 of ~150 synced jobs — traced to `zeko.service.js`
reading Zeko's unreliable `designation` field. Deeper issue: the same role
often has two published Zeko jobs (one HR, one Functional), shown with
identical titles and no way to tell them apart.

**Fix:**
- `transformRole()` now reads the interview's own `roleName` (reliable)
  instead of `designation` (unreliable — often literally `"NA"`).
- `syncZekoJobs()`'s upsert now refreshes `role_name`/`hiring_name` on every
  sync (previously frozen at first creation, so the bad data could never
  self-heal).
- `PipelineDrawer.jsx`'s job dropdown now filters to only the jobs tagged
  for the round being scheduled (HR vs Functional/Coding, via
  `interview_type`), shows the real hiring name + corrected role + an
  HR/Functional/Coding tag per option, and falls back to the full list with
  a warning if nothing matches rather than blocking scheduling.
- One-time resync attempted to self-heal already-synced jobs immediately;
  **blocked** in this environment (`ZEKO_COMPANY_ID` not configured
  locally) — needs running wherever the real Zeko dashboard credentials
  live (staging/production), or will self-heal on that environment's next
  hourly sync once this fix is deployed there.

**Files:** `backend/src/services/zeko.service.js`,
`frontend/src/components/pipeline/PipelineDrawer.jsx`.

---

## 4. Functional Screening (Zeko) round — stuck, un-schedulable

**Issue:** A candidate on the "Functional Screening (Zeko)" stage had no
"Schedule Interview" button anywhere — stuck at "Not yet assigned to a Zeko
job" with no way to fix it. Root cause: the button was hard-gated to
`stage.stage_key === 'zeko_hr'` even though the backend fully supports
scheduling either round.

**Fix:**
- Changed the button gate to `isZekoStageKey(stage.stage_key)` (covers both
  rounds) — the mutation, modal, and job-catalog filter were already
  stage-aware, only the trigger was missing.
- Corrected a stale code comment that incorrectly claimed the backend
  hard-codes `'hr'` everywhere (it doesn't — `stage` is a real, honored
  parameter throughout `screening.service.js`).
- Found and fixed a second, separate bug while auditing: `rpa_cv` holds one
  shared set of Zeko score columns per *candidate*, not per round, so a
  candidate completing both Zeko rounds would have one round's scores
  silently overwritten by the other, and the drawer would show the same
  (possibly wrong-round) number on both stage cards.
  `getPipelineDetail()` now prefers each round's own result from
  `rpa_zeko_interview_results` (keyed by that round's own Zeko interview
  id) over the shared `rpa_cv` columns, falling back to the old behavior
  only when no round-specific result exists yet.

**Scope note:** the score fix corrects the Pipeline Tracker drawer only.
`Candidates.jsx`/`CandidateDetailCard.jsx`/`AnalyticsLegacy.jsx` still read
`rpa_cv`'s raw (shared, last-write-wins) columns directly — flagged, not
fixed this pass.

**Files:** `frontend/src/components/pipeline/PipelineDrawer.jsx`,
`backend/src/services/pipeline.service.js`.

**Also audited (per request) whether HR vs Functional are clearly
differentiated at every touchpoint** — confirmed scheduling, DB records,
and approve/reject emails all correctly distinguish the two rounds (the
approve/reject emails share one generic template per outcome but interpolate
the real per-stage label at send time). Found the schedule/invite email
(unlike the cancellation email) never states which round it's for, and that
reject/hold reasons are a shared global list, not per-round — both noted,
neither fixed yet.

---

## 5. Stage 1 ("Invite Sent") showed vestigial/generic text for most stages

**Issue:** Flagged while auditing #4: the Functional round's Stage 1 showed
a generic "Candidate entered this stage {date}" instead of anything real —
initially assumed unavoidable ("no equivalent invite email exists for this
stage"). Corrected by the user: there IS always a real email at every stage
transition — the *previous* stage's approval outcome email — it just wasn't
being read back into the next stage's card. Same generic text turned out to
affect every stage type except `assessment` and `zeko_hr` (both of which
have their own real, stage-specific stage-1 tracking already).

**Fix:**
- Renamed the label from "Invite Sent" → "Stage Entry" for the `zeko` and
  `scheduled_interview` stage types only (Tech 1/2/3, HR Round, CEO, Client,
  HR/Functional Zeko) — `assessment` keeps "Invite Sent" since it genuinely
  sends its own invite as that stage's first action.
- Stage 1's content for those types now shows the real signal: the previous
  active stage's approval outcome and whether its email actually sent —
  e.g. "Approved from IQ / Tech Assessment — outcome email sent 8/7/2026" —
  sourced from `email_sent`/`email_error`, already recorded per outcome
  event but not previously read back into the next stage's card. Computed
  from the full (unfiltered) stage-event history in `PipelineDrawer.jsx`'s
  `renderStagePanel()`, passed down as `previousStageOutcome`.
- `zeko_hr` and `assessment` are unaffected — both already overwrite Stage 1
  with their own more specific real tracking (shortlist notice / invite
  deadline), which still wins.

**Files:** `frontend/src/components/pipeline/PipelineDrawer.jsx`
(`PIPELINE_LABELS`, `renderStagePanel()`, `buildPipelineSegments()`).

---

## 6. Email Templates: hidden categories + three drifted rich-text editors

**Issue, three parts:**
1. Every Candidate Pipeline email should be a real DB template, manageable
   on the Email Templates page.
2. The Pipeline drawer's email-editing pane should look/work like the Email
   Templates page's editor.
3. Confirm text edited in an outcome/schedule modal before sending doesn't
   get saved back into the shared template.

**Findings:**
- Part 3 was already true — verified end-to-end (outcome Approve/Reject/
  Hold, interview schedule/cancel/reschedule, Zeko schedule/cancel, screening
  shortlist/reject). Edited text is used only for that one send and logged
  only to per-send tables; a repo-wide grep for writes to
  `rpa_email_templates` returns exactly 2 hits, both in the standalone Email
  Templates admin CRUD — architecturally disconnected from every send flow.
  No code change needed.
- Part 1: all 34 templates were already seeded, but 8 (6 `stage_outcome` +
  2 `onboarding`) had no category filter chip on the Email Templates page —
  only reachable via "All Templates" or search.
- Part 2: three separately-built, drifted rich-text editors existed —
  `EmailManagement.jsx` (9 toolbar buttons, 3 tabs: Editor/HTML/Preview),
  `EmailBodyEditor.jsx` (7 buttons, no tabs, used only by Candidate
  Screening's shortlist/reject modal), and `PipelineDrawer.jsx`'s inline
  `BrandedBodyEditor` (4 buttons, no tabs — but architecturally the most
  correct: edits only a protected `[data-editable-body]` slot inside the
  real branded email shell, so a stray edit can never corrupt the header/
  footer chrome — a deliberate prior bug fix that had to be preserved, not
  lost, in the consolidation).

**Fix:**
- Added "Stage Outcome" and "Onboarding" category chips to the Email
  Templates page; removed the dead "Follow Up" chip (matched nothing).
- Consolidated all three editors into one shared module,
  `frontend/src/components/common/EmailBodyEditor/` (replacing the old
  single-file component): `index.jsx` (public `EmailBodyEditor`),
  `useEmailIframeEditor.js` (the dual whole-document/protected-chrome
  engine, generalized from `BrandedBodyEditor`'s already-correct logic —
  not the other two whole-doc-only versions), `Toolbar.jsx`,
  `ImageUrlModal.jsx`, `EmailHtmlSourceEditor.jsx` and `EmailPreviewPane.jsx`
  (named exports, used only by `EmailManagement.jsx`'s tabs — the Pipeline
  drawer's editor already IS a live backend-rendered preview while editing,
  so it gets neither tab), and `sanitize.js` (canonical `SANITIZE_OPTS`,
  now including `ADD_TAGS: ['style']` everywhere — `PipelineDrawer`'s old
  copy was missing this and silently stripped inline `<style>`).
- Fixed a real latent bug as part of the move: the DOMPurify data-URI-image
  strip hook was previously registered only inside `EmailManagement.jsx`'s
  module scope (global, but only active once `/email` had been visited in
  that session) — moved to the shared `sanitize.js` every editor imports, so
  a dropped base64 image in the Pipeline drawer's editor is now actually
  blocked instead of silently reaching a sent email.
- `EmailManagement.jsx`'s "Available Placeholders" decorated panel was
  replaced by the shared component's simpler inline chip tray (confirmed) —
  same click-to-insert behavior on all three surfaces now.
- `PipelineDrawer.jsx`'s outcome/interview-schedule editors went from 4
  toolbar buttons to 7 (added lists + clear formatting); `DecisionEmailModal`
  gained the HTML-source and rendered-preview views it didn't have before
  (previously a plain textarea and a hand-rolled iframe).

**Files:** `frontend/src/components/common/EmailBodyEditor/` (new folder,
7 files), `frontend/src/pages/EmailManagement.jsx`,
`frontend/src/components/screening/DecisionEmailModal.jsx`,
`frontend/src/components/pipeline/PipelineDrawer.jsx`.

---

## 7. Follow-up: HTML/Preview tabs missing on the Pipeline drawer + shortlist/reject modal

**Issue:** Entry #6 above deliberately left the Pipeline drawer's editor
without HTML-source/Live-Preview tabs, reasoning that its protected-chrome
editor already renders a live, backend-accurate preview while editing. User
feedback: that reasoning didn't match what was wanted — every screen should
show the same Editor / HTML Code / Live Preview tab set as the Email
Templates page, not just share a toolbar.

**Fix:** Added `EmailEditorTabs.jsx` to the shared module — the same
3-tab Editor/HTML Code/Live Preview experience as `EmailManagement.jsx`,
now factored out as a reusable component (`bodyHtml`/`onBodyChange`
controlled from the caller, since pretty-printing into the HTML tab and
building the Preview tab both need the current value, which an
uncontrolled-after-mount child can't provide). `EmailManagement.jsx` itself
was refactored to use it too, so there's exactly one implementation of the
tab-switch state machine (remount-on-tab-entry, pretty-print-on-code-tab,
HTML-dirty tracking) instead of one page-owned copy plus however many
call sites needed their own.

Also added `previewSubject`/`previewBodyHtml` override props — the Live
Preview tab needs *compiled* text (real tokens substituted with sample or
real values), not the raw editable tokens; `EmailManagement.jsx` passes its
dummy-replacement compile, `DecisionEmailModal.jsx` passes its real
candidate/role compile, and `PipelineDrawer.jsx` doesn't need to override
anything (its body already arrives server-compiled with real values, so raw
and "preview" are the same text).

Now wired into all three consumers: `EmailManagement.jsx`,
`DecisionEmailModal.jsx` (replacing its bespoke `Segmented` Visual/HTML/
Preview switcher — same 3 states, now the shared `Tabs` widget), and
`PipelineDrawer.jsx`'s outcome modal + both `InterviewEmailEditors` panes
(candidate + panel copy).

**Files:** `frontend/src/components/common/EmailBodyEditor/EmailEditorTabs.jsx`
(new), `EmailBodyEditor.jsx` (split out of `index.jsx`, which is now a
barrel re-export), `EmailPreviewPane.jsx` (preview-override props),
`frontend/src/pages/EmailManagement.jsx`,
`frontend/src/components/screening/DecisionEmailModal.jsx`,
`frontend/src/components/pipeline/PipelineDrawer.jsx`.

---

## 8. 🚨 Teams/Outlook invites reaching real candidates from local & staging

**Issue:** Real candidates were receiving genuine Outlook/Teams calendar
invites from local and staging environments.

**Root cause — a branch gap, not a bug on this branch** (verified against
git, not inferred):
- The correct guard already exists on `harish-project-staging-v19`
  (HEAD `ca012bd`, 2026-08-06): both call sites in
  `interviewSchedule.service.js` wrap the candidate address in
  `calendarCandidateEmail()` → `nonProdSafeCandidateEmail()`.
- The `project-staging` branch — whose name matches the staging deploy path
  in `ecosystem.config.cjs` — still has the original unguarded code from
  commit `bf67342` (2026-07-28): raw `candidate.candidate_email` passed
  straight into the Outlook attendee list, lines 441 and 784. Confirmed by
  reading that branch's file directly. `MS_CALENDAR_ENABLED=true` in both
  `.env.development` and `.env.staging`, so event creation is genuinely
  active there.
- Production was never exposed: `MS_CALENDAR_ENABLED=false` means it creates
  no calendar events at all.

**Deeper weakness this fixes:** `createInterviewEvent()` in
`graphCalendar.service.js` was a "dumb" wrapper — it trusted whatever
attendee array it was handed. That's the opposite of how the email path was
hardened (fix #1 in `CHANGES-phase3-m1-pipeline.md` put a global gate
*inside* `sendGraphEmail()` precisely so a call site written without the
guard couldn't leak — "the net under the call sites, not a replacement").
The calendar path never got that net, so safety depended on every call site
*and every branch* remembering. That is exactly the failure mode that
produced this incident.

**Fix:**
- Added `nonProdSafeAttendees()` inside `graphCalendar.service.js`, applied
  in `createInterviewEvent()` before the Graph payload is built — the net
  that was missing. Attendees marked `role: 'panel'` pass through untouched
  (interviewers are typed in per booking and meant to be reached — the
  documented `OPERATOR_ADDRESSED` reasoning, kept per explicit decision);
  **everything else, including an unmarked attendee, is substituted.**
  Unmarked-defaults-to-redirect is deliberate: a future call site that
  forgets to label its attendees now fails safe instead of failing open.
- De-duplicates attendees after substitution — the candidate can collapse
  onto a panel member who already is the test inbox, and Graph must not be
  handed the same address twice.
- Marked attendee roles explicitly at both `interviewSchedule.service.js`
  call sites (schedule ~line 489, reschedule ~line 846). The existing
  call-site `calendarCandidateEmail()` wrapper is **kept** — deliberately
  redundant with the new net, same as the email path
  (`nonProdSafeCandidateEmail()` is idempotent, so double-application is a
  no-op).
- Added 5 unit tests to the existing `src/tests/emailRecipients.test.js`
  (candidate substituted / panel exempt / unmarked fails safe / dedup /
  name+order preserved). Full suite: 60 passing.

**Still outstanding — NOT fixed by this code change:**
1. **Staging stays exposed until it runs this code.** This hardening is on
   `harish-project-staging-v19`; staging appears to deploy from
   `project-staging`, which has neither the original fix nor this net.
   Merging/deploying is an ops decision, deliberately left to the owner.
   Also worth checking `git log -1` on the staging box and restarting the
   PM2 process — a stale process serves old code even after a pull.
2. **Already-sent invites are not retracted.** Events created during the
   exposure window (feature landed 2026-07-28) still sit in real
   candidates' calendars. Worth querying `rpa_interview_schedule` for rows
   since then to size the impact and decide what needs cancelling.
3. **`.env.production` has `EMAIL_REDIRECT_TO_TEST=true`** — legitimate for
   pre-launch smoke testing, but if prod is live it silently sends all
   candidate mail to the internal test inbox. Also note the coupling: when
   `MS_CALENDAR_ENABLED` is eventually turned on in prod (needs the
   tenant-admin Graph grant first), this flag must be turned off in the same
   change, or the same guard will substitute the test inbox for real
   candidates on production invites. `.env*` is gitignored and
   environment-owned — flagged, not changed.

**Files:** `backend/src/services/graphCalendar.service.js`,
`backend/src/services/interviewSchedule.service.js`,
`backend/src/tests/emailRecipients.test.js`.

---

## 9. Pipeline modals cramped — one width scale instead of 11 magic numbers

**Issue:** Every modal in the Candidate Pipeline felt squeezed; only the
right-side candidate drawer (680px) felt right.

**Root cause, measurable:** the branded email preview inside the editor is a
fixed **620px-wide** table (`common/EmailBodyEditor/brandedShell.js:16`,
mirroring the backend's `wrapBrandedEmail()`). AntD's modal content padding
costs ~48px. So a `width={560}` modal offers ~512px of usable width — the
620px email was being crushed into it, ~108px short. Widths across the
folder had drifted to 440/480/560/620/720/820 with no rule behind them.

**Fix:** new `frontend/src/components/pipeline/modalWidths.js` defining one
three-tier scale, applied across every pipeline modal:
- `CONFIRM: 560` — short confirmations/small forms (no-show, offer shared,
  close record, reject document, Zeko cancel, config stage/reason modals).
  Up from 440-480.
- `FORM: 680` — multi-field forms with no embedded email. Matches the
  candidate drawer, the one surface confirmed to feel right (Zeko schedule,
  Evalground invite).
- `EMAIL: 820` — anything hosting the 620px branded email editor, plus wide
  reports/tables (round outcome, schedule/reschedule interview, interview
  cancel, scorecard report, Evalground import, outcomes config table).
  Leaves the email ~150px of breathing room.

Also added a responsive guard in `theme/index.css`: `.ant-modal` is capped to
`calc(100vw - 32px)` so the 820 tier can't run off a narrow laptop viewport
(which would put the footer buttons out of reach), and `.ant-modal-body`
scrolls internally at `calc(100vh - 220px)` rather than pushing the page.

The candidate drawer's 680 was deliberately left untouched — it was reported
as already correct.

**Files:** `frontend/src/components/pipeline/modalWidths.js` (new),
`PipelineDrawer.jsx`, `AssessmentInviteModal.jsx`,
`AssessmentImportModal.jsx`, `PipelineConfigPanel.jsx`,
`frontend/src/theme/index.css`.

---

## 10. Date & time pickers — rebuilt Outlook/Teams-style (supersedes first attempt)

**Issue:** the pipeline's date/time pickers were a poor experience — bare
`<DatePicker showTime>` / `<RangePicker showTime>` with no shortcuts, a
24-hour clock, generic "Start date"/"End date" placeholders that said nothing
about what the dates meant, and **no past-date guard on two of the three**
(the Zeko interview window and the proposed joining date could both be set in
the past).

**First attempt (superseded):** added presets, past-date guards and a 12-hour
clock to the existing combined `<DatePicker showTime>` controls. Feedback was
that the interface still didn't make sense and should replicate what
Teams/Outlook provides — correct, because the fundamental problem wasn't
polish, it was the control shape.

**The actual problem:** AntD's combined `showTime` picker puts the time on a
pair of narrow scrolling hour/minute columns *inside* the calendar popup,
behind an OK button — three fiddly interactions to set one time. Outlook and
Teams instead **split date from time**: a calendar for the date, and a plain
dropdown LIST of half-hour slots for the time, so picking 2:30 PM is one
click in a list you can also type into.

**Fix:** new `frontend/src/components/pipeline/DateTimeField.jsx` reproducing
that split control:
- Date field (`ddd, DD MMM YYYY` — weekday shown, as Outlook does) beside a
  time dropdown listing 30-minute slots in 12-hour `h:mm A` form.
- Typing "230" or "2:30" jumps to the slot, matching Outlook's typeahead.
- A stored time that doesn't land on a slot boundary is injected as its own
  option rather than showing a blank box.
- Optional `durationFrom` annotates each option with the resulting gap
  ("2:30 PM · 30 minutes"), the way Outlook's END-time dropdown does.
- The two halves stay in sync on one dayjs value: picking a date keeps the
  time already set (defaulting to `defaultHour`), picking a time keeps the
  date.

Applied to:
- **Schedule/reschedule interview** — now reads Start time (date + time) then
  Duration, with a live "Ends at 3:00 PM · Mon, 11 Aug 2026" line underneath.
  Duration options widened to 15/30/45/60/90/120 with hour-aware labels.
- **Zeko interview window** — the `RangePicker` is gone, replaced by explicit
  "Opens" and "Closes" rows, each a DateTimeField. The close field defaults to
  6 PM and cannot be set before the open date.
- **Proposed joining date** — stays a plain date-only picker (no time
  involved) and keeps its notice-period presets (15/30/60/90 days).

Past dates remain blocked on all three.

**Bug caught while wiring this up:** splitting the Zeko range into two
independent fields meant `scheduleDates` could hold `[date, null]` — which
has length 2, so the existing `scheduleDates.length !== 2` validation passed
and then threw on `scheduleDates[1].toDate()`. Validation now checks both
halves are present and that the window closes after it opens.

**Deliberately NOT done:** restricting selectable hours to Indian business
hours. An interview with an overseas client panel legitimately falls outside
them, and greying those out would silently block real bookings — polish
should not become a new business rule.

**Files:** `frontend/src/components/pipeline/DateTimeField.jsx` (new),
`datePickerConfig.js` (trimmed to the date-only concerns that remain),
`PipelineDrawer.jsx`.

---

## 11. Public scorecard & document-upload pages — unbranded, and one had no submit button

**Issue:** the two public token-linked pages (interviewer scorecard, candidate
document upload) looked dull and off-brand: plain white cards on grey with no
AAPNA identity, no statement of what the page was for, and filler reassurance
("Secure link · no login needed", "Interview Evaluation Format · no login
needed") that reassures nobody and reads like a warning. The document page
also had **no submit button at all**.

These are the only AAPNA surface most candidates and external interviewers
ever see, and they arrive from a fully branded email — so the hand-off looked
like being dumped into an unrelated tool. (`MissingJdUpload.jsx`, an older
public page, was already branded; these two newer ones simply never got the
treatment.)

**Fix:**
- New `frontend/src/components/common/PublicPageShell.jsx` reproducing the
  branded-email shell — green `#7a922e` band, AAPNA logo, white card, grey
  footer — from the same tokens as `backend/src/services/emailLayout.service.js`,
  so clicking through from the mail reads as one continuous journey. Every
  state (loading, error, expired, closed, submitted) now renders inside it,
  not just the happy path.
- **One-line purpose line** in the band, replacing the filler copy: e.g.
  "Share the 3 documents listed below so we can move your application
  forward.", "Share your assessment of Priya Sharma for the Technical Round 1
  round." Both are built from real context, so they say something specific.
- Removed the "no login needed" / "secure link" lines entirely.
- Read-only context (candidate / position / round / interviewer) moved into a
  labelled strip instead of running `**Label:** value` text.

**The missing submit button — a real behaviour change, not just styling.**
The document page previously uploaded each file the *instant* it was picked
(`beforeUpload` fired the POST), so there was no review step and nothing to
press. Files are now **staged locally** — the row turns green and reads
"Ready to submit" — and one "Submit N documents" button sends them together.
The button states its own count and is disabled until something is chosen.
Uploads run sequentially and independently: a failure keeps only the files
that actually failed staged for retry, and reports how many of how many got
through.

Worth noting: the first cut of that retry logic tracked a success *count* and
kept "everything after N" staged, which strands the wrong files when a failure
lands anywhere but last. It now tracks the failing IDs explicitly.

**Files:** `frontend/src/components/common/PublicPageShell.jsx` (new),
`frontend/src/pages/DocumentUpload.jsx`,
`frontend/src/pages/InterviewScorecard.jsx`.

---

## 12. UI/UX pass on the two most-used pages (Screening + Pipeline)

**Context:** Candidate Screening and Candidate Pipeline carry most of the
daily usage, so they were audited for concrete defects rather than restyled
on instinct. Four confirmed issues were fixed; things that turned out to be
fine were deliberately left alone (the board's horizontal scroll arrows, for
instance, already handle overflow properly).

### Pipeline: the board claimed to be live but wasn't

The subtitle read *"Live data — candidates enter here when shortlisted from
Candidate Screening"*, yet the board had **no `refetchInterval`, no
refetch-on-focus (the global default in `main.jsx` disables it), and no
manual refresh control**. A recruiter could sit on the page all day and never
see a newly-shortlisted candidate appear. The UI was making a promise the
code did not keep.

- Added `refetchInterval: 60_000` and `refetchOnWindowFocus: true` on the
  board query — focus-refetch matters most, since returning to the tab is
  exactly when someone is looking for a change.
- Added a **Refresh** button (spinner-linked to `isFetching`) and a live
  "Updated 2 min ago" indicator. The indicator ticks on its own 15s timer:
  between the 60s polls nothing else re-renders the page, so a label frozen
  at "just now" would undercut the very claim it exists to make.
- Dropped the now-redundant "Live data —" prefix from the subtitle.

### Pipeline: search and filter polish

- Removed `(local keyword matching)` from the search placeholder — the same
  class of implementation-detail noise as the "no login required" copy
  stripped from the public pages in #11.
- Added a **Clear filters** action, shown only when something is actually
  filtering, and the result count now reads plain `N candidates` instead of
  `N of N candidates` when nothing is filtered.

### Screening: "Select All" silently spanned every page

The checkbox sat above ten visible rows but selected the **entire result
set** — potentially hundreds — feeding straight into bulk Shortlist/Reject.
It was labelled with the true count and the confirm modal repeated it, so it
was guarded rather than broken, but it is the wrong default for a
consequential action.

- The checkbox is now **"Select this page (N)"** and acts only on the visible
  slice, merging with (not replacing) selections made on other pages.
- Selecting everything is still one click — **"Select all N matches"** — but
  it is now a deliberate, separately-labelled choice, with a "Clear
  selection" counterpart.
- Added a running "N selected" indicator, and fixed "1 candidates selected"
  in the floating action dock.

### Screening: real loading skeleton

While a match ran, the results area rendered an **empty 200px spacer** behind
the overlay spinner — a void that made the wait feel longer and let the page
jump when results landed. Replaced with `CandidateListSkeleton`, placeholder
rows shaped like the real candidate cards (avatar, name, meta, tag row,
score), reusing the app-wide `.shimmer` class so it animates like every other
loading surface.

**Files:** `frontend/src/pages/Pipeline.jsx`,
`frontend/src/pages/CandidateScreening.jsx`.

---

## 13. MRF stayed closed forever when a hire fell through

**Issue:** raised as "are we closing the MRF process thoroughly post
documentation?" The closure machinery itself turned out to be well built —
counts openings properly, mirrors status onto the request row, clears the
Redis role cache, broadcasts `mrf:closed`, notifies, never throws — and it
already had a `reopenMrfIfUnfilled()` whose own docstring names the exact
failure it exists to prevent:

> *"A candidate who accepted and then backed out used to leave the
> requisition closed forever — the role stayed out of JD filtering and
> recruiters had to notice and fix it by hand, at exactly the moment they
> most needed to fill it again."*

**That protection was wired to only one of the two doors.** Traced every
call site:
- `closeMrfIfFilled()` fires on offer acceptance (`offer.service.js:303`). ✅
- `reopenMrfIfUnfilled()` fired **only** on an offer-decision *reversal*
  (accepted → declined, `offer.service.js:312`).
- `setFinalOutcome()` (`pipeline.service.js`) is what actually records
  `backed_out` / `did_not_join` / `joined_and_left` / `candidate_withdrawn`
  — precisely the four outcomes that free a seat — and never called reopen.
  `pipeline.service.js` did not import `mrfClosure.service.js` at all.

`countAcceptedHires()` already excluded those outcomes, so the seat *was*
freed in the count; nothing ever re-evaluated. The requisition stayed
`approval_status='closed'` permanently, which removes the role from JD
filtering everywhere (`getApprovedRoles()` whitelists only
`approved`/`completed`). Realistic path: 1-opening MRF → candidate accepts
(MRF auto-closes) → candidate doesn't join → recruiter marks "Did not join"
→ nobody can screen for that role again. And there was **no in-app way
back**: the only endpoint writing `approval_status='approved'` is the
token-based approve/reject email link, not a recruiter control.

**Blast radius when found:** a read-only check of this environment returned
**0 closed MRFs, 0 stuck** — latent, not yet biting here. Staging/production
should be checked with the query in the plan file before assuming the same.

**Fix:**
- `setFinalOutcome()` now calls `reopenMrfIfUnfilled(pipeline.mrf_id)` when
  the closure outcome is one that frees a seat, and writes a matching audit
  note ("Requisition re-opened — N/M opening(s) now filled") mirroring the
  reversal path. No extra guarding needed at the call site:
  `reopenMrfIfUnfilled` is already idempotent, null-safe (keyword shortlists
  carry `mrf_id=null`), conservative (only reopens MRFs in the `closed`
  state it set itself) and never throws.
- **`VACATING_OUTCOMES` moved to `config/pipelineStages.js`** rather than
  being exported from the closure service. Both paths that can free a seat
  now import one shared list from pure config — a second hand-maintained
  copy is exactly how these drifted apart in the first place. It also sits
  naturally beside `FINAL_OUTCOMES`, which it is derived from.
- Added `src/tests/mrfClosure.test.js` (5 tests) guarding the invariant in
  both directions: every vacating outcome must be a real `FINAL_OUTCOMES`
  value (a typo would silently never match), the four fall-through closures
  must free the seat, and `JOINED` must NOT — the 90-day `offerSweep`
  auto-close records `JOINED`, so if it ever became vacating, every hire who
  actually started would silently re-open the requisition they filled.
  Suite: 65 passing.

**Caught while writing the test:** importing the closure *service* into a
test pulls in Redis and the socket layer, whose module-level connections keep
the process alive and hang `node --test` (the suite went from 0.5s to a 120s
timeout). Sourcing the constant from import-free config fixes it — and is the
better architecture regardless.

**Still open, deliberately out of scope:** when a requisition closes, nothing
flags or notifies the *other* candidates still in flight against it. They
stay active on the board with no indication they are chasing a filled role.
That needs a product decision about what should happen to them, so it was not
bundled in here.

**Files:** `backend/src/config/pipelineStages.js`,
`backend/src/services/pipeline.service.js`,
`backend/src/services/mrfClosure.service.js`,
`backend/src/tests/mrfClosure.test.js` (new).

---

## 14. Board showed candidates chasing filled roles, and never let finished ones go

Closes the item left open in #13. Two gaps, both cases of the board quietly
showing something other than the truth.

### Candidates chasing a requisition that already filled

When `closeMrfIfFilled()` closes an MRF, other candidates may still be
mid-pipeline against it — at Tech 2, at Documents. Nothing flagged them and
nobody was told, so a recruiter could keep interviewing, scheduling and
chasing documents for a role filled last week. Confirmed:
`mrfClosure.service.js` referenced `rpa_candidate_pipeline` only inside its
*count* query; it never looked at the journeys still running.

- `listPipeline()` now returns `mrf_closed` per card. **Free to compute** —
  the board query already loads each journey's MRF via
  `rpa_shortlisted_candidates: { include: { mrf: true } }` — so no new query.
- The board shows an orange **"Role filled"** warning tag (reusing the
  existing `tag-attention` treatment) on any card whose requisition is closed
  while the journey itself is still open, with a tooltip saying to continue
  only if re-opening the role or holding the candidate as a backup.
- `closeMrfIfFilled()` now counts the stranded journeys (open journeys for
  that MRF, minus the accepted hires who filled it) and folds the number into
  the existing "Requisition closed" notification: *"… 3 candidates are still
  in progress for this role"*. A card badge only helps someone already
  looking at the board; the notification reaches them at the moment they can
  act. Wrapped in the same best-effort guard as everything after the closing
  write — a counting failure must not misreport the closure.

**Per explicit decision, nothing is auto-decided about a candidate
mid-process.** Auto-closing them would silently end real applications and
fire rejection emails, and is hard to undo now that #13 makes requisitions
re-openable. Recruiters keep control; the system just stops staying silent.

### Finished candidates never left the board

`setFinalOutcome()`'s own notification comment says *"the card is about to
leave the board"* — but `listPipeline()`'s `where` clause had **no
`final_outcome` filter**, so closed journeys sat in their last column
indefinitely, greyed but still occupying space and inflating column counts.
Stated intent and actual behaviour disagreed.

- `listPipeline()` now defaults to `final_outcome: null`, with an
  `includeClosed` filter (`include_closed` query param, following the
  existing `on_hold_only === '1'` convention) to bring them back.
- Added a **"Show closed"** checkbox beside the On Hold / Stuck filters,
  wired into `anyFilterActive` and `clearFilters` so #12's "Clear filters"
  resets it too.
- `total` now counts live candidates, which is the more useful number.
- Deep links are unaffected: `/pipeline?candidate=<id>` opens the drawer via
  `getPipelineDetail(id)`, independent of the board query, so a notification
  linking to a closed candidate still works with them hidden.

**Impact check on this environment:** 20 journeys, **0 currently closed** — so
hiding them changes nothing visible here today. It stops the board silting up
as journeys start completing.

**Verification:** backend syntax-checked, unit suite 65 passing, frontend
builds clean. The end-to-end paths (flag appears for in-flight candidates on
a filled requisition, disappears once #13 re-opens it, "Show closed" toggles
correctly) still need a real click-through.

**Files:** `backend/src/services/pipeline.service.js`,
`backend/src/services/mrfClosure.service.js`,
`backend/src/controllers/pipeline.controller.js`,
`frontend/src/pages/Pipeline.jsx`.

---

## 15. 🚨 Requisition closure destroyed approval + workflow state (root-cause fix)

**Issue:** closure expressed "all openings filled" by **overwriting two status
columns that mean something else**, saving neither prior value:

| Column | Overwritten to | Restored as | Consequence |
|---|---|---|---|
| `rpa_mrf.approval_status` | `'closed'` | hardcoded `'approved'` | **20 of 41 MRFs are `'completed'`** — the most common status. `getApprovedRoles()` gates `'completed'` on `approved_by_abhijit` but treats `'approved'` as unconditional, so a completed requisition that filled and re-opened came back as `'approved'` and **permanently escaped that gate**. 5 MRFs currently rely on it. |
| `rpa_mrf_jd_send.mrfstatus` | `'closed'` | hardcoded `'approved'` | Not a mirror — it is the protected **"raise status"** workflow column (`pendingfromleader` 80, `managersubmitted` 29, …) that the MRF page filters, displays and exports, and which `mrf.controller.js` documents as not user-writable. The write was an `updateMany` on a loose non-FK `mrf_id`: **MRF 123 has 24 linked rows**, so one close→reopen would rewrite all 24. |

**Root cause:** "approved" and "filled" are independent facts sharing one
column. Patching the restore value would have preserved the bug's shape.

**Fix — give fill state its own column:**
- New `rpa_mrf.filled_at TIMESTAMPTZ NULL` (DDL
  `2026-08-11-mrf-filled-at.sql` + README), partial index on
  `filled_at IS NULL` since every hot read is "still hiring?".
- `closeMrfIfFilled()` now writes **only** `filled_at`, via a **conditional
  `updateMany` on `filled_at: null`** — making closure idempotent and killing
  the duplicate "Requisition closed" notification possible when two
  acceptances land together. `reopenMrfIfUnfilled()` just clears it; there is
  nothing to restore and nothing to guess.
- **The `rpa_mrf_jd_send` write is deleted entirely.** Verified safe: the MRF
  page overlays `approval_status` from the joined `rpa_mrf` and never read
  `mrfstatus` for it. The 24-row blast radius is gone.
- One shared `isMrfFilled()` in `config/pipelineStages.js` (pure, import-free
  so it stays testable — see #13) used by all consumers, which now filter
  explicitly: `getApprovedRoles()`, the dashboard Active-MRF tile, pipeline
  board cards, and `attachApprovalStatus()` (list + CSV export).
- **`getApprovedRoles()` parenthesisation was a live trap:** its clause is
  `A OR (B AND C)`, and `AND` binds tighter than `OR` — appending
  `AND filled_at IS NULL` unbracketed would have left plain `'approved'` rows
  skipping the filter entirely. Now explicitly bracketed, with a comment.
- MRF page shows a separate **FILLED** badge beside the real approval status
  (two independent facts, two independent things); CSV gains an "Openings
  Filled" column. Legacy `'closed'` rows now display as "CLOSED (legacy)".
- Shortlisting into a filled requisition still **works** (backup candidates
  are legitimate) but is now logged server-side — it usually means a stale
  cached roles dropdown.

**Verified end-to-end against real data**, not just unit-tested — took MRF 29
("RPA Junior Developer", `completed`) through a full cycle:
```
1. in JD filtering before fill : true
2. in JD filtering when filled : false
3. approval_status while filled: completed  <- PRESERVED (was 'approved' before)
4. after re-open               : completed | filled_at: null
5. back in JD filtering        : true
```
Unit suite 95 passing (4 new `isMrfFilled` cases incl. legacy + null-safety);
frontend builds clean. DDL applied, `prisma db pull` done, `filled_at`
confirmed readable through the client.

**Two caveats:**
1. `prisma generate` reported `EPERM` renaming the query-engine DLL — a
   running backend holds it. Functionally fine (the client resolves
   `filled_at` correctly; the blocked step only replaces an *unchanged*
   binary), but **stop the backend and re-run `npx prisma generate`** for a
   clean state before deploying.
2. Backfill sets `filled_at` on pre-existing `approval_status='closed'` rows
   but **deliberately leaves that status alone** — the true prior value was
   destroyed and guessing repeats the original mistake. **0 such rows in
   dev**; run the README's queries against staging/production first, and set
   those by hand.

**Files:** `backend/prisma/ddl/2026-08-11-mrf-filled-at.sql` + `.README.md`
(new), `backend/src/config/pipelineStages.js`,
`backend/src/services/mrfClosure.service.js`, `pipeline.service.js`,
`screening.service.js`, `dashboard.service.js`,
`backend/src/exports/mrf.export.js`, `backend/src/controllers/mrf.controller.js`,
`backend/src/tests/mrfClosure.test.js`, `frontend/src/pages/MRF.jsx`.

---

## 16. Recruiters were created without Candidate Pipeline access

**Issue:** the pipeline had to be reachable by all recruiters, admins and
super admins. Admins and super admins were already fine — `checkModuleAccess`
(and the frontend `ModuleRoute`) both bypass the check for admin-tier roles.
Recruiters were not.

**Root cause:** `DEFAULT_MODULES_BY_ROLE.recruiter` in `admin.controller.js`
seeds a new recruiter's module rows, and **it was never updated when the
Candidate Pipeline module shipped in Phase 3 M1**. Every recruiter created
since then arrived with no `recruitment_pipeline` row — the route silently
redirects them to `/dashboard` and the API answers 403. Easy to miss because
the comment directly above that list already claimed recruiters get *"every
module except the admin-portal gate (`hr_admin`)"*, which was not true.

**Audit of live data** confirmed exactly one affected account:

| user | role | pipeline access (before) |
|---|---|---|
| #2 admin | admin | YES (bypass) |
| #14 naveen.satywali568 | recruiter | **NO** |
| #15 chhaya.verma598 | admin | YES (bypass) |
| #16 harish.m | vendor | NO — correct, vendors are confined by design |
| #27 saukumar | recruiter | YES (granted by hand at some point) |

**Fix:**
- Added `recruitment_pipeline` to the recruiter defaults, so every new
  recruiter gets it automatically.
- New `backend/prisma/grant-recruiter-pipeline-access.js` repairs accounts
  created while the default was wrong. Idempotent — leaves enabled rows alone,
  re-enables a explicitly disabled row, creates a missing one — and supports
  `--dry-run`. Scope is recruiter-tier only (`recruiter` + legacy `hr`):
  admin-tier needs no rows, and **vendors are deliberately excluded**, matching
  how they are confined elsewhere (`VENDOR_ALLOWED_PATHS`, and their exclusion
  from `NOTIFY_ROLES`).
- Ran it here: granted to #14. Re-audit now passes for every account —
  recruiters and admin-tier have access, the vendor correctly does not.

**Correction worth recording:** the script first told users to sign out and
back in. Checking `auth.controller.js` showed `GET /api/auth/me` re-queries
`rpa_module_permissions` on **every call** rather than trusting anything baked
into the token — so a page refresh is enough. The message now says that.

**For staging/production:** run
`node prisma/grant-recruiter-pipeline-access.js --dry-run` first to see who is
affected there, then re-run without the flag. Their recruiter list differs
from dev, so the count will differ.

Unit suite 95 passing.

**Files:** `backend/src/controllers/admin.controller.js`,
`backend/prisma/grant-recruiter-pipeline-access.js` (new).
---

## 17. Export Functionality wherever required (Phase 2)

**Issue:** The product had effectively no export. The backend had zero export
endpoints; the frontend had exactly one — `MRF.jsx` `handleExportCSV()` — which
was capped at 1000 rows, emitted no UTF-8 BOM (so Excel mangled non-ASCII
names), leaked a blob URL per click, wrote the literal text `null` into cells,
and had no CSV-injection guard on LLM-parsed resume data. Every other list
surface had no way to get data out at all.

**Fix:** One shared server-side CSV mechanism wired into all 12 list surfaces
(MRF, Candidates, Dashboard, Pipeline, Screening JD + Keyword, HR Upload,
Vendor Upload, Vendor Dashboard, Analytics, Email Delivery, Admin
Users/Companies). Exports always return the full filtered set, never the page
on screen. Also closed a **pre-existing vendor-isolation hole** on
`GET /api/candidates` (a vendor token could read the whole candidate table) and
fixed `buildWhereClause` silently discarding filters.

**Full detail:** [CHANGES-csv-export.md](CHANGES-csv-export.md).

---

## 18. No way to export a single requisition from the MRF details modal

**Issue:** MRF had exactly one export — the toolbar button above the Records
table, which pulls the filtered **list** (15 columns of `rpa_mrf_jd_send` plus
approval/fill state). The content people actually want out of the app lives one
click deeper, in the details modal: the **New MRF Request Info** section and the
~45-field **Submitted MRF Details** section the Hiring Manager filled in. None of
it was exportable. A recruiter forwarding one requisition to an interview panel
had to screenshot the modal or retype fields.

**Fix:** An `Export CSV` button in the modal footer that emits one file for the
open requisition, covering both sections. It goes through the existing
`runExport` path, so it inherits the row cap, the `rpa_processing_log` audit row,
the UTF-8 BOM, the CSV-injection guard and the shared `ExportButton` loading/error
handling — no new client-side exporter.

The file is **transposed** relative to every other export: `Section, Field, Value`,
one row per field, instead of one row with 65 columns. A 65-column single-row
file is unreadable — you scroll sideways to find one value. Accepted trade-off:
two of these files do not stack into a table, which is fine for a sheet that gets
read, printed and forwarded rather than pivoted.

Details worth recording:

- **The status labels follow the modal, not the list table.** These genuinely
  disagree: the table renders `managersubmitted` as "MANAGER SUBMITTED" (via
  `mrfStatusLabel` in `mrf.export.js`) while the modal's tag reads "COMPLETED".
  The export is taken from the modal, so it mirrors `getWorkflowSummaryTags`
  instead — otherwise someone comparing the file to the screen it came from would
  think it had picked up a different record. Both mappings now exist, each
  commented with which surface it serves.
- **Gated "Other" fields follow the modal's visibility rule.** Rows keep stale
  `*_other` text from before a select was changed away from "Other"; the modal
  hides those fields, so the export omits them rather than putting invisible data
  in the file.
- **Approval status and fill state stay independent** — same rule as #15. A
  requisition can be `APPROVED` and have `Openings Filled = YES`.
- **The row-count header is suppressed** for this endpoint. A "row" here is a
  *field*, not a record, so the shared toast would have read *"Exported 61 rows."*
  for one MRF. `sendCsv` skips null-valued headers, so passing
  `'X-Export-Row-Count': null` makes `downloadFile` report `null` and the toast
  falls back to *"Exported CSV."*
- **View mode only.** The file is built from the database, so offering the button
  mid-edit would hand back values that silently disagree with the unsaved ones on
  screen.
- Excluded as not modal-visible: `email_body_content` / `emailbody` (HTML blobs),
  the attachment path columns, `existing_resource_allocation`, `submitter_email`
  (already present as "Manager Email"). Added *beyond* the modal: MRF Request ID,
  Linked MRF ID and CC Email — a file that has left the app has to be traceable
  back to the record it came from.
- Same `MRF_EXPORT_ROLES` + `exportLimiter` as the list export; vendors stay
  excluded because the file carries budget figures.

**Files:** `backend/src/exports/mrfDetail.export.js` (new),
`backend/src/tests/mrfDetailExport.test.js` (new),
`backend/src/controllers/mrf.controller.js`, `backend/src/routes/mrf.routes.js`,
`frontend/src/services/mrfService.js`, `frontend/src/pages/MRF.jsx`.

Unit suite 107 passing (12 new, all DB-free); frontend production build clean.
**Full detail:** [CHANGES-csv-export.md](CHANGES-csv-export.md) §6.

---

## 19. 🚨 Total Experience was fabricated on every HR upload

**Issue:** QA (HRU-01/HRU-02) reported *"Total Experience is not updating when we
checked in the Search Candidate page."* It was worse than not updating — the value
shown was frequently one the resume never contained. Three compounding causes in
`hrUpload.service.js`:

1. Whenever a resume had **any** employment-history row, the parser's own
   `TotalExperienceYears` was *unconditionally* overwritten by date arithmetic.
   `parseDate()` understood only `MM/YYYY`, `YYYY/MM`, `Month YYYY` and whatever
   `new Date()` accepts — so `Jun-2022`, `May'21`, `05.2022` and `2020 – 2022` all
   failed, every row scored 0 months, and the candidate was stored as **`"0"`**.
2. When the parser returned nothing, a hardcoded **`"2"`** was written (`"3"` on the
   duplicate path).
3. `"0"` is a non-empty string, so `getMissingFields()` never flagged it. The
   candidate was marked `ACTIVE`, no missing-data email went out, and the wrong
   number was never chased.

The field name is consistent across every layer (`TotalExperienceYears` → API
`experience` → `CandidateDetailCard`), so there was no mapping bug to find — the
data was wrong before it was ever written.

**Fix:** the date-computed total now wins **only when it computed something**;
otherwise the resume's own statement stands, and null (not `"0"`) is stored when
there is neither — null being what the missing-data flow chases. `parseDate` reads
`Mon-YYYY`, `Mon'YY`, `MM.YYYY`, `MM YYYY` and bare `YYYY`; `monthsBetween` no
longer returns a negative span for a reversed pair.

The rest of the same block was fabricating too, and all of it is now `null`:
`ContactNumber "9876543210"`, `PositionApplied "Software Developer"`,
`HighestQualification "B.Tech"`, `CurrentLocation "Delhi"`, and on the duplicate
path `"Software Engineer"` / `"AAPNA Infotech"` / `"3"`. This is not cosmetic — the
codebase already called the phone default a hazard (*"must never be used as a match
key"*, `PLACEHOLDER_CONTACT`), and a fake number is exactly what would defeat the
missing-data flow QA has queued as HRU-07/HRU-08.

Also fixed alongside, same block:

- **Five parsed columns were never written.** `NoticePeriod`, `CTC_LPA`,
  `ExpectedCTC_LPA`, `JobSource`, `RecruiterInfoAAPNA` were used to derive
  `NoticePeriodDays`/`ExpectedCTCNumeric` and then discarded, so View Details showed
  those fields blank while the numeric shadows held real values.
- **`YearsWorked` per job** was derived from the *length of the history array*, so
  every row whose dates would not parse reported 0 years worked.
- **A live crash path.** `TotalExperienceYearsNumeric` is `Decimal(5,2)` (max
  999.99) and `parseExperienceNumeric` takes the first number in the string, so a CV
  saying "since 2019" yields 2019 — which Postgres rejects and Prisma turns into a
  thrown create that loses the candidate. Survivable while the column was fed a
  computed span or a hardcoded `"2"`; a real risk now the parsed value is trusted.
  Out-of-range readings are dropped and logged, not clamped to 999.99.

The date/experience logic had **two copies** in the file (one inline, one in an
unused `calculateExperience()`); both are replaced by one tested module.

**Existing rows:** `npm run report:experience:staging|prod` is a **read-only**
diagnostic that counts and samples rows likely carrying a fabricated value. No
backfill has been run — the decision waits on that number, since `"2"` is also an
ordinary genuine answer.

**Files:** `backend/src/utils/experienceParser.js` (new),
`backend/src/tests/experienceParser.test.js` (new, 15 DB-free tests),
`backend/scripts/report-experience-anomalies.js` (new, read-only),
`backend/src/services/hrUpload.service.js`, `backend/package.json`.
Unit suite 122 passing.

---

## 20. Interviewer name missing from the interview invitation email

**Issue:** QA (T1-09, and again in the sheet's Feedback block) — *"An email is
sending to the interviewers but interviewer name is not coming automatically in body
content; user has to provide manually."*

The column, the API field and an MRF-name fallback **already existed**, and the name
was already persisted on every booking (`rpa_interview_schedule.interviewer_name`).
Two things were missing: `interviewTokens()` had no `interviewer_name` key, and the
three panel templates opened with a bare `<p>Hi,</p>`. Since `compileTemplate` leaves
unknown tokens verbatim, a template carrying the placeholder would have rendered
`Hi {{interviewer_name}},` literally. The pre-interview *reminder* template had been
doing this correctly all along — that pattern was copied.

**Fix (the preview path is the part that matters):** the modal posts its compiled
`panel_body` back on submit and the service prefers it over recompiling
(`panelBody ?? defaults.panel.body`). **A send-time-only fix would have been silently
overridden by the body the preview compiled** — so the name is threaded through the
preview endpoints as well as the send paths, and into the preview's react-query key.

- `interviewer_name` added to `interviewTokens()`, resolved by a new
  `interviewerGreeting()`: the name, `"all"` when more than one mailbox is invited
  (one email serves the whole panel), `"there"` when no name was captured. Never
  blank, so `Hi {{interviewer_name}},` cannot render as `Hi ,`.
- Threaded into all six `buildInterviewEmails` call sites — schedule, reschedule and
  cancel, for both the send and the preview. Cancel/reschedule read it off the live
  booking; schedule takes what the recruiter is typing.
- An **Interviewer name** input added to the schedule modal, prefilled from the MRF
  hint already displayed read-only above it. An input rather than pure derivation is
  required: Technical Round 3 has no MRF interviewer column at all, and the MRF field
  is free text that is often a team rather than a person.

**⚠️ Deploy step:** the template bodies only change once
`prisma/seed-email-templates.js` is re-run, and that seeder updates by name — **it
overwrites any edits HR has made to those three templates in the Email Templates
UI**. Check before running it on staging/production. The token-map change works
immediately for any template that already contains the placeholder.

**Files:** `backend/src/services/interviewSchedule.service.js`,
`backend/src/controllers/pipeline.controller.js`,
`backend/prisma/seed-email-templates.js`,
`frontend/src/components/pipeline/PipelineDrawer.jsx`,
`frontend/src/services/pipeline.js`.

---

## 21. Documents: the submit button existed, the acknowledgement did not

**Issue:** QA Feedback — *"In Documents column when candidate opens the upload
documents option there should be submit button."*

**The button has been there since item #11 above** (`DocumentUpload.jsx`,
staged-then-submit). What is missing is any sign that pressing it worked. `allDone`
required every item to be **`verified`** — an HR action that can take days.
Immediately after submitting, every item is `uploaded`, so the candidate was handed
back the same checklist with a greyed-out button reading *"Choose your files to
continue"*, the success toast already faded. That reads as "there is no submit
button", which is very likely what was being reported.

**Fix:** a third state between outstanding and verified. When nothing is staged and
every item is `uploaded` or `verified`, the page shows *"Documents received — thank
you"* with an explanation that review is pending and the link stays valid. The
checklist stays visible **below** the acknowledgement rather than replacing it, so a
later rejection flips one row back to actionable and the candidate can still see and
replace it. The disabled button reads *"Nothing left to send"* instead of asking for
files that have already been sent.

Recorded so this does not get re-filed: **the submit button was not missing.**

**Files:** `frontend/src/pages/DocumentUpload.jsx`.

---

## 22. Documents: reminders were already automatic — and had two counter bugs

**Issue:** QA Feedback — *"In Documents Option there should be Reminder that should
sent automatically, currently it needs to share manually."*

**The daily sweep has shipped since Phase 3 M4** (`jobs/documentReminder.js`,
registered in `server.js`, first reminder after 2 days then daily, max 3). The panel
simply never said so: its helper text described only the secure link and the manual
*"Send reminder"* button, so a reviewer reasonably concluded chasing was manual. The
Offer panel already advertises its own schedule — that precedent was followed.

**Fix (UI):** the Documents panel now states the real cadence, and the button reads
*"Send a reminder now"* so it presents as an override rather than the only
mechanism.

**Fix (two real defects found while confirming the above):**

1. `sendReminder()` stamped `last_reminded_at` and incremented `reminder_count`
   **even when the email failed**. The sweep selects on `reminder_count < maxCount`,
   so three bounced sends exhausted a candidate's reminder budget on emails they
   never received, and they were never chased again. The counters now move only on a
   successful send, leaving the sweep free to retry.
2. `requestDocuments()` re-opened the request and refreshed `requested_at` but left
   the counters, so a **re-request after 3 reminders fell permanently outside the
   sweep's filter** — reopened, then never followed up. A re-request now resets both.
3. Related, fixed alongside: the post-rejection re-request sends the reminder
   template directly and did not stamp `last_reminded_at`, so the daily pass could
   chase the candidate again hours after a rejection email landed. It now stamps the
   timestamp without incrementing the count — HR's rejection should not consume the
   candidate's reminder budget.

Recorded so this does not get re-filed: **automatic reminders were not missing.**

**Files:** `backend/src/services/documentCollection.service.js`,
`frontend/src/components/pipeline/PipelineDrawer.jsx`.
