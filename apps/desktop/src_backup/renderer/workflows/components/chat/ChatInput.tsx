import React, { useCallback, useState } from "react";
import { Link2, Youtube } from "lucide-react";

// Helper to extract YouTube URL from dropped data
function extractYouTubeUrl(text: string): string | null {
  if (!text) return null;
  // Match various YouTube URL formats
  const patterns = [
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,
    /(?:https?:\/\/)?youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      // Return the full URL found in the text
      const fullUrlMatch = text.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+/);
      return fullUrlMatch ? fullUrlMatch[0] : `https://youtube.com/watch?v=${match[1]}`;
    }
  }
  return null;
}

// Check if any URL is present
function extractAnyUrl(text: string): string | null {
  if (!text) return null;
  const match = text.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+/);
  return match ? match[0] : null;
}

export function ChatInput({
  onSend,
  busy,
}: {
  onSend: (text: string) => void;
  busy: boolean;
}) {
  const [text, setText] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragType, setDragType] = useState<'youtube' | 'link' | null>(null);

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
      const ytUrl = extractYouTubeUrl(textData);
      setDragType(ytUrl ? 'youtube' : 'link');
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
      setDragType(null);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    setDragType(null);

    // Try to get URL from various data types
    const uriList = e.dataTransfer.getData('text/uri-list');
    const plainText = e.dataTransfer.getData('text/plain');
    const htmlText = e.dataTransfer.getData('text/html');

    // Extract URL from the dropped data
    let droppedUrl: string | null = null;

    // First try uri-list (most reliable for dragged links)
    if (uriList) {
      const ytUrl = extractYouTubeUrl(uriList);
      droppedUrl = ytUrl || extractAnyUrl(uriList);
    }

    // Then try plain text
    if (!droppedUrl && plainText) {
      const ytUrl = extractYouTubeUrl(plainText);
      droppedUrl = ytUrl || extractAnyUrl(plainText);
    }

    // Try to extract from HTML if available
    if (!droppedUrl && htmlText) {
      const hrefMatch = htmlText.match(/href=["']([^"']+)["']/);
      if (hrefMatch) {
        const ytUrl = extractYouTubeUrl(hrefMatch[1]);
        droppedUrl = ytUrl || hrefMatch[1];
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
        isDragOver
          ? dragType === 'youtube'
            ? 'border-red-400 ring-red-400/30 bg-red-50/50'
            : 'border-indigo-400 ring-indigo-400/30 bg-indigo-50/50'
          : 'border-slate-200/80 ring-slate-900/5'
      }`}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drop indicator overlay */}
      {isDragOver && (
        <div className={`flex items-center justify-center gap-2 px-3 py-2 text-[12px] font-medium ${
          dragType === 'youtube' ? 'bg-red-100/80 text-red-700' : 'bg-indigo-100/80 text-indigo-700'
        }`}>
          {dragType === 'youtube' ? (
            <>
              <Youtube className="w-4 h-4" />
              Drop YouTube video here
            </>
          ) : (
            <>
              <Link2 className="w-4 h-4" />
              Drop link here
            </>
          )}
        </div>
      )}

      <div className="flex items-end gap-2 p-2.5">
        <textarea
          className="flex-1 resize-none outline-none text-[13px] text-slate-800 placeholder:text-slate-400 bg-transparent min-h-[44px] max-h-[140px] py-2.5 px-2 scrollbar-minimal"
          placeholder={busy ? "Working..." : "Describe what to change... (drag YouTube links here)"}
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
        <button
          type="button"
          onClick={send}
          disabled={busy || text.trim().length === 0}
          className="px-3 py-2 rounded-lg text-[13px] font-semibold bg-indigo-600 text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-indigo-700 transition-colors"
        >
          Send
        </button>
      </div>
    </div>
  );
}
