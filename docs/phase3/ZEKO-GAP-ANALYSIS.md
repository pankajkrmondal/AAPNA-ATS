# ZEKO — Phase 3 Gap Analysis (Implemented vs. Not Implemented)

**Prepared:** 2026-07-21 · **Scope:** ZEKO-specific only — not a full Phase 3 audit.
**Method:** Cross-referenced the Phase 3 planning docs against the actual codebase (`backend/src/services/zeko.service.js`, `backend/src/jobs/zekoScheduler.js`, `backend/src/services/screening.service.js`, `backend/prisma/schema.prisma`, frontend Zeko surfaces) and the current `Excel/staging-DB-21072026.sql` dump. No code was changed to produce this document.

**Sources consulted:**
- [01-PROCESS-UNDERSTANDING.md](01-PROCESS-UNDERSTANDING.md) · [02-BUSINESS-DESIGN.md](02-BUSINESS-DESIGN.md) · [03-DEVELOPMENT-PLAN.md](03-DEVELOPMENT-PLAN.md) · [04-QUESTIONS.md](04-QUESTIONS.md) · [05-TASK-LIST-ETA.md](05-TASK-LIST-ETA.md) · [07-EVALGROUND-IMPORT-PLAN.md](07-EVALGROUND-IMPORT-PLAN.md) · [MEETING-NOTES-2026-07-14.md](MEETING-NOTES-2026-07-14.md) · [RT-CALL-SUMMARY-2026-07-14.md](RT-CALL-SUMMARY-2026-07-14.md) · [RT-FOLLOWUP-QUESTIONS.md](RT-FOLLOWUP-QUESTIONS.md)
- `Excel/Phase 2 Task Items.xlsx` — sheets **"Phase 2 Task Items"** (cols A/B, rows 1–37) and **"Phase 3 Plan V3"** (174 rows)
- `Excel/staging-DB-21072026.sql` (current staging DB dump, shared 2026-07-21)

---

## ✅ Already Implemented

| Capability | Evidence | Notes |
|---|---|---|
| Zeko OTP-login → dashboard cookie auth | `zeko.service.js` → `refreshZekoCookie()` | Polls the shared mailbox for the OTP via `outlookReader.service.js`; stores in `rpa_zeko_auth_cookie` |
| Zeko API-key → bearer token auth | `zeko.service.js` → `ensureZekoToken()` | Stored in `rpa_zeko_auth_token`, auto-refreshed |
| Job/role catalog sync | `zeko.service.js` → `syncZekoJobs()` | Hourly cron via `zekoScheduler.js`; upserts into `rpa_zeko_jobs` |
| Interview-results auto-fetch | `zeko.service.js` → `fetchInterviewResults()` | Hourly cron; reads `overallScore`/`technicalScore`/`communicationScore`/`reportLink` for interviews past their window |
| Candidate → Zeko job assignment | `screening.service.js` → `assignCandidateToZekoJob()` | Upserts `rpa_zeko_candidate_pipeline` |
| Interview scheduling + invite email | `screening.service.js` → `scheduleInterview()` (~line 1979) | Calls Zeko's schedule API, sends "Zeko Interview Scheduled Invitation" template |
| Interview cancellation + notice email | `screening.service.js` (~line 2155+) | Calls Zeko's cancel API, sends "Zeko Interview Cancelled Alert" template |
| Score write-back to candidate record | `rpa_cv.ZekoInterviewScore`, `ZekoCodingScore`, `ZekoCommunicationScore` | Confirmed in `schema.prisma` (lines 118–120, 392–394) and mirrored in `staging-DB-21072026.sql` |
| Zeko pipeline/scores visible in UI | `CandidatePipelinePrototype.jsx`, `CandidateScreening.jsx`, `Candidates.jsx`, `CandidateDetailCard.jsx`, `AnalyticsLegacy.jsx` | Job list, pipeline table, schedule/cancel actions, editable score fields |
| Live DB tables | `rpa_zeko_auth_cookie`, `rpa_zeko_auth_token`, `rpa_zeko_candidate_pipeline`, `rpa_zeko_interview_results`, `rpa_zeko_jobs`, `rpa_zeko_sync_log` | All present in both `schema.prisma` and the staging SQL dump |
| Zeko HR Screening & Functional Screening stages (core flow) | Per [01-PROCESS-UNDERSTANDING.md](01-PROCESS-UNDERSTANDING.md) §2 | Confirmed **live** as of Phase 2.1 go-live (2026-07-14) |

---

## ❌ Not Implemented / Gaps

| Requirement | Doc / Question ref | Current state | Blocked by |
|---|---|---|---|
| Rename `ZekoCommunicationScore` → coding score (Zeko dropped communication score) | Meeting notes 2026-07-14, action item #11 | Not done — see ⚠️ below, this is more than a simple rename | Not started; no ticket owner identified in docs |
| Cheat-probability field ingestion | Q4/B2, 02-BUSINESS-DESIGN §3 (Stages 1&3), 03-DEVELOPMENT-PLAN M3 | `fetchInterviewResults()` reads only `overallScore`, `technicalScore`, `communicationScore`, `reportLink` — no cheat-probability field read, stored, or surfaced anywhere | **A1 — Zeko API capability validation** (unassigned) |
| Auto-advance / auto-reject rule on Zeko outcome | Q4/B2 (contradiction: per-role bands vs. flat 50%+cheat gate), M3 | 100% manual today — HR reads score, decides outcome by hand | RT written confirmation of which rule is authoritative + **A1** |
| Full Zeko test report + recording accessible in-app | 02-BUSINESS-DESIGN §3, M3 | Only `reportLink` is stored (a raw URL); no in-app report viewer, no recording field/link at all | **A1** |
| Pipeline Tracker (Module 1) real backend | 03-DEVELOPMENT-PLAN M1 | `CandidatePipelinePrototype.jsx` is 100% mock state per its own header comment — no API calls, nothing persisted, no real emails. None of `rpa_pipeline_stages`, `rpa_stage_outcomes`, `rpa_stage_email_templates`, `rpa_candidate_pipeline`, `rpa_pipeline_stage_events`, `rpa_outcome_reasons` exist in schema or DB dump; no `pipeline.service.js`/`.controller.js`/`.routes.js`; no `recruitment_pipeline` module key in `roles.js` | Formal written sign-off still owed (§E in 04-QUESTIONS.md); build is scheduled but not started |
| Zeko outcomes wired into a unified stage-outcome email dispatcher | 03-DEVELOPMENT-PLAN M1 (`stageNotification.service.js`) | Does not exist. Zeko's own invite/cancel emails work today, but the planned single dispatcher (stage×outcome template mapping + vendor cc) is not built | Depends on M1 backend above |
| Concurrent-MRF shared vs. per-journey Zeko testing | Q24 — explicitly still open | `rpa_zeko_candidate_pipeline` has no "journey"/MRF-scoped concept; a candidate on two MRFs would need duplicate handling that doesn't exist | **Open RT question, not addressed on the 2026-07-14 call** |
| Zeko API capability validation itself | Action item A1 (03-DEVELOPMENT-PLAN, 04-QUESTIONS, 05-TASK-LIST-ETA) | Still unassigned/not started. Independently confirmed in the **"Phase 3 Plan V3"** Excel sheet, row 3: *"Zeko API Validation (R&D)"* — Priority **High**, Status **Yet-to-start**, 14h estimate (24h "Opinion"), Remarks: *"Unassigned until now — single biggest schedule risk in Phase 3"* | No owner assigned |

---

## ⚠️ Partially Implemented / Ambiguous

**The coding-score field already exists — but not for the reason RT asked.**
The codebase has *always* had `ZekoCodingScore` as a field distinct from `ZekoCommunicationScore` (both present in `rpa_cv` today, both actively read/written across the service layer and three frontend pages). This predates the Phase 3 discussion. On the 2026-07-14 call, RT said Zeko has dropped its communication score entirely and asked that the old `ZekoCommunicationScore` field be renamed/repurposed into a coding score. Because a same-named "coding score" field already existed for unrelated reasons, this is easy to mistake for "already done" — it is not. `ZekoCommunicationScore` is still fully live everywhere (schema, service, UI), and nothing has been removed, renamed, or repurposed in response to RT's ask. This needs an explicit decision (and possibly a data-migration/deprecation step for `ZekoCommunicationScore`), not just a UI label change.

---

## Open Blockers From RT/IT Gating Further Zeko Work

1. **🚨 Zeko API capability validation (A1)** — unassigned in the docs; independently tracked as "Yet-to-start" / High priority / 14h estimate in the "Phase 3 Plan V3" sheet (row 3). Nothing about cheat probability, full report, or recording can be built until this is resolved.
2. **Q4/B2 contradiction** — written answer said per-role Zeko score bands; the 2026-07-14 call proposed a flat 50%-+-cheat-probability gate instead. These are different systems; RT has not confirmed in writing which one is real.
3. **Q24 — shared vs. per-journey testing** — unresolved; needed before concurrent-MRF candidates can be handled correctly for Zeko stages.
4. **Q16 — Microsoft Graph calendar permission grant** — not Zeko-specific, but gates Module 3 (Teams/Outlook scheduling), which is where any Zeko auto-advance/report UI would live per the development plan.

---

## ✅ Decisions Resolved (2026-07-21)

Steps 1, 2, 4, and 5 of the step-by-step plan below were resolved in this session:

**Step 1 — Zeko API capability validation (A1): CLOSED.**
Reviewed the official Zeko API docs (`https://zeko.gitbook.io/docs/`, including the full `llms-full.txt` reference). Findings:
- The documented `GET /api/v1/interview/{id}/results` response schema is: `message`, `success`, `data[]` → `interviewId`, `candidate.{name,email}`, `scores.{overallScore, technicalScore, communicationScore}`, `metaData.{Id,name,clientId}`, `reportLink`.
- **No cheat-probability, proctoring, integrity, or anomaly field exists anywhere in the documented API.**
- **No interview-recording URL/link field exists anywhere in the documented API.**
- `reportLink` is a URI to the Zeko **dashboard** for "detailed analysis and insights" — it is not an embeddable report object; the API gives only the link, not the report content.
- **Conclusion: the current `zeko.service.js` `fetchInterviewResults()` implementation already reads every field the Zeko API actually exposes** (`overallScore`, `technicalScore`, `communicationScore`, `reportLink`). There is nothing more to ingest from Zeko's side — the code was not under-implemented, the requirement itself was unbuildable as originally envisioned.
- **This resolves the 🚨 top schedule risk named throughout the Phase 3 docs.** The full-report/recording/cheat-probability ambition in `02-BUSINESS-DESIGN.md` §3 and `03-DEVELOPMENT-PLAN.md` M3 is **not buildable against the public Zeko API** as documented. If Zeko exposes these fields only through an undocumented/private API tier, that would need separate confirmation directly with Zeko's team — but nothing in the public docs supports it.

**Step 2 — Q4/B2 contradiction: RESOLVED.** RT/product owner confirmed the authoritative rule is the **flat 50% + cheat-probability gate** (score ≥50% and cheat probability Low → auto-advance; Moderate → recruiter approval required; High → auto-reject), **not** the earlier per-role score-bands answer. The per-role-bands design is superseded and should not be built.
- **Practical consequence of Step 1 + Step 2 together:** the confirmed rule requires a cheat-probability signal that the Zeko API does not provide. The auto-advance/auto-reject portion of this rule **cannot be built as specified** until either Zeko exposes that field or RT accepts a fallback (e.g., a score-only rule: ≥50% → auto-advance, <50% → recruiter decides, with no cheat-probability gate). This fallback needs RT sign-off before building anything — do not silently drop the cheat-probability clause and build a different rule without confirming.

**Step 4 — Q24 (concurrent-MRF shared vs. per-journey Zeko testing): RESOLVED.** Confirmed: a candidate active on two MRFs at once sits Zeko HR/Functional Screening **once per journey** (not shared). Each candidate-per-MRF pipeline row gets its own independent Zeko test assignment, invite, and result — no result-sharing/reuse logic needed across journeys.

**Step 5 — M1 written sign-off: "Go ahead" received (product owner, 2026-07-21).** Module 1 (Pipeline Tracker backend) build may proceed.

---

## 🔍 Follow-up finding: Zeko v2 API has a cheat-probability webhook (2026-07-21)

Re-checking Zeko's full documentation index (`llms.txt`) after the Step 1 conclusion above surfaced something the first pass missed: Zeko publishes a **separate "Zeko APIs v2" family**, distinct from the v1 API `zeko.service.js` currently integrates with. It includes:

- `v2/api-reference/webhooks/interview-completion.md` — webhook `candidateInterviewCompleted`
- `v2/api-reference/webhooks/cheating-probability.md` — webhook `cheatProbabilityMarked`

**This means cheat-probability data likely IS obtainable from Zeko — through an event-driven v2 webhook subscription, not the v1 polling endpoint the code uses today.** The exact payload schema for these two webhooks could not be retrieved from the public doc pages alone (GitBook only exposed the webhook names/methods, not the full OpenAPI body) — getting the real field shape requires either Zeko's v2 OpenAPI spec directly or v2 sandbox/API credentials.

**⚠️ Decision explicitly declined in this session:** it was proposed that this data could instead be obtained by logging into the Zeko dashboard (`https://app.zeko.ai/app/role`) with a live account + OTP, inspecting the browser Network tab for whichever *undocumented* internal endpoint renders cheat-probability in the UI, and then calling that endpoint directly using the auth cookie already stored in `rpa_zeko_auth_cookie`. **This was declined** — reverse-engineering a vendor's private, unpublished API surface for a sensitive candidate-scoring signal carries real ToS/support risk (the endpoint isn't a contracted interface and can change or break without notice) and is a vendor-relationship decision, not a coding decision, to make unilaterally. This is a distinct risk category from the *existing* `/dashboard/api/v2` cookie-based job-catalog sync already in `zeko.service.js` (an earlier, already-accepted business decision) — extending that same pattern specifically to pull sensitive per-candidate cheat-scoring data is new exposure, not a continuation of existing exposure.

**Revised recommendation for Step 1 / A1:** treat A1 as **narrowed, not closed** — the "does Zeko expose this at all" question is now answered ("yes, via v2 webhooks, probably"), but the remaining sub-task is obtaining official v2 API access and the webhook payload spec from Zeko's team (a vendor/business ask, likely Harish's action item), not further doc archaeology or dashboard scraping. Building the webhook receiver (`POST /api/webhooks/zeko/*`) should wait until that spec is confirmed, to avoid guessing field shapes for a decision (auto-reject on high cheat probability) that affects real candidates.

---

## Step-by-Step Plan — All Zeko-Related Work to Fully Satisfy RT Requirements

This sequence covers every open Zeko item above, ordered so nothing waits unnecessarily on **A1 (Zeko API capability validation)**. Steps 1–6 can all start immediately/in parallel; only Step 8 is genuinely gated on Zeko's API being validated.

| Step | Task | Depends on | Can start now? |
|---|---|---|---|
| 1 | **Assign & run the Zeko API validation spike (A1)** — confirm whether Zeko's API actually exposes cheat probability, full test report, and interview recording links | — | ✅ Yes |
| 2 | **Resolve the Q4/B2 contradiction with RT, in writing** — per-role score bands vs. flat 50%+cheat-probability gate; only one can be built | — | ✅ Yes (parallel with Step 1) |
| 3 | **Decide the `ZekoCommunicationScore` fate** — deprecate, hide, or repurpose it now that Zeko has dropped its own communication score; reconcile against the already-existing (but unrelated) `ZekoCodingScore` field; update `schema.prisma` + `Candidates.jsx` / `CandidateDetailCard.jsx` / `AnalyticsLegacy.jsx` | — | ✅ Yes |
| 4 | **Resolve Q24 with RT** — does a candidate active on two MRFs sit Zeko HR/Functional once (shared result) or once per journey? | — | ✅ Yes (parallel with Step 2) |
| 5 | **Chase the M1 written sign-off from RT** — all of Module 1's policy inputs are already answered; only the formal go-ahead is missing (§E above / `04-QUESTIONS.md` §E) | — | ✅ Yes |
| 6 | **Build Module 1 (Pipeline Tracker backend), treating Zeko as a plain stage** — `rpa_pipeline_stages`, `rpa_stage_outcomes`, `rpa_stage_email_templates`, `rpa_candidate_pipeline`, `rpa_pipeline_stage_events`, `rpa_outcome_reasons`; `pipeline.service.js`/`.controller.js`/`.routes.js`; the `recruitment_pipeline` module key; `stageNotification.service.js`. Zeko HR/Functional Screening plug in as `stage_type = 'zeko'` using only what's live today (score + manual pass/fail + existing invite/cancel emails) — no cheat-probability or report data required. Replaces the mock `CandidatePipelinePrototype.jsx` with real `Pipeline.jsx` + `PipelineDrawer.jsx` | Step 5 (sign-off) | After Step 5 |
| 7 | **Apply Step 4's answer inside the M1 pipeline engine** — implement whichever rule Q24 settles on (shared vs. duplicate test/invite per journey) | Steps 4 & 6 | After Steps 4 & 6 |
| 8 | **Get Zeko v2 API access + `cheatProbabilityMarked`/`candidateInterviewCompleted` webhook spec from Zeko's team** — official channel (not dashboard scraping); a vendor/business ask, not a coding task | — | ✅ Yes (business action, can start now) |
| 9 | **Build the v2 webhook receiver + auto-advance / report-recording feature (M3b)** — `POST /api/webhooks/zeko/*` endpoints, store cheat-probability + report data, implement the confirmed rule (score ≥50% + cheat probability Low/Moderate/High) | Step 8 (real payload spec) | Only after Step 8 |

**In short:** if the Zeko v2 webhook work stays neglected, Steps 1–7 are still fully actionable and get the Pipeline Tracker, the coding-score cleanup, and the concurrent-MRF policy fully RT-compliant. Only Steps 8–9 — the "smart" Zeko behavior (auto-advance, cheat-probability gating, in-app report/recording) — have to wait on Zeko's team providing real v2 credentials/spec, and should be explicitly scoped as a follow-on (matching the **M3b** carve-out already anticipated in `05-TASK-LIST-ETA.md`) rather than silently blocking everything else.

---

## Recommendation

Do not invest engineering time in Zeko auto-advance logic, cheat-probability handling, or in-app report/recording display until **Zeko's v2 API access + webhook payload spec** is obtained through their official channel — every gap in that area depends directly on knowing the real `cheatProbabilityMarked` payload shape. The cheapest next step is having Harish (or whoever owns the Zeko commercial relationship) request v2 API/webhook documentation and credentials directly from Zeko's team. Meanwhile, proceed with Module 1 (Pipeline Tracker backend) now — it is fully unblocked and does not depend on any Zeko v1/v2 capability beyond what's already integrated.
