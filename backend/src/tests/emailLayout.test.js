/**
 * Unit tests for the branded email shell (pure string work, no DB/network).
 * Run: npm run test:unit
 *
 * These lock the two invariants the whole wrapping design rests on
 * (docs/phase3/PIPELINE-TRACKER-BRANDED-EMAIL-PLAN.md §7):
 *   1. an already-branded body is never wrapped a second time,
 *   2. the wrapped document ends with </body></html>, so injectTrackingPixel
 *      inserts the pixel INSIDE the body rather than appending after it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  wrapBrandedEmail,
  isFullHtmlDocument,
  brandedWrapperParts,
  stripEditableSlot,
  EDITABLE_SLOT_ATTR,
} from '../services/emailLayout.service.js';
import { injectTrackingPixel } from '../services/emailNotification.service.js';

// ── isFullHtmlDocument ────────────────────────────────────────────────

test('isFullHtmlDocument detects doctype, <html> and <body> shells', () => {
  assert.equal(isFullHtmlDocument('<!DOCTYPE html><html><body>x</body></html>'), true);
  assert.equal(isFullHtmlDocument('<html><body>x</body></html>'), true);
  assert.equal(isFullHtmlDocument('<body style="margin:0">x</body>'), true);
  assert.equal(isFullHtmlDocument('<HTML><BODY>x</BODY></HTML>'), true);
});

test('isFullHtmlDocument treats fragments and empties as not-a-document', () => {
  assert.equal(isFullHtmlDocument('<p>Dear Candidate,</p>'), false);
  assert.equal(isFullHtmlDocument(''), false);
  assert.equal(isFullHtmlDocument(null), false);
  assert.equal(isFullHtmlDocument(undefined), false);
  // "<bodyguard>" must not read as a <body> tag.
  assert.equal(isFullHtmlDocument('<p>the <bodyguard> role</p>'), false);
});

// ── wrapBrandedEmail ──────────────────────────────────────────────────

test('wrapBrandedEmail turns a fragment into a full branded document', () => {
  const out = wrapBrandedEmail('<p>Dear SAURABH,</p>', { title: 'Interview Scheduled' });
  assert.match(out, /^<!DOCTYPE html>/);
  assert.match(out, /aapna-gptw-black\.png/);        // logo present
  assert.match(out, /#7a922e/);                       // brand green present
  assert.match(out, /Interview Scheduled/);           // title rendered
  assert.match(out, /<p>Dear SAURABH,<\/p>/);         // body preserved verbatim
  assert.match(out, /AAPNA Infotech\. All rights reserved\./); // footer present
  assert.match(out, /<\/body><\/html>$/);
});

// ── header title = the email subject (RT decision, 2026-07-25) ────────

test('the header headline renders the subject it is given', () => {
  const subject = 'Application on Hold — AAPNA Infotech';
  const out = wrapBrandedEmail('<p>x</p>', { title: subject });
  assert.match(out, /<h1[^>]*>Application on Hold — AAPNA Infotech<\/h1>/);
});

test('an empty subject omits the headline rather than rendering an empty band', () => {
  for (const title of ['', '   ', null, undefined]) {
    const out = wrapBrandedEmail('<p>x</p>', { title });
    assert.equal(/<h1/.test(out), false, `expected no <h1> for title=${JSON.stringify(title)}`);
    // The logo and standing sub-line must still be there.
    assert.match(out, /aapna-gptw-black\.png/);
    assert.match(out, /Recruitment Update/);
  }
});

test('a subject containing HTML-significant characters is escaped, not injected', () => {
  const out = wrapBrandedEmail('<p>x</p>', { title: 'Role: C++ & .NET <script>alert(1)</script>' });
  assert.equal(out.includes('<script>'), false, 'raw script tag must not survive');
  assert.match(out, /C\+\+ &amp; \.NET/);
  assert.match(out, /&lt;script&gt;/);
});

test('wrapBrandedEmail is idempotent — an already-branded body is returned byte-identical', () => {
  const branded = '<!DOCTYPE html><html><body style="margin:0"><p>Welcome</p></body></html>';
  assert.equal(wrapBrandedEmail(branded), branded);
  // Double-wrapping must also be a no-op.
  const once = wrapBrandedEmail('<p>hi</p>');
  assert.equal(wrapBrandedEmail(once), once);
});

test('wrapBrandedEmail handles empty and non-string bodies without throwing', () => {
  assert.match(wrapBrandedEmail(''), /^<!DOCTYPE html>/);
  assert.match(wrapBrandedEmail(null), /^<!DOCTYPE html>/);
  assert.match(wrapBrandedEmail(undefined), /^<!DOCTYPE html>/);
});

test('wrapBrandedEmail honours a custom accent colour', () => {
  const out = wrapBrandedEmail('<p>x</p>', { accent: '#b71c1c' });
  assert.match(out, /background:#b71c1c/);
});

test('wrapBrandedEmail emits exactly one editable slot when asked, and none by default', () => {
  const withSlot = wrapBrandedEmail('<p>x</p>', { editableSlot: true });
  const matches = withSlot.match(new RegExp(EDITABLE_SLOT_ATTR, 'g')) || [];
  assert.equal(matches.length, 1);

  const withoutSlot = wrapBrandedEmail('<p>x</p>');
  assert.equal(withoutSlot.includes(EDITABLE_SLOT_ATTR), false);
});

test('stripEditableSlot removes the preview-only marker', () => {
  const withSlot = wrapBrandedEmail('<p>x</p>', { editableSlot: true });
  assert.equal(stripEditableSlot(withSlot).includes(EDITABLE_SLOT_ATTR), false);
});

// ── ordering contract with injectTrackingPixel ────────────────────────

test('wrapping before injectTrackingPixel puts the pixel inside <body>', () => {
  const wrapped = wrapBrandedEmail('<p>Dear Candidate,</p>');
  const withPixel = injectTrackingPixel(wrapped, 'test-token-1234');

  // When PUBLIC_BASE_URL is unset the pixel is a documented no-op; only assert
  // placement when the pixel was actually injected.
  if (withPixel !== wrapped) {
    const pixelAt = withPixel.indexOf('/api/track/open/test-token-1234');
    const bodyEndAt = withPixel.lastIndexOf('</body>');
    assert.ok(pixelAt !== -1, 'pixel should be present');
    assert.ok(pixelAt < bodyEndAt, 'pixel must sit before </body>, not after it');
  }
});

// ── brandedWrapperParts (preview payload) ─────────────────────────────

test('brandedWrapperParts returns the same chrome the send path renders', () => {
  const parts = brandedWrapperParts({ title: 'Interview Cancelled' });
  assert.match(parts.headerHtml, /aapna-gptw-black\.png/);
  assert.match(parts.headerHtml, /Interview Cancelled/);
  assert.match(parts.footerHtml, /All rights reserved/);

  // The chrome must be a substring of what wrapBrandedEmail produces —
  // this is what guarantees preview and delivery cannot drift.
  const full = wrapBrandedEmail('<p>x</p>', { title: 'Interview Cancelled' });
  assert.ok(full.includes(parts.headerHtml), 'header must match the send path');
  assert.ok(full.includes(parts.footerHtml), 'footer must match the send path');
});
