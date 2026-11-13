/**
 * U03 · The candidate table in the interview panel's invite body.
 *
 * Chhaya's "Updated Candidate Tracking Sheet format" (S. No. | Particulars |
 * Details), filled with what the candidate has done so far. Interviewers and the
 * CHRO/CEO read the email body; they do not open attachments.
 *
 * Pure and import-free (tests/unit/panelCandidateTable.test.js). The loader,
 * loadPanelCandidateTable() in interviewPanelPack.service.js, reads the data:
 *   - `facts` (email, CTC, source, notice and so on) come from their own rpa_cv
 *     query and NEVER enter the dossier model, whose redaction guard forbids CTC,
 *     JobSource and the candidate's email;
 *   - `rounds` come from the redacted dossier model, via panelTableRounds().
 *
 * Gates, enforced here so no caller can forget them:
 *   - CTC (current and expected) only on the HR and CEO rounds' invites;
 *   - Source only when HR ticked "show the source" AND the candidate is not a
 *     referral (`facts.referral`), whatever was ticked (Phase 3 rule).
 *
 * Email-safe: inline styles only, no classes, a plain <table> Outlook desktop
 * (Word engine) and OWA both render.
 */

/** What a missing value shows: the dossier's own empty marker. */
export const EMPTY = '—';

/** The rounds whose invite carries CTC. */
export const CTC_STAGE_KEYS = Object.freeze(['hr_round', 'ceo']);

/** Pipeline order of the interview rounds (config/pipelineStages.js). */
const ROUND_ORDER = ['tech1', 'tech2', 'tech3', 'hr_round', 'ceo', 'client'];

/**
 * Where the table goes in a panel template: `{{candidate_table}}`.
 *
 * The Schedule window's editable body is compiled before the invite is sent,
 * and must not carry the table itself (it holds CTC on HR/CEO rounds, and a
 * recruiter must not be able to edit those values). So the token compiles to a
 * visible placeholder the editor keeps (a data- attribute, which DOMPurify keeps;
 * an HTML comment it would strip), and the table replaces it at send time.
 */
export const CANDIDATE_TABLE_TOKEN = '{{candidate_table}}';
export const CANDIDATE_TABLE_ATTR = 'data-ats-candidate-table';
export const CANDIDATE_TABLE_PLACEHOLDER = `<div ${CANDIDATE_TABLE_ATTR}="1" style="margin:14px 0;padding:8px 10px;border:1px dashed #c9d3a7;border-radius:6px;color:#6b7280;font-size:12px;">The candidate details table goes here when the invite is sent.</div>`;

const PLACEHOLDER_RE = new RegExp(`<(div|p)\\b[^>]*${CANDIDATE_TABLE_ATTR}[^>]*>[\\s\\S]*?</\\1>`, 'i');

const BORDER = '#d9dfc8';
const HEAD_BG = '#f6f9eb';
const LABEL = '#374151';
const MUTED = '#6b7280';
const LINK = '#5a6e1f';

const RECOMMENDATION_TEXT = { approve: 'Move forward', hold: 'Hold', reject: 'Reject' };
const COMMENT_MAX = 160;
const NOTES_MAX = 300;

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const blank = (v) => v === null || v === undefined || String(v).trim() === '';
const has = (v) => !blank(v);
const clip = (s, max) => {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};
const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u.trim()) ? u.trim() : null);

/** Is the Source row shown? Only when ticked, and never for a referral. */
export function sourceShown(showSource, facts) {
  return Boolean(showSource) && !facts?.referral;
}

/** Does this round's invite show CTC? */
export function showsCtc(stageKey) {
  return CTC_STAGE_KEYS.includes(stageKey);
}

/** "12" → "12 LPA"; free text ("12 LPA fixed + 2 variable") is left as typed. */
function ctcText(v) {
  if (blank(v)) return null;
  const t = String(v).trim();
  return /^\d+(\.\d+)?$/.test(t) ? `${t} LPA` : t;
}

function dateText(d) {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
  }).format(date);
}

function experienceText(v) {
  if (blank(v)) return null;
  const t = String(v).trim();
  return /^\d+(\.\d+)?$/.test(t) ? `${t} years` : t;
}

/**
 * U03b · Did a round really happen? "We can skip some rounds… we should not
 * miss the gaps." Scorecards prove a round by themselves (one is submitted
 * only for a held booking). Two other row sources do not, and are checked here
 * against the journey's own records:
 *   - the recruiter's round notes live on rpa_cv, not on the journey, so a
 *     "Tech round 1" note can come from an older journey or an Excel import;
 *   - a recording can belong to a cancelled booking or a no-show.
 *
 * The service (loadRoundEvidence() in interviewPanelPack.service.js) reads the
 * rows; the functions below decide.
 */

/** Stage states that mean the candidate was in that round (utils/stageState.js). */
const REACHED_STATES = Object.freeze(['active', 'completed', 'rejected', 'hold']);

/**
 * The stages a journey's 'skip' events name as bypassed. A skip event sits on
 * the stage the candidate LANDED in (utils/stageSkip.js), so the bypassed ones
 * are read from its note, in each of the three wordings that write it:
 *   - "Skipped optional stage tech3 (Technical Round 3)", or "… stages ceo (CEO
 *     Round), client (Client Round)" (skipNote, an approval that skips);
 *   - "Skipped optional stage from tech1" (advanceStage);
 *   - "Approve landed on HR Round, past Technical Round 2, Technical Round 3"
 *     (flexible stages on, by label).
 *
 * @param {Array<{notes?: string|null}>} events - the journey's 'skip' events
 * @param {Record<string, string>} [labelByKey] - stage_key -> label
 * @returns {string[]} stage keys
 */
export function skippedStagesFromEvents(events = [], labelByKey = {}) {
  const keyByLabel = new Map(Object.entries(labelByKey || {}).map(([k, l]) => [String(l).trim().toLowerCase(), k]));
  const known = (k) => Object.prototype.hasOwnProperty.call(labelByKey || {}, k);
  const out = new Set();
  for (const e of events || []) {
    const note = String(e?.notes || '').trim();
    let m = /^Skipped optional stage from (\S+)/i.exec(note);
    if (m) { out.add(m[1]); continue; }
    m = /^Skipped optional stages? (.+)$/i.exec(note);
    if (m) {
      for (const k of m[1].matchAll(/([a-z0-9_]+) \(/gi)) out.add(k[1]);
      continue;
    }
    m = /, past (.+)$/i.exec(note);
    if (m) {
      for (const part of m[1].split(',').map((s) => s.trim()).filter(Boolean)) {
        const key = keyByLabel.get(part.toLowerCase()) || (known(part) ? part : null);
        if (key) out.add(key);
      }
    }
  }
  return [...out];
}

/** A booking that took place: not cancelled and not a no-show. */
export function bookingHeld(booking) {
  if (!booking) return false;
  return !booking.cancelled_at
    && booking.status !== 'cancelled'
    && booking.status !== 'no_show'
    && booking.occurrence_status !== 'no_show';
}

/**
 * One journey's round evidence.
 *
 * @param {object} p
 * @param {Record<string, string>} [p.states] - loadStageStates() output
 * @param {Array<{notes?: string|null}>} [p.skipEvents]
 * @param {Record<string, string>} [p.labelByKey]
 * @param {Array<{stage_key: string, status?: string, cancelled_at?: Date|null, occurrence_status?: string|null}>} [p.recordingBookings]
 *   each recording's booking, in the dossier model's recording order
 * @returns {{reached: string[], skipped: string[], recordings: Array<{stage_key: string, held: boolean}>}}
 *   `reached`: the candidate was in the round (a state other than skipped or not
 *   visited). `skipped`: marked skipped, or named by a skip event, and not
 *   reached later (a skipped round can be visited later, D2).
 */
export function journeyRoundEvidence({
  states = {}, skipEvents = [], labelByKey = {}, recordingBookings = [],
} = {}) {
  const reached = Object.entries(states || {}).filter(([, s]) => REACHED_STATES.includes(s)).map(([k]) => k);
  const skipped = new Set([
    ...Object.entries(states || {}).filter(([, s]) => s === 'skipped').map(([k]) => k),
    ...skippedStagesFromEvents(skipEvents, labelByKey),
  ]);
  for (const k of reached) skipped.delete(k);
  return {
    reached,
    skipped: [...skipped],
    recordings: (recordingBookings || []).map((b) => ({ stage_key: b?.stage_key ?? null, held: bookingHeld(b) })),
  };
}

/**
 * Marks each of a journey's own recordings with `booking_held`, by position (the
 * evidence is read in the dossier's recording order). An earlier role's
 * recordings (`earlier_role`) are skipped: they were marked before the merge.
 * If the lists do not line up (a recording found in between), nothing is
 * marked and every recording stays, as before U03b.
 *
 * @param {object|null} model
 * @param {Array<{stage_key: string, held: boolean}>|null|undefined} recordings
 * @returns {object|null} a new model, or the same one when nothing is marked
 */
export function markHeldRecordings(model, recordings) {
  if (!model || !Array.isArray(recordings)) return model;
  const own = (model.recordings || []).filter((r) => !r.earlier_role);
  if (own.length !== recordings.length) return model;
  if (own.some((r, i) => (r.stage_key ?? null) !== (recordings[i].stage_key ?? null))) return model;
  let i = 0;
  return {
    ...model,
    recordings: (model.recordings || []).map((r) => (r.earlier_role ? r : { ...r, booking_held: recordings[i++].held })),
  };
}

/**
 * Where a recruiter's round note belongs: this journey when it reached the
 * round; else the latest earlier role (U07 chain) that did, labelled as that
 * role; else nowhere (the round was skipped, or never reached by any journey).
 *
 * @param {string|null} stageKey
 * @param {{current?: {reached?: string[]}, earlier?: Array<{pipeline_id?: string, role?: string|null, reached?: string[]}>}|null} evidence
 * @returns {{current: true}|{earlier: number}|null} `earlier` is the index in evidence.earlier
 */
export function roundNoteHome(stageKey, evidence) {
  if (!evidence || !stageKey) return { current: true };
  if ((evidence.current?.reached || []).includes(stageKey)) return { current: true };
  const chain = evidence.earlier || [];
  for (let j = chain.length - 1; j >= 0; j -= 1) {
    if ((chain[j]?.reached || []).includes(stageKey)) return { earlier: j };
  }
  return null;
}

/**
 * The rounds part of the table, from the (redacted) dossier model. Only what is
 * DONE: a round with a current scorecard, a recruiter's round note or a
 * recording. Earlier attempts of a re-done round are left out, as is the round
 * the invite is for.
 *
 * U03b: with `evidence` (loadRoundEvidence()), a round note shows only under a
 * round some journey in the chain really reached (roundNoteHome), and a
 * recording marked `booking_held: false` is left out. Without it, as before.
 *
 * U07: a model merged by mergeEarlierRoles() (utils/panelEarlierRoles.js) also
 * carries the earlier roles' rounds. They come first, oldest role first, keep
 * their own round label in `stage_label` and name the role in `earlier_role`;
 * the invite's own round never hides them. Their Zeko and Evalground results
 * land in `zeko.earlier` and in `evalground` with `role` set.
 *
 * @param {object|null} model - buildDossierModel() output; `share_url` on a
 *   recording when the pack minted links for it
 * @param {{ excludeStageKey?: string|null, evidence?: object|null }} [options]
 * @returns {{ zeko: {functional: object|null, hr: object|null,
 *     earlier: Array<{screening: 'functional'|'hr', role: string, overall: number, technical: number|null, communication: number|null}>},
 *   evalground: Array<{test: string, result: string|null, percentage: number|null, role: string|null}>,
 *   interviews: Array<{stage_key: string|null, stage_label: string, earlier_role: string|null,
 *     feedback: Array<{interviewer: string|null, recommendation: string|null, average: number|null, comments: string|null}>,
 *     notes: string|null, recordings: Array<{url: string|null}>}>}}
 */
export function panelTableRounds(model, { excludeStageKey = null, evidence = null } = {}) {
  const scores = (z) => ({ overall: z.overall_score, technical: z.technical_score ?? null, communication: z.communication_score ?? null });
  const isScored = (z) => z.overall_score !== null && z.overall_score !== undefined;
  const zekoRound = (name) => {
    const z = (model?.zeko || []).find((r) => !r.earlier_role && r.round === name && isScored(r));
    return z ? scores(z) : null;
  };
  const earlierZeko = (model?.zeko || []).filter((r) => r.earlier_role && isScored(r)).map((r) => ({
    screening: r.earlier_label === 'HR screening' ? 'hr' : 'functional',
    role: r.earlier_role,
    ...scores(r),
  }));
  const evalground = (model?.assessments || []).map((a) => ({
    test: (a.earlier_role ? a.earlier_label : a.test_name) || 'Assessment',
    result: a.result || null,
    percentage: a.overall_percentage ?? null,
    role: a.earlier_role || null,
  }));

  // One entry per round, keyed by stage_key (the label for an unkeyed row).
  // An earlier role's round is keyed by its role, so its Tech 1 stays apart
  // from this journey's Tech 1.
  const byKey = new Map();
  const labelToKey = new Map();
  const entry = (stageKey, stageLabel, item = null) => {
    if (item?.earlier_role) {
      const key = `earlier:${item.earlier_seq ?? 0}:${item.earlier_stage_key || item.earlier_label || stageLabel}`;
      if (!byKey.has(key)) {
        byKey.set(key, {
          stage_key: null,
          stage_label: item.earlier_label || stageLabel,
          earlier_role: item.earlier_role,
          earlier_seq: item.earlier_seq ?? 0,
          earlier_stage_key: item.earlier_stage_key || null,
          feedback: [],
          notes: null,
          recordings: [],
        });
      }
      return byKey.get(key);
    }
    const key = stageKey || labelToKey.get(stageLabel) || stageLabel;
    if (stageKey && stageLabel) labelToKey.set(stageLabel, stageKey);
    if (!byKey.has(key)) {
      byKey.set(key, {
        stage_key: stageKey || null, stage_label: stageLabel || stageKey, earlier_role: null, feedback: [], notes: null, recordings: [],
      });
    }
    return byKey.get(key);
  };

  const named = model?.consolidated_by_interviewer;
  const current = Array.isArray(named)
    ? named
    : (model?.scorecards || []).filter((c) => !c.earlier_attempt).map((c) => ({
      stage_key: c.stage_key, round: c.stage_label, interviewer: c.interviewer,
      recommendation: c.recommendation, average: c.avg_score, comments: c.comments,
      earlier_role: c.earlier_role, earlier_label: c.earlier_label, earlier_seq: c.earlier_seq, earlier_stage_key: c.earlier_stage_key,
    }));
  for (const c of current) {
    entry(c.stage_key, c.round, c).feedback.push({
      interviewer: c.interviewer || null,
      recommendation: c.recommendation || null,
      average: c.average ?? null,
      comments: c.comments || null,
    });
  }
  // U03b: an earlier journey's place among the merged roles (their
  // earlier_seq), so its note joins that role's row for the round. A journey
  // with no results of its own was not merged: it sorts between its neighbours.
  const mergedIds = (model?.earlier_role_ids || []).map(String);
  const seqOf = (j) => {
    const chain = evidence?.earlier || [];
    const at = mergedIds.indexOf(String(chain[j]?.pipeline_id ?? ''));
    if (at !== -1) return at;
    if (!mergedIds.length) {
      const byTitle = (model?.earlier_roles || []).lastIndexOf(chain[j]?.role);
      if (byTitle !== -1) return byTitle;
    }
    return chain.slice(0, j).filter((e) => mergedIds.includes(String(e?.pipeline_id ?? ''))).length - 0.5;
  };
  for (const n of model?.round_notes || []) {
    if (!has(n.value)) continue;
    const home = roundNoteHome(n.stage_key, evidence);
    if (!home) continue; // skipped, or no journey reached it
    if (home.current) {
      entry(n.stage_key, n.stage_label).notes = String(n.value);
      continue;
    }
    const role = evidence.earlier[home.earlier];
    entry(null, n.stage_label, {
      earlier_role: role?.role || 'earlier role',
      earlier_label: n.stage_label || n.stage_key,
      earlier_seq: seqOf(home.earlier),
      earlier_stage_key: n.stage_key,
    }).notes = String(n.value);
  }
  for (const r of model?.recordings || []) {
    if (r.booking_held === false) continue; // U03b: a cancelled booking or a no-show
    entry(r.stage_key, r.stage_label, r).recordings.push({ url: safeUrl(r.share_url) });
  }

  const rank = (k) => {
    const i = ROUND_ORDER.indexOf(k);
    return i === -1 ? ROUND_ORDER.length : i;
  };
  // Earlier roles first (oldest first), then this journey's rounds.
  const group = (r) => (r.earlier_role ? r.earlier_seq : Number.MAX_SAFE_INTEGER);
  const interviews = [...byKey.values()]
    .filter((r) => !(excludeStageKey && !r.earlier_role && r.stage_key === excludeStageKey))
    .map((r, i) => ({ r, i }))
    .sort((a, b) => group(a.r) - group(b.r)
      || rank(a.r.stage_key || a.r.earlier_stage_key) - rank(b.r.stage_key || b.r.earlier_stage_key)
      || a.i - b.i)
    .map(({ r }) => {
      const { earlier_seq: _seq, earlier_stage_key: _key, ...round } = r;
      return round;
    });

  return {
    zeko: { functional: zekoRound('Functional screening'), hr: zekoRound('HR screening'), earlier: earlierZeko },
    evalground,
    interviews,
  };
}

/** " · earlier role: Java Lead" after a row's label, or nothing. */
const roleSuffix = (role) => (role ? ` · earlier role: ${role}` : '');

function zekoScoreText(z) {
  const parts = [
    has(z.technical) ? `technical ${z.technical}` : null,
    has(z.communication) ? `communication ${z.communication}` : null,
  ].filter(Boolean);
  return `${z.overall}${parts.length ? ` (${parts.join(' · ')})` : ''}`;
}

/**
 * This journey's score, then each earlier role's (U07). The score uploaded on
 * the CV stands in only when no Zeko result exists on any journey.
 */
function zekoText(z, uploaded, earlier = []) {
  const lines = [];
  if (z) lines.push(esc(zekoScoreText(z)));
  else if (!earlier.length && has(uploaded)) lines.push(esc(String(uploaded)));
  for (const e of earlier) lines.push(esc(`${zekoScoreText(e)} (earlier role: ${e.role})`));
  return lines.length ? lines.join('<br>') : null;
}

function evalgroundText(list) {
  if (!list?.length) return null;
  return list.map((a) => {
    const bits = [a.percentage !== null && a.percentage !== undefined ? `${a.percentage}%` : null, a.result].filter(Boolean);
    return esc(`${a.test}${bits.length ? `: ${bits.join(' · ')}` : ''}${a.role ? ` (earlier role: ${a.role})` : ''}`);
  }).join('<br>');
}

function feedbackText(round) {
  const lines = round.feedback.map((f) => {
    const parts = [
      f.interviewer,
      f.recommendation ? (RECOMMENDATION_TEXT[f.recommendation] || f.recommendation) : null,
      f.average !== null && f.average !== undefined ? `avg ${f.average}/5` : null,
      f.comments ? clip(f.comments, COMMENT_MAX) : null,
    ].filter(Boolean);
    return esc(parts.join(' · ') || 'Scorecard submitted');
  });
  if (round.notes) lines.push(esc(`${round.feedback.length ? 'Recruiter note: ' : ''}${clip(round.notes, NOTES_MAX)}`));
  return lines.length ? lines.join('<br>') : null;
}

function recordingText(round, linksPending) {
  if (!round.recordings.length) return `<span style="color:${MUTED}">No recording</span>`;
  const linked = round.recordings.filter((r) => r.url);
  if (linked.length) {
    return linked.map((r, i) => `<a href="${esc(r.url)}" style="color:${LINK}">Watch the recording${linked.length > 1 ? ` ${i + 1}` : ''}</a>`).join('<br>');
  }
  return `<span style="color:${MUTED}">${linksPending
    ? 'Recorded: the link is added when the invite is sent'
    : 'Recorded: ask the recruitment team for the link'}</span>`;
}

/**
 * The table's rows, in Chhaya's order, as [label, html-or-null]. Exported for
 * the tests; buildPanelCandidateTable() renders them.
 */
export function panelTableRows({ facts = {}, rounds = null, stageKey = null, showSource = false, linksPending = false }) {
  const r = rounds || panelTableRounds(null);
  const withSource = sourceShown(showSource, facts);
  const rows = [
    ['Date of upload / applied', esc(dateText(facts.applied_at))],
    ['Name', esc(facts.name)],
    ['Role / Position', esc(facts.role)],
  ];
  if (withSource) rows.push(['Source', esc(facts.source)]);
  rows.push(
    ['Notice period', esc(facts.notice)],
    ['Qualification', esc(facts.qualification)],
    ['Email ID', esc(facts.email)],
    ['Total experience', esc(experienceText(facts.experience))],
    ['Zeko functional test score', zekoText(r.zeko?.functional, facts.zeko_uploaded, (r.zeko?.earlier || []).filter((e) => e.screening === 'functional'))],
  );
  const earlierHr = (r.zeko?.earlier || []).filter((e) => e.screening === 'hr');
  if (r.zeko?.hr || earlierHr.length) rows.push(['Zeko HR screening score', zekoText(r.zeko?.hr || null, null, earlierHr)]);
  rows.push(['Evalground test score', evalgroundText(r.evalground)]);
  if (showsCtc(stageKey)) {
    rows.push(
      ['Current CTC', esc(ctcText(facts.current_ctc))],
      ['Expected CTC', esc(ctcText(facts.expected_ctc))],
    );
  }
  for (const round of r.interviews || []) {
    rows.push(
      [`${round.stage_label} feedback${roleSuffix(round.earlier_role)}`, feedbackText(round)],
      [`${round.stage_label} recording${roleSuffix(round.earlier_role)}`, recordingText(round, linksPending)],
    );
  }
  return rows.map(([label, html]) => [label, html === '' ? null : html]);
}

/**
 * The table's HTML.
 *
 * @param {object} p
 * @param {object} p.facts - {applied_at, name, role, source, notice, qualification,
 *   email, experience, current_ctc, expected_ctc, zeko_uploaded, referral}
 * @param {object} p.rounds - panelTableRounds() output
 * @param {string|null} p.stageKey - the round the invite is for (gates CTC)
 * @param {boolean} [p.showSource] - HR's tick-box (ignored for a referral)
 * @param {boolean} [p.linksPending] - the Schedule window's preview: recording
 *   links are minted only when the invite is sent
 * @returns {string}
 */
export function buildPanelCandidateTable({ facts, rounds, stageKey, showSource = false, linksPending = false }) {
  const rows = panelTableRows({ facts, rounds, stageKey, showSource, linksPending });
  const cell = 'padding:6px 10px;border:1px solid ' + BORDER + ';vertical-align:top;';
  const head = `<tr>`
    + `<th style="${cell}background:${HEAD_BG};text-align:left;width:44px;">S. No.</th>`
    + `<th style="${cell}background:${HEAD_BG};text-align:left;width:34%;">Particulars</th>`
    + `<th style="${cell}background:${HEAD_BG};text-align:left;">Details</th></tr>`;
  const body = rows.map(([label, html], i) => `<tr>`
    + `<td style="${cell}color:${MUTED};">${i + 1}</td>`
    + `<td style="${cell}color:${LABEL};font-weight:600;">${esc(label)}</td>`
    + `<td style="${cell}">${html ?? EMPTY}</td></tr>`).join('');
  return `<p style="margin:18px 0 6px 0;font-weight:700;">Candidate details</p>`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;line-height:1.45;">`
    + `<thead>${head}</thead><tbody>${body}</tbody></table>`;
}

/**
 * Put the table into a panel body: at the template's placeholder (or a raw
 * {{candidate_table}} token), else after the body. An empty table removes the
 * placeholder.
 *
 * @param {string} html
 * @param {string} tableHtml
 * @returns {string}
 */
export function placeCandidateTable(html, tableHtml) {
  const body = html || '';
  const table = tableHtml || '';
  if (PLACEHOLDER_RE.test(body)) return body.replace(PLACEHOLDER_RE, () => table);
  if (body.includes(CANDIDATE_TABLE_TOKEN)) return body.split(CANDIDATE_TABLE_TOKEN).join(table);
  return `${body}${table}`;
}

/**
 * Append to a panel body, but before the table's placeholder when there is one,
 * so the send-time Teams block and recording notice stay above the table.
 */
export function insertBeforeCandidateTable(html, extra) {
  const body = html || '';
  const m = PLACEHOLDER_RE.exec(body);
  const at = m ? m.index : body.indexOf(CANDIDATE_TABLE_TOKEN);
  return at === -1 ? `${body}${extra}` : `${body.slice(0, at)}${extra}${body.slice(at)}`;
}

export default {
  buildPanelCandidateTable, panelTableRounds, panelTableRows, placeCandidateTable, insertBeforeCandidateTable,
  showsCtc, sourceShown, CTC_STAGE_KEYS, CANDIDATE_TABLE_TOKEN, CANDIDATE_TABLE_PLACEHOLDER, EMPTY,
  skippedStagesFromEvents, bookingHeld, journeyRoundEvidence, markHeldRecordings, roundNoteHome,
};
