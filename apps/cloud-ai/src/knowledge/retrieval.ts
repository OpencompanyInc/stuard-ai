/**
 * Knowledge Graph Retrieval System
 * 
 * Lens-based retrieval that builds structured context for LLM injection.
 */

import { embed } from 'ai';
import { openai } from '@ai-sdk/openai';
import { execLocalTool, hasClientBridge } from '../tools/bridge';
import { writeLog } from '../utils/logger';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface Fact {
  id: string;
  entity_id?: string;
  category: string;
  subtype: string;
  attribute_key?: string;
  text: string;
  created_at: string;
  validity: boolean;
  source: string;
}

export interface Entity {
  id: string;
  name: string;
  type: string;
  summary: string;
  last_accessed: string;
  created_at: string;
}

export interface PendingMemory {
  id: string;
  original_text: string;
  proposed_action: string;
  proposed_key?: string;
  proposed_value: string;
  confidence_reason: string;
  entity_name?: string;
  created_at: string;
  status: string;
}

export interface ContextLenses {
  identity: Fact[];
  directives: Fact[];
  activeEntity?: { entity: Entity; facts: Fact[] };
  bio: Fact[];
  globalSearch: Array<{ fact: Fact; score: number }>;
  pendingMemories: PendingMemory[];
}

export interface BuiltContext {
  text: string;
  lenses: ContextLenses;
  detectedEntities: string[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENTITY DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Detect entity names mentioned in the user's message.
 * Uses simple pattern matching + known entity lookup.
 */
export async function detectEntities(message: string): Promise<string[]> {
  if (!hasClientBridge()) return [];
  
  try {
    // Get list of known entities
    const res = await execLocalTool('knowledge_list_entities', { limit: 100 }, undefined, 5000);
    const entities: any[] = Array.isArray(res)
      ? res
      : Array.isArray((res as any)?.entities)
        ? (res as any).entities
        : [];
    if (!Array.isArray(entities) || entities.length === 0) return [];
    
    const detected: string[] = [];
    const messageLower = message.toLowerCase();
    
    for (const entity of entities) {
      const name = String(entity?.name || '').toLowerCase();
      if (name && messageLower.includes(name)) {
        detected.push(entity.name);
      }
    }
    
    return detected;
  } catch (error) {
    writeLog('entity_detection_error', { error: String(error) });
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LENS RETRIEVAL
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Layer 1: Identity Lens - Core profile facts
 */
export async function getIdentityLens(): Promise<Fact[]> {
  if (!hasClientBridge()) return [];
  
  try {
    const res = await execLocalTool('knowledge_get_identity', {}, undefined, 5000);
    const facts: any[] = Array.isArray(res)
      ? res
      : Array.isArray((res as any)?.facts)
        ? (res as any).facts
        : [];
    return Array.isArray(facts) ? (facts as any) : [];
  } catch (error) {
    writeLog('identity_lens_error', { error: String(error) });
    return [];
  }
}

/**
 * Layer 2: Directive Lens - System instructions
 */
export async function getDirectiveLens(): Promise<Fact[]> {
  if (!hasClientBridge()) return [];
  
  try {
    const res = await execLocalTool('knowledge_get_directives', {}, undefined, 5000);
    const facts: any[] = Array.isArray(res)
      ? res
      : Array.isArray((res as any)?.facts)
        ? (res as any).facts
        : [];
    return Array.isArray(facts) ? (facts as any) : [];
  } catch (error) {
    writeLog('directive_lens_error', { error: String(error) });
    return [];
  }
}

/**
 * Layer 3: Active Focus Lens - Entity-specific context
 */
export async function getEntityContext(entityName: string): Promise<{ entity: Entity; facts: Fact[] } | null> {
  if (!hasClientBridge()) return null;
  
  try {
    const result = await execLocalTool('knowledge_get_entity_context', { name: entityName }, undefined, 5000);
    if (!result?.entity) return null;
    return {
      entity: result.entity,
      facts: Array.isArray(result.facts) ? result.facts : [],
    };
  } catch (error) {
    writeLog('entity_context_error', { error: String(error) });
    return null;
  }
}

/**
 * Layer 4: Bio Lens - Personal facts about the user
 */
export async function getBioLens(limit: number = 10): Promise<Fact[]> {
  if (!hasClientBridge()) return [];

  try {
    const res = await execLocalTool('knowledge_get_bio', { limit }, undefined, 5000);
    const facts: any[] = Array.isArray(res)
      ? res
      : Array.isArray((res as any)?.facts)
        ? (res as any).facts
        : [];
    return Array.isArray(facts) ? (facts as any) : [];
  } catch (error) {
    writeLog('bio_lens_error', { error: String(error) });
    return [];
  }
}

/**
 * Pending Memories Lens - Uncertain memories awaiting confirmation
 */
export async function getPendingMemoriesLens(limit: number = 10): Promise<PendingMemory[]> {
  if (!hasClientBridge()) return [];

  try {
    const res = await execLocalTool('pending_memory_list', { limit }, undefined, 5000);
    const pending: any[] = Array.isArray(res)
      ? res
      : Array.isArray((res as any)?.pending)
        ? (res as any).pending
        : [];
    return Array.isArray(pending) ? (pending as any) : [];
  } catch (error) {
    writeLog('pending_memories_lens_error', { error: String(error) });
    return [];
  }
}

/**
 * Layer 5: Global Vector Search
 */
export async function searchGlobalFacts(
  queryVector: number[],
  limit: number = 10,
  threshold: number = 0.65
): Promise<Array<{ fact: Fact; score: number }>> {
  if (!hasClientBridge()) return [];
  
  try {
    const results = await execLocalTool('knowledge_search_facts', {
      vector: queryVector,
      limit,
      threshold,
    }, undefined, 10000);
    return Array.isArray(results) ? results : [];
  } catch (error) {
    writeLog('global_search_error', { error: String(error) });
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTEXT BUILDER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build complete context for LLM injection using lens-based retrieval.
 */
export async function buildKnowledgeContext(
  userMessage: string,
  options?: {
    includeIdentity?: boolean;
    includeDirectives?: boolean;
    includeBio?: boolean;
    includePendingMemories?: boolean;
    maxGlobalFacts?: number;
    detectEntities?: boolean;
    queryEmbedding?: number[];
  }
): Promise<BuiltContext> {
  const opts = {
    includeIdentity: true,
    includeDirectives: true,
    includeBio: false,
    includePendingMemories: true,
    maxGlobalFacts: 8,
    detectEntities: true,
    ...options,
  };

  const lenses: ContextLenses = {
    identity: [],
    directives: [],
    bio: [],
    globalSearch: [],
    pendingMemories: [],
  };

  const sections: string[] = [];
  let detectedEntities: string[] = [];

  // Parallel fetch of fixed lenses
  const [identityFacts, directiveFacts, bioFacts, pendingMemories, detected] = await Promise.all([
    opts.includeIdentity ? getIdentityLens() : Promise.resolve([]),
    opts.includeDirectives ? getDirectiveLens() : Promise.resolve([]),
    opts.includeBio ? getBioLens() : Promise.resolve([]),
    opts.includePendingMemories ? getPendingMemoriesLens() : Promise.resolve([]),
    opts.detectEntities ? detectEntities(userMessage) : Promise.resolve([]),
  ]);

  lenses.identity = identityFacts;
  lenses.directives = directiveFacts;
  lenses.bio = bioFacts;
  lenses.pendingMemories = pendingMemories;
  detectedEntities = detected;

  // Layer 1: Identity
  const missingProfileKeys = new Set(
    identityFacts
      .filter((f) => isPlaceholderValue(f.text))
      .map((f) => f.attribute_key)
      .filter((key): key is string => Boolean(key && String(key).trim().length > 0)),
  );

  const identityFactsForDisplay = identityFacts.filter((f) => !isPlaceholderValue(f.text));
  if (identityFactsForDisplay.length > 0) {
    const lines = ['[USER IDENTITY]'];
    for (const f of identityFactsForDisplay) {
      const key = f.attribute_key || 'info';
      lines.push(`${formatKey(key)}: ${f.text}`);
    }
    sections.push(lines.join('\n'));
  }

  if (missingProfileKeys.size > 0) {
    const lines = ['[PROFILE DETAILS NEEDED]'];
    lines.push(
      'These profile fields are blank or placeholders. Ask the user a concise follow-up to fill them in when it makes sense (they might never volunteer this info).',
    );
    for (const key of missingProfileKeys) {
      lines.push(`- ${formatKey(key)}`);
    }
    sections.push(lines.join('\n'));
  }

  // Layer 2: Directives
  if (directiveFacts.length > 0) {
    const lines = ['[SYSTEM INSTRUCTIONS]'];
    for (const f of directiveFacts) {
      lines.push(`- ${f.text}`);
    }
    sections.push(lines.join('\n'));
  }

  // Layer 3: Active Focus (entity context)
  if (detectedEntities.length > 0) {
    // Use the first detected entity for context
    const entityContext = await getEntityContext(detectedEntities[0]);
    if (entityContext) {
      lenses.activeEntity = entityContext;
      const lines = [`[CURRENT CONTEXT: ${entityContext.entity.name}]`];
      if (entityContext.entity.summary) {
        lines.push(`Summary: ${entityContext.entity.summary}`);
      }
      for (const f of entityContext.facts.slice(0, 10)) {
        lines.push(`- ${f.text}`);
      }
      sections.push(lines.join('\n'));
    }
  }

  // Layer 4: Bio (if requested)
  if (bioFacts.length > 0) {
    const lines = ['[ABOUT USER]'];
    for (const f of bioFacts) {
      lines.push(`- ${f.text}`);
    }
    sections.push(lines.join('\n'));
  }

  // Layer 5: Global search (semantic)
  if (opts.maxGlobalFacts > 0) {
    try {
      // Reuse pre-computed embedding when available; otherwise generate one
      const embeddingVec = opts.queryEmbedding && opts.queryEmbedding.length > 0
        ? opts.queryEmbedding
        : (await embed({
            model: openai.embedding('text-embedding-3-large'),
            value: userMessage,
          })).embedding;

      const searchResults = await searchGlobalFacts(embeddingVec, opts.maxGlobalFacts);
      
      // Filter out facts already shown in entity context
      const entityFactIds = new Set(lenses.activeEntity?.facts.map(f => f.id) || []);
      const filteredResults = searchResults.filter(r => !entityFactIds.has(r.fact.id));
      
      lenses.globalSearch = filteredResults;

      if (filteredResults.length > 0) {
        const lines = ['[RELEVANT MEMORIES]'];
        for (const { fact } of filteredResults) {
          lines.push(`- ${fact.text}`);
        }
        sections.push(lines.join('\n'));
      }
    } catch (error) {
      writeLog('global_search_embed_error', { error: String(error) });
    }
  }

  // Pending Memories - uncertain information awaiting confirmation
  if (pendingMemories.length > 0) {
    const lines = ['[PENDING MEMORIES - NEEDS CONFIRMATION]'];
    lines.push('The following information was mentioned but needs clarification. Consider asking the user to confirm:');
    for (const pm of pendingMemories) {
      lines.push(`- "${pm.original_text}"`);
      lines.push(`  → Would ${pm.proposed_action}${pm.proposed_key ? ` (${pm.proposed_key})` : ''}: "${pm.proposed_value}"`);
      lines.push(`  → Uncertain because: ${pm.confidence_reason}`);
    }
    sections.push(lines.join('\n'));
  }

  return {
    text: sections.join('\n\n'),
    lenses,
    detectedEntities,
  };
}

/**
 * Quick context builder for pre-retrieval (no embeddings)
 */
export async function buildQuickContext(): Promise<string> {
  const [identityFacts, directiveFacts] = await Promise.all([
    getIdentityLens(),
    getDirectiveLens(),
  ]);

  const sections: string[] = [];

  if (identityFacts.length > 0) {
    const lines = ['[USER IDENTITY]'];
    for (const f of identityFacts) {
      const key = f.attribute_key || 'info';
      lines.push(`${formatKey(key)}: ${f.text}`);
    }
    sections.push(lines.join('\n'));
  }

  if (directiveFacts.length > 0) {
    const lines = ['[SYSTEM INSTRUCTIONS]'];
    for (const f of directiveFacts) {
      lines.push(`- ${f.text}`);
    }
    sections.push(lines.join('\n'));
  }

  return sections.join('\n\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function formatKey(key: string): string {
  return key
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function isPlaceholderValue(value: string | null | undefined): boolean {
  if (value === null || typeof value === 'undefined') return true;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return true;
  return (
    normalized === '[user\'s response needed]' ||
    normalized === '[user response needed]' ||
    normalized === 'unknown' ||
    normalized === 'n/a' ||
    normalized === 'na' ||
    normalized === 'not provided' ||
    normalized === 'not set' ||
    normalized === 'tbd' ||
    normalized === 'pending'
  );
}

/**
 * Get knowledge graph statistics
 */
export async function getKnowledgeStats(): Promise<Record<string, any>> {
  if (!hasClientBridge()) {
    return { error: 'No client bridge available' };
  }

  try {
    return await execLocalTool('knowledge_stats', {}, undefined, 5000);
  } catch (error) {
    return { error: String(error) };
  }
}
