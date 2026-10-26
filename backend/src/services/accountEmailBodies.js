/**
 * Body fragments for the two account emails (L16): the credentials email
 * (account created / password changed by an admin) and the forgot-password
 * reset link.
 *
 * Both used to be full HTML documents with their own header and styling — the
 * one place a user met an AAPNA email that did not look like the others.
 * They are now fragments: emailLayout.service.js wrapBrandedEmail() adds the
 * branded header (the subject is the headline), the sign-off and the footer,
 * exactly as it does for every pipeline and MRF Hold email.
 *
 * Pure and import-free so the bodies can be unit-tested without Prisma, Graph
 * or config (tests/unit/accountEmailBodies.test.js).
 *
 * Every user-supplied value is escaped: names and usernames are typed by an
 * admin, and a generated password may contain `<` or `&`, which would
 * otherwise vanish into the markup and leave the user holding a password that
 * differs from the one they were shown.
 */

export const CREDENTIAL_SUBJECTS = Object.freeze({
  created: 'Your AAPNA ATS Account Credentials',
  updated: 'Your AAPNA ATS Account Password Has Been Updated',
});

export const PASSWORD_RESET_SUBJECT = 'Reset Your AAPNA ATS Password';

const ACCENT = '#7a922e';
const LINK = '#5a6e1f';
const MUTED = '#6b7280';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** "Dear Asha Rao," — or "Dear user," when the account has no name on it. */
function greeting(user) {
  const name = `${user?.first_name || ''} ${user?.last_name || ''}`.trim();
  return `<p>Dear ${name ? `<strong>${escapeHtml(name)}</strong>` : 'user'},</p>`;
}

/**
 * The credentials email body.
 *
 * @param {object} p
 * @param {{first_name?: string, last_name?: string, username?: string, email?: string}} p.user
 * @param {string} p.plainTextPassword
 * @param {boolean} [p.isNewUser]
 * @param {string} p.loginUrl - the portal sign-in address
 * @returns {string} an HTML fragment (no document shell, no sign-off)
 */
export function buildCredentialEmailBody({ user, plainTextPassword, isNewUser = false, loginUrl }) {
  const actionText = isNewUser ? 'created' : 'updated';
  const url = escapeHtml(loginUrl);
  const row = (label, valueHtml) => `<tr><td style="padding:6px 16px 6px 0;color:${MUTED};white-space:nowrap;vertical-align:top">${label}</td>`
    + `<td style="padding:6px 0;vertical-align:top">${valueHtml}</td></tr>`;
  const code = (v) => `<span style="font-family:Consolas,'Courier New',monospace;font-size:14px;background:#ffffff;border:1px solid #e5e7eb;border-radius:4px;padding:2px 6px">${escapeHtml(v)}</span>`;

  return `${greeting(user)}
<p>Your AAPNA ATS account has been <strong>${actionText}</strong> by the administrator. Your sign-in details are below.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;background:#f6f8ef;border:1px solid #dfe6c8;border-radius:8px">
<tr><td style="padding:14px 20px">
<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.6">
${row('Portal', `<a href="${url}" style="color:${LINK}">${url}</a>`)}
${row('Username', code(user?.username))}
${row('Email', code(user?.email))}
${row(isNewUser ? 'Password' : 'New password', code(plainTextPassword))}
</table>
</td></tr>
</table>
<p style="margin:16px 0;"><a href="${url}" target="_blank" style="background:${ACCENT};color:#ffffff;padding:12px 26px;text-decoration:none;border-radius:8px;font-weight:700;display:inline-block;">Sign in to AAPNA ATS</a></p>
<p>For your security, please sign in and change this password as soon as possible.</p>
<p style="font-size:13px;color:${MUTED};">If you did not expect this email, contact the IT administrator straight away. This is an automated message; please do not reply to it.</p>`;
}

/**
 * The forgot-password body.
 *
 * @param {object} p
 * @param {{first_name?: string, last_name?: string}} p.user
 * @param {string} p.resetUrl - single-use, 30-minute link (auth.service.js)
 * @returns {string} an HTML fragment (no document shell, no sign-off)
 */
export function buildPasswordResetBody({ user, resetUrl }) {
  const url = escapeHtml(resetUrl);
  return `${greeting(user)}
<p>We received a request to reset the password for your AAPNA ATS account. Use the button below to choose a new password.</p>
<p style="margin:16px 0;"><a href="${url}" target="_blank" style="background:${ACCENT};color:#ffffff;padding:13px 28px;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;display:inline-block;">Reset password</a></p>
<p style="font-size:13px;color:${MUTED};word-break:break-all;">If the button does not work, copy this link into your browser: <a href="${url}" style="color:${LINK};">${url}</a></p>
<p>This link expires in <strong>30 minutes</strong> and can be used only once.</p>
<p style="font-size:13px;color:${MUTED};">If you did not ask to reset your password, you can ignore this email; your password will not change. This is an automated message; please do not reply to it.</p>`;
}
