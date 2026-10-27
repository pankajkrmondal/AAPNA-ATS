/**
 * duplicateReview.service.js — the side-by-side view behind the duplicate
 * Review window on HR Manual Upload and Vendor Manual Upload (L09).
 *
 * The Review window used to show only the staged upload (rpa_cv_tmp), so a
 * recruiter deciding Merge or Cancel could not see what was already in the ATS
 * or what the new resume would change. This loads both, and the upload history
 * of the existing candidate.
 *
 * Its own module rather than part of hrUpload.service.js: that file is already
 * imported by candidate.service.js, and keeping the read-only comparison apart
 * keeps the dependency one-way.
 *
 * STAFF ONLY. Both routes refuse vendors (hrUpload.routes.js: requireStaff;
 * vendor.routes.js: restrictTo(STAFF_ROLES)): the existing record may belong
 * to another vendor or to internal HR (VENDOR_PROCESS.md, review queue rules).
 */
import prisma from '../config/database.js';
import AppError from '../utils/AppError.js';
import { findExistingCandidateMatch, sanitizeMatchContacts, sanitizeMatchEmails } from './hrUpload.service.js';
import { compareCandidates, matchedBy, summariseChanges } from '../utils/duplicateCompare.js';

const num = (v) => (v === null || v === undefined ? null : Number(v));

/**
 * @param {number|string} tmpId - the rpa_cv_tmp row under review
 * @returns {Promise<object>} { tmp_id, incoming, existing, matched_by, fields, summary, history }
 */
export async function getDuplicateComparison(tmpId) {
  if (!/^\d+$/.test(String(tmpId ?? ''))) throw new AppError('Invalid review id.', 400);
  const incoming = await prisma.rpa_cv_tmp.findUnique({ where: { id: BigInt(tmpId) } });
  if (!incoming) {
    throw new AppError('This duplicate is no longer in the review queue. It may already have been merged or cancelled.', 404);
  }

  // The candidate it matched at upload (rows staged before L09 carry no id, and
  // a matched candidate may since have been deleted): otherwise match again,
  // exactly as the merge will.
  let existing = incoming.matched_cv_id
    ? await prisma.rpa_cv.findUnique({ where: { id: incoming.matched_cv_id } })
    : null;
  if (!existing) {
    existing = await findExistingCandidateMatch(
      prisma,
      sanitizeMatchContacts(incoming.ContactNumber),
      sanitizeMatchEmails(incoming.EmailID),
    );
  }

  const history = existing
    ? await prisma.rpa_upload_jobs.findMany({
      where: { cv_id: existing.id },
      orderBy: { created_at: 'desc' },
      take: 10,
      select: { id: true, created_at: true, source: true, uploaded_by: true, file_url: true, file_name: true, status: true },
    })
    : [];

  const fields = compareCandidates(existing, incoming);
  return {
    tmp_id: num(incoming.id),
    incoming: {
      name: incoming.Name || null,
      email: incoming.EmailID || null,
      uploaded_by: incoming.uploadedByHRName || null,
      uploaded_at: incoming.uploadedAt || incoming.createdAt || null,
      source: incoming.uploadSource || incoming.source || null,
      vendor_name: incoming.vendorName || null,
      resume_url: incoming.cvFileUrl || null,
    },
    existing: existing
      ? {
        id: num(existing.id),
        name: existing.Name || null,
        created_at: existing.createdAt || null,
        modified_at: existing.modifiedAt || null,
        last_action_by: existing.last_action_by || null,
        last_action_context: existing.last_action_context || null,
        resume_url: existing.cvFileUrl || null,
      }
      : null,
    matched_by: matchedBy(existing, incoming),
    fields,
    summary: summariseChanges(fields),
    history: history.map((h) => ({ ...h, id: num(h.id) })),
  };
}

export default { getDuplicateComparison };
