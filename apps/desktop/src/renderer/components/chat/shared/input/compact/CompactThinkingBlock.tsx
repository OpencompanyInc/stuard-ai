import React, { memo, useEffect, useRef } from 'react';

const MUTED_FG = 'rgb(var(--compact-pill-fg-muted))';

interface CompactThinkingBlockProps {
  /** Streamed reasoning markdown/text. */
  text?: string;
  /** Turn still in progress. */
  isLive?: boolean;
  /** e.g. "Using Browser…" while a tool runs. */
  statusHint?: string | null;
}

/**
 * Compact-mode thinking strip.
 *
 * Compact mode is a small floating pill — not a window — so it shouldn't carry
 * a heavy bordered "card". Instead this renders a seamless, ephemeral whisper:
 * a quiet, softly-breathing status label, and (while reasoning streams) the
 * latest thoughts gently flowing upward and dissolving via a top fade mask.
 * Nothing boxes the content in, so it reads as part of the conversation flow
 * rather than an inset panel.
 */
export const CompactThinkingBlock: React.FC<CompactThinkingBlockProps> = memo(({
  text = '',
  isLive = false,
  statusHint,
}) => {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const trimmed = text.trim();
  // Keep only the tail — older thoughts have already faded out of view.
  const preview = trimmed.length > 280 ? trimmed.slice(-280) : trimmed;

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [preview]);

  const headline = statusHint?.trim()
    || (isLive ? 'Thinking' : 'Thought process');
  // Status hints (e.g. "Using Browser…") may already carry their own ellipsis.
  const showEllipsis = isLive && !/[.…]$/.test(headline);

  return (
    <div className="compact-thinking" aria-live="polite">
      <div className="compact-thinking__label">
        <span
          className={isLive ? 'compact-thinking__headline--live' : undefined}
          style={{
            fontSize: 11,
            fontWeight: 500,
            lineHeight: '14px',
            letterSpacing: '0.01em',
            color: MUTED_FG,
          }}
        >
          {headline}
          {showEllipsis && <span className="compact-thinking__ellipsis">…</span>}
        </span>
      </div>
      {preview ? (
        <div
          ref={bodyRef}
          className="compact-thinking__stream"
          style={{ color: MUTED_FG }}
        >
          {preview}
        </div>
      ) : null}
    </div>
  );
});

CompactThinkingBlock.displayName = 'CompactThinkingBlock';

export default CompactThinkingBlock;
