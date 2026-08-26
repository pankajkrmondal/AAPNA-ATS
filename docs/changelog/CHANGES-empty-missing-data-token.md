# Empty Missing-Data Token Fix & Rejection Alert Improvements — Session Log

> Date: 2026-07-06
> Incident: Production HR Upload produced a missing-data collection email whose link was
> `https://ats.aapnainfotech.com/missing-jd-upload?token=` (empty token). The portal
> correctly rejected it with "Invalid Link: Access token is missing from the URL."

Scope: stop empty `?token=` links at the source (upload reject rule, token guard,
reminder cron), verify all upload entry points are covered, and rework the internal
HR rejection alert email (wording + upload-source attribution).

---

## 1. Root cause

The portal token is `base64(candidate.EmailID)`. The HR-upload reject rule only
rejected a resume when **both** email AND phone were missing, so a phone-only resume
was accepted with `EmailID = ''`. That produced an empty token which was persisted to
`rpa_cv.cvMissingToken` *before* any recipient check, and the reminder cron rebuilt
the same broken link from it (`log.cvMissingToken || ''`). Data-dependent, not
environment-dependent — which is why staging "worked".

## 2. Reject rule tightened (`backend/src/services/hrUpload.service.js` ~line 1226)

**Before:** reject only if no valid email AND no phone.
**After:** reject if no valid email — a phone number alone no longer saves the resume.

- Rejection reason: `"<filename>: No valid email address found in resume"`.
- Job status flow unchanged (`REJECTED_SYSTEM`), still counted in `rejectedCount`
  and shown in the upload summary.
- "Valid email" means validated **and present in the resume text** — parser-fabricated
  addresses and the uploader's/vendor's own email do not count.

Resulting accept/reject matrix:

| Resume has        | Before                                   | After       |
|-------------------|------------------------------------------|-------------|
| Email + phone     | Accepted                                 | Accepted    |
| Email only        | Accepted                                 | Accepted    |
| Phone only        | Accepted (`EmailID=''` → broken link)    | **Rejected** |
| Neither           | Rejected                                 | Rejected    |

## 3. Token-generation guard (`backend/src/services/emailNotification.service.js`, `sendMissingDataEmail`)

Defense in depth for any caller (e.g. the recruiter merge path, or legacy rows that
already have an empty email): if `candidate.EmailID` is empty/blank the function now

- logs a warning,
- fires the internal HR "Email ID Null Alert",
- returns `false` **before** the `cvMissingToken` persist —

so an empty token can never be written to `rpa_cv` or emailed, regardless of path.

## 4. Reminder-cron guard (`backend/src/jobs/reminderScheduler.js`, `missing_jd` branch)

If a pending reminder's stored `cvMissingToken` is null/empty, the scheduler now skips
it with a warning and stamps `responded_at` (same pattern as the existing
orphaned-record guard) instead of emailing a broken `?token=` link until max reminders.

## 5. All upload entry points verified — one shared fix covers everything

Vendor upload has **no separate parse path**: `POST /api/vendor/upload`
(`vendor.controller.js`) funnels into the same `dispatchBatchParsing` →
`runBatchParsing` pipeline as HR upload; only the `source` string and vendor
attribution differ. The only two `rpa_cv.create` sites in the backend are inside
`hrUpload.service.js` (main parse + recruiter merge), both behind the email gate.

Covered sources: **HR manual upload**, **vendor portal** (incl. reprocess), **email
intake** (`jobs/emailResumeIntake.js`), and the **BullMQ resume worker**
(`workers/resumeWorker.js`).

## 6. "Email ID Null Alert (Internal HR)" template reworked

**Old body** (plain text, but sent with `contentType: 'HTML'`, so it rendered as one
run-together paragraph): "…the email ID for one of the candidates is missing in the
system… kindly update the email ID…" — misleading, since the CV is now rejected, not
waiting for an update.

**New body** (proper HTML, `prisma/seed-email-templates.js` `EMAIL_NULL_BODY` + live
`rpa_email_templates` row #9):

> Dear HR Team,
>
> This is to inform you that the candidate's resume does not contain an email address.
> As the email ID is mandatory, the system could not process the resume and has
> rejected the CV.
>
> **Candidate Name:** {{candidate_name}}
> **Uploaded By:** {{uploaded_by}}
>
> Best regards,
> System Notification

Placeholders are now `['candidate_name', 'uploaded_by']`.

## 7. Upload-source attribution in the alert

`sendEmailIdNullAlert(candidateName, hrUserEmail, uploadedBy)` gained an optional
third parameter, filled at the reject site per source:

| Source        | "Uploaded By" line                                       |
|---------------|----------------------------------------------------------|
| Vendor portal | `Vendor — <vendor name> (<vendor email>)` (attribution also covers staff uploading on behalf of a vendor) |
| HR upload     | `HR Upload — <uploader full name> (<uploader email>)`    |
| Email intake  | `Email Intake — received from <sender email>`            |
| Token guard (§3, no batch context) | `Uploader — <uploader email>`, else "Not available" |

## 8. Files changed

- `backend/src/services/hrUpload.service.js` — reject rule, rejection reason,
  uploaded-by string, updated comments/log lines.
- `backend/src/services/emailNotification.service.js` — empty-email guard in
  `sendMissingDataEmail`; `uploadedBy` param + `uploaded_by` placeholder in
  `sendEmailIdNullAlert`.
- `backend/src/jobs/reminderScheduler.js` — empty-token skip in the `missing_jd`
  reminder branch.
- `backend/prisma/seed-email-templates.js` — new `EMAIL_NULL_BODY` (HTML) and
  placeholder list.
- DB (`rpa_email_templates` row #9) — updated in the dev database via a targeted
  one-off script (deliberately not a full re-seed, to avoid overwriting admin-edited
  templates).

## 9. Production rollout checklist

1. Deploy the code changes above.
2. Update the prod `rpa_email_templates` "Email ID Null Alert (Internal HR)" row
   (`body_html` + `placeholders`) — targeted update, or re-run
   `node prisma/seed-email-templates.js` if prod templates have not been hand-edited.
   Ship this together with the code, since the code fills `{{uploaded_by}}`.
3. Clean existing bad rows:
   `UPDATE rpa_cv SET "cvMissingToken" = NULL, "cvMissingTokenStatus" = NULL WHERE "cvMissingToken" = '';`
4. Check why the original broken email was *delivered*: either
   `EMAIL_REDIRECT_TO_TEST=true` in the prod env or a seeded `missingData.to`
   fallback in `rpa_settings`.

## 10. Verification

1. HR-upload a resume with phone but no email → rejected with "No valid email address
   found in resume"; HR alert arrives with **Uploaded By: HR Upload — <name> (<email>)**;
   no `rpa_cv` row / token created.
2. Same via the vendor portal → identical, with **Uploaded By: Vendor — <name> (<email>)**.
3. Upload a resume with a valid email + other missing fields → missing-data email sends
   with a non-empty token; the portal link opens without "Access token is missing".
4. Seed an `rpa_email_log` row (`email_type='missing_jd'`) whose candidate has a NULL
   `cvMissingToken` → reminder scheduler skips it with a warning and stamps
   `responded_at`.

## Known separate defect (out of scope)

`sendMissingDataEmail` logs `email_type: 'data_collection'` but the reminder query
joins on `email_type = 'missing_jd'` — this mismatch likely prevents candidate
missing-data reminders from firing at all and can make `data_collection` rows fall
into the MRF branch. Tracked separately.
