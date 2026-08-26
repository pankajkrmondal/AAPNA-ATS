# Phase 3 — Questions for the Recruitment Team (RT) & IT

**Document 4 of 4** · Status: **RT answers received 2026-07-13 (annotated PDF), substantially refined on a 2026-07-14 call with Chhaya Verma + Naveen Satywali** ([full meeting notes](MEETING-NOTES-2026-07-14.md)). **⚠️ CORRECTION: the sign-off recorded earlier the same day was wrong** — a provisional discussion was mistakenly treated as a formal go-ahead; §E below is rewritten with the correction. Q1, Q4 (flagged contradiction), Q7, Q8, Q13, Q20, Q21, Q22 all updated with call detail. Q17 stays closed (Phase 2.1 is live). Still fully open: Q16 (IT), Q24, Q29, plus the new open items in §C (most urgently: **Zeko API capability validation — unassigned, the single biggest schedule risk**).
Companion docs: [01-PROCESS-UNDERSTANDING.md](01-PROCESS-UNDERSTANDING.md) · [02-BUSINESS-DESIGN.md](02-BUSINESS-DESIGN.md) · [03-DEVELOPMENT-PLAN.md](03-DEVELOPMENT-PLAN.md) · [07-EVALGROUND-IMPORT-PLAN.md](07-EVALGROUND-IMPORT-PLAN.md)

Where we have a recommended default, it is stated — answering "use the default" is a valid answer. Questions marked **🚧 BLOCKER** gate a specific module. Answers received from RT on 2026-07-13 are recorded under each question as **Answer (RT, 2026-07-13)** and summarized in the answer sheet at the end.

---

## A. For the Recruitment Team (RT)

**Q1. 🚧 Evalground results CSV (blocks Module 2).**
Please share a **real recent sample CSV** and confirm:
- Which columns does it contain? Does it include the **candidate email** (our matching key)?
- One row per candidate per test, or aggregated?
- Are General Aptitude and Technical results in one file or separate files?
- Who gets which test (GA, Technical, or both), and how is that decided per candidate?
- How often is the file produced, and who sends it to whom?

> **Answer (RT, 2026-07-13):** Matching key = **candidate email**. **More than one row per candidate is possible.** GA and Technical results come in **one file**. Test assignment: **non-IT candidates get GA + English; IT candidates get role-specific tests**, decided from the Role and MRF. The file arrives **via Evalground into the Outlook mailbox**. A sample CSV was promised for reference but **has not been received yet — Module 2 stays gated on the physical file.**
>
> **Update (2026-07-14 call):** no Evalground API exists — import only, and **two mechanisms must both be supported**: (a) bulk CSV upload, (b) a **single-candidate result received on Outlook** (new — not previously scoped). CSV columns are **generic** (GA, Section 2, Section 3 — no test name/role attached); decision: **import as Section 1/2/3, RT renames the labels afterward** — no manual pre-tagging needed from RT. For single-candidate entry the system can prompt for a section→skill mapping; **for bulk upload the mapping approach is not yet decided — Harish owes an answer.** Re-upload behavior confirmed: rows already in the DB are skipped; if a retake changed the score, **only the score is overwritten** (this settles the earlier "latest vs best" open item as **latest**, now RT-confirmed rather than assumed). Candidates who never test **stay "Evalground test pending" indefinitely, never deleted.** **✅ Sample files received 2026-07-14** — both the bulk CSV (Naveen) and a single-candidate Outlook result report (Chhaya) were shared in chat; Harish still needs to verify their exact format against the Section-label design above before M2 build starts.
>
> **✅ Update (2026-07-20) — format verification + mapping decision closed, full plan in [07-EVALGROUND-IMPORT-PLAN.md](07-EVALGROUND-IMPORT-PLAN.md).** Both sample files verified against the Section 1/2/3 design. New finding: the bulk CSV carries a free-text **Test Name** column alongside the generic score columns — this is what makes an **AI-suggested section→skill mapping** possible (read off the test title, not guessed from raw numbers); **RT confirms the suggested mapping once per import batch (per distinct test-name cluster), never per row** — this closes the bulk-mapping open item, and the single-candidate path no longer needs its own separate "prompt at entry" behavior since it reuses the same batch-confirmed mapping table. Second finding: the single-result "Outlook mechanism" is not a file to manually upload — it's Evalground's own transactional email landing in the same shared mailbox the ATS already polls. **Redesigned accordingly: single-result ingestion is now automatic, via a third fan-out processor on the existing `mailboxPoller.js` Graph delta poll (`backend/src/services/outlookReader.service.js`), not a manual upload/entry screen.** New tables planned: `rpa_assessment_imports` + `rpa_assessment_results` (see doc 07 §5).

**Q2. Evalground API — ✅ CLOSED.** Paid add-on; not used. Stage 2 is CSV import only (see Q1 and the Note at the end). No action needed.

**Q3. 🚧 Offer stage scope (blocks Module 5).** What should the ATS do at the offer stage?
- (a) **Record only** — HR sends the letter from their own mailbox; ATS records shared-date, letter file, Accept/Reject decision. *(least effort)*
- (b) **Send from ATS** — HR uploads the letter PDF and the ATS emails it; full audit trail. *(recommended — default)*
- (c) **Secure accept/decline link** — candidate views the offer online and clicks Accept/Decline. *(most polished)*

Three sub-decisions (each needs a yes/no):
- Internal approval required before an offer goes out? *(default: no approval gate)*
- Offer validity period? *(default: none)*
- Track revised/negotiated offers as versions? *(default: yes)*

> **Answer (RT, 2026-07-13):** **(a) Record only** — "just need stage and status to be changed by HR." (b) and (c) rejected. Sub-decisions: internal approval = **yes, with a reminder nudge**; offer validity = **not required** (informally ~3 days); version tracking = **no** (handled manually).
> *Detail decided in-house (see §D1, Q26): the **recruiter** approves, **in-app**; nudge defaults to daily until approved; recording "offer shared" without the approval step is allowed for exceptional cases — offers are shared offline and only recorded in the ATS.*

**Q4. Score thresholds.**
- Zeko (Stage 1 & 3): score bands for auto-suggested Approve/Hold/Reject, per role or global?
- Evalground (Stage 2): pass marks for GA and Technical?
*(Default if none: no auto-suggestion; HR decides from raw scores.)*

> **Answer (RT, 2026-07-13):** Zeko bands **per role** (the actual band values are not yet supplied — open item; until then, no auto-suggestion for a role without bands). Evalground pass mark = **50%** for both GA and Technical.
>
> ⚠️ **Contradiction surfaced on the 2026-07-14 call — needs written confirmation before M3 build.** The call produced a completely different mechanism for Zeko: **score ≥50% AND cheat probability Low → system auto-advances** to the next stage; cheat probability **Moderate → recruiter approval required**; cheat probability **High → auto-reject regardless of score.** This is not a refinement of "per-role bands," it's a different system entirely (flat threshold + a new cheat-probability signal, no per-role variation). **Both cannot be simultaneously true — RT must confirm in writing which is real**, or we build one and get asked for the other. This whole mechanism is additionally contingent on the Zeko API actually exposing a cheat-probability field, which is unvalidated (see the 🚨 top risk in [03-DEVELOPMENT-PLAN.md](03-DEVELOPMENT-PLAN.md) §M3). Evalground pass mark (50%, both tests) is unaffected by this contradiction and stands confirmed.

**Q5. Vendor email content depth.**
Confirmed rule: vendor-sourced candidates → both candidate and vendor updated on **every** status change. For **sensitive stages** — offer (CTC, letter) and document collection (PII) — should the vendor receive:
- (a) the full candidate email verbatim, or
- (b) a **status-only notification** ("Offer shared with candidate on <date>") without figures or attachments? *(recommended — default)*

> **Answer (RT, 2026-07-13):** **(b) — information only, no figures.** The vendor does not need to see the offer letter or the document-collection mail. *Ambiguity remains (see §D2, Q29): at the offer/document stages, does the vendor get a bare status-only line, or nothing at all? RT's wording supports both readings.*

**Q6. 🚧 Interview scheduling mode (blocks Module 3 UX).** Which model?
- (a) **Candidate self-scheduling** — recruiter publishes slots; candidate picks from a link; invite auto-sent.
- (b) **Interviewer-fixed time** — time agreed offline, entered in the app; app sends the Teams invite to all.
- (c) **Both — (b) now, (a) as a follow-up.** *(default; (b) ships first either way)*

Should the app also show **interviewer free/busy** while picking a slot, to avoid double-booking? *(default: yes — requires the Q16 permission)*

> **Answer (RT, 2026-07-13):** **Both** — (a) candidate self-scheduling **and** (b) interviewer-fixed time. Free/busy display = **yes**. (Interviewer-fixed ships first; self-scheduling follows as the second increment of Module 3. Free/busy and self-scheduling still require the **Q16 grant, which is unanswered**.)

**Q7. Reminder timings & feedback escalation.** Confirm or adjust:
- Candidate reminder: 24 h and 1 h before.
- Interviewer reminder: 1 h before.
- Feedback reminder: 2 h after the interview, then daily until submitted.
- **Escalation:** after 3 unanswered feedback reminders, notify **Sanghamitra** (please confirm). Card is flagged "awaiting feedback > X days" in all cases.

> **Answer (RT, 2026-07-13):** Candidate reminder: **30 min before** (replaces the 24 h + 1 h proposal). Interviewer reminder: **30 min before**. Feedback reminder: **once per day until submitted**. Escalation: **no** — no named-person escalation; the in-app "awaiting feedback" flag stays. *(§D1, Q28: the 30-min-only candidate reminder is confirmed intentional — the calendar invite at scheduling time is the advance notice.)*
>
> **Update (2026-07-14 call) — this closes Q27, the earlier proposed reminder cap.** The real cadence is more specific than "daily": **first reminder ~1 hour after the interview ends**, then **every 2 days through day 6**, **one final reminder 3–4 days after that**, **stop at ~day 10**. Naveen's stated rationale: "let's not irritate the hiring managers." Still no named-person escalation — the in-app flag remains the only signal past day 10.

**Q8. 🚧 Document checklist (blocks Module 4).**
Default proposal (please ratify or amend): Govt ID, education certificates, experience/relieving letters, last 3 payslips.
- Does the list vary by role/seniority? *(default: same list for all)*
- Retention period, and who may view? *(default: 1 year post-decision; recruitment team only; vendors never)*

> **Answer (RT, 2026-07-13):** **Same list for all roles; RT will provide a template** (not yet received — open item). Retention answer is ambiguous — verbatim: *"Based on joined and left stage moved in every month"* — **needs a follow-up clarification**; until then the stated default stands (1 year post-decision; recruitment team only; vendors never).
>
> **Update (2026-07-14 call) — retention clarified, replaces the "1 year" default: documents are NEVER deleted.** Records must be pullable up to 3 years later (appraisals, Sangamitra ma'am). If storage forces it, older documents **archive to SharePoint**, still retrievable — **but no archival threshold has been agreed** (open item, owed by Harish to propose, e.g. "archive to SharePoint 12 months after the final decision"). Separately, storage-capacity is now a live risk: if the server can't hold the projected volume, RT's fallback is **resumes only, no other documents in the portal** — see the open item in §C.
>
> **✅ Document collection email template received (Chhaya, shared in chat, forwarded 2026-07-14) — closes the "template pending" item.** Exact text:
> > *Dear [Candidate Name]*
> > *Greetings from AAPNA!!*
> > *Congratulations on clearing interview rounds with us.*
> > *It's my pleasure to inform you that you have been shortlisted for the position of [ ] with us.*
> > *I request you send us the last three months' salary slip to roll out the final offer ASAP.*
> >
> > *Note - Further, for sharing offer, we will need your permanent address details and any government ID of yours that shows your DOB and father's name in it.*
>
> **⚠️ This narrows the checklist — worth confirming, don't just merge it with the earlier proposed default.** The real ask is only: **last 3 months' payslips**, **permanent address** (a data field, not a document), and **one government ID showing DOB + father's name**. It does **not** mention education certificates or experience/relieving letters, which the original default proposal (Govt ID, education certificates, experience/relieving letters, last 3 payslips) included. Either the real checklist is narrower than assumed, or those are collected elsewhere/earlier in the process — **confirm with RT before finalizing the M4 seed data.** Note also: this email fires **after final interview rounds clear, before the offer is rolled out** — matching the existing Document Collection → Offer stage order — and the placeholder `[ ]` after "position of" needs the role/MRF title merge field.

**Q9. Reschedule & no-show policy.**
- How many reschedules per round, and who may trigger one? *(default: 2, recruiter only)*
- After how many candidate no-shows does the round auto-move to Hold? *(default: 2 → Hold, reason "Unresponsive")*
- Same for Zeko interview links that expire unused.

> **Answer (RT, 2026-07-13):** Reschedules: **recruiter-only** triggers (no fixed limit given). No-shows: **no auto-move to Hold — the recruiter decides.** Expired Zeko links: keep as-is, recorded as **"window missed"** — the recruiter decides the consequence.

**Q10. On-Hold policy.**
Hold has no exit today. Proposal: HR review reminder at **30 days**; auto-close to "Future Prospect" at **90 days**. Confirm or adjust.

> **Answer (RT, 2026-07-13):** **Manual only** — no automated review reminder, no auto-close. The in-app On-Hold aging view ships regardless and is the only guard against stale Hold candidates (accepted risk; L1 residual).

**Q11. Re-application cooling-off.**
Rejected candidate reapplies later — reopen the old record or start fresh? Minimum gap *(e.g., 6 months)*? Differs by rejection stage/reason?

> **Answer (RT, 2026-07-13):** **6-month cooling-off**, differing by rejection stage/reason, applicable **from Zeko HR Screening (Stage 1) onwards** — Stage 0 rejections are exempt. *(The per-stage/per-reason matrix values are not yet supplied; the window is admin-configurable. See §D1, Q23: cooling-off blocks only new journeys — an active concurrent journey is never stopped by a rejection elsewhere.)*

**Q12. "Joined and Left" tracking window.**
How long after joining does the ATS keep tracking? *(default: ATS closes the record 90 days after Joined unless marked Joined-and-Left first)*
(Definitions for Withdrawn / Backed Out / Did Not Join are in the Note at the end — please confirm those.)

> **Answer (RT, 2026-07-13):** **Yes — default confirmed**: the record closes 90 days after Joined unless marked Joined-and-Left first. Closure definitions confirmed in RT's words: **Withdrawn** = candidate took their candidature back during the interview process; **Backed Out** = backed out after the offer; **Did Not Join** = accepted the offer but failed to join on joining day.

**Q13. Multiple positions.**
Can one candidate run **two open MRFs at once**, or one at a time? *(default: one journey per candidate-per-requisition, with a visible warning that the candidate is active elsewhere)*

> **Answer (RT, 2026-07-13):** **Yes — a candidate can run two open MRFs at once** when they match the MRF and JD. This replaces the one-journey default: the design becomes one journey **per candidate-per-MRF** with a visible concurrency badge. *(Follow-ups in §D2: Q24 shared assessments across journeys, Q25 offer collision.)*
>
> **Update (2026-07-14 call) — this closes Q25 (offer collision).** RT wants **no system logic** for resolving conflicts between two active journeys — "keep it simple." **RT decides manually** which position proceeds; the system's only job is to provide a manual action to **pause/stop the other journey's status** once that decision is made. No automated freeze-the-other-journey behavior. **Q24 (whether a shared candidate sits Zeko/Evalground tests once or once per journey) was NOT addressed on this call — still open.**
>
> **Also raised as non-negotiable (2026-07-14):** a candidate must be findable via **skill-based search across the whole database** (e.g. "all Java resources"), regardless of which MRF they're tagged to, with full stage history visible — this is the stated point of centralizing on one ATS (see [02-BUSINESS-DESIGN.md](02-BUSINESS-DESIGN.md) §1.1).

**Q14. Client Interview details.**
- If the Hiring Manager didn't give client contact details at MRF submission, does the recruiter enter them manually later? *(default: yes)*
- Does the client ever receive a system-generated email (invite/feedback request), or is all client communication manual with HR transcribing the outcome? *(default: fully manual; HR transcribes)*

> **Answer (RT, 2026-07-13):** Recruiter enters client contact details manually later = **yes**, and **the system must not generate anything for the client.** All client communication is **manual**; HR transcribes the outcome.

**Q15. Resume screening criteria (Stage 0).**
Screening criteria per role (must-have skills, experience band, salary cap, notice-period cap) to power consistent Stage 0 decisions and auto-suggestions. *(default if not provided now: no auto-suggestion; HR decides from AI scores)*

> **Answer (RT, 2026-07-13):** **OK — default accepted.** No auto-suggestion; HR decides from the AI screening scores.

**Q17. Phase 2.1 go-live UAT slot — ✅ CLOSED (2026-07-14).** Phase 2.1 (Zeko + email engine) **is live now**; no UAT gate needed. M0 is complete — no action required.

**Q18. Interviewer scorecard structure.** *(optional — omit and we ship a generic scorecard)*
For interview rounds 4–8: which competencies should the scorecard rate, and on what scale (e.g., 1–5)? Same card for all rounds, or per-round?

> **Answer (RT, 2026-07-13):** **Same card for all rounds.** The template is the one created by Harish.
> **Template received 2026-07-14** ("Interview Evaluation Format V2" — the MS Forms + Power Automate → Excel flow Harish built; the ATS now builds its own in-app form replacing it). Structure documented in [03-DEVELOPMENT-PLAN.md](03-DEVELOPMENT-PLAN.md) M3. **Note:** the workbook actually contains **two card layouts** — one shared by Technical Rounds 1–3 / CEO (skills + ratings) and a **distinct HR Round card** (family background, timings, relocation, notice period, CTC/ETC, strengths/weaknesses, next step) — so "same for all rounds" applies to the technical/CEO rounds; the HR Round keeps its own card.

**Q19. Per-stage reject/hold reasons.** *(optional — omit and we reuse the Stage 0 taxonomy everywhere)*
Reason dropdown values for stages 1–8, or is the existing Stage 0 list (High Salary, High Notice, Skills Mismatch, …) fine across the board?

> **Answer (RT, 2026-07-13):** **Yes — the Stage 0 list is fine across the board**, plus a free-text field for **"Other reasons"** at every stage.

---

## B. For IT / Tenant Admin

**Q16. 🚧 Microsoft Graph permission grant (blocks Module 3).**
For the existing app registration (already sending mail via the shared mailbox):
- Grant **`Calendars.ReadWrite` (Application)** — to create Outlook events with Teams links from the shared recruitment mailbox.
- If free/busy or self-scheduling is chosen (Q6): additionally **`Schedule.Read.All`** (or `Calendars.Read`).
- If the tenant uses an **application access policy** restricting the app to specific mailboxes, extend it to cover calendar access for the shared mailbox.
We verify the grant with a read/create/delete test on a staging calendar before Module 3 starts.

> **Status: UNANSWERED (IT, not RT).** Note: Q6 was answered on 2026-07-13 with **both scheduling modes + free/busy = yes**, so the grant must include **`Schedule.Read.All`/`Calendars.Read`** in addition to `Calendars.ReadWrite`. This is now the **only** gate on Module 3.

---

## B2. Integration placement clarifications (from RT's "Integration Requirements" PDF, 2026-07-13)

The integration asks are placed in the process where they fit (see 03-DEVELOPMENT-PLAN.md → "Integration asks — disposition"). These questions decide the final shape of the remaining items:

**Q20. WhatsApp integration.** Which mechanism — WhatsApp Business Cloud API directly, or a BSP (e.g., Twilio, Gupshup)? Which messages should go via WhatsApp (interview invites, reminders, outcomes)? Who owns the WhatsApp Business Account/number, and how is candidate opt-in consent captured? *(Heavy external setup → will be documented as an exception plan, like C2C.)*

> **Update (2026-07-14 call):** confirmed **wanted, not yet scoped.** Use cases named: profile-received acknowledgement + a link for the candidate to complete their profile from mobile, and interview-scheduled reminders (Teams link, time). No overlap with Zeko, which already messages candidates for its own rounds. Needs a **paid third-party plan** (Twilio / WhatsApp Business API). **Ownership shifted: RT now owns the exploration** — Naveen + Chhaya + Sahil/sales team — and will deliver a **separate requirements document** (tool, plan, cost, message templates, volume). Our exception-plan doc (`docs/whatsapp-integration-plan.md`) gets written once that lands.

**Q21. MS Access integration.** Which Access database, what data, which direction (import into ATS / export from ATS / one-time migration), and for what business purpose? *(If it is a simple data extract, it becomes a small export job; if heavy, an exception doc.)*

> **Context (Harish, 2026-07-14, pre-meeting):** the recruitment team has been saving candidate data in an MS Access database **since day 1** — the working hypothesis was a **one-time migration ask.** Sharpened question sent via `RT-FOLLOWUP-QUESTIONS.md` §C2.
>
> **✅ Answered on the 2026-07-14 call — the hypothesis was only half right.** It is **legacy/backup data, not a live DB**, but the real requirement is **two-directional**: (1) a **one-time import** of the historic Access/Excel data into the ATS, **plus** (2) an **ongoing export/backup** of ATS data back out to Excel/Access. **Driver (important context — do not treat this as a nice-to-have):** a prior ATS ("Dokri RMS") failed and its backup was lost; the Access file is Sangamitra ma'am's insurance policy against that happening again. **Open items:** Harish flagged a **schema mismatch** (the ATS has far more columns than the Excel format) and owes a feasibility assessment; Chhaya owes the **Access table format**. **Fallback accepted by Chhaya:** manual top-up of the Access file by the RT team if a straight automated export isn't feasible. **Stated end-goal (out of Phase 3 scope, future vision):** the system should recommend candidate pools, e.g. "30,000 Java profiles exist → send a first communication mail." **Recommendation: ship the cheap win first** — a scheduled CSV/Excel export of core candidate tables — while the schema-mismatch assessment is still pending.

**Q22. Career Page integration.** *(Low priority — this is a link from the AAPNA website; deferred until after M0–M6.)* What exists today ("partially implemented"), where is it hosted, and what should flow into the ATS?

> **Context (Harish, 2026-07-14, pre-meeting):** the AAPNA website already has a candidate submission form; the current flow (submit → email w/ resume attached → RT) looked already covered by the existing email-intake / resume-parsing pipeline. Sharpened question sent via `RT-FOLLOWUP-QUESTIONS.md` §C3.
>
> **✅ Answered and mostly closed on the 2026-07-14 call.** Splits into two distinct asks: **(a) career-form submissions flowing into the ATS — Harish confirmed this is already live**, Chhaya accepted — no work needed. **(b) Pushing the JD from an MRF out to the AAPNA website** — this is a **new, separate ask** that fell out of the same discussion, **parked** for a later phase (different domain, unknown backend). Do not conflate (a) and (b): (a) is done, (b) is a fresh, unscoped, low-priority item.

---

## Note — Evalground & closure definitions
- **Evalground API:** paid add-on; **not used.** Stage 2 = CSV import only (Q1).
- **Closure definitions — ✅ confirmed by RT, 2026-07-13 (with Q12):**
  - **Candidate Withdrawn** — candidate voluntarily exits at **any** stage before joining (e.g., took another offer, changed mind).
  - **Backed Out** — candidate **accepted the offer**, then reneged **before** the join date.
  - **Did Not Join** — candidate accepted, join date passed, **no-show** with no prior notice.

---

## Answer sheet

| Q | Answer | Answered by | Date |
|---|--------|-------------|------|
| Q1 | Email = key; >1 row/candidate possible; one file (GA+Tech); non-IT = GA+English, IT = role-specific by Role/MRF; via Evalground → Outlook. **2026-07-14: two import mechanisms confirmed (bulk CSV + single via Outlook); retake overwrites only the score; Section 1/2/3 labels; bulk mapping approach still owed. ✅ Sample files received (bulk CSV + single result report).** **2026-07-20: ✅ format verified + mapping decided — AI-suggested section→skill mapping from test title, RT confirms once per batch; single-result path redesigned as automatic shared-mailbox polling (`outlookReader.service.js`), not manual upload. Full plan: [07-EVALGROUND-IMPORT-PLAN.md](07-EVALGROUND-IMPORT-PLAN.md)** | RT (annotated PDF + 2026-07-14 call) + Harish (2026-07-20 verification) | 2026-07-13 / 2026-07-14 / 2026-07-20 |
| Q2 | Closed — paid API not used; CSV import only | Harish | 2026-07-09 |
| Q3 | (a) Record-only; approval = yes + reminder nudge; no validity; no version tracking. **2026-07-14: letter file storage dropped entirely — status/stage only** | RT (annotated PDF + 2026-07-14 call) | 2026-07-13 / 2026-07-14 |
| Q4 | ⚠️ **CONTRADICTED 2026-07-14** — written answer: Zeko bands per role; call answer: flat 50% + cheat-probability gate. Needs written confirmation of which is real. Evalground pass = 50% both (unaffected) | RT (annotated PDF); contradiction from 2026-07-14 call | 2026-07-13 / 2026-07-14 |
| Q5 | (b) Status-only, information only, no figures; no offer/doc-collection mails to vendor (shape → Q29, still open) | RT (annotated PDF) | 2026-07-13 |
| Q6 | Both modes (interviewer-fixed first); free/busy = yes | RT (annotated PDF) | 2026-07-13 |
| Q7 | Candidate & interviewer 30 min before. **2026-07-14: real feedback cadence confirmed — ~1h after interview, then every 2 days to day 6, final reminder, stop ~day 10 (closes Q27)** | RT (annotated PDF + 2026-07-14 call) | 2026-07-13 / 2026-07-14 |
| Q8 | Same list all roles, template to be given (pending). **2026-07-14: retention clarified — never delete; SharePoint archive once a threshold is set (threshold still owed)** | RT (annotated PDF + 2026-07-14 call) | 2026-07-13 / 2026-07-14 |
| Q9 | Recruiter-only reschedules; no auto-Hold — recruiter decides; expired Zeko links = "window missed" | RT (annotated PDF) | 2026-07-13 |
| Q10 | Manual only — no automated Hold review/close | RT (annotated PDF) | 2026-07-13 |
| Q11 | 6 months; differs by stage/reason; from Stage 1 (Zeko HR) onwards | RT (annotated PDF) | 2026-07-13 |
| Q12 | Confirmed — close 90 days after Joined; closure definitions ratified | RT (annotated PDF) | 2026-07-13 |
| Q13 | Two concurrent MRF journeys allowed (matching MRF/JD). **2026-07-14: no automated conflict logic — RT decides manually, manual pause/stop action only (closes Q25); Q24 shared-assessments still open; non-negotiable whole-DB skill search requirement added** | RT (annotated PDF + 2026-07-14 call) | 2026-07-13 / 2026-07-14 |
| Q14 | Recruiter enters client contact later; system generates nothing for client; fully manual | RT (annotated PDF) | 2026-07-13 |
| Q15 | Default accepted — no auto-suggestion; HR decides from AI scores | RT (annotated PDF) | 2026-07-13 |
| Q16 | **OPEN** (IT) — grant must now include `Schedule.Read.All`/`Calendars.Read` per Q6 | — | — |
| Q17 | Closed — Phase 2.1 is live; no UAT gate needed, M0 complete | Product owner | 2026-07-14 |
| Q18 | Same card all rounds (technical/CEO); template received 2026-07-14 — HR Round has its own card variant | RT + template | 2026-07-14 |
| Q19 | Stage 0 taxonomy everywhere + free-text "Other reasons". **2026-07-14: UI must show the typed value, never the word "Other"; custom statuses mainly needed at Shortlisted + Offer stages** | RT (annotated PDF + 2026-07-14 call) | 2026-07-13 / 2026-07-14 |
| Q20 | **Scoped 2026-07-14** — confirmed wanted; use cases named; RT (Naveen+Chhaya+Sahil) now owns delivering the requirements doc | RT (2026-07-14 call) | 2026-07-14 |
| Q21 | ✅ **Answered 2026-07-14** — legacy/backup data, NOT a live DB; two-directional (one-time import + ongoing export/backup); driven by a prior ATS's lost backup. Schema-mismatch feasibility (Harish) and Access table format (Chhaya) still owed | RT (2026-07-14 call) | 2026-07-14 |
| Q22 | ✅ **Mostly closed 2026-07-14** — (a) candidate-intake-to-ATS already live, accepted; (b) JD-push-to-website is a new, separate, parked ask | RT (2026-07-14 call) | 2026-07-14 |
| Q23 | Journey B continues; cooling-off blocks new journeys only | Product owner (in-house) | 2026-07-13 |
| Q24 | **OPEN** — shared assessments across concurrent journeys; **not addressed on the 2026-07-14 call** | — | — |
| Q25 | ✅ **Closed 2026-07-14** — no automated collision logic; RT decides manually; system provides a manual pause/stop action (see Q13) | RT (2026-07-14 call) | 2026-07-14 |
| Q26 | Recruiter approves, in-app; skippable in exceptions; daily nudge | Product owner (in-house) | 2026-07-13 |
| Q27 | ✅ **Closed 2026-07-14** — real cadence confirmed (see Q7); supersedes the proposed cap-at-5 | RT (2026-07-14 call) | 2026-07-14 |
| Q28 | 30-min-only candidate reminder is intentional | Product owner (in-house) | 2026-07-13 |
| Q29 | **OPEN** — vendor: status-only line vs nothing at offer/doc stages; **never discussed on the 2026-07-14 call** | — | — |
| Q30 | Future Prospect visible on Screening page; re-shortlistable; no cooling-off | Product owner (in-house) | 2026-07-13 |
| Q31 | Interviewer resolves slot conflicts by updating published slots | Product owner (in-house) | 2026-07-13 |
| Q32 | Nothing is auto-decided for candidates stranded when an MRF fills; manual only. Decided + shipped 2026-08-07, given a Q-number 2026-08-26. ⚠️ **RT was never told — confirmation owed (§D2)** | Product owner (in-house) | 2026-08-07 / filed 2026-08-26 |
| Q33 | **OPEN** — is the Q13/Q25 manual pause/stop action still wanted? Never built; `is_paused` is read-only everywhere | — | — |
| Q34 | **OPEN** — is a business-cancelled requisition a real case? No manual MRF close, no closure reason, no journey re-open | — | — |
| — | ⚠️ **Sign-off of docs 01/02 — REVERTED 2026-07-14.** Was incorrectly marked received; a real written sign-off is still owed (see §E) | — | — |
| — | 🚨 **Zeko API capability validation — UNASSIGNED.** Single biggest schedule risk; needs an owner | — | — |

---

## C. Open items / follow-ups

*(Renumbered 2026-07-14 after the meeting — many items closed, several new ones surfaced. Cross-references elsewhere in this doc use descriptive text, not item numbers, so they survive renumbering.)*

| # | Item | Owner | Blocks |
|---|------|-------|--------|
| 1 | ~~Sample Evalground CSV~~ ✅ **Received 2026-07-14, verification closed 2026-07-20** — both bulk CSV (Naveen) and single-result Outlook report (Chhaya) shared in chat; format verified against the Section 1/2/3 design, findings + full plan in [07-EVALGROUND-IMPORT-PLAN.md](07-EVALGROUND-IMPORT-PLAN.md) | Harish (verify) ✅ | closed |
| 2 | ~~Harish's scorecard template~~ ✅ **Received 2026-07-14** ("Interview Evaluation Format V2.xlsx") — structure baked into M3 | — | closed |
| 3 | ~~Bulk Evalground CSV: section→skill mapping approach~~ ✅ **Decided 2026-07-20** — AI-suggested from the test title, RT confirms once per import batch (per test-name cluster), never per row; single-candidate path reuses the same batch-confirmed mapping. See [07-EVALGROUND-IMPORT-PLAN.md](07-EVALGROUND-IMPORT-PLAN.md) §2 | Harish ✅ | closed |
| 4 | ~~Document checklist template~~ ✅ **Received 2026-07-14** (Chhaya's email text — see Q8) — but it's **narrower than the earlier assumed default** (payslips + address + one govt ID; no education certs/experience letters mentioned) — confirm before finalizing M4 seed data | RT (confirm the narrower scope) | M4 seed data |
| 5 | ~~Q8 retention~~ ✅ **Clarified 2026-07-14** (never delete) — but the **SharePoint archival threshold is still unset** | Harish (propose a threshold) | M4 archive job |
| 6 | Q16 Graph grant: `Calendars.ReadWrite` + `Schedule.Read.All`/`Calendars.Read` (free/busy confirmed by Q6) | IT | M3 scheduling/reminders/scorecard build |
| 7 | ~~Q17 UAT slot~~ ✅ **Closed 2026-07-14** — Phase 2.1 is live, M0 complete | — | closed |
| 8 | 🚨 **Zeko API capability validation** (does it actually expose score, cheat probability, full report, recording?) — **said as an assumption at least four times on the call, and no one was assigned to check it.** Single biggest schedule risk in Phase 3 | **Unassigned — needs an owner today** | M3 Zeko auto-advance/report/recording design entirely |
| 9 | **Q4/B2 contradiction:** written answer said per-role score bands; the 2026-07-14 call produced a flat 50% + cheat-probability gate instead. These are different systems — confirm which is real, in writing | RT | M3 Zeko auto-advance build (also depends on item 8) |
| 10 | ~~Evalground multi-row rule~~ ✅ **Confirmed 2026-07-14** — retake overwrites only the score, latest wins | — | closed |
| 11 | Server/storage capacity — how much data can the current system hold | Harish (checking with Pankaj + IT) → revert to Chhaya | M4 document-upload scope (may force a resumes-only fallback) |
| 12 | MS Access schema-mismatch feasibility (ATS has far more columns than the Excel format) | Harish | MS Access export/import design |
| 13 | MS Access table format | Chhaya | MS Access export/import design |
| 14 | Final status list for every stage (esp. Shortlisted + Final/Offer, ~7–8 statuses) | Naveen | Custom-status seed data (M1) |
| 15 | HR pre-screening report format + Functional test report format | Chhaya | Full Zeko report display (M3, also depends on item 8) |
| 16 | WhatsApp requirements document (tool, plan, cost, message templates, volume) | RT (Naveen + Chhaya + Sahil) | Our WhatsApp exception plan doc |
| 17 | ~~Q21 MS Access direction~~ ✅ **Answered 2026-07-14** (two-directional: one-time import + ongoing export/backup) — remaining feasibility work is items 12/13 | — | closed |
| 18 | ~~Q22(a) Career-page candidate intake~~ ✅ **Already live**, confirmed 2026-07-14 | — | closed |
| 19 | Q22(b) Career-page **JD-push to the website** — new, separate ask, no owner assigned yet | Parked | Later phase, low priority |
| 20 | Q24: shared assessments across concurrent journeys — sit tests once or once per journey? Not addressed 2026-07-14 | RT | Concurrent-journey test/email dedup logic |
| 21 | Q29: vendor visibility at Offer/Document stages — bare status line vs nothing at all. **Never discussed on the 2026-07-14 call** — do not assume it's resolved | RT | M4/M5 vendor email suppression rule |
| 22 | ~~Formal sign-off of docs 01/02~~ ⚠️ **REVERTED 2026-07-14** — was incorrectly marked received; a real **written** sign-off is still owed | Harish → RT | M1 start (substance already unblocked) |

---

## E. Formal sign-off — ⚠️ CORRECTION: NOT received (updated 2026-07-14)

**Earlier on 2026-07-14 this section incorrectly recorded docs 01 and 02 as formally signed off**, based on a paraphrase ("given by HR") of Harish's ask: *"Please give a formal go-ahead on the two Phase 3 documents already shared — Process Understanding and Business Design (Tracker screens/behavior). Tracker development starts on this sign-off; everything else can follow in parallel."*

**That was wrong.** Per the same-day meeting (§3, Gap #2 in [MEETING-NOTES-2026-07-14.md](MEETING-NOTES-2026-07-14.md)), Chhaya's actual closest words on the call were *"let's complete the flow… keep us posted once the structure is ready"* — **that is not a go-ahead.** If Module 1 development was gated on a real sign-off, **it is still gated.**

- **Status: sign-off NOT received.** All of M1's policy inputs are answered (see §0 gate table in [03-DEVELOPMENT-PLAN.md](03-DEVELOPMENT-PLAN.md)) — the sign-off itself is the only missing piece.
- **Action item:** Harish requests it **explicitly, in writing**, in the consolidated summary email to RT (his own action item #1 from the 2026-07-14 call).
- **Q16 (Microsoft Graph calendar permission) is tracked separately with IT, not RT** — still pending, to be raised with IT next; it remains the sole gate on the Module 3 scheduling/reminder/scorecard build (independent of the M1 sign-off question).

---

## D. Exception cases from the loophole pass (2026-07-13)

New edge cases surfaced by RT's answers. Split into decisions already taken in-house (RT is informed, not asked) and questions that still need RT.

### D1. Decided internally (product owner, 2026-07-13)

- **Q23. Cooling-off × concurrent journeys (Q11 vs Q13):** a rejection in journey A does **not** stop an active journey B. The 6-month cooling-off only blocks **new** journey creation.
- **Q26. Offer approval details (Q3):** the **recruiter approves, in-app**. Offers are shared **offline** and recorded in the ATS (record-only). Recording "offer shared" without the approval step is allowed for exceptional cases (soft gate). Nudge cadence: **daily until approved** (default).
- **Q28. 30-min-only candidate reminder (Q7):** **intentional** — the calendar invite sent at scheduling time is the advance notice; no day-before reminder.
- **Q30. Future Prospect semantics:** parked-but-retrievable — Future Prospect candidates **remain visible on the Screening page** (matching existing behavior) and can be re-shortlisted into a new MRF. Cooling-off does **not** apply to them (they were not rejected).
- **Q31. Self-scheduling slot conflicts (Q6):** the **interviewer resolves conflicts by updating/overwriting their published time slots**. Slot handling stays simple: first-come holds a slot; the interviewer can edit slots at any time.
- **Q32. Candidates stranded when their MRF fills (Q10/Q13, filed 2026-08-26):** when `closeMrfIfFilled()` fills a requisition, other candidates may still be mid-journey against it. **Nothing is auto-decided about them** — no auto-close, no auto-rejection email, no bulk action. The system's only job is to *stop being silent*: the board shows an orange "Role filled" tag on each affected card, and the stranded count is folded into the existing "Requisition closed" notification. Auto-closing them would silently end real applications and fire rejection emails, and is hard to undo now that requisitions are re-openable. Consistent with Q10 ("manual only — no auto-close") and Q13/Q25 ("no automated conflict logic — RT decides manually"). **Origin:** this decision was taken and implemented on 2026-08-07 but recorded only as an unnumbered changelog section — [CHANGES-2026-08-07-candidate-pipeline-fixes.md](../changelog/CHANGES-2026-08-07-candidate-pipeline-fixes.md) §14. Given a Q-number on 2026-08-26 per [PHASE3-CLOSURE-AUDIT-2026-08-26.md](../PHASE3-CLOSURE-AUDIT-2026-08-26.md) §2.5. **RT was never told — see D2 below.**

### D2. Still to ask RT before development

*(Q25 and Q27 were answered on the 2026-07-14 call and moved into Q13 and Q7 above respectively. Q24 and Q29 remain open — the call notes are explicit that neither came up.)*

- **Q24. Shared assessments across concurrent journeys (Q13):** does a candidate on two MRFs sit Zeko HR / Evalground / Zeko Functional **once** (result reused for both journeys) or **once per journey**? Without a rule, the candidate receives duplicate test invites and duplicate outcome emails. **Not addressed on the 2026-07-14 call — still fully open.**
- **Q29. Vendor suppression scope (Q5):** at the **Offer** and **Document Collection** stages, does the vendor receive a bare status-only line ("Offer shared with candidate on <date>") or **nothing at all**? Your answer supports both readings. **This fell off the agenda entirely on the 2026-07-14 call — still fully open; do not let it look resolved by proximity to the other vendor decisions that were confirmed that day.**

*(Added 2026-08-26 from the closure audit — [PHASE3-CLOSURE-AUDIT-2026-08-26.md](../PHASE3-CLOSURE-AUDIT-2026-08-26.md) §7.)*

- **Q32 confirmation — stranded candidates (Q10/Q13):** the decision above was taken in-house on 2026-08-07 and shipped, but **there is no record that RT was ever told.** Confirm RT accepts that when a role fills, the other candidates' journeys stay open and untouched until a recruiter acts on each one — and that the "Role filled" tag plus one notification is a sufficient signal. If RT expects the system to do more, that is new work, not a bug fix.
- **Q33. Is the Q13/Q25 pause/stop action still wanted?** Q25 closed on 2026-07-14 with *"the system's only job is to provide a manual action to pause/stop the other journey's status."* **It was never built** — `is_paused` exists in the schema, is read onto every card and exported to CSV, and **nothing anywhere writes it**; there is no pause/resume route or service. Given the Offer round went record-only on 2026-08-25, confirm the action is still wanted before it is built.
- **Q34. Is a business-cancelled requisition a real case?** An MRF cancelled by the business — budget pulled, role withdrawn, hired externally — **has no representation at all today**: there is no manual close endpoint, the MRF status `Select` is disabled, fill state is written only by the automatic offer-acceptance path, and there is no closure-reason column anywhere on `rpa_mrf` (so even the automatic closure records *when*, never *why*). If this is a real case it needs both an action and a reason field, neither of which exists. **Mirror gap:** there is no journey **re-open** either — `assertJourneyOpen` tells the user *"Reopen it before you…"*, naming an action the system cannot perform.

### Accepted-risk confirmations (no answer needed unless RT objects)

- Hold is **manual-only** (Q10), so the On-Hold aging view is the only guard against candidates rotting on Hold (residual of loophole L1).
- No-show handling is fully manual (Q9) — statuses are recorded, consequences are the recruiter's call (residual of L4).
- Evalground **retakes / multiple rows: RT-confirmed 2026-07-14** — a retake overwrites only the score on the existing row (latest wins); this is no longer just our assumed default.
- **Interviewer replacement mid-round** (interviewer leaves/declines): handled as cancel + reschedule, recruiter-triggered — no automated reassignment.
- ~~**Withdrawing a candidate auto-cancels** their pending calendar invites and scheduled reminders.~~
  > 🚨 **NOT BUILT — flagged 2026-08-26.** This was recorded as settled and never implemented.
  > `setFinalOutcome()` closes the document token, freezes the vendor lock and re-opens the MRF,
  > but **never touches `rpa_interview_schedule` and never cancels the Graph/Teams event** —
  > though `cancelInterviewRound()` already exists. A withdrawn or rejected candidate keeps a
  > live Teams booking and still receives the 30-minute reminder mail, because
  > `interviewReminder.js` has no `final_outcome` guard either. See
  > [PHASE3-CLOSURE-AUDIT-2026-08-26.md](../PHASE3-CLOSURE-AUDIT-2026-08-26.md) §2.2 and §2.3 for
  > the fix. **This is a commitment to RT that is currently unmet.**
