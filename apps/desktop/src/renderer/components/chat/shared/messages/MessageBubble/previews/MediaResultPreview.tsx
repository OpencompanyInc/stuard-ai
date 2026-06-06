import React from 'react';
import { InlineImage } from '../inline/InlineImage';
import { FilePathActions } from '../inline/FilePathActions';
import { isFilePath } from '../helpers/filePaths';

interface MediaResultPreviewProps {
  /** Already-extracted image sources (file paths, data URIs, or image URLs). */
  srcs: string[];
}

// Render image results inline in the chain-of-thought trace: a row of compact
// thumbnails. Local files also get the copy/open actions so the user can jump
// to the file on disk. Used for image generation, screen captures, screenshots,
// and any tool whose result carries an image.
export const MediaResultPreview: React.FC<MediaResultPreviewProps> = ({ srcs }) => {
  if (!srcs || srcs.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 py-0.5">
      {srcs.map((src) => (
        <div key={src} className="flex flex-col gap-1 min-w-0">
          <InlineImage src={src} size="thumb" />
          {isFilePath(src) ? <FilePathActions filePath={src} /> : null}
        </div>
      ))}
    </div>
  );
};
