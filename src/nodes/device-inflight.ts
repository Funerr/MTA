import { defineNode, type NodeDefinition } from '@midscene/test';

export class DeviceInFlightError extends Error {
  constructor(alias: string, activeNode: string, requestedNode: string) {
    super(
      `设备 ${alias} 上仍有未结束的操作 ${activeNode}，拒绝重叠派发 ${requestedNode}。超时后底层调用可能仍在运行，不能宣称已取消成功。`,
    );
    this.name = 'DeviceInFlightError';
  }
}

/**
 * 按设备别名记录在途操作。标记在底层 execute 真正结束后才清除，
 * 避免 Midscene 步骤超时先返回后，下一步骤对同一设备重叠派发。
 */
export class DeviceInFlightGuard {
  private readonly active = new Map<string, string>();

  isBusy(alias: string): boolean {
    return this.active.has(alias);
  }

  activeNode(alias: string): string | undefined {
    return this.active.get(alias);
  }

  wrap<TContext>(
    alias: string,
    node: NodeDefinition<any, any, TContext>,
  ): NodeDefinition<any, any, TContext> {
    return defineNode({
      name: node.name,
      ...(node.title === undefined ? {} : { title: node.title }),
      ...(node.description === undefined ? {} : { description: node.description }),
      ...(node.stringInputKey === undefined
        ? {}
        : { stringInputKey: node.stringInputKey }),
      ...(node.inputSchema === undefined ? {} : { inputSchema: node.inputSchema }),
      execute: async (execution) => {
        const current = this.active.get(alias);
        if (current) {
          throw new DeviceInFlightError(alias, current, node.name);
        }
        this.active.set(alias, node.name);
        try {
          return await node.execute(execution);
        } finally {
          if (this.active.get(alias) === node.name) {
            this.active.delete(alias);
          }
        }
      },
    });
  }

  wrapAll<TContext>(
    alias: string,
    nodes: readonly NodeDefinition<any, any, TContext>[],
  ): readonly NodeDefinition<any, any, TContext>[] {
    return nodes.map((node) => this.wrap(alias, node));
  }
}
