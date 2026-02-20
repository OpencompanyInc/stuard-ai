import React, { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import {
  Lock,
  Unlock,
  Eye,
  EyeOff,
  Check,
  Loader2,
  Shield,
  ShieldCheck,
  Database,
  MessageSquare,
  Brain,
  Key,
  HardDrive,
  Cloud,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Info,
} from 'lucide-react';

const AGENT_HTTP = (window as any).__AGENT_HTTP__ || "http://127.0.0.1:8765";

interface SecurityState {
  memory_lock_enabled: boolean;
  lock_timeout_minutes: number;
  has_password: boolean;
  biometric_enabled: boolean;
  sync_enabled: boolean;
  last_sync_at: string | null;
}

interface MemoryStats {
  conversations: number;
  messages: number;
  spaces: number;
  space_items: number;
  segments: number;
  pending_sync: number;
}

interface KnowledgeStats {
  entities: number;
  facts: number;
  pending_memories: number;
  facts_by_category: Record<string, number>;
  entities_by_type: Record<string, number>;
}

// Toggle switch component
function Toggle({ enabled, onChange, disabled }: { enabled: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onChange}
      disabled={disabled}
      className={clsx(
        'relative w-11 h-6 rounded-full transition-all duration-300 flex-shrink-0',
        enabled ? 'bg-primary shadow-md shadow-primary/25' : 'bg-theme-hover border border-theme',
        disabled && 'opacity-40 cursor-not-allowed'
      )}
    >
      <span
        className={clsx(
          'absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition-all duration-300 shadow-sm',
          enabled ? 'translate-x-5 bg-white' : 'translate-x-0 bg-theme-muted/60'
        )}
      />
    </button>
  );
}

// Stat card component
function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: number | string; color: string }) {
  return (
    <div className="bg-theme-card border border-theme rounded-theme-card p-4 flex items-center gap-3.5 hover:border-primary/20 transition-all group">
      <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-105', color)}>
        <Icon className="w-4.5 h-4.5 text-white" />
      </div>
      <div className="min-w-0">
        <p className="text-xl font-black text-theme-fg tracking-tight leading-none">{value}</p>
        <p className="text-[11px] text-theme-muted font-semibold uppercase tracking-wider mt-0.5">{label}</p>
      </div>
    </div>
  );
}

// Section wrapper
function Section({ title, icon: Icon, children, defaultOpen = true }: { title: string; icon: any; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-theme-card border border-theme rounded-theme-card overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-5 py-4 hover:bg-theme-hover/50 transition-colors"
      >
        <Icon className="w-4 h-4 text-primary flex-shrink-0" />
        <span className="text-sm font-bold text-theme-fg tracking-tight flex-1 text-left">{title}</span>
        {open ? <ChevronDown className="w-4 h-4 text-theme-muted" /> : <ChevronRight className="w-4 h-4 text-theme-muted" />}
      </button>
      {open && <div className="px-5 pb-5 space-y-4">{children}</div>}
    </div>
  );
}

export function SecuritySettings() {
  const [settings, setSettings] = useState<SecurityState | null>(null);
  const [memStats, setMemStats] = useState<MemoryStats | null>(null);
  const [knowledgeStats, setKnowledgeStats] = useState<KnowledgeStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [isLocked, setIsLocked] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState('');
  const [showUnlockPassword, setShowUnlockPassword] = useState(false);
  const [unlockError, setUnlockError] = useState('');
  
  // Password setup
  const [showPasswordSetup, setShowPasswordSetup] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  const loadSettings = async () => {
    try {
      const res = await fetch(`${AGENT_HTTP}/v1/memory/security`);
      const data = await res.json();
      if (data.ok && data.settings) {
        setSettings(data.settings);
        setIsLocked(data.settings.memory_lock_enabled && data.settings.has_password);
      }
    } catch (e) {
      console.error('Failed to load security settings:', e);
    }
  };

  const loadStats = async () => {
    try {
      const [memRes, knowledgeRes] = await Promise.all([
        fetch(`${AGENT_HTTP}/v1/memory/stats`).catch(() => null),
        fetch(`${AGENT_HTTP}/v1/knowledge/stats`).catch(() => null),
      ]);
      if (memRes) {
        const memData = await memRes.json();
        if (memData.ok && memData.stats) setMemStats(memData.stats);
      }
      if (knowledgeRes) {
        const knowledgeData = await knowledgeRes.json();
        if (knowledgeData.ok && knowledgeData.stats) setKnowledgeStats(knowledgeData.stats);
      }
    } catch (e) {
      console.error('Failed to load stats:', e);
    }
  };

  useEffect(() => {
    Promise.all([loadSettings(), loadStats()]).finally(() => setLoading(false));
  }, []);

  const handleUnlock = async () => {
    setUnlockError('');
    try {
      const res = await fetch(`${AGENT_HTTP}/v1/memory/security/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: unlockPassword }),
      });
      const data = await res.json();
      if (data.ok && data.valid) {
        setIsLocked(false);
        setUnlockPassword('');
      } else {
        setUnlockError('Incorrect password');
      }
    } catch (e) {
      setUnlockError('Failed to verify password');
    }
  };

  const handleSetPassword = async () => {
    setPasswordError('');
    setPasswordSuccess('');

    if (newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match');
      return;
    }

    try {
      const res = await fetch(`${AGENT_HTTP}/v1/memory/security/password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: newPassword,
          current_password: settings?.has_password ? currentPassword : undefined,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setPasswordSuccess('Password updated successfully');
        setNewPassword('');
        setConfirmPassword('');
        setCurrentPassword('');
        setTimeout(() => {
          setShowPasswordSetup(false);
          setPasswordSuccess('');
        }, 1500);
        loadSettings();
      } else {
        const msg = data.error === 'invalid_current_password' ? 'Current password is incorrect'
          : data.error === 'current_password_required' ? 'Current password is required'
          : data.error || 'Failed to set password';
        setPasswordError(msg);
      }
    } catch (e) {
      setPasswordError('Failed to set password');
    }
  };

  const handleToggleLock = async () => {
    if (!settings) return;
    try {
      const res = await fetch(`${AGENT_HTTP}/v1/memory/security`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memory_lock_enabled: !settings.memory_lock_enabled }),
      });
      const data = await res.json();
      if (data.ok) loadSettings();
    } catch (e) {
      console.error('Failed to toggle lock:', e);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
        <p className="text-sm text-theme-muted font-medium">Loading privacy settings...</p>
      </div>
    );
  }

  // Locked state - show unlock screen
  if (isLocked) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8">
        <div className="w-20 h-20 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-6">
          <Lock className="w-9 h-9 text-primary" />
        </div>
        <h2 className="text-xl font-black text-theme-fg mb-1.5 font-stuard">Memories Locked</h2>
        <p className="text-sm text-theme-muted mb-6 text-center max-w-xs">
          Enter your password to view and manage your private data
        </p>
        
        <div className="w-full max-w-xs space-y-3">
          <div className="relative">
            <input
              type={showUnlockPassword ? 'text' : 'password'}
              value={unlockPassword}
              onChange={(e) => setUnlockPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
              placeholder="Enter password"
              autoFocus
              className="w-full px-4 py-2.5 pr-10 border border-theme bg-theme-card text-theme-fg rounded-xl text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 placeholder:text-theme-muted/50"
            />
            <button
              type="button"
              onClick={() => setShowUnlockPassword(!showUnlockPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-theme-muted hover:text-theme-fg transition-colors"
            >
              {showUnlockPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          
          {unlockError && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
              <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
              <p className="text-xs text-red-400 font-medium">{unlockError}</p>
            </div>
          )}
          
          <button
            onClick={handleUnlock}
            disabled={!unlockPassword}
            className={clsx(
              "w-full py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2",
              unlockPassword
                ? "bg-primary text-primary-fg hover:brightness-110 shadow-md shadow-primary/20"
                : "bg-theme-hover text-theme-muted cursor-not-allowed"
            )}
          >
            <Unlock className="w-4 h-4" />
            Unlock
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6 space-y-5">

        {/* Data Overview */}
        <div>
          <h3 className="text-xs font-black text-theme-muted uppercase tracking-widest mb-3 px-1">Your Data</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatCard icon={MessageSquare} label="Conversations" value={memStats?.conversations ?? 0} color="bg-blue-500" />
            <StatCard icon={Database} label="Messages" value={memStats?.messages ?? 0} color="bg-indigo-500" />
            <StatCard icon={Brain} label="Knowledge" value={knowledgeStats?.facts ?? 0} color="bg-violet-500" />
            <StatCard icon={HardDrive} label="Spaces" value={memStats?.spaces ?? 0} color="bg-emerald-500" />
            <StatCard icon={Database} label="Topics" value={memStats?.segments ?? 0} color="bg-amber-500" />
            <StatCard icon={Brain} label="Entities" value={knowledgeStats?.entities ?? 0} color="bg-rose-500" />
          </div>
        </div>

        {/* Memory Lock */}
        <Section title="Memory Lock" icon={Shield}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-theme-fg">Require password</p>
              <p className="text-xs text-theme-muted mt-0.5">Lock the Privacy tab with a password</p>
            </div>
            <Toggle
              enabled={settings?.memory_lock_enabled ?? false}
              onChange={handleToggleLock}
              disabled={!settings?.has_password}
            />
          </div>

          {!settings?.has_password && (
            <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-amber-500/8 border border-amber-500/15">
              <Info className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-600 dark:text-amber-400 leading-relaxed">
                Set a password below to enable memory lock. This will require authentication before viewing your memories.
              </p>
            </div>
          )}

          {settings?.memory_lock_enabled && settings?.has_password && (
            <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-emerald-500/8 border border-emerald-500/15">
              <ShieldCheck className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-emerald-600 dark:text-emerald-400 leading-relaxed">
                Memory lock is active. The Privacy tab will require your password next time you open it.
              </p>
            </div>
          )}
        </Section>

        {/* Password Management */}
        <Section title={settings?.has_password ? 'Password' : 'Set Password'} icon={Key}>
          {!showPasswordSetup ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-theme-fg">
                  {settings?.has_password ? 'Password is set' : 'No password configured'}
                </p>
                <p className="text-xs text-theme-muted mt-0.5">
                  {settings?.has_password 
                    ? 'Your memories are password protected'
                    : 'Set a password to protect access to your memories'}
                </p>
              </div>
              <button
                onClick={() => setShowPasswordSetup(true)}
                className="px-4 py-2 text-xs font-bold bg-primary/10 text-primary border border-primary/20 rounded-xl hover:bg-primary/20 transition-all"
              >
                {settings?.has_password ? 'Change' : 'Set Up'}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {settings?.has_password && (
                <div>
                  <label className="text-[11px] font-bold text-theme-muted uppercase tracking-wider mb-1.5 block">Current Password</label>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter current password"
                    className="w-full px-3.5 py-2.5 text-sm border border-theme bg-theme-bg text-theme-fg rounded-xl focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 placeholder:text-theme-muted/50"
                  />
                </div>
              )}
              
              <div>
                <label className="text-[11px] font-bold text-theme-muted uppercase tracking-wider mb-1.5 block">New Password</label>
                <div className="relative">
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Min 6 characters"
                    className="w-full px-3.5 py-2.5 pr-10 text-sm border border-theme bg-theme-bg text-theme-fg rounded-xl focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 placeholder:text-theme-muted/50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-theme-muted hover:text-theme-fg transition-colors"
                  >
                    {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              
              <div>
                <label className="text-[11px] font-bold text-theme-muted uppercase tracking-wider mb-1.5 block">Confirm Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  onKeyDown={(e) => e.key === 'Enter' && handleSetPassword()}
                  className="w-full px-3.5 py-2.5 text-sm border border-theme bg-theme-bg text-theme-fg rounded-xl focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 placeholder:text-theme-muted/50"
                />
              </div>

              {passwordError && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                  <p className="text-xs text-red-400 font-medium">{passwordError}</p>
                </div>
              )}
              {passwordSuccess && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <Check className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                  <p className="text-xs text-emerald-400 font-medium">{passwordSuccess}</p>
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => {
                    setShowPasswordSetup(false);
                    setNewPassword('');
                    setConfirmPassword('');
                    setCurrentPassword('');
                    setPasswordError('');
                    setPasswordSuccess('');
                  }}
                  className="flex-1 py-2.5 text-xs font-bold bg-theme-hover text-theme-fg border border-theme rounded-xl hover:bg-theme-active transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSetPassword}
                  disabled={!newPassword || !confirmPassword || (settings?.has_password && !currentPassword)}
                  className={clsx(
                    "flex-1 py-2.5 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5",
                    newPassword && confirmPassword && (!settings?.has_password || currentPassword)
                      ? "bg-primary text-primary-fg hover:brightness-110 shadow-md shadow-primary/20"
                      : "bg-theme-hover text-theme-muted cursor-not-allowed"
                  )}
                >
                  <Check className="w-3.5 h-3.5" />
                  {settings?.has_password ? 'Update' : 'Set Password'}
                </button>
              </div>
            </div>
          )}
        </Section>

        {/* Cloud Sync */}
        <Section title="Cloud Sync" icon={Cloud} defaultOpen={false}>
          <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-primary/5 border border-primary/10">
            <Info className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs text-theme-fg font-semibold mb-0.5">Coming Soon</p>
              <p className="text-xs text-theme-muted leading-relaxed">
                End-to-end encrypted cloud sync will allow you to securely sync your memories across devices. Your data will be encrypted locally before upload.
              </p>
            </div>
          </div>
        </Section>

        {/* Privacy Info Footer */}
        <div className="flex items-start gap-3 px-5 py-4 rounded-theme-card bg-theme-card border border-theme">
          <ShieldCheck className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-bold text-theme-fg mb-1">Local-First Privacy</p>
            <p className="text-[11px] text-theme-muted leading-relaxed">
              All memories are stored locally on your device and encrypted at rest using AES-256-GCM. 
              Stuard never sends your personal data to external servers without your explicit consent.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
