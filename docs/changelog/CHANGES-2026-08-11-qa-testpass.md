# QA test pass — `ATS_TestCases_HRUpload_to_ZekoHR_Updated 2.xlsx` (2026-08-11)

Results of the team's 118-case pass across HR Upload → Zeko HR → the full pipeline,
and what was done about each defect. Written so the sheet can be re-run against it.

**Pass rate as filed:** 114 of 118 cases marked *"It Ran fine"*. Four defects — three
in the **Remarks** column, one more in the free-text **Feedback** block at the bottom
of the Test Cases sheet. Eleven cases (HRU-06 … HRU-09, ZHR-06, OFR-01 … OFR-06) were
left with no Actual Result and remain **untested**.

---

## Defects and dispositions

| TC ID | Reported | Verdict | Fix |
|---|---|---|---|
| HRU-01, HRU-02 | "Total Experience is not updating … in the Search Candidate page" | **Real bug — confirmed** | [#19](CHANGES-2026-08-07-candidate-pipeline-fixes.md) |
| T1-09 + Feedback | "Interviewer name is not coming automatically in body content" | **Real bug — confirmed** | [#20](CHANGES-2026-08-07-candidate-pipeline-fixes.md) |
| Feedback | "In Documents … there should be submit button" | **Already implemented** — real gap was the missing acknowledgement | [#21](CHANGES-2026-08-07-candidate-pipeline-fixes.md) |
| Feedback | "Reminder should be sent automatically, currently manual" | **Already implemented** — real gap was UI copy; 2 counter bugs found | [#22](CHANGES-2026-08-07-candidate-pipeline-fixes.md) |

### HRU-01 / HRU-02 — Total Experience

Worse than "not updating": the number shown was often one the resume never contained.
Any CV with an employment-history row took a date-computed total, and the date reader
could not handle `Jun-2022`, `May'21` or `05.2022` — those scored 0 months and were
stored as `"0"`. With no history at all, a hardcoded `"2"` was written. `"0"` also
passed the missing-data check, so nothing ever chased it.

Fixed, along with the other fabricated defaults in the same block (phone
`9876543210`, `B.Tech`, `Delhi`, `Software Developer`) and five columns that were
parsed but never stored. **Re-test:** upload a CV using `Jun-2022 – Present`, then
open Search Candidate → View Details.

### T1-09 — Interviewer name

The name was already captured and stored on every booking; it just never reached the
email. The subtle part: the schedule modal posts its compiled panel body back on
submit and the server prefers it, so the name had to be threaded through the
**preview** as well — a send-only fix would have been silently overridden.

**Re-test:** the *preview* in the modal must already read "Hi &lt;name&gt;," before
you press send. Also check two comma-separated interviewers ("Hi all,"), and
Technical Round 3, which has no MRF interviewer column.

⚠️ **Requires a deploy step:** re-run `prisma/seed-email-templates.js`, which
overwrites HR's edits to the three interview panel templates. Confirm before running
on staging/production.

### Documents (both Feedback items)

Both features were present before this pass:

- **Submit button** — shipped 2026-08-07 (`DocumentUpload.jsx`).
- **Automatic reminders** — shipped Phase 3 M4 (`jobs/documentReminder.js`, daily at
  09:00, first after 2 days, max 3).

In each case something adjacent made them look absent, and that is what was fixed:
the upload page never acknowledged a submission until HR *verified* it (days later),
and the Documents panel never mentioned the automatic schedule. Confirming the
reminder behaviour also turned up two genuine defects in it — a failed send still
burned the candidate's reminder budget, and a re-request after three reminders was
never auto-chased again.

**If QA still sees no submit button, the build under test predates 2026-08-07.**

---

## Not covered by this pass

**Eleven cases were never executed** and are the highest-value next run, because two
of them exercise the code path this session changed most:

| TC ID | Scenario | Why it matters now |
|---|---|---|
| HRU-06 | Resume with no email **and** no phone | Should be `Rejected_By_System` |
| **HRU-07** | Resume with email but **no phone** | Directly affected by #19 — the fake `9876543210` default used to mask this; the missing-data email should now fire |
| **HRU-08** | Resume with phone but **no email** | Same |
| HRU-09 | Live dashboard update via socket | — |
| ZHR-06 | Zeko result fetch with no data yet | — |
| OFR-01 … OFR-06 | The entire **Offer** stage | Last stage in the pipeline; completely untested |

Several passing rows also carry expectations that read as open questions rather than
assertions, and are worth converting into decisions:

- **T1-12** — "verify whether a new Teams meeting ID is generated or the same one is
  reused" on reschedule. (It is a new one: reschedule cancels the old booking and
  creates a new event.)
- **T1-13** — "verify whether a cancellation reason is required (not confirmed)".
- **T1-15** — flagged Exploratory: Approve/Reject/Hold are active *before* an
  interview is scheduled, "confirm this is intended, since it lets a recruiter
  approve a technical round with no interview having happened at all". This is a
  product decision, still open — no code change was made for it.

---

## Verification performed on the fixes

- Backend unit suite: **122 passing** (15 new, all DB-free) — `npm run test:unit`.
- Frontend production build clean — `npm run build`.
- ESLint on every changed backend file: no new errors (the repo's config reports
  pre-existing `no-undef` on Node globals across ~177 sites; one pre-existing unused
  symbol was removed).
- All changed backend modules verified to import, and the panel greeting verified to
  compile to "Hi Priya," / "Hi all," / "Hi there,".

**Not verified against a running stack:** none of the fixes have been exercised
end-to-end with a live database, mail sender or real resume upload. The re-test steps
above are the outstanding work.
