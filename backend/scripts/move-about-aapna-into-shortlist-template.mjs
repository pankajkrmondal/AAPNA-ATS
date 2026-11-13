/**
 * U02c · Copy the Settings "About AAPNA" text into the Shortlist email template, once.
 *
 *   node scripts/move-about-aapna-into-shortlist-template.mjs           # dry run (default)
 *   node scripts/move-about-aapna-into-shortlist-template.mjs --apply   # write
 *
 * Until U02c the text sat in rpa_settings ('company_profile_text', the old
 * Settings card) and the code added it to Keyword shortlists at send time.
 * Now it is part of the template, so recruiters edit it in Email Management,
 * and every shortlist email carries it. The block goes where the code put it:
 * above the sign-off, same look (companyBlockHtml + appendToBody).
 *
 * Run it after the U02c code is deployed: before, Keyword shortlists would
 * show the block twice. A row that already says "About AAPNA" is left as is,
 * so a second run, or HR's own copy, changes nothing. The settings row is
 * read only and never deleted.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { companyBlockHtml, appendToBody } from '../src/utils/candidateEmailBlocks.js';

export const COMPANY_PROFILE_KEY = 'company_profile_text';

/**
 * @param {string} bodyHtml - the template's body_html
 * @param {string} text - the About AAPNA plain text
 * @returns {{ changed: boolean, body: string, reason: 'added'|'already_there'|'no_text' }}
 */
export function addAboutAapna(bodyHtml, text) {
  const body = String(bodyHtml ?? '');
  if (/about\s+aapna/i.test(body)) return { changed: false, body, reason: 'already_there' };
  const block = companyBlockHtml(text);
  if (!block) return { changed: false, body, reason: 'no_text' };
  return { changed: true, body: appendToBody(body, block), reason: 'added' };
}

/** The one-line result for a row. */
export function resultLine(row, reason, apply) {
  const who = `${row.name} (#${row.id})`;
  switch (reason) {
    case 'added': return apply
      ? `${who}: About AAPNA added above the sign-off.`
      : `${who}: About AAPNA would be added above the sign-off (run with --apply).`;
    case 'already_there': return `${who}: already has About AAPNA; left as is.`;
    default: return `${who}: no About AAPNA text in Settings; nothing to add.`;
  }
}

async function main() {
  const apply = process.argv.includes('--apply');
  const { default: prisma } = await import('../src/config/database.js');
  try {
    console.log(apply ? 'APPLY: the text is added to the Shortlist template.' : 'DRY RUN: nothing is written. Add --apply to write.');
    const setting = await prisma.rpa_settings.findUnique({ where: { key: COMPANY_PROFILE_KEY } });
    const text = String(setting?.value ?? '').trim();
    console.log(text ? `Text (${text.length} characters):\n---\n${text}\n---` : 'Text: (empty)');
    const rows = await prisma.rpa_email_templates.findMany({
      where: { category: 'shortlist', is_active: true },
      orderBy: { id: 'asc' },
      select: { id: true, name: true, body_html: true },
    });
    if (!rows.length) console.log('No active shortlist template; nothing to do.');
    for (const row of rows) {
      const out = addAboutAapna(row.body_html, text);
      if (apply && out.changed) {
        await prisma.rpa_email_templates.update({
          where: { id: row.id },
          data: { body_html: out.body, modified_at: new Date() },
        });
      }
      console.log(resultLine(row, out.reason, apply));
    }
  } finally {
    await prisma.$disconnect();
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  main().catch((e) => {
    console.error('Copy failed:', e.message);
    process.exitCode = 1;
  });
}
