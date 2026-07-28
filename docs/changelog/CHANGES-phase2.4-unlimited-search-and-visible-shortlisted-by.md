# Phase 2.4 — Unlimited Candidate Search, Visible Shortlisted-By, Rate-Limit Messaging

Follow-on to `CHANGES-phase2.3-rejection-cooldown-shortlisted-by-recruiter-dashboard.md`,
from a review pass over four previously-implemented Screening behaviors.

1. **"Shortlisted by X on Y" made plainly visible on the result card** — was
   behind a hover-only info icon (`InfoCircleOutlined` + `Tooltip`), which
   isn't glanceable while scanning a results list. Replaced with an
   always-visible small text line under the name/badge row on
   `CandidateScreening.jsx` ("Shortlisted by **{name}** on {date}"), matching
   what the candidate detail drawer already showed directly (no hover there).
   Removed the now-unused `InfoCircleOutlined` import.

2. **Removed the candidate-fetch caps entirely** — `searchRoleCandidates` (JD
   tab) and `searchKeywordCandidates`'s keyword-vector path both had a
   `LIMIT 3000`; the no-keyword filter path had `take: 1000`. Investigated
   before touching: `rpa_cv_vectors.embedding` has **no ANN index**
   (ivfflat/hnsw) — just a plain index on `candidate_id` — so Postgres already
   computes the distance and sorts every WHERE-matching row before any LIMIT
   is applied; the limit wasn't protecting DB query performance. The real
   constraint was downstream: `rerankCandidates()` batches candidates into
   groups of 1000 and fires them at Cohere **in parallel** — a much larger
   pool means more simultaneous outbound API calls, risking a free/trial
   Cohere key's requests-per-minute limit and increasing per-search cost
   (Cohere bills per document reranked). Per direction: removed all three
   caps (`backend/src/services/screening.service.js`), and added
   `RERANK_MAX_CONCURRENT_BATCHES = 5` + a small `mapWithConcurrency()` helper
   in `vectorStore.service.js` so Cohere batches now queue through a
   bounded-concurrency pool instead of firing unboundedly via `Promise.all` —
   every candidate still eventually gets reranked (no count cap), just without
   a large pool spiking to dozens of simultaneous requests at once. The
   no-keyword Prisma path has no Cohere involvement at all (no reranking without
   a keyword), so its only removed-cap tradeoff is a larger HTTP response
   payload on a very broad/no-filter search — noted in its code comment.

3. **Rate-limit-aware degraded-search messaging, for both the recruiter and
   developers** — prompted by removing the caps above (a broad search can now
   produce many more Cohere batches than before, so a rate-limit hit is more
   likely). `rerankCandidates()`'s failure path now detects a 429 specifically
   (`rerankBatch()` already embeds the HTTP status in its thrown error message,
   e.g. "Cohere Rerank API error (Status 429): ..." — matched via a simple
   regex, no extra round-trip needed) and passes `rateLimited` through to both:
   - **Recruiter-facing**: the existing degraded-search toast
     (`notification.warning` in `CandidateScreening.jsx`, unchanged — it
     already renders whatever `degradedReason` the backend sends) now gets a
     more informative message from the backend: "Candidate ranking service is
     temporarily **busy** [rate-limited] / **unavailable** [other failure] —
     showing the top **N of M** matches by base relevance," instead of a flat
     "showing the top matches" with no counts.
   - **Developer-facing**: `sendRerankApiAlert()` (`emailNotification.service.js`)
     now sends a visibly different alert when rate-limited — subject line
     "⏳ ... Rate Limit Hit" (amber banner) instead of "🚨 ... API Failure" (red
     banner), with body copy explicitly suggesting the likely cause (pool size
     exceeding the current plan's per-minute limit) and two concrete next
     steps (lower `RERANK_MAX_CONCURRENT_BATCHES`, or upgrade the Cohere plan)
     — instead of a generic failure email indistinguishable from an outage or
     auth/config error.

**Also reviewed this pass, confirmed already correct, no change needed:**
rejecting a candidate on Candidate Screening removes them from the visible
result list immediately (`patchCandidateLists` filter, unconditional on email
send success since the DB write isn't rolled back on email failure) and from
future searches for that role (the 90-day cooldown from the previous phase);
Keyword-tab Shortlist/Reject both require tagging an Open JD before
confirming. Point 4 from the review (send-email checkbox for the Recruitment
Analytics "On Hold"/"Rejected" inline status dropdown) — explicitly deferred
to Phase 3, no action taken.

**Files touched**: `backend/src/services/screening.service.js`,
`backend/src/services/vectorStore.service.js`,
`backend/src/services/emailNotification.service.js`,
`frontend/src/pages/CandidateScreening.jsx`.

No schema/migration changes.

**Verification**: All modified backend files pass `node --check`; both dev
servers (frontend :5173, backend :5000) confirmed healthy after each edit. No
automated tests exist for these services. Full manual verification (a very
broad keyword search still returns complete, correctly-ranked results without
timing out; the degraded-fallback toast and dev alert email trigger correctly
on an actual Cohere failure/rate-limit, ideally tested by temporarily using an
invalid API key or a deliberately tiny `COHERE_MAX_DOCUMENTS` to force
batching pressure; "Shortlisted by" text renders correctly on real shortlisted
results) is pending — being done live against the running dev stack rather
than replayed here.
