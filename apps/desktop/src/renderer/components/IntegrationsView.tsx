import React, { useEffect, useMemo, useState } from "react";
import { Search, Link2, RefreshCw, Box, Globe, Plus, Star, Trash2, Users, ChevronDown, ChevronUp, Terminal, Film, ScanFace, Mail, Github, HardDrive, Webhook, Calendar, Table, FileText, CheckCircle2, AlertCircle, ArrowUpRight, Download, ArrowRight, Loader2, Shield, X } from "lucide-react";
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
  if (slug === "discord") return "discord";
  if (slug === "reddit") return "reddit";
  if (slug.startsWith("google-") || slug === "gmail") return "google";
  return null;
}

function isOAuthSlug(slug: string): boolean {
  return !!slugToProvider(slug);
}

function isGoogleSlug(slug: string): boolean {
  return slug.startsWith("google-") || slug === "gmail";
}

const GOOGLE_SLUGS = ['google-drive', 'google-calendar', 'gmail', 'google-sheets', 'google-docs'];

function getIntegrationIcon(slug: string, size = "w-5 h-5") {
  switch (slug) {
    case 'python': return <Terminal className={size} />;
    case 'ffmpeg': return <Film className={size} />;
    case 'mediapipe': return <ScanFace className={size} />;
    case 'browser': return <Globe className={size} />;
    case 'outlook': return <Mail className={size} />;
    case 'github': return <Github className={size} />;
    case 'discord': return <Users className={size} />;
    case 'reddit': return <ArrowUpRight className={size} />;
    case 'google-drive': return <HardDrive className={size} />;
    case 'webhooks': return <Webhook className={size} />;
    case 'google-calendar': return <Calendar className={size} />;
    case 'gmail': return <Mail className={size} />;
    case 'google-sheets': return <Table className={size} />;
    case 'google-docs': return <FileText className={size} />;
    default: return <Box className={size} />;
  }
}

function productLabel(slug: string): string {
  switch (slug) {
    case 'google-drive': return 'Drive';
    case 'google-calendar': return 'Calendar';
    case 'gmail': return 'Gmail';
    case 'google-sheets': return 'Sheets';
    case 'google-docs': return 'Docs';
    default: return slug;
  }
}

// ─── Google Account Card ─────────────────────────────────────────────────────

interface GoogleAccountCardProps {
  googleProducts: any[];
  connectedMap: Record<string, any>;
  handleConnect: (slug: string, profileLabel?: string) => Promise<void> | void;
  handleDisconnect: (slug: string, profileLabel?: string) => Promise<void> | void;
  handleLearnMore: (url: string) => void;
  profiles: IntegrationProfile[];
  profilesLoading: boolean;
  refreshProfiles: (provider?: string) => Promise<void> | void;
  setDefaultProfile: (provider: string, profileLabel: string) => Promise<void> | void;
  deleteProfile: (provider: string, profileLabel: string) => Promise<void> | void;
}

const GoogleAccountCard: React.FC<GoogleAccountCardProps> = ({
  googleProducts,
  connectedMap,
  handleConnect,
  handleDisconnect,
  handleLearnMore,
  profiles,
  profilesLoading,
  refreshProfiles,
  setDefaultProfile,
  deleteProfile,
}) => {
  const [showProfiles, setShowProfiles] = useState(false);
  const [addingProfile, setAddingProfile] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [connectingSlug, setConnectingSlug] = useState<string | null>(null);

  const googleProfiles = profiles.filter(p => p.provider === 'google');
  const anyConnected = GOOGLE_SLUGS.some(s => !!connectedMap[s]);
  const connectedProducts = GOOGLE_SLUGS.filter(s => !!connectedMap[s]);
  const defaultProfile = googleProfiles.find(p => p.is_default);

  const handleConnectProduct = async (slug: string) => {
    setConnectingSlug(slug);
    try {
      await handleConnect(slug);
    } finally {
      setConnectingSlug(null);
    }
  };

  const confirmAddProfile = async () => {
    const label = newProfileName.trim();
    if (!label) return;
    setAddingProfile(false);
    setNewProfileName("");
    await handleConnect('gmail', label);
  };

  return (
    <div className={clsx(
      "col-span-full bg-theme-card rounded-theme-card border shadow-sm transition-all duration-300",
      anyConnected ? "border-primary/30" : "border-theme hover:border-theme-hover"
    )}>
      {/* Header */}
      <div className="p-5 pb-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={clsx(
              "w-11 h-11 rounded-lg border shadow-sm flex items-center justify-center transition-all",
              anyConnected ? "bg-primary/10 border-primary/20" : "bg-theme-hover border-theme"
            )}>
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
            </div>
            <div>
              <h3 className="font-bold text-[15px] text-theme-fg tracking-tight">Google Account</h3>
              {defaultProfile?.account_email ? (
                <span className="text-[11px] text-theme-muted font-medium">{defaultProfile.account_email}</span>
              ) : defaultProfile?.profile_label ? (
                <span className="text-[11px] text-theme-muted font-medium">Profile: {defaultProfile.profile_label}</span>
              ) : anyConnected ? (
                <span className="text-[11px] text-emerald-400 font-medium">Connected</span>
              ) : (
                <span className="text-[11px] text-theme-muted font-medium">Connect your Google workspace</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {anyConnected && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-900/20 text-emerald-400 text-[10px] font-bold border border-emerald-900/30 tracking-wide uppercase">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                {connectedProducts.length} Active
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Products Grid */}
      <div className="px-5 pb-2">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
          {googleProducts.map((product: any) => {
            const isActive = !!connectedMap[product.slug];
            const isConnecting = connectingSlug === product.slug;
            return (
              <button
                key={product.slug}
                onClick={() => isActive ? undefined : handleConnectProduct(product.slug)}
                disabled={isConnecting}
                className={clsx(
                  "relative flex flex-col items-center gap-2 p-3 rounded-lg border transition-all duration-200 group/product",
                  isActive
                    ? "bg-primary/5 border-primary/25 cursor-default"
                    : "bg-theme-bg border-theme hover:border-primary/30 hover:bg-primary/5 cursor-pointer active:scale-95",
                  isConnecting && "opacity-60"
                )}
              >
                <div className={clsx(
                  "w-8 h-8 rounded-md flex items-center justify-center transition-all",
                  isActive ? "text-primary" : "text-theme-muted group-hover/product:text-primary"
                )}>
                  {isConnecting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    getIntegrationIcon(product.slug, "w-4 h-4")
                  )}
                </div>
                <span className={clsx(
                  "text-[10px] font-semibold leading-tight text-center",
                  isActive ? "text-primary" : "text-theme-fg"
                )}>
                  {productLabel(product.slug)}
                </span>
                {isActive && (
                  <div className="absolute top-1.5 right-1.5">
                    <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                  </div>
                )}
                {!isActive && !isConnecting && (
                  <div className="absolute top-1.5 right-1.5 opacity-0 group-hover/product:opacity-100 transition-opacity">
                    <Plus className="w-3 h-3 text-theme-muted" />
                  </div>
                )}
              </button>
            );
          })}
        </div>
        {!anyConnected && (
          <p className="text-[11px] text-theme-muted font-medium mt-3 text-center">
            Click any product above to connect your Google account. All products share one login — no need to sign in multiple times.
          </p>
        )}
      </div>

      {/* Profiles & Actions */}
      <div className="px-5 pb-4 pt-3 border-t border-theme/30 mt-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {anyConnected && googleProfiles.length > 0 && (
              <button
                onClick={() => setShowProfiles(!showProfiles)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[10px] font-semibold text-theme-muted hover:text-theme-fg hover:bg-theme-hover transition-all"
              >
                <Shield className="w-3 h-3" />
                {googleProfiles.length} Profile{googleProfiles.length !== 1 ? 's' : ''}
                {showProfiles ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {anyConnected && (
              <>
                <button
                  onClick={() => setAddingProfile(true)}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[10px] font-semibold text-theme-muted hover:text-primary hover:bg-primary/5 transition-all"
                >
                  <Plus className="w-3 h-3" />
                  Add Account
                </button>
                <button
                  onClick={() => handleDisconnect(connectedProducts[0] || 'gmail')}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[10px] font-semibold text-theme-muted hover:text-red-400 hover:bg-red-400/5 transition-all"
                >
                  Disconnect
                </button>
              </>
            )}
          </div>
        </div>

        {/* Profile list */}
        {showProfiles && googleProfiles.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {googleProfiles.map(p => {
              const displayLabel = p.profile_label || 'Default Account';
              const displayEmail = p.account_email || '';
              return (
                <div
                  key={p.profile_label || 'default'}
                  className={clsx(
                    "flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-[11px] transition-all",
                    p.is_default ? "bg-primary/5 border-primary/20" : "bg-theme-bg border-theme/50 hover:border-theme"
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {p.is_default && <Star className="w-3 h-3 text-amber-400 flex-shrink-0" fill="currentColor" />}
                    <span className={clsx("font-bold truncate", p.is_default ? "text-primary" : "text-theme-fg")}>{displayLabel}</span>
                    {displayEmail && <span className="text-theme-muted truncate">({displayEmail})</span>}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {!p.is_default && p.profile_label && (
                      <button
                        onClick={() => setDefaultProfile('google', p.profile_label)}
                        className="p-1 rounded text-theme-muted hover:text-amber-400 hover:bg-amber-400/10 transition-all"
                        title="Set as default"
                      >
                        <Star className="w-3 h-3" />
                      </button>
                    )}
                    {p.profile_label && (
                      <button
                        onClick={() => {
                          if (window.confirm(`Remove profile "${displayLabel}"?`)) {
                            deleteProfile('google', p.profile_label);
                          }
                        }}
                        className="p-1 rounded text-theme-muted hover:text-red-400 hover:bg-red-400/10 transition-all"
                        title="Remove profile"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Add profile form */}
        {addingProfile && (
          <div className="mt-3 p-3 bg-theme-bg rounded-lg border border-dashed border-theme">
            <div className="text-[10px] font-semibold text-theme-muted mb-2 uppercase tracking-wide">New Account Label</div>
            <div className="flex gap-2">
              <input
                autoFocus
                value={newProfileName}
                onChange={e => setNewProfileName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') confirmAddProfile();
                  if (e.key === 'Escape') { setAddingProfile(false); setNewProfileName(""); }
                }}
                placeholder='e.g. "Work", "Personal"'
                className="flex-1 px-2.5 py-1.5 rounded-md border border-theme bg-theme-card text-theme-fg text-[11px] focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 placeholder:text-theme-muted/70 transition-all"
              />
              <button
                onClick={confirmAddProfile}
                disabled={!newProfileName.trim()}
                className="px-3 py-1.5 rounded-md bg-primary text-primary-fg text-[11px] font-bold hover:opacity-90 disabled:opacity-50 transition-all shadow-sm active:scale-95"
              >
                Connect
              </button>
              <button
                onClick={() => { setAddingProfile(false); setNewProfileName(""); }}
                className="p-1.5 rounded-md text-theme-muted hover:text-theme-fg hover:bg-theme-hover transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Standard Integration Card ───────────────────────────────────────────────

interface StandardCardProps {
  integration: any;
  isConnected: boolean;
  connectedMap: Record<string, any>;
  handleConnect: (slug: string, profileLabel?: string) => Promise<void> | void;
  handleDisconnect: (slug: string, profileLabel?: string) => Promise<void> | void;
  handleLearnMore: (url: string) => void;
  profiles: IntegrationProfile[];
  profilesLoading: boolean;
  setDefaultProfile: (provider: string, profileLabel: string) => Promise<void> | void;
  deleteProfile: (provider: string, profileLabel: string) => Promise<void> | void;
  pyStatus?: any;
  pyEnvId?: string;
  setPyEnvId?: (v: string) => void;
  pyInstalling?: boolean;
  installPython?: () => Promise<void> | void;
  ffStatus?: any;
  ffInstalling?: boolean;
  refreshFfmpegStatus?: () => Promise<void> | void;
  mpStatus?: any;
  mpInstalling?: boolean;
  refreshMediapipeStatus?: () => Promise<void> | void;
  browserStatus?: { connected: boolean; clients: number };
  refreshBrowserStatus?: () => Promise<void> | void;
}

const StandardCard: React.FC<StandardCardProps> = ({
  integration: i,
  isConnected,
  connectedMap,
  handleConnect,
  handleDisconnect,
  handleLearnMore,
  profiles,
  profilesLoading,
  setDefaultProfile,
  deleteProfile,
  pyStatus, pyEnvId, setPyEnvId, pyInstalling, installPython,
  ffStatus, ffInstalling, refreshFfmpegStatus,
  mpStatus, mpInstalling, refreshMediapipeStatus,
  browserStatus, refreshBrowserStatus,
}) => {
  const [showProfiles, setShowProfiles] = useState(false);
  const [addingProfile, setAddingProfile] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");

  const isPython = i.slug === 'python';
  const isFfmpeg = i.slug === 'ffmpeg';
  const isMediapipe = i.slug === 'mediapipe';
  const isBrowser = i.slug === 'browser';
  const isOAuth = isOAuthSlug(i.slug);
  const provider = slugToProvider(i.slug);
  const cardProfiles = isOAuth && provider ? profiles.filter(p => p.provider === provider) : [];
  const defaultProfile = cardProfiles.find(p => p.is_default);

  const ffAvailable = !!(ffStatus && (ffStatus as any).available);
  const mpAvailable = !!(mpStatus && (mpStatus as any).available);

  const confirmAddProfile = async () => {
    const label = newProfileName.trim();
    if (!label) return;
    setAddingProfile(false);
    setNewProfileName("");
    await handleConnect(i.slug, label);
  };

  return (
    <div className={clsx(
      "group relative flex flex-col bg-theme-card rounded-theme-card border p-5 shadow-sm transition-all duration-300",
      isConnected ? "border-primary/30 hover:border-primary/50 hover:shadow-md" : "border-theme hover:border-theme-hover hover:shadow-md"
    )}>
      {/* Header */}
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
            {isOAuth && isConnected && defaultProfile ? (
              <span className="text-[10px] text-theme-muted font-medium">
                {defaultProfile.account_email || defaultProfile.profile_label || 'Connected'}
              </span>
            ) : (
              <span className="text-[10px] font-medium text-theme-muted px-1.5 py-0.5 bg-theme-hover rounded-sm inline-block mt-0.5">{i.category}</span>
            )}
          </div>
        </div>
        {isConnected && (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-900/20 text-emerald-400 text-[10px] font-bold border border-emerald-900/30 tracking-wide uppercase">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Active
          </span>
        )}
        {!i.available && (
          <span className="px-2 py-0.5 rounded-full bg-theme-hover text-theme-muted text-[10px] font-bold border border-theme tracking-wide uppercase">
            Soon
          </span>
        )}
      </div>

      <p className="text-[12px] text-theme-muted leading-relaxed mb-4 line-clamp-2 flex-1 font-medium">
        {i.description}
      </p>

      {/* Profile section for OAuth integrations */}
      {isOAuth && isConnected && cardProfiles.length > 0 && (
        <div className="mb-4">
          <button
            onClick={() => setShowProfiles(!showProfiles)}
            className="flex items-center gap-1.5 text-[10px] font-semibold text-theme-muted hover:text-theme-fg transition-colors"
          >
            <Shield className="w-3 h-3" />
            {cardProfiles.length} Profile{cardProfiles.length !== 1 ? 's' : ''}
            {showProfiles ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {showProfiles && (
            <div className="mt-2 space-y-1.5 p-2.5 bg-theme-bg rounded-lg border border-theme">
              {cardProfiles.map(p => {
                const displayLabel = p.profile_label || 'Default Account';
                const displayEmail = p.account_email || '';
                return (
                  <div
                    key={p.profile_label || 'default'}
                    className={clsx(
                      "flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md border text-[11px] transition-all",
                      p.is_default ? "bg-primary/5 border-primary/20" : "bg-theme-card border-theme/50"
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {p.is_default && <Star className="w-3 h-3 text-amber-400 flex-shrink-0" fill="currentColor" />}
                      <span className={clsx("font-bold truncate", p.is_default ? "text-primary" : "text-theme-fg")}>{displayLabel}</span>
                      {displayEmail && <span className="text-theme-muted truncate hidden sm:inline">({displayEmail})</span>}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {!p.is_default && provider && p.profile_label && (
                        <button
                          onClick={() => setDefaultProfile(provider, p.profile_label)}
                          className="p-1 rounded text-theme-muted hover:text-amber-400 hover:bg-amber-400/10 transition-all"
                          title="Set as default"
                        >
                          <Star className="w-3 h-3" />
                        </button>
                      )}
                      {provider && p.profile_label && (
                        <button
                          onClick={() => {
                            if (window.confirm(`Remove profile "${displayLabel}"?`)) {
                              deleteProfile(provider, p.profile_label);
                            }
                          }}
                          className="p-1 rounded text-theme-muted hover:text-red-400 hover:bg-red-400/10 transition-all"
                          title="Remove"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {addingProfile ? (
                <div className="mt-1.5 p-2 bg-theme-hover/30 rounded-md border border-dashed border-theme">
                  <div className="flex gap-2">
                    <input
                      autoFocus
                      value={newProfileName}
                      onChange={e => setNewProfileName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') confirmAddProfile();
                        if (e.key === 'Escape') { setAddingProfile(false); setNewProfileName(""); }
                      }}
                      placeholder='e.g. "Work"'
                      className="flex-1 px-2 py-1 rounded-md border border-theme bg-theme-card text-theme-fg text-[11px] focus:outline-none focus:border-primary transition-all placeholder:text-theme-muted/70"
                    />
                    <button onClick={confirmAddProfile} disabled={!newProfileName.trim()} className="px-2.5 py-1 rounded-md bg-primary text-primary-fg text-[10px] font-bold hover:opacity-90 disabled:opacity-50 transition-all active:scale-95">Add</button>
                    <button onClick={() => { setAddingProfile(false); setNewProfileName(""); }} className="p-1 rounded text-theme-muted hover:text-theme-fg transition-all"><X className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setAddingProfile(true)}
                  className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md border border-dashed border-theme text-[10px] font-bold text-theme-muted hover:text-primary hover:border-primary/40 hover:bg-primary/5 transition-all mt-1"
                >
                  <Plus className="w-3 h-3" />
                  Add Profile
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Python details */}
      {isPython && (
        <div className="mb-4 p-3 bg-theme-bg rounded-lg border border-theme space-y-3">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-semibold text-theme-muted uppercase tracking-wide">Runtime</span>
            <span className={clsx("font-mono", pyStatus?.available ? "text-emerald-400" : "text-theme-muted")}>
              {pyStatus?.available ? pyStatus.version : 'Not ready'}
            </span>
          </div>
          <div className="flex gap-2">
            <input
              value={pyEnvId}
              onChange={(e) => setPyEnvId?.(e.target.value)}
              placeholder="Environment ID"
              className="flex-1 px-2 py-1.5 rounded-md border border-theme bg-theme-card text-theme-fg text-[11px] focus:outline-none focus:border-primary transition-all placeholder:text-theme-muted"
            />
            <button
              onClick={installPython}
              disabled={pyInstalling || !pyEnvId}
              className="px-3 py-1.5 bg-primary text-primary-fg text-[11px] font-bold rounded-md hover:opacity-90 disabled:opacity-50 transition-all shadow-sm"
            >
              {pyInstalling ? '...' : 'Install'}
            </button>
          </div>
        </div>
      )}

      {/* FFmpeg details */}
      {isFfmpeg && (
        <div className="mb-4 p-3 bg-theme-bg rounded-lg border border-theme space-y-3">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-semibold text-theme-muted uppercase tracking-wide">Status</span>
            <span className={clsx("font-mono", ffAvailable ? "text-emerald-400" : "text-theme-muted")}>
              {ffInstalling ? 'Installing...' : ffAvailable ? 'Ready' : 'Not installed'}
            </span>
          </div>
          {(ffStatus as any)?.source && (
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-semibold text-theme-muted uppercase tracking-wide">Source</span>
              <span className="font-mono text-theme-muted">{String((ffStatus as any).source)}</span>
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={refreshFfmpegStatus}
              disabled={ffInstalling}
              className="p-1.5 rounded-md border border-theme bg-transparent text-theme-muted hover:bg-theme-hover hover:text-theme-fg transition-all disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw className={clsx("w-3.5 h-3.5", ffInstalling && "animate-spin")} />
            </button>
          </div>
        </div>
      )}

      {/* MediaPipe details */}
      {isMediapipe && (
        <div className="mb-4 p-3 bg-theme-bg rounded-lg border border-theme space-y-3">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-semibold text-theme-muted uppercase tracking-wide">Status</span>
            <span className={clsx("font-mono", mpAvailable ? "text-emerald-400" : "text-theme-muted")}>
              {mpInstalling ? 'Installing...' : mpAvailable ? 'Ready' : 'Not installed'}
            </span>
          </div>
          {mpAvailable && (mpStatus as any)?.version && (
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-semibold text-theme-muted uppercase tracking-wide">Version</span>
              <span className="font-mono text-theme-muted">{String((mpStatus as any).version)}</span>
            </div>
          )}
          <div className="text-[10px] text-theme-muted leading-relaxed">
            Installs <code className="text-theme-fg">mediapipe</code>, <code className="text-theme-fg">opencv-python</code>, and <code className="text-theme-fg">numpy</code>.
          </div>
          <div className="flex gap-2">
            <button
              onClick={refreshMediapipeStatus}
              disabled={mpInstalling}
              className="p-1.5 rounded-md border border-theme bg-transparent text-theme-muted hover:bg-theme-hover hover:text-theme-fg transition-all disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw className={clsx("w-3.5 h-3.5", mpInstalling && "animate-spin")} />
            </button>
          </div>
        </div>
      )}

      {/* Browser details */}
      {isBrowser && (
        <div className="mb-4 p-3 bg-theme-bg rounded-lg border border-theme space-y-3">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-semibold text-theme-muted uppercase tracking-wide">Extension</span>
            <div className="flex items-center gap-2">
              <span className={clsx("font-mono", browserStatus?.connected ? "text-emerald-400" : "text-theme-muted")}>
                {browserStatus?.connected ? `Connected (${browserStatus.clients} tab${browserStatus.clients !== 1 ? 's' : ''})` : 'Not detected'}
              </span>
              <button
                onClick={refreshBrowserStatus}
                className="p-1 rounded text-theme-muted hover:text-theme-fg hover:bg-theme-hover transition-all"
                title="Refresh"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-semibold text-theme-muted uppercase tracking-wide">Server</span>
            <span className="font-mono text-theme-muted">ws://127.0.0.1:18081</span>
          </div>
          {!browserStatus?.connected && (
            <div className="text-[10px] text-theme-muted leading-relaxed p-2.5 bg-theme-hover/50 rounded-md border border-theme/50 space-y-1">
              <p><strong className="text-theme-fg">1.</strong> Install the Stuard Browser Extension</p>
              <p><strong className="text-theme-fg">2.</strong> Ensure Stuard Desktop is running</p>
              <p><strong className="text-theme-fg">3.</strong> Open any web page and check the extension icon</p>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="pt-3 mt-auto border-t border-theme border-dashed flex items-center gap-2">
        {i.available ? (
          isBrowser ? (
            <>
              <div className="flex-1 flex items-center gap-2 text-[10px] text-theme-muted font-medium">
                <div className={clsx("w-1.5 h-1.5 rounded-full shadow-sm", browserStatus?.connected ? "bg-emerald-500 animate-pulse" : "bg-amber-500")} />
                {browserStatus?.connected ? 'Extension Active' : 'Install Extension'}
              </div>
              <button
                onClick={() => handleLearnMore(i.homepage)}
                className="h-7 px-2.5 rounded-md text-theme-muted hover:text-primary hover:bg-primary/5 border border-transparent hover:border-primary/20 transition-all flex items-center gap-1.5 text-[10px] font-bold"
              >
                Docs <ArrowUpRight className="w-3 h-3" />
              </button>
            </>
          ) : isConnected ? (
            isFfmpeg ? (
              <button
                onClick={() => handleConnect(i.slug)}
                disabled={ffInstalling}
                className="flex-1 h-8 flex items-center justify-center gap-2 rounded-md bg-theme-fg text-theme-bg text-[11px] font-bold hover:opacity-90 shadow-sm transition-all active:scale-95 disabled:opacity-50"
              >
                <RefreshCw className={clsx("w-3.5 h-3.5", ffInstalling && "animate-spin")} />
                {ffInstalling ? 'Installing...' : 'Repair FFmpeg'}
              </button>
            ) : isMediapipe ? (
              <>
                <button
                  onClick={() => handleConnect(i.slug)}
                  disabled={mpInstalling}
                  className="flex-1 h-8 flex items-center justify-center gap-2 rounded-md bg-theme-fg text-theme-bg text-[11px] font-bold hover:opacity-90 shadow-sm transition-all active:scale-95 disabled:opacity-50"
                >
                  <RefreshCw className={clsx("w-3.5 h-3.5", mpInstalling && "animate-spin")} />
                  {mpInstalling ? 'Installing...' : 'Reinstall'}
                </button>
                <button onClick={() => handleLearnMore(i.homepage)} className="h-8 w-8 flex items-center justify-center rounded-md text-theme-muted hover:text-primary hover:bg-primary/5 transition-all" title="Docs">
                  <Link2 className="w-4 h-4" />
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => handleDisconnect(i.slug)}
                  className="flex-1 h-8 rounded-md border border-theme bg-theme-card text-[11px] font-bold text-theme-muted hover:bg-red-500/5 hover:text-red-400 hover:border-red-500/30 transition-all shadow-sm active:scale-95"
                >
                  Disconnect
                </button>
                {isOAuth && (
                  <button
                    onClick={() => setAddingProfile(true)}
                    className="h-8 w-8 flex items-center justify-center rounded-md text-theme-muted hover:text-primary hover:bg-primary/10 border border-transparent hover:border-primary/30 transition-all"
                    title="Add another profile"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={() => handleLearnMore(i.homepage)}
                  className="h-8 w-8 flex items-center justify-center rounded-md text-theme-muted hover:text-primary hover:bg-primary/5 transition-all"
                  title="Docs"
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
                  "flex-1 h-8 flex items-center justify-center gap-2 rounded-md text-[11px] font-bold shadow-sm transition-all active:scale-95 disabled:opacity-50",
                  (isFfmpeg || isMediapipe) ? "bg-theme-fg text-theme-bg hover:opacity-90" : "bg-primary text-primary-fg hover:opacity-90"
                )}
              >
                {(isFfmpeg || isMediapipe) ? <Download className="w-3.5 h-3.5" /> : <ArrowRight className="w-3.5 h-3.5" />}
                {isFfmpeg ? (ffInstalling ? 'Installing...' : 'Install FFmpeg') : isMediapipe ? (mpInstalling ? 'Installing...' : 'Install MediaPipe') : 'Connect'}
              </button>
              <button
                onClick={() => handleLearnMore(i.homepage)}
                className="h-8 w-8 flex items-center justify-center rounded-md text-theme-muted hover:text-primary hover:bg-primary/5 transition-all"
                title="Docs"
              >
                <Link2 className="w-4 h-4" />
              </button>
            </>
          )
        ) : (
          <button
            disabled
            className="flex-1 h-8 rounded-md border border-theme bg-theme-hover/50 text-[11px] font-bold text-theme-muted cursor-not-allowed opacity-70"
          >
            Unavailable
          </button>
        )}
      </div>
    </div>
  );
};

// ─── Main IntegrationsView ───────────────────────────────────────────────────

export const IntegrationsView: React.FC<IntegrationsViewProps> = (props) => {
  const {
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
    profiles,
    profilesLoading,
    refreshProfiles,
    setDefaultProfile,
    deleteProfile,
    browserStatus,
    pyStatus,
    ffStatus,
    mpStatus,
    pyEnvId,
    setPyEnvId,
    pyInstalling,
    ffInstalling,
    mpInstalling,
    installPython,
    refreshFfmpegStatus,
    refreshMediapipeStatus,
    refreshBrowserStatus,
  } = props;

  // Load profiles on mount
  useEffect(() => {
    refreshProfiles();
  }, [refreshProfiles]);

  // Separate Google products from everything else
  const googleProducts = useMemo(
    () => filteredIntegrations.filter(i => isGoogleSlug(i.slug)),
    [filteredIntegrations]
  );
  const nonGoogleIntegrations = useMemo(
    () => filteredIntegrations.filter(i => !isGoogleSlug(i.slug)),
    [filteredIntegrations]
  );

  const showGoogleCard = googleProducts.length > 0;

  return (
    <div className="pb-16 max-w-6xl mx-auto">
      {/* Header */}
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

      {/* Stats bar */}
      <div className="mb-8 flex items-center gap-4 border-b border-theme/50 pb-6">
        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 rounded-full bg-theme-hover text-[11px] font-bold text-theme-fg border border-theme">
            {filteredIntegrations.length} Available
          </span>
          {connectedCount > 0 && (
            <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[11px] font-bold border border-emerald-500/20 flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              {connectedCount} Active
            </span>
          )}
        </div>
        <div className="flex-1" />
      </div>

      {filteredIntegrations.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center bg-theme-card/50 rounded-theme-card border border-theme border-dashed">
          <div className="w-16 h-16 bg-theme-bg rounded-full flex items-center justify-center mb-4 shadow-sm border border-theme">
            <Search className="w-8 h-8 text-theme-muted opacity-50" />
          </div>
          <h3 className="text-base font-bold text-theme-fg mb-1.5">No matching integrations</h3>
          <p className="text-sm text-theme-muted font-medium max-w-xs mx-auto">
            We couldn't find any tools matching "{intQuery}" in {intCategory}.
          </p>
          <button
            onClick={() => { setIntQuery(""); setIntCategory("All"); }}
            className="mt-5 px-4 py-2 rounded-md bg-theme-hover text-theme-fg text-[12px] font-bold hover:bg-theme-active border border-theme transition-all"
          >
            Clear Filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {/* Google unified card — spans full width */}
          {showGoogleCard && (
            <GoogleAccountCard
              googleProducts={googleProducts}
              connectedMap={connectedMap}
              handleConnect={handleConnect}
              handleDisconnect={handleDisconnect}
              handleLearnMore={handleLearnMore}
              profiles={profiles}
              profilesLoading={profilesLoading}
              refreshProfiles={refreshProfiles}
              setDefaultProfile={setDefaultProfile}
              deleteProfile={deleteProfile}
            />
          )}

          {/* Non-Google integrations */}
          {nonGoogleIntegrations.map((i: any) => {
            const isBrowser = i.slug === 'browser';
            const isConnected = isBrowser
              ? (browserStatus?.connected ?? false)
              : !!connectedMap[i.slug];

            return (
              <StandardCard
                key={i.slug}
                integration={i}
                isConnected={isConnected}
                connectedMap={connectedMap}
                handleConnect={handleConnect}
                handleDisconnect={handleDisconnect}
                handleLearnMore={handleLearnMore}
                profiles={profiles}
                profilesLoading={profilesLoading}
                setDefaultProfile={setDefaultProfile}
                deleteProfile={deleteProfile}
                pyStatus={pyStatus}
                pyEnvId={pyEnvId}
                setPyEnvId={setPyEnvId}
                pyInstalling={pyInstalling}
                installPython={installPython}
                ffStatus={ffStatus}
                ffInstalling={ffInstalling}
                refreshFfmpegStatus={refreshFfmpegStatus}
                mpStatus={mpStatus}
                mpInstalling={mpInstalling}
                refreshMediapipeStatus={refreshMediapipeStatus}
                browserStatus={browserStatus}
                refreshBrowserStatus={refreshBrowserStatus}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};
