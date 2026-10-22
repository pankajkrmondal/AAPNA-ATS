# Phase 3 / Phase 4 — recordings travel as expiring, revocable, no-login links

Scope: `docs/phase3/CANDIDATE-COMPLETE-DOWNLOAD-PLAN.md` §6.5, §10.2a, §12. Closes Phase 4 of the Candidate
Complete Download plan.

---

## 0. What this is, and why it is the riskiest thing in the feature

HR decided (decision #7) that a candidate dossier carries interview recordings as an **expiring, no-login
link** rather than as bytes: an MP4 round is hundreds of MB, and three rounds would make the pack unmailable.

What that means concretely is an **unauthenticated URL to a video of a real person**, sitting in a file we
cannot recall. Everything below exists because of that sentence.

| The risk | What answers it |
|---|---|
| Guessing a link | `gen_random_uuid()` token — 122 bits, the same construction `rpa_interview_scorecard.token` already uses |
| One leak exposing everything | **One link, one recording.** Never a link to "the candidate's recordings" |
| A link living forever | 14-day expiry (`DOSSIER_SHARE_LINK_DAYS`), checked **server-side on every request** |
| Realising too late | **Revoke** from the drawer — refused immediately, not at next expiry |
| Not knowing it was passed around | `view_count` + `last_viewed_at`, every open written to the candidate's timeline with the viewer's IP, and an "opened unusually often" flag in the UI |
| The Graph URL escaping | `resolveStreamSource()` stays server-side; playback is **proxied, never redirected**, and a unit test asserts no Graph, archive or SharePoint URL can reach an unauthenticated caller |

---

## 1. Schema

`prisma/ddl/2026-09-03-recording-share-links.sql` (+ `.README.md`) — `rpa_recording_share_link`:
`token`, `recording_id`, `pipeline_id`, `expires_at`, `created_by(_id)`, `created_at`, `revoked_at`,
`revoked_by(_id)`, `view_count`, `last_viewed_at`. `ON DELETE CASCADE` from the recording, so a link cannot
outlive the thing it points at and become unlistable and unrevokable.

---

## 2. The rules, kept pure

`src/utils/recordingShareModel.js` — `shareLinkState()`, `shareRefusal()`, `shareUrlFor()`,
`describeShareLink()`, `shareExpiryFrom()`. No Prisma, no Express, so "may this link play?" is exercised
exhaustively by `npm run test:unit` rather than discovered in production.

Three decisions worth naming:

- **Revocation is checked before expiry**, so a link that was revoked and has since expired still reports as
  revoked — "did my revoke work?" stays answerable months later.
- **Every refusal reads identically to the holder.** Expired, revoked and never-existed all return the same
  sentence. Telling a stranger "this was revoked 20 minutes ago" confirms the link was real and that somebody
  is watching. The distinction is kept in our logs, the timeline and the drawer.
- **A row with no usable expiry fails shut.** `NOT NULL` makes it unreachable; if it ever happens, "immortal
  link" is the one reading that must not be possible.

---

## 3. Serving it

`src/services/recordingShare.service.js` and `src/controllers/recordingShare.controller.js`, mounted
**unauthenticated** at `/api/recording-share` in `routes/index.js`, beside the scorecard and document token
routes so the set of public surfaces stays visible in one place.

- `GET /:token` — a self-contained player page: no CDN, no webfont, no script, `noindex`, `X-Frame-Options:
  DENY`, `no-store`. **A view is counted here**, not per byte range: a player seeking through an hour of
  interview issues dozens of requests, and counting each would leave a timeline nobody reads.
- `GET /:token/stream` — the bytes, proxied with Range in both directions. The token is **re-resolved on every
  request**, so a link revoked mid-video stops serving the next range.
- The page **does not name the candidate**. Whoever the recruiter sent the pack to already knows whose
  interview it is; a link forwarded on its own should not introduce a stranger to a candidate by name.
- Graph failures never reach the viewer as an error dump — an aged-out Teams original and a broken archive
  both read as "no longer available, ask the recruiter".
- `middleware/shareRateLimit.js` keys on **token + IP**, because `exportLimiter` keys on `req.user.id` and
  there is no user here; its IP fallback would put every interviewer behind one corporate NAT in one bucket.

**Mint-or-reuse.** A second download for the same candidate reuses a link that is still live rather than
minting another, and does **not** extend its expiry — otherwise a 14-day link becomes permanent for any
candidate whose pack gets re-sent.

---

## 4. In the pack

- Section 9 becomes a card per round with a **play button** and the expiry stated, rather than a URL in a table
  cell — the lesson §6.6 produced for the screening report, where readers scrolled straight past a link in a
  grey footnote. A hyperlink is still not an external *request*, so the no-internet acceptance test holds.
- The Summary sheet carries the links too, so "Spreadsheet only" loses nothing.
- `applyRecordingShareLinks()` (pure) writes the manifest's five outcomes: linked / the recruiter's choice not
  to / no link could be created / a round not shared / no recordings exist.
- Audit gains **`recording_no_login_link(n)`**, deliberately distinct from `recordings_listed(n)`: one means
  the pack said an interview exists, the other means somebody outside the company can watch it.
- `?recording_links=0|1`, defaulting **on**. Unlike the Zeko link (opt-in, §6.6) these links are ours —
  expiring, revocable, one per round, every open audited — which is exactly why HR chose them over attaching
  video nobody could email.

---

## 5. UI

- `DossierDownloadModal.jsx` — a ticked-by-default "Let the interviewer watch the interview recordings", shown
  only when recordings exist, with a warning naming what it means: no login, 14 days, revocable, every open
  logged with an IP. The "Not included" panel is now built from what is actually missing and disappears when
  nothing is.
- `PipelineDrawer.jsx` — **Shared recording links**, beside the Download dossier button: every link ever
  minted, live or not, with its round, state, expiry, view count, who sent it, Copy, and Revoke behind a
  confirm. Expired and revoked links stay listed, because the question is "what did we send out?"

---

## 6. Tests

`src/tests/unit/recordingShare.test.js` (new, 34 tests) — the full state machine including the expiry
boundary, revoked-beats-expired, fail-shut on a bad expiry, identical refusals, URL building (and refusing to
emit a relative URL that would resolve against `file://`), the 14-day default surviving a misconfigured env,
the drawer's wording, the manifest's five outcomes, the audit categories, and the assertion that no Graph,
archive or SharePoint URL survives serialization.

`src/tests/unit/candidateDossier.test.js` — section 9 renders a play button with the expiry, says "no login",
"recorded" and "withdraw", escapes the URL inside its `href`, still makes no external request, names a round
that was not shared, carries the link into the workbook, and — for an unshared pack — has no
`/api/recording-share/` anywhere in the ZIP.

**320 unit tests pass.** Frontend builds clean.

---

## 7. Deployment

1. `psql "$DATABASE_URL" -f prisma/ddl/2026-09-03-recording-share-links.sql`
2. `npm run prisma:pull && npm run prisma:generate` — **still owed for the Evalground columns too**; generate
   fails with `EPERM` while the dev server and queue worker hold the query engine.
3. Set `PUBLIC_BASE_URL` correctly per environment (already set on staging and production) — without it the
   pack carries no link rather than a broken one.
4. **Before production:** turn on `MS_RECORDING_ARCHIVE_ENABLED` (still `false` there). `resolveStreamSource()`
   falls back to the Teams original, which Graph stops serving ~60 days after the meeting, so a 14-day link
   minted on day 50 would die mid-window.

Not yet exercised end to end — the DDL is not applied anywhere yet, so §10.2a's eight integration checks
(play with no session, swapping the recording id, past expiry, revoked, per-view timeline entries, the rate
limiter, no Graph URL in any response, and the archive-off case) are all still owed.
