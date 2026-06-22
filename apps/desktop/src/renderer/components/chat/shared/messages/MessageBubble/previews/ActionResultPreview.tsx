import React from 'react';
import {
  AlertTriangle,
  Check,
  ExternalLink,
  Paperclip,
  Plug,
} from 'lucide-react';
import type { ToolCall } from '../../../../../../hooks/useAgent';
import { IntegrationLogo } from '../../../../../IntegrationLogo';
import { toolToBrand, type ToolBrand } from '../../../../../../utils/toolBrand';
import { humanizeToolName } from '../helpers/toolLabels';
import { truncatePreviewText } from '../helpers/payload';

// ──────────────────────────────────────────────────────────────────────────────
// Bespoke result cards for "action" tools — email, calendar, Drive, Slack, X,
// Notion, GitHub, … — so the chain-of-thought narrates *what happened* ("Email
// sent to 2 people") instead of dumping the raw result envelope ("Ok: true ·
// Message: 1 field · Attachments Requested: 0"). Both success and failure get a
// branded, human card; failures explain the cause and how to fix it rather than
// surfacing a bare error string.
//
// `getActionResultPreview` / `getActionErrorCard` return `null` for tools they
// don't recognise so the caller falls through to the generic preview.
// ──────────────────────────────────────────────────────────────────────────────

interface ActionDescriptor {
  title: string;
  /** Short muted lines under the title (recipient, subject, file name, …). */
  meta?: React.ReactNode[];
  /** Pill chips (attachment count, role, channel, …). */
  chips?: string[];
  /** A single primary snippet (tweet/message body) shown in a quote block. */
  body?: string;
  /** Optional "open" link (tweet URL, doc URL, PR URL, …). */
  link?: { href: string; label: string };
}

// ── value helpers ─────────────────────────────────────────────────────────────

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean);
  if (typeof value === 'string') {
    return value
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Pull the first url-ish string out of a result object (links to the artifact). */
function findUrl(result: any): string | null {
  if (!result || typeof result !== 'object') return null;
  const direct =
    result.url ||
    result.link ||
    result.htmlLink ||
    result.html_url ||
    result.permalink ||
    result.webViewLink ||
    result.tweet_url ||
    result?.file?.webViewLink ||
    result?.event?.htmlLink ||
    result?.message?.permalink ||
    result?.page?.url;
  if (typeof direct === 'string' && /^https?:\/\//i.test(direct)) return direct;
  return null;
}

function hostLabel(url: string, fallback = 'Open'): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return fallback;
  }
}

/** Format an event start that may be `{ dateTime }` / `{ date }` / a raw string. */
function formatWhen(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const dt = str(o.dateTime) || str(o.date);
    if (dt) {
      const d = new Date(dt);
      if (!Number.isNaN(d.getTime())) {
        return d.toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: o.date ? undefined : 'numeric',
          minute: o.date ? undefined : '2-digit',
        });
      }
      return dt;
    }
  }
  return null;
}

// ── success descriptors ───────────────────────────────────────────────────────

const ACTION_VERBS = new Set([
  'send', 'post', 'create', 'add', 'update', 'edit', 'delete', 'remove', 'share',
  'upload', 'download', 'schedule', 'reply', 'like', 'repost', 'comment', 'publish',
  'set', 'move', 'rename', 'invite', 'insert', 'submit', 'complete', 'archive', 'star',
  'append', 'write', 'clear', 'merge', 'close', 'assign', 'label', 'react', 'pin', 'dm',
]);

// Token-exact so reads/lists never trip an action card: "tasks_list" → [tasks,
// list] has no verb (stays a list), while "config_set" → [config, set] does.
// (A substring check would mislabel e.g. "get_settings" via "set".)
function looksLikeAction(name: string): boolean {
  return name.split(/[_-]/).some((t) => ACTION_VERBS.has(t));
}

/** Recipients → first few + overflow count, as muted line. */
function recipientsLine(args: any): React.ReactNode | null {
  const to = asStringList(args?.to);
  const cc = asStringList(args?.cc);
  const all = [...to, ...cc];
  if (all.length === 0) return null;
  const shown = all.slice(0, 3).join(', ');
  const extra = all.length > 3 ? ` +${all.length - 3} more` : '';
  return `To ${shown}${extra}`;
}

/**
 * Map a known action tool to a rich descriptor. Returns null for tools we don't
 * have a bespoke template for (the generic branded fallback may still apply).
 */
function describeSuccess(name: string, args: any, result: any): ActionDescriptor | null {
  // ── Email ──────────────────────────────────────────────────────────────────
  if (
    name === 'gmail_send_message' || name === 'gmail_send' || name === 'send_email' ||
    name === 'google_send_mail' || name === 'outlook_send_message' || name === 'outlook_send' ||
    name === 'email_send'
  ) {
    const meta: React.ReactNode[] = [];
    const rcpt = recipientsLine(args);
    if (rcpt) meta.push(rcpt);
    const subject = str(args?.subject);
    if (subject) meta.push(`“${truncatePreviewText(subject, 80)}”`);
    const included = num(result?.attachmentsIncluded) ?? num(result?.attachments_included) ?? 0;
    const chips: string[] = [];
    if (included > 0) chips.push(`${included} attachment${included === 1 ? '' : 's'}`);
    return { title: 'Email sent', meta, chips };
  }

  // ── Google Calendar ──────────────────────────────────────────────────────────
  if (name === 'calendar_create_event' || name === 'calendar_quick_add') {
    const meta: React.ReactNode[] = [];
    const summary = str(args?.summary) || str(args?.text) || str(result?.event?.summary);
    if (summary) meta.push(summary);
    const when = formatWhen(args?.start) || formatWhen(result?.event?.start);
    if (when) meta.push(when);
    return { title: 'Event added to calendar', meta, link: linkFrom(result) };
  }
  if (name === 'calendar_update_event') {
    return { title: 'Calendar event updated', meta: metaOne(str(args?.summary)), link: linkFrom(result) };
  }
  if (name === 'calendar_delete_event') {
    return { title: 'Calendar event removed' };
  }

  // ── Google Drive ─────────────────────────────────────────────────────────────
  if (name === 'drive_upload_file' || name === 'drive_create_file' || name === 'drive_create_from_text') {
    return { title: 'Saved to Drive', meta: metaOne(str(result?.file?.name) || str(args?.name)), link: linkFrom(result) };
  }
  if (name === 'drive_download_file' || name === 'drive_export_file') {
    return { title: 'Downloaded from Drive', meta: metaOne(str(result?.path) || str(args?.path)) };
  }
  if (name === 'drive_share_file') {
    const who = str(result?.permission?.emailAddress) || str(args?.emailAddress);
    const role = str(result?.permission?.role) || str(args?.role);
    return { title: 'Shared from Drive', meta: metaOne(who), chips: role ? [role] : undefined };
  }
  if (name === 'drive_create_folder') {
    return { title: 'Drive folder created', meta: metaOne(str(result?.file?.name) || str(args?.name)) };
  }
  if (name === 'drive_delete_file') return { title: 'Deleted from Drive' };
  if (name === 'drive_trash_file') return { title: 'Moved to Drive trash', meta: metaOne(str(result?.name)) };
  if (name === 'drive_move_file') return { title: 'Moved in Drive', meta: metaOne(str(result?.file?.name)) };
  if (name === 'drive_rename_file' || name === 'drive_copy_file') {
    return { title: name === 'drive_copy_file' ? 'Copied in Drive' : 'Renamed in Drive', meta: metaOne(str(result?.file?.name) || str(args?.name)) };
  }

  // ── Google Docs / Sheets / Tasks ─────────────────────────────────────────────
  if (name === 'docs_create' || name === 'docs_create_document') {
    return { title: 'Doc created', meta: metaOne(str(args?.title) || str(result?.title)), link: linkFrom(result) };
  }
  if (name.startsWith('docs_') && looksLikeAction(name)) {
    return { title: 'Doc updated', link: linkFrom(result) };
  }
  if (name === 'sheets_create') {
    return { title: 'Spreadsheet created', meta: metaOne(str(args?.title)), link: linkFrom(result) };
  }
  if (name.startsWith('sheets_') && looksLikeAction(name)) {
    const replies = num(result?.repliesCount);
    return { title: 'Spreadsheet updated', chips: replies && replies > 0 ? [`${replies} change${replies === 1 ? '' : 's'}`] : undefined };
  }
  if (name === 'tasks_insert' || name === 'tasks_create' || name === 'tasks_add') {
    return { title: 'Task added', meta: metaOne(str(args?.title)) };
  }
  if (name === 'tasks_complete') return { title: 'Task completed', meta: metaOne(str(args?.title)) };
  if (name === 'tasks_delete') return { title: 'Task deleted' };
  if (name.startsWith('tasks_') && looksLikeAction(name)) return { title: 'Task updated', meta: metaOne(str(args?.title)) };

  // ── X / Twitter ──────────────────────────────────────────────────────────────
  if (name === 'x_send_dm' || name === 'x_dm' || name === 'twitter_dm') {
    return { title: 'DM sent on X', body: str(args?.text) || undefined, link: linkFrom(result) };
  }
  if (name === 'x_reply' || name === 'twitter_reply') {
    return { title: 'Replied on X', body: str(args?.text) || undefined, link: linkFrom(result) };
  }
  if (name === 'x_like') return { title: 'Liked on X', link: linkFrom(result) };
  if (name === 'x_repost' || name === 'x_retweet') return { title: 'Reposted on X', link: linkFrom(result) };
  if (
    name === 'x' || name === 'x_post' || name === 'x_create_post' || name === 'x_tweet' ||
    name === 'x_create_tweet' || name === 'twitter_post' || name === 'twitter_tweet'
  ) {
    return { title: 'Posted to X', body: str(args?.text) || str(args?.status) || undefined, link: linkFrom(result) };
  }

  // ── Slack ────────────────────────────────────────────────────────────────────
  if (name === 'slack_post_message' || name === 'slack_send_message' || name === 'slack_send') {
    const channel = str(args?.channel) || str(args?.channel_id);
    return {
      title: 'Message sent to Slack',
      meta: channel ? metaOne(channel.startsWith('#') ? channel : `#${channel}`) : undefined,
      body: str(args?.text) || undefined,
      link: linkFrom(result),
    };
  }

  // ── Notion ───────────────────────────────────────────────────────────────────
  if (name === 'notion_create_page') {
    return { title: 'Notion page created', meta: metaOne(str(args?.title) || titleFromNotion(args)), link: linkFrom(result) };
  }
  if (name === 'notion_create_database') {
    return { title: 'Notion database created', meta: metaOne(str(args?.title)), link: linkFrom(result) };
  }
  if (name.startsWith('notion_') && looksLikeAction(name)) {
    return { title: 'Notion page updated', link: linkFrom(result) };
  }

  // ── GitHub ───────────────────────────────────────────────────────────────────
  if (name === 'github_create_issue') {
    const n = num(result?.number) ?? num(result?.issue?.number);
    return { title: n ? `Issue #${n} opened` : 'Issue opened', meta: metaOne(str(args?.title)), link: linkFrom(result) };
  }
  if (name === 'github_create_pull_request' || name === 'github_create_pr') {
    const n = num(result?.number) ?? num(result?.pull_request?.number);
    return { title: n ? `Pull request #${n} opened` : 'Pull request opened', meta: metaOne(str(args?.title)), link: linkFrom(result) };
  }
  if (name === 'github_create_comment' || name === 'github_comment' || name === 'github_add_comment') {
    return { title: 'Comment added on GitHub', body: str(args?.body) || undefined, link: linkFrom(result) };
  }
  if (name === 'github_create_release') {
    return { title: 'Release published', meta: metaOne(str(args?.name) || str(args?.tag_name)), link: linkFrom(result) };
  }

  // ── Discord ──────────────────────────────────────────────────────────────────
  if (name === 'discord_send_message' || name === 'discord_post' || name === 'discord_send') {
    return { title: 'Sent to Discord', body: str(args?.content) || str(args?.message) || undefined };
  }

  // ── WhatsApp / SMS ───────────────────────────────────────────────────────────
  if (name === 'whatsapp_send_message' || name === 'wa_send' || name === 'whatsapp_send') {
    return { title: 'Message sent on WhatsApp', meta: metaOne(str(args?.to)), body: str(args?.message) || str(args?.text) || undefined };
  }
  if (name === 'telnyx_send_sms' || name === 'send_sms') {
    return { title: 'SMS sent', meta: metaOne(str(args?.to)), body: str(args?.text) || str(args?.message) || undefined };
  }
  if (name === 'telnyx_send_mms' || name === 'send_mms') {
    return { title: 'MMS sent', meta: metaOne(str(args?.to)) };
  }

  // ── Reddit ───────────────────────────────────────────────────────────────────
  if (name === 'reddit_submit_post' || name === 'reddit_post' || name === 'reddit_submit') {
    const sub = str(args?.subreddit);
    return {
      title: 'Posted to Reddit',
      meta: sub ? metaOne(sub.startsWith('r/') ? sub : `r/${sub}`) : undefined,
      body: str(args?.title) || undefined,
      link: linkFrom(result),
    };
  }
  if (name === 'reddit_comment' || name === 'reddit_reply') {
    return { title: 'Reddit comment posted', body: str(args?.text) || undefined, link: linkFrom(result) };
  }

  return null;
}

function metaOne(value: string | null): React.ReactNode[] | undefined {
  return value ? [value] : undefined;
}

function linkFrom(result: any): { href: string; label: string } | undefined {
  const url = findUrl(result);
  return url ? { href: url, label: hostLabel(url) } : undefined;
}

function titleFromNotion(args: any): string | null {
  // Notion page title sometimes nests under properties.Name/title.
  const t = args?.properties?.Name?.title?.[0]?.text?.content || args?.properties?.title;
  return typeof t === 'string' && t.trim() ? t.trim() : null;
}

// ── presentational shell ──────────────────────────────────────────────────────

function BrandMark({ brand, tone }: { brand: ToolBrand | null; tone: 'success' | 'error' }) {
  return (
    <span
      className="relative flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-lg"
      style={{ background: 'color-mix(in srgb, var(--foreground) 8%, var(--card-bg) 92%)', boxShadow: '0 0 0 1px color-mix(in srgb, var(--foreground) 7%, transparent)' }}
    >
      {brand && (brand.logo || brand.useRemote) ? (
        <IntegrationLogo logoKey={brand.key} fallbackSrc={brand.logo} alt={brand.label} style={{ width: 16, height: 16 }} />
      ) : brand?.icon ? (
        <brand.icon style={{ width: 15, height: 15, color: brand.color || 'var(--foreground)' }} strokeWidth={2} />
      ) : (
        <Plug style={{ width: 14, height: 14, color: 'var(--foreground)' }} strokeWidth={2} />
      )}
      <span
        className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full"
        style={{ background: tone === 'success' ? '#22C55E' : 'var(--destructive)', boxShadow: '0 0 0 1.5px var(--card-bg)' }}
      >
        {tone === 'success'
          ? <Check style={{ width: 9, height: 9, color: '#fff' }} strokeWidth={3.5} />
          : <AlertTriangle style={{ width: 8.5, height: 8.5, color: '#fff' }} strokeWidth={3} />}
      </span>
    </span>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
      style={{ background: 'color-mix(in srgb, var(--sidebar-item-hover) 55%, transparent)', color: 'color-mix(in srgb, var(--foreground) 80%, transparent)' }}
    >
      {children}
    </span>
  );
}

const CARD_STYLE: React.CSSProperties = {
  background: 'color-mix(in srgb, var(--sidebar-item-hover) 22%, transparent)',
  boxShadow: '0 0 0 1px color-mix(in srgb, var(--foreground) 6%, transparent)',
};

function ActionCard({
  brand,
  tone,
  title,
  meta,
  chips,
  body,
  link,
}: ActionDescriptor & { brand: ToolBrand | null; tone: 'success' | 'error' }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl px-3 py-2.5" style={CARD_STYLE}>
      <BrandMark brand={brand} tone={tone} />
      <div className="min-w-0 flex-1">
        <div
          className="text-[12px] font-semibold leading-tight"
          style={{ color: tone === 'error' ? 'color-mix(in srgb, var(--destructive) 88%, var(--foreground))' : 'var(--foreground)' }}
        >
          {title}
        </div>
        {meta && meta.length > 0 ? (
          <div className="mt-0.5 space-y-0.5">
            {meta.map((m, i) => (
              <div key={i} className="truncate text-[11px] text-theme-muted">{m}</div>
            ))}
          </div>
        ) : null}
        {body ? (
          <div
            className="mt-1.5 line-clamp-3 rounded-lg px-2.5 py-1.5 text-[11px] leading-relaxed"
            style={{ background: 'color-mix(in srgb, var(--sidebar-item-hover) 30%, transparent)', color: 'color-mix(in srgb, var(--foreground) 78%, transparent)' }}
          >
            {truncatePreviewText(body, 280)}
          </div>
        ) : null}
        {chips && chips.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <Chip key={c}>
                {/attachment/i.test(c) ? <Paperclip style={{ width: 10, height: 10 }} /> : null}
                {c}
              </Chip>
            ))}
          </div>
        ) : null}
        {link ? (
          <a
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium transition-opacity hover:opacity-80"
            style={{ color: 'color-mix(in srgb, var(--primary) 90%, var(--foreground))' }}
          >
            <ExternalLink style={{ width: 11, height: 11 }} />
            {link.label}
          </a>
        ) : null}
      </div>
    </div>
  );
}

// ── public API ────────────────────────────────────────────────────────────────

/** A success card for known/branded action tools, or null to fall through. */
export function getActionResultPreview(tool: ToolCall): React.ReactNode | null {
  const name = (tool.tool || '').toLowerCase();
  const args = (tool.args || {}) as Record<string, any>;
  const result = tool.result;
  const brand = toolToBrand(name, args);

  const descriptor = describeSuccess(name, args, result);
  if (descriptor) {
    return <ActionCard {...descriptor} brand={brand} tone="success" />;
  }

  // Generic branded fallback: any *branded* integration tool that performed an
  // action (send/create/post/…) gets a clean "done" card instead of the raw
  // key-value envelope. Read/list/search tools (no action verb) fall through so
  // their actual payload still renders.
  if (brand && looksLikeAction(name)) {
    const title = humanizeToolName(stripBrandPrefix(name, brand));
    return <ActionCard title={`${brand.label}: ${title}`} brand={brand} tone="success" link={linkFrom(result)} />;
  }

  return null;
}

/** A friendly failure card for action tools, or null to fall through. */
export function getActionErrorCard(tool: ToolCall): React.ReactNode | null {
  const name = (tool.tool || '').toLowerCase();
  const args = (tool.args || {}) as Record<string, any>;
  const brand = toolToBrand(name, args);
  // Only take over failures for tools we'd brand — generic/unknown tool errors
  // keep their raw text so nothing is hidden.
  if (!brand) return null;

  const rawError =
    typeof tool.error === 'string'
      ? tool.error
      : tool.error
        ? JSON.stringify(tool.error)
        : typeof (tool.result as any)?.error === 'string'
          ? (tool.result as any).error
          : 'The action could not be completed.';

  const successTitle = describeSuccess(name, args, undefined)?.title || null;
  const { reason, hint } = explainError(rawError, brand);

  const meta: React.ReactNode[] = [reason];
  if (hint) meta.push(<span style={{ color: 'color-mix(in srgb, var(--foreground) 60%, transparent)' }}>{hint}</span>);

  return (
    <ActionCard
      title={failureTitle(successTitle, brand)}
      brand={brand}
      tone="error"
      meta={meta}
    />
  );
}

// Negate the past-tense success title so it reads as a clean failure:
// "Email sent" → "Email not sent", "Event added to calendar" → "Event not added
// to calendar". Falls back to "{Brand} action failed" when there's no verb.
const PAST_VERBS = ['sent', 'created', 'added', 'updated', 'posted', 'removed', 'deleted', 'shared', 'published', 'saved', 'downloaded', 'completed', 'opened'];
function failureTitle(successTitle: string | null, brand: ToolBrand): string {
  if (successTitle) {
    for (const v of PAST_VERBS) {
      const re = new RegExp(`\\b${v}\\b`, 'i');
      if (re.test(successTitle)) return successTitle.replace(re, `not ${v}`);
    }
  }
  return `${brand.label} action failed`;
}

function stripBrandPrefix(name: string, brand: ToolBrand): string {
  const prefixes = [`${brand.key}_`, 'google_', 'gh_', 'twitter_', 'x_', 'ig_', 'fb_', 'wa_'];
  for (const p of prefixes) {
    if (name.startsWith(p)) return name.slice(p.length);
  }
  return name;
}

/** Map a raw error code/message to a human reason + (optional) actionable hint. */
function explainError(raw: string, brand: ToolBrand): { reason: string; hint?: string } {
  const e = raw.toLowerCase();

  if (
    e.includes('missing_scopes') || e.includes('missing user context') || e.includes('not connected') ||
    e.includes('no token') || e.includes('token_invalid') || e.includes('invalid_grant') ||
    e.includes('unauthorized') || e.includes('401') || e.includes('reconnect') ||
    e.includes('account') && e.includes('expired')
  ) {
    return {
      reason: `${brand.label} isn’t connected (or its access expired).`,
      hint: `Reconnect ${brand.label} in Connected Apps, then try again.`,
    };
  }
  if (e.includes('rate') && e.includes('limit') || e.includes('429') || e.includes('too many requests')) {
    return { reason: `${brand.label} is rate-limiting requests right now.`, hint: 'Wait a moment and retry.' };
  }
  if (e.includes('timeout') || e.includes('timed out') || e.includes('etimedout')) {
    return { reason: `${brand.label} didn’t respond in time.`, hint: 'This is usually transient — try again.' };
  }
  if (e.includes('not found') || e.includes('404')) {
    return { reason: 'The target item could not be found.' };
  }
  if (e.includes('permission') || e.includes('forbidden') || e.includes('403')) {
    return { reason: `${brand.label} denied this action (insufficient permissions).`, hint: 'Check the connected account’s access scopes.' };
  }
  if (e.includes('quota')) {
    return { reason: `${brand.label} quota exceeded.` };
  }
  // Fall back to the raw message, trimmed.
  return { reason: truncatePreviewText(raw.replace(/^error:\s*/i, ''), 160) };
}
