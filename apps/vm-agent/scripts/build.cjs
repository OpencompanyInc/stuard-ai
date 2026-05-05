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
 *   node scripts/build.cjs
 *   node scripts/build.cjs --upload         # also upload to GCS
 *   node scripts/build.cjs --no-obfuscate   # skip obfuscation (dev builds)
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const ENTRY = path.join(ROOT, 'src', 'vm-agent.ts');
const OUTFILE = path.join(ROOT, 'dist', 'vm-agent-bundle.js');

const skipObfuscate = process.argv.includes('--no-obfuscate');

/**
 * Upload a file to GCS using the JSON API directly.
 * Only requires storage.objects.create — avoids the LIST/GET pre-checks
 * that gsutil and gcloud storage cp perform.
 */
async function uploadToGCS(localPath, bucket, objectName) {
  const https = require('https');
  const sa = process.env.GCS_SERVICE_ACCOUNT;
  const acctFlag = sa ? ` --account=${sa}` : '';
  const token = execSync(`gcloud auth print-access-token${acctFlag}`, { encoding: 'utf8' }).trim();
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

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });

console.log('[build-vm-agent] Step 1: Bundling with esbuild...');

async function build() {
  try {
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

  if (!skipObfuscate) {
    console.log('[build-vm-agent] Step 2: Obfuscating...');
    try {
      try {
        require.resolve('javascript-obfuscator');
      } catch {
        console.log('[build-vm-agent] Installing javascript-obfuscator...');
        execSync('pnpm add -D javascript-obfuscator', { cwd: ROOT, stdio: 'inherit' });
      }

      const JavaScriptObfuscator = require('javascript-obfuscator');
      const source = fs.readFileSync(OUTFILE, 'utf8');

      const result = JavaScriptObfuscator.obfuscate(source, {
        identifierNamesGenerator: 'hexadecimal',
        renameGlobals: false,
        renameProperties: false,
        stringArray: true,
        stringArrayThreshold: 0.5,
        stringArrayEncoding: ['rc4'],
        stringArrayWrappersCount: 2,
        stringArrayWrappersChainedCalls: true,
        rotateStringArray: true,
        shuffleStringArray: true,
        splitStrings: false,
        controlFlowFlattening: true,
        controlFlowFlatteningThreshold: 0.3,
        deadCodeInjection: true,
        deadCodeInjectionThreshold: 0.15,
        transformObjectKeys: false,
        unicodeEscapeSequence: false,
        selfDefending: false,
        disableConsoleOutput: false,
        debugProtection: false,
        compact: true,
        simplify: true,
        numbersToExpressions: false,
        target: 'node',
      });

      fs.writeFileSync(OUTFILE, result.getObfuscatedCode());

      const finalStats = fs.statSync(OUTFILE);
      console.log(`[build-vm-agent] Obfuscated: ${(finalStats.size / 1024).toFixed(1)} KB`);
    } catch (err) {
      console.error('[build-vm-agent] Obfuscation failed (bundle still minified):', err.message);
    }
  } else {
    console.log('[build-vm-agent] Step 2: Skipping obfuscation (--no-obfuscate)');
  }

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
