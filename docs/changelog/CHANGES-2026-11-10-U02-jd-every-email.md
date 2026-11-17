# U02 · The JD goes with every email that moves a candidate forward (10 Nov 2026)

**Sheet:** Phase 3 UAT Fixes - Nov, U02. **Brief:** [U02](../Phase%204/uat-fixes/U02-jd-every-email.md).
**HR ask:** the JD was attached only to Keyword-tab shortlists and panel invites. It should go with every email that moves a candidate on.

## What changed
- **Which emails:** the shortlist (JD tab, Keyword tab, Search "Add to JD"), the Zeko HR / Functional invite, the Evalground invite, the candidate's Tech 1/2/3, HR and CEO invite and reschedule, and the "Approved" outcome email when the next stage is a round. Documents, Offer and closures don't carry the JD (`shouldAttachJd`). About AAPNA stays on Keyword shortlists only.
- **How:** the JD file is attached. When it is too large or can't be read, the email carries a "View the job description" link instead. A missing JD never blocks an email.
- **Size:** measured as base64, which is how Graph carries the file. One email may carry 3.5 MB of base64. A single JD can be up to about 2.6 MB (before, the cap was 3 MB raw, which was about 4 MB on the wire). The panel pack uses the same measure.
- **Log:** the shortlist, Evalground and outcome emails record the JD in `rpa_email_messages.has_attachments` / `attachments_json` (`kind: 'jd'`). The Zeko and round invites don't write to that table; they log `JD attached|link|none`.
- **Screens:** the shortlist dialog shows the "JD attached" line on every tab, including Add to JD. The Evalground invite window says the JD is attached. The Schedule window shows whether a JD is on file and that it goes with the candidate's invite. Its wording that the candidate's invite is unchanged is gone.
- **No new flags, no DDL.**

## Tests
- **Unit:** `jdEveryEmail.test.js` 13/13 (new: stage rule, base64 size, attach or link, log columns). `panelPack` 13/13, `sectionC` 11/11, `changeJd` 5/5. All unit suites: 1065/1065.
- **Integration (staging DB, real OneDrive JD):** `jdEveryEmail.test.js` 8/8, one send per path, plus an unreadable JD that goes as the link. Graph writes, the calendar and Zeko's schedule call are intercepted, so nothing was sent. `panelPack.test.js` 7/7.
- **Frontend:** `npm run build` passes.
