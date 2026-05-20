import React, { memo } from 'react';
import { Cross2Icon } from '@radix-ui/react-icons';
import { Image as ImageIconLucide, File as FileIconLucide, Folder, FileText } from 'lucide-react';
import type { ContextItem } from '../../../FileNavigator';

interface AttachmentBarProps {
  attachments: Array<{ type: 'image' | 'file'; name: string }>;
  contextPaths?: ContextItem[];
  onRemoveAttachment: (index: number) => void;
  onRemoveContext: (index: number) => void;
}

// Helper component for attachments & context
export const AttachmentBar = memo(({
  attachments,
  contextPaths,
  onRemoveAttachment,
  onRemoveContext,
}: AttachmentBarProps) => {
  if (attachments.length === 0 && (!contextPaths || contextPaths.length === 0)) return null;

  return (
    <div className="w-full flex flex-wrap gap-2 px-1 py-1 animate-in fade-in slide-in-from-bottom-1 duration-200 no-drag relative z-20">
      {/* Attachments */}
      {attachments.map((att, idx) => (
        <div
          key={`att-${idx}`}
          className="group relative flex items-center gap-2 pl-2 pr-7 py-1.5 rounded-xl bg-gray-200/50 border border-gray-300/30 hover:bg-gray-200/80 hover:border-gray-300/50 transition-all cursor-default select-none shadow-sm backdrop-blur-md"
        >
          {att.type === 'image' ? (
            <div className="w-5 h-5 rounded-md bg-purple-500/10 flex items-center justify-center text-purple-500">
              <ImageIconLucide className="w-3 h-3" />
            </div>
          ) : (
            <div className="w-5 h-5 rounded-md bg-blue-500/10 flex items-center justify-center text-blue-500">
              <FileIconLucide className="w-3 h-3" />
            </div>
          )}
          <span className="text-[11px] font-semibold text-theme-fg max-w-[120px] truncate">
            {att.name}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onRemoveAttachment(idx); }}
            className="absolute right-1 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-lg text-theme-muted hover:text-red-500 hover:bg-red-500/10 transition-colors opacity-50 group-hover:opacity-100"
            title="Remove attachment"
          >
            <Cross2Icon className="w-3 h-3" />
          </button>
        </div>
      ))}

      {/* Context Paths */}
      {contextPaths?.map((c, i) => (
        <div
          key={c.path}
          className="group relative flex items-center gap-2 pl-2 pr-7 py-1.5 rounded-xl bg-primary/5 border border-primary/10 hover:bg-primary/10 hover:border-primary/20 transition-all cursor-default select-none shadow-sm backdrop-blur-md"
        >
          <div className="w-5 h-5 rounded-md bg-primary/10 flex items-center justify-center text-primary">
            {c.isDirectory ? (
              <Folder className="w-3 h-3" />
            ) : (
              <FileText className="w-3 h-3" />
            )}
          </div>
          <div className="flex flex-col leading-none justify-center">
            <span className="text-[11px] font-semibold text-theme-fg max-w-[120px] truncate">
              {c.name}
            </span>
            <span className="text-[9px] text-primary/70 font-medium truncate max-w-[100px] mt-0.5">
              Context
            </span>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onRemoveContext(i); }}
            className="absolute right-1 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-lg text-theme-muted hover:text-red-500 hover:bg-red-500/10 transition-colors opacity-50 group-hover:opacity-100"
            title="Remove context"
          >
            <Cross2Icon className="w-3 h-3" />
          </button>
        </div>
      ))}
    </div>
  );
});
