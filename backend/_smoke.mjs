import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
const m = await import('./src/controllers/pipeline.controller.js');
console.log('controller loaded OK; listStageTemplates =', typeof m.listStageTemplates);
