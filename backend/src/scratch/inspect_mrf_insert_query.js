import fs from 'fs';

const path = "e:\\05.06.2026 - Copy\\Staging - MRF\\MRF- Step 1.2 - The Manpower Requisition Form (MRF) is submitted by the Hiring Manager.json";
const workflow = JSON.parse(fs.readFileSync(path, 'utf8'));

workflow.nodes.forEach(node => {
  if (node.name.includes("Insert Query Create")) {
    console.log(`Node: "${node.name}"`);
    console.log(node.parameters.jsCode);
  }
});
