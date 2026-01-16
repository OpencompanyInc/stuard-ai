/**
 * Knowledge Graph Ingestion Pipeline
 * 
 * Handles extraction, classification, and execution of knowledge updates.
 * Runs on every significant conversation turn.
 */

import { generateObject } from 'ai';
import { z } from 'zod';
import { buildProviderModel } from '../utils/models';
import { getDefaultModelForCategory } from '../pricing';
import { embed } from 'ai';
import { openai } from '@ai-sdk/openai';
import { execLocalTool } from '../tools/bridge';
import { writeLog } from '../utils/logger';

// ═══════════════════════════════════════════════════════════════════════════════
// SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════════

const ActionSchema = z.discriminatedUnion('action', [
  // UPDATE_PROFILE: Overwrite core profile facts
  z.object({
    action: z.literal('UPDATE_PROFILE'),
    key: z.string().describe('The profile attribute key (e.g., "name", "os", "timezone")'),
    value: z.string().describe('The new value for this attribute'),
  }),

  // ADD_BIO: Append personal bio fact
  z.object({
    action: z.literal('ADD_BIO'),
    value: z.string().describe('The bio fact to add (e.g., "Has a dog named Max")'),
  }),

  // ADD_INSTRUCTION: Add system instruction
  z.object({
    action: z.literal('ADD_INSTRUCTION'),
    value: z.string().describe('The instruction to remember (e.g., "Always reply in JSON")'),
  }),

  // ADD_FACT: Add fact linked to an entity
  z.object({
    action: z.literal('ADD_FACT'),
    entity_name: z.string().describe('Name of the project/person/tool this fact relates to'),
    entity_type: z.enum(['project', 'person', 'company', 'tool', 'topic']).optional(),
    value: z.string().describe('The fact to add'),
  }),

  // ADD_PROCEDURAL: Add procedural snippet (command, path, credential)
  z.object({
    action: z.literal('ADD_PROCEDURAL'),
    key: z.enum(['command', 'path', 'credential', 'api_key', 'endpoint']),
    value: z.string().describe('The procedural value'),
    entity_name: z.string().optional().describe('Related entity name, if any'),
  }),

  // LOG_EVENT: Log an event to history
  z.object({
    action: z.literal('LOG_EVENT'),
    value: z.string().describe('The event to log'),
    entity_name: z.string().optional(),
  }),

  // CREATE_ENTITY: Create a new entity anchor
  z.object({
    action: z.literal('CREATE_ENTITY'),
    name: z.string().describe('Name of the new entity'),
    type: z.enum(['project', 'person', 'company', 'tool', 'topic']),
    summary: z.string().optional().describe('Initial summary'),
  }),

  // ADD_PENDING: Store uncertain information for later confirmation
  z.object({
    action: z.literal('ADD_PENDING'),
    original_text: z.string().describe('The exact text from the conversation that triggered this'),
    proposed_action: z.enum(['UPDATE_PROFILE', 'ADD_BIO', 'ADD_INSTRUCTION', 'ADD_FACT']).describe('What action would be taken if confirmed'),
    proposed_key: z.string().optional().describe('For UPDATE_PROFILE, the key to update'),
    proposed_value: z.string().describe('The value to store if confirmed'),
    confidence_reason: z.string().describe('Why you are uncertain (e.g., "User mentioned vaguely", "Could be interpreted differently", "Needs clarification")'),
    entity_name: z.string().optional().describe('Related entity name, if any'),
  }),
]);

const ExtractionResultSchema = z.object({
  actions: z.array(ActionSchema).describe('List of knowledge actions to execute'),
  detected_entities: z.array(z.string()).optional().describe('Entity names mentioned in the conversation'),
});

type ExtractionResult = z.infer<typeof ExtractionResultSchema>;
type KnowledgeAction = z.infer<typeof ActionSchema>;

// ═══════════════════════════════════════════════════════════════════════════════
// EXTRACTION PROMPT
// ═══════════════════════════════════════════════════════════════════════════════

const EXTRACTION_SYSTEM_PROMPT = `You are a Knowledge Extraction Agent for a personal AI assistant.

Your job is to analyze conversation turns and extract structured knowledge to remember.

## FACT TAXONOMY

1. **UPDATE_PROFILE** (Overwrite) - Core identity facts that replace old values:
   - Keys: name, nickname, birthday, country, timezone, occupation, email, language
   - Keys: os, gpu, cpu, ram, shell, editor, preferred_language
   - Keys: work_hours, communication_style
   - Example: User says "I upgraded to Windows 11" → UPDATE_PROFILE key="os" value="Windows 11"

2. **ADD_BIO** (Append) - Personal facts that stack:
   - Preferences, habits, relationships, hobbies
   - Example: "I have a golden retriever named Max" → ADD_BIO value="Has a golden retriever named Max"

3. **ADD_INSTRUCTION** (High Priority) - System directives:
   - How the AI should behave, response format preferences
   - Example: "Always be concise" → ADD_INSTRUCTION value="Be concise in responses"

4. **ADD_FACT** (Entity-linked) - Facts about projects, people, tools:
   - Must reference an entity by name
   - Example: "For Stuard, we use Pinia" → ADD_FACT entity_name="Stuard" value="Uses Pinia for state management"

5. **ADD_PROCEDURAL** (Dedupe by key) - Commands, paths, credentials:
   - key must be one of: command, path, credential, api_key, endpoint
   - Example: "The build command is npm run dev" → ADD_PROCEDURAL key="command" value="npm run dev"

6. **LOG_EVENT** (Time-series) - Events worth logging:
   - Meetings, milestones, deadlines
   - Example: "I met with the client yesterday" → LOG_EVENT value="Met with client"

7. **CREATE_ENTITY** - Create a new entity anchor:
   - Only when a new project/person/company/tool is introduced
   - Don't create if entity likely exists

8. **ADD_PENDING** (Uncertain) - For information you're NOT SURE about:
   - Use when information is vague, ambiguous, or needs clarification
   - Use when you're uncertain if the user meant this as a permanent fact
   - Use when the context suggests the user might be joking, hypothetical, or tentative
   - Example: User says "I might be starting a new job soon" → ADD_PENDING (not confirmed yet)
   - Example: User says "I think my timezone is PST or something" → ADD_PENDING (uncertain)
   - Example: User says "probably gonna switch to Linux" → ADD_PENDING (intent unclear)
   - The pending memory will be shown to the AI in future turns so it can ask for confirmation

## EXTRACTION RULES

1. **Be selective** - Only extract genuinely useful information
2. **Ignore transient** - Don't extract temporary states, immediate requests
3. **Prefer updates over duplicates** - Use UPDATE_PROFILE for core facts
4. **Link to entities** - When facts relate to a project/person, use ADD_FACT
5. **Detect entities** - List any entity names mentioned for context retrieval
6. **Max 5 actions** - Quality over quantity
7. **Fill missing profile fields** - If existing profile has empty/placeholder values (like "[User's response needed]"), extract info to fill them
8. **Add profile keys as needed** - Keys like "school", "university", "major", "company" are valid UPDATE_PROFILE keys
9. **Use ADD_PENDING for uncertainty** - If you're not 100% sure the user wants this remembered permanently, use ADD_PENDING

## WHEN TO USE ADD_PENDING (uncertain information)

- User uses hedging language: "I think", "maybe", "probably", "might", "considering"
- User mentions future plans that aren't confirmed: "planning to", "gonna", "want to"
- User's statement could be interpreted multiple ways
- User is venting or making offhand comments (might not want remembered)
- Information contradicts existing stored facts (needs clarification)
- User mentions something in passing without emphasis

## WHEN TO EXTRACT (be proactive)

- User mentions where they go to school → UPDATE_PROFILE key="school"
- User mentions their job/company → UPDATE_PROFILE key="company" or "occupation"
- User expresses a preference → ADD_BIO
- User mentions a project they're working on → CREATE_ENTITY + ADD_FACT
- User shares emotional context about something → ADD_BIO (e.g., "finds X stressful")

## WHAT TO IGNORE

- Greetings, small talk
- One-time requests ("show me X", "what is Y")
- Information that's ALREADY stored with the SAME value
- Temporary states ("I'm working on X right now")
- Speculative information`;

// ═══════════════════════════════════════════════════════════════════════════════
// EXTRACTION FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

export async function extractKnowledge(
  conversationHistory: Array<{ role: string; content: string }>,
  existingContext?: {
    profile?: Record<string, string>;
    entities?: Array<{ name: string; type: string; summary?: string }>;
    recentFacts?: Array<{ text: string; category: string }>;
  }
): Promise<ExtractionResult> {
  // Format full conversation thread for the model
  const conversationContext = conversationHistory
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
    .join('\n\n');
  
  // Build context about what we already know
  let knownContext = '';
  
  if (existingContext?.profile && Object.keys(existingContext.profile).length > 0) {
    knownContext += `\n\n## CURRENT USER PROFILE (already stored):\n${Object.entries(existingContext.profile).map(([k, v]) => `- ${k}: ${v}`).join('\n')}`;
  }
  
  if (existingContext?.entities && existingContext.entities.length > 0) {
    knownContext += `\n\n## KNOWN ENTITIES (already stored):\n${existingContext.entities.map(e => `- ${e.name} (${e.type})${e.summary ? `: ${e.summary}` : ''}`).join('\n')}`;
  }
  
  if (existingContext?.recentFacts && existingContext.recentFacts.length > 0) {
    knownContext += `\n\n## RECENT FACTS (already stored):\n${existingContext.recentFacts.slice(0, 10).map(f => `- [${f.category}] ${f.text}`).join('\n')}`;
  }
  
  if (knownContext) {
    knownContext = `\n\n─────────────────────────────────────────\nEXISTING KNOWLEDGE (use this to decide what to UPDATE vs what's already known):${knownContext}\n─────────────────────────────────────────`;
  }

  try {
    const extractionModelId = getDefaultModelForCategory('fast');
    const extractionModel = buildProviderModel(extractionModelId);

    const { object } = await generateObject({
      model: extractionModel as any,
      schema: ExtractionResultSchema,
      system: EXTRACTION_SYSTEM_PROMPT + knownContext,
      prompt: `Extract knowledge from this conversation turn:\n\n${conversationContext}`,
      temperature: 0.1,
    });

    writeLog('knowledge_extraction', { 
      inputLength: conversationContext.length,
      actionsCount: object.actions.length,
      detectedEntities: object.detected_entities,
    });

    return object;
  } catch (error) {
    writeLog('knowledge_extraction_error', { error: String(error) });
    return { actions: [], detected_entities: [] };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EMBEDDING HELPER
// ═══════════════════════════════════════════════════════════════════════════════

async function getEmbedding(text: string): Promise<number[]> {
  try {
    const { embedding } = await embed({
      model: openai.embedding('text-embedding-3-large'),
      value: text,
    });
    return embedding;
  } catch (error) {
    writeLog('embedding_error', { error: String(error) });
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXECUTION PIPELINE
// ═══════════════════════════════════════════════════════════════════════════════

export async function executeKnowledgeActions(
  actions: KnowledgeAction[],
  options?: { skipEmbeddings?: boolean }
): Promise<{ success: number; failed: number; results: any[] }> {
  const results: any[] = [];
  let success = 0;
  let failed = 0;

  for (const action of actions) {
    try {
      const result = await executeAction(action, options?.skipEmbeddings ?? false);
      results.push({ action: action.action, ok: true, result });
      success++;
    } catch (error) {
      results.push({ action: action.action, ok: false, error: String(error) });
      failed++;
      writeLog('knowledge_action_error', { action, error: String(error) });
    }
  }

  return { success, failed, results };
}

async function executeAction(action: KnowledgeAction, skipEmbeddings: boolean): Promise<any> {
  switch (action.action) {
    case 'UPDATE_PROFILE':
      return executeUpdateProfile(action.key, action.value, skipEmbeddings);

    case 'ADD_BIO':
      return executeAddBio(action.value, skipEmbeddings);

    case 'ADD_INSTRUCTION':
      return executeAddInstruction(action.value, skipEmbeddings);

    case 'ADD_FACT':
      return executeAddFact(action.entity_name, action.value, action.entity_type, skipEmbeddings);

    case 'ADD_PROCEDURAL':
      return executeAddProcedural(action.key, action.value, action.entity_name, skipEmbeddings);

    case 'LOG_EVENT':
      return executeLogEvent(action.value, action.entity_name, skipEmbeddings);

    case 'CREATE_ENTITY':
      return executeCreateEntity(action.name, action.type, action.summary, skipEmbeddings);

    case 'ADD_PENDING':
      return executeAddPending(
        action.original_text,
        action.proposed_action,
        action.proposed_value,
        action.confidence_reason,
        action.proposed_key,
        action.entity_name
      );

    default:
      throw new Error(`Unknown action type: ${(action as any).action}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACTION EXECUTORS (via local agent bridge)
// ═══════════════════════════════════════════════════════════════════════════════

async function executeUpdateProfile(key: string, value: string, skipEmbeddings: boolean): Promise<any> {
  const vector = skipEmbeddings ? [] : await getEmbedding(`${key}: ${value}`);
  return execLocalTool('knowledge_upsert_core', { key, value, vector }, undefined, 10000);
}

async function executeAddBio(value: string, skipEmbeddings: boolean): Promise<any> {
  const vector = skipEmbeddings ? [] : await getEmbedding(value);
  return execLocalTool('knowledge_add_fact', {
    category: 'personal',
    subtype: 'bio',
    text: value,
    vector,
  }, undefined, 10000);
}

async function executeAddInstruction(value: string, skipEmbeddings: boolean): Promise<any> {
  const vector = skipEmbeddings ? [] : await getEmbedding(value);
  return execLocalTool('knowledge_add_fact', {
    category: 'instruction',
    subtype: 'system',
    text: value,
    vector,
  }, undefined, 10000);
}

async function executeAddFact(
  entityName: string,
  value: string,
  entityType?: string,
  skipEmbeddings?: boolean
): Promise<any> {
  // First, find or create the entity
  let entity = await execLocalTool('knowledge_find_entity', { name: entityName }, undefined, 5000);
  
  if (!entity?.id) {
    // Create entity if not found
    const entityVector = skipEmbeddings ? [] : await getEmbedding(entityName);
    entity = await execLocalTool('knowledge_create_entity', {
      name: entityName,
      type: entityType || 'topic',
      vector: entityVector,
    }, undefined, 5000);
  }
  
  // Add fact linked to entity
  const vector = skipEmbeddings ? [] : await getEmbedding(value);
  return execLocalTool('knowledge_add_fact', {
    category: 'project',
    subtype: 'detail',
    text: value,
    entity_id: entity?.id,
    vector,
  }, undefined, 10000);
}

async function executeAddProcedural(
  key: string,
  value: string,
  entityName?: string,
  skipEmbeddings?: boolean
): Promise<any> {
  let entityId: string | undefined;
  
  if (entityName) {
    const entity = await execLocalTool('knowledge_find_entity', { name: entityName }, undefined, 5000);
    entityId = entity?.id;
  }
  
  const vector = skipEmbeddings ? [] : await getEmbedding(`${key}: ${value}`);
  return execLocalTool('knowledge_upsert_procedural', {
    key,
    value,
    entity_id: entityId,
    vector,
  }, undefined, 10000);
}

async function executeLogEvent(value: string, entityName?: string, skipEmbeddings?: boolean): Promise<any> {
  let entityId: string | undefined;
  
  if (entityName) {
    const entity = await execLocalTool('knowledge_find_entity', { name: entityName }, undefined, 5000);
    entityId = entity?.id;
  }
  
  const vector = skipEmbeddings ? [] : await getEmbedding(value);
  return execLocalTool('knowledge_add_fact', {
    category: 'event',
    subtype: 'history',
    text: value,
    entity_id: entityId,
    vector,
  }, undefined, 10000);
}

async function executeCreateEntity(
  name: string,
  type: string,
  summary?: string,
  skipEmbeddings?: boolean
): Promise<any> {
  // Check if entity already exists
  const existing = await execLocalTool('knowledge_find_entity', { name }, undefined, 5000);
  if (existing?.id) {
    return { skipped: true, reason: 'Entity already exists', entity: existing };
  }

  const vector = skipEmbeddings ? [] : await getEmbedding(`${name} ${summary || ''}`);
  return execLocalTool('knowledge_create_entity', {
    name,
    type,
    summary: summary || '',
    vector,
  }, undefined, 5000);
}

async function executeAddPending(
  originalText: string,
  proposedAction: string,
  proposedValue: string,
  confidenceReason: string,
  proposedKey?: string,
  entityName?: string
): Promise<any> {
  return execLocalTool('pending_memory_create', {
    original_text: originalText,
    proposed_action: proposedAction,
    proposed_value: proposedValue,
    confidence_reason: confidenceReason,
    proposed_key: proposedKey,
    entity_name: entityName,
  }, undefined, 5000);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN INGESTION FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

export async function ingestConversationTurn(
  conversationHistory: Array<{ role: string; content: string }>,
  options?: {
    skipExtraction?: boolean;
    skipEmbeddings?: boolean;
  }
): Promise<{
  extracted: ExtractionResult;
  executed: { success: number; failed: number; results: any[] };
}> {
  console.log('[knowledge] ingestConversationTurn called, history length:', conversationHistory.length);

  // Step 0: Fetch existing context to inform extraction decisions
  let existingContext: {
    profile?: Record<string, string>;
    entities?: Array<{ name: string; type: string; summary?: string }>;
    recentFacts?: Array<{ text: string; category: string }>;
  } = {};
  
  try {
    console.log('[knowledge] Fetching existing context...');
    
    // Fetch profile (identity lens)
    const profileResult = await execLocalTool('knowledge_get_identity', {}, undefined, 5000);
    const profileFacts: any[] = Array.isArray(profileResult)
      ? profileResult
      : Array.isArray((profileResult as any)?.facts)
        ? (profileResult as any).facts
        : [];
    if (profileFacts.length > 0) {
      const profile: Record<string, string> = {};
      for (const f of profileFacts) {
        const k = String(f?.attribute_key || '').trim();
        const v = String(f?.text || '').trim();
        if (!k || !v) continue;
        profile[k] = v;
      }
      if (Object.keys(profile).length > 0) {
        existingContext.profile = profile;
      }
    }
    
    // Fetch entities
    const entitiesResult = await execLocalTool('knowledge_list_entities', { limit: 50 }, undefined, 5000);
    const entitiesList: any[] = Array.isArray(entitiesResult)
      ? entitiesResult
      : Array.isArray((entitiesResult as any)?.entities)
        ? (entitiesResult as any).entities
        : [];
    if (entitiesList.length > 0) {
      const entities = entitiesList
        .map((e: any) => ({
          name: String(e?.name || '').trim(),
          type: String(e?.type || 'topic').trim(),
          summary: typeof e?.summary === 'string' ? e.summary : undefined,
        }))
        .filter((e: any) => Boolean(e.name));
      if (entities.length > 0) {
        existingContext.entities = entities;
      }
    }
    
    // Fetch recent facts (bio + recent project facts)
    const bioResult = await execLocalTool('knowledge_get_bio', { limit: 20 }, undefined, 5000);
    const bioFacts: any[] = Array.isArray(bioResult)
      ? bioResult
      : Array.isArray((bioResult as any)?.facts)
        ? (bioResult as any).facts
        : [];
    if (bioFacts.length > 0) {
      const facts = bioFacts
        .map((f: any) => ({
          text: String(f?.text || '').trim(),
          category: String(f?.category || 'personal').trim(),
        }))
        .filter((f: any) => Boolean(f.text));
      if (facts.length > 0) {
        existingContext.recentFacts = facts;
      }
    }
    
    console.log('[knowledge] Context fetched:', {
      profileKeys: Object.keys(existingContext.profile || {}).length,
      entityCount: existingContext.entities?.length || 0,
      factCount: existingContext.recentFacts?.length || 0,
    });
  } catch (err) {
    console.log('[knowledge] Failed to fetch existing context (continuing without):', err);
  }

  // Step 1: Extract knowledge from the full conversation thread
  console.log('[knowledge] Starting extraction...');
  const extracted = options?.skipExtraction 
    ? { actions: [], detected_entities: [] }
    : await extractKnowledge(conversationHistory, existingContext);
  console.log('[knowledge] Extraction complete, actions:', extracted.actions.length);

  // Step 2: Execute actions
  const executed = extracted.actions.length > 0
    ? await executeKnowledgeActions(extracted.actions, { skipEmbeddings: options?.skipEmbeddings })
    : { success: 0, failed: 0, results: [] };

  writeLog('knowledge_ingestion_complete', {
    historyLength: conversationHistory.length,
    actionsExtracted: extracted.actions.length,
    actionsSucceeded: executed.success,
    actionsFailed: executed.failed,
  });

  return { extracted, executed };
}
