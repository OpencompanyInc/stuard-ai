import React from "react";
import { Search, Link2, RefreshCw, Play, Square, Box, Globe } from "lucide-react";
import { clsx } from 'clsx';

interface IntegrationsViewProps {
  connectedCount: number;
  filteredIntegrations: any[];
  intQuery: string;
  setIntQuery: (v: string) => void;
  intCategory: string;
  setIntCategory: (v: string) => void;
  intCategories: string[];
  connectedMap: Record<string, any>;
  handleConnect: (slug: string) => Promise<void> | void;
  handleDisconnect: (slug: string) => Promise<void> | void;
  handleLearnMore: (url: string) => void;
  pyStatus: any;
  ffStatus: any;
  pyEnvId: string;
  setPyEnvId: (v: string) => void;
  pyPackages: string;
  setPyPackages: (v: string) => void;
  pyReqTxt: string;
  setPyReqTxt: (v: string) => void;
  pyRunCode: string;
  setPyRunCode: (v: string) => void;
  pyInstalling: boolean;
  ffInstalling: boolean;
  pyRunning: boolean;
  pyRunResult: any;
  refreshPythonStatus: () => Promise<void> | void;
  refreshFfmpegStatus: () => Promise<void> | void;
  refreshBrowserStatus: () => Promise<void> | void;
  setupPython: () => Promise<void> | void;
  installPython: () => Promise<void> | void;
  runPython: () => Promise<void> | void;
  browserStatus: { connected: boolean; clients: number };
}

export const IntegrationsView: React.FC<IntegrationsViewProps> = ({
  connectedCount,
  filteredIntegrations,
  intQuery,
  setIntQuery,
  intCategory,
  setIntCategory,
  intCategories,
  connectedMap,
  handleConnect,
  handleDisconnect,
  handleLearnMore,
  pyStatus,
  ffStatus,
  pyEnvId,
  setPyEnvId,
  pyPackages,
  setPyPackages,
  pyReqTxt,
  setPyReqTxt,
  pyRunCode,
  setPyRunCode,
  pyInstalling,
  ffInstalling,
  pyRunning,
  pyRunResult,
  refreshPythonStatus,
  refreshFfmpegStatus,
  refreshBrowserStatus,
  setupPython,
  installPython,
  runPython,
  browserStatus,
}) => {
  return (
    <div className="pb-12 max-w-6xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8">
        <div className="space-y-1">
          <h2 className="text-3xl font-stuard text-theme-fg tracking-tight">Integrations</h2>
          <p className="text-theme-muted text-sm font-medium">Connect your tools and services.</p>
        </div>
        
        <div className="flex gap-3">
          <div className="relative group">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-theme-muted group-focus-within:text-theme-fg transition-colors" />
            <input
              value={intQuery}
              onChange={(e) => setIntQuery(e.target.value)}
              placeholder="Search tools..."
              className="pl-9 pr-4 py-2 rounded-theme-button border border-theme bg-theme-hover text-theme-fg text-[13px] font-medium shadow-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary w-64 transition-all placeholder:text-theme-muted"
            />
          </div>
          <select
            value={intCategory}
            onChange={(e) => setIntCategory(e.target.value)}
            className="px-4 py-2 rounded-theme-button border border-theme bg-theme-hover text-theme-fg text-[13px] font-medium shadow-sm focus:outline-none focus:border-primary cursor-pointer transition-all hover:bg-theme-active"
          >
            {intCategories.map((c) => (
              <option key={c} value={c} className="bg-theme-card text-theme-fg">{c}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="mb-6">
        <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-[11px] font-bold border border-primary/20">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
          </span>
          {connectedCount} Active Connections
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredIntegrations.length === 0 ? (
          <div className="col-span-full flex flex-col items-center justify-center py-20 text-center bg-theme-card rounded-theme-card border border-theme border-dashed">
            <div className="w-16 h-16 bg-theme-hover rounded-full flex items-center justify-center mb-4 shadow-sm border border-theme">
              <Box className="w-8 h-8 text-theme-muted" />
            </div>
            <p className="text-sm font-semibold text-theme-fg mb-1">No integrations found</p>
            <p className="text-xs text-theme-muted font-medium">Try adjusting your search or filters to find what you're looking for.</p>
          </div>
        ) : (
          filteredIntegrations.map((i: any) => {
            const isBrowser = i.slug === 'browser';
            const isConnected = isBrowser 
              ? browserStatus.connected
              : !!connectedMap[i.slug];
            const isPython = i.slug === 'python';
            const isFfmpeg = i.slug === 'ffmpeg';
            const ffAvailable = !!(ffStatus && (ffStatus as any).available);
            
            return (
              <div key={i.slug} className="group relative flex flex-col bg-theme-card rounded-theme-card border border-theme p-5 shadow-sm hover:border-theme hover:shadow-md transition-all duration-300">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-md bg-theme-hover border border-theme shadow-sm flex items-center justify-center text-[18px] font-bold text-theme-fg group-hover:scale-105 transition-transform duration-300">
                        {isBrowser ? <Globe className="w-5 h-5" /> : i.name[0]}
                    </div>
                    <div>
                      <h3 className="font-bold text-[14px] text-theme-fg tracking-tight">{i.name}</h3>
                      <span className="text-[10px] font-medium text-theme-muted px-1.5 py-0.5 bg-theme-hover rounded-sm inline-block mt-1">{i.category}</span>
                    </div>
                  </div>
                  {isConnected && (
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-900/20 text-emerald-400 text-[10px] font-bold border border-emerald-900/30 tracking-wide uppercase">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                      Active
                    </span>
                  )}
                  {!i.available && (
                    <span className="px-2 py-0.5 rounded-full bg-theme-hover text-theme-muted text-[10px] font-bold border border-theme tracking-wide uppercase">
                      Soon
                    </span>
                  )}
                </div>

                <p className="text-[12px] text-theme-muted leading-relaxed mb-5 line-clamp-2 flex-1 font-medium">
                  {i.description}
                </p>

                {isPython && (
                  <div className="mb-5 p-3 bg-theme-bg rounded-theme-card border border-theme space-y-3">
                    <div className="flex items-center justify-between text-[11px]">
                        <span className="font-semibold text-theme-muted uppercase tracking-wide">Runtime</span>
                        <span className={clsx("font-mono", pyStatus?.available ? "text-emerald-400" : "text-theme-muted")}>
                            {pyStatus?.available ? pyStatus.version : 'Not ready'}
                        </span>
                    </div>
                    <div className="flex gap-2">
                        <input 
                            value={pyEnvId} 
                            onChange={(e) => setPyEnvId(e.target.value)} 
                            placeholder="Environment ID" 
                            className="flex-1 px-2 py-1.5 rounded-theme-button border border-theme bg-theme-card text-theme-fg text-[11px] focus:outline-none focus:border-primary transition-all placeholder:text-theme-muted"
                        />
                        <button 
                            onClick={installPython}
                            disabled={pyInstalling || !pyEnvId}
                            className="px-3 py-1.5 bg-primary text-primary-fg text-[11px] font-bold rounded-theme-button hover:opacity-90 disabled:opacity-50 transition-all shadow-sm"
                        >
                            {pyInstalling ? '...' : 'Install'}
                        </button>
                    </div>
                  </div>
                )}

                {isFfmpeg && (
                  <div className="mb-5 p-3 bg-theme-bg rounded-theme-card border border-theme space-y-3">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-theme-muted uppercase tracking-wide">Status</span>
                      <span className={clsx("font-mono", ffAvailable ? "text-emerald-400" : "text-theme-muted")}>
                        {ffInstalling ? 'Installing…' : ffAvailable ? 'Ready' : 'Not installed'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-theme-muted uppercase tracking-wide">Source</span>
                      <span className="font-mono text-theme-muted">{String((ffStatus as any)?.source || '—')}</span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={refreshFfmpegStatus}
                        disabled={ffInstalling}
                        className="px-3 py-1.5 rounded-theme-button border border-theme bg-transparent text-[11px] font-bold text-theme-muted hover:bg-theme-hover hover:text-theme-fg transition-all shadow-sm disabled:opacity-50"
                        title="Refresh"
                      >
                        <RefreshCw className={clsx("w-4 h-4", ffInstalling && "animate-spin")} />
                      </button>
                      <div className="flex-1" />
                    </div>
                  </div>
                )}

                {isBrowser && (
                  <div className="mb-5 p-3 bg-theme-bg rounded-theme-card border border-theme space-y-3">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-theme-muted uppercase tracking-wide">Extension</span>
                      <div className="flex items-center gap-2">
                        <span className={clsx("font-mono", browserStatus.connected ? "text-emerald-400" : "text-theme-muted")}>
                          {browserStatus.connected ? `Connected (${browserStatus.clients} tab${browserStatus.clients !== 1 ? 's' : ''})` : 'Not detected'}
                        </span>
                        <button
                          onClick={() => refreshBrowserStatus()}
                          className="p-1 rounded-theme-button text-theme-muted hover:text-theme-fg hover:bg-theme-hover transition-all"
                          title="Refresh status"
                        >
                          <RefreshCw className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-theme-muted uppercase tracking-wide">Server</span>
                      <span className="font-mono text-theme-muted">ws://127.0.0.1:18081</span>
                    </div>
                    {!browserStatus.connected && (
                      <div className="text-[10px] text-theme-muted leading-relaxed p-2.5 bg-theme-hover/50 rounded-theme-button border border-theme/50 space-y-1.5">
                        <p><strong className="text-theme-fg">1.</strong> Install the Stuard Browser Extension</p>
                        <p><strong className="text-theme-fg">2.</strong> Ensure Stuard Desktop is running</p>
                        <p><strong className="text-theme-fg">3.</strong> Open any web page and check the extension icon</p>
                      </div>
                    )}
                  </div>
                )}

                <div className="pt-4 border-t border-theme flex items-center gap-2 mt-auto">
                  {i.available ? (
                    isBrowser ? (
                      <>
                        <div className="flex-1 text-[11px] text-theme-muted font-medium">
                          {browserStatus.connected 
                            ? 'Extension is active and ready'
                            : 'Install extension and ensure desktop app is running'}
                        </div>
                        <button 
                          onClick={() => handleLearnMore(i.homepage)}
                          className="px-3 py-2 rounded-theme-button text-theme-muted hover:text-theme-fg hover:bg-theme-hover border border-transparent hover:border-theme transition-all"
                          title="Learn More"
                        >
                          <Link2 className="w-4 h-4" />
                        </button>
                      </>
                    ) : isConnected ? (
                      isFfmpeg ? (
                        <>
                          <button
                            onClick={() => handleConnect(i.slug)}
                            disabled={ffInstalling}
                            className="flex-1 px-3 py-2 rounded-theme-button bg-primary text-primary-fg text-[11px] font-bold hover:opacity-90 shadow-sm transition-all active:scale-95 disabled:opacity-50"
                          >
                            {ffInstalling ? 'Installing…' : 'Repair'}
                          </button>
                          <button
                            onClick={() => handleLearnMore(i.homepage)}
                            className="px-3 py-2 rounded-theme-button text-theme-muted hover:text-theme-fg hover:bg-theme-hover border border-transparent hover:border-theme transition-all"
                            title="Documentation"
                          >
                            <Link2 className="w-4 h-4" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button 
                            onClick={() => handleDisconnect(i.slug)}
                            className="flex-1 px-3 py-2 rounded-theme-button border border-theme bg-transparent text-[11px] font-bold text-theme-muted hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30 transition-all shadow-sm active:scale-95"
                          >
                            Disconnect
                          </button>
                          <button 
                            onClick={() => handleLearnMore(i.homepage)}
                            className="px-3 py-2 rounded-theme-button text-theme-muted hover:text-theme-fg hover:bg-theme-hover border border-transparent hover:border-theme transition-all"
                            title="Documentation"
                          >
                            <Link2 className="w-4 h-4" />
                          </button>
                        </>
                      )
                    ) : (
                      <>
                        <button 
                          onClick={() => handleConnect(i.slug)}
                          disabled={isFfmpeg && ffInstalling}
                          className="flex-1 px-3 py-2 rounded-theme-button bg-primary text-primary-fg text-[11px] font-bold hover:opacity-90 shadow-sm transition-all active:scale-95 disabled:opacity-50"
                        >
                          {isFfmpeg ? (ffInstalling ? 'Installing…' : 'Setup') : 'Connect'}
                        </button>
                        <button 
                          onClick={() => handleLearnMore(i.homepage)}
                          className="px-3 py-2 rounded-theme-button text-theme-muted hover:text-theme-fg hover:bg-theme-hover border border-transparent hover:border-theme transition-all"
                          title="Documentation"
                        >
                          <Link2 className="w-4 h-4" />
                        </button>
                      </>
                    )
                  ) : (
                    <button 
                        disabled
                        className="flex-1 px-3 py-2 rounded-theme-button border border-theme bg-theme-hover text-[11px] font-bold text-theme-muted cursor-not-allowed"
                    >
                        Unavailable
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
