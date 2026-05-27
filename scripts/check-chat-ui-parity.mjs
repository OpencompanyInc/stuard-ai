#!/usr/bin/env node
/**
 * Fails CI if chat-ui parity regresses:
 * - apps/website/src/_chat-ui/ must not exist
 * - website must not import chat UI from desktop or legacy shared paths
 * - desktop "shim" files (ai-elements + chat utils) must stay pure re-exports
 *   of @stuardai/chat-ui, so the package remains the single source of truth and
 *   nobody can silently refill a desktop-local private copy.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const errors = [];

const legacyChatUiDir = path.join(root, 'apps', 'website', 'src', '_chat-ui');
if (fs.existsSync(legacyChatUiDir)) {
  errors.push(`Legacy duplicate still exists: ${path.relative(root, legacyChatUiDir)}`);
}

const forbiddenImportPatterns = [
  /@\/_chat-ui\b/,
  /['"]\.\.?\/.*_chat-ui/,
  /shared\/chat-ui/,
  /apps\/desktop\/.*chat-ui/,
  /\.\.\/.*apps\/desktop/,
];

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (/\.(ts|tsx|js|jsx|css)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

const websiteSrc = path.join(root, 'apps', 'website', 'src');
for (const file of walk(websiteSrc)) {
  const rel = path.relative(root, file);
  const content = fs.readFileSync(file, 'utf8');
  for (const pattern of forbiddenImportPatterns) {
    if (pattern.test(content)) {
      errors.push(`${rel}: forbidden chat-ui import pattern ${pattern}`);
    }
  }
}

// ── Desktop shim guard ───────────────────────────────────────────────
// These desktop files used to hold private copies of chat-ui code. They must
// stay thin re-export shims pointing at @stuardai/chat-ui so a change to the
// package propagates to desktop AND website. If anyone refills one with a real
// implementation, this fails.
const desktopShims = [
  'apps/desktop/src/renderer/components/ai-elements/ChainOfThought.tsx',
  'apps/desktop/src/renderer/components/ai-elements/Shimmer.tsx',
  'apps/desktop/src/renderer/utils/streamMerge.ts',
  'apps/desktop/src/renderer/utils/text.ts',
  'apps/desktop/src/renderer/utils/attachments.ts',
];

// Matches `export { ... } from '@stuardai/chat-ui...'`, `export type { ... } from ...`,
// and `export * from '@stuardai/chat-ui...'` (single statement, possibly multi-line).
const reExportStmt =
  /export\s+(?:type\s+)?(?:\{[^}]*\}|\*)(?:\s+as\s+\w+)?\s+from\s+['"]@stuardai\/chat-ui[^'"]*['"]\s*;?/g;

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1'); // line comments (avoid http://)
}

for (const relShim of desktopShims) {
  const full = path.join(root, relShim);
  if (!fs.existsSync(full)) {
    errors.push(`Desktop shim missing: ${relShim} (expected a re-export of @stuardai/chat-ui)`);
    continue;
  }
  const raw = fs.readFileSync(full, 'utf8');
  if (!/@stuardai\/chat-ui/.test(raw)) {
    errors.push(`${relShim}: must re-export from @stuardai/chat-ui (no reference found)`);
    continue;
  }
  // Remove all valid re-export statements; anything left = local implementation.
  const leftover = stripComments(raw).replace(reExportStmt, '').trim();
  if (leftover.length > 0) {
    errors.push(
      `${relShim}: must contain only re-exports from @stuardai/chat-ui ` +
        `(found non-re-export code — did a private copy get reintroduced?)`,
    );
  }
}

if (errors.length > 0) {
  console.error('Chat UI parity check failed:\n');
  for (const err of errors) {
    console.error(`  - ${err}`);
  }
  process.exit(1);
}

console.log('Chat UI parity check passed.');
