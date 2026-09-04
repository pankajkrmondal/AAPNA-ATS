/**
 * Dossier leak scan — read a downloaded candidate pack the way a stranger would,
 * and fail the build if anything forbidden is in it.
 *
 * WHY
 * ---
 * The dossier is the only artefact this system produces that is DESIGNED to be
 * emailed to somebody with no ATS account. Once it is sent there is no recall,
 * no expiry and no audit of who forwards it on, so every control has to act
 * before the bytes are written. Two already do — the whitelist that builds the
 * model, and assertNoForbiddenFields() which walks it — but both work on KEY
 * NAMES. Neither can see a CTC figure that reached the pack inside somebody's
 * free text, and neither reads the finished file.
 *
 * This does. Plan §10.3 item 4: "add as a script, don't do it by eye".
 *
 *   node scripts/dossier-leak-scan.mjs <pack.zip|folder>
 *   node scripts/dossier-leak-scan.mjs pack.zip --ctc 18,26 --vendor "Acme Staffing"
 *   node scripts/dossier-leak-scan.mjs pack.zip --other "Prashant Salgar,salgar@x.com"
 *   node scripts/dossier-leak-scan.mjs pack.zip --json
 *
 * Exit code 1 on any finding, so it can gate a release.
 *
 * TWO DESIGN DECISIONS THAT KEEP IT USABLE
 * ----------------------------------------
 * 1. THE PACK'S OWN REDACTION NOTICE IS NOT A LEAK. The report footer and the
 *    READ-ME both say, in words, that CTC and vendor details were removed — so a
 *    naive grep for "ctc" hits the very sentence that promises there is no CTC.
 *    Those sentences are stripped before scanning, and they are imported from
 *    dossierRedaction.js rather than restated here: if the wording changes, this
 *    follows it instead of going stale.
 *
 * 2. ATTACHMENTS ARE LISTED, NOT SCANNED. attachments/ carries the candidate's
 *    OWN resume and, when a recruiter consciously ticks the box, their own
 *    documents — included by design, byte for byte. A resume that says "Current
 *    CTC: 18 LPA" is the candidate's sentence about themselves, not our leak,
 *    and failing on it would get this scan switched off within a week. What the
 *    scan checks is what WE composed: the report, the workbook, the manifest and
 *    the READ-ME. Attachments are printed so a human can see what travelled.
 *
 * THE WORKBOOK IS READ AS DATA, NOT AS BYTES. An .xlsx is itself a zip; grepping
 * its bytes finds nothing because every string is deflated. It is parsed and its
 * sheets stringified, which is how the Zeko CTC check in §6.7 was done and the
 * only way this scan means anything for the "Spreadsheet only" format.
 */
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import XLSX from 'xlsx';

import { redactionSummary } from '../src/utils/dossierRedaction.js';

const args = process.argv.slice(2);
const AS_JSON = args.includes('--json');
const target = args.find((a) => !a.startsWith('--'));

/** `--flag a,b,c` → ['a','b','c'] */
function listArg(flag) {
  const i = args.indexOf(flag);
  if (i === -1 || !args[i + 1]) return [];
  return args[i + 1].split(',').map((s) => s.trim()).filter(Boolean);
}

if (!target || !existsSync(target)) {
  console.error('Usage: node scripts/dossier-leak-scan.mjs <pack.zip|unzipped-folder> [--ctc 18,26]'
    + ' [--vendor "Acme Staffing"] [--domain acme.example] [--budget 1800000,2600000]'
    + ' [--other "Name,email@x.com"] [--json]');
  process.exit(2);
}

// ── What counts as a leak ──────────────────────────────────────────────────

/**
 * Always checked, on every pack, whoever the candidate is.
 *
 * Word-boundaried on purpose: an unanchored /ctc/ matches "contact", and a scan
 * that cries wolf is a scan somebody disables. `lpa` and `lakh` are here because
 * that is how compensation is actually written in these files — the Zeko report
 * said "5 LPA", never "CTC: 500000".
 */
const ALWAYS = [
  ['compensation', /\b(ctc|lpa|lakhs?\s+per\s+annum|in[-\s]?hand|take[-\s]?home)\b/i],
  ['salary wording', /\b(salary|remuneration|stipend)\b/i],
  ['budget wording', /\b(budget)\b/i],
  ['vendor wording', /\b(vendor|agency\s+name|sourced\s+(from|by))\b/i],
  ['credential', /\b(token|api[_-]?key|password|bearer)\b/i],
  // URLs that only work with the application's own Microsoft token. These must
  // never appear: the recording player proxies bytes precisely so they do not.
  ['Graph/SharePoint URL', /(graph\.microsoft\.com|\.sharepoint\.com|drive![A-Za-z0-9])/i],
  // The Evalground export's own columns. The pack renders the candidate's
  // result; it must never carry the vendor's raw row, which holds every other
  // candidate's contact details in the same file.
  ['Evalground raw export', /(Candidate Location|Previous Assessments|Marked As|8\.\d+E\+0?9)/],
  ['truncated vendor link', /(evalground\.com\/code4|docs\.google\.com)/i],
];

const CTCS = listArg('--ctc');
const VENDORS = listArg('--vendor');
const DOMAINS = listArg('--domain');
const BUDGETS = listArg('--budget');
const OTHERS = listArg('--other');

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CASE_SPECIFIC = [
  ...CTCS.map((v) => [`this candidate's CTC (${v})`, new RegExp(`\\b${escapeRe(v)}\\b`)]),
  ...VENDORS.map((v) => [`vendor name (${v})`, new RegExp(escapeRe(v), 'i')]),
  ...DOMAINS.map((v) => [`vendor domain (${v})`, new RegExp(escapeRe(v), 'i')]),
  ...BUDGETS.map((v) => [`MRF budget (${v})`, new RegExp(`\\b${escapeRe(v)}\\b`)]),
  // The leak this feature uniquely enables: the Evalground import is one
  // spreadsheet covering many candidates, so a pack about one of them must not
  // name any of the others.
  ...OTHERS.map((v) => [`ANOTHER CANDIDATE (${v})`, new RegExp(escapeRe(v), 'i')]),
];

const CHECKS = [...ALWAYS, ...CASE_SPECIFIC];

// ── Reading the pack ───────────────────────────────────────────────────────

/** Everything the pack says, as text, per file — workbooks parsed, not grepped. */
function readEntries(where) {
  const out = [];
  const add = (name, buffer) => {
    if (/^attachments\//i.test(name)) {
      out.push({ name, kind: 'attachment', text: null, bytes: buffer.length });
      return;
    }
    if (/\.xlsx$/i.test(name)) {
      const book = XLSX.read(buffer, { type: 'buffer' });
      const text = book.SheetNames
        .map((s) => JSON.stringify(XLSX.utils.sheet_to_json(book.Sheets[s], { header: 1 })))
        .join('\n');
      out.push({ name, kind: 'workbook', text, bytes: buffer.length });
      return;
    }
    out.push({ name, kind: 'text', text: buffer.toString('utf8'), bytes: buffer.length });
  };

  if (statSync(where).isDirectory()) {
    const walk = (dir, prefix = '') => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(full, rel);
        else add(rel, readFileSync(full));
      }
    };
    walk(where);
  } else {
    for (const entry of new AdmZip(where).getEntries()) {
      if (!entry.isDirectory) add(entry.entryName, entry.getData());
    }
  }
  return out;
}

/**
 * The candidate this pack is about, read out of the pack's own title.
 *
 * Needed because the candidate's NAME is not a leak — it is the whole point of
 * the file, and it appears in the title, the header, the profile table, the
 * workbook and the READ-ME. Found on a real staging pass: a test candidate named
 * "PIPE14-vendor 1788012949850-944" produced six findings against the structural
 * /\bvendor\b/ check, none of which was a leak. The same would happen in
 * production to anyone whose name or employer contains one of these words.
 *
 * The name is stripped only from the STRUCTURAL word checks. The case-specific
 * ones (--vendor "Acme Staffing", --ctc 18) are exact values you passed in and
 * are never suppressed.
 */
function candidateNameIn(entries) {
  const html = entries.find((e) => /\.html$/i.test(e.name))?.text || '';
  const m = /<title>\s*Candidate dossier\s*[—-]\s*([^<]+)<\/title>/i.exec(html);
  return m ? m[1].trim() : null;
}

/**
 * Remove the sentences in which the pack promises what it removed.
 *
 * Imported from the same module the renderers use, so the scan cannot drift from
 * the wording it is meant to ignore.
 */
function stripOwnRedactionNotice(text, candidateName = null) {
  let out = text;
  if (candidateName) out = out.split(candidateName).join('[candidate]');
  for (const line of redactionSummary({ includeContactDetails: false })) {
    out = out.split(line).join(' ');
  }
  for (const heading of [
    'What has been removed from this pack, deliberately',
    'Removed from this pack',
    'What was deliberately left out',
    'compensation has been removed from it',
    'with compensation removed',
    'because they concerned compensation',
  ]) {
    out = out.split(heading).join(' ');
  }
  return out;
}

/** A short, readable piece of the offending line. */
const snippet = (text, index) => text
  .slice(Math.max(0, index - 60), index + 80)
  .replace(/\s+/g, ' ')
  .trim();

// ── Run ────────────────────────────────────────────────────────────────────

const entries = readEntries(target);
const findings = [];
const attachments = entries.filter((e) => e.kind === 'attachment');
const scanned = entries.filter((e) => e.kind !== 'attachment');

const candidateName = candidateNameIn(scanned);

for (const entry of scanned) {
  const text = stripOwnRedactionNotice(entry.text || '', candidateName);
  for (const [label, pattern] of CHECKS) {
    const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    let hit = re.exec(text);
    while (hit) {
      findings.push({ file: entry.name, check: label, match: hit[0], context: snippet(text, hit.index) });
      hit = re.exec(text);
    }
  }
}

// Informational, never a failure: recording links are a deliberate inclusion
// when the recruiter ticks the box, and their absence is equally deliberate.
const shareLinks = scanned
  .filter((e) => (e.text || '').includes('/api/recording-share/'))
  .map((e) => e.name);

if (AS_JSON) {
  console.log(JSON.stringify({
    target,
    scanned: scanned.map((e) => e.name),
    attachments: attachments.map((a) => ({ name: a.name, bytes: a.bytes })),
    recordingShareLinksIn: shareLinks,
    findings,
    ok: findings.length === 0,
  }, null, 2));
} else {
  console.log(`\nDossier leak scan — ${target}`);
  console.log(`Scanned (composed by us): ${scanned.map((e) => e.name).join(', ') || 'nothing'}`);
  console.log(
    'Listed, NOT scanned (the candidate\'s own files): '
    + (attachments.length ? attachments.map((a) => `${a.name} (${a.bytes} bytes)`).join(', ') : 'none'),
  );
  console.log(`Recording share links present in: ${shareLinks.join(', ') || 'none'}`);
  console.log(`Checks run: ${CHECKS.length}`
    + (CASE_SPECIFIC.length ? ` (${CASE_SPECIFIC.length} specific to this candidate)` : ' — pass --ctc/--vendor/--other for the case-specific ones'));

  if (findings.length === 0) {
    console.log('\n✔ CLEAN — nothing forbidden found in what this pack says.\n');
  } else {
    console.log(`\n✖ ${findings.length} FINDING(S):\n`);
    for (const f of findings) {
      console.log(`  [${f.check}] ${f.file}`);
      console.log(`     matched: "${f.match}"`);
      console.log(`     context: …${f.context}…\n`);
    }
    console.log('Each of these is text the pack itself carries, outside its own redaction notice.\n');
  }
}

process.exit(findings.length === 0 ? 0 : 1);
