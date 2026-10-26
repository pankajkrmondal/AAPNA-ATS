/**
 * screeningExclusionReasons.js — why a candidate was left out of a screening
 * result, in plain words (L11).
 *
 * "8 recently rejected for this role · 3 meet education, budget and experience
 * · of those, 0 have all 7 mandatory skills — if I wish to see the data, there
 * is no such option." The summary line counted; this names the candidates and,
 * per candidate, says which rule removed them and by how much.
 *
 * Pure and import-free (tests/unit/screeningExclusionReasons.test.js). The
 * service hands it the candidate's card columns, the keys of the rules it
 * failed and the search's own thresholds, so the wording can never disagree
 * with the rule that was applied.
 */

/** Short names for the reason tabs, in funnel order. */
export const EXCLUSION_LABELS = Object.freeze({
  recentlyRejected: 'Recently rejected',
  education: 'Education',
  ctc: 'Over budget / CTC',
  experience: 'Experience',
  addedWithin: 'Added too long ago',
  location: 'Location',
  gender: 'Gender',
  notice: 'Notice period',
  position: 'Position applied',
  skills: 'Missing skills',
});

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const fmt = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));
const daysSince = (d, now) => {
  const t = d ? new Date(d).getTime() : NaN;
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 86400000)) : null;
};

function range(min, max, unit) {
  if (min != null && max != null) return `${fmt(min)}–${fmt(max)} ${unit}`;
  if (min != null) return `at least ${fmt(min)} ${unit}`;
  if (max != null) return `at most ${fmt(max)} ${unit}`;
  return '';
}

function educationOf(c) {
  const parts = [c.postgraduationdegree, c.graduationdegree, c.HighestQualification]
    .map((x) => String(x || '').trim()).filter(Boolean);
  return [...new Set(parts)].join(' / ');
}

/**
 * One reason line per failed rule.
 *
 * @param {object} p
 * @param {string[]} p.keys - the rule keys this candidate failed
 * @param {object} p.c - card columns (TotalExperienceYearsNumeric, ExpectedCTCNumeric, …, rejected_at, rejected_by)
 * @param {string[]} [p.missingSkills] - labels of the mandatory / searched skills not found
 * @param {object} p.ctx - the search's thresholds:
 *   { mode: 'jd'|'keyword', expMin, expMax, ctcMin, ctcMax, educationLabel, noticeMax,
 *     addedWithinDays, locations[], positions[], gender, roleName }
 * @param {number} [p.now]
 * @returns {string[]}
 */
export function exclusionReasons({ keys, c, missingSkills = [], ctx = {}, now = Date.now() }) {
  const out = [];
  for (const key of keys) {
    switch (key) {
      case 'recentlyRejected': {
        const days = daysSince(c.rejected_at, now);
        const where = ctx.mode === 'jd' ? 'for this role' : 'for a role';
        out.push(`Rejected ${where}${days != null ? ` ${days} day${days === 1 ? '' : 's'} ago` : ' recently'}${c.rejected_by ? ` by ${c.rejected_by}` : ''} (cool-off)`);
        break;
      }
      case 'education': {
        const has = educationOf(c);
        out.push(`Education: ${has || 'not on file'}${ctx.educationLabel ? `, needs ${ctx.educationLabel}` : ''}`);
        break;
      }
      case 'ctc': {
        const exp = num(c.ExpectedCTCNumeric);
        if (exp == null) out.push('Expected CTC not on file');
        else if (ctx.ctcMax != null && exp > ctx.ctcMax) out.push(`Expected CTC ${fmt(exp)} LPA, ${ctx.mode === 'jd' ? 'budget' : 'limit'} ${fmt(ctx.ctcMax)}`);
        else out.push(`Expected CTC ${fmt(exp)} LPA, needs ${range(ctx.ctcMin, ctx.ctcMax, 'LPA')}`);
        break;
      }
      case 'experience': {
        const yrs = num(c.TotalExperienceYearsNumeric);
        out.push(yrs == null
          ? 'Experience not on file'
          : `Experience ${fmt(yrs)} yr${yrs === 1 ? '' : 's'}, needs ${range(ctx.expMin, ctx.expMax, 'yrs')}`);
        break;
      }
      case 'addedWithin': {
        const days = daysSince(c.createdAt, now);
        out.push(`Added ${days != null ? `${days} days ago` : 'earlier'}, outside the last ${ctx.addedWithinDays} days`);
        break;
      }
      case 'location':
        out.push(`Location: ${String(c.CurrentLocation || '').trim() || 'not on file'}${ctx.locations?.length ? `, needs ${ctx.locations.join(' / ')}` : ''}`);
        break;
      case 'gender':
        out.push(`Gender: ${String(c.Gender || '').trim() || 'not on file'}`);
        break;
      case 'notice': {
        const d = num(c.NoticePeriodDays);
        out.push(d == null ? 'Notice period not on file' : `Notice ${fmt(d)} days, at most ${ctx.noticeMax}`);
        break;
      }
      case 'position':
        out.push(`Applied for: ${String(c.PositionApplied || '').trim() || 'not on file'}`);
        break;
      case 'skills':
        out.push(missingSkills.length
          ? `Missing ${ctx.mode === 'jd' ? 'mandatory ' : ''}skill${missingSkills.length === 1 ? '' : 's'}: ${missingSkills.join(', ')}`
          : 'Skills not found in the resume');
        break;
      default:
        out.push(EXCLUSION_LABELS[key] || key);
    }
  }
  return out;
}

/**
 * Nearest misses first: fewest failed rules, then fewest missing skills, then
 * the most recently added.
 */
export function compareNearestMiss(a, b) {
  return (a.keys.length - b.keys.length)
    || ((a.missingSkills?.length || 0) - (b.missingSkills?.length || 0))
    || (new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

export default { EXCLUSION_LABELS, exclusionReasons, compareNearestMiss };
