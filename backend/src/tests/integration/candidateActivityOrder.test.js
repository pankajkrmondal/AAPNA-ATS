/**
 * L01 — "Active candidates first" on the keyword search (staging DB).
 *
 *   node src/tests/run-block.mjs src/tests/integration/candidateActivityOrder.test.js
 *
 * Five candidates with the same skills (so the same match score), scoped by a
 * sentinel skill, differing only in when details were requested / submitted:
 *   AF  Active, responded in 1 day
 *   AS  Active, responded in 7 days
 *   P   Pending response (asked 3 days ago)
 *   N   New applicant (added today, never asked)
 *   I   Inactive (added 200 days ago, never asked)
 * Uses the saved active window (default 15 days). Torn down by explicit id.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import prisma from '../../config/database.js';
import { disconnectRedis } from '../../config/redis.js';
import { searchKeywordCandidatesV2 } from '../../services/screeningV2.service.js';
import { getActiveWindowDays } from '../../services/candidateActivitySettings.service.js';

const TAG = 'L01-ACTIVITY-FIXTURE';
const SENTINEL = 'Zqyactivitysentinel';
const DAY = 86400000;
const ago = (d) => new Date(Date.now() - d * DAY);

const FIXTURES = {
  AF: { details_requested_at: ago(4), details_completed_at: ago(3), createdAt: ago(5) },
  AS: { details_requested_at: ago(10), details_completed_at: ago(3), createdAt: ago(11) },
  P: { details_requested_at: ago(3), createdAt: ago(4) },
  N: { createdAt: ago(0) },
  I: { createdAt: ago(200) },
};

const idOf = {};
const keyOf = new Map();
const fixtureOrder = (r) => r.candidates.map((c) => keyOf.get(String(c.id))).filter(Boolean);

describe('L01 — Active candidates first (keyword search)', () => {
  before(async () => {
    for (const [key, dates] of Object.entries(FIXTURES)) {
      const row = await prisma.rpa_cv.create({
        data: {
          Name: `Zqy Activity ${key}`, EmailID: `zqy.activity.${key.toLowerCase()}@example.invalid`,
          Top5KeySkills: `Kotlin, ${SENTINEL}`, resume_full_text: 'Kotlin services.',
          MetaData: TAG, statusActive: 'ACTIVE', modifiedAt: new Date(), ...dates,
        },
        select: { id: true },
      });
      idOf[key] = row.id;
      keyOf.set(String(row.id), key);
    }
  });

  after(async () => {
    const ids = Object.values(idOf);
    if (ids.length) await prisma.rpa_cv.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
    try { await disconnectRedis?.(); } catch { /* ignore */ }
  });

  test('the window in use is the setting (default 15 days)', async () => {
    const days = await getActiveWindowDays();
    assert.ok(days >= 11, `this test assumes a window of at least 11 days, got ${days}`);
  });

  test('default order: Active (quicker first), then Pending / New, then Inactive', async () => {
    const r = await searchKeywordCandidatesV2({ keyword: SENTINEL });
    const order = fixtureOrder(r);
    assert.equal(order.length, 5);
    assert.deepEqual(order.slice(0, 2), ['AF', 'AS'], 'Active first, the 1-day responder before the 7-day one');
    assert.deepEqual(order.slice(2, 4).sort(), ['N', 'P'], 'then Pending response and New applicant');
    assert.equal(order[4], 'I', 'Inactive last');

    const byKey = Object.fromEntries(r.candidates.filter((c) => keyOf.has(String(c.id))).map((c) => [keyOf.get(String(c.id)), c.activity]));
    assert.equal(byKey.AF.status, 'active');
    assert.equal(byKey.AF.responseDays, 1);
    assert.equal(byKey.P.status, 'pending');
    assert.equal(byKey.N.status, 'new');
    assert.equal(byKey.I.status, 'inactive');
    assert.equal(byKey.I.detail, 'never contacted');

    assert.equal(r.summary.activeFirst, true);
    assert.deepEqual(r.summary.activityCounts, { active: 2, pending: 1, new: 1, inactive: 1 });
  });

  test('unticked: score order only, chips still there', async () => {
    const r = await searchKeywordCandidatesV2({ keyword: SENTINEL, activeFirst: false });
    assert.equal(r.summary.activeFirst, false);
    assert.equal(fixtureOrder(r).length, 5);
    // Equal scores: the old last tie-break (newest first) decides, so N (added today) leads.
    assert.equal(fixtureOrder(r)[0], 'N');
    assert.ok(r.candidates.every((c) => c.activity?.status));
  });
});
