import * as memoryService from '../../memory/conversations';
import { buildKnowledgeContext, computeCompositeScore, hasTemporalIntent, mmrRerank } from '../../knowledge/retrieval';
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
  /**
   * Active conversation id (when authenticated + resolved). Threaded through
   * to retrieval so segments/facts from this conversation get a continuity
   * boost (P6).
   */
  conversationId?: string | null;
}

export async function buildInputMessages({
  msg,
  prompt,
  history,
  providedMessages,
  enabledIntegrations,
  agentType,
  agent,
  conversationId,
}: BuildInputMessagesArgs) {
  const recentHistory = history.slice(-50) as any[];
  let inputMessages: any[] = providedMessages && providedMessages.length > 0
    ? [...providedMessages]
    : [...recentHistory, { role: 'user', content: prompt }];

  inputMessages = expandProvidedMessageAttachments(inputMessages);
  appendAttachmentParts(msg, inputMessages, prompt);
  prependCompactContextMessage(msg, inputMessages, enabledIntegrations);
  prependHiddenContext(msg, inputMessages);

  if (agentType !== 'workflow' && agentType !== 'skill') {
    inputMessages = await appendKnowledgeContext(prompt, inputMessages, conversationId);
  }

  logTokenBreakdown(inputMessages, agent);
  return inputMessages;
}

function expandProvidedMessageAttachments(inputMessages: any[]) {
  return inputMessages.map((message) => {
    const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
    if (attachments.length === 0) return message;

    const attachmentParts = buildAttachmentParts(attachments);
    if (attachmentParts.length === 0) return message;

    const existingContent = message?.content;
    if (Array.isArray(existingContent) && existingContent.some((part: any) => part?.type === 'image' || part?.type === 'file')) {
      return message;
    }

    const baseParts = Array.isArray(existingContent)
      ? existingContent
      : [{ type: 'text', text: typeof existingContent === 'string' ? existingContent : '' }];

    return {
      ...message,
      content: [...baseParts, ...attachmentParts],
    };
  });
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

    const paths: Array<{ path: string; name: string; isDirectory: boolean; type?: string; metadata?: any }> = Array.isArray(incomingContext?.paths)
      ? incomingContext.paths
      : [];
    const fileContextPaths = paths.filter((path) => !(
      path.type === 'bot'
      || path.type === 'agent'
      || String(path.path || '').startsWith('bot://')
      || String(path.path || '').startsWith('agent://')
    ));
    if (fileContextPaths.length > 0) {
      const pathText = fileContextPaths
        .map((path) => `${path.isDirectory ? '📁' : '📄'} ${path.name}: ${path.path}`)
        .join(', ');
      contextParts.push(`Referenced: ${pathText}`);
    }

    const mentionedBots = paths.filter((path) => (
      path.type === 'bot'
      || path.type === 'agent'
      || String(path.path || '').startsWith('bot://')
      || String(path.path || '').startsWith('agent://')
    ));
    if (mentionedBots.length > 0) {
      const botText = mentionedBots
        .map((path) => {
          const metadata = path.metadata && typeof path.metadata === 'object' ? path.metadata : {};
          const kind = path.type === 'agent' || String(path.path || '').startsWith('agent://') ? 'agent' : 'bot';
          const id = String(metadata.id || path.path || '').replace(/^(bot|agent):\/\//, '');
          const status = metadata.status ? `, status: ${metadata.status}` : '';
          const lastRunAt = metadata.lastRunAt ? `, lastRunAt: ${metadata.lastRunAt}` : '';
          const nextRunAt = metadata.nextRunAt ? `, nextRunAt: ${metadata.nextRunAt}` : '';
          const vm = metadata.vmDeployedAt ? ', vm: deployed' : '';
          return `@${path.name} (${kind}, id: ${id}${status}${lastRunAt}${nextRunAt}${vm})`;
        })
        .join(', ');
      contextParts.push(`Mentioned configured agents/bots: ${botText}`);
      contextParts.push('When the user addresses one of these @mentioned agents/bots or asks for status/details, delegate to the agent or bot subagent with the id before answering. Use the delegated agent/bot subagent for create/deploy workflows too.');
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

/**
 * Wider net for segment fetch — composite scoring + MMR (in `buildPastContextLines`)
 * picks the best 3 out of these. Threshold mirrors the fact-search threshold so
 * recall is comparable between the two layers.
 */
const SEGMENT_FETCH_LIMIT = 15;
const SEGMENT_FETCH_THRESHOLD = 0.45;

/**
 * P4: per-section character budgets. When a section overflows, drop trailing
 * lines (not mid-line truncation) so we never show "Build comma…" cut off.
 *
 * Render order is determined by the order keys appear in `SECTION_RENDER_ORDER`.
 * `null` budget means unlimited (used for highly-stable USER_IDENTITY).
 */
const SECTION_BUDGETS: Record<string, number | null> = {
  USER_IDENTITY: null,
  PROFILE_DETAILS_NEEDED: 200,
  SYSTEM_INSTRUCTIONS: 500,
  CURRENT_CONTEXT: 350, // per block — there can be up to 2
  ABOUT_USER: 300,
  RELEVANT_MEMORIES: 600,
  RELEVANT_COLLECTIONS: 200,
  PAST_CONTEXT: 500,
  PENDING_MEMORIES: 350,
};

const SECTION_RENDER_ORDER = [
  'USER_IDENTITY',
  'PROFILE_DETAILS_NEEDED',
  'SYSTEM_INSTRUCTIONS',
  'CURRENT_CONTEXT',
  'ABOUT_USER',
  'RELEVANT_MEMORIES',
  'RELEVANT_COLLECTIONS',
  'PAST_CONTEXT',
  'PENDING_MEMORIES',
];

async function appendKnowledgeContext(prompt: string, inputMessages: any[], activeConversationId?: string | null) {
  const useParallelEmbeddings = process.env.SIS_PARALLEL_EMBEDDINGS === '1';

  if (useParallelEmbeddings && prompt) {
    try {
      const queryEmbedding = await getOrCreateQueryEmbedding(prompt);
      const [knowledgeContext, segmentMatches, collectionBlock] = await Promise.all([
        buildKnowledgeContext(prompt, {
          includeIdentity: true,
          includeDirectives: true,
          includeBio: false,
          maxGlobalFacts: 4,
          detectEntities: true,
          queryEmbedding,
          activeConversationId,
        }).catch(() => null),
        memoryService.searchSegmentsByEmbedding(queryEmbedding, { limit: SEGMENT_FETCH_LIMIT, threshold: SEGMENT_FETCH_THRESHOLD })
          .catch(() => [] as Awaited<ReturnType<typeof memoryService.searchSegmentsByEmbedding>>),
        // P5: pre-computed topic-level digests. Cheap (one bridge call, no LLM).
        // Skipped silently on bridge errors so it never blocks the prompt.
        memoryService.buildCollectionContext(queryEmbedding, { maxTopics: 2 })
          .catch(() => ''),
      ]);

      const sections = collectSections(knowledgeContext, segmentMatches, collectionBlock, prompt, activeConversationId);
      const blob = renderBudgetedSections(sections);
      if (blob) {
        return [{ role: 'system', content: blob }, ...inputMessages];
      }
    } catch (error) {
      console.error('[cloud-ai] Parallel knowledge/memory pipeline failed:', error);
    }
    return inputMessages;
  }

  let knowledgeContext: Awaited<ReturnType<typeof buildKnowledgeContext>> | null = null;
  try {
    knowledgeContext = await buildKnowledgeContext(prompt, {
      includeIdentity: true,
      includeDirectives: true,
      includeBio: false,
      maxGlobalFacts: 4,
      detectEntities: true,
      activeConversationId,
    });
  } catch { }

  let segmentMatches: Awaited<ReturnType<typeof memoryService.searchSegments>> = [];
  try {
    const query = String(prompt || '').trim();
    if (query) {
      segmentMatches = await memoryService.searchSegments(query, { limit: SEGMENT_FETCH_LIMIT, threshold: SEGMENT_FETCH_THRESHOLD });
    }
  } catch { }

  const sections = collectSections(knowledgeContext, segmentMatches, '', prompt, activeConversationId);
  const blob = renderBudgetedSections(sections);
  if (blob) {
    return [{ role: 'system', content: blob }, ...inputMessages];
  }

  return inputMessages;
}

function collectSections(
  knowledgeContext: Awaited<ReturnType<typeof buildKnowledgeContext>> | null,
  segmentMatches: Array<{ score: number; segment: any }>,
  collectionBlock: string,
  prompt: string,
  activeConversationId?: string | null,
): Array<{ key: string; text: string }> {
  const sections: Array<{ key: string; text: string }> = [];

  if (knowledgeContext?.sections) {
    for (const s of knowledgeContext.sections) {
      sections.push({ key: s.key, text: s.text });
    }
  }

  if (collectionBlock && collectionBlock.trim()) {
    sections.push({ key: 'RELEVANT_COLLECTIONS', text: collectionBlock.trim() });
  }

  const pastLines = buildPastContextLines(segmentMatches, prompt, activeConversationId);
  if (pastLines.length > 0) {
    sections.push({ key: 'PAST_CONTEXT', text: pastLines.join('\n') });
  }

  return sections;
}

/**
 * P4: render sections in canonical order, truncating each section's body lines
 * (preserving the header) when it exceeds its char budget. The header is the
 * first line — always kept; body lines are dropped tail-first.
 *
 * Exported for testing.
 */
export function renderBudgetedSections(sections: Array<{ key: string; text: string }>): string {
  const buckets = new Map<string, Array<{ key: string; text: string }>>();
  for (const s of sections) {
    if (!buckets.has(s.key)) buckets.set(s.key, []);
    buckets.get(s.key)!.push(s);
  }

  const out: string[] = [];
  for (const key of SECTION_RENDER_ORDER) {
    const items = buckets.get(key);
    if (!items) continue;
    for (const item of items) {
      const budget = SECTION_BUDGETS[key];
      if (budget === null || budget === undefined) {
        out.push(item.text);
        continue;
      }
      out.push(applySectionBudget(item.text, budget));
    }
  }
  return out.join('\n\n');
}

function applySectionBudget(text: string, budgetChars: number): string {
  if (text.length <= budgetChars) return text;
  const lines = text.split('\n');
  if (lines.length <= 1) return text.slice(0, budgetChars); // single-line section: hard cut as last resort
  const header = lines[0];
  let body = lines.slice(1);
  // Drop trailing lines until we fit. Keep at least one body line so the
  // section still says something beyond its header.
  while (body.length > 1 && (header.length + 1 + body.join('\n').length) > budgetChars) {
    body.pop();
  }
  return [header, ...body].join('\n');
}

/**
 * P1: segments now go through the same composite scoring + MMR rerank pipeline
 * as facts, with a conversation-thread continuity boost when the segment
 * originated in the active conversation.
 *
 * P2: each line is rendered as `- YYYY-MM-DD [topic1, topic2]: <summary>` so
 * the model can reference *when* and *what* the prior discussion was about
 * without inventing details.
 *
 * Exported for testing.
 */
export function buildPastContextLines(
  matches: Array<{ score: number; segment: any }>,
  prompt: string,
  activeConversationId?: string | null,
) {
  if (matches.length === 0) return [];

  const temporalBoost = hasTemporalIntent(prompt);

  const scored = matches
    .map(({ segment, score }) => {
      const conversationBoost = activeConversationId
        && segment?.conversation_id
        && String(segment.conversation_id) === activeConversationId
        ? 0.15
        : 0;
      return {
        segment,
        score: computeCompositeScore(score, {
          created_at: segment?.created_at,
          confidence: 1.0,
          source: 'segment',
        }, { temporalBoost, conversationBoost }),
        vector: Array.isArray(segment?.vector) ? segment.vector : undefined,
      };
    })
    .filter((c) => c.score > 0);

  if (scored.length === 0) return [];

  const reranked = mmrRerank(scored, 3, 0.7, (c) => c.segment);
  if (reranked.length === 0) return [];

  const lines = ['[PAST CONTEXT]'];
  for (const { item: segment } of reranked) {
    const summary = String(segment?.summary || '').trim().slice(0, 140);
    if (!summary) continue;
    const dateStr = String(segment?.created_at || '').slice(0, 10);
    const topics = Array.isArray(segment?.topics)
      ? segment.topics.filter(Boolean).slice(0, 3).join(', ')
      : '';
    const datePart = dateStr ? `${dateStr}` : '';
    const topicPart = topics ? ` [${topics}]` : '';
    const prefix = (datePart || topicPart) ? `${datePart}${topicPart}: ` : '';
    lines.push(`- ${prefix}${summary}`);
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
