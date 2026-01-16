import React, { useState, useEffect, useCallback } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { RotateCcw, History, ChevronDown, AlertTriangle, Check, Clock } from 'lucide-react';
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
        // Refresh the list
        await fetchCheckpoints();
      }
    } catch (err) {
      console.error('Failed to revert:', err);
    } finally {
      setReverting(false);
      setShowConfirm(null);
    }
  }, [fetchCheckpoints, onRevert]);

  // Format timestamp
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

  // Count files in checkpoint
  const getFileCount = (cp: Checkpoint) => {
    return Object.keys(cp.files || {}).length;
  };

  const hasCheckpoints = checkpoints.length > 0;
  const latestCheckpoint = checkpoints[0];

  return (
    <Popover.Root onOpenChange={(open) => open && fetchCheckpoints()}>
      <Popover.Trigger asChild>
        <button
          className={clsx(
            "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all",
            hasCheckpoints 
              ? "bg-amber-100/80 hover:bg-amber-100 text-amber-700 border border-amber-200/50"
              : "bg-neutral-100 hover:bg-neutral-200 text-neutral-500 border border-neutral-200/50",
            className
          )}
          title="File Checkpoints"
        >
          <History className="w-3 h-3" />
          <span className="hidden sm:inline">Checkpoints</span>
          {hasCheckpoints && (
            <span className="bg-amber-200 text-amber-800 px-1 rounded text-[9px] font-bold">
              {checkpoints.length}
            </span>
          )}
          <ChevronDown className="w-3 h-3 opacity-50" />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          className="z-[10003] w-80 bg-white rounded-xl border border-black/10 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
          sideOffset={8}
          align="end"
          collisionPadding={10}
        >
          {/* Header */}
          <div className="px-4 py-3 bg-neutral-50 border-b border-black/5">
            <h3 className="text-sm font-semibold text-neutral-800">File Checkpoints</h3>
            <p className="text-[11px] text-neutral-500 mt-0.5">
              Revert file changes made by the assistant
            </p>
          </div>

          {/* Success Message */}
          {lastRevert && Date.now() - lastRevert.timestamp < 5000 && (
            <div className="mx-3 mt-3 p-2 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-600" />
              <span className="text-[11px] text-emerald-700 font-medium">
                Restored {lastRevert.count} file(s) successfully
              </span>
            </div>
          )}

          {/* Checkpoints List */}
          <div className="max-h-[300px] overflow-y-auto p-2">
            {loading ? (
              <div className="py-8 text-center text-neutral-400 text-sm">Loading...</div>
            ) : checkpoints.length === 0 ? (
              <div className="py-8 text-center">
                <History className="w-8 h-8 text-neutral-300 mx-auto mb-2" />
                <p className="text-neutral-400 text-sm">No checkpoints yet</p>
                <p className="text-neutral-400 text-[11px] mt-1">
                  Checkpoints are created automatically when files are modified
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                {checkpoints.map((cp) => (
                  <div
                    key={cp.id}
                    className={clsx(
                      "p-3 rounded-lg border transition-all",
                      showConfirm === cp.id 
                        ? "bg-rose-50 border-rose-200" 
                        : "bg-neutral-50 border-neutral-100 hover:border-neutral-200"
                    )}
                  >
                    {showConfirm === cp.id ? (
                      // Confirmation state
                      <div className="space-y-2">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="w-4 h-4 text-rose-500 flex-shrink-0 mt-0.5" />
                          <div>
                            <p className="text-[12px] font-medium text-rose-700">
                              Revert {getFileCount(cp)} file(s)?
                            </p>
                            <p className="text-[10px] text-rose-600 mt-0.5">
                              This will undo all changes since this checkpoint
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => setShowConfirm(null)}
                            className="px-2.5 py-1 text-[11px] font-medium text-neutral-600 hover:bg-white rounded-md transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleRevert(cp.id)}
                            disabled={reverting}
                            className="px-2.5 py-1 text-[11px] font-medium bg-rose-500 hover:bg-rose-600 text-white rounded-md transition-colors disabled:opacity-50"
                          >
                            {reverting ? 'Reverting...' : 'Confirm Revert'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      // Normal state
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <Clock className="w-3 h-3 text-neutral-400" />
                            <span className="text-[12px] font-medium text-neutral-700 truncate">
                              {cp.name === 'auto' ? 'Auto-checkpoint' : cp.name}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-[10px] text-neutral-500">
                            <span>{formatTime(cp.timestamp)}</span>
                            <span>•</span>
                            <span>{getFileCount(cp)} file(s)</span>
                          </div>
                        </div>
                        <button
                          onClick={() => setShowConfirm(cp.id)}
                          className="flex items-center gap-1 px-2.5 py-1.5 bg-white hover:bg-neutral-100 border border-neutral-200 rounded-lg text-[11px] font-medium text-neutral-600 hover:text-neutral-800 transition-colors"
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
          <div className="px-4 py-2 bg-neutral-50 border-t border-black/5 text-[10px] text-neutral-400">
            Checkpoints are stored in ~/.stuard/checkpoints
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};

export default CheckpointManager;
