import React, { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  File,
  Folder,
  RefreshCw,
} from 'lucide-react';
import type { CloudFileEntry } from '../hooks/useCloudEngine';

interface CloudFileBrowserProps {
  engine: { status: string };
  listFiles: (path: string) => Promise<CloudFileEntry[]>;
  readFile: (path: string) => Promise<string | null>;
  className?: string;
  variant?: 'browser' | 'explorer';
}

function sortEntries(a: CloudFileEntry, b: CloudFileEntry) {
  if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
  return a.name.localeCompare(b.name);
}

export const CloudFileBrowser: React.FC<CloudFileBrowserProps> = ({
  engine,
  listFiles,
  readFile,
  className,
  variant = 'browser',
}) => {
  const [currentPath, setCurrentPath] = useState('.');
  const [entries, setEntries] = useState<CloudFileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<{ path: string; content: string } | null>(null);
  const [tree, setTree] = useState<Record<string, CloudFileEntry[]>>({});
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({ '.': true });
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loadingPaths, setLoadingPaths] = useState<Record<string, boolean>>({});

  const loadList = async (path: string) => {
    setLoading(true);
    setPreview(null);
    try {
      const items = await listFiles(path);
      setEntries(items.sort(sortEntries));
      setCurrentPath(path);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  };

  const loadTreePath = async (path: string) => {
    setLoadingPaths(prev => ({ ...prev, [path]: true }));
    try {
      const items = await listFiles(path);
      setTree(prev => ({ ...prev, [path]: items.sort(sortEntries) }));
    } catch {
      setTree(prev => ({ ...prev, [path]: [] }));
    } finally {
      setLoadingPaths(prev => ({ ...prev, [path]: false }));
    }
  };

  const navigateUp = () => {
    if (currentPath === '.' || currentPath === '/') return;
    const parts = currentPath.split('/');
    parts.pop();
    void loadList(parts.length === 0 ? '.' : parts.join('/'));
  };

  const handleClick = async (entry: CloudFileEntry) => {
    if (entry.type === 'directory') {
      void loadList(entry.path);
      return;
    }

    if (entry.size < 512 * 1024) {
      const content = await readFile(entry.path);
      if (content !== null) setPreview({ path: entry.path, content });
    }
  };

  const toggleDir = async (entry: CloudFileEntry) => {
    if (entry.type !== 'directory') {
      setSelectedPath(entry.path);
      return;
    }

    setSelectedPath(entry.path);
    const nextExpanded = !expandedDirs[entry.path];
    setExpandedDirs(prev => ({ ...prev, [entry.path]: nextExpanded }));

    if (nextExpanded && !tree[entry.path]) {
      await loadTreePath(entry.path);
    }
  };

  useEffect(() => {
    if (engine.status !== 'running') return;

    if (variant === 'explorer') {
      void loadTreePath('.');
    } else {
      void loadList('.');
    }
  }, [engine.status, variant]);

  if (engine.status !== 'running') {
    return (
      <div className={clsx('flex items-center justify-center text-xs text-theme-muted', className)}>
        Start your VM to browse files
      </div>
    );
  }

  const formatSize = (b: number) => {
    if (b < 1024) return `${b} B`;
    if (b < 1048576) return `${(b / 1024).toFixed(1)} K`;
    return `${(b / 1048576).toFixed(1)} M`;
  };

  const renderTree = (path: string, depth = 0): React.ReactNode => {
    const items = tree[path] ?? [];

    return items.map(entry => {
      const isDir = entry.type === 'directory';
      const isExpanded = !!expandedDirs[entry.path];
      const isSelected = selectedPath === entry.path;

      return (
        <React.Fragment key={entry.path}>
          <button
            type="button"
            onClick={() => { void toggleDir(entry); }}
            className={clsx('cloud-runtime-tree-row text-left', isSelected && 'cloud-runtime-tree-row-active')}
            style={{ paddingLeft: `${10 + depth * 14}px` }}
          >
            {isDir ? (
              isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0" />
              )
            ) : (
              <span className="inline-block h-3.5 w-3.5 shrink-0" />
            )}

            {isDir ? (
              <Folder className="h-3.5 w-3.5 shrink-0 text-amber-400" />
            ) : (
              <File className="h-3.5 w-3.5 shrink-0 text-theme-muted" />
            )}

            <span className="min-w-0 flex-1 truncate text-[12px]">{entry.name}</span>

            {!isDir && (
              <span className="shrink-0 text-[10px] font-mono opacity-60">
                {formatSize(entry.size)}
              </span>
            )}
          </button>

          {isDir && isExpanded && (
            <>
              {loadingPaths[entry.path] && !tree[entry.path] ? (
                <div
                  className="px-3 py-1 text-[11px] text-theme-muted"
                  style={{ paddingLeft: `${34 + depth * 14}px` }}
                >
                  Loading...
                </div>
              ) : (
                renderTree(entry.path, depth + 1)
              )}
            </>
          )}
        </React.Fragment>
      );
    });
  };

  if (variant === 'explorer') {
    return (
      <div className={clsx('flex h-full flex-col', className)}>
        <div className="border-b border-theme px-3 py-3 shrink-0">
          <div className="text-[10px] font-black uppercase tracking-[0.14em] text-theme-muted">
            Explorer
          </div>
          <div className="mt-1 text-[11px] text-theme-muted">
            Cloud filesystem
          </div>
        </div>

        <div className="flex items-center justify-between border-b border-theme px-3 py-2 shrink-0">
          <span className="text-[11px] text-theme-muted font-mono">~/</span>
          <button
            type="button"
            onClick={() => { void loadTreePath('.'); }}
            className="rounded-lg p-1.5 text-theme-muted transition-colors hover:bg-theme-hover hover:text-theme-fg"
            title="Refresh files"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="custom-scrollbar flex-1 overflow-auto px-2 py-2">
          {loadingPaths['.'] && !tree['.'] ? (
            <div className="px-3 py-4 text-xs text-theme-muted">Loading files...</div>
          ) : (
            renderTree('.')
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={clsx('flex flex-col h-full', className)}>
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-theme/10 shrink-0">
        <button
          type="button"
          onClick={navigateUp}
          disabled={currentPath === '.'}
          className="p-1 rounded hover:bg-theme-hover text-theme-muted disabled:opacity-30"
        >
          <ArrowLeft className="w-3 h-3" />
        </button>
        <div className="flex-1 text-[10px] text-theme-muted font-mono truncate px-1">
          ~/{currentPath === '.' ? '' : currentPath}
        </div>
        <button
          type="button"
          onClick={() => { void loadList(currentPath); }}
          className="p-1 rounded hover:bg-theme-hover text-theme-muted"
        >
          <RefreshCw className="w-3 h-3" />
        </button>
      </div>

      {preview ? (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex items-center justify-between px-2 py-1 border-b border-theme/10 shrink-0">
            <span className="text-[10px] text-theme-muted font-mono truncate">{preview.path}</span>
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="text-[10px] text-primary font-bold"
            >
              Back
            </button>
          </div>
          <pre className="custom-scrollbar flex-1 overflow-auto p-2 text-[10px] font-mono text-theme-fg whitespace-pre-wrap">
            {preview.content}
          </pre>
        </div>
      ) : (
        <div className="custom-scrollbar flex-1 overflow-y-auto">
          {loading ? (
            <div className="text-xs text-theme-muted text-center py-6">Loading...</div>
          ) : entries.length === 0 ? (
            <div className="text-xs text-theme-muted text-center py-6">Empty</div>
          ) : (
            entries.map(entry => (
              <button
                type="button"
                key={entry.path}
                onClick={() => { void handleClick(entry); }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-theme-hover/50 text-left transition-colors"
              >
                {entry.type === 'directory' ? (
                  <Folder className="w-3.5 h-3.5 text-amber-500/70 shrink-0" />
                ) : (
                  <File className="w-3.5 h-3.5 text-theme-muted/50 shrink-0" />
                )}
                <span className="flex-1 text-[11px] text-theme-fg truncate">{entry.name}</span>
                {entry.type === 'file' && (
                  <span className="text-[9px] text-theme-muted font-mono">{formatSize(entry.size)}</span>
                )}
                {entry.type === 'directory' && (
                  <ChevronRight className="w-3 h-3 text-theme-muted/40" />
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};
