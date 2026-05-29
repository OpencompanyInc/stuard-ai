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
import { WorkflowLauncherV2 } from "./workflows/components/WorkflowLauncherV2";
import { ProjectNameModal } from "./workflows/components/ProjectNameModal";
import { WorkspaceExplorer } from "./workflows/components/WorkspaceExplorer";
import { useWorkflowUiState } from "./workflows/hooks/useWorkflowUiState";
import { useWorkflows } from "./workflows/hooks/useWorkflows";
import { useWorkflowCanvasInteractions } from "./workflows/hooks/useWorkflowCanvasInteractions";
import { useWorkflowKeyboardShortcuts } from "./workflows/hooks/useWorkflowKeyboardShortcuts";
import { useWorkflowGroups, type NodeGroup } from "./workflows/hooks/useWorkflowGroups";
import { buildGroupRender, computeCanvasSize, computeContentBBox } from "./workflows/utils/groupGeometry";
import { useWorkflowZoom } from "./workflows/hooks/useWorkflowZoom";
import { WorkflowGroupsProvider, type WorkflowGroupsContextValue } from "./workflows/WorkflowGroupsContext";
import { useWorkflowMarketplace } from "./workflows/hooks/useWorkflowMarketplace";
import { useWorkflowDeploy } from "./workflows/hooks/useWorkflowDeploy";
import { useWorkflowRuntime } from "./workflows/hooks/useWorkflowRuntime";
import { specToDesignerModel } from "./workflows/utils/conversions";
import { validateDesignerModel, ValidationError } from "./workflows/builder/compiler";
import type { DesignerModel } from "./workflows/types";
import { calculateAutoLayout } from "./workflows/utils/alignment";
import { WorkflowMainContent } from "./workflows/layout/WorkflowMainContent";
import { WorkflowOverlays } from "./workflows/layout/WorkflowOverlays";
import { IntegrationBuilderModal } from "./workflows/components/IntegrationBuilderModal";
import { ConfirmDialogHost } from "./workflows/components/ConfirmDialog";
import { PanelErrorBoundary } from "./workflows/layout/PanelErrorBoundary";
import { WorkflowHeader } from "./workflows/layout/WorkflowHeader";
import type { OpenFileTab, RightPanel, WorkflowContextMenu, WorkspaceInfo } from "./workflows/layout/types";
import type { ChatInputRef } from "./workflows/components/chat/ChatInput";
import type { ToolPaletteRef } from "./workflows/components/ToolPalette";
import { usePreferences } from "./hooks/usePreferences";
import type { ReasoningLevel } from "./hooks/usePreferences";
import { WorkflowThemeContext } from "./workflows/WorkflowThemeContext";
import { getWorkflowTemplate } from "./workflows/constants/workflowTemplates";
import {
  buildClipboardPayload,
  readWorkflowClipboard,
  writeWorkflowClipboard,
} from "./workflows/utils/workflowClipboard";
import {
  useWorkflowOnboarding,
  WorkflowWelcomeScreen,
  WorkflowCoach,
  WorkflowSpotlight,
  buildManualOnboardingWorkflow,
  getManualOnboardingValidation,
  getOnboardingStepConfig,
  MANUAL_ONBOARDING_NOTIFICATION_STEP_ID,
  MANUAL_ONBOARDING_SET_VARIABLE_STEP_ID,
  MANUAL_ONBOARDING_TIMESTAMP_STEP_ID,
  MANUAL_ONBOARDING_TRIGGER_ID,
  normalizeManualOnboardingWorkflow,
  runAiDemoSequence,
} from "./workflows/onboarding";

const CLOUD_AI_HTTP = (window as any).__CLOUD_AI_HTTP__ || (import.meta as any).env?.VITE_CLOUD_AI_URL || "http://127.0.0.1:8082";

type LauncherView = 'home' | 'workflows' | 'agents' | 'tools' | 'deployed' | 'shared' | 'marketplace' | 'skills';

function parseLauncherView(value: string | null | undefined): LauncherView | undefined {
  if (
    value === 'home' || value === 'workflows' || value === 'agents' || value === 'tools' ||
    value === 'deployed' || value === 'shared' || value === 'marketplace' || value === 'skills'
  ) {
    return value;
  }
  return undefined;
}

function WorkflowsApp() {
  const { themeMode, modelSource, setModelSource, themeDarkShade, themeLightShade, themeText } = usePreferences();
  const isDark = themeMode === 'dark' || themeMode === 'custom';

  // Workflows is a separate BrowserWindow — sync app theme tokens so theme-* utilities
  // (ModelSelector, etc.) are readable on wf dark surfaces.
  useEffect(() => {
    const root = document.documentElement;
    if (themeMode === 'dark' || themeMode === 'custom') {
      root.setAttribute('data-theme', 'dark');
      root.classList.add('dark');
    } else {
      root.setAttribute('data-theme', 'light');
      root.classList.remove('dark');
    }
    if (themeMode === 'custom') {
      root.style.setProperty('--custom-gradient-start', themeDarkShade);
      root.style.setProperty('--custom-gradient-end', themeLightShade);
      root.style.setProperty('--custom-text-color', themeText === 'white' ? '#ffffff' : '#000000');
    } else {
      root.style.removeProperty('--custom-gradient-start');
      root.style.removeProperty('--custom-gradient-end');
      root.style.removeProperty('--custom-text-color');
    }
  }, [themeMode, themeDarkShade, themeLightShade, themeText]);
  const { items, folders, loading, refresh, updates } = useWorkflows();
  const { logs, setLogs, executionState, runningIds, setRunningIds } = useWorkflowRuntime();
  const [selectedId, setSelectedId] = useState("");
  const [launcherView, setLauncherView] = useState<LauncherView>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      return parseLauncherView(params.get('view')) || 'home';
    } catch {
      return 'home';
    }
  });
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

  const onboarding = useWorkflowOnboarding();
  const currentStepConfig = onboarding.stepId
    ? getOnboardingStepConfig(onboarding.track, onboarding.stepId)
    : null;
  const aiDemoCleanupRef = useRef<(() => void) | null>(null);
  const onboardingRunLogBaselineRef = useRef(0);
  const onboardingRunObservedRef = useRef(false);
  const previousOnboardingStepRef = useRef<string | null>(null);

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
        // Keep undo useful without retaining dozens of full workflow snapshots.
        const trimmed = [...newHistory, model].slice(-20);
        return trimmed;
      });
      setHistoryIndex(prev => Math.min(prev + 1, 19));
    }

    setModel(m);
    setDirty(true);
  }, [model, historyIndex]);

  // ── Editor-only visual node groups (sidecar; never sent to engine/AI) ──
  const groupsApi = useWorkflowGroups(selectedId, model);

  const getContentBBox = useCallback(() => {
    if (!model) return null;
    return computeContentBBox(model, buildGroupRender(groupsApi.groups, model));
  }, [model, groupsApi.groups]);

  const { zoom, zoomIn, zoomOut, zoomReset, fitToView, bindWheelTarget } = useWorkflowZoom({
    canvasRef,
    getContentBBox,
  });

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
    selectedModelSource: modelSource,
    selectedReasoningLevel: workflowReasoningLevel,
    workspaceInfo,
  });

  // Deep-link state — the effects that consume `load` live further down,
  // after `load` is declared, to avoid the TDZ trap.
  const pendingDeepLinkRef = useRef<string | null>(null);

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
      // Clear logs from previous workflow
      setLogs([]);
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
            setViewMode('none');
            setRightPanel('none');
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

  // Deep-link: open a specific workflow on launch (?workflowId=...) or when
  // the host sends a `workflows:navigate` IPC with a workflowId. Used by the
  // chat-side "Open in Studio" button after a workflow subagent finishes.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialId = params.get('workflowId');
    const initialView = parseLauncherView(params.get('view'));
    if (initialId) pendingDeepLinkRef.current = initialId;
    if (initialView) setLauncherView(initialView);

    const unsub = (window as any).desktopAPI?.onWorkflowsNavigate?.((d: any) => {
      if (d?.view) {
        const nextView = parseLauncherView(String(d.view));
        if (nextView) setLauncherView(nextView);
      }
      if (d?.workflowId) {
        pendingDeepLinkRef.current = String(d.workflowId);
        if (items.some((it: any) => it.id === d.workflowId)) {
          load(String(d.workflowId));
          pendingDeepLinkRef.current = null;
        } else {
          refresh();
        }
      }
    });
    return () => { try { unsub?.(); } catch {} };
  }, [items, load, refresh]);

  useEffect(() => {
    const pending = pendingDeepLinkRef.current;
    if (!pending) return;
    if (items.some((it: any) => it.id === pending)) {
      load(pending);
      pendingDeepLinkRef.current = null;
    }
  }, [items, load]);

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

  const [showNameModal, setShowNameModal] = useState(false);
  const [createTemplateId, setCreateTemplateId] = useState<string>("blank");

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

  // Custom-integration builder (test phase — drafts in localStorage, executor on cloud-ai)
  const [showIntegrationBuilder, setShowIntegrationBuilder] = useState(false);
  // When set, the builder opens seeded with this deployed integration's manifest (edit flow).
  const [integrationSeed, setIntegrationSeed] = useState<any | null>(null);
  const openIntegrationBuilder = useCallback((seedManifest?: any) => {
    setIntegrationSeed(seedManifest ?? null);
    setShowIntegrationBuilder(true);
  }, []);

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

  const runWorkflowById = useCallback(async (workflowId: string, triggerId?: string) => {
    if (!workflowId) return;
    setShowRunMenu(false);
    console.log('[Workflows] Running workflow:', workflowId, triggerId ? `(trigger: ${triggerId})` : '(all triggers)');
    setRunningIds(p => ({ ...p, [workflowId]: true }));
    try {
      const accessToken = await getValidAccessToken() || undefined;
      const res = await (window as any).desktopAPI?.workflowsRun?.(workflowId, triggerId, { accessToken });
      console.log('[Workflows] Run result:', res);
      setRunningIds(p => ({ ...p, [workflowId]: false }));
      if (!res?.ok) {
        alert(res?.error || 'Run failed');
      }
    } catch (e: any) {
      console.error('[Workflows] Run error:', e);
      setRunningIds(p => ({ ...p, [workflowId]: false }));
      alert(e?.message || 'Run failed');
    }
  }, [setRunningIds]);

  const stopWorkflowById = useCallback(async (workflowId: string) => {
    if (!workflowId) return;
    await (window as any).desktopAPI?.workflowsStop?.(workflowId);
    setRunningIds(p => ({ ...p, [workflowId]: false }));
  }, [setRunningIds]);

  const run = useCallback(async (triggerId?: string) => {
    if (!selectedId) return;
    // Workflows run from the on-disk file, so any pending edits must be saved
    // first or they'd be silently ignored. Auto-save when dirty so Run always
    // reflects what the user sees on the canvas.
    if (dirty) {
      await save();
    }
    await runWorkflowById(selectedId, triggerId);
  }, [runWorkflowById, selectedId, dirty, save]);

  const stop = useCallback(async () => {
    if (!selectedId) return;
    await stopWorkflowById(selectedId);
  }, [selectedId, stopWorkflowById]);

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
    if (dirty) await save();
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
  }, [selectedId, model, dirty, save]);

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
    if (dirty) await save();
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
  }, [selectedId, model, run, dirty, save]);

  const delNode = useCallback(() => {
    if (!model) return;
    // Prevent deleting nodes in locked workflows
    if (model.locked) return;

    // Determine which nodes to delete: multi-select takes priority, then single select
    const toDelete = selectedNodeIds.size > 0 ? selectedNodeIds : (selectedNodeId ? new Set([selectedNodeId]) : new Set<string>());
    if (toDelete.size === 0) return;

    setHistory(prev => {
      const newHistory = prev.slice(0, historyIndex + 1);
      const trimmed = [...newHistory, model].slice(-20);
      return trimmed;
    });
    setHistoryIndex(prev => Math.min(prev + 1, 19));
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

  const createFromModel = useCallback(async (skeleton: DesignerModel): Promise<string | null> => {
    const arrangedSkeleton = applyAutoLayoutToModel(skeleton);
    try {
      const res = await (window as any).desktopAPI?.workflowsSave?.(skeleton.id, JSON.stringify(arrangedSkeleton, null, 2));
      if (res?.ok) {
        await refresh();
        await load(skeleton.id);
        return skeleton.id;
      }
      alert(res?.error || 'Failed to create workflow');
    } catch (e: any) {
      alert(e?.message || 'Failed to create workflow');
    }
    return null;
  }, [applyAutoLayoutToModel, load, refresh]);

  const create = useCallback(async (projectName?: string, templateId?: string): Promise<string | null> => {
    const safe = `flow_${Math.random().toString(36).slice(2, 10)}`;
    const template = getWorkflowTemplate(templateId);
    const skeleton = template.build(safe, projectName || template.defaultName);
    return createFromModel(skeleton);
  }, [createFromModel]);

  // Begin the AI demo tour. Always creates a fresh blank workflow so the demo
  // sequence has a clean slate (we don't want to overwrite an existing one),
  // enters AI mode, then runs the fake chat exchange + demo model apply. No
  // network calls and no credits used — see runAiDemoSequence for the script.
  const beginAiTour = useCallback(async () => {
    // Tear down any previous demo run that's still in flight.
    aiDemoCleanupRef.current?.();
    aiDemoCleanupRef.current = null;

    const workflowId = await create(undefined, "blank");
    if (!workflowId) return;
    setViewMode("ai");
    setRightPanel("ai");
    onboarding.beginAiTour();

    // After the new workflow mounts, kick off the fake sequence. We give React
    // a moment so the AI panel is on screen before the messages stream in.
    setTimeout(() => {
      aiDemoCleanupRef.current = runAiDemoSequence({
        chat: { setMessages: chat.setMessages, setBusy: chat.setBusy },
        applyModel,
        workflowId: workflowId || selectedId || `flow_demo_${Math.random().toString(36).slice(2, 8)}`,
        workflowName: "Tour Demo Workflow",
      });
    }, 350);
  }, [onboarding, create, chat.setMessages, chat.setBusy, applyModel, selectedId]);

  // Begin the manual tour. Same shell setup (fresh workflow), but enters manual
  // mode so the user actually drags + wires nodes themselves. Always creates a
  // new workflow so we never dirty an existing one the user opened.
  const beginManualTour = useCallback(async () => {
    aiDemoCleanupRef.current?.();
    aiDemoCleanupRef.current = null;

    const safe = `flow_${Math.random().toString(36).slice(2, 10)}`;
    const workflowId = await createFromModel(buildManualOnboardingWorkflow(safe, "Task Ping Tour"));
    if (!workflowId) return;
    setViewMode("manual");
    setRightPanel("none");
    onboarding.beginManualTour();
  }, [createFromModel, onboarding]);

  // Make sure we cancel any pending fake-demo timers if the user skips out.
  useEffect(() => {
    if (onboarding.phase !== "guided" || onboarding.track !== "ai") {
      aiDemoCleanupRef.current?.();
      aiDemoCleanupRef.current = null;
    }
  }, [onboarding.phase, onboarding.track]);

  // During the manual tour, keep the starter workflow focused on the lesson:
  // variables are created up front, and the notification the user drags in gets
  // templated so it actually consumes both workflow vars and a previous step.
  useEffect(() => {
    if (onboarding.phase !== "guided" || onboarding.track !== "manual") return;
    if (!model || model.locked) return;
    if (!model.nodes.some((node) => node.tool === "send_notification")) return;
    const normalized = normalizeManualOnboardingWorkflow(model);
    if (normalized !== model) updateModel(normalized);
  }, [model, onboarding.phase, onboarding.track, updateModel]);

  const manualOnboardingValidation = useMemo(
    () => getManualOnboardingValidation(model),
    [model]
  );

  const currentStepGate = useMemo(() => {
    if (!currentStepConfig?.manualAction) return { canAdvance: true, blockedHint: "" };
    if (onboarding.track !== "manual") return { canAdvance: true, blockedHint: "" };

    switch (currentStepConfig.id) {
      case "variables":
        if (rightPanel !== "inspector") {
          return { canAdvance: false, blockedHint: "Open Inspector so the workflow variables are visible." };
        }
        if (selectedNodeId) {
          return { canAdvance: false, blockedHint: "Click empty canvas so Workflow Variables are shown instead of a node." };
        }
        if (!manualOnboardingValidation.variablesReady) {
          return {
            canAdvance: false,
            blockedHint: "Keep notificationTitle, taskName, and taskOwner as workflow text variables with values.",
          };
        }
        return { canAdvance: true, blockedHint: "" };
      case "timestampArgs":
        if (rightPanel !== "inspector" || selectedNodeId !== MANUAL_ONBOARDING_TIMESTAMP_STEP_ID) {
          return { canAdvance: false, blockedHint: "Select Get Current Time and keep Inspector open." };
        }
        if (!manualOnboardingValidation.timestampReady) {
          return { canAdvance: false, blockedHint: "The time step needs the tour's format argument so formatted output exists." };
        }
        return { canAdvance: true, blockedHint: "" };
      case "setVariableArgs":
        if (rightPanel !== "inspector" || selectedNodeId !== MANUAL_ONBOARDING_SET_VARIABLE_STEP_ID) {
          return { canAdvance: false, blockedHint: "Select Store Start Time and keep Inspector open." };
        }
        if (!manualOnboardingValidation.setVariableReady) {
          return {
            canAdvance: false,
            blockedHint: "Store Start Time must set startedAt to {{step_timestamp.formatted}} with workflow scope.",
          };
        }
        return { canAdvance: true, blockedHint: "" };
      case "notificationArgs":
        if (!manualOnboardingValidation.notificationNodeExists) {
          return { canAdvance: false, blockedHint: "Add Send Notification from the palette first." };
        }
        if (rightPanel !== "inspector" || selectedNodeId !== MANUAL_ONBOARDING_NOTIFICATION_STEP_ID) {
          return { canAdvance: false, blockedHint: "Select Send Task Ping and keep Inspector open." };
        }
        if (!manualOnboardingValidation.notificationArgsReady) {
          return {
            canAdvance: false,
            blockedHint: "The title/body must use the workflow variables, including {{workflow.startedAt}}.",
          };
        }
        return { canAdvance: true, blockedHint: "" };
      case "save":
        if (!manualOnboardingValidation.readyToRun) {
          return { canAdvance: false, blockedHint: "Finish the variables, checked args, and both wires before saving." };
        }
        return { canAdvance: true, blockedHint: "" };
      default:
        return { canAdvance: true, blockedHint: "" };
    }
  }, [
    currentStepConfig?.id,
    currentStepConfig?.manualAction,
    onboarding.track,
    rightPanel,
    selectedNodeId,
    manualOnboardingValidation,
  ]);

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

  // Track the last mouse position over the canvas so paste can drop nodes
  // near where the user is looking. Falls back to a +40 offset from origin.
  const lastCanvasPointRef = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      lastCanvasPointRef.current = {
        x: (e.clientX - rect.left + el.scrollLeft) / zoom,
        y: (e.clientY - rect.top + el.scrollTop) / zoom,
      };
    };
    el.addEventListener("mousemove", onMove);
    return () => el.removeEventListener("mousemove", onMove);
  }, [zoom, model]);

  const copyNodes = useCallback(async () => {
    if (!model) return;
    const ids = selectedNodeIds.size > 0
      ? selectedNodeIds
      : (selectedNodeId ? new Set([selectedNodeId]) : new Set<string>());
    if (ids.size === 0) return;
    const triggers = model.triggers.filter(t => ids.has(t.id));
    const nodes = model.nodes.filter(n => ids.has(n.id));
    // Only carry wires whose endpoints are both inside the selection.
    const wires = model.wires.filter(w => ids.has(w.from) && ids.has(w.to));
    await writeWorkflowClipboard(buildClipboardPayload(triggers, nodes, wires));
  }, [model, selectedNodeId, selectedNodeIds]);

  const cutNodes = useCallback(async () => {
    if (!model || model.locked) return;
    await copyNodes();
    delNode();
  }, [model, copyNodes, delNode]);

  const pasteNodes = useCallback(async () => {
    if (!model || model.locked) return;
    const payload = await readWorkflowClipboard();
    if (!payload) return;
    const totalSrc = [...payload.triggers, ...payload.nodes];
    if (totalSrc.length === 0) return;

    // Normalize source positions so the paste anchors at the cursor
    // (or origin + 40,40 if cursor is unknown). Without normalizing,
    // cross-workflow pastes would land wherever the source workflow
    // had the nodes — often off-screen.
    let minX = Infinity, minY = Infinity;
    for (const item of totalSrc) {
      minX = Math.min(minX, item.position?.x ?? 0);
      minY = Math.min(minY, item.position?.y ?? 0);
    }
    if (!isFinite(minX)) minX = 0;
    if (!isFinite(minY)) minY = 0;
    const anchor = lastCanvasPointRef.current ?? { x: minX + 40, y: minY + 40 };
    const dx = anchor.x - minX;
    const dy = anchor.y - minY;

    // Remap source IDs to fresh ones so nothing collides with existing nodes
    // (including the case where the user pastes back into the same workflow).
    const idMap = new Map<string, string>();
    const stamp = Date.now().toString(36);
    let counter = 0;
    const mintId = (kind: string) => {
      const safeKind = String(kind || "step").replace(/\./g, "_").split(".").pop() || "step";
      const suffix = counter === 0 ? "" : String(counter);
      counter++;
      return `${safeKind}_${stamp}${suffix}`;
    };
    for (const t of payload.triggers) idMap.set(t.id, mintId(t.type || "trigger"));
    for (const n of payload.nodes) idMap.set(n.id, mintId(n.type || "step"));

    const newTriggers = payload.triggers.map(t => ({
      ...t,
      id: idMap.get(t.id)!,
      position: { x: Math.max(0, (t.position?.x ?? 0) + dx), y: Math.max(0, (t.position?.y ?? 0) + dy) },
    }));
    const newNodes = payload.nodes.map(n => ({
      ...n,
      id: idMap.get(n.id)!,
      // fallbackTo may point to another copied node — rewrite when possible,
      // otherwise drop it so we don't leave a dangling reference.
      fallbackTo: n.fallbackTo ? (idMap.get(n.fallbackTo) ?? "") : n.fallbackTo,
      position: { x: Math.max(0, (n.position?.x ?? 0) + dx), y: Math.max(0, (n.position?.y ?? 0) + dy) },
    }));
    const newWires = payload.wires
      .filter(w => idMap.has(w.from) && idMap.has(w.to))
      .map(w => ({ ...w, from: idMap.get(w.from)!, to: idMap.get(w.to)! }));

    updateModel({
      ...model,
      triggers: [...model.triggers, ...newTriggers],
      nodes: [...model.nodes, ...newNodes],
      wires: [...model.wires, ...newWires],
    });

    const pastedIds = new Set([...newTriggers.map(t => t.id), ...newNodes.map(n => n.id)]);
    setSelectedNodeIds(pastedIds);
    setSelectedNodeId(pastedIds.size > 0 ? [...pastedIds][0] : "");
    setSelectedWireIndex(null);
  }, [model, updateModel, setSelectedNodeIds, setSelectedNodeId, setSelectedWireIndex]);

  const moveGroupBy = useCallback((groupId: string, dx: number, dy: number) => {
    if (!model) return;
    const g = groupsApi.groups.find((x) => x.id === groupId);
    if (!g) return;
    const ids = new Set(g.memberIds);
    updateModel({
      ...model,
      triggers: model.triggers.map((t) => (ids.has(t.id) ? { ...t, position: { x: t.position.x + dx, y: t.position.y + dy } } : t)),
      nodes: model.nodes.map((n) => (ids.has(n.id) ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } } : n)),
    });
  }, [model, groupsApi.groups, updateModel]);
  const selectGroupMembers = useCallback((g: NodeGroup) => {
    setSelectedNodeIds(new Set(g.memberIds));
    setSelectedNodeId(g.memberIds[0] || "");
  }, [setSelectedNodeIds, setSelectedNodeId]);
  const groupCtxValue = useMemo<WorkflowGroupsContextValue>(
    () => ({ ...groupsApi, moveGroupBy, selectGroup: selectGroupMembers }),
    [groupsApi, moveGroupBy, selectGroupMembers],
  );

  useWorkflowKeyboardShortcuts({
    save,
    undo,
    redo,
    duplicateNode,
    copyNodes,
    cutNodes,
    pasteNodes,
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
    onGroup: () => {
      if (selectedNodeIds.size < 2) return;
      const id = groupsApi.createGroup(Array.from(selectedNodeIds));
      if (id) groupsApi.setCollapsed(id, true);
    },
    onUngroup: () => {
      const g = groupsApi.groups.find(
        (gr) => gr.memberIds.length === selectedNodeIds.size && gr.memberIds.every((m) => selectedNodeIds.has(m)),
      );
      if (g) groupsApi.ungroup(g.id);
    },
    onZoomIn: zoomIn,
    onZoomOut: zoomOut,
    onZoomReset: zoomReset,
    onZoomFit: fitToView,
  });

  // Auto-organize layout. Group-aware: each visual group is laid out as a SINGLE
  // proxy node (so collapsed members don't scatter and blow up the group's
  // bounding box), then members are placed back relative to the proxy.
  const autoOrganize = useCallback(() => {
    if (!model) return;
    const groups = groupsApi.groups.filter((g) => g.memberIds.length >= 2);
    if (groups.length === 0) {
      updateModel(applyAutoLayoutToModel(model));
      return;
    }

    const NODE_W = 256;
    const ROW_GAP = 40;

    const memberToGroup = new Map<string, NodeGroup>();
    for (const g of groups) for (const id of g.memberIds) memberToGroup.set(id, g);
    const proxyId = (g: NodeGroup) => `__grp_${g.id}`;
    const eff = (id: string) => {
      const g = memberToGroup.get(id);
      return g ? proxyId(g) : id;
    };

    const triggerIdSet = new Set(model.triggers.map((t) => t.id));

    // Contracted graph: ungrouped items as-is + one proxy per group.
    const cTriggers = model.triggers.filter((t) => !memberToGroup.has(t.id)).map((t) => ({ id: t.id, position: t.position }));
    const cNodes = model.nodes.filter((n) => !memberToGroup.has(n.id)).map((n) => ({ id: n.id, position: n.position }));
    for (const g of groups) {
      const allTriggers = g.memberIds.every((id) => triggerIdSet.has(id));
      const proxy = { id: proxyId(g), position: { x: 0, y: 0 } };
      if (allTriggers) cTriggers.push(proxy);
      else cNodes.push(proxy);
    }

    // Contracted wires: remap endpoints to proxies, drop internal wires, dedup.
    const seen = new Set<string>();
    const cWires: Array<{ from: string; to: string; stream?: any }> = [];
    for (const w of model.wires) {
      const from = eff(w.from);
      const to = eff(w.to);
      if (from === to) continue;
      const key = `${from}->${to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      cWires.push({ from, to, stream: (w as any).stream });
    }

    const result = calculateAutoLayout(cTriggers, cNodes, cWires);
    const posById = new Map<string, { x: number; y: number }>();
    for (const r of result.triggers) posById.set(r.id, r.position);
    for (const r of result.nodes) posById.set(r.id, r.position);

    const place = (id: string, fallback: { x: number; y: number }) => {
      const g = memberToGroup.get(id);
      if (!g) return posById.get(id) ?? fallback;
      const base = posById.get(proxyId(g)) ?? fallback;
      // Collapsed: stack members at the proxy spot so the tile stays compact.
      if (g.collapsed) return { x: base.x, y: base.y };
      // Expanded: lay members out in a compact row anchored at the proxy.
      const idx = Math.max(0, g.memberIds.indexOf(id));
      return { x: base.x + idx * (NODE_W + ROW_GAP), y: base.y };
    };

    updateModel({
      ...model,
      triggers: model.triggers.map((t) => ({ ...t, position: place(t.id, t.position) })),
      nodes: model.nodes.map((n) => ({ ...n, position: place(n.id, n.position) })),
    });
  }, [model, groupsApi.groups, updateModel, applyAutoLayoutToModel]);

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
    if (!model) return { w: 4000, h: 3000 };
    const gr = buildGroupRender(groupsApi.groups, model);
    return computeCanvasSize(model, gr);
  }, [model, groupsApi.groups]);

  const isRunning = runningIds[selectedId];

  useEffect(() => {
    if (onboarding.phase !== "guided" || onboarding.track !== "manual") return;

    if (onboarding.stepId === "variables") {
      setSelectedNodeId("");
      setSelectedNodeIds(new Set());
      setSelectedWireIndex(null);
      setRightPanel("inspector");
      return;
    }

    if (onboarding.stepId === "timestampArgs") {
      setSelectedNodeId(MANUAL_ONBOARDING_TIMESTAMP_STEP_ID);
      setSelectedNodeIds(new Set([MANUAL_ONBOARDING_TIMESTAMP_STEP_ID]));
      setSelectedWireIndex(null);
      setRightPanel("inspector");
      return;
    }

    if (onboarding.stepId === "setVariableArgs") {
      setSelectedNodeId(MANUAL_ONBOARDING_SET_VARIABLE_STEP_ID);
      setSelectedNodeIds(new Set([MANUAL_ONBOARDING_SET_VARIABLE_STEP_ID]));
      setSelectedWireIndex(null);
      setRightPanel("inspector");
      return;
    }

    if (onboarding.stepId === "notificationArgs" && manualOnboardingValidation.notificationNodeExists) {
      setSelectedNodeId(MANUAL_ONBOARDING_NOTIFICATION_STEP_ID);
      setSelectedNodeIds(new Set([MANUAL_ONBOARDING_NOTIFICATION_STEP_ID]));
      setSelectedWireIndex(null);
      setRightPanel("inspector");
      return;
    }

    if (
      onboarding.stepId === "wire"
      || onboarding.stepId === "storeWire"
      || onboarding.stepId === "palette"
      || onboarding.stepId === "notifyWire"
    ) {
      setSelectedWireIndex(null);
      setRightPanel("none");
    }
  }, [
    onboarding.phase,
    onboarding.track,
    onboarding.stepId,
    manualOnboardingValidation.notificationNodeExists,
    setSelectedNodeId,
    setSelectedNodeIds,
    setSelectedWireIndex,
  ]);

  useEffect(() => {
    if (previousOnboardingStepRef.current === onboarding.stepId) return;
    previousOnboardingStepRef.current = onboarding.stepId;
    if (onboarding.stepId === "run") {
      onboardingRunLogBaselineRef.current = logs.length;
      onboardingRunObservedRef.current = false;
    }
  }, [onboarding.stepId, logs.length]);

  // Onboarding: AI advances once its generated demo nodes appear. Manual
  // advances the palette step only after the user adds Send Notification.
  useEffect(() => {
    if (onboarding.stepId === "describe" && model?.nodes?.length) {
      onboarding.advance();
      return;
    }
    if (onboarding.stepId !== "palette") return;
    if (model?.nodes?.some((node) => node.tool === "send_notification")) {
      onboarding.advance();
    }
  }, [onboarding.stepId, model?.nodes, onboarding]);

  // Onboarding: manual wiring checks for the specific lesson wires so the final
  // workflow actually passes timestamp output into the notification step.
  useEffect(() => {
    if (onboarding.stepId === "wire") {
      const hasTriggerToTimestamp = model?.wires?.some(
        (wire) =>
          wire.from === MANUAL_ONBOARDING_TRIGGER_ID
          && wire.to === MANUAL_ONBOARDING_TIMESTAMP_STEP_ID
      );
      if (hasTriggerToTimestamp) onboarding.advance();
      return;
    }
    if (onboarding.stepId === "storeWire") {
      if (manualOnboardingValidation.storeVariableWireReady) onboarding.advance();
      return;
    }
    if (onboarding.stepId !== "notifyWire") return;
    if (manualOnboardingValidation.notificationWireReady) {
      onboarding.advance();
    }
  }, [onboarding.stepId, model?.wires, manualOnboardingValidation.storeVariableWireReady, manualOnboardingValidation.notificationWireReady, onboarding]);

  // Onboarding: shared "run" step — advances on the first execution.
  useEffect(() => {
    if (onboarding.stepId !== "run") return;
    if (isRunning && (onboarding.track !== "manual" || manualOnboardingValidation.readyToRun)) {
      onboardingRunObservedRef.current = true;
      onboarding.advance();
    }
  }, [onboarding.stepId, onboarding.track, isRunning, manualOnboardingValidation.readyToRun, onboarding]);

  // Onboarding: shared "logs" step — advances when the logs panel is opened.
  useEffect(() => {
    if (onboarding.stepId !== "logs") return;
    const hasFreshRunLog = logs.length > onboardingRunLogBaselineRef.current;
    if (
      rightPanel === "logs"
      && (onboarding.track !== "manual" || (onboardingRunObservedRef.current && hasFreshRunLog))
    ) {
      onboarding.advance();
    }
  }, [onboarding.stepId, onboarding.track, rightPanel, logs.length, onboarding]);

  // Onboarding: shared "variables" step — advances when the Inspector opens
  // (Variables panel lives inside the Inspector).
  useEffect(() => {
    if (onboarding.track === "manual") return;
    if (onboarding.stepId !== "variables") return;
    if (rightPanel === "inspector") onboarding.advance();
  }, [onboarding.stepId, onboarding.track, rightPanel, onboarding]);

  // Onboarding: shared "docs" step (final) — advances/finishes when Docs opens.
  useEffect(() => {
    if (onboarding.stepId !== "docs") return;
    if (rightPanel === "docs") onboarding.finish();
  }, [onboarding.stepId, rightPanel, onboarding]);

  // When no workflow is selected, show the launcher
  if (!selectedId || !model) {
    return (
      <WorkflowThemeContext.Provider value={{ isDark }}>
      <div data-wf-theme={isDark ? 'dark' : 'light'} className="h-screen w-screen font-sans wf-bg wf-fg flex flex-col">
        <div className="flex-1 min-h-0 overflow-hidden">
        <WorkflowLauncherV2
          items={items}
          loading={loading}
          runningIds={runningIds}
          updates={updates}
          initialView={launcherView}
          onSelect={load}
          onCreate={() => {
            setCreateTemplateId("blank");
            setShowNameModal(true);
          }}
          onImport={() => setShowImport(true)}
          onMarketplace={(slug?: string) => {
            setMarketplaceSlug(slug);
            setShowMarketplace(true);
          }}
          onDelete={async (id: string) => {
            await (window as any).desktopAPI?.workflowsDelete?.(id);
            if (selectedId === id) { setSelectedId(""); setModel(null); }
            await refresh();
          }}
          onRun={async (id: string) => {
            await (window as any).desktopAPI?.workflowsDeploy?.(id);
          }}
          onStop={async (id: string) => {
            await (window as any).desktopAPI?.workflowsStop?.(id);
            await (window as any).desktopAPI?.workflowsUndeploy?.(id);
            setRunningIds(p => ({ ...p, [id]: false }));
          }}
          onShowPublished={() => setShowMyPublished(true)}
          onDashboard={() => (window as any).desktopAPI?.openDashboard?.()}
          onReplayTour={onboarding.replay}
          onIntegrationBuilder={openIntegrationBuilder}
        />

        <IntegrationBuilderModal
          open={showIntegrationBuilder}
          onClose={() => { setShowIntegrationBuilder(false); setIntegrationSeed(null); }}
          seedManifest={integrationSeed}
          selectedModelId={workflowChatModelId}
          onSelectModel={setWorkflowChatModelId}
          modelSource={modelSource}
          onModelSourceChange={setModelSource}
          reasoningLevel={workflowReasoningLevel}
          onReasoningLevelChange={setWorkflowReasoningLevel}
        />

        {onboarding.phase === "welcome" && (
          <WorkflowWelcomeScreen
            onBeginAi={beginAiTour}
            onBeginManual={beginManualTour}
            onSkip={onboarding.skip}
            isReplay={onboarding.seen}
          />
        )}

        {showNameModal && (
          <ProjectNameModal
            initialTemplateId={createTemplateId}
            onClose={() => setShowNameModal(false)}
            onConfirm={(name, templateId) => { setShowNameModal(false); create(name, templateId); }}
          />
        )}

        <WorkflowOverlays
          contextMenu={null}
          model={null as any}
          selectedNodeIds={new Set()}
          onCloseContextMenu={() => { }}
          onRunStep={() => { }}
          onRunFromHere={() => { }}
          onDuplicateNode={() => { }}
          onCopyNodes={() => { }}
          onCutNodes={() => { }}
          onPasteNodes={() => { }}
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
          showMyPublished={showMyPublished}
          onCloseMyPublished={() => setShowMyPublished(false)}
          onOpenPublishFromMyPublished={() => {
            setShowMyPublished(false);
          }}
          pendingUpdate={pendingUpdate}
          currentUpdateWorkflowName={items.find(i => i.id === pendingUpdate?.id)?.name || pendingUpdate?.id || ""}
          onClosePendingUpdate={() => setPendingUpdate(null)}
          onApplyPendingUpdate={executeWorkflowUpdate}
        />
        </div>
        <ConfirmDialogHost />
      </div>
      </WorkflowThemeContext.Provider>
    );
  }

  return (
    <WorkflowThemeContext.Provider value={{ isDark }}>
    <WorkflowGroupsProvider value={groupCtxValue}>
    <div data-wf-theme={isDark ? 'dark' : 'light'} className="h-screen w-screen font-sans wf-bg wf-fg flex flex-col">
      <div className="flex-1 min-h-0 relative overflow-hidden">
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
          workflowModelSource={modelSource}
          workflowReasoningLevel={workflowReasoningLevel}
          chat={chat}
          onApplyModel={applyModel}
          onSetWorkflowChatModelId={setWorkflowChatModelId}
          onSetWorkflowModelSource={setModelSource}
          onSetWorkflowReasoningLevel={setWorkflowReasoningLevel}
          onSetActiveTab={setActiveTab}
          onCloseFileTab={closeFileTab}
          onClearLogs={() => setLogs([])}
          onCanvasMouseDown={handleCanvasMouseDown}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onZoomReset={zoomReset}
          onZoomFit={fitToView}
          bindWheelTarget={bindWheelTarget}
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
          className="absolute right-4 top-1/2 -translate-y-1/2 z-40 flex flex-col items-center justify-center shadow-2xl pointer-events-auto border wf-panel"
          style={{ width: 52, minHeight: 340, gap: 16, borderRadius: 20, padding: 8, backdropFilter: 'var(--wf-glass-blur)' }}
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
            className={`p-1.5 w-9 h-9 flex items-center justify-center shrink-0 rounded-[12px] transition-all ${viewMode === 'ai' ? 'wf-sidebar-btn-active' : 'wf-sidebar-btn'}`}
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
            className={`p-1.5 w-9 h-9 flex items-center justify-center shrink-0 rounded-[12px] transition-all ${viewMode === 'manual' ? 'wf-sidebar-btn-active' : 'wf-sidebar-btn'}`}
            title="Manual Build"
          >
            <Wrench className="w-5 h-5" />
          </button>

          <div className="w-6 h-[1.5px] shrink-0 rounded-full" style={{ background: 'var(--wf-border)' }} />

          <button
            id="wf-target-logs"
            onClick={() => {
              if (!model?.locked) {
                setRightPanel((p) => {
                  const next = p === 'logs' ? 'none' : 'logs';
                  if (next !== 'none') setShowWorkspace(false);
                  return next;
                });
              }
            }}
            className={`p-1.5 w-9 h-9 flex items-center justify-center shrink-0 rounded-[12px] transition-all ${rightPanel === 'logs' ? 'wf-sidebar-btn-active' : 'wf-sidebar-btn'}`}
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
            className={`p-1.5 w-9 h-9 flex items-center justify-center shrink-0 rounded-[12px] transition-all ${showWorkspace ? 'wf-sidebar-btn-active' : 'wf-sidebar-btn'}`}
            title="Workspace"
          >
            <FolderOpen className="w-5 h-5" />
          </button>

          <div className="w-6 h-[1.5px] shrink-0 rounded-full" style={{ background: 'var(--wf-border)' }} />

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
            className={`p-1.5 w-9 h-9 flex items-center justify-center shrink-0 rounded-[12px] transition-all ${rightPanel === 'code' ? 'wf-sidebar-btn-active' : 'wf-sidebar-btn'}`}
            title="JSON Code"
          >
            <FileCode className="w-5 h-5" />
          </button>
          <button
            id="wf-target-docs"
            onClick={() => {
              setRightPanel((p) => {
                const next = p === 'docs' ? 'none' : 'docs';
                if (next !== 'none') setShowWorkspace(false);
                return next;
              });
            }}
            className={`p-1.5 w-9 h-9 flex items-center justify-center shrink-0 rounded-[12px] transition-all ${rightPanel === 'docs' ? 'wf-sidebar-btn-active' : 'wf-sidebar-btn'}`}
            title="Documentation"
          >
            <BookOpen className="w-5 h-5" />
          </button>
          <button
            id="wf-target-inspector"
            onClick={() => {
              if (!model?.locked) {
                setRightPanel((p) => {
                  const next = p === 'inspector' ? 'none' : 'inspector';
                  if (next !== 'none') setShowWorkspace(false);
                  return next;
                });
              }
            }}
            className={`p-1.5 w-9 h-9 flex items-center justify-center shrink-0 rounded-[12px] transition-all ${rightPanel === 'inspector' ? 'wf-sidebar-btn-active' : 'wf-sidebar-btn'}`}
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
        onCopyNodes={copyNodes}
        onCutNodes={cutNodes}
        onPasteNodes={pasteNodes}
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

      {onboarding.phase === "guided" && currentStepConfig && (
        <>
          {currentStepConfig.targetId && (
            <WorkflowSpotlight
              targetId={currentStepConfig.targetId}
              refresh={onboarding.stepIndex}
            />
          )}
          <WorkflowCoach
            step={currentStepConfig}
            currentIndex={onboarding.stepIndex}
            totalSteps={onboarding.totalSteps}
            onAdvance={async () => {
              // The save step actually saves before advancing — that's the whole
              // point of teaching "save before run". Docs is the final step so
              // its button finishes the tour entirely.
              if (!currentStepGate.canAdvance) return;
              if (currentStepConfig.id === "intro") {
                setSelectedNodeId("");
                setSelectedNodeIds(new Set());
                setSelectedWireIndex(null);
                setRightPanel("inspector");
                onboarding.advance();
                return;
              }
              if (currentStepConfig.id === "variables") {
                setSelectedNodeId(MANUAL_ONBOARDING_TIMESTAMP_STEP_ID);
                setSelectedNodeIds(new Set([MANUAL_ONBOARDING_TIMESTAMP_STEP_ID]));
                setSelectedWireIndex(null);
                setRightPanel("inspector");
                onboarding.advance();
                return;
              }
              if (currentStepConfig.id === "timestampArgs") {
                setSelectedWireIndex(null);
                setRightPanel("none");
                onboarding.advance();
                return;
              }
              if (currentStepConfig.id === "setVariableArgs") {
                setSelectedWireIndex(null);
                setRightPanel("none");
                onboarding.advance();
                return;
              }
              if (currentStepConfig.id === "notificationArgs") {
                setSelectedWireIndex(null);
                setRightPanel("none");
                onboarding.advance();
                return;
              }
              if (currentStepConfig.id === "save") {
                if (dirty) await save();
                onboarding.advance();
                return;
              }
              if (currentStepConfig.id === "docs") {
                onboarding.finish();
                return;
              }
              onboarding.advance();
            }}
            onSkip={onboarding.skip}
            canAdvance={currentStepGate.canAdvance}
            blockedHint={currentStepGate.blockedHint}
          />
        </>
      )}

      {onboarding.phase === "welcome" && (
        <WorkflowWelcomeScreen
          onBeginAi={beginAiTour}
          onBeginManual={beginManualTour}
          onSkip={onboarding.skip}
          isReplay={onboarding.seen}
        />
      )}
      </div>
      <ConfirmDialogHost />
    </div>
    </WorkflowGroupsProvider>
    </WorkflowThemeContext.Provider>
  );
}

initPostHog();
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode><PostHogProvider client={posthog}><PanelErrorBoundary name="WorkflowsApp"><WorkflowsApp /></PanelErrorBoundary></PostHogProvider></React.StrictMode>
);
