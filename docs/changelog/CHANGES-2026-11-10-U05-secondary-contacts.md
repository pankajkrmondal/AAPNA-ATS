# U05 · Search finds a candidate by a second email or any phone, in any format (10 Nov 2026)

**Sheet:** Phase 3 UAT Fixes - Nov, U05. **Brief:** [U05](../Phase%204/uat-fixes/U05-secondary-contacts.md).
**HR report:** searching by a candidate's second email or phone did not find them.

## What changed
- **One merge rule, `backend/src/utils/contactMerge.js`:** `appendUnique` and the new `prependUnique` split on `, ; /` and treat "+91 98765 43210", "98765-43210" and "9876543210" as one number (emails compare in lower case). `withPrimaryEmailFirst` keeps the record's primary email first.
- **One phone predicate, `utils/phone.js`:** `phoneMatchesSql` (last 10 digits per stored part) and `phoneDigitsContainSql` (partial numbers). The Candidate Screening lookup now uses `phoneMatchesSql`.
- **Search Candidate and its CSV export:** the phone filter, and free text that looks like a number, match every stored number in any format. Emails keep `contains`, which already matched any address in the list. `buildWhereClause` is now async.
- **Uploads:** the parser prompt asks for every email and phone (`unique_key` is the first email). Duplicate matching compares phones by last 10 digits, so a "+91" re-upload no longer creates a second record.
- **No more overwrites:** the public missing-details form puts the typed number first and keeps the rest. Resume emails are appended, and only contacts printed in the resume are used. The Schedule dialog puts its number first and keeps the others.
- **Edit candidate (Search Candidate and Candidate Detail):** the primary email stays read-only, with new **Other emails** and **Phone numbers** tag inputs. The server checks every value, names a bad one, and keeps the primary first. The pipeline copy (`candidate_email`, `candidate_email_all`) follows through the existing sync.
- **Backfill:** `backend/scripts/backfill-extra-contacts.mjs` is a dry run by default; `--apply` appends contacts and logs them to `rpa_processing_log` (`U05_BACKFILL_EXTRA_CONTACTS`). An email that doesn't resemble the candidate is listed for review and never applied.

## Tests
- **Unit:** `contactMerge.test.js` 20/20 (new), `sectionC.test.js` 11/11. Full unit run: 1111/1111.
- **Integration (staging DB):** `secondaryContacts.test.js` 11/11. It covers the second email, "+91 98765 43210", "98765-43210", a partial number, free text, CSV export, the Screening lookup and the upload duplicate match.
- **Frontend:** `npm run build` passes.
- **Backfill dry run (staging):** 185 resumes scanned, 0 to add, 2 for review. Every phone printed in a resume was already stored. Nothing was applied.
