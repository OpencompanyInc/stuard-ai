/**
 * Custom UI Preload Script
 *
 * Exposes a secure API for custom UI windows to communicate with workflows.
 * This replaces the hacky title-based communication with proper IPC.
 */

import { contextBridge, ipcRenderer } from 'electron';

// Store for event listeners
const eventListeners: Map<string, Set<(data: any) => void>> = new Map();
const streamSubscriptionListeners: Map<string, (data: any) => void> = new Map();

// Handle incoming events from main process
ipcRenderer.on('stuard:event', (_event, { eventName, data }) => {
  const listeners = eventListeners.get(eventName);
  if (listeners) {
    listeners.forEach(cb => {
      try {
        cb(data);
      } catch (e) {
        console.error(`[stuard] Error in event listener for "${eventName}":`, e);
      }
    });
  }
});

// Handle data updates from main process
ipcRenderer.on('stuard:data-update', (_event, data) => {
  const listeners = eventListeners.get('__data_update__');
  if (listeners) {
    listeners.forEach(cb => {
      try {
        cb(data);
      } catch (e) {
        console.error('[stuard] Error in data update listener:', e);
      }
    });
  }
});

// Expose the stuard API to the renderer
contextBridge.exposeInMainWorld('stuard', {
  /**
   * Get the window ID
   */
  getWindowId: (): Promise<string> => ipcRenderer.invoke('stuard:getWindowId'),

  /**
   * Get the initial data passed to the window
   */
  getData: (): Promise<any> => ipcRenderer.invoke('stuard:getData'),

  /**
   * Get the flow ID if running within a workflow
   */
  getFlowId: (): Promise<string | null> => ipcRenderer.invoke('stuard:getFlowId'),

  /**
   * Call a workflow tool and get the result
   * @param toolName - Name of the tool to call
   * @param args - Arguments to pass to the tool
   * @returns Promise resolving to the tool result
   */
  callTool: (toolName: string, args?: any): Promise<any> => {
    return ipcRenderer.invoke('stuard:callTool', { tool: toolName, args: args || {} });
  },

  /**
   * Execute a sibling node in the workflow by its ID.
   * Routes work to standalone tool nodes instead of embedding tool calls inline.
   * The node must exist in the same workflow as this custom_ui window.
   * @param nodeId - The ID of the node/step to execute
   * @param data - Optional data to pass as input (merged into the node's args via {{caller.field}} templates)
   * @returns Promise resolving to the node's execution result
   */
  callNode: (nodeId: string, data?: any): Promise<any> => {
    return ipcRenderer.invoke('stuard:callNode', { nodeId, data: data || {} });
  },

  /**
   * Run a JavaScript/TypeScript snippet in a sandboxed context
   * @param code - The code to execute
   * @param context - Variables to inject into the execution context
   * @returns Promise resolving to the execution result
   */
  runScript: (code: string, context?: Record<string, any>): Promise<any> => {
    return ipcRenderer.invoke('stuard:runScript', { code, context });
  },

  /**
   * Emit an event to the workflow
   * @param eventName - Name of the event
   * @param data - Event data
   */
  emit: (eventName: string, data?: any): void => {
    ipcRenderer.send('stuard:emit', { event: eventName, data });
  },

  /**
   * Listen for events from the workflow
   * @param eventName - Name of the event to listen for
   * @param callback - Callback function when event is received
   * @returns Unsubscribe function
   */
  on: (eventName: string, callback: (data: any) => void): (() => void) => {
    if (!eventListeners.has(eventName)) {
      eventListeners.set(eventName, new Set());
    }
    eventListeners.get(eventName)!.add(callback);

    return () => {
      const listeners = eventListeners.get(eventName);
      if (listeners) {
        listeners.delete(callback);
        if (listeners.size === 0) {
          eventListeners.delete(eventName);
        }
      }
    };
  },

  /**
   * Listen for data updates
   * @param callback - Callback when data is updated
   * @returns Unsubscribe function
   */
  onDataUpdate: (callback: (data: any) => void): (() => void) => {
    if (!eventListeners.has('__data_update__')) {
      eventListeners.set('__data_update__', new Set());
    }
    eventListeners.get('__data_update__')!.add(callback);

    return () => {
      const listeners = eventListeners.get('__data_update__');
      if (listeners) {
        listeners.delete(callback);
      }
    };
  },

  /**
   * Submit form data and optionally close the window
   * @param data - Form data to submit
   * @param keepOpen - Whether to keep the window open after submit
   */
  submit: (data?: any, keepOpen?: boolean): void => {
    ipcRenderer.send('stuard:submit', { data, keepOpen });
  },

  /**
   * Trigger a named action
   * @param actionName - Name of the action
   * @param data - Action data
   */
  action: (actionName: string, data?: any): void => {
    ipcRenderer.send('stuard:action', { action: actionName, data });
  },

  /**
   * Close the window with optional return data
   * @param data - Data to return when closing
   */
  close: (data?: any): void => {
    ipcRenderer.send('stuard:close', { data });
  },

  /**
   * Update the window's data store
   * @param updates - Partial data to merge
   */
  updateData: (updates: Record<string, any>): Promise<void> => {
    return ipcRenderer.invoke('stuard:updateData', updates);
  },

  /**
   * Show a native file picker dialog
   * @param options - Dialog options
   */
  pickFile: (options?: {
    title?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
    multiple?: boolean;
  }): Promise<{ canceled: boolean; filePaths: string[] }> => {
    return ipcRenderer.invoke('stuard:pickFile', options || {});
  },

  /**
   * Show a native folder picker dialog
   * @param options - Dialog options
   */
  pickFolder: (options?: {
    title?: string;
    multiple?: boolean;
  }): Promise<{ canceled: boolean; filePaths: string[] }> => {
    return ipcRenderer.invoke('stuard:pickFolder', options || {});
  },

  /**
   * Show a native save dialog
   * @param options - Dialog options
   */
  pickSavePath: (options?: {
    title?: string;
    defaultPath?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }): Promise<{ canceled: boolean; filePath?: string }> => {
    return ipcRenderer.invoke('stuard:pickSavePath', options || {});
  },

  /**
   * Read a file's contents
   * @param filePath - Path to the file
   * @param encoding - File encoding (default: utf-8)
   */
  readFile: (filePath: string, encoding?: string): Promise<string> => {
    return ipcRenderer.invoke('stuard:readFile', { path: filePath, encoding });
  },

  /**
   * Write content to a file
   * @param filePath - Path to the file
   * @param content - Content to write
   */
  writeFile: (filePath: string, content: string): Promise<void> => {
    return ipcRenderer.invoke('stuard:writeFile', { path: filePath, content });
  },

  /**
   * Show a system notification
   * @param title - Notification title
   * @param body - Notification body
   */
  notify: (title: string, body?: string): void => {
    ipcRenderer.send('stuard:notify', { title, body });
  },

  /**
   * Copy text to clipboard
   * @param text - Text to copy
   */
  copyToClipboard: (text: string): Promise<void> => {
    return ipcRenderer.invoke('stuard:clipboard:write', text);
  },

  /**
   * Read text from clipboard
   */
  readClipboard: (): Promise<string> => {
    return ipcRenderer.invoke('stuard:clipboard:read');
  },

  /**
   * Subscribe to workflow variable updates.
   * Elements with data-var="varName" will auto-update when the variable changes.
   * @param varNames - Array of variable names to subscribe to (use '*' for all)
   */
  subscribeVars: (varNames: string[]): Promise<void> => {
    return ipcRenderer.invoke('stuard:subscribeVars', varNames);
  },

  /**
   * Get the current value of a workflow variable
   * @param varName - Variable name (with or without 'workflow.' prefix)
   */
  getVar: (varName: string): Promise<{ ok: boolean; name: string; value: any; type?: string }> => {
    return ipcRenderer.invoke('stuard:getVar', varName);
  },

  /**
   * Set a workflow variable directly from custom UI.
   * This triggers reactive updates to all data-var bindings and useState listeners.
   * @param varName - Variable name (with or without 'workflow.' prefix)
   * @param value - Value to set
   * @param type - Optional type hint ('boolean' | 'string' | 'number' | 'list')
   */
  setVar: (varName: string, value: any, type?: string): Promise<{ ok: boolean; name: string; value: any; type: string }> => {
    return ipcRenderer.invoke('stuard:setVar', { name: varName, value, type });
  },

  /**
   * Listen for workflow variable updates
   * @param callback - Called with { name, shortName, value, type, updatedAt } when a subscribed variable changes
   * @returns Unsubscribe function
   */
  onVarUpdate: (callback: (data: { name: string; shortName: string; value: any; type: string; updatedAt: string }) => void): (() => void) => {
    if (!eventListeners.has('__var_update__')) {
      eventListeners.set('__var_update__', new Set());
    }
    eventListeners.get('__var_update__')!.add(callback);

    return () => {
      const listeners = eventListeners.get('__var_update__');
      if (listeners) {
        listeners.delete(callback);
      }
    };
  },

  /**
   * Navigate to a different page (requires pages to be defined in custom_ui args)
   * @param page - Name of the page to navigate to
   * @param data - Optional data to merge into formData on navigation
   */
  navigate: (page: string, data?: any): void => {
    ipcRenderer.send('stuard:navigate', { page, data });
  },

  /**
   * Get the current page name (only applicable when pages are defined)
   */
  getCurrentPage: (): Promise<string | null> => {
    return ipcRenderer.invoke('stuard:getCurrentPage');
  },

  /**
   * Listen for page navigation events
   * @param callback - Called with { page, data } when navigation occurs
   * @returns Unsubscribe function
   */
  onPageChange: (callback: (info: { page: string; data?: any }) => void): (() => void) => {
    if (!eventListeners.has('__page_change__')) {
      eventListeners.set('__page_change__', new Set());
    }
    eventListeners.get('__page_change__')!.add(callback);

    return () => {
      const listeners = eventListeners.get('__page_change__');
      if (listeners) {
        listeners.delete(callback);
      }
    };
  },

  /**
   * Subscribe to a workflow stream and receive chunks in real-time.
   * Use this to stream video frames, text tokens, or any chunked data into the UI.
   * @param streamId - The stream ID to subscribe to
   * @param callback - Called with each chunk { data, index, streamId }
   * @returns Promise resolving to { ok, subscriberId } — call unsubscribeStream(subscriberId) to stop
   */
  subscribeStream: async (streamId: string, callback: (chunk: { data: any; index: number; streamId: string }) => void): Promise<{ ok: boolean; subscriberId?: string }> => {
    if (!eventListeners.has('__stream_chunk__')) {
      eventListeners.set('__stream_chunk__', new Set());
    }
    const wrapped = (chunk: { data: any; index: number; streamId: string }) => {
      if (chunk?.streamId === streamId) callback(chunk);
    };
    eventListeners.get('__stream_chunk__')!.add(wrapped);
    const result = await ipcRenderer.invoke('stuard:subscribeStream', { streamId });
    if (result?.ok && result?.subscriberId) {
      streamSubscriptionListeners.set(`${streamId}:${result.subscriberId}`, wrapped);
    } else {
      eventListeners.get('__stream_chunk__')?.delete(wrapped);
    }
    return result;
  },

  /**
   * Unsubscribe from a workflow stream
   * @param streamId - The stream ID
   * @param subscriberId - The subscriber ID returned from subscribeStream
   */
  unsubscribeStream: async (streamId: string, subscriberId: string): Promise<void> => {
    try {
      await ipcRenderer.invoke('stuard:unsubscribeStream', { streamId, subscriberId });
    } finally {
      const key = `${streamId}:${subscriberId}`;
      const wrapped = streamSubscriptionListeners.get(key);
      if (wrapped) {
        eventListeners.get('__stream_chunk__')?.delete(wrapped);
        streamSubscriptionListeners.delete(key);
      }
    }
  },

  /**
   * Listen for stream chunk events (low-level)
   * @param callback - Called with { data, index, streamId }
   * @returns Unsubscribe function
   */
  onStreamChunk: (callback: (chunk: { data: any; index: number; streamId: string }) => void): (() => void) => {
    if (!eventListeners.has('__stream_chunk__')) {
      eventListeners.set('__stream_chunk__', new Set());
    }
    eventListeners.get('__stream_chunk__')!.add(callback);

    return () => {
      const listeners = eventListeners.get('__stream_chunk__');
      if (listeners) {
        listeners.delete(callback);
      }
    };
  },

  /**
   * Stop the current workflow
   */
  stopWorkflow: (): void => {
    ipcRenderer.send('stuard:stopWorkflow');
  },

  /**
   * Log a message (for debugging)
   * @param message - Message to log
   * @param level - Log level
   */
  log: (message: string, level?: 'info' | 'warn' | 'error'): void => {
    ipcRenderer.send('stuard:log', { message, level: level || 'info' });
  },

  /**
   * Set window always on top
   * @param flag - Whether to set always on top
   */
  setAlwaysOnTop: (flag: boolean): void => {
    ipcRenderer.send('stuard:setAlwaysOnTop', flag);
  },

  /**
   * Resize the window
   * @param width - New width
   * @param height - New height
   */
  resize: (width: number, height: number): void => {
    ipcRenderer.send('stuard:resize', { width, height });
  },

  /**
   * Move the window
   * @param x - New x position
   * @param y - New y position
   */
  moveTo: (x: number, y: number): void => {
    ipcRenderer.send('stuard:moveTo', { x, y });
  },

  /**
   * Center the window on screen
   */
  center: (): void => {
    ipcRenderer.send('stuard:center');
  },

  /**
   * Minimize the window
   */
  minimize: (): void => {
    ipcRenderer.send('stuard:minimize');
  },

  /**
   * Get screen information
   */
  getScreenInfo: (): Promise<{
    width: number;
    height: number;
    workArea: { x: number; y: number; width: number; height: number };
  }> => {
    return ipcRenderer.invoke('stuard:getScreenInfo');
  },

});

// Handle variable update events from main process
ipcRenderer.on('stuard:var-update', (_event, data) => {
  const listeners = eventListeners.get('__var_update__');
  if (listeners) {
    listeners.forEach(cb => {
      try {
        cb(data);
      } catch (e) {
        console.error('[stuard] Error in variable update listener:', e);
      }
    });
  }
});

// Handle stream chunk events from main process
ipcRenderer.on('stuard:stream-chunk', (_event, chunk) => {
  const listeners = eventListeners.get('__stream_chunk__');
  if (listeners) {
    listeners.forEach(cb => {
      try {
        cb(chunk);
      } catch (e) {
        console.error('[stuard] Error in stream chunk listener:', e);
      }
    });
  }
});

// Handle page navigation events from main process
ipcRenderer.on('stuard:page-change', (_event, info) => {
  const listeners = eventListeners.get('__page_change__');
  if (listeners) {
    listeners.forEach(cb => {
      try {
        cb(info);
      } catch (e) {
        console.error('[stuard] Error in page change listener:', e);
      }
    });
  }
});

// Also expose a simpler API for quick access
contextBridge.exposeInMainWorld('$stuard', {
  // Shorthand for common operations
  tool: (name: string, args?: any) => ipcRenderer.invoke('stuard:callTool', { tool: name, args: args || {} }),
  node: (nodeId: string, data?: any) => ipcRenderer.invoke('stuard:callNode', { nodeId, data: data || {} }),
  emit: (event: string, data?: any) => ipcRenderer.send('stuard:emit', { event, data }),
  close: (data?: any) => ipcRenderer.send('stuard:close', { data }),
  submit: (data?: any) => ipcRenderer.send('stuard:submit', { data }),
  nav: (page: string, data?: any) => ipcRenderer.send('stuard:navigate', { page, data }),
  setVar: (name: string, value: any, type?: string) => ipcRenderer.invoke('stuard:setVar', { name, value, type }),
  getVar: (name: string) => ipcRenderer.invoke('stuard:getVar', name),
  stream: (streamId: string) => ipcRenderer.invoke('stuard:subscribeStream', { streamId }),
  unstream: (streamId: string, subscriberId: string) => ipcRenderer.invoke('stuard:unsubscribeStream', { streamId, subscriberId }),
});
