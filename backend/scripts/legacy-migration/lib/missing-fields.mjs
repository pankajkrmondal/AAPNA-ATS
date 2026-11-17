// The ATS missing-field rule, COPIED from getMissingFields() in
// backend/src/services/hrUpload.service.js (it is not exported there, and that file
// must not be edited). Kept identical so imported candidates get the same
// missingData / statusActive as a candidate uploaded through HR Upload.
// If the rule changes in hrUpload.service.js before this import runs, copy it again.

export function getMissingFields(parsed) {
  const missing = {};

  // Determine if candidate is a Post-Graduate (PG) based on HighestQualification
  const qual = String(parsed.HighestQualification || '').toLowerCase().replace(/\./g, '');
  const pgKeywords = ['mtech', 'mca', 'mba', 'msc', 'me', 'ms', 'pgdm', 'post graduation', 'post graduate', 'master', 'pg'];
  const isPG = pgKeywords.some((k) => qual.includes(k));

  const keysToCheck = [
    'Name', 'NoticePeriod', 'ContactNumber', 'EmailID', 'HighestQualification', 'TotalExperienceYears',
    'LastCompanyExperienceYears', 'CurrentLocation', 'CTC_LPA', 'ExpectedCTC_LPA', 'JobSource',
    'RecruiterInfoAAPNA', 'PositionApplied', 'Top5KeySkills', 'CurrentCompany', 'Gender',
    'EnglishCommunicationRating', 'graduationdegree', 'graduationspecialization',
    'postgraduationdegree', 'postgraduationspecialization',
  ];

  keysToCheck.forEach((key) => {
    // Skip PG fields if candidate is NOT a PG candidate
    if (!isPG && (key === 'postgraduationdegree' || key === 'postgraduationspecialization')) return;

    const mapping = {
      graduationdegree: 'GraduationDegree',
      graduationspecialization: 'GraduationSpecialization',
      postgraduationdegree: 'PostGraduationDegree',
      postgraduationspecialization: 'PostGraduationSpecialization',
    };
    const camelKey = mapping[key] || (key.charAt(0).toUpperCase() + key.slice(1));
    const v = parsed[key] !== undefined ? parsed[key] : parsed[camelKey];

    if (v === undefined || v === null || v === '' || v === 'Null' || v === 'null' || (Array.isArray(v) && v.length === 0)) {
      missing[key] = 'Null';
    }
  });

  const edu = parsed.EducationalScoresPercentage || {};
  if (!edu['10th'] || edu['10th'] === '' || edu['10th'] === 'Null') missing['10th (in percentage)'] = 'Null';
  if (!edu['12th'] || edu['12th'] === '' || edu['12th'] === 'Null') missing['12th (in percentage)'] = 'Null';
  if (!edu.Graduation || edu.Graduation === '' || edu.Graduation === 'Null') missing['Graduation (in percentage)'] = 'Null';

  // Only validate PG score if candidate is a Post-Graduate
  if (isPG) {
    const pgScore = edu.PostGraduation;
    if (!pgScore || pgScore === '' || pgScore === 'Null') missing['PostGraduation (in percentage)'] = 'Null';
  }

  const otherKeys = ['PreferredShift', 'ReasonForJobChange', 'WillingToTakeOnlineTest', 'HasLaptopForInitialDays', 'LinkedInProfile'];
  otherKeys.forEach((key) => {
    const v = parsed[key];
    if (v === undefined || v === null || v === '' || v === 'Null' || v === 'null' || (Array.isArray(v) && v.length === 0)) {
      missing[key] = 'Null';
    }
  });

  return missing;
}
