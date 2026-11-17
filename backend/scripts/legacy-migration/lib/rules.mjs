// Value rules V1 to V12 of docs/Phase 4/PLAN-MS-Access-Data-Migration-Mapping.md (3.7).
// Pure functions: no database, no file access. A cell is [kind, value] as written by
// 1-extract-access.ps1 (kind s = text, n = number, d = date, b = boolean).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; // same check as hrUpload.service.js

/** Trimmed text of a cell; whitespace-only becomes '' (V12). */
export const text = (cell) => (cell ? String(cell[1]).replace(/ /g, ' ').trim() : '');

const isNum = (s) => /^-?\d+(\.\d+)?$/.test(s);
const trimNum = (n) => String(+Number(n).toFixed(2));

/** V1. Returns { date: 'YYYY-MM-DD' | null, warn: string | null }. */
export function parseDate(cell, today = new Date()) {
  const s = text(cell);
  if (!s) return { date: null, warn: null };
  let y; let m; let d; let swapped = false;
  if (cell[0] === 'd') {
    [y, m, d] = s.slice(0, 10).split('-').map(Number);
  } else if (/^\d{5}$/.test(s)) {
    // Excel serial number: days since 1899-12-30.
    const dt = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000);
    y = dt.getUTCFullYear(); m = dt.getUTCMonth() + 1; d = dt.getUTCDate();
  } else {
    const mm = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?!\d)/);
    if (!mm) return { date: null, warn: 'date_unreadable' };
    d = Number(mm[1]); m = Number(mm[2]); y = Number(mm[3]);
    if (y < 100) y += 2000;
    if (m > 12 && d <= 12) { [d, m] = [m, d]; swapped = true; } // written month-first
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return { date: null, warn: 'date_unreadable' };
  if (y < 2015 || dt.getTime() > today.getTime()) return { date: null, warn: 'date_out_of_range' };
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return { date: iso, warn: swapped ? 'date_month_first' : null };
}

const FAKE_PHONE = /^(\d)\1{9}$|^1234567890$|^0123456789$/;
function normPhone(digits) {
  let d = digits;
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 13 && d.startsWith('091')) d = d.slice(3);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^\d{10}$/.test(d) && !FAKE_PHONE.test(d) ? d : null;
}
/** V2. Returns { list: string[], dropped: number } with valid 10-digit numbers only. */
export function parsePhones(cell) {
  const s = text(cell);
  const out = []; let dropped = 0;
  for (const piece of s.split(/[,/;|\n\r]+/)) {
    const p = piece.trim();
    const digits = p.replace(/\D/g, '');
    if (!digits) continue;
    const whole = normPhone(digits); // "98765 43210" and "987-654-3210" are one number
    if (whole) { out.push(whole); continue; }
    const parts = p.split(/\s+/).map((t) => t.replace(/\D/g, '')).filter(Boolean).map(normPhone);
    const good = parts.filter(Boolean);
    out.push(...good);
    dropped += good.length ? parts.length - good.length : 1;
  }
  return { list: [...new Set(out)], dropped };
}

/** V3. Returns { list: string[], dropped: number }. */
export function parseEmails(cell) {
  const s = text(cell).toLowerCase();
  const out = []; let dropped = 0;
  for (const piece of s.split(/[,;/|\s]+/)) {
    const e = piece.replace(/^[<(["']+|[>)\]"'.,:]+$/g, '');
    if (!e) continue;
    if (EMAIL_RE.test(e)) out.push(e); else dropped++;
  }
  return { list: [...new Set(out)], dropped };
}

/** V4. Display text for an experience cell: "5 . 6 ." becomes "5.6". */
export function cleanExperience(cell) {
  let s = text(cell);
  if (!s) return { value: '', warn: null };
  const m = s.match(/^(\d+)\s*\.\s*(\d+)\s*\.?$/) || s.match(/^(\d+)\s*\.$/);
  if (m) s = m[2] !== undefined ? `${m[1]}.${m[2]}` : m[1];
  if (isNum(s)) {
    const n = Number(s);
    if (n < 0 || n > 60) return { value: '', warn: 'experience_out_of_range' };
    return { value: trimNum(n), warn: null };
  }
  return { value: s, warn: 'experience_not_a_number' };
}

/** V5. CTC / ECTC in LPA. A value above 1,000 is a full rupee amount. */
export function cleanCtc(cell) {
  const s = text(cell).replace(/[₹$,]/g, '').trim();
  if (!s) return { value: '', warn: null };
  const m = s.match(/^(\d+(?:\.\d+)?)\s*\+?\s*(?:l|lac|lacs|lakh|lakhs|lpa|l\.p\.a\.?|lpa\.|pa|p\.a\.?)?\.?$/i);
  if (m) {
    let n = Number(m[1]);
    let warn = null;
    if (n > 1000) { n /= 100000; warn = 'ctc_rupees_converted'; }
    return { value: trimNum(n), warn };
  }
  if (!/\d/.test(s)) return { value: '', warn: 'ctc_words_only' };
  return { value: s, warn: 'ctc_kept_as_written' };
}

/** Notice period: a number becomes "30 days". */
export function cleanNotice(cell) {
  const s = text(cell);
  if (!s) return { value: '', warn: null };
  if (isNum(s)) {
    const n = Number(s);
    if (n < 0 || n > 365) return { value: '', warn: 'notice_out_of_range' };
    return { value: `${trimNum(n)} days`, warn: null };
  }
  return { value: s, warn: null };
}

/** V7. Heat as written; above 10 is reported. */
export function cleanHeat(cell) {
  const s = text(cell);
  if (!s) return { value: '', warn: null };
  return { value: isNum(s) ? trimNum(s) : s, warn: isNum(s) && Number(s) > 10 ? 'heat_above_10' : null };
}

/** V8. A plain number gets the header's denominator ("18/25"); anything else as written. */
export function cleanScore(cell, den) {
  const s = text(cell);
  if (!s) return { value: '', warn: null };
  if (isNum(s)) {
    if (den && Number(s) > Number(den)) return { value: trimNum(s), warn: 'score_above_maximum' };
    return { value: den ? `${trimNum(s)}/${den}` : trimNum(s), warn: null };
  }
  return { value: s, warn: null };
}

/** V9. Status as written; a purely numeric status is reported. */
export function cleanStatus(cell) {
  const s = text(cell).replace(/\s+/g, ' ');
  return { value: s, warn: s && isNum(s) ? 'status_is_a_number' : null };
}
/** "joined", "joined and left", "joined & left" count as joined (never mailed, R9). */
export const isJoined = (status) => /^joined\b/.test(String(status || '').toLowerCase().replace(/&/g, 'and').replace(/\s+/g, ' ').trim());

/** V6. Normalise the obvious spellings of the common sources; anything else as written. */
export function cleanSource(cell) {
  const s = text(cell).replace(/\s+/g, ' ');
  const k = s.toLowerCase().replace(/[^a-z]/g, '');
  if (/^(naukri|naukari|naukricom|naukry|nakuri|naukrii)$/.test(k)) return 'Naukri';
  if (/^(linkedin|linkdin|linkedln|linkedinn)$/.test(k)) return 'LinkedIn';
  if (k === 'indeed') return 'Indeed';
  if (k === 'referral' || k === 'reference' || k === 'refrence' || k === 'referal') return 'Referral';
  return s;
}

const NA = /^(na|n\/a|#n\/a|none|nil|null|-+)$/i;
export const blankIfNa = (cell) => { const s = text(cell).replace(/\s+/g, ' '); return NA.test(s) ? '' : s; };

export function cleanGender(cell) {
  const s = blankIfNa(cell);
  if (/^(m|male)$/i.test(s)) return { value: 'Male', warn: null };
  if (/^(f|female)$/i.test(s)) return { value: 'Female', warn: null };
  return { value: s, warn: s ? 'gender_unusual' : null };
}

/** A Role cell holding a status word or a feedback paragraph is rejected (3.4). */
export function cleanRole(cell) {
  const s = text(cell).replace(/\s+/g, ' ');
  if (!s) return { value: '', warn: null };
  if (s.length > 80 || /^(rejected|selected|shortlisted|on hold|hold|joined|offered|not interested|no show)\b/i.test(s)) return { value: '', warn: 'role_cell_rejected' };
  return { value: s, warn: null };
}

/** UI UX form answer "Current Company <name> Website Address <url>" -> the company name. */
export function uiuxCompany(cell) {
  const s = text(cell).replace(/\s+/g, ' ');
  const m = s.match(/^current company\s*[:-]?\s*(.*?)\s*(?:website address.*)?$/i);
  return (m ? m[1] : s).replace(/[\s,:-]+$/, '');
}

/** UI UX form answer "10th Marks 85 12th Marks 78 Graduation Marks 72 Post Graduation Marks 80". */
export function uiuxMarks(cell) {
  const s = text(cell).replace(/\s+/g, ' ');
  const pick = (re) => { const m = s.match(re); return m ? m[1] : ''; };
  const pg = pick(/post\s*graduation\s*marks\s*[:-]?\s*(\d+(?:\.\d+)?)/i);
  const rest = s.replace(/post\s*graduation\s*marks\s*[:-]?\s*(\d+(?:\.\d+)?)?/i, ' ');
  const out = {
    '10th': pick(/10th\s*marks\s*[:-]?\s*(\d+(?:\.\d+)?)/i),
    '12th': pick(/12th\s*marks\s*[:-]?\s*(\d+(?:\.\d+)?)/i),
    Graduation: (rest.match(/graduation\s*marks\s*[:-]?\s*(\d+(?:\.\d+)?)/i) || [])[1] || '',
    PostGraduation: pg,
  };
  return out;
}
