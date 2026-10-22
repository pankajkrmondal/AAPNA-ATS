# RCA — "Resume Processing Failed" on HR Manual Upload for duplicate candidates

**Date:** 2026-09-22
**Reported by:** Naveen Satywali (HR), via Teams and the `Resume Processing Error Alert` emails
**Affected file:** `Akshay_Bhosale_Resume.pdf`
**Affected batches:** `769f7b31-7a24-4bcf-97d0-21696b00fef2` (02:25 pm), `38242d57-c02b-482b-bc8b-c607f65364de` (02:28 pm), `2d83b141-f94d-4143-b54f-355a472b221e` (02:47 pm)
**Environment:** Production (`ats.aapnainfotech.com/hr-upload`)
**Analysed on:** Staging DB + staging Prisma client only. Production was never touched.
**Status:** Root cause confirmed and reproduced on staging. A second, related defect on the merge path was found during analysis and is also confirmed (§6.2). Nothing changed yet — this document is analysis only.
**Fix requires:** one DDL change **and** one one-line code change, applied in that order.

---

## 1. Summary

The upload did not fail because of anything wrong with Akshay's resume. Parsing, OneDrive upload and duplicate detection all succeeded. The failure happened at the very last step, when the system tried to write the duplicate into the recruiter review queue.

The code writes a column named `cv_file_item_id` into the `rpa_cv_tmp` table. **That column does not exist on `rpa_cv_tmp`.** Prisma rejects the write before it ever reaches the database, the whole upload is marked `Processing Failed`, and the error-alert email goes out with the entire record dumped into it.

This is why Naveen saw **"Processing Failed" instead of "Duplicate"** — which is exactly the question he asked. The system had already correctly decided the candidate *was* a duplicate. It crashed while trying to record that decision.

The three failures at 02:25, 02:28 and 02:47 are the same candidate retried three times. Every retry will fail the same way until the schema is fixed.

---

## 2. The error, decoded

From the alert email (all three are identical apart from parse noise):

```
Akshay_Bhosale_Resume.pdf: Invalid `prisma.rpa_cv_tmp.create()` invocation: { data: { ... } }
Unknown argument `cv_file_item_id`. Available options are marked with ?.
```

Three things to read out of that one line:

| Signal | Meaning |
|---|---|
| `prisma.rpa_cv_tmp.create()` | The write targeted the **review/duplicate queue** table, not the main candidate table. The system had already classified this resume as a duplicate. |
| `Unknown argument cv_file_item_id` | Prisma **client-side validation**. The field is not in the `rpa_cv_tmp` model, so the query was rejected before any SQL was sent. |
| `Available options are marked with ?` | The long `?  Field?: String \| Null` list in the email is Prisma printing every column it *does* accept on `rpa_cv_tmp`. `cv_file_item_id` is absent from that list. |

Because it is a client-side validation error, **nothing was written and nothing was corrupted.** The database was never reached on the failing call.

---

## 3. Root cause

### 3.1 The schema gap

On **2026-09-02**, `backend/prisma/ddl/2026-09-02-onedrive-item-ids.sql` added the OneDrive drive-item id column for the Candidate Complete Download / dossier work. It added it to **two** tables:

```sql
ALTER TABLE rpa_cv                  ADD COLUMN IF NOT EXISTS cv_file_item_id VARCHAR(512);
ALTER TABLE rpa_candidate_documents ADD COLUMN IF NOT EXISTS file_item_id   VARCHAR(512);
```

`rpa_cv_tmp` was **not** included. No later DDL adds it either — a search across all of `backend/prisma/ddl/` finds no statement adding `cv_file_item_id` to `rpa_cv_tmp`.

### 3.2 The code writes it to three places

Commit `10f2238` ("Dossier work") added `cv_file_item_id: cvItemId` at **three** write sites in `backend/src/services/hrUpload.service.js`:

| Line | Target table | Path | Column exists? | Result |
|---|---|---|---|---|
| [1330](../../backend/src/services/hrUpload.service.js#L1330) | **`rpa_cv_tmp`** | Duplicate → review queue | **NO** | **Crashes** |
| [1472](../../backend/src/services/hrUpload.service.js#L1472) | `rpa_cv` | Duplicate → merge/update | Yes | Works |
| [1573](../../backend/src/services/hrUpload.service.js#L1573) | `rpa_cv` | New candidate → insert | Yes | Works |

The DDL covered two of the three tables the code writes to. The third was missed.

### 3.3 Why it stayed hidden until now

The broken line sits on a **narrow conditional branch**. From [hrUpload.service.js:1282-1288](../../backend/src/services/hrUpload.service.js#L1282-L1288), the `rpa_cv_tmp.create()` only runs when **all** of these hold:

1. Duplicate detection finds an existing candidate (matching phone **or** email), **and**
2. the upload source is `hr_manual_upload` or `vendor_portal`.

A **new** candidate takes the line-1573 path into `rpa_cv` and succeeds. So every upload of a genuinely new person kept working normally, and the defect only surfaced the first time an HR user re-uploaded someone already in the production database. That is precisely what Naveen did.

This is also the **only** `rpa_cv_tmp.create()` call in the entire codebase — a grep for `rpa_cv_tmp.(create|update|upsert)` across `backend/src` returns exactly one hit, line 1288. So the blast radius is this one branch, but that branch is 100% broken.

---

## 4. Verification on staging

All checks were run read-only against the **staging** database (`20.244.34.176`). Production was not connected to at any point.

### 4.1 The column really is missing

```sql
SELECT table_name, column_name FROM information_schema.columns
WHERE column_name IN ('cv_file_item_id','file_item_id') ORDER BY table_name;
```

| table_name | column_name |
|---|---|
| `rpa_candidate_documents` | `file_item_id` |
| `rpa_cv` | `cv_file_item_id` |

`rpa_cv_tmp` does not appear. Column counts: `rpa_cv` = 75, `rpa_cv_tmp` = 70.

### 4.2 The exact production error reproduced

A `rpa_cv_tmp.create({ data: { ..., cv_file_item_id: 'abc123' } })` was issued inside a **deliberately rolled-back transaction** on staging. Prisma returned, verbatim:

```
Unknown argument `cv_file_item_id`. Available options are marked with ?.
```

This is character-for-character the production error. `rpa_cv_tmp` row count was unchanged (101) before and after, confirming nothing was written.

**Conclusion: confirmed, not hypothesised.** Same code, same schema shape, same error.

---

## 5. Impact

- **Every duplicate resume uploaded via HR Manual Upload or the Vendor Portal fails**, from 2026-09-02 (when commit `10f2238` shipped with the dossier work) onward.
- The HR user sees `Processing Failed` with a dash for the candidate name, and `Duplicate: No` — all three columns misleading. The record never reached the duplicate queue, so the UI has nothing to show.
- **Recruiters never get the Merge/Cancel decision** for these candidates. The duplicate is silently dropped.
- The `PENDING REVIEW = 28` counter on the dashboard is **under-counting** — every duplicate that failed this way should have been in it.
- The alert email leaks the **entire parsed candidate record**, including full resume text, phone and email, into an email body. Worth noting separately (§7.3).
- **No data corruption.** The failure is client-side validation; the transaction never reached Postgres.

---

## 6. The fix

Two parts. Part A is the actual fix; Part B stops the class of defect recurring.

### 6.1 Part A — add the missing column (primary fix)

Create `backend/prisma/ddl/2026-09-22-cv-tmp-item-id.sql`:

```sql
-- ============================================================================
-- Fix: rpa_cv_tmp was missed by 2026-09-02-onedrive-item-ids.sql, while
-- hrUpload.service.js writes cv_file_item_id to it on the duplicate-review
-- path. Every duplicate HR Manual Upload / Vendor Portal resume has failed
-- with "Unknown argument `cv_file_item_id`" since that change shipped.
--
-- Idempotent, additive, non-destructive. Mirrors the rpa_cv column exactly.
-- ============================================================================

ALTER TABLE rpa_cv_tmp
  ADD COLUMN IF NOT EXISTS cv_file_item_id VARCHAR(512);

COMMENT ON COLUMN rpa_cv_tmp.cv_file_item_id IS
  'OneDrive drive-item id for cvFileUrl, carried through the duplicate review '
  'queue so a Merge preserves it on rpa_cv. Mirrors rpa_cv.cv_file_item_id.';
```

Then regenerate the client:

```powershell
cd backend
npm run prisma:pull
npm run prisma:generate
```

> **Windows note:** `prisma:generate` will fail with `EPERM` file locks unless the dev server **and** the queue worker are both stopped first. Stop both before running it.

**Why a DDL column rather than deleting the code line:** the column is genuinely needed. `rpa_cv_tmp` is a staging row that a recruiter later **merges into `rpa_cv`**. If the drive-item id is not carried through the queue, a merged duplicate lands on `rpa_cv` with `cv_file_item_id = NULL` and the dossier download has to fall back to resolving the OneDrive URL through the `/shares/` route — the exact slow, rename-fragile path the 2026-09-02 change existed to remove. Dropping the line would trade a visible crash for a silent data-quality regression.

### 6.2 Part B — the merge path also drops the column (CONFIRMED — second fix required)

This was checked and the "quieter twin" is **real**. Adding the column in Part A alone is not sufficient.

The recruiter Merge is driven by the `CV_SHARED_FIELDS` array at [hrUpload.service.js:75-94](../../backend/src/services/hrUpload.service.js#L75-L94), described in the code as *"Shared fields between rpa_cv_tmp and rpa_cv"*. That array contains `'cvFileUrl'` (line 92) but **not** `'cv_file_item_id'`.

Both merge branches copy fields by looping over that array and nothing else:

| Branch | Line | Code |
|---|---|---|
| Match found → update | [598](../../backend/src/services/hrUpload.service.js#L598) | `for (const field of CV_SHARED_FIELDS) { updateData[field] = prefer(...) }` |
| No match → insert | [673](../../backend/src/services/hrUpload.service.js#L673) | `for (const field of CV_SHARED_FIELDS) { insertData[field] = tempCandidate[field] }` |

Neither branch sets `cv_file_item_id` outside the loop. So after Part A the sequence would be:

1. Duplicate upload writes `cv_file_item_id` into `rpa_cv_tmp` — now succeeds.
2. Recruiter clicks Merge. The loop copies `cvFileUrl` across but silently skips the id.
3. [Line 697](../../backend/src/services/hrUpload.service.js#L697) deletes the `rpa_cv_tmp` row — **the id is gone permanently.**
4. `rpa_cv` ends up with the resume URL and `cv_file_item_id = NULL`.

**Why that matters:** [candidateDossier.service.js:943-956](../../backend/src/services/candidateDossier.service.js#L943-L956) selects `cv_file_item_id` and passes it to `downloadDriveItem({ itemId, webUrl })`. With a NULL id it falls back to resolving the `webUrl` through the `/shares/` route — the slow, rate-limited, rename-fragile path the 2026-09-02 change was written to eliminate. It self-heals via the `persist` callback on line 955, but only on the *first dossier download*, and only if the webUrl still resolves. If the file was renamed or moved in OneDrive in the meantime, it is a dead link and the resume silently drops out of the dossier.

So a merged duplicate would be quietly downgraded to the pre-2026-09-02 behaviour. No error, no alert — which is exactly why this needed checking.

**Fix:** add the field to the shared array, so both merge branches carry it automatically:

```js
  'employment_history', 'cvVectorLock', 'cvFileUrl', 'cv_file_item_id',
```

This is the correct place for it — it keeps the id travelling with `cvFileUrl`, which is the column it describes. Note `prefer()` is used on the update branch, so an incoming non-null id wins and an existing one is never overwritten with null.

**Ordering constraint:** this edit must ship **together with the Part A DDL, and not before it.** Adding `cv_file_item_id` to `CV_SHARED_FIELDS` while the column is still missing from `rpa_cv_tmp` would extend the failure from the upload path to the *merge* path as well, because line 674 would then read a non-existent field. Apply the DDL first, regenerate the client, then make this edit.

### 6.3 Rollout order

| # | Step | Environment | Note |
|---|---|---|---|
| 1 | Apply the DDL | **Staging** | Idempotent; safe to re-run |
| 2 | `prisma:pull` + `prisma:generate` | Staging | Stop dev server + queue worker first |
| 3 | Add `'cv_file_item_id'` to `CV_SHARED_FIELDS` (§6.2) | Code | **Only after** steps 1-2. Never before |
| 4 | Re-upload `Akshay_Bhosale_Resume.pdf` | Staging | Must land in the review queue as a duplicate, **not** fail |
| 5 | Confirm it appears under **Pending Review** with Merge/Cancel | Staging | This is the real acceptance test |
| 6 | Merge it, then `SELECT cv_file_item_id FROM rpa_cv WHERE id = <merged id>` | Staging | Must be **non-NULL**. This is what proves §6.2 |
| 7 | Apply the same DDL to **production** | Production | Additive, zero downtime, no row rewritten |
| 8 | Deploy the code change and restart the production API + worker | Production | Client and code must both match the new schema |
| 9 | Ask Naveen to retry the upload | Production | Expect `Duplicate`, not `Processing Failed` |

Step 6 is the one most likely to be skipped, and it is the only step that catches the §6.2 defect — a merge that "looks fine" in the UI is exactly the failure mode there.

The DDL is `ADD COLUMN IF NOT EXISTS` on a nullable column — it takes no table rewrite and no lock of consequence in Postgres. It is safe to apply to production during working hours.

### 6.4 Recovering the resumes already lost

The failed duplicates were never persisted, so there is no queue backlog to replay. The files themselves **were** uploaded to OneDrive before the crash, but the DB rows do not exist. Recovery is simply: **re-upload the affected resumes after the fix.** For the reported case that is `Akshay_Bhosale_Resume.pdf`. To find any others, search the error-alert emails since 2026-09-02 for `Unknown argument` + `rpa_cv_tmp` and re-upload each filename listed.

---

## 7. Follow-ups worth raising separately

These are **not** required to fix the incident, but this incident exposed them.

### 7.1 Schema drift is not caught by anything

The root cause is that code referenced a column no DDL created, and nothing failed until a user hit the branch at runtime. A CI step running `prisma migrate diff` (or `prisma db pull` followed by a `git diff --exit-code` on `schema.prisma`) against staging would have caught this the day it was introduced. Given `rpa_cv` and `rpa_cv_tmp` are near-duplicate tables that must evolve together, this is likely to recur.

### 7.2 Near-duplicate tables should be changed in pairs

`rpa_cv` (75 cols) and `rpa_cv_tmp` (70 cols) mirror each other by design, because rows migrate from one to the other on merge. Any DDL touching one should explicitly state whether the other needs the same change. The 2026-09-02 script did not consider `rpa_cv_tmp` at all. Worth auditing the other 5 columns of drift for the same latent bug.

### 7.3 The error alert email leaks candidate PII

The alert emails contain the complete parsed record: full resume text, phone number, personal email, current CTC and expected CTC — for a candidate who has not been hired, sent to a distribution list. The alert only needs the filename, the batch id and a short error string. The full payload belongs in the server log, not an inbox.

### 7.4 The UI reports the failure misleadingly

For these rows the grid shows name `—`, status `Processing Failed`, duplicate `No`. All three are wrong or unhelpful — the system knew the name, knew it was a duplicate, and the failure was a system defect rather than a bad file. At minimum the duplicate flag should reflect what detection actually found, and the status should distinguish "we could not read your file" from "our system errored", since only the first is something HR can act on.

---

## 8. Answers to the three questions asked

**What is the root cause?**
`backend/src/services/hrUpload.service.js:1330` writes `cv_file_item_id` into `rpa_cv_tmp`, but the 2026-09-02 OneDrive DDL added that column only to `rpa_cv` and `rpa_candidate_documents`. Prisma rejects the unknown field client-side and the upload is marked failed.

**Why did it happen?**
The column was added to the two tables the dossier feature read from, but the code also writes it to a third table on the duplicate-review branch. That branch only executes for a duplicate candidate uploaded via HR Manual Upload or the Vendor Portal, so it went unnoticed until an HR user re-uploaded someone already in the database. New-candidate uploads were never affected, which is why the feature appeared healthy.

**How do we resolve it?**
Two changes, in this order:

1. **DDL (§6.1):** add `cv_file_item_id VARCHAR(512)` to `rpa_cv_tmp`, then regenerate the Prisma client. This fixes the crash Naveen reported.
2. **Code (§6.2):** add `'cv_file_item_id'` to the `CV_SHARED_FIELDS` array so the recruiter Merge carries the id onto `rpa_cv` instead of discarding it. **Confirmed necessary** — without it the id is written to the queue and then silently dropped when the row is merged and deleted.

Then roll out staging → production per §6.3 (the DDL must land before the code change), and re-upload the affected resumes (§6.4).
