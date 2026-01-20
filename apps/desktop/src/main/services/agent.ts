import { app } from "electron";
import { spawn, ChildProcess } from "child_process";
import path from "path";
import * as fs from "fs";
import * as net from "net";
import { isDev } from "../env";
import logger from "../utils/logger";

interface AgentInstance {
  process: ChildProcess;
  port: number;
  id: string;
}

const agents = new Map<string, AgentInstance>();
const DEFAULT_PORT = 8765;

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
  const name = process.platform === "win32" ? "Stuard AI Agent.exe" : "stuard-agent";
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
    // Try to kill any stray processes from previous runs just in case
    if (process.platform === "win32") {
      try { 
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
