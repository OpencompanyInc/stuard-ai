import React from 'react';
import { clsx } from 'clsx';
import TextareaAutosize from 'react-textarea-autosize';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { FileIcon, ImageIcon } from '@radix-ui/react-icons';
import {
  AudioLines,
  CornerDownRight,
  LogIn,
  Plus as PlusLucide,
} from 'lucide-react';

import { AttachmentBar } from '../AttachmentBar';
import type { ContextItem } from '../../../../FileNavigator';

interface ChatAttachment {
  type: 'image' | 'file';
  name: string;
}

interface CompactInputPillProps {
  /** Show thinking-glow border instead of the static surface. */
  showThinkingGlow: boolean;

  /** Auth gating — when signed out the pill collapses to a Sign-in button. */
  signedIn: boolean;
  onSignIn: () => void;

  /** Attachments + @-context. */
  attachments: ChatAttachment[];
  contextPaths?: ContextItem[];
  onRemoveAttachment: (index: number) => void;
  onRemoveContext: (idx: number) => void;
  onAttachFiles: () => void;
  onAttachImages: () => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;

  /** Textarea wiring. */
  textareaRef: (el: HTMLTextAreaElement | null) => void;
  query: string;
  setQuery: (q: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onHeightChange: (height: number) => void;
  placeholder: string;

  /** Steer is offered while a response is still streaming. */
  miniOutputStreaming: boolean;
  onSteer?: () => void;

  /** Voice toggle. */
  voiceActive: boolean;
  onToggleVoice?: () => void;
}

/**
 * The input bar itself for compact mode — translucent pill containing
 * attachments, attach menu, the textarea, the steer hint, and the voice toggle.
 */
export const CompactInputPill: React.FC<CompactInputPillProps> = ({
  showThinkingGlow,
  signedIn,
  onSignIn,
  attachments,
  contextPaths,
  onRemoveAttachment,
  onRemoveContext,
  onAttachFiles,
  onAttachImages,
  onDrop,
  textareaRef,
  query,
  setQuery,
  onKeyDown,
  onPaste,
  onHeightChange,
  placeholder,
  miniOutputStreaming,
  onSteer,
  voiceActive,
  onToggleVoice,
}) => {
  return (
    <div className={clsx('w-full relative', showThinkingGlow && 'compact-thinking-glow')}>
      <div
        className={clsx(
          'drag w-full relative min-h-[56px] h-auto flex flex-col justify-center overflow-visible isolate',
          showThinkingGlow ? 'compact-thinking-glow__inner' : 'rounded-[26px]',
        )}
        style={{
          zIndex: 2,
          ...(showThinkingGlow
            ? {}
            : {
                backgroundColor: 'rgb(var(--compact-pill-bg))',
                boxShadow: 'var(--compact-pill-shadow)',
              }),
        }}
        onDragOver={(e) => {
          e.preventDefault();
          try {
            e.dataTransfer.dropEffect = 'copy';
          } catch {
            // ignore — some platforms reject dropEffect mutations
          }
        }}
        onDrop={onDrop}
      >
        <div
          className="relative w-full flex flex-col gap-2 no-drag"
          style={{ zIndex: 2, padding: 10 }}
        >
          {(attachments.length > 0 || (contextPaths?.length ?? 0) > 0) && (
            <AttachmentBar
              attachments={attachments}
              contextPaths={contextPaths}
              onRemoveAttachment={onRemoveAttachment}
              onRemoveContext={onRemoveContext}
            />
          )}

          <div
            className="flex items-center w-full no-drag"
            style={{ gap: 8, height: 36 }}
          >
            {!signedIn ? (
              <button
                onClick={onSignIn}
                className="no-drag flex-1 flex items-center justify-center gap-1.5 h-9 rounded-[12px] bg-white text-[#171717] font-semibold text-[12px] hover:bg-[#F5F5F5] transition-all active:scale-[0.98]"
              >
                <LogIn className="w-3.5 h-3.5" strokeWidth={2.25} />
                <span>Sign in to continue</span>
              </button>
            ) : (
              <>
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <button
                      type="button"
                      className="w-6 h-6 flex items-center justify-center text-pill-fg/90 hover:text-pill-fg transition-colors flex-shrink-0"
                      title="Attach"
                    >
                      <PlusLucide className="w-6 h-6" strokeWidth={1.5} />
                    </button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      className="DropdownContent z-[10001] min-w-[160px] bg-pill-bg rounded-xl border border-pill-fg/10 p-1 shadow-[var(--compact-pill-shadow)]"
                      sideOffset={8}
                      align="start"
                      collisionPadding={10}
                    >
                      <DropdownMenu.Item
                        onSelect={onAttachFiles}
                        className="group text-[13px] text-pill-fg/90 flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-pill-fg/10 outline-none cursor-pointer transition-colors"
                      >
                        <FileIcon className="w-3.5 h-3.5 opacity-70" />
                        <span>Attach files</span>
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        onSelect={onAttachImages}
                        className="group text-[13px] text-pill-fg/90 flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-pill-fg/10 outline-none cursor-pointer transition-colors"
                      >
                        <ImageIcon className="w-3.5 h-3.5 opacity-70" />
                        <span>Attach images</span>
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>

                <div
                  className="flex-1 relative flex items-center justify-center min-h-[36px] rounded-[12px]"
                  style={{ padding: 6, gap: 4 }}
                >
                  <TextareaAutosize
                    ref={textareaRef}
                    value={query}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                      setQuery(e.target.value)
                    }
                    onKeyDown={onKeyDown}
                    onPaste={onPaste}
                    onHeightChange={onHeightChange}
                    placeholder={placeholder}
                    className={clsx(
                      'w-full bg-transparent outline-none text-[12px] leading-4 p-0 resize-none scrollbar-hidden font-normal text-pill-fg placeholder:text-pill-fg',
                      query.length > 0 ? 'text-left' : 'text-center',
                    )}
                    style={{
                      fontFamily: "'General Sans', 'Inter', 'Figtree', sans-serif",
                    }}
                    minRows={1}
                    maxRows={5}
                  />
                </div>

                {miniOutputStreaming && onSteer && query.trim() && (
                  <button
                    type="button"
                    className="w-8 h-8 rounded-[10px] flex items-center justify-center text-pill-fg/80 hover:text-pill-fg hover:bg-pill-fg/10 transition-all active:scale-95 flex-shrink-0"
                    title="Steer current step"
                    onClick={onSteer}
                  >
                    <CornerDownRight className="w-4 h-4" />
                  </button>
                )}

                {onToggleVoice && (
                  <button
                    type="button"
                    className={clsx(
                      'compact-voice-btn relative z-10 w-9 h-9 rounded-[14px] flex items-center justify-center flex-shrink-0',
                      voiceActive && 'compact-voice-btn--active',
                      showThinkingGlow && 'compact-voice-btn--thinking',
                    )}
                    title={voiceActive ? 'Stop voice' : 'Start voice'}
                    onClick={onToggleVoice}
                  >
                    <AudioLines className="w-[18px] h-[18px] relative z-[1]" strokeWidth={2.25} />
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CompactInputPill;
