import fs from 'fs';

const path = "e:\\05.06.2026 - Copy\\Staging - MRF\\MRF - Step 1.1 - The Manpower Requisition Form (MRF) is sent by HR to the Hiring Manager.json";
const workflow = JSON.parse(fs.readFileSync(path, 'utf8'));

workflow.nodes.forEach(node => {
  if (node.name.includes('Anchor') || node.name.includes('Link')) {
    console.log(`Node Name: "${node.name}"`);
    console.log(`Type: ${node.type}`);
    console.log(`Parameters:`, JSON.stringify(node.parameters, null, 2));
  }
});
