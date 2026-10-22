/**
 * emailText.js — plain-text rendering of an inbound/outbound email body.
 *
 * Outlook conversation bodies (rpa_email_messages.body_html/body_preview) are
 * third-party HTML from an external mailbox. Rather than sanitising HTML for
 * safe rendering, every conversation surface in this app strips it down to
 * plain text and lets React's default text-escaping handle the rest — no
 * dangerouslySetInnerHTML, no HTML sanitiser to keep in step with new tags.
 * Originally local to CandidateScreening.jsx's Conversations modal; the
 * Pipeline drawer's Conversations tab (G4) reuses it rather than forking a
 * second implementation.
 */
export function cleanMsgBody(s) {
  if (!s) return '(No content)';
  // Strip HTML tags & decode entities
  let text = s.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
              .replace(/<[^>]*>/g, ' ')
              .replace(/&amp;/gi, '&')
              .replace(/&lt;/gi, '<')
              .replace(/&gt;/gi, '>')
              .replace(/&quot;/gi, '"')
              .replace(/&#039;/gi, "'")
              .replace(/&#x27;/gi, "'")
              .replace(/&rsquo;/gi, "'")
              .replace(/&lsquo;/gi, "'")
              .replace(/&ldquo;/gi, '"')
              .replace(/&rdquo;/gi, '"')
              .replace(/&nbsp;/gi, ' ');
  // Strip company disclaimer boilerplate (e.g. "EXTERNAL EMAIL: ... password.")
  text = text.replace(/EXTERNAL EMAIL:[\s\S]*?password\./gi, '').trim();
  // Strip quoted-reply thread — Gmail & Outlook formats
  text = text.split(/\bOn\s+(Mon|Tue|Wed|Thu|Fri|Sat|Sun|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\d{1,2}[\/\-])/i)[0];
  text = text.split(/\r?\nFrom:\s/i)[0];
  text = text.split(/\r?\n-{3,}/)[0];
  // Collapse whitespace
  text = text.replace(/\s+/g, ' ').trim();
  return text || '(No content)';
}

export default { cleanMsgBody };
