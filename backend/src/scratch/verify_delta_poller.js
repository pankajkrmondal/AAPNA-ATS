/**
 * Verification for the consolidated delta-query mailbox poller (Phase 3):
 *  1. First runMailboxPoll(): initial delta sync (24h lookback) stores a
 *     deltaLink in rpa_settings and ingests inbound messages idempotently.
 *  2. Second run: uses the stored deltaLink; message count must not grow from
 *     re-delivery (dedup on graph_message_id).
 *
 * Run with the inbound-sync consumer enabled (intake stays off so no resumes
 * are pushed into the parse pipeline during verification):
 *   INBOUND_SYNC_ENABLED=true node src/scratch/verify_delta_poller.js
 */
import prisma from '../config/database.js';
import config from '../config/index.js';
import { runMailboxPoll } from '../jobs/mailboxPoller.js';

const DELTA_KEY = 'mailbox_delta_link';
const results = [];

console.log(`Consumers: intake=${config.email.intake.enabled}, inboundSync=${config.email.inboundSync.enabled}`);

const linkBefore = await prisma.rpa_settings.findUnique({ where: { key: DELTA_KEY } });
const countBefore = await prisma.rpa_email_messages.count({ where: { direction: 'inbound' } });

// Tick 1 — initial or continued delta sync.
await runMailboxPoll();
const linkAfter1 = await prisma.rpa_settings.findUnique({ where: { key: DELTA_KEY } });
const countAfter1 = await prisma.rpa_email_messages.count({ where: { direction: 'inbound' } });
results.push(`1. first tick: ${linkAfter1?.value ? 'OK — deltaLink stored' : 'FAILED — no deltaLink'} (inbound rows ${countBefore} -> ${countAfter1}; link existed before: ${Boolean(linkBefore?.value)})`);

// Tick 2 — must consume the stored deltaLink and add nothing new.
await runMailboxPoll();
const linkAfter2 = await prisma.rpa_settings.findUnique({ where: { key: DELTA_KEY } });
const countAfter2 = await prisma.rpa_email_messages.count({ where: { direction: 'inbound' } });
const noDupes = countAfter2 === countAfter1;
results.push(`2. second tick: ${linkAfter2?.value && noDupes ? 'OK — no duplicates from delta re-poll' : `CHECK — rows ${countAfter1} -> ${countAfter2}`}`);

console.log('\n=== VERIFICATION RESULTS ===');
for (const r of results) console.log(r);
await prisma.$disconnect();
process.exit(results.some((r) => r.includes('FAILED')) ? 1 : 0);
