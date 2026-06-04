import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { Check, Plus, Search, Wrench, X } from 'lucide-react';
import { humanizeToolName } from './helpers';
import { useBotsPlatform } from './BotsPlatformContext';
import { useStudioThemeScope } from './theme-scope';

export function ToolsSection({
  selected,
  onChange,
}: { selected: string[]; onChange: (next: string[]) => void }) {
  const platform = useBotsPlatform();
  const [available, setAvailable] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await platform.getAvailableTools?.();
        if (!cancelled && res?.ok && Array.isArray(res.tools)) setAvailable(res.tools);
      } catch { /* fall back to empty list */ }
    })();
    return () => { cancelled = true; };
  }, [platform]);

  const remove = (tool: string) => onChange(selected.filter(t => t !== tool));

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-[15px] font-semibold text-theme-fg">
            <Wrench className="h-4 w-4" /> Tools
          </h3>
          <p className="mt-0.5 text-[12px] text-theme-muted">
            {selected.length === 0
              ? 'No extra tools added. Agent can use only its built-in tools.'
              : `${selected.length} extra tool${selected.length === 1 ? '' : 's'} added to this agent.`}
          </p>
        </div>
        <button
          onClick={() => setPickerOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-full border border-theme bg-theme-card px-3 py-1.5 text-[12px] font-medium text-theme-fg shadow-sm transition hover:bg-theme-hover"
        >
          <Plus className="h-3 w-3" />
          Add tools
        </button>
      </div>

      {selected.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-theme/40 px-4 py-3 text-[12px] text-theme-muted">
          This agent starts with only its built-in tools. Click <span className="font-medium text-theme-fg">Add tools</span> to give it specific extra tools.
        </div>
      ) : (
        <div className="rounded-2xl border border-[color:var(--dashboard-panel-border)] bg-theme-card px-3.5 py-3 shadow-sm">
          <div className="flex flex-wrap gap-1.5">
            {selected.map(tool => (
              <span
                key={tool}
                title={tool}
                className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 py-1 pl-3 pr-1 text-[11px] font-medium text-primary"
              >
                {humanizeToolName(tool)}
                <button
                  onClick={() => remove(tool)}
                  className="rounded-full p-0.5 transition hover:bg-primary/20"
                  title="Remove"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {pickerOpen && (
        <ToolsPickerModal
          available={available}
          selected={selected}
          onClose={() => setPickerOpen(false)}
          onApply={(next) => { onChange(next); setPickerOpen(false); }}
        />
      )}
    </section>
  );
}

export function ToolsPickerModal({
  available,
  selected,
  onClose,
  onApply,
}: {
  available: string[];
  selected: string[];
  onClose: () => void;
  onApply: (next: string[]) => void;
}) {
  const themeScope = useStudioThemeScope();
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<Set<string>>(new Set(selected));

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return available;
    return available.filter(t =>
      t.toLowerCase().includes(q) ||
      humanizeToolName(t).toLowerCase().includes(q),
    );
  }, [available, search]);

  const toggle = (tool: string) => {
    setDraft(prev => {
      const next = new Set(prev);
      if (next.has(tool)) next.delete(tool); else next.add(tool);
      return next;
    });
  };

  return createPortal(
    <div
      data-wf-theme={themeScope}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 animate-in fade-in duration-150"
      onClick={onClose}
      style={{ WebkitBackdropFilter: 'blur(14px)', backdropFilter: 'blur(14px)' }}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-3xl border border-[color:var(--dashboard-panel-border)] bg-theme-card shadow-2xl animate-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        <div className="border-b border-[color:var(--dashboard-panel-border)] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-stuard text-lg font-semibold text-theme-fg">Add tools</h2>
              <p className="mt-0.5 text-[12px] text-theme-muted">Pick exact extra tools for this agent. Empty = built-in tools only.</p>
            </div>
            <span className="rounded-full bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] px-2.5 py-1 text-[11px] font-semibold text-[color:var(--primary)]">{draft.size} selected</span>
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-[color:var(--dashboard-panel-border)] px-3 py-2">
            <Search className="h-3.5 w-3.5 text-theme-muted" />
            <input
              autoFocus
              type="text"
              placeholder="Search tools…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-[13px] text-theme-fg outline-none placeholder:text-[color:color-mix(in_srgb,var(--foreground-muted)_60%,transparent)]"
            />
            {search && (
              <button onClick={() => setSearch('')} className="rounded p-1 text-theme-muted hover:text-theme-fg">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        <div className="max-h-[420px] overflow-y-auto p-2 scrollbar-minimal">
          {filtered.length === 0 ? (
            <div className="px-3 py-8 text-center text-[12px] text-theme-muted">No tools match "{search}".</div>
          ) : (
            filtered.map(tool => {
              const checked = draft.has(tool);
              const label = humanizeToolName(tool);
              return (
                <button
                  key={tool}
                  onClick={() => toggle(tool)}
                  className={clsx(
                    'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] transition',
                    checked ? 'bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] text-[color:var(--primary)]' : 'text-theme-fg hover:bg-theme-hover',
                  )}
                >
                  <div className={clsx(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                    checked ? 'border-[color:var(--primary)] bg-primary' : 'border-[color:var(--dashboard-panel-border)]',
                  )}>
                    {checked && <Check className="h-3 w-3 text-primary-fg" />}
                  </div>
                  <span className="truncate font-medium" title={tool}>{label}</span>
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[color:var(--dashboard-panel-border)] p-3">
          <button
            onClick={() => setDraft(new Set())}
            className="rounded-full px-3 py-1.5 text-[12px] text-theme-muted transition hover:text-theme-fg"
          >
            Clear all
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-full px-4 py-1.5 text-[13px] text-theme-muted transition hover:text-theme-fg"
            >
              Cancel
            </button>
            <button
              onClick={() => onApply(Array.from(draft))}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-[13px] font-semibold text-primary-fg shadow-sm transition hover:opacity-90"
            >
              <Check className="h-3.5 w-3.5" />
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
