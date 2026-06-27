import React, { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import {
  LockClosedIcon,
  LockOpen1Icon,
  EyeOpenIcon,
  EyeClosedIcon,
  CheckIcon,
  Cross2Icon,
  UpdateIcon,
  UploadIcon,
} from '@radix-ui/react-icons';

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

export function SecuritySettings() {
  const [settings, setSettings] = useState<SecurityState | null>(null);
  const [stats, setStats] = useState<MemoryStats | null>(null);
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
      const res = await fetch(`${AGENT_HTTP}/v1/memory/stats`);
      const data = await res.json();
      if (data.ok && data.stats) {
        setStats(data.stats);
      }
    } catch (e) {
      console.error('Failed to load memory stats:', e);
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
        setPasswordSuccess('Password set successfully');
        setNewPassword('');
        setConfirmPassword('');
        setCurrentPassword('');
        setShowPasswordSetup(false);
        loadSettings();
      } else {
        setPasswordError(data.error || 'Failed to set password');
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
      if (data.ok) {
        loadSettings();
      }
    } catch (e) {
      console.error('Failed to toggle lock:', e);
    }
  };

  const handleToggleSync = async () => {
    if (!settings) return;
    
    try {
      const res = await fetch(`${AGENT_HTTP}/v1/memory/security`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sync_enabled: !settings.sync_enabled }),
      });
      const data = await res.json();
      if (data.ok) {
        loadSettings();
      }
    } catch (e) {
      console.error('Failed to toggle sync:', e);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <UpdateIcon className="w-6 h-6 animate-spin text-[#0e639c]" />
      </div>
    );
  }

  // Locked state - show unlock screen
  if (isLocked) {
    return (
      <div className="flex flex-col items-center justify-center h-64 p-6">
        <div className="w-16 h-16 rounded-full bg-[#3c3c3c] flex items-center justify-center mb-4 border border-[#454545]">
          <LockClosedIcon className="w-8 h-8 text-[#0e639c]" />
        </div>
        <h2 className="text-lg font-semibold text-[#cccccc] mb-2">Memory Locked</h2>
        <p className="text-sm text-[#969696] mb-4 text-center">
          Enter your password to access your memories
        </p>
        
        <div className="w-full max-w-xs space-y-3">
          <div className="relative">
            <input
              type={showUnlockPassword ? 'text' : 'password'}
              value={unlockPassword}
              onChange={(e) => setUnlockPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
              placeholder="Password"
              className="w-full px-4 py-2 pr-10 border border-[#3e3e3e] bg-[#252526] text-[#cccccc] rounded-md focus:outline-none focus:border-[#0e639c] focus:ring-1 focus:ring-[#0e639c]"
            />
            <button
              type="button"
              onClick={() => setShowUnlockPassword(!showUnlockPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#969696] hover:text-[#cccccc]"
            >
              {showUnlockPassword ? <EyeClosedIcon /> : <EyeOpenIcon />}
            </button>
          </div>
          
          {unlockError && (
            <p className="text-sm text-red-400 text-center">{unlockError}</p>
          )}
          
          <button
            onClick={handleUnlock}
            className="w-full py-2 bg-[#0e639c] text-white rounded-md hover:bg-[#1177bb] transition-colors font-medium"
          >
            Unlock
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6">
      {/* Stats Overview */}
      {stats && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-[#252526] border border-[#3e3e3e] rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-[#0e639c]">{stats.conversations}</p>
            <p className="text-xs text-[#969696]">Conversations</p>
          </div>
          <div className="bg-[#252526] border border-[#3e3e3e] rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-[#0e639c]">{stats.messages}</p>
            <p className="text-xs text-[#969696]">Messages</p>
          </div>
          <div className="bg-[#252526] border border-[#3e3e3e] rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-[#0e639c]">{stats.spaces}</p>
            <p className="text-xs text-[#969696]">Spaces</p>
          </div>
        </div>
      )}

      {/* Security Settings */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-[#cccccc] flex items-center gap-2">
          <LockClosedIcon className="w-4 h-4" />
          Security
        </h3>

        {/* Memory Lock Toggle */}
        <div className="flex items-center justify-between p-3 bg-[#252526] border border-[#3e3e3e] rounded-lg">
          <div>
            <p className="text-sm font-medium text-[#cccccc]">Memory Lock</p>
            <p className="text-xs text-[#969696]">Require password to view memories</p>
          </div>
          <button
            onClick={handleToggleLock}
            disabled={!settings?.has_password}
            className={clsx(
              'relative w-11 h-6 rounded-full transition-colors',
              settings?.memory_lock_enabled ? 'bg-[#0e639c]' : 'bg-[#3c3c3c]',
              !settings?.has_password && 'opacity-50 cursor-not-allowed'
            )}
          >
            <span
              className={clsx(
                'absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow',
                settings?.memory_lock_enabled && 'translate-x-5'
              )}
            />
          </button>
        </div>

        {/* Set/Change Password */}
        <div className="p-3 bg-[#252526] border border-[#3e3e3e] rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[#cccccc]">
                {settings?.has_password ? 'Change Password' : 'Set Password'}
              </p>
              <p className="text-xs text-[#969696]">
                {settings?.has_password 
                  ? 'Update your memory lock password' 
                  : 'Protect your memories with a password'}
              </p>
            </div>
            <button
              onClick={() => setShowPasswordSetup(!showPasswordSetup)}
              className="px-3 py-1.5 text-sm text-[#0e639c] hover:bg-[#3c3c3c] rounded-md transition-colors font-medium"
            >
              {showPasswordSetup ? 'Cancel' : (settings?.has_password ? 'Change' : 'Set Up')}
            </button>
          </div>

          {showPasswordSetup && (
            <div className="mt-4 space-y-3">
              {settings?.has_password && (
                <div className="relative">
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Current password"
                    className="w-full px-3 py-2 text-sm border border-[#3e3e3e] bg-[#3c3c3c] text-[#cccccc] rounded-md focus:outline-none focus:border-[#0e639c]"
                  />
                </div>
              )}
              
              <div className="relative">
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="New password (min 6 characters)"
                  className="w-full px-3 py-2 pr-10 text-sm border border-[#3e3e3e] bg-[#3c3c3c] text-[#cccccc] rounded-md focus:outline-none focus:border-[#0e639c]"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#969696] hover:text-[#cccccc]"
                >
                  {showNewPassword ? <EyeClosedIcon className="w-4 h-4" /> : <EyeOpenIcon className="w-4 h-4" />}
                </button>
              </div>
              
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                className="w-full px-3 py-2 text-sm border border-[#3e3e3e] bg-[#3c3c3c] text-[#cccccc] rounded-md focus:outline-none focus:border-[#0e639c]"
              />

              {passwordError && (
                <p className="text-xs text-red-400">{passwordError}</p>
              )}
              {passwordSuccess && (
                <p className="text-xs text-green-400">{passwordSuccess}</p>
              )}

              <button
                onClick={handleSetPassword}
                className="w-full py-2 text-sm bg-[#0e639c] text-white rounded-md hover:bg-[#1177bb] transition-colors font-medium"
              >
                {settings?.has_password ? 'Update Password' : 'Set Password'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Cloud Sync Settings */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-[#cccccc] flex items-center gap-2">
          <UploadIcon className="w-4 h-4" />
          Cloud Sync
        </h3>

        <div className="flex items-center justify-between p-3 bg-[#252526] border border-[#3e3e3e] rounded-lg">
          <div>
            <p className="text-sm font-medium text-[#cccccc]">Enable Sync</p>
            <p className="text-xs text-[#969696]">
              Sync encrypted memories across devices
            </p>
            {settings?.last_sync_at && (
              <p className="text-xs text-[#969696] mt-1">
                Last sync: {new Date(settings.last_sync_at).toLocaleString()}
              </p>
            )}
          </div>
          <button
            onClick={handleToggleSync}
            className={clsx(
              'relative w-11 h-6 rounded-full transition-colors',
              settings?.sync_enabled ? 'bg-[#0e639c]' : 'bg-[#3c3c3c]'
            )}
          >
            <span
              className={clsx(
                'absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow',
                settings?.sync_enabled && 'translate-x-5'
              )}
            />
          </button>
        </div>

        {settings?.sync_enabled && (
          <div className="p-3 bg-[#252526] rounded-lg border border-[#0e639c]/30">
            <p className="text-xs text-[#0e639c]">
              <strong>End-to-end encrypted:</strong> Your memories are encrypted locally before upload. 
              Even Stuard cannot read your synced data.
            </p>
          </div>
        )}
      </div>

      {/* Data Info */}
      <div className="text-xs text-[#969696] text-center pt-4 border-t border-[#3e3e3e]">
        <p>All memories are stored locally and encrypted at rest.</p>
        <p>Cloud sync uses end-to-end encryption with your password.</p>
      </div>
    </div>
  );
}
