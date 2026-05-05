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
import { VMWorkflowEngine } from './vm-engine';
import { mintVMToken } from './lib/vm-token-mint';

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
  sourceWorkflowId?: string | null;
  triggerBindings?: WorkflowTriggerBinding[];
  /** When provided, skip the GCS download and use this bundle directly. */
  inlineBundle?: any;
}

interface WorkflowTriggerBinding {
  triggerId: string;
  type: string;
  mode?: string | null;
  args?: Record<string, any>;
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
  sourceWorkflowId?: string | null;
  triggerBindings?: WorkflowTriggerBinding[];
  timers?: NodeJS.Timeout[];
  schedule?: string | null;
  timezone?: string;
  runCount?: number;
  lastRunAt?: string | null;
  lastCompletedAt?: string | null;
  lastTriggerSource?: string | null;
}

interface RunningDeployListEntry {
  id: string;
  kind: string;
  name: string;
  pid: number | null;
  status: string;
  autoRestart?: boolean;
  source_workflow_id?: string | null;
  trigger_bindings?: WorkflowTriggerBinding[];
  schedule?: string | null;
  timezone?: string | null;
  run_count?: number;
  last_run_at?: string | null;
  last_completed_at?: string | null;
  last_trigger_source?: string | null;
}

interface ScheduleRuntime {
  cron: string;
  triggerId?: string;
  args?: Record<string, any>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DEPLOY_ROOT = process.env.STUARD_DEPLOY_ROOT || '/home/stuard/deploys';
const MAX_RESTARTS = 5;
const RESTART_DELAY_MS = 3_000;
const MAX_LOG_SIZE = 2 * 1024 * 1024; // 2 MB tail limit
const DOWNLOAD_TIMEOUT_MS = 60_000;
const RETRYABLE_DOWNLOAD_ERROR_CODES = new Set([
  'EAI_AGAIN',
  'ENOTFOUND',
  'ECONNRESET',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ECONNREFUSED',
  'EPIPE',
]);
const DNS_ERROR_CODES = new Set(['EAI_AGAIN', 'ENOTFOUND']);
const RETRYABLE_DOWNLOAD_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Env vars that must NEVER leak into deploy child processes or logs */
const SENSITIVE_ENV_KEYS = new Set([
  'VM_TOKEN_SECRET',
  'STUARD_VM_TOKEN',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GCP_KEY_FILE',
]);

export function isRetryableDownloadError(error: any): boolean {
  const code = String(error?.code || error?.cause?.code || '').toUpperCase();
  const statusCode = Number(
    error?.statusCode
    || error?.status
    || error?.response?.status
    || error?.cause?.statusCode
    || error?.cause?.status
    || 0,
  );
  const message = String(error?.message || error?.cause?.message || '');
  if (RETRYABLE_DOWNLOAD_STATUS_CODES.has(statusCode)) return true;
  if (RETRYABLE_DOWNLOAD_ERROR_CODES.has(code)) return true;
  return /EAI_AGAIN|ENOTFOUND|ECONNRESET|ETIMEDOUT|socket hang up|network timeout|storage\.googleapis\.com/i.test(message);
}

function isDnsError(error: any): boolean {
  const code = String(error?.code || error?.cause?.code || '').toUpperCase();
  const message = String(error?.message || error?.cause?.message || '');
  return DNS_ERROR_CODES.has(code) || /EAI_AGAIN|ENOTFOUND/i.test(message);
}

function sanitizeTimezone(value: any): string {
  const tz = String(value || '').trim() || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    return 'UTC';
  }
}

function getRuntimeTimezone(envVars?: Record<string, string>): string {
  return sanitizeTimezone(
    envVars?.STUARD_USER_TIMEZONE
    || envVars?.TZ
    || process.env.STUARD_USER_TIMEZONE
    || process.env.TZ
    || 'UTC',
  );
}

function parseCronField(field: string, min: number, max: number): Set<number> | null {
  const values = new Set<number>();
  const addRange = (start: number, end: number, step = 1) => {
    if (!Number.isInteger(start) || !Number.isInteger(end) || !Number.isInteger(step) || step <= 0) return false;
    if (start < min || end > max || start > end) return false;
    for (let n = start; n <= end; n += step) values.add(n);
    return true;
  };

  for (const rawPart of field.split(',')) {
    const part = rawPart.trim();
    if (!part) return null;
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart == null ? 1 : Number(stepPart);
    if (stepPart != null && (!Number.isInteger(step) || step <= 0)) return null;

    if (rangePart === '*') {
      if (!addRange(min, max, step)) return null;
      continue;
    }

    const range = rangePart.match(/^(\d+)-(\d+)$/);
    if (range) {
      if (!addRange(Number(range[1]), Number(range[2]), step)) return null;
      continue;
    }

    const exact = Number(rangePart);
    if (!Number.isInteger(exact) || exact < min || exact > max) return null;
    if (step !== 1) return null;
    values.add(exact);
  }

  return values;
}

function parseCronExpression(expr: string): Array<Set<number>> | null {
  const parts = String(expr || '').trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const ranges: Array<[number, number]> = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
  const parsed = parts.map((part, index) => parseCronField(part, ranges[index][0], ranges[index][1]));
  if (parsed.some((field) => !field)) return null;
  return parsed as Array<Set<number>>;
}

function zonedDateParts(date: Date, timezone: string): { key: string; minute: number; hour: number; day: number; month: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));
  return {
    key: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    minute,
    hour,
    day,
    month,
    weekday: Math.max(0, weekday),
  };
}

function cronMatches(parsed: Array<Set<number>>, date: Date, timezone: string): string | null {
  const parts = zonedDateParts(date, timezone);
  const weekdayMatches = parsed[4].has(parts.weekday) || (parts.weekday === 0 && parsed[4].has(7));
  const ok = parsed[0].has(parts.minute)
    && parsed[1].has(parts.hour)
    && parsed[2].has(parts.day)
    && parsed[3].has(parts.month)
    && weekdayMatches;
  return ok ? parts.key : null;
}

async function withDownloadRetry<T>(label: string, fn: () => Promise<T>, maxAttempts = 6): Promise<T> {
  let lastError: any;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      if (attempt >= maxAttempts || !isRetryableDownloadError(error)) {
        throw error;
      }
      const dnsFailure = isDnsError(error);
      const baseMs = dnsFailure ? 3000 : 750;
      const maxMs = dnsFailure ? 15000 : 5000;
      const delayMs = Math.min(baseMs * Math.pow(2, attempt - 1) + Math.round(Math.random() * 500), maxMs);
      console.warn(`[deploy-executor] ${label} attempt ${attempt}/${maxAttempts} failed (${dnsFailure ? 'DNS' : 'network'}): ${error?.message || error}. Retrying in ${delayMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deploy Executor
// ─────────────────────────────────────────────────────────────────────────────

export class DeployExecutor extends EventEmitter {
  private running = new Map<string, RunningDeploy>();
  private engine = new VMWorkflowEngine();
  private workflowRunQueues = new Map<string, Promise<void>>();

  constructor() {
    super();
    fs.mkdirSync(DEPLOY_ROOT, { recursive: true });

    // Forward engine events
    this.engine.on('log', (data: any) => {
      const { deployId, message } = data;
      this.emit('log', deployId, message);
    });
    this.engine.on('step', (data: any) => {
      this.emit('step', data.deployId, data);
    });
    this.engine.on('flow', (data: any) => {
      this.emit('flow', data.deployId, data);
    });
  }

  /**
   * Download bundle, install deps, and start the deployment.
   */
  async start(config: DeployConfig): Promise<{ pid: number | null; dir: string }> {
    const deployDir = path.join(DEPLOY_ROOT, config.deployId);
    const bundlePath = path.join(deployDir, 'bundle.json');

    // Create deploy directory
    fs.mkdirSync(deployDir, { recursive: true });

    let bundle: any;

    if (config.inlineBundle) {
      // Bundle was passed inline — no GCS download needed
      this.appendLog(deployDir, `[deploy] Using inline bundle for ${config.name}`);
      bundle = typeof config.inlineBundle === 'string'
        ? JSON.parse(config.inlineBundle)
        : config.inlineBundle;
      fs.writeFileSync(bundlePath, JSON.stringify(bundle, null, 2));
    } else if (config.downloadUrl) {
      // Wait for DNS to be ready before attempting the download.
      // On freshly booted VMs the resolver can take a few seconds.
      await this.waitForDns(deployDir);

      // Download bundle
      this.appendLog(deployDir, `[deploy] Downloading bundle for ${config.name}`);
      try {
        await this.downloadFile(config.downloadUrl, bundlePath);
        this.appendLog(deployDir, `[deploy] Bundle downloaded to ${bundlePath}`);
      } catch (error: any) {
        this.appendLog(deployDir, `[deploy] Bundle download failed: ${error?.message || error}`);
        // Fall back to existing bundle on disk (e.g. restart after previous deploy)
        if (fs.existsSync(bundlePath)) {
          this.appendLog(deployDir, `[deploy] Using previously cached bundle from disk`);
        } else {
          throw error;
        }
      }

      bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf-8'));
    } else if (fs.existsSync(bundlePath)) {
      // No download URL and no inline bundle, but bundle exists on disk (restart)
      this.appendLog(deployDir, `[deploy] Using existing bundle on disk for ${config.name}`);
      bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf-8'));
    } else {
      throw new Error('No bundle available: no downloadUrl, no inlineBundle, and no cached bundle on disk');
    }

    return this.startFromBundle(config, deployDir, bundle);
  }

  /**
   * Stop a running deployment.
   */
  stop(deployId: string): boolean {
    // Stop engine-managed workflow
    if (this.engine.isRunning(deployId)) {
      this.engine.stop(deployId);
    }

    const deploy = this.running.get(deployId);
    if (!deploy) return this.engine.isRunning(deployId) ? false : true;

    deploy.autoRestart = false; // prevent restart
    deploy.status = 'stopped';
    for (const timer of deploy.timers || []) clearInterval(timer);
    deploy.timers = [];

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
    this.workflowRunQueues.delete(deployId);
    return true;
  }

  /**
   * Execute a trigger-driven workflow deployment on demand.
   */
  async trigger(deployId: string, triggerId?: string, triggerPayload?: any, source = 'external'): Promise<{ triggered: boolean; error?: string }> {
    const deploy = this.running.get(deployId);
    if (!deploy || deploy.kind !== 'workflow') {
      return { triggered: false, error: 'deploy_not_found' };
    }

    const workflowPath = path.join(deploy.dir, 'workflow.json');
    if (!fs.existsSync(workflowPath)) {
      return { triggered: false, error: 'workflow_definition_missing' };
    }

    let workflowPayload: any;
    try {
      workflowPayload = JSON.parse(fs.readFileSync(workflowPath, 'utf-8'));
    } catch (e: any) {
      return { triggered: false, error: `workflow_read_failed: ${String(e?.message || e)}` };
    }

    const cloudAiUrl = process.env.CLOUD_AI_URL
      || process.env.CLOUD_PUBLIC_URL
      || 'http://localhost:8082';
    const agentWsUrl = process.env.AGENT_WS_URL
      || process.env.AGENT_WS
      || 'ws://127.0.0.1:8765/ws';
    const userId = process.env.STUARD_USER_ID || '';
    const vmTokenSecret = process.env.VM_TOKEN_SECRET || '';

    this.enqueueWorkflowRun(deploy, workflowPayload, {
      cloudAiUrl,
      agentWsUrl,
      userId,
      vmTokenSecret,
      timezone: deploy.timezone || getRuntimeTimezone(),
    }, {
      triggerId,
      triggerPayload,
      source,
    });

    return { triggered: true };
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
  list(): RunningDeployListEntry[] {
    const result: RunningDeployListEntry[] = [];

    // From running map
    for (const [id, deploy] of this.running) {
      result.push({
        id,
        kind: deploy.kind,
        name: deploy.name,
        pid: deploy.pid,
        status: deploy.status,
        autoRestart: deploy.autoRestart,
        source_workflow_id: deploy.sourceWorkflowId || null,
        trigger_bindings: deploy.triggerBindings || [],
        schedule: deploy.schedule || null,
        timezone: deploy.timezone || null,
        run_count: deploy.runCount || 0,
        last_run_at: deploy.lastRunAt || null,
        last_completed_at: deploy.lastCompletedAt || null,
        last_trigger_source: deploy.lastTriggerSource || null,
      });
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
              result.push({
                id: d.name,
                kind: bundle.kind || 'unknown',
                name: bundle.name || d.name,
                pid: null,
                status: 'stopped',
                autoRestart: bundle?.autoRestart !== false,
                source_workflow_id: bundle.sourceWorkflowId || null,
                trigger_bindings: this.normalizeTriggerBindings(bundle.triggerBindings),
                schedule: typeof bundle.schedule === 'string' ? bundle.schedule : null,
                timezone: sanitizeTimezone(bundle?.envVars?.STUARD_USER_TIMEZONE || bundle?.envVars?.TZ || process.env.STUARD_USER_TIMEZONE || process.env.TZ || 'UTC'),
                run_count: 0,
                last_run_at: null,
                last_completed_at: null,
                last_trigger_source: null,
              });
            } catch {
              result.push({ id: d.name, kind: 'unknown', name: d.name, pid: null, status: 'stopped' });
            }
          }
        }
      }
    } catch { /* ignore */ }

    return result;
  }

  /**
   * Restore previously extracted long-lived deployments after cold-storage restore.
   * One-shot workflow bundles are skipped to avoid replaying arbitrary actions on boot.
   */
  async restoreAll(): Promise<{ restored: string[]; skipped: string[]; failed: Array<{ id: string; error: string }> }> {
    const restored: string[] = [];
    const skipped: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    let dirs: fs.Dirent[] = [];
    try {
      dirs = fs.readdirSync(DEPLOY_ROOT, { withFileTypes: true });
    } catch {
      return { restored, skipped, failed };
    }

    for (const dirent of dirs) {
      if (!dirent.isDirectory()) continue;
      const deployDir = path.join(DEPLOY_ROOT, dirent.name);
      const bundlePath = path.join(deployDir, 'bundle.json');
      if (!fs.existsSync(bundlePath)) continue;
      if (this.running.has(dirent.name) || this.engine.isRunning(dirent.name)) {
        skipped.push(dirent.name);
        continue;
      }

      try {
        const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf-8'));
        const kind = String(bundle?.kind || '').toLowerCase() as DeployConfig['kind'];
        const autoRestart = bundle?.autoRestart !== false;

        if (!autoRestart) {
          skipped.push(dirent.name);
          continue;
        }

        // Restore workflows that have trigger bindings (webhooks, cron, etc.) since
        // they are durable event-driven workflows. Skip one-shot workflows that already ran.
        if (kind === 'workflow') {
          const hasTriggers = Array.isArray(bundle?.triggerBindings) && bundle.triggerBindings.length > 0;
          const hasSchedule = typeof bundle?.schedule === 'string' && bundle.schedule.trim();
          if (!hasTriggers && !hasSchedule) {
            skipped.push(dirent.name);
            this.appendLog(deployDir, `[restore] Skipped one-shot workflow ${dirent.name} (no triggers/schedule)`);
            continue;
          }
        }

        await this.startFromBundle({
          deployId: String(bundle?.id || dirent.name),
          downloadUrl: '',
          kind,
          name: String(bundle?.name || dirent.name),
          envVars: bundle?.envVars && typeof bundle.envVars === 'object' ? bundle.envVars : {},
          autoRestart,
          schedule: typeof bundle?.schedule === 'string' ? bundle.schedule : null,
          sourceWorkflowId: String(bundle?.sourceWorkflowId || '').trim() || null,
          triggerBindings: this.normalizeTriggerBindings(bundle?.triggerBindings),
        }, deployDir, bundle);

        restored.push(dirent.name);
        this.appendLog(deployDir, `[restore] Restored deployment ${dirent.name}`);
      } catch (e: any) {
        failed.push({ id: dirent.name, error: String(e?.message || e) });
        try {
          this.appendLog(deployDir, `[restore] Failed to restore ${dirent.name}: ${String(e?.message || e)}`);
        } catch { /* ignore */ }
      }
    }

    return { restored, skipped, failed };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Workflow Engine Execution (replaces shell stub for workflows)
  // ─────────────────────────────────────────────────────────────────────────

  private enqueueWorkflowRun(
    deploy: RunningDeploy,
    payload: any,
    runOpts: {
      cloudAiUrl: string;
      agentWsUrl?: string;
      userId: string;
      vmTokenSecret: string;
      timezone?: string;
    },
    meta: {
      triggerId?: string;
      triggerPayload?: any;
      source?: string;
      reportFinalStatus?: boolean;
      onCrash?: (error: any) => void;
    } = {},
  ): void {
    const deployId = deploy.id;
    const source = meta.source || 'manual';
    const queuedBehind = this.workflowRunQueues.has(deployId) || this.engine.isRunning(deployId);
    this.appendLog(deploy.dir, `[run] ${queuedBehind ? 'Queued' : 'Received'} ${source}${meta.triggerId ? ` for ${meta.triggerId}` : ''}`);

    const previous = this.workflowRunQueues.get(deployId) || Promise.resolve();
    const queued = previous.catch(() => {}).then(async () => {
      if (!this.running.has(deployId)) return;

      const runNumber = (deploy.runCount || 0) + 1;
      deploy.runCount = runNumber;
      deploy.lastRunAt = new Date().toISOString();
      deploy.lastTriggerSource = source;
      if (deploy.status !== 'failed') deploy.status = 'running';

      this.appendLog(deploy.dir, `[run:${runNumber}] Starting (${source})${runOpts.timezone ? ` timezone=${runOpts.timezone}` : ''}`);

      try {
        const result = await this.engine.run(deployId, payload, deploy.dir, {
          ...runOpts,
          triggerId: meta.triggerId,
          triggerPayload: meta.triggerPayload,
        });

        deploy.lastCompletedAt = new Date().toISOString();
        this.appendLog(
          deploy.dir,
          `[run:${runNumber}] Completed ok=${result.ok}${result.error ? ` error=${result.error}` : ''}`,
        );

        if (meta.reportFinalStatus) {
          const finalStatus = result.ok ? 'completed' : 'failed';
          deploy.status = result.ok ? 'stopped' : 'failed';
          this.emit('status', deployId, deploy.status);
          this.reportDeployStatus(deployId, finalStatus, runOpts.cloudAiUrl, runOpts.userId, runOpts.vmTokenSecret, result.error)
            .catch((e) => this.appendLog(deploy.dir, `[engine] Status callback failed: ${e?.message}`));
        } else {
          this.emit('status', deployId, 'running');
        }
      } catch (e: any) {
        deploy.lastCompletedAt = new Date().toISOString();
        this.appendLog(deploy.dir, `[run:${runNumber}] Failed: ${String(e?.message || e)}`);
        if (meta.reportFinalStatus) {
          deploy.status = 'failed';
          this.emit('status', deployId, 'failed');
          this.reportDeployStatus(deployId, 'failed', runOpts.cloudAiUrl, runOpts.userId, runOpts.vmTokenSecret, e?.message).catch(() => {});
          meta.onCrash?.(e);
        } else {
          this.emit('status', deployId, 'running');
        }
      }
    });

    const tracked = queued.finally(() => {
      if (this.workflowRunQueues.get(deployId) === tracked) {
        this.workflowRunQueues.delete(deployId);
      }
    });
    this.workflowRunQueues.set(deployId, tracked);
  }

  private resolveScheduleRuntime(config: DeployConfig, payload: any, bindings: WorkflowTriggerBinding[]): ScheduleRuntime | null {
    const triggerBindings = bindings.filter((binding) => binding.type === 'schedule.cron');
    const triggers = Array.isArray(payload?.triggers) ? payload.triggers : [];
    const scheduleTrigger = triggers.find((trigger: any) => String(trigger?.type || '') === 'schedule.cron');
    const binding = triggerBindings[0];
    const cron = String(
      config.schedule
      || binding?.args?.cron
      || scheduleTrigger?.args?.cron
      || '',
    ).trim();
    if (!cron) return null;
    return {
      cron,
      triggerId: String(binding?.triggerId || scheduleTrigger?.id || '').trim() || undefined,
      args: {
        ...(scheduleTrigger?.args && typeof scheduleTrigger.args === 'object' ? scheduleTrigger.args : {}),
        ...(binding?.args && typeof binding.args === 'object' ? binding.args : {}),
        cron,
      },
    };
  }

  private armCronSchedule(
    deploy: RunningDeploy,
    payload: any,
    runtime: ScheduleRuntime,
    runOpts: {
      cloudAiUrl: string;
      agentWsUrl?: string;
      userId: string;
      vmTokenSecret: string;
      timezone?: string;
    },
  ): void {
    const parsed = parseCronExpression(runtime.cron);
    if (!parsed) {
      deploy.status = 'failed';
      this.appendLog(deploy.dir, `[cron] Invalid schedule "${runtime.cron}"`);
      this.emit('status', deploy.id, 'failed');
      return;
    }

    let lastFireKey = '';
    const timezone = sanitizeTimezone(runOpts.timezone || deploy.timezone || 'UTC');
    const tick = () => {
      if (!this.running.has(deploy.id) || deploy.status === 'stopped') return;
      const key = cronMatches(parsed, new Date(), timezone);
      if (!key || key === lastFireKey) return;
      lastFireKey = key;
      const firedAt = new Date().toISOString();
      const triggerPayload = {
        trigger: {
          id: runtime.triggerId,
          type: 'schedule.cron',
          cron: runtime.cron,
          timezone,
          firedAt,
        },
        args: runtime.args || {},
        input: { cron: runtime.cron, timezone, firedAt },
      };
      this.appendLog(deploy.dir, `[cron] Fired ${runtime.cron} at ${key} (${timezone})`);
      this.enqueueWorkflowRun(deploy, payload, { ...runOpts, timezone }, {
        triggerId: runtime.triggerId,
        triggerPayload,
        source: 'cron',
      });
    };

    const timer = setInterval(tick, 30_000);
    deploy.timers = deploy.timers || [];
    deploy.timers.push(timer);
    setTimeout(tick, 1_000);
    this.appendLog(deploy.dir, `[cron] Armed ${runtime.cron} (${timezone})${runtime.triggerId ? ` trigger=${runtime.triggerId}` : ''}`);
  }

  private async startWorkflowEngine(
    config: DeployConfig,
    deployDir: string,
    payload: any,
    logFile: string,
  ): Promise<{ pid: number | null; dir: string }> {
    await this.prepareWorkflowRuntime(deployDir, payload, config.envVars);
    const triggerBindings = this.normalizeTriggerBindings(config.triggerBindings);
    const scheduleRuntime = this.resolveScheduleRuntime(config, payload, triggerBindings);
    const runtimeTimezone = getRuntimeTimezone(config.envVars);
    const usesTriggerRuntime = this.hasTriggerRuntimeBindings(triggerBindings) || !!scheduleRuntime;

    // Track as running deploy (pid = null since engine is in-process)
    const deploy: RunningDeploy = {
      id: config.deployId,
      kind: 'workflow',
      name: config.name,
      process: null,
      pid: null,
      autoRestart: config.autoRestart,
      restartCount: 0,
      maxRestarts: MAX_RESTARTS,
      logFile,
      dir: deployDir,
      status: 'running',
      sourceWorkflowId: config.sourceWorkflowId || null,
      triggerBindings,
      timers: [],
      schedule: scheduleRuntime?.cron || config.schedule || null,
      timezone: runtimeTimezone,
      runCount: 0,
      lastRunAt: null,
      lastCompletedAt: null,
      lastTriggerSource: null,
    };
    this.running.set(config.deployId, deploy);

    // Determine Cloud AI URL — the engine calls cloud tools via this
    const cloudAiUrl = process.env.CLOUD_AI_URL
      || process.env.CLOUD_PUBLIC_URL
      || 'http://localhost:8082';

    // Agent WS URL — Python agent on VM for local tools (if running)
    const agentWsUrl = process.env.AGENT_WS_URL
      || process.env.AGENT_WS
      || 'ws://127.0.0.1:8765/ws';

    // VM HMAC auth — userId is set during provisioning (cloud_engines table),
    // vmTokenSecret is the per-VM secret. NO user Supabase tokens on the VM.
    const userId = process.env.STUARD_USER_ID || '';
    const vmTokenSecret = process.env.VM_TOKEN_SECRET || '';

    if (!userId || !vmTokenSecret) {
      this.appendLog(deployDir, `[engine] WARNING: Missing STUARD_USER_ID or VM_TOKEN_SECRET — cloud/desktop tools will fail auth`);
    }

    const runOpts = {
      cloudAiUrl,
      agentWsUrl,
      userId,
      vmTokenSecret,
      timezone: runtimeTimezone,
    };

    if (usesTriggerRuntime) {
      if (scheduleRuntime) {
        this.armCronSchedule(deploy, payload, scheduleRuntime, runOpts);
      }
      this.appendLog(
        deployDir,
        `[engine] Armed trigger runtime for "${config.name}" (${[
          ...triggerBindings.map((b) => `${b.type}:${b.triggerId}`),
          scheduleRuntime ? `schedule.cron:${scheduleRuntime.triggerId || 'schedule'}` : '',
        ].filter(Boolean).join(', ') || 'none'}) timezone=${runtimeTimezone}`
      );
      return { pid: null, dir: deployDir };
    }

    this.appendLog(deployDir, `[engine] Starting workflow "${config.name}" with real engine`);
    this.appendLog(deployDir, `[engine] Cloud AI: ${cloudAiUrl}`);

    // Run the workflow engine (async — fire and forget, logs stream to file)
    const runOnce = () => this.enqueueWorkflowRun(deploy, payload, runOpts, {
      source: 'deploy_start',
      reportFinalStatus: true,
      onCrash: () => {
        if (deploy.autoRestart && deploy.restartCount < deploy.maxRestarts) {
          deploy.restartCount++;
          this.appendLog(deployDir, `[engine] Auto-restarting (attempt ${deploy.restartCount}/${deploy.maxRestarts})...`);
          setTimeout(() => {
            if (this.running.has(config.deployId) && deploy.status !== 'stopped') {
              deploy.status = 'running';
              runOnce();
            }
          }, RESTART_DELAY_MS);
        }
      },
    });

    // Start async (don't await — caller gets back immediately with deploy info)
    runOnce();

    return { pid: null, dir: deployDir };
  }

  private async startFromBundle(
    config: DeployConfig,
    deployDir: string,
    bundle: any,
  ): Promise<{ pid: number | null; dir: string }> {
    const logFile = path.join(deployDir, 'deploy.log');
    const payload = bundle?.payload;

    if (config.kind === 'workflow') {
      return this.startWorkflowEngine({
        ...config,
        sourceWorkflowId: String(bundle?.sourceWorkflowId || config.sourceWorkflowId || '').trim() || undefined,
        triggerBindings: this.normalizeTriggerBindings(bundle?.triggerBindings || config.triggerBindings),
        schedule: typeof bundle?.schedule === 'string' ? bundle.schedule : config.schedule,
      }, deployDir, payload, logFile);
    }

    let entrypoint: string;
    switch (config.kind) {
      case 'script':
        entrypoint = await this.prepareScript(deployDir, payload, config.envVars);
        break;
      case 'project':
        entrypoint = await this.prepareProject(deployDir, payload, config.envVars);
        break;
      default:
        throw new Error(`Unknown deploy kind: ${config.kind}`);
    }

    const pid = this.spawnProcess(config.deployId, config.kind, config.name, deployDir, entrypoint, config.envVars, config.autoRestart, logFile);
    return { pid, dir: deployDir };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Preparation — write files + install deps per deploy kind
  // ─────────────────────────────────────────────────────────────────────────

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
if [ -f .env ]; then
  set -a
  source .env 2>/dev/null
  set +a
fi
${cmd}
`, { mode: 0o755 });

    return runnerPath;
  }

  private async prepareWorkflowRuntime(dir: string, payload: any, envVars: Record<string, string>): Promise<void> {
    fs.writeFileSync(path.join(dir, 'workflow.json'), JSON.stringify(payload, null, 2));
    this.writeEnvFile(dir, envVars);

    if (payload?.requirements) {
      const reqPath = path.join(dir, 'requirements.txt');
      fs.writeFileSync(reqPath, payload.requirements);
      try {
        execFileSync('pip3', ['install', '-r', reqPath, '--quiet'], { cwd: dir, timeout: 120_000, stdio: 'pipe' });
      } catch (e: any) {
        this.appendLog(dir, `[deploy] Warning: pip install failed: ${e.message}`);
      }
    }

    if (payload?.scripts && typeof payload.scripts === 'object') {
      for (const [filename, content] of Object.entries(payload.scripts)) {
        const scriptPath = path.join(dir, filename);
        fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
        fs.writeFileSync(scriptPath, String(content));
        if (filename.endsWith('.sh') || filename.endsWith('.py')) {
          fs.chmodSync(scriptPath, 0o755);
        }
      }
    }

    for (const sub of ['data', 'scripts', 'assets']) {
      fs.mkdirSync(path.join(dir, sub), { recursive: true });
    }
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
if [ -f .env ]; then
  set -a
  source .env 2>/dev/null
  set +a
fi
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

    // Build env — strip sensitive secrets so they can't leak into logs
    const safeBaseEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v != null && !SENSITIVE_ENV_KEYS.has(k)) safeBaseEnv[k] = v;
    }
    const env = {
      ...safeBaseEnv,
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
  // Status Callback — report deploy completion to cloud-ai
  // ─────────────────────────────────────────────────────────────────────────

  private async reportDeployStatus(
    deployId: string,
    status: 'completed' | 'failed' | 'stopped',
    cloudAiUrl: string,
    userId: string,
    vmTokenSecret: string,
    errorMessage?: string,
  ): Promise<void> {
    if (!userId || !vmTokenSecret) return;

    const token = mintVMToken(vmTokenSecret, userId, 'deploy-executor');
    const url = `${cloudAiUrl}/v1/cloud-engine/deploys/status-callback`;

    const body: any = { deployId, status };
    if (errorMessage) body.errorMessage = errorMessage;

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'X-VM-User-Id': userId,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`HTTP ${resp.status}: ${text}`);
    }
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

  private async waitForDns(deployDir: string, maxWaitMs = 30_000): Promise<void> {
    const { lookup } = await import('dns');
    const start = Date.now();
    let attempt = 0;
    while (Date.now() - start < maxWaitMs) {
      attempt++;
      const ok = await new Promise<boolean>((resolve) => {
        lookup('storage.googleapis.com', (err) => resolve(!err));
      });
      if (ok) {
        if (attempt > 1) {
          this.appendLog(deployDir, `[deploy] DNS ready after ${attempt} attempts (${Date.now() - start}ms)`);
        }
        return;
      }
      const delay = Math.min(2000 * attempt, 8000);
      this.appendLog(deployDir, `[deploy] DNS not ready (attempt ${attempt}), waiting ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
    this.appendLog(deployDir, `[deploy] DNS still not ready after ${maxWaitMs}ms — proceeding anyway`);
  }

  private downloadFile(url: string, destPath: string): Promise<void> {
    return withDownloadRetry('download deploy bundle', () => new Promise((resolve, reject) => {
      const mod = url.startsWith('https') ? https : http;
      const file = fs.createWriteStream(destPath);
      const req = mod.get(url, (res) => {
        if (res.statusCode !== 200) {
          try { fs.unlinkSync(destPath); } catch {}
          const error: any = new Error(`Download failed: HTTP ${res.statusCode}`);
          error.statusCode = res.statusCode;
          return reject(error);
        }
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
      });
      req.on('error', (e) => {
        try { fs.unlinkSync(destPath); } catch {}
        reject(e);
      });
      req.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
        const error: any = new Error('Download timeout');
        error.code = 'ETIMEDOUT';
        req.destroy(error);
      });
    }));
  }

  /**
   * Gracefully stop all running deployments.
   */
  stopAll(): void {
    this.engine.stopAll();
    for (const [id] of this.running) {
      this.stop(id);
    }
  }

  private normalizeTriggerBindings(input: any): WorkflowTriggerBinding[] {
    if (!Array.isArray(input)) return [];
    const seen = new Set<string>();
    const out: WorkflowTriggerBinding[] = [];
    for (const raw of input) {
      const triggerId = String(raw?.triggerId || '').trim();
      const type = String(raw?.type || '').trim();
      const mode = raw?.mode == null ? '' : String(raw.mode).trim();
      if (!triggerId || !type) continue;
      const key = `${triggerId}:${type}:${mode}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        triggerId,
        type,
        mode: mode || undefined,
        args: raw?.args && typeof raw.args === 'object' ? raw.args : undefined,
      });
    }
    return out;
  }

  private hasTriggerRuntimeBindings(bindings: WorkflowTriggerBinding[]): boolean {
    return bindings.some((binding) => {
      if (binding.type === 'gmail.new_email' || binding.type === 'drive.new_file') return true;
      if (binding.type === 'schedule.cron') return true;
      if (binding.type === 'webhook.local') return false;
      if (binding.type === 'webhook.cloud') return true;
      if (binding.type === 'webhook') {
        return String(binding.mode || 'cloud').trim().toLowerCase() !== 'local';
      }
      return false;
    });
  }
}
