# Phase 3 — Coverage Audit

**Date:** 2026-07-31 · **Method:** every row of the Phase 3 task tracker checked against
the actual code and the live staging database, not against the planning docs.

**Scope note:** Vendor completion / hardening (M6) is deliberately excluded — RT is
picking that up separately.

> **Superseded in part, 2026-08-12.** M6 has since been built and audited — see
> [`CHANGES-phase3-m6-vendor.md`](../changelog/CHANGES-phase3-m6-vendor.md).
> Excluding it here turned out to be costly: M6 was the only module never checked
> against the code, and the check found that **the vendor dual-notification had
> never fired once**. §2.4 below records the "vendor dual-send unit test" as
> merely un-run; in fact the feature it would have tested was dead — gated on
> `pipeline.source === 'vendor'`, a value nothing ever wrote. That single missing
> write also left the vendor-performance analytics table permanently empty.
>
> Three further items below are now out of date:
> - **"Admin config UI missing"** and **"`POST /templates` never added"** — both
>   landed after this audit was written. M6 added the two that were still
>   missing: stage→template mapping and the email flow keys.
> - **"Vendor status-only notification at Offer is not implemented"** — Q29 was
>   answered on 2026-08-12. Vendors now get a content-free milestone line at
>   Offer and nothing at Documents.

> **Why this exists:** the task tracker had drifted badly from reality. Most rows marked
> *Yet-to-start* are in fact complete, while a handful marked *In-progress* were never
> begun. This document is the corrected picture, so the tracker can be reconciled against
> something verified rather than remembered.

---

## 1. Summary by section

| Section | Rows | Done | Outstanding |
|---|---|---|---|
| Research (R&D) | 4 | 3 | 1 |
| DB — stage engine schema | 6 | 6 | 0 |
| Frontend — Pipeline Tracker UI | 10 | 10 | 0 |
| Backend — stage engine | 12 | 12 | 0 |
| Outcome email dispatcher | 5 | 4 | 1 |
| Bell notifications | 2 | 0 | 2 |
| M1 verification / testing | 8 | 2 | 6 |
| Evalground assessment import | 16 | 14 | 2 |
| Teams / Outlook scheduling | 20 | 15 | 5 |
| Document collection | 11 | 8 | 3 |
| Offer management & closure | 8 | 6 | 2 |
| **Total (excl. M6)** | **102** | **80** | **22** |

**DB, Frontend Tracker UI and Backend stage engine are complete** — including the six rows
the tracker still shows as *Yet-to-start*: concurrent-MRF journey support, both legacy
write-backs (`rpa_cv.FinalStatus`, `rpa_shortlisted_candidates.pipeline_status`), legacy
endpoint delegation, `pipeline.controller.js`/`routes.js` with admin config endpoints, and
`seed-pipeline-stages.js`.

Verified in the live database: **16 Phase 3 tables**, **12 stages**, **45 outcomes**,
**9 reason rows**.

---

## 2. What is genuinely outstanding

### 2.1 Blocking / highest risk

**Zeko API validation (R&D).** Unchanged as the top schedule risk. No cheat-probability,
auto-advance or report/recording code exists anywhere — correctly so, because nobody has
confirmed what the Zeko API actually returns. Everything in the M3b sub-scope stays
un-estimable until this lands.

### 2.2 Never built

| Item | Detail |
|---|---|
| **Bell notifications** (2 rows) | `pipeline:outcome` and `pipeline:awaiting_feedback` are never emitted. The bell only handles `review:new`, `assessment:import_done`, `assessment:deadline_expired`, and is in-memory only. |
| **Evalground single-result path** | `assessmentResultIntake.js` does not exist. Bulk CSV import is complete and working; the per-candidate Outlook result never auto-ingests. |
| **Free/busy display** (Q6) | No Graph `getSchedule` call anywhere. The schedule modal picks a time blind. |
| **Consolidated feedback + HR notify** | No consolidated feedback block is generated and nothing notifies HR when an interviewer submits a scorecard. |
| **Candidate self-scheduling** (Q6, 2nd increment) | No published-slots model, no slot-picker page, so no slot-conflict handling either. |
| **Document reminder automation** | Only a manual "Send reminder" button. No cron, despite "reminders until submitted". |
| **Archive-to-SharePoint job** | Not built — *correctly*: no retention threshold has been agreed. No hard-delete job exists anywhere either, per RT's "never delete". |
| **Recipient-assembly unit test** | Only `emailHelpers.test.js` and `emailLayout.test.js` exist. |
| **`CHANGES-phase3-m1-pipeline.md`** | M1 is the only module without a changelog. |

### 2.3 Built but inert

**Closure emails never send.** The eight closure outcomes (`joined`, `backed_out`,
`did_not_join`, …) have no generic fallback — `GENERIC_FALLBACK_BY_OUTCOME` in
`stageNotification.service.js` covers only `approved`/`rejected`/`hold` — and
`rpa_stage_email_templates` holds **0 mapping rows**. So `resolveTemplate()` returns null
on every closure and the send is skipped.

Mapping the closure outcomes onto the approve/reject generics was rejected on purpose: it
would email *"Congratulations"* to a candidate who backed out. The UI text was corrected
instead (2026-07-30) so it no longer promises mail that cannot go. **Seeding real closure
templates is the actual fix.**

**Four templates unseeded:**

| Template | Module | Impact |
|---|---|---|
| `Recruitment Process & Interview Stages` | M1 | No fallback — this email simply never goes out |
| `Document Collection Request` | M4 | Code fallback added 2026-07-30, so mail still sends |
| `Document Collection Reminder` | M4 | Code fallback added, incl. the rejection variant naming the document and reason |
| `Offer Approval Reminder` | M5 | Inline fallback subject in `offerSweep.js`, so the nudge still fires |

**Admin config UI missing.** The API and the frontend client methods both exist
(`createStage`, `updateStage`, `createStageOutcome`, `updateStageOutcome`, `createReason`
in `frontend/src/services/pipeline.js`) but **no screen calls them**. Stages, outcomes and
reasons are only changeable via raw API or SQL — the opposite of RT's "without
development" ask.

**`POST /templates` never added.** `emailTemplate.routes.js` has only `PUT /templates/:id`.
Admins can edit templates but not create them, which is the other half of the same RT ask —
and the reason the closure/missing templates above cannot be self-served.

**Vendor status-only notification at Offer** is not implemented. Q29 (bare status line vs
nothing at the Offer and Document stages) has never been answered, so the safer default —
sending nothing — is what ships.

### 2.4 Verification passes not formally run

The M1 testing block (8 rows) has had its DDL and seeds applied and verified, but the six
functional passes — outcome-email round trip, vendor dual-send unit test, legacy
regression, concurrent-MRF + cooling-off scenario, Future Prospect scenario — have not been
executed as a formal suite. The same applies to the Evalground CSV matrix, the three Teams
round-trip checks, and the document/offer end-to-end passes.

---

## 3. Corrections to the tracker's assumptions

**Table names.** Tracker rows 66–67 expect `rpa_interview_schedules` and
`rpa_interview_feedback`. What shipped is **`rpa_interview_schedule`** (singular) plus
**`rpa_interview_scorecard`** and **`rpa_interview_scorecard_skill`** — normalised into
structured columns and a child skill table rather than one JSONB `ratings` blob, with a
separate `occurrence_status` column gating scorecard release. Functionally complete and
better than the original design; only the names differ.

**Graph access is further along than "in-progress".** `Calendars.ReadWrite` and
`OnlineMeetings.Read.All` are granted and working — calendar events and Teams meetings are
created today. Still outstanding is **`OnlineMeetingArtifact.Read.All`** plus the Teams
application access policy, and those are needed *only* by the automatic attendance sweep.
The human "Mark as Held / No-show" path works without them, so M3 is not blocked.

**Evalground readiness (rows 2–3) is closed,** not in-progress: the sample was verified and
the section→skill mapping approach decided (AI-suggested from the test-name text, confirmed
once per import batch).

---

## 4. Work completed since the tracker was written

| Date | Work |
|---|---|
| 2026-07-29 | Scheduling extended from 2 rounds to 6 (Tech 3, HR, CEO/Final, Client Interview) |
| 2026-07-29 | HR scorecard brought to full parity with the legacy *Interview Evaluation Format V2* workbook (~16 fields) |
| 2026-07-29 | Document Collection module built end to end (DDL, service, public upload page, drawer panel, OneDrive nesting under `Document Collection/<candidate>/`) |
| 2026-07-29 | Offer Management & Closure built (record-only `rpa_offers`, approval + soft gate, 90-day auto-close sweep, closure UI) |
| 2026-07-30 | Client Interview reverted to manual coordination per Q14 — no Teams meeting, no invite, no reminder |
| 2026-07-30 | MRF auto-closes once accepted hires reach `number_of_positions`; removes the role from JD filtering everywhere |
| 2026-07-30 | Non-prod recipient routing split: candidate protected, typed-in interviewer honoured; calendar-invite gap closed |
| 2026-07-30 | Audit fixes: HR scorecard VARCHAR truncation, OneDrive folder lookup past 200 items, rejection-email copy, MRF post-commit failure path, checklist ordering |

---

## 5. Recommended order

1. **Bell notifications** — the only M1 deliverable with nothing built; now scoped as a
   DB-backed notification centre. *(In progress.)*
2. **`POST /templates`, then seed the closure and missing templates** — the endpoint
   unblocks self-serving every template gap above, including closure emails.
3. **Admin config UI** — closes the "no development needed" ask.
4. **Evalground single-result intake** — the one import mechanism still manual.
5. **Free/busy + self-scheduling** — the remaining M3 increments.
6. **Zeko M3b** — only once the API validation reports back.
