# Interview host visibility: production check (N26)

**Item:** Phase 3 "Do Now", N26 (carry-over). **No code change.**
**Why:** since commit `09028f2` ("Recruiters on Interview Meetings"), bookings add the interviewer and the recruiters as attendees. This has only been proven on staging. The item closes once one real production interview confirms it.
**Owner:** whoever books the next real interview round in production. **Result:** fill in the table at the end.

## Before you start
- Pick a real interview round (Tech 1, Tech 2, HR or CEO) whose interviewer is **not** the mailbox that creates the meeting (the organiser, i.e. the shared recruitment mailbox).
- If the invite does not arrive at all, check the Graph permissions first: `docs/phase3/MS-GRAPH-SETUP-FOR-IT.md`.

## Check list
1. In Pipeline, open the candidate, choose **Schedule interview**, and book the round with the real interviewer's email.
2. **Interviewer (host) side:** in their Outlook and their Teams calendar, the meeting shows:
   - the candidate's name and the round (stage) in the title or body;
   - the correct date and time (IST);
   - a working Teams link.
3. **Recruiter side:** the recruiters on the journey appear as attendees and see the same meeting in their calendars.
4. **Candidate side:** the candidate received the invite (ask them, or check the sent item in the organiser mailbox).
5. Join the meeting as the interviewer a few minutes early: the lobby and join work without the organiser present.

## Result

| Date | MRF / candidate | Round | Interviewer sees it (Outlook / Teams) | Recruiters added | Candidate invited | Checked by |
|---|---|---|---|---|---|---|
| | | | | | | |

If any column is "no", record what was seen, and raise it as a bug before closing N26.
