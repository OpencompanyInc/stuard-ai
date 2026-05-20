import React from 'react';
import { FilePathActions } from '../inline/FilePathActions';
import { isFilePath } from '../helpers/filePaths';
import { truncatePreviewText } from '../helpers/payload';

interface AnalyzeMediaPreviewProps {
  args: Record<string, any>;
  result: any;
}

// Render an analyze_media completion: just the model summary text. Hides the
// raw input (sources may include base64 / very long URLs we don't want to dump
// in the trace).
export const AnalyzeMediaPreview: React.FC<AnalyzeMediaPreviewProps> = ({ args, result }) => {
  const summary = typeof result?.summary === 'string'
    ? result.summary
    : (typeof result === 'string' ? result : '');
  const sources = Array.isArray(args?.sources) ? args.sources : [];
  const filePaths = sources
    .map((s: any) => (typeof s?.path === 'string' ? s.path : null))
    .filter((p: string | null): p is string => !!p && isFilePath(p));
  const task = typeof args?.task === 'string' ? args.task : '';

  return (
    <div className="space-y-1.5">
      {task ? (
        <div
          className="text-[11px] leading-snug italic"
          style={{ color: 'color-mix(in srgb, var(--foreground) 55%, transparent)' }}
        >
          {truncatePreviewText(task, 160)}
        </div>
      ) : null}
      {filePaths.length > 0 ? (
        <div className="flex flex-col gap-1">
          {filePaths.map((p: string) => <FilePathActions key={p} filePath={p} />)}
        </div>
      ) : null}
      {summary ? (
        <div
          className="rounded-lg px-3 py-2 text-[11.5px] leading-relaxed whitespace-pre-wrap break-words"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--sidebar-item-hover) 25%, transparent)',
            color: 'color-mix(in srgb, var(--foreground) 80%, transparent)',
          }}
        >
          {summary}
        </div>
      ) : (
        <div className="text-[11px] text-theme-muted">No summary returned.</div>
      )}
    </div>
  );
};
