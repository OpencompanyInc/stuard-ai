import React, { memo, useState } from 'react';
import { toMediaSrc } from '../helpers/media';

export const InlineVideo: React.FC<{ src: string }> = memo(({ src }) => {
  const [error, setError] = useState<string | null>(null);
  const videoSrc = toMediaSrc(src || '');

  if (error) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-red-500/10 border border-red-500/20 rounded-lg text-red-700 text-xs">
        <span>⚠️</span>
        <span>Failed: {error}</span>
      </span>
    );
  }

  return (
    <video
      src={videoSrc}
      controls
      playsInline
      onError={(e) => {
        const code = e.currentTarget?.error?.code;
        console.error(`[InlineVideo] Failed(${code ?? 'unknown'}): "${src}" → "${videoSrc}"`);
        setError(`${src}`);
      }}
      className="block my-2 max-w-full max-h-[300px] rounded-xl shadow-lg bg-black"
    />
  );
});
