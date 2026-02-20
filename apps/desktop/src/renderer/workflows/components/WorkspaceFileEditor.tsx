/**
 * WorkspaceFileEditor - Code editor for workspace files (.py, .txt, .js, etc.)
 * Also handles media files with custom previews: audio, video, images.
 * Uses RichCodeEditor for text, native HTML5 players for media.
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import { Save, RotateCw, FileText, Code2, Braces, Music, Video, Image as ImageIcon, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { RichCodeEditor } from "./RichCodeEditor";

interface WorkspaceFileEditorProps {
  flowId: string;
  filePath: string;
  fileName: string;
}

// Media file type detection
const AUDIO_EXTS = ['wav', 'mp3', 'ogg', 'flac', 'm4a', 'aac', 'wma', 'opus'];
const VIDEO_EXTS = ['mp4', 'webm', 'mov', 'avi', 'mkv', 'wmv', 'm4v', 'ogv'];
const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'tiff', 'avif'];

type FileType = 'text' | 'audio' | 'video' | 'image';

function detectFileType(name: string): FileType {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (AUDIO_EXTS.includes(ext)) return 'audio';
  if (VIDEO_EXTS.includes(ext)) return 'video';
  if (IMAGE_EXTS.includes(ext)) return 'image';
  return 'text';
}

function detectLanguage(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'py': return 'python';
    case 'js': case 'mjs': case 'cjs': return 'javascript';
    case 'ts': case 'tsx': return 'typescript';
    case 'json': case 'stuard': return 'json';
    case 'html': case 'htm': return 'html';
    case 'css': return 'css';
    case 'md': return 'markdown';
    case 'sh': case 'bash': return 'shell';
    case 'ps1': return 'powershell';
    case 'yaml': case 'yml': return 'yaml';
    case 'xml': return 'xml';
    case 'csv': return 'csv';
    case 'sql': return 'sql';
    default: return 'text';
  }
}

function langIcon(lang: string) {
  switch (lang) {
    case 'python': return <Code2 className="w-3.5 h-3.5 text-yellow-500" />;
    case 'javascript': case 'typescript': return <Code2 className="w-3.5 h-3.5 text-blue-400" />;
    case 'json': return <Braces className="w-3.5 h-3.5 text-emerald-500" />;
    default: return <FileText className="w-3.5 h-3.5 text-slate-400" />;
  }
}

function fileTypeIcon(fileType: FileType) {
  switch (fileType) {
    case 'audio': return <Music className="w-3.5 h-3.5 text-purple-400" />;
    case 'video': return <Video className="w-3.5 h-3.5 text-pink-400" />;
    case 'image': return <ImageIcon className="w-3.5 h-3.5 text-cyan-400" />;
    default: return null;
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function WorkspaceFileEditor({ flowId, filePath, fileName }: WorkspaceFileEditorProps) {
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [fileInfo, setFileInfo] = useState<{ size?: number } | null>(null);
  const [imgDims, setImgDims] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const dirty = content !== originalContent;
  const language = detectLanguage(fileName);
  const fileType = detectFileType(fileName);
  const isMedia = fileType !== 'text';
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load file content (text) or binary data (media → blob URL)
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setBlobUrl(null);
    setFileInfo(null);

    (async () => {
      try {
        if (isMedia) {
          const res = await (window as any).desktopAPI?.workflowsReadWorkspaceFileBinary?.(flowId, filePath);
          if (cancelled) return;
          if (res?.ok && res.base64) {
            const binary = atob(res.base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            const blob = new Blob([bytes], { type: res.mime || 'application/octet-stream' });
            setBlobUrl(URL.createObjectURL(blob));
            if (res.size) setFileInfo({ size: res.size });
          } else {
            setError(res?.error || 'Failed to load media');
          }
        } else {
          const res = await (window as any).desktopAPI?.workflowsReadWorkspaceFile?.(flowId, filePath);
          if (cancelled) return;
          if (res?.ok) {
            setContent(res.content || '');
            setOriginalContent(res.content || '');
            setFileInfo({ size: res.size });
          } else {
            setError(res?.error || 'Failed to load file');
          }
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load');
      }
      if (!cancelled) setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [flowId, filePath, isMedia]);

  // Cleanup blob URL on unmount or change
  useEffect(() => {
    return () => { if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [blobUrl]);

  // Save file
  const save = useCallback(async () => {
    setSaving(true);
    try {
      const res = await (window as any).desktopAPI?.workflowsWriteWorkspaceFile?.(flowId, filePath, content);
      if (res?.ok) {
        setOriginalContent(content);
      } else {
        setError(res?.error || 'Save failed');
      }
    } catch (e: any) {
      setError(e?.message || 'Save failed');
    }
    setSaving(false);
  }, [flowId, filePath, content]);

  // Auto-save after 2s of inactivity
  useEffect(() => {
    if (!dirty) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { save(); }, 2000);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [content, dirty, save]);

  // Ctrl+S
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (dirty) save();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [dirty, save]);

  // Handle open in system default app
  const handleOpenExternal = useCallback(async () => {
    try {
      const infoRes = await (window as any).desktopAPI?.workflowsGetWorkspaceInfo?.(flowId);
      if (infoRes?.ok && infoRes.workspacePath) {
        const fullPath = `${infoRes.workspacePath}/${filePath}`;
        await (window as any).desktopAPI?.showItemInFolder?.(fullPath);
      }
    } catch {}
  }, [flowId, filePath]);

  // --- All hooks above this line --- early returns below ---

  if (loading) {
    return (
      <div className="flex-1 h-full flex items-center justify-center" style={{ background: '#1e1e1e' }}>
        <div className="w-6 h-6 border-2 border-[#555] border-t-[#ccc] rounded-full animate-spin" />
      </div>
    );
  }

  if (error && !content && !isMedia) {
    return (
      <div className="flex-1 h-full flex items-center justify-center" style={{ background: '#1e1e1e' }}>
        <div className="text-center px-6">
          <FileText className="w-10 h-10 mx-auto mb-3" style={{ color: '#555' }} />
          <p className="text-sm font-medium" style={{ color: '#f48771' }}>{error}</p>
          <button onClick={() => { setError(null); setLoading(true); }} className="mt-3 text-xs hover:underline" style={{ color: '#7aa2f7' }}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ─── Media file rendering ─────────────────────────────────────────────────
  if (isMedia) {
    return (
      <div className="flex-1 h-full flex flex-col min-h-0" style={{ background: '#1e1e1e' }}>
        {/* Header bar */}
        <div className="flex items-center justify-between shrink-0 px-3" style={{ height: 35, background: '#252526', borderBottom: '1px solid #3c3c3c' }}>
          <div className="flex items-center gap-2">
            {fileTypeIcon(fileType)}
            <span className="text-[12px] font-medium" style={{ color: '#cccccc' }}>{fileName}</span>
            {fileInfo?.size != null && <span className="text-[11px]" style={{ color: '#858585' }}>{formatFileSize(fileInfo.size)}</span>}
            {fileType === 'image' && imgDims.w > 0 && <span className="text-[11px]" style={{ color: '#585858' }}>{imgDims.w}&times;{imgDims.h}</span>}
          </div>
          <div className="flex items-center gap-0.5">
            {error && <span className="text-[10px] max-w-[120px] truncate mr-1" style={{ color: '#f48771' }}>{error}</span>}
            {fileType === 'image' && blobUrl && (
              <>
                <button onClick={() => setZoom(z => Math.max(0.1, z - 0.25))} className="p-1 rounded-sm hover:bg-[#ffffff15]" style={{ color: '#aaa' }} title="Zoom out"><ZoomOut className="w-3.5 h-3.5" /></button>
                <button onClick={() => setZoom(1)} className="px-1.5 py-0.5 text-[10px] rounded-sm hover:bg-[#ffffff15]" style={{ color: '#aaa' }}>{Math.round(zoom * 100)}%</button>
                <button onClick={() => setZoom(z => Math.min(5, z + 0.25))} className="p-1 rounded-sm hover:bg-[#ffffff15]" style={{ color: '#aaa' }} title="Zoom in"><ZoomIn className="w-3.5 h-3.5" /></button>
                <div className="w-px h-3.5 mx-1" style={{ background: '#3c3c3c' }} />
              </>
            )}
            <button onClick={handleOpenExternal} className="p-1 rounded-sm hover:bg-[#ffffff15]" style={{ color: '#aaa' }} title="Show in folder"><Maximize2 className="w-3.5 h-3.5" /></button>
          </div>
        </div>

        {/* Content area */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center" style={{ background: '#1e1e1e' }}>
            <div className="w-6 h-6 border-2 border-[#555] border-t-[#ccc] rounded-full animate-spin" />
          </div>
        ) : error && !blobUrl ? (
          <div className="flex-1 flex items-center justify-center" style={{ background: '#1e1e1e' }}>
            <div className="text-center">
              <FileText className="w-10 h-10 mx-auto mb-2" style={{ color: '#555' }} />
              <p className="text-xs" style={{ color: '#f48771' }}>{error}</p>
            </div>
          </div>
        ) : blobUrl ? (
          <div className="flex-1 flex items-center justify-center overflow-auto" style={{
            background: fileType === 'image'
              ? 'repeating-conic-gradient(#252526 0% 25%, #2d2d2d 0% 50%) 50% / 16px 16px'
              : '#1e1e1e',
          }}>
            {fileType === 'audio' && (
              <audio src={blobUrl} controls controlsList="nodownload" className="w-full max-w-lg" />
            )}
            {fileType === 'video' && (
              <video src={blobUrl} controls controlsList="nodownload" className="max-w-full max-h-full rounded" style={{ maxHeight: 'calc(100vh - 180px)' }} />
            )}
            {fileType === 'image' && (
              <img
                src={blobUrl}
                alt={fileName}
                draggable={false}
                onLoad={(e) => {
                  const img = e.currentTarget;
                  setImgDims({ w: img.naturalWidth, h: img.naturalHeight });
                }}
                className="transition-transform duration-150"
                style={{
                  transform: `scale(${zoom})`,
                  maxWidth: zoom <= 1 ? '100%' : 'none',
                  maxHeight: zoom <= 1 ? '100%' : 'none',
                }}
              />
            )}
          </div>
        ) : null}
      </div>
    );
  }

  // Text file rendering (existing code)
  return (
    <div className="flex-1 h-full flex flex-col min-h-0" style={{ background: '#1e1e1e' }}>
      {/* VS Code-style tab/status bar */}
      <div className="flex items-center justify-between shrink-0 px-2" style={{ height: 35, background: '#252526', borderBottom: '1px solid #3c3c3c' }}>
        <div className="flex items-center gap-2">
          {langIcon(language)}
          <span className="text-[12px] font-medium" style={{ color: '#cccccc' }}>{fileName}</span>
          {dirty && <span className="w-2 h-2 rounded-full bg-white/60 shrink-0" title="Modified" />}
          <span className="text-[11px]" style={{ color: '#858585' }}>{language}</span>
          {fileInfo?.size && <span className="text-[11px] ml-2" style={{ color: '#585858' }}>{formatFileSize(fileInfo.size)}</span>}
        </div>
        <div className="flex items-center gap-1">
          {saving && <span className="text-[10px]" style={{ color: '#858585' }}>Saving...</span>}
          {error && <span className="text-[10px] max-w-[150px] truncate" style={{ color: '#f48771' }}>{error}</span>}
          <button
            onClick={save}
            disabled={!dirty || saving}
            className="p-1 rounded-sm transition-colors hover:bg-[#ffffff15] disabled:opacity-30"
            style={{ color: dirty ? '#cccccc' : '#585858' }}
            title="Save (Ctrl+S)"
          >
            <Save className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => { setContent(originalContent); }}
            disabled={!dirty}
            className="p-1 rounded-sm transition-colors hover:bg-[#ffffff15] disabled:opacity-30"
            style={{ color: dirty ? '#cccccc' : '#585858' }}
            title="Revert changes"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {/* Editor */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <RichCodeEditor
          value={content}
          onChange={setContent}
          language={language}
          minHeight={0}
          className="flex-1"
        />
      </div>
    </div>
  );
}
