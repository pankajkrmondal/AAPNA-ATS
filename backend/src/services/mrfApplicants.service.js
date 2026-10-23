/**
 * Who applied to which requisition (L06, decision D2), shared by the Dashboard
 * and Recruitment Analytics so the two can never count applicants differently.
 *
 * A CV is linked to an MRF when:
 *   1. it is tagged to it (rpa_candidate_mrf_tags: uploads, shortlists, Add to
 *      JD, Change JD, Move; dated by tagged_at), or
 *   2. it carries no tag to any MRF of that role name and its typed "Position
 *      Applied" matches the role (dated by the CV's added date). That is how
 *      mailbox and website applicants, and uploads from before JD tagging
 *      started on 21 Oct 2026, reach a role. Such a CV counts once, under the
 *      latest MRF of that name raised before the CV arrived; a CV older than
 *      every MRF of the name counts under none.
 *
 * "Responded" (D3) is the date the candidate submitted the missing-details
 * form; for submissions before 14 Oct 2026 (no date kept) the request date;
 * for a profile complete on arrival (never asked), the date it was added.
 */
import { Prisma } from '@prisma/client';
import prisma from '../config/database.js';
import { normaliseLabel, IST } from '../utils/dashboardMetrics.js';
import { SOURCE_KEYS } from './openPositions.helpers.js';

/** "Created inside [from, to)" for rpa_cv."createdAt" (a UTC timestamp without zone). */
export const cvCreatedBetween = (from, to) => Prisma.sql`("createdAt" AT TIME ZONE 'UTC') >= ${from}::timestamptz AND ("createdAt" AT TIME ZONE 'UTC') < ${to}::timestamptz`;
/** rpa_cv."createdAt" as an India-time calendar day. */
export const CV_IST_DAY = Prisma.sql`(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${IST})::date`;
/** A text column lower-cased and single-spaced, to match normaliseLabel(). */
export const normalisedSql = (column) => Prisma.sql`lower(regexp_replace(btrim(${Prisma.raw(column)}), '\\s+', ' ', 'g'))`;
/** Candidates whose typed "Position Applied" matches a role (the MRF link before JD tagging, N13). */
export const positionMatches = (roleKey) => Prisma.sql`${normalisedSql('"PositionApplied"')} = ${roleKey}`;
/**
 * An rpa_cv row linked to ONE MRF: tagged to it (uploaded for / shortlisted to
 * it, N13) or, for candidates from before tagging, a matching "Position
 * Applied". Used inside a query FROM rpa_cv by the Dashboard's MRF filter.
 */
export const cvLinkedToMrf = (mrf) => Prisma.sql`(EXISTS (
  SELECT 1 FROM rpa_candidate_mrf_tags t WHERE t.cv_id = rpa_cv.id AND t.mrf_id = ${mrf.id}
) OR ${positionMatches(mrf.roleKey)})`;

const FAR_PAST = new Date('1970-01-01T00:00:00Z');
const FAR_FUTURE = new Date('2999-01-01T00:00:00Z');
const bounds = (range) => (range ? [range.from, range.to] : [FAR_PAST, FAR_FUTURE]);

/**
 * The applicant links of a set of MRFs, one row per (MRF, CV), as a WITH
 * clause naming `facts(mrf_id, cv_id, linked_at, bucket, responded_at)`.
 * The latest-MRF rule needs every MRF of a role name, so callers pass the
 * whole board's set even when they want one row.
 *
 * @param {Array<{ id: bigint|number|string, role?: string|null, openedAt?: Date|string|null }>} mrfs
 *   openedAt: when the MRF was raised (rpa_mrf.created_at)
 */
function factsCte(mrfs) {
  const ids = mrfs.map((m) => BigInt(m.id));
  const keys = mrfs.map((m) => normaliseLabel(m.role));
  // When the MRF was raised. An untagged CV is attributed to the latest MRF of
  // its role name raised BEFORE the CV arrived: a CV from June cannot have
  // applied to an MRF raised in August, and between two same-name MRFs the one
  // open at the time is the one the candidate saw.
  const opened = mrfs.map((m) => (m.openedAt ? new Date(m.openedAt) : new Date('1970-01-01T00:00:00Z')));
  return Prisma.sql`
    WITH m AS (
      SELECT * FROM unnest(${ids}::bigint[], ${keys}::text[], ${opened}::timestamptz[]) AS m(mrf_id, role_key, opened_at)
    ),
    links AS (
      SELECT t.mrf_id, t.cv_id, t.tagged_at AS linked_at, t.source AS tag_source
        FROM rpa_candidate_mrf_tags t JOIN m ON m.mrf_id = t.mrf_id
      UNION ALL
      SELECT pick.mrf_id, c.id AS cv_id, (c."createdAt" AT TIME ZONE 'UTC') AS linked_at, NULL::text AS tag_source
        FROM rpa_cv c
        JOIN LATERAL (
          SELECT m.mrf_id, m.role_key FROM m
           WHERE m.role_key <> ''
             AND m.role_key = lower(regexp_replace(btrim(c."PositionApplied"), '\\s+', ' ', 'g'))
             AND m.opened_at <= (c."createdAt" AT TIME ZONE 'UTC')
           ORDER BY m.opened_at DESC, m.mrf_id DESC
           LIMIT 1
        ) pick ON true
       WHERE lower(regexp_replace(btrim(c."PositionApplied"), '\\s+', ' ', 'g')) IN (SELECT role_key FROM m)
         AND NOT EXISTS (
           SELECT 1 FROM rpa_candidate_mrf_tags t2 JOIN m m2 ON m2.mrf_id = t2.mrf_id
            WHERE t2.cv_id = c.id AND m2.role_key = pick.role_key
         )
    ),
    facts AS (
      SELECT l.mrf_id, l.cv_id, l.linked_at,
             CASE WHEN l.tag_source = 'hr_manual_upload' THEN 'hr_upload'
                  WHEN l.tag_source = 'vendor_portal' THEN 'vendor'
                  WHEN l.tag_source IS NOT NULL THEN 'recruiter'
                  WHEN COALESCE(btrim(c."VendorEmail"), '') <> '' OR COALESCE(btrim(c."vendorName"), '') <> '' THEN 'vendor'
                  ELSE 'other' END AS bucket,
             COALESCE(
               c.details_completed_at,
               CASE WHEN upper(COALESCE(c."cvMissingTokenStatus", '')) = 'RECEIVED' THEN c.details_requested_at END,
               CASE WHEN c.details_requested_at IS NULL AND upper(COALESCE(c."statusActive", '')) = 'ACTIVE'
                    THEN (c."createdAt" AT TIME ZONE 'UTC') END
             ) AS responded_at
        FROM links l JOIN rpa_cv c ON c.id = l.cv_id
    )`;
}

const emptyCounts = () => ({ applied: 0, responded: 0, sources: Object.fromEntries(SOURCE_KEYS.map((k) => [k, 0])) });

/**
 * Applied / responded counts per MRF for several windows at once.
 *
 * @param {Array<{ id, role }>} mrfs  the board's MRFs (see factsCte)
 * @param {Record<string, object|null>} windows  name -> range (null = All time)
 * @returns {Promise<Map<string, Record<string, {applied, responded, sources}> & { first_applied_at: Date|null }>>}
 *   keyed by MRF id string; every window key present, zero-filled
 */
export async function applicantCountsByMrf(mrfs, windows) {
  const out = new Map();
  const names = Object.keys(windows);
  for (const m of mrfs) {
    const entry = { first_applied_at: null };
    for (const w of names) entry[w] = emptyCounts();
    out.set(String(m.id), entry);
  }
  if (!mrfs.length) return out;

  const filters = names.flatMap((w, i) => {
    const [from, to] = bounds(windows[w]);
    return [
      Prisma.sql`COUNT(DISTINCT cv_id) FILTER (WHERE linked_at >= ${from}::timestamptz AND linked_at < ${to}::timestamptz)::int AS ${Prisma.raw(`a${i}`)}`,
      Prisma.sql`COUNT(DISTINCT cv_id) FILTER (WHERE responded_at >= ${from}::timestamptz AND responded_at < ${to}::timestamptz)::int AS ${Prisma.raw(`r${i}`)}`,
    ];
  });
  const rows = await prisma.$queryRaw`
    ${factsCte(mrfs)}
    SELECT mrf_id, bucket, MIN(linked_at) AS first_at, ${Prisma.join(filters)}
      FROM facts GROUP BY mrf_id, bucket`;

  for (const row of rows) {
    const entry = out.get(String(row.mrf_id));
    if (!entry) continue;
    names.forEach((w, i) => {
      const a = Number(row[`a${i}`]) || 0;
      entry[w].applied += a;
      entry[w].responded += Number(row[`r${i}`]) || 0;
      if (entry[w].sources[row.bucket] !== undefined) entry[w].sources[row.bucket] += a;
    });
    if (row.first_at && (!entry.first_applied_at || row.first_at < entry.first_applied_at)) entry.first_applied_at = row.first_at;
  }
  return out;
}

/**
 * Applications per India-time day and source, for one MRF in a range.
 * @returns {Promise<Array<{ day: string, bucket: string, n: number }>>}
 */
export async function applicantDaily(mrfs, mrfId, range) {
  if (!mrfs.length) return [];
  const [from, to] = bounds(range);
  const rows = await prisma.$queryRaw`
    ${factsCte(mrfs)}
    SELECT to_char((linked_at AT TIME ZONE ${IST})::date, 'YYYY-MM-DD') AS day, bucket, COUNT(DISTINCT cv_id)::int AS n
      FROM facts
     WHERE mrf_id = ${BigInt(mrfId)} AND linked_at >= ${from}::timestamptz AND linked_at < ${to}::timestamptz
     GROUP BY 1, 2 ORDER BY 1`;
  return rows.map((r) => ({ day: r.day, bucket: r.bucket, n: Number(r.n) || 0 }));
}

/**
 * Applications per India-time day for every MRF at once (the Dashboard pulse
 * sparklines). One query, no source split.
 * @returns {Promise<Map<string, Map<string, number>>>} MRF id -> day -> count
 */
export async function applicantDailyByMrf(mrfs, range) {
  const out = new Map();
  if (!mrfs.length) return out;
  const [from, to] = bounds(range);
  const rows = await prisma.$queryRaw`
    ${factsCte(mrfs)}
    SELECT mrf_id, to_char((linked_at AT TIME ZONE ${IST})::date, 'YYYY-MM-DD') AS day, COUNT(DISTINCT cv_id)::int AS n
      FROM facts
     WHERE linked_at >= ${from}::timestamptz AND linked_at < ${to}::timestamptz
     GROUP BY 1, 2`;
  for (const r of rows) {
    const key = String(r.mrf_id);
    if (!out.has(key)) out.set(key, new Map());
    out.get(key).set(r.day, Number(r.n) || 0);
  }
  return out;
}

/**
 * The applicants behind a number (W1): applied or responded in the range.
 * @param {'applied'|'responded'} metric
 * @returns {Promise<Array<{ cv_id: string, linked_at: Date, bucket: string, responded_at: Date|null }>>}
 */
export async function applicantList(mrfs, mrfId, metric, range, limit = 500) {
  if (!mrfs.length) return [];
  const [from, to] = bounds(range);
  const column = metric === 'responded' ? Prisma.raw('responded_at') : Prisma.raw('linked_at');
  const rows = await prisma.$queryRaw`
    ${factsCte(mrfs)}
    SELECT DISTINCT ON (cv_id) cv_id, linked_at, bucket, responded_at
      FROM facts
     WHERE mrf_id = ${BigInt(mrfId)} AND ${column} >= ${from}::timestamptz AND ${column} < ${to}::timestamptz
     ORDER BY cv_id, linked_at DESC
     LIMIT ${limit}`;
  return rows.map((r) => ({ ...r, cv_id: String(r.cv_id) }));
}

export default { cvCreatedBetween, CV_IST_DAY, normalisedSql, positionMatches, cvLinkedToMrf, applicantCountsByMrf, applicantDaily, applicantDailyByMrf, applicantList };
