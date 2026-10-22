# Placement Vendor Process — Pre-Push Audit

**Date:** 2026-08-13 · **Module:** M6 follow-up · **Status:** issues logged, **not yet fixed**

## Why

Pre-push check on the staged M6 vendor changes (90-day lock, dual notification,
isolation hardening). The 160-test unit suite (`npm run test:unit`) passes clean —
it covers the pure guard functions (`vendorLock.js`, `vendorScope.js`, the
per-stage disclosure table) in isolation. This pass instead read the call sites
that wire those functions together and checked them against the behaviour
[`VENDOR_PROCESS.md`](../reference/VENDOR_PROCESS.md) documents, which is where
all four issues below live — none of them are in a function the unit suite
exercises directly.

## Findings

### 1. Closure notification silently dropped when the journey is on the Documents stage — highest priority

**Where:** `backend/src/services/pipeline.service.js:964-972` calls
`notifyVendor({ eventType: VENDOR_EVENTS.CLOSURE, stageKey: pipeline.current_stage_key, ... })`.
`backend/src/services/vendorNotification.service.js:203-210` checks
`vendorPolicyForStage(effectiveStageKey) === 'never'` and returns `skip(...)`
**before** looking at `eventType` at all.

**Failure scenario:** a candidate is closed (e.g. `backed_out`, rejected) while
`current_stage_key` is still `documents`. The stage policy is `'never'` — correct
for ordinary Documents-stage status emails — but it also swallows the CLOSURE
send. VENDOR_PROCESS.md §18 explicitly says "closure notifies the vendor even
for the outcomes that are silent to the candidate." Right now that's false for
any closure that happens to land on Documents. Nothing logs or surfaces the
skip differently from a routine suppressed stage email, so it fails silently.

**Fix plan:** in `notifyVendor`, only apply the stage-policy `'never'`/`'bare'`
gate to stage-outcome events; let `eventType === VENDOR_EVENTS.CLOSURE` bypass
the stage suppression entirely (closure is a different question — "did this
placement land?" — not a per-stage disclosure). Add a unit test: closing a
journey parked at Documents still produces a sent closure notification.

### 2. JOINED closure can freeze a stale/unrelated vendor's lock permanently

**Where:** `backend/src/services/pipeline.service.js:889-894`. The freeze query
is `where: { id: pipeline.cv_id, VendorEmail: { not: null } }` — it checks that
*a* vendor email is stored on the candidate, not that the lock is currently
live or that it belongs to the vendor who sourced the journey being closed.

**Failure scenario:** Vendor A uploads a candidate; the 90-day lock lapses
before anyone shortlists them (`VendorEmail` stays on the row by design — see
§8). A recruiter later shortlists and hires the same candidate through an
unrelated path. The JOINED freeze fires on `VendorEmail: { not: null }` alone
and stamps `9999-12-31` for Vendor A anyway, permanently misattributing a
placement they had no part in and permanently blocking every other vendor from
ever claiming this candidate.

**Fix plan:** before freezing, resolve `activeVendorFor(cv)` (same helper
`vendorAttributionFor` already uses) and only freeze when it returns a live
owner. Add a unit test: a JOINED closure with an expired lock does not freeze
`VendorEmail`.

### 3. Every vendor notification email greets "Hello partner," instead of the vendor's name

**Where:** `backend/src/services/vendorNotification.service.js:234` reads
`pipelineRow.vendor_name`. `rpa_candidate_pipeline` (`schema.prisma:674-704`)
has no `vendor_name` column — only `vendor_email` — and
`vendorAttributionFor()` (`pipeline.service.js:128-135`) only ever returns
`{ source: 'vendor', vendor_email }`. `pipelineRow.vendor_name` is therefore
always `undefined`, so the seeded templates' `{{vendor_name}}` placeholder
always falls back to the literal string `'partner'`.

**Fix plan:** no schema change needed. In `notifyVendor` (or
`vendorAttributionFor`), resolve the display name at send time from
`rpa_users` by `vendor_email` (first/last name), falling back to `'partner'`
only when that lookup genuinely finds nothing. Add a unit/integration
assertion that a compiled vendor email contains the vendor's actual name for a
known fixture.

### 4. `getVendorDashboard` re-implements vendor scoping instead of using `enforceVendorScope`

**Where:** `backend/src/controllers/vendor.controller.js:109-121` hand-rolls
`const isVendor = (req.user.role || '').toLowerCase() === 'vendor'` and picks
`vendorEmail` off that, instead of calling
`candidateService.enforceVendorScope()` the way `getVendorCandidates` (line
50) does. `enforceVendorScope` compares against `normalizeRole()`
(`config/roles.js:61-63`, which trims **and** lowercases); the dashboard's
inline check only lowercases.

**Failure scenario:** a vendor account whose stored `role` value ever carries
stray whitespace would be correctly scoped everywhere that calls
`enforceVendorScope`, but `getVendorDashboard`'s own check would evaluate
`false`, treat the account as staff, and honor an arbitrary `?vendorEmail=`
query — letting that account view another vendor's dashboard. Independent of
whether that edge case is currently reachable, this is precisely the
"two implementations of the same rule drift apart" failure VENDOR_PROCESS.md
§2 calls out (the `b671236` CSV-export hole), and the doc's own text claims
the dashboard "runs through" `enforceVendorScope`, which as written it does
not.

**Fix plan:** replace the inline `isVendor`/`vendorEmail` resolution in
`getVendorDashboard` with a call to `candidateService.enforceVendorScope()`,
matching `getVendorCandidates`. Delete the now-redundant hand-rolled check.

## Fix order

1. §1 (closure suppressed at Documents) — silent data-integrity/communication
   gap, matches a scenario the doc calls out by name.
2. §2 (stale vendor lock freeze) — permanent, hard-to-reverse misattribution
   once it happens.
3. §4 (`getVendorDashboard` scoping drift) — narrow edge case today, but it's
   the exact class of bug that has bitten this codebase before.
4. §3 (vendor_name always blank) — cosmetic, no functional/security impact.

## Verification

- `npm run test:unit` (backend): 160/160 passing before this audit — unaffected,
  since none of these four issues sit inside the functions those tests call
  directly. Add the four tests named above so future regressions are caught in
  the same suite.
- All four findings were confirmed by reading the cited source lines directly,
  not just by the automated review pass that first flagged them.

## Status

Logged only — **no code changes made in this pass**. Fixes to be implemented
and tracked as a follow-up commit before/at push time.
