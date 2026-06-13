import React, { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import {
  X, Globe, Clock, Link2, Copy, Check, Loader2, ChevronLeft, ShieldOff,
  AlertCircle, ChevronRight, Download, Eye,
} from 'lucide-react';
import type { ShareMode, ShareOptions, ShareResult } from '../hooks/useStorage';
import { getViewModalHost } from '../utils/viewModalHost';

// ─────────────────────────────────────────────────────────────────────────────
// Share dialog — Drive-style sharing in Stuard design. Stepped flow:
//   1. choose link type (public forever / expiring)
//   2. pick duration (expiring only)
//   3. link ready → auto-copied, click link or Copy to re-copy, revoke public
// ─────────────────────────────────────────────────────────────────────────────

export interface ShareDialogProps {
  objectName: string;          // full object path, e.g. "exports/video.mp4"
  filename: string;            // display name
  shareFile: (objectName: string, mode: ShareMode, ttlHours?: number, opts?: ShareOptions) => Promise<ShareResult>;
  onClose: () => void;
}

type Step = 'type' | 'duration' | 'link';

const DURATIONS: { label: string; sublabel: string; hours: number }[] = [
  { label: '30 minutes', sublabel: 'Quick handoff', hours: 0.5 },
  { label: '1 hour', sublabel: 'Short-lived share', hours: 1 },
  { label: '24 hours', sublabel: 'Share for a day', hours: 24 },
  { label: '7 days', sublabel: 'Maximum duration', hours: 24 * 7 },
];

const MAX_TTL_HOURS = 24 * 7;

type CustomUnit = 'minutes' | 'hours' | 'days';
const UNIT_HOURS: Record<CustomUnit, number> = { minutes: 1 / 60, hours: 1, days: 24 };

function formatExpiry(iso?: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function humanizeUntil(iso?: string): string {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const hours = Math.round(ms / 3_600_000);
  if (hours < 1) return `in ${Math.max(1, Math.round(ms / 60_000))} minutes`;
  if (hours < 48) return `in ${hours} hour${hours === 1 ? '' : 's'}`;
  return `in ${Math.round(hours / 24)} days`;
}

/** Compact display form of a URL: short paths render whole, long ones elide. */
function prettyUrl(url: string): { host: string; path: string } {
  try {
    const u = new URL(url);
    const full = decodeURIComponent(u.pathname);
    if (full.length <= 40) return { host: u.host, path: full };
    const segs = u.pathname.split('/').filter(Boolean);
    const tail = decodeURIComponent(segs[segs.length - 1] || '');
    return { host: u.host, path: `/…/${tail.length > 36 ? `…${tail.slice(-33)}` : tail}` };
  } catch {
    return { host: url.slice(0, 40), path: '' };
  }
}

export function ShareDialog({ objectName, filename, shareFile, onClose }: ShareDialogProps) {
  const [step, setStep] = useState<Step>('type');
  const [mode, setMode] = useState<ShareMode>('public');
  const [generating, setGenerating] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [result, setResult] = useState<ShareResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customValue, setCustomValue] = useState('30');
  const [customUnit, setCustomUnit] = useState<CustomUnit>('minutes');
  const [linkName, setLinkName] = useState('');
  const [asDownload, setAsDownload] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  // Esc closes (capture so the preview modal underneath doesn't also close)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onClose]);

  const copyUrl = useCallback(async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2200);
    } catch { /* clipboard unavailable — user can still select the text */ }
  }, []);

  const generate = useCallback(async (m: ShareMode, ttlHours?: number) => {
    setGenerating(true);
    setError(null);
    const r = await shareFile(objectName, m, ttlHours, {
      linkName: linkName.trim() || undefined,
      disposition: asDownload ? 'attachment' : 'inline',
    });
    setGenerating(false);
    if (r.ok && r.url) {
      setResult(r);
      setStep('link');
      void copyUrl(r.shortUrl || r.url);
    } else {
      // A taken link name bounces back to step 1 where the field lives.
      if (m === 'ttl') setStep('type');
      setError(r.error || 'Could not create the link');
    }
  }, [objectName, shareFile, copyUrl, linkName, asDownload]);

  const handlePickType = useCallback((m: ShareMode) => {
    setMode(m);
    setError(null);
    if (m === 'public') void generate('public');
    else setStep('duration');
  }, [generate]);

  const handleBack = useCallback(() => {
    setStep('type');
    setResult(null);
    setError(null);
    setRevoked(false);
    setCopied(false);
    setCustomOpen(false);
  }, []);

  const customHours = (Number(customValue) || 0) * UNIT_HOURS[customUnit];
  const customValid = customHours >= 1 / 60 && customHours <= MAX_TTL_HOURS;

  const handleRevoke = useCallback(async () => {
    setRevoking(true);
    setError(null);
    const r = await shareFile(objectName, 'private');
    setRevoking(false);
    if (r.ok) setRevoked(true);
    else setError(r.error || 'Could not remove public access');
  }, [objectName, shareFile]);

  const shownUrl = result?.shortUrl || result?.url || '';
  const linkParts = shownUrl ? prettyUrl(shownUrl) : null;

  // Portal into the dashboard content area so the backdrop covers the view,
  // not the whole dashboard chrome (falls back to a body portal elsewhere).
  const { host, positionClass } = getViewModalHost();
  return createPortal(
    <div
      className={clsx(positionClass, 'inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-xl animate-in fade-in duration-200')}
      onClick={onClose}
    >
      <div
        className="dashboard-card w-full max-w-md overflow-hidden rounded-3xl border border-white/[0.06] shadow-[0_24px_80px_-12px_rgba(0,0,0,0.7)] animate-in zoom-in-95 slide-in-from-bottom-2 duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-center gap-3 border-b border-[color:var(--dashboard-panel-border)] px-5 py-4">
          {step !== 'type' && !generating ? (
            <button
              onClick={handleBack}
              className="rounded-xl p-2 text-theme-muted transition-colors hover:bg-[color:var(--dashboard-hover)] hover:text-theme-fg"
              title="Back"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          ) : (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 text-primary">
              <Link2 className="h-5 w-5" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold tracking-tight text-theme-fg">
              {step === 'duration' ? 'How long should it last?' : step === 'link' ? 'Link ready' : 'Share file'}
            </div>
            <div className="truncate text-[12px] text-theme-muted" title={filename}>{filename}</div>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl p-2 text-theme-muted transition-colors hover:bg-[color:var(--dashboard-hover)] hover:text-theme-fg"
            title="Close (Esc)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Error ── */}
        {error && (
          <div className="mx-5 mt-4 flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-[12.5px] text-red-400 animate-in fade-in slide-in-from-top-1 duration-150">
            <AlertCircle className="h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        {/* ── Step 1: link type ── */}
        {step === 'type' && (
          <div className="space-y-2.5 p-5 animate-in fade-in slide-in-from-right-2 duration-200" key="step-type">
            <button
              onClick={() => handlePickType('public')}
              disabled={generating}
              className="group flex w-full items-center gap-4 rounded-2xl border border-[color:var(--dashboard-panel-border)] bg-[color:var(--dashboard-hover)]/40 px-4 py-4 text-left transition-all hover:border-primary/35 hover:bg-primary/[0.06] disabled:opacity-60"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 text-primary transition-transform group-hover:scale-105">
                {generating && mode === 'public' ? <Loader2 className="h-5 w-5 animate-spin" /> : <Globe className="h-5 w-5" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold text-theme-fg">Public link</div>
                <div className="mt-0.5 text-[12px] leading-relaxed text-theme-muted">
                  Anyone with the link · never expires · revoke anytime
                </div>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-theme-muted transition-transform group-hover:translate-x-1 group-hover:text-theme-fg" />
            </button>

            <button
              onClick={() => handlePickType('ttl')}
              disabled={generating}
              className="group flex w-full items-center gap-4 rounded-2xl border border-[color:var(--dashboard-panel-border)] bg-[color:var(--dashboard-hover)]/40 px-4 py-4 text-left transition-all hover:border-primary/35 hover:bg-primary/[0.06] disabled:opacity-60"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[color:var(--dashboard-hover)] text-theme-fg transition-transform group-hover:scale-105">
                <Clock className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold text-theme-fg">Expiring link</div>
                <div className="mt-0.5 text-[12px] leading-relaxed text-theme-muted">
                  Stops working after a time you pick · revoke anytime
                </div>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-theme-muted transition-transform group-hover:translate-x-1 group-hover:text-theme-fg" />
            </button>

            {/* Options: custom link name + download behaviour */}
            <div className="space-y-2.5 rounded-2xl border border-[color:var(--dashboard-panel-border)] px-4 py-3.5">
              <div className="flex items-center gap-2.5">
                <span className="w-20 shrink-0 text-[12px] font-medium text-theme-muted">Link name</span>
                <input
                  value={linkName}
                  onChange={e => setLinkName(e.target.value)}
                  placeholder="optional, e.g. demo-video"
                  spellCheck={false}
                  className="min-w-0 flex-1 rounded-lg border border-[color:var(--dashboard-panel-border)] bg-[color:var(--dashboard-panel-solid)] px-2.5 py-1.5 text-[12.5px] text-theme-fg placeholder:text-theme-muted/60 focus:border-primary/40 focus:outline-none"
                />
              </div>
              <button
                onClick={() => setAsDownload(v => !v)}
                className="flex w-full items-center gap-2.5 text-left"
              >
                <span className="w-20 shrink-0 text-[12px] font-medium text-theme-muted">Opens as</span>
                <span className="dashboard-card-muted inline-flex items-center gap-0.5 rounded-lg p-0.5">
                  <span className={clsx(
                    'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors',
                    !asDownload ? 'bg-[color:var(--dashboard-panel-solid)] text-theme-fg' : 'text-theme-muted',
                  )}>
                    <Eye className="h-3 w-3" /> Preview
                  </span>
                  <span className={clsx(
                    'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors',
                    asDownload ? 'bg-[color:var(--dashboard-panel-solid)] text-theme-fg' : 'text-theme-muted',
                  )}>
                    <Download className="h-3 w-3" /> Download
                  </span>
                </span>
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: duration ── */}
        {step === 'duration' && (
          <div className="space-y-2 p-5 animate-in fade-in slide-in-from-right-2 duration-200" key="step-duration">
            {DURATIONS.map(d => (
              <button
                key={d.hours}
                onClick={() => void generate('ttl', d.hours)}
                disabled={generating}
                className="group flex w-full items-center gap-4 rounded-2xl border border-[color:var(--dashboard-panel-border)] bg-[color:var(--dashboard-hover)]/40 px-4 py-3 text-left transition-all hover:border-primary/35 hover:bg-primary/[0.06] disabled:opacity-60"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[color:var(--dashboard-hover)] text-theme-fg transition-transform group-hover:scale-105">
                  {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold text-theme-fg">{d.label}</div>
                  <div className="text-[12px] text-theme-muted">{d.sublabel}</div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-theme-muted transition-transform group-hover:translate-x-1 group-hover:text-theme-fg" />
              </button>
            ))}

            {/* Custom duration */}
            {customOpen ? (
              <div className="flex items-center gap-2 rounded-2xl border border-primary/25 bg-primary/[0.04] px-4 py-3 animate-in fade-in duration-150">
                <Clock className="h-4 w-4 shrink-0 text-primary" />
                <input
                  type="number"
                  min={1}
                  value={customValue}
                  onChange={e => setCustomValue(e.target.value)}
                  autoFocus
                  className="w-16 rounded-lg border border-[color:var(--dashboard-panel-border)] bg-[color:var(--dashboard-panel-solid)] px-2.5 py-1.5 text-[13px] tabular-nums text-theme-fg focus:border-primary/40 focus:outline-none"
                  onKeyDown={e => { if (e.key === 'Enter' && customValid && !generating) void generate('ttl', customHours); }}
                />
                <select
                  value={customUnit}
                  onChange={e => setCustomUnit(e.target.value as CustomUnit)}
                  className="rounded-lg border border-[color:var(--dashboard-panel-border)] bg-[color:var(--dashboard-panel-solid)] px-2 py-1.5 text-[12.5px] text-theme-fg focus:border-primary/40 focus:outline-none"
                >
                  <option value="minutes">minutes</option>
                  <option value="hours">hours</option>
                  <option value="days">days</option>
                </select>
                <div className="flex-1" />
                <button
                  onClick={() => void generate('ttl', customHours)}
                  disabled={!customValid || generating}
                  className="dashboard-button-primary inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-[12.5px] font-semibold disabled:opacity-50"
                >
                  {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Create link
                </button>
              </div>
            ) : (
              <button
                onClick={() => setCustomOpen(true)}
                disabled={generating}
                className="w-full rounded-2xl border border-dashed border-[color:var(--dashboard-panel-border)] px-4 py-2.5 text-[12.5px] font-medium text-theme-muted transition-colors hover:border-primary/30 hover:text-theme-fg disabled:opacity-60"
              >
                Custom duration…
              </button>
            )}

            {!customValid && customOpen && (
              <p className="px-1 text-[11.5px] text-red-400">Pick between 1 minute and 7 days.</p>
            )}
            <p className="px-1 pt-1 text-[11.5px] leading-relaxed text-theme-muted">
              You can also revoke any link early from this dialog.
            </p>
          </div>
        )}

        {/* ── Step 3: link ready ── */}
        {step === 'link' && result?.url && (
          <div className="space-y-4 p-5 animate-in fade-in slide-in-from-right-2 duration-200" key="step-link">
            {/* Status badge row */}
            <div className="flex items-center gap-2.5">
              <div className={clsx(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold',
                result.mode === 'public'
                  ? 'bg-primary/10 text-primary'
                  : 'bg-[color:var(--dashboard-hover)] text-theme-fg',
              )}>
                {result.mode === 'public' ? <Globe className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                {result.mode === 'public' ? 'Public link' : 'Expiring link'}
              </div>
              <span className="text-[12px] text-theme-muted">
                {result.mode === 'public'
                  ? 'never expires'
                  : result.expiresAt
                    ? `expires ${humanizeUntil(result.expiresAt)} · ${formatExpiry(result.expiresAt)}`
                    : ''}
              </span>
            </div>

            {/* Link pill — click anywhere to copy */}
            <button
              onClick={() => void copyUrl(shownUrl)}
              className={clsx(
                'group flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-all',
                copied
                  ? 'border-emerald-500/30 bg-emerald-500/[0.07]'
                  : 'border-[color:var(--dashboard-panel-border)] bg-[color:var(--dashboard-hover)]/50 hover:border-primary/30 hover:bg-primary/[0.05]',
              )}
              title="Click to copy"
            >
              <div className={clsx(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors',
                copied ? 'bg-emerald-500/15 text-emerald-400' : 'bg-primary/10 text-primary',
              )}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-theme-fg">
                  {linkParts?.host}<span className="text-theme-muted">{linkParts?.path}</span>
                </div>
                <div className={clsx('text-[11.5px] transition-colors', copied ? 'text-emerald-400' : 'text-theme-muted')}>
                  {copied ? 'Copied to clipboard' : 'Click to copy the full link'}
                </div>
              </div>
            </button>

            <div className="flex items-center justify-between gap-3 px-1">
              <p className="text-[11.5px] leading-relaxed text-theme-muted">
                Anyone with this link can {asDownload ? 'download' : 'open'} the file.
                It was copied automatically.
              </p>
              {result.shortUrl && result.url && (
                <button
                  onClick={() => void copyUrl(result.url!)}
                  className="shrink-0 text-[11.5px] font-medium text-theme-muted underline-offset-2 transition-colors hover:text-theme-fg hover:underline"
                  title={result.url}
                >
                  Copy direct link
                </button>
              )}
            </div>

            {/* Revoke — works for both modes (expiring links are revocable copies too) */}
            <div className="border-t border-[color:var(--dashboard-panel-border)] pt-3.5">
              {revoked ? (
                <div className="flex items-center gap-2 rounded-xl bg-[color:var(--dashboard-hover)] px-3.5 py-2.5 text-[12.5px] text-theme-muted animate-in fade-in duration-150">
                  <Check className="h-4 w-4 text-emerald-400" /> Link revoked — it no longer works.
                </div>
              ) : (
                <button
                  onClick={() => void handleRevoke()}
                  disabled={revoking}
                  className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-medium text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-60"
                >
                  {revoking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldOff className="h-3.5 w-3.5" />}
                  {result.mode === 'public' ? 'Remove public access' : 'Revoke link now'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>,
    host,
  );
}
