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

function main() {
  let cmd, args, cwd;

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
