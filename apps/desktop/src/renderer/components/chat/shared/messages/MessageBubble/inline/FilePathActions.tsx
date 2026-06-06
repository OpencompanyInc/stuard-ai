import React, { useState } from 'react';
import { ExternalLink, Folder, Copy, Check } from 'lucide-react';
import { useFileViewerOptional } from '../../../../../file-viewer';
import { IMAGE_EXTS, AUDIO_EXTS, getFileExt } from '../helpers/filePaths';

export const FilePathActions: React.FC<{ filePath: string }> = ({ filePath }) => {
  const [copied, setCopied] = useState(false);
  const ext = getFileExt(filePath);
  const isImage = IMAGE_EXTS.has(ext);
  const isAudio = AUDIO_EXTS.has(ext);
  const fileName = filePath.split(/[/\\]/).pop() || filePath;
  const kindLabel = isImage ? 'image' : isAudio ? 'audio' : ext ? ext.toUpperCase() : 'file';

  // When mounted inside a FileViewerProvider (VM/cloud chat), the open action
  // routes to the viewer pane. Outside the provider (regular desktop chat),
  // it falls back to opening the file in the OS app.
  const fileViewer = useFileViewerOptional();

  const copyPath = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(filePath);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const openFile = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (fileViewer) {
      fileViewer.openFile({ path: filePath, source: 'vm', name: fileName });
      return;
    }
    // The preload exposes the OS open as `mediaOpenPath` (media:openPath →
    // shell.openPath); there is no `openPath`. Fall back to openExternal.
    const api = (window as any).desktopAPI;
    try {
      if (api?.mediaOpenPath) { api.mediaOpenPath(filePath); return; }
      api?.openExternal?.(filePath);
    } catch {}
  };

  const revealInFolder = (e: React.MouseEvent) => {
    e.stopPropagation();
    try { (window as any).desktopAPI?.showItemInFolder?.(filePath); } catch {}
  };

  // `border-theme/10` is a dead class (no rule) so the bare `border` would render
  // Tailwind's default light-gray = a white outline in dark mode. Use a real
  // foreground-derived border colour instead.
  const subtleBorder = 'color-mix(in srgb, var(--foreground) 12%, transparent)';

  return (
    <div
      className="my-0.5 flex items-center gap-2 rounded-lg border bg-transparent px-2.5 py-1.5"
      style={{ borderColor: subtleBorder }}
    >
      <span
        className="shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-medium text-theme-muted"
        style={{ borderColor: subtleBorder }}
      >
        {kindLabel}
      </span>
      <span className="max-w-[200px] truncate text-[10px] font-medium text-theme-fg" title={filePath}>
        {fileName}
      </span>
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <button
          onClick={openFile}
          className="rounded p-0.5 text-theme-muted transition-colors hover:bg-[color:color-mix(in_srgb,var(--foreground)_10%,transparent)] hover:text-theme-fg"
          title="Open file"
        >
          <ExternalLink className="h-3 w-3" />
        </button>
        <button
          onClick={revealInFolder}
          className="rounded p-0.5 text-theme-muted transition-colors hover:bg-[color:color-mix(in_srgb,var(--foreground)_10%,transparent)] hover:text-theme-fg"
          title="Show in folder"
        >
          <Folder className="h-3 w-3" />
        </button>
        <button
          onClick={copyPath}
          className="rounded p-0.5 text-theme-muted transition-colors hover:bg-[color:color-mix(in_srgb,var(--foreground)_10%,transparent)] hover:text-theme-fg"
          title="Copy path"
        >
          {copied
            ? <Check className="h-3 w-3 text-green-600" />
            : <Copy className="h-3 w-3" />
          }
        </button>
      </div>
    </div>
  );
};
