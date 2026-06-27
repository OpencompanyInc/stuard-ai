import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Plug, Plus, Pencil, Trash2, RefreshCw } from "lucide-react";
import { useWorkflowTheme } from "../WorkflowThemeContext";
import {
  fetchInstalledIntegrations,
  setIntegrationEnabled,
  uninstallIntegration,
  type InstalledIntegration,
} from "../../utils/installedIntegrations";
import { confirmDialog } from "./ConfirmDialog";

interface CustomToolsViewProps {
  /** Open the Integration Builder with a fresh draft. */
  onNewTool: () => void;
  /** Open the Integration Builder seeded with an existing integration's manifest. */
  onEditTool: (manifest: any) => void;
}

function toolCount(integration: InstalledIntegration): number {
  const tools = integration.manifest?.tools;
  return Array.isArray(tools) ? tools.length : 0;
}

export function CustomToolsView({ onNewTool, onEditTool }: CustomToolsViewProps) {
  const { isDark } = useWorkflowTheme();
  const d = isDark;
  const [integrations, setIntegrations] = useState<InstalledIntegration[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchInstalledIntegrations();
      setIntegrations(list);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onChanged = () => void refresh();
    window.addEventListener("stuard:integrations-changed", onChanged);
    return () => window.removeEventListener("stuard:integrations-changed", onChanged);
  }, [refresh]);

  const handleToggle = useCallback(
    async (slug: string, enabled: boolean) => {
      setBusy((p) => ({ ...p, [slug]: true }));
      // Optimistic — flip locally, then reconcile on failure.
      setIntegrations((prev) => prev.map((i) => (i.slug === slug ? { ...i, enabled } : i)));
      const ok = await setIntegrationEnabled(slug, enabled);
      if (!ok) {
        setIntegrations((prev) => prev.map((i) => (i.slug === slug ? { ...i, enabled: !enabled } : i)));
      } else {
        try { window.dispatchEvent(new CustomEvent("stuard:integrations-changed")); } catch { /* noop */ }
      }
      setBusy((p) => ({ ...p, [slug]: false }));
    },
    []
  );

  const handleDelete = useCallback(
    async (integration: InstalledIntegration) => {
      const confirmed = await confirmDialog({
        title: `Delete “${integration.name || integration.slug}”?`,
        message: "This removes the custom tool from your agents, workflows, and chat. This can’t be undone.",
        confirmLabel: "Delete tool",
        tone: "danger",
      });
      if (!confirmed) return;
      setBusy((p) => ({ ...p, [integration.slug]: true }));
      const ok = await uninstallIntegration(integration.slug);
      if (ok) {
        setIntegrations((prev) => prev.filter((i) => i.slug !== integration.slug));
        try { window.dispatchEvent(new CustomEvent("stuard:integrations-changed")); } catch { /* noop */ }
      }
      setBusy((p) => ({ ...p, [integration.slug]: false }));
    },
    []
  );

  const enabledCount = useMemo(() => integrations.filter((i) => i.enabled).length, [integrations]);

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <div className="px-10 pt-10 pb-8 flex items-start justify-between gap-5 shrink-0">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight wf-fg">Custom Tools</h1>
          <div className="mt-2 text-[14px] wf-fg-muted">
            {integrations.length} custom tool{integrations.length !== 1 ? "s" : ""} · {enabledCount} enabled · usable by agents, workflows, and chat
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => void refresh()}
            className={`rounded-[14px] border px-4 py-3 text-[13px] font-medium transition-all ${d ? "border-white/10 bg-white/[0.03] text-white/80 hover:bg-white/[0.06]" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
          >
            <span className="flex items-center gap-2">
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </span>
          </button>
          <button
            type="button"
            onClick={onNewTool}
            className="wf-primary-btn rounded-[14px] px-4 py-3 text-[13px] font-semibold transition-all"
          >
            <span className="flex items-center gap-2">
              <Plus className="w-4 h-4" />
              New Custom Tool
            </span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-10 pb-10 scrollbar-minimal">
        {loading && integrations.length === 0 ? (
          <div className="py-16 flex flex-col items-center justify-center text-center">
            <div className="w-8 h-8 border-2 rounded-full animate-spin border-[color:var(--wf-border)] border-t-[color:var(--wf-accent)]" />
          </div>
        ) : integrations.length === 0 ? (
          <div className="py-16 flex flex-col items-center justify-center text-center">
            <div className={`w-16 h-16 shadow-sm rounded-full flex items-center justify-center mb-4 border ${d ? "bg-white/[0.03] border-white/10" : "bg-white border-slate-200"}`}>
              <Plug className={`w-7 h-7 ${d ? "text-white/50" : "text-slate-400"}`} />
            </div>
            <h3 className={`text-[16px] font-semibold ${d ? "text-white" : "text-slate-900"}`}>No custom tools yet</h3>
            <p className={`text-[14px] mt-1 max-w-md ${d ? "text-white/55" : "text-slate-500"}`}>
              Build a custom tool to connect any HTTP API. Once deployed, it's available to your agents, workflows, and chat.
            </p>
            <button
              type="button"
              onClick={onNewTool}
              className="wf-primary-btn mt-5 rounded-[14px] px-4 py-2.5 text-[13px] font-semibold transition-all"
            >
              <span className="flex items-center gap-2">
                <Plus className="w-4 h-4" />
                New Custom Tool
              </span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-12">
            {integrations.map((integration) => {
              const count = toolCount(integration);
              const isBusy = Boolean(busy[integration.slug]);
              return (
                <div
                  key={integration.slug}
                  className="wf-card wf-card-interactive group relative p-6 rounded-[24px] flex flex-col h-[200px]"
                >
                  <div className="flex items-center gap-3.5 mb-4">
                    <div className="wf-icon-chip group-hover:text-[color:var(--wf-accent)] transition-colors w-9 h-9 rounded-[12px] flex items-center justify-center shrink-0 text-[18px]">
                      {integration.icon ? (
                        <span>{integration.icon}</span>
                      ) : (
                        <Plug className="w-[18px] h-[18px]" />
                      )}
                    </div>
                    <h3 className="font-semibold text-[17px] truncate leading-none wf-fg flex-1">
                      {integration.name || integration.slug}
                    </h3>
                    <ToggleSwitch
                      d={d}
                      checked={integration.enabled}
                      disabled={isBusy}
                      onChange={(next) => void handleToggle(integration.slug, next)}
                    />
                  </div>

                  <p className="text-[14px] line-clamp-2 flex-1 leading-relaxed pr-2 wf-fg-muted">
                    {integration.description || "Custom integration — no description provided."}
                  </p>

                  <div className="mt-auto flex items-center justify-between pt-4 border-t" style={{ borderColor: "var(--wf-border)" }}>
                    <div className="flex items-center gap-1.5 text-[13px] font-medium wf-fg-faint">
                      <Plug className="w-3.5 h-3.5" />
                      <span>{count} tool{count !== 1 ? "s" : ""}</span>
                      <span className="opacity-40">·</span>
                      <span>v{integration.version}</span>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={() => onEditTool(integration.manifest)}
                        className="p-1.5 rounded-lg transition-colors wf-fg-faint hover:text-[color:var(--wf-accent)] hover:bg-[var(--wf-accent-soft)]"
                        title="Edit custom tool"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleDelete(integration)}
                        className={`p-1.5 rounded-lg transition-colors ${d ? "text-white/40 hover:text-red-400 hover:bg-red-500/10" : "text-slate-400 hover:text-red-600 hover:bg-red-50"}`}
                        title="Delete custom tool"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ToggleSwitch({ d, checked, disabled, onChange }: { d: boolean; checked: boolean; disabled?: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${disabled ? "opacity-50" : ""} ${checked ? "bg-emerald-500" : d ? "bg-white/15" : "bg-slate-300"}`}
      title={checked ? "Enabled" : "Disabled"}
    >
      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${checked ? "translate-x-[18px]" : "translate-x-[3px]"}`} />
    </button>
  );
}
