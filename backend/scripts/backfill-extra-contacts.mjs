/**
 * U05 backfill — second emails and phone numbers that are in the resume but
 * not on the candidate.
 *
 * WHY
 * ---
 * Until U05 the resume parser asked for ONE email, and the public form and
 * the Schedule dialog overwrote the phone. So many candidates have a second
 * address or number printed in their resume (rpa_cv.resume_full_text) that
 * was never stored, and a search by it finds nobody. This adds them.
 *
 * WHAT IT DOES (rpa_cv only, plus the shortlist copy of the email)
 * ---------------------------------------------------------------
 * For each candidate with resume text, it reads the email addresses and the
 * Indian mobile numbers (10 digits starting 6-9, with or without +91 / 0)
 * printed in it, and lists those the record does not already hold:
 *   add      --apply APPENDS these; the primary email and first phone stay
 *            first. A phone: up to 3 new numbers. An email: up to 2 new ones,
 *            each resembling the candidate (a 4-letter piece of their name or
 *            stored address appears in it).
 *   review   listed only, never changed: an email that does not resemble the
 *            candidate (often a referee's or a family member's; pipeline mail
 *            goes to EVERY stored address, so a wrong guess mails a stranger),
 *            or more new values than the limits above. Add these by hand in
 *            Edit candidate if they are right.
 * Dropped as junk: vendors' own addresses (any rpa_cv.VendorEmail), role
 * addresses (support@, hr@, careers@ ...), placeholder domains, unknown
 * top-level domains (a typo like ".con"), the stored address with extracted
 * text glued to it ("a@gmail.comLocation", "MANAGERa@gmail.com"), and the
 * placeholder phone 9876543210. Matching uses utils/contactMerge.js, so
 * "+91 98765 43210" already on file counts as "9876543210".
 *
 * Every change is logged to rpa_processing_log with the old values (source
 * U05_BACKFILL_EXTRA_CONTACTS), so it can be undone by hand. When the email
 * list changes, the pipeline's copy follows (utils/candidateSync.js).
 *
 * READ-ONLY BY DEFAULT. Phones print masked (last 4 digits).
 *
 *   node scripts/backfill-extra-contacts.mjs            # report
 *   node scripts/backfill-extra-contacts.mjs --json     # machine-readable
 *   node scripts/backfill-extra-contacts.mjs --id 1234  # one candidate
 *   node scripts/backfill-extra-contacts.mjs --apply    # write (read the report first)
 */
import prisma from '../src/config/database.js';
import { appendUnique, contactKey, splitContacts } from '../src/utils/contactMerge.js';
import { maskPhone } from '../src/utils/phone.js';
import { shortlistIdentityPatch } from '../src/utils/candidateSync.js';

const APPLY = process.argv.includes('--apply');
const AS_JSON = process.argv.includes('--json');
const idArg = (() => {
  const i = process.argv.indexOf('--id');
  return i > -1 ? String(process.argv[i + 1] || '').trim() : '';
})();
const SOURCE = 'U05_BACKFILL_EXTRA_CONTACTS';
const PAGE = 500;
const MAX_NEW_EMAILS = 2;
const MAX_NEW_PHONES = 3;
const PLACEHOLDER_PHONE = '9876543210';
const PLACEHOLDER_DOMAINS = new Set(['example.com', 'test.com', 'domain.com', 'email.com']);
const ROLE_LOCALS = new Set(['support', 'info', 'hr', 'careers', 'career', 'jobs', 'job', 'contact', 'admin',
  'noreply', 'no-reply', 'sales', 'help', 'hello', 'team', 'recruitment', 'hiring', 'enquiry', 'office', 'mail']);
// Longest first, so "co.in" is tried before "co" / "in".
const TLDS = ['co.in', 'org.in', 'net.in', 'ac.in', 'edu.in', 'gov.in', 'co.uk',
  'com', 'net', 'org', 'edu', 'info', 'biz', 'in', 'io', 'ai', 'co', 'me', 'us', 'uk'];

const EMAIL_IN_TEXT = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
// An Indian mobile: optional +91 / 91 / 0, then 10 digits starting 6-9, with
// single spaces or dashes allowed between digits. Not preceded/followed by a
// digit, so a longer number (an account or a PIN run) never yields one.
const PHONE_IN_TEXT = /(?<![0-9])(?:\+?91[\s-]?|0)?[6-9](?:[\s-]?[0-9]){9}(?![0-9])/g;

/**
 * One address as printed, cleaned of extraction glue, or null when it is not
 * a usable address. "a@gmail.comLocation" → "a@gmail.com"; "-a@x.com" →
 * "a@x.com"; "a@gmail.con" → null (no known top-level domain).
 */
function cleanFoundEmail(raw) {
  const e = raw.toLowerCase().replace(/^[-._]+/, '').replace(/\.+$/, '');
  const at = e.lastIndexOf('@');
  if (at < 1) return null;
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  if (TLDS.some((t) => domain.endsWith(`.${t}`))) return e;
  // Glued text after the TLD: keep "gmail.com" out of "gmail.comlocation"
  // when at least 3 letters follow (so "gmail.con" is not read as "gmail.co").
  for (const t of TLDS) {
    const i = domain.lastIndexOf(`.${t}`);
    if (i > 0 && /^[a-z]{3,}$/.test(domain.slice(i + 1 + t.length))) return `${local}@${domain.slice(0, i + 1 + t.length)}`;
  }
  return null;
}

/** Email addresses printed in the text, cleaned, without junk and excluded ones. */
function emailsInText(text, exclude, stored) {
  const out = new Set();
  for (const m of String(text || '').match(EMAIL_IN_TEXT) || []) {
    const e = cleanFoundEmail(m);
    if (!e) continue;
    const [local, domain] = e.split('@');
    if (exclude.has(e) || PLACEHOLDER_DOMAINS.has(domain) || ROLE_LOCALS.has(local)) continue;
    // The stored address with text glued in front ("MANAGERa@x.com").
    if (stored.some((s) => s !== e && e.endsWith(s))) continue;
    out.add(e);
  }
  return [...out];
}

/** 4-letter pieces of the candidate's name and stored address local parts. */
function identityPieces(name, storedEmails) {
  const words = [
    ...String(name || '').toLowerCase().split(/[^a-z]+/),
    ...storedEmails.flatMap((e) => e.split('@')[0].split(/[^a-z]+/)),
  ].filter((w) => w.length >= 4);
  return [...new Set(words.map((w) => w.slice(0, 4)))];
}

/** Indian mobile numbers printed in the text, as 10 digits. */
function phonesInText(text) {
  const out = new Set();
  for (const m of String(text || '').match(PHONE_IN_TEXT) || []) {
    const ten = m.replace(/[^0-9]/g, '').slice(-10);
    if (ten !== PLACEHOLDER_PHONE) out.add(ten);
  }
  return [...out];
}

/** Values in `found` the stored list does not already hold (by contactKey). */
function missingFrom(stored, found, kind) {
  const have = new Set(splitContacts(stored, kind).map((v) => contactKey(v, kind)));
  return found.filter((v) => !have.has(contactKey(v, kind)));
}

async function vendorEmails() {
  const rows = await prisma.$queryRaw`
    SELECT DISTINCT lower(btrim("VendorEmail")) AS e FROM public.rpa_cv
    WHERE "VendorEmail" IS NOT NULL AND btrim("VendorEmail") <> ''`;
  return new Set(rows.map((r) => r.e));
}

async function* candidatePages() {
  let after = 0n;
  for (;;) {
    const rows = await prisma.rpa_cv.findMany({
      where: {
        id: idArg ? BigInt(idArg) : { gt: after },
        resume_full_text: { not: null },
      },
      select: { id: true, Name: true, EmailID: true, ContactNumber: true, VendorEmail: true, resume_full_text: true },
      orderBy: { id: 'asc' },
      take: PAGE,
    });
    if (rows.length === 0) return;
    yield rows;
    if (idArg || rows.length < PAGE) return;
    after = rows[rows.length - 1].id;
  }
}

async function applyOne(f) {
  const data = { modifiedAt: new Date() };
  if (f.newEmails.length) data.EmailID = appendUnique(f.cv.EmailID, f.newEmails, 'email');
  if (f.newPhones.length) data.ContactNumber = appendUnique(f.cv.ContactNumber, f.newPhones, 'phone');
  await prisma.$transaction(async (tx) => {
    await tx.rpa_cv.update({ where: { id: f.cv.id }, data });
    if (data.EmailID) {
      const rows = await tx.rpa_shortlisted_candidates.findMany({
        where: { cv_id: f.cv.id },
        select: { id: true, candidate_name: true, candidate_email: true, candidate_email_all: true },
      });
      for (const row of rows) {
        const patch = shortlistIdentityPatch(row, { Name: f.cv.Name, EmailID: data.EmailID });
        if (Object.keys(patch).length) {
          await tx.rpa_shortlisted_candidates.update({ where: { id: row.id }, data: { ...patch, modified_at: new Date() } });
        }
      }
    }
    await tx.rpa_processing_log.create({
      data: {
        fileName: `rpa_cv:${f.cv.id}`,
        source: SOURCE,
        status: 'contacts_appended',
        logMessage: JSON.stringify({
          cv_id: String(f.cv.id),
          old: { EmailID: f.cv.EmailID, ContactNumber: f.cv.ContactNumber },
          added: { emails: f.newEmails, phones: f.newPhones },
        }),
        actor_context: 'scripts/backfill-extra-contacts.mjs',
      },
    });
  });
}

async function main() {
  const exclude = await vendorEmails();
  const found = [];
  let scanned = 0;
  for await (const rows of candidatePages()) {
    for (const cv of rows) {
      scanned += 1;
      const own = new Set([...exclude, ...splitContacts(cv.VendorEmail, 'email').map((e) => e.toLowerCase())]);
      const stored = splitContacts(cv.EmailID, 'email').map((e) => e.toLowerCase());
      const newEmails = missingFrom(cv.EmailID, emailsInText(cv.resume_full_text, own, stored), 'email');
      const newPhones = missingFrom(cv.ContactNumber, phonesInText(cv.resume_full_text), 'phone');
      if (!newEmails.length && !newPhones.length) continue;

      const pieces = identityPieces(cv.Name, stored);
      const resembling = newEmails.filter((e) => pieces.some((p) => e.split('@')[0].includes(p)));
      const addEmails = resembling.length <= MAX_NEW_EMAILS ? resembling : [];
      const addPhones = newPhones.length <= MAX_NEW_PHONES ? newPhones : [];
      const reviewEmails = newEmails.filter((e) => !addEmails.includes(e));
      const reviewPhones = newPhones.filter((p) => !addPhones.includes(p));
      const kind = addEmails.length || addPhones.length ? 'add' : 'review';
      found.push({ kind, cv, newEmails: addEmails, newPhones: addPhones, reviewEmails, reviewPhones });
    }
  }

  const counts = found.reduce((m, f) => ({ ...m, [f.kind]: (m[f.kind] || 0) + 1 }), {});
  const rows = found.map((f) => ({
    kind: f.kind, id: String(f.cv.id), name: f.cv.Name,
    newEmails: f.newEmails, newPhones: f.newPhones.map(maskPhone),
    reviewEmails: f.reviewEmails, reviewPhones: f.reviewPhones.map(maskPhone),
  }));

  if (AS_JSON) {
    console.log(JSON.stringify({ apply: APPLY, scanned, counts, rows }, null, 2));
  } else {
    console.log(`U05 backfill — ${APPLY ? 'APPLYING' : 'dry run (pass --apply to write)'}`);
    console.log(`scanned: ${scanned} · add: ${counts.add || 0} · review: ${counts.review || 0}`);
    for (const r of rows) {
      const review = [...r.reviewEmails, ...r.reviewPhones];
      console.log(`  [${r.kind}] #${r.id} ${r.name || '(no name)'} · add emails: ${r.newEmails.join(', ') || '-'} · add phones: ${r.newPhones.join(', ') || '-'}${review.length ? ` · review only: ${review.join(', ')}` : ''}`);
    }
  }
  if (!APPLY) return;

  let changed = 0;
  for (const f of found) {
    if (f.kind !== 'add') continue;
    await applyOne(f);
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
