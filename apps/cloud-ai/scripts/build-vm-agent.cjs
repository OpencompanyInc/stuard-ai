#!/usr/bin/env node
/**
 * Build the VM Agent into a single self-contained bundle.
 * 
 * Output: dist/vm-agent-bundle.js
 * 
 * Usage:
 *   node scripts/build-vm-agent.js
 *   node scripts/build-vm-agent.js --upload   # also upload to GCS
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const ENTRY = path.join(ROOT, 'src', 'agent', 'vm-agent.ts');
const OUTFILE = path.join(ROOT, 'dist', 'vm-agent-bundle.js');

// Ensure dist/ exists
fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });

console.log('[build-vm-agent] Bundling agent...');

try {
  // Use esbuild to bundle everything into a single file
  // node-pty is external because it has native bindings (installed on VM separately)
  execSync(
    `npx esbuild "${ENTRY}" --bundle --platform=node --target=node20 --outfile="${OUTFILE}" --format=cjs --external:node-pty`,
    { cwd: ROOT, stdio: 'inherit' }
  );

  const stats = fs.statSync(OUTFILE);
  console.log(`[build-vm-agent] Bundle created: ${OUTFILE} (${(stats.size / 1024).toFixed(1)} KB)`);

  // Upload to GCS if --upload flag is set
  if (process.argv.includes('--upload')) {
    const bucket = process.env.CLOUD_ENGINE_BUCKET || 'stuard-user-data';
    const dest = `gs://${bucket}/agent/vm-agent-bundle.js`;
    console.log(`[build-vm-agent] Uploading to ${dest}...`);
    execSync(`gsutil cp "${OUTFILE}" "${dest}"`, { cwd: ROOT, stdio: 'inherit' });
    // Make it readable by the VM service account
    execSync(`gsutil acl ch -u AllUsers:R "${dest}"`, { cwd: ROOT, stdio: 'inherit' });
    console.log(`[build-vm-agent] Uploaded successfully.`);
  }
} catch (err) {
  console.error('[build-vm-agent] Build failed:', err.message);
  process.exit(1);
}
