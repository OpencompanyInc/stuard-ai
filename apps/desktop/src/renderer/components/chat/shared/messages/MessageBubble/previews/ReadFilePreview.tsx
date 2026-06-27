import React from 'react';
import { FilePathActions } from '../inline/FilePathActions';
import { PreviewBadge } from '../tools/PreviewBadge';

interface ReadFilePreviewProps {
  path?: string;
  result: any;
}

// Render a read_file completion: file actions + small metadata badges.
export const ReadFilePreview: React.FC<ReadFilePreviewProps> = ({ path, result }) => {
  const r = (result && typeof result === 'object') ? result as Record<string, any> : {};
  const ok = r.ok !== false;
  const totalLines = typeof r.total_lines === 'number' ? r.total_lines : null;
  const lineStart = typeof r.line_start === 'number' ? r.line_start : null;
  const lineEnd = typeof r.line_end === 'number' ? r.line_end : null;
  const linesReturned = typeof r.lines_returned === 'number' ? r.lines_returned : null;
  const truncated = r.truncated === true;
  const mime = typeof r.mime_type === 'string' ? r.mime_type : null;
  const docType = typeof r.document_type === 'string' ? r.document_type : null;
  const errMsg = typeof r.error === 'string' ? r.error : (typeof r.message === 'string' && !ok ? r.message : null);

  const badges: Array<{ label: string; value: string }> = [];
  if (totalLines !== null) badges.push({ label: 'Total', value: `${totalLines} lines` });
  if (lineStart !== null && lineEnd !== null) badges.push({ label: 'Range', value: `L${lineStart}–${lineEnd}` });
  else if (linesReturned !== null) badges.push({ label: 'Returned', value: `${linesReturned} lines` });
  if (mime) badges.push({ label: 'Type', value: mime });
  if (docType && docType !== mime) badges.push({ label: 'Doc', value: docType });
  if (truncated) badges.push({ label: 'Status', value: 'Truncated' });

  return (
    <div className="space-y-1.5">
      {path ? <FilePathActions filePath={path} /> : null}
      {errMsg ? (
        <div
          className="rounded-lg px-3 py-2 text-[11px] leading-relaxed text-red-500/90"
          style={{ backgroundColor: 'color-mix(in srgb, var(--destructive) 8%, transparent)' }}
        >
          {errMsg}
        </div>
      ) : null}
      {badges.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {badges.map((b) => (
            <PreviewBadge key={`${b.label}-${b.value}`} label={b.label} value={b.value} />
          ))}
        </div>
      ) : null}
    </div>
  );
};
