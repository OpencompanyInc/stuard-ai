import React from 'react';
import { FilePathActions } from '../inline/FilePathActions';
import { extractFilePaths, isFilePath } from '../helpers/filePaths';
import {
  extractSearchSources,
  filterToolPayload,
  isPlainRecord,
  summarizePreviewValue,
  truncatePreviewText,
} from '../helpers/payload';
import { humanizeToolName } from '../helpers/toolLabels';
import { PreviewBadge } from './PreviewBadge';
import { WebSearchSources } from './WebSearchSources';
import { TraceMarkdown } from './TraceMarkdown';

interface ToolPayloadPreviewProps {
  data: unknown;
  emptyLabel: string;
  toolName?: string;
  toolArgs?: unknown;
}

export const ToolPayloadPreview: React.FC<ToolPayloadPreviewProps> = ({ data, emptyLabel, toolName, toolArgs }) => {
  const filtered = filterToolPayload(data);

  if (toolName === 'web_search' && filtered) {
    const sources = extractSearchSources(filtered);
    if (sources) {
      let query: string | undefined;
      if (toolArgs && typeof toolArgs === 'object') {
        const args = toolArgs as Record<string, unknown>;
        if (typeof args.query === 'string') query = args.query;
        else if (typeof args.search_term === 'string') query = args.search_term;
        else if (typeof args.q === 'string') query = args.q;
      }
      return <WebSearchSources query={query} sources={sources} />;
    }
  }

  if (filtered === null || filtered === undefined) {
    return (
      <div className="text-[11px] text-theme-muted">
        {emptyLabel}
      </div>
    );
  }

  if (typeof filtered === 'string') {
    if (isFilePath(filtered)) {
      return <FilePathActions filePath={filtered} />;
    }

    return (
      <TraceMarkdown
        className="break-words rounded-lg px-3 py-2 text-[11px] leading-relaxed"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--sidebar-item-hover) 25%, transparent)',
          color: 'color-mix(in srgb, var(--foreground) 75%, transparent)',
        }}
      >
        {truncatePreviewText(filtered, 600)}
      </TraceMarkdown>
    );
  }

  if (typeof filtered === 'number' || typeof filtered === 'boolean') {
    return <PreviewBadge label="Value" value={String(filtered)} />;
  }

  if (Array.isArray(filtered)) {
    if (filtered.every((item) => item === null || ['string', 'number', 'boolean'].includes(typeof item))) {
      return (
        <div className="flex flex-wrap gap-1.5">
          {filtered.slice(0, 6).map((item, index) => (
            <PreviewBadge key={`${String(item)}-${index}`} label={`Item ${index + 1}`} value={String(item)} />
          ))}
          {filtered.length > 6 ? (
            <span className="text-[10px] text-theme-muted">+{filtered.length - 6} more</span>
          ) : null}
        </div>
      );
    }
  }

  const filePaths = extractFilePaths(filtered);
  const rows: Array<{ key: string; value: string }> = [];
  const longText: Array<{ key: string; value: string }> = [];

  if (Array.isArray(filtered)) {
    rows.push({ key: 'items', value: String(filtered.length) });
  } else if (isPlainRecord(filtered)) {
    for (const [key, value] of Object.entries(filtered)) {
      if (isFilePath(value)) continue;

      if (typeof value === 'string' && value.length > 120 && longText.length === 0) {
        longText.push({ key, value });
        continue;
      }

      rows.push({ key, value: summarizePreviewValue(value) });
    }
  }

  return (
    <div className="space-y-2">
      {filePaths.length > 0 ? (
        <div className="flex flex-col gap-1">
          {filePaths.map((filePath) => (
            <FilePathActions key={filePath} filePath={filePath} />
          ))}
        </div>
      ) : null}

      {longText.map((entry) => (
        <div
          key={entry.key}
          className="rounded-lg px-3 py-2 text-[11px] leading-relaxed"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--sidebar-item-hover) 25%, transparent)',
            color: 'color-mix(in srgb, var(--foreground) 75%, transparent)',
          }}
        >
          <div className="mb-1 text-[10px] text-theme-muted">
            {humanizeToolName(entry.key)}
          </div>
          <TraceMarkdown className="break-words">
            {truncatePreviewText(entry.value, 480)}
          </TraceMarkdown>
        </div>
      ))}

      {rows.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {rows.slice(0, 6).map((row) => (
            <PreviewBadge
              key={`${row.key}-${row.value}`}
              label={humanizeToolName(row.key)}
              value={row.value}
            />
          ))}
          {rows.length > 6 ? (
            <span className="text-[10px] text-theme-muted">+{rows.length - 6} more</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
