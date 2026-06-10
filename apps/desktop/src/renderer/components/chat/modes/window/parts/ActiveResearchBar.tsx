/**
 * ActiveResearchBar — floating capsule overlaid on the chat when Research Mode
 * is active for the current conversation. Mirrors the ActiveProjectBar pill
 * language (tinted icon chip, quiet eyebrow, ghost actions) but sits top-right
 * so both bars can coexist, and adds live source/note counters plus a report
 * button once the final document ships.
 *
 * Also exports the breathing-border CSS used by ChatView to tint the chat
 * container while research is active (soft tint at rest, gentle pulse while
 * streaming — deliberately quiet, no saturated glows).
 */
import React, { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Telescope, FileText, Link2, StickyNote, X } from 'lucide-react';
import type { ResearchUiState } from '../../../../../hooks/useActiveResearch';

/** Research accent — cyan, distinct from brand red and the indigo agent accent. */
export const RESEARCH_ACCENT = '#06b6d4';

export const ResearchModeStyles: React.FC = () => (
  <style>{`
    @keyframes research-breathe {
      0%, 100% { box-shadow: 0 0 0 1px ${RESEARCH_ACCENT}2e, 0 0 16px ${RESEARCH_ACCENT}10; }
      50% { box-shadow: 0 0 0 1px ${RESEARCH_ACCENT}55, 0 0 26px ${RESEARCH_ACCENT}1f; }
    }
    .research-active-border { box-shadow: 0 0 0 1px ${RESEARCH_ACCENT}26; }
    .research-active-border.research-streaming { animation: research-breathe 2.6s ease-in-out infinite; }
    @keyframes research-ping {
      0% { transform: scale(1); opacity: 0.6; }
      80%, 100% { transform: scale(2.1); opacity: 0; }
    }
    .research-ping-dot::after {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: 9999px;
      background: ${RESEARCH_ACCENT};
      animation: research-ping 1.8s cubic-bezier(0, 0, 0.2, 1) infinite;
    }
  `}</style>
);

interface ActiveResearchBarProps {
  research: ResearchUiState;
  isStreaming?: boolean;
  onOpenReport?: () => void;
  onDismiss?: () => void;
}

export const ActiveResearchBar: React.FC<ActiveResearchBarProps> = ({
  research,
  isStreaming = false,
  onOpenReport,
  onDismiss,
}) => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div
      className={clsx(
        'absolute top-2 right-3 z-20 flex justify-end pointer-events-none',
        'transition-all duration-200 ease-out',
        mounted ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2',
      )}
    >
      <div className="pointer-events-auto inline-flex items-center gap-1 h-8 pl-1.5 pr-1 rounded-full bg-theme-card/85 backdrop-blur-xl border border-theme/10 shadow-[var(--compact-pill-shadow)]">
        {/* Accent icon chip — pulses while the agent is actively researching */}
        <span
          className="relative shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full ring-1 ring-inset"
          style={{
            backgroundColor: `${RESEARCH_ACCENT}14`,
            color: RESEARCH_ACCENT,
            // @ts-ignore — ring color via inline style
            ['--tw-ring-color' as any]: `${RESEARCH_ACCENT}33`,
          }}
          aria-hidden
        >
          {isStreaming && <span className="research-ping-dot absolute inset-1.5 rounded-full" />}
          <Telescope className="relative w-3.5 h-3.5" strokeWidth={1.75} />
        </span>

        <span className="hidden sm:inline pl-0.5 text-[9px] font-bold uppercase tracking-[0.16em] text-theme-muted/55 leading-none">
          Research
        </span>

        {research.brief && (
          <span
            className="shrink min-w-0 max-w-[220px] truncate px-1 text-[12px] font-semibold text-theme-fg"
            title={research.brief}
          >
            {research.brief}
          </span>
        )}

        {/* Live counters — quiet, update as the registry/notes grow */}
        {(research.sources > 0 || research.notes > 0) && (
          <span className="shrink-0 inline-flex items-center gap-1.5 px-1.5 text-[10.5px] font-semibold text-theme-muted/80 tabular-nums">
            <span className="inline-flex items-center gap-0.5" title={`${research.sources} sources in registry`}>
              <Link2 className="w-3 h-3" strokeWidth={1.75} />
              {research.sources}
            </span>
            <span className="inline-flex items-center gap-0.5" title={`${research.notes} distilled notes`}>
              <StickyNote className="w-3 h-3" strokeWidth={1.75} />
              {research.notes}
            </span>
          </span>
        )}

        {(research.report || onDismiss) && (
          <span aria-hidden className="mx-0.5 shrink-0 w-px h-4 bg-theme/10" />
        )}

        {research.report && onOpenReport && (
          <button
            onClick={onOpenReport}
            className="shrink-0 inline-flex items-center gap-1.5 h-6 pl-2 pr-2.5 rounded-full text-[11px] font-bold transition-colors"
            style={{
              backgroundColor: `${RESEARCH_ACCENT}1f`,
              color: RESEARCH_ACCENT,
            }}
            title={`Open report: ${research.report.title}`}
          >
            <FileText className="w-3.5 h-3.5" strokeWidth={2} />
            <span>Open report</span>
          </button>
        )}

        {onDismiss && (
          <button
            onClick={onDismiss}
            className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60 transition-colors"
            title='Hide (research stays active — say "exit research mode" to end it)'
          >
            <X className="w-3.5 h-3.5" strokeWidth={1.75} />
          </button>
        )}
      </div>
    </div>
  );
};
