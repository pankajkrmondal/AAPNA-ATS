# HR Round Scorecard — Full Field Parity: DDL Apply Instructions

**File:** `2026-07-29-hr-scorecard-fields.sql`
**Do not hand-edit `schema.prisma`** — per `docs/reference/VENDOR_PROCESS.md` §13, this repo always introspects the live DB.

## Why

The HR Round sheet of `docs/Interview Evaluation Format V2.xlsx` — the MS Forms +
Power Automate process the ATS scorecard replaces — collects ~16 fields. The
table shipped with 5. These 10 additive columns close the gap so nothing HR used
to capture is lost in the move into the ATS.

## Steps to apply

1. Run the SQL against the database:
   ```
   psql "$DATABASE_URL" -f backend/prisma/ddl/2026-07-29-hr-scorecard-fields.sql
   ```
   (or paste it into your usual DB tool). Additive and idempotent — safe to re-run.

2. Stop the backend, then introspect + regenerate the Prisma client:
   ```
   cd backend
   npx prisma db pull
   npx prisma generate
   ```

3. Restart the backend. Until steps 1–2 are done, submitting an HR-round
   scorecard fails, because the Prisma client doesn't yet know the new columns.

## Columns this adds (all on `rpa_interview_scorecard`, all nullable)

| Column | Workbook field |
|---|---|
| `hr_family_background` | Family Background |
| `hr_general_other` | General/Other |
| `hr_timings` | Timings |
| `hr_communication_comments` | Communication Comments |
| `hr_attitude_comments` | Attitude Comments |
| `hr_weakness` | Weakness |
| `hr_only_negative` | Only Negative |
| `hr_other_observation` | Any Other Observation/Request |
| `hr_final_feedback` | Final Feedback |
| `hr_next_step` | Next Step for Recruitment Team |

Already present, reused as-is: `hr_relocation` (Relocation), `hr_notice_period`
(Notice Period), `hr_current_ctc` + `hr_expected_ctc` (the workbook's single
"CTC and ETC" cell, kept split here for cleaner reporting), `hr_strengths`
(Strength), plus the shared `communication` / `attitude` / `final_rating`
ratings and `comments` (Final Comments) and `recording_url`.

## Note on the HR card's shape

The HR card has **no skill rows** — the workbook's HR sheet has no Skill 1–5
columns, unlike the Technical/CEO sheets. `InterviewScorecard.jsx` hides the
skill matrix when `card_type === 'hr'` and submits an empty `skills` array, so
`avg_score` for an HR card is the mean of communication/attitude/final only.
