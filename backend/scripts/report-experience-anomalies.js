/**
 * report-experience-anomalies.js — READ-ONLY diagnostic. Writes nothing.
 *
 * Run:
 *   npm run report:experience:staging
 *   npm run report:experience:prod
 *
 * Why this exists
 * ---------------
 * Until 2026-08-11 the HR-upload path could store a Total Experience that the
 * resume never said:
 *
 *   1. Whenever a resume had ANY employment history, the parser's own
 *      TotalExperienceYears was overwritten by date arithmetic. parseDate() could
 *      not read Jun-2022 / May'21 / 05.2022, so every row scored 0 months and the
 *      candidate was stored as "0" — and because "0" is a non-empty string,
 *      getMissingFields() never flagged it for follow-up.
 *   2. When the parser returned nothing at all, a hardcoded "2" was written on the
 *      main create path and "3" on the duplicate path.
 *
 * Both are fixed going forward. This script measures how many EXISTING rows are
 * likely carrying one of those values, so the decision about a backfill is made
 * against a real number rather than a guess.
 *
 * It deliberately does not repair anything: "2" is also a perfectly ordinary
 * genuine answer, and only a human looking at the sample can say whether the
 * volume points at the bug or at reality.
 */
import 'dotenv/config';
import prisma from '../src/config/database.js';

/** Values the old code could invent. "0" only counts as suspect WITH history. */
const HARDCODED = ['2', '3'];

/** Companies recorded on the row, whatever shape employment_history took. */
function companyCount(history) {
  if (!history) return 0;
  let parsed = history;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { return 0; }
  }
  if (Array.isArray(parsed)) return parsed.length;
  if (Array.isArray(parsed?.companies)) return parsed.companies.length;
  return Number(parsed?.total_companies) || 0;
}

/** True when at least one company has both endpoints recorded. */
function hasDatedRole(history) {
  let parsed = history;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { return false; }
  }
  const companies = Array.isArray(parsed) ? parsed : (parsed?.companies || []);
  return companies.some((c) => c && c.StartDate && c.EndDate);
}

const pct = (n, total) => (total === 0 ? '0.0' : ((n / total) * 100).toFixed(1));

async function main() {
  const total = await prisma.rpa_cv.count();

  const candidates = await prisma.rpa_cv.findMany({
    where: {
      OR: [
        { TotalExperienceYears: { in: [...HARDCODED, '0'] } },
        { TotalExperienceYears: null },
      ],
    },
    select: {
      id: true,
      Name: true,
      EmailID: true,
      TotalExperienceYears: true,
      TotalExperienceYearsNumeric: true,
      employment_history: true,
      createdAt: true,
      last_action_context: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  // "0 years" is only suspicious when the row HAS employment history — a genuine
  // fresher has none, and overwriting theirs would be the same mistake in reverse.
  const zeroWithHistory = [];
  const hardcodedLooking = [];
  const nullExperience = [];

  for (const row of candidates) {
    const companies = companyCount(row.employment_history);
    const value = row.TotalExperienceYears;

    if (value === null) {
      nullExperience.push({ ...row, companies });
    } else if (value === '0' && companies > 0) {
      zeroWithHistory.push({ ...row, companies });
    } else if (HARDCODED.includes(value)) {
      hardcodedLooking.push({ ...row, companies });
    }
  }

  // The strongest signal: dates ARE on the row, yet the total came out 0 — exactly
  // what the unreadable-date-format bug produced. These are also the rows a
  // backfill could repair from data already stored, with no re-parse.
  const repairable = zeroWithHistory.filter((r) => hasDatedRole(r.employment_history));

  const line = (label, n) => `  ${label.padEnd(46)} ${String(n).padStart(6)}  (${pct(n, total)}%)`;

  console.log('\n=== Total Experience anomaly report (read-only) ===\n');
  console.log(`  Candidates in rpa_cv${' '.repeat(27)}${String(total).padStart(6)}\n`);
  console.log(line('"0" years WITH employment history', zeroWithHistory.length));
  console.log(line('  └─ of those, repairable from stored dates', repairable.length));
  console.log(line('Exactly "2" or "3" (old hardcoded defaults)', hardcodedLooking.length));
  console.log(line('No experience recorded at all (null)', nullExperience.length));

  const sample = (label, rows) => {
    if (rows.length === 0) return;
    console.log(`\n  ${label} — first ${Math.min(5, rows.length)}:`);
    rows.slice(0, 5).forEach((r) => {
      console.log(
        `    #${r.id}  ${String(r.Name || '—').slice(0, 26).padEnd(28)}`
        + `exp=${String(r.TotalExperienceYears ?? 'null').padEnd(6)}`
        + `companies=${String(r.companies).padEnd(3)}`
        + `${r.last_action_context || '—'}`
      );
    });
  };

  sample('"0" with history', zeroWithHistory);
  sample('Hardcoded-looking', hardcodedLooking);

  console.log(
    '\n  NOTE: "2" and "3" are also ordinary real answers — this count is an upper'
    + '\n  bound, not a defect count. The repairable figure is the reliable one.\n'
  );
  console.log('  Nothing was modified.\n');
}

main()
  .catch((err) => {
    console.error('Report failed:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
