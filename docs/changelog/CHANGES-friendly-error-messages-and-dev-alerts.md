# Friendly Error Messages & Developer Error Alerts

Date: 2026-07-27

Scope: eliminating raw/technical backend errors (Prisma error text, upstream API error
bodies, AI model errors) reaching end users in the UI, and adding a developer email alert
for backend 5xx failures.

---

## 1. Root cause

The admin login page was showing a raw Prisma error to users:

```
Invalid `prisma.rpa_users.findFirst()` invocation: Timed out fetching a new connection from
the connection pool. More info: http://pris.ly/d/connection-pool (Current connection pool
timeout: 10, connection limit: 8)
```

This is Prisma error code `P2024` (connection pool exhausted). The global error middleware
(`backend/src/middleware/errorHandler.js`) already had a `handlePrismaError()` mapper for
several connection-level Prisma codes, but not P2024 — so it fell through to the raw
message. The frontend's axios interceptor and every page rendering login/API errors just
relay `response.data.message` verbatim by design, so the fix belongs on the backend.

A broader audit (prompted by the same investigation) found two related issues:
- Several other plausible Prisma error codes (P2000, P2010, P2028/P2034, and the wider
  P2xxx family) were equally unmapped and reachable from real endpoints (candidate search,
  uploads, transactional pipeline updates).
- 8 call sites across 3 service files manually built an `AppError`/`AIModelError` by
  interpolating raw internal/upstream error text into the user-facing message (e.g.
  `` `Merge operation failed: ${err.message}` ``). Because `AppError` is always treated as
  "safe to show", these leaked raw technical detail even in real production, independent of
  the Prisma map.
- Staging runs `NODE_ENV=staging`, but `config.isProduction` only matched an exact
  `NODE_ENV === 'production'` string — so ANY currently-unmapped error served full
  dev-mode JSON (raw error object + stack trace) on staging.

## 2. Fix

**`backend/src/middleware/errorHandler.js`** — extended `handlePrismaError()`:
- `P2024` added to the existing connection-level group → "Service temporarily unavailable.
  Please try again later." (503) — the fix for the reported bug.
- New branches: `P2000` (value too long, 400), `P2010` (raw query failed, 500),
  `P2028`/`P2034` (transaction conflict, 409), and a catch-all for any other `P2xxx` code
  (generic message, 400).
- Refactored the middleware to compute a single `finalErr` (instead of a chain of early
  returns) so there's one place to hook the developer alert email before responding.
- On any 5xx (`finalErr.status === 'error'`), fires a fire-and-forget
  `sendBackendErrorAlert()` — never awaited, never allowed to affect the response.

**`backend/src/services/emailNotification.service.js`** — new `sendBackendErrorAlert()`,
following the existing `sendResumeErrorAlert`/`sendRerankApiAlert` pattern: emails the real
error (name/message/code/route/status/truncated stack) to developers, logs to
`rpa_email_log` (`email_type: 'backend_error_alert'`), and never throws. Throttled via an
in-memory cooldown (5 min per error-signature + route) so a sustained outage sends one
alert, not a flood.

**`backend/src/config/emailRecipients.js`** — new `backendErrorAlert` flow
(`hmopuri@aapnainfotech.com, pkmondal@aapnainfotech.com`), added to `NEVER_REDIRECT` so it
always reaches real developer inboxes, including on staging.

**8 raw-message leak sites fixed** (real detail now logged server-side via `logger.error`,
user-facing message replaced with a static safe string):
- `hrUpload.service.js:322,800,866`
- `screening.service.js:697,2441`
- `assessmentInvite.service.js:82`
- `assessmentImport.service.js:108,144`

**`backend/src/config/index.js`** — added `isDevelopment` (`NODE_ENV === 'development'`).
**`errorHandler.js`**'s `sendResponse()` now branches on `!config.isDevelopment` instead of
`config.isProduction`, so the sanitized response is the default for every environment
except an explicit `NODE_ENV=development` opt-in — closing the staging gap for good instead
of relying on an exact string match. Scoped to the HTTP response shape only; server-side log
verbosity and Prisma query logging are unchanged.

## 3. Out of scope

Per-page frontend changes — raw-message passthrough is the deliberate, systemic frontend
convention (`api.js` interceptor + ~19 pages), so fixing the backend's message contract is
the correct leverage point.
