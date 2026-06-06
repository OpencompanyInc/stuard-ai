import React, { memo, useState } from 'react';
import clsx from 'clsx';
import { toMediaSrc } from '../helpers/media';

// Image component that handles loading states and local/web URLs (memoized).
// While the image is fetching we hold its place with a fixed loading "box" so
// there's no layout jump and the image clearly renders *into* the box once it's
// ready. `size="thumb"` renders the compact variant used inside the
// chain-of-thought trace; the default is the larger inline size used in message
// bodies.
export const InlineImage: React.FC<{ src: string; alt?: string; size?: 'default' | 'thumb' }> = memo(({ src, alt, size = 'default' }) => {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imageSrc = toMediaSrc(src || '');
  const isThumb = size === 'thumb';

  // Footprint of the placeholder box while the image loads / on error.
  const boxSize = isThumb ? 'w-[176px] h-[120px]' : 'w-[280px] h-[200px]';

  if (error) {
    return (
      <div
        className={clsx(
          'flex flex-col items-center justify-center gap-1 rounded-xl border border-red-500/20 bg-red-500/10 px-3 text-center text-red-700',
          boxSize,
        )}
      >
        <span className="text-base">⚠️</span>
        <span className="text-[11px] leading-tight">Image unavailable</span>
        <span className="max-w-full truncate text-[10px] opacity-70" title={error}>{error}</span>
      </div>
    );
  }

  return (
    <>
      {!loaded && (
        <div
          className={clsx(
            'flex items-center justify-center rounded-xl bg-theme-hover',
            isThumb ? 'my-0' : 'my-2',
            boxSize,
          )}
          aria-busy="true"
        >
          <span
            className="h-5 w-5 animate-spin rounded-full"
            style={{
              border: '2px solid color-mix(in srgb, var(--foreground) 15%, transparent)',
              borderTopColor: 'var(--primary)',
            }}
          />
        </div>
      )}
      <img
        src={imageSrc}
        alt={alt || 'Image'}
        onLoad={() => setLoaded(true)}
        onError={() => setError(`${src}`)}
        className={clsx(
          'rounded-xl object-contain transition-opacity duration-200',
          isThumb ? 'my-0 max-w-[200px] max-h-[150px] shadow-sm' : 'my-2 max-w-full max-h-[300px] shadow-lg',
          loaded ? 'block opacity-100' : 'hidden opacity-0',
        )}
      />
    </>
  );
});
