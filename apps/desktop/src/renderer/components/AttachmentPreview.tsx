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

function attachmentMeta(attachment: ChatAttachment, kind: ReturnType<typeof getChatAttachmentKind>) {
  if (kind === 'document') {
    const parts: string[] = [];
    if (typeof attachment.lineCount === 'number' && attachment.lineCount > 0) {
      parts.push(`${attachment.lineCount} lines`);
    }
    if (typeof attachment.charCount === 'number' && attachment.charCount > 0) {
      parts.push(`${attachment.charCount} chars`);
    }
    return parts.join(' | ');
  }
  if (kind === 'audio') return 'Audio attachment';
  if (kind === 'video') return 'Video attachment';
  if (kind === 'image') return 'Image attachment';
  return attachment.mimeType || 'File attachment';
}

function cardIcon(kind: ReturnType<typeof getChatAttachmentKind>) {
  if (kind === 'document') return FileText;
  if (kind === 'audio') return Music;
  if (kind === 'video') return Film;
  if (kind === 'image') return ImageIcon;
  return File;
}

const AttachmentPreviewCard: React.FC<{
  attachment: ChatAttachment;
  index: number;
  onRemove?: (index: number) => void;
}> = ({ attachment, index, onRemove }) => {
  const kind = getChatAttachmentKind(attachment);
  const previewUrl = getChatAttachmentDataUrl(attachment);
  const Icon = cardIcon(kind);
  const meta = attachmentMeta(attachment, kind);

  return (
    <div className="relative shrink-0">
      {onRemove ? (
        <button
          type="button"
          onClick={() => onRemove(index)}
          className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-black/10 bg-white/90 text-slate-500 shadow-sm transition-colors hover:text-red-500"
          title="Remove attachment"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}

      {kind === 'image' && previewUrl ? (
        <div className="group relative h-[96px] w-[156px] overflow-hidden rounded-[20px] border border-black/10 bg-slate-900 shadow-[0_12px_28px_-18px_rgba(15,23,42,0.8)]">
          <img src={previewUrl} alt={attachment.name} className="h-full w-full object-cover" />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent px-3 pb-3 pt-8 text-white">
            <div className="truncate text-[12px] font-semibold">{attachment.name}</div>
            <div className="truncate text-[10px] text-white/70">{meta}</div>
          </div>
        </div>
      ) : kind === 'document' ? (
        <div className="relative h-[104px] w-[176px]">
          <div className="absolute inset-[8px] rotate-[4deg] rounded-[22px] border border-amber-300/50 bg-amber-200/40 shadow-sm" />
          <div className="relative h-full rotate-[-2deg] rounded-[22px] border border-stone-300/70 bg-gradient-to-br from-white via-stone-50 to-amber-50 px-4 py-3 shadow-[0_18px_30px_-24px_rgba(15,23,42,0.9)]">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
                <FileText className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-[12px] font-semibold text-slate-800">{attachment.name}</div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-amber-700/80">Document</div>
              </div>
            </div>
            <div className="mt-3 max-h-[38px] overflow-hidden whitespace-pre-wrap text-[11px] leading-[1.25] text-slate-600">
              {attachment.previewText || 'Ready to send'}
            </div>
            <div className="mt-3 flex items-center gap-2 text-[10px] font-medium text-slate-500">
              <span>{meta || 'Text attachment'}</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex h-[96px] w-[156px] flex-col justify-between rounded-[20px] border border-slate-200/80 bg-gradient-to-br from-white via-slate-50 to-slate-100 p-3 shadow-[0_16px_30px_-24px_rgba(15,23,42,0.7)]">
          <div className="flex items-start gap-3">
            <div
              className={clsx(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl',
                kind === 'video' && 'bg-rose-100 text-rose-600',
                kind === 'audio' && 'bg-emerald-100 text-emerald-600',
                kind === 'file' && 'bg-sky-100 text-sky-600',
              )}
            >
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-[12px] font-semibold text-slate-800">{attachment.name}</div>
              <div className="text-[10px] text-slate-500">{meta}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-slate-400">
            <span>{kind}</span>
          </div>
        </div>
      )}
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
        'flex gap-3',
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
