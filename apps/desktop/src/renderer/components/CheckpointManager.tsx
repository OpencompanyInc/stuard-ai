import React, { useState, useCallback } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { RotateCcw, History, ChevronUp, ChevronDown, AlertTriangle, Check, Clock } from 'lucide-react';
import clsx from 'clsx';

interface Checkpoint {
  id: string;
  name: string;
  timestamp: number;
  files: Record<string, any>;
}

interface CheckpointManagerProps {
  onRevert?: () => void;
  className?: string;
}

export const CheckpointManager: React.FC<CheckpointManagerProps> = ({ onRevert, className }) => {
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [showConfirm, setShowConfirm] = useState<string | null>(null);
  const [lastRevert, setLastRevert] = useState<{ count: number; timestamp: number } | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const fetchCheckpoints = useCallback(async () => {
    try {
      setLoading(true);
      const result = await (window as any).desktopAPI?.execLocalTool?.('checkpoint_list', {});
      if (result?.ok && result.checkpoints) {
        setCheckpoints(result.checkpoints);
      }
    } catch (err) {
      console.error('Failed to fetch checkpoints:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRevert = useCallback(async (id: string) => {
    try {
      setReverting(true);
      const result = await (window as any).desktopAPI?.execLocalTool?.('checkpoint_restore', { id });
      if (result?.ok) {
        setLastRevert({ count: result.restored || 0, timestamp: Date.now() });
        onRevert?.();
        await fetchCheckpoints();
      }
    } catch (err) {
      console.error('Failed to revert:', err);
    } finally {
      setReverting(false);
      setShowConfirm(null);
    }
  }, [fetchCheckpoints, onRevert]);

  const formatTime = (ts: number) => {
    const date = new Date(ts * 1000);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return date.toLocaleDateString();
  };

  const getFileCount = (cp: Checkpoint) => Object.keys(cp.files || {}).length;

  const hasCheckpoints = checkpoints.length > 0;

  return (
    <Popover.Root
      open={isOpen}
      onOpenChange={(open) => {
        setIsOpen(open);
        if (open) fetchCheckpoints();
      }}
    >
      <Popover.Trigger asChild>
        <button
          className={clsx(
            "flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-medium transition-all",
            hasCheckpoints
              ? "bg-primary/10 hover:bg-primary/15 text-primary border border-primary/15"
              : "bg-theme-hover/60 hover:bg-theme-hover text-theme-muted border border-theme/10",
            className
          )}
          title="File Checkpoints"
        >
          <History className="w-3 h-3" />
          <span className="hidden sm:inline">Checkpoints</span>
          {hasCheckpoints && (
            <span className="bg-primary/15 text-primary px-1 rounded text-[9px] font-bold tabular-nums">
              {checkpoints.length}
            </span>
          )}
          {isOpen ? (
            <ChevronUp className="w-3 h-3 opacity-40" />
          ) : (
            <ChevronDown className="w-3 h-3 opacity-40" />
          )}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          className="z-[10003] w-80 bg-theme-card rounded-2xl border border-theme shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
          sideOffset={8}
          align="end"
          side="top"
          collisionPadding={10}
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-theme/10">
            <h3 className="text-[13px] font-bold text-theme-fg">File Checkpoints</h3>
            <p className="text-[11px] text-theme-muted mt-0.5">
              Revert file changes made by the assistant
            </p>
          </div>

          {/* Success Message */}
          {lastRevert && Date.now() - lastRevert.timestamp < 5000 && (
            <div className="mx-3 mt-3 p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center gap-2">
              <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
              <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                Restored {lastRevert.count} file(s) successfully
              </span>
            </div>
          )}

          {/* Checkpoints List — invisible scrollbar */}
          <div className="max-h-[320px] overflow-y-auto scrollbar-invisible p-2">
            {loading ? (
              <div className="py-8 text-center text-theme-muted text-sm">
                <div className="w-4 h-4 border-2 border-theme-muted/40 border-t-primary rounded-full animate-spin mx-auto mb-2" />
                Loading...
              </div>
            ) : checkpoints.length === 0 ? (
              <div className="py-8 text-center">
                <History className="w-7 h-7 text-theme-muted/30 mx-auto mb-2" />
                <p className="text-theme-muted text-[13px] font-medium">No checkpoints yet</p>
                <p className="text-theme-muted/60 text-[11px] mt-1">
                  Created automatically when files are modified
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                {checkpoints.map((cp) => (
                  <div
                    key={cp.id}
                    className={clsx(
                      "p-3 rounded-xl border transition-all",
                      showConfirm === cp.id
                        ? "bg-destructive/5 border-destructive/20"
                        : "bg-theme-hover/30 border-theme/5 hover:border-theme/15 hover:bg-theme-hover/50"
                    )}
                  >
                    {showConfirm === cp.id ? (
                      <div className="space-y-2.5">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
                          <div>
                            <p className="text-[12px] font-semibold text-destructive">
                              Revert {getFileCount(cp)} file(s)?
                            </p>
                            <p className="text-[10px] text-destructive/70 mt-0.5">
                              This will undo all changes since this checkpoint
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => setShowConfirm(null)}
                            className="px-2.5 py-1 text-[11px] font-medium text-theme-muted hover:text-theme-fg hover:bg-theme-hover rounded-lg transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleRevert(cp.id)}
                            disabled={reverting}
                            className="px-2.5 py-1 text-[11px] font-medium bg-destructive hover:bg-destructive/90 text-white rounded-lg transition-colors disabled:opacity-50"
                          >
                            {reverting ? 'Reverting...' : 'Confirm'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <Clock className="w-3 h-3 text-theme-muted/60 shrink-0" />
                            <span className="text-[12px] font-semibold text-theme-fg truncate">
                              {cp.name === 'auto' ? 'Auto-checkpoint' : cp.name}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-1 ml-5 text-[10px] text-theme-muted">
                            <span>{formatTime(cp.timestamp)}</span>
                            <span className="opacity-40">·</span>
                            <span>{getFileCount(cp)} file(s)</span>
                          </div>
                        </div>
                        <button
                          onClick={() => setShowConfirm(cp.id)}
                          className="flex items-center gap-1 px-2 py-1.5 bg-theme-hover/50 hover:bg-theme-hover border border-theme/10 hover:border-theme/20 rounded-lg text-[11px] font-medium text-theme-muted hover:text-theme-fg transition-all"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Revert</span>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2 border-t border-theme/5 text-[10px] text-theme-muted/50">
            Checkpoints stored in ~/.stuard/checkpoints
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};

export default CheckpointManager;
