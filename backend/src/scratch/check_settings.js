import prisma from '../config/database.js';

async function checkSettings() {
  try {
    const settings = await prisma.rpa_settings.findMany();
    console.log("SETTINGS COUNT:", settings.length);
    settings.forEach(s => {
      console.log(`- Key: "${s.key}", Value: "${s.value}"`);
    });
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

checkSettings();
