/**
 * The "Earlier rounds" block on the interview panel's invite (L14): one line
 * per earlier round (recommendation, average, recording link), then what is
 * attached, with a link where a file could not travel.
 *
 * Pure and import-free (tests/unit/panelPack.test.js).
 */

const MUTED = '#6b7280';
const LINK = '#5a6e1f';

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const RECOMMENDATION_LABEL = { approve: 'recommends moving forward', hold: 'recommends holding', reject: 'recommends rejecting' };

/**
 * Did any earlier round produce something an interviewer should see?
 * @param {object} model - buildDossierModel() output
 */
export function hasEarlierResults(model) {
  if (!model) return false;
  return (model.scorecards || []).length > 0
    || (model.zeko || []).some((z) => z.overall_score !== null && z.overall_score !== undefined)
    || (model.assessments || []).length > 0
    || (model.recordings || []).length > 0
    || (model.round_notes || []).length > 0;
}

/**
 * One line per earlier round, from the (redacted) dossier model.
 * @param {object} model
 * @returns {Array<{round: string, text: string, recordingUrl: string|null}>}
 */
export function earlierRoundLines(model) {
  const lines = [];
  const recordings = (model?.recordings || []).filter((r) => r.share_url);
  const usedRecording = new Set();
  for (const c of (model?.scorecards || []).filter((s) => !s.earlier_attempt)) {
    const parts = [];
    if (c.interviewer) parts.push(c.interviewer);
    if (c.recommendation) parts.push(RECOMMENDATION_LABEL[c.recommendation] || `recommends ${c.recommendation}`);
    if (c.avg_score !== null && c.avg_score !== undefined) parts.push(`average ${c.avg_score}/5`);
    const rec = recordings.find((r, i) => r.stage_label === c.stage_label && !usedRecording.has(i));
    if (rec) usedRecording.add(recordings.indexOf(rec));
    lines.push({ round: c.stage_label, text: parts.join(' · ') || 'scorecard submitted', recordingUrl: rec?.share_url || null });
  }
  for (const z of model?.zeko || []) {
    if (z.overall_score === null || z.overall_score === undefined) continue;
    lines.push({ round: z.round, text: `AI screening score ${z.overall_score}`, recordingUrl: null });
  }
  for (const a of model?.assessments || []) {
    const bits = [a.result, a.overall_percentage !== null && a.overall_percentage !== undefined ? `${a.overall_percentage}%` : null].filter(Boolean);
    lines.push({ round: a.test_name, text: bits.join(' · ') || 'assessment taken', recordingUrl: null });
  }
  // Recordings of rounds with no scorecard (yet) still get their link.
  recordings.forEach((r, i) => {
    if (!usedRecording.has(i)) lines.push({ round: r.stage_label, text: 'recording available', recordingUrl: r.share_url });
  });
  return lines;
}

/**
 * The block's HTML.
 * @param {object} p
 * @param {Array<{round: string, text: string, recordingUrl: string|null}>} p.lines
 * @param {{report: boolean, jd: 'attached'|'link'|'none', cv: 'attached'|'too_large'|'none'}} p.summary
 * @param {string|null} [p.jdLink]
 * @returns {string}
 */
export function buildEarlierRoundsBlock({ lines = [], summary, jdLink = null }) {
  const rows = lines.map((l) => `<tr><td style="padding:6px 14px 6px 0;vertical-align:top;white-space:nowrap"><strong>${esc(l.round)}</strong></td>`
    + `<td style="padding:6px 0;vertical-align:top">${esc(l.text)}${l.recordingUrl ? ` · <a href="${esc(l.recordingUrl)}" style="color:${LINK}">watch the recording</a>` : ''}</td></tr>`).join('');
  const roundsHtml = rows
    ? `<p style="margin:18px 0 6px 0;font-weight:700">Earlier rounds</p><table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.5">${rows}</table>`
    : '';

  const attached = [
    summary?.report ? 'the report so far (every earlier round, with the scorecards)' : null,
    summary?.jd === 'attached' ? 'the job description' : null,
    summary?.cv === 'attached' ? "the candidate's CV" : null,
  ].filter(Boolean);
  const notes = [];
  if (attached.length) notes.push(`Attached: ${attached.join(', ')}.`);
  if (summary?.jd === 'link' && jdLink) notes.push(`Job description: <a href="${esc(jdLink)}" style="color:${LINK}">open the JD</a>.`);
  if (summary?.cv === 'too_large') notes.push('The CV was too large to attach. Reply to this email and the recruitment team will send it.');
  if (roundsHtml && lines.some((l) => l.recordingUrl)) {
    notes.push('Recording links open without signing in, work for 14 days and are recorded each time they are opened.');
  }
  const notesHtml = notes.length
    ? `<p style="margin:14px 0 0 0;font-size:13px;color:${MUTED}">${notes.join('<br>')}</p>`
    : '';
  return roundsHtml + notesHtml;
}

export default { hasEarlierResults, earlierRoundLines, buildEarlierRoundsBlock };
