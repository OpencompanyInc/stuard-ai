import { app } from "electron";
import { spawn, ChildProcess } from "child_process";
import path from "path";
import * as fs from "fs";
import * as net from "net";
import { isDev } from "../env";
import logger from "../utils/logger";
import { syncAgentMediaPathConfig, getMediaLibraryRoot } from "./media-library";

interface AgentInstance {
  process: ChildProcess;
  port: number;
  id: string;
}

const agents = new Map<string, AgentInstance>();
const DEFAULT_PORT = 8765;
const AGENT_READY_CACHE_MS = 2000;

let lastAgentReadyCheckAt = 0;
let lastAgentReady = false;

function getAgentHttpUrl() {
  try {
    const raw = String(process.env.AGENT_HTTP || `http://127.0.0.1:${DEFAULT_PORT}`);
    return raw.replace(/\/+$/, "");
  } catch {
    return `http://127.0.0.1:${DEFAULT_PORT}`;
  }
}

function setAgentProcessEnv(port: number) {
  try {
    const host = "127.0.0.1";
    if (!port || port <= 0) return;
    process.env.AGENT_HOST = host;
    process.env.AGENT_PORT = String(port);
    process.env.AGENT_HTTP = `http://${host}:${port}`;
    process.env.AGENT_WS_URL = `ws://${host}:${port}/ws`;
    process.env.AGENT_WS = process.env.AGENT_WS_URL;
  } catch { }
}

function getAgentBinaryPath() {
  const base = process.resourcesPath;
  const name = process.platform === "win32" ? "Stuard AI.exe" : "stuard-agent";
  return path.join(base, "agent", name);
}

async function getFreePort(startPort: number): Promise<number> {
  const isPortAvailable = (port: number) => {
    return new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.listen(port, '127.0.0.1', () => {
        server.close(() => resolve(true));
      });
      server.on('error', () => resolve(false));
    });
  };

  let port = startPort;
  while (!(await isPortAvailable(port))) {
    port++;
    if (port > 65535) throw new Error("No free ports available");
  }
  return port;
}

export async function startAgent(id: string = 'default', port?: number): Promise<number> {
  logger.info(`startAgent called: id=${id}, port=${port}`);
  
  // If already running, return port
  if (agents.has(id)) {
    logger.info(`Agent ${id} already running on port ${agents.get(id)!.port}`);
    const existingPort = agents.get(id)!.port;
    setAgentProcessEnv(existingPort);
    return existingPort;
  }

  // In dev mode, we don't spawn the binary, but we assume default is running
  if (isDev) {
    logger.info("Dev mode - not spawning agent binary");
    const p = id === 'default' ? DEFAULT_PORT : 0;
    setAgentProcessEnv(p);
    return p;
  }

  const bin = getAgentBinaryPath();
  logger.info(`Agent binary path: ${bin}`);
  logger.info(`Agent binary exists: ${fs.existsSync(bin)}`);
  
  if (!fs.existsSync(bin)) {
    logger.error(`Agent binary not found at ${bin}`);
    return 0;
  }

  let targetPort = port;
  if (!targetPort) {
    // If default, try default port first, else find free
    if (id === 'default') {
        targetPort = (await getFreePort(DEFAULT_PORT)) === DEFAULT_PORT ? DEFAULT_PORT : await getFreePort(DEFAULT_PORT + 1);
    } else {
        targetPort = await getFreePort(DEFAULT_PORT + 1);
    }
  }

  const env = { ...process.env } as NodeJS.ProcessEnv;

  // Cap BLAS/OpenMP thread pools for the Python agent. numpy bundles OpenBLAS,
  // which reserves a per-thread buffer pool sized to the logical CPU count and
  // commits hundreds of MB it never touches (the bulk of the agent's reported
  // RAM). The agent only does small vector math, so 1 thread is plenty. Don't
  // clobber an explicit override from the parent environment.
  for (const v of ["OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS", "VECLIB_MAXIMUM_THREADS"]) {
    if (!env[v]) env[v] = "1";
  }
  if (!env.OPENBLAS_MAIN_FREE) env.OPENBLAS_MAIN_FREE = "1";

  syncAgentMediaPathConfig();
  env.STUARD_MEDIA_DIR = getMediaLibraryRoot();
  env.STUARD_AI_MEDIA_DIR = env.STUARD_MEDIA_DIR;
  if (process.env.CLOUD_AI_WS) {
    env.CLOUD_AI_WS = process.env.CLOUD_AI_WS;
  } else {
    const httpBaseRaw = String(
      process.env.CLOUD_AI_HTTP ||
      process.env.CLOUD_PUBLIC_URL ||
      process.env.VITE_CLOUD_AI_URL ||
      ""
    );
    const httpBase = httpBaseRaw.replace(/\/+$/, "");
    if (httpBase) {
      try {
        let wsBase = httpBase;
        if (wsBase.startsWith("https://")) {
          wsBase = "wss://" + wsBase.slice("https://".length);
        } else if (wsBase.startsWith("http://")) {
          wsBase = "ws://" + wsBase.slice("http://".length);
        } else if (!wsBase.startsWith("ws://") && !wsBase.startsWith("wss://")) {
          wsBase = "wss://" + wsBase.replace(/^\/+/, "");
        }
        env.CLOUD_AI_WS = wsBase.endsWith("/ws") ? wsBase : `${wsBase}/ws`;
      } catch {
        // If anything goes wrong, leave CLOUD_AI_WS unset and let the agent default apply (dev/local only)
      }
    }
  }

  if (!env.AGENT_HOST) env.AGENT_HOST = "127.0.0.1";
  env.AGENT_PORT = targetPort.toString();

  // Point the agent at sidecar binaries living in userData/integrations/.
  // These are downloaded on demand by desktop main (mediapipe-service.ts,
  // browser-use.ts) and live outside the install dir so they survive
  // updates and aren't bundled in the release.
  try {
    const integrationsBase = path.join(app.getPath("userData"), "integrations");
    const mediapipeBin = path.join(
      integrationsBase,
      "mediapipe",
      process.platform === "win32" ? "stuard-mediapipe.exe" : "stuard-mediapipe",
    );
    if (!env.STUARD_MEDIAPIPE_BINARY && fs.existsSync(mediapipeBin)) {
      env.STUARD_MEDIAPIPE_BINARY = mediapipeBin;
    }
  } catch {}

  setAgentProcessEnv(targetPort);

  const cwd = path.join(process.resourcesPath, "agent");
  const logPath = path.join(app.getPath('userData'), `agent-${id}.log`);
  
  logger.info(`Spawning agent: bin=${bin}, port=${targetPort}, cwd=${cwd}`);
  logger.info(`Agent cloud WS: ${env.CLOUD_AI_WS || '(not set, agent will use default)'}`);
  logger.info(`Agent log file: ${logPath}`);
  
  const proc = spawn(bin, [], { env, stdio: "ignore", detached: false, cwd });
  logger.info(`Agent process spawned: pid=${proc.pid}`);
  
  try {
    proc.on('error', (e: any) => {
      logger.error(`Agent ${id} spawn error:`, e);
      try { fs.appendFileSync(logPath, `[spawn:error] ${new Date().toISOString()} ${String(e?.message || e)}\n`); } catch {}
    });
    proc.on('exit', (code: number, signal: NodeJS.Signals | null) => {
      logger.info(`Agent ${id} exited: code=${code}, signal=${signal}`);
      try { fs.appendFileSync(logPath, `[spawn:exit] ${new Date().toISOString()} code=${code} signal=${signal || ''}\n`); } catch {}
      if (agents.get(id)?.process === proc) {
        agents.delete(id);
      }
    });
  } catch (e) {
    logger.error(`Failed to setup agent event handlers:`, e);
  }
  
  try { if ((proc as any).unref) (proc as any).unref(); } catch {}
  
  agents.set(id, { process: proc, port: targetPort, id });
  return targetPort;
}

export async function startAgentIfNeeded() {
  logger.info("startAgentIfNeeded called");
  // Start default agent
  try {
    const p = await startAgent('default', DEFAULT_PORT);
    logger.info(`Default agent started on port ${p}`);
  } catch (e) {
    logger.error("Failed to start default agent:", e);
  }
}

export async function checkAgentReady(options: { timeoutMs?: number; useCache?: boolean } = {}): Promise<boolean> {
  const timeoutMs = Math.max(250, Number(options.timeoutMs || 2000));
  const useCache = options.useCache !== false;
  const now = Date.now();

  if (useCache && lastAgentReady && now - lastAgentReadyCheckAt < AGENT_READY_CACHE_MS) {
    return true;
  }

  try {
    const resp = await fetch(`${getAgentHttpUrl()}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
    });
    lastAgentReady = resp.ok;
    lastAgentReadyCheckAt = now;
    return lastAgentReady;
  } catch {
    lastAgentReady = false;
    lastAgentReadyCheckAt = now;
    return false;
  }
}

export async function waitForAgentReady(maxWaitMs: number = 10000, intervalMs: number = 1000): Promise<boolean> {
  const deadline = Date.now() + Math.max(0, Number(maxWaitMs || 0));
  const pollInterval = Math.max(250, Number(intervalMs || 1000));

  while (Date.now() < deadline) {
    if (await checkAgentReady({ timeoutMs: Math.min(2000, pollInterval), useCache: false })) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  return await checkAgentReady({ timeoutMs: Math.min(2000, pollInterval), useCache: false });
}

export async function stopAgent(id: string = 'default'): Promise<void> {
  const instance = agents.get(id);
  if (!instance) {
    // Fallback cleanup for legacy/default if not in map but running? 
    // But for default, if we didn't spawn it via map, we might want to do general cleanup
    if (id === 'default') {
         await stopAgentLegacy();
    }
    return;
  }
  
  const proc = instance.process;
  agents.delete(id);

  return new Promise<void>((resolve) => {
    // Safety timeout
    const timer = setTimeout(() => resolve(), 2000);
    
    try {
      proc.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });

      if (process.platform === "win32") {
        try { spawn("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" }); } catch {}
      } else {
        try { proc.kill("SIGTERM"); } catch {}
        // Force kill after small delay if needed
        setTimeout(() => {
             try { proc.kill("SIGKILL"); } catch {}
        }, 1000);
      }
    } catch {
        resolve();
    }
  });
}

async function stopAgentLegacy() {
    // Try to kill any stray agent processes from previous runs.
    // The agent exe is now named "Stuard AI.exe" — same as the main Electron
    // exe — so taskkill /IM alone would also kill the main app. We use
    // PowerShell to filter by ExecutablePath ending in
    // resources\agent\Stuard AI.exe so we only target the agent.
    if (process.platform === "win32") {
      try {
        const psScript = (
          "Get-CimInstance Win32_Process -Filter \"Name='Stuard AI.exe'\" | " +
          "Where-Object { $_.ExecutablePath -like '*\\resources\\agent\\Stuard AI.exe' } | " +
          "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
        );
        spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", psScript], { stdio: "ignore" });
        // Legacy name (pre-rename) — keep these in case the user upgraded
        // from an older install with a leftover process.
        spawn("taskkill", ["/IM", "Stuard AI Agent.exe", "/T", "/F"], { stdio: "ignore" });
        spawn("taskkill", ["/IM", "stuard-agent.exe", "/T", "/F"], { stdio: "ignore" });
        await new Promise(r => setTimeout(r, 500));
      } catch {}
    }
}

export async function stopAllAgents() {
    const promises: Promise<void>[] = [];
    for(const id of agents.keys()) {
        promises.push(stopAgent(id));
    }
    await Promise.allSettled(promises);
    // Also do legacy cleanup on quit just to be safe
    await stopAgentLegacy();
}

export function listAgents() {
    return Array.from(agents.entries()).map(([id, inst]) => ({ id, port: inst.port }));
}
