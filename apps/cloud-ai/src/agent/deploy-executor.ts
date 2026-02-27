/**
 * VM Agent — Deploy Executor
 *
 * Manages deployed workflows, scripts, and projects on the VM.
 * Each deployment gets its own directory under /home/stuard/deploys/<id>/
 * and runs as a supervised child process.
 */

import { execFileSync, spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface DeployConfig {
  deployId: string;
  downloadUrl: string;
  kind: 'workflow' | 'script' | 'project';
  name: string;
  envVars: Record<string, string>;
  autoRestart: boolean;
  schedule: string | null;
}

interface RunningDeploy {
  id: string;
  kind: string;
  name: string;
  process: ChildProcess | null;
  pid: number | null;
  autoRestart: boolean;
  restartCount: number;
  maxRestarts: number;
  logFile: string;
  dir: string;
  status: 'starting' | 'running' | 'stopped' | 'failed';
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DEPLOY_ROOT = process.env.STUARD_DEPLOY_ROOT || '/home/stuard/deploys';
const MAX_RESTARTS = 5;
const RESTART_DELAY_MS = 3_000;
const MAX_LOG_SIZE = 2 * 1024 * 1024; // 2 MB tail limit
const DOWNLOAD_TIMEOUT_MS = 60_000;

// ─────────────────────────────────────────────────────────────────────────────
// Deploy Executor
// ─────────────────────────────────────────────────────────────────────────────

export class DeployExecutor extends EventEmitter {
  private running = new Map<string, RunningDeploy>();

  constructor() {
    super();
    fs.mkdirSync(DEPLOY_ROOT, { recursive: true });
  }

  /**
   * Download bundle, install deps, and start the deployment.
   */
  async start(config: DeployConfig): Promise<{ pid: number | null; dir: string }> {
    const deployDir = path.join(DEPLOY_ROOT, config.deployId);
    const bundlePath = path.join(deployDir, 'bundle.json');
    const logFile = path.join(deployDir, 'deploy.log');

    // Create deploy directory
    fs.mkdirSync(deployDir, { recursive: true });

    // Download bundle
    await this.downloadFile(config.downloadUrl, bundlePath);

    // Parse bundle
    const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf-8'));
    const payload = bundle.payload;

    // Write the deployable content based on kind
    let entrypoint: string;
    switch (config.kind) {
      case 'workflow':
        entrypoint = await this.prepareWorkflow(deployDir, payload, config.envVars);
        break;
      case 'script':
        entrypoint = await this.prepareScript(deployDir, payload, config.envVars);
        break;
      case 'project':
        entrypoint = await this.prepareProject(deployDir, payload, config.envVars);
        break;
      default:
        throw new Error(`Unknown deploy kind: ${config.kind}`);
    }

    // Start the process
    const pid = this.spawnProcess(config.deployId, config.kind, config.name, deployDir, entrypoint, config.envVars, config.autoRestart, logFile);

    return { pid, dir: deployDir };
  }

  /**
   * Stop a running deployment.
   */
  stop(deployId: string): boolean {
    const deploy = this.running.get(deployId);
    if (!deploy) return false;

    deploy.autoRestart = false; // prevent restart
    deploy.status = 'stopped';

    if (deploy.process && !deploy.process.killed) {
      deploy.process.kill('SIGTERM');
      // Give it 5s before SIGKILL
      setTimeout(() => {
        if (deploy.process && !deploy.process.killed) {
          deploy.process.kill('SIGKILL');
        }
      }, 5_000);
    }

    this.running.delete(deployId);
    return true;
  }

  /**
   * Cleanup deploy directory.
   */
  cleanup(deployId: string): boolean {
    this.stop(deployId);
    const deployDir = path.join(DEPLOY_ROOT, deployId);
    try {
      fs.rmSync(deployDir, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Read deployment logs.
   */
  getLogs(deployId: string, lines = 200): string {
    const logFile = path.join(DEPLOY_ROOT, deployId, 'deploy.log');
    if (!fs.existsSync(logFile)) return '';

    try {
      const content = fs.readFileSync(logFile, 'utf-8');
      const allLines = content.split('\n');
      return allLines.slice(-lines).join('\n');
    } catch {
      return '';
    }
  }

  /**
   * List all managed deployments on this VM.
   */
  list(): Array<{ id: string; kind: string; name: string; pid: number | null; status: string }> {
    const result: Array<{ id: string; kind: string; name: string; pid: number | null; status: string }> = [];

    // From running map
    for (const [id, deploy] of this.running) {
      result.push({ id, kind: deploy.kind, name: deploy.name, pid: deploy.pid, status: deploy.status });
    }

    // Also scan directory for stopped deploys not in running map
    try {
      const dirs = fs.readdirSync(DEPLOY_ROOT, { withFileTypes: true });
      for (const d of dirs) {
        if (d.isDirectory() && !this.running.has(d.name)) {
          const bundlePath = path.join(DEPLOY_ROOT, d.name, 'bundle.json');
          if (fs.existsSync(bundlePath)) {
            try {
              const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf-8'));
              result.push({ id: d.name, kind: bundle.kind || 'unknown', name: bundle.name || d.name, pid: null, status: 'stopped' });
            } catch {
              result.push({ id: d.name, kind: 'unknown', name: d.name, pid: null, status: 'stopped' });
            }
          }
        }
      }
    } catch { /* ignore */ }

    return result;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Preparation — write files + install deps per deploy kind
  // ─────────────────────────────────────────────────────────────────────────

  private async prepareWorkflow(dir: string, payload: any, envVars: Record<string, string>): Promise<string> {
    // Write workflow JSON
    fs.writeFileSync(path.join(dir, 'workflow.json'), JSON.stringify(payload, null, 2));

    // If workflow has requirements (Python deps), install them
    if (payload.requirements) {
      const reqPath = path.join(dir, 'requirements.txt');
      fs.writeFileSync(reqPath, payload.requirements);
      try {
        execFileSync('pip3', ['install', '-r', reqPath, '--quiet'], { cwd: dir, timeout: 120_000, stdio: 'pipe' });
      } catch (e: any) {
        this.appendLog(dir, `[deploy] Warning: pip install failed: ${e.message}`);
      }
    }

    // If workflow has embedded scripts, write them
    if (payload.scripts && typeof payload.scripts === 'object') {
      for (const [filename, content] of Object.entries(payload.scripts)) {
        const scriptPath = path.join(dir, filename);
        fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
        fs.writeFileSync(scriptPath, String(content));
        // Make executable if .sh or .py
        if (filename.endsWith('.sh') || filename.endsWith('.py')) {
          fs.chmodSync(scriptPath, 0o755);
        }
      }
    }

    // Write env file
    this.writeEnvFile(dir, envVars);

    // Create runner script that the workflow engine will execute
    const runnerPath = path.join(dir, '_runner.sh');
    fs.writeFileSync(runnerPath, `#!/bin/bash
set -e
cd "${dir}"
export $(cat .env 2>/dev/null | xargs)

# If there's a node-based workflow runner, use it; otherwise just cat the workflow
if command -v stuard-workflow-runner &>/dev/null; then
  stuard-workflow-runner workflow.json
elif [ -f package.json ]; then
  npm start
else
  echo "[workflow] Running workflow steps..."
  node -e "
    const wf = require('./workflow.json');
    console.log('[workflow] Name:', wf.name);
    console.log('[workflow] Steps:', wf.steps?.length || 0);
    console.log('[workflow] Mode:', wf.mode || 'auto');
    wf.steps?.forEach((s, i) => {
      console.log('[workflow] Step ' + (i+1) + ':', s.id, '→', s.uses);
    });
    console.log('[workflow] Workflow loaded successfully. Waiting for triggers...');
    // Keep alive for scheduled/manual workflows
    setInterval(() => {}, 60000);
  "
fi
`, { mode: 0o755 });

    return runnerPath;
  }

  private async prepareScript(dir: string, payload: any, envVars: Record<string, string>): Promise<string> {
    const content = typeof payload === 'string' ? payload : (payload.content || payload.code || JSON.stringify(payload));
    const lang = payload.language || this.detectLanguage(content);
    const ext = lang === 'python' ? '.py' : lang === 'bash' || lang === 'shell' ? '.sh' : '.js';
    const scriptFile = path.join(dir, `script${ext}`);

    fs.writeFileSync(scriptFile, content);
    fs.chmodSync(scriptFile, 0o755);
    this.writeEnvFile(dir, envVars);

    // Install requirements if present
    if (payload.requirements) {
      const reqPath = path.join(dir, 'requirements.txt');
      fs.writeFileSync(reqPath, payload.requirements);
      try {
        execFileSync('pip3', ['install', '-r', reqPath, '--quiet'], { cwd: dir, timeout: 120_000, stdio: 'pipe' });
      } catch (e: any) {
        this.appendLog(dir, `[deploy] Warning: pip install failed: ${e.message}`);
      }
    }

    // Create runner
    const runnerPath = path.join(dir, '_runner.sh');
    let cmd: string;
    switch (lang) {
      case 'python':
        cmd = `python3 "${scriptFile}"`;
        break;
      case 'bash':
      case 'shell':
        cmd = `bash "${scriptFile}"`;
        break;
      default:
        cmd = `node "${scriptFile}"`;
    }

    fs.writeFileSync(runnerPath, `#!/bin/bash
set -e
cd "${dir}"
export $(cat .env 2>/dev/null | xargs)
${cmd}
`, { mode: 0o755 });

    return runnerPath;
  }

  private async prepareProject(dir: string, payload: any, envVars: Record<string, string>): Promise<string> {
    // Projects can include files map and a start command
    if (payload.files && typeof payload.files === 'object') {
      for (const [filePath, content] of Object.entries(payload.files)) {
        const fullPath = path.join(dir, filePath);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, String(content));
      }
    }

    // Package.json–based project
    if (payload.packageJson) {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(payload.packageJson, null, 2));
    }

    this.writeEnvFile(dir, envVars);

    // Install dependencies
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      try {
        execFileSync('npm', ['install', '--production', '--no-audit'], { cwd: dir, timeout: 180_000, stdio: 'pipe' });
        this.appendLog(dir, '[deploy] npm install completed');
      } catch (e: any) {
        this.appendLog(dir, `[deploy] Warning: npm install failed: ${e.message}`);
      }
    }
    if (fs.existsSync(path.join(dir, 'requirements.txt'))) {
      try {
        execFileSync('pip3', ['install', '-r', 'requirements.txt', '--quiet'], { cwd: dir, timeout: 120_000, stdio: 'pipe' });
      } catch (e: any) {
        this.appendLog(dir, `[deploy] Warning: pip install failed: ${e.message}`);
      }
    }

    const startCmd = payload.startCommand || payload.start || 'npm start';
    const runnerPath = path.join(dir, '_runner.sh');
    fs.writeFileSync(runnerPath, `#!/bin/bash
set -e
cd "${dir}"
export $(cat .env 2>/dev/null | xargs)
${startCmd}
`, { mode: 0o755 });

    return runnerPath;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Process Management
  // ─────────────────────────────────────────────────────────────────────────

  private spawnProcess(
    deployId: string,
    kind: string,
    name: string,
    dir: string,
    entrypoint: string,
    envVars: Record<string, string>,
    autoRestart: boolean,
    logFile: string,
  ): number | null {
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });
    const timestamp = new Date().toISOString();
    logStream.write(`\n[${timestamp}] Starting deployment: ${name} (${kind})\n`);

    const env = {
      ...process.env,
      ...envVars,
      STUARD_DEPLOY_ID: deployId,
      STUARD_DEPLOY_KIND: kind,
      HOME: process.env.HOME || '/home/stuard',
      PATH: `/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}`,
    };

    const child = spawn('bash', [entrypoint], {
      cwd: dir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    const deploy: RunningDeploy = {
      id: deployId,
      kind,
      name,
      process: child,
      pid: child.pid || null,
      autoRestart,
      restartCount: 0,
      maxRestarts: MAX_RESTARTS,
      logFile,
      dir,
      status: 'running',
    };

    this.running.set(deployId, deploy);

    // Pipe stdout/stderr to log
    child.stdout?.on('data', (data: Buffer) => {
      const line = data.toString();
      logStream.write(line);
      this.emit('log', deployId, line);
      // Truncate log if too large
      this.truncateLogIfNeeded(logFile);
    });

    child.stderr?.on('data', (data: Buffer) => {
      const line = `[stderr] ${data.toString()}`;
      logStream.write(line);
      this.emit('log', deployId, line);
    });

    child.on('exit', (code, signal) => {
      const msg = `[${new Date().toISOString()}] Process exited: code=${code} signal=${signal}\n`;
      logStream.write(msg);
      this.emit('exit', deployId, code, signal);

      if (deploy.autoRestart && deploy.status === 'running' && deploy.restartCount < deploy.maxRestarts) {
        deploy.restartCount++;
        const restartMsg = `[${new Date().toISOString()}] Auto-restarting (attempt ${deploy.restartCount}/${deploy.maxRestarts})...\n`;
        logStream.write(restartMsg);

        setTimeout(() => {
          if (this.running.has(deployId) && deploy.status === 'running') {
            this.spawnProcess(deployId, kind, name, dir, entrypoint, envVars, autoRestart, logFile);
          }
        }, RESTART_DELAY_MS);
      } else if (deploy.status === 'running') {
        deploy.status = code === 0 ? 'stopped' : 'failed';
        this.emit('status', deployId, deploy.status);
      }
    });

    child.on('error', (err) => {
      logStream.write(`[error] ${err.message}\n`);
      deploy.status = 'failed';
      this.emit('status', deployId, 'failed');
    });

    return child.pid || null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Utilities
  // ─────────────────────────────────────────────────────────────────────────

  private writeEnvFile(dir: string, envVars: Record<string, string>): void {
    const lines = Object.entries(envVars).map(([k, v]) => `${k}=${v}`);
    fs.writeFileSync(path.join(dir, '.env'), lines.join('\n') + '\n');
  }

  private appendLog(dir: string, message: string): void {
    const logFile = path.join(dir, 'deploy.log');
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${message}\n`);
  }

  private detectLanguage(content: string): string {
    if (content.trimStart().startsWith('#!/usr/bin/env python') || content.trimStart().startsWith('#!/usr/bin/python') || content.includes('import ') && content.includes('def ')) return 'python';
    if (content.trimStart().startsWith('#!/bin/bash') || content.trimStart().startsWith('#!/bin/sh')) return 'bash';
    return 'javascript';
  }

  private truncateLogIfNeeded(logFile: string): void {
    try {
      const stats = fs.statSync(logFile);
      if (stats.size > MAX_LOG_SIZE) {
        const content = fs.readFileSync(logFile, 'utf-8');
        const lines = content.split('\n');
        const truncated = lines.slice(-500).join('\n');
        fs.writeFileSync(logFile, `[log truncated]\n${truncated}`);
      }
    } catch { /* ignore */ }
  }

  private downloadFile(url: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const mod = url.startsWith('https') ? https : http;
      const file = fs.createWriteStream(destPath);
      const req = mod.get(url, (res) => {
        if (res.statusCode !== 200) {
          try { fs.unlinkSync(destPath); } catch {}
          return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        }
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
      });
      req.on('error', (e) => {
        try { fs.unlinkSync(destPath); } catch {}
        reject(e);
      });
      req.setTimeout(DOWNLOAD_TIMEOUT_MS, () => { req.destroy(); reject(new Error('Download timeout')); });
    });
  }

  /**
   * Gracefully stop all running deployments.
   */
  stopAll(): void {
    for (const [id] of this.running) {
      this.stop(id);
    }
  }
}
