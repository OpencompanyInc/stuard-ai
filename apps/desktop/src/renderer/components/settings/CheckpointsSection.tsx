import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  History, RotateCcw, Redo2, Undo2, FileText, ChevronRight,
  AlertTriangle, Check, RefreshCw, Bot, MessageSquare, Workflow,
  FilePlus2, FilePen, FileX2,
} from 'lucide-react';
import clsx from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';

interface CheckpointActor {
  type?: 'chat' | 'workflow' | 'bot';
  id?: string;
  label?: string;
}

interface Checkpoint {
  id: string;
  name: string;
  timestamp: number;
  files: Record<string, { action: string; path: string; backup?: string; backup_type?: string }>;
  canRedo?: boolean;
  actor?: CheckpointActor;
}

interface CheckpointGroup {
  key: string;
  label: string;
  sublabel: string;
  icon: typeof MessageSquare;
  latest: number;
  items: Checkpoint[];
}

function shortId(id?: string): string {
  if (!id) return '';
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

function isChatKey(key: string): boolean {
  return key === 'chat' || key.startsWith('chat:');
}

function groupKey(cp: Checkpoint): string {
  const a = cp.actor;
  if (!a || !a.type || a.type === 'chat') {
    // Keep distinct conversations apart so each shows its own chat title.
    return a?.id ? `chat:${a.id}` : 'chat';
  }
  return `${a.type}:${a.id || ''}`;
}

function groupMeta(cp: Checkpoint): { label: string; sublabel: string; icon: typeof MessageSquare } {
  const a = cp.actor;
  const type = a?.type || 'chat';
  if (type === 'workflow') {
    const name = (a?.label || '').replace(/^Workflow:\s*/i, '').trim();
    return { label: name || `Workflow ${shortId(a?.id)}`.trim(), sublabel: 'Workflow', icon: Workflow };
  }
  if (type === 'bot') {
    const name = (a?.label || '').replace(/^(Agent|Bot):\s*/i, '').trim();
    return { label: name || `Agent ${shortId(a?.id)}`.trim(), sublabel: 'Agent', icon: Bot };
  }
  const chatName = (a?.label || '').trim();
  return { label: chatName || 'Main chat', sublabel: 'Chat with Stuard', icon: MessageSquare };
}

const baseName = (p: string) => p.split(/[/\\]/).filter(Boolean).pop() || p;

/** A human, glanceable title for a checkpoint, derived from the files it touched
 *  — so a row reads "Edited oauth_db.py" instead of a meaningless "Auto-checkpoint". */
function describeCheckpoint(files: Record<string, { action: string }>): string {
  const entries = Object.entries(files || {});
  if (entries.length === 0) return 'No file changes';

  const verb = (action: string) =>
    action === 'create' ? 'Created' : action === 'delete' ? 'Deleted' : action === 'modify' ? 'Edited' : 'Updated';

  if (entries.length === 1) {
    const [path, info] = entries[0];
    return `${verb(info.action)} ${baseName(path)}`;
  }

  const actions = new Set(entries.map(([, info]) => info.action));
  const verbWord = actions.size === 1 ? verb([...actions][0]) : 'Updated';

  // Common parent folder, if there is a meaningful one.
  const dirs = entries.map(([p]) => p.split(/[/\\]/).slice(0, -1));
  let common = dirs[0] || [];
  for (const d of dirs.slice(1)) {
    let i = 0;
    while (i < common.length && i < d.length && common[i] === d[i]) i++;
    common = common.slice(0, i);
  }
  const folder = common.filter(Boolean).pop();
  return folder
    ? `${verbWord} ${entries.length} files in ${folder}`
    : `${verbWord} ${entries.length} files`;
}

function formatTime(ts: number): string {
  const date = new Date(ts * 1000);
  const diffMins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ${diffMins % 60}m ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const ActionIcon = ({ action }: { action: string }) => {
  if (action === 'create') return <FilePlus2 className="h-3 w-3 shrink-0 text-emerald-500" />;
  if (action === 'delete') return <FileX2 className="h-3 w-3 shrink-0 text-red-500" />;
  if (action === 'modify') return <FilePen className="h-3 w-3 shrink-0 text-amber-500" />;
  return <FileText className="h-3 w-3 shrink-0 text-theme-muted/50" />;
};

export const CheckpointsSection: React.FC = () => {
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [reverting, setReverting] = useState<string | null>(null);
  const [redoing, setRedoing] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const fetchCheckpoints = useCallback(async () => {
    try {
      setLoading(true);
      const result = await (window as any).desktopAPI?.execLocalTool?.('checkpoint_list', {});
      if (result?.ok && Array.isArray(result.checkpoints)) {
        setCheckpoints(
          result.checkpoints.filter(
            (cp: Checkpoint) => cp.name !== 'redo' && Object.keys(cp.files || {}).length > 0
          )
        );
      }
    } catch (err) {
      console.error('Failed to fetch checkpoints:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCheckpoints(); }, [fetchCheckpoints]);

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
        showFeedback(`Reverted ${count} file${count !== 1 ? 's' : ''}`, 'success');
        await fetchCheckpoints();
      } else {
        showFeedback(result?.error || 'Failed to revert', 'error');
      }
    } catch {
      showFeedback('Failed to revert checkpoint', 'error');
    } finally {
      setReverting(null);
      setShowConfirm(null);
    }
  }, [fetchCheckpoints, showFeedback]);

  const handleRedo = useCallback(async (id: string) => {
    try {
      setRedoing(id);
      const result = await (window as any).desktopAPI?.execLocalTool?.('checkpoint_redo', { id });
      if (result?.ok) {
        const count = result.restored || 0;
        showFeedback(`Re-applied ${count} file${count !== 1 ? 's' : ''}`, 'success');
        await fetchCheckpoints();
      } else {
        showFeedback(result?.error || 'Failed to redo', 'error');
      }
    } catch {
      showFeedback('Failed to redo changes', 'error');
    } finally {
      setRedoing(null);
    }
  }, [fetchCheckpoints, showFeedback]);

  const groups = useMemo<CheckpointGroup[]>(() => {
    const byKey = new Map<string, CheckpointGroup>();
    for (const cp of checkpoints) {
      const key = groupKey(cp);
      const existing = byKey.get(key);
      if (existing) {
        existing.items.push(cp);
        existing.latest = Math.max(existing.latest, cp.timestamp);
      } else {
        const meta = groupMeta(cp);
        byKey.set(key, { key, label: meta.label, sublabel: meta.sublabel, icon: meta.icon, latest: cp.timestamp, items: [cp] });
      }
    }
    const list = Array.from(byKey.values());
    for (const g of list) g.items.sort((a, b) => b.timestamp - a.timestamp);
    // Chats first (most recent first), then workflows/agents by recency.
    return list.sort((a, b) => {
      const aChat = isChatKey(a.key);
      const bChat = isChatKey(b.key);
      if (aChat !== bChat) return aChat ? -1 : 1;
      return b.latest - a.latest;
    });
  }, [checkpoints]);

  const hasCheckpoints = checkpoints.length > 0;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[28px] border border-theme bg-theme-card/50 p-5 md:p-6">
      {/* Header — Studio sub-hero language: quiet eyebrow + headline + lead */}
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-theme-muted/70">File history</p>
          <h3 className="mt-1.5 flex items-center gap-2 text-[19px] font-semibold tracking-tight text-theme-fg">
            <span className="flex h-7 w-7 items-center justify-center rounded-[10px] bg-primary/10 text-primary">
              <History className="h-4 w-4" />
            </span>
            Checkpoints
          </h3>
          <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-theme-muted">
            Undo or redo file changes made by Stuard, your workflows, and your agents.
          </p>
        </div>
        <button
          onClick={fetchCheckpoints}
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-theme bg-theme-hover/50 px-3 py-1.5 text-[11px] font-semibold text-theme-muted transition-colors hover:bg-theme-hover hover:text-theme-fg"
          title="Refresh"
        >
          <RefreshCw className={clsx('h-3.5 w-3.5', loading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      <AnimatePresence>
        {feedback && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className={clsx(
              'mb-3 flex items-center gap-2 rounded-xl p-2.5',
              feedback.type === 'success' ? 'bg-emerald-500/10' : 'bg-red-500/10'
            )}>
              {feedback.type === 'success'
                ? <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                : <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-500" />}
              <span className={clsx(
                'text-[12px] font-medium',
                feedback.type === 'success' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
              )}>
                {feedback.message}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1 scrollbar-minimal">
        {loading && checkpoints.length === 0 ? (
          <div className="py-16 text-center text-theme-muted">
            <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-theme-muted/40 border-t-primary" />
            <span className="text-[13px]">Loading checkpoints…</span>
          </div>
        ) : !hasCheckpoints ? (
          <div className="py-16 text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-theme-hover/60">
              <History className="h-7 w-7 text-theme-muted/40" />
            </div>
            <p className="text-[14px] font-semibold text-theme-fg">No checkpoints yet</p>
            <p className="mx-auto mt-1 max-w-[300px] text-[12px] leading-relaxed text-theme-muted/70">
              Checkpoints are created automatically whenever Stuard, a workflow, or an agent changes files on disk.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {groups.map((group) => {
              const GroupIcon = group.icon;
              return (
                <div key={group.key}>
                  {/* Source lockup — the chat / workflow / agent that made these changes */}
                  <div className="mb-2.5 flex items-center gap-2.5 px-0.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[11px] bg-theme-hover/70 text-theme-muted">
                      <GroupIcon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[13px] font-semibold tracking-tight text-theme-fg">{group.label}</span>
                        <span className="rounded-full bg-theme-hover/70 px-1.5 text-[10px] font-bold tabular-nums text-theme-muted">
                          {group.items.length}
                        </span>
                      </div>
                      <div className="truncate text-[11px] text-theme-muted/70">{group.sublabel}</div>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    {group.items.map((cp) => {
                      const files = Object.entries(cp.files || {}).map(([path, info]) => ({
                        path, name: baseName(path), action: info.action || 'modify',
                      }));
                      const title = describeCheckpoint(cp.files || {});
                      const isExpanded = expanded === cp.id;
                      const isConfirming = showConfirm === cp.id;

                      return (
                        <div
                          key={cp.id}
                          className={clsx(
                            'group rounded-[16px] border transition-all',
                            isConfirming
                              ? 'border-destructive/30 bg-destructive/5'
                              : 'border-theme bg-theme-card/40 hover:-translate-y-px hover:border-primary/30 hover:bg-theme-card/70'
                          )}
                        >
                          {isConfirming ? (
                            <div className="space-y-2.5 p-3.5">
                              <div className="flex items-start gap-2">
                                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                                <div>
                                  <p className="text-[12px] font-semibold text-destructive">
                                    Revert {files.length} file{files.length !== 1 ? 's' : ''}?
                                  </p>
                                  <p className="mt-0.5 text-[10.5px] leading-relaxed text-destructive/70">
                                    Files will be restored to their state before this checkpoint. You can redo this later.
                                  </p>
                                </div>
                              </div>
                              <div className="flex justify-end gap-2">
                                <button
                                  onClick={() => setShowConfirm(null)}
                                  className="rounded-lg px-3 py-1.5 text-[11px] font-medium text-theme-muted transition-colors hover:bg-theme-hover hover:text-theme-fg"
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={() => handleRevert(cp.id)}
                                  disabled={!!reverting}
                                  className="flex items-center gap-1.5 rounded-lg bg-destructive px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-destructive/90 disabled:opacity-50"
                                >
                                  {reverting === cp.id ? (
                                    <><div className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />Reverting…</>
                                  ) : (
                                    <><Undo2 className="h-3 w-3" />Revert</>
                                  )}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="p-3.5">
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <span className="block truncate text-[13px] font-semibold tracking-tight text-theme-fg">
                                    {title}
                                  </span>
                                  <div className="mt-1 flex items-center gap-1.5 text-[11px] text-theme-muted">
                                    <span className="tabular-nums">{formatTime(cp.timestamp)}</span>
                                    <span className="opacity-30">·</span>
                                    <button
                                      onClick={() => setExpanded(isExpanded ? null : cp.id)}
                                      className="flex items-center gap-0.5 transition-colors hover:text-theme-fg"
                                    >
                                      <FileText className="h-3 w-3" />
                                      <span>{files.length} file{files.length !== 1 ? 's' : ''}</span>
                                      <ChevronRight className={clsx('h-3 w-3 transition-transform', isExpanded && 'rotate-90')} />
                                    </button>
                                  </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
                                  {cp.canRedo ? (
                                    <button
                                      onClick={() => handleRedo(cp.id)}
                                      disabled={!!redoing}
                                      className="flex items-center gap-1 rounded-lg bg-blue-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-blue-600 transition-all hover:bg-blue-500/20 disabled:opacity-50 dark:text-blue-400"
                                    >
                                      {redoing === cp.id
                                        ? <div className="h-3 w-3 animate-spin rounded-full border-2 border-blue-400/40 border-t-blue-400" />
                                        : <Redo2 className="h-3 w-3" />}
                                      <span>Redo</span>
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() => setShowConfirm(cp.id)}
                                      className="flex items-center gap-1 rounded-lg bg-theme-hover/60 px-2.5 py-1.5 text-[11px] font-semibold text-theme-muted transition-all hover:bg-theme-hover hover:text-theme-fg"
                                    >
                                      <RotateCcw className="h-3 w-3" />
                                      <span>Revert</span>
                                    </button>
                                  )}
                                </div>
                              </div>

                              <AnimatePresence>
                                {isExpanded && (
                                  <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    exit={{ opacity: 0, height: 0 }}
                                    transition={{ duration: 0.15 }}
                                    className="overflow-hidden"
                                  >
                                    <div className="mt-2.5 max-h-[180px] space-y-0.5 overflow-y-auto border-t border-theme-sidebar pt-2 scrollbar-minimal">
                                      {files.map((f) => (
                                        <div
                                          key={f.path}
                                          className="flex items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-theme-hover/50"
                                          title={f.path}
                                        >
                                          <ActionIcon action={f.action} />
                                          <span className="flex-1 truncate text-[11px] text-theme-muted">{f.name}</span>
                                          <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-theme-muted/50">
                                            {f.action}
                                          </span>
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
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default CheckpointsSection;
