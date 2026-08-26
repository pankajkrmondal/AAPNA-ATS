# Phase 3 — Meeting Notes, 2026-07-14

**Meeting:** Phase 3 Discussion · 14 Jul 2026, 10:30 UTC (~70 min)
**Attendees:** Harish, Chhaya Verma, Naveen Satywali, Pankaj K Mondal (listening only)

Structure of the call: Harish walked the follow-up questions ([RT-FOLLOWUP-QUESTIONS.md](RT-FOLLOWUP-QUESTIONS.md)), then the integrations doc, then the prototype.

This is the **source-of-truth artifact** for the call — the living docs ([01](01-PROCESS-UNDERSTANDING.md)/[02](02-BUSINESS-DESIGN.md)/[03](03-DEVELOPMENT-PLAN.md)/[04](04-QUESTIONS.md)) synthesize these notes into the process/design/plan/Q&A structure; this file preserves full fidelity (exact quotes, attendees, certainty tags) that the gap analysis below depends on.

---

## 1. Discussion points & decisions

### Evalground (assessment import)
- No API integration with Evalground is possible — import only. Two mechanisms agreed, **both to be supported**: (a) bulk CSV upload, (b) single-candidate result report received on Outlook.
- **Unique key = email ID.** Names can repeat.
- Re-upload behaviour: rows already in DB are skipped; **but if a score changed (retake / technical error re-attempt), the latest score overwrites.** Only the score updates, not the rest of the candidate record. → This answers B1: **latest attempt wins, not best score.**
- Candidates who never take the test **stay in "Evalground test pending" indefinitely** — data is never deleted.
- CSV format problem raised by Naveen: columns are generic (GA, Section 2, Section 3) with no test name or role. **Decision (Chhaya, agreed by Harish):** import as Section 1/2/3 and let RT rename/edit the section labels afterwards — no manual pre-tagging. For **single-candidate upload**, the system can prompt to map section → skill. For **bulk upload**, Harish has NOT committed a mapping approach — he owes an answer.

### Zeko
- **Zeko has removed the communication score.** Now: Interview score always; Coding score additionally for coding roles. Field to be renamed communication → coding.
- Chhaya wants the **full Zeko test report + recording accessible inside the ATS**, not just the score — because **cheat probability** matters more than score.
- **Auto-advance rule agreed (this replaces the "per-role bands" answer, B2):**
  - Score ≥ 50% **and** cheat probability **Low** → system auto-advances to next stage (covers weekends/no-touch).
  - Cheat probability **Moderate** → recruiter approval required.
  - Cheat probability **High** → auto-reject, regardless of score.
- Zeko tests are created **per MRF/position, not per candidate**; reused across the year for recurring roles. HR Screening and Functional Test are **separate Zeko tests with separate links**, created/unarchived/published manually in Zeko.
- **Three different report formats exist** — HR pre-screening (good fit / not fit), Evalground, Functional test. Chhaya to share all.

### Interviewer feedback reminders (answers B6)
- First reminder within ~1 hour of interview completion (Harish's proposal, accepted).
- Then every 2 days for the first ~6 days, one final reminder after 3–4 more days, **stop at ~10 days.** Naveen's rationale: "let's not irritate the hiring managers."
- **No login for interviewers** — link-based feedback form (same pattern as MRF/missing-candidate emails). Replaces the current MS Forms → Excel process.

### Documents & retention (answers B3)
- Chhaya shared the **documentation email template** in chat — one-click send to collect candidate documents. Exact text (forwarded by Harish, 2026-07-14):
  > *Dear [Candidate Name]*
  > *Greetings from AAPNA!!*
  > *Congratulations on clearing interview rounds with us.*
  > *It's my pleasure to inform you that you have been shortlisted for the position of [ ] with us.*
  > *I request you send us the last three months' salary slip to roll out the final offer ASAP.*
  >
  > *Note - Further, for sharing offer, we will need your permanent address details and any government ID of yours that shows your DOB and father's name in it.*
  >
  > This narrows the document checklist compared to the earlier assumed default (Govt ID, education certificates, experience/relieving letters, last 3 payslips) — the real ask here is only payslips + address + one government ID. Worth confirming with RT whether education/experience documents are collected elsewhere or simply not required.
- Retention: **do not delete.** Records get pulled up to 3 years later (appraisals, Sangamitra ma'am). If storage forces it, **archive to SharePoint** after a threshold, still retrievable. **No threshold value was agreed.**
- Appointment/offer letters: to stay **manual and separate**, outside the ATS.

### One candidate, multiple positions (answers B4/B5)
- Keep it simple — **no system logic.** RT decides manually which position proceeds.
- System only needs a **status change to pause/stop the other MRF journey.**
- Non-negotiable: the candidate must be findable in a **skill-based search across the whole DB** (e.g. "all Java resources") regardless of which MRF they're tagged to, with stage history visible. Centralised database is the point.

### Custom statuses
- Custom/free-text status needed mainly at the **Shortlisted stage** and the **final/Offer stage** (7–8 statuses there).
- "Other" field allowed, **but the UI must display the typed value (e.g. "Candidate Withdrawn"), never the word "Other".**
- Same status vocabulary reused at every stage — Naveen and Chhaya will standardise so the list doesn't sprawl.
- Stage-prefixed status names ("Zeko HR Screening Pending") are **deliberate** — Chhaya wants exports/backups to show exactly which stage a profile died at. Do not "simplify" to Approve/Reject.

### Career page (C3)
- Split into two purposes: (a) career-form submissions flowing into the ATS — **Harish confirmed this is already live**; (b) pushing JD from MRF → AAPNA website — **parked**, different domain/unknown backend, later phase. Chhaya accepted.

### WhatsApp (C1)
- Confirmed as **wanted, not yet scoped.** Use cases named: profile-received acknowledgement + link for candidate to complete their profile from mobile; interview-scheduled reminders (Teams link, time). Zeko already messages candidates for its own rounds, so no overlap there.
- Requires a **paid third-party plan** (Twilio / WhatsApp Business API). RT owns the exploration — Naveen + Chhaya + Sahil / sales team — and will deliver a **separate document** covering tool, plan, cost, message templates, volume.

### MS Access (C2)
- It is **legacy/backup data, not a live DB.** Sangamitra ma'am's actual requirement is two-directional: **import** legacy Access/Excel data into the ATS, **and export** ATS data back out to Excel/Access as a backup.
- Driver: a prior ATS ("Dokri RMS") failed and the backup was lost. The Access file is her insurance policy.
- Harish flagged the **schema mismatch** (ATS has many more columns than the Excel format) and deferred an answer. Chhaya will share the Access table format. Manual top-up of Access by the RT team is acceptable to her if a straight export isn't feasible.
- End goal stated: the system should **recommend candidate pools** ("30,000 Java profiles exist → send a first communication mail").

### Storage / infra
- Chhaya asked point-blank **how much data the current system can hold.** Harish said the server is currently limited and would need scaling for volumes at that level. He owes an answer after checking with Pankaj and IT. Chhaya's fallback: keep documents out of the portal, resumes only.

### Email templates
- Templates are editable in-app (WYSIWYG + HTML view + preview). No AI assist in the editor. Naveen wants to verify he's editing them correctly.
- **New requirement:** ad-hoc per-candidate email (e.g. "manager cancelled, rescheduling"). Harish proposed a send-time prompt: use default template or edit before sending. Accepted. **Not yet built.**

---

## 2. Action items

**Harish / AAPNA**
| # | Item |
|---|---|
| 1 | Send RT a consolidated summary: what's still needed from them + answers owed by us (he committed to this on the call) |
| 2 | Decide and revert on the **bulk-upload section→skill mapping** approach |
| 3 | Confirm **server/storage capacity** with Pankaj + IT and revert to Chhaya |
| 4 | Assess **MS Access / Excel export** feasibility against ATS schema and revert |
| 5 | Verify what the **Zeko API actually exposes** (score, cheat probability, full report, recording) |
| 6 | Build: Evalground import (bulk + single), email as key, skip-unchanged / overwrite-on-change |
| 7 | Build: Zeko auto-advance + cheat-probability gate (≥50 & Low → auto; Moderate → recruiter; High → auto-reject) |
| 8 | Build: reminder cadence (1hr → every 2 days to day 6 → final → stop ~day 10) |
| 9 | Build: login-less interviewer feedback form (replaces MS Forms) |
| 10 | Build: per-candidate custom email at send time |
| 11 | Rename Zeko "communication" score → "coding" |
| 12 | Propose an archival threshold + SharePoint archive design |

**Chhaya / Naveen (RT)**
| # | Item | Owner |
|---|---|---|
| 1 | Evalground **bulk CSV** — shared in chat ✅ | Naveen |
| 2 | Evalground **single Outlook result report** — shared in chat ✅ (Harish to verify) | Chhaya |
| 3 | **Documentation/shortlisting email template** — shared in chat ✅ **verified 2026-07-14** (see §1 above); reveals a narrower checklist than assumed — flagged for confirmation | Chhaya/Naveen |
| 4 | **HR pre-screening format + Functional test report format** | Chhaya |
| 5 | **Final status list for every stage** (esp. shortlisted + final) as a document | Naveen |
| 6 | **MS Access table format** | Chhaya |
| 7 | **WhatsApp requirements document** — use cases, tool, plan, cost, templates | Naveen + Chhaya (+ Sahil) |
| 8 | **Review the prototype** (downloadable file shared via chat/email) and send changes | Both |

---

## 3. Gaps — things not to let slide

1. **Zeko API is an unvalidated assumption, and nobody owns it.** "If Zeko provides the data, we can present it" was said at least four times. That conditional is doing enormous load-bearing work — cheat probability, full report, recording, per-role scores all hang off it. If Zeko has no API (or a paid tier), a large slice of Phase 3 collapses into manual CSV import. **No one on the call was assigned to contact Zeko.** Assign it. *(Certain that it wasn't assigned; likely the single biggest schedule risk.)*

2. **The D1 sign-off was NOT obtained.** Chhaya's closest words were "let's complete the flow… keep us posted once the structure is ready" — that is not a go-ahead on the Process Understanding and Business Design docs. If development on the Tracker was gated on sign-off, **it is still gated.** Ask for it in writing in the summary email. *(This corrects an earlier same-day record that mistakenly treated a paraphrase as a formal sign-off — see the correction entries in docs 01/02/03/04 and `docs/changelog/CHANGES-phase3-planning.md`.)*

3. **B2 was answered inconsistently with the written questionnaire.** The written answer said *per-role score bands*; the call produced a *flat 50% threshold + cheat-probability gate*. Those are different systems. Confirm in writing which one is real, or build one and get asked for the other.

4. **B7 (vendor visibility at Offer / Document stages) was never discussed.** It fell off the agenda entirely. Still open (tracked as Q29).

5. **Retention has no number.** "Archive after some time, keep 3 years of retrievability" is not a spec. Pick a threshold (e.g. archive to SharePoint 12 months after final decision) and get it confirmed — otherwise storage grows unbounded and action item #3 above becomes a live problem.

6. **The MS Access export is being treated as a nice-to-have; it isn't.** Sangamitra ma'am lost a previous ATS and its backup, and the Access file is how she protects against that happening again. If Harish says "export is difficult," the sponsor hears "same risk as last time." Even a plain scheduled CSV/Excel dump of core tables would buy a lot here, cheaply. *(Certain on the transcript; likely on the political read.)*
