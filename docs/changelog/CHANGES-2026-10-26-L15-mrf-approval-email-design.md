# L15 follow-up · MRF approval email: compact design (26 Oct 2026)

**Sheet:** Phase 3 Enh - Later, row 20 (L15). **Asked by:** Harish, after testing on staging: the Approve / Reject / Hold email was "too big and too much to scroll".

## What changed (design only: every field and the wording are kept)
- **Buttons:** three solid, equal, compact buttons in one row: **Approve** (green), **Reject** (red), **Hold** (blue).
  - About 40 px tall. They were about 64 px, because they sat in a paragraph with `line-height:3`.
  - Table-based, so Outlook desktop draws the same size. The row is capped at 384 px and shrinks on a phone.
  - The same row is repeated under the details table, so nobody scrolls back up.
  - Labels shortened from "Approve Requisition" etc.
- **Personal-link note** ("also sent to…, the first decision is final, please do not forward"): same words, now a slim grey line under the buttons instead of a boxed callout.
- **Intro:** the repeated sentence "Please review the filled MRF and attached JD and confirm your approval." is removed, in the code default, the seed, and the staging "MRF Approval Request" template (row 16). The blank-line paragraphs no longer add full empty lines.
- **Details table:** all 48 rows kept.
  - 13 px text, tighter rows, light separators instead of a full grid, zebra rows.
  - Muted labels in a 42% column, and a slim band for "AI-Parsed JD Summary".
  - An empty value shows a light "—".
- **Built at send time:** the table is now built from the MRF record when the email goes out (`mrfDetailsTableFor`), so MRFs submitted earlier also get this design.
  - It falls back to the stored `rpa_mrf.emailbody` when the record lacks the form fields.
  - It applies to the approval request (personal and shared links, and the back-from-hold re-send), the HR copy and the outcome email.

## Tests
- `src/tests/unit/mrfEmailBodies.test.js`, 16/16:
  - buttons are compact and appear above and below the table;
  - the intro keeps its wording without blank paragraphs;
  - the note is slim;
  - all 48 rows are kept, with a dash for empty values;
  - the table is rebuilt from the record, or falls back to the stored one.
- Full unit run: 1025/1025.
- **Preview:** a real staging MRF (MRF-669) rendered to HTML and checked in Edge. No email was sent.
- **Still to do:** submit a test MRF on staging and look at the approval email in Outlook.

## Production
- **Template text:** remove the same sentence from the "MRF Approval Request" template in Email Templates. The seed does not overwrite an existing template.

## Files
- `backend/src/services/mrfEmailBodies.js`: `decisionButtons`, `approvalNote`, `tightenIntro`, `mrfDetailsTableFor`, and the table styling.
- `backend/src/services/emailNotification.service.js`: the default intro, the note, and the table built at send time.
- `backend/prisma/seed-email-templates.js`: the default intro.
- `backend/src/tests/unit/mrfEmailBodies.test.js`.
