# U10 · Completed forms: an Analytics view and a morning bell note (11 Nov 2026)

**Sheet:** Phase 3 UAT Fixes - Nov, U10. **Brief:** [U10](../Phase%204/uat-fixes/U10-completed-forms.md).
**HR asked:** see the missing-details forms completed each day, by JD, without opening one bell alert per candidate. **No email** (decision).

## What changed
- **Endpoint `GET /api/pipeline/analytics/completed-forms`** (staff, `recruitment_pipeline`). It takes `range=yesterday|today|7` or `from` / `to` in India time. It defaults to yesterday and accepts up to 92 days.
  - It returns `{ range, total, jd_count, groups: [{ mrf_id, title, count, candidates: [{ cv_id, name, completed_at }] }] }`. The biggest JD comes first and "No JD yet" comes last.
  - **Completed** means `rpa_cv.details_completed_at`, which is set once, on the first full submission.
- **One JD per candidate**, so the group counts add up to the total. The JD is the open journey's MRF if there is one. Otherwise it is the most recent applicant link (a tag, or a "Position Applied" match). Otherwise the candidate is under "No JD yet". The query is `completedFormsWithMrf` in `mrfApplicants.service.js` and reuses `factsCte`.
- **Analytics → "Completed Forms" tab** (second tab). It has its own presets (Yesterday, Today, Last 7 days) plus custom dates, and keeps them in the URL. Each JD row expands to its candidates, and each candidate links to their profile.
- **Bell note `jobs/completedFormsDigest.js`:** runs at 09:00 IST (`0 9 * * *`) through `runJob`, behind `FORMS_DIGEST_ENABLED`.
  - It sends one note of type `candidate.forms_digest`, for example "12 forms completed yesterday across 4 JDs", with the top JDs listed. The note links to `/analytics?tab=completed-forms&from=<day>&to=<day>`, so it still shows the right day when opened later.
  - Nothing is sent when the total is 0.
  - The day is claimed in `rpa_settings` (`forms_digest.last_day`), so the local backend and staging never both send.
- **Role targeting in `notify()`:** the existing `roles` option now narrows to staff roles only (`recruiterTierSubset` in `config/roles.js`), so a vendor can never be reached. The note goes to `FORMS_DIGEST_ROLES`, which defaults to superadmin, admin, hr_admin_recruiter and hr. Plain recruiters are left out.

## Tests
- **Unit:** `completedForms.test.js` 26/26 (new). It covers the IST yesterday window, the range parser, grouping including "No JD yet", the note text, the claim and the role narrowing. Full unit run: 1178/1178.
- **Integration (staging DB):** `completedForms.test.js` 7/7. It drives the handler on a 2001 fixture day: tag, journey-wins, position match, no JD, closed journey, and the 23:59:59 / 00:00 IST bounds. It also dry-runs the job (2 recipients on staging, nothing written or claimed) and tests the claim on the real table. Real yesterday (10 Nov) had no completed forms on staging.
- **Frontend:** `npm run build` passes. `playwright.u10.config.js` 4/4 with a mocked API. It covers the deep link, expand → Profile, the presets and URL, and a bell click switching the tab.
