# Candidate Complete Download — 4 decisions we need from HR

**To:** Sanghamitra Roy / Rakhi
**From:** Pankaj — ATS development
**Date:** 2026-09-02
**Status: ANSWERED 2026-09-02.** All seven points decided — see the table below. The questions are kept
underneath as the record of what was asked.

---

## Answers received (2026-09-02)

| # | Question | Decision |
|---|---|---|
| 1 | Format | **ZIP pack** — browser-readable report + Excel + attachments. As recommended. |
| 2 | Candidate phone / email in the file | **Yes**, included by default, with a tick-box to remove. As recommended. |
| 3 | Candidate personal documents (ID, payslips, certificates) | **Opt-in, not excluded.** Off by default; the recruiter consciously ticks a box, **and we record that they did.** *(Differs from our recommendation, which was to exclude them entirely.)* |
| 4 | Interview recordings | **Expiring no-login link, 14 days.** The pack lists which recordings exist and carries a link that dies after 14 days. |
| 5 | Deletion request in the pack | **Yes** — the pack asks the recipient to delete it. This is the only control that exists once the file leaves. Period assumed **30 days**; say if it should differ. |
| 6 | Rejected / closed candidates | **All** — a dossier may be generated regardless of journey state. |
| 7 | Evalground report | **Confirmed.** This feature builds the attachment slot; the upload feature is sequenced immediately after. |

**What changed in the build as a result:** decisions 3 and 4 both add work and both are recorded in
`CANDIDATE-COMPLETE-DOWNLOAD-PLAN.md` — §2 (decisions), §6.5 (the new share-link surface), §8 (audit must
now name which attachment categories were included), §9 (phasing).

---

## What this is about

In the ATS review call on **28 August**, the following was raised:

> *"Chhaya, who's a recruiter, should be able to download all that Pankaj has cleared so far and should be
> able to share with Atul on mail… as a recruiter she should have that provision."*

We are building exactly that: a recruiter opens a candidate in the ATS, clicks **Download**, and gets a
single file they can email to an outside interviewer — someone with no ATS account, who is doing a
one-off Technical 3 or 4 round.

The file will contain: the candidate's profile, the position, every round they have cleared so far and who
decided it, all interviewer scorecards and their consolidated feedback, screening and assessment scores,
the interview history, and the resume.

Before we build it, four things need your decision. **Our recommendation is written against each one — if
you agree with all four, a one-line "all agreed" is enough.**

---

## Question 1 — What format should the file be?

**Our recommendation:** a single ZIP file containing
- a **one-click report** that opens in any web browser (and prints to PDF with Ctrl+P), plus
- the same information as an **Excel file**, plus
- the **resume and reports** as separate openable attachments.

**Why not a single PDF:** a PDF cannot carry the resume, the Zeko report and the Evalground report as files
the interviewer can open and keep. It would flatten them into pictures. The ZIP gives the readable report
*and* the original documents.

**If you prefer a single PDF instead**, say so — it is buildable, we just lose the attachments.

---

## Question 2 — Should the candidate's phone number and email be in the file?

**Our recommendation:** **yes, included by default**, with a tick-box so the recruiter can remove them for a
particular candidate.

**Why:** an external interviewer usually needs to reach the candidate directly to agree a slot.

**If you prefer:** default to *excluded*, and the recruiter ticks to add them. Either way is one setting.

---

## Question 3 — Should the candidate's personal documents ever be included?

This means ID proof, PAN/Aadhaar, payslips, education certificates — the documents we collect from the
candidate at the documentation stage.

**Our recommendation: never included by default.** The recruiter would have to consciously tick a box, and
we would record that they did.

**Our honest view:** an interviewer assessing technical skill has no business seeing a payslip or an ID
proof, and once the file is emailed we cannot take it back. **We would prefer to exclude these entirely** and
remove even the tick-box — please tell us if you agree, or if there is a case where they are needed.

---

## Question 4 — How should interview recordings be handled?

The Technical 1 / Technical 2 Teams recordings cannot go inside the file — one recording is several hundred
MB and the email would not send.

**Our recommendation:** the file lists which recordings exist, and includes a **link that opens without any
login and stops working after a set number of days** (we suggest 14). The external interviewer clicks and
watches; after that the link is dead.

**Alternative:** recordings stay strictly internal, and the file simply says *"recordings exist — ask the
recruiter"*. This is the safer option and is what we will build first regardless.

Please tell us which you want as the end state.

---

## What we are removing from the file no matter what

These are stripped automatically, and we will test that they cannot appear. Flagged here only so there are
no surprises later:

| Removed | Reason |
|---|---|
| Current CTC and expected CTC | Compensation is not an interviewer's concern |
| Vendor / agency name, vendor email, how the candidate was sourced | Sourcing is internal |
| MRF budget range | Commercial |
| Offer details, joining date, offer remarks | Commercial |
| Referral status *(once that feature is built)* | Per your instruction on 28 Aug: interviewers must not know a candidate is a referral |

If any of these should actually stay in, tell us — but our reading of the requirement is that all of them go.

---

## Three smaller questions, whenever convenient

These do not hold up the build.

5. **Deletion request** — should the file carry a line asking the recipient to delete it after the interview,
   and should it name a period (e.g. 30 days)? Once the file leaves, this is the only control we have.
6. **Rejected candidates** — may a recruiter download this for a candidate who was already rejected or
   closed, or only for candidates still in process?
7. **Evalground report** — confirming your point from the call, that the recruiter downloads the report from
   Evalground and uploads it against the candidate in the ATS. We are building the slot for it in this
   feature; the upload itself is the next item after this one.

---

## Two things HR should be aware of, following the decisions

Neither changes the decisions — both are consequences worth someone knowing about.

**1. The recording link is genuinely public for 14 days.** Anyone holding the URL can watch, with no login.
That is what makes it work for an external interviewer, and it is also the risk: a forwarded email, a mail
archive or a compromised inbox exposes the recording for the rest of the window. We will make the link
unguessable, single-recording, revocable at any time from the ATS, and logged on every view — but we cannot
make it require the recipient to prove who they are without reintroducing a login.

**2. It may affect what candidates were told.** Candidates are notified that their interview is recorded and
that it is reviewed internally. Sharing a recording **outside the company** — even briefly, even to a
contracted interviewer — is a step beyond that notice. We would suggest the candidate-facing wording be
widened to cover it. Flagging it for HR to decide; it is not a development question.
