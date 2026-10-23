# L07 · Editable JD label (no MRF)

**Date:** 22 Oct 2026 · **Plan:** `PLAN-Phase3-in-Phase4.md` L07; design approved by Harish on 22 Oct ("ATS L06 & L07 designs" canvas, decision D8 A).
**Source:** RT feedback §3, second half: "If there is no MRF, the recruitment team should have the option to modify/add the date displayed against the JD to identify the most recent version."

**Status:**
- **Tested on 22 Oct:**
  - unit tests: `tests/unit/jdSendLabel.test.js` 8/8 pass;
  - the frontend builds.
- **DDL:** applied on staging (`recruitmentautomationdb`) on 22 Oct, after a dry run. Not applied on production.
- **Waiting on:** `npx prisma generate`. It needs the dev backend and the queue worker stopped (Windows EPERM). Until it runs, the MRF list errors on the new columns.
- **Not checked in the browser yet.**
- Nothing is deployed or committed.

## What users see
- **MRF page list:** under each role, a JD sent without an MRF shows `<label> · <JD date>`. With no JD date set, the created date is used.
  - The newest JD date for each role (case and spacing ignored) gets a green **Latest** tag.
  - A pencil button opens a small editor: label (up to 60 characters, optional) and JD date. Save or Cancel.
- **Rows with an MRF** show `MRF-<id>` instead. The label is read-only: the MRF's reference and date name the JD everywhere (N19).
- **Details window:** a "JD Label & Date" field with an Edit button, or read-only text when an MRF exists.
- **MRF CSV:** gains two columns, "JD Label" and "JD Date".
- **Who can edit:** admin, superadmin, recruiter and HR (the same as MRF closure).

## Rules (`backend/src/utils/jdSendLabel.js`)
| Rule | Detail |
|---|---|
| Editable | Only while `rpa_mrf_jd_send.mrf_id` is null |
| Dated by | `version_date`, else the created day (India time) |
| Latest | Newest date per normalised role among rows with no MRF; on a tie, the newer row. Worked out across all rows, not one page |
| Input | Label is trimmed and single-spaced; empty clears it; 60 characters or fewer. Date must be a real YYYY-MM-DD; empty clears it |

## Code
- **DDL:** `backend/prisma/ddl/2026-10-22-jd-send-version-label.sql`, plus a `.rollback.sql`. Adds `version_label VARCHAR(60)` and `version_date DATE`, both nullable, with comments.
- **Prisma:** `schema.prisma` model `rpa_mrf_jd_send` gains both fields.
- **API:**
  - `PATCH /api/mrf/:id/version-label` returns 409 when an MRF is linked. Each change is logged in `rpa_processing_log` with source `JD_LABEL`.
  - `GET /api/mrf` and `GET /api/mrf/:id` return `version_label`, `version_date` (YYYY-MM-DD), `jd_day`, `label_editable` and `is_latest`.
- **Frontend:**
  - new `components/mrf/JdLabelEditor.jsx`;
  - `pages/MRF.jsx`;
  - `utils/mrfLabel.js` (`jdSendSuffix`);
  - `services/mrfService.js` (`updateVersionLabel`).

## Release steps
1. Stop the backend and the worker, then run `npx prisma generate`.
2. Production:
   ```
   node scripts/run-ddl.mjs --env .env.production --expect-db recruitmentautomationdbProd --file prisma/ddl/2026-10-22-jd-send-version-label.sql --dry-run
   ```
   Then run the same command without `--dry-run`.
3. Deploy the backend, then the frontend.

## Rollback
1. Deploy the previous build.
2. Run `2026-10-22-jd-send-version-label.rollback.sql`. Every label and JD date that was set is lost.

## Still to test
In the browser:
- edit a label and a date, then reload to confirm they persist;
- "Latest" moves to the newer JD;
- a row with an MRF cannot be edited;
- the CSV columns.
