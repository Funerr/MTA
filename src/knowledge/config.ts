/** 知识注入的项目级配置：开关与知识根目录。模块导入不解析环境、不读磁盘。 */

/** 环境变量名（本框架级约定，官方 @midscene/* 自身不读取该变量）。 */
export const KNOWLEDGE_INDEX_ENABLED_ENV = 'KNOWLEDGE_INDEX_ENABLED';

/** 知识根目录环境变量；未设置时使用项目根下 `knowledge/`。 */
export const KNOWLEDGE_INDEX_ROOT_ENV = 'KNOWLEDGE_INDEX_ROOT';

export const DEFAULT_KNOWLEDGE_ROOT = 'knowledge';

const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on']);

/** 解析知识注入开关：缺省、空值或无法识别的值均为关闭（语义对齐 experience.enabled）。 */
export function parseKnowledgeEnabled(value: string | undefined): boolean {
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) return false;
  return ENABLED_VALUES.has(normalized);
}

/** 解析知识根目录：空白视为未设置（用默认目录）。 */
export function parseKnowledgeRoot(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (normalized.length === 0) return undefined;
  return normalized;
}

export interface KnowledgeInjectionConfig {
  readonly enabled: boolean;
  /** 知识根目录；相对路径按进程工作目录解析（对齐 Experience Store 根）。 */
  readonly root: string;
}

/** 从环境读取知识注入配置；不实例化加载器、不读 knowledge 目录。 */
export function loadKnowledgeInjectionConfig(
  env: NodeJS.ProcessEnv = process.env,
): KnowledgeInjectionConfig {
  return {
    enabled: parseKnowledgeEnabled(env[KNOWLEDGE_INDEX_ENABLED_ENV]),
    root: parseKnowledgeRoot(env[KNOWLEDGE_INDEX_ROOT_ENV]) ?? DEFAULT_KNOWLEDGE_ROOT,
  };
}
