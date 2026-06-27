import React, { useState } from 'react';
import { clsx } from 'clsx';
import TextareaAutosize from 'react-textarea-autosize';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { FileIcon, ImageIcon } from '@radix-ui/react-icons';
import {
  AudioLines,
  CornerDownRight,
  LogIn,
  Monitor,
  Plus as PlusLucide,
} from 'lucide-react';

import { AttachmentBar } from '../AttachmentBar';
import {
  AttachmentPreviewOverlay,
  attachmentOverlayInset,
} from '../../../../AttachmentPreview';
import type { ChatAttachment } from '../../../../../utils/attachments';
import type { ContextItem } from '../../../../FileNavigator';

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
  /** Capture the screen (Stuard excluded from the frame) and send it. */
  onScreenshotSend?: () => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;

  /** Textarea wiring. */
  textareaRef: (el: HTMLTextAreaElement | null) => void;
  query: string;
  setQuery: (q: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onHeightChange: (height: number) => void;
  placeholder: string;
  /** Faded auxiliary hint shown while the user is typing (compact mode). */
  typingHint?: string;

  /** Steer is offered while a response is still streaming. */
  miniOutputStreaming: boolean;
  /** Hide the text caret while idle or while the assistant is working (unless typing). */
  isAiWorking?: boolean;
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
  onScreenshotSend,
  onDrop,
  textareaRef,
  query,
  setQuery,
  onKeyDown,
  onPaste,
  onHeightChange,
  placeholder,
  typingHint,
  miniOutputStreaming,
  isAiWorking = false,
  onSteer,
  voiceActive,
  onToggleVoice,
}) => {
  const [inputFocused, setInputFocused] = useState(false);
  const attachmentInset = attachmentOverlayInset(attachments.length);
  const suppressCaret =
    !query.trim() &&
    (!inputFocused || isAiWorking || miniOutputStreaming);

  return (
    <div className={clsx('w-full relative', showThinkingGlow && 'compact-thinking-glow')}>
      <div
        className={clsx(
          'drag w-full relative min-h-[56px] h-auto flex flex-col justify-center overflow-hidden isolate',
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
          className="relative w-full flex min-w-0 flex-col gap-2 no-drag overflow-hidden"
          style={{ zIndex: 2, padding: 10 }}
        >
          {(contextPaths?.length ?? 0) > 0 && (
            <AttachmentBar
              attachments={[]}
              contextPaths={contextPaths}
              onRemoveAttachment={onRemoveAttachment}
              onRemoveContext={onRemoveContext}
            />
          )}

          <div
            className="flex w-full min-w-0 items-center no-drag"
            style={{ gap: 8, minHeight: 36 }}
            onKeyDownCapture={(e) => {
              if (e.key === 'Tab' && !e.shiftKey && signedIn) {
                onKeyDown(e as unknown as React.KeyboardEvent<HTMLTextAreaElement>);
              }
            }}
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
                      tabIndex={-1}
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
                      {onScreenshotSend && (
                        <DropdownMenu.Item
                          onSelect={onScreenshotSend}
                          className="group text-[13px] text-pill-fg/90 flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-pill-fg/10 outline-none cursor-pointer transition-colors"
                        >
                          <Monitor className="w-3.5 h-3.5 opacity-70" />
                          <span className="flex-1">Screenshot &amp; send</span>
                          <kbd className="ml-2 text-[10px] leading-none font-medium text-pill-fg/45 whitespace-nowrap select-none">
                            Ctrl+Shift+Enter
                          </kbd>
                        </DropdownMenu.Item>
                      )}
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>

                <div
                  className="relative flex min-h-[36px] min-w-0 flex-1 items-center overflow-hidden rounded-[12px]"
                  style={{ padding: 6, gap: 4, paddingLeft: attachmentInset > 0 ? attachmentInset + 6 : 6 }}
                >
                  {attachments.length > 0 && (
                    <AttachmentPreviewOverlay
                      attachments={attachments}
                      onRemove={onRemoveAttachment}
                    />
                  )}
                  {typingHint && query.trim().length > 0 && (
                    <span
                      className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-[10px] leading-none font-normal text-pill-fg/35 whitespace-nowrap select-none"
                      aria-hidden
                    >
                      {typingHint}
                    </span>
                  )}
                  <TextareaAutosize
                    ref={textareaRef}
                    value={query}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                      setQuery(e.target.value)
                    }
                    onFocus={() => setInputFocused(true)}
                    onBlur={() => setInputFocused(false)}
                    onKeyDown={onKeyDown}
                    onPaste={onPaste}
                    onHeightChange={onHeightChange}
                    placeholder={placeholder}
                    tabIndex={0}
                    className={clsx(
                      'w-full min-w-0 max-w-full bg-transparent outline-none text-[12px] leading-4 p-0 resize-none overflow-x-hidden overflow-y-auto scrollbar-hidden font-normal text-pill-fg placeholder:text-pill-fg break-words',
                      query.length > 0 ? 'text-left pr-[7.5rem]' : 'text-center',
                    )}
                    style={{
                      fontFamily: "'General Sans', 'Inter', 'Figtree', sans-serif",
                      overflowWrap: 'anywhere',
                      wordBreak: 'break-word',
                      caretColor: suppressCaret
                        ? 'transparent'
                        : 'rgb(var(--compact-pill-fg))',
                    }}
                    minRows={1}
                    maxRows={5}
                  />
                </div>

                {miniOutputStreaming && onSteer && query.trim() && (
                  <button
                    type="button"
                    tabIndex={-1}
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
                    tabIndex={-1}
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
