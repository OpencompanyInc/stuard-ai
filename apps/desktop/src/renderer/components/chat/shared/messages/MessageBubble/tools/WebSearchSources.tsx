import React from 'react';
import { faviconUrl, truncatePreviewText } from '../helpers/payload';
import { stripMarkdown } from '../helpers/markdown';

interface WebSearchSourcesProps {
  query?: string;
  sources: Array<{ title: string; url: string; snippet?: string }>;
}

// Render web_search results as scannable rows: favicon + title + host on the
// first line, with the snippet beneath. Falls back to the host when a result has
// no title. Uses the title/snippet the tool already returns instead of showing
// host-only chips.
export const WebSearchSources: React.FC<WebSearchSourcesProps> = ({ query, sources }) => (
  <div className="space-y-2">
    {query ? (
      <div
        className="text-[12px] leading-relaxed"
        style={{ color: 'color-mix(in srgb, var(--foreground) 60%, transparent)' }}
      >
        {query}
      </div>
    ) : null}
    <div className="flex flex-col gap-1.5">
      {sources.slice(0, 6).map((source) => {
        let hostname = '';
        try { hostname = new URL(source.url).hostname.replace(/^www\./, ''); } catch { hostname = source.url; }
        const snippet = stripMarkdown(String(source.snippet || '').trim());
        return (
          <a
            key={source.url}
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-lg px-2.5 py-1.5 transition-opacity hover:opacity-80"
            style={{ backgroundColor: 'color-mix(in srgb, var(--sidebar-item-hover) 35%, transparent)' }}
            title={source.url}
          >
            <div className="flex items-center gap-1.5">
              <img
                src={faviconUrl(source.url)}
                alt=""
                className="h-3 w-3 shrink-0 rounded-sm"
                loading="lazy"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              <span
                className="truncate text-[12px] font-medium"
                style={{ color: 'color-mix(in srgb, var(--foreground) 90%, transparent)' }}
              >
                {source.title || hostname}
              </span>
              <span className="shrink-0 text-[10px] text-theme-muted">{hostname}</span>
            </div>
            {snippet ? (
              <div
                className="line-clamp-2 pl-[18px] pt-0.5 text-[11px] leading-relaxed"
                style={{ color: 'color-mix(in srgb, var(--foreground) 65%, transparent)' }}
              >
                {truncatePreviewText(snippet, 220)}
              </div>
            ) : null}
          </a>
        );
      })}
      {sources.length > 6 && (
        <span className="text-[10px] text-theme-muted">+{sources.length - 6} more</span>
      )}
    </div>
  </div>
);
