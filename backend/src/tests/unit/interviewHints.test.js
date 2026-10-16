/**
 * Interviewer hints for the Schedule dialog (Phase 3 "Do Now", N23).
 *
 * Run: node --test src/tests/unit/interviewHints.test.js
 *
 * RT saw "Yes" pre-filled as the CEO round's interviewer: the CEO round read
 * the MRF's Yes/No "is there a CEO round" column as a name, and "Yes" passed
 * both name filters. The round now reads ceo_panel_details, and a Yes/No answer
 * is never treated as a person, whichever column it turns up in.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cleanHint, looksLikeHumanName, mrfRoundHints, SCHEDULABLE_STAGES } from '../../services/interviewSchedule.service.js';

test('"Yes" / "No" / "NA" are placeholders, never a hint or a name', () => {
  for (const v of ['Yes', 'YES', ' yes ', 'No', 'na', 'N/A', '-', '']) {
    assert.equal(cleanHint(v), null, JSON.stringify(v));
  }
  for (const v of ['Yes', 'no', 'NA']) assert.equal(looksLikeHumanName(v), false, v);
  // Real names and terse initials still pass (RT 2026-07-24: conservative).
  assert.equal(looksLikeHumanName('Abhijit Roy'), true);
  assert.equal(looksLikeHumanName('HM'), true);
  assert.equal(cleanHint('4-5 PM'), '4-5 PM');
});

test('the CEO round takes its interviewer from ceo_panel_details, not the Yes/No column', () => {
  assert.equal(SCHEDULABLE_STAGES.ceo.ownerField, 'ceo_panel_details');
  const mrf = { ceo_management_round: 'Yes', ceo_panel_details: 'Abhijit Roy' };
  assert.equal(mrfRoundHints(mrf, 'ceo').interviewerName, 'Abhijit Roy');
  // An MRF that says "Yes" but names nobody: blank, not "Yes".
  assert.equal(mrfRoundHints({ ceo_management_round: 'Yes', ceo_panel_details: null }, 'ceo').interviewerName, null);
  // Any column holding a bare "Yes" is still never a name.
  assert.equal(mrfRoundHints({ hr_round: 'Yes' }, 'hr_round').interviewerName, null);
});
