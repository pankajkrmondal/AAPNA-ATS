# U02b · "Attach the JD" switch and {{jd_link}} on the Email Templates page, and JD link sources (12 Nov 2026)

**Sheet:** Phase 3 UAT Fixes - Nov, U02b (12 Nov feedback, live 16 Nov). **Brief:** [U02b](../Phase%204/uat-fixes/U02b-template-jd-switch-and-links.md).
**HR ask:** choose on the templates page whether an email carries the JD and where the JD card goes. A website JD address should be sent as it is.

## What changed
- **Switch:** each candidate template that can carry the JD has an "Attach the JD" switch on the Email Templates page. Left empty, it shows the default rule with a "Default" tag ("Use default" resets it). It holds on every path that uses the template, including a recruiter-edited draft: shortlist, Change JD, Move JD, Zeko, Evalground, interview schedule and reschedule, and the Approved outcome email.
- **{{jd_link}}:** a new optional chip that places the JD card. With no token the card goes where it did before. When the JD is attached or not sent, the token is removed, so a candidate never sees it raw. Editable previews show it as a dashed "JD card goes here" box.
- **Evalground:** the invite text is now the stored template "Evalground Assessment Invite", created by the DDL from the old built-in copy. The invite window falls back to that copy if the row is missing.
- **JD link sources:** a JD that is not a OneDrive or SharePoint file (a website address) is sent as its link, with no Graph calls. Until now it failed two Graph lookups first. A OneDrive link counts as "anyone" only when Graph replies `scope: anonymous`. Otherwise the email keeps the internal link and the log says so.
- **DDL:** `2026-11-12-email-template-attach-jd.sql` (+ rollback). It adds `attach_jd`, adds `jd_link` to the candidate templates' placeholders, and creates the Evalground template if it is missing. The column is read with raw SQL and is not in the Prisma model, so the build works before the DDL runs. **Not yet applied on staging or production.**
- **No new env flags.** Configuration: [05-CONFIGURATION.md](../system/05-CONFIGURATION.md) §3, "The JD on candidate templates".

## Tests
- **Unit:** `jdEveryEmail.test.js` 25/25 (10 new: the switch for every stage, `{{jd_link}}` placement, Microsoft URLs, website JD, link scope) and `sectionC.test.js` 23/23 (6 new: `placeJdLink`). All unit suites: 1202/1202.
- **Integration (staging DB, Graph intercepted, nothing sent):** `jdEveryEmail.test.js` 11 passed, 1 skipped. The new tests cover a website JD (no OneDrive call), an organisation-scope reply, and `{{jd_link}}` placing the card in the Evalground text. The switch-off test skips until the DDL has run.
- **Frontend:** `npm run build` passes.
