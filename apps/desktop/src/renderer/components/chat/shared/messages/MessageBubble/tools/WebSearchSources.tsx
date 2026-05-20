import React from 'react';
import { faviconUrl } from '../helpers/payload';

interface WebSearchSourcesProps {
  query?: string;
  sources: Array<{ title: string; url: string }>;
}

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
    <div className="flex flex-wrap gap-1.5">
      {sources.slice(0, 8).map((source) => {
        let hostname = '';
        try { hostname = new URL(source.url).hostname.replace(/^www\./, ''); } catch { hostname = source.url; }
        return (
          <a
            key={source.url}
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium text-theme-muted transition-opacity hover:opacity-80"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--sidebar-item-hover) 55%, transparent)',
            }}
            title={source.title || hostname}
          >
            <img
              src={faviconUrl(source.url)}
              alt=""
              className="h-3 w-3 rounded-sm"
              loading="lazy"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
            {hostname}
          </a>
        );
      })}
      {sources.length > 8 && (
        <span className="self-center text-[10px] text-theme-muted">+{sources.length - 8} more</span>
      )}
    </div>
  </div>
);
