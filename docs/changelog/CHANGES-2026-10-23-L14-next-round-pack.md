# L14 · The next round's panel gets the JD, CV and report so far; "feedback received" email (23 Oct 2026)

**Sheet:** Phase 3 Enh - Later, row 19 ("Report link for the next round"). **Plan:** PLAN-Phase3-in-Phase4.md › Other bugs › L14.

## Why
- "When tech1 round done and passed, when we are about to schedule round 2, all the details of round 1 score, recording and cv should be sharing to the tech2 round interviewer… tech 3 or HR can get cumulative report, also do we receive notification once someone submit feedback on recruitment id."
- Decisions (Harish, 23 Oct):
  - use the dossier, attached by default;
  - the candidate's JD goes too;
  - the feedback notice goes to the recruitment mailbox.
- Before this change, the panel invite carried no attachments and nothing from earlier rounds, and a submitted scorecard only rang the in-app bell.

## What changed

### A. The panel's pack (`services/interviewPanelPack.service.js`)
- **Every round, Tech 1 included:** the role's JD (`getMrfJdAttachment`, cached) and the candidate's CV (fetched the way the dossier ZIP fetches it).
- **When an earlier round has results** (a scorecard, AI screening score, assessment, recording or round feedback), also **"<Candidate> - report so far.html"**. That is the dossier itself, so it covers every earlier round, which makes it cumulative for Tech 3, HR and CEO.
  - It is built with **no candidate contact details**, under the dossier's redaction rules (no CTC, vendor or offer).
  - It carries **no-login recording links** (14 days, revocable, every view logged).
- **Size:** at most 3 MB in total, added in priority order report → JD → CV. A JD that doesn't fit becomes its link; a CV that doesn't fit gets a "reply for the CV" line.
- **Body:** an **"Earlier rounds" block** goes in the panel invite, inside the branded card, after the Teams block (`utils/panelPackBlock.js`). It has one line per round (recommendation, average, recording link) and says what is attached.
- **Where:** in `scheduleInterviewRound` and `rescheduleInterviewRound`, **panel email only**. The candidate's invite is unchanged.
- **Best-effort:** a pack that cannot be built never stops the invite.
- **Audit:** the timeline gets "JD, CV, report so far sent to the Technical Round 2 panel (2 people)", and a dossier audit row (`DOSSIER_EXPORT`, format `panel-email`) is written when the report travels.
- **Schedule / Reschedule window:** "Send the JD, CV and report so far to the panel" tick-box, on by default, with a line saying what goes and what is left out. It is sent as `send_pack`.
- **For a round that is already booked:** "Send JD, CV & report to panel" on the Teams card asks for confirmation, then calls `POST /api/pipeline/interview/:scheduleId/send-pack`. That uses the editable template "Candidate Pack for Interview Panel".
- **Flag:** `INTERVIEW_PANEL_PACK_ENABLED` (default **true**, a kill switch). The panel flow is OPERATOR_ADDRESSED, so on staging the pack goes to the real addresses typed in the window, as the invite already does.

### B. "Feedback received" to the recruitment mailbox
- `submitScorecard` now also sends **"Feedback received: <candidate> · <round>"** (interviewer, recommendation, average, submitted at, comments, an "Open in the ATS" button).
  - It is not awaited and never fails the interviewer's submission.
  - The in-app bell stays.
- **Recipients:** new flow key **`scorecardSubmitted`**: default and staging seed `hmopuri@aapnainfotech.com`, production seed **`recruitment@aapnainfotech.in`**, editable in Settings. It stays redirected outside production.
- **Wording:** the editable template **"Interview Feedback Received"**. Both templates were created on staging with the new create-only `prisma/seed-interview-email-templates.js`, and the code falls back to the same defaults (`services/interviewEmailTemplates.js`).
- Logged in `rpa_email_log` as `scorecard_submitted`.

## Tests
- `src/tests/unit/panelPack.test.js` (11 tests):
  - what counts as an earlier result;
  - one line per round (earlier attempts left out, recordings linked);
  - the block's attached / link / too-large wording;
  - escaping;
  - the templates' placeholders match their tokens.
- `src/tests/integration/panelPack.test.js` (3/3 on staging, sends nothing):
  - a first round with nothing on file gets no report and nothing invented;
  - after a submitted Tech 1 scorecard the report is attached, carries the comments, and has **no candidate email or phone**, and the block names the round;
  - the feedback template renders from its staging row, escaped and branded.
- Full unit run: 1004/1004. The frontend builds.
- **Not run:** `schedulingAndScorecard.test.js` needs the shared fixture seeded and sends real interview mail to the external test Gmail. Run it before deploying, with the fixture seed and teardown.

## Rollout
- **Production:**
  - `node prisma/seed-interview-email-templates.js` (create-only);
  - `npm run seed:recipients:prod`, or set `email_recipients.scorecardSubmitted.to` to `recruitment@aapnainfotech.in` in Settings.
- No DDL.

## Files
- `backend/src/services/interviewPanelPack.service.js` (new)
- `backend/src/utils/panelPackBlock.js` (new)
- `backend/src/services/interviewEmailTemplates.js` (new)
- `backend/src/services/interviewEmailRender.js` (new)
- `backend/src/services/interviewSchedule.service.js`
- `backend/src/services/interviewScorecard.service.js`
- `backend/src/controllers/pipeline.controller.js`
- `backend/src/routes/pipeline.routes.js`
- `backend/src/config/index.js`
- `backend/src/config/emailRecipients.js`
- `backend/prisma/seed-email-recipients.js`
- `backend/prisma/seed-interview-email-templates.js` (new)
- `frontend/src/components/pipeline/PipelineDrawer.jsx`
- `frontend/src/services/pipeline.js`
- tests as above
