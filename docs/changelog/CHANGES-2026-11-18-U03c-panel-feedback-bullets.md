# U03c · Panel invite: full feedback as bullets, a cleaner report, concerns highlighted (18 Nov 2026)
This responds to Chhaya's email about LALIT VERMA's CEO round invite, which said "not in desirable format" and asked for "vertical with bullet points". The design was approved in review on 18 Nov.

**What changed**
- **The email table (every round's invite: Tech 1, Tech 2, Tech 3, HR and CEO):**
  - Each round's feedback is now a vertical list, and nothing is cut. Before, the 160- and 300-character limits cut the feedback mid-sentence.
  - Each interviewer gets a verdict line, then their skill ratings, comments and HR fields. The recruiter's pasted form follows as bullets.
  - The form's bookkeeping lines (submission dates, the candidate's email, "applied for", the round) are dropped.
- **Concerns** show in bold dark red, starting with "Concern:", in the email and in the report. A concern is any of these:
  - a Hold or Reject recommendation;
  - an average or rating below 3/5;
  - "not shortlisted" or similar wording;
  - HR's areas of concern;
  - a Zeko red flag;
  - a failed assessment.
- **The attached report (panel copies only)** has a new AAPNA design, with the olive colours and the AAPNA logo built into the file. Its sections:
  - CEO and HR rounds: At a glance (a one-line summary, the steps so far, the Concerns box), What happened, Feedback in full, Profile, Screening and assessment, and the Position last.
  - Tech rounds: At a glance, then Feedback in full.
- **What happened** shows one line per step. The system's own notes are no longer listed: recording opened, dossier downloaded, link sent, an outside viewer's IP address. A cancelled booking says "Cancelled", with its reason.
- **More Tech 2/3 reports:** they now also go out when the earlier round has only a pasted form.
- **Unchanged here:** the dossier download (U03c left it byte for byte the same; U03d then restyled it, keeping its content), the CTC, source and email gates, and the email shell.

**Files**
- New: `utils/panelFeedback.js` (`parseRoundNote`, the concern rules, `panelJourney`, `journeyStrip`, `collectConcerns`, `journeySummary`) and `exports/aapnaMark.js` (the logo).
- Changed:
  - `utils/panelCandidateTable.js`;
  - `exports/candidateDossier.export.js`: `renderPanelReport` and `PANEL_STYLES`; `renderDossierHtml` takes `stageKey`;
  - `services/candidateDossier.service.js`: new model fields only;
  - `services/interviewPanelPack.service.js`.
- Tests:
  - new `panelFeedback.test.js` (19) and `panelCandidateTable.test.js` (18);
  - `candidateDossier.test.js`: the panel cases were rewritten, 130 in total;
  - full unit suite: 1110 out of 1110 pass.
  - `tests/` is in `.gitignore`, so the two new test files need `git add -f`.

**Left over**
- **Zeko red flags:** panel invites don't fetch Zeko's report (only the download does), so red flags show only when the report is in the model. Fetching it would add a Zeko API call to every invite, and that needs a decision.
- **Outlook check:** do one real send to our own address and check it in Outlook desktop and OWA.
- **Follow-up A1 is still open:** the report doesn't yet drop a pasted form from a skipped round the way the table does.
