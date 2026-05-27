import React, { useEffect, useState } from 'react';
import { useBotsPlatform } from './BotsPlatformContext';
import { clsx } from 'clsx';
import { AlertCircle, Check, Copy, FolderOpen, Loader2, Zap } from 'lucide-react';
import { SCHEDULE_LABELS, type ScheduleInterval } from './proactive-types';
import { CRON_PRESETS } from './constants';

// File-type presets for the folder watcher. Each maps a friendly name to a glob.
// "Custom" lets the user type their own pattern.
const FILE_WATCH_PATTERN_PRESETS: { label: string; pattern: string }[] = [
  { label: 'All files', pattern: '**/*' },
  { label: 'Videos', pattern: '**/*.{mp4,mov,mkv,avi,webm,m4v}' },
  { label: 'Images', pattern: '**/*.{png,jpg,jpeg,gif,webp,heic,bmp}' },
  { label: 'PDFs', pattern: '**/*.pdf' },
  { label: 'Documents', pattern: '**/*.{pdf,doc,docx,txt,md,rtf,pptx,xlsx,csv}' },
  { label: 'Audio', pattern: '**/*.{mp3,wav,m4a,flac,aac,ogg}' },
];

// Friendly labels + helper text for chokidar events, so users aren't guessing
// what "add"/"unlink" mean.
const FILE_WATCH_EVENTS: { event: string; label: string; hint: string }[] = [
  { event: 'add', label: 'New files', hint: 'A file is created or dropped in' },
  { event: 'change', label: 'Changed files', hint: 'An existing file is modified' },
  { event: 'unlink', label: 'Deleted files', hint: 'A file is removed' },
  { event: 'addDir', label: 'New folders', hint: 'A subfolder is created' },
  { event: 'unlinkDir', label: 'Deleted folders', hint: 'A subfolder is removed' },
];

export function IntervalEditor({ args, setArgs }: { args: Record<string, any>; setArgs: (next: Record<string, any>) => void }) {
  const value = (args.every || '30m') as ScheduleInterval;
  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-theme-muted">How often?</label>
      <select
        value={value}
        onChange={e => setArgs({ ...args, every: e.target.value })}
        className="w-full rounded-xl border border-[color:var(--dashboard-panel-border)] bg-theme-card/60 px-3 py-2.5 text-[13px] text-theme-fg outline-none transition focus:border-primary/60"
      >
        {Object.entries(SCHEDULE_LABELS).map(([v, label]) => (
          <option key={v} value={v}>{label}</option>
        ))}
      </select>
    </div>
  );
}

export function CronEditor({ args, setArgs }: { args: Record<string, any>; setArgs: (next: Record<string, any>) => void }) {
  const expr = String(args.expr || '');
  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-theme-muted">Cron expression</label>
      <input
        type="text"
        value={expr}
        onChange={e => setArgs({ ...args, expr: e.target.value })}
        placeholder="0 9 * * 2"
        className="w-full rounded-xl border border-[color:var(--dashboard-panel-border)] bg-theme-card/60 px-3 py-2.5 font-mono text-[13px] text-theme-fg outline-none transition focus:border-primary/60"
      />
      <div className="mt-2.5">
        <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-theme-muted">Quick presets</div>
        <div className="flex flex-wrap gap-1.5">
          {CRON_PRESETS.map(p => (
            <button
              key={p.expr}
              onClick={() => setArgs({ ...args, expr: p.expr })}
              className={clsx(
                'rounded-full border px-2.5 py-1 text-[11px] transition',
                expr === p.expr
                  ? 'border-primary/60 bg-primary/10 text-primary'
                  : 'border-theme/30 bg-theme-card text-theme-muted hover:border-theme/60',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-2.5 text-[11px] text-theme-muted">
        Format: <span className="font-mono">minute hour day-of-month month day-of-week</span>. Uses your system timezone.
      </p>
    </div>
  );
}

export function FileWatchEditor({ args, setArgs }: { args: Record<string, any>; setArgs: (next: Record<string, any>) => void }) {
  const platform = useBotsPlatform();
  const path = String(args.path || '').trim();
  const pattern = String(args.pattern || '**/*');
  const events = Array.isArray(args.events) ? args.events.map(String) : ['add', 'change'];
  const matchedPreset = FILE_WATCH_PATTERN_PRESETS.find(p => p.pattern === pattern);
  const [customMode, setCustomMode] = useState(!matchedPreset);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const setEvent = (event: string, checked: boolean) => {
    const next = checked ? Array.from(new Set([...events, event])) : events.filter(e => e !== event);
    // Never let the watcher end up listening to nothing.
    setArgs({ ...args, events: next.length ? next : ['add'] });
  };
  const pickFolder = async () => {
    try {
      const res = await platform.pickFolder?.({ title: 'Choose folder to watch' });
      const folder = res?.folders?.[0]?.path;
      if (folder) setArgs({ ...args, path: folder });
    } catch { /* keep manual path */ }
  };

  return (
    <div className="space-y-4">
      {/* Folder */}
      <div>
        <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-theme-muted">Folder to watch</label>
        {path ? (
          <div className="flex items-center gap-3 rounded-xl border border-[color:var(--dashboard-panel-border)] bg-theme-card/60 px-3 py-2.5">
            <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
            <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-theme-fg" title={path}>{path}</span>
            <button
              type="button"
              onClick={pickFolder}
              className="shrink-0 rounded-lg px-2 py-1 text-[11.5px] font-medium text-primary transition hover:bg-primary/10"
            >
              Change
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={pickFolder}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-theme/40 bg-theme-card/40 px-3 py-3.5 text-[12.5px] font-medium text-theme-fg transition hover:border-primary/50 hover:bg-primary/5"
          >
            <FolderOpen className="h-4 w-4 text-primary" />
            Choose a folder…
          </button>
        )}
        <input
          type="text"
          value={String(args.path || '')}
          onChange={e => setArgs({ ...args, path: e.target.value })}
          placeholder="…or paste a path: C:\Users\you\Downloads"
          className="mt-2 w-full rounded-xl border border-[color:var(--dashboard-panel-border)] bg-theme-card/60 px-3 py-2 text-[12px] text-theme-muted outline-none transition focus:border-primary/60 focus:text-theme-fg"
        />
      </div>

      {/* File type */}
      <div>
        <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-theme-muted">Which files?</label>
        <div className="flex flex-wrap gap-1.5">
          {FILE_WATCH_PATTERN_PRESETS.map(preset => {
            const active = !customMode && pattern === preset.pattern;
            return (
              <button
                key={preset.label}
                type="button"
                onClick={() => { setCustomMode(false); setArgs({ ...args, pattern: preset.pattern }); }}
                className={clsx(
                  'rounded-full border px-3 py-1.5 text-[12px] font-medium transition',
                  active
                    ? 'border-primary/60 bg-primary/10 text-primary'
                    : 'border-theme/30 bg-theme-card text-theme-muted hover:border-theme/60',
                )}
              >
                {preset.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setCustomMode(true)}
            className={clsx(
              'rounded-full border px-3 py-1.5 text-[12px] font-medium transition',
              customMode
                ? 'border-primary/60 bg-primary/10 text-primary'
                : 'border-theme/30 bg-theme-card text-theme-muted hover:border-theme/60',
            )}
          >
            Custom
          </button>
        </div>
        {customMode && (
          <input
            type="text"
            value={pattern}
            onChange={e => setArgs({ ...args, pattern: e.target.value })}
            placeholder="**/*.pdf"
            className="mt-2 w-full rounded-xl border border-[color:var(--dashboard-panel-border)] bg-theme-card/60 px-3 py-2.5 font-mono text-[13px] text-theme-fg outline-none transition focus:border-primary/60"
          />
        )}
        <p className="mt-1.5 text-[11px] text-theme-muted">Only files matching this pattern wake the agent.</p>
      </div>

      {/* Events */}
      <div>
        <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-theme-muted">React to</label>
        <div className="space-y-1.5">
          {FILE_WATCH_EVENTS.map(({ event, label, hint }) => {
            const checked = events.includes(event);
            return (
              <button
                key={event}
                type="button"
                onClick={() => setEvent(event, !checked)}
                className={clsx(
                  'flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition',
                  checked
                    ? 'border-primary/50 bg-primary/5'
                    : 'border-theme/30 bg-theme-card/40 hover:border-theme/60',
                )}
              >
                <span className={clsx(
                  'flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border transition',
                  checked ? 'border-primary bg-primary text-primary-fg' : 'border-theme/50',
                )}>
                  {checked && <Check className="h-3 w-3" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] font-medium text-theme-fg">{label}</span>
                  <span className="block text-[11px] text-theme-muted">{hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Subfolders */}
      <label className="flex items-center gap-2.5 rounded-xl border border-theme/30 bg-theme-card/40 px-3 py-2.5 text-[12.5px] text-theme-fg">
        <input
          type="checkbox"
          checked={args.recursive !== false}
          onChange={e => setArgs({ ...args, recursive: e.target.checked })}
          className="h-3.5 w-3.5 accent-primary"
        />
        Include subfolders
      </label>

      {/* Advanced */}
      <div className="border-t border-theme/15 pt-3">
        <button
          type="button"
          onClick={() => setShowAdvanced(v => !v)}
          className="text-[11.5px] font-medium text-theme-muted transition hover:text-theme-fg"
        >
          {showAdvanced ? '− Hide advanced' : '+ Advanced'}
        </button>
        {showAdvanced && (
          <div className="mt-2.5">
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-theme-muted">Debounce (ms)</label>
            <input
              type="number"
              min={0}
              max={60000}
              value={Number(args.debounceMs ?? 750)}
              onChange={e => setArgs({ ...args, debounceMs: Number(e.target.value || 0) })}
              className="w-full rounded-xl border border-[color:var(--dashboard-panel-border)] bg-theme-card/60 px-3 py-2.5 text-[13px] text-theme-fg outline-none transition focus:border-primary/60"
            />
            <p className="mt-1.5 text-[11px] text-theme-muted">Wait this long after the last change before waking the agent, so a burst of file writes fires once.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export function CommandWatchEditor({ args, setArgs }: { args: Record<string, any>; setArgs: (next: Record<string, any>) => void }) {
  const commandArgs = Array.isArray(args.args) ? args.args.join(' ') : '';
  const fireOn = Array.isArray(args.fireOn) ? args.fireOn.map(String) : ['stdout'];
  const setFireOn = (event: string, checked: boolean) => {
    const next = checked ? Array.from(new Set([...fireOn, event])) : fireOn.filter(e => e !== event);
    setArgs({ ...args, fireOn: next });
  };
  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-theme-muted">Command</label>
        <input
          type="text"
          value={String(args.cmd || '')}
          onChange={e => setArgs({ ...args, cmd: e.target.value })}
          placeholder="python"
          className="w-full rounded-xl border border-[color:var(--dashboard-panel-border)] bg-theme-card/60 px-3 py-2.5 font-mono text-[13px] text-theme-fg outline-none transition focus:border-primary/60"
        />
      </div>
      <div>
        <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-theme-muted">Arguments</label>
        <input
          type="text"
          value={commandArgs}
          onChange={e => setArgs({ ...args, args: e.target.value.split(/\s+/).map(v => v.trim()).filter(Boolean) })}
          placeholder="watcher.py --json-lines"
          className="w-full rounded-xl border border-[color:var(--dashboard-panel-border)] bg-theme-card/60 px-3 py-2.5 font-mono text-[13px] text-theme-fg outline-none transition focus:border-primary/60"
        />
      </div>
      <div>
        <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-theme-muted">Working directory</label>
        <input
          type="text"
          value={String(args.cwd || '')}
          onChange={e => setArgs({ ...args, cwd: e.target.value })}
          placeholder="Optional"
          className="w-full rounded-xl border border-[color:var(--dashboard-panel-border)] bg-theme-card/60 px-3 py-2.5 text-[13px] text-theme-fg outline-none transition focus:border-primary/60"
        />
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[
          ['stdout', 'stdout'],
          ['stderr', 'stderr'],
          ['exit', 'exit'],
        ].map(([event, label]) => (
          <label key={event} className="flex items-center gap-2 rounded-xl border border-theme/30 bg-theme-card/40 px-3 py-2 text-[12px] text-theme-fg">
            <input
              type="checkbox"
              checked={fireOn.includes(event)}
              onChange={e => setFireOn(event, e.target.checked)}
              className="h-3.5 w-3.5 accent-primary"
            />
            {label}
          </label>
        ))}
      </div>
      <p className="text-[11px] text-theme-muted">
        Each output line wakes the agent. If a line is JSON, it is also passed as parsed trigger data.
      </p>
    </div>
  );
}

export function WebhookEditor({ args }: { args: Record<string, any> }) {
  const platform = useBotsPlatform();
  const [copied, setCopied] = useState(false);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'ok' | 'err' | null>(null);
  const slug = String(args.slug || '');
  const cloudUrl = `https://api.stuard.ai/webhooks/incoming/${slug}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await platform.webhooksLocalUrl?.(slug);
        if (!cancelled && res?.ok && res.url) setLocalUrl(res.url);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [slug, platform]);

  const copy = (value: string) => {
    try {
      navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  const test = async () => {
    if (!localUrl) return;
    setTesting(true);
    setTestResult(null);
    try {
      const r = await fetch(localUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: true, source: 'bot-webhook-editor', at: new Date().toISOString() }),
      });
      setTestResult(r.ok ? 'ok' : 'err');
    } catch {
      setTestResult('err');
    } finally {
      setTesting(false);
      setTimeout(() => setTestResult(null), 3000);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label className="block text-[11px] font-medium uppercase tracking-wide text-theme-muted">Local URL (works now)</label>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
            <Zap className="h-2.5 w-2.5" /> live
          </span>
        </div>
        <div className="flex items-stretch gap-2">
          <input
            readOnly
            value={localUrl || 'Resolving local port…'}
            onFocus={e => e.currentTarget.select()}
            className="flex-1 rounded-xl border border-[color:var(--dashboard-panel-border)] bg-zinc-500/10 px-3 py-2.5 font-mono text-[12px] text-theme-fg outline-none"
          />
          <button
            onClick={() => localUrl && copy(localUrl)}
            disabled={!localUrl}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[color:var(--dashboard-panel-border)] bg-theme-card/60 px-3 text-[12px] font-medium text-theme-fg transition hover:border-primary/40 disabled:opacity-50"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            onClick={test}
            disabled={!localUrl || testing}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[color:var(--dashboard-panel-border)] bg-theme-card/60 px-3 text-[12px] font-medium text-theme-fg transition hover:border-primary/40 disabled:opacity-50"
          >
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : testResult === 'ok' ? <Check className="h-3.5 w-3.5 text-emerald-500" />
              : testResult === 'err' ? <AlertCircle className="h-3.5 w-3.5 text-rose-500" />
              : <Zap className="h-3.5 w-3.5" />}
            Test
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-theme-muted">
          POST to this URL from anything on your machine (Zapier desktop agents, curl, scripts). The agent wakes immediately and the request body is passed in as the trigger payload.
        </p>
      </div>

      <div>
        <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-theme-muted">Public cloud URL (coming soon)</label>
        <div className="flex items-stretch gap-2">
          <input
            readOnly
            value={cloudUrl}
            onFocus={e => e.currentTarget.select()}
            className="flex-1 rounded-xl border border-[color:var(--dashboard-panel-border)] bg-zinc-500/5 px-3 py-2.5 font-mono text-[12px] text-theme-muted outline-none"
          />
          <button
            onClick={() => copy(cloudUrl)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[color:var(--dashboard-panel-border)] bg-theme-card/60 px-3 text-[12px] font-medium text-theme-muted transition hover:border-primary/40"
          >
            <Copy className="h-3.5 w-3.5" />
            Copy
          </button>
        </div>
      </div>

      {args.secret && (
        <div>
          <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-theme-muted">Optional shared secret</label>
          <input
            readOnly
            value={String(args.secret)}
            className="w-full rounded-xl border border-[color:var(--dashboard-panel-border)] bg-zinc-500/10 px-3 py-2.5 font-mono text-[12px] text-theme-fg outline-none"
          />
          <p className="mt-1.5 text-[11px] text-theme-muted">Senders can include this in the <span className="font-mono">x-signature</span> header to verify the request came from a trusted source.</p>
        </div>
      )}

      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-[11px] text-amber-400">
        <div className="flex items-center gap-1.5 font-medium">
          <AlertCircle className="h-3 w-3" />
          Cloud delivery pending
        </div>
        <p className="mt-0.5 opacity-90">The local URL above works today against this machine. The public cloud URL is reserved; routing it through the cloud relay lands in a follow-up.</p>
      </div>
    </div>
  );
}

export function GmailEditor({ args, setArgs }: { args: Record<string, any>; setArgs: (next: Record<string, any>) => void }) {
  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-theme-muted">Only fire when email is from</label>
        <input
          type="text"
          value={String(args.from || '')}
          onChange={e => setArgs({ ...args, from: e.target.value })}
          placeholder="updates@example.com (leave empty to match any sender)"
          className="w-full rounded-xl border border-[color:var(--dashboard-panel-border)] bg-theme-card/60 px-3 py-2.5 text-[13px] text-theme-fg outline-none transition focus:border-primary/60"
        />
      </div>
      <div>
        <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-theme-muted">Only fire when subject contains</label>
        <input
          type="text"
          value={String(args.subjectContains || '')}
          onChange={e => setArgs({ ...args, subjectContains: e.target.value })}
          placeholder="weekly digest (leave empty to match any subject)"
          className="w-full rounded-xl border border-[color:var(--dashboard-panel-border)] bg-theme-card/60 px-3 py-2.5 text-[13px] text-theme-fg outline-none transition focus:border-primary/60"
        />
      </div>
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-[11px] text-amber-400">
        <div className="flex items-center gap-1.5 font-medium">
          <AlertCircle className="h-3 w-3" />
          Cloud delivery pending
        </div>
        <p className="mt-0.5 opacity-90">Requires Google connected and Pub/Sub registration. The trigger is stored; wiring it up lands in the next release.</p>
      </div>
    </div>
  );
}
