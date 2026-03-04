import { app } from 'electron';
import { ChildProcess, spawn, execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import { randomBytes } from 'crypto';
import { RouterContext } from '../types';

const BROWSER_USE_PORT = 18082;
const BROWSER_USE_DEFAULT_HOST = `http://localhost:${BROWSER_USE_PORT}`;
const BROWSER_USE_AUTH_HEADER = 'x-stuard-browser-token';
const BROWSER_USE_AUTH_TOKEN = process.env.BROWSER_USE_AUTH_TOKEN || randomBytes(24).toString('hex');

let serverProcess: ChildProcess | null = null;
let serverReady = false;

function getBrowserUseHost(): string {
  return process.env.BROWSER_USE_HOST || BROWSER_USE_DEFAULT_HOST;
}

function getProfileDir(): string {
  return path.join(app.getPath('userData'), 'browser-profiles');
}

async function browserUseFetch(
  endpoint: string,
  options?: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  const { timeoutMs = 30000, ...fetchOpts } = options || {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = new Headers(fetchOpts.headers || undefined);
    headers.set(BROWSER_USE_AUTH_HEADER, BROWSER_USE_AUTH_TOKEN);
    return await fetch(`${getBrowserUseHost()}${endpoint}`, {
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

// ---------------------------------------------------------------------------
// Installation — fully automatic, no terminal needed
// ---------------------------------------------------------------------------

async function checkPythonAvailable(): Promise<boolean> {
  const { ok } = await runCmd(getPythonCmd(), ['--version'], 10000);
  return ok;
}

async function checkBrowserUseInstalled(): Promise<boolean> {
  const { ok } = await runCmd(getPythonCmd(), ['-c', 'import browser_use; print("ok")'], 15000);
  return ok;
}

async function checkBrowserUseChatOpenAIAvailable(): Promise<boolean> {
  const { ok } = await runCmd(getPythonCmd(), ['-c', 'from browser_use import ChatOpenAI; print("ok")'], 15000);
  return ok;
}

async function checkPlaywrightChromium(): Promise<boolean> {
  const { ok } = await runCmd(getPythonCmd(), ['-c', 'from playwright.sync_api import sync_playwright; print("ok")'], 15000);
  return ok;
}

export async function installBrowserUse(): Promise<{ ok: boolean; error?: string; step?: string }> {
  if (!(await checkPythonAvailable())) {
    return { ok: false, error: 'Python is not installed. Please install Python 3.11+ from python.org first.', step: 'python' };
  }

  if (!(await checkBrowserUseInstalled())) {
    const pip = await runCmd(getPythonCmd(), ['-m', 'pip', 'install', 'browser-use', 'aiohttp'], 300000);
    if (!pip.ok) {
      return { ok: false, error: `Failed to install browser-use: ${pip.stderr.slice(0, 300)}`, step: 'pip' };
    }
  }

  if (!(await checkPlaywrightChromium())) {
    const pipPw = await runCmd(getPythonCmd(), ['-m', 'pip', 'install', 'playwright'], 300000);
    if (!pipPw.ok) {
      return { ok: false, error: `Failed to install playwright: ${pipPw.stderr.slice(0, 300)}`, step: 'playwright-pip' };
    }
    const pw = await runCmd(getPythonCmd(), ['-m', 'playwright', 'install', 'chromium'], 300000);
    if (!pw.ok) {
      return { ok: false, error: `Failed to install Chromium browser: ${pw.stderr.slice(0, 300)}`, step: 'playwright' };
    }
  }

  return { ok: true };
}

async function ensureBrowserUseTaskDependencies(): Promise<{ ok: boolean; error?: string }> {
  if (!(await checkPythonAvailable())) {
    return { ok: false, error: 'Python is not installed. Please install Python 3.11+ from python.org first.' };
  }
  // browser_use.ChatOpenAI is bundled with modern browser-use and avoids
  // requiring BROWSER_USE_API_KEY for local Stuard proxy-based calls.
  if (await checkBrowserUseChatOpenAIAvailable()) {
    return { ok: true };
  }

  const pip = await runCmd(getPythonCmd(), ['-m', 'pip', 'install', '--upgrade', 'browser-use'], 300000);
  if (!pip.ok) {
    return { ok: false, error: `Failed to install task dependency browser-use: ${pip.stderr.slice(0, 300)}` };
  }
  return (await checkBrowserUseChatOpenAIAvailable())
    ? { ok: true }
    : { ok: false, error: 'browser-use is installed but missing ChatOpenAI support. Please upgrade browser-use.' };
}

// ---------------------------------------------------------------------------
// Uninstall
// ---------------------------------------------------------------------------

export async function uninstallBrowserUse(): Promise<{ ok: boolean; error?: string }> {
  await stopBrowserUseServer();

  const hasPython = await checkPythonAvailable();
  if (!hasPython) return { ok: true };

  const pip1 = await runCmd(getPythonCmd(), ['-m', 'pip', 'uninstall', '-y', 'browser-use'], 60000);
  const pip2 = await runCmd(getPythonCmd(), ['-m', 'pip', 'uninstall', '-y', 'playwright'], 60000);

  const profileDir = getProfileDir();
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

// ---------------------------------------------------------------------------
// Process management
// ---------------------------------------------------------------------------

function getServerScript(): string {
  const devPath = path.join(app.getAppPath(), '..', 'agent', 'browser_use_server.py');
  if (fs.existsSync(devPath)) return devPath;

  const altPath = path.resolve(__dirname, '..', '..', '..', '..', 'agent', 'browser_use_server.py');
  if (fs.existsSync(altPath)) return altPath;

  return devPath;
}

async function killPortProcess(): Promise<void> {
  if (process.platform === 'win32') {
    try {
      const { stdout } = await runCmd('netstat', ['-ano'], 10000);
      const lines = stdout.split('\n');
      for (const line of lines) {
        if (line.includes(`:${BROWSER_USE_PORT}`) && line.includes('LISTENING')) {
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
      const { stdout } = await runCmd('lsof', ['-ti', `:${BROWSER_USE_PORT}`], 5000);
      const pids = stdout.trim().split('\n').filter(Boolean);
      for (const pid of pids) {
        await runCmd('kill', ['-9', pid], 3000);
      }
    } catch {}
  }
}

async function ensureBrowserPageOpen(): Promise<{ ok: boolean; error?: string }> {
  try {
    // If server is reachable, let tool handlers lazily open/navigate pages.
    // Avoid force-navigating to about:blank, which creates noisy extra tabs.
    const statusResp = await browserUseFetch('/status', { timeoutMs: 5000 });
    if (statusResp.ok) {
      return { ok: true };
    }
    const errText = await statusResp.text().catch(() => '');
    return { ok: false, error: `Browser status check failed: ${statusResp.status} ${errText}` };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Browser status check failed' };
  }
}

export async function startBrowserUseServer(): Promise<{ ok: boolean; error?: string }> {
  if (serverProcess && !serverProcess.killed) {
    const alive = await isBrowserUseAlive();
    if (alive) {
      const opened = await ensureBrowserPageOpen();
      return opened.ok ? { ok: true } : opened;
    }
    try { serverProcess.kill(); } catch {}
    serverProcess = null;
    serverReady = false;
  }

  if (await isBrowserUseAlive()) {
    serverReady = true;
    const opened = await ensureBrowserPageOpen();
    return opened.ok ? { ok: true } : opened;
  }

  await killPortProcess();
  await new Promise((r) => setTimeout(r, 500));

  const script = getServerScript();
  const profileDir = getProfileDir();

  if (!fs.existsSync(script)) {
    return { ok: false, error: `Server script not found: ${script}` };
  }

  let earlyStderr = '';

  try {
    serverProcess = spawn(getPythonCmd(), [script], {
      env: {
        ...process.env,
        BROWSER_USE_PORT: String(BROWSER_USE_PORT),
        BROWSER_USE_PROFILE_DIR: profileDir,
        BROWSER_USE_AUTH_TOKEN,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    serverProcess.on('exit', (code) => {
      console.warn(`[browser-use-server] exited with code ${code}`);
      serverProcess = null;
      serverReady = false;
    });

    serverProcess.stdout?.on('data', (data: Buffer) => {
      const msg = data.toString();
      console.log('[browser-use-server]', msg.trim());
      if (msg.includes('Starting on') || msg.includes('Running on')) serverReady = true;
    });

    serverProcess.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      console.warn('[browser-use-server]', msg);
      earlyStderr += msg + '\n';
    });

    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 500));

      if (!serverProcess || serverProcess.exitCode !== null) {
        const errMsg = earlyStderr.trim().slice(0, 400) || 'Server crashed on startup';
        return { ok: false, error: errMsg };
      }

      if (await isBrowserUseAlive()) {
        serverReady = true;
        const opened = await ensureBrowserPageOpen();
        return opened.ok ? { ok: true } : opened;
      }
    }

    const errMsg = earlyStderr.trim().slice(0, 400) || 'Server did not respond within 15 seconds';
    return { ok: false, error: errMsg };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Failed to start browser-use server' };
  }
}

export async function stopBrowserUseServer(): Promise<{ ok: boolean }> {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
    serverProcess = null;
  }
  serverReady = false;
  return { ok: true };
}

async function isBrowserUseAlive(): Promise<boolean> {
  try {
    const resp = await browserUseFetch('/status', { timeoutMs: 3000 });
    return resp.ok;
  } catch {
    return false;
  }
}

async function getBrowserUseServerStatus(): Promise<any | null> {
  try {
    const resp = await browserUseFetch('/status', { timeoutMs: 5000 });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

export async function setupBrowserUse(): Promise<{ ok: boolean; error?: string; step?: string; alreadyRunning?: boolean }> {
  const status = await getBrowserUseServerStatus();
  if (status) {
    // Server can be alive but unusable (missing browser_use package in that Python env).
    if (!status.installed) {
      const install = await installBrowserUse();
      if (!install.ok) return install;
      await stopBrowserUseServer();
      const started = await startBrowserUseServer();
      return started.ok ? { ok: true, alreadyRunning: true } : started;
    }
    const opened = await ensureBrowserPageOpen();
    return opened.ok ? { ok: true, alreadyRunning: true } : opened;
  }

  const install = await installBrowserUse();
  if (!install.ok) return install;

  return await startBrowserUseServer();
}

// ---------------------------------------------------------------------------
// Transparent auto-setup: any tool that needs the server calls this first.
// The user never has to click "start" — it just works.
// ---------------------------------------------------------------------------

let _setupPromise: Promise<{ ok: boolean; error?: string }> | null = null;

async function ensureReady(): Promise<{ ok: boolean; error?: string }> {
  const status = await getBrowserUseServerStatus();
  if (status?.installed) {
    const opened = await ensureBrowserPageOpen();
    if (opened.ok) return { ok: true };
  }

  // Coalesce concurrent setup calls so we don't spawn multiple processes
  if (!_setupPromise) {
    _setupPromise = setupBrowserUse().finally(() => { _setupPromise = null; });
  }
  return _setupPromise;
}

async function withServer<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T | { ok: false; error: string }> {
  const ready = await ensureReady();
  if (!ready.ok) return { ok: false, error: `Browser not available: ${ready.error || 'setup failed'}` };
  try {
    return await fn();
  } catch (err: any) {
    return { ok: false, error: err.message || `${label} failed` };
  }
}

// ---------------------------------------------------------------------------
// Tool executors
// ---------------------------------------------------------------------------

export async function execBrowserUseStatus(_args: any, _ctx: RouterContext): Promise<any> {
  const serverAlive = await isBrowserUseAlive();
  if (serverAlive) {
    try {
      const resp = await browserUseFetch('/status', { timeoutMs: 5000 });
      if (resp.ok) {
        const data = await resp.json();
        return { ok: true, ...data, serverAlive: true };
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
    profileDir: String(getProfileDir()),
  };
}

export async function execBrowserUseConfigure(args: any, _ctx: RouterContext): Promise<any> {
  return withServer('Configure', async () => {
    const resp = await browserUseFetch('/configure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: args?.mode,
        cdp_url: args?.cdp_url,
        profile: args?.profile,
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { ok: false, error: `Configure failed: ${resp.status} ${errText}` };
    }
    return await resp.json();
  });
}

export async function execBrowserUseTask(args: any, ctx: RouterContext): Promise<any> {
  const task = String(args?.task || '').trim();
  if (!task) return { ok: false, error: 'task is required' };
  ctx.logFn?.(`[browser_use_task] Running (${task.length} chars)`);

  const deps = await ensureBrowserUseTaskDependencies();
  if (!deps.ok) return { ok: false, error: deps.error || 'Browser Use task dependencies are missing' };

  return withServer('Task', async () => {
    const maxStepsRaw = Number(args?.max_steps ?? 25);
    const max_steps = Number.isFinite(maxStepsRaw) ? Math.max(1, Math.min(120, Math.floor(maxStepsRaw))) : 25;
    const model = typeof args?.model === 'string' && args.model.trim()
      ? args.model.trim()
      : 'google/gemini-3-flash-preview';
    const payload: Record<string, any> = {
      task,
      max_steps,
      ...(model ? { model } : {}),
    };
    if (args?._llm_proxy_url) payload._llm_proxy_url = args._llm_proxy_url;
    if (args?._llm_session_token) payload._llm_session_token = args._llm_session_token;

    const resp = await browserUseFetch('/task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      timeoutMs: 600000,
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { ok: false, error: `Task failed: ${resp.status} ${errText}` };
    }
    return await resp.json();
  });
}

export async function execBrowserUseNavigate(args: any, _ctx: RouterContext): Promise<any> {
  const url = args?.url;
  if (!url) return { ok: false, error: 'url is required' };

  return withServer('Navigation', async () => {
    const resp = await browserUseFetch('/navigate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        wait_until: args?.wait_until,
        timeout: args?.timeout,
        wait_for_selector: args?.wait_for_selector,
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { ok: false, error: `Navigation failed: ${resp.status} ${errText}` };
    }
    return await resp.json();
  });
}

export async function execBrowserUseClick(args: any, _ctx: RouterContext): Promise<any> {
  return withServer('Click', async () => {
    const resp = await browserUseFetch('/click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        selector: args?.selector,
        text: args?.text,
        exact: args?.exact,
        timeout: args?.timeout,
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { ok: false, error: `Click failed: ${resp.status} ${errText}` };
    }
    return await resp.json();
  });
}

export async function execBrowserUseType(args: any, _ctx: RouterContext): Promise<any> {
  return withServer('Type', async () => {
    const resp = await browserUseFetch('/type', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        selector: args?.selector,
        text: args?.text ?? '',
        clear: args?.clear,
        timeout: args?.timeout,
      }),
    });
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

  return withServer('PressKey', async () => {
    const resp = await browserUseFetch('/press_key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key,
        selector: args?.selector,
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { ok: false, error: `Press key failed: ${resp.status} ${errText}` };
    }
    return await resp.json();
  });
}

export async function execBrowserUseScreenshot(args: any, _ctx: RouterContext): Promise<any> {
  return withServer('Screenshot', async () => {
    const resp = await browserUseFetch('/screenshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_page: args?.full_page }),
      timeoutMs: 15000,
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { ok: false, error: `Screenshot failed: ${resp.status} ${errText}` };
    }
    return await resp.json();
  });
}

export async function execBrowserUseContent(args: any, _ctx: RouterContext): Promise<any> {
  return withServer('Content', async () => {
    const resp = await browserUseFetch('/content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: args?.mode,
        max_length: args?.max_length,
        wait_for_selector: args?.wait_for_selector,
        wait_timeout: args?.wait_timeout,
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { ok: false, error: `Content failed: ${resp.status} ${errText}` };
    }
    return await resp.json();
  });
}

export async function execBrowserUseScroll(args: any, _ctx: RouterContext): Promise<any> {
  return withServer('Scroll', async () => {
    const resp = await browserUseFetch('/scroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        direction: args?.direction,
        amount: args?.amount,
        selector: args?.selector,
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { ok: false, error: `Scroll failed: ${resp.status} ${errText}` };
    }
    return await resp.json();
  });
}

export async function execBrowserUseTabs(args: any, _ctx: RouterContext): Promise<any> {
  return withServer('Tabs', async () => {
    const resp = await browserUseFetch('/tabs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: args?.action,
        index: args?.index,
        url: args?.url,
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { ok: false, error: `Tabs failed: ${resp.status} ${errText}` };
    }
    return await resp.json();
  });
}

export async function execBrowserUseCookies(args: any, _ctx: RouterContext): Promise<any> {
  return withServer('Cookies', async () => {
    const resp = await browserUseFetch('/cookies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: args?.action,
        cookies: args?.cookies,
        urls: args?.urls,
        path: args?.path,
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { ok: false, error: `Cookies failed: ${resp.status} ${errText}` };
    }
    return await resp.json();
  });
}

export async function execBrowserUseClose(_args: any, _ctx: RouterContext): Promise<any> {
  if (!(await isBrowserUseAlive())) return { ok: true, closed: true };
  try {
    const resp = await browserUseFetch('/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      timeoutMs: 10000,
    });
    if (!resp.ok) {
      return { ok: false, error: 'Close failed' };
    }
    return await resp.json();
  } catch (err: any) {
    return { ok: false, error: err.message || 'Close failed' };
  }
}
