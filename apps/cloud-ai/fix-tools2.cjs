const fs = require('fs');
const path = require('path');

const toolsDir = path.join(__dirname, 'src/tools');

function fixFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8');
  let modified = false;

  // Pattern: args.context -> inputData
  if (content.includes('args.context')) {
    content = content.replace(/args\.context/g, 'inputData');
    modified = true;
  }

  // Pattern: const ctx = context as any -> const ctx = inputData as any
  if (content.includes('const ctx = context as any')) {
    content = content.replace(/const ctx = context as any/g, 'const ctx = inputData as any');
    modified = true;
  }

  // Pattern: context as any -> inputData as any (when not preceded by =)
  if (content.match(/[^=]=\s*context\s+as\s+any/)) {
    content = content.replace(/([^=])=\s*context\s+as\s+any/g, '$1= inputData as any');
    modified = true;
  }

  if (modified) {
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`Fixed: ${filePath}`);
  }
}

function processDirectory(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      processDirectory(fullPath);
    } else if (entry.name.endsWith('.ts')) {
      fixFile(fullPath);
    }
  }
}

processDirectory(toolsDir);
console.log('Done fixing tool files!');
