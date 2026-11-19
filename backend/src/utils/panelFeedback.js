/**
 * U03c · The interview panel's feedback, read for people.
 *
 * Chhaya (18 Nov): the scorecard feedback in the invite "broke in the middle"
 * and should be vertical, with bullet points; the attached report so far was
 * too long to read. This module holds the reading rules both of them share:
 *   - parseRoundNote(): the recruiter's pasted feedback form (rpa_cv
 *     TechRoundOne and friends, "Label<TAB>Value" lines) as bullets, with the
 *     form's bookkeeping lines (dates, email, "applied for") dropped;
 *   - what counts as a concern (a Hold or Reject, a rating below 3 of 5,
 *     "not shortlisted" wording, HR's areas of concern, a Zeko red flag, a
 *     failed assessment), so the email and the report flag the same things;
 *   - panelJourney(): the candidate's journey as one entry per step, for the
 *     report's "At a glance" and "What happened".
 *
 * Nothing here cuts text. A reader of the panel pack sees every word that was
 * recorded, in full.
 *
 * Pure and import-free (tests/unit/panelFeedback.test.js). Used by
 * utils/panelCandidateTable.js (the invite's table) and by the panel cuts of
 * exports/candidateDossier.export.js.
 */

export const RECOMMENDATION_TEXT = Object.freeze({ approve: 'Move forward', hold: 'Hold', reject: 'Reject' });

const blank = (v) => v === null || v === undefined || String(v).trim() === '';
const str = (v) => (blank(v) ? '' : String(v).trim());
const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(typeof v === 'object' ? String(v) : v);
  return Number.isFinite(n) ? n : null;
};
const toTime = (d) => {
  if (!d) return null;
  const t = (d instanceof Date ? d : new Date(d)).getTime();
  return Number.isNaN(t) ? null : t;
};

/** "Overall Status" -> "Overall status"; acronyms ("HR", "BD") are kept. */
export function sentenceCase(label) {
  const words = str(label).split(/\s+/);
  return words.map((w, i) => {
    if (i === 0) return w.charAt(0).toUpperCase() + w.slice(1);
    return w.length > 1 && w === w.toUpperCase() ? w : w.toLowerCase();
  }).join(' ');
}

// ---------------------------------------------------------------------------
// Ratings
// ---------------------------------------------------------------------------

/**
 * A rating on a 5-point scale: 3.5, "3.5", "3.5/5", "7 / 10", "4 out of 5".
 * A bare number above 5 has no scale we can trust, so it is not read.
 * @returns {number|null}
 */
export function ratingOutOf5(v) {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 && v <= 5 ? v : null;
  const s = String(v);
  const scaled = /(\d+(?:\.\d+)?)\s*(?:\/|out of)\s*(\d+(?:\.\d+)?)/i.exec(s);
  if (scaled) {
    const n = Number(scaled[1]);
    const d = Number(scaled[2]);
    return d > 0 && n <= d ? (n / d) * 5 : null;
  }
  const bare = /^\s*(\d+(?:\.\d+)?)\s*$/.exec(s);
  if (bare) {
    const n = Number(bare[1]);
    return n <= 5 ? n : null;
  }
  return null;
}

/** Below 3 out of 5. Exactly 3 is not a concern. */
export function isLowRating(v) {
  const r = ratingOutOf5(v);
  return r !== null && r < 3;
}

/**
 * How a rating is printed: 3.5 -> "3.5/5", "3.5/5" as written, "7/10" as
 * written. `spaced` (the report) prints "3.5 / 5".
 */
export function ratingText(v, { spaced = false } = {}) {
  if (blank(v)) return '';
  const s = typeof v === 'number' || /^\s*\d+(?:\.\d+)?\s*$/.test(String(v)) ? `${num(v)}/5` : str(v);
  const tidy = s.replace(/\s*\/\s*/g, '/');
  return spaced ? tidy.replace(/(\d)\/(\d)/g, '$1 / $2') : tidy;
}

// ---------------------------------------------------------------------------
// What reads as negative
// ---------------------------------------------------------------------------

/**
 * Phrases that read as negative wherever they appear. Whole phrases only: a
 * bare "hold" ("holds a degree") or "concern" ("no concerns") is not one.
 */
const NEGATIVE_PHRASE = /\b(?:not\s+(?:shortlisted|selected|suitable|recommended|cleared|qualified|satisfactory|up\s+to\s+the\s+mark|a\s+(?:good\s+)?fit|fit)|unsuitable|unsatisfactory|rejected|on\s+hold|did\s+not\s+(?:clear|qualify|pass|meet)|below\s+average|needs?\s+improvement|poor|weak|lacks?|lacking)\b/i;

/** A status or verdict value that is negative on its own: "Hold", "Reject", "No". */
const NEGATIVE_STATUS = /^(?:reject(?:ed)?|hold|on\s*hold|not\s+shortlisted|not\s+selected|not\s+recommended|not\s+suitable|no|fail(?:ed)?)\.?$/i;

/** Labels whose value is a decision: "Overall Status", "Final Feedback", "Recommended?". */
const DECISION_LABEL = /status|final|verdict|result|decision|outcome|recommend|shortlist|selected|proceed|next\s+round|hire/i;

/** "None", "N/A", "-": an empty answer, not a concern. */
const NOTHING = /^(?:none|nil|na|n\/a|no|nothing|no\s+concerns?|not\s+applicable|-+|—)\.?$/i;

export function isNegativeText(text) {
  return !blank(text) && NEGATIVE_PHRASE.test(String(text));
}

export function isNegativeStatus(text) {
  return !blank(text) && NEGATIVE_STATUS.test(str(text));
}

export function isNegativeRecommendation(rec) {
  return /^(?:reject(?:ed)?|hold|on[_\s]?hold)$/i.test(str(rec));
}

export function isFailResult(result) {
  return /\bfail(?:ed)?\b/i.test(str(result));
}

/** A Hold or Reject, or an average below 3. */
export function verdictOf(f) {
  const rec = str(f?.recommendation).toLowerCase();
  const average = num(f?.average);
  return {
    label: RECOMMENDATION_TEXT[rec] || (rec ? sentenceCase(rec.replace(/_/g, ' ')) : null),
    tone: rec === 'approve' ? 'ok' : rec === 'hold' ? 'hold' : rec === 'reject' ? 'bad' : null,
    average,
    lowAverage: isLowRating(average),
    concern: isNegativeRecommendation(rec) || isLowRating(average),
  };
}

// ---------------------------------------------------------------------------
// The recruiter's pasted feedback form
// ---------------------------------------------------------------------------

/**
 * The form's bookkeeping: the same facts the table's own rows already give
 * (dates, the candidate's email and name, the role, the round, the
 * interviewer), or contact details that must not travel to a panel.
 */
const BOOKKEEPING = new Set([
  'submission date', 'feedback submission date', 'timestamp', 'date',
  'email', 'email id', 'email address', 'candidate email', 'candidate email id', 'e-mail',
  'phone', 'phone number', 'mobile', 'mobile number', 'contact', 'contact number',
  'interview date', 'date of interview',
  'applied for', 'position applied for', 'position', 'role applied for',
  'interview round', 'round',
  'interviewer', 'interviewer name', 'name of interviewer', 'interviewer email',
  'candidate name', 'name of candidate', 'name',
]);
const SKILL_LABEL = /^(?:skill|competency|skill\s*\/\s*competency|skills?\s*\/\s*competenc(?:y|ies))\s*\d*$/i;
const RATING_LABEL = /^(?:rating|score|marks?)$/i;
const FEEDBACK_LABEL = /^(?:feedback|remarks?|comments?|notes?|observations?)$/i;
const X_RATING = /^(.+?)\s+(?:rating|score)$/i;
const X_FEEDBACK = /^(.+?)\s+(?:feedback|remarks?|comments?)$/i;

/** "Label<TAB>Value", or a short "Label: Value". Anything else is prose. */
function splitLine(line) {
  let m = /^([^\t]+?)\t+(.*)$/.exec(line);
  if (m) return { label: m[1].trim(), value: m[2].trim() };
  m = /^([A-Za-z][A-Za-z0-9 /&()'’.-]{0,48}?)\s*:\s+(.+)$/.exec(line);
  if (m && m[1].trim().split(/\s+/).length <= 6) return { label: m[1].trim(), value: m[2].trim() };
  return null;
}

function noteConcern(item) {
  if (isLowRating(item.rating)) return true;
  if (item.label && /rating|score/i.test(item.label) && isLowRating(item.text)) return true;
  if (item.label && DECISION_LABEL.test(item.label) && isNegativeStatus(item.text)) return true;
  return isNegativeText(item.text);
}

/**
 * A recorded round note as bullets: [{label, rating, text, concern}].
 *
 *   Skill/Competency 1  Business Analyst      ->  Business Analyst — 3.5/5: Offered…
 *   Rating              3.5/5
 *   Feedback            Offered…
 *
 *   Communication Skills Rating    3.5/5      ->  Communication Skills — 3.5/5: …good.
 *   Communication Skills Feedback  …good.
 *
 *   Overall Status      Shortlisted          ->  Overall status: Shortlisted
 *
 * "X Rating" and "X Feedback" merge only when the note has both, so "Final
 * Feedback" and "Overall Rating" stay items of their own. A note with no
 * "Label<TAB>Value" structure at all is one item holding the whole text.
 *
 * @param {string|null} text
 * @returns {Array<{label: string|null, rating: string|null, text: string|null, concern: boolean}>}
 */
export function parseRoundNote(text) {
  const raw = str(text);
  if (!raw) return [];
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const parsed = lines.map((line) => ({ line, kv: splitLine(line) }));
  if (!parsed.some((p) => p.kv)) {
    const item = { label: null, rating: null, text: raw };
    return [{ ...item, concern: noteConcern(item) }];
  }

  // "X" names that have both an "X Rating" and an "X Feedback" line.
  const rated = new Set();
  const remarked = new Set();
  for (const { kv } of parsed) {
    if (!kv || SKILL_LABEL.test(kv.label)) continue;
    const r = X_RATING.exec(kv.label);
    if (r) rated.add(r[1].trim().toLowerCase());
    const f = X_FEEDBACK.exec(kv.label);
    if (f) remarked.add(f[1].trim().toLowerCase());
  }
  const merges = new Set([...rated].filter((x) => remarked.has(x)));

  const items = [];
  const byName = new Map();
  let group = null; // an open "Skill/Competency N" block
  let last = null; // where a continuation line goes
  let dropping = false; // inside a bookkeeping value
  for (const { line, kv } of parsed) {
    if (!kv) {
      if (dropping) continue;
      if (last) {
        last.text = last.text ? `${last.text}\n${line}` : line;
      } else {
        last = { label: null, rating: null, text: line };
        items.push(last);
      }
      continue;
    }
    dropping = false;
    const key = kv.label.toLowerCase().replace(/\s+/g, ' ');
    if (BOOKKEEPING.has(key)) {
      group = null;
      last = null;
      dropping = true;
      continue;
    }
    if (SKILL_LABEL.test(kv.label)) {
      group = { label: kv.value || sentenceCase(kv.label), rating: null, text: null };
      items.push(group);
      last = null;
      continue;
    }
    if (group && RATING_LABEL.test(kv.label)) {
      group.rating = kv.value || null;
      continue;
    }
    if (group && FEEDBACK_LABEL.test(kv.label)) {
      group.text = kv.value || null;
      last = group;
      continue;
    }
    group = null;
    const r = X_RATING.exec(kv.label);
    const f = X_FEEDBACK.exec(kv.label);
    const name = (r || f)?.[1]?.trim();
    if (name && merges.has(name.toLowerCase())) {
      let item = byName.get(name.toLowerCase());
      if (!item) {
        item = { label: name, rating: null, text: null };
        byName.set(name.toLowerCase(), item);
        items.push(item);
      }
      if (r) {
        item.rating = kv.value || null;
        last = null;
      } else {
        item.text = kv.value || null;
        last = item;
      }
      continue;
    }
    if (!kv.value) {
      last = null;
      continue;
    }
    last = { label: sentenceCase(kv.label), rating: null, text: kv.value };
    items.push(last);
  }
  return items
    .filter((i) => i.rating || i.text || i.label)
    .map((i) => ({ ...i, concern: noteConcern(i) }));
}

/**
 * The interviewer a pasted form names ("Interviewer<TAB>Vivek Chhibber"). The
 * line is dropped from the bullets; a round with no scorecard uses it as its
 * heading instead.
 */
export function noteInterviewer(text) {
  for (const line of str(text).split(/\r?\n/)) {
    const kv = splitLine(line.trim());
    if (kv && /^(?:interviewer|interviewer name|name of interviewer)$/i.test(kv.label) && kv.value) return kv.value;
  }
  return null;
}

/** One note item as a line. */
export function noteItemText(item, { spaced = false } = {}) {
  const rating = item.rating ? ratingText(item.rating, { spaced }) : '';
  const asRating = item.label && /rating|score/i.test(item.label) && /^\s*\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?\s*$/.test(str(item.text));
  const value = asRating ? ratingText(item.text, { spaced }) : str(item.text);
  if (item.label && rating && value) return `${item.label} — ${rating}: ${value}`;
  if (item.label && rating) return `${item.label}: ${rating}`;
  if (item.label && value) return `${item.label}: ${value}`;
  return item.label || value;
}

// ---------------------------------------------------------------------------
// One interviewer's feedback
// ---------------------------------------------------------------------------

/** The HR scorecard's narrative fields (never the CTC ones), in reading order. */
export const HR_FIELDS = Object.freeze([
  ['strengths', 'Strengths'],
  ['weakness', 'Areas of concern'],
  ['communication_comments', 'Communication'],
  ['attitude_comments', 'Attitude'],
  ['relocation', 'Relocation'],
  ['notice_period', 'Notice period'],
  ['other_observation', 'Other observations'],
  ['final_feedback', 'Final feedback'],
]);

/**
 * One interviewer's feedback as items: skill ratings, comments, HR fields.
 * `prefix: false` on HR's "Areas of concern": its label already says it.
 *
 * @param {{skills?: Array<{label, rating, remark}>, comments?: string, hr?: object}} f
 * @returns {Array<{kind: 'skill'|'comments'|'hr', label: string|null, text: string, concern: boolean, prefix: boolean}>}
 */
export function feedbackItems(f, { spaced = false } = {}) {
  const out = [];
  for (const s of f?.skills || []) {
    if (blank(s?.label) && blank(s?.rating) && blank(s?.remark)) continue;
    const rating = blank(s.rating) ? '' : ratingText(s.rating, { spaced });
    out.push({
      kind: 'skill',
      label: null,
      text: `${str(s.label) || 'Skill'}${rating ? `: ${rating}` : ''}${blank(s.remark) ? '' : ` — ${str(s.remark)}`}`,
      concern: isLowRating(s.rating) || isNegativeText(s.remark),
      prefix: true,
    });
  }
  if (!blank(f?.comments)) {
    out.push({ kind: 'comments', label: 'Comments', text: str(f.comments), concern: isNegativeText(f.comments), prefix: true });
  }
  for (const [key, label] of HR_FIELDS) {
    const v = f?.hr?.[key];
    if (blank(v)) continue;
    const weakness = key === 'weakness';
    out.push({
      kind: 'hr',
      label,
      text: str(v),
      concern: weakness ? !NOTHING.test(str(v)) : (isNegativeText(v) || (key === 'final_feedback' && isNegativeStatus(v))),
      prefix: !weakness,
    });
  }
  return out;
}

/** An item as a line: "Comments: …", "Business Development: 3.5/5". */
export function itemLine(item) {
  return item.label ? `${item.label}: ${item.text}` : item.text;
}

// ---------------------------------------------------------------------------
// The journey so far
// ---------------------------------------------------------------------------

/** Zeko's round names, by stage. */
const ZEKO_ROUND_BY_STAGE = Object.freeze({ zeko_hr: 'HR screening', zeko_fn: 'Functional screening' });
const STAGE_BY_ZEKO_ROUND = Object.freeze({ 'HR screening': 'zeko_hr', 'Functional screening': 'zeko_fn' });

/** The step strip's short names. */
const SHORT_LABEL = Object.freeze({ zeko_hr: 'HR screening', zeko_fn: 'Functional screening', assessment: 'Assessment' });

/**
 * A round's name when the model has nothing labelled with it yet (the pack's
 * own round, before its booking): config/pipelineStages.js STAGE_LABELS.
 */
const ROUND_LABEL = Object.freeze({
  tech1: 'Technical Round 1',
  tech2: 'Technical Round 2',
  tech3: 'Technical Round 3',
  hr_round: 'HR Round',
  ceo: 'CEO / Final Round',
  client: 'Client Interview',
});

/**
 * Progress notes that are part of the story. Everything else the timeline
 * carries as a 'note' is the system talking to itself: recording opened,
 * dossier downloaded, share link created, scorecard link sent, confirmed held,
 * an external viewer's IP address.
 */
const CANCELLED_NOTE = /interview cancelled:?\s*(.*)$/i;
const NO_SHOW_NOTE = /\bno[- ]?show\b|did not take place|didn['’]t happen/i;

/** A Zeko report's list item as text (the vendor's lists are not always strings). */
function listItemText(i) {
  if (blank(i)) return '';
  if (typeof i !== 'object') return str(i);
  return Object.values(i).filter((v) => typeof v === 'string' && v.trim()).join(' — ');
}

/** Zeko's own red flags for a round, when its report reached the model. */
export function zekoRedFlags(z) {
  return (z?.report_detail?.red_flags || []).map(listItemText).filter(Boolean);
}

/** The quote line under an interview: a whole field, never cut. */
const QUOTE_MAX = 200;
function quoteFor(feedback, noteItems) {
  const fromNote = noteItems.find((i) => i.label && /final feedback|overall feedback|summary/i.test(i.label) && i.text);
  if (fromNote) return str(fromNote.text);
  for (const f of feedback) {
    if (!blank(f?.hr?.final_feedback)) return str(f.hr.final_feedback);
  }
  for (const f of feedback) {
    if (!blank(f?.comments) && str(f.comments).length <= QUOTE_MAX) return str(f.comments);
  }
  return null;
}

/**
 * The candidate's journey, one entry per step, oldest first: screenings and
 * assessments with their decision, each interview booking (held, cancelled,
 * no-show) with its feedback, recording and the decision that moved the
 * candidate on, and last the round this pack is for. An earlier role's rounds
 * (U07) come first, as they happened first.
 *
 * Built from the existing model only: `stages` (decisions; the cancelled and
 * no-show notes), `interviews`, `recordings`, `zeko`, `assessments`,
 * `consolidated_by_interviewer` and `round_notes`.
 *
 * @param {object} model - the panel's dossier model
 * @param {{ stageKey?: string|null }} [options] - the round the pack is for
 * @returns {Array<object>} entries: {kind: 'screening'|'assessment'|'step'|'interview'|'cancelled'|'no_show'|'this_round',
 *   stage_key, stage_label, date, interviewer, feedback[], note_items[], recordings[], decision, reason,
 *   score, result, earlier_role, earlier_attempt, held, quote, concern}
 */
export function panelJourney(model, { stageKey = null } = {}) {
  if (!model) return [];
  const current = [];
  const earlier = [];
  const sameStage = (e, key, label) => (key ? e.stage_key === key : e.stage_label === label);
  const blankEntry = (o) => ({
    kind: 'step', stage_key: null, stage_label: null, date: null, interviewer: null, feedback: [], note_items: [],
    recordings: [], decision: null, reason: null, score: null, result: null, earlier_role: null, earlier_seq: null,
    earlier_attempt: false, held: false, ...o,
  });

  // Decisions: the latest per stage. Cancellation and no-show reasons, in order.
  const stageEvents = model.stages || [];
  const keyOf = (s) => s.stage_key || null;
  const decisions = new Map();
  const cancelReasons = new Map();
  for (const s of stageEvents) {
    const k = keyOf(s) || s.stage_label;
    if (['outcome', 'advance', 'closure'].includes(s.event_type)) {
      decisions.set(k, {
        stage_key: keyOf(s), stage_label: s.stage_label, outcome: s.outcome || (s.event_type === 'advance' ? 'moved on' : s.event_type),
        by: s.decided_by || null, at: s.decided_at || null, reason: s.reason || null,
      });
    } else if (s.event_type === 'note') {
      const m = CANCELLED_NOTE.exec(str(s.notes));
      if (m) {
        if (!cancelReasons.has(k)) cancelReasons.set(k, []);
        cancelReasons.get(k).push(m[1].trim() || null);
      }
    }
  }

  // The round this pack is for: its latest live booking.
  const live = (b) => !(b.status === 'cancelled' || b.cancelled_at) && !(b.occurrence === 'no_show' || b.status === 'no_show');
  const ownBookings = (model.interviews || []).filter((b) => stageKey && b.stage_key === stageKey && live(b));
  const thisBooking = ownBookings[ownBookings.length - 1] || null;

  // 1) Bookings.
  const bySchedule = new Map();
  const reasonsUsed = new Map();
  for (const b of model.interviews || []) {
    const cancelled = b.status === 'cancelled' || Boolean(b.cancelled_at);
    const noShow = b.occurrence === 'no_show' || b.status === 'no_show';
    const k = b.stage_key || b.stage_label;
    let reason = null;
    if (cancelled) {
      const used = reasonsUsed.get(k) || 0;
      reason = (cancelReasons.get(k) || [])[used] ?? null;
      reasonsUsed.set(k, used + 1);
    }
    const e = blankEntry({
      kind: b === thisBooking ? 'this_round' : cancelled ? 'cancelled' : noShow ? 'no_show' : 'interview',
      stage_key: b.stage_key || null,
      stage_label: b.stage_label,
      date: b.scheduled_start_at || null,
      interviewer: b.interviewer || null,
      reason,
      earlier_attempt: Boolean(b.earlier_attempt),
      held: b.occurrence === 'held',
      no_show_party: b.no_show_party || null,
    });
    current.push(e);
    if (b.schedule_id != null) bySchedule.set(String(b.schedule_id), e);
  }
  const lastInterview = (key, label) => [...current].reverse()
    .find((e) => e.kind === 'interview' && sameStage(e, key, label)) || null;

  // 2) Named feedback: on its booking, else on the round's last interview.
  for (const f of model.consolidated_by_interviewer || []) {
    if (f.earlier_role) {
      let e = earlier.find((x) => x.stage_label === f.round && x.earlier_seq === (f.earlier_seq ?? 0));
      if (!e) {
        e = blankEntry({
          kind: 'interview', stage_label: f.round, date: f.submitted_at || null, earlier_role: f.earlier_role, earlier_seq: f.earlier_seq ?? 0, held: true,
        });
        earlier.push(e);
      }
      e.feedback.push(f);
      continue;
    }
    // Feedback on the round this pack is for (a pack re-sent after it) stays
    // on that round's entry, out of the earlier rounds' story.
    const own = stageKey && f.stage_key === stageKey ? current.find((x) => x.kind === 'this_round') : null;
    let e = own || (f.schedule_id != null && bySchedule.get(String(f.schedule_id))) || lastInterview(f.stage_key, f.round);
    if (!e || e.kind === 'cancelled' || e.kind === 'no_show') {
      e = blankEntry({ kind: 'interview', stage_key: f.stage_key || null, stage_label: f.round, date: f.submitted_at || null });
      current.push(e);
    }
    e.feedback.push(f);
    e.held = true;
    if (!e.interviewer && f.interviewer) e.interviewer = f.interviewer;
  }

  // 3) Recordings of bookings that took place.
  for (const r of model.recordings || []) {
    if (r.booking_held === false) continue;
    const rec = { url: r.share_url || null, duration_seconds: r.duration_seconds ?? null, recorded_start_at: r.recorded_start_at || null };
    if (r.earlier_role) {
      let e = earlier.find((x) => x.stage_label === r.stage_label && x.earlier_seq === (r.earlier_seq ?? 0));
      if (!e) {
        e = blankEntry({
          kind: 'interview', stage_label: r.stage_label, date: r.recorded_start_at || null, earlier_role: r.earlier_role, earlier_seq: r.earlier_seq ?? 0, held: true,
        });
        earlier.push(e);
      }
      e.recordings.push(rec);
      continue;
    }
    let e = (r.schedule_id != null && bySchedule.get(String(r.schedule_id))) || lastInterview(r.stage_key, r.stage_label);
    if (!e || e.kind === 'cancelled' || e.kind === 'no_show') {
      e = blankEntry({ kind: 'interview', stage_key: r.stage_key || null, stage_label: r.stage_label, date: r.recorded_start_at || null });
      current.push(e);
    }
    e.recordings.push(rec);
    e.held = true;
  }

  // 4) The recruiter's round notes.
  for (const n of model.round_notes || []) {
    const items = parseRoundNote(n.value);
    if (!items.length) continue;
    let e = lastInterview(n.stage_key, n.stage_label);
    if (!e) {
      const d = decisions.get(n.stage_key) || decisions.get(n.stage_label);
      e = blankEntry({ kind: 'interview', stage_key: n.stage_key || null, stage_label: n.stage_label, date: d?.at || null });
      current.push(e);
    }
    e.note_items.push(...items);
  }

  // 5) Screenings and assessments: scores, then the decisions on stages with
  // no booking.
  const zekoFor = (key) => (model.zeko || []).find((z) => !z.earlier_role && z.round === ZEKO_ROUND_BY_STAGE[key]);
  for (const z of model.zeko || []) {
    if (z.overall_score === null || z.overall_score === undefined) continue;
    if (z.earlier_role) {
      earlier.push(blankEntry({
        kind: 'screening', stage_label: z.round, date: z.taken_at || null, score: z.overall_score, earlier_role: z.earlier_role,
        earlier_seq: z.earlier_seq ?? 0, red_flags: zekoRedFlags(z),
      }));
      continue;
    }
    const key = STAGE_BY_ZEKO_ROUND[z.round] || null;
    const d = key ? decisions.get(key) : null;
    current.push(blankEntry({
      kind: 'screening', stage_key: key, stage_label: d?.stage_label || z.round, date: z.taken_at || d?.at || null,
      score: z.overall_score, red_flags: zekoRedFlags(z),
    }));
  }
  for (const a of model.assessments || []) {
    const pct = a.overall_percentage;
    const result = [pct !== null && pct !== undefined ? `${pct}%` : null, a.result || null].filter(Boolean).join(' · ') || null;
    if (a.earlier_role) {
      earlier.push(blankEntry({
        kind: 'assessment', stage_label: a.test_name || 'Assessment', result, failed: isFailResult(a.result),
        earlier_role: a.earlier_role, earlier_seq: a.earlier_seq ?? 0,
      }));
      continue;
    }
    const d = decisions.get('assessment');
    current.push(blankEntry({
      kind: 'assessment', stage_key: 'assessment', stage_label: d?.stage_label || a.test_name || 'Assessment', test_name: a.test_name || null,
      date: d?.at || null, result, failed: isFailResult(a.result),
    }));
  }

  // 6) Decisions: on the stage's last entry that took place, else a step of
  // their own (a screening with no score, an assessment with no result).
  for (const [k, d] of decisions) {
    const key = d.stage_key || null;
    const candidates = current.filter((e) => (key ? e.stage_key === key : e.stage_label === k)
      && !['cancelled', 'no_show', 'this_round'].includes(e.kind));
    const target = candidates[candidates.length - 1];
    if (target) {
      target.decision = d;
      continue;
    }
    if (key && key === stageKey) continue; // the round this pack is for: no step of its own
    const kind = ZEKO_ROUND_BY_STAGE[key] ? 'screening' : key === 'assessment' ? 'assessment' : 'step';
    current.push(blankEntry({
      kind, stage_key: key, stage_label: d.stage_label, date: d.at, decision: d,
      score: kind === 'screening' ? (zekoFor(key)?.overall_score ?? null) : null,
    }));
  }

  // 7) The round this pack is for, when it has no booking yet.
  if (stageKey && !current.some((e) => e.kind === 'this_round')) {
    const label = (model.status?.stage_key === stageKey && model.status?.stage_label)
      || (model.interviews || []).find((b) => b.stage_key === stageKey)?.stage_label
      || stageEvents.find((s) => s.stage_key === stageKey)?.stage_label
      || ROUND_LABEL[stageKey]
      || stageKey;
    current.push(blankEntry({ kind: 'this_round', stage_key: stageKey, stage_label: label }));
  }

  for (const e of [...earlier, ...current]) {
    e.quote = e.kind === 'interview' ? quoteFor(e.feedback, e.note_items) : null;
    e.concern = entryConcern(e);
  }

  const order = (list) => list
    .map((e, i) => ({ e, i, t: toTime(e.date) }))
    .sort((a, b) => {
      const ra = a.e.kind === 'this_round' ? 1 : 0;
      const rb = b.e.kind === 'this_round' ? 1 : 0;
      if (ra !== rb) return ra - rb;
      if ((a.e.earlier_seq ?? 0) !== (b.e.earlier_seq ?? 0)) return (a.e.earlier_seq ?? 0) - (b.e.earlier_seq ?? 0);
      // Undated steps sit after the dated ones, in the order they were found.
      const ta = a.t ?? Number.MAX_SAFE_INTEGER;
      const tb = b.t ?? Number.MAX_SAFE_INTEGER;
      return ta - tb || a.i - b.i;
    })
    .map(({ e }) => e);
  return [...order(earlier), ...order(current)];
}

const NEGATIVE_OUTCOME = /reject|hold|withdrawn|dropped|not\s+selected/i;

/** Does a journey entry carry a concern? */
export function entryConcern(e) {
  if (!e) return false;
  if (e.feedback?.some((f) => verdictOf(f).concern || feedbackItems(f).some((i) => i.concern))) return true;
  if (e.note_items?.some((i) => i.concern)) return true;
  if (e.decision && NEGATIVE_OUTCOME.test(str(e.decision.outcome))) return true;
  if (e.failed || (e.red_flags || []).length) return true;
  return false;
}

/** How strongly an entry is flagged: 'bad' (reject, fail), 'hold', or null. */
export function entryTone(e) {
  if (!e) return null;
  const tones = (e.feedback || []).map((f) => verdictOf(f).tone);
  if (tones.includes('bad') || e.failed || /reject/i.test(str(e.decision?.outcome))) return 'bad';
  if (tones.includes('hold') || /hold/i.test(str(e.decision?.outcome))) return 'hold';
  if (e.concern) return 'hold';
  return null;
}

/**
 * The "At a glance" step strip: one step per stage this journey reached, in
 * journey order, ending with this round. Cancelled and no-show bookings are
 * not steps.
 * @returns {Array<{stage_key, label, date, score: string|null, state: 'done'|'hold'|'bad'|'now'|'pending'}>}
 */
export function journeyStrip(entries) {
  const steps = [];
  const byKey = new Map();
  for (const e of entries || []) {
    if (e.earlier_role || e.kind === 'cancelled' || e.kind === 'no_show' || e.earlier_attempt) continue;
    const k = e.stage_key || e.stage_label;
    let s = byKey.get(k);
    if (!s) {
      s = { stage_key: e.stage_key, label: SHORT_LABEL[e.stage_key] || e.stage_label, date: null, entries: [] };
      byKey.set(k, s);
      steps.push(s);
    }
    s.entries.push(e);
    s.date = e.date || s.date;
  }
  return steps.map((s) => {
    const last = s.entries[s.entries.length - 1];
    if (s.entries.some((e) => e.kind === 'this_round')) {
      return { stage_key: s.stage_key, label: s.label, date: s.date, score: 'This round', state: 'now' };
    }
    const tone = s.entries.map(entryTone).find(Boolean) || null;
    const feedback = s.entries.flatMap((e) => e.feedback);
    const avgs = feedback.map((f) => num(f.average)).filter((n) => n !== null);
    const mean = avgs.length ? Math.round((avgs.reduce((a, b) => a + b, 0) / avgs.length) * 100) / 100 : null;
    const verdicts = [...new Set(feedback.map((f) => verdictOf(f)).filter((v) => v.tone && v.tone !== 'ok').map((v) => v.label))];
    let score = null;
    if (mean !== null) score = `${verdicts.length ? `${verdicts.join(' · ')} · ` : ''}${mean} / 5`;
    else if (verdicts.length) score = verdicts.join(' · ');
    else if (feedback.length) score = verdictOf(feedback[0]).label;
    else if (last.score !== null && last.score !== undefined) score = String(last.score);
    else if (last.result) score = last.result;
    const reached = s.entries.some((e) => e.held || e.feedback.length || e.decision || e.note_items.length
      || (e.score !== null && e.score !== undefined) || e.result);
    return {
      stage_key: s.stage_key, label: s.label, date: s.date, score, state: tone === 'bad' ? 'bad' : tone === 'hold' ? 'hold' : reached ? 'done' : 'pending',
    };
  });
}

/**
 * Every concern in the earlier rounds, for the report's Concerns box:
 * [{round, text}], in journey order, each once.
 *
 * @param {object} model
 * @param {{ excludeStageKey?: string|null }} [options] - the pack's own round
 */
export function collectConcerns(model, { excludeStageKey = null } = {}) {
  const out = [];
  const seen = new Set();
  const add = (round, text) => {
    const key = `${round}\u0000${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ round: round || 'Earlier round', text });
  };
  for (const z of model?.zeko || []) {
    for (const flag of zekoRedFlags(z)) add(z.round, `Zeko red flag: "${flag}"`);
    if (isNegativeStatus(z.report_detail?.verdict) || isNegativeText(z.report_detail?.verdict)) add(z.round, `Zeko verdict: ${str(z.report_detail.verdict)}`);
  }
  for (const a of model?.assessments || []) {
    if (!isFailResult(a.result)) continue;
    const pct = a.overall_percentage;
    add(a.test_name || 'Assessment', `${pct !== null && pct !== undefined ? `${pct}% · ` : ''}${str(a.result)}.`);
  }
  for (const f of model?.consolidated_by_interviewer || []) {
    if (excludeStageKey && f.stage_key === excludeStageKey) continue;
    const v = verdictOf(f);
    if (v.concern) {
      const who = f.interviewer || 'The interviewer';
      const avg = v.average !== null ? `avg ${v.average} / 5` : null;
      add(f.round, v.tone === 'hold' || v.tone === 'bad'
        ? `${who} recommends ${v.label}${avg ? `, ${avg}` : ''}.`
        : `${who} scored ${avg}${v.label ? ` (${v.label})` : ''}.`);
    }
    for (const item of feedbackItems(f, { spaced: true })) if (item.concern) add(f.round, itemLine(item));
  }
  for (const n of model?.round_notes || []) {
    if (excludeStageKey && n.stage_key === excludeStageKey) continue;
    for (const item of parseRoundNote(n.value)) if (item.concern) add(n.stage_label || n.stage_key, noteItemText(item, { spaced: true }));
  }
  // The latest decision of each stage, when it is a rejection or a hold.
  const latest = new Map();
  for (const s of model?.stages || []) {
    if (['outcome', 'advance', 'closure'].includes(s.event_type)) latest.set(s.stage_key || s.stage_label, s);
  }
  for (const s of latest.values()) {
    if (excludeStageKey && s.stage_key === excludeStageKey) continue;
    if (NEGATIVE_OUTCOME.test(str(s.outcome))) add(s.stage_label, `Decision: ${str(s.outcome)}${s.reason ? `, ${str(s.reason)}` : ''}.`);
  }
  return out;
}

/**
 * The "In short" line, written by rules: how many steps are done, what the
 * interviewers recommend, and how many concerns follow.
 */
export function journeySummary(strip, concerns, entries) {
  const done = (strip || []).filter((s) => s.state !== 'now' && s.state !== 'pending');
  if (!done.length) return 'No earlier steps recorded yet.';
  const flagged = done.some((s) => s.state === 'bad' || s.state === 'hold');
  const n = done.length;
  const lead = flagged
    ? `${n} step${n === 1 ? '' : 's'} done so far`
    : `Cleared ${n === 1 ? 'the first step' : `all ${n} steps`} so far`;
  const feedback = (entries || []).filter((e) => !e.earlier_role && e.kind !== 'this_round')
    .flatMap((e) => e.feedback.map((f) => ({ f, round: e.stage_label })));
  const c = (concerns || []).length;
  if (!c) {
    const recs = feedback.map(({ f }) => str(f.recommendation).toLowerCase()).filter(Boolean);
    if (recs.length && recs.every((r) => r === 'approve')) {
      const who = recs.length === 1 ? 'the interviewer recommends' : recs.length === 2 ? 'both interviewers recommend' : `all ${recs.length} interviewers recommend`;
      return `${lead}, and ${who} moving forward.`;
    }
    return `${lead}.`;
  }
  const negative = feedback.filter(({ f }) => ['hold', 'reject'].includes(str(f.recommendation).toLowerCase()))
    .map(({ f, round }) => `${round} recommends ${RECOMMENDATION_TEXT[str(f.recommendation).toLowerCase()]}`);
  const tail = `${c} concern${c === 1 ? ' is' : 's are'} listed below.`;
  return `${lead}. ${negative.length ? `${[...new Set(negative)].join('; ')}, and ${tail}` : tail.charAt(0).toUpperCase() + tail.slice(1)}`;
}

export default {
  RECOMMENDATION_TEXT,
  HR_FIELDS,
  sentenceCase,
  ratingOutOf5,
  isLowRating,
  ratingText,
  isNegativeText,
  isNegativeStatus,
  isNegativeRecommendation,
  isFailResult,
  verdictOf,
  parseRoundNote,
  noteInterviewer,
  noteItemText,
  feedbackItems,
  itemLine,
  zekoRedFlags,
  panelJourney,
  entryConcern,
  entryTone,
  journeyStrip,
  collectConcerns,
  journeySummary,
};
