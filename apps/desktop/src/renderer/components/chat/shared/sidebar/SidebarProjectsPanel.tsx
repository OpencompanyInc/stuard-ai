import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import clsx from 'clsx';
import { FolderKanban, FolderOpen, Loader2, Plus, RefreshCw, Search, X } from 'lucide-react';
import {
  createProject,
  useProjects,
  type Project,
  type ProjectStatus,
} from '../../../../hooks/useProjects';
import { ProjectHomeView } from '../../../projects/ProjectHomeView';

interface SidebarProjectsPanelProps {
  className?: string;
}

const STATUS_COLOR: Record<ProjectStatus, string> = {
  active: 'bg-emerald-500',
  paused: 'bg-amber-500',
  archived: 'bg-zinc-500',
};

const LIST_MIN_WIDTH = 200;
const LIST_MAX_WIDTH = 420;
const STACK_BREAKPOINT = 540;
const LIST_WIDTH_KEY = 'sidebar.projects.listWidth';

export const SidebarProjectsPanel: React.FC<SidebarProjectsPanelProps> = ({ className }) => {
  const { projects, loading, error, reload } = useProjects(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [listWidth, setListWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return 260;
    const stored = parseInt(window.localStorage?.getItem(LIST_WIDTH_KEY) || '', 10);
    return Number.isFinite(stored) && stored >= LIST_MIN_WIDTH && stored <= LIST_MAX_WIDTH
      ? stored
      : 260;
  });

  // Track our own container width so the layout collapses to stacked mode
  // when the user shrinks the parent (chat-embedded sidebar, narrow window).
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    setContainerWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => {
      const hay = [p.name, p.description, p.goals, p.instructions, p.tags?.join(' ')]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [projects, query]);

  const selected = useMemo(
    () => projects.find((p) => p.id === selectedId) ?? null,
    [projects, selectedId],
  );

  // When the container is too narrow to comfortably show both panes side-by-
  // side, switch to a stacked view: list or home, never both. The back button
  // on the home view returns to the list.
  const stacked = containerWidth > 0 && containerWidth < STACK_BREAKPOINT;
  const showList = !stacked || !selected;
  const showHome = !stacked || !!selected;

  // Clamp the list width so it can never exceed what the container can hold.
  // In split mode we reserve at least 280px for the home panel.
  const effectiveListWidth = useMemo(() => {
    if (stacked) return containerWidth; // fills the whole pane when stacked
    if (containerWidth <= 0) return Math.min(listWidth, LIST_MAX_WIDTH);
    const max = Math.max(LIST_MIN_WIDTH, Math.min(LIST_MAX_WIDTH, containerWidth - 280));
    return Math.min(Math.max(listWidth, LIST_MIN_WIDTH), max);
  }, [listWidth, containerWidth, stacked]);

  const persistListWidth = useCallback((px: number) => {
    setListWidth(px);
    try {
      window.localStorage?.setItem(LIST_WIDTH_KEY, String(px));
    } catch { /* ignore */ }
  }, []);

  return (
    <div ref={containerRef} className={clsx('relative flex w-full h-full overflow-hidden', className)}>
      {showList && (
        <ProjectsList
          projects={filtered}
          loading={loading}
          error={error}
          selectedId={selectedId}
          onSelect={setSelectedId}
          query={query}
          onQueryChange={setQuery}
          onReload={reload}
          onCreated={(id) => {
            setSelectedId(id);
            void reload();
          }}
          width={effectiveListWidth}
          fill={stacked}
        />
      )}

      {!stacked && (
        <ResizeHandle
          onResize={(deltaX) => {
            const next = Math.max(
              LIST_MIN_WIDTH,
              Math.min(LIST_MAX_WIDTH, Math.min(effectiveListWidth + deltaX, containerWidth - 280)),
            );
            persistListWidth(next);
          }}
        />
      )}

      {showHome && (
        <div className="flex-1 min-w-0 min-h-0 overflow-hidden bg-theme-bg/40">
          {selected ? (
            <ProjectHomeView
              project={selected}
              onProjectChanged={reload}
              onBack={stacked ? () => setSelectedId(null) : undefined}
            />
          ) : (
            <EmptyState count={projects.length} />
          )}
        </div>
      )}
    </div>
  );
};

interface ProjectsListProps {
  projects: Project[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  query: string;
  onQueryChange: (q: string) => void;
  onReload: () => void;
  onCreated: (projectId: string) => void;
  width: number;
  fill: boolean;
}

const ProjectsList: React.FC<ProjectsListProps> = ({
  projects,
  loading,
  error,
  selectedId,
  onSelect,
  query,
  onQueryChange,
  onReload,
  onCreated,
  width,
  fill,
}) => {
  const [composing, setComposing] = useState(false);

  return (
    <div
      className={clsx(
        'flex flex-col h-full min-h-0',
        fill ? 'w-full' : 'shrink-0 border-r border-theme-sidebar',
      )}
      style={fill ? undefined : { width, minWidth: width }}
    >
      <div className="shrink-0 p-2.5 flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-theme-muted/60 pointer-events-none" strokeWidth={1.75} />
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search projects"
            className="w-full pl-8 pr-3 py-2 text-[12px] rounded-[12px] bg-theme-hover/50 border border-theme/10 placeholder:text-theme-muted/50 text-theme-fg outline-none focus:bg-theme-hover/80 focus:border-primary/30 transition-colors"
          />
        </div>
        <button
          onClick={() => setComposing(true)}
          className="shrink-0 w-8 h-8 flex items-center justify-center rounded-[11px] text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60 transition-colors"
          title="New project"
        >
          <Plus className="w-4 h-4" strokeWidth={1.75} />
        </button>
        <button
          onClick={onReload}
          className="shrink-0 w-8 h-8 flex items-center justify-center rounded-[11px] text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60 transition-colors"
          title="Refresh"
        >
          <RefreshCw className={clsx('w-3.5 h-3.5', loading && 'animate-spin')} strokeWidth={1.75} />
        </button>
      </div>

      {composing && (
        <NewProjectComposer
          onCancel={() => setComposing(false)}
          onCreated={(id) => {
            setComposing(false);
            onCreated(id);
          }}
        />
      )}

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-1.5">
        {loading && projects.length === 0 && (
          <div className="p-3 text-[11px] text-theme-muted/60">Loading…</div>
        )}
        {error && (
          <div className="m-1.5 p-2 rounded-lg bg-red-500/10 text-red-500 text-[11px]">
            {error}
          </div>
        )}
        {!loading && !error && projects.length === 0 && !composing && (
          <button
            onClick={() => setComposing(true)}
            className="launcher-suggestion-chip group m-1 flex w-[calc(100%-0.5rem)] items-start gap-3 p-3 rounded-[14px] text-left transition-[background-color,border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 active:scale-[0.995]"
          >
            <span className="launcher-suggestion-chip__icon flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] border border-theme/15">
              <Plus className="h-4 w-4 text-theme-muted group-hover:text-primary transition-colors" strokeWidth={1.75} />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-[12.5px] font-semibold text-theme-fg">Create your first project</span>
              <span className="mt-1 block text-[11px] text-theme-muted/70 leading-snug">
                Each project keeps its own instructions, knowledge, files, tasks, and timeline. Stuard can capture them as you chat.
              </span>
            </span>
          </button>
        )}
        {projects.map((p) => (
          <ProjectRow
            key={p.id}
            project={p}
            active={selectedId === p.id}
            onSelect={() => onSelect(p.id)}
          />
        ))}
      </div>
    </div>
  );
};

const NewProjectComposer: React.FC<{
  onCancel: () => void;
  onCreated: (projectId: string) => void;
}> = ({ onCancel, onCreated }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => nameRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const project = await createProject({
        name: trimmed,
        description: description.trim() || undefined,
        instructions: instructions.trim() || undefined,
      });
      if (project?.id) {
        onCreated(project.id);
      } else {
        setError('Failed to create project');
      }
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="shrink-0 px-2.5 pt-2.5 pb-2">
      <div className="rounded-[14px] bg-theme-card/80 border border-theme/15 p-2.5 space-y-2 shadow-[var(--compact-pill-shadow)]">
        <div className="flex items-center justify-between">
          <span className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-theme-muted">
            New project
          </span>
          <button
            onClick={onCancel}
            className="w-6 h-6 inline-flex items-center justify-center rounded-[8px] text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60 transition-colors"
            title="Cancel"
          >
            <X className="w-3.5 h-3.5" strokeWidth={1.75} />
          </button>
        </div>
        <input
          ref={nameRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
            if (e.key === 'Escape') onCancel();
          }}
          placeholder="Project name"
          className="w-full px-2 py-1.5 text-[13px] font-semibold bg-transparent text-theme-fg placeholder:text-theme-muted/50 outline-none"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              void submit();
            }
            if (e.key === 'Escape') onCancel();
          }}
          placeholder="One-line description (optional)"
          rows={2}
          className="w-full px-2 py-1.5 text-[12px] bg-transparent text-theme-fg placeholder:text-theme-muted/50 outline-none resize-none"
        />
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              void submit();
            }
            if (e.key === 'Escape') onCancel();
          }}
          placeholder="Project instructions (optional)"
          rows={3}
          className="w-full px-2 py-1.5 text-[12px] bg-theme-hover/35 rounded-[10px] text-theme-fg placeholder:text-theme-muted/50 outline-none resize-none"
        />
        {error && (
          <div className="px-2 py-1 rounded-[10px] bg-red-500/10 text-red-500 text-[11px]">
            {error}
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-theme-muted/50">Enter to create · Esc to cancel</span>
          <button
            onClick={submit}
            disabled={!name.trim() || submitting}
            className="px-3 py-1.5 rounded-full text-[11px] font-semibold bg-primary text-primary-fg disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity inline-flex items-center gap-1"
          >
            {submitting && <Loader2 className="w-3 h-3 animate-spin" />}
            Create
          </button>
        </div>
      </div>
    </div>
  );
};

/** Compact "2d" / "3h" style age for list rows. */
function shortAge(iso: string | undefined | null): string | null {
  if (!iso) return null;
  try {
    const diff = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(diff) || diff < 0) return null;
    const minutes = Math.floor(diff / 60_000);
    if (minutes < 1) return 'now';
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d`;
    const weeks = Math.floor(days / 7);
    if (weeks < 5) return `${weeks}w`;
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return null;
  }
}

const ProjectRow: React.FC<{
  project: Project;
  active: boolean;
  onSelect: () => void;
}> = ({ project, active, onSelect }) => {
  // Active is the default — only show the status dot when it's something else,
  // so the list stays quiet for normal projects.
  const isNonActive = project.status && project.status !== 'active';
  const dot = isNonActive ? STATUS_COLOR[project.status] : null;
  // Tie the row's icon chip to the project's own accent — the same treatment
  // the project's detail header uses, so selecting a project feels continuous.
  const accent = project.color || '#71717a';
  const fileCount = (project.pinned_paths || []).length;
  const age = shortAge(project.updated_at);
  return (
    <button
      onClick={onSelect}
      className={clsx(
        'group relative w-full flex items-center gap-2.5 px-2.5 py-2 rounded-[14px] text-left transition-[background-color,transform] duration-200',
        active
          ? 'bg-theme-active text-theme-fg'
          : 'text-theme-fg/90 hover:bg-theme-hover/50',
      )}
    >
      {active && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 bg-primary rounded-r-full" />
      )}
      <span
        className="shrink-0 w-9 h-9 rounded-[11px] flex items-center justify-center text-base leading-none ring-1 ring-inset transition-colors"
        style={{
          backgroundColor: `${accent}14`,
          // @ts-ignore — set ring color inline
          ['--tw-ring-color' as any]: `${accent}26`,
        }}
        aria-hidden
      >
        {project.icon || '📁'}
      </span>
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="flex-1 min-w-0 truncate text-[12.5px] font-semibold">{project.name}</span>
          {dot && (
            <span className={clsx('shrink-0 w-1.5 h-1.5 rounded-full', dot)} title={project.status} />
          )}
          {age && (
            <span className="shrink-0 text-[10px] tabular-nums text-theme-muted/50">
              {age}
            </span>
          )}
        </span>
        {project.description ? (
          <span className="block truncate text-[11px] text-theme-muted/70">
            {project.description}
          </span>
        ) : (
          <span className="block truncate text-[11px] text-theme-muted/45">
            {fileCount > 0
              ? `${fileCount} file${fileCount === 1 ? '' : 's'}`
              : 'No description'}
          </span>
        )}
        {(fileCount > 0 || project.instructions) && project.description && (
          <span className="mt-1 flex items-center gap-1.5 overflow-hidden">
            {fileCount > 0 && (
              <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-theme-hover/60 text-[9.5px] font-semibold text-theme-muted">
                {fileCount} file{fileCount === 1 ? '' : 's'}
              </span>
            )}
            {project.instructions && (
              <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-theme-hover/60 text-[9.5px] font-semibold text-theme-muted">
                instructions
              </span>
            )}
          </span>
        )}
      </span>
    </button>
  );
};

/**
 * Vertical drag handle between the list and the home view. Captures pointer to
 * survive cursor leaving the strip during a drag.
 */
const ResizeHandle: React.FC<{ onResize: (deltaX: number) => void }> = ({ onResize }) => {
  const lastXRef = useRef<number | null>(null);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      className="relative shrink-0 w-1 cursor-col-resize group select-none"
      onPointerDown={(e) => {
        (e.target as Element).setPointerCapture(e.pointerId);
        lastXRef.current = e.clientX;
      }}
      onPointerMove={(e) => {
        if (lastXRef.current === null) return;
        const dx = e.clientX - lastXRef.current;
        lastXRef.current = e.clientX;
        if (dx !== 0) onResize(dx);
      }}
      onPointerUp={(e) => {
        try { (e.target as Element).releasePointerCapture(e.pointerId); } catch { }
        lastXRef.current = null;
      }}
      onPointerCancel={() => { lastXRef.current = null; }}
    >
      <span className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-[color:var(--sidebar-border)] group-hover:bg-[color:var(--border)] transition-colors" />
    </div>
  );
};

const EmptyState: React.FC<{ count: number }> = ({ count }) => (
  <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center select-none">
    <span className="launcher-suggestion-chip__icon flex h-14 w-14 items-center justify-center rounded-[18px] border border-theme/15">
      {count > 0 ? (
        <FolderOpen className="w-6 h-6 text-theme-muted/70" strokeWidth={1.6} />
      ) : (
        <FolderKanban className="w-6 h-6 text-theme-muted/70" strokeWidth={1.6} />
      )}
    </span>
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-theme-muted leading-5">
        Projects
      </p>
      <h2 className="mt-2 text-[18px] font-semibold tracking-tight text-theme-fg leading-tight">
        {count > 0 ? 'Pick a project' : 'No projects yet'}
      </h2>
      <p className="mt-2 text-[12.5px] leading-relaxed text-theme-muted max-w-[280px] mx-auto">
        {count > 0
          ? 'Select one on the left to see its Timeline, Tasks, Notes, and Files.'
          : 'Hit + above to create one, or ask Stuard to start one for you.'}
      </p>
    </div>
  </div>
);

export default SidebarProjectsPanel;
