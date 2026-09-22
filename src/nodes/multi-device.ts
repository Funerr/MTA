import { z } from 'zod/v4';
import { defineNode, type NodeDefinition } from '@midscene/test';
import { createMidsceneNodes } from '@midscene/test/midscene';
import { AndroidAgent } from '@midscene/android';
import { HarmonyAgent } from '@midscene/harmony';
import type { MultiDeviceBinding } from '../setup/multi-device-config';
import { createSharedAgentReportProvider } from '../setup/agent-report-provider';
import {
  requireAliasedAgent,
  type MultiDeviceProjectContext,
} from '../setup/multi-device';
import {
  devicePrepareInputSchema,
  deviceRecoverInputSchema,
} from './device-lifecycle';
import { experienceActInputSchema } from './experience-act';
import {
  asWaitUntilAgent,
  deviceWaitUntilInputSchema,
  runDeviceWaitUntil,
} from './device-wait-until';
import { attachAgentExecutionTraces } from './agent-traces';
import {
  aliasNativeNodes,
  takeUnaliasedWaitNode,
} from './alias-nodes';
import { DeviceInFlightGuard } from './device-inflight';
import { createDeviceParallelNode } from './device-parallel';
import type { KnowledgeInjectionOptions } from '../knowledge';
import { wrapNodesWithKnowledge } from '../knowledge/wrap';

/** 协作项目原生 Nodes 的可选包装配置；缺省全部关闭、行为与无配置一致。 */
export interface MultiDeviceNodesOptions {
  inflight?: DeviceInFlightGuard;
  /** aiAct 知识注入：在别名化之前包装原生 Nodes，使 <alias>.aiAct 同等生效。 */
  knowledge?: KnowledgeInjectionOptions;
}

export function createAliasedLifecycleNodes(
  alias: string,
): readonly NodeDefinition<any, any, MultiDeviceProjectContext>[] {
  return [
    defineNode({
      name: `${alias}.device.prepare`,
      description: `准备设备 ${alias}：返回当前平台主屏（Home）。仅是原生导航基线。`,
      inputSchema: devicePrepareInputSchema,
      async execute({ context }) {
        const agent = requireAliasedAgent(context, alias, `${alias}.device.prepare`);
        await agent.home();
      },
    }),
    defineNode({
      name: `${alias}.device.recover`,
      description: `恢复设备 ${alias}：返回当前平台主屏（Home）。保留系统设置与业务状态。`,
      inputSchema: deviceRecoverInputSchema,
      async execute({ context }) {
        const agent = requireAliasedAgent(context, alias, `${alias}.device.recover`);
        await agent.home();
      },
    }),
  ];
}

/** 协作项目的别名化显式等待：轮询目标设备界面条件，与框架 device.waitUntil 同一执行体。 */
function createAliasedWaitUntilNode(
  alias: string,
): NodeDefinition<any, any, MultiDeviceProjectContext> {
  return defineNode({
    name: `${alias}.device.waitUntil`,
    description: `显式等待设备 ${alias}：轮询判定界面上的自然语言条件，满足即继续，超时失败。`,
    stringInputKey: 'prompt',
    inputSchema: deviceWaitUntilInputSchema,
    async execute(execution) {
      const agent = asWaitUntilAgent(
        requireAliasedAgent(execution.context, alias, `${alias}.device.waitUntil`),
        `${alias}.device.waitUntil`,
      );
      const now = Date.now();
      const stopTraces = attachAgentExecutionTraces(execution, agent);
      try {
        const outcome = await runDeviceWaitUntil(agent, execution.input, {
          signal: execution.signal,
          deadlineAtMs: Math.min(
            now + execution.input.timeoutMs,
            execution.$.timeoutMs === undefined
              ? Number.POSITIVE_INFINITY
              : now + execution.$.timeoutMs,
          ),
        });
        return {
          summary: `${alias}.device.waitUntil 条件满足（第 ${outcome.attempts} 次判定，耗时 ${outcome.elapsedMs}ms）`,
          data: outcome,
        };
      } finally {
        stopTraces();
      }
    },
  });
}

function createUnprefixedOverrides(): readonly NodeDefinition<
  any,
  any,
  MultiDeviceProjectContext
>[] {
  const redirect = (name: string, schema: z.ZodObject) =>
    defineNode({
      name,
      description: `multi-device 项目请使用 <alias>.${name}。`,
      inputSchema: schema,
      execute() {
        throw new Error(
          `${name} 在 multi-device 项目中没有当前设备；请使用 <alias>.${name}，例如 phone1.${name}。`,
        );
      },
    });

  return [
    redirect('device.prepare', devicePrepareInputSchema),
    redirect('device.recover', deviceRecoverInputSchema),
    redirect('device.waitUntil', deviceWaitUntilInputSchema),
    defineNode({
      name: 'experienceAct',
      description: '多设备协作项目首期不接入 experienceAct。',
      inputSchema: experienceActInputSchema,
      execute() {
        throw new Error(
          'experienceAct 在 multi-device 项目中不可用；请对目标设备使用 <alias>.aiAct。',
        );
      },
    }),
  ];
}

export function createMultiDeviceNodes(
  bindings: readonly MultiDeviceBinding[],
  options: MultiDeviceNodesOptions = {},
): readonly NodeDefinition<any, any, MultiDeviceProjectContext>[] {
  const inflight = options.inflight ?? new DeviceInFlightGuard();
  const aliases = new Set(bindings.map((binding) => binding.alias));
  const aliased: NodeDefinition<any, any, MultiDeviceProjectContext>[] = [];
  const nativeRegistry = new Map<
    string,
    NodeDefinition<any, any, MultiDeviceProjectContext>
  >();
  let waitNode: NodeDefinition<any, any, MultiDeviceProjectContext> | undefined;

  for (const binding of bindings) {
    const agentClass = binding.platform === 'android' ? AndroidAgent : HarmonyAgent;
    // 原生 Nodes 先做知识注入包装再别名化：renameNodeDefinition 保留 execute 委托，
    // <alias>.aiAct 因此获得与单设备项目一致的注入行为。关闭时包装原样返回。
    const native = wrapNodesWithKnowledge(
      createMidsceneNodes<MultiDeviceProjectContext>({
        agentClass,
        // 经官方 agentProvider 契约提供别名 Agent 并登记报告来源（与单设备项目一致）。
        agentProvider: createSharedAgentReportProvider((execution) =>
          requireAliasedAgent(execution.context, binding.alias, `${binding.alias}.*`),
        ),
      }),
      options.knowledge,
    );
    waitNode ??= takeUnaliasedWaitNode(native);
    const aliasedNative = inflight.wrapAll(
      binding.alias,
      aliasNativeNodes(binding.alias, native),
    );
    for (const node of aliasedNative) nativeRegistry.set(node.name, node);
    aliased.push(
      ...aliasedNative,
      ...inflight.wrapAll(binding.alias, [
        ...createAliasedLifecycleNodes(binding.alias),
        createAliasedWaitUntilNode(binding.alias),
      ]),
    );
  }

  return [
    ...aliased,
    ...(waitNode ? [waitNode] : []),
    createDeviceParallelNode({
      aliases,
      // 并行组只委托 createMidsceneNodes 生成的别名化原生 Node；
      // 生命周期薄适配仅能作为顺序步骤，不能扩大 device.parallel 的协议范围。
      resolveNode: (name) => nativeRegistry.get(name),
    }),
    ...createUnprefixedOverrides(),
  ];
}

export { DeviceInFlightGuard } from './device-inflight';
export { DeviceInFlightError } from './device-inflight';
export {
  DeviceParallelStepError,
  type ParallelChildResult,
} from './device-parallel-run';
export { DEVICE_PARALLEL_NODE_NAME } from './device-parallel';
