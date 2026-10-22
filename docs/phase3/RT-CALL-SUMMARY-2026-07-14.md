# Draft email — Phase 3 call summary, 14 Jul 2026

*Draft for Harish to review/edit before sending to Chhaya Verma and Naveen Satywali. Fill in [ ] before sending. This is the action item Harish committed to on the call ("send RT a consolidated summary").*

---

**To:** Chhaya Verma, Naveen Satywali
**Cc:** [ ]
**Subject:** Phase 3 — Summary of today's call + what we still need from your side

Hi Chhaya, Hi Naveen,

Thank you both for the time today — really useful to walk through the follow-up questions, the integrations, and the prototype together. Below is a summary of what we agreed, a short list of what we're still waiting on from your side, and a couple of things we'd like your call on before we build them.

## What we agreed today

**Evalground (assessment results)**
- No API from Evalground — we'll support **two ways** to bring results in: bulk CSV upload, and a single-candidate result you receive on Outlook.
- Matching is by **candidate email** (we understand names can repeat).
- If a candidate retakes a test, we'll only update their **score** — nothing else on their record changes.
- Candidates who haven't tested yet will simply show as "pending" — we won't delete or expire that.
- The generic CSV columns (GA / Section 2 / Section 3) will import as-is under those labels, and you can rename them to whatever's meaningful afterward — no need for you to pre-tag anything.

**Zeko**
- Renaming "communication score" to "coding score" everywhere in the ATS, since Zeko no longer provides a communication score.
- We're proposing this rule for moving candidates forward automatically: **score ≥50% and cheat probability Low → auto-advance**; **cheat probability Moderate → needs a recruiter's approval**; **cheat probability High → auto-reject regardless of score.**
- ⚠️ One thing to flag: this is a *different* rule from the "per-role score bands" we discussed earlier in writing. We'd like your confirmation on which one to actually build, since they're not the same thing and we don't want to build the wrong one.
- We'd like the full Zeko report and interview recording available inside the ATS, not just the score — we're checking directly with Zeko on what their system actually exposes before committing to this.

**Interviewer feedback reminders**
- First reminder ~1 hour after the interview ends, then every 2 days up to day 6, one final nudge a few days after that, and we stop chasing at day 10.
- No-login link for interviewers to submit feedback, replacing the current MS Forms → Excel process.

**Documents & retention**
- We will **never delete** a candidate document. Records stay retrievable; if storage becomes tight we'll archive older documents to SharePoint (still retrievable there) rather than remove them.
- Appointment/offer letters stay completely outside the ATS, as agreed earlier — we're only tracking the stage/status, not storing the letter itself.

**Multiple positions for one candidate**
- Keeping this simple, no automatic system logic: **you decide manually** which position a candidate proceeds with, and the system gives you a way to pause/stop the other one.
- Candidates will be searchable **by skill across the whole database** (not limited to one requisition), with their full stage history visible — this is the point of having everything in one system.

**Custom statuses**
- Custom/free-text statuses are mainly needed at the **Shortlisted** stage and the **Offer/Final** stage.
- When someone picks "Other" and types a reason, the ATS will always show what they typed — never just the word "Other."
- We're keeping stage-specific status names (like "Zeko HR Screening Pending") rather than simplifying everything to Approve/Reject, so your exports always show exactly where a candidate dropped off.

**Career page & WhatsApp**
- Confirmed: candidate submissions from the AAPNA website already flow into the ATS today — no further work needed there. Pushing job descriptions *out* to the website is a separate, new idea we've parked for a later phase.
- WhatsApp is confirmed as something we want to add. We'll wait for your team's requirements document (tool, plan, cost, message templates) before we scope the build.

**MS Access**
- Understood this isn't a live database — it's your backup/insurance copy, which matters a lot given what happened with the previous system. We're treating this as a real priority, not a nice-to-have. As a quick first step, we'll set up a scheduled export of core candidate data to Excel/Access while we work out the fuller two-way sync.

**Document collection template** — thanks for sharing this in chat; we've incorporated it as-is. One thing we noticed: it only asks for payslips, address, and one government ID — see the question below.

## What we're still waiting on from you

| Item | Owner |
|---|---|
| HR pre-screening report format + Functional test report format | Chhaya |
| Final status list for every stage, especially Shortlisted and Offer/Final | Naveen |
| MS Access table format | Chhaya |
| WhatsApp requirements — use cases, tool, plan, cost, message templates | Naveen + Chhaya (+ Sahil) |
| Your review of the prototype we shared — any changes you'd like | Both |

## A few things we'd like your call on

1. **Zeko rule:** per-role score bands (the earlier written answer) or the 50%+cheat-probability rule (today's call)? We only want to build one.
2. If a candidate is active on two positions at once, do they sit the Zeko/Evalground tests **once** (shared result) or **separately for each position**?
3. At the Offer and Document Collection stages, should the vendor get a short status update, or **nothing at all**?
4. The document checklist you shared only asks for payslips, address, and one government ID — is that the **complete list**, or are education/experience documents collected some other way?

## One more thing — sign-off

We understand from today's call that you're still reviewing the overall flow, and that's completely fine — no pressure. Just so we're aligned on timing: **could you send a short written confirmation once you're comfortable with the Process Understanding and Business Design documents** we shared earlier? We'd like to start building the Pipeline Tracker as soon as you're ready, and a quick note in writing just helps us plan the work properly on our side.

Separately, we're following up with IT directly on the calendar/Teams permission needed for interview scheduling — no action needed from you on that one.

Thanks again for such a thorough discussion today — it really helped us tighten up the plan.

Best,
Harish
