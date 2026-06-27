/**
 * Inline connect/install primitives for the prompt-side integration suggestions.
 *
 * These mirror the connect/install flows in useIntegrationsState.handleConnect
 * (apps/desktop/src/renderer/hooks/useIntegrationsState.ts). The dashboard hook
 * delegates its generic OAuth + local-install branches to these same functions so
 * the two code paths stay in sync — keep this file and that hook aligned.
 *
 * Connected state is mirrored to localStorage["integrations.connected"] and broadcast
 * via the "integrations.connected.changed" window event, the same contract the
 * dashboard reads from.
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
}

interface ActionContext {
  token?: string | null;
  cloudAiHttp?: string;
  agentHttp?: string;
  onProgress?: (label: string) => void;
  /** Called with the slug when the integration becomes connected. */
  onConnected?: (slug: string) => void;
}

const CONNECTED_KEY = 'integrations.connected';

export function resolveCloudAiHttp(explicit?: string): string {
  return (
    explicit ||
    (window as any).__CLOUD_AI_HTTP__ ||
    (import.meta as any).env?.VITE_CLOUD_AI_URL ||
    'http://127.0.0.1:8082'
  );
}

export function resolveAgentHttp(explicit?: string): string {
  return explicit || (window as any).__AGENT_HTTP__ || 'http://127.0.0.1:8765';
}

export function readConnectedMap(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(CONNECTED_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function isConnected(slug: string): boolean {
  return !!readConnectedMap()[slug];
}

/** Mark an integration connected in the shared localStorage map + broadcast. */
export function markConnected(slug: string): void {
  try {
    const next = { ...readConnectedMap(), [slug]: true };
    localStorage.setItem(CONNECTED_KEY, JSON.stringify(next));
  } catch {}
  try {
    window.dispatchEvent(new Event('integrations.connected.changed'));
  } catch {}
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function openExternal(url: string): void {
  try {
    (window as any).desktopAPI?.openExternal?.(url);
  } catch {
    window.open(url, '_blank');
  }
}

async function execTool(tool: string, args: Record<string, unknown> = {}): Promise<any> {
  try {
    return await (window as any).desktopAPI?.execTool?.(tool, args);
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/** Run a tool on the local agent (different bus from desktop execTool). */
async function execAgentTool(agentHttp: string, tool: string, args: Record<string, unknown> = {}): Promise<any> {
  try {
    const resp = await fetch(`${agentHttp}/v1/tools/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool, args }),
    });
    return await resp.json().catch(() => null);
  } catch {
    return null;
  }
}

// ── Local install ────────────────────────────────────────────────────────────

/** Maps an install-kind slug to its desktop setup tool. python is handled separately (agent HTTP). */
const INSTALL_TOOL: Record<string, string> = {
  'browser-use': 'browser_use_setup',
  'data-analysis': 'data_analysis_setup',
  mediapipe: 'mediapipe_setup',
  ffmpeg: 'ffmpeg_setup',
  ollama: 'ollama_start',
};

export async function installLocalTool(slug: string, ctx: ActionContext = {}): Promise<ActionResult> {
  const finish = () => {
    markConnected(slug);
    ctx.onConnected?.(slug);
    return { ok: true } as ActionResult;
  };

  // Python: provision the default venv via the local agent runtime.
  if (slug === 'python') {
    ctx.onProgress?.('Setting up Python…');
    const agentHttp = resolveAgentHttp(ctx.agentHttp);
    try {
      await fetch(`${agentHttp}/v1/runtime/python/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ envId: 'default' }),
      });
      const resp = await fetch(`${agentHttp}/v1/runtime/python/status?envId=default`);
      const j = await resp.json().catch(() => null);
      if (j && (j.available === true || j.activeReady || j.defaultReady)) return finish();
      return { ok: false, error: 'Python is not available on this device.' };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  }

  // Agent CLI: detection-only — there is no one-click install for third-party CLIs.
  if (slug === 'agent-cli') {
    ctx.onProgress?.('Looking for coding CLIs…');
    const res = await execTool('cli_agent_detect', { includeVersions: false });
    if (res && res.anyAvailable) return finish();
    return { ok: false, error: 'No coding CLI found. Install Codex, Claude Code, or Cursor and retry.' };
  }

  // Browser Connector: extension must be loaded manually in chrome://extensions.
  if (slug === 'browser-extension') {
    ctx.onProgress?.('Checking browser connector…');
    const res = await execTool('browser_ext_status', {});
    if (res && res.connected) return finish();
    return {
      ok: false,
      error: 'Open Integrations → Browser Connector, load the extension folder, and paste the pairing key.',
    };
  }

  const tool = INSTALL_TOOL[slug];
  if (!tool) return { ok: false, error: `Don't know how to install "${slug}".` };

  ctx.onProgress?.(slug === 'ollama' ? 'Starting Ollama…' : 'Installing…');
  const res = await execTool(tool, {});
  // Setup tools return { ok: false, error } on failure; anything else is success.
  if (res && res.ok === false) {
    return { ok: false, error: String(res.error || 'Setup failed.') };
  }
  return finish();
}

// ── OAuth connect ──────────────────────────────────────────────────────────────

/** OAuth slug → backend provider. */
function slugToProvider(slug: string): string | null {
  if (slug === 'github') return 'github';
  if (slug === 'outlook') return 'outlook';
  if (slug === 'discord') return 'discord';
  if (slug === 'reddit') return 'reddit';
  if (slug === 'x') return 'x';
  if (slug === 'facebook') return 'facebook';
  if (slug === 'instagram') return 'instagram';
  if (slug === 'threads') return 'threads';
  if (slug === 'gmail' || slug.startsWith('google-')) return 'google';
  return null;
}

/** Google product slug → connect `target`. */
function googleTarget(slug: string): string {
  switch (slug) {
    case 'google-drive': return 'drive';
    case 'google-calendar': return 'calendar';
    case 'gmail': return 'gmail';
    case 'google-sheets': return 'sheets';
    case 'google-docs': return 'docs';
    case 'google-tasks': return 'tasks';
    default: return 'gmail';
  }
}

async function pollStatus(url: string, token: string): Promise<boolean> {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const j = await resp.json().catch(() => null);
      if (j && (j as any).ok && (j as any).connected) return true;
    } catch {}
    await sleep(2000);
  }
  return false;
}

/**
 * Device-local OAuth claim: after browser consent, cloud-ai stages the freshly minted
 * token for one-time pickup. Claim it and store it in the local encrypted store via the
 * agent — the token never lands in Supabase. Mirrors claimAndStoreLocally in the hook.
 */
async function claimAndStoreLocally(cloudAiHttp: string, agentHttp: string, token: string): Promise<boolean> {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const resp = await fetch(`${cloudAiHttp}/integrations/oauth/claim`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await resp.json().catch(() => null);
      const tokens = j && (j as any).ok && Array.isArray((j as any).tokens) ? (j as any).tokens : [];
      if (tokens.length > 0) {
        const sj = await execAgentTool(agentHttp, 'store_oauth_tokens', { replace: false, tokens });
        return !!(sj && (sj as any).ok);
      }
    } catch {}
    await sleep(2000);
  }
  return false;
}

export async function connectOAuth(slug: string, ctx: ActionContext = {}): Promise<ActionResult> {
  const token = ctx.token || '';
  if (!token) return { ok: false, error: 'not_signed_in' };

  const provider = slugToProvider(slug);
  if (!provider) return { ok: false, error: `"${slug}" is not an OAuth integration.` };

  const cloudAiHttp = resolveCloudAiHttp(ctx.cloudAiHttp);
  const agentHttp = resolveAgentHttp(ctx.agentHttp);
  ctx.onProgress?.('Opening sign-in…');

  if (provider === 'google') {
    const target = googleTarget(slug);
    openExternal(`${cloudAiHttp}/integrations/google/connect?token=${encodeURIComponent(token)}&target=${encodeURIComponent(target)}`);
    ctx.onProgress?.('Waiting for Google…');
    const stored = await claimAndStoreLocally(cloudAiHttp, agentHttp, token);
    const ok = stored
      ? true
      : await pollStatus(`${cloudAiHttp}/integrations/google/status?target=${encodeURIComponent(target)}`, token);
    if (ok) {
      markConnected(slug);
      ctx.onConnected?.(slug);
      return { ok: true };
    }
    return { ok: false, error: 'Sign-in didn’t complete.' };
  }

  openExternal(`${cloudAiHttp}/integrations/${provider}/connect?token=${encodeURIComponent(token)}`);
  ctx.onProgress?.('Waiting for sign-in…');
  const ok = await pollStatus(`${cloudAiHttp}/integrations/${provider}/status`, token);
  if (ok) {
    markConnected(slug);
    ctx.onConnected?.(slug);
    return { ok: true };
  }
  return { ok: false, error: 'Sign-in didn’t complete.' };
}
