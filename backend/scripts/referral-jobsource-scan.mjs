/**
 * Find candidates whose free-text `Job Source` looks like a referral, so the
 * structured flag can be set on them by hand.
 *
 *   node scripts/referral-jobsource-scan.mjs
 *   node scripts/referral-jobsource-scan.mjs --csv > referrals-to-review.csv
 *
 * WHY THIS IS A REPORT AND NOT A BACKFILL
 * ---------------------------------------
 * Before the referral flag existed, "Referral - Anuj" went wherever a recruiter
 * could type it, and `Job Source` is where it landed. Those candidates are real
 * referrals and the new flag should say so.
 *
 * But a script cannot tell "Referral - Anuj" from "Referral programme (not
 * used)" or "referred to LinkedIn", and a referral GRANTS HIRING PREFERENCE —
 * Sanghamitra, 2026-08-28: "we always give preference to the referral person."
 * A wrong flag therefore tips a real hiring decision, and an automatic backfill
 * would be guessing at scale with nobody named as having decided. The audit log
 * would record the machine, which is exactly the accountability the log exists
 * to provide.
 *
 * So: this lists candidates and the text that matched. A person reads it and
 * ticks the box, and their name goes on the record.
 *
 * ALREADY-FLAGGED CANDIDATES ARE EXCLUDED — the report is a worklist, and a row
 * somebody has already dealt with is noise.
 */
import prisma from '../src/config/database.js';

const AS_CSV = process.argv.includes('--csv');

/**
 * \b-anchored, and the anchoring is the whole trick: an unanchored /referr/i
 * also matches "Preferred", so an unanchored scan returns every candidate whose
 * Job Source says "preferred vendor" or "preferred shift". Same reasoning as
 * dossierRedaction.js's /(^|_)referr/i and the leak scan's word checks.
 */
const LOOKS_LIKE_REFERRAL = /\b(referral|referrals|referred|referrer|refered)\b/i;

/** Best-effort guess at the name after the word, purely as a hint for the human. */
function guessReferrer(text) {
  const m = /\b(?:referral|referred)\b\s*(?:by|from|[-–:—])?\s*([A-Za-z][A-Za-z.'\s]{1,40})/i.exec(text || '');
  const name = (m?.[1] || '').replace(/\s+/g, ' ').trim();
  return name && name.length > 1 ? name : '';
}

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

try {
  // Narrowed in SQL first so this never pulls the whole table into memory; the
  // \b test then removes the "Preferred ..." false positives.
  const candidates = await prisma.rpa_cv.findMany({
    where: {
      is_referral: false,
      OR: [
        { JobSource: { contains: 'refer', mode: 'insensitive' } },
        { RecruiterInfoAAPNA: { contains: 'refer', mode: 'insensitive' } },
      ],
    },
    select: { id: true, Name: true, EmailID: true, JobSource: true, RecruiterInfoAAPNA: true, createdAt: true },
    orderBy: { id: 'desc' },
  });

  const hits = candidates.filter(
    (c) => LOOKS_LIKE_REFERRAL.test(c.JobSource || '') || LOOKS_LIKE_REFERRAL.test(c.RecruiterInfoAAPNA || ''),
  );

  const alreadyFlagged = await prisma.rpa_cv.count({ where: { is_referral: true } });

  if (AS_CSV) {
    console.log(['Candidate ID', 'Name', 'Email', 'Job Source', 'Recruiter Info', 'Likely referrer', 'Added'].join(','));
    for (const c of hits) {
      console.log([
        c.id, c.Name, c.EmailID, c.JobSource, c.RecruiterInfoAAPNA,
        guessReferrer(c.JobSource) || guessReferrer(c.RecruiterInfoAAPNA),
        c.createdAt ? c.createdAt.toISOString().slice(0, 10) : '',
      ].map(csvCell).join(','));
    }
  } else {
    console.log(`\nCandidates whose free text looks like a referral, not yet flagged: ${hits.length}`);
    console.log(`(${candidates.length - hits.length} more matched "refer" but only inside a word such as "Preferred" — excluded.)`);
    console.log(`Already carrying the structured flag: ${alreadyFlagged}\n`);

    for (const c of hits) {
      const guess = guessReferrer(c.JobSource) || guessReferrer(c.RecruiterInfoAAPNA);
      console.log(`  #${c.id}  ${c.Name || '(no name)'}  <${c.EmailID || 'no email'}>`);
      if (c.JobSource) console.log(`        Job Source     : ${c.JobSource}`);
      if (c.RecruiterInfoAAPNA) console.log(`        Recruiter Info : ${c.RecruiterInfoAAPNA}`);
      if (guess) console.log(`        likely referrer: ${guess}   <- verify before trusting`);
    }

    if (hits.length) {
      console.log('\nNothing has been changed. Open each candidate on Search Candidate and tick');
      console.log('"This candidate was referred by an employee" — your name goes on the audit row.');
    }
  }
} finally {
  await prisma.$disconnect();
  // Explicit: a lingering Prisma client holds the query-engine DLL open, which
  // is what makes `prisma generate` fail with EPERM on Windows.
  process.exit(0);
}
