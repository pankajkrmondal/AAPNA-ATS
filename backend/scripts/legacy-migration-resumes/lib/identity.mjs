// Stage 3 name rules, shared by 3-transform.mjs (one person inside the archive) and 4-load.mjs
// (identity guard against the ATS, plan 3.1). Pure functions. No candidate data is logged.
//
// Identity guard (plan 3.1): a resume that matches by e-mail or phone but whose name clearly differs
// (no shared name token after normalising) is not merged: outcome review_identity_conflict.

// Tokens that say nothing about who someone is: titles, and parts so common that two different
// people share them all the time ("Rahul Kumar" / "Amit Kumar"). Initials (one letter) are ignored too.
const NOT_IDENTIFYING = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'er', 'md', 'mohd', 'kumar', 'kumari', 'km', 'candidate', 'resume', 'cv', 'curriculum', 'vitae', 'profile']);

/** Normalised name tokens; an empty set means "name unknown". */
export function nameTokens(name) {
  return new Set(String(name || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z]+/g, ' ').trim().split(' ')
    .filter((t) => t.length >= 2 && !NOT_IDENTIFYING.has(t)));
}

/** The name string used to count "different names" for the shared-contact guard. */
export function nameKey(name) {
  return [...nameTokens(name)].sort().join(' ');
}

/** True when the two names can be the same person: either is unknown, or they share a token. */
export function sameIdentity(a, b) {
  const ta = nameTokens(a); const tb = nameTokens(b);
  if (ta.size === 0 || tb.size === 0) return true;
  for (const t of ta) if (tb.has(t)) return true;
  return false;
}

/** The latest date written in the employment history (a "present" end date is not a written date). */
export function latestWrittenDate(employmentHistory) {
  let best = '';
  for (const j of Array.isArray(employmentHistory) ? employmentHistory : []) {
    for (const v of [j?.StartDate, j?.EndDate]) {
      const s = String(v || '').trim();
      if (!s || /present|current|till|to\s*date|now|ongoing/i.test(s)) continue;
      const y = /(19|20)\d{2}/.exec(s);
      if (!y) continue;
      const mm = /^(\d{1,2})[/\-. ]\d{4}$/.exec(s)?.[1] || /^\d{4}[/\-.](\d{1,2})$/.exec(s)?.[1]
        || String(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(s.slice(0, 3).toLowerCase()) + 1);
      const m = Math.min(12, Math.max(1, Number(mm) || 1));
      const k = `${y[0]}-${String(m).padStart(2, '0')}`;
      if (k > best) best = k;
    }
  }
  return best; // '' = none written
}
