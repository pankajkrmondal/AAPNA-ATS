# n8n Email Templates — Content Summary

This document catalogs **every email template defined inside the n8n workflow exports** under `AAPNA-ATS/n8n flows/`. It is sourced **only from the n8n flow JSONs** (not the application code). For each template the **verbatim subject** and the **full body (HTML or plain text, exactly as stored in the flow)** are included.

**Infrastructure notes**
- Every email is sent through **Microsoft Outlook** nodes (`n8n-nodes-base.microsoftOutlook`, credential *"Microsoft Outlook account Saurabh"*). No Gmail / SMTP / HTTP-email-API senders are used.
- Many bodies are composed in an upstream **Code node** (a JS template literal) or a **Set node**, then referenced by the Outlook node via `={{ $json.emailBody }}` / `={{ $json.finalBody }}` etc. Where that is the case, the body shown below is the literal template from that source node.
- `{{ ... }}` / `${...}` markers are dynamic placeholders resolved at runtime.

---

## Summary table

| # | Flow | Email / node | Recipient | Subject | Purpose |
|---|------|--------------|-----------|---------|---------|
| 1 | Resume 1.1.1 Intake | Send a message (Welcome) | Candidate* | `Build. Innovate. Lead. Be a Commando … WFH at AAPNA` | Branded welcome / profile registered |
| 2 | Resume 1.1.1 Intake | Automated Email for data collection | Candidate* | `Action Required: Complete Your Profile Information` | Ask candidate to complete missing profile |
| 3 | Resume 1.1.1 Intake | Automated Email - EmailID Is NULL | HR (hmopuri) | `Alert: Candidate Email ID Missing` | Internal alert: candidate has no email |
| 4 | Resume 1.1.1 Intake | Email To Different Vendor - CV Already Exists | HR + vendor | `Alert: CV Already Exists - Different Vendor ` | Duplicate CV from a different vendor |
| 5 | Resume 1.1.1 Intake | Email To Same Vendor Owner - CV Already Exists | HR + vendor | `Alert: CV Already Exists - Same Vendor Owner` | Duplicate CV, same vendor |
| 6 | Resume 1.1.1 Intake | Email To Recruiter - CV Already Exists | Recruiter (pkmondal) | `Alert: CV Already Exists - HR` | Duplicate CV alert to recruiter |
| 7 | Resume 1.1.1 Intake | Outlook Mail: Send Duplicate Alert to HR | Uploading HR + pkmondal | `Alert: Duplicate Resume Detected - Saved to Review Queue - {{Name}}` | Branded duplicate-resume alert |
| 8 | Resume 1.1.1 Intake | Email: Upload Summary Report **(DISABLED)** | pkmondal | `📊 Resume Upload — …` | Batch upload summary report |
| 9 | Resume 1.1.4 Bulk Merge | Send a message (Welcome) | Candidate* | *(same as #1)* | Welcome during bulk merge |
| 10 | Resume 1.1.4 Bulk Merge | Automated Email for data collection | Candidate* | *(same as #2)* | Complete-profile during bulk merge |
| 11 | MRF 1.1 HR→HM | Send a message (with/without CC) | Hiring Manager | `New MRF Request` | Ask hiring manager to fill the MRF |
| 12 | MRF 1.2 HM submits | Send a message To HR | HR | `New MRF Request - Approval Request` | Notify HR of new MRF submission |
| 13 | MRF 1.2 HM submits | Send message and wait for response | HR + Management | `New MRF Request - Approval Request` | MRF approval request w/ Approve/Decline form |
| 14 | MRF 1.2 HM submits | Approved Email / Approved Email2 | HR | `Approved: New MRF Request` | MRF approved notice |
| 15 | MRF 1.2 HM submits | Declined Email / Declined Email2 | HR | `Declined: New MRF Request` | MRF declined notice |
| 16 | Screening 2.4 Shortlist | Create Shortlist Draft | Candidate (CC pkmondal) | `You're Shortlisted -- Complete Your HR AI Interview \| AAPNA Infotech` | Shortlist + HR AI interview lead-in |
| 17 | Screening 2.4 Shortlist | Notify Ui User | Internal (hmopuri) | `No CV Alert ! Couldn't Find Candidate Data in Database` | Internal "no CV found" alert |
| 18 | Screening 2.5 Interview | Email — Send Scheduled Interview Link **(DISABLED)** | Candidate | `Interview Scheduled — {{job_title}} ({{stageLabel}})` | Interview invite w/ link |
| 19 | Screening 2.5 Interview | Email — Send Interview Cancellation | Candidate | `Interview Cancelled — {{job_title}} ({{stage}} Round)` | Interview cancellation notice |
| 20 | Screening 2.6 Status | Create Email Draft | Candidate (CC pkmondal) | dynamic per status | Status update (shortlist/reject/hold/invite) |
| 21 | System Config Reminder | Create Reminder Draft | *(see notes)* | `Reminder (n/m): {{original subject}}` | Follow-up reminder (3 body variants) |
| 22 | Admin Dashboard | Email — Welcome + Credentials | New portal user | `Your AAPNA Recruitment Portal Account is Ready` | New-account credentials |
| 23 | Admin Dashboard | Email — Password Changed | Portal user | `Your AAPNA Recruitment Portal Password Has Been Updated` | Password-reset notice |

\* In these staging exports the candidate-facing emails have their `To` hard-coded to internal HR addresses (`hmopuri@`, `pkmondal@`, `saukumar@aapnainfotech.com`). See **Notes & observations**.

---

# 1. Resume Parser — Step 1.1.1 (Multi Source Resume Intake — Upload)

## 1.1 Welcome / Profile Registered — `Send a message`
- **Purpose:** Branded welcome + acknowledgement sent when a new candidate profile is successfully registered.
- **To:** `saukumar@aapnainfotech.com, hmopuri@aapnainfotech.com, pkmondal@aapnainfotech.com` *(staging; intended for the candidate)*
- **Subject (verbatim, note leading space + literal line break):**
  `  Build. Innovate. Lead. Be a Commando ` + newline + ` WFH at AAPNA`
- **Placeholders:** `{{ $('Code in JavaScript').first().json.parsed.Name }}`
- **Body (HTML):**

```html
<!DOCTYPE html>
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
                Dear <strong>{{ $('Code in JavaScript').first().json.parsed.Name }}</strong>,
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
</html>
```

## 1.2 Complete Your Profile — `Automated Email for data collection`
- **Purpose:** Sent to a candidate whose resume is missing required fields, with a link to complete their profile.
- **To:** ` hmopuri@aapnainfotech.com,  pkmondal@aapnainfotech.com, saukumar@aapnainfotech.com` *(staging; intended for the candidate)*
- **Subject:** `Action Required: Complete Your Profile Information`
- **Placeholders:** `{{ $json.link }}` (profile-completion form link)
- **Body (HTML):**

```html
<!DOCTYPE html>

<html>
<head>
  <meta charset="UTF-8"> 
</head>
<body style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
 

  <p>Dear Candidate,</p>

  <p>
    We have reviewed your resume and noticed that some important information is missing from your profile.
  </p>

  <p>
    To proceed further with your application, we request you to complete the required details using the link below:
  </p>

  <p style="margin: 20px 0;">
    <a href="{{ $json.link }}" target="_blank"
       style="background-color: #1a73e8; color: #ffffff; padding: 10px 18px; text-decoration: none; border-radius: 4px; font-weight: bold;">
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
</html>
```

## 1.3 Candidate Email ID Missing — `Automated Email - EmailID Is NULL`
- **Purpose:** Internal alert when a parsed candidate has no email, so no form/link can be sent.
- **To:** `hmopuri@aapnainfotech.com`
- **Subject:** `Alert: Candidate Email ID Missing`
- **Placeholders:** `{{ $('Code in JavaScript').item.json.parsed.Name }}`. Has an attachment (binary property `file`).
- **Body (plain text):**

```text
Dear HR Team,

This is to inform you that the email ID for one of the candidates is missing in the system.

Due to this, the system is unable to generate and send the required form/link to the candidate. Kindly review the candidate's record and update the email ID at the earliest to avoid any delays in the process.

Candidates Name: {{ $('Code in JavaScript').item.json.parsed.Name }}

Best regards,
System Notification
```

## 1.4 CV Already Exists — Different Vendor — `Email To Different Vendor - CV Already Exists`
- **Purpose:** Duplicate-CV notice when the CV was submitted by a different vendor.
- **To:** `hmopuri@aapnainfotech.com, saukumar@aapnainfotech.com, {{ $json.details.SubmitVendorEmail }}`
- **Subject:** `Alert: CV Already Exists - Different Vendor ` *(trailing space is part of the subject)*
- **Body (plain text):**

```text
Hi,

Greetings!

Below candidate's CV already exists on my system.

Candidates Name:{{ $json.Name }}
Candidates Email:{{ $json.EmailID }}


Best regards,
System Notification
```

## 1.5 CV Already Exists — Same Vendor Owner — `Email To Same Vendor Owner - CV Already Exists`
- **Purpose:** Duplicate CV re-submitted by the same vendor owner.
- **To:** `hmopuri@aapnainfotech.com, saukumar@aapnainfotech.com, {{ $json.details.SubmitVendorEmail }}`
- **Subject:** `Alert: CV Already Exists - Same Vendor Owner`
- **Body (plain text):** *(note the sign-off word is truncated to "Notificatio" in the flow)*

```text
Hi,

Greetings!

Below candidate's CV already exists on my system.

Candidates Name:{{ $json.Name }}
Candidates Email:{{ $json.EmailID }}


Best regards,
System Notificatio
```

## 1.6 CV Already Exists — HR/Recruiter — `Email To Recruiter - CV Already Exists`
- **Purpose:** Duplicate-CV alert to the recruiter.
- **To:** `pkmondal@aapnainfotech.com`
- **Subject:** `Alert: CV Already Exists - HR`
- **Body (plain text):**

```text
Hi,

Greetings!

Below candidate's CV already exists on my system.

Candidates Name:{{ $json.Name }}
Candidates Email:{{ $json.EmailID }}


Best regards,
System Notification
```

## 1.7 Duplicate Resume Detected — `Outlook Mail: Send Duplicate Alert to HR`
- **Purpose:** Branded alert when a duplicate resume is detected and stored in the review queue (`rpa_cv_tmp`).
- **To:** `{{ $('Loop Over Items').item.json.uploadedByHREmail }}, pkmondal@aapnainfotech.com`
- **Subject:** `Alert: Duplicate Resume Detected - Saved to Review Queue - {{ $('Code in JavaScript').item.json.parsed.Name }}`
- **Placeholders:** `parsed.Name`, `parsed.EmailID`, `parsed.ContactNumber`
- **Body (HTML):**

```html
<!DOCTYPE html>
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
                    <strong>Candidate Name:</strong> {{ $('Code in JavaScript').item.json.parsed.Name }}<br/>
                    <strong>Email ID:</strong> {{ $('Code in JavaScript').item.json.parsed.EmailID }}<br/>
                    <strong>Contact Number:</strong> {{ $('Code in JavaScript').item.json.parsed.ContactNumber }}
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
</html>
```

## 1.8 Resume Upload Summary Report — `Email: Upload Summary Report` **(DISABLED node)**
- **Purpose:** Batch summary of a resume-upload run (counts of new / updated / duplicates). Node is currently disabled; body is built by the `Format: Summary Email` Code node (`{{ $json.html }}`, subject `{{ $json.subject }}`).
- **To:** `pkmondal@aapnainfotech.com`
- **Subject:** `📊 Resume Upload — {n} New, {n} Updated, {n} Already Exist` (or `📊 Resume Upload — No Activity`; empty-batch variant: `🚫 Resume Upload — No files recorded in log`)
- **Placeholders / computed:** `total`, `newCnt`, `updCnt`, `dupCnt`, `startedAt`, `finishedAt`, `execId`
- **Body (HTML — non-empty batch template):**

```html
<!DOCTYPE html>
<html><head><meta charset="UTF-8"/></head>
<body style="font-family:Arial, Helvetica, sans-serif;background:#f4f6f9;padding:32px 0;margin:0;">
<table width="620" cellpadding="0" cellspacing="0"
       style="background:#ffffff;border-radius:12px;overflow:hidden;
              box-shadow:0 4px 20px rgba(0,0,0,0.08);margin:auto;">

  <tr>
    <td style="background:#7a922e;padding:36px 40px 28px 40px;text-align:center;">
      <table cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 18px auto;">
        <tr>
          <td style="background-color:#ffffff;border-radius:8px;padding:10px 24px;text-align:center;">
            <span style="font-size:20px;color:#7a922e;font-weight:900;font-family:Arial, Helvetica, sans-serif;letter-spacing:-1px;">&#9670; aapna&#174;</span>
            <br/>
            <span style="font-size:9px;font-weight:700;color:#8a7230;font-family:Arial, Helvetica, sans-serif;letter-spacing:2px;">CMMIDEV/3 &nbsp; CERTIFIED</span>
          </td>
        </tr>
      </table>
      <h1 style="margin:0;font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.3px;font-family:Arial, Helvetica, sans-serif;">
        📊 Resume Upload Summary
      </h1>
      <p style="margin:8px 0 0 0;font-size:12px;color:#e8f0cc;font-style:italic;font-family:Arial, Helvetica, sans-serif;">
        Started: ${startedAt} &nbsp;|&nbsp; Finished: ${finishedAt} IST
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

  <tr><td style="background:#f9fdf0;padding:24px 40px;border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="text-align:center;padding:10px;width:25%;">
        <div style="font-size:36px;font-weight:800;color:#7a922e;font-family:Arial, Helvetica, sans-serif;">${total}</div>
        <div style="font-size:11px;font-weight:600;text-transform:uppercase;color:#6b7c2d;margin-top:4px;font-family:Arial, Helvetica, sans-serif;">Total Files</div>
      </td>
      <td style="text-align:center;padding:10px;width:25%;">
        <div style="font-size:36px;font-weight:800;color:#2e7d32;font-family:Arial, Helvetica, sans-serif;">${newCnt}</div>
        <div style="font-size:11px;font-weight:600;text-transform:uppercase;color:#2e7d32;margin-top:4px;font-family:Arial, Helvetica, sans-serif;">✅ New to DB</div>
      </td>
      <td style="text-align:center;padding:10px;width:25%;">
        <div style="font-size:36px;font-weight:800;color:#1565c0;font-family:Arial, Helvetica, sans-serif;">${updCnt}</div>
        <div style="font-size:11px;font-weight:600;text-transform:uppercase;color:#1565c0;margin-top:4px;font-family:Arial, Helvetica, sans-serif;">🔄 Updated</div>
      </td>
      <td style="text-align:center;padding:10px;width:25%;">
        <div style="font-size:36px;font-weight:800;color:#c62828;font-family:Arial, Helvetica, sans-serif;">${dupCnt}</div>
        <div style="font-size:11px;font-weight:600;text-transform:uppercase;color:#c62828;margin-top:4px;font-family:Arial, Helvetica, sans-serif;">⚠️ Already Exists</div>
      </td>
    </tr></table>
  </td></tr>

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

</table></body></html>
```

---

# 2. Resume Parser — Step 1.1.4 (HR Bulk Merge Process)

This flow **reuses two templates byte-for-byte** from Step 1.1.1:

- **Welcome / Profile Registered** — `Send a message` — subject `  Build. Innovate. Lead. Be a Commando ` + newline + ` WFH at AAPNA`. Identical HTML to **§1.1**. To: `saukumar@, hmopuri@, pkmondal@aapnainfotech.com`.
- **Complete Your Profile** — `Automated Email for data collection` — subject `Action Required: Complete Your Profile Information`. Identical HTML to **§1.2** (CTA → `{{ $json.link }}`). To: `hmopuri@, pkmondal@, saukumar@aapnainfotech.com`.

---

# 3. MRF — Step 1.1 (MRF sent by HR to the Hiring Manager)

## 3.1 New MRF Request — `Send a message WithOut CC Recipients1` / `Send a message With CC Recipients`
- **Purpose:** HR initiates hiring; asks the Hiring Manager to review the JD and fill the MRF. Two nodes (with / without CC); same body. Body is built in the `Code - Dynamically Anchor/MRF Link ADD` node and referenced by the Outlook node as `={{ $json.EmailBody }}`.
- **To:** `{{ $('Code - Dynamically Anchor/MRF Link ADD').item.json.email }}` (Hiring Manager); CC variant adds `cc_email`.
- **Subject:** `New MRF Request`
- **Placeholders:** `${firstName}`, `${role}`, `${introParagraph}` (custom `email_body_content` from DB, or the default paragraph shown below), `${jdLinkRaw}` (JD link), `${MRF_FORM_URL}` (generated MRF form URL). Default intro when none supplied: *"As discussed, we would like to initiate the hiring process for the **${role}** position… fill out the Manpower Requisition Form (MRF) using the link below…"*
- **Body (HTML):**

```html
<!DOCTYPE html>
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
    <p class="greeting">Dear ${firstName},</p>
    <div class="intro">${introParagraph}</div>
    <hr class="divider"/>
    <div class="action-card">
      <div class="action-label">📄 Step 1 — Review the JD</div>
      <div class="action-desc">We are sharing the existing Job Description for your reference. Please review and let us know if any changes are required. <strong>Kindly upload the updated/final JD in the MRF (Step 2).</strong></div>
      <a class="btn-outline" href="${jdLinkRaw}" target="_blank">View Job Description →</a>
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
</html>
```

---

# 4. MRF — Step 1.2 (MRF submitted by the Hiring Manager)

All recipients here are internal HR / management. Bodies come from the `Code - Insert Query Create` node (submission + approval versions) and the `approved message` / `declined message` Set nodes.

## 4.1 MRF Submission → HR — `Send a message To HR`
- **Purpose:** Notifies HR that a new MRF was submitted, with a full field-by-field table.
- **To:** `hmopuri@aapnainfotech.com, saukumar@aapnainfotech.com`
- **Subject:** `New MRF Request - Approval Request`
- **Body source:** `={{ $('Code - Insert Query Create').item.json.emailBodyHtml }}` — generated as below (greeting *"Hi Team,"*, intro *"This is an automated email. A new MRF has been submitted…"*). Every `${v(j.*)}` is a submitted MRF field.

```html
<!DOCTYPE html>
<html>
  <style>
    table, th, td {
      border: 1px solid black;
      border-collapse: collapse;
      padding: 6px;
    }
  </style>

<body>

<p>Hi Team,</P>
<p>This is an automated email. A new MRF has been submitted. You can quickly view the submitted details below:</p>

<table>

<tr>
  <td><b>Name of the field</b></td>
  <td><b>User Submitted Data</b></td>
</tr>

<tr><td>Submitter Email:</td><td>${v(j.hiring_manager_email)}</td></tr>
<tr><td>Name of the Hiring Manager:</td><td>${v(j.hiring_manager_name)}</td></tr>
<tr><td>Designation of the Hiring Manager:</td><td>${v(j.hiring_manager_designation)}</td></tr>
<tr><td>Date of Request:</td><td>${v(j.date_of_request)}</td></tr>
<tr><td>Required in:</td><td>${v(j.required_in)}</td></tr>
<tr><td>Position hiring for:</td><td>${v(j.position_hiring_for)}</td></tr>
<tr><td>Number of Positions:</td><td>${v(j.number_of_positions)}</td></tr>
<tr><td>Position reports to:</td><td>${v(j.position_reports_to)}</td></tr>
<tr><td>Requirement for the team:</td><td>${v(j.requirement_for_team)}</td></tr>
<tr><td>Requirement for team (Other):</td><td>${v(j.requirement_for_team_other)}</td></tr>
<tr><td>Desired Qualification:</td><td>${v(j.desired_qualification)}</td></tr>
<tr><td>PG Qualification Info:</td><td>${v(j.pg_more_info)}</td></tr>
<tr><td>Graduate / Other Info:</td><td>${v(j.graduate_more_info)}</td></tr>
<tr><td>Other Qualification Info:</td><td>${v(j.other_qualification_more_info)}</td></tr>
<tr><td>Replacement or New Role:</td><td>${v(j.replacement_or_new_role)}</td></tr>
<tr><td>Replacement Comments:</td><td>${v(j.replacement_comments)}</td></tr>
<tr><td>Total Years of Experience:</td><td>${v(j.total_years_experience)}</td></tr>
<tr><td>Relevant Years of Experience:</td><td>${v(j.relevant_years_experience)}</td></tr>
<tr><td>Project Name:</td><td>${v(j.project_name)}</td></tr>
<tr><td>Project Duration:</td><td>${v(j.project_duration)}</td></tr>
<tr><td>Employment Type:</td><td>${v(j.employment_type)}</td></tr>
<tr><td>Existing Resource Allocation Possible:</td><td>${v(j.allocate_existing_resources)}</td></tr>
<tr><td>Existing Resource Info:</td><td>${v(j.existing_resources_info)}</td></tr>
<tr><td>Roles & Responsibilities:</td><td>${v(j.roles_responsibilities)}</td></tr>
<tr><td>Roles & Responsibilities (Other):</td><td>${v(j.roles_responsibilities_other)}</td></tr>
<tr><td>Mandatory Skills:</td><td>${v(j.mandatory_skills)}</td></tr>
<tr><td>Mandatory Skills (Other):</td><td>${v(j.mandatory_skills_other)}</td></tr>
<tr><td>Good to Have Skills:</td><td>${v(j.good_to_have_skills)}</td></tr>
<tr><td>Good to Have Skills (Other):</td><td>${v(j.good_to_have_skills_other)}</td></tr>
<tr><td>1st Technical Round:</td><td>${v(j.first_technical_round)}</td></tr>
<tr><td>2nd Technical Round:</td><td>${v(j.second_technical_round)}</td></tr>
<tr><td>CEO / Management Round:</td><td>${v(j.ceo_management_round)}</td></tr>
<tr><td>CEO Panel Details:</td><td>${v(j.ceo_panel_details)}</td></tr>
<tr><td>HR Round:</td><td>${v(j.hr_round)}</td></tr>
<tr><td>Client Round:</td><td>${v(j.client_round)}</td></tr>
<tr><td>Client Round Coordinator:</td><td>${v(j.client_round_coordinator)}</td></tr>
<tr><td>Job Timing:</td><td>${v(j.job_timing)}</td></tr>
<tr><td>Daily Interview Slot (Round 1):</td><td>${v(j.daily_slot_round_1)}</td></tr>
<tr><td>Daily Interview Slot (Round 2):</td><td>${v(j.daily_slot_round_2)}</td></tr>
<tr><td>Weekly Meeting Slot:</td><td>${v(j.weekly_meeting_slot)}</td></tr>
<tr><td>Client Details:</td><td>${v(j.client_details)}</td></tr>
<tr><td>Additional Information:</td><td>${v(j.additional_information_hrd_hrd)}</td></tr>
<tr><td>Competencies Required:</td><td>${v(j.competencies_required)}</td></tr>
<tr><td>Question Paper:</td><td>${v(j.question_paper)}</td></tr>
<tr><td>Question Paper New Owner:</td><td>${v(j.question_paper_new_owner)}</td></tr>
<tr><td>Approved by Abhijit:</td><td>${v(j.approved_by_abhijit)}</td></tr>
<tr><td>JD Document Link:</td><td>${jdLink ? `<a href="${jdLink}">Click here to view JD</a>` : 'Not Uploaded'}</td></tr>
${ parsedPreview ? `<tr><td>Parsed JD:</td><td>${parsedPreview}</td></tr>` : '' }
</table>
</body>
</html>
```

## 4.2 MRF Approval Request → Management — `Send message and wait for response` (sendAndWait)
- **Purpose:** Sends the MRF to management and **blocks until they respond** via an embedded Approve/Decline form.
- **To:** `hmopuri@aapnainfotech.com, saukumar@aapnainfotech.com, pkmondal@aapnainfotech.com`
- **Subject:** `New MRF Request - Approval Request`
- **Interactive form:** a *"Comments for Approve/Decline"* textarea + a required *"Select Action"* dropdown (**Approve** / **Decline**); button label *"Click here to Approve/Decline"*.
- **Body source:** `={{ $('Code in JavaScript').item.json.approvalEmailBodyHtml }}` — the same submission table as §4.1 but with the greeting/intro block swapped to the management approval intro below (injected before `<table>`):

```html
<p style="font-size:14px; font-weight:bold; color:#000;">
Dear Abhijit Roy & Sanghamitra Roy,
</p>

<p style="font-size:14px; color:#000; line-height:1.6;">
We have received a new Manpower Requisition Form (MRF) request for your review and approval.
</p>

<p style="font-size:14px; color:#000; line-height:1.6;">
Kindly review the filled MRF and the attached Job Description and share your approval.<br>
Please review the filled MRF and attached JD and confirm your approval. Also, let us know whether this should be a permanent role or a different engagement model.
</p>

<p style="font-size:14px; color:#000; line-height:1.6;">
Also, please help define the priority of the role (High / Moderate / Low) as per the business need.
</p>
```

## 4.3 MRF Approved — `Approved Email` / `Approved Email2`
- **Purpose:** Notifies HR that Management approved the MRF. `Approved Email` uses the *with-comment* body; `Approved Email2` uses the plain body. Both append a forwarded copy of the original MRF submission.
- **To:** `hmopuri@aapnainfotech.com, saukumar@aapnainfotech.com`
- **Subject:** `Approved: New MRF Request`
- **Body (composed):** `={{ $json["Email Message"...] }}` + forwarded block:

```html
{{ Email Message [With Comment] }}


---------- Forwarded message ---------<br>

Subject: Re: New MRF Submission

{{ $('Select rows from a table - pending').item.json.emailbody }}
```

- **"Email Message" (approved, plain) — from `approved message` Set node:**

```html
<html>
  <body style="font-family: Calibri, sans-serif; font-size: 14px; color: #333;">
    <p>Hi Team,</p>

    <p>
      This is to formally inform you that Management has approved the request to proceed with the recruitment of additional manpower.
    </p>

  
    <p>
      Please initiate the recruitment process as per company policies and the approved MRF details.
    </p>

    <p>
      Thank you for your continued support, and we look forward to timely updates on the progress.
    </p>

    <p>Best regards,<br>CEO, AAPNA</p>
  </body>
</html>
```

- **"Email Message With Comment" (approved) — from `approved message` Set node:**

```html
<html>
  <body style="font-family: Calibri, sans-serif; font-size: 14px; color: #333;">
    <p>Hi Team,</p>

    <p>
      This is to formally inform you that Management has approved the request to proceed with the recruitment of additional manpower.
    </p>

    <p><strong>Comment from Management:</strong> {{ $('Send message and wait for response').item.json.data["Comments for Approve/Decline"] }}</p>

        <p>
     Please initiate the recruitment process as per company policies and the approved MRF details.
    </p>

    <p>Best regards,<br>CEO, AAPNA</p>
  </body>
</html>
```

## 4.4 MRF Declined — `Declined Email` / `Declined Email2`
- **Purpose:** Notifies HR that Management declined the MRF (recruitment on hold). Same forwarded-block structure as §4.3.
- **To:** `hmopuri@aapnainfotech.com, saukumar@aapnainfotech.com`
- **Subject:** `Declined: New MRF Request`
- **"Email Message" (declined, plain) — from `declined message` Set node:**

```html
<html>
  <body style="font-family: Calibri, sans-serif; font-size: 14px; color: #333;">
    <p>Hi Team,</p>

    <p>
      This is to formally inform you that Management has reviewed the request for additional manpower and has decided not to proceed with it at this time.
    </p>


    <p>
      Accordingly, please place the recruitment activity on hold until further instructions.
    </p>

    <p>
      Thank you for your understanding.
    </p>

    <p>Best regards,<br>CEO, AAPNA</p>
  </body>
</html>
```

- **"Email Message With Comment" (declined) — from `declined message` Set node:**

```html
<html>
  <body style="font-family: Calibri, sans-serif; font-size: 14px; color: #333;">
    <p>Hi Team,</p>

    <p>
      This is to formally inform you that Management has reviewed the request for additional manpower and has decided not to proceed with it at this time.
    </p>

    <p>
      <strong>Comment from Management:</strong> {{ $('Send message and wait for response').item.json.data["Comments for Approve/Decline"] }}
    </p>

  <p>
     Please place the recruitment activity on hold until further instructions.
    </p>

   

    <p>Best regards,<br>CEO, AAPNA</p>
  </body>
</html>
```

---

# 5. Candidate Screening — Step 2.4 (Initiate Shortlist — Multi Emails)

## 5.1 Shortlist / HR AI Interview Invite — `Create Shortlist Draft` → `Send Shortlist Draft`
- **Purpose:** Tells a shortlisted candidate they've been selected and to complete the HR AI Interview (Zeko). Body built by the `Prepare Email Content` Code node.
- **To:** `{{ $json.emailTo }}` (candidate); **CC:** `pkmondal@aapnainfotech.com`
- **Subject:** `You're Shortlisted -- Complete Your HR AI Interview | AAPNA Infotech`
- **Placeholders:** `${candidateName}`, `${roleName}`, `${roleParagraph}` (branches on `search_type` — `jd` vs keyword; see below)
- **Dynamic role paragraph:**
  - `search_type === 'jd'`: *"…you have been shortlisted for the position of **${roleName}** at AAPNA Infotech. Please note that this role is a **Work from Home (WFH)** opportunity."*
  - otherwise: *"…your profile has been shortlisted for a suitable position at AAPNA Infotech. Please note that this opportunity is a **Work from Home (WFH)** role."*
- **Body (HTML):**

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AAPNA Recruitment</title>
</head>

<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif;">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:30px 10px;">
<tr>
<td align="center">

<!-- EMAIL CARD -->
<table width="620" cellpadding="0" cellspacing="0"
style="max-width:620px;background:#ffffff;border-radius:12px;overflow:hidden;
box-shadow:0 6px 24px rgba(0,0,0,0.08);">

<!-- HEADER -->
<tr>
<td style="background:#7a922e;padding:32px 40px;text-align:center;">

<img src="https://www.aapnainfotech.com/wp-content/uploads/2021/09/aapna-gptw-black.png"
width="190"
style="display:block;margin:0 auto 16px auto;">

<h1 style="margin:0;font-size:24px;color:#ffffff;font-weight:800;">
Your Application Has Been Shortlisted 🎉
</h1>

<p style="margin:6px 0 0 0;color:#e7f0c5;font-size:13px;">
Where Culture, Code, and Courage Come Together
</p>

</td>
</tr>


<!-- GREETING -->
<tr>
<td style="padding:32px 40px 16px 40px;font-size:15px;color:#374151;line-height:1.7;">

<p style="margin:0 0 14px 0;">
Dear <strong>${candidateName}</strong>,
</p>

<p style="margin:0 0 14px 0;">
Greetings from <strong>AAPNA Infotech</strong>.
</p>

${roleParagraph}

</td>
</tr>


<!-- DIVIDER -->
<tr>
<td style="padding:0 40px;">
<hr style="border:none;border-top:1px solid #e5e7eb;">
</td>
</tr>


<!-- INTERVIEW STEP -->
<tr>
<td style="padding:24px 40px;font-size:14px;color:#374151;line-height:1.7;">

<p>
As the next step, you are required to complete an
<strong>HR AI Interview through the Zeko HR platform</strong>.
The interview link will be shared with you shortly in a separate email.
</p>

<h3 style="margin-top:18px;color:#7a922e;">
Important Instructions
</h3>

<ul style="padding-left:18px;margin:10px 0;">
<li style="margin-bottom:6px;">Ensure you have a <strong>stable internet connection</strong>.</li>
<li style="margin-bottom:6px;">Use a <strong>laptop or desktop with webcam</strong>.</li>
<li style="margin-bottom:6px;">Fill all required details carefully.</li>
<li style="margin-bottom:6px;">Attend the interview <strong>without external help or AI tools</strong>.</li>
<li style="margin-bottom:6px;">Complete the interview <strong>in one sitting</strong>.</li>
<li style="margin-bottom:6px;">Finish within <strong>24–48 hours</strong>.</li>
</ul>

</td>
</tr>


<!-- INTERVIEW PROCESS -->
<tr>
<td style="padding:0 40px 28px 40px;">

<table width="100%" cellpadding="0" cellspacing="0"
style="background:#f6f9eb;border-left:4px solid #7a922e;border-radius:8px;">
<tr>
<td style="padding:20px;font-size:14px;color:#374151;line-height:1.6;">

<strong style="color:#5a6e1f;font-size:15px;">
Interview Process at AAPNA Infotech
</strong>

<ol style="margin:12px 0 0 18px;">
<li>HR AI Interview (Zeko HR platform)</li>
<li>Evalground Technical Assessment</li>
<li>Zeko Functional / Coding Assessment</li>
<li>Technical Interview – Round 1</li>
<li>Technical Interview – Round 2</li>
<li>Final Discussion with HR / Leadership</li>
<li>Client Interview (if applicable)</li>
</ol>

</td>
</tr>
</table>

</td>
</tr>


<!-- CTA -->
<tr>
<td style="padding:0 40px 30px 40px;text-align:center;">

<p style="font-size:14px;color:#374151;margin-bottom:14px;">
Before proceeding, please review our website.
</p>

<a href="https://www.aapnainfotech.com/"
style="display:inline-block;padding:12px 28px;background:#7a922e;color:#ffffff;
text-decoration:none;border-radius:6px;font-weight:700;font-size:14px;">
Explore AAPNA Infotech
</a>

</td>
</tr>



<!-- SIGNATURE -->
<tr>
<td style="padding:0 40px 32px 40px;font-size:14px;color:#6b7280;line-height:1.6;">

<p style="margin:0 0 4px 0;">Best regards,</p>
<p style="margin:0;font-weight:700;color:#111827;">AAPNA Recruitment Team</p>
<p style="margin:2px 0 0 0;color:#7a922e;font-weight:700;">AAPNA Infotech</p>

</td>
</tr>


<!-- FOOTER -->
<tr>
<td style="background:#f3f4f6;padding:16px;text-align:center;font-size:12px;color:#9ca3af;">

This email was sent because your profile was submitted to AAPNA Infotech's recruitment system.<br>
© 2026 AAPNA Infotech. All rights reserved.

</td>
</tr>

</table>

</td>
</tr>
</table>

</body>
</html>
```

## 5.2 No CV Alert (internal) — `Notify Ui User`
- **Purpose:** Internal ops alert when a candidate email can't be matched to a CV row in `rpa_cv`.
- **To:** `hmopuri@aapnainfotech.com`
- **Subject:** `No CV Alert ! Couldn't Find Candidate Data in Database`
- **Body (plain text):**

```text
Hi,

Candidate Email - {{$node['Loop Over Items'].json.EmailID}} couldn't found in the rpa_cv.

Thanks,
n8n.
```

---

# 6. Candidate Screening — Step 2.5 (Interview Schedule)

## 6.1 Interview Scheduled — `Email — Send Scheduled Interview Link` **(DISABLED node)**
- **Purpose:** Interview invitation once an AI video-interview slot is scheduled. *(Node is currently disabled.)*
- **To:** `{{ $('Code — Build Schedule Email Data').item.json.candidate_email }}`
- **Subject:** `Interview Scheduled — {{ $('Code — Build Schedule Email Data').item.json.job_title }} ({{ $('Code — Build Schedule Email Data').item.json.stageLabel }})`
- **Placeholders:** `candidate_name`, `job_title`, `stageLabel`, `startStr`, `endStr`, `{{ $json.interviewLink }}`
- **Body (HTML):**

```html
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; color: #333; line-height: 1.7; max-width: 600px; margin: 0 auto;">
  <div style="background: linear-gradient(135deg, #185fa5, #1e40af); padding: 24px 28px; border-radius: 10px 10px 0 0;">
    <h2 style="color: #fff; margin: 0; font-size: 18px;">🎯 Interview Invitation</h2>
    <p style="color: rgba(255,255,255,0.85); margin: 6px 0 0; font-size: 13px;">AAPNA Infotech — Recruitment Team</p>
  </div>
  <div style="background: #fff; border: 1px solid #e2e8f0; border-top: none; padding: 28px; border-radius: 0 0 10px 10px;">
    <p style="font-size: 15px;">Dear <strong>{{ $('Code — Build Schedule Email Data').item.json.candidate_name }}</strong>,</p>
    <p>We are pleased to invite you for an AI-powered video interview for the position of <strong>{{ $('Code — Build Schedule Email Data').item.json.job_title }}</strong> — <strong>{{ $('Code — Build Schedule Email Data').item.json.stageLabel }}</strong>.</p>
    <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 16px 20px; margin: 20px 0;">
      <p style="margin: 0 0 8px; font-size: 13px; font-weight: 700; color: #0369a1; text-transform: uppercase; letter-spacing: 0.05em;">📅 Interview Schedule</p>
      <table style="font-size: 14px; color: #1e293b;">
        <tr><td style="padding: 4px 12px 4px 0; font-weight: 600;">Start:</td><td>{{ $('Code — Build Schedule Email Data').item.json.startStr }}</td></tr>
        <tr><td style="padding: 4px 12px 4px 0; font-weight: 600;">End:</td><td>{{ $('Code — Build Schedule Email Data').item.json.endStr }}</td></tr>
      </table>
    </div>
    <p style="font-size: 14px;">Please complete your interview within the scheduled window by clicking the button below:</p>
    <div style="text-align: center; margin: 24px 0;">
      <a href="{{ $json.interviewLink }}" target="_blank" style="background: #185fa5; color: #fff; padding: 13px 28px; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 15px; display: inline-block;">🎬 Start My Interview</a>
    </div>
    <p style="font-size: 13px; color: #64748b;">Or copy this link: <a href="{{ $('Code — Build Schedule Email Data').item.json.interviewLink }}" style="color: #185fa5;">{{ $('Code — Build Schedule Email Data').item.json.interviewLink }}</a></p>
    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
    <p style="font-size: 13px; color: #64748b;">If you have any questions, please contact our HR team by replying to this email.</p>
    <p>Best regards,<br><strong>HR Team</strong><br>AAPNA Infotech</p>
  </div>
</body>
</html>
```

## 6.2 Interview Cancelled — `Email — Send Interview Cancellation`
- **Purpose:** Notifies candidate a scheduled interview was cancelled and will be rescheduled.
- **To:** `{{ $('Code — Build Cancel Email').item.json.candidate_email }}`
- **Subject:** `Interview Cancelled — {{ $('Code — Build Cancel Email').item.json.job_title }} ({{ $('Code — Build Cancel Email').item.json.stage.toUpperCase() }} Round)`
- **Placeholders:** `candidate_name`, `job_title`, `stage`
- **Body (HTML):**

```html
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; color: #333; line-height: 1.7; max-width: 600px; margin: 0 auto;">
  <div style="background: linear-gradient(135deg, #c0392b, #e74c3c); padding: 24px 28px; border-radius: 10px 10px 0 0;">
    <h2 style="color: #fff; margin: 0; font-size: 18px;">❌ Interview Cancellation Notice</h2>
    <p style="color: rgba(255,255,255,0.85); margin: 6px 0 0; font-size: 13px;">AAPNA Infotech — Recruitment Team</p>
  </div>
  <div style="background: #fff; border: 1px solid #e2e8f0; border-top: none; padding: 28px; border-radius: 0 0 10px 10px;">
    <p style="font-size: 15px;">Dear <strong>{{ $('Code — Build Cancel Email').item.json.candidate_name }}</strong>,</p>
    <p>We regret to inform you that your scheduled interview for the position of <strong>{{$('Code — Build Cancel Email').item.json.job_title }}</strong> ({{ $('Code — Build Cancel Email').item.json.stage.toUpperCase() }} Round) has been <strong>cancelled</strong>.</p>
    <p>We sincerely apologize for the inconvenience. Our HR team will contact you shortly to reschedule at the earliest possible opportunity.</p>
    <p>Thank you for your patience and continued interest in joining AAPNA Infotech.</p>
    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
    <p>Best regards,<br><strong>HR Team</strong><br>AAPNA Infotech</p>
  </div>
</body>
</html>
```

---

# 7. Candidate Screening — Step 2.6 (Recruitment Status Update & Notify)

## 7.1 Candidate Status Update — `Create Email Draft` → `Send Email Draft`
- **Purpose:** Candidate-facing status notification, fired when a recruiter changes a candidate's pipeline status. One node handles **four status variants** — `shortlisted`, `rejected`, `on_hold`, `emailed` (interview invite). Content is built by the `Prepare Notify Email` Code node.
- **To:** `{{ $json.candidate_email }}`; **CC:** `pkmondal@aapnainfotech.com`
- **Two body paths:**
  1. **DB template** — if a row exists in `rpa_email_templates` for the status category, its `subject` + `body_html` are used with placeholder substitution.
  2. **Hardcoded fallback** — the branded HTML below.
- **Placeholders substituted:** `{candidate_name}`, `{position}`, `{role_name}`, `{recruiter_name}`, `{company_name}` (=`AAPNA Infotech`), `{status}`, `{candidate_email}`, `{interview_date}`/`{interview_time}` (=`TBD (we will confirm separately)`), `{interview_link}` (empty), `{offer_date}` (empty)
- **Fallback subjects (per status):**
  - rejected → `Update on Your Application - AAPNA Infotech`
  - on_hold → `Application on Hold - AAPNA Infotech`
  - shortlisted → `You are Shortlisted - ${roleName} | AAPNA Infotech`
  - emailed → `Interview Invitation - ${roleName} at AAPNA`
  - default → `Application Update - AAPNA Infotech`
- **Status-specific body paragraphs (`${bodyParagraphs}`):**

```html
<!-- rejected -->
<p>After careful consideration of your profile, we regret to inform you that we are unable to move forward with your application for <strong>${roleName}</strong> at this time.</p><p>We truly appreciate the time and effort you invested in our process. We will keep your profile on file and encourage you to apply for future opportunities.</p><p>We wish you all the best in your career journey.</p>

<!-- on_hold -->
<p>Thank you for your continued interest in the <strong>${roleName}</strong> position at AAPNA Infotech.</p><p>Your application is currently on hold while we complete our initial screening. We will reach out with an update as soon as possible.</p><p>We appreciate your patience.</p>

<!-- shortlisted -->
<p>We are pleased to inform you that your profile has been shortlisted for the <strong>${roleName}</strong> position at AAPNA Infotech.</p><p>The next step is to complete your HR AI Interview via the Zeko HR platform. You will receive the interview link shortly.</p><p>Please complete the interview within 24-48 hours.</p>

<!-- emailed (interview invite) -->
<p>We would like to invite you for an interview for the <strong>${roleName}</strong> position at AAPNA Infotech.</p><p>Our team will reach out to confirm the date, time and format. Please keep your schedule open and reply to this email to confirm your availability.</p>
```

- **Fallback wrapper (HTML) — `${statusLabel}` = Application Update / Application on Hold / Shortlisted / Interview Link Sent:**

```html
<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:30px 10px"><tr><td align="center"><table width="620" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,0.08)"><tr><td style="background:#7a922e;padding:32px 40px;text-align:center"><img src="https://www.aapnainfotech.com/wp-content/uploads/2021/09/aapna-gptw-black.png" width="190" style="display:block;margin:0 auto 16px auto"><h1 style="margin:0;font-size:22px;color:#ffffff;font-weight:800">${statusLabel}</h1><p style="margin:6px 0 0 0;color:#e7f0c5;font-size:13px">AAPNA Infotech - Recruitment Update</p></td></tr><tr><td style="padding:32px 40px 8px 40px;font-size:15px;color:#374151;line-height:1.8"><p>Dear <strong>${candidateName}</strong>,</p><p>Greetings from <strong>AAPNA Infotech</strong>.</p>${bodyParagraphs}</td></tr><tr><td style="padding:0 40px 32px 40px;font-size:14px;color:#6b7280;line-height:1.6"><p style="margin:0 0 4px 0">Best regards,</p><p style="margin:0;font-weight:700;color:#111827">${recruiterName}</p><p style="margin:2px 0 0 0;color:#7a922e;font-weight:700">AAPNA Infotech</p></td></tr><tr><td style="background:#f3f4f6;padding:16px;text-align:center;font-size:12px;color:#9ca3af">This email was sent by AAPNA Infotech's recruitment system.<br>© 2026 AAPNA Infotech. All rights reserved.</td></tr></table></td></tr></table></body></html>
```

---

# 8. System Configuration — Reminder Scheduler

## 8.1 Follow-up Reminder — `Create Reminder Draft` → `Send Reminder Draft`
- **Purpose:** Runs daily (09:00 schedule); re-sends un-answered emails from `rpa_email_log` with a reminder banner, until `reminder_count` reaches `max_count`. Body built by the `Code - Build Reminder Email` node and varies by `email_type`.
- **Recipient:** the draft node's `toRecipients` is **hard-coded to `pkmondal@aapnainfotech.com`** (the record's real `recipient_email` is only used for DB logging — see Notes).
- **Subject:** `Reminder (${reminderNumber}/${maxCount}): ${item.subject}` (e.g. `Reminder (2/3): <original subject>`)
- **Placeholders:** `${reminderNumber}`, `${maxCount}`, `${item.recipient_name}`, `${item.subject}`, `${item.body_html}` (token or original body), `${formLink}`

**Variant A — `email_type === 'missing_jd'` (candidate profile completion):**

```html
<div style="font-family:Inter,Arial,sans-serif; max-width:600px; margin:0 auto; padding:24px; color:#111827;">

  <div style="background:#fff3cd; border-left:4px solid #f59e0b; padding:12px 16px; margin-bottom:24px; border-radius:4px;">
    <strong style="font-size:14px;">Reminder ${reminderNumber} of ${maxCount}</strong><br/>
    <span style="font-size:13px;">This is a follow-up to our previous email. Please take action at your earliest convenience.</span>
  </div>

  <p>Dear ${item.recipient_name || 'Candidate'},</p>

  <p>We hope this message finds you well.</p>

  <p>This is a gentle reminder that we are still awaiting your response regarding the <strong>missing profile details</strong> that are required to complete your application process.</p>

  <p>Please take a moment to fill in the required information by clicking the button below:</p>

  <div style="text-align:center; margin:28px 0;">
    <a href="${formLink}"
       style="display:inline-block; background:#6366f1; color:white;
              padding:14px 32px; border-radius:8px; text-decoration:none;
              font-weight:600; font-size:15px;">
      Complete Your Profile
    </a>
  </div>

  <p style="font-size:13px; color:#6b7280;">
    If the button doesn't work, copy and paste this link into your browser:<br/>
    <a href="${formLink}" style="color:#6366f1;">${formLink}</a>
  </p>

  <p>If you have any questions, please feel free to reach out to our HR team.</p>

  <p>Warm regards,<br/>
  <strong>HR Team</strong><br/>
  Aapna Infotech</p>

</div>
```
*(`formLink` = `https://aiautomation.aapnainfotech.com/webhook/486396fa-445a-4c19-b987-ea2da4b13441?token=${item.body_html}`)*

**Variant B — `email_type === 'mrf_approval'` (management approval nudge):**

```html
<div style="font-family:Inter,Arial,sans-serif; max-width:600px; margin:0 auto; padding:24px; color:#111827;">

  <div style="background:#fff3cd; border-left:4px solid #f59e0b; padding:12px 16px; margin-bottom:24px; border-radius:4px;">
    <strong style="font-size:14px;">Reminder ${reminderNumber} of ${maxCount}</strong><br/>
    <span style="font-size:13px;">This is a follow-up to our previous MRF Approval request.</span>
  </div>

  <p>Dear Abhijit Roy &amp; Sanghamitra Roy,</p>

  <p>I hope this message finds you well.</p>

  <p>
    This is a gentle reminder regarding the <strong>Manpower Requisition Form (MRF) Approval</strong>
    that was sent to you earlier and is currently awaiting your review and decision.
  </p>

  <p>
    Kindly check your inbox for our previous email with the subject:<br/>
    <strong style="color:#1e40af;">"${item.subject.replace('Reminder (' + reminderNumber + '/' + maxCount + '): ', '')}"</strong>
  </p>

  <p>
    The email contains the complete MRF details along with the attached Job Description.
    Please review and share your <strong>Approval or Decline</strong> at your earliest convenience
    so we can proceed with the hiring process accordingly.
  </p>

  <div style="background:#f0fdf4; border:1px solid #86efac; border-radius:8px; padding:16px; margin:24px 0;">
    <p style="margin:0; font-size:14px; color:#166534;">
      ⏳ <strong>Action Required:</strong> Please check your previous email and click
      <strong>Approve</strong> or <strong>Decline</strong> to complete the MRF review process.
    </p>
  </div>

  <p>
    If you are unable to locate the original email, please do not hesitate to contact the HR team
    and we will be happy to resend it immediately.
  </p>

  <p>We appreciate your time and look forward to your response.</p>

  <p>Warm regards,<br/>
  <strong>HR Team</strong><br/>
  Aapna Infotech</p>

</div>
```

**Variant C — default / `mrf_hm` (banner + original body re-sent):** the yellow banner is prepended to the original stored email (`finalBody = reminderBanner + item.body_html`):

```html
<div style="background:#fff3cd; border-left:4px solid #f59e0b;
padding:12px 16px; margin-bottom:20px; font-family:sans-serif;">
  <strong>Reminder ${reminderNumber} of ${maxCount}</strong><br/>
  This is a follow-up to our previous email.
  Please take action at your earliest convenience.
</div>
```

---

# 9. Admin — HR Admin Dashboard

## 9.1 Welcome + Credentials — `Email — Welcome + Credentials`
- **Purpose:** Sends login credentials to a newly created portal user.
- **To:** `{{ $('Code — Build New User').item.json.email }}`
- **Subject:** `Your AAPNA Recruitment Portal Account is Ready`
- **Body (plain text):**

```text
Hi {{ $('Code — Build New User').item.json.firstName }} {{ $('Code — Build New User').item.json.lastName }},

Your account has been created on the AAPNA Recruitment Portal.

Login credentials:

   Username : {{ $('Code — Build New User').item.json.username }}
   Password : {{ $('Code — Build New User').item.json.plainPw }}
   Role     : {{ $('Code — Build New User').item.json.role }}


⚠️ For security, please do not share your password with anyone.


Best regards,
HR Admin — AAPNA Infotech
```

## 9.2 Password Changed — `Email — Password Changed`
- **Purpose:** Notifies a user their password was reset by the HR Admin.
- **To:** `{{ $('Code — Build UPDATE Query').first().json.body.email }}`
- **Subject:** `Your AAPNA Recruitment Portal Password Has Been Updated`
- **Body (plain text):**

```text
Hi {{ $('Code — Build UPDATE Query').first().json.body.first_name }} {{ $('Code — Build UPDATE Query').first().json.body.last_name }},

Your password for the AAPNA Recruitment Portal has been successfully updated by the HR Admin.

Your updated login credentials are:

   Username : {{ $('Code — Build UPDATE Query').first().json.body.username }}
   Password : {{ $('Code — Prep PW Reset Hash Input').first().json.plainPassword }}


⚠️ For security, please do not share your password with anyone.


Best regards,
HR Admin — AAPNA Infotech
```

---

# Notes & observations

- **Staging recipients are hard-coded.** In the Resume-Parser flows the candidate-facing emails (Welcome, Complete Your Profile) have their `To` set to the internal HR trio (`hmopuri@`, `pkmondal@`, `saukumar@aapnainfotech.com`) instead of the candidate — expected for a staging export, but must be swapped to the candidate address in production.
- **Reminder Scheduler recipient.** `Create Reminder Draft` sends `toRecipients` to `pkmondal@aapnainfotech.com` (hard-coded), while the real `recipient_email` is only used when logging to the DB. Either intentional (drafts funneled to one mailbox for manual send) or a bug worth confirming.
- **Disabled nodes.** `Email: Upload Summary Report` (Resume 1.1.1) and `Email — Send Scheduled Interview Link` (Step 2.5) are disabled in the exports — their templates are documented above but they do not currently fire.
- **DB-backed vs hardcoded.** Step 2.6 prefers templates from the `rpa_email_templates` table (categories: shortlist / interview / rejection / follow_up) and only falls back to the hardcoded HTML above when no DB row is found. The actual DB template content is not part of the flow JSON.
- **Copyright year drift.** Footers mix `© 2025` (Resume Parser, MRF) and `© 2026` (Step 2.4 / 2.6) — worth standardizing.
- **Minor text issues in flow.** "System Notificatio" (truncated) in §1.5; trailing space in the subject of §1.4 (`Alert: CV Already Exists - Different Vendor `).
