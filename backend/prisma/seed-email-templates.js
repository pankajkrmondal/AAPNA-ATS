/**
 * Idempotent seed for all rpa_email_templates rows referenced by the code.
 *
 * Upserts the 12 templates looked up at runtime by emailNotification.service.js
 * and screening.service.js:
 *   - Shortlist Notification            (category 'shortlist')
 *   - Rejection — Post Interview        (category 'rejection')
 *   - Application On Hold               (by name)
 *   - Welcome Candidate Email           (by name) — full branded welcome, restored from the n8n original
 *   - Missing Profile Data Collection   (by name)
 *   - Email ID Null Alert (Internal HR) (by name)
 *   - Duplicate Resume Alert (Internal HR) (by name) — branded card, restored from the n8n original
 *   - Same Vendor Duplicate Alert       (by name)
 *   - Different Vendor Duplicate Alert  (by name)
 *   - Zeko Interview Scheduled Invitation (by name)
 *   - Zeko Interview Cancelled Alert    (by name)
 *   - MRF Approval Request              (by name) — intro paragraphs only; greeting/buttons are built in the service
 *
 * Legacy source of truth for the branded bodies: docs/reference/Email-Templates-Summary.md
 * (the n8n flow exports). Safe to run multiple times.
 *
 *   node prisma/seed-email-templates.js
 *
 * Notes:
 *  - compileTemplate() accepts both {key} and {{key}} tokens, so placeholder
 *    styles are kept exactly as each consumer already uses them.
 *  - The shortlist body uses {candidate_name} and {role_paragraph}; the service
 *    (shortlistCandidates) injects the JD vs keyword intro paragraph at send time.
 *  - Status templates use {candidate_name} and {position}.
 */
import prisma from '../src/config/database.js';

const SHORTLIST_SUBJECT = "You're Shortlisted -- Complete Your HR AI Interview | AAPNA Infotech";

const SHORTLIST_BODY = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AAPNA Recruitment</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:30px 10px;">
<tr><td align="center">
<table width="620" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,0.08);">
<tr><td style="background:#7a922e;padding:32px 40px;text-align:center;">
<img src="https://www.aapnainfotech.com/wp-content/uploads/2021/09/aapna-gptw-black.png" width="190" style="display:block;margin:0 auto 16px auto;">
<h1 style="margin:0;font-size:24px;color:#ffffff;font-weight:800;">Your Application Has Been Shortlisted 🎉</h1>
<p style="margin:6px 0 0 0;color:#e7f0c5;font-size:13px;">Where Culture, Code, and Courage Come Together</p>
</td></tr>
<tr><td style="padding:32px 40px 16px 40px;font-size:15px;color:#374151;line-height:1.7;">
<p style="margin:0 0 14px 0;">Dear <strong>{candidate_name}</strong>,</p>
<p style="margin:0 0 14px 0;">Greetings from <strong>AAPNA Infotech</strong>.</p>
{role_paragraph}
</td></tr>
<tr><td style="padding:0 40px;"><hr style="border:none;border-top:1px solid #e5e7eb;"></td></tr>
<tr><td style="padding:24px 40px;font-size:14px;color:#374151;line-height:1.7;">
<p>As the next step, you are required to complete an <strong>HR AI Interview through the Zeko HR platform</strong>. The interview link will be shared with you shortly in a separate email.</p>
<h3 style="margin-top:18px;color:#7a922e;">Important Instructions</h3>
<ul style="padding-left:18px;margin:10px 0;">
<li style="margin-bottom:6px;">Ensure you have a <strong>stable internet connection</strong>.</li>
<li style="margin-bottom:6px;">Use a <strong>laptop or desktop with webcam</strong>.</li>
<li style="margin-bottom:6px;">Fill all required details carefully.</li>
<li style="margin-bottom:6px;">Attend the interview <strong>without external help or AI tools</strong>.</li>
<li style="margin-bottom:6px;">Complete the interview <strong>in one sitting</strong>.</li>
<li style="margin-bottom:6px;">Finish within <strong>24–48 hours</strong>.</li>
</ul>
</td></tr>
<tr><td style="padding:0 40px 28px 40px;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f9eb;border-left:4px solid #7a922e;border-radius:8px;">
<tr><td style="padding:20px;font-size:14px;color:#374151;line-height:1.6;">
<strong style="color:#5a6e1f;font-size:15px;">Interview Process at AAPNA Infotech</strong>
<ol style="margin:12px 0 0 18px;">
<li>HR AI Interview (Zeko HR platform)</li>
<li>Evalground Technical Assessment</li>
<li>Zeko Functional / Coding Assessment</li>
<li>Technical Interview – Round 1</li>
<li>Technical Interview – Round 2</li>
<li>Final Discussion with HR / Leadership</li>
<li>Client Interview (if applicable)</li>
</ol>
</td></tr></table>
</td></tr>
<tr><td style="padding:0 40px 30px 40px;text-align:center;">
<p style="font-size:14px;color:#374151;margin-bottom:14px;">Before proceeding, please review our website.</p>
<a href="https://www.aapnainfotech.com/" style="display:inline-block;padding:12px 28px;background:#7a922e;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:700;font-size:14px;">Explore AAPNA Infotech</a>
</td></tr>
<tr><td style="padding:0 40px 32px 40px;font-size:14px;color:#6b7280;line-height:1.6;">
<p style="margin:0 0 4px 0;">Best regards,</p>
<p style="margin:0;font-weight:700;color:#7a922e;">AAPNA Infotech Recruitment Team</p>
</td></tr>
<tr><td style="background:#f3f4f6;padding:16px;text-align:center;font-size:12px;color:#9ca3af;">
This email was sent because your profile was submitted to AAPNA Infotech's recruitment system.<br>
© 2026 AAPNA Infotech. All rights reserved.
</td></tr>
</table>
</td></tr></table>
</body>
</html>`;

/** Branded wrapper for screening status updates (rejected / on hold). */
function statusBody(statusLabel, bodyParagraphs) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:30px 10px"><tr><td align="center"><table width="620" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,0.08)"><tr><td style="background:#7a922e;padding:32px 40px;text-align:center"><img src="https://www.aapnainfotech.com/wp-content/uploads/2021/09/aapna-gptw-black.png" width="190" style="display:block;margin:0 auto 16px auto"><h1 style="margin:0;font-size:22px;color:#ffffff;font-weight:800">${statusLabel}</h1><p style="margin:6px 0 0 0;color:#e7f0c5;font-size:13px">AAPNA Infotech - Recruitment Update</p></td></tr><tr><td style="padding:32px 40px 8px 40px;font-size:15px;color:#374151;line-height:1.8"><p>Dear <strong>{candidate_name}</strong>,</p><p>Greetings from <strong>AAPNA Infotech</strong>.</p>${bodyParagraphs}</td></tr><tr><td style="padding:0 40px 32px 40px;font-size:14px;color:#6b7280;line-height:1.6"><p style="margin:0 0 4px 0">Best regards,</p><p style="margin:0;font-weight:700;color:#7a922e">AAPNA Infotech Recruitment Team</p></td></tr><tr><td style="background:#f3f4f6;padding:16px;text-align:center;font-size:12px;color:#9ca3af">This email was sent by AAPNA Infotech's recruitment system.<br>© 2026 AAPNA Infotech. All rights reserved.</td></tr></table></td></tr></table></body></html>`;
}

const REJECTED_PARAS = `<p>After careful consideration of your profile, we regret to inform you that we are unable to move forward with your application for <strong>{position}</strong> at this time.</p><p>We truly appreciate the time and effort you invested in our process. We will keep your profile on file and encourage you to apply for future opportunities.</p><p>We wish you all the best in your career journey.</p>`;

const ONHOLD_PARAS = `<p>Thank you for your continued interest in the <strong>{position}</strong> position at AAPNA Infotech.</p><p>Your application is currently on hold while we complete our initial screening. We will reach out with an update as soon as possible.</p><p>We appreciate your patience.</p>`;

/** Branded candidate welcome — n8n "Send a message" (Resume 1.1.1 Intake), §1.1 of docs/reference/Email-Templates-Summary.md. */
const WELCOME_BODY = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Welcome to AAPNA Infotech</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f6f9;font-family:Arial,Helvetica,sans-serif;">

  <!-- Wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f6f9;padding:32px 0;">
    <tr>
      <td align="center">

        <!-- Email Card -->
        <table width="620" cellpadding="0" cellspacing="0" border="0" style="max-width:620px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">

          <!-- ===== HEADER ===== -->
          <tr>
            <td style="background-color:#7a922e;padding:36px 40px 28px 40px;text-align:center;">
              <!-- Text-based AAPNA logo - renders in ALL email clients -->
              <table cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 18px auto;">
                <tr>
                  <td style="background-color:#ffffff;border-radius:8px;padding:10px 24px;text-align:center;">
                    <span style="font-size:20px;color:#7a922e;font-weight:900;font-family:Arial,Helvetica,sans-serif;letter-spacing:-1px;">&#9670; aapna&#174;</span>
                    <br/>
                    <span style="font-size:9px;font-weight:700;color:#8a7230;font-family:Arial,Helvetica,sans-serif;letter-spacing:2px;">CMMIDEV/3 &nbsp; CERTIFIED</span>
                  </td>
                </tr>
              </table>
              <h1 style="margin:0;font-size:24px;font-weight:800;color:#ffffff;letter-spacing:-0.3px;font-family:Arial,Helvetica,sans-serif;">
                Welcome to AAPNA Infotech! &#127881;
              </h1>
              <p style="margin:8px 0 0 0;font-size:13px;color:#e8f0cc;font-style:italic;font-family:Arial,Helvetica,sans-serif;">
                Where Culture, Code, and Courage Come Together
              </p>
            </td>
          </tr>

          <!-- Black logo on white background - Outlook safe -->
          <tr>
            <td style="background-color:#ffffff;padding:20px 40px 0 40px;text-align:center;">
              <img
                src="https://www.aapnainfotech.com/wp-content/uploads/2021/09/aapna-gptw-black.png"
                alt="AAPNA Infotech - CMMIDEV/3 Certified | Great Place To Work"
                width="200"
                style="display:block;margin:0 auto;"
              />
            </td>
          </tr>

          <!-- ===== GREETING ===== -->
          <tr>
            <td style="padding:32px 40px 8px 40px;">
              <p style="margin:0 0 12px 0;font-size:16px;color:#111827;line-height:1.6;">
                Dear <strong>{{candidate_name}}</strong>,
              </p>
              <p style="margin:0 0 16px 0;font-size:15px;color:#374151;line-height:1.7;">
                Thank you for your interest in joining <strong>AAPNA Infotech</strong>. We have successfully received and registered your profile in our system. We're excited to learn more about you!
              </p>
              <p style="margin:0 0 0 0;font-size:15px;color:#374151;line-height:1.7;">
                Here's a little about who we are and why AAPNA might just be the best place you've ever worked. 👇
              </p>
            </td>
          </tr>

          <!-- ===== DIVIDER ===== -->
          <tr>
            <td style="padding:20px 40px 0 40px;">
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:0;"/>
            </td>
          </tr>

          <!-- ===== WHO WE ARE ===== -->
          <tr>
            <td style="padding:24px 40px 8px 40px;">
              <h2 style="margin:0 0 10px 0;font-size:17px;font-weight:700;color:#92a63c;">Who We Are</h2>
              <p style="margin:0;font-size:14px;color:#374151;line-height:1.7;">
                At AAPNA Infotech (<strong>CMMI Level 3 &amp; Microsoft Gold Partner</strong>), we create powerful enterprise software, deliver exceptional quality assurance, and build innovative tech products — trusted by global clients to get things done, fast and right.
              </p>
              <p style="margin:10px 0 0 0;font-size:14px;color:#374151;line-height:1.7;">
                Since our inception in <strong>2007</strong>, we've delivered high-performance solutions to clients across the <strong>US, Australia, and APAC</strong>. In 2021, we embraced the future and went <strong>100% remote – permanently.</strong> That's right – Work From Home. Forever.
              </p>
            </td>
          </tr>

          <!-- ===== WHY JOIN AAPNA ===== -->
          <tr>
            <td style="padding:24px 40px 8px 40px;">
              <h2 style="margin:0 0 14px 0;font-size:17px;font-weight:700;color:#92a63c;">Why Join AAPNA?</h2>
              <!-- Benefits table -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:6px 0;">
                    <table cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="font-size:18px;padding-right:10px;vertical-align:top;line-height:1.5;">✅</td>
                        <td style="font-size:14px;color:#374151;line-height:1.6;vertical-align:top;">100% Permanent Work-from-Home</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:6px 0;">
                    <table cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="font-size:18px;padding-right:10px;vertical-align:top;line-height:1.5;">✅</td>
                        <td style="font-size:14px;color:#374151;line-height:1.6;vertical-align:top;">Home Office Setup Support</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:6px 0;">
                    <table cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="font-size:18px;padding-right:10px;vertical-align:top;line-height:1.5;">✅</td>
                        <td style="font-size:14px;color:#374151;line-height:1.6;vertical-align:top;">People-First Culture with 150+ teammates across India</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:6px 0;">
                    <table cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="font-size:18px;padding-right:10px;vertical-align:top;line-height:1.5;">✅</td>
                        <td style="font-size:14px;color:#374151;line-height:1.6;vertical-align:top;">Great Place to Work® Certified with an impressive <strong>88 score</strong></td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:6px 0;">
                    <table cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="font-size:18px;padding-right:10px;vertical-align:top;line-height:1.5;">🏆</td>
                        <td style="font-size:14px;color:#374151;line-height:1.6;vertical-align:top;">200+ client testimonials | Top 100 Best Places to Work (2020–2022)</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ===== CULTURE ===== -->
          <tr>
            <td style="padding:24px 40px 8px 40px;">
              <h2 style="margin:0 0 10px 0;font-size:17px;font-weight:700;color:#92a63c;">Culture That Breathes Life</h2>
              <p style="margin:0 0 8px 0;font-size:14px;color:#374151;line-height:1.7;">
                At AAPNA, culture isn't a buzzword – it's a way of life.
              </p>
              <!-- IMPACT values box -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="background:#f0f4e8;border-left:4px solid #92a63c;border-radius:6px;padding:14px 18px;">
                    <p style="margin:0;font-size:14px;color:#374151;line-height:1.7;">
                      We live by our values: <strong style="color:#5a6e1f;">Integrity, Mastery, Passion, Act Now, Courage, and Forward Thinking</strong> — beautifully summed up in our internal transformation program: <strong>IMPACT</strong>.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ===== PRODUCTS ===== -->
          <tr>
            <td style="padding:24px 40px 8px 40px;">
              <h2 style="margin:0 0 10px 0;font-size:17px;font-weight:700;color:#92a63c;">Product Innovation @ AAPNA</h2>
              <p style="margin:0 0 12px 0;font-size:14px;color:#374151;line-height:1.7;">
                We don't just build software — we build smart solutions that solve real problems. Here are some of our in-house products making waves:
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:5px 0;font-size:14px;color:#374151;">
                    • <strong>Mera Monitor</strong> – Track Productivity, Respect Privacy
                  </td>
                </tr>
                <tr>
                  <td style="padding:5px 0;font-size:14px;color:#374151;">
                    • <strong>Fundoo Friday</strong> – Corporate engagement gamified
                  </td>
                </tr>
                <tr>
                  <td style="padding:5px 0;font-size:14px;color:#374151;">
                    • <strong>KaryaKeeper</strong> – Your ultimate task &amp; team manager
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ===== WHY PEOPLE CHOOSE AAPNA ===== -->
          <tr>
            <td style="padding:24px 40px 8px 40px;">
              <h2 style="margin:0 0 14px 0;font-size:17px;font-weight:700;color:#92a63c;">💡 Why People Choose AAPNA</h2>
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td style="padding:4px 0;font-size:14px;color:#374151;">• An unmatched WFH experience.</td></tr>
                <tr><td style="padding:4px 0;font-size:14px;color:#374151;">• Transparent and inspiring leadership.</td></tr>
                <tr><td style="padding:4px 0;font-size:14px;color:#374151;">• Work-life balance that actually exists.</td></tr>
                <tr><td style="padding:4px 0;font-size:14px;color:#374151;">• Focus on growth, wellness, and impact.</td></tr>
                <tr><td style="padding:4px 0;font-size:14px;color:#374151;">• A team that supports, uplifts, and celebrates YOU.</td></tr>
              </table>
            </td>
          </tr>

          <!-- ===== EXPLORE + DISCOVER ===== -->
          <tr>
            <td style="padding:24px 40px 8px 40px;">
              <h2 style="margin:0 0 10px 0;font-size:17px;font-weight:700;color:#92a63c;">Explore Our World</h2>
              <p style="margin:0 0 14px 0;">
                <a href="https://www.aapnainfotech.com" style="color:#92a63c;font-size:14px;text-decoration:none;font-weight:600;">www.aapnainfotech.com</a>
              </p>

              <h2 style="margin:0 0 10px 0;font-size:17px;font-weight:700;color:#92a63c;">Discover More</h2>
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td style="padding:4px 0;font-size:14px;"><a href="https://www.aapnainfotech.com/news" style="color:#92a63c;text-decoration:none;">• News Update - AAPNA Infotech</a></td></tr>
                <tr><td style="padding:4px 0;font-size:14px;"><a href="https://www.aapnainfotech.com/impact" style="color:#92a63c;text-decoration:none;">• IMPACT Program</a></td></tr>
                <tr><td style="padding:4px 0;font-size:14px;"><a href="https://www.aapnainfotech.com/fun" style="color:#92a63c;text-decoration:none;">• Fun @ AAPNA</a></td></tr>
                <tr><td style="padding:4px 0;font-size:14px;"><a href="https://www.aapnainfotech.com/culture" style="color:#92a63c;text-decoration:none;">• CULTURE @AAPNA (Video)</a></td></tr>
                <tr><td style="padding:4px 0;font-size:14px;"><a href="https://www.aapnainfotech.com/warcry" style="color:#92a63c;text-decoration:none;">• AAPNA WAR CRY</a></td></tr>
              </table>
            </td>
          </tr>

          <!-- ===== CLOSING MESSAGE ===== -->
          <tr>
            <td style="padding:24px 40px 8px 40px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="background:#f9fdf0;border:1px solid #d4e09a;border-radius:8px;padding:18px 20px;text-align:center;">
                    <p style="margin:0;font-size:15px;color:#374151;line-height:1.7;">
                      If you're ready to be part of something <strong>meaningful and fun</strong>, we'd love to know you better.<br/>
                      <strong style="color:#5a6e1f;">Let's build the future together.</strong>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ===== SIGNATURE ===== -->
          <tr>
            <td style="padding:24px 40px 32px 40px;">
              <p style="margin:0 0 4px 0;font-size:14px;color:#6b7280;">Best regards,</p>
              <p style="margin:0 0 2px 0;font-size:15px;font-weight:700;color:#92a63c;">AAPNA Infotech Recruitment Team</p>
            </td>
          </tr>

          <!-- ===== FOOTER ===== -->
          <tr>
            <td style="background:#f3f4f6;padding:16px 40px;text-align:center;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.6;">
                This email was sent because your profile was submitted to AAPNA Infotech's recruitment system.<br/>
                © 2025 AAPNA Infotech. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
        <!-- End Email Card -->

      </td>
    </tr>
  </table>

</body>
</html>`;

/** Candidate profile-completion request — n8n "Automated Email for data collection", §1.2. */
const MISSING_DATA_BODY = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
</head>
<body style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
  <p>Dear <strong>{{candidate_name}}</strong>,</p>
  <p>
    We have reviewed your resume and noticed that some important information is missing from your profile.
  </p>
  <p>
    To proceed further with your application, we request you to complete the required details using the link below:
  </p>
  <p style="margin: 20px 0;">
    <a href="{{upload_link}}" target="_blank"
       style="background-color: #1a73e8; color: #ffffff; padding: 10px 18px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;">
      Complete Your Profile
    </a>
  </p>
  <p>
    Please ensure that all mandatory fields are filled in accurately, as this will help us process your application without any delays.
  </p>
  <p>
    If you face any issues while submitting the form, please feel free to contact our HR team for assistance.
  </p>
  <br>
  <p>
    Best regards,<br>
    <strong style="color:#7a922e;">AAPNA Infotech Recruitment Team</strong>
  </p>
</body>
</html>`;

/** Internal HR alert when a parsed candidate has no email — resume rejected (sent as HTML). */
const EMAIL_NULL_BODY = `<p>Dear HR Team,</p>
<p>This is to inform you that the candidate's resume does not contain an email address. As the email ID is mandatory, the system could not process the resume and has rejected the CV.</p>
<p><strong>Candidate Name:</strong> {{candidate_name}}<br>
<strong>Uploaded By:</strong> {{uploaded_by}}</p>`;

/** Branded internal duplicate-resume alert — n8n "Outlook Mail: Send Duplicate Alert to HR", §1.7. */
const DUPLICATE_ALERT_BODY = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Duplicate Resume Detected</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f6f9;font-family:Arial,Helvetica,sans-serif;">

  <!-- Wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f6f9;padding:32px 0;">
    <tr>
      <td align="center">

        <!-- Email Card -->
        <table width="620" cellpadding="0" cellspacing="0" border="0" style="max-width:620px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">

          <!-- ===== HEADER ===== -->
          <tr>
            <td style="background-color:#7a922e;padding:36px 40px 28px 40px;text-align:center;">
              <!-- Text-based AAPNA logo -->
              <table cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 18px auto;">
                <tr>
                  <td style="background-color:#ffffff;border-radius:8px;padding:10px 24px;text-align:center;">
                    <span style="font-size:20px;color:#7a922e;font-weight:900;font-family:Arial,Helvetica,sans-serif;letter-spacing:-1px;">&#9670; aapna&#174;</span>
                    <br/>
                    <span style="font-size:9px;font-weight:700;color:#8a7230;font-family:Arial,Helvetica,sans-serif;letter-spacing:2px;">CMMIDEV/3 &nbsp; CERTIFIED</span>
                  </td>
                </tr>
              </table>
              <h1 style="margin:0;font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.3px;font-family:Arial,Helvetica,sans-serif;">
                Duplicate Resume Detected! ⚠️
              </h1>
              <p style="margin:8px 0 0 0;font-size:13px;color:#e8f0cc;font-style:italic;font-family:Arial,Helvetica,sans-serif;">
                Recruitment Automation System
              </p>
            </td>
          </tr>

          <!-- AAPNA Logo Image -->
          <tr>
            <td style="background-color:#ffffff;padding:20px 40px 0 40px;text-align:center;">
              <img
                src="https://www.aapnainfotech.com/wp-content/uploads/2021/09/aapna-gptw-black.png"
                alt="AAPNA Infotech - CMMIDEV/3 Certified | Great Place To Work"
                width="200"
                style="display:block;margin:0 auto;"
              />
            </td>
          </tr>

          <!-- ===== GREETING & BODY CONTENT ===== -->
          <tr>
            <td style="padding:32px 40px 8px 40px;">
              <p style="margin:0 0 12px 0;font-size:16px;color:#111827;line-height:1.6;">
                Dear <strong>Administrator</strong>,
              </p>
              <p style="margin:0 0 16px 0;font-size:15px;color:#374151;line-height:1.7;">
                This is to inform you that the candidate resume you uploaded already exists in our database.<br/>
                A duplicate record has been identified based on the email address and/or phone number provided.
              </p>
              <p style="margin:0 0 16px 0;font-size:15px;color:#374151;line-height:1.7;">
                In accordance with our duplicate detection policy, the candidate details have been securely captured and stored in the temporary review queue (<strong style="color:#7a922e;">rpa_cv_tmp</strong>) for your evaluation and necessary action.
              </p>
              <p style="margin:0 0 16px 0;font-size:15px;color:#374151;line-height:1.7;">
                Please review the entry in the queue and take the appropriate action as per the established workflow.
              </p>
              <p style="margin:0 0 16px 0;font-size:15px;color:#374151;line-height:1.7;">
                Thank you for your attention to this matter.
              </p>
            </td>
          </tr>

          <!-- ===== CANDIDATE DETAILS BOX ===== -->
          <tr>
            <td style="padding:12px 40px 12px 40px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f9fdf0;border:1px solid #d4e09a;border-radius:8px;padding:18px 20px;">
                <tr>
                  <td style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#374151;line-height:1.8;">
                    <strong style="color:#5a6e1f;font-size:15px;">🔍 Duplicate Candidate Profile:</strong><br/>
                    <hr style="border:0;border-top:1px solid #d4e09a;margin:8px 0;"/>
                    <strong>Candidate Name:</strong> {{candidate_name}}<br/>
                    <strong>Email ID:</strong> {{candidate_email}}<br/>
                    <strong>Contact Number:</strong> {{candidate_phone}}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ===== SIGNATURE ===== -->
          <tr>
            <td style="padding:24px 40px 32px 40px;">
              <p style="margin:0 0 4px 0;font-size:14px;color:#6b7280;">Best regards,</p>
              <p style="margin:0 0 2px 0;font-size:15px;font-weight:700;color:#7a922e;">AAPNA Infotech Recruitment Team</p>
            </td>
          </tr>

          <!-- ===== FOOTER ===== -->
          <tr>
            <td style="background:#f3f4f6;padding:16px 40px;text-align:center;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.6;">
                This email was generated automatically by AAPNA Infotech's recruitment automation system.<br/>
                © 2025 AAPNA Infotech. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
        <!-- End Email Card -->

      </td>
    </tr>
  </table>

</body>
</html>`;

/** Vendor-facing duplicate notice (same vendor re-submitted an owned candidate). */
const SAME_VENDOR_BODY = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Resume Already Submitted by You</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333333;">
    <h2 style="color: #7a922e;">Resume Already Exists</h2>
    <p>Dear {{vendor_name}},</p>
    <p>We wanted to inform you that the resume for <strong>{{candidate_name}}</strong> (Email: {{candidate_email}}) has already been submitted by you and exists in our system.</p>
    <p>Therefore, this submission has been marked as a duplicate and was not processed again.</p>
    <p>If you have any questions or believe this is in error, please contact the HR team.</p>
    <br>
    <p>Best regards,</p>
    <p><strong style="color:#7a922e;">AAPNA Infotech Recruitment Team</strong></p>
</body>
</html>`;

/** Vendor-facing duplicate notice (candidate is locked by another vendor). */
const DIFF_VENDOR_BODY = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Duplicate Resume Submission</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333333;">
    <p>Dear {{vendor_name}},</p>
    <p>Thank you for submitting the resume for <strong>{{candidate_name}}</strong>.</p>
    <p>We want to inform you that this candidate has already been submitted to our system by another vendor and is currently locked.</p>
    <p>As per our recruitment policy, this submission has been marked as a duplicate and will not be credited to your account.</p>
    <p>If you have any questions, please reach out to the HR team.</p>
    <br>
    <p>Best regards,</p>
    <p><strong style="color:#7a922e;">AAPNA Infotech Recruitment Team</strong></p>
</body>
</html>`;

/**
 * Zeko AI-interview invitation — n8n §6.1 (was disabled in n8n; active here).
 *
 * Stored as a FRAGMENT, not a full document. It used to carry its own blue
 * gradient header and no AAPNA logo, which made it the one candidate-facing
 * email with no AAPNA identity — and being a full document, wrapBrandedEmail()
 * skipped it. Now screening.service.js wraps it like every other send path, so
 * the green band, logo, signature and footer come from emailLayout.service.js.
 */
const ZEKO_SCHEDULED_BODY = `<p>Dear <strong>{{candidate_name}}</strong>,</p>
<p>We are pleased to invite you for an AI-powered video interview for the position of <strong>{{job_title}}</strong>.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;background:#f6f9eb;border-left:4px solid #7a922e;border-radius:8px;">
  <tr><td style="padding:16px 18px;">
  <p style="margin:0 0 10px 0;font-weight:700;color:#5a6e1f;">Interview schedule</p>
  <table style="font-size:14px;color:#374151;">
    <tr><td style="padding:4px 12px 4px 0;font-weight:600;">Start:</td><td>{{interview_start}}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;font-weight:600;">End:</td><td>{{interview_end}}</td></tr>
  </table>
  </td></tr>
</table>
<p>Please complete your interview within the scheduled window using the link below:</p>
<p style="margin:16px 0;"><a href="{{interview_link}}" target="_blank" style="background:#7a922e;color:#ffffff;padding:13px 28px;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;display:inline-block;">Start my interview</a></p>
<p style="font-size:13px;color:#6b7280;word-break:break-all;">Or copy this link: <a href="{{interview_link}}" style="color:#5a6e1f;">{{interview_link}}</a></p>
<p style="font-size:13px;color:#6b7280;">If you have any questions, please contact our HR team by replying to this email.</p>`;

/**
 * Zeko interview cancellation notice — n8n §6.2 plus a cancellation-reason line.
 * Fragment, for the same reason as the invitation above.
 */
const ZEKO_CANCELLED_BODY = `<p>Dear <strong>{{candidate_name}}</strong>,</p>
<p>We regret to inform you that your scheduled interview for the position of <strong>{{job_title}}</strong> ({{interview_stage}} Round) has been <strong>cancelled</strong>.</p>
<p><strong>Reason for cancellation:</strong> {{cancel_reason}}</p>
<p>We sincerely apologise for the inconvenience. Our HR team will contact you shortly to reschedule at the earliest possible opportunity.</p>
<p>Thank you for your patience and continued interest in joining AAPNA Infotech.</p>`;

/**
 * MRF approval intro shown to management — n8n §4.2 intro paragraphs.
 * The greeting, Approve/Decline buttons and MRF field table are built by
 * sendMrfApprovalEmail(); this template only overrides the intro text.
 */
const MRF_APPROVAL_BODY = `<p>We have received a new Manpower Requisition Form ( MRF ) request for your review and approval.</p><p><br></p><p>Kindly review the filled MRF and the attached Job Description and share your approval. Please review the filled MRF and attached JD and confirm your approval. Also, let us know whether this should be a permanent role or a different engagement model.</p><p><br></p><p>Also, please help define the priority of the role (High / Moderate / Low) as per the business need.</p>`;

// ── Technical-round interview scheduling (Module 2) ──────────────────────────
// Editable defaults for the Pipeline Tracker Schedule/Cancel actions, shown in
// the modal so the recruiter can tweak the text before it sends (same pattern
// as the stage-outcome emails). {{teams_line}} is injected by the service —
// it becomes a Join-Teams button when a link exists, or empty otherwise.

/** Candidate-facing interview invitation. */
const INTERVIEW_SCHED_CANDIDATE_BODY = `<p>Dear {{candidate_name}},</p>
<p>Your <strong>{{stage_label}}</strong> interview for <strong>{{position}}</strong> has been scheduled.</p>
<p><strong>When:</strong> {{interview_when}}<br/><strong>Duration:</strong> {{duration}} minutes</p>
{{teams_line}}
<p>Please be available a few minutes early. Reply to this email if the time does not work for you.</p>`;

/** Interviewer/panel-facing notice.
 *  {{interviewer_name}} resolves to the booking's interviewer, to "all" when more
 *  than one mailbox was invited, and to "there" when no name was captured — see
 *  interviewerGreeting() in services/interviewSchedule.service.js. It is never blank. */
const INTERVIEW_SCHED_PANEL_BODY = `<p>Hi {{interviewer_name}},</p>
<p>You are scheduled to take <strong>{{stage_label}}</strong> for <strong>{{candidate_name}}</strong> ({{position}}).</p>
<p><strong>When:</strong> {{interview_when}}<br/><strong>Duration:</strong> {{duration}} minutes<br/>
   <strong>Candidate email:</strong> {{candidate_email}}</p>
{{teams_line}}`;

/** Candidate-facing cancellation notice. */
const INTERVIEW_CANCEL_CANDIDATE_BODY = `<p>Dear {{candidate_name}},</p>
<p>Your <strong>{{stage_label}}</strong> interview scheduled for {{interview_when}} has been cancelled.</p>
{{reason_line}}
<p>We will be in touch with a new time shortly.</p>`;

/** Interviewer/panel-facing cancellation notice. */
const INTERVIEW_CANCEL_PANEL_BODY = `<p>Hi {{interviewer_name}},</p>
<p>The <strong>{{stage_label}}</strong> interview with <strong>{{candidate_name}}</strong> ({{position}}) scheduled for {{interview_when}} has been cancelled.</p>
{{reason_line}}`;

/** Candidate-facing reschedule notice — shows the OLD and NEW time together. */
const INTERVIEW_RESCHED_CANDIDATE_BODY = `<p>Dear {{candidate_name}},</p>
<p>Your <strong>{{stage_label}}</strong> interview for <strong>{{position}}</strong> has been <strong>rescheduled</strong>.</p>
<p><strong>Previous time:</strong> <span style="text-decoration:line-through;color:#888;">{{previous_when}}</span><br/>
   <strong>New time:</strong> {{interview_when}}<br/>
   <strong>Duration:</strong> {{duration}} minutes</p>
{{teams_line}}
<p>Please be available a few minutes early. Reply to this email if the new time does not work for you.</p>`;

/** Interviewer/panel-facing reschedule notice. */
const INTERVIEW_RESCHED_PANEL_BODY = `<p>Hi {{interviewer_name}},</p>
<p>The <strong>{{stage_label}}</strong> interview with <strong>{{candidate_name}}</strong> ({{position}}) has been <strong>rescheduled</strong>.</p>
<p><strong>Previous time:</strong> <span style="text-decoration:line-through;color:#888;">{{previous_when}}</span><br/>
   <strong>New time:</strong> {{interview_when}}<br/>
   <strong>Duration:</strong> {{duration}} minutes<br/>
   <strong>Candidate email:</strong> {{candidate_email}}</p>
{{teams_line}}`;

/** Pre-interview reminder — candidate. Sent by jobs/interviewReminder.js inside
 *  the configured lead-time window. Promoted from a hard-coded body so HR can
 *  edit the copy from the Email Templates page. */
const INTERVIEW_REMINDER_CANDIDATE_BODY = `<p>Dear {{candidate_name}},</p>
<p>This is a reminder that your <strong>{{stage_label}}</strong> interview for <strong>{{position}}</strong> starts shortly.</p>
<p><strong>When:</strong> {{interview_when}}</p>
{{teams_line}}
{{notes_line}}
<p>Please be ready a few minutes early.</p>`;

/** Pre-interview reminder — interviewer/panel. */
const INTERVIEW_REMINDER_PANEL_BODY = `<p>Hi {{interviewer_name}},</p>
<p>Your <strong>{{stage_label}}</strong> interview with <strong>{{candidate_name}}</strong> ({{position}}) starts shortly.</p>
<p><strong>When:</strong> {{interview_when}}<br/>
   <strong>Candidate email:</strong> {{candidate_email}}</p>
{{teams_line}}
{{notes_line}}`;

/** Scorecard invitation — technical interviewer. Sent once the interview is
 *  confirmed held; {{scorecard_link}} is the no-login single-use link. */
const SCORECARD_INVITE_INTERVIEWER_BODY = `<p>Hi {{interviewer_name}},</p>
<p>Thank you for interviewing <strong>{{candidate_name}}</strong> for <strong>{{position}}</strong> in the <strong>{{stage_label}}</strong> round.</p>
<p>Please submit your evaluation using the secure link below — <strong>no login is required</strong>. The candidate, position and round are already filled in for you.</p>
<p style="margin:16px 0;"><a href="{{scorecard_link}}" style="background:#7a922e;color:#fff;padding:11px 22px;text-decoration:none;border-radius:8px;font-weight:700;display:inline-block;">Open scorecard</a></p>
<p style="color:#888;font-size:13px;">This link works once and expires in a few days. Please submit before it lapses.</p>`;

/** Scorecard invitation — HR / CEO round (same secure-link mechanics). */
const SCORECARD_INVITE_HRCEO_BODY = `<p>Hi {{interviewer_name}},</p>
<p>Thank you for the <strong>{{stage_label}}</strong> round with <strong>{{candidate_name}}</strong> for <strong>{{position}}</strong>.</p>
<p>Please record your feedback using the secure link below — <strong>no login is required</strong>.</p>
<p style="margin:16px 0;"><a href="{{scorecard_link}}" style="background:#7a922e;color:#fff;padding:11px 22px;text-decoration:none;border-radius:8px;font-weight:700;display:inline-block;">Open scorecard</a></p>
<p style="color:#888;font-size:13px;">This link works once and expires in a few days.</p>`;

/** "Please confirm this interview happened" nudge from the occurrence sweep,
 *  sent when Teams attendance can't be read automatically. {{confirm_link}}
 *  opens the pipeline drawer / interviewer gate. */
const INTERVIEW_CONFIRM_BODY = `<p>Hi,</p>
<p>The scheduled <strong>{{stage_label}}</strong> interview with <strong>{{candidate_name}}</strong> ({{position}}) for {{interview_when}} has passed.</p>
<p>Please confirm whether it took place, so we can either request the interviewer's scorecard or reschedule:</p>
<p style="margin:16px 0;"><a href="{{confirm_link}}" style="background:#7a922e;color:#fff;padding:11px 22px;text-decoration:none;border-radius:8px;font-weight:700;display:inline-block;">Confirm interview outcome</a></p>
<p style="color:#888;font-size:13px;">No scorecard is sent until the interview is confirmed as held.</p>`;

// Recruiter-facing alert when Teams attendance PROVES the interview did not
// happen (no-show / nobody joined / network failure), so they can chase the
// absent side or rebook. No scorecard is requested for a no-show. A successful
// interview sends nothing here — the interviewer just receives the scorecard.
const INTERVIEW_NO_SHOW_BODY = `<p>Hi,</p>
<p>The scheduled <strong>{{stage_label}}</strong> interview with <strong>{{candidate_name}}</strong> ({{position}}) for {{interview_when}} <strong>did not take place</strong>.</p>
<p>The Microsoft Teams attendance report shows that <strong>{{absent_party}}</strong>.</p>
<p style="margin:16px 0;"><a href="{{confirm_link}}" style="background:#7a922e;color:#fff;padding:11px 22px;text-decoration:none;border-radius:8px;font-weight:700;display:inline-block;">Open Candidate Pipeline</a></p>
<p style="color:#888;font-size:13px;">No scorecard has been requested from the interviewer. Please reschedule the round or update the candidate's status.</p>`;

const TEMPLATES = [
  {
    find: { category: 'shortlist' },
    data: {
      name: 'Shortlist Notification',
      category: 'shortlist',
      subject: SHORTLIST_SUBJECT,
      body_html: SHORTLIST_BODY,
      placeholders: ['{candidate_name}', '{role_paragraph}'],
      is_active: true,
    },
  },
  {
    find: { category: 'rejection' },
    data: {
      name: 'Rejection — Post Interview',
      category: 'rejection',
      subject: 'Update on Your Application - AAPNA Infotech',
      body_html: statusBody('Application Update', REJECTED_PARAS),
      placeholders: ['{candidate_name}', '{position}'],
      is_active: true,
    },
  },
  {
    find: { name: 'Application On Hold' },
    data: {
      name: 'Application On Hold',
      category: 'general',
      subject: 'Application on Hold - AAPNA Infotech',
      body_html: statusBody('Application on Hold', ONHOLD_PARAS),
      placeholders: ['{candidate_name}', '{position}'],
      is_active: true,
    },
  },
  {
    find: { name: 'Welcome Candidate Email' },
    data: {
      name: 'Welcome Candidate Email',
      category: 'general',
      subject: 'Build. Innovate. Lead. Be a Commando WFH at AAPNA',
      body_html: WELCOME_BODY,
      placeholders: ['candidate_name'],
      is_active: true,
    },
  },
  {
    find: { name: 'Missing Profile Data Collection' },
    data: {
      name: 'Missing Profile Data Collection',
      category: 'general',
      subject: 'Action Required: Complete Your Profile Information',
      body_html: MISSING_DATA_BODY,
      placeholders: ['candidate_name', 'upload_link'],
      is_active: true,
    },
  },
  {
    find: { name: 'Email ID Null Alert (Internal HR)' },
    data: {
      name: 'Email ID Null Alert (Internal HR)',
      category: 'general',
      subject: 'Alert: Candidate Email ID Missing',
      body_html: EMAIL_NULL_BODY,
      placeholders: ['candidate_name', 'uploaded_by'],
      is_active: true,
    },
  },
  {
    find: { name: 'Duplicate Resume Alert (Internal HR)' },
    data: {
      name: 'Duplicate Resume Alert (Internal HR)',
      category: 'general',
      subject: 'Alert: Duplicate Resume Detected - Saved to Review Queue - {{candidate_name}}',
      body_html: DUPLICATE_ALERT_BODY,
      placeholders: ['candidate_name', 'candidate_email', 'candidate_phone'],
      is_active: true,
    },
  },
  {
    find: { name: 'Same Vendor Duplicate Alert' },
    data: {
      name: 'Same Vendor Duplicate Alert',
      category: 'general',
      subject: 'Duplicate Resume Submission - {{candidate_name}}',
      body_html: SAME_VENDOR_BODY,
      placeholders: ['vendor_name', 'candidate_name', 'candidate_email'],
      is_active: true,
    },
  },
  {
    find: { name: 'Different Vendor Duplicate Alert' },
    data: {
      name: 'Different Vendor Duplicate Alert',
      category: 'general',
      subject: 'Duplicate Resume Submission - Lock Applied - {{candidate_name}}',
      body_html: DIFF_VENDOR_BODY,
      placeholders: ['vendor_name', 'candidate_name'],
      is_active: true,
    },
  },
  {
    find: { name: 'Zeko Interview Scheduled Invitation' },
    data: {
      name: 'Zeko Interview Scheduled Invitation',
      category: 'interview',
      subject: 'Interview Scheduled — {{job_title}}',
      body_html: ZEKO_SCHEDULED_BODY,
      placeholders: ['candidate_name', 'job_title', 'interview_start', 'interview_end', 'interview_link'],
      is_active: true,
    },
  },
  {
    find: { name: 'Zeko Interview Cancelled Alert' },
    data: {
      name: 'Zeko Interview Cancelled Alert',
      category: 'interview',
      subject: 'Interview Cancelled — {{job_title}}',
      body_html: ZEKO_CANCELLED_BODY,
      placeholders: ['candidate_name', 'job_title', 'interview_stage', 'cancel_reason'],
      is_active: true,
    },
  },
  {
    find: { name: 'MRF Approval Request' },
    data: {
      name: 'MRF Approval Request',
      category: 'general',
      subject: 'New MRF Request - Approval Request',
      body_html: MRF_APPROVAL_BODY,
      placeholders: [],
      is_active: true,
    },
  },
  // Module 2 — technical-round interview scheduling. Four editable defaults
  // (candidate + panel × schedule + cancel) surfaced by the Pipeline Tracker
  // Schedule / Cancel modals.
  {
    find: { name: 'Interview Scheduled — Candidate' },
    data: {
      name: 'Interview Scheduled — Candidate',
      category: 'interview',
      subject: '{{stage_label}} scheduled — {{position}}',
      body_html: INTERVIEW_SCHED_CANDIDATE_BODY,
      placeholders: ['candidate_name', 'position', 'stage_label', 'interview_when', 'duration', 'teams_line'],
      is_active: true,
    },
  },
  {
    find: { name: 'Interview Scheduled — Panel' },
    data: {
      name: 'Interview Scheduled — Panel',
      category: 'interview',
      subject: 'Interview panel — {{stage_label}}: {{candidate_name}}',
      body_html: INTERVIEW_SCHED_PANEL_BODY,
      placeholders: ['interviewer_name', 'candidate_name', 'candidate_email', 'position', 'stage_label', 'interview_when', 'duration', 'teams_line'],
      is_active: true,
    },
  },
  {
    find: { name: 'Interview Cancelled — Candidate' },
    data: {
      name: 'Interview Cancelled — Candidate',
      category: 'interview',
      subject: '{{stage_label}} cancelled',
      body_html: INTERVIEW_CANCEL_CANDIDATE_BODY,
      placeholders: ['candidate_name', 'stage_label', 'interview_when', 'reason_line'],
      is_active: true,
    },
  },
  {
    find: { name: 'Interview Cancelled — Panel' },
    data: {
      name: 'Interview Cancelled — Panel',
      category: 'interview',
      subject: 'Interview cancelled — {{stage_label}}: {{candidate_name}}',
      body_html: INTERVIEW_CANCEL_PANEL_BODY,
      placeholders: ['interviewer_name', 'candidate_name', 'position', 'stage_label', 'interview_when', 'reason_line'],
      is_active: true,
    },
  },
  {
    find: { name: 'Interview Rescheduled — Candidate' },
    data: {
      name: 'Interview Rescheduled — Candidate',
      category: 'interview',
      subject: '{{stage_label}} rescheduled — {{position}}',
      body_html: INTERVIEW_RESCHED_CANDIDATE_BODY,
      placeholders: ['candidate_name', 'position', 'stage_label', 'previous_when', 'interview_when', 'duration', 'teams_line'],
      is_active: true,
    },
  },
  {
    find: { name: 'Interview Rescheduled — Panel' },
    data: {
      name: 'Interview Rescheduled — Panel',
      category: 'interview',
      subject: 'Interview rescheduled — {{stage_label}}: {{candidate_name}}',
      body_html: INTERVIEW_RESCHED_PANEL_BODY,
      placeholders: ['interviewer_name', 'candidate_name', 'candidate_email', 'position', 'stage_label', 'previous_when', 'interview_when', 'duration', 'teams_line'],
      is_active: true,
    },
  },
  // Pre-interview reminders (jobs/interviewReminder.js). Editable defaults; the
  // job falls back to an equivalent inline body if a row is missing.
  {
    find: { name: 'Interview Reminder — Candidate' },
    data: {
      name: 'Interview Reminder — Candidate',
      category: 'interview',
      subject: 'Reminder: your {{stage_label}} interview is coming up',
      body_html: INTERVIEW_REMINDER_CANDIDATE_BODY,
      placeholders: ['candidate_name', 'position', 'stage_label', 'interview_when', 'teams_line', 'notes_line'],
      is_active: true,
    },
  },
  {
    find: { name: 'Interview Reminder — Panel' },
    data: {
      name: 'Interview Reminder — Panel',
      category: 'interview',
      subject: 'Reminder: {{stage_label}} with {{candidate_name}}',
      body_html: INTERVIEW_REMINDER_PANEL_BODY,
      placeholders: ['candidate_name', 'candidate_email', 'interviewer_name', 'position', 'stage_label', 'interview_when', 'teams_line', 'notes_line'],
      is_active: true,
    },
  },
  // Phase 3 Module 3 — interviewer scorecard link + occurrence-confirm nudge.
  {
    find: { name: 'Scorecard Invitation — Interviewer' },
    data: {
      name: 'Scorecard Invitation — Interviewer',
      category: 'interview',
      subject: 'Please score your {{stage_label}} — {{candidate_name}}',
      body_html: SCORECARD_INVITE_INTERVIEWER_BODY,
      placeholders: ['interviewer_name', 'candidate_name', 'position', 'stage_label', 'scorecard_link'],
      is_active: true,
    },
  },
  {
    find: { name: { in: ['Scorecard Invitation — HR/CEO', 'Scorecard Invitation — Leadership Round'] } },
    data: {
      name: 'Scorecard Invitation — Leadership Round',
      category: 'interview',
      subject: 'Your feedback on {{candidate_name}} — {{stage_label}}',
      body_html: SCORECARD_INVITE_HRCEO_BODY,
      placeholders: ['interviewer_name', 'candidate_name', 'position', 'stage_label', 'scorecard_link'],
      is_active: true,
    },
  },
  {
    find: { name: { in: ['Interview — Please Confirm It Happened', 'Interview Attendance Check'] } },
    data: {
      name: 'Interview Attendance Check',
      category: 'interview',
      subject: 'Did the {{stage_label}} with {{candidate_name}} take place?',
      body_html: INTERVIEW_CONFIRM_BODY,
      placeholders: ['candidate_name', 'position', 'stage_label', 'interview_when', 'confirm_link'],
      is_active: true,
    },
  },
  {
    find: { name: { in: ['Interview — Did Not Take Place', 'Interview No-Show Notice'] } },
    data: {
      name: 'Interview No-Show Notice',
      category: 'interview',
      subject: '{{stage_label}} with {{candidate_name}} did not take place',
      body_html: INTERVIEW_NO_SHOW_BODY,
      placeholders: ['candidate_name', 'position', 'stage_label', 'interview_when', 'absent_party', 'confirm_link'],
      is_active: true,
    },
  },
  // Phase 3 Module 1 — generic stage-outcome fallbacks. Used by
  // stageNotification.service.js whenever no specific rpa_stage_email_templates
  // mapping exists for a given stage×outcome pair. {{stage_label}} is
  // interpolated by the dispatcher (e.g. "Zeko HR Screening", "Technical Round 1").
  // Requires the category CHECK constraint to include 'stage_outcome' —
  // see backend/prisma/ddl/2026-07-21-pipeline-stage-engine.sql.
  {
    find: { name: { in: ['Stage Outcome — Approved (Generic)', 'Stage Outcome — Approved'] } },
    data: {
      name: 'Stage Outcome — Approved',
      category: 'stage_outcome',
      subject: 'Great News on Your Application — {{position}}',
      body_html: `<p>Dear {{candidate_name}},</p>
<p>Good news — you have successfully cleared the <strong>{{stage_label}}</strong> stage for the {{position}} role.</p>
<p>Our recruitment team will be in touch shortly with the next steps.</p>`,
      placeholders: ['candidate_name', 'position', 'stage_label'],
      is_active: true,
    },
  },
  {
    find: { name: { in: ['Stage Outcome — Rejected (Generic)', 'Stage Outcome — Rejected'] } },
    data: {
      name: 'Stage Outcome — Rejected',
      category: 'stage_outcome',
      subject: 'Update on Your Application — {{position}}',
      body_html: `<p>Dear {{candidate_name}},</p>
<p>Thank you for your time and effort through the <strong>{{stage_label}}</strong> stage for the {{position}} role.</p>
<p>After careful review, we will not be moving forward with your candidacy at this time. We appreciate your interest in AAPNA Infotech and encourage you to apply for future openings that match your profile.</p>`,
      placeholders: ['candidate_name', 'position', 'stage_label'],
      is_active: true,
    },
  },
  {
    find: { name: { in: ['Stage Outcome — Hold (Generic)', 'Stage Outcome — Hold'] } },
    data: {
      name: 'Stage Outcome — Hold',
      category: 'stage_outcome',
      subject: 'Your Application is On Hold — {{position}}',
      body_html: `<p>Dear {{candidate_name}},</p>
<p>Your application for {{position}} is currently <strong>on hold</strong> following the {{stage_label}} stage. This is not a rejection — our recruitment team will reach out once there is an update.</p>`,
      placeholders: ['candidate_name', 'position', 'stage_label'],
      is_active: true,
    },
  },

  // ── Closure outcomes (Q12) ────────────────────────────────────────────
  //
  // Only THREE of the eight closure outcomes are seeded, and that is the point.
  // The other five — joined, joined_and_left, backed_out, did_not_join,
  // candidate_withdrawn — record something the candidate already lived through;
  // they are listed in SILENT_FINAL_OUTCOMES in stageNotification.service.js and
  // will never send however they are mapped. Seeding a "Congratulations" for
  // someone who backed out is the exact failure that got the earlier
  // map-closures-onto-the-generics shortcut rejected.
  //
  // These three ARE decisions the candidate is waiting on, so they get real copy.
  // They resolve through GENERIC_FALLBACK_BY_OUTCOME rather than per-stage
  // mapping rows, because a journey can be closed from ANY stage — a candidate
  // withdrawing at Tech 2 never reaches the offer stage.
  {
    find: { name: 'Closure — Approved' },
    data: {
      name: 'Closure — Approved',
      category: 'stage_outcome',
      subject: 'Your application with AAPNA Infotech — {{position}}',
      body_html: `<p>Dear {{candidate_name}},</p>
<p>We are pleased to confirm that your candidacy for <strong>{{position}}</strong> has been approved and your application is now complete.</p>
<p>Our recruitment team will be in touch with everything you need for the next steps.</p>
<p>Thank you for the time you have given us throughout this process.</p>`,
      placeholders: ['candidate_name', 'position'],
      is_active: true,
    },
  },
  {
    find: { name: 'Closure — Rejected' },
    data: {
      name: 'Closure — Rejected',
      category: 'stage_outcome',
      subject: 'Update on your application — {{position}}',
      body_html: `<p>Dear {{candidate_name}},</p>
<p>Thank you for the time and effort you invested in our process for <strong>{{position}}</strong>.</p>
<p>After careful consideration we will not be taking your application further on this occasion. This was a considered decision and not a reflection of your ability — we would genuinely welcome an application from you for a future opening that fits your profile.</p>
<p>We wish you every success.</p>`,
      placeholders: ['candidate_name', 'position'],
      is_active: true,
    },
  },
  {
    find: { name: 'Closure — On Hold' },
    data: {
      name: 'Closure — On Hold',
      category: 'stage_outcome',
      subject: 'Your Application is On Hold — {{position}}',
      body_html: `<p>Dear {{candidate_name}},</p>
<p>Thank you for your patience through our process for <strong>{{position}}</strong>.</p>
<p>Your application is currently <strong>on hold</strong>. This is not a rejection — the requirement itself is paused, and we will contact you as soon as there is a change.</p>`,
      placeholders: ['candidate_name', 'position'],
      is_active: true,
    },
  },

  // ── Templates that had only a code fallback (or none at all) ──────────
  //
  // Seeding these moves the copy out of JavaScript and onto the Email Templates
  // page, so HR can reword them without a deploy. The code fallbacks stay in
  // place as a safety net for an environment seeded later.
  {
    find: { name: 'Recruitment Process & Interview Stages' },
    data: {
      name: 'Recruitment Process & Interview Stages',
      category: 'general',
      subject: 'What to expect — our recruitment process for {{position}}',
      body_html: `<p>Dear {{candidate_name}},</p>
<p>Thank you for your interest in the <strong>{{position}}</strong> role at AAPNA Infotech. So you know what to expect, here is how our process runs:</p>
<ol>
  <li><strong>HR Screening</strong> — a short introductory conversation.</li>
  <li><strong>Assessment</strong> — an online test covering aptitude and/or technical skills.</li>
  <li><strong>Technical Rounds</strong> — one to three discussions with our engineering team, depending on the role.</li>
  <li><strong>HR Round</strong> — role expectations, timing and compensation.</li>
  <li><strong>Final Round</strong> — a closing conversation with our leadership team.</li>
  <li><strong>Documents &amp; Offer</strong> — document collection, then the offer itself.</li>
</ol>
<p>Not every role includes every stage, and we will tell you in advance which ones apply to you. You will hear from us after each stage either way.</p>
<p>If anything is unclear, just reply to this email.</p>`,
      placeholders: ['candidate_name', 'position'],
      is_active: true,
    },
  },
  {
    find: { name: 'Document Collection Request' },
    data: {
      name: 'Document Collection Request',
      category: 'onboarding',
      subject: 'Documents required to roll out your offer — {{position}}',
      body_html: `<p>Dear {{candidate_name}},</p>
<p>Congratulations! To roll out your offer for <strong>{{position}}</strong>, please share the documents listed on the secure link below — no login is needed.</p>
<p><a href="{{upload_link}}" style="background:#7a922e;color:#ffffff;padding:11px 22px;text-decoration:none;border-radius:8px;font-weight:700;display:inline-block;">Upload your documents</a></p>
<p>Please do this at the earliest so we can proceed.</p>`,
      placeholders: ['candidate_name', 'position', 'upload_link'],
      is_active: true,
    },
  },
  {
    // ONE template serves both the plain reminder and the post-rejection
    // re-request. documentCollection.service.js always supplies
    // rejected_document / rejection_reason — empty strings on a plain reminder —
    // so the conditional block below simply renders blank in that case. They are
    // NOT declared as required placeholders, or a reworded plain reminder that
    // drops them would fail the PUT validator.
    find: { name: 'Document Collection Reminder' },
    data: {
      name: 'Document Collection Reminder',
      category: 'onboarding',
      subject: 'Reminder: documents still needed — {{position}}',
      body_html: `<p>Dear {{candidate_name}},</p>
<p>This is a gentle reminder that we are still waiting on the documents needed to roll out your offer for <strong>{{position}}</strong>.</p>
<p>{{rejected_document}} {{rejection_reason}}</p>
<p><a href="{{upload_link}}" style="background:#7a922e;color:#ffffff;padding:11px 22px;text-decoration:none;border-radius:8px;font-weight:700;display:inline-block;">Upload your documents</a></p>`,
      placeholders: ['candidate_name', 'position', 'upload_link'],
      is_active: true,
    },
  },
  // INTERNAL — goes to the recruitment mailbox, never the candidate
  // (offerApprovalNudge flow key). Q26: a daily chase, not a communication.
  //
  // Disabled 2026-08-25 with the offer approval flow — RT: the offer is handled
  // offline and the app marks the round only. The seed no longer creates this
  // template; an existing row in a seeded environment is left alone (nothing
  // reads it now) rather than being deleted. Reverses Q3/Q26.
  // {
  //   find: { name: 'Offer Approval Reminder' },
  //   data: {
  //     name: 'Offer Approval Reminder',
  //     category: 'offer',
  //     subject: 'Offer approval pending — {{candidate_name}} ({{position}})',
  //     body_html: `<p>The offer for <strong>{{candidate_name}}</strong> ({{position}}) is still waiting for internal approval — requested {{waiting_days}} day(s) ago.</p>
  // <p>Please approve it in the Candidate Pipeline so the offer can be shared with the candidate.</p>
  // <p><a href="{{pipeline_link}}">Open the Candidate Pipeline</a></p>`,
  //     placeholders: ['candidate_name', 'position', 'waiting_days', 'pipeline_link'],
  //     is_active: true,
  //   },
  // },
  // Phase 3 Module 6 — the vendor half of the Q5 dual-notification. Sent by
  // vendorNotification.service.js as its OWN message, never as a cc on the
  // candidate's email, so nothing a recruiter types can reach a vendor.
  //
  // {{status_line}} is assembled server-side from a fixed vocabulary — it is
  // the one field an admin editing this template must leave in place, since it
  // is the only thing that says what actually happened.
  //
  // Requires the category CHECK constraint to include 'vendor_status' —
  // see backend/prisma/ddl/2026-08-12-vendor-status-templates.sql.
  {
    find: { name: 'Vendor — Candidate Status Update' },
    data: {
      name: 'Vendor — Candidate Status Update',
      category: 'vendor_status',
      subject: 'Candidate update — {{candidate_name}} ({{position}})',
      body_html: `<p>Hello {{vendor_name}},</p>
<p>An update on the candidate you submitted for the {{position}} role:</p>
<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:14px">
  <tr><td style="color:#666">Candidate</td><td><strong>{{candidate_name}}</strong></td></tr>
  <tr><td style="color:#666">Position</td><td>{{position}}</td></tr>
  <tr><td style="color:#666">Status</td><td><strong>{{status_line}}</strong></td></tr>
  <tr><td style="color:#666">Date</td><td>{{event_date}}</td></tr>
</table>
<p style="color:#666;font-size:12.5px">This is a status update only. Please contact the recruitment team for anything further.</p>`,
      placeholders: ['vendor_name', 'candidate_name', 'position', 'stage_label', 'status_line', 'event_date'],
      is_active: true,
    },
  },
  {
    // The Offer stage's deliberately thin variant (Q29). Carries no figures, no
    // joining date and no remarks — if you are editing this template, that
    // absence IS the specification, not an oversight.
    find: { name: 'Vendor — Candidate Milestone (No Detail)' },
    data: {
      name: 'Vendor — Candidate Milestone (No Detail)',
      category: 'vendor_status',
      subject: 'Candidate milestone — {{candidate_name}} ({{position}})',
      body_html: `<p>Hello {{vendor_name}},</p>
<p><strong>{{candidate_name}}</strong> ({{position}}) — {{status_line}}</p>
<p style="color:#666;font-size:12.5px">Offer terms are handled directly between AAPNA Infotech and the candidate, so this note carries the milestone only. Please contact the recruitment team with any questions.</p>`,
      placeholders: ['vendor_name', 'candidate_name', 'position', 'status_line', 'event_date'],
      is_active: true,
    },
  },
];

async function main() {
  for (const t of TEMPLATES) {
    const existing = await prisma.rpa_email_templates.findFirst({ where: t.find });
    if (existing) {
      await prisma.rpa_email_templates.update({
        where: { id: existing.id },
        data: { ...t.data, modified_at: new Date() },
      });
      console.log(`Updated #${existing.id} "${t.data.name}".`);
    } else {
      const created = await prisma.rpa_email_templates.create({ data: t.data });
      console.log(`Created #${created.id} "${t.data.name}".`);
    }
  }
}

main()
  .catch((e) => {
    console.error('Seed failed:', e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
