import React, { useEffect, useMemo, useRef } from 'react';
import { clsx } from 'clsx';
import { AlertTriangle, CheckCircle, Loader2, X } from 'lucide-react';
import { parseWhen } from './parseWhen';
import type { SlashPhase, SlashSession } from './types';

interface SlashCommandComposerProps {
  session: SlashSession;
  values: Record<string, string>;
  phase: SlashPhase;
  statusMsg: string;
  onChange: (key: string, value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  /** compact = lives inside the pill footprint; panel = expanded/window input row. */
  variant: 'compact' | 'panel';
  /** Compact host hook for window resizing (maps to the pill's textarea-height contract). */
  onHeightChange?: (textareaEquivalentHeight: number) => void;
  /**
   * Summary mode: the fields live in the SlashCommandForm overlay instead —
   * the bar shows just chip + fill progress (and working/done status).
   */
  summary?: boolean;
}

/**
 * The slash-command composer: [icon + command chip] followed by inline token
 * fields with ghost hints. Enter advances to the next empty required field or
 * submits; Esc cancels. 'when' fields show a live parse preview.
 */
export const SlashCommandComposer: React.FC<SlashCommandComposerProps> = ({
  session,
  values,
  phase,
  statusMsg,
  onChange,
  onSubmit,
  onCancel,
  variant,
  onHeightChange,
  summary = false,
}) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const firstInputRef = useRef<HTMLInputElement | null>(null);
  const Icon = session.icon;
  const editable = phase === 'editing' || phase === 'error';

  useEffect(() => {
    firstInputRef.current?.focus();
  }, [session.commandId]);

  // Report height to the compact host so the OS window grows with wrapped fields.
  useEffect(() => {
    if (!onHeightChange || !rootRef.current) return;
    const el = rootRef.current;
    const report = () => {
      // Pill contract: min-h 56px ↔ textarea height 36px; report the delta.
      onHeightChange(Math.max(36, el.offsetHeight - 20));
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onHeightChange]);

  // Live parse preview for the first non-empty 'when' field.
  const whenPreview = useMemo(() => {
    for (const f of session.fields) {
      if (f.kind !== 'when') continue;
      const text = String(values[f.key] || '').trim();
      if (!text) continue;
      const parsed = parseWhen(text);
      return parsed.date ? parsed.label : null;
    }
    return undefined; // no when text typed yet
  }, [session.fields, values]);

  const focusNextOrSubmit = (currentKey: string) => {
    const idx = session.fields.findIndex((f) => f.key === currentKey);
    const root = rootRef.current;
    for (let i = idx + 1; i < session.fields.length; i++) {
      const f = session.fields[i];
      if (f.kind === 'select') continue;
      if (!String(values[f.key] || '').trim()) {
        const next = root?.querySelector<HTMLInputElement>(`input[data-slash-field="${f.key}"]`);
        if (next) { next.focus(); return; }
      }
    }
    onSubmit();
  };

  const handleFieldKeyDown = (e: React.KeyboardEvent, key: string) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
      return;
    }
    if ((e.key === 'Enter' || (e as any).code === 'NumpadEnter') && !e.shiftKey) {
      e.preventDefault();
      if (editable) focusNextOrSubmit(key);
    }
  };

  const cycleSelect = (key: string, options: string[]) => {
    const current = String(values[key] || options[0]);
    const next = options[(options.indexOf(current) + 1 + options.length) % options.length];
    onChange(key, next);
  };

  const compact = variant === 'compact';

  return (
    <div
      ref={rootRef}
      className={clsx(
        'no-drag w-full flex items-center gap-2 min-w-0',
        compact
          ? 'min-h-[56px] px-3 py-2 rounded-[26px]'
          : 'min-h-[40px] px-2 py-1.5 rounded-3xl bg-theme-hover/50 border border-theme/50',
      )}
      style={compact ? {
        backgroundColor: 'rgb(var(--compact-pill-bg))',
        boxShadow: 'var(--compact-pill-shadow)',
      } : undefined}
    >
      {/* Command chip */}
      <span
        className="flex-shrink-0 inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-full max-w-[160px]"
        style={{
          background: 'color-mix(in srgb, var(--primary) 12%, transparent)',
          color: 'var(--primary)',
        }}
        title={session.title}
      >
        <Icon className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="text-[12px] font-semibold truncate">{session.title}</span>
      </span>

      {/* Body: fields, or status while working/done */}
      {phase === 'working' ? (
        <span className="flex-1 min-w-0 inline-flex items-center gap-2 text-[12.5px] text-theme-muted">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          {statusMsg || 'Working…'}
        </span>
      ) : phase === 'done' ? (
        <span className="flex-1 min-w-0 inline-flex items-center gap-2 text-[12.5px] font-medium text-theme-fg truncate">
          <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--primary)' }} />
          <span className="truncate">{statusMsg}</span>
        </span>
      ) : summary ? (
        <span className="flex-1 min-w-0 text-[12.5px] text-theme-muted truncate">
          {(() => {
            const total = session.fields.length;
            const filled = session.fields.filter((f) => String(values[f.key] || '').trim()).length;
            return `${filled} of ${total} filled`;
          })()}
        </span>
      ) : (
        // Wrap, never hide: an off-screen field behind horizontal scroll is a
        // field the user forgets exists. Compact hosts grow the OS window via
        // onHeightChange when this wraps to a second row.
        <div className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
          {session.fields.map((f, i) => {
            if (f.kind === 'select' && f.options) {
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => cycleSelect(f.key, f.options!)}
                  className="flex-shrink-0 px-2 py-1 rounded-full text-[11.5px] font-medium bg-theme-hover text-theme-fg/80 hover:text-theme-fg transition-colors"
                  title={f.hint}
                >
                  {String(values[f.key] || f.options[0])}
                </button>
              );
            }
            const isWhen = f.kind === 'when';
            const text = String(values[f.key] || '');
            const whenValid = isWhen && text.trim() ? !!parseWhen(text).date : null;
            return (
              <input
                key={f.key}
                ref={i === 0 ? firstInputRef : undefined}
                data-slash-field={f.key}
                value={text}
                onChange={(e) => onChange(f.key, e.target.value)}
                onKeyDown={(e) => handleFieldKeyDown(e, f.key)}
                placeholder={f.hint}
                title={isWhen && whenValid && whenPreview ? whenPreview : f.hint}
                spellCheck={false}
                className={clsx(
                  'flex-1 min-w-[64px] bg-transparent outline-none text-[13px] text-theme-fg placeholder:text-theme-muted/70 px-1.5 py-1 rounded-md border-b',
                  whenValid === false ? 'border-red-400/60' : 'border-transparent focus:border-theme/40',
                )}
                style={whenValid === true ? { borderBottomColor: 'color-mix(in srgb, var(--primary) 55%, transparent)' } : undefined}
              />
            );
          })}
        </div>
      )}

      {/* Right side: parse preview / error, then close. Summary mode keeps the
          bar quiet — hints and errors live in the form panel's footer. */}
      {editable && !summary && (
        <span className="flex-shrink-0 max-w-[150px] truncate text-[10.5px] text-theme-muted">
          {phase === 'error' && statusMsg ? (
            <span className="inline-flex items-center gap-1 text-red-400">
              <AlertTriangle className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{statusMsg}</span>
            </span>
          ) : whenPreview ? (
            <span style={{ color: 'var(--primary)' }}>{whenPreview}</span>
          ) : (
            '↵ confirm'
          )}
        </span>
      )}
      <button
        type="button"
        onClick={onCancel}
        title="Cancel (Esc)"
        className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-theme-muted hover:text-theme-fg hover:bg-theme-hover transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

export default SlashCommandComposer;
