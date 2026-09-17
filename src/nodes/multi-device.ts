import { z } from 'zod/v4';
import { defineNode, type NodeDefinition } from '@midscene/test';
import { createMidsceneNodes } from '@midscene/test/midscene';
import { AndroidAgent } from '@midscene/android';
import { HarmonyAgent } from '@midscene/harmony';
import type { MultiDeviceBinding } from '../setup/multi-device-config';
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
  aliasNativeNodes,
  takeUnaliasedWaitNode,
} from './alias-nodes';
import { DeviceInFlightGuard } from './device-inflight';
import { createDeviceParallelNode } from './device-parallel';

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
  inflight: DeviceInFlightGuard = new DeviceInFlightGuard(),
): readonly NodeDefinition<any, any, MultiDeviceProjectContext>[] {
  const aliases = new Set(bindings.map((binding) => binding.alias));
  const aliased: NodeDefinition<any, any, MultiDeviceProjectContext>[] = [];
  const nativeRegistry = new Map<
    string,
    NodeDefinition<any, any, MultiDeviceProjectContext>
  >();
  let waitNode: NodeDefinition<any, any, MultiDeviceProjectContext> | undefined;

  for (const binding of bindings) {
    const agentClass = binding.platform === 'android' ? AndroidAgent : HarmonyAgent;
    const native = createMidsceneNodes<MultiDeviceProjectContext>({
      agentClass,
      getAgent: ({ context }) =>
        requireAliasedAgent(context, binding.alias, `${binding.alias}.*`),
    });
    waitNode ??= takeUnaliasedWaitNode(native);
    const aliasedNative = inflight.wrapAll(
      binding.alias,
      aliasNativeNodes(binding.alias, native),
    );
    for (const node of aliasedNative) nativeRegistry.set(node.name, node);
    aliased.push(
      ...aliasedNative,
      ...inflight.wrapAll(binding.alias, createAliasedLifecycleNodes(binding.alias)),
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
