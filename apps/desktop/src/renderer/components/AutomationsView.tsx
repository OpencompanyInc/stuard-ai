import React from "react";
import { Zap, Play, Square, RefreshCw, Box } from "lucide-react";
import { clsx } from 'clsx';

interface AutomationsViewProps {
  stuards: any[];
  stuardsLoading: boolean;
  loadStuards: () => Promise<void> | void;
}

export const AutomationsView: React.FC<AutomationsViewProps> = ({
  stuards,
  stuardsLoading,
  loadStuards,
}) => {
  return (
    <div className="pb-12 max-w-6xl mx-auto">
      {/* Header Section */}
      <div className="flex items-center justify-between mb-8">
        <div className="space-y-1">
          <h2 className="text-3xl font-stuard text-theme-fg tracking-tight">Automations</h2>
          <p className="text-theme-muted text-sm font-medium">Manage your deployed local agents and workflows.</p>
        </div>
        <button
          onClick={loadStuards}
          className="p-2 rounded-theme-button hover:bg-theme-hover text-theme-muted hover:text-theme-fg transition-all border border-transparent hover:border-theme"
          title="Refresh Stuards"
        >
          <RefreshCw className={clsx("w-4 h-4", stuardsLoading && "animate-spin")} />
        </button>
      </div>

      {/* Content */}
      <div className="space-y-6" data-onboarding="automations-list">
        {stuards.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 px-4 text-center bg-theme-card rounded-theme-card border border-theme border-dashed">
            <div className="w-16 h-16 bg-theme-hover rounded-full flex items-center justify-center mb-4 shadow-sm border border-theme">
              <Box className="w-8 h-8 text-theme-muted" />
            </div>
            <h3 className="text-sm font-semibold text-theme-fg mb-1">No automations deployed</h3>
            <p className="text-xs text-theme-muted max-w-xs mb-6 font-medium">Create and deploy autonomous agents from the Workflows tab to see them here.</p>
            <button 
              className="px-4 py-2 bg-primary text-primary-fg rounded-theme-button text-xs font-medium hover:opacity-90 transition-all shadow-sm"
              onClick={() => { /* Navigate to Workflows if possible, or just let user know */ }}
            >
              Create Automation
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {stuards.map((s: any) => (
              <div key={s.id} className="group relative bg-theme-card rounded-theme-card border border-theme p-5 shadow-sm hover:border-theme transition-all duration-200 flex flex-col">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-md bg-theme-hover border border-theme flex items-center justify-center shadow-inner">
                      <Zap className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <h4 className="text-[14px] font-bold text-theme-fg truncate max-w-[160px]">{s.name || s.id}</h4>
                      <div className="text-[11px] font-medium text-theme-muted truncate max-w-[160px] font-mono opacity-80">{s.id}</div>
                    </div>
                  </div>
                  <span className={clsx(
                    "px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase border flex items-center gap-1.5",
                    s.hasRuntime 
                      ? "bg-emerald-900/30 text-emerald-400 border-emerald-900/50" 
                      : "bg-theme-hover text-theme-muted border-theme"
                  )}>
                    <span className={clsx("w-1.5 h-1.5 rounded-full", s.hasRuntime ? "bg-emerald-500 animate-pulse" : "bg-theme-muted")} />
                    {s.hasRuntime ? 'Running' : 'Stopped'}
                  </span>
                </div>

                <div className="mb-6 flex-1">
                  <div className="text-[10px] font-bold text-theme-muted uppercase tracking-wider mb-2">Triggers</div>
                  {Array.isArray(s.triggers) && s.triggers.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {s.triggers.map((t: string) => (
                        <span key={t} className="px-2 py-1 rounded-sm bg-theme-hover border border-theme text-[10px] font-medium text-theme-fg font-mono">
                          {t}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-[11px] text-theme-muted italic font-medium">No active triggers configured</span>
                  )}
                </div>

                <div className="flex items-center gap-2 pt-4 border-t border-theme mt-auto">
                  <button
                    onClick={async () => { try { await (window as any).desktopAPI?.stuardsRun?.(s.id); } catch {} }}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-theme-button bg-theme-hover text-theme-fg text-[11px] font-bold hover:bg-theme-active hover:text-theme-fg transition-all shadow-sm border border-theme"
                  >
                    <Play className="w-3 h-3 fill-current" />
                    Run Once
                  </button>
                  {s.hasRuntime && (
                    <button
                      onClick={async () => { try { await (window as any).desktopAPI?.stuardsStop?.(s.id); await loadStuards(); } catch {} }}
                      className="px-3 py-2 rounded-theme-button bg-red-900/20 border border-red-900/30 text-red-400 hover:bg-red-900/40 hover:text-red-300 transition-all"
                      title="Stop Background Process"
                    >
                      <Square className="w-3 h-3 fill-current" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
