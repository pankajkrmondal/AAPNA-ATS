/**
 * Candidate CSV export — powers Search Candidate (/candidates) and the
 * Dashboard's Recent Candidates table.
 *
 * Columns start from what the Search Candidate table shows (Name, Email,
 * Contact, Position Applied, Gender, Location) and extend to the fields the
 * view/edit modal already works with, since the point of an export is the
 * detail the table has no room for.
 *
 * Rows come from candidateService.findAllForExport(), which reuses the list
 * endpoint's buildWhereClause() with a narrow column allowlist — see
 * EXPORT_SELECT there for why search() itself must not be reused.
 */
import * as candidateService from '../services/candidate.service.js';

export const columns = [
  { header: 'Candidate ID', key: 'id' },
  { header: 'Name', key: 'name' },
  { header: 'Email', key: 'email' },
  { header: 'Contact Number', key: 'phone' },
  { header: 'Position Applied', key: 'position' },
  { header: 'Gender', key: 'gender' },
  { header: 'Current Location', key: 'location' },
  { header: 'Total Experience (Years)', key: 'experience' },
  { header: 'Last Company Experience (Years)', key: 'lastCompanyExperience' },
  { header: 'Current Company', key: 'currentCompany.Name' },
  { header: 'Current CTC (LPA)', key: 'currentCTC', numeric: true },
  { header: 'Expected CTC (LPA)', key: 'expectedCTC', numeric: true },
  { header: 'Notice Period', key: 'noticePeriod' },
  { header: 'Highest Qualification', key: 'education' },
  // Array on the mapped record — joined with "; " by the writer.
  { header: 'Top 5 Key Skills', key: 'skills' },
  { header: 'English Communication Rating', key: 'englishCommunicationRating' },
  { header: 'Preferred Shift', key: 'preferredShift' },
  { header: 'Reason For Job Change', key: 'reasonForJobChange' },
  { header: 'Job Source', key: 'jobSource' },
  { header: 'Recruiter (AAPNA)', key: 'recruiterInfo' },
  { header: 'Vendor Email', key: 'vendorEmail' },
  { header: 'Record Status', key: 'status' },
  { header: 'Final Status', key: 'finalStatus' },
  { header: 'Zeko Interview Score', key: 'ZekoInterviewScore', numeric: true },
  { header: 'LinkedIn Profile', key: 'LinkedInProfile' },
  { header: 'Resume URL', key: 'cvFileUrl' },
  { header: 'Created At', key: 'createdAt', type: 'datetime' },
  { header: 'Last Modified', key: 'modifiedAt', type: 'datetime' },
];

/**
 * Same query params the list endpoint accepts, minus pagination.
 *
 * `vendorOnly` is additionally honoured here so the Vendor Dashboard can export
 * the all-vendors overview it displays — its own "Recent Submissions" table is
 * only the top 5, which would make a 5-row CSV, so it exports the full set the
 * dashboard summarises instead.
 */
export function parseFilters(req) {
  const {
    search, status, finalStatus, vendorEmail, position, location, name, email, phone,
    vendorOnly,
  } = req.query;

  return {
    search,
    status,
    finalStatus,
    vendorEmail,
    position,
    location,
    name,
    email,
    phone,
    vendorOnly: vendorOnly === 'true' || vendorOnly === '1',
  };
}

/** @type {import('./runExport.js').ExportSpec['fetch']} */
export async function fetch({ filters, user, max }) {
  // A vendor may only ever export their own submissions, whatever the query
  // string said. Same helper the list endpoint uses, so the two cannot drift.
  const scoped = candidateService.enforceVendorScope(filters, user);

  return candidateService.findAllForExport(scoped, {
    sort: 'createdAt',
    order: 'desc',
    max,
  });
}

export default { columns, fetch, parseFilters };
