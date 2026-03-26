/**
 * MediaPipe Service Manager
 *
 * Spawns and manages the standalone mediapipe HTTP service process.
 * Prefers the packaged binary (stuard-mediapipe.exe), falls back to
 * Python script (mediapipe_service.py).
 *
 * Port: auto-allocated, or STUARD_MEDIAPIPE_PORT env var
 * Auth: shared token via STUARD_MEDIAPIPE_AUTH_TOKEN header
 */

import { app } from 'electron';
import { ChildProcess, spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import net from 'net';
import { randomBytes } from 'crypto';
import logger from '../utils/logger';
import { isDev } from '../env';

const MEDIAPIPE_AUTH_HEADER = 'x-stuard-mediapipe-token';
const MEDIAPIPE_AUTH_TOKEN = randomBytes(24).toString('hex');

let mediapipeProcess: ChildProcess | null = null;
let mediapipePort: number | null = null;
let mediapipeReady = false;

function getPythonCmd(): string {
  return process.platform === 'win32' ? 'python' : 'python3';
}

function shouldPreferPackagedServices(): boolean {
  const forced = String(process.env.STUARD_USE_PACKAGED_SERVICES || '').trim().toLowerCase();
  return !isDev || forced === '1' || forced === 'true' || forced === 'yes';
}

async function allocatePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 18083;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

/**
 * Resolve the mediapipe service executable or script.
 */
function getExecutable(): { binary: string; args: string[]; isPacked: boolean } | null {
  const binaryName = process.platform === 'win32' ? 'stuard-mediapipe.exe' : 'stuard-mediapipe';
  const preferPackaged = shouldPreferPackagedServices();

  const resourceBin = path.join(process.resourcesPath, 'agent', binaryName);
  const distBin = path.join(app.getAppPath(), '..', '..', 'dist', binaryName);
  const devScript = path.join(app.getAppPath(), '..', 'agent', 'mediapipe_service.py');
  const resourceScript = path.join(process.resourcesPath, 'agent', 'mediapipe_service.py');
  const scriptCandidates = [devScript, resourceScript];
  const binaryCandidates = preferPackaged ? [resourceBin, distBin] : [];

  for (const candidate of binaryCandidates) {
    if (fs.existsSync(candidate)) return { binary: candidate, args: [], isPacked: true };
  }

  for (const candidate of scriptCandidates) {
    if (fs.existsSync(candidate)) return { binary: getPythonCmd(), args: [candidate], isPacked: false };
  }

  return null;
}

/**
 * Start the MediaPipe service if not already running.
 */
export async function startMediaPipeService(): Promise<{ ok: boolean; port?: number; error?: string }> {
  if (mediapipeProcess && !mediapipeProcess.killed && mediapipeReady) {
    return { ok: true, port: mediapipePort! };
  }

  // Clean up dead process
  if (mediapipeProcess) {
    try { mediapipeProcess.kill(); } catch {}
    mediapipeProcess = null;
    mediapipeReady = false;
  }

  const exe = getExecutable();
  if (!exe) {
    return { ok: false, error: 'MediaPipe service not available. Install it from the Integrations panel.' };
  }

  const port = await allocatePort();
  mediapipePort = port;

  logger.info(`[mediapipe-service] Starting on port ${port} (packed: ${exe.isPacked})`);

  mediapipeProcess = spawn(exe.binary, exe.args, {
    env: {
      ...process.env,
      STUARD_MEDIAPIPE_PORT: String(port),
      STUARD_MEDIAPIPE_HOST: '127.0.0.1',
      STUARD_MEDIAPIPE_AUTH_TOKEN: MEDIAPIPE_AUTH_TOKEN,
    },
    cwd: path.dirname(exe.binary),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  mediapipeProcess.on('exit', (code) => {
    logger.warn(`[mediapipe-service] exited with code ${code}`);
    mediapipeProcess = null;
    mediapipeReady = false;
  });

  mediapipeProcess.stdout?.on('data', (data: Buffer) => {
    const msg = data.toString().trim();
    logger.info(`[mediapipe-service] ${msg}`);
    if (msg.includes('Starting on') || msg.includes('Running on')) {
      mediapipeReady = true;
    }
  });

  mediapipeProcess.stderr?.on('data', (data: Buffer) => {
    logger.warn(`[mediapipe-service] ${data.toString().trim()}`);
  });

  // Wait for ready
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (!mediapipeProcess || mediapipeProcess.exitCode !== null) {
      return { ok: false, error: 'MediaPipe service crashed on startup' };
    }
    if (mediapipeReady) {
      return { ok: true, port };
    }
    // Try health check
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/status`, {
        headers: { [MEDIAPIPE_AUTH_HEADER]: MEDIAPIPE_AUTH_TOKEN },
        signal: AbortSignal.timeout(2000),
      });
      if (resp.ok) {
        mediapipeReady = true;
        return { ok: true, port };
      }
    } catch {}
  }

  return { ok: false, error: 'MediaPipe service did not start within 10 seconds' };
}

/**
 * Stop the MediaPipe service.
 */
export async function stopMediaPipeService(): Promise<void> {
  if (mediapipeProcess) {
    try { mediapipeProcess.kill(); } catch {}
    mediapipeProcess = null;
  }
  mediapipeReady = false;
  mediapipePort = null;
}

/**
 * Get the current status of the MediaPipe service.
 */
export function getMediaPipeStatus(): { running: boolean; port: number | null; ready: boolean } {
  return {
    running: mediapipeProcess !== null && !mediapipeProcess.killed,
    port: mediapipePort,
    ready: mediapipeReady,
  };
}

/**
 * Forward a request to the MediaPipe service.
 */
export async function mediapipeFetch(
  endpoint: string,
  body?: any,
  timeoutMs = 30000,
): Promise<any> {
  if (!mediapipeReady || !mediapipePort) {
    const start = await startMediaPipeService();
    if (!start.ok) throw new Error(start.error || 'MediaPipe not available');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(`http://127.0.0.1:${mediapipePort}${endpoint}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        [MEDIAPIPE_AUTH_HEADER]: MEDIAPIPE_AUTH_TOKEN,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`MediaPipe ${endpoint} failed: ${resp.status} ${text}`);
    }

    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Check if the MediaPipe service binary/script is available on this system.
 */
export function isMediaPipeAvailable(): boolean {
  return getExecutable() !== null;
}
