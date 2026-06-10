import React from 'react';
import clsx from 'clsx';
import {
  File,
  FileText,
  Film,
  Image as ImageIcon,
  Music,
  X,
} from 'lucide-react';

import {
  type ChatAttachment,
  getChatAttachmentDataUrl,
  getChatAttachmentKind,
} from '../utils/attachments';

type AttachmentKind = ReturnType<typeof getChatAttachmentKind>;

interface AttachmentPreviewStripProps {
  attachments: ChatAttachment[];
  onRemove?: (index: number) => void;
  layout?: 'rail' | 'wrap';
  align?: 'left' | 'right';
  className?: string;
}

interface AttachmentPreviewOverlayProps {
  attachments: ChatAttachment[];
  onRemove?: (index: number) => void;
  className?: string;
}

/** Square edge length reserved per overlaid thumb (px). */
export const ATTACHMENT_OVERLAY_THUMB = 36;
export const ATTACHMENT_OVERLAY_GAP = 6;

export function attachmentOverlayInset(count: number): number {
  if (count <= 0) return 0;
  return count * ATTACHMENT_OVERLAY_THUMB + (count - 1) * ATTACHMENT_OVERLAY_GAP + 10;
}

function cardIcon(kind: AttachmentKind) {
  if (kind === 'document') return FileText;
  if (kind === 'audio') return Music;
  if (kind === 'video') return Film;
  if (kind === 'image') return ImageIcon;
  return File;
}

/** A single, short subtitle line — never a body of preview text. */
function attachmentSubtitle(attachment: ChatAttachment, kind: AttachmentKind): string {
  if (kind === 'document') {
    if (typeof attachment.lineCount === 'number' && attachment.lineCount > 0) {
      return `${attachment.lineCount.toLocaleString()} line${attachment.lineCount === 1 ? '' : 's'}`;
    }
    return 'Text';
  }
  if (kind === 'audio') return 'Audio';
  if (kind === 'video') return 'Video';
  if (kind === 'image') return 'Image';
  const ext = (attachment.name.split('.').pop() || '').trim();
  if (ext && ext.length <= 5 && ext !== attachment.name) return ext.toUpperCase();
  return 'File';
}

const RemoveButton: React.FC<{ index: number; onRemove?: (index: number) => void }> = ({ index, onRemove }) => {
  if (!onRemove) return null;
  return (
    <button
      type="button"
      onClick={() => onRemove(index)}
      title="Remove attachment"
      className={clsx(
        'absolute -right-1.5 -top-1.5 z-10 flex h-[18px] w-[18px] items-center justify-center rounded-full',
        'border border-theme bg-theme-hover text-theme-muted shadow-sm backdrop-blur',
        'opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 hover:text-theme-fg pointer-events-auto',
      )}
    >
      <X className="h-3 w-3" />
    </button>
  );
};

const AttachmentPreviewCard: React.FC<{
  attachment: ChatAttachment;
  index: number;
  onRemove?: (index: number) => void;
  compact?: boolean;
}> = ({ attachment, index, onRemove, compact = false }) => {
  const kind = getChatAttachmentKind(attachment);
  const previewUrl = getChatAttachmentDataUrl(attachment);
  const Icon = cardIcon(kind);
  const isImage = kind === 'image' && !!previewUrl;

  // ── Compact (floating over the input): fixed square chips so the reserved
  // inset always matches and nothing overlaps the typed text. ──────────────
  if (compact) {
    return (
      <div
        className="group relative shrink-0 pointer-events-auto"
        style={{ width: ATTACHMENT_OVERLAY_THUMB, height: ATTACHMENT_OVERLAY_THUMB }}
        title={attachment.name}
      >
        <RemoveButton index={index} onRemove={onRemove} />
        {isImage ? (
          <img
            src={previewUrl!}
            alt={attachment.name}
            className="h-full w-full rounded-[10px] border border-theme object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center rounded-[10px] border border-theme bg-theme-hover text-theme-muted">
            <Icon className="h-[15px] w-[15px]" />
          </div>
        )}
      </div>
    );
  }

  // ── Image: clean thumbnail. ───────────────────────────────────────────────
  if (isImage) {
    return (
      <div className="group relative shrink-0 pointer-events-auto">
        <RemoveButton index={index} onRemove={onRemove} />
        <img
          src={previewUrl!}
          alt={attachment.name}
          title={attachment.name}
          className="block max-h-[160px] max-w-[220px] rounded-xl border border-theme object-contain"
        />
      </div>
    );
  }

  // ── Everything else: one tidy horizontal chip — icon, name, short label. ──
  return (
    <div className="group relative shrink-0 pointer-events-auto">
      <RemoveButton index={index} onRemove={onRemove} />
      <div className="flex max-w-[240px] items-center gap-2.5 rounded-xl border border-theme bg-theme-hover/60 py-2 pl-2 pr-3.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-theme-hover text-theme-muted">
          <Icon className="h-[18px] w-[18px]" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[12.5px] font-medium leading-tight text-theme-fg" title={attachment.name}>
            {attachment.name}
          </div>
          <div className="truncate text-[11px] leading-tight text-theme-muted">
            {attachmentSubtitle(attachment, kind)}
          </div>
        </div>
      </div>
    </div>
  );
};

/** Floating attachment thumbs over the input surface (not a separate row). */
export const AttachmentPreviewOverlay: React.FC<AttachmentPreviewOverlayProps> = ({
  attachments,
  onRemove,
  className,
}) => {
  if (!attachments.length) return null;

  return (
    <div
      className={clsx(
        'absolute left-0 top-1/2 z-20 flex -translate-y-1/2 items-center pointer-events-none',
        className,
      )}
      style={{ gap: ATTACHMENT_OVERLAY_GAP }}
    >
      {attachments.map((attachment, index) => (
        <AttachmentPreviewCard
          key={`${attachment.name}-${index}-${attachment.mimeType || attachment.type}`}
          attachment={attachment}
          index={index}
          onRemove={onRemove}
          compact
        />
      ))}
    </div>
  );
};

export const AttachmentPreviewStrip: React.FC<AttachmentPreviewStripProps> = ({
  attachments,
  onRemove,
  layout = 'wrap',
  align = 'left',
  className,
}) => {
  if (!attachments.length) return null;

  return (
    <div
      className={clsx(
        'flex gap-2',
        layout === 'rail' ? 'overflow-x-auto pb-1 scrollbar-hidden' : 'flex-wrap',
        align === 'right' && 'justify-end',
        className,
      )}
    >
      {attachments.map((attachment, index) => (
        <AttachmentPreviewCard
          key={`${attachment.name}-${index}-${attachment.mimeType || attachment.type}`}
          attachment={attachment}
          index={index}
          onRemove={onRemove}
        />
      ))}
    </div>
  );
};
