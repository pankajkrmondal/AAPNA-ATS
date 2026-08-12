# Phase 3 — Module Status & Delivery Scope

**Date:** 2026-08-06 · **For:** RT / PM
**Companion documents:** [Production deployment runbook](../deployment/PHASE3-PRODUCTION-DEPLOYMENT.md) · [Code review & test report](PHASE3-CODE-REVIEW-2026-08-06.md) · [Coverage audit](PHASE3-COVERAGE-AUDIT.md) · [Recruitment Analytics audit](../Recruitment-Analytics.md)

---

## The headline

Phase 3 development is **essentially complete**. Modules M1 through M5 are built, hardened
and tested, including a full run against a live server.

**None of it is in production yet.** Production is still running the Phase 2.1 baseline that
went live on 2026-07-14. Everything below is sitting in staging waiting for a deployment
decision.

---

## 1. Status by module

| Module | What it does | Status | Still outstanding | Waiting on |
|---|---|---|---|---|
| **M0** | Zeko screening + email engine | ✅ **Live** since 2026-07-14 | — | — |
| **M1** | Stage engine, Pipeline Tracker, outcome emails | ✅ Built & tested | Two admin screens (below) | — |
| **M2** | Evalground assessment import | ✅ Built & tested *(bulk CSV tested by Harish)* | Automatic single-result intake | Deferred by agreement |
| **M3a** | Teams/Outlook scheduling, reminders, interviewer scorecards | ✅ Built & tested | Free/busy display; candidate self-scheduling | Deferred by agreement |
| **M3b** | Zeko auto-advance, full report, recording | ⬜ **Not started** | The whole scope | **The Zeko API validation spike** |
| **M4** | Document collection | ✅ Built & tested | Archive to SharePoint | No agreed retention period |
| **M5** | Offer management & closure | ✅ Built & tested | One "amend decision" screen | — |
| **M6** | Placement vendor completion & hardening | ⬜ **Excluded** | The whole module | RT owns this separately |

### What each completed module actually delivers

- **M1** — Candidates move through 12 configurable stages. Every Approve / Reject / Hold is
  recorded with a mandatory reason, writes to the audit trail, emails the candidate, and
  notifies the team. Admins can now reshape stages, outcomes and reasons from a screen
  instead of asking a developer.
- **M2** — A bulk Evalground CSV is uploaded, matched to candidates, scores written back, and
  (optionally) the round approved or rejected automatically on the pass mark.
- **M3a** — An interview is booked from the candidate's card: it creates the Outlook calendar
  event and Teams meeting, emails candidate and panel, sends reminders before the round, then
  asks whether it actually happened before releasing the scorecard link to the interviewer.
  All six rounds are covered — Tech 1/2/3, HR, CEO/Final, and Client (manual by design).
- **M4** — HR raises a document request; the candidate uploads through a secure no-login link;
  HR verifies or rejects each item, and a rejection automatically re-requests just that
  document. Candidates who go quiet are now chased automatically.
- **M5** — The internal approval, the offer being shared, and the candidate's answer are all
  recorded. An accepted offer closes the requisition once every opening is filled — and a
  reversed acceptance re-opens it.

---

## 2. What "Phase 3 delivered" means

So sign-off is against something concrete, we consider Phase 3 delivered when:

1. M1–M5 are **deployed to production** and running against live candidates.
2. The **end-to-end test suite** has been executed as a formal pass (see §5 — this is the
   main gap).
3. The four outstanding screens in §3 are built, **or** explicitly deferred in writing.
4. The four open decisions in §3 are answered.
5. M3b and M6 are formally moved to Phase 3.1, **or** scheduled.

Items 3–5 are choices, not work in progress. Item 1 is the immediate blocker.

---

## 3. Outstanding work, by who unblocks it

### Needs a decision from RT

| # | Decision | Why it matters |
|---|---|---|
| 1 | **Is M3b in Phase 3 or Phase 3.1?** | Nothing has been built. It cannot even be estimated until the Zeko API spike reports back, and that spike is still unassigned. |
| 2 | **The "Recruitment Process & Interview Stages" email** — should it send automatically when a candidate is shortlisted? | The template is ready but not switched on. Candidates already receive the Shortlist Notification at that same moment, so turning this on means two emails at once. That is your call, not ours to assume. |
| 3 | **Q29 — do vendors get a status line at the Offer and Documents stages?** | Never answered, so the safer default ships: vendors are told nothing at those two stages. |
| 4 | **How long are candidate documents kept before archiving?** | No threshold agreed, so no archive job was built. Documents are never deleted today, per your standing instruction. |
| 5 | **Five closure email templates exist but will never send. Keep it that way?** | Templates named *Closure — Joined*, *Joined and Left*, *Backed Out*, *Did Not Join* and *Candidate Withdrawn* were created in staging. The system deliberately sends **nothing** for these five outcomes, because they record something the candidate already lived through — emailing "Congratulations" to someone who backed out is exactly what the rule prevents. Whoever wrote those templates is expecting mail to go out. Either we delete them, or you tell us which ones genuinely should send. |

### Needs IT

| Item | Impact if it does not land |
|---|---|
| Microsoft Graph `OnlineMeetingArtifact.Read.All` + a Teams application access policy | Only the *automatic* attendance check is affected. Recruiters can still mark an interview Held or No-show by hand, so no round is blocked. |

### Needs development (small)

| Item | Effect today |
|---|---|
| "Create email template" screen | The capability exists but only through the API — a developer is still needed to add a new template. |
| Stage → email template mapping screen | Assigning a specific email to a specific stage outcome still needs a database change. |
| "Amend offer decision" screen | Correcting a recorded acceptance/rejection needs a developer. |
| Free/busy availability display | The scheduling window does not yet show when the interviewer is busy. |
| Recruitment Analytics corrections | Six metrics on the Analytics page are wrong. Most notably "Awaiting feedback" is hardcoded to `0` because the code still assumes M3a is unbuilt — it has shipped, so that tile reports zero over real outstanding scorecards. Full audit and plan: [Recruitment Analytics](../Recruitment-Analytics.md). |

### Deferred by agreement — not planned for Phase 3

Evalground single-result auto-intake · candidate self-scheduling · multi-company data
separation · session-token hardening.

---

## 4. Risks

| Risk | Assessment |
|---|---|
| **Nothing is in production.** | The single biggest risk. Everything works in staging; production has never run any of it. The deployment is a real, sequenced piece of work — see the runbook. |
| **The Zeko API spike is still unassigned.** | It was flagged as the top schedule risk on 2026-07-14 and remains open three weeks later. M3b cannot be sized until it closes. |
| **Production currently emails no candidates at all.** | A safety switch is enabled in production that redirects all candidate email to an internal test inbox. It must be deliberately turned off at go-live — otherwise candidates receive nothing. |
| **The formal test suite has not been run as a suite.** | Individual checks pass (§5); the scripted end-to-end pass across all modules has not been executed. |

---

## 5. Quality position

Two full review-and-test sessions were run on 2026-08-05 and 2026-08-06.

| | |
|---|---|
| Defects found | **22** |
| Fixed | **19** |
| Open | 3 material, 6 minor — all documented |
| Automated tests | **55**, all passing |
| Live end-to-end checks | **46**, all passing |

The second session ran everything against a live server rather than reviewing it on paper.
That found **three further defects that reading the code had missed** — including one where a
double-click on the interviewer scorecard page recorded the same feedback twice. All three are
fixed.

Notably verified: booking an interview from staging puts the **internal test address** on the
real Outlook invite, never the candidate's — confirmed by reading the event back from
Microsoft.

**The honest gap:** the formal end-to-end passes (the Teams round-trip checklist, the
document and offer walkthroughs) have still not been executed as a signed-off suite. You have
tested the Evalground import yourself; the rest have been verified by us but not formally run
as an acceptance pass.

Full detail: [PHASE3-CODE-REVIEW-2026-08-06.md](PHASE3-CODE-REVIEW-2026-08-06.md).

---

## 6. Recommended next steps

1. **Decide the go-live date** and work through the deployment runbook — this unblocks
   everything else.
2. **Assign the Zeko API spike**, or formally move M3b to Phase 3.1.
3. **Answer the four decisions** in §3.
4. **Run the end-to-end acceptance pass** in production once deployed.
5. Build the four small screens, or defer them in writing.
