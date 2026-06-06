import React, { memo, useState } from 'react';
import { toMediaSrc } from '../helpers/media';

// Inline audio player for tool results that produce sound (text_to_speech,
// generated music, recorded clips, …). Mirrors InlineVideo: a native <audio>
// control with a compact error fallback when the source can't be loaded.
export const InlineAudio: React.FC<{ src: string }> = memo(({ src }) => {
  const [error, setError] = useState<string | null>(null);
  const audioSrc = toMediaSrc(src || '');

  if (error) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/10 px-2 py-1 text-xs text-red-700">
        <span>⚠️</span>
        <span>Audio unavailable</span>
      </span>
    );
  }

  return (
    <audio
      src={audioSrc}
      controls
      preload="metadata"
      onError={() => setError(`${src}`)}
      className="my-1 block h-9 w-full max-w-[320px]"
    />
  );
});
