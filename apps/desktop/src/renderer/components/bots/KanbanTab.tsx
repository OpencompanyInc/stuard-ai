import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import {
  LayoutGrid, Plus, MoreHorizontal, Trash2, Loader2, Check,
  Activity, CheckCircle2, CircleDashed, CircleDot, XCircle,
  Bot as BotIcon, User as UserIcon,
} from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────────────────────

export type KanbanStatus = 'in_progress' | 'queued' | 'completed' | 'failed';

export interface KanbanCard {
  id: string;
  title: string;
  notes?: string;
  status: KanbanStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  lastEditedBy: 'bot' | 'user';
}

export interface KanbanRunEntry {
  id: string;
  at: string;
  summary: string;
  outcome: 'success' | 'partial' | 'failed';
  cardIds?: string[];
  notes?: string;
}

// ─── Local helpers (kept inline so this component is self-contained) ───────

function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86400_000)}d ago`;
}

const KANBAN_COLUMNS: Array<{ id: KanbanStatus; label: string; sub: string; tone: string; iconBg: string; icon: any; ringTone: string }> = [
  { id: 'in_progress', label: 'In progress', sub: 'Doing now',        tone: 'text-amber-300',   iconBg: 'bg-amber-500/15 text-amber-300',     icon: CircleDot,    ringTone: 'ring-amber-400/30' },
  { id: 'queued',      label: 'Queued',      sub: 'Up next',          tone: 'text-sky-300',     iconBg: 'bg-sky-500/15 text-sky-300',         icon: CircleDashed, ringTone: 'ring-sky-400/30' },
  { id: 'completed',   label: 'Done',        sub: 'Recently shipped', tone: 'text-emerald-300', iconBg: 'bg-emerald-500/15 text-emerald-300', icon: CheckCircle2, ringTone: 'ring-emerald-400/30' },
  { id: 'failed',      label: 'Stuck',       sub: 'Needs a retry',    tone: 'text-rose-300',    iconBg: 'bg-rose-500/15 text-rose-300',       icon: XCircle,      ringTone: 'ring-rose-400/30' },
];

// ─── Public component ──────────────────────────────────────────────────────

export function KanbanTab({
  botId,
  cards,
  runLog,
  onChanged,
}: {
  botId: string;
  cards: KanbanCard[];
  runLog: KanbanRunEntry[];
  onChanged: () => Promise<void> | void;
}) {
  const [editingCard, setEditingCard] = useState<KanbanCard | null>(null);
  const [creatingInColumn, setCreatingInColumn] = useState<KanbanStatus | null>(null);

  // Group by status, newest-first per column.
  const grouped = useMemo(() => {
    const map: Record<KanbanStatus, KanbanCard[]> = { in_progress: [], queued: [], completed: [], failed: [] };
    for (const c of cards) {
      const key = (KANBAN_COLUMNS.some(col => col.id === c.status) ? c.status : 'queued') as KanbanStatus;
      map[key].push(c);
    }
    for (const k of Object.keys(map) as KanbanStatus[]) {
      map[k].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    return map;
  }, [cards]);

  const totalActive = grouped.in_progress.length + grouped.queued.length;
  const isEmpty = cards.length === 0 && runLog.length === 0;

  const handleMove = async (card: KanbanCard, status: KanbanStatus) => {
    if (card.status === status) return;
    await window.desktopAPI.botsMemoryUpdateCard(botId, card.id, { status });
    onChanged();
  };

  const handleDelete = async (card: KanbanCard) => {
    if (!confirm(`Delete "${card.title}"?`)) return;
    await window.desktopAPI.botsMemoryDeleteCard(botId, card.id);
    onChanged();
  };

  const handleSave = async (patch: { title: string; notes?: string; status: KanbanStatus }) => {
    if (editingCard) {
      await window.desktopAPI.botsMemoryUpdateCard(botId, editingCard.id, patch);
    } else if (creatingInColumn) {
      await window.desktopAPI.botsMemoryCreateCard(botId, { ...patch, status: creatingInColumn });
    }
    setEditingCard(null);
    setCreatingInColumn(null);
    onChanged();
  };

  return (
    <div className="space-y-4">
      {/* Heading */}
      <div className="rounded-2xl border border-theme/40 dark:border-transparent bg-theme-card px-4 py-3.5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-[15px] font-semibold text-theme-fg">
              <LayoutGrid className="h-4 w-4" /> Agent kanban
              <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                <BotIcon className="h-2.5 w-2.5" /> Private
              </span>
            </h3>
            <p className="mt-1 text-[12px] leading-5 text-theme-muted">
              The agent's own working memory — separate from your task board.
              {totalActive > 0
                ? <> {totalActive} active card{totalActive === 1 ? '' : 's'} loaded into the agent's prompt next run.</>
                : cards.length > 0
                  ? <> All cards completed or stuck — agent will see history but has nothing active.</>
                  : <> Empty for now. The agent will fill it as it works, or you can seed it.</>}
            </p>
          </div>
          <button
            onClick={() => setCreatingInColumn('queued')}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-[12px] font-semibold text-primary-fg shadow-sm transition hover:opacity-90"
          >
            <Plus className="h-3 w-3" />
            Add card
          </button>
        </div>
      </div>

      {/* Empty state */}
      {isEmpty && (
        <div className="rounded-2xl border border-dashed border-theme/40 bg-theme-card/60 p-8 text-center">
          <div className="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <LayoutGrid className="h-4 w-4" />
          </div>
          <div className="mx-auto max-w-md text-[13px] leading-6 text-theme-fg/90">
            Once the agent starts running, it will plan, work, and reflect right here.
          </div>
          <p className="mx-auto mt-1 max-w-md text-[12px] leading-5 text-theme-muted">
            You can also seed the agent with intent up-front by adding a card — it'll see it on the next run.
          </p>
          <button
            onClick={() => setCreatingInColumn('queued')}
            className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-theme bg-theme-card px-3.5 py-1.5 text-[12px] font-medium text-theme-fg shadow-sm transition hover:bg-theme-hover"
          >
            <Plus className="h-3 w-3" />
            Add a card
          </button>
        </div>
      )}

      {/* Board — wider columns now that the tab takes full width. */}
      {!isEmpty && (
        <div className="rounded-xl border border-theme/30 dark:border-transparent bg-zinc-500/10 p-3">
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {KANBAN_COLUMNS.map(col => (
              <KanbanColumn
                key={col.id}
                column={col}
                cards={grouped[col.id]}
                onAdd={() => setCreatingInColumn(col.id)}
                onCardClick={(c) => setEditingCard(c)}
                onMove={handleMove}
                onDelete={handleDelete}
              />
            ))}
          </div>
        </div>
      )}

      <RunLogSection runLog={runLog} />

      {(editingCard || creatingInColumn) && (
        <KanbanCardEditModal
          mode={editingCard ? 'edit' : 'create'}
          initialCard={editingCard}
          initialStatus={creatingInColumn || 'queued'}
          onClose={() => { setEditingCard(null); setCreatingInColumn(null); }}
          onSave={handleSave}
          onDelete={editingCard ? () => handleDelete(editingCard) : undefined}
        />
      )}
    </div>
  );
}

// ─── Internal subcomponents ────────────────────────────────────────────────

function KanbanColumn({
  column,
  cards,
  onAdd,
  onCardClick,
  onMove,
  onDelete,
}: {
  column: typeof KANBAN_COLUMNS[number];
  cards: KanbanCard[];
  onAdd: () => void;
  onCardClick: (c: KanbanCard) => void;
  onMove: (c: KanbanCard, status: KanbanStatus) => void | Promise<void>;
  onDelete: (c: KanbanCard) => void | Promise<void>;
}) {
  const Icon = column.icon;
  return (
    <div className="flex min-h-[220px] flex-col rounded-2xl border border-theme/40 dark:border-transparent bg-theme-card p-3 shadow-sm">
      <div className="mb-3 flex items-center justify-between border-b border-theme/15 pb-2.5">
        <div className="flex items-center gap-2">
          <span className={clsx('inline-flex h-6 w-6 items-center justify-center rounded-md', column.iconBg)}>
            <Icon className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[12px] font-semibold text-theme-fg">
              {column.label}
              <span className="rounded-md bg-theme-hover/60 px-1.5 py-px text-[10px] font-medium text-theme-muted">{cards.length}</span>
            </div>
            <div className="text-[10px] leading-4 text-theme-muted">{column.sub}</div>
          </div>
        </div>
        <button
          onClick={onAdd}
          className="rounded-md p-1 text-theme-muted transition hover:bg-theme-hover/50 hover:text-theme-fg"
          title={`Add to ${column.label}`}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-2">
        {cards.length === 0 ? (
          <button
            onClick={onAdd}
            className="rounded-xl border border-dashed border-theme/30 bg-zinc-500/5 px-3 py-4 text-[11px] text-theme-muted/70 transition hover:border-theme/60 hover:text-theme-muted"
          >
            Empty — click to add
          </button>
        ) : (
          cards.map(card => (
            <KanbanCardItem
              key={card.id}
              card={card}
              column={column}
              onClick={() => onCardClick(card)}
              onMove={(status) => onMove(card, status)}
              onDelete={() => onDelete(card)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function KanbanCardItem({
  card,
  column,
  onClick,
  onMove,
  onDelete,
}: {
  card: KanbanCard;
  column: typeof KANBAN_COLUMNS[number];
  onClick: () => void;
  onMove: (status: KanbanStatus) => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div
      onClick={onClick}
      className={clsx(
        'group relative cursor-pointer rounded-xl border border-theme/30 dark:border-transparent bg-zinc-500/10 p-3 shadow-sm transition hover:bg-theme-hover/25 hover:ring-2',
        column.ringTone,
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-[12.5px] font-medium leading-snug text-theme-fg">
            {card.title}
          </div>
          {card.notes && (
            <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-theme-muted">{card.notes}</p>
          )}
        </div>
        <button
          onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }}
          className="shrink-0 rounded p-1 text-theme-muted opacity-0 transition group-hover:opacity-100 hover:bg-theme-hover/40 hover:text-theme-fg"
          title="More"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-theme-muted">
        <span title={`Last edited by ${card.lastEditedBy === 'bot' ? 'agent' : 'you'}`}
              className={clsx(
                'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5',
                card.lastEditedBy === 'bot' ? 'bg-primary/10 text-primary' : 'bg-theme-hover/50 text-theme-muted',
              )}>
          {card.lastEditedBy === 'bot' ? <BotIcon className="h-2.5 w-2.5" /> : <UserIcon className="h-2.5 w-2.5" />}
          <span>{card.lastEditedBy === 'bot' ? 'agent' : 'you'}</span>
        </span>
        <span title={new Date(card.updatedAt).toLocaleString()}>{timeAgo(card.updatedAt)}</span>
      </div>

      {menuOpen && (
        <div
          className="absolute right-2 top-9 z-10 w-44 rounded-lg border border-theme/30 dark:border-transparent bg-theme-card p-1 shadow-lg"
          onClick={e => e.stopPropagation()}
        >
          <div className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-theme-muted">Move to</div>
          {KANBAN_COLUMNS.filter(c => c.id !== card.status).map(c => {
            const Icon = c.icon;
            return (
              <button
                key={c.id}
                onClick={() => { setMenuOpen(false); onMove(c.id); }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-theme-fg transition hover:bg-theme-hover/40"
              >
                <Icon className={clsx('h-3 w-3', c.tone)} />
                {c.label}
              </button>
            );
          })}
          <div className="my-1 h-px bg-theme/15" />
          <button
            onClick={() => { setMenuOpen(false); onDelete(); }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-rose-300 transition hover:bg-rose-500/10"
          >
            <Trash2 className="h-3 w-3" />
            Delete card
          </button>
        </div>
      )}
    </div>
  );
}

function RunLogSection({ runLog }: { runLog: KanbanRunEntry[] }) {
  return (
    <div className="rounded-2xl border border-theme/40 dark:border-transparent bg-theme-card px-4 py-3.5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-[15px] font-semibold text-theme-fg">
          <Activity className="h-4 w-4" /> Run log
          <span className="text-[12px] font-normal text-theme-muted">({runLog.length})</span>
        </h3>
        <p className="hidden text-[11px] text-theme-muted sm:block">What the agent remembers from past runs</p>
      </div>
      {runLog.length === 0 ? (
        <div className="flex items-center justify-center rounded-2xl border border-dashed border-theme/40 bg-zinc-500/5 p-6 text-center">
          <div className="max-w-sm text-[12px] leading-5 text-theme-muted">
            Empty for now. After each run the agent will leave a one-line note here for its future self to read.
          </div>
        </div>
      ) : (
        <ol className="relative space-y-2.5 border-l border-theme/20 pl-4">
          {runLog.map(entry => {
            const tone =
              entry.outcome === 'success' ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/30'
              : entry.outcome === 'partial' ? 'bg-amber-500/15 text-amber-300 ring-amber-400/30'
              : 'bg-rose-500/15 text-rose-300 ring-rose-400/30';
            const Icon = entry.outcome === 'success' ? CheckCircle2 : entry.outcome === 'partial' ? CircleDot : XCircle;
            return (
              <li key={entry.id} className="relative">
                <span className={clsx('absolute -left-[22px] top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full ring-2', tone)}>
                  <Icon className="h-2.5 w-2.5" />
                </span>
                <div className="rounded-xl border border-theme/30 dark:border-transparent bg-zinc-500/10 px-3 py-2 shadow-sm">
                  <div className="flex items-start justify-between gap-2 text-[10px] text-theme-muted">
                    <span>{timeAgo(entry.at)}</span>
                    <span className="uppercase tracking-wide">{entry.outcome}</span>
                  </div>
                  <div className="mt-1 text-[12.5px] leading-snug text-theme-fg">{entry.summary}</div>
                  {entry.notes && (
                    <div className="mt-1 text-[11px] leading-snug text-theme-muted">{entry.notes}</div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function KanbanCardEditModal({
  mode,
  initialCard,
  initialStatus,
  onClose,
  onSave,
  onDelete,
}: {
  mode: 'create' | 'edit';
  initialCard: KanbanCard | null;
  initialStatus: KanbanStatus;
  onClose: () => void;
  onSave: (patch: { title: string; notes?: string; status: KanbanStatus }) => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
}) {
  const [title, setTitle] = useState(initialCard?.title || '');
  const [notes, setNotes] = useState(initialCard?.notes || '');
  const [status, setStatus] = useState<KanbanStatus>(initialCard?.status || initialStatus);
  const [submitting, setSubmitting] = useState(false);

  const canSave = title.trim().length > 0 && !submitting;

  const handleSubmit = async () => {
    if (!canSave) return;
    setSubmitting(true);
    try {
      await onSave({ title: title.trim(), notes: notes.trim() || undefined, status });
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md animate-in fade-in duration-150"
      onClick={onClose}
      style={{ WebkitBackdropFilter: 'blur(12px)', backdropFilter: 'blur(12px)' }}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-3xl border border-theme/50 dark:border-transparent bg-theme-card shadow-2xl animate-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        <div className="border-b border-theme/15 px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-stuard text-lg font-semibold text-theme-fg">
              {mode === 'create' ? 'Add card' : 'Edit card'}
            </h2>
            {initialCard && (
              <span
                className={clsx(
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
                  initialCard.lastEditedBy === 'bot' ? 'bg-primary/10 text-primary' : 'bg-theme-hover/60 text-theme-muted',
                )}
              >
                {initialCard.lastEditedBy === 'bot' ? <BotIcon className="h-2.5 w-2.5" /> : <UserIcon className="h-2.5 w-2.5" />}
                Last edited by {initialCard.lastEditedBy === 'bot' ? 'agent' : 'you'}
              </span>
            )}
          </div>
        </div>

        <div className="space-y-4 p-5">
          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-theme-muted">Title</label>
            <input
              autoFocus
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit(); }}
              placeholder="What is this card about?"
              className="w-full rounded-xl border border-theme/30 dark:border-transparent bg-theme-card/60 px-3 py-2.5 text-[14px] text-theme-fg outline-none transition focus:border-primary/60"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-theme-muted">Notes</label>
            <textarea
              rows={5}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Context for the agent's future self — links, what was tried, what to revisit."
              className="w-full resize-none rounded-xl border border-theme/30 dark:border-transparent bg-theme-card/60 px-3 py-2.5 text-[13px] leading-6 text-theme-fg outline-none transition focus:border-primary/60"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-theme-muted">Column</label>
            <div className="grid grid-cols-2 gap-2">
              {KANBAN_COLUMNS.map(c => {
                const Icon = c.icon;
                const active = c.id === status;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setStatus(c.id)}
                    className={clsx(
                      'flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-[12px] transition',
                      active
                        ? 'border-primary bg-primary/10 text-theme-fg ring-2 ring-primary/30'
                        : 'border-theme/30 dark:border-transparent bg-theme-card/40 text-theme-muted hover:bg-theme-hover/40',
                    )}
                  >
                    <Icon className={clsx('h-3.5 w-3.5', c.tone)} />
                    <span className="font-medium">{c.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-theme/15 px-5 py-3">
          {onDelete ? (
            <button
              onClick={() => { onDelete(); onClose(); }}
              className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/30 bg-transparent px-3 py-1.5 text-[12px] font-medium text-rose-300 transition hover:bg-rose-500/10"
            >
              <Trash2 className="h-3 w-3" /> Delete
            </button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-full px-3 py-1.5 text-[12px] text-theme-muted transition hover:text-theme-fg"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSave}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-[12px] font-semibold text-primary-fg shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              {mode === 'create' ? 'Add card' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
