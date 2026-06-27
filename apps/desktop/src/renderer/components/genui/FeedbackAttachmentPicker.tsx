import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, Loader2, Paperclip, X } from 'lucide-react';
import clsx from 'clsx';
import {
  FEEDBACK_ATTACHMENT_ACCEPT,
  FEEDBACK_ATTACHMENT_MAX_BYTES,
  FEEDBACK_ATTACHMENT_MAX_COUNT,
  formatFeedbackAttachmentSize,
  guessFeedbackMimeType,
  isFeedbackAttachmentTooLarge,
} from '../../lib/feedbackAttachments';

export type PendingFeedbackAttachment =
  | { kind: 'file'; file: File; previewUrl?: string }
  | { kind: 'path'; path: string; name: string; mimeType?: string };

interface FeedbackAttachmentPickerProps {
  attachments: PendingFeedbackAttachment[];
  onChange: (attachments: PendingFeedbackAttachment[]) => void;
  disabled?: boolean;
  allowCapture?: boolean;
  maxFiles?: number;
  className?: string;
}

function basename(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}

function isImageMime(mimeType?: string, name?: string): boolean {
  const mime = mimeType || (name ? guessFeedbackMimeType(name) : '');
  return mime.startsWith('image/');
}

export const FeedbackAttachmentPicker: React.FC<FeedbackAttachmentPickerProps> = ({
  attachments,
  onChange,
  disabled = false,
  allowCapture = false,
  maxFiles = FEEDBACK_ATTACHMENT_MAX_COUNT,
  className,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);

  useEffect(() => {
    const urls = attachments
      .filter((item): item is PendingFeedbackAttachment & { kind: 'file'; previewUrl: string } =>
        item.kind === 'file' && !!item.previewUrl,
      )
      .map((item) => item.previewUrl);

    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [attachments]);

  const remainingSlots = Math.max(0, maxFiles - attachments.length);

  const appendAttachments = useCallback(
    (next: PendingFeedbackAttachment[]) => {
      if (next.length === 0) return;
      const merged = [...attachments, ...next].slice(0, maxFiles);
      onChange(merged);
    },
    [attachments, maxFiles, onChange],
  );

  const addFiles = useCallback(
    (files: File[]) => {
      setPickerError(null);
      if (files.length === 0 || remainingSlots <= 0) return;

      const accepted = files.slice(0, remainingSlots);
      const tooLarge = accepted.filter((file) => isFeedbackAttachmentTooLarge(file.size));
      if (tooLarge.length > 0) {
        const names = tooLarge
          .map((file) => `${file.name} (${formatFeedbackAttachmentSize(file.size)})`)
          .join(', ');
        setPickerError(`Each file must be 100 MB or less: ${names}`);
      }

      const allowed = accepted.filter((file) => !isFeedbackAttachmentTooLarge(file.size));
      if (allowed.length === 0) return;

      appendAttachments(
        allowed.map((file) => ({
          kind: 'file' as const,
          file,
          previewUrl: file.type.startsWith('image/') || guessFeedbackMimeType(file.name).startsWith('image/')
            ? URL.createObjectURL(file)
            : undefined,
        })),
      );
    },
    [appendAttachments, remainingSlots],
  );

  const addPaths = useCallback(
    (paths: Array<{ path: string; name?: string; mimeType?: string }>) => {
      setPickerError(null);
      if (paths.length === 0 || remainingSlots <= 0) return;

      appendAttachments(
        paths.slice(0, remainingSlots).map((item) => ({
          kind: 'path' as const,
          path: item.path,
          name: item.name || basename(item.path),
          mimeType: item.mimeType,
        })),
      );
    },
    [appendAttachments, remainingSlots],
  );

  const handlePickFiles = useCallback(async () => {
    if (disabled || remainingSlots <= 0) return;
    setPickerError(null);

    try {
      const api: any = (window as any).desktopAPI;
      if (api?.pickFiles) {
        const res = await api.pickFiles({
          multiple: remainingSlots > 1,
          type: 'files',
        });
        const picked = Array.isArray(res?.files) ? res.files : [];
        if (res?.ok && picked.length > 0) {
          addPaths(
            picked.map((file: any) => ({
              path: String(file?.path || ''),
              name: String(file?.name || basename(String(file?.path || ''))),
              mimeType: typeof file?.mimeType === 'string' ? file.mimeType : undefined,
            })).filter((file: { path: string }) => file.path),
          );
          return;
        }
      }
    } catch {
      /* fall through to hidden input */
    }

    inputRef.current?.click();
  }, [addPaths, disabled, remainingSlots]);

  const handleCaptureScreenshot = async () => {
    if (disabled || isCapturing || remainingSlots <= 0) return;
    setPickerError(null);
    setIsCapturing(true);
    try {
      const result = await (window as any).desktopAPI?.execTool?.('capture_screen', {
        mode: 'screenshot',
        region: 'fullscreen',
      });
      if (result?.ok && result?.path) {
        addPaths([{ path: String(result.path), name: basename(String(result.path)), mimeType: 'image/png' }]);
      }
    } catch (err) {
      console.error('Screenshot capture failed:', err);
      setPickerError('Could not capture screenshot.');
    } finally {
      setIsCapturing(false);
    }
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files?.length) {
      addFiles(Array.from(event.target.files));
      event.target.value = '';
    }
  };

  const removeAttachment = (index: number) => {
    const target = attachments[index];
    if (target?.kind === 'file' && target.previewUrl) {
      URL.revokeObjectURL(target.previewUrl);
    }
    onChange(attachments.filter((_, idx) => idx !== index));
  };

  return (
    <div className={clsx('space-y-2', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void handlePickFiles()}
          disabled={disabled || remainingSlots <= 0}
          className={clsx(
            'inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[12px] font-medium transition-colors',
            disabled || remainingSlots <= 0
              ? 'border-theme text-theme-muted opacity-50 cursor-not-allowed'
              : 'border-theme text-theme-muted hover:bg-theme-hover hover:text-theme-fg',
          )}
        >
          <Paperclip className="h-3.5 w-3.5" />
          Add media
        </button>

        {allowCapture && (
          <button
            type="button"
            onClick={() => void handleCaptureScreenshot()}
            disabled={disabled || isCapturing || remainingSlots <= 0}
            className={clsx(
              'inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[12px] font-medium transition-colors',
              disabled || isCapturing || remainingSlots <= 0
                ? 'border-theme text-theme-muted opacity-50 cursor-not-allowed'
                : 'border-theme text-theme-muted hover:bg-theme-hover hover:text-theme-fg',
            )}
          >
            {isCapturing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
            Capture screen
          </button>
        )}

        <span className="text-[11px] text-theme-muted">
          Up to {maxFiles} files, 100 MB each
        </span>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={FEEDBACK_ATTACHMENT_ACCEPT}
        multiple={maxFiles > 1}
        className="hidden"
        onChange={handleInputChange}
      />

      {pickerError && <p className="text-[12px] text-red-500">{pickerError}</p>}

      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attachments.map((item, index) => {
            const name = item.kind === 'file' ? item.file.name : item.name;
            const size = item.kind === 'file' ? item.file.size : undefined;
            const mimeType = item.kind === 'file'
              ? (item.file.type || guessFeedbackMimeType(item.file.name))
              : (item.mimeType || guessFeedbackMimeType(item.name));
            const previewUrl = item.kind === 'file' ? item.previewUrl : undefined;
            const showImage = previewUrl && isImageMime(mimeType, name);

            return (
              <div key={`${name}-${index}`} className="group relative">
                <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg border border-theme bg-theme-hover">
                  {showImage ? (
                    <img src={previewUrl} alt={name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex flex-col items-center gap-1 px-1 text-center">
                      <ImagePlus className="h-4 w-4 text-theme-muted" />
                      <span className="line-clamp-2 text-[9px] text-theme-muted">{name}</span>
                    </div>
                  )}
                </div>
                {size ? (
                  <span className="absolute bottom-0 left-0 right-0 bg-black/55 px-1 py-0.5 text-center text-[8px] text-white">
                    {formatFeedbackAttachmentSize(size)}
                  </span>
                ) : null}
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => removeAttachment(index)}
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export function pendingAttachmentsToFiles(attachments: PendingFeedbackAttachment[]): File[] {
  return attachments
    .filter((item): item is PendingFeedbackAttachment & { kind: 'file' } => item.kind === 'file')
    .map((item) => item.file);
}

export function pendingAttachmentsToPaths(attachments: PendingFeedbackAttachment[]): string[] {
  return attachments
    .filter((item): item is PendingFeedbackAttachment & { kind: 'path' } => item.kind === 'path')
    .map((item) => item.path);
}
