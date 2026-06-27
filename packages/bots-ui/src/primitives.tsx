import React, { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { ChevronsUpDown } from 'lucide-react';
import type { BadgeTone } from './types';

export function DashboardBadge({
  label,
  tone = 'neutral',
  icon: Icon,
  className,
}: {
  label: string;
  tone?: BadgeTone;
  icon?: any;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold',
        tone === 'primary' && 'border-primary/25 bg-primary/10 text-primary',
        tone === 'warning' && 'border-amber-500/20 bg-amber-500/10 text-amber-300',
        tone === 'success' && 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
        tone === 'danger' && 'border-red-500/20 bg-red-500/10 text-red-300',
        tone === 'neutral' && 'border-theme/10 bg-theme-card/70 text-theme-muted',
        className,
      )}
    >
      {Icon && <Icon className="h-3.5 w-3.5" />}
      <span>{label}</span>
    </span>
  );
}

export function StatCard({
  value,
  label,
  size = 'lg',
  className,
}: {
  value: React.ReactNode;
  label: string;
  size?: 'lg' | 'md';
  className?: string;
}) {
  return (
    <div
      className={clsx(
        'rounded-2xl bg-zinc-500/10 px-4 py-3.5 border border-[color:var(--dashboard-panel-border)]',
        className,
      )}
    >
      <div
        className={clsx(
          'font-semibold tracking-tight text-theme-fg leading-none truncate',
          size === 'lg' ? 'text-[22px]' : 'text-[15px]',
        )}
      >
        {value}
      </div>
      <div className="mt-2 text-[12px] text-theme-muted">{label}</div>
    </div>
  );
}

export function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-theme-hover/60 px-3 py-1 text-[12px] font-medium text-theme-fg">
      {children}
    </span>
  );
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  align = 'right',
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const current = options.find(o => o.value === value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-theme-fg transition hover:bg-theme-hover/50"
      >
        <span>{current?.label ?? value}</span>
        <ChevronsUpDown className="h-3.5 w-3.5 text-theme-muted" />
      </button>
      {open && (
        <div
          className={clsx(
            'absolute top-full mt-1 z-30 min-w-[170px] overflow-hidden rounded-xl border border-theme bg-theme-card shadow-lg',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {options.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={clsx(
                'block w-full px-3 py-2 text-left text-[13px] transition hover:bg-theme-hover/60',
                opt.value === value ? 'font-medium text-primary' : 'text-theme-fg',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ConfigRow({
  label,
  description,
  control,
}: {
  label: string;
  description?: string;
  control: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-[color:var(--dashboard-panel-border)] bg-theme-card px-4 py-3.5 shadow-sm">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-theme-fg">{label}</div>
        {description && (
          <div className="mt-0.5 text-[11px] text-theme-muted">{description}</div>
        )}
      </div>
      <div className="flex-none">{control}</div>
    </div>
  );
}

export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => !disabled && onChange(!checked)}
      className={clsx(
        'relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 focus:outline-none flex-shrink-0',
        checked ? 'bg-primary' : 'bg-theme-hover/60',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      <span className={clsx(
        'inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform duration-200 shadow-sm',
        checked ? 'translate-x-[18px]' : 'translate-x-[3px]',
      )} />
    </button>
  );
}
