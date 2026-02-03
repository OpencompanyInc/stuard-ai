const fs = require('fs');
const path = require('path');

const toolsDir = path.join(__dirname, 'src/tools');

function fixFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8');
  let modified = false;

  // Pattern 1: execute: async ({ context, writer }) => {
  if (content.includes('execute: async ({ context, writer }) => {')) {
    content = content.replace(
      /execute:\s*async\s*\(\{\s*context,\s*writer\s*\}\)\s*=>\s*\{/g,
      'execute: async (inputData, { writer }) => {'
    );
    // Replace const { ... } = context with const { ... } = inputData
    content = content.replace(
      /const\s*\{\s*([^}]+)\s*\}\s*=\s*context\s+as/g,
      'const { $1 } = inputData as'
    );
    content = content.replace(
      /const\s*\{\s*([^}]+)\s*\}\s*=\s*context\s*;/g,
      'const { $1 } = inputData;'
    );
    modified = true;
  }

  // Pattern 2: execute: async ({ context }) => {
  if (content.includes('execute: async ({ context }) => {')) {
    content = content.replace(
      /execute:\s*async\s*\(\{\s*context\s*\}\)\s*=>\s*\{/g,
      'execute: async (inputData) => {'
    );
    // Replace const { ... } = context with const { ... } = inputData
    content = content.replace(
      /const\s*\{\s*([^}]+)\s*\}\s*=\s*context\s+as/g,
      'const { $1 } = inputData as'
    );
    content = content.replace(
      /const\s*\{\s*([^}]+)\s*\}\s*=\s*context\s*;/g,
      'const { $1 } = inputData;'
    );
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
