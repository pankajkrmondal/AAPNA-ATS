/**
 * "Added within" on the OLD keyword search (SCREENING_V2 off).
 *
 *   node src/tests/run-block.mjs src/tests/integration/legacyAddedWithin.test.js
 *
 * The keyword form offers "Added within" whatever the flag says, but the old
 * search dropped it, so "Last 30 days" listed candidates added in June
 * (reported 15 Oct 2026). It now applies the same rule as the strict search:
 * created within N days, and a candidate with no created date is excluded.
 *
 * Exercises the no-keyword path (a Prisma filter). The keyword path adds the
 * same condition to its vector SQL and needs pgvector + an embedding key, so
 * it is checked on staging, not here.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import prisma from '../../config/database.js';
import { disconnectRedis } from '../../config/redis.js';
import { searchKeywordCandidates } from '../../services/screening.service.js';

const TAG = 'LEGACY-ADDED-WITHIN-FIXTURE';
// A location no real candidate has, so every search is scoped to the fixtures.
const PLACE = 'Zqxaddedwithin Town';
const DAY = 24 * 60 * 60 * 1000;
const ids = [];

const names = (result) => (result.candidates || result.data?.candidates || [])
  .map((c) => c.Name)
  .filter((n) => String(n).startsWith('AW '))
  .sort();

describe('old keyword search honours "Added within"', () => {
  before(async () => {
    for (const [Name, createdAt] of [
      ['AW Recent', new Date(Date.now() - 10 * DAY)],
      ['AW Old', new Date(Date.now() - 110 * DAY)],
      ['AW Undated', null],
    ]) {
      const row = await prisma.rpa_cv.create({
        data: { Name, EmailID: `${Name.replace(/\s/g, '.').toLowerCase()}@example.invalid`, CurrentLocation: PLACE, MetaData: TAG, statusActive: 'ACTIVE', createdAt },
      });
      ids.push(row.id);
    }
  });

  after(async () => {
    await prisma.rpa_cv.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
    await disconnectRedis().catch(() => {});
  });

  test('no window: everyone, dated or not', async () => {
    assert.deepEqual(names(await searchKeywordCandidates({ location: PLACE })), ['AW Old', 'AW Recent', 'AW Undated']);
  });

  test('30 days: only the recent one; undated rows are excluded', async () => {
    assert.deepEqual(names(await searchKeywordCandidates({ location: PLACE, addedWithinDays: 30 })), ['AW Recent']);
    assert.deepEqual(names(await searchKeywordCandidates({ location: PLACE, addedWithinDays: '30' })), ['AW Recent'], 'string from the form');
  });

  test('a bad value is "no filter", never an error', async () => {
    for (const bad of [0, -5, 'abc', 4000]) {
      assert.equal(names(await searchKeywordCandidates({ location: PLACE, addedWithinDays: bad })).length, 3, String(bad));
    }
  });
});
