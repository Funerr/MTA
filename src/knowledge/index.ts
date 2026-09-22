export {
  DEFAULT_KNOWLEDGE_ROOT,
  KNOWLEDGE_INDEX_ENABLED_ENV,
  KNOWLEDGE_INDEX_ROOT_ENV,
  loadKnowledgeInjectionConfig,
  parseKnowledgeEnabled,
  parseKnowledgeRoot,
  type KnowledgeInjectionConfig,
} from './config';
export {
  KnowledgeIndexError,
  loadKnowledgeIndex,
  readKnowledgeBody,
} from './loader';
export type { KnowledgeIndex, KnowledgeIndexEntry } from './types';
export {
  KNOWLEDGE_AI_ACT_WRAP,
  isKnowledgeAiActWrapped,
  matchKnowledgeEntries,
  wrapNodesWithKnowledge,
  type KnowledgeInjectionOptions,
} from './wrap';
