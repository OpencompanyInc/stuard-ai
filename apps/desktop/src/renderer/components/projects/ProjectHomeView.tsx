/**
 * ProjectHomeView — Notion-flavored home for an active project. Layout is
 * deliberately quiet: minimal chrome, generous whitespace, no color floods.
 * The project's accent color shows up only as a thin top rail and in the icon
 * chip, so the user feels "in focus mode" rather than shouted at.
 */
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import clsx from 'clsx';
import {
  ArrowLeft,
  Bookmark,
  ChevronDown,
  Circle,
  CircleCheckBig,
  ExternalLink,
  FileText,
  FolderOpen,
  History,
  Link2,
  ListTodo,
  Loader2,
  NotebookPen,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Tag as TagIcon,
  Target,
  Trash2,
  X,
} from 'lucide-react';
import {
  addProjectContextPath,
  getProject,
  linkProjectNotion,
  listJournal,
  listMemories,
  searchNotionTargets,
  syncProjectNotionNow,
  unlinkProjectNotion,
  updateProject,
  updateProjectNotion,
  type JournalEntry,
  type JournalEntryType,
  type MemoryType,
  type NotionSearchResult,
  type Project,
  type ProjectMemory,
  type ProjectNotionSettings,
} from '../../hooks/useProjects';
import type { UnifiedTask } from '../../types/tasks';

type TabId = 'timeline' | 'tasks' | 'memory' | 'files' | 'instructions';

interface ProjectHomeViewProps {
  project: Project;
  onProjectChanged?: () => void;
  onBack?: () => void;
}

const TABS: Array<{
  id: TabId;
  label: string;
  icon: React.ElementType;
}> = [
  { id: 'timeline', label: 'Timeline', icon: History },
  { id: 'tasks', label: 'Tasks', icon: ListTodo },
  { id: 'memory', label: 'Notes', icon: NotebookPen },
  { id: 'files', label: 'Files', icon: Paperclip },
  { id: 'instructions', label: 'Instructions', icon: SlidersHorizontal },
];

const NARROW_TAB_BREAKPOINT = 420; // icon-only segments below this width

async function execTool<T = any>(tool: string, args: any = {}): Promise<T | null> {
  try {
    const api = (window as any).desktopAPI;
    if (!api?.execTool) return null;
    const result = await api.execTool(tool, args);
    return result ?? null;
  } catch {
    return null;
  }
}

export const ProjectHomeView: React.FC<ProjectHomeViewProps> = ({ project, onBack, onProjectChanged }) => {
  const [tab, setTab] = useState<TabId>('timeline');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number>(0);
  const [counts, setCounts] = useState<Partial<Record<TabId, number>>>({
    files: (project.pinned_paths || []).length,
  });

  // Reset tab + counts when switching projects so each opens cleanly on the timeline.
  useEffect(() => {
    setTab('timeline');
    setCounts({ files: (project.pinned_paths || []).length });
  }, [project.id, project.pinned_paths]);

  const reportCount = useCallback((id: TabId, n: number) => {
    setCounts((prev) => (prev[id] === n ? prev : { ...prev, [id]: n }));
  }, []);

  // Prefetch counts for tabs that haven't mounted yet, so the tab bar shows
  // real numbers immediately instead of only after each tab is visited.
  // Timeline mounts by default and reports its own count.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [memories, tasksRes] = await Promise.all([
        listMemories(project.id, 200),
        (window as any).desktopAPI?.unifiedTasksList?.(),
      ]);
      if (cancelled) return;
      setCounts((prev) => ({
        ...prev,
        memory: memories.length,
        ...(tasksRes?.ok
          ? {
              tasks: ((tasksRes.tasks || []) as UnifiedTask[]).filter(
                (t) => t.projectId === project.id && t.status !== 'completed',
              ).length,
            }
          : {}),
      }));
    })();
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  const tabsCompact = width > 0 && width < NARROW_TAB_BREAKPOINT;
  const accent = project.color || '#71717a';

  return (
    <div
      ref={containerRef}
      className="flex flex-col w-full h-full overflow-hidden bg-theme-bg/40"
    >
      {/* Top accent rail — the only place the color appears as a wash. */}
      <span
        aria-hidden
        className="shrink-0 h-[2px] w-full"
        style={{ backgroundColor: accent }}
      />

      <ProjectHeader project={project} onBack={onBack} accent={accent} compact={tabsCompact} />

      {/* Segmented tab control. In compact widths the active segment expands
          to show its label while inactive segments collapse to icons. */}
      <div className={clsx('shrink-0', tabsCompact ? 'px-2.5 pb-2' : 'px-3 pb-2.5')}>
        <div className="flex items-center gap-0.5 p-1 rounded-[14px] bg-theme-hover/35 border border-theme/10">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            const count = counts[t.id];
            const hasCount = typeof count === 'number' && count > 0;
            const showLabel = !tabsCompact || active;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                title={hasCount ? `${t.label} · ${count}` : t.label}
                className={clsx(
                  'relative flex items-center justify-center gap-1.5 h-8 min-w-0 rounded-[10px] text-[11.5px] font-semibold whitespace-nowrap transition-all duration-200',
                  tabsCompact
                    ? active
                      ? 'flex-[2.2] px-2'
                      : 'flex-1 px-1'
                    : 'flex-1 px-2',
                  active
                    ? 'bg-theme-card text-theme-fg shadow-[0_1px_4px_rgba(0,0,0,0.08)] ring-1 ring-inset ring-theme/10'
                    : 'text-theme-muted/75 hover:text-theme-fg hover:bg-theme-hover/50',
                )}
              >
                <Icon
                  className="w-[15px] h-[15px] shrink-0"
                  strokeWidth={active ? 2 : 1.75}
                  style={active ? { color: accent } : undefined}
                />
                {showLabel && <span className="truncate">{t.label}</span>}
                {hasCount && showLabel && (
                  <span
                    className={clsx(
                      'shrink-0 px-1 py-0.5 rounded-full text-[9.5px] font-bold leading-none tabular-nums min-w-[16px] text-center',
                      active ? 'bg-theme-hover/80 text-theme-fg' : 'bg-theme-hover/60 text-theme-muted/80',
                    )}
                  >
                    {count > 99 ? '99+' : count}
                  </span>
                )}
                {hasCount && !showLabel && (
                  <span
                    aria-hidden
                    className="absolute top-1 right-1.5 w-1 h-1 rounded-full"
                    style={{ backgroundColor: accent }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === 'timeline' && <TimelineTab project={project} onCount={(n) => reportCount('timeline', n)} />}
        {tab === 'tasks' && <TasksTab project={project} accent={accent} onCount={(n) => reportCount('tasks', n)} />}
        {tab === 'memory' && <MemoryTab project={project} onCount={(n) => reportCount('memory', n)} />}
        {tab === 'files' && (
          <FilesTab
            project={project}
            onProjectChanged={onProjectChanged}
            onCount={(n) => reportCount('files', n)}
          />
        )}
        {tab === 'instructions' && (
          <InstructionsTab project={project} onProjectChanged={onProjectChanged} />
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Header
// ─────────────────────────────────────────────────────────────────────────────

const ProjectHeader: React.FC<{
  project: Project;
  onBack?: () => void;
  accent: string;
  compact?: boolean;
}> = ({ project, onBack, accent, compact }) => {
  const maxTags = compact ? 3 : 6;
  const updated = project.updated_at ? formatRelative(project.updated_at) : null;
  return (
    <div className={clsx('shrink-0', compact ? 'px-3 pt-3 pb-2.5' : 'px-3.5 pt-3.5 pb-3')}>
      <div className="flex items-center gap-2.5">
        {onBack && (
          <button
            onClick={onBack}
            className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-theme-muted hover:text-theme-fg bg-theme-hover/35 hover:bg-theme-hover/70 transition-colors"
            title="Back to projects"
          >
            <ArrowLeft className="w-3.5 h-3.5" strokeWidth={1.75} />
          </button>
        )}
        <span
          className={clsx(
            'shrink-0 rounded-[12px] flex items-center justify-center ring-1 ring-inset',
            compact ? 'w-9 h-9 text-lg' : 'w-10 h-10 text-xl',
          )}
          style={{
            backgroundColor: `${accent}14`,
            color: accent,
            // @ts-ignore — set ring color inline
            ['--tw-ring-color' as any]: `${accent}26`,
          }}
          aria-hidden
        >
          {project.icon || '📁'}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <h2 className="text-[15px] font-bold tracking-tight text-theme-fg truncate min-w-0">
              {project.name}
            </h2>
            {project.status && project.status !== 'active' && (
              <span
                className={clsx(
                  'shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-semibold leading-none',
                  project.status === 'paused' && 'bg-amber-500/10 text-amber-500',
                  project.status === 'archived' && 'bg-zinc-500/10 text-zinc-500',
                )}
              >
                {formatTypeLabel(project.status)}
              </span>
            )}
          </div>
          {project.description ? (
            <p
              className={clsx(
                'mt-0.5 text-[12px] text-theme-muted break-words',
                compact ? 'line-clamp-1' : 'line-clamp-2',
              )}
              title={project.description}
            >
              {project.description}
            </p>
          ) : updated ? (
            <p className="mt-0.5 text-[11px] text-theme-muted/60">Updated {updated}</p>
          ) : null}
        </div>
      </div>

      {(project.goals || (project.tags && project.tags.length > 0)) && (
        <div className={clsx('space-y-1.5', compact ? 'mt-2' : 'mt-2.5')}>
          {project.goals && (
            <div className="flex items-start gap-1.5 text-[11.5px] text-theme-fg/80 leading-snug">
              <Target className="w-3 h-3 mt-[2px] shrink-0" style={{ color: accent }} strokeWidth={1.75} />
              <span
                className={clsx('break-words', compact ? 'line-clamp-1' : 'line-clamp-2')}
                title={project.goals}
              >
                {project.goals}
              </span>
            </div>
          )}
          {project.tags && project.tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <TagIcon className="w-3 h-3 text-theme-muted/60 shrink-0" />
              {project.tags.slice(0, maxTags).map((tag) => (
                <span
                  key={tag}
                  className="px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-theme-hover/60 text-theme-muted truncate max-w-[120px]"
                >
                  {tag}
                </span>
              ))}
              {project.tags.length > maxTags && (
                <span className="text-[10px] text-theme-muted/60">+{project.tags.length - maxTags}</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Timeline / Journal tab
// ─────────────────────────────────────────────────────────────────────────────

const JOURNAL_BADGE: Record<string, string> = {
  decision: 'bg-violet-500/10 text-violet-400',
  finding: 'bg-sky-500/10 text-sky-400',
  question: 'bg-cyan-500/10 text-cyan-400',
  hypothesis: 'bg-fuchsia-500/10 text-fuchsia-400',
  blocker: 'bg-red-500/10 text-red-400',
  edit: 'bg-emerald-500/10 text-emerald-400',
  chat_summary: 'bg-zinc-500/10 text-zinc-400',
  task: 'bg-amber-500/10 text-amber-400',
  milestone: 'bg-primary/15 text-primary',
  note: 'bg-theme-hover/60 text-theme-muted',
};

// Timeline rail dot colors, matched to the badge palette above.
const JOURNAL_DOT: Record<string, string> = {
  decision: '#a78bfa',
  finding: '#38bdf8',
  question: '#22d3ee',
  hypothesis: '#e879f9',
  blocker: '#f87171',
  edit: '#34d399',
  chat_summary: '#a1a1aa',
  task: '#fbbf24',
  milestone: '#ef4444',
  note: '#71717a',
};

// Timeline = time-ordered events. Plain "notes" belong in the Notes tab
// (memory_create), so we omit `note` from the user-facing palette. Existing
// `type: 'note'` entries still render (see JOURNAL_BADGE fallback).
const JOURNAL_TYPE_OPTIONS: Array<{ id: JournalEntryType; label: string }> = [
  { id: 'finding', label: 'Finding' },
  { id: 'decision', label: 'Decision' },
  { id: 'question', label: 'Question' },
  { id: 'hypothesis', label: 'Hypothesis' },
  { id: 'blocker', label: 'Blocker' },
  { id: 'edit', label: 'Edit' },
  { id: 'milestone', label: 'Milestone' },
];

type TimelineFilter = 'all' | 'sessions' | JournalEntryType;

function isSessionEntry(entry: JournalEntry): boolean {
  return entry.type === 'chat_summary' || entry.source === 'auto-chat';
}

/** A session entry still being extended by the auto-journal reads as "live". */
function isLiveSession(entry: JournalEntry): boolean {
  if (!isSessionEntry(entry)) return false;
  const updated = Date.parse(entry.updated_at || entry.created_at || '');
  return Number.isFinite(updated) && Date.now() - updated < 15 * 60_000;
}

function dayKeyOf(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  } catch {
    return iso.slice(0, 10);
  }
}

function dayLabelOf(key: string): string {
  const today = dayKeyOf(new Date().toISOString());
  const yesterday = dayKeyOf(new Date(Date.now() - 86_400_000).toISOString());
  if (key === today) return 'Today';
  if (key === yesterday) return 'Yesterday';
  try {
    return new Date(`${key}T12:00:00`).toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return key;
  }
}

const TimelineTab: React.FC<{ project: Project; onCount?: (n: number) => void }> = ({
  project,
  onCount,
}) => {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<TimelineFilter>('all');

  const reload = useCallback(async () => {
    setLoading(true);
    const list = await listJournal(project.id, 200);
    setEntries(list);
    setLoading(false);
  }, [project.id]);

  useEffect(() => {
    setFilter('all');
    void reload();
  }, [reload]);

  // Live session entries keep growing while the user chats — refresh quietly.
  useEffect(() => {
    if (!entries.some(isLiveSession)) return;
    const id = setInterval(() => {
      void listJournal(project.id, 200).then(setEntries);
    }, 45_000);
    return () => clearInterval(id);
  }, [entries, project.id]);

  useEffect(() => {
    onCount?.(entries.length);
  }, [entries.length, onCount]);

  const handleAdd = useCallback(
    async (input: { type: JournalEntryType; title: string; body?: string }) => {
      const result = await execTool<{ ok: boolean; entry?: JournalEntry }>('journal_add', {
        project_id: project.id,
        type: input.type,
        title: input.title,
        body: input.body,
        source: 'manual',
      });
      if (result?.ok && result.entry) {
        setEntries((prev) => [result.entry as JournalEntry, ...prev]);
      } else {
        void reload();
      }
    },
    [project.id, reload],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      setEntries((prev) => prev.filter((e) => e.id !== id));
      await execTool('journal_delete', { entry_id: id });
    },
    [],
  );

  // Filter chips: only show types that exist, so the row stays quiet.
  const filterOptions = useMemo(() => {
    const counts = new Map<TimelineFilter, number>();
    for (const entry of entries) {
      const key: TimelineFilter = isSessionEntry(entry) ? 'sessions' : entry.type;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const order: TimelineFilter[] = [
      'sessions', 'milestone', 'decision', 'finding', 'blocker', 'edit', 'question', 'hypothesis', 'task', 'note',
    ];
    const options: Array<{ id: TimelineFilter; label: string; count: number }> = [
      { id: 'all', label: 'All', count: entries.length },
    ];
    for (const key of order) {
      const count = counts.get(key);
      if (count) {
        options.push({
          id: key,
          label: key === 'sessions' ? 'Sessions' : `${formatTypeLabel(key)}s`,
          count,
        });
      }
    }
    return options;
  }, [entries]);

  const visible = useMemo(() => {
    if (filter === 'all') return entries;
    if (filter === 'sessions') return entries.filter(isSessionEntry);
    return entries.filter((e) => !isSessionEntry(e) && e.type === filter);
  }, [entries, filter]);

  // Day-grouped, newest day first (entries already arrive newest-first).
  const dayGroups = useMemo(() => {
    const groups: Array<{ key: string; label: string; entries: JournalEntry[] }> = [];
    for (const entry of visible) {
      const key = dayKeyOf(entry.ts || entry.created_at);
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.entries.push(entry);
      else groups.push({ key, label: dayLabelOf(key), entries: [entry] });
    }
    return groups;
  }, [visible]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <JournalComposer onSubmit={handleAdd} />

      {filterOptions.length > 2 && (
        <div className="shrink-0 px-3 pb-2 flex items-center gap-1 overflow-x-auto scrollbar-invisible">
          {filterOptions.map((opt) => {
            const active = filter === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => setFilter(opt.id)}
                className={clsx(
                  'shrink-0 inline-flex items-center gap-1 h-6 pl-2.5 pr-2 rounded-full border text-[10.5px] font-semibold leading-none transition-colors tabular-nums',
                  active
                    ? 'bg-theme-fg border-transparent text-theme-bg'
                    : 'bg-theme-card/60 border-theme/10 text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60',
                )}
              >
                {opt.label}
                <span className={active ? 'opacity-60' : 'text-theme-muted/60'}>{opt.count}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-3 pt-1 pb-3">
        {loading && entries.length === 0 ? (
          <PanelStatus label="Loading timeline…" inline />
        ) : entries.length === 0 ? (
          <PanelStatus
            icon={<History className="w-7 h-7 text-theme-muted/50" />}
            title="Timeline is empty"
            body="Chat sessions are captured here automatically as you work in this project. Decisions, findings, and blockers join them along the way."
          />
        ) : visible.length === 0 ? (
          <PanelStatus label="Nothing matches this filter." inline />
        ) : (
          <div className="space-y-4">
            {dayGroups.map((group) => (
              <div key={group.key}>
                <div className="flex items-center gap-2 px-1 pb-1.5">
                  <span className="text-[10.5px] font-bold uppercase tracking-wide text-theme-muted/70">
                    {group.label}
                  </span>
                  <span className="flex-1 h-px bg-theme-sidebar" />
                </div>
                <div className="relative pl-[15px] space-y-2">
                  {/* Rail connecting the day's entries. */}
                  <span aria-hidden className="absolute left-[5px] top-2 bottom-2 w-px bg-theme-sidebar" />
                  {group.entries.map((entry) => (
                    <div key={entry.id} className="relative">
                      <span
                        aria-hidden
                        className={clsx(
                          'absolute -left-[14px] top-[14px] w-[7px] h-[7px] rounded-full ring-2 ring-theme-bg',
                          isLiveSession(entry) && 'animate-pulse',
                        )}
                        style={{ backgroundColor: JOURNAL_DOT[isSessionEntry(entry) ? 'chat_summary' : entry.type] || JOURNAL_DOT.note }}
                      />
                      {isSessionEntry(entry) ? (
                        <SessionRow entry={entry} onDelete={() => handleDelete(entry.id)} />
                      ) : (
                        <JournalRow entry={entry} onDelete={() => handleDelete(entry.id)} />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

/** Auto-journaled chat session card — visually quieter than manual entries. */
const SessionRow: React.FC<{ entry: JournalEntry; onDelete: () => void }> = ({ entry, onDelete }) => {
  const live = isLiveSession(entry);
  const when = useMemo(
    () => formatRelative(entry.updated_at || entry.ts || entry.created_at),
    [entry.updated_at, entry.ts, entry.created_at],
  );

  return (
    <div className="group px-3 py-2.5 rounded-[14px] bg-theme-bg/40 border border-dashed border-theme-sidebar hover:border-theme transition-colors">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold leading-none bg-theme-hover/50 text-theme-muted">
          {live && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" aria-hidden />}
          {live ? 'Live session' : 'Session'}
        </span>
        <span className="ml-auto text-[10.5px] tabular-nums text-theme-muted/60">{when}</span>
        <button
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 transition-opacity w-6 h-6 -my-1 inline-flex items-center justify-center rounded-md text-theme-muted hover:text-red-400 hover:bg-red-500/10"
          title="Delete session entry"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
      <div className="mt-1 text-[12.5px] font-medium text-theme-fg/90 leading-snug">{entry.title}</div>
      {entry.body && (
        <div className="mt-0.5 text-[11.5px] text-theme-muted whitespace-pre-wrap line-clamp-3">{entry.body}</div>
      )}
    </div>
  );
};

const JournalComposer: React.FC<{
  onSubmit: (input: { type: JournalEntryType; title: string; body?: string }) => Promise<void>;
}> = ({ onSubmit }) => {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<JournalEntryType>('finding');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const titleRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      const id = requestAnimationFrame(() => titleRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  const reset = () => {
    setTitle('');
    setBody('');
    setType('finding');
  };

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit({ type, title: trimmed, body: body.trim() || undefined });
      reset();
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <div className="shrink-0 px-3 pt-3 pb-2">
        <button
          onClick={() => setOpen(true)}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-[14px] bg-theme-card/50 hover:bg-theme-card/80 border border-theme-sidebar hover:border-theme text-left transition-colors"
        >
          <Plus className="w-3.5 h-3.5 text-theme-muted" />
          <span className="text-[12px] text-theme-muted/80">Log a finding, decision, or blocker…</span>
        </button>
      </div>
    );
  }

  return (
    <div className="shrink-0 px-3 pt-3 pb-2">
      <div className="rounded-[14px] bg-theme-card/70 border border-theme p-2.5 space-y-2">
        <div className="flex items-center gap-2">
          <TypeSelect value={type} options={JOURNAL_TYPE_OPTIONS} onChange={setType} />
          <button
            onClick={() => {
              reset();
              setOpen(false);
            }}
            className="ml-auto w-6 h-6 inline-flex items-center justify-center rounded-md text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60 transition-colors"
            title="Cancel"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <input
          ref={titleRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.metaKey) {
              e.preventDefault();
              void submit();
            }
            if (e.key === 'Escape') {
              setOpen(false);
              reset();
            }
          }}
          placeholder="Short title"
          className="w-full px-2 py-1.5 text-[13px] font-semibold bg-transparent text-theme-fg placeholder:text-theme-muted/50 outline-none"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="Body (optional). Why this matters."
          rows={2}
          className="w-full px-2 py-1.5 text-[12px] bg-transparent text-theme-fg placeholder:text-theme-muted/50 outline-none resize-none"
        />
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-theme-muted/50">Enter to save · Esc to cancel</span>
          <button
            onClick={submit}
            disabled={!title.trim() || submitting}
            className="px-3 py-1 rounded-md text-[11px] font-semibold bg-theme-fg text-theme-bg disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity inline-flex items-center gap-1"
          >
            {submitting && <Loader2 className="w-3 h-3 animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

const JournalRow: React.FC<{ entry: JournalEntry; onDelete: () => void }> = ({ entry, onDelete }) => {
  const badge = JOURNAL_BADGE[entry.type] || JOURNAL_BADGE.note;
  const when = useMemo(() => formatRelative(entry.ts || entry.created_at), [entry.ts, entry.created_at]);

  return (
    <div className="group px-3 py-2.5 rounded-[14px] bg-theme-card/60 border border-theme-sidebar hover:border-theme transition-colors">
      <div className="flex items-center gap-2">
        <span className={clsx('px-1.5 py-0.5 rounded-md text-[10px] font-semibold leading-none', badge)}>
          {formatTypeLabel(entry.type)}
        </span>
        <span className="ml-auto text-[10.5px] tabular-nums text-theme-muted/60">{when}</span>
        <button
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 transition-opacity w-6 h-6 -my-1 inline-flex items-center justify-center rounded-md text-theme-muted hover:text-red-400 hover:bg-red-500/10"
          title="Delete entry"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
      <div className="mt-1 text-[13px] font-semibold text-theme-fg leading-snug">{entry.title}</div>
      {entry.body && (
        <div className="mt-0.5 text-[12px] text-theme-muted whitespace-pre-wrap line-clamp-4">{entry.body}</div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Memory / Notes tab
// ─────────────────────────────────────────────────────────────────────────────

const MEMORY_TYPE_OPTIONS: Array<{ id: MemoryType; label: string }> = [
  { id: 'note', label: 'Note' },
  { id: 'fact', label: 'Fact' },
  { id: 'snippet', label: 'Snippet' },
  { id: 'link', label: 'Link' },
];

const MemoryTab: React.FC<{ project: Project; onCount?: (n: number) => void }> = ({
  project,
  onCount,
}) => {
  const [memories, setMemories] = useState<ProjectMemory[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const list = await listMemories(project.id, 200);
    setMemories(list);
    setLoading(false);
  }, [project.id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    onCount?.(memories.length);
  }, [memories.length, onCount]);

  const handleAdd = useCallback(
    async (input: { type: MemoryType; title?: string; content: string }) => {
      const result = await execTool<{ ok: boolean; memory?: ProjectMemory }>('memory_create', {
        type: input.type,
        title: input.title,
        content: input.content,
        project_ids: [project.id],
        source: 'manual',
        added_by: 'user',
      });
      if (result?.ok && result.memory) {
        setMemories((prev) => [result.memory as ProjectMemory, ...prev]);
      } else {
        void reload();
      }
    },
    [project.id, reload],
  );

  const handleDelete = useCallback(async (id: string) => {
    setMemories((prev) => prev.filter((m) => m.id !== id));
    await execTool('memory_delete', { memory_id: id });
  }, []);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <MemoryComposer onSubmit={handleAdd} />

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-3 pt-1 pb-3 space-y-2">
        {loading && memories.length === 0 ? (
          <PanelStatus label="Loading notes…" inline />
        ) : memories.length === 0 ? (
          <PanelStatus
            icon={<NotebookPen className="w-7 h-7 text-theme-muted/50" />}
            title="No notes yet"
            body="Facts, snippets, links — anything you'll want to recall later. Searchable across sessions. For time-ordered events, use Timeline instead."
          />
        ) : (
          memories.map((m) => <MemoryRow key={m.id} memory={m} onDelete={() => handleDelete(m.id)} />)
        )}
      </div>
    </div>
  );
};

const MemoryComposer: React.FC<{
  onSubmit: (input: { type: MemoryType; title?: string; content: string }) => Promise<void>;
}> = ({ onSubmit }) => {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<MemoryType>('note');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const titleRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      const id = requestAnimationFrame(() => titleRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  const reset = () => {
    setTitle('');
    setContent('');
    setType('note');
  };

  const submit = async () => {
    const trimmedContent = content.trim();
    if (!trimmedContent || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit({ type, title: title.trim() || undefined, content: trimmedContent });
      reset();
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <div className="shrink-0 px-3 pt-3 pb-2">
        <button
          onClick={() => setOpen(true)}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-[14px] bg-theme-card/50 hover:bg-theme-card/80 border border-theme-sidebar hover:border-theme text-left transition-colors"
        >
          <Plus className="w-3.5 h-3.5 text-theme-muted" />
          <span className="text-[12px] text-theme-muted/80">Save a fact, snippet, or link…</span>
        </button>
      </div>
    );
  }

  return (
    <div className="shrink-0 px-3 pt-3 pb-2">
      <div className="rounded-[14px] bg-theme-card/70 border border-theme p-2.5 space-y-2">
        <div className="flex items-center gap-2">
          <TypeSelect value={type} options={MEMORY_TYPE_OPTIONS} onChange={setType} />
          <button
            onClick={() => {
              reset();
              setOpen(false);
            }}
            className="ml-auto w-6 h-6 inline-flex items-center justify-center rounded-md text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60 transition-colors"
            title="Cancel"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <input
          ref={titleRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title (optional)"
          className="w-full px-2 py-1.5 text-[13px] font-semibold bg-transparent text-theme-fg placeholder:text-theme-muted/50 outline-none"
        />
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="Body"
          rows={3}
          className="w-full px-2 py-1.5 text-[12px] bg-transparent text-theme-fg placeholder:text-theme-muted/50 outline-none resize-none"
        />
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-theme-muted/50">Cmd/Ctrl+Enter to save</span>
          <button
            onClick={submit}
            disabled={!content.trim() || submitting}
            className="px-3 py-1 rounded-md text-[11px] font-semibold bg-theme-fg text-theme-bg disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity inline-flex items-center gap-1"
          >
            {submitting && <Loader2 className="w-3 h-3 animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

const MemoryRow: React.FC<{ memory: ProjectMemory; onDelete: () => void }> = ({ memory, onDelete }) => (
  <div className="group px-3 py-2.5 rounded-[14px] bg-theme-card/60 border border-theme-sidebar hover:border-theme transition-colors">
    <div className="flex items-center gap-2">
      <span className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold leading-none bg-theme-hover/60 text-theme-muted">
        {formatTypeLabel(memory.type)}
      </span>
      {memory.pinned && (
        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-semibold leading-none bg-amber-500/10 text-amber-400">
          <Bookmark className="w-2.5 h-2.5" /> Pinned
        </span>
      )}
      <span className="ml-auto text-[10.5px] tabular-nums text-theme-muted/60 truncate">
        {formatRelative(memory.updated_at || memory.created_at)}
      </span>
      <button
        onClick={onDelete}
        className="opacity-0 group-hover:opacity-100 transition-opacity w-6 h-6 -my-1 inline-flex items-center justify-center rounded-md text-theme-muted hover:text-red-400 hover:bg-red-500/10"
        title="Delete note"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
    {memory.title && (
      <div className="mt-1 text-[13px] font-semibold text-theme-fg leading-snug">{memory.title}</div>
    )}
    <div className="mt-0.5 text-[12px] text-theme-muted whitespace-pre-wrap line-clamp-5">{memory.content}</div>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Tasks tab — wired to UnifiedTasks, filtered by projectId
// ─────────────────────────────────────────────────────────────────────────────

const TasksTab: React.FC<{ project: Project; accent: string; onCount?: (n: number) => void }> = ({
  project,
  accent,
  onCount,
}) => {
  const [tasks, setTasks] = useState<UnifiedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const api = (window as any).desktopAPI;
      const res = await api?.unifiedTasksList?.();
      if (res?.ok) {
        const all = (res.tasks || []) as UnifiedTask[];
        setTasks(all.filter((t) => t.projectId === project.id));
      }
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Tabs show open tasks (open is what the user has to do); completed work
  // shows behind the "N completed" disclosure inside the panel.
  const openCount = useMemo(
    () => tasks.filter((t) => t.status !== 'completed').length,
    [tasks],
  );
  useEffect(() => {
    onCount?.(openCount);
  }, [openCount, onCount]);

  useEffect(() => {
    if (composing) {
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [composing]);

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      const api = (window as any).desktopAPI;
      const res = await api?.unifiedTasksAdd?.({
        title: trimmed,
        priority: 'normal',
        showInCalendar: false,
        projectId: project.id,
      });
      if (res?.ok) {
        const all = (res.tasks || []) as UnifiedTask[];
        setTasks(all.filter((t) => t.projectId === project.id));
        setTitle('');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const toggle = async (taskId: string) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? { ...t, status: t.status === 'completed' ? 'pending' : 'completed' }
          : t,
      ),
    );
    const api = (window as any).desktopAPI;
    const res = await api?.unifiedTasksToggleStatus?.(taskId);
    if (res?.ok && Array.isArray(res.tasks)) {
      const all = res.tasks as UnifiedTask[];
      setTasks(all.filter((t) => t.projectId === project.id));
    }
  };

  const remove = async (taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    const api = (window as any).desktopAPI;
    await api?.unifiedTasksDelete?.(taskId);
  };

  const { open, done } = useMemo(() => {
    const open: UnifiedTask[] = [];
    const done: UnifiedTask[] = [];
    for (const t of tasks) {
      if (t.status === 'completed') done.push(t);
      else open.push(t);
    }
    return { open, done };
  }, [tasks]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Composer */}
      <div className="shrink-0 px-3 pt-3 pb-2">
        {!composing ? (
          <button
            onClick={() => setComposing(true)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-[14px] bg-theme-card/50 hover:bg-theme-card/80 border border-theme-sidebar hover:border-theme text-left transition-colors"
          >
            <Plus className="w-3.5 h-3.5 text-theme-muted" />
            <span className="text-[12px] text-theme-muted/80">Add a task…</span>
          </button>
        ) : (
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-[14px] bg-theme-card/70 border border-theme">
            <Circle className="w-3.5 h-3.5 text-theme-muted shrink-0" />
            <input
              ref={inputRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void submit();
                }
                if (e.key === 'Escape') {
                  setComposing(false);
                  setTitle('');
                }
              }}
              placeholder="What needs to happen?"
              className="flex-1 min-w-0 bg-transparent text-[13px] text-theme-fg placeholder:text-theme-muted/50 outline-none"
            />
            <button
              onClick={submit}
              disabled={!title.trim() || submitting}
              className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-theme-fg text-theme-bg disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity inline-flex items-center gap-1"
            >
              {submitting && <Loader2 className="w-3 h-3 animate-spin" />}
              Add
            </button>
            <button
              onClick={() => {
                setComposing(false);
                setTitle('');
              }}
              className="w-6 h-6 inline-flex items-center justify-center rounded-md text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60 transition-colors"
              title="Cancel"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-3 pt-1 pb-3">
        {loading && tasks.length === 0 ? (
          <PanelStatus label="Loading tasks…" inline />
        ) : tasks.length === 0 ? (
          <PanelStatus
            icon={<ListTodo className="w-7 h-7 text-theme-muted/50" />}
            title="No tasks yet"
            body="Capture project-scoped to-dos here. Stuard will also create tasks for you when you mention next steps."
          />
        ) : (
          <div className="space-y-1">
            {open.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                accent={accent}
                onToggle={() => toggle(t.id)}
                onDelete={() => remove(t.id)}
              />
            ))}
            {done.length > 0 && (
              <div className="pt-3">
                <button
                  onClick={() => setShowCompleted((s) => !s)}
                  className="w-full flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-semibold text-theme-muted/70 hover:text-theme-fg hover:bg-theme-hover/40 transition-colors"
                >
                  <ChevronDown
                    className={clsx(
                      'w-3 h-3 transition-transform duration-150',
                      !showCompleted && '-rotate-90',
                    )}
                  />
                  {done.length} completed task{done.length === 1 ? '' : 's'}
                </button>
                {showCompleted && (
                  <div className="mt-1 space-y-1">
                    {done.map((t) => (
                      <TaskRow
                        key={t.id}
                        task={t}
                        accent={accent}
                        onToggle={() => toggle(t.id)}
                        onDelete={() => remove(t.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const TaskRow: React.FC<{
  task: UnifiedTask;
  accent: string;
  onToggle: () => void;
  onDelete: () => void;
}> = ({ task, onToggle, onDelete }) => {
  const completed = task.status === 'completed';
  return (
    <div className="group flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-theme-hover/40 transition-colors">
      <button
        onClick={onToggle}
        className="shrink-0 mt-0.5 w-4 h-4 inline-flex items-center justify-center rounded text-theme-muted hover:text-theme-fg"
        title={completed ? 'Mark not done' : 'Mark complete'}
      >
        {completed ? (
          <CircleCheckBig className="w-4 h-4 text-emerald-500" />
        ) : (
          <Circle className="w-3.5 h-3.5" />
        )}
      </button>
      <div className="flex-1 min-w-0">
        <div
          className={clsx(
            'text-[13px] leading-snug break-words',
            completed ? 'text-theme-muted/70 line-through' : 'text-theme-fg',
          )}
        >
          {task.title}
        </div>
        {task.dueDate && (
          <div className="mt-0.5 text-[10.5px] text-theme-muted/70">
            Due {formatRelative(task.dueDate)}
          </div>
        )}
      </div>
      <button
        onClick={onDelete}
        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity w-6 h-6 inline-flex items-center justify-center rounded-md text-theme-muted hover:text-red-400 hover:bg-red-500/10"
        title="Delete task"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Files tab
// ─────────────────────────────────────────────────────────────────────────────

const InstructionsTab: React.FC<{
  project: Project;
  onProjectChanged?: () => void;
}> = ({ project, onProjectChanged }) => {
  const [draft, setDraft] = useState(project.instructions || '');
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    setDraft(project.instructions || '');
    setSavedAt(null);
  }, [project.id, project.instructions]);

  const dirty = draft !== (project.instructions || '');

  const save = useCallback(async () => {
    if (!dirty || busy) return;
    setBusy(true);
    try {
      const updated = await updateProject(project.id, { instructions: draft.trim() });
      if (updated) {
        setSavedAt(Date.now());
        onProjectChanged?.();
      }
    } finally {
      setBusy(false);
    }
  }, [busy, dirty, draft, project.id, onProjectChanged]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="shrink-0 px-3 pt-3 pb-2 border-b border-theme-sidebar">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-[12px] font-bold text-theme-fg">Project instructions</h3>
            <p className="mt-0.5 text-[11px] text-theme-muted/70">
              Persistent behavior, sources, formats, and constraints for every chat in this project.
            </p>
          </div>
          <button
            onClick={() => void save()}
            disabled={!dirty || busy}
            className="shrink-0 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-theme-fg text-theme-bg disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity inline-flex items-center gap-1"
          >
            {busy && <Loader2 className="w-3 h-3 animate-spin" />}
            Save
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 p-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void save()}
          placeholder="Examples: Always check attached project files before answering. Prefer concise implementation notes. Cite source files when making claims."
          className="w-full h-full resize-none rounded-[14px] bg-theme-card/60 border border-theme focus:border-primary/30 px-3 py-2 text-[12.5px] leading-relaxed text-theme-fg placeholder:text-theme-muted/45 outline-none custom-scrollbar"
        />
      </div>

      <div className="shrink-0 px-3 pb-3 min-h-[24px] text-[10.5px] text-theme-muted/60">
        {dirty ? 'Unsaved changes' : savedAt ? 'Saved' : 'Used automatically in Project Mode'}
      </div>
    </div>
  );
};

const FilesTab: React.FC<{
  project: Project;
  onProjectChanged?: () => void;
  onCount?: (n: number) => void;
}> = ({ project, onProjectChanged, onCount }) => {
  const [paths, setPaths] = useState<string[]>(project.pinned_paths || []);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Re-sync if the parent prop changes (e.g. AI tool attached context).
  useEffect(() => {
    setPaths(project.pinned_paths || []);
  }, [project.id, project.pinned_paths]);

  useEffect(() => {
    onCount?.(paths.length);
  }, [paths.length, onCount]);

  useEffect(() => {
    if (composing) {
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [composing]);

  const persist = useCallback(
    async (next: string[]) => {
      setPaths(next);
      setBusy(true);
      try {
        const updated = await updateProject(project.id, { pinned_paths: next });
        if (updated?.pinned_paths) setPaths(updated.pinned_paths);
        onProjectChanged?.();
      } finally {
        setBusy(false);
      }
    },
    [project.id, onProjectChanged],
  );

  const attachPath = useCallback(async (rawPath: string) => {
    const trimmed = rawPath.trim();
    if (!trimmed || busy) return;
    if (paths.includes(trimmed)) {
      setDraft('');
      setComposing(false);
      return;
    }
    setBusy(true);
    try {
      const result = await addProjectContextPath(project.id, trimmed);
      if (result.error) {
        console.warn('[projects] failed to add context path:', result.error);
        return;
      }
      if (result.project?.pinned_paths) {
        setPaths(result.project.pinned_paths);
      } else {
        setPaths([...paths, trimmed]);
      }
      onProjectChanged?.();
      setDraft('');
      setComposing(false);
    } finally {
      setBusy(false);
    }
  }, [busy, paths, project.id, onProjectChanged]);

  const submit = useCallback(async () => {
    await attachPath(draft);
  }, [attachPath, draft]);

  const pickFiles = useCallback(async () => {
    const api = (window as any).desktopAPI;
    const result = await api?.pickFiles?.({ multiple: true, title: 'Add files to project context' });
    const picked = Array.isArray(result?.files) ? result.files.map((file: any) => file.path).filter(Boolean) : [];
    for (const filePath of picked) await attachPath(filePath);
  }, [attachPath]);

  const pickFolders = useCallback(async () => {
    const api = (window as any).desktopAPI;
    const result = await api?.pickFolder?.({ multiple: true, title: 'Add folders to project context' });
    const picked = Array.isArray(result?.folders) ? result.folders.map((folder: any) => folder.path).filter(Boolean) : [];
    for (const folderPath of picked) await attachPath(folderPath);
  }, [attachPath]);

  const remove = useCallback(
    async (path: string) => {
      await persist(paths.filter((p) => p !== path));
    },
    [paths, persist],
  );

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="shrink-0 px-3 pt-3 pb-2">
        {!composing ? (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setComposing(true)}
              className="flex-1 min-w-0 flex items-center gap-2 px-3 py-2 rounded-[14px] bg-theme-card/50 hover:bg-theme-card/80 border border-theme-sidebar hover:border-theme text-left transition-colors"
            >
              <Plus className="w-3.5 h-3.5 text-theme-muted" />
              <span className="text-[12px] text-theme-muted/80 truncate">Add file or folder context...</span>
            </button>
            <button
              onClick={() => void pickFiles()}
              disabled={busy}
              className="w-8 h-8 inline-flex items-center justify-center rounded-[14px] bg-theme-card/50 hover:bg-theme-card/80 border border-theme-sidebar hover:border-theme text-theme-muted hover:text-theme-fg disabled:opacity-40"
              title="Choose files"
            >
              <FileText className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => void pickFolders()}
              disabled={busy}
              className="w-8 h-8 inline-flex items-center justify-center rounded-[14px] bg-theme-card/50 hover:bg-theme-card/80 border border-theme-sidebar hover:border-theme text-theme-muted hover:text-theme-fg disabled:opacity-40"
              title="Choose folders"
            >
              <FolderOpen className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-[14px] bg-theme-card/70 border border-theme">
            <FileText className="w-3.5 h-3.5 text-theme-muted shrink-0" />
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void submit();
                }
                if (e.key === 'Escape') {
                  setComposing(false);
                  setDraft('');
                }
              }}
              placeholder="Absolute file or folder path..."
              className="flex-1 min-w-0 bg-transparent text-[12px] font-mono text-theme-fg placeholder:text-theme-muted/50 outline-none"
            />
            <button
              onClick={submit}
              disabled={!draft.trim() || busy}
              className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-theme-fg text-theme-bg disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity inline-flex items-center gap-1"
            >
              {busy && <Loader2 className="w-3 h-3 animate-spin" />}
              Add
            </button>
            <button
              onClick={() => {
                setComposing(false);
                setDraft('');
              }}
              className="w-6 h-6 inline-flex items-center justify-center rounded-md text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60 transition-colors"
              title="Cancel"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      <div className="shrink-0 px-3 pb-2">
        <NotionSyncCard project={project} onProjectChanged={onProjectChanged} />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-3 pt-1 pb-3 space-y-1">
        {paths.length === 0 ? (
          <PanelStatus
            icon={<FileText className="w-7 h-7 text-theme-muted/50" />}
            title="No context files or folders"
            body="Add files or folders to make them searchable project context."
          />
        ) : (
          paths.map((path) => {
            const trimmed = path.replace(/[\\/]+$/, '');
            const name = trimmed.split(/[\\/]/).pop() || path;
            const looksLikeFolder = !/\.[A-Za-z0-9]{1,8}$/.test(name);
            const Icon = looksLikeFolder ? FolderOpen : FileText;
            return (
              <div
                key={path}
                className="group flex items-center gap-2.5 px-3 py-2 rounded-[14px] bg-theme-card/60 border border-theme-sidebar hover:border-theme transition-colors"
              >
                <Icon className="w-3.5 h-3.5 shrink-0 text-theme-muted" />
                <span className="flex-1 min-w-0" title={path}>
                  <span className="block truncate text-[12.5px] font-medium text-theme-fg/90">
                    {name}
                  </span>
                  <span
                    className="block truncate text-[10.5px] font-mono text-theme-muted/60"
                    style={{ direction: 'rtl', textAlign: 'left' }}
                  >
                    {path}
                  </span>
                </span>
                <button
                  onClick={() => void remove(path)}
                  disabled={busy}
                  className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity w-6 h-6 inline-flex items-center justify-center rounded-md text-theme-muted hover:text-red-400 hover:bg-red-500/10 disabled:opacity-30"
                  title="Remove context path"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Notion sync card (Files tab)
// ─────────────────────────────────────────────────────────────────────────────

const NotionSyncCard: React.FC<{
  project: Project;
  onProjectChanged?: () => void;
}> = ({ project, onProjectChanged }) => {
  const [notion, setNotion] = useState<ProjectNotionSettings | null>(
    project.settings?.notion?.page_id || project.settings?.notion?.database_id
      ? (project.settings!.notion as ProjectNotionSettings)
      : null,
  );
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<NotionSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const settings = project.settings?.notion;
    setNotion(settings?.page_id || settings?.database_id ? (settings as ProjectNotionSettings) : null);
    setPicking(false);
    setQuery('');
    setResults([]);
    setSearchError(null);
  }, [project.id, project.settings]);

  useEffect(() => {
    if (picking) {
      const id = requestAnimationFrame(() => searchRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [picking]);

  // Debounced search while the picker is open.
  useEffect(() => {
    if (!picking) return;
    const id = setTimeout(async () => {
      setSearching(true);
      setSearchError(null);
      const res = await searchNotionTargets(query.trim());
      setSearching(false);
      if (res.ok) {
        setResults(res.results);
      } else {
        setResults([]);
        setSearchError(
          res.error === 'notion_not_connected'
            ? 'Notion isn\u2019t connected. Connect it in Integrations first.'
            : res.error || 'Search failed',
        );
      }
    }, query ? 350 : 0);
    return () => clearTimeout(id);
  }, [picking, query]);

  const refreshFromProject = useCallback(async () => {
    const fresh = await getProject(project.id);
    const settings = fresh?.settings?.notion;
    setNotion(settings?.page_id || settings?.database_id ? (settings as ProjectNotionSettings) : null);
    onProjectChanged?.();
  }, [project.id, onProjectChanged]);

  const handleLink = useCallback(async (target: NotionSearchResult) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await linkProjectNotion(project.id, target);
      if (res.ok) {
        setPicking(false);
        setQuery('');
        setResults([]);
        await refreshFromProject();
      } else {
        setSearchError(res.error || 'Failed to link');
      }
    } finally {
      setBusy(false);
    }
  }, [busy, project.id, refreshFromProject]);

  const handleUnlink = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await unlinkProjectNotion(project.id);
      await refreshFromProject();
    } finally {
      setBusy(false);
    }
  }, [busy, project.id, refreshFromProject]);

  const handleTogglePush = useCallback(async () => {
    if (!notion || busy) return;
    const next = !notion.push_enabled;
    setNotion({ ...notion, push_enabled: next });
    await updateProjectNotion(project.id, { push_enabled: next });
    onProjectChanged?.();
  }, [busy, notion, project.id, onProjectChanged]);

  const handleSyncNow = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await syncProjectNotionNow(project.id);
      await refreshFromProject();
    } finally {
      setSyncing(false);
    }
  }, [syncing, project.id, refreshFromProject]);

  // ── Unlinked: quiet inline affordance ──────────────────────────────────────
  if (!notion) {
    if (!picking) {
      return (
        <button
          onClick={() => setPicking(true)}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-[14px] bg-theme-card/40 hover:bg-theme-card/70 border border-theme-sidebar hover:border-theme text-left transition-colors"
        >
          <Link2 className="w-3.5 h-3.5 text-theme-muted" />
          <span className="text-[12px] text-theme-muted/80">Sync a Notion page or database…</span>
        </button>
      );
    }
    return (
      <div className="rounded-[14px] bg-theme-card/70 border border-theme p-2.5 space-y-2">
        <div className="flex items-center gap-2">
          <Search className="w-3.5 h-3.5 text-theme-muted shrink-0" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setPicking(false);
                setQuery('');
              }
            }}
            placeholder="Search your Notion pages and databases…"
            className="flex-1 min-w-0 bg-transparent text-[12.5px] text-theme-fg placeholder:text-theme-muted/50 outline-none"
          />
          {searching && <Loader2 className="w-3.5 h-3.5 animate-spin text-theme-muted shrink-0" />}
          <button
            onClick={() => {
              setPicking(false);
              setQuery('');
            }}
            className="w-6 h-6 inline-flex items-center justify-center rounded-md text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60 transition-colors"
            title="Cancel"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        {searchError ? (
          <div className="px-1 pb-1 text-[11px] text-amber-400/90">{searchError}</div>
        ) : results.length > 0 ? (
          <div className="max-h-44 overflow-y-auto custom-scrollbar space-y-0.5">
            {results.map((r) => (
              <button
                key={r.id}
                onClick={() => void handleLink(r)}
                disabled={busy}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left hover:bg-theme-hover/50 transition-colors disabled:opacity-50"
              >
                <span className="shrink-0 text-[13px] leading-none" aria-hidden>
                  {r.icon || '📄'}
                </span>
                <span className="flex-1 min-w-0 text-[12px] text-theme-fg truncate">{r.title}</span>
                <span className="shrink-0 px-1.5 py-0.5 rounded-md text-[9.5px] font-semibold uppercase tracking-wide bg-theme-hover/60 text-theme-muted">
                  {r.type}
                </span>
              </button>
            ))}
          </div>
        ) : !searching ? (
          <div className="px-1 pb-1 text-[11px] text-theme-muted/60">
            Pulled content lands in this project's Notes and stays searchable.
          </div>
        ) : null}
      </div>
    );
  }

  // ── Linked: status + controls ──────────────────────────────────────────────
  const isPage = !!notion.page_id;
  const lastSynced = notion.last_synced_at ? formatRelative(notion.last_synced_at) : null;

  return (
    <div className="rounded-[14px] bg-theme-card/60 border border-theme-sidebar p-2.5">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-[14px] leading-none" aria-hidden>
          {notion.icon || '🗒️'}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[12.5px] font-semibold text-theme-fg truncate">
              {notion.title || 'Notion'}
            </span>
            <span className="shrink-0 px-1.5 py-0.5 rounded-md text-[9.5px] font-semibold uppercase tracking-wide bg-theme-hover/60 text-theme-muted">
              {isPage ? 'Page' : 'Database'}
            </span>
          </div>
          <div className="text-[10.5px] text-theme-muted/70 truncate">
            {notion.last_error
              ? `Sync issue: ${notion.last_error}`
              : lastSynced
                ? `Notion · synced ${lastSynced}`
                : 'Notion · first sync pending'}
          </div>
        </div>
        <button
          onClick={() => void handleSyncNow()}
          disabled={syncing}
          className="shrink-0 w-7 h-7 inline-flex items-center justify-center rounded-md text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60 transition-colors disabled:opacity-50"
          title="Sync now"
        >
          <RefreshCw className={clsx('w-3.5 h-3.5', syncing && 'animate-spin')} />
        </button>
        {notion.url && (
          <button
            onClick={() => void (window as any).desktopAPI?.openExternal?.(notion.url)}
            className="shrink-0 w-7 h-7 inline-flex items-center justify-center rounded-md text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60 transition-colors"
            title="Open in Notion"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          onClick={() => void handleUnlink()}
          disabled={busy}
          className="shrink-0 w-7 h-7 inline-flex items-center justify-center rounded-md text-theme-muted hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
          title="Unlink and remove synced notes"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {isPage && (
        <label className="mt-2 flex items-center gap-2 px-1 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={!!notion.push_enabled}
            onChange={() => void handleTogglePush()}
            className="w-3 h-3 accent-current"
          />
          <span className="text-[11px] text-theme-muted">
            Also push this project's timeline to the Notion page
          </span>
        </label>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared bits
// ─────────────────────────────────────────────────────────────────────────────

function TypeSelect<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ id: T; label: string }>;
  onChange: (next: T) => void;
}) {
  return (
    <div className="relative inline-flex">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="appearance-none pr-6 pl-2 py-1 rounded-md text-[11px] font-semibold bg-theme-hover/60 text-theme-muted hover:text-theme-fg outline-none cursor-pointer transition-colors"
      >
        {options.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 w-3 h-3 text-theme-muted" />
    </div>
  );
}

const PanelStatus: React.FC<{
  icon?: React.ReactNode;
  label?: string;
  title?: string;
  body?: string;
  inline?: boolean;
}> = ({ icon, label, title, body, inline }) =>
  inline ? (
    <div className="py-8 text-center text-[11px] text-theme-muted/70">{label}</div>
  ) : (
    <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center select-none">
      {icon && (
        <span className="launcher-suggestion-chip__icon flex h-14 w-14 items-center justify-center rounded-[18px] border border-theme/15">
          {icon}
        </span>
      )}
      {label && <p className="text-[12px] text-theme-muted/70">{label}</p>}
      {title && <p className="text-[16px] font-semibold tracking-tight text-theme-fg leading-tight">{title}</p>}
      {body && <p className="text-[12.5px] leading-relaxed text-theme-muted max-w-[320px]">{body}</p>}
    </div>
  );

// Turn an enum-style value into a human label: "chat_summary" → "Chat summary".
function formatTypeLabel(value: string): string {
  if (!value) return '';
  const spaced = value.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function formatRelative(iso: string): string {
  if (!iso) return '';
  try {
    const then = new Date(iso).getTime();
    const now = Date.now();
    const diff = Math.max(0, now - then);
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return iso.slice(0, 10);
  }
}

export default ProjectHomeView;
