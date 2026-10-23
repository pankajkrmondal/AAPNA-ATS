// Test helper for PW-Task H2–H5 (MRF Hold / on-behalf). Staging DB only.
//   node hold-fixture.mjs create            -> new ZZ-TEST MRF, approval emails sent, links printed
//   node hold-fixture.mjs links <mrfId>     -> current (open) personal links for an MRF
//   node hold-fixture.mjs state <mrfId>     -> MRF + tokens + events summary
//   node hold-fixture.mjs due <mrfId>       -> TEST ONLY: move held_until to yesterday, then run the sweep
const BACKEND = 'E:/Recruitment Process Automation/ATS-Migration-Local/backend/src';
const config = (await import(`file:///${BACKEND}/config/index.js`)).default; // env first
const { default: prisma } = await import(`file:///${BACKEND}/config/database.js`);
const jwt = (await import('file:///E:/Recruitment Process Automation/ATS-Migration-Local/backend/node_modules/jsonwebtoken/index.js')).default;
const svc = await import(`file:///${BACKEND}/services/mrfApproval.service.js`);
const { runMrfHoldSweep } = await import(`file:///${BACKEND}/jobs/mrfHoldSweep.js`);

const [cmd, arg] = process.argv.slice(2);
const FRONT = 'http://localhost:5173';

const [{ db }] = await prisma.$queryRawUnsafe('select current_database() db');
if (db !== 'recruitmentautomationdb') { console.error(`REFUSED: connected to ${db}`); process.exit(1); }

async function links(mrfId) {
  const tokens = await prisma.rpa_mrf_approval_tokens.findMany({ where: { mrf_id: BigInt(mrfId), revoked_at: null, used_at: null } });
  for (const t of tokens) {
    const token = jwt.sign({ typ: 'mrf_approval', mrfId: String(mrfId), jti: t.token_jti }, config.jwt.secret, { expiresIn: '14d' });
    console.log(`${t.approver_name} <${t.approver_email}>  token#${t.id}\n  ${FRONT}/mrf/${mrfId}/approve?action=approve&token=${token}`);
  }
  return tokens.length;
}

async function state(mrfId) {
  const m = await prisma.rpa_mrf.findUnique({ where: { id: BigInt(mrfId) } });
  const s = await prisma.rpa_mrf_jd_send.findFirst({ where: { mrf_id: Number(mrfId) } });
  const tokens = await prisma.rpa_mrf_approval_tokens.findMany({ where: { mrf_id: BigInt(mrfId) }, orderBy: { id: 'asc' } });
  const events = await prisma.rpa_mrf_approval_events.findMany({ where: { mrf_id: BigInt(mrfId) }, orderBy: { id: 'asc' } });
  const logs = await prisma.rpa_email_log.findMany({ where: { reference_id: Number(mrfId) }, orderBy: { id: 'asc' }, select: { id: true, email_type: true, recipient_email: true, subject: true, responded_at: true } });
  console.log(JSON.stringify({
    mrf: { id: String(m.id), approval_status: m.approval_status, held_until: m.held_until, held_by: m.held_by_name, hold_note: m.hold_note, hold_count: m.hold_count, hold_released_at: m.hold_released_at, decided_by: m.decided_by_name, decided_via: m.decided_via },
    jd_send: s ? { id: String(s.id), mrfstatus: s.mrfstatus } : null,
    tokens: tokens.map((t) => `${t.id} ${t.approver_email} used=${Boolean(t.used_at)} revoked=${t.revoked_reason || '-'}`),
    events: events.map((e) => `${e.id} ${e.event_type} ${e.actor_name || ''} ${e.identity_source} ${e.prior_status || ''}->${e.new_status || ''} ${JSON.stringify(e.meta || {}).slice(0, 120)}`),
    emails: logs.map((l) => `${l.id} ${l.email_type} -> ${l.recipient_email} | ${l.subject} | closed=${Boolean(l.responded_at)}`),
  }, null, 2));
}

if (cmd === 'create') {
  const role = `ZZ-TEST MRF Hold ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
  const mrf = await prisma.rpa_mrf.create({
    data: {
      submitter_email: 'qa.mrf-approval-test@example.com',
      hiring_manager_name: 'ZZTest HM',
      hiring_manager_designation: 'QA',
      position_hiring_for: role,
      number_of_positions: 1,
      required_in: '30 days',
      approval_status: 'pending',
      emailbody: `<p>ZZ-TEST fixture for MRF Hold testing (PW-Task H2-H5). Not a real requisition.</p>`,
    },
  });
  const send = await prisma.rpa_mrf_jd_send.create({
    data: {
      first_name: 'ZZTest', last_name: 'HM', email: 'qa.mrf-approval-test@example.com', role,
      jd_doc_link: 'https://example.com/zz-test-jd', mrfstatus: 'managersubmitted', mrf_id: Number(mrf.id),
      budget_min: 500000, budget_max: 600000,
    },
  });
  console.log(`Created rpa_mrf ${mrf.id} / jd_send ${send.id}: ${role}`);
  const sent = await svc.issueApprovalRequests({ mrfRecord: mrf, frontendUrl: FRONT, reason: 'submitted' });
  console.log(`Approval emails sent: ${sent}`);
  await links(mrf.id);
} else if (cmd === 'email') {
  const l = await prisma.rpa_email_log.findUnique({ where: { id: Number(arg) } });
  const text = String(l.body_html || '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  console.log(`subject: ${l.subject}`);
  console.log(`buttons: ${(l.body_html.match(/>(Approve|Reject|Hold) Requisition</g) || []).join(' ')}`);
  console.log(`hold link: ${/action=hold&token=/.test(l.body_html)}`);
  console.log(`text: ${text.slice(0, 700)}`);
} else if (cmd === 'links') {
  await links(arg);
} else if (cmd === 'state') {
  await state(arg);
} else if (cmd === 'due') {
  // TEST ONLY: simulate the hold-until date having arrived.
  const n = await prisma.rpa_mrf.updateMany({
    where: { id: BigInt(arg), approval_status: 'held' },
    data: { held_until: new Date(Date.now() - 86400000) },
  });
  console.log(`moved held_until to yesterday on ${n.count} row(s)`);
  console.log('sweep:', JSON.stringify(await runMrfHoldSweep()));
  console.log('second sweep (must release nothing):', JSON.stringify(await runMrfHoldSweep()));
  await links(arg);
} else {
  console.log('usage: create | links <id> | state <id> | due <id>');
}
await prisma.$disconnect();
process.exit(0);
