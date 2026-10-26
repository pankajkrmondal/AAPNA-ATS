import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { compareNearestMiss, exclusionReasons } from '../../utils/screeningExclusionReasons.js';

const NOW = new Date('2026-10-23T12:00:00Z').getTime();
const jd = { mode: 'jd', expMin: 3, expMax: 6, ctcMax: 15, educationLabel: 'BE/BTech or MCA' };
const kw = { mode: 'keyword', expMin: 3, expMax: null, ctcMin: null, ctcMax: 10, noticeMax: 30, addedWithinDays: 30, locations: ['pune'] };
const r = (keys, c, ctx = jd, extra = {}) => exclusionReasons({ keys, c, ctx, now: NOW, ...extra });

describe('exclusionReasons (L11)', () => {
  test('rejected for this role, with when and by whom', () => {
    assert.deepEqual(
      r(['recentlyRejected'], { rejected_at: '2026-10-11T12:00:00Z', rejected_by: 'anita' }),
      ['Rejected for this role 12 days ago by anita (cool-off)'],
    );
    assert.deepEqual(r(['recentlyRejected'], {}, kw), ['Rejected for a role recently (cool-off)']);
  });

  test('experience and CTC say the value and the requirement', () => {
    assert.deepEqual(r(['experience'], { TotalExperienceYearsNumeric: '1' }), ['Experience 1 yr, needs 3–6 yrs']);
    assert.deepEqual(r(['experience'], { TotalExperienceYearsNumeric: 9.25 }), ['Experience 9.3 yrs, needs 3–6 yrs']);
    assert.deepEqual(r(['experience'], { TotalExperienceYearsNumeric: 1 }, kw), ['Experience 1 yr, needs at least 3 yrs']);
    assert.deepEqual(r(['experience'], {}), ['Experience not on file']);
    assert.deepEqual(r(['ctc'], { ExpectedCTCNumeric: 18 }), ['Expected CTC 18 LPA, budget 15']);
    assert.deepEqual(r(['ctc'], { ExpectedCTCNumeric: 12 }, kw), ['Expected CTC 12 LPA, limit 10']);
    assert.deepEqual(r(['ctc'], {}), ['Expected CTC not on file']);
  });

  test('education, location, notice, recency and skills', () => {
    assert.deepEqual(r(['education'], { graduationdegree: 'B.Com' }), ['Education: B.Com, needs BE/BTech or MCA']);
    assert.deepEqual(r(['location'], { CurrentLocation: 'Delhi' }, kw), ['Location: Delhi, needs pune']);
    assert.deepEqual(r(['notice'], { NoticePeriodDays: 90 }, kw), ['Notice 90 days, at most 30']);
    assert.deepEqual(r(['addedWithin'], { createdAt: '2026-08-24T12:00:00Z' }, kw), ['Added 60 days ago, outside the last 30 days']);
    assert.deepEqual(r(['skills'], {}, jd, { missingSkills: ['C#', 'Azure'] }), ['Missing mandatory skills: C#, Azure']);
    assert.deepEqual(r(['skills'], {}, kw, { missingSkills: ['Kafka'] }), ['Missing skill: Kafka']);
  });

  test('one line per failed rule, in the order given', () => {
    assert.equal(r(['ctc', 'experience'], { ExpectedCTCNumeric: 20, TotalExperienceYearsNumeric: 9 }).length, 2);
  });
});

describe('compareNearestMiss (L11)', () => {
  test('fewest failed rules, then fewest missing skills, then newest', () => {
    const rows = [
      { id: 'two', keys: ['ctc', 'experience'], createdAt: '2026-10-20' },
      { id: 'skills3', keys: ['skills'], missingSkills: ['a', 'b', 'c'], createdAt: '2026-10-22' },
      { id: 'skills1', keys: ['skills'], missingSkills: ['a'], createdAt: '2026-10-01' },
      { id: 'ctcOld', keys: ['ctc'], createdAt: '2026-01-01' },
      { id: 'ctcNew', keys: ['ctc'], createdAt: '2026-10-21' },
    ];
    assert.deepEqual(rows.sort(compareNearestMiss).map((x) => x.id), ['ctcNew', 'ctcOld', 'skills1', 'skills3', 'two']);
  });
});
