import { randomUUID } from 'crypto';
import type { WebSocket } from 'ws';

import { getWorkflowAgent } from '../../agents/workflow-agent';
import { getAgentForQuery } from '../../agents/stuard/index';
import { verifyAccessToken, AuthErrorCode } from '../../auth';
import { routeModel, type ModelChoice } from '../../router/model-router';
import {
  createConversation,
  addUserMessage,
  checkAccess,
  incrementDailyRequestCounter,
  getExternalAccount,
} from '../../supabase';
import { clearSessionWorkflow, setSessionWorkflow } from '../../tools/workflow';
import { contentToText, normalizeMessages } from '../../utils/messages';
import { getOrCreateQueryEmbedding } from '../../utils/shared-embedding';
import { writeLog } from '../../utils/logger';
import { ENABLE_ROUTING, REQUIRE_AUTH } from '../../utils/config';
import { getRankedToolNames } from '../../utils/tool-ranking';
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
  send(ws, { type: 'progress', event: 'model', data: { tier: routedTier, modelId: chosenModelId } }, requestId);

  const { enabledIntegrations, mcpTools } = authUser
    ? await loadIntegrations(authUser.userId)
    : { enabledIntegrations: [] as string[], mcpTools: {} as Record<string, any> };

  const history = conversations.get(ws) || [];
  appendNewUserMessagesToHistory(history, messages);

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

  const agent = await resolveAgent({
    agentType,
    msg,
    providedMessages,
    prompt,
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
  const authUser = authResult?.success ? { userId: authResult.userId!, email: authResult.email } : null;
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
  const providers = ['github', 'google', 'outlook'];
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
  prompt: string;
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
  prompt,
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

  let rankedToolNames: string[] | undefined;
  if (prompt) {
    try {
      const queryEmbedding = await getOrCreateQueryEmbedding(prompt);
      if (queryEmbedding && queryEmbedding.length > 0) {
        const topN = Number(process.env.SIS_RANKED_TOPN || '8');
        rankedToolNames = await getRankedToolNames(queryEmbedding, enabledIntegrations, topN);
      }
    } catch { }
  }

  return await getAgentForQuery(
    routedTier,
    prompt,
    undefined,
    enabledIntegrations,
    mcpTools,
    chosenModelId,
    rankedToolNames,
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
