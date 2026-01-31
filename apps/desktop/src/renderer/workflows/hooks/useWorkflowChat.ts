import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { StreamItem, ToolEvent } from '../components/ChatPanel';
import { specToDesignerModel } from '../utils/conversions';

export type { StreamItem, ToolEvent };

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  images?: Array<{ path: string; name: string; dataUrl?: string; data?: string; mimeType?: string }>;
  parts?: StreamItem[];
  reasoning?: string;
}

interface UseWorkflowChatProps {
  model: any;
  onApplyModel: (model: any) => void;
  cloudAiHttp: string;
  initialMessages?: Message[];
  errors?: any[];
  selectedModelId?: string | 'auto';
}

export function useWorkflowChat({
  model,
  onApplyModel,
  cloudAiHttp,
  initialMessages = [],
  errors = [],
  selectedModelId = 'auto'
}: UseWorkflowChatProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [streamItems, setStreamItems] = useState<StreamItem[]>([]);
  const [reasoningText, setReasoningText] = useState('');
  const [busy, setBusy] = useState(false);
  const [showReasoning, setShowReasoning] = useState(false);

  // Initialize welcome message
  useEffect(() => {
    if (messages.length === 0) {
      setMessages([{ role: 'assistant', content: 'Hi! I\'m your Workflow Architect. Describe what you want to change or add to this workflow.' }]);
    }
  }, []);

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
    const newMessages = [...messages, { role: 'user' as const, content: displayContent, images: attachedImages }];
    setMessages(newMessages);

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

      // Build context as a separate system message, and keep user request clean
      const workflowContextText = `${debugSection ? debugSection + '\n' : ''}CURRENT WORKFLOW (for reference only - do NOT modify unless user requests):
${JSON.stringify(designerModel, null, 2)}

${structureSummary}
${hasErrors ? '\nPRIORITY: If user asks for changes, fix the validation errors shown above first.' : ''}${wiresArr.length === 0 ? '\nNOTE: Wires are missing - nodes are not connected!' : ''}${imageSection}`;

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
      let fullText = "";
      let currentItems: StreamItem[] = [];
      let currentReasoning = "";

      await new Promise<void>((resolve, reject) => {
        let done = false;
        let ws: WebSocket;
        try {
          ws = new WebSocket(wsUrl);
        } catch (err) {
          reject(err);
          return;
        }

        ws.onopen = () => {
          try {
            // Build messages with context as a system message, user request as user message
            const conversationMessages = newMessages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content }));
            
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
            const payload: any = {
              type: "chat",
              agent: "workflow",
              messages: messagesWithContext,
              context: payloadContext,
              model: 'auto',
            };

            if (selectedModelId && selectedModelId !== 'auto') {
              payload.modelId = selectedModelId;
            }
            if (accessToken) payload.auth = { accessToken };
            if (attachedImages.length > 0) {
              payload.images = attachedImages.map((img: any) => ({
                name: img.name,
                path: img.path,
                data: img.data,
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
                    let result: any = { ok: false, error: 'unknown_tool' };

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
                        result = await (window as any).desktopAPI.execTool(tool, args);
                      } else {
                        result = { ok: false, error: 'desktopAPI not available' };
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
                        result: { ok: false, error: String(err?.message || err) }
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
                const isFinal = evt.data?.final === true;
                if (isFinal) currentReasoning = r;
                else currentReasoning += r;
                setReasoningText(currentReasoning);
                setShowReasoning(true);

              } else if (evt.event === 'tool_event') {
                const d = evt.data || {};
                const tool = String(d.tool || d.toolName || (d.step && (d.step.tool || d.step.toolName)) || 'unknown');
                
                // Skip hidden tools (knowledge tools and internal discovery tools)
                const HIDDEN_TOOLS = [
                  'knowledge_get_identity', 'knowledge_get_directives', 'knowledge_get_bio',
                  'knowledge_list_entities', 'knowledge_search_facts', 'knowledge_get_entity_context',
                  'retrieve_tool_format', 'search_tools'
                ];
                if (HIDDEN_TOOLS.includes(tool)) {
                   return;
                }

                const rawStatus = typeof d.status === 'string' ? d.status : undefined;
                const normalizedStatus = rawStatus ? String(rawStatus).toLowerCase() : undefined;
                const id: string | undefined = (typeof d.toolCallId === 'string' && d.toolCallId) ? d.toolCallId : (typeof d.id === 'string' && d.id) ? d.id : undefined;

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
                      
                      // workflow_modify returns DesignerModel directly (has nodes array, not steps)
                      if (workflowValue && (Array.isArray(workflowValue.nodes) || Array.isArray(workflowValue.triggers))) {
                        // CRITICAL: Apply immediately - this updates the workflow canvas in real-time
                        console.log('[useWorkflowChat] APPLYING workflow_modify result NOW:', { 
                          nodes: workflowValue.nodes?.length, 
                          triggers: workflowValue.triggers?.length,
                          wires: workflowValue.wires?.length,
                          changes: result.changes
                        });
                        onApplyModel(workflowValue);
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
                      args: d.args ?? existing.args,
                      argsText: newArgsText,
                      result: d.result ?? existing.result,
                      // Preserve the workflowBefore snapshot
                      workflowBefore: existing.workflowBefore
                    }
                  };
                } else if (id) {
                  // For workflow modification tools, capture current model as snapshot for undo
                  const isModifyTool = tool === 'workflow_modify' || tool === 'modify_workflow' || tool === 'create_workflow';
                  const workflowSnapshot = isModifyTool && model
                    ? JSON.parse(JSON.stringify(model))
                    : undefined;

                  currentItems.push({
                    type: 'tool',
                    event: {
                      ts: new Date().toISOString(),
                      tool,
                      status: rawStatus,
                      args: d.args ?? d.step ?? undefined,
                      argsText: typeof d.args === 'string' ? d.args : '',
                      id,
                      result: d.result,
                      workflowBefore: workflowSnapshot
                    }
                  });
                }
                setStreamItems([...currentItems]);
              }

            } else if (msg.type === 'final') {
              const result = msg.result || {};
              const textFinal = typeof result.text === 'string' && result.text.trim().length > 0 ? result.text : fullText;
              if (textFinal) fullText = textFinal;
              done = true;
              try { ws.close(); } catch { }
              resolve();
            } else if (msg.type === 'error') {
              done = true;
              try { ws.close(); } catch { }
              reject(new Error(msg.message || 'stream_error'));
            }
          } catch (err) {
            if (!done) {
              done = true;
              try { ws.close(); } catch { }
              reject(err);
            }
          }
        };
        ws.onerror = () => { if (!done) { done = true; try { ws.close(); } catch { } reject(new Error('WebSocket error')); } };
        ws.onclose = () => { if (!done) { done = true; if (fullText) resolve(); else reject(new Error('Connection closed')); } };
      });

      // Finish
      setStreamItems([]);
      let responseText = fullText || "Done.";
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

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: responseText,
        parts: currentItems.length > 0 ? currentItems : undefined,
        reasoning: currentReasoning || undefined
      }]);

    } catch (e: any) {
      const rawMsg = e?.message || 'Unknown error';
      const friendly = rawMsg === 'unauthorized' ? 'Error: unauthorized – please sign in first.' : `Error: ${rawMsg}`;
      setMessages(prev => [...prev, { role: 'assistant', content: friendly }]);
    } finally {
      setBusy(false);
    }
  }, [messages, busy, model, errors, cloudAiHttp, onApplyModel]);

  return useMemo(() => ({
    messages,
    setMessages,
    streamItems,
    setStreamItems,
    reasoningText,
    setReasoningText,
    busy,
    setBusy,
    sendMessage,
    showReasoning,
    setShowReasoning
  }), [messages, streamItems, reasoningText, busy, sendMessage, showReasoning]);
}
