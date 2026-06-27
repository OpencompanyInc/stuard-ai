import React from 'react';
import { clsx } from 'clsx';
import {
  Folder,
  File as FileIcon,
  Image as ImageIcon,
  FileText,
  FileSpreadsheet,
  ChevronRight,
  ArrowUp,
  Home,
  Loader2,
  Plus,
  Search,
  Eye,
  Paperclip,
  X,
  Check,
} from 'lucide-react';
import { useFileViewer } from './FileViewerContext';
import { classifyByExt } from './renderers';
import type { ContextItem } from '../FileNavigator';
import { useWorkspaceFileSearch } from '../workspace/useWorkspaceFileSearch';

interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
}

export interface WorkspaceFilesBrowserProps {
  onPreviewRequest: () => void;
  onAddContext?: (item: ContextItem) => void;
  accessToken?: string | null;
  contextPaths?: Array<{ path: string }>;
}

const QUICK_LOCATIONS: Array<{ label: string; path: string }> = [
  { label: 'Home', path: '~' },
  { label: 'Desktop', path: '~/Desktop' },
  { label: 'Docs', path: '~/Documents' },
  { label: 'Downloads', path: '~/Downloads' },
];

function parentOf(dir: string): string | null {
  if (!dir) return null;
  const cleaned = dir.replace(/[\\/]+$/, '');
  if (/^[a-zA-Z]:$/.test(cleaned)) return null;
  const idx = Math.max(cleaned.lastIndexOf('/'), cleaned.lastIndexOf('\\'));
  if (idx <= 0) return null;
  const parent = cleaned.slice(0, idx);
  return /^[a-zA-Z]:$/.test(parent) ? `${parent}\\` : parent;
}

function iconForEntry(entry: DirEntry) {
  if (entry.isDirectory) return <Folder className="w-4 h-4 text-primary/80" />;
  const ext = (entry.name.split('.').pop() || '').toLowerCase();
  const kind = classifyByExt(ext);
  if (kind === 'image') return <ImageIcon className="w-4 h-4 text-theme-muted" />;
  if (kind === 'sheet') return <FileSpreadsheet className="w-4 h-4 text-emerald-500/80" />;
  if (kind === 'text' || kind === 'pdf') return <FileText className="w-4 h-4 text-theme-muted" />;
  return <FileIcon className="w-4 h-4 text-theme-muted" />;
}

function fileLabel(result: any): string {
  return (
    String(result.display_name || result.filename || result.name || '').trim() ||
    String(result.path || '').split(/[\\/]/).pop() ||
    'Untitled'
  );
}

/** Sidebar file browser — search, folder browse, explicit Preview / Context actions. */
export const WorkspaceFilesBrowser: React.FC<WorkspaceFilesBrowserProps> = ({
  onPreviewRequest,
  onAddContext,
  accessToken,
  contextPaths = [],
}) => {
  const { openFile, defaultSource } = useFileViewer();
  const [dir, setDir] = React.useState('~');
  const [entries, setEntries] = React.useState<DirEntry[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<{ path: string; name: string; isDirectory: boolean } | null>(null);
  const [feedback, setFeedback] = React.useState<'preview' | 'context' | null>(null);

  const search = useWorkspaceFileSearch(accessToken);
  const indexed = Number(search.indexStats?.indexed_files || 0);
  const inContext = (path: string) => contextPaths.some((c) => c.path === path);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await (window as any).desktopAPI?.listDirectory?.(dir);
        if (cancelled) return;
        if (res?.ok && Array.isArray(res.entries)) {
          setEntries(res.entries);
        } else {
          setEntries([]);
          setError(res?.error || 'Could not open folder');
        }
      } catch (e: any) {
        if (!cancelled) {
          setEntries([]);
          setError(e?.message || 'Could not open folder');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [dir]);

  const currentAbsolute = React.useMemo(() => {
    if (entries.length > 0) {
      const first = entries[0].path;
      return parentOf(first) || first;
    }
    return dir === '~' ? '' : dir;
  }, [entries, dir]);

  const breadcrumb = React.useMemo(() => {
    if (!currentAbsolute) return ['Home'];
    return currentAbsolute.split(/[\\/]+/).filter(Boolean);
  }, [currentAbsolute]);

  const openFolder = (p: string) => {
    search.clearSearch();
    setSelected(null);
    setDir(p);
  };

  const goUp = () => {
    const parent = parentOf(currentAbsolute);
    if (parent) openFolder(parent);
  };

  const selectEntry = (entry: DirEntry) => {
    if (entry.isDirectory) {
      openFolder(entry.path);
      return;
    }
    setSelected({ path: entry.path, name: entry.name, isDirectory: false });
  };

  const openPreview = (path: string, name: string) => {
    openFile({ path, source: defaultSource, name });
    onPreviewRequest();
    setFeedback('preview');
    setTimeout(() => setFeedback(null), 1200);
  };

  const addToContext = (path: string, name: string, isDirectory = false) => {
    if (!onAddContext) return;
    onAddContext({ path, name, isDirectory, type: isDirectory ? 'directory' : 'file' });
    setFeedback('context');
    setTimeout(() => setFeedback(null), 1200);
  };

  const pickFiles = async () => {
    try {
      const paths: string[] = (await (window as any).desktopAPI?.previewPickFiles?.()) || [];
      for (const p of paths) {
        const name = p.split(/[\\/]/).pop() || p;
        openFile({ path: p, source: defaultSource, name });
      }
      if (paths.length > 0) onPreviewRequest();
    } catch { /* cancelled */ }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="px-2 pb-2 shrink-0">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-theme-muted pointer-events-none" />
          <input
            type="search"
            value={search.query}
            onChange={(e) => search.setQuery(e.target.value)}
            placeholder={indexed > 0 ? 'Search files…' : 'Search…'}
            className="w-full pl-7 pr-7 py-1.5 rounded-lg border border-theme/15 bg-theme-bg/40 text-[11px] text-theme-fg placeholder:text-theme-muted outline-none focus:border-primary/30"
          />
          {search.query && (
            <button
              onClick={() => { search.clearSearch(); setSelected(null); }}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-theme-muted hover:text-theme-fg"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {search.isSearching ? (
          <SearchResults
            results={search.results}
            loading={search.loading}
            semanticLoading={search.semanticLoading}
            error={search.error}
            searchMode={search.searchMode}
            inContext={inContext}
            onPreview={(path, name) => openPreview(path, name)}
            onAddContext={onAddContext ? (path, name) => addToContext(path, name) : undefined}
          />
        ) : (
          <>
            <div className="flex flex-wrap gap-1 px-2 pb-1.5 shrink-0">
              {QUICK_LOCATIONS.map((loc) => (
                <button
                  key={loc.path}
                  onClick={() => openFolder(loc.path)}
                  className="inline-flex items-center gap-0.5 border border-theme/15 px-1.5 py-0.5 text-[10px] font-medium text-theme-fg hover:bg-theme-hover rounded-md"
                >
                  {loc.path === '~' ? <Home className="w-2.5 h-2.5" /> : <Folder className="w-2.5 h-2.5" />}
                  {loc.label}
                </button>
              ))}
              <button
                onClick={pickFiles}
                className="ml-auto inline-flex items-center gap-0.5 rounded-md bg-primary/12 text-primary px-1.5 py-0.5 text-[10px] font-bold hover:bg-primary/20"
                title="Open file"
              >
                <Plus className="w-2.5 h-2.5" />
              </button>
            </div>

            <div className="flex items-center gap-0.5 px-2 py-1 border-y border-theme/10 shrink-0 min-w-0">
              <button
                onClick={goUp}
                disabled={!parentOf(currentAbsolute)}
                className="p-0.5 rounded text-theme-muted hover:bg-theme-hover disabled:opacity-30"
              >
                <ArrowUp className="w-3 h-3" />
              </button>
              <div className="flex items-center gap-0.5 min-w-0 overflow-x-auto text-[10px] text-theme-muted whitespace-nowrap">
                {breadcrumb.map((seg, i) => (
                  <span key={i} className="flex items-center gap-0.5 shrink-0">
                    {i > 0 && <ChevronRight className="w-2.5 h-2.5 opacity-50" />}
                    <span className={clsx(i === breadcrumb.length - 1 && 'text-theme-fg font-medium')}>{seg}</span>
                  </span>
                ))}
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-[11px] text-theme-muted">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
                </div>
              ) : error ? (
                <div className="px-2 py-8 text-center text-[11px] text-theme-muted">{error}</div>
              ) : entries.length === 0 ? (
                <div className="px-2 py-8 text-center text-[11px] text-theme-muted">Empty folder</div>
              ) : (
                entries.map((entry) => {
                  const isSelected = selected?.path === entry.path;
                  return (
                    <button
                      key={entry.path}
                      onClick={() => selectEntry(entry)}
                      className={clsx(
                        'w-full flex items-center gap-1.5 px-2 py-1.5 text-left transition-colors',
                        isSelected ? 'bg-primary/10 border-l-2 border-l-primary' : 'hover:bg-theme-hover border-l-2 border-l-transparent',
                      )}
                    >
                      <span className="shrink-0">{iconForEntry(entry)}</span>
                      <span className="flex-1 min-w-0 truncate text-[11px] text-theme-fg">{entry.name}</span>
                      {entry.isDirectory && <ChevronRight className="w-3 h-3 text-theme-muted shrink-0" />}
                    </button>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>

      {selected && !search.isSearching && (
        <FileActionBar
          name={selected.name}
          inContext={inContext(selected.path)}
          feedback={feedback}
          onPreview={() => openPreview(selected.path, selected.name)}
          onAddContext={onAddContext ? () => addToContext(selected.path, selected.name) : undefined}
          onDismiss={() => setSelected(null)}
        />
      )}
    </div>
  );
};

const FileActionBar: React.FC<{
  name: string;
  inContext: boolean;
  feedback: 'preview' | 'context' | null;
  onPreview: () => void;
  onAddContext?: () => void;
  onDismiss: () => void;
}> = ({ name, inContext, feedback, onPreview, onAddContext, onDismiss }) => (
  <div className="shrink-0 border-t border-theme/10 bg-theme-card/80 p-2 space-y-1.5">
    <div className="flex items-center gap-1 min-w-0">
      <span className="flex-1 truncate text-[11px] font-semibold text-theme-fg" title={name}>{name}</span>
      <button onClick={onDismiss} className="p-0.5 rounded text-theme-muted hover:text-theme-fg" title="Clear selection">
        <X className="w-3 h-3" />
      </button>
    </div>
    <div className="grid grid-cols-2 gap-1.5">
      <button
        onClick={onPreview}
        className={clsx(
          'inline-flex items-center justify-center gap-1 py-2 rounded-lg text-[11px] font-bold transition-colors',
          feedback === 'preview'
            ? 'bg-primary text-primary-fg'
            : 'bg-primary/15 text-primary hover:bg-primary/25',
        )}
      >
        {feedback === 'preview' ? <Check className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
        Preview
      </button>
      {onAddContext && (
        <button
          onClick={onAddContext}
          className={clsx(
            'inline-flex items-center justify-center gap-1 py-2 rounded-lg text-[11px] font-bold transition-colors border',
            feedback === 'context' || inContext
              ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
              : 'border-theme/15 text-theme-fg hover:bg-theme-hover',
          )}
        >
          {feedback === 'context' || inContext ? <Check className="w-3 h-3" /> : <Paperclip className="w-3 h-3" />}
          {inContext ? 'In context' : 'Context'}
        </button>
      )}
    </div>
  </div>
);

const SearchResults: React.FC<{
  results: any[];
  loading: boolean;
  semanticLoading: boolean;
  error: string;
  searchMode: 'quick' | 'hybrid';
  inContext: (path: string) => boolean;
  onPreview: (path: string, name: string) => void;
  onAddContext?: (path: string, name: string) => void;
}> = ({ results, loading, semanticLoading, error, searchMode, inContext, onPreview, onAddContext }) => (
  <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-1.5 pb-2">
    <div className="flex items-center gap-1.5 px-0.5 py-1.5 sticky top-0 bg-inherit z-10">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-theme-muted">
        {searchMode === 'hybrid' ? 'Semantic' : 'Results'}
      </span>
      {(loading || semanticLoading) && <Loader2 className="w-3 h-3 animate-spin text-theme-muted" />}
    </div>

    {error && !loading && results.length === 0 && (
      <p className="px-1 py-6 text-center text-[11px] text-theme-muted">{error}</p>
    )}
    {!loading && !error && results.length === 0 && !semanticLoading && (
      <p className="px-1 py-6 text-center text-[11px] text-theme-muted">No matches</p>
    )}

    <div className="space-y-1">
      {results.map((f, idx) => {
        const path = String(f.path || f.target_path || '');
        const name = fileLabel(f);
        const isDir = String(f.kind || '').toLowerCase() === 'directory';
        const attached = inContext(path);
        return (
          <div key={String(f.id || path || idx)} className="rounded-lg border border-theme/10 bg-theme-card/40 p-2">
            <div className="min-w-0 mb-1.5">
              <div className="truncate text-[11px] font-semibold text-theme-fg">{name}</div>
              <div className="truncate text-[9px] text-theme-muted font-mono mt-0.5">{path}</div>
            </div>
            {!isDir && (
              <div className="grid grid-cols-2 gap-1">
                <button
                  onClick={() => onPreview(path, name)}
                  className="inline-flex items-center justify-center gap-1 py-1.5 rounded-md bg-primary/15 text-primary text-[10px] font-bold hover:bg-primary/25"
                >
                  <Eye className="w-3 h-3" /> Preview
                </button>
                {onAddContext && (
                  <button
                    onClick={() => onAddContext(path, name)}
                    className={clsx(
                      'inline-flex items-center justify-center gap-1 py-1.5 rounded-md text-[10px] font-bold border',
                      attached
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                        : 'border-theme/15 hover:bg-theme-hover',
                    )}
                  >
                    <Paperclip className="w-3 h-3" /> {attached ? 'Added' : 'Context'}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  </div>
);
