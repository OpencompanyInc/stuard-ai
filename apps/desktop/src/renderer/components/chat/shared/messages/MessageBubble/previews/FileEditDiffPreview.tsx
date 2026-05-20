import React from 'react';

const MAX_DIFF_LINES_PER_SIDE = 24;

interface FileEditDiffPreviewProps {
  oldText: string;
  newText: string;
  mode?: string;
  description?: string;
}

// Render a unified-style diff for file_edit's old_string → new_string. Each
// removed line is shown red with `-`, each added line green with `+`.
export const FileEditDiffPreview: React.FC<FileEditDiffPreviewProps> = ({ oldText, newText, mode, description }) => {
  const oldLines = (oldText || '').split('\n');
  const newLines = (newText || '').split('\n');

  const renderSide = (lines: string[], sign: '-' | '+', sideLabel: string) => {
    const shown = lines.slice(0, MAX_DIFF_LINES_PER_SIDE);
    const overflow = lines.length - shown.length;
    const isMinus = sign === '-';
    const lineColor = isMinus ? 'rgb(248,113,113)' : 'rgb(74,222,128)';
    const lineBg = isMinus
      ? 'color-mix(in srgb, rgb(248,113,113) 12%, transparent)'
      : 'color-mix(in srgb, rgb(74,222,128) 10%, transparent)';
    return (
      <>
        {shown.map((line, i) => (
          <div key={`${sign}-${i}`} className="flex" style={{ backgroundColor: lineBg }}>
            <span
              className="w-4 shrink-0 select-none text-center"
              style={{ color: lineColor, opacity: 0.85 }}
            >
              {sign}
            </span>
            <span
              className="flex-1 whitespace-pre-wrap break-all px-1.5"
              style={{ color: lineColor }}
            >
              {line || ' '}
            </span>
          </div>
        ))}
        {overflow > 0 ? (
          <div
            className="px-2 py-0.5 text-[10px]"
            style={{ color: 'color-mix(in srgb, var(--foreground-muted) 80%, transparent)' }}
          >
            … {overflow} more {sideLabel} line{overflow === 1 ? '' : 's'}
          </div>
        ) : null}
      </>
    );
  };

  const isInsert = mode === 'insert_before' || mode === 'insert_after';
  const isDelete = mode === 'delete';

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
      <div
        className="overflow-hidden rounded-lg font-mono text-[11px] leading-[1.55]"
        style={{
          border: '1px solid color-mix(in srgb, var(--foreground-muted) 14%, transparent)',
          backgroundColor: 'color-mix(in srgb, var(--sidebar-item-hover) 18%, transparent)',
        }}
      >
        <div className="py-0.5">
          {!isInsert ? renderSide(oldLines, '-', 'removed') : null}
          {!isDelete ? renderSide(newLines, '+', 'added') : null}
        </div>
      </div>
    </div>
  );
};
