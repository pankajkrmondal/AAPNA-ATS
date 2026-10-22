/**
 * Unit tests for the pure email helpers (no network, no DB writes).
 * Run: npm run test:unit   (node's built-in test runner — the project is ESM
 * and Jest is not configured for it; the jest script remains untouched.)
 *
 * Note: importing these modules loads config from .env, so the tests exercise
 * injectTrackingPixel under whatever PUBLIC_BASE_URL the local env defines —
 * assertions branch on it rather than assuming a value.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import config from '../config/index.js';
import {
  describeEmailError,
  compileTemplate,
  injectTrackingPixel,
} from '../services/emailNotification.service.js';
import { normalizeMessage, isAdminSender } from '../services/outlookReader.service.js';

// ── describeEmailError ────────────────────────────────────────────────

test('describeEmailError maps connection timeouts to a friendly message', () => {
  const msg = describeEmailError(new Error('fetch failed: UND_ERR_CONNECT_TIMEOUT'));
  assert.match(msg, /Could not connect/i);
});

test('describeEmailError maps AppOnly access policy rejections', () => {
  const msg = describeEmailError(new Error('ErrorAccessDenied: Blocked by tenant configured AppOnly AccessPolicy'));
  assert.match(msg, /not authorized to send/i);
});

test('describeEmailError maps token failures', () => {
  const msg = describeEmailError('Failed to get access token: invalid_client');
  assert.match(msg, /authenticate with Microsoft/i);
});

test('describeEmailError maps missing recipients', () => {
  const msg = describeEmailError(new Error('No valid recipients provided.'));
  assert.match(msg, /No email address is on file/i);
});

test('describeEmailError falls through to the raw message', () => {
  assert.equal(describeEmailError(new Error('Something exotic happened')), 'Something exotic happened');
  assert.equal(describeEmailError(''), 'Unknown email error.');
});

// ── compileTemplate ───────────────────────────────────────────────────

test('compileTemplate replaces {{double}} and {single} placeholders in subject and body', () => {
  const { subject, html } = compileTemplate(
    'Hi {{candidate_name}} — {position}',
    '<p>{{candidate_name}} / {candidate_name}</p>',
    { candidate_name: 'Asha', position: 'QA Engineer' }
  );
  assert.equal(subject, 'Hi Asha — QA Engineer');
  assert.equal(html, '<p>Asha / Asha</p>');
});

test('compileTemplate aliases position <-> job_title in both directions', () => {
  const a = compileTemplate('{job_title}', '{{job_title}}', { position: 'Dev' });
  assert.equal(a.subject, 'Dev');
  assert.equal(a.html, 'Dev');

  const b = compileTemplate('{position}', '{{position}}', { job_title: 'Dev' });
  assert.equal(b.subject, 'Dev');
  assert.equal(b.html, 'Dev');
});

test('compileTemplate renders null/undefined replacement values as empty strings', () => {
  const { html } = compileTemplate('s', '<p>{{x}}</p>', { x: null });
  assert.equal(html, '<p></p>');
});

// ── injectTrackingPixel ───────────────────────────────────────────────

test('injectTrackingPixel is a no-op without a token', () => {
  const html = '<html><body><p>hi</p></body></html>';
  assert.equal(injectTrackingPixel(html, ''), html);
  assert.equal(injectTrackingPixel(html, null), html);
});

test('injectTrackingPixel injects before </body> when PUBLIC_BASE_URL is set (no-op otherwise)', () => {
  const html = '<html><body><p>hi</p></body></html>';
  const out = injectTrackingPixel(html, 'tok-123');
  if (config.publicBaseUrl) {
    assert.ok(out.includes(`${config.publicBaseUrl}/api/track/open/tok-123`));
    assert.ok(out.indexOf('<img') < out.indexOf('</body>'));
    assert.ok(out.endsWith('</body></html>'));
  } else {
    assert.equal(out, html);
  }
});

test('injectTrackingPixel appends when there is no </body>', () => {
  const out = injectTrackingPixel('<p>hi</p>', 'tok-123');
  if (config.publicBaseUrl) {
    assert.ok(out.startsWith('<p>hi</p><img'));
  } else {
    assert.equal(out, '<p>hi</p>');
  }
});

// ── normalizeMessage / isAdminSender ──────────────────────────────────

test('normalizeMessage flattens a Graph message and detects bounces', () => {
  const normalized = normalizeMessage({
    id: 'MSG1',
    conversationId: 'CONV1',
    internetMessageId: '<x@y>',
    from: { emailAddress: { address: 'Jane@Example.com', name: 'Jane' } },
    toRecipients: [{ emailAddress: { address: 'hr@aapnainfotech.com' } }],
    subject: 'Undeliverable: your email',
    bodyPreview: 'p'.repeat(300),
    body: { content: '<p>b</p>' },
    hasAttachments: true,
    receivedDateTime: '2026-07-09T00:00:00Z',
  });
  assert.equal(normalized.fromEmail, 'jane@example.com');
  assert.equal(normalized.toEmails[0], 'hr@aapnainfotech.com');
  assert.equal(normalized.isBounce, true);
  assert.equal(normalized.bodyPreview.length, 255);
  assert.equal(normalized.hasAttachments, true);
});

test('normalizeMessage treats normal subjects as non-bounce and tolerates missing fields', () => {
  const normalized = normalizeMessage({ subject: 'Re: Interview' });
  assert.equal(normalized.isBounce, false);
  assert.equal(normalized.fromEmail, '');
  assert.deepEqual(normalized.toEmails, []);
});

test('isAdminSender matches internal domains only', () => {
  assert.equal(isAdminSender('someone@aapnainfotech.com'), true);
  assert.equal(isAdminSender('someone@aapna.com'), true);
  assert.equal(isAdminSender('candidate@gmail.com'), false);
  assert.equal(isAdminSender(''), false);
});
