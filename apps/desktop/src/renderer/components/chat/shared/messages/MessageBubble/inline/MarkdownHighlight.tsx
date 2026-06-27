import React from 'react';

export const HIGHLIGHT_HREFS = new Set(['#highlight', '?highlight']);

export function isHighlightHref(href: unknown): boolean {
  return typeof href === 'string' && HIGHLIGHT_HREFS.has(href);
}

/** Marker-pen style for ==highlight== custom markdown (see styles.css `.md-highlight`). */
export const MarkdownHighlight: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <mark className="md-highlight">{children}</mark>
);
