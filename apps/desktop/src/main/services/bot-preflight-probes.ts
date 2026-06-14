import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { TOOL_REGISTRY } from '../tools/registry';

export type BotPreflightProbeStatus = 'pass' | 'fail' | 'warn' | 'unsupported';

export interface BotPreflightProbeRequest {
  probe: string;
  args?: Record<string, any>;
  /** Step label (e.g. "X Account Connected") — lets oauth_connected recover the
   *  provider when the blueprint omitted it from args. */
  label?: string;
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

const DEVICE_LOCAL_OAUTH_PROVIDERS = new Set(['x', 'twitter', 'reddit', 'github', 'google', 'gmail']);

/** The blueprint LLM sometimes emits an oauth_connected probe with the provider
 *  only in the label ("X Account Connected") and no `args.provider`, which made
 *  the probe hard-fail with "No provider name supplied". Recover the provider
 *  from the label so the probe can still run. */
function inferOAuthProviderFromLabel(label?: string): string | undefined {
  const l = String(label || '').toLowerCase();
  if (!l) return undefined;
  if (/\b(x|twitter)\b/.test(l) || l.includes('tweet')) return 'x';
  if (l.includes('gmail')) return 'gmail';
  if (l.includes('google') || l.includes('drive') || l.includes('calendar') || l.includes('sheet') || l.includes('docs')) return 'google';
  if (l.includes('github')) return 'github';
  if (l.includes('reddit')) return 'reddit';
  if (l.includes('notion')) return 'notion';
  if (l.includes('slack')) return 'slack';
  if (l.includes('instagram')) return 'instagram';
  if (l.includes('threads')) return 'threads';
  if (l.includes('discord')) return 'discord';
  if (l.includes('outlook') || l.includes('microsoft')) return 'outlook';
  return undefined;
}

function agentHttpBase(): string {
  return String(process.env.AGENT_HTTP || 'http://127.0.0.1:8765').replace(/\/+$/, '');
}

async function probeLocalOAuthConnected(provider: string): Promise<BotPreflightProbeResult | null> {
  if (!DEVICE_LOCAL_OAUTH_PROVIDERS.has(provider)) return null;
  try {
    const resp = await fetch(`${agentHttpBase()}/v1/tools/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: 'oauth_list', args: {} }),
      signal: AbortSignal.timeout(5_000),
    });
    const body: any = await resp.json().catch(() => ({}));
    const tokens = body?.tokens || body?.result?.tokens;
    if (!resp.ok || body?.ok === false || !Array.isArray(tokens)) {
      return { status: 'warn', detail: 'Could not read the local OAuth store; cloud status may be stale for desktop-held accounts.' };
    }
    const match = tokens.find((token: any) => {
      const tokenProvider = String(token?.provider || '').toLowerCase();
      if (provider === 'twitter') return tokenProvider === 'x';
      if (provider === 'gmail') return tokenProvider === 'google';
      return tokenProvider === provider;
    });
    // oauth_list is secrets-stripped — it exposes `hasAccessToken` but NEVER the
    // token itself, so checking `accessToken` here always read empty and reported
    // every connected account as disconnected. Use the boolean flag (keep the raw
    // fields as a fallback for any non-stripped payload shape).
    const hasAccessToken = match?.hasAccessToken === true
      || !!String(match?.accessToken || match?.access_token || '').trim();
    if (!match || !hasAccessToken) {
      return { status: 'fail', detail: `${provider} is not connected locally — reconnect it in Settings > Integrations.` };
    }
    const email = compact(match?.accountEmail || match?.account_email, 80);
    // Expired with no refresh token can't self-heal — flag it rather than pass.
    if (match?.expired === true && match?.hasRefreshToken === false) {
      return {
        status: 'warn',
        detail: email
          ? `${provider} is connected (${email}) but its token is expired with no refresh — reconnect it in Settings > Integrations.`
          : `${provider} is connected but its token is expired with no refresh — reconnect it in Settings > Integrations.`,
      };
    }
    return {
      status: 'pass',
      detail: email ? `${provider} account connected locally (${email}).` : `${provider} account connected locally.`,
    };
  } catch (e: any) {
    return { status: 'warn', detail: e?.message || 'Could not verify local OAuth connection.' };
  }
}

async function probeOauthConnected(args: Record<string, any> | undefined, ctx: OAuthProbeContext, label?: string): Promise<BotPreflightProbeResult> {
  const provider = compact(args?.provider, 32).toLowerCase()
    || String(inferOAuthProviderFromLabel(label) || '').toLowerCase();
  if (!provider) return { status: 'fail', detail: 'No provider name supplied to oauth_connected.' };

  const local = await probeLocalOAuthConnected(provider);
  if (local && local.status === 'pass') return local;

  const path = OAUTH_STATUS_PATHS[provider];
  if (!path) return { status: 'unsupported', detail: `No OAuth status check is wired up for provider "${provider}" yet.` };
  if (!ctx.cloudHttpBase) {
    return local || { status: 'warn', detail: 'Cloud base URL not configured; cannot verify OAuth connection.' };
  }
  if (!ctx.authToken) {
    return local || { status: 'warn', detail: 'No Supabase session token available; cannot verify OAuth connection.' };
  }
  try {
    const res = await fetch(`${ctx.cloudHttpBase}${path}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${ctx.authToken}` },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return local || { status: 'fail', detail: `Status endpoint returned ${res.status}: ${compact(detail, 120)}` };
    }
    const body: any = await res.json().catch(() => ({}));
    if (body?.deviceLocal === true && local) return local;
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
    return local || { status: 'fail', detail: `${provider} is not connected — the agent will fail at runtime.` };
  } catch (e: any) {
    return local || { status: 'warn', detail: e?.message || `Could not reach ${path}.` };
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
        return await probeOauthConnected(args, oauthContext, compact(request?.label, 80));
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
