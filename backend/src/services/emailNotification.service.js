
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import config from '../config/index.js';
import { getAccessToken } from './onedrive.service.js';



/**
 * Sends a HTML email using the Microsoft Graph API.
 * Uses Client Credentials flow token.
 * 
 * @param {Object} params
 * @param {string} params.sender - The user mailbox to send from
 * @param {string} params.to - Comma-separated list of recipient emails
 * @param {string} params.subject - Subject line of the email
 * @param {string} params.html - HTML email body content
 * @returns {Promise<boolean>}
 */
async function sendGraphEmail({ sender, to, subject, html }) {
  const defaultSender = config.microsoft.defaultSender || 'pkmondal@aapnainfotech.com';
  const requestedSender = sender || defaultSender;

  try {
    return await executeSend(requestedSender);
  } catch (err) {
    const isInvalidUserError = err.message.includes('ErrorInvalidUser') || 
                               err.message.includes('ErrorInvalidMailbox') || 
                               err.message.includes('ResourceNotFound') || 
                               err.message.includes('Not Found');

    if (requestedSender.toLowerCase() !== defaultSender.toLowerCase() && isInvalidUserError) {
      logger.warn(`MS Graph Email: Sender "${requestedSender}" failed (not found/invalid in tenant). Retrying with default sender "${defaultSender}"...`);
      try {
        return await executeSend(defaultSender);
      } catch (retryErr) {
        logger.error(`MS Graph Email: Retry with default sender failed: ${retryErr.message}`);
        throw retryErr;
      }
    }
    throw err;
  }

  async function executeSend(activeSender) {
    const accessToken = await getAccessToken();
    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(activeSender)}/sendMail`;
    
    // Clean and split recipients
    const toRecipients = to
      .split(',')
      .map(email => email.trim())
      .filter(email => email.length > 0)
      .map(email => ({
        emailAddress: { address: email }
      }));

    if (toRecipients.length === 0) {
      throw new Error('No valid recipients provided.');
    }

    const payload = {
      message: {
        subject,
        body: {
          contentType: 'HTML',
          content: html
        },
        toRecipients
      },
      saveToSentItems: 'true'
    };

    logger.info(`MS Graph Email: Attempting to send email from "${activeSender}" to "${to}"...`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Graph sendMail failed: ${response.statusText}. ${JSON.stringify(errorData)}`);
    }

    logger.info(`MS Graph Email: Email successfully sent from ${activeSender}`);
    return true;
  }
}

/**
 * Helper to replace placeholders. Supports both {{placeholder}} and {placeholder} styles,
 * and handles position/job_title aliases.
 */
export function compileTemplate(subject, bodyHtml, replacements) {
  let compiledSubject = subject;
  let compiledBody = bodyHtml;

  // Normalize replacements keys to support alternative naming
  const allReplacements = { ...replacements };
  if (replacements.job_title && !replacements.position) {
    allReplacements.position = replacements.job_title;
  }
  if (replacements.position && !replacements.job_title) {
    allReplacements.job_title = replacements.position;
  }

  for (const [key, val] of Object.entries(allReplacements)) {
    const stringVal = val !== undefined && val !== null ? String(val) : '';
    // replace {{key}}
    compiledSubject = compiledSubject.split(`{{${key}}}`).join(stringVal);
    compiledBody = compiledBody.split(`{{${key}}}`).join(stringVal);
    // replace {key}
    compiledSubject = compiledSubject.split(`{${key}}`).join(stringVal);
    compiledBody = compiledBody.split(`{${key}}`).join(stringVal);
  }

  return { subject: compiledSubject, html: compiledBody };
}



/**
 * Sends a welcome email to a new candidate.
 * In staging/dev environments, the email is sent to staging team overrides.
 */
export async function sendWelcomeEmail(candidate, hrUserEmail) {
  try {
    const sender = hrUserEmail || config.microsoft.defaultSender;
    
    // Staging override logic
    let toEmail = candidate.EmailID || '';
    if (config.env !== 'production') {
      toEmail = config.microsoft.stagingRecipients;
      logger.info(`Staging Mode: Welcome email target redirected from "${candidate.EmailID}" to "${toEmail}"`);
    }

    if (!toEmail) {
      logger.warn(`Skipping welcome email: No recipient email address available.`);
      return false;
    }

    const template = await prisma.rpa_email_templates.findFirst({
      where: { name: 'Welcome Candidate Email', is_active: true }
    });
    if (!template) {
      throw new Error('Welcome Candidate Email template not found in database.');
    }

    const { subject, html } = compileTemplate(template.subject, template.body_html, {
      candidate_name: candidate.Name || 'Candidate'
    });

    // 1) Send email
    await sendGraphEmail({ sender, to: toEmail, subject, html });

    // 2) Log to rpa_email_log
    await prisma.rpa_email_log.create({
      data: {
        email_type: 'welcome',
        recipient_email: toEmail,
        recipient_name: candidate.Name || 'Candidate',
        subject,
        body_html: html,
        reference_id: candidate.id ? Number(candidate.id) : null,
        sent_at: new Date()
      }
    });

    return true;
  } catch (err) {
    logger.error(`Failed to send welcome email for candidate ID ${candidate?.id}: ${err.message}`);
    return false;
  }
}

/**
 * Sends a missing data collection email to a candidate.
 * Generates a base64 encoded token from the email for validation.
 */
export async function sendMissingDataEmail(candidate, hrUserEmail) {
  try {
    const sender = hrUserEmail || config.microsoft.defaultSender;
    
    let toEmail = candidate.EmailID || '';
    if (config.env !== 'production') {
      toEmail = config.microsoft.stagingRecipients;
      logger.info(`Staging Mode: Missing data email target redirected from "${candidate.EmailID}" to "${toEmail}"`);
    }

    if (!toEmail) {
      logger.warn(`Skipping missing data email: No recipient email address available.`);
      return false;
    }

    // Generate token from email (base64)
    const token = Buffer.from(candidate.EmailID || '').toString('base64');
    const weblink = `${config.cors.frontendUrl}/missing-jd-upload?token=${token}`;

    const template = await prisma.rpa_email_templates.findFirst({
      where: { name: 'Missing Profile Data Collection', is_active: true }
    });
    if (!template) {
      throw new Error('Missing Profile Data Collection template not found.');
    }

    const { subject, html } = compileTemplate(template.subject, template.body_html, {
      candidate_name: candidate.Name || 'Candidate',
      upload_link: weblink
    });

    // 1) Send email
    await sendGraphEmail({ sender, to: toEmail, subject, html });

    // 2) Log to rpa_email_log
    await prisma.rpa_email_log.create({
      data: {
        email_type: 'data_collection',
        recipient_email: toEmail,
        recipient_name: candidate.Name || 'Candidate',
        subject,
        body_html: html,
        reference_id: candidate.id ? Number(candidate.id) : null,
        sent_at: new Date()
      }
    });

    // 3) Update token in rpa_cv
    await prisma.rpa_cv.update({
      where: { id: BigInt(candidate.id) },
      data: {
        cvMissingToken: token,
        cvMissingTokenStatus: 'SENT'
      }
    });

    logger.info(`Missing data email sent & logged for candidate ID ${candidate.id}`);
    return true;
  } catch (err) {
    logger.error(`Failed to send missing data email for candidate ID ${candidate?.id}: ${err.message}`);
    return false;
  }
}

/**
 * Alerts the HR team that a candidate's email ID was missing.
 */
export async function sendEmailIdNullAlert(candidateName, hrUserEmail) {
  try {
    const sender = hrUserEmail || config.microsoft.defaultSender;
    const toEmail = config.microsoft.hrAlertsRecipients;
    
    if (!toEmail) {
      logger.warn(`Skipping email null alert: No recipient configured.`);
      return false;
    }

    const template = await prisma.rpa_email_templates.findFirst({
      where: { name: 'Email ID Null Alert (Internal HR)', is_active: true }
    });
    if (!template) {
      throw new Error('Email ID Null Alert template not found.');
    }

    const { subject, html } = compileTemplate(template.subject, template.body_html, {
      candidate_name: candidateName || 'Candidate'
    });

    await sendGraphEmail({ sender, to: toEmail, subject, html });

    await prisma.rpa_email_log.create({
      data: {
        email_type: 'email_null_alert',
        recipient_email: toEmail,
        recipient_name: 'HR Team',
        subject,
        body_html: html,
        sent_at: new Date()
      }
    });

    return true;
  } catch (err) {
    logger.error(`Failed to send email null alert for candidate ${candidateName}: ${err.message}`);
    return false;
  }
}

/**
 * Sends duplicate resume detection alert to HR and administrator.
 */
export async function sendDuplicateAlertEmail(candidate, hrUserEmail) {
  try {
    const sender = config.microsoft.defaultSender;
    
    let toEmail = hrUserEmail ? `${hrUserEmail}, pkmondal@aapnainfotech.com` : 'pkmondal@aapnainfotech.com';
    
    const template = await prisma.rpa_email_templates.findFirst({
      where: { name: 'Duplicate Resume Alert (Internal HR)', is_active: true }
    });
    if (!template) {
      throw new Error('Duplicate Resume Alert template not found.');
    }

    const { subject, html } = compileTemplate(template.subject, template.body_html, {
      candidate_name: candidate.Name || 'Candidate',
      candidate_email: candidate.EmailID || 'Null',
      candidate_phone: candidate.ContactNumber || 'Null'
    });

    await sendGraphEmail({ sender, to: toEmail, subject, html });

    await prisma.rpa_email_log.create({
      data: {
        email_type: 'duplicate_alert',
        recipient_email: toEmail,
        recipient_name: 'HR Team / Admin',
        subject,
        body_html: html,
        reference_id: candidate.id ? Number(candidate.id) : null,
        sent_at: new Date()
      }
    });

    return true;
  } catch (err) {
    logger.error(`Failed to send duplicate resume alert email: ${err.message}`);
    return false;
  }
}

/**
 * Sends duplicate resume alert to the same vendor.
 */
export async function sendSameVendorDuplicateAlert({ candidateName, candidateEmail, vendorEmail, vendorName }) {
  try {
    const sender = config.microsoft.defaultSender;
    
    // Redirect to staging recipients if not in production
    let toEmail = vendorEmail || '';
    if (config.env !== 'production') {
      toEmail = config.microsoft.stagingRecipients;
      logger.info(`Staging Mode: Same vendor duplicate alert redirected from "${vendorEmail}" to "${toEmail}"`);
    }

    if (!toEmail) {
      logger.warn(`Skipping same vendor alert: No recipient email address available.`);
      return false;
    }

    const template = await prisma.rpa_email_templates.findFirst({
      where: { name: 'Same Vendor Duplicate Alert', is_active: true }
    });
    if (!template) {
      throw new Error('Same Vendor Duplicate Alert template not found.');
    }

    const { subject, html } = compileTemplate(template.subject, template.body_html, {
      vendor_name: vendorName || 'Vendor Partner',
      candidate_name: candidateName || 'Candidate',
      candidate_email: candidateEmail || ''
    });

    await sendGraphEmail({ sender, to: toEmail, subject, html });

    await prisma.rpa_email_log.create({
      data: {
        email_type: 'vendor_same_duplicate',
        recipient_email: toEmail,
        recipient_name: vendorName || 'Vendor Partner',
        subject,
        body_html: html,
        sent_at: new Date()
      }
    });

    return true;
  } catch (err) {
    logger.error(`Failed to send same vendor duplicate email: ${err.message}`);
    return false;
  }
}

/**
 * Sends duplicate resume alert to a different vendor.
 */
export async function sendDifferentVendorDuplicateAlert({ candidateName, candidateEmail, vendorEmail, vendorName, existingVendorEmail }) {
  try {
    const sender = config.microsoft.defaultSender;
    
    // Redirect to staging recipients if not in production
    let toEmail = vendorEmail || '';
    if (config.env !== 'production') {
      toEmail = config.microsoft.stagingRecipients;
      logger.info(`Staging Mode: Different vendor duplicate alert redirected from "${vendorEmail}" to "${toEmail}"`);
    }

    if (!toEmail) {
      logger.warn(`Skipping different vendor alert: No recipient email address available.`);
      return false;
    }

    const template = await prisma.rpa_email_templates.findFirst({
      where: { name: 'Different Vendor Duplicate Alert', is_active: true }
    });
    if (!template) {
      throw new Error('Different Vendor Duplicate Alert template not found.');
    }

    const { subject, html } = compileTemplate(template.subject, template.body_html, {
      vendor_name: vendorName || 'Vendor Partner',
      candidate_name: candidateName || 'Candidate'
    });

    await sendGraphEmail({ sender, to: toEmail, subject, html });

    await prisma.rpa_email_log.create({
      data: {
        email_type: 'vendor_diff_duplicate',
        recipient_email: toEmail,
        recipient_name: vendorName || 'Vendor Partner',
        subject,
        body_html: html,
        sent_at: new Date()
      }
    });

    return true;
  } catch (err) {
    logger.error(`Failed to send different vendor duplicate email: ${err.message}`);
    return false;
  }
}
