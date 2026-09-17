import { z } from 'zod/v4';
import {
  defineNode,
  type NodeDefinition,
  type NodeExecutionContext,
  type NodeResult,
} from '@midscene/test';
import { parseAliasedNodeName } from './alias-nodes';
import {
  runParallelChildCalls,
  settleParallelResults,
  type ParallelChildResult,
} from './device-parallel-run';

export const DEVICE_PARALLEL_NODE_NAME = 'device.parallel';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isParallelNodeName(name: string): boolean {
  return name === DEVICE_PARALLEL_NODE_NAME || name.endsWith(`.${DEVICE_PARALLEL_NODE_NAME}`);
}

function normalizeChildInput(
  node: NodeDefinition<any, any, any>,
  raw: unknown,
  path: string,
): unknown {
  if (typeof raw === 'string') {
    if (typeof node.stringInputKey !== 'string') {
      throw new Error(`${path} 不支持字符串简写。`);
    }
    return { [node.stringInputKey]: raw };
  }
  if (raw === undefined || raw === null) return {};
  if (!isPlainObject(raw)) {
    throw new Error(`${path} 的输入必须是对象或字符串简写。`);
  }
  if ('$' in raw) {
    throw new Error(`${path} 不允许子步骤级 $ 元数据；超时由父步骤统一控制。`);
  }
  return raw;
}

export function createDeviceParallelInputSchema<TContext>(options: {
  aliases: ReadonlySet<string>;
  resolveNode: (name: string) => NodeDefinition<any, any, TContext> | undefined;
}) {
  return z
    .strictObject({
      steps: z
        .array(z.record(z.string(), z.unknown()))
        .min(2, 'device.parallel 至少需要两个子步骤'),
    })
    .superRefine((value, ctx) => {
      const seenAliases = new Set<string>();
      for (const [index, entry] of value.steps.entries()) {
        const keys = Object.keys(entry);
        const path = ['steps', index] as (string | number)[];
        if (keys.length !== 1) {
          ctx.addIssue({
            code: 'custom',
            path,
            message: '每个并行子步骤必须是单个 <alias>.<native-node> 映射。',
          });
          continue;
        }
        const name = keys[0]!;
        if (isParallelNodeName(name)) {
          ctx.addIssue({
            code: 'custom',
            path,
            message: 'device.parallel 不允许嵌套。',
          });
          continue;
        }
        const parsed = parseAliasedNodeName(name, options.aliases);
        if (!parsed) {
          ctx.addIssue({
            code: 'custom',
            path,
            message: `未知或不支持的并行目标：${name}。`,
          });
          continue;
        }
        if (seenAliases.has(parsed.alias)) {
          ctx.addIssue({
            code: 'custom',
            path,
            message: `同一并行步骤内设备别名不能重复：${parsed.alias}。`,
          });
          continue;
        }
        seenAliases.add(parsed.alias);
        const node = options.resolveNode(name);
        if (!node) {
          ctx.addIssue({
            code: 'custom',
            path,
            message: `目标平台没有 Node ${name}。`,
          });
          continue;
        }
        try {
          const input = normalizeChildInput(node, entry[name], name);
          if (node.inputSchema) node.inputSchema.parse(input);
        } catch (error) {
          ctx.addIssue({
            code: 'custom',
            path,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    });
}

export type DeviceParallelInput = {
  steps: Array<Record<string, unknown>>;
};

function collectChildReport(parent: NodeExecutionContext<unknown, unknown>) {
  const executionIds: string[] = [];
  return {
    executionIds,
    report: {
      addTrace(trace: { type: 'midscene-execution'; executionId: string }) {
        executionIds.push(trace.executionId);
        parent.report.addTrace(trace);
      },
    },
  };
}

export function createDeviceParallelNode<TContext>(options: {
  aliases: ReadonlySet<string>;
  resolveNode: (name: string) => NodeDefinition<any, any, TContext> | undefined;
}): NodeDefinition<DeviceParallelInput, { results: ParallelChildResult[] }, TContext> {
  const inputSchema = createDeviceParallelInputSchema(options);
  return defineNode({
    name: DEVICE_PARALLEL_NODE_NAME,
    description:
      '同时在不同已绑定设备上执行各一个别名化原生操作，等待全部完成后汇合。不允许嵌套或子步骤级 $。',
    stringInputKey: false,
    inputSchema,
    async execute(execution) {
      const calls = execution.input.steps.map((entry) => {
        const name = Object.keys(entry)[0]!;
        const parsed = parseAliasedNodeName(name, options.aliases)!;
        const node = options.resolveNode(name)!;
        const input = node.inputSchema
          ? node.inputSchema.parse(normalizeChildInput(node, entry[name], name))
          : normalizeChildInput(node, entry[name], name);
        return {
          alias: parsed.alias,
          node: parsed.nativeName,
          async execute(signal: AbortSignal): Promise<ParallelChildResult> {
            const childReport = collectChildReport(execution as NodeExecutionContext<unknown, unknown>);
            try {
              signal.throwIfAborted();
              const output = (await node.execute({
                ...execution,
                input,
                signal,
                report: childReport.report,
              })) as NodeResult | void;
              return {
                alias: parsed.alias,
                node: parsed.nativeName,
                status: 'success',
                ...(output?.summary === undefined ? {} : { summary: output.summary }),
                executionIds: [...childReport.executionIds],
              };
            } catch (error) {
              const cancelled = signal.aborted;
              return {
                alias: parsed.alias,
                node: parsed.nativeName,
                status: cancelled ? 'cancelled' : 'failed',
                executionIds: [...childReport.executionIds],
                error: error instanceof Error ? error.message : String(error),
              };
            }
          },
        };
      });

      const results = [...(await runParallelChildCalls(calls, execution.signal))].map(
        (result) => ({
          alias: result.alias,
          node: result.node,
          status: result.status,
          ...(result.summary === undefined ? {} : { summary: result.summary }),
          executionIds: [...result.executionIds],
          ...(result.error === undefined ? {} : { error: result.error }),
        }),
      );
      settleParallelResults(results);
      return {
        summary: results
          .map((result) => `${result.alias}.${result.node}:${result.status}`)
          .join('；'),
        data: { results },
      };
    },
  });
}
