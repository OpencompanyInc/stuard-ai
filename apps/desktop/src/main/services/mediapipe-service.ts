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
import { pipeline } from 'stream/promises';
import logger from '../utils/logger';
import { isDev } from '../env';

const MEDIAPIPE_AUTH_HEADER = 'x-stuard-mediapipe-token';
const MEDIAPIPE_AUTH_TOKEN = randomBytes(24).toString('hex');
const DEFAULT_SERVICES_BASE_URL = 'https://updates.stuard.ai/services';

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

// ── R2 download flow (mirrors browser-use) ──
// Mediapipe is no longer bundled in the desktop release. The native binary
// is downloaded on demand from updates.stuard.ai/services/<channel>/<plat>
// into userData/integrations/mediapipe/ — same pattern as stuard-browser.

function getIntegrationsDir(): string {
  return path.join(app.getPath('userData'), 'integrations', 'mediapipe');
}

function getIntegrationsBinaryPath(): string {
  const binaryName = process.platform === 'win32' ? 'stuard-mediapipe.exe' : 'stuard-mediapipe';
  return path.join(getIntegrationsDir(), binaryName);
}

function getUpdateChannel(): string {
  const ch = (process.env.UPDATE_CHANNEL || '').toLowerCase();
  if (ch === 'beta' || ch === 'staging' || ch === 'stable') return ch;
  return 'beta';
}

function getServicePlatform(): string {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') {
    return process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
  }
  return 'linux';
}

function getServiceBinaryName(): string {
  if (process.platform === 'win32') return 'stuard-mediapipe.exe';
  if (process.platform === 'darwin') return 'stuard-mediapipe-macos';
  return 'stuard-mediapipe-linux';
}

function getServiceDownloadUrl(): string {
  const base = process.env.STUARD_SERVICES_URL || DEFAULT_SERVICES_BASE_URL;
  const channel = getUpdateChannel();
  const platform = getServicePlatform();
  const binaryName = getServiceBinaryName();
  return `${base}/${channel}/${platform}/latest/${binaryName}`;
}

// ── Install metadata (etag/last-modified) so we can detect remote updates ──

interface InstallMeta {
  url: string;
  etag: string | null;
  lastModified: string | null;
  downloadedAt: string; // ISO 8601
  size: number | null;
}

function getInstallMetaPath(): string {
  return path.join(getIntegrationsDir(), 'install-meta.json');
}

function readInstallMeta(): InstallMeta | null {
  try {
    const raw = fs.readFileSync(getInstallMetaPath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as InstallMeta;
  } catch {}
  return null;
}

function writeInstallMeta(meta: InstallMeta): void {
  try {
    fs.mkdirSync(getIntegrationsDir(), { recursive: true });
    fs.writeFileSync(getInstallMetaPath(), JSON.stringify(meta, null, 2), 'utf8');
  } catch (e) {
    logger.warn('[mediapipe-service] Failed to write install-meta.json:', e);
  }
}

async function downloadMediapipeBinary(): Promise<{ ok: boolean; error?: string }> {
  const destPath = getIntegrationsBinaryPath();
  const destDir = path.dirname(destPath);
  try { fs.mkdirSync(destDir, { recursive: true }); } catch {}

  const tmpPath = destPath + '.download';
  const url = getServiceDownloadUrl();
  logger.info(`[mediapipe-service] Downloading from ${url}...`);

  try {
    const resp = await fetch(url);
    if (!resp.ok) return { ok: false, error: `Download failed: HTTP ${resp.status} from ${url}` };
    if (!resp.body) return { ok: false, error: 'Download failed: empty response body' };

    const fileStream = fs.createWriteStream(tmpPath);
    const { Readable } = require('stream');
    const readable = Readable.fromWeb(resp.body);
    await pipeline(readable, fileStream);

    if (process.platform !== 'win32') {
      try { fs.chmodSync(tmpPath, 0o755); } catch {}
    }
    fs.renameSync(tmpPath, destPath);
    logger.info(`[mediapipe-service] Downloaded to ${destPath}`);

    // Persist identifiers so checkForUpdate can compare against the live HEAD.
    let size: number | null = null;
    try { size = fs.statSync(destPath).size; } catch {}
    writeInstallMeta({
      url,
      etag: resp.headers.get('etag'),
      lastModified: resp.headers.get('last-modified'),
      downloadedAt: new Date().toISOString(),
      size,
    });
    return { ok: true };
  } catch (err: any) {
    try { fs.unlinkSync(tmpPath); } catch {}
    return { ok: false, error: `Download failed: ${err?.message || err}` };
  }
}

// ── Public service-management API ──

export interface MediapipeLocalStatus {
  installed: boolean;
  running: boolean;
  ready: boolean;
  port: number | null;
  integrationsDir: string;
  binaryPath: string | null; // path to the binary on disk (integrations or legacy resource)
  installSource: 'integrations' | 'bundled' | 'dev-script' | null;
  meta: InstallMeta | null;
  downloadUrl: string;
}

export function getMediapipeLocalStatus(): MediapipeLocalStatus {
  const integrationsBin = getIntegrationsBinaryPath();
  const integrationsExists = fs.existsSync(integrationsBin);

  const binaryName = process.platform === 'win32' ? 'stuard-mediapipe.exe' : 'stuard-mediapipe';
  const resourceBin = path.join(process.resourcesPath, 'agent', binaryName);
  const resourceExists = fs.existsSync(resourceBin);

  const devScript = path.join(app.getAppPath(), '..', 'agent', 'mediapipe_service.py');
  const devScriptExists = fs.existsSync(devScript);

  let installSource: MediapipeLocalStatus['installSource'] = null;
  let binaryPath: string | null = null;
  if (integrationsExists) { installSource = 'integrations'; binaryPath = integrationsBin; }
  else if (resourceExists) { installSource = 'bundled'; binaryPath = resourceBin; }
  else if (devScriptExists) { installSource = 'dev-script'; binaryPath = devScript; }

  return {
    installed: integrationsExists || resourceExists || devScriptExists,
    running: !!mediapipeProcess && !mediapipeProcess.killed,
    ready: mediapipeReady,
    port: mediapipePort,
    integrationsDir: getIntegrationsDir(),
    binaryPath,
    installSource,
    meta: readInstallMeta(),
  downloadUrl: getServiceDownloadUrl(),
  };
}

export interface MediapipeUpdateInfo {
  ok: boolean;
  error?: string;
  updateAvailable: boolean;
  reason?: 'no-local-meta' | 'etag-mismatch' | 'last-modified-newer' | 'size-mismatch' | 'up-to-date' | 'head-failed';
  remoteEtag?: string | null;
  remoteLastModified?: string | null;
  remoteSize?: number | null;
  url: string;
}

export async function checkMediapipeForUpdate(): Promise<MediapipeUpdateInfo> {
  const url = getServiceDownloadUrl();
  const meta = readInstallMeta();

  // If we have a local binary but no meta (e.g. resources/agent bundled build,
  // or pre-meta install), treat as "unknown" → update available so the user
  // can resync to the canonical R2 artifact.
  if (!meta && !isMediapipeInstalled()) {
    return { ok: true, updateAvailable: false, reason: 'no-local-meta', url };
  }

  let resp: Response;
  try {
    resp = await fetch(url, { method: 'HEAD' });
  } catch (err: any) {
    return { ok: false, error: `HEAD failed: ${err?.message || err}`, updateAvailable: false, reason: 'head-failed', url };
  }
  if (!resp.ok) {
    return { ok: false, error: `HEAD failed: HTTP ${resp.status}`, updateAvailable: false, reason: 'head-failed', url };
  }

  const remoteEtag = resp.headers.get('etag');
  const remoteLastModified = resp.headers.get('last-modified');
  const remoteSizeRaw = resp.headers.get('content-length');
  const remoteSize = remoteSizeRaw ? Number(remoteSizeRaw) : null;

  if (!meta) {
    // No install metadata — e.g. a bundled binary (copied by the installer, never
    // downloaded, so no install-meta.json). Don't blindly recommend an update (it
    // nagged users on the latest version forever). Compare the local file's actual
    // size to the remote artifact; only flag an update when sizes genuinely differ.
    let localSize: number | null = null;
    try {
      const candidates = [
        getIntegrationsBinaryPath(),
        path.join(process.resourcesPath, 'agent', process.platform === 'win32' ? 'stuard-mediapipe.exe' : 'stuard-mediapipe'),
      ];
      for (const c of candidates) {
        if (c && fs.existsSync(c)) { localSize = fs.statSync(c).size; break; }
      }
    } catch {}
    const canCompare = remoteSize != null && localSize != null;
    const updateAvailable = canCompare ? remoteSize !== localSize : false;
    return {
      ok: true,
      updateAvailable,
      reason: updateAvailable ? 'size-mismatch' : 'up-to-date',
      remoteEtag, remoteLastModified, remoteSize, url,
    };
  }

  if (remoteEtag && meta.etag && remoteEtag !== meta.etag) {
    return { ok: true, updateAvailable: true, reason: 'etag-mismatch', remoteEtag, remoteLastModified, remoteSize, url };
  }
  if (remoteLastModified && meta.lastModified) {
    const remoteMs = Date.parse(remoteLastModified);
    const localMs = Date.parse(meta.lastModified);
    if (Number.isFinite(remoteMs) && Number.isFinite(localMs) && remoteMs > localMs) {
      return { ok: true, updateAvailable: true, reason: 'last-modified-newer', remoteEtag, remoteLastModified, remoteSize, url };
    }
  }
  if (remoteSize != null && meta.size != null && remoteSize !== meta.size) {
    return { ok: true, updateAvailable: true, reason: 'size-mismatch', remoteEtag, remoteLastModified, remoteSize, url };
  }
  return { ok: true, updateAvailable: false, reason: 'up-to-date', remoteEtag, remoteLastModified, remoteSize, url };
}

/**
 * Re-download the mediapipe binary, stopping the running service first.
 * Used by the Connected Apps "Update" button.
 */
export async function updateMediapipe(): Promise<{ ok: boolean; error?: string }> {
  await stopMediaPipeService();
  _installCheckResult = null;
  const dl = await downloadMediapipeBinary();
  if (!dl.ok) return dl;
  return { ok: true };
}

export function isMediapipeInstalled(): boolean {
  if (fs.existsSync(getIntegrationsBinaryPath())) return true;
  const binaryName = process.platform === 'win32' ? 'stuard-mediapipe.exe' : 'stuard-mediapipe';
  // Legacy fallback: older bundled builds left the binary in resources/agent/
  if (fs.existsSync(path.join(process.resourcesPath, 'agent', binaryName))) return true;
  return false;
}

let _installCheckResult: { ok: boolean; error?: string } | null = null;

export async function installMediapipe(): Promise<{ ok: boolean; error?: string }> {
  if (_installCheckResult?.ok) return { ok: true };

  // Already on disk?
  if (isMediapipeInstalled()) {
    _installCheckResult = { ok: true };
    return { ok: true };
  }

  // Release: download from R2 into integrations dir.
  if (shouldPreferPackagedServices()) {
    const dl = await downloadMediapipeBinary();
    if (!dl.ok) return { ok: false, error: dl.error || 'Failed to download mediapipe service' };
    _installCheckResult = { ok: true };
    return { ok: true };
  }

  // Dev mode: rely on the python script at apps/agent/mediapipe_service.py
  // (resolver below will pick it up).
  _installCheckResult = { ok: true };
  return { ok: true };
}

export async function uninstallMediapipe(): Promise<{ ok: boolean; error?: string }> {
  _installCheckResult = null;
  await stopMediaPipeService();
  const dir = getIntegrationsDir();
  try {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
  return { ok: true };
}

/**
 * Resolve the mediapipe service executable or script.
 *
 * Order in packaged builds:
 *   1. userData/integrations/mediapipe/ (downloaded from R2 on demand)
 *   2. resources/agent/ (legacy fallback for old bundled builds)
 *   3. monorepo dist/ (CI-built artefacts)
 *
 * In dev mode, prefer the python script unless STUARD_USE_PACKAGED_SERVICES=1.
 */
function getExecutable(): { binary: string; args: string[]; isPacked: boolean } | null {
  const binaryName = process.platform === 'win32' ? 'stuard-mediapipe.exe' : 'stuard-mediapipe';
  const preferPackaged = shouldPreferPackagedServices();

  const integrationsBin = getIntegrationsBinaryPath();
  const resourceBin = path.join(process.resourcesPath, 'agent', binaryName);
  const distBin = path.join(app.getAppPath(), '..', '..', 'dist', binaryName);
  const devScript = path.join(app.getAppPath(), '..', 'agent', 'mediapipe_service.py');
  const resourceScript = path.join(process.resourcesPath, 'agent', 'mediapipe_service.py');
  const scriptCandidates = [devScript, resourceScript];
  const binaryCandidates = preferPackaged ? [integrationsBin, resourceBin, distBin] : [];

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

  let exe = getExecutable();
  if (!exe) {
    // Not on disk yet — try the R2 install flow (release builds only).
    const install = await installMediapipe();
    if (!install.ok) {
      return { ok: false, error: install.error || 'MediaPipe service not available. Install it from the Integrations panel.' };
    }
    exe = getExecutable();
    if (!exe) {
      return { ok: false, error: 'MediaPipe service install completed but binary still missing.' };
    }
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
