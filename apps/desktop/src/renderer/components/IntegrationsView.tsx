import React, { useEffect, useState } from "react";
import { Search, Link2, RefreshCw, Play, Square, Box, Globe, Plus, Star, Trash2, Users, ChevronDown, ChevronUp, Terminal, Film, ScanFace, Mail, Github, HardDrive, Webhook, Calendar, Table, FileText, CheckCircle2, AlertCircle, ArrowUpRight, Download, ArrowRight, Loader2 } from "lucide-react";
import { clsx } from 'clsx';

interface IntegrationProfile {
  provider: string;
  profile_label: string;
  is_default: boolean;
  account_email?: string | null;
  scopes_csv?: string | null;
}

interface IntegrationsViewProps {
  connectedCount: number;
  filteredIntegrations: any[];
  intQuery: string;
  setIntQuery: (v: string) => void;
  intCategory: string;
  setIntCategory: (v: string) => void;
  intCategories: string[];
  connectedMap: Record<string, any>;
  handleConnect: (slug: string, profileLabel?: string) => Promise<void> | void;
  handleDisconnect: (slug: string, profileLabel?: string) => Promise<void> | void;
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
  mpStatus: any;
  mpInstalling: boolean;
  pyRunning: boolean;
  pyRunResult: any;
  refreshPythonStatus: () => Promise<void> | void;
  refreshFfmpegStatus: () => Promise<void> | void;
  refreshMediapipeStatus: () => Promise<void> | void;
  refreshBrowserStatus: () => Promise<void> | void;
  setupPython: () => Promise<void> | void;
  installPython: () => Promise<void> | void;
  runPython: () => Promise<void> | void;
  browserStatus: { connected: boolean; clients: number };
  // Profile support
  profiles: IntegrationProfile[];
  profilesLoading: boolean;
  refreshProfiles: (provider?: string) => Promise<void> | void;
  setDefaultProfile: (provider: string, profileLabel: string) => Promise<void> | void;
  deleteProfile: (provider: string, profileLabel: string) => Promise<void> | void;
}

/** Map integration slug → backend provider name */
function slugToProvider(slug: string): string | null {
  if (slug === "github") return "github";
  if (slug === "outlook") return "outlook";
  if (slug.startsWith("google-") || slug === "gmail") return "google";
  return null;
}

/** Check if a slug is an OAuth-based integration that supports profiles */
function isOAuthSlug(slug: string): boolean {
  return !!slugToProvider(slug);
}

function getIntegrationIcon(slug: string) {
  switch (slug) {
    case 'python': return <Terminal className="w-5 h-5" />;
    case 'ffmpeg': return <Film className="w-5 h-5" />;
    case 'mediapipe': return <ScanFace className="w-5 h-5" />;
    case 'browser': return <Globe className="w-5 h-5" />;
    case 'outlook': return <Mail className="w-5 h-5" />;
    case 'github': return <Github className="w-5 h-5" />;
    case 'google-drive': return <HardDrive className="w-5 h-5" />;
    case 'webhooks': return <Webhook className="w-5 h-5" />;
    case 'google-calendar': return <Calendar className="w-5 h-5" />;
    case 'gmail': return <Mail className="w-5 h-5" />;
    case 'google-sheets': return <Table className="w-5 h-5" />;
    case 'google-docs': return <FileText className="w-5 h-5" />;
    default: return <Box className="w-5 h-5" />;
  }
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
  mpStatus,
  mpInstalling,
  pyRunning,
  pyRunResult,
  refreshPythonStatus,
  refreshFfmpegStatus,
  refreshMediapipeStatus,
  refreshBrowserStatus,
  setupPython,
  installPython,
  runPython,
  browserStatus,
  profiles,
  profilesLoading,
  refreshProfiles,
  setDefaultProfile,
  deleteProfile,
}) => {
  // ── "Add Profile" inline form state ──
  const [addingProfileFor, setAddingProfileFor] = useState<string | null>(null);
  const [newProfileName, setNewProfileName] = useState("");
  // ── Expand/collapse profiles per card ──
  const [expandedProfiles, setExpandedProfiles] = useState<Record<string, boolean>>({});

  // Load profiles on mount
  useEffect(() => {
    refreshProfiles();
  }, [refreshProfiles]);

  const toggleProfilesExpanded = (slug: string) => {
    setExpandedProfiles(prev => ({ ...prev, [slug]: !prev[slug] }));
  };

  const startAddProfile = (slug: string) => {
    setAddingProfileFor(slug);
    setNewProfileName("");
    setExpandedProfiles(prev => ({ ...prev, [slug]: true }));
  };

  const confirmAddProfile = async (slug: string) => {
    const label = newProfileName.trim();
    if (!label) return;
    setAddingProfileFor(null);
    await handleConnect(slug, label);
    setNewProfileName("");
  };

  const cancelAddProfile = () => {
    setAddingProfileFor(null);
    setNewProfileName("");
  };

  /** Get profiles matching this slug's provider */
  const getProfilesForSlug = (slug: string): IntegrationProfile[] => {
    const provider = slugToProvider(slug);
    if (!provider) return [];
    return profiles.filter(p => p.provider === provider);
  };
  return (
    <div className="pb-16 max-w-6xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10 relative overflow-hidden">
        <div className="absolute -top-8 -left-4 text-[100px] font-black text-theme-fg opacity-[0.02] select-none pointer-events-none font-stuard leading-none tracking-tighter">
          integrations
        </div>
        <div className="space-y-2 relative z-10">
          <h2 className="text-5xl font-stuard text-theme-fg tracking-tight">Integrations</h2>
          <p className="text-theme-muted text-sm font-medium pl-1">Connect your tools and services to expand Stuard's capabilities.</p>
        </div>
        
        <div className="flex gap-4 relative z-10">
          <div className="relative group">
            <Search className="absolute left-4 top-3 w-4 h-4 text-theme-muted group-focus-within:text-primary transition-colors" />
            <input
              value={intQuery}
              onChange={(e) => setIntQuery(e.target.value)}
              placeholder="Search tools..."
              className="pl-11 pr-4 py-2.5 rounded-xl border border-theme/50 bg-theme-hover/50 text-theme-fg text-[14px] font-medium shadow-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/50 w-72 transition-all placeholder:text-theme-muted/50"
            />
          </div>
          <select
            value={intCategory}
            onChange={(e) => setIntCategory(e.target.value)}
            className="px-5 py-2.5 rounded-xl border border-theme/50 bg-theme-hover/50 text-theme-fg text-[14px] font-medium shadow-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/50 cursor-pointer transition-all hover:bg-theme-hover"
          >
            {intCategories.map((c) => (
              <option key={c} value={c} className="bg-theme-card text-theme-fg">{c}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="mb-8 flex items-center gap-4 border-b border-theme/50 pb-6">
         <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 rounded-full bg-theme-hover text-[11px] font-bold text-theme-fg border border-theme">
               {filteredIntegrations.length} Available
            </span>
            {connectedCount > 0 && (
                <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[11px] font-bold border border-emerald-500/20 flex items-center gap-1.5">
                    <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    {connectedCount} Active
                </span>
            )}
         </div>
         <div className="flex-1" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredIntegrations.length === 0 ? (
          <div className="col-span-full flex flex-col items-center justify-center py-24 text-center bg-theme-card/50 rounded-theme-card border border-theme border-dashed">
            <div className="w-16 h-16 bg-theme-bg rounded-full flex items-center justify-center mb-4 shadow-sm border border-theme">
              <Search className="w-8 h-8 text-theme-muted opacity-50" />
            </div>
            <h3 className="text-base font-bold text-theme-fg mb-1.5">No matching integrations</h3>
            <p className="text-sm text-theme-muted font-medium max-w-xs mx-auto">
                We couldn't find any tools matching "{intQuery}" in {intCategory}.
            </p>
            <button 
                onClick={() => { setIntQuery(""); setIntCategory("All"); }}
                className="mt-5 px-4 py-2 rounded-theme-button bg-theme-hover text-theme-fg text-[12px] font-bold hover:bg-theme-active border border-theme transition-all"
            >
                Clear Filters
            </button>
          </div>
        ) : (
          filteredIntegrations.map((i: any) => {
            const isBrowser = i.slug === 'browser';
            const isConnected = isBrowser 
              ? browserStatus.connected
              : !!connectedMap[i.slug];
            const isPython = i.slug === 'python';
            const isFfmpeg = i.slug === 'ffmpeg';
            const isMediapipe = i.slug === 'mediapipe';
            const ffAvailable = !!(ffStatus && (ffStatus as any).available);
            const mpAvailable = !!(mpStatus && (mpStatus as any).available);
            const isOAuth = isOAuthSlug(i.slug);
            const cardProfiles = isOAuth ? getProfilesForSlug(i.slug) : [];
            const provider = slugToProvider(i.slug);
            const isProfilesExpanded = !!expandedProfiles[i.slug];
            const isAddingHere = addingProfileFor === i.slug;
            
            return (
              <div key={i.slug} className={clsx(
                "group relative flex flex-col bg-theme-card rounded-theme-card border p-5 shadow-sm transition-all duration-300",
                isConnected ? "border-primary/30 hover:border-primary/50 hover:shadow-md" : "border-theme hover:border-theme-hover hover:shadow-md"
              )}>
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3">
                    <div className={clsx(
                      "w-10 h-10 rounded-md border shadow-sm flex items-center justify-center text-[18px] font-bold group-hover:scale-105 transition-transform duration-300",
                      isConnected ? "bg-primary/10 border-primary/20 text-primary" : "bg-theme-hover border-theme text-theme-fg"
                    )}>
                        {getIntegrationIcon(i.slug)}
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

                {/* ── Profile section for OAuth integrations ── */}
                {isOAuth && isConnected && (cardProfiles.length > 0 || isAddingHere || profilesLoading) && (
                  <div className="mb-5 p-3 bg-theme-bg rounded-theme-card border border-theme space-y-2">
                    <button
                      onClick={() => toggleProfilesExpanded(i.slug)}
                      className="w-full flex items-center justify-between text-[11px] font-semibold text-theme-muted uppercase tracking-wide hover:text-theme-fg transition-colors"
                    >
                      <span className="flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5" />
                        Profiles ({cardProfiles.length})
                      </span>
                      {isProfilesExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>

                    {isProfilesExpanded && (
                      <div className="space-y-1.5 pt-1">
                        {cardProfiles.map(p => (
                          <div
                            key={p.profile_label}
                            className={clsx(
                              "flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-theme-button border text-[11px] transition-all",
                              p.is_default ? "bg-primary/5 border-primary/20" : "bg-theme-card border-theme/50 hover:border-theme"
                            )}
                          >
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              {p.is_default && (
                                <Star className="w-3 h-3 text-amber-400 flex-shrink-0" fill="currentColor" />
                              )}
                              <span className={clsx("font-bold truncate", p.is_default ? "text-primary" : "text-theme-fg")}>{p.profile_label}</span>
                              {p.account_email && (
                                <span className="text-theme-muted truncate hidden sm:inline">({p.account_email})</span>
                              )}
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              {!p.is_default && (
                                <button
                                  onClick={() => provider && setDefaultProfile(provider, p.profile_label)}
                                  className="p-1 rounded text-theme-muted hover:text-amber-400 hover:bg-amber-400/10 transition-all"
                                  title="Set as default"
                                >
                                  <Star className="w-3 h-3" />
                                </button>
                              )}
                              <button
                                onClick={() => provider && deleteProfile(provider, p.profile_label)}
                                className="p-1 rounded text-theme-muted hover:text-red-400 hover:bg-red-400/10 transition-all"
                                title="Remove profile"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        ))}

                        {/* Add profile inline form */}
                        {isAddingHere ? (
                          <div className="mt-2 p-2 bg-theme-hover/30 rounded-theme-button border border-theme border-dashed">
                            <div className="text-[10px] font-semibold text-theme-muted mb-1.5 uppercase tracking-wide px-0.5">
                              New Profile Label
                            </div>
                            <div className="flex gap-2">
                                <input
                                  autoFocus
                                  value={newProfileName}
                                  onChange={e => setNewProfileName(e.target.value)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') confirmAddProfile(i.slug);
                                    if (e.key === 'Escape') cancelAddProfile();
                                  }}
                                  placeholder='e.g. "Work", "Personal"'
                                  className="flex-1 px-2.5 py-1.5 rounded-theme-button border border-theme bg-theme-card text-theme-fg text-[11px] focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 placeholder:text-theme-muted/70 transition-all"
                                />
                                <button
                                  onClick={() => confirmAddProfile(i.slug)}
                                  disabled={!newProfileName.trim()}
                                  className="px-3 py-1.5 rounded-theme-button bg-primary text-primary-fg text-[11px] font-bold hover:opacity-90 disabled:opacity-50 transition-all shadow-sm active:scale-95"
                                >
                                  Add
                                </button>
                                <button
                                  onClick={cancelAddProfile}
                                  className="p-1.5 rounded-theme-button text-theme-muted hover:text-theme-fg hover:bg-theme-hover transition-all"
                                  title="Cancel"
                                >
                                  <Box className="w-4 h-4 rotate-45" /> 
                                </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => startAddProfile(i.slug)}
                            className="w-full flex items-center justify-center gap-1.5 px-2 py-2 rounded-theme-button border border-dashed border-theme text-[10px] font-bold text-theme-muted hover:text-primary hover:border-primary/40 hover:bg-primary/5 transition-all mt-1"
                          >
                            <Plus className="w-3 h-3" />
                            Connect New Profile
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

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

                {isMediapipe && (
                  <div className="mb-5 p-3 bg-theme-bg rounded-theme-card border border-theme space-y-3">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-theme-muted uppercase tracking-wide">Status</span>
                      <span className={clsx("font-mono", mpAvailable ? "text-emerald-400" : "text-theme-muted")}>
                        {mpInstalling ? 'Installing…' : mpAvailable ? 'Ready' : 'Not installed'}
                      </span>
                    </div>
                    {mpAvailable && (mpStatus as any)?.version && (
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-semibold text-theme-muted uppercase tracking-wide">Version</span>
                        <span className="font-mono text-theme-muted">{String((mpStatus as any).version)}</span>
                      </div>
                    )}
                    <div className="text-[10px] text-theme-muted leading-relaxed">
                      Installs <code className="text-theme-fg">mediapipe</code>, <code className="text-theme-fg">opencv-python</code>, and <code className="text-theme-fg">numpy</code> into a managed Python environment.
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={refreshMediapipeStatus}
                        disabled={mpInstalling}
                        className="px-3 py-1.5 rounded-theme-button border border-theme bg-transparent text-[11px] font-bold text-theme-muted hover:bg-theme-hover hover:text-theme-fg transition-all shadow-sm disabled:opacity-50"
                        title="Refresh"
                      >
                        <RefreshCw className={clsx("w-4 h-4", mpInstalling && "animate-spin")} />
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

                <div className="pt-3 mt-auto border-t border-theme border-dashed flex items-center gap-2">
                  {i.available ? (
                    isBrowser ? (
                      <>
                        <div className="flex-1 flex items-center gap-2 text-[10px] text-theme-muted font-medium">
                          <div className={clsx("w-1.5 h-1.5 rounded-full shadow-sm", browserStatus.connected ? "bg-emerald-500 animate-pulse" : "bg-amber-500")} />
                          {browserStatus.connected ? 'Extension Active' : 'Install Extension'}
                        </div>
                        <button 
                          onClick={() => handleLearnMore(i.homepage)}
                          className="h-7 px-2.5 rounded-theme-button text-theme-muted hover:text-primary hover:bg-primary/5 border border-transparent hover:border-primary/20 transition-all flex items-center gap-1.5 text-[10px] font-bold"
                        >
                          Docs
                          <ArrowUpRight className="w-3 h-3" />
                        </button>
                      </>
                    ) : isConnected ? (
                      isFfmpeg ? (
                        <button
                          onClick={() => handleConnect(i.slug)}
                          disabled={ffInstalling}
                          className="flex-1 h-8 flex items-center justify-center gap-2 rounded-theme-button bg-theme-fg text-theme-bg text-[11px] font-bold hover:opacity-90 shadow-sm transition-all active:scale-95 disabled:opacity-50"
                        >
                          <RefreshCw className={clsx("w-3.5 h-3.5", ffInstalling && "animate-spin")} />
                          {ffInstalling ? 'Installing…' : 'Repair FFmpeg'}
                        </button>
                      ) : isMediapipe && isConnected ? (
                        <>
                          <button
                            onClick={() => handleConnect(i.slug)}
                            disabled={mpInstalling}
                            className="flex-1 h-8 flex items-center justify-center gap-2 rounded-theme-button bg-theme-fg text-theme-bg text-[11px] font-bold hover:opacity-90 shadow-sm transition-all active:scale-95 disabled:opacity-50"
                          >
                            <RefreshCw className={clsx("w-3.5 h-3.5", mpInstalling && "animate-spin")} />
                            {mpInstalling ? 'Installing…' : 'Reinstall'}
                          </button>
                          <button
                            onClick={() => handleLearnMore(i.homepage)}
                            className="h-8 w-8 flex items-center justify-center rounded-theme-button text-theme-muted hover:text-primary hover:bg-primary/5 border border-transparent hover:border-primary/20 transition-all"
                            title="Documentation"
                          >
                            <Link2 className="w-4 h-4" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button 
                            onClick={() => handleDisconnect(i.slug)}
                            className="flex-1 h-8 rounded-theme-button border border-theme bg-theme-card text-[11px] font-bold text-theme-muted hover:bg-destructive/5 hover:text-destructive hover:border-destructive/30 transition-all shadow-sm active:scale-95"
                          >
                            Disconnect
                          </button>
                          {isOAuth && (
                            <button
                              onClick={() => startAddProfile(i.slug)}
                              className="h-8 w-8 flex items-center justify-center rounded-theme-button text-theme-muted hover:text-primary hover:bg-primary/10 border border-transparent hover:border-primary/30 transition-all"
                              title="Add another profile"
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                          )}
                          <button 
                            onClick={() => handleLearnMore(i.homepage)}
                            className="h-8 w-8 flex items-center justify-center rounded-theme-button text-theme-muted hover:text-primary hover:bg-primary/5 border border-transparent hover:border-primary/20 transition-all"
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
                          disabled={(isFfmpeg && ffInstalling) || (isMediapipe && mpInstalling)}
                          className={clsx(
                            "flex-1 h-8 flex items-center justify-center gap-2 rounded-theme-button text-[11px] font-bold shadow-sm transition-all active:scale-95 disabled:opacity-50",
                            (isFfmpeg || isMediapipe) ? "bg-theme-fg text-theme-bg hover:opacity-90" : "bg-primary text-primary-fg hover:opacity-90"
                          )}
                        >
                           {(isFfmpeg || isMediapipe) ? <Download className="w-3.5 h-3.5" /> : <ArrowRight className="w-3.5 h-3.5" />}
                          {isFfmpeg ? (ffInstalling ? 'Installing…' : 'Install FFmpeg') : isMediapipe ? (mpInstalling ? 'Installing…' : 'Install MediaPipe') : 'Connect'}
                        </button>
                        <button 
                          onClick={() => handleLearnMore(i.homepage)}
                          className="h-8 w-8 flex items-center justify-center rounded-theme-button text-theme-muted hover:text-primary hover:bg-primary/5 border border-transparent hover:border-primary/20 transition-all"
                          title="Documentation"
                        >
                          <Link2 className="w-4 h-4" />
                        </button>
                      </>
                    )
                  ) : (
                    <button 
                        disabled
                        className="flex-1 h-8 rounded-theme-button border border-theme bg-theme-hover/50 text-[11px] font-bold text-theme-muted cursor-not-allowed opacity-70"
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
