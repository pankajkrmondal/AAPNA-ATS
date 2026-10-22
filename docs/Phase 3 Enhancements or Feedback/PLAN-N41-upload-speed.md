# N41 · Upload speed: plan

**Section:** H (Phase 3 "Do Now") · **Status:** plan only. No code and no test runs until the open decisions are settled.
**Date:** 21 Oct 2026 · **Related:** [PLAN-Phase3-Now.md](PLAN-Phase3-Now.md) §H, section B changelog (JD tagging touches the same code).

---

## 1. In plain words

**Today.** Every resume, and every row of an Excel sheet, is read by the AI **one at a time**. Then the next one starts.
- **A single resume** takes about **7 seconds** (staging, 45 files: median 7.1 s, 9 in 10 under 17.5 s, worst 26 s). That is fine.
- **A big upload adds up:** 100 resumes take about **12 minutes**. A 500-row Excel sheet takes about **an hour**, and the screen shows only "Processing" for the whole sheet, with no "how far along".
- **Hidden work:** after each candidate is saved, two more AI calls (search embedding and profile insights) and one or two emails run in the background, with no limit on how many run at once. On a big upload they compete with the reads for the same AI quota, which can slow everything or cause "rate limit" errors.

**After the changes.**
- A big upload finishes several times faster: several resumes are read at once, within a safe limit.
- Excel rows with clean columns (name, email, phone, experience, …) are saved without a full AI read.
- Re-uploading the same file, or uploading someone already in the ATS, skips work it doesn't need.
- The upload list shows **"120 of 500 rows done, about 4 min left"**.

**Not known yet**, and needed before choosing the order of work:
- what RT actually uploads: how many files per zip, how many rows per sheet;
- whether "too long" meant the upload or the JD-match search;
- production timings. Staging has never had an Excel upload or a big zip.

---

## 2. Where the time goes today (one file)

The steps for each resume run in this order. Excel rows skip step 2 after the first one.

| # | Step | Where | Rough time | Notes |
|---|---|---|---|---|
| 1 | Read the text (PDF / DOCX / Excel row) | main server thread | < 1 s | No OCR: scanned PDFs fail |
| 2 | Upload the file to OneDrive | Graph API | ~1–3 s (90 s timeout) | Runs **before** the AI read, not alongside it |
| 3 | **AI read** (resume → ~50 fields) | OpenRouter `gpt-4.1-nano`, Gemini as fallback | **~3–6 s; the biggest step** | Full resume text with no cap, no `max_tokens`. A failed OpenRouter call waits up to 120 s before falling back to Gemini |
| 4 | Duplicate check | Postgres | < 1 s now | No index can serve it (string split and overlap), so it scans every candidate and grows with the database |
| 5 | Save candidate / duplicate row, update the job | Postgres | < 1 s | About 20 small DB round trips per file |
| 6 | *Background:* embedding + insights AI call + 1–2 emails | Gemini, OpenRouter, Graph | ~3–6 s per candidate | Unlimited concurrency, so it competes with step 3 |

**Evidence:**
- Staging upload rows, read-only, measured by when each candidate row was written.
- Local call logs: embedding median 0.7 s (max 7.4 s), OpenRouter median 1.6 s on short prompts, Graph email ~0.5 s.
- OneDrive call times are only in the server logs.

**Measurement note:** `rpa_upload_jobs.updated_at` is **not** the end of processing. It moves again when the candidate fills in missing details or a recruiter reviews a duplicate. An earlier reading based on it suggested "p90 152 s", which was wrong.

---

## 3. The options

Each option has an id, so they can be picked and ordered independently.

### H1 · Read several at once (parallel parsing)
- **What users see:** a big upload finishes 3–4× faster.
- **How:**
  - Process files, and Excel rows, with a fixed limit at a time (`UPLOAD_PARSE_CONCURRENCY`, start at 4), reusing `mapWithConcurrency` (`backend/src/services/vectorStore.service.js:20`).
  - Put the background work (step 6) under its own limit so it stops competing.
- **Must keep:**
  - Two copies of one person in the same batch must not both become "new": an in-batch email/phone guard.
  - The JD tag (`mrfId`, section B) must travel through the new path.
  - Batch counts must stay correct when files finish out of order.
- **Option, decide separately:** turn on the existing BullMQ queue in production (`USE_RESUME_QUEUE`). Before that:
  - fix the worker starting twice (`server.js` + PM2);
  - fix retries never firing (errors are swallowed inside `runBatchParsing`).
- **Effort:** ~6 h (+4 h if the queue is enabled).
- **Risk:** AI rate limits. Raise the limit step by step and watch for 429s.

### H2 · Excel fast path
- **What users see:** a clean Excel sheet uploads in minutes instead of an hour.
- **How:**
  - Map known column headers (name, email, phone, experience, current company, skills, CTC, notice, location; with aliases such as "Mobile", "Contact No") straight to the candidate fields.
  - Use the AI only for rows missing required fields, or for free-text columns, with a much smaller prompt.
- **Must keep:** the same validation (a valid email or phone, missing-details marking) and the same duplicate check.
- **Effort:** ~8 h.
- **Risk:** messy sheets. The AI path stays as the fallback for any row the mapper can't fill.

### H3 · Skip work that isn't needed
| Part | What changes | Effort |
|---|---|---|
| a | Find the email/phone with a pattern **before** the AI read; an existing candidate is known early | 2 h |
| b | Fingerprint each file (SHA-256); an identical re-upload reuses the earlier read | 2 h |
| c | Run the OneDrive upload **alongside** the AI read instead of before it | 1 h |
| d | Indexed, normalised email/phone for the duplicate check, and fix the vector delete's unindexed `OR`. Needs a DDL, which goes in the final production list | 3 h |

- **Open point for (a):** a duplicate still needs its fields for the recruiter's merge review. Either keep the full read for duplicates (saves nothing there), or do a short read only.

### H4 · Progress and time left
- **What users see:** "120 of 500 rows done, about 4 min left" on HR Upload and the Vendor portal, live.
- **How:**
  - `rows_total` / `rows_done` on the upload job (small DDL), sent on the existing `upload:job` socket event.
  - Time left = average time per row so far × rows left.
- **Also fixes:** a multi-row sheet links only its last candidate to the job.
- **Effort:** ~5 h.

### H5 · Cap the AI read (small)
- **How:** truncate very long resume text before the AI read, and set `max_tokens` on the output. Give Gemini fallback calls a timeout; today they have none.
- **Effort:** ~2 h.
- **Risk:** the cap must not cut real experience. Set it from the longest real resumes, and keep the full text for search.

---

## 4. Recommended order

1. **Measure for real** (no code): see §5. This decides whether H2 (Excel) or H1 (parallel) comes first.
2. **H3c + H5:** cheap and safe; they shorten every file.
3. **H1** (parallel, with the background limit).
4. **H4** (progress and time left): makes the wait visible even before every speed-up lands.
5. **H2** (Excel fast path), first if RT's pain is Excel.
6. **H3a, b, d.**

**Target, to confirm once production numbers are in:** a 100-row Excel at least 4× faster, a 100-resume zip under 5 minutes, and no rise in AI "rate limit" errors.

**Rough total:** ~27 h for H1–H5, plus 4 h if the production queue is turned on.

---

## 5. Measurements to take before building

| What | Who | How |
|---|---|---|
| Real upload sizes and per-file times on **production** | User | Read-only SQL v2 (shared separately), last 90 days: per-file p50/p90, Excel rows and seconds per row, batch sizes, failures |
| Which call is slow on slow days | User / server access | grep `[external]` lines in the staging and production `combined.log` |
| What RT meant | User → RT | Which upload (Excel? zip? how many rows/files)? Upload or JD-match search (N10 already sped that up)? |
| A controlled run (later, when allowed) | Claude | 20 resumes + a 100-row synthetic Excel on staging, queue off and on. Times taken the same way before and after each change |

---

## 6. Open decisions

1. **Order of work:** Excel first (H2) or parallel first (H1)? Depends on §5.
2. **Production queue:** turn on `USE_RESUME_QUEUE` (H1 option) or keep in-process with a limit?
3. **H3a:** duplicates get a full read (no saving) or a short read?
4. **Concurrency limit:** start at 4? It depends on the OpenRouter / Gemini plan limits.
5. **H5:** the resume-text cap for the AI read (e.g. first 20,000 characters)?

---

## 7. Rules carried over from section B (JD tagging)
- **JD travels separately:** every new path (parallel, queue, Excel fast path, the H3 shortcuts) must carry `mrfId` as its own argument, never inside `attribution`.
- **Tagging:** new candidates are tagged; duplicates keep `rpa_cv_tmp.mrf_id` so the merge tags them.
- **Regression:** the section B integration tests join H's regression run.
