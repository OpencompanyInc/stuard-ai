import React from 'react';
import { FilePathActions } from '../inline/FilePathActions';

const MAX_FILE_SNIPPET_LINES = 18;

interface WriteFilePreviewProps {
  path?: string;
  content?: string;
  description?: string;
  appended?: boolean;
}

// Render a write_file payload: file actions row + a short content preview.
export const WriteFilePreview: React.FC<WriteFilePreviewProps> = ({ path, content, description, appended }) => {
  const lines = (content || '').split('\n');
  const shown = lines.slice(0, MAX_FILE_SNIPPET_LINES).join('\n');
  const overflow = lines.length - Math.min(lines.length, MAX_FILE_SNIPPET_LINES);
  const bytes = (content || '').length;
  const sizeLabel = bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;

  return (
    <div className="space-y-1.5">
      {description ? (
        <div
          className="text-[11px] leading-snug"
          style={{ color: 'color-mix(in srgb, var(--foreground) 60%, transparent)' }}
        >
          {description}
        </div>
      ) : null}
      {path ? <FilePathActions filePath={path} /> : null}
      {content ? (
        <div
          className="overflow-hidden rounded-lg font-mono text-[11px] leading-[1.55]"
          style={{
            border: '1px solid color-mix(in srgb, var(--foreground-muted) 14%, transparent)',
            backgroundColor: 'color-mix(in srgb, var(--sidebar-item-hover) 18%, transparent)',
          }}
        >
          <div
            className="flex items-center justify-between px-2.5 py-1 text-[10px]"
            style={{
              color: 'color-mix(in srgb, var(--foreground-muted) 90%, transparent)',
              backgroundColor: 'color-mix(in srgb, var(--sidebar-item-hover) 35%, transparent)',
            }}
          >
            <span>{appended ? 'Appended' : 'Content'} · {lines.length} line{lines.length === 1 ? '' : 's'} · {sizeLabel}</span>
          </div>
          <pre className="whitespace-pre-wrap break-all px-2.5 py-1.5 m-0">
            {shown}
            {overflow > 0 ? `\n… +${overflow} more line${overflow === 1 ? '' : 's'}` : ''}
          </pre>
        </div>
      ) : null}
    </div>
  );
};
