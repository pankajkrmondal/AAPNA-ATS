# Phase 2.2 — Screening Decision Modal Refinements

Follow-on to `CHANGES-phase2.1-screening-reject-and-dashboard.md` (which introduced
`DecisionEmailModal`, Tag-to-JD, and the send-email checkbox). This round fixes UI
and correctness issues found while using that modal day-to-day.

1. **WYSIWYG email body editor** — The modal's "Edit" tab was a raw-HTML
   `Input.TextArea`, bad UX for HR editing a candidate-facing email. Added a new
   shared component `frontend/src/components/common/EmailBodyEditor.jsx` — a
   `designMode` iframe with a formatting toolbar (Bold/Italic/Underline/lists/
   link/clear) plus clickable placeholder chips (e.g. `+candidate_name`) that
   insert at the cursor, mirroring the editor already proven on the Email
   Templates page (`EmailManagement.jsx`). `DecisionEmailModal.jsx`'s toggle is
   now three-way: **Visual** (this new editor) / **HTML** (the old raw textarea,
   kept for power users) / **Preview** (unchanged).

2. **Floating dock overlapping the modal** — The "N candidates selected /
   Shortlist Selected / Reject Selected" dock (`CandidateScreening.jsx`, fixed
   position, `zIndex: 10000`) stayed visible on top of the modal's own Cancel/
   Confirm footer while the modal was open, producing a visually cluttered
   double-footer. Now hidden whenever `decisionModalOpen` is set.

3. **Shortlist idempotency bug** — `shortlistCandidates` (`screening.service.js`)
   used to skip silently (no DB write, no email) if a `(candidate, role)` record
   already existed in *any* status, including `rejected` — so a candidate
   rejected for a role could never be shortlisted for it again, while the
   frontend still showed a success toast. Fixed to only skip when already
   `shortlisted`; a `rejected` record is now updated back to `shortlisted`
   (clearing the stale rejection reason and email snapshot). Records in a
   pipeline stage *beyond* shortlisting (`on_hold`/`hired`/`joined`/`selected`,
   set from the separate Candidate Pipeline page) are still left untouched, so
   a re-shortlist from a Screening search can never regress an advanced stage.
   The response now includes a `skipped` count, and `CandidateScreening.jsx`'s
   success toast uses the real `shortlisted`/`rejected`/`skipped` counts from the
   server instead of blindly trusting the selection size.

4. **"Assign to Zeko job" bypassed the role-tag requirement** — The candidate
   drawer's quick-assign action (`handleAssignCandidate`) had its own, separate
   shortlist call that hard-coded `mrf_id: 0` / `role_name: 'Manual Screening'`
   on the Keyword tab, sidestepping the mandatory role tag the main modal
   enforces. Replaced with routing through the same `DecisionEmailModal` flow
   (`setSelectedCandidateKeys` + `setDecisionModalOpen('shortlist')`) so both
   entry points behave identically. Also deleted a long block of stale,
   exploratory debugging comments left in that function from earlier
   investigation.

5. **Reject on the Keyword tab never asked for a role** — Unlike Shortlist,
   `requireRoleTag` was `decision === 'shortlist' && activeTab === 'keyword'`,
   so rejecting from the Keyword tab skipped role selection entirely and the
   notification email fell back to the literal string "the role". Changed to
   `activeTab === 'keyword'` (applies to both decisions) so Reject on Keyword
   tab now requires the same "Tag to Open JD" dropdown Shortlist already had.
   The helper text under the dropdown was also generalized (previously
   referenced shortlist-specific "suitable position" fallback copy).

6. **"Other" rejection reason had no text box** — `REJECT_REASONS` includes
   `'Other'`, but selecting it just stored the literal word "Other" in
   `recruiter_notes` with no way to specify what it actually was. Added a
   `customReason` field that appears only when `reason === 'Other'`, is
   required to confirm, and its trimmed text (not the word "Other") is what
   gets sent as the reject reason.

7. **`{role_paragraph}` shown as a raw chip/token instead of real text** —
   `DecisionEmailModal.jsx` now bakes it into `body` as static text, using a new
   `buildRoleParagraph()` helper that's an exact mirror of the paragraph
   `shortlistCandidates()` composes server-side. The `+role_paragraph` toolbar
   chip is removed accordingly (nothing left to insert); `{candidate_name}` and
   (for Reject) `{position}` chips are untouched, per explicit scope — this pass
   only touches `role_paragraph`.

   **Follow-up fix, same item**: the first version only resolved the paragraph
   once a role was actually tagged (`if (!roleName) return`), so on the common
   path — modal opens, no role picked yet — the raw `{role_paragraph}` token sat
   there unchanged, which read as "still broken" even though the code was live
   (confirmed via the `+role_paragraph` chip already being gone). Fixed by always
   deriving the resolved text from the *pristine* `template.body_html` (not the
   live `body`, which may already have the token substituted out) on every
   `template`/`roleName` change: the generic fallback paragraph now shows the
   moment the template loads, and it's replaced with the real role-named
   paragraph as soon as one is tagged (immediately on JD tab, on selection on
   Keyword tab) — and again if the tagged role is changed afterward.

8. **Generic fallback email shouldn't be previewable on Keyword tab before a role
   is tagged** — even with item 7's fix, the Email section would show a fully
   populated preview (generic "shortlisted for a suitable position..." paragraph)
   while "Tag to Open JD" was still empty, which reads as a real, sendable draft
   even though Confirm is disabled until a role is picked. On the Keyword tab
   (`requireRoleTag`, covers both Shortlist and Reject), the entire Email
   section — the "Send email notification" checkbox, subject, and Visual/HTML/
   Preview editor — is now hidden until a role is tagged, replaced with "Tag a
   role above to preview the notification email." (`roleReady` gate in
   `DecisionEmailModal.jsx`). JD tab is unaffected — the role is already known,
   so the section shows immediately as before.

**Files touched**: `frontend/src/components/common/EmailBodyEditor.jsx` (new),
`frontend/src/components/screening/DecisionEmailModal.jsx`,
`frontend/src/pages/CandidateScreening.jsx`,
`backend/src/services/screening.service.js`.

**Verification**: Backend change syntax-checked (`node --check`); both dev
servers (frontend :5173, backend :5000) confirmed still responding after each
edit (nodemon/HMR reload, no crash). No automated tests exist for
`screening.service.js`. Full manual verification (idempotency undo-reject flow,
skip-still-works, Assign-to-Zeko on Keyword tab, Reject-on-Keyword role
requirement, "Other" reason box, role_paragraph static text on both tabs) is
pending — being done live against the running dev stack rather than replayed
here.
