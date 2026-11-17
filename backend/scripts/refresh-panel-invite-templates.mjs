/**
 * U03b · Refresh the two interview panel templates, only where HR never edited them.
 *
 *   node scripts/refresh-panel-invite-templates.mjs           # dry run (default)
 *   node scripts/refresh-panel-invite-templates.mjs --apply   # write
 *
 * The stored rows "Interview Scheduled — Panel" and "Interview Rescheduled — Panel"
 * were seeded before U03, so they still have a "Candidate email:" line and no
 * {{candidate_table}} token, and the table is appended below the old line. U03
 * changed the defaults in prisma/seed-email-templates.js, but that seed
 * overwrites EVERY template it covers, so it must not be run for this.
 *
 * HR (12 Nov): "if HR updated, don't change it". So a row is replaced only when
 * its subject and body equal a known OLD default after whitespace is
 * normalised. An edited row is never changed, and there is no override. The old
 * defaults are embedded below (seed-email-templates.js at 4102495^, and the two
 * earlier versions with a sign-off), so the script needs no git on the server.
 *
 * Only these two templates, by name. One line per row.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const SCHEDULED = 'Interview Scheduled — Panel';
export const RESCHEDULED = 'Interview Rescheduled — Panel';
export const PANEL_TEMPLATE_NAMES = Object.freeze([SCHEDULED, RESCHEDULED]);

const SIGN_OFF = '<p>Best regards,<br/>AAPNA Infotech Recruitment Team</p>';

const OLD_SCHED = `<p>Hi {{interviewer_name}},</p>
<p>You are scheduled to take <strong>{{stage_label}}</strong> for <strong>{{candidate_name}}</strong> ({{position}}).</p>
<p><strong>When:</strong> {{interview_when}}<br/><strong>Duration:</strong> {{duration}} minutes<br/>
   <strong>Candidate email:</strong> {{candidate_email}}</p>
{{teams_line}}`;

const OLD_RESCHED = `<p>Hi {{interviewer_name}},</p>
<p>The <strong>{{stage_label}}</strong> interview with <strong>{{candidate_name}}</strong> ({{position}}) has been <strong>rescheduled</strong>.</p>
<p><strong>Previous time:</strong> <span style="text-decoration:line-through;color:#888;">{{previous_when}}</span><br/>
   <strong>New time:</strong> {{interview_when}}<br/>
   <strong>Duration:</strong> {{duration}} minutes<br/>
   <strong>Candidate email:</strong> {{candidate_email}}</p>
{{teams_line}}`;

/** Each old default: 4102495^, then 0b8f723 (with the sign-off), then b671236 ("Hi," and the sign-off). */
const oldVersions = (body) => [body, `${body}\n${SIGN_OFF}`, `${body.replace('<p>Hi {{interviewer_name}},</p>', '<p>Hi,</p>')}\n${SIGN_OFF}`];

/** The U03 defaults: INTERVIEW_SCHED_PANEL_BODY and INTERVIEW_RESCHED_PANEL_BODY in prisma/seed-email-templates.js. */
export const NEW_DEFAULTS = Object.freeze({
  [SCHEDULED]: {
    subject: 'Interview panel — {{stage_label}}: {{candidate_name}}',
    body_html: `<p>Hi {{interviewer_name}},</p>
<p>You are scheduled to take <strong>{{stage_label}}</strong> for <strong>{{candidate_name}}</strong> ({{position}}).</p>
<p><strong>When:</strong> {{interview_when}}<br/><strong>Duration:</strong> {{duration}} minutes</p>
{{teams_line}}
{{candidate_table}}`,
    placeholders: ['interviewer_name', 'candidate_name', 'candidate_email', 'position', 'stage_label', 'interview_when', 'duration', 'teams_line', 'candidate_table'],
  },
  [RESCHEDULED]: {
    subject: 'Interview rescheduled — {{stage_label}}: {{candidate_name}}',
    body_html: `<p>Hi {{interviewer_name}},</p>
<p>The <strong>{{stage_label}}</strong> interview with <strong>{{candidate_name}}</strong> ({{position}}) has been <strong>rescheduled</strong>.</p>
<p><strong>Previous time:</strong> <span style="text-decoration:line-through;color:#888;">{{previous_when}}</span><br/>
   <strong>New time:</strong> {{interview_when}}<br/>
   <strong>Duration:</strong> {{duration}} minutes</p>
{{teams_line}}
{{candidate_table}}`,
    placeholders: ['interviewer_name', 'candidate_name', 'candidate_email', 'position', 'stage_label', 'previous_when', 'interview_when', 'duration', 'teams_line', 'candidate_table'],
  },
});

/** The subjects did not change between the old and new defaults. */
export const OLD_DEFAULTS = Object.freeze({
  [SCHEDULED]: oldVersions(OLD_SCHED).map((body_html) => ({ subject: NEW_DEFAULTS[SCHEDULED].subject, body_html })),
  [RESCHEDULED]: oldVersions(OLD_RESCHED).map((body_html) => ({ subject: NEW_DEFAULTS[RESCHEDULED].subject, body_html })),
});

/** Whitespace normalisation: runs collapse to one space, none between tags, trimmed. */
export function normaliseTemplateText(s) {
  return String(s ?? '').replace(/\s+/g, ' ').replace(/>\s+</g, '><').trim();
}

const same = (a, b) => normaliseTemplateText(a.subject) === normaliseTemplateText(b.subject)
  && normaliseTemplateText(a.body_html) === normaliseTemplateText(b.body_html);

/**
 * What to do with one stored row.
 * @param {{name: string, subject: string, body_html: string}} row
 * @returns {'current'|'unedited'|'edited'|'not_panel'}
 *   current: already the new default; unedited: an old default, so replace it;
 *   edited: HR changed it, so it is never touched.
 */
export function classifyPanelTemplate(row) {
  if (!PANEL_TEMPLATE_NAMES.includes(row?.name)) return 'not_panel';
  if (same(row, NEW_DEFAULTS[row.name])) return 'current';
  if (OLD_DEFAULTS[row.name].some((old) => same(row, old))) return 'unedited';
  return 'edited';
}

/** The one-line result for a row. */
export function resultLine(row, verdict, apply) {
  const who = `${row.name} (#${row.id})`;
  switch (verdict) {
    case 'current': return `${who}: already the new default; nothing to do.`;
    case 'unedited': return apply
      ? `${who}: unedited old default; replaced with the new default.`
      : `${who}: unedited old default; would be replaced with the new default (run with --apply).`;
    case 'edited': return `HR edited ${row.name} (#${row.id}); left as is. Remove the 'Candidate email:' line by hand on the Email Templates page.`;
    default: return `${who}: not a panel template; skipped.`;
  }
}

async function main() {
  const apply = process.argv.includes('--apply');
  const { default: prisma } = await import('../src/config/database.js');
  try {
    console.log(apply ? 'APPLY: unedited rows are replaced.' : 'DRY RUN: nothing is written. Add --apply to write.');
    for (const name of PANEL_TEMPLATE_NAMES) {
      const rows = await prisma.rpa_email_templates.findMany({
        where: { name },
        orderBy: { id: 'asc' },
        select: { id: true, name: true, subject: true, body_html: true },
      });
      if (!rows.length) console.log(`${name}: no stored row; nothing to do.`);
      for (const row of rows) {
        const verdict = classifyPanelTemplate(row);
        if (apply && verdict === 'unedited') {
          const next = NEW_DEFAULTS[name];
          await prisma.rpa_email_templates.update({
            where: { id: row.id },
            data: { subject: next.subject, body_html: next.body_html, placeholders: next.placeholders, modified_at: new Date() },
          });
        }
        console.log(resultLine(row, verdict, apply));
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  main().catch((e) => {
    console.error('Refresh failed:', e.message);
    process.exitCode = 1;
  });
}
