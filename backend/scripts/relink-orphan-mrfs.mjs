/**
 * Relink orphan MRFs — attach hiring-manager submissions (rpa_mrf) that never
 * got linked to their "New MRF Request" row (rpa_mrf_jd_send.mrf_id).
 *
 * WHY
 * ---
 * Until 18 Nov 2026 the form link emailed to the hiring manager carried no
 * request id, so the server guessed the row by an exact HM email + role +
 * mrfstatus 'pending' match. If whoever filled the form changed either field
 * (production: Chhaya filled one in for Hardik), the MRF was created and sent
 * to the approvers but never linked. The request row then stays PENDING in the
 * MRF module for good: no Submitted MRF Details, no Approval Trail, no
 * Approve / Reject panel, no APPROVED after the approvers decide, and the HM
 * keeps getting "please fill the MRF" reminders. The live fix
 * (utils/mrfParentLink.js) stops new orphans; this script repairs old ones.
 *
 * READ-ONLY BY DEFAULT. Nothing is written unless --apply is passed.
 *
 *   NODE_ENV=staging node scripts/relink-orphan-mrfs.mjs            # report only
 *   NODE_ENV=staging node scripts/relink-orphan-mrfs.mjs --json     # machine-readable
 *   NODE_ENV=staging node scripts/relink-orphan-mrfs.mjs --apply    # link the CERTAIN matches
 *   NODE_ENV=staging node scripts/relink-orphan-mrfs.mjs --apply --link=212:87 [--link=213:90]
 *                                                                   # link pairs a person confirmed
 *
 * WHAT COUNTS AS CERTAIN
 * ----------------------
 * An orphan MRF and an open, unlinked request row created before it, with the
 * same HM email AND the same role (trimmed, case-insensitive) — the match the
 * live code makes — and that pairing is unique on both sides. Everything else
 * (email-only, role-only, several candidates) is listed for a person to decide,
 * with the --link command to run. An MRF with no candidate at all came from the
 * blank form or a request that no longer exists; it is reported and left alone.
 *
 * --link=MRF:REQUEST applies ONLY the named pairs (the certain list is not
 * applied in the same run), and only if the MRF is still an orphan and the
 * request still has no MRF.
 *
 * WRITES, per link: rpa_mrf_jd_send.mrf_id and mrfstatus = 'managersubmitted',
 * exactly what the live submission writes, conditional on mrf_id still NULL.
 * The next reminder run then closes the HM's open "please fill" reminder.
 */
import prisma from '../src/config/database.js';
import { isOpenHmRequest } from '../src/jobs/reminderEligibility.js';

const APPLY = process.argv.includes('--apply');
const AS_JSON = process.argv.includes('--json');
const LINK_ARGS = process.argv.filter((a) => a.startsWith('--link=')).map((a) => a.slice('--link='.length));

const norm = (v) => String(v ?? '').trim().toLowerCase();
const day = (d) => (d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') : '—');

function parseLinkArgs() {
  return LINK_ARGS.map((s) => {
    const m = /^(\d+):(\d+)$/.exec(s.trim());
    if (!m) throw new Error(`--link=${s}: expected --link=<mrf id>:<request id>, e.g. --link=212:87`);
    return { mrfId: BigInt(m[1]), requestId: BigInt(m[2]) };
  });
}

async function main() {
  const manual = parseLinkArgs();

  const [mrfs, requests] = await Promise.all([
    prisma.rpa_mrf.findMany({
      select: {
        id: true, submitter_email: true, hiring_manager_name: true, position_hiring_for: true,
        approval_status: true, decided_by_name: true, created_at: true,
      },
      orderBy: { created_at: 'asc' },
    }),
    prisma.rpa_mrf_jd_send.findMany({
      select: { id: true, first_name: true, last_name: true, email: true, role: true, mrfstatus: true, mrf_id: true, created_at: true },
      orderBy: { created_at: 'desc' },
    }),
  ]);

  const linkedMrfIds = new Set(requests.filter((r) => r.mrf_id !== null).map((r) => String(r.mrf_id)));
  const orphans = mrfs.filter((m) => !linkedMrfIds.has(String(m.id)));
  const open = requests.filter((r) => isOpenHmRequest({ mrfstatus: r.mrfstatus, mrf_id: r.mrf_id }));

  const sentBefore = (req, mrf) => !req.created_at || !mrf.created_at || req.created_at <= mrf.created_at;

  const rows = orphans.map((mrf) => {
    const e = norm(mrf.submitter_email);
    const r = norm(mrf.position_hiring_for);
    const pool = open.filter((req) => sentBefore(req, mrf));
    return {
      mrf,
      exact: pool.filter((req) => e && r && norm(req.email) === e && norm(req.role) === r),
      emailOnly: pool.filter((req) => e && norm(req.email) === e && norm(req.role) !== r),
      roleOnly: pool.filter((req) => r && norm(req.role) === r && norm(req.email) !== e),
    };
  });

  // A request that is the exact match of two orphans (the HM submitted twice)
  // is not certain for either.
  const exactUse = new Map();
  for (const row of rows) for (const req of row.exact) exactUse.set(String(req.id), (exactUse.get(String(req.id)) || 0) + 1);

  const certain = [];
  const needsPerson = [];
  const noCandidate = [];
  for (const row of rows) {
    if (row.exact.length === 1 && exactUse.get(String(row.exact[0].id)) === 1) {
      certain.push({ mrf: row.mrf, request: row.exact[0] });
    } else if (row.exact.length || row.emailOnly.length || row.roleOnly.length) {
      needsPerson.push(row);
    } else {
      noCandidate.push(row.mrf);
    }
  }

  const reqView = (q, match) => ({
    request_id: String(q.id), match, name: [q.first_name, q.last_name].filter(Boolean).join(' '),
    email: q.email, role: q.role, mrfstatus: q.mrfstatus, sent_at: q.created_at,
  });
  const mrfView = (m) => ({
    mrf_id: String(m.id), submitted_at: m.created_at, hm_name: m.hiring_manager_name, hm_email: m.submitter_email,
    position: m.position_hiring_for, approval_status: m.approval_status, decided_by: m.decided_by_name,
  });

  if (AS_JSON) {
    console.log(JSON.stringify({
      mrfs: mrfs.length,
      orphans: orphans.length,
      certain: certain.map((c) => ({ ...mrfView(c.mrf), request: reqView(c.request, 'email+role') })),
      needs_a_person: needsPerson.map((row) => ({
        ...mrfView(row.mrf),
        candidates: [
          ...row.exact.map((q) => reqView(q, 'email+role, not unique')),
          ...row.emailOnly.map((q) => reqView(q, 'email only')),
          ...row.roleOnly.map((q) => reqView(q, 'role only')),
        ],
      })),
      no_request_row: noCandidate.map(mrfView),
      applied: APPLY,
      manual_links: manual.map((p) => `${p.mrfId}:${p.requestId}`),
    }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
  } else {
    console.log(`\nSubmitted MRFs:                         ${mrfs.length}`);
    console.log(`Not linked to any MRF request:          ${orphans.length}`);
    console.log(`  certain match (--apply links these):  ${certain.length}`);
    console.log(`  needs a person to choose:             ${needsPerson.length}`);
    console.log(`  no request row (blank form / deleted):${String(noCandidate.length).padStart(2)}`);

    const mrfLine = (m) => `MRF ${m.id}  submitted ${day(m.created_at)}  HM "${m.hiring_manager_name || ''}" <${m.submitter_email || ''}>  "${m.position_hiring_for || ''}"  ${String(m.approval_status).toUpperCase()}${m.decided_by_name ? ` by ${m.decided_by_name}` : ''}`;
    const reqLine = (q, match) => `request ${q.id}  sent ${day(q.created_at)} to "${[q.first_name, q.last_name].filter(Boolean).join(' ')}" <${q.email}>  "${q.role}"  [${match}]`;

    if (certain.length) {
      console.log('\nCERTAIN (same HM email and role, unique):');
      for (const c of certain) {
        console.log(`  ${mrfLine(c.mrf)}`);
        console.log(`    -> ${reqLine(c.request, 'email+role')}`);
      }
    }
    if (needsPerson.length) {
      console.log('\nNEEDS A PERSON (check the HM and role, then run the --link line you agree with):');
      for (const row of needsPerson) {
        console.log(`  ${mrfLine(row.mrf)}`);
        const cands = [
          ...row.exact.map((q) => [q, 'email+role, not unique']),
          ...row.emailOnly.map((q) => [q, 'email only']),
          ...row.roleOnly.map((q) => [q, 'role only']),
        ];
        for (const [q, match] of cands) {
          console.log(`    ?  ${reqLine(q, match)}`);
          console.log(`       node scripts/relink-orphan-mrfs.mjs --apply --link=${row.mrf.id}:${q.id}`);
        }
      }
    }
    if (noCandidate.length) {
      console.log('\nNO REQUEST ROW (left alone):');
      for (const m of noCandidate) console.log(`  ${mrfLine(m)}`);
    }
    if (!orphans.length) console.log('\nNothing to do — every submitted MRF is linked to its request.');
  }

  if (!APPLY) {
    if (certain.length || needsPerson.length) {
      console.log('\nDRY RUN. Nothing was written. Re-run with --apply (certain matches) or --apply --link=MRF:REQUEST.');
    }
    return;
  }

  // Either the pairs a person named, or the certain list — never both in one run.
  const orphanIds = new Set(orphans.map((m) => String(m.id)));
  const pairs = manual.length
    ? manual.map((p) => ({ mrfId: p.mrfId, requestId: p.requestId }))
    : certain.map((c) => ({ mrfId: c.mrf.id, requestId: c.request.id }));

  let written = 0;
  for (const p of pairs) {
    if (!orphanIds.has(String(p.mrfId))) {
      console.log(`  skip ${p.mrfId}:${p.requestId} — MRF ${p.mrfId} does not exist or is already linked.`);
      continue;
    }
    // mrf_id: null in the filter, so a request linked since the report is never overwritten.
    const res = await prisma.rpa_mrf_jd_send.updateMany({
      where: { id: p.requestId, mrf_id: null },
      data: { mrf_id: Number(p.mrfId), mrfstatus: 'managersubmitted' },
    });
    if (res.count) {
      written += 1;
      console.log(`  linked MRF ${p.mrfId} -> request ${p.requestId}`);
    } else {
      console.log(`  skip ${p.mrfId}:${p.requestId} — request ${p.requestId} does not exist or already has an MRF.`);
    }
  }

  console.log(`\nAPPLIED: ${written} of ${pairs.length} link(s).`);
  console.log('Re-run without --apply to confirm what is left.');
}

main()
  .catch((err) => {
    console.error('Relink failed:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
