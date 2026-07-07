# Shortlist Email Tracking & Keyword Reload Fixes — Session Log (2026-07-07)

Scope: two issues seen on **production** (`ats.aapnainfotech.com`) in the
Candidate Screening page while shortlisting candidates.

---

## 1. "Shortlisted 1, but 1 email(s) not sent" — `Null constraint violation on the fields: (id)`

**Symptom:** Shortlisting a candidate showed the toast
`Invalid prisma.rpa_email_tracking.create() invocation: Null constraint violation on the fields: (id)`
even though the candidate actually received the email.

**Root cause — prod DB schema drift, not a code bug.** The Prisma schema
declares `rpa_email_tracking.id` as `Int @id @default(autoincrement())`
(`backend/prisma/schema.prisma:453`), so the code correctly omits `id` on
insert. But the two databases differed:

| Database | `id` column default |
|---|---|
| Dev (`recruitmentautomationdb`) | `nextval('rpa_email_tracking_id_seq')` ✔ |
| Prod (`recruitmentautomationdbProd`) | **none** ✘ |

The prod table was created without the auto-increment sequence (this repo has
no Prisma migrations — dev and prod were created independently). Postgres
received an INSERT without `id`, tried NULL, and threw the constraint error.

**Why the toast was misleading:** in `shortlistCandidates()`
(`backend/src/services/screening.service.js:1715-1773`) the Graph send, the
`rpa_email_messages` insert, the `rpa_email_tracking` insert, and the
`email_sent` flag update all share one try/catch. The send succeeded; only the
tracking insert failed, but the catch reported the whole email as "not sent"
and `email_sent` was never set on the shortlist row.

**Fix (applied directly on the prod DB, no code change):**

```sql
CREATE SEQUENCE IF NOT EXISTS rpa_email_tracking_id_seq;
ALTER TABLE rpa_email_tracking
  ALTER COLUMN id SET DEFAULT nextval('rpa_email_tracking_id_seq');
ALTER SEQUENCE rpa_email_tracking_id_seq OWNED BY rpa_email_tracking.id;
SELECT setval('rpa_email_tracking_id_seq', COALESCE((SELECT MAX(id) FROM rpa_email_tracking), 0) + 1, false);
```

**Follow-ups (not yet done):**
- Audit other prod tables for the same drift (compare `information_schema.columns`
  defaults between dev and prod) — likely more tables were hand-created.
- Harden `shortlistCandidates()`: wrap the post-send bookkeeping in its own
  try/catch so a tracking/logging failure is reported as a warning
  ("sent but tracking failed") instead of "email not sent". Otherwise a
  bookkeeping failure leaves `email_sent = false` and the candidate can be
  re-emailed later.

## 2. Keyword tab re-ran the full search after shortlisting

**Symptom:** After shortlisting from the Keyword Filtering tab, the UI showed a
long spinner and reloaded the entire candidate list. Not present before.

**Root cause:** `handleShortlistSelected()` in
`frontend/src/pages/CandidateScreening.jsx` called `form.submit()` after a
successful shortlist, re-executing the **whole keyword search** — embedding
generation, DB scan, reranking, and Gemini insight calls — just to refresh the
"shortlisted" badges. Introduced in commit `73667d7` ("frontend code",
2026-07-01).

**Fix** (`frontend/src/pages/CandidateScreening.jsx`,
`handleShortlistSelected()`): the keyword branch now updates the loaded list
in place instead of re-searching. Shortlisted candidates get
`FinalStatus: 'Stage 0 - Resume Shortlisted'` (drives the row badge) and
`shortlisted_status` (read by the Zeko-assign drawer). The JD tab keeps its
`forceReloadRoleCandidates()` (cached react-query reload) — unchanged.

**Verification:** run a keyword search → select candidates → Shortlist
Selected → badges flip to "shortlisted" instantly with no list reload; list
order and scores unchanged. JD tab flow behaves as before.

**Known behavior (unchanged):** shortlist emails are sent synchronously inside
the shortlist API call, so the "Shortlisting selected candidates..." message
still takes a few seconds per candidate. Moving the send to a background job
would make the action return instantly — proposed, not implemented.
