import { sendMrfRequestEmail } from '../services/emailNotification.service.js';

async function testMrfEmail() {
  console.log("Starting MRF Email Test...");
  const payload = {
    first_name: "Pankaj",
    last_name: "Mondal",
    email: "pankajmondal3@gmail.com",
    cc_email: "pankajmondal3@gmail.com",
    role: "Python Developer",
    jd_doc_link: "https://aapnainfotheek-my.sharepoint.com/:w:/g/personal/pkmondal_aapnainfotech_com/EeQJzQ...",
    email_body_content: "As discussed, we would like to initiate the hiring process for the Python Developer position.",
    budget_min: 200000,
    budget_max: 500000,
    reference_id: 999
  };

  try {
    const success = await sendMrfRequestEmail(payload);
    console.log("MRF Email Sent Result:", success ? "SUCCESS" : "FAILED");
  } catch (err) {
    console.error("Error in MRF Email Test:", err);
  }
}

testMrfEmail();
