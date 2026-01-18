import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';
import { Check, Circle, AlertCircle, Loader2, Ban, ListTodo } from 'lucide-react';

export interface AgentTodoItem {
  id: string;
  title: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'blocked';
  priority?: number;
  tags?: string[];
  errorMessage?: string;
}

export interface AgentTodoListProps {
  items: AgentTodoItem[];
  title?: string;
  progress?: {
    total: number;
    completed: number;
    failed: number;
    inProgress: number;
    pending: number;
    blocked: number;
    percentage: number;
  };
  compact?: boolean;
}

const statusConfig = {
  pending: {
    icon: Circle,
    color: 'text-theme-muted',
    bg: 'bg-theme-hover/50',
    label: 'Pending',
  },
  in_progress: {
    icon: Loader2,
    color: 'text-primary',
    bg: 'bg-primary/10',
    label: 'In Progress',
    animate: true,
  },
  completed: {
    icon: Check,
    color: 'text-emerald-500',
    bg: 'bg-emerald-500/10',
    label: 'Done',
  },
  failed: {
    icon: AlertCircle,
    color: 'text-red-500',
    bg: 'bg-red-500/10',
    label: 'Failed',
  },
  blocked: {
    icon: Ban,
    color: 'text-amber-500',
    bg: 'bg-amber-500/10',
    label: 'Blocked',
  },
};

export const AgentTodoList: React.FC<AgentTodoListProps> = ({
  items,
  title = 'Task Progress',
  progress,
  compact = false,
}) => {
  if (!items || items.length === 0) {
    return null;
  }

  const sortedItems = [...items].sort((a, b) => {
    const statusOrder = { in_progress: 0, pending: 1, blocked: 2, completed: 3, failed: 4 };
    return (statusOrder[a.status] || 5) - (statusOrder[b.status] || 5);
  });

  return (
    <div className="w-full my-3">
      {/* Header with progress */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-primary/10">
            <ListTodo className="w-4 h-4 text-primary" />
          </div>
          <h4 className="text-sm font-bold text-theme-fg">{title}</h4>
        </div>

        {progress && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-theme-muted">
              {progress.completed}/{progress.total}
            </span>
            <div className="w-20 h-1.5 bg-theme-hover rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-primary rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${progress.percentage}%` }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
              />
            </div>
            <span className="text-xs font-bold text-primary">
              {progress.percentage}%
            </span>
          </div>
        )}
      </div>

      {/* Todo items */}
      <div className={clsx(
        "space-y-1.5 rounded-xl border border-theme/20 bg-theme-card/50 p-2",
        compact && "max-h-[200px] overflow-y-auto custom-scrollbar"
      )}>
        <AnimatePresence mode="popLayout">
          {sortedItems.map((item, idx) => {
            const config = statusConfig[item.status] || statusConfig.pending;
            const Icon = config.icon;
            const isCompleted = item.status === 'completed';
            const isFailed = item.status === 'failed';
            const isInProgress = item.status === 'in_progress';

            return (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.2, delay: idx * 0.03 }}
                className={clsx(
                  "flex items-start gap-3 px-3 py-2 rounded-lg transition-all",
                  config.bg,
                  isCompleted && "opacity-60",
                  isInProgress && "ring-1 ring-primary/30"
                )}
              >
                {/* Status icon */}
                <div className={clsx(
                  "flex-shrink-0 mt-0.5",
                  config.color
                )}>
                  <Icon
                    className={clsx(
                      "w-4 h-4",
                      config.animate && "animate-spin"
                    )}
                  />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className={clsx(
                    "text-sm font-medium",
                    isCompleted && "line-through text-theme-muted",
                    isFailed && "text-red-500",
                    !isCompleted && !isFailed && "text-theme-fg"
                  )}>
                    {item.title}
                  </div>

                  {item.description && !compact && (
                    <div className="text-xs text-theme-muted mt-0.5 line-clamp-2">
                      {item.description}
                    </div>
                  )}

                  {item.errorMessage && (
                    <div className="text-xs text-red-400 mt-0.5 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {item.errorMessage}
                    </div>
                  )}

                  {item.tags && item.tags.length > 0 && !compact && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {item.tags.map((tag, i) => (
                        <span
                          key={i}
                          className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-theme-hover text-theme-muted uppercase tracking-wider"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Status badge */}
                <div className={clsx(
                  "flex-shrink-0 px-1.5 py-0.5 text-[10px] font-bold rounded uppercase tracking-wider",
                  config.bg,
                  config.color
                )}>
                  {config.label}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Summary footer */}
      {progress && !compact && (
        <div className="flex items-center justify-center gap-4 mt-2 text-[10px] font-bold uppercase tracking-wider text-theme-muted">
          {progress.completed > 0 && (
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              {progress.completed} done
            </span>
          )}
          {progress.inProgress > 0 && (
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              {progress.inProgress} active
            </span>
          )}
          {progress.pending > 0 && (
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-theme-muted/50" />
              {progress.pending} pending
            </span>
          )}
          {progress.failed > 0 && (
            <span className="flex items-center gap-1 text-red-400">
              <span className="w-2 h-2 rounded-full bg-red-500" />
              {progress.failed} failed
            </span>
          )}
        </div>
      )}
    </div>
  );
};
