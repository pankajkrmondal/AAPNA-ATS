// HR Upload's per-resume steps, REPEATED here because they live inside runBatchParsing() in
// backend/src/services/hrUpload.service.js and are not exported (that file must not be edited).
// Plan 5.4, steps 1-6. Copied from hrUpload.service.js on 20 Nov 2026:
//   step 1  experience from employment history      :1276-1289
//   step 2  resume_text_quality, technical terms    :1291-1309
//   step 3  emails that appear in the text, fallback :1317-1335
//   step 4  phones whose digits appear in the text  :1344-1348
//   step 5  no valid email = not imported           :1350-1369
//   step 6  the rpa_cv.create field set             :1645-1709
// The parity test (plan 5.8) guards this copy. If runBatchParsing changes before the load, copy it again.
// Pure functions: no database, no AI, no e-mail. The ATS helpers are imported unchanged.
import { sanitizeMatchEmails, sanitizeMatchContacts } from '../../../src/services/hrUpload.service.js';
import { parseExperienceNumeric, parseExpectedCTCNumeric, parseNoticePeriodDays } from '../../../src/utils/candidateParser.js';
import { summariseEmploymentHistory, resolveExperienceYears, isStorableExperience } from '../../../src/utils/experienceParser.js';
import { getMissingFields } from '../../legacy-migration/lib/missing-fields.mjs';

// experienceParser.js:24 PRESENT_WORDS (not exported): a date containing one of these is read as TODAY.
const PRESENT_WORDS = ['present', 'current', 'till date', 'now', 'ongoing', 'date'];
const readsAsToday = (v) => !!v && PRESENT_WORDS.some((k) => String(v).toLowerCase().trim().includes(k));

// safeExperienceNumeric() of hrUpload.service.js:359 (not exported), without the log line.
function safeExperienceNumeric(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = parseExperienceNumeric(String(value));
  return isStorableExperience(numeric) ? numeric : null;
}

// Side effect of getMissingFields() in hrUpload.service.js:408-428 that the Stage 1 copy
// (legacy-migration/lib/missing-fields.mjs, frozen) leaves out: it copies the CamelCase degree keys into lowercase
// keys on `parsed` (the post-graduate ones only for a post-graduate). `parsed` is what saveCandidateVector() embeds
// as JSON, so without this the search entry's text differs from HR Upload's. Found by the parity test, 23 Nov 2026.
function normaliseDegreeKeys(parsed) {
  const qual = String(parsed.HighestQualification || '').toLowerCase().replace(/\./g, '');
  const isPG = ['mtech', 'mca', 'mba', 'msc', 'me', 'ms', 'pgdm', 'post graduation', 'post graduate', 'master', 'pg'].some((k) => qual.includes(k));
  const mapping = { graduationdegree: 'GraduationDegree', graduationspecialization: 'GraduationSpecialization', postgraduationdegree: 'PostGraduationDegree', postgraduationspecialization: 'PostGraduationSpecialization' };
  for (const [key, camelKey] of Object.entries(mapping)) {
    if (!isPG && key.startsWith('post')) continue;
    if (parsed[key] === undefined && parsed[camelKey] !== undefined) parsed[key] = parsed[camelKey];
  }
}

/**
 * Apply HR Upload's steps to one parsed resume.
 * @param {string} text    the resume text (extracted or from the scanned reader)
 * @param {object} parsed  parseResumeWithOpenRouter() output (not modified; a copy is used)
 * @param {{role?:string|null, skills?:string|null, presentAs?:string|null}} folderDefaults
 *        role / skills: R5, used only when the parser gives none.
 *        presentAs: 'MM/YYYY' that a "present" date counts up to (decision S23, 23 Nov 2026: the end of the folder's
 *        year). Without it, "present" counts up to today, exactly as HR Upload does (the parity test runs that way).
 * @returns {{ rejected?: 'rejected_no_email', cleanEmails:string[], cleanContacts:string[], fields?:object, missingFields?:object, warnings:string[] }}
 */
export function applyHrUploadSteps(text, parsedIn, folderDefaults = {}) {
  const parsed = JSON.parse(JSON.stringify(parsedIn || {}));
  const warnings = [];

  // step 1
  const historyInput = Array.isArray(parsed.EmploymentHistory) ? parsed.EmploymentHistory : [];
  // The ONE deliberate difference from HR Upload (S23): experienceParser counts "present" up to today, which adds
  // years to an old resume. The sums are taken over a copy whose "present" dates read as the folder year's end;
  // the stored history keeps the resume's own wording ("Present"). Only the arithmetic changes.
  const cap = folderDefaults.presentAs || null;
  const capDate = (v) => (cap && readsAsToday(v) ? cap : v);
  const forSums = historyInput.map((j) => (j && typeof j === 'object' ? { ...j, StartDate: capDate(j.StartDate), EndDate: capDate(j.EndDate) } : j));
  if (historyInput.some((j) => readsAsToday(j?.StartDate) || readsAsToday(j?.EndDate))) warnings.push(cap ? 'experience_present_capped_at_folder_year' : 'experience_counts_present_as_today');
  const summary = summariseEmploymentHistory(forSums);
  const companies = summary.companies.map((c, i) => ({ ...c, StartDate: historyInput[i]?.StartDate || null, EndDate: historyInput[i]?.EndDate || null }));
  const { totalMonths, lastCompanyMonths } = summary;
  parsed.TotalExperienceYears = resolveExperienceYears(totalMonths, parsed.TotalExperienceYears);
  parsed.LastCompanyExperienceYears = resolveExperienceYears(lastCompanyMonths, parsed.LastCompanyExperienceYears);
  const employmentHistoryDb = { companies, total_companies: companies.length };

  // step 2
  const fullText = (text || '').trim();
  const resume_text_quality = fullText.length === 0 ? 'failed' : (fullText.length < 200 ? 'lossy' : 'extracted');
  const rawTerms = parsed.ResumeTechnicalTerms;
  let resume_technical_terms = [];
  if (Array.isArray(rawTerms) && rawTerms.length > 0 && fullText.length > 0) {
    const fullTextLower = fullText.toLowerCase();
    resume_technical_terms = rawTerms
      .map((term) => {
        const safeTerm = String(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const matches = fullTextLower.match(new RegExp(`\\b${safeTerm}\\b`, 'gi'));
        return { term: String(term), count: matches ? matches.length : 1 };
      })
      .sort((a, b) => b.count - a.count);
  }

  // step 3 (no uploader / vendor e-mail to exclude: the migration has neither)
  const resumeTextLower = fullText.toLowerCase();
  const resumeDigits = fullText.replace(/\D/g, '');
  let cleanEmails = sanitizeMatchEmails(parsed.EmailID || parsed.unique_key, []).filter((e) => resumeTextLower.includes(e));
  if (cleanEmails.length === 0) {
    const textEmails = [...new Set(fullText.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [])];
    cleanEmails = sanitizeMatchEmails(textEmails.join(','), []);
    if (cleanEmails.length > 0) {
      parsed.EmailID = cleanEmails.join(', ');
      parsed.unique_key = cleanEmails[0];
      warnings.push('email_from_resume_text');
    }
  }

  // step 4
  const cleanContacts = sanitizeMatchContacts(parsed.ContactNumber).filter((n) => {
    const digits = n.replace(/\D/g, '');
    return digits.length > 0 && resumeDigits.includes(digits);
  });

  // step 5
  if (cleanEmails.length === 0) return { rejected: 'rejected_no_email', cleanEmails, cleanContacts, warnings };

  // R5 folder defaults: only where the parser gave nothing (applied BEFORE the missing-field rule,
  // so a role taken from the folder is not reported as missing).
  if (!parsed.PositionApplied && folderDefaults.role) { parsed.PositionApplied = folderDefaults.role; warnings.push('role_from_folder'); }
  const noSkills = !parsed.Top5KeySkills || (Array.isArray(parsed.Top5KeySkills) && parsed.Top5KeySkills.length === 0);
  if (noSkills && folderDefaults.skills) { parsed.Top5KeySkills = folderDefaults.skills; warnings.push('skills_from_folder'); }

  const missingFields = getMissingFields(parsed);
  normaliseDegreeKeys(parsed);
  const emailToSearch = cleanEmails.join(', ');

  // step 6: the rpa_cv.create field set, minus what the loader sets itself
  // (cvFileUrl, cv_file_item_id, VendorEmail/vendorName = null, last_action_*, createdAt, modifiedAt, legacy_*)
  const edu = parsed.EducationalScoresPercentage;
  const fields = {
    Name: parsed.Name || 'Candidate',
    EmailID: emailToSearch,
    ContactNumber: parsed.ContactNumber || null,
    PositionApplied: parsed.PositionApplied || null,
    HighestQualification: parsed.HighestQualification || null,
    TotalExperienceYears: parsed.TotalExperienceYears ? String(parsed.TotalExperienceYears) : null,
    LastCompanyExperienceYears: parsed.LastCompanyExperienceYears ? String(parsed.LastCompanyExperienceYears) : null,
    CurrentLocation: parsed.CurrentLocation || null,
    CurrentCompany: (parsed.CurrentCompany && typeof parsed.CurrentCompany === 'object') ? JSON.stringify(parsed.CurrentCompany) : (parsed.CurrentCompany || null),
    Top5KeySkills: Array.isArray(parsed.Top5KeySkills) ? parsed.Top5KeySkills.join(', ') : (parsed.Top5KeySkills || ''),
    NoticePeriod: parsed.NoticePeriod || null,
    CTC_LPA: parsed.CTC_LPA ? String(parsed.CTC_LPA) : null,
    ExpectedCTC_LPA: parsed.ExpectedCTC_LPA ? String(parsed.ExpectedCTC_LPA) : null,
    JobSource: parsed.JobSource || null,
    RecruiterInfoAAPNA: parsed.RecruiterInfoAAPNA || null,
    EducationalScoresPercentage: typeof edu === 'object' ? JSON.stringify(edu) : (edu || null),
    a10th: edu?.['10th'] ? String(edu['10th']) : null,
    a12th: edu?.['12th'] ? String(edu['12th']) : null,
    graduation: edu?.Graduation ? String(edu.Graduation) : null,
    postGraduation: edu?.PostGraduation ? String(edu.PostGraduation) : null,
    graduationdegree: parsed.GraduationDegree || null,
    graduationspecialization: parsed.GraduationSpecialization || null,
    postgraduationdegree: parsed.PostGraduationDegree || null,
    postgraduationspecialization: parsed.PostGraduationSpecialization || null,
    employment_history: employmentHistoryDb,
    Gender: parsed.Gender || null,
    EnglishCommunicationRating: parsed.EnglishCommunicationRating ? String(parsed.EnglishCommunicationRating) : null,
    PreferredShift: parsed.PreferredShift || null,
    ReasonForJobChange: parsed.ReasonForJobChange || null,
    WillingToTakeOnlineTest: parsed.WillingToTakeOnlineTest || null,
    HasLaptopForInitialDays: parsed.HasLaptopForInitialDays || null,
    LinkedInProfile: parsed.LinkedInProfile || null,
    statusActive: Object.keys(missingFields).length > 0 ? 'INACTIVE' : 'ACTIVE',
    missingData: JSON.stringify(missingFields),
    TotalExperienceYearsNumeric: safeExperienceNumeric(parsed.TotalExperienceYears),
    ExpectedCTCNumeric: parseExpectedCTCNumeric(parsed.ExpectedCTC_LPA ? String(parsed.ExpectedCTC_LPA) : null),
    NoticePeriodDays: parseNoticePeriodDays(parsed.NoticePeriod ? String(parsed.NoticePeriod) : null),
    resume_full_text: fullText,
    resume_text_quality,
    resume_technical_terms,
    resume_term_updated_at: resume_technical_terms.length > 0 ? 'LOAD_TIME' : null, // the loader puts the load time here
  };
  // What runPostProcessing() hands to saveCandidateVector(): the parsed object after the steps above,
  // with the stored (validated) e-mail list, so the search entry's key equals rpa_cv.EmailID.
  const vectorData = { ...parsed, EmailID: emailToSearch, unique_key: cleanEmails[0] };
  return { cleanEmails, cleanContacts, fields, missingFields, warnings, vectorData };
}
