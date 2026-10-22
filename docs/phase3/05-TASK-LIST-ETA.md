# Phase 3 — Task List & ETA (for PM approval)

**Document 5** · Prepared 2026-07-14 · Companion docs: [01-PROCESS-UNDERSTANDING.md](01-PROCESS-UNDERSTANDING.md) · [02-BUSINESS-DESIGN.md](02-BUSINESS-DESIGN.md) · [03-DEVELOPMENT-PLAN.md](03-DEVELOPMENT-PLAN.md) · [04-QUESTIONS.md](04-QUESTIONS.md) · [07-EVALGROUND-IMPORT-PLAN.md](07-EVALGROUND-IMPORT-PLAN.md)

## Assumptions (change these and every date below shifts)
- **Team:** 2 developers on Phase 3 build work.
- **Start:** 2026-07-15 (tomorrow), 5-day work week, dates counted in business days.
- **M1 build starts immediately** even though the formal written sign-off is still outstanding — all of M1's policy inputs are answered (see [03-DEVELOPMENT-PLAN.md](03-DEVELOPMENT-PLAN.md) §0), so only the go-ahead itself is missing. **Risk, not a hard block** — flagged below.
- Modules run **one at a time until M1 ships**, then M2/M3/M4 fan out in parallel per the dependency graph in 03-DEVELOPMENT-PLAN.md §0; M5 slots in after M2/M4 free a developer; M6 is a final pass across everything.
- Excludes the Zeko auto-advance/report/recording sub-scope of M3 (**M3b**) — it can't be estimated until the R&D spike below reports back.

---

## Track A — R&D / Unblocking work (runs in parallel with Track B)

| # | Task | Owner | ETA | Blocks |
|---|------|-------|-----|--------|
| A1 | 🚨 **Zeko API capability validation spike** — confirm whether the API actually returns score, cheat probability, full report, recording | Dev (pull from Track B for ~3 days) | **2026-07-15 → 2026-07-17** | M3b scope entirely; today this is the single biggest schedule risk in Phase 3 and was unassigned |
| A2 | ~~Verify received Evalground sample CSVs (bulk + single-result) against the Section 1/2/3 design~~ ✅ **Done 2026-07-20** — see [07-EVALGROUND-IMPORT-PLAN.md](07-EVALGROUND-IMPORT-PLAN.md) §1 | Harish | ~~2026-07-15~~ **Done 2026-07-20** | M2 build start |
| A3 | ~~Decide bulk-CSV section→skill mapping approach~~ ✅ **Done 2026-07-20** — AI-suggested from test title, RT confirms once per batch; see doc 07 §2 | Harish + Dev | ~~2026-07-16~~ **Done 2026-07-20** | M2 bulk importer UI |
| A4 | Request Graph `Calendars.ReadWrite` (App) + `Schedule.Read.All`/`Calendars.Read` from IT | Harish | Request sent **2026-07-15**; target grant by **2026-07-22** | M3a build start |
| A5 | Send M1 **written** sign-off request to RT (consolidated summary email) | Harish | Sent **2026-07-15**; target RT reply by **2026-07-20** | Formal M1 go-ahead (build proceeds in parallel, at risk — see assumptions) |
| A6 | Server/storage capacity check with Pankaj + IT | Harish | **2026-07-15 → 2026-07-17** | M4 upload scope (may force resumes-only fallback) |
| A7 | MS Access schema-mismatch feasibility assessment | Dev | **2026-07-27 → 2026-07-29** (fits in M1 tail) | M6 MS Access export/import design |
| A8 | *(tracking only)* WhatsApp requirements doc — tool, plan, cost, templates, volume | **RT owns this**, not us | No ETA — external | Our `whatsapp-integration-plan.md` |

---

## Track B — Development (2 devs)

| Module | Scope | ETA | Assignment | Notes |
|---|---|---|---|---|
| M0 | Phase 2.1 (Zeko + email engine) go-live | ✅ **Done** — live since 2026-07-14 | — | — |
| **M1** | Stage engine + Pipeline Tracker UI + outcome emails (vendor dual-send) | **2026-07-15 → 2026-07-30** (12 bd, ~2.5 wk) | Both devs (schema/backend + Tracker UI in parallel) | Largest module: 5 new tables, admin config CRUD, kanban + drawer, dispatcher. Written sign-off (A5) should land inside this window — chase it if not |
| **M2** | Evalground import — bulk CSV + single-result (automatic shared-mailbox polling, not manual upload) | **2026-07-31 → 2026-08-06** (5 bd) | Dev B | A2/A3 ✅ **closed 2026-07-20** — build plan in [07-EVALGROUND-IMPORT-PLAN.md](07-EVALGROUND-IMPORT-PLAN.md); single-result mechanism now rides the existing `mailboxPoller.js` fan-out (new `assessmentResultIntake.js` processor) instead of a manual entry screen |
| **M3a** | Teams/Outlook scheduling + reminders + interviewer scorecards (2 card layouts) | **2026-07-31 → 2026-08-13** (10 bd) | Dev A | Needs Graph grant (A4) landed by start date — slips 1:1 if IT is late |
| **M4** | Document collection (request → upload → verify) | **2026-08-07 → 2026-08-14** (6 bd) | Dev B (after M2) | Scope may shrink to resumes-only pending A6 capacity answer — don't over-build the multi-doc UI until then |
| **M5** | Offer management + closure (record-only) | **2026-08-17 → 2026-08-19** (3 bd) | Dev B (after M4) | Smallest module, fully unblocked, no external dependency |
| **M6** | Vendor completion + hardening (isolation audit, MS Access CSV export interim win, whole-DB skill-search verification) | **2026-08-20 → 2026-08-27** (6 bd) | Both devs | Final pass across M1–M5 |
| M3b | Zeko auto-advance / full report / recording in Tracker | **Not scheduled** — estimate 5–7 bd once A1 clears | TBD | If A1 finishes by ~2026-07-20 this can slot into the M3a window; otherwise treat as a Phase 3.1 follow-on |

**Core Phase 3 (M1–M6, excluding M3b): 2026-07-15 → 2026-08-27 (~6.5 weeks) with 2 developers.**

---

## Top risks to flag to the PM
1. **Zeko API validation (A1)** — unassigned until this list; if the API doesn't expose what M3b assumes, that scope shrinks to manual score entry and the estimate above is moot.
2. **M1 written sign-off (A5)** — dev proceeds on the assumption it lands during the M1 window; if RT stays silent past 2026-07-20, escalate before M1 ships un-approved.
3. **IT Graph grant (A4)** — hard gate on M3a's start date; a slow grant pushes the whole M3a/M4 fan-out out 1:1.
4. **Storage capacity (A6)** — could descope M4 to resumes-only; better to know before M4 starts (2026-08-07) than mid-build.
