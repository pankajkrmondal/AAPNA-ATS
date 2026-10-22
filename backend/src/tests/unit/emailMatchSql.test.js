/**
 * An Evalground result must reach a candidate who has more than one address
 * on file. Run: node --test src/tests/unit/emailMatchSql.test.js
 *
 * rpa_cv."EmailID" holds every address we hold for a candidate, comma-joined
 * ("a@x.com,b@y.com" — hrUpload.service.js's appendUnique merge), while
 * Evalground/Outlook/Zeko each report the single address their record was
 * created against. assessmentImport.service.js compared the two directly
 * (`"EmailID" ILIKE ${email}` — a wildcard-free ILIKE is just a
 * case-insensitive `=`), so on 2026-08-25 a result for
 * aiuserpankajmondal@gmail.com was reported as "No candidate found for this
 * email" even though that candidate was sitting on the Assessment stage with
 * an invite already sent. The lookup now matches by address-set overlap.
 *
 * Pure unit test — asserts the predicate the database is handed. No database,
 * no network.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';

import { emailMatchesSql } from '../../utils/emailMatch.js';

const COLUMN = Prisma.sql`"EmailID"`;

/** The address list the predicate will actually match on. */
const boundEmails = (value) => emailMatchesSql(COLUMN, value).values[0];

describe('emailMatchesSql — bound addresses', () => {
  test('binds the looked-up address as a text[] the stored column is tested against', () => {
    const predicate = emailMatchesSql(COLUMN, 'aiuserpankajmondal@gmail.com');
    assert.deepEqual(predicate.values, [['aiuserpankajmondal@gmail.com']]);
  });

  test('normalises case and surrounding whitespace', () => {
    assert.deepEqual(boundEmails('  AiUser@Gmail.com  '), ['aiuser@gmail.com']);
  });

  test('accepts a multi-valued needle, splitting it like emailCandidates()', () => {
    assert.deepEqual(boundEmails('a@x.com, b@y.com'), ['a@x.com', 'b@y.com']);
    assert.deepEqual(boundEmails('a@x.com;b@y.com'), ['a@x.com', 'b@y.com']);
  });

  test('accepts an array of addresses', () => {
    assert.deepEqual(boundEmails(['A@x.com', 'b@y.com']), ['a@x.com', 'b@y.com']);
  });

  test('de-duplicates so one address is never bound twice', () => {
    assert.deepEqual(boundEmails('a@x.com, A@X.COM'), ['a@x.com']);
  });
});

describe('emailMatchesSql — no-address guard', () => {
  // The predicate is interpolated into UPDATE statements (zeko.service.js), so
  // "no address to match on" must narrow to nothing, never widen to everything.
  for (const empty of [null, undefined, '', '   ', '  ,  ', [], ['', null]]) {
    test(`${JSON.stringify(empty)} yields an always-false predicate`, () => {
      const predicate = emailMatchesSql(COLUMN, empty);
      assert.equal(predicate.sql.trim(), 'false');
      assert.deepEqual(predicate.values, []);
    });
  }
});

describe('emailMatchesSql — generated SQL', () => {
  const sql = emailMatchesSql(Prisma.sql`cv."EmailID"`, 'a@x.com').sql;

  test('splits the stored column rather than comparing it whole', () => {
    assert.match(sql, /regexp_split_to_array/);
    assert.match(sql, /'\[,;\]'/); // both separators emailCandidates() understands
    assert.match(sql, /&&/); // array overlap, not equality
  });

  test('lower-cases and strips whitespace on the stored side', () => {
    assert.match(sql, /lower\(/);
    // '[[:space:]]', not '\s' — a backslash escape would be swallowed by the JS
    // template literal before Postgres ever saw it.
    assert.match(sql, /\[\[:space:\]\]/);
    assert.ok(!sql.includes('\\s'), 'must not rely on a JS-escaped \\s');
  });

  test('never emits ILIKE, whose wildcards misread emails containing "_"', () => {
    assert.ok(!/ILIKE/i.test(sql));
  });

  test('treats a NULL column as empty rather than dropping the row', () => {
    assert.match(sql, /coalesce\(/);
  });

  test('embeds the caller-supplied column', () => {
    assert.match(sql, /cv\."EmailID"/);
  });
});

describe('emailMatchesSql — composes into a full statement', () => {
  test('nests inside a query without disturbing parameter order', () => {
    const stageKey = 'assessment';
    const full = Prisma.sql`
      SELECT id FROM rpa_cv cv
      WHERE ${emailMatchesSql(Prisma.sql`cv."EmailID"`, 'a@x.com')}
        AND cv.stage = ${stageKey};`;
    assert.deepEqual(full.values, [['a@x.com'], 'assessment']);
  });
});
