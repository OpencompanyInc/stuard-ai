import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { AlertCircle, Check, Plus, Search, Wrench, X } from 'lucide-react';
import type { SkillInfo } from './types';
import { humanizeToolName } from './helpers';
import { useBotsPlatform } from './BotsPlatformContext';

export function SkillsSection({
  skillIds,
  onChange,
}: { skillIds: string[] | undefined; onChange: (next: string[] | undefined) => void }) {
  const platform = useBotsPlatform();
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await platform.skillsList?.();
        if (!cancelled && res?.ok && Array.isArray(res.skills)) {
          setSkills(res.skills as SkillInfo[]);
        }
      } catch { /* fall back to empty */ }
    };
    load();
    const off = platform.onSkillsUpdated?.((updated: unknown[]) => {
      if (!cancelled && Array.isArray(updated)) setSkills(updated as SkillInfo[]);
    });
    return () => { cancelled = true; if (typeof off === 'function') off(); };
  }, [platform]);

  const activeSkills = useMemo(() => skills.filter(s => s.isActive), [skills]);
  const isInherit = skillIds === undefined;
  const selected = useMemo(() => {
    if (isInherit) return [];
    const set = new Set(skillIds);
    return activeSkills.filter(s => set.has(s.id));
  }, [activeSkills, skillIds, isInherit]);
  const ghostSelected = useMemo(() => {
    if (isInherit) return [];
    const activeIds = new Set(activeSkills.map(s => s.id));
    return (skillIds || []).filter(id => !activeIds.has(id));
  }, [skillIds, activeSkills, isInherit]);

  const remove = (id: string) => {
    onChange((skillIds || []).filter(x => x !== id));
  };

  const description = isInherit
    ? `Inheriting all ${activeSkills.length} active skill${activeSkills.length === 1 ? '' : 's'}. Restrict to give this agent a focused subset.`
    : selected.length === 0
      ? 'Restricted — no skills available to this agent.'
      : `${selected.length} skill${selected.length === 1 ? '' : 's'} enabled.`;

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-[15px] font-semibold text-theme-fg">
            <Wrench className="h-4 w-4" /> Skills
          </h3>
          <p className="mt-0.5 text-[12px] text-theme-muted">{description}</p>
        </div>
        <div className="flex items-center gap-1.5">
          {!isInherit && (
            <button
              onClick={() => onChange(undefined)}
              className="rounded-full px-3 py-1.5 text-[12px] text-theme-muted transition hover:text-theme-fg"
              title="Use all globally-active skills"
            >
              Inherit all
            </button>
          )}
          <button
            onClick={() => setPickerOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-theme bg-theme-card px-3 py-1.5 text-[12px] font-medium text-theme-fg shadow-sm transition hover:bg-theme-hover"
          >
            <Plus className="h-3 w-3" />
            {isInherit ? 'Restrict…' : 'Pick skills'}
          </button>
        </div>
      </div>

      {isInherit ? (
        <div className="rounded-2xl border border-dashed border-theme/40 px-4 py-3 text-[12px] text-theme-muted">
          This agent can use any skill you've enabled globally. Click <span className="font-medium text-theme-fg">Restrict…</span> to scope it down.
        </div>
      ) : selected.length === 0 && ghostSelected.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-theme/40 px-4 py-3 text-[12px] text-theme-muted">
          No skills selected. Click <span className="font-medium text-theme-fg">Pick skills</span> to grant this agent access to specific skills.
        </div>
      ) : (
        <div className="rounded-2xl border border-[color:var(--dashboard-panel-border)] bg-theme-card px-3.5 py-3 shadow-sm">
          <div className="flex flex-wrap gap-1.5">
            {selected.map(skill => (
              <span
                key={skill.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 py-1 pl-2.5 pr-1 text-[11px] font-medium text-primary"
                style={skill.color ? { borderColor: `${skill.color}55`, backgroundColor: `${skill.color}15`, color: skill.color } : undefined}
              >
                <span aria-hidden>{skill.icon || '✨'}</span>
                {skill.name}
                <button
                  onClick={() => remove(skill.id)}
                  className="rounded-full p-0.5 transition hover:bg-current/20"
                  title="Remove"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {ghostSelected.map(id => (
              <span
                key={id}
                className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 py-1 pl-2.5 pr-1 text-[11px] font-medium text-amber-500"
                title="This skill is currently inactive or has been deleted"
              >
                <AlertCircle className="h-3 w-3" />
                {humanizeToolName(id)}
                <button
                  onClick={() => remove(id)}
                  className="rounded-full p-0.5 transition hover:bg-amber-500/20"
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
        <SkillsPickerModal
          skills={activeSkills}
          selected={isInherit ? activeSkills.map(s => s.id) : (skillIds || [])}
          onClose={() => setPickerOpen(false)}
          onApply={(next) => { onChange(next); setPickerOpen(false); }}
        />
      )}
    </section>
  );
}

function SkillsPickerModal({
  skills,
  selected,
  onClose,
  onApply,
}: {
  skills: SkillInfo[];
  selected: string[];
  onClose: () => void;
  onApply: (next: string[]) => void;
}) {
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<Set<string>>(new Set(selected));

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.trigger.toLowerCase().includes(q),
    );
  }, [skills, search]);

  const toggle = (id: string) => {
    setDraft(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md animate-in fade-in duration-150"
      onClick={onClose}
      style={{ WebkitBackdropFilter: 'blur(12px)', backdropFilter: 'blur(12px)' }}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-3xl border border-[color:var(--dashboard-panel-border)] bg-theme-card shadow-2xl animate-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        <div className="border-b border-theme/15 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-stuard text-lg font-semibold text-theme-fg">Pick skills</h2>
              <p className="mt-0.5 text-[12px] text-theme-muted">Only checked skills are available to this agent at run time.</p>
            </div>
            <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">{draft.size} selected</span>
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-[color:var(--dashboard-panel-border)] bg-theme-card/60 px-3 py-2">
            <Search className="h-3.5 w-3.5 text-theme-muted" />
            <input
              autoFocus
              type="text"
              placeholder="Search skills…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-[13px] text-theme-fg outline-none placeholder:text-theme-muted/60"
            />
            {search && (
              <button onClick={() => setSearch('')} className="rounded p-1 text-theme-muted hover:text-theme-fg">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        <div className="max-h-[460px] overflow-y-auto p-3 scrollbar-minimal">
          {filtered.length === 0 ? (
            <div className="px-3 py-8 text-center text-[12px] text-theme-muted">
              {skills.length === 0 ? 'No active skills yet. Create skills from the Skills tab first.' : `No skills match "${search}".`}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {filtered.map(skill => {
                const checked = draft.has(skill.id);
                return (
                  <button
                    key={skill.id}
                    onClick={() => toggle(skill.id)}
                    className={clsx(
                      'flex min-h-[92px] w-full items-start gap-3 rounded-2xl border px-3 py-3 text-left transition',
                      checked
                        ? 'border-primary/40 bg-primary/10 shadow-sm'
                        : 'border-theme/30 bg-theme-card/50 hover:bg-theme-hover/40',
                    )}
                  >
                    <div className={clsx(
                      'mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                      checked ? 'border-primary bg-primary' : 'border-theme/30',
                    )}>
                      {checked && <Check className="h-3 w-3 text-primary-fg" />}
                    </div>
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-base"
                      style={skill.color ? { backgroundColor: `${skill.color}20` } : undefined}
                      aria-hidden
                    >
                      {skill.icon || '✨'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className={clsx('text-[13px] font-semibold leading-5', checked ? 'text-primary' : 'text-theme-fg')}>
                        {skill.name}
                      </div>
                      {skill.description && (
                        <div className="mt-1 line-clamp-2 text-[11.5px] leading-4 text-theme-muted">{skill.description}</div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-theme/15 p-3">
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
