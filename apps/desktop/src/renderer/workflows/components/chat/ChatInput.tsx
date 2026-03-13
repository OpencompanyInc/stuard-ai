import React, { useCallback, useState, forwardRef, useImperativeHandle, useRef } from "react";
import { Link2, Square, Plus, ImagePlus, X } from "lucide-react";
import { ModelSelector } from "../../../components/ModelSelector";
import type { ReasoningLevel } from "../../../hooks/usePreferences";
import type { ContextUsageMetrics } from "../../../utils/contextUsage";
import { ContextUsageIndicator } from "../../../components/ContextUsageIndicator";

function extractAnyUrl(text: string): string | null {
  if (!text) return null;
  const match = text.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+/);
  return match ? match[0] : null;
}

type AttachedImage = {
  path: string;
  name: string;
  dataUrl?: string;
  data?: string;
  mimeType?: string;
};

function isImageFile(file: File): boolean {
  if (typeof file?.type === 'string' && file.type.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file?.name || '');
}

function buildImageDataUrl(data?: string, mimeType?: string): string | undefined {
  if (!data) return undefined;
  if (data.startsWith('data:')) return data;
  return `data:${mimeType || 'image/png'};base64,${data}`;
}

async function droppedFileToAttachedImage(file: File): Promise<AttachedImage | null> {
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => reject(reader.error || new Error('failed_to_read_image'));
      reader.readAsDataURL(file);
    });

    const inferredPath = (file as any)?.path || file.name;
    return {
      path: String(inferredPath || file.name || 'image'),
      name: file.name || 'image',
      dataUrl,
      data: dataUrl,
      mimeType: file.type || 'image/png',
    };
  } catch {
    return null;
  }
}

function mergeImages(existing: AttachedImage[], incoming: AttachedImage[]): AttachedImage[] {
  const merged = [...existing];
  for (const img of incoming) {
    const key = `${img.path}::${img.name}`;
    if (!merged.some(m => `${m.path}::${m.name}` === key)) {
      merged.push(img);
    }
  }
  return merged;
}

export interface ChatInputRef {
  focus: () => void;
}

export const ChatInput = forwardRef<ChatInputRef, {
  onSend: (text: string, attachedImages?: AttachedImage[]) => void;
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
  const [dragKind, setDragKind] = useState<'url' | 'images' | null>(null);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
  }), []);

  const send = useCallback(() => {
    const t = text.trim();
    if ((!t && attachedImages.length === 0) || busy) return;
    onSend(t, attachedImages);
    setText("");
    setAttachedImages([]);
  }, [text, attachedImages, busy, onSend]);

  const addImages = useCallback((images: AttachedImage[]) => {
    if (!images.length) return;
    setAttachedImages(prev => mergeImages(prev, images));
  }, []);

  const removeImage = useCallback((idx: number) => {
    setAttachedImages(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const handlePickImages = useCallback(async () => {
    if (busy) return;
    try {
      const api = (window as any).desktopAPI;
      if (api?.selectImages) {
        const images = await api.selectImages();
        if (Array.isArray(images) && images.length > 0) {
          addImages(images.map((img: any) => ({
            path: String(img?.path || img?.name || 'image'),
            name: String(img?.name || 'image'),
            data: typeof img?.data === 'string' ? img.data : undefined,
            dataUrl: buildImageDataUrl(typeof img?.data === 'string' ? img.data : undefined, typeof img?.mimeType === 'string' ? img.mimeType : undefined),
            mimeType: typeof img?.mimeType === 'string' ? img.mimeType : undefined,
          })));
          return;
        }
      }
    } catch { }
    fileInputRef.current?.click();
  }, [busy, addImages]);

  const handleFileInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(isImageFile);
    if (files.length > 0) {
      const images = (await Promise.all(files.map(droppedFileToAttachedImage))).filter((img): img is AttachedImage => !!img);
      addImages(images);
    }
    e.target.value = '';
  }, [addImages]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const hasImageFiles = Array.from(e.dataTransfer.items || []).some(item => item.kind === 'file' && item.type.startsWith('image/'));
    const textData = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text/uri-list');
    const hasUrl = !!extractAnyUrl(textData);
    setDragKind(hasImageFiles ? 'images' : hasUrl ? 'url' : null);
    setIsDragOver(hasImageFiles || hasUrl);
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
      setDragKind(null);
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    setDragKind(null);

    const droppedFiles = Array.from(e.dataTransfer.files || []).filter(isImageFile);
    if (droppedFiles.length > 0) {
      const images = (await Promise.all(droppedFiles.map(droppedFileToAttachedImage))).filter((img): img is AttachedImage => !!img);
      addImages(images);
      return;
    }

    const uriList = e.dataTransfer.getData('text/uri-list');
    const plainText = e.dataTransfer.getData('text/plain');
    const htmlText = e.dataTransfer.getData('text/html');

    let droppedUrl: string | null = null;

    if (uriList) {
      droppedUrl = extractAnyUrl(uriList);
    }

    if (!droppedUrl && plainText) {
      droppedUrl = extractAnyUrl(plainText);
    }

    if (!droppedUrl && htmlText) {
      const hrefMatch = htmlText.match(/href=["']([^"']+)["']/);
      if (hrefMatch) {
        droppedUrl = hrefMatch[1];
      }
    }

    if (droppedUrl) {
      const newText = text.trim()
        ? `${text.trim()} ${droppedUrl}`
        : droppedUrl;
      setText(newText);
    }
  }, [text, addImages]);

  return (
    <div
      className={`w-full wf-bg-sunken backdrop-blur-md border rounded-2xl shadow-xl ring-1 transition-all duration-200 ${isDragOver && dragKind
          ? 'border-indigo-500/50 ring-indigo-500/30 bg-indigo-500/10'
          : 'wf-border-subtle ring-[color:var(--wf-border-subtle)]'
        }`}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && dragKind && (
        <div className="flex items-center justify-center gap-2 px-3 py-2 text-[12px] font-medium bg-indigo-500/20 text-indigo-400">
          {dragKind === 'images' ? <ImagePlus className="w-4 h-4" /> : <Link2 className="w-4 h-4" />}
          {dragKind === 'images' ? 'Drop image here' : 'Drop link here'}
        </div>
      )}

      <div className="flex flex-col p-2.5">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleFileInputChange}
        />
        {attachedImages.length > 0 && (
          <div className="flex flex-wrap gap-2 px-1 pb-2">
            {attachedImages.map((img, idx) => {
              const src = img.dataUrl || buildImageDataUrl(img.data, img.mimeType) || img.path;
              return (
                <div key={`${img.path}-${idx}`} className="relative rounded-xl overflow-hidden border wf-border-subtle wf-bg-overlay">
                  <img src={src} alt={img.name} className="w-16 h-16 object-cover" />
                  <button
                    type="button"
                    onClick={() => removeImage(idx)}
                    className="absolute top-1 right-1 p-1 rounded-full wf-bg-elevated wf-fg wf-hover-fg transition-colors"
                    title={`Remove ${img.name}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                  <div className="px-2 py-1 text-[10px] wf-fg-muted max-w-16 truncate">{img.name}</div>
                </div>
              );
            })}
          </div>
        )}
        <textarea
          ref={textareaRef}
          className="w-full resize-none outline-none text-[13px] wf-fg placeholder:wf-fg-faint bg-transparent min-h-[44px] max-h-[140px] py-1 px-1 scrollbar-minimal"
          placeholder={busy ? "Working..." : "Tell Stuard what to do, or drop images here"}
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
              onClick={handlePickImages}
              disabled={busy}
              className="p-1.5 rounded-lg wf-fg-faint wf-hover-fg wf-hover-bg transition-colors"
              title="Attach images"
            >
              {attachedImages.length > 0 ? <ImagePlus className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
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
            ) : ((text.trim().length > 0 || attachedImages.length > 0) && (
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
