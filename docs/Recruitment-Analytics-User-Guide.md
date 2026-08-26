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
| **Zeko Sent** | Candidates who have been sent a Zeko assessment |
| **Zeko Score Received** | Candidates whose Zeko score has come back into the ATS |

**Important:** these six are **all-time totals across every requisition**. They are
not "this month" and not filtered by role. The caption under the page title says so.
A candidate with no status set yet is counted as *shortlisted*.

**Zeko Score Received is not a pass count.** The ATS records whatever score Zeko
returns and does not judge it against a threshold — there is no pass mark anywhere
in the system. This tile answers "how many results have come back", nothing more.
It was previously labelled *Zeko Passed*, which promised a judgement the app never
makes; that tile could only ever show `0`. To see how a candidate actually did, open
their record and read the score.

**Both Zeko tiles count candidates, once each** — the same unit as the four tiles
beside them — so Score Received can be read directly against Sent. A candidate who
sits both the HR and the functional Zeko round still counts once. (Before
2026-08-26 they counted invitations, so those candidates were counted twice and
Zeko Sent read higher than it does now.)

**Total does not equal Shortlisted + Rejected + On Hold.** A candidate marked
*Future Prospect* is in Total but in none of those three. The Role Summary tab
below breaks all four out per role.

---

## Tab 1 — Role Summary

**Question it answers:** how is each open role performing?

One row per role, showing Shortlisted / Rejected / On Hold / Future Prospect /
Total candidates, with the MRF number beside each role.

- **Data comes from:** the candidate records created by Candidate Screening.
- **Grouped by:** the role on the requisition (or the position the candidate
  applied for, when there is no linked MRF).
- **The four status columns add up to Total.** *Future Prospect* — a candidate
  worth keeping in mind for a later opening — is a status a recruiter can set in
  the pipeline drawer like any other. It was missing from this table until
  2026-08-26, so those candidates appeared in Total and in no column at all,
  which made the row look like it did not add up.
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
- **"Reached" means the candidate actually arrived at that stage.** An optional
  stage that was skipped does not count for the candidate who skipped it. Before
  2026-08-26 anyone sitting past a stage counted as having reached it, so a
  skipped optional stage looked as though everyone had been through it — expect
  those bars to read lower now, and correctly.

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

A headline figure for how long a hire takes end to end, plus average days spent in
each stage.

- **The headline is the middle hire, not the average.** Line every completed hire up
  by how long it took and this is the one in the middle. Hiring sets are small, and a
  single unusually long requisition would drag an average somewhere no real hire has
  been.
- **It counts hires only** — candidates who joined or whose offer was approved,
  measured from the day they entered the pipeline to the day their journey closed.
  Rejected and withdrawn candidates are excluded: they have no hire date.
- **Always check the number of hires shown beneath it.** Over two or three hires this
  describes those hires; it is not a benchmark you can plan against.
- **Shows an em-dash (—) until the first hire closes**, never "0 days". A zero here
  would be indistinguishable from an instant hire.
- **The stage bars are a wider, separate calculation:** average days per stage across
  *all* closed journeys, however they ended, since a stage duration is informative for
  a rejected candidate too. Each bar carries its own `n =` sample size. A stage that
  genuinely takes minutes shows `0d` and stays in the list.
- **Do not add the stage bars together to get the headline.** They will not match, and
  they are not meant to: each stage is averaged over a different set of candidates.
  Until 2026-08-26 the headline *was* that sum, labelled "shortlist to offer" — a
  figure no candidate's journey ever actually matched.

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
5. **Are you comparing against a screenshot from before 2026-08-26?** Several
   numbers deliberately changed that day, each moving away from a wrong figure:
   *Zeko Passed* became **Zeko Score Received** and rose off a permanent zero,
   **Zeko Sent fell** (it now counts candidates rather than invitations), the
   **time-to-hire headline** changed to a median over hires only, and **funnel
   bars fell** wherever an optional stage was skipped.

**A zero that never moves is worth reporting.** The *Zeko Passed* defect was
exactly that shape — a tile that had shown `0` since the day it shipped, because it
counted something the system never records. If a number has never changed no matter
what you do, that is a stronger signal than a number that merely looks off.

If a figure still looks wrong after those checks, note **which tab, which filter
settings, and what you expected**, and raise it with the development team — that
detail is what makes it diagnosable.
