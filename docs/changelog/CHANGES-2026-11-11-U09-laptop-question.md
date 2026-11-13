# U09 · Application form laptop question (11 Nov 2026)

**Sheet:** Phase 3 UAT Fixes - Nov, U09. **Brief:** [U09](../Phase%204/uat-fixes/U09-laptop-question.md).
**HR ask:** the candidate should be asked plainly whether they have a personal laptop with 8 GB RAM for the first few days.

## What changed
- **Candidate application form (`MissingJdUpload.jsx`):** the question now reads "Do you have a personal laptop (with 8 GB RAM) that you can use for the initial few days?". The Yes/No choice is unchanged.
- **Staff labels:** "Personal laptop (8 GB RAM) for initial days?", in each screen's own casing: the Candidate Detail card (Title Case), the Edit candidate form in Search Candidate (upper case) and the duplicate-compare view (`utils/duplicateCompare.js`).
- **Unchanged:** the short "Has Laptop" label in the Screening details panel, the field name `HasLaptopForInitialDays` and the stored values.
- **No new flags, no DDL, no data changes.**

## Tests
- **Unit:** `duplicateCompare` 11/11. No test checked the old label.
- **Frontend:** `npm run build` passes.
