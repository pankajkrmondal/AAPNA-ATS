# Referral candidates — a short guide for recruiters

One page. Please read the two rules in §4 — they are the only part the system cannot protect you on.

---

## 1. What this is for

When an AAPNA employee refers someone, that matters at the final decision. Sanghamitra put it plainly:

> "When it comes to me, we always give preference to the referral person… but the interviewers and the whole
> process are unaware that it is a referral person."

So the ATS now records it, shows it to **you**, and hides it from **everyone conducting an interview** — so
their assessment stays unbiased.

---

## 2. How to mark a referral

**Search Candidate → find the person → Edit → the REFERRAL section.**

1. Tick **"This candidate was referred by an employee"**.
2. Type **who referred them** — this is required. A referral with no name behind it cannot be checked later.
   Start typing and the box offers names already used; **pick the existing spelling** if it is there, so the
   same person is not recorded four different ways.
3. Add a note if it helps ("ex-colleague of Anuj, spoke to him directly"). Optional.
4. **Save referral.**

You can mark someone at any time — when their CV arrives, or later when you find out. You do not have to wait
until you shortlist them.

---

## 3. Where you will see it

A green **Referral** chip appears on:

- Search Candidate — in the list
- **Candidate Screening — in the results**, so you see it *while deciding whether to shortlist*
- the Candidate Pipeline board
- the pipeline drawer, which also shows **who** referred them

Interviewers see none of this — not on their scorecard, not in their invite, not in a candidate pack.

---

## 4. ⚠️ Two rules the system cannot enforce for you

**1. Never write the referral on the CV file itself.**

When you download a candidate pack to send an external interviewer, their **résumé travels inside it exactly
as uploaded**. The system checks everything it writes, but it does not — and cannot sensibly — read inside the
CV document. If somebody has typed "Referred by Anuj" onto that file, it goes straight to the interviewer and
nothing will stop it.

**2. Stop putting it in the "Job Source" field.**

That is where referrals used to be recorded, and it is shown on the Candidate Screening detail panel. Use the
tick-box instead. If you already have candidates with "Referral – …" in Job Source, IT can produce a list so
you can convert them (`npm run referral:jobsource-scan`).

---

## 5. Removing a referral

**Only an admin can remove one**, and they must type a reason.

If you marked someone by mistake, ask an administrator. You will see the **Remove referral** button greyed out
— that is expected, not a fault.

The reason is not bureaucracy: a referral affects who gets hired, so if one is ever taken off a candidate, the
record has to say who did it and why.

---

## 6. Everything is logged

Every mark, change and removal is recorded with **your name, the date, and the referrer's name**. Administrators
can view and export this from **Admin Portal → Referral Log**.

This is not a check on you — it is what makes the flag trustworthy when it decides a close call between two
shortlisted candidates.

---

## 7. Questions

| | |
|---|---|
| Can another recruiter see referrals I marked? | Yes. All recruiters and admins see the flag. |
| Can a vendor see it? | No. |
| Can the interviewer see it? | **No** — that is the whole point. |
| Can I change the referrer's name after saving? | Yes, and the change is logged. |
| The candidate told me they were referred — should I mark it? | Only once you have confirmed it with the employee. A candidate has an obvious reason to claim a referral. |

Full technical detail: [REFERRAL-CANDIDATE-PLAN.md](../REFERRAL-CANDIDATE-PLAN.md).
