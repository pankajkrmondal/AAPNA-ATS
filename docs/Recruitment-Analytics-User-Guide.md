# Recruitment Analytics — Guide for the HR Team

**Screen:** Recruitment Analytics (left sidebar) · **Date:** 2026-08-12

This is a **read-only reporting screen**. Nothing you do here changes a candidate,
sends an email, or moves anyone through the pipeline. You can click, filter and
export freely — the worst that happens is you see a different set of numbers.

Every figure comes from what recruiters have already recorded on the Candidate
Screening and Candidate Pipeline screens. **Analytics never invents a number.**
If something looks wrong here, the fix is almost always on the screen where the
data was entered, not on this page.

---

## The headline strip (always visible)

Six counts across the top, above the tabs.

| Tile | What it counts |
|---|---|
| **Shortlisted** | Candidates whose status is *shortlisted* |
| **Rejected** | Candidates whose status is *rejected* |
| **On Hold** | Candidates whose status is *on hold* |
| **Total** | Every shortlisted candidate record in the system |
| **Zeko Sent** | Zeko screening invitations sent (sent, in progress, completed, passed or failed) |
| **Zeko Passed** | Zeko screenings with a *passed* result |

**Important:** these six are **all-time totals across every requisition**. They are
not "this month" and not filtered by role. The caption under the page title says so.
A candidate with no status set yet is counted as *shortlisted*.

---

## Tab 1 — Role Summary

**Question it answers:** how is each open role performing?

One row per role, showing Shortlisted / Rejected / On Hold / Total candidates,
with the MRF number beside each role.

- **Data comes from:** the candidate records created by Candidate Screening.
- **Grouped by:** the role on the requisition (or the position the candidate
  applied for, when there is no linked MRF).
- **Shows "MRF #N/A"** when a candidate was never linked to a requisition — worth
  chasing, because those candidates are invisible to requisition-level reporting.

**Export** downloads the complete list as a CSV, not just the rows on screen.

---

## Tab 2 — Pipeline Insights

**Question it answers:** where are candidates right now, and who is stuck?

### The four tiles

| Tile | Counts | Exact condition |
|---|---|---|
| **Active in pipeline** | Candidates still in progress | Journey has no final outcome recorded |
| **Awaiting feedback** | Candidates waiting on an interviewer | A scorecard link was emailed, the interview was **confirmed as held**, the interviewer has not submitted it, and the link has not expired |
| **On hold > N days** | Long-stalled holds | Currently *on hold*, and has been in that stage longer than the chosen threshold |
| **Offers pending** | Offers awaiting a decision | Candidate is at the Offer stage with no final outcome |

*Awaiting feedback* counts **candidates, not scorecards**. A three-person interview
panel is one candidate waiting. When the two differ, the caption shows the card
count as well.

The scorecard link expires after **7 days**. Once expired it stops counting here —
the interviewer needs a fresh link, so an expired card is not the same as a
pending one.

### Stage funnel

A bar chart for **one requisition at a time**, showing how many candidates ever
reached each stage.

- Use the dropdown (top right of the card) to switch requisition. The list shows
  every requisition that has candidates, with its count.
- If you have not picked one, the system shows the requisition with the **most
  candidates** and says so above the dropdown.
- The percentage beside each bar is the **conversion from the stage above it** —
  not from the top. It turns **red below 50%**, marking where you are losing the
  most people.

### Stuck candidates

Candidates sitting in the same stage too long, oldest first.

- **Threshold is adjustable** (5 / 10 / 14 / 30 days) — the card title always states
  which is in use.
- The day count measures time since the candidate **last moved a stage**. Notes,
  emails and scorecard reminders do *not* reset it — a candidate who has been
  chased five times but never moved still shows the full elapsed time.
- **Days colour** by severity: red at 20+, amber at 14+.

### Rejection reasons

Why candidates were rejected in the chosen window (7 / 30 / 90 days), most common
first, with the stage each reason most often occurs at.

- Comes from the **mandatory reason** recorders pick when rejecting someone on the
  Candidate Pipeline.
- Free-text "Other" reasons appear as the text that was typed, not the word "Other".

---

## Tab 3 — Recruiter Insights

**Question it answers:** how long does hiring take, and which sources work?

### Time-to-hire

Average days spent in each stage, plus a total for shortlist-to-offer.

- **Only counts finished journeys** — candidates who have a final outcome. Someone
  still in progress cannot tell you how long the process takes.
- **Shows "No closed journeys yet" until the first candidate completes.** This is
  correct, not a fault. The chart fills in as hires and rejections close out.

### Vendor performance

Per vendor: candidates in the pipeline, hired, and rejected.

There is deliberately **no "shortlist rate"** column. Every candidate in the
pipeline is already a shortlist by definition, so that rate read 100% for every
vendor and ranked nothing. It was removed rather than shown as a meaningless
number. Shows "No vendor-sourced journeys yet" until vendor-submitted candidates
enter the pipeline.

### Source of hire

Where candidates come from, and which source converts.

Sources are: **Screening shortlist** (via Candidate Screening), **Recruiter**
(added manually), **Vendor**, **Bulk excel**, and **Email intake** (CVs arriving by
email).

Columns are **mutually exclusive** — each candidate is counted once, and the
columns add up to Submitted. **Hire rate = Hired ÷ Submitted**, so it stays at 0%
until candidates actually join.

---

## Tab 4 — Email Delivery

**Question it answers:** are our emails to candidates arriving?

Covers the chosen window (7 / 30 / 90 days), with its own Refresh button.

| Tile | Meaning |
|---|---|
| **Sent** | Emails the system sent successfully |
| **Failed** | Emails that could not be sent — see Recent failures |
| **Opened** | Recipient opened the email (approximate — see below) |
| **Replied** | Recipient replied |
| **Bounced** | Delivery bounced back |

**Two honest limitations, worth telling the team:**

1. **"Opened" is a signal, not a fact.** It relies on a tracking pixel, and many
   mail clients block or pre-load images. Treat a low open count as inconclusive,
   never as proof nobody read it.
2. **"Sent" means the mail system accepted it**, not that it landed in an inbox.
   There is no delivery-receipt integration. Bounces are detected by reading
   bounce-back replies.

**By email type** breaks sends down by purpose (shortlist notification, interview
invite, reminder…). **Recent failures** lists the 20 most recent, expandable to
show the full error — this is the one to check when a candidate says they never
got an email.

If the data cannot be loaded you will see a red error box. **Tiles showing a dash
(—) mean "could not load", not zero.**

---

## Filters, exports and refreshing

- **Filters:** requisition, stuck threshold, on-hold threshold and rejection
  window. Changing any shows a brief "Updating analytics…" overlay. Re-selecting
  the value you already have does nothing.
- **Exports:** every Export button downloads a CSV of the **complete** list, even
  where the screen shows only the top 10 — and it respects the filters you have
  set. The button is disabled when there is nothing to export.
- **Refreshing:** the page reloads data whenever you change a filter. To get the
  very latest figures, reload the browser page (the Email Delivery tab has its own
  Refresh button).

---

## When a number looks wrong

Work through these in order — most "wrong" numbers are one of the first three:

1. **Is it a filtered view?** Check the requisition dropdown and the day
   thresholds. The funnel always shows one requisition at a time.
2. **Is it all-time or windowed?** The headline strip is all-time. Rejection
   reasons and Email Delivery use their chosen window.
3. **Is the underlying record complete?** A missing MRF link, a status never set,
   or an interview never marked "held" all show up here as gaps.
4. **Empty is often correct.** "No closed journeys yet", "No stuck candidates" and
   "No vendor-sourced journeys yet" are real answers about your pipeline, not
   errors.

If a figure still looks wrong after those checks, note **which tab, which filter
settings, and what you expected**, and raise it with the development team — that
detail is what makes it diagnosable.
