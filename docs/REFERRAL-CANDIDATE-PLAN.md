# Referral Candidate — Implementation Plan

**Status:** Analysis / plan only. No code written.
**Priority:** P1 (both source documents place it after the P0 queue — see §11.1).
**Revision:** v3, 2026-09-04. Decisions taken so far:
- **Path 1 only** — the recruiter declares the referral; the system never infers it (§13 holds the deferred paths).
- **Entry point: the Search Candidate page**, Edit Candidate modal.
- **A full audit log** of every mark / change / removal is a first-class requirement (§6).
- **Visible only to logged-in `superadmin` / `admin` / `recruiter`.** No public link ever shows it — this
  removes the CEO-card exception v2 carried, and makes the suppression rule absolute (§5).
- **`Referred by` is free text** (§5.2 covers the reporting cost and how to blunt it).
- **Any recruiter may set it; only admin-tier may remove it.**
- **The final decision-maker will hold an `admin` / `recruiter` account**, so R4 is met in-app and the §5.1
  dependency is closed.
- **DDL is applied by Pankaj, against staging first.** A stop-the-services window for `prisma:generate` is
  agreed.

v1's shortlist-row storage is superseded by §4. **All design blockers are answered; Phase 1 is done (§7).**
**Sources:**
`E:\Recruitment Process Automation\Rakhi_madam_review_Phase-3\`
— `ATS App - Quick Update.docx` (verbatim transcript, 28 Aug 2026, 23:33–26:08)
— `Sanghamitra_Roy_ATS_Enhancement_Change_Requirements.docx` §4, §11, matrix row "P1 – High"
— `Sanghamitra_Roy_ATS_Start_Work_Priority_Plan.docx` §3 item 1, §5 step 8, §7 item 8

---

## 1. What was actually asked for

Sanghamitra Roy, 23:33–26:08 — quoted rather than paraphrased, because the wording is precise:

> "But it will also show as referred referral candidate. … It is required."
>
> "Because even in the interview, like only the recruiter, if he is able to see, that is fine.
> **I don't want the interviewer to see.** But the recruiter need to see that it is a referral candidate."
>
> "Because after the whole selection process is done … if that person referral person gets shortlisted and
> there is one other person who gets shortlisted, we after all that where **nobody knows that it is a referral
> person**. At that stage, when it comes to me, we always give preference to the referral person…"
>
> "No, as long as the recruiter knows it is fine. So when it comes to me, I will know — the recruiter and me,
> like final my interview should know that it is a referral candidate."
>
> "So recruiters say Chhaya is attending, Chhaya should know that it is a referral candidate. **None of the
> interview process should know** that it is a, because then you can't be non-bias… **Nobody in the other
> people in the system knows that it is a referred person.**"

Harish at 22:42, giving the referrer's name — the reason `referred_by` exists:

> "Let's say I have a referral from **Anuj**. Let's say as a recruiter, I got a referral from Anuj. So I can
> search that candidate and I can shortlist the candidate…"

### 1.1 Rules

| # | Rule | Source |
|---|---|---|
| R1 | A candidate can be marked **"Referral candidate"**, recording **who referred them**. | "referral from Anuj" |
| R2 | The recruiter sets it, **from the Search Candidate page**. | Decision, 2026-09-04 |
| R3 | The **recruiter** sees it, from the beginning. | "Chhaya needs to know in the beginning" |
| R4 | The **final decision-maker** sees it at the final round — **in the ATS, logged in** (see §5.1). | "when it comes to me, I will know" |
| R5 | **No interviewer** sees it — no round, no scorecard, no email, no calendar invite. | "None of the interview process should know" |
| R6 | Nobody else in the system sees it. | "Nobody in the other people in the system knows" |
| **R7** | **Every mark, change and removal is logged** — who, when, referrer name, candidate — as an investigable record and a report. | **Decision, 2026-09-04** |
| **R8** | **Removing a referral is logged as an incident**, naming the recruiter who removed it. | **Decision, 2026-09-04** |

R5/R6 are the disclosure half. R7/R8 are the accountability half, and they exist for a good reason: a referral
grants hiring preference (*"we always give preference to the referral person"*), so the flag needs a
trustworthy origin and a tamper-evident history. See §6.1.

---

## 2. Current state

Verified on branch `pankaj-work-staging-v16`.

**No referral concept exists.** Zero occurrences in schema or source. (Grep hits in
[schema.prisma](../backend/prisma/schema.prisma) are the substring inside `Prefer**r**edShift`.) Clean,
additive build.

**There is no `interviewer` role to deny.** [`config/roles.js`](../backend/src/config/roles.js) defines exactly
four — `superadmin (40) > admin (30) > recruiter / hr (20) > vendor (10)`. An interviewer is **not an account**:
they are an email address plus a `uuid` token. Their whole relationship with the ATS is a calendar invite
([`graphCalendar.service.js`](../backend/src/services/graphCalendar.service.js)), an email
([`interviewSchedule.service.js:601`](../backend/src/services/interviewSchedule.service.js#L601)), the public
scorecard page ([`scorecard.routes.js:15`](../backend/src/routes/scorecard.routes.js#L15), **no** `authenticate`
middleware), sometimes a dossier pack, and sometimes a recording share link.

**Consequence, and it shapes everything:** R5 cannot be implemented as a permission check — there is no subject
to check. It is implemented **surface by surface**, and the acceptance criterion is not "the guard passes" but
"each of these nine surfaces was inspected" (§7 Phase 6).

**The final decision-maker uses the same public link as an interviewer.** `roleForStage()` at
[`interviewScorecard.service.js:56`](../backend/src/services/interviewScorecard.service.js#L56) returns `'ceo'`
for the CEO stage, `'hr'` for the HR round, `'interviewer'` otherwise. The person who must see the flag (R4)
and those who must not (R5) are reached identically, told apart only by `recipient_role`. That is the crux — §5.

**Good precedent to copy.** [`dossierRedaction.js`](../backend/src/utils/dossierRedaction.js) is a whitelist +
a `FORBIDDEN_KEYS` assertion + `FORBIDDEN_KEY_PATTERNS`, with `assertNoForbiddenFields()` walking the finished
model and throwing in CI. The dossier plan already reserved a row for this work —
[CANDIDATE-COMPLETE-DOWNLOAD-PLAN.md §8.2](phase3/CANDIDATE-COMPLETE-DOWNLOAD-PLAN.md) line 638.

---

## 3. 🔴 Blocking prerequisite — over-disclosure on the public scorecard

**Fix this before the referral columns land.**

`getScorecardByToken()` loads the card with a deep include
([`interviewScorecard.service.js:365-372`](../backend/src/services/interviewScorecard.service.js#L365-L372)):

```js
include: {
  rpa_interview_scorecard_skill: { orderBy: { sort_order: 'asc' } },
  rpa_interview_schedule: true,
  rpa_candidate_pipeline: { include: { rpa_shortlisted_candidates: { include: { mrf: true } } } },
},
```

and returns it through `serializeCard()`
([line 73](../backend/src/services/interviewScorecard.service.js#L73)), which opens with a bare spread:

```js
return {
  ...row,          // ← carries rpa_candidate_pipeline → rpa_shortlisted_candidates → mrf
```

So the JSON body of the **unauthenticated** `GET /api/scorecard/:token` currently carries to every interviewer:
the whole shortlist row (`recruiter_notes`, `stage_notes`, `email_body_snapshot`, `candidate_email_all`), the
whole `rpa_mrf` row (`client_details`, `hiring_manager_name`, `ceo_panel_details`, `submitter_email`), and the
whole schedule row (`teams_passcode`, `graph_event_id`, `online_meeting_id`).

It does not crash on the `BigInt` ids because [`app.js:24`](../backend/src/app.js#L24) installs a global
`json replacer`. It is **not rendered** — [`InterviewScorecard.jsx`](../frontend/src/pages/InterviewScorecard.jsx)
reads only `data.card.rpa_interview_scorecard_skill`. So this is **over-transmission, not on-screen display**:
visible in the browser's Network tab, not on the page. Worth stating precisely rather than overstating.

**Fix:** replace the spread with an explicit field list, the same construction `serializeRecording()` and
`pickCvProfile()` already use. ~2 hours. Verify all four states (`open`, `no_show`, `submitted`, `expired`)
still render — the submitted/expired paths return `card` with no `context`, so they are likeliest to depend on
a field the spread was quietly supplying.

**Why it blocks this feature.** The referral flag will be read on the pipeline surfaces via the shortlist/CV
join. Leaving a wholesale spread in an unauthenticated response means a future include change hands the flag to
every interviewer with no code change and no test failing. **Merge this separately, ahead of the referral
work** — it removes `teams_passcode` and `recruiter_notes` from a public payload today, on its own merits.

---

## 4. Where the flag lives

### 4.1 Current state on `rpa_cv` — supersedes v1

**Decision: `rpa_cv`** (the candidate record), not the shortlist row.

v1 of this plan recommended `rpa_shortlisted_candidates` on blast-radius grounds. That reasoning was weaker
than stated, and the decisive argument runs the other way:

**A referral is learned before a shortlist row exists.** Anuj emails a resume to Chhaya; she uploads it. She
knows it is a referral *at that moment*, but there is no shortlist row and may not be one for months. Storing
it only on the shortlist row leaves that fact nowhere to live. It also matches Sanghamitra's own reasoning,
which is about the **person**: *"that person is already aware of Apna… and therefore they are keen to join Apna."*

`rpa_cv` is also the right grain: [`hrUpload.service.js`](../backend/src/services/hrUpload.service.js) **merges**
on re-upload (`appendUnique` for emails/phones, `prefer()` for other fields), so one person accumulates into one
row rather than spawning duplicates.

**Measured blast radius** (this is what v1 got wrong):

| Reader of `rpa_cv` | Risk |
|---|---|
| Dossier pack | **Safe by construction** — `CV_PROFILE_FIELDS` is a whitelist; a new column is invisible until consciously added. |
| Candidate CSV export | **Safe** — `EXPORT_SELECT` ([`candidate.service.js:627`](../backend/src/services/candidate.service.js#L627)) is also an allowlist. |
| `search()` | ⚠️ **One real exposure.** It selects all ~80 columns (the comment at [line 623](../backend/src/services/candidate.service.js#L623) says so), and **vendors can call it** — `enforceVendorScope` limits them to their own candidates but still returns every column. One-line fix; must be on the checklist. |

One surface, not a wide radius.

### 4.2 Do **not** make referral a value of `source` or of `JobSource`

`rpa_candidate_pipeline.source` takes `recruiter` / `vendor` / `screening_shortlist` / `bulk_excel` /
`email_intake` ([`pipeline.export.js:32`](../backend/src/exports/pipeline.export.js#L32)). Adding `'referral'`
would be wrong three times: it is **already displayed** on the board card and CSV (the opposite of R5/R6); it is
**mutually exclusive** with the real channel; and it **collides with the next P1 item**, which redefines sources
as College Placement / Placement / Vendor. Keep them orthogonal — **source is the channel, referral is a boolean
overlay**. A vendor-sourced candidate can also be a referral.

`rpa_cv.JobSource` is the **shadow implementation that already exists** — free text at
[`Candidates.jsx:826`](../frontend/src/pages/Candidates.jsx#L826), displayed on the screening detail panel at
[`CandidateScreening.jsx:2420`](../frontend/src/pages/CandidateScreening.jsx#L2420). Nothing stops a recruiter
typing "Referral – Anuj" there today. The structured field replaces it, and recruiters are told to stop (§7
Phase 8).

### 4.3 DDL — current state

Repo convention: a hand-applied `.sql` plus a `.README.md`, then `prisma db pull`. There is no `prisma migrate`
in this project — see [`backend/prisma/ddl/`](../backend/prisma/ddl/).

**Written:** [`2026-09-04-referral-candidate.sql`](../backend/prisma/ddl/2026-09-04-referral-candidate.sql).
The columns, in summary — the file itself carries the full rationale and the `COMMENT ON COLUMN` text:

```sql
ALTER TABLE rpa_cv
  ADD COLUMN IF NOT EXISTS is_referral     BOOLEAN NOT NULL DEFAULT FALSE;
  -- + referred_by VARCHAR(255), referral_note TEXT,
  --   referral_set_by VARCHAR(255), referral_set_at TIMESTAMPTZ

CREATE INDEX IF NOT EXISTS idx_cv_referral
  ON rpa_cv(is_referral) WHERE is_referral;   -- partial: referrals are a minority
```

| Column | Answers |
|---|---|
| `is_referral` | The flag. `NOT NULL DEFAULT false` so every pre-existing row reads "not a referral" — the feature **fails closed on disclosure**, the correct direction here. |
| `referred_by` | "A referral from **Anuj**" — the transcript's own example. |
| `referral_note` | Recruiter context ("ex-colleague of Anuj, spoke to him directly"). Recruiter-only, never exported. |
| `referral_set_by` / `referral_set_at` | Denormalised "current" values, for display without joining the audit table. The **audit table (§6) is the source of truth for history**; these two are a convenience copy of its latest row. |

---

## 5. The visibility model

Because there is no interviewer role, visibility is decided **per surface**.

### Tier A — logged-in staff → **visible**

**Decision (2026-09-04): `superadmin`, `admin` and `recruiter` only — and only while logged in to the ATS.**

That is `ROLE_RANK >= 20` in [`config/roles.js`](../backend/src/config/roles.js), which is exactly what
`requireStaff` already enforces ([`middleware/auth.js:194`](../backend/src/middleware/auth.js#L194)). Two
consequences worth naming:

- **The legacy `hr` role is included** — it is a rank-20 alias of recruiter (`ROLE_RANK.hr = 20`). Any account
  still carrying it will see the flag. Intended, but say so out loud rather than discovering it later.
- **`vendor` (rank 10) is excluded.** This is not automatic: `search()` returns all ~80 `rpa_cv` columns and
  vendors can call it (§4.1). That is why Phase 6 row 6 exists, and it is now a hard requirement rather than a
  tidy-up.

Surfaces: Search Candidate, Candidate Screening, the pipeline board and drawer, recruiter CSVs. All already
show far more than the referral flag, so R3 needs no new gate — only rendering.

Note this is **wider than the literal words** "the recruiter and me": every recruiter and admin sees it, not
only the owning one. That is the decision, and it reads correctly against R5/R6 — the excluded party is the
interviewer, not a colleague.

### Tier B — public token links → **hidden, no exception**

**Decision (2026-09-04): the referral appears on no unauthenticated surface at all.** The CEO-card exception
that v2 of this plan proposed is **dropped**.

| Route | Rule |
|---|---|
| `GET /api/scorecard/:token` — **every** `recipient_role`, `ceo` included | **Hidden.** |
| `POST /api/documents/:token` | **Hidden.** Candidate-facing. |
| `GET /api/recording-share/:token` | **Hidden.** Verified clean today — [`recordingShareModel.js`](../backend/src/utils/recordingShareModel.js) carries no candidate context. Keep it so. |

**This is the better outcome, and it makes the build smaller.** There is no `recipient_role` gate to write, no
`REFERRAL_VISIBLE_ON_CEO_CARD` config flag, and no chip on a page protected by nothing but a uuid sitting in an
inbox. Barrier B3 disappears entirely.

It also makes the test far stronger. Instead of "hidden for these roles, shown for that one", the invariant is
absolute and can be asserted in one line over every card:

> No response from any unauthenticated route may match `/referr/i`, ever.

**The implementation rule that follows:** the referral columns must never be *loaded* in a public code path —
not fetched and filtered, simply never selected. Nothing to leak is stronger than something correctly hidden.

### Tier C — artefacts that leave the building → **hidden, always**

The dossier and every outbound export. No exception, no flag. Once a `.zip` is emailed there is no recall — the
reasoning [`dossierRedaction.js`](../backend/src/utils/dossierRedaction.js) opens with.

One deliberate inclusion: the recruiter's own **pipeline CSV** may carry a `Referral` column — generated behind
`requireStaff` for their own use. Recorded as a conscious decision, because a CSV is forwardable too.

### 5.1 ✅ The dependency this decision creates — closed

Restricting the flag to logged-in staff made R4 depend on the final decision-maker actually holding an ATS
account and opening the app; otherwise she would fill the emailed scorecard and never see it — failing the
requirement she stated herself: *"when it comes to me, I will know."*

**Closed 2026-09-04: she will hold an `admin` or `recruiter` account.** R4 is therefore met by the in-app
surfaces in Phase 5, with no public-link exception anywhere.

Two provisioning notes that follow, neither of them development work:

- The account must exist **and be active** before this ships — an inactive account is refused at
  [`auth.js:68`](../backend/src/middleware/auth.js#L68), and the failure would look like a missing feature.
- If she is given `recruiter` rather than `admin`, she can **set** a referral but not **remove** one (§9.1 Q6).
  That is almost certainly the right way round; flagged only so it is a decision rather than a surprise.

### 5.2 `Referred by` is free text — the cost, and how to blunt it

**Decision (2026-09-04): free text**, not a picker from an employee list.

The cost lands on §6.4's report, not on the feature: `Anuj`, `anuj k`, `Anuj Kumar` and `AnujK` are four
separate rows in any report grouped by referrer, and no amount of later querying can merge them reliably. Two
cheap mitigations that need no employee list:

1. **Normalise on write** — trim, collapse internal whitespace, and store as typed. Do **not** case-fold the
   stored value (people's names are not lower-case), but compare case-insensitively when grouping.
2. **Autocomplete from what has already been entered** — a `datalist` seeded by
   `SELECT DISTINCT referred_by FROM rpa_cv WHERE is_referral`. It is self-seeding, costs one query, needs no
   HR data, and means the second person to type "Anuj" picks the existing spelling instead of inventing a new
   one. This is what actually holds the report together over time.

Neither is a substitute for a picker. If the referrer name ever needs to drive a payout or a formal report,
revisit it — the column is `varchar(255)` and can take an optional `referred_by_user_id` beside it later.

### 5.3 ⚠️ Never write the referral onto the resume file

The dossier ships `attachments/` **byte for byte**, and
[`dossier-leak-scan.mjs`](../backend/scripts/dossier-leak-scan.mjs) deliberately does **not** scan attachments —
its header says *"What the scan checks is what WE composed."* A recruiter who writes "Referred by Anuj" on the
PDF sends it straight to the interviewer and **no guard catches it**. This must be a stated rule to recruiters
(§7 Phase 8).

---

## 6. The audit log (R7 / R8) — a first-class requirement

### 6.1 Why a log, not just two stamp columns

`referral_set_by` / `referral_set_at` answer "who set the current value". They cannot answer:

- *"Who removed Anuj's name from this candidate, and when?"* — the removal overwrites the very columns that
  would have recorded it.
- *"Was this candidate ever marked a referral before the final decision?"*
- *"Show me every referral marked last quarter, and by whom."*

A referral **grants hiring preference**. That makes it different from other candidate fields: it changes who
gets hired, so its history has to be tamper-evident and reportable. An append-only table is the only structure
that survives a removal.

### 6.2 Table design

Written in full in
[`2026-09-04-referral-candidate.sql`](../backend/prisma/ddl/2026-09-04-referral-candidate.sql). The shape:

```sql
CREATE TABLE IF NOT EXISTS rpa_referral_audit (
  id              BIGSERIAL PRIMARY KEY,
  cv_id           BIGINT,          -- FK ON DELETE SET NULL
  candidate_name  VARCHAR(255),    -- snapshot, see below
  candidate_email VARCHAR(255),
  action          VARCHAR(20)  NOT NULL,   -- CHECK: marked | updated | removed
  old_is_referral BOOLEAN,  new_is_referral BOOLEAN,   -- both sides of the change,
  old_referred_by VARCHAR(255), new_referred_by VARCHAR(255),  -- so one row reads alone
  note            TEXT,
  reason          TEXT,            -- CHECK: non-empty when action = 'removed'
  acted_by        INT,             -- FK ON DELETE SET NULL
  acted_by_name   VARCHAR(255) NOT NULL,   -- snapshot; NOT NULL on purpose
  acted_by_email  VARCHAR(255),
  acted_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  acted_ip        VARCHAR(64)
);
```

Four indexes: by candidate, by actor, by `acted_at DESC` (the report's default order), and a partial one over
`action = 'removed'` — the investigation view R8 exists for.

**Why the name snapshots.** This codebase has already been bitten by exactly this. From
[`screening.service.js:878-885`](../backend/src/services/screening.service.js#L878-L885):

> *"From 2026-08-26 closure writes made the shortlisting recruiter's name VANISH from the record…"*

An audit row that resolves its actor by join alone loses the name the moment that account is deleted — and
superadmins can delete accounts. Snapshot the name; keep the FK for linking.

**Append-only.** The application performs `INSERT` and `SELECT` on this table and nothing else — no `UPDATE`,
no `DELETE`, not even a "fix a typo" path. That is currently a convention; the DDL README carries a ready
`BEFORE UPDATE OR DELETE` trigger that turns it into a rule, deliberately **not** applied because it would
block any future corrective migration. Worth applying only if the log is ever used in a dispute.

### 6.3 What gets logged

| Trigger | `action` | Notes |
|---|---|---|
| Recruiter ticks "Referral candidate" | `marked` | `new_referred_by` = the name typed. |
| Recruiter edits the referrer name or note | `updated` | Both old and new recorded. |
| **Recruiter clears the flag or the referrer name** | **`removed`** | **`reason` is mandatory** — the UI blocks the save without it. This is R8's "incident". |

Every row records the acting recruiter, timestamp, IP, and a snapshot of the candidate's name and email.

### 6.4 The report surface

A **Referral Log** view with:

- filters — date range, recruiter, action (`marked` / `updated` / `removed`), candidate name;
- a **Removals** quick-filter, since that is the investigation case R8 exists for;
- **CSV export**, reusing [`csvExport.js`](../backend/src/utils/csvExport.js) and the `EXPORT_SELECT` allowlist
  pattern;
- a compact per-candidate history strip on the Edit Candidate modal ("Marked as referral by Chhaya on
  12 Sep 2026") so the recruiter sees the history in context.

**Placement:** the Admin Portal, admin-tier only (§9 Q5). It is an investigation tool, not a daily recruiter
screen, and its contents are precisely the thing R6 says most people should not see.

---

## 7. Implementation plan

### Phase 0 — Decisions (blocking, no code) — see §9 and §10

### Phase 1 — ✅ `serializeCard()` prerequisite — **DONE 2026-09-04**

Per §3, and approved to merge separately. `serializeCard()` in
[`interviewScorecard.service.js:73`](../backend/src/services/interviewScorecard.service.js#L73) now builds an
explicit field list instead of spreading the Prisma row, with a header explaining why it must stay that way.

Verified before trimming: **four** callers depend on the shape, not the three §3 named —
`getScorecardByToken()` (public, ×3 states), `submitScorecardByToken()` (public), and the recruiter-facing
`getCandidateScorecardReport()`, which additionally reads every `HR_TEXT_FIELDS` key off the result. The
frontend ([`InterviewScorecard.jsx:52`](../frontend/src/pages/InterviewScorecard.jsx#L52)) touches only
`card.rpa_interview_scorecard_skill` and the `context` block. All are preserved.

Now excluded from the public response: the whole `rpa_candidate_pipeline → rpa_shortlisted_candidates → mrf`
graph, the schedule row (`teams_passcode`, `graph_event_id`, `online_meeting_id`), and additionally `token`,
`submitted_ip`, `created_at`, `modified_at` — none of which any caller used.

**✅ Verified 2026-09-04** against the staging database, on three levels:

1. **Payload** — `GET /api/scorecard/:token` driven in all four states plus the lazy-expiry branch and an HR
   card. Every response now carries **36 named keys** and none of: `rpa_candidate_pipeline`,
   `rpa_shortlisted_candidates`, `mrf`, `rpa_interview_schedule`, `recruiter_notes`, `stage_notes`,
   `email_body_snapshot`, `client_details`, `hiring_manager_name`, `ceo_panel_details`, `submitter_email`,
   `teams_passcode`, `graph_event_id`, `online_meeting_id`, `token`, `submitted_ip`.
2. **Recruiter side** — `getCandidateScorecardReport()` on two pipelines carrying submitted HR cards: all 13
   base fields present on every round, the **HR block intact at 15 keys / 14–15 populated** with real values,
   and `consolidated_feedback` complete (`5 interviews scored · average 3.7 · 5× approve`, 5 headline lines).
   This was the real risk — the report reads `s[f]` over `HR_TEXT_FIELDS`, so a whitelist that missed them
   would have silently emptied the HR round in the drawer with nothing failing.
3. **Browser** — Edge, headless, against the running dev server. `open` (form), `no_show`, `submitted`,
   `expired`, lazy-`expired` and an invalid token all render their correct page; the form shows the context
   strip, skill row, all three ratings, status group, comments and submit. No page errors; the only console
   errors are the expected 404s on the deliberately invalid token.

**Tests:** 550 pass, 0 fail (343 `src/tests/unit/`, 207 `src/tests/`).

*Observed while verifying, not a defect:* the card payload includes the `hr_*` fields for every `card_type`.
On a technical card they are null, and on an HR card they are the recipient's own submission coming back — so
this is not a disclosure. Noted because `dossierRedaction.js` forbids `hr_current_ctc` / `hr_expected_ctc` in a
*dossier*, which is a different audience (a stranger, not the person who typed them).

### Phase 2 — Schema — ✅ **APPLIED TO STAGING 2026-09-04**

- [`backend/prisma/ddl/2026-09-04-referral-candidate.sql`](../backend/prisma/ddl/2026-09-04-referral-candidate.sql)
- [`backend/prisma/ddl/2026-09-04-referral-candidate.README.md`](../backend/prisma/ddl/2026-09-04-referral-candidate.README.md)

The SQL is the authority; §4.3 and §6.2 above are the reasoning behind it. Applied by Pankaj against staging:

```bash
psql "$DATABASE_URL" -f prisma/ddl/2026-09-04-referral-candidate.sql
cd backend && npm run prisma:pull && npm run prisma:generate
```

⚠️ `prisma:generate` takes a file lock on Windows — **stop the dev server *and* the queue worker**
(`npm run queue:worker`) first, or it fails with `EPERM`. Both were running on 2026-09-04.

**Verified on staging after apply:** the generated client exposes `prisma.rpa_referral_audit`; the audit table
exists and is empty; all five `rpa_cv` columns are queryable; **432 candidates, 0 flagged** — the
`NOT NULL DEFAULT FALSE` fail-closed default behaved as intended; and the removal-without-reason `CHECK` fires
against the real table, not just the dry run.

⚠️ **`prisma generate` failed once with `EPERM`** — barrier B12, but not for the documented reason. The dev
server was already stopped and the queue worker was not running. The lock was held by **two orphaned one-off
node scripts** that had imported `src/config/database.js` hours earlier: a script that awaits
`prisma.$disconnect()` still does not exit on its own, so it lingers holding the query-engine DLL. Ten stale
`query_engine-windows.dll.node.tmp<pid>` files (202 MB) had also accumulated from earlier failures. Fix: kill
the orphans, delete the `.tmp*` files, re-run. **Any ad-hoc Prisma script must end with `process.exit(0)`.**

Beyond §4.3/§6.2 the written DDL adds two things worth knowing:

- **`CHECK (action IN ('marked','updated','removed'))`** and **`CHECK (action <> 'removed' OR reason is
  non-empty)`**. The service still raises the friendly error a recruiter reads; the constraint is the backstop
  for the code path that forgets. A removal with no stated reason is the exact case R8 exists for, so it is
  refused twice.
- **An optional append-only trigger, documented in the README but deliberately not applied.** It would change
  behaviour and block any future corrective migration, so it should be a conscious decision rather than a side
  effect of adding a column.

### Phase 3 — ✅ **DONE 2026-09-04** — actor identity + the referral endpoints

**Written**

| File | What |
|---|---|
| [`services/referral.service.js`](../backend/src/services/referral.service.js) | **New.** `setReferral` / `removeReferral` / `getReferralHistory` / `getReferral`. Candidate row + audit row in one `$transaction`, always. |
| [`controllers/candidate.controller.js`](../backend/src/controllers/candidate.controller.js) | `req.user` now threaded into `candidateService.update`; three referral handlers + a `clientIp` helper mirroring `scorecard.controller.js`. |
| [`routes/candidate.routes.js`](../backend/src/routes/candidate.routes.js) | `GET`/`PATCH` behind `requireStaff`, `DELETE` behind `requireAdmin`. |
| [`services/candidate.service.js`](../backend/src/services/candidate.service.js) | `update(id, data, actor)` — logs the actor, **deliberately does not write `last_action_by`** (see below). |
| [`utils/dossierRedaction.js`](../backend/src/utils/dossierRedaction.js) | Phase 6 row 4 **pulled forward**: the guard must exist before the data does. |
| [`tests/unit/referral.test.js`](../backend/src/tests/unit/referral.test.js) | **New**, 19 DB-free tests. |

**Two decisions worth recording**

- **`last_action_by` is NOT stamped on edit.** `dashboard.service.js` groups `rpa_cv` by that column to count how
  many candidates each recruiter **added**. Writing it on every edit would credit whoever last touched a record
  with having sourced it. Editing is not adding, so the actor goes to the log only.
- **`acted_ip` is stored but not serialized to clients.** It is corroboration for an investigation, not
  something to render beside a colleague's name in a history strip every recruiter can open — and once a field
  is in a response it ends up on a screen. Read it from the table when an investigation needs it.

**Behaviour the tests pin down**

- Re-saving identical values writes **no** audit row. The log records changes; "Chhaya changed nothing" is
  noise that makes a real removal harder to find.
- Removing a referral from a candidate who is not one is a **409**, not a silent success — a phantom `removed`
  row would pollute the very report R8 exists for.
- A removal's audit row **preserves `old_referred_by`**, the name being erased. Without it "who was the
  referrer?" becomes unanswerable at exactly the moment it is worth asking.

**Verified**

- 19/19 unit tests; **569 pass, 0 fail** across both DB-free suites (362 unit + 207 top-level).
- Full lifecycle against staging on a throwaway candidate — mark → no-op re-save → update → validation refusals
  → remove → double-remove refusal → history ordering — **19/19**, then the candidate and its audit rows
  deleted. Table left at 0 rows.
- Route registration and gates asserted by walking the Express router stack. An unauthenticated HTTP probe
  could not show this: `router.use(authenticate)` runs before route matching, so a made-up path returns the
  same 401 a real one does.

**Still open on this route, not introduced here:** `PATCH /api/candidates/:id` sits behind `authenticate` only —
no `requireStaff`, and no vendor scoping, unlike the list and export. Left alone deliberately: tightening it
could break the vendor portal and belongs in its own change. The referral routes carry their own gates.

<details><summary>Original Phase 3 plan (the blocker it describes is now fixed)</summary>

Today the candidate update endpoint has **no idea who is calling it**.
[`candidate.controller.js:82-85`](../backend/src/controllers/candidate.controller.js#L82-L85):

```js
export const updateCandidate = catchAsync(async (req, res) => {
  const candidate = await candidateService.update(req.params.id, req.body);   // req.user never passed
  return success(res, candidate, 'Candidate updated');
});
```

`req.user` is populated by `authenticate` but never reaches the service, so there is nothing to write into
`acted_by`. **R7/R8 cannot be built until this is threaded through.**

Two further things to settle while in this code:

- `PATCH /api/candidates/:id` is mounted under `authenticate` only
  ([`candidate.routes.js:56,81`](../backend/src/routes/candidate.routes.js#L81)) — **not** `requireStaff`, and
  unlike the list and export it has no `enforceVendorScope` equivalent. Whether a vendor token can PATCH an
  arbitrary candidate today needs tracing; **regardless, the referral write path must be `requireStaff`.**
- Use a **dedicated endpoint**, not the general update: `PATCH /api/candidates/:id/referral`
  (`requireStaff` — set / update) and `DELETE /api/candidates/:id/referral` (`requireAdmin` + mandatory reason
  — remove). Two handlers, because the two actions now have **different permissions**; folding either into the
  40-field mapper in `unmapCandidate()` would bury an admin-tier gate inside a field loop where nobody reviews
  it. Small, separate, reviewable.

</details>

### Phase 4 — ✅ **DONE 2026-09-04** — write path on Search Candidate

**Written**

| File | What |
|---|---|
| [`components/candidates/ReferralPanel.jsx`](../frontend/src/components/candidates/ReferralPanel.jsx) | **New.** The whole surface: checkbox, `Referred by` autocomplete, note, history strip, admin-only removal dialog. |
| [`pages/Candidates.jsx`](../frontend/src/pages/Candidates.jsx) | Panel mounted in the Edit Candidate modal, beside Job Source; keyed by candidate and only while open. |
| [`services/candidateService.js`](../frontend/src/services/candidateService.js) | `getReferral` / `setReferral` / `removeReferral` / `getReferrers`. |
| [`services/referral.service.js`](../backend/src/services/referral.service.js) | `getKnownReferrers()` — the §5.2 autocomplete. |
| [`routes/candidate.routes.js`](../backend/src/routes/candidate.routes.js) | `GET /referral/referrers`, above `/:id/referral` — see below. |

**Design decisions**

- **The panel saves through its own buttons, not "Update Candidate".** The server has separate endpoints with
  separate permissions; one Save that silently needs two permission levels would be a lie. It also keeps an
  audited action from feeling incidental, and a removal needs its reason first so it cannot join a bulk save.
- **Once it IS a referral the checkbox locks.** Un-ticking would be a removal — admin-only and reason-carrying.
  A checkbox that quietly performs that is the wrong affordance; removal is an explicit red button.
- **Route order matters.** `GET /referral/referrers` sits *above* `/:id/referral`: both are two-segment paths,
  so Express would otherwise match it as a candidate with the id `"referral"`. Same trap, same fix, as
  `/export` above `/:id`.

**Three real bugs the browser pass caught** — none would have shown up in unit tests:

1. **`placeholder` silently dropped.** `AutoComplete` does not forward its props to a supplied child `Input`,
   so the field rendered with no hint at all.
2. **`maxLength` did nothing**, and antd said so on every keystroke: *"Passing 'maxLength' to input element
   directly may not work because input in BaseSelect is controlled."* Dropping the child `Input` fixed both;
   the 255 cap is now enforced in `onChange`, matching the column.
3. **A race that silently undid the recruiter's typing.** The initial `GET /referral` seeds the form; if it
   resolved *after* the user had ticked the box and started typing, it reset both — on a slow connection that
   reads as "my save was rejected". Fixed with a request sequence guard: only the latest response may write
   state.

Also fixed: the section heading rendered inline with the checkbox (`REFERRAL ☐ This candidate was…`), because
an antd `Space` is inline-flex and `Checkbox` is inline-block; and the panel collapsed to a spinner on every
refetch, which made the modal jump at the moment the reader wanted to see the result — now only the *first*
load shows a spinner.

**Verified** — driven through the real UI in Edge as both roles, against staging, with minted sessions:

| | |
|---|---|
| Recruiter marks a referral | chip, history row naming the actor, checkbox locks |
| Recruiter sees Remove **disabled** | with a tooltip explaining why |
| Recruiter `DELETE`s the API directly | **403** — the gate is the middleware, not the disabled button |
| Admin sees Remove **enabled** | |
| Admin submits an empty reason | refused, dialog stays open |
| Admin removes with a reason | history shows `Referral removed — was Anuj Kumar` plus the reason |

**14/14, run three times to confirm it is not flaky**, no page errors, `npm run build` clean. The throwaway
candidate, its audit rows and both minted sessions were deleted after each run; the audit table is back to 0.

<details><summary>Original Phase 4 plan</summary>

1. **Edit Candidate modal** ([`Candidates.jsx`](../frontend/src/pages/Candidates.jsx), the modal in the
   screenshot). A new **REFERRAL** section:
   - `Referral candidate` checkbox → `is_referral`
   - `Referred by` (shown only when ticked, **required**) → `referred_by`
   - `Note` (optional) → `referral_note`
   - the per-candidate history strip from §6.4
2. **Removal is admin-tier only** (decision, 2026-09-04). Un-ticking the box or clearing the name opens a
   confirm dialog requiring a typed **reason**; save is blocked without it. That reason is what makes the
   `removed` audit row an incident record rather than a bare timestamp.
   - Server gate: `requireAdmin` ([`middleware/auth.js:164`](../backend/src/middleware/auth.js#L164)) — it
     already exists and already means `isAdminTier`, so no new middleware.
   - For a recruiter the controls render **disabled with a tooltip**, not hidden. A recruiter who cannot find
     the checkbox will ask a colleague to edit the row some other way; one who can see it is greyed out
     understands the rule. The server gate is the control either way — the UI state is only courtesy.
3. **Service + audit write** in one transaction: update `rpa_cv`, insert the `rpa_referral_audit` row. Never one
   without the other.
4. **Replace, don't duplicate, `Job Source`.** Leave the field, but if it currently matches `/referr/i`, surface
   a hint pointing the recruiter at the new checkbox.

</details>

### Phase 5 — ✅ **DONE 2026-09-04** — recruiter read surfaces

**Where it now shows** — one shared [`ReferralChip`](../frontend/src/components/candidates/ReferralChip.jsx),
not four copies, because the rule attached to this flag is strict enough that four copies would drift:

| Surface | Shows | Names the referrer? |
|---|---|---|
| Search Candidate table | chip beside the name | **No** — broad, screenshot-able list |
| Candidate Screening result row | chip beside the name | **No** — this is the surface the transcript's flow needs: the recruiter sees it *while deciding whether to shortlist* |
| Candidate Screening detail panel | "Yes — referred by …", beside Job Source | Yes |
| Pipeline board card | chip | **No** |
| Pipeline drawer header | chip + "Referred by …" | Yes — where the recruiter and the final decision-maker actually weigh the candidate |
| Pipeline CSV | `Referral` / `Referred By` columns | Yes — recruiter-only, and **never** the dossier (§5 Tier C) |

**Phase 6 row 6 closed here**, because this is the phase that exposes the columns. `search()` returns nearly
every `rpa_cv` column and a vendor can legitimately call it, so the referral columns are **dropped from the
query** for vendor callers (`REFERRAL_COLUMNS` in `candidate.service.js`, `isVendor()` in `vendorScope.js`) —
not filtered from the result. Nothing to leak beats something correctly hidden. The pipeline and screening
routers need no equivalent: both are already `requireStaff`, which is rank-based and excludes vendors.

**A refactor the codebase asked for.** The first version put the mapping inline in `candidate.service.js` and
imported it into the unit test — which hung, because reaching it drags in Prisma, the socket layer and the
Gemini chain. That is the exact trap [`vendorScope.js`](../backend/src/utils/vendorScope.js) documents as the
reason it was extracted. The rule now lives in [`referralView.js`](../backend/src/utils/referralView.js), pure
and DB-free, so the decision that governs disclosure is cheap to assert.

**Fail-closed, asserted.** `mapReferralFields()` turns a row with the columns *absent* — which is exactly what a
vendor's query returns — into `isReferral: false`, never `undefined` travelling onwards.

**One bug the browser caught:** wrapping the table cell in an antd `<Space>` (inline-flex) made its children
shrink to minimum content width, breaking a long candidate name into **one character per line**. Replaced with
plain inline flow. Unit tests could not have seen this; a short name would not have either.

**Verified** — 12/12 against staging on a throwaway candidate with a real pipeline journey: staff see the flag
on search, detail, board and drawer; a vendor's payload contains **no referral field and no "Anuj" anywhere**;
the board carries the boolean but not the name. Plus 5/5 in the browser confirming the chip appears only after
marking and the referrer name never reaches the table. **573 tests pass, 0 fail**; `npm run build` clean;
probe rows and sessions deleted.

<details><summary>Original Phase 5 plan</summary>

A referral chip on: the Search Candidate results row, the Candidate Screening result row and detail panel
(this is the surface the transcript's flow actually needs — *before* shortlisting), the pipeline board card and
filter, and the drawer header with "Referred by". `getPipelineDetail()` already reads `rpa_cv`
([`pipeline.service.js:631`](../backend/src/services/pipeline.service.js#L631)) — adding the column to that
`select` is one line.

</details>

### Phase 6 — ✅ **DONE 2026-09-04** — suppression, all nine surfaces

**Executed, not eyeballed.** A real candidate was marked as a referral from "Anuj Kumar", then every
interviewer-facing builder was asked for its output and the **whole payload stringified** and checked. Whole
payloads, not named fields — that is what catches a re-introduced spread, which is how this class of leak
comes back.

| # | Surface | Result |
|---|---|---|
| 1 | Public scorecard, **every** `recipient_role` (`interviewer` / `hr` / `ceo`) | ✅ clean — Phase 1's whitelist |
| 2 | Scorecard invite email tokens | ✅ clean — explicit token map, no referral key |
| 3 | Interview invite email **and the Teams calendar body** | ✅ clean — `interviewTokens()` is a whitelist, and it receives the *shortlist* row, while the referral lives on `rpa_cv` |
| 4 | Candidate dossier — `dossierRedaction.js` | ✅ done Phase 3 |
| 5 | Dossier model builder | ✅ safe **by construction** — `CV_SELECT` is *derived from* `pickCvProfile()`, so the referral columns are never even SELECTed |
| 6 | `search()` select-all, vendor-reachable | ✅ done Phase 5 — columns dropped from the query |
| 7 | Leak scan | ✅ added `referral wording` to `ALWAYS` and a `--referrer "Anuj Kumar"` flag |
| 8 | Recording share | ✅ verified clean + a regression test: `describeShareLink()` handed a row joined with the candidate still emits only its four named fields |
| 9 | Document upload page | ✅ `getRequestByToken()` returns a named whitelist (state, candidate_name, position, items) |

**The anchoring trap, caught by falling into it.** The first run of the probe reported a leak in the dossier
model: it had matched `PreferredShift` — "p-**referr**-ed". The probe's regex was unanchored; the real guards
are not (`/(^|_)referr/i` in `dossierRedaction.js`, `\b(referral|referred by|…)\b` in the leak scan). The code
was right and the test was wrong — which is itself the evidence that the anchoring matters, and there is now a
unit test pinning `isForbiddenKey('PreferredShift') === false`.

The probe also had to strip the pack's own redaction notice before checking, since `redactionSummary()` now
says *"Whether the candidate was referred by an employee, and by whom"* — the sentence that promises there is
no referral in the file would otherwise read as one. Same rule `dossier-leak-scan.mjs` states in its header,
and it imports the wording rather than restating it.

**One latent risk found, not an active leak.** The Teams calendar body is composed inline as
`...${notes ? \`<p>${notes}</p>\` : ''}` ([`interviewSchedule.service.js:873`](../backend/src/services/interviewSchedule.service.js#L873)),
where `notes` is recruiter free text on the schedule payload. **No UI currently sends it** — the drawer's
schedule modal has no notes field — so nothing leaks today. But the API accepts it, and a Teams invite is the
one artefact that cannot be redacted afterwards (barrier B5 meeting B6). If a notes field is ever added to the
schedule modal, it needs a warning that its text goes into the interviewer's calendar forever. Deliberately
**not** "fixed" now: adding a hint to a field that does not exist would be inventing UI.

**Verified:** 8/8 on the executed checklist against staging; **574 tests pass, 0 fail**; probe rows deleted,
audit table back to 0.

<details><summary>Original Phase 6 plan</summary>

| # | Surface | File | Action |
|---|---|---|---|
| 1 | Public scorecard payload | [`interviewScorecard.service.js:73`](../backend/src/services/interviewScorecard.service.js#L73) | Done in Phase 1. **Nothing to add** — no `recipient_role` shows the flag, `ceo` included. Just never select the referral columns in this path. |
| 2 | Scorecard invite email tokens | [`interviewScorecard.service.js:119-160`](../backend/src/services/interviewScorecard.service.js#L119-L160) | Never add a referral key to the interviewer/HR token map — barrier B4. |
| 3 | Interview invite email + **Teams calendar body** | [`interviewSchedule.service.js:601`](../backend/src/services/interviewSchedule.service.js#L601) | Never carries it — barrier B5, irreversible. |
| 4 | Candidate dossier | [`dossierRedaction.js`](../backend/src/utils/dossierRedaction.js) | ✅ **Done in Phase 3** — the guard must exist before the data does. All five `rpa_cv` keys plus `old_referred_by`/`new_referred_by` in `FORBIDDEN_KEYS`; `/(^\|_)referr/i` in `FORBIDDEN_KEY_PATTERNS`; a line in `redactionSummary()`. **The anchor is load-bearing:** an unanchored `/referr/i` also matches `PreferredShift` ("p-REFERR-ed"), a whitelisted profile field — that guard would strip real content from every dossier and be switched off within a week. Still to do: replace the placeholder row in [CANDIDATE-COMPLETE-DOWNLOAD-PLAN.md §8.2](phase3/CANDIDATE-COMPLETE-DOWNLOAD-PLAN.md). |
| 5 | Dossier model builder | [`dossierModel.js`](../backend/src/utils/dossierModel.js) | Confirm the CV row is still copied field-by-field via `CV_PROFILE_FIELDS`, never spread. |
| 6 | **`search()` select-all** | [`candidate.service.js:623`](../backend/src/services/candidate.service.js#L623) | ⚠️ Returns all ~80 columns and **vendors can call it**. Exclude the referral columns for vendor callers. |
| 7 | Leak scan | [`dossier-leak-scan.mjs`](../backend/scripts/dossier-leak-scan.mjs) | Always-on `/\breferr(al\|ed)\b/i` check over the composed files, plus a `--referrer "Anuj"` flag. Mind its own note: the redaction notice must not trip it. |
| 8 | Recording share | [`recordingShareModel.js`](../backend/src/utils/recordingShareModel.js) | Verified clean. Add a regression test. |
| 9 | Document upload page | [`document.controller.js`](../backend/src/controllers/document.controller.js) | Candidate-facing. Confirm no CV-row spread. |

</details>

### Phase 7 — ✅ **DONE 2026-09-04** — the Referral Log

**Written**

| File | What |
|---|---|
| [`exports/referralAudit.export.js`](../backend/src/exports/referralAudit.export.js) | **New.** CSV columns + filter parsing + fetch. |
| [`services/referral.service.js`](../backend/src/services/referral.service.js) | `buildAuditWhere()` + `queryReferralAudit()`. |
| [`controllers/admin.controller.js`](../backend/src/controllers/admin.controller.js) | `listReferralAudit`, `exportReferralAudit`. |
| [`routes/admin.routes.js`](../backend/src/routes/admin.routes.js) | `GET /admin/referral-log` and `/export`. |
| [`components/admin/ReferralLogPanel.jsx`](../frontend/src/components/admin/ReferralLogPanel.jsx) | **New.** The report screen. |
| [`pages/AdminDashboard.jsx`](../frontend/src/pages/AdminDashboard.jsx) | A "Referral Log" tab. |

**Admin-tier by inheritance**, from the router-wide `restrictTo('admin','superadmin')` already on `/api/admin`
— no new gate. That placement is the point: any recruiter may *set* a referral, but only admin-tier may remove
one or read the record of who did.

**Design decisions**

- **Removals get their own count and their own one-click filter.** A red `1` beside the total answers "has
  anyone been quietly undoing referrals?" without paging through the list — which is the question the log
  exists for.
- **`buildAuditWhere()` is shared by the screen and the CSV**, so the file can never contain rows the report
  did not — the same rule `pipeline.export.js` states for the board.
- **`acted_ip` is stored on every row but is not a column and not in the payload.** It is corroboration for an
  investigation, not something to spread across a spreadsheet that gets mailed around. Asserted both ways.
- **The report is NOT company-scoped**, deliberately: `rpa_cv` carries no `company_id`, so the candidate
  database is shared across tenants. Scoping by the acting admin's company would filter on the *actor* rather
  than the subject and hide rows about candidates they can see on every other screen. Written down in
  `buildAuditWhere()` as one of the places to change if candidates ever become tenant-scoped.
- **A deleted candidate's row says "candidate deleted"** rather than showing a blank id — the `ON DELETE SET
  NULL` design means the row outlives its subject on purpose, so the screen should say so.

**Verified** — 22/22 against staging, building a real trail (mark → change → remove) and then:

- recruiter `GET /admin/referral-log` → **403**; `/export` → **403**
- admin → 200, all three events, newest first, removal preserving the erased referrer and its reason
- `action=removed` filters to removals; `referrer=Naveen` matches **either side** of a change, so searching a
  name finds both the marking that named them and the removal that erased them
- CSV carries the headers and the reason, and **contains no `acted_ip`**
- the Admin Portal tab renders it, with the old referrer struck through and `Anuj Kumar → Naveen Sharma` on
  the change row

**Also fixed while there:** the Admin Portal subtitle read a fixed *"Users · Access · Companies"* — but
Companies is superadmin-only, so a plain admin was already being promised a tab they do not have. It is now
built from what the account can actually open.

**574 tests pass, 0 fail**; `npm run build` clean; probe rows, sessions and audit rows deleted.

<details><summary>Original Phase 7 plan</summary>

The §6.4 Referral Log view and CSV, plus:

- **Unit** `referralVisibility.test.js` — a pure `canSeeReferral({ surface, recipientRole })`, no DB, matching
  the constraint `dossierRedaction.js` documents for itself.
- **Unit** extend [`dossierRedaction.test.js`](../backend/src/tests/unit/dossierRedaction.test.js) —
  `isForbiddenKey('is_referral' | 'referred_by' | 'referral_note')` all true; `assertNoForbiddenFields()` throws
  on a model carrying one.
- **Unit** assert the interviewer and HR token maps contain no key matching `/referr/i`.
- **Unit** the audit writer — `marked` / `updated` / `removed` each produce exactly one row with both sides of
  the change; `removed` without a reason is rejected.
- **Integration** extend
  [`schedulingAndScorecard.test.js`](../backend/src/tests/integration/schedulingAndScorecard.test.js) — mark a
  candidate as a referral, dispatch cards for `tech1` / `hr_round` / `ceo`, assert
  `JSON.stringify(GET /scorecard/:token)` matches no `/referr/i` for **all three**. **Stringify the whole
  response body**, not named fields — that is what catches a future re-introduced spread. With no exception to
  encode, this is a single loop over every card rather than a per-role expectation.
- **Unit** the removal gate — a `recruiter` token is refused by `DELETE /api/candidates/:id/referral`, an
  `admin` token succeeds, and neither path writes the CV row without also writing the audit row.
- **Script** `npm run dossier:leakscan <pack.zip> --referrer "Anuj"` on a real pack.
- **Manual** the 9-surface checklist, as a QA pass. This is the acceptance criterion.

</details>

### Phase 8 — ✅ **DONE 2026-09-04** — docs & rollout

| Deliverable | |
|---|---|
| [`CHANGES-phase3-referral-candidate.md`](changelog/CHANGES-phase3-referral-candidate.md) | The changelog entry, in the house style: what was asked, what was decided, the nine surfaces, what was deferred, and the one latent risk. |
| [`REFERRAL_CANDIDATE_RECRUITER_GUIDE.md`](reference/REFERRAL_CANDIDATE_RECRUITER_GUIDE.md) | **One page for Chhaya and the team**, in plain language — how to mark one, where it shows, why Remove is greyed out for them, and the two rules the system cannot enforce. |
| [`ROLE_RULES.md`](reference/ROLE_RULES.md) | Four rows in the quick reference, plus a section explaining the one rule in that document that is **not about accounts** — an interviewer has no role to deny, so the rule is enforced surface by surface. |
| [`CANDIDATE-COMPLETE-DOWNLOAD-PLAN.md`](phase3/CANDIDATE-COMPLETE-DOWNLOAD-PLAN.md) §8.2 | The **forward-looking placeholder is now the real row** — the one that said *"Add to this table when the field lands, so the dossier is not the hole in that rule."* |
| [`scripts/referral-jobsource-scan.mjs`](../backend/scripts/referral-jobsource-scan.mjs) | `npm run referral:jobsource-scan` — lists candidates whose `Job Source` free text looks like a referral, with a guessed referrer name, so they can be converted **by hand**. |

**The scan is a report, not a backfill**, and that is the decision rather than laziness: a script cannot tell
"Referral - Anuj" from "Referral programme (not used)", and a referral *grants hiring preference* — so a wrong
flag tips a real hiring decision. An automatic backfill would also put the machine's name on every audit row,
which is precisely the accountability the log exists to provide. It is `\b`-anchored for the usual reason:
unanchored, it returns every candidate whose Job Source says "preferred vendor".

Run against staging: **0 candidates to review, 0 already flagged** — expected, since staging is mostly test
fixtures. Worth running on production before go-live.

<details><summary>Original Phase 8 plan</summary>

Changelog entry in [`docs/changelog/`](changelog/); a row in [ROLE_RULES.md](reference/ROLE_RULES.md); and a
short note to recruiters covering the two rules that no code can enforce: **never write the referral on the
resume file** (§5.3), and **stop typing it into Job Source** (§4.2).

</details>

**Total ≈ 7.25 developer-days**, plus Phase 0.

---

## 8. Roadblocks and barriers

**B1 — There is no interviewer to deny. 🔴**
Access control cannot express R5. Five interviewer-facing surfaces, each an independent hole. Budget Phase 6 as
the largest phase and treat the 9-row checklist as the definition of done. Do not accept "the permission check
passes" as evidence.

**B2 — ~~No `final decision-maker` role~~. ✅ Closed.**
Resolved as a permissions question (2026-09-04): visibility is `superadmin` / `admin` / `recruiter`, which
`requireStaff` already expresses — no new role or module key. The login dependency it created is closed too:
the final decision-maker will hold an `admin`/`recruiter` account (§5.1). All that remains is provisioning.

**B3 — ~~The CEO scorecard is a public URL~~. ✅ Eliminated.**
The decision that no unauthenticated surface shows the flag removes this barrier outright. There is no chip on
a uuid-protected page, no config flag, and no `recipient_role` gate to get wrong.

**B4 — Email templates are DB rows an admin can edit. 🟠**
`rpa_email_templates` is deliberately editable without a developer. If a referral value ever enters the token
map for an interviewer template, an admin leaks it by adding `{{referral}}` — no code change, no review, no
failing test. **The token map is the boundary.** Assert its absence in a unit test.

**B5 — The Teams calendar event is irreversible. 🔴**
[`graphCalendar.service.js`](../backend/src/services/graphCalendar.service.js) writes subject and body into
Microsoft's calendar. The interviewer keeps that invite forever; we cannot redact it retroactively. Of all nine
surfaces this is the only one where a mistake cannot be undone.

**B6 — Bias leaks by inference, not only by field. 🟠**
`JobSource` free text, `RecruiterInfoAAPNA`, `recruiter_notes` pasted into an email, and the resume file itself
(§5.3). The flag is the easy half; free text is the half that actually leaks.

**B7 — The actor identity is not threaded to the service. 🔴**
[`candidate.controller.js:83`](../backend/src/controllers/candidate.controller.js#L83) does not pass `req.user`.
**The audit log cannot be built until Phase 3 fixes this.** Also settle the `requireStaff` / vendor-scope
question on that route while there.

**B8 — Sequencing against work in flight. 🟠**
Both source documents put this at **P1, after** the real-hiring validation and the three P0 items. Two of those
— the candidate dossier and recording share links — are **uncommitted on this branch right now**
(`dossierRedaction.js`, `dossierModel.js`, `candidateDossier.export.js`, `recordingShare.*`,
`dossier-leak-scan.mjs`). Phase 6 edits four of them. **Land the dossier work first**; referral is then purely
additive.

**B9 — Terminology collision with the next P1 item. 🟡**
The next requirement redefines sources as College Placement / Placement / Vendor. Keeping referral a boolean
overlay (§4.2) is what stops the two fighting over one column.

**B10 — Historical data. 🟡**
Past referrals sit, if anywhere, in `JobSource` free text. **Report, don't backfill** — a script listing
`rpa_cv` rows whose `JobSource` matches `/referr/i`, handed to recruiters to set by hand. An automatic backfill
would guess, and a wrong referral flag tips a hiring decision.

**B11 — Free-text referrer names make poor reports. 🟡 Accepted.**
Free text is the decision (2026-09-04), so "Anuj", "anuj k", "Anuj Kumar" and "AnujK" will be four rows in any
report grouped by referrer, and no later query can merge them reliably. Blunted — not fixed — by the normalise-
on-write and self-seeding autocomplete in §5.2. Revisit only if the referrer name ever has to drive a payout.

**B12 — Windows / Prisma file locks. 🟢**
`prisma:generate` fails with `EPERM` unless the dev server **and** the queue worker are stopped.

---

## 9. Open questions

### 9.1 Answered — 2026-09-04

| # | Question | Answer |
|---|---|---|
| Q1 | Where does the final decision-maker read the flag? | **In the ATS, logged in.** No unauthenticated surface shows it — the CEO-card exception is dropped (§5 Tier B). Creates the login dependency in §5.1. |
| Q2 | Does the HR-round card show it? | **No.** Subsumed by Q1 — no public card shows it. |
| Q3 | Which roles see it? | **`superadmin`, `admin`, `recruiter`** (incl. the legacy `hr` alias), logged in. `vendor` excluded — hence Phase 6 row 6. |
| Q4 | Free text or picker for `Referred by`? | **Free text.** Cost and mitigations in §5.2; B11 accepted. |
| Q6 | Who may remove a referral? | **Any recruiter may set it; only admin-tier may remove it**, with a mandatory reason (Phase 4 item 2). |

### 9.2 Still open — none are blocking

| # | Question | Why it matters | Recommendation |
|---|---|---|---|
| Q5 | Who may **view the Referral Log** report? | It contains exactly what R6 says most people should not see. | Admin-tier only — consistent with admin-tier owning removals. |
| Q7 | Should the flag appear in the recruiter's **CSV exports**? | A CSV is forwardable (§5 Tier C). | Yes for the pipeline CSV; never for the dossier. |
| Q8 | Audit **retention** — forever? survive candidate deletion? | Decides `ON DELETE SET NULL` vs `CASCADE` (§6.2). | Keep forever; survive deletion (`SET NULL` + snapshots), as the DDL is currently written. |

I will build to the recommendations unless told otherwise; each is a one-line change if you disagree later.

---

## 10. ✅ What is needed from you before work starts

✅ **Everything blocking is answered** (§9.1 and below). Work is unblocked; Phase 1 is done.

### Answered — 2026-09-04

| # | Question | Answer |
|---|---|---|
| 1 | Does the final decision-maker have an ATS login? | **Yes — `admin` / `recruiter`.** Closes §5.1 and B2. |
| 2 | Who applies the DDL, and where first? | **Pankaj, against staging.** |
| 3 | A window to stop the dev server *and* queue worker for `prisma:generate`? | **Agreed** (barrier B12). |
| 4 | Merge the `serializeCard()` fix separately, first? | **Yes** — done, §7 Phase 1. |

### Still owed by us, not by you

- **Provision the final decision-maker's account** and confirm it is **active** — an inactive account is
  refused at [`auth.js:68`](../backend/src/middleware/auth.js#L68) and would read as a broken feature (§5.1).
- ~~Browser pass over the four scorecard states~~ — **done, §7 Phase 1.**

### Housekeeping — staging test fixtures

The integration suite (`src/tests/integration/`) runs against the **live staging database** and tears its rows
down by explicit id at the end of a run. Two runs were interrupted on 2026-09-04, so their teardown never
executed, leaving **16 orphan rows** tagged `PHASE3-TESTPASS-FIXTURE`. Staging held **227** more from earlier
runs — **243 total**, which is what inflates the Search Candidate count and puts names like
`PIPE17 …`, `E2E03 …`, `SCHED05 …` in the list.

Nothing has been deleted. Worth a decision: clear all 243, clear only the 16, or leave them. Note the
fixture helper's own warning — `prisma/cleanup-test-data.js` must **not** be used on this database, because it
matches on a time window and would also catch a colleague's concurrent work.

### Confirmations — not blocking; I will proceed on the recommendation if I hear nothing

5. **Q5, Q7, Q8** (§9.2) — Referral Log visible to admin-tier only; flag in the pipeline CSV but never the
   dossier; audit rows kept forever and surviving candidate deletion.
6. **Sequencing (B8).** My recommendation is to wait for the in-flight dossier / recording-share work to land
   before Phase 6, which edits four files that are uncommitted on this branch right now.
7. **The recruiter rules note (Phase 8).** Who tells Chhaya and the team that (a) the referral must never be
   written on the resume file (§5.3), and (b) `Job Source` must stop being used for it (§4.2)? **No code can
   enforce either** — the resume travels inside the dossier byte for byte and is not even scanned.
8. **B10 — the `JobSource` scan.** Do you want a report of existing candidates whose `Job Source` looks like a
   referral, so recruiters can set the flag by hand? Small script; no automatic backfill.
9. **Legacy `hr` accounts.** Any account still on the rank-20 `hr` alias will see the flag (§5 Tier A). Confirm
   that is intended, or have those accounts moved to `recruiter`.

### Not needed from you

Nothing in this feature requires new Microsoft Graph permissions, new third-party accounts, or infrastructure
changes. It is entirely internal to the ATS.

---

## 11. Sequencing and effort

### 11.1 Where this sits

Both source documents agree, and neither puts it first: *Start Work Priority Plan* §3 — **"Next – P1: Referral
Candidate flag + permissions"**, after the P0 block; matrix — `P1 | Referral visibility | Next`; §5 sequence —
**step 8 of 16**; *Change Requirements* §21 — **Step 6**.

### 11.2 Effort

| Phase | Work | Est. |
|---|---|---|
| 0 | Decisions (§9, §10) — not developer time | — |
| 1 | 🔴 `serializeCard()` prerequisite | 0.25 d |
| 2 | DDL (flag + audit table) + `prisma:pull` | 0.5 d |
| 3 | 🔴 Thread actor identity + dedicated referral endpoint | 0.5 d |
| 4 | Write path on Search Candidate + admin-tier removal dialog + audit write | 1.5 d |
| 5 | Recruiter read surfaces | 1.0 d |
| 6 | Suppression — the 9-surface checklist (**no `ceo` gate to build**) | 1.25 d |
| 7 | Referral Log report + CSV + tests | 1.5 d |
| 8 | Docs + recruiter rules note | 0.5 d |
| | **Total** | **≈ 7 days** |

The Tier B decision took a little off Phase 6 — there is no `recipient_role` gate and no config flag to write —
but the saving is modest, because the work there was never the gate. It was walking nine surfaces one at a time.

### 11.3 Recommended order

1. **Phase 1 alone, merged separately.**
2. **Land the in-flight dossier / recording-share work** (B8).
3. Phases 2–8 on a settled base.

---

## 12. Definition of done — ✅ **all met, 2026-09-04**

Phases 1–8 are complete. What remains is not development:

- **Provision the final decision-maker's `admin`/`recruiter` account** and confirm it is **active** (§5.1) —
  an inactive account is refused at [`auth.js:68`](../backend/src/middleware/auth.js#L68) and would read as a
  broken feature.
- **Apply the DDL to production** when this ships (staging is done).
- **Send [the recruiter guide](reference/REFERRAL_CANDIDATE_RECRUITER_GUIDE.md)** to Chhaya and the team — it
  carries the two rules no code can enforce.
- **Run `npm run referral:jobsource-scan` on production** to find existing referrals hiding in `Job Source`.
- Optionally revisit the deferred items in §13 and the latent calendar-`notes` risk in Phase 6.


- [ ] A recruiter can mark a candidate as a referral from the **Search Candidate** page, recording who referred
      them (R1, R2).
- [ ] The flag is visible on Search Candidate, Candidate Screening, the board card and the drawer — to
      `superadmin` / `admin` / `recruiter` while logged in, and to nobody else (R3, R6).
- [ ] A **`vendor`** account sees no referral field on any endpoint it can reach, `search()` included.
- [ ] The final decision-maker sees it at the final round **in the app** (R4) — and §10 item 1 is answered.
- [ ] **Every** mark, change and removal writes exactly one `rpa_referral_audit` row carrying the acting
      recruiter, timestamp, referrer name and candidate snapshot (R7).
- [ ] **Only admin-tier can remove a referral**; a recruiter attempting it is refused **server-side**, not
      merely hidden in the UI.
- [ ] **Removing a referral requires a typed reason** and is recorded as `action = 'removed'` naming the
      recruiter (R8).
- [ ] The Referral Log report filters by date, recruiter and action, has a Removals view, and exports to CSV.
- [ ] The audit row survives deletion of the candidate **and** of the acting user's account (§6.2).
- [ ] `JSON.stringify()` of `GET /api/scorecard/:token` matches no `/referr/i` for **every** `recipient_role`,
      `ceo` included — asserted on the **whole response body**, not on named fields (R5).
- [ ] No interviewer email, no scorecard invite and **no Teams calendar event** carries it (R5, B5).
- [ ] The vendor-reachable `search()` path does not return the referral columns (Phase 6 row 6).
- [ ] `assertNoForbiddenFields()` throws on any dossier model carrying a referral key; `dossier:leakscan` passes
      with `--referrer` on a real pack (R6).
- [ ] The 9-surface checklist has been walked by hand and signed off.
- [ ] `npm run test:unit` passes.

---

## 13. Deferred — not in this build

Recorded so the reasoning is not lost.

**Email-intake suggestion (was "Path 2").** When a resume arrives from an internal address, the sender is
already captured — [`emailResumeIntake.js:134`](../backend/src/jobs/emailResumeIntake.js#L134) stores
`from_email`, and [`outlookReader.service.js:17`](../backend/src/services/outlookReader.service.js#L17) already
defines `ADMIN_DOMAINS = ['aapnainfotech.com', 'aapna.com']`. The system could propose *"sent by
anuj@aapnainfotech.com — mark as referral?"* It would have to **suggest, never auto-set**: an internal sender is
also a recruiter forwarding a job-board result. Note a separate small bug found while investigating —
[`hrUpload.service.js:1056`](../backend/src/services/hrUpload.service.js#L1056) tags **every** email-intake
resume `"Self Applied"`, including one an employee forwarded, which is wrong today regardless of this feature.

**Employee referral form (was "Path 3").** Anuj submits the candidate himself through a tokenised public page —
the pattern already exists in [`DocumentUpload.jsx`](../frontend/src/pages/DocumentUpload.jsx) and
[`MissingJdUpload.jsx`](../frontend/src/pages/MissingJdUpload.jsx). The only path where the system *knows* a
referral rather than being *told*. A feature in its own right.

**Never trust the candidate's own claim.** A candidate writing "referred by Anuj" in their covering email has an
obvious incentive. A referral must be confirmed by a recruiter or by the employee — which is precisely what
Path 1 and the audit log establish.

---

## 14. Related documents

- [CANDIDATE-COMPLETE-DOWNLOAD-PLAN.md](phase3/CANDIDATE-COMPLETE-DOWNLOAD-PLAN.md) — §8.2 reserves the row this
  feature fills.
- [INTERVIEWER-SCORECARD-PLAN.md](phase3/INTERVIEWER-SCORECARD-PLAN.md) — the public-link mechanism.
- [ROLE_RULES.md](reference/ROLE_RULES.md) — the four roles, and why none is "interviewer".
- [MANUAL_CANDIDATE_CV_DELETION.md](reference/MANUAL_CANDIDATE_CV_DELETION.md) — why the audit table uses
  `ON DELETE SET NULL`.
- [`dossierRedaction.js`](../backend/src/utils/dossierRedaction.js) — the whitelist-plus-assertion pattern to
  copy rather than reinvent.
