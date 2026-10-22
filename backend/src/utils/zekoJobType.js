/**
 * Classifies a Zeko dashboard role as 'hr' | 'coding' | 'functional' | 'other'.
 * Drives the type tag shown beside each job in the pipeline's Schedule Zeko
 * Interview picker.
 *
 * Signals, in order of trust (verified against all 31 published staging jobs):
 *
 *   isCodingInterviewPresent   reliable — true on exactly the coding jobs.
 *   interviews[].type          reliable — 'screening-interview' is Zeko's
 *                              "Recruiter Screening" (our HR round);
 *                              'functional-interview' is a functional round.
 *   isHRScreeningInterviewPresent   NOT used — Zeko sends false on every job,
 *                              real HR screenings included.
 *
 * The job name is a last resort only. It used to come first and matched "hr" as
 * a bare substring, so "Junior HR Operations - Functional Interview" was tagged
 * HR and hidden from the Functional round (as would "three" or "Shreya"). The
 * fallback now matches whole words, and a round keyword beats "hr" — a
 * functional job ABOUT HR is still a functional job.
 *
 * @param {object} r - Raw role object from the Zeko dashboard API.
 * @returns {'hr'|'coding'|'functional'|'other'}
 */
export function deriveZekoInterviewType(r) {
  if (r?.isCodingInterviewPresent) return 'coding';

  const types = (r?.interviews || []).map((i) => i?.type);
  if (types.includes('screening-interview')) return 'hr';
  if (types.includes('functional-interview')) return 'functional';

  const hn = String(r?.hiringName || r?.title || '').toLowerCase();
  if (/\bcoding\b/.test(hn)) return 'coding';
  if (/\bfunctional\b/.test(hn)) return 'functional';
  if (/\bhr\b/.test(hn)) return 'hr';
  return 'other';
}
