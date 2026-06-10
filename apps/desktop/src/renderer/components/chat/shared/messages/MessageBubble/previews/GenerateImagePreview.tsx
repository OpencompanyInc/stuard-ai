import React from 'react';
import { collectImageSources } from '../helpers/media';
import { truncatePreviewText } from '../helpers/payload';
import { ScrollableImagePane } from '../inline/ScrollableImagePane';

interface GenerateImagePreviewProps {
  args: Record<string, any>;
  result: any;
  compact?: boolean;
}

function collectInputImageSources(args: Record<string, any>): string[] {
  const raw = Array.isArray(args?.input_images) ? args.input_images : [];
  const mapped = raw.map((item: any) => {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object') {
      return item.path || item.url || item.dataUrl || item.src || null;
    }
    return null;
  }).filter(Boolean);
  return collectImageSources(mapped, { max: 4 });
}

export const GenerateImagePreview: React.FC<GenerateImagePreviewProps> = ({
  args,
  result,
  compact = false,
}) => {
  const prompt = typeof args?.prompt === 'string' ? args.prompt.trim() : '';
  const inputSrcs = collectInputImageSources(args);
  const outputSrcs = collectImageSources(result, { assumeImage: true, max: 4 });
  const paneMaxHeight = compact ? 120 : 160;

  if (!prompt && inputSrcs.length === 0 && outputSrcs.length === 0) {
    return null;
  }

  const allSrcs = [...inputSrcs, ...outputSrcs];

  return (
    <div className="space-y-1.5 py-0.5">
      {prompt ? (
        <p
          className="text-[11px] leading-snug"
          style={{ color: 'color-mix(in srgb, var(--foreground) 62%, transparent)' }}
        >
          {truncatePreviewText(prompt, compact ? 100 : 160)}
        </p>
      ) : null}

      {allSrcs.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {allSrcs.map((src) => (
            <ScrollableImagePane
              key={src}
              src={src}
              maxHeight={paneMaxHeight}
              bare
            />
          ))}
        </div>
      )}
    </div>
  );
};
