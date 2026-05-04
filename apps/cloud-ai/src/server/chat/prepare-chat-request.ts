import { randomUUID } from 'crypto';
import type { WebSocket } from 'ws';

import { getWorkflowAgent } from '../../agents/workflow-agent';
import { verifyAccessToken, AuthErrorCode } from '../../auth';
import { getOrchestratorAgent } from '../../orchestrator';
import { ensureExecutionToolsRegistered } from '../../orchestrator/execution-tools-bootstrap';
import { routeModel, type ModelChoice } from '../../router/model-router';
import {
  createConversation,
  addUserMessage,
  checkAccess,
  incrementDailyRequestCounter,
  getExternalAccount,
  getConversationMessages,
} from '../../supabase';
import { verifyVMToken } from '../../services/vm-tokens';
import { resolveVMSecret } from '../../services/vm-command';
import { getSkillsFromContext } from '../../tools/skill-tools';
import { clearSessionWorkflow, setSessionWorkflow } from '../../tools/workflow';
import { contentToText, normalizeMessages } from '../../utils/messages';
import { getOrCreateQueryEmbedding } from '../../utils/shared-embedding';
import { writeLog } from '../../utils/logger';
import { ENABLE_ROUTING, REQUIRE_AUTH } from '../../utils/config';
import { anonResources, anonThreads, conversations, wsConversations } from '../socket/state';
import { buildInputMessages } from './message-context';
import { buildProviderOptions, resolveMaxSteps } from './provider-options';
import { pickDefaultModelId, send, type TierChoice, normalizeTierChoice } from '../socket/helpers';
import { registerWebhookState, sendRunStateSync } from '../socket/auth-handler';
import type { AgentType, AuthUser, PreparedChatRequest } from './types';

interface PrepareChatRequestArgs {
  ws: WebSocket;
  msg: any;
  requestId?: string;
  secretBag: Record<string, any>;
}

export async function prepareChatRequest({
  ws,
  msg,
  requestId,
  secretBag,
}: PrepareChatRequestArgs): Promise<PreparedChatRequest | null> {
  const messages = normalizeMessages(msg);
  const providedMessages = Array.isArray(msg?.messages) ? msg.messages : undefined;
  if (messages.length === 0) {
    send(ws, { type: 'error', message: 'empty prompt' }, requestId);
    return null;
  }

  const { authUser, authResult } = await resolveAuth(msg);
  if (authUser?.userId) {
    secretBag.userId = authUser.userId;
  }

  if (REQUIRE_AUTH && !authUser) {
    const errorCode = authResult?.error || AuthErrorCode.UNAUTHORIZED;
    const errorMessage = authResult?.message || 'unauthorized';
    send(ws, {
      type: 'error',
      message: errorMessage,
      code: errorCode,
      data: { requiresReauth: errorCode === AuthErrorCode.EXPIRED_TOKEN },
    }, requestId);
    return null;
  }

  if (authUser) {
    const access = await checkAccess(authUser.userId);
    if (!access.allowed) {
      send(ws, {
        type: 'error',
        message: access.reason || 'access_denied',
        data: { plan: access.plan, limit: access.limit, used: access.used },
      }, requestId);
      return null;
    }

    try {
      await incrementDailyRequestCounter(authUser.userId);
    } catch { }

    try {
      const delivered = await registerWebhookState(ws, authUser.userId);
      if (delivered > 0) {
        writeLog('queued_webhooks_delivered', { userId: authUser.userId, count: delivered });
      }
    } catch { }

    try {
      sendRunStateSync(ws, authUser.userId, requestId);
    } catch { }
  }

  const requestedMode = normalizeTierChoice(msg?.model);
  const routedTier = await resolveModelTier(msg, messages, requestedMode, ws, requestId);
  const chosenModelId = resolveChosenModelId(msg, routedTier);
  secretBag.__modelTier = routedTier;
  if (chosenModelId) {
    secretBag.__modelId = chosenModelId;
  }

  // Surface how the model got picked. We hit a regression where users had a
  // tier default configured in Settings → Auto Model Routing but the server
  // still fell back to its hard-coded default (openai/gpt-5-chat-latest)
  // because `modelConfig` wasn't propagating end-to-end. Logging the inputs
  // makes that class of bug debuggable from the cloud-ai logs alone.
  try {
    const tierKeys = msg?.modelConfig && typeof msg.modelConfig === 'object'
      ? Object.keys(msg.modelConfig)
      : [];
    const tierDefault = msg?.modelConfig?.[routedTier]?.default;
    writeLog('chat_model_resolved', {
      requestedMode,
      routedTier,
      chosenModelId: chosenModelId || null,
      explicitModelId: typeof msg?.modelId === 'string' ? msg.modelId : null,
      modelConfigTiers: tierKeys,
      modelConfigTierDefault: typeof tierDefault === 'string' ? tierDefault : null,
    });
  } catch { }

  send(ws, { type: 'progress', event: 'model', data: { tier: routedTier, modelId: chosenModelId } }, requestId);

  const { enabledIntegrations, mcpTools } = authUser
    ? await loadIntegrations(authUser.userId)
    : { enabledIntegrations: [] as string[], mcpTools: {} as Record<string, any> };

  const history = conversations.get(ws) || [];
  // Hydrate from durable storage when this is a fresh socket (typical for the VM
  // bridge, which opens a brand-new WS per chat turn) and the caller already has
  // a known conversationId. Without this, every turn would look like a new
  // conversation to the model and lose all prior context.
  const hydrationConvId = typeof msg?.conversationId === 'string' ? msg.conversationId.trim() : '';
  if (authUser && hydrationConvId && history.length === 0) {
    try {
      const stored = await getConversationMessages(authUser.userId, hydrationConvId, 100);
      if (stored && stored.length > 0) {
        for (const row of stored) {
          if (!row?.role || typeof row.content !== 'string') continue;
          if (row.role !== 'user' && row.role !== 'assistant' && row.role !== 'system') continue;
          history.push({ role: row.role, content: row.content });
        }
        conversations.set(ws, history);
      }
    } catch { }
  }
  appendNewUserMessagesToHistory(history, messages);
  // Persist the in-memory history back so subsequent calls on this same WS
  // (rare for VM, common for desktop) keep accumulating turns.
  conversations.set(ws, history);

  const prompt = resolvePrompt(messages);
  if (!prompt) {
    send(ws, { type: 'error', message: 'no user message found' }, requestId);
    return null;
  }

  send(ws, { type: 'progress', event: 'ack', data: { ts: Date.now() } }, requestId);
  if (process.env.SIS_PARALLEL_EMBEDDINGS === '1') {
    void getOrCreateQueryEmbedding(prompt).catch(() => null);
  }

  const agentType = resolveAgentType(ws, msg);
  const workflowModelId = resolveWorkflowModelId(agentType, msg);
  const modelLabel = agentType === 'workflow'
    ? (workflowModelId || 'google/gemini-3-pro-preview')
    : (chosenModelId || routedTier);
  const contextPathsForMeta = Array.isArray(msg?.context?.paths) ? msg.context.paths : undefined;
  const attachmentDescriptorsForMeta = buildAttachmentMetadata(msg?.attachments);

  const agent = await resolveAgent({
    agentType,
    msg,
    providedMessages,
    routedTier,
    chosenModelId,
    enabledIntegrations,
    mcpTools,
    workflowModelId,
    ws,
    requestId,
  });
  if (!agent) {
    return null;
  }

  const { conversationId, conversationCreatedNow } = await resolveConversation({
    ws,
    msg,
    prompt,
    authUser,
    requestId,
    requestedMode,
    routedTier,
    chosenModelId,
    modelLabel,
    contextPathsForMeta,
    attachmentDescriptorsForMeta,
    agentType,
  });

  const { resource, thread } = resolveMemoryContext(ws, msg, authUser?.userId || '', conversationId);
  const inputMessages = await buildInputMessages({
    msg,
    prompt,
    history,
    providedMessages,
    enabledIntegrations,
    agentType,
    agent,
  });

  if (authUser && conversationId && !conversationCreatedNow) {
    try {
      await addUserMessage(authUser.userId, conversationId, prompt, {
        mode: requestedMode,
        tier: routedTier,
        modelId: chosenModelId,
        contextPaths: contextPathsForMeta,
        attachments: attachmentDescriptorsForMeta,
      });
    } catch { }
  }

  return {
    ws,
    msg,
    requestId,
    messages,
    providedMessages,
    history,
    prompt,
    inputMessages,
    agent,
    agentType,
    authUser,
    requestedMode,
    routedTier,
    chosenModelId,
    conversationId,
    conversationCreatedNow,
    modelLabel,
    workflowModelId,
    contextPathsForMeta,
    resource,
    thread,
    maxSteps: resolveMaxSteps(msg, agentType),
    providerOptions: buildProviderOptions({
      agentType,
      workflowModelId,
      chosenModelId,
      modelLabel,
      msg,
    }),
  };
}

async function resolveAuth(msg: any): Promise<{ authUser: AuthUser | null; authResult: any }> {
  const accessToken = String(msg?.auth?.accessToken || '');
  const authResult = accessToken ? await verifyAccessToken(accessToken) : null;
  let authUser: AuthUser | null = authResult?.success
    ? { userId: authResult.userId!, email: authResult.email }
    : null;

  // VM agent auth: messages from a user's VM are signed with a per-VM HMAC secret.
  // The VM does NOT carry a Supabase JWT, so we verify the vmToken against the
  // user's VM secret and treat the resulting userId as authenticated.
  if (!authUser) {
    const vmToken = typeof msg?.auth?.vmToken === 'string' ? msg.auth.vmToken.trim() : '';
    const claimedUserId = typeof msg?.auth?.userId === 'string' ? msg.auth.userId.trim() : '';
    if (vmToken && claimedUserId) {
      try {
        const secret = await resolveVMSecret(claimedUserId);
        if (secret) {
          const payload = verifyVMToken(vmToken, secret);
          if (payload && payload.userId === claimedUserId) {
            authUser = { userId: claimedUserId };
          }
        }
      } catch { }
    }
  }

  return { authUser, authResult };
}

async function resolveModelTier(
  msg: any,
  messages: any[],
  requestedMode: TierChoice,
  ws: WebSocket,
  requestId: string | undefined,
): Promise<ModelChoice> {
  if (requestedMode !== 'auto') {
    return requestedMode;
  }

  if (!ENABLE_ROUTING) {
    return 'balanced';
  }

  const context = msg?.context || {};
  const routerMessages = messages.map((message: any) => ({
    role: message.role,
    content: contentToText(message.content),
  }));
  const routed = await routeModel({
    messages: routerMessages,
    contextSize: JSON.stringify(context).length,
    hasAttachments: Array.isArray(msg?.attachments) && msg.attachments.length > 0,
    recentTools: context?.recent_tools || [],
  });

  send(ws, { type: 'progress', event: 'routing', data: { m: routed.modelIndex, l: routed.layerIndexes } }, requestId);
  writeLog('routing', { m: routed.modelIndex, l: routed.layerIndexes });
  return routed.model;
}

function resolveChosenModelId(msg: any, routedTier: ModelChoice) {
  if (typeof msg?.modelId === 'string' && String(msg.modelId).trim()) {
    return String(msg.modelId).trim();
  }
  return pickDefaultModelId(msg?.modelConfig, routedTier);
}

async function loadIntegrations(userId: string) {
  const providers = ['github', 'google', 'outlook', 'telnyx', 'whatsapp', 'x'];
  let enabledIntegrations: string[] = [];
  let mcpTools: Record<string, any> = {};

  try {
    const checks = await Promise.all(providers.map((provider) => getExternalAccount(userId, provider)));
    enabledIntegrations = providers.filter((_, index) => !!checks[index]);
  } catch { }

  try {
    const { getConnectedMCPIntegrations, getMCPToolsForIntegrations } = await import('../../mcp');
    const connected = await getConnectedMCPIntegrations(userId);
    if (connected.length > 0) {
      mcpTools = await getMCPToolsForIntegrations(userId, connected);
      console.log(`[cloud-ai] Loaded ${Object.keys(mcpTools).length} MCP tools from ${connected.length} integrations`);
    }
  } catch (error) {
    console.warn('[cloud-ai] Failed to load MCP tools:', error);
  }

  return { enabledIntegrations, mcpTools };
}

function appendNewUserMessagesToHistory(history: any[], messages: any[]) {
  const newUserMessages = messages.filter((message) => message.role === 'user');
  for (const userMessage of newUserMessages) {
    if (!history.find((entry: any) => entry.role === 'user' && entry.content === userMessage.content)) {
      history.push(userMessage);
    }
  }
}

function resolvePrompt(messages: any[]) {
  const lastUserMessage = messages.filter((message) => message.role === 'user').slice(-1)[0];
  return contentToText(lastUserMessage?.content);
}

function resolveAgentType(ws: WebSocket, msg: any): AgentType {
  const rawAgent = typeof msg?.agent === 'string' ? String(msg.agent) : '';
  const rawAgentLower = rawAgent.toLowerCase().trim();
  const clientType = typeof (ws as any)?.__clientType === 'string'
    ? String((ws as any).__clientType).toLowerCase().trim()
    : '';
  const contextMode = typeof msg?.context?.mode === 'string'
    ? String(msg.context.mode).toLowerCase().trim()
    : '';

  const inferredWorkflow =
    clientType === 'workflow_ui'
    || clientType === 'workflow'
    || clientType === 'workflows'
    || contextMode === 'workflow_architect'
    || contextMode === 'workflow';

  if (
    rawAgentLower === 'workflow'
    || rawAgentLower === 'workflow_agent'
    || rawAgentLower === 'workflow-architect'
    || rawAgentLower === 'workflow_architect'
    || inferredWorkflow
  ) {
    return 'workflow';
  }

  return 'stuard';
}

function resolveWorkflowModelId(agentType: AgentType, msg: any) {
  if (agentType !== 'workflow') return undefined;

  if (typeof msg?.modelId === 'string' && String(msg.modelId).trim()) {
    return String(msg.modelId).trim();
  }

  return process.env.WORKFLOW_MODEL_ID || 'google/gemini-3-pro-preview';
}

interface ResolveAgentArgs {
  agentType: AgentType;
  msg: any;
  providedMessages?: any[];
  routedTier: ModelChoice;
  chosenModelId?: string;
  enabledIntegrations: string[];
  mcpTools: Record<string, any>;
  workflowModelId?: string;
  ws: WebSocket;
  requestId?: string;
}

async function resolveAgent({
  agentType,
  msg,
  providedMessages,
  routedTier,
  chosenModelId,
  enabledIntegrations,
  mcpTools,
  workflowModelId,
  ws,
  requestId,
}: ResolveAgentArgs) {
  if (agentType === 'workflow') {
    return await resolveWorkflowAgent(msg, providedMessages, workflowModelId, ws, requestId);
  }

  await ensureExecutionToolsRegistered();
  const skills = getSkillsFromContext();
  return getOrchestratorAgent(
    routedTier,
    enabledIntegrations,
    mcpTools,
    chosenModelId,
    skills,
  );
}

async function resolveWorkflowAgent(
  msg: any,
  providedMessages: any[] | undefined,
  workflowModelId: string | undefined,
  ws: WebSocket,
  requestId: string | undefined,
) {
  try {
    const agent = getWorkflowAgent(workflowModelId);
    const rawAgent = typeof msg?.agent === 'string' ? String(msg.agent) : '';
    const clientType = typeof (ws as any)?.__clientType === 'string' ? String((ws as any).__clientType).trim() : '';
    const contextMode = typeof msg?.context?.mode === 'string' ? String(msg.context.mode).trim() : '';
    console.log('[cloud-ai] Using workflow agent', { rawAgent, clientType, ctxMode: contextMode, modelId: workflowModelId });

    clearSessionWorkflow();
    const incomingContext = msg?.context || {};
    const directWorkflow = incomingContext?.workflow;
    let sessionLoaded = false;

    if (directWorkflow && typeof directWorkflow === 'object' && !Array.isArray(directWorkflow)) {
      setSessionWorkflow(directWorkflow);
      sessionLoaded = true;
      console.log('[cloud-ai] Pre-stored workflow from context:', {
        id: directWorkflow.id,
        nodes: directWorkflow.nodes?.length,
        triggers: directWorkflow.triggers?.length,
      });
    }

    const workspacePath = incomingContext?.workspacePath;
    if (workspacePath) {
      console.log('[cloud-ai] Workflow workspace path:', workspacePath);
    }

    if (!sessionLoaded) {
      const workflowMessage = providedMessages?.find((message: any) => (
        message?.role === 'system'
        && typeof message?.content === 'string'
        && message.content.includes('CURRENT WORKFLOW')
      ));

      if (workflowMessage && typeof workflowMessage.content === 'string') {
        const workflowJson = extractWorkflowJson(workflowMessage.content);
        if (workflowJson && (workflowJson.id || workflowJson.triggers || workflowJson.nodes)) {
          setSessionWorkflow(workflowJson);
          console.log('[cloud-ai] Pre-stored workflow in session:', {
            id: workflowJson.id,
            nodes: workflowJson.nodes?.length,
            triggers: workflowJson.triggers?.length,
          });
        }
      }
    }

    return agent;
  } catch (error: any) {
    console.error('[cloud-ai] Failed to get workflow agent:', error.message);
    send(ws, { type: 'error', message: 'Workflow agent unavailable: ' + error.message }, requestId);
    return null;
  }
}

function extractWorkflowJson(content: string) {
  const marker = content.indexOf('CURRENT WORKFLOW');
  if (marker < 0) return null;

  const jsonStart = content.indexOf('{', marker);
  if (jsonStart < 0) return null;

  let depth = 0;
  let jsonEnd = -1;
  let inString = false;
  let escaped = false;

  for (let index = jsonStart; index < content.length; index++) {
    const char = content[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{') depth++;
    if (char === '}') {
      depth--;
      if (depth === 0) {
        jsonEnd = index + 1;
        break;
      }
    }
  }

  if (jsonEnd <= jsonStart) return null;

  try {
    return JSON.parse(content.slice(jsonStart, jsonEnd));
  } catch (error) {
    console.warn('[cloud-ai] Failed to parse workflow JSON:', error);
    return null;
  }
}

interface ResolveConversationArgs {
  ws: WebSocket;
  msg: any;
  prompt: string;
  authUser: AuthUser | null;
  requestId?: string;
  requestedMode: TierChoice;
  routedTier: ModelChoice;
  chosenModelId?: string;
  modelLabel: string;
  contextPathsForMeta?: Array<{ path: string; name: string; isDirectory: boolean }>;
  attachmentDescriptorsForMeta?: any[];
  agentType: AgentType;
}

async function resolveConversation({
  ws,
  msg,
  prompt,
  authUser,
  requestId,
  requestedMode,
  routedTier,
  chosenModelId,
  modelLabel,
  contextPathsForMeta,
  attachmentDescriptorsForMeta,
  agentType,
}: ResolveConversationArgs) {
  let conversationId: string | null = null;
  let conversationCreatedNow = false;

  if (!authUser) {
    return { conversationId, conversationCreatedNow };
  }

  if (msg?.resetConversation) {
    try {
      wsConversations.delete(ws);
    } catch { }
  }

  const requestedId = typeof msg?.conversationId === 'string' ? String(msg.conversationId).trim() : '';
  if (requestedId) {
    conversationId = requestedId;
    return { conversationId, conversationCreatedNow };
  }

  conversationId = await createConversation(
    authUser.userId,
    prompt,
    modelLabel,
    {
      mode: requestedMode,
      tier: routedTier,
      modelId: chosenModelId,
      contextPaths: contextPathsForMeta,
      attachments: attachmentDescriptorsForMeta,
    },
    agentType === 'workflow' ? 'workflow' : 'stuard',
    !!msg?.forcePersist,
  ) as any;

  if (conversationId) {
    conversationCreatedNow = true;
    send(ws, { type: 'conversation', conversationId }, requestId);
  }

  return { conversationId, conversationCreatedNow };
}

function buildAttachmentMetadata(rawAttachments: any): any[] | undefined {
  const attachments = Array.isArray(rawAttachments) ? rawAttachments : [];
  if (attachments.length === 0) return undefined;

  const serialized = attachments
    .filter((attachment) => attachment && typeof attachment === 'object')
    .map((attachment: any) => ({
      type: typeof attachment.type === 'string' ? attachment.type : 'file',
      name: typeof attachment.name === 'string' ? attachment.name : 'attachment',
      mimeType: typeof attachment.mimeType === 'string' ? attachment.mimeType : undefined,
      path: typeof attachment.path === 'string' ? attachment.path : undefined,
      source: typeof attachment.source === 'string' ? attachment.source : undefined,
      previewText: typeof attachment.previewText === 'string' ? attachment.previewText.slice(0, 600) : undefined,
      lineCount: typeof attachment.lineCount === 'number' ? attachment.lineCount : undefined,
      charCount: typeof attachment.charCount === 'number' ? attachment.charCount : undefined,
    }));

  return serialized.length > 0 ? serialized : undefined;
}

function resolveMemoryContext(
  ws: WebSocket,
  msg: any,
  authUserId: string,
  conversationId: string | null,
) {
  let resource = authUserId;
  if (!resource) {
    resource = anonResources.get(ws) || '';
    if (!resource) {
      resource = 'anon-' + randomUUID();
      anonResources.set(ws, resource);
    }
  }

  let thread = conversationId || '';
  if (!thread) {
    thread = anonThreads.get(ws) || '';
    if (!thread) {
      thread = 'ws-' + randomUUID();
      anonThreads.set(ws, thread);
    }
  }

  const incomingMemory = msg?.memory || {};
  if (typeof incomingMemory?.resource === 'string' && incomingMemory.resource.trim()) {
    resource = incomingMemory.resource.trim();
  }
  if (typeof incomingMemory?.thread === 'string' && incomingMemory.thread.trim()) {
    thread = incomingMemory.thread.trim();
  }

  return { resource, thread };
}
