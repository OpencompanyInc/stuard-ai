#!/usr/bin/env node
/**
 * Build the VM Agent into a single self-contained bundle.
 * 
 * Steps:
 *   1. esbuild: bundle + tree-shake + minify
 *   2. javascript-obfuscator: identifier mangling, string encryption, control flow flattening
 * 
 * Output: dist/vm-agent-bundle.js
 * 
 * Usage:
 *   node scripts/build-vm-agent.cjs
 *   node scripts/build-vm-agent.cjs --upload   # also upload to GCS
 *   node scripts/build-vm-agent.cjs --no-obfuscate   # skip obfuscation (dev builds)
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const ENTRY = path.join(ROOT, 'src', 'agent', 'vm-agent.ts');
const OUTFILE = path.join(ROOT, 'dist', 'vm-agent-bundle.js');
const OBFUSCATED = path.join(ROOT, 'dist', 'vm-agent-bundle.obf.js');

const skipObfuscate = process.argv.includes('--no-obfuscate');

// Ensure dist/ exists
fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });

// ── Step 1: esbuild bundle + minify ─────────────────────────────────────────
console.log('[build-vm-agent] Step 1: Bundling with esbuild...');

try {
  execSync(
    `npx esbuild "${ENTRY}" --bundle --platform=node --target=node20 --minify --outfile="${OUTFILE}" --format=cjs --external:node-pty`,
    { cwd: ROOT, stdio: 'inherit' }
  );

  const stats = fs.statSync(OUTFILE);
  console.log(`[build-vm-agent] esbuild done: ${(stats.size / 1024).toFixed(1)} KB`);
} catch (err) {
  console.error('[build-vm-agent] esbuild failed:', err.message);
  process.exit(1);
}

// ── Step 2: javascript-obfuscator (identifier mangling + string encryption) ─
if (!skipObfuscate) {
  console.log('[build-vm-agent] Step 2: Obfuscating...');
  try {
    // Ensure javascript-obfuscator is available
    try {
      require.resolve('javascript-obfuscator');
    } catch {
      console.log('[build-vm-agent] Installing javascript-obfuscator...');
      execSync('pnpm add -D javascript-obfuscator', { cwd: ROOT, stdio: 'inherit' });
    }

    const JavaScriptObfuscator = require('javascript-obfuscator');
    const source = fs.readFileSync(OUTFILE, 'utf8');

    const result = JavaScriptObfuscator.obfuscate(source, {
      // ── Identifier mangling ───────────────────────────────────────────
      identifierNamesGenerator: 'hexadecimal',
      renameGlobals: false,              // don't break require() / module.exports
      renameProperties: false,           // safe: don't rename obj.property
      
      // ── String protection ─────────────────────────────────────────────
      stringArray: true,
      stringArrayThreshold: 0.75,        // encrypt ~75% of strings
      stringArrayEncoding: ['rc4'],      // RC4 encoded strings
      stringArrayWrappersCount: 2,
      stringArrayWrappersChainedCalls: true,
      rotateStringArray: true,
      shuffleStringArray: true,
      splitStrings: true,
      splitStringsChunkLength: 10,
      
      // ── Control flow ──────────────────────────────────────────────────
      controlFlowFlattening: true,
      controlFlowFlatteningThreshold: 0.5,
      deadCodeInjection: true,
      deadCodeInjectionThreshold: 0.2,
      
      // ── Other protections ─────────────────────────────────────────────
      transformObjectKeys: true,
      unicodeEscapeSequence: false,      // keep size reasonable
      selfDefending: false,              // skip: can break in Node.js
      disableConsoleOutput: false,        // keep console.log for VM diagnostics
      debugProtection: false,             // not needed for server-side
      
      // ── Performance ───────────────────────────────────────────────────
      compact: true,
      simplify: true,
      numbersToExpressions: true,
      target: 'node',
    });

    fs.writeFileSync(OUTFILE, result.getObfuscatedCode());
    
    const finalStats = fs.statSync(OUTFILE);
    console.log(`[build-vm-agent] Obfuscated: ${(finalStats.size / 1024).toFixed(1)} KB`);
  } catch (err) {
    console.error('[build-vm-agent] Obfuscation failed (bundle still minified):', err.message);
    // Don't exit — the minified bundle is still usable
  }
} else {
  console.log('[build-vm-agent] Step 2: Skipping obfuscation (--no-obfuscate)');
}

// ── Step 3: Upload to GCS ───────────────────────────────────────────────────
if (process.argv.includes('--upload')) {
  const bucket = process.env.CLOUD_ENGINE_BUCKET || 'stuard-user-data';
  const dest = `gs://${bucket}/agent/vm-agent-bundle.js`;
  console.log(`[build-vm-agent] Uploading to ${dest}...`);
  try {
    execSync(`gsutil cp "${OUTFILE}" "${dest}"`, { cwd: ROOT, stdio: 'inherit' });
    console.log(`[build-vm-agent] Uploaded successfully.`);
  } catch (err) {
    console.error('[build-vm-agent] Upload failed:', err.message);
    process.exit(1);
  }
} else {
  console.log('[build-vm-agent] Skipping upload (use --upload flag).');
}

console.log('[build-vm-agent] Done.')
