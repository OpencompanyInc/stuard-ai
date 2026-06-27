import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import {
  Bug,
  Lightbulb,
  Send,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Tag,
  Inbox,
  MessageSquare,
  RefreshCw,
  Paperclip,
} from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabaseClient';
import { uploadFeedbackAttachmentsFromPending } from '../lib/feedbackAttachments';
import {
  FeedbackAttachmentPicker,
  type PendingFeedbackAttachment,
} from './genui/FeedbackAttachmentPicker';
import { useRegisterHeaderActions } from './HeaderActions';

// ─────────────────────────────────────────────────────────────────────────────
// Feedback tab — lets a signed-in user file a bug or suggest an idea, then see
// the status of everything they've sent. Writes straight to the `feedback`
// Supabase table (RLS scopes insert/select to auth.uid()), the same store the
// in-chat feedback tools and the ops console read from.
// ─────────────────────────────────────────────────────────────────────────────

type FeedbackType = 'bug' | 'feature';
type Severity = 'low' | 'medium' | 'high' | 'critical';

interface FeedbackRow {
  id: string;
  type: FeedbackType;
  title: string;
  description?: string | null;
  status: string;
  severity: Severity | null;
  labels?: string[] | null;
  created_at: string;
}

interface FeedbackViewProps {
  session: Session | null;
  appVersion?: string;
}

const SEVERITY_OPTIONS: { value: Severity; label: string; tone: string; hint: string }[] = [
  { value: 'low', label: 'Low', tone: 'emerald', hint: 'Minor annoyance' },
  { value: 'medium', label: 'Medium', tone: 'amber', hint: 'Affects my workflow' },
  { value: 'high', label: 'High', tone: 'orange', hint: 'Major blocker' },
  { value: 'critical', label: 'Critical', tone: 'red', hint: 'Data loss / security' },
];

const SUGGESTED_LABELS = ['ui', 'performance', 'workflow', 'voice', 'cloud', 'docs'];

const inputCls =
  'w-full bg-theme-hover border border-theme rounded-xl px-3.5 py-2.5 text-sm text-theme-fg ' +
  'placeholder:text-theme-muted focus:outline-none focus:border-[color:var(--primary)] transition-colors';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return '';
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function severityChipCls(tone: string, active: boolean): string {
  if (!active) return 'border-theme text-theme-muted hover:bg-theme-hover';
  switch (tone) {
    case 'emerald':
      return 'bg-emerald-500/15 border-emerald-500/40 text-emerald-600 dark:text-emerald-400';
    case 'amber':
      return 'bg-amber-500/15 border-amber-500/40 text-amber-600 dark:text-amber-400';
    case 'orange':
      return 'bg-orange-500/15 border-orange-500/40 text-orange-600 dark:text-orange-400';
    default:
      return 'bg-red-500/15 border-red-500/40 text-red-600 dark:text-red-400';
  }
}

function statusBadge(status: string): { label: string; cls: string } {
  const s = String(status || 'open').toLowerCase();
  switch (s) {
    case 'in_progress':
      return { label: 'In progress', cls: 'bg-amber-500/12 text-amber-600 dark:text-amber-400 border-amber-500/25' };
    case 'resolved':
      return { label: 'Resolved', cls: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 border-emerald-500/25' };
    case 'closed':
      return { label: 'Closed', cls: 'bg-theme-hover text-theme-muted border-theme' };
    case 'wont_fix':
      return { label: "Won't fix", cls: 'bg-theme-hover text-theme-muted border-theme' };
    default:
      return { label: 'Open', cls: 'border-[color:color-mix(in_srgb,var(--primary)_35%,transparent)] text-[color:var(--primary)] bg-[color:color-mix(in_srgb,var(--primary)_12%,transparent)]' };
  }
}

export const FeedbackView: React.FC<FeedbackViewProps> = ({ session, appVersion }) => {
  const userId = session?.user?.id || null;

  const [type, setType] = useState<FeedbackType>('bug');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<Severity>('medium');
  const [labels, setLabels] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<PendingFeedbackAttachment[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [justSent, setJustSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [items, setItems] = useState<FeedbackRow[]>([]);
  const [listLoading, setListLoading] = useState(false);

  const isValid = title.trim().length >= 5 && description.trim().length >= 10;

  const loadFeedback = useCallback(async () => {
    if (!userId) return;
    setListLoading(true);
    try {
      const { data, error: qErr } = await supabase
        .from('feedback')
        .select('id, type, title, description, status, severity, labels, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(30);
      if (!qErr && Array.isArray(data)) setItems(data as FeedbackRow[]);
    } catch {
      /* keep whatever we have */
    } finally {
      setListLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadFeedback();
  }, [loadFeedback]);

  useRegisterHeaderActions(
    [{ id: 'refresh', label: 'Refresh', icon: RefreshCw, onClick: () => loadFeedback(), loading: listLoading, variant: 'secondary' }],
    [loadFeedback, listLoading],
  );

  const toggleLabel = (label: string) => {
    setLabels((prev) => (prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]));
  };

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setSeverity('medium');
    setLabels([]);
    setAttachments([]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid || submitting || !userId) return;
    setSubmitting(true);
    setError(null);
    try {
      const metadata = {
        source: 'desktop_dashboard',
        appVersion: appVersion || null,
        platform: typeof navigator !== 'undefined' ? navigator.platform : null,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        submittedAt: new Date().toISOString(),
        attachmentCount: attachments.length,
      };

      let uploadedScreenshots: Array<{ url: string; caption?: string; mimeType?: string; size?: number }> = [];
      if (attachments.length > 0) {
        uploadedScreenshots = await uploadFeedbackAttachmentsFromPending(attachments, userId);
      }

      const { data, error: insErr } = await supabase
        .from('feedback')
        .insert({
          user_id: userId,
          type,
          title: title.trim(),
          description: description.trim(),
          severity: type === 'bug' ? severity : null,
          labels,
          screenshots: uploadedScreenshots,
          metadata,
          status: 'open',
        })
        .select('id, type, title, description, status, severity, labels, created_at')
        .single();

      if (insErr) throw insErr;

      if (data) setItems((prev) => [data as FeedbackRow, ...prev]);
      resetForm();
      setJustSent(true);
      try {
        (window as any).desktopAPI?.notify?.('Thanks for the feedback', 'Your report was sent to the Stuard team.');
      } catch {
        /* notifications are best-effort */
      }
      window.setTimeout(() => setJustSent(false), 4000);
    } catch (err: any) {
      setError(err?.message ? `Couldn't send feedback: ${err.message}` : "Couldn't send feedback. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const counts = useMemo(() => {
    let bugs = 0;
    let ideas = 0;
    for (const it of items) {
      if (it.type === 'feature') ideas += 1;
      else bugs += 1;
    }
    return { bugs, ideas };
  }, [items]);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 pb-8">
      {/* Compose */}
      <form onSubmit={handleSubmit} className="dashboard-card p-5 md:p-6 space-y-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color:color-mix(in_srgb,var(--primary)_14%,transparent)] text-[color:var(--primary)]">
            <MessageSquare className="h-[18px] w-[18px]" />
          </div>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-theme-fg leading-5">Share feedback</h2>
            <p className="mt-0.5 text-[13px] text-theme-muted leading-5">
              Report a bug or suggest an idea — it goes straight to the Stuard team.
            </p>
          </div>
        </div>

        {/* Type */}
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => setType('bug')}
            className={clsx(
              'flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors',
              type === 'bug'
                ? 'bg-red-500/12 border-red-500/40 text-red-600 dark:text-red-400'
                : 'border-theme text-theme-muted hover:bg-theme-hover',
            )}
          >
            <Bug className="h-4 w-4" />
            Bug
          </button>
          <button
            type="button"
            onClick={() => setType('feature')}
            className={clsx(
              'flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors',
              type === 'feature'
                ? 'bg-amber-500/12 border-amber-500/40 text-amber-600 dark:text-amber-400'
                : 'border-theme text-theme-muted hover:bg-theme-hover',
            )}
          >
            <Lightbulb className="h-4 w-4" />
            Idea
          </button>
        </div>

        {/* Title */}
        <div className="space-y-1.5">
          <label className="flex items-center justify-between text-[12px] font-semibold text-theme-muted">
            <span>Title</span>
            <span className="tabular-nums opacity-70">{title.length}/200</span>
          </label>
          <input
            type="text"
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={type === 'bug' ? 'Brief summary of the issue…' : 'What would you like Stuard to do?'}
            className={inputCls}
          />
        </div>

        {/* Description */}
        <div className="space-y-1.5">
          <label className="block text-[12px] font-semibold text-theme-muted">Details</label>
          <textarea
            value={description}
            maxLength={5000}
            rows={5}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={
              type === 'bug'
                ? 'Steps to reproduce, what you expected, and what actually happened…'
                : 'Describe the idea, who it helps, and why it matters…'
            }
            className={clsx(inputCls, 'resize-none leading-relaxed')}
          />
        </div>

        {/* Severity — bugs only */}
        {type === 'bug' && (
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-[12px] font-semibold text-theme-muted">
              <AlertTriangle className="h-3.5 w-3.5" />
              Severity
            </label>
            <div className="grid grid-cols-4 gap-2">
              {SEVERITY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  title={opt.hint}
                  onClick={() => setSeverity(opt.value)}
                  className={clsx(
                    'rounded-lg border px-2 py-2 text-[12px] font-medium transition-colors',
                    severityChipCls(opt.tone, severity === opt.value),
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Labels */}
        <div className="space-y-1.5">
          <label className="flex items-center gap-1.5 text-[12px] font-semibold text-theme-muted">
            <Tag className="h-3.5 w-3.5" />
            Labels <span className="font-normal opacity-60">(optional)</span>
          </label>
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTED_LABELS.map((label) => {
              const active = labels.includes(label);
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => toggleLabel(label)}
                  className={clsx(
                    'rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors',
                    active
                      ? 'border-[color:color-mix(in_srgb,var(--primary)_38%,transparent)] text-[color:var(--primary)] bg-[color:color-mix(in_srgb,var(--primary)_12%,transparent)]'
                      : 'border-theme text-theme-muted hover:bg-theme-hover',
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Attachments */}
        <div className="space-y-1.5">
          <label className="flex items-center gap-1.5 text-[12px] font-semibold text-theme-muted">
            <Paperclip className="h-3.5 w-3.5" />
            Images & media <span className="font-normal opacity-60">(optional)</span>
          </label>
          <FeedbackAttachmentPicker
            attachments={attachments}
            onChange={setAttachments}
            disabled={submitting}
            allowCapture
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 pt-1">
          <div className="min-w-0 text-[12px]">
            {error ? (
              <span className="text-red-500">{error}</span>
            ) : justSent ? (
              <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Sent — thank you!
              </span>
            ) : (
              <span className="text-theme-muted">
                {isValid ? 'Ready to send.' : 'Add a short title and a few details.'}
              </span>
            )}
          </div>
          <button
            type="submit"
            disabled={!isValid || submitting}
            className="dashboard-button-primary inline-flex items-center gap-2 px-5 py-2.5 text-sm"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {submitting ? 'Sending…' : 'Send feedback'}
          </button>
        </div>
      </form>

      {/* Your submissions */}
      <div className="dashboard-card p-5 md:p-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-[14px] font-semibold text-theme-fg">Your submissions</h3>
          {items.length > 0 && (
            <span className="text-[12px] text-theme-muted tabular-nums">
              {counts.bugs} {counts.bugs === 1 ? 'bug' : 'bugs'} · {counts.ideas} {counts.ideas === 1 ? 'idea' : 'ideas'}
            </span>
          )}
        </div>

        {listLoading && items.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-theme-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading your feedback…
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-theme-hover text-theme-muted">
              <Inbox className="h-5 w-5" />
            </div>
            <p className="text-[13px] font-medium text-theme-fg">No feedback yet</p>
            <p className="max-w-xs text-[12px] text-theme-muted">
              Anything you send will show up here so you can track its status.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-[color:var(--dashboard-panel-border)]">
            {items.map((it) => {
              const badge = statusBadge(it.status);
              const isBug = it.type !== 'feature';
              return (
                <li key={it.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                  <div
                    className={clsx(
                      'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
                      isBug
                        ? 'bg-red-500/12 text-red-600 dark:text-red-400'
                        : 'bg-amber-500/12 text-amber-600 dark:text-amber-400',
                    )}
                  >
                    {isBug ? <Bug className="h-3.5 w-3.5" /> : <Lightbulb className="h-3.5 w-3.5" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13.5px] font-medium text-theme-fg">{it.title}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-theme-muted">
                      <span>{timeAgo(it.created_at)}</span>
                      {isBug && it.severity && (
                        <>
                          <span className="opacity-40">·</span>
                          <span className="capitalize">{it.severity} severity</span>
                        </>
                      )}
                      {Array.isArray(it.labels) && it.labels.length > 0 && (
                        <>
                          <span className="opacity-40">·</span>
                          <span className="truncate">{it.labels.join(', ')}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <span
                    className={clsx(
                      'mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                      badge.cls,
                    )}
                  >
                    {badge.label}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

export default FeedbackView;
