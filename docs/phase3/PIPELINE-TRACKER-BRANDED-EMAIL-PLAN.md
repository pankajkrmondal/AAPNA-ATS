# Pipeline Tracker — Unified Branded Email Format

**Status:** Plan / not yet implemented
**Author:** Analysis for RT, 2026-07-25
**Scope:** Every email triggered from the *Interview Pipeline Tracker* module (Approve / Hold / Reject, Schedule / Reschedule / Cancel interview, reminders, scorecard invitations, occurrence-confirm nudges).
**Goal:** All of them ship inside the one AAPNA branded shell (green header with logo, body card, footer) that the rest of the project already uses — only the **body content** differs per email. The admin's "preview before send" popup must show exactly the wrapped email that will be delivered.

---

## 1. The problem, precisely

Emails in this project currently fall into two visually different families.

**Family A — branded (what we want everywhere).** Full HTML documents with the green `#7a922e` header band, the AAPNA GPTW logo, a white rounded body card on an `#f4f6f9` page, and a grey footer. Examples:

| Template / sender | Where the shell lives |
| --- | --- |
| `Welcome Candidate Email` | `WELCOME_BODY`, [seed-email-templates.js:112](../../backend/prisma/seed-email-templates.js#L112) |
| `Shortlist Notification` | `SHORTLIST_BODY`, [seed-email-templates.js:35](../../backend/prisma/seed-email-templates.js#L35) |
| `Rejection — Post Interview`, `Application On Hold` | `statusBody()`, [seed-email-templates.js:103](../../backend/prisma/seed-email-templates.js#L103) |
| `Duplicate Resume Alert (Internal HR)` | inline in the seed |
| MRF request to Hiring Manager | hard-coded in [emailNotification.service.js:865](../../backend/src/services/emailNotification.service.js#L865) |

**Family B — bare HTML fragments (the Pipeline Tracker emails).** These are stored as loose `<p>` tags with no `<html>`, no header, no footer, no brand colour. They are what your screenshots show as "Technical Round 1 scheduled" and "Interview panel — Technical Round 1":

```
INTERVIEW_SCHED_CANDIDATE_BODY = `<p>Dear {{candidate_name}},</p>
<p>Your <strong>{{stage_label}}</strong> interview for <strong>{{position}}</strong> has been scheduled.</p>
...`
```
— [seed-email-templates.js:652-698](../../backend/prisma/seed-email-templates.js#L652-L698)

The complete Family-B inventory (all Pipeline Tracker):

| # | Template name / sender | Category | Defined at |
| --- | --- | --- | --- |
| 1 | `Interview Scheduled — Candidate` | interview | seed L652 |
| 2 | `Interview Scheduled — Panel` | interview | seed L660 |
| 3 | `Interview Cancelled — Candidate` | interview | seed L668 |
| 4 | `Interview Cancelled — Panel` | interview | seed L675 |
| 5 | `Interview Rescheduled — Candidate` | interview | seed L681 |
| 6 | `Interview Rescheduled — Panel` | interview | seed L691 |
| 7 | `Scorecard Invitation — Interviewer` | interview | seed L702 |
| 8 | `Scorecard Invitation — HR/CEO` | interview | seed L710 |
| 9 | `Interview — Please Confirm It Happened` | interview | seed L720 |
| 10 | `Stage Outcome — Approved (Generic)` | stage_outcome | seed L975 |
| 11 | `Stage Outcome — Rejected (Generic)` | stage_outcome | seed L989 |
| 12 | `Stage Outcome — Hold (Generic)` | stage_outcome | seed L1003 |
| 13 | Interview reminder — candidate | *(hard-coded, no template row)* | [interviewReminder.js:185](../../backend/src/jobs/interviewReminder.js#L185) |
| 14 | Interview reminder — interviewer | *(hard-coded, no template row)* | [interviewReminder.js:217](../../backend/src/jobs/interviewReminder.js#L217) |
| 15 | Scorecard invite hard-coded fallback | *(inline when template row missing)* | [interviewScorecard.service.js:181](../../backend/src/services/interviewScorecard.service.js#L181) |

Rows 10–12 are the ones behind **Approve / Hold / Reject**; rows 1–6 behind **Schedule / Reschedule / Cancel**.

---

## 2. Why "just paste the header HTML into each template" is the wrong fix

It is the obvious move and it fails for four concrete reasons in *this* codebase:

1. **The recruiter edits the body before sending.** The Pipeline Drawer's outcome and schedule modals hand the compiled body to `SimpleHtmlEditor`, a `designMode` iframe ([PipelineDrawer.jsx:66-145](../../frontend/src/components/pipeline/PipelineDrawer.jsx#L66-L145)). On every keystroke it round-trips **`doc.documentElement.outerHTML`** back into state. If the header/footer chrome is inside the edited value, the recruiter is editing the brand shell — they can delete the logo, break a `<table>`, or drop the footer, and that damaged HTML is what gets sent (`candidateBody ?? defaults.candidate.body` — [interviewSchedule.service.js:450-457](../../backend/src/services/interviewSchedule.service.js#L450-L457)). Chrome must live **outside** the editable region.

2. **15 copies of the same shell drift apart.** Any future logo or colour change means editing 12 template rows plus 3 hard-coded strings.

3. **Two of the fifteen have no template row at all** (rows 13–14, and 15's fallback). A template-only fix cannot reach them.

4. **The Teams block would land outside the card.** `ensureTeamsBlock()` appends the Join-meeting block by string concatenation when the recruiter-edited body lacks the join URL ([interviewSchedule.service.js:214-218](../../backend/src/services/interviewSchedule.service.js#L214-L218)). Appended to a full document, the block lands *after* `</html>` — outside the branded card, exactly the visual break we are trying to remove.

**Therefore: wrap at send time, not in the template.**

---

## 3. Design — one shared layout function

### 3.1 The core primitive

New file: `backend/src/services/emailLayout.service.js`

```js
/**
 * Wraps a body fragment in the standard AAPNA branded email shell.
 * Idempotent: a body that is already a full HTML document is returned
 * unchanged, so legacy branded templates keep rendering exactly as today.
 */
export function wrapBrandedEmail(bodyHtml, { title, subtitle, accent } = {}) { … }

/** True when the string already carries its own <html>/<body> shell. */
export function isFullHtmlDocument(html) { … }
```

Behaviour contract:

- **Input** a fragment (`<p>Dear …</p>`), **output** the full document: `#f4f6f9` page → 620px white card, `border-radius:12px` → green `#7a922e` header with the GPTW logo and `title` → body → "Best regards / AAPNA Recruitment Team" block → grey footer with the confidentiality line.
- **`isFullHtmlDocument()` guard is the safety valve.** Detect `<html`, `<!DOCTYPE`, or `<body` (case-insensitive). If present, return the input untouched. This is what makes the change safe to apply broadly: the Welcome/Shortlist/Duplicate templates and any admin-authored full-document template pass straight through and look identical to today.
- **Markup style must be table-based**, copying `statusBody()` at [seed-email-templates.js:104](../../backend/prisma/seed-email-templates.js#L104) — Outlook desktop does not honour `<div>`+flex layouts. Do not invent new markup; lift that exact table skeleton.
- **`accent`** lets Reject/Cancel optionally use a muted header while keeping identical structure. Default is the standard green. *Recommendation: ship v1 with green everywhere and treat accent colour as a later refinement — a red header on a rejection is a tone decision for HR, not a technical one.*

### 3.2 Where the wrap is applied

Wrap at the **last possible moment**, immediately before `sendGraphEmail()`, and after `ensureTeamsBlock()`. This gives one invariant that resolves problem #1 and #4 together:

> The recruiter edits, and the preview displays, a **fragment**. The shell is added after the fragment is final.

Call sites to change (all backend):

| File | Function(s) | Change |
| --- | --- | --- |
| `services/stageNotification.service.js` | `sendStageOutcomeEmail`, `sendAdHocCandidateEmail` | wrap `bodyHtml` / `body` at the `sendGraphEmail` call |
| `services/interviewSchedule.service.js` | `scheduleInterviewRound`, `rescheduleInterviewRound`, `cancelInterviewRound` | wrap `candidateEmail.body` and `panelEmail.body` **after** `ensureTeamsBlock()` |
| `services/interviewScorecard.service.js` | `dispatchScorecards` | wrap `compiled.html` and the inline fallback |
| `jobs/interviewReminder.js` | the sweep | wrap both hard-coded reminder bodies |
| `jobs/interviewOccurrence.js` | confirm-nudge sender | wrap `compiled.html` |

Ordering inside a send becomes exactly:

```
compile template  →  recruiter edit (optional)  →  ensureTeamsBlock  →
wrapBrandedEmail  →  injectTrackingPixel  →  sendGraphEmail
```

`injectTrackingPixel` stays last because it inserts before `</body>`, which only exists once wrapping has run ([emailNotification.service.js:162-171](../../backend/src/services/emailNotification.service.js#L162-L171)). **This is a real ordering bug today for stage-outcome emails**: `injectTrackingPixel` is currently called on a fragment with no `</body>`, so it falls through to the append branch and the pixel `<img>` is emitted as a trailing sibling. It works, but wrapping fixes it properly.

### 3.3 What gets stored in the database

Store the **fragment** in `rpa_email_messages.body_html`, not the wrapped document.

Reason: the reminder scheduler re-sends stored bodies with a banner prepended (`reminderBanner + log.body_html` — [reminderScheduler.js:208](../../backend/src/jobs/reminderScheduler.js#L208)). If the stored value were a full document, the banner would land above `<!DOCTYPE>`. Storing fragments keeps that path working and keeps the conversation view (which renders stored bodies inline) free of nested page chrome.

*Trade-off, stated plainly:* the stored copy is then not byte-identical to what was delivered. Since the wrap is deterministic, the delivered form can always be reconstructed by re-wrapping. If exact-delivered-copy audit is a requirement, add a nullable `rendered_html` column instead of changing what `body_html` holds — but that is a bigger change and is **not** recommended for v1.

---

## 4. Frontend — making the popup show the real thing

This is the half of the work your question is really about: *"most of case we are show to admin email content on popup before send so that admin can see this format what will be go."*

Today the modals show a bare fragment in a small WYSIWYG box. After this change the admin must see the fragment **inside** the branded shell, while still only being able to type into the fragment.

### 4.1 The chosen pattern: chrome-outside, editable-inside

Split `SimpleHtmlEditor` into a two-layer component:

```
┌─ Branded preview iframe (read-only shell) ───────────┐
│  ┌ green header + logo ─────────────────────────┐    │   ← rendered, not editable
│  └──────────────────────────────────────────────┘    │
│  ┌ EDITABLE REGION (designMode) ────────────────┐    │   ← the only thing onChange sees
│  │  Dear SAURABH KUMAR, …                       │    │
│  └──────────────────────────────────────────────┘    │
│  ┌ footer ──────────────────────────────────────┐    │   ← rendered, not editable
│  └──────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────┘
```

Two viable implementations — **pick option A**:

**Option A (recommended): one iframe, `contenteditable` on the body slot only.**
The iframe's `srcDoc` is the full wrapped shell, but instead of `doc.designMode = 'on'`, set `contenteditable="true"` on a single `<div data-editable-body>` that the wrapper emits around the body slot. `syncFromEditor()` then reads `doc.querySelector('[data-editable-body]').innerHTML` instead of `documentElement.outerHTML`. The admin sees the true email, edits only the middle, and `onChange` yields a clean fragment — which is exactly what the backend now expects.

*Requires:* `wrapBrandedEmail` accepts an `editableSlot: true` option that adds the `data-editable-body` attribute (harmless in delivered mail; strip it on the send path for cleanliness).

**Option B: two panes — a read-only branded preview above, the existing editor below.** Less elegant, more scrolling, but a smaller diff. Fall back to this only if the `contenteditable` sub-region proves fiddly with the existing toolbar `execCommand` calls.

### 4.2 Serving the shell to the frontend

The preview endpoints must return the chrome so the UI can render it without duplicating the HTML in React. Extend each preview payload with a `wrapper` object:

```json
{
  "subject": "Technical Round 1 scheduled — .NET",
  "body": "<p>Dear …</p>",
  "wrapper": { "headerHtml": "…", "footerHtml": "…", "title": "Interview Scheduled" },
  "templateId": 34, "templateName": "Interview Scheduled — Candidate"
}
```

Endpoints to extend (all already exist — no new routes needed):

| Endpoint | Handler |
| --- | --- |
| `GET /api/pipeline/:id/outcome-preview` | `previewOutcomeEmail` — [stageNotification.service.js:82](../../backend/src/services/stageNotification.service.js#L82) |
| `GET /api/pipeline/:id/interview/schedule-preview` | `previewScheduleEmails` — [interviewSchedule.service.js:271](../../backend/src/services/interviewSchedule.service.js#L271) |
| `GET /api/pipeline/:id/interview/reschedule-preview` | `previewRescheduleEmails` — [interviewSchedule.service.js:637](../../backend/src/services/interviewSchedule.service.js#L637) |
| `GET /api/pipeline/interview/:scheduleId/cancel-preview` | `previewCancelEmails` — [interviewSchedule.service.js:304](../../backend/src/services/interviewSchedule.service.js#L304) |

Single source of truth: the wrapper HTML is produced by the same `emailLayout.service.js` the send path uses. The preview cannot drift from the delivery.

### 4.3 Email Template Management page

The **Live Preview** tab on `/email` ([EmailManagement.jsx](../../frontend/src/pages/EmailManagement.jsx)) currently renders `body_html` raw, which is why a Pipeline Tracker template previews there as bare text. Apply the same wrapper in that preview, gated on `isFullHtmlDocument()` so already-branded templates (your Duplicate Resume Alert screenshot) render unchanged.

The **Editor** tab keeps editing the raw fragment — the admin authors body content, never chrome. Add a short hint line: *"Header and footer are applied automatically when this email is sent."*

---

## 5. Teams block — one loose end to close

`buildTeamsBlock()` produces a card that reads correctly on the plain background it was designed for ([interviewSchedule.service.js:189-198](../../backend/src/services/interviewSchedule.service.js#L189-L198)). Inside the white branded card its `#e5e7eb` border and default font will look slightly foreign.

Restyle it to match the branded card's idiom — same `#f6f9eb` tinted panel with a `4px solid #7a922e` left border used by the Shortlist template's "Interview Process" box ([seed-email-templates.js:70](../../backend/prisma/seed-email-templates.js#L70)). Keep the existing green Join button; it already matches. Also mirror the change into `interviewReminder.js`'s `joinLine`, which is a near-duplicate of the same markup.

---

## 6. Implementation sequence

Ordered so each step is independently verifiable and nothing is left half-branded.

**Step 1 — Layout service (backend, no behaviour change yet).**
Create `emailLayout.service.js` with `wrapBrandedEmail()` + `isFullHtmlDocument()`. Lift the table markup from `statusBody()`. Add unit tests in `backend/src/tests/` alongside `emailHelpers.test.js`:
- fragment in → full document out, containing the logo URL and `#7a922e`
- full document in → returned byte-identical
- empty/null body → does not throw
- `editableSlot` option emits exactly one `data-editable-body` element

**Step 2 — Wrap the stage-outcome sends (Approve / Hold / Reject).**
`stageNotification.service.js`: wrap in `sendStageOutcomeEmail` and `sendAdHocCandidateEmail`, before `injectTrackingPixel`. Store the fragment. *Verify:* trigger Approve on a staging candidate; the mail arrives branded, tracking pixel fires, conversation view unchanged.

**Step 3 — Wrap the interview sends (Schedule / Reschedule / Cancel).**
`interviewSchedule.service.js`, all three functions, both recipients, **after** `ensureTeamsBlock()`. Restyle `buildTeamsBlock()` per §5. *Verify:* book a real Teams interview; both the candidate and panel mails match the screenshots' branding and the Join button sits inside the card.

**Step 4 — Wrap the remaining jobs.**
`interviewReminder.js` (both bodies + `joinLine`), `interviewOccurrence.js`, `interviewScorecard.service.js` (compiled + inline fallback). *Optional but recommended:* promote the two hard-coded reminder bodies into real `rpa_email_templates` rows (`Interview Reminder — Candidate` / `— Panel`) so HR can edit them from `/email` like everything else. That is a small seed addition and one `getTemplate()` lookup each.

**Step 5 — Preview endpoints return the wrapper.**
Add the `wrapper` object to the four preview payloads.

**Step 6 — Frontend editor split.**
Implement §4.1 Option A in `PipelineDrawer.jsx`; `SimpleHtmlEditor` becomes `BrandedBodyEditor`. Both `InterviewEmailEditors` (candidate + panel) and the outcome modal consume it. Watch the caret-preservation logic — `srcDoc` is deliberately memoised with an empty dep array so typing does not remount the iframe ([PipelineDrawer.jsx:72-76](../../frontend/src/components/pipeline/PipelineDrawer.jsx#L72-L76)); keep that behaviour.

**Step 7 — Email Template Management preview parity.**
Apply the wrapper in the Live Preview tab, gated on `isFullHtmlDocument()`.

**Step 8 — Optional: reseed template bodies.**
The bodies in §1's table stay as fragments — that is now correct by design. No reseed is strictly required. Only run the seed if you also do Step 4's optional reminder-template promotion.

---

## 7. Risks and how each is contained

| Risk | Containment |
| --- | --- |
| Double-wrapping an already-branded email | `isFullHtmlDocument()` guard, unit-tested. Applies to every call site. |
| Recruiter's saved edits from before the change contain full documents | Same guard — a stored full document passes through unwrapped rather than nesting. |
| Outlook desktop mangles the layout | Reuse the proven table markup from `statusBody()`; do not author new CSS layout. Test in Outlook desktop, not only Gmail web. |
| Tracking pixel lands outside `<body>` | Wrap strictly *before* `injectTrackingPixel`. Covered by a test asserting the pixel appears before `</body>`. |
| Teams block appended outside the card | Wrap strictly *after* `ensureTeamsBlock`. Assert the join URL appears inside the card table in a send-path test. |
| Reminder re-send double-chrome | Store fragments (§3.3); `reminderScheduler.js` keeps prepending its banner to a fragment as it does today. |
| Editor lets the admin damage the shell | Chrome lives outside the editable region entirely (§4.1). |

---

## 8. Answer to the original question

**Yes — this is achievable, and the right shape is a single send-time wrapper rather than 15 edited templates.**

The work is roughly: one new backend service file (~120 lines), five backend call-site edits of two or three lines each, four preview payloads extended by one field, and one frontend editor component reworked so the branded chrome sits outside the editable region. The `isFullHtmlDocument()` guard means every already-branded email in the system is provably untouched.

The one genuine design decision left for you is in §3.3 — whether `rpa_email_messages.body_html` should keep storing the editable fragment (recommended; keeps the reminder re-send and conversation view working) or store the fully rendered document for exact-delivery audit (needs a new column). Everything else follows from the analysis above.
