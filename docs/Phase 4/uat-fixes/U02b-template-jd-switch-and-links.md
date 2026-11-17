# U02b · JD switch and placement on the Email Templates page, and JD link sources
**12 Nov feedback · goes live 16 Nov (R16) · ~7 h · Depends on: the U02 Handoff and the 11 Nov JD link-card work (`docs/changelog/CHANGES-2026-11-11-jd-link-card.md`, still uncommitted)**

**Goal**
- **Today:**
  - Which emails carry the JD is fixed in code (`shouldAttachJd`). Where the JD card sits is fixed too: after the intro, or appended.
  - HR can edit only the subject and body on the Email Templates page.
- **Change (HR, 12 Nov):**
  - "Can we choose things from the templates page?" Each candidate template gets an **"Attach the JD"** switch, plus a **`{{jd_link}}`** chip that places the JD card.
  - JD links: a OneDrive JD gets an "anyone" link for now, and a **website** JD address is sent as it is.
- **Done when:**
  - Switching "Attach the JD" off on a template stops the JD on that email.
  - Placing `{{jd_link}}` puts the card at that spot.
  - With no token, it behaves as today.
  - A website JD link is sent with no OneDrive calls.

## Current state (verified 12 Nov)
**Templates:**
- Page: `frontend/src/pages/EmailManagement.jsx`. The editable fields are subject (`:693`) and body (`EmailEditorTabs`, `:708`); save sends `{subject, body_html}` (`:302`).
- Placeholder chips come from the template's `placeholders` array (`:248-257`, `components/common/EmailBodyEditor/Toolbar.jsx:61-74`).
- `OPTIONAL_PLACEHOLDERS` is at `:43`; `STRUCTURAL_PLACEHOLDER_NOTES` at `:54`; `dummyReplacements` for preview at `:73-126`.
- Table `rpa_email_templates` (`backend/prisma/schema.prisma:573-587`) has no options or flags column.
- Backend `controllers/emailTemplate.controller.js`: `updateEmailTemplate` (`:124-187`) writes subject and body after a required-placeholder check. Its `OPTIONAL_PLACEHOLDERS` is at `:19`.

**Rendering:**
- `compileTemplate` (`services/emailNotification.service.js:395-419`) does a plain `{{k}}` substitution and leaves unknown tokens in place.
- The precedent: `{{candidate_table}}` (`utils/panelCandidateTable.js:42`) becomes a marker div with `data-ats-candidate-table` in previews (`:44`, `interviewSchedule.service.js:740`). At send, `placeCandidateTable` (`:356-361`) replaces the marker or token, else appends.
- `insertAfterIntro` (`utils/candidateEmailBlocks.js:147`) uses the `data-ats-intro` marker.

**JD helpers** (`backend/src/services/jdAttachment.service.js`):
- `shouldAttachJd` (`:57-67`); `getMrfJdAttachment` (`:130-173`); `getMrfJdCandidateLink` (`:209-239`).
- `jdEmailParts` / `appendLink` (`:286-300`).
- `createAnonymousViewLink` (`onedrive.service.js:552-588`) reads only `link.webUrl` (`:585`) and never checks `link.scope`. The caller still labels it `kind:'anyone'` (`:225`).
- A website `jd_document_link` (editable, `mrf.controller.js:486`) today goes through `downloadDriveItem` and then `createAnonymousViewLink`. Both fail on the `/shares/` lookup and log warnings, and the email then falls back to the website link.

**Send paths and their template:**

| Path | Template | Where |
|---|---|---|
| Shortlist | category `shortlist`, "Shortlist Notification" | `screening.service.js:1906`; JD card `:2219-2227` |
| Change JD | the same shortlist template | `changeJd.service.js:199` |
| Move JD | the same shortlist template | `journeyMove.service.js:248` |
| Zeko | "Zeko Interview Scheduled Invitation" | `screening.service.js:2964`; JD `:2998-3008` |
| Evalground | no stored template; body hard-coded | `frontend/src/components/pipeline/AssessmentInviteModal.jsx:21-26`; send `assessmentInvite.service.js:78-88` |
| Schedule / reschedule | "Interview Scheduled — Candidate" / "Interview Rescheduled — Candidate" | `interviewSchedule.service.js:42-49`; `buildInterviewEmails :752-767` has the templateId; `candidateJdFor :860-862`; JD `:1139, :1663` |
| Approved | stage mapping, else "Stage Outcome — Approved" | `stageNotification.service.js:59-66`; `resolveTemplate :116`, not exported; the JD decision is at `pipeline.service.js:1511`, before the template is resolved |

On the shortlist path, when the recruiter edited the draft (`emailOverride`), no template is loaded.

## Changes
1. **DDL** `backend/prisma/ddl/2026-11-12-email-template-attach-jd.sql` (+ `.rollback.sql`):
   - `ALTER TABLE rpa_email_templates ADD COLUMN IF NOT EXISTS attach_jd boolean;` Null means "default rule" (`shouldAttachJd`).
   - An idempotent `UPDATE … SET placeholders = array_append(placeholders, 'jd_link') WHERE name IN (<the candidate templates above>) AND NOT ('jd_link' = ANY(placeholders))`. It never touches subject or body.
   - Then update `schema.prisma` and run `npx prisma generate`.
2. **Helper** in `jdAttachment.service.js`: `jdWanted(template, stageKey)` returns `template?.attach_jd ?? shouldAttachJd(stageKey)`.
   - Each path above reads its template row, and still does so when the body was overridden. Load the row for the flag only.
   - For Approved, export `resolveTemplate` and resolve it before the JD decision.
3. **Placement:** `placeJdLink(html, linkHtml)` in `candidateEmailBlocks.js`, modelled on `placeCandidateTable`:
   - It replaces the `{{jd_link}}` token or its marker div (`data-ats-jd-link`), else falls back to today's behaviour (after the intro on shortlists, else append).
   - When the JD is attached or absent, the token becomes `''`, so a raw token never reaches a candidate.
   - Use it in `appendLink` (`:300`), in `sendShortlistEmail` instead of `insertAfterIntro`, and in `sendStageOutcomeEmail` (`:258`).
   - Map `jd_link` to the marker in the preview tokens, as at `interviewSchedule.service.js:740`.
4. **Templates page:**
   - An "Attach the JD" `Switch` in the editor header. It shows the effective value: an empty value displays the default rule, with a "Default" tag.
   - Saving sends `attach_jd` (`:302`); the controller accepts `true | false | null`.
   - Add `jd_link` to both `OPTIONAL_PLACEHOLDERS` sets, to `dummyReplacements` (a sample card) and to `STRUCTURAL_PLACEHOLDER_NOTES` ("Where the JD card goes; when the JD is attached as a file this shows nothing").
5. **Evalground:**
   - Add the stored template "Evalground Assessment Invite", seeded **create-only** from the hard-coded body (`AssessmentInviteModal.jsx:21-26`) with `jd_link` in its placeholders.
   - The modal and `assessmentInvite.service.js` use it, and fall back to today's body if the row is missing.
6. **JD link sources** (`jdAttachment.service.js`):
   - A `isMicrosoftFileUrl(url)` helper matches `*.sharepoint.com`, `onedrive.live.com` and `1drv.ms`.
   - When there is no `jd_item_id` and `jd_document_link` is not a Microsoft URL, treat it as a **website JD**. Skip the download and the "anyone" call, and send the link as it is (`kind: 'website'`).
   - For OneDrive, set `kind: 'anyone'` only when Graph's reply has `link.scope === 'anonymous'`. Otherwise log `[JD attachment] MRF n: OneDrive returned a <scope> link, not an anyone link; the email keeps the internal link` and use the internal link.
7. **Docs:**
   - `docs/system/05-CONFIGURATION.md`: the column and the token.
   - The changelog `docs/changelog/CHANGES-2026-11-12-U02b-template-jd-switch.md`.
   - A line in `frontend/UI-CHANGELOG.md`.

## Tests
- **Unit** `backend/src/tests/unit/jdEveryEmail.test.js` (extend `:64-116`):
  - `jdWanted` with true, false and null for each stage, including Offer and Documents
  - `placeJdLink`: the token placed, the marker placed, no token, and an attached JD (token removed)
  - `isMicrosoftFileUrl`
  - the website-link path
  - a non-anonymous scope
- **Unit:** new `placeJdLink` cases in the style of `panelCandidateTable.test.js`. Run `sectionC.test.js`, which covers `candidateEmailBlocks`.
- **Integration:** `node src/tests/run-block.mjs src/tests/integration/jdEveryEmail.test.js`, plus one send with the switch off and one with `{{jd_link}}` placed. Graph stays intercepted.
- **Frontend:** `cd frontend && npm run build`.
- **Order:** run the DDL on staging **before** starting a backend that reads `attach_jd`, and guard the reads as `jd_item_id` does (`jdAttachment.service.js:83, 102-108`).

## Handoff
**Status: built, 12 Nov.** The DDL is **not applied** on staging: the dry run passed (1 template inserted, 5 updated), but the real run was blocked by a permission prompt. Write-up: `docs/changelog/CHANGES-2026-11-12-U02b-template-jd-switch.md`.
- **Helpers in `jdAttachment.service.js`:**
  - `jdWanted(template, stageKey)` is pure.
  - `loadTemplateAttachJd(id)` returns `true|false|null`, and `jdWantedForTemplate(templateOrId, stageKey)` is async. Both use `hasAttachJdColumn()`, which is cached.
  - `isMicrosoftFileUrl(url)`, `jdSourceOf(mrf)` (`item|onedrive|website|none`), `anyoneLinkFrom(made)`.
  - A website JD gets `reason: 'website'` and `kind: 'website'`.
- **Helpers in `candidateEmailBlocks.js`:** `placeJdLink(html, card, {fallback})`, `hasJdLinkSlot(html)`, and `JD_LINK_TOKEN`, `JD_LINK_ATTR`, `JD_LINK_PLACEHOLDER`.
- **Other exports:**
  - `createAnonymousViewLink` now returns `scope`.
  - `resolveTemplate` (stageNotification) is exported.
  - `loadAssessmentInviteTemplate()` and `ASSESSMENT_INVITE_TEMPLATE` (assessmentInvite). `getInviteState` now returns `template`.
- **Files changed:**
  - Backend: jdAttachment, onedrive, screening, changeJd, journeyMove, interviewSchedule, stageNotification, pipeline, assessmentInvite, `emailTemplate.controller.js`.
  - DDL pair `2026-11-12-email-template-attach-jd`. `schema.prisma` only gets a comment.
  - Frontend: `EmailManagement.jsx`, `AssessmentInviteModal.jsx`, `PipelineDrawer.jsx` (one prop), `DecisionEmailModal.jsx` (preview token).
- **Deviation:** `attach_jd` is not in the Prisma model. It is raw SQL, as `jd_item_id` is, so template reads never break when the DDL order is wrong. Because of that, `prisma generate` wasn't needed.
- **Tests:**
  - Unit: `jdEveryEmail` 25/25 and `sectionC` 23/23; all unit suites 1202/1202.
  - Integration: `jdEveryEmail` 11 passed, 1 skipped. The switch-off test skips until the DDL runs; it then flips `attach_jd` on the Evalground row for one send and restores it.
  - `npm run build` passes.
- **Left over:**
  1. Run the DDL on staging, then re-run the integration suite. Run it on production before or with the 16 Nov deploy.
  2. No browser run of the switch.
  3. Placing `{{jd_link}}` in a stored template wasn't run end to end. Only the Evalground text and unit cases were, so that the shared templates stayed untouched.
  4. A real "anyone" link on the tenant is still to be checked in R16.
