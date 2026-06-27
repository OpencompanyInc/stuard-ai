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
    <div className="pb-16 max-w-6xl mx-auto">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10 relative overflow-hidden">
        <div className="absolute -top-8 -left-4 text-[100px] font-black text-theme-fg opacity-[0.02] select-none pointer-events-none font-stuard leading-none tracking-tighter">
          automations
        </div>
        <div className="space-y-2 relative z-10">
          <h2 className="text-5xl font-stuard text-theme-fg tracking-tight">Automations</h2>
          <p className="text-theme-muted text-sm font-medium pl-1">Manage your deployed local agents and workflows.</p>
        </div>
        <button
          onClick={loadStuards}
          className="p-3 rounded-xl bg-theme-hover/50 hover:bg-theme-hover text-theme-muted hover:text-theme-fg transition-all border border-theme/50 shadow-sm active:scale-95 relative z-10"
          title="Refresh Stuards"
        >
          <RefreshCw className={clsx("w-5 h-5", stuardsLoading && "animate-spin")} />
        </button>
      </div>

      {/* Content */}
      <div className="space-y-8 relative z-10" data-onboarding="automations-list">
        {stuards.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 px-6 text-center bg-theme-card rounded-3xl border border-theme/50 border-dashed shadow-sm relative overflow-hidden group">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 p-32 bg-gradient-to-br from-primary/5 to-transparent rounded-full blur-3xl pointer-events-none opacity-50 group-hover:opacity-100 transition-opacity duration-700"></div>
            <div className="w-20 h-20 bg-theme-hover/50 rounded-2xl flex items-center justify-center mb-6 shadow-inner border border-theme/50 relative z-10">
              <Box className="w-10 h-10 text-theme-muted/50" />
            </div>
            <h3 className="text-lg font-black text-theme-fg mb-2 tracking-tight relative z-10">No automations deployed</h3>
            <p className="text-[13px] text-theme-muted max-w-sm mb-8 font-medium leading-relaxed relative z-10">Create and deploy autonomous agents from the Workflows tab to see them here.</p>
            <button 
              className="px-6 py-3 bg-primary text-primary-fg rounded-xl text-[13px] font-black hover:opacity-90 hover:scale-105 hover:shadow-lg hover:shadow-primary/20 transition-all duration-300 active:scale-95 relative z-10"
              onClick={() => { /* Navigate to Workflows if possible, or just let user know */ }}
            >
              Create Automation
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {stuards.map((s: any) => (
              <div key={s.id} className="group relative bg-theme-card rounded-3xl border border-theme/50 p-6 shadow-lg hover:shadow-xl hover:border-primary/30 transition-all duration-500 flex flex-col overflow-hidden">
                <div className="absolute top-0 right-0 p-24 bg-gradient-to-bl from-primary/5 to-transparent rounded-full blur-2xl -mr-12 -mt-12 pointer-events-none opacity-50 group-hover:opacity-100 transition-opacity duration-700"></div>
                
                <div className="flex items-start justify-between mb-6 relative z-10">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-theme-hover/50 border border-theme/50 flex items-center justify-center shadow-inner group-hover:bg-theme-card group-hover:border-primary/30 transition-colors duration-300">
                      <Zap className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <h4 className="text-[15px] font-black text-theme-fg truncate max-w-[160px] tracking-tight group-hover:text-primary transition-colors duration-300">{s.name || s.id}</h4>
                      <div className="text-[11px] font-bold text-theme-muted truncate max-w-[160px] font-mono opacity-60 mt-0.5">{s.id}</div>
                    </div>
                  </div>
                  <span className={clsx(
                    "px-3 py-1 rounded-lg text-[10px] font-black tracking-widest uppercase border flex items-center gap-2 shadow-sm",
                    s.hasRuntime 
                      ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" 
                      : "bg-theme-hover/50 text-theme-muted border-theme/50"
                  )}>
                    <span className={clsx("w-2 h-2 rounded-full", s.hasRuntime ? "bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-theme-muted/50")} />
                    {s.hasRuntime ? 'Running' : 'Stopped'}
                  </span>
                </div>

                <div className="mb-8 flex-1 relative z-10">
                  <div className="text-[11px] font-black text-theme-muted uppercase tracking-widest mb-3">Triggers</div>
                  {Array.isArray(s.triggers) && s.triggers.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {s.triggers.map((t: string) => (
                        <span key={t} className="px-3 py-1.5 rounded-lg bg-theme-hover/50 border border-theme/50 text-[11px] font-bold text-theme-fg font-mono shadow-sm">
                          {t}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-[12px] text-theme-muted italic font-medium">No active triggers configured</span>
                  )}
                </div>

                <div className="flex items-center gap-3 pt-5 border-t border-theme/50 mt-auto relative z-10">
                  <button
                    onClick={async () => { try { await (window as any).desktopAPI?.stuardsRun?.(s.id); } catch {} }}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-theme-hover/50 text-theme-fg text-[12px] font-black hover:bg-primary hover:text-primary-fg hover:border-primary transition-all duration-300 shadow-sm border border-theme/50 active:scale-95"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    Run Once
                  </button>
                  {s.hasRuntime && (
                    <button
                      onClick={async () => { try { await (window as any).desktopAPI?.stuardsStop?.(s.id); await loadStuards(); } catch {} }}
                      className="px-4 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 hover:bg-red-500 hover:text-white hover:shadow-lg hover:shadow-red-500/20 transition-all duration-300 active:scale-95"
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
