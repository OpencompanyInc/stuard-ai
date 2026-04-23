'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight, Users, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { uploadFileToVm } from '@/lib/cloudApi';

const CLOUD_API_URL = process.env.NEXT_PUBLIC_CLOUD_API_URL || 'https://api.stuard.ai';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('stuard_access_token') || null;
}

interface PendingAttachment {
  name: string;
  path: string; // path on the VM (under STUARD_VM_ROOT)
  size: number;
  uploading?: boolean;
  error?: string;
}

interface CloudChatProps {
  engine: any;
}

type ToolStatus = 'called' | 'running' | 'completed' | 'error';

type ToolCall = {
  id: string;
  tool: string;
  status: ToolStatus;
  args?: any;
  result?: any;
  error?: string;
  description?: string;
  timestamp: number;
  subagentId?: string;
  nested?: boolean;
};

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  toolCalls?: ToolCall[];
  attachments?: Array<{ name: string; path: string }>;
};

function humanizeToolName(tool: string): string {
  return tool
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}m ${secs}s`;
}

// Tools treated as delegation (render as a rectangle card with subagent children)
const DELEGATION_TOOL_NAMES = new Set(['delegate', 'deploy_headless_agent', 'deploy_subagent']);

// Internal tools that are noisy or meaningless to show in the UI
const HIDDEN_TOOL_NAMES = new Set([
  'segment_create', 'segment_update', 'segment_end', 'segment_list', 'segment_list_recent',
  'segment_search', 'segment_get', 'segment_build_topic_drawers', 'segment_search_drawers_by_embedding',
  'collection_summary_upsert', 'collection_summary_list', 'collection_summary_get',
  'memory_store', 'memory_recall', 'memory_update', 'memory_search', 'memory_stats',
  'conversation_create', 'conversation_get', 'conversation_list', 'conversation_update',
  'conversation_delete', 'conversation_search', 'conversation_get_spaces',
  'message_add', 'message_list', 'agent_todo',
  'knowledge_add_fact', 'knowledge_update_fact', 'knowledge_build_context',
  'knowledge_get_directives', 'knowledge_get_identity', 'planner_list_items',
  'subagent_spawn', 'subagent_update', 'subagent_status', 'subagent_list', 'subagent_stop',
  'subagent_create', 'run_subagent', 'spawn_agent',
  'get_tool_schema', 'search_tools', 'reply_to_subagent', 'ask_user',
]);

function resolveToolName(tool: ToolCall): string {
  return tool.tool === 'execute_tool' && tool.args?.tool_name
    ? String(tool.args.tool_name)
    : tool.tool;
}

function isDelegationToolCall(tool: ToolCall): boolean {
  return DELEGATION_TOOL_NAMES.has(resolveToolName(tool));
}

type DelegationTask = { subagent: string; instruction?: string };

function extractDelegationTasks(tool: ToolCall): DelegationTask[] {
  const args = (tool.args || {}) as Record<string, any>;
  if (Array.isArray(args.tasks) && args.tasks.length > 0) {
    return args.tasks.map((t: any) => ({
      subagent: String(t?.subagent ?? 'subagent'),
      instruction: typeof t?.instruction === 'string' ? t.instruction : undefined,
    }));
  }
  const kind = args.subagent || args.kind || args.agent || args.agent_kind || 'subagent';
  const instruction = args.objective || args.task || args.prompt || args.instruction;
  return [{
    subagent: String(kind),
    instruction: typeof instruction === 'string' ? instruction : undefined,
  }];
}

const DelegationCard: React.FC<{ tool: ToolCall; childSteps: ToolCall[] }> = ({ tool, childSteps }) => {
  const tasks = extractDelegationTasks(tool);
  const isRunning = tool.status === 'called' || tool.status === 'running';
  const isError = tool.status === 'error';
  const isComplete = tool.status === 'completed';

  const [expanded, setExpanded] = useState(isRunning || isError);
  const prevRunningRef = useRef(isRunning);
  useEffect(() => {
    if (prevRunningRef.current && !isRunning && !isError) {
      setExpanded(false);
    }
    prevRunningRef.current = isRunning;
  }, [isRunning, isError]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isRunning]);
  const elapsedSec = tool.timestamp ? Math.max(0, Math.floor((now - tool.timestamp) / 1000)) : 0;

  const agentLabel = tasks.length === 1
    ? `${humanizeToolName(tasks[0].subagent)} agent`
    : `${tasks.length} agents`;

  const toolChildCount = childSteps.length;
  const statusText = isError
    ? 'Failed'
    : isRunning
      ? (toolChildCount > 0 ? `Working · ${toolChildCount} action${toolChildCount === 1 ? '' : 's'}` : 'Working…')
      : `Done · ${toolChildCount} action${toolChildCount === 1 ? '' : 's'}`;

  const borderClass = isError
    ? 'border-red-200'
    : isRunning
      ? 'border-blue-300'
      : 'border-gray-200';

  return (
    <div className={`rounded-lg border ${borderClass} bg-white overflow-hidden`}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-gray-50/70 transition-colors"
      >
        <div className={`mt-0.5 shrink-0 flex h-5 w-5 items-center justify-center rounded-md ${
          isRunning ? 'bg-blue-50' : 'bg-gray-100'
        }`}>
          <Users className={`h-3 w-3 ${isRunning ? 'text-blue-600' : 'text-gray-500'}`} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[12px] font-medium text-gray-800 ${isRunning ? 'animate-pulse' : ''}`}>
              {agentLabel}
            </span>
            <span className="text-[10px] tabular-nums text-gray-500">
              {statusText}
              {elapsedSec > 0 ? ` · ${formatDuration(elapsedSec)}` : ''}
            </span>
          </div>
          {tasks.length === 1 && tasks[0].instruction ? (
            <div
              className="mt-0.5 text-[11px] leading-snug text-gray-500 line-clamp-2"
              title={tasks[0].instruction}
            >
              {tasks[0].instruction}
            </div>
          ) : null}
          {tasks.length > 1 ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {tasks.map((t, i) => (
                <span
                  key={`${t.subagent}-${i}`}
                  className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600"
                  title={t.instruction}
                >
                  {humanizeToolName(t.subagent)}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="mt-0.5 flex shrink-0 items-center gap-1.5">
          {isRunning ? (
            <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin" />
          ) : isError ? (
            <XCircle className="h-3.5 w-3.5 text-red-500" />
          ) : isComplete ? (
            <CheckCircle className="h-3.5 w-3.5 text-gray-400" />
          ) : null}
          <ChevronRight
            className={`h-3.5 w-3.5 text-gray-400 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
          />
        </div>
      </button>

      <AnimatePresence initial={false}>
        {expanded && childSteps.length > 0 ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="border-t border-gray-100 px-3 py-2 space-y-1">
              {childSteps.map((child) => {
                const childRunning = child.status === 'called' || child.status === 'running';
                const childError = child.status === 'error';
                return (
                  <div key={child.id} className="flex items-center gap-1.5 text-xs text-gray-600">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      childError ? 'bg-red-400' :
                      childRunning ? 'bg-yellow-400 animate-pulse' :
                      'bg-green-400'
                    }`} />
                    <span className={childRunning ? 'animate-pulse' : ''}>
                      {child.description || humanizeToolName(child.tool)}
                    </span>
                  </div>
                );
              })}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
};

// Group tool calls into a display sequence: top-level tools, and for delegation tools,
// absorb the run of subsequent nested subagent tool calls as their children.
type ThoughtItem =
  | { kind: 'tool'; tool: ToolCall }
  | { kind: 'delegation'; tool: ToolCall; children: ToolCall[] };

function buildThoughtItems(tools: ToolCall[]): ThoughtItem[] {
  const items: ThoughtItem[] = [];
  let i = 0;
  while (i < tools.length) {
    const t = tools[i];
    if (!t.nested && isDelegationToolCall(t)) {
      const children: ToolCall[] = [];
      let j = i + 1;
      while (j < tools.length && tools[j].nested) {
        children.push(tools[j]);
        j++;
      }
      items.push({ kind: 'delegation', tool: t, children });
      i = j;
    } else if (!t.nested) {
      items.push({ kind: 'tool', tool: t });
      i++;
    } else {
      // stray nested tool with no preceding delegation — render inline
      items.push({ kind: 'tool', tool: t });
      i++;
    }
  }
  return items;
}

const ThoughtBlock: React.FC<{
  reasoning?: string;
  toolCalls?: ToolCall[];
  isStreaming?: boolean;
}> = ({ reasoning, toolCalls, isStreaming }) => {
  const visibleTools = (toolCalls || []).filter(t => !HIDDEN_TOOL_NAMES.has(resolveToolName(t)));
  const hasAny = (reasoning && reasoning.trim().length > 0) || visibleTools.length > 0;
  if (!hasAny) return null;
  const items = buildThoughtItems(visibleTools);

  return (
    <div className="mb-1.5 rounded-lg border border-gray-100 bg-gray-50/80 overflow-hidden">
      <div className={`px-3 py-1.5 text-xs text-gray-400 font-medium ${isStreaming ? 'animate-pulse' : ''}`}>
        {isStreaming ? 'Thinking...' : 'Thought process'}
      </div>
      <div className="px-3 pb-2 space-y-1.5">
        {reasoning ? (
          <div className="max-h-24 overflow-y-auto text-xs text-gray-500 whitespace-pre-wrap leading-relaxed">
            {reasoning}
          </div>
        ) : null}
        {items.map((item, idx) => {
          if (item.kind === 'delegation') {
            return <DelegationCard key={item.tool.id || `del-${idx}`} tool={item.tool} childSteps={item.children} />;
          }
          const t = item.tool;
          const running = t.status === 'called' || t.status === 'running';
          const errored = t.status === 'error';
          return (
            <div key={t.id || `t-${idx}`} className="flex items-center gap-1.5 text-xs text-gray-500">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                errored ? 'bg-red-400' :
                running ? 'bg-yellow-400 animate-pulse' :
                'bg-green-400'
              }`} />
              <span className={running ? 'animate-pulse' : ''}>
                {t.description || humanizeToolName(resolveToolName(t))}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export function CloudChat({ engine }: CloudChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);

  // Streaming state
  const [streamText, setStreamText] = useState('');
  const [streamReasoning, setStreamReasoning] = useState('');
  const [isReasoning, setIsReasoning] = useState(false);
  const [streamTools, setStreamTools] = useState<ToolCall[]>([]);
  const [statusMessage, setStatusMessage] = useState('');

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, streamText, streamReasoning, streamTools, statusMessage]);

  const onAttachClick = () => fileInputRef.current?.click();

  const onFilesPicked = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    if (picked.length === 0) return;

    const placeholders: PendingAttachment[] = picked.map(f => ({
      name: f.name,
      path: `chat-uploads/${Date.now()}-${f.name}`,
      size: f.size,
      uploading: true,
    }));
    setPendingAttachments(prev => [...prev, ...placeholders]);

    for (let i = 0; i < picked.length; i++) {
      const file = picked[i];
      const placeholder = placeholders[i];
      try {
        const res = await uploadFileToVm(placeholder.path, file);
        setPendingAttachments(prev => prev.map(p => {
          if (p.path !== placeholder.path) return p;
          return res.ok
            ? { ...p, uploading: false }
            : { ...p, uploading: false, error: res.error || 'upload_failed' };
        }));
      } catch (err: any) {
        setPendingAttachments(prev => prev.map(p =>
          p.path === placeholder.path ? { ...p, uploading: false, error: err?.message || 'upload_failed' } : p
        ));
      }
    }
  }, []);

  const removePendingAttachment = (path: string) => {
    setPendingAttachments(prev => prev.filter(p => p.path !== path));
  };

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    // Wait for any in-flight uploads before sending
    if (pendingAttachments.some(a => a.uploading)) return;

    const readyAttachments = pendingAttachments.filter(a => !a.error && !a.uploading);
    setInput('');
    setPendingAttachments([]);
    setMessages(prev => [...prev, {
      role: 'user',
      content: text,
      attachments: readyAttachments.length > 0
        ? readyAttachments.map(a => ({ name: a.name, path: a.path }))
        : undefined,
    }]);
    setLoading(true);
    setStreamText('');
    setStreamReasoning('');
    setStreamTools([]);
    setIsReasoning(false);
    setStatusMessage('Connecting to agent...');

    let accText = '';
    let accReasoning = '';
    let accTools: ToolCall[] = [];
    let gotFinal = false;
    let currentConvId = conversationId;

    // Helper: update or append a tool call by id
    const upsertTool = (id: string, patch: Partial<ToolCall> & { tool: string }) => {
      const existingIdx = accTools.findIndex(t => t.id === id);
      if (existingIdx >= 0) {
        accTools = accTools.map((t, i) => i === existingIdx ? { ...t, ...patch } : t);
      } else {
        accTools = [...accTools, {
          id,
          tool: patch.tool,
          status: patch.status || 'called',
          args: patch.args,
          result: patch.result,
          error: patch.error,
          description: patch.description,
          timestamp: patch.timestamp ?? Date.now(),
          subagentId: patch.subagentId,
          nested: patch.nested,
        }];
      }
      setStreamTools([...accTools]);
    };

    try {
      const token = getToken();
      const res = await fetch(`${CLOUD_API_URL}/v1/vm/agent/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          message: text,
          conversationId: currentConvId || undefined,
          context: readyAttachments.length > 0
            ? { paths: readyAttachments.map(a => ({ path: a.path, name: a.name, isDirectory: false })) }
            : undefined,
          attachments: readyAttachments.length > 0
            ? readyAttachments.map(a => ({ type: 'file', name: a.name, path: a.path, source: 'vm' }))
            : undefined,
        }),
      });

      const contentType = res.headers.get('content-type') || '';

      if (contentType.includes('text/event-stream') && res.body) {
        setStatusMessage('');
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const jsonStr = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed;
            if (!jsonStr) continue;

            let event: any;
            try { event = JSON.parse(jsonStr); } catch { continue; }

            switch (event.type) {
              case 'start':
                if (event.conversationId) {
                  currentConvId = event.conversationId;
                  setConversationId(event.conversationId);
                }
                break;

              case 'status':
                setStatusMessage(event.message || '');
                break;

              case 'progress': {
                setStatusMessage('');
                const ev = event.event || '';
                const data = event.data || {};
                if (ev === 'delta' || ev === 'text') {
                  const chunk = data.text || '';
                  if (chunk) {
                    accText += chunk;
                    setStreamText(accText);
                  }
                } else if (ev === 'reasoning_start' || ev === 'reasoning') {
                  setIsReasoning(true);
                  if (data.text) {
                    accReasoning += data.text;
                    setStreamReasoning(accReasoning);
                  }
                } else if (ev === 'reasoning_end') {
                  setIsReasoning(false);
                }
                break;
              }

              case 'tool_event': {
                setStatusMessage('');
                const data = event.data || event;
                const toolName = data.tool || event.tool;
                const status = (data.status || event.status || 'called') as ToolStatus;
                const toolCallId = data.toolCallId || data.id || `tc-${toolName}-${Date.now()}`;
                if (toolName) {
                  upsertTool(toolCallId, {
                    tool: toolName,
                    status,
                    args: data.args,
                    result: data.result,
                    error: data.error,
                    description: data.description,
                  });
                }
                break;
              }

              case 'subagent_event': {
                setStatusMessage('');
                const ev = event.event || '';
                const data = event.data || {};
                const subagentId = event.subagentId || '';
                // Stream subagent text/reasoning into the parent thought panel so
                // the UI keeps moving while a delegated agent is running.
                if ((ev === 'delta' || ev === 'reasoning' || ev === 'reasoning_start')
                    && typeof data.text === 'string' && data.text) {
                  accReasoning += data.text;
                  setStreamReasoning(accReasoning);
                } else if (ev === 'tool_call') {
                  const toolName = data.tool || data.name || 'tool';
                  const toolCallId = data.toolCallId || data.id || `sub-tc-${Date.now()}`;
                  upsertTool(toolCallId, {
                    tool: toolName,
                    status: 'called',
                    args: data.args,
                    description: data.description,
                    subagentId,
                    nested: true,
                  });
                } else if (ev === 'tool_result') {
                  const toolCallId = data.toolCallId || data.id || '';
                  if (toolCallId) {
                    const existing = accTools.find(t => t.id === toolCallId);
                    if (existing) {
                      upsertTool(toolCallId, {
                        tool: existing.tool,
                        status: data.error ? 'error' : 'completed',
                        result: data.result,
                        error: data.error,
                      });
                    }
                  }
                }
                break;
              }

              case 'routing':
                setStatusMessage(event.model ? `Routing to ${event.model}...` : '');
                break;

              case 'final':
                gotFinal = true;
                if (event.conversationId) {
                  currentConvId = event.conversationId;
                  setConversationId(event.conversationId);
                }
                const finalText = accText || event.text || '';
                if (finalText) {
                  setMessages(prev => [...prev, {
                    role: 'assistant',
                    content: finalText,
                    reasoning: accReasoning || undefined,
                    toolCalls: accTools.length > 0 ? accTools : undefined,
                  }]);
                }
                break;

              case 'error':
                if (!gotFinal) {
                  gotFinal = true;
                  setMessages(prev => [...prev, {
                    role: 'assistant',
                    content: accText || `Error: ${event.error || 'unknown'}`,
                    reasoning: accReasoning || undefined,
                    toolCalls: accTools.length > 0 ? accTools : undefined,
                  }]);
                }
                break;
            }
          }
        }

        if (!gotFinal && accText) {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: accText,
            reasoning: accReasoning || undefined,
            toolCalls: accTools.length > 0 ? accTools : undefined,
          }]);
        }
      } else {
        // Fallback: non-streaming JSON response
        setStatusMessage('');
        const data = await res.json();
        if (data.ok && (data.text || data.result?.text)) {
          const txt = data.text || data.result?.text || '';
          setMessages(prev => [...prev, { role: 'assistant', content: txt }]);
          if (data.conversationId || data.result?.conversationId) {
            setConversationId(data.conversationId || data.result?.conversationId);
          }
        } else {
          const errMsg = data.error || 'Failed to get a response.';
          const isBootTimeout = errMsg.includes('agent_ws_connect_timeout');
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: isBootTimeout
              ? 'The AI agent is still starting up on your cloud engine. This usually takes 1-2 minutes after provisioning. Please try again shortly.'
              : errMsg,
          }]);
        }
      }
    } catch (e: any) {
      if (accText) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: accText,
          reasoning: accReasoning || undefined,
          toolCalls: accTools.length > 0 ? accTools : undefined,
        }]);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: 'Connection error. Please try again.' }]);
      }
    } finally {
      setLoading(false);
      setStreamText('');
      setStreamReasoning('');
      setStreamTools([]);
      setIsReasoning(false);
      setStatusMessage('');
      inputRef.current?.focus();
    }
  }, [input, loading, conversationId, pendingAttachments]);

  if (engine.status !== 'running') {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center mb-3">
          <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
          </svg>
        </div>
        <p className="text-sm font-medium text-gray-700">Chat unavailable</p>
        <p className="text-xs text-gray-500 mt-1">Start your cloud engine to chat with your agent.</p>
      </div>
    );
  }

  const hasStreamContent = streamText || streamReasoning || streamTools.length > 0 || isReasoning;

  return (
    <div className="flex flex-col h-[600px] border border-gray-200 rounded-xl overflow-hidden bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50/50">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-500" />
          <span className="text-sm font-semibold text-gray-800">Stuard Agent</span>
        </div>
        {conversationId && (
          <button
            onClick={() => { setMessages([]); setConversationId(null); }}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            New chat
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <p className="text-sm text-gray-400">Send a message to start chatting with your cloud agent.</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className="max-w-[80%]">
              {/* Reasoning + tools (chain-of-thought with delegation rectangles) */}
              {msg.role === 'assistant' && (
                <ThoughtBlock reasoning={msg.reasoning} toolCalls={msg.toolCalls} />
              )}
              <div className={`px-3.5 py-2.5 rounded-2xl text-sm whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white rounded-br-md'
                  : 'bg-gray-100 text-gray-800 rounded-bl-md'
              }`}>
                {msg.content}
                {msg.role === 'user' && msg.attachments && msg.attachments.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {msg.attachments.map((att, ai) => (
                      <span key={ai} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] bg-blue-500/30 text-white">
                        📎 {att.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}

        {/* Live streaming */}
        {loading && hasStreamContent && (
          <div className="flex justify-start">
            <div className="max-w-[80%]">
              {(isReasoning || streamReasoning || streamTools.length > 0) && (
                <ThoughtBlock
                  reasoning={streamReasoning || (isReasoning ? '...' : undefined)}
                  toolCalls={streamTools}
                  isStreaming
                />
              )}
              {streamText && (
                <div className="bg-gray-100 rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm whitespace-pre-wrap text-gray-800">
                  {streamText}
                  <span className="inline-block w-0.5 h-4 bg-gray-400 animate-pulse ml-0.5 align-middle" />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Status message (agent booting, loading memory, etc.) */}
        {loading && statusMessage && !hasStreamContent && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-2">
              <svg className="w-3.5 h-3.5 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span className="text-xs text-gray-500">{statusMessage}</span>
            </div>
          </div>
        )}

        {/* Simple loading dots */}
        {loading && !hasStreamContent && !statusMessage && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-100 px-4 py-3 bg-white space-y-2">
        {pendingAttachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {pendingAttachments.map(a => (
              <span
                key={a.path}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs border ${
                  a.error
                    ? 'border-red-200 bg-red-50 text-red-700'
                    : a.uploading
                    ? 'border-yellow-200 bg-yellow-50 text-yellow-700'
                    : 'border-gray-200 bg-gray-50 text-gray-700'
                }`}
              >
                <span className="truncate max-w-[180px]">{a.name}</span>
                {a.uploading && <span className="text-[10px]">uploading...</span>}
                {a.error && <span className="text-[10px]">{a.error}</span>}
                <button
                  onClick={() => removePendingAttachment(a.path)}
                  className="ml-1 text-gray-400 hover:text-gray-700"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <button
            onClick={onAttachClick}
            disabled={loading}
            title="Attach file"
            className="px-2.5 py-2 bg-gray-100 text-gray-600 text-sm rounded-xl hover:bg-gray-200 transition-colors disabled:opacity-40"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
            </svg>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={onFilesPicked}
            className="hidden"
          />
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Message your agent..."
            disabled={loading}
            className="flex-1 px-3.5 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 disabled:opacity-50 bg-gray-50 placeholder:text-gray-400"
            autoFocus
          />
          <button
            onClick={send}
            disabled={loading || !input.trim() || pendingAttachments.some(a => a.uploading)}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
