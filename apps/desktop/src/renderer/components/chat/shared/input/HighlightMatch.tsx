import React from 'react';

export const HighlightMatch: React.FC<{ text: string; query: string }> = ({ text, query }) => {
  const q = String(query || '').trim();
  if (!q || !text) return <>{text}</>;
  const lower = String(text).toLowerCase();
  const qLower = q.toLowerCase();
  const parts: React.ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < text.length) {
    const idx = lower.indexOf(qLower, i);
    if (idx < 0) {
      parts.push(<React.Fragment key={`t-${k++}`}>{text.slice(i)}</React.Fragment>);
      break;
    }
    if (idx > i) parts.push(<React.Fragment key={`t-${k++}`}>{text.slice(i, idx)}</React.Fragment>);
    parts.push(
      <span key={`m-${k++}`} style={{ color: '#FF383C' }}>{text.slice(idx, idx + q.length)}</span>
    );
    i = idx + q.length;
  }
  return <>{parts}</>;
};
