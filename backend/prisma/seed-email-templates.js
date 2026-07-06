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
 * Legacy source of truth for the branded bodies: docs/Email-Templates-Summary.md
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
<p style="margin:0;font-weight:700;color:#111827;">AAPNA Recruitment Team</p>
<p style="margin:2px 0 0 0;color:#7a922e;font-weight:700;">AAPNA Infotech</p>
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
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:30px 10px"><tr><td align="center"><table width="620" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,0.08)"><tr><td style="background:#7a922e;padding:32px 40px;text-align:center"><img src="https://www.aapnainfotech.com/wp-content/uploads/2021/09/aapna-gptw-black.png" width="190" style="display:block;margin:0 auto 16px auto"><h1 style="margin:0;font-size:22px;color:#ffffff;font-weight:800">${statusLabel}</h1><p style="margin:6px 0 0 0;color:#e7f0c5;font-size:13px">AAPNA Infotech - Recruitment Update</p></td></tr><tr><td style="padding:32px 40px 8px 40px;font-size:15px;color:#374151;line-height:1.8"><p>Dear <strong>{candidate_name}</strong>,</p><p>Greetings from <strong>AAPNA Infotech</strong>.</p>${bodyParagraphs}</td></tr><tr><td style="padding:0 40px 32px 40px;font-size:14px;color:#6b7280;line-height:1.6"><p style="margin:0 0 4px 0">Best regards,</p><p style="margin:0;font-weight:700;color:#111827">AAPNA Recruitment Team</p><p style="margin:2px 0 0 0;color:#7a922e;font-weight:700">AAPNA Infotech</p></td></tr><tr><td style="background:#f3f4f6;padding:16px;text-align:center;font-size:12px;color:#9ca3af">This email was sent by AAPNA Infotech's recruitment system.<br>© 2026 AAPNA Infotech. All rights reserved.</td></tr></table></td></tr></table></body></html>`;
}

const REJECTED_PARAS = `<p>After careful consideration of your profile, we regret to inform you that we are unable to move forward with your application for <strong>{position}</strong> at this time.</p><p>We truly appreciate the time and effort you invested in our process. We will keep your profile on file and encourage you to apply for future opportunities.</p><p>We wish you all the best in your career journey.</p>`;

const ONHOLD_PARAS = `<p>Thank you for your continued interest in the <strong>{position}</strong> position at AAPNA Infotech.</p><p>Your application is currently on hold while we complete our initial screening. We will reach out with an update as soon as possible.</p><p>We appreciate your patience.</p>`;

/** Branded candidate welcome — n8n "Send a message" (Resume 1.1.1 Intake), §1.1 of docs/Email-Templates-Summary.md. */
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
              <p style="margin:0 0 4px 0;font-size:14px;color:#6b7280;">Warm regards,</p>
              <p style="margin:0 0 2px 0;font-size:15px;font-weight:700;color:#111827;">HR Team</p>
              <p style="margin:0 0 2px 0;font-size:15px;font-weight:700;color:#92a63c;">AAPNA Infotech</p>
              <p style="margin:4px 0 0 0;font-size:13px;color:#9ca3af;font-style:italic;">Where Culture, Code, and Courage Come Together</p>
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
    <strong>HR Team</strong><br>
    AAPNA
  </p>
</body>
</html>`;

/** Internal HR alert when a parsed candidate has no email — resume rejected (sent as HTML). */
const EMAIL_NULL_BODY = `<p>Dear HR Team,</p>
<p>This is to inform you that the candidate's resume does not contain an email address. As the email ID is mandatory, the system could not process the resume and has rejected the CV.</p>
<p><strong>Candidate Name:</strong> {{candidate_name}}<br>
<strong>Uploaded By:</strong> {{uploaded_by}}</p>
<p>Best regards,<br>
System Notification</p>`;

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
              <p style="margin:0 0 4px 0;font-size:14px;color:#6b7280;">Warm regards,</p>
              <p style="margin:0 0 2px 0;font-size:15px;font-weight:700;color:#111827;">HR Team</p>
              <p style="margin:0 0 2px 0;font-size:15px;font-weight:700;color:#7a922e;">AAPNA Infotech</p>
              <p style="margin:4px 0 0 0;font-size:13px;color:#9ca3af;font-style:italic;">Where Culture, Code, and Courage Come Together</p>
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
    <p><strong>AAPNA Recruitment Team</strong></p>
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
    <p><strong>AAPNA Recruitment Team</strong></p>
</body>
</html>`;

/** Zeko AI-interview invitation — n8n §6.1 (was disabled in n8n; active here). */
const ZEKO_SCHEDULED_BODY = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; color: #333; line-height: 1.7; max-width: 600px; margin: 0 auto;">
  <div style="background: linear-gradient(135deg, #185fa5, #1e40af); padding: 24px 28px; border-radius: 10px 10px 0 0;">
    <h2 style="color: #fff; margin: 0; font-size: 18px;">🎯 Interview Invitation</h2>
    <p style="color: rgba(255,255,255,0.85); margin: 6px 0 0; font-size: 13px;">AAPNA Infotech — Recruitment Team</p>
  </div>
  <div style="background: #fff; border: 1px solid #e2e8f0; border-top: none; padding: 28px; border-radius: 0 0 10px 10px;">
    <p style="font-size: 15px;">Dear <strong>{{candidate_name}}</strong>,</p>
    <p>We are pleased to invite you for an AI-powered video interview for the position of <strong>{{job_title}}</strong>.</p>
    <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 16px 20px; margin: 20px 0;">
      <p style="margin: 0 0 8px; font-size: 13px; font-weight: 700; color: #0369a1; text-transform: uppercase; letter-spacing: 0.05em;">📅 Interview Schedule</p>
      <table style="font-size: 14px; color: #1e293b;">
        <tr><td style="padding: 4px 12px 4px 0; font-weight: 600;">Start:</td><td>{{interview_start}}</td></tr>
        <tr><td style="padding: 4px 12px 4px 0; font-weight: 600;">End:</td><td>{{interview_end}}</td></tr>
      </table>
    </div>
    <p style="font-size: 14px;">Please complete your interview within the scheduled window by clicking the button below:</p>
    <div style="text-align: center; margin: 24px 0;">
      <a href="{{interview_link}}" target="_blank" style="background: #185fa5; color: #fff; padding: 13px 28px; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 15px; display: inline-block;">🎬 Start My Interview</a>
    </div>
    <p style="font-size: 13px; color: #64748b;">Or copy this link: <a href="{{interview_link}}" style="color: #185fa5;">{{interview_link}}</a></p>
    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
    <p style="font-size: 13px; color: #64748b;">If you have any questions, please contact our HR team by replying to this email.</p>
    <p>Best regards,<br><strong>HR Team</strong><br>AAPNA Infotech</p>
  </div>
</body>
</html>`;

/** Zeko interview cancellation notice — n8n §6.2 plus a cancellation-reason line. */
const ZEKO_CANCELLED_BODY = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; color: #333; line-height: 1.7; max-width: 600px; margin: 0 auto;">
  <div style="background: linear-gradient(135deg, #c0392b, #e74c3c); padding: 24px 28px; border-radius: 10px 10px 0 0;">
    <h2 style="color: #fff; margin: 0; font-size: 18px;">❌ Interview Cancellation Notice</h2>
    <p style="color: rgba(255,255,255,0.85); margin: 6px 0 0; font-size: 13px;">AAPNA Infotech — Recruitment Team</p>
  </div>
  <div style="background: #fff; border: 1px solid #e2e8f0; border-top: none; padding: 28px; border-radius: 0 0 10px 10px;">
    <p style="font-size: 15px;">Dear <strong>{{candidate_name}}</strong>,</p>
    <p>We regret to inform you that your scheduled interview for the position of <strong>{{job_title}}</strong> ({{interview_stage}} Round) has been <strong>cancelled</strong>.</p>
    <p>Reason for cancellation: {{cancel_reason}}</p>
    <p>We sincerely apologize for the inconvenience. Our HR team will contact you shortly to reschedule at the earliest possible opportunity.</p>
    <p>Thank you for your patience and continued interest in joining AAPNA Infotech.</p>
    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
    <p>Best regards,<br><strong>HR Team</strong><br>AAPNA Infotech</p>
  </div>
</body>
</html>`;

/**
 * MRF approval intro shown to management — n8n §4.2 intro paragraphs.
 * The greeting, Approve/Decline buttons and MRF field table are built by
 * sendMrfApprovalEmail(); this template only overrides the intro text.
 */
const MRF_APPROVAL_BODY = `<p>We have received a new Manpower Requisition Form ( MRF ) request for your review and approval.</p><p><br></p><p>Kindly review the filled MRF and the attached Job Description and share your approval. Please review the filled MRF and attached JD and confirm your approval. Also, let us know whether this should be a permanent role or a different engagement model.</p><p><br></p><p>Also, please help define the priority of the role (High / Moderate / Low) as per the business need.</p>`;

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
