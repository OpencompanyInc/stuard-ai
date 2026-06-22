import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  FileViewerProvider,
  useFileViewer,
  WorkspaceFilePreviewPane,
  type FileFetcher,
} from '../file-viewer';
import { WorkspaceAppTitleBar } from '../chat/modes/window/parts/WorkspaceAppTitleBar';
import { WorkspaceLeftSidebar } from './WorkspaceLeftSidebar';
import type { WorkspaceSection } from './WorkspaceActivityRail';
import type { ConversationHistoryItem } from '../chat/shared/TabHistoryMenu';
import type { ContextItem } from '../FileNavigator';

interface WorkspaceTab {
  id: string;
  title?: string;
  serverId?: string | null;
}

interface WorkspaceShellProps {
  onClose?: () => void;
  localFileFetcher: FileFetcher;
  tabs: WorkspaceTab[];
  activeTabId?: string;
  onSwitchTab?: (id: string) => void;
  onCloseTab?: (id: string) => void;
  onAddTab?: () => void;
  onNewChat?: () => void;
  conversations?: ConversationHistoryItem[];
  loadingConversations?: boolean;
  activeConversationId?: string | null;
  onSelectConversation?: (id: string) => void;
  onAddContext?: (item: ContextItem) => void;
  contextPaths?: ContextItem[];
  accessToken?: string | null;
  toolbar?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Workspace — left sidebar (chats / files), center chat, right file preview.
 */
export const WorkspaceShell: React.FC<WorkspaceShellProps> = (props) => (
  <FileViewerProvider fetcher={props.localFileFetcher} defaultSource="local" defaultOpen>
    <WorkspaceShellInner {...props} />
  </FileViewerProvider>
);

const PREVIEW_MIN = 280;
const PREVIEW_DEFAULT = 400;
const MIN_CHAT_WIDTH = 360;
const PREVIEW_WIDTH_STORAGE_KEY = 'stuard-workspace-preview-width';

function readStoredPreviewWidth(): number {
  try {
    const saved = localStorage.getItem(PREVIEW_WIDTH_STORAGE_KEY);
    const parsed = saved ? Number.parseInt(saved, 10) : PREVIEW_DEFAULT;
    return Number.isFinite(parsed) ? Math.max(PREVIEW_MIN, parsed) : PREVIEW_DEFAULT;
  } catch {
    return PREVIEW_DEFAULT;
  }
}

function sidebarWidthForSection(section: WorkspaceSection): number {
  return section === 'files' ? 280 : 248;
}

const WorkspaceShellInner: React.FC<WorkspaceShellProps> = ({
  onClose,
  tabs,
  activeTabId,
  onSwitchTab,
  onCloseTab,
  onAddTab,
  onNewChat,
  conversations = [],
  loadingConversations = false,
  activeConversationId,
  onSelectConversation,
  onAddContext,
  contextPaths = [],
  accessToken,
  toolbar,
  children,
}) => {
  const [section, setSection] = useState<WorkspaceSection>('chat');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewWidth, setPreviewWidth] = useState(readStoredPreviewWidth);
  const [previewMax, setPreviewMax] = useState(900);
  const layoutRef = useRef<HTMLDivElement>(null);
  const previewWidthRef = useRef(previewWidth);
  const previewMaxRef = useRef(previewMax);
  previewWidthRef.current = previewWidth;
  previewMaxRef.current = previewMax;

  const { tabs: fileTabs, activeTabId: activeFileTabId } = useFileViewer();
  const activeFileTab = fileTabs.find((t) => t.id === activeFileTabId) || null;
  const showPreview = previewOpen && !!activeFileTab;

  const prevFileTabCount = useRef(fileTabs.length);
  useEffect(() => {
    if (fileTabs.length > prevFileTabCount.current) setPreviewOpen(true);
    prevFileTabCount.current = fileTabs.length;
  }, [fileTabs.length]);

  useLayoutEffect(() => {
    const el = layoutRef.current;
    if (!el) return;

    const updateMax = () => {
      const available = el.clientWidth - sidebarWidthForSection(section) - MIN_CHAT_WIDTH;
      setPreviewMax(Math.max(PREVIEW_MIN, available));
    };

    updateMax();
    const observer = new ResizeObserver(updateMax);
    observer.observe(el);
    return () => observer.disconnect();
  }, [section]);

  useEffect(() => {
    setPreviewWidth((current) => Math.max(PREVIEW_MIN, Math.min(previewMax, current)));
  }, [previewMax]);

  const startPreviewDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = previewWidthRef.current;
    const onMove = (ev: PointerEvent) => {
      const next = Math.round(startW + (startX - ev.clientX));
      const clamped = Math.max(PREVIEW_MIN, Math.min(previewMaxRef.current, next));
      previewWidthRef.current = clamped;
      setPreviewWidth(clamped);
    };
    const onUp = () => {
      try {
        localStorage.setItem(PREVIEW_WIDTH_STORAGE_KEY, String(previewWidthRef.current));
      } catch { /* ignore quota / private mode */ }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, []);

  return (
    <div
      className="workspace-app-shell launcher-compact-skin relative h-full w-full overflow-hidden flex flex-col min-h-0"
      data-workspace-app="true"
    >
      <WorkspaceAppTitleBar onClose={onClose} toolbar={toolbar} />

      <div ref={layoutRef} className="flex flex-1 min-h-0 w-full bg-theme-bg">
        <WorkspaceLeftSidebar
          section={section}
          onSectionChange={setSection}
          tabs={tabs}
          activeTabId={activeTabId}
          onSwitchTab={onSwitchTab}
          onCloseTab={onCloseTab}
          onAddTab={onAddTab}
          onNewChat={onNewChat}
          conversations={conversations}
          loadingConversations={loadingConversations}
          activeConversationId={activeConversationId}
          onSelectConversation={onSelectConversation}
          onPreviewRequest={() => setPreviewOpen(true)}
          onAddContext={onAddContext}
          contextPaths={contextPaths}
          accessToken={accessToken}
          onCollapse={onClose}
        />

        {/* Center: chat always visible */}
        <div className="workspace-main-panel flex-1 min-w-0 min-h-0 overflow-hidden p-4 pt-3">
          {children}
        </div>

        {/* Right: file preview (optional) */}
        {showPreview && (
          <>
            <div
              onPointerDown={startPreviewDrag}
              className="workspace-resize-handle shrink-0 self-stretch cursor-ew-resize touch-none"
              title="Drag to resize preview"
              aria-label="Drag to resize preview panel"
            />
            <div className="shrink-0 min-h-0 h-full overflow-hidden" style={{ width: previewWidth }}>
              <WorkspaceFilePreviewPane
                onClose={() => setPreviewOpen(false)}
                onAddContext={onAddContext}
                contextPaths={contextPaths}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
};
