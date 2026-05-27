import React, { memo, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { Check, ChevronDown, ChevronUp, Copy, ExternalLink, File, FileJson, FileText, Folder, Loader2, TriangleAlert } from 'lucide-react';
import { toMediaSrc } from '../helpers/media';
import { getFileExt } from '../helpers/filePaths';

const PREVIEW_BYTES = 128 * 1024;
const PREVIEW_LINE_LIMIT = 140;
const PREVIEW_CHAR_LIMIT = 36_000;

const TEXT_EXTS = new Set([
  'txt', 'md', 'markdown', 'log', 'csv', 'tsv', 'json', 'jsonl', 'ndjson', 'xml', 'yaml', 'yml',
  'ini', 'toml', 'env', 'html', 'htm', 'css', 'scss', 'less', 'js', 'jsx', 'ts', 'tsx', 'mjs',
  'cjs', 'py', 'rb', 'php', 'java', 'kt', 'kts', 'go', 'rs', 'c', 'h', 'cpp', 'hpp', 'cs', 'sql',
  'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd', 'dockerfile', 'gitignore', 'ipynb', 'svg'
]);

const JSON_EXTS = new Set(['json', 'jsonl', 'ndjson', 'ipynb']);

function cleanSrc(src: string) {
  return String(src || '').trim().replace(/^<|>$/g, '');
}

function displayNameFromSrc(src: string) {
  const raw = cleanSrc(src);
  try {
    if (/^https?:/i.test(raw)) {
      const url = new URL(raw);
      return decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || url.hostname || 'File');
    }
  } catch { }
  try {
    return decodeURIComponent(raw.split(/[\\/]/).pop() || raw || 'File');
  } catch {
    return raw.split(/[\\/]/).pop() || raw || 'File';
  }
}

function isWebUrl(src: string) {
  return /^https?:/i.test(cleanSrc(src));
}

function isLocalPath(src: string) {
  const raw = cleanSrc(src);
  return !/^(https?:|data:|blob:)/i.test(raw);
}

function formatBytes(value?: number | null) {
  if (!value || value <= 0) return null;
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
}

function parseTotalSize(response: Response) {
  const contentRange = response.headers.get('content-range');
  const rangeTotal = contentRange?.match(/\/(\d+)$/)?.[1];
  if (rangeTotal) return Number(rangeTotal);
  const contentLength = response.headers.get('content-length');
  return contentLength ? Number(contentLength) : null;
}

async function readCappedText(url: string, signal: AbortSignal) {
  const response = await fetch(url, {
    headers: { Range: `bytes=0-${PREVIEW_BYTES - 1}` },
    signal,
  });

  if (!response.ok && response.status !== 206) {
    throw new Error(`Preview unavailable (${response.status})`);
  }

  const totalSize = parseTotalSize(response);
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const reader = response.body?.getReader();
  let text = '';
  let bytesRead = 0;

  if (!reader) {
    const fallback = await response.text();
    return {
      text: fallback.slice(0, PREVIEW_CHAR_LIMIT),
      totalSize,
      truncated: fallback.length > PREVIEW_CHAR_LIMIT || Boolean(totalSize && totalSize > fallback.length),
    };
  }

  while (bytesRead < PREVIEW_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    bytesRead += value.byteLength;
    text += decoder.decode(value, { stream: true });
    if (text.length >= PREVIEW_CHAR_LIMIT || bytesRead >= PREVIEW_BYTES) {
      try { await reader.cancel(); } catch { }
      break;
    }
  }
  text += decoder.decode();

  return {
    text: text.slice(0, PREVIEW_CHAR_LIMIT),
    totalSize,
    truncated: bytesRead >= PREVIEW_BYTES || text.length > PREVIEW_CHAR_LIMIT || Boolean(totalSize && totalSize > bytesRead),
  };
}

function formatPreviewText(raw: string, ext: string) {
  if (ext === 'json' || ext === 'ipynb') {
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch { }
  }
  return raw;
}

function capPreviewLines(text: string) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const capped = lines.slice(0, PREVIEW_LINE_LIMIT).join('\n');
  return {
    text: capped,
    lineCount: lines.length,
    lineTruncated: lines.length > PREVIEW_LINE_LIMIT,
  };
}

export const InlineFilePreview: React.FC<{ src: string; alt?: string }> = memo(({ src, alt }) => {
  const cleanedSrc = cleanSrc(src);
  const ext = getFileExt(cleanedSrc).toLowerCase();
  const fileName = displayNameFromSrc(cleanedSrc);
  const mediaSrc = toMediaSrc(cleanedSrc);
  const isPdf = ext === 'pdf' || alt === 'pdf';
  const isJson = JSON_EXTS.has(ext) || alt === 'json';
  const isTextLike = TEXT_EXTS.has(ext) || alt === 'text' || isJson;
  const [copied, setCopied] = useState<'path' | 'preview' | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [state, setState] = useState<{
    loading: boolean;
    text?: string;
    totalSize?: number | null;
    truncated?: boolean;
    error?: string;
  }>({ loading: false });

  useEffect(() => {
    if (!isTextLike || isPdf || !cleanedSrc) return;
    const controller = new AbortController();
    let disposed = false;
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    setState({ loading: true });

    readCappedText(mediaSrc, controller.signal)
      .then((result) => {
        if (disposed) return;
        const formatted = formatPreviewText(result.text, ext);
        setState({ loading: false, text: formatted, totalSize: result.totalSize, truncated: result.truncated });
      })
      .catch((error) => {
        if (disposed) return;
        setState({ loading: false, error: String(error?.message || 'Preview unavailable') });
      })
      .finally(() => window.clearTimeout(timeout));

    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [cleanedSrc, ext, isPdf, isTextLike, mediaSrc]);

  const preview = useMemo(() => capPreviewLines(state.text || ''), [state.text]);
  const shownText = expanded ? (state.text || '') : preview.text;
  const canOpenExternal = isWebUrl(cleanedSrc);
  const kindLabel = isPdf ? 'PDF' : isJson ? 'JSON' : ext ? ext.toUpperCase() : 'FILE';
  const sizeLabel = formatBytes(state.totalSize);
  const hasMore = Boolean(state.truncated || (!expanded && preview.lineTruncated));
  const Icon = isJson ? FileJson : isTextLike ? FileText : File;

  const copy = async (value: string, type: 'path' | 'preview') => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(type);
      window.setTimeout(() => setCopied(null), 1400);
    } catch { }
  };

  const openFile = () => {
    try {
      if (canOpenExternal) {
        (window as any).desktopAPI?.openExternal?.(cleanedSrc);
      } else {
        ((window as any).desktopAPI?.openPath || (window as any).desktopAPI?.mediaOpenPath)?.(cleanedSrc);
      }
    } catch { }
  };

  const revealInFolder = () => {
    if (!isLocalPath(cleanedSrc)) return;
    try { (window as any).desktopAPI?.showItemInFolder?.(cleanedSrc); } catch { }
  };

  return (
    <div className="my-3 w-full max-w-2xl overflow-hidden rounded-2xl border border-theme/10 bg-white text-slate-900 shadow-sm">
      <div className="flex items-start gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div className="mt-0.5 rounded-xl bg-slate-900 p-2 text-white shadow-sm">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-bold text-slate-900" title={cleanedSrc}>{fileName}</span>
            <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-slate-500">{kindLabel}</span>
            {sizeLabel && <span className="text-[11px] font-medium text-slate-500">{sizeLabel}</span>}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-slate-500" title={cleanedSrc}>{cleanedSrc}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {state.text && (
            <button onClick={() => copy(state.text || '', 'preview')} className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-900" title="Copy preview">
              {copied === 'preview' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          )}
          <button onClick={() => copy(cleanedSrc, 'path')} className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-900" title="Copy path">
            {copied === 'path' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
          {isLocalPath(cleanedSrc) && (
            <button onClick={revealInFolder} className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-900" title="Show in folder">
              <Folder className="h-3.5 w-3.5" />
            </button>
          )}
          <button onClick={openFile} className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-900" title={canOpenExternal ? 'Open link' : 'Open file'}>
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {isPdf ? (
        <div className="p-4">
          <button
            onClick={() => setPdfOpen((value) => !value)}
            className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-left text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100"
          >
            <span>{pdfOpen ? 'Hide PDF preview' : 'Preview PDF'}</span>
            {pdfOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {pdfOpen && (
            <iframe
              src={mediaSrc}
              title={fileName}
              className="mt-3 h-[420px] w-full rounded-xl border border-slate-200 bg-slate-100"
              loading="lazy"
            />
          )}
        </div>
      ) : state.loading ? (
        <div className="flex items-center gap-2 px-4 py-4 text-sm font-medium text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Preparing a safe preview...
        </div>
      ) : state.error ? (
        <div className="flex items-start gap-2 px-4 py-4 text-sm text-amber-700">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Preview unavailable. You can still open the file from the actions above.</span>
        </div>
      ) : state.text ? (
        <div className="bg-white">
          <pre className={clsx(
            'm-0 overflow-auto p-4 font-mono text-[12px] leading-5 text-slate-800 custom-scrollbar whitespace-pre',
            expanded ? 'max-h-[680px]' : 'max-h-[340px]'
          )}>{shownText}</pre>
          {hasMore && (
            <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-2">
              <span className="text-[11px] font-medium text-slate-500">
                Showing a capped preview{state.truncated ? ` (${formatBytes(PREVIEW_BYTES)} max)` : ''}{preview.lineTruncated && !expanded ? `, first ${PREVIEW_LINE_LIMIT} lines` : ''}.
              </span>
              {preview.lineTruncated && (
                <button onClick={() => setExpanded((value) => !value)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold text-slate-600 transition-colors hover:bg-slate-200 hover:text-slate-900">
                  {expanded ? 'Collapse' : 'Show more'}
                  {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="px-4 py-4 text-sm text-slate-500">Open this file to view it in the system viewer.</div>
      )}
    </div>
  );
});
