import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { TOOL_REGISTRY } from '../tools/registry';

export type BotPreflightProbeStatus = 'pass' | 'fail' | 'warn' | 'unsupported';

export interface BotPreflightProbeRequest {
  probe: string;
  args?: Record<string, any>;
}

export interface BotPreflightProbeResult {
  status: BotPreflightProbeStatus;
  detail: string;
}

const BINARY_TIMEOUT_MS = 6_000;

function compact(value: unknown, max = 200): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

async function probeToolAvailable(args: Record<string, any> | undefined): Promise<BotPreflightProbeResult> {
  const tool = compact(args?.tool, 64);
  if (!tool) return { status: 'fail', detail: 'No tool name supplied to tool_available.' };
  const entry = TOOL_REGISTRY[tool];
  if (!entry) return { status: 'fail', detail: `Tool "${tool}" is not in the desktop tool registry.` };
  return { status: 'pass', detail: `Tool "${tool}" is reachable (kind: ${entry.kind || 'unknown'}).` };
}

async function runBinary(binary: string, candidateArgs: string[][]): Promise<BotPreflightProbeResult> {
  let lastError = 'binary did not exit cleanly';
  for (const argSet of candidateArgs) {
    const result = await new Promise<BotPreflightProbeResult | null>((resolve) => {
      let child: ReturnType<typeof spawn> | null = null;
      let resolved = false;
      const finishOk = (output: string) => {
        if (resolved) return;
        resolved = true;
        resolve({ status: 'pass', detail: compact(output) || `${binary} responded successfully.` });
      };
      const finishMiss = (msg: string) => {
        if (resolved) return;
        resolved = true;
        lastError = msg;
        resolve(null);
      };
      try {
        child = spawn(binary, argSet, { windowsHide: true });
      } catch (e: any) {
        finishMiss(e?.code === 'ENOENT' ? `${binary} not found on PATH.` : (e?.message || 'spawn failed'));
        return;
      }
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (chunk) => { stdout += String(chunk).slice(0, 400); });
      child.stderr?.on('data', (chunk) => { stderr += String(chunk).slice(0, 400); });
      child.on('error', (err: any) => {
        finishMiss(err?.code === 'ENOENT' ? `${binary} not found on PATH.` : (err?.message || 'spawn failed'));
      });
      child.on('close', (code) => {
        const output = (stdout || stderr).trim();
        if (code === 0 || output) finishOk(output);
        else finishMiss(`${binary} exited with code ${code}.`);
      });
      setTimeout(() => {
        if (resolved) return;
        try { child?.kill(); } catch {}
        finishMiss(`${binary} probe timed out after ${BINARY_TIMEOUT_MS}ms.`);
      }, BINARY_TIMEOUT_MS);
    });
    if (result) return result;
  }
  return { status: 'fail', detail: lastError };
}

async function probeBinaryAvailable(args: Record<string, any> | undefined): Promise<BotPreflightProbeResult> {
  const binary = compact(args?.binary, 64).split(/\s+/)[0] || '';
  if (!binary) return { status: 'fail', detail: 'No binary name supplied to binary_available.' };
  if (/[\\/]|^\./.test(binary)) {
    return { status: 'fail', detail: `Refusing to probe arbitrary path "${binary}". Pass a binary name only.` };
  }
  const candidates: string[][] = [['--version'], ['-version'], ['version'], ['-v']];
  return runBinary(binary, candidates);
}

async function probeFolderAccess(args: Record<string, any> | undefined): Promise<BotPreflightProbeResult> {
  const rawPath = compact(args?.path, 400);
  if (!rawPath) return { status: 'warn', detail: 'No path supplied — ask the user before unattended runs.' };
  try {
    const stat = await fs.stat(rawPath);
    if (!stat.isDirectory() && !stat.isFile()) {
      return { status: 'fail', detail: `Path exists but is neither a file nor a directory: ${rawPath}` };
    }
    await fs.access(rawPath);
    return { status: 'pass', detail: `${stat.isDirectory() ? 'Folder' : 'File'} is readable: ${rawPath}` };
  } catch (e: any) {
    const code = e?.code || '';
    if (code === 'ENOENT') return { status: 'fail', detail: `Path does not exist: ${rawPath}` };
    if (code === 'EACCES' || code === 'EPERM') return { status: 'fail', detail: `Path is not readable (${code}): ${rawPath}` };
    return { status: 'fail', detail: e?.message || `Could not access ${rawPath}.` };
  }
}

interface OAuthProbeContext {
  cloudHttpBase: string;
  authToken: string | null;
}

const OAUTH_STATUS_PATHS: Record<string, string> = {
  google: '/integrations/google/status?target=gmail',
  gmail: '/integrations/google/status?target=gmail',
  drive: '/integrations/google/status?target=drive',
  calendar: '/integrations/google/status?target=calendar',
  sheets: '/integrations/google/status?target=sheets',
  docs: '/integrations/google/status?target=docs',
  tasks: '/integrations/google/status?target=tasks',
  microsoft: '/integrations/outlook/status',
  outlook: '/integrations/outlook/status',
  github: '/integrations/github/status',
  discord: '/integrations/discord/status',
  reddit: '/integrations/reddit/status',
  x: '/integrations/x/status',
  twitter: '/integrations/x/status',
  facebook: '/integrations/facebook/status',
  instagram: '/integrations/instagram/status',
  threads: '/integrations/threads/status',
  slack: '/integrations/slack/status',
  notion: '/integrations/notion/status',
};

async function probeOauthConnected(args: Record<string, any> | undefined, ctx: OAuthProbeContext): Promise<BotPreflightProbeResult> {
  const provider = compact(args?.provider, 32).toLowerCase();
  if (!provider) return { status: 'fail', detail: 'No provider name supplied to oauth_connected.' };
  const path = OAUTH_STATUS_PATHS[provider];
  if (!path) return { status: 'unsupported', detail: `No OAuth status check is wired up for provider "${provider}" yet.` };
  if (!ctx.cloudHttpBase) return { status: 'warn', detail: 'Cloud base URL not configured; cannot verify OAuth connection.' };
  if (!ctx.authToken) return { status: 'warn', detail: 'No Supabase session token available; cannot verify OAuth connection.' };
  try {
    const res = await fetch(`${ctx.cloudHttpBase}${path}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${ctx.authToken}` },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { status: 'fail', detail: `Status endpoint returned ${res.status}: ${compact(detail, 120)}` };
    }
    const body: any = await res.json().catch(() => ({}));
    const connected = !!(body?.connected ?? body?.ok);
    const hasScopes = body?.hasScopes !== false;
    if (connected && hasScopes) {
      const email = compact(body?.email || body?.account || body?.profile, 80);
      return { status: 'pass', detail: email ? `${provider} account connected (${email}).` : `${provider} account connected.` };
    }
    if (connected && !hasScopes) {
      const missing = Array.isArray(body?.missingScopes) ? body.missingScopes.slice(0, 4).join(', ') : '';
      return { status: 'fail', detail: missing ? `${provider} connected but missing scopes: ${missing}` : `${provider} connected but missing required scopes.` };
    }
    return { status: 'fail', detail: `${provider} is not connected — the agent will fail at runtime.` };
  } catch (e: any) {
    return { status: 'warn', detail: e?.message || `Could not reach ${path}.` };
  }
}

async function probeCaptureDevicesAvailable(_args: Record<string, any> | undefined): Promise<BotPreflightProbeResult> {
  try {
    const { desktopCapturer } = await import('electron');
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
    if (!Array.isArray(sources) || sources.length === 0) {
      return { status: 'fail', detail: 'No screen or window capture sources are visible to Stuard.' };
    }
    return { status: 'pass', detail: `Capture sources available (${sources.length}). Camera/mic permissions are still requested on first run.` };
  } catch (e: any) {
    return { status: 'warn', detail: e?.message || 'desktopCapturer not available in this build.' };
  }
}

async function probeDryRunTool(args: Record<string, any> | undefined): Promise<BotPreflightProbeResult> {
  const tool = compact(args?.tool, 64);
  if (!tool) return { status: 'fail', detail: 'No tool name supplied to dry_run_tool.' };
  if (!TOOL_REGISTRY[tool]) return { status: 'fail', detail: `Tool "${tool}" is not in the desktop tool registry.` };
  return {
    status: 'warn',
    detail: `dry_run_tool is not yet executed during builder flow; assume "${tool}" works pending a real call.`,
  };
}

export async function runBotPreflightProbe(
  request: BotPreflightProbeRequest,
  oauthContext: OAuthProbeContext,
): Promise<BotPreflightProbeResult> {
  const probe = compact(request?.probe, 64);
  const args = request?.args && typeof request.args === 'object' && !Array.isArray(request.args)
    ? request.args
    : undefined;
  try {
    switch (probe) {
      case 'tool_available':
        return await probeToolAvailable(args);
      case 'binary_available':
        return await probeBinaryAvailable(args);
      case 'folder_access':
        return await probeFolderAccess(args);
      case 'oauth_connected':
        return await probeOauthConnected(args, oauthContext);
      case 'capture_devices_available':
        return await probeCaptureDevicesAvailable(args);
      case 'dry_run_tool':
        return await probeDryRunTool(args);
      default:
        return { status: 'unsupported', detail: `Probe "${probe}" is not implemented on this build.` };
    }
  } catch (e: any) {
    return { status: 'fail', detail: e?.message || `Probe "${probe}" threw an unexpected error.` };
  }
}
