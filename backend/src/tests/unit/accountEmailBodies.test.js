import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCredentialEmailBody,
  buildPasswordResetBody,
  CREDENTIAL_SUBJECTS,
  PASSWORD_RESET_SUBJECT,
} from '../../services/accountEmailBodies.js';
import { wrapBrandedEmail, isFullHtmlDocument } from '../../services/emailLayout.service.js';

const user = { first_name: 'Asha', last_name: 'Rao', username: 'asha.rao', email: 'asha.rao@example.com' };
const loginUrl = 'https://ats.example.com';
const resetUrl = 'https://ats.example.com/reset-password?token=abc.def';

const bodies = () => [
  ['credentials (new)', buildCredentialEmailBody({ user, plainTextPassword: 'S3cret!', isNewUser: true, loginUrl })],
  ['credentials (changed)', buildCredentialEmailBody({ user, plainTextPassword: 'S3cret!', isNewUser: false, loginUrl })],
  ['password reset', buildPasswordResetBody({ user, resetUrl })],
];

test('bodies are fragments, so the branded shell wraps them exactly once', () => {
  for (const [name, body] of bodies()) {
    assert.equal(isFullHtmlDocument(body), false, name);
    const html = wrapBrandedEmail(body, { title: 'T' });
    assert.equal(isFullHtmlDocument(html), true, name);
    assert.equal((html.match(/<html/gi) || []).length, 1, `${name}: one document shell`);
    assert.match(html, /AAPNA Infotech Recruitment Team/, `${name}: the shell adds the sign-off`);
  }
});

test('bodies leave the sign-off to the shell and use no flex layout', () => {
  for (const [name, body] of bodies()) {
    assert.ok(!/regards/i.test(body), name);
    assert.ok(!/display:\s*flex/i.test(body), name);
  }
});

test('the credentials body carries the portal, username, email and password', () => {
  const body = buildCredentialEmailBody({ user, plainTextPassword: 'S3cret!', isNewUser: true, loginUrl });
  for (const v of [loginUrl, 'asha.rao', 'asha.rao@example.com', 'S3cret!', 'Asha Rao', 'created']) {
    assert.ok(body.includes(v), v);
  }
  assert.ok(buildCredentialEmailBody({ user, plainTextPassword: 'x', isNewUser: false, loginUrl }).includes('New password'));
});

test('a password with markup characters is shown exactly, not swallowed', () => {
  const body = buildCredentialEmailBody({ user, plainTextPassword: 'a<b&c"d', isNewUser: true, loginUrl });
  assert.ok(body.includes('a&lt;b&amp;c&quot;d'));
  assert.ok(!body.includes('a<b&c"d'));
});

test('names are escaped and a nameless account still gets a greeting', () => {
  const body = buildPasswordResetBody({ user: { first_name: '<img src=x>' }, resetUrl });
  assert.ok(!body.includes('<img src=x>'));
  assert.ok(buildPasswordResetBody({ user: {}, resetUrl }).startsWith('<p>Dear user,</p>'));
});

test('the reset body carries the link twice (button + copyable) and the 30-minute rule', () => {
  const body = buildPasswordResetBody({ user, resetUrl });
  assert.equal(body.split(resetUrl).length - 1, 3); // button href, text href, visible text
  assert.match(body, /30 minutes/);
});

test('subjects are unchanged from before the move to the shell', () => {
  assert.equal(CREDENTIAL_SUBJECTS.created, 'Your AAPNA ATS Account Credentials');
  assert.equal(CREDENTIAL_SUBJECTS.updated, 'Your AAPNA ATS Account Password Has Been Updated');
  assert.equal(PASSWORD_RESET_SUBJECT, 'Reset Your AAPNA ATS Password');
});
