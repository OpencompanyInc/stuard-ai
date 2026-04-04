import React, { useState, useCallback, useMemo } from 'react';
import * as Popover from '@radix-ui/react-popover';
import {
  RotateCcw, History, ChevronUp, ChevronDown, AlertTriangle,
  Check, Clock, FileText, Redo2, Undo2, Trash2, ChevronRight, X,
} from 'lucide-react';
import clsx from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';

interface Checkpoint {
  id: string;
  name: string;
  timestamp: number;
  files: Record<string, { action: string; path: string; backup?: string; backup_type?: string }>;
  canRedo?: boolean;
}

interface CheckpointManagerProps {
  onRevert?: () => void;
  className?: string;
}

export const CheckpointManager: React.FC<CheckpointManagerProps> = ({ onRevert, className }) => {
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [reverting, setReverting] = useState<string | null>(null);
  const [redoing, setRedoing] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState<string | null>(null);
  const [expandedFiles, setExpandedFiles] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const fetchCheckpoints = useCallback(async () => {
    try {
      setLoading(true);
      const result = await (window as any).desktopAPI?.execLocalTool?.('checkpoint_list', {});
      if (result?.ok && result.checkpoints) {
        const filtered = result.checkpoints.filter(
          (cp: Checkpoint) => cp.name !== 'redo' && Object.keys(cp.files || {}).length > 0
        );
        setCheckpoints(filtered);
      }
    } catch (err) {
      console.error('Failed to fetch checkpoints:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const showFeedback = useCallback((message: string, type: 'success' | 'error') => {
    setFeedback({ message, type });
    setTimeout(() => setFeedback(null), 3500);
  }, []);

  const handleRevert = useCallback(async (id: string) => {
    try {
      setReverting(id);
      const result = await (window as any).desktopAPI?.execLocalTool?.('checkpoint_restore', { id });
      if (result?.ok) {
        const count = result.restored || 0;
        showFeedback(`Reverted ${count} file${count !== 1 ? 's' : ''} successfully`, 'success');
        onRevert?.();
        await fetchCheckpoints();
      } else {
        showFeedback(result?.error || 'Failed to revert', 'error');
      }
    } catch (err) {
      showFeedback('Failed to revert checkpoint', 'error');
    } finally {
      setReverting(null);
      setShowConfirm(null);
    }
  }, [fetchCheckpoints, onRevert, showFeedback]);

  const handleRedo = useCallback(async (id: string) => {
    try {
      setRedoing(id);
      const result = await (window as any).desktopAPI?.execLocalTool?.('checkpoint_redo', { id });
      if (result?.ok) {
        const count = result.restored || 0;
        showFeedback(`Re-applied ${count} file${count !== 1 ? 's' : ''}`, 'success');
        onRevert?.();
        await fetchCheckpoints();
      } else {
        showFeedback(result?.error || 'Failed to redo', 'error');
      }
    } catch (err) {
      showFeedback('Failed to redo changes', 'error');
    } finally {
      setRedoing(null);
    }
  }, [fetchCheckpoints, onRevert, showFeedback]);

  const formatTime = (ts: number) => {
    const date = new Date(ts * 1000);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ${diffMins % 60}m ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const getFileCount = (cp: Checkpoint) => Object.keys(cp.files || {}).length;

  const getFileList = (cp: Checkpoint): Array<{ name: string; path: string; action: string }> => {
    return Object.entries(cp.files || {}).map(([path, info]) => {
      const name = path.split(/[/\\]/).pop() || path;
      return { name, path, action: info.action || 'modify' };
    });
  };

  const getActionIcon = (action: string) => {
    switch (action) {
      case 'create': return <span className="text-emerald-500 text-[9px] font-bold">NEW</span>;
      case 'modify': return <span className="text-amber-500 text-[9px] font-bold">MOD</span>;
      case 'delete': return <span className="text-red-500 text-[9px] font-bold">DEL</span>;
      default: return <span className="text-gray-400 text-[9px] font-bold">???</span>;
    }
  };

  const checkpointGroups = useMemo(() => {
    const now = new Date();
    const groups: { label: string; items: Checkpoint[] }[] = [];
    const recent: Checkpoint[] = [];
    const older: Checkpoint[] = [];

    for (const cp of checkpoints) {
      const date = new Date(cp.timestamp * 1000);
      const diffMins = (now.getTime() - date.getTime()) / 60000;
      if (diffMins < 60) {
        recent.push(cp);
      } else {
        older.push(cp);
      }
    }

    if (recent.length > 0) groups.push({ label: 'Recent', items: recent });
    if (older.length > 0) groups.push({ label: 'Earlier', items: older });
    return groups;
  }, [checkpoints]);

  const hasCheckpoints = checkpoints.length > 0;

  return (
    <Popover.Root
      open={isOpen}
      onOpenChange={(open) => {
        setIsOpen(open);
        if (open) fetchCheckpoints();
        if (!open) {
          setShowConfirm(null);
          setExpandedFiles(null);
        }
      }}
    >
      <Popover.Trigger asChild>
        <button
          className={clsx(
            "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-200",
            hasCheckpoints
              ? "bg-primary/10 hover:bg-primary/15 text-primary border border-primary/15 shadow-sm shadow-primary/5"
              : "bg-theme-hover/60 hover:bg-theme-hover text-theme-muted border border-theme/10",
            className
          )}
          title="File Checkpoints - Undo/Redo file changes"
        >
          <History className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Checkpoints</span>
          {hasCheckpoints && (
            <span className="bg-primary/20 text-primary px-1.5 rounded-full text-[9px] font-bold tabular-nums min-w-[16px] text-center">
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
          className="z-[10003] w-[340px] bg-theme-card rounded-2xl border border-theme shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
          sideOffset={8}
          align="end"
          side="top"
          collisionPadding={10}
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-theme/10 flex items-center justify-between">
            <div>
              <h3 className="text-[13px] font-bold text-theme-fg flex items-center gap-1.5">
                <History className="w-3.5 h-3.5 text-primary" />
                File Checkpoints
              </h3>
              <p className="text-[10px] text-theme-muted mt-0.5">
                Undo & redo file changes made by the assistant
              </p>
            </div>
            <Popover.Close asChild>
              <button className="p-1 rounded-md hover:bg-theme-hover text-theme-muted hover:text-theme-fg transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </Popover.Close>
          </div>

          {/* Feedback toast */}
          <AnimatePresence>
            {feedback && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className={clsx(
                  "mx-3 mt-3 p-2.5 rounded-xl flex items-center gap-2 border",
                  feedback.type === 'success'
                    ? "bg-emerald-500/10 border-emerald-500/20"
                    : "bg-red-500/10 border-red-500/20"
                )}>
                  {feedback.type === 'success'
                    ? <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    : <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                  }
                  <span className={clsx(
                    "text-[11px] font-medium",
                    feedback.type === 'success'
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-red-600 dark:text-red-400"
                  )}>
                    {feedback.message}
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Checkpoints List */}
          <div className="max-h-[380px] overflow-y-auto scrollbar-invisible p-2">
            {loading ? (
              <div className="py-10 text-center text-theme-muted text-sm">
                <div className="w-5 h-5 border-2 border-theme-muted/40 border-t-primary rounded-full animate-spin mx-auto mb-2" />
                <span className="text-[11px]">Loading checkpoints...</span>
              </div>
            ) : checkpoints.length === 0 ? (
              <div className="py-10 text-center">
                <div className="w-12 h-12 rounded-2xl bg-theme-hover/50 flex items-center justify-center mx-auto mb-3">
                  <History className="w-6 h-6 text-theme-muted/40" />
                </div>
                <p className="text-theme-muted text-[13px] font-semibold">No checkpoints yet</p>
                <p className="text-theme-muted/60 text-[11px] mt-1 max-w-[200px] mx-auto leading-relaxed">
                  Checkpoints are created automatically when the assistant modifies files
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {checkpointGroups.map((group) => (
                  <div key={group.label}>
                    <div className="px-2 py-1">
                      <span className="text-[9px] font-bold uppercase tracking-widest text-theme-muted/50">
                        {group.label}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {group.items.map((cp) => {
                        const files = getFileList(cp);
                        const isExpanded = expandedFiles === cp.id;
                        const isConfirming = showConfirm === cp.id;
                        const isCurrentlyReverting = reverting === cp.id;
                        const isCurrentlyRedoing = redoing === cp.id;

                        return (
                          <div
                            key={cp.id}
                            className={clsx(
                              "rounded-xl border transition-all duration-200",
                              isConfirming
                                ? "bg-destructive/5 border-destructive/20 shadow-sm"
                                : "bg-theme-hover/20 border-theme/5 hover:border-theme/15 hover:bg-theme-hover/40"
                            )}
                          >
                            {isConfirming ? (
                              <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="p-3 space-y-2.5"
                              >
                                <div className="flex items-start gap-2">
                                  <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                                  <div>
                                    <p className="text-[12px] font-semibold text-destructive">
                                      Revert {getFileCount(cp)} file{getFileCount(cp) !== 1 ? 's' : ''}?
                                    </p>
                                    <p className="text-[10px] text-destructive/70 mt-0.5 leading-relaxed">
                                      Files will be restored to their state before this checkpoint. You can redo this later.
                                    </p>
                                  </div>
                                </div>
                                <div className="flex gap-2 justify-end">
                                  <button
                                    onClick={() => setShowConfirm(null)}
                                    className="px-3 py-1.5 text-[11px] font-medium text-theme-muted hover:text-theme-fg hover:bg-theme-hover rounded-lg transition-colors"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    onClick={() => handleRevert(cp.id)}
                                    disabled={!!reverting}
                                    className="px-3 py-1.5 text-[11px] font-semibold bg-destructive hover:bg-destructive/90 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1.5"
                                  >
                                    {isCurrentlyReverting ? (
                                      <>
                                        <div className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                                        Reverting...
                                      </>
                                    ) : (
                                      <>
                                        <Undo2 className="w-3 h-3" />
                                        Revert
                                      </>
                                    )}
                                  </button>
                                </div>
                              </motion.div>
                            ) : (
                              <div className="p-3">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                      <Clock className="w-3 h-3 text-theme-muted/50 shrink-0" />
                                      <span className="text-[12px] font-semibold text-theme-fg truncate">
                                        {cp.name === 'auto' ? 'Auto-checkpoint' : cp.name}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-1.5 mt-0.5 ml-5 text-[10px] text-theme-muted">
                                      <span>{formatTime(cp.timestamp)}</span>
                                      <span className="opacity-30">·</span>
                                      <button
                                        onClick={() => setExpandedFiles(isExpanded ? null : cp.id)}
                                        className="flex items-center gap-0.5 hover:text-theme-fg transition-colors"
                                      >
                                        <FileText className="w-3 h-3" />
                                        <span>{getFileCount(cp)} file{getFileCount(cp) !== 1 ? 's' : ''}</span>
                                        <ChevronRight className={clsx(
                                          "w-3 h-3 transition-transform duration-150",
                                          isExpanded && "rotate-90"
                                        )} />
                                      </button>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1 shrink-0">
                                    {cp.canRedo ? (
                                      <button
                                        onClick={() => handleRedo(cp.id)}
                                        disabled={!!redoing}
                                        className="flex items-center gap-1 px-2 py-1.5 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/15 rounded-lg text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-all disabled:opacity-50"
                                        title="Re-apply reverted changes"
                                      >
                                        {isCurrentlyRedoing ? (
                                          <div className="w-3 h-3 border-2 border-blue-400/40 border-t-blue-400 rounded-full animate-spin" />
                                        ) : (
                                          <Redo2 className="w-3 h-3" />
                                        )}
                                        <span>Redo</span>
                                      </button>
                                    ) : (
                                      <button
                                        onClick={() => setShowConfirm(cp.id)}
                                        className="flex items-center gap-1 px-2 py-1.5 bg-theme-hover/50 hover:bg-theme-hover border border-theme/10 hover:border-theme/20 rounded-lg text-[11px] font-semibold text-theme-muted hover:text-theme-fg transition-all"
                                        title="Revert to this checkpoint"
                                      >
                                        <RotateCcw className="w-3 h-3" />
                                        <span>Revert</span>
                                      </button>
                                    )}
                                  </div>
                                </div>

                                {/* Expandable file list */}
                                <AnimatePresence>
                                  {isExpanded && (
                                    <motion.div
                                      initial={{ opacity: 0, height: 0 }}
                                      animate={{ opacity: 1, height: 'auto' }}
                                      exit={{ opacity: 0, height: 0 }}
                                      transition={{ duration: 0.15 }}
                                      className="overflow-hidden"
                                    >
                                      <div className="mt-2 ml-5 space-y-0.5 max-h-[150px] overflow-y-auto scrollbar-invisible">
                                        {files.map((f) => (
                                          <div
                                            key={f.path}
                                            className="flex items-center gap-2 py-1 px-2 rounded-md hover:bg-theme-hover/50 transition-colors group/file"
                                          >
                                            {getActionIcon(f.action)}
                                            <FileText className="w-3 h-3 text-theme-muted/40 shrink-0" />
                                            <span
                                              className="text-[10px] text-theme-muted truncate flex-1"
                                              title={f.path}
                                            >
                                              {f.name}
                                            </span>
                                            <button
                                              onClick={() => {
                                                navigator.clipboard.writeText(f.path);
                                              }}
                                              className="opacity-0 group-hover/file:opacity-100 p-0.5 rounded text-theme-muted/40 hover:text-theme-fg transition-all"
                                              title="Copy path"
                                            >
                                              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <rect x="9" y="9" width="13" height="13" rx="2" />
                                                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                                              </svg>
                                            </button>
                                          </div>
                                        ))}
                                      </div>
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2 border-t border-theme/5 flex items-center justify-between">
            <span className="text-[10px] text-theme-muted/40">
              {hasCheckpoints
                ? `${checkpoints.length} checkpoint${checkpoints.length !== 1 ? 's' : ''}`
                : 'Auto-created on file changes'}
            </span>
            {hasCheckpoints && (
              <button
                onClick={fetchCheckpoints}
                className="text-[10px] text-theme-muted/40 hover:text-theme-muted transition-colors"
                title="Refresh"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};

export default CheckpointManager;
