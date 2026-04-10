import * as memoryService from '../../memory/conversations';
import { buildKnowledgeContext } from '../../knowledge/retrieval';
import { buildAttachmentParts } from '../../utils/messages';
import { getOrCreateQueryEmbedding } from '../../utils/shared-embedding';
import type { AgentType } from './types';

interface BuildInputMessagesArgs {
  msg: any;
  prompt: string;
  history: any[];
  providedMessages?: any[];
  enabledIntegrations: string[];
  agentType: AgentType;
  agent: any;
}

export async function buildInputMessages({
  msg,
  prompt,
  history,
  providedMessages,
  enabledIntegrations,
  agentType,
  agent,
}: BuildInputMessagesArgs) {
  const recentHistory = history.slice(-50) as any[];
  let inputMessages: any[] = providedMessages && providedMessages.length > 0
    ? [...providedMessages]
    : [...recentHistory, { role: 'user', content: prompt }];

  appendAttachmentParts(msg, inputMessages, prompt);
  prependCompactContextMessage(msg, inputMessages, enabledIntegrations);
  prependHiddenContext(msg, inputMessages);

  if (agentType !== 'workflow') {
    inputMessages = await appendKnowledgeContext(prompt, inputMessages);
  }

  logTokenBreakdown(inputMessages, agent);
  return inputMessages;
}

function appendAttachmentParts(msg: any, inputMessages: any[], prompt: string) {
  const attachments = Array.isArray(msg?.attachments) ? msg.attachments : [];
  const images = Array.isArray(msg?.images) ? msg.images : [];
  const imageAttachments = images.map((image: any) => ({
    type: 'image',
    name: image?.name,
    mimeType: image?.mimeType || 'image/png',
    data: image?.data,
  }));

  const attachmentParts = buildAttachmentParts([...attachments, ...imageAttachments]);
  if (attachmentParts.length === 0) return;

  let userMessageIndex = -1;
  for (let index = inputMessages.length - 1; index >= 0; index--) {
    if (inputMessages[index]?.role === 'user') {
      userMessageIndex = index;
      break;
    }
  }

  if (userMessageIndex >= 0) {
    const existingContent = inputMessages[userMessageIndex]?.content;
    const baseParts = Array.isArray(existingContent)
      ? existingContent
      : [{ type: 'text', text: typeof existingContent === 'string' ? existingContent : '' }];
    inputMessages[userMessageIndex] = {
      ...inputMessages[userMessageIndex],
      content: [...baseParts, ...attachmentParts],
    };
    return;
  }

  inputMessages.push({
    role: 'user',
    content: [{ type: 'text', text: prompt || 'Attached files' }, ...attachmentParts],
  });
}

function prependCompactContextMessage(msg: any, inputMessages: any[], enabledIntegrations: string[]) {
  try {
    const contextParts: string[] = [];
    const incomingContext: any = msg?.context || {};

    contextParts.push(`Time: ${new Date().toISOString()}`);
    if (enabledIntegrations.length > 0) {
      contextParts.push(`Integrations: ${enabledIntegrations.join(', ')}`);
    }

    const paths: Array<{ path: string; name: string; isDirectory: boolean }> = Array.isArray(incomingContext?.paths)
      ? incomingContext.paths
      : [];
    if (paths.length > 0) {
      const pathText = paths
        .map((path) => `${path.isDirectory ? '📁' : '📄'} ${path.name}: ${path.path}`)
        .join(', ');
      contextParts.push(`Referenced: ${pathText}`);
    }

    const personaRaw = typeof incomingContext?.persona === 'string' ? incomingContext.persona.trim() : '';
    const presetRaw = typeof incomingContext?.tonePreset === 'string' ? incomingContext.tonePreset : '';
    const rawTone = typeof incomingContext?.tone === 'string' ? incomingContext.tone.trim() : '';
    if (personaRaw) contextParts.push(`Persona: ${personaRaw}`);

    const preset = (presetRaw || '').toLowerCase();
    if (preset === 'custom' && rawTone) {
      contextParts.push(`Tone: ${rawTone}`);
    } else if (preset && preset !== 'default') {
      contextParts.push(`Tone: ${preset}`);
    } else if (rawTone) {
      contextParts.push(`Tone: ${rawTone}`);
    }

    if (contextParts.length > 0) {
      inputMessages.unshift({ role: 'system', content: contextParts.join(' | ') });
    }
  } catch { }
}

function prependHiddenContext(msg: any, inputMessages: any[]) {
  try {
    const hiddenContext = typeof msg?.hiddenContext === 'string' ? msg.hiddenContext : undefined;
    if (hiddenContext && hiddenContext.trim()) {
      inputMessages.unshift({ role: 'system', content: hiddenContext });
    }
  } catch { }
}

async function appendKnowledgeContext(prompt: string, inputMessages: any[]) {
  const useParallelEmbeddings = process.env.SIS_PARALLEL_EMBEDDINGS === '1';
  const knowledgeMaxChars = 2000;

  if (useParallelEmbeddings && prompt) {
    try {
      const queryEmbedding = await getOrCreateQueryEmbedding(prompt);
      const [knowledgeContext, segmentMatches] = await Promise.all([
        buildKnowledgeContext(prompt, {
          includeIdentity: true,
          includeDirectives: true,
          includeBio: false,
          maxGlobalFacts: 4,
          detectEntities: true,
          queryEmbedding,
        }).catch(() => null),
        memoryService.searchSegmentsByEmbedding(queryEmbedding, { limit: 3, threshold: 0.6 })
          .catch(() => [] as Awaited<ReturnType<typeof memoryService.searchSegmentsByEmbedding>>),
      ]);

      const contextParts = buildKnowledgeContextParts(knowledgeContext?.text || '', segmentMatches, knowledgeMaxChars);
      if (contextParts.length > 0) {
        return [{ role: 'system', content: contextParts.join('\n\n') }, ...inputMessages];
      }
    } catch (error) {
      console.error('[cloud-ai] Parallel knowledge/memory pipeline failed:', error);
    }
    return inputMessages;
  }

  const contextParts: string[] = [];
  try {
    const knowledgeContext = await buildKnowledgeContext(prompt, {
      includeIdentity: true,
      includeDirectives: true,
      includeBio: false,
      maxGlobalFacts: 4,
      detectEntities: true,
    });
    if (knowledgeContext.text.trim()) {
      contextParts.push(knowledgeContext.text.trim().slice(0, knowledgeMaxChars));
    }
  } catch { }

  try {
    const query = String(prompt || '').trim();
    if (query) {
      const matches = await memoryService.searchSegments(query, { limit: 3, threshold: 0.6 });
      contextParts.push(...buildPastContextLines(matches));
    }
  } catch { }

  if (contextParts.length > 0) {
    return [{ role: 'system', content: contextParts.join('\n\n') }, ...inputMessages];
  }

  return inputMessages;
}

function buildKnowledgeContextParts(knowledgeText: string, segmentMatches: Array<{ score: number; segment: any }>, maxChars: number) {
  const contextParts: string[] = [];
  if (knowledgeText.trim()) {
    contextParts.push(knowledgeText.trim().slice(0, maxChars));
  }

  const pastContextLines = buildPastContextLines(segmentMatches);
  if (pastContextLines.length > 0) {
    contextParts.push(pastContextLines.join('\n'));
  }

  return contextParts;
}

function buildPastContextLines(matches: Array<{ score: number; segment: any }>) {
  const similar = matches.filter(({ score }) => score >= 0.6).slice(0, 3);
  if (similar.length === 0) {
    return [];
  }

  const lines = ['[PAST CONTEXT]'];
  for (const { segment } of similar) {
    const summary = String(segment.summary || '').trim().slice(0, 100);
    if (summary) {
      lines.push(`- ${summary}`);
    }
  }

  return lines.length > 1 ? lines : [];
}

function logTokenBreakdown(inputMessages: any[], agent: any) {
  try {
    const systemMessages = inputMessages.filter((message: any) => message.role === 'system');
    const userMessages = inputMessages.filter((message: any) => message.role === 'user');
    const assistantMessages = inputMessages.filter((message: any) => message.role === 'assistant');
    const toolMessages = inputMessages.filter((message: any) => message.role === 'tool');

    const charCount = (messages: any[]) => messages.reduce((sum: number, message: any) => {
      const content = message.content;
      if (typeof content === 'string') return sum + content.length;
      if (Array.isArray(content)) {
        return sum + content.reduce((partSum: number, part: any) => partSum + String(part?.text || JSON.stringify(part) || '').length, 0);
      }
      return sum + JSON.stringify(content || '').length;
    }, 0);

    const systemChars = charCount(systemMessages);
    const userChars = charCount(userMessages);
    const assistantChars = charCount(assistantMessages);
    const toolChars = charCount(toolMessages);
    const totalMessageChars = systemChars + userChars + assistantChars + toolChars;

    const agentTools = (agent as any)?.__diagTools || agent?.tools || {};
    const toolNames = Object.keys(agentTools);
    let toolSchemaChars = 0;
    for (const [name, tool] of Object.entries(agentTools)) {
      try {
        const descriptionChars = String((tool as any)?.description || '').length;
        const parameterChars = JSON.stringify((tool as any)?.parameters || (tool as any)?.inputSchema || {}).length;
        toolSchemaChars += descriptionChars + parameterChars + name.length + 20;
      } catch {
        toolSchemaChars += 200;
      }
    }

    let agentInstructionChars = 0;
    try {
      const instructions = (agent as any)?.__diagInstructions || (agent as any)?.instructions;
      if (typeof instructions === 'string') {
        agentInstructionChars = instructions.length;
      } else if (Array.isArray(instructions)) {
        agentInstructionChars = instructions.reduce((sum: number, instruction: any) => {
          return sum + String(instruction?.content || JSON.stringify(instruction) || '').length;
        }, 0);
      }
    } catch { }

    console.log('[cloud-ai] ═══ TOKEN BREAKDOWN (estimated) ═══');
    console.log(`[cloud-ai]   Agent instructions:  ~${Math.round(agentInstructionChars / 4)} tok (${agentInstructionChars} chars)`);
    console.log(`[cloud-ai]   Tool definitions:    ~${Math.round(toolSchemaChars / 3)} tok (${toolNames.length} tools, ${toolSchemaChars} chars)`);
    console.log(`[cloud-ai]   System messages:     ~${Math.round(systemChars / 4)} tok (${systemMessages.length} msgs, ${systemChars} chars)`);
    console.log(`[cloud-ai]   User messages:       ~${Math.round(userChars / 4)} tok (${userMessages.length} msgs, ${userChars} chars)`);
    console.log(`[cloud-ai]   Assistant messages:   ~${Math.round(assistantChars / 4)} tok (${assistantMessages.length} msgs, ${assistantChars} chars)`);
    console.log(`[cloud-ai]   Tool result messages: ~${Math.round(toolChars / 4)} tok (${toolMessages.length} msgs, ${toolChars} chars)`);
    console.log('[cloud-ai]   ─────────────────────────────────');
    console.log(`[cloud-ai]   TOTAL est:           ~${Math.round(agentInstructionChars / 4 + toolSchemaChars / 3 + totalMessageChars / 4)} tok`);
    console.log(`[cloud-ai]   Tool names: ${toolNames.slice(0, 10).join(', ')}${toolNames.length > 10 ? ` ...+${toolNames.length - 10} more` : ''}`);
    console.log('[cloud-ai] ═══════════════════════════════════');
  } catch (error) {
    console.warn('[cloud-ai] Token breakdown diagnostic failed:', error);
  }

  const systemMessages = inputMessages.filter((message: any) => message.role === 'system');
  if (systemMessages.length > 0) {
    const totalChars = systemMessages.reduce((sum: number, message: any) => {
      return sum + String(message.content || '').length;
    }, 0);
    console.log(`[cloud-ai] System context: ${systemMessages.length} msgs, ~${totalChars} chars, ~${Math.round(totalChars / 4)} tokens est.`);
  }
}
