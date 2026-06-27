import React, { useState, useEffect, useRef, useCallback } from 'react';
import { clsx } from 'clsx';
import { FolderLock, Shield, FolderOpen, Trash2, AlertTriangle, Loader2, Plus } from 'lucide-react';

const AGENT_HTTP = (window as any).__AGENT_HTTP__ || "http://127.0.0.1:8765";
const FOLDER_PERMISSIONS_BASE = `${AGENT_HTTP}/v1/folder-permissions`;

interface FolderRule { id: string; path: string; permission: "read" | "write" | "both"; }

interface FolderPermissionsPopoverProps {
  /** Current tab / session ID — rules are scoped to this session. */
  sessionId?: string;
}

export const FolderPermissionsPopover: React.FC<FolderPermissionsPopoverProps> = ({ sessionId = "default" }) => {
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState<FolderRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [selectedPerm, setSelectedPerm] = useState<"read" | "write" | "both">("both");
  const popoverRef = useRef<HTMLDivElement>(null);
  const api = (window as any).desktopAPI;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${FOLDER_PERMISSIONS_BASE}?session_id=${encodeURIComponent(sessionId)}`);
      const data = await res.json();
      if (data.ok) { setRules(data.rules || []); }
    } catch { } finally { setLoading(false); }
  }, [sessionId]);

  useEffect(() => { if (open) load(); }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleAdd = async () => {
    setAdding(true);
    try {
      const result = await api?.pickFolder?.({ title: "Select folder to allow" });
      if (result?.ok && result?.folders?.length > 0) {
        const folderPath = typeof result.folders[0] === 'string' ? result.folders[0] : result.folders[0]?.path;
        if (!folderPath) return;
        await fetch(`${FOLDER_PERMISSIONS_BASE}/add`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: folderPath, permission: selectedPerm, session_id: sessionId }),
        });
        await load();
      }
    } catch { } finally { setAdding(false); }
  };

  const handleRemove = async (id: string) => {
    try {
      await fetch(`${FOLDER_PERMISSIONS_BASE}/remove`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, session_id: sessionId }),
      });
      await load();
    } catch { }
  };

  const handlePermChange = async (rule: FolderRule, perm: string) => {
    try {
      await fetch(`${FOLDER_PERMISSIONS_BASE}/add`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: rule.path, permission: perm, session_id: sessionId }),
      });
      await load();
    } catch { }
  };

  const hasActiveRules = rules.length > 0;

  return (
    <div className="relative" ref={popoverRef}>
      <button
        className={clsx(
          "h-10 w-10 rounded-[18px] flex items-center justify-center transition-all hover:scale-105 active:scale-95 flex-shrink-0",
          hasActiveRules
            ? "text-emerald-500 bg-emerald-500/10 hover:bg-emerald-500/20"
            : "text-theme-muted hover:text-theme-fg hover:bg-theme-hover"
        )}
        onClick={() => setOpen(!open)}
        title={hasActiveRules ? `Folder limiter: ${rules.length} folder(s) allowed` : "Folder permissions"}
      >
        {hasActiveRules ? <Shield className="w-4.5 h-4.5" /> : <FolderLock className="w-4.5 h-4.5" />}
      </button>

      {open && (
        <div
          className="absolute bottom-full right-0 mb-2 w-80 max-h-[400px] bg-theme-card rounded-xl border border-theme shadow-2xl backdrop-blur-xl z-[10005] overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-150"
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-theme flex items-center gap-2">
            <FolderLock className="w-4 h-4 text-primary" />
            <span className="text-[13px] font-bold text-theme-fg">Folder Permissions</span>
            <span className="text-[10px] text-theme-muted ml-auto">This tab only</span>
          </div>

          <div className="p-3">
              {/* Add folder row */}
              <div className="flex items-center gap-2 mb-3">
                <div className="flex items-center gap-0.5 bg-theme-hover rounded-md border border-theme/50 p-0.5 flex-1">
                  {(["both", "read", "write"] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => setSelectedPerm(p)}
                      className={clsx(
                        "flex-1 text-[10px] font-bold py-1 px-1.5 rounded transition-all text-center",
                        selectedPerm === p
                          ? "bg-primary text-primary-fg shadow-sm"
                          : "text-theme-muted hover:text-theme-fg"
                      )}
                    >
                      {p === "both" ? "Full" : p === "read" ? "Read" : "Write"}
                    </button>
                  ))}
                </div>
                <button
                  onClick={handleAdd}
                  disabled={adding}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-fg text-[11px] font-bold hover:opacity-90 transition-all active:scale-95 disabled:opacity-50 flex-shrink-0"
                >
                  {adding ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                  Add
                </button>
              </div>

              {/* Rules list */}
              {loading ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="w-5 h-5 animate-spin text-theme-muted" />
                </div>
              ) : rules.length === 0 ? (
                <div className="text-center py-6">
                  <FolderLock className="w-8 h-8 text-theme-muted/20 mx-auto mb-2" />
                  <div className="text-[11px] text-theme-muted font-medium">No folder rules yet</div>
                  <div className="text-[10px] text-theme-muted/60 mt-0.5">All folders accessible. Add folders to restrict.</div>
                </div>
              ) : (
                <div className="space-y-1.5 max-h-[220px] overflow-y-auto scrollbar-hidden">
                  {rules.map((rule) => (
                    <div
                      key={rule.id}
                      className="flex items-center gap-2 p-2 bg-theme-hover/50 rounded-lg border border-theme/30 group hover:bg-theme-hover transition-colors"
                    >
                      <FolderOpen className={clsx("w-3.5 h-3.5 flex-shrink-0",
                        rule.permission === "both" ? "text-emerald-500" :
                        rule.permission === "read" ? "text-blue-500" : "text-amber-500"
                      )} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-bold text-theme-fg truncate" title={rule.path}>
                          {rule.path.split(/[/\\]/).pop() || rule.path}
                        </div>
                        <div className="text-[9px] text-theme-muted truncate" title={rule.path}>
                          {rule.path}
                        </div>
                      </div>
                      <select
                        value={rule.permission}
                        onChange={(e) => handlePermChange(rule, e.target.value)}
                        className="text-[10px] font-bold bg-theme-card border border-theme/50 rounded px-1 py-0.5 text-theme-fg focus:outline-none cursor-pointer flex-shrink-0"
                      >
                        <option value="both">Full</option>
                        <option value="read">Read</option>
                        <option value="write">Write</option>
                      </select>
                      <button
                        onClick={() => handleRemove(rule.id)}
                        className="p-1 rounded text-theme-muted hover:text-red-500 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Info */}
              {rules.length > 0 && (
                <div className="mt-2 flex items-start gap-1.5 text-[10px] text-theme-muted/70">
                  <AlertTriangle className="w-3 h-3 text-amber-500/70 mt-px flex-shrink-0" />
                  <span>Only listed folders (and subfolders) are accessible to the agent in this tab.</span>
                </div>
              )}
          </div>
        </div>
      )}
    </div>
  );
};
