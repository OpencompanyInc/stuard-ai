import React, { useCallback, useState, forwardRef, useImperativeHandle, useRef } from "react";
import { Link2, Square } from "lucide-react";

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
}>(({ onSend, busy, onStop }, ref) => {
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
      className={`w-full bg-white/90 backdrop-blur-sm border rounded-2xl shadow-xl shadow-slate-200/50 overflow-hidden ring-1 transition-all duration-200 ${
        isDragOver && hasDragUrl
          ? 'border-indigo-400 ring-indigo-400/30 bg-indigo-50/50'
          : 'border-slate-200/80 ring-slate-900/5'
      }`}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drop indicator overlay */}
      {isDragOver && hasDragUrl && (
        <div className="flex items-center justify-center gap-2 px-3 py-2 text-[12px] font-medium bg-indigo-100/80 text-indigo-700">
          <Link2 className="w-4 h-4" />
          Drop link here
        </div>
      )}

      <div className="flex items-end gap-2 p-2.5">
<textarea
          ref={textareaRef}
          className="flex-1 resize-none outline-none text-[13px] text-slate-800 placeholder:text-slate-400 bg-transparent min-h-[44px] max-h-[140px] py-2.5 px-2 scrollbar-minimal"
          placeholder={busy ? "Working..." : "Describe what to change..."}
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
        {busy && onStop ? (
          <button
            type="button"
            onClick={onStop}
            className="px-3 py-2 rounded-lg text-[13px] font-semibold bg-red-500 text-white hover:bg-red-600 transition-colors flex items-center gap-1.5"
            title="Stop generating"
          >
            <Square className="w-3 h-3 fill-current" />
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={send}
            disabled={busy || text.trim().length === 0}
            className="px-3 py-2 rounded-lg text-[13px] font-semibold bg-indigo-600 text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-indigo-700 transition-colors"
          >
            Send
          </button>
        )}
</div>
    </div>
  );
});
