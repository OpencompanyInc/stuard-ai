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

const skipObfuscate = process.argv.includes('--no-obfuscate');

/**
 * Upload a file to GCS using the JSON API directly.
 * Only requires storage.objects.create — avoids the LIST/GET pre-checks
 * that gsutil and gcloud storage cp perform.
 */
async function uploadToGCS(localPath, bucket, objectName) {
  const https = require('https');
  const token = execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
  const fileData = fs.readFileSync(localPath);

  return new Promise((resolve, reject) => {
    const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(objectName)}`;
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/javascript',
        'Content-Length': fileData.length,
      },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body);
        } else {
          reject(new Error(`GCS upload returned ${res.statusCode}: ${body}`));
        }
      });
    });
    req.on('error', reject);
    req.end(fileData);
  });
}

// Ensure dist/ exists
fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });

// ── Step 1: esbuild bundle + minify ─────────────────────────────────────────
console.log('[build-vm-agent] Step 1: Bundling with esbuild...');

async function build() {
  try {
    // Use esbuild JS API — avoids "esbuild: not found" in CI
    const esbuild = require('esbuild');
    await esbuild.build({
      entryPoints: [ENTRY],
      bundle: true,
      platform: 'node',
      target: 'node20',
      minify: true,
      outfile: OUTFILE,
      format: 'cjs',
      external: ['node-pty'],
    });

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
        // NOTE: splitStrings MUST be false — it breaks JSON.parse/stringify
        // of workflow payloads and structured data. stringArrayThreshold is
        // lowered to avoid mangling JSON-heavy code paths.
        stringArray: true,
        stringArrayThreshold: 0.5,         // encrypt ~50% of strings (lower = safer for JSON)
        stringArrayEncoding: ['rc4'],      // RC4 encoded strings
        stringArrayWrappersCount: 2,
        stringArrayWrappersChainedCalls: true,
        rotateStringArray: true,
        shuffleStringArray: true,
        splitStrings: false,               // DISABLED: breaks workflow JSON and structured data

        // ── Control flow ──────────────────────────────────────────────────
        controlFlowFlattening: true,
        controlFlowFlatteningThreshold: 0.3, // lowered to reduce code bloat
        deadCodeInjection: true,
        deadCodeInjectionThreshold: 0.15,

        // ── Other protections ─────────────────────────────────────────────
        transformObjectKeys: false,        // DISABLED: breaks JSON object keys
        unicodeEscapeSequence: false,      // keep size reasonable
        selfDefending: false,              // skip: can break in Node.js
        disableConsoleOutput: false,        // keep console.log for VM diagnostics
        debugProtection: false,             // not needed for server-side

        // ── Performance ───────────────────────────────────────────────────
        compact: true,
        simplify: true,
        numbersToExpressions: false,       // DISABLED: can break numeric comparisons in JSON
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
    const objectName = 'agent/vm-agent-bundle.js';
    console.log(`[build-vm-agent] Uploading to gs://${bucket}/${objectName}...`);
    try {
      await uploadToGCS(OUTFILE, bucket, objectName);
      console.log(`[build-vm-agent] Uploaded successfully.`);
    } catch (err) {
      console.error('[build-vm-agent] Upload failed:', err.message);
      process.exit(1);
    }
  } else {
    console.log('[build-vm-agent] Skipping upload (use --upload flag).');
  }

  console.log('[build-vm-agent] Done.');
}

build();
