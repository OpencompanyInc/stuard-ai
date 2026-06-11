import React, { useEffect, useMemo, useRef } from 'react';
import { clsx } from 'clsx';
import { AlertTriangle } from 'lucide-react';
import { parseWhen } from './parseWhen';
import type { SlashPhase, SlashSession } from './types';

/**
 * Inline tokens stop working past a couple of fields — no overview, no room
 * for descriptions. Workflow sessions ALWAYS use the form when they declare
 * params (named trigger inputs deserve labels); other commands switch when
 * they have many fields or wide json/array values. When the form is open the
 * bar collapses to a chip+progress summary.
 */
export function slashSessionNeedsPanel(session: SlashSession): boolean {
  if (session.commandId.startsWith('run:')) return session.fields.length > 0;
  return (
    session.fields.length > 3
    || session.fields.some((f) => f.paramType === 'json' || f.paramType === 'array')
  );
}

interface SlashCommandFormProps {
  session: SlashSession;
  values: Record<string, string>;
  phase: SlashPhase;
  statusMsg: string;
  onChange: (key: string, value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  maxHeight?: number;
  /** compact = portaled pill dropdown; panel = inline card (expanded/window). */
  variant: 'compact' | 'panel';
}

/**
 * Vertical parameter form for commands with many inputs. Every field is
 * visible (scrolls past the cap), labels sit left, descriptions ride as ghost
 * hints. Enter advances to the next empty field or submits; Esc cancels.
 */
export const SlashCommandForm: React.FC<SlashCommandFormProps> = ({
  session,
  values,
  phase,
  statusMsg,
  onChange,
  onSubmit,
  onCancel,
  maxHeight,
  variant,
}) => {
  const listRef = useRef<HTMLDivElement | null>(null);
  const Icon = session.icon;

  // Focus the first empty field when the form opens.
  useEffect(() => {
    const root = listRef.current;
    if (!root) return;
    const inputs = Array.from(root.querySelectorAll<HTMLInputElement>('input[data-slash-field]'));
    const target = inputs.find((el) => !el.value.trim()) || inputs[0];
    target?.focus();
  }, [session.commandId]);

  // Live parse preview per 'when' field key.
  const whenPreviews = useMemo(() => {
    const out: Record<string, string | null> = {};
    for (const f of session.fields) {
      if (f.kind !== 'when') continue;
      const text = String(values[f.key] || '').trim();
      if (!text) continue;
      const parsed = parseWhen(text);
      out[f.key] = parsed.date ? parsed.label : null;
    }
    return out;
  }, [session.fields, values]);

  const focusNextOrSubmit = (currentKey: string) => {
    const root = listRef.current;
    const idx = session.fields.findIndex((f) => f.key === currentKey);
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
    const isEnter = e.key === 'Enter' || (e as any).code === 'NumpadEnter';
    if (isEnter && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onSubmit();
      return;
    }
    if (isEnter && !e.shiftKey) {
      e.preventDefault();
      focusNextOrSubmit(key);
    }
  };

  const cycleSelect = (key: string, options: string[]) => {
    const current = String(values[key] || options[0]);
    const next = options[(options.indexOf(current) + 1 + options.length) % options.length];
    onChange(key, next);
  };

  return (
    <div
      className={clsx(
        'overflow-hidden flex flex-col',
        variant === 'panel' && 'rounded-2xl border border-theme bg-theme-card shadow-xl',
      )}
      style={{
        ...(maxHeight ? { maxHeight } : {}),
        ...(variant === 'compact'
          ? {
              background: 'rgb(var(--compact-pill-bg))',
              borderRadius: 12,
              boxShadow: 'var(--compact-pill-shadow)',
            }
          : {}),
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 px-3 pt-2.5 pb-2">
        <span
          className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center"
          style={{
            background: 'color-mix(in srgb, var(--primary) 12%, transparent)',
            color: 'var(--primary)',
          }}
        >
          <Icon className="w-3.5 h-3.5" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[12.5px] font-semibold text-theme-fg truncate">{session.title}</span>
          <span className="block text-[11px] text-theme-muted truncate">Fill in the inputs</span>
        </span>
      </div>

      {/* Fields */}
      <div ref={listRef} className="overflow-y-auto custom-scrollbar px-3 pb-1 flex flex-col gap-1">
        {session.fields.map((f) => {
          const label = f.key.replace(/[_-]+/g, ' ');
          const text = String(values[f.key] || '');
          const isWhen = f.kind === 'when';
          const whenValid = isWhen && text.trim() ? !!parseWhen(text).date : null;
          const isWide = f.paramType === 'json' || f.paramType === 'array';
          return (
            <div key={f.key} className="grid grid-cols-[110px_1fr] items-center gap-2 py-0.5">
              <span
                className="text-[11.5px] font-medium text-theme-fg/80 truncate"
                title={f.hint}
              >
                {label}
                {f.required && <span style={{ color: 'var(--primary)' }}> *</span>}
              </span>
              {f.kind === 'select' && f.options ? (
                <span>
                  <button
                    type="button"
                    onClick={() => cycleSelect(f.key, f.options!)}
                    onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onCancel(); } }}
                    className="px-2.5 py-1 rounded-full text-[11.5px] font-medium bg-theme-hover text-theme-fg/80 hover:text-theme-fg transition-colors"
                    title={f.hint}
                  >
                    {String(values[f.key] || f.options[0])}
                  </button>
                </span>
              ) : (
                <span className="relative flex items-center min-w-0">
                  <input
                    data-slash-field={f.key}
                    value={text}
                    onChange={(e) => onChange(f.key, e.target.value)}
                    onKeyDown={(e) => handleFieldKeyDown(e, f.key)}
                    placeholder={f.hint}
                    spellCheck={false}
                    className={clsx(
                      'w-full bg-theme-hover/50 outline-none text-[12.5px] text-theme-fg placeholder:text-theme-muted/70 px-2.5 py-1.5 rounded-lg border transition-colors',
                      isWide && 'font-mono text-[12px]',
                      whenValid === false
                        ? 'border-red-400/60'
                        : 'border-theme/40 focus:border-theme',
                    )}
                    style={whenValid === true
                      ? { borderColor: 'color-mix(in srgb, var(--primary) 55%, transparent)' }
                      : undefined}
                  />
                  {isWhen && whenValid && whenPreviews[f.key] && (
                    <span
                      className="absolute right-2.5 text-[10.5px] pointer-events-none max-w-[45%] truncate"
                      style={{ color: 'var(--primary)' }}
                    >
                      {whenPreviews[f.key]}
                    </span>
                  )}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer — hints left, error + Run right (mirrors the menu footer) */}
      <div className="flex items-center gap-3 px-3 py-2 border-t border-theme/40">
        <span className="flex items-center gap-3 text-[10px] text-theme-muted">
          <span>↵ next field</span>
          <span>esc cancel</span>
        </span>
        <span className="flex-1 min-w-0 text-right">
          {phase === 'error' && statusMsg && (
            <span className="inline-flex items-center gap-1 text-[10.5px] text-red-400 max-w-full">
              <AlertTriangle className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{statusMsg}</span>
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={onSubmit}
          className="flex-shrink-0 px-3.5 py-1.5 rounded-full text-[11.5px] font-semibold text-white transition-opacity hover:opacity-90"
          style={{ background: 'var(--primary)' }}
        >
          Run
        </button>
      </div>
    </div>
  );
};

export default SlashCommandForm;
