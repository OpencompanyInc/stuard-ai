import { app } from 'electron';
import { ChildProcess, spawn, execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import net from 'net';
import { randomBytes } from 'crypto';
import { RouterContext } from '../types';
import { loadSettings } from '../../settings';

const BROWSER_USE_PORT = 18082;
const BROWSER_USE_DEFAULT_HOST = 'http://localhost';
const BROWSER_USE_AUTH_HEADER = 'x-stuard-browser-token';
const BROWSER_USE_AUTH_TOKEN = process.env.BROWSER_USE_AUTH_TOKEN || randomBytes(24).toString('hex');

type BrowserUseRuntime = {
  sessionId: string;
  port: number;
  process: ChildProcess | null;
  ready: boolean;
  setupPromise: Promise<{ ok: boolean; error?: string; step?: string; alreadyRunning?: boolean }> | null;
  chromeSyncPromise: Promise<void> | null;
  lastChromeSyncAt: number;
  lastChromeSyncKey: string;
};

const browserUseRuntimes = new Map<string, BrowserUseRuntime>();
const browserUseRuntimePromises = new Map<string, Promise<BrowserUseRuntime>>();

const CHROME_SYNC_MIN_INTERVAL_MS = 15000;

function normalizeBrowserUseSessionId(value: any): string {
  const raw = String(value || 'default').trim();
  if (!raw) return 'default';
  const safe = raw.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 96);
  return safe || 'default';
}

function getBrowserUseSessionId(args: any): string {
  return normalizeBrowserUseSessionId(args?.session_id || args?._browserUseSessionId || 'default');
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
      chromeSyncPromise: null,
      lastChromeSyncAt: 0,
      lastChromeSyncKey: '',
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

async function checkBrowserUseInstalled(): Promise<boolean> {
  const { ok } = await runCmd(getPythonCmd(), ['-c', 'import browser_use; print("ok")'], 15000);
  return ok;
}

async function checkPlaywrightChromium(): Promise<boolean> {
  const { ok } = await runCmd(getPythonCmd(), ['-c', 'from playwright.sync_api import sync_playwright; print("ok")'], 15000);
  return ok;
}

// Cache installation check results to avoid repeated slow Python subprocess calls
let _installCheckResult: { ok: boolean; error?: string; step?: string } | null = null;

export async function installBrowserUse(): Promise<{ ok: boolean; error?: string; step?: string }> {
  // Return cached result if we already verified everything is installed
  if (_installCheckResult?.ok) return { ok: true };

  if (!(await checkPythonAvailable())) {
    return { ok: false, error: 'Python is not installed. Please install Python 3.11+ from python.org first.', step: 'python' };
  }

  // Run browser-use and playwright checks in parallel for faster startup
  const [hasBrowserUse, hasPlaywright] = await Promise.all([
    checkBrowserUseInstalled(),
    checkPlaywrightChromium(),
  ]);

  if (!hasBrowserUse) {
    const pip = await runCmd(getPythonCmd(), ['-m', 'pip', 'install', 'browser-use', 'aiohttp', 'cryptography'], 300000);
    if (!pip.ok) {
      return { ok: false, error: `Failed to install browser-use: ${pip.stderr.slice(0, 300)}`, step: 'pip' };
    }
  }

  if (!hasPlaywright) {
    const pipPw = await runCmd(getPythonCmd(), ['-m', 'pip', 'install', 'playwright'], 300000);
    if (!pipPw.ok) {
      return { ok: false, error: `Failed to install playwright: ${pipPw.stderr.slice(0, 300)}`, step: 'playwright-pip' };
    }
    const pw = await runCmd(getPythonCmd(), ['-m', 'playwright', 'install', 'chromium'], 300000);
    if (!pw.ok) {
      return { ok: false, error: `Failed to install Chromium browser: ${pw.stderr.slice(0, 300)}`, step: 'playwright' };
    }
  }

  _installCheckResult = { ok: true };
  return { ok: true };
}

export async function uninstallBrowserUse(): Promise<{ ok: boolean; error?: string }> {
  await stopAllBrowserUseServers();

  const hasPython = await checkPythonAvailable();
  if (!hasPython) return { ok: true };

  const pip1 = await runCmd(getPythonCmd(), ['-m', 'pip', 'uninstall', '-y', 'browser-use'], 60000);
  const pip2 = await runCmd(getPythonCmd(), ['-m', 'pip', 'uninstall', '-y', 'playwright'], 60000);

  const profileDir = getProfileRootDir();
  try {
    if (fs.existsSync(profileDir)) {
      fs.rmSync(profileDir, { recursive: true, force: true });
    }
  } catch {}

  if (!pip1.ok && !pip2.ok) {
    return { ok: false, error: 'Failed to uninstall packages.' };
  }

  return { ok: true };
}

function getServerScript(): string {
  const devPath = path.join(app.getAppPath(), '..', 'agent', 'browser_use_server.py');
  if (fs.existsSync(devPath)) return devPath;

  const altPath = path.resolve(__dirname, '..', '..', '..', '..', 'agent', 'browser_use_server.py');
  if (fs.existsSync(altPath)) return altPath;

  return devPath;
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

async function ensureBrowserPageOpen(sessionId = 'default', { skipChromeSync = false } = {}): Promise<{ ok: boolean; error?: string }> {
  try {
    const statusResp = await browserUseFetch('/status', { timeoutMs: 5000 }, sessionId);
    if (statusResp.ok) {
      // Run Chrome sync in background — don't block the browser from being used
      // Skip during prewarm to avoid launching a browser window on app startup
      if (!skipChromeSync) {
        ensureChromeSyncFresh(sessionId).catch(() => {});
      }
      return { ok: true };
    }
    const errText = await statusResp.text().catch(() => '');
    return { ok: false, error: `Browser status check failed: ${statusResp.status} ${errText}` };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Browser status check failed' };
  }
}

export async function startBrowserUseServer(sessionId = 'default', { skipChromeSync = false } = {}): Promise<{ ok: boolean; error?: string }> {
  const runtime = await getRuntime(sessionId);
  if (runtime.process && !runtime.process.killed) {
    const alive = await isBrowserUseAlive(sessionId);
    if (alive) {
      const opened = await ensureBrowserPageOpen(sessionId, { skipChromeSync });
      return opened.ok ? { ok: true } : opened;
    }
    try { runtime.process.kill(); } catch {}
    runtime.process = null;
    runtime.ready = false;
  }

  if (await isBrowserUseAlive(sessionId)) {
    runtime.ready = true;
    const opened = await ensureBrowserPageOpen(sessionId, { skipChromeSync });
    return opened.ok ? { ok: true } : opened;
  }

  await killPortProcess(runtime.port);
  await new Promise((r) => setTimeout(r, 500));

  const script = getServerScript();
  const profileDir = getProfileDir(sessionId);

  if (!fs.existsSync(script)) {
    return { ok: false, error: `Server script not found: ${script}` };
  }

  let earlyStderr = '';

  try {
    runtime.process = spawn(getPythonCmd(), [script], {
      env: {
        ...process.env,
        BROWSER_USE_PORT: String(runtime.port),
        BROWSER_USE_PROFILE_DIR: profileDir,
        BROWSER_USE_AUTH_TOKEN,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    runtime.process.on('exit', (code) => {
      console.warn(`[browser-use-server:${runtime.sessionId}] exited with code ${code}`);
      runtime.process = null;
      runtime.ready = false;
      runtime.setupPromise = null;
      runtime.chromeSyncPromise = null;
    });

    runtime.process.stdout?.on('data', (data: Buffer) => {
      const msg = data.toString();
      console.log(`[browser-use-server:${runtime.sessionId}]`, msg.trim());
      if (msg.includes('Starting on') || msg.includes('Running on')) runtime.ready = true;
    });

    runtime.process.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      console.warn(`[browser-use-server:${runtime.sessionId}]`, msg);
      earlyStderr += msg + '\n';
    });

    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 500));

      if (!runtime.process || runtime.process.exitCode !== null) {
        const errMsg = earlyStderr.trim().slice(0, 400) || 'Server crashed on startup';
        return { ok: false, error: errMsg };
      }

      if (await isBrowserUseAlive(sessionId)) {
        runtime.ready = true;
        const opened = await ensureBrowserPageOpen(sessionId, { skipChromeSync });
        return opened.ok ? { ok: true } : opened;
      }
    }

    const errMsg = earlyStderr.trim().slice(0, 400) || 'Server did not respond within 15 seconds';
    return { ok: false, error: errMsg };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Failed to start browser-use server' };
  }
}

export async function stopBrowserUseServer(sessionId = 'default'): Promise<{ ok: boolean }> {
  const runtime = await getRuntime(sessionId);
  if (runtime.process && !runtime.process.killed) {
    runtime.process.kill();
    runtime.process = null;
  }
  runtime.ready = false;
  runtime.setupPromise = null;
  runtime.chromeSyncPromise = null;
  runtime.lastChromeSyncAt = 0;
  runtime.lastChromeSyncKey = '';
  return { ok: true };
}

async function stopAllBrowserUseServers(): Promise<void> {
  await Promise.all(Array.from(browserUseRuntimes.values()).map(async (runtime) => {
    if (runtime.process && !runtime.process.killed) {
      runtime.process.kill();
    }
    runtime.process = null;
    runtime.ready = false;
    runtime.setupPromise = null;
    runtime.chromeSyncPromise = null;
    runtime.lastChromeSyncAt = 0;
    runtime.lastChromeSyncKey = '';
  }));
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

async function withServer<T>(
  label: string,
  args: any,
  fn: (sessionId: string) => Promise<T>,
): Promise<T | { ok: false; error: string }> {
  const sessionId = getBrowserUseSessionId(args);
  const ready = await ensureReady(sessionId);
  if (!ready.ok) return { ok: false, error: `Browser not available: ${ready.error || 'setup failed'}` };
  try {
    return await fn(sessionId);
  } catch (err: any) {
    return { ok: false, error: err.message || `${label} failed` };
  }
}

/**
 * Pre-warm the browser-use server in the background on app startup.
 * This starts the Python server process so the first browser tool call is fast.
 * Non-blocking — fire and forget. If it fails, the normal lazy setup will handle it.
 */
export async function prewarmBrowserUseServer(): Promise<void> {
  try {
    // Only pre-warm if we have cached install check or can quickly verify
    // skipChromeSync: true — prewarm only starts the HTTP server process,
    // it must NOT trigger chrome sync which would launch a browser window
    if (_installCheckResult?.ok) {
      const runtime = await getRuntime('default');
      if (!runtime.process || runtime.process.killed) {
        console.log('[browser-use] Pre-warming server...');
        startBrowserUseServer('default', { skipChromeSync: true }).catch(() => {});
      }
    } else {
      // Do a quick Python check (just version, not full import), then start if available
      const hasPython = await checkPythonAvailable();
      if (hasPython) {
        // Run full install check in background (caches result for later)
        installBrowserUse().then((result) => {
          if (result.ok) {
            startBrowserUseServer('default', { skipChromeSync: true }).catch(() => {});
          }
        }).catch(() => {});
      }
    }
  } catch {
    // Pre-warming is best-effort
  }
}

export async function execBrowserUseStatus(args: any, _ctx: RouterContext): Promise<any> {
  const sessionId = getBrowserUseSessionId(args);
  const serverAlive = await isBrowserUseAlive(sessionId);
  const settings = loadSettings();
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
          chromeSyncSettings: {
            chromeSyncEnabled: settings.chromeSyncEnabled !== false,
            chromeSyncBrowserName: settings.chromeSyncBrowserName || 'Chrome',
            chromeSyncProfileName: settings.chromeSyncProfileName || 'Default',
            chromeSyncProfilePath: settings.chromeSyncProfilePath || null,
            chromeSyncUserDataDir: settings.chromeSyncUserDataDir || null,
          },
        };
      }
    } catch {}
  }

  const hasPython = await checkPythonAvailable();
  const installed = hasPython ? await checkBrowserUseInstalled() : false;

  return {
    ok: true,
    installed,
    running: false,
    serverAlive: false,
    hasPython,
    mode: 'headed',
    profile: 'default',
    profileDir: String(getProfileDir(sessionId)),
    sessionId,
    chromeSyncSettings: {
      chromeSyncEnabled: settings.chromeSyncEnabled !== false,
      chromeSyncBrowserName: settings.chromeSyncBrowserName || 'Chrome',
      chromeSyncProfileName: settings.chromeSyncProfileName || 'Default',
      chromeSyncProfilePath: settings.chromeSyncProfilePath || null,
      chromeSyncUserDataDir: settings.chromeSyncUserDataDir || null,
    },
  };
}

export async function execBrowserUseConfigure(args: any, _ctx: RouterContext): Promise<any> {
  return withServer('Configure', args, async (sessionId) => {
    const resp = await browserUseFetch('/configure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: args?.mode,
        cdp_url: args?.cdp_url,
        profile: args?.profile,
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
  ctx.logFn?.('[browser_use_task] Disabled; use browser_use_execute_script or a browser-use subagent instead');
  return {
    ok: false,
    error: 'browser_use_task is disabled. Use browser_use_execute_script for complex page logic or launch a browser-use subagent for autonomous multi-step browsing.',
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

  return withServer('Navigation', args, async (sessionId) => {
    const resp = await browserUseFetch('/navigate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        wait_until: args?.wait_until,
        timeout: args?.timeout,
        wait_for_selector: args?.wait_for_selector,
      }),
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
        key,
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
      body: JSON.stringify({ full_page: args?.full_page }),
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
        mode: args?.mode,
        max_length: args?.max_length,
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

export async function execBrowserUseSyncChrome(args: any, _ctx: RouterContext): Promise<any> {
  return withServer('SyncChrome', args, async (sessionId) => {
    const resp = await browserUseFetch('/sync-chrome', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: args?.action || 'sync',
        browser: args?.browser,
        browser_name: args?.browser_name,
        profile_name: args?.profile_name,
        profile_path: args?.profile_path,
        user_data_dir: args?.user_data_dir,
        force_clone: args?.force_clone,
        restart_browser: args?.restart_browser,
      }),
      timeoutMs: 60000,
    }, sessionId);
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { ok: false, error: `Chrome sync failed: ${resp.status} ${errText}` };
    }
    return await resp.json();
  });
}

export async function execBrowserUseListChromeProfiles(args: any, _ctx: RouterContext): Promise<any> {
  return withServer('ListChromeProfiles', args, async (sessionId) => {
    const resp = await browserUseFetch('/sync-chrome', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list_profiles' }),
      timeoutMs: 15000,
    }, sessionId);
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { ok: false, error: `List profiles failed: ${resp.status} ${errText}` };
    }
    return await resp.json();
  });
}

async function autoSyncChromeCookies(sessionId = 'default'): Promise<void> {
  const settings = loadSettings();
  if ((settings as any).chromeSyncEnabled === false) return;

  try {
    const resp = await browserUseFetch('/sync-chrome', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'sync',
        browser_name: (settings as any).chromeSyncBrowserName || 'Chrome',
        profile_name: (settings as any).chromeSyncProfileName || 'Default',
        profile_path: (settings as any).chromeSyncProfilePath || undefined,
        user_data_dir: (settings as any).chromeSyncUserDataDir || undefined,
      }),
      timeoutMs: 60000,
    }, sessionId);
    if (resp.ok) {
      const data = await resp.json();
      console.log(`[chrome-sync:${sessionId}] Auto-synced ${data.synced ?? 0} cookies from Chrome`);
    } else {
      console.warn(`[chrome-sync:${sessionId}] Auto-sync failed:`, await resp.text().catch(() => ''));
    }
  } catch (err: any) {
    console.warn(`[chrome-sync:${sessionId}] Auto-sync error:`, err.message);
  }
}

async function ensureChromeSyncFresh(sessionId = 'default', force = false): Promise<void> {
  const runtime = await getRuntime(sessionId);
  const settings = loadSettings();
  if ((settings as any).chromeSyncEnabled === false) return;

  const syncKey = JSON.stringify({
    enabled: settings.chromeSyncEnabled !== false,
    browser: settings.chromeSyncBrowserName || 'Chrome',
    profile: settings.chromeSyncProfileName || 'Default',
    profilePath: settings.chromeSyncProfilePath || null,
    userDataDir: settings.chromeSyncUserDataDir || null,
  });
  const now = Date.now();
  if (!force && runtime.chromeSyncPromise) {
    await runtime.chromeSyncPromise;
    return;
  }
  if (!force && runtime.lastChromeSyncKey === syncKey && now - runtime.lastChromeSyncAt < CHROME_SYNC_MIN_INTERVAL_MS) {
    return;
  }

  runtime.lastChromeSyncKey = syncKey;
  runtime.lastChromeSyncAt = now;
  runtime.chromeSyncPromise = autoSyncChromeCookies(sessionId).finally(() => {
    runtime.chromeSyncPromise = null;
  });
  await runtime.chromeSyncPromise;
}

export async function execBrowserUseHover(args: any, _ctx: RouterContext): Promise<any> {
  return withServer('Hover', args, async (sessionId) => {
    const resp = await browserUseFetch('/hover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
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
        selector: args?.selector,
        value: args?.value,
        label: args?.label,
        index: args?.index,
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

export async function execBrowserUseGetInteractiveElements(args: any, _ctx: RouterContext): Promise<any> {
  return withServer('GetInteractiveElements', args, async (sessionId) => {
    const resp = await browserUseFetch('/get_interactive_elements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wait_for_selector: args?.wait_for_selector,
        wait_timeout: args?.wait_timeout,
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
    const resp = await browserUseFetch('/fill_form', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: args?.fields,
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

export async function execBrowserUseWaitFor(args: any, _ctx: RouterContext): Promise<any> {
  return withServer('WaitFor', args, async (sessionId) => {
    const timeoutRaw = Number(args?.timeout ?? 10000);
    const timeoutMs = Number.isFinite(timeoutRaw) ? Math.max(500, Math.min(60000, Math.floor(timeoutRaw))) : 10000;
    const resp = await browserUseFetch('/wait_for', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
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

export async function execBrowserUseClose(args: any, _ctx: RouterContext): Promise<any> {
  const sessionId = getBrowserUseSessionId(args);
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
