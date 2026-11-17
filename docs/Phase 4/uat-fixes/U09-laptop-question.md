# U09 · Application form laptop question
**Release 1 · Low · 1 h · Depends on: none**

**Goal**
- **Today:** the candidate form asks "Has laptop for initial days?".
- **Change:** it asks "Do you have a personal laptop (with 8 GB RAM) that you can use for the initial few days?"
- **Done when:** the form shows the new wording.

## Changes
1. Candidate form: `frontend/src/pages/MissingJdUpload.jsx:52` gets the full question above. The Yes/No select at `:228-229` stays as it is.
2. Staff labels become **"Personal laptop (8 GB RAM) for initial days?"** in:
   - `frontend/src/components/CandidateDetailCard.jsx:119`
   - `frontend/src/pages/Candidates.jsx:1044` (it is upper-cased there; keep the casing style)
   - `backend/src/utils/duplicateCompare.js:68`
3. Leave the short "Has Laptop" column label in `CandidateScreening.jsx:2876-2878` as it is.

The field name `HasLaptopForInitialDays` doesn't change; no data or DDL changes.

## Tests
- `cd frontend && npm run build`
- If a test checks the old label in `duplicateCompare`, update it. Find it with `Grep "first days" backend/src/tests`.
- Add a one-line entry in `frontend/UI-CHANGELOG.md`.

## Handoff
**Built 11 Nov 2026.** Write-up: `docs/changelog/CHANGES-2026-11-11-U09-laptop-question.md`; line added to `frontend/UI-CHANGELOG.md`.
- **Candidate form:** `MissingJdUpload.jsx:52` now asks the full question. The Yes/No select (`:228-229`) is unchanged.
- **Staff labels** ("Personal laptop (8 GB RAM) for initial days?", each in its screen's casing):
  - `CandidateDetailCard.jsx:119`: Title Case, like its neighbours.
  - `Candidates.jsx:1058`: upper case. The brief said `:1044`; the line had moved.
  - `duplicateCompare.js:68`: sentence case.
- **Unchanged:** `CandidateScreening.jsx` "Has Laptop" (now at `:2913`), the field `HasLaptopForInitialDays`, the data. No flags, no DDL.
- **Tests:** `duplicateCompare` 11/11 (no test checked the old label); `npm run build` passes; full `npm run test:unit`: FULL_SUITE_RESULT.
- **For R1:** check the new wording on the staging candidate form. Nothing else is left over.
