# 2026-09-03 — recording share links (Phase 4)

**What it does.** Adds `rpa_recording_share_link`: one row per no-login, expiring, revocable link to **one**
interview recording, minted when a recruiter downloads a candidate dossier with recording links included.

**Apply:**

```bash
psql "$DATABASE_URL" -f prisma/ddl/2026-09-03-recording-share-links.sql
cd backend && npm run prisma:pull && npm run prisma:generate
```

`prisma:generate` takes a file lock on Windows — stop the dev server **and** the queue worker first, or it
fails with `EPERM`.

**Safe to re-run.** `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`. Nothing is dropped or backfilled.

## Why each column is a control

This is the highest-risk surface in the Candidate Complete Download feature: an unauthenticated URL to a video
of a real person, sitting in a file we cannot recall. The table is shaped so that every part of the risk has
something answering it.

| Column | Answers |
|---|---|
| `token` | "Could someone guess one?" — `gen_random_uuid()`, as `rpa_interview_scorecard.token` already does |
| `recording_id` | "How much does one leak expose?" — one round, never the candidate's whole set |
| `expires_at` | "How long?" — 14 days by default (`DOSSIER_SHARE_LINK_DAYS`), checked server-side every request |
| `revoked_at` | "Can we stop it?" — immediately, from the drawer's Shared links list |
| `view_count` / `last_viewed_at` | "Is it being passed around?" — a link opened 40 times is not one interviewer |
| `created_by` / `created_at` | "Which pack did this come from?" — joins to the dossier download audit row written at the same moment |

## Production prerequisite

`resolveStreamSource()` prefers our archived copy and falls back to the Teams original, which Graph stops
serving roughly **60 days** after the meeting. Archiving is gated on `MS_RECORDING_ARCHIVE_ENABLED`, which is
`true` in development and staging and **`false` in production**. Left off, a 14-day link minted on day 50 of a
recording's life dies mid-window and the interviewer sees a dead video.

**Turn it on in production before this ships there**, and confirm OneDrive headroom (~800 MB per recorded
interview-hour across both copies — `MS-GRAPH-SETUP-FOR-IT.md` §3a).

## Related

- `docs/phase3/CANDIDATE-COMPLETE-DOWNLOAD-PLAN.md` §6.5, §10.2a, §12
- `docs/phase3/INTERVIEW-RECORDINGS-PLAN.md` — the authenticated in-app player this reuses
