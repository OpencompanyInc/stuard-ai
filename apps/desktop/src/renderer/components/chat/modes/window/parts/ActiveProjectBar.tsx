/**
 * ActiveProjectBar — a floating "focus" capsule overlaid on the chat when
 * Project Mode is locked onto the current conversation. It is absolutely
 * positioned over the message area (never reserves layout space), borrows the
 * compact/launcher pill language — tinted accent icon chip, quiet "Focus"
 * eyebrow, project name switcher, ghost actions — and uses backdrop-blur so
 * messages can scroll underneath without being pushed down.
 *
 * Clicking the project name opens a switcher dropdown listing other active
 * projects, so the user can swap without first exiting.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { ChevronDown, PanelRightOpen, X } from 'lucide-react';
import {
  useProjects,
  setConversationProject,
  type Project,
} from '../../../../../hooks/useProjects';

interface ActiveProjectBarProps {
  project: Project;
  conversationId?: string | null;
  onExit?: () => void;
  onOpenHome?: () => void;
}

export const ActiveProjectBar: React.FC<ActiveProjectBarProps> = ({
  project,
  conversationId,
  onExit,
  onOpenHome,
}) => {
  const [mounted, setMounted] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const accent = project.color || '#6366f1';
  const nonActiveStatus = project.status && project.status !== 'active';

  return (
    <div
      className={clsx(
        'absolute top-2 left-3 z-20 flex justify-start pointer-events-none',
        'transition-all duration-200 ease-out',
        mounted ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2',
      )}
    >
      {/* Floating focus capsule — sits over the chat, never reserves layout space */}
      <div className="pointer-events-auto inline-flex items-center gap-1 h-8 pl-1.5 pr-1 rounded-full bg-theme-card/85 backdrop-blur-xl border border-theme/10 shadow-[var(--compact-pill-shadow)]">
        {/* Accent icon chip — the only place the project color shows */}
        <span
          className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] leading-none ring-1 ring-inset"
          style={{
            backgroundColor: `${accent}14`,
            color: accent,
            // @ts-ignore — ring color via inline style
            ['--tw-ring-color' as any]: `${accent}33`,
          }}
          aria-hidden
        >
          {project.icon || '📁'}
        </span>

        <span className="hidden sm:inline pl-0.5 text-[9px] font-bold uppercase tracking-[0.16em] text-theme-muted/55 leading-none">
          Focus
        </span>

        <button
          ref={triggerRef}
          onClick={() => setSwitcherOpen((open) => !open)}
          className="shrink min-w-0 inline-flex items-center gap-1 h-6 px-1.5 rounded-full text-[12.5px] font-semibold text-theme-fg hover:bg-theme-hover/50 transition-colors"
          title="Switch project"
        >
          <span className="truncate max-w-[200px]">{project.name}</span>
          <ChevronDown
            className={clsx(
              'w-3 h-3 shrink-0 text-theme-muted transition-transform duration-150',
              switcherOpen && 'rotate-180',
            )}
          />
        </button>

        {nonActiveStatus && (
          <span
            className={clsx(
              'shrink-0 px-1.5 py-px rounded-full text-[9px] font-bold uppercase tracking-wider leading-none',
              project.status === 'paused' && 'bg-amber-500/10 text-amber-500',
              project.status === 'archived' && 'bg-zinc-500/10 text-zinc-500',
            )}
          >
            {project.status}
          </span>
        )}

        {(onOpenHome || onExit) && (
          <span aria-hidden className="mx-0.5 shrink-0 w-px h-4 bg-theme/10" />
        )}

        {onOpenHome && (
          <button
            onClick={onOpenHome}
            className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60 transition-colors"
            title="Open project home"
          >
            <PanelRightOpen className="w-3.5 h-3.5" strokeWidth={1.75} />
          </button>
        )}
        {onExit && (
          <button
            onClick={onExit}
            className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full text-theme-muted hover:text-red-500 hover:bg-red-500/10 transition-colors"
            title="Exit project mode"
          >
            <X className="w-3.5 h-3.5" strokeWidth={1.75} />
          </button>
        )}
      </div>

      {switcherOpen && (
        <ProjectSwitcherDropdown
          activeId={project.id}
          conversationId={conversationId}
          anchorEl={triggerRef.current}
          onClose={() => setSwitcherOpen(false)}
        />
      )}
    </div>
  );
};

interface ProjectSwitcherDropdownProps {
  activeId: string;
  conversationId?: string | null;
  anchorEl: HTMLElement | null;
  onClose: () => void;
}

/**
 * Rendered into document.body via a portal so the chat card's
 * `overflow-hidden` doesn't clip it. Positioned with fixed coords derived from
 * the trigger button's bounding rect, recomputed on scroll/resize.
 */
const ProjectSwitcherDropdown: React.FC<ProjectSwitcherDropdownProps> = ({
  activeId,
  conversationId,
  anchorEl,
  onClose,
}) => {
  const { projects, loading } = useProjects(false);
  const others = projects.filter((p) => p.id !== activeId);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchorEl) return;
    const recompute = () => {
      const rect = anchorEl.getBoundingClientRect();
      setCoords({ top: rect.bottom + 4, left: rect.left });
    };
    recompute();
    window.addEventListener('resize', recompute);
    window.addEventListener('scroll', recompute, true);
    return () => {
      window.removeEventListener('resize', recompute);
      window.removeEventListener('scroll', recompute, true);
    };
  }, [anchorEl]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (anchorEl?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, anchorEl]);

  const handleSwitch = async (projectId: string) => {
    if (!conversationId) {
      onClose();
      return;
    }
    await setConversationProject(conversationId, projectId);
    window.dispatchEvent(new CustomEvent('project-mode-changed'));
    onClose();
  };

  if (!coords) return null;

  return createPortal(
    <div
      ref={containerRef}
      className="fixed z-[1000] w-[260px] max-h-[280px] overflow-y-auto custom-scrollbar rounded-[14px] bg-theme-card border border-theme/15 shadow-[var(--compact-pill-shadow)] p-1"
      style={{ top: coords.top, left: coords.left }}
    >
      <div className="px-2 pt-1 pb-1.5 text-[9px] font-bold uppercase tracking-[0.16em] text-theme-muted/55">
        Switch project
      </div>
      {loading && (
        <div className="px-3 py-2 text-[11px] text-theme-muted/70">Loading…</div>
      )}
      {!loading && others.length === 0 && (
        <div className="px-3 py-2 text-[11px] text-theme-muted/70">No other projects.</div>
      )}
      {others.map((p) => {
        const rowAccent = p.color || '#6366f1';
        return (
          <button
            key={p.id}
            onClick={() => handleSwitch(p.id)}
            className="w-full flex items-center gap-2.5 px-2 py-1.5 text-left rounded-[11px] hover:bg-theme-hover/60 transition-colors"
          >
            <span
              className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-[9px] text-[12px] leading-none ring-1 ring-inset"
              style={{
                backgroundColor: `${rowAccent}14`,
                color: rowAccent,
                // @ts-ignore — ring color via inline style
                ['--tw-ring-color' as any]: `${rowAccent}26`,
              }}
              aria-hidden
            >
              {p.icon || '📁'}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block truncate text-[12px] font-semibold text-theme-fg">{p.name}</span>
              {p.description && (
                <span className="block truncate text-[10.5px] text-theme-muted/70">{p.description}</span>
              )}
            </span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
};

interface ActiveProjectChipProps {
  project: Project;
  onClick?: () => void;
}

/**
 * Compact pill version — used in chat header actions strip when there's not
 * enough room to show the full ActiveProjectBar.
 */
export const ActiveProjectChip: React.FC<ActiveProjectChipProps> = ({ project, onClick }) => {
  const accent = project.color || '#6366f1';
  return (
    <button
      onClick={onClick}
      className="shrink-0 inline-flex items-center gap-1.5 pl-1 pr-2 h-7 rounded-full bg-theme-card/60 border border-theme/10 text-[11.5px] font-semibold text-theme-fg hover:bg-theme-hover/60 transition-colors"
      title={`Project: ${project.name}`}
    >
      <span
        className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] leading-none ring-1 ring-inset"
        style={{
          backgroundColor: `${accent}14`,
          color: accent,
          // @ts-ignore — ring color via inline style
          ['--tw-ring-color' as any]: `${accent}33`,
        }}
        aria-hidden
      >
        {project.icon || '📁'}
      </span>
      <span className="max-w-[120px] truncate">{project.name}</span>
    </button>
  );
};

interface ExitProjectToastProps {
  project: Project;
  onUndo: () => void;
  onDismiss: () => void;
}

/**
 * Lightweight toast shown after the user exits project mode. Auto-dismisses
 * after ~5s; clicking Undo re-enters the project and re-stamps the conversation.
 */
export const ExitProjectToast: React.FC<ExitProjectToastProps> = ({ project, onUndo, onDismiss }) => {
  useEffect(() => {
    const t = setTimeout(onDismiss, 5000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  const accent = project.color || '#6366f1';
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 pl-2 pr-2.5 py-1.5 rounded-full bg-theme-card backdrop-blur-md shadow-[var(--compact-pill-shadow)] border border-theme/10 text-[12px] text-theme-fg">
      <span
        className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full text-[12px] leading-none ring-1 ring-inset"
        style={{
          backgroundColor: `${accent}14`,
          color: accent,
          // @ts-ignore — ring color via inline style
          ['--tw-ring-color' as any]: `${accent}33`,
        }}
        aria-hidden
      >
        {project.icon || '📁'}
      </span>
      <span>Exited <strong className="font-semibold">{project.name}</strong></span>
      <button
        onClick={onUndo}
        className="px-2.5 py-1 rounded-full text-[11px] font-semibold text-primary-fg bg-primary hover:opacity-90 transition-opacity"
      >
        Undo
      </button>
      <button
        onClick={onDismiss}
        className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60 transition-colors"
        title="Dismiss"
      >
        <X className="w-3.5 h-3.5" strokeWidth={1.75} />
      </button>
    </div>
  );
};
