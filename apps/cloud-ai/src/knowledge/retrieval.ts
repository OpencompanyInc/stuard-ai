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
  // Forward-compat for P6 conversation-thread continuity boost. Populated
  // once `knowledge_search_facts` is updated to return it (see plan B-step).
  source_conversation_id?: string | null;
  confidence?: number;
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
  /** First active entity context, kept for backward compat. Equivalent to `activeEntities[0]`. */
  activeEntity?: { entity: Entity; facts: Fact[] };
  /** P3: up to 2 active entity contexts, so multi-entity queries don't lose half. */
  activeEntities: Array<{ entity: Entity; facts: Fact[] }>;
  bio: Fact[];
  globalSearch: Array<{ fact: Fact; score: number }>;
  pendingMemories: PendingMemory[];
}

/** Stable identifiers for each knowledge-context section. The caller applies
 *  per-key character budgets so highly-stable sections (identity, directives)
 *  never get truncated when a noisy section (e.g. relevant memories) exceeds
 *  its budget. */
export type KnowledgeSectionKey =
  | 'USER_IDENTITY'
  | 'PROFILE_DETAILS_NEEDED'
  | 'SYSTEM_INSTRUCTIONS'
  | 'CURRENT_CONTEXT'
  | 'ABOUT_USER'
  | 'RELEVANT_MEMORIES'
  | 'RELEVANT_COLLECTIONS'
  | 'PAST_CONTEXT'
  | 'PENDING_MEMORIES';

export interface BuiltContext {
  /** Concatenated section text — kept for legacy callers; new callers should
   *  prefer `sections` so they can apply per-section budgets. */
  text: string;
  sections: Array<{ key: KnowledgeSectionKey; text: string }>;
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
    const res = await execLocalTool('knowledge_list_entities', { limit: 100 }, undefined, 10000, { silent: true });
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
    const res = await execLocalTool('knowledge_get_identity', {}, undefined, 10000, { silent: true });
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
    const res = await execLocalTool('knowledge_get_directives', {}, undefined, 10000, { silent: true });
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
    const result = await execLocalTool('knowledge_get_entity_context', { name: entityName }, undefined, 10000, { silent: true });
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
    const res = await execLocalTool('knowledge_get_bio', { limit }, undefined, 10000, { silent: true });
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
    const res = await execLocalTool('pending_memory_list', { limit }, undefined, 10000, { silent: true });
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
    }, undefined, 10000, { silent: true });
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
 *
 * Used for both facts and segments — pass `confidence: 1.0` for segments
 * (segments don't carry per-row confidence). The `conversationBoost` option
 * adds extra score when the item came from the active conversation (or a
 * sibling conversation in the same project).
 */
export function computeCompositeScore(
  cosineSimilarity: number,
  item: { created_at?: string; confidence?: number; source?: string },
  options?: { temporalBoost?: boolean; conversationBoost?: number },
): number {
  // Recency boost: linearly decays to 0 over 365 days
  let recencyBoost = 0;
  try {
    const createdMs = Date.parse(String(item.created_at || ''));
    if (Number.isFinite(createdMs)) {
      const daysSince = (Date.now() - createdMs) / (86400 * 1000);
      recencyBoost = Math.max(0, 1 - daysSince / 365);
    }
  } catch {}

  const confidence = typeof item.confidence === 'number' ? Math.max(0, Math.min(1, item.confidence)) : 1.0;
  const sourceBonus = item.source === 'user_manual' ? 1.0 : 0.0;
  const conversationBoost = typeof options?.conversationBoost === 'number' ? options.conversationBoost : 0;

  let score = 0.60 * cosineSimilarity + 0.20 * recencyBoost + 0.15 * confidence + 0.05 * sourceBonus + conversationBoost;

  // Extra boost for recent items when temporal intent detected
  if (options?.temporalBoost) {
    try {
      const createdMs = Date.parse(String(item.created_at || ''));
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
 *
 * Generic across item types (facts, segments, etc.) — `getItem` projects out
 * the payload to return. Missing vectors degrade gracefully (no diversity
 * penalty applies, equivalent to pure score-order top-k).
 */
export function mmrRerank<TCandidate extends { score: number; vector?: number[] }, TResult>(
  candidates: TCandidate[],
  k: number,
  lambda: number,
  getItem: (candidate: TCandidate) => TResult,
): Array<{ item: TResult; score: number }> {
  if (candidates.length <= k) return candidates.map((c) => ({ item: getItem(c), score: c.score }));

  const selected: TCandidate[] = [];
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

  return selected.map((c) => ({ item: getItem(c), score: c.score }));
}

export function cosineSim(a: number[], b: number[]): number {
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
export function hasTemporalIntent(message: string): boolean {
  const lower = message.toLowerCase();
  const keywords = ['recently', 'lately', 'last week', 'this week', 'this month', 'last month', 'just', 'yesterday', 'today', 'few days ago'];
  return keywords.some((kw) => lower.includes(kw));
}

/**
 * Score, dedup, and MMR-rerank a batch of fact search hits. Pulled out of
 * `buildKnowledgeContext` so the parallel and embed-fallback paths share the
 * same scoring logic.
 *
 * P6: when `activeConversationId` is provided, facts whose
 * `source_conversation_id` matches get a +0.10 score boost — surfaces facts
 * the user established in *this* conversation ahead of unrelated ones.
 */
function scoreAndRerankFacts(
  searchResults: Array<{ fact: Fact; score: number }>,
  entityContextFacts: Fact[],
  maxResults: number,
  userMessage: string,
  activeConversationId?: string | null,
): Array<{ fact: Fact; score: number }> {
  const entityFactIds = new Set(entityContextFacts.map((f) => f.id));
  const filtered = searchResults.filter((r) => !entityFactIds.has(r.fact.id));
  const temporalBoost = hasTemporalIntent(userMessage);

  const scored = filtered.map((r) => {
    const conversationBoost = activeConversationId
      && r.fact.source_conversation_id
      && String(r.fact.source_conversation_id) === activeConversationId
      ? 0.10
      : 0;
    return {
      fact: r.fact,
      score: computeCompositeScore(r.score, {
        created_at: r.fact.created_at,
        confidence: r.fact.confidence,
        source: r.fact.source,
      }, { temporalBoost, conversationBoost }),
      vector: r.fact.vector || undefined,
    };
  });

  return mmrRerank(scored, maxResults, 0.7, (c) => c.fact)
    .map(({ item, score }) => ({ fact: item, score }));
}

/**
 * Render the `[RELEVANT MEMORIES]` block with provenance.
 *
 * P2: each line shows date (YYYY-MM-DD) and a `(user)` marker when the fact
 * came from explicit user statements. Lets the model say "you mentioned this
 * on Apr 10" without having to invent the date.
 */
function renderRelevantMemoriesBlock(reranked: Array<{ fact: Fact; score: number }>): string {
  const lines = ['[RELEVANT MEMORIES]'];
  for (const { fact } of reranked) {
    const dateStr = String(fact.created_at || '').slice(0, 10);
    const userMark = fact.source === 'user_manual' ? ' (user)' : '';
    const prefix = dateStr ? `${dateStr}${userMark}: ` : '';
    lines.push(`- ${prefix}${fact.text}`);
  }
  return lines.join('\n');
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
    /**
     * Active conversation id — when set, facts that originated in this
     * conversation get a small score boost (P6 continuity).
     */
    activeConversationId?: string | null;
  }
): Promise<BuiltContext> {
  const opts = {
    includeIdentity: true,
    includeDirectives: true,
    includeBio: false,
    includePendingMemories: true,
    maxGlobalFacts: 8,
    detectEntities: true,
    activeConversationId: null as string | null | undefined,
    ...options,
  };

  const lenses: ContextLenses = {
    identity: [],
    directives: [],
    activeEntities: [],
    bio: [],
    globalSearch: [],
    pendingMemories: [],
  };

  const sectionList: Array<{ key: KnowledgeSectionKey; text: string }> = [];
  const pushSection = (key: KnowledgeSectionKey, text: string) => {
    if (text.trim()) sectionList.push({ key, text });
  };

  // Resolve embedding upfront (needed by searchGlobalFacts in the parallel batch)
  const embeddingVec = opts.queryEmbedding && opts.queryEmbedding.length > 0
    ? opts.queryEmbedding
    : null;

  // Fetch more candidates than needed so composite scoring + MMR can select the best
  const fetchLimit = Math.min(opts.maxGlobalFacts * 3, 30);

  // ── Single parallel batch: lenses + entity detect→context chain + global facts ──
  const [identityFacts, directiveFacts, bioFacts, pendingMemories, entityResult, globalSearchResults] = await Promise.all([
    opts.includeIdentity ? getIdentityLens() : Promise.resolve([]),
    opts.includeDirectives ? getDirectiveLens() : Promise.resolve([]),
    opts.includeBio ? getBioLens() : Promise.resolve([]),
    opts.includePendingMemories ? getPendingMemoriesLens() : Promise.resolve([]),
    // Chain: detectEntities → getEntityContext (runs in parallel with everything else).
    // P3: fetch context for up to 2 detected entities (was previously only detected[0]),
    // so multi-entity queries like "compare A vs B" don't lose half the context.
    opts.detectEntities
      ? detectEntities(userMessage).then(async (detected): Promise<{ contexts: Array<NonNullable<Awaited<ReturnType<typeof getEntityContext>>>>; names: string[] }> => {
          const top = detected.slice(0, 2);
          if (top.length === 0) return { contexts: [], names: detected };
          const fetched = await Promise.all(top.map((name) => getEntityContext(name).catch(() => null)));
          const contexts = fetched.filter((c): c is NonNullable<typeof c> => c !== null);
          return { contexts, names: detected };
        }).catch(() => ({ contexts: [] as Array<NonNullable<Awaited<ReturnType<typeof getEntityContext>>>>, names: [] as string[] }))
      : Promise.resolve({ contexts: [] as Array<NonNullable<Awaited<ReturnType<typeof getEntityContext>>>>, names: [] as string[] }),
    // Global semantic search runs in parallel (only needs embedding, not entity results)
    opts.maxGlobalFacts > 0 && embeddingVec
      ? searchGlobalFacts(embeddingVec, fetchLimit, 0.45).catch(() => [] as Awaited<ReturnType<typeof searchGlobalFacts>>)
      : Promise.resolve([] as Awaited<ReturnType<typeof searchGlobalFacts>>),
  ]);

  lenses.identity = identityFacts;
  lenses.directives = directiveFacts;
  lenses.bio = bioFacts;
  lenses.pendingMemories = pendingMemories;

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
    pushSection('USER_IDENTITY', lines.join('\n'));
  }

  if (missingProfileKeys.size > 0) {
    const lines = ['[PROFILE DETAILS NEEDED]'];
    lines.push(
      'These profile fields are blank or placeholders. Ask the user a concise follow-up to fill them in when it makes sense (they might never volunteer this info).',
    );
    for (const key of missingProfileKeys) {
      lines.push(`- ${formatKey(key)}`);
    }
    pushSection('PROFILE_DETAILS_NEEDED', lines.join('\n'));
  }

  // Layer 2: Directives
  if (directiveFacts.length > 0) {
    const lines = ['[SYSTEM INSTRUCTIONS]'];
    for (const f of directiveFacts) {
      lines.push(`- ${f.text}`);
    }
    pushSection('SYSTEM_INSTRUCTIONS', lines.join('\n'));
  }

  // Layer 3: Active Focus (entity context — already resolved in parallel).
  // P3: render up to 2 entity blocks. Each block is capped at 5 facts so two
  // entities together stay roughly equivalent in size to the old 10-fact
  // single-entity block.
  const entityContexts = entityResult.contexts;
  const detectedEntities = entityResult.names;
  if (entityContexts.length > 0) {
    lenses.activeEntities = entityContexts;
    lenses.activeEntity = entityContexts[0]; // backward-compat alias
    for (const entityContext of entityContexts) {
      const lines = [`[CURRENT CONTEXT: ${entityContext.entity.name}]`];
      if (entityContext.entity.summary) {
        lines.push(`Summary: ${entityContext.entity.summary}`);
      }
      for (const f of entityContext.facts.slice(0, 5)) {
        lines.push(`- ${f.text}`);
      }
      pushSection('CURRENT_CONTEXT', lines.join('\n'));
    }
  }

  // Layer 4: Bio (if requested)
  if (bioFacts.length > 0) {
    const lines = ['[ABOUT USER]'];
    for (const f of bioFacts) {
      lines.push(`- ${f.text}`);
    }
    pushSection('ABOUT_USER', lines.join('\n'));
  }

  // Layer 5: Global search — results already fetched in parallel, apply scoring + dedup
  if (opts.maxGlobalFacts > 0 && globalSearchResults.length > 0) {
    try {
      const reranked = scoreAndRerankFacts(
        globalSearchResults,
        lenses.activeEntities.flatMap((ec) => ec.facts),
        opts.maxGlobalFacts,
        userMessage,
        opts.activeConversationId,
      );
      lenses.globalSearch = reranked;

      if (reranked.length > 0) {
        pushSection('RELEVANT_MEMORIES', renderRelevantMemoriesBlock(reranked));
      }
    } catch (error) {
      writeLog('global_search_embed_error', { error: String(error) });
    }
  } else if (opts.maxGlobalFacts > 0 && !embeddingVec) {
    // Fallback: no pre-computed embedding, generate one and search (rare path)
    try {
      const fallbackVec = (await embed({
        model: google.textEmbeddingModel('gemini-embedding-2-preview'),
        value: userMessage,
      })).embedding;
      const searchResults = await searchGlobalFacts(fallbackVec, fetchLimit, 0.45);
      const reranked = scoreAndRerankFacts(
        searchResults,
        lenses.activeEntities.flatMap((ec) => ec.facts),
        opts.maxGlobalFacts,
        userMessage,
        opts.activeConversationId,
      );
      lenses.globalSearch = reranked;
      if (reranked.length > 0) {
        pushSection('RELEVANT_MEMORIES', renderRelevantMemoriesBlock(reranked));
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
    pushSection('PENDING_MEMORIES', lines.join('\n'));
  }

  return {
    text: sectionList.map((s) => s.text).join('\n\n'),
    sections: sectionList,
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
