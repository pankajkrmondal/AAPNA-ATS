# Screening & Email Changes — Session Log

Scope: fixing shortlist/status candidate emails on the Candidate Screening and
Analytics pages, branding the email templates, and surfacing real failure reasons.
Environment: local **development** (`NODE_ENV=development`), so all mail is
redirected to `EMAIL_STAGING_RECIPIENTS` (internal test inbox) by design.

---

## 1. Shortlist emails were never sent (root cause)

**Symptom:** Shortlisting from JD filtering and keyword filtering did not email candidates.

**Root cause:** `shortlistCandidates()` sent Microsoft Graph `sendMail` from the
logged-in recruiter's personal mailbox (`user.email`). The tenant AppOnly
Application Access Policy rejects that with `ErrorAccessDenied`. The inline send
only acted inside `if (res.ok)` with no `else`, so the failure was swallowed
silently, and the UI still reported success.

**Fix** (`backend/src/services/screening.service.js`,
`backend/src/services/emailNotification.service.js`):
- Exported the shared `sendGraphEmail()` and routed the shortlist + interview
  schedule/cancel sends through it.
- Always send from the authorized shared mailbox `config.microsoft.defaultSender`
  (`MS_DEFAULT_SENDER_EMAIL`): `pkmondal@aapnainfotech.com` in dev/staging,
  `recruitment@aapnainfotech.in` in production.
- Removed the now-unused `hrEmail` declarations and the `getAccessToken` import.

## 2. Transient network failures (`UND_ERR_CONNECT_TIMEOUT`)

The dev machine intermittently times out reaching `graph.microsoft.com` (same
flakiness as the Postgres `ConnectionReset` errors). Proven: 3 sends in a row =
2 timeouts then 1 success.

**Fix** (`emailNotification.service.js`): `sendGraphEmail` now retries the send
**up to 3× with backoff** on transient network errors only. A real non-ok HTTP
response is still treated as a hard failure (not retried).

## 3. Analytics page — Rejected / On Hold status emails (new)

`updateCandidateStatus()` previously only updated `pipeline_status`. Now changing
the Screening Status dropdown to **Rejected** or **On Hold** emails the candidate.

- `STATUS_EMAIL_MAP`: `rejected → category 'rejection'`, `on_hold → name
  'Application On Hold'` (the `category` CHECK constraint has no `on_hold` value,
  so the on-hold template is stored under `general` and looked up by name).
- Controller passes `req.user`; email failures never roll back the status change.
- Recipient flow keys `rejection` and `onHold` added to
  `backend/src/config/emailRecipients.js` (dynamic → candidate in prod, test inbox in dev).

## 4. Keyword shortlist FK bug

Keyword searches passed `mrf_id = 0`; `rpa_shortlisted_candidates.mrf_id` is a
nullable FK to `rpa_mrf`, and id 0 doesn't exist → `..._mrf_id_fkey` violation,
so keyword shortlisting failed before any email.

**Fix:** store `mrf_id = NULL` for keyword searches (`mrfId <= 0`) in the conflict
lookup, the insert, and the email-message record.

## 5. Branded email templates

Replaced the plain templates with the AAPNA-branded HTML supplied by the user.
Seeded via the idempotent **`backend/prisma/seed-email-templates.js`** (run once;
supersedes the removed `seed-onhold-template.js`):
- **#2 Shortlist Notification** — subject `You're Shortlisted -- Complete Your HR
  AI Interview | AAPNA Infotech`. Uses `{candidate_name}` and `{role_paragraph}`.
- **#4 Rejection — Post Interview** — subject `Update on Your Application - AAPNA
  Infotech`. Uses `{candidate_name}`, `{position}`.
- **#18 Application On Hold** — subject `Application on Hold - AAPNA Infotech`.

### JD vs Keyword paragraph
`compileTemplate` is a plain string replace and can't branch, so the shortlist
service computes `searchType = mrfId > 0 ? 'jd' : 'keyword'` and injects the
correct intro via `{role_paragraph}` (JD names the role + WFH; keyword references
the talent database + WFH).

## 6. No personal recruiter name in emails

Per request, removed `{recruiter_name}` from all candidate-facing templates (#1–5,
#18); every email signs off as **"AAPNA Recruitment Team / AAPNA Infotech"**.

## 7. Show the real failure reason in the UI (no "check server logs")

- New exported helper **`describeEmailError(err)`** (`emailNotification.service.js`)
  maps errors to plain language: connection timeout, access-policy denial, token
  failure, missing candidate address, missing template, else the raw Graph message.
- **Shortlist** returns `{ success, shortlisted, emails_sent, email_failures: [{name,
  email, reason}] }`; `CandidateScreening.jsx` shows an Ant `notification.warning`
  listing the reason(s) and affected candidates.
- **Status** returns `{ ..., email_sent, email_error }`; `Analytics.jsx` shows
  `Status updated, but email not sent: <reason>`.

---

## Files touched
- `backend/src/services/emailNotification.service.js` — export `sendGraphEmail`,
  retry on transient errors, add `describeEmailError`.
- `backend/src/services/screening.service.js` — authorized-mailbox sends, keyword
  FK fix, JD/keyword paragraph, failure collection, status `email_error`.
- `backend/src/controllers/screening.controller.js` — pass `req.user` to status update.
- `backend/src/config/emailRecipients.js` — add `rejection` / `onHold` flow keys.
- `backend/prisma/seed-email-templates.js` — new idempotent branded-template seed.
- `frontend/src/pages/CandidateScreening.jsx` — honest counts + failure reasons.
- `frontend/src/pages/Analytics.jsx` — status email result + failure reason.

## How to apply on another environment
1. `node prisma/seed-email-templates.js` (writes the branded templates).
2. Restart backend. In production, candidate emails go to the real candidate from
   `recruitment@aapnainfotech.in`; in dev/staging they go to the test inbox.

## Known / environmental
- `UND_ERR_CONNECT_TIMEOUT` is a network/VPN issue on the dev box; the retry rides
  over short blips and the reason is now shown to the user.
- Setting Analytics status back to **shortlisted** sends no email (only Rejected /
  On Hold notify).

---

## 8. Analytics page UI polish (modals + tabs)

Visual-only cleanup of the Recruitment Screening Analytics page
(`frontend/src/pages/Analytics.jsx`, `frontend/src/theme/index.css`). No behaviour,
data, or API changes.

- **Tabs**: added `className="screening-tabs"` so the page uses the same rounded
  pill tabs as the Candidate Screening page, and added `.tab-ico` spacing so tab
  icons are no longer glued to their labels.
- **View Candidate modal**: replaced the hard-to-read center-aligned key/value grid
  (~18 duplicated inline-style blocks) with an identity header (avatar + name +
  email + role tag) over a clean left-aligned Ant `Descriptions` table; Top 5 Key
  Skills now render as gold `Tag` chips.
- **Zeko Interview Scheduling modal**: replaced the disabled candidate text input
  with a styled candidate summary card (avatar + name + email).
- **Outlook Email Threads modal**: reduced `.conv-body` min-height (400→140px) so
  short threads no longer leave a large blank area.
- **New CSS**: `.tab-ico`, `.cand-modal-head`, `.cand-modal-name`, `.cand-modal-email`
  added next to the existing `screening-tabs` / `conv-*` blocks, using theme vars.

---

## 9. Analytics refinements — candidate card, Zeko redirect, Outlook modal

Premium/animated UI pass plus the Zeko scheduling fallback.

- **Shared candidate card**: extracted the high-fidelity sectioned profile view from
  the Candidates search/view page into a reusable component
  `frontend/src/components/CandidateDetailCard.jsx` (Personal Information / Education /
  Employment History / Assessment & Interview, identity header with avatar + role tag +
  location, skills as chips). Both `Candidates.jsx` and `Analytics.jsx` now render it, so
  the Analytics "View Candidate" modal matches the search/edit page exactly. Analytics
  maps its raw `rpa_cv` row into the card's normalized shape via `mapCvToCandidate()`
  (replacing the earlier `Descriptions` layout). Removed the dead `SectionHeader`/inline
  block from `Candidates.jsx` and the stale `.cand-modal-*` CSS.
- **Zeko calendar redirect**: the All-Candidates calendar icon no longer opens the
  failure-prone modal — it switches to the **Zeko Interview Schedule** tab, highlights and
  scrolls to the candidate's row (`goToScheduleTab`, `highlightedScheduleId`,
  `rowClassName` + `.row-highlight` pulse). Tooltip updated to "Go to Zeko Interview
  Schedule".
- **Zeko clearer error**: `scheduleInterview()` now wraps the Zeko schedule `fetch` and
  throws a friendly `AppError` ("Could not reach the Zeko interview platform…") on network
  failure instead of a raw "fetch failed".
- **Outlook modal**: fixed the **double close button** (set `closable={false}`, kept one
  styled close), added a gradient mail-icon avatar header, and added entrance animations
  for the modal/message bubbles. CSS: `.cdc-*` card styles, `.row-highlight` keyframes,
  `.conv-modal-avatar`, refreshed `.conv-*` with subtle motion.
- Verified with a full `vite build` (3976 modules, no errors).
