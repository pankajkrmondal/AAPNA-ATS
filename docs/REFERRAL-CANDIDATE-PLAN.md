# Referral Candidate — Implementation Plan

**Status:** Analysis / plan only. No code written.
**Priority:** P1 (both source documents place it after the P0 queue — see §9.1).
**Author:** Prepared 2026-09-04 from the Phase-3 review meeting pack.
**Sources:**
`E:\Recruitment Process Automation\Rakhi_madam_review_Phase-3\`
— `ATS App - Quick Update.docx` (verbatim transcript, 28 Aug 2026, 23:33–26:08)
— `Sanghamitra_Roy_ATS_Enhancement_Change_Requirements.docx` §4, §11, matrix row "P1 – High"
— `Sanghamitra_Roy_ATS_Start_Work_Priority_Plan.docx` §3 item 1, §5 step 8, §7 item 8

---

## 1. What was actually asked for

The transcript is unusually precise, so it is quoted rather than paraphrased. Sanghamitra Roy,
23:33–26:08:

> "But it will also show as referred referral candidate. … It is required."
>
> "Because even in the interview, like only the recruiter, if he is able to see, that is fine.
> **I don't want the interviewer to see.** But the recruiter need to see that it is a referral candidate."
>
> "Because after the whole selection process is done … if that person referral person gets shortlisted
> and there is one other person who gets shortlisted, we after all that where **nobody knows that it is a
> referral person**. At that stage, when it comes to me, we always give preference to the referral person.
> But the interviewers and the whole process are unaware that it is a referral person…"
>
> "No, as long as the recruiter knows it is fine. So when it comes to me, I will know — the recruiter and
> me, like final my interview should know that it is a referral candidate."
>
> "So recruiters say Chhaya is attending, Chhaya should know that it is a referral candidate. **None of the
> interview process should know** that it is a, because then you can't be non-bias… I need to know that it
> is a referred person and Chhaya needs to know in the beginning. … **Nobody in the other people in the
> system knows that it is a referred person.**"

And the entry point, from Harish at 22:42 — the flow that triggers the flag:

> "Let's say I have a referral from **Anuj**. Let's say as a recruiter, I got a referral from Anuj. So I can
> search that candidate and I can shortlist the candidate. I can tag [it] to that particular JD…"

### 1.1 The requirement as testable rules

| # | Rule | Derived from |
|---|---|---|
| R1 | A candidate can be marked **"Referral candidate"**, with **who referred them** recorded. | "referral from Anuj" |
| R2 | The mark is set by the recruiter at **search → shortlist → tag-to-JD** time. | 22:42 |
| R3 | The **recruiter** sees it, **from the beginning**. | "Chhaya needs to know in the beginning" |
| R4 | The **final decision-maker** sees it **at the final round**, when comparing two shortlisted candidates. | "when it comes to me, I will know" |
| R5 | **No interviewer** sees it — not in any round, not on the scorecard, not in any email or invite. | "None of the interview process should know" |
| R6 | Nobody else in the system sees it. | "Nobody in the other people in the system knows" |

R5 and R6 are the whole feature. R1–R4 are a day's work; R5–R6 are where the effort and the risk sit.

---

## 2. Current state — what exists today

Verified by inspection on branch `pankaj-work-staging-v16`.

**There is no referral concept anywhere.** `referral` / `referred_by` appear in zero source files and zero
schema columns. (The apparent grep hits in [schema.prisma](../backend/prisma/schema.prisma) are the substring
inside `Prefer**r**edShift`.) This is a clean, additive build — nothing to migrate away from.

**There is no `interviewer` role to deny.** [`config/roles.js`](../backend/src/config/roles.js) defines exactly
four roles — `superadmin (40) > admin (30) > recruiter / hr (20) > vendor (10)`. An interviewer is **not an
account**: they are an email address plus a `uuid` token. Their entire relationship with the ATS is:

- a **calendar invite** written into Microsoft Teams by [`graphCalendar.service.js`](../backend/src/services/graphCalendar.service.js);
- an **email** composed by `interviewTokens()` in [`interviewSchedule.service.js:601`](../backend/src/services/interviewSchedule.service.js#L601);
- the **public scorecard page** at `GET /api/scorecard/:token`, mounted with *no* `authenticate` middleware
  ([`scorecard.routes.js:15`](../backend/src/routes/scorecard.routes.js#L15));
- sometimes, a **candidate dossier** pack the recruiter downloads and emails to them
  ([`candidateDossier.export.js`](../backend/src/exports/candidateDossier.export.js));
- sometimes, an expiring **recording share link** ([`recordingShare.routes.js`](../backend/src/routes/recordingShare.routes.js)).

**Consequence, and it shapes the whole plan:** you cannot implement R5 with a permission check. There is no
subject to check. R5 is implemented **surface by surface** — five of them — and the acceptance criterion is
not "the guard works" but "each of these five was inspected and is clean".

**There is no `final decision-maker` role either.** See §7 barrier B2.

**The final decision-maker fills a scorecard through the same public link.**
`roleForStage()` at [`interviewScorecard.service.js:56`](../backend/src/services/interviewScorecard.service.js#L56)
returns `'ceo'` for `STAGE_KEYS.CEO`, `'hr'` for the HR round, `'interviewer'` otherwise. So the person who
must see the flag (R4) and the people who must not (R5) are reached by **the same mechanism**, told apart only
by `rpa_interview_scorecard.recipient_role`. That is the design crux — §5.

**Good precedent already exists.** [`dossierRedaction.js`](../backend/src/utils/dossierRedaction.js) is a
whitelist + a `FORBIDDEN_KEYS` assertion + `FORBIDDEN_KEY_PATTERNS`, with `assertNoForbiddenFields()` walking
the finished model and throwing in CI. It already forbids `jobsource`, `vendorname`, `ctc_lpa`. It is exactly
the shape this feature needs, and it should be extended rather than duplicated. The dossier plan even reserved
a row for this work — [CANDIDATE-COMPLETE-DOWNLOAD-PLAN.md §8.2](phase3/CANDIDATE-COMPLETE-DOWNLOAD-PLAN.md), line 638:

> | forward-looking | **referral flag** (P1 item, not built yet) | Sanghamitra, 23:33–26:08: the referral
> status must not reach interviewers. Add to this table when the field lands, so the dossier is not the hole
> in that rule. |

---

## 3. 🔴 Blocking prerequisite — a live over-disclosure on the public scorecard

**This must be fixed before the referral columns are added, or the feature ships broken on day one.**

`getScorecardByToken()` loads the card with a deep include
([`interviewScorecard.service.js:365-372`](../backend/src/services/interviewScorecard.service.js#L365-L372)):

```js
const card = await prisma.rpa_interview_scorecard.findUnique({
  where: { token },
  include: {
    rpa_interview_scorecard_skill: { orderBy: { sort_order: 'asc' } },
    rpa_interview_schedule: true,
    rpa_candidate_pipeline: { include: { rpa_shortlisted_candidates: { include: { mrf: true } } } },
  },
});
```

and returns it through `serializeCard()`
([line 73-92](../backend/src/services/interviewScorecard.service.js#L73-L92)), whose first act is a bare spread:

```js
function serializeCard(row) {
  if (!row) return null;
  const num = (v) => (v === null || v === undefined ? null : Number(v));
  return {
    ...row,          // ← carries rpa_candidate_pipeline → rpa_shortlisted_candidates → mrf
```

The `context` object built below it *is* a careful whitelist (name, email, position, stage, interviewer name,
start time) — but `card: serializeCard(card)` sits right next to it and undoes the discipline.

**What that means in practice.** The JSON body of an unauthenticated `GET /api/scorecard/:token` currently
carries, to every interviewer:

- the whole `rpa_shortlisted_candidates` row — `recruiter_notes`, `stage_notes`, `pipeline_status`,
  `email_subject`, `email_body_snapshot`, `candidate_email_all`, `shortlisted_by`;
- the whole `rpa_mrf` row — `submitter_email`, `hiring_manager_name`, `client_details`, `approved_by_abhijit`,
  `ceo_panel_details`, `additional_information`, `emailbody`, both interview-slot columns;
- the whole `rpa_interview_schedule` row — `graph_event_id`, `teams_join_url`, `teams_passcode`,
  `online_meeting_id`, `no_show_reason`.

It does **not** crash on the `BigInt` ids because [`app.js:24`](../backend/src/app.js#L24) installs a global
`json replacer`. It is **not rendered** — [`InterviewScorecard.jsx`](../frontend/src/pages/InterviewScorecard.jsx)
reads only `data.card.rpa_interview_scorecard_skill`. So this is over-transmission, not an on-screen display:
visible in the browser's Network tab, not on the page. That distinction is worth stating plainly rather than
overstating the severity.

But it is decisive for this feature. **`rpa_shortlisted_candidates` is exactly where the referral columns
belong** (§4), and today that row is spread wholesale into an unauthenticated response. Adding
`is_referral` / `referred_by` there without fixing this hands the referral status to every interviewer with
**zero code changes and no test failing**.

**Fix (Phase 1, ~2 hours).** Replace the spread with an explicit field list — the same construction
`serializeRecording()` and `pickCvProfile()` already use in this codebase:

```js
function serializeCard(row) {
  if (!row) return null;
  const num = (v) => (v === null || v === undefined ? null : Number(v));
  // Named fields, never a spread. This object is returned by a PUBLIC route
  // (scorecard.routes.js has no authenticate middleware), so a column added to
  // rpa_interview_scorecard next month must be invited here consciously — and
  // the include's pipeline/shortlist/mrf graph must never travel at all.
  return {
    id: Number(row.id),
    schedule_id: Number(row.schedule_id),
    pipeline_id: Number(row.pipeline_id),
    stage_key: row.stage_key,
    card_type: row.card_type,
    recipient_name: row.recipient_name,
    recipient_role: row.recipient_role,
    status: row.status,
    token_expires_at: row.token_expires_at,
    opened_at: row.opened_at,
    submitted_at: row.submitted_at,
    communication: num(row.communication),
    attitude: num(row.attitude),
    final_rating: num(row.final_rating),
    avg_score: num(row.avg_score),
    recommendation: row.recommendation,
    comments: row.comments,
    // …the hr_* card fields, which the leadership card renders…
    rpa_interview_scorecard_skill: (row.rpa_interview_scorecard_skill || []).map((s) => ({
      id: Number(s.id),
      scorecard_id: Number(s.scorecard_id),
      skill_label: s.skill_label,
      rating: num(s.rating),
      remark: s.remark,
      sort_order: s.sort_order,
    })),
  };
}
```

Then confirm the page still renders in all four states (`open`, `no_show`, `submitted`, `expired`) — the
submitted/expired states return `card` with no `context`, so they are the ones most likely to depend on a
field the spread was quietly supplying.

**This fix is worth doing on its own merits, ahead of the referral work.** It is small, it removes
`teams_passcode` and `recruiter_notes` from an unauthenticated payload today, and it converts the riskiest
part of the referral feature into a no-op.

---

## 4. Where the flag lives

### 4.1 Recommendation — `rpa_shortlisted_candidates`

| Candidate table | Verdict |
|---|---|
| `rpa_cv` (per person) | ❌ A referral is a fact about *this application*, and `rpa_cv` is read by the screening search, the AI pipeline, HR upload and the vendor portal — far too wide a blast radius for a field that must stay narrow. |
| **`rpa_shortlisted_candidates`** (per candidate-per-MRF) | ✅ **Recommended.** It is created at the exact moment R2 describes ([`screening.service.js:1949`](../backend/src/services/screening.service.js#L1949)); it already holds the recruiter's attribution (`shortlisted_by`, `shortlisted_at`); and `getPipelineDetail()` already includes it ([`pipeline.service.js:592`](../backend/src/services/pipeline.service.js#L592)), so the recruiter-facing half of the feature arrives nearly free. |
| `rpa_candidate_pipeline` (per journey) | ❌ Its `source` column is already surfaced on the board card, in the board filter and in the CSV export — see §4.2. |

### 4.2 Do **not** make referral a value of `rpa_candidate_pipeline.source`

`source` today takes `recruiter` / `vendor` / `screening_shortlist` / `bulk_excel` / `email_intake`
([`pipeline.export.js:32`](../backend/src/exports/pipeline.export.js#L32), mirrored in
[`Pipeline.jsx:46`](../frontend/src/pages/Pipeline.jsx#L46)). Adding `'referral'` to it would be wrong three
times over:

1. It is **already displayed** on the board card and in the CSV — a value there is disclosed by default,
   which is the exact opposite of what R5/R6 require.
2. It is **mutually exclusive** — a shortlist from screening writes `'screening_shortlist'`, so a referral
   would overwrite the real channel or be overwritten by it.
3. It **collides with the very next P1 item** — the same meeting asked for source categories to be redefined
   as College Placement / Placement / Vendor (§5 of the Change Requirements doc). Two features would then
   fight over one column.

**Keep them orthogonal: `source` is the channel; referral is a boolean overlay on top of it.** A vendor-sourced
candidate can also be a referral.

### 4.3 DDL

Following the repo convention — a hand-applied `.sql` plus a `.README.md`, then `prisma db pull`
(there is no `prisma migrate` in this project; see [`backend/prisma/ddl/`](../backend/prisma/ddl/)).

`backend/prisma/ddl/2026-09-XX-referral-candidate.sql`:

```sql
-- Referral candidate flag (P1, Sanghamitra 2026-08-28 23:33–26:08).
-- Safe to re-run. Nothing is dropped or backfilled.
ALTER TABLE public.rpa_shortlisted_candidates
  ADD COLUMN IF NOT EXISTS is_referral     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS referred_by     varchar(255),
  ADD COLUMN IF NOT EXISTS referral_note   text,
  ADD COLUMN IF NOT EXISTS referral_set_by varchar(255),
  ADD COLUMN IF NOT EXISTS referral_set_at timestamptz;

-- Partial: referrals are a small minority of rows, and the only query that
-- needs the index is "show me the referrals".
CREATE INDEX IF NOT EXISTS idx_shortlist_referral
  ON public.rpa_shortlisted_candidates (is_referral) WHERE is_referral;
```

Column-by-column rationale, in the style the DDL READMEs in this repo already use:

| Column | Answers |
|---|---|
| `is_referral` | The flag itself. `NOT NULL DEFAULT false` so every pre-existing row reads "not a referral" — the feature **fails closed on disclosure**, which is the correct direction for this one. |
| `referred_by` | "A referral from **Anuj**" — the transcript's own example. Free text, not an FK: the referrer is an employee who may have no ATS account. |
| `referral_note` | Context the recruiter wants to keep ("ex-colleague of Anuj, spoke to him directly"). Recruiter-only, never exported. |
| `referral_set_by` / `referral_set_at` | "Who decided this, and when?" A flag that tips a hiring decision needs an audit trail, and it is impossible to add retroactively. Cheap now. |

Apply with:

```bash
psql "$DATABASE_URL" -f prisma/ddl/2026-09-XX-referral-candidate.sql
cd backend && npm run prisma:pull && npm run prisma:generate
```

⚠️ `prisma:generate` takes a file lock on Windows — **stop the dev server *and* the queue worker**
(`npm run queue:worker`) first, or it fails with `EPERM`.

---

## 5. The visibility model

Because there is no interviewer role, visibility is decided **per surface**, not per user. Three tiers:

### Tier A — authenticated in-app staff → **visible**

Everything behind `authenticate` + `requireStaff` ([`middleware/auth.js:194`](../backend/src/middleware/auth.js#L194)):
the pipeline board, the drawer, Candidate Screening, the recruiter CSVs. Every one of these already shows the
recruiter far more than the referral flag, so R3 needs no new gate — only rendering.

Note honestly that this satisfies R3/R4 but is **wider than the literal words** "the recruiter and me": *every*
recruiter and admin will see it, not only the owning recruiter. Read against R5/R6 ("none of the interview
process", "nobody in the other people in the system"), the excluded party is the interviewer, not a
colleague — so this is almost certainly right. **Confirm it anyway** (§8 Q3).

### Tier B — public token links → **hidden, with one deliberate exception**

| Route | Rule |
|---|---|
| `GET /api/scorecard/:token` where `recipient_role = 'interviewer'` | **Hidden.** Tech1/2/3, client round. |
| `GET /api/scorecard/:token` where `recipient_role = 'hr'` | **Hidden** — recommended. See §8 Q2. |
| `GET /api/scorecard/:token` where `recipient_role = 'ceo'` | **Visible** — the R4 exception. See below. |
| `POST /api/documents/:token` (candidate upload) | **Hidden.** Candidate-facing. |
| `GET /api/recording-share/:token` | **Hidden.** Verified clean today — [`recordingShareModel.js`](../backend/src/utils/recordingShareModel.js) carries no candidate context at all. Keep it that way. |

**The CEO-card exception, stated honestly.** Sanghamitra fills the final-round scorecard through the same
unauthenticated uuid URL as an interviewer. Showing the chip there means the referral status is protected by a
uuid in an inbox and nothing else. Two options:

- **Option 1 (recommended).** Show a plain **"Referral candidate"** chip on the `ceo` card only, gated
  server-side on `card.recipient_role === 'ceo'`, behind a config flag
  (`REFERRAL_VISIBLE_ON_CEO_CARD`, default `true`) so it can be switched off without a deploy.
  **Show the chip, never the referrer's name** — `referred_by` and `referral_note` stay in-app. That keeps the
  forwardable artefact minimal while still answering R4 at the moment the decision is made.
- **Option 2.** Nothing on any public card; the final decision-maker reads the flag in the app. Cleaner and
  strictly safer, but it depends on her having an ATS login and opening it at the right moment.

**Recommendation: build both.** Option 2 (in-app) is required regardless; Option 1 is the flagged addition.
If §8 Q1 comes back as "she uses the app", turn the flag off and the risk disappears.

### Tier C — artefacts that leave the building → **hidden, always**

The candidate dossier and every export. No exception, no flag. Once a `.zip` is emailed there is no recall —
the reasoning [`dossierRedaction.js`](../backend/src/utils/dossierRedaction.js) opens with.

The one deliberate inclusion: the **recruiter's own pipeline CSV**
([`pipeline.export.js`](../backend/src/exports/pipeline.export.js)) may carry a `Referral` / `Referred by`
column — it is generated behind `requireStaff` for the recruiter's own use. Record this as a conscious
decision, because a recruiter can forward a CSV too.

---

## 6. Implementation plan

### Phase 0 — Decisions (blocking, ~0.5 day, no code)

Answer §8 Q1–Q5 with Sanghamitra / Chhaya. Q1 (does the final decision-maker use the app or the emailed
card?) and Q2 (does the HR-round card show it?) change the shape of Phase 4 and cannot be guessed safely.

### Phase 1 — Close the prerequisite (~0.25 day) 🔴

Rewrite `serializeCard()` per §3. Verify all four scorecard states still render. **Do this first, and
consider merging it separately** — it is a standalone improvement and it de-risks everything after it.

### Phase 2 — Schema (~0.25 day)

DDL + README per §4.3 → `prisma:pull` → `prisma:generate` (dev server *and* queue worker stopped).

### Phase 3 — Write path (~1.5 days)

1. **Shortlist modal** — [`DecisionEmailModal.jsx`](../frontend/src/components/screening/DecisionEmailModal.jsx),
   the shared Shortlist/Reject modal that already owns the mandatory "Tag to Open JD" selector on the keyword
   tab. Add a `Referral candidate` checkbox and, when ticked, a `Referred by` input.
   **⚠️ It shortlists the whole selection at once.** A referral is per-person, so a single checkbox over a bulk
   selection is wrong. **Offer the referral fields only when exactly one candidate is selected**, and rely on
   the drawer (below) for every other case. That matches the real flow — "I got a referral from Anuj" arrives
   one candidate at a time — without building a per-row editor now.
2. **Service** — thread `referral: { isReferral, referredBy, note }` through
   `screeningService.shortlistCandidates` → `screening.controller.js` → `shortlistCandidates(..., options)`
   at [`screening.service.js:1871`](../backend/src/services/screening.service.js#L1871). Stamp
   `referral_set_by = user.username`, `referral_set_at = now()`.
3. **⚠️ The undo-reject branch.** [`screening.service.js:1931`](../backend/src/services/screening.service.js#L1931)
   deliberately resets fields when re-shortlisting a previously rejected candidate. Decide explicitly whether
   the referral columns reset (recommendation: **preserve** — a person does not stop being a referral because
   one application was rejected) and **write the reason in a comment**, because the surrounding convention is
   to reset and a future reader will otherwise assume it was an oversight.
4. **Drawer edit** — a recruiter-only control in
   [`PipelineDrawer.jsx`](../frontend/src/components/pipeline/PipelineDrawer.jsx) + a `PATCH` on
   [`pipeline.routes.js`](../backend/src/routes/pipeline.routes.js). Referrals surface late ("actually, Anuj
   sent this one"), and without this the only way to set the flag is to reject and re-shortlist.
5. Write a `rpa_pipeline_stage_events` note when the flag changes, so the timeline records it.

### Phase 4 — Recruiter read surfaces (~1 day)

Board card + filter ([`Pipeline.jsx`](../frontend/src/pages/Pipeline.jsx)), drawer header chip and
"Referred by" line, the screening results row, and the optional CSV columns per §5 Tier C.
`getPipelineDetail()` already returns the shortlist row, so the drawer needs no new backend work.

### Phase 5 — Suppression (~1.5 days) — **the real work**

Each row is a separate change *and* a separate test:

| # | Surface | File | Action |
|---|---|---|---|
| 1 | Public scorecard payload | [`interviewScorecard.service.js:73`](../backend/src/services/interviewScorecard.service.js#L73) | Done in Phase 1. Add the `ceo`-gated chip to `context`, never to `card`. |
| 2 | Scorecard invite email tokens | [`interviewScorecard.service.js:119-160`](../backend/src/services/interviewScorecard.service.js#L119-L160) | Never add a referral key to the interviewer/HR token map. See barrier B4. |
| 3 | Interview invite email + Teams event body | `interviewTokens()`, [`interviewSchedule.service.js:601`](../backend/src/services/interviewSchedule.service.js#L601) | Never carries it. See barrier B5 — this one is irreversible. |
| 4 | Candidate dossier | [`dossierRedaction.js`](../backend/src/utils/dossierRedaction.js) | Add `is_referral`, `referred_by`, `referral_note`, `referral_set_by`, `referral_set_at` to `FORBIDDEN_KEYS`; add `/(^\|_)referr/i` to `FORBIDDEN_KEY_PATTERNS`; add a line to `redactionSummary()`. Replace the placeholder row in [CANDIDATE-COMPLETE-DOWNLOAD-PLAN.md §8.2](phase3/CANDIDATE-COMPLETE-DOWNLOAD-PLAN.md) with the real one. |
| 5 | Dossier model builder | [`dossierModel.js`](../backend/src/utils/dossierModel.js) | Confirm the shortlist row is still copied field-by-field, never spread. |
| 6 | Leak scan | [`scripts/dossier-leak-scan.mjs`](../backend/scripts/dossier-leak-scan.mjs) | Add an always-on `/\breferr(al\|ed)\b/i` word check over the composed files, and a `--referrer "Anuj"` flag. Mind its own design note: the redaction notice must not trip it. |
| 7 | Recording share | [`recordingShareModel.js`](../backend/src/utils/recordingShareModel.js) | Verified clean. Add a regression test so it stays that way. |
| 8 | Document upload page | [`document.controller.js`](../backend/src/controllers/document.controller.js) | Candidate-facing. Confirm no shortlist-row spread. |
| 9 | Consolidated feedback block | [`interviewScorecard.service.js:678`](../backend/src/services/interviewScorecard.service.js#L678) | Recruiter-facing today. Confirm it is never emailed outward. |

### Phase 6 — Tests (~1 day)

- **Unit** `referralVisibility.test.js` — a pure `canSeeReferral({ surface, recipientRole })`, testable with
  no DB, matching the constraint [`dossierRedaction.js`](../backend/src/utils/dossierRedaction.js) documents
  for itself.
- **Unit** extend [`dossierRedaction.test.js`](../backend/src/tests/unit/dossierRedaction.test.js) —
  `isForbiddenKey('is_referral' | 'referred_by' | 'referral_note')` all true; `assertNoForbiddenFields()`
  throws on a model carrying one.
- **Unit** assert the interviewer and HR scorecard token maps, and the interview-invite token map, contain no
  key matching `/referr/i`.
- **Integration** extend
  [`schedulingAndScorecard.test.js`](../backend/src/tests/integration/schedulingAndScorecard.test.js) — mark a
  journey as a referral, dispatch cards for `tech1` / `hr_round` / `ceo`, then assert
  `JSON.stringify(GET /scorecard/:token)` contains no `/referr/i` for the first two. **Stringify the whole
  response**, not named fields — that is what catches a future re-introduced spread.
- **Script** `npm run dossier:leakscan <pack.zip> --referrer "Anuj"` on a real pack.
- **Manual** the 9-surface checklist from Phase 5, run as a QA pass — this is the acceptance criterion.

### Phase 7 — Docs & rollout (~0.5 day)

Changelog entry in [`docs/changelog/`](changelog/); a row in
[ROLE_RULES.md](reference/ROLE_RULES.md); and a short note to recruiters that referrals now go in the
structured field and **must stop being typed into `JobSource`** (barrier B6).

**Total: ≈ 6 developer-days**, plus Phase 0 which is not developer time.

---

## 7. Roadblocks and barriers

Ordered by how likely each is to actually bite.

**B1 — There is no interviewer to deny. 🔴**
Access control cannot express R5, because the interviewer is not a subject in the system — they are an email
address and a uuid. Every one of the five interviewer-facing surfaces (§2) is an independent hole that must be
closed and tested on its own. *Plan accordingly:* budget Phase 5 as the largest phase, and treat the
9-row checklist as the definition of done. Do not accept "the permission check passes" as evidence.

**B2 — There is no final-decision-maker role either. 🟠**
Roles are `superadmin / admin / recruiter / vendor`. "The recruiter and me" maps to "all internal staff" —
which reads correct against R5/R6 (the excluded party is the interviewer), but is wider than the literal
words. If it must be narrower, the options are a new module key (`referral_visibility` in
[`config/roles.js`](../backend/src/config/roles.js) `MODULES`) or a named user list — a materially bigger
change. **Confirm in Phase 0 (§8 Q3).**

**B3 — The CEO scorecard is a public URL. 🟠**
R4's natural home is an unauthenticated page behind a uuid, sitting in an inbox, forwardable. Mitigated by
§5's Option 1: chip only, never the referrer's name, behind a config flag. Not eliminated.

**B4 — Email templates are database rows an admin can edit. 🟠**
`rpa_email_templates` is deliberately editable without a developer (a separate requirement from the same
meeting). If a referral value ever enters the token map for an interviewer template, an admin can leak it by
adding `{{referral}}` — no code change, no code review, no test failure. **The token map is the boundary.**
Never pass it; assert its absence in a unit test (Phase 6).

**B5 — The Teams calendar event is irreversible. 🔴**
[`graphCalendar.service.js`](../backend/src/services/graphCalendar.service.js) writes the event subject and
body into Microsoft's calendar. The interviewer keeps that invite in their own mailbox forever and we cannot
redact it retroactively. **Nothing referral-related may ever enter an event body.** Of all nine surfaces this
is the only one where a mistake cannot be undone.

**B6 — Bias leaks by inference, not only by field. 🟠**
The flag is the easy half. A referral is equally visible through:
`rpa_cv.JobSource` — **free text where recruiters can already type "Referral – Anuj" today**, and which flows
to `jobSource` in [`candidate.service.js:108`](../backend/src/services/candidate.service.js#L108);
`RecruiterInfoAAPNA`; `recruiter_notes` / `stage_notes` pasted into an outbound email; the candidate's own
resume. (`JobSource` is *already* in the dossier's `FORBIDDEN_KEYS`, so the pack is safe — the exposure is the
in-app fields and anything hand-copied out of them.) *Mitigation:* no recruiter-authored free text travels to
an interviewer surface, plus the leak-scan word check, plus the recruiter note in Phase 7.

**B7 — Undo-reject resets the shortlist row. 🟡**
[`screening.service.js:1931`](../backend/src/services/screening.service.js#L1931) resets fields on
re-shortlist. Decide and comment (§6 Phase 3.3), or a referral will silently vanish on the first
reject-then-reconsider.

**B8 — One person, many shortlist rows. 🟡**
Per-MRF storage means the same person can be a referral on one role and not another. Arguably correct
(the referral was *for* that role) but it will confuse. Alternative is `rpa_cv`, rejected in §4.1 for blast
radius. Needs a one-line business confirmation (§8 Q4).

**B9 — Sequencing against work in flight. 🟠**
Both source documents put this at **P1, after** the real-hiring validation and the three P0 items. Two of
those three — the candidate dossier and recording share links — are **uncommitted on this branch right now**
(`dossierRedaction.js`, `dossierModel.js`, `candidateDossier.export.js`, `recordingShare.*`,
`dossier-leak-scan.mjs`). Phase 5 edits four of those files. **Starting referral before the dossier work lands
guarantees merge conflicts in exactly the security-critical files where a bad merge is most expensive.**
*Recommendation:* land the dossier and recording-share work first; referral is then purely additive on top.

**B10 — Terminology collision with the next P1 item. 🟡**
The very next requirement redefines sources as College Placement / Placement / Vendor. Keeping referral as a
boolean overlay (§4.2) is what stops the two features fighting over one column. If someone implements
referral as a source value first, that work has to be undone.

**B11 — Historical data. 🟡**
Past referrals are recorded, if anywhere, inside `JobSource` free text. *Recommendation:* **report, don't
backfill** — a small script listing `rpa_cv` rows whose `JobSource` matches `/referr/i`, handed to recruiters
to set by hand. An automatic backfill would guess, and a wrong referral flag tips a hiring decision.

**B12 — Windows / Prisma operational friction. 🟢**
`prisma:generate` fails with `EPERM` unless the dev server **and** the easily-missed queue worker are stopped.
Known; called out in §4.3 so it does not cost an hour again.

---

## 8. Open questions — answer before Phase 1

| # | Question | Why it blocks | Recommendation to propose |
|---|---|---|---|
| Q1 | Does the final decision-maker read the flag **in the ATS**, or on the **emailed final-round scorecard**? | Decides whether referral status goes onto an unauthenticated page at all (§5, B3). | Both; chip-only on the card, behind a config flag. |
| Q2 | Chhaya is the recruiter *and* conducts the HR round. Does the **HR-round scorecard card** show the flag? | `recipient_role='hr'` is a public link and is not always the owning recruiter. | **No** — she sees it in the app. Keeps the rule "only the CEO card, ever". |
| Q3 | "The recruiter" = the **owning** recruiter, or **any** recruiter/admin? | B2. Narrower needs a new module permission. | Any internal staff member; the excluded party is the interviewer. |
| Q4 | Is a referral a fact about the **person** or about **this application**? | B8, and it decides `rpa_cv` vs `rpa_shortlisted_candidates`. | Per application, shown wherever that person appears. |
| Q5 | Should the flag appear in the **recruiter's CSV exports**? | A CSV is forwardable (§5 Tier C). | Yes for the pipeline CSV; never for the dossier. |
| Q6 | Should the recruiter be **warned** before downloading a dossier for a referral candidate? | Cheap belt-and-braces on the highest-risk artefact. | Yes — one line in `DossierDownloadModal`. |

---

## 9. Sequencing and effort

### 9.1 Where this sits

Both documents agree, and neither puts it first:

- *Start Work Priority Plan* §3 — **"Next – P1: Referral Candidate flag + permissions"**, after the P0 block
  (real-hiring validation, core fixes, candidate download, recordings, assessment upload).
- *Priority Matrix* — `P1 | Referral visibility | Next | Controlled disclosure`.
- *Step-by-step sequence* §5 — **step 8 of 16**, after the three P0 enhancements.
- *Change Requirements* §21 — **Step 6**, after candidate export, assessment upload and recordings.

### 9.2 Effort

| Phase | Work | Est. |
|---|---|---|
| 0 | Decisions (§8) — not developer time | 0.5 d |
| 1 | 🔴 `serializeCard()` prerequisite (§3) | 0.25 d |
| 2 | DDL + `prisma:pull` | 0.25 d |
| 3 | Write path — modal, service, undo-reject, drawer edit | 1.5 d |
| 4 | Recruiter read surfaces | 1.0 d |
| 5 | Suppression — the 9-surface checklist | 1.5 d |
| 6 | Tests + leak scan | 1.0 d |
| 7 | Docs + rollout note | 0.5 d |
| | **Total developer time** | **≈ 6 days** |

### 9.3 Recommended order

1. **Phase 1 alone, merged separately** — it stands on its own and removes `teams_passcode` and
   `recruiter_notes` from an unauthenticated payload today.
2. **Land the in-flight dossier / recording-share work** (barrier B9).
3. Then Phases 2–7, which are additive on a settled base.

---

## 10. Definition of done

- [ ] A recruiter can mark a candidate as a referral at shortlist time and record who referred them (R1, R2).
- [ ] A recruiter can set or clear the flag later from the drawer, and the change is on the timeline.
- [ ] The flag survives a reject → re-shortlist cycle (or does not, by explicit documented decision) (B7).
- [ ] The flag is visible on the board card, the board filter and the drawer header (R3).
- [ ] The final decision-maker sees it at the final round, by whichever route Q1 settles (R4).
- [ ] `JSON.stringify()` of `GET /api/scorecard/:token` matches no `/referr/i` for `recipient_role` of
      `interviewer` or `hr` — asserted in an integration test, on the **whole response body** (R5).
- [ ] No interviewer email, no scorecard invite and **no Teams calendar event** carries it (R5, B5).
- [ ] `assertNoForbiddenFields()` throws on any dossier model carrying a referral key; `dossier:leakscan`
      passes with `--referrer` on a real pack (R6).
- [ ] The 9-surface checklist (§6 Phase 5) has been walked by hand and signed off.
- [ ] `npm run test:unit` passes.

---

## 11. Related documents

- [CANDIDATE-COMPLETE-DOWNLOAD-PLAN.md](phase3/CANDIDATE-COMPLETE-DOWNLOAD-PLAN.md) — §8.2 reserves the row
  this feature fills; the redaction model to extend.
- [INTERVIEWER-SCORECARD-PLAN.md](phase3/INTERVIEWER-SCORECARD-PLAN.md) — the public-link mechanism.
- [ROLE_RULES.md](reference/ROLE_RULES.md) — the four roles, and why none of them is "interviewer".
- [ADMIN_ACCESS_CONTROL.md](reference/ADMIN_ACCESS_CONTROL.md) — module permissions, if Q3 forces a new key.
- [`dossierRedaction.js`](../backend/src/utils/dossierRedaction.js) — the whitelist-plus-assertion pattern
  this feature should copy rather than reinvent.
