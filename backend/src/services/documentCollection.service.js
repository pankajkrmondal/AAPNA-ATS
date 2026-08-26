/**
 * documentCollection.service.js — Phase 3 Module 4: the Documents round.
 *
 * Fires after the final interview rounds clear and before the offer goes out:
 * HR triggers the request → the candidate uploads through a no-login tokenized
 * link → HR verifies each document, or rejects one with a reason, which re-opens
 * just that item for re-upload.
 *
 * Files land in OneDrive under "Document Collection/<candidate name (cv id)>/",
 * inside the same parent folder resumes already use (onedrive.service.js).
 *
 * Two standing rules from RT:
 *  - Retention (2026-07-14): documents are NEVER deleted. There is deliberately
 *    no delete/expiry path anywhere in this module.
 *  - Vendors (Q5): no document-stage email or API ever reaches a vendor. Nothing
 *    here touches pipelineRow.vendor_email — deliberately, not by omission.
 */
import fs from 'fs';
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import config from '../config/index.js';
import AppError from '../utils/AppError.js';
import { resolveRecipients } from '../config/emailRecipients.js';
import { sendGraphEmail, compileTemplate } from './emailNotification.service.js';
import { wrapBrandedEmail } from './emailLayout.service.js';
import { uploadFileToOneDrive } from './onedrive.service.js';
import { notify, NOTIFICATION_TYPES } from './notification.service.js';

/** Email templates for this flow, overridable from the Email Templates page. */
const TEMPLATE_NAMES = Object.freeze({
  request: 'Document Collection Request',
  reminder: 'Document Collection Reminder',
});

/** Loads an active template row by name, or null. */
async function getTemplate(name) {
  return prisma.rpa_email_templates.findFirst({ where: { name, is_active: true } });
}

/** Serializes a request row + its documents for the API (BigInt -> Number). */
function serializeRequest(row) {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    pipeline_id: Number(row.pipeline_id),
    rpa_candidate_documents: (row.rpa_candidate_documents || []).map((d) => ({
      ...d,
      id: Number(d.id),
      request_id: Number(d.request_id),
    })),
  };
}

/** Loads the journey + candidate, or 404s. */
async function loadPipeline(pipelineId) {
  const pipeline = await prisma.rpa_candidate_pipeline.findUnique({
    where: { id: BigInt(pipelineId) },
    include: { rpa_shortlisted_candidates: { include: { mrf: true } } },
  });
  if (!pipeline) throw new AppError('Pipeline journey not found.', 404);
  return pipeline;
}

/**
 * The OneDrive folder for one candidate's documents. The cv id is appended
 * because candidate names are not unique — two "Rahul Sharma"s must not share
 * a folder.
 */
function candidateFolderName(pipeline) {
  const name = pipeline.rpa_shortlisted_candidates?.candidate_name || 'Unnamed candidate';
  const ref = pipeline.cv_id ? `cv-${pipeline.cv_id}` : `journey-${pipeline.id}`;
  return `${name} (${ref})`;
}

/** Appends a note to the journey's audit trail. */
async function auditNote(pipelineId, notes, actedBy) {
  await prisma.rpa_pipeline_stage_events.create({
    data: {
      pipeline_id: BigInt(pipelineId),
      stage_key: 'documents',
      event_type: 'note',
      notes,
      acted_by: actedBy || null,
    },
  });
}

const CTA = (link, label) =>
  `<p><a href="${link}" style="background:#7a922e;color:#ffffff;padding:11px 22px;text-decoration:none;border-radius:8px;font-weight:700;display:inline-block;">${label}</a></p>`;

/**
 * Built-in copy used until HR creates the matching rpa_email_templates row.
 *
 * Each flow gets its own body: a re-request that reused the initial "Congratulations,
 * please send your documents" text would never tell the candidate WHICH document
 * was rejected or why, which is the entire point of that email.
 *
 * @param {string} templateName - one of TEMPLATE_NAMES
 * @param {object} t - interpolation values
 * @param {string} link
 * @returns {{subject: string, html: string}}
 */
function fallbackEmail(templateName, t, link) {
  const sign = '<p>Best regards,<br/>AAPNA Recruitment Team</p>';

  // A rejection is a reminder carrying the two extra tokens.
  if (templateName === TEMPLATE_NAMES.reminder && t.rejected_document) {
    return {
      subject: `Action needed: re-upload your ${t.rejected_document} — ${t.position}`,
      html: `<p>Dear ${t.candidate_name},</p>
             <p>Thank you for sending your documents for <strong>${t.position}</strong>. We need one of them again:</p>
             <p><strong>${t.rejected_document}</strong><br/>${t.rejection_reason}</p>
             <p>Please re-upload it using the same secure link — no login is needed.</p>
             ${CTA(link, 'Re-upload the document')}
             ${sign}`,
    };
  }

  if (templateName === TEMPLATE_NAMES.reminder) {
    return {
      subject: `Reminder: documents still needed — ${t.position}`,
      html: `<p>Dear ${t.candidate_name},</p>
             <p>This is a gentle reminder that we are still waiting on the documents needed to roll out your offer for <strong>${t.position}</strong>.</p>
             ${CTA(link, 'Upload your documents')}
             ${sign}`,
    };
  }

  return {
    subject: `Documents required to roll out your offer — ${t.position}`,
    html: `<p>Dear ${t.candidate_name},</p>
           <p>Congratulations! To roll out your offer for <strong>${t.position}</strong>, please share the documents listed on the secure link below — no login is needed.</p>
           ${CTA(link, 'Upload your documents')}
           <p>Please do this at the earliest so we can proceed.</p>
           ${sign}`,
  };
}

/**
 * Sends the request/reminder email to the CANDIDATE ONLY. The vendor is never
 * copied on a document-stage email (Q5).
 * @returns {Promise<boolean>} whether it was sent
 */
async function sendDocumentEmail(templateName, pipeline, token, extraTokens = {}) {
  const candidate = pipeline.rpa_shortlisted_candidates;
  const link = `${config.cors.frontendUrl}/documents/${token}`;
  const position = candidate?.mrf?.position_hiring_for || candidate?.position_applied || 'the role';
  const tokens = {
    candidate_name: candidate?.candidate_name || 'there',
    position,
    upload_link: link,
    // Defaults BEFORE the spread: compileTemplate() leaves any token it doesn't
    // know in the output verbatim, so a reminder template that mentions the
    // rejection fields would otherwise email the candidate a literal
    // "{{rejected_document}}" on every plain (non-rejection) reminder.
    rejected_document: '',
    rejection_reason: '',
    ...extraTokens,
  };

  const tpl = await getTemplate(templateName);
  const compiled = tpl ? compileTemplate(tpl.subject, tpl.body_html, tokens) : fallbackEmail(templateName, tokens, link);

  // Candidate only — resolveRecipients applies the usual staging redirect.
  const { to } = resolveRecipients('documentRequest', candidate?.candidate_email || '');
  if (!to) return false;

  try {
    await sendGraphEmail({
      sender: config.microsoft.defaultSender,
      to,
      subject: compiled.subject,
      // Header headline = the email's own subject (RT decision, 2026-07-25).
      html: wrapBrandedEmail(compiled.html, { title: compiled.subject }),
    });
    return true;
  } catch (err) {
    logger.error(`Document email (${templateName}) failed for pipeline ${pipeline.id}: ${err.message}`);
    return false;
  }
}

/**
 * The document request for a journey (with its checklist), or null when none has
 * been raised. Also returns the active checklist so the UI can show what WOULD
 * be asked for before the request goes out.
 * @param {number} pipelineId
 */
export async function getDocumentStatus(pipelineId) {
  const [request, checklist] = await Promise.all([
    prisma.rpa_document_requests.findUnique({
      where: { pipeline_id: BigInt(pipelineId) },
      include: {
        rpa_candidate_documents: {
          include: { rpa_document_checklist_items: true },
          // Ordered by the checklist's own sort_order, so an item added later
          // with a low sort_order still renders in its intended position.
          orderBy: { rpa_document_checklist_items: { sort_order: 'asc' } },
        },
      },
    }),
    prisma.rpa_document_checklist_items.findMany({
      where: { is_active: true },
      orderBy: { sort_order: 'asc' },
    }),
  ]);

  return { request: serializeRequest(request), checklist };
}

/**
 * Raises the document request: creates (or reuses) the token, seeds one row per
 * active checklist item, and emails the candidate the upload link.
 *
 * Re-requesting an existing request reuses the same row and token so a candidate
 * never holds two live links, and adds any checklist item introduced since.
 *
 * @param {number} pipelineId
 * @param {object} params
 * @param {number} params.actedBy
 */
export async function requestDocuments(pipelineId, { actedBy } = {}) {
  const pipeline = await loadPipeline(pipelineId);

  const checklist = await prisma.rpa_document_checklist_items.findMany({
    where: { is_active: true },
    orderBy: { sort_order: 'asc' },
  });
  if (checklist.length === 0) {
    throw new AppError('No active document checklist items are configured. Seed the checklist first.', 400);
  }

  const request = await prisma.rpa_document_requests.upsert({
    where: { pipeline_id: pipeline.id },
    create: { pipeline_id: pipeline.id, requested_by: actedBy || null },
    update: {
      token_status: 'active',
      requested_at: new Date(),
      // A re-request restarts the chase. Without this reset the counters carried
      // over from the previous round, so a candidate re-asked after three
      // reminders fell permanently outside the sweep's `reminder_count < maxCount`
      // filter — the request was reopened but nothing would ever follow it up.
      reminder_count: 0,
      last_reminded_at: null,
      modified_at: new Date(),
    },
  });

  // Seed a row per checklist item; skipDuplicates keeps an existing (possibly
  // already-uploaded) row untouched on a re-request.
  await prisma.rpa_candidate_documents.createMany({
    data: checklist.map((item) => ({ request_id: request.id, checklist_item_id: item.id })),
    skipDuplicates: true,
  });

  const sent = await sendDocumentEmail(TEMPLATE_NAMES.request, pipeline, request.token);
  await auditNote(
    pipeline.id,
    `Document request ${sent ? 'emailed to the candidate' : 'raised (email failed)'} — ${checklist.length} document(s)`,
    actedBy
  );

  logger.info(`Documents requested: pipeline ${pipelineId} (${checklist.length} item(s), emailed=${sent}).`);
  return getDocumentStatus(pipelineId);
}

/**
 * Sends a reminder for a request that is still outstanding.
 * @param {number} pipelineId
 * @param {object} params
 * @param {number} params.actedBy
 */
export async function sendReminder(pipelineId, { actedBy } = {}) {
  const pipeline = await loadPipeline(pipelineId);
  const request = await prisma.rpa_document_requests.findUnique({ where: { pipeline_id: pipeline.id } });
  if (!request) throw new AppError('No document request has been raised for this candidate yet.', 400);

  const sent = await sendDocumentEmail(TEMPLATE_NAMES.reminder, pipeline, request.token);

  // Only a reminder that actually WENT counts. The counters drive the automatic
  // sweep (jobs/documentReminder.js selects on reminder_count < maxCount), so
  // stamping them on a failed send burned the candidate's reminder budget on
  // emails they never received — three bounces and they were never chased again.
  // A failure leaves both untouched, so the sweep retries on its next pass.
  if (sent) {
    await prisma.rpa_document_requests.update({
      where: { id: request.id },
      data: {
        last_reminded_at: new Date(),
        reminder_count: { increment: 1 },
        modified_at: new Date(),
      },
    });
  }

  await auditNote(pipeline.id, `Document reminder ${sent ? 'sent' : 'attempted (email failed)'}`, actedBy);
  return getDocumentStatus(pipelineId);
}

/**
 * Public read for the tokenized upload page: the checklist and each item's
 * current state, with no candidate PII beyond their own name.
 * @param {string} token - uuid
 */
export async function getRequestByToken(token) {
  const request = await prisma.rpa_document_requests.findUnique({
    where: { token },
    include: {
      rpa_candidate_documents: {
        include: { rpa_document_checklist_items: true },
        orderBy: { rpa_document_checklist_items: { sort_order: 'asc' } },
      },
      rpa_candidate_pipeline: { include: { rpa_shortlisted_candidates: { include: { mrf: true } } } },
    },
  });
  if (!request) throw new AppError('This document upload link is invalid.', 404);

  const candidate = request.rpa_candidate_pipeline?.rpa_shortlisted_candidates;
  const items = request.rpa_candidate_documents.map((d) => ({
    id: Number(d.id),
    checklist_item_id: d.checklist_item_id,
    label: d.rpa_document_checklist_items?.label,
    description: d.rpa_document_checklist_items?.description,
    status: d.status,
    original_name: d.original_name,
    uploaded_at: d.uploaded_at,
    // Only a rejection remark is shown to the candidate — it tells them what to fix.
    remarks: d.status === 'rejected' ? d.remarks : null,
  }));

  return {
    state: request.token_status === 'closed' ? 'closed' : 'open',
    candidate_name: candidate?.candidate_name || null,
    position: candidate?.mrf?.position_hiring_for || candidate?.position_applied || null,
    items,
  };
}

/**
 * Public write: the candidate uploads (or re-uploads) one checklist item. The
 * file goes to OneDrive; a re-upload after a rejection overwrites the row and
 * puts it back in the 'uploaded' queue for HR.
 *
 * @param {string} token
 * @param {object} params
 * @param {number} params.checklistItemId
 * @param {{path: string, originalname: string}} params.file - multer file
 */
export async function uploadDocument(token, { checklistItemId, file }) {
  if (!file) throw new AppError('A file is required.', 400);

  const request = await prisma.rpa_document_requests.findUnique({
    where: { token },
    include: { rpa_candidate_pipeline: { include: { rpa_shortlisted_candidates: true } } },
  });
  if (!request) throw new AppError('This document upload link is invalid.', 404);
  if (request.token_status === 'closed') {
    throw new AppError('This document upload link is closed. Please contact the recruitment team.', 410);
  }

  const doc = await prisma.rpa_candidate_documents.findFirst({
    where: { request_id: request.id, checklist_item_id: Number(checklistItemId) },
  });
  if (!doc) throw new AppError('That document is not part of this request.', 400);
  if (doc.status === 'verified') {
    throw new AppError('This document has already been verified and cannot be replaced.', 409);
  }

  const pipeline = request.rpa_candidate_pipeline;
  let fileUrl;
  try {
    fileUrl = await uploadFileToOneDrive(file.path, file.originalname, {
      folderPath: ['Document Collection', candidateFolderName(pipeline)],
    });
  } catch (err) {
    // A storage failure is ours, not the candidate's — they see a plain message
    // on a public page while the Graph detail goes to the log for us.
    logger.error(`Document upload to OneDrive failed for pipeline ${pipeline.id}: ${err.message}`);
    throw new AppError('We could not save your file just now. Please try again in a moment.', 502);
  } finally {
    // The local temp copy is never the record of truth — OneDrive is.
    fs.promises.unlink(file.path).catch(() => {});
  }

  const updated = await prisma.rpa_candidate_documents.update({
    where: { id: doc.id },
    data: {
      file_url: fileUrl,
      original_name: file.originalname.slice(0, 255),
      uploaded_at: new Date(),
      status: 'uploaded',
      // Clear the previous rejection reason — it no longer applies to this file.
      remarks: null,
      verified_by: null,
      verified_at: null,
      modified_at: new Date(),
    },
  });

  // The candidate acted on a public link — nobody on the team is watching, so
  // the bell is the only thing that surfaces "this needs verifying".
  const itemLabel = (await prisma.rpa_document_checklist_items.findUnique({
    where: { id: Number(checklistItemId) }, select: { label: true },
  }))?.label || 'A document';
  await notify({
    type: NOTIFICATION_TYPES.DOCUMENT_UPLOADED,
    title: 'Document uploaded — needs verification',
    description: `${pipeline?.rpa_shortlisted_candidates?.candidate_name || 'A candidate'} uploaded ${itemLabel}`,
    pipelineId: pipeline.id,
    meta: { checklist_item_id: Number(checklistItemId) },
  });

  logger.info(`Document uploaded: pipeline ${pipeline.id}, item ${checklistItemId}.`);
  return { id: Number(updated.id), status: updated.status, original_name: updated.original_name };
}

/**
 * HR marks one uploaded document as verified. Completeness is automatic;
 * authenticity is this human judgement (02-BUSINESS-DESIGN.md §3).
 * @param {number} documentId
 * @param {object} params
 * @param {number} params.actedBy
 */
export async function verifyDocument(documentId, { actedBy } = {}) {
  const doc = await prisma.rpa_candidate_documents.findUnique({
    where: { id: BigInt(documentId) },
    include: { rpa_document_requests: true, rpa_document_checklist_items: true },
  });
  if (!doc) throw new AppError('Document not found.', 404);
  if (doc.status !== 'uploaded') {
    throw new AppError('Only an uploaded document can be verified.', 400);
  }

  await prisma.rpa_candidate_documents.update({
    where: { id: doc.id },
    data: { status: 'verified', remarks: null, verified_by: actedBy || null, verified_at: new Date(), modified_at: new Date() },
  });

  const pipelineId = doc.rpa_document_requests.pipeline_id;
  await auditNote(pipelineId, `Document verified: ${doc.rpa_document_checklist_items?.label || 'document'}`, actedBy);

  // When the last item flips to verified the checklist is complete and the
  // offer can go out — worth its own notification rather than making someone
  // re-open the drawer to notice.
  const remaining = await prisma.rpa_candidate_documents.count({
    where: { request_id: doc.request_id, status: { not: 'verified' } },
  });
  if (remaining === 0) {
    // Close the public link. `token_status` existed from the start but nothing
    // ever wrote 'closed', so a no-login upload URL emailed once stayed live
    // forever — past verification, past closure, past the hire. The checklist
    // being complete is the natural expiry: there is nothing left to upload.
    // A later rejection re-opens it (see rejectDocument), which is why this is
    // a status flip rather than a token rotation.
    await prisma.rpa_document_requests.update({
      where: { id: doc.request_id },
      data: { token_status: 'closed', modified_at: new Date() },
    });

    const pipelineRow = await prisma.rpa_candidate_pipeline.findUnique({
      where: { id: pipelineId },
      include: { rpa_shortlisted_candidates: { select: { candidate_name: true } } },
    });
    await notify({
      type: NOTIFICATION_TYPES.DOCUMENT_ALL_VERIFIED,
      title: 'All documents verified',
      description: `${pipelineRow?.rpa_shortlisted_candidates?.candidate_name || 'A candidate'} — the offer can now be rolled out`,
      pipelineId,
      excludeUserId: actedBy || null,
    });
  }

  return getDocumentStatus(Number(pipelineId));
}

/**
 * HR rejects one uploaded document with a reason, which re-opens that item for
 * re-upload and emails the candidate the re-request.
 *
 * @param {number} documentId
 * @param {object} params
 * @param {string} params.reason - shown to the candidate, so it must be specific
 * @param {number} params.actedBy
 */
export async function rejectDocument(documentId, { reason, actedBy } = {}) {
  if (!(reason || '').trim()) {
    throw new AppError('A reason is required so the candidate knows what to re-upload.', 400);
  }

  const doc = await prisma.rpa_candidate_documents.findUnique({
    where: { id: BigInt(documentId) },
    include: { rpa_document_requests: true, rpa_document_checklist_items: true },
  });
  if (!doc) throw new AppError('Document not found.', 404);
  if (doc.status !== 'uploaded') {
    throw new AppError('Only an uploaded document can be rejected.', 400);
  }

  await prisma.rpa_candidate_documents.update({
    where: { id: doc.id },
    data: {
      status: 'rejected',
      remarks: reason.trim(),
      verified_by: actedBy || null,
      verified_at: new Date(),
      modified_at: new Date(),
    },
  });

  // Re-open the link: the checklist is no longer complete, and the re-request
  // email below sends the candidate straight back to this same URL. Without
  // this, a rejection following a completed checklist would email them a link
  // that answers 410.
  await prisma.rpa_document_requests.update({
    where: { id: doc.request_id },
    data: { token_status: 'active', modified_at: new Date() },
  });

  const pipelineId = doc.rpa_document_requests.pipeline_id;
  const label = doc.rpa_document_checklist_items?.label || 'document';

  // Automatic re-request: the candidate is told what to fix, on the same link.
  const pipeline = await loadPipeline(Number(pipelineId));
  const sent = await sendDocumentEmail(TEMPLATE_NAMES.reminder, pipeline, doc.rpa_document_requests.token, {
    rejected_document: label,
    rejection_reason: reason.trim(),
  });

  // This IS a reminder as far as the candidate's inbox is concerned, so tell the
  // sweep about it. It sends the same template on the same link; without the
  // stamp the daily pass saw an untouched last_reminded_at and could chase them
  // again hours after this one landed. Deliberately does NOT increment
  // reminder_count — a rejection raised by HR should not eat the candidate's
  // reminder budget.
  if (sent) {
    await prisma.rpa_document_requests.update({
      where: { id: doc.request_id },
      data: { last_reminded_at: new Date(), modified_at: new Date() },
    });
  }

  await auditNote(
    pipelineId,
    `Document rejected: ${label} — ${reason.trim()}${sent ? ' (re-request emailed)' : ' (re-request email failed)'}`,
    actedBy
  );
  return getDocumentStatus(Number(pipelineId));
}
