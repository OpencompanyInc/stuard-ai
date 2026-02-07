
import { contextBridge, ipcRenderer } from "electron";

const __cloudBase = process.env.CLOUD_AI_HTTP || process.env.CLOUD_PUBLIC_URL || "";
try { contextBridge.exposeInMainWorld('__CLOUD_AI_HTTP__', __cloudBase); } catch { }

const __agentHttp = process.env.AGENT_HTTP || "";
try { contextBridge.exposeInMainWorld('__AGENT_HTTP__', __agentHttp); } catch { }

const __agentWs = process.env.AGENT_WS || process.env.AGENT_WS_URL || "";
try { contextBridge.exposeInMainWorld('__AGENT_WS__', __agentWs); } catch { }

contextBridge.exposeInMainWorld("desktopAPI", {
  show: () => ipcRenderer.invoke("overlay:show"),
  hide: () => ipcRenderer.invoke("overlay:hide"),
  toggle: () => ipcRenderer.invoke("overlay:toggle"),
  setMode: (mode: 'compact' | 'sidebar' | 'window') => ipcRenderer.invoke('overlay:setMode', mode),
  resize: (w: number, h: number, anchor?: 'top' | 'bottom') => ipcRenderer.invoke('overlay:resize', w, h, anchor),
  setBounds: (bounds: { x?: number; y?: number; width?: number; height?: number }) => ipcRenderer.invoke('overlay:setBounds', bounds),
  moveBy: (dx: number, dy: number) => ipcRenderer.invoke('overlay:moveBy', dx, dy),
  getSize: () => ipcRenderer.invoke('overlay:getSize'),
  getMode: () => ipcRenderer.invoke('overlay:getMode'),
  // Internal sidebar (expands window width instead of separate window)
  toggleInternalSidebar: (open?: boolean) => ipcRenderer.invoke('overlay:toggleInternalSidebar', open),
  getInternalSidebarState: () => ipcRenderer.invoke('overlay:getInternalSidebarState'),
  onInternalSidebarChanged: (cb: (data: { open: boolean; width: number }) => void) => {
    const handler = (_e: any, data: any) => cb(data);
    ipcRenderer.on('overlay:internalSidebarChanged', handler);
    return () => { try { ipcRenderer.off('overlay:internalSidebarChanged', handler); } catch { } };
  },
  // Resize events
  onResizing: (cb: (data: { width: number; height: number }) => void) => {
    const handler = (_e: any, data: any) => cb(data);
    ipcRenderer.on('overlay:resizing', handler);
    return () => { try { ipcRenderer.off('overlay:resizing', handler); } catch { } };
  },
  onResized: (cb: (data: { width: number; height: number; mode: string }) => void) => {
    const handler = (_e: any, data: any) => cb(data);
    ipcRenderer.on('overlay:resized', handler);
    return () => { try { ipcRenderer.off('overlay:resized', handler); } catch { } };
  },
  onModeChanged: (cb: (data: { mode: string; width: number; height: number; prevMode: string }) => void) => {
    const handler = (_e: any, data: any) => cb(data);
    ipcRenderer.on('overlay:modeChanged', handler);
    return () => { try { ipcRenderer.off('overlay:modeChanged', handler); } catch { } };
  },
  openDashboard: (options?: { tab?: string }) => ipcRenderer.invoke('system:openDashboard', options),
  openOnboarding: () => ipcRenderer.invoke('system:openOnboarding'),
  openWorkflows: (options?: { marketplaceSlug?: string }) => ipcRenderer.invoke('system:openWorkflows', options),
  openSpaces: () => ipcRenderer.invoke('spaces:open'),
  closeSpaces: () => ipcRenderer.invoke('spaces:close'),
  toggleSpaces: () => ipcRenderer.invoke('spaces:toggle'),
  // Sidebar window (unified Spaces, Canvas, Terminal)
  openSidebar: (options?: { tab?: 'spaces' | 'canvas' | 'terminal'; expanded?: boolean }) => ipcRenderer.invoke('sidebar:open', options),
  closeSidebar: () => ipcRenderer.invoke('sidebar:close'),
  toggleSidebar: (options?: { tab?: 'spaces' | 'canvas' | 'terminal'; expanded?: boolean }) => ipcRenderer.invoke('sidebar:toggle', options),
  toggleSidebarExpanded: () => ipcRenderer.invoke('sidebar:toggleExpanded'),
  isSidebarExpanded: () => ipcRenderer.invoke('sidebar:isExpanded'),
  onSidebarNavigate: (cb: (data: { tab: 'spaces' | 'canvas' | 'terminal' }) => void) => {
    const handler = (_e: any, data: any) => cb(data);
    ipcRenderer.on('sidebar:navigate', handler);
    return () => { try { ipcRenderer.off('sidebar:navigate', handler); } catch { } };
  },
  onSidebarExpandedChange: (cb: (data: { expanded: boolean }) => void) => {
    const handler = (_e: any, data: any) => cb(data);
    ipcRenderer.on('sidebar:expandedChange', handler);
    return () => { try { ipcRenderer.off('sidebar:expandedChange', handler); } catch { } };
  },
  onSidebarSelectItem: (cb: (data: { type: 'space' | 'canvas'; id: string }) => void) => {
    const handler = (_e: any, data: any) => cb(data);
    ipcRenderer.on('sidebar:selectItem', handler);
    return () => { try { ipcRenderer.off('sidebar:selectItem', handler); } catch { } };
  },
  // Canvas document operations (sidebar canvas panel)
  canvasListDocuments: () => ipcRenderer.invoke('canvas:listDocuments'),
  canvasCreateDocument: (doc: any) => ipcRenderer.invoke('canvas:createDocument', doc),
  canvasSaveDocument: (doc: any) => ipcRenderer.invoke('canvas:saveDocument', doc),
  canvasDeleteDocument: (docId: string) => ipcRenderer.invoke('canvas:deleteDocument', docId),
  canvasGetDocument: (docId: string) => ipcRenderer.invoke('canvas:getDocument', docId),
  canvasRead: (docId?: string) => ipcRenderer.invoke('canvas:read', docId),
  canvasWrite: (data: { documentId?: string; content?: string; title?: string; action?: 'append' | 'replace' | 'insert'; position?: number }) =>
    ipcRenderer.invoke('canvas:write', data),
  onCanvasUpdate: (cb: (data: { documentId?: string; content?: string; title?: string; action?: 'append' | 'replace' | 'insert'; position?: number }) => void) => {
    const handler = (_e: any, data: any) => cb(data);
    ipcRenderer.on('canvas:update', handler);
    return () => { try { ipcRenderer.off('canvas:update', handler); } catch { } };
  },
  onCanvasRead: (cb: (data: { requestId: string }) => void) => {
    const handler = (_e: any, data: any) => cb(data);
    ipcRenderer.on('canvas:read', handler);
    return () => { try { ipcRenderer.off('canvas:read', handler); } catch { } };
  },
  canvasReadResponse: (data: { requestId: string; documentId?: string | null; title?: string; content?: string }) =>
    ipcRenderer.invoke('canvas:readResponse', data),
  closeOnboarding: () => ipcRenderer.invoke('system:closeOnboarding'),
  // Files
  selectFiles: () => ipcRenderer.invoke('files:select'),
  selectImages: () => ipcRenderer.invoke('files:selectImages'),
  showItemInFolder: (filePath: string) => ipcRenderer.invoke('files:showItemInFolder', filePath),
  listDirectory: (path: string) => ipcRenderer.invoke('files:listDirectory', path),
  pickFiles: async (options?: { type?: string; multiple?: boolean; title?: string; includeData?: boolean }) => {
    try {
      const files = await ipcRenderer.invoke('files:select', options);
      return { ok: true, files: Array.isArray(files) ? files : [] };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || 'failed') };
    }
  },
  pickFolder: async (options?: { title?: string; multiple?: boolean }) => {
    try {
      const folders = await ipcRenderer.invoke('files:selectFolder', options);
      return { ok: true, folders: Array.isArray(folders) ? folders : [] };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || 'failed') };
    }
  },
  // System helpers
  openExternal: (url: string) => ipcRenderer.invoke('system:openExternal', url),
  getLinkPreview: (url: string) => ipcRenderer.invoke('system:getLinkPreview', url),
  getFileIcon: (filePath: string, options?: { size?: 'small' | 'normal' | 'large' }) => ipcRenderer.invoke('system:getFileIcon', filePath, options),
  notify: (titleOrConfig: string | any, body?: string) => {
    if (typeof titleOrConfig === 'string') {
      return ipcRenderer.invoke('system:notify', { title: titleOrConfig, body });
    }
    return ipcRenderer.invoke('system:notify', titleOrConfig);
  },
  webhooksLocalUrl: (id?: string) => ipcRenderer.invoke('webhooks:localUrl', id),
  handleCloudWebhook: (payload: any) => ipcRenderer.invoke('webhooks:cloudEvent', payload),
  connectOutlook: () => ipcRenderer.invoke('outlook:connect'),
  getOutlookStatus: () => ipcRenderer.invoke('outlook:status'),
  getOutlookToken: () => ipcRenderer.invoke('outlook:getToken'),
  onShow: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on("overlay:showed", handler);
    return () => {
      try { ipcRenderer.off("overlay:showed", handler); } catch { }
    };
  },
  // Agent
  agentStart: (id?: string) => ipcRenderer.invoke('agent:start', id),
  agentStop: (id: string) => ipcRenderer.invoke('agent:stop', id),
  agentList: () => ipcRenderer.invoke('agent:list'),

  // Canvas windows (separate Electron BrowserWindows)
  canvasCreate: (item: any) => ipcRenderer.invoke('canvas:create', item),
  canvasUpdate: (item: any) => ipcRenderer.invoke('canvas:update', item),
  canvasDelete: (id: string) => ipcRenderer.invoke('canvas:delete', id),
  canvasShow: (id: string) => ipcRenderer.invoke('canvas:show', id),
  canvasHide: (id: string) => ipcRenderer.invoke('canvas:hide', id),
  canvasFocus: (id: string) => ipcRenderer.invoke('canvas:focus', id),
  canvasClear: () => ipcRenderer.invoke('canvas:clear'),
  canvasList: () => ipcRenderer.invoke('canvas:list'),
  // Board window lifecycle events
  onBoardInit: (cb: (data: any) => void) => {
    const handler = (_e: any, data: any) => cb(data);
    ipcRenderer.on('board:init', handler);
    return () => { try { ipcRenderer.off('board:init', handler); } catch { } };
  },
  onBoardUpdate: (cb: (data: any) => void) => {
    const handler = (_e: any, data: any) => cb(data);
    ipcRenderer.on('board:update', handler);
    return () => { try { ipcRenderer.off('board:update', handler); } catch { } };
  },
  workflowsList: () => ipcRenderer.invoke('workflows:list'),
  workflowsRead: (id: string) => ipcRenderer.invoke('workflows:read', id),
  workflowsSave: (id: string, content: string) => ipcRenderer.invoke('workflows:save', { id, content }),
  workflowsDelete: (id: string) => ipcRenderer.invoke('workflows:delete', id),
  workflowsRun: (id: string, triggerId?: string, options?: { accessToken?: string }) => ipcRenderer.invoke('workflows:run', id, triggerId, options),
  workflowsStop: (id: string) => ipcRenderer.invoke('workflows:stop', id),
  workflowsDeploy: (id: string) => ipcRenderer.invoke('workflows:deploy', id),
  workflowsUndeploy: (id: string) => ipcRenderer.invoke('workflows:undeploy', id),
  workflowsGetDeployStatus: (id: string) => ipcRenderer.invoke('workflows:getDeployStatus', id),
  workflowsExport: (id: string) => ipcRenderer.invoke('workflows:export', id),
  workflowsImport: (filePath: string) => ipcRenderer.invoke('workflows:import', filePath),
  workflowsValidate: (id: string) => ipcRenderer.invoke('workflows:validate', id),
  workflowsRunStep: (id: string, options: { step: { id: string; tool: string; args: any }; accessToken?: string }) =>
    ipcRenderer.invoke('workflows:runStep', id, options),
  workflowsRunFromStep: (id: string, options: { startStepId: string; accessToken?: string }) =>
    ipcRenderer.invoke('workflows:runFromStep', id, options),
  onWorkflowsLog: (cb: (data: any) => void) => {
    const handler = (_e: any, data: any) => cb(data);
    ipcRenderer.on('workflows:log', handler);
    return () => { try { ipcRenderer.off('workflows:log', handler); } catch { } };
  },
  // Workflow step execution events for visual flow
  onWorkflowsStep: (cb: (data: any) => void) => {
    const handler = (_e: any, data: any) => cb(data);
    ipcRenderer.on('workflows:step', handler);
    return () => { try { ipcRenderer.off('workflows:step', handler); } catch { } };
  },
  // Workflow execution state (started/stopped)
  onWorkflowsExecution: (cb: (data: any) => void) => {
    const handler = (_e: any, data: any) => cb(data);
    ipcRenderer.on('workflows:execution', handler);
    return () => { try { ipcRenderer.off('workflows:execution', handler); } catch { } };
  },
  // Stream wire activity events (for animation control)
  onWorkflowsStream: (cb: (data: any) => void) => {
    const handler = (_e: any, data: any) => cb(data);
    ipcRenderer.on('workflows:stream', handler);
    return () => { try { ipcRenderer.off('workflows:stream', handler); } catch { } };
  },
  // Stuards (Automations)
  stuardsList: () => ipcRenderer.invoke('stuards:list'),
  stuardsRead: (id: string) => ipcRenderer.invoke('stuards:read', id),
  stuardsSave: (id: string, content: string) => ipcRenderer.invoke('stuards:save', { id, content }),
  stuardsDeploy: (id: string) => ipcRenderer.invoke('stuards:deploy', id),
  stuardsStop: (id: string) => ipcRenderer.invoke('stuards:stop', id),
  stuardsRun: (id: string) => ipcRenderer.invoke('stuards:run', id),
  onStuardsLog: (cb: (data: any) => void) => {
    const handler = (_e: any, data: any) => cb(data);
    ipcRenderer.on('stuards:log', handler);
    return () => { try { ipcRenderer.off('stuards:log', handler); } catch { } };
  },
  // Stuards UI events (for custom workflow UIs)
  onStuardsUiShow: (cb: (data: any) => void) => {
    const handler = (_e: any, data: any) => cb(data);
    ipcRenderer.on('stuards:ui:show', handler);
    return () => { try { ipcRenderer.off('stuards:ui:show', handler); } catch { } };
  },
  onStuardsUiUpdate: (cb: (data: any) => void) => {
    const handler = (_e: any, data: any) => cb(data);
    ipcRenderer.on('stuards:ui:update', handler);
    return () => { try { ipcRenderer.off('stuards:ui:update', handler); } catch { } };
  },
  onStuardsUiClose: (cb: (data: any) => void) => {
    const handler = (_e: any, data: any) => cb(data);
    ipcRenderer.on('stuards:ui:close', handler);
    return () => { try { ipcRenderer.off('stuards:ui:close', handler); } catch { } };
  },
  sendStuardsUiEvent: (stuardId: string, event: string, data?: any) => ipcRenderer.invoke('stuards:ui:event', { stuardId, event, data }),
  themeApply: (prefs: any) => ipcRenderer.invoke('prefs:applyTheme', prefs),
  onThemeUpdated: (cb: (data: any) => void) => {
    const handler = (_e: any, data: any) => cb(data);
    ipcRenderer.on('prefs:themeUpdated', handler);
    return () => { try { ipcRenderer.off('prefs:themeUpdated', handler); } catch { } };
  },
  updatesGetState: () => ipcRenderer.invoke('updates:getState'),
  updatesCheck: () => ipcRenderer.invoke('updates:check'),
  updatesDownload: () => ipcRenderer.invoke('updates:download'),
  updatesInstall: () => ipcRenderer.invoke('updates:install'),
  updatesSetChannel: (channel: 'stable' | 'beta' | 'staging') => ipcRenderer.invoke('updates:setChannel', channel),
  updatesGetApiEndpoint: () => ipcRenderer.invoke('updates:getApiEndpoint'),
  onUpdatesState: (cb: (data: any) => void) => {
    const handler = (_e: any, data: any) => cb(data);
    ipcRenderer.on('updates:state', handler);
    return () => { try { ipcRenderer.off('updates:state', handler); } catch { } };
  },
  onApiEndpointChanged: (cb: (endpoint: string) => void) => {
    const handler = (_e: any, endpoint: string) => cb(endpoint);
    ipcRenderer.on('updates:api-endpoint-changed', handler);
    return () => { try { ipcRenderer.off('updates:api-endpoint-changed', handler); } catch { } };
  },
  // Speech
  startSpeechStream: (url: string, token: string) => ipcRenderer.invoke('speech:start', { url, token }),
  stopSpeechStream: () => ipcRenderer.invoke('speech:stop'),
  onSpeechEvent: (cb: (data: any) => void) => {
    const handler = (_e: any, data: any) => cb(data);
    ipcRenderer.on('speech:event', handler);
    return () => { try { ipcRenderer.off('speech:event', handler); } catch { } };
  },
  onSpeechError: (cb: (msg: string) => void) => {
    const handler = (_e: any, msg: any) => cb(msg);
    ipcRenderer.on('speech:error', handler);
    return () => { try { ipcRenderer.off('speech:error', handler); } catch { } };
  },
  onSpeechStopped: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('speech:stopped', handler);
    return () => { try { ipcRenderer.off('speech:stopped', handler); } catch { } };
  },
  // Tools
  execTool: (tool: string, args: any) => ipcRenderer.invoke('tools:exec', tool, args),
  execLocalTool: (tool: string, args: any) => ipcRenderer.invoke('tools:exec', tool, args),
  // Navigation
  openChat: (conversationId: string) => ipcRenderer.invoke('overlay:openChat', conversationId),
  onOpenChat: (cb: (id: string) => void) => {
    const handler = (_e: any, id: any) => cb(id);
    ipcRenderer.on('overlay:open-chat', handler);
    return () => { try { ipcRenderer.off('overlay:open-chat', handler); } catch { } };
  },
  onDashboardNavigate: (cb: (data: { tab: string }) => void) => {
    const handler = (_e: any, data: any) => cb(data);
    ipcRenderer.on('dashboard:navigate', handler);
    return () => { try { ipcRenderer.off('dashboard:navigate', handler); } catch { } };
  },
  onWorkflowsNavigate: (cb: (data: { marketplaceSlug: string }) => void) => {
    const handler = (_e: any, data: any) => cb(data);
    ipcRenderer.on('workflows:navigate', handler);
    return () => { try { ipcRenderer.off('workflows:navigate', handler); } catch { } };
  },

  // Terminal (PTY-based)
  terminalCreate: (options?: { shell?: string; cwd?: string; cols?: number; rows?: number }) =>
    ipcRenderer.invoke('terminal:create', options),
  terminalWrite: (sessionId: string, data: string) =>
    ipcRenderer.invoke('terminal:write', sessionId, data),
  terminalResize: (sessionId: string, cols: number, rows: number) =>
    ipcRenderer.invoke('terminal:resize', sessionId, cols, rows),
  terminalDestroy: (sessionId: string) =>
    ipcRenderer.invoke('terminal:destroy', sessionId),
  terminalGet: (sessionId: string) =>
    ipcRenderer.invoke('terminal:get', sessionId),
  terminalGetBuffer: (sessionId: string) =>
    ipcRenderer.invoke('terminal:getBuffer', sessionId),
  terminalList: () =>
    ipcRenderer.invoke('terminal:list'),
  terminalAiWrite: (sessionId: string, input: string) =>
    ipcRenderer.invoke('terminal:aiWrite', sessionId, input),

  // Terminal event subscriptions
  onTerminalData: (cb: (data: { sessionId: string; data: string }) => void) => {
    const handler = (_e: any, data: any) => cb(data);
    ipcRenderer.on('terminal:data', handler);
    return () => { try { ipcRenderer.off('terminal:data', handler); } catch { } };
  },
  onTerminalExit: (cb: (data: { sessionId: string; exitCode: number }) => void) => {
    const handler = (_e: any, data: any) => cb(data);
    ipcRenderer.on('terminal:exit', handler);
    return () => { try { ipcRenderer.off('terminal:exit', handler); } catch { } };
  },

  // File Indexing
  fileIndexListRoots: () => ipcRenderer.invoke('fileIndex:listRoots'),
  fileIndexAddRoot: (path: string, schedule?: string) => ipcRenderer.invoke('fileIndex:addRoot', path, schedule),
  fileIndexRemoveRoot: (rootId: string) => ipcRenderer.invoke('fileIndex:removeRoot', rootId),
  fileIndexGetStats: () => ipcRenderer.invoke('fileIndex:getStats'),
  fileIndexScan: (rootId: string) => ipcRenderer.invoke('fileIndex:scan', rootId),
  fileIndexScanAll: () => ipcRenderer.invoke('fileIndex:scanAll'),
  fileIndexInitDefaults: () => ipcRenderer.invoke('fileIndex:initDefaults'),
  fileIndexSearch: (query: string, options?: any) => ipcRenderer.invoke('fileIndex:search', query, options),
  fileIndexGetPendingCount: () => ipcRenderer.invoke('fileIndex:getPendingCount'),
  fileIndexGetScanStatus: () => ipcRenderer.invoke('fileIndex:getScanStatus'),
  onFileIndexScanProgress: (cb: (data: { rootId: string; path: string; progress: any }) => void) => {
    const handler = (_e: any, data: any) => cb(data);
    ipcRenderer.on('file-index:scan-progress', handler);
    return () => { try { ipcRenderer.off('file-index:scan-progress', handler); } catch { } };
  },
  onFileIndexStatus: (cb: (data: { status: string; totalRoots?: number; completedRoots?: number; currentPath?: string; error?: string }) => void) => {
    const handler = (_e: any, data: any) => cb(data);
    ipcRenderer.on('file-index:status', handler);
    return () => { try { ipcRenderer.off('file-index:status', handler); } catch { } };
  },
  fileIndexProcessSemanticIndexing: (token: string, limit: number) => ipcRenderer.invoke('fileIndex:processSemanticIndexing', token, limit),
  onFileIndexSemanticProgress: (cb: (data: { total: number; processed: number; successful: number; failed: number; currentFile?: string }) => void) => {
    const handler = (_e: any, data: any) => cb(data);
    ipcRenderer.on('file-index:semantic-progress', handler);
    return () => { try { ipcRenderer.off('file-index:semantic-progress', handler); } catch { } };
  },

  // Billing (Polar)
  billingCreateCheckout: (options: { productId: string; customerEmail?: string; userId?: string; successUrl?: string }) =>
    ipcRenderer.invoke('billing:createCheckout', options),
  billingGetCustomer: (email: string) => ipcRenderer.invoke('billing:getCustomer', email),
  billingListProducts: () => ipcRenderer.invoke('billing:listProducts'),
  billingOpenPortal: (customerId: string) => ipcRenderer.invoke('billing:openPortal', customerId),
  billingPurchaseCredits: (options: { productId: string; email: string; userId?: string }) =>
    ipcRenderer.invoke('billing:purchaseCredits', options),

  // Quick Shortcuts / Bookmarks
  bookmarksList: () => ipcRenderer.invoke('bookmarks:list'),
  bookmarksSave: (bookmarks: any[]) => ipcRenderer.invoke('bookmarks:save', bookmarks),
  bookmarksAdd: (bookmark: any) => ipcRenderer.invoke('bookmarks:add', bookmark),
  bookmarksUpdate: (bookmark: any) => ipcRenderer.invoke('bookmarks:update', bookmark),
  bookmarksDelete: (bookmarkId: string) => ipcRenderer.invoke('bookmarks:delete', bookmarkId),
  bookmarksReorder: (bookmarkIds: string[]) => ipcRenderer.invoke('bookmarks:reorder', bookmarkIds),
  bookmarksExecute: (bookmark: any) => ipcRenderer.invoke('bookmarks:execute', bookmark),
  selectFolder: (options?: { title?: string; multiple?: boolean }) => ipcRenderer.invoke('files:selectFolder', options),

  // Unified Tasks System
  unifiedTasksList: () => ipcRenderer.invoke('unified-tasks:list'),
  unifiedTasksGet: (taskId: string) => ipcRenderer.invoke('unified-tasks:get', taskId),
  unifiedTasksAdd: (task: any) => ipcRenderer.invoke('unified-tasks:add', task),
  unifiedTasksUpdate: (task: any) => ipcRenderer.invoke('unified-tasks:update', task),
  unifiedTasksDelete: (taskId: string) => ipcRenderer.invoke('unified-tasks:delete', taskId),
  unifiedTasksToggleStatus: (taskId: string) => ipcRenderer.invoke('unified-tasks:toggle-status', taskId),
  unifiedTasksAddSubtodo: (taskId: string, subtodo: any) => ipcRenderer.invoke('unified-tasks:add-subtodo', taskId, subtodo),
  unifiedTasksToggleSubtodo: (taskId: string, subtodoId: string) => ipcRenderer.invoke('unified-tasks:toggle-subtodo', taskId, subtodoId),
  unifiedTasksDeleteSubtodo: (taskId: string, subtodoId: string) => ipcRenderer.invoke('unified-tasks:delete-subtodo', taskId, subtodoId),
  unifiedTasksAddAgentAssignment: (taskId: string, assignment: any) => ipcRenderer.invoke('unified-tasks:add-agent-assignment', taskId, assignment),
  unifiedTasksUpdateAgentAssignment: (taskId: string, assignmentId: string, updates: any) => ipcRenderer.invoke('unified-tasks:update-agent-assignment', taskId, assignmentId, updates),
  unifiedTasksDeleteAgentAssignment: (taskId: string, assignmentId: string) => ipcRenderer.invoke('unified-tasks:delete-agent-assignment', taskId, assignmentId),
  // Reminder convenience aliases (reminders are agent assignments with type='reminder')
  unifiedTasksAddReminder: (taskId: string, reminder: any) => ipcRenderer.invoke('unified-tasks:add-agent-assignment', taskId, { ...reminder, type: 'reminder' }),
  unifiedTasksDeleteReminder: (taskId: string, reminderId: string) => ipcRenderer.invoke('unified-tasks:delete-agent-assignment', taskId, reminderId),
  unifiedTasksGetPendingAssignments: () => ipcRenderer.invoke('unified-tasks:get-pending-assignments'),
  unifiedTasksGetCalendarItems: () => ipcRenderer.invoke('unified-tasks:get-calendar-items'),

  // Legacy User To-Do List (for backwards compatibility)
  todosList: () => ipcRenderer.invoke('todos:list'),
  todosSave: (todos: any[]) => ipcRenderer.invoke('todos:save', todos),
  todosAdd: (todo: any) => ipcRenderer.invoke('todos:add', todo),
  todosUpdate: (todo: any) => ipcRenderer.invoke('todos:update', todo),
  todosDelete: (todoId: string) => ipcRenderer.invoke('todos:delete', todoId),
  todosToggle: (todoId: string) => ipcRenderer.invoke('todos:toggle', todoId),
  todosReorder: (todoIds: string[]) => ipcRenderer.invoke('todos:reorder', todoIds),

  // Global Hotkey
  setGlobalHotkey: (accelerator: string) => ipcRenderer.invoke('system:setGlobalHotkey', accelerator),
  getGlobalHotkey: () => ipcRenderer.invoke('system:getGlobalHotkey'),

  // View mode change events (for shortcuts to switch views)
  onViewModeChange: (cb: (data: { mode: 'chat' | 'tasks'; subTab?: 'todo' | 'agent' }) => void) => {
    const handler = (_e: any, data: any) => cb(data);
    ipcRenderer.on('overlay:view-mode', handler);
    return () => { try { ipcRenderer.off('overlay:view-mode', handler); } catch { } };
  },

  // Notification System
  onShowNotification: (cb: (data: any) => void) => {
    const handler = (_e: any, data: any) => cb(data);
    ipcRenderer.on('notification:show', handler);
    return () => { try { ipcRenderer.off('notification:show', handler); } catch { } };
  },
  setIgnoreMouseEvents: (ignore: boolean, options?: { forward: boolean }) => ipcRenderer.send('window:ignore-mouse-events', ignore, options),
});
