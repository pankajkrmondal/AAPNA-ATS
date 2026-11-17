# U05 · Search by a second email or phone
**Release 1 · Medium · 7 h · Depends on: none. U08 reuses this chat's `prependUnique`.**

**Goal**
- **Today:** searching by a candidate's second email or phone doesn't find them.
- **Change:**
  - search matches every email and phone, in any format (+91, spaces, dashes)
  - second values are appended, not overwritten
  - the other emails and phones can be edited in Edit candidate
- **Done when:** a search by a second email, or by any of the candidate's numbers, finds them.

## Cause (verified)
**Schema.** There are no extra columns. `rpa_cv.EmailID` and `rpa_cv.ContactNumber` are free text holding comma lists (`backend/prisma/schema.prisma:87-88`). The shortlist copy is `rpa_shortlisted_candidates.candidate_email_all` (`:340`), kept in step by `backend/src/services/candidateSync.service.js:26`.

**Helpers that already handle every format:**
- `normalisePhone` (`backend/src/utils/phone.js:21-29`)
- `emailCandidates` and `emailMatchesSql` (`backend/src/utils/emailMatch.js:22-64`)

**Search Candidate.** `buildWhereClause` (`backend/src/services/candidate.service.js:627-705`):
- `EmailID contains` (`:633`)
- `ContactNumber contains <raw text>` (`:638-640`), so "+91 98765 43210" misses "9876543210"
- the free-text search (`:646-655`) doesn't look at phone
- the CSV export uses the same clause

**The screening lookup** (`backend/src/services/screeningV2.service.js:163-228`) already splits stored values; the phone SQL is at `:184-187`. So failures there mean the **second value was never stored**:
1. The Gemini prompt asks for a single `EmailID` (`backend/src/services/hrUpload.service.js:268-269`). The email fallback only runs when none is found (`:1307-1315`).
2. `sanitizeMatchContacts` (`:71-76`) and `findExistingCandidateMatch` (`:495-512`) compare raw phone strings, so a "+91…" re-upload creates a **new** record.
3. `appendUnique` (`:550-567`) splits only on `,` and compares exact strings.
4. The public missing-details form **overwrites** both fields (`backend/src/controllers/candidate.controller.js:465, 497-519, 612-633, 647-650, 702-705`).
5. The Schedule dialog replaces the phone with a single number (`backend/src/services/pipeline.service.js:579-592`).
6. Edit candidate:
   - Email is read-only in `frontend/src/pages/Candidates.jsx:908-910` and in `frontend/src/pages/CandidateDetail.jsx:480-482`.
   - Phone is one input (`Candidates.jsx:912-919`, `phoneRule` at `frontend/src/constants/candidateFields.js:47-51`).
   - Server side, `backend/src/utils/candidateFieldRules.js:45-50` rejects email lists and checks only the first phone.

## Changes
1. **Helpers:**
   - `phoneMatchesSql(columnSql, value)` in `utils/phone.js`, taken from `screeningV2.service.js:184-187`. Make the lookup use it too.
   - `appendUnique` (`hrUpload.service.js:550-567`) splits on `[,;/]` and dedupes by key: the last 10 digits for a phone, lower case for an email.
   - A new `prependUnique(existing, incoming, kind)` puts the new value first and keeps the rest.
   - Export both from one util, so U08 can import them.
2. **Search Candidate:** for the `email`, `phone` and free-text `search` filters, first resolve matching ids with `$queryRaw`, using `emailMatchesSql` / `phoneMatchesSql` and a digits-only check when the search text looks like a phone. Then add `{ id: { in: ids } }`. Callers of `buildWhereClause`, including the CSV export, await this.
3. **Capture every value:**
   - The Gemini prompt asks for all emails, comma-separated. `unique_key` stays the first one.
   - Phones are compared in normalised form for duplicate matching.
   - The public form and the Schedule dialog use `prependUnique`.
4. **Edit candidate,** in both forms:
   - The primary email stays read-only.
   - Add an "Other emails" tag input and a "Phone numbers" tag input.
   - Store them as `primary, other1, other2`.
   - Server side, `candidateFieldRules.js` validates each value and keeps the primary email first.
   - `candidateSync` updates `candidate_email_all`.
5. **Backfill:** a new `backend/scripts/backfill-extra-contacts.mjs`. It only reports by default; `--apply` appends any extra emails and phones found in `rpa_cv.resume_full_text`, logged to `rpa_processing_log`.

## Tests
- **Unit:** `appendUnique`, `prependUnique`, `phoneMatchesSql` and the field rules (add them to the existing suite, or create `src/tests/unit/contactMerge.test.js`).
- **Integration (staging):** search by a second email, by "+91 98765 43210" and by "98765-43210".
- `cd frontend && npm run build`

## Handoff
**Status:** built and tested (unit, staging integration, frontend build). Write-up: [CHANGES-2026-11-10-U05](../../changelog/CHANGES-2026-11-10-U05-secondary-contacts.md).

**For U08:** `import { prependUnique } from '../utils/contactMerge.js'` (file `backend/src/utils/contactMerge.js`).
- `prependUnique(existing, incoming, kind?) → string`: the incoming value(s) go first, the rest are kept, and the list is joined with ", ".
- `kind` is `'email' | 'phone'`; if it is left out, a value with `@` is an email.
- Example: `prependUnique(cv.ContactNumber, tenDigits, 'phone')`, as in `pipeline.service.js` `updateCandidatePhoneForPipeline`.
- The same file has `appendUnique` (same signature), `withPrimaryEmailFirst(incoming, existing)`, `splitContacts(value, kind)` and `contactKey(value, kind)`.
- `utils/phone.js` adds `phoneMatchesSql(columnSql, value)` and `phoneDigitsContainSql(columnSql, digits)`.

**Files:**
- New: `utils/contactMerge.js`, `scripts/backfill-extra-contacts.mjs`, `tests/unit/contactMerge.test.js`, `tests/integration/secondaryContacts.test.js`, and `frontend/src/components/candidates/ContactTagsSelect.jsx`.
- Changed: `utils/phone.js`, `utils/candidateFieldRules.js`, `services/candidate.service.js` (`buildWhereClause` is now **async**; `looksLikePhone`, `phoneSearchSql`), `services/hrUpload.service.js`, `services/screeningV2.service.js`, `services/pipeline.service.js` and `controllers/candidate.controller.js`.
- Frontend: `constants/candidateFields.js`, `pages/Candidates.jsx` and `pages/CandidateDetail.jsx`.

**Tests:** unit 20/20 (new) and 1111/1111 (full run); staging integration 11/11; frontend build passes.

**Where this differs from the brief:**
1. The email filters keep `contains`. It already matches any address in the list and still allows a partial address. Only phone needed the id lookup.
2. The public form **appends** resume emails rather than prepending them, so the primary address (the missing-details token, `unique_key`) stays put. Phones are prepended as the brief says.
3. The backfill never applies an email that doesn't look like the candidate's, because pipeline mail goes to every stored address.

**Left over:**
- The Edit form tag inputs passed the build but weren't checked in a browser; check them in R1 UAT.
- Production backfill: dry-run it in R1 and review the list before `--apply`. On staging it found 0 to add and 2 for review (#3435, #3436).
- Integration tests must not use 9876543210. It is the upload placeholder, and many rows hold it.
