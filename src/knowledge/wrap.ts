import { defineNode, type NodeDefinition, type NodeExecutionContext } from '@midscene/test';
import type { AiActNodeInput } from '@midscene/test/midscene';
import { loadKnowledgeInjectionConfig, type KnowledgeInjectionConfig } from './config';
import { loadKnowledgeIndex, readKnowledgeBody } from './loader';
import type { KnowledgeIndexEntry } from './types';

/**
 * 项目范围知识注入包装：仅替换 aiAct 执行入口。关闭时返回原始定义，
 * 不读取 knowledge 目录、不实例化加载逻辑。命中触发词的纯文本 prompt
 * 以 `[knowledge:<id>]` 标记追加条目正文后委托原执行；未命中原样透传。
 */

/** 标记已包装的官方 aiAct Node，避免重复拦截。 */
export const KNOWLEDGE_AI_ACT_WRAP = Symbol.for('mta.knowledge.aiActWrap');

export function isKnowledgeAiActWrapped(
  node: NodeDefinition<any, any, any> | undefined,
): boolean {
  return Boolean(node && KNOWLEDGE_AI_ACT_WRAP in node);
}

export type KnowledgeInjectionOptions = KnowledgeInjectionConfig;

/** 触发词子串匹配：ASCII 不区分大小写，命中按索引声明顺序返回。 */
export function matchKnowledgeEntries(
  prompt: string,
  entries: readonly KnowledgeIndexEntry[],
): KnowledgeIndexEntry[] {
  const normalized = prompt.toLowerCase();
  return entries.filter((entry) =>
    entry.triggers.some((trigger) => normalized.includes(trigger.toLowerCase())),
  );
}

/** 组合注入后的输入；纯文本 prompt 未命中或非纯文本时返回 undefined（原样透传）。 */
async function augmentWithKnowledge(
  input: AiActNodeInput,
  root: string,
): Promise<AiActNodeInput | undefined> {
  if (typeof input.prompt !== 'string') return undefined;
  const index = await loadKnowledgeIndex(root);
  const hits = matchKnowledgeEntries(input.prompt, index.entries);
  if (hits.length === 0) return undefined;
  const sections = await Promise.all(
    hits.map(async (entry) => `[knowledge:${entry.id}]\n${(await readKnowledgeBody(root, entry)).trim()}`),
  );
  return { ...input, prompt: `${input.prompt}\n\n${sections.join('\n\n')}` };
}

function wrapAiActNodeWithKnowledge<TContext>(
  official: NodeDefinition<any, any, TContext>,
  options: KnowledgeInjectionOptions,
): NodeDefinition<any, any, TContext> {
  if (isKnowledgeAiActWrapped(official)) return official;
  const officialExecute = official.execute.bind(official);
  const wrapped = defineNode({
    name: official.name,
    ...(official.title === undefined ? {} : { title: official.title }),
    ...(official.description === undefined ? {} : { description: official.description }),
    ...(official.stringInputKey === undefined ? {} : { stringInputKey: official.stringInputKey }),
    inputSchema: official.inputSchema,
    async execute(execution: NodeExecutionContext<AiActNodeInput, TContext>) {
      const augmented = await augmentWithKnowledge(execution.input, options.root);
      if (augmented === undefined) return officialExecute(execution);
      return officialExecute({ ...execution, input: augmented });
    },
  });
  Object.defineProperty(wrapped, KNOWLEDGE_AI_ACT_WRAP, {
    value: true,
    enumerable: false,
  });
  return wrapped as NodeDefinition<any, any, TContext>;
}

/** 项目范围包装官方 Nodes：仅替换 aiAct 执行入口。关闭时返回原始定义对象。 */
export function wrapNodesWithKnowledge<TContext>(
  nodes: readonly NodeDefinition<any, any, TContext>[],
  options: KnowledgeInjectionOptions = loadKnowledgeInjectionConfig(),
): readonly NodeDefinition<any, any, TContext>[] {
  if (!options.enabled) return nodes;
  return nodes.map((node) =>
    node.name === 'aiAct' ? wrapAiActNodeWithKnowledge(node, options) : node,
  );
}
