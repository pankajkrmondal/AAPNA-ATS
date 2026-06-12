import fs from 'fs';

const path = "e:\\05.06.2026 - Copy\\Staging - MRF\\MRF - Step 1.1 - The Manpower Requisition Form (MRF) is sent by HR to the Hiring Manager.json";
const workflow = JSON.parse(fs.readFileSync(path, 'utf8'));

console.log("Nodes count:", workflow.nodes.length);
console.log("Outlook / Email nodes:");
workflow.nodes.forEach(node => {
  if (node.type.includes('outlook') || node.name.includes('Send') || node.name.includes('Email') || node.name.includes('Mail')) {
    console.log(`- Name: "${node.name}"`);
    console.log(`  Type: ${node.type}`);
    console.log(`  Parameters:`, JSON.stringify(node.parameters, null, 2));
  }
});
