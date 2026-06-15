import prisma from '../config/database.js';

async function checkTemplates() {
  try {
    const templates = await prisma.rpa_email_templates.findMany();
    console.log("TEMPLATES COUNT:", templates.length);
    templates.forEach(t => {
      console.log(`- ID: ${t.id}, Name: "${t.name}", Subject: "${t.subject}"`);
    });
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

checkTemplates();
