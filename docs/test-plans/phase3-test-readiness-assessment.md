# Phase 3 — Test Readiness Assessment

**Written:** 2026-08-19
**Author:** Claude (pre-execution review of the two Phase 3 test plans)
**Purpose:** Answer one question — *what do we need before a full 122-case pass can run, and what will
stop us?* This is not a test plan. The test plans already exist and are good. This is the gap list
between "we have a plan" and "we can execute it."

> **Case count corrected 2026-08-21: it is 122, not 117.** The main plan defines 90 (PIPE 16,
> SCHED 19, DOC 13, OFFER 16, VEND 16, E2E 5, N 5) and the companion plan 32 (OUT 15, CCT 5,
> ZEK 12). Other docs quote 117, ~110 and ~90 — all wrong or loose. **122 is the arithmetic.**

**Decisions taken (2026-08-19):** demo runs on **staging**, not production. Coverage target is the
**full pass** (both documents). A **test harness will be built** rather than running everything by
hand. **Defects found will be fixed** as part of this work.

**Update 2026-08-19 (post-decision):** B1 resolved — proceeding on the shared staging DB (Option C).
B2 resolved — three accounts supplied and **verified against staging** (§2.2). One new blocker
surfaced during that verification: **B5**, the recruiter account cannot reach `/api/pipeline/*` at
all. See §2.5.

---

## 1. Executive summary — read this if nothing else

The test plans are unusually well written. They are specific, they name exact error strings, they
distinguish "verify" from "assume," and the execution playbook already solves the cron-waiting
problem. **The plans are not the bottleneck.**

Four things block a full pass today. Two are mine to fix, two are yours.

| # | Blocker | Severity | Owner | Status |
|---|---|---|---|---|
| **B1** | **Dev and staging share one database.** `.env`, `.env.development` and `.env.staging` all point at `20.244.34.176/recruitmentautomationdb`. There is no isolated test database. | 🔴 Critical | Decision | ✅ **Accepted** — proceeding on shared staging, mitigations in §2.1 |
| **B2** | **No test user accounts exist**, and no script creates them. | 🟠 High | You | ✅ **Resolved** — 3 accounts supplied and verified |
| **B5** | **Recruiter account has no `recruitment_pipeline` toggle** — cannot reach `/api/pipeline/*` at all. Blocks most of Block A. | 🔴 **Critical** | Me (1-cmd fix) | 🔴 **Open** — see §2.5 |
| **B3** | **Zeko is not configured** — `ZEKO_API_URL` is blank in every env file. Caps the companion plan's ZEK block. | 🟠 High | Unresolved | 🟠 Open — ZEK-05+ → Blocked |
| **B4** | **Graph attendance permission still pending with IT.** Caps SCHED-11's automatic path. | 🟡 Medium | IT | 🟡 Open — nudge path still testable |

Plus one thing worth knowing before the first email goes out: **panel and interviewer emails are NOT
redirected on staging.** They really send. Details in §3.

B5 is the only thing now standing between us and starting execution, and it is a one-command fix
using a script that already exists.

---

## 2. Blockers in detail

### 2.1 B1 — Dev and staging are the same database 🔴

This is the one that worries me most, and neither test plan mentions it.

```
.env              → 20.244.34.176:5432/recruitmentautomationdb
.env.development  → 20.244.34.176:5432/recruitmentautomationdb   ← same
.env.staging      → 20.244.34.176:5432/recruitmentautomationdb   ← same
.env.production   → 20.244.34.176:5432/recruitmentautomationdbProd
```

The deployment runbook documents this as intentional ("development shares the staging database").
That is fine for feature work. It is **not** fine for the pass we are about to run, because this
suite deliberately does destructive and stateful things:

- Backdating `joining_date` by 90 days to trigger auto-close (OFFER-15)
- Backdating `lockForNinetyDays` to force expiry (VEND-05)
- Setting a lock to a **malformed** date, `"2026-13-45"` (VEND-08)
- Freezing a lock to the sentinel `'9999-12-31'` (PIPE-10)
- Deactivating pipeline stages while candidates sit on them (PIPE-07)
- Firing deliberate race conditions against MRF closure (OFFER-10, E2E-04)
- Running cron sweeps at `*/5` or `* * * * *` instead of daily

Staging holds **195 CVs and 101 shortlists** — that is real work product, not scratch data. And
because it doubles as the dev database, anyone doing feature work during the pass is both polluting
our results and exposed to our mutations. A tightened cron left running overnight, as the execution
plan itself warns, will spam inboxes and skew metrics.

There is a cleanup script (`backend/prisma/cleanup-test-data.js`) but it is **not a safety net here**:
it selects rows purely by a `created_at` time window, so on a shared dev/staging DB it will happily
delete a colleague's rows created in the same window. It also cannot reverse the *mutations* above —
only delete *creations*. A backdated `joining_date` on a pre-existing candidate is not recoverable
by it. (Its header docblock is also stale: it references `EMAIL_FORCE_REDIRECT` and an npm script
`cleanup:test:prod`, neither of which exists.)

**Three ways forward, in my order of preference:**

**Option A — Clone staging into a dedicated test database (recommended).**
Same host, new database, e.g. `recruitmentautomationdbTest`. `pg_dump` staging → restore → point a
new `.env.test` at it. Cost: roughly an hour, plus whatever the DB host permits. Buys total freedom
to be destructive, no coordination with anyone else, no cleanup anxiety, and the pass becomes
repeatable — we can reset and re-run, which matters a lot when we start fixing defects and need to
re-verify.

**Option B — Freeze staging for the duration.** Tell the team staging is locked for a test window,
snapshot the DB first (so there is a restore point), run the pass, restore or clean up after.
Cheaper, but needs a real backup taken beforehand and blocks other people's work.

**Option C — Proceed on shared staging with discipline.** Only touch candidates we create, never
mutate pre-existing rows, accept that some cases (VEND-08's malformed date, PIPE-07's stage
deactivation) touch shared config and cannot be fully isolated. Fastest to start, highest risk, and
some results will be less trustworthy because of concurrent activity.

**I recommend Option A.** The deciding argument is not safety, it is *repeatability* — we are also
fixing defects, so we will need to run the same case more than once, and a throwaway database makes
that free.

#### ✅ Decision: Option C — proceed on shared staging (2026-08-19)

Accepted. The mitigations below become mandatory rather than optional, and I will follow them:

1. **Snapshot first.** Before the first destructive case, take a `pg_dump` of
   `recruitmentautomationdb`. This is cheap and is the only real undo we have — the cleanup script
   cannot reverse mutations, only deletions. I will not start Block A without it.
2. **Only mutate rows this pass creates.** The backdating cases (OFFER-15 `joining_date`, VEND-05
   and VEND-08 `lockForNinetyDays`, PIPE-10 lock freeze) run **exclusively** against the seeded test
   candidates, never a pre-existing one.
3. **Record every mutation.** The harness logs each direct SQL/Prisma mutation it performs with the
   before-value, so anything can be hand-reverted even without the dump.
4. **Two cases touch shared config and cannot be isolated** — PIPE-07 (deactivating a stage) and
   PIPE-15 (deactivating the next stage mid-advance) write to `rpa_pipeline_stages`, which is global.
   I will run these in a tight window and re-enable immediately, but while they run, anyone else
   using staging sees the stage disabled. Worth a heads-up to the team on the day.
5. **Tell the team the window.** Concurrent feature work during the pass pollutes results in both
   directions.

Residual risk I am accepting on your instruction: a colleague working on staging during the pass may
see odd data, and cleanup-by-time-window would catch their rows too, so I will **not** run
`cleanup-test-data.js` on this database — teardown will delete by explicit ID list instead.

### 2.2 B2 — Test user accounts ✅ RESOLVED (verified 2026-08-19)

All three accounts were supplied and **verified to exist in the staging DB** with the correct roles:

| Username | Role | User ID | Active | Email |
|---|---|---|---|---|
| `admin` | `admin` | 2 | ✅ | n8npankajmondal@gmail.com |
| `biswajit.sur351` | `recruiter` | 7 | ✅ | aiautomationn8nuser@gmail.com |
| `sahil.dubey673` | `vendor` | 9 | ✅ | genaiuserpankajmondal@gmail.com |

All three are `company_id = 1`, so `restrictToCompanyScope` will not interfere.

Two findings from the verification, one benign and one not:

**Benign — `is_approved = false` on the recruiter and vendor accounts.** I checked whether this
blocks login: it does not. `authenticate()` in `middleware/auth.js` only checks `is_active`, and
`admin.controller.js:234` carries the explicit comment *"is_approved is not enforced at login for
any role."* So both accounts log in fine. **One consequence worth noting:**
`grant-recruiter-pipeline-access.js` filters on `is_approved: true`, so it will skip
`biswajit.sur351` — relevant to B5 below.

**Not benign — see B5 (§2.5).** The recruiter has no `recruitment_pipeline` permission row.

Module toggles as they stand today:

| Account | `recruitment_pipeline` | `vendor_upload` | Other |
|---|---|---|---|
| `admin` | *(n/a — admin tier bypasses `checkModuleAccess` entirely)* | true | 8 more enabled |
| `biswajit.sur351` | 🔴 **row absent** | false | screening, hr_admin, hr_manual_upload, new_mrf, screening_analytics |
| `sahil.dubey673` | 🔴 **row absent** | ✅ true | all others explicitly false |

### 2.5 B5 — Recruiter cannot reach the pipeline API 🔴 NEW

This came out of verifying B2 and it blocks a large part of the pass.

`pipeline.routes.js:15` applies `checkModuleAccess('recruitment_pipeline')` to **every**
`/api/pipeline/*` route. `biswajit.sur351` has no such permission row, so **every pipeline call as
the recruiter returns 403** — not because of the guard under test, but because of a missing toggle.

Why this matters beyond "grant the toggle":

- **Most of Block A is affected.** PIPE-01..16 are meant to run as a normal staff user. As admin
  they would pass trivially (admin bypasses `checkModuleAccess` at `auth.js:130`), which would mean
  testing a code path no real recruiter uses.
- **PIPE-08 would produce a false pass.** It asserts a recruiter gets **403** on stage/outcome CRUD,
  proving `requireAdmin` works. Today a recruiter gets 403 from the *module check* instead — same
  status, wrong reason. We would tick the box having proven nothing. This is exactly the "verify,
  don't assume" trap both plans warn about.
- **VEND-11 needs the opposite of a fix.** It requires the **vendor** to have
  `recruitment_pipeline` switched **on**, deliberately simulating the mis-click M6's `requireStaff`
  defends against. Today that row is absent, so a vendor hitting `/api/pipeline/*` is stopped by
  `requireStaff` first — which is the right answer, but does not prove the fix, because the module
  check would have stopped them anyway. **To test VEND-11 honestly we must first switch the vendor's
  pipeline toggle ON**, then confirm `requireStaff` still refuses. Without that step VEND-11 is
  security theatre.

**Fix (I will do this in the setup step, not asking you to):**

1. Recruiter: `node prisma/grant-recruiter-pipeline-access.js` — the script exists and is
   idempotent. ⚠️ It filters `is_approved: true`, so it will **skip** `biswajit.sur351` as-is;
   I will either set that flag or insert the row directly.
2. Vendor: insert `recruitment_pipeline` **enabled** for user 9 as a deliberate VEND-11 precondition,
   and **remove it again immediately after VEND-11 and VEND-13 pass.** This is a temporary,
   intentionally-insecure state; it must not outlive the test case, and I will call it out in the
   results.

### 2.3 B3 — Zeko not configured 🟠 (unresolved)

`ZEKO_API_URL` is **blank in all four env files**. `ZEKO_API_KEY` is populated in staging/production
only. The companion plan needs "1 published Zeko job synced into `rpa_zeko_jobs` with non-null
`primary_interview_id`" from ZEK-05 onward.

You did not flag this as something you can get, so I am planning around it: **ZEK-05 through ZEK-12
will be recorded as Blocked** with the reason stated, not silently skipped. ZEK-01 to ZEK-04 may
still be partially runnable depending on what they assert — I will confirm when I read that plan's
cases in detail.

This is worth being honest with the client about rather than papering over. M3b (Zeko auto-advance)
is already documented as **not started** and blocked on an unassigned API validation spike, so a
gap here is consistent with the known project position — it is not a new surprise.

If you *can* get a Zeko URL and a published job, say so and this un-blocks cleanly.

### 2.4 B4 — Graph attendance permission 🟡 (IT)

`MS_ATTENDANCE_ENABLED=true` in staging, but the tenant grants are still pending per
`MS-GRAPH-SETUP-FOR-IT.md`: `OnlineMeetingArtifact.Read.All` plus the Teams application access
policy (there is a ready-made `enable-teams-attendance.ps1` for the latter).

Impact is narrower than it sounds. SCHED-11 has two paths; without the grant we can still fully test
the **nudge fallback** path, which is arguably the more important one to verify. Only the automatic
"Teams says they attended" path is blocked.

**One thing here is genuinely high-priority regardless of the grant.** The code review found that
this sweep previously **auto-no-showed every staging interview** because the calendar attendee is
the substituted test inbox rather than the real candidate. It is documented as fixed. I want to
verify that specifically and early, because it is a silent, every-row class of failure — exactly
the kind of thing that would quietly corrupt the rest of the pass while we are looking elsewhere.

---

## 3. Things you should know before the first test email sends ⚠️

**Panel and interviewer emails are NOT redirected to the test inbox on staging.** This surprised me
and it is not called out clearly in either plan.

`emailRecipients.js` has two bypass sets. `NEVER_REDIRECT` covers internal alerts and account
security. But `OPERATOR_ADDRESSED` covers `interviewScheduledPanel`, `interviewCancelledPanel`,
`scorecardInvite`, and `occurrenceNudge` — and those **send for real, to whatever address is typed
into the schedule modal**, on staging.

The reasoning in the code comment is sound: whoever books an interview on staging is naming the
mailbox that should receive it, so redirecting would make the round-trip unverifiable. The candidate
side of the same booking *is* still protected.

**Practical consequence:** during SCHED-01 through SCHED-19, only ever enter interviewer addresses
you control. Do not use a real colleague's or a real client's address as a panel member. It will
reach them, complete with a Teams meeting invite on their actual calendar.

Also note `backendErrorAlert` bypasses the redirect — so **every 5xx we trigger during the pass
emails real developer inboxes** (`hmopuri@`, `pkmondal@`). Since a good chunk of this suite
deliberately provokes errors, expect noise, and warn anyone who will wonder why.

Current staging test inbox: `n8npankajmondal@gmail.com, hmopuri@aapnainfotech.com,
saukumar@aapnainfotech.com`.

### 3.1 Candidate test address (supplied 2026-08-19)

`claudepankajmondal@gmail.com` — to be used as the **candidate** address on seeded `rpa_cv` rows
(resume upload, shortlist, interview scheduling). Being Gmail rather than `@aapnainfotech.com`
matters: `isAdminSender` ([inboundEmailSync.js:97](../../backend/src/jobs/inboundEmailSync.js#L97))
skips internal senders as outbound loopbacks, so replies from an internal address are dropped.
Replies from this one will be processed — which the companion plan's OUT-13/OUT-14 cases need.

Three behaviours to expect, because they are not the same across flows:

**1. It will NOT receive most candidate email on staging — and that is correct.**
`redirectInNonProd` is on, so `resolveRecipients` diverts candidate flows to
`EMAIL_STAGING_RECIPIENTS`. Its real value is as the **stored** candidate address: it proves the
right address is persisted, tokenised into templates, and logged to `rpa_email_messages`, while
delivery stays safely redirected. Check the *content* of what lands in the test inbox to confirm the
correct candidate was addressed.

**2. It WILL receive real mail if used as an interviewer/panel address.** The `OPERATOR_ADDRESSED`
set bypasses the redirect. Entering it as a panel member on SCHED-01/06/07 and as a scorecard
recipient on SCHED-12 gives a genuine round-trip — invite, reschedule, cancellation, scorecard
link — without involving a colleague's mailbox. Recommended for exactly that.

**3. It is silently REPLACED on calendar invites and Zeko.** Both hand-off points run through
`nonProdSafeCandidateEmail`
([graphCalendar.service.js:84](../../backend/src/services/graphCalendar.service.js#L84),
[interviewSchedule.service.js:156](../../backend/src/services/interviewSchedule.service.js#L156)),
which substitutes the **first** address in `EMAIL_STAGING_RECIPIENTS` — currently
`n8npankajmondal@gmail.com`. A Teams invite for this candidate therefore lands there, not here.

Point 3 has a direct bearing on **SCHED-11**. The occurrence sweep matches Teams attendance against
the address actually on the invite — the substituted one. That substitution is the exact mechanism
behind the code review's "auto-no-showed every staging interview" defect. When running SCHED-11, do
not expect the candidate's real address on the invite, and verify the match happens against the
substitute. This is the case I most want to watch closely.

Two more environment facts worth having:

- **The six document/offer cron vars do not exist in any env file.** `DOCUMENT_REMINDER_*` and
  `OFFER_SWEEP_*` fall back to code defaults in `config/index.js` (daily 9am / 7am). The execution
  plan tells you to tighten them in `.env.staging` — you will be *adding* them, not editing them.
  Better still, the harness can invoke the job functions directly and skip cron entirely.
- **`MS_CALENDAR_MAILBOX=pkmondal@aapnainfotech.com`** — staging calendar events land on your own
  calendar. Expect it to fill up.

---

## 4. What already exists that we should use

Worth stating plainly, because the plans undersell it:

- **`supertest` is already installed** (devDependency, 7.1.0) and **imported nowhere.** Zero HTTP
  tests exist. This is the single biggest lever available — the harness needs no new dependency.
- **`npm run test:unit` is the real suite** — `node --test "src/tests/**/*.test.js"`, 11 files,
  all passing. Anything I add matching that glob is picked up automatically.
- ⚠️ **`npm test` is a lie.** It runs `jest --passWithNoTests`, and there is no jest config, the
  project is ESM, and no test is written for jest. It exits green having asserted nothing. If anyone
  has been treating a green `npm test` as evidence, that is worth knowing. I would fix this to
  point at the real suite.
- **All 19 implementation files named in the test plan exist.** Nothing has been renamed or deleted.
  (Minor doc nit: the plan lists `pipeline.controller.js` without a directory; it lives in
  `controllers/`.)
- **Four seed scripts exist** — email recipients, pipeline stages, document checklist, email
  templates. The last has no npm script and must be run directly.
- **13 ad-hoc probes in `src/scratch/`**, several reusable. `check_settings.js` prints
  `redirectInNonProd` and `testRecipients` — a good pre-flight check before every session.
- **No Postman/Thunder/.http collection exists.** Nothing to import; the harness is the answer.

---

## 5. What I propose to build

Given "build a harness" and "fix defects found," here is the shape. Detail goes in the plan file;
this is the summary so you can push back on the approach before I start.

**Layer 1 — Seeding and reset.** An idempotent script that provisions the full §1.3 test fixture:
3 candidates, the vendor-sourced one **through the real `POST /api/vendor/upload` path** (both plans
are emphatic that hand-setting `source='vendor'` in SQL invalidates VEND-01, the single most
important case in the suite), 2 MRFs at 1 and 2 positions, checklist items, and the three user
accounts if you want me to. Plus a teardown that reverses it.

**Layer 2 — HTTP integration tests via supertest.** This is where the bulk of PIPE/DOC/OFFER/VEND
lives. These cases are almost all "POST this, expect this status and this exact error string" —
mechanical, exactly what automation is good at, and tedious and error-prone by hand.

**Layer 3 — Concurrency drivers.** PIPE-03, PIPE-05, SCHED-13, OFFER-10, E2E-04. Genuinely hard to
do by hand ("two browser tabs" is not a reliable race), and the execution plan flags these as the
highest-value regression checks precisely because they were found by *running* the code. Automated
they become repeatable; manual they are a coin flip.

**Layer 4 — Job triggers.** Call `runApprovalNudges()`, `runPostJoiningAutoClose()`, the document
reminder sweep and the occurrence sweep **directly**, rather than tightening cron and waiting. This
removes most of the waiting the execution plan budgets for, and removes the "revert every cron value
afterwards" risk entirely.

**Manual-only, and honestly so.** Some things must be eyes-on and I will not pretend otherwise:
Teams/Outlook round-trips (SCHED-01/06/07), OneDrive file landing (DOC-03), the UI rendering cases
(SCHED-18's report modal, N5's error propagation across 5 screens, O7's `daysLeft`), DOC-04's
client-side validation gap, and email *content* checks — VEND-01 and VEND-03 need a human to read
the vendor's copy and confirm no candidate free text leaked. That last one is a privacy check; it
deserves human eyes.

**On fixing defects.** The execution plan is right that fixing mid-pass masks what the next case was
supposed to catch. I will run a block, log defects, finish the block, then fix — not interleave. The
four already-known open findings in scope (O3 client-side upload validation, O4 scorecard occurrence
gate, O7 `daysLeft` null guard, W2 amend-decision UI) I would fix *after* the pass confirms they are
still real, since some may have been closed since the review.

---

## 5.1 Pre-flight findings (verified against staging, 2026-08-19)

Checked before building the fixture. Recorded because several affect expected results.

**Snapshot taken.** `pg_dump` custom-format, PostgreSQL 18.1 server / 18.3 client, 187 MB → 13 MB,
all 46 tables. Verified restorable via `pg_restore --list` (489 TOC entries, 46 TABLE DATA). Stored
at `.test-snapshots/` with a README covering restore procedure. ⚠️ The directory was **not**
git-ignored — a 13 MB dump of real candidate data was one `git add -A` from being committed. Added
`.test-snapshots/` and `*.dump` to `.gitignore`.

**Unit baseline is green: 182 tests, 10 suites, 0 failures.** Note the module status doc claims 55
automated tests — the suite has since grown to 182. Anything failing after this point is ours.

**Fixture prerequisites all present:**
- Document checklist: **3 active items** (`payslips_last_3_months`, `permanent_address`,
  `government_id`) — DOC-01 can run. Its negative branch (zero active items → 400) requires
  temporarily deactivating all three; that is global config, so same caution as PIPE-07.
- Pipeline stages: **12 rows, 11 active.** `shortlist` (sort 10) is inactive; journeys start at
  `zeko_hr` (20) as the plan assumes. `tech3` and `client` are `is_optional` — both needed for
  PIPE-16 (`skip_optional_next`).
- Outcome reasons: **9 active**, exactly one `is_other` (id 9, "Other reasons") — PIPE-02's
  other-text branch is testable.
- Email templates: 42, including **all six `GENERIC_FALLBACK_BY_OUTCOME` names verified present**.

**⚠️ `rpa_stage_email_templates` is EMPTY (0 rows).** Every outcome email will therefore resolve via
the generic fallback in `resolveTemplate()`
([stageNotification.service.js:106](../../backend/src/services/stageNotification.service.js#L106)),
not a stage-specific mapping. This is functional — but it means a default pass exercises **only the
fallback path**, and the mapping path ships untested. W3 in the code review said this mapping was
"not built"; module status says the Outcome Emails tab shipped in M6. Both can be true: the UI
exists, nobody has used it. **I will add at least one mapping and test both paths**, otherwise we
sign off on a feature with zero rows behind it.

**RT question #5 is already answered in code.** `SILENT_FINAL_OUTCOMES`
([stageNotification.service.js:81](../../backend/src/services/stageNotification.service.js#L81))
hard-blocks candidate email for `joined`, `joined_and_left`, `backed_out`, `did_not_join`,
`candidate_withdrawn` — before any template lookup, so an admin mapping one in the UI still cannot
send. Yet templates named `Closure — Joined`, `— Backed Out`, `— Candidate Withdrawn`,
`— Did Not Join`, `— Joined and Left` all exist and are **active**. Those are the "5 closure
templates that will never send." PIPE-09's expected result for these 5 is therefore **no email**,
and that is deliberate, not a defect. RT's decision is only whether to keep it — it does not change
what the test should assert today.

**Baseline data (so I can tell my rows from pre-existing ones):** 20 journeys, all open, sources
`screening_shortlist` (18) and `recruiter` (2). **Zero vendor-sourced journeys exist** — confirming
VEND-01 has genuinely never been exercised on this database, exactly as the M6 changelog says. 41
MRFs. **No `rpa_cv` row uses `claudepankajmondal@gmail.com`**, so the fixture starts clean.

---

## 6. Open questions for RT that change what "pass" means

You flagged these as gettable. Two of them change expected results, so they matter before we record
anything:

1. **The five closure templates that never send.** PIPE-09 exercises all 8 final outcomes.
   `SILENT_FINAL_OUTCOMES` governs which send email. Without an RT answer I will **record actual
   behavior** rather than pass/fail it — otherwise we are asserting against an undecided spec.
2. **Document retention.** No threshold decided, so no archive job was built. DOC-13 asserts that no
   delete path exists — currently a *pass* by design. If RT decides on retention, DOC-13's meaning
   inverts. Worth confirming before sign-off so the checkbox means something.
3. **SCHED-17's silent truncation.** HR scorecard fields silently truncate past `HR_FIELD_MAX`
   rather than 400-ing. The plan itself asks whether that is acceptable UX. Needs a decision, not a
   test result.

Not blockers — but each one is a case where I would otherwise be inventing the expected value.

---

## 7. My honest read on the client presentation

You said the motivation is presenting to the client without bugs or issues. A few observations
offered directly, since they affect how you plan the meeting rather than how I run the tests.

**The demo is on staging, which is the right call.** Production has **0 of 18 Phase 3 tables** — the
entire phase is undeployed. Demoing staging avoids coupling a client meeting to a migration.

**"Without any bugs" is not quite the achievable goal, and that is fine.** There are 3 material and
6 minor findings already documented as open, plus 2 known feature gaps in the companion plan (email
open tracking and threaded reply are *tracker-says-complete, code-says-absent* — those are the ones
that would sting if a client asked). A full pass will find more. The achievable goal is: **no defect
on the path you demo, and every other known defect written down with a disposition.** A client who
is told "we found 6 issues, 4 are fixed, 2 are cosmetic and scheduled" trusts you more than one who
is shown a flawless demo and later discovers a bug list.

**The highest-risk item for a live demo is VEND-01.** Both plans call it the single most important
case. The vendor dual-notification was documented as built since M1 and **never fired once** until
M6 built it properly. If a vendor-facing flow is in your demo script, this is what to verify first.

**The two privacy-shaped cases deserve extra weight**: DOC-12/VEND-02 (vendor must receive *nothing*
during document collection) and VEND-03 (vendor must not receive candidate free text). A regression
there is not a bug in front of a client, it is a data-protection incident. I would run these early
and carefully regardless of where they sit in the block order.

**Budget realistically.** The execution plan suggests roughly half a day per block, seven blocks.
With a harness the mechanical cases compress a lot, but harness-building is itself real work.
My rough estimate: 2–3 days to build and seed, 2–3 days to execute, 1–2 days to fix and re-verify —
call it a week to ten days for a genuine full pass with fixes. Compressing that is possible, but it
means cutting coverage, not working faster, and I would rather tell you which cases we are dropping
than quietly run them shallowly.

---

## 8. What I need from you — the short list

**Status after your 2026-08-19 answers:**

| # | Item | Status |
|---|---|---|
| 1 | Decide B1 | ✅ **Done** — shared staging accepted (Option C), mitigations in §2.1 |
| 2 | Three test accounts | ✅ **Done** — supplied and verified in the DB |
| 3 | Confirm harness may write to staging + use the real vendor upload API | ⬜ **Assumed yes** — implied by (1); say so if not |
| 4 | Warn the team staging is under test | ⬜ **Yours** — real panel emails, real 5xx alerts, your calendar fills |
| 5 | Push RT on the three §6 questions | ⬜ **Yours**, non-blocking |
| 6 | Tell me if Zeko can be un-blocked | ⬜ **Open** — otherwise ZEK-05+ recorded Blocked |

**One thing I would still ask for, given Option C:** permission to take a `pg_dump` snapshot of
`recruitmentautomationdb` before the first destructive case. On a shared database it is the only
real undo available, and the cleanup script cannot reverse mutations. I will not start Block A
without it unless you tell me to skip it.

**Two additions to item 4**, now that the accounts are confirmed — the staging test inbox includes
`hmopuri@` and `saukumar@`, and the recruiter/vendor accounts use Gmail addresses you appear to
control. Both will receive real mail during the pass.

Nothing else gates the build. B5 is mine to fix in the setup step.
