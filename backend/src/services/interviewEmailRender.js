/**
 * Renders one of the L14 interview templates (Email Templates › General /
 * Alerts), falling back to the built-in default when the row is missing or
 * inactive. The same contract as renderMrfHoldTemplate(): `values` are plain
 * text and are escaped for the body; `fragments` are caller-built HTML. The
 * subject gets the raw values, since it is not HTML.
 */
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import { compileTemplate } from './emailNotification.service.js';
import { wrapBrandedEmail } from './emailLayout.service.js';
import { INTERVIEW_EMAIL_TEMPLATE_DEFAULTS } from './interviewEmailTemplates.js';

const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * @param {string} name - an INTERVIEW_EMAIL_TEMPLATE_NAMES value
 * @param {Record<string, *>} values
 * @param {Record<string, string>} [fragments]
 * @returns {Promise<{subject: string, html: string}>} html is the full branded email
 */
export async function renderInterviewTemplate(name, values, fragments = {}) {
  const fallback = INTERVIEW_EMAIL_TEMPLATE_DEFAULTS[name];
  let tpl = null;
  try {
    tpl = await prisma.rpa_email_templates.findFirst({ where: { name, is_active: true } });
  } catch (err) {
    logger.warn(`Email template "${name}" lookup failed, using the built-in default: ${err.message}`);
  }
  const escaped = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, esc(v)]));
  const { subject } = compileTemplate(tpl?.subject || fallback.subject, '', { ...values, ...fragments });
  const { html } = compileTemplate('', tpl?.body_html || fallback.body_html, { ...escaped, ...fragments });
  return { subject, html: wrapBrandedEmail(html, { title: subject }) };
}

export default { renderInterviewTemplate };
