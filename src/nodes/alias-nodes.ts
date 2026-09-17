import { defineNode, type NodeDefinition } from '@midscene/test';

/** 协作项目中不按设备别名加前缀的官方 Node。 */
export const UNALIASED_NATIVE_NODE_NAMES = new Set(['wait']);

export function aliasedNodeName(alias: string, nativeName: string): string {
  return `${alias}.${nativeName}`;
}

export function parseAliasedNodeName(
  name: string,
  aliases: ReadonlySet<string>,
): { alias: string; nativeName: string } | undefined {
  const separator = name.indexOf('.');
  if (separator <= 0) return undefined;
  const alias = name.slice(0, separator);
  if (!aliases.has(alias)) return undefined;
  const nativeName = name.slice(separator + 1);
  if (nativeName.length === 0) return undefined;
  return { alias, nativeName };
}

/**
 * 用公开 `defineNode` 换名，保留原 schema、字符串简写与 `execute`。
 * 不复制私有 Runner 状态；并行步骤可直接委托返回的 `execute`。
 */
export function renameNodeDefinition<TInput, TData, TContext>(
  node: NodeDefinition<TInput, TData, TContext>,
  name: string,
): NodeDefinition<TInput, TData, TContext> {
  return defineNode({
    name,
    ...(node.title === undefined ? {} : { title: node.title }),
    ...(node.description === undefined ? {} : { description: node.description }),
    ...(node.stringInputKey === undefined ? {} : { stringInputKey: node.stringInputKey }),
    ...(node.inputSchema === undefined ? {} : { inputSchema: node.inputSchema }),
    execute: (execution) => node.execute(execution),
  });
}

export function aliasNativeNodes<TContext>(
  alias: string,
  nodes: readonly NodeDefinition<any, any, TContext>[],
): readonly NodeDefinition<any, any, TContext>[] {
  return nodes
    .filter((node) => !UNALIASED_NATIVE_NODE_NAMES.has(node.name))
    .map((node) => renameNodeDefinition(node, aliasedNodeName(alias, node.name)));
}

export function takeUnaliasedWaitNode<TContext>(
  nodes: readonly NodeDefinition<any, any, TContext>[],
): NodeDefinition<any, any, TContext> | undefined {
  return nodes.find((node) => node.name === 'wait');
}
