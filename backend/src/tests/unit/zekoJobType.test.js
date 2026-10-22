/**
 * Zeko job type tag — must come from Zeko's own interview data, not the name.
 * Run: node --test src/tests/unit/zekoJobType.test.js
 *
 * Fixtures mirror real staging rows. isHRScreeningInterviewPresent is false on
 * every Zeko job (real HR screenings included), so the old "hr" substring match
 * on the name was deciding — and tagged "Junior HR Operations - Functional
 * Interview" as HR, hiding it from the Functional round.
 *
 * Pure unit test — no database, no network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveZekoInterviewType } from '../../utils/zekoJobType.js';

const role = (hiringName, type, extra = {}) => ({
  hiringName,
  isHRScreeningInterviewPresent: false,
  isCodingInterviewPresent: false,
  interviews: type ? [{ _id: 'x', type }] : [],
  ...extra,
});

test('functional interview about HR is functional, not HR (the reported bug)', () => {
  assert.equal(deriveZekoInterviewType(role('Junior HR Operations - Functional Interview', 'functional-interview')), 'functional');
  assert.equal(deriveZekoInterviewType(role('Junior HR Operations & AI Generalist_Functional Interview_16/09', 'functional-interview')), 'functional');
});

test('screening-interview is HR even when the name says nothing about HR', () => {
  assert.equal(deriveZekoInterviewType(role('Dot Net Developer (.Net, Winforms,SQL)', 'screening-interview')), 'hr');
  assert.equal(deriveZekoInterviewType(role('PMO Associate - HR Interview', 'screening-interview')), 'hr');
});

test('functional-interview without a keyword in the name is still functional', () => {
  assert.equal(deriveZekoInterviewType(role('UX/UI Designer', 'functional-interview')), 'functional');
  assert.equal(deriveZekoInterviewType(role('IT Recruitment Executive - Tech Interview', 'functional-interview')), 'functional');
});

test('coding flag wins over the functional interview type', () => {
  assert.equal(deriveZekoInterviewType(role('Python Developer Hiring', 'functional-interview', { isCodingInterviewPresent: true })), 'coding');
  assert.equal(deriveZekoInterviewType(role('Junior QA Python Role - Functional and coding', 'functional-interview', { isCodingInterviewPresent: true })), 'coding');
});

test('name fallback (no interview data) matches whole words, round keyword beats "hr"', () => {
  assert.equal(deriveZekoInterviewType(role('HR Operations - Functional', null)), 'functional');
  assert.equal(deriveZekoInterviewType(role('QA Automation Engineer - HR', null)), 'hr');
  assert.equal(deriveZekoInterviewType(role('Three Shreya Chris', null)), 'other');
  assert.equal(deriveZekoInterviewType(role('Backend coding round', null)), 'coding');
  assert.equal(deriveZekoInterviewType({}), 'other');
});
