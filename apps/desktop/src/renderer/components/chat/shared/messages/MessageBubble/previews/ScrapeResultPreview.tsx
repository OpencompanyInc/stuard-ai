import React from 'react';
import { faviconUrl, truncatePreviewText } from '../helpers/payload';
import { stripMarkdown } from '../helpers/markdown';

interface ScrapeRow {
  url: string;
  title?: string;
  content?: string;
  preview_start?: string;
  total_lines?: number;
  ok?: boolean;
  error?: string;
  message?: string;
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

// Render scrape_url results as readable page cards (favicon, title, host, line
// count, content snippet) instead of a bare "items: N" badge. Failed pages show
// a compact error line so the user sees which URL didn't extract.
export const ScrapeResultPreview: React.FC<{ results: ScrapeRow[] }> = ({ results }) => {
  if (!results || results.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {results.slice(0, 5).map((r, i) => {
        const host = hostOf(r.url);
        const failed = r.ok === false || (!!r.error && !r.content);
        const snippet = stripMarkdown(String(r.content || r.preview_start || '').trim());
        return (
          <div
            key={`${r.url}-${i}`}
            className="overflow-hidden rounded-lg border border-theme/10"
            style={{ backgroundColor: 'color-mix(in srgb, var(--sidebar-item-hover) 25%, transparent)' }}
          >
            <a
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-2 transition-opacity hover:opacity-80"
              title={r.url}
            >
              <img
                src={faviconUrl(r.url)}
                alt=""
                className="h-3.5 w-3.5 shrink-0 rounded-sm"
                loading="lazy"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              <div className="min-w-0 flex-1">
                <div
                  className="truncate text-[12px] font-medium"
                  style={{ color: 'color-mix(in srgb, var(--foreground) 90%, transparent)' }}
                >
                  {r.title || host}
                </div>
                <div className="truncate text-[10px] text-theme-muted">
                  {host}{typeof r.total_lines === 'number' ? ` · ${r.total_lines} lines` : ''}
                </div>
              </div>
            </a>
            {failed ? (
              <div className="px-3 pb-2 text-[11px] text-red-500/90">{r.message || r.error}</div>
            ) : snippet ? (
              <div
                className="line-clamp-3 px-3 pb-2 text-[11px] leading-relaxed"
                style={{ color: 'color-mix(in srgb, var(--foreground) 70%, transparent)' }}
              >
                {truncatePreviewText(snippet, 280)}
              </div>
            ) : null}
          </div>
        );
      })}
      {results.length > 5 ? (
        <span className="text-[10px] text-theme-muted">+{results.length - 5} more</span>
      ) : null}
    </div>
  );
};
