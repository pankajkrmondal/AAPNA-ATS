/**
 * Pure rules for keeping the pipeline's copy of a candidate's identity in step
 * with the candidate record (N29). No prisma, so they unit-test without a DB.
 *
 * rpa_shortlisted_candidates.candidate_name / candidate_email are copied from
 * rpa_cv when a candidate is shortlisted, and the board, the drawer, Analytics
 * and every pipeline email read the copy. An edit to rpa_cv (Search Candidate,
 * the public missing-details form, an upload merge, Outlook intake) never
 * reached it, so the pipeline kept showing and emailing the old name.
 *
 * An address the candidate used to have is kept in candidate_email_all, which
 * the drawer's inbox view reads (pipeline.controller.js getPipelineConversations),
 * so a thread filed under the old address is still found.
 */

import { emailCandidates } from './emailMatch.js';

/**
 * The update that brings one shortlist row in line with the candidate record,
 * or {} when it already matches. A blank name or email on the record never
 * blanks the copy: the copy's columns are NOT NULL, and a half-filled record
 * is no reason to lose the name the pipeline already has.
 *
 * @param {{ candidate_name: string, candidate_email: string, candidate_email_all?: string|null }} row
 * @param {{ Name?: string|null, EmailID?: string|null }} cv
 * @param {string[]} [previousEmails] - addresses the record held before this edit
 * @returns {{ candidate_name?: string, candidate_email?: string, candidate_email_all?: string|null }}
 */
export function shortlistIdentityPatch(row, cv, previousEmails = []) {
  const patch = {};
  const name = String(cv?.Name || '').trim();
  const email = String(cv?.EmailID || '').trim();

  if (name && name !== row.candidate_name) patch.candidate_name = name;
  if (email && email !== row.candidate_email) patch.candidate_email = email;

  // Only ever ADD to candidate_email_all: an address that is no longer the
  // primary one and is not already listed. What is already there stays as
  // written, so an in-step row is never rewritten just to tidy it.
  const primary = new Set(emailCandidates(email || row.candidate_email));
  const listed = emailCandidates(row.candidate_email_all);
  const additions = [];
  for (const addr of [
    ...emailCandidates(row.candidate_email),
    ...previousEmails.flatMap((e) => emailCandidates(e)),
  ]) {
    if (!primary.has(addr) && !listed.includes(addr) && !additions.includes(addr)) additions.push(addr);
  }
  if (additions.length) {
    patch.candidate_email_all = [row.candidate_email_all?.trim(), ...additions].filter(Boolean).join(', ');
  }

  return patch;
}

/**
 * rpa_cv columns that feed the candidate's search vector — the parsedData that
 * screening.service.js refreshCandidateVector builds, less Name, ContactNumber
 * and Gender, which say nothing a JD matches on. EmailID stays: the vector
 * store keys its rows by it (vectorStore.service.js saveCandidateVector). An
 * edit touching none of these — a name or phone fix — leaves search unchanged,
 * so no embedding call is spent on it.
 */
export const EMBEDDED_CV_FIELDS = Object.freeze([
  'EmailID', 'TotalExperienceYears', 'LastCompanyExperienceYears', 'CurrentLocation',
  'CTC_LPA', 'ExpectedCTC_LPA', 'NoticePeriod', 'Top5KeySkills', 'CurrentCompany',
  'EnglishCommunicationRating', 'HighestQualification', 'JobSource', 'LinkedInProfile',
  'PreferredShift', 'ReasonForJobChange', 'WillingToTakeOnlineTest', 'HasLaptopForInitialDays',
  'a10th', 'a12th', 'graduation', 'postGraduation', 'graduationdegree', 'graduationspecialization',
  'postgraduationdegree', 'postgraduationspecialization', 'MetaData', 'employment_history', 'FinalStatus',
]);

/**
 * Whether an update changes anything the search vector is built from.
 * @param {object} before - rpa_cv row before the update
 * @param {object} dbData - the columns being written
 */
export function touchesEmbeddedFields(before, dbData) {
  return EMBEDDED_CV_FIELDS.some((k) => k in dbData
    && JSON.stringify(dbData[k] ?? null) !== JSON.stringify(before?.[k] ?? null));
}
