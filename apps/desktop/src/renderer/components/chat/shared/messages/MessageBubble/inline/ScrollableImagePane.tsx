import React, { memo, useState } from 'react';
import clsx from 'clsx';
import { toMediaSrc } from '../helpers/media';

interface ScrollableImagePaneProps {
  src: string;
  alt?: string;
  label?: string;
  /** Max height of the scroll container (px). */
  maxHeight?: number;
  className?: string;
  /** No label, border, or chrome — just the image. */
  bare?: boolean;
}

export const ScrollableImagePane: React.FC<ScrollableImagePaneProps> = memo(({
  src,
  alt,
  label,
  maxHeight = 200,
  className,
  bare = false,
}) => {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imageSrc = toMediaSrc(src || '');

  if (error) {
    return (
      <div className={clsx('text-[11px] text-red-500/80', className)}>
        Image unavailable
      </div>
    );
  }

  const img = (
    <img
      src={imageSrc}
      alt={alt || label || 'Image'}
      onLoad={() => setLoaded(true)}
      onError={() => setError(src)}
      className={clsx(
        'block max-w-full object-contain transition-opacity duration-200',
        bare ? 'max-h-[180px] rounded-lg' : 'w-full h-auto',
        loaded ? 'opacity-100' : 'hidden opacity-0',
      )}
    />
  );

  if (bare) {
    return (
      <div
        className={clsx('overflow-y-auto overflow-x-hidden custom-scrollbar', className)}
        style={{ maxHeight }}
      >
        {!loaded && (
          <div className="flex h-16 items-center justify-center" aria-busy="true">
            <span
              className="h-4 w-4 animate-spin rounded-full"
              style={{
                border: '2px solid color-mix(in srgb, var(--foreground) 15%, transparent)',
                borderTopColor: 'var(--primary)',
              }}
            />
          </div>
        )}
        {img}
      </div>
    );
  }

  return (
    <div className={clsx('flex min-w-0 flex-col gap-1', className)}>
      {label ? (
        <span
          className="text-[10px] font-bold uppercase tracking-[0.14em]"
          style={{ color: 'color-mix(in srgb, var(--foreground-muted) 85%, transparent)' }}
        >
          {label}
        </span>
      ) : null}
      <div
        className="overflow-y-auto overflow-x-hidden custom-scrollbar rounded-lg"
        style={{
          maxHeight,
          border: '1px solid color-mix(in srgb, var(--foreground) 10%, transparent)',
        }}
      >
        {!loaded && (
          <div className="flex h-16 items-center justify-center" aria-busy="true">
            <span
              className="h-4 w-4 animate-spin rounded-full"
              style={{
                border: '2px solid color-mix(in srgb, var(--foreground) 15%, transparent)',
                borderTopColor: 'var(--primary)',
              }}
            />
          </div>
        )}
        {img}
      </div>
    </div>
  );
});
