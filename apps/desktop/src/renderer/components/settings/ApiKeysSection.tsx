/**
 * BYOK / Providers settings section.
 *
 * Security UX:
 *   - Plaintext key lives only in component state for the lifetime of the
 *     modal; on submit (success or failure) we zero it out.
 *   - <input type="password"> + autoComplete="off" + spellCheck={false}
 *     so password managers and IME don't snapshot it.
 *   - Server-side errors never include the key (see byok-api.toError).
 *   - The save call asserts an HTTPS / loopback transport before send;
 *     a non-HTTPS production endpoint is rejected client-side too.
 *   - We only ever display `last_four` from the server. The full key is
 *     never round-tripped back to the client.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Key, Loader2, Plus, Trash2, CheckCircle2, AlertCircle, Lock, ShieldCheck, X, Copy, FolderOpen, RefreshCw } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '../../lib/supabaseClient';
import {
  createByokClient,
  PROVIDER_DISPLAY,
  type ByokClient,
  type ByokKey,
  type ByokProvider,
  ByokError,
} from '../../utils/byok-api';

const SectionHeader = ({ title, description }: { title: string; description: string }) => (
  <div className="mb-6 border-b border-theme-sidebar pb-4">
    <h3 className="text-[18px] font-semibold font-stuard text-theme-fg tracking-tight mb-1">{title}</h3>
    <p className="text-[13px] text-theme-muted font-medium">{description}</p>
  </div>
);

async function getSupabaseAccessToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || null;
  } catch {
    return null;
  }
}

interface RowProps {
  display: typeof PROVIDER_DISPLAY[number];
  current: ByokKey | undefined;
  client: ByokClient;
  onChange: () => void;
}

function ProviderRow({ display, current, client, onChange }: RowProps) {
  const [showModal, setShowModal] = useState(false);
  const [busy, setBusy] = useState<null | 'toggle' | 'delete' | 'test'>(null);
  const [testStatus, setTestStatus] = useState<null | { ok: boolean; message?: string }>(null);

  const enabled = !!current?.enabled;

  const onToggle = useCallback(async () => {
    if (!current) return;
    setBusy('toggle');
    try {
      await client.toggle(display.provider, !enabled);
      onChange();
    } catch (e: any) {
      console.warn('[byok] toggle failed:', (e as ByokError)?.code || 'unknown');
    } finally {
      setBusy(null);
    }
  }, [client, current, display.provider, enabled, onChange]);

  const onDelete = useCallback(async () => {
    if (!current) return;
    if (!window.confirm(`Remove your ${display.name} key from Stuard?`)) return;
    setBusy('delete');
    try {
      await client.remove(display.provider);
      onChange();
    } catch (e: any) {
      console.warn('[byok] delete failed:', (e as ByokError)?.code || 'unknown');
    } finally {
      setBusy(null);
    }
  }, [client, current, display.name, display.provider, onChange]);

  const onTest = useCallback(async () => {
    if (!current) return;
    setBusy('test');
    setTestStatus(null);
    try {
      const r = await client.test(display.provider);
      setTestStatus({ ok: r.ok, message: r.ok ? `OK (${r.status})` : (r.message || `Failed (${r.status})`) });
    } catch (e: any) {
      setTestStatus({ ok: false, message: (e as ByokError)?.code || 'test_failed' });
    } finally {
      setBusy(null);
      setTimeout(() => setTestStatus(null), 4000);
    }
  }, [client, current, display.provider]);

  return (
    <div className="dashboard-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Key className="h-3.5 w-3.5 text-primary" />
            <div className="text-[14px] font-semibold text-theme-fg tracking-tight">{display.name}</div>
            {current && (
              <span className={clsx(
                'rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-tight',
                enabled ? 'bg-emerald-500/15 text-emerald-500' : 'bg-theme-hover text-theme-muted',
              )}>
                {enabled ? 'Active' : 'Disabled'}
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[12px] text-theme-muted font-medium">{display.hint}</div>
          {current && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-theme-muted font-mono">
              {current.last_four && <span>•••• {current.last_four}</span>}
              {current.account_email && <span className="font-sans">{current.account_email}</span>}
              {current.base_url && <span className="font-sans truncate max-w-[28ch]" title={current.base_url}>{current.base_url}</span>}
            </div>
          )}
          {testStatus && (
            <div className={clsx(
              'mt-2 flex items-center gap-1.5 text-[11px] font-medium',
              testStatus.ok ? 'text-emerald-500' : 'text-red-500',
            )}>
              {testStatus.ok ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
              <span className="truncate">{testStatus.message}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {current ? (
            <>
              <button
                type="button"
                onClick={onTest}
                disabled={busy !== null}
                className="rounded-lg border border-theme px-3 py-1.5 text-[11px] font-semibold text-theme-fg hover:bg-theme-hover transition-all disabled:opacity-50"
              >
                {busy === 'test' ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Test'}
              </button>
              <button
                type="button"
                onClick={onToggle}
                disabled={busy !== null}
                className="rounded-lg border border-theme px-3 py-1.5 text-[11px] font-semibold text-theme-fg hover:bg-theme-hover transition-all disabled:opacity-50"
              >
                {busy === 'toggle' ? <Loader2 className="h-3 w-3 animate-spin" /> : (enabled ? 'Disable' : 'Enable')}
              </button>
              <button
                type="button"
                onClick={onDelete}
                disabled={busy !== null}
                className="rounded-lg border border-red-500/30 px-2.5 py-1.5 text-[11px] font-semibold text-red-500 hover:bg-red-500/10 transition-all disabled:opacity-50"
                title="Remove key"
              >
                {busy === 'delete' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
              </button>
              <button
                type="button"
                onClick={() => setShowModal(true)}
                className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-1.5 text-[11px] font-semibold text-primary hover:bg-primary/10 transition-all"
              >
                Replace
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setShowModal(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3 py-1.5 text-[11px] font-semibold text-primary hover:bg-primary/10 transition-all"
            >
              <Plus className="h-3 w-3" />
              Add key
            </button>
          )}
        </div>
      </div>

      {showModal && (
        <AddKeyModal display={display} client={client} onClose={() => setShowModal(false)} onSaved={() => { setShowModal(false); onChange(); }} />
      )}
    </div>
  );
}

function AddKeyModal({
  display,
  client,
  onClose,
  onSaved,
}: {
  display: typeof PROVIDER_DISPLAY[number];
  client: ByokClient;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = useCallback(async () => {
    setErr(null);
    if (!apiKey.trim()) { setErr('Enter your API key.'); return; }
    if (display.needsBaseUrl && !baseUrl.trim()) { setErr('Base URL is required for OpenAI-compatible providers.'); return; }
    setBusy(true);
    try {
      await client.save({
        provider: display.provider,
        apiKey: apiKey.trim(),
        baseUrl: display.needsBaseUrl ? baseUrl.trim() : null,
      });
      // Belt-and-braces: zero the in-memory copies before unmount.
      setApiKey('');
      setBaseUrl('');
      onSaved();
    } catch (e: any) {
      const code = (e as ByokError)?.code || 'save_failed';
      if (code === 'insecure_transport') {
        setErr('Refused to send your key over an insecure connection. Use the HTTPS endpoint.');
      } else if (code === 'not_authenticated') {
        setErr('Not signed in. Please sign in and try again.');
      } else {
        setErr(`Save failed: ${code}`);
      }
    } finally {
      setBusy(false);
    }
  }, [apiKey, baseUrl, client, display.needsBaseUrl, display.provider, onSaved]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-theme bg-theme-bg p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-[16px] font-semibold text-theme-fg tracking-tight">Add {display.name} key</h3>
            <p className="mt-0.5 text-[12px] text-theme-muted">{display.hint}</p>
          </div>
          <button onClick={onClose} className="text-theme-muted hover:text-theme-fg">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); void submit(); }}
          autoComplete="off"
        >
          {/* Honeypot to discourage browser autofill */}
          <input type="text" name="username" autoComplete="username" className="hidden" />

          <label className="block text-[12px] font-semibold text-theme-fg mb-1.5">API key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={display.keyHint || 'sk-…'}
            autoComplete="new-password"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            data-1p-ignore
            data-lpignore="true"
            className="w-full rounded-lg border border-theme bg-theme-hover/40 px-3 py-2 font-mono text-[12px] text-theme-fg placeholder:text-theme-muted/50 focus:border-primary focus:outline-none"
            disabled={busy}
          />

          {display.needsBaseUrl && (
            <>
              <label className="mt-3 block text-[12px] font-semibold text-theme-fg mb-1.5">Base URL</label>
              <input
                type="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.together.xyz/v1"
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                className="w-full rounded-lg border border-theme bg-theme-hover/40 px-3 py-2 font-mono text-[12px] text-theme-fg placeholder:text-theme-muted/50 focus:border-primary focus:outline-none"
                disabled={busy}
              />
            </>
          )}

          {err && (
            <div className="mt-3 flex items-center gap-1.5 text-[11px] font-medium text-red-500">
              <AlertCircle className="h-3 w-3" /> {err}
            </div>
          )}

          <div className="mt-4 flex items-center gap-1.5 text-[10px] text-theme-muted/80 font-medium">
            <Lock className="h-3 w-3" />
            Sent over TLS, encrypted with AES-256-GCM at rest, never logged.
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-theme px-3 py-2 text-[12px] font-semibold text-theme-fg hover:bg-theme-hover transition-all"
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !apiKey.trim() || (display.needsBaseUrl && !baseUrl.trim())}
              className="rounded-lg bg-primary px-3 py-2 text-[12px] font-semibold text-white hover:opacity-90 transition-all disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save key'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Codex (ChatGPT subscription) card ─────────────────────────────────────
// The Codex card looks similar to a provider row but everything plumbing is
// different: auth lives in the user's local `codex` CLI, the desktop reads
// ~/.codex/auth.json and pushes tokens to cloud-ai. There's no API key entry,
// no "Test" button, no replace flow.

type CodexStatus = Awaited<ReturnType<NonNullable<typeof window.desktopAPI>['codexStatus']>>;

/** "plus" → "ChatGPT Plus", "pro" → "ChatGPT Pro", etc. */
function formatPlanType(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = String(raw).toLowerCase().trim();
  switch (v) {
    case 'free':       return 'ChatGPT Free';
    case 'plus':       return 'ChatGPT Plus';
    case 'pro':        return 'ChatGPT Pro';
    case 'business':   return 'ChatGPT Business';
    case 'enterprise': return 'ChatGPT Enterprise';
    case 'edu':        return 'ChatGPT Edu';
    case 'team':       return 'ChatGPT Team';
    default: return v.split(/[\s_-]+/).map(w => w ? w[0].toUpperCase() + w.slice(1) : '').join(' ') || raw;
  }
}

function formatRelativeTime(ms: number | null | undefined): string | null {
  if (!ms) return null;
  const delta = Date.now() - ms;
  if (delta < 0) return 'just now';
  const sec = Math.floor(delta / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

function CodexCard({ onChange }: { onChange: () => void }) {
  const [status, setStatus] = useState<CodexStatus | null>(null);
  const [busy, setBusy] = useState<null | 'sync' | 'login' | 'reveal'>(null);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const s = await window.desktopAPI.codexStatus();
      setStatus(s);
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => { void refresh(); }, 8000);
    return () => clearInterval(t);
  }, [refresh]);

  const onLogin = useCallback(async () => {
    setBusy('login');
    setFeedback(null);
    try {
      const r = await window.desktopAPI.codexOpenLogin();
      if (r.ok) {
        setFeedback({ kind: 'ok', text: 'Codex CLI launched — finish sign-in in your browser, then click Sync.' });
      } else {
        setFeedback({ kind: 'err', text: r.error || 'Could not launch codex login.' });
      }
    } catch (e: any) {
      setFeedback({ kind: 'err', text: e?.message || 'launch_failed' });
    } finally {
      setBusy(null);
    }
  }, []);

  const onSync = useCallback(async () => {
    setBusy('sync');
    setFeedback(null);
    try {
      const r = await window.desktopAPI.codexSyncToCloud({ force: true });
      if (r.ok) {
        setFeedback({ kind: 'ok', text: r.skipped ? 'Already up to date.' : 'Tokens synced to cloud.' });
        await refresh();
        onChange();
      } else {
        setFeedback({ kind: 'err', text: `Sync failed: ${r.error || 'unknown'}` });
      }
    } finally {
      setBusy(null);
      setTimeout(() => setFeedback(null), 5000);
    }
  }, [refresh, onChange]);

  const onCopyInstall = useCallback(async () => {
    try {
      await navigator.clipboard.writeText('npm install -g @openai/codex');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }, []);

  const installed = !!status?.installed;
  const signedIn = !!status?.signedIn;
  const lastSync = formatRelativeTime(status?.lastSyncedAtMs);

  return (
    <div className="dashboard-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="text-[14px] font-semibold text-theme-fg tracking-tight">ChatGPT (Codex sign-in)</div>
            {signedIn && (
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-500 tracking-tight">
                Active
              </span>
            )}
            {!installed && (
              <span className="rounded-full bg-theme-hover px-2 py-0.5 text-[10px] font-semibold text-theme-muted tracking-tight">
                CLI not detected
              </span>
            )}
          </div>
          {!signedIn && (
            <div className="mt-0.5 text-[12px] text-theme-muted font-medium">
              Use your ChatGPT Plus / Pro / Business plan for inference. Sign-in is handled by the official Codex CLI; we just sync the resulting tokens to cloud so they can be used with Stuard's tools.
            </div>
          )}
          {signedIn && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-theme-muted">
              {status?.accountEmail && <span className="font-medium text-theme-fg">{status.accountEmail}</span>}
              {status?.planType && (
                <span className="rounded-md bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-600 dark:text-cyan-400 tracking-tight">
                  {formatPlanType(status.planType)}
                </span>
              )}
              {lastSync && <span className="text-[11px]">· synced {lastSync}</span>}
            </div>
          )}
          {!installed && (
            <div className="mt-3 rounded-lg border border-theme bg-theme-hover/40 p-3">
              <div className="text-[11px] font-semibold text-theme-fg mb-1.5">Install the Codex CLI first:</div>
              <button
                type="button"
                onClick={onCopyInstall}
                className="inline-flex items-center gap-1.5 rounded-md border border-theme bg-theme-bg px-2.5 py-1.5 font-mono text-[11px] text-theme-fg hover:bg-theme-hover transition-all"
              >
                {copied ? <CheckCircle2 className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                npm install -g @openai/codex
              </button>
              <div className="mt-2 text-[10px] text-theme-muted/80 font-medium">
                Then click "Sign in with Codex CLI" below — Codex CLI opens your browser for the official OpenAI OAuth flow.
              </div>
            </div>
          )}
          {feedback && (
            <div className={clsx(
              'mt-2 flex items-center gap-1.5 text-[11px] font-medium',
              feedback.kind === 'ok' ? 'text-emerald-500' : 'text-red-500',
            )}>
              {feedback.kind === 'ok' ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
              <span>{feedback.text}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {signedIn ? (
            <>
              <button
                type="button"
                onClick={onSync}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 rounded-lg border border-theme px-3 py-1.5 text-[11px] font-semibold text-theme-fg hover:bg-theme-hover transition-all disabled:opacity-50"
              >
                {busy === 'sync' ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                Sync
              </button>
              <button
                type="button"
                onClick={() => window.desktopAPI.codexRevealDir()}
                className="rounded-lg border border-theme p-1.5 text-theme-fg hover:bg-theme-hover transition-all"
                title="Open ~/.codex"
              >
                <FolderOpen className="h-3 w-3" />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onLogin}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3 py-1.5 text-[11px] font-semibold text-primary hover:bg-primary/10 transition-all disabled:opacity-50"
            >
              {busy === 'login' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              Sign in with Codex CLI
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function ApiKeysSection() {
  const client = useMemo(() => createByokClient(getSupabaseAccessToken), []);
  const [keys, setKeys] = useState<ByokKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setErr(null);
    try {
      const list = await client.list();
      setKeys(list);
    } catch (e: any) {
      setErr((e as ByokError)?.code || 'load_failed');
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => { void refresh(); }, [refresh]);

  const byProvider = useMemo(() => {
    const m = new Map<ByokProvider, ByokKey>();
    for (const k of keys) m.set(k.provider, k);
    return m;
  }, [keys]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-4 py-4 md:px-6 md:py-4">
        <SectionHeader
          title="Providers / API Keys"
          description="By default Stuard handles model billing for you. Add your own provider keys here to bill against your own account instead."
        />

        <div className="mb-4 flex items-start gap-2 rounded-xl border border-theme bg-theme-hover/40 p-4">
          <ShieldCheck className="mt-0.5 h-4 w-4 flex-none text-primary" />
          <div className="text-[12px] text-theme-muted leading-relaxed">
            Keys are encrypted with AES-256-GCM using a per-user key derived from a server-side master pepper, sent only over TLS, and never logged. Stuard never returns your key to the client — only the last 4 characters.
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-[12px] text-theme-muted">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading…
          </div>
        ) : err ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-[12px] text-red-500">
            Failed to load keys: {err}
          </div>
        ) : (
          <div className="space-y-3">
            {PROVIDER_DISPLAY.map((d) => (
              <ProviderRow
                key={d.provider}
                display={d}
                current={byProvider.get(d.provider)}
                client={client}
                onChange={refresh}
              />
            ))}
            <CodexCard onChange={refresh} />
          </div>
        )}
      </div>
    </div>
  );
}
