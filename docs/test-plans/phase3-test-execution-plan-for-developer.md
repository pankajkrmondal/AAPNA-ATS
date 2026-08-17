# Phase 3 — Test Execution Plan (for the developer running the pass)

**Purpose:** a runnable playbook for executing the two Phase 3 test-plan documents, not another
description of what they contain. Read this first if you're the one sitting at staging with the
test cases open, deciding what to seed, what order to run things in, and how to avoid burning a day
on cron timers.

**The two documents you're executing:**
1. [`phase3-completed-items-test-plan.md`](phase3-completed-items-test-plan.md) — Outlook,
   Communication Tracking, Zeko/M2 (19 tracker items, OUT/CCT/ZEK test IDs)
2. [`phase3-m1-m3a-m4-m5-m6-test-plan.md`](phase3-m1-m3a-m4-m5-m6-test-plan.md) — Pipeline,
   Scheduling, Documents, Offer, Vendor (~90 test IDs: PIPE/SCHED/DOC/OFFER/VEND/E2E/N)

Both assume staging (`recruitmentautomationdb`) and the non-production email redirect. Neither
assumes you've read the module status or coverage audit docs first — this playbook doesn't either;
it's self-contained for execution.

---

## 1. Before you start — one-time setup (≈30 min)

### 1.1 Start both services

```bash
# backend/
npm run dev:staging      # Express :5000, loads .env.staging then .env

# frontend/
npm run dev               # Vite :5173
```

Confirm both are up and the backend log shows no startup errors (bad Graph/Zeko credentials fail
loudly at boot for some services — read the first 20 lines of log before doing anything else).

### 1.2 Tighten every cron/timer up front, not per-test

Running cron jobs on their production cadence (hourly, daily) during a test pass means either
waiting hours between test cases or missing windows. Set these **once**, at the start, in
`.env.staging` or directly in `rpa_settings`, and revert them when you're done — don't tighten them
test-by-test.

| Setting | Production default | Test value | Where |
|---|---|---|---|
| `INBOUND_SYNC_CRON` | `*/5 * * * *` | `* * * * *` | `.env.staging` |
| `EMAIL_INTAKE_CRON` | `*/5 * * * *` | `* * * * *` | `.env.staging` |
| `ZEKO_JOBS_CRON` | `0 * * * *` | `*/2 * * * *` | `.env.staging` |
| `ZEKO_RESULTS_CRON` | `30 * * * *` | `*/2 * * * *` | `.env.staging` |
| `interview_occurrence_interval_min` | 30 | 1 | `rpa_settings` (SQL) |
| `interview_occurrence_grace_min` | 15 | 1 | `rpa_settings` (SQL) |
| `interview_occurrence_enabled` | varies | `true` | `rpa_settings` (SQL) |
| `DOCUMENT_REMINDER_CRON` | `0 9 * * *` | `*/5 * * * *` | `.env.staging` |
| `DOCUMENT_REMINDER_AFTER_DAYS` | 2 | 0 (or backdate `requested_at` in SQL instead of changing this) | `.env.staging` |
| `OFFER_SWEEP_CRON` | `0 7 * * *` | `*/5 * * * *` | `.env.staging` |

```sql
UPDATE rpa_settings SET value = '1' WHERE key = 'interview_occurrence_interval_min';
UPDATE rpa_settings SET value = '1' WHERE key = 'interview_occurrence_grace_min';
UPDATE rpa_settings SET value = 'true' WHERE key = 'interview_occurrence_enabled';
```

Restart the backend after editing `.env.staging` values (cron env vars are read at boot).

**Revert checklist before you finish:** put every value above back, restart the backend once more,
and confirm `rpa_settings` reads match production defaults again. A tightened cron left running
into the next business day will spam the test inbox and skew any real usage metrics on staging.

### 1.3 Seed test data (do this before writing any test results, not mid-run)

Create these once, up front, and reuse them across both documents — recreating candidates per test
case is the single biggest time sink in a pass like this.

| # | What | How | Used by |
|---|---|---|---|
| 1 | 3 test candidates in `rpa_cv`, mailboxes you control (Gmail/Outlook, **not** `@aapnainfotech.com`/`@aapna.com` — inbound sync skips those as loopbacks) | Manual insert or upload via the normal candidate intake path | Both documents, most test IDs |
| 2 | 1 of those 3 candidates run through `POST /api/vendor/upload` for real, with `VendorEmail` + `lockForNinetyDays` inside the 90-day window | Actual vendor upload API call — **do not** hand-set `rpa_candidate_pipeline.source='vendor'` in SQL, that bypasses the exact write path M6 fixed | VEND-*, DOC-12, OFFER-06 |
| 3 | 1 test MRF, `number_of_positions=1` | Normal MRF creation UI/API | OFFER-08 |
| 4 | 1 test MRF, `number_of_positions=2` | Same | OFFER-09 |
| 5 | 1 published Zeko job synced into `rpa_zeko_jobs` with non-null `primary_interview_id` | Wait for ZEK-04's tightened sync, or confirm one already exists | ZEK-05 onward |
| 6 | User accounts at `admin`/`superadmin`, `recruiter`, `vendor` roles | Admin Portal or DB | PIPE-08, VEND-11/12/13 |
| 7 | ≥1 active row in `rpa_document_checklist_items` | Confirm exists — likely already seeded; if not, create via Settings/config | DOC-01 |

Record the candidate IDs, MRF IDs, and account credentials somewhere you'll actually look at them
again (a scratch note, not memory) — you'll reference them across ~40 test cases.

### 1.4 Know where "outbound" actually lands

Every candidate/panel/vendor email in non-production goes to the internal test inbox
(`EMAIL_STAGING_RECIPIENTS`), never the real address. Open that inbox now and keep it open in a
tab for the whole pass — most test cases end in "check the test inbox," and re-discovering where
that is mid-test wastes time.

---

## 2. Suggested run order and time-boxing

Don't run the ~110 combined test IDs in document order — some depend on state that others create,
and some need a cron tick you'd otherwise wait on idly. Suggested grouping, roughly a half-day
block each:

### Block A — Foundations (no waiting, pure API/DB checks)
PIPE-01 through PIPE-16, N1–N5. This is the stage engine — everything else in the plan runs
*through* a pipeline journey, so get this block clean first. If PIPE-03 (concurrent race) or
PIPE-05 (double-close race) fail, stop and investigate before continuing — every later block
assumes the claim-then-act guards hold.

### Block B — Scheduling and scorecards (has real waiting: Graph calendar, occurrence sweep)
SCHED-01 through SCHED-19. Run SCHED-01/02 (auto-invite vs. client round) back to back so the
contrast is fresh. SCHED-11 (occurrence sweep) is the one case that benefits from the tightened
cron in §1.2 — without it, this is a 15–30 min wait per attempt.

### Block C — Documents (mostly fast, one cron-dependent case)
DOC-01 through DOC-13. DOC-11 (reminder sweep selection) is the cron-dependent one — line it up
after you've tightened `DOCUMENT_REMINDER_CRON` in §1.2, and prep all four states (fresh/stale/
recently-reminded/at-max) in one sitting so a single sweep tick validates all of them at once
rather than four separate waits.

### Block D — Offer + MRF closure (depends on Block A candidates reaching Offer)
OFFER-01 through OFFER-16. OFFER-10 (concurrent acceptance race) and OFFER-15 (90-day auto-close —
backdate `joining_date` in SQL rather than waiting 90 real days) are the two to plan carefully;
everything else is straightforward CRUD-shaped testing.

### Block E — Vendor (the highest-priority block — see §3)
VEND-01 through VEND-16. Needs the vendor-sourced candidate from §1.3.2. **VEND-01 first**, before
anything else in this block — it's the regression check for the headline M6 defect (dual-send
"never fired once" until M6 built it), and if it fails, several other VEND cases are moot until
it's fixed.

### Block F — Cross-module E2E passes
E2E-01 through E2E-05. Run these last, once every module has passed its own block — an E2E failure
at this point tells you *which* module regressed, since you've already isolated each piece.

### Block G — Companion document (Outlook / Communication / Zeko)
The existing `phase3-completed-items-test-plan.md`. Independent of Blocks A–F — can run in
parallel on a second staging session if two people are available, or last if one person is running
everything.

---

## 3. If you only have time for a partial pass

Priority order, most important first:

1. **VEND-01** — confirms the M6 headline fix (vendor dual-notification) actually fires in a real
   send, not just in the unit test. This was silently dead in production/staging for the entire
   life of M1–M5.
2. **PIPE-03, PIPE-05, SCHED-13** — the three claim-then-act concurrency guards. All three were
   real bugs found by *running* the code, not reading it (code review §2.1). Re-running them is
   the cheapest way to catch a regression before it repeats.
3. **OFFER-08 through OFFER-12** — MRF auto-close/reopen math. Wrong here means a filled
   requisition stays open (double-hiring risk) or a legitimately open one looks closed (a real
   candidate gets silently blocked).
4. **DOC-12 / VEND-02** — vendor silence on Documents. A regression here is a privacy leak, not
   just a bug.
5. Everything else in Block A (PIPE-*), since the rest of the suite runs through it.

---

## 4. Recording results

Use the sign-off checklist at the bottom of the M1–M6 plan (§10) and the traceability matrix at
its §5 in the companion plan as your two source-of-truth checklists. For each test ID, record:

- Pass / Fail / Blocked (and why, if blocked — e.g. "no Zeko job with a live interview available")
- Actual observed behavior when it differs from Expected — quote it, don't paraphrase, especially
  for exact error message text (several test cases assert the literal string)
- Any defect found gets a short note and should be cross-checked against the 3 material + 6 minor
  **open** findings already listed in
  [`PHASE3-CODE-REVIEW-2026-08-06.md`](../phase3/PHASE3-CODE-REVIEW-2026-08-06.md) §3 — say
  explicitly whether it's a new defect or a recurrence of a known one.

Don't fix defects inline while running the pass unless they block continuing (e.g. a 500 that
prevents reaching later test states). Finish the block, log the defect, keep moving — mixing
fixing and testing in one pass is how the code review's own "three bugs reading missed" pattern
repeats itself in reverse (a fix applied mid-test can mask what the next test case was actually
supposed to catch).

---

## 5. After the pass

1. Revert every cron/timer value from §1.2.
2. Clean up test data created this session **only** — do not touch pre-existing staging data.
   Candidates created for this pass, test MRFs, and any test document uploads in OneDrive
   (`Document Collection/{candidate}/`) should be removed or clearly marked so they don't pollute
   staging metrics or a later demo.
3. Update the sign-off checklists in both test-plan documents with actual results, not just
   checkmarks — the checklist items are meant to be evidence, not a formality.
4. Feed any new defects back into a changelog entry or issue, referencing the test ID that found
   them (e.g. "VEND-01 found X" is more useful downstream than "found a bug in vendor notifications").
