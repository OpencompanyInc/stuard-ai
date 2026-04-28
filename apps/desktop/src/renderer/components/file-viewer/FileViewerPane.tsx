import React from 'react';
import { clsx } from 'clsx';
import { PanelRightClose, FileText, ExternalLink, Folder, Paperclip, Loader2, AlertCircle, Download, Globe } from 'lucide-react';
import { useFileViewer, type FileTab } from './FileViewerContext';
import { FileViewerTabs } from './FileViewerTabs';
import { classifyByExt, mimeForExt, base64ToBlob, type RendererKind } from './renderers';

interface FileViewerPaneProps {
  translucentMode?: boolean;
  className?: string;
  /** When true, the pane renders without its own rounded corners / border —
   *  use this when the host already provides chrome (e.g., a workspace dock). */
  bare?: boolean;
}

export const FileViewerPane: React.FC<FileViewerPaneProps> = ({
  translucentMode = false,
  className,
  bare = false,
}) => {
  const { tabs, activeTabId, switchTab, closeTab, setOpen, previewUrlBuilder } = useFileViewer();
  const activeTab = tabs.find((t) => t.id === activeTabId) || null;

  return (
    <div
      className={clsx(
        'flex flex-col h-full min-h-0 overflow-hidden',
        !bare && 'rounded-[24px] border border-theme/10',
        translucentMode
          ? 'bg-theme-bg/30 backdrop-blur-xl'
          : 'bg-theme-card',
        className,
      )}
    >
      {/* Tab strip + open-preview + close pane */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-theme/10 backdrop-blur-sm w-full min-w-0 gap-2">
        <div className="flex-1 min-w-0">
          <FileViewerTabs
            tabs={tabs}
            activeTabId={activeTabId}
            onSwitchTab={switchTab}
            onCloseTab={closeTab}
          />
        </div>
        {previewUrlBuilder && <PreviewPortLauncher />}
        <button
          onClick={() => setOpen(false)}
          className="shrink-0 p-1.5 rounded-md hover:bg-theme-hover text-theme-muted hover:text-theme-fg transition-colors"
          title="Close pane"
        >
          <PanelRightClose className="w-4 h-4" />
        </button>
      </div>

      {/* Content area */}
      <div className="flex-1 min-h-0 overflow-hidden relative">
        {activeTab ? (
          <FileViewerContent key={activeTab.id} tab={activeTab} />
        ) : (
          <FileViewerEmpty />
        )}
      </div>
    </div>
  );
};

const PreviewPortLauncher: React.FC = () => {
  const { openPreview } = useFileViewer();
  const [open, setOpen] = React.useState(false);
  const [port, setPort] = React.useState('3000');
  const [busy, setBusy] = React.useState(false);

  const submit = async () => {
    const n = Number(port);
    if (!Number.isFinite(n) || n < 1 || n > 65535) return;
    setBusy(true);
    try { await openPreview(n); }
    finally { setBusy(false); setOpen(false); }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="shrink-0 p-1.5 rounded-md hover:bg-theme-hover text-theme-muted hover:text-theme-fg transition-colors"
        title="Preview localhost port from the VM"
      >
        <Globe className="w-4 h-4" />
      </button>
    );
  }
  return (
    <div className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-theme-bg/40 border border-theme/15">
      <Globe className="w-3.5 h-3.5 text-theme-muted" />
      <span className="text-[11px] text-theme-muted font-mono">localhost:</span>
      <input
        autoFocus
        type="text"
        inputMode="numeric"
        value={port}
        onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, ''))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit();
          if (e.key === 'Escape') setOpen(false);
        }}
        className="w-12 bg-transparent border-none outline-none text-[12px] font-mono text-theme-fg"
      />
      <button
        disabled={busy}
        onClick={submit}
        className="text-[10px] font-semibold uppercase tracking-wider text-primary hover:text-primary/80 disabled:opacity-50"
      >
        {busy ? '…' : 'Open'}
      </button>
    </div>
  );
};

const FileViewerEmpty: React.FC = () => {
  const { previewUrlBuilder } = useFileViewer();
  return (
    <div className="h-full w-full flex flex-col items-center justify-center text-theme-muted gap-2 p-6">
      <FileText className="w-8 h-8 opacity-40" />
      <div className="text-[12px] font-semibold">No file open</div>
      <div className="text-[11px] opacity-70 text-center max-w-[220px]">
        Click a file in the explorer to open it here{previewUrlBuilder ? ', or use the globe icon to preview a localhost port from the VM.' : '.'}
      </div>
    </div>
  );
};

interface FetchedContent {
  text?: string;
  blobUrl?: string;
  blob?: Blob;
  size: number;
}

const MAX_TEXT_RENDER_BYTES = 2 * 1024 * 1024; // 2 MB

const FileViewerContent: React.FC<{ tab: FileTab }> = ({ tab }) => {
  // Localhost preview tabs render directly from the URL minted upstream — no
  // fetch, no MIME logic. Different component so hooks don't conditionally run.
  if (tab.source === 'preview') {
    return <PreviewTabContent tab={tab} />;
  }
  return <FetchedFileContent tab={tab} />;
};

const FetchedFileContent: React.FC<{ tab: FileTab }> = ({ tab }) => {
  const { fetcher, serveUrlBuilder } = useFileViewer();
  const kind: RendererKind = classifyByExt(tab.ext);
  const mime = mimeForExt(tab.ext);

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [data, setData] = React.useState<FetchedContent | null>(null);
  const [serveUrl, setServeUrl] = React.useState<string | null>(null);

  // Cleanup blob URL on unmount / tab change.
  React.useEffect(() => {
    let cancelled = false;
    let createdBlobUrl: string | null = null;

    async function load() {
      setLoading(true);
      setError(null);
      setData(null);
      setServeUrl(null);

      // Local-source files don't go through the fetcher — assume the host can
      // serve them directly via local-file:// (Electron). Not the focus here.
      if (tab.source !== 'vm' && tab.source !== 'local') {
        setLoading(false);
        setError('Unsupported file source');
        return;
      }

      if (tab.source === 'local') {
        // For now the desktop chat doesn't mount this provider, so this branch
        // is mostly a placeholder. Local files would resolve to local-file://.
        setLoading(false);
        return;
      }

      // HTML preview goes through the serve endpoint instead of the fetcher
      // so that <link>/<script>/<img> with relative paths resolve naturally.
      if (kind === 'html') {
        if (!serveUrlBuilder) {
          setLoading(false);
          setError('No preview URL builder configured');
          return;
        }
        try {
          const url = await serveUrlBuilder(tab.path);
          if (cancelled) return;
          if (!url) { setError('Could not build preview URL'); setLoading(false); return; }
          setServeUrl(url);
          setLoading(false);
        } catch (e: any) {
          if (cancelled) return;
          setError(e?.message || 'Failed to build preview URL');
          setLoading(false);
        }
        return;
      }

      if (!fetcher) {
        setLoading(false);
        setError('No file fetcher configured');
        return;
      }

      try {
        const res = await fetcher(tab.path);
        if (cancelled) return;
        if (!res) {
          setError('Could not read file');
          setLoading(false);
          return;
        }
        if (res.encoding === 'base64') {
          const blob = base64ToBlob(res.content, mime);
          createdBlobUrl = URL.createObjectURL(blob);
          setData({ blob, blobUrl: createdBlobUrl, size: res.size });
        } else {
          // utf-8 text
          if (res.size > MAX_TEXT_RENDER_BYTES && kind === 'text') {
            setError(`File too large to preview (${(res.size / 1024 / 1024).toFixed(1)} MB)`);
            setLoading(false);
            return;
          }
          setData({ text: res.content, size: res.size });
        }
        setLoading(false);
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message || 'Failed to load file');
        setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
      if (createdBlobUrl) URL.revokeObjectURL(createdBlobUrl);
    };
  }, [tab.id, tab.path, tab.source, fetcher, serveUrlBuilder, mime, kind]);

  return (
    <div className="h-full w-full flex flex-col min-h-0">
      <FileToolbar tab={tab} blobUrl={data?.blobUrl} serveUrl={serveUrl} />
      <div className="flex-1 min-h-0 overflow-hidden relative">
        {loading && <CenteredSpinner />}
        {!loading && error && <CenteredError message={error} />}
        {!loading && !error && (data || serveUrl) && (
          <RendererSwitch tab={tab} kind={kind} data={data} mime={mime} serveUrl={serveUrl} />
        )}
      </div>
    </div>
  );
};

const FileToolbar: React.FC<{ tab: FileTab; blobUrl?: string; serveUrl?: string | null }> = ({ tab, blobUrl, serveUrl }) => {
  const [attached, setAttached] = React.useState(false);
  const desktopAPI = (typeof window !== 'undefined' ? (window as any).desktopAPI : null) as any;

  const openInOS = () => {
    try { desktopAPI?.openPath?.(tab.path); } catch {}
  };
  const reveal = () => {
    try { desktopAPI?.showItemInFolder?.(tab.path); } catch {}
  };
  const attachToChat = () => {
    const fn = (window as any).__cloudVmChatAttach;
    if (typeof fn !== 'function') return;
    try {
      fn({ path: tab.path, name: tab.name, size: tab.meta?.size });
      setAttached(true);
      setTimeout(() => setAttached(false), 1500);
    } catch {}
  };
  const download = () => {
    if (!blobUrl) return;
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = tab.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-theme/10 shrink-0">
      <span className="rounded-full border border-theme/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-theme-muted shrink-0">
        {tab.ext || 'file'}
      </span>
      <span className="text-[11px] text-theme-muted truncate flex-1 font-mono" title={tab.path}>
        {tab.path}
      </span>
      <div className="flex items-center gap-0.5 shrink-0">
        {tab.source === 'vm' && (
          <button
            onClick={attachToChat}
            className={clsx(
              'p-1 rounded-md transition-colors',
              attached
                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'
                : 'text-theme-muted hover:bg-theme-hover hover:text-theme-fg',
            )}
            title={attached ? 'Attached!' : 'Attach to chat'}
          >
            <Paperclip className="w-3.5 h-3.5" />
          </button>
        )}
        {blobUrl && (
          <button
            onClick={download}
            className="p-1 rounded-md text-theme-muted hover:bg-theme-hover hover:text-theme-fg transition-colors"
            title="Download"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        )}
        {serveUrl && (
          <button
            onClick={() => {
              try { desktopAPI?.openExternal?.(serveUrl) ?? window.open(serveUrl, '_blank', 'noopener'); } catch {}
            }}
            className="p-1 rounded-md text-theme-muted hover:bg-theme-hover hover:text-theme-fg transition-colors"
            title="Open preview in browser"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        )}
        {tab.source === 'local' && (
          <>
            <button
              onClick={openInOS}
              className="p-1 rounded-md text-theme-muted hover:bg-theme-hover hover:text-theme-fg transition-colors"
              title="Open in OS"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={reveal}
              className="p-1 rounded-md text-theme-muted hover:bg-theme-hover hover:text-theme-fg transition-colors"
              title="Show in folder"
            >
              <Folder className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
};

const CenteredSpinner: React.FC = () => (
  <div className="absolute inset-0 flex items-center justify-center text-theme-muted">
    <Loader2 className="w-5 h-5 animate-spin" />
  </div>
);

const CenteredError: React.FC<{ message: string }> = ({ message }) => (
  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-theme-muted p-6">
    <AlertCircle className="w-6 h-6 text-red-500/70" />
    <div className="text-[12px] font-semibold text-theme-fg">Couldn't preview</div>
    <div className="text-[11px] text-center max-w-[260px]">{message}</div>
  </div>
);

const RendererSwitch: React.FC<{
  tab: FileTab;
  kind: RendererKind;
  data: FetchedContent | null;
  mime: string;
  serveUrl: string | null;
}> = ({ tab, kind, data, mime, serveUrl }) => {
  switch (kind) {
    case 'image':
      return <ImageRenderer src={data!.blobUrl!} alt={tab.name} />;
    case 'video':
      return <VideoRenderer src={data!.blobUrl!} type={mime} />;
    case 'audio':
      return <AudioRenderer src={data!.blobUrl!} type={mime} name={tab.name} />;
    case 'pdf':
      return <PdfRenderer src={data!.blobUrl!} />;
    case 'html':
      return <HtmlRenderer src={serveUrl!} />;
    case 'text':
      return <TextRenderer text={data!.text ?? ''} ext={tab.ext} />;
    case 'binary':
    default:
      return <BinaryRenderer tab={tab} size={data!.size} blobUrl={data!.blobUrl} />;
  }
};

const ImageRenderer: React.FC<{ src: string; alt: string }> = ({ src, alt }) => (
  <div className="h-full w-full overflow-auto custom-scrollbar bg-[#0c0c0c]/40 flex items-center justify-center p-3">
    <img
      src={src}
      alt={alt}
      className="max-w-full max-h-full object-contain rounded-md shadow-md"
      draggable={false}
    />
  </div>
);

const VideoRenderer: React.FC<{ src: string; type: string }> = ({ src, type }) => (
  <div className="h-full w-full bg-black flex items-center justify-center">
    <video src={src} controls className="max-w-full max-h-full" preload="metadata">
      <source src={src} type={type} />
    </video>
  </div>
);

const AudioRenderer: React.FC<{ src: string; type: string; name: string }> = ({ src, type, name }) => (
  <div className="h-full w-full flex flex-col items-center justify-center gap-3 p-6">
    <div className="text-[13px] font-semibold text-theme-fg truncate max-w-full">{name}</div>
    <audio src={src} controls className="w-full max-w-md">
      <source src={src} type={type} />
    </audio>
  </div>
);

const PdfRenderer: React.FC<{ src: string }> = ({ src }) => (
  <iframe
    src={src}
    title="PDF"
    className="w-full h-full border-0 bg-white"
  />
);

// Real-browser HTML preview: iframe pointed at the cloud-ai serve endpoint
// so relative <link>/<script>/<img> resolve naturally against the file's
// directory. allow-same-origin lets the page fetch its sibling assets via
// the same sid; we keep the rest of the sandbox restricted.
const HtmlRenderer: React.FC<{ src: string }> = ({ src }) => (
  <iframe
    src={src}
    title="HTML preview"
    className="w-full h-full border-0 bg-white"
    sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
  />
);

// Localhost dev-server preview: iframe pointed at the cloud-ai preview proxy.
// The session minted at open time is good for ~5 min; if the user keeps the
// tab open longer they can hit refresh to mint a new one. We auto-refresh on
// reload-tab, otherwise the page stays untouched so HMR keeps working.
const PreviewTabContent: React.FC<{ tab: FileTab }> = ({ tab }) => {
  const { previewUrlBuilder } = useFileViewer();
  const initialUrl = (tab.meta?.url as string) || '';
  const port = Number(tab.meta?.port) || 0;
  const [url, setUrl] = React.useState<string>(initialUrl);
  const [iframeKey, setIframeKey] = React.useState(0);
  const [reminting, setReminting] = React.useState(false);
  const desktopAPI = (typeof window !== 'undefined' ? (window as any).desktopAPI : null) as any;

  const reload = () => setIframeKey((k) => k + 1);
  const newSession = async () => {
    if (!previewUrlBuilder || !port) return;
    setReminting(true);
    try {
      const next = await previewUrlBuilder(port);
      if (next?.url) {
        setUrl(next.url);
        setIframeKey((k) => k + 1);
      }
    } finally { setReminting(false); }
  };

  return (
    <div className="h-full w-full flex flex-col min-h-0">
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-theme/10 shrink-0">
        <span className="rounded-full border border-blue-500/30 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-300 shrink-0">
          preview
        </span>
        <span className="text-[11px] text-theme-muted truncate flex-1 font-mono" title={url}>
          localhost:{port}
        </span>
        <button
          onClick={reload}
          className="p-1 rounded-md text-theme-muted hover:bg-theme-hover hover:text-theme-fg transition-colors"
          title="Reload preview"
        >
          <Loader2 className={clsx('w-3.5 h-3.5', reminting && 'animate-spin')} />
        </button>
        <button
          onClick={newSession}
          className="p-1 rounded-md text-theme-muted hover:bg-theme-hover hover:text-theme-fg transition-colors"
          title="New session (re-mint)"
        >
          <Globe className="w-3.5 h-3.5" />
        </button>
        {url && (
          <button
            onClick={() => {
              try { desktopAPI?.openExternal?.(url) ?? window.open(url, '_blank', 'noopener'); } catch {}
            }}
            className="p-1 rounded-md text-theme-muted hover:bg-theme-hover hover:text-theme-fg transition-colors"
            title="Open preview in browser"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0 bg-white">
        {url ? (
          <iframe
            key={iframeKey}
            src={url}
            title={`localhost:${port}`}
            className="w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
          />
        ) : (
          <CenteredError message="No preview URL" />
        )}
      </div>
    </div>
  );
};

const TextRenderer: React.FC<{ text: string; ext: string }> = ({ text, ext }) => {
  // Lightweight text view — Monaco/syntax highlighting can plug in later.
  // Markdown gets a slightly more readable line height; everything else is
  // monospace.
  const isMd = ext === 'md' || ext === 'markdown';
  return (
    <pre
      className={clsx(
        'h-full w-full overflow-auto custom-scrollbar p-4 m-0 text-[12px] whitespace-pre-wrap break-words',
        isMd ? 'font-sans leading-relaxed' : 'font-mono',
        'text-theme-fg bg-theme-bg/30',
      )}
    >
      {text}
    </pre>
  );
};

const BinaryRenderer: React.FC<{ tab: FileTab; size: number; blobUrl?: string }> = ({
  tab,
  size,
  blobUrl,
}) => (
  <div className="h-full w-full flex flex-col items-center justify-center gap-2 p-6 text-theme-muted">
    <FileText className="w-8 h-8 opacity-40" />
    <div className="text-[13px] font-semibold text-theme-fg">{tab.name}</div>
    <div className="text-[11px]">{(size / 1024).toFixed(1)} KB · binary file</div>
    {blobUrl && (
      <a
        href={blobUrl}
        download={tab.name}
        className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-theme/10 hover:bg-theme-hover text-[11px] font-semibold text-theme-fg"
      >
        <Download className="w-3 h-3" />
        Download
      </a>
    )}
  </div>
);
