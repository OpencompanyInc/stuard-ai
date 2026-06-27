/**
 * ResearchPreview — bespoke chain-of-thought renderers for the Research Mode
 * tools (research-mode.ts). Without these the research tools fall back to the
 * generic key/value badge preview, which buries the useful signal (the sources
 * found, the notes distilled, the registry growth). These mirror the language of
 * WebSearchSources / ScrapeResultPreview but add the research-specific framing:
 * source ids (s1, s2…), note kinds, and the live registry counters.
 *
 * Everything is read off the tool RESULT (and, where richer, the call ARGS —
 * research_note's text only lives in args). The cyan RESEARCH_ACCENT keeps these
 * visually tied to the ActiveResearchBar / report viewer.
 */
import React from 'react';
import {
  Telescope,
  Search,
  StickyNote,
  FileText,
  Link2,
  BookOpen,
  HelpCircle,
  Lightbulb,
  CircleAlert,
  CheckCircle2,
  LogOut,
  ClipboardList,
  type LucideIcon,
} from 'lucide-react';
import { faviconUrl, truncatePreviewText } from '../helpers/payload';
import { stripMarkdown } from '../helpers/markdown';

const ACCENT = '#06b6d4';

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function snippetOf(text: unknown, max = 240): string {
  return truncatePreviewText(stripMarkdown(String(text || '').trim()), max);
}

// ─── Shared bits ─────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  backgroundColor: 'color-mix(in srgb, var(--sidebar-item-hover) 25%, transparent)',
};

const SourceIdChip: React.FC<{ id: string }> = ({ id }) => (
  <span
    className="shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide tabular-nums"
    style={{ backgroundColor: `${ACCENT}1f`, color: ACCENT }}
  >
    {id}
  </span>
);

const StatChip: React.FC<{ icon?: React.ReactNode; label: string; value: React.ReactNode; accent?: boolean }> = ({
  icon,
  label,
  value,
  accent,
}) => (
  <span
    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium tabular-nums"
    style={{
      backgroundColor: accent ? `${ACCENT}14` : 'color-mix(in srgb, var(--sidebar-item-hover) 50%, transparent)',
      color: accent ? ACCENT : 'var(--foreground)',
    }}
  >
    {icon}
    <span className="text-theme-muted">{label}</span>
    <span className="font-semibold">{value}</span>
  </span>
);

interface SourceRow {
  source_id?: string;
  id?: string;
  title?: string | null;
  url: string;
  published?: string;
  content?: string;
  snippet?: string;
  read?: boolean;
  notes?: number;
  noteCount?: number;
}

const SourceCard: React.FC<{ source: SourceRow }> = ({ source }) => {
  const host = hostOf(source.url);
  const id = source.source_id || source.id;
  const snippet = snippetOf(source.content || source.snippet);
  const notes = typeof source.notes === 'number' ? source.notes : source.noteCount;
  return (
    <div className="overflow-hidden rounded-lg border border-cot-subtle" style={cardStyle}>
      <a
        href={source.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 px-2.5 py-1.5 transition-opacity hover:opacity-80"
        title={source.url}
      >
        {id ? <SourceIdChip id={id} /> : null}
        <img
          src={faviconUrl(source.url)}
          alt=""
          className="h-3.5 w-3.5 shrink-0 rounded-sm"
          loading="lazy"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
        <div className="min-w-0 flex-1">
          <div
            className="truncate text-[12px] font-medium"
            style={{ color: 'color-mix(in srgb, var(--foreground) 90%, transparent)' }}
          >
            {source.title || host}
          </div>
          <div className="truncate text-[10px] text-theme-muted">
            {host}
            {source.read ? ' · read' : ''}
            {typeof notes === 'number' && notes > 0 ? ` · ${notes} note${notes === 1 ? '' : 's'}` : ''}
          </div>
        </div>
      </a>
      {snippet ? (
        <div
          className="line-clamp-2 px-2.5 pb-1.5 text-[11px] leading-relaxed"
          style={{ color: 'color-mix(in srgb, var(--foreground) 65%, transparent)' }}
        >
          {snippet}
        </div>
      ) : null}
    </div>
  );
};

// ─── research_search ─────────────────────────────────────────────────────────

interface SearchGroup {
  query: string;
  new_sources?: SourceRow[];
  seen_source_ids?: string[];
  provider_errors?: string[];
}

export const ResearchSearchPreview: React.FC<{ result: any }> = ({ result }) => {
  const searches: SearchGroup[] = Array.isArray(result?.searches) ? result.searches : [];
  if (searches.length === 0) return null;
  const stats = result?.stats || {};

  return (
    <div className="flex flex-col gap-2.5">
      {searches.map((group, gi) => {
        const sources = Array.isArray(group.new_sources) ? group.new_sources : [];
        const seen = Array.isArray(group.seen_source_ids) ? group.seen_source_ids.length : 0;
        return (
          <div key={`${group.query}-${gi}`} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <Search className="h-3 w-3 shrink-0 text-theme-muted" strokeWidth={1.75} />
              <span
                className="min-w-0 flex-1 truncate text-[12px] font-medium"
                style={{ color: 'color-mix(in srgb, var(--foreground) 80%, transparent)' }}
                title={group.query}
              >
                {group.query}
              </span>
              {seen > 0 ? (
                <span className="shrink-0 text-[10px] text-theme-muted">{seen} already seen</span>
              ) : null}
            </div>
            {sources.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                {sources.slice(0, 5).map((s, i) => (
                  <SourceCard key={`${s.url}-${i}`} source={s} />
                ))}
                {sources.length > 5 ? (
                  <span className="text-[10px] text-theme-muted">+{sources.length - 5} more new</span>
                ) : null}
              </div>
            ) : seen > 0 ? (
              <span className="pl-[18px] text-[11px] text-theme-muted">No new sources — all already in the registry.</span>
            ) : null}
            {Array.isArray(group.provider_errors) && group.provider_errors.length > 0 ? (
              <span className="pl-[18px] text-[10px] text-amber-500/90">{group.provider_errors.join(' · ')}</span>
            ) : null}
          </div>
        );
      })}
      {(typeof stats.new_sources === 'number' || typeof stats.total_sources === 'number') ? (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          {typeof stats.new_sources === 'number' ? (
            <StatChip icon={<Link2 className="h-3 w-3" strokeWidth={1.75} />} label="new" value={stats.new_sources} accent />
          ) : null}
          {typeof stats.already_seen === 'number' && stats.already_seen > 0 ? (
            <StatChip label="seen" value={stats.already_seen} />
          ) : null}
          {typeof stats.total_sources === 'number' ? (
            <StatChip label="registry" value={stats.total_sources} />
          ) : null}
          {stats.warning ? (
            <span className="text-[10px] text-amber-500/90">{stats.warning}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

// ─── research_read ───────────────────────────────────────────────────────────

export const ResearchReadPreview: React.FC<{ result: any }> = ({ result }) => {
  if (!result || typeof result !== 'object') return null;
  const url = typeof result.url === 'string' ? result.url : '';
  const failed = result.ok === false || (!!result.error && !result.content);
  const host = url ? hostOf(url) : '';
  const id = typeof result.source_id === 'string' ? result.source_id : undefined;
  const snippet = snippetOf(result.content || result.preview_start, 400);

  const lineInfo = (() => {
    const ls = Number(result.line_start);
    const le = Number(result.line_end);
    const total = Number(result.total_lines);
    if (Number.isFinite(ls) && Number.isFinite(le)) {
      return `L${ls}–${le}${Number.isFinite(total) ? ` of ${total}` : ''}`;
    }
    if (Number.isFinite(total)) return `${total} lines`;
    return '';
  })();

  return (
    <div className="overflow-hidden rounded-lg border border-cot-subtle" style={cardStyle}>
      <a
        href={url || undefined}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 px-2.5 py-1.5 transition-opacity hover:opacity-80"
        title={url}
      >
        {id ? <SourceIdChip id={id} /> : null}
        <BookOpen className="h-3.5 w-3.5 shrink-0 text-theme-muted" strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          <div
            className="truncate text-[12px] font-medium"
            style={{ color: 'color-mix(in srgb, var(--foreground) 90%, transparent)' }}
          >
            {result.title || host || 'Read source'}
          </div>
          <div className="truncate text-[10px] text-theme-muted">
            {host}{lineInfo ? ` · ${lineInfo}` : ''}
          </div>
        </div>
      </a>
      {failed ? (
        <div className="px-2.5 pb-1.5 text-[11px] text-red-500/90">{result.error || result.message}</div>
      ) : snippet ? (
        <div
          className="line-clamp-3 px-2.5 pb-1.5 text-[11px] leading-relaxed"
          style={{ color: 'color-mix(in srgb, var(--foreground) 65%, transparent)' }}
        >
          {snippet}
        </div>
      ) : null}
    </div>
  );
};

// ─── research_note ───────────────────────────────────────────────────────────

type NoteKind = 'finding' | 'gap' | 'question' | 'hypothesis' | 'answer';

const NOTE_KINDS: Record<NoteKind, { label: string; color: string; Icon: LucideIcon }> = {
  finding: { label: 'Finding', color: ACCENT, Icon: StickyNote },
  answer: { label: 'Answer', color: '#10b981', Icon: CheckCircle2 },
  question: { label: 'Question', color: '#f59e0b', Icon: HelpCircle },
  gap: { label: 'Gap', color: '#f97316', Icon: CircleAlert },
  hypothesis: { label: 'Hypothesis', color: '#a855f7', Icon: Lightbulb },
};

interface NoteArg {
  text: string;
  kind?: NoteKind;
  source_ids?: string[];
  topic?: string;
}

export const ResearchNotePreview: React.FC<{ args: any; result: any }> = ({ args, result }) => {
  const notes: NoteArg[] = Array.isArray(args?.notes) ? args.notes : [];
  const added: string[] = Array.isArray(result?.added) ? result.added : [];
  const totalNotes = typeof result?.total_notes === 'number' ? result.total_notes : undefined;
  const openQuestions = typeof result?.open_questions === 'number' ? result.open_questions : undefined;

  if (notes.length === 0) {
    // No args available (e.g. replayed history) — fall back to a compact summary.
    if (added.length === 0 && totalNotes === undefined) return null;
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <StatChip icon={<StickyNote className="h-3 w-3" strokeWidth={1.75} />} label="added" value={added.length || '—'} accent />
        {totalNotes !== undefined ? <StatChip label="total notes" value={totalNotes} /> : null}
        {openQuestions ? <StatChip label="open" value={openQuestions} /> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {notes.slice(0, 6).map((note, i) => {
        const meta = NOTE_KINDS[(note.kind as NoteKind) || 'finding'] || NOTE_KINDS.finding;
        const noteId = added[i];
        const sourceIds = Array.isArray(note.source_ids) ? note.source_ids : [];
        return (
          <div key={i} className="rounded-lg border border-cot-subtle px-2.5 py-1.5" style={cardStyle}>
            <div className="mb-0.5 flex items-center gap-1.5">
              <span
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
                style={{ backgroundColor: `${meta.color}1f`, color: meta.color }}
              >
                <meta.Icon className="h-2.5 w-2.5" strokeWidth={2} />
                {meta.label}
              </span>
              {note.topic ? (
                <span className="truncate text-[10px] text-theme-muted">{note.topic}</span>
              ) : null}
              {noteId ? <span className="ml-auto shrink-0 text-[9px] font-semibold text-theme-muted tabular-nums">{noteId}</span> : null}
            </div>
            <div
              className="text-[11px] leading-relaxed"
              style={{ color: 'color-mix(in srgb, var(--foreground) 80%, transparent)' }}
            >
              {snippetOf(note.text, 280)}
            </div>
            {sourceIds.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-1">
                {sourceIds.map((sid) => <SourceIdChip key={sid} id={sid} />)}
              </div>
            ) : null}
          </div>
        );
      })}
      {notes.length > 6 ? <span className="text-[10px] text-theme-muted">+{notes.length - 6} more notes</span> : null}
      {(totalNotes !== undefined || openQuestions) ? (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          {totalNotes !== undefined ? <StatChip label="total notes" value={totalNotes} accent /> : null}
          {openQuestions ? <StatChip icon={<HelpCircle className="h-3 w-3" strokeWidth={1.75} />} label="open" value={openQuestions} /> : null}
        </div>
      ) : null}
    </div>
  );
};

// ─── research_status / research_compile ──────────────────────────────────────

interface StatusNote {
  id?: string;
  kind?: NoteKind;
  topic?: string;
  text: string;
  sources?: string[];
  resolved?: boolean;
}

const NoteLine: React.FC<{ note: StatusNote }> = ({ note }) => {
  const meta = NOTE_KINDS[(note.kind as NoteKind) || 'finding'] || NOTE_KINDS.finding;
  return (
    <div className="flex items-start gap-1.5">
      <span className="mt-[3px] shrink-0" style={{ color: meta.color }}>
        <meta.Icon className="h-3 w-3" strokeWidth={2} />
      </span>
      <span
        className={`line-clamp-2 text-[11px] leading-relaxed ${note.resolved ? 'line-through opacity-50' : ''}`}
        style={{ color: 'color-mix(in srgb, var(--foreground) 75%, transparent)' }}
      >
        {snippetOf(note.text, 200)}
      </span>
    </div>
  );
};

const ResearchDashboard: React.FC<{ result: any; icon: React.ReactNode; title: string }> = ({ result, icon, title }) => {
  const sources: SourceRow[] = Array.isArray(result?.sources) ? result.sources : [];
  const notes: StatusNote[] = Array.isArray(result?.notes) ? result.notes : [];
  const queries: string[] = Array.isArray(result?.queries) ? result.queries : [];
  const openQuestions: any[] = Array.isArray(result?.open_questions) ? result.open_questions : [];
  const brief = typeof result?.brief === 'string' ? result.brief : '';

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-cot-subtle p-2.5" style={cardStyle}>
      <div className="flex items-center gap-1.5">
        <span style={{ color: ACCENT }}>{icon}</span>
        <span className="text-[11px] font-semibold" style={{ color: ACCENT }}>{title}</span>
        {result?.status ? (
          <span className="ml-auto text-[9px] font-bold uppercase tracking-wide text-theme-muted">{result.status}</span>
        ) : null}
      </div>

      {brief ? (
        <div className="text-[11px] leading-relaxed" style={{ color: 'color-mix(in srgb, var(--foreground) 75%, transparent)' }}>
          {snippetOf(brief, 200)}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        <StatChip icon={<Link2 className="h-3 w-3" strokeWidth={1.75} />} label="sources" value={sources.length} accent />
        <StatChip icon={<StickyNote className="h-3 w-3" strokeWidth={1.75} />} label="notes" value={notes.length} />
        {queries.length > 0 ? <StatChip icon={<Search className="h-3 w-3" strokeWidth={1.75} />} label="queries" value={queries.length} /> : null}
        {openQuestions.length > 0 ? <StatChip icon={<HelpCircle className="h-3 w-3" strokeWidth={1.75} />} label="open" value={openQuestions.length} /> : null}
      </div>

      {notes.length > 0 ? (
        <div className="flex flex-col gap-1 border-t border-t-cot-faint pt-2">
          {notes.slice(0, 5).map((n, i) => <NoteLine key={n.id || i} note={n} />)}
          {notes.length > 5 ? <span className="text-[10px] text-theme-muted">+{notes.length - 5} more notes</span> : null}
        </div>
      ) : null}

      {sources.length > 0 ? (
        <div className="flex flex-col gap-1.5 border-t border-t-cot-faint pt-2">
          {sources.slice(0, 4).map((s, i) => <SourceCard key={(s.id || s.url) + i} source={s} />)}
          {sources.length > 4 ? <span className="text-[10px] text-theme-muted">+{sources.length - 4} more sources</span> : null}
        </div>
      ) : null}
    </div>
  );
};

export const ResearchStatusPreview: React.FC<{ result: any }> = ({ result }) => (
  <ResearchDashboard result={result} icon={<ClipboardList className="h-3.5 w-3.5" strokeWidth={1.75} />} title="Research status" />
);

export const ResearchCompilePreview: React.FC<{ result: any }> = ({ result }) => (
  <ResearchDashboard result={result} icon={<FileText className="h-3.5 w-3.5" strokeWidth={1.75} />} title="Compiled for report" />
);

// ─── research_report ─────────────────────────────────────────────────────────

export const ResearchReportPreview: React.FC<{ result: any }> = ({ result }) => {
  if (!result || typeof result !== 'object') return null;
  const report = result.report && typeof result.report === 'object' ? result.report : null;
  const title = report?.title || 'Research report';
  const markdown = typeof report?.markdown === 'string' ? report.markdown : '';
  const conversationId = typeof result.conversation_id === 'string' ? result.conversation_id : '';
  const totalSources = typeof result.total_sources === 'number' ? result.total_sources : undefined;
  const totalNotes = typeof result.total_notes === 'number' ? result.total_notes : undefined;

  // Re-open the document by replaying the same event ChatView listens to for the
  // auto-open (bumps the report nonce → ResearchReportViewer mounts).
  const openReport = () => {
    if (!markdown || !conversationId) return;
    window.dispatchEvent(new CustomEvent('research-mode-changed', {
      detail: { tool: 'research_report', conversationId, report: { title, markdown } },
    }));
  };

  return (
    <div className="overflow-hidden rounded-lg border" style={{ borderColor: `${ACCENT}33`, backgroundColor: `${ACCENT}0f` }}>
      <div className="flex items-center gap-2.5 px-3 py-2">
        <span
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] ring-1 ring-inset"
          style={{ backgroundColor: `${ACCENT}14`, color: ACCENT, ['--tw-ring-color' as any]: `${ACCENT}33` }}
          aria-hidden
        >
          <FileText className="h-3.5 w-3.5" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-theme-muted/70 leading-none">
            Report delivered
          </div>
          <div className="mt-0.5 truncate text-[12.5px] font-semibold" style={{ color: 'var(--foreground)' }} title={title}>
            {title}
          </div>
          {(totalSources !== undefined || totalNotes !== undefined) ? (
            <div className="mt-0.5 text-[10px] text-theme-muted tabular-nums">
              {totalSources !== undefined ? `${totalSources} source${totalSources === 1 ? '' : 's'}` : ''}
              {totalSources !== undefined && totalNotes !== undefined ? ' · ' : ''}
              {totalNotes !== undefined ? `${totalNotes} note${totalNotes === 1 ? '' : 's'}` : ''}
            </div>
          ) : null}
        </div>
        {markdown && conversationId ? (
          <button
            onClick={openReport}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-opacity hover:opacity-80"
            style={{ backgroundColor: `${ACCENT}1f`, color: ACCENT }}
            title={`Open report: ${title}`}
          >
            <BookOpen className="h-3.5 w-3.5" strokeWidth={1.75} />
            Open
          </button>
        ) : null}
      </div>
    </div>
  );
};

// ─── enter / exit research mode ──────────────────────────────────────────────

export const EnterResearchModePreview: React.FC<{ result: any }> = ({ result }) => {
  if (!result || typeof result !== 'object') return null;
  const brief = typeof result.brief === 'string' ? result.brief : '';
  const created = result.created !== false;
  const totalSources = typeof result.total_sources === 'number' ? result.total_sources : undefined;
  const totalNotes = typeof result.total_notes === 'number' ? result.total_notes : undefined;

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border px-3 py-2" style={{ borderColor: `${ACCENT}33`, backgroundColor: `${ACCENT}0f` }}>
      <div className="flex items-center gap-1.5">
        <Telescope className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} style={{ color: ACCENT }} />
        <span className="text-[11px] font-semibold" style={{ color: ACCENT }}>
          {created ? 'Research Mode started' : 'Research Mode updated'}
        </span>
        {(totalSources || totalNotes) ? (
          <span className="ml-auto text-[10px] text-theme-muted tabular-nums">
            {totalSources ? `${totalSources} sources` : ''}{totalSources && totalNotes ? ' · ' : ''}{totalNotes ? `${totalNotes} notes` : ''}
          </span>
        ) : null}
      </div>
      {brief ? (
        <div className="text-[11px] leading-relaxed" style={{ color: 'color-mix(in srgb, var(--foreground) 75%, transparent)' }}>
          {snippetOf(brief, 240)}
        </div>
      ) : null}
    </div>
  );
};

export const ExitResearchModePreview: React.FC = () => (
  <div className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] text-theme-muted" style={cardStyle}>
    <LogOut className="h-3 w-3" strokeWidth={1.75} />
    Research Mode ended
  </div>
);
