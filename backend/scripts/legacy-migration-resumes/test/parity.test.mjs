// Stage 3 parity test (plan 5.8): HR Upload against the migration's copy of its steps (lib/hr-steps.mjs).
//
//   cd backend
//   node --test --experimental-test-module-mocks scripts/legacy-migration-resumes/test/parity.test.mjs
//
// The plan's first idea was HR Upload on a local backend. That would send real welcome / missing-data e-mails to
// the synthetic candidates (runPostProcessing), upload to OneDrive and write to a database. Instead, the REAL
// runBatchParsing() of hrUpload.service.js runs in this process with its outside connections replaced by
// recorders (node:test module mocks): database, OneDrive, vector store, e-mail service, upload-job tracking, the
// candidate tag/sync/pipeline services, and the LLM call (generateContentWithFallback returns a fixed parse).
// fetch is blocked, so a connection that was not replaced fails the test instead of reaching anything.
// Nothing is written anywhere except a temporary folder; no AI call, no e-mail, no database.
//
// 11 synthetic resumes (no real people; e-mails on the reserved .test domain), each with a fixed parser output,
// go through both sides from the same DOCX file. Compared field by field: the rpa_cv.create data HR Upload builds
// against applyHrUploadSteps().fields, apart from what the loader sets itself (CV link, vendor, last action,
// timestamps, legacy label) and resume_term_updated_at (compared present / absent: the time differs).
// The search entry input (saveCandidateVector) is compared too, apart from EmailID / unique_key, which the
// migration deliberately sets to the validated list stored on rpa_cv.
// The S23 cap ("present" = end of the folder year) is NOT applied here: without presentAs the copy must equal
// HR Upload exactly.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(here, '..', '..', '..');
const src = (p) => path.join(BACKEND, 'src', p);
const url = (abs) => pathToFileURL(abs).href;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stage3-parity-'));

// Configuration for the ATS modules that read it on import (keys are never used: every connection is replaced).
const { prepareEnv } = await import(url(path.join(BACKEND, 'scripts', 'legacy-migration-excel', 'lib', 'env.mjs')));
prepareEnv({ envName: 'staging', expectDb: 'recruitmentautomationdb', writes: false, allowProduction: false, logLevel: 'error' });
process.env.LOG_DIR = path.join(tmp, 'logs');

// ── Recorders ────────────────────────────────────────────────────────────────
const rec = { created: [], vectors: [], emails: [], fetches: [], prismaOps: [] };
globalThis.fetch = async (u) => { rec.fetches.push(String(u).slice(0, 60)); throw new Error('network blocked in the parity test'); };

let nextId = 900000n;
const model = (name) => new Proxy({}, {
  get: (_, op) => (typeof op === 'symbol' || op === 'then') ? undefined : async (args = {}) => {
    rec.prismaOps.push(`${name}.${String(op)}`);
    if (op === 'create') { const row = { id: nextId++, ...(args.data || {}) }; if (name === 'rpa_cv') rec.created.push(row); return row; }
    if (op === 'findUnique' || op === 'findFirst') return name === 'rpa_cv' ? (rec.created.find((r) => String(r.id) === String(args.where?.id)) || null) : null;
    if (op === 'findMany') return [];
    if (op === 'count') return 0;
    if (op === 'update' || op === 'upsert') return { id: args.where?.id ?? 1n, ...(args.data || args.update || {}) };
    if (['updateMany', 'deleteMany', 'createMany'].includes(op)) return { count: 0 };
    return null;
  },
});
const prisma = new Proxy({}, {
  get: (_, k) => {
    if (typeof k === 'symbol' || k === 'then') return undefined;
    if (k === '$queryRaw' || k === '$queryRawUnsafe') return async () => [];
    if (k === '$executeRaw' || k === '$executeRawUnsafe') return async () => 0;
    if (k === '$transaction') return async (x) => (typeof x === 'function' ? x(prisma) : Promise.all(x));
    if (k === '$connect' || k === '$disconnect' || k === '$on' || k === '$use') return async () => {};
    return model(k);
  },
});

// Every export of a module, as a recorder (so the mock links whatever the real importers ask for).
function exportNames(file) {
  const s = fs.readFileSync(file, 'utf8');
  const names = new Set();
  for (const m of s.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z0-9_$]+)/gm)) names.add(m[1]);
  for (const m of s.matchAll(/^export\s*\{([^}]*)\}/gm)) for (const part of m[1].split(',')) { const n = part.trim().split(/\s+as\s+/).pop().trim(); if (n && n !== 'default') names.add(n); }
  return { names: [...names], hasDefault: /^export\s+default\b/m.test(s) };
}
function stub(rel, overrides = {}, onCall = null) {
  const file = src(rel);
  const { names, hasDefault } = exportNames(file);
  const fn = (n) => async (...a) => { if (onCall) onCall(n, a); return null; };
  const namedExports = Object.fromEntries(names.map((n) => [n, n in overrides ? overrides[n] : fn(n)]));
  const opts = { namedExports };
  if (hasDefault) opts.defaultExport = overrides.default ?? namedExports;
  mock.module(url(file), opts);
}

mock.module(url(src('config/database.js')), { defaultExport: prisma, namedExports: { connectDatabase: async () => {}, disconnectDatabase: async () => {} } });
stub('services/onedrive.service.js', {
  uploadFileToOneDriveDetailed: async (p, name) => ({ id: `parity-item-${path.basename(name)}`, webUrl: `https://parity.invalid/${encodeURIComponent(name)}`, name, size: 1 }),
});
stub('services/vectorStore.service.js', {
  saveCandidateVector: async (id, data) => { rec.vectors.push({ id: String(id), data: JSON.parse(JSON.stringify(data)) }); return { parity: true }; },
});
stub('services/emailNotification.service.js', {}, (n) => rec.emails.push(n));
stub('services/uploadJob.service.js', {
  JOB_STATUS: Object.freeze({ UPLOADED: 'Uploaded', QUEUED: 'Queued', PROCESSING: 'Processing', DUPLICATE_PENDING_REVIEW: 'Duplicate_Pending_Review', MISSING_INFORMATION: 'Missing_Information', COMPLETED: 'Completed', FAILED: 'Failed', CANCELLED: 'Cancelled', REJECTED_SYSTEM: 'Rejected_By_System' }),
  NON_TERMINAL_STATUSES: Object.freeze(['Uploaded', 'Queued', 'Processing']),
  JOB_MRF_INCLUDE: Object.freeze({}),
  jobsModelReady: () => false,
  setJobStatus: async () => null,
  serializeJob: (j) => j,
});
stub('services/candidateSync.service.js', { clearScreeningRoleCache: () => {} });
stub('services/candidateTag.service.js');
stub('services/pipeline.service.js', { findRecentRejection: async () => null });

// ── The 10 synthetic resumes and their fixed parser output ──────────────────
const job = (CompanyName, StartDate, EndDate) => ({ CompanyName, StartDate, EndDate });
const base = (o) => ({
  Name: null, NoticePeriod: null, ContactNumber: null, EmailID: null, HighestQualification: null, TotalExperienceYears: null,
  LastCompanyExperienceYears: null, CurrentLocation: null, CTC_LPA: null, ExpectedCTC_LPA: null, JobSource: null, RecruiterInfoAAPNA: null,
  PositionApplied: null, Top5KeySkills: null, CurrentCompany: null, Gender: null, EnglishCommunicationRating: null, PreferredShift: null,
  ReasonForJobChange: null, WillingToTakeOnlineTest: null, HasLaptopForInitialDays: null, EducationalScoresPercentage: null,
  LinkedInProfile: null, unique_key: null, VendorEmail: null, VendorName: null, EmploymentHistory: [], GraduationDegree: null,
  GraduationSpecialization: null, PostGraduationDegree: null, PostGraduationSpecialization: null, ResumeTechnicalTerms: [], ...o,
});
const filler = 'Responsible for design, development, code review, testing and release of business applications. Worked with cross-functional teams on requirements, estimation and delivery. Mentored junior developers and improved build pipelines.';
const CASES = [
  { id: 'c01-complete', text: `Asha Verma\nasha.verma@mailbox.test | +91 70000 00001\nSenior Java Developer, Pune\nNorthwind Systems 06/2019 - 03/2024\nBlue Harbor Tech 01/2016 - 05/2019\nSkills: Java, Spring Boot, PostgreSQL, Docker, AWS\nB.Tech Computer Science 78%. 12th 82%. 10th 88%.\nNotice period: 30 Days. CTC 14 LPA, expected 20 LPA.\n${filler}`,
    parsed: base({ Name: 'Asha Verma', EmailID: 'asha.verma@mailbox.test', unique_key: 'asha.verma@mailbox.test', ContactNumber: '+91 70000 00001', PositionApplied: 'Senior Java Developer', CurrentLocation: 'Pune', HighestQualification: 'B.Tech', TotalExperienceYears: '8', LastCompanyExperienceYears: '4.5', CTC_LPA: '14', ExpectedCTC_LPA: '20', NoticePeriod: '30 Days', Top5KeySkills: ['Java', 'Spring Boot', 'PostgreSQL', 'Docker', 'AWS'], CurrentCompany: 'Northwind Systems', Gender: 'Female', EnglishCommunicationRating: '4', EducationalScoresPercentage: { '10th': '88', '12th': '82', Graduation: '78', PostGraduation: null }, GraduationDegree: 'B.Tech', GraduationSpecialization: 'Computer Science', EmploymentHistory: [job('Northwind Systems', '06/2019', '03/2024'), job('Blue Harbor Tech', '01/2016', '05/2019')], ResumeTechnicalTerms: ['Java', 'Spring Boot', 'PostgreSQL', 'Docker', 'AWS'] }) },
  { id: 'c02-present', text: `Rohan Mehta\nrohan.m@mailbox.test, 70000 00002\nReact developer, Bengaluru\nCedar Labs June 2021 - Present\nOak Digital Jan 2019 - May 2021\nReact, TypeScript, Redux\n${filler}`,
    parsed: base({ Name: 'Rohan Mehta', EmailID: 'rohan.m@mailbox.test', unique_key: 'rohan.m@mailbox.test', ContactNumber: '7000000002', PositionApplied: 'React Developer', CurrentLocation: 'Bengaluru', Top5KeySkills: ['React', 'TypeScript', 'Redux'], EmploymentHistory: [job('Cedar Labs', 'June 2021', 'Present'), job('Oak Digital', 'Jan 2019', 'May 2021')], ResumeTechnicalTerms: ['React', 'TypeScript', 'Redux'] }) },
  { id: 'c03-unreadable-dates', text: `Kiran Rao\nkiran.rao@mailbox.test\nQA Engineer with 6 years of experience\nMaple Soft (two thousand nineteen onwards)\nSelenium, TestNG, JIRA\n${filler}`,
    parsed: base({ Name: 'Kiran Rao', EmailID: 'kiran.rao@mailbox.test', unique_key: 'kiran.rao@mailbox.test', TotalExperienceYears: '6', LastCompanyExperienceYears: '3', PositionApplied: 'QA Engineer', EmploymentHistory: [job('Maple Soft', 'two thousand nineteen', 'onwards?')], ResumeTechnicalTerms: ['Selenium', 'TestNG', 'JIRA'] }) },
  { id: 'c04-email-fallback', text: `Rihana Qureshi\nContact: rihannaqureshi0@mailbox.test\nPhone 70000 00004\nData analyst, Hyderabad\n${filler}`,
    parsed: base({ Name: 'Rihana Qureshi', EmailID: 'rihanaqureshi0@mailbox.test', unique_key: 'rihanaqureshi0@mailbox.test', ContactNumber: '7000000004', PositionApplied: 'Data Analyst', CurrentLocation: 'Hyderabad' }) },
  { id: 'c05-two-contacts', text: `Vikram Singh\nvikram.singh@mailbox.test ; v.singh.work@mailbox.test\nMobile: 70000 00005\nDevOps Engineer, Noida. Kubernetes, Terraform, Jenkins\n${filler}`,
    parsed: base({ Name: 'Vikram Singh', EmailID: 'vikram.singh@mailbox.test, v.singh.work@mailbox.test', unique_key: 'vikram.singh@mailbox.test', ContactNumber: '7000000005, 7000000099', PositionApplied: 'DevOps Engineer', CurrentLocation: 'Noida', Top5KeySkills: ['Kubernetes', 'Terraform', 'Jenkins'], ResumeTechnicalTerms: ['Kubernetes', 'Terraform', 'Jenkins'] }) },
  { id: 'c06-no-email', text: `Meera Nair\nPhone: 70000 00006\nFlutter developer, Kochi\n${filler}`,
    parsed: base({ Name: 'Meera Nair', ContactNumber: '7000000006', PositionApplied: 'Flutter Developer', CurrentLocation: 'Kochi' }) },
  { id: 'c07-company-object', text: `Arjun Das\narjun.das@mailbox.test\nFresher, Kolkata. Python, Django\n${filler}`,
    parsed: base({ Name: 'Arjun Das', EmailID: 'arjun.das@mailbox.test', unique_key: 'arjun.das@mailbox.test', TotalExperienceYears: 'Fresher', LastCompanyExperienceYears: 'Fresher', CurrentCompany: { name: 'Campus Projects', since: '2025' }, Top5KeySkills: 'Python, Django', CurrentLocation: 'Kolkata', ResumeTechnicalTerms: ['Python', 'Django'] }) },
  { id: 'c08-unstorable-experience', text: `Neha Gupta\nneha.gupta@mailbox.test, 70000 00008\nWorking since 2019 as .NET developer\nC#, ASP.NET, SQL Server\n${filler}`,
    parsed: base({ Name: 'Neha Gupta', EmailID: 'neha.gupta@mailbox.test', unique_key: 'neha.gupta@mailbox.test', ContactNumber: '7000000008', TotalExperienceYears: 'since 2019', PositionApplied: 'Dot Net Developer', ExpectedCTC_LPA: '1500000', NoticePeriod: 'Immediate', ResumeTechnicalTerms: ['C#', 'ASP.NET', 'SQL Server'] }) },
  { id: 'c09-sparse', text: `curriculum vitae\nsparse.person@mailbox.test\n${filler}`,
    parsed: base({ EmailID: 'sparse.person@mailbox.test', unique_key: 'sparse.person@mailbox.test' }) },
  { id: 'c10-short-text', text: 'Short CV. short.cv@mailbox.test. C++ and Node.js, 2 years.',
    parsed: base({ Name: 'Short Cv', EmailID: 'short.cv@mailbox.test', unique_key: 'short.cv@mailbox.test', TotalExperienceYears: '2', ResumeTechnicalTerms: ['C++', 'Node.js'] }) },
  { id: 'c11-postgraduate', text: `Dr. Sana Iqbal\nsana.iqbal@mailbox.test | 70000 00011\nMCA (Computer Applications) 81%, BCA 74%\nMendix lead, Chennai. Pine Works 2018 - 2025\n${filler}`,
    parsed: base({ Name: 'Dr. Sana Iqbal', EmailID: 'sana.iqbal@mailbox.test', unique_key: 'sana.iqbal@mailbox.test', ContactNumber: '7000000011', HighestQualification: 'M.C.A.', GraduationDegree: 'BCA', GraduationSpecialization: 'Computer Applications', PostGraduationDegree: 'MCA', PostGraduationSpecialization: 'Computer Applications', EducationalScoresPercentage: { '10th': null, '12th': null, Graduation: '74', PostGraduation: '81' }, CurrentLocation: 'Chennai', PositionApplied: 'Mendix Lead', EmploymentHistory: [job('Pine Works', '2018', '2025')], ResumeTechnicalTerms: ['Mendix'] }) },
];
const parsedByFile = new Map(CASES.map((c) => [`${c.id}.docx`, c.parsed]));
stub('utils/geminiHelper.js', {
  generateContentWithFallback: async (prompt) => {
    const name = /Original File Name: (\S+)/.exec(prompt)?.[1];
    if (!parsedByFile.has(name)) throw new Error(`no fixed parse for ${name}`);
    return JSON.stringify(parsedByFile.get(name));
  },
});

// Minimal DOCX (one paragraph per line), built with jszip (a mammoth dependency).
const { default: JSZip } = await import('jszip');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
async function docx(file, text) {
  const z = new JSZip();
  z.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  z.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${text.split('\n').map((l) => `<w:p><w:r><w:t xml:space="preserve">${esc(l)}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`);
  fs.writeFileSync(file, await z.generateAsync({ type: 'nodebuffer' }));
}

// ── Run both sides ───────────────────────────────────────────────────────────
const hr = await import(url(src('services/hrUpload.service.js')));
const { applyHrUploadSteps } = await import(url(path.join(here, '..', 'lib', 'hr-steps.mjs')));
const { canonical } = await import(url(path.join(here, '..', 'lib', 'constants.mjs')));

const files = [];
for (const c of CASES) { const p = path.join(tmp, `${c.id}.docx`); await docx(p, c.text); files.push({ originalname: `${c.id}.docx`, path: p }); }
await hr.runBatchParsing('parity-run', files, { first_name: 'Parity', last_name: 'Test', email: 'uploader@mailbox.test' }, 'hr_manual_upload');
await new Promise((r) => setTimeout(r, 500)); // runPostProcessing runs on setImmediate

const LOADER_SETS = new Set(['cvFileUrl', 'cv_file_item_id', 'VendorEmail', 'vendorName', 'last_action_by', 'last_action_context', 'createdAt', 'modifiedAt', 'legacy_source', 'legacy_relation']);
const hrByEmail = new Map(rec.created.map((r) => [r.EmailID, r]));
const results = [];

for (const c of CASES) {
  test(`parity ${c.id}`, async () => {
    const text = await hr.extractTextFromFile(path.join(tmp, `${c.id}.docx`), `${c.id}.docx`);
    const s = applyHrUploadSteps(text, c.parsed, {});
    if (s.rejected) {
      assert.ok(![...hrByEmail.values()].some((r) => r.resume_full_text === text.trim()), 'HR Upload created a candidate the copy rejects');
      results.push({ case: c.id, both: 'rejected (no valid email)' });
      return;
    }
    const h = hrByEmail.get(s.fields.EmailID);
    assert.ok(h, `HR Upload created no candidate with EmailID of ${c.id}`);
    const keysHr = Object.keys(h).filter((k) => k !== 'id' && !LOADER_SETS.has(k)).sort();
    const keysCopy = Object.keys(s.fields).sort();
    assert.deepEqual(keysCopy, keysHr, 'field sets differ');
    const diffs = [];
    for (const k of keysHr) {
      if (k === 'resume_term_updated_at') { if (!!h[k] !== !!s.fields[k]) diffs.push(k); continue; }
      if (canonical(h[k] ?? null) !== canonical(s.fields[k] ?? null)) diffs.push(k);
    }
    assert.deepEqual(diffs, [], `fields differ: ${diffs.join(', ')}`);
    const v = rec.vectors.find((x) => x.id === String(h.id));
    assert.ok(v, 'HR Upload made no search entry');
    const strip = (o) => { const { EmailID, unique_key, ...rest } = o; return rest; };
    // In order, not canonical: saveCandidateVector() embeds JSON.stringify(parsed), so key order is part of the text.
    assert.equal(JSON.stringify(strip(s.vectorData)), JSON.stringify(strip(v.data)), 'search-entry input differs (apart from EmailID / unique_key)');
    results.push({ case: c.id, both: 'created', fieldsCompared: keysHr.length });
  });
}

test('isolation: nothing left the process', () => {
  assert.deepEqual(rec.fetches, [], `network calls attempted: ${rec.fetches.join(', ')}`);
  assert.equal(rec.created.length, CASES.length - 1, 'HR Upload should create 9 candidates (1 has no e-mail)');
  // The e-mails HR Upload would have sent (welcome, missing data, no-e-mail alert) went to the recorder only.
  assert.ok(rec.emails.includes('sendWelcomeEmail'), 'expected the e-mail recorder to catch the welcome e-mails');
  console.log(`# compared: ${JSON.stringify(results)}`);
  console.log(`# e-mails caught by the recorder (not sent): ${JSON.stringify(rec.emails.reduce((a, n) => ((a[n] = (a[n] || 0) + 1), a), {}))}`);
  fs.rmSync(tmp, { recursive: true, force: true });
});
