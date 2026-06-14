import { randomUUID } from 'crypto';
import type { WebSocket } from 'ws';

import { getBotAgentForUser } from '../../agents/bot-agent';
import { getWorkflowAgentForUser } from '../../agents/workflow-agent';
import { getSkillAgentForUser, clearSessionSkill, setSessionSkill } from '../../agents/skill-agent';
import { verifyAccessToken, AuthErrorCode } from '../../auth';
import { getOrchestratorAgentForUser, type BotPromptSummary } from '../../orchestrator';
import type { OrchestratorPromptOptions } from '../../orchestrator/orchestrator-agent';
import { execLocalTool, hasClientBridge } from '../../tools/bridge';
import type {
  JournalEntryPayload,
  ProjectContextPayload,
  ProjectRetrievedContextPayload,
} from '../../agents/stuard/prompts';
import { ensureExecutionToolsRegistered } from '../../orchestrator/execution-tools-bootstrap';
import { getResearchSessionView } from '../../tools/research-mode';
import { routeModel, type ModelChoice } from '../../router/model-router';
import { OUTLOOK_INTEGRATION_ENABLED, WHATSAPP_INTEGRATION_ENABLED } from '../../../../../shared/integration-flags';
import {
  createConversation,
  addUserMessage,
  checkAccess,
  incrementDailyRequestCounter,
  getExternalAccount,
  getConversationMessages,
} from '../../supabase';
import { userHasUserFundedInference } from '../../byok/keys';
import { verifyVMToken } from '../../services/vm-tokens';
import { resolveVMSecret } from '../../services/vm-command';
import { getSkillsFromContext } from '../../tools/skill-tools';
import { clearSessionWorkflow, setSessionWorkflow, setWorkflowWorkspacePath } from '../../tools/workflow';
import { contentToText, normalizeMessages } from '../../utils/messages';
import { getOrCreateQueryEmbedding } from '../../utils/shared-embedding';
import { writeLog } from '../../utils/logger';
import { fallbackTitleFromMessage } from '../../utils/thread-title';
import * as memoryService from '../../memory/conversations';
import { ENABLE_ROUTING, REQUIRE_AUTH } from '../../utils/config';
import { anonResources, anonThreads, conversations, wsConversations } from '../socket/state';
import { buildInputMessages } from './message-context';
import { buildProviderOptions, resolveMaxSteps } from './provider-options';
import { pickDefaultModelId, send, type TierChoice, normalizeTierChoice } from '../socket/helpers';
import { registerWebhookState, sendRunStateSync } from '../socket/auth-handler';
import type { AgentType, AuthUser, PreparedChatRequest } from './types';
import type { MemoryOwnerScope } from '../../memory/conversations';
import { isQuickChatRequest } from './quick-request';

interface PrepareChatRequestArgs {
  ws: WebSocket;
  msg: any;
  requestId?: string;
  secretBag: Record<string, any>;
}

function extractBotPromptSummaries(context: any): BotPromptSummary[] {
  const fromBotArrays = [
    context?.runningBots,
    context?.bots,
    context?.availableBots,
    context?.botSummaries,
  ].flatMap((value) => Array.isArray(value) ? value.map((entry: any) => ({ ...entry, kind: 'bot' })) : []);

  const fromAgentArrays = [
    context?.runningAgents,
    context?.agents,
    context?.availableAgents,
    context?.agentSummaries,
  ].flatMap((value) => Array.isArray(value) ? value.map((entry: any) => ({ ...entry, kind: 'agent' })) : []);

  const fromPaths = (Array.isArray(context?.paths) ? context.paths : [])
    .filter((path: any) => (
      path?.type === 'bot'
      || path?.type === 'agent'
      || String(path?.path || '').startsWith('bot://')
      || String(path?.path || '').startsWith('agent://')
    ))
    .map((path: any) => {
      const metadata = path?.metadata && typeof path.metadata === 'object' ? path.metadata : {};
      const kind = path?.type === 'agent' || String(path?.path || '').startsWith('agent://') ? 'agent' : 'bot';
      return {
        id: String(metadata.id || path.path || '').replace(/^(bot|agent):\/\//, ''),
        name: String(path.name || metadata.name || '').trim(),
        kind,
        status: metadata.status,
        lastRunAt: metadata.lastRunAt,
        nextRunAt: metadata.nextRunAt,
        vmDeployedAt: metadata.vmDeployedAt,
      };
    });

  const seen = new Set<string>();
  return [...fromBotArrays, ...fromAgentArrays, ...fromPaths]
    .map((bot: any) => ({
      id: String(bot?.id || bot?.agentId || bot?.botId || '').trim(),
      name: String(bot?.name || bot?.agentName || bot?.botName || '').trim(),
      kind: bot?.kind === 'agent' ? 'agent' as const : 'bot' as const,
      status: bot?.status ? String(bot.status) : undefined,
      lastRunAt: bot?.lastRunAt ?? null,
      nextRunAt: bot?.nextRunAt ?? null,
      vmDeployedAt: bot?.vmDeployedAt ?? null,
    }))
    .filter((bot) => {
      if (!bot.id && !bot.name) return false;
      const key = bot.id || bot.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);
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

  const quickRequest = isQuickChatRequest(msg);

  const { authUser, authResult } = await resolveAuth(msg);
  if (authUser?.userId) {
    secretBag.userId = authUser.userId;
  }
  const proactiveBotId = String(msg?.context?.proactiveBotId || msg?.context?.botId || '').trim();
  if (proactiveBotId) {
    secretBag.proactiveBotId = proactiveBotId;
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

  // Per-user reads kicked off in parallel; the credit check still hard-gates
  // the request. Integrations + conversation hydration are independent reads
  // that we'd otherwise serialize behind the credit check + router LLM call.
  // Side effects (webhook delivery, run-state sync, daily counter) only touch
  // this user's own state and are pure UX — fire-and-forget so they never add
  // to TTFT. If the access gate ends up rejecting the request, the in-flight
  // reads are discarded.
  const history = conversations.get(ws) || [];
  const hydrationConvId = typeof msg?.conversationId === 'string' ? msg.conversationId.trim() : '';
  const needsHydration = !!(authUser && hydrationConvId && history.length === 0);

  let integrationsPromise: Promise<{ enabledIntegrations: string[]; mcpTools: Record<string, any>; customTools: Record<string, any>; customCatalog: Array<{ name: string; description: string; category: string; inputSchema?: any }> }> =
    Promise.resolve({ enabledIntegrations: [] as string[], mcpTools: {} as Record<string, any>, customTools: {} as Record<string, any>, customCatalog: [] });
  let hydrationPromise: Promise<any[] | null> = Promise.resolve(null);

  if (authUser) {
    const accessPromise = checkAccess(authUser.userId);
    // Users paying for their own inference (BYOK key or ChatGPT/Codex
    // subscription) must not be gated by their Stuard credit balance. Verify the
    // credential server-side (not the client's modelSource claim) in parallel
    // with the credit check so it adds no latency to the common path.
    const userFundedPromise = userHasUserFundedInference(authUser.userId, msg?.modelSource);
    integrationsPromise = loadIntegrations(authUser.userId);
    if (needsHydration) {
      hydrationPromise = getConversationMessages(authUser.userId, hydrationConvId, 100).catch(() => null);
    }

    void (async () => {
      try {
        const delivered = await registerWebhookState(ws, authUser.userId);
        if (delivered > 0) {
          writeLog('queued_webhooks_delivered', { userId: authUser.userId, count: delivered });
        }
      } catch { }
    })();
    try { sendRunStateSync(ws, authUser.userId, requestId); } catch { }
    void Promise.resolve(incrementDailyRequestCounter(authUser.userId)).catch(() => {});

    // GATE: enforce credit access before any further work or stream open.
    // BYOK / subscription requests backed by a real user credential bypass the
    // credit balance (their inference isn't Stuard-billed); see
    // userHasUserFundedInference.
    const [access, userFunded] = await Promise.all([accessPromise, userFundedPromise]);
    if (!access.allowed && !userFunded) {
      send(ws, {
        type: 'error',
        message: access.reason || 'access_denied',
        data: { plan: access.plan, limit: access.limit, used: access.used },
      }, requestId);
      return null;
    }
  }

  const requestedMode = normalizeTierChoice(msg?.model);
  const routedTier = await resolveModelTier(msg, messages, requestedMode, ws, requestId);
  const chosenModelId = resolveChosenModelId(msg, routedTier);
  const modelSource = typeof msg?.modelSource === 'string' ? String(msg.modelSource).trim() : undefined;
  console.log('[cloud-ai] chat msg modelSource:', JSON.stringify(msg?.modelSource), '→ normalized:', modelSource ?? '(none)', '| keys:', Object.keys(msg || {}).join(','));
  secretBag.__modelTier = routedTier;
  if (chosenModelId) {
    secretBag.__modelId = chosenModelId;
  }
  if (modelSource) {
    secretBag.__requestedModelSource = modelSource;
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
      modelSource: modelSource || null,
      explicitModelId: typeof msg?.modelId === 'string' ? msg.modelId : null,
      modelConfigTiers: tierKeys,
      modelConfigTierDefault: typeof tierDefault === 'string' ? tierDefault : null,
    });
  } catch { }

  send(ws, { type: 'progress', event: 'model', data: { tier: routedTier, modelId: chosenModelId } }, requestId);

  // Drain the in-flight per-user reads kicked off above the access gate. By
  // the time the router (which often makes an LLM call) returns, these are
  // typically already resolved, so the await is usually free.
  // Compact/quick send is the same chat system as a normal turn — just a
  // different client visualization — so it must expose the same tools. We load
  // integrations for it too (the promise is already in flight from above, so
  // this adds no work, only a usually-already-resolved await). Previously quick
  // sends discarded this result, which silently dropped every deployed custom +
  // MCP tool from search_tools/execute_tool on those turns.
  const { enabledIntegrations, mcpTools, customTools, customCatalog } = await integrationsPromise;

  // Stash deployed custom-integration tools on the per-request secret bag so
  // search_tools / execute_tool can surface + run them without bloating the
  // lean active tool set. The whole turn runs inside withClientBridge(secretBag),
  // and wrapped tools capture this same bag via getBridgeSecrets().
  if (customTools && Object.keys(customTools).length > 0) {
    secretBag.__customTools = customTools;
    secretBag.__customCatalog = customCatalog;
  }

  // Hydrate from durable storage when this is a fresh socket (typical for the VM
  // bridge, which opens a brand-new WS per chat turn) and the caller already has
  // a known conversationId. Without this, every turn would look like a new
  // conversation to the model and lose all prior context.
  if (needsHydration) {
    const stored = await hydrationPromise;
    if (stored && stored.length > 0) {
      for (const row of stored) {
        appendStoredMessageToHistory(history, row);
      }
      conversations.set(ws, history);
    }
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
  if (process.env.SIS_PARALLEL_EMBEDDINGS === '1' && !quickRequest) {
    void getOrCreateQueryEmbedding(prompt).catch(() => null);
  }

  const agentType = resolveAgentType(ws, msg);
  const workflowModelId = resolveWorkflowModelId(agentType, msg);
  const skillModelId = resolveSkillModelId(agentType, msg, chosenModelId);
  const modelLabel = agentType === 'workflow'
    ? (workflowModelId || 'google/gemini-3-pro-preview')
    : agentType === 'skill'
      ? (skillModelId || 'google/gemini-3-pro-preview')
      : (chosenModelId || routedTier);
  const contextPathsForMeta = Array.isArray(msg?.context?.paths) ? msg.context.paths : undefined;
  const attachmentDescriptorsForMeta = buildAttachmentMetadata(msg?.attachments);

  const { conversationId, conversationCreatedNow } = await resolveConversation({
    ws,
    msg,
    prompt,
    authUser,
    requestId,
    requestedMode,
    routedTier,
    chosenModelId,
    modelSource,
    modelLabel,
    contextPathsForMeta,
    attachmentDescriptorsForMeta,
    agentType,
  });
  const memoryOwner = resolveMemoryOwner(agentType, msg);

  // Project Mode: if this conversation is already stamped with a project_id,
  // pull the project + recent journal so the orchestrator prompt can lock onto
  // it. Skipped for fresh conversations (no project yet) and for bot/workflow
  // agents which don't run the orchestrator prompt.
  // Quick sends skip project memory retrieval — that's the slow path users
  // are trying to avoid with Tab.
  const promptOptions: OrchestratorPromptOptions = quickRequest
    ? { conversationId: conversationId || null, quickResponse: true }
    : await resolveProjectPromptOptions({
      agentType,
      conversationId,
      conversationCreatedNow,
      prompt,
    });

  const agent = await resolveAgent({
    agentType,
    msg,
    providedMessages,
    routedTier,
    chosenModelId,
    enabledIntegrations,
    mcpTools,
    workflowModelId,
    skillModelId,
    modelSource,
    ws,
    requestId,
    userId: authUser?.userId || null,
    promptOptions,
  });
  if (!agent) {
    return null;
  }

  const { resource, thread } = resolveMemoryContext(ws, msg, authUser?.userId || '', conversationId);
  const inputMessages = await buildInputMessages({
    msg,
    prompt,
    history,
    providedMessages,
    enabledIntegrations: agentType === 'bot' ? [] : enabledIntegrations,
    agentType,
    agent,
    conversationId,
    memoryOwner,
  });

  if (authUser && conversationId && !conversationCreatedNow) {
    // Fire-and-forget: this DB write is for history persistence and the model
    // never reads it back during this turn (the prompt is already passed via
    // inputMessages). Blocking stream open on it costs 60–200 ms with no
    // functional benefit.
    void addUserMessage(authUser.userId, conversationId, prompt, {
      mode: requestedMode,
      tier: routedTier,
      modelId: chosenModelId,
      modelSource,
      contextPaths: contextPathsForMeta,
      attachments: attachmentDescriptorsForMeta,
    }).catch(() => { });
  }

  const resolvedModelSource = typeof (agent as any)?.__modelSource === 'string'
    ? (agent as any).__modelSource
    : undefined;

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
    modelSource,
    conversationId,
    conversationCreatedNow,
    modelLabel,
    workflowModelId,
    skillModelId,
    contextPathsForMeta,
    resource,
    thread,
    memoryOwner,
    maxSteps: resolveMaxSteps(msg, agentType),
    providerOptions: buildProviderOptions({
      agentType,
      workflowModelId,
      skillModelId,
      chosenModelId,
      modelSource: resolvedModelSource,
      modelLabel,
      msg,
    }),
  };
}

function resolveMemoryOwner(agentType: AgentType, msg: any): MemoryOwnerScope {
  const ctx = msg?.context || {};
  if (agentType === 'bot') {
    const agentId = String(ctx?.agentId || ctx?.agent_id || '').trim();
    if (agentId) return { owner_type: 'agent', owner_id: agentId };
    const botId = String(ctx?.proactiveBotId || ctx?.botId || ctx?.bot_id || ctx?.id || '').trim();
    return { owner_type: 'bot', owner_id: botId || 'default' };
  }
  if (agentType === 'workflow') return { owner_type: 'workflow' };
  if (agentType === 'skill') return { owner_type: 'skill' };
  return { owner_type: 'stuard' };
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

  // When the caller pinned an explicit modelId, the router's only output —
  // the tier — is used purely as a fallback for picking a default model id
  // (see resolveChosenModelId), and that fallback never fires because the
  // explicit id wins. Skip the LLM router call entirely; tag the tier as
  // 'balanced' for billing/log purposes.
  if (typeof msg?.modelId === 'string' && String(msg.modelId).trim()) {
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
  const providers = ['github', 'google', ...(OUTLOOK_INTEGRATION_ENABLED ? ['outlook'] : []), 'telnyx', ...(WHATSAPP_INTEGRATION_ENABLED ? ['whatsapp'] : []), 'x'];
  let enabledIntegrations: string[] = [];
  let mcpTools: Record<string, any> = {};
  // Deployed custom integrations. Compiled to tools but kept OUT of the lean
  // orchestrator prompt — they're surfaced via search_tools / execute_tool
  // (the same discovery dance native tools use). See meta-tools.ts.
  let customTools: Record<string, any> = {};
  let customCatalog: Array<{ name: string; description: string; category: string; inputSchema?: any }> = [];

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

  try {
    const { compileInstalledToTools } = await import('../../integrations/compile-tools');
    const compiled = await compileInstalledToTools(userId);
    customTools = compiled.tools;
    customCatalog = compiled.catalog;
    if (customCatalog.length > 0) {
      console.log(`[cloud-ai] Loaded ${customCatalog.length} custom-integration tools`);
    }
  } catch (error) {
    console.warn('[cloud-ai] Failed to load custom integration tools:', error);
  }

  return { enabledIntegrations, mcpTools, customTools, customCatalog };
}

function appendNewUserMessagesToHistory(history: any[], messages: any[]) {
  const newUserMessages = messages.filter((message) => message.role === 'user');
  for (const userMessage of newUserMessages) {
    if (!history.find((entry: any) => entry.role === 'user' && entry.content === userMessage.content)) {
      history.push(userMessage);
    }
  }
}

function appendStoredMessageToHistory(history: any[], row: any) {
  if (!row?.role || typeof row.content !== 'string') return;
  if (row.role !== 'user' && row.role !== 'assistant' && row.role !== 'system' && row.role !== 'tool') return;

  if (row.role === 'assistant') {
    appendStoredAssistantToolCalls(history, row.metadata?.toolCalls);
  }

  if (row.role === 'tool') {
    appendStoredToolMessage(history, row);
    return;
  }

  if (row.content.trim()) {
    history.push({ role: row.role, content: row.content });
  }
}

function appendStoredAssistantToolCalls(history: any[], toolCalls: any) {
  const completed = (Array.isArray(toolCalls) ? toolCalls : [])
    .filter((toolCall: any) => toolCall?.id && toolCall?.tool && toolCall?.result !== undefined);
  if (completed.length === 0) return;

  history.push({
    role: 'assistant',
    content: completed.map((toolCall: any) => ({
      type: 'tool-call' as const,
      toolCallId: String(toolCall.id),
      toolName: String(toolCall.tool),
      input: toolCall.input ?? toolCall.args ?? {},
      args: toolCall.args ?? toolCall.input ?? {},
    })),
  });

  history.push({
    role: 'tool',
    content: completed.map((toolCall: any) => {
      const resultText = stringifyToolResult(toolCall.result);
      return {
        type: 'tool-result' as const,
        toolCallId: String(toolCall.id),
        toolName: String(toolCall.tool),
        output: { type: 'text' as const, value: resultText },
        result: resultText,
      };
    }),
  });
}

function appendStoredToolMessage(history: any[], row: any) {
  const toolResults = Array.isArray(row.tool_results) ? row.tool_results : [];
  if (toolResults.length > 0) {
    history.push({
      role: 'tool',
      content: toolResults
        .filter((toolResult: any) => toolResult?.toolCallId || toolResult?.tool_call_id)
        .map((toolResult: any) => {
          const toolCallId = String(toolResult.toolCallId || toolResult.tool_call_id);
          const toolName = String(toolResult.toolName || toolResult.tool || toolResult.name || 'tool');
          const resultText = stringifyToolResult(toolResult.result ?? toolResult.output ?? '');
          return {
            type: 'tool-result' as const,
            toolCallId,
            toolName,
            output: { type: 'text' as const, value: resultText },
            result: resultText,
          };
        }),
    });
    return;
  }

  if (row.content.trim()) {
    history.push({ role: 'tool', content: row.content });
  }
}

function stringifyToolResult(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value ?? '');
  } catch {
    return String(value ?? '');
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
    rawAgentLower === 'bot'
    || rawAgentLower === 'proactive_bot'
    || rawAgentLower === 'proactive-bot'
    || contextMode === 'bot'
    || contextMode === 'proactive_bot'
    || contextMode === 'proactive-bot'
  ) {
    return 'bot';
  }

  if (
    rawAgentLower === 'workflow'
    || rawAgentLower === 'workflow_agent'
    || rawAgentLower === 'workflow-architect'
    || rawAgentLower === 'workflow_architect'
    || inferredWorkflow
  ) {
    return 'workflow';
  }

  const inferredSkill =
    clientType === 'skill_ui'
    || clientType === 'skill'
    || contextMode === 'skill_architect'
    || contextMode === 'skill';

  if (
    rawAgentLower === 'skill'
    || rawAgentLower === 'skill_agent'
    || rawAgentLower === 'skill-architect'
    || rawAgentLower === 'skill_architect'
    || inferredSkill
  ) {
    return 'skill';
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

function resolveSkillModelId(agentType: AgentType, msg: any, chosenModelId?: string) {
  if (agentType !== 'skill') return undefined;

  if (typeof msg?.modelId === 'string' && String(msg.modelId).trim()) {
    return String(msg.modelId).trim();
  }

  if (chosenModelId && String(chosenModelId).trim()) {
    return String(chosenModelId).trim();
  }

  return process.env.SKILL_MODEL_ID || process.env.WORKFLOW_MODEL_ID || 'google/gemini-3-pro-preview';
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
  skillModelId?: string;
  modelSource?: string;
  userId?: string | null;
  ws: WebSocket;
  requestId?: string;
  promptOptions?: OrchestratorPromptOptions;
}

async function resolveProjectPromptOptions(args: {
  agentType: AgentType;
  conversationId: string | null;
  conversationCreatedNow: boolean;
  prompt: string;
}): Promise<OrchestratorPromptOptions> {
  const { agentType, conversationId, conversationCreatedNow, prompt } = args;
  const base: OrchestratorPromptOptions = { conversationId: conversationId || null };

  if (agentType !== 'stuard') return base;
  if (!conversationId) return base;

  // Research Mode wins over Project Mode and needs no desktop bridge — the
  // session lives cloud-side keyed by conversation, so website/VM chats get
  // the takeover too. Cheap in-memory lookup, no round-trips.
  const activeResearch = getResearchSessionView(conversationId);
  if (activeResearch) {
    // Browser availability is per-request: a live bridge (desktop or VM) means
    // the browser subagent can serve as the fallback for blocked sources.
    return { conversationId, activeResearch, browserConnected: hasClientBridge() };
  }

  if (!hasClientBridge()) return base;
  // Brand-new conversations can't have a project yet — skip the bridge round-trip.
  if (conversationCreatedNow) return base;

  try {
    const convoResult = await execLocalTool(
      'conversation_get',
      { conversation_id: conversationId },
      undefined,
      5000,
      { silent: true },
    );
    const projectId: string | undefined = convoResult?.conversation?.project_id;
    if (!projectId) return base;

    const [projectResult, journalResult] = await Promise.all([
      execLocalTool('project_get', { project_id: projectId }, undefined, 5000, { silent: true }),
      execLocalTool('journal_list', { project_id: projectId, limit: 5 }, undefined, 5000, { silent: true }),
    ]);

    const project = projectResult?.project;
    if (!project) return base;

    const activeProject: ProjectContextPayload = {
      id: String(project.id),
      name: String(project.name || 'Untitled project'),
      description: project.description ?? null,
      goals: project.goals ?? null,
      instructions: project.instructions ?? null,
      status: project.status ?? null,
      tags: Array.isArray(project.tags) ? project.tags : [],
      pinned_paths: Array.isArray(project.pinned_paths) ? project.pinned_paths : [],
      digest: project.digest ?? null,
      icon: project.icon ?? null,
      color: project.color ?? null,
      settings: project.settings ?? null,
    };

    const recentJournal: JournalEntryPayload[] = Array.isArray(journalResult?.entries)
      ? journalResult.entries.map((entry: any) => ({
          ts: String(entry?.ts || entry?.created_at || ''),
          type: String(entry?.type || 'note'),
          title: String(entry?.title || ''),
          body: entry?.body ?? null,
        }))
      : [];

    const retrievedContext = await retrieveProjectContextForQuery({
      projectId,
      prompt,
      pathScopes: activeProject.pinned_paths || [],
    });

    return { conversationId, activeProject, recentJournal, retrievedContext };
  } catch (error: any) {
    writeLog('project_context_resolve_failed', {
      conversationId,
      error: error?.message || String(error),
    });
    return base;
  }
}

async function retrieveProjectContextForQuery(args: {
  projectId: string;
  prompt: string;
  pathScopes: string[];
}): Promise<ProjectRetrievedContextPayload | null> {
  const query = String(args.prompt || '').trim();
  if (!query) return null;

  try {
    const embedding = await getOrCreateQueryEmbedding(query);
    if (!embedding || embedding.length === 0) return null;

    const [memoryResult, fileResult] = await Promise.all([
      execLocalTool(
        'memory_search',
        { project_id: args.projectId, query_embedding: embedding, limit: 5 },
        undefined,
        8000,
        { silent: true },
      ).catch((error: any) => ({ ok: false, error: String(error?.message || error), results: [] })),
      args.pathScopes.length > 0
        ? execLocalTool(
            'file_search',
            {
              query,
              vector: embedding,
              mode: 'hybrid',
              path_scopes: args.pathScopes,
              limit: 5,
            },
            undefined,
            8000,
            { silent: true },
          ).catch((error: any) => ({ ok: false, error: String(error?.message || error), results: [] }))
        : Promise.resolve({ ok: true, results: [] }),
    ]);

    const memories = Array.isArray(memoryResult?.results)
      ? memoryResult.results.slice(0, 5).map((hit: any) => {
          const memory = hit?.memory || {};
          return {
            title: memory.title ?? null,
            content: memory.content ?? null,
            type: memory.type ?? null,
            score: typeof hit?.score === 'number' ? hit.score : null,
            url: memory.url ?? null,
            metadata: memory.metadata ?? null,
          };
        })
      : [];

    const files = Array.isArray(fileResult?.results)
      ? fileResult.results.slice(0, 5).map((file: any) => ({
          path: file.path ?? null,
          name: file.filename || file.display_name || null,
          kind: file.kind ?? null,
          score: typeof file?.score === 'number' ? file.score : null,
          modified_at: file.modified_at ?? null,
          snippet: file.summary || (Array.isArray(file.keywords) ? file.keywords.join(', ') : null),
        }))
      : [];

    if (memories.length === 0 && files.length === 0) return null;
    return { query, memories, files };
  } catch (error: any) {
    writeLog('project_query_context_failed', {
      projectId: args.projectId,
      error: error?.message || String(error),
    });
    return null;
  }
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
  skillModelId,
  modelSource,
  userId,
  ws,
  requestId,
  promptOptions,
}: ResolveAgentArgs) {
  if (agentType === 'workflow') {
    return await resolveWorkflowAgent(msg, providedMessages, workflowModelId, ws, requestId, userId, modelSource);
  }

  if (agentType === 'skill') {
    return await resolveSkillAgent(msg, skillModelId, ws, requestId, userId, modelSource);
  }

  if (agentType === 'bot') {
    const ctx = msg?.context || {};
    await ensureExecutionToolsRegistered();
    return await getBotAgentForUser({
      botId: String(ctx?.proactiveBotId || ctx?.botId || '').trim() || undefined,
      botName: String(ctx?.botName || '').trim() || undefined,
      model: routedTier,
      modelId: chosenModelId,
      modelSource,
      userId,
      allowedTools: Array.isArray(ctx?.allowedTools) ? ctx.allowedTools : [],
      mcpTools,
    });
  }

  if (promptOptions?.quickResponse || isQuickChatRequest(msg)) {
    return await getOrchestratorAgentForUser(
      routedTier,
      [],
      {},
      chosenModelId,
      [],
      [],
      userId,
      modelSource,
      { ...(promptOptions || {}), quickResponse: true },
    );
  }

  await ensureExecutionToolsRegistered();
  const skills = getSkillsFromContext();
  const bots = extractBotPromptSummaries(msg?.context || {});
  return await getOrchestratorAgentForUser(
    routedTier,
    enabledIntegrations,
    mcpTools,
    chosenModelId,
    skills,
    bots,
    userId,
    modelSource,
    promptOptions,
  );
}

async function resolveWorkflowAgent(
  msg: any,
  providedMessages: any[] | undefined,
  workflowModelId: string | undefined,
  ws: WebSocket,
  requestId: string | undefined,
  userId?: string | null,
  modelSource?: string,
) {
  try {
    const agent = await getWorkflowAgentForUser({
      modelId: workflowModelId,
      userId,
      modelSource,
    });
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
      // Record it so modify_workflow/inspect_workflow can target sub-workflow
      // .stuard files in this workspace (keyed by flow id to stay isolated
      // across concurrent studio sessions).
      const flowId = (directWorkflow && typeof directWorkflow === 'object' && directWorkflow.id)
        ? String(directWorkflow.id)
        : (typeof incomingContext?.workflowId === 'string' ? incomingContext.workflowId : '');
      if (flowId) setWorkflowWorkspacePath(flowId, String(workspacePath));
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

async function resolveSkillAgent(
  msg: any,
  skillModelId: string | undefined,
  ws: WebSocket,
  requestId: string | undefined,
  userId?: string | null,
  modelSource?: string,
) {
  try {
    const agent = await getSkillAgentForUser(skillModelId, userId, modelSource);
    const rawAgent = typeof msg?.agent === 'string' ? String(msg.agent) : '';
    const clientType = typeof (ws as any)?.__clientType === 'string' ? String((ws as any).__clientType).trim() : '';
    const contextMode = typeof msg?.context?.mode === 'string' ? String(msg.context.mode).trim() : '';
    console.log('[cloud-ai] Using skill agent', { rawAgent, clientType, ctxMode: contextMode, modelId: skillModelId });

    clearSessionSkill();
    const incomingSkill = msg?.context?.skill;
    if (incomingSkill && typeof incomingSkill === 'object' && !Array.isArray(incomingSkill)) {
      setSessionSkill(incomingSkill);
      console.log('[cloud-ai] Pre-stored skill from context:', {
        id: incomingSkill.id,
        name: incomingSkill.name,
        steps: incomingSkill.steps?.length,
      });
    }

    return agent;
  } catch (error: any) {
    console.error('[cloud-ai] Failed to get skill agent:', error.message);
    send(ws, { type: 'error', message: 'Skill agent unavailable: ' + error.message }, requestId);
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
  modelSource?: string;
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
  modelSource,
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

  const conversationSource = agentType === 'workflow'
    ? 'workflow'
    : agentType === 'skill'
      ? 'skill'
      : agentType === 'bot'
        ? 'proactive'
        : 'stuard';

  // Compute an immediate fallback title from the first user message so the UI
  // never shows "Untitled" while the LLM-generated title is in flight. The
  // background title job in stream-runner overwrites this when it completes.
  const fallbackTitle = fallbackTitleFromMessage(prompt);

  conversationId = await createConversation(
    authUser.userId,
    prompt,
    modelLabel,
    {
      mode: requestedMode,
      tier: routedTier,
      modelId: chosenModelId,
      modelSource,
      contextPaths: contextPathsForMeta,
      attachments: attachmentDescriptorsForMeta,
    },
    conversationSource,
    !!msg?.forcePersist,
    fallbackTitle,
  ) as any;

  if (conversationId) {
    conversationCreatedNow = true;
    send(ws, { type: 'conversation', conversationId }, requestId);
    if (fallbackTitle) {
      send(ws, { type: 'title', conversationId, title: fallbackTitle, provisional: true }, requestId);
      memoryService.updateConversation(conversationId, { title: fallbackTitle }).catch(() => undefined);
    }
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
