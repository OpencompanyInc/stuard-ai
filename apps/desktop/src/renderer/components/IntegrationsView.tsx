import React, { useEffect, useMemo, useState } from "react";
import { Search, Link2, RefreshCw, Box, Globe, Plus, Star, Trash2, Users, ChevronDown, ChevronUp, Terminal, Film, ScanFace, Mail, Github, HardDrive, Webhook, Calendar, Table, FileText, CheckCircle2, AlertCircle, ArrowUpRight, Download, ArrowRight, Loader2, Shield, X, Bot, Phone, MessageSquare } from "lucide-react";
import { clsx } from 'clsx';
import { getCloudAiHttp } from '../utils/cloud';

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
  setupPython: () => Promise<void> | void;
  installPython: () => Promise<void> | void;
  runPython: () => Promise<void> | void;
  ollamaStatus: any;
  ollamaChecking: boolean;
  refreshOllamaStatus: () => Promise<void> | void;
  startOllama: () => Promise<void> | void;
  profiles: IntegrationProfile[];
  profilesLoading: boolean;
  refreshProfiles: (provider?: string) => Promise<void> | void;
  setDefaultProfile: (provider: string, profileLabel: string) => Promise<void> | void;
  deleteProfile: (provider: string, profileLabel: string) => Promise<void> | void;
  telnyxPhones: Array<{phone: string, slot: number}>;
  telnyxVerifying: boolean;
  telnyxRequestCode: (phone: string, slot?: number) => Promise<{ ok: boolean; error?: string }>;
  telnyxVerifyCode: (code: string, slot?: number) => Promise<{ ok: boolean; phone?: string; error?: string }>;
  telnyxDisconnect: () => Promise<void>;
  telnyxRemovePhone: (slot: number) => Promise<void>;
  getToken?: () => string | null;
  whatsappPhone: string | null;
  whatsappConnecting: boolean;
  whatsappLinking: boolean;
  whatsappLinkCode: string | null;
  whatsappBotNumber: string | null;
  whatsappConnect: (phone: string) => Promise<{ ok: boolean; error?: string }>;
  whatsappInitiateLink: () => Promise<{ ok: boolean; error?: string }>;
  whatsappDisconnect: () => Promise<void>;
  browserUseStatus?: any;
  browserUseChecking?: boolean;
  browserUseSetupProgress?: string | null;
  refreshBrowserUseStatus?: () => Promise<void> | void;
  setupBrowserUse?: () => Promise<void> | void;
  stopBrowserUse?: () => Promise<void> | void;
  uninstallBrowserUse?: () => Promise<void> | void;
}

/** Map integration slug → backend provider name */
function slugToProvider(slug: string): string | null {
  if (slug === "github") return "github";
  if (slug === "outlook") return "outlook";
  if (slug === "discord") return "discord";
  if (slug === "reddit") return "reddit";
  if (slug === "facebook") return "facebook";
  if (slug === "instagram") return "instagram";
  if (slug === "threads") return "threads";
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
    case 'ollama': return <Bot className={size} />;
    case 'browser': return <Globe className={size} />;
    case 'browser-use': return <Globe className={size} />;
    case 'outlook': return <Mail className={size} />;
    case 'github': return <Github className={size} />;
    case 'discord': return <Users className={size} />;
    case 'reddit': return <ArrowUpRight className={size} />;
    case 'facebook': return <Globe className={size} />;
    case 'instagram': return <MessageSquare className={size} />;
    case 'threads': return <Users className={size} />;
    case 'google-drive': return <HardDrive className={size} />;
    case 'webhooks': return <Webhook className={size} />;
    case 'google-calendar': return <Calendar className={size} />;
    case 'gmail': return <Mail className={size} />;
    case 'google-sheets': return <Table className={size} />;
    case 'google-docs': return <FileText className={size} />;
    case 'telnyx': return <Phone className={size} />;
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

// ─── Phone number helpers ─────────────────────────────────────────────────────

function formatLocalDigits(digits: string): string {
  const d = digits.slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

// ─── Telnyx Phone Verification Card ─────────────────────────────────────────

interface TelnyxPhoneCardProps {
  isConnected: boolean;
  phones: Array<{phone: string, slot: number}>;
  verifying: boolean;
  requestCode: (phone: string, slot?: number) => Promise<{ ok: boolean; error?: string }>;
  verifyCode: (code: string, slot?: number) => Promise<{ ok: boolean; phone?: string; error?: string }>;
  removePhone: (slot: number) => Promise<void>;
  disconnect: () => Promise<void>;
  getToken?: () => string | null;
}

type SmsAgentTarget = 'desktop' | 'vm' | 'auto';

const TelnyxPhoneCard: React.FC<TelnyxPhoneCardProps> = ({
  isConnected, phones, verifying, requestCode, verifyCode, removePhone, disconnect, getToken,
}) => {
  const [step, setStep] = useState<'idle' | 'enter-phone' | 'enter-code'>('idle');
  // Split input: country code + local digits
  const [countryCode, setCountryCode] = useState('+1');
  const [localDigits, setLocalDigits] = useState('');
  const [editingCountry, setEditingCountry] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [addingSlot, setAddingSlot] = useState(0);

  // SMS routing settings
  const [smsTarget, setSmsTarget] = useState<SmsAgentTarget>('auto');
  const [vmAvailable, setVmAvailable] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(false);

  const nextAvailableSlot = () => {
    const usedSlots = new Set(phones.map(p => p.slot));
    for (let i = 0; i < 5; i++) {
      if (!usedSlots.has(i)) return i;
    }
    return -1;
  };

  useEffect(() => {
    if (!isConnected) return;
    let cancelled = false;
    const token = getToken?.();
    if (!token) return;
    (async () => {
      try {
        setLoadingSettings(true);
        const base = getCloudAiHttp();
        const resp = await fetch(`${base}/integrations/telnyx/sms-settings`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (resp.ok && !cancelled) {
          const data = await resp.json();
          if (data.ok) {
            setSmsTarget(data.agentTarget || 'auto');
            setVmAvailable(!!data.vmAvailable);
          }
        }
      } catch {} finally {
        if (!cancelled) setLoadingSettings(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isConnected, getToken]);

  const handleTargetChange = async (target: SmsAgentTarget) => {
    setSmsTarget(target);
    const token = getToken?.();
    if (!token) return;
    try {
      const base = getCloudAiHttp();
      await fetch(`${base}/integrations/telnyx/sms-settings`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ agentTarget: target }),
      });
    } catch {}
  };

  // E.164: countryCode + all digits of local input
  const e164 = `${countryCode}${localDigits.replace(/\D/g, '')}`;
  const localRaw = localDigits.replace(/\D/g, '');
  // US/CA (+1) needs exactly 10 local digits; others need 6–12
  const phoneValid = countryCode === '+1'
    ? localRaw.length === 10
    : localRaw.length >= 6 && e164.length <= 16;

  const handleLocalChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, countryCode === '+1' ? 10 : 12);
    setLocalDigits(countryCode === '+1' ? formatLocalDigits(digits) : digits);
  };

  const handleRequestCode = async () => {
    setError('');
    setSending(true);
    const result = await requestCode(e164, addingSlot);
    setSending(false);
    if (result.ok) {
      setStep('enter-code');
    } else {
      setError(result.error || 'Failed to send code.');
    }
  };

  const handleVerify = async () => {
    setError('');
    setSending(true);
    const result = await verifyCode(codeInput, addingSlot);
    setSending(false);
    if (result.ok) {
      setStep('idle');
      setLocalDigits('');
      setCodeInput('');
    } else {
      setError(result.error || 'Verification failed.');
    }
  };

  const handleDisconnect = async () => {
    await disconnect();
    setStep('idle');
    setLocalDigits('');
    setCodeInput('');
    setError('');
  };

  // Phone input UI shared between connected "add phone" and initial verify flows
  const phoneInputUI = (
    <div className="space-y-3">
      <div>
        <label className="block text-[11px] text-theme-muted font-medium mb-1.5">Phone Number</label>
        <div className="flex gap-1.5">
          {/* Country code badge -- click to edit */}
          {editingCountry ? (
            <input
              type="text"
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value.replace(/[^\d+]/g, '') || '+')}
              onBlur={() => setEditingCountry(false)}
              autoFocus
              className="w-16 px-2 py-2.5 rounded-lg bg-theme-bg border border-primary/50 text-[13px] text-theme-fg text-center font-mono focus:outline-none"
              placeholder="+1"
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditingCountry(true)}
              className="px-3 py-2.5 rounded-lg bg-theme-hover border border-theme text-[13px] font-mono text-theme-fg hover:border-primary/50 transition-colors whitespace-nowrap"
              title="Click to change country code"
            >
              {countryCode}
            </button>
          )}
          {/* Local number */}
          <input
            type="tel"
            inputMode="numeric"
            value={localDigits}
            onChange={handleLocalChange}
            onKeyDown={(e) => { if (e.key === 'Enter' && phoneValid) handleRequestCode(); }}
            placeholder={countryCode === '+1' ? '(614) 380-9607' : '123456789'}
            autoComplete="tel-national"
            autoFocus={!editingCountry}
            className={clsx(
              "flex-1 px-3 py-2.5 rounded-lg bg-theme-bg border text-[13px] text-theme-fg placeholder:text-theme-muted/40 focus:outline-none transition-colors",
              localRaw.length > 0 && phoneValid ? "border-emerald-500/50 focus:border-emerald-500" :
              localRaw.length > 0 && !phoneValid ? "border-red-500/40 focus:border-red-500/60" :
              "border-theme focus:border-primary/50"
            )}
          />
        </div>
        {/* Preview */}
        {phoneValid && (
          <p className="text-[11px] text-emerald-400 mt-1.5 flex items-center gap-1">
            <span className="opacity-60">Sending to:</span>
            <span className="font-mono font-medium">{e164}</span>
          </p>
        )}
        {!phoneValid && localRaw.length > 0 && (
          <p className="text-[11px] text-theme-muted mt-1.5">
            {countryCode === '+1' ? `${10 - localRaw.length} more digit${10 - localRaw.length !== 1 ? 's' : ''} needed` : 'Enter full number'}
          </p>
        )}
        {localRaw.length === 0 && (
          <p className="text-[10px] text-theme-muted mt-1.5">
            Click <span className="font-mono text-theme-fg">{countryCode}</span> to change country code
          </p>
        )}
      </div>
      {error && (
        <div className="px-3 py-2 rounded-md bg-red-900/20 border border-red-900/30">
          <p className="text-[11px] text-red-400">{error}</p>
        </div>
      )}
      <div className="flex gap-2">
        <button
          onClick={() => { setStep('idle'); setError(''); setLocalDigits(''); }}
          className="px-4 py-2 rounded-md bg-theme-hover text-theme-fg text-[11px] font-bold border border-theme hover:bg-theme-active transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleRequestCode}
          disabled={sending || !phoneValid}
          className="flex-1 px-4 py-2 rounded-md bg-primary text-white text-[11px] font-bold hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Phone className="w-3 h-3" />}
          {sending ? 'Sending...' : 'Send Code'}
        </button>
      </div>
    </div>
  );

  // Code verification UI shared between connected "add phone" and initial verify flows
  const codeInputUI = (
    <div className="space-y-3">
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-[11px] text-theme-muted font-medium">Verification Code</label>
          <span className="text-[10px] text-emerald-400 font-mono">{e164}</span>
        </div>
        <input
          type="text"
          inputMode="numeric"
          value={codeInput}
          onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
          onKeyDown={(e) => { if (e.key === 'Enter' && codeInput.length === 6) handleVerify(); }}
          placeholder="&#183; &#183; &#183; &#183; &#183; &#183;"
          maxLength={6}
          autoFocus
          className="w-full px-3 py-3 rounded-lg bg-theme-bg border border-theme text-[18px] text-theme-fg text-center tracking-[0.5em] font-mono placeholder:text-theme-muted/30 focus:outline-none focus:border-primary/50 transition-colors"
        />
        <p className="text-[10px] text-theme-muted mt-1.5 text-center">
          Check your texts — code expires in 10 min
        </p>
      </div>
      {error && (
        <div className="px-3 py-2 rounded-md bg-red-900/20 border border-red-900/30">
          <p className="text-[11px] text-red-400">{error}</p>
        </div>
      )}
      <div className="flex gap-2">
        <button
          onClick={() => { setStep('enter-phone'); setError(''); setCodeInput(''); }}
          className="px-4 py-2 rounded-md bg-theme-hover text-theme-fg text-[11px] font-bold border border-theme hover:bg-theme-active transition-colors"
        >
          Back
        </button>
        <button
          onClick={handleVerify}
          disabled={sending || codeInput.length !== 6}
          className="flex-1 px-4 py-2 rounded-md bg-primary text-white text-[11px] font-bold hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Shield className="w-3 h-3" />}
          {sending ? 'Verifying...' : 'Verify'}
        </button>
      </div>
    </div>
  );

  const primaryPhone = phones.length > 0 ? phones[0].phone : null;

  return (
    <div className={clsx(
      "bg-theme-card rounded-theme-card border shadow-sm transition-all duration-300",
      isConnected ? "border-primary/30" : "border-theme hover:border-theme-hover"
    )}>
      <div className="p-5">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={clsx(
              "w-10 h-10 rounded-lg border shadow-sm flex items-center justify-center",
              isConnected ? "bg-emerald-900/20 border-emerald-900/30" : "bg-theme-hover border-theme"
            )}>
              <Phone className={clsx("w-5 h-5", isConnected ? "text-emerald-400" : "text-theme-muted")} />
            </div>
            <div>
              <h3 className="font-bold text-[14px] text-theme-fg">Phone (SMS / Call)</h3>
              {isConnected && primaryPhone ? (
                <span className="text-[11px] text-emerald-400 font-medium">{phones.length} phone{phones.length !== 1 ? 's' : ''} verified</span>
              ) : (
                <span className="text-[11px] text-theme-muted">Verify your phone number</span>
              )}
            </div>
          </div>
          {isConnected && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-900/20 text-emerald-400 text-[10px] font-bold border border-emerald-900/30 uppercase">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Verified
            </span>
          )}
        </div>

        <p className="text-[12px] text-theme-muted mb-4 leading-relaxed">
          Receive SMS messages and phone calls from Stuard. Used for workflow notifications and proactive check-ins.
        </p>

        {isConnected ? (
          <div className="space-y-3">
            {/* List of verified phones */}
            {phones.map((p) => (
              <div key={p.slot} className="flex items-center gap-2">
                <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-md bg-theme-bg border border-theme text-[12px]">
                  <MessageSquare className="w-4 h-4 text-emerald-400" />
                  <span className="text-theme-fg font-medium">{p.phone}</span>
                  {p.slot === 0 && <span className="text-[9px] text-theme-muted uppercase">Primary</span>}
                </div>
                <button
                  onClick={() => p.slot === 0 ? handleDisconnect() : removePhone(p.slot)}
                  className="px-2 py-2 rounded-md bg-red-900/20 text-red-400 text-[11px] font-bold border border-red-900/30 hover:bg-red-900/30 transition-colors"
                  title={p.slot === 0 ? 'Remove all phones' : 'Remove this phone'}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}

            {/* Add more phone button (up to 5) */}
            {phones.length < 5 && step === 'idle' && (
              <button
                onClick={() => { setAddingSlot(nextAvailableSlot()); setStep('enter-phone'); }}
                className="w-full px-3 py-2 rounded-md bg-theme-hover text-theme-fg text-[11px] font-bold border border-dashed border-theme hover:border-theme-hover transition-colors flex items-center justify-center gap-2"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Phone ({phones.length}/5)
              </button>
            )}

            {/* Phone input / code verification UI for adding a phone */}
            {step === 'enter-phone' && phoneInputUI}
            {step === 'enter-code' && codeInputUI}

            {/* SMS Routing Target */}
            <div>
              <label className="block text-[11px] text-theme-muted font-medium mb-1.5">SMS Agent Routing</label>
              <div className="flex gap-1.5">
                {([
                  { value: 'auto' as const, label: 'Auto', desc: 'VM first, then desktop' },
                  { value: 'vm' as const, label: 'Cloud VM', desc: 'VM agent only' },
                  { value: 'desktop' as const, label: 'Desktop', desc: 'Desktop agent only' },
                ] as const).map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => handleTargetChange(opt.value)}
                    disabled={loadingSettings}
                    className={clsx(
                      "flex-1 px-2 py-2 rounded-md text-[11px] font-bold border transition-colors text-center",
                      smsTarget === opt.value
                        ? "bg-primary/20 border-primary/40 text-primary"
                        : "bg-theme-hover border-theme text-theme-muted hover:border-theme-hover hover:text-theme-fg",
                      opt.value === 'vm' && !vmAvailable && "opacity-60"
                    )}
                    title={opt.desc + (opt.value === 'vm' && !vmAvailable ? ' (VM not running)' : '')}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-theme-muted mt-1">
                {smsTarget === 'auto' ? 'Tries VM agent first, falls back to desktop inbox' :
                 smsTarget === 'vm' ? (vmAvailable ? 'All SMS messages go to Cloud VM agent' : 'Cloud VM is not running — start it to use VM routing') :
                 'All SMS messages queued for desktop agent'}
              </p>
            </div>
          </div>
        ) : step === 'idle' ? (
          <button
            onClick={() => { setAddingSlot(0); setStep('enter-phone'); }}
            className="w-full px-4 py-2.5 rounded-lg bg-primary text-white text-[12px] font-bold hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
          >
            <Phone className="w-4 h-4" />
            Verify Phone Number
          </button>
        ) : step === 'enter-phone' ? (
          phoneInputUI
        ) : (
          codeInputUI
        )}
      </div>
    </div>
  );
};

interface WhatsAppCardProps {
  isConnected: boolean;
  phone: string | null;
  connecting: boolean;
  linking: boolean;
  linkCode: string | null;
  botNumber: string | null;
  connect: (phone: string) => Promise<{ ok: boolean; error?: string }>;
  initiateLink: () => Promise<{ ok: boolean; error?: string }>;
  disconnect: () => Promise<void>;
}

const WA_ICON = (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
  </svg>
);

const WhatsAppCard: React.FC<WhatsAppCardProps> = ({
  isConnected, phone, connecting, linking, linkCode, botNumber, connect, initiateLink, disconnect,
}) => {
  const [step, setStep] = useState<'idle' | 'enter-phone'>('idle');
  const [phoneInput, setPhoneInput] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  const handleConnect = async () => {
    setError('');
    setSending(true);
    const result = await connect(phoneInput);
    setSending(false);
    if (result.ok) {
      setStep('idle');
      setPhoneInput('');
    } else {
      setError(result.error || 'Failed to connect.');
    }
  };

  const handleDisconnect = async () => {
    await disconnect();
    setStep('idle');
    setPhoneInput('');
    setError('');
  };

  const waLink = linkCode && botNumber
    ? `https://wa.me/${botNumber}?text=${encodeURIComponent(linkCode)}`
    : null;

  return (
    <div className={clsx(
      "bg-theme-card rounded-theme-card border shadow-sm transition-all duration-300",
      isConnected ? "border-[#25D366]/30" : "border-theme hover:border-theme-hover"
    )}>
      <div className="p-5">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={clsx(
              "w-10 h-10 rounded-lg border shadow-sm flex items-center justify-center",
              isConnected ? "bg-[#25D366]/15 border-[#25D366]/30" : "bg-theme-hover border-theme"
            )}>
              <span className={clsx("w-5 h-5", isConnected ? "text-[#25D366]" : "text-theme-muted")}>
                {WA_ICON}
              </span>
            </div>
            <div>
              <h3 className="font-bold text-[14px] text-theme-fg">WhatsApp</h3>
              {isConnected && phone ? (
                <span className="text-[11px] text-[#25D366] font-medium">{phone}</span>
              ) : linking ? (
                <span className="text-[11px] text-theme-muted">Waiting for confirmation…</span>
              ) : (
                <span className="text-[11px] text-theme-muted">Connect your WhatsApp number</span>
              )}
            </div>
          </div>
          {isConnected && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#25D366]/10 text-[#25D366] text-[10px] font-bold border border-[#25D366]/25 uppercase">
              <span className="w-1.5 h-1.5 rounded-full bg-[#25D366] animate-pulse" />
              Linked
            </span>
          )}
        </div>

        <p className="text-[12px] text-theme-muted mb-4 leading-relaxed">
          Receive WhatsApp messages, voice notes, images, and files from Stuard. Enter your number — we'll send a confirmation message.
        </p>

        {isConnected ? (
          /* Connected */
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-md bg-theme-bg border border-theme text-[12px]">
              <span className="w-4 h-4 text-[#25D366] shrink-0">{WA_ICON}</span>
              <span className="text-theme-fg font-medium">{phone}</span>
            </div>
            <button
              onClick={handleDisconnect}
              className="px-3 py-2 rounded-md bg-red-900/20 text-red-400 text-[11px] font-bold border border-red-900/30 hover:bg-red-900/30 transition-colors"
            >
              Remove
            </button>
          </div>
        ) : linking && linkCode ? (
          /* Webhook linking — code flow (bonus, when webhook is configured) */
          <div className="space-y-3">
            <div className="rounded-lg border border-[#25D366]/25 bg-[#25D366]/5 p-3">
              <p className="text-[10px] text-theme-muted font-medium uppercase tracking-wider mb-2">Message Stuard this code on WhatsApp</p>
              <div className="flex items-center gap-2">
                <span className="flex-1 font-mono text-[18px] font-black text-theme-fg tracking-[0.2em]">{linkCode}</span>
                <button
                  onClick={() => { try { navigator.clipboard.writeText(linkCode); } catch {} }}
                  className="p-1.5 rounded-md bg-theme-hover border border-theme hover:bg-theme-active transition-colors text-theme-muted hover:text-theme-fg"
                  title="Copy"
                >
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2}>
                    <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                  </svg>
                </button>
              </div>
            </div>
            {waLink ? (
              <button
                className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg bg-[#25D366] text-white text-[12px] font-bold hover:bg-[#20b855] transition-colors"
                onClick={() => { try { (window as any).desktopAPI?.openExternal?.(waLink); } catch { window.open(waLink, '_blank'); } }}
              >
                <span className="w-4 h-4">{WA_ICON}</span>
                Open WhatsApp &amp; Send Code
              </button>
            ) : (
              <p className="text-[11px] text-theme-muted">Open WhatsApp and send the code above to Stuard's business number.</p>
            )}
            <div className="flex items-center gap-2 text-[10px] text-theme-muted">
              <Loader2 className="w-3 h-3 animate-spin text-[#25D366]" />
              Waiting… code expires in 15 min
            </div>
          </div>
        ) : step === 'idle' ? (
          /* Idle — primary CTA */
          <div className="space-y-2">
            {error && <p className="text-[11px] text-red-400">{error}</p>}
            <button
              onClick={() => { setStep('enter-phone'); setError(''); }}
              disabled={connecting}
              className="w-full px-4 py-2.5 rounded-lg bg-[#25D366] text-white text-[12px] font-bold hover:bg-[#20b855] transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <span className="w-4 h-4">{WA_ICON}</span>
              Connect WhatsApp
            </button>
          </div>
        ) : (
          /* Enter phone number */
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] text-theme-muted font-medium mb-1.5">Your WhatsApp Number</label>
              <input
                type="tel"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && phoneInput.trim()) handleConnect(); }}
                placeholder="+1 (555) 123-4567"
                className="w-full px-3 py-2.5 rounded-lg bg-theme-bg border border-theme text-[13px] text-theme-fg placeholder:text-theme-muted/50 focus:outline-none focus:border-[#25D366]/50 transition-colors"
                autoFocus
              />
              <p className="text-[10px] text-theme-muted mt-1.5">Include country code. We'll send a WhatsApp message to confirm.</p>
            </div>
            {error && <p className="text-[11px] text-red-400">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => { setStep('idle'); setError(''); setPhoneInput(''); }}
                className="px-4 py-2 rounded-md bg-theme-hover text-theme-fg text-[11px] font-bold border border-theme hover:bg-theme-active transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConnect}
                disabled={sending || !phoneInput.trim()}
                className="flex-1 px-4 py-2 rounded-md bg-[#25D366] text-white text-[11px] font-bold hover:bg-[#20b855] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : <span className="w-3 h-3">{WA_ICON}</span>}
                Connect
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
  ollamaStatus?: any;
  ollamaChecking?: boolean;
  refreshOllamaStatus?: () => Promise<void> | void;
  startOllama?: () => Promise<void> | void;
  browserUseStatus?: any;
  browserUseChecking?: boolean;
  browserUseSetupProgress?: string | null;
  refreshBrowserUseStatus?: () => Promise<void> | void;
  setupBrowserUse?: () => Promise<void> | void;
  stopBrowserUse?: () => Promise<void> | void;
  uninstallBrowserUse?: () => Promise<void> | void;
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
  ollamaStatus, ollamaChecking, refreshOllamaStatus, startOllama,
  browserUseStatus, browserUseChecking, browserUseSetupProgress, refreshBrowserUseStatus, setupBrowserUse, stopBrowserUse, uninstallBrowserUse,
}) => {
  const [showProfiles, setShowProfiles] = useState(false);
  const [addingProfile, setAddingProfile] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");

  const isPython = i.slug === 'python';
  const isFfmpeg = i.slug === 'ffmpeg';
  const isMediapipe = i.slug === 'mediapipe';
  const isOllama = i.slug === 'ollama';
  const isBrowserUse = i.slug === 'browser-use';
  const isOAuth = isOAuthSlug(i.slug);
  const provider = slugToProvider(i.slug);
  const cardProfiles = isOAuth && provider ? profiles.filter(p => p.provider === provider) : [];
  const defaultProfile = cardProfiles.find(p => p.is_default);

  const ffAvailable = !!(ffStatus && (ffStatus as any).available);
  const mpAvailable = !!(mpStatus && (mpStatus as any).available);
  const ollamaAvailable = !!(ollamaStatus && (ollamaStatus as any).available);
  const ollamaInstalled = !!(ollamaStatus && (ollamaStatus as any).installed);
  const ollamaRunning = !!(ollamaStatus && (ollamaStatus as any).running);
  const ollamaModels: any[] = (ollamaStatus as any)?.models || [];
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
        <div className="mb-4 p-3 bg-theme-bg rounded-lg border border-theme space-y-2">
          <div className="flex items-center gap-2 text-[11px]">
            {pyStatus?.available ? (
              <>
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="font-semibold text-emerald-400">Ready</span>
                <span className="text-theme-muted ml-auto font-mono text-[10px]">{pyStatus.version}</span>
              </>
            ) : (
              <>
                <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                <span className="font-semibold text-theme-fg">Setting up...</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* FFmpeg details */}
      {isFfmpeg && (
        <div className="mb-4 p-3 bg-theme-bg rounded-lg border border-theme space-y-2">
          <div className="flex items-center gap-2 text-[11px]">
            {ffInstalling ? (
              <>
                <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
                <span className="font-semibold text-theme-fg">Installing...</span>
              </>
            ) : ffAvailable ? (
              <>
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="font-semibold text-emerald-400">Ready</span>
              </>
            ) : (
              <>
                <AlertCircle className="w-3.5 h-3.5 text-theme-muted" />
                <span className="font-semibold text-theme-fg">Not installed</span>
                <span className="text-theme-muted text-[10px] ml-auto">Click Install to set up</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* MediaPipe details */}
      {isMediapipe && (
        <div className="mb-4 p-3 bg-theme-bg rounded-lg border border-theme space-y-2">
          <div className="flex items-center gap-2 text-[11px]">
            {mpInstalling ? (
              <>
                <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
                <span className="font-semibold text-theme-fg">Installing...</span>
              </>
            ) : mpAvailable ? (
              <>
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="font-semibold text-emerald-400">Ready</span>
                {(mpStatus as any)?.version && <span className="text-theme-muted ml-auto font-mono text-[10px]">v{String((mpStatus as any).version)}</span>}
              </>
            ) : (
              <>
                <AlertCircle className="w-3.5 h-3.5 text-theme-muted" />
                <span className="font-semibold text-theme-fg">Not installed</span>
                <span className="text-theme-muted text-[10px] ml-auto">Click Install to set up</span>
              </>
            )}
          </div>
          {!mpInstalling && !mpAvailable && (mpStatus as any)?.error && (
            <div className="text-[10px] text-red-400 break-all">
              {String((mpStatus as any).error).slice(0, 200)}
            </div>
          )}
        </div>
      )}

      {/* Ollama details */}
      {isOllama && (
        <div className="mb-4 p-3 bg-theme-bg rounded-lg border border-theme space-y-3">
          {ollamaAvailable ? (
            <>
              <div className="flex items-center gap-2 text-[11px]">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="font-semibold text-emerald-400">Running</span>
                <span className="text-theme-muted ml-auto">{ollamaModels.length} model{ollamaModels.length !== 1 ? 's' : ''}</span>
              </div>
              {ollamaModels.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {ollamaModels.slice(0, 6).map((m: any) => (
                    <span key={m.name} className="px-1.5 py-0.5 bg-violet-500/10 text-violet-400 border border-violet-500/20 rounded text-[9px] font-mono font-bold">
                      {m.name}
                    </span>
                  ))}
                  {ollamaModels.length > 6 && (
                    <span className="px-1.5 py-0.5 bg-theme-hover text-theme-muted border border-theme rounded text-[9px] font-bold">
                      +{ollamaModels.length - 6}
                    </span>
                  )}
                </div>
              )}
            </>
          ) : ollamaInstalled ? (
            <div className="space-y-2.5">
              <div className="flex items-center gap-2 text-[11px]">
                <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                <span className="font-semibold text-theme-fg">Installed, not running</span>
              </div>
              <p className="text-[11px] text-theme-muted leading-relaxed">
                Ollama is installed. Click Start and Stuard will launch it for you.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={startOllama}
                  disabled={ollamaChecking}
                  className="flex-1 h-7 flex items-center justify-center gap-1.5 rounded-md bg-primary text-primary-fg text-[10px] font-bold hover:opacity-90 transition-all active:scale-95 disabled:opacity-50"
                >
                  {ollamaChecking ? <Loader2 className="w-3 h-3 animate-spin" /> : <Bot className="w-3 h-3" />}
                  Start Ollama
                </button>
                <button
                  onClick={refreshOllamaStatus}
                  disabled={ollamaChecking}
                  className="h-7 px-3 flex items-center justify-center gap-1.5 rounded-md border border-theme text-theme-muted text-[10px] font-bold hover:bg-theme-hover transition-all disabled:opacity-50"
                >
                  <RefreshCw className={clsx("w-3 h-3", ollamaChecking && "animate-spin")} />
                  Retry
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="flex items-center gap-2 text-[11px]">
                <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                <span className="font-semibold text-theme-fg">Not installed</span>
              </div>
              <p className="text-[11px] text-theme-muted leading-relaxed">
                Ollama lets you run AI models privately on your computer. Install it, then click Retry.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => handleLearnMore('https://ollama.com/download')}
                  className="flex-1 h-7 flex items-center justify-center gap-1.5 rounded-md bg-violet-600 text-white text-[10px] font-bold hover:bg-violet-500 transition-all active:scale-95"
                >
                  <Download className="w-3 h-3" />
                  Download Ollama
                </button>
                <button
                  onClick={refreshOllamaStatus}
                  disabled={ollamaChecking}
                  className="h-7 px-3 flex items-center justify-center gap-1.5 rounded-md border border-theme text-theme-muted text-[10px] font-bold hover:bg-theme-hover transition-all disabled:opacity-50"
                >
                  <RefreshCw className={clsx("w-3 h-3", ollamaChecking && "animate-spin")} />
                  Retry
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Stuard Browser details */}
      {isBrowserUse && (
        <div className="mb-4 p-3 bg-theme-bg rounded-lg border border-theme space-y-3">
          {browserUseStatus?.running ? (
            <>
              <div className="flex items-center gap-2 text-[11px]">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="font-semibold text-emerald-400">Running</span>
                <span className="text-theme-muted ml-auto text-[10px]">{browserUseStatus.mode || 'headed'}</span>
              </div>
              {browserUseStatus.currentUrl && browserUseStatus.currentUrl !== 'about:blank' && (
                <div className="text-[10px] text-theme-muted truncate" title={browserUseStatus.currentUrl}>
                  {browserUseStatus.title || browserUseStatus.currentUrl}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={stopBrowserUse}
                  className="flex-1 h-7 flex items-center justify-center gap-1.5 rounded-md border border-red-500/30 text-red-400 text-[10px] font-bold hover:bg-red-500/10 transition-all"
                >
                  Stop Browser
                </button>
                <button
                  onClick={uninstallBrowserUse}
                  disabled={browserUseChecking}
                  className="h-7 px-3 flex items-center justify-center gap-1.5 rounded-md border border-red-500/30 text-red-400 text-[10px] font-bold hover:bg-red-500/10 transition-all disabled:opacity-50"
                  title="Uninstall Stuard Browser"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </>
          ) : browserUseSetupProgress ? (
            <div className="flex items-center gap-2.5 text-[11px]">
              <Loader2 className="w-4 h-4 text-primary animate-spin flex-shrink-0" />
              <div className="space-y-0.5">
                <span className="font-semibold text-theme-fg">{browserUseSetupProgress}</span>
                <p className="text-[10px] text-theme-muted">This may take a minute on first setup</p>
              </div>
            </div>
          ) : browserUseStatus?.installed ? (
            <div className="space-y-2.5">
              <div className="flex items-center gap-2 text-[11px]">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span className="font-semibold text-theme-fg">Installed</span>
                <span className="text-theme-muted ml-auto text-[10px]">Auto-start on use</span>
              </div>
              <p className="text-[11px] text-theme-muted leading-relaxed">
                Stuard Browser is installed and launches automatically when a browser tool needs it.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={uninstallBrowserUse}
                  disabled={browserUseChecking}
                  className="w-full h-7 flex items-center justify-center gap-1.5 rounded-md border border-red-500/30 text-red-400 text-[10px] font-bold hover:bg-red-500/10 transition-all disabled:opacity-50"
                  title="Uninstall Stuard Browser"
                >
                  <Trash2 className="w-3 h-3" />
                  Uninstall
                </button>
              </div>
              {browserUseStatus?.error && (
                <p className="text-[10px] text-red-400 leading-relaxed">{String(browserUseStatus.error)}</p>
              )}
            </div>
          ) : browserUseStatus?.hasPython === false ? (
            <div className="space-y-2.5">
              <div className="flex items-center gap-2 text-[11px]">
                <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                <span className="font-semibold text-theme-fg">Python required</span>
              </div>
              <p className="text-[11px] text-theme-muted leading-relaxed">
                Stuard Browser needs Python 3.11+. Download it first, then come back and click Set Up.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => handleLearnMore('https://www.python.org/downloads/')}
                  className="flex-1 h-7 flex items-center justify-center gap-1.5 rounded-md bg-amber-600 text-white text-[10px] font-bold hover:bg-amber-500 transition-all active:scale-95"
                >
                  <Download className="w-3 h-3" />
                  Get Python
                </button>
                <button
                  onClick={refreshBrowserUseStatus}
                  disabled={browserUseChecking}
                  className="h-7 px-3 flex items-center justify-center gap-1.5 rounded-md border border-theme text-theme-muted text-[10px] font-bold hover:bg-theme-hover transition-all disabled:opacity-50"
                >
                  <RefreshCw className={clsx("w-3 h-3", browserUseChecking && "animate-spin")} />
                </button>
              </div>
            </div>
          ) : browserUseStatus?.error ? (
            <div className="space-y-2.5">
              <div className="flex items-center gap-2 text-[11px]">
                <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                <span className="font-semibold text-red-400">Setup failed</span>
              </div>
              <p className="text-[10px] text-theme-muted leading-relaxed">{browserUseStatus.error}</p>
              <button
                onClick={setupBrowserUse}
                disabled={browserUseChecking}
                className="w-full h-7 flex items-center justify-center gap-1.5 rounded-md bg-primary text-primary-fg text-[10px] font-bold hover:opacity-90 transition-all disabled:opacity-50 active:scale-95"
              >
                Try Again
              </button>
            </div>
          ) : (
            <div className="space-y-2.5">
              <p className="text-[11px] text-theme-muted leading-relaxed">
                Click below to install Stuard Browser and set up browser automation.
              </p>
            </div>
          )}

        </div>
      )}

      {/* Actions */}
      <div className="pt-3 mt-auto border-t border-theme border-dashed flex items-center gap-2">
        {i.available ? (
          isBrowserUse ? (
            browserUseStatus?.running ? (
              <div className="flex-1 flex items-center gap-2 text-[10px] text-theme-muted font-medium">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Browser Active
              </div>
            ) : browserUseSetupProgress ? (
              <div className="flex-1 flex items-center gap-2 text-[10px] text-theme-muted font-medium">
                <Loader2 className="w-3 h-3 animate-spin" />
                {browserUseSetupProgress}
              </div>
            ) : browserUseStatus?.installed ? (
              <div className="flex-1 flex items-center gap-2 text-[10px] text-theme-muted font-medium">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                Installed
              </div>
            ) : (
              <button
                onClick={setupBrowserUse}
                disabled={browserUseChecking}
                className="flex-1 h-8 flex items-center justify-center gap-2 rounded-md bg-primary text-primary-fg text-[11px] font-bold shadow-sm transition-all active:scale-95 disabled:opacity-50 hover:opacity-90"
              >
                {browserUseChecking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                {browserUseChecking ? 'Setting up...' : browserUseStatus?.error ? 'Try Again' : 'Set Up'}
              </button>
            )
          ) : isOllama ? (
            ollamaRunning || ollamaAvailable ? (
              <>
                <div className="flex-1 flex items-center gap-2 text-[10px] text-theme-muted font-medium">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Ollama Active
                </div>
                <button
                  onClick={refreshOllamaStatus}
                  disabled={ollamaChecking}
                  className="h-8 w-8 flex items-center justify-center rounded-md text-theme-muted hover:text-theme-fg hover:bg-theme-hover transition-all disabled:opacity-50"
                  title="Refresh"
                >
                  <RefreshCw className={clsx("w-3.5 h-3.5", ollamaChecking && "animate-spin")} />
                </button>
              </>
            ) : ollamaInstalled ? (
              <>
                <button
                  onClick={startOllama}
                  disabled={ollamaChecking}
                  className="flex-1 h-8 flex items-center justify-center gap-2 rounded-md bg-primary text-primary-fg text-[11px] font-bold shadow-sm transition-all active:scale-95 hover:opacity-90 disabled:opacity-50"
                >
                  {ollamaChecking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bot className="w-3.5 h-3.5" />}
                  Start Ollama
                </button>
                <button
                  onClick={refreshOllamaStatus}
                  disabled={ollamaChecking}
                  className="h-8 w-8 flex items-center justify-center rounded-md text-theme-muted hover:text-theme-fg hover:bg-theme-hover transition-all disabled:opacity-50"
                  title="Retry"
                >
                  <RefreshCw className={clsx("w-3.5 h-3.5", ollamaChecking && "animate-spin")} />
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => handleLearnMore('https://ollama.com/download')}
                  className="flex-1 h-8 flex items-center justify-center gap-2 rounded-md bg-violet-600 text-white text-[11px] font-bold shadow-sm transition-all active:scale-95 hover:bg-violet-500"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download Ollama
                </button>
                <button
                  onClick={refreshOllamaStatus}
                  disabled={ollamaChecking}
                  className="h-8 w-8 flex items-center justify-center rounded-md text-theme-muted hover:text-theme-fg hover:bg-theme-hover transition-all disabled:opacity-50"
                  title="Retry"
                >
                  <RefreshCw className={clsx("w-3.5 h-3.5", ollamaChecking && "animate-spin")} />
                </button>
              </>
            )
          ) : isConnected ? (
            isPython ? (
              <div className="flex-1 flex items-center gap-2 text-[10px] text-theme-muted font-medium">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Python Ready
              </div>
            ) : isFfmpeg ? (
              <div className="flex-1 flex items-center gap-2 text-[10px] text-theme-muted font-medium">
                {ffInstalling ? <Loader2 className="w-3 h-3 animate-spin" /> : <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
                {ffInstalling ? 'Installing...' : 'FFmpeg Ready'}
              </div>
            ) : isMediapipe ? (
              <div className="flex-1 flex items-center gap-2 text-[10px] text-theme-muted font-medium">
                {mpInstalling ? <Loader2 className="w-3 h-3 animate-spin" /> : <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
                {mpInstalling ? 'Installing...' : 'MediaPipe Ready'}
              </div>
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
                disabled={(isFfmpeg && ffInstalling) || (isMediapipe && mpInstalling) || (isPython && pyInstalling)}
                className={clsx(
                  "flex-1 h-8 flex items-center justify-center gap-2 rounded-md text-[11px] font-bold shadow-sm transition-all active:scale-95 disabled:opacity-50",
                  (isFfmpeg || isMediapipe || isPython) ? "bg-theme-fg text-theme-bg hover:opacity-90" : "bg-primary text-primary-fg hover:opacity-90"
                )}
              >
                {(isFfmpeg || isMediapipe || isPython) ? (
                  (ffInstalling || mpInstalling || pyInstalling) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />
                ) : <ArrowRight className="w-3.5 h-3.5" />}
                {isFfmpeg ? (ffInstalling ? 'Installing...' : 'Install')
                 : isMediapipe ? (mpInstalling ? 'Installing...' : 'Install')
                 : isPython ? (pyInstalling ? 'Setting up...' : 'Set Up')
                 : 'Connect'}
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
    ollamaStatus,
    ollamaChecking,
    refreshOllamaStatus,
    startOllama,
    telnyxPhones,
    telnyxVerifying,
    telnyxRequestCode,
    telnyxVerifyCode,
    telnyxDisconnect,
    telnyxRemovePhone,
    getToken,
    whatsappPhone,
    whatsappConnecting,
    whatsappLinking,
    whatsappLinkCode,
    whatsappBotNumber,
    whatsappConnect,
    whatsappInitiateLink,
    whatsappDisconnect,
    browserUseStatus,
    browserUseChecking,
    browserUseSetupProgress,
    refreshBrowserUseStatus,
    setupBrowserUse,
    stopBrowserUse,
    uninstallBrowserUse,
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
    () => filteredIntegrations.filter(i => !isGoogleSlug(i.slug) && i.slug !== 'telnyx' && i.slug !== 'whatsapp' && i.slug !== 'browser'),
    [filteredIntegrations]
  );
  const showTelnyxCard = useMemo(
    () => filteredIntegrations.some(i => i.slug === 'telnyx'),
    [filteredIntegrations]
  );
  const showWhatsAppCard = useMemo(
    () => filteredIntegrations.some(i => i.slug === 'whatsapp'),
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

          {/* Telnyx phone card */}
          {showTelnyxCard && (
            <TelnyxPhoneCard
              isConnected={!!connectedMap.telnyx}
              phones={telnyxPhones}
              verifying={telnyxVerifying}
              requestCode={telnyxRequestCode}
              verifyCode={telnyxVerifyCode}
              removePhone={telnyxRemovePhone}
              disconnect={telnyxDisconnect}
              getToken={getToken}
            />
          )}

          {/* WhatsApp card */}
          {showWhatsAppCard && (
            <WhatsAppCard
              isConnected={!!connectedMap.whatsapp}
              phone={whatsappPhone}
              connecting={whatsappConnecting}
              linking={whatsappLinking}
              linkCode={whatsappLinkCode}
              botNumber={whatsappBotNumber}
              connect={whatsappConnect}
              initiateLink={whatsappInitiateLink}
              disconnect={whatsappDisconnect}
            />
          )}

          {/* Non-Google integrations */}
          {nonGoogleIntegrations.map((i: any) => {
            const isBrowserUseSlug = i.slug === 'browser-use';
            const isConnected = isBrowserUseSlug
              ? !!(browserUseStatus?.running || browserUseStatus?.installed)
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
                ollamaStatus={ollamaStatus}
                ollamaChecking={ollamaChecking}
                refreshOllamaStatus={refreshOllamaStatus}
                startOllama={startOllama}
                browserUseStatus={browserUseStatus}
                browserUseChecking={browserUseChecking}
                browserUseSetupProgress={browserUseSetupProgress}
                refreshBrowserUseStatus={refreshBrowserUseStatus}
                setupBrowserUse={setupBrowserUse}
                stopBrowserUse={stopBrowserUse}
                uninstallBrowserUse={uninstallBrowserUse}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};
