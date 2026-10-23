/**
 * JD-screening cache keys with the "Added within" filter (Phase 3 "Do Now", N38).
 * Pure — no Redis.
 * Run: node --test src/tests/unit/screeningCacheKeys.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RECENCY_DAY_OPTIONS, isCacheableRecency, roleCacheKey, roleCacheKeyV2, allRoleCacheKeys,
} from '../../utils/screeningCacheKeys.js';

test('unfiltered keys are unchanged from before N38', () => {
  assert.equal(roleCacheKey(41), 'screening:role:41');
  assert.equal(roleCacheKeyV2(41), 'screening:role:v2:41');
});

test('each "Added within" value has its own key, so filtered and unfiltered results never mix', () => {
  assert.equal(roleCacheKeyV2(41, 15), 'screening:role:v2:41:d15');
  assert.equal(roleCacheKey(41, 7), 'screening:role:41:d7');
  assert.notEqual(roleCacheKeyV2(41, 15), roleCacheKeyV2(41));
});

test('only the offered values are cached', () => {
  assert.deepEqual([...RECENCY_DAY_OPTIONS], [7, 10, 15, 30, 90]);
  assert.equal(isCacheableRecency(null), true);
  assert.equal(isCacheableRecency(10), true);
  assert.equal(isCacheableRecency(11), false);
});

test('allRoleCacheKeys names every variant of both searches, for MRF edit / close', () => {
  const keys = allRoleCacheKeys(41);
  // 6 "Added within" values x 2 searches x tagged-only on/off (N15) x active-first on/off (L01).
  assert.equal(keys.length, 48);
  assert.equal(new Set(keys).size, 48);
  assert.ok(keys.includes('screening:role:41'));
  assert.ok(keys.includes('screening:role:v2:41'));
  assert.ok(keys.includes('screening:role:v2:41:d90'));
  assert.ok(keys.includes('screening:role:41:d10'));
  assert.ok(keys.includes('screening:role:v2:41:t'));
  assert.ok(keys.includes('screening:role:41:d7:t'));
});

test('"Tagged to this JD only" has its own key; the untagged keys are unchanged (N15)', () => {
  assert.equal(roleCacheKeyV2(41, null, true), 'screening:role:v2:41:t');
  assert.equal(roleCacheKeyV2(41, 15, true), 'screening:role:v2:41:d15:t');
  assert.equal(roleCacheKey(41, null, false), 'screening:role:41');
  assert.notEqual(roleCacheKeyV2(41, null, true), roleCacheKeyV2(41));
});

test('"Active candidates first" has its own key; score-only keys are unchanged (L01)', () => {
  assert.equal(roleCacheKeyV2(41, null, false, true), 'screening:role:v2:41:a');
  assert.equal(roleCacheKeyV2(41, 15, true, true), 'screening:role:v2:41:d15:t:a');
  assert.equal(roleCacheKey(41, null, false, true), 'screening:role:41:a');
  assert.equal(roleCacheKeyV2(41, 15, true), 'screening:role:v2:41:d15:t');
  assert.ok(allRoleCacheKeys(41).includes('screening:role:v2:41:d90:t:a'));
});
