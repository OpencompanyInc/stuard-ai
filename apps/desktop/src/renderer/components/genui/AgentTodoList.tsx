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

/** The live, plain-language "what's happening now" headline. */
export interface AgentTodoStatus {
  label: string;
  detail?: string | null;
  state: 'working' | 'done' | 'blocked' | 'idle';
}

export interface AgentTodoListProps {
  items: AgentTodoItem[];
  title?: string;
  /** Live status headline shown as a banner above the steps. */
  status?: AgentTodoStatus | null;
  /** Whether the agent is actively working right now (calms the spinner when false). */
  active?: boolean;
  progress?: {
    total: number;
    completed: number;
    failed: number;
    inProgress: number;
    pending: number;
    blocked: number;
    percentage: number;
  };
  /** Tighter spacing + hides descriptions/tags. Used for inline chat embeds. */
  compact?: boolean;
  /** `sidebar` fills the panel with a sticky header; `inline` is a chat card. */
  variant?: 'inline' | 'sidebar';
}

// NOTE: `theme-*` / `primary` exist only as plain CSS utility classes — Tailwind
// does NOT register them as colors, so opacity modifiers (e.g. `bg-theme-hover/50`,
// `bg-primary/10`, `text-primary`) silently generate nothing. Tints therefore use
// arbitrary `color-mix(...)` values, which Tailwind DOES emit.
const SURFACE_NEUTRAL =
  'bg-[color:color-mix(in_srgb,var(--foreground)_5%,transparent)] hover:bg-[color:color-mix(in_srgb,var(--foreground)_9%,transparent)]';
const SURFACE_ACTIVE = 'bg-[color:color-mix(in_srgb,var(--primary)_9%,transparent)]';
const SURFACE_TAG = 'bg-[color:color-mix(in_srgb,var(--foreground)_8%,transparent)]';
const SURFACE_PRIMARY_SOFT = 'bg-[color:color-mix(in_srgb,var(--primary)_12%,transparent)]';
const TRACK = 'bg-[color:color-mix(in_srgb,var(--foreground)_12%,transparent)]';
const PRIMARY_BG = 'bg-[color:var(--primary)]';
const PRIMARY_FG = 'text-[color:var(--primary)]';

interface StatusConfig {
  icon: React.ComponentType<any>;
  /** Class for the status glyph + label color. */
  color: string;
  label: string;
  spin?: boolean;
}

// Neutral by default — only the active (in-progress) row leans on the brand
// red, and only via a soft tint + rail (per the calm-neutral-list guidance).
const statusConfig: Record<AgentTodoItem['status'], StatusConfig> = {
  pending: { icon: Circle, color: 'text-theme-muted', label: 'Pending' },
  in_progress: { icon: Loader2, color: PRIMARY_FG, label: 'Active', spin: true },
  completed: { icon: Check, color: 'text-emerald-500', label: 'Done' },
  failed: { icon: AlertCircle, color: 'text-red-500', label: 'Failed' },
  blocked: { icon: Ban, color: 'text-amber-500', label: 'Blocked' },
};

const STATUS_ORDER: Record<AgentTodoItem['status'], number> = {
  in_progress: 0,
  pending: 1,
  blocked: 2,
  completed: 3,
  failed: 4,
};

const TodoRow: React.FC<{ item: AgentTodoItem; idx: number; compact: boolean; active: boolean }> = ({
  item,
  idx,
  compact,
  active,
}) => {
  const config = statusConfig[item.status] ?? statusConfig.pending;
  const Icon = config.icon;
  const isCompleted = item.status === 'completed';
  const isFailed = item.status === 'failed';
  const isInProgress = item.status === 'in_progress';
  // Only the genuinely-active step spins — a paused step shouldn't look "stuck".
  const spin = !!config.spin && active;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.18, delay: Math.min(idx * 0.025, 0.2) }}
      className={clsx(
        'relative flex items-start gap-2.5 rounded-[14px] px-3 transition-colors',
        compact ? 'py-2' : 'py-2.5',
        isInProgress ? SURFACE_ACTIVE : SURFACE_NEUTRAL,
        isCompleted && 'opacity-60',
      )}
    >
      {/* Active rail — the single, subtle red accent */}
      {isInProgress && (
        <span className={clsx('absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full', PRIMARY_BG)} />
      )}

      <span className={clsx('mt-px shrink-0', config.color)}>
        <Icon className={clsx('h-[15px] w-[15px]', spin && 'animate-spin')} strokeWidth={2} />
      </span>

      <div className="min-w-0 flex-1">
        <div
          className={clsx(
            'text-[12.5px] font-medium leading-snug break-words',
            isCompleted && 'line-through text-theme-muted',
            isFailed && 'text-red-500',
            !isCompleted && !isFailed && 'text-theme-fg',
          )}
        >
          {item.title}
        </div>

        {item.description && !compact && (
          <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-theme-muted">
            {item.description}
          </div>
        )}

        {item.errorMessage && (
          <div className="mt-1 flex items-center gap-1 text-[11px] text-red-400">
            <AlertCircle className="h-3 w-3 shrink-0" />
            <span className="break-words">{item.errorMessage}</span>
          </div>
        )}

        {item.tags && item.tags.length > 0 && !compact && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {item.tags.map((tag, i) => (
              <span
                key={i}
                className={clsx(
                  'rounded-md px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-theme-muted',
                  SURFACE_TAG,
                )}
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Minimal status hint — a label only for non-neutral states keeps rows calm */}
      {!isCompleted && (isInProgress || isFailed || item.status === 'blocked') && (
        <span className={clsx('mt-0.5 shrink-0 text-[9.5px] font-bold uppercase tracking-wide', config.color)}>
          {config.label}
        </span>
      )}
    </motion.div>
  );
};

export const AgentTodoList: React.FC<AgentTodoListProps> = ({
  items,
  title = 'Agent Plan',
  status = null,
  active = true,
  progress,
  compact = false,
  variant = 'inline',
}) => {
  const hasItems = !!items && items.length > 0;

  const sortedItems = hasItems
    ? [...items].sort((a, b) => (STATUS_ORDER[a.status] ?? 5) - (STATUS_ORDER[b.status] ?? 5))
    : [];

  const isSidebar = variant === 'sidebar';
  const pct = progress?.percentage ?? 0;

  // The live "what's happening now" line: an explicit status wins, otherwise we
  // fall back to the step the agent is currently on so the user always sees it.
  const currentItem = sortedItems.find((i) => i.status === 'in_progress') ?? null;
  const liveStatus: AgentTodoStatus | null =
    status && status.label
      ? status
      : currentItem
        ? { label: currentItem.title, detail: currentItem.description ?? null, state: 'working' }
        : null;

  // Nothing to show at all.
  if (!hasItems && !liveStatus) return null;

  const isWorking = liveStatus?.state === 'working';
  const isDone = liveStatus?.state === 'done';
  const isBlocked = liveStatus?.state === 'blocked';
  const StatusIcon = isDone ? Check : isBlocked ? Ban : isWorking ? Loader2 : Circle;
  const statusIconColor = isDone
    ? 'text-emerald-500'
    : isBlocked
      ? 'text-amber-500'
      : isWorking
        ? PRIMARY_FG
        : 'text-theme-muted';
  const statusSpin = isWorking && active;

  // Mirror the checklist row styling — same typography and calm neutral surface.
  const statusBanner = liveStatus && (
    <div
      className={clsx(
        'relative mt-2 flex items-start gap-2.5 rounded-[14px] px-3 py-2.5 transition-colors',
        isWorking && active ? SURFACE_ACTIVE : SURFACE_NEUTRAL,
        isDone && 'opacity-70',
      )}
    >
      {isWorking && active && (
        <span className={clsx('absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full', PRIMARY_BG)} />
      )}
      <span className={clsx('mt-px shrink-0', statusIconColor)}>
        <StatusIcon
          className={clsx('h-[15px] w-[15px]', statusSpin && 'animate-spin')}
          strokeWidth={2}
        />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-medium leading-snug break-words text-theme-fg">
          {liveStatus.label}
        </div>
        {liveStatus.detail && (
          <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-theme-muted">
            {liveStatus.detail}
          </div>
        )}
      </div>
    </div>
  );

  const header = (
    <div className={clsx(isSidebar ? 'px-3 pt-3 pb-2.5' : 'mb-2.5')}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className={clsx('flex h-6 w-6 shrink-0 items-center justify-center rounded-lg', SURFACE_PRIMARY_SOFT)}>
            <ListTodo className={clsx('h-3.5 w-3.5', PRIMARY_FG)} />
          </span>
          <h4 className="truncate text-[13px] font-bold text-theme-fg">{title}</h4>
        </div>

        {progress && progress.total > 0 && (
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-[11px] font-bold tabular-nums text-theme-muted">
              {progress.completed}/{progress.total}
            </span>
            <div className={clsx('h-1.5 w-16 overflow-hidden rounded-full', TRACK)}>
              <motion.div
                className={clsx('h-full rounded-full', PRIMARY_BG)}
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.45, ease: 'easeOut' }}
              />
            </div>
          </div>
        )}
      </div>

      {statusBanner}
    </div>
  );

  const list = hasItems && (
    <div className={clsx('flex flex-col gap-1.5', isSidebar && 'px-2.5 pb-3')}>
      <AnimatePresence mode="popLayout" initial={false}>
        {sortedItems.map((item, idx) => (
          <TodoRow key={item.id} item={item} idx={idx} compact={compact} active={active} />
        ))}
      </AnimatePresence>
    </div>
  );

  if (isSidebar) {
    // Sticky header + scrollable body that fills the panel height.
    return (
      <div className="flex h-full w-full flex-col overflow-hidden">
        <div className="shrink-0 border-b border-[color:color-mix(in_srgb,var(--foreground)_9%,transparent)]">
          {header}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar pt-2.5">{list}</div>
      </div>
    );
  }

  // Inline chat card.
  return (
    <div className="my-3 w-full rounded-2xl border border-[color:color-mix(in_srgb,var(--foreground)_12%,transparent)] bg-[color:color-mix(in_srgb,var(--foreground)_4%,transparent)] p-2.5">
      {header}
      <div className={clsx(compact && 'max-h-[220px] overflow-y-auto custom-scrollbar')}>{list}</div>
    </div>
  );
};
