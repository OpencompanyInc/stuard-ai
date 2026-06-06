import React from 'react';
import { InlineAudio } from '../inline/InlineAudio';
import { FilePathActions } from '../inline/FilePathActions';
import { isFilePath } from '../helpers/filePaths';

interface MediaAudioPreviewProps {
  /** Already-extracted audio sources (file paths, data URIs, or audio URLs). */
  srcs: string[];
}

// Render audio results inline in the chain-of-thought trace: a stack of compact
// players. Local files also get the copy/open/reveal actions. Used for
// text_to_speech and any other tool whose result carries an audio file.
export const MediaAudioPreview: React.FC<MediaAudioPreviewProps> = ({ srcs }) => {
  if (!srcs || srcs.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 py-0.5">
      {srcs.map((src) => (
        <div key={src} className="flex min-w-0 flex-col gap-1">
          <InlineAudio src={src} />
          {isFilePath(src) ? <FilePathActions filePath={src} /> : null}
        </div>
      ))}
    </div>
  );
};
