/**
 * Knowledge Graph Ingestion Pipeline
 * 
 * Handles extraction, classification, and execution of knowledge updates.
 * Runs on every significant conversation turn.
 */

import { embed } from 'ai';
import { google } from '../utils/models';
import { execLocalTool, hasClientBridge } from '../tools/bridge';
import { writeLog } from '../utils/logger';
import { extractKnowledge, ExtractionResult, KnowledgeAction } from './extraction';

// ═══════════════════════════════════════════════════════════════════════════════
// EMBEDDING HELPER
// ═══════════════════════════════════════════════════════════════════════════════

async function getEmbedding(text: string): Promise<number[]> {
  try {
    const { embedding } = await embed({
      model: google.textEmbeddingModel('gemini-embedding-2-preview'),
      value: text,
    });
    return embedding;
  } catch (error) {
    writeLog('embedding_error', { error: String(error) });
    return [];
  }
}

const SILENT_LOCAL_TOOL_OPTIONS = { silent: true } as const;

async function execSilentLocalTool(tool: string, args: any, timeoutMs: number): Promise<any> {
  return execLocalTool(tool, args, undefined, timeoutMs, SILENT_LOCAL_TOOL_OPTIONS);
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXECUTION PIPELINE
// ═══════════════════════════════════════════════════════════════════════════════

export async function executeKnowledgeActions(
  actions: KnowledgeAction[],
  options?: { skipEmbeddings?: boolean; conversationId?: string }
): Promise<{ success: number; failed: number; results: any[] }> {
  const results: any[] = [];
  let success = 0;
  let failed = 0;

  for (const action of actions) {
    try {
      const result = await executeAction(action, options?.skipEmbeddings ?? false, options?.conversationId);
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

async function executeAction(action: KnowledgeAction, skipEmbeddings: boolean, conversationId?: string): Promise<any> {
  const confidence = 'confidence' in action ? (action as any).confidence ?? 1.0 : 1.0;

  switch (action.action) {
    case 'UPDATE_PROFILE':
      return executeUpdateProfile(action.key, action.value, skipEmbeddings, confidence, conversationId);

    case 'ADD_BIO':
      return executeAddBio(action.value, skipEmbeddings, confidence, conversationId);

    case 'ADD_INSTRUCTION':
      return executeAddInstruction(action.value, skipEmbeddings, confidence, conversationId);

    case 'ADD_FACT':
      return executeAddFact(action.entity_name, action.value, action.entity_type, skipEmbeddings, confidence, conversationId);

    case 'ADD_PROCEDURAL':
      return executeAddProcedural(action.key, action.value, action.entity_name, skipEmbeddings, confidence, conversationId);

    case 'LOG_EVENT':
      return executeLogEvent(action.value, action.entity_name, skipEmbeddings, confidence, conversationId);

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

async function executeUpdateProfile(key: string, value: string, skipEmbeddings: boolean, confidence: number = 1.0, conversationId?: string): Promise<any> {
  const vector = skipEmbeddings ? [] : await getEmbedding(`${key}: ${value}`);
  return execSilentLocalTool('knowledge_upsert_core', { key, value, vector, confidence, source_conversation_id: conversationId }, 10000);
}

async function executeAddBio(value: string, skipEmbeddings: boolean, confidence: number = 1.0, conversationId?: string): Promise<any> {
  const vector = skipEmbeddings ? [] : await getEmbedding(value);
  return execSilentLocalTool('knowledge_add_fact', {
    category: 'personal',
    subtype: 'bio',
    text: value,
    vector,
    confidence,
    source_conversation_id: conversationId,
  }, 10000);
}

async function executeAddInstruction(value: string, skipEmbeddings: boolean, confidence: number = 1.0, conversationId?: string): Promise<any> {
  const vector = skipEmbeddings ? [] : await getEmbedding(value);
  return execSilentLocalTool('knowledge_add_fact', {
    category: 'instruction',
    subtype: 'system',
    text: value,
    vector,
    confidence,
    source_conversation_id: conversationId,
  }, 10000);
}

async function executeAddFact(
  entityName: string,
  value: string,
  entityType?: string,
  skipEmbeddings?: boolean,
  confidence: number = 1.0,
  conversationId?: string,
): Promise<any> {
  // First, find or create the entity
  let entity = await execSilentLocalTool('knowledge_find_entity', { name: entityName }, 5000);

  if (!entity?.id) {
    // Create entity if not found
    const entityVector = skipEmbeddings ? [] : await getEmbedding(entityName);
    entity = await execSilentLocalTool('knowledge_create_entity', {
      name: entityName,
      type: entityType || 'topic',
      vector: entityVector,
    }, 5000);
  }

  // Add fact linked to entity
  const vector = skipEmbeddings ? [] : await getEmbedding(value);
  return execSilentLocalTool('knowledge_add_fact', {
    category: 'project',
    subtype: 'detail',
    text: value,
    entity_id: entity?.id,
    vector,
    confidence,
    source_conversation_id: conversationId,
  }, 10000);
}

async function executeAddProcedural(
  key: string,
  value: string,
  entityName?: string,
  skipEmbeddings?: boolean,
  confidence: number = 1.0,
  conversationId?: string,
): Promise<any> {
  let entityId: string | undefined;

  if (entityName) {
    const entity = await execSilentLocalTool('knowledge_find_entity', { name: entityName }, 5000);
    entityId = entity?.id;
  }

  const vector = skipEmbeddings ? [] : await getEmbedding(`${key}: ${value}`);
  return execSilentLocalTool('knowledge_upsert_procedural', {
    key,
    value,
    entity_id: entityId,
    vector,
    confidence,
    source_conversation_id: conversationId,
  }, 10000);
}

async function executeLogEvent(value: string, entityName?: string, skipEmbeddings?: boolean, confidence: number = 1.0, conversationId?: string): Promise<any> {
  let entityId: string | undefined;

  if (entityName) {
    const entity = await execSilentLocalTool('knowledge_find_entity', { name: entityName }, 5000);
    entityId = entity?.id;
  }

  const vector = skipEmbeddings ? [] : await getEmbedding(value);
  return execSilentLocalTool('knowledge_add_fact', {
    category: 'event',
    subtype: 'history',
    text: value,
    entity_id: entityId,
    vector,
    confidence,
    source_conversation_id: conversationId,
  }, 10000);
}

async function executeCreateEntity(
  name: string,
  type: string,
  summary?: string,
  skipEmbeddings?: boolean
): Promise<any> {
  // Check if entity already exists
  const existing = await execSilentLocalTool('knowledge_find_entity', { name }, 5000);
  if (existing?.id) {
    return { skipped: true, reason: 'Entity already exists', entity: existing };
  }

  const vector = skipEmbeddings ? [] : await getEmbedding(`${name} ${summary || ''}`);
  return execSilentLocalTool('knowledge_create_entity', {
    name,
    type,
    summary: summary || '',
    vector,
  }, 5000);
}

async function executeAddPending(
  originalText: string,
  proposedAction: string,
  proposedValue: string,
  confidenceReason: string,
  proposedKey?: string,
  entityName?: string
): Promise<any> {
  return execSilentLocalTool('pending_memory_create', {
    original_text: originalText,
    proposed_action: proposedAction,
    proposed_value: proposedValue,
    confidence_reason: confidenceReason,
    proposed_key: proposedKey,
    entity_name: entityName,
  }, 5000);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN INGESTION FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * B1: when re-extracting incrementally, look back this many turns past the
 * stored offset so the extractor sees the conversational lead-in (the prior
 * user turn often disambiguates the new one). Trades a few extra input tokens
 * for sharper extractions.
 */
const INCREMENTAL_EXTRACTION_LOOKBACK = 2;

export async function ingestConversationTurn(
  conversationHistory: Array<{ role: string; content: string }>,
  options?: {
    skipExtraction?: boolean;
    skipEmbeddings?: boolean;
    conversationId?: string;
  }
): Promise<{
  extracted: ExtractionResult;
  executed: { success: number; failed: number; results: any[] };
}> {
  console.log('[knowledge] ingestConversationTurn called, history length:', conversationHistory.length);

  const bridgeAvailable = hasClientBridge();
  if (!bridgeAvailable) {
    console.log('[knowledge] Bridge not available — skipping existing context fetch and action execution');
  }

  // B1: incremental extraction. Track which turns we've already extracted from
  // and only re-process the new tail (with a small lookback for context). When
  // there's no stored offset (fresh conversation or bridge unavailable) we
  // fall back to the full-history behavior.
  let extractionSlice = conversationHistory;
  let extractionOffsetBefore = 0;
  if (bridgeAvailable && options?.conversationId) {
    try {
      const offsetResult = await execSilentLocalTool(
        'conversation_get_extraction_offset',
        { conversation_id: options.conversationId },
        5000,
      );
      const offset = Number(offsetResult?.offset ?? 0);
      if (Number.isFinite(offset) && offset > 0 && offset < conversationHistory.length) {
        const sliceStart = Math.max(0, offset - INCREMENTAL_EXTRACTION_LOOKBACK);
        extractionSlice = conversationHistory.slice(sliceStart);
        extractionOffsetBefore = offset;
        console.log(`[knowledge] Incremental extraction: history=${conversationHistory.length} offset=${offset} sliceStart=${sliceStart} sliceLen=${extractionSlice.length}`);
      }
    } catch (err) {
      // Falls back to full history — incremental is best-effort.
      console.log('[knowledge] Failed to fetch extraction offset, processing full history:', err);
    }
  }

  // Step 0: Fetch existing context to inform extraction decisions
  let existingContext: {
    profile?: Record<string, string>;
    entities?: Array<{ name: string; type: string; summary?: string }>;
    recentFacts?: Array<{ text: string; category: string }>;
  } = {};
  
  if (bridgeAvailable) {
    try {
      console.log('[knowledge] Fetching existing context...');

      // execLocalTool resolves with { ok: false, error } on bridge_closed /
      // timeout rather than throwing. Without distinguishing that from a
      // genuinely-empty list, every failed fetch looked like "DB is empty"
      // and produced silent Context fetched: 0,0,0 logs.
      const bridgeErrors: Record<string, string> = {};
      const parseListResult = (
        tool: string,
        result: any,
        wrappedKey: string,
      ): any[] => {
        if (Array.isArray(result)) return result;
        if (Array.isArray(result?.[wrappedKey])) return result[wrappedKey];
        if (result && result.ok === false) {
          bridgeErrors[tool] = String(result.error || 'bridge_error');
        }
        return [];
      };

      // Fetch profile (identity lens)
      const profileResult = await execSilentLocalTool('knowledge_get_identity', {}, 5000);
      const profileFacts = parseListResult('knowledge_get_identity', profileResult, 'facts');
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
      const entitiesResult = await execSilentLocalTool('knowledge_list_entities', { limit: 50 }, 5000);
      const entitiesList = parseListResult('knowledge_list_entities', entitiesResult, 'entities');
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
      const bioResult = await execSilentLocalTool('knowledge_get_bio', { limit: 20 }, 5000);
      const bioFacts = parseListResult('knowledge_get_bio', bioResult, 'facts');
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

      const counts = {
        profileKeys: Object.keys(existingContext.profile || {}).length,
        entityCount: existingContext.entities?.length || 0,
        factCount: existingContext.recentFacts?.length || 0,
      };
      const errorCount = Object.keys(bridgeErrors).length;
      if (errorCount > 0) {
        // Bridge returned an error for at least one fetch. Report it so empty
        // context doesn't silently look like "empty DB" when it's really a
        // closed/unresponsive client bridge.
        console.warn('[knowledge] Context fetch had bridge errors:', {
          ...counts,
          bridgeErrors,
        });
        writeLog('knowledge_context_bridge_errors', { counts, bridgeErrors });
      } else {
        console.log('[knowledge] Context fetched:', counts);
      }
    } catch (err) {
      console.log('[knowledge] Failed to fetch existing context (continuing without):', err);
    }
  }

  // Step 1: Extract knowledge from the (possibly sliced) conversation thread
  console.log('[knowledge] Starting extraction...');
  const extracted = options?.skipExtraction
    ? { actions: [], detected_entities: [] }
    : await extractKnowledge(extractionSlice, existingContext);
  console.log('[knowledge] Extraction complete, actions:', extracted.actions.length);

  // Step 2: Execute actions
  const executed = extracted.actions.length > 0 && bridgeAvailable
    ? await executeKnowledgeActions(extracted.actions, { skipEmbeddings: options?.skipEmbeddings, conversationId: options?.conversationId })
    : { success: 0, failed: 0, results: [] };

  // B1: advance the extraction watermark *after* extraction succeeds.
  // Failure-mode: if anything blew up before this line, the offset stays put
  // so the next turn will retry the same range — at worst we re-extract a
  // turn or two, never lose data.
  if (bridgeAvailable && options?.conversationId && conversationHistory.length > extractionOffsetBefore) {
    try {
      await execSilentLocalTool(
        'conversation_set_extraction_offset',
        {
          conversation_id: options.conversationId,
          turn_index: conversationHistory.length,
        },
        5000,
      );
    } catch (err) {
      console.log('[knowledge] Failed to advance extraction offset (will retry next turn):', err);
    }
  }

  writeLog('knowledge_ingestion_complete', {
    historyLength: conversationHistory.length,
    sliceLength: extractionSlice.length,
    actionsExtracted: extracted.actions.length,
    actionsSucceeded: executed.success,
    actionsFailed: executed.failed,
  });

  return { extracted, executed };
}
