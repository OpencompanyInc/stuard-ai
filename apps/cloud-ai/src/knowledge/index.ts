/**
 * Knowledge Graph Module
 * 
 * Entity-Fact Knowledge Graph for structured memory storage and retrieval.
 */

export {
  executeKnowledgeActions,
  ingestConversationTurn,
} from './ingestion';

export {
  extractKnowledge,
} from './extraction';

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

export {
  analyzeForAutoSkill,
  type AutoSkillDraft,
  type AutoSkillStep,
  type AutoSkillToolUsage,
  type AutoSkillInjection,
} from './auto-skills';
