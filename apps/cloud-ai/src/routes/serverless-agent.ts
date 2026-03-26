/**
 * Serverless Agent Handler
 *
 * Handles messaging (SMS, WhatsApp, MMS, voice) directly on cloud-ai
 * without requiring a running VM or desktop bridge. Uses Supabase for
 * conversation persistence and memory, the knowledge graph for context,
 * and a filtered set of cloud-only tools (no local bridge required).
 *
 * This enables a "cloud-sync" mode where users can receive messages,
 * calls, and notifications without paying for a running VM.
 */

import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getModel } from '../agents/stuard/models';
import { search_tools, get_tool_schema, execute_tool } from '../tools/meta-tools';
import { web_search } from '../tools/perplexity-tools';
import { scrape_url } from '../tools/tavily-tools';
import { get_skill_info } from '../tools/skill-tools';
import { deployHeadlessAgent } from '../tools/deploy-headless-agent';
import { telnyx_send_sms, telnyx_voice_call } from '../tools/telnyx-tools';
import { whatsapp_send_message } from '../tools/whatsapp-tools';
import { waitTool } from '../tools/wait';
import { runSequentialTool, runParallelTool } from '../tools/workflow-system';
import { getDefaultModelForCategory } from '../pricing';
import {
  createConversation,
  addUserMessage,
  addAssistantMessage,
  getConversationMessages,
  enqueueMemoryJob,
  getSyncPreferences,
  getSupabaseService,
} from '../supabase';
import { getOrCreateQueryEmbedding } from '../utils/shared-embedding';
import { normalizeUsage } from '../utils/usage';
import { generateWithToolRecovery } from './proactive-utils';
import type { ModelChoice } from '../router/model-router';

// ─── Cloud-Only System Prompt ──────────────────────────────────────────────

function buildCloudSyncSystemPrompt(knowledgeContext: string): string {
  return `You are Stuard — a proactive, warm AI assistant operating in cloud-sync mode.
You do NOT have access to the user's local machine (no terminal, no file system, no screen capture, no GUI).
You ARE able to use cloud-based tools: web search, integrations (email, calendar, messaging), knowledge search, and more.

${knowledgeContext ? `\n${knowledgeContext}\n` : ''}
**Available Capabilities**:
- Web search and URL scraping
- Email (Gmail, Outlook) via connected integrations
- Calendar management via connected integrations
- GitHub, Discord, Reddit via connected integrations
- SMS and WhatsApp messaging
- Voice calls (outbound)
- Memory search across past conversations
- Knowledge graph (facts, entities, user profile)
- Workflow execution
- Tool discovery (search_tools → get_tool_schema → execute_tool)

**NOT Available** (cloud-sync mode — no local bridge):
- File system operations (read_file, write_file, list_directory)
- Terminal / command execution
- Screen capture or GUI automation
- Browser automation on user's machine
- Any tool requiring a desktop or VM bridge

**Tool Discovery**:
You have a few tools loaded natively. For anything else, use:
1. search_tools with a query or category
2. get_tool_schema with the exact tool name
3. execute_tool with the tool name and matching args
IMPORTANT: Do NOT guess tool arguments. Always call get_tool_schema first.
IMPORTANT: Do NOT attempt to use local/device tools — they will fail. Only use cloud-based tools.

**Behavior**: Be warm, concise, actionable. Complete requests end-to-end using available cloud tools.
When you can't do something because it requires local access, explain that and suggest the user switch to desktop or VM mode.

**Memory**: Conversations are stored in the cloud. You can search past conversations for context.
Information you learn about the user is stored in the knowledge graph automatically.`;
}

// ─── Cloud-Only Memory Search Tool ─────────────────────────────────────────

function createCloudMemorySearchTool(userId: string) {
  return createTool({
    id: 'search_past_conversations',
    description: 'Search past conversations with the user for relevant context. Use when the user references something discussed before.',
    inputSchema: z.object({
      query: z.string().min(1).describe('What to search for'),
      limit: z.number().int().min(1).max(20).default(5).optional(),
    }),
    outputSchema: z.object({
      results: z.array(z.object({
        role: z.string(),
        content: z.string(),
        conversationId: z.string().optional(),
      })),
    }),
    execute: async (input) => {
      const supabase = getSupabaseService();
      if (!supabase) return { results: [] };

      try {
        const embedding = await getOrCreateQueryEmbedding(input.query);
        if (!embedding || embedding.length === 0) return { results: [] };

        // Search conversation embeddings via Supabase
        const { data, error } = await supabase
          .from('messages')
          .select('role, content, conversation_id')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(input.limit || 5);

        if (error || !data) return { results: [] };

        return {
          results: data.map((row: any) => ({
            role: String(row.role || 'user'),
            content: String(row.content || '').slice(0, 500),
            conversationId: row.conversation_id,
          })),
        };
      } catch {
        return { results: [] };
      }
    },
  });
}

// ─── Cloud Knowledge Context Builder ───────────────────────────────────────

async function buildCloudKnowledgeContext(userId: string, message: string): Promise<string> {
  const supabase = getSupabaseService();
  if (!supabase) return '';

  const sections: string[] = [];

  try {
    // Fetch user profile facts from knowledge graph in Supabase
    const { data: identityFacts } = await supabase
      .from('knowledge_facts')
      .select('category, attribute_key, text')
      .eq('owner', userId)
      .eq('category', 'identity')
      .eq('validity', true)
      .limit(20);

    if (identityFacts && identityFacts.length > 0) {
      const lines = ['[USER IDENTITY]'];
      for (const f of identityFacts) {
        const key = f.attribute_key || 'info';
        lines.push(`${key}: ${f.text}`);
      }
      sections.push(lines.join('\n'));
    }

    // Fetch directive facts
    const { data: directiveFacts } = await supabase
      .from('knowledge_facts')
      .select('text')
      .eq('owner', userId)
      .eq('category', 'directive')
      .eq('validity', true)
      .limit(10);

    if (directiveFacts && directiveFacts.length > 0) {
      const lines = ['[SYSTEM INSTRUCTIONS]'];
      for (const f of directiveFacts) {
        lines.push(`- ${f.text}`);
      }
      sections.push(lines.join('\n'));
    }

    // Fetch bio facts
    const { data: bioFacts } = await supabase
      .from('knowledge_facts')
      .select('text')
      .eq('owner', userId)
      .eq('category', 'bio')
      .eq('validity', true)
      .limit(10);

    if (bioFacts && bioFacts.length > 0) {
      const lines = ['[ABOUT USER]'];
      for (const f of bioFacts) {
        lines.push(`- ${f.text}`);
      }
      sections.push(lines.join('\n'));
    }

    // Semantic search for relevant memories
    try {
      const embedding = await getOrCreateQueryEmbedding(message);
      if (embedding && embedding.length > 0) {
        const { data: memoryResults } = await supabase.rpc('match_knowledge_facts', {
          query_embedding: embedding,
          match_threshold: 0.6,
          match_count: 8,
          filter_owner: userId,
        });

        if (memoryResults && memoryResults.length > 0) {
          const lines = ['[RELEVANT MEMORIES]'];
          for (const r of memoryResults) {
            lines.push(`- ${r.text}`);
          }
          sections.push(lines.join('\n'));
        }
      }
    } catch {
      // Non-fatal: semantic search may not be available
    }

    // Get recent conversation context
    try {
      const { data: recentMsgs } = await supabase
        .from('messages')
        .select('role, content')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(5);

      if (recentMsgs && recentMsgs.length > 0) {
        const lines = ['[RECENT CONVERSATION CONTEXT]'];
        for (const m of [...recentMsgs].reverse()) {
          const role = m.role === 'assistant' ? 'You' : 'User';
          lines.push(`${role}: ${String(m.content || '').slice(0, 200)}`);
        }
        sections.push(lines.join('\n'));
      }
    } catch {}
  } catch (e: any) {
    console.error('[serverless-agent] knowledge context build error:', e?.message);
  }

  return sections.join('\n\n');
}

// ─── Serverless Agent Execution ────────────────────────────────────────────

export interface ServerlessAgentInput {
  userId: string;
  message: string;
  conversationId?: string | null;
  model?: string;
  source?: 'sms' | 'whatsapp' | 'mms' | 'call' | 'api';
  attachments?: any[];
  /** Extra context (e.g., from phone, proactive message) */
  extraContext?: string;
}

export interface ServerlessAgentResult {
  ok: boolean;
  text: string;
  conversationId: string | null;
  usage?: any;
  error?: string;
}

/**
 * Run the serverless agent to handle a message without VM or desktop.
 * Fully self-contained: creates/continues conversations in Supabase,
 * builds knowledge context, and uses cloud-only tools.
 */
export async function runServerlessAgent(input: ServerlessAgentInput): Promise<ServerlessAgentResult> {
  const {
    userId,
    message,
    model: modelChoice = 'fast',
    source = 'sms',
    attachments,
    extraContext,
  } = input;

  let conversationId = input.conversationId || null;

  try {
    // 1. Create or continue conversation in Supabase
    if (!conversationId) {
      conversationId = await createConversation(
        userId,
        message,
        modelChoice,
        { mode: modelChoice },
        'stuard',
        true, // forcePersist — cloud-sync conversations always persist
      );
    } else {
      // Add user message to existing conversation
      await addUserMessage(userId, conversationId, message, { mode: modelChoice }, true);
    }

    // 2. Build knowledge context from Supabase
    const knowledgeContext = await buildCloudKnowledgeContext(userId, message);

    // 3. Load conversation history for multi-turn
    let conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    if (conversationId) {
      const msgs = await getConversationMessages(userId, conversationId, 10);
      // Filter out the current message (we'll add it as the user message)
      conversationHistory = msgs
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .slice(0, -1) as any; // Remove last (current) message
    }

    // 4. Build system prompt
    let systemPrompt = buildCloudSyncSystemPrompt(knowledgeContext);

    if (extraContext) {
      systemPrompt += `\n\n[ADDITIONAL CONTEXT]\n${extraContext}`;
    }

    if (source === 'sms' || source === 'mms') {
      systemPrompt += '\n\n**Response Format**: Keep responses concise (under 1500 chars) — this is an SMS conversation.';
    } else if (source === 'whatsapp') {
      systemPrompt += '\n\n**Response Format**: Keep responses concise (under 4000 chars) — this is a WhatsApp conversation.';
    } else if (source === 'call') {
      systemPrompt += '\n\n**Response Format**: Keep responses brief and conversational — this will be spoken aloud via TTS.';
    }

    // 5. Build tools (cloud-only subset)
    const cloudMemorySearch = createCloudMemorySearchTool(userId);

    const tools: Record<string, any> = {
      web_search,
      scrape_url,
      search_tools,
      get_tool_schema,
      execute_tool,
      get_skill_info,
      search_past_conversations: cloudMemorySearch,
      wait: waitTool,
      run_sequential: runSequentialTool,
      run_parallel: runParallelTool,
      telnyx_send_sms,
      telnyx_voice_call,
      whatsapp_send_message,
    };

    if (deployHeadlessAgent) {
      tools.deploy_headless_agent = deployHeadlessAgent;
    }

    // 6. Build agent
    const selectedModel = getModel(modelChoice as ModelChoice);

    const agent = new Agent({
      id: 'stuard-cloud-sync',
      name: 'stuard-cloud-sync',
      instructions: systemPrompt,
      model: selectedModel,
      tools,
    });

    // 7. Build messages array
    const messages: Array<{ role: 'user' | 'assistant'; content: any }> = [];

    // Add conversation history
    for (const msg of conversationHistory) {
      messages.push({ role: msg.role, content: msg.content });
    }

    // Add current message (with attachments if any)
    if (attachments && attachments.length > 0) {
      const content: any[] = [{ type: 'text', text: message }];
      for (const att of attachments) {
        if (att.type === 'image' && att.data) {
          content.push({ type: 'image', image: att.data, mimeType: att.mimeType || 'image/jpeg' });
        } else if (att.type === 'text' && att.content) {
          content.push({ type: 'text', text: `[Attachment: ${att.filename || 'file'}]\n${att.content}` });
        }
      }
      messages.push({ role: 'user', content });
    } else {
      messages.push({ role: 'user', content: message });
    }

    // 8. Generate response
    const result = await generateWithToolRecovery({
      agent,
      baseMessages: messages,
      maxSteps: 8,
      maxRetries: 2,
    });

    const responseText = String(result?.text || '').trim();

    // 9. Store assistant response in Supabase
    if (conversationId && responseText) {
      await addAssistantMessage(userId, conversationId, responseText, {
        mode: modelChoice,
        usage: result?.usage ? normalizeUsage(result.usage) : undefined,
      }, true);
    }

    // 10. Enqueue memory job for this exchange
    await enqueueMemoryJob({
      userId,
      texts: [message, responseText].filter(Boolean),
      roles: ['user', 'assistant'],
      threadId: conversationId,
    }).catch(() => {});

    return {
      ok: true,
      text: responseText || 'I processed your message but had no response to share.',
      conversationId,
      usage: result?.usage ? normalizeUsage(result.usage) : undefined,
    };
  } catch (e: any) {
    console.error('[serverless-agent] execution error:', e?.message, e?.stack?.slice(0, 300));
    return {
      ok: false,
      text: 'Sorry, I encountered an error processing your message. Please try again.',
      conversationId,
      error: String(e?.message || 'unknown_error'),
    };
  }
}

// ─── Voice Call Context Builder ────────────────────────────────────────────

/**
 * Build context for a voice call in cloud-sync mode.
 * Returns a system prompt enriched with user knowledge and a task description
 * if provided (e.g., "announce this to the user").
 */
export async function buildVoiceCallContext(
  userId: string,
  taskMessage?: string,
): Promise<{ systemPrompt: string; tools: any[] }> {
  const knowledgeContext = await buildCloudKnowledgeContext(userId, taskMessage || 'voice call');

  let systemPrompt = `You are Stuard — a friendly AI assistant on a voice call.
You know the user from past conversations and have their context loaded.

${knowledgeContext ? `\n${knowledgeContext}\n` : ''}
**Voice Call Guidelines**:
- Keep responses brief and conversational
- Don't use markdown, code blocks, or formatting
- Speak naturally as if talking to a friend
- If you have a task to announce, deliver it clearly and warmly
- You can search the web, check calendars, send messages on behalf of the user
- You cannot access the user's local machine (no files, terminal, or screen)`;

  if (taskMessage) {
    systemPrompt += `\n\n**Your Task**: ${taskMessage}`;
  }

  // Voice-appropriate tool definitions
  const tools = [
    {
      type: 'function',
      name: 'web_search',
      description: 'Search the web for information',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      },
    },
    {
      type: 'function',
      name: 'sis_search_tools',
      description: 'Find available tools by description',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What you want to do' },
        },
        required: ['query'],
      },
    },
    {
      type: 'function',
      name: 'sis_execute_tool',
      description: 'Execute a discovered tool',
      parameters: {
        type: 'object',
        properties: {
          tool_name: { type: 'string', description: 'Tool name' },
          args: { type: 'object', description: 'Tool arguments' },
        },
        required: ['tool_name'],
      },
    },
    {
      type: 'function',
      name: 'memory_search',
      description: 'Search past conversations with the user',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to search for' },
        },
        required: ['query'],
      },
    },
    {
      type: 'function',
      name: 'send_sms',
      description: 'Send an SMS to the user',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Message to send' },
        },
        required: ['message'],
      },
    },
  ];

  return { systemPrompt, tools };
}
