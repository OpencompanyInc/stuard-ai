import React, { useCallback, useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import {
  Shield, ShieldCheck, ShieldAlert, ShieldOff,
  Plus, X, Loader2, Save, RefreshCw,
  Terminal, FileEdit, AlertTriangle,
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

const CLOUD_AI_HTTP = (window as any).__CLOUD_AI_HTTP__ || (import.meta as any).env?.VITE_CLOUD_AI_URL || 'http://127.0.0.1:8082';

interface PermissionsConfig {
  mode: 'auto' | 'manual' | 'selective';
  auto_approve: string[];
  always_require: string[];
}

const DEFAULT_CONFIG: PermissionsConfig = {
  mode: 'manual',
  auto_approve: [],
  always_require: [],
};

// Well-known sensitive tools for quick toggle UI
const KNOWN_TOOLS = [
  { id: 'run_command', label: 'Run Command', desc: 'Execute shell commands', icon: Terminal, risk: 'high' as const },
  { id: 'write_file', label: 'Write File', desc: 'Create or overwrite files', icon: FileEdit, risk: 'medium' as const },
  { id: 'terminal_create', label: 'Create Terminal', desc: 'Open new terminal sessions', icon: Terminal, risk: 'medium' as const },
  { id: 'terminal_send_input', label: 'Terminal Input', desc: 'Send input to terminal', icon: Terminal, risk: 'medium' as const },
  { id: 'terminal_send_raw', label: 'Terminal Raw', desc: 'Send raw input to terminal', icon: Terminal, risk: 'medium' as const },
  { id: 'terminal_send_keys', label: 'Terminal Keys', desc: 'Send keystrokes to terminal', icon: Terminal, risk: 'medium' as const },
  { id: 'terminal_destroy', label: 'Close Terminal', desc: 'Close terminal sessions', icon: Terminal, risk: 'low' as const },
];

function buildVmWsUrl(): string {
  const base = String(CLOUD_AI_HTTP).replace(/\/+$/, '');
  if (base.startsWith('https://')) {
    return `wss://${base.slice('https://'.length)}/vm/ws`;
  }
  return `ws://${base.replace(/^http:\/\//, '')}/vm/ws`;
}

export function CloudVmPermissions({
  engine,
  className,
  variant = 'default',
}: {
  engine: any;
  className?: string;
  variant?: 'default' | 'workspace';
}) {
  const [config, setConfig] = useState<PermissionsConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [customTool, setCustomTool] = useState('');
  const [dirty, setDirty] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const resolveRef = useRef<((data: any) => void) | null>(null);

  const isRunning = engine?.status === 'running';

  // One-shot WebSocket message: connect, send, receive, close
  const sendWsMessage = useCallback(async (msg: any): Promise<any> => {
    let token: string | null = null;
    try {
      const { data } = await supabase.auth.getSession();
      token = data?.session?.access_token || null;
    } catch {}

    return new Promise((resolve, reject) => {
      const wsUrl = buildVmWsUrl();
      const urlWithAuth = token ? `${wsUrl}?token=${encodeURIComponent(token)}` : wsUrl;
      const ws = new WebSocket(urlWithAuth);
      let done = false;
      const timeout = setTimeout(() => {
        if (!done) { done = true; ws.close(); reject(new Error('timeout')); }
      }, 10000);

      ws.onopen = () => {
        if (token) ws.send(JSON.stringify({ type: 'auth', accessToken: token }));
        ws.send(JSON.stringify(msg));
      };
      ws.onmessage = (event) => {
        try {
          const resp = JSON.parse(event.data);
          if (resp.type === 'handshake' || resp.type === 'auth_result') return;
          if (resp.type === 'permissions') {
            done = true;
            clearTimeout(timeout);
            ws.close();
            resolve(resp);
          }
        } catch {}
      };
      ws.onerror = () => {
        if (!done) { done = true; clearTimeout(timeout); reject(new Error('ws_error')); }
      };
      ws.onclose = () => {
        if (!done) { done = true; clearTimeout(timeout); reject(new Error('ws_closed')); }
      };
    });
  }, []);

  // Load current config
  const loadConfig = useCallback(async () => {
    if (!isRunning) return;
    setLoading(true);
    try {
      const resp = await sendWsMessage({ type: 'permissions_get' });
      if (resp.ok && resp.config) {
        setConfig({
          mode: resp.config.mode || 'manual',
          auto_approve: Array.isArray(resp.config.auto_approve) ? resp.config.auto_approve : [],
          always_require: Array.isArray(resp.config.always_require) ? resp.config.always_require : [],
        });
      }
    } catch {
      // Use defaults
    }
    setLoading(false);
    setDirty(false);
  }, [isRunning, sendWsMessage]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // Save config
  const saveConfig = useCallback(async () => {
    if (!isRunning) return;
    setSaving(true);
    try {
      const resp = await sendWsMessage({ type: 'permissions_update', config });
      if (resp.ok && resp.config) {
        setConfig({
          mode: resp.config.mode || 'manual',
          auto_approve: Array.isArray(resp.config.auto_approve) ? resp.config.auto_approve : [],
          always_require: Array.isArray(resp.config.always_require) ? resp.config.always_require : [],
        });
      }
    } catch {}
    setSaving(false);
    setDirty(false);
  }, [isRunning, config, sendWsMessage]);

  const updateMode = (mode: PermissionsConfig['mode']) => {
    setConfig((prev) => ({ ...prev, mode }));
    setDirty(true);
  };

  const toggleToolApproval = (toolId: string) => {
    setConfig((prev) => {
      const list = new Set(prev.auto_approve);
      if (list.has(toolId)) {
        list.delete(toolId);
      } else {
        list.add(toolId);
      }
      return { ...prev, auto_approve: [...list] };
    });
    setDirty(true);
  };

  const addCustomTool = () => {
    const t = customTool.trim().toLowerCase();
    if (!t) return;
    setConfig((prev) => {
      const list = new Set(prev.auto_approve);
      list.add(t);
      return { ...prev, auto_approve: [...list] };
    });
    setCustomTool('');
    setDirty(true);
  };

  const removeCustomTool = (toolId: string) => {
    setConfig((prev) => ({
      ...prev,
      auto_approve: prev.auto_approve.filter((t) => t !== toolId),
    }));
    setDirty(true);
  };

  if (!isRunning) {
    return (
      <div className={clsx('flex flex-col items-center justify-center text-theme-muted/50 gap-3 py-12', className)}>
        <Shield className="w-10 h-10" />
        <p className="text-sm font-semibold">Engine is not running</p>
        <p className="text-xs">Start your Cloud Computer to configure permissions.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={clsx('flex flex-col items-center justify-center gap-3 py-12', className)}>
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
        <p className="text-sm text-theme-muted">Loading permissions...</p>
      </div>
    );
  }

  const MODES = [
    {
      id: 'auto' as const,
      label: 'Automatic',
      desc: 'All tools run without approval. The VM agent works fully autonomously.',
      icon: ShieldOff,
      color: 'text-green-500',
      bg: 'bg-green-500/10',
      border: 'border-green-500/20',
    },
    {
      id: 'selective' as const,
      label: 'Selective',
      desc: 'Choose which tools run automatically. Others require your approval.',
      icon: ShieldCheck,
      color: 'text-amber-500',
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/20',
    },
    {
      id: 'manual' as const,
      label: 'Manual',
      desc: 'All sensitive tools require your explicit approval before running.',
      icon: ShieldAlert,
      color: 'text-red-500',
      bg: 'bg-red-500/10',
      border: 'border-red-500/20',
    },
  ];

  const autoApproveSet = new Set(config.auto_approve);
  const customTools = config.auto_approve.filter((t) => !KNOWN_TOOLS.some((k) => k.id === t));

  return (
    <div className={clsx('space-y-6', className)}>
      {/* Permission Mode */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-black text-theme-muted uppercase tracking-wider">Permission Mode</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={loadConfig}
              className="p-1.5 rounded-lg text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60 transition-colors"
              title="Refresh"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            {dirty && (
              <button
                onClick={saveConfig}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-fg text-xs font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                Save
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => updateMode(m.id)}
              className={clsx(
                'p-4 rounded-2xl border-2 text-left transition-all duration-200',
                config.mode === m.id
                  ? `${m.border} ${m.bg} shadow-lg`
                  : variant === 'workspace'
                    ? 'border-theme/10 bg-theme-card/20 hover:border-theme/20'
                    : 'border-theme/10 bg-theme-card/30 hover:border-theme/20',
              )}
            >
              <m.icon className={clsx('w-5 h-5 mb-2', config.mode === m.id ? m.color : 'text-theme-muted')} />
              <div className="text-sm font-black text-theme-fg">{m.label}</div>
              <div className="text-[10px] text-theme-muted mt-1 leading-relaxed">{m.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Per-Tool Settings (only in selective mode) */}
      {config.mode === 'selective' && (
        <div>
          <h3 className="text-xs font-black text-theme-muted uppercase tracking-wider mb-4">Auto-Approve Tools</h3>
          <div className="space-y-2">
            {KNOWN_TOOLS.map((tool) => {
              const isApproved = autoApproveSet.has(tool.id);
              const riskColors = {
                high: 'text-red-500 bg-red-500',
                medium: 'text-amber-500 bg-amber-500',
                low: 'text-blue-500 bg-blue-500',
              };

              return (
                <button
                  key={tool.id}
                  onClick={() => toggleToolApproval(tool.id)}
                  className={clsx(
                    'w-full flex items-center gap-3 p-3 rounded-xl border transition-all duration-200 text-left',
                    isApproved
                      ? 'border-green-500/20 bg-green-500/5'
                      : variant === 'workspace'
                        ? 'border-theme/10 bg-theme-card/10 hover:border-theme/20'
                        : 'border-theme/10 bg-theme-card/20 hover:border-theme/20',
                  )}
                >
                  <tool.icon className={clsx('w-4 h-4 shrink-0', isApproved ? 'text-green-500' : 'text-theme-muted')} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-theme-fg">{tool.label}</span>
                      <span className={clsx('text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full text-white', riskColors[tool.risk])}>
                        {tool.risk}
                      </span>
                    </div>
                    <div className="text-[10px] text-theme-muted">{tool.desc}</div>
                  </div>
                  <div className={clsx(
                    'w-8 h-5 rounded-full transition-colors duration-200 relative',
                    isApproved ? 'bg-green-500' : 'bg-theme-hover',
                  )}>
                    <div className={clsx(
                      'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200',
                      isApproved ? 'translate-x-3.5' : 'translate-x-0.5',
                    )} />
                  </div>
                </button>
              );
            })}
          </div>

          {/* Custom tool patterns */}
          <div className="mt-4">
            <div className="text-[10px] text-theme-muted font-bold uppercase tracking-wider mb-2">
              Custom patterns (e.g. browser_use_*)
            </div>
            <div className="flex items-center gap-2 mb-2">
              <input
                value={customTool}
                onChange={(e) => setCustomTool(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addCustomTool()}
                placeholder="tool_name or pattern*"
                className="flex-1 bg-theme-hover/40 rounded-lg px-3 py-1.5 text-sm text-theme-fg placeholder-theme-muted/50 outline-none focus:ring-1 focus:ring-primary/20"
              />
              <button
                onClick={addCustomTool}
                disabled={!customTool.trim()}
                className="p-1.5 rounded-lg bg-primary text-primary-fg hover:opacity-90 transition-opacity disabled:opacity-30"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
            {customTools.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {customTools.map((t) => (
                  <span key={t} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-green-500/10 text-green-500 text-[11px] font-mono font-bold">
                    {t}
                    <button onClick={() => removeCustomTool(t)} className="hover:text-red-500 transition-colors">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Info box */}
      <div className={clsx(
        variant === 'workspace'
          ? 'dashboard-card p-4'
          : 'rounded-2xl border border-theme/10 bg-theme-card/20 p-4',
      )}>
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <div className="text-xs text-theme-muted leading-relaxed">
            <strong className="text-theme-fg">How it works:</strong> When the VM agent needs to run a sensitive tool
            (like executing a command or writing a file), it checks these permission settings.
            In <strong>Automatic</strong> mode, everything runs without asking.
            In <strong>Selective</strong> mode, only the tools you enable run automatically — the rest
            show an approval prompt in the Chat tab.
            In <strong>Manual</strong> mode, every sensitive action requires your explicit approval.
          </div>
        </div>
      </div>
    </div>
  );
}
