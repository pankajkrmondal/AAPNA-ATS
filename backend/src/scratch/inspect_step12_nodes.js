import fs from 'fs';

const path = "e:\\05.06.2026 - Copy\\Staging - MRF\\MRF- Step 1.2 - The Manpower Requisition Form (MRF) is submitted by the Hiring Manager.json";
const workflow = JSON.parse(fs.readFileSync(path, 'utf8'));

console.log("Nodes count:", workflow.nodes.length);
workflow.nodes.forEach((node, idx) => {
  console.log(`${idx + 1}. Name: "${node.name}" | Type: ${node.type}`);
});
