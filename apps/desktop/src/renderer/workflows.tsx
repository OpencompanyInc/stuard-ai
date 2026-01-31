/**
 * Workflow Builder - Production-ready visual workflow editor
 */

import React, { useCallback, useEffect, useMemo, useRef, useState, ErrorInfo } from "react";
import ReactDOM from "react-dom/client";
import { PostHogProvider } from 'posthog-js/react';
import { initPostHog, posthog } from './lib/posthog';
import { supabase } from './lib/supabaseClient';
import { getValidAccessToken } from './auth/authManager';
import "./styles.css";
import "./scrollbar.css";

import { ChatPanel } from "./workflows/components/ChatPanel";
import { useWorkflowChat } from "./workflows/hooks/useWorkflowChat";
import { ChatHistory } from "./workflows/components/chat/ChatHistory";
import { ChatInput } from "./workflows/components/chat/ChatInput";
import { PublishModal, MarketplaceBrowser, WorkflowUpdateModal, MyPublishedWorkflowsModal } from "./workflows/components/MarketplaceModal";
import { ToolPalette } from "./workflows/components/ToolPalette";
import { type StepExecutionStatus } from "./workflows/components/WorkflowNodeCard";
import { InspectorPanel } from "./workflows/components/InspectorPanel";
import { WireInspectorPanel } from "./workflows/components/WireInspectorPanel";
import { CodePanel } from "./workflows/components/CodePanel";
import { DeployPanelModal } from "./workflows/components/DeployPanelModal";
import { ImportJsonModal } from "./workflows/components/ImportJsonModal";
import { WorkflowLogs } from "./workflows/components/WorkflowLogs";
import { WorkflowCanvas } from "./workflows/components/WorkflowCanvas";
import { WorkflowSidebar } from "./workflows/components/WorkflowSidebar";
import { useWorkflows } from "./workflows/hooks/useWorkflows";
import { specToDesignerModel } from "./workflows/utils/conversions";
import { validateDesignerModel, ValidationError } from "./workflows/builder/compiler";
import type { DesignerModel } from "./workflows/types";
import { calculateSnapPosition, snapToGrid, calculateAutoLayout, type AlignmentGuide } from "./workflows/utils/alignment";

const CLOUD_AI_HTTP = (window as any).__CLOUD_AI_HTTP__ || (import.meta as any).env?.VITE_CLOUD_AI_URL || "http://127.0.0.1:8082";

// Execution state types
interface ExecutionState {
  flowId: string;
  isRunning: boolean;
  stepStates: Record<string, StepExecutionStatus>;
  activeWireFrom?: string;
  activeWireTo?: string;
}

import { Play, Square, Save, Code, Settings, Wand2, Rocket, Zap, Terminal, Command, Layout, Plus, ZoomIn, ZoomOut, Maximize2, ChevronDown, Lock, Undo2, Redo2, Copy, Trash2, LayoutGrid, SkipForward, PlayCircle } from "lucide-react";

// Icons used in the main app
const Icons = { Play, Stop: Square, Save, Code, Settings, Wand: Wand2, Rocket, Zap, Terminal, Command, Layout, Plus, Lock, Undo: Undo2, Redo: Redo2, Copy, Trash: Trash2, LayoutGrid, Maximize2, ZoomIn, ZoomOut, SkipForward, PlayCircle };

// Error boundary for catching render errors in panels
class PanelErrorBoundary extends React.Component<{ children: React.ReactNode; name: string }, { hasError: boolean; error?: Error }> {
  constructor(props: { children: React.ReactNode; name: string }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[${this.props.name}] Render error:`, error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex items-center justify-center p-4 text-red-500 text-sm">
          <div className="text-center">
            <p className="font-medium">Panel Error</p>
            <p className="text-xs mt-1 text-red-400">{this.state.error?.message || 'Unknown error'}</p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

import { getMarketplaceApi, type MarketplaceUpdate } from "./utils/cloud";

// Main App
function WorkflowsApp() {
  const { items, loading, refresh, updates } = useWorkflows();
  const [selectedId, setSelectedId] = useState("");
  const [model, setModel] = useState<DesignerModel | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [runningIds, setRunningIds] = useState<Record<string, boolean>>({});

  // Undo/Redo history
  const [history, setHistory] = useState<DesignerModel[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const isUndoingRef = useRef(false); // Flag to prevent adding to history during undo/redo

  // Execution state for visual flow
  const [executionState, setExecutionState] = useState<ExecutionState | null>(null);

  type RightPanel = 'none' | 'inspector' | 'code' | 'ai';
  const [viewMode, setViewMode] = useState<'ai' | 'manual'>('ai');
  const [rightPanel, setRightPanel] = useState<RightPanel>('none');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      const raw = window.localStorage.getItem('workflow.sidebarCollapsed');
      return raw === '1' || raw === 'true';
    } catch {
      return false;
    }
  });
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [connectingFrom, setConnectingFrom] = useState("");

  const canvasRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<{ id: string; ox: number; oy: number } | null>(null);
  const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuide[]>([]);
  const [zoom, setZoom] = useState(1);
  const [logs, setLogs] = useState<Array<{ ts: string; msg: string }>>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [showRunMenu, setShowRunMenu] = useState(false);
  const [selectedWireIndex, setSelectedWireIndex] = useState<number | null>(null);

  const [showImport, setShowImport] = useState(false);
  const [importJson, setImportJson] = useState('');
  const [importErr, setImportErr] = useState('');

  // Context Menu State - supports both node and canvas context menus
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId?: string; type: 'node' | 'canvas' } | null>(null);

  // Marketplace state
  const [showPublish, setShowPublish] = useState(false);
  const [showMarketplace, setShowMarketplace] = useState(false);
  const [marketplaceSlug, setMarketplaceSlug] = useState<string | undefined>(undefined);
  const [showMyPublished, setShowMyPublished] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<{ id: string; update: MarketplaceUpdate } | null>(null);

  // Credits state
  const [credits, setCredits] = useState<{ remaining: number; limit: number; plan: string } | null>(null);

  const [chatInput, setChatInput] = useState("");

  const [workflowChatModelId, setWorkflowChatModelId] = useState<string | 'auto'>(() => {
    try {
      const raw = window.localStorage.getItem('workflow.chat_model_id');
      const v = raw ? String(raw).trim() : 'auto';
      return v ? (v as any) : 'auto';
    } catch {
      return 'auto';
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
      window.localStorage.setItem('workflow.sidebarCollapsed', sidebarCollapsed ? '1' : '0');
    } catch {
    }
  }, [sidebarCollapsed]);

  const [aiLeftWidth, setAiLeftWidth] = useState(() => {
    try {
      const raw = window.localStorage.getItem('workflow.ai.leftPaneWidth');
      const n = raw ? Number(raw) : 350;
      if (!Number.isFinite(n)) return 350;
      return Math.max(260, Math.min(520, n));
    } catch {
      return 350;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem('workflow.ai.leftPaneWidth', String(aiLeftWidth));
    } catch {
    }
  }, [aiLeftWidth]);

  const [manualRightWidth, setManualRightWidth] = useState(() => {
    try {
      const raw = window.localStorage.getItem('workflow.manual.rightPaneWidth');
      const n = raw ? Number(raw) : 320;
      if (!Number.isFinite(n)) return 320;
      return Math.max(280, Math.min(560, n));
    } catch {
      return 320;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem('workflow.manual.rightPaneWidth', String(manualRightWidth));
    } catch {
    }
  }, [manualRightWidth]);

  const startResizeAiLeft = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = aiLeftWidth;

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const next = Math.max(260, Math.min(520, startWidth + dx));
      setAiLeftWidth(next);
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [aiLeftWidth]);

  const startResizeManualRight = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = manualRightWidth;

    const onMove = (ev: MouseEvent) => {
      const dx = startX - ev.clientX;
      const next = Math.max(280, Math.min(560, startWidth + dx));
      setManualRightWidth(next);
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [manualRightWidth]);

  const applyModel = useCallback((m: any) => {
    setModel(m);
    setDirty(true);
  }, []);

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
    errors,
    selectedModelId: workflowChatModelId,
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

  useEffect(() => {
    console.log('[Workflows] Setting up log listener');
    const unsub = (window as any).desktopAPI?.onWorkflowsLog?.((d: any) => {
      console.log('[Workflows] Received log:', d);
      setLogs(p => [...p.slice(-100), { ts: new Date().toISOString(), msg: String(d?.message || '') }]);
    });
    return () => { try { unsub?.(); } catch { } };
  }, []);

  // Listen for navigation events
  useEffect(() => {
    const unsub = (window as any).desktopAPI?.onWorkflowsNavigate?.((d: any) => {
      if (d?.marketplaceSlug) {
        setMarketplaceSlug(d.marketplaceSlug);
        setShowMarketplace(true);
      }
    });

    // Check query params on mount
    const params = new URLSearchParams(window.location.search);
    const slug = params.get('marketplaceSlug');
    if (slug) {
      setMarketplaceSlug(slug);
      setShowMarketplace(true);
    }

    return () => { try { unsub?.(); } catch { } };
  }, []);
  // Listen for step execution events
  useEffect(() => {
    console.log('[Workflows] Setting up step and execution listeners');
    const unsubStep = (window as any).desktopAPI?.onWorkflowsStep?.((d: any) => {
      console.log('[Workflows] Received step event:', d);
      const { flowId, stepId, status, wireFromId } = d || {};
      if (!flowId || !stepId) return;

      setExecutionState(prev => {
        if (!prev || prev.flowId !== flowId) {
          return {
            flowId,
            isRunning: true,
            stepStates: { [stepId]: status },
            activeWireFrom: wireFromId,
            activeWireTo: status === 'running' ? stepId : undefined,
          };
        }
        return {
          ...prev,
          stepStates: { ...prev.stepStates, [stepId]: status },
          activeWireFrom: status === 'running' ? wireFromId : prev.activeWireFrom,
          activeWireTo: status === 'running' ? stepId : prev.activeWireTo,
        };
      });
    });

    const unsubExec = (window as any).desktopAPI?.onWorkflowsExecution?.((d: any) => {
      console.log('[Workflows] Received execution event:', d);
      const { flowId, isRunning } = d || {};
      if (!flowId) return;

      if (isRunning) {
        setExecutionState({
          flowId,
          isRunning: true,
          stepStates: {},
        });
        setRunningIds(p => ({ ...p, [flowId]: true }));
      } else {
        // Clear execution state after a short delay to show completion
        setTimeout(() => {
          setExecutionState(prev => {
            if (prev?.flowId === flowId) return null;
            return prev;
          });
        }, 1500);
        setRunningIds(p => ({ ...p, [flowId]: false }));
      }
    });

    return () => {
      try { unsubStep?.(); } catch { }
      try { unsubExec?.(); } catch { }
    };
  }, []);

  const load = useCallback(async (id: string) => {
    if (!id) return;
    const res = await (window as any).desktopAPI?.workflowsRead?.(id);
    if (res?.ok) {
      setSelectedId(res.id);
      let loadedModel: DesignerModel | null = null;
      try { loadedModel = JSON.parse(res.content || '{}'); } catch { loadedModel = null; }
      setModel(loadedModel);
      setDirty(false);
      setSelectedNodeId("");
      chat.setMessages([]);
      setChatInput("");
      // Reset undo/redo history for new workflow
      setHistory([]);
      setHistoryIndex(-1);
      // If workflow is locked, force manual mode and close panels
      if (loadedModel?.locked) {
        setViewMode('manual');
        setRightPanel('none');
      }
    }
  }, [chat, setChatInput]);

  const save = useCallback(async () => {
    if (!selectedId || !model) return;
    setSaving(true);
    const res = await (window as any).desktopAPI?.workflowsSave?.(selectedId, JSON.stringify(model, null, 2));
    if (res?.ok) { setDirty(false); await refresh(); } else alert(res?.error || 'Save failed');
    setSaving(false);
  }, [model, refresh, selectedId]);

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
    if (!selectedNodeId || !model) return;
    // Prevent deleting nodes in locked workflows
    if (model.locked) return;
    setHistory(prev => {
      const newHistory = prev.slice(0, historyIndex + 1);
      const trimmed = [...newHistory, model].slice(-50);
      return trimmed;
    });
    setHistoryIndex(prev => Math.min(prev + 1, 49));
    setModel({ ...model, nodes: model.nodes.filter(n => n.id !== selectedNodeId), triggers: model.triggers.filter(t => t.id !== selectedNodeId), wires: model.wires.filter(w => w.from !== selectedNodeId && w.to !== selectedNodeId) });
    setDirty(true);
    setSelectedNodeId("");
  }, [selectedNodeId, model, historyIndex]);

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

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const key = String(e.key || '').toLowerCase();
      const mod = e.ctrlKey || e.metaKey;

      const target = e.target as any;
      const tag = String(target?.tagName || '').toLowerCase();
      const isTypingTarget = tag === 'input' || tag === 'textarea' || target?.isContentEditable === true;

      if (mod && key === 's') {
        e.preventDefault();
        save();
        return;
      }

      // Undo: Ctrl+Z
      if (mod && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }

      // Redo: Ctrl+Y or Ctrl+Shift+Z
      if ((mod && key === 'y') || (mod && key === 'z' && e.shiftKey)) {
        e.preventDefault();
        redo();
        return;
      }

      // Duplicate: Ctrl+D
      if (mod && key === 'd') {
        e.preventDefault();
        duplicateNode();
        return;
      }

      if (isTypingTarget) return;

      if (mod && key === 'enter') {
        e.preventDefault();
        run();
        return;
      }

      if (key === 'escape') {
        if (runningIds[selectedId]) {
          e.preventDefault();
          stop();
        } else {
          // Deselect node and wire on Escape
          setSelectedNodeId("");
          setSelectedWireIndex(null);
          setConnectingFrom("");
        }
      }

      // Delete key - delete selected node or wire
      if (key === 'delete' || key === 'backspace') {
        e.preventDefault();
        if (selectedWireIndex !== null && model) {
          // Delete selected wire
          const newWires = model.wires.filter((_, i) => i !== selectedWireIndex);
          updateModel({ ...model, wires: newWires });
          setSelectedWireIndex(null);
        } else if (selectedNodeId) {
          // Delete selected node
          delNode();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [run, runningIds, save, selectedId, stop, selectedNodeId, selectedWireIndex, model, delNode, undo, redo]);

  useEffect(() => { if (!selectedId && items.length > 0) load(items[0].id); }, [items, selectedId, load]);

  const create = async () => {
    const safe = `flow_${Math.random().toString(36).slice(2, 10)}`;
    const skeleton: DesignerModel = {
      id: safe,
      name: "New Flow",
      version: "1",
      triggers: [{ id: `trig_0`, type: 'manual', label: 'Manual Trigger', args: {}, position: { x: 50, y: 50 } }],
      nodes: [{
        id: `start`,
        type: 'local.tool',
        tool: 'log',
        label: 'Log Message',
        args: { message: 'Workflow started' },
        fallbackTo: '',
        position: { x: 50, y: 180 }
      }],
      wires: [{ from: 'trig_0', to: 'start' }],
    };
    try {
      const res = await (window as any).desktopAPI?.workflowsSave?.(safe, JSON.stringify(skeleton, null, 2));
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

  // Deploy panel state
  const [showDeployPanel, setShowDeployPanel] = useState(false);
  const [deployStatus, setDeployStatus] = useState<{ deployed: boolean; running: boolean; triggers: string[] } | null>(null);

  const fetchDeployStatus = async () => {
    if (!selectedId) return;
    try {
      const status = await (window as any).desktopAPI?.workflowsGetDeployStatus?.(selectedId);
      if (status?.ok) setDeployStatus({ deployed: status.deployed, running: status.running, triggers: status.triggers || [] });
    } catch { }
  };

  useEffect(() => { if (selectedId) fetchDeployStatus(); }, [selectedId]);

  const deploy = async () => {
    if (!selectedId || !model) return;
    try {
      await (window as any).desktopAPI?.workflowsSave?.(selectedId, JSON.stringify(model, null, 2));
      const res = await (window as any).desktopAPI?.workflowsDeploy?.(selectedId);
      if (res?.ok) {
        setDeployStatus({ deployed: true, running: true, triggers: model.triggers?.map(t => t.type) || [] });
        setShowDeployPanel(false);
      } else {
        alert(res?.error || 'Deploy failed');
      }
    } catch (e: any) { alert(e?.message || 'Failed'); }
  };

  const undeploy = async () => {
    if (!selectedId) return;
    try {
      const res = await (window as any).desktopAPI?.workflowsUndeploy?.(selectedId);
      if (res?.ok) {
        setDeployStatus({ deployed: false, running: false, triggers: model?.triggers?.map(t => t.type) || [] });
      }
    } catch (e: any) { alert(e?.message || 'Failed'); }
  };

  const exportWorkflow = async () => {
    if (!selectedId) return;
    try {
      const res = await (window as any).desktopAPI?.workflowsExport?.(selectedId);
      if (res?.ok && res?.path) {
        await (window as any).desktopAPI?.showItemInFolder?.(res.path);
      } else {
        alert(res?.error || 'Export failed');
      }
    } catch (e: any) {
      alert(e?.message || 'Export failed');
    }
  };

  const importFromMarketplace = async (spec: any) => {
    try {
      const newId = spec.id || 'flow_' + Date.now().toString(36);
      const m = specToDesignerModel({ ...spec, id: newId });
      await (window as any).desktopAPI?.workflowsSave?.(newId, JSON.stringify(m, null, 2));
      await refresh();
      await load(newId);
    } catch (e: any) {
      alert(e?.message || 'Import failed');
    }
  };

  const handleUpdateWorkflow = (id: string, update: MarketplaceUpdate) => {
    // Show the update modal instead of a simple confirm
    setPendingUpdate({ id, update });
  };

  const executeWorkflowUpdate = async () => {
    if (!pendingUpdate) throw new Error("No pending update");

    const { id, update } = pendingUpdate;

    const token = await getValidAccessToken();
    const api = getMarketplaceApi(() => token || null);

    // Fetch the full workflow data
    const res = await api.getWorkflow(update.slug);

    if (!res.ok || !res.workflow?.spec) {
      throw new Error(res.error || "Failed to download update");
    }

    // Convert spec to model, preserving the existing ID and adding marketplace metadata
    const spec = res.workflow.spec;
    const newModel = specToDesignerModel({
      ...spec,
      id,
      marketplaceSlug: update.slug,
      version: update.latestVersion,
      locked: res.workflow.locked || false,
    });

    // Save
    await (window as any).desktopAPI?.workflowsSave?.(id, JSON.stringify(newModel, null, 2));

    // Track the download
    try {
      await api.download(update.slug);
    } catch {
      // Non-blocking
    }

    // Reload
    await refresh();
    if (selectedId === id) {
      await load(id);
    }

    // Close modal
    setPendingUpdate(null);

    // Notify
    try {
      (window as any).desktopAPI?.notify?.('Updated!', `${update.name} has been updated to v${update.latestVersion}`);
    } catch { }
  };

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

  const duplicateNode = useCallback(() => {
    if (!selectedNodeId || !model) return;
    // Prevent duplicating nodes in locked workflows
    if (model.locked) return;

    // Find the node or trigger
    const node = model.nodes.find(n => n.id === selectedNodeId);
    const trigger = model.triggers.find(t => t.id === selectedNodeId);
    const item = node || trigger;

    if (!item) return;

    // Create new ID
    const newId = `${item.type.split('.').pop() || 'step'}_${Date.now().toString(36)}`;

    // Offset position
    const newPos = {
      x: (item.position?.x || 0) + 30,
      y: (item.position?.y || 0) + 30
    };

    if (trigger) {
      // Duplicate trigger
      const newTrigger = { ...trigger, id: newId, position: newPos, label: `${trigger.label} (Copy)` };
      updateModel({ ...model, triggers: [...model.triggers, newTrigger] });
    } else if (node) {
      // Duplicate node
      const newNode = { ...node, id: newId, position: newPos, label: `${node.label} (Copy)` };
      updateModel({ ...model, nodes: [...model.nodes, newNode] });
    }

    // Select the new item
    setSelectedNodeId(newId);
  }, [selectedNodeId, model, updateModel]);

  // Zoom controls
  const zoomIn = useCallback(() => setZoom(z => Math.min(2, z + 0.1)), []);
  const zoomOut = useCallback(() => setZoom(z => Math.max(0.25, z - 0.1)), []);
  const zoomReset = useCallback(() => setZoom(1), []);

  // Auto-organize layout
  const autoOrganize = useCallback(() => {
    if (!model) return;
    const result = calculateAutoLayout(model.triggers, model.nodes, model.wires);
    const newTriggers = model.triggers.map(t => {
      const pos = result.triggers.find(r => r.id === t.id);
      return pos ? { ...t, position: pos.position } : t;
    });
    const newNodes = model.nodes.map(n => {
      const pos = result.nodes.find(r => r.id === n.id);
      return pos ? { ...n, position: pos.position } : n;
    });
    updateModel({ ...model, triggers: newTriggers, nodes: newNodes });
  }, [model, updateModel]);

  // Handle mouse wheel zoom on canvas
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setZoom(z => Math.min(2, Math.max(0.25, z + delta)));
    }
  }, []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    // Prevent dropping on locked workflows
    if (model?.locked) return;
    try {
      const d = JSON.parse(e.dataTransfer.getData('text/plain'));
      const rect = canvasRef.current?.getBoundingClientRect();
      // Adjust for zoom: divide by zoom to get canvas coordinates
      const rawX = (e.clientX - (rect?.left || 0) + (canvasRef.current?.scrollLeft || 0)) / zoom;
      const rawY = (e.clientY - (rect?.top || 0) + (canvasRef.current?.scrollTop || 0)) / zoom;
      // Snap to grid when dropping new nodes
      const x = snapToGrid(Math.max(0, rawX));
      const y = snapToGrid(Math.max(0, rawY));
      // Generate ID without dots (replace dots with underscores for safe template interpolation)
      const safeKind = String(d.k || 'step').replace(/\./g, '_');
      const id = `${safeKind}_${Date.now().toString(36)}`;
      if (!model) return;
      if (d.k === 'trigger') {
        updateModel({ ...model, triggers: [...model.triggers, { id, type: d.t, label: d.label, args: d.args || {}, position: { x, y } }] });
      } else {
        updateModel({ ...model, nodes: [...model.nodes, { id, type: d.k, tool: d.t, label: d.label, args: d.args || {}, position: { x, y } }] });
      }
    } catch { }
  };

  const handleNodeMD = (id: string, e: React.MouseEvent) => {
    // Prevent dragging nodes in locked workflows
    if (model?.locked) return;
    const item = [...(model?.triggers || []), ...(model?.nodes || [])].find(n => n.id === id);
    if (!item) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    // Adjust offset calculation for zoom
    const canvasX = (e.clientX - (rect?.left || 0) + (canvasRef.current?.scrollLeft || 0)) / zoom;
    const canvasY = (e.clientY - (rect?.top || 0) + (canvasRef.current?.scrollTop || 0)) / zoom;
    setDragging({ id, ox: canvasX - item.position.x, oy: canvasY - item.position.y });
  };

  const handleNodeContextMenu = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    // Select the node immediately
    setSelectedNodeId(id);
    setContextMenu({ x: e.clientX, y: e.clientY, nodeId: id, type: 'node' });
  };

  const handleCanvasContextMenu = (e: React.MouseEvent) => {
    // Only show canvas context menu if clicking on the canvas background, not on a node
    const target = e.target as HTMLElement;
    if (target.closest('[data-node-id]')) return; // Don't show if clicking on a node
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, type: 'canvas' });
  };

  const handleMM = (e: React.MouseEvent) => {
    if (!dragging || !model) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    // Adjust for zoom: divide by zoom to get canvas coordinates
    const canvasX = (e.clientX - (rect?.left || 0) + (canvasRef.current?.scrollLeft || 0)) / zoom;
    const canvasY = (e.clientY - (rect?.top || 0) + (canvasRef.current?.scrollTop || 0)) / zoom;
    const rawX = Math.max(0, canvasX - dragging.ox);
    const rawY = Math.max(0, canvasY - dragging.oy);

    // Get all nodes for alignment calculation
    const allNodes = [...model.triggers, ...model.nodes];

    // Calculate snapped position and alignment guides
    const { x, y, guides } = calculateSnapPosition(dragging.id, rawX, rawY, allNodes);

    // Update alignment guides for rendering
    setAlignmentGuides(guides);

    const ti = model.triggers.findIndex(t => t.id === dragging.id);
    if (ti >= 0) { const t = [...model.triggers]; t[ti] = { ...t[ti], position: { x, y } }; setModel({ ...model, triggers: t }); setDirty(true); }
    else { const ni = model.nodes.findIndex(n => n.id === dragging.id); if (ni >= 0) { const n = [...model.nodes]; n[ni] = { ...n[ni], position: { x, y } }; setModel({ ...model, nodes: n }); setDirty(true); } }
  };

  const handleConnect = (id: string) => {
    // Prevent creating connections in locked workflows
    if (model?.locked) return;
    if (!connectingFrom) setConnectingFrom(id);
    else { if (connectingFrom !== id && model) updateModel({ ...model, wires: [...model.wires, { from: connectingFrom, to: id }] }); setConnectingFrom(""); }
  };

  const size = useMemo(() => {
    const all = [...(model?.triggers || []), ...(model?.nodes || [])];
    let mx = 800, my = 600;
    for (const i of all) { mx = Math.max(mx, (i.position?.x || 0) + 250); my = Math.max(my, (i.position?.y || 0) + 150); }
    return { w: mx, h: my };
  }, [model]);

  const isRunning = runningIds[selectedId];

  return (
    <div className="h-screen w-screen flex flex-col bg-slate-50 overflow-hidden text-slate-900 font-sans">
      {/* App Header / Toolbar */}
      <div className="drag h-14 bg-white/80 backdrop-blur-md border-b border-slate-200/60 flex items-center px-4 shrink-0 justify-between z-30 relative">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3 select-none">
            <div>
              <div className="text-sm font-bold text-slate-900 tracking-tight leading-none font-stuard">Stuard Studio</div>
              <div className="text-[10px] text-slate-500 font-medium mt-0.5 tracking-wide font-stuard">Intelligent Workflow Engine</div>
            </div>
          </div>

          <div className="h-5 w-px bg-slate-200" />

          {model && (
            <div className="flex items-center gap-3 no-drag">
              <span className="text-sm font-semibold text-slate-700">{model.name || selectedId}</span>
              {dirty && (
                <span className="text-[10px] font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100 flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                  Unsaved
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 no-drag">
          {model ? (
            <>
              {/* Locked indicator */}
              {model.locked && (
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-xs font-medium">
                  <Icons.Lock className="w-3.5 h-3.5" />
                  Locked
                </div>
              )}

              {/* View Mode Toggle */}
              <div className="flex bg-slate-100 p-1 rounded-lg">
                <button
                  onClick={() => !model.locked && setViewMode('ai')}
                  disabled={model.locked}
                  title={model.locked ? 'AI Designer is disabled for locked workflows' : 'AI Designer'}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${model.locked
                    ? 'text-slate-300 cursor-not-allowed'
                    : viewMode === 'ai'
                      ? 'bg-white text-indigo-600 shadow-sm ring-1 ring-black/5'
                      : 'text-slate-500 hover:text-slate-700'
                    }`}
                >
                  <Icons.Wand className="w-3.5 h-3.5" />
                  AI Designer
                </button>
                <button
                  onClick={() => setViewMode('manual')}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${viewMode === 'manual'
                    ? 'bg-white text-slate-900 shadow-sm ring-1 ring-black/5'
                    : 'text-slate-500 hover:text-slate-700'
                    }`}
                >
                  <Icons.Layout className="w-3.5 h-3.5" />
                  Visual Editor
                </button>
              </div>

              <div className="h-5 w-px bg-slate-200 mx-1" />

              <div className="flex bg-slate-100 rounded-lg p-1">
                {/* Undo/Redo buttons */}
                <button
                  onClick={undo}
                  disabled={!canUndo || model.locked}
                  className={`p-1.5 rounded-md transition-all ${canUndo && !model.locked ? 'text-slate-700 hover:bg-white hover:shadow-sm' : 'text-slate-300 cursor-not-allowed'}`}
                  title="Undo (Ctrl+Z)"
                >
                  <Icons.Undo className="w-4 h-4" />
                </button>
                <button
                  onClick={redo}
                  disabled={!canRedo || model.locked}
                  className={`p-1.5 rounded-md transition-all ${canRedo && !model.locked ? 'text-slate-700 hover:bg-white hover:shadow-sm' : 'text-slate-300 cursor-not-allowed'}`}
                  title="Redo (Ctrl+Y)"
                >
                  <Icons.Redo className="w-4 h-4" />
                </button>
                <div className="w-px bg-slate-200 my-1 mx-1" />
                <button
                  onClick={save}
                  disabled={!dirty}
                  className={`p-1.5 rounded-md transition-all ${dirty ? 'text-slate-700 hover:bg-white hover:shadow-sm' : 'text-slate-400'}`}
                  title="Save (Ctrl+S)"
                >
                  <Icons.Save className="w-4 h-4" />
                </button>
                <div className="w-px bg-slate-200 my-1 mx-1" />
                {isRunning ? (
                  <button onClick={stop} className="px-3 py-1.5 bg-white text-red-600 border border-slate-200 hover:border-red-200 hover:bg-red-50 rounded-md flex items-center gap-1.5 text-xs font-medium shadow-sm transition-all">
                    <Icons.Stop className="w-3.5 h-3.5 fill-current" /> Stop
                  </button>
                ) : manualTriggers.length > 1 ? (
                  <div className="relative">
                    <div className="flex">
                      <button
                        onClick={() => run()}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-l-md flex items-center gap-1.5 text-xs font-medium shadow-sm shadow-emerald-200 transition-all hover:translate-y-[-1px]"
                      >
                        <Icons.Play className="w-3.5 h-3.5 fill-current" /> Run All
                      </button>
                      <button
                        onClick={() => setShowRunMenu(!showRunMenu)}
                        className="px-1.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-r-md border-l border-emerald-500 flex items-center text-xs font-medium shadow-sm shadow-emerald-200 transition-all"
                      >
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {showRunMenu && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setShowRunMenu(false)} />
                        <div className="absolute right-0 top-full mt-1 z-50 bg-white rounded-lg shadow-lg border border-slate-200 py-1 min-w-[180px]">
                          <div className="px-3 py-1.5 text-[10px] font-medium text-slate-400 uppercase tracking-wider">
                            Run Specific Trigger
                          </div>
                          {manualTriggers.map((trigger) => (
                            <button
                              key={trigger.id}
                              onClick={() => run(trigger.id)}
                              className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                            >
                              <Icons.Play className="w-3 h-3 text-emerald-500" />
                              {trigger.label || trigger.id}
                            </button>
                          ))}
                          <div className="border-t border-slate-100 mt-1 pt-1">
                            <button
                              onClick={() => run()}
                              className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                            >
                              <Icons.Zap className="w-3 h-3 text-indigo-500" />
                              Run All Triggers
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <button onClick={() => run()} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-md flex items-center gap-1.5 text-xs font-medium shadow-sm shadow-emerald-200 transition-all hover:translate-y-[-1px]">
                    <Icons.Play className="w-3.5 h-3.5 fill-current" /> Run Flow
                  </button>
                )}
              </div>

              <button
                onClick={() => setShowDeployPanel(!showDeployPanel)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all border shadow-sm ml-1 ${deployStatus?.deployed
                  ? 'bg-slate-800 text-white border-slate-800 hover:bg-slate-700'
                  : 'bg-white text-slate-700 border-slate-200 hover:border-indigo-300 hover:text-indigo-600'
                  }`}
              >
                <Icons.Rocket className="w-3.5 h-3.5" />
                {deployStatus?.deployed ? 'Deployed' : 'Deploy'}
                {deployStatus?.running && <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.6)]" />}
              </button>

              {/* Manual mode specific toggles */}
              {viewMode === 'manual' && (
                <div className="flex gap-1 ml-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!model.locked) {
                        setRightPanel(p => p === 'inspector' ? 'none' : 'inspector');
                      }
                    }}
                    disabled={model.locked}
                    className={`p-2 rounded-lg transition-colors ${model.locked
                      ? 'text-slate-300 cursor-not-allowed'
                      : rightPanel === 'inspector'
                        ? 'bg-indigo-50 text-indigo-600'
                        : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
                      }`}
                    title={model.locked ? 'Properties disabled for locked workflows' : 'Properties Panel'}
                  >
                    <Icons.Settings className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!model.locked) {
                        setRightPanel(p => p === 'code' ? 'none' : 'code');
                      }
                    }}
                    disabled={model.locked}
                    className={`p-2 rounded-lg transition-colors ${model.locked
                      ? 'text-slate-300 cursor-not-allowed'
                      : rightPanel === 'code'
                        ? 'bg-indigo-50 text-indigo-600'
                        : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
                      }`}
                    title={model.locked ? 'Code view disabled for locked workflows' : 'Code View'}
                  >
                    <Icons.Code className="w-4 h-4" />
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="text-xs text-slate-400 font-medium px-2">Select a workflow to start</div>
          )}
        </div>
      </div>

      <div className="flex-1 flex min-h-0 relative">
        {/* Workflows List Sidebar */}
        <WorkflowSidebar
          items={items}
          loading={loading}
          selectedId={selectedId}
          runningIds={runningIds}
          sidebarCollapsed={sidebarCollapsed}
          credits={credits}
          updates={updates}
          onUpdate={handleUpdateWorkflow}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
          onCreate={create}
          onImport={() => setShowImport(true)}
          onMarketplace={() => setShowMarketplace(true)}
          onSelect={load}
          onDelete={async (id) => {
            await (window as any).desktopAPI?.workflowsDelete?.(id);
            if (selectedId === id) { setSelectedId(""); setModel(null); }
            await refresh();
          }}
          onDashboard={() => (window as any).desktopAPI?.openDashboard?.()}
        />

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0 bg-slate-50/50 relative z-0">
          {selectedId && model ? (
            <div className="flex-1 flex min-h-0">

              {/* AI MODE: Split View */}
              {viewMode === 'ai' && (
                <>
                  {/* Left: Chat History */}
                  <div
                    className="bg-white border-r border-slate-200 flex flex-col shrink-0 z-20 shadow-sm relative min-h-0"
                    style={{ width: aiLeftWidth }}
                  >
                    <ChatHistory
                      messages={chat.messages}
                      streamItems={chat.streamItems}
                      reasoningText={chat.reasoningText}
                      showReasoning={chat.showReasoning}
                      setShowReasoning={chat.setShowReasoning}
                      busy={chat.busy}
                      onUndo={applyModel}
                      selectedModelId={workflowChatModelId}
                      onSelectModel={setWorkflowChatModelId}
                    />
                  </div>

                  <div
                    className="w-1 hover:w-1.5 bg-slate-200/50 hover:bg-indigo-400/50 cursor-col-resize shrink-0 transition-all duration-200"
                    onMouseDown={startResizeAiLeft}
                    onDoubleClick={() => setAiLeftWidth(350)}
                  />

                  {/* Center: Canvas + Floating Input */}
                  <div className="flex-1 flex flex-col min-h-0 min-w-0 relative">
                    {/* Canvas */}
                    <div className="flex-1 relative h-full">
                      <WorkflowCanvas
                        model={model}
                        selectedId={selectedId}
                        selectedNodeId={selectedNodeId}
                        connectingFrom={connectingFrom}
                        executionState={executionState}
                        size={size}
                        canvasRef={canvasRef}
                        alignmentGuides={alignmentGuides}
                        zoom={zoom}
                        selectedWireIndex={selectedWireIndex}
                        onWheel={handleWheel}
                        onZoomIn={zoomIn}
                        onZoomOut={zoomOut}
                        onZoomReset={zoomReset}
                        onAutoOrganize={autoOrganize}
                        onDragOver={e => e.preventDefault()}
                        onDrop={handleDrop}
                        onMouseMove={handleMM}
                        onMouseUp={() => { setDragging(null); setAlignmentGuides([]); }}
                        onMouseLeave={() => { setDragging(null); setAlignmentGuides([]); }}
                        onCanvasClick={() => { setSelectedNodeId(""); setConnectingFrom(""); setSelectedWireIndex(null); }}
                        onNodeSelect={(id: string) => { setSelectedNodeId(id); setSelectedWireIndex(null); }}
                        onNodeMouseDown={handleNodeMD}
                        onNodeContextMenu={handleNodeContextMenu}
                        onNodeConnect={handleConnect}
                        onWireSelect={(i: number) => { setSelectedWireIndex(i); setSelectedNodeId(""); setRightPanel('inspector'); }}
                        onWireDelete={(i: number) => { if (model) updateModel({ ...model, wires: model.wires.filter((_, j) => j !== i) }); setSelectedWireIndex(null); }}
                        onCanvasContextMenu={handleCanvasContextMenu}
                      />
                    </div>

                    {/* ChatInput - Floating at bottom */}
                    <div className="absolute bottom-6 left-0 right-0 z-30 px-6 flex justify-center pointer-events-none">
                      <div className="w-full max-w-2xl pointer-events-auto">
                        <ChatInput
                          onSend={chat.sendMessage}
                          busy={chat.busy}
                        />
                      </div>
                    </div>

                    {/* Logs Overlay */}
                    <WorkflowLogs
                      logs={logs}
                      isOpen={showLogs}
                      onToggle={() => setShowLogs(!showLogs)}
                      onClear={() => setLogs([])}
                      onSendToChat={(text: string) => {
                        chat.sendMessage(text);
                      }}
                    />
                  </div>

                  {/* Right: RightPanel - AI Mode */}
                  {rightPanel !== 'none' && (
                    <>
                      <div
                        className="w-1 hover:w-1.5 bg-slate-200/50 hover:bg-indigo-400/50 cursor-col-resize shrink-0 transition-all duration-200"
                        onMouseDown={startResizeManualRight}
                        onDoubleClick={() => setManualRightWidth(320)}
                      />
                      <div
                        className="bg-white border-l border-slate-200 flex flex-col shrink-0 z-20 shadow-xl relative transition-all duration-300 min-h-0"
                        style={{ width: manualRightWidth }}
                      >
                        {rightPanel === 'inspector' && (
                          <PanelErrorBoundary name="Inspector">
                            {selectedWireIndex !== null ? (
                              <WireInspectorPanel
                                model={model}
                                wireIndex={selectedWireIndex}
                                onUpdate={updateModel}
                                onDelete={() => { updateModel({ ...model, wires: model.wires.filter((_, j) => j !== selectedWireIndex) }); setSelectedWireIndex(null); }}
                                onClose={() => { setRightPanel('none'); setSelectedWireIndex(null); }}
                              />
                            ) : (
                              <InspectorPanel model={model} selectedNodeId={selectedNodeId} onUpdate={updateModel} onDelete={delNode} onClose={() => setRightPanel('none')} />
                            )}
                          </PanelErrorBoundary>
                        )}
                        {rightPanel === 'code' && (
                          <PanelErrorBoundary name="Code">
                            <CodePanel model={model} errors={errors} onClose={() => setRightPanel('none')} onUpdateModel={updateModel} />
                          </PanelErrorBoundary>
                        )}
                      </div>
                    </>
                  )}
                </>
              )}

              {/* MANUAL MODE: Split View */}
              {viewMode === 'manual' && (
                <>
                  {/* Left: ToolPalette */}
                  <div className="w-64 bg-white border-r border-slate-200 flex flex-col shrink-0 z-10 min-h-0 shadow-[4px_0_24px_-12px_rgba(0,0,0,0.1)]">
                    <ToolPalette
                      onDragStart={(e, item) => e.dataTransfer.setData('text/plain', JSON.stringify(item))}
                      disabled={model.locked}
                    />
                  </div>

                  {/* Center: Canvas */}
                  <div className="flex-1 flex flex-col min-h-0 min-w-0 relative">
                    {/* Canvas */}
                    <div className="flex-1 relative h-full">
                      <WorkflowCanvas
                        model={model}
                        selectedId={selectedId}
                        selectedNodeId={selectedNodeId}
                        connectingFrom={connectingFrom}
                        executionState={executionState}
                        size={size}
                        canvasRef={canvasRef}
                        alignmentGuides={alignmentGuides}
                        zoom={zoom}
                        selectedWireIndex={selectedWireIndex}
                        onWheel={handleWheel}
                        onZoomIn={zoomIn}
                        onZoomOut={zoomOut}
                        onZoomReset={zoomReset}
                        onAutoOrganize={autoOrganize}
                        onDragOver={e => e.preventDefault()}
                        onDrop={handleDrop}
                        onMouseMove={handleMM}
                        onMouseUp={() => { setDragging(null); setAlignmentGuides([]); }}
                        onMouseLeave={() => { setDragging(null); setAlignmentGuides([]); }}
                        onCanvasClick={() => { setSelectedNodeId(""); setConnectingFrom(""); setSelectedWireIndex(null); }}
                        onNodeSelect={(id: string) => { setSelectedNodeId(id); setSelectedWireIndex(null); }}
                        onNodeMouseDown={handleNodeMD}
                        onNodeContextMenu={handleNodeContextMenu}
                        onNodeConnect={handleConnect}
                        onWireSelect={(i: number) => { setSelectedWireIndex(i); setSelectedNodeId(""); setRightPanel('inspector'); }}
                        onWireDelete={(i: number) => { if (model) updateModel({ ...model, wires: model.wires.filter((_, j) => j !== i) }); setSelectedWireIndex(null); }}
                        onCanvasContextMenu={handleCanvasContextMenu}
                      />
                    </div>

                    {/* Logs Overlay */}
                    <WorkflowLogs
                      logs={logs}
                      isOpen={showLogs}
                      onToggle={() => setShowLogs(!showLogs)}
                      onClear={() => setLogs([])}
                      onSendToChat={(text: string) => {
                        chat.sendMessage(text);
                        setRightPanel('ai');
                      }}
                    />
                  </div>

                  {/* Right: RightPanel */}
                  {rightPanel !== 'none' && (
                    <>
                      <div
                        className="w-1 hover:w-1.5 bg-slate-200/50 hover:bg-indigo-400/50 cursor-col-resize shrink-0 transition-all duration-200"
                        onMouseDown={startResizeManualRight}
                        onDoubleClick={() => setManualRightWidth(320)}
                      />
                      <div
                        className="bg-white border-l border-slate-200 flex flex-col shrink-0 z-20 shadow-xl relative transition-all duration-300 min-h-0"
                        style={{ width: manualRightWidth }}
                      >
                        {rightPanel === 'inspector' && (
                          <PanelErrorBoundary name="Inspector">
                            {selectedWireIndex !== null ? (
                              <WireInspectorPanel
                                model={model}
                                wireIndex={selectedWireIndex}
                                onUpdate={updateModel}
                                onDelete={() => { updateModel({ ...model, wires: model.wires.filter((_, j) => j !== selectedWireIndex) }); setSelectedWireIndex(null); }}
                                onClose={() => { setRightPanel('none'); setSelectedWireIndex(null); }}
                              />
                            ) : (
                              <InspectorPanel model={model} selectedNodeId={selectedNodeId} onUpdate={updateModel} onDelete={delNode} onClose={() => setRightPanel('none')} />
                            )}
                          </PanelErrorBoundary>
                        )}
                        {rightPanel === 'code' && (
                          <PanelErrorBoundary name="Code">
                            <CodePanel model={model} errors={errors} onClose={() => setRightPanel('none')} onUpdateModel={updateModel} />
                          </PanelErrorBoundary>
                        )}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          ) : loading ? (
            <div className="flex-1 flex items-center justify-center bg-slate-50">
              <div className="text-center max-w-sm px-6">
                <div className="w-12 h-12 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin mx-auto mb-6" />
                <h2 className="text-lg font-semibold text-slate-900 mb-2">Loading workspace...</h2>
                <p className="text-sm text-slate-500">Getting your workflows ready.</p>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center bg-[#f8fafc]">
              <div className="text-center max-w-md px-8 py-12 bg-white rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-100">
                <div className="w-20 h-20 bg-indigo-50 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-inner">
                  <Icons.Wand className="w-10 h-10 text-indigo-600" />
                </div>
                <h2 className="text-2xl font-bold text-slate-900 mb-3 tracking-tight">Ready to Automate?</h2>
                <p className="text-slate-500 mb-8 leading-relaxed">
                  Select a workflow from the list or create a new one to start building with your AI Architect.
                </p>
                <div className="flex gap-3 justify-center">
                  <button
                    onClick={create}
                    className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition-all hover:scale-[1.02] active:scale-[0.98]"
                  >
                    <Icons.Plus className="w-5 h-5" />
                    New Workflow
                  </button>
                  <button
                    onClick={() => setShowMarketplace(true)}
                    className="inline-flex items-center gap-2 px-6 py-3 bg-white text-slate-700 border border-slate-200 rounded-xl text-sm font-semibold hover:bg-slate-50 hover:border-slate-300 transition-all"
                  >
                    <Icons.Rocket className="w-5 h-5 text-violet-500" />
                    Browse Store
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Context Menu Overlay */}
      {contextMenu && (
        <div className="fixed inset-0 z-[100]" onClick={() => setContextMenu(null)}>
          <div
            className="absolute bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 min-w-[180px] animate-in fade-in zoom-in-95 duration-100"
            style={{ top: Math.min(contextMenu.y, window.innerHeight - 200), left: Math.min(contextMenu.x, window.innerWidth - 200) }}
            onClick={e => e.stopPropagation()}
          >
            {contextMenu.type === 'node' && contextMenu.nodeId ? (
              <>
                {/* Run options - always available */}
                {(() => {
                  const isTrigger = model?.triggers.some(t => t.id === contextMenu.nodeId);
                  return (
                    <>
                      {!isTrigger && (
                        <button
                          onClick={() => {
                            runStep(contextMenu.nodeId!);
                            setContextMenu(null);
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-emerald-50 flex items-center gap-2.5 transition-colors"
                        >
                          <Icons.Play className="w-4 h-4 text-emerald-500" />
                          <span>Run Step</span>
                        </button>
                      )}
                      <button
                        onClick={() => {
                          runFromHere(contextMenu.nodeId!);
                          setContextMenu(null);
                        }}
                        className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-indigo-50 flex items-center gap-2.5 transition-colors"
                      >
                        <Icons.SkipForward className="w-4 h-4 text-indigo-500" />
                        <span>{isTrigger ? 'Run from Trigger' : 'Run from Here'}</span>
                      </button>
                      <div className="h-px bg-slate-100 my-1" />
                    </>
                  );
                })()}

                {model?.locked ? (
                  <div className="px-3 py-2 text-xs text-slate-400 flex items-center gap-2">
                    <Icons.Lock className="w-3.5 h-3.5" />
                    <span>Editing locked</span>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        duplicateNode();
                        setContextMenu(null);
                      }}
                      className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 transition-colors"
                    >
                      <Icons.Copy className="w-4 h-4 text-slate-400" />
                      <span>Duplicate</span>
                      <span className="ml-auto text-[10px] font-medium text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">Ctrl+D</span>
                    </button>

                    <div className="h-px bg-slate-100 my-1" />

                    <button
                      onClick={() => {
                        delNode();
                        setContextMenu(null);
                      }}
                      className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2.5 transition-colors group"
                    >
                      <Icons.Trash className="w-4 h-4 text-red-400 group-hover:text-red-500" />
                      <span>Delete</span>
                      <span className="ml-auto text-[10px] font-medium text-red-300 bg-red-50 px-1.5 py-0.5 rounded border border-red-100 group-hover:text-red-500 group-hover:border-red-200">Del</span>
                    </button>
                  </>
                )}
              </>
            ) : (
              <>
                <button
                  onClick={() => {
                    autoOrganize();
                    setContextMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-indigo-50 flex items-center gap-2.5 transition-colors"
                >
                  <Icons.LayoutGrid className="w-4 h-4 text-indigo-400" />
                  <span>Auto Arrange</span>
                </button>

                <button
                  onClick={() => {
                    zoomReset();
                    setContextMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 transition-colors"
                >
                  <Icons.Maximize2 className="w-4 h-4 text-slate-400" />
                  <span>Fit to Screen</span>
                </button>

                <div className="h-px bg-slate-100 my-1" />

                <button
                  onClick={() => {
                    zoomIn();
                    setContextMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 transition-colors"
                >
                  <Icons.ZoomIn className="w-4 h-4 text-slate-400" />
                  <span>Zoom In</span>
                </button>

                <button
                  onClick={() => {
                    zoomOut();
                    setContextMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 transition-colors"
                >
                  <Icons.ZoomOut className="w-4 h-4 text-slate-400" />
                  <span>Zoom Out</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Deploy Panel Modal */}
      {showDeployPanel && model && (
        <DeployPanelModal
          model={model}
          deployStatus={deployStatus}
          onClose={() => setShowDeployPanel(false)}
          onDeploy={deploy}
          onUndeploy={undeploy}
          onExport={exportWorkflow}
          onPublish={() => setShowPublish(true)}
        />
      )}

      {/* Import Modal */}
      {showImport && (
        <ImportJsonModal
          importJson={importJson}
          setImportJson={setImportJson}
          importErr={importErr}
          onClose={() => { setShowImport(false); setImportJson(''); setImportErr(''); }}
          onOpenMarketplace={() => { setShowImport(false); setShowMarketplace(true); }}
          onImport={async () => {
            setImportErr('');
            try {
              const d = JSON.parse(importJson);
              const newId = d.id || 'flow_' + Date.now().toString(36);
              const m = specToDesignerModel({ ...d, id: newId });
              await (window as any).desktopAPI?.workflowsSave?.(newId, JSON.stringify(m, null, 2));
              await refresh();
              await load(newId);
              setShowImport(false);
              setImportJson('');
            } catch (e: any) {
              setImportErr(e?.message || 'Invalid JSON');
            }
          }}
        />
      )}

      {/* Publish to Marketplace Modal */}
      {showPublish && model && (
        <PublishModal
          model={model}
          onClose={() => setShowPublish(false)}
          onSuccess={() => { /* Could show a toast or refresh */ }}
        />
      )}

      {showMarketplace && (
        <MarketplaceBrowser
          onClose={() => {
            setShowMarketplace(false);
            setMarketplaceSlug(undefined);
          }}
          onImport={importFromMarketplace}
          initialSlug={marketplaceSlug}
        />
      )}

      {/* My Published Workflows Modal */}
      {showMyPublished && (
        <MyPublishedWorkflowsModal
          onClose={() => setShowMyPublished(false)}
          onUpdateWorkflow={(workflow) => {
            // Close this modal and open publish modal with the workflow to update
            setShowMyPublished(false);
            // The PublishModal handles detecting if it's an update
            setShowPublish(true);
          }}
        />
      )}

      {/* Workflow Update Modal (for downloaded workflows) */}
      {pendingUpdate && (
        <WorkflowUpdateModal
          update={pendingUpdate.update}
          currentWorkflowName={items.find(i => i.id === pendingUpdate.id)?.name || pendingUpdate.id}
          onClose={() => setPendingUpdate(null)}
          onUpdate={executeWorkflowUpdate}
        />
      )}
    </div>
  );
}

initPostHog();
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode><PostHogProvider client={posthog}><PanelErrorBoundary name="WorkflowsApp"><WorkflowsApp /></PanelErrorBoundary></PostHogProvider></React.StrictMode>
);
