/**
 * Knowledge Graph Retrieval System
 * 
 * Lens-based retrieval that builds structured context for LLM injection.
 */

import { embed } from 'ai';
import { google } from '../utils/models';
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
  vector?: number[];
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
    const res = await execLocalTool('knowledge_list_entities', { limit: 100 }, undefined, 10000);
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
    const res = await execLocalTool('knowledge_get_identity', {}, undefined, 10000);
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
    const res = await execLocalTool('knowledge_get_directives', {}, undefined, 10000);
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
    const result = await execLocalTool('knowledge_get_entity_context', { name: entityName }, undefined, 10000);
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
    const res = await execLocalTool('knowledge_get_bio', { limit }, undefined, 10000);
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
    const res = await execLocalTool('pending_memory_list', { limit }, undefined, 10000);
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
  threshold: number = 0.65,
  includeVectors: boolean = true,
): Promise<Array<{ fact: Fact; score: number }>> {
  if (!hasClientBridge()) return [];

  try {
    const results = await execLocalTool('knowledge_search_facts', {
      vector: queryVector,
      limit,
      threshold,
      include_vectors: includeVectors,
    }, undefined, 10000);
    return Array.isArray(results) ? results : [];
  } catch (error) {
    writeLog('global_search_error', { error: String(error) });
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// RETRIEVAL QUALITY — Composite scoring, MMR, temporal awareness
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Compute a composite retrieval score from multiple signals.
 */
function computeCompositeScore(
  cosineSimilarity: number,
  fact: { created_at?: string; confidence?: number; source?: string },
  options?: { temporalBoost?: boolean },
): number {
  // Recency boost: linearly decays to 0 over 365 days
  let recencyBoost = 0;
  try {
    const createdMs = Date.parse(String(fact.created_at || ''));
    if (Number.isFinite(createdMs)) {
      const daysSince = (Date.now() - createdMs) / (86400 * 1000);
      recencyBoost = Math.max(0, 1 - daysSince / 365);
    }
  } catch {}

  const confidence = typeof fact.confidence === 'number' ? Math.max(0, Math.min(1, fact.confidence)) : 1.0;
  const sourceBonus = fact.source === 'user_manual' ? 1.0 : 0.0;

  let score = 0.60 * cosineSimilarity + 0.20 * recencyBoost + 0.15 * confidence + 0.05 * sourceBonus;

  // Extra boost for recent facts when temporal intent detected
  if (options?.temporalBoost) {
    try {
      const createdMs = Date.parse(String(fact.created_at || ''));
      if (Number.isFinite(createdMs)) {
        const daysSince = (Date.now() - createdMs) / (86400 * 1000);
        if (daysSince <= 30) score *= 1.5;
      }
    } catch {}
  }

  return score;
}

/**
 * Maximal Marginal Relevance reranking for diversity.
 * Balances relevance with diversity by penalising candidates similar
 * to already-selected results.
 */
function mmrRerank(
  candidates: Array<{ fact: Fact; score: number; vector?: number[] }>,
  k: number,
  lambda: number = 0.7,
): Array<{ fact: Fact; score: number }> {
  if (candidates.length <= k) return candidates.map((c) => ({ fact: c.fact, score: c.score }));

  const selected: Array<{ fact: Fact; score: number; vector?: number[] }> = [];
  const remaining = [...candidates];

  // Pick the highest-scored first
  remaining.sort((a, b) => b.score - a.score);
  selected.push(remaining.shift()!);

  while (selected.length < k && remaining.length > 0) {
    let bestIdx = 0;
    let bestMmr = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];

      // Find max similarity to any already-selected
      let maxSim = 0;
      if (cand.vector && cand.vector.length > 0) {
        for (const sel of selected) {
          if (sel.vector && sel.vector.length > 0) {
            maxSim = Math.max(maxSim, cosineSim(cand.vector, sel.vector));
          }
        }
      }

      const mmrScore = lambda * cand.score - (1 - lambda) * maxSim;
      if (mmrScore > bestMmr) {
        bestMmr = mmrScore;
        bestIdx = i;
      }
    }

    selected.push(remaining.splice(bestIdx, 1)[0]);
  }

  return selected.map((c) => ({ fact: c.fact, score: c.score }));
}

function cosineSim(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

/** Detect whether the user message expresses temporal intent */
function hasTemporalIntent(message: string): boolean {
  const lower = message.toLowerCase();
  const keywords = ['recently', 'lately', 'last week', 'this week', 'this month', 'last month', 'just', 'yesterday', 'today', 'few days ago'];
  return keywords.some((kw) => lower.includes(kw));
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

  // Layer 5: Global search (semantic) with composite scoring + MMR diversity
  if (opts.maxGlobalFacts > 0) {
    try {
      // Reuse pre-computed embedding when available; otherwise generate one
      const embeddingVec = opts.queryEmbedding && opts.queryEmbedding.length > 0
        ? opts.queryEmbedding
        : (await embed({
            model: google.textEmbeddingModel('gemini-embedding-2-preview'),
            value: userMessage,
          })).embedding;

      // Fetch more candidates than needed so composite scoring + MMR can select the best
      const fetchLimit = Math.min(opts.maxGlobalFacts * 3, 30);
      const searchResults = await searchGlobalFacts(embeddingVec, fetchLimit, 0.45);

      // Filter out facts already shown in entity context
      const entityFactIds = new Set(lenses.activeEntity?.facts.map(f => f.id) || []);
      const filtered = searchResults.filter(r => !entityFactIds.has(r.fact.id));

      // Apply composite scoring (cosine + recency + confidence + source)
      const temporalBoost = hasTemporalIntent(userMessage);
      const scored = filtered.map((r) => ({
        fact: r.fact,
        score: computeCompositeScore(r.score, {
          created_at: r.fact.created_at,
          confidence: (r.fact as any).confidence,
          source: r.fact.source,
        }, { temporalBoost }),
        vector: r.fact.vector || undefined,
      }));

      // Apply MMR reranking for diversity
      const reranked = mmrRerank(scored, opts.maxGlobalFacts, 0.7);

      lenses.globalSearch = reranked;

      if (reranked.length > 0) {
        const lines = ['[RELEVANT MEMORIES]'];
        for (const { fact } of reranked) {
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
