import React, { memo } from 'react';
import { FileText } from 'lucide-react';
import {
  getChatAttachmentDataUrl,
  getChatAttachmentKind,
  type ChatAttachment,
} from '../../../../../utils/attachments';

// Tones derive from the bubble's text color (currentColor) so previews adapt to
// either theme's inverse bubble — dark text in light mode, light text in dark.
const USER_CHIP_BORDER = 'color-mix(in srgb, currentColor 16%, transparent)';
const USER_CHIP_BG = 'color-mix(in srgb, currentColor 8%, transparent)';
const USER_CHIP_ICON = 'color-mix(in srgb, currentColor 55%, transparent)';

/** Read-only attachment previews for the compact response panel user bubble. */
export const CompactUserAttachments: React.FC<{
  attachments: readonly ChatAttachment[];
}> = memo(({ attachments }) => {
  if (!attachments.length) return null;

  return (
    <div className="flex flex-col items-end gap-1.5 mb-1.5 w-full">
      {attachments.map((attachment, index) => {
        const kind = getChatAttachmentKind(attachment);
        const previewUrl = getChatAttachmentDataUrl(attachment);
        const key = `${attachment.name}-${index}-${attachment.mimeType || attachment.type}`;

        if (kind === 'image' && previewUrl) {
          return (
            <img
              key={key}
              src={previewUrl}
              alt={attachment.name}
              title={attachment.name}
              className="block max-h-[88px] max-w-full rounded-lg object-cover"
              style={{ border: `0.5px solid ${USER_CHIP_BORDER}` }}
            />
          );
        }

        return (
          <div
            key={key}
            className="inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-1"
            style={{
              border: `0.5px solid ${USER_CHIP_BORDER}`,
              background: USER_CHIP_BG,
            }}
            title={attachment.name}
          >
            <FileText
              className="shrink-0"
              style={{ width: 11, height: 11, color: USER_CHIP_ICON }}
              strokeWidth={1.75}
            />
            <span
              className="truncate text-[10px] font-medium"
              style={{ color: 'inherit', maxWidth: 120 }}
            >
              {attachment.name}
            </span>
          </div>
        );
      })}
    </div>
  );
});

export default CompactUserAttachments;
