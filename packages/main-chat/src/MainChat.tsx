'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import {
  AlertCircle,
  ChevronDown,
  Clock,
  File as FileIcon,
  Loader2,
  MessageSquare,
  Paperclip,
  Plus,
  Send,
  Square,
  WifiOff,
  X,
} from 'lucide-react';
import { PortableMessageBubble } from '@stuardai/chat-ui/ui';
import { displayConversationTitle } from '@stuardai/chat-ui';
import type { ChatAttachment } from '@stuardai/chat-ui/attachments';
import type { ToolCall } from '@stuardai/chat-ui/types';
import type { MainChatProps } from './types';
import { useWebAgent } from './useWebAgent';

interface PendingAttachment {
  id: string;
  name: string;
  attachment?: ChatAttachment;
  uploading: boolean;
  error?: string;
}

export function MainChat({
  platform,
  models,
  modelById,
  className,
  renderInteractiveTool,
}: MainChatProps) {
  const agent = useWebAgent({ platform });
  const [input, setInput] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  const selectedModelMeta = useMemo(() => {
    if (agent.selectedModel === 'auto') return null;
    return modelById.get(agent.selectedModel) || models.find((m) => m.id === agent.selectedModel) || null;
  }, [agent.selectedModel, modelById, models]);

  const interactiveToolRenderer = useCallback(
    (tool: ToolCall, key: string) => (renderInteractiveTool ? renderInteractiveTool(tool, key) : null),
    [renderInteractiveTool],
  );

  const isUploadingAny = pendingAttachments.some((attachment) => attachment.uploading);
  const readyAttachments = pendingAttachments
    .filter((attachment) => attachment.attachment && !attachment.error && !attachment.uploading)
    .map((attachment) => attachment.attachment!);

  useEffect(() => {
    if (!agent.streaming) return;
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    });
  }, [agent.streamPreview, agent.streaming]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if ((!text && readyAttachments.length === 0) || agent.streaming || isUploadingAny) return;
    setInput('');
    setPendingAttachments([]);
    await agent.sendMessage(text, readyAttachments);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    });
  }, [agent, input, isUploadingAny, readyAttachments]);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }, [handleSend]);

  const handleAttachClick = useCallback(() => {
    if (agent.streaming || !platform.prepareAttachment) return;
    attachmentInputRef.current?.click();
  }, [agent.streaming, platform]);

  const removePendingAttachment = useCallback((id: string) => {
    setPendingAttachments((prev) => prev.filter((attachment) => attachment.id !== id));
  }, []);

  const handleAttachmentFilesSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputEl = e.target;
    const picked = Array.from(inputEl.files || []);
    inputEl.value = '';
    if (picked.length === 0 || !platform.prepareAttachment) return;

    const stamp = Date.now();
    const placeholders: PendingAttachment[] = picked.map((file, idx) => ({
      id: `att-${stamp}-${idx}`,
      name: file.name,
      uploading: true,
    }));
    setPendingAttachments((prev) => [...prev, ...placeholders]);

    for (let i = 0; i < picked.length; i++) {
      const file = picked[i];
      const placeholder = placeholders[i];
      const result = await platform.prepareAttachment!(file);
      setPendingAttachments((prev) => prev.map((attachment) => {
        if (attachment.id !== placeholder.id) return attachment;
        if ('error' in result) {
          return { ...attachment, uploading: false, error: result.error };
        }
        return { ...attachment, uploading: false, attachment: result.attachment };
      }));
    }
  }, [platform]);

  const hasMessages = agent.messages.length > 0 || agent.streaming;

  return (
    <div className={clsx('flex h-full min-h-[480px] flex-col rounded-2xl border border-neutral-800 bg-[#0A0A0A]', className)}>
      <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-[14px] font-semibold text-white">Stuard Chat</h2>
          <p className="text-[11px] text-neutral-500">
            {agent.connecting ? 'Connecting…' : agent.connected ? 'Cloud orchestrator' : 'Offline'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="inline-flex items-center gap-1 rounded-lg border border-neutral-800 px-2.5 py-1.5 text-[11px] text-neutral-300 hover:bg-neutral-900"
          >
            <Clock className="h-3.5 w-3.5" />
            History
          </button>
          <button
            type="button"
            onClick={agent.startNewConversation}
            className="inline-flex items-center gap-1 rounded-lg border border-neutral-800 px-2.5 py-1.5 text-[11px] text-neutral-300 hover:bg-neutral-900"
          >
            <Plus className="h-3.5 w-3.5" />
            New
          </button>
        </div>
      </div>

      {showHistory ? (
        <div className="max-h-48 overflow-y-auto border-b border-neutral-800 px-2 py-2">
          {agent.conversations.length === 0 ? (
            <div className="px-2 py-4 text-center text-[12px] text-neutral-500">No conversations yet</div>
          ) : (
            agent.conversations.map((conv) => (
              <button
                key={conv.id}
                type="button"
                onClick={() => {
                  void agent.loadConversation(conv.id);
                  setShowHistory(false);
                }}
                className={clsx(
                  'mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-neutral-900',
                  agent.conversationId === conv.id && 'bg-neutral-900',
                )}
              >
                <MessageSquare className="h-3.5 w-3.5 shrink-0 text-neutral-500" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] text-neutral-200">{displayConversationTitle(conv.title)}</div>
                  <div className="text-[10px] text-neutral-500">{conv.message_count || 0} messages</div>
                </div>
              </button>
            ))
          )}
        </div>
      ) : null}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {!agent.connected && !agent.connecting ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-neutral-500">
            <WifiOff className="h-5 w-5" />
            <p className="text-[12px]">{agent.error || 'Not connected'}</p>
          </div>
        ) : agent.loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-neutral-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-[12px]">Loading conversation…</span>
          </div>
        ) : !hasMessages ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-neutral-500">
            <MessageSquare className="mb-2 h-6 w-6 text-neutral-700" />
            <p className="text-[13px] text-neutral-400">Ask Stuard anything</p>
            <p className="mt-1 max-w-sm text-[11px]">Web chat uses the cloud orchestrator. Tool execution that needs your desktop is not available here yet.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {agent.messages.map((message) => (
              <PortableMessageBubble
                key={message.id}
                message={message}
                interactiveToolRenderer={interactiveToolRenderer}
              />
            ))}
            {agent.streaming ? (
              <PortableMessageBubble
                key="streaming"
                message={{
                  id: 'streaming',
                  role: 'assistant',
                  text: agent.streamPreview?.text || '',
                  reasoning: agent.streamPreview?.reasoning,
                  toolCalls: agent.streamPreview?.toolCalls,
                  streamChunks: agent.streamPreview?.streamChunks,
                }}
                isStreaming
                interactiveToolRenderer={interactiveToolRenderer}
              />
            ) : null}
          </div>
        )}
      </div>

      {agent.error ? (
        <div className="border-t border-neutral-800 px-4 py-2 text-[11px] text-red-400">{agent.error}</div>
      ) : null}

      <div className="border-t border-neutral-800 p-3">
        <div className="mb-2 flex items-center gap-2">
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowModelPicker((v) => !v)}
              className="inline-flex items-center gap-1 rounded-full border border-neutral-800 px-2.5 py-1 text-[11px] text-neutral-300 hover:bg-neutral-900"
            >
              {selectedModelMeta?.name || (agent.selectedModel === 'auto' ? 'Auto' : agent.selectedModel)}
              <ChevronDown className="h-3 w-3" />
            </button>
            {showModelPicker ? (
              <div className="absolute bottom-full left-0 z-20 mb-2 max-h-56 w-64 overflow-y-auto rounded-xl border border-neutral-800 bg-[#111] p-1 shadow-xl">
                <button
                  type="button"
                  onClick={() => {
                    agent.setSelectedModel('auto');
                    setShowModelPicker(false);
                  }}
                  className="block w-full rounded-lg px-3 py-2 text-left text-[11px] text-neutral-200 hover:bg-neutral-900"
                >
                  Auto
                </button>
                {models.slice(0, 24).map((model) => (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => {
                      agent.setSelectedModel(model.id);
                      setShowModelPicker(false);
                    }}
                    className="block w-full rounded-lg px-3 py-2 text-left text-[11px] text-neutral-200 hover:bg-neutral-900"
                  >
                    {model.name}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          {agent.streaming ? (
            <button
              type="button"
              onClick={agent.stopGeneration}
              className="inline-flex items-center gap-1 rounded-full border border-neutral-700 px-2.5 py-1 text-[11px] text-neutral-300 hover:bg-neutral-900"
            >
              <Square className="h-3 w-3" />
              Stop
            </button>
          ) : null}
        </div>

        {pendingAttachments.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-2">
            {pendingAttachments.map((attachment) => (
              <div
                key={attachment.id}
                className={clsx(
                  'inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]',
                  attachment.error
                    ? 'border-red-500/40 bg-red-500/10 text-red-300'
                    : 'border-neutral-700 bg-neutral-900 text-neutral-300',
                )}
              >
                {attachment.uploading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : attachment.error ? (
                  <AlertCircle className="h-3 w-3" />
                ) : (
                  <FileIcon className="h-3 w-3" />
                )}
                <span className="max-w-[160px] truncate">{attachment.name}</span>
                <button
                  type="button"
                  onClick={() => removePendingAttachment(attachment.id)}
                  className="text-neutral-500 hover:text-white"
                  aria-label={`Remove ${attachment.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="flex items-end gap-2 rounded-2xl border border-neutral-800 bg-neutral-950 px-3 py-2">
          {platform.prepareAttachment ? (
            <>
              <button
                type="button"
                onClick={handleAttachClick}
                disabled={agent.streaming || isUploadingAny}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-900 hover:text-white disabled:opacity-40"
                aria-label="Attach file"
              >
                <Paperclip className="h-4 w-4" />
              </button>
              <input
                ref={attachmentInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => void handleAttachmentFilesSelected(e)}
              />
            </>
          ) : null}
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="Message Stuard…"
            className="max-h-32 min-h-[24px] flex-1 resize-none bg-transparent text-[13px] text-white outline-none placeholder:text-neutral-600"
          />
          <button
            type="button"
            disabled={(!input.trim() && readyAttachments.length === 0) || agent.streaming || !agent.connected || isUploadingAny}
            onClick={() => void handleSend()}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#FF383C] text-white disabled:opacity-40"
          >
            {agent.streaming || isUploadingAny ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
