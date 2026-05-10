'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import {
  AlertCircle,
  Download,
  FileText,
  Loader2,
  Paperclip,
  RefreshCw,
  X,
} from 'lucide-react';
import { readFile } from '@/lib/cloudApi';

export interface FileViewerEntry {
  path: string;
  name: string;
  size?: number;
  mimeType?: string;
}

interface Props {
  entry: FileViewerEntry | null;
  onClose: () => void;
  onAttach?: (entry: FileViewerEntry) => void;
  className?: string;
}

const TEXT_EXT = new Set([
  'txt', 'md', 'json', 'yml', 'yaml', 'xml', 'html', 'htm', 'css', 'scss', 'sass', 'less',
  'js', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'cc', 'cpp', 'h', 'hpp',
  'cs', 'php', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd', 'sql', 'env', 'gitignore', 'gitattributes',
  'lock', 'log', 'ini', 'toml', 'conf', 'cfg', 'csv', 'tsv', 'svg', 'graphql', 'gql', 'r', 'lua', 'dart',
  'perl', 'pl', 'vue', 'svelte', 'astro', 'mdx',
]);

const MAX_PREVIEW_BYTES = 1 * 1024 * 1024;

function isLikelyText(name: string, mimeType?: string): boolean {
  if (mimeType?.startsWith('text/')) return true;
  if (mimeType === 'application/json' || mimeType === 'application/xml') return true;
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return TEXT_EXT.has(ext);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function FileViewerPane({ entry, onClose, onAttach, className }: Props) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<boolean>(false);

  const load = useCallback(async (target: FileViewerEntry) => {
    abortRef.current = false;
    setLoading(true);
    setError(null);
    setContent(null);
    try {
      if (typeof target.size === 'number' && target.size > MAX_PREVIEW_BYTES) {
        setError(`File is ${formatSize(target.size)} — too large to preview inline.`);
        return;
      }
      if (!isLikelyText(target.name, target.mimeType)) {
        setError('Binary file preview not supported here. Use the chat to attach it instead.');
        return;
      }
      const res = await readFile(target.path);
      if (abortRef.current) return;
      if (res.ok) {
        setContent(String((res as any).content ?? ''));
      } else {
        setError(res.error || 'Failed to load file');
      }
    } catch (e: any) {
      if (!abortRef.current) setError(e?.message || 'Failed to load file');
    } finally {
      if (!abortRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (entry) void load(entry);
    return () => {
      abortRef.current = true;
    };
  }, [entry, load]);

  if (!entry) return null;

  const language = entry.name.split('.').pop()?.toLowerCase() || 'text';

  return (
    <aside
      className={clsx(
        'flex h-full flex-col border-l border-theme bg-theme-card overflow-hidden',
        className,
      )}
    >
      <header className="flex items-center justify-between gap-2 border-b border-theme/10 px-3 py-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="w-3.5 h-3.5 text-theme-muted shrink-0" />
          <div className="min-w-0">
            <div className="text-xs font-semibold text-theme-fg truncate" title={entry.path}>
              {entry.name}
            </div>
            <div className="text-[10px] text-theme-muted truncate" title={entry.path}>
              {entry.path}
              {typeof entry.size === 'number' && <> · {formatSize(entry.size)}</>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {onAttach && (
            <button
              type="button"
              onClick={() => onAttach(entry)}
              className="p-1.5 rounded-lg text-theme-muted hover:text-primary hover:bg-primary/10 transition-colors"
              title="Attach to chat"
            >
              <Paperclip className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => void load(entry)}
            className="p-1.5 rounded-lg text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60 transition-colors"
            title="Reload file"
          >
            <RefreshCw className={clsx('w-3.5 h-3.5', loading && 'animate-spin')} />
          </button>
          {content && (
            <button
              type="button"
              onClick={() => downloadText(entry.name, content)}
              className="p-1.5 rounded-lg text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60 transition-colors"
              title="Download"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60 transition-colors"
            title="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-hidden bg-theme-bg/40">
        {loading && (
          <div className="h-full flex items-center justify-center text-theme-muted text-xs">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
          </div>
        )}
        {!loading && error && (
          <div className="h-full flex flex-col items-center justify-center px-6 text-center">
            <AlertCircle className="w-8 h-8 text-amber-500 mb-2" />
            <div className="text-xs text-theme-fg font-medium">Cannot preview this file</div>
            <div className="text-[11px] text-theme-muted mt-1 max-w-xs">{error}</div>
          </div>
        )}
        {!loading && !error && content !== null && (
          <pre
            className="h-full overflow-auto custom-scrollbar p-3 text-[12px] leading-5 font-mono text-theme-fg whitespace-pre"
            data-language={language}
          >
            {content || <span className="text-theme-muted italic">(empty file)</span>}
          </pre>
        )}
      </div>

      <footer className="border-t border-theme/10 px-3 py-1.5 text-[10px] text-theme-muted flex items-center justify-between shrink-0">
        <span className="font-mono uppercase tracking-wider">{language}</span>
        {content !== null && <span>{content.length.toLocaleString()} chars</span>}
      </footer>
    </aside>
  );
}

function downloadText(name: string, content: string) {
  try {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    /* noop */
  }
}
