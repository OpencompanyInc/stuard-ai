import React, { memo } from 'react';
import { AudioPlayer } from '../../../../../AudioPlayer';
import { toMediaSrc } from '../helpers/media';

// Inline audio for tool results (TTS, generated music, recorded clips, …).
export const InlineAudio: React.FC<{ src: string }> = memo(({ src }) => (
  <AudioPlayer src={toMediaSrc(src || '')} className="max-w-full" />
));

InlineAudio.displayName = 'InlineAudio';
