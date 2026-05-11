import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import {
  AlertCircle,
  Bot as BotIcon,
  CheckCircle2,
  Cloud,
  Download,
  ExternalLink,
  Film,
  Github,
  Globe,
  HardDrive,
  Laptop,
  Link2,
  Loader2,
  Mail,
  MessageSquare,
  Monitor,
  RefreshCw,
  ScanFace,
  Server,
  Sparkles,
  Terminal,
  Unlink,
  Users,
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useConfirm } from './ConfirmDialog';

const CLOUD_AI_HTTP =
  (window as any).__CLOUD_AI_HTTP__ ||
  (import.meta as any).env?.VITE_CLOUD_AI_URL ||
  'http://127.0.0.1:8082';

interface IntegrationEntry {
  provider: string;
  profileLabel: string;
  accountEmail: string | null;
  isDefault: boolean;
  connectedAt: string | null;
  scopes: string[];
  hasRefreshToken: boolean;
  expiresAt: string | null;
}

/**
 * VM-side OAuth metadata, returned by the VM's `oauth_list` command via
 * `/v1/cloud-engine/integrations`. Mirrors `IntegrationEntry` but the source
 * of truth is the VM's local `oauth-tokens.json`, not the cloud DB. Older
 * VM agents won't include these fields, so treat everything as optional.
 */
interface VmIntegrationEntry {
  provider: string;
  profileLabel?: string;
  isDefault?: boolean;
  accountEmail?: string | null;
  scopes?: string[];
  hasAccessToken?: boolean;
  hasRefreshToken?: boolean;
  expiresAt?: string | null;
  expired?: boolean;
  syncedAt?: string | null;
}

interface VmServiceStatus {
  services?: Record<string, string>;
  browserReachable?: boolean;
  chrome?: string;
  vmAgentMode?: string;
}

interface IntegrationsResponse {
  ok: boolean;
  engineRunning?: boolean;
  engineStatus?: string | null;
  integrations?: IntegrationEntry[];
  vmIntegrations?: VmIntegrationEntry[];
  vm?: VmServiceStatus | null;
  error?: string;
  message?: string;
}

/* ─── Catalog of providers we offer in the VM Settings tab ────────────── */

type CloudProviderEntry = {
  slug: string;
  provider: string; // provider key matching backend (e.g. 'google' for gmail)
  name: string;
  description: string;
  category: 'Communication' | 'Productivity' | 'Files' | 'Development' | 'Data' | 'Automation';
  icon: any;
  /** OAuth path on cloud-ai. Defaults to /integrations/<slug>/connect */
  connectPath?: string;
  /** Status path on cloud-ai. Defaults to /integrations/<slug>/status */
  statusPath?: string;
};

const CLOUD_PROVIDERS: CloudProviderEntry[] = [
  { slug: 'gmail',           provider: 'google',    name: 'Gmail',           description: 'Send and read email.',                       category: 'Communication', icon: Mail, connectPath: '/integrations/google/connect?target=gmail' },
  { slug: 'google-calendar', provider: 'google',    name: 'Google Calendar', description: 'Manage events and reminders.',              category: 'Productivity',  icon: Globe, connectPath: '/integrations/google/connect?target=calendar' },
  { slug: 'google-drive',    provider: 'google',    name: 'Google Drive',    description: 'Browse and search files.',                  category: 'Files',         icon: HardDrive, connectPath: '/integrations/google/connect?target=drive' },
  { slug: 'github',          provider: 'github',    name: 'GitHub',          description: 'Read repositories and issues.',             category: 'Development',   icon: Github },
  { slug: 'outlook',         provider: 'outlook',   name: 'Outlook',         description: 'Microsoft Outlook for mail.',               category: 'Communication', icon: Mail },
  { slug: 'discord',         provider: 'discord',   name: 'Discord',         description: 'Read and send messages, list servers.',     category: 'Communication', icon: Users },
  { slug: 'reddit',          provider: 'reddit',    name: 'Reddit',          description: 'Browse, search, post, and comment.',        category: 'Communication', icon: MessageSquare },
  { slug: 'x',               provider: 'x',         name: 'X (Twitter)',     description: 'Post tweets, read timelines, send DMs.',    category: 'Communication', icon: MessageSquare },
  { slug: 'instagram',       provider: 'instagram', name: 'Instagram',       description: 'Connect Instagram for account features.',   category: 'Communication', icon: MessageSquare },
  { slug: 'facebook',        provider: 'facebook',  name: 'Facebook',        description: 'Connect Facebook with OAuth.',              category: 'Communication', icon: Globe },
  { slug: 'threads',         provider: 'threads',   name: 'Threads',         description: 'Connect Threads for identity & posting.',   category: 'Communication', icon: Users },
];

/* ─── Catalog of VM-local tools (background services on the engine) ───── */

type VmServiceEntry = {
  serviceKey: string; // matches the systemd service name returned by /v1/cloud-engine/integrations
  name: string;
  description: string;
  icon: any;
};

const VM_SERVICES: VmServiceEntry[] = [
  { serviceKey: 'stuard-agent',        name: 'Node.js Agent',     description: 'Core orchestrator that runs tools, deploys, and bots on the VM.',        icon: Server },
  { serviceKey: 'stuard-python-agent', name: 'Python Agent',      description: 'Python sidecar for run_python_script and managed venvs.',                 icon: Terminal },
  { serviceKey: 'stuard-browser-use',  name: 'Stuard Browser',    description: 'Headless Chromium for browser_use_* tools — fills forms, scrapes, etc.',  icon: Globe },
  { serviceKey: 'stuard-xvfb',         name: 'Virtual Display',   description: 'Xvfb display server so the headless browser can render.',                 icon: Monitor },
];

const VM_OPTIONAL: { slug: string; name: string; description: string; icon: any }[] = [
  { slug: 'mediapipe', name: 'MediaPipe',  description: 'Hand tracking, face detection, and body pose models. Auto-installed on first use.', icon: ScanFace },
  { slug: 'ffmpeg',    name: 'FFmpeg',     description: 'Convert and edit audio & video files. Pre-installed on the VM image.',               icon: Film },
  { slug: 'ollama',    name: 'Ollama',     description: 'Run local AI models on the VM. Available on Pro and Power tiers.',                   icon: BotIcon },
];

/* ─── API helpers ─────────────────────────────────────────────────────── */

async function getAuthToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || null;
  } catch {
    return null;
  }
}

async function fetchIntegrations(): Promise<IntegrationsResponse> {
  const token = await getAuthToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const resp = await fetch(`${CLOUD_AI_HTTP}/v1/cloud-engine/integrations`, {
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const text = await resp.text();
    try {
      return JSON.parse(text);
    } catch {
      return { ok: false, error: 'invalid_response', message: text.slice(0, 200) };
    }
  } catch (e: any) {
    clearTimeout(timer);
    if (e?.name === 'AbortError') return { ok: false, error: 'timeout' };
    return { ok: false, error: e?.message || 'network_error' };
  }
}

async function postCloud(path: string): Promise<{ ok: boolean; [k: string]: any }> {
  const token = await getAuthToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  try {
    const resp = await fetch(`${CLOUD_AI_HTTP}${path}`, { method: 'POST', headers });
    const text = await resp.text();
    try { return JSON.parse(text); } catch { return { ok: resp.ok }; }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'network_error' };
  }
}

function openExternalUrl(url: string) {
  try {
    const api = (window as any).desktopAPI?.openExternal;
    if (typeof api === 'function') {
      api(url);
      return;
    }
  } catch { /* noop */ }
  try { window.open(url, '_blank', 'noopener,noreferrer'); } catch { /* noop */ }
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const diff = Math.max(0, Date.now() - t);
  const sec = Math.floor(diff / 1000);
  if (sec < 45) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 45) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 14) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 8) return `${weeks}w ago`;
  return new Date(iso).toLocaleDateString();
}

/* ─── Component ────────────────────────────────────────────────────────── */

interface CloudVmSettingsProps {
  engine: any;
  className?: string;
}

export function CloudVmSettings({ engine, className }: CloudVmSettingsProps) {
  const [data, setData] = useState<IntegrationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [connectingSince, setConnectingSince] = useState<Record<string, number>>({});
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null);
  const [confirm, confirmDialog] = useConfirm();

  const isRunning = engine?.status === 'running';
  const isDesktop = useMemo(() => {
    try { return !!(window as any).desktopAPI; } catch { return false; }
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await fetchIntegrations();
      setData(result);
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (!isRunning) return;
    const id = setInterval(refresh, 20_000);
    return () => clearInterval(id);
  }, [refresh, isRunning]);

  // Auto-dismiss the toast after 4s
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  const showToast = (text: string, tone: 'ok' | 'err' = 'ok') => setToast({ text, tone });

  const integrations = data?.integrations || [];
  const vmIntegrations = data?.vmIntegrations || [];
  const services = data?.vm?.services || {};
  const browserReachable = !!data?.vm?.browserReachable;

  // VM Settings is VM-local by design: cloud DB accounts are legacy sync input,
  // not the source of truth for whether an integration is available in the VM.
  const useVmAsSource = true;

  const connectedMap = useMemo(() => {
    const m: Record<string, Array<IntegrationEntry | VmIntegrationEntry>> = {};
    const source: Array<IntegrationEntry | VmIntegrationEntry> = useVmAsSource
      ? vmIntegrations
      : integrations;
    for (const it of source) {
      const provider = String((it as any).provider || '');
      if (!provider) continue;
      const list = m[provider] || (m[provider] = []);
      list.push(it);
    }
    return m;
  }, [integrations, vmIntegrations, useVmAsSource]);

  useEffect(() => {
    const pending = Object.keys(connectingSince);
    if (pending.length === 0) return;
    const id = setInterval(() => { void refresh(); }, 2500);
    return () => clearInterval(id);
  }, [connectingSince, refresh]);

  useEffect(() => {
    const now = Date.now();
    setConnectingSince((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const entry of CLOUD_PROVIDERS) {
        const started = next[entry.slug];
        if (!started) continue;
        const connected = (connectedMap[entry.provider] || []).length > 0;
        if (connected || now - started > 120_000) {
          delete next[entry.slug];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [connectedMap]);

  /* ── Sync actions ──────────────────────────────────────────────────── */

  const runSync = async (key: string, path: string, body?: any, label?: string) => {
    if (!isRunning) {
      showToast('Resume your VM first to sync.', 'err');
      return;
    }
    setBusyKey(key);
    try {
      const token = await getAuthToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const resp = await fetch(`${CLOUD_AI_HTTP}${path}`, {
        method: 'POST',
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      const j = await resp.json().catch(() => ({}));
      if (resp.ok && j?.ok) {
        showToast(`${label || 'Sync'} complete.`, 'ok');
      } else {
        showToast(`${label || 'Sync'} failed: ${j?.error || j?.message || resp.statusText}`, 'err');
      }
    } catch (e: any) {
      showToast(`${label || 'Sync'} failed: ${e?.message || 'network error'}`, 'err');
    } finally {
      setBusyKey(null);
      void refresh();
    }
  };

  const syncOAuth = () => runSync('oauth', '/v1/cloud-engine/sync-oauth-to-vm', undefined, 'OAuth tokens sync');
  const syncBrowser = () => runSync('browser', '/v1/cloud-engine/sync-browser-profile-to-vm', undefined, 'Browser profile sync');
  const syncMemory = () => runSync('memory', '/v1/cloud-engine/sync-agent-data', { mode: 'full' }, 'Memory & knowledge sync');

  // Service restart isn't exposed as a dedicated endpoint yet — the runtime is
  // managed by the engine boot scripts. We expose a gentle "rerun startup"
  // affordance via the existing engine-start endpoint, which the boot pipeline
  // uses to verify services are healthy.
  const verifyServices = async () => {
    if (!isRunning) {
      showToast('Resume your VM first.', 'err');
      return;
    }
    setBusyKey('svc:verify');
    try {
      const result = await postCloud('/v1/cloud-engine/start');
      if (result?.ok) showToast('Service health verified.', 'ok');
      else showToast('Could not verify services.', 'err');
    } finally {
      setBusyKey(null);
      void refresh();
    }
  };

  /* ── Connect actions (cloud OAuth) ─────────────────────────────────── */

  const connectProvider = async (entry: CloudProviderEntry) => {
    if (!isRunning) {
      showToast('Resume your VM first so it can store the token locally.', 'err');
      return;
    }
    const token = await getAuthToken();
    if (!token) {
      showToast('Please sign in first.', 'err');
      return;
    }
    const path = entry.connectPath ?? `/integrations/${entry.slug}/connect`;
    const url = new URL(path, CLOUD_AI_HTTP);
    url.searchParams.set('token', token);
    url.searchParams.set('store', 'vm');
    setConnectingSince((prev) => ({ ...prev, [entry.slug]: Date.now() }));
    openExternalUrl(url.toString());
    showToast(`Opening ${entry.name} authorization. Token will be stored on this VM only.`, 'ok');
    window.setTimeout(() => { void refresh(); }, 5000);
    window.setTimeout(() => { void refresh(); }, 12_000);
    window.setTimeout(() => { void refresh(); }, 25_000);
  };

  const disconnectProvider = async (entry: CloudProviderEntry) => {
    const token = await getAuthToken();
    if (!token) {
      showToast('Please sign in first.', 'err');
      return;
    }
    const ok = await confirm({
      title: `Disconnect ${entry.name}?`,
      message: 'Stuard will lose access to this account on the cloud VM until you reconnect.',
      confirmLabel: 'Disconnect',
      destructive: true,
    });
    if (!ok) return;
    setBusyKey(`disc:${entry.slug}`);
    try {
      const resp = await fetch(`${CLOUD_AI_HTTP}/v1/cloud-engine/remove-oauth-from-vm`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ provider: entry.provider }),
      });
      if (resp.ok) showToast(`${entry.name} removed from this VM.`, 'ok');
      else showToast(`Could not remove ${entry.name} from this VM.`, 'err');
    } catch (e: any) {
      showToast(`Disconnect failed: ${e?.message || 'network error'}`, 'err');
    } finally {
      setBusyKey(null);
      void refresh();
    }
  };

  /* ── Render ────────────────────────────────────────────────────────── */

  if (loading) {
    return (
      <div className={clsx('flex h-full items-center justify-center text-theme-muted', className)}>
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading settings…
      </div>
    );
  }

  return (
    <div className={clsx('relative h-full overflow-y-auto custom-scrollbar', className)}>
      {confirmDialog}
      <div className="mx-auto max-w-3xl space-y-7 px-6 py-7">
        {/* Header */}
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-stuard text-[28px] font-semibold leading-none tracking-tight text-theme-fg">
              VM Settings
            </h1>
            <p className="mt-2 flex items-center gap-2 text-[13px] text-theme-muted">
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary/80" />
              <span>
                Sync from your desktop, connect cloud accounts directly to the VM, and manage VM-local tools.
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-full border border-theme/30 bg-theme-card/50 px-3.5 py-2 text-[12px] font-semibold text-theme-fg shadow-sm transition hover:bg-theme-hover disabled:opacity-60"
            title="Refresh"
          >
            <RefreshCw className={clsx('h-3.5 w-3.5', refreshing && 'animate-spin')} />
            Refresh
          </button>
        </header>

        {!isRunning && (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-[12.5px] text-amber-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-semibold">Engine paused</div>
              <p className="mt-0.5 text-amber-300/80">
                Resume your cloud engine from the top bar to sync data, restart services, or push tokens.
              </p>
            </div>
          </div>
        )}

        {/* Sync from desktop */}
        <Section
          title="Sync from this device"
          subtitle={
            isDesktop
              ? 'Push what is already on your desktop — OAuth tokens, browser cookies, and memory — to the VM.'
              : 'You are using the web app, so there is no desktop to sync from. Use the section below to connect accounts directly to the VM.'
          }
          icon={isDesktop ? Laptop : Cloud}
          accent={isDesktop ? 'primary' : 'muted'}
        >
          {isDesktop ? (
            <div className="grid grid-cols-1 gap-2.5">
              <SyncRow
                icon={Link2}
                title="OAuth tokens"
                subtitle="Push every connected account on this desktop (Gmail, GitHub, X, …) so VM-side bots can use them."
                actionLabel="Sync now"
                onAction={syncOAuth}
                busy={busyKey === 'oauth'}
                disabled={!isRunning}
              />
              <SyncRow
                icon={Globe}
                title="Browser profile & cookies"
                subtitle="Mirror your desktop Stuard browser session (cookies, logins) to the headless VM browser."
                actionLabel="Push profile"
                onAction={syncBrowser}
                busy={busyKey === 'browser'}
                disabled={!isRunning}
              />
              <SyncRow
                icon={HardDrive}
                title="Memory & knowledge"
                subtitle="Send your latest memory and knowledge databases so VM-side automations have the same context."
                actionLabel="Sync memory"
                onAction={syncMemory}
                busy={busyKey === 'memory'}
                disabled={!isRunning}
              />
            </div>
          ) : (
            <div className="rounded-xl border border-theme/15 bg-theme-card/30 px-4 py-4 text-[12.5px] text-theme-muted">
              <div className="mb-1 font-semibold text-theme-fg">Web mode</div>
              The web app cannot read your local desktop session. Connect cloud accounts to the VM directly using
              <span className="mx-1 font-medium text-theme-fg">Cloud integrations</span> below, or open the desktop
              app and come back to sync.
            </div>
          )}
        </Section>

        {/* Cloud integrations */}
        <Section
          title="Cloud integrations"
          subtitle={useVmAsSource
            ? 'OAuth providers actually installed on this VM. New connects from here are stored in the VM token store only.'
            : 'OAuth providers that connect straight to the VM. Tokens are stored locally in the VM token store.'}
          icon={Link2}
          accent="primary"
          right={
            <span className="text-[11px] font-medium text-theme-muted">
              {useVmAsSource ? `${vmIntegrations.length} on VM` : `${integrations.length} connected`}
            </span>
          }
        >
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {CLOUD_PROVIDERS.map(entry => {
              const linked = (connectedMap[entry.provider] || []);
              const isLinked = linked.length > 0;
              const first = isLinked ? linked[0] : null;
              const account = first ? (first.accountEmail || first.profileLabel || null) : null;
              const expired = isLinked && (
                'expired' in (first as any)
                  ? !!(first as VmIntegrationEntry).expired
                  : !!first?.expiresAt && new Date(first.expiresAt!).getTime() < Date.now()
              );
              const syncedAt = first && 'syncedAt' in (first as any) ? (first as VmIntegrationEntry).syncedAt : null;
              const Icon = entry.icon;
              const busy = busyKey === `disc:${entry.slug}`;
              const connecting = !!connectingSince[entry.slug];

              return (
                <div
                  key={entry.slug}
                  className="group relative flex items-start gap-3 rounded-2xl border border-theme/20 bg-zinc-500/5 p-3.5 transition hover:bg-theme-hover/30"
                >
                  <div className={clsx('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                    isLinked && !expired
                      ? 'bg-emerald-500/10 text-emerald-400'
                      : 'bg-theme-card text-theme-muted',
                  )}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="truncate text-[13.5px] font-semibold text-theme-fg">{entry.name}</div>
                      {isLinked && !expired && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                          <CheckCircle2 className="h-3 w-3" />
                          {useVmAsSource ? 'On VM' : 'Linked'}
                        </span>
                      )}
                      {isLinked && expired && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
                          <AlertCircle className="h-3 w-3" />
                          Expired
                        </span>
                      )}
                      {!isLinked && connecting && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Connecting
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[11.5px] text-theme-muted">
                      {account || entry.description}
                    </p>
                    {isLinked && syncedAt && (
                      <p className="mt-0.5 text-[10.5px] text-theme-muted/70">
                        Synced to VM {timeAgo(syncedAt)}
                      </p>
                    )}
                    <div className="mt-2 flex items-center gap-2">
                      {isLinked ? (
                        <>
                          <button
                            type="button"
                            onClick={() => connectProvider(entry)}
                            disabled={connecting}
                            className="inline-flex items-center gap-1.5 rounded-full border border-theme/30 bg-theme-card px-2.5 py-1 text-[11px] font-medium text-theme-fg transition hover:bg-theme-hover"
                          >
                            {connecting ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                            {connecting ? 'Connecting' : 'Reconnect'}
                          </button>
                          <button
                            type="button"
                            onClick={() => disconnectProvider(entry)}
                            disabled={busy}
                            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium text-theme-muted transition hover:text-red-400 disabled:opacity-60"
                          >
                            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Unlink className="h-3 w-3" />}
                            Disconnect
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => connectProvider(entry)}
                          disabled={connecting}
                          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-[11px] font-semibold text-primary-fg shadow-sm transition hover:opacity-90 disabled:opacity-60"
                        >
                          {connecting ? <Loader2 className="h-3 w-3 animate-spin" /> : <ExternalLink className="h-3 w-3" />}
                          {connecting ? 'Connecting' : 'Connect'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Section>

        {/* VM-local services */}
        <Section
          title="VM tools"
          subtitle="Background services running on this VM. Each is preinstalled — verify them or pull a fresh copy from your desktop."
          icon={Server}
          accent="primary"
          right={
            <button
              type="button"
              onClick={verifyServices}
              disabled={!isRunning || busyKey === 'svc:verify'}
              className="inline-flex items-center gap-1.5 rounded-full border border-theme/30 bg-theme-card px-2.5 py-1 text-[11px] font-medium text-theme-fg transition hover:bg-theme-hover disabled:opacity-50"
              title={isRunning ? 'Verify VM services are healthy' : 'Engine is paused'}
            >
              {busyKey === 'svc:verify' ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Verify
            </button>
          }
        >
          <div className="grid grid-cols-1 gap-2.5">
            {VM_SERVICES.map(svc => {
              const state = services[svc.serviceKey] || (isRunning ? 'unknown' : 'paused');
              const isUp = state === 'active';
              const Icon = svc.icon;
              const isBrowser = svc.serviceKey === 'stuard-browser-use';

              return (
                <div
                  key={svc.serviceKey}
                  className="flex items-center gap-3 rounded-2xl border border-theme/20 bg-zinc-500/5 p-3.5"
                >
                  <div className={clsx('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                    isUp ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-500/10 text-theme-muted',
                  )}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="truncate text-[13.5px] font-semibold text-theme-fg">{svc.name}</div>
                      <span className={clsx(
                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                        isUp
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : state === 'paused'
                            ? 'bg-zinc-500/10 text-theme-muted'
                            : 'bg-amber-500/10 text-amber-400',
                      )}>
                        <span className={clsx('h-1.5 w-1.5 rounded-full',
                          isUp ? 'bg-emerald-500' : state === 'paused' ? 'bg-zinc-400' : 'bg-amber-500',
                        )} />
                        {isUp ? 'Running' : state}
                      </span>
                      {isBrowser && (
                        <span className="text-[10px] text-theme-muted">
                          {browserReachable ? '· reachable on :18082' : '· not reachable'}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[11.5px] text-theme-muted">{svc.description}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-theme-muted">
              Optional VM tools
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {VM_OPTIONAL.map(opt => {
                const Icon = opt.icon;
                return (
                  <div
                    key={opt.slug}
                    className="flex items-start gap-3 rounded-2xl border border-theme/20 bg-zinc-500/5 p-3.5"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-theme-card text-theme-muted">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="truncate text-[13.5px] font-semibold text-theme-fg">{opt.name}</div>
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                          <Download className="h-3 w-3" />
                          On-demand
                        </span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-[11.5px] text-theme-muted">{opt.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Section>

        {data && data.ok === false && (
          <div className="flex items-start gap-3 rounded-2xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-[12.5px] text-red-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-semibold">Could not load VM details</div>
              <p className="mt-0.5 text-red-300/80">{data.message || data.error || 'Unknown error.'}</p>
            </div>
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
          <div
            className={clsx(
              'pointer-events-auto flex items-center gap-2 rounded-full border px-4 py-2 text-[12px] font-semibold shadow-lg',
              toast.tone === 'ok'
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : 'border-red-500/30 bg-red-500/10 text-red-300',
            )}
          >
            {toast.tone === 'ok' ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
            {toast.text}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Local primitives ─────────────────────────────────────────────────── */

function Section({
  title,
  subtitle,
  icon: Icon,
  accent = 'muted',
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  icon: any;
  accent?: 'primary' | 'muted';
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className={clsx(
            'flex h-9 w-9 items-center justify-center rounded-xl',
            accent === 'primary' ? 'bg-primary/10 text-primary' : 'bg-theme-card text-theme-muted',
          )}>
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold leading-tight text-theme-fg">{title}</h2>
            {subtitle && <p className="mt-1 text-[12px] text-theme-muted">{subtitle}</p>}
          </div>
        </div>
        {right}
      </div>
      <div>{children}</div>
    </section>
  );
}

function SyncRow({
  icon: Icon,
  title,
  subtitle,
  actionLabel,
  onAction,
  busy = false,
  disabled = false,
}: {
  icon: any;
  title: string;
  subtitle: string;
  actionLabel: string;
  onAction: () => void | Promise<void>;
  busy?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-theme/20 bg-zinc-500/5 p-3.5">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-theme-card text-theme-muted">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-semibold text-theme-fg">{title}</div>
        <p className="mt-0.5 line-clamp-2 text-[11.5px] text-theme-muted">{subtitle}</p>
      </div>
      <button
        type="button"
        onClick={() => void onAction()}
        disabled={busy || disabled}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-[11.5px] font-semibold text-primary-fg shadow-sm transition hover:opacity-90 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        {actionLabel}
      </button>
    </div>
  );
}
