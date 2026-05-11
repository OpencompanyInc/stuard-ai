'use client';

import {
  ALLOWED_ATTACHMENT_ACCEPT,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_BYTES,
  formatBytes,
  type SupportAttachment,
} from '@/lib/supportApi';

export function AttachmentPicker({
  attachments, onRemove, onFiles, uploading, inputRef,
}: {
  attachments: SupportAttachment[];
  onRemove: (idx: number) => void;
  onFiles: (files: FileList | null) => void;
  uploading: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const atLimit = attachments.length >= MAX_ATTACHMENTS_PER_MESSAGE;
  return (
    <div>
      <label className="block text-[13px] font-medium text-gray-700 mb-1.5">Attachments</label>
      <div className="space-y-2">
        {attachments.map((a, idx) => (
          <div key={a.path} className="flex items-center gap-2 text-[12px] bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
            <PaperclipIcon className="w-3.5 h-3.5 text-gray-400" />
            <span className="flex-1 truncate text-gray-700">{a.name}</span>
            <span className="text-gray-400 text-[11px]">{formatBytes(a.size)}</span>
            <button
              type="button"
              onClick={() => onRemove(idx)}
              className="text-gray-400 hover:text-red-600 text-[11px] px-1"
              aria-label="Remove attachment"
            >
              ✕
            </button>
          </div>
        ))}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading || atLimit}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <PaperclipIcon className="w-3.5 h-3.5" />
            {uploading ? 'Uploading…' : atLimit ? `Limit reached (${MAX_ATTACHMENTS_PER_MESSAGE})` : 'Attach file'}
          </button>
          <span className="text-[11px] text-gray-400">
            Images & PDF, max {formatBytes(MAX_ATTACHMENT_BYTES)} each
          </span>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ALLOWED_ATTACHMENT_ACCEPT}
          multiple
          onChange={e => onFiles(e.target.files)}
          className="hidden"
        />
      </div>
    </div>
  );
}

function PaperclipIcon({ className }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" /></svg>;
}
