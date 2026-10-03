const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'app', 'page.tsx');
let source = fs.readFileSync(file, 'utf8');

const oldBlock = `      setEditing(draft);\n      setScanOpen(false);\n      navigate("evaluations");\n      notify("AI scan complete. Review the extracted fields before saving.");`;

const newBlock = `      setEditing(draft);\n      setViewing(null);\n      setScanOpen(false);\n      setPage("evaluations");\n      notify("AI scan complete. Review the extracted fields before saving.");`;

if (source.includes(newBlock)) {
  console.log('AI scan review flow is already fixed.');
  process.exit(0);
}

if (!source.includes(oldBlock)) {
  throw new Error('Could not find the expected AI scan navigation block in app/page.tsx.');
}

source = source.replace(oldBlock, newBlock);
fs.writeFileSync(file, source);
console.log('Fixed AI scan review flow.');
