
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

/**
 * Sends an MRF request email to the Hiring Manager.
 * Replicates the "Code - Dynamically Anchor/MRF Link ADD" node logic from n8n.
 */
export async function sendMrfRequestEmail({ first_name, last_name, email, cc_email, role, jd_doc_link, email_body_content, budget_min, budget_max, reference_id, frontendUrl }) {
  try {
    const sender = config.microsoft.defaultSender;
    
    let toEmail = email || '';
    let ccEmail = cc_email || '';
    
    if (config.env !== 'production') {
      toEmail = config.microsoft.stagingRecipients;
      ccEmail = ''; // Clear CC in staging
      logger.info(`Staging Mode: MRF request email target redirected from "${email}" to "${toEmail}"`);
    }

    if (!toEmail) {
      logger.warn(`Skipping MRF request email: No recipient email address available.`);
      return false;
    }

    // Generate Safe Encoded MRF URL pointing to local React frontend
    const baseUrl = frontendUrl || config.cors.frontendUrl;
    const MRF_FORM_URL = `${baseUrl}/mrf-submit?role=${encodeURIComponent(role)}&emailid=${encodeURIComponent(email)}`;

    // Compile email body content (handling newlines to br tags)
    let introParagraph = '';
    if (typeof email_body_content === 'string' && email_body_content.trim() !== '' && email_body_content.trim() !== 'empty') {
      let cleanedContent = email_body_content.replace(/^"+/, '').replace(/"+$/, '');
      cleanedContent = cleanedContent
        .replace(/\r\n/g, '\n')
        .replace(/\n\n/g, '<br><br>')
        .replace(/\n/g, '<br>');
      introParagraph = cleanedContent;
    } else {
      introParagraph = `As discussed, we would like to initiate the hiring process for the <strong>${role}</strong> position.<br><br>We request you to kindly fill out the Manpower Requisition Form (MRF) using the link below. This will help us clearly capture the role requirements and move forward with job creation and publishing.`;
    }

    // Build final HTML body
    const finalEmailBody = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{background:#f4f6f9;font-family:Arial,sans-serif;color:#1a1a2e;}
.wrapper{max-width:620px;margin:28px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);}
.top-bar{background:#7a922e;height:5px;}
.header{padding:28px 40px 22px;text-align:center;border-bottom:1px solid #e8ede0;}
.brand-mark{font-size:13px;font-weight:700;color:#7a922e;letter-spacing:1px;margin-bottom:4px;}
.brand-mark span{color:#1a1a2e;}
.cmmi{font-size:9px;font-weight:700;letter-spacing:3px;color:#7a922e;text-transform:uppercase;margin-bottom:14px;}
.logo-img{height:48px;}
.body{padding:32px 40px;}
.greeting{font-size:16px;font-weight:700;color:#1a1a2e;margin-bottom:14px;}
.intro{font-size:14px;color:#444;line-height:1.8;margin-bottom:26px;}
.divider{border:none;border-top:1px solid #e8ede0;margin:0 0 24px;}
.action-card{border:1px solid #e8ede0;border-left:4px solid #7a922e;border-radius:8px;padding:18px 20px;margin-bottom:14px;background:#f9fbf5;}
.action-label{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#7a922e;margin-bottom:6px;}
.action-desc{font-size:13px;color:#555;line-height:1.65;margin-bottom:14px;}
.btn{display:inline-block;background:#7a922e;color:#ffffff!important;text-decoration:none;padding:10px 22px;border-radius:6px;font-size:13px;font-weight:700;}
.btn-outline{display:inline-block;background:#fff;color:#7a922e!important;text-decoration:none;padding:9px 22px;border-radius:6px;font-size:13px;font-weight:700;border:1.5px solid #7a922e;}
.note{margin-top:22px;padding:13px 16px;background:#fffdf0;border:1px solid #e8ede0;border-left:3px solid #7a922e;border-radius:6px;font-size:13px;color:#555;line-height:1.65;}
.footer{background:#f4f6f9;border-top:1px solid #e8ede0;padding:20px 40px;text-align:center;}
.footer-tagline{font-size:11px;font-style:italic;color:#7a922e;margin-bottom:6px;}
.footer-text{font-size:11px;color:#999;line-height:1.7;}
.footer-copy{font-size:10px;color:#bbb;margin-top:8px;}
</style>
</head>
<body>
<div class="wrapper">
  <div class="top-bar"></div>
  <div class="header">
    <div class="brand-mark">◆ aapna<span>®</span></div>
    <div class="cmmi">CMMIDEV/3 &nbsp;|&nbsp; CERTIFIED</div>
    <img class="logo-img" src="https://www.aapnainfotech.com/wp-content/uploads/2021/09/aapna-gptw-black.png" alt="AAPNA Infotech"/>
  </div>
  <div class="body">
    <p class="greeting">Dear ${first_name},</p>
    <div class="intro">${introParagraph}</div>
    <hr class="divider"/>
    <div class="action-card">
      <div class="action-label">📄 Step 1 — Review the JD</div>
      <div class="action-desc">We are sharing the existing Job Description for your reference. Please review and let us know if any changes are required. <strong>Kindly upload the updated/final JD in the MRF (Step 2).</strong></div>
      <a class="btn-outline" href="${jd_doc_link}" target="_blank">View Job Description →</a>
    </div>
    <div class="action-card">
      <div class="action-label">📋 Step 2 — Fill the MRF & Upload JD</div>
      <div class="action-desc">Please open and complete the Manpower Requisition Form. <strong>Upload the actual Job Description</strong> directly within the form before submitting.</div>
      <a class="btn" href="${MRF_FORM_URL}" target="_blank">Open MRF →</a>
    </div>
    <div class="note">
      💡 Once the form is submitted & approved, we will proceed with creating and publishing the job opening. Please feel free to reach out if you need any assistance while completing the form.
    </div>
    <br/>
    <p style="font-size:14px;color:#444;line-height:1.8;">Warm regards,<br/><strong>HR Team</strong><br/>AAPNA Infotech</p>
  </div>
  <div class="footer">
    <p class="footer-tagline">Where Culture, Code, and Courage Come Together</p>
    <p class="footer-text">This email was sent via AAPNA Infotech's Recruitment Portal.</p>
    <p class="footer-copy">© 2025 AAPNA Infotech. All rights reserved.</p>
  </div>
</div>
</body>
</html>`;

    // CC recipients addition: we pass combined comma-separated string to to parameter
    const recipients = ccEmail ? `${toEmail}, ${ccEmail}` : toEmail;
    const subject = `New MRF Request`;

    await sendGraphEmail({
      sender,
      to: recipients,
      subject,
      html: finalEmailBody
    });

    // Log to rpa_email_log
    await prisma.rpa_email_log.create({
      data: {
        email_type: 'mrf_hm',
        recipient_email: toEmail,
        recipient_name: `${first_name} ${last_name}`,
        subject,
        body_html: finalEmailBody,
        reference_id: reference_id ? Number(reference_id) : null,
        sent_at: new Date()
      }
    });

    logger.info(`MRF request email sent and logged for MRF ID: ${reference_id}`);
    return true;
  } catch (err) {
    logger.error(`Failed to send MRF request email for ${first_name} ${last_name}: ${err.message}`);
    return false;
  }
}

/**
 * Sends an MRF approval request email to Abhijit Roy (and other leaders).
 */
export async function sendMrfApprovalEmail({ mrfRecord, token, frontendUrl }) {
  try {
    const sender = config.microsoft.defaultSender;
    
    // Target recipients
    let toEmail = 'hmopuri@aapnainfotech.com, saukumar@aapnainfotech.com, pkmondal@aapnainfotech.com';
    
    if (config.env !== 'production') {
      toEmail = config.microsoft.stagingRecipients;
      logger.info(`Staging Mode: MRF approval email target redirected to "${toEmail}"`);
    }

    const baseUrl = frontendUrl || config.cors.frontendUrl;
    const approveLink = `${baseUrl}/mrf/${mrfRecord.id}/approve?action=approve&token=${token}`;
    const rejectLink = `${baseUrl}/mrf/${mrfRecord.id}/approve?action=reject&token=${token}`;

    let introText = `We have received a new Manpower Requisition Form (MRF) request for your review and approval.<br><br>
Kindly review the filled MRF and the attached Job Description and share your approval.
Please review the filled MRF and attached JD and confirm your approval. Also, let us know whether this should be a permanent role or a different engagement model.<br><br>
Also, please help define the priority of the role (High / Moderate / Low) as per the business need.`;

    const template = await prisma.rpa_email_templates.findFirst({
      where: { name: 'MRF Approval Request', is_active: true }
    });

    if (template && template.body_html) {
      introText = template.body_html;
    }

    const actionButtonsHtml = `
      <div style="margin: 24px 0; text-align: center;">
        <a href="${approveLink}" style="background-color: #7a922e; color: #ffffff !important; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; margin-right: 15px; display: inline-block;">Approve Requisition</a>
        <a href="${rejectLink}" style="background-color: #d9534f; color: #ffffff !important; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Reject Requisition</a>
      </div>
    `;

    const greeting = `Dear Abhijit Roy & Sanghamitra Roy,`;
    const tableBody = mrfRecord.emailbody || '';

    const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<style>
body { font-family: Calibri, Arial, sans-serif; font-size: 14px; color: #333; line-height: 1.6; }
.wrapper { max-width: 650px; margin: 20px auto; border: 1px solid #e8ede0; border-radius: 8px; padding: 25px; background: #fff; }
.header { border-bottom: 2px solid #7a922e; padding-bottom: 15px; margin-bottom: 20px; }
.logo { font-size: 20px; font-weight: bold; color: #7a922e; }
.intro { font-size: 14px; margin-bottom: 20px; }
</style>
</head>
<body>
<div class="wrapper">
  <div class="header">
    <div class="logo">AAPNA Requisition Portal</div>
  </div>
  <p><strong>${greeting}</strong></p>
  <div class="intro">${introText}</div>
  ${actionButtonsHtml}
  <hr style="border: none; border-top: 1px solid #e8ede0; margin: 20px 0;"/>
  ${tableBody}
</div>
</body>
</html>
    `;

    const subject = template && template.subject ? template.subject : `New MRF Request - Approval Request`;

    await sendGraphEmail({
      sender,
      to: toEmail,
      subject,
      html
    });

    // Log to rpa_email_log
    await prisma.rpa_email_log.create({
      data: {
        email_type: 'mrf_approval_request',
        recipient_email: toEmail,
        recipient_name: 'Abhijit Roy & Sanghamitra Roy',
        subject,
        body_html: html,
        reference_id: Number(mrfRecord.id),
        sent_at: new Date()
      }
    });

    logger.info(`MRF approval request email sent and logged for MRF ID: ${mrfRecord.id}`);
    return true;
  } catch (err) {
    logger.error(`Failed to send MRF approval request email for MRF ID ${mrfRecord?.id}: ${err.message}`);
    return false;
  }
}

/**
 * Sends a notification of the MRF approval or rejection outcome to the HR team.
 */
export async function sendMrfOutcomeEmail({ mrfRecord, approved, comments, approverName }) {
  try {
    const sender = config.microsoft.defaultSender;
    
    // Target recipients
    let toEmail = 'hmopuri@aapnainfotech.com, saukumar@aapnainfotech.com';
    
    if (config.env !== 'production') {
      toEmail = config.microsoft.stagingRecipients;
      logger.info(`Staging Mode: MRF outcome email target redirected to "${toEmail}"`);
    }

    const statusText = approved ? 'Approved' : 'Declined';
    const commentSection = comments 
      ? `<p><strong>Comment from Management:</strong> ${comments}</p>`
      : '';

    let outcomeBody = '';
    if (approved) {
      outcomeBody = `
<html>
  <body style="font-family: Calibri, sans-serif; font-size: 14px; color: #333;">
    <p>Hi Team,</p>
    <p>This is to formally inform you that Management has approved the request to proceed with the recruitment of additional manpower.</p>
    ${commentSection}
    <p>Please initiate the recruitment process as per company policies and the approved MRF details.</p>
    <p>Thank you for your continued support, and we look forward to timely updates on the progress.</p>
    <p>Best regards,<br>CEO, AAPNA</p>
  </body>
</html>
      `;
    } else {
      outcomeBody = `
<html>
  <body style="font-family: Calibri, sans-serif; font-size: 14px; color: #333;">
    <p>Hi Team,</p>
    <p>This is to formally inform you that Management has reviewed the request for additional manpower and has decided not to proceed with it at this time.</p>
    ${commentSection}
    <p>Accordingly, please place the recruitment activity on hold until further instructions.</p>
    <p>Thank you for your understanding.</p>
    <p>Best regards,<br>CEO, AAPNA</p>
  </body>
</html>
      `;
    }

    const html = `
      ${outcomeBody}
      <br><br>
      ---------- Forwarded message ---------<br>
      Subject: Re: New MRF Submission<br><br>
      ${mrfRecord.emailbody || ''}
    `;

    const subject = `${statusText}: New MRF Request`;

    await sendGraphEmail({
      sender,
      to: toEmail,
      subject,
      html
    });

    // Log to rpa_email_log
    await prisma.rpa_email_log.create({
      data: {
        email_type: approved ? 'mrf_approved' : 'mrf_declined',
        recipient_email: toEmail,
        recipient_name: 'HR Team',
        subject,
        body_html: html,
        reference_id: Number(mrfRecord.id),
        sent_at: new Date()
      }
    });

    logger.info(`MRF outcome email (${statusText}) sent and logged for MRF ID: ${mrfRecord.id}`);
    return true;
  } catch (err) {
    logger.error(`Failed to send MRF outcome email for MRF ID ${mrfRecord?.id}: ${err.message}`);
    return false;
  }
}


