# E1: Editable hold / on-behalf email templates

## Test plan

**Scope.** The four notices added by the Hold & Delegate work are rows in `rpa_email_templates` (category `general`), so HR can edit them under **Email Templates › General / Alerts** like every other template:

| Template | Sent when |
|---|---|
| MRF On Hold Notice | An approver or delegate puts an MRF on hold |
| MRF Hold Date Changed | The hold-until date is changed in the ATS |
| MRF Decided On Your Behalf | A delegate decides in the ATS during an absence window |
| MRF Approvers Away Notice | An admin switches the absence window on |

- Defaults + send-time fallback: `backend/src/services/mrfHoldEmailTemplates.js`.
- Seed (create-only, never overwrites HR edits): `backend/prisma/seed-mrf-hold-email-templates.js`.
- Value tokens (`{{mrf_label}}`, `{{hold_until}}`, …) are required on save. `*_line` / `*_row` fragment tokens are optional.

## Test cases

| ID | Case | Expected |
|---|---|---|
| E1-01 | Seed on staging | `--dry-run` shows DB `recruitmentautomationdb` and 4 "Would create"; real run creates 4 rows; a second run keeps them |
| E1-02 | Listed in the UI | Email Templates, search "MRF" → 5 templates: MRF Approval Request + the 4 new ones, category General / Alerts |
| E1-03 | Editor + preview | Template opens in the branded editor with placeholder chips; Live Preview fills sample values, shows the note, sign-off and footer |
| E1-04 | Save rules | Removing an optional fragment (`{{note_line}}`) saves (200); removing a required token (`{{held_by}}`) → 400 "required placeholders are missing: held_by" |
| E1-05 | Real send uses the row | Holding an MRF sends the hold notice rendered from the DB row (subject, branded layout, note escaped) |

## Results log

### Run 1: 23 Oct 2026

| ID | Result | Notes |
|---|---|---|
| E1-01 | PASS | Rows #52–55 created on staging (22 Oct) |
| E1-02 | PASS | 5 templates listed |
| E1-03 | PASS | "MRF On Hold Notice": chips `+mrf_label +hold_until +held_by +held_at +note_line`; preview subject "MRF #188 – Senior Node.js Engineer – on hold until 20 Nov 2026", To approver@aapnainfotech.com; `{{note_line}}` explanation shown |
| E1-04 | PASS | Via the same `PUT /api/email/templates/52` the Save button uses; original subject/body restored and verified identical |
| E1-05 | PASS | Fixture MRF 827, log 875 (see H3 run 2) |
