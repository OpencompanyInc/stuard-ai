/**
 * Custom UI Preload Script
 *
 * Exposes a secure API for custom UI windows to communicate with workflows.
 * This replaces the hacky title-based communication with proper IPC.
 */

import { contextBridge, ipcRenderer } from 'electron';

// Store for event listeners
const eventListeners: Map<string, Set<(data: any) => void>> = new Map();

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
  emit: (event: string, data?: any) => ipcRenderer.send('stuard:emit', { event, data }),
  close: (data?: any) => ipcRenderer.send('stuard:close', { data }),
  submit: (data?: any) => ipcRenderer.send('stuard:submit', { data }),
  nav: (page: string, data?: any) => ipcRenderer.send('stuard:navigate', { page, data }),
});
