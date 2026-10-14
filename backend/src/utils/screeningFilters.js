/**
 * Strict screening filters, shared by Keyword search and JD search
 * (Phase 3 "Do Now", N01).
 *
 * WHY THIS EXISTS
 * ---------------
 * Before this module each search built its own filters inside a long function,
 * and the two disagreed: with skills typed, Location and Gender were silently
 * ignored; experience/CTC kept candidates with no value; skills matched as
 * substrings in both directions ("django" matched "Go", "java" matched
 * "javascript", "Gagarai" matched "ai"). RT's rule (29 Sep) is simple and
 * strict, and lives here once:
 *
 *   - Every applied filter is a HARD filter. A candidate with no value for an
 *     applied filter is EXCLUDED, never given the benefit of the doubt.
 *   - 0 is a real value ("Min experience 0" means "include freshers", and still
 *     requires the experience to be known).
 *   - Skills match WHOLE WORDS, with a small alias table (.NET / dotnet, C#,
 *     C++, Node.js, JS …). All / Any toggle, default All.
 *   - Location is an exact match on one comma-separated part of the stored
 *     location: "Noida" matches "Noida, UP" but never "Greater Noida".
 *
 * Pure functions only — no prisma client, no redis — so every rule is unit
 * tested without a database (src/tests/unit/screeningFilters.test.js).
 *
 * SQL AND JS MUST AGREE
 * ---------------------
 * buildFilterConditions() is what the database runs; passesStrictFilters() is
 * the same rule in JavaScript, used as a defensive second check on the rows
 * that come back and for the education filter (whose category rules live in
 * JS — educationCategories.js — and have no SQL form). The regex sources are
 * shared, so a rule changed in one place changes in both.
 *
 * Regexes are passed to Postgres as BOUND PARAMETERS, never spliced into the
 * SQL text, so their backslashes reach the database intact (the template-literal
 * problem emailMatch.js notes applies only to SQL text). Postgres ARE and JS
 * RegExp agree on every construct used below.
 */
import { Prisma } from '@prisma/client';
import { normalisePhone } from './phone.js';
import { getCandidateEducationCategories } from './educationCategories.js';

// ---------------------------------------------------------------------------
// Skill phrases & whole-word matching
// ---------------------------------------------------------------------------

/**
 * Split a skill string into individual skill phrases.
 * Splits only on list separators (comma / semicolon / newline / slash) so that
 * multi-word skills like "Machine Learning" stay intact.
 * Moved here from screening.service.js; behaviour unchanged.
 *
 * @param {string|null|undefined} skillsStr
 * @returns {string[]}
 */
export function splitSkillPhrases(skillsStr) {
  if (!skillsStr) return [];
  return String(skillsStr)
    .split(/[,;\n/]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Spellings treated as the same skill. A term typed as ANY member of a group
 * matches text containing ANY member. Kept deliberately short: every entry
 * widens what "strict" means, so add one only for a spelling recruiters and
 * resumes genuinely use interchangeably.
 */
export const ALIAS_GROUPS = [
  ['.net', 'dotnet', 'dot net', 'asp.net', '.net core', 'asp.net core'],
  ['c#', 'csharp', 'c sharp'],
  ['c++', 'cpp'],
  ['node.js', 'nodejs', 'node js', 'node'],
  ['javascript', 'js'],
  ['react', 'react.js', 'reactjs'],
  ['angular', 'angular.js', 'angularjs'],
  ['vue', 'vue.js', 'vuejs'],
  ['postgresql', 'postgres'],
  ['kubernetes', 'k8s'],
];

/** lower-case, collapse inner whitespace, trim. */
function normaliseTerm(term) {
  return String(term ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const ALIAS_INDEX = new Map();
for (const group of ALIAS_GROUPS) {
  for (const form of group) ALIAS_INDEX.set(normaliseTerm(form), group);
}

/**
 * Every spelling a typed term should match (itself plus its alias group).
 * @param {string} term
 * @returns {string[]}
 */
export function termVariants(term) {
  const t = normaliseTerm(term);
  if (!t) return [];
  return ALIAS_INDEX.get(t) || [t];
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const escapeLike = (s) => s.replace(/[\\%_]/g, '\\$&');

/** Words inside a phrase may be separated by any run of space / "_" / "-". */
const splitWords = (v) => v.split(/[\s_-]+/).filter(Boolean);

/*
 * Word boundaries. Postgres \m / \M cannot be used: they treat "." "#" "+" as
 * boundaries, so ".NET" and "C++" could never match and "net" would match ".NET".
 *
 *   LEFT  — the term may not be preceded by a letter, digit, "+", "#" or ".":
 *           "c" never matches "react", "net" never matches ".net".
 *   RIGHT — the term may not be followed by a letter, digit, "+" or "#", nor by
 *           a "." that continues a word: "java" never matches "javascript" and
 *           "c" never matches "c#" / "c++", but a sentence-ending "Java." still
 *           matches.
 */
const LEFT = '(^|[^a-z0-9+#.])';
const RIGHT = '($|[^a-z0-9+#.]|[.]($|[^a-z0-9]))';

/**
 * Whole-word regex source matching any of the given phrases (case-insensitive
 * use is the caller's job: `~*` in SQL, the "i" flag in JS).
 *
 * @param {string[]} phrases - already-expanded spellings
 * @returns {string|null} null when there is nothing to match
 */
function phrasesRegexSource(phrases) {
  const alts = phrases
    .map((p) => splitWords(normaliseTerm(p)).map(escapeRegex).join('[\\s_-]+'))
    .filter(Boolean);
  if (alts.length === 0) return null;
  return `${LEFT}(${alts.join('|')})${RIGHT}`;
}

/**
 * Lower-case substrings at least one of which every match of
 * phrasesRegexSource(phrases) must contain — a cheap NECESSARY condition the
 * database checks with strpos() before running the regex.
 *
 * One word per phrase (its longest), then any key containing another key is
 * dropped: ".net", "dotnet" and "asp.net" all reduce to "net", so most of the
 * .NET alias group costs one strpos() per row instead of six scans.
 *
 * Measured on 100k synthetic resumes (2026-10-13): strpos(lower(text), ...) is
 * ~5x faster than LIKE and ~25x faster than ILIKE ANY over the same text.
 */
export function prefilterKeys(phrases) {
  const keys = phrases
    .map((p) => splitWords(normaliseTerm(p)).reduce((a, b) => (b.length >= a.length ? b : a), ''))
    .filter(Boolean);
  const uniq = [...new Set(keys)];
  return uniq.filter((k) => !uniq.some((o) => o !== k && k.includes(o)));
}

/**
 * Whole-word regex source for one skill term, aliases included.
 * @param {string} term
 * @returns {string|null}
 */
export function skillRegexSource(term) {
  return phrasesRegexSource(termVariants(term));
}

const regexCache = new Map();
function compiled(source) {
  let re = regexCache.get(source);
  if (!re) {
    re = new RegExp(source, 'i');
    regexCache.set(source, re);
  }
  return re;
}

/**
 * Does `text` contain `term` as a whole word (aliases included)?
 * @param {unknown} text
 * @param {string} term
 * @returns {boolean}
 */
export function wholeWordMatch(text, term) {
  if (text == null) return false;
  const source = skillRegexSource(term);
  if (!source) return false;
  return compiled(source).test(String(text));
}

// ---------------------------------------------------------------------------
// Filter parsing
// ---------------------------------------------------------------------------

const str = (v) => (v == null ? '' : String(v).trim());

/** Number or null. `0` and `'0'` are real values; '' / null / junk are "not applied". */
function num(v) {
  if (v == null) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Comma string or array → lower-cased, trimmed, de-duplicated list. */
function list(v, splitter = /,/) {
  const raw = Array.isArray(v) ? v : str(v).split(splitter);
  return [...new Set(raw.map((x) => normaliseTerm(x)).filter(Boolean))];
}

/**
 * One location part, normalised the same way in JS and SQL: lower-case, drop a
 * parenthetical ("Noida (UP)" → "noida"), collapse whitespace, trim.
 */
export function normaliseLocationPart(part) {
  return String(part ?? '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Stored location field → its comparable parts. */
export function locationParts(value) {
  if (value == null) return [];
  return String(value)
    .split(/[,/;|]/)
    .map(normaliseLocationPart)
    .filter(Boolean);
}

/** Stored gender spellings accepted for each filter value. */
const GENDER_VARIANTS = { male: ['male', 'm'], female: ['female', 'f'] };

/**
 * Normalises the screening request body.
 *
 * @param {object} [body] - POST /api/screening/keyword-search payload
 * @returns {{
 *   keyword: string, skills: string[], matchMode: 'all'|'any',
 *   lookup: string, name: string, email: string, phone: string,
 *   position: string[], education: string[], location: string[], gender: string,
 *   expMin: number|null, expMax: number|null, ctcMin: number|null, ctcMax: number|null,
 *   noticePeriod: number|null, addedWithinDays: number|null
 * }}
 */
export function parseScreeningFilters(body = {}) {
  const b = body || {};
  return {
    keyword: str(b.keyword),
    skills: [...new Set(splitSkillPhrases(b.keyword).map(normaliseTerm).filter(Boolean))],
    matchMode: str(b.matchMode).toLowerCase() === 'any' ? 'any' : 'all',
    // "Find a candidate" box: one input, auto-detected as email / phone / name.
    lookup: str(b.lookup).replace(/\s+/g, ' '),
    name: normaliseTerm(b.name),
    email: str(b.email).toLowerCase(),
    phone: str(b.phone),
    position: [...new Set(splitSkillPhrases(b.position).map(normaliseTerm).filter(Boolean))],
    education: list(b.education),
    location: [...new Set((Array.isArray(b.location) ? b.location : str(b.location).split(','))
      .map(normaliseLocationPart)
      .filter(Boolean))],
    gender: normaliseTerm(b.gender),
    expMin: num(b.expMin),
    expMax: num(b.expMax),
    ctcMin: num(b.ctcMin),
    ctcMax: num(b.ctcMax),
    noticePeriod: num(b.noticePeriod),
    addedWithinDays: positiveDays(b.addedWithinDays),
  };
}

/** "Added within" window: a whole number of days, 1–3650, else not applied. */
function positiveDays(v) {
  const n = num(v);
  return n != null && Number.isInteger(n) && n > 0 && n <= 3650 ? n : null;
}

// ---------------------------------------------------------------------------
// Exact lookup detection (N02)
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const PHONE_LIKE_RE = /^[+0-9\s().-]+$/;

/**
 * Decides whether a search is a lookup for one specific person.
 *
 * The screen's single "Find a candidate" box (`lookup`) is auto-detected: an
 * email, else a phone number (digits, spaces, +, -, brackets), else a name.
 * Explicit name / email / phone fields are honoured too (API callers), and an
 * email or phone typed into the Skills box is recognised (that is what
 * recruiters did before the box existed). Precedence: email > phone > name.
 *
 * @param {ReturnType<typeof parseScreeningFilters>} f
 * @returns {{type: 'email'|'phone'|'name', value: string|null}|null}
 *   value is null for a phone with fewer than 10 digits (caller rejects it).
 */
export function detectLookup(f) {
  if (f.lookup) {
    const text = f.lookup;
    if (EMAIL_RE.test(text)) return { type: 'email', value: text.toLowerCase() };
    if (PHONE_LIKE_RE.test(text)) return { type: 'phone', value: normalisePhone(text)[0] || null };
    return { type: 'name', value: normaliseTerm(text) };
  }
  if (f.email) return { type: 'email', value: f.email };
  if (f.phone) return { type: 'phone', value: normalisePhone(f.phone)[0] || null };
  if (f.name) return { type: 'name', value: f.name };

  const kw = f.keyword;
  if (kw && EMAIL_RE.test(kw)) return { type: 'email', value: kw.toLowerCase() };
  if (kw && PHONE_LIKE_RE.test(kw) && kw.replace(/[^0-9]/g, '').length >= 10) {
    return { type: 'phone', value: normalisePhone(kw)[0] || null };
  }
  return null;
}

// ---------------------------------------------------------------------------
// SQL builders
// ---------------------------------------------------------------------------

/** Validates a table alias before it is spliced into SQL text. */
function aliasOf(alias) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error(`Invalid SQL alias: ${alias}`);
  return alias;
}

/**
 * Whole-word predicate over one text column, cheap substring test first. The
 * CASE forces the order: Postgres does not otherwise promise to evaluate the
 * cheap test before the regex, and the regex over ~99k resumes is the
 * expensive part. NULL columns give false, never NULL.
 */
function columnMatchSql(columnSql, regexSource, keys) {
  const pre = Prisma.join(keys.map((k) => Prisma.sql`strpos(lower(${columnSql}), ${k}) > 0`), ' OR ');
  return Prisma.sql`(CASE WHEN ${pre} THEN ${columnSql} ~* ${regexSource} ELSE false END)`;
}

/**
 * The three places a skill can be evidenced: declared skills, extracted
 * technical terms, and the full resume text.
 */
function skillColumns(alias) {
  const a = aliasOf(alias);
  return [
    Prisma.raw(`${a}."Top5KeySkills"`),
    Prisma.raw(`${a}.resume_technical_terms::text`),
    Prisma.raw(`${a}.resume_full_text`),
  ];
}

/**
 * SQL predicate: the candidate has `term` (whole word, aliases included) in
 * declared skills, technical terms or resume text.
 * @param {string} term
 * @param {string} [alias='c']
 * @returns {Prisma.Sql|null}
 */
export function skillPredicateSql(term, alias = 'c') {
  const p = skillColumnPredicates(term, alias);
  if (!p) return null;
  return Prisma.sql`(${Prisma.join([p.declared, p.terms, p.resume], ' OR ')})`;
}

/**
 * The same whole-word test as skillPredicateSql, one predicate per evidence
 * column, so a query can return WHERE the skill was found (declared skill,
 * resume keyword, resume text) without shipping the resume itself.
 *
 * @param {string} term
 * @param {string} [alias='c']
 * @returns {{declared: Prisma.Sql, terms: Prisma.Sql, resume: Prisma.Sql}|null}
 */
export function skillColumnPredicates(term, alias = 'c') {
  const variants = termVariants(term);
  const source = phrasesRegexSource(variants);
  if (!source) return null;
  const keys = prefilterKeys(variants);
  const [declared, terms, resume] = skillColumns(alias).map((col) => columnMatchSql(col, source, keys));
  return { declared, terms, resume };
}

/**
 * All / Any combination of per-term skill predicates.
 * @param {string[]} terms
 * @param {'all'|'any'} [mode='all']
 * @param {string} [alias='c']
 * @returns {Prisma.Sql|null} null when there are no terms
 */
export function buildSkillPredicateSql(terms, mode = 'all', alias = 'c') {
  const preds = (terms || []).map((t) => skillPredicateSql(t, alias)).filter(Boolean);
  if (preds.length === 0) return null;
  return Prisma.sql`(${Prisma.join(preds, mode === 'any' ? ' OR ' : ' AND ')})`;
}

/**
 * The hard filters as named SQL predicates, in funnel order. Each predicate is
 * COALESCE'd to a strict boolean so `NOT (…)` in the removed-by counts never
 * meets a NULL. Education is not here: its rules are JS-only (see
 * passesStrictFilters).
 *
 * @param {ReturnType<typeof parseScreeningFilters>} f
 * @param {string} [alias='c']
 * @returns {Array<{key: string, sql: Prisma.Sql}>}
 */
export function buildFilterConditions(f, alias = 'c') {
  const a = aliasOf(alias);
  const col = (name) => Prisma.raw(`${a}."${name}"`);
  const conds = [];
  const add = (key, sql) => conds.push({ key, sql: Prisma.sql`COALESCE((${sql}), false)` });

  if (f.location.length > 0) {
    // Substring test first (cheap); the exact part match runs only on rows that pass it.
    const likes = f.location.map((city) => `%${escapeLike(city)}%`);
    add('location', Prisma.sql`CASE WHEN lower(${col('CurrentLocation')}) LIKE ANY(${likes}::text[]) THEN EXISTS (
      SELECT 1 FROM regexp_split_to_table(lower(${col('CurrentLocation')}), '[,/;|]') AS lp(part)
      WHERE btrim(regexp_replace(regexp_replace(lp.part, '[(][^)]*[)]', '', 'g'), '[[:space:]]+', ' ', 'g'))
            = ANY(${f.location}::text[])
    ) ELSE false END`);
  }

  if (f.gender) {
    const variants = GENDER_VARIANTS[f.gender] || [f.gender];
    add('gender', Prisma.sql`lower(btrim(${col('Gender')})) = ANY(${variants}::text[])`);
  }

  if (f.expMin != null || f.expMax != null) {
    const parts = [Prisma.sql`${col('TotalExperienceYearsNumeric')} IS NOT NULL`];
    if (f.expMin != null) parts.push(Prisma.sql`${col('TotalExperienceYearsNumeric')} >= ${f.expMin}::numeric`);
    if (f.expMax != null) parts.push(Prisma.sql`${col('TotalExperienceYearsNumeric')} <= ${f.expMax}::numeric`);
    add('experience', Prisma.join(parts, ' AND '));
  }

  if (f.ctcMin != null || f.ctcMax != null) {
    const parts = [Prisma.sql`${col('ExpectedCTCNumeric')} IS NOT NULL`];
    if (f.ctcMin != null) parts.push(Prisma.sql`${col('ExpectedCTCNumeric')} >= ${f.ctcMin}::numeric`);
    if (f.ctcMax != null) parts.push(Prisma.sql`${col('ExpectedCTCNumeric')} <= ${f.ctcMax}::numeric`);
    add('ctc', Prisma.join(parts, ' AND '));
  }

  if (f.noticePeriod != null) {
    add('notice', Prisma.sql`${col('NoticePeriodDays')} IS NOT NULL AND ${col('NoticePeriodDays')} <= ${f.noticePeriod}::numeric`);
  }

  if (f.addedWithinDays != null) {
    add('addedWithin', Prisma.sql`${col('createdAt')} >= now() - make_interval(days => ${f.addedWithinDays}::int)`);
  }

  if (f.position.length > 0) {
    // Whole-phrase match on the position the candidate applied for; any of the
    // typed positions is enough ("Java Developer" never matches "JavaScript Developer").
    const source = phrasesRegexSource(f.position);
    const keys = prefilterKeys(f.position);
    add('position', columnMatchSql(col('PositionApplied'), source, keys));
  }

  const skills = buildSkillPredicateSql(f.skills, f.matchMode, a);
  if (skills) add('skills', skills);

  return conds;
}

/** Conditions that read resume text: evaluated only after every cheap one passes. */
const EXPENSIVE_KEYS = new Set(['skills']);

/**
 * AND of all conditions, or TRUE when none apply.
 *
 * The planner reorders top-level WHERE clauses by its own cost guess and, on
 * 100k rows, ran the skills regex on every row before the location filter
 * (17.6 s instead of ~1 s). The expensive conditions therefore sit inside a
 * CASE behind the cheap ones: a CASE is evaluated in the order written.
 *
 * @param {Array<{key: string, sql: Prisma.Sql}>} conditions
 * @returns {Prisma.Sql}
 */
export function joinConditions(conditions) {
  if (!conditions || conditions.length === 0) return Prisma.sql`TRUE`;
  const cheap = conditions.filter((c) => !EXPENSIVE_KEYS.has(c.key)).map((c) => c.sql);
  const costly = conditions.filter((c) => EXPENSIVE_KEYS.has(c.key)).map((c) => c.sql);
  if (costly.length === 0) return Prisma.join(cheap, ' AND ');
  const costlySql = Prisma.join(costly, ' AND ');
  if (cheap.length === 0) return costlySql;
  return Prisma.sql`(CASE WHEN ${Prisma.join(cheap, ' AND ')} THEN ${costlySql} ELSE false END)`;
}

/**
 * Convenience: the whole hard-filter WHERE fragment.
 * @param {ReturnType<typeof parseScreeningFilters>} f
 * @param {string} [alias='c']
 * @returns {Prisma.Sql}
 */
export function buildFilterSql(f, alias = 'c') {
  return joinConditions(buildFilterConditions(f, alias));
}

/**
 * SELECT-list of cumulative funnel counts: `total`, then `pass_<key>` = rows
 * passing that condition AND every earlier one.
 *
 * Callers normally pass every condition EXCEPT the last: the main search query
 * already returns the rows passing all of them, so its row count is the final
 * step and the most expensive predicate (skills — regex over resume text) is not
 * evaluated a second time just to be counted.
 *
 * @param {Array<{key: string, sql: Prisma.Sql}>} conditions
 * @returns {Prisma.Sql}
 */
export function buildPassCountSql(conditions) {
  const cols = [Prisma.sql`COUNT(*)::int AS total`];
  conditions.forEach((cond, i) => {
    cols.push(Prisma.sql`COUNT(*) FILTER (WHERE ${joinConditions(conditions.slice(0, i + 1))})::int AS ${Prisma.raw(`"pass_${cond.key}"`)}`);
  });
  return Prisma.join(cols, ', ');
}

/**
 * Turns cumulative pass counts into per-filter "removed by" counts. Counted
 * sequentially (each filter only sees what the earlier ones let through), so
 * the numbers always add up: total = Σ removedBy + finalPassed.
 *
 * @param {string[]} keys - condition keys in funnel order
 * @param {Record<string, number>} counts - row from buildPassCountSql (`total`, `pass_<key>` for all but possibly the last key)
 * @param {number} finalPassed - rows passing every condition
 * @returns {Record<string, number>}
 */
export function removedByFromPassCounts(keys, counts, finalPassed) {
  const removedBy = {};
  let before = Number(counts.total) || 0;
  keys.forEach((key, i) => {
    const isLast = i === keys.length - 1;
    const after = isLast ? finalPassed : Number(counts[`pass_${key}`]) || 0;
    removedBy[key] = Math.max(before - after, 0);
    before = after;
  });
  return removedBy;
}

// ---------------------------------------------------------------------------
// JS mirror
// ---------------------------------------------------------------------------

const numOrNull = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const techTermsText = (raw) => {
  if (raw == null) return '';
  return typeof raw === 'string' ? raw : JSON.stringify(raw);
};

/**
 * The same rules as buildFilterConditions(), plus education, in JavaScript.
 *
 * @param {object} c - candidate row (rpa_cv columns)
 * @param {ReturnType<typeof parseScreeningFilters>} f
 * @returns {{pass: boolean, failedOn: string|null}} failedOn = first failing filter key
 */
export function passesStrictFilters(c, f) {
  const fail = (key) => ({ pass: false, failedOn: key });

  if (f.location.length > 0) {
    const parts = locationParts(c.CurrentLocation);
    if (!parts.some((p) => f.location.includes(p))) return fail('location');
  }

  if (f.gender) {
    const variants = GENDER_VARIANTS[f.gender] || [f.gender];
    if (!variants.includes(normaliseTerm(c.Gender))) return fail('gender');
  }

  if (f.expMin != null || f.expMax != null) {
    const exp = numOrNull(c.TotalExperienceYearsNumeric);
    if (exp == null || (f.expMin != null && exp < f.expMin) || (f.expMax != null && exp > f.expMax)) {
      return fail('experience');
    }
  }

  if (f.ctcMin != null || f.ctcMax != null) {
    const ctc = numOrNull(c.ExpectedCTCNumeric);
    if (ctc == null || (f.ctcMin != null && ctc < f.ctcMin) || (f.ctcMax != null && ctc > f.ctcMax)) {
      return fail('ctc');
    }
  }

  if (f.noticePeriod != null) {
    const days = numOrNull(c.NoticePeriodDays);
    if (days == null || days > f.noticePeriod) return fail('notice');
  }

  if (f.addedWithinDays != null) {
    const added = c.createdAt ? new Date(c.createdAt).getTime() : NaN;
    if (!Number.isFinite(added) || added < Date.now() - f.addedWithinDays * 86400000) return fail('addedWithin');
  }

  if (f.position.length > 0) {
    if (!compiled(phrasesRegexSource(f.position)).test(String(c.PositionApplied ?? ''))) return fail('position');
  }

  if (f.skills.length > 0) {
    const sources = [c.Top5KeySkills, techTermsText(c.resume_technical_terms), c.resume_full_text];
    const has = (term) => sources.some((s) => wholeWordMatch(s, term));
    const ok = f.matchMode === 'any' ? f.skills.some(has) : f.skills.every(has);
    if (!ok) return fail('skills');
  }

  if (f.education.length > 0) {
    const cats = getCandidateEducationCategories(c);
    if (!f.education.some((cat) => cats.includes(cat))) return fail('education');
  }

  return { pass: true, failedOn: null };
}

/** Funnel order of every filter key, for summaries. */
export const FILTER_KEYS = ['location', 'gender', 'experience', 'ctc', 'notice', 'addedWithin', 'position', 'skills', 'education'];

export default {
  splitSkillPhrases,
  ALIAS_GROUPS,
  termVariants,
  skillRegexSource,
  prefilterKeys,
  wholeWordMatch,
  normaliseLocationPart,
  locationParts,
  parseScreeningFilters,
  detectLookup,
  skillPredicateSql,
  skillColumnPredicates,
  buildSkillPredicateSql,
  buildFilterConditions,
  joinConditions,
  buildFilterSql,
  buildPassCountSql,
  removedByFromPassCounts,
  passesStrictFilters,
  FILTER_KEYS,
};
