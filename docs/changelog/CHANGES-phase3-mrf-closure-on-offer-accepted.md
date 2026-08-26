# Phase 3 — Close the MRF once its openings are filled

**Date:** 2026-07-30 · **Module:** M5 (offer) → MRF lifecycle

> **Superseded in part, 2026-08-26.** The *mechanism* described below was replaced on
> 2026-08-11 — see [CHANGES-2026-08-07-candidate-pipeline-fixes.md](CHANGES-2026-08-07-candidate-pipeline-fixes.md)
> §15, and [PHASE3-CLOSURE-AUDIT-2026-08-26.md](../PHASE3-CLOSURE-AUDIT-2026-08-26.md) §3 for the
> as-built state. The counting rule, the `VACATING_OUTCOMES` exclusion, the never-throws guarantee, the
> `mrf_id = null` null-safety, and the Redis + `mrf:closed` broadcast are all still accurate.
> Three things are not:
>
> - **Fill state is `rpa_mrf.filled_at`, not `approval_status`.** Writing `'closed'` to
>   `approval_status` (and mirroring it onto `rpa_mrf_jd_send.mrfstatus`) destroyed the
>   approval + workflow state it overwrote. `filled_at` is a dedicated nullable column that
>   never clobbers anything; `isMrfFilled()` (`config/pipelineStages.js:200`) is the only
>   reader. `LEGACY_MRF_CLOSED_STATUS` survives solely to recognise pre-migration rows.
> - **"Reopening is therefore a manual DB update today" is false.** `reopenMrfIfUnfilled()`
>   is called automatically from both vacating doors — `offer.service.js:362` (an acceptance
>   amended down) and `pipeline.service.js:1038` (a journey closed on a vacating outcome).
> - **The verification steps at the end check the wrong columns.** Assert `filled_at`, not
>   `approval_status` / `mrfstatus` — see `src/tests/integration/crossModuleE2E.test.js:166`.

## Why

Nothing ever closed a requisition. Once an MRF was approved it stayed in the JD
filtering dropdown forever, so recruiters kept seeing — and could keep
shortlisting against — a role that was already filled. There was no notion of a
closed MRF anywhere: `rpa_mrf.approval_status` only ever held
`pending` / `approved` / `rejected` (plus the legacy `waiting` / `completed`),
and no code counted hires against a requisition.

## What changed

### Closure fires on offer acceptance, but only when the last opening is filled

`backend/src/services/mrfClosure.service.js` (new) — `closeMrfIfFilled(mrfId)`
counts accepted offers for the MRF and closes it only when that count reaches
`rpa_mrf.number_of_positions`. A 1-opening requisition closes on the first
acceptance; a 3-opening one stays open (and stays in the dropdown, which
literally reads *"(3 openings)"*) until all three are filled. An MRF with no
stated count is treated as one opening.

Called from `recordCandidateDecision()` in `offer.service.js` when the decision
is `accepted`. It never throws — a closure problem must not undo the acceptance
that was just recorded — and is a clean no-op for journeys with no MRF
(keyword shortlists carry `mrf_id = null`).

**An acceptance only holds an opening while the hire is still on.** Journeys
later closed as `backed_out`, `did_not_join`, `joined_and_left` or
`candidate_withdrawn` are excluded from the count, so a candidate who never
turned up frees their seat instead of shutting the requisition permanently.

### Recorded on the status columns that already exist

No new columns and no DDL. Closure writes `'closed'` to both:

- `rpa_mrf.approval_status`
- `rpa_mrf_jd_send.mrfstatus` — the New MRF Request row (mirrored via the loose
  `mrf_id` integer; legitimately affects zero rows for an MRF raised outside
  that flow)

Setting `rpa_mrf.approval_status = 'closed'` removes the role from JD filtering
**everywhere for free**, with no new filters: `getApprovedRoles()`
(`screening.service.js`) whitelists only `approved` / `completed`, which feeds
the Candidate Screening dropdown, the public Missing-JD form, the Dashboard role
filter and the shortlist decision modal. The Dashboard "Active MRFs" tile counts
only `pending` / `waiting` / `approved`, so it self-corrects too.

### Caches invalidated

The roles dropdown is cached client-side with `staleTime: Infinity`, so without
a nudge an open page keeps offering a filled role:

- `backend` deletes the Redis `screening:role:<id>` entry and broadcasts a new
  `mrf:closed` socket event.
- `frontend/src/hooks/useScreeningData.js` — `useApprovedRoles()` listens for
  `mrf:closed` and invalidates the roles query plus that role's cached search.

### UI

`frontend/src/pages/MRF.jsx` — a **Closed** filter tab, a `CLOSED` raise badge, a
`CLOSED — FILLED` approval badge, and a *"Closed — all openings filled"* option
in the (read-only) status select.

## Files

New: `backend/src/services/mrfClosure.service.js`
Changed: `backend/src/services/offer.service.js`,
`frontend/src/hooks/useScreeningData.js`, `frontend/src/pages/MRF.jsx`

## Notes / follow-ups

- `approval_status` stays deliberately read-only through the MRF API, so
  closure is an internal write only — recruiters cannot close or reopen a
  requisition by editing the form. **Reopening is therefore a manual DB update
  today**; if RT wants it in-app it needs its own endpoint.
- `getApprovedRoles()` uses `DISTINCT ON (position_hiring_for)`. Closing the
  newest MRF for a title will surface the next-newest *open* MRF with the same
  title, which is the correct behaviour — but worth knowing.
- `searchRoleCandidates(mrfId)` still has no `approval_status` check, so a
  stale/bookmarked role id can search a closed MRF directly. The dropdown no
  longer offers it; tighten the endpoint if that matters.

## Verification

1. Find an approved MRF with `number_of_positions = 1`, take a candidate on it
   through to **Record offer shared → Mark Accepted**.
2. Confirm `rpa_mrf.approval_status` and the linked `rpa_mrf_jd_send.mrfstatus`
   both read `closed`, and an audit note *"Requisition closed — all 1
   opening(s) filled"* is on the journey.
3. Confirm the role disappears from Candidate Screening's JD dropdown — with the
   page already open, i.e. via the `mrf:closed` broadcast, not a refresh.
4. Repeat on a 3-opening MRF: the first two acceptances must **not** close it.
5. Close one of those accepted journeys as `backed_out` and confirm the seat is
   released (a further acceptance is needed to close the MRF).
