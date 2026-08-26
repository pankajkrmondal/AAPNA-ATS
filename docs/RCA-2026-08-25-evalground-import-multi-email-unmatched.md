# RCA — Evalground import reports "No candidate found for this email" for a candidate who *is* on the Assessment stage

**Date:** 2026-08-25
**Reported on:** `ats-staging.aapnainfotech.com/pipeline` → IQ / Tech Assessment → *import Evalground results*
**Candidate:** PANKAJ MONDAL — stored email `pankaj.mondal@example.com,aiuserpankajmondal@gmail.com`
**File uploaded:** `docs/General Aptitude, Python, SQL MCQ Test at AAPNA - 2026TestReport-3.xlsx`
**Status:** ✅ **Root cause identified and fixed** — see §11 for what shipped and how it was verified.

---

## 1. Symptom

The import preview showed:

| Matched | Retakes | Unchanged | Unmatched | Malformed |
|---|---|---|---|---|
| 0 | 0 | 0 | **1** | 0 |

Row 2 · `aiuserpankajmondal@gmail.com` · **Unmatched** · *"No candidate found for this email."*

But the same address is plainly visible in the pipeline drawer header for a candidate who is sitting on the **IQ / Tech Assessment** stage with status `in_progress` and an invite already sent.

---

## 2. TL;DR root cause

`rpa_cv."EmailID"` holds **more than one address in a single text column**, comma-joined:

```
pankaj.mondal@example.com,aiuserpankajmondal@gmail.com
```

The import matcher compares that **whole column** against the **single** address from the spreadsheet:

[assessmentImport.service.js:188](backend/src/services/assessmentImport.service.js#L188)

```js
WHERE cv."EmailID" ILIKE ${email}
```

`ILIKE` with no `%` wildcard is **exact (case-insensitive) whole-string equality**. So Postgres evaluates:

```
'pankaj.mondal@example.com,aiuserpankajmondal@gmail.com'  ILIKE  'aiuserpankajmondal@gmail.com'
→ false
```

The column is a *list*, but the query treats it as a *scalar*. Nothing about the candidate, the stage, or the file is wrong — the comparison simply can never be true for any candidate holding two or more addresses.

---

## 3. Evidence trail

### 3.1 The spreadsheet is clean

Parsed the actual uploaded workbook — 1 data row, and the email cell is a single, well-formed address:

```json
{
  "Candidate Name": "PANKAJ MONDAL",
  "Candidate Email": "aiuserpankajmondal@gmail.com",
  "Marks Scored": 57,
  "Percentage": 90.49122807,
  "Result": "Passed",
  "Section 1 Marks": 24, "Section 2 Marks": 23, "Section 3 Marks": 8
}
```

So the AI row parser ([assessmentImport.service.js:69-113](backend/src/services/assessmentImport.service.js#L69-L113)) had nothing to get wrong here — and the preview confirms it, since the row is classified `Unmatched` and **not** `Malformed`. `Malformed` is what a failed parse or a missing email produces ([lines 287-297](backend/src/services/assessmentImport.service.js#L287-L297)). The parse succeeded; the **lookup** failed.

### 3.2 The stored column is multi-valued by design

`EmailID` becoming a comma-joined list is not data corruption — the HR upload merge path deliberately appends new addresses onto the existing candidate:

[hrUpload.service.js:602](backend/src/services/hrUpload.service.js#L602)

```js
updateData.EmailID = appendUnique(existingCandidate.EmailID, tempCandidate.EmailID);
```

…where `appendUnique` ([hrUpload.service.js:506-515](backend/src/services/hrUpload.service.js#L506-L515)) joins de-duplicated values with commas. Every candidate who was ever uploaded twice under two addresses will look exactly like PANKAJ MONDAL.

`rpa_shortlisted_candidates.candidate_email` is populated straight from `rpa_cv."EmailID"` (`screening.service.js:1911`, `:1930`), so the drawer header renders the raw joined string — which is why a human reads it as "two emails" while Postgres compares it as one.

### 3.3 The misleading error message

When the first query returns nothing, the fallback runs to decide *which* message to show:

[assessmentImport.service.js:195-202](backend/src/services/assessmentImport.service.js#L195-L202)

```js
const cvRows = await prisma.$queryRaw`SELECT id FROM rpa_cv WHERE "EmailID" ILIKE ${email} LIMIT 1;`;
const cvId = cvRows?.[0]?.id ?? null;
return {
  ...
  matchNote: cvId ? 'Candidate found, but no open Assessment-stage journey.' : 'No candidate found for this email.',
};
```

**This fallback carries the identical defect.** So it also finds nothing, and the UI reports the strongest possible claim — *"No candidate found for this email"* — when in reality the candidate exists, is on the right stage, and is `in_progress`.

This is worth calling out separately: the wording actively sent the investigation in the wrong direction. Even after the primary matcher is fixed, this second query must be fixed in the same change or it will keep lying whenever the primary one legitimately misses.

### 3.4 Why the invite reached the candidate but the result didn't come back

An asymmetry that makes the bug look impossible from the outside:

- **Outbound** (invite email) — `assessmentInvite.service.js:73-81` → `sendAdHocCandidateEmail` → `resolveRecipients`, which **splits the address column on commas** (`emailNotification.service.js:87`, `:100`, `:238`). The invite is delivered fine.
- **Inbound** (result import) — `matchRowToPipeline()` does **not** split.

The candidate is therefore reachable but not findable. The send path understands the column is a list; the match path does not.

---

## 4. The codebase already solved this — twice

This exact class of bug was fixed before, for Zeko, and a shared helper was created for it:

[emailMatch.js:17-25](backend/src/utils/emailMatch.js#L17-L25)

```js
export function emailCandidates(value) {
  if (!value) return [];
  const seen = new Set();
  for (const part of String(value).split(/[,;]/)) {
    const email = part.trim().toLowerCase();
    if (email) seen.add(email);
  }
  return [...seen];
}
```

Its own file header states the problem verbatim:

> *Several columns (`rpa_shortlisted_candidates.candidate_email`, `rpa_cv."EmailID"`) hold more than one address in a single field ("a@x.com, b@y.com") … so a plain equality test misses the match.*

Existing consumers: [pipeline.service.js:442](backend/src/services/pipeline.service.js#L442) and [zeko.service.js:51](backend/src/services/zeko.service.js#L51). And the SQL-side equivalent already exists too — the HR upload dedupe matcher uses array overlap:

[hrUpload.service.js:583](backend/src/services/hrUpload.service.js#L583)

```sql
string_to_array(lower(replace(coalesce("EmailID", ''), ' ', '')), ',') && ${cleanEmails}::text[]
```

`assessmentImport.service.js` simply never adopted either pattern. This is a missed-consumer bug, not an unknown one.

---

## 5. Secondary defect found in the same line (latent, not the cause here)

`ILIKE` is not a safe equality operator: `_` and `%` inside the right-hand string are **wildcards**.

Since underscores are legal in email local-parts, `WHERE "EmailID" ILIKE 'first_last@x.com'` will also match `firstXlast@x.com` — attributing an assessment result to the **wrong candidate**. Rare, but it is a silent wrong-write rather than a visible miss, so it is the more dangerous of the two.

`ILIKE` appears to have been chosen only for case-insensitivity; `lower(...) = lower(...)` gives that without wildcard semantics. Any fix should drop `ILIKE` here rather than keep it.

---

## 6. Recommended fix

### 6.1 Primary — make both queries list-aware

Replace the scalar comparison in **both** places in `matchRowToPipeline()`.

`assessmentImport.service.js:188`:

```sql
WHERE ${email} = ANY(
        string_to_array(lower(regexp_replace(coalesce(cv."EmailID", ''), '\s', '', 'g')), ',')
      )
  AND p.current_stage_key = 'assessment'
  AND p.current_stage_status = 'in_progress'
```

`assessmentImport.service.js:195`:

```sql
SELECT id FROM rpa_cv
WHERE ${email} = ANY(
        string_to_array(lower(regexp_replace(coalesce("EmailID", ''), '\s', '', 'g')), ',')
      )
LIMIT 1;
```

Notes:

- `email` is already lower-cased and trimmed by the caller ([line 299](backend/src/services/assessmentImport.service.js#L299)), so only the stored side needs normalising.
- `regexp_replace(..., '\s', '', 'g')` strips whitespace around the separators, so `"a@x.com, b@y.com"` splits cleanly. (`hrUpload` uses `replace(..., ' ', '')`, which handles spaces only — the regex form additionally survives a stray tab/newline pasted into the column.)
- If you prefer exact consistency with the existing `hrUpload` pattern, the `&&` array-overlap form is equivalent for a single needle: `string_to_array(...) && ARRAY[${email}]::text[]`.
- **Separator caveat:** `emailCandidates()` splits on `,` **and** `;`, but the `hrUpload` SQL splits on `,` only. If semicolon-joined values exist in `rpa_cv`, use `regexp_split_to_array(lower(...), '[,;]')` instead of `string_to_array` so the SQL and JS agree. Worth a one-off data check before deciding (§8).

### 6.2 Alternative considered and not recommended

Fetch candidate rows into Node and filter with `emailCandidates()`. It reuses the shared helper, but requires either a broad scan or an unindexed `LIKE '%…%'` prefilter, and moves the join off the database. The SQL form above already matches an established pattern in this repo — prefer it.

### 6.3 Performance

No regression. `ILIKE` on a text column could not use a B-tree index either, so this was already a sequential scan. If `rpa_cv` growth ever makes it matter, the durable fix is a functional GIN index over the split array — a separate, optional follow-up, not part of this bug fix.

---

## 7. Sibling occurrences (same defect, different features)

The same `"EmailID" ILIKE ${email}` pattern appears in two more places and will fail for the same multi-email candidates. Recommend fixing them in the same pass:

| Location | Impact when the candidate has 2+ emails |
|---|---|
| [inboundEmailSync.js:50](backend/src/jobs/inboundEmailSync.js#L50) | An inbound candidate reply is never linked to their candidate/shortlist record |
| [zeko.service.js:829](backend/src/services/zeko.service.js#L829) | Zeko interview scores fail to write back when the fallback-by-email path is taken (`cv_id` absent) |

The `zeko.service.js` one is the sharper of the two: it is a **silent** write-back failure, and it sits in the same file that already imports `emailCandidates` for its *read* path — the read side was fixed, the write side was not.

---

## 8. Confirming this on staging before changing anything

```sql
-- 1. The candidate exists and the column is a list, not a scalar:
SELECT id, "Name", "EmailID"
FROM rpa_cv
WHERE "EmailID" ILIKE '%aiuserpankajmondal@gmail.com%';

-- 2. The current query returns nothing (reproduces the bug):
SELECT id FROM rpa_cv WHERE "EmailID" ILIKE 'aiuserpankajmondal@gmail.com';
-- expected: 0 rows

-- 3. The proposed predicate returns the candidate:
SELECT id, "Name", "EmailID"
FROM rpa_cv
WHERE 'aiuserpankajmondal@gmail.com' = ANY(
        string_to_array(lower(regexp_replace(coalesce("EmailID", ''), '\s', '', 'g')), ',')
      );
-- expected: 1 row — PANKAJ MONDAL

-- 4. Blast radius — how many candidates are currently unmatchable this way:
SELECT count(*) FROM rpa_cv WHERE "EmailID" LIKE '%,%' OR "EmailID" LIKE '%;%';

-- 5. Separator check — does anything use semicolons? (decides string_to_array vs regexp_split_to_array)
SELECT count(*) FROM rpa_cv WHERE "EmailID" LIKE '%;%';
```

---

## 9. Re-running the import after the fix

No data repair is needed, and no manual cleanup of the earlier attempt is required:

- The failed attempt was **preview only** — the modal reported `Import 0 matched results` and nothing was written. (Had it been committed, the row would have been stored with `status='unmatched'` and `pipeline_id = NULL`, [lines 467-488](backend/src/services/assessmentImport.service.js#L467-L488).)
- Re-uploading the same file after the fix will match. Duplicate detection is scoped to `pipeline_id + test_name` ([computeRowStatus](backend/src/services/assessmentImport.service.js#L218-L235)), and any previously stored `unmatched` row has `pipeline_id = NULL` — so it cannot be mistaken for an existing result and suppress the new one.

**One thing to watch on re-upload:** the test identity is taken **verbatim from the file name**, minus extension ([deriveTestNameFromFileName](backend/src/services/assessmentImport.service.js#L62-L65)). The earlier attempt shown in the screenshot was named `… - 2026TestReport.xlsx`, while the file on disk is `… - 2026TestReport-3.xlsx`. Those are **two different test clusters**, each getting its own section→skill mapping row in `rpa_assessment_test_mappings` and its own duplicate-detection scope. Re-upload under the file name you intend to keep, or you will accumulate near-duplicate mappings that a human has to reconcile later.

---

## 10. Summary

| | |
|---|---|
| **Root cause** | `matchRowToPipeline()` compares the single spreadsheet address against the *entire* `rpa_cv."EmailID"` column, which stores comma-joined multi-address values. Wildcard-free `ILIKE` is whole-string equality, so the match can never succeed for any candidate with 2+ addresses. |
| **Why the message was wrong** | The fallback "does this candidate exist at all?" query repeats the same defect, so the UI escalates to *"No candidate found"* instead of the accurate *"no open Assessment-stage journey."* |
| **Why it looked impossible** | The outbound invite path splits the address column on commas; the inbound match path does not. Reachable, but not findable. |
| **Fix** | Split the stored column and test membership (`= ANY(string_to_array(...))`) in both queries — the pattern already used at `hrUpload.service.js:583` and by `emailCandidates()`. Drop `ILIKE` while doing so (it treats `_` in emails as a wildcard). |
| **Also fix** | `inboundEmailSync.js:50`, `zeko.service.js:829` — identical defect. |
| **Data repair** | None. Re-upload the file after the fix. |

---

## 11. What shipped

Fix applied on 2026-08-25. The shared predicate lives beside the existing JS helper rather than
being copied a third time.

### 11.1 Files changed

| File | Change |
|---|---|
| [emailMatch.js](backend/src/utils/emailMatch.js) | **New** `emailMatchesSql(columnSql, value)` — the SQL sibling of `emailCandidates()`. Splits the stored column on `[,;]`, strips whitespace, lower-cases, tests array overlap. Takes the column as a `Prisma.Sql` fragment so one predicate serves every caller. |
| [assessmentImport.service.js](backend/src/services/assessmentImport.service.js) | Both queries in `matchRowToPipeline()` — the journey match **and** the existence fallback from §3.3. |
| [inboundEmailSync.js](backend/src/jobs/inboundEmailSync.js) | `lookupCandidate()` — sibling from §7. |
| [zeko.service.js](backend/src/services/zeko.service.js) | By-email score write-back fallback — sibling from §7; stale comment corrected. |
| [emailMatchSql.test.js](backend/src/tests/unit/emailMatchSql.test.js) | **New** — 18 unit tests. |

### 11.2 Decisions worth reviewing

- **`'[[:space:]]'`, not `'\s'`.** The `\s` form in §6.1 would not have survived: inside a JS
  template literal `\s` is an unknown escape and collapses to a bare `s`, so Postgres would have
  received a regex stripping the letter *s* from every address. The POSIX class sidesteps the
  escaping question entirely. Caught while implementing; §6.1 is left as originally written so the
  review trail is honest.
- **Empty needle returns literal `false`.** The predicate is interpolated into an `UPDATE` in
  `zeko.service.js`, where "match nothing" and "match every candidate in the table" are very
  different failures. Seven cases are pinned by test.
- **Separator `[,;]` confirmed safe.** The §8 data check returned **0** semicolon-joined values, so
  the wider split is a harmless superset that keeps the SQL and `emailCandidates()` in agreement.
- **`ILIKE` dropped, not kept.** Per §5 — this also closes the silent wrong-candidate write.

### 11.3 Verification

Read-only queries against the staging database (`SELECT` only, no writes):

| Check | Result |
|---|---|
| Old predicate, `aiuserpankajmondal@gmail.com` | **0 rows** — reproduces the bug exactly |
| New predicate | **cv 287 · PANKAJ MONDAL** |
| Full fixed `matchRowToPipeline()` query | **`pipeline_id 768, cv_id 287`** — the exact journey the import needs |
| Blast radius (§8.4) | **4** candidates carried multi-address `EmailID`, all previously unmatchable |
| Semicolon-joined values (§8.5) | **0** |
| Stored `"a@x.com, b@y.com"` (space after comma) | matches on **either** half |
| Mixed-case needle | matches |
| *Partial* address (`pankajmondal@gmail.com`) | **0 rows** — no accidental substring semantics |
| Null needle | **0 rows** — guard holds |
| Backend unit suite | **64/64 pass**, including 18 new |

One honest note on the data: `claudepankajmondal@gmail.com` legitimately matches **14** candidate
rows — several test candidates genuinely share that address. That is real data, not a fix artifact,
and the import path is unaffected because it additionally narrows by stage and status, and
`matchRowToPipeline()` already handles multiple hits by auto-matching the most recently entered
journey and *reporting* the rest ([lines 205-213](backend/src/services/assessmentImport.service.js#L205-L213)).

### 11.4 Still to do — by you

Re-upload the Evalground file. §9's caveat stands: the test identity comes verbatim from the file
name, so upload under the name you intend to keep or you will create a second test cluster.
