import React from 'react';

export const UNDERLINE_HREFS = new Set(['#underline', '?underline']);

export function isUnderlineHref(href: unknown): boolean {
  return typeof href === 'string' && UNDERLINE_HREFS.has(href);
}

/** Accent underline for ++underline++ custom markdown (see styles.css `.md-underline`). */
export const MarkdownUnderline: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="md-underline">{children}</span>
);
