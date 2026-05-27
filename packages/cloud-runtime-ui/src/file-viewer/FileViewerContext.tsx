import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

export type FileTabSource = 'local' | 'vm' | 'url' | 'preview';

export interface FileTab {
  id: string;
  path: string;
  name: string;
  source: FileTabSource;
  ext: string;
  // Optional content metadata, populated lazily by renderers
  meta?: Record<string, any>;
}

export interface FileFetchResult {
  content: string;
  encoding: 'utf-8' | 'base64';
  size: number;
}

export type FileFetcher = (path: string) => Promise<FileFetchResult | null>;

/** Builds an absolute URL the iframe can load — the host wires this to a
 *  short-lived session-based serve endpoint so HTML files resolve their
 *  relative CSS / JS / images naturally. */
export type ServeUrlBuilder = (path: string) => Promise<string | null>;

/** Mints a localhost-preview session for a port in the VM and returns the
 *  iframe URL plus session metadata. */
export type PreviewUrlBuilder = (
  port: number,
) => Promise<{ url: string; sid: string; port: number; expiresAt: number } | null>;

export interface FileViewerContextValue {
  tabs: FileTab[];
  activeTabId: string | null;
  isOpen: boolean;
  openFile: (input: {
    path: string;
    source?: FileTabSource;
    name?: string;
    meta?: Record<string, any>;
  }) => string;
  closeTab: (id: string) => void;
  closeAll: () => void;
  switchTab: (id: string) => void;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  /** Fetcher injected by the host (e.g., CloudRuntimeWorkspace passes the VM
   *  read-file API). Renderers call this to load content for the active tab. */
  fetcher: FileFetcher | null;
  /** Optional URL builder used by the HTML / preview renderer (iframe src). */
  serveUrlBuilder: ServeUrlBuilder | null;
  /** Optional builder used by the localhost-port preview tabs. */
  previewUrlBuilder: PreviewUrlBuilder | null;
  /** Convenience: opens a tab for a localhost dev-server port in the VM. */
  openPreview: (port: number) => Promise<string | null>;
}

const FileViewerContext = createContext<FileViewerContextValue | null>(null);

export const useFileViewer = (): FileViewerContextValue => {
  const ctx = useContext(FileViewerContext);
  if (!ctx) {
    throw new Error('useFileViewer must be used within a FileViewerProvider');
  }
  return ctx;
};

// Optional variant — returns null instead of throwing, for code that runs
// outside the provider (e.g., shared components mounted in non-desktop hosts).
export const useFileViewerOptional = (): FileViewerContextValue | null => {
  return useContext(FileViewerContext);
};

function getFileExt(path: string): string {
  const m = path.match(/\.([a-z0-9]+)(?:[?#].*)?$/i);
  return m ? m[1].toLowerCase() : '';
}

function getFileName(path: string): string {
  const cleaned = path.split(/[?#]/)[0];
  return cleaned.split(/[/\\]/).pop() || cleaned;
}

function makeId(path: string, source: FileTabSource): string {
  return `${source}::${path}`;
}

interface FileViewerProviderProps {
  children: React.ReactNode;
  defaultOpen?: boolean;
  fetcher?: FileFetcher | null;
  serveUrlBuilder?: ServeUrlBuilder | null;
  previewUrlBuilder?: PreviewUrlBuilder | null;
}

export const FileViewerProvider: React.FC<FileViewerProviderProps> = ({
  children,
  defaultOpen = false,
  fetcher = null,
  serveUrlBuilder = null,
  previewUrlBuilder = null,
}) => {
  const [tabs, setTabs] = useState<FileTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState<boolean>(defaultOpen);

  const openFile = useCallback<FileViewerContextValue['openFile']>(
    ({ path, source = 'local', name, meta }) => {
      const id = makeId(path, source);
      setTabs((prev) => {
        const existing = prev.find((t) => t.id === id);
        if (existing) return prev;
        const tab: FileTab = {
          id,
          path,
          name: name || getFileName(path),
          source,
          ext: getFileExt(path),
          meta,
        };
        return [...prev, tab];
      });
      setActiveTabId(id);
      setIsOpen(true);
      return id;
    },
    [],
  );

  const closeTab = useCallback((id: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx === -1) return prev;
      const next = prev.filter((t) => t.id !== id);
      setActiveTabId((curActive) => {
        if (curActive !== id) return curActive;
        if (next.length === 0) return null;
        // Pick neighbor: prefer previous, else next
        const neighbor = next[Math.max(0, idx - 1)] || next[0];
        return neighbor.id;
      });
      return next;
    });
  }, []);

  const closeAll = useCallback(() => {
    setTabs([]);
    setActiveTabId(null);
  }, []);

  const switchTab = useCallback((id: string) => {
    setActiveTabId(id);
    setIsOpen(true);
  }, []);

  const setOpen = useCallback((open: boolean) => {
    setIsOpen(open);
  }, []);

  const toggle = useCallback(() => {
    setIsOpen((v) => !v);
  }, []);

  const openPreview = useCallback<FileViewerContextValue['openPreview']>(async (port) => {
    if (!previewUrlBuilder) return null;
    if (!Number.isFinite(port) || port < 1 || port > 65535) return null;
    const result = await previewUrlBuilder(port);
    if (!result) return null;
    return openFile({
      path: `localhost:${port}`,
      source: 'preview',
      name: `localhost:${port}`,
      meta: { url: result.url, sid: result.sid, port: result.port, expiresAt: result.expiresAt },
    });
  }, [previewUrlBuilder, openFile]);

  const value = useMemo<FileViewerContextValue>(
    () => ({
      tabs,
      activeTabId,
      isOpen,
      openFile,
      closeTab,
      closeAll,
      switchTab,
      setOpen,
      toggle,
      fetcher,
      serveUrlBuilder,
      previewUrlBuilder,
      openPreview,
    }),
    [tabs, activeTabId, isOpen, openFile, closeTab, closeAll, switchTab, setOpen, toggle, fetcher, serveUrlBuilder, previewUrlBuilder, openPreview],
  );

  // Expose openFile globally so non-provider-aware callers (e.g., the cloud
  // file browser, which is rendered as a prop outside this subtree) can open
  // files into the active VM/cloud viewer. Mirrors __cloudVmChatAttach.
  useEffect(() => {
    (window as any).__cloudVmFileViewerOpen = openFile;
    return () => {
      if ((window as any).__cloudVmFileViewerOpen === openFile) {
        delete (window as any).__cloudVmFileViewerOpen;
      }
    };
  }, [openFile]);

  return (
    <FileViewerContext.Provider value={value}>
      {children}
    </FileViewerContext.Provider>
  );
};
