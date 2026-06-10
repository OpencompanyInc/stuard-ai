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

/** Width reserved per overlaid image thumb (px). */
export const ATTACHMENT_OVERLAY_THUMB = 40;
export const ATTACHMENT_OVERLAY_GAP = 4;

export function attachmentOverlayInset(count: number): number {
  if (count <= 0) return 0;
  return count * ATTACHMENT_OVERLAY_THUMB + (count - 1) * ATTACHMENT_OVERLAY_GAP + 8;
}

function attachmentMeta(attachment: ChatAttachment, kind: ReturnType<typeof getChatAttachmentKind>) {
  if (kind === 'document') {
    const parts: string[] = [];
    if (typeof attachment.lineCount === 'number' && attachment.lineCount > 0) {
      parts.push(`${attachment.lineCount} lines`);
    }
    if (typeof attachment.charCount === 'number' && attachment.charCount > 0) {
      parts.push(`${attachment.charCount} chars`);
    }
    return parts.join(' · ');
  }
  if (kind === 'audio') return 'Audio';
  if (kind === 'video') return 'Video';
  if (kind === 'image') return 'Image';
  return attachment.mimeType || 'File';
}

function cardIcon(kind: ReturnType<typeof getChatAttachmentKind>) {
  if (kind === 'document') return FileText;
  if (kind === 'audio') return Music;
  if (kind === 'video') return Film;
  if (kind === 'image') return ImageIcon;
  return File;
}

const CARD_BG = 'color-mix(in srgb, var(--foreground) 5%, transparent)';
const CARD_BORDER = 'color-mix(in srgb, var(--foreground) 12%, transparent)';
const ICON_BG = 'color-mix(in srgb, var(--foreground) 9%, transparent)';
const FG = 'var(--foreground)';
const FG_MUTED = 'var(--foreground-muted)';
const FG_FAINT = 'color-mix(in srgb, var(--foreground-muted) 70%, transparent)';

const AttachmentPreviewCard: React.FC<{
  attachment: ChatAttachment;
  index: number;
  onRemove?: (index: number) => void;
  compact?: boolean;
}> = ({ attachment, index, onRemove, compact = false }) => {
  const kind = getChatAttachmentKind(attachment);
  const previewUrl = getChatAttachmentDataUrl(attachment);
  const Icon = cardIcon(kind);
  const meta = attachmentMeta(attachment, kind);

  const removeButton = onRemove ? (
    <button
      type="button"
      onClick={() => onRemove(index)}
      className="absolute -right-1.5 -top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full transition-colors pointer-events-auto"
      style={{
        background: 'color-mix(in srgb, var(--background) 80%, transparent)',
        border: `1px solid ${CARD_BORDER}`,
        color: FG_MUTED,
        backdropFilter: 'blur(6px)',
      }}
      title="Remove attachment"
    >
      <X className="h-3.5 w-3.5" />
    </button>
  ) : null;

  if (kind === 'image' && previewUrl) {
    return (
      <div className="relative shrink-0 pointer-events-auto">
        {removeButton}
        <img
          src={previewUrl}
          alt={attachment.name}
          title={attachment.name}
          className={clsx(
            'block shadow-sm',
            compact
              ? 'h-10 w-10 rounded-md object-cover'
              : 'max-h-[220px] max-w-[280px] rounded-xl object-contain',
          )}
          style={{ border: `1px solid ${CARD_BORDER}` }}
        />
      </div>
    );
  }

  if (compact) {
    return (
      <div className="relative shrink-0 pointer-events-auto max-w-[88px]">
        {removeButton}
        <div
          className="flex h-8 items-center gap-1.5 rounded-md px-2 pr-5"
          style={{ border: `1px solid ${CARD_BORDER}`, background: CARD_BG }}
          title={attachment.name}
        >
          <Icon className="h-3 w-3 shrink-0" style={{ color: FG_MUTED }} />
          <span className="truncate text-[10px] font-semibold" style={{ color: FG }}>
            {attachment.name}
          </span>
        </div>
      </div>
    );
  }

  if (kind === 'document') {
    return (
      <div className="relative shrink-0">
        {removeButton}
        <div
          className="h-[104px] w-[184px] rounded-2xl px-3.5 py-3"
          style={{ border: `1px solid ${CARD_BORDER}`, background: CARD_BG }}
        >
          <div className="flex items-start gap-2.5">
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
              style={{ background: ICON_BG, color: FG_MUTED }}
            >
              <FileText className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-[12px] font-semibold" style={{ color: FG }} title={attachment.name}>
                {attachment.name}
              </div>
              <div className="text-[10px] uppercase tracking-[0.16em]" style={{ color: FG_FAINT }}>
                Document
              </div>
            </div>
          </div>
          <div
            className="mt-2.5 max-h-[34px] overflow-hidden whitespace-pre-wrap text-[11px] leading-[1.3]"
            style={{ color: FG_MUTED }}
          >
            {attachment.previewText || 'Ready to send'}
          </div>
          {meta ? (
            <div className="mt-2 text-[10px] font-medium" style={{ color: FG_FAINT }}>
              {meta}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="relative shrink-0">
      {removeButton}
      <div
        className="flex h-[96px] w-[156px] flex-col justify-between rounded-2xl p-3"
        style={{ border: `1px solid ${CARD_BORDER}`, background: CARD_BG }}
      >
        <div className="flex items-start gap-2.5">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
            style={{ background: ICON_BG, color: FG_MUTED }}
          >
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[12px] font-semibold" style={{ color: FG }} title={attachment.name}>
              {attachment.name}
            </div>
            <div className="truncate text-[10px]" style={{ color: FG_MUTED }}>{meta}</div>
          </div>
        </div>
        <div className="text-[10px] uppercase tracking-[0.14em]" style={{ color: FG_FAINT }}>
          {kind}
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
        'absolute left-0 top-1/2 z-20 flex -translate-y-1/2 items-center gap-1 pointer-events-none',
        className,
      )}
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
