import * as fs from 'fs';
import * as path from 'path';
import { BrowserWindow, screen, ipcMain, dialog, clipboard, Notification, app } from 'electron';
import type { RouterContext } from '../tool-router';
import { execTool, execLocalTool } from '../tools/index';
import { onVariableChange, variableStore, setVariable, getVariable, parseStorageKey, composeStorageKey, type VariableEntry } from '../workflow-variables';
import { customUiWindows, windowData } from './state';
import { approvePathForWindow, isPathAllowed, isPathApprovedForWindow } from './security';
import { emitStepEvent } from '../engine/events';
import { interpolateForTool } from '../engine/utils';
import { mousePointToElectronPoint } from './position';

function varNameMatches(storeKey: string, bindName: string): boolean {
  if (storeKey === bindName) return true;
  if (storeKey.endsWith(`.${bindName}`)) return true;
  return false;
}

function broadcastVariableUpdate(name: string, entry: VariableEntry, _previousValue: any): void {
  // Storage keys for scoped vars are `${flowId}::${scope}.${shortName}`.
  // Parse the flowId so we only broadcast to windows owned by the same flow.
  const { flowId: keyFlowId, scopedName } = parseStorageKey(name);
  for (const [id, win] of customUiWindows) {
    if (win.isDestroyed()) continue;
    const wd = windowData.get(id);

    // Scoped vars: only deliver to windows belonging to the owning flow.
    // Legacy unscoped keys (no flowId in key) fall back to entry.flowId, then
    // to broadcast-everywhere for truly global state.
    const ownerFlowId = keyFlowId ?? entry.flowId;
    if (ownerFlowId && wd?.flowId && wd.flowId !== ownerFlowId) continue;

    // If this window explicitly subscribed to this variable, push the update
    const subs = wd?.subscribedVars;
    let shouldSend = false;
    if (subs) {
      for (const sub of subs) {
        if (varNameMatches(scopedName, sub)) {
          shouldSend = true;
          break;
        }
      }
    }

    // Also send to windows that registered '*' (wildcard = all variables)
    if (!shouldSend && subs?.has('*')) {
      shouldSend = true;
    }

    if (shouldSend) {
      try {
        // Strip 'workflow.' prefix for the bind name so `data-var="counter"` matches
        const shortName = scopedName.startsWith('workflow.') ? scopedName.slice('workflow.'.length) : scopedName;
        win.webContents.send('stuard:var-update', {
          name: scopedName,
          shortName,
          value: entry.value,
          type: entry.type,
          updatedAt: entry.updatedAt,
        });
      } catch (e) {
        console.error(`[CUSTOM-UI] Error broadcasting var update to window "${id}":`, e);
      }
    }
  }
}

// Register the global variable change listener
onVariableChange(broadcastVariableUpdate);

let ipcInitialized = false;

export function initCustomUiIpc(getRouterContext: () => RouterContext): void {
  if (ipcInitialized) return;
  ipcInitialized = true;

  // Get window ID
  ipcMain.handle('stuard:getWindowId', event => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;
    for (const [id, w] of customUiWindows) {
      if (w === win) return id;
    }
    return null;
  });

  // Get initial data
  ipcMain.handle('stuard:getData', event => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return {};
    for (const [id, w] of customUiWindows) {
      if (w === win) {
        return windowData.get(id)?.data || {};
      }
    }
    return {};
  });

  // Get flow ID
  ipcMain.handle('stuard:getFlowId', event => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;
    for (const [id, w] of customUiWindows) {
      if (w === win) {
        return windowData.get(id)?.flowId || null;
      }
    }
    return null;
  });

  // Subscribe to workflow variable updates (called by renderer when data-var elements are found)
  ipcMain.handle('stuard:subscribeVars', (event, varNames: string[]) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    for (const [id, w] of customUiWindows) {
      if (w === win) {
        const wd = windowData.get(id);
        if (wd) {
          if (!wd.subscribedVars) wd.subscribedVars = new Set();
          for (const v of varNames) {
            wd.subscribedVars.add(v);
          }
          console.log(`[CUSTOM-UI] Window "${id}" subscribed to vars: [${varNames.join(', ')}]`);
        }
        break;
      }
    }
  });

  // Helper: find the flowId associated with the event's sender window.
  const flowIdForEvent = (event: any): string | undefined => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return undefined;
    for (const [id, w] of customUiWindows) {
      if (w === win) return windowData.get(id)?.flowId || undefined;
    }
    return undefined;
  };

  // Get current value of a workflow variable (for initial rendering of data-var elements)
  ipcMain.handle('stuard:getVar', (event, varName: string) => {
    const flowId = flowIdForEvent(event);
    // Try exact match first (scoped → unscoped), then with workflow. prefix
    const direct = variableStore.get(composeStorageKey(flowId, varName)) ?? variableStore.get(varName);
    const wfName = `workflow.${varName}`;
    const entry = direct
      ?? variableStore.get(composeStorageKey(flowId, wfName))
      ?? variableStore.get(wfName);
    if (entry) {
      return { ok: true, name: varName, value: entry.value, type: entry.type };
    }
    return { ok: false, name: varName, value: undefined };
  });

  // Set a workflow variable directly from custom UI
  ipcMain.handle('stuard:setVar', (event, args: { name: string; value: any; type?: string }) => {
    const { name, value, type } = args || {};
    if (!name) return { ok: false, error: 'missing_variable_name' };
    const flowId = flowIdForEvent(event);

    // Resolve name: prefer flow-scoped lookups, then legacy unscoped, then default to workflow.<name>
    let resolvedName = name;
    if (!name.startsWith('workflow.') && !name.startsWith('local.')) {
      const wfName = `workflow.${name}`;
      const scopedKey = composeStorageKey(flowId, wfName);
      if (variableStore.has(scopedKey) || variableStore.has(wfName)) {
        resolvedName = wfName;
      } else if (!variableStore.has(name)) {
        // Brand-new variable from the UI — default to workflow scope so it
        // shares the same namespace as the rest of the workflow.
        resolvedName = wfName;
      }
    }

    const entry = setVariable(resolvedName, value, type as any, flowId);
    const ctx = getRouterContext();
    ctx.logFn(`[custom_ui] setVar: ${resolvedName} = ${JSON.stringify(entry.value)} (${entry.type})`);
    return { ok: true, name: resolvedName, value: entry.value, type: entry.type };
  });

  // Call a workflow tool
  ipcMain.handle('stuard:callTool', async (_event, { tool, args }) => {
    try {
      const ctx = getRouterContext();
      ctx.logFn(`[custom_ui] Calling tool: ${tool}`);
      const result = await execTool(tool, args, ctx);
      return result;
    } catch (e: any) {
      return { ok: false, error: String(e?.message || 'tool_call_failed') };
    }
  });

  // Call a sibling node in the workflow by its ID
  // This is the core of the node-routing architecture: custom_ui dispatches
  // work to standalone tool nodes (visible in the graph) instead of
  // embedding tool calls inline via callTool.
  ipcMain.handle('stuard:callNode', async (event, { nodeId, data }) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return { ok: false, error: 'window_not_found' };

      // Find this window's data to get the parent workflow
      let winFlowId: string | undefined;
      let winFlowSpec: any;
      let callerStepId: string | undefined;
      let winAccessToken: string | undefined;
      for (const [id, w] of customUiWindows) {
        if (w === win) {
          const wd = windowData.get(id);
          winFlowId = wd?.flowId;
          winFlowSpec = wd?.flowSpec;
          callerStepId = wd?.stepId || id; // Engine step ID or window ID as fallback
          winAccessToken = wd?.accessToken;
          break;
        }
      }

      if (!winFlowId) {
        return { ok: false, error: 'no_parent_workflow — callNode requires the UI to be inside a workflow' };
      }

      // Resolve the target node from the stored spec.
      // Supports matching by step ID (e.g. "step_7ouam3") OR by label
      // (e.g. "Setup DB", "setup_db", "setup-db"). Label matching is
      // case-insensitive with whitespace/underscore/hyphen normalization.
      let targetStep: { id: string; tool?: string; args?: any; label?: string } | undefined;

      const normalizeLabel = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '_').trim();
      const findStep = (steps: any[]) => {
        // First try exact ID match
        let found = steps.find((s: any) => s.id === nodeId);
        if (!found) {
          // Then try exact label match (case-insensitive)
          found = steps.find((s: any) => s.label && s.label.toLowerCase() === nodeId.toLowerCase());
        }
        if (!found) {
          // Then try normalized label match (whitespace/underscore/hyphen agnostic)
          const norm = normalizeLabel(nodeId);
          found = steps.find((s: any) => s.label && normalizeLabel(s.label) === norm);
        }
        return found;
      };

      if (winFlowSpec?.steps) {
        targetStep = findStep(winFlowSpec.steps);
      }

      // If no spec cached (legacy path), try loading it from disk
      if (!targetStep && winFlowId) {
        try {
          const { getWorkflowPathById } = require('../workflows/workflows');
          const flowPath = getWorkflowPathById(winFlowId);
          if (flowPath) {
            const fs = require('fs');
            const raw = JSON.parse(fs.readFileSync(flowPath, 'utf-8'));
            // Handle both formats: .steps[] (engine format) and .nodes[] (editor format)
            const allSteps = raw.steps || raw.nodes || [];
            targetStep = findStep(allSteps);
          }
        } catch (loadErr: any) {
          console.error('[custom_ui] callNode: failed to load workflow spec:', loadErr);
        }
      }

      if (!targetStep) {
        return { ok: false, error: `node_not_found: "${nodeId}" does not exist in workflow "${winFlowId}"` };
      }

      const toolName = targetStep.tool;
      if (!toolName) {
        return { ok: false, error: `node_has_no_tool: "${nodeId}" has no tool defined` };
      }
      const targetStepId = targetStep.id;

      const ctx = getRouterContext();
      // Propagate access token from engine context so cloud tools can authenticate
      if (winAccessToken && !ctx.accessToken) {
        ctx.accessToken = winAccessToken;
      }
      ctx.logFn(`[custom_ui] callNode: ${nodeId} → ${toolName}`);

      // Build args: start with the node's declared args, then merge caller data
      // so templates like {{caller.query}} resolve to the data passed by the UI
      const nodeArgs = { ...(targetStep.args || {}) };

      // Build a proper engine-compatible context for template interpolation.
      // This enables ALL template types (not just {{caller.X}}):
      //   {{caller.field}}        — data passed from the UI
      //   {{caller.nested.path}}  — nested caller data
      //   {{$workspace.data}}     — workspace paths
      //   {{$vars.myVar}}         — workflow variables
      //   {{workflow.myVar}}      — workflow variables (alternate syntax)
      const interpolationCtx: any = {
        caller: data || {},
      };

      // Inject $workspace context (same logic as engine/index.ts)
      try {
        const { getWorkspaceDir } = require('../workflows/workflows');
        const wsDir = getWorkspaceDir(winFlowId);
        if (wsDir) {
          interpolationCtx.$workspace = {
            path: wsDir.replace(/\\/g, '/'),
            data: (wsDir + '/data').replace(/\\/g, '/'),
            scripts: (wsDir + '/scripts').replace(/\\/g, '/'),
            assets: (wsDir + '/assets').replace(/\\/g, '/'),
            id: winFlowId,
          };
        }
      } catch { }

      // Inject $vars and workflow proxies for variable access — scoped to the
      // calling window's workflow so two flows with same-named vars don't mix.
      const winFlowIdForVars = winFlowId;
      const varsProxy: any = new Proxy({}, {
        get(_t: any, prop: any) {
          if (typeof prop !== 'string') return undefined;
          const direct = getVariable(prop, undefined, winFlowIdForVars);
          if (direct !== undefined) return direct;
          return getVariable(`workflow.${prop}`, undefined, winFlowIdForVars);
        },
      });
      const workflowProxy: any = new Proxy({}, {
        get(_t: any, prop: any) {
          if (typeof prop !== 'string') return undefined;
          return getVariable(`workflow.${prop}`, undefined, winFlowIdForVars);
        },
      });
      interpolationCtx.$vars = varsProxy;
      interpolationCtx.workflow = workflowProxy;
      interpolationCtx.$flowId = winFlowIdForVars;

      // Use the engine's battle-tested interpolation which handles:
      //  - Nested templates like {{arr[{{i}}]}}
      //  - Type preservation for single-template values ("{{caller.count}}" → number 5, not string "5")
      //  - Nested object/array walking
      //  - JSON stringification for embedded objects
      const resolvedArgs: any = interpolateForTool(nodeArgs, interpolationCtx, toolName);

      // Also pass caller data wholesale so tools have full context
      resolvedArgs.__caller = data;
      resolvedArgs.flowId = winFlowId;

      // Emit step running event — animates the wire from the custom_ui to the target node
      emitStepEvent(winFlowId, targetStepId, 'running', { wireFromId: callerStepId });

      // ── Special handling: call_function is an engine-internal tool ──
      // It needs the full workflow spec + engine context to execute the function trigger chain.
      // execTool doesn't handle it, so we execute inline here.
      if (toolName === 'call_function') {
        const triggerId = String(resolvedArgs?.triggerId || '').trim();
        const inputs = resolvedArgs?.inputs || {};

        if (!triggerId) {
          emitStepEvent(winFlowId!, targetStepId, 'error', { error: 'missing triggerId' });
          return { ok: false, error: 'missing triggerId for call_function' };
        }

        // Load full workflow model and convert to engine spec
        const { readWorkflowModel, designerModelToStuardSpec } = require('../workflows/workflows');
        const model = readWorkflowModel(winFlowId);
        if (!model) {
          emitStepEvent(winFlowId!, targetStepId, 'error', { error: 'workflow_not_found' });
          return { ok: false, error: `workflow_not_found: ${winFlowId}` };
        }
        const fullSpec = designerModelToStuardSpec(model);

        // Build engine context — use logFlow so logs appear in the workflow's log panel
        const stuardsDir = path.join(app.getPath('userData'), 'stuards');
        const { logFlow } = require('../workflows/workflows');
        const engineCtx = {
          stuardsDir,
          agentWsUrl: ctx.agentWsUrl || '',
          cloudAiUrl: ctx.cloudAiUrl || '',
          logFn: (msg: string) => {
            try { logFlow(winFlowId, msg); } catch { }
            ctx.logFn(msg);
          },
        };

        // Build parent context with $vars (already in interpolationCtx)
        const parentCtx: any = { ...interpolationCtx };

        const { executeFromTrigger } = require('../engine/function-call');
        try {
          const fnResult = await executeFromTrigger(fullSpec, triggerId, inputs, parentCtx, engineCtx);
          emitStepEvent(winFlowId!, targetStepId, fnResult.ok ? 'completed' : 'error', fnResult);
          return fnResult;
        } catch (fnErr: any) {
          emitStepEvent(winFlowId!, targetStepId, 'error', { error: fnErr?.message });
          return { ok: false, error: fnErr?.message || 'call_function failed' };
        }
      }

      try {
        const result = await execTool(toolName, resolvedArgs, ctx);
        // Emit completion — node turns green briefly
        emitStepEvent(winFlowId, targetStepId, 'completed', { result });
        return result;
      } catch (toolErr: any) {
        emitStepEvent(winFlowId, targetStepId, 'error', { error: toolErr?.message });
        throw toolErr;
      }
    } catch (e: any) {
      return { ok: false, error: String(e?.message || 'callNode_failed') };
    }
  });

  // Run script - SECURITY: Disabled for security reasons
  // Arbitrary script execution from custom UIs is too dangerous
  // Use stuard:callTool instead for workflow operations
  ipcMain.handle('stuard:runScript', async (_event, _args) => {
    console.warn('[custom_ui] stuard:runScript is disabled for security. Use stuard:callTool instead.');
    return {
      ok: false,
      error: 'disabled_for_security',
      message: 'runScript is disabled. Use stuard.callTool() for workflow operations.',
    };
  });

  // Update data
  ipcMain.handle('stuard:updateData', (event, updates) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    for (const [id, w] of customUiWindows) {
      if (w === win) {
        const existing = windowData.get(id);
        if (existing) {
          existing.data = { ...existing.data, ...updates };
          // Notify window of data change
          if (!w.isDestroyed()) {
            w.webContents.send('stuard:data-update', existing.data);
          }
        }
        break;
      }
    }
  });

  // Emit event from UI
  ipcMain.on('stuard:emit', (event, { event: eventName, data }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;

    for (const [id, w] of customUiWindows) {
      if (w === win) {
        const ctx = getRouterContext();
        ctx.logFn(`[custom_ui:${id}] Event emitted: ${eventName}`);
        // Could route this to workflow engine if needed
        break;
      }
    }
  });

  // Submit
  ipcMain.on('stuard:submit', (event, { data, keepOpen }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;

    for (const [id, w] of customUiWindows) {
      if (w === win) {
        const winData = windowData.get(id);
        if (winData?.resolve) {
          const mergedData = { ...(winData.data || {}), ...(data || {}) };
          winData.resolve({ ok: true, action: 'submit', data: mergedData });
          winData.resolve = undefined;
        }
        if (!keepOpen && !winData?.keepOpen) {
          try {
            w.close();
          } catch { }
          customUiWindows.delete(id);
          windowData.delete(id);
        }
        break;
      }
    }
  });

  // Action
  ipcMain.on('stuard:action', (event, { action, data }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;

    for (const [id, w] of customUiWindows) {
      if (w === win) {
        const winData = windowData.get(id);
        if (winData?.resolve) {
          const mergedData = { ...(winData.data || {}), ...(data || {}) };
          winData.resolve({ ok: true, action, data: mergedData });
          winData.resolve = undefined;
        }
        // Don't close for generic actions unless it's close/cancel
        const closeActions = ['close', 'cancel', 'exit'];
        if (closeActions.includes(action) && !winData?.keepOpen) {
          try {
            w.close();
          } catch { }
          customUiWindows.delete(id);
          windowData.delete(id);
        }
        break;
      }
    }
  });

  // Close
  ipcMain.on('stuard:close', (event, { data }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;

    for (const [id, w] of customUiWindows) {
      if (w === win) {
        const winData = windowData.get(id);
        if (winData?.resolve) {
          const mergedData = { ...(winData.data || {}), ...(data || {}) };
          winData.resolve({ ok: true, action: 'closed', data: mergedData });
          winData.resolve = undefined;
        }
        try {
          w.close();
        } catch { }
        customUiWindows.delete(id);
        windowData.delete(id);
        break;
      }
    }
  });

  // Navigate to a page (pages system)
  ipcMain.on('stuard:navigate', (event, { page, data }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;

    for (const [id, w] of customUiWindows) {
      if (w === win) {
        const winData = windowData.get(id);
        if (winData) {
          winData.currentPage = page;
          // Merge navigation data into window data
          if (data && typeof data === 'object') {
            winData.data = { ...winData.data, ...data };
          }
        }
        // Bounce back to the renderer so the client-side router can handle it
        if (!w.isDestroyed()) {
          w.webContents.send('stuard:page-change', { page, data });
        }
        const ctx = getRouterContext();
        ctx.logFn(`[custom_ui:${id}] Navigate to page: ${page}`);
        break;
      }
    }
  });

  // Get current page
  ipcMain.handle('stuard:getCurrentPage', event => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;
    for (const [id, w] of customUiWindows) {
      if (w === win) {
        return windowData.get(id)?.currentPage || null;
      }
    }
    return null;
  });

  // Stop workflow
  ipcMain.on('stuard:stopWorkflow', event => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;

    for (const [id, w] of customUiWindows) {
      if (w === win) {
        const winData = windowData.get(id);
        if (winData?.flowId) {
          try {
            const { workflows_stop } = require('../workflows/workflows');
            workflows_stop(winData.flowId);
            const ctx = getRouterContext();
            ctx.logFn(`[custom_ui:${id}] Stopped workflow ${winData.flowId}`);
          } catch (e: any) {
            console.error('[custom_ui] Failed to stop workflow:', e);
          }
        }
        break;
      }
    }
  });

  // Stream subscription — allows custom UI to receive real-time stream chunks (video frames, text tokens, etc.)
  const streamPollers = new Map<string, NodeJS.Timeout>();

  ipcMain.handle('stuard:subscribeStream', async (event, { streamId }) => {
    try {
      const ctx = getRouterContext();
      const subResult = await execLocalTool(
        'stream_subscribe',
        {
          streamId,
          label: `custom_ui_${Date.now()}`,
          fromStart: false,
        },
        ctx
      );

      if (!subResult?.ok || !subResult?.subscriberId) {
        return { ok: false, error: 'subscribe_failed' };
      }

      const subscriberId = subResult.subscriberId;
      const win = BrowserWindow.fromWebContents(event.sender);
      let chunkIndex = 0;

      // Poll for chunks and push to the window
      const poll = async () => {
        if (!win || win.isDestroyed()) {
          clearInterval(pollInterval);
          streamPollers.delete(subscriberId);
          await execLocalTool('stream_unsubscribe', { streamId, subscriberId }, ctx).catch(() => { });
          return;
        }
        try {
          const readResult = await execLocalTool(
            'stream_read',
            {
              streamId,
              subscriberId,
              maxChunks: 50,
              waitMs: 100,
              format: 'base64',
            },
            ctx
          );

          if (readResult?.ok && readResult.chunks?.length > 0) {
            for (const chunk of readResult.chunks) {
              const chunkData = chunk?.data !== undefined ? chunk.data : chunk;
              if (!win.isDestroyed()) {
                win.webContents.send('stuard:stream-chunk', {
                  data: chunkData,
                  index: chunkIndex++,
                  streamId,
                });
              }
            }
          }

          if (readResult?.closed) {
            clearInterval(pollInterval);
            streamPollers.delete(subscriberId);
            if (!win.isDestroyed()) {
              win.webContents.send('stuard:stream-chunk', {
                data: null,
                index: -1,
                streamId,
                closed: true,
              });
            }
          }
        } catch (_e) {
          // Ignore read errors, keep polling
        }
      };

      const pollInterval = setInterval(poll, 50);
      streamPollers.set(subscriberId, pollInterval);

      return { ok: true, subscriberId };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || 'subscribe_failed') };
    }
  });

  ipcMain.handle('stuard:unsubscribeStream', async (_event, { streamId, subscriberId }) => {
    try {
      const interval = streamPollers.get(subscriberId);
      if (interval) {
        clearInterval(interval);
        streamPollers.delete(subscriberId);
      }
      const ctx = getRouterContext();
      await execLocalTool('stream_unsubscribe', { streamId, subscriberId }, ctx);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  // File picker - SECURITY: Approves selected paths for this window
  ipcMain.handle('stuard:pickFile', async (event, options) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const webContentsId = event.sender.id;
    const properties: ('openFile' | 'multiSelections')[] = ['openFile'];
    if (options?.multiple) properties.push('multiSelections');

    const result = await dialog.showOpenDialog(win || (undefined as any), {
      title: options?.title || 'Select File',
      filters: options?.filters || [{ name: 'All Files', extensions: ['*'] }],
      properties,
    });

    // Approve selected paths for this window
    if (!result.canceled && result.filePaths.length > 0) {
      for (const filePath of result.filePaths) {
        approvePathForWindow(webContentsId, filePath);
      }
    }

    return { canceled: result.canceled, filePaths: result.filePaths };
  });

  // Folder picker - SECURITY: Approves selected paths for this window
  ipcMain.handle('stuard:pickFolder', async (event, options) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const webContentsId = event.sender.id;
    const properties: ('openDirectory' | 'multiSelections')[] = ['openDirectory'];
    if (options?.multiple) properties.push('multiSelections');

    const result = await dialog.showOpenDialog(win || (undefined as any), {
      title: options?.title || 'Select Folder',
      properties,
    });

    // Approve selected folders (and their contents) for this window
    if (!result.canceled && result.filePaths.length > 0) {
      for (const folderPath of result.filePaths) {
        approvePathForWindow(webContentsId, folderPath);
      }
    }

    return { canceled: result.canceled, filePaths: result.filePaths };
  });

  // Save dialog - SECURITY: Approves selected path for this window
  ipcMain.handle('stuard:pickSavePath', async (event, options) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const webContentsId = event.sender.id;

    const result = await dialog.showSaveDialog(win || (undefined as any), {
      title: options?.title || 'Save File',
      defaultPath: options?.defaultPath,
      filters: options?.filters || [{ name: 'All Files', extensions: ['*'] }],
    });

    // Approve selected path for this window
    if (!result.canceled && result.filePath) {
      approvePathForWindow(webContentsId, result.filePath);
    }

    return { canceled: result.canceled, filePath: result.filePath };
  });

  // Read file - SECURITY: Restricted to allowed directories or user-approved paths
  ipcMain.handle('stuard:readFile', async (event, { path: filePath, encoding }) => {
    try {
      const webContentsId = event.sender.id;
      const resolved = path.resolve(filePath);

      // Security check: must be in allowed directories or user-approved
      if (!isPathAllowed(resolved) && !isPathApprovedForWindow(webContentsId, resolved)) {
        console.warn(`[custom_ui] File read blocked - not in allowed paths: ${resolved}`);
        throw new Error('Access denied: file is outside allowed directories. Use pickFile() to request access.');
      }

      const content = await fs.promises.readFile(resolved, { encoding: encoding || 'utf-8' });
      return content;
    } catch (e: any) {
      throw new Error(`Failed to read file: ${e?.message}`);
    }
  });

  // Write file - SECURITY: Restricted to allowed directories or user-approved paths
  ipcMain.handle('stuard:writeFile', async (event, { path: filePath, content }) => {
    try {
      const webContentsId = event.sender.id;
      const resolved = path.resolve(filePath);

      // Security check: must be in allowed directories or user-approved
      if (!isPathAllowed(resolved) && !isPathApprovedForWindow(webContentsId, resolved)) {
        console.warn(`[custom_ui] File write blocked - not in allowed paths: ${resolved}`);
        throw new Error('Access denied: file is outside allowed directories. Use pickSavePath() to request access.');
      }

      const dir = path.dirname(resolved);
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(resolved, content, 'utf-8');
    } catch (e: any) {
      throw new Error(`Failed to write file: ${e?.message}`);
    }
  });

  // Notification
  ipcMain.on('stuard:notify', (_event, { title, body }) => {
    try {
      if (Notification.isSupported()) {
        new Notification({ title, body: body || '' }).show();
      }
    } catch { }
  });

  // Clipboard
  ipcMain.handle('stuard:clipboard:write', (_event, text) => {
    clipboard.writeText(String(text || ''));
  });

  ipcMain.handle('stuard:clipboard:read', () => {
    return clipboard.readText();
  });

  // Log
  ipcMain.on('stuard:log', (_event, { message, level: _level }) => {
    const ctx = getRouterContext();
    ctx.logFn(`[custom_ui] ${message}`);
  });

  // Window controls
  ipcMain.on('stuard:setAlwaysOnTop', (event, flag) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      win.setAlwaysOnTop(!!flag);
    }
  });

  ipcMain.on('stuard:resize', (event, { width, height }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      win.setSize(Math.max(100, width), Math.max(50, height));
    }
  });

  ipcMain.on('stuard:moveTo', (event, { x, y }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      const point = mousePointToElectronPoint(Number(x), Number(y));
      win.setPosition(point.x, point.y);
    }
  });

  ipcMain.on('stuard:center', event => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      win.center();
    }
  });

  ipcMain.on('stuard:minimize', event => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      win.minimize();
    }
  });

  ipcMain.handle('stuard:getScreenInfo', () => {
    const display = screen.getPrimaryDisplay();
    return {
      width: display.size.width,
      height: display.size.height,
      workArea: display.workArea,
    };
  });

}
