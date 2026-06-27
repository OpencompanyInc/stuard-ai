#!/usr/bin/env node
/**
 * Cross-platform agent startup script
 * Detects OS and runs the appropriate script (PowerShell on Windows, Bash on Unix)
 */
const { spawn, execSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const isWindows = os.platform() === 'win32';
const repoRoot = path.resolve(__dirname, '..');
const scriptsDir = path.join(repoRoot, 'scripts');
const rustIndexerManifest = path.join(repoRoot, 'apps', 'agent', 'native', 'file-indexer', 'Cargo.toml');
const rustIndexerExe = path.join(
  repoRoot,
  'apps',
  'agent',
  'native',
  'file-indexer',
  'target',
  'release',
  isWindows ? 'stuard-file-indexer.exe' : 'stuard-file-indexer'
);

function newestMtimeMs(dir) {
  let newest = 0;
  if (!fs.existsSync(dir)) return newest;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestMtimeMs(full));
    } else {
      try {
        newest = Math.max(newest, fs.statSync(full).mtimeMs);
      } catch {
        // Ignore unreadable files.
      }
    }
  }
  return newest;
}

function ensureRustIndexer() {
  if (!fs.existsSync(rustIndexerManifest)) {
    console.warn(`[run-agent] Rust file indexer manifest not found: ${rustIndexerManifest}`);
    return '';
  }

  const srcDir = path.join(path.dirname(rustIndexerManifest), 'src');
  const sourceMtime = Math.max(newestMtimeMs(srcDir), fs.statSync(rustIndexerManifest).mtimeMs);
  const binaryMtime = fs.existsSync(rustIndexerExe) ? fs.statSync(rustIndexerExe).mtimeMs : 0;

  if (binaryMtime >= sourceMtime) {
    console.log(`[run-agent] Rust file indexer ready: ${rustIndexerExe}`);
    return rustIndexerExe;
  }

  console.log('[run-agent] Building Rust file indexer...');
  try {
    execSync(`cargo build --release --manifest-path "${rustIndexerManifest}"`, {
      cwd: repoRoot,
      stdio: 'inherit',
    });
  } catch (err) {
    console.warn(
      '[run-agent] Rust file indexer build failed — continuing without it.',
      'File indexing in the desktop app will be disabled until you fix the build.',
      'On macOS: install Rust (https://rustup.rs) and Xcode CLI tools (xcode-select --install),',
      'then run: cargo build --release --manifest-path apps/agent/native/file-indexer/Cargo.toml',
    );
    if (err && err.message) console.warn(`[run-agent] Build error: ${err.message}`);
    return '';
  }

  if (!fs.existsSync(rustIndexerExe)) {
    console.warn(`[run-agent] Build succeeded but binary missing at ${rustIndexerExe}`);
    return '';
  }

  console.log(`[run-agent] Rust file indexer built: ${rustIndexerExe}`);
  return rustIndexerExe;
}

function main() {
  let cmd, args, cwd;
  const rustIndexerPath = ensureRustIndexer();

  if (isWindows) {
    // Use PowerShell on Windows
    const psScript = path.join(scriptsDir, 'run-agent.ps1');
    cmd = 'powershell.exe';
    args = [
      '-NoLogo',
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', psScript
    ];
    cwd = repoRoot;
  } else {
    // Use bash on macOS/Linux
    const shScript = path.join(scriptsDir, 'run-agent.sh');
    
    // Make sure the script is executable
    try {
      fs.chmodSync(shScript, 0o755);
    } catch (e) {
      // Ignore chmod errors
    }
    
    cmd = '/bin/bash';
    args = [shScript];
    cwd = repoRoot;
  }

  console.log(`[run-agent] Starting agent on ${os.platform()}...`);
  console.log(`[run-agent] Command: ${cmd} ${args.join(' ')}`);

  const proc = spawn(cmd, args, {
    cwd,
    stdio: 'inherit',
    env: {
      ...process.env,
      ...(rustIndexerPath ? { STUARD_FILE_INDEXER: rustIndexerPath } : {}),
      CLOUD_AI_WS: process.env.CLOUD_AI_WS || 'ws://127.0.0.1:8082/ws'
    }
  });

  proc.on('error', (err) => {
    console.error('[run-agent] Failed to start:', err.message);
    process.exit(1);
  });

  proc.on('close', (code) => {
    process.exit(code || 0);
  });

  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
    proc.kill('SIGINT');
  });

  process.on('SIGTERM', () => {
    proc.kill('SIGTERM');
  });
}

main();
