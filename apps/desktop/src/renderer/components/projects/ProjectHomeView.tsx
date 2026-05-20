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
  Activity,
  ArrowLeft,
  Bookmark,
  CheckSquare,
  ChevronDown,
  Circle,
  CircleCheckBig,
  FileText,
  Loader2,
  Plus,
  StickyNote,
  Tag as TagIcon,
  Trash2,
  X,
} from 'lucide-react';
import {
  listJournal,
  listMemories,
  type JournalEntry,
  type JournalEntryType,
  type MemoryType,
  type Project,
  type ProjectMemory,
} from '../../hooks/useProjects';
import type { UnifiedTask } from '../../types/tasks';

type TabId = 'timeline' | 'tasks' | 'memory' | 'files';

interface ProjectHomeViewProps {
  project: Project;
  onProjectChanged?: () => void;
  onBack?: () => void;
}

const TABS: Array<{ id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'timeline', label: 'Timeline', icon: Activity },
  { id: 'tasks', label: 'Tasks', icon: CheckSquare },
  { id: 'memory', label: 'Notes', icon: StickyNote },
  { id: 'files', label: 'Files', icon: FileText },
];

const NARROW_TAB_BREAKPOINT = 360; // icon-only tabs below this width

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

export const ProjectHomeView: React.FC<ProjectHomeViewProps> = ({ project, onBack }) => {
  const [tab, setTab] = useState<TabId>('timeline');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number>(0);

  // Reset tab when switching projects so each opens cleanly on the timeline.
  useEffect(() => {
    setTab('timeline');
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

      <ProjectHeader project={project} onBack={onBack} accent={accent} />

      <div className="shrink-0 flex items-stretch gap-0 px-1.5 border-b border-theme/5">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              title={t.label}
              className={clsx(
                'relative flex items-center justify-center gap-1.5 px-2.5 py-2 text-[12px] font-medium transition-colors whitespace-nowrap',
                active ? 'text-theme-fg' : 'text-theme-muted/80 hover:text-theme-fg',
              )}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              {!tabsCompact && <span>{t.label}</span>}
              {active && (
                <span
                  className="absolute left-1.5 right-1.5 -bottom-px h-[2px] rounded-full"
                  style={{ backgroundColor: accent }}
                />
              )}
            </button>
          );
        })}
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === 'timeline' && <TimelineTab project={project} />}
        {tab === 'tasks' && <TasksTab project={project} accent={accent} />}
        {tab === 'memory' && <MemoryTab project={project} />}
        {tab === 'files' && <FilesTab project={project} />}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Header
// ─────────────────────────────────────────────────────────────────────────────

const ProjectHeader: React.FC<{ project: Project; onBack?: () => void; accent: string }> = ({
  project,
  onBack,
  accent,
}) => (
  <div className="shrink-0 px-3 pt-3 pb-2.5 border-b border-theme/5">
    <div className="flex items-start gap-2.5">
      {onBack && (
        <button
          onClick={onBack}
          className="shrink-0 w-7 h-7 mt-0.5 flex items-center justify-center rounded-lg text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60 transition-colors"
          title="Back to projects"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
        </button>
      )}
      <span
        className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-lg ring-1 ring-inset"
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
        <div className="flex items-center gap-1.5 flex-wrap">
          <h2 className="text-[15px] font-bold text-theme-fg truncate min-w-0 max-w-full">
            {project.name}
          </h2>
          {project.status && project.status !== 'active' && (
            <span
              className={clsx(
                'shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider leading-none',
                project.status === 'paused' && 'bg-amber-500/10 text-amber-500',
                project.status === 'archived' && 'bg-zinc-500/10 text-zinc-500',
              )}
            >
              {project.status}
            </span>
          )}
        </div>
        {project.description && (
          <p className="mt-0.5 text-[12px] text-theme-muted line-clamp-2 break-words">
            {project.description}
          </p>
        )}
        {project.tags && project.tags.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <TagIcon className="w-3 h-3 text-theme-muted/60 shrink-0" />
            {project.tags.slice(0, 6).map((tag) => (
              <span
                key={tag}
                className="px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-theme-hover/60 text-theme-muted truncate max-w-[120px]"
              >
                {tag}
              </span>
            ))}
            {project.tags.length > 6 && (
              <span className="text-[10px] text-theme-muted/60">+{project.tags.length - 6}</span>
            )}
          </div>
        )}
      </div>
    </div>
  </div>
);

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

const JOURNAL_TYPE_OPTIONS: Array<{ id: JournalEntryType; label: string }> = [
  { id: 'note', label: 'Note' },
  { id: 'finding', label: 'Finding' },
  { id: 'question', label: 'Question' },
  { id: 'hypothesis', label: 'Hypothesis' },
  { id: 'decision', label: 'Decision' },
  { id: 'blocker', label: 'Blocker' },
  { id: 'edit', label: 'Edit' },
  { id: 'milestone', label: 'Milestone' },
];

const TimelineTab: React.FC<{ project: Project }> = ({ project }) => {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const list = await listJournal(project.id, 100);
    setEntries(list);
    setLoading(false);
  }, [project.id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleAdd = useCallback(
    async (input: { type: JournalEntryType; title: string; body?: string }) => {
      const result = await execTool<{ ok: boolean; entry?: JournalEntry }>('journal_add', {
        project_id: project.id,
        type: input.type,
        title: input.title,
        body: input.body,
        source: 'user',
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

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <JournalComposer onSubmit={handleAdd} />

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-3 pt-1 pb-3 space-y-2">
        {loading && entries.length === 0 ? (
          <PanelStatus label="Loading timeline…" inline />
        ) : entries.length === 0 ? (
          <PanelStatus
            icon={<Activity className="w-7 h-7 text-theme-muted/50" />}
            title="No journal entries yet"
            body="Add a quick note above, or let Stuard record decisions, findings, and milestones as you work."
          />
        ) : (
          entries.map((entry) => (
            <JournalRow key={entry.id} entry={entry} onDelete={() => handleDelete(entry.id)} />
          ))
        )}
      </div>
    </div>
  );
};

const JournalComposer: React.FC<{
  onSubmit: (input: { type: JournalEntryType; title: string; body?: string }) => Promise<void>;
}> = ({ onSubmit }) => {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<JournalEntryType>('note');
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
    setType('note');
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
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-theme-card/50 hover:bg-theme-card/80 border border-theme/5 hover:border-theme/15 text-left transition-colors"
        >
          <Plus className="w-3.5 h-3.5 text-theme-muted" />
          <span className="text-[12px] text-theme-muted/80">Add to timeline…</span>
        </button>
      </div>
    );
  }

  return (
    <div className="shrink-0 px-3 pt-3 pb-2">
      <div className="rounded-lg bg-theme-card/70 border border-theme/15 p-2.5 space-y-2">
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
    <div className="group px-3 py-2.5 rounded-lg bg-theme-card/60 border border-theme/5 hover:border-theme/15 transition-colors">
      <div className="flex items-center gap-2">
        <span className={clsx('px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider', badge)}>
          {entry.type}
        </span>
        <span className="text-[11px] text-theme-muted/70">{when}</span>
        <button
          onClick={onDelete}
          className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity w-6 h-6 inline-flex items-center justify-center rounded-md text-theme-muted hover:text-red-400 hover:bg-red-500/10"
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

const MemoryTab: React.FC<{ project: Project }> = ({ project }) => {
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

  const handleAdd = useCallback(
    async (input: { type: MemoryType; title?: string; content: string }) => {
      const result = await execTool<{ ok: boolean; memory?: ProjectMemory }>('memory_create', {
        type: input.type,
        title: input.title,
        content: input.content,
        project_ids: [project.id],
        source: 'user',
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
            icon={<StickyNote className="w-7 h-7 text-theme-muted/50" />}
            title="No notes yet"
            body="Save snippets, facts, or links here. They're searchable across sessions."
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
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-theme-card/50 hover:bg-theme-card/80 border border-theme/5 hover:border-theme/15 text-left transition-colors"
        >
          <Plus className="w-3.5 h-3.5 text-theme-muted" />
          <span className="text-[12px] text-theme-muted/80">Save a note…</span>
        </button>
      </div>
    );
  }

  return (
    <div className="shrink-0 px-3 pt-3 pb-2">
      <div className="rounded-lg bg-theme-card/70 border border-theme/15 p-2.5 space-y-2">
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
  <div className="group px-3 py-2.5 rounded-lg bg-theme-card/60 border border-theme/5 hover:border-theme/15 transition-colors">
    <div className="flex items-center gap-2">
      <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider bg-theme-hover/60 text-theme-muted">
        {memory.type}
      </span>
      {memory.pinned && (
        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-400">
          <Bookmark className="w-2.5 h-2.5" /> Pinned
        </span>
      )}
      <button
        onClick={onDelete}
        className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity w-6 h-6 inline-flex items-center justify-center rounded-md text-theme-muted hover:text-red-400 hover:bg-red-500/10"
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

const TasksTab: React.FC<{ project: Project; accent: string }> = ({ project, accent }) => {
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
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-theme-card/50 hover:bg-theme-card/80 border border-theme/5 hover:border-theme/15 text-left transition-colors"
          >
            <Plus className="w-3.5 h-3.5 text-theme-muted" />
            <span className="text-[12px] text-theme-muted/80">Add a task…</span>
          </button>
        ) : (
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-theme-card/70 border border-theme/15">
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
            icon={<CheckSquare className="w-7 h-7 text-theme-muted/50" />}
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
                  className="w-full flex items-center gap-1.5 px-2 py-1 rounded-md text-[10.5px] uppercase tracking-wider font-bold text-theme-muted/70 hover:text-theme-fg hover:bg-theme-hover/40 transition-colors"
                >
                  <ChevronDown
                    className={clsx(
                      'w-3 h-3 transition-transform duration-150',
                      !showCompleted && '-rotate-90',
                    )}
                  />
                  {done.length} completed
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

const FilesTab: React.FC<{ project: Project }> = ({ project }) => {
  const paths = project.pinned_paths || [];
  if (paths.length === 0) {
    return (
      <div className="h-full overflow-y-auto custom-scrollbar p-3">
        <PanelStatus
          icon={<FileText className="w-7 h-7 text-theme-muted/50" />}
          title="No pinned files"
          body="Pin files to this project to surface them here."
        />
      </div>
    );
  }
  return (
    <div className="h-full overflow-y-auto custom-scrollbar p-3 space-y-1">
      {paths.map((path) => (
        <div
          key={path}
          className="px-3 py-2 rounded-lg bg-theme-card/60 border border-theme/5 text-[12.5px] font-mono text-theme-fg/90 truncate"
          title={path}
        >
          {path}
        </div>
      ))}
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
        className="appearance-none pr-6 pl-2 py-1 rounded-md text-[10.5px] font-bold uppercase tracking-wider bg-theme-hover/60 text-theme-muted outline-none cursor-pointer"
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
    <div className="flex flex-col items-center justify-center h-full gap-3 p-8 text-center">
      {icon && <div className="p-3 rounded-2xl bg-theme-hover/50">{icon}</div>}
      {label && <p className="text-[12px] text-theme-muted/70">{label}</p>}
      {title && <p className="text-sm font-semibold text-theme-muted">{title}</p>}
      {body && <p className="text-xs text-theme-muted/60 max-w-[320px]">{body}</p>}
    </div>
  );

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
