# L16 · Password emails on the AAPNA design (23 Oct 2026)

**Sheet:** Phase 3 Enh - Later, row 21 (added 23 Oct). **Plan:** `docs/Phase 3 Enhancements or Feedback/PLAN-Phase3-in-Phase4.md` › Other bugs › L16.

## Why
Harish, 23 Oct: the password emails do not follow our email design. The two account emails were the last user-facing emails with their own hand-built HTML: a grey "AAPNA Recruitment Process Automation" header, Calibri, and a different green. Every pipeline and MRF Hold email uses the branded shell instead (green band, logo, white card, sign-off, grey footer).

## What changed
| Email | Before | After |
|---|---|---|
| Account created / password changed (`sendCredentialEmail`) | Its own document | Body fragment + `wrapBrandedEmail(body, { title: subject })` |
| Forgot-password reset (`sendPasswordResetEmail`) | Its own document | Same |

- **New `backend/src/services/accountEmailBodies.js`:** pure, with no imports. It holds `buildCredentialEmailBody`, `buildPasswordResetBody` and the two subjects.
  - The content is the same as before: the credentials box (portal, username, email, password), the Reset password button with a copyable link, the 30-minute single-use line, and the "ignore it if you didn't ask" line.
  - A "Sign in to AAPNA ATS" button is added to the credentials email.
  - The sign-off now comes from the shell ("AAPNA Infotech Recruitment Team") instead of "HR Admin Team".
- **Escaping:** every user-supplied value is now escaped. A generated password containing `<` or `&` used to disappear into the markup, so the user was shown a different password from the one that was set.
- **Subjects:** unchanged.
- **Recipients:** unchanged. `passwordReset` and `userCredentialUpdate` stay in `NEVER_REDIRECT`, so these reach the real inbox on staging too.
- **Comment fix:** the doc comment on `sendCredentialEmail` wrongly said staging redirects the email. Corrected.

## Tests
- `src/tests/unit/accountEmailBodies.test.js` (7 tests):
  - the bodies are fragments, wrapped exactly once, with the shell's sign-off and no flex layout;
  - every value is present;
  - a password with markup characters is shown exactly as set;
  - names are escaped;
  - the reset link appears in the button and as text;
  - the subjects are unchanged.
- Full unit run: 958/958.
- **Manual check still to do:** forgot-password for your own account on staging, then check the email in Outlook desktop and OWA.

## Files
- `backend/src/services/accountEmailBodies.js` (new)
- `backend/src/services/emailNotification.service.js`
- `backend/src/tests/unit/accountEmailBodies.test.js` (new)
