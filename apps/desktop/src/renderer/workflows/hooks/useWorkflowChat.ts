import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../../lib/supabaseClient';
import type { ModelSourcePreference, ReasoningLevel } from '../../hooks/usePreferences';
import { mergeStreamingText } from '../../utils/streamMerge';
import { StreamItem, ToolEvent } from '../components/ChatPanel';
import { specToDesignerModel } from '../utils/conversions';
import { formatWorkflowSchematic, type WorkflowValidationIssue } from '@stuardai/workflow-core/topology';
import {
  ChatSession,
  createSession,
  getSession,
  getSessionsForWorkflow,
  saveSession,
  deleteSession as deleteStoredSession,
} from '../utils/chatStorage';

export type { StreamItem, ToolEvent };

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  images?: Array<{ path: string; name: string; dataUrl?: string; data?: string; mimeType?: string }>;
  parts?: StreamItem[];
  reasoning?: string;
  draft?: boolean;
  usage?: Record<string, any>;
  modelId?: string;
}

interface WorkspaceInfoForChat {
  workspacePath: string;
  subdirs: string[];
  files: Array<{ name: string; path: string; type: 'file' | 'directory'; size?: number }>;
}

export interface WorkflowApprovalRequest {
  id: string;
  tool: string;
  args?: Record<string, any>;
  description?: string;
}

interface UseWorkflowChatProps {
  model: any;
  onApplyModel: (model: any) => void;
  cloudAiHttp: string;
  workflowId?: string; // Required for session persistence
  initialMessages?: Message[];
  errors?: any[];
  selectedModelId?: string | 'auto';
  selectedModelSource?: ModelSourcePreference;
  selectedReasoningLevel?: ReasoningLevel;
  workspaceInfo?: WorkspaceInfoForChat | null;
}

function toFriendlyChatError(err: any): string {
  const rawCode = String(err?.code || err?.error || '').toLowerCase();
  const rawMessage = String(err?.message || err || '').trim();
  const combined = `${rawCode} ${rawMessage}`.toLowerCase();

  if (combined.includes('unauthorized') || rawCode === 'unauthorized') {
    return 'unauthorized - please sign in first.';
  }
  if (combined.includes('unknown_tool') || combined.includes('unknown tool') || combined.includes('tool not found')) {
    return 'the AI tried to use a tool that is not available in this environment.';
  }
  if (combined.includes('invalid_json') || combined.includes('tool call') && combined.includes('json')) {
    return 'the AI generated an invalid tool call payload. Please retry your request.';
  }
  if (combined.includes('timeout') || combined.includes('timed out')) {
    return 'the request timed out before completion. Please try again.';
  }
  if (rawCode === 'network_error' || combined.includes('websocket') || combined.includes('network') || combined.includes('fetch failed')) {
    return 'unable to reach the AI service right now. Please check your connection and retry.';
  }

  return rawMessage || 'something went wrong while processing your request.';
}

const MAX_MESSAGES_IN_MEMORY = 60;
const STREAM_FLUSH_MS = 90;
const MAX_ASSISTANT_TEXT_CHARS = 48_000;
const MAX_REASONING_CHARS = 18_000;
const MAX_PART_TEXT_CHARS = 18_000;
const MAX_TOOL_JSON_CHARS = 36_000;
const MAX_WORKFLOW_SNAPSHOT_JSON_CHARS = 240_000;

function clipText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n\n[truncated ${value.length - maxChars} chars]`;
}

function appendBoundedText(current: string, chunk: string, maxChars: number): string {
  if (!chunk) return current;
  if (current.length >= maxChars) return current;
  const remaining = maxChars - current.length;
  if (chunk.length <= remaining) return current + chunk;
  return `${current}${chunk.slice(0, remaining)}\n\n[truncated additional output]`;
}

function compactLargeValue(value: any, maxJsonChars = MAX_TOOL_JSON_CHARS): any {
  if (value == null) return value;
  if (typeof value === 'string') return clipText(value, Math.min(maxJsonChars, MAX_ASSISTANT_TEXT_CHARS));
  if (typeof value !== 'object') return value;

  try {
    const json = JSON.stringify(value);
    if (json.length <= maxJsonChars) return value;
  } catch {
    return '[unserializable value]';
  }

  if (Array.isArray(value)) {
    return {
      __truncated: true,
      itemCount: value.length,
      preview: value.slice(0, 24).map((item) => compactLargeValue(item, Math.max(1_000, Math.floor(maxJsonChars / 24)))),
    };
  }

  const out: Record<string, any> = {};
  for (const [key, entry] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (
      lower.includes('base64') ||
      lower === 'data' ||
      lower === 'dataurl' ||
      lower === 'imagedata' ||
      lower === 'audiodata' ||
      lower === 'videodata' ||
      lower === 'buffer'
    ) {
      out[key] = typeof entry === 'string' ? `[omitted ${entry.length} chars]` : '[omitted binary payload]';
      continue;
    }
    if (lower === 'workflow' || lower === 'spec') {
      const spec: any = entry;
      out[`${key}Summary`] = spec && typeof spec === 'object'
        ? {
          triggers: Array.isArray(spec.triggers) ? spec.triggers.length : undefined,
          nodes: Array.isArray(spec.nodes) ? spec.nodes.length : undefined,
          steps: Array.isArray(spec.steps) ? spec.steps.length : undefined,
          wires: Array.isArray(spec.wires) ? spec.wires.length : undefined,
        }
        : '[omitted large workflow payload]';
      continue;
    }
    out[key] = compactLargeValue(entry, Math.max(1_000, Math.floor(maxJsonChars / 8)));
  }
  out.__truncated = true;
  return out;
}

function compactToolResult(tool: string, result: any): any {
  if (!result || typeof result !== 'object') return compactLargeValue(result);
  const normalizedTool = String(tool || '').toLowerCase();
  if (normalizedTool === 'workflow_modify' || normalizedTool === 'modify_workflow' || normalizedTool === 'create_workflow') {
    const workflow = result.workflow || result.spec;
    return {
      ok: result.ok,
      message: result.message || (workflow ? 'Updates applied successfully' : undefined),
      error: result.error,
      errorDetails: compactLargeValue(result.errorDetails, 10_000),
      changes: compactLargeValue(result.changes, 16_000),
      diagram: compactLargeValue(result.diagram, 16_000),
      affectedFlow: compactLargeValue(result.affectedFlow, 16_000),
      workflowSummary: workflow && typeof workflow === 'object'
        ? {
          triggers: Array.isArray(workflow.triggers) ? workflow.triggers.length : undefined,
          nodes: Array.isArray(workflow.nodes) ? workflow.nodes.length : undefined,
          steps: Array.isArray(workflow.steps) ? workflow.steps.length : undefined,
          wires: Array.isArray(workflow.wires) ? workflow.wires.length : undefined,
        }
        : undefined,
    };
  }
  return compactLargeValue(result);
}

function compactStreamItem(item: StreamItem): StreamItem {
  if (item.type === 'text') return { type: 'text', content: clipText(item.content || '', MAX_PART_TEXT_CHARS) };
  if (item.type === 'reasoning') return { type: 'reasoning', content: clipText(item.content || '', MAX_REASONING_CHARS) };
  return {
    type: 'tool',
    event: {
      ...item.event,
      args: compactLargeValue(item.event.args, 10_000),
      argsText: typeof item.event.argsText === 'string' ? clipText(item.event.argsText, 10_000) : item.event.argsText,
      result: compactToolResult(item.event.tool, item.event.result),
      workflowBefore: item.event.workflowBefore,
    },
  };
}

function compactStreamItems(items: StreamItem[]): StreamItem[] {
  return items.slice(-80).map(compactStreamItem);
}

function trimMessagesForMemory(messages: Message[]): Message[] {
  if (messages.length <= MAX_MESSAGES_IN_MEMORY) return messages;
  const first = messages[0]?.role === 'assistant' ? [messages[0]] : [];
  return [...first, ...messages.slice(-(MAX_MESSAGES_IN_MEMORY - first.length))];
}

function cloneWorkflowSnapshot(workflow: any): any {
  if (!workflow) return undefined;
  try {
    const json = JSON.stringify(workflow);
    if (json.length > MAX_WORKFLOW_SNAPSHOT_JSON_CHARS) return undefined;
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

export function useWorkflowChat({
  model,
  onApplyModel,
  cloudAiHttp,
  workflowId,
  initialMessages = [],
  errors = [],
  selectedModelId = 'auto',
  selectedModelSource = 'stuard',
  selectedReasoningLevel = 'high',
  workspaceInfo,
}: UseWorkflowChatProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [streamItems, setStreamItems] = useState<StreamItem[]>([]);
  const [reasoningText, setReasoningText] = useState('');
  const [busy, setBusy] = useState(false);
  const [showReasoning, setShowReasoning] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState<WorkflowApprovalRequest[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const abortedRef = useRef(false);
  const approvalResolversRef = useRef<Map<string, { resolve: (allow: boolean) => void; timer: number }>>(new Map());

  const WORKFLOW_APPROVAL_TOOLS = useMemo(() => new Set([
    'workspace_write_file',
    'workspace_delete_file',
    'workspace_create_folder',
  ]), []);

  const describeApprovalRequest = useCallback((tool: string, args: any): string => {
    const path = String(args?.path || args?.filePath || args?.folder || '').trim();
    if (typeof args?.description === 'string' && args.description.trim()) return args.description.trim();
    if (tool === 'workspace_write_file') return path ? `Write ${path} in this workflow workspace.` : 'Write a file in this workflow workspace.';
    if (tool === 'workspace_delete_file') return path ? `Delete ${path} from this workflow workspace.` : 'Delete a file from this workflow workspace.';
    if (tool === 'workspace_create_folder') return path ? `Create ${path} in this workflow workspace.` : 'Create a folder in this workflow workspace.';
    return 'This action needs your approval before it can continue.';
  }, []);

  const queueApproval = useCallback((approval: WorkflowApprovalRequest) => {
    setPendingApprovals(prev => prev.some(p => p.id === approval.id) ? prev : [...prev, approval]);
  }, []);

  const requestLocalToolApproval = useCallback((approval: WorkflowApprovalRequest): Promise<boolean> => {
    queueApproval(approval);
    return new Promise<boolean>((resolve) => {
      const timer = window.setTimeout(() => {
        approvalResolversRef.current.delete(approval.id);
        setPendingApprovals(prev => prev.filter(p => p.id !== approval.id));
        resolve(false);
      }, 60_000);
      approvalResolversRef.current.set(approval.id, { resolve, timer });
    });
  }, [queueApproval]);

  const respondToApproval = useCallback((id: string, allow: boolean) => {
    const pending = approvalResolversRef.current.get(id);
    if (pending) {
      window.clearTimeout(pending.timer);
      approvalResolversRef.current.delete(id);
      pending.resolve(allow);
    } else {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ type: 'approval_response', id, allow })); } catch { }
      }
    }
    setPendingApprovals(prev => prev.filter(p => p.id !== id));
  }, []);

  useEffect(() => {
    return () => {
      for (const pending of approvalResolversRef.current.values()) {
        window.clearTimeout(pending.timer);
        pending.resolve(false);
      }
      approvalResolversRef.current.clear();
    };
  }, []);

  // Session management - workflow-scoped
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [pastSessions, setPastSessions] = useState<ChatSession[]>([]);
  const [showSessionHistory, setShowSessionHistory] = useState(false);

  // Load sessions when workflow changes
  useEffect(() => {
    if (!workflowId) {
      setPastSessions([]);
      setCurrentSessionId(null);
      return;
    }
    // Load past sessions for this workflow
    const sessions = getSessionsForWorkflow(workflowId);
    setPastSessions(sessions);
    // Create a new session for this workflow
    const newSession = createSession(workflowId);
    setCurrentSessionId(newSession.id);
    // Reset messages with welcome
    setMessages([{ role: 'assistant', content: 'Hi! I\'m your Workflow Architect. Describe what you want to change or add to this workflow.' }]);
  }, [workflowId]);

  // Save completed chat state, not every live stream chunk. Persisting draft
  // deltas during generation was a large source of stringify churn and RAM use.
  useEffect(() => {
    if (!currentSessionId) return;
    if (messages.length <= 1) return;

    const timer = window.setTimeout(() => {
      const storableMessages = trimMessagesForMemory(messages).map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? clipText(m.content, MAX_ASSISTANT_TEXT_CHARS) : '',
        images: Array.isArray(m.images)
          ? m.images.map(img => ({ path: img.path, name: img.name, mimeType: img.mimeType }))
          : undefined,
        parts: Array.isArray(m.parts) ? compactStreamItems(m.parts as StreamItem[]) : undefined,
        reasoning: typeof m.reasoning === 'string' ? clipText(m.reasoning, MAX_REASONING_CHARS) : undefined,
        draft: undefined,
        usage: m.usage,
        modelId: m.modelId,
      }));
      saveSession(currentSessionId, storableMessages);
      if (workflowId) {
        setPastSessions(getSessionsForWorkflow(workflowId));
      }
    }, busy ? 2_000 : 250);

    return () => window.clearTimeout(timer);
  }, [messages, currentSessionId, workflowId, busy]);

  // Create a new chat session for current workflow
  const newSession = useCallback(() => {
    if (!workflowId) return;
    const session = createSession(workflowId);
    setCurrentSessionId(session.id);
    setMessages([{ role: 'assistant', content: 'Hi! I\'m your Workflow Architect. Describe what you want to change or add to this workflow.' }]);
    setStreamItems([]);
    setReasoningText('');
    setBusy(false);
    setPastSessions(getSessionsForWorkflow(workflowId));
    setShowSessionHistory(false);
  }, [workflowId]);

  // Load a past session
  const loadSession = useCallback((sessionId: string) => {
    const session = getSession(sessionId);
    if (!session) return;
    setCurrentSessionId(session.id);
    // Restore messages (add parts/images placeholders)
    const restoredMessages: Message[] = session.messages.map(m => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
      images: m.images,
      parts: m.parts as StreamItem[] | undefined,
      reasoning: m.reasoning,
      draft: m.draft,
      usage: m.usage,
      modelId: m.modelId,
    }));
    setMessages(restoredMessages.length > 0 ? restoredMessages : [
      { role: 'assistant', content: 'Hi! I\'m your Workflow Architect. Describe what you want to change or add to this workflow.' }
    ]);
    setStreamItems([]);
    setReasoningText('');
    setBusy(false);
    setShowSessionHistory(false);
  }, []);

  // Delete a session
  const deleteSession = useCallback((sessionId: string) => {
    deleteStoredSession(sessionId);
    if (workflowId) {
      setPastSessions(getSessionsForWorkflow(workflowId));
    }
    // If deleting current session, start a new one
    if (sessionId === currentSessionId && workflowId) {
      const session = createSession(workflowId);
      setCurrentSessionId(session.id);
      setMessages([{ role: 'assistant', content: 'Hi! I\'m your Workflow Architect. Describe what you want to change or add to this workflow.' }]);
      setStreamItems([]);
      setReasoningText('');
      setBusy(false);
    }
  }, [currentSessionId, workflowId]);

  // Initialize welcome message (only if no workflowId - legacy behavior)
  useEffect(() => {
    if (!workflowId && messages.length === 0) {
      setMessages([{ role: 'assistant', content: 'Hi! I\'m your Workflow Architect. Describe what you want to change or add to this workflow.' }]);
    }
  }, [workflowId]);

  const sendMessage = useCallback(async (text: string, attachedImages: any[] = []) => {
    if (!text && attachedImages.length === 0) return;
    if (busy) return;

    // Reset streaming state
    setStreamItems([]);
    setReasoningText("");
    setShowReasoning(false);
    setBusy(true);

    // Add user message
    const imageRefs = attachedImages.length > 0
      ? `\n\n[Attached ${attachedImages.length} image(s) for reference: ${attachedImages.map((i: any) => i.name).join(', ')}]`
      : '';
    const displayContent = text + imageRefs;
    const newMessages = trimMessagesForMemory([...messages, { role: 'user' as const, content: displayContent, images: attachedImages }]);
    setMessages(newMessages);

    // Declare outside try so catch can access accumulated work for error recovery
    let fullText = "";
    let currentItems: StreamItem[] = [];
    let currentReasoning = "";
    let finalUsage: Record<string, any> | undefined;
    let finalModelId: string | undefined;
    let streamFlushTimer: number | null = null;

    const flushStreamState = () => {
      if (streamFlushTimer !== null) {
        window.clearTimeout(streamFlushTimer);
        streamFlushTimer = null;
      }
      setStreamItems(compactStreamItems(currentItems));
      setReasoningText(clipText(currentReasoning, MAX_REASONING_CHARS));
    };

    const scheduleStreamState = () => {
      if (streamFlushTimer !== null) return;
      streamFlushTimer = window.setTimeout(() => {
        streamFlushTimer = null;
        setStreamItems(compactStreamItems(currentItems));
        setReasoningText(clipText(currentReasoning, MAX_REASONING_CHARS));
      }, STREAM_FLUSH_MS);
    };

    try {
      // Build context prompts (reused from ChatPanel)
      const designerModel = model || {};
      const hasErrors = errors.length > 0;
      const errorCount = errors.filter((e: any) => e.type === 'error').length;
      const warnCount = errors.filter((e: any) => e.type === 'warning').length;

      let debugSection = '';
      if (hasErrors) {
        debugSection = `
═══════════════════════════════════════════════════════════════════════════════
DEBUG INFO - ${errorCount} errors, ${warnCount} warnings
═══════════════════════════════════════════════════════════════════════════════

${errors.map((e: any) => `${e.type === 'error' ? '❌' : '⚠️'} ${e.message}${e.nodeId ? ` [node: ${e.nodeId}]` : ''}`).join('\n')}

IMPORTANT: Fix these validation errors FIRST before making other changes.
`;
      }

      const wiresArr = Array.isArray(designerModel.wires) ? designerModel.wires : [];
      const validationIssues: WorkflowValidationIssue[] = Array.isArray(errors)
        ? errors
          .filter((issue: any) => issue && typeof issue.message === 'string' && (issue.type === 'error' || issue.type === 'warning'))
          .map((issue: any) => ({
            type: issue.type,
            message: issue.message,
            nodeId: typeof issue.nodeId === 'string' ? issue.nodeId : undefined,
            wireId: typeof issue.wireId === 'string' ? issue.wireId : undefined,
          }))
        : [];
      const wiresSummary = wiresArr.length > 0
        ? `Connections (wires): ${wiresArr.map((w: any) => `${w.from} → ${w.to}${w.guard ? ` [${w.guard}]` : ''}`).join(', ')}`
        : 'Connections (wires): NONE - nodes are not connected!';

      const structureSummary = `
Structure: ${designerModel.triggers?.length || 0} triggers, ${designerModel.nodes?.length || 0} nodes, ${wiresArr.length} wires
Trigger IDs: ${(designerModel.triggers || []).map((t: any) => t.id).join(', ') || 'none'}
Node IDs: ${(designerModel.nodes || []).map((n: any) => n.id).join(', ') || 'none'}
${wiresSummary}
`;

      const imageSection = attachedImages.length > 0
        ? `\n\nUser has attached ${attachedImages.length} reference image(s):\n${attachedImages.map((img: any) => `- ${img.name}: ${img.path}`).join('\n')}\nThese images are available for visual context. Use analyze_media tool if you need to analyze them.`
        : '';

      // Build workspace path section
      let workspaceSection = '';
      if (workspaceInfo?.workspacePath) {
        const fileTree = (workspaceInfo.files || []).map((f: any) => {
          const rel = f.path.replace(/\\/g, '/').replace(workspaceInfo.workspacePath.replace(/\\/g, '/') + '/', '');
          return `  ${f.type === 'directory' ? '📁' : '📄'} ${rel}${f.size ? ` (${f.size} bytes)` : ''}`;
        }).join('\n');
        workspaceSection = `\n═══════════════════════════════════════════════════
WORKSPACE PATHS
═══════════════════════════════════════════════════
workspacePath: ${workspaceInfo.workspacePath.replace(/\\/g, '/')}
subdirs: ${(workspaceInfo.subdirs || []).join(', ')}
Files:\n${fileTree || '  (empty workspace)'}\n`;
      }

      const workflowSchematic = formatWorkflowSchematic(designerModel, {
        validationIssues,
      });

      // Build context as a separate system message, and keep user request clean
      const workflowContextText = `${debugSection ? debugSection + '\n' : ''}${workflowSchematic}${workspaceSection}${hasErrors ? '\nPRIORITY: If user asks for changes, fix the validation errors shown above first.' : ''}${wiresArr.length === 0 ? '\nNOTE: Wires are missing - nodes are not connected!' : ''}${imageSection}`;

      // User's actual request is kept separate
      const userRequest = text;

      // Auth
      let accessToken: string | undefined;
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        accessToken = sessionData?.session?.access_token || undefined;
      } catch {
        accessToken = undefined;
      }

      // WebSocket URL
      const base = String(cloudAiHttp || "").replace(/\/$/, "");
      let wsUrl = "";
      try {
        if (base.startsWith("https://")) {
          wsUrl = "wss://" + base.slice("https://".length).replace(/\/$/, "") + "/ws";
        } else if (base.startsWith("http://")) {
          wsUrl = "ws://" + base.slice("http://".length).replace(/\/$/, "") + "/ws";
        } else {
          wsUrl = base.replace(/\/$/, "") + "/ws";
        }
      } catch {
        wsUrl = base.replace(/^http/, "ws").replace(/\/$/, "") + "/ws";
      }
      if (wsUrl.indexOf("?") === -1) {
        wsUrl = wsUrl + "?client=workflow_ui";
      } else if (!/([?&])client=/.test(wsUrl)) {
        wsUrl = wsUrl + "&client=workflow_ui";
      }

      // Execute Chat
      abortedRef.current = false;
      await new Promise<void>((resolve, reject) => {
        let done = false;
        let malformedEventCount = 0;
        let ws: WebSocket;
        try {
          ws = new WebSocket(wsUrl);
          wsRef.current = ws;
        } catch (err) {
          reject(err);
          return;
        }

        ws.onopen = () => {
          try {
            // Build messages with context as a system message, user request as user message
            const conversationMessages = newMessages.filter(m => m.role !== 'system').map(m => {
              // Only send role + content to cloud-ai. Do NOT include 'parts' or 'reasoning'
              // as those are UI-only fields. Gemini treats 'parts' as a reserved field name
              // and will reject messages with non-standard parts objects.
              return { role: m.role, content: m.content };
            });

            // Insert workflow context as a system message before the conversation
            const messagesWithContext = [
              { role: 'system', content: workflowContextText },
              ...conversationMessages.slice(0, -1), // All messages except the last user message
              { role: 'user', content: userRequest } // The actual user request
            ];

            const payloadContext: any = { mode: 'workflow_architect' };
            if (designerModel && (designerModel.id || designerModel.triggers || designerModel.nodes)) {
              payloadContext.workflow = designerModel;
              if (designerModel.id) payloadContext.workflowId = designerModel.id;
            }
            if (!payloadContext.workflowId && workflowId) {
              payloadContext.workflowId = workflowId;
            }
            if (workspaceInfo?.workspacePath) {
              payloadContext.workspacePath = workspaceInfo.workspacePath.replace(/\\/g, '/');
              payloadContext.workspaceSubdirs = workspaceInfo.subdirs || [];
              payloadContext.workspaceFiles = (workspaceInfo.files || []).map((f: any) => ({
                name: f.name, path: f.path.replace(/\\/g, '/'), type: f.type, size: f.size
              }));
            }
            const payload: any = {
              type: "chat",
              agent: "workflow",
              messages: messagesWithContext,
              context: payloadContext,
              model: 'auto',
            };

            const hasExplicitModel = !!(selectedModelId && selectedModelId !== 'auto');
            if (hasExplicitModel) {
              payload.modelId = selectedModelId;
            }
            if (hasExplicitModel && selectedModelSource && typeof selectedModelSource === 'string') {
              payload.modelSource = selectedModelSource;
            }
            if (selectedReasoningLevel && typeof selectedReasoningLevel === 'string') {
              payload.reasoningLevel = selectedReasoningLevel;
            }
            if (accessToken) payload.auth = { accessToken };
            if (attachedImages.length > 0) {
              payload.images = attachedImages.map((img: any) => ({
                name: img.name,
                path: img.path,
                data: img.data || img.dataUrl,
                mimeType: img.mimeType
              }));
            }
            ws.send(JSON.stringify(payload));
          } catch (err) {
            done = true;
            try { ws.close(); } catch { }
            reject(err);
          }
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data as string);

            // Handle tool_request from cloud-ai - execute tools locally and send result back
            if (msg.type === 'tool_request') {
              const { id, tool, args } = msg;
              if (id && tool) {
                (async () => {
                  try {
                    let result: any = {
                      ok: false,
                      error: 'unknown_tool',
                      message: `Tool "${String(tool)}" is not available in this chat context.`
                    };
                    const normalizedTool = String(tool || '').toLowerCase();
                    const normalizedArgs = (args && typeof args === 'object') ? { ...args } : {};
                    if (normalizedTool.startsWith('workspace_') && !normalizedArgs.flowId) {
                      const activeWorkflowId = String(workflowId || model?.id || '').trim();
                      if (activeWorkflowId) normalizedArgs.flowId = activeWorkflowId;
                    }

                    if (WORKFLOW_APPROVAL_TOOLS.has(normalizedTool)) {
                      const description = describeApprovalRequest(normalizedTool, normalizedArgs);
                      const existingIdx = currentItems.findIndex(item => item.type === 'tool' && item.event.id === id);
                      const approvalEvent = {
                        ts: new Date().toISOString(),
                        tool: normalizedTool,
                        status: 'approval_required',
                        args: normalizedArgs,
                        id,
                      };
                      if (existingIdx >= 0) {
                        const existingItem = currentItems[existingIdx] as { type: 'tool'; event: ToolEvent };
                        currentItems[existingIdx] = {
                          type: 'tool',
                          event: { ...existingItem.event, ...approvalEvent },
                        };
                      } else {
                        currentItems.push({ type: 'tool', event: approvalEvent });
                      }
                      flushStreamState();

                      const allowed = await requestLocalToolApproval({
                        id,
                        tool: normalizedTool,
                        args: normalizedArgs,
                        description,
                      });
                      if (!allowed) {
                        result = { ok: false, error: 'permission_denied', denied: true };
                        if (ws.readyState === WebSocket.OPEN) {
                          ws.send(JSON.stringify({ type: 'tool_result', id, result }));
                        }
                        return;
                      }
                    }

                    // Handle simple client-side tools directly
                    if (tool === 'get_local_time') {
                      const now = new Date();
                      result = {
                        ok: true,
                        iso: now.toISOString(),
                        time: now.toLocaleTimeString(),
                        date: now.toLocaleDateString(),
                        tzName: Intl.DateTimeFormat().resolvedOptions().timeZone,
                        offsetMinutes: -now.getTimezoneOffset()
                      };
                    } else {
                      // Delegate to main process via desktopAPI
                      if ((window as any).desktopAPI?.execTool) {
                        const execResult = await (window as any).desktopAPI.execTool(tool, normalizedArgs);
                        result = execResult ?? {
                          ok: false,
                          error: 'tool_execution_failed',
                          message: `Tool "${String(tool)}" returned no response.`
                        };
                      } else {
                        result = {
                          ok: false,
                          error: 'bridge_unavailable',
                          message: 'Desktop bridge is unavailable, so local tools cannot run.'
                        };
                      }
                    }

                    // Send result back to cloud-ai
                    if (ws.readyState === WebSocket.OPEN) {
                      ws.send(JSON.stringify({ type: 'tool_result', id, result }));
                    }
                  } catch (err: any) {
                    // Send error result back
                    if (ws.readyState === WebSocket.OPEN) {
                      ws.send(JSON.stringify({
                        type: 'tool_result',
                        id,
                        result: {
                          ok: false,
                          error: 'tool_execution_failed',
                          message: String(err?.message || err),
                        }
                      }));
                    }
                  }
                })();
              }
              return; // Don't process further
            }

            if (msg.type === 'progress') {
              const evt = msg as { event: string; data: any };

              if (evt.event === 'delta') {
                const chunk = typeof evt.data?.text === 'string' ? evt.data.text : '';
                if (!chunk) return;
                fullText = appendBoundedText(fullText, chunk, MAX_ASSISTANT_TEXT_CHARS);
                const last = currentItems[currentItems.length - 1];
                if (last && last.type === 'text') {
                  currentItems[currentItems.length - 1] = {
                    ...last,
                    content: appendBoundedText(last.content, chunk, MAX_PART_TEXT_CHARS),
                  };
                } else {
                  currentItems.push({ type: 'text', content: appendBoundedText('', chunk, MAX_PART_TEXT_CHARS) });
                }
                scheduleStreamState();

              } else if (evt.event === 'reasoning' || evt.event === 'reasoning_start' || evt.event === 'reasoning_end') {
                if (evt.event === 'reasoning_start') {
                  // Open a fresh reasoning chunk so the next reasoning text starts a
                  // new inline block (separated from prior tool calls / reasoning).
                  const last = currentItems[currentItems.length - 1];
                  if (!last || last.type !== 'reasoning' || (last as any).content) {
                    currentItems.push({ type: 'reasoning', content: '' });
                    scheduleStreamState();
                  }
                  setShowReasoning(true);
                  return;
                }
                if (evt.event === 'reasoning_end') return;
                const r = typeof evt.data?.text === 'string' ? evt.data.text : '';
                if (!r) return;
                // Keep aggregated reasoningText for persisted message metadata / backward compat.
                currentReasoning = clipText(mergeStreamingText(currentReasoning, r), MAX_REASONING_CHARS);
                // Append to the last reasoning chunk if it is the most recent item,
                // otherwise open a new reasoning chunk. This way each tool call naturally
                // breaks up the chain-of-thought into separate inline blocks.
                const last = currentItems[currentItems.length - 1];
                if (last && last.type === 'reasoning') {
                  currentItems[currentItems.length - 1] = {
                    type: 'reasoning',
                    content: clipText(mergeStreamingText(last.content, r), MAX_REASONING_CHARS),
                  };
                } else {
                  currentItems.push({ type: 'reasoning', content: r });
                }
                scheduleStreamState();
                setShowReasoning(true);

              } else if (evt.event === 'tool_event') {
                const d = evt.data || {};
                let tool = String(d.tool || d.toolName || (d.step && (d.step.tool || d.step.toolName)) || 'unknown');
                // execute_tool is a wrapper — show the actual tool being executed
                if (tool === 'execute_tool' && d.args?.tool_name) {
                  tool = String(d.args.tool_name);
                }

                // Skip hidden tools (knowledge tools and internal discovery tools)
                const HIDDEN_TOOLS = [
                  'knowledge_get_identity', 'knowledge_get_directives', 'knowledge_get_bio',
                  'knowledge_list_entities', 'knowledge_search_facts', 'knowledge_get_entity_context',
                  'retrieve_tool_format', 'search_tools', 'get_tool_schema',
                  // Hide duplicate workflow tools - use run_workflow and search_local_workflows instead
                  'invoke_workflow', 'execute_workflow', 'list_local_stuards'
                ];
                if (HIDDEN_TOOLS.includes(tool)) {
                  return;
                }

                const rawStatus = typeof d.status === 'string' ? d.status : undefined;
                const normalizedStatus = rawStatus ? String(rawStatus).toLowerCase() : undefined;
                const id: string | undefined = (typeof d.toolCallId === 'string' && d.toolCallId) ? d.toolCallId : (typeof d.id === 'string' && d.id) ? d.id : undefined;
                if (normalizedStatus === 'approval_required' && id) {
                  queueApproval({
                    id,
                    tool,
                    args: (d.args && typeof d.args === 'object') ? d.args : undefined,
                    description: typeof d.description === 'string' ? d.description : describeApprovalRequest(tool, d.args || {}),
                  });
                } else if (
                  id
                  && (normalizedStatus === 'completed' || normalizedStatus === 'error' || normalizedStatus === 'failed')
                ) {
                  setPendingApprovals(prev => prev.filter(p => p.id !== id));
                }

                // Handle create_workflow - full spec
                if (tool === 'create_workflow' && normalizedStatus === 'completed') {
                  try {
                    const result = d.result;
                    if (result && result.ok === true && result.spec) {
                      let specValue: any = result.spec;
                      if (typeof specValue === 'string') {
                        try { specValue = JSON.parse(specValue); } catch { }
                      }
                      if (specValue && (Array.isArray(specValue.nodes) || Array.isArray(specValue.triggers))) {
                        const newModel = specToDesignerModel(specValue);
                        onApplyModel(newModel);
                      }
                    }
                  } catch (e) { }
                }

                // Handle workflow_modify / modify_workflow - returns modified workflow directly
                // IMPORTANT: Apply immediately when we receive the completed event, don't wait for stream end
                if ((tool === 'workflow_modify' || tool === 'modify_workflow') && (normalizedStatus === 'completed' || normalizedStatus === 'error')) {
                  console.log('[useWorkflowChat] Received workflow_modify event:', {
                    status: normalizedStatus,
                    hasResult: !!d.result,
                    hasWorkflow: !!d.result?.workflow,
                    changes: d.result?.changes
                  });

                  try {
                    const result = d.result;
                    // Success - apply the workflow (tool returns 'workflow', not 'spec')
                    if (result && result.ok === true && result.workflow) {
                      let workflowValue: any = result.workflow;
                      if (typeof workflowValue === 'string') {
                        try { workflowValue = JSON.parse(workflowValue); } catch { }
                      }

                      // Normalize triggers - ensure it's an array (tool might return object instead)
                      if (workflowValue.triggers && !Array.isArray(workflowValue.triggers)) {
                        workflowValue.triggers = [workflowValue.triggers];
                      }

                      // workflow_modify may return DesignerModel (nodes/wires) or StuardSpec (steps/next)
                      // Always normalize through specToDesignerModel to handle both formats
                      if (workflowValue && (Array.isArray(workflowValue.nodes) || Array.isArray(workflowValue.triggers) || Array.isArray(workflowValue.steps))) {
                        const normalizedModel = specToDesignerModel(workflowValue);
                        // CRITICAL: Apply immediately - this updates the workflow canvas in real-time
                        console.log('[useWorkflowChat] APPLYING workflow_modify result NOW:', {
                          nodes: normalizedModel.nodes?.length,
                          triggers: normalizedModel.triggers?.length,
                          wires: normalizedModel.wires?.length,
                          changes: result.changes
                        });
                        onApplyModel(normalizedModel);
                      }
                    }
                    // Error - log it (UI will show the error from the tool event)
                    else if (result && result.ok === false) {
                      console.error('[useWorkflowChat] workflow_modify failed:', result.error, result.errorDetails);
                    } else {
                      console.warn('[useWorkflowChat] workflow_modify completed but no result/workflow:', { result });
                    }
                  } catch (e) {
                    console.error('[useWorkflowChat] Error applying workflow_modify result:', e);
                  }
                }

                // Update stream items
                let idx = id ? currentItems.findIndex(item => item.type === 'tool' && item.event.id === id) : -1;

                // FALLBACK: If no ID match and this is a completed workflow_modify with result,
                // find any pending workflow_modify entry and update it
                if (idx < 0 && (tool === 'workflow_modify' || tool === 'modify_workflow') && normalizedStatus === 'completed' && d.result) {
                  idx = currentItems.findIndex(item =>
                    item.type === 'tool' &&
                    (item.event.tool === 'workflow_modify' || item.event.tool === 'modify_workflow') &&
                    !item.event.result // Find one without a result yet
                  );
                  if (idx >= 0) {
                    console.log('[useWorkflowChat] Found pending workflow_modify entry to update with result');
                  }
                }

                if (idx >= 0) {
                  const existingItem = currentItems[idx] as { type: 'tool'; event: ToolEvent };
                  const existing = existingItem.event;
                  let newArgsText = existing.argsText || '';
                  if (normalizedStatus === 'input_delta' && (d.delta || d.argsTextDelta)) {
                    newArgsText += d.delta || d.argsTextDelta;
                  } else if (d.args && typeof d.args === 'string') {
                    newArgsText = d.args;
                  }
                  currentItems[idx] = {
                    type: 'tool',
                    event: {
                      ...existing,
                      status: rawStatus || existing.status,
                      args: compactLargeValue(d.args ?? existing.args, 10_000),
                      argsText: typeof newArgsText === 'string' ? clipText(newArgsText, 10_000) : newArgsText,
                      result: d.result !== undefined ? compactToolResult(tool, d.result) : existing.result,
                      // Preserve the workflowBefore snapshot
                      workflowBefore: existing.workflowBefore
                    }
                  };
                } else if (id) {
                  // For workflow modification tools, capture current model as snapshot for undo
                  const isModifyTool = tool === 'workflow_modify' || tool === 'modify_workflow' || tool === 'create_workflow';
                  const workflowSnapshot = isModifyTool && model ? cloneWorkflowSnapshot(model) : undefined;

                  currentItems.push({
                    type: 'tool',
                    event: {
                      ts: new Date().toISOString(),
                      tool,
                      status: rawStatus,
                      args: compactLargeValue(d.args ?? d.step ?? undefined, 10_000),
                      argsText: typeof d.args === 'string' ? clipText(d.args, 10_000) : '',
                      id,
                      result: compactToolResult(tool, d.result),
                      workflowBefore: workflowSnapshot
                    }
                  });
                }
                flushStreamState();
              }

            } else if (msg.type === 'final') {
              const result = msg.result || {};
              const textFinal = typeof result.text === 'string' && result.text.trim().length > 0 ? result.text : fullText;
              if (textFinal) fullText = textFinal;
              finalUsage = result.usage && typeof result.usage === 'object' ? result.usage : undefined;
              finalModelId = typeof result.modelId === 'string'
                ? result.modelId
                : typeof msg.model === 'string'
                  ? msg.model
                  : undefined;
              done = true;
              try { ws.close(); } catch { }
              resolve();
            } else if (msg.type === 'error') {
              done = true;
              try { ws.close(); } catch { }
              reject(new Error(msg.message || 'stream_error'));
            }
          } catch (err) {
            console.warn('[useWorkflowChat] Ignoring malformed WS event:', err);
            malformedEventCount += 1;
            if (malformedEventCount <= 1) {
              currentItems.push({
                type: 'text',
                content: '\n\n⚠️ Received an unexpected response chunk, continuing...\n',
              });
              flushStreamState();
            }
          }
        };
        ws.onerror = () => {
          if (!done) {
            done = true;
            try { ws.close(); } catch { }
            const e: any = new Error('WebSocket error');
            e.code = 'network_error';
            reject(e);
          }
        };
        ws.onclose = () => {
          if (!done) {
            done = true;
            if (abortedRef.current) {
              resolve();
              return;
            }
            const e: any = new Error('WebSocket closed unexpectedly');
            e.code = 'network_error';
            reject(e);
          }
        };
      });

      // Finish
      wsRef.current = null;
      if (streamFlushTimer !== null) {
        window.clearTimeout(streamFlushTimer);
        streamFlushTimer = null;
      }
      setStreamItems([]);
      let responseText = abortedRef.current ? (fullText || '(Stopped by user)') : (fullText || "Done.");
      let newSpec = null as any;
      if (typeof responseText === 'string') {
        const jsonMatch = responseText.match(/```json\s*(\{[\s\S]*?\})\s*```/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[1]);
            if (parsed.triggers || parsed.steps) newSpec = parsed;
          } catch { }
        }
      }
      if (newSpec) {
        const newModel = specToDesignerModel(newSpec);
        onApplyModel(newModel);
        responseText += "\n\n(Workflow updated)";
      }

      setMessages(prev => trimMessagesForMemory([...prev, {
        role: 'assistant',
        content: clipText(responseText, MAX_ASSISTANT_TEXT_CHARS),
        parts: currentItems.length > 0 ? compactStreamItems(currentItems) : undefined,
        reasoning: currentReasoning ? clipText(currentReasoning, MAX_REASONING_CHARS) : undefined,
        usage: finalUsage,
        modelId: finalModelId,
      }]));

    } catch (e: any) {
      const friendly = `Error: ${toFriendlyChatError(e)}`;
      // Preserve accumulated tool events and reasoning so users see what the AI did before failing
      setMessages(prev => trimMessagesForMemory([...prev, {
        role: 'assistant',
        content: friendly,
        parts: currentItems.length > 0 ? compactStreamItems(currentItems) : undefined,
        reasoning: currentReasoning ? clipText(currentReasoning, MAX_REASONING_CHARS) : undefined
      }]));
    } finally {
      wsRef.current = null;
      if (streamFlushTimer !== null) {
        window.clearTimeout(streamFlushTimer);
        streamFlushTimer = null;
      }
      for (const pending of approvalResolversRef.current.values()) {
        window.clearTimeout(pending.timer);
        pending.resolve(false);
      }
      approvalResolversRef.current.clear();
      setStreamItems([]);
      setReasoningText('');
      setPendingApprovals([]);
      setBusy(false);
    }
  }, [messages, busy, model, errors, cloudAiHttp, onApplyModel, selectedModelId, selectedModelSource, selectedReasoningLevel, workspaceInfo, workflowId, WORKFLOW_APPROVAL_TOOLS, describeApprovalRequest, queueApproval, requestLocalToolApproval]);

  const latestAssistantContext = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message?.role === 'assistant' && message?.usage) {
        return {
          usage: message.usage,
          modelId: message.modelId,
        };
      }
    }
    return {
      usage: undefined,
      modelId: undefined,
    };
  }, [messages]);

  const stopGeneration = useCallback(() => {
    abortedRef.current = true;
    const ws = wsRef.current;
    if (ws) {
      try { ws.close(); } catch { }
      wsRef.current = null;
    }
  }, []);

  return useMemo(() => ({
    messages,
    setMessages,
    streamItems,
    setStreamItems,
    reasoningText,
    setReasoningText,
    busy,
    setBusy,
    pendingApprovals,
    respondToApproval,
    sendMessage,
    stopGeneration,
    showReasoning,
    setShowReasoning,
    // Session management
    currentSessionId,
    pastSessions,
    showSessionHistory,
    setShowSessionHistory,
    newSession,
    loadSession,
    deleteSession,
    latestUsage: latestAssistantContext.usage,
    latestModelId: latestAssistantContext.modelId,
  }), [messages, streamItems, reasoningText, busy, pendingApprovals, respondToApproval, sendMessage, stopGeneration, showReasoning, currentSessionId, pastSessions, showSessionHistory, newSession, loadSession, deleteSession, latestAssistantContext]);
}
