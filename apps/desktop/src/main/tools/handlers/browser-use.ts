import { app, BrowserWindow } from 'electron';
import { ChildProcess, spawn, execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import net from 'net';
import { randomBytes } from 'crypto';
import { pipeline } from 'stream/promises';
import { RouterContext } from '../types';
import { isDev } from '../../env';

const BROWSER_USE_PORT = 18082;
const BROWSER_USE_DEFAULT_HOST = 'http://localhost';
const BROWSER_USE_AUTH_HEADER = 'x-stuard-browser-token';
const BROWSER_USE_AUTH_TOKEN = process.env.BROWSER_USE_AUTH_TOKEN || randomBytes(24).toString('hex');

const DEFAULT_SERVICES_BASE_URL = 'https://updates.stuard.ai/services';

type BrowserUseRuntime = {
  sessionId: string;
  port: number;
  process: ChildProcess | null;
  ready: boolean;
  setupPromise: Promise<{ ok: boolean; error?: string; step?: string; alreadyRunning?: boolean }> | null;
};

type BrowserServerExecutable = {
  binary: string;
  args: string[];
  cwd: string;
  displayPath: string;
  isPacked: boolean;
  needsPathLookup?: boolean;
};

const browserUseRuntimes = new Map<string, BrowserUseRuntime>();
const browserUseRuntimePromises = new Map<string, Promise<BrowserUseRuntime>>();
let lastActiveBrowserUseSessionId = 'default';

function normalizeBrowserUseSessionId(value: any): string {
  const raw = String(value || 'default').trim();
  if (!raw) return 'default';
  const safe = raw.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 96);
  return safe || 'default';
}

function getBrowserUseRuntimeSessionId(args: any): string {
  return normalizeBrowserUseSessionId(
    args?._browserUseSessionId
      || args?.browser_server_session_id
      || args?.browserServerSessionId
      || 'default',
  );
}

function getStatusSessionId(args: any): string {
  if (args?.follow_last_active) {
    return normalizeBrowserUseSessionId(lastActiveBrowserUseSessionId || getBrowserUseRuntimeSessionId(args));
  }
  return getBrowserUseRuntimeSessionId(args);
}

function getBrowserUseTabRouting(args: any): Record<string, any> {
  const routing: Record<string, any> = {};
  const tabSessionId = String(args?.session_id || args?.sessionId || '').trim();
  if (tabSessionId) routing.session_id = tabSessionId;

  const rawTabIndex = args?.tab_index ?? args?.tabIndex;
  if (typeof rawTabIndex !== 'undefined') {
    const tabIndex = Number(rawTabIndex);
    if (Number.isInteger(tabIndex) && tabIndex >= 0) {
      routing.tab_index = tabIndex;
    }
  }

  return routing;
}

function getBrowserUseHost(runtime: BrowserUseRuntime): string {
  return process.env.BROWSER_USE_HOST || `${BROWSER_USE_DEFAULT_HOST}:${runtime.port}`;
}

function getProfileRootDir(): string {
  return path.join(app.getPath('userData'), 'browser-profiles');
}

function getProfileDir(sessionId = 'default'): string {
  return path.join(getProfileRootDir(), normalizeBrowserUseSessionId(sessionId));
}

function getPreferredBrowserMode(): 'headed' | 'headless' | 'connect' {
  const mode = String(process.env.STUARD_BROWSER_MODE || '').trim().toLowerCase();
  if (mode === 'headless' || mode === 'connect') return mode;
  return 'headed';
}

function shouldRestartForPreferredMode(status: any): boolean {
  const preferredMode = getPreferredBrowserMode();
  const currentMode = String(status?.mode || '').trim().toLowerCase();
  return !!currentMode && currentMode !== preferredMode;
}

async function allocateBrowserUsePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : BROWSER_USE_PORT;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

async function getRuntime(sessionId = 'default'): Promise<BrowserUseRuntime> {
  const normalizedSessionId = normalizeBrowserUseSessionId(sessionId);
  const existing = browserUseRuntimes.get(normalizedSessionId);
  if (existing) return existing;

  const pending = browserUseRuntimePromises.get(normalizedSessionId);
  if (pending) return pending;

  const created = (async () => {
    const runtime: BrowserUseRuntime = {
      sessionId: normalizedSessionId,
      port: await allocateBrowserUsePort(),
      process: null,
      ready: false,
      setupPromise: null,
    };
    browserUseRuntimes.set(normalizedSessionId, runtime);
    browserUseRuntimePromises.delete(normalizedSessionId);
    return runtime;
  })();

  browserUseRuntimePromises.set(normalizedSessionId, created);
  return created;
}

async function browserUseFetch(
  endpoint: string,
  options?: RequestInit & { timeoutMs?: number },
  sessionId = 'default',
): Promise<Response> {
  const runtime = await getRuntime(sessionId);
  const { timeoutMs = 30000, ...fetchOpts } = options || {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = new Headers(fetchOpts.headers || undefined);
    headers.set(BROWSER_USE_AUTH_HEADER, BROWSER_USE_AUTH_TOKEN);
    return await fetch(`${getBrowserUseHost(runtime)}${endpoint}`, {
      ...fetchOpts,
      headers,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function getPythonCmd(): string {
  return process.platform === 'win32' ? 'python' : 'python3';
}

function shouldPreferPackagedServices(): boolean {
  const forced = String(process.env.STUARD_USE_PACKAGED_SERVICES || '').trim().toLowerCase();
  return !isDev || forced === '1' || forced === 'true' || forced === 'yes';
}

function runCmd(cmd: string, args: string[], timeoutMs = 120000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

async function checkPythonAvailable(): Promise<boolean> {
  const { ok } = await runCmd(getPythonCmd(), ['--version'], 10000);
  return ok;
}

async function checkBrowserServerDeps(): Promise<boolean> {
  const { ok } = await runCmd(getPythonCmd(), ['-c', 'import aiohttp; print("ok")'], 10000);
  return ok;
}

function getIntegrationsDir(): string {
  return path.join(app.getPath('userData'), 'integrations', 'browser');
}

function getIntegrationsBinaryPath(): string {
  const binaryName = process.platform === 'win32' ? 'stuard-browser.exe' : 'stuard-browser';
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
  if (process.platform === 'win32') return 'stuard-browser.exe';
  if (process.platform === 'darwin') return 'stuard-browser-macos';
  return 'stuard-browser-linux';
}

function getServiceDownloadUrl(): string {
  const base = process.env.STUARD_SERVICES_URL || DEFAULT_SERVICES_BASE_URL;
  const channel = getUpdateChannel();
  const platform = getServicePlatform();
  const binaryName = getServiceBinaryName();
  return `${base}/${channel}/${platform}/latest/${binaryName}`;
}

// ── Install metadata so checkForUpdate can compare against the live HEAD ──

interface BrowserInstallMeta {
  url: string;
  etag: string | null;
  lastModified: string | null;
  downloadedAt: string;
  size: number | null;
}

function getInstallMetaPath(): string {
  return path.join(getIntegrationsDir(), 'install-meta.json');
}

function readInstallMeta(): BrowserInstallMeta | null {
  try {
    const raw = fs.readFileSync(getInstallMetaPath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as BrowserInstallMeta;
  } catch {}
  return null;
}

function writeInstallMeta(meta: BrowserInstallMeta): void {
  try {
    fs.mkdirSync(getIntegrationsDir(), { recursive: true });
    fs.writeFileSync(getInstallMetaPath(), JSON.stringify(meta, null, 2), 'utf8');
  } catch (e) {
    console.warn('[browser-server] Failed to write install-meta.json:', e);
  }
}

async function downloadBrowserBinary(): Promise<{ ok: boolean; error?: string }> {
  const destPath = getIntegrationsBinaryPath();
  const destDir = path.dirname(destPath);

  try { fs.mkdirSync(destDir, { recursive: true }); } catch {}

  const tmpPath = destPath + '.download';
  const url = getServiceDownloadUrl();
  console.log(`[browser-server] Downloading from ${url}...`);

  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      return { ok: false, error: `Download failed: HTTP ${resp.status} from ${url}` };
    }
    if (!resp.body) {
      return { ok: false, error: 'Download failed: empty response body' };
    }

    const fileStream = fs.createWriteStream(tmpPath);
    const { Readable } = require('stream');
    const readable = Readable.fromWeb(resp.body);
    await pipeline(readable, fileStream);

    if (process.platform !== 'win32') {
      fs.chmodSync(tmpPath, 0o755);
    }

    fs.renameSync(tmpPath, destPath);
    console.log(`[browser-server] Downloaded to ${destPath}`);

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

function isBrowserBinaryInstalled(): boolean {
  const integrationsBin = getIntegrationsBinaryPath();
  if (fs.existsSync(integrationsBin)) return true;

  const binaryName = process.platform === 'win32' ? 'stuard-browser.exe' : 'stuard-browser';
  const resourceBin = path.join(process.resourcesPath, 'agent', binaryName);
  if (fs.existsSync(resourceBin)) return true;

  return false;
}

let _installCheckResult: { ok: boolean; error?: string; step?: string } | null = null;

export async function installBrowserUse(): Promise<{ ok: boolean; error?: string; step?: string }> {
  if (_installCheckResult?.ok) return { ok: true };

  const exe = getServerExecutable();

  if (exe.isPacked) {
    if (fs.existsSync(exe.binary)) {
      _installCheckResult = { ok: true };
      return { ok: true };
    }
    // Packed binary expected but missing — download it
    const dl = await downloadBrowserBinary();
    if (!dl.ok) {
      return { ok: false, error: dl.error || 'Failed to download browser server', step: 'download' };
    }
    _installCheckResult = { ok: true };
    return { ok: true };
  }

  // Dev mode: Python script fallback
  if (!(await checkPythonAvailable())) {
    return { ok: false, error: 'Python is not installed. Please install Python 3.11+ from python.org first.', step: 'python' };
  }

  if (!(await checkBrowserServerDeps())) {
    const pip = await runCmd(getPythonCmd(), ['-m', 'pip', 'install', 'aiohttp'], 120000);
    if (!pip.ok) {
      return { ok: false, error: `Failed to install aiohttp: ${pip.stderr.slice(0, 300)}`, step: 'pip' };
    }
    if (!(await checkBrowserServerDeps())) {
      return { ok: false, error: 'aiohttp not available after install. Check your Python environment.', step: 'pip-verify' };
    }
  }

  _installCheckResult = { ok: true };
  return { ok: true };
}

export async function uninstallBrowserUse(): Promise<{ ok: boolean; error?: string }> {
  _installCheckResult = null;

  await stopAllBrowserUseServers();

  const profileDir = getProfileRootDir();
  try {
    if (fs.existsSync(profileDir)) {
      fs.rmSync(profileDir, { recursive: true, force: true });
    }
  } catch {}

  const integrationsDir = getIntegrationsDir();
  try {
    if (fs.existsSync(integrationsDir)) {
      fs.rmSync(integrationsDir, { recursive: true, force: true });
    }
  } catch {}

  return { ok: true };
}

// ── Public service-management API (for Connected Apps UI) ──

export interface BrowserUseLocalStatus {
  installed: boolean;
  running: boolean;
  integrationsDir: string;
  binaryPath: string | null;
  installSource: 'integrations' | 'bundled' | 'dev-script' | null;
  meta: BrowserInstallMeta | null;
  downloadUrl: string;
  sessions: string[];
}

export function getBrowserUseLocalStatus(): BrowserUseLocalStatus {
  const integrationsBin = getIntegrationsBinaryPath();
  const integrationsExists = fs.existsSync(integrationsBin);

  const binaryName = process.platform === 'win32' ? 'stuard-browser.exe' : 'stuard-browser';
  const resourceBin = path.join(process.resourcesPath, 'agent', binaryName);
  const resourceExists = fs.existsSync(resourceBin);

  const devScript = path.join(app.getAppPath(), '..', 'agent', 'browser_server_main.py');
  const devScriptExists = fs.existsSync(devScript);

  let installSource: BrowserUseLocalStatus['installSource'] = null;
  let binaryPath: string | null = null;
  if (integrationsExists) { installSource = 'integrations'; binaryPath = integrationsBin; }
  else if (resourceExists) { installSource = 'bundled'; binaryPath = resourceBin; }
  else if (devScriptExists) { installSource = 'dev-script'; binaryPath = devScript; }

  const sessions: string[] = [];
  for (const [sid, rt] of browserUseRuntimes.entries()) {
    if (rt.process && !rt.process.killed) sessions.push(sid);
  }

  return {
    installed: integrationsExists || resourceExists || devScriptExists,
    running: sessions.length > 0,
    integrationsDir: getIntegrationsDir(),
    binaryPath,
    installSource,
    meta: readInstallMeta(),
    downloadUrl: getServiceDownloadUrl(),
    sessions,
  };
}

export interface BrowserUseUpdateInfo {
  ok: boolean;
  error?: string;
  updateAvailable: boolean;
  reason?: 'no-local-meta' | 'etag-mismatch' | 'last-modified-newer' | 'size-mismatch' | 'up-to-date' | 'head-failed';
  remoteEtag?: string | null;
  remoteLastModified?: string | null;
  remoteSize?: number | null;
  url: string;
}

export async function checkBrowserUseForUpdate(): Promise<BrowserUseUpdateInfo> {
  const url = getServiceDownloadUrl();
  const meta = readInstallMeta();

  if (!meta && !isBrowserBinaryInstalled()) {
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
    return { ok: true, updateAvailable: true, reason: 'no-local-meta', remoteEtag, remoteLastModified, remoteSize, url };
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
 * Stop running browser servers and re-download the binary.
 * Used by the Connected Apps "Update" button.
 */
export async function updateBrowserUse(): Promise<{ ok: boolean; error?: string }> {
  await stopAllBrowserUseServers();
  _installCheckResult = null;
  const dl = await downloadBrowserBinary();
  if (!dl.ok) return dl;
  return { ok: true };
}

/**
 * Resolve the browser server executable or script.
 *
 * Resolution order for packaged builds:
 *   1. Integrations dir (userData/integrations/browser/) — downloaded on demand
 *   2. Bundled in app resources (resources/agent/)      — legacy fallback
 *   3. Monorepo dist/ (dev builds)
 *
 * In dev mode, prefer Python source scripts unless STUARD_USE_PACKAGED_SERVICES=1.
 */
function getServerExecutable(): BrowserServerExecutable {
  const binaryName = process.platform === 'win32' ? 'stuard-browser.exe' : 'stuard-browser';
  const preferPackaged = shouldPreferPackagedServices();

  const integrationsBin = getIntegrationsBinaryPath();
  const resourceBin = path.join(process.resourcesPath, 'agent', binaryName);
  const distBin = path.join(app.getAppPath(), '..', '..', 'dist', binaryName);
  const devScript = path.join(app.getAppPath(), '..', 'agent', 'browser_server_main.py');
  const resourceScript = path.join(process.resourcesPath, 'agent', 'browser_server_main.py');
  const altScript = path.resolve(__dirname, '..', '..', '..', '..', 'agent', 'browser_server_main.py');
  const pythonCmd = getPythonCmd();

  const scriptCandidates = [devScript, resourceScript, altScript];
  const binaryCandidates = preferPackaged ? [integrationsBin, resourceBin, distBin] : [];

  for (const candidate of binaryCandidates) {
    if (fs.existsSync(candidate)) {
      return {
        binary: candidate,
        args: [],
        cwd: path.dirname(candidate),
        displayPath: candidate,
        isPacked: true,
      };
    }
  }

  for (const candidate of scriptCandidates) {
    if (fs.existsSync(candidate)) {
      return {
        binary: pythonCmd,
        args: [candidate],
        cwd: path.dirname(candidate),
        displayPath: candidate,
        isPacked: false,
        needsPathLookup: true,
      };
    }
  }

  // Nothing found on disk — return the integrations path as target
  // (installBrowserUse will download it before startBrowserUseServer runs)
  if (preferPackaged) {
    return {
      binary: integrationsBin,
      args: [],
      cwd: path.dirname(integrationsBin),
      displayPath: integrationsBin,
      isPacked: true,
    };
  }

  return {
    binary: pythonCmd,
    args: [devScript],
    cwd: path.dirname(devScript),
    displayPath: devScript,
    isPacked: false,
    needsPathLookup: true,
  };
}

export function canPrewarmBrowserUseOnStartup(): boolean {
  try {
    if (!shouldPreferPackagedServices()) return false;
    return isBrowserBinaryInstalled();
  } catch {
    return false;
  }
}

async function killPortProcess(port: number): Promise<void> {
  if (process.platform === 'win32') {
    try {
      const { stdout } = await runCmd('netstat', ['-ano'], 10000);
      const lines = stdout.split('\n');
      for (const line of lines) {
        if (line.includes(`:${port}`) && line.includes('LISTENING')) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && /^\d+$/.test(pid)) {
            await runCmd('taskkill', ['/PID', pid, '/F'], 5000);
          }
        }
      }
    } catch {}
  } else {
    try {
      const { stdout } = await runCmd('lsof', ['-ti', `:${port}`], 5000);
      const pids = stdout.trim().split('\n').filter(Boolean);
      for (const pid of pids) {
        await runCmd('kill', ['-9', pid], 3000);
      }
    } catch {}
  }
}

async function killOrphanChromeForProfile(profileDir: string): Promise<void> {
  try {
    if (process.platform === 'win32') {
      const norm = profileDir.replace(/\//g, '\\');
      // Use WMIC to find Chrome/Edge processes using this profile directory
      const { ok, stdout } = await runCmd('wmic', [
        'process', 'where', "Name like 'chrome%' or Name like 'msedge%'",
        'get', 'ProcessId,CommandLine', '/format:csv',
      ], 8000);
      if (!ok || !stdout) return;
      const pids: string[] = [];
      for (const line of stdout.split('\n')) {
        if (line.toLowerCase().includes(norm.toLowerCase())) {
          const parts = line.trim().replace(/,+$/, '').split(',');
          const pid = parts[parts.length - 1]?.trim();
          if (pid && /^\d+$/.test(pid)) pids.push(pid);
        }
      }
      for (const pid of pids) {
        await runCmd('taskkill', ['/PID', pid, '/F'], 5000);
      }
    } else {
      await runCmd('pkill', ['-f', `--user-data-dir=${profileDir}`], 5000);
    }
  } catch {}
}

async function terminateBrowserUseProcess(runtime: BrowserUseRuntime): Promise<void> {
  const proc = runtime.process;
  if (!proc || proc.killed) return;

  try {
    const pid = proc.pid;
    if (process.platform === 'win32' && pid) {
      await runCmd('taskkill', ['/PID', String(pid), '/T', '/F'], 5000);
      return;
    }

    try { proc.kill('SIGTERM'); } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (proc.exitCode === null) {
      try { proc.kill('SIGKILL'); } catch {}
    }
  } catch {}
}

async function ensureBrowserPageOpen(sessionId = 'default', {} = {}): Promise<{ ok: boolean; error?: string }> {
  try {
    const statusResp = await browserUseFetch('/status', { timeoutMs: 5000 }, sessionId);
    if (statusResp.ok) {
      return { ok: true };
    }
    const errText = await statusResp.text().catch(() => '');
    return { ok: false, error: `Browser status check failed: ${statusResp.status} ${errText}` };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Browser status check failed' };
  }
}

export async function startBrowserUseServer(sessionId = 'default', {} = {}): Promise<{ ok: boolean; error?: string }> {
  const runtime = await getRuntime(sessionId);
  if (runtime.process && !runtime.process.killed) {
    const alive = await isBrowserUseAlive(sessionId);
    if (alive) {
      const opened = await ensureBrowserPageOpen(sessionId);
      return opened.ok ? { ok: true } : opened;
    }
    try { runtime.process.kill(); } catch {}
    runtime.process = null;
    runtime.ready = false;
  }

  if (await isBrowserUseAlive(sessionId)) {
    runtime.ready = true;
    const opened = await ensureBrowserPageOpen(sessionId);
    return opened.ok ? { ok: true } : opened;
  }

  await killPortProcess(runtime.port);

  // Kill any orphan Chrome holding the profile lock — this is the main cause
  // of "Chrome exited immediately with code 0" on headed mode startup.
  await killOrphanChromeForProfile(getProfileDir(sessionId));

  await new Promise((r) => setTimeout(r, 500));

  let exe = getServerExecutable();
  const profileDir = getProfileDir(sessionId);

  if (exe.needsPathLookup) {
    if (!(await checkPythonAvailable())) {
      return { ok: false, error: 'Python is not installed. Please install Python 3.11+ from python.org first.' };
    }
    if (!exe.args[0] || !fs.existsSync(exe.args[0])) {
      return { ok: false, error: `Browser server script not found: ${exe.displayPath}` };
    }
  } else if (!fs.existsSync(exe.binary)) {
    // Binary missing — attempt on-demand download
    if (exe.isPacked) {
      const dl = await downloadBrowserBinary();
      if (!dl.ok) {
        return { ok: false, error: dl.error || `Browser server not found: ${exe.displayPath}` };
      }
      exe = getServerExecutable();
    }
    if (!fs.existsSync(exe.binary)) {
      return { ok: false, error: `Browser server not found: ${exe.displayPath}` };
    }
  }

  let earlyStderr = '';

  try {
    const spawnArgs = [...exe.args]; // for packed binary: [], for python: [script.py]
    runtime.process = spawn(exe.binary, spawnArgs, {
      env: {
        ...process.env,
        BROWSER_USE_PORT: String(runtime.port),
        BROWSER_USE_PROFILE_DIR: profileDir,
        BROWSER_USE_AUTH_TOKEN,
        STUARD_BROWSER_PORT: String(runtime.port),
        STUARD_BROWSER_PROFILE_DIR: profileDir,
        STUARD_BROWSER_AUTH_TOKEN: BROWSER_USE_AUTH_TOKEN,
        STUARD_BROWSER_MODE: getPreferredBrowserMode(),
      },
      cwd: exe.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    runtime.process.on('exit', (code) => {
      console.warn(`[browser-server:${runtime.sessionId}] exited with code ${code}`);
      runtime.process = null;
      runtime.ready = false;
      runtime.setupPromise = null;
    });

    runtime.process.stdout?.on('data', (data: Buffer) => {
      const msg = data.toString();
      console.log(`[browser-server:${runtime.sessionId}]`, msg.trim());
      if (msg.includes('Starting on') || msg.includes('Running on')) runtime.ready = true;
    });

    runtime.process.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      console.warn(`[browser-server:${runtime.sessionId}]`, msg);
      earlyStderr += msg + '\n';
    });

    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 200));

      if (!runtime.process || runtime.process.exitCode !== null) {
        const errMsg = earlyStderr.trim().slice(0, 400) || 'Server crashed on startup';
        return { ok: false, error: errMsg };
      }

      if (await isBrowserUseAlive(sessionId)) {
        runtime.ready = true;
        const opened = await ensureBrowserPageOpen(sessionId);
        return opened.ok ? { ok: true } : opened;
      }
    }

    const errMsg = earlyStderr.trim().slice(0, 400) || 'Server did not respond within 10 seconds';
    return { ok: false, error: errMsg };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Failed to start browser server' };
  }
}

export async function stopBrowserUseServer(sessionId = 'default'): Promise<{ ok: boolean }> {
  const runtime = await getRuntime(sessionId);

  // Ask the server to close Chrome gracefully before we kill the process.
  // Without this, TerminateProcess (Windows) kills the server instantly and
  // the Chrome child process is orphaned.
  if (runtime.ready && runtime.process && !runtime.process.killed) {
    try {
      await browserUseFetch('/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        timeoutMs: 4000,
      }, sessionId);
    } catch {}
    // Give Chrome a moment to exit after Browser.close
    await new Promise((r) => setTimeout(r, 500));
  }

  if (runtime.process && !runtime.process.killed) {
    await terminateBrowserUseProcess(runtime);
    runtime.process = null;
  }
  runtime.ready = false;
  runtime.setupPromise = null;

  // Kill any orphan Chrome that survived the graceful close
  try {
    await killOrphanChromeForProfile(getProfileDir(sessionId));
  } catch {}

  return { ok: true };
}

async function stopAllBrowserUseServers(): Promise<void> {
  // Send /close to all servers in parallel so Chrome instances shut down concurrently
  await Promise.all(Array.from(browserUseRuntimes.values()).map(async (runtime) => {
    if (runtime.ready && runtime.process && !runtime.process.killed) {
      try {
        const headers = new Headers();
        headers.set(BROWSER_USE_AUTH_HEADER, BROWSER_USE_AUTH_TOKEN);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4000);
        try {
          await fetch(`${getBrowserUseHost(runtime)}/close`, {
            method: 'POST',
            headers,
            body: '{}',
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }
      } catch {}
    }
  }));

  // Brief wait for Chrome processes to exit
  await new Promise((r) => setTimeout(r, 500));

  // Now force-kill any remaining server processes
  for (const runtime of browserUseRuntimes.values()) {
    if (runtime.process && !runtime.process.killed) {
      await terminateBrowserUseProcess(runtime);
    }
    runtime.process = null;
    runtime.ready = false;
    runtime.setupPromise = null;
  }

  // Kill any orphan Chrome instances that survived the graceful shutdown.
  // This prevents "Chrome exited immediately with code 0" on next startup.
  for (const runtime of browserUseRuntimes.values()) {
    try {
      await killOrphanChromeForProfile(getProfileDir(runtime.sessionId));
    } catch {}
  }
}

/** Gracefully shut down all browser servers and their Chrome instances. */
export async function shutdownAllBrowserUseServers(): Promise<void> {
  await stopAllBrowserUseServers();
}

async function isBrowserUseAlive(sessionId = 'default'): Promise<boolean> {
  try {
    const resp = await browserUseFetch('/status', { timeoutMs: 3000 }, sessionId);
    return resp.ok;
  } catch {
    return false;
  }
}

async function getBrowserUseServerStatus(sessionId = 'default'): Promise<any | null> {
  try {
    const resp = await browserUseFetch('/status', { timeoutMs: 5000 }, sessionId);
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

export async function setupBrowserUse(sessionId = 'default'): Promise<{ ok: boolean; error?: string; step?: string; alreadyRunning?: boolean }> {
  const status = await getBrowserUseServerStatus(sessionId);
  if (status) {
    // Server can be alive but unusable (missing browser_use package in that Python env).
    if (!status.installed) {
      const install = await installBrowserUse();
      if (!install.ok) return install;
      await stopBrowserUseServer(sessionId);
      const started = await startBrowserUseServer(sessionId);
      return started.ok ? { ok: true, alreadyRunning: true } : started;
    }
    const opened = await ensureBrowserPageOpen(sessionId);
    return opened.ok ? { ok: true, alreadyRunning: true } : opened;
  }

  const install = await installBrowserUse();
  if (!install.ok) return install;

  return await startBrowserUseServer(sessionId);
}

async function ensureReady(sessionId = 'default'): Promise<{ ok: boolean; error?: string }> {
  const runtime = await getRuntime(sessionId);
  const status = await getBrowserUseServerStatus(sessionId);
  if (status?.installed) {
    const opened = await ensureBrowserPageOpen(sessionId);
    if (opened.ok) return { ok: true };
  }

  // Coalesce concurrent setup calls so we don't spawn multiple processes
  if (!runtime.setupPromise) {
    runtime.setupPromise = setupBrowserUse(sessionId).finally(() => { runtime.setupPromise = null; });
  }
  return runtime.setupPromise;
}

/** Broadcast browser activity to all renderer windows so sidebar can auto-open */
function emitBrowserActivity(action: string, sessionId: string) {
  lastActiveBrowserUseSessionId = normalizeBrowserUseSessionId(sessionId);
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('browser:activity', { action, sessionId, timestamp: Date.now() });
      }
    }
  } catch {}
}

async function withServer<T>(
  label: string,
  args: any,
  fn: (sessionId: string) => Promise<T>,
): Promise<T | { ok: false; error: string }> {
  const sessionId = getBrowserUseRuntimeSessionId(args);
  const ready = await ensureReady(sessionId);
  if (!ready.ok) return { ok: false, error: `Browser not available: ${ready.error || 'setup failed'}` };
  try {
    emitBrowserActivity(label, sessionId);
    return await fn(sessionId);
  } catch (err: any) {
    return { ok: false, error: err.message || `${label} failed` };
  }
}

/**
 * Pre-warm the browser server in the background on app startup.
 * This starts the packaged browser server process so the first browser tool call is fast.
 * Non-blocking — fire and forget. If it fails, the normal lazy setup will handle it.
 */
export async function prewarmBrowserUseServer(): Promise<void> {
  try {
    // Keep startup light by only prewarming the packaged service.
    // skipChromeSync: true — prewarm only starts the HTTP server process,
    // it must NOT trigger chrome sync which would launch a browser window
    if (!canPrewarmBrowserUseOnStartup()) return;

    const runtime = await getRuntime('default');
    if (!runtime.process || runtime.process.killed) {
      console.log('[browser-server] Pre-warming packaged server...');
      startBrowserUseServer('default', {}).catch(() => {});
    }
  } catch {
    // Pre-warming is best-effort
  }
}

export async function execBrowserUseStatus(args: any, _ctx: RouterContext): Promise<any> {
  const sessionId = getStatusSessionId(args);
  const serverAlive = await isBrowserUseAlive(sessionId);
  if (serverAlive) {
    try {
      const resp = await browserUseFetch('/status', { timeoutMs: 5000 }, sessionId);
      if (resp.ok) {
        const data = await resp.json();
        return {
          ok: true,
          ...data,
          serverAlive: true,
          sessionId,
          lastActiveSessionId: lastActiveBrowserUseSessionId,
        };
      }
    } catch {}
  }

  const binaryInstalled = isBrowserBinaryInstalled();
  let installed = binaryInstalled;
  let hasPython = false;
  if (!binaryInstalled) {
    hasPython = await checkPythonAvailable();
    installed = hasPython ? await checkBrowserServerDeps() : false;
  }

  return {
    ok: true,
    installed,
    running: false,
    serverAlive: false,
    hasPython,
    binaryInstalled,
    integrationsPath: getIntegrationsDir(),
    mode: 'headed',
    profile: 'default',
    profileDir: String(getProfileDir(sessionId)),
    sessionId,
    lastActiveSessionId: lastActiveBrowserUseSessionId,
  };
}

export async function execBrowserUseConfigure(args: any, _ctx: RouterContext): Promise<any> {
  return withServer('Configure', args, async (sessionId) => {
    const resp = await browserUseFetch('/configure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: args?.mode,
        profile: 'default', // always use default profile
      }),
    }, sessionId);
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { ok: false, error: `Configure failed: ${resp.status} ${errText}` };
    }
    return await resp.json();
  });
}

export async function execBrowserUseTask(args: any, ctx: RouterContext): Promise<any> {
  ctx.logFn?.('[browser_use_task] Disabled; use browser_use_execute_script instead');
  return {
    ok: false,
    error: 'browser_use_task is disabled. Use browser_use_execute_script for complex page logic.',
  };
}

export async function execBrowserUseExecuteScript(args: any, ctx: RouterContext): Promise<any> {
  const script = String(args?.script || '').trim();
  if (!script) return { ok: false, error: 'script is required' };
  ctx.logFn?.(`[browser_use_execute_script] Running (${script.length} chars)`);

  const timeoutRaw = Number(args?.timeout ?? 30000);
  const timeoutMs = Number.isFinite(timeoutRaw) ? Math.max(250, Math.min(300000, Math.floor(timeoutRaw))) : 30000;
  const scriptArgs = args?.args;

  return withServer('ExecuteScript', args, async (sessionId) => {
    const resp = await browserUseFetch('/execute-script', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...getBrowserUseTabRouting(args),
        script,
        args: scriptArgs && typeof scriptArgs === 'object' && !Array.isArray(scriptArgs) ? scriptArgs : undefined,
        wait_for_selector: args?.wait_for_selector,
        wait_timeout: args?.wait_timeout,
        timeout: timeoutMs,
      }),
      timeoutMs: timeoutMs + 5000,
    }, sessionId);
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { ok: false, error: `Execute script failed: ${resp.status} ${errText}` };
    }
    return await resp.json();
  });
}

export async function execBrowserUseNavigate(args: any, _ctx: RouterContext): Promise<any> {
  const url = args?.url;
  if (!url) return { ok: false, error: 'url is required' };

  const navTimeout = Math.max(10000, Number(args?.timeout || 60000));

  return withServer('Navigation', args, async (sessionId) => {
    const resp = await browserUseFetch('/navigate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...getBrowserUseTabRouting(args),
        url,
        wait_until: args?.wait_until || 'domcontentloaded',
        timeout: navTimeout,
        wait_for_selector: args?.wait_for_selector,
      }),
      timeoutMs: navTimeout + 10000,
    }, sessionId);
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { ok: false, error: `Navigation failed: ${resp.status} ${errText}` };
    }
    return await resp.json();
  });
}

export async function execBrowserUseClick(args: any, _ctx: RouterContext): Promise<any> {
  return withServer('Click', args, async (sessionId) => {
    const resp = await browserUseFetch('/click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...getBrowserUseTabRouting(args),
        elementId: args?.elementId,
        selector: args?.selector,
        text: args?.text,
        exact: args?.exact,
        timeout: args?.timeout,
      }),
    }, sessionId);
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { ok: false, error: `Click failed: ${resp.status} ${errText}` };
    }
    return await resp.json();
  });
}

export async function execBrowserUseType(args: any, _ctx: RouterContext): Promise<any> {
  return withServer('Type', args, async (sessionId) => {
    const resp = await browserUseFetch('/type', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...getBrowserUseTabRouting(args),
        elementId: args?.elementId,
        selector: args?.selector,
        text: args?.text ?? '',
        clear: args?.clear,
        timeout: args?.timeout,
      }),
    }, sessionId);
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { ok: false, error: `Type failed: ${resp.status} ${errText}` };
    }
    return await resp.json();
  });
}

export async function execBrowserUsePressKey(args: any, _ctx: RouterContext): Promise<any> {
  const key = String(args?.key || '').trim();
  if (!key) return { ok: false, error: 'key is required' };

  return withServer('PressKey', args, async (sessionId) => {
    const resp = await browserUseFetch('/press_key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...getBrowserUseTabRouting(args),
        key,
        elementId: args?.elementId,
        selector: args?.selector,
      }),
    }, sessionId);
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { ok: false, error: `Press key failed: ${resp.status} ${errText}` };
    }
    return await resp.json();
  });
}

export async function execBrowserUseScreenshot(args: any, _ctx: RouterContext): Promise<any> {
  return withServer('Screenshot', args, async (sessionId) => {
    const resp = await browserUseFetch('/screenshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...getBrowserUseTabRouting(args), full_page: args?.full_page }),
      timeoutMs: 15000,
    }, sessionId);
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { ok: false, error: `Screenshot failed: ${resp.status} ${errText}` };
    }
    return await resp.json();
  });
}

export async function execBrowserUseContent(args: any, _ctx: RouterContext): Promise<any> {
  return withServer('Content', args, async (sessionId) => {
    const resp = await browserUseFetch('/content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...getBrowserUseTabRouting(args),
        mode: args?.mode,
        max_length: args?.max_length,
        viewport_only: args?.viewport_only,
        wait_for_selector: args?.wait_for_selector,
        wait_timeout: args?.wait_timeout,
      }),
    }, sessionId);
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { ok: false, error: `Content failed: ${resp.status} ${errText}` };
    }
    return await resp.json();
  });
}

export async function execBrowserUseScroll(args: any, _ctx: RouterContext): Promise<any> {
  return withServer('Scroll', args, async (sessionId) => {
    const resp = await browserUseFetch('/scroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...getBrowserUseTabRouting(args),
        direction: args?.direction,
        amount: args?.amount,
        selector: args?.selector,
      }),
    }, sessionId);
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { ok: false, error: `Scroll failed: ${resp.status} ${errText}` };
    }
    return await resp.json();
  });
}

export async function execBrowserUseTabs(args: any, _ctx: RouterContext): Promise<any> {
  return withServer('Tabs', args, async (sessionId) => {
    const resp = await browserUseFetch('/tabs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...getBrowserUseTabRouting(args),
        action: args?.action,
        index: args?.index,
        url: args?.url,
      }),
    }, sessionId);
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { ok: false, error: `Tabs failed: ${resp.status} ${errText}` };
    }
    return await resp.json();
  });
}

export async function execBrowserUseCookies(args: any, _ctx: RouterContext): Promise<any> {
  return withServer('Cookies', args, async (sessionId) => {
    const resp = await browserUseFetch('/cookies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...getBrowserUseTabRouting(args),
        action: args?.action,
        cookies: args?.cookies,
        urls: args?.urls,
        path: args?.path,
      }),
    }, sessionId);
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { ok: false, error: `Cookies failed: ${resp.status} ${errText}` };
    }
    return await resp.json();
  });
}

export async function execBrowserUseHover(args: any, _ctx: RouterContext): Promise<any> {
  return withServer('Hover', args, async (sessionId) => {
    const resp = await browserUseFetch('/hover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...getBrowserUseTabRouting(args),
        elementId: args?.elementId,
        selector: args?.selector,
        text: args?.text,
        timeout: args?.timeout,
      }),
    }, sessionId);
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { ok: false, error: `Hover failed: ${resp.status} ${errText}` };
    }
    return await resp.json();
  });
}

export async function execBrowserUseSelectOption(args: any, _ctx: RouterContext): Promise<any> {
  return withServer('SelectOption', args, async (sessionId) => {
    const resp = await browserUseFetch('/select_option', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...getBrowserUseTabRouting(args),
        elementId: args?.elementId,
        selector: args?.selector,
        value: args?.value,
        label: args?.label,
        index: args?.index,
        search: args?.search,
        timeout: args?.timeout,
      }),
    }, sessionId);
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { ok: false, error: `Select option failed: ${resp.status} ${errText}` };
    }
    return await resp.json();
  });
}

export async function execBrowserUseGetDropdownOptions(args: any, _ctx: RouterContext): Promise<any> {
  return withServer('GetDropdownOptions', args, async (sessionId) => {
    const resp = await browserUseFetch('/get_dropdown_options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...getBrowserUseTabRouting(args),
        elementId: args?.elementId,
        selector: args?.selector,
        timeout: args?.timeout,
      }),
    }, sessionId);
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { ok: false, error: `Get dropdown options failed: ${resp.status} ${errText}` };
    }
    return await resp.json();
  });
}

export async function execBrowserUseGetInteractiveElements(args: any, _ctx: RouterContext): Promise<any> {
  return withServer('GetInteractiveElements', args, async (sessionId) => {
    const resp = await browserUseFetch('/get_interactive_elements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...getBrowserUseTabRouting(args),
        wait_for_selector: args?.wait_for_selector,
        wait_timeout: args?.wait_timeout,
        viewport_only: args?.viewport_only,
        include_selectors: args?.include_selectors,
        include_forms: args?.include_forms,
        max_elements: args?.max_elements,
      }),
      timeoutMs: 15000,
    }, sessionId);
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { ok: false, error: `Get interactive elements failed: ${resp.status} ${errText}` };
    }
    return await resp.json();
  });
}

export async function execBrowserUseFillForm(args: any, _ctx: RouterContext): Promise<any> {
  return withServer('FillForm', args, async (sessionId) => {
    const normalizedFields = Array.isArray(args?.fields)
      ? args.fields.map((field: any) => {
          if (field && typeof field === 'object' && String(field.type || '').toLowerCase() === 'file' && typeof field.value === 'string') {
            return { ...field, value: path.resolve(field.value) };
          }
          return field;
        })
      : args?.fields;

    const resp = await browserUseFetch('/fill_form', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...getBrowserUseTabRouting(args),
        fields: normalizedFields,
        submit: args?.submit,
        form_selector: args?.form_selector,
      }),
      timeoutMs: 30000,
    }, sessionId);
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { ok: false, error: `Fill form failed: ${resp.status} ${errText}` };
    }
    return await resp.json();
  });
}

export async function execBrowserUseUploadFile(args: any, _ctx: RouterContext): Promise<any> {
  const filePath = String(args?.filePath ?? args?.file_path ?? args?.path ?? '').trim();
  if (!filePath) return { ok: false, error: 'filePath is required' };

  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    return { ok: false, error: `File not found: ${resolvedPath}` };
  }

  return withServer('UploadFile', args, async (sessionId) => {
    const resp = await browserUseFetch('/upload_file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...getBrowserUseTabRouting(args),
        selector: args?.selector,
        file_path: resolvedPath,
        timeout: args?.timeout,
      }),
      timeoutMs: Math.max(10000, Number(args?.timeout || 5000) + 5000),
    }, sessionId);
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { ok: false, error: `Upload file failed: ${resp.status} ${errText}` };
    }
    return await resp.json();
  });
}

export async function execBrowserUseWaitFor(args: any, _ctx: RouterContext): Promise<any> {
  return withServer('WaitFor', args, async (sessionId) => {
    const timeoutRaw = Number(args?.timeout ?? 10000);
    const timeoutMs = Number.isFinite(timeoutRaw) ? Math.max(500, Math.min(60000, Math.floor(timeoutRaw))) : 10000;
    const resp = await browserUseFetch('/wait_for', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...getBrowserUseTabRouting(args),
        selector: args?.selector,
        text: args?.text,
        url_pattern: args?.url_pattern,
        state: args?.state,
        timeout: timeoutMs,
      }),
      timeoutMs: timeoutMs + 5000,
    }, sessionId);
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { ok: false, error: `Wait failed: ${resp.status} ${errText}` };
    }
    return await resp.json();
  });
}

/**
 * Fast screenshot mirror for sidebar — returns raw JPEG as base64 data URL.
 * Uses the /screenshot_mirror GET endpoint for efficiency.
 */
export async function browserMirrorScreenshot(sessionId = 'default', quality = 50): Promise<{
  ok: boolean;
  dataUrl?: string;
  url?: string;
  title?: string;
  viewportWidth?: number;
  viewportHeight?: number;
  error?: string;
}> {
  const alive = await isBrowserUseAlive(sessionId);
  if (!alive) return { ok: false, error: 'Browser not running' };

  try {
    const runtime = await getRuntime(sessionId);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const headers = new Headers();
      headers.set(BROWSER_USE_AUTH_HEADER, BROWSER_USE_AUTH_TOKEN);
      const resp = await fetch(
        `${getBrowserUseHost(runtime)}/screenshot_mirror?quality=${quality}`,
        { headers, signal: controller.signal },
      );
      if (!resp.ok) return { ok: false, error: `Screenshot failed: ${resp.status}` };

      const buf = await resp.arrayBuffer();
      const base64 = Buffer.from(buf).toString('base64');
      return {
        ok: true,
        dataUrl: `data:image/jpeg;base64,${base64}`,
        url: resp.headers.get('x-page-url') || '',
        title: resp.headers.get('x-page-title') || '',
        viewportWidth: parseInt(resp.headers.get('x-viewport-width') || '0', 10) || 0,
        viewportHeight: parseInt(resp.headers.get('x-viewport-height') || '0', 10) || 0,
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Screenshot failed' };
  }
}

/**
 * Click at coordinates in the agent's browser — for sidebar mirror click forwarding.
 */
export async function browserMirrorClickAt(
  sessionId = 'default',
  x: number,
  y: number,
  type: 'click' | 'dblclick' = 'click',
): Promise<{ ok: boolean; error?: string }> {
  const alive = await isBrowserUseAlive(sessionId);
  if (!alive) return { ok: false, error: 'Browser not running' };

  try {
    const resp = await browserUseFetch('/click_at', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x, y, type }),
      timeoutMs: 5000,
    }, sessionId);
    if (!resp.ok) return { ok: false, error: `Click failed: ${resp.status}` };
    return await resp.json();
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Click failed' };
  }
}

/**
 * Type text in the agent's browser — for sidebar mirror keyboard forwarding.
 */
export async function browserMirrorType(
  sessionId = 'default',
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  const alive = await isBrowserUseAlive(sessionId);
  if (!alive) return { ok: false, error: 'Browser not running' };

  try {
    const resp = await browserUseFetch('/type', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, clear: false }),
      timeoutMs: 5000,
    }, sessionId);
    if (!resp.ok) return { ok: false, error: `Type failed: ${resp.status}` };
    return await resp.json();
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Type failed' };
  }
}

/**
 * Press a key in the agent's browser — for sidebar mirror keyboard forwarding.
 */
export async function browserMirrorPressKey(
  sessionId = 'default',
  key: string,
): Promise<{ ok: boolean; error?: string }> {
  const alive = await isBrowserUseAlive(sessionId);
  if (!alive) return { ok: false, error: 'Browser not running' };

  try {
    const resp = await browserUseFetch('/press_key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
      timeoutMs: 5000,
    }, sessionId);
    if (!resp.ok) return { ok: false, error: `Press key failed: ${resp.status}` };
    return await resp.json();
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Press key failed' };
  }
}

/**
 * Scroll the agent's browser — for sidebar mirror scroll forwarding.
 */
export async function browserMirrorScroll(
  sessionId = 'default',
  direction: 'up' | 'down' = 'down',
  amount = 300,
): Promise<{ ok: boolean; error?: string }> {
  const alive = await isBrowserUseAlive(sessionId);
  if (!alive) return { ok: false, error: 'Browser not running' };

  try {
    const resp = await browserUseFetch('/scroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction, amount }),
      timeoutMs: 5000,
    }, sessionId);
    if (!resp.ok) return { ok: false, error: `Scroll failed: ${resp.status}` };
    return await resp.json();
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Scroll failed' };
  }
}

export async function execBrowserUseClose(args: any, _ctx: RouterContext): Promise<any> {
  const sessionId = getBrowserUseRuntimeSessionId(args);
  if (!(await isBrowserUseAlive(sessionId))) return { ok: true, closed: true };
  try {
    const resp = await browserUseFetch('/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      timeoutMs: 10000,
    }, sessionId);
    if (!resp.ok) {
      return { ok: false, error: 'Close failed' };
    }
    return await resp.json();
  } catch (err: any) {
    return { ok: false, error: err.message || 'Close failed' };
  }
}
