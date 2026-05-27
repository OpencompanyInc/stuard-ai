import { useMemo, useState, useRef, useCallback } from 'react';
import { supabase } from '../../lib/supabaseClient';
import type { Message, StreamItem, ToolEvent } from './useWorkflowChat';
import type { Skill } from '../components/Skills';
import { mergeStreamingText } from '../../utils/streamMerge';

const CLOUD_AI_HTTP_DEFAULT = (window as any).__CLOUD_AI_HTTP__ || (import.meta as any).env?.VITE_CLOUD_AI_URL || 'http://127.0.0.1:8082';

function toFriendlySkillChatError(err: any): string {
  const rawCode = String(err?.code || err?.error || '').toLowerCase();
  const rawMessage = String(err?.message || err || '').trim();
  const combined = `${rawCode} ${rawMessage}`.toLowerCase();

  if (combined.includes('unauthorized') || rawCode === 'unauthorized') {
    return 'unauthorized - please sign in first.';
  }
  if (combined.includes('unknown_tool') || combined.includes('unknown tool') || combined.includes('tool not found')) {
    return 'the AI tried to use a tool that is not available in this environment.';
  }
  if (combined.includes('invalid_json') || (combined.includes('tool call') && combined.includes('json'))) {
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

export function useSkillChat({
  skill,
  onApplySkill,
  cloudAiHttp,
  selectedModelId = 'auto',
  selectedModelSource,
  selectedReasoningLevel,
}: {
  skill: Skill;
  onApplySkill: (updates: Partial<Skill>) => void;
  cloudAiHttp?: string;
  selectedModelId?: string | 'auto';
  selectedModelSource?: string;
  selectedReasoningLevel?: string;
}) {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: "Hi! I'm your Skill Architect. Describe what you want this skill to do and I'll help you build or refine it." }
  ]);
  const [streamItems, setStreamItems] = useState<StreamItem[]>([]);
  const [reasoningText, setReasoningText] = useState('');
  const [showReasoning, setShowReasoning] = useState(false);
  const [busy, setBusy] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const abortedRef = useRef(false);

  const stopGeneration = useCallback(() => {
    abortedRef.current = true;
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setBusy(false);
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    if (!text || busy) return;
    setStreamItems([]);
    setReasoningText('');
    setShowReasoning(false);
    setBusy(true);

    const newMessages: Message[] = [...messages, { role: 'user', content: text }];
    setMessages(newMessages);

    let fullText = '';
    let currentReasoning = '';
    let currentItems: StreamItem[] = [];
    let finalUsage: Record<string, any> | undefined;
    let finalModelId: string | undefined;

    try {
      let accessToken: string | undefined;
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        accessToken = sessionData?.session?.access_token || undefined;
      } catch { }

      const base = String(cloudAiHttp || CLOUD_AI_HTTP_DEFAULT).replace(/\/$/, '');
      let wsUrl = '';
      if (base.startsWith('https://')) {
        wsUrl = 'wss://' + base.slice('https://'.length) + '/ws';
      } else if (base.startsWith('http://')) {
        wsUrl = 'ws://' + base.slice('http://'.length) + '/ws';
      } else {
        wsUrl = base + '/ws';
      }
      wsUrl += wsUrl.includes('?') ? '&client=skill_ui' : '?client=skill_ui';

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
          const steps = Array.isArray(skill?.steps) ? skill.steps : [];
          const stepsSummary = steps.length > 0
            ? steps.map((s: any, i: number) => `${i + 1}. ${s.label || s.id || 'Untitled'} (${s.type}${s.toolName ? `:${s.toolName}` : ''})`).join('\n')
            : 'No steps defined yet.';

          const skillContextText = `CURRENT SKILL (for reference only - do NOT modify unless user requests):
${JSON.stringify(skill, null, 2)}

Structure:
- Name: ${skill?.name || 'Untitled Skill'}
- Active: ${skill?.isActive ? 'yes' : 'no'}
- Step count: ${steps.length}
- Steps:\n${stepsSummary}

IMPORTANT:
- Use modify_skill for ALL changes.
- The user wants actual editable skill steps (same as manual Skills Studio editing).
- Preserve existing fields unless the user explicitly asks to change them.`;

          // Build conversation history without UI-only fields, keeping user request clean
          const conversationMessages = newMessages
            .filter((m) => m.role !== 'system')
            .map((m) => ({ role: m.role, content: m.content }));

          const messagesWithContext = [
            { role: 'system', content: skillContextText },
            ...conversationMessages.slice(0, -1),
            { role: 'user', content: text },
          ];

          const payload: any = {
            type: 'chat',
            agent: 'skill_architect',
            messages: messagesWithContext,
            context: {
              mode: 'skill_architect',
              // Pass the full skill object so the server can pre-store it
              skill,
            },
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
          ws.send(JSON.stringify(payload));
        };

        ws.onmessage = (event) => {
          if (abortedRef.current) {
            ws.close();
            resolve();
            return;
          }
          try {
            const msg = JSON.parse(event.data);

            // Handle tool_request from cloud-ai — execute tools locally and send result back
            if (msg.type === 'tool_request') {
              const { id, tool, args } = msg;
              if (id && tool) {
                (async () => {
                  try {
                    let result: any = {
                      ok: false,
                      error: 'unknown_tool',
                      message: `Tool "${String(tool)}" is not available in skill chat context.`
                    };

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
                    } else if ((window as any).desktopAPI?.execTool) {
                      const execResult = await (window as any).desktopAPI.execTool(tool, args);
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

                    if (ws.readyState === WebSocket.OPEN) {
                      ws.send(JSON.stringify({ type: 'tool_result', id, result }));
                    }
                  } catch (err: any) {
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

            // Handle legacy delta format (direct from server)
            if (msg.type === 'delta' || msg.event === 'delta') {
              const chunk = msg.chunk || msg.text || '';
              if (!chunk) return;
              fullText += chunk;
              const last = currentItems[currentItems.length - 1];
              if (last && last.type === 'text') {
                currentItems[currentItems.length - 1] = { ...last, content: (last.content || '') + chunk };
              } else {
                currentItems.push({ type: 'text', content: chunk });
              }
              setStreamItems([...currentItems]);
              return;
            }

            // Handle progress events (tool-based agent architecture)
            if (msg.type === 'progress') {
              const evt = msg as { event: string; data: any };

              if (evt.event === 'delta') {
                const chunk = typeof evt.data?.text === 'string' ? evt.data.text : '';
                if (!chunk) return;
                fullText += chunk;
                const last = currentItems[currentItems.length - 1];
                if (last && last.type === 'text') {
                  currentItems[currentItems.length - 1] = { ...last, content: last.content + chunk };
                } else {
                  currentItems.push({ type: 'text', content: chunk });
                }
                setStreamItems([...currentItems]);

              } else if (evt.event === 'reasoning' || evt.event === 'reasoning_start' || evt.event === 'reasoning_end') {
                if (evt.event === 'reasoning_start') {
                  setShowReasoning(true);
                  return;
                }
                if (evt.event === 'reasoning_end') return;
                const r = typeof evt.data?.text === 'string' ? evt.data.text : '';
                if (!r) return;
                currentReasoning = mergeStreamingText(currentReasoning, r);
                setReasoningText(currentReasoning);
                setShowReasoning(true);

              } else if (evt.event === 'tool_event') {
                const d = evt.data || {};
                let tool = String(d.tool || d.toolName || 'unknown');
                // execute_tool is a wrapper — show the actual tool being executed
                if (tool === 'execute_tool' && d.args?.tool_name) {
                  tool = String(d.args.tool_name);
                }

                // Hide internal tools from the UI
                const HIDDEN_TOOLS = [
                  'knowledge_get_identity', 'knowledge_get_directives', 'knowledge_get_bio',
                  'knowledge_list_entities', 'knowledge_search_facts', 'knowledge_get_entity_context',
                  'retrieve_tool_format', 'search_tools', 'get_tool_schema',
                ];
                if (HIDDEN_TOOLS.includes(tool)) return;

                const rawStatus = typeof d.status === 'string' ? d.status : undefined;
                const normalizedStatus = rawStatus ? String(rawStatus).toLowerCase() : undefined;
                const id: string | undefined =
                  (typeof d.toolCallId === 'string' && d.toolCallId) ? d.toolCallId :
                    (typeof d.id === 'string' && d.id) ? d.id : undefined;

                // Handle modify_skill completion — apply skill changes immediately
                if (tool === 'modify_skill' && (normalizedStatus === 'completed' || normalizedStatus === 'error')) {
                  console.log('[useSkillChat] Received modify_skill event:', {
                    status: normalizedStatus,
                    hasResult: !!d.result,
                    hasSkill: !!d.result?.skill,
                  });

                  try {
                    const result = d.result;
                    if (result && result.ok === true && result.skill) {
                      let skillValue: any = result.skill;
                      if (typeof skillValue === 'string') {
                        try { skillValue = JSON.parse(skillValue); } catch { }
                      }

                      if (skillValue && typeof skillValue === 'object') {
                        console.log('[useSkillChat] APPLYING modify_skill result NOW:', {
                          name: skillValue.name,
                          steps: skillValue.steps?.length,
                          message: result.message,
                        });
                        onApplySkill(skillValue);
                      }
                    } else if (result && result.ok === false) {
                      console.error('[useSkillChat] modify_skill failed:', result.error);
                    }
                  } catch (e) {
                    console.error('[useSkillChat] Error applying modify_skill result:', e);
                  }
                }

                // Update stream items to show tool events in chat
                let idx = id ? currentItems.findIndex(item => item.type === 'tool' && (item as any).event?.id === id) : -1;

                // Fallback: find pending modify_skill entry
                if (idx < 0 && tool === 'modify_skill' && normalizedStatus === 'completed' && d.result) {
                  idx = currentItems.findIndex(item =>
                    item.type === 'tool' &&
                    (item as any).event?.tool === 'modify_skill' &&
                    !(item as any).event?.result
                  );
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
                      args: d.args ?? existing.args,
                      argsText: newArgsText,
                      result: d.result ?? existing.result,
                    }
                  };
                } else if (id) {
                  currentItems.push({
                    type: 'tool',
                    event: {
                      ts: new Date().toISOString(),
                      tool,
                      status: rawStatus,
                      args: d.args ?? undefined,
                      argsText: typeof d.args === 'string' ? d.args : '',
                      id,
                      result: d.result,
                    }
                  });
                }
                setStreamItems([...currentItems]);
              }
              return;
            }

            // Handle reasoning events (legacy format)
            if (msg.type === 'reasoning' || msg.event === 'reasoning' ||
              msg.event === 'reasoning_start' || msg.event === 'reasoning_end') {
              const rChunk = msg.chunk || msg.text || '';
              if (rChunk) {
                setReasoningText(prev => prev + rChunk);
                setShowReasoning(true);
              }
              return;
            }

            // Handle done/final/error
            if (msg.type === 'done' || msg.event === 'done') {
              done = true;
              try { ws.close(); } catch { }
              resolve();
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
              reject(new Error(msg.message || 'Unknown error'));
            }
          } catch (err) {
            console.warn('[useSkillChat] Ignoring malformed WS event:', err);
            malformedEventCount += 1;
            if (malformedEventCount <= 1) {
              currentItems.push({
                type: 'text',
                content: '\n\n[Warning] Received an unexpected response chunk, continuing...\n',
              });
              setStreamItems([...currentItems]);
            }
          }
        };

        ws.onerror = () => {
          if (!done) {
            done = true;
            try { ws.close(); } catch { }
            const e: any = new Error('WebSocket connection failed');
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

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: fullText || (abortedRef.current ? '(Stopped by user)' : 'Done.'),
        parts: currentItems.length > 0 ? [...currentItems] : undefined,
        reasoning: currentReasoning || undefined,
        usage: finalUsage,
        modelId: finalModelId,
      }]);
      setStreamItems([]);
    } catch (err: any) {
      if (!abortedRef.current) {
        const friendly = toFriendlySkillChatError(err);
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `Error: ${friendly}`,
          parts: currentItems.length > 0 ? [...currentItems] : undefined,
          reasoning: currentReasoning || undefined,
        }]);
        setStreamItems([]);
      }
    } finally {
      setBusy(false);
      wsRef.current = null;
      setStreamItems([]);
      setReasoningText('');
    }
  }, [messages, busy, skill, onApplySkill, cloudAiHttp, selectedModelId, selectedModelSource, selectedReasoningLevel]);

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

  return {
    messages,
    streamItems,
    reasoningText,
    showReasoning,
    setShowReasoning,
    busy,
    sendMessage,
    stopGeneration,
    latestUsage: latestAssistantContext.usage,
    latestModelId: latestAssistantContext.modelId,
  };
}
