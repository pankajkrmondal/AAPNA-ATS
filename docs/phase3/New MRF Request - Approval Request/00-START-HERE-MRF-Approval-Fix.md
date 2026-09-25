# START HERE: "New MRF Request - Approval Request" Fix

**This is the one document to follow.** It says what is wrong, what is needed to fix it, what is already done, and what to do next, step by step.
The technical detail for each step is in [MRF-Approval-Unified-Fix-Plan.md](MRF-Approval-Unified-Fix-Plan.md) (section numbers like "plan §5" point there).

Last updated: **25 Sep 2026, ~12:00 IST**, after Phases A and B were built **locally** and tested end-to-end with Playwright (localhost:5173 + local backend on the **staging DB**).

---

## Where we are, in one line

**Phases 0, A and B are done and tested locally. Phase C is mostly done** (C1–C3 need people or decisions). **Next: commit (A10), then Pankaj deploys everything to staging once (A11), then the staging checks (§5 "Staging test").** Production comes only after staging sign-off.

⚠️ **Never run the "undo" SQL in DB-CHANGE-LOG.md.** It is kept only as a record.

---

## 1. The problem, in short

When Abhijit clicks **Approve** in the MRF approval email, the page says *"Link inactive or invalid — already processed"*. This has been reported twice.

It is **not** a broken link. The MRF was **already decided** by someone else. There are two causes:

| # | Cause | Example from production |
|---|---|---|
| 1 | **One shared link for both approvers, nobody told.** Abhijit and Sanghamitra get the same link. The first click decides. The system does not record *who* clicked, does not tell the other approver, and (until 25 Sep) did not send Abhijit the "Approved" email. | MRF #9: approved 23 Sep 22:43 IST via the link; Abhijit clicked next morning and got the error. |
| 2 | **Reminder emails re-send the Approve button after the decision.** The daily reminder job (14:30 IST) re-sends the original approval email, with working-looking buttons, even when the MRF is already approved. | MRFs 6, 7, 8: Abhijit and Sanghamitra got 2 reminders each **after** approval. |

Plus smaller bugs: two people clicking at the same moment could both "win"; an unknown action was saved as "rejected"; the page showed a red error for a successful earlier decision; outcome, HR and alert emails were also wrongly "reminded". **Found during testing:** an approver with an old/expired ATS login in the same browser was bounced from the approval link to the login page (A13).

## 2. What is needed to fix it, and what it looks like now

| Need | Fixed in | Now (tested locally) |
|---|---|---|
| Stop harm right now in production | **Phase 0** | ✅ Done in production 25 Sep |
| Never remind about a decided MRF; never remind outcome/alert emails | **Phase A** | ✅ Decided MRFs get no reminder; row is closed |
| Friendly page instead of a red error | **A + B** | ✅ "Already approved by Staging Approver B · 25 Sep 2026, 11:39 AM IST · comment" |
| Only one decision can ever be saved; bad actions rejected | **Phase A** | ✅ 10 simultaneous clicks → exactly 1 wins |
| **Proof**: who approved/declined, when, IP, device, comment | **Phase B** | ✅ Stored per decision, in a table nobody can edit or delete |
| **Tell the other approver**; confirm to the approver; HR email names the approver | **Phase B** | ✅ All three emails sent automatically |
| Approval trail screen, report, IP masked after 12 months | **Phase B** | ✅ Trail in the MRF window, admin CSV, nightly masking job |
| Clean-up | **Phase C** | 🟡 Code items done; n8n + 2 decisions pending |

**Rules we follow** (decided 24–25 Sep):
- Only **one** approval is needed (D1).
- IP/device kept 12 months, then masked (D2).
- No Microsoft sign-in for now (D3).
- **All code and DB changes go to staging first.** Finish Phases A, B and C, test on staging, then **one** production release (D4). Phase 0 is the only production-only exception.

## 3. Documents in this folder

| Document | Use |
|---|---|
| **00-START-HERE-MRF-Approval-Fix.md** (this file) | **Follow this.** Status and next steps. |
| [MRF-Approval-Unified-Fix-Plan.md](MRF-Approval-Unified-Fix-Plan.md) | Technical detail for each step. |
| [DB-CHANGE-LOG.md](DB-CHANGE-LOG.md) | Record of every DB change (staging and production). Add a line for every change. |
| [test-evidence/](test-evidence/) | Screenshots from the local Playwright tests. |
| [CHANGES-2026-09-24-mrf-approval-reminders.md](CHANGES-2026-09-24-mrf-approval-reminders.md) | Old, superseded. Background only. |
| [MRF-Approval-Audit-Trail-Plan.md](MRF-Approval-Audit-Trail-Plan.md) | Old, superseded. Background only. |

## 4. Where things stand (verified 25 Sep 2026, ~12:00 IST)

| Place | State |
|---|---|
| **Local branch** `pankaj-work-staging-v20` | Phases A + B + C code items **written and tested**. 231/231 backend unit tests pass (22 new), frontend builds. **Not committed, not pushed.** |
| **Staging DB** | ✅ Phase B tables/columns/trigger applied (DB-CHANGE-LOG #6), `mrf_approvers` set (#7), test MRFs #670–#676 (#5, #8). Backup of `rpa_mrf`/`rpa_settings` taken before the DDL. |
| **Staging app** (ats-staging) | Still the **old** code. It keeps working against the updated staging DB (the changes are additive). |
| **Production DB** | Phase 0 done. **No Phase A/B change** (by design, D4). |
| **Production app** | Old code until the single release. |

## 5. Step-by-step checklist (phase-wise)

Legend: ✅ done · ⚠️ needs attention · ⏳ pending · ➖ optional · 🔄 ongoing

### Phase 0: Production containment (production only; plan §4)

| Step | What | Who | Status |
|---|---|---|---|
| 0.1 | Close MRF #9's 3 open reminder rows | Claude | ✅ Re-applied 25 Sep 11:03 IST (log #1, #3, #4) |
| 0.2 | Abhijit on the "Approved/Declined" email CC | Pankaj | ✅ 25 Sep |
| 0.3 | Brief Abhijit and Sanghamitra; ask Sanghamitra about MRF #9 | Pankaj | ✅ Briefed. Sanghamitra's answer: ⏳ record it here |
| 0.4 | Find who approved MRF #9 from server / Defender logs | Admin | ➖ Optional |
| 0.5 | **Daily guard** before 14:30 IST until the production release (plan §4.1) | Pankaj or Claude | 🔄 25 Sep: nothing to close |

### Phase A: Stop the damage (code only; plan §5)

| Step | What | Status |
|---|---|---|
| A0–A9 | Rebuilt the missing CHANGES code: reminder rules, reminder job, one-winner decision, 400/409, closes reminder rows at decision time, decision log line, friendly page, seed file, tests | ✅ Code + tests |
| A10 | **Commit and push** everything (Phases A, B, C) | ⏳ Pankaj decides when |
| A11 | **Deploy to staging, once** (backend + frontend). The staging DB is already prepared | ⏳ Pankaj |
| A12 | Verify Phase A: junk action → 400; approve → success + reminder rows closed + log line; same link again → green "already approved"; two tabs / 10 simultaneous → exactly 1 wins; reminder job as 2 processes → 1 reminder for the pending MRF, decided MRF closed without one | ✅ Locally; ⏳ repeat on staging |
| A13 | Extra fix: approval link no longer bounces to /login when the browser has an old ATS login | ✅ Locally |

### Phase B: Proof and notify the other approver (plan §6)

| Step | What | Status |
|---|---|---|
| B1 | Approver list `mrf_approvers` (names + emails); falls back to the old recipients if missing or broken | ✅ Staging: "Staging Approver A/B". Production values in the seed file: Abhijit Roy, Sanghamitra Roy |
| B2 | DB script `backend/prisma/ddl/2026-09-25-mrf-approval-audit.sql` (+ rollback) and guarded runner `backend/scripts/run-ddl.mjs` | ✅ Applied to **staging**; re-run = no change; wrong DB refused; tamper tests all refused |
| B3 | One separate email and personal link per approver ("Only one approval is needed … do not forward") | ✅ Tested (MRF #675, #676) |
| B4 | Decision saves name, email, time, IP, device, comment + audit event in one transaction | ✅ Tested |
| B5 | Emails: "Already approved by X at Y" to the other approver; confirmation to the approver; HR email names the approver and CCs all approvers | ✅ Tested (to the test inbox) |
| B6 | Page shows "Reviewing as <name>", "Already approved by <name> on <time>" + comment, "You approved this…", "This link was replaced" | ✅ Tested in the browser |
| B7 | Link opens recorded (never blocks the page; likely scanners flagged) | ✅ |
| B8 | Reminders per approver; stop for revoked/used/expired links; replies no longer stop approval reminders | ✅ Unit tests + code |
| B9 | **Approval Trail** in the MRF window (timeline; IP/device for admins only) + **Re-send approval links** button; admin **Approval audit** CSV on the MRF page; decision added to the per-MRF export | ✅ Tested in the browser |
| B10 | Nightly 02:30 IST job masks IP/device after 12 months, deletes old link-open events | ✅ Tested on staging (a 400-day-old test event was masked / deleted) |
| B11 | Rate limit on the public approval routes (60 per 15 min per IP), input limits, links expire after 14 days, kill switch `MRF_APPROVAL_AUDIT_ENABLED` | ✅ Rate limit tested (61st request → 429) |
| B12 | Backfill old decided MRFs as "Unknown (before audit trail)" | ✅ Staging: 10 MRFs |
| B13 | Tests | ✅ 22 new unit tests; Playwright end-to-end |

### Phase C: Clean-up (plan §7)

| Step | What | Status |
|---|---|---|
| C1 | Switch off (or align) the old **n8n workflow**. Live on **both** DBs: on staging it writes an "MRF Approval Required_…" email row to the real submitter and flips `pending` → `waiting` within ~1 minute of each new MRF | ⏳ **Needs someone with n8n access. Must be done before production** |
| C2 | Reminders at 09:00 IST instead of 14:30 IST | ⏳ Your decision |
| C3 | Should `data_collection` emails get reminders? | ⏳ Product decision |
| C4 | Old scratch script query updated | ✅ |
| C5 | Links in the old CHANGES doc fixed | ✅ |
| C6 | CHANGELOG entry | ✅ `docs/CHANGELOG.md` 2026-09-25 |

### Staging test and sign-off (plan §8, §9.2), after A11

| Step | What | Status |
|---|---|---|
| S1 | Schema parity staging vs production | ✅ 25 Sep (before the DDL). Re-check before the release |
| S2 | Staging DB backup before the DDL | ✅ JSON export (log #6) |
| S3 | Repeat A12 + the B tests on **deployed** staging, incl. walkthrough with Chhaya | ⏳ |
| S4 | Re-run the DB script on staging must change nothing | ✅ |
| S5 | Rollback rehearsal on staging: set `MRF_APPROVAL_AUDIT_ENABLED=false`, restart, one shared-link MRF works; set back to true | ⏳ |
| S6 | Sign-off (Pankaj + Chhaya) | ⏳ |

### Production release (plan §9.3), only after S6

| Step | What | Status |
|---|---|---|
| P1 | Pre-checks: C1 done, `TRUST_PROXY=true`, schema parity, reminder preview on production | ⏳ |
| P2 | Production DB backup | ⏳ |
| P3 | **DB script FIRST** (`--env .env.production --expect-db recruitmentautomationdbProd`, dry run then real), then set `mrf_approvers` (Abhijit Roy, Sanghamitra Roy). ⚠️ The new code reads the new columns on every MRF query, so it must not be deployed before this step | ⏳ |
| P4 | Deploy backend + frontend (stop the queue worker before `prisma generate`) | ⏳ |
| P5 | Confirm feature switch on (default) and settings | ⏳ |
| P6 | Brief approvers: separate emails; only one approval needed | ⏳ |
| P7 | Post-checks: no reminder for decided MRFs; first real MRF end to end | ⏳ |
| P8 | Stop the daily guard (0.5) | ⏳ |

## 6. Next actions, in order

1. **Daily:** step 0.5 before 14:30 IST.
2. **A10:** review and commit the changes (list in §7).
3. **A11:** deploy to staging (the staging DB is already prepared; the app just needs the new code + `prisma generate` + restart).
4. **S3, S5, S6** on staging.
5. **C1** in parallel: find the n8n workflow owner.
6. Then P1–P8.

## 7. What changed in the code (for review before committing)

- **New backend:** `jobs/reminderEligibility.js`, `jobs/mrfAuditRetentionSweep.js`, `services/mrfApproval.service.js`, `utils/mrfApprovalRules.js`, `utils/splitSql.js`, `middleware/mrfApprovalRateLimit.js`, `exports/mrfApprovalAudit.export.js`, `scripts/run-ddl.mjs`, `scripts/run-reminders-once.mjs`, `prisma/ddl/2026-09-25-mrf-approval-audit(.rollback).sql`, tests `reminderEligibility.test.js`, `mrfApprovalRules.test.js`.
- **Changed backend:** `controllers/mrf.controller.js`, `routes/mrf.routes.js`, `services/emailNotification.service.js`, `jobs/reminderScheduler.js`, `jobs/inboundEmailSync.js`, `exports/mrfDetail.export.js`, `config/index.js`, `server.js`, `prisma/schema.prisma`, `prisma/seed-email-recipients.js`, `scratch/verify_graph_id_capture.js`.
- **Frontend:** `pages/MrfApprovalAction.jsx`, `pages/MRF.jsx`, `components/mrf/ApprovalTrail.jsx` (new), `services/mrfService.js`, `services/api.js`.
- **Docs:** this folder, `docs/CHANGELOG.md`.

## 8. Open questions

1. After the first decision, may the other approver add an objection, or only see the notice? (Default: notice only; replying to the "already actioned" email reaches HR.)
2. C2: reminder time 09:00 IST or keep 14:30 IST?
3. C3: remind `data_collection` emails?
4. Step 0.3: did Sanghamitra approve MRF #9?

---
*Update this file whenever a step changes status (✅/⚠️/⏳), with the date.*
