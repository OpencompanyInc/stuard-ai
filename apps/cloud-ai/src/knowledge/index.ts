/**
 * Knowledge Graph Module
 * 
 * Entity-Fact Knowledge Graph for structured memory storage and retrieval.
 */

export {
  extractKnowledge,
  executeKnowledgeActions,
  ingestConversationTurn,
} from './ingestion';

export {
  buildKnowledgeContext,
  buildQuickContext,
  getIdentityLens,
  getDirectiveLens,
  getEntityContext,
  getBioLens,
  searchGlobalFacts,
  detectEntities,
  getKnowledgeStats,
  type Fact,
  type Entity,
  type ContextLenses,
  type BuiltContext,
} from './retrieval';
