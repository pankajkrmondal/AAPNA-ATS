# Email Templates — business-friendly pass (iterations 1–3)

**Date:** 2026-08-25 · **Scope:** Email Template Management screen (`/email`) and the
template content behind it · **Environments:** dev/staging only — **production not touched**

## Why

The Email Templates screen was reviewed against how HR actually uses it. Two
complaints started it: the Phase 3 templates read as developer-written rather
than business-facing, and it was unclear whether the screen even showed every
template. Working through that surfaced a series of real defects, several of
which were only visible once someone clicked through the screen properly.

---

## Iteration 1 — content, naming, coverage

- **Duplicate subject lines.** `Stage Outcome — Approved/Rejected/Hold` all shared
  `Update on Your Application — {{position}}`, as did `Closure — Rejected` and
  `Closure — On Hold`. Because the compiled subject is also the branded email's
  headline band, a candidate could not tell good news from bad from either the
  inbox or the email itself. Approved and On Hold now have distinct subjects.
- **Template renames.** Six names read like internal log lines. `… (Generic)`
  suffixes dropped; `Interview — Please Confirm It Happened` → **Interview
  Attendance Check**; `Interview — Did Not Take Place` → **Interview No-Show
  Notice**; `Scorecard Invitation — HR/CEO` → **Scorecard Invitation — Leadership
  Round**. Names are runtime lookup keys, so every reference in
  `stageNotification.service.js`, `jobs/interviewOccurrence.js` and
  `interviewScorecard.service.js` moved in lockstep, and each seed entry's `find`
  matcher became `{ name: { in: [old, new] } }` so re-seeding stays idempotent.
- **Missing category filter.** `vendor_status` had no chip, so the two vendor
  templates were unreachable by category. Added as **Vendor Updates**.
- **Greeting for multi-recipient sends.** Scorecard invites addressed to more than
  one interviewer fell back to "Hi there," where interview scheduling already said
  "Hi all,". `interviewerGreeting()` was extracted from
  `interviewSchedule.service.js` into `utils/emailGreeting.js` and reused, rather
  than the rule being re-derived per send path.
- **One signature.** Four different sign-offs were in circulation. A single
  canonical block now renders centrally in `emailLayout.service.js` (mirrored in
  `utils/emailPreview.js`), and per-template sign-offs were removed.

### Corrections to the iteration-1 plan

- The `<\strong>` markup typo that plan claimed in two files **did not exist** —
  it was a misread of grep output, disproved by direct reads and by an `Edit`
  matching the correct `</strong>`. No fix was needed.
- The `neverSends` badge added here is **inert**: `rpa_stage_email_templates` has
  zero rows, so no template can ever be flagged. Same root cause as the empty
  "Outcome Emails" tab.

---

## Iteration 2 — screen polish

- Removed the "See which stage outcomes trigger which template" link (it led to an
  empty mapping table) and hid the "New Template" button behind
  `SHOW_NEW_TEMPLATE_BUTTON = false`.
- **Vendor greeting was broken for every vendor email**, not just edge cases:
  `vendorNotification.service.js` read `pipelineRow.vendor_name`, but
  `rpa_candidate_pipeline` **has no such column** — Prisma rejects the field
  outright — so the fallback `'partner'` fired every single time. It now resolves
  the real `rpa_cv.vendorName` via `cv_id`, falling back to `'Vendor Partner'`.
  Verified against live rows ("Sahil Dubey", "Haris Vendor").
- **Live Preview was leaking raw tokens.** Seven placeholders had no sample value,
  so the preview showed literal `{role_paragraph}` on Shortlist Notification —
  the highest-volume template — plus `{{interviewer_name}}`, `{{scorecard_link}}`
  and others. All now have samples.
- Category badges showed raw DB slugs inconsistently (`STAGE_OUTCOME` in the list,
  `stage_outcome` in the editor); both now reuse the friendly filter labels.
- The validation banner did not clear when the fix was made in the body (only the
  subject cleared it).
- Live Preview's "To:" was hard-coded to `candidate@example.com` even for panel,
  internal-HR and vendor templates.

---

## Iteration 3 — the structural problems

### Editing a fragment template silently disabled its branding

The most serious defect found. `useEmailIframeEditor` has two modes. Without a
`wrapper` prop it uses whole-document mode — `designMode='on'`, saving
`doc.documentElement.outerHTML`. The Email Templates page never passed a wrapper,
so for the ~20 fragment-bodied templates the browser parsed the fragment into a
full document and the **first edit-and-save wrote back `<html>…</html>`**. That
flips `isFullHtmlDocument()` to true, which makes `wrapBrandedEmail()` skip the
template — permanently removing the AAPNA header and footer from that template's
real emails. It had not bitten widely only because nobody had edited these
templates through the UI yet.

**Fixed by using the protected-chrome mode that already existed but was unused
here.** `EmailManagement.jsx` now builds `brandedPreviewParts()` and passes it as
`wrapper` for fragment templates. Three things follow: the Editor renders the real
branded AAPNA shell with only a `[data-editable-body]` slot editable (which is the
Outlook-like editing experience that was asked for), the header/footer cannot be
damaged by a stray edit, and `syncFromEditor()` saves only `slot.innerHTML` — so a
save can no longer rewrite a fragment into a document.

`utils/emailPreview.js` was refactored to expose `brandedPreviewParts()`, with
`wrapBrandedPreview()` rebuilt on top of it so the two renderings cannot drift.
The iteration-2 auto-jump to Live Preview was reverted — Editor is the default
again — and the now-redundant "Standard AAPNA header & footer are applied
automatically on send" caption was removed, since the branding is visible.

### The database had 44 templates; the seed script managed 36

The other **8 were orphans** that every iteration-1 content fix had missed, still
carrying a fourth sign-off variant ("AAPNA HR Team"). A name-by-name trace of every
lookup in `backend/src` showed **all 8 are unreachable**:

- `Interview Invitation`, `Offer Letter`, `Follow-Up Reminder` — no name lookup,
  and no `category: 'offer'` / `'follow_up'` lookup exists anywhere.
- The five `Closure — Joined / Joined and Left / Backed Out / Did Not Join /
  Candidate Withdrawn` — structurally unreachable, because `SILENT_FINAL_OUTCOMES`
  short-circuits in **both** `resolveTemplate()` and `sendStageOutcomeEmail()`
  before any template is resolved. Mapping one in the Pipeline Config UI still
  cannot make it send.

`prisma/retire-dead-email-templates.js` deactivates all 8 (`is_active = false`,
shown under the screen's existing "Inactive" badge) and re-files the five closures
under `stage_outcome` so they stop appearing beside unrelated alerts. **No row is
deleted** and the script is idempotent.

### Zeko templates had no AAPNA identity

`Zeko Interview Scheduled Invitation` and `Zeko Interview Cancelled Alert` were
full HTML documents with their own **blue** (`#185fa5`) and **red** (`#c0392b`)
gradient headers and **no AAPNA logo at all** — the only candidate-facing emails
with no AAPNA branding. Being full documents, the wrapper skipped them, and their
send path in `screening.service.js` never called it (the file did not even import
it). Both are now fragments, the CTA is AAPNA green, and both sends are wrapped.

### Double signature

Iteration 1's centralisation missed 10 templates that still carried their own
sign-off, which would have rendered twice — and with the branded editor that
became visible while editing, not just in preview. Fixed with a
`hasOwnSignature()` guard in `emailLayout.service.js` (mirrored client-side),
following the same shape-based-guard idiom as `isFullHtmlDocument()` so the
wrapper stays safe to apply to any body, including ones HR edits later. The two
seed-managed stragglers were cleaned up directly.

### Teams meeting block

There is **no Teams template** — the block is built by `buildTeamsBlock()` in
`interviewSchedule.service.js` because it interpolates the live join URL, Meeting
ID and passcode. It stays in code; the screen now explains what `{{teams_line}}`
(and `{{reason_line}}`, `{{notes_line}}`) render, so the token stops looking like
something is missing. **Making it HR-editable is deferred to Phase 4.**

---

## Verification performed

- `emailLayout.test.js` extended with signature-guard cases — 18/18 pass.
- Frontend production build passes.
- Post-seed database audit confirms: zero templates render a double signature;
  both Zeko rows are fragments carrying the AAPNA logo, green band and exactly one
  signature; all 8 retired rows still exist and are inactive; and only the 8
  legacy branded templates remain full documents.
- Vendor-notification integration tests pass (11/11 observed).

## Outstanding

- **Production has none of this** — neither the seed nor the
  `2026-08-12-vendor-status-templates.sql` DDL has been run against
  `recruitmentautomationdbProd`. Dev and staging share one database and are done.
- **No browser/visual verification** has been done at any point (no credentials);
  everything above is build-, test- and database-verified only.
- `pipelineStageEngine` / `pipelineClosure` integration suites have never
  completed a full run — both were cut short by local timeouts. Note these suites
  send real email via MS Graph.
- The `neverSends` badge stays inert until `rpa_stage_email_templates` has rows;
  the "Outcome Emails" mapping tab is empty for the same reason, which is why the
  link to it was removed.
- Deferred polish: mismatched chip styles on a list row, "Copy HTML" copying the
  unformatted string rather than the pretty-printed text on screen, a first-paint
  loading-sequence rough edge, the unreachable create-modal code path still in the
  file, and the unsaved-changes guard not covering top-nav/browser-back.
- **MRF Approval is deliberately untouched** per instruction: it still hardcodes
  `Dear Abhijit Roy & Sanghamitra Roy,` and bypasses the shared branded shell.
