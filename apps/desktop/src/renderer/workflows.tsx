/**
 * Workflow Builder - Production-ready visual workflow editor
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { PostHogProvider } from 'posthog-js/react';
import { initPostHog, posthog } from './lib/posthog';
import { supabase } from './lib/supabaseClient';
import { getValidAccessToken } from './auth/authManager';
import { Sparkles, Wrench, FolderOpen, FileCode, BookOpen, Settings, Terminal } from 'lucide-react';
import "./styles.css";
import "./scrollbar.css";

import { useWorkflowChat } from "./workflows/hooks/useWorkflowChat";
import { WorkflowLauncher } from "./workflows/components/WorkflowLauncher";
import { WorkspaceExplorer } from "./workflows/components/WorkspaceExplorer";
import { useWorkflowUiState } from "./workflows/hooks/useWorkflowUiState";
import { useWorkflows } from "./workflows/hooks/useWorkflows";
import { useWorkflowCanvasInteractions } from "./workflows/hooks/useWorkflowCanvasInteractions";
import { useWorkflowKeyboardShortcuts } from "./workflows/hooks/useWorkflowKeyboardShortcuts";
import { useWorkflowMarketplace } from "./workflows/hooks/useWorkflowMarketplace";
import { useWorkflowDeploy } from "./workflows/hooks/useWorkflowDeploy";
import { useWorkflowRuntime } from "./workflows/hooks/useWorkflowRuntime";
import { specToDesignerModel } from "./workflows/utils/conversions";
import { validateDesignerModel, ValidationError } from "./workflows/builder/compiler";
import type { DesignerModel } from "./workflows/types";
import { calculateAutoLayout } from "./workflows/utils/alignment";
import { WorkflowMainContent } from "./workflows/layout/WorkflowMainContent";
import { WorkflowOverlays } from "./workflows/layout/WorkflowOverlays";
import { PanelErrorBoundary } from "./workflows/layout/PanelErrorBoundary";
import { WorkflowHeader } from "./workflows/layout/WorkflowHeader";
import type { OpenFileTab, RightPanel, WorkflowContextMenu, WorkspaceInfo } from "./workflows/layout/types";
import type { ChatInputRef } from "./workflows/components/chat/ChatInput";
import type { ToolPaletteRef } from "./workflows/components/ToolPalette";
import type { ReasoningLevel } from "./hooks/usePreferences";

const CLOUD_AI_HTTP = (window as any).__CLOUD_AI_HTTP__ || (import.meta as any).env?.VITE_CLOUD_AI_URL || "http://127.0.0.1:8082";

function WorkflowsApp() {
  const { items, folders, loading, refresh, updates } = useWorkflows();
  const { logs, setLogs, executionState, runningIds, setRunningIds } = useWorkflowRuntime();
  const [selectedId, setSelectedId] = useState("");
  const [model, setModel] = useState<DesignerModel | null>(null);
  const [dirty, setDirty] = useState(false);

  const [history, setHistory] = useState<DesignerModel[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const isUndoingRef = useRef(false);

  const [viewMode, setViewMode] = useState<'ai' | 'manual' | 'none'>('ai');
  const [rightPanel, setRightPanel] = useState<RightPanel>('none');

  const chatInputRef = useRef<ChatInputRef>(null);
  const toolPaletteRef = useRef<ToolPaletteRef>(null);
  const {
    sidebarCollapsed,
    setSidebarCollapsed,
    aiLeftWidth,
    setAiLeftWidth,
    manualRightWidth,
    setManualRightWidth,
    startResizeAiLeft,
    startResizeManualRight,
  } = useWorkflowUiState();

  const canvasRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [showLogs, setShowLogs] = useState(false);
  const [showRunMenu, setShowRunMenu] = useState(false);

  // Context Menu State - supports both node, canvas, and wire context menus
  const [contextMenu, setContextMenu] = useState<WorkflowContextMenu | null>(null);

  // Credits state
  const [credits, setCredits] = useState<{ remaining: number; limit: number; plan: string } | null>(null);

  // Workspace state
  const [workspaceInfo, setWorkspaceInfo] = useState<WorkspaceInfo | null>(null);
  const [showWorkspace, setShowWorkspace] = useState(false);

  const refreshWorkspace = useCallback(async (id?: string) => {
    const fid = id || selectedId;
    if (!fid) { setWorkspaceInfo(null); return; }
    try {
      const res = await (window as any).desktopAPI?.workflowsGetWorkspaceInfo?.(fid);
      if (res?.ok) setWorkspaceInfo({ workspacePath: res.workspacePath, subdirs: res.subdirs, files: res.files });
      else setWorkspaceInfo(null);
    } catch { setWorkspaceInfo(null); }
  }, [selectedId]);

  // Tab system: 'canvas' = visual editor, file paths = workspace file editors
  const [openTabs, setOpenTabs] = useState<OpenFileTab[]>([]);
  const [activeTab, setActiveTab] = useState<string>('canvas'); // 'canvas' or a filePath

  // Sub-workflow navigation: stack of { path, model } where path is where we came FROM
  // activeSubPath tracks what we're currently editing (null = main workflow)
  const [subWorkflowStack, setSubWorkflowStack] = useState<Array<{ path: string; model: DesignerModel }>>([]);
  const [activeSubPath, setActiveSubPath] = useState<string | null>(null);
  const currentSubPath = activeSubPath; // For prop compatibility

  const openFileTab = useCallback((filePath: string, fileName: string) => {
    setOpenTabs(prev => {
      if (prev.some(t => t.filePath === filePath)) return prev;
      return [...prev, { id: filePath, filePath, fileName }];
    });
    setActiveTab(filePath);
  }, []);

  // Navigate into a .stuard sub-workflow (loads it as a visual canvas)
  const openStuardCanvas = useCallback(async (subPath: string) => {
    if (!selectedId) return;
    // main.stuard → go back to main canvas
    if (subPath === 'main.stuard') {
      // Pop entire stack and restore main model
      if (subWorkflowStack.length > 0) {
        const mainModel = subWorkflowStack[0].model;
        setModel(mainModel);
        setSubWorkflowStack([]);
        setActiveSubPath(null);
      }
      setActiveTab('canvas');
      return;
    }
    // Load the sub-workflow content
    try {
      const res = await (window as any).desktopAPI?.workflowsReadWorkspaceStuard?.(selectedId, subPath);
      if (!res?.ok) {
        console.error('Failed to load sub-workflow:', res?.error);
        return;
      }
      const subModel = JSON.parse(res.content) as DesignerModel;
      // Push current model onto the stack (save it before navigating in)
      if (model) {
        setSubWorkflowStack(prev => [...prev, { path: activeSubPath || 'main.stuard', model }]);
      }
      setModel(subModel);
      setActiveSubPath(subPath); // Track which sub-workflow we're now editing
      setActiveTab('canvas');
      setDirty(false);
    } catch (e) {
      console.error('Failed to open sub-workflow:', e);
    }
  }, [selectedId, model, activeSubPath, subWorkflowStack]);

  // Navigate back to parent workflow
  const navigateBack = useCallback(() => {
    if (subWorkflowStack.length === 0) return;
    const stack = [...subWorkflowStack];
    const parent = stack.pop()!;
    setModel(parent.model);
    setSubWorkflowStack(stack);
    // Set activeSubPath to parent's path (null if back to main)
    setActiveSubPath(parent.path === 'main.stuard' ? null : parent.path);
    setDirty(false);
  }, [subWorkflowStack]);

  // Get breadcrumb path for current navigation state
  const breadcrumbPath = useMemo(() => {
    const crumbs: Array<{ label: string; path: string | null }> = [
      { label: 'Main', path: null }
    ];
    for (const item of subWorkflowStack) {
      if (item.path !== 'main.stuard') {
        crumbs.push({ label: item.path.replace('.stuard', '').split('/').pop() || item.path, path: item.path });
      }
    }
    if (currentSubPath && currentSubPath !== 'main.stuard') {
      // Current location (not clickable)
    }
    return crumbs;
  }, [subWorkflowStack, currentSubPath]);

  const closeFileTab = useCallback((filePath: string) => {
    setOpenTabs(prev => prev.filter(t => t.filePath !== filePath));
    setActiveTab(at => at === filePath ? 'canvas' : at);
  }, []);

  const [workflowChatModelId, setWorkflowChatModelId] = useState<string | 'auto'>(() => {
    try {
      const raw = window.localStorage.getItem('workflow.chat_model_id');
      const v = raw ? String(raw).trim() : 'auto';
      return v ? (v as any) : 'auto';
    } catch {
      return 'auto';
    }
  });
  const [workflowReasoningLevel, setWorkflowReasoningLevel] = useState<ReasoningLevel>(() => {
    try {
      const raw = window.localStorage.getItem('workflow.reasoning_level');
      return raw === 'none' || raw === 'low' || raw === 'medium' || raw === 'high' ? raw : 'high';
    } catch {
      return 'high';
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem('workflow.chat_model_id', String(workflowChatModelId || 'auto'));
    } catch {
    }
  }, [workflowChatModelId]);

  useEffect(() => {
    try {
      window.localStorage.setItem('workflow.reasoning_level', workflowReasoningLevel);
    } catch {
    }
  }, [workflowReasoningLevel]);

  const applyModel = useCallback((m: any) => {
    setModel(m);
    setDirty(true);
  }, []);

  // Update model with history tracking
  const updateModel = useCallback((m: DesignerModel) => {
    if (isUndoingRef.current) {
      // During undo/redo, just update the model without adding to history
      setModel(m);
      setDirty(true);
      return;
    }

    // Add current model to history before updating (if it exists)
    if (model) {
      setHistory(prev => {
        // Truncate any future history (redo states) when making a new change
        const newHistory = prev.slice(0, historyIndex + 1);
        // Add current state to history (limit to 50 states)
        const trimmed = [...newHistory, model].slice(-50);
        return trimmed;
      });
      setHistoryIndex(prev => Math.min(prev + 1, 49));
    }

    setModel(m);
    setDirty(true);
  }, [model, historyIndex]);

  const {
    selectedNodeId,
    setSelectedNodeId,
    selectedNodeIds,
    setSelectedNodeIds,
    connectingFrom,
    setConnectingFrom,
    selectedWireIndex,
    setSelectedWireIndex,
    reconnecting,
    setReconnecting,
    selectionBox,
    alignmentGuides,
    handleDrop,
    handleNodeMouseDown: handleNodeMD,
    handleNodeContextMenu: handleNodeContextMenuInternal,
    handleCanvasContextMenu: handleCanvasContextMenuInternal,
    handleWireContextMenu: handleWireContextMenuInternal,
    handleMouseMove: handleMM,
    handleCanvasMouseDown,
    handleCanvasMouseUp,
    handleCanvasMouseLeave,
    handleNodeSelect,
    handleConnect,
    startReconnect: startReconnectBase,
    clearCanvasSelection,
  } = useWorkflowCanvasInteractions({
    model,
    setModel: (next) => setModel(next),
    updateModel,
    zoom,
    canvasRef,
    setDirty,
  });

  const handleNodeContextMenu = useCallback((id: string, e: React.MouseEvent) => {
    handleNodeContextMenuInternal(id, e, setContextMenu);
  }, [handleNodeContextMenuInternal]);

  const handleCanvasContextMenu = useCallback((e: React.MouseEvent) => {
    handleCanvasContextMenuInternal(e, setContextMenu);
  }, [handleCanvasContextMenuInternal]);

  const handleWireContextMenu = useCallback((wireIndex: number, e: React.MouseEvent) => {
    handleWireContextMenuInternal(wireIndex, e, setContextMenu);
  }, [handleWireContextMenuInternal]);

  const startReconnect = useCallback((wireIndex: number, end: 'from' | 'to') => {
    startReconnectBase(wireIndex, end);
    setContextMenu(null);
  }, [startReconnectBase]);

  const errors = useMemo(() => {
    if (!model) return [] as ValidationError[];
    try {
      return validateDesignerModel(model);
    } catch (e: any) {
      const msg = typeof e?.message === 'string' && e.message.length > 0 ? e.message : 'Validation failed';
      return [{ type: 'error' as const, message: msg }];
    }
  }, [model]);

  const chat = useWorkflowChat({
    model,
    onApplyModel: applyModel,
    cloudAiHttp: CLOUD_AI_HTTP,
    workflowId: selectedId, // Pass workflow ID for session scoping
    errors,
    selectedModelId: workflowChatModelId,
    selectedReasoningLevel: workflowReasoningLevel,
    workspaceInfo,
  });

  // Fetch credits on mount
  useEffect(() => {
    const fetchCredits = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!data?.session?.access_token) return;
        const resp = await fetch(`${CLOUD_AI_HTTP}/v1/credits`, {
          headers: { Authorization: `Bearer ${data.session.access_token}` }
        });
        const j = await resp.json();
        if (j?.ok) setCredits({ remaining: j.remaining || 0, limit: j.limit || 0, plan: j.plan || 'free' });
      } catch { }
    };
    fetchCredits();
    const interval = setInterval(fetchCredits, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, []);

  const load = useCallback(async (id: string) => {
    if (!id) return;
    const res = await (window as any).desktopAPI?.workflowsRead?.(id);
    if (res?.ok) {
      setSelectedId(res.id);
      let loadedModel: DesignerModel | null = null;
      try {
        const parsed = JSON.parse(res.content || '{}');
        // Normalize: allow loading either DesignerModel (nodes/wires) or StuardSpec (steps/next)
        loadedModel = specToDesignerModel({ ...parsed, id: res.id } as any) as any;
      } catch {
        loadedModel = null;
      }
      setModel(loadedModel);
      setDirty(false);
      setSelectedNodeId("");
      setSelectedNodeIds(new Set());
      setSelectedWireIndex(null);
      chat.setMessages([]);
      // Reset undo/redo history for new workflow
      setHistory([]);
      setHistoryIndex(-1);
      // Clear file tabs when switching workflows
      setOpenTabs([]);
      setActiveTab('canvas');
      // If workflow is locked, force manual mode and close panels
      if (loadedModel?.locked) {
        setViewMode('manual');
        setRightPanel('none');
      }
      // Load workspace info and auto-show workspace sidebar
      if (res.isWorkspace) {
        try {
          const wsRes = await (window as any).desktopAPI?.workflowsGetWorkspaceInfo?.(res.id);
          if (wsRes?.ok) {
            setWorkspaceInfo({ workspacePath: wsRes.workspacePath, subdirs: wsRes.subdirs, files: wsRes.files });
            setShowWorkspace(true);
          } else {
            setWorkspaceInfo(null);
          }
        } catch { setWorkspaceInfo(null); }
      } else {
        setWorkspaceInfo(null);
        setShowWorkspace(false);
      }
    }
  }, [chat]);

  const save = useCallback(async () => {
    if (!selectedId || !model) return;
    // If we're in a sub-workflow (activeSubPath is set), save to that file
    if (activeSubPath) {
      const res = await (window as any).desktopAPI?.workflowsSaveWorkspaceStuard?.(
        selectedId,
        activeSubPath,
        JSON.stringify(model, null, 2)
      );
      if (res?.ok) { setDirty(false); } else alert(res?.error || 'Save failed');
    } else {
      // Save main workflow
      const res = await (window as any).desktopAPI?.workflowsSave?.(selectedId, JSON.stringify(model, null, 2));
      if (res?.ok) { setDirty(false); await refresh(); } else alert(res?.error || 'Save failed');
    }
  }, [model, refresh, selectedId, activeSubPath]);

  const {
    showImport,
    setShowImport,
    importJson,
    setImportJson,
    importErr,
    setImportErr,
    showPublish,
    setShowPublish,
    showMarketplace,
    setShowMarketplace,
    marketplaceSlug,
    setMarketplaceSlug,
    showMyPublished,
    setShowMyPublished,
    pendingUpdate,
    setPendingUpdate,
    importJsonWorkflow,
    importFromMarketplace,
    handleUpdateWorkflow,
    executeWorkflowUpdate,
  } = useWorkflowMarketplace({ selectedId, refresh, load });

  const {
    showDeployPanel,
    setShowDeployPanel,
    deployStatus,
    deploy,
    undeploy,
    exportWorkflow,
    cloudVMs,
    selectedVM,
    setSelectedVM,
    cloudDeployState,
    cloudDeployError,
    cloudDeployId,
    deployToCloud,
    resetCloudDeploy,
  } = useWorkflowDeploy({ selectedId, model });

  // Get manual triggers from the model
  const manualTriggers = useMemo(() => {
    if (!model) return [];
    return model.triggers.filter(t => t.type === 'manual');
  }, [model]);

  const run = useCallback(async (triggerId?: string) => {
    if (!selectedId) return;
    setShowRunMenu(false);
    console.log('[Workflows] Running workflow:', selectedId, triggerId ? `(trigger: ${triggerId})` : '(all triggers)');
    setRunningIds(p => ({ ...p, [selectedId]: true }));
    try {
      // Get access token for cloud tool authentication
      const accessToken = await getValidAccessToken() || undefined;
      const res = await (window as any).desktopAPI?.workflowsRun?.(selectedId, triggerId, { accessToken });
      console.log('[Workflows] Run result:', res);
      setRunningIds(p => ({ ...p, [selectedId]: false }));
      if (!res?.ok) {
        alert(res?.error || 'Run failed');
      }
    } catch (e: any) {
      console.error('[Workflows] Run error:', e);
      setRunningIds(p => ({ ...p, [selectedId]: false }));
      alert(e?.message || 'Run failed');
    }
  }, [selectedId]);

  const stop = useCallback(async () => {
    if (!selectedId) return;
    await (window as any).desktopAPI?.workflowsStop?.(selectedId);
    setRunningIds(p => ({ ...p, [selectedId]: false }));
  }, [selectedId]);

  // Run a single step (for testing/debugging)
  const runStep = useCallback(async (nodeId: string) => {
    if (!selectedId || !model) return;
    const node = model.nodes.find(n => n.id === nodeId);
    if (!node) {
      // Check if it's a trigger - can't run triggers as steps
      const trigger = model.triggers.find(t => t.id === nodeId);
      if (trigger) {
        alert('Cannot run a trigger as a step. Triggers only define when a workflow starts.');
        return;
      }
      return;
    }

    console.log('[Workflows] Running single step:', nodeId, node.tool);
    setRunningIds(p => ({ ...p, [selectedId]: true }));

    try {
      const accessToken = await getValidAccessToken() || undefined;
      const res = await (window as any).desktopAPI?.workflowsRunStep?.(selectedId, {
        step: {
          id: node.id,
          tool: node.tool,
          args: node.args || {}
        },
        accessToken
      });
      console.log('[Workflows] Run step result:', res);
      setRunningIds(p => ({ ...p, [selectedId]: false }));
      if (!res?.ok) {
        alert(res?.error || 'Step execution failed');
      }
    } catch (e: any) {
      console.error('[Workflows] Run step error:', e);
      setRunningIds(p => ({ ...p, [selectedId]: false }));
      alert(e?.message || 'Step execution failed');
    }
  }, [selectedId, model]);

  // Run workflow starting from a specific step
  const runFromHere = useCallback(async (nodeId: string) => {
    if (!selectedId || !model) return;

    // Check if it's a trigger
    const trigger = model.triggers.find(t => t.id === nodeId);
    if (trigger) {
      // Run workflow starting from this trigger
      console.log('[Workflows] Running from trigger:', nodeId);
      run(nodeId);
      return;
    }

    const node = model.nodes.find(n => n.id === nodeId);
    if (!node) return;

    console.log('[Workflows] Running from step:', nodeId);
    setRunningIds(p => ({ ...p, [selectedId]: true }));

    try {
      const accessToken = await getValidAccessToken() || undefined;
      const res = await (window as any).desktopAPI?.workflowsRunFromStep?.(selectedId, {
        startStepId: nodeId,
        accessToken
      });
      console.log('[Workflows] Run from step result:', res);
      setRunningIds(p => ({ ...p, [selectedId]: false }));
      if (!res?.ok) {
        alert(res?.error || 'Run failed');
      }
    } catch (e: any) {
      console.error('[Workflows] Run from step error:', e);
      setRunningIds(p => ({ ...p, [selectedId]: false }));
      alert(e?.message || 'Run failed');
    }
  }, [selectedId, model, run]);

  const delNode = useCallback(() => {
    if (!model) return;
    // Prevent deleting nodes in locked workflows
    if (model.locked) return;

    // Determine which nodes to delete: multi-select takes priority, then single select
    const toDelete = selectedNodeIds.size > 0 ? selectedNodeIds : (selectedNodeId ? new Set([selectedNodeId]) : new Set<string>());
    if (toDelete.size === 0) return;

    setHistory(prev => {
      const newHistory = prev.slice(0, historyIndex + 1);
      const trimmed = [...newHistory, model].slice(-50);
      return trimmed;
    });
    setHistoryIndex(prev => Math.min(prev + 1, 49));
    setModel({
      ...model,
      nodes: model.nodes.filter(n => !toDelete.has(n.id)),
      triggers: model.triggers.filter(t => !toDelete.has(t.id)),
      wires: model.wires.filter(w => !toDelete.has(w.from) && !toDelete.has(w.to)),
    });
    setDirty(true);
    setSelectedNodeId("");
    setSelectedNodeIds(new Set());
  }, [selectedNodeId, selectedNodeIds, model, historyIndex]);

  // Undo function - must be before keyboard effect
  const undo = useCallback(() => {
    if (historyIndex < 0 || !history[historyIndex]) return;

    isUndoingRef.current = true;

    // Save current state for redo
    if (model) {
      setHistory(prev => {
        const newHistory = [...prev];
        if (historyIndex + 1 < newHistory.length) {
          newHistory[historyIndex + 1] = model;
        } else {
          newHistory.push(model);
        }
        return newHistory;
      });
    }

    setModel(history[historyIndex]);
    setHistoryIndex(prev => prev - 1);
    setDirty(true);

    setTimeout(() => { isUndoingRef.current = false; }, 0);
  }, [history, historyIndex, model]);

  // Redo function - must be before keyboard effect
  const redo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;

    const nextIndex = historyIndex + 1;
    const nextState = history[nextIndex + 1];

    if (!nextState) return;

    isUndoingRef.current = true;

    setModel(nextState);
    setHistoryIndex(nextIndex + 1);
    setDirty(true);

    setTimeout(() => { isUndoingRef.current = false; }, 0);
  }, [history, historyIndex]);

  // Check if undo/redo are available - must be before keyboard effect
  const canUndo = historyIndex >= 0 && history.length > 0;
  const canRedo = historyIndex < history.length - 1;

  // No longer auto-load first workflow - launcher screen handles selection

  const applyAutoLayoutToModel = useCallback((inputModel: DesignerModel): DesignerModel => {
    const result = calculateAutoLayout(inputModel.triggers, inputModel.nodes, inputModel.wires);
    const newTriggers = inputModel.triggers.map(t => {
      const pos = result.triggers.find(r => r.id === t.id);
      return pos ? { ...t, position: pos.position } : t;
    });
    const newNodes = inputModel.nodes.map(n => {
      const pos = result.nodes.find(r => r.id === n.id);
      return pos ? { ...n, position: pos.position } : n;
    });
    return { ...inputModel, triggers: newTriggers, nodes: newNodes };
  }, []);

  const create = async () => {
    const safe = `flow_${Math.random().toString(36).slice(2, 10)}`;
    const skeleton: DesignerModel = {
      id: safe,
      name: "Hello World Starter",
      version: "1",
      triggers: [{ id: `trig_0`, type: 'manual', label: 'Manual Trigger', args: {}, position: { x: 60, y: 50 } }],
      nodes: [
        {
          id: `step_welcome`,
          type: 'local.tool',
          tool: 'send_notification',
          label: 'Show Welcome Notification',
          args: { title: 'Hello from Stuard', body: 'Your first workflow is running.', severity: 'success' },
          fallbackTo: '',
          position: { x: 60, y: 190 }
        },
        {
          id: `step_now`,
          type: 'local.tool',
          tool: 'get_datetime',
          label: 'Get Current Time',
          args: { format: 'YYYY-MM-DD HH:mm:ss' },
          fallbackTo: '',
          position: { x: 60, y: 330 }
        },
        {
          id: `step_clipboard`,
          type: 'local.tool',
          tool: 'set_clipboard_content',
          label: 'Copy Hello Message',
          args: { text: 'Hello World from Stuard! Ran at {{step_now.formatted}}' },
          fallbackTo: '',
          position: { x: 60, y: 470 }
        },
        {
          id: `step_log`,
          type: 'local.tool',
          tool: 'log',
          label: 'Log Completion',
          args: { message: 'Done! Message copied to clipboard at {{step_now.formatted}}' },
          fallbackTo: '',
          position: { x: 60, y: 610 }
        }
      ],
      wires: [
        { from: 'trig_0', to: 'step_welcome' },
        { from: 'step_welcome', to: 'step_now' },
        { from: 'step_now', to: 'step_clipboard' },
        { from: 'step_clipboard', to: 'step_log' }
      ],
    };
    const arrangedSkeleton = applyAutoLayoutToModel(skeleton);
    try {
      const res = await (window as any).desktopAPI?.workflowsSave?.(safe, JSON.stringify(arrangedSkeleton, null, 2));
      if (res?.ok) {
        await refresh();
        await load(safe);
      } else {
        alert(res?.error || 'Failed to create workflow');
      }
    } catch (e: any) {
      alert(e?.message || 'Failed to create workflow');
    }
  };

  const duplicateNode = useCallback(() => {
    if (!model) return;
    if (model.locked) return;

    // Determine which nodes to duplicate: multi-select takes priority
    const toDuplicate = selectedNodeIds.size > 0 ? selectedNodeIds : (selectedNodeId ? new Set([selectedNodeId]) : new Set<string>());
    if (toDuplicate.size === 0) return;

    // Build ID mapping: old id -> new id
    const idMap = new Map<string, string>();
    let counter = 0;
    for (const oldId of toDuplicate) {
      const item = [...model.triggers, ...model.nodes].find(n => n.id === oldId);
      if (!item) continue;
      const safeKind = item.type.split('.').pop() || 'step';
      idMap.set(oldId, `${safeKind}_${Date.now().toString(36)}${counter > 0 ? counter : ''}`);
      counter++;
    }

    let newTriggers = [...model.triggers];
    let newNodes = [...model.nodes];
    let newWires = [...model.wires];
    const newIds = new Set<string>();

    for (const [oldId, newId] of idMap) {
      const trigger = model.triggers.find(t => t.id === oldId);
      const node = model.nodes.find(n => n.id === oldId);
      const item = trigger || node;
      if (!item) continue;

      const newPos = { x: (item.position?.x || 0) + 40, y: (item.position?.y || 0) + 40 };
      newIds.add(newId);

      if (trigger) {
        newTriggers.push({ ...trigger, id: newId, position: newPos, label: `${trigger.label} (Copy)` });
      } else if (node) {
        newNodes.push({ ...node, id: newId, position: newPos, label: `${node.label} (Copy)` });
      }
    }

    // Duplicate internal wires (wires between duplicated nodes)
    for (const wire of model.wires) {
      if (idMap.has(wire.from) && idMap.has(wire.to)) {
        newWires.push({ ...wire, from: idMap.get(wire.from)!, to: idMap.get(wire.to)! });
      }
    }

    updateModel({ ...model, triggers: newTriggers, nodes: newNodes, wires: newWires });
    setSelectedNodeIds(newIds);
    setSelectedNodeId(newIds.size > 0 ? [...newIds][0] : "");
  }, [selectedNodeId, selectedNodeIds, model, updateModel]);

  useWorkflowKeyboardShortcuts({
    save,
    undo,
    redo,
    duplicateNode,
    run,
    stop,
    delNode,
    updateModel,
    model,
    selectedId,
    runningIds,
    reconnecting,
    setReconnecting,
    selectedNodeId,
    setSelectedNodeId,
    selectedNodeIds,
    setSelectedNodeIds,
    selectedWireIndex,
    setSelectedWireIndex,
    setConnectingFrom,
  });

  // Zoom controls
  const zoomIn = useCallback(() => setZoom(z => Math.min(2, z + 0.1)), []);
  const zoomOut = useCallback(() => setZoom(z => Math.max(0.25, z - 0.1)), []);
  const zoomReset = useCallback(() => setZoom(1), []);

  // Auto-organize layout
  const autoOrganize = useCallback(() => {
    if (!model) return;
    updateModel(applyAutoLayoutToModel(model));
  }, [model, updateModel, applyAutoLayoutToModel]);

  // Handle mouse wheel zoom on canvas
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setZoom(z => Math.min(2, Math.max(0.25, z + delta)));
    }
  }, []);

  const handleCanvasDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleWireSelect = useCallback((i: number) => {
    setSelectedWireIndex(i);
    setSelectedNodeId("");
    setSelectedNodeIds(new Set());
    setRightPanel('inspector');
  }, []);

  const handleNodeSelectWithPanel = useCallback((id: string, e?: React.MouseEvent) => {
    handleNodeSelect(id, e);
    setSelectedWireIndex(null);
    setRightPanel('inspector');
  }, [handleNodeSelect]);

  const handleConnectWithFocus = useCallback((id: string) => {
    handleConnect(id);
    if (viewMode === 'ai') {
      chatInputRef.current?.focus();
    } else {
      toolPaletteRef.current?.focusSearch();
    }
  }, [handleConnect, viewMode]);

  const handleWireDelete = useCallback((i: number) => {
    if (model) updateModel({ ...model, wires: model.wires.filter((_, j) => j !== i) });
    setSelectedWireIndex(null);
  }, [model, updateModel]);

  const size = useMemo(() => {
    const all = [...(model?.triggers || []), ...(model?.nodes || [])];
    const NODE_W = 256;
    const NODE_H = 80;
    const PADDING = 600; // generous padding so nodes never get cut off at edges
    let mx = 3000, my = 2000; // large base canvas for an infinite-feel workspace
    for (const i of all) {
      mx = Math.max(mx, (i.position?.x || 0) + NODE_W + PADDING);
      my = Math.max(my, (i.position?.y || 0) + NODE_H + PADDING);
    }
    return { w: mx, h: my };
  }, [model]);

  const isRunning = runningIds[selectedId];

  // When no workflow is selected, show the launcher
  if (!selectedId || !model) {
    return (
      <div className="h-screen w-screen flex flex-col bg-black overflow-hidden text-slate-200 font-sans">
        <WorkflowLauncher
          items={items}
          loading={loading}
          runningIds={runningIds}
          onSelect={load}
          onCreate={create}
          onImport={() => setShowImport(true)}
          onMarketplace={() => setShowMarketplace(true)}
          onDelete={async (id: string) => {
            await (window as any).desktopAPI?.workflowsDelete?.(id);
            if (selectedId === id) { setSelectedId(""); setModel(null); }
            await refresh();
          }}
          onDashboard={() => (window as any).desktopAPI?.openDashboard?.()}
        />

        <WorkflowOverlays
          contextMenu={null}
          model={null as any}
          selectedNodeIds={new Set()}
          onCloseContextMenu={() => { }}
          onRunStep={() => { }}
          onRunFromHere={() => { }}
          onDuplicateNode={() => { }}
          onDeleteNode={() => { }}
          onStartReconnect={() => { }}
          onEditWire={() => { }}
          onDeleteWire={() => { }}
          onAutoOrganize={() => { }}
          onZoomReset={() => { }}
          onZoomIn={() => { }}
          onZoomOut={() => { }}
          showDeployPanel={false}
          deployStatus={null}
          onCloseDeployPanel={() => { }}
          onDeploy={() => { }}
          onUndeploy={() => { }}
          onExport={() => { }}
          onOpenPublish={() => { }}
          cloudVMs={[]}
          selectedVM={null}
          onSelectVM={() => { }}
          cloudDeployState={'idle'}
          cloudDeployError={null}
          cloudDeployId={null}
          onDeployToCloud={() => { }}
          onResetCloudDeploy={() => { }}
          showImport={showImport}
          importJson={importJson}
          setImportJson={setImportJson}
          importErr={importErr}
          onCloseImport={() => { setShowImport(false); setImportJson(''); setImportErr(''); }}
          onOpenMarketplaceFromImport={() => { setShowImport(false); setShowMarketplace(true); }}
          onImportJson={importJsonWorkflow}
          showPublish={false}
          onClosePublish={() => { }}
          showMarketplace={showMarketplace}
          marketplaceSlug={marketplaceSlug}
          onCloseMarketplace={() => { setShowMarketplace(false); setMarketplaceSlug(undefined); }}
          onImportMarketplace={importFromMarketplace}
          showMyPublished={false}
          onCloseMyPublished={() => { }}
          onOpenPublishFromMyPublished={() => { }}
          pendingUpdate={null}
          currentUpdateWorkflowName=""
          onClosePendingUpdate={() => { }}
          onApplyPendingUpdate={async () => { }}
        />
      </div>
    );
  }

  return (
    <div className="h-screen w-screen relative bg-black overflow-hidden text-slate-200 font-sans">
      <div className="absolute inset-0">
        {/* Main Content Area */}
        <WorkflowMainContent
          selectedId={selectedId}
          model={model}
          loading={loading}
          viewMode={viewMode}
          onSetViewMode={setViewMode}
          aiLeftWidth={aiLeftWidth}
          onStartResizeAiLeft={startResizeAiLeft}
          onResetAiLeftWidth={() => setAiLeftWidth(350)}
          manualRightWidth={manualRightWidth}
          onStartResizeManualRight={startResizeManualRight}
          onResetManualRightWidth={() => setManualRightWidth(320)}
          rightPanel={rightPanel}
          onSetRightPanel={setRightPanel}
          showWorkspace={showWorkspace}
          workspaceInfo={workspaceInfo}
          errors={errors}
          selectedNodeId={selectedNodeId}
          selectedNodeIds={selectedNodeIds}
          connectingFrom={connectingFrom}
          reconnecting={reconnecting}
          executionState={executionState}
          size={size}
          canvasRef={canvasRef}
          alignmentGuides={alignmentGuides}
          zoom={zoom}
          selectedWireIndex={selectedWireIndex}
          selectionBox={selectionBox}
          activeTab={activeTab}
          openTabs={openTabs}
          logs={logs}
          workflowChatModelId={workflowChatModelId}
          workflowReasoningLevel={workflowReasoningLevel}
          chat={chat}
          onApplyModel={applyModel}
          onSetWorkflowChatModelId={setWorkflowChatModelId}
          onSetWorkflowReasoningLevel={setWorkflowReasoningLevel}
          onSetActiveTab={setActiveTab}
          onCloseFileTab={closeFileTab}
          onClearLogs={() => setLogs([])}
          onCanvasMouseDown={handleCanvasMouseDown}
          onWheel={handleWheel}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onZoomReset={zoomReset}
          onAutoOrganize={autoOrganize}
          onDragOver={handleCanvasDragOver}
          onDrop={handleDrop}
          onMouseMove={handleMM}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseLeave}
          onCanvasClick={clearCanvasSelection}
          onNodeSelect={handleNodeSelectWithPanel}
          onNodeMouseDown={handleNodeMD}
          onNodeContextMenu={handleNodeContextMenu}
          onNodeConnect={handleConnectWithFocus}
          onWireSelect={handleWireSelect}
          onWireDelete={handleWireDelete}
          onWireContextMenu={handleWireContextMenu}
          onWireReconnect={startReconnect}
          onCanvasContextMenu={handleCanvasContextMenu}
          onSetSelectedWireIndex={setSelectedWireIndex}
          onUpdateModel={updateModel}
          onDeleteNode={delNode}
          onStartReconnect={startReconnect}
          onRefreshWorkspace={() => refreshWorkspace()}
          onCloseWorkspace={() => setShowWorkspace(false)}
          onOpenFile={openFileTab}
          onOpenStuard={openStuardCanvas}
          chatInputRef={chatInputRef}
          toolPaletteRef={toolPaletteRef}
          breadcrumbs={breadcrumbPath}
          currentSubPath={currentSubPath}
          onNavigateBack={navigateBack}
        />
      </div>

      <WorkflowHeader
        model={model}
        selectedId={selectedId}
        dirty={dirty}
        canUndo={canUndo}
        canRedo={canRedo}
        isRunning={isRunning}
        manualTriggers={manualTriggers}
        showRunMenu={showRunMenu}
        setShowRunMenu={setShowRunMenu}
        deployStatus={deployStatus}
        viewMode={viewMode}
        rightPanel={rightPanel}
        showWorkspace={showWorkspace}
        onSetViewMode={setViewMode}
        onToggleInspector={() => {
          if (!model?.locked) setRightPanel((p) => (p === 'inspector' ? 'none' : 'inspector'));
        }}
        onToggleDocs={() => {
          setRightPanel((p) => (p === 'docs' ? 'none' : 'docs'));
        }}
        onToggleCode={() => {
          if (!model?.locked) setRightPanel((p) => (p === 'code' ? 'none' : 'code'));
        }}
        onSave={save}
        onUndo={undo}
        onRedo={redo}
        onRun={run}
        onStop={stop}
        onToggleDeployPanel={() => setShowDeployPanel((p) => !p)}
        onToggleWorkspace={() => {
          setShowWorkspace((p) => {
            const next = !p;
            if (next) refreshWorkspace();
            return next;
          });
        }}
        onClose={() => {
          setSelectedId("");
          setModel(null);
        }}
      />

      {/* Floating Right Sidebar Menu */}
      {model && (
        <div
          className="absolute right-4 top-1/2 -translate-y-1/2 z-40 flex flex-col items-center justify-center bg-white/[0.06] backdrop-blur-2xl border-white/[0.1] shadow-2xl pointer-events-auto"
          style={{ width: 52, minHeight: 340, gap: 16, borderRadius: 20, padding: 8, borderWidth: 0.4, borderStyle: 'solid' }}
        >
          <button
            onClick={() => {
              if (viewMode === 'ai') {
                setViewMode('none');
                setRightPanel('none');
              } else {
                setViewMode('ai');
                setRightPanel('ai');
              }
            }}
            className={`p-1.5 w-9 h-9 flex items-center justify-center shrink-0 rounded-[12px] transition-all ${viewMode === 'ai' ? 'bg-white/10 text-white' : 'text-white/40 hover:bg-white/10 hover:text-white/80'}`}
            title="Design with AI"
          >
            <Sparkles className="w-5 h-5" />
          </button>
          <button
            onClick={() => {
              if (viewMode === 'manual') {
                setViewMode('none');
                setRightPanel('none');
              } else {
                setViewMode('manual');
                setRightPanel('none');
              }
            }}
            className={`p-1.5 w-9 h-9 flex items-center justify-center shrink-0 rounded-[12px] transition-all ${viewMode === 'manual' ? 'bg-white/10 text-white' : 'text-white/40 hover:bg-white/10 hover:text-white/80'}`}
            title="Manual Build"
          >
            <Wrench className="w-5 h-5" />
          </button>

          <div className="w-6 h-[1.5px] bg-white/[0.15] shrink-0 rounded-full" />

          <button
            onClick={() => {
              if (!model?.locked) {
                setRightPanel((p) => {
                  const next = p === 'logs' ? 'none' : 'logs';
                  if (next !== 'none') setShowWorkspace(false);
                  return next;
                });
              }
            }}
            className={`p-1.5 w-9 h-9 flex items-center justify-center shrink-0 rounded-[12px] transition-all ${rightPanel === 'logs' ? 'bg-white/10 text-white' : 'text-white/40 hover:bg-white/10 hover:text-white/80'}`}
            title="Execution Logs"
          >
            <Terminal className="w-5 h-5" />
          </button>

          <button
            onClick={() => {
              setShowWorkspace((p) => {
                const next = !p;
                if (next) {
                  refreshWorkspace();
                  setRightPanel('none');
                }
                return next;
              });
            }}
            className={`p-1.5 w-9 h-9 flex items-center justify-center shrink-0 rounded-[12px] transition-all ${showWorkspace ? 'bg-white/10 text-white' : 'text-white/40 hover:bg-white/10 hover:text-white/80'}`}
            title="Workspace"
          >
            <FolderOpen className="w-5 h-5" />
          </button>

          <div className="w-6 h-[1.5px] bg-white/[0.15] shrink-0 rounded-full" />

          <button
            onClick={() => {
              if (!model?.locked) {
                setRightPanel((p) => {
                  const next = p === 'code' ? 'none' : 'code';
                  if (next !== 'none') setShowWorkspace(false);
                  return next;
                });
              }
            }}
            className={`p-1.5 w-9 h-9 flex items-center justify-center shrink-0 rounded-[12px] transition-all ${rightPanel === 'code' ? 'bg-white/10 text-white' : 'text-white/40 hover:bg-white/10 hover:text-white/80'}`}
            title="JSON Code"
          >
            <FileCode className="w-5 h-5" />
          </button>
          <button
            onClick={() => {
              setRightPanel((p) => {
                const next = p === 'docs' ? 'none' : 'docs';
                if (next !== 'none') setShowWorkspace(false);
                return next;
              });
            }}
            className={`p-1.5 w-9 h-9 flex items-center justify-center shrink-0 rounded-[12px] transition-all ${rightPanel === 'docs' ? 'bg-white/10 text-white' : 'text-white/40 hover:bg-white/10 hover:text-white/80'}`}
            title="Documentation"
          >
            <BookOpen className="w-5 h-5" />
          </button>
          <button
            onClick={() => {
              if (!model?.locked) {
                setRightPanel((p) => {
                  const next = p === 'inspector' ? 'none' : 'inspector';
                  if (next !== 'none') setShowWorkspace(false);
                  return next;
                });
              }
            }}
            className={`p-1.5 w-9 h-9 flex items-center justify-center shrink-0 rounded-[12px] transition-all ${rightPanel === 'inspector' ? 'bg-white/10 text-white' : 'text-white/40 hover:bg-white/10 hover:text-white/80'}`}
            title="Inspector Settings"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      )}

      <WorkflowOverlays
        contextMenu={contextMenu}
        model={model}
        selectedNodeIds={selectedNodeIds}
        onCloseContextMenu={() => setContextMenu(null)}
        onRunStep={runStep}
        onRunFromHere={runFromHere}
        onDuplicateNode={duplicateNode}
        onDeleteNode={delNode}
        onStartReconnect={startReconnect}
        onEditWire={(wireIndex) => {
          setSelectedWireIndex(wireIndex);
          setRightPanel('inspector');
        }}
        onDeleteWire={handleWireDelete}
        onAutoOrganize={autoOrganize}
        onZoomReset={zoomReset}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        showDeployPanel={showDeployPanel}
        deployStatus={deployStatus}
        onCloseDeployPanel={() => setShowDeployPanel(false)}
        onDeploy={deploy}
        onUndeploy={undeploy}
        onExport={exportWorkflow}
        onOpenPublish={() => setShowPublish(true)}
        cloudVMs={cloudVMs}
        selectedVM={selectedVM}
        onSelectVM={setSelectedVM}
        cloudDeployState={cloudDeployState}
        cloudDeployError={cloudDeployError}
        cloudDeployId={cloudDeployId}
        onDeployToCloud={deployToCloud}
        onResetCloudDeploy={resetCloudDeploy}
        showImport={showImport}
        importJson={importJson}
        setImportJson={setImportJson}
        importErr={importErr}
        onCloseImport={() => { setShowImport(false); setImportJson(''); setImportErr(''); }}
        onOpenMarketplaceFromImport={() => { setShowImport(false); setShowMarketplace(true); }}
        onImportJson={importJsonWorkflow}
        showPublish={showPublish}
        onClosePublish={() => setShowPublish(false)}
        showMarketplace={showMarketplace}
        marketplaceSlug={marketplaceSlug}
        onCloseMarketplace={() => {
          setShowMarketplace(false);
          setMarketplaceSlug(undefined);
        }}
        onImportMarketplace={importFromMarketplace}
        showMyPublished={showMyPublished}
        onCloseMyPublished={() => setShowMyPublished(false)}
        onOpenPublishFromMyPublished={() => {
          setShowMyPublished(false);
          setShowPublish(true);
        }}
        pendingUpdate={pendingUpdate}
        currentUpdateWorkflowName={items.find(i => i.id === pendingUpdate?.id)?.name || pendingUpdate?.id}
        onClosePendingUpdate={() => setPendingUpdate(null)}
        onApplyPendingUpdate={executeWorkflowUpdate}
      />
    </div>
  );
}

initPostHog();
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode><PostHogProvider client={posthog}><PanelErrorBoundary name="WorkflowsApp"><WorkflowsApp /></PanelErrorBoundary></PostHogProvider></React.StrictMode>
);
