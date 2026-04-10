export { };

 type SidebarTabId = 'spaces' | 'terminal' | 'tasks' | 'browser' | 'todo';
 type MediaKind = 'image' | 'video' | 'audio' | 'document' | 'unknown';
 type MediaSyncMode = 'local-only' | 'mirror-cloud';
 type MediaSyncStatus = 'local-only' | 'pending' | 'synced' | 'cloud-only' | 'failed';

 interface MediaLibraryItem {
   id: string;
   name: string;
   kind: MediaKind;
   source: string;
   classification: string;
   localPath: string | null;
   originalPath: string | null;
   remoteUrl: string | null;
   cloudObjectName: string | null;
   syncStatus: MediaSyncStatus;
   syncError: string | null;
   syncedAt: string | null;
   mimeType: string | null;
   extension: string | null;
   sizeBytes: number | null;
   createdAt: string;
   updatedAt: string;
   tags: string[];
   metadata: Record<string, any>;
 }

 interface MediaLibraryPrefs {
   syncMode: MediaSyncMode;
 }

 interface MediaLibrarySummary {
   total: number;
   totalBytes: number;
   synced: number;
   pending: number;
   failed: number;
   cloudOnly: number;
   byKind: Record<MediaKind, number>;
   bySource: Record<string, number>;
 }

declare global {
  interface Window {
    desktopAPI: {
      syncAuthSession: (session: any | null) => Promise<{ ok: boolean; error?: string }>;
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
      // Sidebar window (unified Spaces, Terminal, Agent Tasks, Browser)
      openSidebar: (options?: { tab?: SidebarTabId; expanded?: boolean }) => Promise<void>;
      closeSidebar: () => Promise<void>;
      toggleSidebar: (options?: { tab?: SidebarTabId; expanded?: boolean }) => Promise<void>;
      toggleSidebarExpanded: () => Promise<{ expanded: boolean }>;
      isSidebarExpanded: () => Promise<{ expanded: boolean }>;
      sidebarSetPresentation: (mode: 'full' | 'popup', tab?: SidebarTabId) => Promise<{ ok: boolean; mode?: 'full' | 'popup'; error?: string }>;
      onSidebarNavigate: (cb: (data: { tab: SidebarTabId }) => void) => () => void;
      onSidebarExpandedChange: (cb: (data: { expanded: boolean }) => void) => () => void;
      onSidebarSelectItem: (cb: (data: { type: 'space'; id: string }) => void) => () => void;
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
      chatUiPickFile: (options?: { title?: string; filters?: Array<{ name: string; extensions: string[] }>; multiple?: boolean }) => Promise<{ canceled: boolean; filePaths: string[] }>;
      chatUiPickFolder: (options?: { title?: string; multiple?: boolean }) => Promise<{ canceled: boolean; filePaths: string[] }>;
      chatUiPickSavePath: (options?: { title?: string; defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }) => Promise<{ canceled: boolean; filePath?: string }>;
      chatUiReadFile: (filePath: string, encoding?: string) => Promise<string>;
      chatUiWriteFile: (filePath: string, content: string) => Promise<void>;
      chatUiClipboardWrite: (text: string) => Promise<void>;
      chatUiClipboardRead: () => Promise<string>;
      mediaList: () => Promise<{ ok: boolean; items?: MediaLibraryItem[]; error?: string }>;
      mediaSummary: () => Promise<{ ok: boolean; summary?: MediaLibrarySummary; error?: string }>;
      mediaGetPrefs: () => Promise<{ ok: boolean; prefs?: MediaLibraryPrefs; error?: string }>;
      mediaUpdatePrefs: (updates: { syncMode?: MediaSyncMode }) => Promise<{ ok: boolean; prefs?: MediaLibraryPrefs; error?: string }>;
      mediaSync: (itemIds?: string[]) => Promise<{ ok: boolean; synced?: number; failed?: number; items?: MediaLibraryItem[]; error?: string }>;
      mediaImportPaths: (paths: string[]) => Promise<{ ok: boolean; items?: MediaLibraryItem[]; error?: string }>;
      mediaOpenPath: (targetPath: string) => Promise<{ ok: boolean; error?: string }>;
      mediaDelete: (itemId: string, deleteFile?: boolean) => Promise<{ ok: boolean; id?: string; error?: string }>;
      onShow: (cb: () => void) => () => void;
      onOpenChat: (cb: (id: string) => void) => void | (() => void);
      onChatSyncEvent: (cb: (data: { type: string; action: string; conversationId: string; source: string; data: any; timestamp: string }) => void) => () => void;
      onVMStreamEvent: (cb: (data: any) => void) => () => void;
      onRunStateSync: (cb: (data: { pendingApprovals: Array<{ id: string; tool: string; args?: Record<string, any>; description?: string; createdAt: number }>; terminals: Array<{ requestId: string; result: { text: string; finishReason: string; aborted?: boolean; error?: boolean; model?: string; conversationId?: string } }>; activePhases: Array<{ requestId: string; phase: string }> }) => void) => () => void;
      onDashboardNavigate: (cb: (data: { tab: string }) => void) => () => void;
      onWorkflowsNavigate: (cb: (data: { marketplaceSlug: string }) => void) => () => void;
      // Custom UI prebuilt assets (for UI builder preview — offline, no CDN)
      customUiGetPrebuiltAssets: () => Promise<{ ok: boolean; reactUmd?: string; reactDomUmd?: string; framerMotionUmd?: string; tailwindCss?: string; extraCss?: string; error?: string }>;
      customUiTransformJsx: (code: string) => Promise<{ ok: boolean; code: string; syntax?: string; error?: string }>;

      workflowsList: () => Promise<{ ok: boolean; items?: Array<{ id: string; name?: string; description?: string; updatedAt?: string; version?: string; marketplaceSlug?: string; locked?: boolean; triggers?: string[]; folder?: string; isWorkspace?: boolean }>; folders?: string[]; error?: string }>;
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
      // Folder operations
      workflowsCreateFolder: (name: string) => Promise<{ ok: boolean; folder?: string; error?: string }>;
      workflowsRenameFolder: (oldName: string, newName: string) => Promise<{ ok: boolean; folder?: string; error?: string }>;
      workflowsDeleteFolder: (name: string, deleteContents?: boolean) => Promise<{ ok: boolean; error?: string; count?: number }>;
      workflowsMoveToFolder: (id: string, folder: string | null) => Promise<{ ok: boolean; error?: string }>;
      // Workspace file management
      workflowsEnsureWorkspace: (id: string) => Promise<{ ok: boolean; workspacePath?: string; created?: boolean; error?: string }>;
      workflowsGetWorkspaceInfo: (id: string) => Promise<{ ok: boolean; workspacePath?: string; subdirs?: string[]; files?: Array<{ name: string; path: string; type: 'file' | 'directory'; size?: number; updatedAt?: string }>; error?: string }>;
      workflowsListWorkspaceFiles: (id: string, subpath?: string) => Promise<{ ok: boolean; files?: Array<{ name: string; path: string; type: 'file' | 'directory'; size?: number; updatedAt?: string }>; error?: string }>;
      workflowsReadWorkspaceFile: (id: string, filePath: string) => Promise<{ ok: boolean; content?: string; size?: number; updatedAt?: string; error?: string }>;
      workflowsWriteWorkspaceFile: (id: string, filePath: string, content: string) => Promise<{ ok: boolean; error?: string }>;
      workflowsDeleteWorkspaceFile: (id: string, filePath: string) => Promise<{ ok: boolean; error?: string }>;
      workflowsCreateWorkspaceSubdir: (id: string, subpath: string) => Promise<{ ok: boolean; error?: string }>;
      workflowsGetAgentToolOptions: () => Promise<{ ok: boolean; tools?: Array<{ value: string; label: string; description: string; group: string }>; error?: string }>;
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
      onShowNotification: (cb: (data: any) => void) => void | (() => void);
      onDismissNotification: (cb: (data: { id: string }) => void) => void | (() => void);
      respondToNotification: (payload: { responseId: string; type: 'submit' | 'cancel' | 'dismiss'; value?: string }) => Promise<{ ok: boolean; error?: string }>;

      onBrowserActivity: (cb: (data: { action: string; sessionId: string; timestamp: number }) => void) => () => void;
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

      notify: (titleOrConfig: string | { title?: string; body?: string; message?: string; variant?: string; position?: string; duration?: number }, body?: string) => Promise<{ ok: boolean; error?: string }>;

      // Preferences
      getPrefs: () => Promise<{ ok: boolean; prefs?: Record<string, any>; error?: string }>;
      setPrefs: (prefs: Record<string, any>) => Promise<{ ok: boolean; error?: string }>;

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

      // Skills
      skillsList: () => Promise<{ ok: boolean; skills?: Array<{ id: string; name: string; description: string; icon: string; color: string; trigger: string; steps: Array<{ id: string; type: string; label: string; content: string; toolName?: string }>; isActive: boolean; createdAt: string; updatedAt: string }> }>;
      skillsGet: (id: string) => Promise<{ ok: boolean; skill?: any; error?: string }>;
      skillsSave: (skill: any) => Promise<{ ok: boolean; error?: string }>;
      skillsDelete: (id: string) => Promise<{ ok: boolean; error?: string }>;
      skillsToggle: (id: string) => Promise<{ ok: boolean; isActive?: boolean; error?: string }>;

      // Proactive Agent System
      proactiveGetConfig: () => Promise<{ ok: boolean; config?: any; error?: string }>;
      proactiveUpdateConfig: (updates: any) => Promise<{ ok: boolean; config?: any; error?: string }>;
      proactiveListTasks: () => Promise<{ ok: boolean; tasks?: any[]; error?: string }>;
      proactiveAddTask: (task: any) => Promise<{ ok: boolean; task?: any; tasks?: any[]; error?: string }>;
      proactiveUpdateTask: (taskId: string, updates: any) => Promise<{ ok: boolean; task?: any; tasks?: any[]; error?: string }>;
      proactiveDeleteTask: (taskId: string) => Promise<{ ok: boolean; tasks?: any[]; error?: string }>;
      proactiveGetWakeUpLog: (limit?: number) => Promise<{ ok: boolean; logs?: any[]; error?: string }>;
      proactiveTriggerNow: () => Promise<{ ok: boolean; error?: string }>;
      proactiveGetAvailableTools: () => Promise<{ ok: boolean; tools?: string[]; error?: string }>;
      proactiveSubmitResult: (payload: any) => Promise<{ ok: boolean; error?: string }>;
      proactiveIsRunning: () => Promise<{ ok: boolean; running?: boolean }>;
      onProactiveUpdate: (cb: (data: any) => void) => () => void;
      onProactiveWakeUp: (cb: (data: any) => void) => () => void;
      onProactiveProgress: (cb: (data: any) => void) => () => void;
      onProactiveCheckin: (cb: (data: any) => void) => () => void;
      proactiveReply: (payload: { wakeUpId: string; text: string }) => Promise<{ ok: boolean; error?: string }>;

      // Subagent protocol events from orchestrator
      onSubagentMessage: (cb: (msg: any) => void) => () => void;

      // Global Hotkey
      setGlobalHotkey: (accelerator: string) => Promise<{ ok: boolean; error?: string }>;
      getGlobalHotkey: () => Promise<{ ok: boolean; hotkey?: string }>;
      browserUseGetChromeSyncSettings: () => Promise<{ ok: boolean; settings?: { chromeSyncEnabled: boolean; chromeSyncBrowserName?: string | null; chromeSyncProfileName?: string | null; chromeSyncProfilePath?: string | null; chromeSyncUserDataDir?: string | null }; error?: string }>;
      browserUseListChromeProfiles: () => Promise<{ ok: boolean; browsers?: Array<{ browser: string; userDataDir: string; profiles: Array<{ name: string; path: string }> }>; error?: string }>;
      browserUseUpdateChromeSyncSettings: (updates: { chromeSyncEnabled?: boolean; chromeSyncBrowserName?: string | null; chromeSyncProfileName?: string | null; chromeSyncProfilePath?: string | null; chromeSyncUserDataDir?: string | null }) => Promise<{ ok: boolean; settings?: { chromeSyncEnabled: boolean; chromeSyncBrowserName?: string | null; chromeSyncProfileName?: string | null; chromeSyncProfilePath?: string | null; chromeSyncUserDataDir?: string | null }; error?: string }>;

      // Security & Privacy
      securityGetSettings: () =>
        Promise<{ ok: boolean; settings?: { memory_lock_enabled: boolean; vault_lock_enabled: boolean; lock_timeout_minutes: number; has_password: boolean; biometric_enabled: boolean; sync_enabled: boolean; last_sync_at?: string }; error?: string }>;
      securitySetPassword: (password: string, currentPassword?: string) =>
        Promise<{ ok: boolean; error?: string }>;
      securityVerifyPassword: (password: string) =>
        Promise<{ ok: boolean; valid?: boolean; message?: string; error?: string }>;
      securityUpdateSettings: (updates: { memory_lock_enabled?: boolean; vault_lock_enabled?: boolean; lock_timeout_minutes?: number }) =>
        Promise<{ ok: boolean; error?: string }>;
      securityRemovePassword: (currentPassword: string) =>
        Promise<{ ok: boolean; error?: string }>;

      // Secure Vault (Credential Management)
      vaultList: (options?: { category?: string; search?: string; favorites_only?: boolean; tag?: string; limit?: number; offset?: number }) =>
        Promise<{ ok: boolean; entries?: Array<{ id: string; name: string; category: string; service?: string; created_at: string; updated_at: string; last_used_at?: string; favorite: boolean; tags?: string[]; has_url?: boolean; has_username?: boolean; has_password?: boolean; has_notes?: boolean; has_metadata?: boolean }>; total?: number; error?: string }>;
      vaultGet: (id: string) =>
        Promise<{ ok: boolean; entry?: { id: string; name: string; category: string; service?: string; url?: string; username?: string; password?: string; notes?: string; metadata?: Record<string, any>; created_at: string; updated_at: string; last_used_at?: string; favorite: boolean; tags?: string[] }; error?: string }>;
      vaultAdd: (entry: { name: string; category?: string; service?: string; url?: string; username?: string; password?: string; notes?: string; metadata?: Record<string, any>; favorite?: boolean; tags?: string[] }) =>
        Promise<{ ok: boolean; id?: string; created_at?: string; error?: string }>;
      vaultUpdate: (id: string, fields: Record<string, any>) =>
        Promise<{ ok: boolean; updated_at?: string; error?: string }>;
      vaultDelete: (id: string) =>
        Promise<{ ok: boolean; deleted?: string; error?: string }>;
      vaultSearch: (query: string) =>
        Promise<{ ok: boolean; entries?: Array<{ id: string; name: string; category: string; service?: string; favorite: boolean; tags?: string[] }>; count?: number; error?: string }>;
      vaultStats: () =>
        Promise<{ ok: boolean; total?: number; by_category?: Record<string, number>; favorites?: number; categories?: string[]; error?: string }>;

      // Cloud Engine agent data sync
      uploadAgentData: (cloudAiUrl: string, token: string) =>
        Promise<{ ok: boolean; skipped?: boolean; reason?: string; bytes?: number; error?: string }>;
    };
  }
}
