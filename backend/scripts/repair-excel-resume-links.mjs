/**
 * U01 repair — candidates whose "resume" is an Excel workbook.
 *
 * WHY
 * ---
 * Until U01, an .xlsx bulk upload saved the WORKBOOK as every row's resume
 * (cvFileUrl / cv_file_item_id), so the interview panel was sent a spreadsheet
 * holding every other row's details. The upload is fixed; this repairs the rows
 * written before the fix.
 *
 * WHAT IT LISTS (rpa_cv only)
 * ---------------------------
 *   workbook    the stored file is not a resume: its name says .xlsx / .xls /
 *               .csv, or its URL is the file_url of an Excel upload job.
 *               --apply clears the URL + item-id pair.
 *   stale_flag  missingData says the resume is still owed (uploadResume) but
 *               the stored file IS a pdf/doc/docx (a merge copied an Excel
 *               row's flag onto a candidate who had a resume).
 *               --apply removes the flag (and sets ACTIVE when nothing else is
 *               missing). The resume is kept.
 *   review      the flag is set and the URL does not say what the file is.
 *               Listed only; never changed.
 * Every change is logged to rpa_processing_log with the old values
 * (source U01_REPAIR_EXCEL_RESUME), so it can be undone by hand.
 *
 * READ-ONLY BY DEFAULT.
 *
 *   node scripts/repair-excel-resume-links.mjs                       # report
 *   node scripts/repair-excel-resume-links.mjs --json                # machine-readable
 *   node scripts/repair-excel-resume-links.mjs --name "Abhay Ranjan" # trace one candidate
 *   node scripts/repair-excel-resume-links.mjs --apply               # write (read the report first)
 *
 * THE RULE IS NOT RESTATED HERE: it calls resumeStatus() / resumeFileExtension()
 * from src/utils/resumeCheck.js, the same functions the panel pack uses.
 */
import prisma from '../src/config/database.js';
import {
  RESUME_EXTENSIONS, isResumeFlagged, missingFieldCount, resumeFileExtension, resumeStatus, withoutResumeFlag,
} from '../src/utils/resumeCheck.js';

const APPLY = process.argv.includes('--apply');
const AS_JSON = process.argv.includes('--json');
const nameArg = (() => {
  const i = process.argv.indexOf('--name');
  return i > -1 ? String(process.argv[i + 1] || '').trim() : '';
})();
const SOURCE = 'U01_REPAIR_EXCEL_RESUME';

const CV_SELECT = {
  id: true, Name: true, EmailID: true, cvFileUrl: true, cv_file_item_id: true,
  missingData: true, statusActive: true, last_action_context: true, createdAt: true, modifiedAt: true,
};

/** URLs of Excel upload jobs: a row carrying one of these carries the workbook. */
async function excelJobUrls() {
  const jobs = await prisma.rpa_upload_jobs.findMany({
    where: { file_name: { endsWith: '.xlsx', mode: 'insensitive' }, file_url: { not: null } },
    select: { file_url: true },
  });
  return new Set(jobs.map((j) => j.file_url));
}

function classify(cv, workbookUrls) {
  const status = resumeStatus(cv);
  if (status !== 'not_a_resume') return null;
  const ext = resumeFileExtension(cv.cvFileUrl);
  if ((ext && !RESUME_EXTENSIONS.includes(ext)) || workbookUrls.has(cv.cvFileUrl)) return 'workbook';
  if (isResumeFlagged(cv.missingData) && RESUME_EXTENSIONS.includes(ext)) return 'stale_flag';
  return 'review';
}

async function trace(name) {
  const rows = await prisma.rpa_cv.findMany({
    where: { Name: { contains: name, mode: 'insensitive' } },
    select: CV_SELECT,
    orderBy: { id: 'asc' },
    take: 20,
  });
  const out = [];
  for (const cv of rows) {
    const jobs = await prisma.rpa_upload_jobs.findMany({
      where: { cv_id: cv.id },
      select: { id: true, file_name: true, file_url: true, status: true, created_at: true },
      orderBy: { created_at: 'asc' },
    });
    const sharedBy = cv.cvFileUrl
      ? await prisma.rpa_cv.count({ where: { cvFileUrl: cv.cvFileUrl, NOT: { id: cv.id } } })
      : 0;
    out.push({
      id: String(cv.id), name: cv.Name, email: cv.EmailID, lastAction: cv.last_action_context,
      resumeStatus: resumeStatus(cv), ext: resumeFileExtension(cv.cvFileUrl) || '(unknown)',
      cvFileUrl: cv.cvFileUrl, cv_file_item_id: cv.cv_file_item_id,
      flagged: isResumeFlagged(cv.missingData), sameUrlOnOtherCandidates: sharedBy,
      uploadJobs: jobs.map((j) => ({ id: String(j.id), file: j.file_name, status: j.status, at: j.created_at, sameUrl: j.file_url === cv.cvFileUrl })),
    });
  }
  return out;
}

async function main() {
  if (nameArg) {
    const traced = await trace(nameArg);
    console.log(JSON.stringify(traced, null, 2));
    return;
  }

  const workbookUrls = await excelJobUrls();
  const candidates = await prisma.rpa_cv.findMany({
    where: {
      AND: [
        { OR: [{ cvFileUrl: { not: null } }, { cv_file_item_id: { not: null } }] },
        {
          OR: [
            { cvFileUrl: { contains: '.xls', mode: 'insensitive' } },
            { cvFileUrl: { contains: '.csv', mode: 'insensitive' } },
            { cvFileUrl: { contains: '/:x:/', mode: 'insensitive' } },
            { cvFileUrl: { in: [...workbookUrls] } },
            { missingData: { contains: 'uploadResume' } },
          ],
        },
      ],
    },
    select: CV_SELECT,
    orderBy: { id: 'asc' },
  });

  const found = [];
  for (const cv of candidates) {
    const kind = classify(cv, workbookUrls);
    if (kind) found.push({ kind, cv });
  }

  const counts = found.reduce((m, f) => ({ ...m, [f.kind]: (m[f.kind] || 0) + 1 }), {});
  const rows = found.map(({ kind, cv }) => ({
    kind, id: String(cv.id), name: cv.Name, ext: resumeFileExtension(cv.cvFileUrl) || '(unknown)',
    cvFileUrl: cv.cvFileUrl, cv_file_item_id: cv.cv_file_item_id,
  }));

  if (AS_JSON) {
    console.log(JSON.stringify({ apply: APPLY, counts, rows }, null, 2));
  } else {
    console.log(`U01 repair — ${APPLY ? 'APPLYING' : 'dry run (pass --apply to write)'}`);
    console.log(`workbook: ${counts.workbook || 0} · stale_flag: ${counts.stale_flag || 0} · review: ${counts.review || 0}`);
    for (const r of rows) console.log(`  [${r.kind}] #${r.id} ${r.name || '(no name)'} · ${r.ext} · ${r.cvFileUrl || '(item id only)'}`);
  }
  if (!APPLY) return;

  let changed = 0;
  for (const { kind, cv } of found) {
    if (kind === 'review') continue;
    const data = kind === 'workbook'
      ? { cvFileUrl: null, cv_file_item_id: null, modifiedAt: new Date() }
      : (() => {
        const missingData = withoutResumeFlag(cv.missingData);
        return { missingData, statusActive: missingFieldCount(missingData) > 0 ? 'INACTIVE' : 'ACTIVE', modifiedAt: new Date() };
      })();
    await prisma.$transaction([
      prisma.rpa_cv.update({ where: { id: cv.id }, data }),
      prisma.rpa_processing_log.create({
        data: {
          fileName: `rpa_cv:${cv.id}`,
          source: SOURCE,
          status: kind === 'workbook' ? 'resume_link_cleared' : 'resume_flag_removed',
          logMessage: JSON.stringify({
            cv_id: String(cv.id),
            old: {
              cvFileUrl: cv.cvFileUrl, cv_file_item_id: cv.cv_file_item_id,
              missingData: cv.missingData, statusActive: cv.statusActive,
            },
          }),
          actor_context: 'scripts/repair-excel-resume-links.mjs',
        },
      }),
    ]);
    changed += 1;
  }
  console.log(`Changed ${changed} candidate(s); old values are in rpa_processing_log (source ${SOURCE}).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
