/**
 * Parsing the Settings list of recruiters added as optional attendees to every
 * booked interview's Teams meeting.
 * Run: node --test src/tests/unit/interviewOptionalAttendees.test.js
 *
 * Pure: only parseOptionalAttendees is exercised, so no database is touched
 * (importing the module constructs the Prisma client but opens no connection).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseOptionalAttendees } from '../../services/interviewOptionalAttendees.service.js';

describe('parseOptionalAttendees', () => {
  test('accepts an array, trimming and de-duplicating case-insensitively', () => {
    const out = parseOptionalAttendees([' chhaya@aapnainfotech.com ', 'CHHAYA@aapnainfotech.com', 'sweta@aapnainfotech.com']);
    assert.deepEqual(out.emails, ['chhaya@aapnainfotech.com', 'sweta@aapnainfotech.com']);
    assert.deepEqual(out.invalid, []);
  });

  test('accepts a comma, semicolon or space separated string', () => {
    const out = parseOptionalAttendees('a@x.com, b@x.com; c@x.com d@x.com');
    assert.deepEqual(out.emails, ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com']);
  });

  test('reports invalid entries rather than dropping them silently', () => {
    const out = parseOptionalAttendees(['naveen', 'naveen@aapnainfotech.com']);
    assert.deepEqual(out.emails, ['naveen@aapnainfotech.com']);
    assert.deepEqual(out.invalid, ['naveen']);
  });

  test('an empty list is valid and means nobody extra', () => {
    for (const empty of [[], '', null, undefined]) {
      const out = parseOptionalAttendees(empty);
      assert.deepEqual(out.emails, []);
      assert.deepEqual(out.invalid, []);
    }
  });
});
