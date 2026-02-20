import React, { useRef } from 'react';
import { clsx } from 'clsx';
import TextareaAutosize from 'react-textarea-autosize';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Image, File, X, Plus, Mic, Square } from 'lucide-react';
import QueuePanel from '../QueuePanel';
import { CheckpointManager } from '../CheckpointManager';
import { ModelSelector } from '../ModelSelector';
import { FileNavRef } from '../FileNavigator';
import { FolderPermissionsPopover } from './FolderPermissionsPopover';
import type { ReasoningLevel } from '../../hooks/usePreferences';

interface ChatInputAreaProps {
  query: string;
  setQuery: (q: string) => void;
  onSend: () => void;
  onStop?: () => void;
  isStreaming?: boolean;
  isRecording?: boolean;
  onMicClick?: () => void;
  attachments?: Array<{ type: 'image' | 'file'; name: string }>;
  onRemoveAttachment?: (index: number) => void;
  onAttachFiles?: () => void;
  onAttachImages?: () => void;
  onDrop?: (e: React.DragEvent<HTMLDivElement>) => void;
  queueDepth?: number;
  queuedMessages?: any[];
  statusText?: string;
  connectionStatus?: 'connected' | 'connecting' | 'disconnected' | 'error';
  displayModelName: string;
  translucentMode?: boolean;
  showFileNav: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  selectedModelId: string;
  onChatModeChange?: (mode: any) => void;
  reasoningLevel?: ReasoningLevel;
  onReasoningLevelChange?: (level: ReasoningLevel) => void;
  fileNavRef?: React.RefObject<FileNavRef>;
}

export const ChatInputArea: React.FC<ChatInputAreaProps> = ({
  query,
  setQuery,
  onSend,
  onStop,
  isStreaming = false,
  isRecording,
  onMicClick,
  attachments = [],
  onRemoveAttachment,
  onAttachFiles,
  onAttachImages,
  onDrop,
  queueDepth = 0,
  queuedMessages = [],
  statusText = 'Online',
  connectionStatus = 'connected',
  displayModelName,
  translucentMode = false,
  showFileNav,
  textareaRef,
  selectedModelId,
  onChatModeChange,
  reasoningLevel,
  onReasoningLevelChange,
  fileNavRef,
}) => {
  return (
    <div
      className={clsx(
        "rounded-[28px] p-1 flex flex-col gap-1 shrink-0 relative transition-all duration-300",
        translucentMode
          ? "bg-theme-bg backdrop-blur-xl"
          : "bg-theme-card"
      )}
      onDragOver={(e) => { e.preventDefault(); try { e.dataTransfer.dropEffect = 'copy'; } catch { } }}
      onDrop={onDrop}
    >
      {queueDepth > 0 && (
        <QueuePanel messages={queuedMessages as any} queueDepth={queueDepth} />
      )}

      {attachments.length > 0 && (
        <div className="px-2 pt-2 pb-1 flex flex-wrap gap-2">
          {attachments.map((att, idx) => (
            <div
              key={`att-${idx}`}
              className="group flex items-center gap-1.5 px-2.5 py-1.5 bg-theme-active/50 hover:bg-theme-active rounded-xl text-[12px] text-theme-fg border border-theme/10"
            >
              {att.type === 'image' ? (
                <Image className="w-3.5 h-3.5 text-primary" />
              ) : (
                <File className="w-3.5 h-3.5 text-emerald-500" />
              )}
              <span className="max-w-[160px] truncate font-semibold">{att.name}</span>
              {onRemoveAttachment && (
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(idx)}
                  className="ml-0.5 text-theme-muted hover:text-theme-fg hover:bg-theme-hover rounded p-0.5 transition-colors opacity-0 group-hover:opacity-100"
                  title="Remove"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Status Row */}
      <div className="flex items-center justify-between px-3 py-1">
        <div className="flex items-center gap-2">
          <div className={clsx(
            "w-2.5 h-2.5 rounded-full",
            connectionStatus === 'connected' ? 'bg-emerald-500' :
              connectionStatus === 'connecting' ? 'bg-amber-500' :
                connectionStatus === 'error' ? 'bg-red-500' :
                  'bg-theme-muted/50'
          )} />
          {connectionStatus === 'connecting' ? (
            <div className="w-3.5 h-3.5 border-2 border-theme-muted/70 border-t-transparent rounded-full animate-spin" />
          ) : null}
          <span className={clsx(
            "text-[11px] font-bold uppercase tracking-widest",
            connectionStatus === 'connected' ? 'text-theme-muted' :
              connectionStatus === 'connecting' ? 'text-amber-700 dark:text-amber-500' :
                connectionStatus === 'error' ? 'text-red-600' :
                  'text-theme-muted'
          )}>
            {statusText}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <CheckpointManager />
          <span className="text-[11px] font-bold uppercase tracking-widest text-theme-muted truncate max-w-[240px]">{displayModelName}</span>
        </div>
      </div>

      {/* Input Row */}
      <div className="flex items-center gap-2 bg-theme-hover/50 rounded-[24px] p-1.5 pr-2 focus-within:ring-2 focus-within:ring-primary/10 transition-all relative z-50">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-theme-card transition-colors text-theme-muted hover:text-theme-fg"
              title="Attach"
            >
              <Plus className="w-5 h-5" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="DropdownContent z-[10005] min-w-[180px] bg-theme-card rounded-xl border border-theme p-1 shadow-xl" sideOffset={8} align="start" collisionPadding={10}>
              <DropdownMenu.Item
                onSelect={() => onAttachFiles?.()}
                className={clsx(
                  "group text-[13px] text-theme-fg font-semibold flex items-center gap-2 px-3 py-2.5 rounded-lg outline-none transition-colors",
                  onAttachFiles ? "hover:bg-theme-hover cursor-pointer" : "opacity-40 cursor-not-allowed"
                )}
              >
                <File className="w-4 h-4 text-primary group-hover:opacity-100 opacity-70" />
                <span>Attach files</span>
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={() => onAttachImages?.()}
                className={clsx(
                  "group text-[13px] text-theme-fg font-bold flex items-center gap-2 px-3 py-2.5 rounded-lg outline-none transition-colors",
                  onAttachImages ? "hover:bg-theme-hover cursor-pointer" : "opacity-40 cursor-not-allowed"
                )}
              >
                <Image className="w-4 h-4 text-primary group-hover:opacity-100 opacity-70" />
                <span>Attach images</span>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>

        <div className={clsx(
          "flex-1 relative rounded-xl transition-all flex items-center",
          showFileNav && "ring-2 ring-primary/40 bg-primary/5"
        )}>
          <TextareaAutosize
            ref={textareaRef}
            data-onboarding="chat-input"
            className={clsx(
              "w-full bg-transparent outline-none text-[15px] text-theme-fg placeholder:text-theme-muted font-semibold min-w-0 resize-none leading-5 py-0 overflow-y-auto custom-scrollbar px-2",
              showFileNav && "text-primary placeholder:text-primary/40"
            )}
            placeholder={showFileNav ? "Type to filter context..." : "Just ask Stuard"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if ((e.nativeEvent as any)?.isComposing) return;

              if (showFileNav && fileNavRef?.current) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  fileNavRef.current.moveSelection(1);
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  fileNavRef.current.moveSelection(-1);
                  return;
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault();
                  fileNavRef.current.selectCurrent();
                  return;
                }
                if (e.key === 'Escape') {
                  // Optional: Close on Escape handled by parent usually, but we can prevent default
                  // The parent (ChatView) handles onClose via other means or we might need a prop to close it explicitly here if desired.
                  // For now let's just let it bubble or preventDefault if we had an onClose prop.
                }
              }

              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            minRows={1}
            maxRows={3}
            autoFocus
          />
        </div>

        <ModelSelector
          selectedModelId={selectedModelId}
          onSelectModel={(id) => {
            try { onChatModeChange?.(id as any); } catch { }
          }}
          reasoningLevel={reasoningLevel}
          onReasoningLevelChange={onReasoningLevelChange}
          side="top"
          align="end"
        />

        <FolderPermissionsPopover />

        {isStreaming ? (
          <button
            onClick={onStop}
            className="h-10 w-10 rounded-[18px] flex items-center justify-center transition-all hover:scale-105 active:scale-95 flex-shrink-0 bg-red-500 text-white hover:bg-red-600"
            title="Stop generation"
          >
            <Square className="w-4 h-4 fill-current" />
          </button>
        ) : (
          <button
            onClick={onMicClick}
            className={clsx(
              "h-10 w-10 rounded-[18px] flex items-center justify-center transition-all hover:scale-105 active:scale-95 flex-shrink-0",
              isRecording ? "bg-red-500 text-white animate-pulse" : "bg-primary text-primary-fg hover:opacity-90"
            )}
          >
            <Mic className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  );
};


