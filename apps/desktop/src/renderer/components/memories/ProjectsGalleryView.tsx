import React, { useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { AnimatePresence, motion, useInView } from 'framer-motion';
import { createPortal } from 'react-dom';
import { FolderOpen, Loader2, Plus, Search, Settings2, Target, X } from 'lucide-react';
import {
  createProject,
  useProjects,
  type Project,
} from '../../hooks/useProjects';
import { ProjectHomeView } from '../projects/ProjectHomeView';

interface ProjectsGalleryViewProps {
  /** Bumped by the Memories header Refresh button to force a reload. */
  refreshNonce?: number;
}

function formatUpdated(value?: string | null) {
  if (!value) return 'No activity yet';
  return (
    'Updated ' +
    new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(value))
  );
}

// ----------------------------------------------------------------------------
// Pop-up on scroll wrapper — mirrors the Collections grid entrance.
// ----------------------------------------------------------------------------

function PopUpOnScroll({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: '-30px 0px' });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 40, scale: 0.94 }}
      animate={isInView ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 40, scale: 0.94 }}
      transition={{ delay, duration: 0.45, type: 'spring', stiffness: 130, damping: 18 }}
    >
      {children}
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN VIEW
// ═══════════════════════════════════════════════════════════════════════════════

export function ProjectsGalleryView({ refreshNonce = 0 }: ProjectsGalleryViewProps) {
  const { projects, loading, error, reload } = useProjects(false);
  const [query, setQuery] = useState('');
  const [composing, setComposing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [memoriesRoot, setMemoriesRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (refreshNonce > 0) void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshNonce]);

  useEffect(() => {
    setMemoriesRoot(document.querySelector<HTMLElement>('[data-onboarding="memories-view"]'));
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

  const label = `${projects.length} ${projects.length === 1 ? 'Project' : 'Projects'}`;

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-transparent">
      {/* Header — count on the left, search + create on the right (mirrors Collections). */}
      <div className="flex-none px-4 py-4 md:px-6 md:py-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <h2 className="text-2xl font-semibold tracking-tight text-theme-fg">{label}</h2>

          <div className="flex items-center gap-2">
            <div className="relative w-full max-w-[220px]">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-theme-muted" />
              <input
                type="text"
                placeholder="Search projects"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-10 w-full rounded-2xl border border-theme bg-theme-card pl-11 pr-4 text-sm text-theme-fg shadow-sm outline-none transition-all placeholder:text-theme-muted focus:border-primary/40 focus:ring-2 focus:ring-primary/10"
              />
            </div>
            <button
              onClick={() => setComposing(true)}
              className="inline-flex h-10 shrink-0 items-center gap-2 rounded-2xl border border-theme bg-theme-card px-4 text-sm font-medium text-theme-fg shadow-sm transition-all hover:bg-theme-hover"
            >
              <Plus className="h-4 w-4" />
              <span>New project</span>
            </button>
          </div>
        </div>
      </div>

      {/* Body — loading / error / empty / grid */}
      {loading && projects.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4">
          <div className="flex min-w-[260px] flex-col items-center gap-4 rounded-[28px] border border-theme bg-theme-card px-8 py-10 text-center shadow-sm">
            <Loader2 className="h-8 w-8 animate-spin text-theme-muted" />
            <p className="text-sm font-medium text-theme-muted">Loading projects...</p>
          </div>
        </div>
      ) : error ? (
        <div className="flex flex-1 items-center justify-center px-4">
          <div className="max-w-md rounded-[28px] border border-theme bg-theme-card px-8 py-10 text-center shadow-sm">
            <p className="text-sm font-medium text-red-500">{error}</p>
            <button
              onClick={() => void reload()}
              className="mt-4 inline-flex items-center gap-2 rounded-2xl border border-theme bg-theme-card px-4 py-2 text-sm font-medium text-theme-fg transition-colors hover:bg-theme-hover"
            >
              Try again
            </button>
          </div>
        </div>
      ) : projects.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4">
          <div className="max-w-md rounded-[28px] border border-theme bg-theme-card px-8 py-10 text-center shadow-sm">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-theme-hover text-theme-muted">
              <FolderOpen className="h-7 w-7" />
            </div>
            <h3 className="text-xl font-semibold text-theme-fg">No projects yet</h3>
            <p className="mt-2 text-sm leading-6 text-theme-muted">
              Projects keep their own instructions, knowledge, files, tasks, and timeline. Create one,
              or ask Stuard to start one for you as you chat.
            </p>
            <button
              onClick={() => setComposing(true)}
              className="mx-auto mt-5 inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-fg shadow-sm transition-opacity hover:opacity-90"
            >
              <Plus className="h-4 w-4" />
              New project
            </button>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4">
          <div className="max-w-sm rounded-[28px] border border-theme bg-theme-card px-8 py-10 text-center shadow-sm">
            <p className="text-sm text-theme-muted">No projects match “{query.trim()}”.</p>
          </div>
        </div>
      ) : (
        <div className="relative flex-1 overflow-y-auto custom-scrollbar px-4 pb-5 pt-3 md:px-5 md:pb-6">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((p, i) => (
              <PopUpOnScroll key={p.id} delay={i * 0.04}>
                <ProjectGalleryCard project={p} onClick={() => setSelectedId(p.id)} />
              </PopUpOnScroll>
            ))}
          </div>
        </div>
      )}

      {/* New-project composer (modal) */}
      {composing && (
        <NewProjectModal
          portalTarget={memoriesRoot}
          onClose={() => setComposing(false)}
          onCreated={(id) => {
            setComposing(false);
            setSelectedId(id);
            void reload();
          }}
        />
      )}

      {/* Project detail — full ProjectHomeView in a slide-up panel (mirrors a drawer's contents) */}
      {selected && memoriesRoot ? (
        createPortal(
          <AnimatePresence>
            <ProjectDetailPanel
              key={selected.id}
              project={selected}
              onClose={() => setSelectedId(null)}
              onProjectChanged={reload}
            />
          </AnimatePresence>,
          memoriesRoot,
        )
      ) : (
        <AnimatePresence>
          {selected && (
            <ProjectDetailPanel
              project={selected}
              onClose={() => setSelectedId(null)}
              onProjectChanged={reload}
            />
          )}
        </AnimatePresence>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Project card — the dashboard "face" of a project, matched to a Collection card.
// ----------------------------------------------------------------------------

function ProjectGalleryCard({ project, onClick }: { project: Project; onClick: () => void }) {
  const accent = project.color || '#71717a';
  const fileCount = (project.pinned_paths || []).length;
  const hasInstructions = !!String(project.instructions || '').trim();
  const isNonActive = project.status && project.status !== 'active';

  return (
    <motion.div whileHover={{ y: -3, scale: 1.01 }} whileTap={{ scale: 0.985 }} className="relative">
      <button
        onClick={onClick}
        className="relative z-10 w-full overflow-hidden rounded-[24px] border border-theme bg-theme-card text-left shadow-sm transition-all duration-300 hover:border-primary/30 hover:bg-theme-hover/30 hover:shadow-lg"
      >
        <div className="relative z-10 flex min-h-[156px] flex-col gap-3 px-5 py-4">
          <div className="flex items-start gap-3">
            <span
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-xl ring-1 ring-inset"
              style={{
                backgroundColor: `${accent}14`,
                color: accent,
                // @ts-ignore — inline ring color
                ['--tw-ring-color' as any]: `${accent}26`,
              }}
              aria-hidden
            >
              {project.icon || '📁'}
            </span>

            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium text-theme-muted">{formatUpdated(project.updated_at)}</p>
              <h3 className="mt-0.5 line-clamp-1 text-[1rem] font-semibold leading-6 text-theme-fg">
                {project.name}
              </h3>
            </div>

            {isNonActive && (
              <span
                className={clsx(
                  'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold leading-none',
                  project.status === 'paused' && 'bg-amber-500/10 text-amber-500',
                  project.status === 'archived' && 'bg-zinc-500/15 text-zinc-400',
                )}
              >
                {project.status}
              </span>
            )}
          </div>

          {project.description ? (
            <p className="line-clamp-2 text-[13px] leading-6 text-theme-muted">{project.description}</p>
          ) : project.goals ? (
            <p className="flex items-start gap-1.5 text-[13px] leading-6 text-theme-muted">
              <Target className="mt-1 h-3.5 w-3.5 shrink-0 opacity-70" />
              <span className="line-clamp-2">{project.goals}</span>
            </p>
          ) : null}

          <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-2">
            {fileCount > 0 && (
              <span className="rounded-full bg-[rgba(215,128,38,0.14)] px-3 py-1 text-xs font-medium text-[#d78026]">
                {fileCount} {fileCount === 1 ? 'File' : 'Files'}
              </span>
            )}
            {hasInstructions && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(39,118,255,0.15)] px-3 py-1 text-xs font-medium text-[#2776ff]">
                <Settings2 className="h-3 w-3" />
                Instructions
              </span>
            )}
            {(project.tags || []).slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="max-w-[120px] truncate rounded-full bg-theme-hover px-3 py-1 text-xs font-medium text-theme-muted"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      </button>
    </motion.div>
  );
}

// ----------------------------------------------------------------------------
// Detail panel — slide-up overlay hosting the full ProjectHomeView.
// ----------------------------------------------------------------------------

function ProjectDetailPanel({
  project,
  onClose,
  onProjectChanged,
}: {
  project: Project;
  onClose: () => void;
  onProjectChanged: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.2 }}
      className="absolute inset-0 z-40"
    >
      <div className="memory-collection-detail relative flex h-full flex-col overflow-hidden rounded-[28px] bg-theme-bg shadow-xl">
        <button
          onClick={onClose}
          className="absolute right-3 top-2.5 z-50 inline-flex items-center gap-2 rounded-2xl bg-theme-hover px-3 py-2 text-sm font-medium text-theme-fg transition-colors hover:bg-theme-card"
        >
          <X className="h-3.5 w-3.5" />
          <span>Close</span>
        </button>
        <ProjectHomeView project={project} onProjectChanged={onProjectChanged} />
      </div>
    </motion.div>
  );
}

// ----------------------------------------------------------------------------
// New-project composer — a roomy modal, matched to the dashboard surface.
// ----------------------------------------------------------------------------

function NewProjectModal({
  portalTarget,
  onClose,
  onCreated,
}: {
  portalTarget: HTMLElement | null;
  onClose: () => void;
  onCreated: (projectId: string) => void;
}) {
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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

  const body = (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="absolute inset-0 z-[60] flex items-center justify-center p-6"
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.97 }}
        transition={{ duration: 0.2, type: 'spring', stiffness: 220, damping: 22 }}
        className="memory-collection-detail relative z-10 w-full max-w-lg rounded-[28px] bg-theme-bg p-6 shadow-2xl md:p-7"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold tracking-tight text-theme-fg">New project</h2>
            <p className="mt-1 text-[13px] text-theme-muted">
              Give it a name now — you can add files, notes, and tasks later.
            </p>
          </div>
          <button
            onClick={onClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl text-theme-muted transition-colors hover:bg-theme-hover hover:text-theme-fg"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 space-y-3">
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder="Project name"
            className="h-12 w-full rounded-2xl border border-theme bg-theme-card px-4 text-[15px] font-semibold text-theme-fg outline-none transition-all placeholder:font-normal placeholder:text-theme-muted focus:border-primary/40 focus:ring-2 focus:ring-primary/10"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder="One-line description (optional)"
            rows={2}
            className="memory-context-scrollbar w-full resize-none rounded-2xl border border-theme bg-theme-card px-4 py-3 text-sm leading-6 text-theme-fg outline-none transition-all placeholder:text-theme-muted focus:border-primary/40 focus:ring-2 focus:ring-primary/10"
          />
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder="Project instructions for Stuard (optional)"
            rows={3}
            className="memory-context-scrollbar w-full resize-none rounded-2xl border border-theme bg-theme-card px-4 py-3 text-sm leading-6 text-theme-fg outline-none transition-all placeholder:text-theme-muted focus:border-primary/40 focus:ring-2 focus:ring-primary/10"
          />
          {error && (
            <div className="rounded-2xl bg-red-500/10 px-4 py-2.5 text-[13px] text-red-500">{error}</div>
          )}
        </div>

        <div className="mt-6 flex items-center justify-between">
          <span className="text-[11px] text-theme-muted">Enter to create · Esc to cancel</span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="inline-flex h-10 items-center rounded-2xl px-4 text-sm font-medium text-theme-muted transition-colors hover:bg-theme-hover hover:text-theme-fg"
            >
              Cancel
            </button>
            <button
              onClick={() => void submit()}
              disabled={!name.trim() || submitting}
              className="inline-flex h-10 items-center gap-2 rounded-2xl bg-primary px-5 text-sm font-semibold text-primary-fg shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Create project
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );

  return createPortal(body, portalTarget ?? document.body);
}

export default ProjectsGalleryView;
