import fs from 'fs';

const path = "e:\\05.06.2026 - Copy\\Staging - MRF\\MRF- Step 1.2 - The Manpower Requisition Form (MRF) is submitted by the Hiring Manager.json";
const workflow = JSON.parse(fs.readFileSync(path, 'utf8'));

const targetNodes = [
  "Webhook2",
  "Upload a file",
  "Code - Insert Query Create",
  "Code - Extract Data",
  "Send message and wait for response",
  "JD Parser AI Agent",
  "Google Gemini Chat Model",
  "Update mrf_jd_send row"
];

workflow.nodes.forEach(node => {
  if (targetNodes.includes(node.name)) {
    console.log("=========================================");
    console.log(`Node: "${node.name}" | Type: ${node.type}`);
    console.log("Parameters:", JSON.stringify(node.parameters, null, 2));
  }
});
