import React, { useState, useEffect } from 'react';
import { clsx } from 'clsx';
import { Folder, File, ChevronRight, ArrowLeft, RefreshCw } from 'lucide-react';
import type { CloudFileEntry } from '../hooks/useCloudEngine';

interface CloudFileBrowserProps {
  engine: { status: string };
  listFiles: (path: string) => Promise<CloudFileEntry[]>;
  readFile: (path: string) => Promise<string | null>;
  className?: string;
}

export const CloudFileBrowser: React.FC<CloudFileBrowserProps> = ({ engine, listFiles, readFile, className }) => {
  const [currentPath, setCurrentPath] = useState('.');
  const [entries, setEntries] = useState<CloudFileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<{ path: string; content: string } | null>(null);

  const load = async (path: string) => {
    setLoading(true);
    setPreview(null);
    try {
      const items = await listFiles(path);
      setEntries(items);
      setCurrentPath(path);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  };

  const navigateUp = () => {
    if (currentPath === '.' || currentPath === '/') return;
    const parts = currentPath.split('/');
    parts.pop();
    load(parts.length === 0 ? '.' : parts.join('/'));
  };

  const handleClick = async (entry: CloudFileEntry) => {
    if (entry.type === 'directory') {
      load(entry.path);
    } else if (entry.size < 512 * 1024) {
      const content = await readFile(entry.path);
      if (content !== null) setPreview({ path: entry.path, content });
    }
  };

  useEffect(() => {
    if (engine.status === 'running') load('.');
  }, [engine.status]);

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

  return (
    <div className={clsx('flex flex-col h-full', className)}>
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-theme/10 shrink-0">
        <button onClick={navigateUp} disabled={currentPath === '.'} className="p-1 rounded hover:bg-theme-hover text-theme-muted disabled:opacity-30">
          <ArrowLeft className="w-3 h-3" />
        </button>
        <div className="flex-1 text-[10px] text-theme-muted font-mono truncate px-1">
          ~/{currentPath === '.' ? '' : currentPath}
        </div>
        <button onClick={() => load(currentPath)} className="p-1 rounded hover:bg-theme-hover text-theme-muted">
          <RefreshCw className="w-3 h-3" />
        </button>
      </div>

      {/* File list or preview */}
      {preview ? (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex items-center justify-between px-2 py-1 border-b border-theme/10 shrink-0">
            <span className="text-[10px] text-theme-muted font-mono truncate">{preview.path}</span>
            <button onClick={() => setPreview(null)} className="text-[10px] text-primary font-bold">Back</button>
          </div>
          <pre className="flex-1 overflow-auto p-2 text-[10px] font-mono text-theme-fg whitespace-pre-wrap">{preview.content}</pre>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="text-xs text-theme-muted text-center py-6">Loading...</div>
          ) : entries.length === 0 ? (
            <div className="text-xs text-theme-muted text-center py-6">Empty</div>
          ) : (
            entries.map(entry => (
              <button
                key={entry.path}
                onClick={() => handleClick(entry)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-theme-hover/50 text-left transition-colors"
              >
                {entry.type === 'directory'
                  ? <Folder className="w-3.5 h-3.5 text-amber-500/70 shrink-0" />
                  : <File className="w-3.5 h-3.5 text-theme-muted/50 shrink-0" />}
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
