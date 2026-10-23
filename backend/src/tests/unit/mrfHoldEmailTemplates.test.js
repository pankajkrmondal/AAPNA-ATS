import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MRF_HOLD_TEMPLATE_NAMES,
  MRF_HOLD_TEMPLATE_DEFAULTS,
  MRF_HOLD_OPTIONAL_PLACEHOLDERS,
} from '../../services/mrfHoldEmailTemplates.js';

const tokensIn = (s) => new Set([...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]));

test('every named MRF hold template has a default', () => {
  for (const name of Object.values(MRF_HOLD_TEMPLATE_NAMES)) {
    assert.ok(MRF_HOLD_TEMPLATE_DEFAULTS[name], `missing default for "${name}"`);
  }
});

test('declared placeholders are exactly the tokens the default uses', () => {
  for (const [name, t] of Object.entries(MRF_HOLD_TEMPLATE_DEFAULTS)) {
    const used = new Set([...tokensIn(t.subject), ...tokensIn(t.body_html)]);
    assert.deepEqual([...used].sort(), [...t.placeholders].sort(), name);
  }
});

test('fragment tokens are optional; value tokens are not', () => {
  for (const t of Object.values(MRF_HOLD_TEMPLATE_DEFAULTS)) {
    for (const p of t.placeholders) {
      const isFragment = /_(line|row)$/.test(p);
      assert.equal(MRF_HOLD_OPTIONAL_PLACEHOLDERS.includes(p), isFragment, p);
    }
  }
});

test('defaults are body fragments, so the branded wrapper is applied', () => {
  for (const [name, t] of Object.entries(MRF_HOLD_TEMPLATE_DEFAULTS)) {
    assert.ok(!/<html|<!doctype|<body/i.test(t.body_html), name);
    assert.ok(!/regards/i.test(t.body_html), `${name} should leave the sign-off to the wrapper`);
  }
});
