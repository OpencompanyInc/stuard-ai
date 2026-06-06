import React, { memo, useState } from 'react';
import clsx from 'clsx';
import { toMediaSrc } from '../helpers/media';

// Image component that handles loading states and local/web URLs (memoized).
// `size="thumb"` renders the compact variant used inside the chain-of-thought
// trace; the default is the full inline size used in message bodies.
export const InlineImage: React.FC<{ src: string; alt?: string; size?: 'default' | 'thumb' }> = memo(({ src, alt, size = 'default' }) => {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imageSrc = toMediaSrc(src || '');
  const isThumb = size === 'thumb';

  if (error) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-red-500/10 border border-red-500/20 rounded-lg text-red-700 text-xs">
        <span>⚠️</span>
        <span>Failed: {error}</span>
      </span>
    );
  }

  return (
    <>
      <img
        src={imageSrc}
        alt={alt || 'Image'}
        onLoad={() => setLoaded(true)}
        onError={() => setError(`${src}`)}
        className={clsx(
          "block rounded-xl border border-theme/10 object-contain transition-opacity duration-200",
          isThumb ? "my-0 max-w-[200px] max-h-[150px] shadow-sm" : "my-2 max-w-full max-h-[300px] shadow-lg",
          loaded ? "opacity-100" : "opacity-0"
        )}
      />
      {!loaded && !error && (
        <span className="inline-flex items-center gap-2 px-3 py-2 bg-theme-hover rounded-xl text-theme-muted text-xs">
          <span className="w-3 h-3 border-2 border-theme/10 border-t-primary rounded-full animate-spin" />
          Loading...
        </span>
      )}
    </>
  );
});
