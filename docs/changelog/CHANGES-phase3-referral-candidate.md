# Phase 3 (P1) — referral candidates: visible to recruiters, invisible to interviewers, audited either way

Scope: `docs/REFERRAL-CANDIDATE-PLAN.md`. Delivers Phases 1–8 of that plan.

---

## 0. What was asked for

Sanghamitra Roy, 2026-08-28 (23:33–26:08), quoted rather than paraphrased because the wording is the spec:

> "But it will also show as referred referral candidate. … It is required."
>
> "Because even in the interview, like only the recruiter, if he is able to see, that is fine. **I don't want
> the interviewer to see.** But the recruiter need to see that it is a referral candidate."
>
> "…after the whole selection process is done … **nobody knows that it is a referral person**. At that stage,
> when it comes to me, we always give preference to the referral person."
>
> "**None of the interview process should know** that it is a, because then you can't be non-bias… **Nobody in
> the other people in the system knows that it is a referred person.**"

And the trigger, from Harish at 22:42 — the reason a referrer's *name* is stored at all:

> "Let's say I have a referral from **Anuj**… I can search that candidate and I can shortlist the candidate."

**A referral grants hiring preference.** That single fact is why this is not just another candidate field: it
changes who gets hired, so it needs a trustworthy origin, a tamper-evident history, and a disclosure rule that
fails closed.

---

## 1. Decisions taken (2026-09-04)

| | |
|---|---|
| How the system learns it | **A recruiter declares it.** Nothing infers it — see §9 for what was deliberately deferred |
| Where it is set | The **Search Candidate** page, Edit Candidate modal |
| Who can see it | **Logged-in `superadmin` / `admin` / `recruiter` only.** No public link, ever, including the CEO scorecard |
| `Referred by` | **Free text**, with a self-seeding autocomplete |
| Who can set / remove | **Any recruiter sets; only admin-tier removes**, with a typed reason |

The visibility decision made the build *smaller*: with no exception for the final-round card, there is no
`recipient_role` gate and no config flag, and the invariant became absolute — *no unauthenticated response may
ever match `/referr/i`*. It also means the final decision-maker reads the flag **in the app**, which is why
she is being given an `admin`/`recruiter` account.

---

## 2. Schema

`prisma/ddl/2026-09-04-referral-candidate.sql` (+ `.README.md`), applied to staging.

**On `rpa_cv`** — not the shortlist row, because a referral is learned *before* a shortlist exists: an employee
mails a resume in and it may sit for months before anyone tags it to a JD.

`is_referral BOOLEAN NOT NULL DEFAULT FALSE` (fails **closed** — every pre-existing row reads "not a
referral"), `referred_by`, `referral_note`, `referral_set_by`, `referral_set_at`, plus a partial index.

**`rpa_referral_audit`** — append-only, one row per mark / change / removal. Both FKs are `ON DELETE SET NULL`
with the candidate's and the actor's names **snapshotted alongside**, because this codebase has already been
bitten by the alternative — from `screening.service.js`:

> *"From 2026-08-26 closure writes made the shortlisting recruiter's name VANISH from the record…"*

Two CHECK constraints: the action vocabulary, and **a removal must carry a non-empty reason**. The service
raises the friendly error a person reads; the constraint catches the code path that forgets.

Referral is a **boolean overlay**, never a value of `rpa_candidate_pipeline.source` or of `JobSource` — source
is the channel, and the next P1 item is about to redefine it.

---

## 3. 🔴 A prerequisite fixed first, on its own merits

`serializeCard()` in `interviewScorecard.service.js` opened with `...row`, and the row it was handed carried
`rpa_candidate_pipeline → rpa_shortlisted_candidates → mrf`. The **unauthenticated** `GET /api/scorecard/:token`
was therefore shipping `recruiter_notes`, `stage_notes`, `email_body_snapshot`, the whole MRF row
(`client_details`, `hiring_manager_name`, `ceo_panel_details`) and the schedule's `teams_passcode` and
`graph_event_id` to every interviewer.

Not rendered — the page reads only the skill rows — so this was over-transmission, visible in the Network tab
rather than on screen. But it is decisive here: the referral columns sit on that exact path, so adding them
without this fix would have handed the flag to every interviewer **with no code change and no failing test**.

Now a named field list. Four callers depend on the shape, including the recruiter-facing drawer report, which
reads every `HR_TEXT_FIELDS` key off the result — a naive whitelist would have silently emptied the HR round's
free-text block with nothing failing.

---

## 4. Writing it

Two endpoints, because the two actions carry **different permissions**:

| | Gate | |
|---|---|---|
| `PATCH /api/candidates/:id/referral` | `requireStaff` | set / update |
| `DELETE /api/candidates/:id/referral` | **`requireAdmin`** | remove, reason mandatory |

Folding either into `unmapCandidate()`'s 40-field mapper would have buried an admin-tier gate inside a field
loop where nobody reviews it. The generic `PATCH /api/candidates/:id` **cannot** touch these columns — that
mapper is an allowlist and they are not in it.

Behaviour worth knowing:

- **Re-saving identical values writes no audit row.** The log records changes; "Chhaya changed nothing" is
  noise that makes a real removal harder to find.
- **Removing a referral from someone who is not one is a 409**, not a silent success — a phantom `removed` row
  would pollute the very report R8 exists for.
- **A removal preserves `old_referred_by`**, the name being erased. Without it, "who was the referrer?" becomes
  unanswerable at exactly the moment it is worth asking.

`candidateService.update()` now receives the acting user — for the log only. It is deliberately **not** written
to `last_action_by`, which `dashboard.service.js` groups on to count candidates each recruiter *added*. Editing
is not adding.

---

## 5. Showing it

One shared `ReferralChip`, not four copies, because the rule attached to this flag is strict enough that four
copies would drift.

| Surface | Names the referrer? |
|---|---|
| Search Candidate table | No |
| Candidate Screening **result row** | No — this is where the recruiter sees it *while deciding whether to shortlist* |
| Candidate Screening detail panel | Yes |
| Pipeline board card | No |
| Pipeline drawer header | Yes |
| Pipeline CSV | Yes — recruiter-only, **never** the dossier |

Wide, screenshot-able surfaces answer only "is this a referral?"; the name appears where someone is actually
weighing the candidate.

---

## 6. Hiding it — nine surfaces, executed not eyeballed

A real candidate was marked as a referral from "Anuj Kumar", then every interviewer-facing builder was asked
for its output and the **whole payload** stringified and checked. Whole payloads, not named fields — that is
what catches a re-introduced spread.

| Surface | |
|---|---|
| Public scorecard, **every** `recipient_role` incl. `ceo` | clean |
| Scorecard invite email | clean — explicit token map |
| Interview invite **and the Teams calendar body** | clean — `interviewTokens()` is a whitelist, and receives the *shortlist* row while the referral lives on `rpa_cv` |
| Candidate dossier | clean — `CV_SELECT` is *derived from* `pickCvProfile()`, so the columns are never SELECTed |
| `search()` select-all, vendor-reachable | columns dropped from the **query** for vendors |
| Leak scan | `referral wording` check + `--referrer "Anuj Kumar"` |
| Recording share | clean + a regression test |
| Document upload page | named whitelist |

`dossierRedaction.js` gained the five columns, the audit table's two, `/(^|_)referr/i`, and a line in
`redactionSummary()`.

**The anchor is load-bearing.** An unanchored `/referr/i` also matches `PreferredShift` — "p-**REFERR**-ed" — a
whitelisted profile field. That guard would strip real content from every dossier and be switched off within a
week. There is a unit test pinning `isForbiddenKey('PreferredShift') === false`, and the first run of the
suppression probe proved the point by failing on exactly that.

---

## 7. The audit trail

**Admin Portal → Referral Log**, admin-tier by inheritance from `restrictTo('admin','superadmin')`.

Filters by action, candidate, referrer, and date range; **removals get their own count and a one-click
filter**, because "has anyone been quietly undoing referrals?" is the question the log exists for. The
referrer filter matches **either side** of a change, so searching a name finds both the marking that named
them and the removal that erased them.

`buildAuditWhere()` is shared by the screen and the CSV, so the file can never contain rows the report did not.
`acted_ip` is stored on every row but appears in **neither** the payload nor the CSV — corroboration for an
investigation, not something to spread across a mailed spreadsheet.

**Not company-scoped**, deliberately: `rpa_cv` has no `company_id`, so scoping by the acting admin's company
would filter on the *actor* rather than the subject.

---

## 8. What no code can enforce

Two rules that have to reach recruiters as words, because nothing in the system can stop them:

1. **Never write the referral on the resume file.** The dossier ships `attachments/` byte for byte, and
   `dossier-leak-scan.mjs` deliberately does not scan them — *"What the scan checks is what WE composed."* A
   recruiter who writes "Referred by Anuj" on the PDF sends it straight to the interviewer, and **no guard
   catches it**.
2. **Stop putting it in `Job Source`.** That free-text field is the shadow implementation this replaces, and it
   is rendered on the Candidate Screening detail panel.

`scripts/referral-jobsource-scan.mjs` reports candidates whose `Job Source` looks like a referral, so those can
be converted by hand. **Report only — no automatic backfill**: a backfill would be guessing, and a wrong
referral flag tips a hiring decision.

---

## 9. Deliberately deferred

- **Email-intake suggestion.** `emailResumeIntake.js` already captures the sender and `outlookReader.service.js`
  already defines `ADMIN_DOMAINS`, so the system could propose *"sent by anuj@aapnainfotech.com — mark as
  referral?"* It would have to **suggest, never auto-set**: an internal sender is also a recruiter forwarding a
  job-board result. (Separate small bug noted while investigating: `hrUpload.service.js` tags **every**
  email-intake resume `"Self Applied"`, including one an employee forwarded.)
- **An employee referral form**, where Anuj submits the candidate himself — the only path where the system
  *knows* rather than being *told*.
- **Never trust the candidate's own claim.** A candidate writing "referred by Anuj" has an obvious incentive.

---

## 10. Latent risk, recorded not fixed

The Teams calendar body interpolates a `notes` field from the schedule payload
(`interviewSchedule.service.js:873`). **No UI sends it today** — the drawer's schedule modal has no notes field
— so nothing leaks. But the API accepts it, and a Teams invite is the one artefact that can never be redacted
afterwards. If a notes field is ever added there, it needs a warning that its text lands in the interviewer's
calendar permanently.

---

## 11. Tests

**574 pass, 0 fail** (367 `src/tests/unit/`, 207 `src/tests/`), all DB-free.

`src/tests/unit/referral.test.js` covers: referrer normalisation (trimmed and collapsed, **not** case-folded —
they are people's names); `acted_by_name` never empty; the action vocabulary matching the DB CHECK; the dossier
guard covering every referral key **and not `PreferredShift`**; `requireStaff` admitting recruiter/hr/admin/
superadmin and refusing vendor; `requireAdmin` refusing recruiters; fail-closed mapping when the columns are
absent; and `describeShareLink()` emitting only its four named fields even when handed a row joined with the
candidate.

The transactional and disclosure behaviour was exercised against staging on throwaway candidates — full
lifecycle, the nine-surface suppression sweep, the read surfaces with vendor redaction, and the Referral Log
with its gate — then every probe row, session and audit row deleted.

`mapReferralFields()` lives in `utils/referralView.js` rather than in the service for the reason
`vendorScope.js` gives for its own move: reaching it through the service drags in Prisma, the socket layer and
the Gemini chain, and a rule that decides disclosure has to be cheap to assert.

---

## 12. Files

**New** — `prisma/ddl/2026-09-04-referral-candidate.{sql,README.md}`, `src/services/referral.service.js`,
`src/utils/referralView.js`, `src/exports/referralAudit.export.js`, `src/tests/unit/referral.test.js`,
`scripts/referral-jobsource-scan.mjs`, `frontend/src/components/candidates/{ReferralPanel,ReferralChip}.jsx`,
`frontend/src/components/admin/ReferralLogPanel.jsx`.

**Changed** — `interviewScorecard.service.js`, `candidate.{service,controller}.js`, `candidate.routes.js`,
`pipeline.service.js`, `pipeline.export.js`, `admin.{controller,routes}.js`, `dossierRedaction.js`,
`vendorScope.js`, `dossier-leak-scan.mjs`, and on the frontend `Candidates.jsx`, `CandidateScreening.jsx`,
`Pipeline.jsx`, `PipelineDrawer.jsx`, `AdminDashboard.jsx`, `MainLayout.jsx`, `candidateService.js`,
`adminService.js`.
