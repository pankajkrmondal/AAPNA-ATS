# The JD link in candidate emails: a card inside the email, a link candidates can open (11 Nov 2026)

**Follows:** [U02](CHANGES-2026-11-10-U02-jd-every-email.md). **Ask:** the "View the job description" line on the shortlist email sat below the email card as plain text.

## What changed
- **Look:** when the JD goes as a link, the email shows a "Job Description" card with a green **View Job Description** button. It is styled like the "Interview Process" box. The old line `View the job description: Job description` is gone.
- **Placement, shortlist:** the card sits right under the intro paragraph ("…shortlisted for the position of X"), inside the email card. The intro is marked `data-ats-intro` on the server and in the shortlist dialog's draft. If the recruiter deletes that paragraph, the card goes just above "Best regards".
  - The phone-confirm request also moves inside the email card, under the JD card. About AAPNA (Keyword shortlists) moves just above "Best regards".
- **Placement, other emails** (Zeko, Evalground, interview rounds, the "Approved" outcome): the card goes at the end of the body, inside the email card. If the body ends with its own sign-off, the card goes just before it, so no second signature is added.
- **Link:** candidate emails use a view-only "anyone with the link" OneDrive link (Graph `createLink`, `type: view`, `scope: anonymous`). It is made only when the JD goes as a link, never for an attached JD. One Graph call per MRF per 10 minutes.
  - If Graph refuses (Anyone links blocked by the tenant, file missing, timeout), the email keeps the stored internal link as before, and the server log says so.
  - The interviewer panel pack keeps the internal link.
- **Log:** the Zeko and round invite log lines add the link kind, e.g. `JD link (anyone)` or `JD link (internal)`.
- **No new flags, no DDL.**

## Tests
- **Unit:** `sectionC.test.js` (card markup, placement in documents and fragments, after the intro), `jdEveryEmail.test.js` (anyone link used over the stored link). All unit suites: 1186/1186.
- **Integration (staging DB, real OneDrive JD):** `jdEveryEmail.test.js` 9/9. That includes the card right under the intro on an unreadable JD, the anyone link with one Graph call per MRF, no link for an attached JD, and a refused link that keeps the stored link. Graph writes (including `createLink`) are intercepted, so nothing was sent and no sharing link was made.
- **Layout (Playwright, Edge, 800px and 390px):** the card and button sit inside the email card, right under the intro and above "As the next step". About AAPNA sits inside the card, above "Best regards".
- **Frontend:** `npm run build` passes.

## Open
- **Not yet checked against the tenant:** whether Anyone links are allowed on the sender mailbox's OneDrive. Until they are, candidates get the internal link, as before.
