import React, { useEffect, useMemo, useState } from "react";
import type { ThemeMode, TonePreset } from "../hooks/usePreferences";
import { RefreshCw, Download, ArrowUpCircle, CheckCircle, AlertCircle, Loader2, FlaskConical, Beaker, RotateCcw, X, Sparkles } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { clsx } from "clsx";
import { FileIndexSettings } from "./FileIndexSettings";
import { BillingSettings } from "./BillingSettings";

type UpdateChannel = "stable" | "beta" | "staging";
type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "downloaded" | "error" | "up-to-date";

interface UpdateState {
  status: UpdateStatus;
  channel: UpdateChannel;
  currentVersion: string;
  latestVersion?: string;
  releaseNotes?: string;
  downloadProgress?: number;
  error?: string;
}

interface BetaAccess {
  hasBetaAccess: boolean;
  hasStagingAccess: boolean;
  loading: boolean;
}

interface SettingsViewProps {
  themeMode: ThemeMode;
  setThemeMode: (v: ThemeMode) => void;
  themeDarkShade: string;
  setThemeDarkShade: (v: string) => void;
  themeLightShade: string;
  setThemeLightShade: (v: string) => void;
  themeText: "white" | "black";
  setThemeText: (v: "white" | "black") => void;
  translucentMode: boolean;
  setTranslucentMode: (v: boolean) => void;
  wakewordEnabled: boolean;
  setWakewordEnabled: (v: boolean) => void;
  terminalEnabled: boolean;
  setTerminalEnabled: (v: boolean) => void;
  browserEnabled: boolean;
  setBrowserEnabled: (v: boolean) => void;
  handleSaveTheme: () => void;
  tone: TonePreset;
  setTone: (t: TonePreset) => void;
  customTone: string;
  setCustomTone: (v: string) => void;
  personaDraft: string;
  setPersonaDraft: (v: string) => void;
  persona: string | null;
  handleSaveTonePersona: () => void;
  setOnboardingComplete: (v: boolean) => void;
}

const SectionHeader = ({ title, description }: { title: string, description: string }) => (
  <div className="mb-6">
    <h3 className="text-xl font-stuard text-theme-fg tracking-tight">{title}</h3>
    <p className="text-sm text-theme-muted font-medium">{description}</p>
  </div>
);

const PresetButton = ({ label, active, onClick }: { label: string, active: boolean, onClick: () => void }) => (
  <button
    onClick={onClick}
    className={`px-3 py-1.5 rounded-theme-button text-[12px] font-bold transition-all border shadow-sm ${active
        ? "bg-primary text-primary-fg border-primary shadow-md"
        : "bg-theme-hover text-theme-fg border-theme hover:bg-theme-active"
      }`}
  >
    {label}
  </button>
);

const CLOUD_AI_HTTP = (window as any).__CLOUD_AI_HTTP__ || "https://api.stuard.ai";

async function checkBetaAccess(): Promise<BetaAccess> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.email) return { hasBetaAccess: false, hasStagingAccess: false, loading: false };
    const email = session.user.email.toLowerCase();
    const token = session.access_token;
    const { data, error } = await supabase.from('beta_users').select('access_level').eq('email', email).single();
    if (error || !data) {
      try {
        const resp = await fetch(`${CLOUD_AI_HTTP}/v1/beta/check`, { headers: { Authorization: `Bearer ${token}` } });
        const json = await resp.json();
        return { hasBetaAccess: json?.beta === true, hasStagingAccess: json?.staging === true, loading: false };
      } catch { return { hasBetaAccess: false, hasStagingAccess: false, loading: false }; }
    }
    const level = String(data.access_level || '').toLowerCase();
    return { hasBetaAccess: level === 'beta' || level === 'staging' || level === 'all', hasStagingAccess: level === 'staging' || level === 'all', loading: false };
  } catch { return { hasBetaAccess: false, hasStagingAccess: false, loading: false }; }
}

const RestartModal: React.FC<{ open: boolean; version: string; onConfirm: () => void; onCancel: () => void; }> = ({ open, version, onConfirm, onCancel }) => {
  const [countdown, setCountdown] = useState(5);
  const [autoRestart, setAutoRestart] = useState(false);
  useEffect(() => {
    if (!open) { setCountdown(5); setAutoRestart(false); return; }
    if (!autoRestart) return;
    const timer = setInterval(() => { setCountdown(c => { if (c <= 1) { clearInterval(timer); onConfirm(); return 0; } return c - 1; }); }, 1000);
    return () => clearInterval(timer);
  }, [open, autoRestart, onConfirm]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-theme-card rounded-theme-card shadow-2xl max-w-md w-full mx-4 overflow-hidden animate-in zoom-in-95 duration-200 border border-theme">
        <div className="bg-theme-hover p-4 text-theme-fg relative overflow-hidden border-b border-theme">
          <div className="relative z-10 flex items-center gap-3 font-stuard">
            <div className="p-1.5 bg-primary/10 rounded-md border border-primary/20">
              <Sparkles className="w-5 h-5 text-primary" />
            </div>
            <h2 className="text-lg font-bold tracking-tight">Update Ready!</h2>
          </div>
        </div>
        <div className="p-6">
          <p className="text-theme-fg text-sm font-medium mb-4">Version {version} has been downloaded and is ready to install.</p>
          <div className="flex items-start gap-3 p-3 bg-theme-hover border border-theme rounded-theme-button mb-4 font-medium">
            <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
            <div>
              <div className="font-bold text-theme-fg text-xs uppercase tracking-wide">Save your work</div>
              <div className="text-theme-muted text-[11px] mt-1">The app will close and restart automatically. Make sure to save any unsaved work.</div>
            </div>
          </div>
          <label className="flex items-center gap-3 p-3 bg-theme-hover rounded-theme-button cursor-pointer transition-colors mb-6 border border-theme hover:bg-theme-active font-medium">
            <input type="checkbox" checked={autoRestart} onChange={(e) => setAutoRestart(e.target.checked)} className="w-4 h-4 rounded border-theme bg-theme-card text-primary focus:ring-primary" />
            <div className="flex-1">
              <div className="text-xs font-bold text-theme-fg">Auto-restart</div>
              <div className="text-[11px] text-theme-muted font-bold">Restart automatically in {countdown} seconds</div>
            </div>
            {autoRestart && <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center animate-pulse"><span className="text-primary font-black text-[10px]">{countdown}</span></div>}
          </label>
          <div className="flex gap-3 justify-end">
            <button onClick={onCancel} className="px-4 py-2 rounded-theme-button border border-theme text-theme-muted text-xs font-bold hover:bg-theme-hover transition-colors">Later</button>
            <button onClick={onConfirm} className="px-4 py-2 rounded-theme-button bg-primary text-primary-fg text-xs font-bold hover:opacity-90 transition-colors shadow-sm">Restart Now</button>
          </div>
        </div>
      </div>
    </div>
  );
};

const UpdateManager: React.FC = () => {
  const [state, setState] = useState<UpdateState>({ status: "idle", channel: "stable", currentVersion: "0.0.0" });
  const [changingChannel, setChangingChannel] = useState(false);
  const [betaAccess, setBetaAccess] = useState<BetaAccess>({ hasBetaAccess: false, hasStagingAccess: false, loading: true });
  const [showRestartModal, setShowRestartModal] = useState(false);
  useEffect(() => {
    (window as any).desktopAPI?.updatesGetState?.().then((s: UpdateState) => { if (s) setState(s); });
    const unsub = (window as any).desktopAPI?.onUpdatesState?.((s: UpdateState) => { if (s) setState(s); });
    checkBetaAccess().then(setBetaAccess);
    return () => { if (typeof unsub === "function") unsub(); };
  }, []);
  const handleCheck = async () => { await (window as any).desktopAPI?.updatesCheck?.(); };
  const handleDownload = async () => { await (window as any).desktopAPI?.updatesDownload?.(); };
  const handleInstall = async () => { await (window as any).desktopAPI?.updatesInstall?.(); };
  const handleChannelChange = async (ch: UpdateChannel) => {
    if (ch === state.channel) return;
    if (ch === 'beta' && !betaAccess.hasBetaAccess) return;
    if (ch === 'staging' && !betaAccess.hasStagingAccess) return;
    setChangingChannel(true);
    try { await (window as any).desktopAPI?.updatesSetChannel?.(ch); await (window as any).desktopAPI?.updatesCheck?.(); } finally { setChangingChannel(false); }
  };
  const statusIcon = () => {
    switch (state.status) {
      case "checking": return <Loader2 className="w-5 h-5 animate-spin text-primary" />;
      case "available": return <ArrowUpCircle className="w-5 h-5 text-amber-500" />;
      case "downloading": return <Download className="w-5 h-5 animate-pulse text-primary" />;
      case "downloaded": return <CheckCircle className="w-5 h-5 text-emerald-500" />;
      case "error": return <AlertCircle className="w-5 h-5 text-red-500" />;
      case "up-to-date": return <CheckCircle className="w-5 h-5 text-emerald-500" />;
      default: return <RefreshCw className="w-5 h-5 text-theme-muted" />;
    }
  };
  const statusText = () => {
    switch (state.status) {
      case "checking": return "Checking...";
      case "available": return `v${state.latestVersion} available`;
      case "downloading": return `Downloading... ${state.downloadProgress ?? 0}%`;
      case "downloaded": return `v${state.latestVersion} ready`;
      case "error": return "Update failed";
      case "up-to-date": return "Up to date";
      default: return "Check for updates";
    }
  };
  const canAccessBeta = betaAccess.hasBetaAccess;
  const canAccessStaging = betaAccess.hasStagingAccess;

  return (
    <>
      <div className="bg-theme-card rounded-theme-card border border-theme p-6 shadow-sm mb-8">
        <SectionHeader title="Updates" description="Manage application updates and release channels." />
        <div className="flex items-center justify-between p-4 bg-theme-hover rounded-theme-button mb-6 border border-theme">
          <div>
            <div className="text-[10px] font-black text-theme-muted uppercase tracking-widest mb-1 pl-1">Current Version</div>
            <div className="text-2xl font-black text-theme-fg tracking-tight pl-1 font-stuard">{state.currentVersion}</div>
          </div>
          <div className="flex items-center gap-3 bg-theme-card px-4 py-2 rounded-theme-button border border-theme shadow-sm">
            {statusIcon()}
            <span className="text-xs font-bold text-theme-fg">{statusText()}</span>
          </div>
        </div>
        <div className="mb-6">
          <label className="block text-[10px] font-black text-theme-muted uppercase tracking-widest mb-3 ml-1">Update Channel</label>
          <div className={`grid gap-4 ${canAccessStaging ? 'grid-cols-3' : canAccessBeta ? 'grid-cols-2' : 'grid-cols-1'}`}>
            <button onClick={() => handleChannelChange("stable")} disabled={changingChannel} className={`p-4 rounded-theme-card border-2 transition-all relative overflow-hidden group ${state.channel === "stable" ? "border-emerald-500/50 bg-emerald-500/5" : "border-theme hover:border-emerald-500/30 bg-theme-bg hover:bg-theme-hover"}`}>
              <div className="flex items-center gap-2 mb-1.5"><CheckCircle className={`w-4 h-4 ${state.channel === "stable" ? "text-emerald-500" : "text-theme-muted group-hover:text-theme-fg"}`} /><span className={`font-bold text-[14px] ${state.channel === "stable" ? "text-emerald-600 dark:text-emerald-400" : "text-theme-muted"}`}>Stable</span></div>
              <p className="text-[11px] text-theme-muted text-left font-medium group-hover:text-theme-fg pl-6">Production releases</p>
            </button>
            {canAccessBeta && (
              <button onClick={() => handleChannelChange("beta")} disabled={changingChannel} className={`p-4 rounded-theme-card border-2 transition-all relative overflow-hidden group ${state.channel === "beta" ? "border-amber-500/50 bg-amber-500/5" : "border-theme hover:border-amber-500/30 bg-theme-bg hover:bg-theme-hover"}`}>
                <div className="flex items-center gap-2 mb-1.5"><Beaker className={`w-4 h-4 ${state.channel === "beta" ? "text-amber-500" : "text-theme-muted group-hover:text-theme-fg"}`} /><span className={`font-bold text-[14px] ${state.channel === "beta" ? "text-amber-600 dark:text-amber-400" : "text-theme-muted"}`}>Beta</span></div>
                <p className="text-[11px] text-theme-muted text-left font-medium group-hover:text-theme-fg pl-6">Early access features</p>
              </button>
            )}
            {canAccessStaging && (
              <button onClick={() => handleChannelChange("staging")} disabled={changingChannel} className={`p-4 rounded-theme-card border-2 transition-all relative overflow-hidden group ${state.channel === "staging" ? "border-primary/50 bg-primary/5" : "border-theme hover:border-primary/30 bg-theme-bg hover:bg-theme-hover"}`}>
                <div className="flex items-center gap-2 mb-1.5"><FlaskConical className={`w-4 h-4 ${state.channel === "staging" ? "text-primary" : "text-theme-muted group-hover:text-theme-fg"}`} /><span className={`font-bold text-[14px] ${state.channel === "staging" ? "text-primary" : "text-theme-muted"}`}>Staging</span></div>
                <p className="text-[11px] text-theme-muted text-left font-medium group-hover:text-theme-fg pl-6">Development builds</p>
              </button>
            )}
          </div>
        </div>
        <div className="flex gap-3">
          {(state.status === "idle" || state.status === "up-to-date" || state.status === "error") && (
            <button onClick={handleCheck} className="px-5 py-2 rounded-theme-button bg-primary text-primary-fg text-[12px] font-bold hover:opacity-90 transition-all shadow-sm flex items-center gap-2 active:scale-95"><RefreshCw className="w-4 h-4" />Check for Updates</button>
          )}
          {state.status === "available" && (
            <button onClick={handleDownload} className="px-5 py-2 rounded-theme-button bg-primary text-primary-fg text-[12px] font-bold hover:opacity-90 transition-all shadow-sm flex items-center gap-2 active:scale-95"><Download className="w-4 h-4" />Download Update</button>
          )}
          {state.status === "downloaded" && (
            <button onClick={() => setShowRestartModal(true)} className="px-5 py-2 rounded-theme-button bg-emerald-600 text-white text-[12px] font-bold hover:bg-emerald-500 transition-all shadow-sm flex items-center gap-2 active:scale-95"><RotateCcw className="w-4 h-4" />Restart to Update</button>
          )}
        </div>
        {state.releaseNotes && (state.status === "available" || state.status === "downloaded") && (
          <div className="mt-6 p-5 bg-theme-hover rounded-theme-button border border-theme">
            <div className="text-[10px] font-black text-theme-muted mb-2 uppercase tracking-widest">What's New in {state.latestVersion}</div>
            <div className="text-[13px] text-theme-fg leading-relaxed font-medium">{state.releaseNotes}</div>
          </div>
        )}
      </div>
      <RestartModal open={showRestartModal} version={state.latestVersion || ""} onConfirm={handleInstall} onCancel={() => setShowRestartModal(false)} />
    </>
  );
};

export const SettingsView: React.FC<SettingsViewProps> = ({
  themeMode, setThemeMode,
  themeDarkShade, setThemeDarkShade,
  themeLightShade, setThemeLightShade,
  themeText, setThemeText,
  translucentMode, setTranslucentMode,
  wakewordEnabled, setWakewordEnabled,
  terminalEnabled, setTerminalEnabled,
  browserEnabled, setBrowserEnabled,
  handleSaveTheme,
  tone, setTone,
  customTone, setCustomTone,
  personaDraft, setPersonaDraft,
  persona, handleSaveTonePersona,
  setOnboardingComplete,
}) => {
  return (
    <div className="max-w-4xl mx-auto pb-16">
      <div className="flex flex-col gap-1 mb-8">
        <h2 className="text-4xl font-stuard text-theme-fg tracking-tight">Settings</h2>
        <p className="text-theme-muted text-sm font-medium">Manage your preferences and application settings.</p>
      </div>

      <UpdateManager />

      <BillingSettings />

      <FileIndexSettings />

      <div className="bg-theme-card rounded-theme-card border border-theme p-6 shadow-sm mb-6">
        <SectionHeader title="AI Personality" description="Customize how the assistant communicates with you." />
        <div className="mb-6">
          <label className="block text-[10px] font-black text-theme-muted uppercase tracking-widest mb-2 ml-1">Tone of Voice</label>
          <div className="flex flex-wrap gap-2">
            {(["concise", "friendly", "formal", "technical", "custom"] as TonePreset[]).map((t) => (
              <PresetButton key={t} label={t.charAt(0).toUpperCase() + t.slice(1)} active={tone === t} onClick={() => setTone(t)} />
            ))}
          </div>
          {tone === "custom" && (
            <input value={customTone} onChange={(e) => setCustomTone(e.target.value)} placeholder="e.g. Witty, sarcastic, uses lots of emojis" className="mt-3 w-full max-w-md px-3 py-2 rounded-theme-button border border-theme bg-theme-hover text-theme-fg text-[13px] font-medium focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all shadow-sm placeholder:text-theme-muted" />
          )}
        </div>
        <div className="mb-6">
          <label className="block text-[10px] font-black text-theme-muted uppercase tracking-widest mb-1 ml-1">System Persona</label>
          <p className="text-[11px] text-theme-muted mb-2 ml-1 font-bold">Instructions included in every system prompt.</p>
          <textarea value={personaDraft} onChange={(e) => setPersonaDraft(e.target.value)} placeholder="You are an expert TypeScript engineer..." className="w-full min-h-[140px] px-3 py-2 rounded-theme-button border border-theme bg-theme-hover text-theme-fg text-[13px] leading-relaxed font-medium focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all resize-y shadow-sm placeholder:text-theme-muted" />
        </div>
        <div className="flex justify-end pt-4 border-t border-theme">
          <button onClick={handleSaveTonePersona} className="px-5 py-2 rounded-theme-button bg-primary text-primary-fg text-[12px] font-bold hover:opacity-90 transition-all shadow-sm">Save Personality</button>
        </div>
      </div>

      <div className="bg-theme-card rounded-theme-card border border-theme p-6 shadow-sm mb-6">
        <SectionHeader title="Appearance" description="Customize the look of your desktop overlay." />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div>
            <label className="block text-[10px] font-black text-theme-muted uppercase tracking-widest mb-2 ml-1">Color Theme</label>
            <div className="flex gap-2 mb-4">
              <PresetButton label="Light" active={themeMode === "light"} onClick={() => setThemeMode("light")} />
              <PresetButton label="Dark" active={themeMode === "dark"} onClick={() => setThemeMode("dark")} />
              <PresetButton label="Custom" active={themeMode === "custom"} onClick={() => setThemeMode("custom")} />
            </div>
            <div className="p-4 rounded-theme-button bg-theme-hover border border-theme font-medium">
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={translucentMode} onChange={(e) => setTranslucentMode(e.target.checked)} className="w-4 h-4 rounded border-theme bg-theme-card text-primary focus:ring-primary" />
                <span className="text-[13px] font-bold text-theme-fg">Translucent Overlay</span>
              </label>
              <p className="text-[11px] text-theme-muted mt-1 pl-7">Makes the compact bar semi-transparent with a blur effect.</p>
            </div>
          </div>
          {themeMode === 'custom' && (
            <div className="space-y-4 p-4 bg-theme-hover rounded-theme-card border border-theme">
              <div>
                <label className="block text-[10px] font-black text-theme-muted mb-1 uppercase tracking-widest">Gradient Start</label>
                <div className="flex items-center gap-3">
                  <div className="relative overflow-hidden w-10 h-6 rounded border border-theme">
                    <input type="color" value={themeDarkShade} onChange={(e) => setThemeDarkShade(e.target.value)} className="absolute -top-1 -left-1 w-12 h-8 cursor-pointer" />
                  </div>
                  <span className="text-[11px] font-mono font-bold text-theme-fg bg-theme-card px-2 py-0.5 rounded border border-theme">{themeDarkShade}</span>
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-black text-theme-muted mb-1 uppercase tracking-widest">Gradient End</label>
                <div className="flex items-center gap-3">
                  <div className="relative overflow-hidden w-10 h-6 rounded border border-theme">
                    <input type="color" value={themeLightShade} onChange={(e) => setThemeLightShade(e.target.value)} className="absolute -top-1 -left-1 w-12 h-8 cursor-pointer" />
                  </div>
                  <span className="text-[11px] font-mono font-bold text-theme-fg bg-theme-card px-2 py-0.5 rounded border border-theme">{themeLightShade}</span>
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-black text-theme-muted mb-1 uppercase tracking-widest">Text Contrast</label>
                <div className="flex gap-2">
                  <PresetButton label="White Text" active={themeText === "white"} onClick={() => setThemeText("white")} />
                  <PresetButton label="Black Text" active={themeText === "black"} onClick={() => setThemeText("black")} />
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="mt-6 flex justify-end pt-4 border-t border-theme">
          <button onClick={handleSaveTheme} className="px-5 py-2 rounded-theme-button bg-primary text-primary-fg text-[12px] font-bold hover:opacity-90 transition-all shadow-sm">Apply Theme</button>
        </div>
      </div>

      <div className="bg-theme-card rounded-theme-card border border-theme p-6 shadow-sm mb-6">
        <SectionHeader title="Advanced Features" description="Enable or disable advanced functionality." />
        <div className="space-y-3">
          <div className="p-4 rounded-theme-button bg-theme-hover/50 border border-theme">
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={wakewordEnabled} onChange={(e) => setWakewordEnabled(e.target.checked)} className="w-4 h-4 rounded border-theme bg-theme-card text-primary focus:ring-primary" />
              <span className="text-[13px] font-bold text-theme-fg">Voice Wake Word ("Hey Stuard")</span>
            </label>
            <p className="text-[11px] text-theme-muted mt-1 pl-7 font-bold">Voice activation with wake word detection.</p>
          </div>
          <div className="p-4 rounded-theme-button bg-theme-hover/50 border border-theme">
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={terminalEnabled} onChange={(e) => setTerminalEnabled(e.target.checked)} className="w-4 h-4 rounded border-theme bg-theme-card text-primary focus:ring-primary" />
              <span className="text-[13px] font-bold text-theme-fg">Terminal Access</span>
            </label>
            <p className="text-[11px] text-theme-muted mt-1 pl-7 font-bold">Interactive terminal and command execution.</p>
          </div>
          <div className="p-4 rounded-theme-button bg-theme-hover/50 border border-theme">
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={browserEnabled} onChange={(e) => setBrowserEnabled(e.target.checked)} className="w-4 h-4 rounded border-theme bg-theme-card text-primary focus:ring-primary" />
              <span className="text-[13px] font-bold text-theme-fg">Browser Integration</span>
            </label>
            <p className="text-[11px] text-theme-muted mt-1 pl-7 font-bold">Browser extension and web automation tools.</p>
          </div>
        </div>
      </div>

      <div className="bg-theme-card rounded-theme-card border border-red-500/20 p-6 shadow-sm">
        <h3 className="text-sm font-black text-red-500 mb-1 tracking-widest uppercase">Advanced</h3>
        <p className="text-xs text-theme-muted mb-4 font-bold">Be careful with these settings.</p>
        <div className="flex items-center justify-between p-4 bg-red-500/5 rounded-theme-button border border-red-500/20">
          <div>
            <div className="text-[13px] font-black text-theme-fg uppercase tracking-wide">Reset Onboarding</div>
            <div className="text-[11px] text-theme-muted font-bold mt-0.5">Go through the initial setup flow again.</div>
          </div>
          <button onClick={() => { setOnboardingComplete(false); (window as any).desktopAPI.openOnboarding(); }} className="px-4 py-2 rounded-theme-button border border-red-500/30 text-red-500 text-[12px] font-bold hover:bg-red-500/10 hover:border-red-500/50 transition-all active:scale-95">Reset</button>
        </div>
      </div>
    </div>
  );
};
