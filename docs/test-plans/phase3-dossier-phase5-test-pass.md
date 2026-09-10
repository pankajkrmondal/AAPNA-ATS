# Phase 5 — Candidate Complete Download: test pass

**Plan:** `docs/phase3/CANDIDATE-COMPLETE-DOWNLOAD-PLAN.md` §10.
**Run:** 2026-09-03, local backend on `http://localhost:5000` against the shared staging database.
**Status:** the automatable half is **done and green**. The half that needs a browser session is listed in §3
with exact steps and expected results.

---

## 1. What passed automatically

| Suite | Result |
|---|---|
| §10.1 unit — `npm run test:unit` (unit folder) | **320 pass, 0 fail** |
| §10.2 the pack — authenticated, against the running server | **17 checks pass** on a real journey (§2a below); 3 need a second account or an opt-in flag |
| §10.2a share links — live HTTP against the running server, no ATS session | **28 checks pass, 0 fail** (§2 below) |
| §10.3 item 4 leak scan — `npm run dossier:leakscan` | **Built and proven both ways**: two real packs clean (exit 0), including a **vendor-sourced** candidate; a planted-leak control → **6 findings, exit 1** |
| Frontend build | **exit 0** |
| Import check on every changed backend module | **clean** — controller, app.js, routes, services |

### 1b. Re-run after the §6.4 pack-size warning landed (2026-09-03)

`packSizeNotice()` + `X-Dossier-Oversize` were added after the first pass. Re-verified: **324 unit tests**
(4 new, for the threshold), frontend build clean, `pipeline.controller.js` and `app.js` still import,
**§10.2a 28/28** unchanged, and all three leak-scan packs behave as before.

**Both verified after the restart, and the run found two real bugs.**

| Found | How | Fix |
|---|---|---|
| **Every dossier download 500'd** | The §10.2 harness re-run: preview fine, download `HTTP 500` | `pipeline.controller.js` used `config.dossier.warnPackBytes` but that file never imported `config`. A `ReferenceError` at REQUEST time, so the module still imported cleanly and the import check passed — only exercising the endpoint caught it. Import added; 19/19 green again |
| **The size warning disabled itself** | Setting `DOSSIER_WARN_PACK_BYTES=10000` and downloading: `X-Dossier-Oversize: 0` | A 12 KB pack rounded to `0` MB — and **0 is falsy**, so the modal's `if (result.oversizeMb)` skipped the warning in the very configuration where it fires hardest. `packSizeNotice()` now floors the reported size at 0.1 MB, with a unit test pinning it |

End-to-end verification of the warning: with the threshold lowered, `X-Dossier-Oversize: 0.1` was returned and
is on the CORS expose-list; with the threshold back at its 20 MB default, the header is absent. `.env` was
restored byte-for-byte (git reports it unchanged).

**Final state: 325 unit tests, §10.2 19/19, §10.2a 28/28, leak scan clean on both real packs and failing
correctly on the planted control.**

---

## 1c. Code review of the module, 2026-09-04 — five defects found and fixed

A review of the whole in-flight change set (~1,800 lines across 21 modified files plus 15 new ones) found five
real bugs that no test had caught, because each lives on a path the tests did not take.

| # | Defect | Why the tests missed it | Fix |
|---|---|---|---|
| 1 | **A discovered Evalground column could leak.** The topic tail is "anything we do not recognise", so a test configured with a column called `Current CTC` or `Mobile` would have that value rendered into a pack sent outside the company. `assertNoForbiddenFields()` cannot help — it checks key *names*, and topics arrive as `{label, value}` data | The real exports' tail is six harmless topic scores | `isSuspectTopicLabel()` refuses to promote a column whose heading looks like pay, contact or identity. The value stays in `raw_row`, which never renders |
| 2 | **A re-import kept the previous attempt's breakdown.** On `score_overwritten` with no parseable breakdown, `detailColumns(null)` returned `{}` — so new scores sat beside the old counts and topic scores, and section 7 printed two inconsistent accounts of one attempt | Every test import had a parseable breakdown | `detailColumns(…, { clearWhenMissing: true })` on the update path clears them, which is what the code's own comment already claimed |
| 3 | **A malformed token 500'd the public route.** The guard checked characters and length, so `------------------------------------` passed it, reached Prisma's `@db.Uuid` parser and threw — a 500 on the one deliberately unauthenticated route, where the friendly "no longer available" page is the entire point | §10.2a tested a real token, a revoked one, an expired one and a well-formed unknown one — never a malformed one | `isShareToken()` checks the real UUID shape, with tests for 36 dashes, bare hex, SQL and script payloads |
| 4 | **A partial share-link failure warned nobody.** `applyRecordingShareLinks()` sets `included = true` as soon as one link mints, and the controller's degraded sweep only looked at `included === false` — so two rounds linked and a third failing produced no `X-Export-Degraded`, while a total failure did. The recruiter sends the pack believing every round is watchable | The test candidate has exactly one recording, so partial failure was unreachable | The controller reads `recordingLinks.degraded` explicitly. Separately, an *unplayable* recording no longer counts as degraded — absence is not failure, the same rule `applyAttachments()` follows |
| 5 | **The size warning contradicted itself.** Only the MB number travelled in the header; the browser hardcoded "about 25 MB" while `warnPackBytes` defaults to 20 — so a 21 MB pack warned it was too big and then named a larger limit. `packSizeNotice().message` was dead code | The warning had only been verified as *present*, not read | The modal quotes no second threshold; the server's message is logged, so a bounced-email report can be matched to the download |

**After the fixes: 331 unit tests pass** (6 new, covering the two new guards), backend syntax clean, frontend
builds. The §10.2 and §10.2a passes should be re-run against a restarted backend before sign-off — findings 2,
3 and 4 change runtime behaviour.

### 1a. §10.2 — run 2026-09-03 against journeys 1396 and 1436

Passed: the preview returns 200 and `assertNoForbiddenFields()` finds nothing in it; the ZIP downloads with a
proper RFC 5987 filename and contains the report, workbook and READ-ME; **all ten sections render**;
`recording_links=1` puts a link in both the report and the workbook and `=0` removes it from both;
**one link per recording, not one per download** (the reuse rule); `rpa_processing_log` and the journey
timeline both carry the download, naming *what* was included; the audit records
`recording_no_login_link(1)` **only** on the downloads that carried links; and — decision #13 — a **closed**
journey (1998, `candidate_withdrawn`) still produces a pack, which states that the application is closed.

Two things this pass corrected, both in the tooling rather than the product:

- The audit check first read the *newest* log row, which was the `recording_links=0` download — so it read as
  a failure when the behaviour was right. Rows #119/#121 (links on) carry the category; #118/#120 (links off)
  do not, which is exactly §8.4's requirement.
- **The leak scan fired six times on the candidate's own name.** The staging candidate is called
  `PIPE14-vendor 1788012949850-944`, and the structural `\bvendor\b` check matched their name in the title,
  header, profile table, workbook and READ-ME. None of it was a leak. The scan now strips the candidate's own
  name (read from the pack's `<title>`) before the *structural* checks, exactly as it already strips the pack's
  own redaction notice — while the case-specific values you pass in are never suppressed. Verified after the
  change: the vendor-sourced pack is clean, and the planted-leak control still produces all six findings.

  This matters beyond test data: in production it would have fired on anyone whose name or employer contains
  "vendor", "budget" or "salary", and a scan that cries wolf is a scan somebody switches off.

**On the vendor-sourced candidate (§10.3 item 5), the redaction held**: `vendorName` ("Phase3 Test Vendor")
and `VendorEmail` were absent from the pack, and `pipeline.source = 'vendor'` never reached it. Note the
staging data has **no CTC values on any candidate** (all null), so the compensation half of the scan has not
yet been exercised against real data — it is proven only against the planted control.

---

## 2. §10.2a in full — recording share links, with no session of any kind

Run against journey **1396** (`SCHED04c 1788012738681-456`), recording **#1** (Technical Round 1, archived).
Three throwaway links were created — live, expired, revoked — exercised over real HTTP, then **deleted**
(0 rows remain). The timeline note the live one wrote was deliberately left: deleting an audit row to tidy up
a test is a worse habit than a line of noise on a test candidate.

| # | Check | Evidence |
|---|---|---|
| 1a | A live link opens with **no session at all** | HTTP 200 |
| 1b | It is a player page, not a 400 MB download | `<video>` present |
| 1c | The expiry is stated to the viewer | "Link expires" on the page |
| 1d | The **candidate is not named** — a forwarded link introduces nobody | no `SCHED04c` / id in the page |
| 1e | No Graph or SharePoint URL in the page | — |
| 1f | Not indexable | `noindex, nofollow, noarchive` |
| 1g | Not cached by any shared proxy | `Cache-Control: private, no-store` |
| 1h | Cannot be framed by another site | `X-Frame-Options: DENY` |
| 2a | The **bytes actually stream** to an unauthenticated caller | **HTTP 206** |
| 2b | Seeking works | `Content-Range: bytes 0-2047/1501627` |
| 2c | It is video | `video/mp4` |
| 2d | No Graph URL in the response headers | — |
| 3a | An expired link is refused | 410 |
| 3b | A revoked link is refused | 410 |
| 3c | An unknown token is refused | 404 |
| 3d | **Expired and revoked read identically to the holder** | byte-identical bodies |
| 3e | The refusal says what to do next | "ask the recruiter" |
| 3f | No stack trace or vendor detail in a refusal | — |
| 4a | The **stream** route refuses too, not just the page | 410 |
| 4b | That refusal leaks nothing | — |
| 5 | A link revoked **while in use** stops on the next request | 410 on the next range request |
| 6a | The open was counted | `view_count = 1` |
| 6b | `last_viewed_at` stamped | — |
| 6c | The timeline names an external viewer | *"Interview recording opened by an external viewer via a share link (IP ::1)"* |
| 6d | The viewer's IP is recorded | — |
| 6e | Attributed to nobody internal | `acted_by = null` |
| 7a | The share limiter trips | 15 of 135 requests refused |
| 7b | And says how long to wait | *"Too many requests for this recording. Please try again…"* |

**§10.2a item 2 ("swapping the recording id does not reach another round") is satisfied structurally, not by
test:** the URL carries only the token. There is no recording id in it to swap.

**§10.2a item 8 (archive off + a Teams original older than 60 days) is NOT tested.** It needs an aged
recording, and faking one means mutating a real row. The failure path is written — an upstream 404 becomes a
410 with "no longer available, ask the recruiter", never a Graph error dump — but it has not been exercised
against a genuinely aged meeting.

---

## 3. What still needs a browser session

None of these can run from a script: they need an authenticated recruiter and, for the last one, a machine
with no network.

### 3.0 The three §10.2 checks still outstanding

| # | Check | What it needs |
|---|---|---|
| 4 | A **vendor** account is refused (403) even with `recruitment_pipeline` toggled ON | A vendor-account JWT. This is the access-model test — the rank floor is the whole of decision #5, and it is the one §10.2 check still unexercised |
| 13 | Revoke from the drawer's **Shared recording links** list | A browser. Journey 1396 has a live link (id 4) minted by this pass — use it, then confirm it refuses in a private window |

Check 6 (rate limiter) **passed 2026-09-03**: 5 of 22 downloads refused once the window's allowance of 20 was
spent, with the friendly wait message.

### What this pass left behind

- **One live share link** (id 4) on journey 1396, for recording #1 — kept deliberately so check 13 has
  something to revoke. Delete it or revoke it from the drawer when you are done.
- **Audit rows and timeline notes** for every download it made, on journeys 1396, 1436 and 1991. Left on
  purpose: deleting audit rows to tidy up a test defeats the point of having them.
- One timeline note recording an external viewer opening a share link (journey 1396), from the §10.2a pass.

### 3.1 §10.2 — the full checklist, for reference (steps 2, 3, 5, 8, 11, 12 now automated)

| # | Step | Expect |
|---|---|---|
| 1 | Open a candidate at Tech 2 with scorecards, a Zeko score, an Evalground result, a resume and a recording | — |
| 2 | `GET /api/pipeline/:id/dossier` (the preview the modal shows) | No forbidden key anywhere in the JSON |
| 3 | Download the ZIP | Opens; the report renders all ten sections |
| 4 | Repeat as a **vendor** account with `recruitment_pipeline` deliberately toggled ON | **403** — the rank floor holds before the module toggle is consulted |
| 5 | Check `rpa_processing_log` and the journey timeline | An export row and a download note, both naming what was included |
| 6 | 21 downloads in 5 minutes | The 21st is refused with the friendly message |
| 7 | Point `cvFileUrl` at a deleted item, download again | Pack still downloads; the manifest explains; **`X-Export-Degraded: true`** — the dossier deliberately reuses the export header rather than inventing `X-Dossier-Degraded`, so `downloadFile()` and the CORS expose-list need no change (`pipeline.controller.js:645`). The plan's §6.3 still names the old header |
| 8 | Download with personal documents **unticked**, then **ticked** | Unticked: no documents, audit says so. Ticked: documents present **and** the count and recruiter are named in `rpa_processing_log` and on the timeline |
| 9 | Download for a **rejected/closed** journey | A pack is produced and states the journey is closed |
| 10 | Zeko: section 6 carries verdict, requirement table, strengths, concerns, ratings; untick it | Scores only, and the manifest says it was the recruiter's choice |
| 11 | **Evalground: section 7 carries the section table, question counts, difficulty split and topic scores**; untick it | Scores only, manifest says it was the recruiter's choice |
| 12 | **Recordings: section 9 carries a Play button per round with an expiry**; untick it | No `/api/recording-share/` anywhere in the pack |
| 13 | Open the drawer's **Shared recording links** list, click Revoke | The link refuses immediately (re-open it in a private window to confirm) |

### 3.2 §10.3 — "opens outside the ATS with no login"

On a machine with **no ATS session and the network disconnected**:

1. Unzip. Double-click `Candidate-Dossier.html` → renders fully, no broken images, no blank sections.
2. Ctrl+P → legible, paginated PDF.
3. Open `Candidate-Summary.xlsx` → all four sheets present.
4. Run the scan, with this candidate's real values:
   ```
   npm run dossier:leakscan -- <pack.zip> --ctc <their CTC values> --vendor "<agency>" \
     --domain <agency domain> --budget <min,max> --other "<another candidate from the same Evalground file>"
   ```
   Any finding fails the pass.
5. **Repeat for a vendor-sourced candidate** — the case where a leak is most likely and most damaging.

Note that recording links will not play on a disconnected machine; that is expected, and the pack says so.
Test them separately, with a network but no ATS session.

### 3.3 Before production

- Re-run the OneDrive read test against `HR_RPA_PROD`.
- Apply `2026-09-02-onedrive-item-ids.sql`, `2026-09-03-zeko-shared-report-link.sql`,
  `2026-09-03-assessment-result-detail.sql` and `2026-09-03-recording-share-links.sql`.
- Set `MS_RECORDING_ARCHIVE_ENABLED=true` — it is **`false` in production today**, and a 14-day link minted on
  day 50 of a recording's life would die mid-window.
- Re-check `PUBLIC_BASE_URL` (already correct on both staging and production).

---

## 4. Open with HR, not with engineering

1. Deletion period — 30 days assumed, never confirmed.
2. The candidate recording notice: a 14-day external share link goes beyond what candidates were told.
   Settle **before** share links go live in production.
3. Whether the opt-in Zeko report link should exist at all — it routes around the pack's own redaction and
   cannot be revoked by us.
4. The pack now sends **per-topic and per-difficulty** assessment detail outside the company, on by default.
   Recommended to stay on; never explicitly asked.
