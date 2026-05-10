'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { clsx } from 'clsx';
import {
  AlertCircle,
  FileEdit,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Terminal,
  X,
} from 'lucide-react';
import { getVmPermissions, setVmPermissions, type VmPermissionsConfig } from '@/lib/cloudApi';

interface Props {
  engine: any;
  className?: string;
}

const DEFAULT_CONFIG: VmPermissionsConfig = {
  mode: 'manual',
  auto_approve: [],
  always_require: [],
};

const KNOWN_TOOLS: Array<{
  id: string;
  label: string;
  desc: string;
  icon: any;
  risk: 'high' | 'medium' | 'low';
}> = [
  { id: 'run_command', label: 'Run Command', desc: 'Execute shell commands', icon: Terminal, risk: 'high' },
  { id: 'write_file', label: 'Write File', desc: 'Create or overwrite files', icon: FileEdit, risk: 'medium' },
  { id: 'terminal_create', label: 'Create Terminal', desc: 'Open new terminal sessions', icon: Terminal, risk: 'medium' },
  { id: 'terminal_send_input', label: 'Terminal Input', desc: 'Send input to terminal', icon: Terminal, risk: 'medium' },
  { id: 'terminal_send_raw', label: 'Terminal Raw', desc: 'Send raw input to terminal', icon: Terminal, risk: 'medium' },
  { id: 'terminal_send_keys', label: 'Terminal Keys', desc: 'Send keystrokes to terminal', icon: Terminal, risk: 'medium' },
  { id: 'terminal_destroy', label: 'Close Terminal', desc: 'Close terminal sessions', icon: Terminal, risk: 'low' },
];

const MODES: Array<{
  id: VmPermissionsConfig['mode'];
  label: string;
  desc: string;
  icon: any;
  color: string;
  bg: string;
  border: string;
}> = [
  {
    id: 'auto',
    label: 'Automatic',
    desc: 'All tools run without approval. The VM agent works fully autonomously.',
    icon: ShieldOff,
    color: 'text-green-500',
    bg: 'bg-green-500/10',
    border: 'border-green-500/40',
  },
  {
    id: 'selective',
    label: 'Selective',
    desc: 'Choose which tools run automatically. Others require your approval.',
    icon: ShieldCheck,
    color: 'text-amber-500',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/40',
  },
  {
    id: 'manual',
    label: 'Manual',
    desc: 'All sensitive tools require your explicit approval before running.',
    icon: ShieldAlert,
    color: 'text-red-500',
    bg: 'bg-red-500/10',
    border: 'border-red-500/40',
  },
];

export function CloudVmPermissions({ engine, className }: Props) {
  const [config, setConfig] = useState<VmPermissionsConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customTool, setCustomTool] = useState('');

  const isRunning = engine?.status === 'running';

  const loadConfig = useCallback(async () => {
    if (!isRunning) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await getVmPermissions();
      const cfg = (res as any)?.result?.config || (res as any)?.config;
      if (res.ok && cfg) {
        setConfig({
          mode: cfg.mode || 'manual',
          auto_approve: Array.isArray(cfg.auto_approve) ? cfg.auto_approve : [],
          always_require: Array.isArray(cfg.always_require) ? cfg.always_require : [],
        });
        setDirty(false);
      } else if (!res.ok) {
        setError(res.error || 'Could not load permissions from VM');
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load permissions');
    } finally {
      setLoading(false);
    }
  }, [isRunning]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const saveConfig = useCallback(async () => {
    if (!isRunning) return;
    setSaving(true);
    setError(null);
    try {
      const res = await setVmPermissions(config);
      if (!res.ok) {
        setError(res.error || 'Failed to save permissions');
      } else {
        setDirty(false);
        const cfg = (res as any)?.result?.config || (res as any)?.config;
        if (cfg) {
          setConfig({
            mode: cfg.mode || config.mode,
            auto_approve: Array.isArray(cfg.auto_approve) ? cfg.auto_approve : config.auto_approve,
            always_require: Array.isArray(cfg.always_require) ? cfg.always_require : config.always_require,
          });
        }
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to save permissions');
    } finally {
      setSaving(false);
    }
  }, [isRunning, config]);

  const updateMode = useCallback((mode: VmPermissionsConfig['mode']) => {
    setConfig((prev) => ({ ...prev, mode }));
    setDirty(true);
  }, []);

  const toggleToolApproval = useCallback((toolId: string) => {
    setConfig((prev) => {
      const list = new Set(prev.auto_approve);
      if (list.has(toolId)) list.delete(toolId);
      else list.add(toolId);
      return { ...prev, auto_approve: [...list] };
    });
    setDirty(true);
  }, []);

  const addCustomTool = useCallback(() => {
    const t = customTool.trim().toLowerCase();
    if (!t) return;
    setConfig((prev) => {
      const list = new Set(prev.auto_approve);
      list.add(t);
      return { ...prev, auto_approve: [...list] };
    });
    setCustomTool('');
    setDirty(true);
  }, [customTool]);

  const removeCustomTool = useCallback((toolId: string) => {
    setConfig((prev) => ({
      ...prev,
      auto_approve: prev.auto_approve.filter((t) => t !== toolId),
    }));
    setDirty(true);
  }, []);

  if (!isRunning) {
    return (
      <div className={clsx('flex flex-col items-center justify-center text-theme-muted gap-3 py-12', className)}>
        <Shield className="w-10 h-10" />
        <p className="text-sm font-semibold">Engine is not running</p>
        <p className="text-xs">Start your Cloud Engine to configure permissions.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={clsx('flex items-center justify-center h-full text-theme-muted', className)}>
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading permissions…
      </div>
    );
  }

  const autoApproveSet = new Set(config.auto_approve);
  const customTools = config.auto_approve.filter((t) => !KNOWN_TOOLS.some((k) => k.id === t));

  return (
    <div className={clsx('h-full overflow-y-auto custom-scrollbar p-6 space-y-6', className)}>
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-theme-fg tracking-tight">VM Permissions</h2>
          <p className="text-xs text-theme-muted mt-1 max-w-lg">
            Decide which tools your cloud agent can run on its own and which require your approval.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={loadConfig}
            className="p-1.5 rounded-lg text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60 transition-colors"
            title="Reload from VM"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          {dirty && (
            <button
              type="button"
              onClick={saveConfig}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-fg text-xs font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
              Save
            </button>
          )}
        </div>
      </header>

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-xs text-red-500 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <section>
        <h3 className="text-[10px] font-bold text-theme-muted uppercase tracking-wider mb-3">
          Permission Mode
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {MODES.map((m) => {
            const isActive = config.mode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => updateMode(m.id)}
                className={clsx(
                  'p-4 rounded-2xl border-2 text-left transition-all duration-200',
                  isActive
                    ? `${m.border} ${m.bg} shadow-md`
                    : 'border-theme bg-theme-card hover:border-theme-strong',
                )}
              >
                <m.icon className={clsx('w-5 h-5 mb-2', isActive ? m.color : 'text-theme-muted')} />
                <div className="text-sm font-bold text-theme-fg">{m.label}</div>
                <div className="text-[11px] text-theme-muted mt-1 leading-relaxed">{m.desc}</div>
              </button>
            );
          })}
        </div>
      </section>

      {config.mode === 'selective' && (
        <>
          <section>
            <h3 className="text-[10px] font-bold text-theme-muted uppercase tracking-wider mb-3">
              Auto-Approve Tools
            </h3>
            <div className="space-y-2">
              {KNOWN_TOOLS.map((tool) => {
                const isApproved = autoApproveSet.has(tool.id);
                const riskColor =
                  tool.risk === 'high'
                    ? 'bg-red-500'
                    : tool.risk === 'medium'
                      ? 'bg-amber-500'
                      : 'bg-blue-500';
                return (
                  <button
                    key={tool.id}
                    type="button"
                    onClick={() => toggleToolApproval(tool.id)}
                    className={clsx(
                      'w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all',
                      isApproved
                        ? 'border-primary/40 bg-primary/5'
                        : 'border-theme bg-theme-card hover:border-theme-strong',
                    )}
                  >
                    <div
                      className={clsx(
                        'flex h-9 w-9 items-center justify-center rounded-lg shrink-0',
                        isApproved ? 'bg-primary/15 text-primary' : 'bg-theme-hover/40 text-theme-muted',
                      )}
                    >
                      <tool.icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-bold text-theme-fg">{tool.label}</div>
                        <span
                          className={clsx(
                            'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider text-white',
                            riskColor,
                          )}
                        >
                          {tool.risk}
                        </span>
                      </div>
                      <div className="text-[11px] text-theme-muted mt-0.5">{tool.desc}</div>
                    </div>
                    <div
                      className={clsx(
                        'w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0',
                        isApproved
                          ? 'border-primary bg-primary'
                          : 'border-theme-muted',
                      )}
                    >
                      {isApproved && (
                        <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <h3 className="text-[10px] font-bold text-theme-muted uppercase tracking-wider mb-3">
              Custom Tools
            </h3>
            <div className="flex items-center gap-2 mb-3">
              <input
                type="text"
                value={customTool}
                onChange={(e) => setCustomTool(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addCustomTool();
                  }
                }}
                placeholder="Custom tool ID (e.g. browser_screenshot)"
                className="input-field flex-1 rounded-lg px-3 py-2 text-sm outline-none"
              />
              <button
                type="button"
                onClick={addCustomTool}
                disabled={!customTool.trim()}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-theme-hover/60 text-theme-fg text-xs font-bold hover:bg-theme-hover transition-colors disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            </div>
            {customTools.length === 0 ? (
              <div className="text-[11px] text-theme-muted italic">No custom tools added.</div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {customTools.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary px-2.5 py-1 text-[11px] font-mono"
                  >
                    {t}
                    <button
                      type="button"
                      onClick={() => removeCustomTool(t)}
                      className="text-current/70 hover:text-current"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
