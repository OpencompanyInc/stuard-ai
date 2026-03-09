import React, { useEffect, useState } from "react";
import { Lock, Archive } from "lucide-react";

/**
 * Reusable password gate for memory/history-locked content.
 * If `memory_lock_enabled` is on and a password is set, shows a password prompt.
 * Otherwise renders children directly.
 */
export function MemoryLockGate({ children, label }: { children: React.ReactNode; label?: string }) {
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await (window as any).desktopAPI?.securityGetSettings?.();
        if (res?.ok && res.settings) {
          const isLocked = res.settings.memory_lock_enabled && res.settings.has_password;
          setLocked(isLocked);
          if (!isLocked) setUnlocked(true);
        } else {
          setUnlocked(true);
        }
      } catch {
        setUnlocked(true);
      }
      setLoading(false);
    })();
  }, []);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pw) return;
    setVerifying(true);
    setError("");
    try {
      const res = await (window as any).desktopAPI?.securityVerifyPassword?.(pw);
      if (res?.ok && res.valid) {
        setUnlocked(true);
      } else {
        setError("Incorrect password");
        setPw("");
      }
    } catch {
      setError("Verification failed");
    }
    setVerifying(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full py-20">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (locked && !unlocked) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-20">
        <div className="bg-theme-card border border-theme rounded-2xl shadow-lg p-8 w-full max-w-sm">
          <div className="flex flex-col items-center mb-6">
            <div className="p-4 rounded-2xl bg-primary/10 mb-3">
              <Archive className="w-8 h-8 text-primary" />
            </div>
            <h3 className="text-lg font-bold text-theme-fg">{label || "Content Locked"}</h3>
            <p className="text-xs text-theme-muted mt-1 text-center">Enter your security password to continue.</p>
          </div>
          <form onSubmit={handleUnlock} className="space-y-3">
            <input
              type="password"
              value={pw}
              onChange={e => setPw(e.target.value)}
              placeholder="Enter password..."
              autoFocus
              className="w-full bg-theme-hover border border-theme rounded-xl px-4 py-3 text-sm text-theme-fg placeholder:text-theme-muted/50 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-all text-center"
            />
            {error && <p className="text-xs text-red-400 text-center font-medium">{error}</p>}
            <button
              type="submit"
              disabled={!pw || verifying}
              className="w-full px-4 py-3 rounded-xl text-sm font-bold bg-primary text-primary-fg hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
            >
              {verifying ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Lock className="w-4 h-4" />}
              Unlock
            </button>
          </form>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
