import React, { useCallback, useState, forwardRef, useImperativeHandle, useRef } from "react";
import { Link2, Square, Plus } from "lucide-react";
import { ModelSelector } from "../../../components/ModelSelector";
import type { ReasoningLevel } from "../../../hooks/usePreferences";
import type { ContextUsageMetrics } from "../../../utils/contextUsage";
import { ContextUsageIndicator } from "../../../components/ContextUsageIndicator";

function extractAnyUrl(text: string): string | null {
  if (!text) return null;
  const match = text.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+/);
  return match ? match[0] : null;
}

export interface ChatInputRef {
  focus: () => void;
}

export const ChatInput = forwardRef<ChatInputRef, {
  onSend: (text: string) => void;
  busy: boolean;
  onStop?: () => void;
  contextMetrics?: ContextUsageMetrics | null;
  selectedModelId?: string | 'auto';
  onSelectModel?: (id: string | 'auto') => void;
  reasoningLevel?: ReasoningLevel;
  onReasoningLevelChange?: (level: ReasoningLevel) => void;
}>(({ onSend, busy, onStop, contextMetrics, selectedModelId, onSelectModel, reasoningLevel, onReasoningLevelChange }, ref) => {
  const [text, setText] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [hasDragUrl, setHasDragUrl] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
  }), []);

  const send = useCallback(() => {
    const t = text.trim();
    if (!t || busy) return;
    onSend(t);
    setText("");
  }, [text, busy, onSend]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Check what's being dragged
    const textData = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text/uri-list');
    if (textData) {
      setHasDragUrl(!!extractAnyUrl(textData));
    }
    setIsDragOver(true);
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set to false if we're leaving the container (not entering a child)
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setIsDragOver(false);
      setHasDragUrl(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    setHasDragUrl(false);

    // Try to get URL from various data types
    const uriList = e.dataTransfer.getData('text/uri-list');
    const plainText = e.dataTransfer.getData('text/plain');
    const htmlText = e.dataTransfer.getData('text/html');

    // Extract URL from the dropped data
    let droppedUrl: string | null = null;

    // First try uri-list (most reliable for dragged links)
    if (uriList) {
      droppedUrl = extractAnyUrl(uriList);
    }

    // Then try plain text
    if (!droppedUrl && plainText) {
      droppedUrl = extractAnyUrl(plainText);
    }

    // Try to extract from HTML if available
    if (!droppedUrl && htmlText) {
      const hrefMatch = htmlText.match(/href=["']([^"']+)["']/);
      if (hrefMatch) {
        droppedUrl = hrefMatch[1];
      }
    }

    if (droppedUrl) {
      // Append to existing text or set as new text
      const newText = text.trim()
        ? `${text.trim()} ${droppedUrl}`
        : droppedUrl;
      setText(newText);
    }
  }, [text]);

  return (
    <div
      className={`w-full bg-black/40 backdrop-blur-md border rounded-2xl shadow-xl shadow-black/50 ring-1 transition-all duration-200 ${isDragOver && hasDragUrl
          ? 'border-indigo-500/50 ring-indigo-500/30 bg-indigo-500/10'
          : 'border-white/[0.08] ring-white/[0.04]'
        }`}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drop indicator overlay */}
      {isDragOver && hasDragUrl && (
        <div className="flex items-center justify-center gap-2 px-3 py-2 text-[12px] font-medium bg-indigo-500/20 text-indigo-400">
          <Link2 className="w-4 h-4" />
          Drop link here
        </div>
      )}

      <div className="flex flex-col p-2.5">
        <textarea
          ref={textareaRef}
          className="w-full resize-none outline-none text-[13px] text-white/90 placeholder:text-white/40 bg-transparent min-h-[44px] max-h-[140px] py-1 px-1 scrollbar-minimal"
          placeholder={busy ? "Working..." : "Tell Stuard what to do"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          disabled={busy}
        />
        <div className="flex items-center justify-between mt-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/[0.06] transition-colors"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <ContextUsageIndicator metrics={contextMetrics} compact />
            {onSelectModel && selectedModelId && (
              <ModelSelector
                selectedModelId={selectedModelId}
                onSelectModel={onSelectModel}
                reasoningLevel={reasoningLevel}
                onReasoningLevelChange={onReasoningLevelChange}
                side="top"
                align="end"
                variant="glass"
                portal
                panelWidth={340}
              />
            )}
            {busy && onStop ? (
              <button
                type="button"
                onClick={onStop}
                className="px-3 py-1.5 rounded-xl text-[12px] font-semibold bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30 transition-colors flex items-center gap-1.5"
                title="Stop generating"
              >
                <Square className="w-3 h-3 fill-current" />
                Stop
              </button>
            ) : (text.trim().length > 0 && (
              <button
                type="button"
                onClick={send}
                disabled={busy}
                className="px-3 py-1.5 rounded-xl text-[12px] font-semibold bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-indigo-500/30 transition-colors"
              >
                Send
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});
