import { BrowserWindow, app } from 'electron';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import logger from '../../utils/logger';

type WakewordConfig = {
  sensitivity: number;
  cooldown: number;
  triggerCount: number;
  weightsPath: string;
  wakewordDir: string;
};

let wakewordProcess: ChildProcessWithoutNullStreams | null = null;
let activeConfigKey = '';
let lastDetectionAt = 0;

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function getWakewordResourceDir(): string {
  const override = String(process.env.STUARD_WAKEWORD_DIR || '').trim();
  if (override && fs.existsSync(override)) return override;

  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'wakeword');
  }

  return path.resolve(__dirname, '..', '..', 'resources', 'wakeword');
}

function getBundledWakewordExecutable(): string | null {
  const override = String(process.env.STUARD_WAKEWORD_BIN || '').trim();
  if (override && fs.existsSync(override)) return override;

  const exeName = process.platform === 'win32' ? 'stuard-wakeword.exe' : 'stuard-wakeword';
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'agent', exeName)]
    : [
        path.resolve(__dirname, '..', '..', '..', '..', 'dist', exeName),
        path.resolve(__dirname, '..', '..', 'build', 'agent', exeName),
      ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function buildConfig(args: any): WakewordConfig {
  const wakewordDir = String(args?.wakewordDir || '').trim() || getWakewordResourceDir();
  const weightsPath = String(args?.weights || args?.weightsPath || '').trim()
    || path.join(wakewordDir, 'models', 'kws_weights.npz');

  return {
    sensitivity: clampNumber(args?.sensitivity, 0.95, 0.3, 0.99),
    cooldown: clampNumber(args?.cooldown, 1.0, 0.25, 30),
    triggerCount: Math.round(clampNumber(args?.triggerCount ?? args?.trigger_count ?? args?.['trigger-count'], 5, 1, 25)),
    weightsPath,
    wakewordDir,
  };
}

function configKey(config: WakewordConfig): string {
  return JSON.stringify({
    sensitivity: config.sensitivity,
    cooldown: config.cooldown,
    triggerCount: config.triggerCount,
    weightsPath: path.resolve(config.weightsPath),
    wakewordDir: path.resolve(config.wakewordDir),
  });
}

function emitWakewordDetected(payload: Record<string, unknown>) {
  lastDetectionAt = Date.now();
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (!win.isDestroyed()) {
        win.webContents.send('wakeword:detected', payload);
      }
    } catch {}
  }
}

function stopWakewordProcess(): boolean {
  const proc = wakewordProcess;
  wakewordProcess = null;
  activeConfigKey = '';
  if (!proc || proc.killed) return false;
  try {
    proc.kill();
    return true;
  } catch (e) {
    logger.warn('[wakeword] Failed to stop process', e);
    return false;
  }
}

export async function execWakewordStart(args: any): Promise<any> {
  const config = buildConfig(args);
  const key = configKey(config);

  if (wakewordProcess && !wakewordProcess.killed) {
    if (activeConfigKey === key) {
      return { ok: true, running: true, alreadyRunning: true, ...config };
    }
    stopWakewordProcess();
  }

  const scriptPath = path.join(config.wakewordDir, 'listen_numpy.py');
  if (!fs.existsSync(config.weightsPath)) {
    return { ok: false, error: `wakeword weights not found: ${config.weightsPath}` };
  }

  const bundledExe = getBundledWakewordExecutable();
  const command = bundledExe || (process.platform === 'win32' ? 'python' : 'python3');
  const spawnArgs = bundledExe
    ? []
    : [scriptPath];

  if (!bundledExe && !fs.existsSync(scriptPath)) {
    return { ok: false, error: `wakeword listener not found: ${scriptPath}` };
  }

  spawnArgs.push(
    '--weights', config.weightsPath,
    '--sensitivity', String(config.sensitivity),
    '--cooldown', String(config.cooldown),
    '--trigger-count', String(config.triggerCount),
    '--no-status',
  );

  logger.info(`[wakeword] Starting listener: ${command} ${spawnArgs.join(' ')}`);

  const child = spawn(command, spawnArgs, {
    cwd: config.wakewordDir,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
    windowsHide: true,
  });

  wakewordProcess = child;
  activeConfigKey = key;

  let stdoutBuffer = '';
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk.toString('utf8');
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() || '';
    for (const line of lines) {
      const text = line.trim();
      if (!text) continue;
      logger.info(`[wakeword] ${text}`);
      if (text.includes('WAKE WORD DETECTED')) {
        emitWakewordDetected({
          at: new Date().toISOString(),
          line: text,
          sensitivity: config.sensitivity,
          triggerCount: config.triggerCount,
        });
      }
    }
  });

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString('utf8').trim();
    if (text) logger.warn(`[wakeword] ${text}`);
  });

  child.on('error', (e) => {
    logger.error('[wakeword] Listener failed to start', e);
    if (wakewordProcess === child) {
      wakewordProcess = null;
      activeConfigKey = '';
    }
  });

  child.on('exit', (code, signal) => {
    logger.info(`[wakeword] Listener exited code=${code ?? 'null'} signal=${signal ?? 'null'}`);
    if (wakewordProcess === child) {
      wakewordProcess = null;
      activeConfigKey = '';
    }
  });

  return {
    ok: true,
    running: true,
    pid: child.pid,
    executable: bundledExe ? 'bundled' : 'python',
    ...config,
  };
}

export async function execWakewordStop(): Promise<any> {
  const stopped = stopWakewordProcess();
  return { ok: true, running: false, stopped };
}

export async function execWakewordStatus(): Promise<any> {
  return {
    ok: true,
    running: !!wakewordProcess && !wakewordProcess.killed,
    pid: wakewordProcess?.pid || null,
    lastDetectionAt,
  };
}

export function shutdownWakewordListener(): void {
  stopWakewordProcess();
}
