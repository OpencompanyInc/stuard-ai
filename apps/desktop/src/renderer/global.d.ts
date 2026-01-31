export { };

declare global {
  interface Window {
    desktopAPI: {
      show: () => Promise<void>;
      hide: () => Promise<void>;
      toggle: () => Promise<void>;
      setMode: (mode: 'compact' | 'sidebar' | 'window') => Promise<void>;
      resize: (w: number, h: number, anchor?: 'top' | 'bottom') => Promise<void>;
      setBounds: (bounds: { x?: number; y?: number; width?: number; height?: number }) => Promise<void>;
      moveBy: (dx: number, dy: number) => Promise<void>;
      getSize: () => Promise<{ width: number; height: number; mode: string }>;
      getMode: () => Promise<string>;
      // Resize events
      onResizing: (cb: (data: { width: number; height: number }) => void) => () => void;
      onResized: (cb: (data: { width: number; height: number; mode: string }) => void) => () => void;
      onModeChanged: (cb: (data: { mode: string; width: number; height: number; prevMode: string }) => void) => () => void;
      openDashboard: (options?: { tab?: string }) => Promise<void>;
      openOnboarding: () => Promise<void>;
      openWorkflows: (options?: { marketplaceSlug?: string }) => Promise<void>;
      openSpaces: () => Promise<void>;
      closeSpaces: () => Promise<void>;
      toggleSpaces: () => Promise<void>;
      // Sidebar window (unified Spaces, Canvas, Terminal)
      openSidebar: (options?: { tab?: 'spaces' | 'canvas' | 'terminal'; expanded?: boolean }) => Promise<void>;
      closeSidebar: () => Promise<void>;
      toggleSidebar: (options?: { tab?: 'spaces' | 'canvas' | 'terminal'; expanded?: boolean }) => Promise<void>;
      toggleSidebarExpanded: () => Promise<{ expanded: boolean }>;
      isSidebarExpanded: () => Promise<{ expanded: boolean }>;
      onSidebarNavigate: (cb: (data: { tab: 'spaces' | 'canvas' | 'terminal' }) => void) => () => void;
      onSidebarExpandedChange: (cb: (data: { expanded: boolean }) => void) => () => void;
      onSidebarSelectItem: (cb: (data: { type: 'space' | 'canvas'; id: string }) => void) => () => void;
      // Canvas document operations
      canvasListDocuments: () => Promise<{ ok: boolean; documents?: any[]; error?: string }>;
      canvasCreateDocument: (doc: any) => Promise<{ ok: boolean; error?: string }>;
      canvasSaveDocument: (doc: any) => Promise<{ ok: boolean; error?: string }>;
      canvasDeleteDocument: (docId: string) => Promise<{ ok: boolean; error?: string }>;
      canvasGetDocument: (docId: string) => Promise<{ ok: boolean; document?: any; error?: string }>;
      canvasRead: (docId?: string) => Promise<{ ok: boolean; document?: any; error?: string }>;
      canvasWrite: (data: { documentId?: string; content?: string; title?: string; action?: 'append' | 'replace' | 'insert'; position?: number }) => Promise<{ ok: boolean; error?: string }>;
      onCanvasUpdate: (cb: (data: { documentId?: string; content?: string; title?: string; action?: 'append' | 'replace' | 'insert'; position?: number }) => void) => () => void;
      onCanvasRead: (cb: (data: { requestId: string }) => void) => () => void;
      canvasReadResponse: (data: { requestId: string; documentId?: string | null; title?: string; content?: string }) => Promise<void>;
      closeOnboarding: () => Promise<void>;
      showItemInFolder: (filePath: string) => Promise<{ ok: boolean; error?: string }>;
      openExternal: (url: string) => Promise<void>;
      getLinkPreview: (url: string) => Promise<{ ok: boolean; data?: { title: string; description: string; image: string; url: string; siteName: string }; error?: string }>;
      webhooksLocalUrl: (id?: string) => Promise<{ ok: boolean; url?: string; error?: string }>;
      handleCloudWebhook: (payload: any) => Promise<any>;
      selectFiles: () => Promise<Array<{ name: string; path: string; data: string; mimeType: string }> | null>;
      selectImages: () => Promise<Array<{ name: string; path: string; data: string; mimeType: string }> | null>;
      listDirectory: (path: string) => Promise<{ ok: boolean; entries?: Array<{ name: string; path: string; isDirectory: boolean }>; error?: string }>;
      pickFiles: (options?: { type?: string; multiple?: boolean; title?: string; includeData?: boolean }) => Promise<{ ok: boolean; files?: Array<{ name: string; path: string; data?: string; mimeType?: string }>; error?: string }>;
      pickFolder: (options?: { title?: string; multiple?: boolean }) => Promise<{ ok: boolean; folders?: Array<{ path: string }>; error?: string }>;
      onShow: (cb: () => void) => void;
      onOpenChat: (cb: (id: string) => void) => void | (() => void);
      onDashboardNavigate: (cb: (data: { tab: string }) => void) => () => void;
      onWorkflowsNavigate: (cb: (data: { marketplaceSlug: string }) => void) => () => void;
      // Canvas windows
      canvasCreate: (item: any) => Promise<void>;
      canvasUpdate: (item: any) => Promise<void>;
      canvasDelete: (id: string) => Promise<void>;
      canvasShow: (id: string) => Promise<void>;
      canvasHide: (id: string) => Promise<void>;
      canvasFocus: (id: string) => Promise<void>;
      canvasClear: () => Promise<void>;
      canvasList: () => Promise<any[]>;
      // Board window lifecycle
      onBoardInit: (cb: (data: any) => void) => void | (() => void);
      onBoardUpdate: (cb: (data: any) => void) => void | (() => void);
      workflowsList: () => Promise<{ ok: boolean; items?: Array<{ id: string; name?: string; updatedAt?: string }>; error?: string }>;
      workflowsRead: (id: string) => Promise<{ ok: boolean; id?: string; content?: string; error?: string }>;
      workflowsSave: (id: string, content: string) => Promise<{ ok: boolean; error?: string }>;
      workflowsDelete: (id: string) => Promise<{ ok: boolean; error?: string }>;
      workflowsRun: (id: string, triggerId?: string, options?: { accessToken?: string }) => Promise<{ ok: boolean; error?: string }>;
      workflowsStop: (id: string) => Promise<{ ok: boolean; error?: string }>;
      workflowsExport: (id: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
      workflowsImport: (filePath: string) => Promise<{ ok: boolean; id?: string; error?: string }>;
      workflowsValidate: (id: string) => Promise<{ ok: boolean; requirements?: string[]; error?: string }>;
      workflowsRunStep: (id: string, options: { step: { id: string; tool: string; args: any }; accessToken?: string }) => Promise<{ ok: boolean; result?: any; error?: string }>;
      workflowsRunFromStep: (id: string, options: { startStepId: string; accessToken?: string }) => Promise<{ ok: boolean; error?: string }>;
      onWorkflowsLog: (cb: (data: any) => void) => void | (() => void);
      onWorkflowsStep: (cb: (data: any) => void) => void | (() => void);
      onWorkflowsExecution: (cb: (data: any) => void) => void | (() => void);
      // Stuards
      stuardsList: () => Promise<{ ok: boolean; items?: Array<{ id: string; name?: string; updatedAt?: string; hasRuntime?: boolean; triggers?: string[] }>; error?: string }>;
      stuardsRead: (id: string) => Promise<{ ok: boolean; id?: string; content?: string; error?: string }>;
      stuardsSave: (id: string, content: string) => Promise<{ ok: boolean; error?: string }>;
      stuardsDeploy: (id: string) => Promise<{ ok: boolean; error?: string }>;
      stuardsStop: (id: string) => Promise<{ ok: boolean; error?: string }>;
      stuardsRun: (id: string) => Promise<{ ok: boolean; error?: string }>;
      onStuardsLog: (cb: (data: any) => void) => void | (() => void);
      // Stuards UI events
      onStuardsUiShow: (cb: (data: any) => void) => void | (() => void);
      onStuardsUiUpdate: (cb: (data: any) => void) => void | (() => void);
      onStuardsUiClose: (cb: (data: any) => void) => void | (() => void);
      sendStuardsUiEvent: (stuardId: string, event: string, data?: any) => Promise<{ ok: boolean; error?: string }>;
      themeApply: (prefs: any) => Promise<any>;
      onThemeUpdated: (cb: (data: any) => void) => void | (() => void);
      updatesGetState: () => Promise<{ status: string; info?: any }>;
      updatesCheck: () => Promise<{ ok: boolean; error?: string }>;
      updatesDownload: () => Promise<{ ok: boolean; error?: string }>;
      updatesInstall: () => Promise<{ ok: boolean; error?: string }>;
      onUpdatesState: (cb: (data: { status: string; info?: any }) => void) => void | (() => void);

      execTool: (tool: string, args: any) => Promise<any>;

      // File Indexing
      fileIndexListRoots: () => Promise<{ ok: boolean; roots?: Array<{ id: string; path: string; enabled: boolean; schedule: string; last_scan_at: string | null }>; error?: string }>;
      fileIndexAddRoot: (path: string, schedule?: string) => Promise<{ ok: boolean; root?: any; error?: string }>;
      fileIndexRemoveRoot: (rootId: string) => Promise<{ ok: boolean; error?: string }>;
      fileIndexGetStats: () => Promise<{ ok: boolean; stats?: { roots: number; total_files: number; indexed_files: number; pending_files: number; files_by_kind: Record<string, number> }; error?: string }>;
      fileIndexScan: (rootId: string) => Promise<{ ok: boolean; progress?: any; error?: string }>;
      fileIndexScanAll: () => Promise<{ ok: boolean; message?: string; error?: string }>;
      fileIndexInitDefaults: () => Promise<{ ok: boolean; added?: number; folders?: string[]; error?: string }>;
      fileIndexSearch: (query: string, options?: any) => Promise<{ ok: boolean; files?: any[]; error?: string }>;
      fileIndexGetPendingCount: () => Promise<{ ok: boolean; count?: number; error?: string }>;
      fileIndexGetScanStatus: () => Promise<{ ok: boolean; isScanning?: boolean; currentRootId?: string | null; lastProgress?: any }>;
      onFileIndexScanProgress: (cb: (data: { rootId: string; path: string; progress: any }) => void) => () => void;
      onFileIndexStatus: (cb: (data: { status: string; totalRoots?: number; completedRoots?: number; currentPath?: string; error?: string }) => void) => () => void;

      // Billing (Polar)
      billingCreateCheckout: (options: { productId: string; customerEmail?: string; userId?: string; successUrl?: string }) => Promise<{ ok: boolean; url?: string; error?: string }>;
      billingGetCustomer: (email: string) => Promise<{ ok: boolean; customer?: { id: string; email: string; subscriptions: Array<{ id: string; status: string; productId: string; productName: string; currentPeriodEnd?: string }>; orders: Array<{ id: string; amount: number; currency: string; createdAt: string }> }; error?: string }>;
      billingListProducts: () => Promise<{ ok: boolean; products?: Array<{ id: string; name: string; description: string; prices: Array<{ id: string; amount: number; currency: string; type: string; recurringInterval?: string }>; isRecurring: boolean; benefits: string[] }>; error?: string }>;
      billingOpenPortal: (customerId: string) => Promise<{ ok: boolean; url?: string; error?: string }>;
      billingPurchaseCredits: (options: { productId: string; email: string; userId?: string }) => Promise<{ ok: boolean; url?: string; error?: string }>;

      // Terminal (PTY-based)
      terminalCreate: (options?: { shell?: string; cwd?: string; cols?: number; rows?: number }) => Promise<{ ok: boolean; sessionId?: string; error?: string }>;
      terminalWrite: (sessionId: string, data: string) => Promise<{ ok: boolean; error?: string }>;
      terminalResize: (sessionId: string, cols: number, rows: number) => Promise<{ ok: boolean; error?: string }>;
      terminalDestroy: (sessionId: string) => Promise<{ ok: boolean; error?: string }>;
      terminalGet: (sessionId: string) => Promise<{ ok: boolean; session?: any; error?: string }>;
      terminalList: () => Promise<{ ok: boolean; sessions?: any[]; error?: string }>;
      terminalAiWrite: (sessionId: string, input: string) => Promise<{ ok: boolean; error?: string }>;
      onTerminalData: (cb: (data: { sessionId: string; data: string }) => void) => () => void;
      onTerminalExit: (cb: (data: { sessionId: string; exitCode: number }) => void) => () => void;

      // File Icons
      getFileIcon: (filePath: string, options?: { size?: 'small' | 'normal' | 'large' }) => Promise<{ ok: boolean; dataUrl?: string; error?: string }>;
    };
  }
}
