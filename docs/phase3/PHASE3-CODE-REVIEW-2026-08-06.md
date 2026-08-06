# Phase 3 — Code Review & Test Report

**Date:** 2026-08-06 · **Scope:** Phase 3 backend + the full frontend `src` tree
**Method:** static review plus **live execution** against a running server on the dev
database (46 runtime checks; all test data removed afterwards)

**Out of scope by instruction:** placement vendor / M6, company scoping (L12), JWT-in-query
(L13), Evalground single-result intake, free/busy, candidate self-scheduling.

---

## 1. Summary

| | Count |
|---|---|
| Defects found across both sessions | **22** |
| Fixed | **19** |
| Open (documented below) | **3 material + 6 minor** |
| Runtime checks executed | **46**, all passing |
| Unit tests | **55**, all passing |

The decisive finding of this session: **executing the code found three real bugs that
reading it did not.** Every one of them sat behind something previously reported as
"verified".

---

## 2. Fixed this session

### 2.1 Scorecard double-submit race — `interviewScorecard.service.js`

**Severity: high.** The `status === 'submitted'` check was a read; the update was not
conditional on it. On a **public, no-login** page a double-click sends two submits that both
pass the check.

Proven live before the fix:

```
concurrent submits : 200 + 200
audit notes written: 2   (expected 1)
notifications sent : 8   (expected 4)
```

One interviewer's feedback arrived twice, and the later payload silently overwrote the
earlier. Fixed with claim-then-act inside the transaction. Retested: `200 + 409`, one audit
note.

### 2.2 Stale-CSV auto-advance pushed candidates through rounds they never sat — `assessmentImport.service.js`

**Severity: high (when `assessment_auto_advance_enabled` is ON; default OFF).**
`setStageOutcome()` resolves the outcome against the journey's **current** stage, not the
stage the CSV describes. Re-importing an older Evalground export for someone since moved to
Tech 1 approved them out of **Tech 1** and advanced them to Tech 2.

Now gated on the journey actually sitting on `assessment` **and** still open. Anything else
records the result and logs why, leaving the decision to a human:

```
candidate at "assessment" -> ALLOWED
candidate at "tech1"      -> SKIPPED (recorded for manual review)
candidate at "offer"      -> SKIPPED
candidate CLOSED          -> SKIPPED
```

### 2.3 Attendance sweep auto-no-showed every staging interview — `jobs/interviewOccurrence.js`

**Severity: high in non-production.** `MS_ATTENDANCE_ENABLED=true` in dev and staging, but
the calendar attendee is the substituted test inbox. Matching on the *real* candidate
address therefore found them absent every single time → interview marked `no_show`,
scorecard withheld, no-show alert sent. Silently, on every booking.

Fixed by matching the address **actually put on the invite**, keeping both ends symmetric.
No-op in production, where nothing is substituted. Pre-existing; not introduced by the M1
hardening work.

### 2.4 Server error messages never reached the user — 14 sites

**Severity: medium, very wide.** The axios interceptor in `services/api.js` rejects a
**flattened** `{status, message, data}` object — there is no `err.response`. Every site
reading `err.response?.data?.message` without an `err.message` fallback silently displayed
its generic string instead.

So these were all being swallowed:

- *"2 open candidates are currently on this stage…"*
- *"Someone else moved this candidate while you were deciding."*
- *"This round already has a scheduled interview. Cancel it first to rebook."*
- *"The interview time is in the past."*

Fixed in `PipelineDrawer`, `PipelineConfigPanel`, `Settings`, `AnalyticsLegacy`,
`CandidateDetail`, `EmailManagement`, `VendorDashboard`. Two of the broken sites were
written in the previous session.

### 2.5 Consolidated feedback now rendered — `PipelineDrawer.jsx`

The API returned it; nothing displayed it. Now heads the scorecard report modal with
low-rated skills called out as concerns. Verified live:
`"2 interviews scored · average 4 · 2× approve"`.

---

## 3. Open findings

### 3.1 Material

| # | Finding | File | Why it matters |
|---|---|---|---|
| **O1** | **Bulk import is one unbounded sequential loop.** Every row does several awaits, and with automation ON each can call `setStageOutcome()` — which sends an email. A 500-row CSV is 500 sequential sends inside one HTTP request. | `assessmentImport.service.js` `commitImport` | Request timeout mid-import leaves a partial import with wrong counts on `rpa_assessment_imports`, and no way to resume. Suggest batching + a background job, or at minimum a row cap with a clear error. |
| **O2** | **The import is not transactional.** Results, legacy `rpa_cv` writebacks, stage outcomes and audit events are written per row with independent try/catch. | same | Documented as best-effort, but combined with O1 a timeout leaves genuinely mixed state. |
| **O3** | **No client-side file validation on the public upload page.** The page tells the candidate "PDF, DOC/DOCX, JPG or PNG, up to 10 MB" but `beforeUpload` returns `false` unconditionally without checking either. | `pages/DocumentUpload.jsx` | Not a security hole — the backend enforces both (multer `fileSize` + `ALLOWED_EXTS`). It is a wasted upload and a confusing failure for a candidate on a phone. Cheap to fix. |

### 3.2 Minor

| # | Finding | File |
|---|---|---|
| O4 | Scorecard submit does not require `occurrence_status === 'held'` at the API level — only `!== 'no_show'`. The UI gates it, a direct POST does not. | `interviewScorecard.service.js` |
| O5 | The audit note and `notify()` after a scorecard submit sit **outside** the transaction. `notify()` never throws, but the event `create` can — 500ing after the card is already submitted. | same |
| O6 | A 409 *"already submitted"* renders as an error rather than the success state. Correct, but confusing after a double-click. | `pages/InterviewScorecard.jsx` |
| O7 | `daysLeft` computes from `invite.deadline_at` with no null guard — a null deadline yields a nonsense day count. | `PipelineDrawer.jsx` assessment segment |
| O8 | Stale docblock: *"The document + offer stages have no sub-state data model yet"*. Both are fully implemented (lines 612+ and 645+). Doc rot from before M4/M5. | `PipelineDrawer.jsx:422` |
| O9 | **The frontend has no working lint setup** — no `eslint.config.js`, no `.eslintrc`, no `lint` script. ESLint 9 is installed but cannot run. The backend has `npm run lint`. | `frontend/` |

### 3.3 Still not wired (backend exists, no UI)

| # | Capability | State |
|---|---|---|
| W1 | `POST /api/email/templates` | Endpoint works and is tested; `EmailManagement.jsx` has no "create template" control. Creating is API-only. |
| W2 | `amend: true` on an offer decision | Endpoint works and is tested; no UI sends it. Amending is API-only. |
| W3 | stage×outcome → email-template mapping | Planned for the config panel, **not built**. Mapping still needs SQL. |

---

## 4. Reviewed and found clean

Checked explicitly, no defect found:

- **No `dangerouslySetInnerHTML` anywhere.** The email body editor uses a `srcDoc` iframe in
  `designMode` — HTML is edited inside a separate document, not injected into the app.
- **No hardcoded hosts or `http://` URLs** outside `services/api.js`.
- **All `.then()` chains have `.catch()`.** Initial grep flagged 11; every one had the catch
  on a following line.
- **No missing React keys** of consequence — the four hits were `.join()` on strings, not
  element arrays.
- **No-show vocabulary matches the backend** exactly (`candidate` | `panel` | `both` |
  `technical`), so auto- and human-recorded no-shows render identically.
- **`notification.service.js`** — `notify()` genuinely never throws; `markRead`/`markAllRead`
  are user-scoped via `updateMany`, so one user cannot mark another's row.
- **`graphAttendance.service.js`** — the decided/undecided/occurred logic is sound;
  `decided:false` correctly falls back to human confirmation on every unreadable path.
- **Concurrent-MRF journeys work as designed.** `rpa_candidate_pipeline` carries two
  *partial* unique indexes — `(cv_id, mrf_id) WHERE mrf_id IS NOT NULL` and `(cv_id) WHERE
  mrf_id IS NULL`. An earlier suspicion that `cv_id` was globally unique was **wrong**; only
  MRF-less journeys are one-per-candidate.

---

## 5. Runtime test results

All executed against a live server, dev database, real Microsoft Graph.

### 5.1 The non-production email rule

The decisive check — reading the calendar event **back from Microsoft Graph** after booking:

```
EVENT SUBJECT: Technical Round 2 — QA-PHASE3 Candidate 3 (QA-PHASE3 Role)
ATTENDEES ON THE REAL OUTLOOK EVENT:
   - n8npankajmondal@gmail.com

candidate on file : qa.phase3.candidate3@example.invalid
RESULT            : SAFE — candidate address is NOT on the invite
```

| Path | Result |
|---|---|
| Outcome / invite / reminder emails | → test inbox, never the candidate |
| Calendar + Teams invite attendees | → test inbox (verified against Graph) |
| Zeko schedule / cancel payload | → substituted (same helper; unit-tested) |
| Vendor cc | dropped in non-prod |
| Closure outcomes (`candidate_withdrawn`) | suppressed by policy, no send |
| Blank `EMAIL_STAGING_RECIPIENTS` | **throws** — fails closed, never falls through |

### 5.2 Stage engine, offers, documents

| Check | Result |
|---|---|
| Two concurrent approvals | 200 + 409 — one advance, **one** email |
| Closing an already-closed journey | 409 |
| Advancing / emailing a closed journey | 409 / 409 |
| `final_outcome_key: "totally_made_up"` | 400 |
| Deactivating a stage with candidates on it | 409, *"2 open candidates are currently on this stage"* |
| Re-deciding an offer without `amend` / with `amend` | 409 / 200 |
| Re-sharing an offer after a decision | decision preserved |
| `POST /templates` — recruiter / admin / duplicate / missing fields | 403 / 201 / 409 / 400 |
| Document token: verify-all → close; reject → reopen | correct both ways |
| Reminder sweep: fresh / backdated / immediate repeat | 0 sent → 1 sent → 0 sent |
| Full Teams round-trip: schedule → reschedule → cancel | event, join URL, meeting id, all clean |
| Past-dated interview / invalid interviewer email | 400 / 400 |
| Unauthenticated `/pipeline` | 401 |

---

## 6. Coverage — what was and was not reviewed

| Area | Depth |
|---|---|
| `pipeline.service.js`, `offer.service.js`, `documentCollection.service.js`, `stageNotification.service.js`, `emailRecipients.js`, `emailNotification.service.js` | Full read, both sessions |
| `interviewScorecard.service.js`, `assessmentImport.service.js`, `notification.service.js`, `graphAttendance.service.js` | Full read this session |
| `interviewOccurrence.js`, `offerSweep.js`, `interviewReminder.js`, `documentReminder.js` | Full read |
| `DocumentUpload.jsx`, `InterviewScorecard.jsx` (public pages) | Full read this session |
| `PipelineDrawer.jsx` (2,708 lines) | **Partial** — error handling, no-show vocabulary, report modal, `buildPipelineSegments` assessment/offer/documents branches. Not line-by-line. |
| Whole `src` tree | Pattern scan only: XSS, hardcoded URLs, promise handling, React keys, storage, `window.location` |
| `CandidateScreening.jsx` (2,557), `AdminDashboard.jsx` (1,366), `MRF.jsx` (1,181), `Candidates.jsx` (1,145) | **Not reviewed** — outside Phase 3 |

---

## 7. Recommended next steps

1. **O1/O2 — bulk import robustness.** The most likely production failure left in Phase 3.
2. **O3 — client-side file validation.** Small change, directly improves the candidate
   experience on a public page.
3. **O9 — restore frontend linting.** Would have caught 2.4 mechanically.
4. **W1–W3 — finish the UI wiring** so the new endpoints are reachable without curl.
5. **Run the remaining formal passes** — the Evalground CSV matrix (you have tested this),
   plus the document/offer end-to-end suite.
6. **Resolve the production email flag.** `.env.production` sets
   `EMAIL_REDIRECT_TO_TEST=true`, so production is redirecting candidate mail to the test
   inbox as well — meaning **no environment currently emails candidates**. Deliberate
   pre-launch switch, or leftover? Every guard keys off this one flag.
