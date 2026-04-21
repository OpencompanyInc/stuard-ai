#!/usr/bin/env node
/**
 * Build & upload the Python agent bundle for VM deployment.
 * 
 * Steps:
 *   1. Copy agent source to a staging directory (excluding dev/desktop files)
 *   2. Inject VM mode entry point (sets STUARD_AGENT_MODE=vm before main.py runs)
 *   3. Compile .py → .pyc bytecode (strips source from bundle)
 *   4. Create tar.gz
 *   5. Optionally upload to GCS
 * 
 * Usage:
 *   node scripts/build-python-agent.cjs --upload
 *   node scripts/build-python-agent.cjs              # build only
 *   node scripts/build-python-agent.cjs --keep-source # keep .py (skip .pyc compile)
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const AGENT_DIR = path.resolve(ROOT, '..', 'agent');
const OUTPUT_DIR = path.resolve(ROOT, 'dist');
const STAGING_DIR = path.resolve(OUTPUT_DIR, '_python_staging');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'stuard-python-agent.tar.gz');
const GCS_BUCKET = process.env.CLOUD_ENGINE_BUCKET || 'stuard-user-data';
const GCS_PATH = `gs://${GCS_BUCKET}/agent/stuard-python-agent.tar.gz`;

const doUpload = process.argv.includes('--upload');
const keepSource = process.argv.includes('--keep-source');

// Desktop-only modules to exclude from VM bundle
const DESKTOP_ONLY_MODULES = [
  'gui.py',
  'clipboard.py',
  'windows.py',
  'screen_capture.py',
  'media.py',
  'media_bus.py',
  'wakeword.py',
  'mediapipe_tools.py',
];

// Dev/desktop-only directories and files to exclude
const EXCLUDE_PATTERNS = [
  '__pycache__',
  '*.pyc',
  '.git',
  '.venv',
  'venv',
  'node_modules',
  '*.spec',
  'build',
  'dist',
  '*.egg-info',
  'tests',
  '.pytest_cache',
  'anim.txt',
  'debug_drawers.py',
  'StuardAI_Improvements.txt',
  'test_api_drawers.py',
  'stuard-agent.spec',
  'build-agent.py',
  'README.md',
  '=4.9.0',
  '{{$workspace.data}}',
  'stuard-workflows',
  'scripts',
];

const EXCLUDE_PREFIXES = [
  '.pytest-',
  '_tmp',
  'test-temp',
];

function isSkippableFsError(error) {
  return error && (error.code === 'ENOENT' || error.code === 'EPERM' || error.code === 'EACCES');
}

// ── 1. Verify agent directory exists ────────────────────────────────────────
if (!fs.existsSync(path.join(AGENT_DIR, 'app', 'main.py'))) {
  console.error('❌ Agent directory not found at:', AGENT_DIR);
  process.exit(1);
}

// ── 2. Clean & create staging dir ───────────────────────────────────────────
console.log('📦 Building VM Python agent bundle');
if (fs.existsSync(STAGING_DIR)) {
  fs.rmSync(STAGING_DIR, { recursive: true, force: true });
}
fs.mkdirSync(STAGING_DIR, { recursive: true });

// ── 3. Copy agent source to staging (filtering out desktop-only files) ──────
console.log('📂 Copying agent source to staging...');

function shouldExclude(name) {
  if (EXCLUDE_PATTERNS.includes(name)) return true;
  if (EXCLUDE_PREFIXES.some((prefix) => name.startsWith(prefix))) return true;
  if (name.endsWith('.pyc')) return true;
  if (name === '__pycache__') return true;
  return false;
}

function copyDirFiltered(src, dest, depth = 0) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });

  let entries;
  try {
    entries = fs.readdirSync(src, { withFileTypes: true });
  } catch (error) {
    if (isSkippableFsError(error)) {
      console.warn(`  ⚠️ Skipping unreadable directory: ${src}`);
      return;
    }
    throw error;
  }

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (shouldExclude(entry.name)) continue;

    // Exclude desktop-only tool modules (only from app/tools/)
    if (depth === 2 && entry.isFile() && DESKTOP_ONLY_MODULES.includes(entry.name)) {
      console.log(`  ⊘ Excluding desktop-only: app/tools/${entry.name}`);
      continue;
    }

    if (entry.isDirectory()) {
      copyDirFiltered(srcPath, destPath, depth + 1);
    } else if (entry.isSymbolicLink()) {
      console.log(`  ⊘ Skipping symlink: ${srcPath}`);
    } else {
      try {
        fs.copyFileSync(srcPath, destPath);
      } catch (error) {
        if (isSkippableFsError(error)) {
          console.warn(`  ⚠️ Skipping unreadable file: ${srcPath}`);
          continue;
        }
        throw error;
      }
    }
  }
}

copyDirFiltered(AGENT_DIR, path.join(STAGING_DIR, 'agent'), 0);

// ── 4. Verify vm_main.py was copied from source (websockets entrypoint that
//      uses dispatch_vm.py and avoids the desktop-only routes/dispatch chain). ─
const stagedVmMain = path.join(STAGING_DIR, 'agent', 'vm_main.py');
if (!fs.existsSync(stagedVmMain)) {
  console.error('❌ vm_main.py missing from staging — expected at apps/agent/vm_main.py');
  process.exit(1);
}
console.log('  ✓ Using source vm_main.py (websockets entrypoint)');

// Also copy requirements-vm.txt to the staging root
const reqVm = path.join(AGENT_DIR, 'requirements-vm.txt');
if (fs.existsSync(reqVm)) {
  fs.copyFileSync(reqVm, path.join(STAGING_DIR, 'agent', 'requirements-vm.txt'));
  console.log('  ✓ Included requirements-vm.txt');
}

// ── 5. Compile .py → .pyc (bytecode obfuscation) ───────────────────────────
if (!keepSource) {
  console.log('🔒 Compiling Python to bytecode...');
  try {
    // Compile all .py files to .pyc
    const stagingAgent = path.join(STAGING_DIR, 'agent');
    execSync(
      `python -m compileall -b -q "${stagingAgent}"`,
      { stdio: 'inherit' }
    );
    
    // Remove .py source files (keep .pyc), but keep vm_main.py and __init__.py
    function removePySources(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__pycache__') removePySources(fullPath);
        } else if (entry.name.endsWith('.py')) {
          const pycPath = fullPath.replace(/\.py$/, '.pyc');
          // Keep __init__.py (needed for package imports) and vm_main.py
          if (entry.name === '__init__.py' || entry.name === 'vm_main.py') continue;
          // Only remove if .pyc exists
          if (fs.existsSync(pycPath)) {
            fs.unlinkSync(fullPath);
          }
        }
      }
    }
    removePySources(stagingAgent);
    console.log('  ✓ Source stripped, bytecode compiled');
  } catch (e) {
    console.warn('⚠️ Bytecode compilation failed, keeping source:', e.message);
  }
} else {
  console.log('📝 Keeping .py source (--keep-source)');
}

// ── 6. Create tar.gz from staging ───────────────────────────────────────────
console.log('📦 Creating tar.gz...');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

try {
  const tarCmd = `tar -czf "${OUTPUT_FILE}" -C "${STAGING_DIR}" agent`;
  execSync(tarCmd, { stdio: 'inherit' });
  
  const stat = fs.statSync(OUTPUT_FILE);
  console.log(`✅ Bundle: ${OUTPUT_FILE} (${(stat.size / 1024).toFixed(1)} KB)`);
} catch (e) {
  console.error('❌ tar failed:', e.message);
  process.exit(1);
}

// ── 7. Cleanup staging ─────────────────────────────────────────────────────
try {
  fs.rmSync(STAGING_DIR, { recursive: true, force: true });
} catch {}

// ── 8. Upload to GCS ───────────────────────────────────────────────────────
if (doUpload) {
  console.log(`☁️ Uploading to ${GCS_PATH}...`);
  try {
    execSync(`gsutil cp "${OUTPUT_FILE}" "${GCS_PATH}"`, { stdio: 'inherit' });
    console.log(`✅ Uploaded to ${GCS_PATH}`);
  } catch (e) {
    console.error('❌ Upload failed:', e.message);
    process.exit(1);
  }
} else {
  console.log('ℹ️ Skipping upload. Use --upload to upload to GCS.');
}

console.log('🎉 Done!');
